import { useEffect, useRef, useState } from "react";
import { readDailyTiers } from "../lib/dailyReviewData.ts";
import { normalizeMarketSymbol } from "../lib/marketSymbol.ts";
import type { ReviewTiersResult } from "../lib/reviewTiers.ts";

export interface ThemeHistoryMember { code: string; name: string; lastHit: string; hitDays: number; maxBoards: number | null }
export interface ThemeHistoryResult { members: ThemeHistoryMember[]; missingDays: string[]; availableDays: string[] }

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function historyDates(dates: readonly string[]): string[] {
  return [...new Set(dates.filter(validDate))].sort().reverse().slice(0, 10);
}

export function reduceThemeHistory(tag: string, dates: readonly string[], days: ReadonlyMap<string, ReviewTiersResult | null>): ThemeHistoryResult {
  const members = new Map<string, ThemeHistoryMember>();
  const missingDays: string[] = [], availableDays: string[] = [];
  for (const date of historyDates(dates)) {
    const day = days.get(date);
    if (!day || day.date !== date || day.total == null || (day.total > 0 && !day.groups.some(g => g.stocks.length))) {
      missingDays.push(date); continue;
    }
    availableDays.push(date);
    if (day.gaps.length) missingDays.push(date);
    const seen = new Set<string>();
    for (const stock of day.groups.flatMap(g => g.stocks)) {
      const code = normalizeMarketSymbol(stock.symbol);
      if (!code || !/^\d{6}$/.test(code) || !stock.tags.includes(tag)) continue;
      const existing = members.get(code);
      if (!existing) members.set(code, { code, name: stock.name || code, lastHit: date, hitDays: 1, maxBoards: stock.boards });
      else {
        if (!seen.has(code)) existing.hitDays++;
        if (stock.boards != null) existing.maxBoards = existing.maxBoards == null ? stock.boards : Math.max(existing.maxBoards, stock.boards);
      }
      seen.add(code);
    }
  }
  return { members: [...members.values()], missingDays, availableDays };
}

export function useThemeHistoryMembers(tag: string, dates: readonly string[], enabled: boolean, revision: number): ThemeHistoryResult & { loading: boolean } {
  const daysKey = historyDates(dates).join(",");
  const key = JSON.stringify([tag, daysKey, enabled, revision]);
  const [state, setState] = useState<{ key: string; result: ThemeHistoryResult }>();
  const lastRevision = useRef(revision);
  useEffect(() => {
    if (!enabled || !tag || !daysKey) return;
    let active = true;
    const force = lastRevision.current !== revision;
    lastRevision.current = revision;
    const requested = daysKey.split(",");
    const days = new Map<string, ReviewTiersResult | null>();
    let next = 0;
    async function worker() {
      while (active && next < requested.length) {
        const date = requested[next++]!;
        try { days.set(date, await readDailyTiers(date, force)); }
        catch { days.set(date, null); }
      }
    }
    void Promise.all(Array.from({ length: Math.min(4, requested.length) }, worker)).then(() => {
      if (active) setState({ key, result: reduceThemeHistory(tag, requested, days) });
    });
    return () => { active = false; };
  }, [tag, daysKey, enabled, revision, key]);
  const result = state?.key === key ? state.result : { members: [], missingDays: [], availableDays: [] };
  return { ...result, loading: enabled && !!tag && !!daysKey && state?.key !== key };
}
