import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { ThemeMarketClose, ThemeExpectations, findExpectation } from "./ThemeDayContext";
import { loadNotes } from "@/lib/notes";
import { readRhythm } from "@/components/ReviewSentimentRhythm";
import { ThemePriceChart, useThemePrices } from "./ThemePriceChart";
import { ThemeNews } from "./ThemeNews";
import { ContextHelp } from "../components/ui/ContextHelp";
import { hhmm, signed } from "./format";
import { cn } from "@/lib/utils";
import { readDailyTiers } from "@/lib/dailyReviewData";
import { normalizeMarketSymbol } from "@/lib/marketSymbol";
import { JourneyLink } from "@/components/JourneyLink";
import { backend } from "@/lib/backend";
import { LOADING, loadBlocks, panelOf, type BlockQuery, type Panel } from "./api";
import { createReviewCache, reviewTtl } from "./reviewCache";
import { ROTATION_CALIBER, ThemeRotationSection, type ThemeCell } from "./ThemeRotationPanel";
import type { BoardLadderResult, ThemeRotationResult, ThemesResult } from "./types";
import type { ViewTabProps } from "./WeeklyTab";
import { useThemeHistoryMembers } from "./themeHistoryMembers";
import "./themeReviewDesk.css";

const rotationIds = ["rotation"];
const themeIds = ["themes", "firstboard"];
const ladderIds = ["ladder"];
const extendedRotation = createReviewCache<Panel<ThemeRotationResult>>(10);

function readExtendedRotation(day: string, refresh: boolean) {
  return extendedRotation.read(day, refresh, async () => {
    const { envelope, cached, fetched_at } = await backend.fetch("cn_shortline_theme_rotation", {args:{date:day,days:10},refresh});
    const status = envelope.status === "ok" || envelope.status === "partial" ? envelope.status : "failed";
    const panel = panelOf<ThemeRotationResult>({id:"rotation",title:"题材轮动",note:ROTATION_CALIBER,status,envelope:{...envelope},cached,fetched_at});
    if (panel.state !== "done" || panel.result?.date !== day || !panel.result.rotation?.available)
      throw new Error("未取得该日的十日轮动");
    return panel;
  }, panel => reviewTtl(day, panel.state === "done" && panel.status === "ok"));
}

function useMarketPanel<T extends { date: string }>(query: BlockQuery, ids: string[], date: string | undefined, nonce: number): Panel<T> {
  const [record, setRecord] = useState<{date: string; nonce: number; panel: Panel<T>} | null>(null);
  const lastNonce = useRef(nonce);
  useEffect(() => {
    const refresh = lastNonce.current !== nonce;
    lastNonce.current = nonce;
    if (!date) return;
    let current = true;
    void loadBlocks(query, ids, date, refresh).then(blocks => {
      if (!current) return;
      let panel = blocks[ids[0]!] as Panel<T>;
      if (panel.state === "done" && panel.result && panel.result.date !== date) {
        panel = { ...panel, result: null, status: "missing", why: "数据日期与所选交易日不一致" };
      }
      setRecord({date, nonce, panel});
    });
    return () => { current = false; };
  }, [query, ids, date, nonce]);
  return record?.date === date && record?.nonce === nonce ? record.panel : LOADING;
}

export type ThemeCatalogEntry = { id?: string; name: string; path?: string; description?: string; members: {code: string; name?: string; role?: string}[] };
type DetailProps = {
  cell: ThemeCell; themes: Panel<ThemesResult>; ladder: Panel<BoardLadderResult>; reviewDay: string;
  managed?: ThemeCatalogEntry; linked?: boolean;
};
type HistoryMembers = ReturnType<typeof useThemeHistoryMembers>;

function detailData({ cell, themes, ladder, managed }: DetailProps) {
  const tree = themes.state === "done" && themes.result?.date === cell.date ? themes.result.tree : null;
  const node = !managed && tree?.available ? tree.themes?.find(t => t.tag === cell.tag) : null;
  const book = ladder.state === "done" && ladder.result?.date === cell.date ? ladder.result.ladder : null;
  const levels = book?.available ? book.levels ?? [] : [];
  const stocks = levels.flatMap(level => level.stocks);
  const reasons = new Map(stocks.map(stock => [stock.code, stock.reason]));
  const byCode = new Map((node?.members ?? []).map(stock => [stock.code, stock]));
  const custom = new Set(managed?.members.map(s => s.code));
  for (const stock of stocks) {
    if ((managed ? custom.has(stock.code) : stock.tags?.includes(cell.tag)) && !byCode.has(stock.code)) byCode.set(stock.code, stock);
  }
  const members = [...byCode.values()].sort((a, b) => b.boards - a.boards || a.code.localeCompare(b.code));
  const all = [...members.map(s => ({code:s.code, name:s.name})), ...(managed?.members ?? []).filter(s => !byCode.has(s.code))];
  return {tree, node, reasons, byCode, members, all};
}

