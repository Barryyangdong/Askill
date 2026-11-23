import test from 'node:test';
import assert from 'node:assert/strict';
import {withRenderer,textOf} from './helpers/render.ts';
import {quoteCoverage} from '../src/verticals/finance/shortline/quoteCoverage.ts';

test('quote coverage distinguishes missing, unknown, old and fresh without double counting',()=>{
 const row={code:'1',name:'样例',price:10,pct:1,amount_yuan:100,quote_time:'20261116100100',today:true};
 const result=quoteCoverage([row,row,{...row,code:'2',price:null},{...row,code:'3',quote_time:null},{...row,code:'4',quote_time:'20261113150000',today:false},{...row,code:'5',quote_time:'20261116110100'}],Date.parse('2026-11-16T10:01:30+08:00'));
 assert.deepEqual({...result,latest:null},{total:5,missing:1,unknown:2,fresh:1,old:1,latest:null});
});

test('backtest starters show executable rules and distinguish unimplemented modes',async()=>{
 await withRenderer(async r=>{
  const {BacktestStarters}=await r.load('/src/verticals/finance/components/BacktestStarters.tsx');
  const html=r.html(BacktestStarters,{onChoose:()=>{},disabled:true});
  const text=textOf(html);
  for(const name of ['留出验证','规则组合','区间突破','均线趋势','RSI 回归','买入持有对照','补齐实验范围','完整历史覆盖']) assert.ok(text.includes(name),name);
  const enabled=r.html(BacktestStarters,{onChoose:()=>{},disabled:false});
  const buttons=enabled.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)??[];
  assert.equal(buttons.length,6);
  for(const button of buttons) { assert.match(textOf(button),/带入实验草稿/); assert.doesNotMatch(button, /\sdisabled(?:=|\s|>)/); }
  assert.equal((html.match(/<button[^>]*\sdisabled(?:=|\s|>)/g)||[]).length,buttons.length);
  assert.match(text,/龙头、首板、弱转强为什么还不能直接跑/);
 });
});
