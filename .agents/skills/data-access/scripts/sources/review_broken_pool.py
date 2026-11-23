"""按交易日整理炸板名单，并补入同日可核验的公开行情。"""
import math

from requests import RequestException

from common import UA
from sources import shortline as S
from sources._http import DataNotAvailable, http_json, last_raw_ref
from sources.mappers import ev, out
from sources.tencent import tencent_quotes

_SOURCE_ERRORS = (RequestException, RuntimeError, ValueError, KeyError, TypeError)


def _number(value):
    return float(value) if type(value) in (float, int) and math.isfinite(value) else None


def _ths_fields(day):
    compact = day.replace("-", "")
    payload = http_json("https://data.10jqka.com.cn/dataapi/limit_up/open_limit_pool", params={
        "page": 1, "limit": 200, "field": "199112,10,9001,330323,330324,330325,9002,330329,133971,133970,1968584,3475914,9003,9004",
        "filter": "HS,GEM2STAR,ST", "order_field": "330324", "order_type": "0", "date": compact,
    }, headers={"User-Agent": UA}, timeout=8)
    data = payload.get("data")
    if not isinstance(data, dict) or str(data.get("date")).replace("-", "") != compact or not isinstance(data.get("info"), list):
        return {}
    return {str(item["code"]): item for item in data["info"]
            if item.get("code") and item.get("change_tag") == "LIMIT_FAILED"}


def broken_pool(day=None):
    day = S.review_day(day)
    if not S.is_settled(day):
        raise DataNotAvailable(f"{day} 尚无已收盘的炸板池")
    rows = S.pool("zb", day)
    pool_ref = last_raw_ref()
    if not rows:
        if not S.zt_pool(day):
            raise DataNotAvailable(f"{day} 暂未取得可核验的收盘炸板池")
        return {"date": day, "rows": [], "gaps": [], "pool_ref": pool_ref}

    previous_day = S.prev_trade_date(day)
    previous_pool = S.zt_pool(previous_day) if previous_day else None
    previous = {row["code"] for row in previous_pool} if previous_pool is not None else None
    try:
        ths = _ths_fields(day)
        ths_ref = last_raw_ref()
    except _SOURCE_ERRORS:
        ths, ths_ref = {}, None
    quotes, quote_ref = {}, None
    try:
        if day == S.latest_settled_session():
            quotes = tencent_quotes([row["code"] for row in rows])
            quote_ref = last_raw_ref()
    except _SOURCE_ERRORS:
        pass
    compact = day.replace("-", "")
    items = []
    for row in rows:
        code = row["code"]
        item = ths.get(code, {})
        rate = _number(item.get("limit_up_suc_rate"))
        topic = item.get("reason_type")
        quote = quotes.get(code, {})
        stamp = str(quote.get("quote_time") or "")
        cap = _number(quote.get("mcap_yi"))
        cap = (cap * 1e8 if cap and cap > 0 and not quote.get("is_stale") and len(stamp) >= 12 and stamp.isdigit()
               and stamp[:8] == compact and stamp[8:12] >= "1500" and quote.get("price") == row["close"] else None)
        items.append({
            "code": code, "name": row["name"], "board": row["board"], "sector": row["sector"],
            "topic": topic.strip() if isinstance(topic, str) else "",
            "stage": None if previous is None else "chain" if code in previous else "first",
            "close": row["close"], "pct": row["ret"], "turnover": row["turnover"],
            "total_cap": cap, "year_seal_rate": rate if rate is not None and 0 <= rate <= 1 else None,
            "breaks": row["broken_times"], "first_seal": row["first_seal"],
        })
    gaps = []
    if previous is None:
        gaps.append("前一交易日涨停池缺失，板位暂未划分。")
    if any(row["total_cap"] is None for row in items):
        gaps.append("部分总市值缺少同日收盘行情。")
    if any(row["year_seal_rate"] is None for row in items):
        gaps.append("部分近一年封板率未取得同花顺同日记录。")
    return {"date": day, "rows": items, "gaps": gaps,
            "pool_ref": pool_ref, "ths_ref": ths_ref, "quote_ref": quote_ref}


def broken_pool_map(result, ctx):
    day = result["date"]
    evidence = [ev(ctx, "review_broken_pool_count", len(result["rows"]), "只", day,
                   as_of=day, raw_ref=result["pool_ref"])]
    for row in result["rows"]:
        for key, unit in (("close", "元"), ("pct", "%"), ("turnover", "%"),
                          ("total_cap", "元"), ("year_seal_rate", "小数")):
            if row[key] is None:
                continue
            source, ref = ("tencent", "quote_ref") if key == "total_cap" else (
                ("ths", "ths_ref") if key == "year_seal_rate" else ("eastmoney", "pool_ref"))
            evidence.append(ev(ctx, f"review_broken_{key}", row[key], unit, day, as_of=day,
                               record_key=row["code"], source=source, raw_ref=result.get(ref)))
    return out(evidence, extra={k: result[k] for k in ("date", "rows", "gaps")},
               status="partial" if result["gaps"] else "ok")
