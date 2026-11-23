import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, ChartNoAxesCombined, ListFilter } from "lucide-react";
import { ContextHelp } from "@/components/ui/ContextHelp";
import { EChart } from "@/components/ui/EChart";
import { GlassCard } from "@/components/ui/GlassCard";
import { usePalette } from "@/components/ui/chartPalette";
import { backend } from "@/lib/backend";
import { shortTime } from "@/lib/chatSources";
import { cn } from "@/lib/utils";
import { createReviewCache } from "../shortline/reviewCache";
import { ReviewBadge } from "./ReviewBadge";

type Balance = { buy: number | null; sell: number | null; net: number | null };
type Seat = Balance & { name: string; seat?: string };
type Flow = Balance & { seats: Seat[] };
type Board = "BJ" | "SZ" | "SH";
type DragonRow = {
  symbol: string; name: string; board?: Board; pct: number | null; span?: 1 | 3 | null; reason?: string; seat_complete?: boolean;
  total: Balance | null; hot: Flow | null; institution: Flow | null;
};
type Estimate = { name: string; symbol: string; stock: string; board?: Board; net: number | null; last_date: string; days: number };
type Dragon = { date: string; rows: DragonRow[]; estimates: Estimate[]; gaps: string[]; source: string; fetched_at?: string };
type Scope = "total" | "hot" | "institution";
type Metric = "turnover" | "net";
type TrendPoint = { date: string } & Record<Scope, Record<Metric, number | null> | null>;
type Trend = { date: string; series: TrendPoint[]; estimates: Estimate[]; gaps: string[]; source: string };

const detailCache = createReviewCache<Dragon>(16);
const trendCache = createReviewCache<Trend>(16);
const closeTtl = 30 * 60_000;
const partialTtl = 90_000;
type PageProps = { day: string; revision: number };
const scopes: { id: Scope; label: string }[] = [
  { id: "total", label: "总榜" }, { id: "hot", label: "游资" }, { id: "institution", label: "机构" },
];

function readDragon(day: string, refresh: boolean) {
  return detailCache.read(day, refresh, async () => {
    const data = await backend.shortlineView<Dragon>("review_dragon", { date: day, refresh });
    if (data.date !== day) throw new Error("龙虎榜披露日期与所选复盘日不一致。");
    return data;
  }, data => data.rows.length && !data.gaps.length ? closeTtl : partialTtl);
}

function readTrend(day: string, refresh: boolean) {
  return trendCache.read(day, refresh, async () => {
    const data = await backend.shortlineView<Trend>("review_dragon_trend", { date: day, refresh });
    if (data.date !== day) throw new Error("龙虎榜趋势日期与所选复盘日不一致。");
    return { ...data, series: data.series.filter(point => point.date <= day).sort((a, b) => a.date.localeCompare(b.date)) };
  }, data => data.series.length && !data.gaps.length ? closeTtl : partialTtl);
}