type MemberMetric = "height" | "close" | "change" | "return10" | "return20";
const memberColumns: { key: MemberMetric; title: string }[] = [
  { key: "height", title: "板位" }, { key: "close", title: "收盘" }, { key: "change", title: "涨跌幅" },
  { key: "return10", title: "10日" }, { key: "return20", title: "20日" },
];

export function ThemeMembers(props: DetailProps & { history?: HistoryMembers }) {
  const { cell, themes, ladder, reviewDay, managed, linked, history } = props;
  const {tree,node,byCode,reasons,members,all:todayMembers} = useMemo(() => detailData(props), [cell.tag,cell.date,themes,ladder,managed]);
  const historicalByCode = new Map(history?.members.map(stock => [stock.code, stock]));
  const all = history ? history.members : todayMembers;
  const [focus, setFocus] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{key: MemberMetric; ascending: boolean}>({key: linked ? "change" : "height", ascending: false});
  const roles = new Map(managed?.members.map(stock => [stock.code, stock.role]));
  const isCore = (code: string) => linked && (roles.get(code) === "龙头" || roles.get(code) === "领涨");
  const filtered = all.filter(s => (s.code + (s.name ?? "")).includes(filter.trim()))
    .sort((a,b) => Number(isCore(b.code)) - Number(isCore(a.code)));
  const grouped = linked && !!managed && filtered.some(s => isCore(s.code));
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const activePage = Math.min(pages - 1, page);
  const visible = filtered.slice(activePage * 20, activePage * 20 + 20);
  const quote = useThemePrices(cell.date, linked ? visible : []);
  const valueFor = (code: string) => sort.key === "height" ? byCode.get(code)?.boards : quote.byCode[code]?.[sort.key];
  const sorted = [...visible].sort((a, b) => {
    if (grouped && isCore(a.code) !== isCore(b.code)) return Number(isCore(b.code)) - Number(isCore(a.code));
    if (quote.loading && sort.key !== "height") return 0;
    const x = valueFor(a.code), y = valueFor(b.code);
    if (x == null || y == null) return Number(x == null) - Number(y == null);
    return sort.ascending ? x - y : y - x;
  });
  const highest = members[0]?.boards ?? 0;
  const firstSeal = members.map(s => s.first_seal).filter((s): s is string => Boolean(s)).sort()[0];
  const loading = themes.state === "loading" || ladder.state === "loading";
  const errors = [themes, ladder].flatMap(p => p.state === "done" && p.why ? [p.why] : []);
  const tableRef = useRef<HTMLTableElement>(null);
  const detailId = useId();
  const activeIndex = sorted.findIndex(s => s.code === focus);
  const active = linked ? sorted[activeIndex] : undefined;

  function memberButton(code: string) {
    return tableRef.current?.querySelector<HTMLButtonElement>(`[data-member="${code}"]`);
  }

  function showAdjacent(index: number) {
    const stock = sorted[index];
    if (!stock) return;
    setFocus(stock.code);
    memberButton(stock.code)?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    if (!focus) return;
    const table = tableRef.current;
    const scroller = table?.parentElement;
    const row = table?.querySelector(`[data-member="${focus}"]`)?.closest("tr");
    if (!scroller || !row) return;
    const item = row.getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    const top = Math.max(viewport.top, table.tHead?.getBoundingClientRect().bottom ?? viewport.top);
    if (item.top < top) scroller.scrollTop -= top - item.top;
    else if (item.bottom > viewport.bottom) scroller.scrollTop += item.bottom - viewport.bottom;
  }, [focus, activeIndex]);

  function goToPage(next: number) {
    setPage(next);
    setFocus("");
    tableRef.current?.parentElement?.scrollTo({top: 0});
  }

  return <section className={cn("glass min-w-0 space-y-2 p-3", linked && "theme-stock-pane")} aria-label="所选交易日题材样本">
    <header className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
      <h3>题材内股票 <span className="text-muted-foreground">· {cell.tag}</span></h3>
      <time className="text-xs tabular-nums text-muted-foreground">{cell.date}</time>
    </header>
    {history && <p role="status" className="text-xs text-muted-foreground">{history.loading ? "正在回看各交易日的涨停归因…" : `覆盖 ${history.availableDays.length} 个交易日 · ${all.length} 只历史涨停股`}{!history.loading && history.missingDays.length>0 && <span className="ml-2 text-warning" title={history.missingDays.join("、")}>{history.missingDays.length} 日源数据有缺口</span>}</p>}
    {!all.length && (history || !node) ? !history?.loading && <p role="status" className="text-sm">{history ? "该窗口内暂无明确归到此题材的涨停股。" : loading ? "正在读取当日题材样本…" : errors.join(" · ") || tree?.reason || "当日事件树和连板天梯均未收录这个题材的成分明细。"}</p>
      : <>
        {history ? null : linked ? <p className="text-xs text-muted-foreground">{managed && !managed.id?.startsWith("source:") ? "自管成分名单" : managed?.id?.startsWith("source:标准行业分类|") ? "当日标准行业成分" : "当日涨停归因样本"} · {all.length} 只{!managed && " · 同花顺涨停原因标签"}</p>
          : <p className="text-xs text-muted-foreground">{node ? <>{node.state} · 事件树统计涨停 {node.limit_up} 只 · 最高 {node.highest} 板</>
          : <>当日连板天梯匹配 {members.length} 只</>}{managed && <> · {managed.id?.startsWith("source:") ? "来源" : "管理"}名单 {managed.members.length} 只</>}</p>
        }
        {!!all.length && <>
          <input type="search" aria-label="搜索题材内股票" placeholder="股票名称或代码" value={filter}
            onChange={e => { setFilter(e.target.value); goToPage(0); }}
            className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs" />
          {pages > 1 && <p className="text-xs text-muted-foreground">共 {filtered.length} 只 · 当前页按{memberColumns.find(c => c.key === sort.key)?.title}{sort.ascending ? "升序" : "降序"}</p>}
          <div className={cn("overflow-auto rounded border border-border/60", linked ? "theme-stock-scroll" : "max-h-[68dvh]")}>
            <table ref={tableRef} className="w-full min-w-[19.75rem] border-separate border-spacing-0 text-left text-xs">
              <caption className="sr-only">{linked ? "点击股票行查看日 K，上下方向键切换。列标题可按当前页排序。" : "题材内股票，列标题可按当前页排序"}</caption>
              <thead className="sticky top-0 z-10 bg-card text-muted-foreground"><tr>
                <th scope="col" className="border-b border-border px-1.5 py-2 font-medium">股票</th>
                {memberColumns.map(({key,title}) => <th scope="col" key={key} className="border-b border-border px-1 py-2 text-right font-medium"
                  aria-sort={key === sort.key ? (sort.ascending ? "ascending" : "descending") : undefined}>
                  <button type="button" className="whitespace-nowrap hover:text-foreground" aria-label={"按本页" + title + "排序"}
                    onClick={() => setSort(prev => ({key, ascending: key === prev.key && !prev.ascending}))}>
                    {title}{sort.key === key && <span aria-hidden="true">{sort.ascending ? "↑" : "↓"}</span>}
                  </button>
                </th>)}
              </tr></thead>
              <tbody>{sorted.flatMap((stock, index) => {
                const sample = byCode.get(stock.code), price = quote.byCode[stock.code];
                const role = roles.get(stock.code);
                const historical = historicalByCode.get(stock.code);
                const expanded = linked && focus === stock.code;
                const pendingPrice = linked && quote.loading && !price;
                const label = stock.name || stock.code;
                const href = "/workbench?symbol=" + stock.code + "&date=" + cell.date;
                const reason = reasons.get(stock.code) || (ladder.state === "loading" ? "正在读取当日涨停原因…" : "当日涨停原因原文未取得");
                return [
                  grouped && (index === 0 || isCore(stock.code) !== isCore(sorted[index - 1]!.code)) &&
                    <tr key={isCore(stock.code) ? "core" : "other"} className="bg-muted/70">
                      <th colSpan={6} scope="row" className="px-2 py-1.5 text-left font-semibold text-muted-foreground">{isCore(stock.code) ? "核心股票" : "其他成分股"}</th>
                    </tr>,
                  <tr key={stock.code} onClick={linked ? () => {
                    setFocus(stock.code);
                    memberButton(stock.code)?.focus({ preventScroll: true });
                  } : undefined}
                    className={cn("align-middle [&>td]:border-b [&>td]:border-border/40", linked && "theme-member-row cursor-pointer", expanded && "theme-member-current")}>
                    <td className="min-w-[4.3rem] px-1.5 py-1.5">
                      {linked ? <button type="button" aria-label={"查看" + label + "详情"} aria-expanded={expanded} aria-controls={detailId} data-member={stock.code}
                        className="block text-left font-semibold text-primary hover:underline"
                        onKeyDown={e => {
                          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                          e.preventDefault();
                          showAdjacent(index + (e.key === "ArrowDown" ? 1 : -1));
                        }}>{label}</button>
                        : <JourneyLink context={{date:reviewDay}} to={href} className="font-semibold text-primary">{label}</JourneyLink>}
                      <small className="block font-mono text-[10px] text-muted-foreground">{stock.code}</small>
                      {historical && <small className="block whitespace-nowrap text-[10px] text-muted-foreground" title={`最近涨停 ${historical.lastHit}，窗口内 ${historical.hitDays} 个交易日涨停`}>{historical.lastHit.slice(5)} · {historical.hitDays}日</small>}
                      {linked && role && <span className="rounded bg-primary/15 px-1 text-[10px] text-primary">{role}</span>}
                    </td>
                    <td className="whitespace-nowrap px-1 text-right">
                      <span className={cn(sample && sample.boards === highest && highest > 1 && "font-semibold text-warning")}>
                        {sample?.label || (sample ? sample.boards + "板" : "—")}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-1 text-right tabular-nums">{pendingPrice ? "…" : price?.close?.toFixed(2) ?? "—"}</td>
                    {[price?.change,price?.return10,price?.return20].map((v,i) => <td key={i}
                      className={cn("whitespace-nowrap px-1 text-right tabular-nums", v && v > 0 ? "text-danger" : v && v < 0 ? "text-success" : "")}>{pendingPrice ? "…" : signed(v)}</td>)}
                  </tr>,
                  !linked && <tr key={stock.code + "-detail"}><td colSpan={6} className="bg-muted/20 px-2 py-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <b>{label}</b><span>首封 {hhmm(sample?.first_seal)}</span>
                      {sample && highest > 1 && sample.boards === highest && <span className="text-warning">样本最高板</span>}
                      {sample && firstSeal && sample.first_seal === firstSeal && <span className="text-primary">最早首封</span>}{role && <span>{role}</span>}
                    </div>
                    <p className="mt-1 break-words text-xs text-muted-foreground">{reason}</p>
                  </td></tr>,
                ];
              })}</tbody>
            </table>
          </div>
        </>}
        {!!all.length && !filtered.length && <p role="status" className="text-sm">没有匹配的股票。</p>}
        {pages > 1 && <div className="flex items-center justify-between gap-2 text-xs"><button type="button" disabled={!activePage} onClick={()=>goToPage(activePage-1)} className="disabled:opacity-40">上一页</button><span>{activePage+1} / {pages} · {filtered.length} 只</span><button type="button" disabled={activePage===pages-1} onClick={()=>goToPage(activePage+1)} className="disabled:opacity-40">下一页</button></div>}
        {linked && <section id={detailId} hidden={!active} aria-label="所选个股详情" className="theme-member-detail">
          {active && <>
            <header className="flex items-center gap-2 px-2 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate"><b>{active.name || active.code}</b> <span className="text-muted-foreground">{active.code} {roles.get(active.code)}</span></span>
              <button type="button" aria-label="上一只股票" disabled={activeIndex===0} onClick={()=>showAdjacent(activeIndex-1)}><ChevronLeft size={16}/></button>
              <button type="button" aria-label="下一只股票" disabled={activeIndex===sorted.length-1} onClick={()=>showAdjacent(activeIndex+1)}><ChevronRight size={16}/></button>
              <button type="button" aria-label="收起个股详情" onClick={() => { setFocus(""); memberButton(active.code)?.focus({ preventScroll:true }); }}><X size={15}/></button>
            </header>
            <div className="theme-member-detail-body" key={active.code}>
              <ThemePriceChart day={cell.date} name={active.name || active.code} symbol={active.code} members={all} />
              <div className="flex flex-wrap gap-x-2 px-2 text-xs text-muted-foreground">
                <span>首封 {hhmm(byCode.get(active.code)?.first_seal)}</span>
                {highest>1 && byCode.get(active.code)?.boards===highest && <span className="text-warning">样本最高板</span>}
                {firstSeal && byCode.get(active.code)?.first_seal===firstSeal && <span className="text-primary">最早首封</span>}
                <JourneyLink context={{date:reviewDay}} to={`/workbench?symbol=${active.code}&date=${cell.date}`} className="ml-auto text-primary hover:underline">个股工作台 ↗</JourneyLink>
              </div>
              <p className="break-words px-2 pb-2 pt-1 text-xs text-muted-foreground">{reasons.get(active.code) || (ladder.state==="loading" ? "正在读取当日涨停原因…" : "当日涨停原因原文未取得")}</p>
            </div>
          </>}
        </section>}
        {!history && node && members.length !== node.limit_up && <p className="text-xs text-muted-foreground">当日事件树、天梯及管理名单共匹配 {members.length} 只涨停股。</p>}
        {history ? <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">样本口径</summary><p className="mt-1">按窗口内各交易日的涨停原因匹配同名题材，按股票代码合并。收盘价与区间涨幅以所选样本日为准。</p></details>
          : tree?.source_note && !managed && (linked ? <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">样本口径</summary><p className="mt-1">{tree.source_note}</p></details>
          : <p className="text-xs text-muted-foreground">{tree.source_note}</p>)}
      </>}
  </section>;
}

