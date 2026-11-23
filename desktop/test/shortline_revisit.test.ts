import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createReviewCache } from "../src/verticals/finance/shortline/reviewCache.ts";
import { withRenderer } from "./helpers/render.ts";

test("复盘切回合并进行中的加载，强刷替换旧请求，跨收盘重新读取", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-19T14:59:55+08:00") });
  const cache = createReviewCache<string>();
  let finish!: (v: string) => void;
  let calls = 0;
  const read = (fresh = false) => cache.read("market", fresh, async () => {
    calls++;
    if (calls === 1) return new Promise<string>(resolve => { finish = resolve; });
    return String(calls);
  }, () => 60_000);
  const earlier = read();
  assert.equal(read(), earlier);
  assert.equal(await read(true), "2");
  finish("old");
  await earlier;
  assert.equal(await read(), "2");
  t.mock.timers.tick(5000);
  assert.equal(await read(), "3");
  t.mock.timers.tick(60_000);
  assert.equal(await read(), "4");
});

test("复盘首页按所选日复用表头和四组市场数据，手动刷新照常取数", async () => {
  await withRenderer(async renderer => {
    const { backend } = await renderer.load("/src/verticals/finance/lib/backend.ts");
    const { loadEmotion, loadBlocks } = await renderer.load("/src/verticals/finance/shortline/api.ts");
    let calls = 0;
    const original = backend.page;
    backend.page = async (_query: string, opts: {blockArgs: Record<string, {date: string}>}) => {
      calls++;
      return { context: { review_date: "2026-11-16" }, blocks: Object.entries(opts.blockArgs).map(([id, {date}]) =>
        ({ id, status: "ok", envelope: { extra: { result: { date, settled: true } } } })) };
    };
    const visit = async (date: string, refresh = false) => {
      await loadEmotion({ date, refresh });
      await Promise.all([
        loadBlocks("shortline_facts", ["facts"], date, refresh),
        loadBlocks("shortline_themes", ["themes", "firstboard"], date, refresh),
        loadBlocks("shortline_cycle", ["cycle"], date, refresh),
        loadBlocks("shortline_ladder", ["ladder"], date, refresh),
      ]);
    };
    try {
      await visit("2026-11-16");
      assert.equal(calls, 5);
      await visit("2026-11-16");
      assert.equal(calls, 5);
      await visit("2026-11-16", true);
      assert.equal(calls, 10);
      await visit("2026-11-13");
      assert.equal(calls, 15);
    } finally { backend.page = original; }
  });
});

test("复盘公开统计按窗口复用，报告和个人验证每次读取", async () => {
  await withRenderer(async renderer => {
    const { backend } = await renderer.load("/src/verticals/finance/lib/backend.ts");
    const { readShortlineView } = await renderer.load("/src/verticals/finance/shortline/useView.ts");
    let calls = 0;
    let gaps: string[] = [];
    const original = backend.shortlineView;
    backend.shortlineView = async (_id: string, q: {date: string}) => ({
      date: q.date, gaps, series: gaps.length ? [] : [{status: "ok", values: {limit_up: 0}}], call: ++calls,
    });
    const read = (id: string, days = 5, refresh = false) => readShortlineView(id, "2026-11-16", days, refresh, new AbortController().signal);
    try {
      assert.equal((await read("shortline_history")).call, 1);
      assert.equal((await read("shortline_history")).call, 1);
      assert.equal((await read("shortline_history", 20)).call, 2);
      gaps = ["数据缺失"];
      assert.equal((await read("shortline_history", 5, true)).call, 3);
      assert.equal((await read("shortline_history")).call, 4);
      for (const id of ["shortline_review", "shortline_weekly_review", "shortline_verify", "shortline_structure"]) {
        const first = await read(id);
        assert.equal((await read(id)).call, first.call + 1);
      }
    } finally { backend.shortlineView = original; }
  });
});

test("10月9日情绪历史与涨停样本保留来源缺口，短时回访各只取一次", async t => {
  await withRenderer(async renderer => {
    const { backend } = await renderer.load("/src/verticals/finance/lib/backend.ts");
    const { readShortlineView } = await renderer.load("/src/verticals/finance/shortline/useView.ts");
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/shortline-views-2026-10-09.json", import.meta.url), "utf8"));
    const original = backend.shortlineView;
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-19T13:45:00+08:00") });
    try {
      for (const kind of ["history", "samples"]) {
        const data = fixture[kind];
        assert.ok(data.gaps.length > 0);
        let requests = 0;
        backend.shortlineView = async () => { requests++; return data; };
        const read = (refresh = false, date = data.date) => readShortlineView("shortline_" + kind, date, data.days, refresh, new AbortController().signal);
        assert.deepEqual((await read()).gaps, data.gaps);
        assert.deepEqual((await read()).gaps, data.gaps);
        assert.equal(requests, 1);
        t.mock.timers.tick(30_000);
        await read();
        await read(true);
        assert.equal(requests, 3);
        await read(false, "2026-10-08");
        await read(false, "2026-10-08");
        assert.equal(requests, 5);
      }
    } finally { backend.shortlineView = original; }
  });
});
