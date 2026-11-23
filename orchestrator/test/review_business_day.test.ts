import test from "node:test";
import assert from "node:assert/strict";
import type { PageBlockResult } from "../src/service.ts";
import { closedReviewBlock } from "../src/finance/review_business_day.ts";
import { FINANCE_PAGE_QUERIES } from "../src/finance/page_queries.ts";

const day = "2026-11-19";
const next = "2026-11-20";
const ctx = { review_date: day, live: false, session_phase: "pre_open", realtime_matches_review_day: false };
function block(id: string, evidence: unknown[], extra = {}): PageBlockResult {
  return { id, title: id, status: "ok", fetched_at: next + "T06:30:00+08:00", envelope: { status: "ok", evidence, extra } };
}

test("收盘后的采集时间和 mapper 的默认日期不能充当实时榜单业务日", () => {
  for (const id of ["turnover", "board_flow"]) {
    const row = [{ field: "rank", period: day }];
    const before = closedReviewBlock(block(id, row), ctx);
    assert.equal(before.status, "missing");
    assert.equal(before.envelope, undefined);
    assert.equal(closedReviewBlock(block(id, row, { source_close_date: next }), ctx).business_date, undefined);
    assert.equal(closedReviewBlock(block(id, row, { source_close_date: day }), ctx).business_date, day);
  }
  const incomplete = { ...block("sentiment", [{ period: day }]), fetched_at: day + "T13:00:00+08:00" };
  assert.equal(closedReviewBlock(incomplete, ctx).business_date, undefined);
  assert.ok(!FINANCE_PAGE_QUERIES.market_snapshot?.verifyBusinessDate);
  assert.deepEqual(FINANCE_PAGE_QUERIES.review?.modes, []);
});

test("广度独立核对分布与三所来源日，剔除不符数据后保留 partial", () => {
  const rows = [{ period: day, record_key: "dist|0" }, { period: day, record_key: "exchange|SH" }];
  const reviewed = closedReviewBlock(block("breadth", rows, { distribution_date: next, exchange_close_dates: { SH: day } }), ctx);
  assert.equal(reviewed.status, "partial");
  assert.equal(reviewed.business_date, day);
  assert.deepEqual(reviewed.envelope?.evidence, [rows[1]]);
  assert.equal(closedReviewBlock(block("breadth", rows, { date: day }), ctx).status, "missing");
});

test("趋势只保留当日指数和此前成交额，滚动指标保留已发布数据的日期", () => {
  const rows = [{ period: day, field: "index_close" }, { period: "2026-11-18", field: "index_close" },
    { period: "2026-11-18", field: "market_amount_total", record_key: "amount|2026-11-18" }, { period: next, field: "index_close" }];
  const reviewed = closedReviewBlock(block("trend", rows), ctx);
  assert.deepEqual(reviewed.envelope?.evidence, [rows[0], rows[2]]);
  assert.equal(reviewed.status, "partial");
  const volume = { period: day, field: "market_amount_total", record_key: `amount|${day}` };
  assert.deepEqual(closedReviewBlock(block("trend", [...rows, volume]), ctx).envelope?.evidence, [rows[0], rows[2], volume]);
  for (const id of ["margin", "valuation", "bond"]) {
    const observation = { period: "2026-11-18" };
    const lagged = closedReviewBlock(block(id, [observation]), ctx);
    assert.equal(lagged.status, "partial");
    assert.equal(lagged.business_date, observation.period);
    assert.deepEqual(lagged.envelope?.evidence, [observation]);
  }
  assert.equal(closedReviewBlock(block("margin", [{ period: day }, { period: next }]), ctx).status, "missing");
});
