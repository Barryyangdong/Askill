import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ChartNoAxesCombined } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { ContextHelp } from "@/components/ui/ContextHelp";
import { EChart } from "@/components/ui/EChart";
import { usePalette } from "@/components/ui/chartPalette";
import { backend, num, rows } from "@/lib/backend";
import { parseChartSettings } from "@/lib/chartAnnotations";
import { cn } from "@/lib/utils";
import { useLocalPreference } from "../hooks/useLocalPreference";
import { createReviewCache } from "../shortline/reviewCache";
import { ReviewBadge } from "./ReviewBadge";

const trendDays = 15;
const chartHeight = 310;
const archiveTtl = 7 * 86_400_000;
const emptyText = "该交易日暂无可用分时记录。腾讯提供最近五个交易日，本机已保存的分时可继续查看。";
const sessionTimes = ([[570, 690], [780, 900]] as const).flatMap(([start, end]) =>
  Array.from({ length: end - start + 1 }, (_, i) => {
    const minute = start + i;
    return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  }));
const axisTicks = new Set(["09:30", "10:30", "11:30", "14:00", "15:00"]);

type LimitPoint = { date: string; up: number | null; down: number | null };
type MinutePoint = { price: number | null; amount: number | null };
type MinuteView = { day: string; points: MinutePoint[]; baseline: number | null; complete: boolean };

const limitCache = createReviewCache<LimitPoint[]>(16, {
  namespace: "limit-trend", archive: true, limit: 12, project: x => x, valid: x => Array.isArray(x) && x.length > 0,
});
const minuteArchive = createReviewCache<MinuteView>(32, {
  namespace: "sh-index-minutes", archive: true, limit: 24, project: x => x,
  valid: x => !!x?.complete && Array.isArray(x.points) && x.points.length === sessionTimes.length,
});
const minuteCache = createReviewCache<MinuteView>(8);

export function readLimits(day: string, refresh: boolean) {
  return limitCache.read(day, refresh, async () => {
    const result = await backend.shortlineView<{ date: string; series: LimitPoint[] }>("shortline_limit_trend", { date: day, refresh });
    if (result.date !== day) throw new Error("涨跌停趋势返回的日期与所选复盘日不一致。");
    return result.series.filter(s => s.date <= day);
  }, points => points.length === trendDays && points.every(p => p.up !== null && p.down !== null) ? archiveTtl : 90_000);
}

function readMinutes(day: string, refresh: boolean) {
  const archived = minuteArchive.peek(day);
  if (archived && !refresh) return Promise.resolve(archived);
  return minuteCache.read(day, refresh, async () => {
    try {
      const { envelope } = await backend.fetch("cn_review_index_minutes", { args: { date: day }, refresh });
      if (!["ok", "partial"].includes(envelope.status) || envelope.extra?.date !== day ||
          !envelope.evidence.length || envelope.evidence.some(item => item.period !== day)) throw new Error(emptyText);
      const lookup = new Map(rows(envelope).map(row => [row.key, row.fields]));
      const points = sessionTimes.map(time => {
        const fields = lookup.get("minute|" + time);
        return { price: num(fields?.index_minute_price), amount: num(fields?.index_minute_amount) };
      });
      if (!points.some(p => p.price !== null)) throw new Error(emptyText);
      const complete = envelope.extra.complete === true && points.every(p => p.price !== null && p.amount !== null);
      const view = { day, points, baseline: num(lookup.get("baseline")?.index_minute_prev_close), complete };
      if (complete) minuteArchive.save(day, view, archiveTtl);
      return complete || !archived ? view : archived;
    } catch (e) {
      if (archived) return archived;
      throw e;
    }
  }, view => view.complete ? archiveTtl : 60_000);
}

