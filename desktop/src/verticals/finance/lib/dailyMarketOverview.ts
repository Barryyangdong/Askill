import type { PageResult } from "./backend.ts";
import { peekArchivedMarket, peekDailyMarket, readDailyMarket, type ReviewMode } from "./dailyReviewData.ts";

const groups = [
  { query: "review_limits", title: "涨跌停与连板" },
  { query: "review_breadth", title: "涨跌面" },
  { query: "review_trend", title: "指数与成交额" },
] as const;

function combine(pages: PageResult[], requestedDay?: string) {
  const dayOf = (page: PageResult) => page.context?.review_date ?? page.context?.last_trading_day;
  const dated = pages.filter(page => dayOf(page));
  const base = dated.find(page => requestedDay && dayOf(page) === requestedDay)
    ?? dated.sort((a, b) => dayOf(b)!.localeCompare(dayOf(a)!))[0];
  if (!base) return { page: null, mismatch: pages.length > 0 };
  const compatible = pages.filter(page => dayOf(page) === dayOf(base) && Boolean(page.context.live) === Boolean(base.context.live));
  const blocks = compatible.flatMap(page => page.blocks);
  const stamps = blocks.flatMap(block => block.fetched_at ? [block.fetched_at] : []).sort();
  const mixed = new Set(stamps.map(stamp => stamp.slice(0, 10))).size > 1;
  return {
    page: { ...base, query: "review_summary", blocks, oldest_fetched_at: stamps[0] ?? null, mixed_ages: mixed || compatible.some(page => page.mixed_ages) },
    mismatch: compatible.length !== pages.length,
  };
}

function cachedGroups(mode: ReviewMode, day?: string) {
  return groups.map(group => peekDailyMarket(mode, group.query, day));
}

export function peekMarketOverview(mode: ReviewMode, day?: string) {
  return combine(cachedGroups(mode, day).filter((page): page is PageResult => Boolean(page)), day).page;
}

export function archivedOverview(day: string) {
  const queries = [...groups.map(group => group.query), "review_indicators", "review_funds"] as const;
  const pages = queries.map(query => peekArchivedMarket(day, query)).filter((page): page is PageResult => Boolean(page));
  const full = peekArchivedMarket(day, "review");
  if (full) {
    const available = new Set(pages.flatMap(page => page.blocks.map(block => block.id)));
    pages.push({ ...full, blocks: full.blocks.filter(block => !available.has(block.id)) });
  }
  return combine(pages, day).page;
}

export async function loadMarketOverview(mode: ReviewMode, refresh: boolean, day: string | undefined,
  publish: (page: PageResult | null, error: string | null) => void) {
  const pages = refresh ? [] : cachedGroups(mode, day);
  const errors = new Map<string, string>();
  await Promise.all(groups.map(async ({ query, title }, index) => {
    try {
      pages[index] = await readDailyMarket(mode, refresh, query, day);
    } catch (e) {
      pages[index] = undefined;
      errors.set(query, `${title}：${e instanceof Error ? e.message : String(e)}`);
    }
    const { page, mismatch } = combine(pages.filter((value): value is PageResult => Boolean(value)), day);
    const warnings = [...errors.values()];
    if (mismatch) warnings.push("部分指标的交易日或时段不一致，已省略。");
    publish(page, warnings.join("；") || null);
  }));
}
