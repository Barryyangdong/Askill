import assert from "node:assert/strict";
import test from "node:test";
import { replaySnapshots } from "../src/verticals/finance/lib/intradayReplay.ts";
import type { IntradayResult, Snapshot } from "../src/verticals/finance/shortline/watchTypes.ts";
import { withRenderer, textOf } from "./helpers/render.ts";

test("archive replay uses capture time, not the scheduled slot, and excludes unversioned records", () => {
  const snap = (slot: string, clock: string) => ({ date: "2026-11-13", slot, captured_at: `2026-11-13T${clock}:00+08:00`, gaps: [] } as Snapshot);
  const auction = snap("09:25", "09:26");
  const original = { date: "2026-11-13", today: true, auction, checks: { items: [{ reason: "FUTURE_PRIVATE" }] }, warnings: ["FUTURE_WARNING"], gaps: ["FUTURE_GAP"], slots: [
    { slot: "09:25", state: "saved", snapshot: auction },
    { slot: "09:35", state: "saved", snapshot: snap("09:35", "09:38") },
    { slot: "10:00", state: "saved", snapshot: snap("10:00", "10:01") },
  ] } as unknown as IntradayResult;
  const view = replaySnapshots(original, "2026-11-13T09:36:00+08:00");
  assert.deepEqual(view.slots.map(s => s.slot), ["09:25"]);
  assert.equal(view.today, false);
  assert.doesNotMatch(JSON.stringify(view), /FUTURE_|09:38|10:01/);
  assert.equal(original.slots.length, 3);
  assert.equal(replaySnapshots(original, "invalid").slots.length, 0);
});

test("data stamp distinguishes market time, retrieval time and stale state", async () => withRenderer(async r => {
  const { DataStamp } = await r.load("/src/verticals/finance/components/ui/DataStamp.tsx");
  const html = r.html(DataStamp, { mode: "quote", dataAt: "2026-11-13", fetchedAt: "2026-11-15", stale: true });
  assert.match(textOf(html), /行情快照 数据 2026-11-13 取数 2026-11-15 刷新失败/);
  assert.doesNotMatch(textOf(html), /实时/);
}));