interface ThemeReviewProps extends ViewTabProps {
  selectedTheme?: string; selectedThemeId?: string; selectedDate?: string;
  onActiveTheme?: (name:string,id:string|undefined,date:string)=>void;
  onSelectTheme?: (name:string,id?:string,sampleDate?:string) => void; onManageTheme?: (name:string,id?:string,sampleDate?:string) => void;
  managedThemes?: ThemeCatalogEntry[];
}

function useCatalogTrend(entry: ThemeCatalogEntry | undefined, dates: string[], revision: number) {
  const daysKey = dates.join(",");
  const memberKey = entry?.members.map(s => s.code).sort().join(",") ?? "";
  const id = entry?.id;
  const name = entry?.name;
  const signature = JSON.stringify([id, name, daysKey, memberKey, revision]);
  const [result, setResult] = useState<{key: string; series: (number|null)[]; highest: (number|null)[]}>();
  const last = useRef(revision);
  useEffect(() => {
    if (!id) return;
    let active = true;
    const force = last.current !== revision;
    last.current = revision;
    const codes = new Set(memberKey.split(","));
    void Promise.all(daysKey.split(",").map(async date => {
      try {
        const day = await readDailyTiers(date, force);
        if (day.date !== date || day.total == null || (!day.groups.length && day.total > 0)) return null;
        const stocks = day.groups.flatMap(group => group.stocks.filter(stock =>
          id.startsWith("source:东财涨停行业|") ? group.industry === name :
          id.startsWith("source:同花顺涨停题材|") ? stock.tags.includes(name || "") :
          codes.has(normalizeMarketSymbol(stock.symbol) ?? "")));
        const heights = stocks.flatMap(s => s.boards == null ? [] : [s.boards]);
        if (!stocks.length && id.startsWith("source:同花顺涨停题材|") && day.gaps?.length) return null;
        return { count: stocks.length, max: heights.length ? Math.max(...heights) : null };
      } catch { return null; }
    })).then(points => {
      if (active) setResult({key:signature, series: points.map(p => p?.count ?? null), highest:points.map(p => p?.max ?? null)});
    });
    return () => { active = false; };
  }, [id, name, daysKey, memberKey, revision, signature]);
  return result?.key === signature ? result : undefined;
}

