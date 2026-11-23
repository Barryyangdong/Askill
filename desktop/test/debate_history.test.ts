import test from "node:test";
import assert from "node:assert/strict";
import { previousDebate } from "../src/verticals/finance/lib/debateHistory.ts";

test("只比较同股票之前最近的综合结论，不把全文与其他台账带入", () => {
  const note = { id: "a", kind: "多空辩论", title: "多空辩论 · 600825", ts: 1000, content: "# 报告\n## 综合判断\n## 综合判断\n倾向偏空\n## 后续观察\n观察条件\n### 数字复核\n复核信息\n---\n## 多方立论\n详细论点" };
  const result = previousDebate([note, { ...note, id: "b", title: "多空辩论 · 600519", ts: 2000 }, { ...note, id: "c", ts: 4000 }], "600825", 3000);
  assert.match(result!.text, /倾向偏空/);
  assert.match(result!.text, /观察条件/);
  assert.doesNotMatch(result!.text, /详细论点|复核信息/);
  assert.equal(result!.at, new Date(1000).toISOString());
  assert.equal(previousDebate([{ ...note, kind: "交易日志" }], "600825"), undefined);
});
