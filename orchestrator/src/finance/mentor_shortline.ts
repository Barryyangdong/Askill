import { fetchEndpoint, type ServiceContext } from "../service.ts";
import { READINGS } from "./shortline/history.ts";
import { ladderOf } from "./shortline/premarket.ts";

interface Row { label: string; value: string }
interface Group { title: string; source: string; rows: Row[]; gap: string | null }
interface Evidence { field: string; period?: string; record_key?: string; value?: unknown }
interface Envelope { status?: string; extra?: {date?: string; settled?: boolean}; evidence?: Evidence[] }
const panels = [
  { endpoint: "cn_shortline_daily", title: "情绪与接力反馈", source: "短线王每日情绪 · 东财涨停池及昨日涨停股表现" },
  { endpoint: "cn_shortline_board_ladder", title: "连板天梯", source: "东财涨停池 · 收盘连板数与梯队成员" },
  { endpoint: "cn_shortline_themes", title: "题材强度", source: "短线王题材事件树 · 按收盘涨停原因归组，同股可属多个题材" },
] as const;
export function shortlineGroup(panel: typeof panels[number], day: string, env: Envelope): Group {
  const group: Group = {title: panel.title, source: panel.source, rows: [], gap: null};
  if (env.extra?.date !== day || env.extra.settled !== true || !["ok","partial"].includes(env.status ?? "")) {
    group.gap = "未取得该交易日的收盘定稿。";
    return group;
  }
  const facts = (env.evidence ?? []).filter(e => e.period === day);
  if (panel.endpoint === "cn_shortline_daily") {
    for (const metric of READINGS) {
      const fact = facts.find(e => e.field === metric.field && (!metric.record_key || e.record_key === metric.record_key));
      const value = fact?.value;
      const display = typeof value === "number" && Number.isFinite(value)
        ? metric.kind === "rate" ? (value * 100).toFixed(1) + "%" : value + metric.unit
        : "缺数据";
      group.rows.push({label: metric.key === "deep_loss" ? "昨日涨停股今跌超 5%" : metric.key === "money_effect" ? "昨日涨停股今日涨幅中位数" : metric.label, value: display});
    }
  } else if (panel.endpoint === "cn_shortline_board_ladder") {
    const ladder = ladderOf(env);
    const tiers = facts.filter(e => e.field === "ladder_tier_count" && /^\d+板$/.test(e.record_key ?? "") && typeof e.value === "number")
      .sort((a,b) => parseInt(b.record_key!) - parseInt(a.record_key!));
    for (const tier of tiers) {
      const names = ladder.stocks.filter(s => s.boards === parseInt(tier.record_key!)).slice(0,4).map(s => s.name);
      group.rows.push({label:tier.record_key!, value:[tier.value + " 只", ...names].join("　")});
    }
  } else {
    const themes = facts.filter(e => e.field === "topic_limit_up" && e.record_key && typeof e.value === "number" && e.value > 0)
      .sort((a,b) => Number(b.value) - Number(a.value)).slice(0,5);
    for (const theme of themes) {
      const height = facts.find(e => e.field === "topic_highest" && e.record_key === theme.record_key)?.value;
      group.rows.push({label:theme.record_key!,value:theme.value + " 只涨停" + (typeof height === "number" ? "　最高 " + height + " 板" : "")});
    }
  }
  if (!group.rows.length) group.gap = "此日没有可展示的分层记录。";
  else if (env.status === "partial") group.gap = "来源仅覆盖部分记录。";
  return group;
}

export async function mentorShortline(ctx: ServiceContext, date: string, signal?: AbortSignal) {
  const groups = await Promise.all(panels.map(async panel => {
    const request = { endpoint: panel.endpoint, args: { date } };
    try {
      const cached = await fetchEndpoint(ctx, { ...request, consistency: { mode: "cache_only" }, signal });
      const env: Envelope = cached.envelope;
      if (env.extra?.settled === true && env.extra.date === date) return shortlineGroup(panel,date,env);
    } catch { signal?.throwIfAborted(); }
    try {
      const fetched = await fetchEndpoint(ctx, { ...request, consistency:{mode:"fresh"}, timeout_ms:40_000, signal });
      return shortlineGroup(panel,date,fetched.envelope);
    } catch {
      signal?.throwIfAborted();
      return shortlineGroup(panel,date,{});
    }
  }));
  return {date,groups};
}
