import { test } from "node:test";
import { strict as assert } from "node:assert";
import { historyDates, reduceThemeHistory } from "../src/verticals/finance/shortline/themeHistoryMembers.ts";
import type { ReviewTiersResult, TierStock } from "../src/verticals/finance/lib/reviewTiers.ts";

const stock = (symbol: string, tags = ["芯片"], boards: number | null = null): TierStock => ({ symbol, name: symbol, industry: "科技", boards, tags });
const day = (date: string, stocks: TierStock[], gaps: string[] = []): ReviewTiersResult => ({ date, total: stocks.length, prev_dates: [null, null], groups: [{ industry: "科技", tier: "single", today: stocks.length, prev: [null, null], stocks, tags: [], note: "" }], tiers: [], fetched_at: null, cached: false, generated_at: "", gaps, source: "" });

test("historical members deduplicate each day, require exact tag and reject mismatched data", () => {
  const dates = ["2026-11-19", "2026-11-18", "2026-11-17", "2026-11-18"];
  const data = new Map<string, ReviewTiersResult | null>([
    ["2026-11-19", day("2026-11-19", [stock("SH600000", ["芯片"], 2), stock("600000", ["芯片"], 3), stock("600001", ["芯片材料"])])],
    ["2026-11-18", day("2026-11-18", [stock("600000"), stock("000001")], ["题材缺口"])],
    ["2026-11-17", day("2026-11-20", [stock("600002")])],
  ]);
  const result = reduceThemeHistory("芯片", dates, data);
  assert.deepEqual(result.members.map(({code, lastHit, hitDays, maxBoards}) => ({code, lastHit, hitDays, maxBoards})), [
    {code: "600000", lastHit: "2026-11-19", hitDays: 2, maxBoards: 3},
    {code: "000001", lastHit: "2026-11-18", hitDays: 1, maxBoards: null},
  ]);
  assert.deepEqual(result.availableDays, ["2026-11-19", "2026-11-18"]);
  assert.deepEqual(result.missingDays, ["2026-11-18", "2026-11-17"]);
});

test("only passed valid dates are used, newest first and capped at ten", () => {
  const dates = Array.from({length: 12}, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
  assert.deepEqual(historyDates([...dates, "2026-02-30", dates[0]]), dates.slice(2).reverse());
  const result = reduceThemeHistory("芯片", ["2026-11-10"], new Map([["2026-11-11", day("2026-11-11", [stock("600000")])]]));
  assert.deepEqual(result.members, []);
  assert.deepEqual(result.missingDays, ["2026-11-10"]);
});