function useDragonData<T>(day: string, revision: number, read: (day: string, refresh: boolean) => Promise<T>, initial?: T) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState("");
  const previous = useRef(revision);
  useEffect(() => {
    let current = true;
    const refresh = previous.current !== revision;
    previous.current = revision;
    setLoading(true);
    setError("");
    void read(day, refresh).then(value => { if (current) setData(value); })
      .catch(error => { if (current) setError(error instanceof Error ? error.message : "暂未取得数据。"); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [day, revision, read]);
  return { data, loading, error };
}

const number = (v: number | null | undefined) => typeof v === "number" && Number.isFinite(v) ? v : null;
const signColor = (v: number | null | undefined) => (v ?? 0) > 0 ? "text-danger" : (v ?? 0) < 0 ? "text-success" : "text-muted-foreground";
function amount(v: number | null | undefined, signed = false) {
  const n = number(v);
  if (n === null) return "—";
  const sign = n < 0 ? "−" : n > 0 && signed ? "+" : "";
  const absolute = Math.abs(n);
  const [value, unit] = absolute >= 1e8 ? [absolute / 1e8, "亿"] : [absolute / 1e4, "万"];
  return `${sign}${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} ${unit}`;
}
function percent(v: number | null | undefined) {
  const n = number(v);
  return n === null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

const isBeijing = (row: DragonRow | Estimate) => ("board" in row && row.board === "BJ") || /\.BJ$/i.test(row.symbol);
const combined = (row: DragonRow) =>
  number(row.hot?.net) !== null && number(row.institution?.net) !== null ? row.hot!.net! + row.institution!.net! : null;

function SeatTags({ seats }: { seats?: Seat[] }) {
  if (!seats?.length) return <span className="text-muted-foreground">—</span>;
  return <div className="flex min-w-36 flex-wrap gap-1 py-0.5">
    {seats.map((seat, index) => <span key={`${seat.name}:${index}`} title={`${seat.seat ? seat.seat + " · " : ""}买入 ${amount(seat.buy)} · 卖出 ${amount(seat.sell)}`}
      className={cn("rounded border px-1.5 py-0.5 text-[11px]", (seat.net ?? 0) > 0 ? "border-danger/25 bg-danger/10" : (seat.net ?? 0) < 0 ? "border-success/25 bg-success/10" : "border-border/60")}>
      {seat.name} <span className={cn("tabular-nums", signColor(seat.net))}>{amount(seat.net, true)}</span>
    </span>)}
  </div>;
}

function SourceNotes({ source, gaps }: { source: string; gaps: string[] }) {
  return <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
    {source && <p>来源 {source}</p>}
    {gaps.length > 0 && <details className="text-warning"><summary className="w-fit cursor-pointer">数据缺口（{gaps.length}）</summary>
      <ul className="mt-1 list-inside list-disc">{gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul>
    </details>}
  </div>;
}

type Tab = "joint" | Scope | "estimates";
const tabs: { id: Tab; label: string }[] = [
  { id: "joint", label: "游机合力榜" }, { id: "hot", label: "游资榜" },
  { id: "institution", label: "机构榜" }, { id: "estimates", label: "游资持仓估算" },
  { id: "total", label: "总榜" },
];
type Sort = "pct" | "hot" | "institution" | "net";
const measure = (row: DragonRow, tab: Tab, sort: Sort) => {
  if (sort === "pct") return row.pct;
  if (sort === "hot" || sort === "institution") return row[sort]?.net;
  return tab === "joint" ? combined(row) : tab === "estimates" ? null : row[tab]?.net;
};

type TrendState = ReturnType<typeof useDragonData<Trend>>;

function DragonList({ day, revision, trend }: PageProps & { trend: TrendState }) {
  const { data, error, loading } = useDragonData(day, revision, readDragon, detailCache.peek(day));
  const [tab, setTab] = useState<Tab>("joint");
  const [beijing, setBeijing] = useState(false);
  const [sort, setSort] = useState<{ field: Sort; ascending: boolean }>({ field: "net", ascending: false });
  const visibleRows = (data?.rows ?? []).filter(row => beijing || !isBeijing(row));
  const labeledRows = visibleRows.filter(row => row.hot?.seats.length);
  const labels = new Set(labeledRows.flatMap(row => row.hot?.seats.map(seat => seat.name) ?? []));
  const subset = visibleRows.filter(row => {
    if (tab === "estimates") return false;
    if (tab === "joint") {
      return Math.sign(row.hot?.net ?? 0) !== 0 && Math.sign(row.hot?.net ?? 0) === Math.sign(row.institution?.net ?? 0);
    }
    if (tab === "total") return row.total !== null;
    return Boolean(row[tab]?.seats.length);
  });
  const ranked = subset.sort((a, b) => {
    const av = number(measure(a, tab, sort.field)), bv = number(measure(b, tab, sort.field));
    if (av === null) return bv === null ? 0 : 1;
    if (bv === null) return -1;
    return (sort.ascending ? 1 : -1) * (av - bv);
  });
  const estimates = (trend.data?.estimates ?? data?.estimates ?? []).filter(row => row.last_date <= day && (beijing || !isBeijing(row)));
  const selectedLabel = tabs.find(item => item.id === tab)?.label;
  const hot = tab === "joint" || tab === "hot";
  const institution = tab === "joint" || tab === "institution";
  function Sortable({ field, children }: { field: Sort; children: string }) {
    const current = sort.field === field;
    return <th scope="col" className="px-2 py-2 text-right font-medium"
      aria-sort={current ? (sort.ascending ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => setSort({ field, ascending: current && !sort.ascending })}>
        {children}<ArrowDownUp aria-hidden="true" className={cn("h-3 w-3", current ? "text-primary" : "opacity-50")} />
      </button>
    </th>;
  }
  return <GlassCard className="min-w-0">
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><ListFilter className="h-4 w-4 text-primary" />龙虎榜席位明细</h3>
      <ReviewBadge>{day}</ReviewBadge>
      {data?.fetched_at && <span className="text-[11px] text-muted-foreground">取于 {shortTime(data.fetched_at)}（北京时间）</span>}
      <ContextHelp>合力榜列出双方同向净买入或同向净卖出的股票。游资归类依据已能核验的公开席位对应关系。多日累计上榜记录另有标记。</ContextHelp>
    </div>
    {(tab === "hot" || tab === "joint") && visibleRows.length > 0 && (
      <p className="mb-2 text-xs text-muted-foreground">
        公开名录匹配 <strong className="text-foreground">{labeledRows.length} / {visibleRows.length} 只</strong> · {labels.size} 类席位标签
        <span className="ml-2">以营业部全称匹配，未匹配席位不计入游资统计。</span>
      </p>
    )}
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <div aria-label="龙虎榜分类" className="flex flex-wrap gap-1">
        {tabs.map(item => <button key={item.id} type="button" aria-pressed={tab === item.id}
          className={cn("rounded-md px-2 py-1 text-xs", tab === item.id ? "bg-primary/15 font-semibold text-primary" : "text-muted-foreground hover:bg-muted")}
          onClick={() => { setTab(item.id); setSort({ field: "net", ascending: false }); }}>{item.label}</button>)}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={beijing} onChange={event => setBeijing(event.target.checked)} />显示北交所
      </label>
    </div>
    {error && tab !== "estimates" && <p role="status" className="mb-2 text-xs text-warning">{error}</p>}
    {tab === "estimates" ? <>
        <p className="mb-2 text-xs text-muted-foreground">截至所选日的近 15 个交易日，累计已识别游资席位的单日披露净买入额。实际持仓还受未上榜成交、历史存量等影响。</p>
        {!trend.data && estimates.length > 0 && <p role="status" className="mb-2 text-xs text-muted-foreground">
          {trend.loading ? "正在汇总历史披露，当前显示所选交易日记录。" : "历史汇总暂未取得，当前显示所选交易日记录。"}
        </p>}
        {!estimates.length ? <p role="status" className="py-4 text-xs text-muted-foreground">
          {trend.loading ? "正在汇总历史席位披露…" : trend.error || "所选日期附近暂未取得可估算的游资披露记录。"}
        </p> :
          <div className="overflow-x-auto">
            <table aria-label={selectedLabel} className="w-full whitespace-nowrap text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/35 text-muted-foreground">
                <tr>{["游资席位", "股票", "披露净买入累计", "最近披露日", "样本天数"].map(label => <th scope="col" key={label} className="px-2 py-2 font-medium">{label}</th>)}</tr>
              </thead>
              <tbody>
                {estimates.map((row, index) => <tr key={`${row.name}/${row.symbol}/${index}`} className="border-b border-border/40 last:border-0">
                  <td className="px-2 py-2 font-semibold">{row.name}</td>
                  <td className="px-2 py-2">{row.stock} <span className="text-muted-foreground">{row.symbol}</span></td>
                  <td className={cn("px-2 py-2 font-semibold tabular-nums", signColor(row.net))}>{amount(row.net, true)}</td>
                  <td className="px-2 py-2 tabular-nums text-muted-foreground">{row.last_date}</td>
                  <td className="px-2 py-2 tabular-nums">{row.days}</td>
                </tr>)}
              </tbody>
            </table>
          </div>}
      </> : !data ? <p role="status" className="py-5 text-sm text-muted-foreground">{loading ? "正在读取龙虎榜披露…" : "待取得席位披露。"}</p> :
      !ranked.length ? <p className="py-4 text-xs text-muted-foreground">本日暂未取得可核验的{selectedLabel}记录。</p> :
        <div className="overflow-x-auto">
          <table aria-label={selectedLabel} className="w-full whitespace-nowrap text-left text-xs">
            <thead className="border-b border-border/60 bg-muted/35 text-muted-foreground"><tr>
              <th scope="col" className="px-2 py-2 font-medium">序</th>
              <th scope="col" className="px-2 py-2 font-medium">股票</th>
              <Sortable field="pct">涨跌幅</Sortable>
              {hot && <Sortable field="hot">游资净买</Sortable>}
              {institution && <Sortable field="institution">机构净买</Sortable>}
              {tab === "joint" && <Sortable field="net">合计净买</Sortable>}
              {tab === "total" && <>
                <th scope="col" className="px-2 py-2 text-right font-medium">买入额</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">卖出额</th>
                <Sortable field="net">总净买入</Sortable>
              </>}
              {hot && <th scope="col" className="px-2 py-2 font-medium">游资席位</th>}
              {institution && <th scope="col" className="px-2 py-2 font-medium">机构席位</th>}
            </tr></thead>
            <tbody>
              {ranked.map((row, index) => <tr key={`${row.symbol}/${row.span}/${index}`} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                <td className="px-2 py-2 tabular-nums text-muted-foreground">{index + 1}</td>
                <td className="px-2 py-2"><strong>{row.name || row.symbol}</strong> <span className="text-muted-foreground">{row.symbol}</span>
                  {row.span === 3 && <span className="ml-1"><ReviewBadge>3 日累计</ReviewBadge></span>}
                  {row.board === "BJ" && <span className="ml-1"><ReviewBadge>北交所</ReviewBadge></span>}
                  {row.reason && <p title={row.reason} className="mt-0.5 max-w-44 truncate text-[11px] text-muted-foreground">{row.reason}</p>}
                </td>
                <td className={cn("px-2 py-2 text-right tabular-nums", signColor(row.pct))}>{percent(row.pct)}</td>
                {hot && <td className={cn("px-2 py-2 text-right tabular-nums", signColor(row.hot?.net))}>{amount(row.hot?.net, true)}</td>}
                {institution && <td className={cn("px-2 py-2 text-right tabular-nums", signColor(row.institution?.net))}>{amount(row.institution?.net, true)}</td>}
                {tab === "joint" && <td className={cn("px-2 py-2 text-right font-semibold tabular-nums", signColor(combined(row)))}>{amount(combined(row), true)}</td>}
                {tab === "total" && <>
                  <td className="px-2 py-2 text-right tabular-nums">{amount(row.total?.buy)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{amount(row.total?.sell)}</td>
                  <td className={cn("px-2 py-2 text-right font-semibold tabular-nums", signColor(row.total?.net))}>{amount(row.total?.net, true)}</td>
                </>}
                {hot && <td className="px-2 py-2"><SeatTags seats={row.hot?.seats} /></td>}
                {institution && <td className="px-2 py-2"><SeatTags seats={row.institution?.seats} /></td>}
              </tr>)}
            </tbody>
          </table>
        </div>}
    {tab === "estimates" && trend.data ? <SourceNotes source={trend.data.source} gaps={trend.data.gaps} /> :
      data && <SourceNotes source={data.source} gaps={data.gaps} />}
  </GlassCard>;
}

function DragonTrend({ day, trend, summary }: { day: string; trend: TrendState; summary?: ReactNode }) {
  const { data, loading, error } = trend;
  const [metric, setMetric] = useState<Metric>("net");
  const p = usePalette();
  const current = data?.series.find(row => row.date === day);
  const previous = data?.series.filter(row => row.date < day).at(-1);
  const pointsAvailable = data?.series.some(row => scopes.some(({ id }) => number(row[id]?.[metric]) !== null));
  const option = useMemo(() => data && {
    animation: false,
    color: [p.primary, "#c58b20", "#5896e5"],
    grid: { left: 65, right: 20, top: 40, bottom: 30 },
    tooltip: { trigger: "axis", backgroundColor: p.tooltipBg, textStyle: { color: p.tooltipText },
      valueFormatter: (value: unknown) => typeof value === "number" ? amount(value, metric === "net") : "缺数据" },
    legend: { right: 12, top: 0, textStyle: { color: p.text } },
    xAxis: { type: "category", data: data.series.map(point => point.date.slice(5)),
      axisLabel: { color: p.text, hideOverlap: true }, axisLine: { lineStyle: { color: p.axis } } },
    yAxis: { type: "value", axisLabel: { color: p.text, formatter: (value: number) => amount(value) },
      splitLine: { lineStyle: { color: p.grid, type: "dashed" } } },
    series: scopes.map(({ id, label }) => ({ name: label, type: "line", symbol: "circle", symbolSize: 5,
      data: data.series.map(point => number(point[id]?.[metric])) })),
  }, [data, metric, p]);
  return <GlassCard className="min-w-0">
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><ChartNoAxesCombined className="h-4 w-4 text-primary" />龙虎榜成交趋势</h3>
      <ReviewBadge>{day}</ReviewBadge>
      <ContextHelp>成交额为买入额与卖出额之和，净额为买入减卖出。趋势按单日披露逐股去重，避免重复累计多日榜。缺值处断线。</ContextHelp>
    </div>
    <div className="mb-3 grid gap-2 sm:grid-cols-3">
      {scopes.map(({ id, label }) => {
        const value = number(current?.[id]?.[metric]);
        const prev = number(previous?.[id]?.[metric]);
        const dayChange = value === null || prev === null || prev === 0 ? null : (value - prev) / Math.abs(prev) * 100;
        return <div className="rounded border border-border/60 bg-muted/25 p-3" key={id}>
          <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
            <span>{label}{metric === "net" ? "净额" : "成交额"}</span>
            {metric === "net" && value !== null && value !== 0 && <span className={signColor(value)}>{value > 0 ? "净买" : "净卖"}</span>}
          </div>
          <p className={cn("mt-0.5 font-mono text-base font-semibold", metric === "net" && signColor(value))}>{amount(value, metric === "net")}</p>
          <p className="text-[11px] text-muted-foreground">较前一交易日 <span className={signColor(dayChange)}>{percent(dayChange)}</span></p>
        </div>;
      })}
    </div>
    {summary}
    <div className="mb-2 flex gap-1" aria-label="龙虎榜趋势指标">
      {(["turnover", "net"] as const).map(id => <button type="button" key={id} aria-pressed={id === metric}
        className={cn("rounded-md px-2 py-1 text-xs", id === metric ? "bg-primary/15 font-semibold text-primary" : "text-muted-foreground hover:bg-muted")}
        onClick={() => setMetric(id)}>{id === "turnover" ? "成交额" : "净额"}</button>)}
    </div>
    {pointsAvailable && option ? <EChart option={option} height={260} /> :
      <p role="status" className="py-5 text-sm text-muted-foreground">{loading ? "正在读取收盘龙虎榜趋势…" : error || "所选区间暂未取得趋势数据。"}</p>}
    {data && <SourceNotes source={data.source} gaps={data.gaps} />}
  </GlassCard>;
}

export function ReviewDragon({ summary, ...props }: PageProps & { summary?: ReactNode }) {
  const trend = useDragonData(props.day, props.revision, readTrend, trendCache.peek(props.day));
  return <div className="mt-4 grid gap-3">
    <DragonTrend day={props.day} trend={trend} summary={summary} />
    <DragonList {...props} trend={trend} />
  </div>;
}
