import test from "node:test";
import assert from "node:assert/strict";
import { marketComparison } from "../src/finance/mentor_market.ts";

const bars = Array.from({ length: 24 }, (_, i) => ({ date: "2026-09-" + String(i + 1).padStart(2, "0"), close: 3000 }));
const afterClose = new Date("2026-09-24T15:10:00+08:00");
const example = { id: "case-a", date: "2017-05-15", nextDate: "2017-05-16", market: {pct: 0, d5: 0, d20: 0}, reveal: {action: "open", summary: "案例原件 A"} };

test("current market returns only completed comparable historical outcomes", () => {
  const cases = [example, {...example, id: "far", market: {pct: 2, d5: 0, d20: 0}},
    {...example, id: "unconfirmed", reveal: { action: "unknown", summary: "" }},
    {...example, id: "future", nextDate: "2026-10-01"}];
  const result = marketComparison(bars, cases, afterClose.toISOString(), afterClose);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.matches.map(m => m.caseId), ["case-a"]);
  assert.deepEqual(result.market, example.market);
});

test("a quote cached before close stays stale even if a user opens the page after close", () => {
  const result = marketComparison(bars, [example], "2026-09-24T14:59:59+08:00", afterClose);
  assert.equal(result.date, "2026-09-23");
  assert.equal(result.status, "stale");
  assert.deepEqual(result.matches, []);
  assert.equal(marketComparison(bars.slice(-20), [], afterClose.toISOString(), afterClose).status, "unavailable");
});
