import test from "node:test";
import assert from "node:assert/strict";
import { backend } from "../src/verticals/finance/lib/backend.ts";

// Load a fresh module to simulate a browser refresh without sharing its in-memory promises.
const fresh = (revision: number) => import(`../src/verticals/finance/lib/dailyReviewData.ts?reload=${revision}`);

function mockStorage(): Storage {
  return Object.create({
    getItem(this: Record<string, string>, key: string) { return this[key] ?? null; },
    setItem(this: Record<string, string>, key: string, value: string) { this[key] = value; },
    removeItem(this: Record<string, string>, key: string) { delete this[key]; },
  });
}

test("部分可用的盘后指数刷新后立即可见；交易阶段、手动刷新与失败使旧快照失效", async t => {
  const storage = mockStorage();
  const old = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {sessionStorage: storage} });
  t.after(() => old ? Object.defineProperty(globalThis, "window", old) : Reflect.deleteProperty(globalThis, "window"));
  let now = Date.parse("2026-11-19T17:01:00+08:00");
  t.mock.method(Date, "now", () => now);
  const day = "2026-11-19";
  let fail = false;
  const page = t.mock.method(backend, "page", async () => {
    if (fail) throw new Error("上游暂不可用");
    return {
      query: "review_trend", context: { review_date: day, session_phase: "post_close" },
      blocks: [{ id: "trend", status: "partial", envelope: {
        evidence: [{field: "index_close", value: 3510, raw_ref: "local-debug-path"}],
        extra: { date: day, diagnostics: "provider-diagnostics" }, missing: [{reason: "成交额缺失"}],
      }}],
    };
  });
  const first = await fresh(1);
  await first.readDailyMarket("close", false, "review_trend", day);
  assert.doesNotMatch(JSON.stringify(storage), /local-debug-path|provider-diagnostics/);
  now += 90_000;
  const visit = await fresh(2);
  const value = visit.peekDailyMarket("close", "review_trend", day);
  assert.equal(value.blocks[0].envelope.evidence[0].value, 3510);
  assert.equal(value.blocks[0].envelope.missing[0].reason, "成交额缺失");
  await visit.readDailyMarket("close", false, "review_trend", day);
  assert.equal(page.mock.callCount(), 1);
  assert.equal(visit.peekDailyMarket("live", "review_trend", day), undefined);
  assert.equal(visit.peekDailyMarket("close", "review_trend", "2026-11-18"), undefined);
  fail = true;
  await assert.rejects(visit.readDailyMarket("close", true, "review_trend", day));
  const retry = await fresh(3);
  assert.equal(retry.peekDailyMarket("close", "review_trend", day), undefined);
  fail = false;
  await retry.readDailyMarket("close", false, "review_trend", day);
  assert.equal(page.mock.callCount(), 3);
  now = Date.parse("2026-11-20T09:31:00+08:00");
  assert.equal((await fresh(4)).peekDailyMarket("close", "review_trend", day), undefined);
});

test("重开标签只恢复后端逐块核验的同日收盘快照；日期、模式与强制重取隔离", async t => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "window");
  const localStorage = mockStorage();
  const newTab = () => Object.defineProperty(globalThis, "window", {
    configurable: true, value: {localStorage, sessionStorage: mockStorage()},
  });
  newTab();
  t.after(() => old ? Object.defineProperty(globalThis, "window", old) : Reflect.deleteProperty(globalThis, "window"));
  const day = "2026-11-19";
  let now = Date.parse("2026-11-19T17:01:00+08:00");
  t.mock.method(Date, "now", () => now);
  let businessDay = day;
  const get = t.mock.method(backend, "page", async (query: string) => ({
    query, context: {review_date: day, session_phase: "closed", live: false},
    blocks: [{id: "trend", business_date: businessDay, status: "ok", envelope: {evidence: [{field:"index_close",value:3510}]}}],
  }));
  const first = await fresh(5);
  await first.readDailyMarket("close", false, "review_trend");
  now += 2 * 86400_000;
  newTab();
  const second = await fresh(6);
  assert.equal(second.peekArchivedMarket(day, "review_trend").blocks[0].business_date, day);
  assert.equal(second.peekArchivedMarket("2026-11-18", "review_trend"), undefined);
  assert.equal(second.peekDailyMarket("live", "market_snapshot", day), undefined);
  assert.equal(second.peekDailyMarket("close", "review_trend"), undefined, "不拿归档猜默认日");
  assert.equal((await second.readDailyMarket("close", false, "review_trend", day)).blocks[0].envelope.evidence[0].value, 3510);
  assert.equal(get.mock.callCount(), 1);
  businessDay = "2026-11-18";
  await second.readDailyMarket("close", true, "review_trend", day);
  newTab();
  assert.equal((await fresh(7)).peekArchivedMarket(day, "review_trend"), undefined);
});

