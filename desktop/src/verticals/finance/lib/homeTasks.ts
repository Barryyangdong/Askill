import type { LedgerRecord } from "./backend.ts";

export interface HomeTask { id: string; kind: string; label: string; title: string; symbol: string; date: string }
export function beijingDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
/** Only public-research records enter the task list; personal trading ledgers are never inspected. */
export function dueTasks(records: Record<string, LedgerRecord[]>, today: string): HomeTask[] {
  const specs = [
    { kind: "thesis", label: "观察复核", date: "review_by", title: "title", status: "active" },
    { kind: "criterion", label: "条件回看", date: "due", title: "statement", status: "pending" },
    { kind: "action", label: "待办", date: "due", title: "title", status: "open" },
  ];
  return specs.flatMap(spec => (records[spec.kind] ?? []).flatMap(r => {
    const date = r[spec.date];
    if ((r.status ?? spec.status) !== spec.status || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return [];
    return [{ id: r.id, kind: spec.kind, label: spec.label, title: String(r[spec.title] ?? ""), symbol: typeof r.symbol === "string" ? r.symbol : "", date }];
  })).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
