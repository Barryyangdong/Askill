export interface MarketScanView {running:boolean;error:string|null;completed_at:string|null;duration_ms:number|null;cycle:number;repaired:number;source:string;scope_note:string;matched:number;coverage:{markets?:{sh:number;sz:number;bj:number};expected:number|null;listed:number;inventory_complete:boolean;fresh:number;stale:number;unknown:number;missing:number;fresh_ratio:number|null};rows:{symbol:string;name:string;price:number|null;pct:number|null;quote_time:string;age_ms:number|null}[]}
export interface PatternStore {patterns:{id:string;name:string;rule:string;timing:string;history:string}[];runs:{id:string;pattern:string;version:number;at:string;sample_date:string;quote_date:string;pool_count:number;rows:{code:string;name:string;boards:number;status:'met'|'unmet'|'missing';reason:string;price:number|null;pct:number|null;quote_time:string|null}[]}[]}

export interface PatternHistory {version:number;id:string;at?:string;pattern:string;complete:boolean;sample:number;known:number;mean:number|null;note:string;days:{date:string;sample_date:string|null;expected:number|null;error:string|null;rows:{code:string;name:string;ret:number|null}[]}[]}
export interface PatternStore {history?:PatternHistory[]}

export interface MarketScanView {cadence_ms:number;alerts?:{ts:string;code:string;name:string;kind:string;msg:string}[]}

export interface MarketScanView {health?:MarketHealthData}

export interface MarketDayAcceptance {status:'passed'|'failed'|'pending'|'unconfirmed';expected_slots:number;assessed_slots:number;covered_slots:number;slot_ratio:number|null;max_gap_seconds:number;gaps:{from:string;to:string;seconds:number}[]}
export interface MarketHealthData {
 acceptance?:MarketDayAcceptance;
 cycles:number;failures:number;p95_ms:number|null;lowest_fresh_ratio:number|null;
 first_at:string|null;last_at:string|null;error:string|null;
 rows:{started_at:string;finished_at:string;duration_ms:number;error:string|null;expected:number|null;fresh:number;stale:number;missing:number;unknown:number;repaired:number}[];
}

export interface PatternStore {execution?:{status:string;engine:string;items:{name:string;state:string;detail:string}[];note:string}}

/** 历史核对仅属于冻结的模式和规则版本。 */
export function patternHistoryFor(history: PatternHistory[] | undefined, pattern: string, version: number): PatternHistory[] {
  return (history ?? []).filter(item => item.pattern === pattern && item.version === version);
}
