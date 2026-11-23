import fs from 'node:fs';
import path from 'node:path';

export interface MarketCycle {
 started_at:string; finished_at:string; duration_ms:number; error:string|null;
 expected:number|null; fresh:number; stale:number; missing:number; unknown:number;
 inventory_complete:boolean; repaired:number; trading_day?:boolean|null;
}
export const MARKET_ACCEPTANCE = {version:1,slot_seconds:30,min_slot_ratio:.95,min_fresh_ratio:.99,max_gap_seconds:120};
/** Acceptance is for 09:30–11:30 and 13:00–15:00 snapshots, not tick delivery. */
export function acceptMarketDay(rows:MarketCycle[],day:string,now=Date.now()){
 const start=Date.parse(day+'T09:30:00+08:00'),afternoon=Date.parse(day+'T13:00:00+08:00');
 const end=Date.parse(day+'T15:00:00+08:00');
 const slots=[...Array.from({length:240},(_,i)=>start+i*30000),...Array.from({length:240},(_,i)=>afternoon+i*30000)];
 const completed=slots.filter(t=>t+30000<=now);
 const good=rows.filter(r=>!r.error&&r.inventory_complete&&r.expected!==null&&r.expected>0&&r.fresh/r.expected>=MARKET_ACCEPTANCE.min_fresh_ratio);
 const present=new Set(good.map(r=>{const t=Date.parse(r.finished_at);const base=t>=afternoon?afternoon:start;return base+Math.floor((t-base)/30000)*30000;}));
 const missing=completed.filter(t=>!present.has(t));
 const gaps:{from:string;to:string;seconds:number}[]=[];
 for(const t of missing){const last=gaps.at(-1);if(last&&Date.parse(last.to)===t){last.to=new Date(t+30000).toISOString();last.seconds+=30;}else gaps.push({from:new Date(t).toISOString(),to:new Date(t+30000).toISOString(),seconds:30});}
 const covered=completed.length-missing.length,ratio=completed.length?covered/completed.length:null;
 const max_gap_seconds=Math.max(0,...gaps.map(g=>g.seconds));
 const session_finished=now>=end;
 const confirmed=rows.some(r=>r.trading_day===true);
 const passed=confirmed&&session_finished&&ratio!==null&&ratio>=MARKET_ACCEPTANCE.min_slot_ratio&&max_gap_seconds<=MARKET_ACCEPTANCE.max_gap_seconds;
 return {status:!confirmed?'unconfirmed':session_finished?(passed?'passed':'failed'):'pending',rules:MARKET_ACCEPTANCE,session_finished,expected_slots:480,assessed_slots:completed.length,covered_slots:covered,slot_ratio:ratio,max_gap_seconds,gaps};
}
const location=(root:string,day:string)=>path.join(root,'shortline','market-health',day+'.jsonl');
export function recordMarketCycle(root:string,day:string,cycle:MarketCycle){
 const file=location(root,day);fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.appendFileSync(file,JSON.stringify(cycle)+'\n',{mode:0o600});
}
export function summarizeMarketCycles(rows:MarketCycle[]){
 const durations=rows.map(r=>r.duration_ms).sort((a,b)=>a-b);
 return {cycles:rows.length,failures:rows.filter(r=>r.error).length,
  p95_ms:durations.length?durations[Math.ceil(durations.length*.95)-1]:null,
  lowest_fresh_ratio:rows.length?Math.min(...rows.map(r=>r.expected&&r.inventory_complete?r.fresh/r.expected:0)):null,
  first_at:rows[0]?.started_at??null,last_at:rows.at(-1)?.finished_at??null,
  rows:rows.slice(-30).reverse()};
}
export function marketHealth(root:string,day:string){
 try{const rows=fs.readFileSync(location(root,day),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line) as MarketCycle);return {...summarizeMarketCycles(rows),acceptance:acceptMarketDay(rows,day),error:null};}
 catch(e){return {...summarizeMarketCycles([]),acceptance:acceptMarketDay([],day),error:(e as NodeJS.ErrnoException).code==='ENOENT'?null:'采集记录读取失败，无法评估连续表现'};}
}
