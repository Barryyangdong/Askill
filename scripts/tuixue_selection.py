"""Compare actual new stock entries to the cross section observable at the previous close."""
from statistics import mean, median


def selection_profile(matrix, cases, trades, states):
    observed, controls = [], []
    total = 0
    for case in cases:
        if case["reveal"]["action"] != "open":
            continue
        day = case["date"]
        held = {position["代码"] for position in states[day]["持仓"]}
        opened = {trade["code"] for trade in trades[case["nextDate"]]
                  if trade["side"] == "B" and trade["code"] not in held}
        total += len(opened)
        universe = [history[day] for code, history in matrix.items() if day in history and code not in held]
        for code in sorted(opened):
            prior = matrix.get(code, {}).get(day)
            if prior is not None and universe:
                observed.append(prior)
                controls.append(universe)
    if not observed:
        raise ValueError("No point-in-time observations of new positions")
    metrics = []
    for label, predicate in [
        ("前一日上涨", lambda r: r > 0),
        ("前一日涨幅至少 5%", lambda r: r >= 5),
        ("前一日收盘近涨停", lambda r: 9.7 <= r <= 11.2),
    ]:
        count = sum(map(predicate, observed))
        reference = mean(sum(map(predicate, u)) / len(u) for u in controls)
        metrics.append(dict(label=label, value=f"{count}/{len(observed)}（{count / len(observed):.1%}）",
                            comparison=f"同时点行情样本 {reference:.1%}"))
    metrics.append(dict(label="前一日涨跌幅中位数", value=f"{median(observed):+.2f}%",
                        comparison=f"同时点横截面中位数均值 {mean(median(u) for u in controls):+.2f}%"))
    return dict(title="他新开的股票，上一日有多强？",
                scope=f"2017 年交割单中，同一开仓日、同一标的计一次。共 {total} 次新开仓，其中 {len(observed)} 次能核对前一交易日收盘涨跌幅。",
                metrics=metrics, interpretation="用每次买入之前已知的信息比较，基准取该日有行情且未持有的股票，再按开仓次数等权平均。集中度差异可以描述选股习惯；当日题材、买入动机与次日收益需要分别举证。",
                source="deals_2017_raw.json · position_states_all.json · pct_map.json。近涨停以 +9.7% 至 +11.2% 为代理；发行、停牌及退市样本覆盖受原始数据限制。")
