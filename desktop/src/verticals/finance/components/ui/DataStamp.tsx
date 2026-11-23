/** Data time and fetch time are distinct. Never infer that a fetched quote is live. */
export function DataStamp({ dataAt, fetchedAt, source, mode, stale = false, cached = false, missing }: {
  dataAt?: string | null; fetchedAt?: string | null; source?: string;
  mode: "history" | "snapshot" | "quote"; stale?: boolean; cached?: boolean; missing?: string;
}) {
  return <div aria-label="数据时效" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
    <span className="rounded border border-border px-1.5 py-0.5">{mode === "history" ? "历史行情" : mode === "snapshot" ? "存档快照" : "行情快照"}</span>
    <span>数据 {dataAt || "时间未提供"}</span>
    {fetchedAt && <span>取数 {fetchedAt}</span>}
    {source && <span title={source}>来源 {source}</span>}
    {cached && <span>缓存结果</span>}
    {!dataAt && <span className="text-warning">源时间未确认</span>}
    {missing && <span className="text-warning">{missing}</span>}
    {stale && <strong className="font-medium text-warning">刷新失败 · 保留上次数据</strong>}
  </div>;
}
