import { api, type GlobalIndex } from "./api.ts";
import { backend, type Evidence, type PageBlock, type PageResult } from "./backend.ts";
import { beijingDay } from "./homeTasks.ts";
import { allowsPublishedHistory } from "./marketReview.ts";
import type { ReviewTiersResult } from "./reviewTiers.ts";
import { createReviewCache } from "../shortline/reviewCache.ts";

export type ReviewMode = "live" | "close";

// Only fixed messages from the server's closing-date check are repeatable across
// visits. Provider failures may include diagnostics and must remain retryable.
function closeCoverageReason(block: PageBlock, day?: string) {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || block.status !== "missing" ||
      block.business_date || block.envelope?.evidence?.length) return;
  const reasons = [
    `来源没有可核验的 ${day} 收盘数据。`,
    `来源没有可核验的 ${day} 收盘榜单。`,
    `${day} 的收盘快照尚未取得。`,
    `该指标包含 ${day} 之后的观测，无法核验本次复盘值。`,
  ];
  if (block.error && reasons.includes(block.error)) return block.error;
}

// Only the public read models consumed by the market panels are stored in this tab.
// In particular, omit raw envelopes, provider diagnostics, paths and request arguments.
function publicMarketSnapshot(page: PageResult): PageResult {
  const { query, title, intent, context, oldest_fetched_at, mixed_ages } = page;
  const blocks = page.blocks.map(block => {
    const {id, title, note, status, business_date, fetched_at, cached, via_fallback, envelope} = block;
    const evidence = (envelope?.evidence ?? []).map(row => {
      const { id, field, value, period, record_key, note, unit, fetched_at, source } = row as Evidence;
      return { id, field, value, period, record_key, note, unit, fetched_at, source };
    });
    return { id, title, note, status, business_date, fetched_at, cached, error: closeCoverageReason(block, context.review_date),
      ...(via_fallback && { via_fallback: { note: via_fallback.note, primary_status: via_fallback.primary_status } }),
      envelope: { evidence, extra: { date: envelope?.extra?.date, source_close_date: envelope?.extra?.source_close_date,
        ...(business_date && envelope?.extra?.source_url === `https://www.yyqyx.com/moneyflow/${business_date}` && {
          source_url: envelope.extra.source_url, published_at: envelope.extra.published_at,
        }) },
        missing: Array.isArray(envelope?.missing) ? envelope.missing.map(m => ({reason: typeof m === "string" ? m : m?.reason})) : [] },
    };
  });
  return { query, title, intent, context, blocks, oldest_fetched_at, mixed_ages };
}

const market = createReviewCache<PageResult>(32, {
  namespace: "daily-close-history", limit: 8, project: publicMarketSnapshot,
  valid: page => !!page?.context?.review_date && Array.isArray(page.blocks) && page.blocks.every(b => Array.isArray(b.envelope?.evidence)),
});
const indices = createReviewCache<GlobalIndex[]>(4, {
  namespace: "indices", limit: 1, project: rows => rows, valid: Array.isArray,
});
const tiers = createReviewCache<ReviewTiersResult>(32, {
  namespace: "tiers", limit: 4, project: result => result, valid: result => !!result?.date && Array.isArray(result.groups),
});

const archiveTtl = 7 * 24 * 60 * 60_000;
function confirmedMarketClose(page: PageResult, day: string, query: ReviewQuery) {
  return !!day && query !== "market_snapshot" && query === page?.query && day === page.context?.review_date
    && !page.context.live && !!page.context.session_phase && page.context.session_phase !== "unknown"
    && page.blocks.length > 0 && page.blocks.every(b => b.status === "ok" && b.business_date === day);
}
const closedMarket = createReviewCache<PageResult>(64, {
  namespace: "closed-market", limit: 30, archive: true, project: publicMarketSnapshot,
  valid: page => confirmedMarketClose(page, page.context.review_date ?? "", page.query as ReviewQuery),
});
const closedTiers = createReviewCache<ReviewTiersResult>(32, {
  namespace: "closed-tiers", limit: 10, archive: true, project: value => value,
  valid: result => !!result?.date && result.total !== null && Array.isArray(result.groups) && result.gaps.length === 0,
});

