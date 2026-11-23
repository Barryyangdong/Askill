/**
 * 题材轮动:近 5 个交易日,每个涨停题材每天有几只涨停、排第几,连续了几天、是新出现还是回流、还是退下去了。
 * 版式借鉴 GitHub 上几个短线看板的「题材热度矩阵」(只借展示思路,没有搬代码);题材口径和题材事件树同一套(同花顺涨停原因拆标签)。
 * 🔴 某天没取到画成「—」,不画成 0:那天可能这个题材照样有涨停。
 */
import "./themeRotationRail.css";
import { Grid3x3 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { phaseOf } from "@/components/ReviewSentimentRhythm";
import { ContextHelp } from "../components/ui/ContextHelp";
import { cn } from "@/lib/utils";
import type { Panel } from "./api";
import { Section } from "./FactsPanels";
import { finite, safeArray } from "./format";
import type { RotationDay, RotationTheme, ThemeRotationResult } from "./types";

export const ROTATION_CALIBER =
  "题材 = 同花顺涨停揭秘的涨停原因按「+」拆出的标签(去掉国企改革、破净这类属性词),和题材事件树同一套;一只票可以同时算进几个题材。\n" +
  "格子里的数 = 那天这个题材的涨停只数(东财涨停池里、有涨停原因的),颜色越深越多;小角标 = 当天按只数排第几(并列同名次),前三加粗。\n" +
  "「连续 N 天」数到今天为止每天都有涨停;「隔 k 天回流」= 中间断了 k 天今天又有;「窗口内首次出现」= 这几天里今天才第一次有。\n" +
  "某天东财涨停池或涨停原因没取到,那一列画「—」,按缺数处理(不是 0),跨过它的「连续」「回流」「首次出现」都会注明说不准。\n" +
  "某天有沪深涨停股没有涨停原因:那天没出现的题材也画「—」(可能有),出现的只数是下限。北交所的涨停股同花顺不收录,不算进任何题材。\n" +
  "表里先列今天有涨停的前 12 个题材,再补最多 6 个昨天至少 2 只、今天一只都没有的(退下去的)。\n" +
  "涨停原因是源站编辑归因,不是公司确认。";

const mmdd = (d: string) => d.slice(5);

export interface ThemeCell { date: string; tag: string }
interface MatrixSelection { selected?: {date: string; tag?: string} | null; onSelect?: (cell: ThemeCell) => void }
interface MatrixContext {
  rail?: boolean;
  scores?: Record<string,number|null>;
  expectation?: (tag:string,date:string,id?:string)=>string|undefined;
  managedOutlook?: { name:string; id?:string };
}
function OutlookRow({ tag, id, dates, expectation, stats = true }: {tag:string; id?:string; dates:string[]; stats?: boolean; expectation: NonNullable<MatrixContext["expectation"]>}) {
  return <tr className="border-b border-border/50 bg-muted/20 text-xs">
    <th scope="row" className="sticky left-0 bg-card px-1 py-2 text-left font-normal text-muted-foreground">{id ? tag+" · " : ""}次日预期</th>
    {dates.map(d=><td key={d} className="max-w-36 break-words px-1 py-1">{expectation(tag,d,id) || "—"}</td>)}{stats && <td colSpan={4}/>}
  </tr>;
}
type Metric = "count" | "rank" | "height";
function Cell({ v, rank, max, height, metric, heatmap, cell, selected, onSelect }: MatrixSelection & { v: number | null; rank: number | null; height:number|null; metric:Metric; heatmap:boolean; max: number; cell: ThemeCell }) {
  if (v == null) return <td className="px-1 py-1 text-center text-muted-foreground/60" title="这天没取到或说不准,按缺数处理(不是 0)">—</td>;
  if (v === 0) return <td className="px-1 py-1 text-center text-muted-foreground/40">·</td>;
  const alpha = 0.18 + 0.62 * Math.min(1, v / Math.max(1, max));
  // 浅格子上白字在浅色主题里看不清:浅的用正文色,深的用白字
  const active = selected?.date === cell.date && selected?.tag === cell.tag;
  const contents = metric === "height" ? (height == null ? "—" : height + "板") : metric === "rank" ? (rank == null ? "—" : "#" + rank) :
    <>{v}{rank != null && <sup className="ml-0.5 text-[9px] font-normal opacity-80">#{rank}</sup>}</>;
  const classes = cn("relative inline-flex min-w-[2rem] items-center justify-center rounded px-1.5 text-xs",
    heatmap ? (alpha >= 0.45 ? "text-white" : "text-foreground") : "text-danger", rank != null && rank <= 3 && "font-extrabold ring-1 ring-warning/70");
  const style = heatmap ? { backgroundColor: `hsl(var(--danger) / ${alpha.toFixed(2)})` } : undefined;
  return (
    <td className="px-1 py-1 text-center">
      {onSelect && cell.date ? <button type="button" className={cn(classes, "min-h-11 min-w-11 hover:underline focus-visible:outline md:min-h-8 md:min-w-8", active && "outline outline-2 outline-primary")}
        style={style} data-date={cell.date} aria-pressed={active} aria-label={`${cell.date} ${cell.tag}，${v} 只涨停，查看样本`}
        onClick={() => onSelect(cell)}>{contents}</button>
        : <span className={cn(classes, "h-6")} style={style}>{contents}</span>}
    </td>
  );
}

function statusColor(t: RotationTheme): string {
  if (!t.today) return "text-success";
  if (t.status.startsWith("连续")) return "text-danger font-semibold";
  if (t.status.includes("回流") || t.status.includes("首次")) return "text-warning";
  return "text-muted-foreground";
}

function Row({ t, max, dates, metric, rail, stats, ...selection }: MatrixSelection & { t: RotationTheme; max: number; dates: string[]; metric: Metric; heatmap: boolean; rail?: boolean; stats: boolean }) {
  const series = safeArray<number | null>(t.series), ranks = safeArray<number | null>(t.ranks);
  const preferredIndex = dates.indexOf(selection.selected?.date ?? "");
  const preferred = rail ? selection.selected?.date ?? dates.at(-1) : (series[preferredIndex] ?? 0) > 0 ? dates[preferredIndex] :
    dates.filter((_, i) => (series[i] ?? 0) > 0).at(-1);
  return (
    <tr data-topic={t.tag} className={cn("border-b border-border/30 last:border-0", rail && selection.selected?.tag === t.tag && "bg-primary/10")}>
      <th scope="row" className={cn("py-1 pr-2 text-left font-medium", selection.onSelect && "sticky left-0 z-10 bg-card", rail && "max-w-36 border-l-2 pl-2", rail && (selection.selected?.tag === t.tag ? "border-primary text-primary" : "border-transparent"))}>
        {selection.onSelect && preferred ? <button type="button" data-topic-name="" data-review-day={preferred} className="py-1 text-left hover:text-primary hover:underline"
          aria-pressed={rail ? selection.selected?.tag === t.tag : undefined}
          aria-label={`查看题材 ${t.tag}（${preferred}）`} onClick={()=>selection.onSelect?.({date:preferred,tag:t.tag})}>{t.tag}</button> : t.tag}
        {rail && !stats && <span className={cn("theme-rail-status", statusColor(t))} title={t.today ? t.status : "当日无涨停"} aria-label={t.today ? t.status : "当日无涨停"}>●</span>}
      </th>
      {series.map((v, i) => <Cell key={i} v={finite(v)} rank={finite(ranks[i])} height={finite(t.highest?.[i])} metric={metric} max={max} cell={{date: dates[i] ?? "", tag: t.tag}} {...selection} />)}
      {stats && <><td className={cn("whitespace-nowrap px-2 py-1 text-[12px]", statusColor(t))}>{t.today ? t.status : "今天退下去了"}</td>
      <td className="px-2 py-1 text-center text-[12px] tabular-nums text-muted-foreground">{t.active_days}</td>
      <td className="px-2 py-1 text-center text-[12px] tabular-nums text-muted-foreground">{t.top3_days}</td>
      <td className="max-w-56 truncate px-2 py-1 text-[11px] text-muted-foreground" title={safeArray<string>(t.members).join("、")}>{safeArray<string>(t.members).join("、") || "—"}</td></>}
    </tr>
  );
}

function navigateMatrix(event: KeyboardEvent<HTMLTableElement>) {
  const source = event.target;
  if (!(source instanceof HTMLButtonElement) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const row = source.closest<HTMLTableRowElement>("tr[data-topic]");
  if (!row || !["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const table = event.currentTarget;
  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tr[data-topic]"));
  let next: HTMLButtonElement | null | undefined;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    const nextRow = rows[rows.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)];
    if (nextRow) {
      next = Array.from(nextRow.querySelectorAll<HTMLButtonElement>("button[data-date]")).find(b => b.dataset.date === source.dataset.date)
        ?? nextRow.querySelector<HTMLButtonElement>("button[data-topic-name]");
    }
  } else {
    const date = source.dataset.date ?? source.dataset.reviewDay;
    if (!date) return;
    const cells = Array.from(row.querySelectorAll<HTMLButtonElement>("button[data-date]"));
    next = event.key === "ArrowRight"
      ? cells.find(cell => (cell.dataset.date ?? "") > date)
      : cells.reverse().find(cell => (cell.dataset.date ?? "") < date);
  }
  if (!next) return;
  next.focus({ preventScroll: true });
  next.click();
  // Keep focus visible within the matrix without moving the surrounding workspace.
  const scroller = table.parentElement;
  if (!scroller) return;
  const rect = next.getBoundingClientRect(), view = scroller.getBoundingClientRect();
  const top = view.top + (table.tHead?.offsetHeight ?? 0);
  if (rect.top < top) scroller.scrollTop += rect.top - top;
  else if (rect.bottom > view.bottom) scroller.scrollTop += rect.bottom - view.bottom;
  if (next.hasAttribute("data-date")) {
    const left = view.left + (row.cells[0]?.offsetWidth ?? 0);
    if (rect.left < left) scroller.scrollLeft += rect.left - left;
    else if (rect.right > view.right) scroller.scrollLeft += rect.right - view.right;
  }
}

export function ThemeRotationView({ r, rail, scores, expectation, managedOutlook, ...selection }: MatrixSelection & MatrixContext & { r: ThemeRotationResult }) {
  const [filter,setFilter]=useState("");
  const [order,setOrder]=useState("today");
  const [metric,setMetric]=useState<Metric>("count");
  const [heatmap, setHeatmap] = useState(true);
  const [showMarket,setShowMarket]=useState(true);
  const [showOutlook,setShowOutlook]=useState(false);
  const [expandedStats, setExpandedStats] = useState(false);
  const stats = !rail || expandedStats;
  const rot = r.rotation ?? { available: false };
  const scroll = useRef<HTMLDivElement>(null);
  const latest = rot.dates?.at(-1);
  const dayCount = rot.dates?.length;
  useLayoutEffect(() => {
    const element = scroll.current;
    if (rail && latest && element) element.scrollLeft = element.scrollWidth;
  }, [rail, latest, dayCount]);
  if (!rot.available) return <p className="text-[13px] text-muted-foreground">题材轮动没算出来:{rot.reason || "原因不明"}</p>;
  const dates = safeArray<string>(rot.dates), days = safeArray<RotationDay>(rot.days);
  const themes = safeArray<RotationTheme>(rot.themes).filter(t=>`${t.tag} ${safeArray<string>(t.members).join(' ')}`.includes(filter.trim())).sort((a,b)=>order==='continuity'?b.active_days-a.active_days||b.today-a.today:order==='top3'?b.top3_days-a.top3_days||b.today-a.today:b.today-a.today);
  const active = themes.filter((t) => t.today), faded = themes.filter((t) => !t.today);
  const max = Math.max(1, ...themes.flatMap((t) => safeArray<number | null>(t.series).map((v) => finite(v) ?? 0)));
  const missing = safeArray<string>(rot.missing_days), partial = safeArray<string>(rot.partial_days);
  const cols = dates.length + (stats ? 5 : 1);
  const displayOptions = <>
    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={heatmap} onChange={e=>setHeatmap(e.target.checked)}/>热度底色</label>
    {scores && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={showMarket} onChange={e=>setShowMarket(e.target.checked)}/>大盘情绪</label>}
    {expectation && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={showOutlook} onChange={e=>setShowOutlook(e.target.checked)}/>历史预期</label>}
    {rail && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={expandedStats} onChange={e=>setExpandedStats(e.target.checked)}/>展开统计列</label>}
  </>;
  return (
    <div className={rail ? "theme-rotation-rail flex min-h-0 flex-1 flex-col gap-2" : "space-y-2"}>
      <div className="flex flex-wrap items-center gap-2"><input aria-label="筛选题材或代表股" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="筛选题材或代表股" className={cn("rounded border border-border bg-background px-3 py-2 text-xs", rail && "min-w-24 flex-1")}/><select aria-label="题材排序" value={order} onChange={e=>setOrder(e.target.value)} className="rounded border border-border bg-background px-3 py-2 text-xs"><option value="today">当日涨停数</option><option value="continuity">窗口活跃天数</option><option value="top3">进入前三天数</option></select>{!rail && <span className="text-xs text-muted-foreground">{themes.length} 个已加载题材 · 缺失留空</span>}</div>
      {!rail && missing.length > 0 && (
        <p role="status" className="text-[12px] text-warning">
          {missing.join("、")} 没取到:那几列画「—」,按缺数处理(不是 0),跨过它们的「连续」「回流」会注明说不准。
        </p>
      )}
      {!rail && partial.length > 0 && (
        <p role="status" className="text-[12px] text-warning">
          {partial.join("、")} 有沪深涨停股没有涨停原因:那几天没出现的题材画「—」(可能有),出现的只数是下限。
        </p>
      )}
      <div role="group" aria-label="矩阵读数" className="flex flex-wrap gap-1">{(["count","rank","height"] as const).map((key,i)=>
        <button type="button" key={key} aria-pressed={metric===key} onClick={()=>setMetric(key)} className={cn("rounded px-2.5 py-1 text-xs",metric===key?"bg-primary/15 text-primary":"text-muted-foreground")}>{["涨停只数","当日排名","最高板"][i]}</button>)}
        {rail ? <div className="ml-auto flex items-center gap-1">{(missing.length > 0 || partial.length > 0) && <span className="text-[11px] text-warning" role="status">数据有缺失</span>}<ContextHelp label="显示选项"><div className="grid gap-2">{displayOptions}{missing.length > 0 && <p role="status">缺失日期 {missing.join("、")}：按缺数处理，不是 0。</p>}{partial.length > 0 && <p role="status">原因不完整 {partial.join("、")}：未出现的题材可能有涨停，出现的只数是下限。</p>}</div></ContextHelp></div> : displayOptions}</div>
      <div ref={scroll} className={rail ? "theme-matrix-scroll min-h-0 flex-1 overflow-auto overscroll-contain" : "max-h-80 overflow-auto"}>
        <table aria-label="题材与交易日矩阵" data-compact={rail && !stats || undefined} onKeyDown={rail ? navigateMatrix : undefined} className={cn("w-full text-[13px] tabular-nums", stats ? "min-w-[640px]" : "min-w-[320px]")}>
          <thead className="sticky top-0 z-20 bg-card">
            <tr className="border-b border-border/60 text-left text-[11px] text-muted-foreground">
              <th scope="col" className={cn("whitespace-nowrap py-1.5 pr-3 font-medium", selection.onSelect && "sticky left-0 z-10 bg-card")}>题材</th>
              {dates.map((d, i) => {
                const day = days[i];
                return (
                  <th key={d} scope="col" aria-current={rail && selection.selected?.date === d ? "date" : undefined} className={cn("whitespace-nowrap px-1 py-1.5 text-center font-medium",rail && selection.selected?.date === d && "bg-primary/10 text-primary")} title={day && !day.available ? day.reason : undefined}>
                    {mmdd(d)}
                    <span className="block text-[10px] font-normal">{day?.available ? `涨停 ${day.limit_up ?? "—"}` : "没取到"}</span>
                    {day?.available && !!day.unknown && <span className="block text-[10px] font-normal text-warning">缺原因 {day.unknown}</span>}
                  </th>
                );
              })}
              {stats && <><th className="px-2 py-1.5 font-medium">状态</th>
              <th className="px-2 py-1.5 text-center font-medium">有涨停天数</th>
              <th className="px-2 py-1.5 text-center font-medium">进前三天数</th>
              <th className="px-2 py-1.5 font-medium">今天板数最高的</th></>}
            </tr>
            {rail && showMarket && scores && <tr className="border-b border-border bg-card text-xs">
              <th scope="row" className="sticky left-0 z-10 bg-card py-1.5 text-left">市场阶段</th>
              {dates.map(d => {
                const score = scores[d];
                const phase = score == null ? null : phaseOf(score);
                return <td key={d} className="whitespace-nowrap px-1 py-1.5 text-center" title={phase ? `短线王情绪节奏 · ${score} 分` : "市场情绪未取得"}>
                  <span className={cn("rounded px-1 py-0.5", phase==="升温" ? "bg-danger/15 text-danger" : phase==="退潮" ? "bg-success/15 text-success" : phase==="震荡" ? "bg-warning/15 text-warning" : "text-muted-foreground")}>{phase ?? "—"}</span>
                  {score != null && <small className="sr-only">{score} 分</small>}
                </td>;
              })}{stats && <td colSpan={4}>短线王情绪节奏</td>}
            </tr>}
          </thead>
          <tbody>
            {!rail && showMarket && scores && <tr className="border-b border-border text-xs"><th scope="row" className="sticky left-0 bg-card py-2 text-left">大盘情绪</th>
              {dates.map(d=><td key={d} className="px-1 text-center font-mono text-primary">{scores[d] == null ? "—" : scores[d]+"分"}</td>)}{stats && <td colSpan={4}>市场情绪节奏 · 0–100</td>}</tr>}
            {showOutlook && expectation && managedOutlook && <OutlookRow tag={managedOutlook.name} id={managedOutlook.id} dates={dates} expectation={expectation} stats={stats}/>}
            {active.length === 0 && (
              <tr><td colSpan={cols} className="py-3 text-center text-muted-foreground">{filter?'没有匹配的当日题材':'今天没有能归到题材的涨停股'}</td></tr>
            )}
            {active.flatMap(t => [<Row key={t.tag} t={t} max={max} dates={dates} metric={metric} heatmap={heatmap} rail={rail} stats={stats} {...selection} />,
              showOutlook && expectation && <OutlookRow key={"outlook:"+t.tag} tag={t.tag} dates={dates} expectation={expectation} stats={stats}/>])}
            {faded.length > 0 && (
              <tr><td colSpan={cols} className="pt-3 pb-1 text-[11px] text-muted-foreground">昨天还有 2 只以上、今天一只都没有的:</td></tr>
            )}
            {faded.flatMap(t => [<Row key={t.tag} t={t} max={max} dates={dates} metric={metric} heatmap={heatmap} rail={rail} stats={stats} {...selection} />,
              showOutlook && expectation && <OutlookRow key={"outlook:"+t.tag} tag={t.tag} dates={dates} expectation={expectation} stats={stats}/>])}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {rail ? `显示 ${themes.length} 个题材 · 窗口内共 ${rot.tag_count ?? "—"} 个标签` : <>这几天一共 {rot.tag_count ?? "—"} 个题材标签,表里只列今天前 {active.length} 个{faded.length > 0 && `和退下去的 ${faded.length} 个`}。客观公开榜单,非推荐 / 非预测。</>}
      </p>
    </div>
  );
}

/** 题材轮动这一块(还在取 / 没取到 / 取到了) */
export function ThemeRotationSection({ p, rail, ...selection }: MatrixSelection & MatrixContext & { p: Panel<ThemeRotationResult> }) {
  const body = p.state === "loading" ? <p role="status" className="text-[13px] text-muted-foreground">题材轮动加载中…</p>
        : !p.result ? <p role="status" className="text-[13px] text-muted-foreground">这次没取到:{p.why || "原因不明"}。不代表没有,可点右上角刷新重试。</p>
        : <ThemeRotationView r={p.result} rail={rail} {...selection} />;
  if (rail) return <section aria-label="题材轮动矩阵" className="glass flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3">
    {body}
  </section>;
  return (
    <Section icon={Grid3x3} title="题材轮动 · 近 5 天哪些题材在前排" caliber={ROTATION_CALIBER}>
      {body}
    </Section>
  );
}

/** 写给 AI 的一段:每个题材 5 天的只数(缺数写「缺」)和状态 */
export function rotationSummary(p: Panel<ThemeRotationResult>): string {
  if (p.state === "loading") return "题材轮动:还在取,先别据此下结论";
  if (!p.result) return `题材轮动:这次没取到(${p.why || "原因不明"}),不代表没有`;
  const rot = p.result.rotation;
  if (!rot?.available) return `题材轮动:没算出来(${rot?.reason ?? "原因不明"})`;
  const dates = safeArray<string>(rot.dates).map(mmdd);
  const rows = safeArray<RotationTheme>(rot.themes).map((t) =>
    `${t.tag}:${safeArray<number | null>(t.series).map((v) => (v == null ? "缺" : String(v))).join("/")}(${t.today ? t.status : "今天退下去了"},进前三 ${t.top3_days} 天)`);
  const miss = safeArray<string>(rot.missing_days), part = safeArray<string>(rot.partial_days);
  return [
    `题材轮动(近 ${dates.length} 个交易日 ${dates.join("、")} 每天的涨停只数;题材 = 同花顺涨停原因拆标签,源站编辑归因非公司确认,北交所不收录;「缺」= 那天没取到或说不准,不是 0):`,
    ...rows,
    ...(miss.length ? [`没取到的日子:${miss.join("、")}`] : []),
    ...(part.length ? [`有沪深涨停股缺原因的日子(那天没出现的题材写「缺」,出现的只数是下限):${part.join("、")}`] : []),
  ].join("\n");
}
