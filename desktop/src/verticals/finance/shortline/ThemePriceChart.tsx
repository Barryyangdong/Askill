import { useEffect, useMemo, useState } from "react";
import { backend, type Envelope } from "@/lib/backend";
import { EChart } from "@/components/ui/EChart";
import { usePalette } from "@/components/ui/chartPalette";
import { createReviewCache } from "./reviewCache";
import { cn } from "@/lib/utils";
import { signed } from "./format";

type Member = { code: string; name?: string };
type Candle = { date: string; close: number; open: number; high: number; low: number };
type Price = { close: number | null; change: number | null; return10: number | null; return20: number | null };
const reference = "sh000001";
const sampleLimit = 30;
const prices = createReviewCache<Candle[]>(240);
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

function ticker(raw: string) {
  const code = raw.trim().toLowerCase();
  if (/^(?:sh)?6\d{5}$/.test(code)) return "sh" + code.slice(-6);
  if (/^(?:sz)?[03]\d{5}$/.test(code)) return "sz" + code.slice(-6);
  return null;
}

export function parseThemeBars(envelope: Envelope, symbol: string, start: string, day: string): Candle[] {
  const extra = envelope.extra;
  if (envelope.status === "failed" || extra?.code !== symbol || extra.period !== "day" || extra.adjust !== "none" ||
      !Array.isArray(extra.close_series)) return [];
  const rows: Candle[] = [];
  for (const row of extra.close_series) {
    if (!row || typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
        row.date < start || row.date > day || row.date <= (rows.at(-1)?.date ?? "") ||
        ![row.open, row.high, row.low, row.close].every(positive) ||
        row.low > Math.min(row.open, row.close) || row.high < Math.max(row.open, row.close)) return [];
    rows.push(row);
  }
  return rows.at(-1)?.date === day ? rows : [];
}

let running = 0;
const waiters: (() => void)[] = [];
async function withFetchSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= 4) await new Promise<void>(resolve => waiters.push(resolve));
  else running++;
  try { return await work(); }
  finally {
    const next = waiters.shift();
    if (next) next(); else running--;
  }
}

