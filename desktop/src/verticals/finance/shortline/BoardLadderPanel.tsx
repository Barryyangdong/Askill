/**
 * 连板天梯:这一天每个连板高度有谁、昨天下面一层的几只接上了、没接上的今天怎么样了。
 * 板数和晋级的口径与情绪四项同一套,
 * 所以「4进5 1/3」和晋级率卡片里的数对得上。
 */
import { useState } from "react";
import { AlertCircle, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReviewBadge } from "@/components/ReviewBadge";
import { FirstBoardPanel } from "./FirstBoardPanel";
import { Caliber } from "./Caliber";
import { DOWN_TEXT, finite, hhmm, pctColor, rate, safeArray, signed, yi } from "./format";
import type { EmotionResult, FirstBoardResult, BoardLadderResult, LadderFell, LadderLevel, LadderStock } from "./types";

const CALIBER =
  "板数 = 东财涨停池的连板数;断板后又涨停(反包)从 1 重新数,名字旁标「N天M板」。\n" +
  "「4进5 1/3」= 昨天 4 板的 3 只里,今天还在涨停池的有 1 只;和晋级率卡片是同一个算法。\n" +
  "没接上的按今天的去向写:跌停 / 炸板(盘中封过又打开)/ 没涨停;涨跌幅优先用收盘后东财「昨日涨停池」里的当日表现。\n" +
  "同一层按首次封板时间从早到晚排;「炸N」= 当天开板 N 次。首板名单在天梯内，成交与封单详见首板明细。\n" +
  "主要题材按每只涨停股的首个题材标签计数。标签来自同花顺涨停揭秘的编辑归因;北交所的涨停股同花顺不收录。";

const FELL_SHOWN = 6;
const TILE_GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,7.25rem),1fr))] gap-1.5";

const OUTCOME_TEXT: Record<LadderFell["outcome"], string> = {
  跌停: cn(DOWN_TEXT, "font-semibold"),
  炸板: "text-warning",
  没涨停: "text-muted-foreground",
  没取到: "text-muted-foreground/70",
};

function stockTitle(s: LadderStock): string {
  const tags = safeArray<string>(s.tags).filter(Boolean);
  return [
    `${s.name} ${s.code} · ${s.label}${s.board && s.board !== "10cm" ? ` · ${s.board}` : ""}`,
    `首封 ${hhmm(s.first_seal)} · 最后封板 ${hhmm(s.last_seal)} · 炸板 ${s.broken_times} 次`,
    `封单 ${yi(s.seal_fund)} · 成交额 ${yi(s.amount)} · 流通市值 ${yi(s.float_cap)}`,
    ...(tags.length ? [`题材 ${tags.join(" · ")}`] : []),
    `涨停原因:${s.reason || (s.board === "北交所" ? "同花顺不收录北交所" : "没取到")}`,
  ].join("\n");
}

function StockChip({ s }: { s: LadderStock }) {
  const theme = safeArray<string>(s.tags).find(Boolean);
  return (
    <li title={stockTitle(s)} className="min-w-0 rounded-md border border-border/70 bg-muted/15 px-2.5 py-1.5">
      <div className="flex flex-wrap items-baseline gap-x-1.5 text-[10px]">
        <span className="font-mono tabular-nums text-primary">{hhmm(s.first_seal)}</span>
        {s.board && s.board !== "10cm" && <span className="text-muted-foreground">{s.board}</span>}
        {s.broken_times > 0 && <span className="text-warning">炸{s.broken_times}</span>}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-1 text-xs">
        <strong className="break-words">{s.name}</strong>
        {s.rebound && <span className="rounded bg-warning/15 px-1 text-[10px] font-semibold text-warning">{s.label}</span>}
      </div>
      <p className="truncate text-[11px] text-muted-foreground">{theme ?? "—"}</p>
    </li>
  );
}

function FellChip({ f }: { f: LadderFell }) {
  return (
    <li title={`${f.name} ${f.code} · 昨天 ${f.prev_label} · 今天${f.outcome}`} className="min-w-0 rounded-md border border-dashed border-border/70 px-2.5 py-1.5">
      <p className={cn("font-mono text-[10px] tabular-nums", pctColor(f.ret))}>{signed(f.ret)}</p>
      <p className="break-words text-xs font-medium text-muted-foreground">{f.name}</p>
      <div className="flex flex-wrap items-baseline gap-x-1 text-[11px]">
        <span className={OUTCOME_TEXT[f.outcome]}>{f.outcome}</span>
        {f.prev_label !== `${f.prev_boards}板` && <span className="text-muted-foreground">{f.prev_label}</span>}
      </div>
    </li>
  );
}

