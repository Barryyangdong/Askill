import { useEffect, useMemo, useRef, useState } from "react";
import { Gauge } from "lucide-react";
import { ContextHelp } from "@/components/ui/ContextHelp";
import { EChart } from "@/components/ui/EChart";
import { GlassCard } from "@/components/ui/GlassCard";
import { usePalette } from "@/components/ui/chartPalette";
import { backend } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { createReviewCache } from "../shortline/reviewCache";
import { ReviewBadge } from "./ReviewBadge";

type Stage = "all" | "first" | "chain";
type Board = "main" | "all";
type Premium = { value: number | null; sample: number; total: number };
type Metrics = {
  highest: number; up: number; broken: number | null; failure_rate: number | null;
  drawdown: number | null; drawdown_sample: number;
  up_premium: Premium | null; broken_premium: Premium | null;
  ladder: { count: number; promotion: number | null }[];
};
type SeriesRow = { date: string; values: Record<`${Board}:${Stage}`, Metrics> | null; complete?: boolean };
type Series = { date: string; series: SeriesRow[]; gap?: string | null };
const dayCache = createReviewCache<Series>(20, {
  namespace: "board-metrics-day", limit: 8, project: value => value,
  valid: value => !!value?.date && Array.isArray(value.series) && value.series.some(row => row.date === value.date && row.values),
});
const trendCache = createReviewCache<Series>(20, {
  namespace: "board-metrics-trend-v2", limit: 6, project: value => value,
  valid: value => !!value?.date && Array.isArray(value.series) && value.series.some(row => row.values),
});
const periods = ["首板", "二板", "三板", "四板", "五板", "六板及以上"];
const stages = [["all", "全部"], ["first", "首板"], ["chain", "连板"]] as const;
const markets = [["main", "仅主板"], ["all", "全市场"]] as const;
const percent = (n: number | null | undefined, signed = false) =>
  n == null ? "—" : `${signed && n > 0 ? "+" : ""}${n.toFixed(2)}%`;

function read(day: string, days: 1 | 15, refresh: boolean) {
  const cache = days === 1 ? dayCache : trendCache;
  const previous = cache.peek(day);
  const previousByDate = new Map(previous?.series.map(row => [row.date, row]));
  return cache.read(day, refresh, async () => {
    const result = await backend.shortlineView<Series>("review_board_metrics", { date: day, days, refresh });
    if (result.date !== day) throw new Error("打板指标日期与所选复盘日不一致。");
    return { ...result, series: result.series.filter(point => point.date <= day)
      .map(point => point.values ? point : previousByDate.get(point.date) ?? point) };
  }, r => r.series.length === days && r.series.every(row => row.complete) ? 30 * 60_000 : 90_000);
}

