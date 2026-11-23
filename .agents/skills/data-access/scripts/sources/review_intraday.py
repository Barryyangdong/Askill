"""按交易日读取腾讯上证指数分钟点位和分段成交额。"""
import math
from datetime import date as calendar_date
from decimal import Decimal, InvalidOperation

from sources._http import DataNotAvailable, http_json, last_raw_ref
from sources.mappers import ev, out
from sources.shortline import review_day

_URL = "https://web.ifzq.gtimg.cn/appstock/app/day/query"
_SYMBOL = "sh000001"
_CLOCKS = tuple(f"{m // 60:02d}{m % 60:02d}" for m in (*range(570, 691), *range(780, 901)))


def index_minutes(date: str | None = None) -> dict:
    day = calendar_date.fromisoformat(date).isoformat() if date is not None else review_day(None)
    payload = http_json(_URL, params={"code": _SYMBOL}, headers={"Referer": "https://gu.qq.com/"}, timeout=12)
    minute_ref = last_raw_ref()
    if payload.get("code") != 0:
        raise RuntimeError("腾讯上证指数分时返回异常")
    sessions = payload.get("data", {}).get(_SYMBOL, {}).get("data")
    if not isinstance(sessions, list):
        raise RuntimeError("腾讯上证指数分时缺少交易日列表")
    compact = day.replace("-", "")
    session = next((s for s in sessions if s.get("date") == compact), None)
    if not session or not session.get("data"):
        raise DataNotAvailable(f"{day} 暂无可用分时记录，腾讯接口提供最近五个交易日")
    quotes = {}
    for line in session["data"]:
        try:
            clock, price, _, amount = line.split()[:4]
            point, turnover = float(price), Decimal(amount)
        except (ValueError, InvalidOperation) as error:
            raise RuntimeError("腾讯上证指数分时字段异常") from error
        if clock not in _CLOCKS or clock in quotes or not math.isfinite(point) or point <= 0 or not turnover.is_finite() or turnover < 0:
            raise RuntimeError("腾讯上证指数分时点位、时间或成交额异常")
        quotes[clock] = point, turnover

    previous = max((s for s in sessions if s.get("date", "") < compact), key=lambda s: s["date"], default=None)
    previous_rows = previous.get("data") if previous else None
    previous_fields = previous_rows[-1].split() if previous_rows else []
    prev_close = None
    prev_ref = minute_ref
    if len(previous_fields) >= 2 and previous_fields[0] == "1500":
        prior = float(previous_fields[1])
        if math.isfinite(prior) and prior > 0:
            prev_close = prior
    if prev_close is None:
        from sources.astock_ported import tencent_kline
        try:
            daily = tencent_kline(_SYMBOL, period="day", adjust="", count=10)
            prior_rows = daily[daily["date"].astype(str) < day]
            if not prior_rows.empty:
                prev_close = float(prior_rows.iloc[-1]["close"])
                prev_ref = last_raw_ref()
        except (RuntimeError, ValueError):
            pass

    points = []
    prev_amount = Decimal(0)
    complete = len(quotes) == len(_CLOCKS)
    for clock in _CLOCKS:
        quote = quotes.get(clock)
        if quote is None:
            prev_amount = None
            continue
        price, cumulative = quote
        amount = float(cumulative - prev_amount) if prev_amount is not None and cumulative >= prev_amount else None
        points.append({"time": f"{clock[:2]}:{clock[2:]}", "price": price, "amount": amount})
        complete = complete and amount is not None
        prev_amount = cumulative
    return {"date": day, "points": points, "prev_close": prev_close, "complete": complete, "minute_ref": minute_ref, "prev_ref": prev_ref}


def index_minutes_map(result: dict, ctx: dict) -> dict:
    day = result["date"]
    evidence = []
    for point in result["points"]:
        key = f"minute|{point['time']}"
        evidence.append(ev(ctx, "index_minute_price", point["price"], "点", day, record_key=key, as_of=day, raw_ref=result["minute_ref"]))
        if point["amount"] is not None:
            evidence.append(ev(ctx, "index_minute_amount", point["amount"], "元", day, record_key=key, as_of=day, raw_ref=result["minute_ref"]))
    if result["prev_close"] is not None:
        evidence.append(ev(ctx, "index_minute_prev_close", result["prev_close"], "点", day, record_key="baseline", as_of=day,
                           note="所选交易日的昨收基准", raw_ref=result["prev_ref"]))
    return out(evidence, extra={"date": day, "complete": result["complete"]},
               status="ok" if result["complete"] else "partial")
