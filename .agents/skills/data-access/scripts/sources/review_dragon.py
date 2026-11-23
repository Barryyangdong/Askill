"""市场龙虎榜日披露与席位明细，金额统一为元。"""
import math
import re
from collections import Counter, defaultdict
from datetime import date, datetime

from requests import RequestException

from common import TZ_SH
from sources._http import DataNotAvailable, em_json, last_raw_ref
from sources.eastmoney import DATACENTER_URL
from sources.mappers import ev, out
from sources.shortline import review_day

_REPORTS = {
    "total": "RPT_DAILYBILLBOARD_DETAILSNEW",
    "buy": "RPT_BILLBOARD_DAILYDETAILSBUY",
    "sell": "RPT_BILLBOARD_DAILYDETAILSSELL",
}
_PAGE_SIZE = 500
# 营业部全称匹配。Tushare 游资名录公开示例，属于来源标签，不是交易所披露的账户身份。
# https://tushare.pro/document/2?doc_id=311
_HOT_LABELS = {
    "中国银河证券股份有限公司大连黄河路证券营业部": "陈小群",
    "中国银河证券股份有限公司大连金马路证券营业部": "陈小群",
    "华鑫证券有限责任公司上海分公司": "量化打板",
    "华创证券有限责任公司上海第二分公司": "量化打板",
    "华泰证券股份有限公司总部": "量化基金",
    "中国国际金融股份有限公司上海分公司": "量化基金",
    "中国国际金融股份有限公司上海黄浦区湖滨路证券营业部": "量化基金",
    "中国中金财富证券有限公司北京宋庄路证券营业部": "量化基金",
    "东北证券股份有限公司绍兴金柯桥大道证券营业部": "量化基金",
    "长江证券股份有限公司佛山普澜二路证券营业部": "佛山系",
    "光大证券股份有限公司佛山绿景路证券营业部": "佛山系",
    "光大证券股份有限公司佛山季华六路证券营业部": "佛山系",
    "财通证券股份有限公司杭州上塘路证券营业部": "上塘路",
    "中信证券股份有限公司上海溧阳路证券营业部": "上海溧阳路",
    "中国中金财富证券有限公司南京中央路证券营业部": "作手新一",
    "华鑫证券有限责任公司杭州飞云江路证券营业部": "飞云江路",
    "华鑫证券有限责任公司杭州隐秀路证券营业部": "隐秀路",
    "申万宏源证券有限公司上海闵行区东川路证券营业部": "上海超短帮",
    "东方证券股份有限公司无锡新生路证券营业部": "上海超短帮",
    "东方证券股份有限公司上海浦东新区银城中路证券营业部": "上海超短帮",
    "中国银河证券股份有限公司绍兴证券营业部": "赵老哥",
    "浙商证券股份有限公司绍兴分公司": "赵老哥",
    "东吴证券股份有限公司苏州西北街证券营业部": "苏州帮",
    "招商证券股份有限公司深圳蛇口工业三路证券营业部": "乔帮主",
    "华泰证券股份有限公司天津东丽开发区二纬路证券营业部": "交易猿",
    "申港证券股份有限公司浙江分公司": "余哥",
    "甬兴证券有限公司青岛同安路证券营业部": "余哥",
    "东莞证券股份有限公司厦门分公司": "首板挖掘",
    "东莞证券股份有限公司四川分公司": "苏南帮",
    "东亚前海证券有限责任公司深圳分公司": "粉葛",
    "中国银河证券股份有限公司宜昌新世纪证券营业部": "瑞鹤仙",
    "东莞证券股份有限公司南京分公司": "玉兰路",
    "华泰证券股份有限公司北京月坛南街证券营业部": "独股一剑",
    "华泰证券股份有限公司北京雍和宫证券营业部": "牛散唐汉若",
    "平安证券股份有限公司深圳金田路证券营业部": "欢乐海岸",
    "招商证券股份有限公司深圳深南东路证券营业部": "招商深南东",
    "东亚前海证券有限责任公司上海分公司": "思明南路",
    "广发证券股份有限公司荣成石岛证券营业部": "山东帮",
    "东方证券股份有限公司厦门仙岳路证券营业部": "山东帮",
    "甬兴证券有限公司宁波和源路证券营业部": "宁波和源路",
    "东方财富证券股份有限公司拉萨团结路第二证券营业部": "T王",
    "东方财富证券股份有限公司拉萨团结路第一证券营业部": "T王",
    "东方财富证券股份有限公司拉萨东环路第二证券营业部": "T王",
    "东方财富证券股份有限公司拉萨东环路第一证券营业部": "T王",
    "东方财富证券股份有限公司山南香曲东路证券营业部": "T王",
}


