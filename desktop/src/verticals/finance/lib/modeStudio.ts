export interface ModeRule {id:string;version:number;name:string;query:Record<string,string>;created_at:string}
export interface ModeCombination {id:string;version:number;name:string;rules:{id:string;version:number}[];limit:number;created_at:string}
export interface ModeRun {id:string;created_at:string;combination:ModeCombination;rules:ModeRule[];results:{gaps:string[];universe:{label:string;as_of:string|null};quotes:{source:string;fetched_at:string|null;cached:boolean}}[];samples:{symbol:string;name:string;rule:string;status:string;checks:{id:string;state:string;shown:string}[]}[];added:string[];removed:string[];uncertain?:string[];previous_id:string|null}
export interface ModeStore {rules:ModeRule[];combinations:ModeCombination[];runs:ModeRun[];tracking?:Record<string,{enabled:boolean;enabled_at:string;last_attempt:string|null;error:string|null}>}
export const MODE_METRICS=[['change_pct','涨跌幅（%）'],['volume_ratio','量比'],['turnover','换手率（%）'],['amount','成交额（亿元）'],['market_cap','总市值（亿元）'],['pe_ttm','市盈率 TTM'],['pb','市净率']] as const;
export const SAMPLE_LABELS:Record<string,string>={included:'纳入观察',unmet:'条件不符',missing:'缺少数据',duplicate:'重复样本',capacity:'名额已满'};
