"""按复盘日汇集严重异动接近度、公告与保留的重点监控区间。"""
import math
import re
from datetime import date
from html import unescape

from requests import RequestException

from common import UA
from sources._http import http_post_json, last_raw_ref
from sources.cninfo import announcement_row
from sources.eastmoney import ANOMALY_RULES, _anomaly_get, _anomaly_market, em_stock_monitor
from sources.mappers import ev, out
from sources.shortline import now_sh, review_day
from sources.tencent import tencent_quotes
from sources.ths import ths_hot_reason

_LIMITS = {4: 100, 5: -50, 6: 200, 7: -70, 40: 150, 50: -60, 60: 300, 70: -75}
_MARKETS = {"SH": r"(?:60\d|68[89])\d{3}", "SZ": r"(?:00[0-3]|30[0-2])\d{3}", "BJ": r"(?:92\d|43\d|83\d|87\d|88\d)\d{3}"}
_FAILURES = (RequestException, RuntimeError, ValueError, KeyError)


def _stock(code, market=""):
    return next((key for key, pattern in _MARKETS.items()
                 if (not market or market == key) and re.fullmatch(pattern, str(code))), None)


def _number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and not isinstance(value, bool) else None


def _near(day):
    data = _anomaly_get("list", 200, 1)
    if str(data.get("date")) != day.replace("-", "") or data.get("open") != 0:
        raise RuntimeError("未取得该复盘日的收盘异动快照")
    if not isinstance(data.get("data"), list) or data.get("pages") not in (0, 1) or len(data["data"]) != data.get("count"):
        raise RuntimeError("东财异动列表不完整")
    rows = {}
    ref = last_raw_ref()
    for row in data["data"]:
        code = str(row.get("c") or "")
        market = _stock(code, _anomaly_market(code, row.get("m"), row.get("s")))
        key = row.get("e")
        if market == "BJ" and key in (4, 5, 6, 7):
            key *= 10
        limit, deviation = _LIMITS.get(key), _number(row.get("x"))
        if not market or limit is None or deviation is None or row.get("o") == 2:
            continue
        ratio = deviation / limit
        if not 0.7 <= ratio < 1 or (code in rows and rows[code]["ratio"] >= ratio):
            continue
        rows[code] = {"code": code, "name": row.get("n") or code, "market": market, "pct": _number(row.get("a")),
                      "deviation": deviation, "threshold": limit, "ratio": ratio, "rule": ANOMALY_RULES[key], "raw": ref}
    return sorted(rows.values(), key=lambda row: -row["ratio"])


def _disclosures(day):
    payload = {"stock": "", "tabName": "fulltext", "pageSize": "30", "pageNum": "1", "column": "",
               "category": "", "plate": "", "seDate": f"{day}~{day}", "searchkey": "严重异常波动",
               "secid": "", "sortName": "", "sortType": "", "isHLtitle": "true"}
    headers = {"User-Agent": UA, "Referer": "https://www.cninfo.com.cn/new/disclosure",
               "Origin": "https://www.cninfo.com.cn"}
    rows = {}
    scanned = 0
    for page in range(1, 11):
        payload["pageNum"] = str(page)
        data = http_post_json("https://www.cninfo.com.cn/new/hisAnnouncement/query", data=payload, headers=headers, timeout=12)
        items = data.get("announcements")
        if not isinstance(data.get("totalAnnouncement"), int) or not isinstance(data.get("hasMore"), bool):
            raise RuntimeError("巨潮公告检索格式异常")
        if not isinstance(items, list):
            if data["totalAnnouncement"] == 0 and data["hasMore"] is False:
                return [] if not scanned else list(rows.values())
            raise RuntimeError("巨潮公告检索结果缺失")
        scanned += len(items)
        ref = last_raw_ref()
        for item in items:
            code = str(item.get("secCode") or "")
            market = _stock(code)
            if not market:
                continue
            ann = announcement_row(item, code)
            title = unescape(re.sub(r"<[^>]*>", "", ann["title"]))
            if ann["date"] == day and "严重异常波动" in title and not re.search(r"更正|补充|取消", title):
                candidate = {"code": code, "name": item.get("secName") or code, "market": market,
                             "title": title, "url": ann["url"], "raw": ref}
                # 优先显示明确的异动公告，而非同一证券的延续风险提示。
                if code not in rows or "风险提示" not in title:
                    rows[code] = candidate
        if not data["hasMore"]:
            if scanned != data["totalAnnouncement"]:
                raise RuntimeError("巨潮公告检索分页不完整")
            return list(rows.values())
    raise RuntimeError("巨潮公告检索分页不完整")