def _report(kind: str, day: str) -> list[dict]:
    records = []
    pages, expected = 1, 0
    for number in range(1, 11):
        payload = em_json(DATACENTER_URL, params={
            "reportName": _REPORTS[kind], "columns": "ALL", "source": "WEB", "client": "WEB",
            "filter": f"(TRADE_DATE='{day}')", "pageSize": _PAGE_SIZE, "pageNumber": number,
            "sortColumns": {"total": "TRADE_ID", "buy": "TRADE_ID,BUY", "sell": "TRADE_ID,SELL"}[kind],
            "sortTypes": "1" if kind == "total" else "1,-1",
        }, timeout=12)
        if payload.get("code") == 9201 and number == 1:
            return []
        result = payload.get("result")
        if not payload.get("success") or not isinstance(result, dict) or not isinstance(result.get("data"), list):
            raise RuntimeError(f"东财龙虎榜{kind}报表暂不可用")
        if number == 1:
            pages, expected = int(result["pages"]), int(result["count"])
        if pages > 10 or expected != int(result["count"]):
            raise RuntimeError(f"东财龙虎榜{kind}报表分页不完整")
        ref = last_raw_ref()
        for row in result["data"]:
            if str(row.get("TRADE_DATE", ""))[:10] != day:
                raise RuntimeError(f"东财龙虎榜{kind}报表返回其他交易日")
            records.append({**row, "_raw": ref})
        if number >= pages:
            break
    if len(records) != expected:
        raise RuntimeError(f"东财龙虎榜{kind}报表条数不完整")
    return records


def _num(value):
    return value if type(value) in (int, float) and math.isfinite(value) else None


def _span(reason: str) -> int | None:
    if re.search(r"连续.{0,3}[三3](?:个)?交易日", reason):
        return 3
    return None if any(word in reason for word in ("累计", "异常波动期间", "连续")) else 1


def _seat_identity(row: dict) -> tuple:
    return tuple(row.get(field) for field in ("OPERATEDEPT_CODE", "OPERATEDEPT_NAME", "BUY", "SELL", "NET"))


def _amounts(buy, sell, net) -> dict:
    return {"buy": buy, "sell": sell, "net": net, "turnover": round(buy + sell, 2) if buy is not None and sell is not None else None}


def _group(seats: list[dict], complete: bool) -> dict:
    def sum_field(key):
        if not complete or any(seat[key] is None for seat in seats):
            return None
        return round(sum(seat[key] for seat in seats), 2)
    return {**_amounts(*(sum_field(key) for key in ("buy", "sell", "net"))), "seats": seats}