export type ReviewQuery = "market_snapshot" | "review" | "review_summary" | "review_limits" | "review_breadth" | "review_trend" | "review_indicators" | "review_funds";

export function peekArchivedMarket(day: string, query: ReviewQuery) {
  const page = day ? closedMarket.peek(`${day}:${query}`) : undefined;
  return page && confirmedMarketClose(page, day, query) ? page : undefined;
}

export function peekDailyMarket(view: ReviewMode, query: ReviewQuery = "review", day = "") {
  return market.peek(`${query}:${view}:${day}`) ?? (view === "close" ? peekArchivedMarket(day, query) : undefined);
}

export const peekDailyIndices = () => indices.peek("global");
export function peekDailyTiers(day: string) {
  const value = tiers.peek(day) ?? closedTiers.peek(day);
  return value?.date === day ? value : undefined;
}

export function readDailyMarket(view: ReviewMode, refresh: boolean, query: ReviewQuery = "review", day = "") {
  if (view === "close") {
    const knownDay = day || market.peek(`${query}:${view}:`)?.context.review_date;
    if (refresh && knownDay) closedMarket.forget(`${knownDay}:${query}`);
    if (!refresh) {
      const cached = peekDailyMarket(view, query, day);
      if (cached) return Promise.resolve(cached);
    }
  }
  return market.read(`${query}:${view}:${day}`, refresh, () => backend.page(query, {
    ...(refresh ? { refresh: true } : {}),
    ...(view === "live" ? { mode: "live" as const } : {}),
  }), page => {
    if (!page.context?.review_date || page.context.session_phase === "unknown") return 0;
    if (day && day !== page.context.review_date) return 0;
    if (view === "close" && query !== "market_snapshot") {
      const key = `${page.context.review_date}:${query}`;
      if (confirmedMarketClose(page, page.context.review_date, query)) closedMarket.save(key, page, archiveTtl);
      else closedMarket.forget(key);
      if (page.blocks.some(b => b.business_date && b.business_date !== page.context.review_date &&
        !(b.status === "partial" && allowsPublishedHistory(b.id) && b.business_date < page.context.review_date!))) return 0;
      if (page.query === query && !page.context.live && page.blocks.length &&
        page.blocks.every(block => closeCoverageReason(block, page.context.review_date))) return 5 * 60_000;
    }
    if (!page.blocks.some(b => b.status === "ok" || (b.status === "partial" && b.envelope?.evidence?.length))) return 0;
    const incomplete = page.blocks.some(b => b.status !== "ok");
    if (page.context.live || page.context.live_available) return incomplete ? 30_000 : 60_000;
    return incomplete ? 5 * 60_000 : 30 * 60_000;
  });
}

export function readDailyIndices(refresh: boolean) {
  // A 股收盘后海外仍可能交易，使用独立的短有效期。
  return indices.read("global", refresh, () => api.globalIndices(refresh), rows =>
    !rows.some(r => r.price != null || r.change_pct != null) ? 0 :
      rows.every(r => r.price !== null && r.change_pct !== null) ? 30_000 : 15_000);
}

export function readDailyTiers(day: string, refresh: boolean) {
  if (refresh) closedTiers.forget(day);
  else {
    const cached = peekDailyTiers(day);
    if (cached) return Promise.resolve(cached);
  }
  return tiers.read(day, refresh, () => backend.reviewTiers({ date: day, refresh }), value => {
    if (value.date !== day || value.total === null) return 0;
    if (value.total > 0 && !value.groups.some(group => group.stocks.length > 0)) return 0;
    if (value.gaps.length) {
      if (value.total === 0) return 0;
      return day === beijingDay() ? 30_000 : 5 * 60_000;
    }
    // A strictly dated, nonempty historical pool with coverage for both preceding
    // trading days. Same-day polls may still be intraday and never enter the archive.
    const generated = Date.parse(value.generated_at);
    if (Number.isFinite(generated) && day < beijingDay(new Date(generated)) && value.total > 0
      && value.prev_dates?.length === 2 && value.prev_dates.every(d => d && d < day)) {
      closedTiers.save(day, value, archiveTtl);
    }
    return day === beijingDay() ? 30_000 : 30 * 60_000;
  });
}
