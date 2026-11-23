"""Editorial hypotheses with same-day primary evidence and explicit counterexamples."""


def methods(cases, quotes, snapshots, archive):
    by_id = {c["id"]: c for c in cases}
    def card(identifier, title, date, stock, filename, premise, trigger, scope,
             predicate, expected, support, counter, evidence):
        quote = next(q for q in quotes if q["date"] == date)
        snap = next(s for s in snapshots if s["date"] == date[:10] and s["file"] == filename)
        path = "dump/imgs_deal/" + filename
        archive.getinfo(path)
        assert stock in [r["名称"] for r in snap["持仓"]]
        def measures(c):
            return {m["key"]: m["value"] for m in c["scene"]["metrics"]}
        cohort = [c for c in cases if predicate(c, measures(c))]
        known = [c for c in cohort if c["reveal"]["action"] != "unknown"]
        agree = sum(c["reveal"]["action"] == expected for c in known)
        result = (f"{scope}。按此规则覆盖 {len(cohort)} 日，可核定 {len(known)} 日，"
                  f"支持 {agree} 日，不支持 {len(known)-agree} 日，未知 {len(cohort)-len(known)} 日。")
        def example(day, supporting):
            case = by_id["tx-"+day]
            assert case in known and (case["reveal"]["action"] == expected) == supporting
            return dict(caseId=case["id"], note=f"{day} 收盘仓位 {case['positionPct']}%，{case['nextDate']} {case['reveal']['summary']}")
        return dict(id=identifier,title=title,quoteDate=quote["date"],principle=premise,
                    trigger=trigger,limits=result+" 条件为教学对照口径。成交无法说明当事人是否采用这一判断，也不能据此估计获利概率。",
                    support=example(support,True),counter=example(counter,False),
                    pairedEvidence=dict(date=date[:10],stock=stock,source=path,
                                        note=evidence+" 原帖与快照同日同标的；快照仅证实持有。"),
                    testResult=dict(total=len(cohort),known=len(known),support=agree,counter=len(known)-agree))
    return [
        card("plan","把计划和临时起意分开","2015-12-14 17:25","波导股份","2015-12-14_29_0.png",
             "他回看波导操作时写到，原本打算不买，实际仍买了。可以把盘前计划、触发条件和临场改变各写一行，复盘时分别核对。",
             "市场广度明显偏弱时，先给“等待”写一条可推翻的条件。对照命题：下跌家数超过上涨家数三倍时，次日不开新仓。",
             "选取收盘下跌家数超过上涨家数三倍的全部题目",lambda c,m:m["dn"]>3*m["up"],
             "no_open","2017-05-23","2017-06-01","自述点名波导反包失败，持仓快照记有波导股份。"),
        card("follow","题材判断要留下次日确认条件","2016-01-18 19:10","山鼎设计","2016-01-18_23_0.png",
             "谈到山鼎设计时，他把已经买入、次新股合力不足、明天还要观察分开表述。练习时先写群体表现，再写会让你放弃开仓的变化。",
             "昨天的强势股今天仍有正反馈时，观察跟随有多广。对照命题：昨日近涨停组今日平均涨幅达 5% 后，次日一定开新仓。",
             "选取昨日近涨停组当日平均涨幅至少 5% 的全部题目；指标衡量延续性，不指代山鼎设计所属题材",lambda c,m:m.get("premium",-100)>=5,
             "open","2017-05-16","2017-06-07","自述提到当日买入山鼎设计，并写下次日强弱条件，快照中确有该股。"),
        card("manage","已有持仓也需要单独做决定","2015-12-04 15:20","特力A","2015-12-04_15_0.png",
             "他复盘特力A时先交代继续持有，再解释尾盘价格与自己预期的偏差。学习时把“旧仓如何处理”和“是否增加新标的”分别作答。",
             "收盘已重仓时先检查旧仓约束。对照命题：已有仓位达到九成，下一日就不会再买入新标的。",
             "选取成交反推收盘仓位至少 90% 的全部题目；次日允许先卖旧仓再买新品种",lambda c,m:c["positionPct"]>=90,
             "no_open","2017-06-14","2017-05-22","自述明确提到特力A没出，收盘快照中有同名标的。")]


def execution_clock(cases, trades, states, archive):
    """Measure the earliest identifiable new-symbol buy per reconstructed open day."""
    import re
    from collections import Counter
    observations = {}
    groups = Counter()
    open_days = [c for c in cases if c["reveal"]["action"] == "open"]
    for case in open_days:
        existing = {r["代码"] for r in states[case["date"]]["持仓"]}
        candidates = [r for r in trades[case["nextDate"]] if r["side"] == "B" and r["code"] not in existing]
        timed = []
        for row in candidates:
            parts = [s.strip() for s in row["raw"].split("|")]
            times = [s for s in parts if re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d", s)]
            if len(times) == 1 and row["code"] in parts:
                timed.append((times[0], row["name"]))
        if not timed or len(timed) != len(candidates):
            continue
        when, stock = min(timed)
        group = ("auction" if when < "09:30:00" else "early" if when < "10:00:00"
                 else "late_am" if when < "12:00:00" else "pm")
        groups[group] += 1
        observations[case["id"]] = f"{case['nextDate']} 最早可核的新标的买入为 {stock}，成交于 {when}。"
    total, known = len(open_days), len(observations)
    early = groups["auction"] + groups["early"]
    basis = "dump/imgs_deal/2017-02-06__0.png"
    archive.getinfo(basis)
    return dict(id="execution-clock",title="第一次新开仓发生在几点",quoteDate="2017-02-06 22:22",
                principle=f"从已发生的新开仓往回看，{known} 个可核时间的日子里，{early} 天首次买入新标的发生在 10:00 前。"
                          f"其中竞价 {groups['auction']} 天、09:30 至 10:00 前 {groups['early']} 天、"
                          f"10:00 至午休前 {groups['late_am']} 天、午后 {groups['pm']} 天。",
                trigger="比较同样从空仓出发的新开仓日：首次买入可能靠近开盘，也可能到午后。记录自己是按计划执行，还是仅因看到了拉升而改变计划。",
                limits=f"从 2017 年 93 行交割单与期初持仓起算，只取题库中能逐日对账的 {total} 个新开仓日。"
                       f"同日多标的、多笔成交只计最早一笔；若任一新买行时刻含混，整日排除（{total-known} 日）。"
                       "本人对新亚制程的解释属于另一时期的当日晚间回忆，不能解释 2017 年四至七月其他交易，也不能从早盘买入频数推导明日出手时间。",
                support=dict(caseId="tx-2017-07-04",note=observations["tx-2017-07-04"]),
                counter=dict(caseId="tx-2017-07-12",note=observations["tx-2017-07-12"]),
                pairedEvidence=dict(date="2017-02-06",stock="新亚制程",source=basis,
                                    note="本人收盘后回忆，当日原拟空仓，午后看到新亚制程上涨后买入。同日快照解析可辨该名称，代码识别异常，未纳入成交时刻统计。"),
                testResult=dict(total=total,known=known,support=early,counter=known-early))
