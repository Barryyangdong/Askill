// 情绪复盘 · 今日情绪：用 2026-10-09 收盘后真实取到的数（长列表截短）渲染，断言用户看得到什么。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { textOf, withRenderer } from "./helpers/render.ts";

const FX = JSON.parse(readFileSync(new URL("./fixtures/shortline-2026-10-09.json", import.meta.url), "utf8"));
const done = (result: unknown, extra: Record<string, unknown> = {}) => ({
  state: "done", status: "ok", result, why: "", settled: (result as { settled?: boolean } | null)?.settled ?? null, cached: false, fetched_at: null, ...extra,
});
const ALL = { emotion: done(FX.emotion), facts: done(FX.facts), themes: done(FX.themes), firstboard: done(FX.firstboard), cycle: done(FX.cycle), ladder: done(FX.ladder) };
const LOADING = { state: "loading" };

test("盘面展示同日题材摘要，长名单默认展开", async () => {
  await withRenderer(async r => {
    const { TodayTab } = await r.load("/src/verticals/finance/shortline/TodayTab.tsx");
    const { AiPageProvider } = await r.load("/src/core/ai/pageContext.tsx");
    const page = () => createElement(AiPageProvider, null, createElement(TodayTab, {
      panels: ALL, day: FX.date, onOpenThemes: () => undefined,
    }));
    const html = r.html(page, {});
    assert.match(html, /查看题材复盘/);
    assert.doesNotMatch(html, /<details(?![^>]*\bopen)[^>]*><summary[^>]*>(连板梯队|首板名单|行业分布|个股明细)/);
    for (const node of FX.themes.tree.themes) assert.ok(html.includes(node.tag));
    assert.match(html, /<h3[^>]*>连板天梯/);
    assert.equal((html.match(/<h3[^>]*>首板明细/g) ?? []).length, 1);
  });
});

test("各章节独立组织反馈、天梯首板、周期与风险，同一份完整明细仅出现一次", async () => {
  await withRenderer(async r => {
    const { TodayTab } = await r.load("/src/verticals/finance/shortline/TodayTab.tsx");
    const { AiPageProvider } = await r.load("/src/core/ai/pageContext.tsx");
    const section = (name: string) => r.html(() => createElement(AiPageProvider, null,
      createElement(TodayTab, { day: FX.date, panels: ALL, section: name })), {});
    const emotion = section("emotion");
    assert.match(emotion, /昨日强势股分板位反馈/);
    assert.doesNotMatch(emotion, /<h3[^>]*>(连板天梯|涨停池周期位置|首板明细)/);
    const relay = section("relay");
    assert.match(relay, /id="review-ladder"/);
    assert.equal((relay.match(/<h3[^>]*>首板明细/g) ?? []).length, 1);
    assert.doesNotMatch(relay, /<h3[^>]*>(晋级率|梯队结构|封板质量)/);
    assert.match(section("cycle"), /<h3[^>]*>涨停池周期位置/);
    assert.match(section("timing"), /<h3[^>]*>首封时段与行业分布/);
    assert.match(section("risk"), /<h3[^>]*>关键盘面事件/);
  });
});

test("昨日条件摘要能区分缺数、未设置、暂定和迟到的结果", async () => {
  await withRenderer(async r => {
    const { ReviewCheckSummary, ReviewCheckRows } = await r.load("/src/verticals/finance/shortline/ReviewCheckSummary.tsx");
    const initial = r.html(ReviewCheckSummary, {day: FX.date, refreshNonce: 0, onOpen: () => undefined});
    assert.match(initial, /<h3[^>]*>昨日条件验证/);
    assert.match(initial, /写下次日验证条件/);
    assert.doesNotMatch(initial, /正在读取/);
    const check = {available: true, set_date: "2026-10-08", date: FX.date, results: []};
    const retry = () => undefined;
    assert.match(textOf(r.html(ReviewCheckRows, {check, retry})), /2026-10-08 没有保存验证条件。 重新读取/);
    assert.match(textOf(r.html(ReviewCheckRows, {check: {available: false, reason: "缺上一交易日"}, retry})), /缺上一交易日 重新读取/);
    const result = {id:"a", label:"涨停家数", direction_label:"增加", actual_label:null, verified:null, cur_value:null, late:true};
    const rows = textOf(r.html(ReviewCheckRows, {check: {...check, provisional:true, results:[result]}, retry}));
    assert.match(rows, /结果暂定/);
    assert.match(rows, /涨停家数 预期 增加 实际 读数缺失 待核实 开盘竞价后记录，不计入统计/);
    const items = Array.from({length:5}, (_, i) => ({...result, id: String(i), label: `条件${i + 1}`}));
    const grouped = r.html(ReviewCheckRows, {check: {...check, results:items}, retry}).split(/<details open="">/);
    assert.match(textOf(grouped[0]!), /条件1.*条件2.*条件3/);
    assert.doesNotMatch(textOf(grouped[0]!), /条件4/);
    assert.match(textOf(grouped[1]!), /其余 2 条条件.*条件4.*条件5/);
  });
});

