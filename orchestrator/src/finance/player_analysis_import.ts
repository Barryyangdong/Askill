import { ServiceError } from "../service.ts";
import type { PlayerDay, PlayerRow } from "./player_analysis_metrics.ts";

export interface PlayerImport extends PlayerDay {
  schemaVersion: 1;
  matchId: string;
  matchName: string;
  divisionId: string;
  divisionName: string;
}

export function invalid(message: string): never { throw new ServiceError("bad_request", message); }

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label + "应为对象");
  return value as Record<string, unknown>;
}

function label(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 160 || /[\x00-\x1f]/.test(value)) invalid(field + "应为 1–160 字的文本");
  return value.trim();
}

function date(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d$/.test(value)) invalid(field + "应为 YYYY-MM-DD");
  const time = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0,10) !== value) invalid(field + "无效");
  const weekday = new Date(time).getUTCDay();
  if (weekday === 0 || weekday === 6) invalid(field + "落在周末，请核对 A 股交易日期");
  return value;
}

function masked(value: unknown): boolean {
  return typeof value === "string" && /^[*＊★]+$/.test(value.trim());
}

function number(value: unknown, field: string, minimum: number): number | null {
  if (value == null || masked(value)) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || Math.abs(value) > 1e9) invalid(field + "数值无效，百分比请转为小数");
  return value;
}

function status<T extends string>(value: unknown, choices: readonly T[], field: string): T {
  if (!choices.includes(value as T)) invalid(field + "状态无效");
  return value as T;
}

export function normalizeRow(input: unknown, index: number): PlayerRow {
  const prefix = "第 " + (index + 1) + " 行 ";
  const r = object(input, prefix);
  const state = status(r.state, ["reported","published","leave","suspended","missing","unknown","withdrawn"] as const, prefix + "报单");
  const declared = status(masked(r.holdingsState) ? "partial" : r.holdingsState,
    ["complete","empty","partial","unknown"] as const, prefix + "持仓");
  const rawSymbols = r.symbols ?? [];
  if (!Array.isArray(rawSymbols) || rawSymbols.length > 500) invalid(prefix + "symbols 应为最多 500 项的股票代码列表");
  const visibleSymbols = rawSymbols.filter(value => !masked(value));
  const holdingsState = visibleSymbols.length !== rawSymbols.length || (declared === "unknown" && visibleSymbols.length)
    ? "partial" : declared;
  const symbols = [...new Set(visibleSymbols.map((value: unknown) => {
    const raw = label(value, prefix + "证券代码").toUpperCase();
    const cn = /^(?:SH|SZ|BJ)?(\d{6})$/.exec(raw) ?? /^(\d{6})\.(?:SH|SZ|BJ)$/.exec(raw);
    if (cn) return cn[1];
    if (/^[0-9]{5}\.HK$/.test(raw) || /^[A-Z][A-Z0-9]{0,9}(?:[.-][A-Z0-9]{1,4})?$/.test(raw)) return raw;
    return invalid(prefix + "证券代码格式无效");
  }))].sort();
  if (holdingsState === "complete" && symbols.length === 0) invalid(prefix + "完整持仓需要股票代码，确认空仓时请标记 empty");
  if ((holdingsState === "empty" || holdingsState === "unknown") && symbols.length) invalid(prefix + "股票列表与持仓状态冲突");
  if (masked(r.id)) invalid(prefix + "选手 ID 已遮挡，无法确认选手身份");
  const rank = number(r.rank, prefix + "排名", 1);
  if (rank !== null && !Number.isSafeInteger(rank)) invalid(prefix + "排名应为正整数");
  return { id: label(r.id,prefix+"选手 ID"), name: label(r.name,prefix+"选手名"), rank, state,
    dayReturn: number(r.dayReturn,prefix+"日收益",-1), totalReturn: number(r.totalReturn,prefix+"总收益",-1),
    exposure: number(r.exposure,prefix+"仓位",0), nav: number(r.nav,prefix+"净值",0), holdingsState, symbols };
}

export function normalizePlayerImport(value: unknown): PlayerImport {
  const data = object(value,"导入文件");
  if (data.schemaVersion !== 1) invalid("支持的 schemaVersion 为 1");
  const tradeDate = date(data.date,"交易日");
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0,10);
  if (tradeDate > today) invalid("未来交易日不可导入");
  const previousTradeDate = data.previousTradeDate == null ? null : date(data.previousTradeDate,"上一交易日");
  if (previousTradeDate && previousTradeDate >= tradeDate) invalid("上一交易日必须早于当前交易日");
  if (typeof data.rankComplete !== "boolean") invalid("请声明榜单是否完整 rankComplete");
  if (!Array.isArray(data.players) || !data.players.length || data.players.length > 10000) invalid("每次导入 1–10000 名选手");
  const players = data.players.map(normalizeRow).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(players.map(p=>p.id)).size !== players.length) invalid("同一快照中选手 ID 重复，请核对名单");
  if (data.rankComplete) {
    if (data.players.some((row:Record<string,unknown>) => row.state !== "withdrawn" && masked(row.rank)))
      invalid("存在被遮挡的排名，请将 rankComplete 设为 false");
    const ranks = players.filter(p=>p.state!=="withdrawn" && p.rank!==null).map(p=>p.rank!).sort((a,b)=>a-b);
    // Both dense and competition ranking conventions can occur after a tie.
    for (let i=0;i<ranks.length;i++) {
      const rank = ranks[i], prior = ranks[i-1] ?? 0;
      if (rank!==prior && rank!==prior+1 && rank!==i+1) invalid("完整榜单的名次存在断档；请补齐榜单或设置 rankComplete 为 false");
    }
  }
  const expected = number(data.expected,"应报人数",0);
  if (expected !== null && (!Number.isSafeInteger(expected) || expected < players.filter(p=>p.state === "reported").length)) invalid("应报人数应为整数且至少覆盖实报人数");
  return {schemaVersion:1, matchId:label(data.matchId,"比赛 ID"), matchName:label(data.matchName,"赛事名称"),
    divisionId:label(data.divisionId,"赛组 ID"),divisionName:label(data.divisionName,"赛组名称"),
    date:tradeDate,...(data.previousTradeDate===undefined ? {} : {previousTradeDate}),expected,rankComplete:data.rankComplete,players};
}
