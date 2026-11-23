"""依据同日收盘池和收盘行情计算打板指标。"""
from datetime import datetime
from statistics import mean

from requests import RequestException

from sources import astock_ported, shortline as S
from sources._http import DataNotAvailable
from sources.mappers import ev, out


def _pool(kind, day):
    if not day:
        return None
    try:
        rows = S.pool(kind, day)
        return rows if rows or kind != "zt" else None
    except (RequestException, RuntimeError, ValueError, KeyError, TypeError):
        return None


def _closing_returns(day, codes):
    if not codes:
        return {}
    try:
        frame = astock_ported.tdx_daily_package(day)
        if set(frame["date"]) == {day}:
            return {
                str(row.code): (row.close / row.prev_close - 1) * 100
                for row in frame.itertuples(index=False)
                if str(row.code) in codes and row.close > 0 and row.prev_close > 0 and row.amount > 0
            }
    except (RequestException, RuntimeError, ValueError):
        pass
    try:
        return S.batch_pct(list(codes), day) if S.live_quotes_are_close_of(day)[0] else {}
    except (RequestException, RuntimeError, ValueError):
        return {}


def _avg(values):
    return round(mean(values), 4) if values else None


def _ratio(numerator, denominator):
    return round(numerator / denominator * 100, 4) if denominator else None


def _by_stage(rows, board, stage, streak):
    if rows is None or (stage != "all" and streak is None):
        return None
    return [
        row for row in rows
        if (board == "all" or row["board"] in ("10cm", "主板ST"))
        and (stage == "all" or stage == ("chain" if streak.get(row["code"], 0) else "first"))
    ]


def _coverage(rows, returns):
    if rows is None:
        return None
    values = [returns[row["code"]] for row in rows if row["code"] in returns]
    return {"value": _avg(values), "sample": len(values), "total": len(rows)}


def board_metrics(day=None, prev=None, earlier=None):
    if day is None:
        day = S.review_day(None)
    session = datetime.strptime(day, "%Y-%m-%d").date()
    day = session.isoformat()
    now = S.now_sh()
    if session.weekday() >= 5 or day > S.today_sh() or (day == S.today_sh() and (now.hour, now.minute) < (15, 5)):
        raise DataNotAvailable(f"{day} 尚无已收盘的打板指标")
    for item, upper in ((prev, day), (earlier, prev)):
        if item and (not upper or datetime.strptime(item, "%Y-%m-%d").date().isoformat() >= upper):
            raise ValueError("打板指标的交易日顺序异常")
    up, broken = _pool("zt", day), _pool("zb", day)
    if up is None:
        raise DataNotAvailable(f"{day} 暂未取得收盘涨停池")
    prev_up, prev_broken = _pool("zt", prev), _pool("zb", prev)
    if prev_up is None and prev_broken == []:
        prev_broken = None
    prior_up = _pool("zt", earlier)
    prev_heights = None if prev_up is None else {row["code"]: row["boards"] for row in prev_up}
    prior_heights = None if prior_up is None else {row["code"]: row["boards"] for row in prior_up}
    # 成功封板的板数由源直接披露；炸板没有当天板数，只能按上一场连续涨停判其尝试板位。
    current_heights = {row["code"]: row["boards"] - 1 for row in up}
    returns = _closing_returns(day, {row["code"] for row in (prev_broken or [])})
    settled = S.settled_pool(day) or []
    for row in settled:
        returns.setdefault(row["code"], row["ret"])
    # 昨日涨停池有独立的同日定稿；若前一日涨停名单不可用，仍可展示这份溢价样本。
    premium_up = prev_up if prev_up is not None else [
        {**row, "boards": row["prev_boards"]} for row in settled if row.get("prev_boards")
    ] or None
    premium_heights = {row["code"]: row["boards"] - 1 for row in premium_up or []}
    values = {}
    for board in ("main", "all"):
        for stage in ("all", "first", "chain"):
            selected = _by_stage(up, board, stage, current_heights)
            failed = _by_stage(broken, board, stage, prev_heights)
            previous_up = _by_stage(premium_up, board, stage, premium_heights)
            previous_broken = _by_stage(prev_broken, board, stage, prior_heights)
            closed = {row["code"] for row in selected}
            ladder = []
            for height in range(1, 7):
                count = sum(min(row["boards"], 6) == height for row in selected)
                # 首板组没有连板阶梯。连板组的二板仍以此前首板为分母。
                candidates = []
                if height > 1 and prev_up is not None and stage != "first":
                    candidates = [
                        row for row in _by_stage(prev_up, board, "all", None)
                        if min(row["boards"] + 1, 6) == height
                    ]
                ladder.append({"count": count, "promotion": None if not candidates else
                               _ratio(sum(row["code"] in closed for row in candidates), len(candidates))})
            drawdowns = [(row["close"] / row["limit_price"] - 1) * 100 for row in (failed or [])
                         if row.get("close") and row.get("limit_price")]
            values[f"{board}:{stage}"] = {
                "up": len(selected), "broken": None if failed is None else len(failed),
                "failure_rate": None if failed is None else _ratio(len(failed), len(failed) + len(selected)),
                "drawdown": _avg(drawdowns), "drawdown_sample": len(drawdowns),
                "highest": max((row["boards"] for row in selected), default=0),
                "up_premium": _coverage(previous_up, returns),
                "broken_premium": _coverage(previous_broken, returns), "ladder": ladder,
            }
    aggregate = values["all:all"]
    samples = (aggregate["up_premium"], aggregate["broken_premium"])
    complete = (
        broken is not None and prev_up is not None and prior_up is not None and aggregate["drawdown_sample"] == len(broken)
        and all(sample and sample["sample"] == sample["total"] for sample in samples)
    )
    return {"date": day, "values": values, "complete": complete}


def board_metrics_map(result, ctx):
    day = result["date"]
    evidence = [ev(ctx, "review_board_limit_up", row["up"], "只", day, as_of=day, record_key=scope)
                for scope, row in result["values"].items()]
    return out(evidence, extra=result, status="ok" if result["complete"] else "partial")
