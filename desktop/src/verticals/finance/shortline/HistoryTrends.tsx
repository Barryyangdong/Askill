import { finite, reading, safeArray } from "./format";
import type { DayRow, HistoryResult, Reading } from "./viewTypes";

/** Missing observations break the line; each metric keeps its own units and scale. */
export function trendSegments(rows: DayRow[], metric: Reading) {
  const values = rows.map(row => row.status === "missing" ? null : finite(row.values?.[metric.key]));
  const available = values.filter((v): v is number => v !== null);
  const min = available.length ? Math.min(...available) : 0;
  const max = available.length ? Math.max(...available) : 0;
  const points = values.map((value, index) => value === null ? null : {
    x: 16 + index * 288 / Math.max(1, rows.length - 1),
    y: max === min ? 58 : 96 - (value - min) / (max - min) * 76,
    value, row: rows[index]!,
  });
  const segments: string[] = [];
  let segment: string[] = [];
  for (const p of points) {
    if (p) segment.push(`${p.x},${p.y}`);
    else if (segment.length) { segments.push(segment.join(" ")); segment = []; }
  }
  if (segment.length) segments.push(segment.join(" "));
  return { points, segments, min, max, count: available.length };
}

export function HistoryTrends({ r }: { r: HistoryResult }) {
  const rows = safeArray<DayRow>(r.series);
  return <section aria-label="历史读数多图对照" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
    {safeArray<Reading>(r.readings).map(metric => {
      const t = trendSegments(rows, metric);
      return <div key={metric.key} className="min-w-0 rounded border border-border p-3">
        <div className="flex items-center justify-between gap-2 text-xs">
          <h3 className="font-medium">{metric.label}</h3>
          <span className="text-muted-foreground">{t.count}/{rows.length} 日{rows.some(row => row.settled === false) && <span className="ml-2 text-warning">含未收盘</span>}</span>
        </div>
        {t.count ? <>
          <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">{reading(t.min, metric.kind, metric.unit)} — {reading(t.max, metric.kind, metric.unit)}</div>
          <svg viewBox="0 0 320 116" className="w-full text-primary" role="img" aria-label={`${metric.label}走势，缺数据处断线，逐日数值见下表`}>
            <path d="M16 96H304" stroke="currentColor" opacity=".15" />
            {t.segments.map((points, i) => <polyline key={i} points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />)}
            {t.points.map((p, i) => p && <circle key={i} cx={p.x} cy={p.y} r={p.row.settled === false ? 3 : 2} fill={p.row.settled === false ? "hsl(var(--background))" : "currentColor"} stroke="currentColor">
              <title>{p.row.date} · {reading(p.value, metric.kind, metric.unit)}{p.row.settled === false ? " · 未收盘" : ""}</title>
            </circle>)}
          </svg>
          <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground"><span>{rows[0]?.date}</span><span>{rows.at(-1)?.date}</span></div>
        </> : <p className="py-10 text-center text-xs text-muted-foreground">没有可画的读数</p>}
      </div>;
    })}
  </section>;
}