/** 「1进2 8/33 · 24%」;昨天的池子没取到时说清楚,不写 0 */
function promotionText(lv: LadderLevel, prevAvailable: boolean): string | null {
  if (lv.boards <= 1) return null;
  const base = finite(lv.base);
  if (base == null) return prevAvailable ? null : "昨天的池子没取到,晋级算不了";
  return `${lv.boards - 1}进${lv.boards} ${lv.promoted ?? "—"}/${base} · ${rate(lv.rate)}`;
}

function fellSummary(fell: LadderFell[]): string {
  const n = (o: LadderFell["outcome"]) => fell.filter((f) => f.outcome === o).length;
  const parts = (["跌停", "炸板", "没涨停", "没取到"] as const).map((o) => [o, n(o)] as const).filter(([, c]) => c > 0).map(([o, c]) => `${o} ${c}`);
  return `没接上 ${fell.length} 只(${parts.join(" · ")})`;
}

function LevelRow({ lv, prevAvailable, firstBoard }: { lv: LadderLevel; prevAvailable: boolean; firstBoard?: FirstBoardResult }) {
  const [open, setOpen] = useState(true);
  const stocks = safeArray<LadderStock>(lv.stocks);
  const fell = safeArray<LadderFell>(lv.fell);
  const promo = promotionText(lv, prevAvailable);
  const firstCodes = new Set(firstBoard?.stocks?.map(stock => stock.code));
  const remaining = firstBoard ? stocks.filter(stock => !firstCodes.has(stock.code)) : stocks;
  const shownFell = open ? fell : fell.slice(0, FELL_SHOWN);
  return (
    <div className="grid gap-x-3 gap-y-2 border-t border-border/50 py-2.5 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:block">
        <h4 className="text-sm font-bold">{lv.boards === 1 ? "首板" : `${lv.boards}板`}</h4>
        <div className="sm:my-1"><ReviewBadge tone={stocks.length ? "blue" : "neutral"}>{stocks.length} 只</ReviewBadge></div>
        {promo && <p className="text-[11px] tabular-nums text-muted-foreground">{promo}</p>}
      </div>
      <div className="min-w-0 space-y-2">
        {firstBoard && <FirstBoardPanel fb={firstBoard} embedded stockNotes={new Map(stocks.map(s => [s.code, stockTitle(s)]))} />}
        {!firstBoard && stocks.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">这一层今天没有涨停的。</p>
        ) : remaining.length > 0 && (
          <ul className={TILE_GRID}>{remaining.map((s) => <StockChip key={s.code} s={s} />)}</ul>
        )}
        {fell.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2">
              <span className="text-[11px] text-muted-foreground">{fellSummary(fell)}</span>
              {fell.length > FELL_SHOWN && (
                <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
                  className="text-[11px] text-primary underline-offset-2 hover:underline">
                  {open ? "收起" : `展开其余 ${fell.length - FELL_SHOWN} 只`}
                </button>
              )}
            </div>
            <ul className={TILE_GRID}>{shownFell.map((f) => <FellChip key={f.code} f={f} />)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function BoardLadderPanel({ r, firstBoard, emotion }: { r: BoardLadderResult; firstBoard?: FirstBoardResult; emotion?: EmotionResult | null }) {
  const lad = r.ladder ?? { available: false };
  const levels = safeArray<LadderLevel>(lad.levels);
  const promotion = emotion?.promotion;
  const gaps = emotion?.ladder_gap;
  const upper = promotion?.tiers?.["3板以上晋级"];
  const prevOk = lad.prev_available !== false;
  const themes = new Map<string, number>();
  for (const level of levels) {
    for (const stock of safeArray<LadderStock>(level.stocks)) {
      const tag = safeArray<string>(stock.tags).find(Boolean);
      if (tag) themes.set(tag, (themes.get(tag) ?? 0) + 1);
    }
  }
  const rankedThemes = [...themes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));
  return (
    <div className="glass p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Layers className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">连板天梯</h3>
        <Caliber text={CALIBER} />
        {lad.available && (
          <>
            <ReviewBadge tone="blue">涨停 {lad.total_limit_up ?? "—"} 家</ReviewBadge>
            <ReviewBadge>连板 {lad.consec_count ?? "—"} 只</ReviewBadge>
            {lad.highest != null && <ReviewBadge tone="gold">最高 {lad.highest} 板</ReviewBadge>}
            {r.prev_date && <span className="text-[11px] text-muted-foreground">晋级对比 {r.prev_date}</span>}
          </>
        )}
      </div>
      {emotion && <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span>整体晋级率 <b className="tabular-nums">{promotion?.available ? rate(promotion.overall?.rate) : "—"}</b></span>
        {upper && <span className="text-muted-foreground">昨日三板及以上晋级 {upper.promoted}/{upper.base} · {rate(upper.rate)}</span>}
        {gaps?.available && gaps.gaps?.map(board => <ReviewBadge key={board} tone="gold">{board}板 缺</ReviewBadge>)}
        {gaps?.continuous && <ReviewBadge>梯队连续</ReviewBadge>}
        {!gaps?.available && <span className="text-muted-foreground">梯队结构未核验{gaps?.reason && ` · ${gaps.reason}`}</span>}
        {!promotion?.available && promotion?.reason && <span className="text-muted-foreground">{promotion.reason}</span>}
      </div>}
      {!lad.available ? (
        <p className="py-4 text-center text-sm text-muted-foreground">连板天梯没取到:{lad.reason || "原因不明"}</p>
      ) : (
        <>
          {!prevOk && (
            <p role="status" className="mb-1 flex items-start gap-1.5 text-[11px] text-warning">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> {lad.prev_note || "前一交易日的涨停池没取到"}:只列今天各层的名单,晋级和没接上的算不了。
            </p>
          )}
          {lad.reason_note && (
            <p className="mb-1 flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> 涨停原因:{lad.reason_note}
              {safeArray<string>(lad.reason_missing).length > 0 && `;${safeArray<string>(lad.reason_missing).length} 只沪深涨停股没有原因`}
            </p>
          )}
          {rankedThemes.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5" aria-label="涨停股题材分布">
              <span className="mr-1 text-[11px] text-muted-foreground">主要题材</span>
              {rankedThemes.map(([tag, count]) => <ReviewBadge key={tag} tone={count > 1 ? "blue" : "neutral"}>
                {tag}<strong className="tabular-nums">{count}</strong>
              </ReviewBadge>)}
            </div>
          )}
          {levels.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">这一天没有涨停股</p>
          ) : (
            <div>{levels.map((lv) => <LevelRow key={lv.boards} lv={lv} prevAvailable={prevOk} firstBoard={lv.boards === 1 ? firstBoard : undefined} />)}</div>
          )}
        </>
      )}
    </div>
  );
}

