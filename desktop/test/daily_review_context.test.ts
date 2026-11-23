import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createElement } from "react";
import { withRenderer, textOf } from "./helpers/render.ts";
import ts from "typescript";
import { api } from "../src/verticals/finance/lib/api.ts";
import { readDailyIndices, readDailyMarket, readDailyTiers } from "../src/verticals/finance/lib/dailyReviewData.ts";
import { chatStream } from "../src/verticals/finance/lib/llm.ts";
import { backend } from "../src/verticals/finance/lib/backend.ts";
import { TIER_PROMPT_RULES, tiersSummary } from "../src/verticals/finance/lib/reviewTiers.ts";
import { parseReview, reviewLines } from "../src/verticals/finance/lib/marketReview.ts";
import { loadMarketOverview, peekMarketOverview } from "../src/verticals/finance/lib/dailyMarketOverview.ts";
import { readHistoricalBreadth, peekHistoricalBreadth } from "../src/verticals/finance/lib/historicalBreadth.ts";
import { historicalFlow, historicalTurnover } from "../src/verticals/finance/lib/historicalFunds.ts";

test("全球指数失败进入可见状态与 AI 摘要，不静默消失", async (t) => {
  const text = fs.readFileSync(new URL("../src/verticals/finance/pages/DailyReview.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile("DailyReview.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const expressions = new Map<string, ts.Expression>();
  function visit(n: ts.Node): void {
    if (ts.isVariableDeclaration(n) && n.initializer) expressions.set(n.name.getText(source), n.initializer);
    ts.forEachChild(n, visit);
  }
  visit(source);
  const compile = (name: string) => ts.transpileModule(`(${expressions.get(name)!.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let globalErr: string | null = null;
  let globalDone = false;
  let pageMeta: unknown = { business_date: "2026-09-03" };
  let requests = 0;
  const pageOpts: unknown[] = [];
  let releasePage!: (v: { blocks: never[] }) => void;
  const pagePromise = new Promise<{ blocks: never[] }>(resolve => { releasePage = resolve; });
  t.mock.method(api, "globalIndices", async () => { throw new Error("全球指数未接入"); });
  t.mock.method(backend, "page", (_q: string, opts: unknown) => { requests++; pageOpts.push(opts); return pagePromise; });
  const fetchingRef = { current: false };
  const noop = () => {};
  const load = vm.runInNewContext(compile("loadPage"), {
    Error, String, Promise,
    fetchingRef, forceTiers: {current:false}, reviewLoading: false, mode: "live", overview: false, standalone: true, archived: undefined, fullQuery: "market_snapshot", selectedDay: undefined,
    readDailyIndices, readDailyMarket, peekDailyMarket: () => undefined,
    setGlobalIdx: noop,
    setGlobalDone: (v: boolean) => { globalDone = v; }, setGlobalErr: (v: string | null) => { globalErr = v; },
    setPageErr: noop, setPageMeta: (v: unknown) => { pageMeta = v; }, setOvDone: noop,
  }) as (refresh?: boolean, view?: string) => Promise<void>;
  const first = load();
  assert.equal(pageMeta, null, "刷新开始必须撤下旧业务日，不能等新请求返回才清理");
  await load();
  assert.equal(requests, 1, "前一轮尚未结束时重复刷新不能叠加请求");
  releasePage({ blocks: [] });
  await first;
  assert.equal(fetchingRef.current, false, "各请求结束后可以重新刷新");
  assert.equal(JSON.stringify(pageOpts[0]), JSON.stringify({ mode: "live" }), "默认看今天:盘中打开就是此刻的市场");
  await load(true, "close");
  assert.equal(JSON.stringify(pageOpts[1]), JSON.stringify({ refresh: true }), "切到上一个交易日 = 不带 mode;刷新带 refresh");
  assert.equal(globalDone, true);
  assert.match(globalErr!, /全球指数未接入/);
  const summaryCtx = {
    overview: false, standalone: true, pageMeta: null, globalIdx: [], globalErr, globalDone, dataReady: true, ovDone: true, pageErr: null,
    ctx: undefined, R: parseReview(null), reviewLines, bizDay: null, tiers: null, tiersErr: "", tiersSummary,
  };
  const summary = vm.runInNewContext(compile("dataSummary"), summaryCtx);
  assert.match(summary, /【海外指数】.*未接入/);
  assert.match(summary, /【缺口】这一屏没取到/, "整屏没取到要写缺口,不能留空");

  // 有这一屏时:各块的事实行 + 没取到的块写缺口 + 换了备源的块写口径
  const meta = {
    query: "review", title: "每日复盘", mixed_ages: false,
    context: { review_date: "2026-10-08", review_reason: "收盘后", session_phase: "closed", live: false, live_available: false, realtime_matches_review_day: true },
    blocks: [
      { id: "margin", title: "两融余额", status: "failed", error: "上交所接口超时" },
      { id: "board_flow", title: "板块资金", status: "ok", note: "净额口径", via_fallback: { note: "东财没取到,换新浪行业资金流", primary_status: "failed" },
        envelope: { status: "ok", evidence: [] } },
    ],
  };
  const s2 = vm.runInNewContext(compile("dataSummary"), { ...summaryCtx, pageMeta: meta, ctx: meta.context, R: parseReview(meta as never), bizDay: "2026-10-08" });
  assert.match(s2, /【业务日】2026-10-08/);
  assert.match(s2, /【缺口】两融余额 这次没取到/);
  assert.match(s2, /【备用来源·板块资金】东财没取到,换新浪/);
  assert.match(s2, /【读法·板块资金】净额口径/);
  assert.doesNotMatch(text, /\{globalIdx\.length > 0 &&\s*\(/, "面板不再以有数据为显示前提；状态标签仍可以检查数据是否为空");
});

test("复盘按钮通过真实 chatStream 发出一次页面数据，并保留业务日、缺口与读法", async () => {
  // 执行页面本身的回调，避免在测试中重抄一份提示词而掩盖调用方回归。
  const source = ts.createSourceFile("DailyReview.tsx", fs.readFileSync(new URL(
    "../src/verticals/finance/pages/DailyReview.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const callbacks: ts.Expression[] = [];
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "runReview" && node.initializer) callbacks.push(node.initializer);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(callbacks.length, 1);
  const compiled = ts.transpileModule(`(${callbacks[0]!.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const summary = "业务日：2026-09-04\n上涨：1234家\n【缺口】资金流未取到\n【读法·行情】样本范围受限";
  const messages: string[] = [];
  const errors: unknown[] = [];
  const loading: boolean[] = [];
  const days: unknown[] = [];
  const original = backend.chat;
  backend.chat = async (message) => {
    messages.push(message);
    return { reply: "客观复盘", redacted: 0 } as Awaited<ReturnType<typeof backend.chat>>;
  };
  try {
    const run = vm.runInNewContext(compiled, {
      dataSummary: summary, hasLlm: () => true, chatStream, TIER_PROMPT_RULES,
      dataReady: true, fetchingRef: { current: false }, reviewLoading: false,
      setReviewErr: (error: unknown) => errors.push(error), setNeedConfig: () => {},
      setReviewLoading: (value: boolean) => loading.push(value), setReview: () => {},
      bizDay: "2026-10-09", setReviewDay: (d: unknown) => days.push(d),
    }) as () => Promise<void>;
    await run();
    assert.deepEqual(errors, [null]);
    assert.deepEqual(loading, [true, false]);
    assert.deepEqual(days, ["2026-10-09"], "记下这份复盘按哪个业务日写的");
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.split(summary).length - 1, 1, "页面摘要在最终消息里只能出现一次");
    assert.match(messages[0]!, /不要就它下任何结论/);
    assert.match(messages[0]!, /引用数字时带上它的读法护栏/);
    assert.equal(messages[0]!.split(TIER_PROMPT_RULES).length - 1, 1, "分档顺序和写法要求在提示词里");
  } finally { backend.chat = original; }
});

test("加载中或刷新当帧不能发起复盘；全部结束后可分析带缺口的快照", async () => {
  const text = fs.readFileSync(new URL("../src/verticals/finance/pages/DailyReview.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile("DailyReview.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const expressions = new Map<string, ts.Expression>();
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && node.initializer) expressions.set(node.name.getText(source), node.initializer);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const compile = (key: string) => ts.transpileModule(`(${expressions.get(key)!.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [dataReady, fetching, reviewing] of [[false, true, false], [true, true, false], [true, false, true], [true, false, false]]) {
    let sent = 0;
    const noop = () => {};
    const run = vm.runInNewContext(compile("runReview"), {
      dataReady, fetchingRef: { current: fetching }, reviewLoading: reviewing,
      hasLlm: () => true, dataSummary: "【缺口】资金未取得", chatStream: async () => { sent++; }, TIER_PROMPT_RULES,
      setReviewErr: noop, setNeedConfig: noop, setReviewLoading: noop, setReview: noop, bizDay: "2026-10-09", setReviewDay: noop,
    }) as () => Promise<void>;
    await run();
    assert.equal(sent, dataReady && !fetching && !reviewing ? 1 : 0);
  }
  const flags = { globalDone: true, ovDone: true, tiersReady: true };
  for (const key of Object.keys(flags)) {
    assert.equal(vm.runInNewContext(compile("dataReady"), { ...flags, [key]: false }), false, key);
  }
  assert.equal(vm.runInNewContext(compile("dataReady"), flags), true);
  // 分档:有业务日时等那一天的取完;业务日没拿到时跟着页面那块走
  const tr = (ctx: Record<string, unknown>) => vm.runInNewContext(compile("tiersReady"), ctx);
  assert.equal(tr({ bizDay: "2026-10-08", tiersFor: "2026-10-08", ovDone: true }), true);
  assert.equal(tr({ bizDay: "2026-10-08", tiersFor: "2026-09-30", ovDone: true }), false, "上一轮别的日子的分档不算");
  assert.equal(tr({ bizDay: "2026-10-08", tiersFor: null, ovDone: true }), false);
  assert.equal(tr({ bizDay: null, tiersFor: null, ovDone: true }), true);
  assert.equal(tr({ bizDay: null, tiersFor: null, ovDone: false }), false);
  assert.match(text, /disabled=\{reviewLoading \|\| !dataReady\}/);
});

test("回访每日复盘按模式与业务日复用，海外行情独立过期，强刷与失败可重试", async t => {
  let now = Date.parse("2026-11-19T19:00:00+08:00");
  t.mock.method(Date, "now", () => now);
  const market = t.mock.method(backend, "page", async (_query: string, opts: unknown) => ({
    context: { review_date: "2026-11-19", session_phase: "post_close", live_available: false },
    blocks: [{ status: "ok" }], options: opts,
  }));
  const indices = t.mock.method(api, "globalIndices", async () => [{ price: 100, change_pct: 0 }]);
  let gap = false;
  const tiers = t.mock.method(backend, "reviewTiers", async ({date}: {date: string}) => ({
    date, total: gap ? null : 1, groups: gap ? [] : [{ stocks: [{ symbol: "600001" }] }], gaps: gap ? ["未取得"] : [],
  }));
  const visit = () => Promise.all([
    readDailyMarket("live", false), readDailyIndices(false), readDailyTiers("2026-11-18", false),
  ]);
  await Promise.all([visit(), visit()]);
  await visit();
  const counts = () => [market.mock.callCount(), indices.mock.callCount(), tiers.mock.callCount()];
  assert.deepEqual(counts(), [1, 1, 1]);
  now += 31_000;
  await visit();
  assert.deepEqual(counts(), [1, 2, 1]);
  await readDailyMarket("close", false);
  await readDailyMarket("live", true);
  await readDailyIndices(true);
  await readDailyTiers("2026-11-17", false);
  assert.deepEqual(counts(), [3, 3, 2]);
  gap = true;
  await readDailyTiers("2026-11-18", true);
  gap = false;
  await readDailyTiers("2026-11-18", false);
  assert.equal(tiers.mock.callCount(), 4);
  assert.deepEqual(tiers.mock.calls[2]?.arguments[0], {date:"2026-11-18", refresh:true});
  now = Date.parse("2026-11-20T00:00:01+08:00");
  await visit();
  assert.deepEqual(counts(), [4, 4, 5]);
});

test("历史分档保留题材缺口与可用明细五分钟，没有明细时下次进入直接重试", async t => {
  let now = Date.parse("2026-11-19T17:30:00+08:00");
  t.mock.method(Date, "now", () => now);
  const date = "2026-11-16";
  const gaps = ["同花顺题材标签没取到,只按东财行业分"];
  let groups = [{ stocks: [{ symbol: "600001" }] }];
  const tiers = t.mock.method(backend, "reviewTiers", async () => ({ date, total: 1, groups, gaps }));
  const first = await readDailyTiers(date, false);
  assert.deepEqual(first.gaps, gaps);
  now += 299_999;
  assert.equal(await readDailyTiers(date, false), first);
  assert.equal(tiers.mock.callCount(), 1);
  now += 1;
  groups = [];
  await readDailyTiers(date, false);
  assert.equal(tiers.mock.callCount(), 2);
  await readDailyTiers(date, false);
  assert.equal(tiers.mock.callCount(), 3);
});

test("盘面、市场解读与实时快照有各自入口；历史日期只展示可按日读取的内容", async () => {
  await withRenderer(async r => {
    const { MarketOverview, MarketInterpretation, DailyReview } = await r.load("/src/verticals/finance/pages/DailyReview.tsx");
    const { AiPageProvider } = await r.load("/src/core/ai/pageContext.tsx");
    const { MemoryRouter } = await r.load("react-router-dom");
    const render = (View: typeof MarketOverview, day = "2026-10-16") => r.html(() => createElement(MemoryRouter, {},
      createElement(AiPageProvider, {}, createElement(View, {day, recentDay: "2026-10-16", refreshNonce: 0}))), {});
    for (const day of ["2026-10-16", "2026-10-09"]) {
      const ids: string[] = [];
      const html = r.html(() => createElement(MemoryRouter, {},
        createElement(AiPageProvider, {}, createElement(MarketOverview, {
          day, recentDay: "2026-10-16", refreshNonce: 0,
          renderSection: (id: string, content: unknown) => { ids.push(id); return content; },
          relayDetails: () => "天梯插入点", themeTiming: "首封时段插入点",
        }))), {});
      assert.deepEqual(ids, ["market", "emotion", "relay", "themes", "risk", "background"]);
      assert.ok(html.includes('href="#review-ladder"'));
      const words = textOf(html);
      for (const [before, after] of [["天梯插入点", "炸板池"], ["首封时段插入点", "个股成交额前 20"]]) {
        assert.ok(words.indexOf(before) >= 0 && words.indexOf(before) < words.indexOf(after));
      }
    }
    const overview = textOf(render(MarketOverview));
    assert.match(overview, /市场状态/);
    assert.match(overview, /主要指数/);
    assert.match(overview, /龙虎榜/);
    const overviewHtml = render(MarketOverview);
    assert.equal((overviewHtml.match(/<details open=""/g) ?? []).length >= 3, true);
    assert.match(overview, /全球指数暂无该复盘日的收盘归档/);
    assert.doesNotMatch(overview, /全球市场快照/);
    assert.doesNotMatch(overview, /让 Agent 复盘|市场解读/);
    const report = textOf(render(MarketInterpretation));
    assert.match(report, /市场解读/);
    assert.doesNotMatch(report, /连板高度|主要指数的中长期位置/);
    const past = textOf(render(MarketOverview, "2026-10-09"));
    assert.match(past, /2026-10-09/);
    assert.match(past, /涨停行业分布/);
    assert.match(past, /收盘涨跌分布/);
    assert.match(past, /行业资金/);
    assert.match(past, /个股成交额前 20/);
    assert.doesNotMatch(past, /全球市场快照|市场状态/);
    const pastReport = render(MarketInterpretation, "2026-10-09");
    assert.doesNotMatch(pastReport, /<button/);
    assert.match(pastReport, /缺少生成市场报告所需/);
    assert.match(textOf(render(DailyReview)), /市场快照/);
    for (const recentDay of [undefined, "2026-10-16"]) {
      const defaultView = textOf(r.html(() => createElement(MemoryRouter, {},
        createElement(AiPageProvider, {}, createElement(MarketOverview, {recentDay, refreshNonce: 0}))), {}));
      assert.match(defaultView, /市场状态/);
      assert.doesNotMatch(defaultView, /完整市场快照暂不可用/);
    }
  });
});

test("独立历史盘面并行查询两个所选日榜单，一项失败可重试；另一项复用同日样本", async t => {
  const day = "2026-11-10";
  let period = "2026-11-09";
  const fetch = t.mock.method(backend, "fetch", async (id: string) => {
    const flow = id === "cn_review_industry_close";
    const evidence = flow
      ? [{period, record_key: "board|8080", note: "电子 排名 1", field: "board_net_sw_close", value: 60000000}]
      : [{period: day, record_key: "stock|300750", note: "宁德时代(300750)", field: "turnover_amount", value: 360000000},
         {period: day, record_key: "stock|300750", note: "宁德时代(300750)", field: "close", value: 200}];
    return {envelope: {extra: {date: day}, status: "ok", evidence}};
  });
  const [industry, turnover] = await Promise.allSettled([historicalFlow.read(day, false), historicalTurnover.read(day, false)]);
  assert.equal(industry.status, "rejected");
  assert.equal(turnover.status, "fulfilled");
  assert.deepEqual(fetch.mock.calls.map(c => c.arguments), [
    ["cn_review_industry_close", {args: {date: day}}], ["cn_shortline_turnover_top", {args: {top: 20, date: day}}],
  ]);
  assert.equal((await historicalTurnover.read(day, false)).rows[0]?.price, 200);
  period = day;
  assert.equal((await historicalFlow.read(day, false)).rows[0]?.net, 60000000);
  assert.equal(fetch.mock.callCount(), 3);
});

test("历史分布按指定日取证，21 档不推算涨停，23 档与交易所数据各自保留来源", async t => {
  const day = "2026-10-26";
  let mixed = false;
  let period = day;
  const fetch = t.mock.method(backend, "fetch", async (_id: string, _options: unknown) => {
    const max = mixed ? 11 : 10;
    const dist = Array.from({length: max * 2 + 1}, (_, index) => ({
      source: mixed ? "eastmoney" : "tdx", period, record_key: `dist|${index - max}`,
      field: "market_dist_count", value: 3, note: `档位 ${index - max}`,
    }));
    const evidence = [...dist, { source: "tdx", period, record_key: "exchange|SH", field: "market_up_count", value: 7, note: "" }];
    return { envelope: { status: "ok", extra: {date: day}, evidence } };
  });
  const bars = await readHistoricalBreadth(day);
  assert.deepEqual(fetch.mock.calls[0].arguments, ["cn_market_breadth_history", {args: {date: day}}]);
  assert.equal(bars.up, 30);
  assert.equal(bars.down, 30);
  assert.equal(bars.limitUp, null);
  assert.equal(bars.fromDailyBars, true);
  assert.equal(peekHistoricalBreadth(day)?.buckets.length, 21);
  await readHistoricalBreadth(day);
  assert.equal(fetch.mock.callCount(), 1);
  mixed = true;
  const archive = await readHistoricalBreadth(day, true);
  assert.equal(archive.fromDailyBars, false);
  assert.equal(archive.exchangeFromDailyBars, true);
  assert.equal(archive.limitUp, 3);
  period = "2026-10-27";
  await assert.rejects(readHistoricalBreadth(day, true), /证据日期/);
});

test("盘面三个查询同时开始，涨停先显示，成交额未回和涨跌面失败都不遮挡；回访立即显示已缓存块", async t => {
  const day = "2026-10-27";
  const pending = new Map<string, ReturnType<typeof Promise.withResolvers<any>>>();
  t.mock.method(backend, "page", (query: string) => {
    const request = Promise.withResolvers();
    pending.set(query, request);
    return request.promise;
  });
  const page = (query: string, ids: string[], date = day) => ({
    query, title: query, intent: "", context: { review_date: date, session_phase: "post_close", live: false },
    blocks: ids.map(id => ({id, title: id, note: null, status: "ok", envelope: {}, fetched_at: date + "T16:00:00Z"})),
    oldest_fetched_at: null, mixed_ages: false,
  });
  const first = Promise.withResolvers<void>();
  let visible: string[] = [], warning: string | null = null;
  const task = loadMarketOverview("close", false, day, (result, error) => {
    visible = result?.blocks.map(block => block.id) ?? [];
    warning = error;
    first.resolve();
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.size, 3);
  pending.get("review_limits")!.resolve(page("review_limits", ["sentiment", "zt_pool"]));
  await first.promise;
  assert.deepEqual(visible, ["sentiment", "zt_pool"]);
  assert.deepEqual(peekMarketOverview("close", day)?.blocks.map(block => block.id), visible);
  pending.get("review_breadth")!.reject(new Error("测试上游超时"));
  pending.get("review_trend")!.resolve(page("review_trend", ["trend"], "2026-10-26"));
  await task;
  assert.deepEqual(visible, ["sentiment", "zt_pool"]);
  assert.match(warning!, /测试上游超时/);
  assert.match(warning!, /时段不一致/);
});

test("市场摘要、资金和报告按模式与所选日期独立复用，跨日回复不会进入日期缓存", async t => {
  const day = "2026-11-03";
  let returnedDay = day;
  const page = t.mock.method(backend, "page", async () => ({
    context: { review_date: returnedDay, session_phase: "closed" }, blocks: [{ status: "ok" }],
  }));
  await readDailyMarket("close", false, "review_summary", day);
  await readDailyMarket("close", false, "review_summary", day);
  assert.deepEqual(page.mock.calls.map(call => call.arguments[0]), ["review_summary"]);
  await readDailyMarket("close", false, "review_funds", day);
  await readDailyMarket("close", false, "review", day);
  assert.deepEqual(page.mock.calls.map(call => call.arguments[0]), ["review_summary", "review_funds", "review"]);
  const nextDay = "2026-11-04";
  await readDailyMarket("close", false, "review_funds", nextDay);
  returnedDay = nextDay;
  const corrected = await readDailyMarket("close", false, "review_funds", nextDay);
  assert.equal(corrected.context.review_date, nextDay);
  assert.equal(page.mock.callCount(), 5);
});

test("收盘复盘只接受同日核验的块；同日盘中行情、错日或旧缓存的内容都不可用于报告", async () => {
  await withRenderer(async r => {
    const { closedReviewPage } = await r.load("/src/verticals/finance/pages/DailyReview.tsx");
    const day = "2026-11-16";
    const block = (id: string, business_date?: string) => ({
      id, status: "ok", business_date, envelope: { evidence: [{ value: 42 }] },
    });
    const base = { context: {review_date: day, live: false}, blocks: [
      block("sentiment", day), block("old", "2026-11-13"), block("legacy"),
    ] };
    const result = closedReviewPage(base, [
      { context: {review_date: day, live: true}, blocks: [block("live", day)] },
      { context: {review_date: "2026-11-13", live: false}, blocks: [block("other", day)] },
    ]);
    assert.deepEqual(result.blocks.map((item: {status: string}) => item.status), ["ok", "missing", "missing", "missing", "missing"]);
    for (const item of result.blocks.slice(1)) assert.deepEqual(item.envelope, {});
  });
});
