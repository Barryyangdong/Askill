import { useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { ContextHelp } from "@/components/ui/ContextHelp";
import { GlassCard } from "@/components/ui/GlassCard";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { SortTh } from "@/components/ui/SortTh";
import { backend } from "@/lib/backend";
import { nextSort, sortRows, type SortState, type SortValue } from "@/lib/tableSort";
import { cn } from "@/lib/utils";
import { createReviewCache } from "../shortline/reviewCache";
import { ReviewBadge } from "./ReviewBadge";

type Stage = "all" | "first" | "chain";
type PoolRow = {
  code: string; name: string; board: string; sector: string; topic: string;
  stage: Exclude<Stage, "all"> | null; close: number | null; pct: number | null;
  total_cap: number | null; turnover: number | null; year_seal_rate: number | null;
  breaks: number; first_seal: string;
};
type Pool = { date: string; rows: PoolRow[]; gaps: string[] };

const cache = createReviewCache<Pool>(16, {
  namespace: "review-broken-pool", limit: 8, archive: true, project: value => value,
  valid: value => !!value?.date && Array.isArray(value.rows) && Array.isArray(value.gaps),
});
const stages: { key: Stage; label: string }[] = [
  { key: "all", label: "全部" }, { key: "first", label: "首板" }, { key: "chain", label: "连板" },
];
const limits = [20, 50, 100].map(limit => ({ key: String(limit), label: String(limit) }));
const boardLabels: Record<string, string> = { "10cm": "主板", "20cm": "创业板 / 科创板", "20cm(ST)": "创业板 / 科创板 ST" };
const category = (row: PoolRow) => row.topic || row.sector;
const columns = [
  { key: "pct", label: "涨跌幅", format: (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%` },
  { key: "close", label: "收盘价", format: (n: number) => n.toFixed(2) },
  { key: "total_cap", label: "总市值", format: (n: number) => `${(n / 1e8).toFixed(2)} 亿` },
  { key: "turnover", label: "换手率", format: (n: number) => `${n.toFixed(2)}%` },
  { key: "year_seal_rate", label: "近一年封板率", format: (n: number) => `${(n * 100).toFixed(2)}%` },
] as const;
const selectClass = "max-w-44 rounded-md border border-border/70 bg-background px-2 py-1 text-xs text-muted-foreground";

export function ReviewBrokenPool({ day, revision }: { day: string; revision: number }) {
  const [data, setData] = useState(() => cache.peek(day));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!data);
  const [stage, setStage] = useState<Stage>("all");
  const [limit, setLimit] = useState("20");
  const [board, setBoard] = useState("");
  const [topic, setTopic] = useState("");
  const [sort, setSort] = useState<SortState | null>({ key: "pct", dir: "desc" });
  const prior = useRef(revision);
  useEffect(() => {
    let active = true;
    const refresh = prior.current !== revision;
    prior.current = revision;
    setLoading(true);
    setError("");
    void cache.read(day, refresh, async () => {
      const { envelope } = await backend.fetch("cn_review_broken_pool", { args: { day }, refresh });
      const result = envelope.extra as Pool | undefined;
      if (result?.date !== day || !Array.isArray(result.rows) || !Array.isArray(result.gaps))
        throw new Error("暂无该复盘日的收盘炸板池。");
      return result;
    }, result => result.gaps.length ? 5 * 60_000 : 24 * 3_600_000)
      .then(result => { if (active) setData(result); })
      .catch(() => { if (active) setError("暂未取得该复盘日的收盘炸板池。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [day, revision]);

  const pool = data?.date === day ? data : undefined;
  const rows = pool?.rows ?? [];
  const boards = [...new Set(rows.map(row => row.board).filter(Boolean))];
  const topics = [...new Set(rows.map(category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const filtered = rows.filter(row => (stage === "all" || row.stage === stage) &&
    (!boards.includes(board) || row.board === board) && (!topics.includes(topic) || category(row) === topic));
  const ordered = sortRows(filtered, sort, (row, key): SortValue =>
    columns.some(col => col.key === key) ? row[key as typeof columns[number]["key"]] : undefined);
  return <GlassCard className="min-w-0">
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><CircleAlert className="h-4 w-4 text-warning" />炸板池</h3>
      <ReviewBadge>{day}</ReviewBadge>
      {pool && <ReviewBadge tone="gold">{rows.length} 只</ReviewBadge>}
      <ContextHelp>名单、涨跌幅、收盘价和换手率取东财收盘炸板池。首板和连板按此前一交易日是否已收盘涨停划分。显示同花顺同日提供的近一年封板率，有题材时使用题材，其余显示东财行业。总市值取同一交易日收盘的腾讯总市值。</ContextHelp>
    </div>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <SegmentedToggle value={stage} options={stages} onChange={setStage} label="炸板板位" />
      <SegmentedToggle value={limit} options={limits} onChange={setLimit} label="显示条数" />
      <select aria-label="炸板市场" className={selectClass} value={boards.includes(board) ? board : ""} onChange={event => setBoard(event.target.value)}>
        <option value="">全部市场</option>{boards.map(key => <option key={key} value={key}>{boardLabels[key] ?? key}</option>)}
      </select>
      <select aria-label="炸板题材或行业" className={selectClass} value={topics.includes(topic) ? topic : ""} onChange={event => setTopic(event.target.value)}>
        <option value="">全部题材或行业</option>{topics.map(key => <option key={key} value={key}>{key}</option>)}
      </select>
      {pool && <span className="ml-auto text-xs text-muted-foreground">显示 {Math.min(filtered.length, Number(limit))} / {filtered.length} 只</span>}
    </div>
    {!ordered.length ? <p role="status" className="py-5 text-xs text-muted-foreground">{pool
      ? stage !== "all" && rows.some(row => row.stage === null) ? "前一交易日资料不足，暂时无法划分板位。"
        : rows.length ? "当前筛选下没有记录。" : "该交易日没有炸板记录。"
      : loading ? "正在读取收盘炸板池…" : error}</p> :
      <div className="overflow-x-auto">
        <table aria-label="收盘炸板明细" className="w-full min-w-[40rem] whitespace-nowrap text-left text-xs">
          <thead className="border-y border-border/60 bg-muted/25 text-muted-foreground">
            <tr>
              <th scope="col" className="p-2">序</th><th scope="col" className="p-2">题材 / 行业</th><th scope="col" className="p-2">股票</th>
              {columns.map(col => <SortTh key={col.key} label={col.label} k={col.key} sort={sort}
                onSort={(key, dir) => setSort(state => nextSort(state, key, dir))} right className="p-2" />)}
            </tr>
          </thead>
          <tbody>{ordered.slice(0, Number(limit)).map((row, index) => <tr key={row.code} className="border-b border-border/45 last:border-0 hover:bg-muted/20">
            <td className="p-2 tabular-nums text-muted-foreground">{index + 1}</td>
            <td className="p-2">{category(row) ? <span title={row.topic ? "同花顺题材" : "东方财富行业"}><ReviewBadge>{category(row)}</ReviewBadge></span> : "—"}</td>
            <td className="p-2" title={`首封 ${row.first_seal.replace(/^(\d\d)(\d\d)(\d\d)$/, "$1:$2:$3") || "—"} · 开板 ${row.breaks} 次`}>
              <strong>{row.name}</strong><span className="ml-1 font-mono text-muted-foreground">{row.code}</span>
            </td>
            {columns.map(col => {
              const value = row[col.key];
              return <td key={col.key} className={cn("p-2 text-right tabular-nums", col.key === "pct" && value !== null &&
                (value > 0 ? "text-danger" : value < 0 ? "text-success" : ""))}>{value === null ? "—" : col.format(value)}</td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>}
    {!!pool?.gaps.length && <p className="mt-2 text-[11px] text-muted-foreground">{pool.gaps.join(" ")}</p>}
  </GlassCard>;
}
