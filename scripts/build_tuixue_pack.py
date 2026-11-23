"""Build the reviewed Tuixue learning pack from allowlisted JSON archive members."""
import argparse
from collections import defaultdict
from datetime import date
import json
import re
from pathlib import Path
from zipfile import ZipFile
from evaluate_mentor_matches import evaluate
from tuixue_methods import methods, execution_clock
from tuixue_scene import extra_breadth, load_returns, scene
from tuixue_selection import selection_profile

QUOTE_DATES = {
    "2015-12-04 15:20", "2016-01-18 19:10", "2015-12-14 17:25", "2017-02-06 22:22", "2017-02-20 10:21", "2017-02-21 12:53",
    "2017-03-12 22:06", "2017-03-22 20:17", "2018-08-15 22:53",
}


def records(archive, name):
    member = archive.getinfo("dump/" + name + ".json")
    if member.file_size > 8_000_000:
        raise ValueError(f"Oversized member: {name}")
    return json.loads(archive.read(member))


def holdings(snapshot):
    return {r["代码"]: r["股数"] for r in snapshot["持仓"]}


def build(archive):
    images = {row["f"]: row["u"] for row in records(archive, "imgs_all/index")}
    posts = {image: {"title": row["listTitle"], "url": "https://www.tgb.cn" + row["href"]}
             for row in records(archive, "posts_imgs") if row["href"].startswith("/a/")
             for image in row.get("imgs", [])}
    trades = defaultdict(list)
    spans = defaultdict(list)
    for row in records(archive, "deals_2017_raw"):
        day = date.fromisoformat(row["date"]).isoformat()
        archive.getinfo("dump/imgs_all/" + row["src"])
        if row["side"] not in ("B", "S") or row["qty"] <= 0:
            raise ValueError("Invalid trade")
        trades[day].append(row)
        spans[row["src"]].append(day)
    states = {r["date"]: r for r in records(archive, "position_states_all")
              if r["src"] == "derived_2017" and not r["明细不全"]}
    days = sorted(r["d"] for r in records(archive, "index_daily")["sh000001"]["bars"])
    panel = records(archive, "sentiment_daily")
    matrix = load_returns(archive)
    ladders, premiums, members = extra_breadth(matrix, days, set(states))
    cases = []
    for day, target in zip(days, days[1:]):
        if day not in states or target not in states:
            continue
        state = states[day]
        start = holdings(state)
        end = start.copy()
        rows = trades[target]
        for r in rows:
            code = r["code"]
            end[code] = end.get(code, 0) + r["qty"] * (1 if r["side"] == "B" else -1)
        if {k: v for k, v in end.items() if v} != holdings(states[target]):
            continue
        new_names = sorted({r["name"] for r in rows if r["side"] == "B" and r["code"] not in start})
        # A negative observation requires a single statement page spanning
        # both boundaries of the target session, even on a day with no rows.
        covering = [file for file, dates in spans.items() if min(dates) < target < max(dates)]
        action = "open" if new_names else "no_open" if covering else "unknown"
        sources = []
        for row in rows:
            raw = [part.strip() for part in row["raw"].split("|")]
            times = [part for part in raw if re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d", part)]
            when = times[0] if len(times) == 1 and row["code"] in raw else "逐笔时间未分辨"
            operation = "证券买入" if row["side"] == "B" else "证券卖出"
            sources.append(f"交割单解析行 {target} {when} {row['name']} {operation} {row['qty']} 股，"
                           f"成交价 {row['price']:g} 元 · dump/imgs_all/{row['src']}")
        if action == "no_open":
            sources.append("覆盖该交易日的连续交割单页 · dump/imgs_all/" + covering[0])
        sources.append(f"期初持仓取自 dump/position_states_all.json 的 {day} 收盘成交反推记录")
        summary = ("记录中买入期初未持有的" + "、".join(new_names) + "。") if new_names else (
            "覆盖该日的交割单记录中未见买入期初未持有的标的。" if covering else "缺少跨越该交易日的连续交割单页，无法确认全天是否新开仓。")
        evidence = {r["src"] for r in rows}
        if action == "no_open":
            evidence.add(covering[0])
        post_links = {posts[images[f]]["url"]: posts[images[f]] for f in evidence}
        cases.append(dict(id="tx-" + day, date=day, nextDate=target,
                          prompt="结合市场广度、强势股延续性和已有仓位，下一交易日你会考虑新开仓吗？写下依据和改变判断的条件。",
                          scene=scene(day, panel[day], ladders[day], premiums[day], members[day]),
                          market={k: state["idx"][k] for k in ("pct", "d5", "d20")},
                          holdingCount=len(start), positionPct=state["仓位%"],
                          reveal=dict(action=action, summary=summary, sources=sources, sourcePosts=[post_links[u] for u in sorted(post_links)])))
    # 全部本人发言作为原话时间线：去掉图片占位和 [quote] 引用（那是别人的话），
    # 只保留退学自己说的部分；清洗后至少 10 字才算一条有效原话。
    def clean_quote(body: str) -> str:
        text = body.replace("［图片］", "").replace("[图片]", "")
        for marker in ("[quote]", "［quote］", "[Quote]"):
            text = text.split(marker)[0]
        return text.strip()
    quotes = [dict(date=r["date"], text=clean_quote(r["body"]),
                   source=f"{r['title']} · {r['floor']} 楼", url="https://www.tgb.cn/a/" + r["tid"])
              for r in records(archive, "corpus_final")
              if r["ownThread"] and len(clean_quote(r["body"])) >= 10]
    quotes.sort(key=lambda q: q["date"])
    # 方法卡引用特定日期的原话（QUOTE_DATES），扩充后这些锚点必须在，否则方法失效。
    missing = sorted(d for d in QUOTE_DATES if not any(q["date"] == d for q in quotes))
    if missing or not cases:
        raise ValueError("Unexpected source coverage, missing anchor quotes: " + ", ".join(missing))
    clock_card = execution_clock(cases, trades, states, archive)
    scored = evaluate(cases, "2017-07-01")
    validation = (f"2017 年 7 月按时间留出 {scored['test']} 个已知动作交易日。"
                  f"按上证指数 1、5、20 日涨跌幅，以 1、2、4 个百分点为差距上限，"
                  f"取最相似的三例多数表决（并列弃答），覆盖 {scored['decided']}/{scored['test']} 日，"
                  f"命中 {scored['correct']}/{scored['decided']}；"
                  f"同期采用训练期多数动作命中 {scored['baselineCorrectOnDecided']}/{scored['decided']}。")
    return dict(validationSummary=validation, id="tuixue", name="退学炒股", version="1.1",
                summary="从公开发言和 2017 年交割单学习开仓判断。题面仓位由历史成交反推；案例中的行为仅代表所收录的账户和区间。",
                behavior=selection_profile(matrix, cases, trades, states),
                methods=methods(cases, quotes, records(archive, "position_states_all"), archive) + [clock_card],
                quotes=sorted(quotes, key=lambda q: q["date"]), cases=cases)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "knowledge/mentors/tuixue.json")
    args = parser.parse_args()
    with ZipFile(args.archive) as archive:
        pack = build(archive)
    args.output.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")







