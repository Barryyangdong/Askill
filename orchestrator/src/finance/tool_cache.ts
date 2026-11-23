/** UI chart results only: no persistent or shared-account data, no shared processes. */
import path from "node:path";
import type { Plugin } from "../plugin.ts";

type Request = Parameters<NonNullable<Plugin["wrapToolRequest"]>>[0];
type Entry = { at: number; value: unknown };
type Pending = { sequence: number; active: number; forced: number };
const entries = new Map<string, Entry>();
const pending = new Map<string, Pending>();
const TTL = 30_000, LIMIT = 24;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const day = (tz: string, now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

function keyOf(req: Request): string | null {
  if (req.name !== "kline" || !obj(req.input)) return null;
  const input = req.input;
  if (Object.keys(input).some((k) => !["symbol", "period", "adjust", "charts"].includes(k)) || input.charts !== true || typeof input.symbol !== "string") return null;
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol || symbol.length > 20 || !/^[A-Z0-9.^=-]+$/.test(symbol)) return null;
  const period = input.period ?? "day";
  if (typeof period !== "string" || !["day", "week", "month", "m5", "m15", "m60"].includes(period)) return null;
  const adjust = input.adjust ?? (period.startsWith("m") && period !== "month" ? "none" : "qfq");
  if (typeof adjust !== "string" || !["none", "qfq", "hfq"].includes(adjust)) return null;
  const now = new Date();
  return JSON.stringify([path.resolve(req.dataRoot), path.resolve(req.repoRoot), req.python, symbol, period, adjust, true,
    day("Asia/Shanghai", now), day("Asia/Hong_Kong", now), day("America/New_York", now)]);
}

function complete(value: unknown, input: unknown): boolean {
  if (!obj(value) || value.ok !== true || !obj(value.result)) return false;
  const r = value.result;
  if (!obj(input) || r.period !== (input.period ?? "day") || typeof r.symbol !== "string" || !r.symbol) return false;
  if (typeof r.fetched_at !== "string" || !Number.isFinite(Date.parse(r.fetched_at)) || !obj(r.ui_only) || !obj(r.ui_only.series)) return false;
  const s = r.ui_only.series;
  const datePattern = ["m5", "m15", "m60"].includes(String(r.period)) ? /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
  const dates = s.dates;
  if (!Array.isArray(dates) || !dates.length || r.bars !== dates.length || !dates.every((x, i) => typeof x === "string" && datePattern.test(x) && (i === 0 || x > dates[i - 1]))) return false;
  return ["open", "high", "low", "close", "volume", "change"].every((k) => Array.isArray(s[k]) && s[k].length === (s.dates as unknown[]).length && (s[k] as unknown[]).every((v) =>
    (k === "volume" || k === "change") && v === null || typeof v === "number" && Number.isFinite(v) && (k === "volume" || k === "change" || v > 0)));
}

export async function financeToolRequest(req: Request): Promise<unknown> {
  req.signal?.throwIfAborted();
  const key = keyOf(req);
  if (!key) return req.run();
  const now = Date.now();
  if (req.policy === "fresh") entries.delete(key);
  else {
    const hit = entries.get(key);
    if (hit && now >= hit.at && now - hit.at < TTL && !pending.get(key)?.forced) return { ...(structuredClone(hit.value) as Record<string, unknown>), cached: true };
    if (hit) entries.delete(key);
  }
  let state = pending.get(key);
  if (!state) { state = { sequence: 0, active: 0, forced: 0 }; pending.set(key, state); }
  const sequence = req.policy === "fresh" ? ++state.sequence : state.sequence;
  const blockedByForce = state.forced > 0;
  state.active++;
  if (req.policy === "fresh") state.forced++;
  try {
    const result = await req.run();
    req.signal?.throwIfAborted();
    if (sequence === state.sequence && (req.policy === "fresh" || !blockedByForce && !state.forced) && complete(result, req.input)) {
      entries.delete(key); entries.set(key, { at: Date.now(), value: structuredClone(result) });
      if (entries.size > LIMIT) entries.delete(entries.keys().next().value!);
    }
    return result;
  } finally {
    if (req.policy === "fresh") state.forced--;
    state.active--;
    if (!state.active && pending.get(key) === state) pending.delete(key);
  }
}