export function ReviewBoardMetrics({ day, revision }: { day: string; revision: number }) {
  const [stage, setStage] = useState<Stage>("all");
  const [board, setBoard] = useState<Board>("main");
  const [selected, setSelected] = useState(() => dayCache.peek(day)?.series.find(row => row.date === day));
  const [history, setHistory] = useState(() => trendCache.peek(day));
  const series = history?.date === day ? history.series : undefined;
  const [loading, setLoading] = useState({ metrics: !selected, trend: !series });
  const [error, setError] = useState("");
  const previous = useRef(revision);
  const palette = usePalette();
  useEffect(() => {
    let active = true;
    const refresh = previous.current !== revision;
    previous.current = revision;
    setLoading({ metrics: true, trend: true });
    setError("");
    void read(day, 1, refresh).then(result => {
      if (!active) return;
      const row = result.series.find(row => row.date === day);
      if (row?.values) setSelected(row);
      else setError(result.gap ?? "当前复盘日打板指标暂未取到。");
    }).catch(() => { if (active) setError("当前复盘日打板指标暂未取到。"); })
      .finally(() => { if (active) setLoading(state => ({ ...state, metrics: false })); });
    void read(day, 15, refresh).then(result => {
      if (active) setHistory(previous => result.series.some(row => row.values) || previous?.date !== day ? result : previous);
    }).catch(() => { /* 同一复盘日已有图表时，取数失败仍可查看。 */ })
      .finally(() => { if (active) setLoading(state => ({ ...state, trend: false })); });
    return () => { active = false; };
  }, [day, revision]);

  const scope = `${board}:${stage}` as const;
  const current = selected?.date === day ? selected.values?.[scope] : null;
  const trend = useMemo(() => (series ?? []).filter(row => row.date <= day)
    .map(row => ({ date: row.date, m: row.values?.[scope] })), [series, day, scope]);
  const anyTrend = trend.some(row => row.m != null);
  const missingDates = trend.filter(({ m }) => !m).map(({ date }) => date.slice(5));
  const partialDates = trend.filter(({ m }) => m &&
    (m.failure_rate == null || m.broken_premium?.value == null || m.up_premium?.value == null))
    .map(({ date }) => date.slice(5));
  const option = useMemo(() => ({
    animation: false,
    color: [palette.primary, palette.fall, palette.rise, "#c58b20"],
    grid: { left: 42, right: 41, top: 51, bottom: 26 },
    legend: { top: 4, itemWidth: 10, itemHeight: 7, textStyle: { color: palette.text, fontSize: 10 } },
    tooltip: { trigger: "axis", backgroundColor: palette.tooltipBg, textStyle: { color: palette.tooltipText } },
    xAxis: { type: "category", data: trend.map(row => row.date.slice(5)),
      axisLabel: { color: palette.text, fontSize: 10, hideOverlap: true }, axisLine: { lineStyle: { color: palette.axis } } },
    yAxis: [
      { type: "value", axisLabel: { color: palette.text, fontSize: 10, formatter: "{value}%" },
        splitLine: { lineStyle: { color: palette.grid, type: "dashed" } } },
      { type: "value", min: 0, minInterval: 1, axisLabel: { color: palette.text, fontSize: 10, formatter: "{value} 板" }, splitLine: { show: false } },
    ],
    series: [
      { name: "炸板率", values: trend.map(row => row.m?.failure_rate), axis: 0 },
      { name: "昨炸板溢价", values: trend.map(row => row.m?.broken_premium?.value), axis: 0 },
      { name: "昨涨停溢价", values: trend.map(row => row.m?.up_premium?.value), axis: 0 },
      { name: "连板高度", values: trend.map(row => row.m?.highest), axis: 1 },
    ].map(line => ({ name: line.name, type: "line", connectNulls: false, symbolSize: 5, yAxisIndex: line.axis,
      tooltip: { valueFormatter: (v: unknown) => typeof v === "number" ? line.axis ? `${v} 板` : percent(v) : "—" },
      data: line.values.map(n => n ?? null) })),
  }), [trend, palette]);
  const showNum = (n: number | null) => n == null ? "—" : n;
  const stats = current ? [
    { key: "连板高度", value: current.highest ? `${current.highest} 板` : "无封板" },
    { key: "炸板率", value: percent(current.failure_rate) },
    { key: "炸板 / 涨停", value: `${showNum(current.broken)} / ${current.up}` },
    { key: "炸板平均回撤", value: percent(current.drawdown, true), signed: current.drawdown, sample: current.drawdown_sample, total: current.broken },
    { key: "昨日涨停溢价", value: percent(current.up_premium?.value, true), signed: current.up_premium?.value,
      sample: current.up_premium?.sample, total: current.up_premium?.total },
    { key: "昨日炸板溢价", value: percent(current.broken_premium?.value, true), signed: current.broken_premium?.value,
      sample: current.broken_premium?.sample, total: current.broken_premium?.total },
  ] : [];
  return <GlassCard className="min-w-0">
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Gauge className="h-4 w-4 text-primary" />打板指标</h3>
      <ReviewBadge>{day}</ReviewBadge>
      <ContextHelp>按东财收盘池统计。炸板率为炸板数除以涨停与炸板之和。回撤以触板价格为基准，溢价为前一交易日样本在本日的平均收盘涨跌幅。首板与连板按尝试封板前的连板数区分，均值只使用已取得报价的样本。</ContextHelp>
    </div>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
      <div role="group" aria-label="打板板位" className="inline-flex rounded-md border border-border/70 p-0.5">
        {stages.map(([id, label]) => <button key={id} type="button" aria-pressed={stage === id} onClick={() => setStage(id)}
          className={cn("rounded px-2 py-1", stage === id ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:text-foreground")}>{label}</button>)}
      </div>
      <div role="group" aria-label="打板市场范围" className="inline-flex rounded-md border border-border/70 p-0.5">
        {markets.map(([id, label]) => <button key={id} type="button" aria-pressed={board === id} onClick={() => setBoard(id)}
          className={cn("rounded px-2 py-1", board === id ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:text-foreground")}>{label}</button>)}
      </div>
    </div>
    {current ? <>
      <dl className="grid grid-cols-2 gap-1.5 min-[460px]:grid-cols-3">
        {stats.map(stat => <div key={stat.key} className="min-w-0 rounded-lg border border-border/60 bg-muted/20 px-2 py-1.5">
          <dt className="text-xs text-muted-foreground">{stat.key}</dt>
          <dd className={cn("mt-1 text-base font-semibold tabular-nums", (stat.signed ?? 0) > 0 ? "text-danger" : (stat.signed ?? 0) < 0 ? "text-success" : "")}>{stat.value}</dd>
          {stat.sample !== undefined && stat.total != null && stat.sample < stat.total &&
            <p className="text-[10px] text-muted-foreground">样本 {stat.sample} / {stat.total}</p>}
        </div>)}
      </dl>
      <dl className="mt-2 grid grid-cols-3 gap-1.5">
        {current.ladder.map((row, i) => <div key={periods[i]} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 rounded border border-border/60 px-2 py-1 text-xs">
          <dt className="text-muted-foreground">{periods[i]}</dt>
          <dd className="font-semibold tabular-nums">{row.count}</dd>
          {i > 0 && <span className="text-[10px] text-muted-foreground">晋级 {percent(row.promotion)}</span>}
        </div>)}
      </dl>
    </> : <p role="status" className="py-4 text-xs text-muted-foreground">
      {loading.metrics ? "正在读取当日打板指标…" : error || "所选交易日暂无可用打板数据。"}
    </p>}
    <div className="mt-3 border-t border-border/60 pt-2">
      <h4 className="text-xs text-muted-foreground">近 15 个交易日</h4>
      {anyTrend ? <EChart option={option} height={206} />
        : <p role="status" className="py-4 text-xs text-muted-foreground">{loading.trend ? "正在读取历史打板指标…" : "历史打板指标暂未取得。"}</p>}
      {anyTrend && missingDates.length > 0 && <p className="text-[11px] leading-5 text-muted-foreground">
        {missingDates.join("、")} 未取得当日数据。
      </p>}
      {anyTrend && partialDates.length > 0 && <p className="text-[11px] leading-5 text-muted-foreground">
        {partialDates.join("、")} 部分指标缺数据。
      </p>}
    </div>
  </GlassCard>;
}
