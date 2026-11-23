import { localClock } from "../../notify.ts";
import { fetchEndpoint, ServiceError, type FetchResult, type ServiceContext } from "../../service.ts";
import { readSnapshot, snapshotKey } from "../../snapshot.ts";
import { pool, SCHEDULE_TZ } from "../schedule.ts";
import { shortlineLimitTrend, tradeWindow, validDate } from "./history.ts";

type Evidence = { record_key?: string; field?: string; period?: string; value?: unknown; source?: string };
const markets = ["SH", "SZ", "BJ"];
const fields = ["market_up_count", "market_down_count", "market_flat_count"];

export function closingBreadth(envelope: FetchResult["envelope"], date: string) {
  const extra = envelope.extra as { date?: string; exchange_close_dates?: Record<string, string> } | undefined;
  if ((envelope.status !== "ok" && envelope.status !== "partial") || extra?.date !== date ||
      !Array.isArray(envelope.evidence)) return null;
  const evidence = envelope.evidence as Evidence[];
  let up = 0;
  let total = 0;
  for (const market of markets) {
    if (extra.exchange_close_dates?.[market] !== date) return null;
    const counts = fields.map(field => evidence.find(row => row?.record_key === "exchange|" + market &&
      row.field === field && row.period === date && row.source === "tdx")?.value);
    if (!counts.every((value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0)) return null;
    const marketTotal = counts.reduce((sum, value) => sum + value, 0);
    if (!marketTotal) return null;
    up += counts[0]!;
    total += marketTotal;
  }
  return { up, total };
}

export function rhythmScore(breadth: {up: number; total: number} | null, limits: {up: number | null; down: number | null} | undefined) {
  if (!breadth || limits?.up == null || limits.down == null || limits.up + limits.down === 0) return null;
  return Math.round(50 * (breadth.up / breadth.total + limits.up / (limits.up + limits.down)));
}

export async function reviewSentimentRhythm(ctx: ServiceContext, query: Record<string, string>, signal: AbortSignal) {
  const date = query.date ?? "";
  const now = new Date();
  const clock = localClock(now, SCHEDULE_TZ);
  if (!validDate(date) || date > clock.day || (query.refresh !== undefined && query.refresh !== "1"))
    throw new ServiceError("bad_query", "请指定有效的复盘日期。");
  const { window, targetPresent } = await tradeWindow(ctx, date, 15, signal);
  if (!targetPresent) return { date, series: [] };

  const [breadths, limits] = await Promise.all([
    pool(window, 3, async day => {
      if (day === clock.day && clock.hm < "15:00") return null;
      const endpoint = "cn_market_breadth_history";
      const args = { date: day };
      const stored = readSnapshot<FetchResult>(ctx.dataRoot, snapshotKey(endpoint, "", args));
      const cached = stored && closingBreadth(stored.payload.envelope, day);
      const refresh = day === date && query.refresh === "1";
      if (cached && !refresh) return cached;
      try {
        const { envelope } = await fetchEndpoint(ctx, {
          endpoint, args, signal, timeout_ms: 15_000, consistency: { mode: "fresh" },
        });
        return closingBreadth(envelope, day) ?? cached;
      } catch (error) {
        if (signal.aborted) throw error;
        return cached;
      }
    }),
    shortlineLimitTrend(ctx, query, signal, now),
  ]);
  const limitByDay = new Map(limits.series.map(row => [row.date, row]));
  return { date, series: window.map((day, index) => {
    const breadth = breadths[index] ?? null;
    return { date: day, up: breadth?.up ?? null, total: breadth?.total ?? null, score: rhythmScore(breadth, limitByDay.get(day)) };
  }) };
}
