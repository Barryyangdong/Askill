import { WorkspaceJourney } from "@/components/WorkspaceJourney";
import { JourneyLink } from "@/components/JourneyLink";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CalendarDays, RefreshCw, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import type { PageTab } from "@/components/ui/PageTabs";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { cn } from "@/lib/utils";
import { LOADING, badDayReason, loadBlocks, loadEmotion, type DayHead, type Panel } from "@/shortline/api";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { MarketInterpretation } from "./DailyReview";
import { ThemeWorkspace } from "@/shortline/ThemeWorkspace";
import { ReviewBoard } from "@/shortline/ReviewBoard";
import type { TodayPanels } from "@/shortline/TodayTab";
import { WeeklyTab } from "@/shortline/WeeklyTab";
import { HistoryTab } from "@/shortline/HistoryTab";
import { ReviewTab } from "@/shortline/ReviewTab";
import { WeeklyReviewTab } from "@/shortline/WeeklyReviewTab";
import { VerifyTab } from "@/shortline/VerifyTab";
import { SamplesTab } from "@/shortline/SamplesTab";
import { StructureTab } from "@/shortline/StructureTab";
import type { EmotionResult } from "@/shortline/types";
import { navTitle } from "@/lib/nav";
import { reviewNavigation } from "@/lib/reviewNavigation";

type Section = "today" | "themes" | "review" | "weekly" | "verify";
type Tab = Section | "weekreview" | "market-report" | "history" | "samples" | "structure";

const REPORTS: PageTab<Tab>[] = [
  { key: "review", label: "短线日报" }, { key: "market-report", label: "市场解读" }, { key: "weekreview", label: "周报" },
];
const STATISTICS: PageTab<Tab>[] = [
  { key: "weekly", label: "近 5 天" }, { key: "history", label: "情绪历史" },
  { key: "samples", label: "涨停样本" }, { key: "structure", label: "结构变化" },
];
const isTab = (v: string | undefined): v is Tab => v === "today" || v === "themes" || v === "verify"
  || REPORTS.some(option => option.key === v) || STATISTICS.some(option => option.key === v);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** 选的日子不能复盘:整页一句话说清,不在每一块里各报一遍 */
function BadDay({ why, onReset }: { why: string; onReset: (() => void) | null }) {
  return (
    <div className="glass p-6 text-sm">
      <p role="status" className="font-medium">{why},这一天没有可复盘的盘面。</p>
      <p className="mt-1 text-muted-foreground">换一个交易日再看{onReset && <>,或 <button type="button" onClick={onReset} className="text-primary underline-offset-2 hover:underline">回到默认的复盘日</button></>}。</p>
    </div>
  );
}

const ALL_LOADING: TodayPanels = { emotion: LOADING, facts: LOADING, themes: LOADING, firstboard: LOADING, cycle: LOADING, ladder: LOADING };

/**
 * 情绪复盘:短线情绪的温度、钱亏在哪、钱在哪些题材。
 * 看哪一天由地址里的 `?date=` 说了算;不给就用后端算的业务日(盘中看上一个交易日,收盘后看当天)。
 * 🔴 屏上的日期一律用后端回来的那天,不用浏览器本地"今天"。
 */