def _monitor(day, local_day):
    records = em_stock_monitor(only_active=False)
    if not records:
        raise RuntimeError("东财重点监控名单未取得")
    ref = last_raw_ref()
    rows = {}
    for item in records:
        code, market = item["code"], item["market"]
        if not _stock(code, market):
            continue
        start = date.fromisoformat(item["start"]).isoformat()
        end = date.fromisoformat(item["end"]).isoformat()
        if start <= day <= end and (code not in rows or start > rows[code]["start"]):
            rows[code] = {"code": code, "name": item["name"] or code, "market": market, "start": start, "end": end, "raw": ref}
    if day != local_day and not rows:
        raise RuntimeError("当前名单未保留该复盘日的监控记录")
    return sorted(rows.values(), key=lambda row: row["start"], reverse=True)


def review_abnormal(day: str | None = None):
    day = date.fromisoformat(day).isoformat() if day is not None else review_day(None)
    clock = now_sh()
    local_day = clock.date().isoformat()
    if day > local_day or (day == local_day and clock.hour < 15):
        raise ValueError("请在交易日收盘后查看")
    blocks = {}
    gaps = {}
    refs = {}
    for key, load in (("near", lambda: _near(day)), ("disclosures", lambda: _disclosures(day)),
                      ("monitor", lambda: _monitor(day, local_day))):
        try:
            blocks[key] = load()
            refs[key] = last_raw_ref()
        except _FAILURES:
            blocks[key] = None
            gaps[key] = {"near": "暂无该复盘日的异动接近度快照",
                         "disclosures": "巨潮资讯当日公告暂未取得",
                         "monitor": "暂无对应日期的东财重点监控名单记录"}[key]

    names = {row["market"].lower() + row["code"]: row["code"] for group in blocks.values() if group for row in group}
    if names and day == local_day:
        try:
            quotes = tencent_quotes(list(names))
            by_code = {names[key]: _number(quote.get("change_pct")) for key, quote in quotes.items()
                       if key in names and str(quote.get("quote_time", ""))[:12] >= day.replace("-", "") + "1500"
                       and str(quote.get("quote_time", "")).startswith(day.replace("-", ""))}
        except _FAILURES:
            by_code = {}
        for group in blocks.values():
            for row in group or []:
                if "pct" not in row:
                    row["pct"] = by_code.get(row["code"])
    if names:
        try:
            topics = {str(row["code"]): row["reason"] for row in ths_hot_reason(day)
                      if str(row.get("code")) in names.values() and isinstance(row.get("reason"), str)}
        except _FAILURES:
            topics = {}
        for group in blocks.values():
            for row in group or []:
                if row["code"] in topics:
                    row["topic"] = topics[row["code"]][:120]
    return {"day": day, "blocks": blocks, "gaps": gaps, "refs": refs}


def review_abnormal_map(result, ctx):
    day = result["day"]
    evidence = []
    public_blocks = {}
    for key, rows in result["blocks"].items():
        public_blocks[key] = None if rows is None else [{k: v for k, v in row.items() if k != "raw"} for row in rows]
        if rows is not None:
            source = "cninfo" if key == "disclosures" else "eastmoney"
            evidence.append(ev(ctx, f"review_abnormal_{key}_count", len(rows), "只", day,
                               raw_ref=result["refs"].get(key), source=source))
            for row in rows:
                proof = row.get("title") or row.get("rule") or f"{row['start']} 至 {row['end']}"
                evidence.append(ev(ctx, f"review_abnormal_{key}", proof, "text", day,
                                   record_key=f"{key}|{row['code']}", raw_ref=row["raw"], source=source))
    return out(evidence, extra={"date": day, "blocks": public_blocks, "gaps": result["gaps"]},
               status="partial" if result["gaps"] else "ok")
