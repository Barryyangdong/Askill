import assert from "node:assert/strict";
import test from "node:test";
import { defaultLayout, moveWidget, parseLayout } from "../src/verticals/finance/lib/workspaceLayout.ts";
import { withRenderer, textOf } from "./helpers/render.ts";

test("layout migration preserves order, rejects unknown keys and restores new modules", () => {
  assert.deepEqual(parseLayout("broken"), defaultLayout());
  const value = parseLayout(JSON.stringify({ order: ["tasks", "tasks", "unknown"], hidden: ["market", "unknown"] }));
  assert.deepEqual(value.order, ["tasks", "market", "focus", "features", "assistant"]);
  assert.deepEqual(value.hidden, ["market"]);
  assert.deepEqual(moveWidget(value, "tasks", "market").order, ["market", "tasks", "focus", "features", "assistant"]);
  assert.equal(value.order[0], "tasks");
});

test("workspace is usable before customization; shape readings preserve missing values", async () => {
  await withRenderer(async r => {
    const { WorkspaceLayout } = await r.load("/src/verticals/finance/components/WorkspaceLayout.tsx");
    const html = r.html(WorkspaceLayout, { widgets: { focus: "场景内容", tasks: "待办内容", market: "行情内容", features: "功能内容", assistant: "助手内容" } });
    assert.match(textOf(html), /自定义布局.*行情内容.*待办内容.*场景内容.*功能内容.*助手内容/);
    const { KlineStructure } = await r.load("/src/verticals/finance/components/KlineStructure.tsx");
    const missing = r.html(KlineStructure, { view: { last: "2026-11-13", series: { dates: ["2026-11-13"] } } });
    assert.match(textOf(missing), /20根区间位置 —/);
    assert.match(textOf(missing), /相对前5根量 —/);
  });
});
