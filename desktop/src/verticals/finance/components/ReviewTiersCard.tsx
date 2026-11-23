import { useState } from "react";
import { Layers, RefreshCw } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { ContextHelp } from "@/components/ui/ContextHelp";
import { BoardBadge, ReviewBadge } from "@/components/ReviewBadge";
import { TIERS, ladderOf, prevText, topOf, type ReviewTiersResult, type TierId } from "@/lib/reviewTiers";
import { shortTime } from "@/lib/chatSources";
import { cn } from "@/lib/utils";

const BTN = "inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50";
const TIER_STYLE = {
  mainline: { tone: "gold", panel: "border-warning/25 border-l-warning/70 bg-warning/5" },
  today: { tone: "blue", panel: "border-primary/25 border-l-primary/60 bg-primary/5" },
  scattered: { tone: "neutral", panel: "border-border/60 bg-muted/15" },
  single: { tone: "neutral", panel: "border-border/60 bg-muted/15" },
} as const satisfies Record<TierId, { tone: "gold" | "blue" | "neutral"; panel: string }>;

const unknownBoards = (stocks: ReviewTiersResult["groups"][number]["stocks"]) => {
  return stocks.filter(s => s.boards === null || s.boards < 1).length;
};

/** 每日复盘:涨停分档。数据由页面取(提示词也要用),这里只负责显示 */
export function ReviewTiersCard({ data, loading, error, bizDay, onRefresh }: {
  data: ReviewTiersResult | null; loading: boolean; error: string; bizDay: string | null; onRefresh: () => void;
}) {
  const [showSingle, setShowSingle] = useState(true);
  const singles = data?.groups.filter((g) => g.tier === "single") ?? [];

  return <GlassCard className="mb-6">
    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="flex items-center gap-1.5 font-semibold"><Layers className="h-4 w-4 text-primary" /> 涨停行业分布</h3>
        <ContextHelp>按东财行业归类，对照前两个交易日的涨停数。「最高板」取连板数最多、同板数中首封最早的一只。「梯队」展示各板数的股票只数。档位按固定规则划分，也不是推荐。</ContextHelp>
      </div>
      <button type="button" onClick={onRefresh} disabled={loading || !bizDay} className={BTN} title="重新读取所选复盘日的涨停池">
        <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> 重新取
      </button>
    </div>

    {!bizDay && <p className="py-3 text-sm text-muted-foreground">{loading ? "等业务日…" : "业务日没拿到,分档没算(见页面上方的缺口)。"}</p>}
    {error && <p role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">{error}</p>}
    {loading && !data && bizDay && <p role="status" className="py-3 text-sm text-muted-foreground">正在取 {bizDay} 和前两个交易日的涨停池…</p>}

    {data && <>
      <div className="mb-3 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <ReviewBadge tone="blue">涨停 <strong className="tabular-nums">{data.total ?? "—"}</strong> 只</ReviewBadge>
        <span>{data.date} · 对比 {data.prev_dates.map((d) => d ?? "没找到").join("、")}
          {data.fetched_at && <> · 取于 {shortTime(data.fetched_at)}（北京时间{data.cached ? "，缓存" : ""}）</>}
        </span>
      </div>

      {data.groups.length > 0 && <div className="mb-3 flex flex-wrap gap-2">
        {data.tiers.map(t => <ReviewBadge key={t.id} title={t.rule} tone={t.industries ? TIER_STYLE[t.id].tone : "neutral"}>
          <strong>{t.label}</strong><span className="tabular-nums">{t.industries} 个行业 · {t.stocks} 只</span>
        </ReviewBadge>)}
      </div>}

      <div className="space-y-4">
        {TIERS.filter((t) => t.id !== "single").map((t) => {
          const groups = data.groups.filter((g) => g.tier === t.id);
          if (!groups.length) return null;
          return <section key={t.id}>
            <h4 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
              <ReviewBadge tone={TIER_STYLE[t.id].tone}>{t.label}</ReviewBadge>
              <span className="text-xs font-normal text-muted-foreground">{t.rule}</span>
            </h4>
            <ul className={cn("grid gap-2", groups.length > 1 && "lg:grid-cols-2")}>
              {groups.map(g => {
                const top = topOf(g);
                const unknown = unknownBoards(g.stocks);
                return <li key={g.industry} className={cn("min-w-0 rounded-lg border border-l-2 px-3 py-2.5", TIER_STYLE[t.id].panel)}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h5 className="text-sm font-semibold">{g.industry}</h5>
                    <ReviewBadge tone={TIER_STYLE[t.id].tone}><strong className="tabular-nums">{g.today}</strong> 只涨停</ReviewBadge>
                    <span className="text-xs tabular-nums text-muted-foreground">前两日 {prevText(g)}</span>
                  </div>
                  {top?.boards != null && <>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground">最高板</span>
                      <strong>{top.name || top.symbol}</strong>
                      <BoardBadge boards={top.boards} />
                      {top.first_seal && <span className="tabular-nums text-muted-foreground">{top.first_seal.slice(0, 5)} 首封</span>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs">
                      <span className="mr-0.5 text-muted-foreground">梯队</span>
                      {ladderOf(g).map(x => <BoardBadge key={x.boards} {...x} />)}
                      {unknown > 0 && <ReviewBadge>板数不明 · {unknown} 只</ReviewBadge>}
                    </div>
                  </>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-foreground/90">
                    {g.stocks.map(s => <span className="inline-flex items-baseline gap-1" key={s.symbol}>
                      {s.name || s.symbol}{s.boards != null && s.boards > 1 && <BoardBadge boards={s.boards} />}
                    </span>)}
                  </div>
                  {g.tags.length > 0 && <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="mr-0.5 text-xs text-muted-foreground">同花顺题材</span>
                    {g.tags.map(x => <ReviewBadge key={x.tag} tone="blue">{x.tag}<span className="tabular-nums opacity-80">×{x.count}</span></ReviewBadge>)}
                  </div>}
                  {g.note && <p className="mt-1.5 text-xs text-warning">{g.note}</p>}
                </li>;
              })}
            </ul>
          </section>;
        })}
        {singles.length > 0 && <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              <ReviewBadge>单只</ReviewBadge><span className="font-normal text-muted-foreground">{singles.length} 个行业各 1 只涨停</span>
            </h4>
            <button type="button" aria-expanded={showSingle} onClick={() => setShowSingle(v => !v)} className={BTN}>{showSingle ? "收起单只明细" : "展开单只明细"}</button>
          </div>
          {!showSingle && <p className="text-xs leading-5 text-muted-foreground">{singles.map(g => g.industry).join("、")}</p>}
          {showSingle && <ul className="grid gap-x-4 lg:grid-cols-2">
            {singles.map(g => <li key={g.industry} className="flex min-w-0 flex-wrap items-center gap-1.5 border-b border-border/40 py-2 text-xs">
              <ReviewBadge>{g.industry}</ReviewBadge>
              {g.stocks.map(s => <span className="flex flex-wrap items-center gap-1" key={s.symbol}>
                <strong className="mr-0.5">{s.name || s.symbol}</strong>
                {s.boards != null && s.boards > 1 && <BoardBadge boards={s.boards} />}
                {s.tags.map(tag => <ReviewBadge key={tag} tone="blue">{tag}</ReviewBadge>)}
              </span>)}
            </li>)}
          </ul>}
        </section>}
      </div>

      {data.gaps.length > 0 && <div className="mt-4">
        <h4 className="mb-1 text-xs font-semibold">没取到的</h4>
        <ul className="space-y-1 text-xs text-muted-foreground">{data.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
      </div>}
      <p className="mt-3 text-[11px] text-muted-foreground/80">来源:{data.source}。行业用东财涨停池自带的行业名(东财截成最长 4 个字,原样显示);题材标签是同花顺的市场叙事,不是核验过的因果。</p>
    </>}
  </GlassCard>;
}