export function ThemeReviewTab({ day, refreshNonce, onBusy, selectedTheme, selectedThemeId, selectedDate, onSelectTheme, onManageTheme, onActiveTheme, managedThemes = [] }: ThemeReviewProps) {
  const rotation = useMarketPanel<ThemeRotationResult>("shortline_rotation", rotationIds, day, refreshNonce);
  const [longWindow,setLongWindow] = useState(false);
  const [extended,setExtended] = useState<{day:string; revision:number; panel?:Panel<ThemeRotationResult>}>();
  const rotationRefresh = useRef(refreshNonce);
  useEffect(() => {
    if (!longWindow) return;
    let active = true;
    const refresh = rotationRefresh.current !== refreshNonce;
    rotationRefresh.current = refreshNonce;
    void readExtendedRotation(day,refresh).then(panel => { if (active) setExtended({day,revision:refreshNonce,panel}); })
      .catch(() => { if (active) setExtended({day,revision:refreshNonce}); });
    return () => { active = false; };
  },[day,longWindow,refreshNonce]);
  const extendedNow = extended?.day === day && extended.revision === refreshNonce ? extended : undefined;
  const matrix = longWindow ? extendedNow?.panel ?? rotation : rotation;
  const [choice, setChoice] = useState<{reviewDay:string; cell:ThemeCell; id?:string}>();
  const [notes,setNotes] = useState(loadNotes);
  const [market,setMarket] = useState<{date:string; scores:Record<string,number|null>}>();
  const rhythmRefresh=useRef(refreshNonce);
  useEffect(() => {
    let active=true;
    const force=rhythmRefresh.current !== refreshNonce;
    rhythmRefresh.current=refreshNonce;
    void readRhythm(day,force).then(r=>{if(active && r.date===day)setMarket({date:day,scores:Object.fromEntries(r.series.map(p=>[p.date,p.score]))});})
      .catch(()=>{ if(active)setMarket(undefined); });
    return ()=>{active=false;};
  },[day,refreshNonce]);
  const rot = matrix.state === "done" ? matrix.result?.rotation : null;
  const rows = rot?.themes ?? [];
  const dates = rot?.dates?.length ? rot.dates : [day];
  const local = choice?.reviewDay === day ? choice.cell : undefined;
  const refThemes = useMarketPanel<ThemesResult>("shortline_themes", themeIds, day, refreshNonce);
  const tree = refThemes.state === "done" && refThemes.result?.tree?.available ? refThemes.result.tree.themes : [];
  const names = [...new Set([...rows.map(r => r.tag), ...(tree ?? []).map(t => t.tag), ...(selectedTheme && !selectedThemeId ? [selectedTheme] : [])])];
  const defaultManaged = !names.length && rotation.state === "done" && refThemes.state === "done" ? managedThemes[0] : undefined;
  const identity = selectedTheme ? selectedThemeId : local ? choice?.id : defaultManaged?.id;
  const managed = useMemo(() => identity ? managedThemes.find(t => t.id === identity) ?? {id:identity,name:selectedTheme || "",members:[]} : undefined,
    [identity,managedThemes,selectedTheme]);
  const name = managed?.name || selectedTheme || local?.tag || names[0] || "";
  const requestedDate = selectedDate ?? (local?.tag === name ? local.date : undefined);
  const date = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && requestedDate <= day ? requestedDate : day;
  useEffect(()=>{ if (name) onActiveTheme?.(name,identity,date); },[name,identity,date,onActiveTheme]);
  const previous = useMarketPanel<ThemesResult>("shortline_themes", themeIds, date === day ? undefined : date, refreshNonce);
  const themes = date === day ? refThemes : previous;
  const ladder = useMarketPanel<BoardLadderResult>("shortline_ladder", ladderIds, date, refreshNonce);
  const busy = rotation.state === "loading" || themes.state === "loading" || ladder.state === "loading";
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  const cell = { date, tag:name };
  const props = { cell, themes, ladder, reviewDay:day, managed };
  const {node,all,reasons,members} = useMemo(() => detailData(props),[date,name,themes,ladder,managed,day]);
  const catalogTrend = useCatalogTrend(managed, dates, refreshNonce);
  const trend = managed ? catalogTrend : rows.find(r => r.tag === name);
  type Pane = "topics" | "detail" | "members";
  const [pane,setPane] = useState<Pane>(selectedTheme ? "detail" : "topics");
  const [analysisPane,setAnalysisPane] = useState<"overview" | "news" | "outlook">("overview");
  const [memberScope,setMemberScope] = useState<"day" | "history">("day");
  const showHistory = memberScope === "history" && !identity;
  const history = useThemeHistoryMembers(name, [...dates.filter(d => d < date),date], showHistory, refreshNonce);
  const [directory,setDirectory] = useState(Boolean(selectedThemeId));
  const [search,setSearch] = useState("");
  const rail = useRef<HTMLElement>(null);
  const detailsScroll = useRef<HTMLDivElement>(null);
  const membersScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (detailsScroll.current) detailsScroll.current.scrollTop = 0;
  },[identity,name,date,analysisPane]);
  useEffect(() => {
    if (membersScroll.current) membersScroll.current.scrollTop = 0;
  },[identity,name,date,showHistory]);
  const matrixHasSelection = rows.some(r => r.tag === name);
  useEffect(() => {
    if (identity || (name && rot && !matrixHasSelection)) setDirectory(true);
  },[identity,name,rot,matrixHasSelection]);
  const select = (c:ThemeCell,id?:string) => {
    const fromRail = rail.current?.contains(document.activeElement);
    setChoice({reviewDay:day, cell:c,id});
    setPane(current => current === "members" ? current : "detail");
    onSelectTheme?.(c.tag,id,c.date);
    if (fromRail) requestAnimationFrame(() => {
      if (rail.current && !rail.current.getClientRects().length) detailsScroll.current?.focus({preventScroll:true});
    });
  };
  const matches = (label:string) => label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const library = managedThemes.filter(t => matches(t.path || t.name));
  const marketNames = names.filter(matches);
  const index = dates.indexOf(date);
  const dateOptions = dates.includes(date) ? dates : [...dates, date].sort();
  const selectedIndex = dateOptions.indexOf(date);
  const status = date === day && trend && "status" in trend ? trend.status : node?.state;
  const pending = <p role="status" className="p-4 text-sm text-muted-foreground">{busy ? "正在读取题材…" : "该交易日暂无题材样本。"}</p>;
  return <div className="theme-review-desk" data-pane={pane}>
    <nav aria-label="题材分栏" className="theme-desk-switch">
      <button aria-pressed={pane==="topics"} onClick={() => setPane("topics")}>选题材</button>
      <button className="theme-switch-compact" aria-pressed={pane==="detail"} onClick={() => setPane("detail")}>题材详情</button>
      <button className="theme-switch-medium" aria-pressed={pane!=="members"} onClick={() => setPane("detail")}>题材详情</button>
      <button aria-pressed={pane==="members"} onClick={() => setPane("members")}>成分股</button>
    </nav>
    <div className="theme-desk-columns">
      <aside ref={rail} aria-label="题材导航" className="theme-desk-rail glass">
        <div className="theme-desk-source" role="group" aria-label="题材来源">
          <button aria-pressed={!directory} onClick={() => setDirectory(false)}>轮动矩阵</button>
          <button aria-pressed={directory} onClick={() => setDirectory(true)}>题材目录</button>
          {!directory && <button className="ml-auto" aria-pressed={longWindow} onClick={() => setLongWindow(value => !value)} title="切换五日和十日窗口">{longWindow ? "近 10 日" : "近 5 日"}</button>}
          {!directory && <div className="self-center"><ContextHelp><p>点击题材或日期联动右栏。方向键可以切换题材和交易日。</p><p className="whitespace-pre-line">{ROTATION_CALIBER}</p></ContextHelp></div>}
        </div>
        <div hidden={directory} className="theme-matrix-slot">
          {longWindow && !extendedNow?.panel && <p role="status" className="px-3 pt-2 text-xs text-muted-foreground">{extendedNow ? "十日数据暂未取得，当前显示近 5 日。" : "正在补齐近 10 个交易日…"}</p>}
          <ThemeRotationSection rail p={matrix} onSelect={select} selected={identity ? {date} : cell}
            expectation={(tag,d,id)=>findExpectation(notes,tag,d,id)?.content} managedOutlook={managed}
            scores={market?.date===day ? market.scores : {}} />
        </div>
        <div hidden={!directory} className="theme-directory glass">
          <label className="block p-2"><input type="search" aria-label="搜索题材目录" placeholder="搜索市场题材或自管题材" value={search} onChange={e => setSearch(e.target.value)} className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"/></label>
          <div className="theme-directory-list">
            {library.length>0 && <h3>题材库</h3>}
            {library.map(t=><button key={t.id} aria-pressed={t.id===identity} onClick={() => select({tag:t.name,date},t.id)}>{t.path || t.name}</button>)}
            {marketNames.length>0 && <h3>市场题材</h3>}
            {marketNames.map(tag=><button key={tag} aria-pressed={!identity && name===tag} onClick={() => select({tag,date})}>{tag}</button>)}
            {!library.length && !marketNames.length && <p className="p-3 text-sm text-muted-foreground">{search ? "没有匹配的题材" : busy ? "正在读取目录…" : "该日暂无题材"}</p>}
          </div>
        </div>
      </aside>
      <section className="theme-desk-detail glass" aria-label="题材详情">
        <header className="theme-pane-heading">
          <h2>{name || "题材详情"} {status && <small>{status}</small>}</h2>
          {name && <div className="theme-sample-picker">
            <button type="button" aria-label="上一个样本日" disabled={selectedIndex<=0} onClick={()=>select({tag:name,date:dateOptions[selectedIndex-1]!},identity)}><ChevronLeft size={15}/></button>
            <select aria-label="题材样本日" value={date} onChange={e=>select({tag:name,date:e.target.value},identity)}>{dateOptions.map(d=><option key={d} value={d}>{d.slice(5)}</option>)}</select>
            <button type="button" aria-label="下一个样本日" disabled={selectedIndex===dateOptions.length-1} onClick={()=>select({tag:name,date:dateOptions[selectedIndex+1]!},identity)}><ChevronRight size={15}/></button>
            {onManageTheme && <button onClick={() => onManageTheme(name,identity,date)} className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-muted" title={managed ? "管理此题材" : "加入题材管理"}>管理</button>}
          </div>}
        </header>
        {name && <div className="theme-pane-options" role="group" aria-label="题材详情视图">
          <button aria-pressed={analysisPane==="overview"} onClick={()=>setAnalysisPane("overview")}>盘面概览</button>
          <button aria-pressed={analysisPane==="news"} onClick={()=>setAnalysisPane("news")}>题材消息</button>
          <button aria-pressed={analysisPane==="outlook"} onClick={()=>setAnalysisPane("outlook")}>预期与实测</button>
        </div>}
        <div className="theme-detail-scroll" ref={detailsScroll} tabIndex={0} aria-label="题材分析内容">
        {name ? <>
        {analysisPane === "overview" && <>
        <ThemePriceChart day={date} name={name} members={all} compact/>
        <section className="glass space-y-2 p-4">
          <h3>当日题材 <span className="ml-1 text-xs font-normal text-muted-foreground">{!managed || /^source:(?:同花顺|东财)/.test(identity ?? "") ? "涨停归因" : identity?.startsWith("source:") ? "标准行业成分" : "自管名单"}</span></h3>
          {managed?.description && <p className="text-sm">{managed.description}</p>}
          <dl className="theme-close-metrics">{[["涨停",node?.limit_up ?? trend?.series[index]],["最高板",node?.highest ?? trend?.highest[index]],["首板",node?.first_boards],["连板",node?.consec_boards],["炸板",node?.broken],["跌停",node?.limit_down],["最早首封",hhmm(node?.first_seal)]].map(([label,v]) =>
            <div key={label}><dt>{label}</dt><dd>{v ?? "—"}</dd></div>)}</dl>
          {managed && <div className="flex flex-wrap gap-1" role="group" aria-label="题材历史涨停与板高">{dates.map((d,i) =>
            <button key={d} aria-pressed={d===date} onClick={() => select({tag:name,date:d},identity)}
              className="rounded border border-border px-2 py-1 text-left text-xs aria-pressed:border-primary aria-pressed:bg-primary/10">
              <time>{d.slice(5)}</time><span className="block">{trend?.series[i] ?? "—"} 只 · {trend?.highest[i] ?? "—"} 板</span>
            </button>)}</div>}
          {managed && <p className="text-xs text-muted-foreground">{identity?.startsWith("source:") ? "按各交易日来源收录的涨停股统计。" : "按当前管理名单回看各交易日的收盘涨停股。"}</p>}
        </section>
        <ThemeMarketClose key={"market:" + date} day={date} revision={refreshNonce}/>
        <section className="glass space-y-2 p-4"><h3>盘面驱动线索</h3>
          {members.some(s => reasons.get(s.code)) ? <ul className="space-y-1 text-xs">{members.filter(s=>reasons.get(s.code)).map(s=><li key={s.code}><b>{s.name}</b> · {reasons.get(s.code)}</li>)}</ul> :
            <p className="text-xs text-muted-foreground">当日题材样本暂无可核验的涨停归因。</p>}
          <p className="text-xs text-muted-foreground">来自当日涨停原因标签，属于公开行情归因。</p>
        </section>
        </>}
        {analysisPane==="news" && <ThemeNews key={"news:" + date} day={date} name={name} members={all} />}
        <div hidden={analysisPane!=="outlook"} className="theme-outlook-wrap">
        <ThemeExpectations key={`outlook:${identity ?? name}:${date}`} name={name} identity={identity} date={date} dates={dates.filter(d => d <= date)} trend={trend} notes={notes} onSave={setNotes}/>
        </div>
        </> : pending}</div>
      </section>
      <section className="theme-desk-members glass" aria-label="题材成分股" ref={membersScroll} tabIndex={0}>
        {name && !identity && <div className="theme-pane-options" role="group" aria-label="股票样本范围">
          <button aria-pressed={!showHistory} onClick={()=>setMemberScope("day")}>当日涨停</button>
          <button aria-pressed={showHistory} onClick={()=>setMemberScope("history")}>历史活跃股</button>
        </div>}
        {name ? <ThemeMembers key={`${date}:${identity ?? name}:${showHistory}`} {...props} linked history={showHistory ? history : undefined}/> : pending}
      </section>
    </div>
  </div>;
}