async function renderToday(panels: Record<string, unknown>, day: string | null = "2026-10-09") {
  return withRenderer(async (r) => {
    const { TodayTab } = await r.load("/src/verticals/finance/shortline/TodayTab.tsx");
    const { AiPageProvider } = await r.load("/src/core/ai/pageContext.tsx");
    const Page = () => createElement(AiPageProvider, null, createElement(TodayTab, { day, panels }));
    return textOf(r.html(Page, {}));
  });
}

test("今日情绪：四项读数、反馈矩阵、梯队断层、题材、首板都画出来，数字和真实数据一致", async () => {
  const t = await renderToday(ALL);
  assert.match(t, /复盘日 2026-10-09 ，对比前一交易日 2026-10-08/);
  assert.match(t, /涨停 \d+ 家\(前一交易日 \d+ 家\)/);
  // 赚钱效应：中位 +1.95%、翻红率 63%（0.628）、样本 43 只
  assert.match(t, /昨日涨停股表现/);
  assert.match(t, /\+1\.95%/);
  assert.match(t, /63%/);
  // 梯队：最高 9 板，3/6/7/8 板缺档要标出来，不是画成 0
  for (const b of [3, 6, 7, 8]) assert.match(t, new RegExp(`${b}板 缺`), `${b} 板缺档没标`);
  assert.doesNotMatch(t, /9板 缺/);
  // 反馈矩阵：首板排第一，晋级率 24%
  assert.match(t, /昨日身份 晋级涨停 收红 小跌 跌超5% 跌停 晋级率 首板 \(33\) 8 12 11 1 1 24% 2板 \(3\)/, "反馈矩阵首板排第一");
  assert.match(t, /个股明细\(10 只,按当天表现从差到好\) 彩蝶实业/, "明细从最差的排起");
  // 封板质量两半互补、炸板率口径
  assert.match(t, /43 \+ 26 = 当天涨停 69 家/);
  // 题材事件树与首板名单
  assert.match(t, /固态电池/);
  assert.match(t, /延续/);
  assert.match(t, /远程股份/);
  assert.match(t, /09:31/);
  assert.match(t, /新华文轩[\s\S]{0,40}反包/);
  // 已收盘的一天不出「还没收盘」提示
  assert.doesNotMatch(t, /还没收盘/);
});

test("今日情绪：还在取的块写「加载中」，没取到的块写原因、并说明不代表没有；其他块照常显示", async () => {
  const loading = await renderToday({ ...ALL, facts: LOADING, themes: LOADING, firstboard: LOADING, cycle: LOADING, ladder: LOADING });
  assert.match(loading, /连板天梯加载中…/);
  assert.match(loading, /昨日涨停股表现/);
  assert.match(loading, /昨日强势股分板位反馈加载中…/);
  assert.match(loading, /题材事件树加载中…/);
  assert.match(loading, /首板明细加载中…/);

  const failed = await renderToday({ ...ALL, facts: done(null, { status: "failed", why: "东财接口 502" }) });
  assert.match(failed, /昨日强势股分板位反馈 这次没取到:东财接口 502。不代表没有/);
  assert.match(failed, /昨日涨停股表现/, "其他块照常显示");
  assert.match(failed, /远程股份/);

  const none = await renderToday({ emotion: LOADING, facts: LOADING, themes: LOADING, firstboard: LOADING, cycle: LOADING, ladder: LOADING }, null);
  assert.match(none, /昨日强势股今日表现加载中…/);
  assert.doesNotMatch(none, /复盘日/, "没拿到业务日就不写日期");
});

