import test from 'node:test';
import assert from 'node:assert/strict';
import {withRenderer,textOf} from './helpers/render.ts';
test('holdout shows a failed segment without claiming validation passed',async()=>{
 await withRenderer(async r=>{
  const {BacktestHoldout}=await r.load('/src/verticals/finance/components/BacktestHoldout.tsx');
  const text=textOf(r.html(BacktestHoldout,{value:{complete:false,error:'实际样本不足',segments:[{label:'开发区间',start:'2021-01-01',end:'2022-12-31',metrics:{total_return:.1}}]}}));
  assert.match(text,/未完成/);assert.match(text,/实际样本不足/);assert.match(text,/10.00%/);assert.match(text,/不代表已经通过/);
 });
});
test('result overview uses returned metrics and does not turn missing values into zero',async()=>{
 await withRenderer(async r=>{
  const {BacktestOutcome}=await r.load('/src/verticals/finance/components/BacktestOutcome.tsx');
  const html=r.html(BacktestOutcome,{hide:true,result:{ok:true,result:{metrics:{total_return:.1,max_drawdown:-.2,execution_fees:1234.56,unsettled_positions:{'sample':'blocked'}}}}});
  const text=textOf(html);assert.match(text,/总收益 10.00%/);assert.match(text,/年化 —/);assert.match(text,/最大回撤 -20.00%/);assert.match(text,/期末未平仓 1/);assert.doesNotMatch(html,/1234.56/);
  assert.equal(r.html(BacktestOutcome,{result:{ok:false}}),'');
 });
});