function readBars(day: string, symbol: string) {
  return prices.read(day + ":" + symbol, false, () => withFetchSlot(async () => {
    const start = new Date(Date.parse(day + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
    const args = { period: "day", start, end: day, adjust: "" };
    let result = await backend.fetch("tx_kline", { symbol, args });
    if (result.cached && result.envelope.status !== "failed" && !Array.isArray(result.envelope.extra?.close_series))
      result = await backend.fetch("tx_kline", { symbol, args, refresh: true });
    return parseThemeBars(result.envelope, symbol, start, day);
  }), rows => rows.length ? 3600000 : 60000);
}

function useBars(day: string, members: readonly Member[], selected?: string, showBenchmark = false) {
  const all = [...new Set(members.map(m => ticker(m.code)).filter((s): s is string => s !== null))];
  const codes = selected ? [ticker(selected)].filter((s): s is string => s !== null) : all.slice(0, sampleLimit);
  const symbols = showBenchmark || codes.length ? [reference, ...codes].join(",") : "";
  const key = day + ":" + symbols;
  const [result, setResult] = useState<{ key: string; rows: Record<string, Candle[]>; loading: boolean } | null>(null);
  useEffect(() => {
    if (!symbols || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    let active = true;
    const rows: Record<string, Candle[]> = {};
    const queue = symbols.split(",");
    async function worker() {
      while (active && queue.length) {
        const symbol = queue.shift()!;
        try { rows[symbol] = await readBars(day, symbol); }
        catch { rows[symbol] = []; }
        if (active) setResult({ key, rows: { ...rows }, loading: Object.keys(rows).length < symbols.split(",").length });
      }
    }
    for (let i = 0; i < 3; i++) void worker();
    return () => { active = false; };
  }, [key, day, symbols]);
  if (result?.key === key) return { rows: result.rows, codes, loading: result.loading };
  const cached: Record<string, Candle[]> = {};
  for (const symbol of symbols ? symbols.split(",") : []) {
    const bars = prices.peek(day + ":" + symbol);
    if (bars) cached[symbol] = bars;
  }
  return { rows: cached, codes, loading: !!symbols && Object.keys(cached).length < codes.length + 1 };
}

const percent = (value: number, base: number) => (value / base - 1) * 100;
export function themePriceMetrics(bars: Candle[], benchmark: Candle[]): Price {
  const close = bars.at(-1)?.close ?? null;
  if (!close) return { close: null, change: null, return10: null, return20: null };
  const change = (back: number) => {
    const target = benchmark.at(-back - 1)?.date;
    const base = bars.find(b => b.date === target)?.close;
    return base ? percent(close, base) : null;
  };
  return { close, change: change(1), return10: change(10), return20: change(20) };
}

export function useThemePrices(day: string, members: readonly Member[]) {
  const { rows, loading } = useBars(day, members);
  const byCode: Record<string, Price> = {};
  for (const [symbol, bars] of Object.entries(rows))
    if (symbol !== reference) byCode[symbol.slice(2)] = themePriceMetrics(bars, rows[reference] ?? []);
  return { byCode, loading };
}

export function ThemePriceChart({ day, name, members, symbol, compact = false }: { day: string; name: string; members: readonly Member[]; symbol?: string; compact?: boolean }) {
  const { rows, codes, loading } = useBars(day, members, symbol, !symbol);
  const p = usePalette();
  const benchmark = rows[reference]?.slice(-21) ?? [];
  const stock = symbol ? rows[ticker(symbol) ?? ""] ?? [] : [];
  const calendar = symbol ? stock.slice(-21) : benchmark;
  const baseline = benchmark[0]?.date;
  const priorClose = benchmark.at(-2)?.close;
  const lastClose = benchmark.at(-1)?.close;
  const indexChange = priorClose && lastClose ? percent(lastClose, priorClose) : null;
  const sample = loading ? [] : codes.map(code => rows[code] ?? []).filter(bars => bars.some(b => b.date === baseline));
  const stockName = members.find(m => ticker(m.code) === ticker(symbol ?? ""))?.name ?? symbol;
  const option = useMemo(() => {
    if (!calendar.length) return null;
    const dates = calendar.map(b => b.date);
    const common = {
      animation: false, grid: { left: 52, right: 18, top: 34, bottom: 30 },
      tooltip: { trigger: "axis", backgroundColor: p.tooltipBg, textStyle: { color: p.tooltipText } },
      legend: { textStyle: { color: p.text } },
      xAxis: { type: "category", data: dates, axisLabel: { color: p.text, formatter: (s: string) => s.slice(5) } },
      yAxis: { type: "value", scale: true, axisLabel: { color: p.text, formatter: symbol ? "{value}" : "{value}%" }, splitLine: { lineStyle: { color: p.grid } } },
    };
    if (symbol) return { ...common, series: [{ name: stockName, type: "candlestick",
      itemStyle: { color: p.rise, borderColor: p.rise, color0: p.fall, borderColor0: p.fall },
      data: calendar.map(b => [b.open, b.close, b.low, b.high]) }] };
    const returns = sample.map(bars => {
      const base = bars.find(b => b.date === baseline)!.close;
      return new Map(bars.map(b => [b.date, percent(b.close, base)]));
    });
    const base = benchmark[0]!.close;
    const normalized = (n: number) => +percent(n, base).toFixed(2);
    return { ...common,
      grid: [{ left: 46, right: 18, top: 38, height: "33%" }, { left: 46, right: 18, top: "57%", height: "29%" }],
      legend: { top: 1, itemWidth: 13, itemHeight: 8, data: ["上证指数", "题材样本（等权）"], textStyle: { color: p.text, fontSize: 11 } },
      axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
      tooltip: { ...common.tooltip, axisPointer: { type: "cross" } },
      xAxis: [0, 1].map((i) => ({ ...common.xAxis, gridIndex: i, axisLabel: { color: p.text, show: i === 1, formatter: (s: string) => s.slice(5) } })),
      yAxis: [0, 1].map((i) => ({ ...common.yAxis, gridIndex: i })),
      series: [
        { name: "上证指数", type: "candlestick", xAxisIndex: 0, yAxisIndex: 0,
          itemStyle: { color: p.rise, borderColor: p.rise, color0: p.fall, borderColor0: p.fall },
          data: benchmark.map(b => [b.open, b.close, b.low, b.high].map(normalized)),
          markLine: { silent: true, symbol: "none", label: { show: false }, data: [{ xAxis: day }] } },
        { name: "题材样本（等权）", type: "line", xAxisIndex: 1, yAxisIndex: 1, showSymbol: false, lineStyle: { color: p.primary },
          data: dates.map(d => {
            if (!returns.length || returns.some(r => !r.has(d))) return null;
            return +(returns.reduce((sum, r) => sum + r.get(d)!, 0) / returns.length).toFixed(2);
          }), markLine: { silent: true, symbol: "none", label: { show: false }, data: [{ xAxis: day }] } },
      ] };

  }, [calendar, p, sample, symbol, stockName, benchmark, baseline, day]);
  return <section className="glass min-w-0 p-4">
    <header className="flex flex-wrap items-baseline justify-between gap-1">
      <h3 className="text-sm font-semibold">{symbol ? stockName + " · 日 K" : "走势对照"}</h3>
      {!symbol && indexChange != null && <span className="text-xs text-muted-foreground">上证当日 <b className={cn("font-mono", indexChange > 0 && "text-danger", indexChange < 0 && "text-success")}>{signed(indexChange)}</b></span>}
    </header>
    {option ? <EChart option={option} height={symbol ? 245 : compact ? 252 : 292} /> : <p role="status" className="py-6 text-sm text-muted-foreground">{loading ? "正在读取历史行情…" : "所选日期暂无可核验的日线数据。"}</p>}
    <p className="mt-1 text-xs text-muted-foreground">{symbol ? "腾讯不复权日线" : <>{name}样本等权收盘 · 相对窗口首日收盘 · {loading ? "读取中" : `覆盖 ${sample.length}/${codes.length} 只`}</>}</p>
  </section>;
}