test("今日情绪：没收盘的一天要提示数字还会变；单项没算出来写原因", async () => {
  const live = { ...FX.emotion, settled: false, consec_premium: { available: false, reason: "昨日没有 2 板以上的股票" } };
  const t = await renderToday({ ...ALL, emotion: done(live) });
  assert.match(t, /未结算/);
  assert.match(t, /昨日没有 2 板以上的股票/);
});

const lvl = (b: number) => FX.ladder.ladder.levels.find((l: { boards: number }) => l.boards === b);

test("连板天梯按板位展开，封板卡依次展示时间、股票与题材，断板卡保留涨跌和去向", async () => {
  const t = await renderToday(ALL);
  const at = (re: RegExp) => t.search(re);
  assert.ok(at(/昨日涨停股表现/) < at(/昨日身份/) && at(/昨日身份/) < at(/连板天梯/), "昨日收益与分板位反馈 → 连板天梯");
  assert.match(t, /涨停 69 家 连板 12 只 最高 9 板 晋级对比 2026-10-08/);
  assert.match(t, /9板 1 只 8进9 1\/1 · 100% 09:25 新华传媒 拟收购财联社/);
  // 和情绪四项的晋级率对得上:1进2 8/33、2进3 0/3,3 板以上合计 4/7(1/1 + 2/2 + 1/4)
  assert.match(t, /1进2 8\/33 · 24%/);
  assert.match(t, /3板 0 只 2进3 0\/3 · 0% 这一层今天没有涨停的。/);
  const pr = FX.emotion.promotion.tiers;
  assert.deepEqual([lvl(2).promoted, lvl(2).base], [pr["1进2"].promoted, pr["1进2"].base]);
  assert.deepEqual([lvl(3).promoted, lvl(3).base], [pr["2进3"].promoted, pr["2进3"].base]);
  assert.deepEqual([4, 5, 9].reduce((a, b) => [a[0]! + lvl(b).promoted, a[1]! + lvl(b).base], [0, 0]), [pr["3板以上晋级"].promoted, pr["3板以上晋级"].base]);
  assert.match(t, /没接上 3 只\(炸板 1 · 没涨停 2\) \+9\.57% 上海洗霸 没涨停 \+2\.16% 园林股份 炸板 -1\.45% 传艺科技 没涨停/);
  assert.match(t, /没接上 8 只\(跌停 1 · 炸板 2 · 没涨停 5\)/);
  assert.match(t, /收起/);
  assert.match(t, /彩蝶实业 跌停/);
  assert.match(t, /首板 4 只 首板明细 .*?远程股份 .*?09:31/);
  assert.match(t, /主要题材 .*电线电缆 \d+/);
});

