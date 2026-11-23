import type { PageBlockResult } from "../service.ts";

type Evidence = { field?: string; period?: string; record_key?: string };
const periodRange = /^(\d{4}-\d{2}-\d{2})(?:\.\.(\d{4}-\d{2}-\d{2}))?$/;

/** A fetch timestamp establishes when a snapshot could be final, never which session its values describe. */
export function closedReviewBlock(block: PageBlockResult, context: Record<string, unknown> | null): PageBlockResult {
  if (block.status !== "ok" && block.status !== "partial") return block;
  const envelope = block.envelope;
  const day = context?.review_date;
  const missing = (error: string): PageBlockResult => ({
    id: block.id, title: block.title, note: block.note, status: "missing", error,
  });
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !envelope || context?.live || context?.session_phase === "unknown")
    return missing("无法确认复盘交易日。");
  const cutoff = Date.parse(day + "T15:00:00+08:00");
  if (!(Date.parse(String(envelope.fetched_at ?? block.fetched_at ?? "")) >= cutoff))
    return missing(`${day} 的收盘快照尚未取得。`);

  const rows: Evidence[] = Array.isArray(envelope.evidence) ? envelope.evidence : [];
  const extra = (envelope.extra ?? {}) as { source_close_date?: string; distribution_date?: string; exchange_close_dates?: Record<string,string>; total?: number };
  if ((block.id === "board_flow" || block.id === "turnover") && extra.source_close_date !== day)
    return missing(`来源没有可核验的 ${day} 收盘榜单。`);
  if (block.id === "board_flow" && block.via_fallback && (
    typeof extra.total !== "number" || rows.filter(row => row.field === "board_main_net_today" && row.period === day).length !== extra.total
  )) return missing(`${day} 的备用行业收盘榜不完整。`);

  // These sources publish on their own schedules. Preserve their dated observations.
  const publishedIndicator = ["margin", "valuation", "bond"].includes(block.id);
  const periodEnd = (row: Evidence) => {
    const match = periodRange.exec(String(row?.period ?? ""));
    return match ? match[2] ?? match[1] : undefined;
  };
  const amountDay = rows.filter(row => row?.field === "market_amount_total" &&
    row.record_key === `amount|${row.period}` && periodEnd(row) && row.period! <= day)
    .map(row => row.period!).sort().at(-1);
  const accepted = rows.filter(row => {
    const end = periodEnd(row);
    if (!end || end > day) return false;
    if (publishedIndicator) return true;
    if (block.id === "trend" && row.field === "market_amount_total") return row.record_key === `amount|${row.period}`;
    if (block.id === "trend" && /^market_amount_ma(?:20|60)$/.test(row.field ?? "")) return end === amountDay;
    if (end !== day) return false;
    if (block.id !== "breadth") return true;
    if (row.record_key?.startsWith("dist|")) return extra.distribution_date === day;
    const exchange = /^exchange\|(SH|SZ|BJ)$/.exec(row.record_key ?? "");
    return !!exchange && extra.exchange_close_dates?.[exchange[1]!] === day;
  });
  // A rolled calculation with a later/latest session cannot be reconstructed by deleting its newer rows.
  if (publishedIndicator && rows.some(row => (periodEnd(row) ?? "") > day))
    return missing(`该指标包含 ${day} 之后的观测，无法核验本次复盘值。`);
  const observationDay = publishedIndicator
    ? accepted.filter(row => row.field !== "series_points" && row.period === periodEnd(row))
      .map(row => row.period!).sort().at(-1)
    : accepted.some(row => periodEnd(row) === day) ? day : amountDay;
  if (!observationDay)
    return missing(`来源没有可核验的 ${day} 收盘数据。`);
  const reviewed = block.id === "breadth" ? { ...envelope, extra: {
    ...extra, date: day, ...(extra.distribution_date === day ? {} : { bucket_total: null }),
  } } : envelope;
  if (accepted.length === rows.length && observationDay === day)
    return { ...block, envelope: reviewed, business_date: day };

  const reason = observationDay < day
    ? `${day} 暂未取得，已核验数据截至 ${observationDay}。`
    : `部分记录的日期与 ${day} 收盘口径不符，仅展示已核验的数据。`;
  const gaps = Array.isArray(envelope.missing) ? envelope.missing : [];
  return { ...block, business_date: observationDay, status: "partial", error: reason, envelope: {
    ...reviewed, evidence: accepted, missing: [...gaps, { reason, period: day }], status: "partial",
  } };
}
