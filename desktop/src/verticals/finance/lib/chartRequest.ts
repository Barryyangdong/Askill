export type Period = "day" | "week" | "month" | "m5" | "m15" | "m60";
export type Adjust = "qfq" | "hfq" | "none";
export const looksLikeAShare = (s: string) => /^(\d{6}(\.(SH|SZ|BJ))?|(SH|SZ|BJ)\.\d{6})$/i.test(s.trim());
export function chartRequest(symbol: string, selected: Period, adjust: Adjust) {
  const aShare = looksLikeAShare(symbol);
  const period: Period = !aShare && ["m5", "m15", "m60"].includes(selected) ? "day" : selected;
  return { period, key: `${symbol}:${period}:${aShare ? adjust : "none"}`, body: aShare ? { symbol, period, adjust, charts: true } : { symbol, period, charts: true } };
}
export class ChartCache<T> {
  private entries = new Map<string, {at: number; day: string; value: T}>();
  private revisions = new Map<string, object>();
  token(key: string): object {
    let token = this.revisions.get(key);
    if (!token) { token = {}; this.revisions.set(key, token); }
    if (this.revisions.size > 24) this.revisions.delete(this.revisions.keys().next().value!);
    return token;
  }
  private day(now: number) {
    return ["Asia/Shanghai", "Asia/Hong_Kong", "America/New_York"].map((timeZone) =>
      new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now))).join("|");
  }
  get(key: string, force: boolean, now: number): T | undefined {
    if (force) { this.entries.delete(key); this.revisions.delete(key); this.token(key); }
    const entry = this.entries.get(key);
    return entry && now >= entry.at && now - entry.at < 30_000 && entry.day === this.day(now) ? entry.value : undefined;
  }
  set(key: string, value: T, now: number) {
    this.entries.delete(key); this.entries.set(key, {at: now, day: this.day(now), value});
    if (this.entries.size > 24) this.entries.delete(this.entries.keys().next().value!);
  }
  setIfCurrent(key: string, token: object, value: T, now: number) {
    if (this.revisions.get(key) === token) this.set(key, value, now);
  }
}

export function intelEntry(symbol: string, group: number, firstSymbol: string, groupSymbol: string) {
  const params = new URLSearchParams({symbol, group: String(group), firstSymbol, groupSymbol});
  return `/intel/filings?${params}`;
}

export function currentChart<T>(key: string, result: {key:string; res:T} | null): T | null {
  return result?.key === key ? result.res : null;
}
export const sameQuoteList = (current: readonly string[], requested: string) => current.join(",") === requested;
