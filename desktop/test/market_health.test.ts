import test from 'node:test';
import assert from 'node:assert/strict';
import {withRenderer,textOf} from './helpers/render.ts';
test('missing sampling history does not claim zero failures proves reliability',async()=>{
 await withRenderer(async r=>{
  const {MarketHealth}=await r.load('/src/verticals/finance/components/MarketHealth.tsx');
  const text=textOf(r.html(MarketHealth,{data:{cycles:0,failures:0,p95_ms:null,lowest_fresh_ratio:null,first_at:null,last_at:null,error:null,rows:[]}}));
  assert.match(text,/不能判断持续稳定性/);assert.doesNotMatch(text,/100%/);
 });
});
test('full-day acceptance exposes missing time instead of calling a successful sweep a pass',async()=>{
 await withRenderer(async r=>{
  const {MarketHealth}=await r.load('/src/verticals/finance/components/MarketHealth.tsx');
  const text=textOf(r.html(MarketHealth,{data:{cycles:1,failures:0,p95_ms:16000,lowest_fresh_ratio:1,first_at:'2026-11-16T07:06:00Z',last_at:'2026-11-16T07:06:16Z',error:null,rows:[],acceptance:{status:'failed',expected_slots:480,assessed_slots:480,covered_slots:0,slot_ratio:0,max_gap_seconds:7200,gaps:[]}}}));
  assert.match(text,/全天快照验收 · 未通过/);assert.match(text,/0 \/ 480/);assert.match(text,/收盘后补采不补回盘中缺口/);
 });
});
