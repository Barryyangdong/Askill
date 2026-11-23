import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {withRenderer,textOf} from './helpers/render.ts';
test('pattern history displays absent outcome and does not invent an aggregate',async()=>{
 await withRenderer(async r=>{
  const {PatternHistoryReport}=await r.load('/src/verticals/finance/components/PatternLab.tsx');
  const html=r.html(()=>createElement(PatternHistoryReport,{report:{pattern:'leader',complete:false,known:0,sample:1,mean:null,note:'不是成交回测',days:[{date:'2026-11-13',sample_date:'2026-11-12',expected:1,error:null,rows:[{code:'600000',name:'样本',ret:null}]}]}}),{});
  assert.match(textOf(html),/存在数据缺口/);assert.match(textOf(html),/后续读数缺失/);assert.match(textOf(html),/暂不汇总/);assert.doesNotMatch(textOf(html),/0\.00%/);
 });
});

test('已有核对只匹配模式和冻结版本', async () => {
 const {patternHistoryFor} = await import('../src/verticals/finance/lib/marketPatterns.ts');
 const records = [
  {id:'a', pattern:'leader', version:1},
  {id:'b', pattern:'leader', version:2},
  {id:'c', pattern:'first_board', version:1},
 ] as any;
 assert.deepEqual(patternHistoryFor(records, 'leader', 1).map((r: any)=>r.id), ['a']);
 assert.deepEqual(patternHistoryFor(records, 'leader', 2).map((r: any)=>r.id), ['b']);
 assert.deepEqual(patternHistoryFor(records, 'weak_to_strong', 1), []);
});
