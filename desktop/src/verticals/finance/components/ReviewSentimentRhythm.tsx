import { useEffect, useMemo, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { ContextHelp } from "@/components/ui/ContextHelp";
import { EChart } from "@/components/ui/EChart";
import { GlassCard } from "@/components/ui/GlassCard";
import { usePalette } from "@/components/ui/chartPalette";
import { backend } from "@/lib/backend";
import { createReviewCache } from "../shortline/reviewCache";
import { ReviewBadge } from "./ReviewBadge";

type DayPoint = { date: string; up: number | null; total: number | null; score: number | null };
type Rhythm = { date: string; series: DayPoint[] };

const emptyReason = "所选日期暂无可核验的收盘情绪节奏。";
const cache = createReviewCache<Rhythm>(16, {
  namespace: "review-sentiment-rhythm", limit: 8, project: value => value,
  valid: value => !!value?.date && Array.isArray(value.series) && value.series.some(p => p.up !== null || p.score !== null),
});

export function readRhythm(day: string, refresh: boolean) {
  return cache.read(day, refresh, async () => {
    const result = await backend.shortlineView<Rhythm>("review_sentiment_rhythm", { date: day, refresh });
    if (result.date !== day || !Array.isArray(result.series)) throw new Error(emptyReason);
    return { date: day, series: result.series.filter(point => point.date <= day) };
  }, result => result.series.length === 15 && result.series.every(point => point.up !== null && point.score !== null)
    ? 30 * 60_000 : 90_000);
}

export const phaseOf = (score: number) => score < 40 ? "退潮" : score < 60 ? "震荡" : "升温";
const bands = ["rgba(36,169,113,.10)", "rgba(36,169,113,.10)", "rgba(205,148,43,.10)", "rgba(220,77,86,.09)", "rgba(220,77,86,.09)"];

export function ReviewSentimentRhythm({ day, revision }: { day: string; revision: number }) {
  const [data, setData] = useState(() => cache.peek(day));
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState("");
  const lastRevision = useRef(revision);
  const palette = usePalette();
  useEffect(() => {
    let active = true;
    const refresh = lastRevision.current !== revision;
    lastRevision.current = revision;
    setLoading(true);
    setError("");
    void readRhythm(day, refresh).then(result => {
      if (!active) return;
      if (result.series.some(point => point.up !== null || point.score !== null)) setData(result);
      else setError(emptyReason);
    }).catch(() => { if (active) setError(emptyReason); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [day, revision]);

  const selected = data?.date === day ? data : undefined;
  const latest = selected?.series.find(point => point.date === day);
  const missing = selected?.series.filter(point => point.up === null || point.score === null) ?? [];
  const option = useMemo(() => {
    if (!selected) return null;
    const lastIndex = selected.series.length - 1;
    const emphasis = (index: number) => index === lastIndex || index % 3 === 0;
    return {
      color: ["#dba54c", palette.rise],
      animation: false,
      grid: { left: 47, right: 49, top: 42, bottom: 29 },
      legend: { top: 4, textStyle: { color: palette.text } },
      tooltip: { trigger: "axis", backgroundColor: palette.tooltipBg, textStyle: { color: palette.tooltipText } },
      xAxis: { type: "category", data: selected.series.map(point => point.date.slice(5)),
        axisLabel: { color: palette.text, hideOverlap: true, fontSize: 10 }, axisLine: { lineStyle: { color: palette.axis } } },
      yAxis: [
        { type: "value", min: 0, axisLabel: { color: palette.text, fontSize: 10 },
          splitLine: { lineStyle: { color: palette.grid, type: "dashed" } } },
        { type: "value", min: 0, max: 100, interval: 20, axisLabel: { color: palette.text, fontSize: 10 },
          splitArea: { show: true, areaStyle: { color: bands } }, splitLine: { show: false } },
      ],
      series: [
        { name: "上涨家数", type: "bar", data: selected.series.map(point => point.up), barMaxWidth: 24,
          itemStyle: { color: "#dba54c", opacity: 0.75, borderRadius: [3, 3, 0, 0] },
          tooltip: { valueFormatter: (value: unknown) => value == null ? "缺数据" : `${value} 家` } },
        { name: "情绪读数", type: "line", yAxisIndex: 1, connectNulls: false, data: selected.series.map(point => point.score), symbolSize: 6,
          label: { show: true, color: palette.strong, position: "top", fontSize: 10,
            formatter: ({ value, dataIndex }: { value: unknown; dataIndex: number }) => value == null || !emphasis(dataIndex) ? "" : String(value) },
          tooltip: { valueFormatter: (value: unknown) => value == null ? "缺数据" : `${value} 分` } },
      ],
    };
  }, [selected, palette]);

  return <GlassCard className="mb-4 min-w-0">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Activity className="h-4 w-4 text-primary" />市场情绪节奏</h3>
      <ReviewBadge>{day} · 近 15 个交易日</ReviewBadge>
      <ContextHelp>上涨家数来自通达信沪深京 A 股收盘日包，含符合条件的 ST 股，统计有成交且收盘价、昨收有效的股票。情绪读数取「上涨家数 ÷ 有效样本数」和「东财涨停家数 ÷ 东财涨跌停总家数」的平均值，换算为 0–100 分。两项按各自来源口径逐日计算。</ContextHelp>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {latest?.up != null && <span>上涨 <strong className="text-foreground tabular-nums">{latest.up}</strong> / {latest.total} 家</span>}
      {latest?.score != null && <ReviewBadge tone={latest.score >= 60 ? "gold" : "blue"}>{latest.score} 分 · {phaseOf(latest.score)}</ReviewBadge>}
      <span className="sm:ml-auto">退潮 &lt; 40　震荡 40–59　升温 ≥ 60</span>
    </div>
    {option ? <EChart option={option} height={258} /> :
      <p role="status" className="py-6 text-center text-xs text-muted-foreground">{loading ? "正在读取近 15 个交易日的收盘读数…" : error || emptyReason}</p>}
    {option && (error || missing.length > 0) && <p role="status" className="text-xs text-muted-foreground">
      {error || `${missing.map(point => point.date.slice(5)).join("、")} 部分读数缺失。`}
    </p>}
  </GlassCard>;
}
