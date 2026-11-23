import type { ReactNode } from "react";
import { useAiPage } from "../../../core/ai/pageContext";
import type { Panel } from "./api";
import { BoardLadderPanel } from "./BoardLadderPanel";
import { ConsecPremiumCard, CycleCard, LadderCard, MoneyEffectCard, PromotionCard } from "./EmotionCards";
import { BoardSystemSection, Ledger, LossEffectSection, Matrix, SealQualitySection, ThemeTreeView, Themes } from "./FactsPanels";
import { FirstBoardPanel } from "./FirstBoardPanel";
import { rate, signed } from "./format";
import { todaySummary } from "./summary";
import type { BoardLadderResult, ConsecPremium, CycleResult, EmotionResult, FactsResult, FirstBoardResult, LadderGap, MoneyEffect, Promotion, ThemesResult } from "./types";

export interface TodayPanels {
  emotion: Panel<EmotionResult>;
  facts: Panel<FactsResult>;
  themes: Panel<ThemesResult>;
  firstboard: Panel<FirstBoardResult>;
  cycle: Panel<CycleResult>;
  ladder: Panel<BoardLadderResult>;
}

/** 一块还在取 / 没取到时占的位;取到了才把内容画出来 */
export function Slot<T>({ p, title, children, minH = "min-h-[8rem]" }: { p: Panel<T>; title: string; children: (r: T) => ReactNode; minH?: string }) {
  if (p.state === "loading") {
    return <div className={`glass flex items-center justify-center p-4 ${minH}`}><p role="status" className="text-sm text-muted-foreground">{title}加载中…</p></div>;
  }
  if (!p.result) {
    return (
      <div className={`glass p-4 ${minH}`}>
        <h3 className="mb-1 text-sm font-semibold">{title}</h3>
        <p role="status" className="text-sm text-muted-foreground">这次没取到:{p.why || "原因不明"}。不代表没有,可点右上角刷新重试。</p>
      </div>
    );
  }
  return <>{children(p.result)}</>;
}

const OFF = { available: false } as const;

export type TodaySection = "emotion" | "cycle" | "relay" | "seal" | "themes" | "timing" | "risk";

export function TodayTab({ day, panels, showDate = true, onOpenThemes, section }: {
  day: string | null;
  panels: TodayPanels;
  showDate?: boolean;
  onOpenThemes?: (tag?: string) => void;
  section?: TodaySection;
}) {
  const { emotion, facts, themes, firstboard, cycle, ladder } = panels;
  const e = emotion.state === "done" ? emotion.result : null;

  const first = firstboard.state === "done" ? firstboard.result : null;
  const board = ladder.state === "done" ? ladder.result : null;
  const firstInLadder = first?.available && board?.date === first.date && board.ladder.available
    && board.ladder.levels?.some(level => level.boards === 1);
  const show = (part: TodaySection) => !section || section === part;
  const registerContext = show("emotion");
  useAiPage(registerContext && day ? {
    key: `shortline:today:${day}`,
    title: `情绪复盘 ${day}`,
    context: todaySummary(day, panels),
    suggestions: [
      "这一天短线情绪在什么温度?依据是哪几项读数",
      "亏钱效应集中在哪个板位?和封板质量对得上吗",
      "哪些题材在延续、哪些接力断档?证据够不够",
      "梯队断层说明了什么,还缺什么证据才能下判断",
    ],
  } : null, registerContext);

  return (
    <div className="review-workbench space-y-4">
      {show("emotion") && e && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
          <span>{(showDate || day !== e.date) && <>复盘日 <b className="text-foreground">{e.date}</b>{e.prev_date && "，"}</>}{e.prev_date && <>对比前一交易日 {e.prev_date}</>}</span>
          {e.promotion?.limit_up_count != null && (
            <span>涨停 <b className="text-danger">{e.promotion.limit_up_count}</b> 家(前一交易日 {e.promotion.prev_limit_up_count ?? "—"} 家)</span>
          )}
        </div>
      )}
      {show("emotion") && e?.settled === false && (
        <p role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          未结算 · 读数仍会变化 · 暂不保存快照
        </p>
      )}

      {show("cycle") && <Slot p={cycle} title="涨停池周期位置">
        {c => <CycleCard cy={c.cycle ?? OFF} />}
      </Slot>}

      {show("emotion") && <>
        <Slot p={emotion} title="昨日强势股今日表现">
          {r => <>
            {!section && <div className="grid grid-cols-2 gap-3 rounded border border-border p-3 text-xs sm:hidden" aria-label="同日情绪摘要">
              <span>同日涨停 <b>{r.promotion?.limit_up_count ?? "—"} 家</b></span>
              <span>整体晋级率 <b>{r.promotion?.available ? rate(r.promotion.overall?.rate) : "—"}</b></span>
              <span>昨日涨停反馈中位数 <b>{r.money_effect?.available ? signed(r.money_effect.median) : "—"}</b></span>
              <span>最高板 <b>{r.ladder_gap?.available && r.ladder_gap.highest != null ? `${r.ladder_gap.highest} 板` : "—"}</b></span>
            </div>}
            <div className="grid gap-3 md:grid-cols-2">
              <MoneyEffectCard me={r.money_effect ?? (OFF as MoneyEffect)} />
              <ConsecPremiumCard cp={r.consec_premium ?? (OFF as ConsecPremium)} />
            </div>
          </>}
        </Slot>
        <Slot p={facts} title="昨日强势股分板位反馈">{f => <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Matrix fm={f.feedback} />
          <LossEffectSection le={f.loss_effect} />
        </div>}</Slot>
      </>}

      {show("relay") && <div id="review-ladder" className="scroll-mt-24 space-y-3">
        {(!board?.ladder.available || !board.ladder.prev_available || !e) && <Slot p={emotion} title="晋级率与梯队结构">
          {r => <div className="grid gap-3 md:grid-cols-2">
            <PromotionCard pr={r.promotion ?? (OFF as Promotion)} />
            <LadderCard lg={r.ladder_gap ?? (OFF as LadderGap)} />
          </div>}
        </Slot>}
        <Slot p={ladder} title="连板天梯">{l =>
          <BoardLadderPanel r={l} emotion={l.ladder.available && l.ladder.prev_available ? e : null} firstBoard={firstInLadder && first ? first : undefined} />
        }</Slot>
        {!firstInLadder &&
          <Slot p={firstboard} title="首板明细">{fb => <FirstBoardPanel fb={fb} />}</Slot>}
      </div>}

      {show("seal") && <Slot p={facts} title="封板质量与涨跌幅制度">{f => <>
        <SealQualitySection sq={f.seal_quality} />
        <BoardSystemSection bb={f.by_board} />
      </>}</Slot>}

      {show("themes") && <Slot p={themes} title={onOpenThemes ? "当日题材" : "题材事件树"}>
        {t => <ThemeTreeView t={t.tree} onOpenThemes={onOpenThemes} />}
      </Slot>}
      {show("timing") && <Slot p={facts} title="首封时段分布">{f => <Themes ts={f.themes} />}</Slot>}
      {show("risk") && <Slot p={facts} title="关键盘面事件">{f => <Ledger el={f.events} />}</Slot>}
    </div>
  );
}