export function Shortline() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const requested = params.get('date');
  const backToInbox = () => {
    const origin = location.state?.inboxReturn;
    // Only the state attached by an inbox message authorizes history back.
    // External links have no such state and must not navigate off the app.
    if (origin?.source === 'inbox-message' && typeof origin.key === 'string') navigate(-1);
    else navigate('/inbox');
  };
  // Date changes start a new workspace; no previous-day panels or generated text flash.
  return <>{params.get('reminder') && <p role="note" className="mb-3 text-sm">{params.get('reminder')==='premarket'?`提醒日 ${params.get('reminderDay')??'未记录'}；前一交易日样本 ${requested}`:`收盘摘要业务日 ${requested}；此页展示历史情绪，完整摘要请返回原消息。`} <button type="button" onClick={backToInbox} className="text-primary underline">返回提醒</button></p>}<ReviewWorkspace key={requested && ISO_DAY.test(requested) ? requested : 'default'} /></>;
}
function ReviewWorkspace() {
  const { tab: rawTab } = useParams();
  const tab: Tab = isTab(rawTab) ? rawTab : "today";
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const reports = REPORTS.some(option => option.key === tab);
  const statistics = STATISTICS.some(option => option.key === tab);
  const picked = params.get("date");
  const date = picked && ISO_DAY.test(picked) ? picked : undefined;

  const [head, setHead] = useState<DayHead | null>(null);
  const [defaultDay, setDefaultDay] = useState<string | null>(null);
  const [panels, setPanels] = useState<TodayPanels>(ALL_LOADING);
  const [headBusy, setHeadBusy] = useState(false);
  const [blocksBusy, setBlocksBusy] = useState(false);
  const [tabBusy, setTabBusy] = useState(false);
  // 其余分页的「刷新」:只让当前分页带 refresh=1 重取
  const [refreshNonce, setRefreshNonce] = useState(0);
  // 换日期 / 刷新时旧请求可能晚回来:只认最后一次
  const headSeq = useRef(0);
  const blockSeq = useRef(0);
  // 今日情绪的其余几块只在打开「今日情绪」时取,且同一次表头只取一次
  const blocksFor = useRef<DayHead | null>(null);
  const refreshBlocks = useRef(false);

  const loadHead = useCallback(async (refresh: boolean) => {
    const my = ++headSeq.current;
    ++blockSeq.current;
    blocksFor.current = null;
    setHeadBusy(true);
    setBlocksBusy(false);
    setPanels(ALL_LOADING);
    const r = await loadEmotion({ date, refresh });
    if (my !== headSeq.current) return;
    if (r.defaultDay) setDefaultDay(r.defaultDay);
    setPanels((p) => ({ ...p, emotion: r.emotion as Panel<EmotionResult> }));
    setHead(r.head);
    setHeadBusy(false);
  }, [date]);

  useEffect(() => { void loadHead(false); return () => { ++headSeq.current; ++blockSeq.current; }; }, [loadHead]);

  const day = head?.day ?? null;
  // 这天不能复盘(不是交易日 / 还没到)或没拿到复盘日:整页一句话,其余分页也不去取
  const bad = date && defaultDay && date > defaultDay
    ? `所选日期晚于最近已收盘交易日 ${defaultDay}`
    : headBusy ? null : badDayReason(panels.emotion);
  const noDay = head && !headBusy && !bad && !day ? head.contextError ?? "没拿到复盘日" : null;
  const blocked = bad ?? noDay;

  useEffect(() => {
    if (tab !== "today" || !head || headBusy || blocksFor.current === head) return;
    blocksFor.current = head;
    const refresh = refreshBlocks.current;
    refreshBlocks.current = false;
    if (blocked || !day) {
      const none = { state: "done", status: "missing", result: null, why: blocked ?? "没拿到复盘日", settled: null, cached: false, fetched_at: null } as const;
      setPanels((p) => ({ ...p, facts: none, themes: none, firstboard: none, cycle: none, ladder: none }));
      return;
    }
    const my = ++blockSeq.current;
    setBlocksBusy(true);
    const put = (got: Record<string, Panel<unknown>>) => {
      if (my === blockSeq.current) setPanels((p) => ({ ...p, ...got } as TodayPanels));
    };
    void Promise.all([
      loadBlocks("shortline_facts", ["facts"], day, refresh).then(put),
      loadBlocks("shortline_themes", ["themes", "firstboard"], day, refresh).then(put),
      loadBlocks("shortline_cycle", ["cycle"], day, refresh).then(put),
      loadBlocks("shortline_ladder", ["ladder"], day, refresh).then(put),
    ]).then(() => { if (my === blockSeq.current) setBlocksBusy(false); });
  }, [tab, head, headBusy, blocked, day]);

  const busy = headBusy || (tab === "today" ? blocksBusy : tabBusy);
  const refresh = () => {
    if (tab === "today") { refreshBlocks.current = true; void loadHead(true); }
    else if (!day || blocked) void loadHead(true);
    setRefreshNonce((n) => n + 1);
  };

  const setDate = (d: string | null) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (d) next.set("date", d); else next.delete("date");
    next.delete("sampleDate");
    // A manual date choice leaves the original reminder's context.
    next.delete("reminder");
    next.delete("reminderDay");
    return next;
  });
  const pickTab = (t: Tab, focusVerifyPlan = false, theme?: string) => {
    if (t === tab) return;
    const { to, replace, state } = reviewNavigation(t === "today" ? "/shortline" : `/shortline/${t}`, params.toString(), location.state,
      { theme, focusVerifyPlan, day });
    navigate(to, { replace, state });
  };

  const ctx = head?.context;
  const viewProps = day && !headBusy ? { day, refreshNonce, onBusy: setTabBusy } : null;
  // Default market queries resolve their own trading date. Only a user-selected date
  // needs the calendar check before choosing the current or historical view.
  const marketReady = !date || Boolean(day);
  const themeView = tab === "themes";
  const reviewActions = <>
    {day && <JourneyLink to={`/watch/intraday?date=${encodeURIComponent(day)}`} className="rounded border border-border px-2.5 py-1 text-xs text-primary hover:bg-primary/5">同日盘中</JourneyLink>}
    <label className="inline-flex items-center gap-1.5 rounded border border-border/60 px-2 py-1 text-xs text-muted-foreground">
      <CalendarDays className="h-3.5 w-3.5" />
      <span>复盘日</span>
      <input type="date" aria-label="复盘日" value={date ?? day ?? ""} max={defaultDay ?? undefined}
        onChange={(ev) => setDate(ev.target.value || null)} className="bg-transparent text-foreground outline-none" />
    </label>
    {date && <button type="button" onClick={() => setDate(null)}
      className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      title="回到默认的复盘日" aria-label="回到默认复盘日"><RotateCcw className="h-3.5 w-3.5" />{!themeView && "回到默认"}</button>}
    <button type="button" onClick={refresh} disabled={busy}
      className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      aria-label="刷新" title="重新取当前分页"><RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />{!themeView && "刷新"}</button>
  </>;

  return (
    <div className={themeView ? "theme-review-page" : undefined}>
      {themeView ? <header className="theme-review-toolbar">
        <h1>题材</h1>
        <div className="theme-review-actions">{reviewActions}</div>
      </header> : <>
        <WorkspaceJourney date={day} />
        <PageHeader title={navTitle(tab === "today" ? "/shortline" : `/shortline/${tab}`)} subtitle={headBusy && !day ? "正在确定复盘日…" : !date ? ctx?.review_reason : undefined} actions={reviewActions} />
      </>}

      {head?.contextError && !noDay && (
        <p className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          没拿到交易日历:{head.contextError}。{date ? "按你选的日期去取。" : "选一个日期再看。"}
        </p>
      )}
      {(reports || statistics) && (
        <div className="mb-4">
          <SegmentedToggle label={reports ? "报告类型" : "统计视图"} value={tab}
            options={reports ? REPORTS : STATISTICS} onChange={pickTab} />
        </div>
      )}

      {bad ? <BadDay why={bad} onReset={date ? () => setDate(null) : null} />
        : noDay ? <p role="status" className="glass p-6 text-sm text-muted-foreground">没拿到复盘日({noDay}),先不取数。选一个日期再看,或点右上角刷新重试。</p>
        : tab === "today" && marketReady ? <ReviewBoard day={day} date={date} recentDay={defaultDay} panels={panels}
            refreshNonce={refreshNonce} onThemes={tag => pickTab("themes", false, tag)} onVerify={() => pickTab("verify", true)} />
        : tab === "market-report" && marketReady ? <MarketInterpretation day={date} recentDay={defaultDay} refreshNonce={refreshNonce} />
        : !viewProps ? <p role="status" className="glass p-6 text-sm text-muted-foreground">正在确定复盘日…</p>
        : tab === "themes" ? <ThemeWorkspace key={day} {...viewProps} />
        : tab === "review" ? <ReviewTab key={day} {...viewProps} />
        : tab === "weekreview" ? <WeeklyReviewTab key={day} {...viewProps} />
        : tab === "weekly" ? <WeeklyTab key={day} {...viewProps} />
        : tab === "history" ? <HistoryTab key={day} {...viewProps} />
        : tab === "verify" ? <VerifyTab key={day} {...viewProps} focusPlan={Boolean(location.state?.focusVerifyPlan)} />
        : tab === "samples" ? <SamplesTab key={day} {...viewProps} />
        : <StructureTab key={day} {...viewProps} />}

      <Disclaimer />
    </div>
  );
}
