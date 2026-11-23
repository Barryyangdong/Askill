import { localClock } from "../../notify.ts";
import { fetchEndpoint, ServiceError, type FetchResult, type ServiceContext } from "../../service.ts";
import { readSnapshot, snapshotKey, type Consistency } from "../../snapshot.ts";
import { pool, SCHEDULE_TZ } from "../schedule.ts";
import { retentionFloor, tradeWindow, validDate } from "./history.ts";

type Row = { date: string; values: Record<string, unknown> | null; complete?: boolean };

export async function reviewBoardMetrics(ctx: ServiceContext, query: Record<string, string>, signal: AbortSignal) {
  const date = query.date ?? "";
  const now = new Date();
  if (!validDate(date) || date > localClock(now, SCHEDULE_TZ).day || (query.days && !["1", "15"].includes(query.days)))
    throw new ServiceError("bad_query", "请指定有效的复盘日和取数窗口。");
  const days = query.days === "1" ? 1 : 15;
  const { window, targetPresent, gap } = await tradeWindow(ctx, date, days + 2, signal);
  if (!targetPresent) return { date, series: [], gap: gap ?? "所选日期未在交易日窗口中。" };
  const sessions = window.slice(-days);
  const oldest = retentionFloor(now);
  async function loadDay(day: string, consistency: Consistency): Promise<Row> {
    const index = window.indexOf(day);
    const args = { day, prev: window[index - 1] ?? null, earlier: window[index - 2] ?? null };
    const endpoint = "cn_review_board_metrics";
    const parse = (envelope: FetchResult["envelope"]): Row | undefined => {
      const extra = envelope.extra as Partial<Row> | undefined;
      if (extra?.date === day && extra.values && (envelope.status === "ok" || envelope.status === "partial"))
        return { date: day, values: extra.values, complete: extra.complete === true };
    };
    const snapshot = readSnapshot<FetchResult>(ctx.dataRoot, snapshotKey(endpoint, "", args));
    const previous = snapshot && parse(snapshot.payload.envelope);
    // Complete close data remains reusable. Partial close data is refreshed after its TTL, with a dated fallback.
    if (consistency.mode === "cache_only" || (previous?.complete && consistency.mode !== "fresh"))
      return previous || { date: day, values: null };
    try {
      const { envelope } = await fetchEndpoint(ctx, {
        endpoint, args, signal, timeout_ms: 30_000,
        consistency,
      });
      const current = parse(envelope);
      if (current?.complete || (current && !previous?.complete)) return current;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    return previous || { date: day, values: null };
  }
  const series = await pool(sessions, 3, async day => {
    if (day < oldest) return loadDay(day, { mode: "cache_only" });
    if (day === date && query.refresh === "1") {
      const fresh = await loadDay(day, { mode: "fresh" });
      return fresh.values ? fresh : loadDay(day, { mode: "cache_only" });
    }
    return loadDay(day, { mode: "prefer_cache" });
  });
  const missing = series.filter(row => !row.values && row.date >= oldest);
  if (sessions.length === 1 || series.some(row => row.values)) {
    const retries = await pool(missing, 2, row => loadDay(row.date, { mode: "prefer_cache" }));
    const recovered = new Map(retries.map(row => [row.date, row]));
    return { date, series: series.map(row => recovered.get(row.date) ?? row), gap };
  }
  return { date, series, gap };
}
