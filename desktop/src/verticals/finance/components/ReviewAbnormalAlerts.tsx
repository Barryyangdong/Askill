import { useEffect, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { ContextHelp } from "@/components/ui/ContextHelp";
import { GlassCard } from "@/components/ui/GlassCard";
import { backend } from "@/lib/backend";
import { beijingDay } from "@/lib/homeTasks";
import { cn } from "@/lib/utils";
import { createReviewCache } from "../shortline/reviewCache";
import { ReviewBadge } from "./ReviewBadge";

type Kind = "near" | "disclosures" | "monitor";
type AlertRow = {
  code: string; name: string; market: "SH" | "SZ" | "BJ"; pct?: number | null; topic?: string;
  deviation?: number; threshold?: number; ratio?: number; rule?: string;
  start?: string; end?: string; title?: string; url?: string;
};
type Result = { date: string; blocks: Record<Kind, AlertRow[] | null>; gaps: Partial<Record<Kind, string>> };

const cache = createReviewCache<Result>(16, {
  namespace: "review-abnormal", limit: 8, project: value => value,
  valid: value => !!value?.date && !!value.blocks && Object.values(value.blocks).some(Array.isArray),
});
const titles: Record<Kind, string> = { near: "次日预警", disclosures: "当日严重异动公告", monitor: "严重异动监控中" };
const empty: Record<Kind, string> = {
  near: "接近度名单中暂无符合条件的股票。",
  disclosures: "按当日公告披露日期检索，未见符合条件的记录。",
  monitor: "东财名单中暂无当日生效的股票监控记录。",
};
const pct = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

function AlertList({ kind, rows, loading, problem, filtered }: {
  kind: Kind; rows: AlertRow[] | null | undefined; loading: boolean; problem?: string; filtered: boolean;
}) {
  return <section className="border-t border-border/60 pt-3">
    <h4 className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
      {titles[kind]}
      {rows && <span className="font-normal tabular-nums text-muted-foreground">{rows.length} 只</span>}
      {kind === "near" && <ReviewBadge>接近度观察</ReviewBadge>}
    </h4>
    {!rows?.length ? <p role="status" className="text-xs leading-5 text-muted-foreground">
      {rows ? filtered ? "当前筛选下无记录。" : empty[kind] : problem || (loading ? "正在核对数据…" : "数据暂不可用。")}
    </p> : <ul className="divide-y divide-border/45">
      {rows.map(row => <li key={row.code} className="py-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <strong>{row.name}</strong><span className="font-mono text-muted-foreground">{row.code}</span>
          {row.market === "BJ" && <ReviewBadge>北交所</ReviewBadge>}
          {row.pct != null && <span className={cn("tabular-nums", row.pct > 0 && "text-danger", row.pct < 0 && "text-success")}>{pct(row.pct)}</span>}
          {row.topic && <ReviewBadge tone="blue">{row.topic}</ReviewBadge>}
        </div>
        {kind === "near" && row.deviation != null && row.threshold != null && <p className="mt-1 text-muted-foreground">
          <span className="text-warning">累计偏离 {pct(row.deviation)}</span> · 阈值 {pct(row.threshold)}
          {row.rule && <span className="ml-1" title={row.rule}>（{row.rule.includes("三十") || row.rule.includes("30") ? "30 日" : "10 日"}）</span>}
        </p>}
        {kind === "disclosures" && row.title && <p className="mt-1">
          {row.url && /^https:\/\/(?:www|static)\.cninfo\.com\.cn\//.test(row.url)
            ? <a href={row.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{row.title}</a> : row.title}
        </p>}
        {kind === "monitor" && <p className="mt-1 tabular-nums text-muted-foreground">监控期 {row.start} — {row.end}</p>}
      </li>)}
    </ul>}
  </section>;
}

export function ReviewAbnormalAlerts({ day, revision }: { day: string; revision: number }) {
  const [data, setData] = useState(() => cache.peek(day));
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState("");
  const [beijing, setBeijing] = useState(false);
  const priorRevision = useRef(revision);
  useEffect(() => {
    let active = true;
    const refresh = priorRevision.current !== revision;
    priorRevision.current = revision;
    setLoading(true);
    setError("");
    void cache.read(day, refresh, async () => {
      const { envelope } = await backend.fetch("cn_review_abnormal", {
        args: { day }, refresh: refresh || day === beijingDay(),
      });
      const result = envelope.extra as Result | undefined;
      if (!result || result.date !== day || !result.blocks || !result.gaps) throw new Error("暂无该复盘日可用的异动数据。");
      return result;
    }, result => day === beijingDay() || Object.keys(result.gaps).length ? 300_000 : 86_400_000)
      .then(result => { if (active) setData(result); })
      .catch(() => { if (active) setError("暂未取得该复盘日的异动数据。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [day, revision]);
  return <GlassCard className="min-w-0">
    <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><TriangleAlert className="h-4 w-4 text-warning" />严重异动预警</h3>
      <ReviewBadge>{day}</ReviewBadge>
      <ContextHelp>次日预警按东财收盘候选的累计偏离计算，显示已达到对应阈值 70% 至未达阈值的个股，供下一交易日观察。公告按巨潮资讯披露日期检索。监控区间取东财保留的名单。涨跌幅仅采用该日可核对的行情。</ContextHelp>
      <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" checked={beijing} onChange={event => setBeijing(event.target.checked)} />显示北交所
      </label>
    </div>
    <div className="space-y-3">
      {(Object.keys(titles) as Kind[]).map(kind => {
        const rows = data?.blocks[kind];
        const visible = rows?.filter(row => beijing || row.market !== "BJ");
        return <AlertList key={kind} kind={kind} rows={rows ? visible : rows} loading={loading}
          problem={data?.gaps[kind] ?? error} filtered={!!rows?.length && !visible?.length} />;
      })}
    </div>
  </GlassCard>;
}