function useReviewChart<T>(day: string, revision: number, read: (day: string, refresh: boolean) => Promise<T>, initial?: T) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!initial);
  const previous = useRef(revision);
  useEffect(() => {
    let active = true;
    const refresh = previous.current !== revision;
    previous.current = revision;
    setLoading(true);
    setError("");
    void read(day, refresh).then(value => { if (active) setData(value); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "数据暂时未取到。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [day, revision, read]);
  return { data, error, loading };
}

type ChartProps = { day: string; revision: number };

export function ReviewMarketCharts(props: ChartProps) {
  return <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
    <ReviewIndexIntraday {...props} />
    <ReviewLimitTrend {...props} />
  </div>;
}

function ReviewLimitTrend({ day, revision }: ChartProps) {
  const { data, error, loading } = useReviewChart(day, revision, readLimits, limitCache.peek(day));
  const palette = usePalette();
  const available = data?.filter(p => p.up !== null || p.down !== null).length ?? 0;
  const last = data?.find(p => p.date === day);
  const option = useMemo(() => data && {
    animation: false,
    color: [palette.rise, palette.fall],
    grid: { left: 40, right: 22, top: 44, bottom: 28 },
    tooltip: { trigger: "axis", backgroundColor: palette.tooltipBg, textStyle: { color: palette.tooltipText },
      valueFormatter: (value: unknown) => typeof value === "number" ? `${value} 家` : "缺数据" },
    legend: { top: 2, right: 16, textStyle: { color: palette.text } },
    xAxis: { type: "category", boundaryGap: true, data: data.map(p => p.date.slice(5)),
      axisLabel: { color: palette.text, fontSize: 10, hideOverlap: true }, axisLine: { lineStyle: { color: palette.axis } } },
    yAxis: { type: "value", min: -10, max: ({ max }: { max: number }) => Math.max(max + 10, 20), minInterval: 1,
      axisLabel: { color: palette.text, formatter: (v: number) => v < 0 ? "" : String(v) },
      splitLine: { lineStyle: { color: palette.grid, type: "dashed" } } },
    series: [
      { name: "涨停", type: "line", symbol: "circle", symbolSize: 7, data: data.map(p => p.up),
        areaStyle: { opacity: 0.04 }, label: { show: true, position: "top", distance: 3, color: palette.rise, fontSize: 10, fontWeight: 600 } },
      { name: "跌停", type: "line", symbol: "diamond", symbolSize: 7, data: data.map(p => p.down),
        areaStyle: { opacity: 0.04 }, label: { show: true, position: "bottom", distance: 3, color: palette.fall, fontSize: 10, fontWeight: 600 } },
    ],
  }, [data, palette]);
  return <GlassCard className="min-w-0">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><ChartNoAxesCombined className="h-4 w-4 text-primary" />涨跌停家数趋势</h3>
      <ReviewBadge>近 {trendDays} 个交易日</ReviewBadge>
      <ContextHelp>东财收盘涨停池和跌停池口径。只统计已收盘且有证据的读数，缺值时曲线断开。</ContextHelp>
    </div>
    {last && <div className="mt-2 flex flex-wrap gap-3 text-xs tabular-nums">
      <span className="text-muted-foreground">{day}</span>
      <span className="text-danger">涨停 <b>{last.up ?? "—"}</b> 家</span>
      <span className="text-success">跌停 <b>{last.down ?? "—"}</b> 家</span>
    </div>}
    {available && option ? <>
      <EChart option={option} height={chartHeight} />
      {data?.some(p => p.up === null || p.down === null) && <p className="text-xs text-muted-foreground">部分交易日涨停或跌停读数暂缺，图中以断线标出。</p>}
    </> : <p role="status" className="py-6 text-center text-xs text-muted-foreground">{loading ? "正在读取近期收盘涨跌停家数…" : error || "所选日期附近暂无已核验的涨跌停读数。"}</p>}
    {!!available && error && <p role="status" className="text-xs text-warning">本次刷新未取得新数据。</p>}
  </GlassCard>;
}

const pct = (value: number, baseline: number) => (value / baseline - 1) * 100;
const pctLabel = (value: number) => {
  const rounded = Number(value.toFixed(2));
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}%`;
};

function ReviewIndexIntraday({ day, revision }: ChartProps) {
  const { data, loading, error } = useReviewChart(day, revision, readMinutes, minuteArchive.peek(day) ?? minuteCache.peek(day));
  const p = usePalette();
  const settings = useLocalPreference("chart-settings", () => parseChartSettings(null), parseChartSettings);
  const context = `sh000001:review-intraday:${day}`;
  const support = settings.value.lines.find(line => line.context === context)?.price;
  const [draft, setDraft] = useState<string>();
  const [saving, setSaving] = useState(false);
  const saveSupport = async (price: number | null) => {
    setSaving(true);
    try {
      const lines = settings.value.lines.filter(line => line.context !== context);
      if (price !== null) lines.push({ id: context, context, price, label: "支撑位", createdAt: new Date().toISOString() });
      if (await settings.save({ ...settings.value, lines })) setDraft(undefined);
    } finally { setSaving(false); }
  };
  const last = data?.points.filter(point => point.price !== null).at(-1)?.price;
  const change = last != null && data?.baseline ? pct(last, data.baseline) : null;
  const option = useMemo(() => {
    if (!data) return null;
    const onAxis = { color: p.text, hideOverlap: true };
    const xAxis = { type: "category", boundaryGap: false, data: sessionTimes, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } };
    const baseline = data.baseline;
    const observed = data.points.flatMap(({ price }, index) => price === null ? [] : [{ price, index }]);
    if (!observed.length) return null;
    const high = observed.reduce((a, b) => b.price > a.price ? b : a);
    const low = observed.reduce((a, b) => b.price < a.price ? b : a);
    const first = observed[0]!;
    const final = observed.at(-1)!;
    const anchor = baseline ?? first.price;
    const lower = Math.min(low.price, anchor, support ?? anchor);
    const upper = Math.max(high.price, anchor, support ?? anchor);
    const step = Math.max((upper - lower) / 4, 0.5);
    const magnitude = 10 ** Math.floor(Math.log10(step));
    const interval = [1, 2, 2.5, 5, 10].map(n => n * magnitude).find(n => n >= step) ?? step;
    const scale = {
      interval,
      min: Number((anchor + interval * Math.floor((lower - anchor) / interval - 0.25)).toFixed(6)),
      max: Number((anchor + interval * Math.ceil((upper - anchor) / interval + 0.25)).toFixed(6)),
    };
    const guides = [];
    if (baseline !== null) guides.push({
      yAxis: baseline, lineStyle: { color: p.benchmark, type: "dashed" },
      label: { position: "insideStartTop", color: p.text, formatter: `昨收 ${baseline.toFixed(2)}` },
    });
    if (support !== undefined) guides.push({
      yAxis: support, lineStyle: { color: p.fall, type: "dashed" },
      label: { position: "insideEndTop", color: p.fall, formatter: `支撑位 ${support}` },
    });
    const landmarks = new Map<number, { price: number; labels: string[]; position: string }>();
    for (const [point, label, position] of [
      [high, "高", "top"], [low, "低", "bottom"],
      [first, first.index === 0 ? "开" : "首点", "right"],
      [final, final.index === sessionTimes.length - 1 ? "收" : "末点", "left"],
    ] as const) {
      const marked = landmarks.get(point.index);
      if (marked) marked.labels.push(label);
      else landmarks.set(point.index, { price: point.price, labels: [label], position });
    }
    let sum = 0;
    let count = 0;
    const average = data.points.map(({ price }) => {
      if (price === null) return null;
      sum += price;
      return sum / ++count;
    });
    return {
      animation: false,
      grid: [{ left: 54, right: 60, top: 24, bottom: 101 }, { left: 54, right: 60, height: 55, bottom: 28 }],
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      tooltip: { trigger: "axis", backgroundColor: p.tooltipBg, textStyle: { color: p.tooltipText } },
      xAxis: [
        { ...xAxis, gridIndex: 0, axisLabel: { show: false } },
        { ...xAxis, gridIndex: 1, axisLabel: { ...onAxis, interval: (_: number, tick: string) => axisTicks.has(tick) } },
      ],
      yAxis: [
        { ...scale, type: "value", position: "left",
          axisLabel: { ...onAxis, fontSize: 10, formatter: (v: number) => v.toFixed(2) },
          splitLine: { lineStyle: { color: p.grid, type: "dashed" } } },
        { ...scale, type: "value", position: "right", show: baseline !== null, splitLine: { show: false },
          axisLabel: { ...onAxis, fontSize: 10, formatter: (v: number) => {
            if (baseline === null) return "";
            const percent = pct(v, baseline);
            const style = Math.abs(percent) < 0.005 ? "flat" : percent > 0 ? "rise" : "fall";
            return `{${style}|${pctLabel(percent)}}`;
          }, rich: { flat: { color: p.text, fontWeight: 600 }, rise: { color: p.rise }, fall: { color: p.fall } } } },
        { type: "value", gridIndex: 1, splitNumber: 2, axisLabel: { ...onAxis, fontSize: 10, formatter: "{value} 亿" },
          splitLine: { lineStyle: { color: p.grid } } },
      ],
      series: [
        { name: "上证指数", type: "line", showSymbol: false, data: data.points.map(point => point.price),
          lineStyle: { color: p.primary, width: 2 }, itemStyle: { color: p.primary },
          tooltip: { valueFormatter: (v: unknown) => typeof v === "number" ? `${v.toFixed(2)} 点${baseline ? `（${pctLabel(pct(v, baseline))}）` : ""}` : "—" },
          markLine: { silent: true, symbol: "none", label: { fontSize: 10 }, data: guides },
          markPoint: { silent: true, symbol: "circle", symbolSize: 6,
            data: [...landmarks].map(([index, mark]) => {
              const delta = baseline === null ? null : pct(mark.price, baseline);
              const color = delta === null || Math.abs(delta) < 0.005 ? p.strong : delta > 0 ? p.rise : p.fall;
              return {
                coord: [sessionTimes[index], mark.price], itemStyle: { color },
                label: { show: true, position: mark.position, color, fontSize: 10, fontWeight: 600,
                  backgroundColor: p.tooltipBg, borderRadius: 3, padding: [2, 3],
                  formatter: `${mark.labels.join("/")}${delta === null ? ` ${mark.price.toFixed(2)}` : ` ${pctLabel(delta)}`}` },
              };
            }) } },
        { name: "分钟均值", type: "line", showSymbol: false, data: average,
          lineStyle: { color: "#c58b20", width: 1.25, type: "dashed" }, itemStyle: { color: "#c58b20" },
          tooltip: { valueFormatter: (v: unknown) => typeof v === "number" ? `${v.toFixed(2)} 点` : "—" } },
        { name: "成交额（亿元）", type: "bar", xAxisIndex: 1, yAxisIndex: 2,
          tooltip: { valueFormatter: (v: unknown) => typeof v === "number" ? `${v.toFixed(2)} 亿` : "—" },
          data: data.points.map((point, i) => {
            if (point.amount === null) return null;
            const previous = i === 0 ? baseline : data.points[i - 1]?.price;
            const color = previous == null || point.price === null || point.price === previous ? p.benchmark
              : point.price > previous ? p.rise : p.fall;
            return { value: point.amount / 1e8, itemStyle: { color, opacity: 0.72 } };
          }) },
      ],
    };
  }, [data, p, support]);
  return <GlassCard className="min-w-0">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Activity className="h-4 w-4 text-primary" />上证指数分时</h3>
      <ReviewBadge>{day}</ReviewBadge>
      {data && <ReviewBadge tone="blue">{data.complete ? "1 分钟 · 收盘" : "1 分钟 · 记录不完整"}</ReviewBadge>}
      <ContextHelp>点位来自腾讯分钟行情。右轴涨跌幅以昨收为 0%。橙色虚线是截至该分钟的点位均值。最高和最低按分钟点位统计。</ContextHelp>
    </div>
    {data && option ? <>
      <div className="mt-2 flex flex-wrap items-baseline gap-2 text-xs tabular-nums">
        <strong className="text-base">{last?.toFixed(2)} 点</strong>
        {change !== null && <strong className={cn(change > 0 && "text-danger", change < 0 && "text-success")}>{pctLabel(change)}</strong>}
        <span className="text-muted-foreground">{data.complete ? "收盘" : "最新可用点位"} · 腾讯行情</span>
      </div>
      <EChart option={option} height={chartHeight} />
      <details className="text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer">{support === undefined ? "设置支撑位" : `支撑位 ${support}（手动）`}</summary>
        <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={event => {
          event.preventDefault();
          const price = Number(draft ?? support);
          if (Number.isFinite(price) && price > 0) void saveSupport(price);
        }}>
          <label className="flex items-center gap-2">
            支撑点位
            <input type="number" min="0.01" step="0.01" required value={draft ?? support ?? ""}
              onChange={event => setDraft(event.target.value)} className="w-24 rounded border border-border bg-background px-2 py-1 text-foreground" />
          </label>
          <button type="submit" disabled={!settings.ready || saving} className="rounded border border-border px-2 py-1 text-primary disabled:opacity-50">保存</button>
          {support !== undefined && <button type="button" disabled={saving} onClick={() => void saveSupport(null)} className="rounded border border-border px-2 py-1">清除</button>}
          <span>仅用于 {day}</span>
        </form>
        {settings.error && <p role="status" className="mt-1 text-warning">{settings.error}</p>}
      </details>
    </> : <p role="status" className="py-6 text-center text-xs text-muted-foreground">{loading ? "正在读取上证指数分时…" : error || emptyText}</p>}
  </GlassCard>;
}