test("交易日后取得且覆盖完整的历史分档跨标签复用；同日和有缺口的分档可重试", async t => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "window");
  const localStorage = mockStorage();
  const newTab = () => Object.defineProperty(globalThis, "window", {
    configurable: true, value: {localStorage, sessionStorage: mockStorage()},
  });
  newTab();
  t.after(() => old ? Object.defineProperty(globalThis, "window", old) : Reflect.deleteProperty(globalThis, "window"));
  const day = "2026-11-19";
  let generated_at = "2026-11-19T09:40:00+08:00";
  let gaps: string[] = [];
  const get = t.mock.method(backend, "reviewTiers", async () => ({
    date: day, generated_at, total: 1, groups: [{stocks: [{symbol:"600001"}]}],
    prev_dates: ["2026-11-18", "2026-11-17"], gaps,
  }));
  await (await fresh(8)).readDailyTiers(day, false);
  newTab();
  const next = await fresh(9);
  assert.equal(next.peekDailyTiers(day), undefined);
  generated_at = "2026-11-20T09:40:00+08:00";
  await next.readDailyTiers(day, false);
  newTab();
  const revisit = await fresh(10);
  assert.equal((await revisit.readDailyTiers(day, false)).total, 1);
  assert.equal(get.mock.callCount(), 2);
  gaps = ["题材来源暂缺"];
  await revisit.readDailyTiers(day, true);
  newTab();
  assert.equal((await fresh(11)).peekDailyTiers(day), undefined);
});

test("已核验交易日的收盘缺项在刷新页面后保留五分钟和原因；网络错误与错日原因重试", async t => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "window");
  const localStorage = mockStorage();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {sessionStorage:mockStorage(), localStorage} });
  t.after(() => old ? Object.defineProperty(globalThis, "window", old) : Reflect.deleteProperty(globalThis, "window"));
  let now = Date.parse("2026-11-20T10:15:00+08:00");
  t.mock.method(Date, "now", () => now);
  const day = "2026-11-19";
  const reason = `来源没有可核验的 ${day} 收盘数据。`;
  const rankReason = `来源没有可核验的 ${day} 收盘榜单。`;
  let error = reason;
  const get = t.mock.method(backend, "page", async (query: string) => ({
    query, context: {review_date: day, session_phase: "trading", live_available:true, live:false},
    blocks: query === "review_funds" ? ["board_flow", "turnover"].map(id => ({id, status:"missing", error:rankReason}))
      : [{id:"breadth", status:"missing", error}],
  }));
  const first = await fresh(12);
  await first.readDailyMarket("close", false, "review_breadth", day);
  await first.readDailyMarket("close", false, "review_funds", day);
  const visit = await fresh(13);
  now += 299_999;
  assert.equal(visit.peekDailyMarket("close", "review_breadth", day).blocks[0].error, reason);
  assert.deepEqual(visit.peekDailyMarket("close", "review_funds", day).blocks.map((b: {error:string}) => b.error), [rankReason, rankReason]);
  await visit.readDailyMarket("close", false, "review_breadth", day);
  assert.equal(get.mock.callCount(), 2);
  assert.equal(Object.keys(localStorage).length, 0);
  now += 1;
  assert.equal(visit.peekDailyMarket("close", "review_breadth", day), undefined);
  await visit.readDailyMarket("close", false, "review_breadth", day);
  assert.equal(get.mock.callCount(), 3);
  for (const transient of ["网络超时", "来源没有可核验的 2026-11-18 收盘数据。"]) {
    error = transient;
    await visit.readDailyMarket("close", true, "review_breadth", day);
    assert.equal(visit.peekDailyMarket("close", "review_breadth", day), undefined);
    await visit.readDailyMarket("close", false, "review_breadth", day);
  }
  assert.equal(get.mock.callCount(), 7);
});
