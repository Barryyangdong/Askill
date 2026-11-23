import type { KlineView } from "./klineView.ts";

/** Presentation-only replay of current historical bars. Never expose later bars in the chart. */
export function replayView(view: KlineView, date: string): KlineView | null {
  if (view.period !== "day" || view.adjust !== "none") return null;
  if (view.series.dates.some((day, i, days) => i > 0 && day <= days[i - 1]!)) return null;
  const n = view.series.dates.filter(day => day <= date).length;
  if (!n) return null;
  const series = view.series;
  return {
    ...view, bars: n, last: series.dates[n - 1]!,
    series: {
      dates: series.dates.slice(0, n), open: series.open.slice(0, n), close: series.close.slice(0, n),
      high: series.high.slice(0, n), low: series.low.slice(0, n), volume: series.volume.slice(0, n),
      change: series.change.slice(0, n), ma: Object.fromEntries(Object.entries(series.ma).map(([k, v]) => [k, v.slice(0, n)])),
      structure: Object.fromEntries(Object.entries(series.structure ?? {}).map(([k, v]) => [k, v.slice(0, n)])),
    },
  };
}
