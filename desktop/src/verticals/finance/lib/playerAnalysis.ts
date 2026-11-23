export interface Contest {
  matchId: string; matchName: string; divisionId: string; divisionName: string; dates: string[];
}
export interface Metric { value: number | null; numerator: number | null; denominator: number; ids: string[] }
export interface Bin { label: string; ids: string[] }
export interface Group {
  ids: string[]; reported: number; profit: Metric; dayReturn: Metric; exposure: Metric; rising: Metric;
  exposureBins: Bin[]; returnBins: Bin[];
}
export interface Holdings {
  holders: string[]; denominator: number; comparable: number; added: string[]; kept: string[]; exited: string[]; net: number | null;
}
export interface Stock { symbol: string; preference: number | null; all: Holdings; top: Holdings; bottom: Holdings }
export interface PlayerRow {
  screenshot?: {id:string; exposure:boolean; holdings:boolean; exposureId?:string; holdingsId?:string};
  id: string; name: string; rank: number | null; state: string; holdingsState: string; symbols: string[];
  dayReturn: number | null; totalReturn: number | null; exposure: number | null;
}
export interface Player extends PlayerRow {
  followed: boolean; migration: string | null; streak: number | null; streakIsLowerBound:boolean; topDays: number; rankDays: number;
  reportDays: number; drawdown: number | null; eligible: boolean;
}
export interface Analysis {
  date: string; previousDate: string | null; rankDate: string | null; rankBasis: string; size: number; groupReason: string | null;
  coverage: { expected: number | null; reported: number; published?:number; carried: number; missing: number; unknown: number; complete: number; roster: number };
  groups: Record<'all'|'top'|'bottom',Group>; stocks: Stock[]; players: Player[]; digest: {symbol:string;text:string}[];
}
export interface AnalysisResult {
  officialMatchSeq?:string;
  matches: Contest[]; analysis: Analysis; followed: string[]; date: string; revision: number; asOf: string;
  importedAt: string; versions: {revision:number;importedAt:string}[];
}
export const reportLabels: Record<string,string> = {
  reported:"已报单", published:"榜单已披露", leave:"请假沿用", suspended:"停牌沿用", missing:"未报单", unknown:"状态未知", withdrawn:"已退赛",
};
export const holdingsLabels: Record<string,string> = {complete:"完整",empty:"空仓",partial:"部分遮挡",unknown:"未知"};
export function ratio(value: number | null | undefined) {
  return value == null ? "—" : new Intl.NumberFormat("zh-CN",{style:"percent",maximumFractionDigits:2}).format(value);
}
export const playerControl = "rounded border border-border bg-background px-2.5 py-1.5 text-xs disabled:opacity-50";
export const playerTabs = "rounded border border-border px-3 py-1.5 text-xs aria-pressed:border-primary/60 aria-pressed:bg-primary/10 aria-pressed:text-primary";

