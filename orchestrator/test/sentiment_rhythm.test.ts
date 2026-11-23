import assert from "node:assert/strict";
import test from "node:test";
import { closingBreadth, rhythmScore } from "../src/finance/shortline/sentiment_rhythm.ts";

test("复盘情绪节奏只接受同日三所通达信收盘读数", () => {
  const date = "2026-11-20";
  const counts = { SH: [156, 2145, 13], SZ: [141, 2752, 9], BJ: [16, 339, 1] };
  const fields = ["market_up_count", "market_down_count", "market_flat_count"];
  const evidence = Object.entries(counts).flatMap(([market, values]) => values.map((value, index) => ({
    field: fields[index], value, record_key: "exchange|" + market, source: "tdx", period: date,
  })));
  const envelope = { status: "ok", extra: { date, exchange_close_dates: { SH: date, SZ: date, BJ: date } }, evidence };
  assert.deepEqual(closingBreadth(envelope, date), { up: 313, total: 5572 });
  assert.equal(closingBreadth({ ...envelope, evidence: evidence.slice(0, -1) }, date), null);
  assert.equal(closingBreadth({
    ...envelope,
    evidence: evidence.map(row => row.record_key === "exchange|BJ" ? { ...row, period: "2026-11-19" } : row),
  }, date), null);
});

test("情绪读数按日计算，两项样本可用时才给分", () => {
  const breadth = { up: 313, total: 5572 };
  assert.equal(rhythmScore(breadth, { up: 28, down: 58 }), 19);
  assert.equal(rhythmScore(breadth, { up: 28, down: null }), null);
  assert.equal(rhythmScore(null, { up: 28, down: 58 }), null);
});
