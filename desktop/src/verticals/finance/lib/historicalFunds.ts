import { backend, type Envelope } from "./backend.ts";
import { dataDay, parseBoardFlow, parseTurnover } from "./marketReview.ts";
import { createReviewCache } from "../shortline/reviewCache.ts";

function datedRanking<T extends {date: string | null; rows: unknown[]}>(
  endpoint: string, description: string, parse: (env: Envelope) => T | null, args: Record<string, unknown> = {},
) {
  const cache = createReviewCache<{ data: T; complete: boolean }>(24, {
    namespace: endpoint, limit: 15, archive: true, project: value => value,
    valid: value => !!value?.data?.date && Array.isArray(value.data.rows) && value.data.rows.length > 0,
  });
  return {
    peek(day: string) {
      const value = cache.peek(day)?.data;
      return value?.date === day ? value : undefined;
    },
    async read(day: string, refresh: boolean) {
      const cached = await cache.read(day, refresh, async () => {
        const {envelope} = await backend.fetch(endpoint, {args: {...args, date: day}, ...(refresh && {refresh})});
        if (!["ok", "partial"].includes(envelope.status) || !envelope.evidence.length) {
          throw new Error(`${day} 暂无${description}收盘数据。`);
        }
        if (dataDay(envelope) !== day || envelope.evidence.some(item => item.period?.slice(0, 10) !== day)) {
          throw new Error(`${description}的证据日期与所选复盘日不一致。`);
        }
        const value = parse(envelope);
        if (!value?.rows.length) throw new Error(`${day} 的${description}未返回可展示的排名。`);
        return {data: value, complete: envelope.status === "ok"};
      }, result => result.complete ? 7 * 86_400_000 : 60_000);
      return cached.data;
    },
  };
}

export const historicalFlow = datedRanking("cn_review_industry_close", "行业资金榜", parseBoardFlow);
export const historicalTurnover = datedRanking("cn_shortline_turnover_top", "成交额榜", parseTurnover, {top: 20});
