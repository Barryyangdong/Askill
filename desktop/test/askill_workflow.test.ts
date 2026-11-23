import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { defaultForm } from "../src/verticals/finance/lib/candidates.ts";
import { parsePresets, persistPresets } from "../src/verticals/finance/lib/candidatePresets.ts";
import { withRenderer, textOf } from "./helpers/render.ts";

test("筛选方案损坏可恢复，重复名去重，显式保存失败不报成功", () => {
  assert.deepEqual(parsePresets("bad json"), []);
  const form = defaultForm();
  const presets = parsePresets(JSON.stringify([{ name: "日常", form }, { name: "日常", form }, null]));
  assert.equal(presets.length, 1);
  assert.deepEqual(presets[0]?.form, form);
  assert.throws(() => persistPresets(undefined, presets), /未保存/);
  assert.throws(() => persistPresets({ setItem() { throw new Error("quota"); } }, presets), /未保存/);
  let saved = "";
  persistPresets({ setItem(_key, value) { saved = value; } }, presets);
  assert.deepEqual(parsePresets(saved), presets);
});

test("历史趋势缺口断线，零值有效，未收盘标识和无数据状态可见", async () => {
  await withRenderer(async r => {
    const { HistoryTrends, trendSegments } = await r.load("/src/verticals/finance/shortline/HistoryTrends.tsx");
    const metric = { key: "count", label: "涨停家数", unit: "家", kind: "count" };
    const rows = [
      { date: "2026-11-09", values: { count: 0 }, status: "ok", settled: true },
      { date: "2026-11-10", values: { count: 99 }, status: "missing", settled: null },
      { date: "2026-11-11", values: { count: 10 }, status: "partial", settled: false },
    ];
    const t = trendSegments(rows, metric);
    assert.equal(t.count, 2);
    assert.equal(t.min, 0);
    assert.equal(t.max, 10);
    assert.equal(t.segments.length, 2);
    assert.equal(t.points[1], null);
    const html = r.html(HistoryTrends, { r: { readings: [metric], series: rows } });
    assert.match(textOf(html), /未收盘/);
    assert.match(textOf(html), /2\/3 日/);
    const missing = r.html(HistoryTrends, { r: { readings: [metric], series: [rows[1]] } });
    assert.match(textOf(missing), /没有可画的读数/);
    assert.doesNotMatch(missing, /<polyline/);
  });
});

test("工作场景首屏与筛选方案操作可访问", async () => {
  await withRenderer(async r => {
    const { MemoryRouter } = await r.load("react-router-dom");
    const { WorkspaceFocus } = await r.load("/src/verticals/finance/components/WorkspaceFocus.tsx");
    const html = r.html(() => createElement(MemoryRouter, null, createElement(WorkspaceFocus)), {});
    assert.match(textOf(html), /盘前.*盘中.*盘后/);
    assert.match(html, /href="\/watch"/);
    const { Candidates } = await r.load("/src/verticals/finance/pages/Candidates.tsx");
    const { AiPageProvider } = await r.load("/src/core/ai/pageContext.tsx");
    const candidate = r.html(() => createElement(MemoryRouter, null, createElement(AiPageProvider, null, createElement(Candidates))), {});
    assert.match(candidate, /aria-label="方案名称"/);
    assert.match(textOf(candidate), /保存为新方案/);
    assert.match(textOf(candidate), /方案保存在本机服务，可跨浏览器使用/);
  });
});
