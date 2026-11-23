import { localClock } from "../../notify.ts";
import { fetchEndpoint, ServiceError, type ServiceContext } from "../../service.ts";
import { pool, SCHEDULE_TZ } from "../schedule.ts";
import { tradeWindow, validDate } from "./history.ts";

const SOURCE = "东方财富龙虎榜公开披露 · 游资为 Tushare 公开示例的营业部标签样本";
const DAYS = 15;

type Amounts = { buy: number | null; sell: number | null; net: number | null; turnover: number | null };
type Seat = Amounts & { name: string; seat: string };
type Group = Amounts & { seats: Seat[] };
type DragonRow = { symbol: string; name: string; board: string; pct: number | null; span: number | null;
  total: Amounts; hot: Group; institution: Group };
type Daily = { date: string; rows: DragonRow[]; gaps: string[]; fetched_at?: string };
type Estimate = { name: string; symbol: string; stock: string; board: string; net: number; last_date: string; days: number };

function queryDate(query: Record<string, string>) {
  const date = query.date ?? "";
  if (!validDate(date) || date > localClock(new Date(), SCHEDULE_TZ).day)
    throw new ServiceError("bad_query", "请指定有效的复盘日期。");
  if (query.refresh !== undefined && query.refresh !== "1") throw new ServiceError("bad_query", "refresh 只能是 1");
  return date;
}

async function readDaily(ctx: ServiceContext, date: string, refresh: boolean, signal: AbortSignal): Promise<Daily> {
  try {
    const request = { endpoint: "cn_review_dragon", args: { day: date }, refresh, signal, timeout_ms: 45_000 };
    let result = await fetchEndpoint(ctx, request);
    const oldLabels = result.envelope.extra as { seat_labels_version?: number } | undefined;
    if (result.cached && oldLabels?.seat_labels_version !== 2) {
      try {
        const updated = await fetchEndpoint(ctx, { ...request, refresh: true });
        if (updated.envelope.status === "ok" || updated.envelope.status === "partial") result = updated;
      } catch (error) {
        if (signal.aborted) throw error;
      }
    }
    const { envelope, fetched_at } = result;
    const extra = envelope.extra as (Partial<Daily> & { seat_labels_version?: number }) | undefined;
    if ((envelope.status === "ok" || envelope.status === "partial") &&
        extra?.date === date && Array.isArray(extra.rows) && extra.rows.length) {
      const gaps = Array.isArray(extra.gaps) ? [...extra.gaps] : [];
      if (extra.seat_labels_version !== 2) gaps.push(`${date} 暂时使用上次的游资标签。`);
      return { date, rows: extra.rows, gaps, fetched_at };
    }
  } catch (error) {
    if (signal.aborted) throw error;
  }
  return { date, rows: [], gaps: [`${date} 暂未核验龙虎榜披露`] };
}

function estimatePositions(days: Daily[]): Estimate[] {
  const positions = new Map<string, Estimate & { disclosedDays: Set<string> }>();
  for (const day of days) {
    for (const row of day.rows) {
      if (row.span !== 1 || row.hot.net === null) continue;
      for (const seat of row.hot.seats) {
        if (seat.net === null || seat.net === 0) continue;
        const key = `${seat.name}:${row.symbol}`;
        const current = positions.get(key) ?? {
          name: seat.name, symbol: row.symbol, stock: row.name, board: row.board, net: 0, last_date: day.date,
          days: 0, disclosedDays: new Set<string>(),
        };
        current.net += seat.net;
        current.last_date = day.date;
        current.disclosedDays.add(day.date);
        positions.set(key, current);
      }
    }
  }
  return [...positions.values()].filter(row => row.net > 0)
    .sort((a, b) => b.net - a.net)
    .map(({ disclosedDays, ...row }) => ({ ...row, days: disclosedDays.size, net: Math.round(row.net * 100) / 100 }));
}

function dailyTrend({ date, rows }: Daily) {
  const singleDay = rows.filter(row => row.span === 1);
  const sum = (group: "total" | "hot" | "institution", field: "turnover" | "net") => {
    if (!singleDay.length || singleDay.some(row => row[group][field] === null)) return null;
    return Math.round(singleDay.reduce((acc, row) => acc + row[group][field]!, 0) * 100) / 100;
  };
  const amounts = (group: "total" | "hot" | "institution") => ({ turnover: sum(group, "turnover"), net: sum(group, "net") });
  return { date, total: amounts("total"), hot: amounts("hot"), institution: amounts("institution") };
}

export async function reviewDragon(ctx: ServiceContext, query: Record<string, string>, signal: AbortSignal) {
  const date = queryDate(query);
  const data = await readDaily(ctx, date, query.refresh === "1", signal);
  return { ...data, source: SOURCE, estimates: estimatePositions([data]) };
}

export async function reviewDragonTrend(ctx: ServiceContext, query: Record<string, string>, signal: AbortSignal) {
  const date = queryDate(query);
  const { window, gap, targetPresent } = await tradeWindow(ctx, date, DAYS, signal);
  if (!targetPresent) return { date, series: [], estimates: [], gaps: [gap ?? "所选日期未在交易日窗口中。"], source: SOURCE };
  const days = await pool(window, 3, day => readDaily(ctx, day, day === date && query.refresh === "1", signal));
  const gaps = [...(gap ? [gap] : []), ...days.flatMap(day => day.gaps)];
  return { date, series: days.map(dailyTrend), estimates: estimatePositions(days), gaps: [...new Set(gaps)], source: SOURCE };
}
