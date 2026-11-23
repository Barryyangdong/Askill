import { localClock } from "../notify.ts";
import { fetchEndpoint, type ServiceContext } from "../service.ts";
import { klineBars, type Bar } from "./abnormal.ts";
import { selectedCloseDate } from "./mentor_insight_market.ts";

type Reading = { pct: number; d5: number; d20: number };
interface HistoricalCase {
  id: string; date: string; nextDate: string; market: Reading;
  reveal: { action: string; summary: string };
}
interface Today {
  date: string | null; asOf: string | null;
  status: "ready" | "stale" | "unavailable";
  summary: string; market: Reading | null;
  matches: { caseId: string; date: string; action: string; summary: string }[];
}

export function marketComparison(bars: Bar[], cases: HistoricalCase[], fetchedAt: string, now: Date,
  reviewDate = localClock(now, "Asia/Shanghai").day): Today {
  // A cached intraday bar can arrive after close. Check the acquisition time too.
  const acquired = Date.parse(fetchedAt);
  const closed = bars.filter(b => {
    const end = Date.parse(b.date + "T15:00:00+08:00");
    return b.date <= reviewDate && end <= now.getTime() && end <= acquired;
  });
  const last = closed.at(-1);
  const result: Today = { date: last?.date ?? null, asOf: last ? last.date + "T15:00:00+08:00" : null,
    status: "unavailable", summary: "缺少上证指数完整收盘序列，暂时无法对照。", market: null, matches: [] };
  if (!last || closed.length < 21) return result;
  const change = (period: number) => Number(((last.close / closed.at(-1 - period)!.close - 1) * 100).toFixed(2));
  const market = { pct: change(1), d5: change(5), d20: change(20) };
  result.market = market;
  if (last.date !== reviewDate) {
    return { ...result, status: "stale", summary: "仅展示最近取得的完整收盘日。今日暂无已核对的收盘数据。" };
  }
  // Descriptive retrieval only. Fixed tolerances (percentage points) prevent displaying
  // the least dissimilar case when the entire historical sample is far from today.
  const eligible = cases.filter(c => c.nextDate <= last.date && c.date < last.date && c.reveal.action !== "unknown")
    .map(c => ({ c, distance: Math.max(Math.abs(c.market.pct - market.pct),
      Math.abs(c.market.d5 - market.d5) / 2, Math.abs(c.market.d20 - market.d20) / 4) }))
    .filter(hit => hit.distance <= 1)
    .sort((a, b) => a.distance - b.distance || a.c.date.localeCompare(b.c.date));
  result.matches = eligible.slice(0, 3).map(({ c }) => ({ caseId: c.id, date: c.date, action: c.reveal.action, summary: c.reveal.summary }));
  result.status = "ready";
  result.summary = "按上证指数当日、5 日、20 日涨跌幅对照，差距上限分别为 1、2、4 个百分点。" +
    (eligible.length ? `共找到 ${eligible.length} 个可对照日期，展示差距最小的 ${result.matches.length} 个。` : "现有案例均未满足条件。") +
    "这些指数条件尚不足以推断本人明日动作或板块偏好。";
  return result;
}

export async function mentorToday(ctx: ServiceContext, cases: HistoricalCase[], signal?: AbortSignal): Promise<Today> {
  let reviewDate: string;
  try {
    reviewDate = await selectedCloseDate(ctx,undefined,signal ?? AbortSignal.timeout(20_000));
  } catch {
    signal?.throwIfAborted();
    return {date:null,asOf:null,status:"unavailable",summary:"交易日历暂未确定最近的完整收盘日。",market:null,matches:[]};
  }
  const query = { endpoint: "tx_kline", symbol: "sh000001", args: { count: 60 } };
  let previous: Today | undefined;
  try {
    const cached = await fetchEndpoint(ctx, { ...query, consistency: { mode: "cache_only" }, signal });
    previous = marketComparison(klineBars(ctx, cached.envelope, cached.out_dir), cases, cached.fetched_at, new Date(),reviewDate);
    if (previous.status === "ready") return previous;
  } catch {
    signal?.throwIfAborted();
  }
  try {
    const data = await fetchEndpoint(ctx, { ...query, consistency: { mode: "prefer_cache", max_age_ms: 60_000 },
      timeout_ms: 18_000, signal: signal ?? AbortSignal.timeout(20_000) });
    const latest = marketComparison(klineBars(ctx, data.envelope, data.out_dir), cases, data.fetched_at, new Date(),reviewDate);
    if (!previous?.date || latest.date && latest.date >= previous.date) return latest;
  } catch {
    signal?.throwIfAborted();
  }
  return previous ?? { date: null, asOf: null, status: "unavailable", summary: "暂未取得上证指数收盘数据，可先练习历史案例。", market: null, matches: [] };
}
