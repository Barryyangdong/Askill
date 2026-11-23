"""Point-in-time market conditions for Tuixue close-of-session lessons."""
from collections import Counter, defaultdict
import json
from statistics import mean


MISSING = [
    {"label": "盘中炸板与封板时刻", "reason": "材料没有全样本盘中触板、开板事件，收盘涨幅不能还原炸板率。"},
    {"label": "题材及板块排序", "reason": "缺少当时有效的题材成分和全体备选板块，个别标的自述不足以给板块排名。"},
    {"label": "两市成交额", "reason": "指数日线只有量字段和价格；没有同日两市成交金额。"},
    {"label": "交易所精确涨跌停与连板梯队", "reason": "缺少逐证券当日涨跌停价与 ST、新股等完整状态。下列阈值计数仅为代理。"},
]


def load_returns(archive):
    member = archive.getinfo("dump/pct_map.json")
    if member.file_size > 100_000_000:
        raise ValueError("Oversized return matrix")
    return json.loads(archive.read(member))

def extra_breadth(matrix, calendar, targets):
    ordinals = {day: i for i, day in enumerate(calendar)}
    counts = {d: Counter() for d in targets}
    premiums = {d: [] for d in targets}
    max_target = max(targets)
    members = {day: defaultdict(list) for day in targets}
    for code, returns in matrix.items():
        run = 0
        previous = None
        for k, day in enumerate(sorted(returns)):
            if day > max_target:
                break
            change = returns[day]
            session = ordinals.get(day)
            if session is None:
                run = 0
                previous = None
                continue
            consecutive = previous is not None and session == previous + 1
            if not consecutive:
                run = 0
            if day in targets and run:
                premiums[day].append(change)
            run = run + 1 if 9.7 <= change <= 11.2 else 0
            if day in targets and run and k >= 60:
                counts[day][min(run, 4)] += 1
                if run >= 2:
                    members[day][min(run, 4)].append((-run, code))
                counts[day]["max"] = max(counts[day]["max"], run)
            previous = session
    return counts, premiums, members


def scene(day, panel, ladder, premiums, members):
    metrics = []
    def add(key, label, value, unit, definition, file="sentiment_daily"):
        metrics.append(dict(key=key, label=label, value=value, unit=unit,
                            definition=definition, source=f"dump/{file}.json · {day} 收盘"))
    for key, label, desc in [
        ("n","样本覆盖","当天有涨跌幅记录的证券数。"),("up","上涨家数","样本收盘涨幅大于零。"),
        ("dn","下跌家数","样本收盘涨幅小于零。"),("zt","近涨停家数","收盘涨幅在 +9.7% 至 +11.2% 闭区间。"),
        ("dt","近跌停家数","收盘涨幅在 −11.2% 至 −9.7% 闭区间。"),
        ("big_up","大涨家数","样本收盘涨幅至少 +5%。"),("big_dn","大跌家数","样本收盘跌幅至少 5%。")]:
        add(key,label,panel[key],"家",desc)
    add("med","样本涨幅中位数",panel["med"],"%","当日有行情样本收盘涨跌幅中位数。")
    definition = "根据上证交易日日历，逐日连续收盘涨幅落在 +9.7% 至 +11.2%；停牌或缺日中断，当天此前至少有60条涨跌幅记录。"
    for k, label in enumerate(["一板近似","二板近似","三板近似","四板及以上近似"], 1):
        examples = [code for _, code in sorted(members[k])[:4]]
        detail = definition
        if k >= 2:
            detail += "当日样本代码：" + ("、".join(examples) if examples else "无") + "。"
        add(f"ladder{k}", label, ladder[k], "家", detail, "pct_map")
        if k >= 2:
            metrics[-1]["members"] = examples
    add("maxHeight","最高连续近涨停",ladder["max"],"天",definition,"pct_map")
    if premiums:
        add("premium","昨日近涨停组今日表现",round(mean(premiums),2),"%","上一市场交易日收盘近涨停、今日仍有行情的样本，今日涨跌幅等权均值。","pct_map")
    add("premiumN","溢价样本数",len(premiums),"家","上一交易日收盘近涨停且今日有行情。","pct_map")
    return dict(asOf=day+"T15:00:00+08:00", metrics=metrics, missing=MISSING)

