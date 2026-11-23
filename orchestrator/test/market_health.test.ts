import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {marketHealth,recordMarketCycle,summarizeMarketCycles,acceptMarketDay,type MarketCycle} from '../src/finance/shortline/market_health.ts';
const cycle:MarketCycle={started_at:'2026-11-16T02:00:00Z',finished_at:'2026-11-16T02:00:20Z',duration_ms:20000,error:null,expected:100,fresh:98,stale:2,missing:0,unknown:0,inventory_complete:true,repaired:0};
test('full-day acceptance counts start/end gaps, excludes lunch and after-hours samples',()=>{
 const day='2026-11-16',end=Date.parse(day+'T15:01:00+08:00');
 const rows=['09:30','13:00'].flatMap(hm=>Array.from({length:240},(_,i)=>({...cycle,fresh:100,trading_day:true,finished_at:new Date(Date.parse(day+'T'+hm+':00+08:00')+i*30000+20000).toISOString()})));
 assert.equal(acceptMarketDay(rows,day,end).status,'passed');
 assert.equal(acceptMarketDay(rows.slice(5),day,end).status,'failed');
 assert.equal(acceptMarketDay(rows.slice(5),day,end).max_gap_seconds,150);
 assert.equal(acceptMarketDay([{...cycle,trading_day:true,finished_at:day+'T15:06:00+08:00'}],day,end).covered_slots,0);
 assert.equal(acceptMarketDay([],day,end).status,'unconfirmed');
 assert.equal(acceptMarketDay(rows,day,Date.parse(day+'T14:00:00+08:00')).status,'pending');
});
test('health aggregates include failures and unconfirmed inventory, not only good cycles',()=>{
 const result=summarizeMarketCycles([cycle,{...cycle,duration_ms:180000,error:'timeout',fresh:0,inventory_complete:false}]);
 assert.equal(result.failures,1);assert.equal(result.p95_ms,180000);assert.equal(result.lowest_fresh_ratio,0);
 assert.equal(summarizeMarketCycles([]).lowest_fresh_ratio,null);
});
test('daily records survive reads and corruption is visible',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'askill-health-'));
 try{
  assert.equal(marketHealth(root,'2026-11-16').cycles,0);
  recordMarketCycle(root,'2026-11-16',cycle);
  assert.equal(marketHealth(root,'2026-11-16').cycles,1);
  assert.equal(marketHealth(root,'2026-11-17').cycles,0);
  fs.appendFileSync(path.join(root,'shortline','market-health','2026-11-16.jsonl'),'{broken');
  assert.match(marketHealth(root,'2026-11-16').error??'',/读取失败/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
