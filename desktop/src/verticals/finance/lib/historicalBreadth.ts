import { backend } from "./backend.ts";
import { dataDay, parseBreadth, type Breadth } from "./marketReview.ts";
import { createReviewCache } from "../shortline/reviewCache.ts";

const cache = createReviewCache<Breadth>(32, {
  namespace: "historical-breadth", limit: 20, archive: true, project: value => value,
  valid: value => Boolean(value?.date && Array.isArray(value.buckets) && Array.isArray(value.exchanges)),
});

export function peekHistoricalBreadth(day: string) {
  const snapshot = cache.peek(day);
  return snapshot?.date === day ? snapshot : undefined;
}

export function readHistoricalBreadth(day: string, refresh = false) {
  return cache.read(day, refresh, async () => {
    const { envelope } = await backend.fetch("cn_market_breadth_history", { args: { date: day }, ...(refresh && { refresh }) });
    if (!["ok", "partial"].includes(envelope.status) || !envelope.evidence.length) {
      throw new Error(`${day} 暂未取得收盘涨跌分布。`);
    }
    if (dataDay(envelope) !== day || envelope.evidence.some(row => row.period?.slice(0, 10) !== day)) {
      throw new Error("涨跌分布的证据日期与所选复盘日不一致。");
    }
    const breadth = parseBreadth(envelope);
    if (!breadth || breadth.up === null || breadth.down === null) throw new Error("当日涨跌家数暂未取得。");
    return breadth;
  }, value => value.buckets.length === (value.fromDailyBars ? 21 : 23) ? 7 * 86_400_000 : 60_000);
}