test("连板天梯:反包标「N天M板」;前一天池子没取到时不写晋级、写明原因;整块没取到写原因", async () => {
  const L = FX.ladder;
  const reb = structuredClone(L);
  const four = reb.ladder.levels.find((l: { boards: number }) => l.boards === 4);
  four.stocks[0] = { ...four.stocks[0], label: "5天4板", rebound: true, broken_times: 2, board: "20cm" };
  const t1 = await renderToday({ ...ALL, ladder: done(reb) });
  assert.match(t1, /09:\d\d 20cm 炸2 .*?5天4板/);

  const noPrev = structuredClone(L);
  noPrev.ladder.prev_available = false;
  noPrev.ladder.prev_note = "前一交易日 2026-10-08 的涨停池没取到：没接上的票和晋级数没法算";
  for (const l of noPrev.ladder.levels) Object.assign(l, { base: null, promoted: null, rate: null, fell: [] });
  const t2 = await renderToday({ ...ALL, ladder: done(noPrev) });
  assert.match(t2, /前一交易日 2026-10-08 的涨停池没取到：没接上的票和晋级数没法算:只列今天各层的名单/);
  assert.match(t2, /昨天的池子没取到,晋级算不了/);
  const ladderPart = t2.slice(t2.indexOf("连板天梯"), t2.indexOf("封板质量", t2.indexOf("连板天梯")));
  assert.doesNotMatch(ladderPart, /\d进\d+ \d/, "天梯里不写 x/y(上面晋级率卡片照常)");
  assert.match(t2, /新华传媒/, "名单照常列");

  const off = await renderToday({ ...ALL, ladder: done({ date: "2026-10-09", prev_date: "2026-10-08", ladder: { available: false, reason: "2026-10-09 涨停池或炸板 / 跌停池没取到(或当天涨停池为空)" } }) });
  assert.match(off, /连板天梯没取到:2026-10-09 涨停池或炸板/);
  assert.match(off, /昨日涨停股表现/, "其他块照常显示");
  await withRenderer(async (r) => {
    const { ladderSummary } = await r.load("/src/verticals/finance/shortline/BoardLadderPanel.tsx");
    const s2 = ladderSummary(noPrev);
    assert.match(s2, /前一交易日涨停池没取到\(前一交易日 2026-10-08/);
    assert.doesNotMatch(s2, /\d进\d+ \d/);
    const noReason = structuredClone(L);
    Object.assign(noReason.ladder, { reason_available: false, reason_note: "同花顺涨停揭秘没回" });
    assert.match(ladderSummary(noReason), /涨停原因没取到\(同花顺涨停揭秘没回\)/);
    // 原因串取到了、个别沪深票没有原因:说出来;北交所同花顺不收录,不写「没取到」
    const someNoReason = structuredClone(L);
    someNoReason.ladder.reason_missing = ["600003"];
    assert.match(ladderSummary(someNoReason), /1 只沪深涨停股没有涨停原因\(600003\),它们没算进题材/);
    assert.doesNotMatch(ladderSummary(L), /沪深涨停股没有涨停原因/);
    const two = someNoReason.ladder.levels.find((l: { boards: number }) => l.boards === 2);
    two.stocks.push({ ...two.stocks[0], code: "920111", name: "北交股", board: "北交所", reason: "", tags: [] });
    const { BoardLadderPanel } = await r.load("/src/verticals/finance/shortline/BoardLadderPanel.tsx");
    const html = r.html(BoardLadderPanel, { r: someNoReason });
    assert.match(textOf(html), /;1 只沪深涨停股没有原因/);
    assert.match(html, /涨停原因:同花顺不收录北交所/);
    assert.doesNotMatch(html, /涨停原因:没取到/);
  });
});

test("给 AI 的文字：读数照抄、缺口明说（还在取 / 没取到不代表是零），梯队写缺档", async () => {
  await withRenderer(async (r) => {
    const { todaySummary } = await r.load("/src/verticals/finance/shortline/summary.ts");
    const all = todaySummary("2026-10-09", ALL);
    assert.match(all, /^复盘日 2026-10-09\(对比前一交易日 2026-10-08\);已收盘定稿。/);
    assert.match(all, /赚钱效应\(昨日涨停股当天收盘对收盘\):中位 \+1\.95%/);
    assert.match(all, /9板×1 .*3板缺/);
    assert.match(all, /昨日强势股反馈:首板\(33\)/, "首板排第一");
    assert.match(all, /固态电池\[延续\]/);
    assert.match(all, /首板 57 家/);

    // 连板天梯:每层名单 + 晋级(和晋级率同口径)+ 没接上的去向
    assert.match(all, /连板天梯\(东财连板数分层/);
    assert.match(all, /9板 1 只\(8进9 1\/1 · 100%\):新华传媒\(拟收购财联社、重大资产重组\)/);
    assert.match(all, /4板 1 只\(3进4 1\/4 · 25%\):.*没接上 3 只\(炸板 1 · 没涨停 2\):上海洗霸没涨停\+9\.57%/);
    assert.match(all, /3板 0 只\(2进3 0\/3 · 0%\):无/);

    const gaps = todaySummary("2026-10-09", { ...ALL, facts: { state: "loading" }, cycle: done(null, { status: "failed", why: "超时" }), ladder: { state: "loading" } });
    assert.match(gaps, /连板天梯:还在取,先别据此下结论/);
    assert.match(gaps, /盘面事实:还在取,先别据此下结论/);
    assert.match(gaps, /情绪周期:这次没取到\(超时\),不代表是零/);
    assert.doesNotMatch(gaps, /封板质量/);
  });
});

test("页面块 → 面板：结果取 extra.result；failed 的结果作废只留原因；报错去掉异常类名", async () => {
  await withRenderer(async (r) => {
    const { panelOf, cleanReason } = await r.load("/src/verticals/finance/shortline/api.ts");
    const base = { id: "facts", title: "", note: "", fetched_at: "2026-10-09T08:00:00Z", cached: true, error: null, via_fallback: false, fallback_error: null };
    const ok = panelOf({ ...base, status: "ok", envelope: { extra: { result: FX.facts } } });
    assert.equal(ok.result.date, "2026-10-09");
    assert.equal(ok.settled, true);
    assert.equal(ok.cached, true);
    const partial = panelOf({ ...base, status: "partial", envelope: { extra: { result: { ...FX.facts, settled: false } } } });
    assert.equal(partial.settled, false, "partial 也用结果");
    const bad = panelOf({ ...base, status: "failed", error: "DataNotAvailable: 2026-10-04 不是交易日", envelope: { extra: { result: FX.facts } } });
    assert.equal(bad.result, null, "failed 的结果不能拿来画");
    assert.equal(bad.why, "2026-10-04 不是交易日");
    const envReason = panelOf({ ...base, status: "missing", envelope: { missing: [{ reason: "TimeoutError: 东财 30 秒没回" }] } });
    assert.equal(envReason.why, "东财 30 秒没回");
    assert.equal(panelOf(undefined).why, "这一块没有返回");
    assert.equal(cleanReason("RuntimeError: 来源坏了"), "来源坏了");
    assert.equal(cleanReason("2026-10-04 不是交易日"), "2026-10-04 不是交易日", "没有类名的原样保留");
  });
});

test("亏钱效应口径:跌停制度写出两次改制的日期,和取数层算跌停用的是同一组日期(审计 3.12)", async () => {
  const py = readFileSync(new URL("../../.agents/skills/data-access/scripts/sources/shortline.py", import.meta.url), "utf8");
  const st = py.match(/^ST_10PCT_FROM = "(\d{4}-\d{2}-\d{2})"/m)?.[1];
  const gem = py.match(/^CHINEXT_20PCT_FROM = "(\d{4}-\d{2}-\d{2})"/m)?.[1];
  assert.ok(st && gem, "取数层的两个生效日期还在");
  await withRenderer(async (r) => {
    const { LIMIT_RULES_TEXT } = await r.load("/src/verticals/finance/shortline/FactsPanels.tsx");
    assert.ok(LIMIT_RULES_TEXT.includes(`主板 ST ${st} 起 10%、之前 5%`), "主板 ST 改 10% 之后再看,不能还说 5%");
    assert.ok(LIMIT_RULES_TEXT.includes(`创业板 ${gem} 起 20%、之前 10%`), "看改制前的创业板日期,不能一律说 20%");
    assert.doesNotMatch(LIMIT_RULES_TEXT, /创业科创 20%|ST 主板 5%/, "旧的不分日期说法不留");
  });
  const panels = readFileSync(new URL("../src/verticals/finance/shortline/FactsPanels.tsx", import.meta.url), "utf8");
  assert.match(panels, /caliber=\{"样本 = 昨日涨停池全部个股,收盘对收盘。\\n" \+[\s\S]{0,200}LIMIT_RULES_TEXT \+ "\\n" \+/, "亏钱效应的口径说明用的就是这段");
});

test("窄屏摘要显示同日关键值、负数和缺失占位，并保留完整统计", async () => {
  const emotion = structuredClone(FX.emotion);
  emotion.money_effect.median = -2.35;
  emotion.promotion.overall.rate = null;
  const t = await renderToday({ ...ALL, emotion: done(emotion) });
  assert.match(t, /同日涨停 69 家/);
  assert.match(t, /整体晋级率 —/);
  assert.match(t, /昨日涨停反馈中位数 -2\.35%/);
  assert.match(t, /最高板 9 板/);
  assert.doesNotMatch(t, /展开情绪四项与口径/);
  assert.match(t, /昨日涨停股表现/);
  assert.match(t, /3板 缺/);
});


test("嵌入复盘主页不重复当前日期，但保留比较日、核心读数与错日提示",async()=>{
 await withRenderer(async r=>{
  const {TodayTab}=await r.load('/src/verticals/finance/shortline/TodayTab.tsx');
  const {AiPageProvider}=await r.load('/src/core/ai/pageContext.tsx');
  const render=(day:string)=>textOf(r.html(()=>createElement(AiPageProvider,null,createElement(TodayTab,{day,panels:ALL,showDate:false})),{}));
  const text=render('2026-10-09');assert.doesNotMatch(text,/复盘日 2026-10-09/);assert.match(text,/对比前一交易日 2026-10-08/);
  for(const title of ['昨日涨停股表现','晋级率','昨日连板股溢价','3板 缺','连板天梯'])assert.ok(text.includes(title));
  assert.match(render('2026-10-08'),/复盘日 2026-10-09/);
 });
});