def combine_dragon(total: list[dict], buys: list[dict], sells: list[dict]) -> list[dict]:
    """每只股票选一个披露事件，买卖榜重合的席位以多重集并集去重。"""
    events = defaultdict(list)
    for disclosure in total:
        code = str(disclosure.get("SECUCODE") or "")
        if not re.fullmatch(r"\d{6}\.(?:SH|SZ|BJ)", code):
            continue
        digits, board = code.split(".")
        if not digits.startswith({"SH": ("6",), "SZ": ("00", "30"), "BJ": ("4", "8", "920")}[board]):
            continue
        reason = str(disclosure.get("EXPLANATION") or "")
        span = _span(reason)
        events[code].append((disclosure, span, reason))

    sides = defaultdict(lambda: (Counter(), Counter()))
    for side, records in enumerate((buys, sells)):
        for row in records:
            key = (str(row.get("SECUCODE")), str(row.get("TRADE_ID")))
            sides[key][side][_seat_identity(row)] += 1

    result = []
    for code, records in events.items():
        disclosure, span, reason = max(records, key=lambda entry: (
            entry[1] == 1, _num(entry[0].get("BILLBOARD_DEAL_AMT")) or 0, str(entry[0].get("TRADE_ID")),
        ))
        buy_seats, sell_seats = sides[(code, str(disclosure.get("TRADE_ID")))]
        complete = sum(buy_seats.values()) == 5 and sum(sell_seats.values()) == 5
        hot: list[dict] = []
        inst: list[dict] = []
        for (_, label, buy, sell, net), multiplicity in (buy_seats | sell_seats).items():
            alias = _HOT_LABELS.get(label)
            if label != "机构专用" and alias is None:
                continue
            # 对手侧缺值只有在东方财富提供的 NET 验证等式成立时才按 0 处理。
            buy, sell, net = _num(buy), _num(sell), _num(net)
            if net is not None and (buy is not None or sell is not None) and math.isclose((buy or 0) - (sell or 0), net, rel_tol=0, abs_tol=0.02):
                buy, sell = buy or 0, sell or 0
            target = inst if alias is None else hot
            target.extend({"name": alias or label, "seat": label, "buy": buy, "sell": sell, "net": net} for _ in range(multiplicity))
        result.append({
            "symbol": code.split(".")[0], "board": code.split(".")[1],
            "name": str(disclosure.get("SECURITY_NAME_ABBR") or ""), "pct": _num(disclosure.get("CHANGE_RATE")),
            "span": span, "reason": reason,
            "total": _amounts(*(_num(disclosure.get("BILLBOARD_" + key + "_AMT")) for key in ("BUY", "SELL", "NET"))),
            "hot": _group(hot, complete), "institution": _group(inst, complete),
            "seat_complete": complete, "_raw": disclosure.get("_raw"),
        })
    return sorted(result, key=lambda row: -(row["total"]["net"] or 0))


def review_dragon(day: str | None = None) -> dict:
    day = date.fromisoformat(day).isoformat() if day is not None else review_day(None)
    now = datetime.now(TZ_SH)
    if day > now.date().isoformat() or (day == now.date().isoformat() and now.hour < 15):
        raise DataNotAvailable("该交易日龙虎榜收盘披露尚未取得")
    total = _report("total", day)
    if not total:
        raise DataNotAvailable("该日龙虎榜尚未取得")
    gaps = []
    seats = []
    for kind, label in (("buy", "买入"), ("sell", "卖出")):
        try:
            seats.append(_report(kind, day))
        except (RequestException, RuntimeError, ValueError):
            seats.append([])
            gaps.append(f"{label}席位表暂未取得")
    rows = combine_dragon(total, *seats)
    if not rows:
        raise DataNotAvailable("该日暂未取得可核验的 A 股龙虎榜")
    if any(not row["seat_complete"] for row in rows):
        gaps.append("部分股票的前五买卖席位披露缺失")
    return {"date": day, "rows": rows, "gaps": gaps}


def review_dragon_map(result: dict, ctx: dict) -> dict:
    day = result["date"]
    evidence = [
        ev(ctx, f"dragon_{group}_net", row[group]["net"], "元", day, as_of=day,
           record_key=f'{row["board"]}:{row["symbol"]}', note=row["reason"], raw_ref=row["_raw"] if group == "total" else None)
        for row in result["rows"] for group in ("total", "hot", "institution") if row[group]["net"] is not None
    ]
    rows = [{key: value for key, value in row.items() if key != "_raw"} for row in result["rows"]]
    return out(evidence, extra={"date": day, "rows": rows, "gaps": result["gaps"], "seat_labels_version": 2},
               missing=[{"field": "dragon_seats", "period": day, "reason": gap} for gap in result["gaps"]],
               status="partial" if result["gaps"] else None)
