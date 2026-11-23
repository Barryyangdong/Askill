import { normalizeMarketSymbol } from "./marketSymbol.ts";
export interface WorkspaceContext { date?: string; symbol?: string }
const datePath = (path: string) => path === "/shortline" || path.startsWith("/shortline/") || path === "/watch/intraday";
const symbolPath = (path: string) => ["/research", "/debate", "/watch", "/workbench", "/observations"].includes(path);
export function readWorkspaceContext(raw: string | null): WorkspaceContext {
  try {
    const value = JSON.parse(raw ?? "{}");
    if (!value || typeof value !== "object") return {};
    const candidate = typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date) ? value.date : undefined;
    const parsed = candidate ? new Date(`${candidate}T00:00:00Z`) : null;
    const date = parsed && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate ? candidate : undefined;
    return { date, symbol: normalizeMarketSymbol(value.symbol) ?? undefined };
  } catch { return {}; }
}
export function rememberWorkspace(previous: WorkspaceContext, path: string, search: string): WorkspaceContext {
  const query = new URLSearchParams(search);
  if (datePath(path)) return { ...previous, date: readWorkspaceContext(JSON.stringify({ date: query.get("date") })).date };
  if (symbolPath(path) && query.has("symbol")) return { ...previous, symbol: normalizeMarketSymbol(query.get("symbol")) ?? undefined };
  return previous;
}
export function workspaceHref(target: string, context: WorkspaceContext): string {
  if (target.includes("?") || target.includes("#")) return target;
  if (datePath(target) && context.date) return `${target}?date=${encodeURIComponent(context.date)}`;
  if (symbolPath(target) && context.symbol) return `${target}?symbol=${encodeURIComponent(context.symbol)}`;
  return target;
}