/** 写给 AI 的一段:每层的名单、晋级和没接上的去向;昨天没取到 / 原因没取到都明说 */
export function ladderSummary(r: BoardLadderResult): string {
  const lad = r.ladder;
  if (!lad?.available) return `连板天梯:没取到(${lad?.reason ?? "原因不明"})`;
  const prevOk = lad.prev_available !== false;
  const rows = safeArray<LadderLevel>(lad.levels).map((lv) => {
    const stocks = safeArray<LadderStock>(lv.stocks);
    const promo = promotionText(lv, prevOk);
    if (lv.boards === 1) return `首板 ${stocks.length} 只${promo ? `(${promo})` : ""}`;
    const names = stocks.map((s) => `${s.name}${s.rebound ? `[${s.label}]` : ""}${s.tags?.length ? `(${s.tags.slice(0, 2).join("、")})` : ""}`).join("、") || "无";
    const fell = safeArray<LadderFell>(lv.fell);
    const fellText = fell.length ? `;${fellSummary(fell)}:${fell.slice(0, 5).map((f) => `${f.name}${f.outcome}${signed(f.ret)}`).join("、")}${fell.length > 5 ? " 等" : ""}` : "";
    return `${lv.boards}板 ${stocks.length} 只${promo ? `(${promo})` : ""}:${names}${fellText}`;
  });
  const head = `连板天梯(东财连板数分层,晋级口径同晋级率;题材是源站编辑归因非公司确认):涨停 ${lad.total_limit_up ?? "—"} 家、连板 ${lad.consec_count ?? "—"} 只、最高 ${lad.highest ?? "—"} 板`;
  const noReason = safeArray<string>(lad.reason_missing);
  const notes = [
    prevOk ? "" : `前一交易日涨停池没取到(${lad.prev_note || "原因不明"}),晋级和没接上的算不了`,
    lad.reason_available === false ? `涨停原因没取到(${lad.reason_note || "原因不明"})` : "",
    noReason.length ? `${noReason.length} 只沪深涨停股没有涨停原因(${noReason.slice(0, 5).join("、")}${noReason.length > 5 ? " 等" : ""}),它们没算进题材` : "",
  ].filter(Boolean);
  return [head, ...rows, ...notes].join("\n");
}
