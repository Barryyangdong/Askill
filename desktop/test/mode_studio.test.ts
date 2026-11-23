import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {withRenderer,textOf} from './helpers/render.ts';
test('mode report distinguishes a missing sample from a failed condition and links to the stock',async()=>{
 await withRenderer(async r=>{
  const {ModeRunReport}=await r.load('/src/verticals/finance/pages/ModeStudio.tsx');
  const {MemoryRouter}=await r.load('react-router-dom');
  const run={id:'r',created_at:'2026-11-16T03:00:00Z',combination:{name:'观察示例',version:2},rules:[{id:'rule',version:1,name:'量能',query:{amount_min:'1'}}],results:[{gaps:['行情缺口'],universe:{label:'自选'},quotes:{source:'样例来源',fetched_at:null}}],samples:[{symbol:'600825',name:'公开样例',rule:'rule@1',status:'missing',checks:[{id:'amount',state:'missing',shown:'没取到'}]}],added:[],removed:[],previous_id:null};
  const html=r.html(()=>createElement(MemoryRouter,null,createElement(ModeRunReport,{run})),{});
  assert.match(textOf(html),/缺少数据 1/);assert.match(textOf(html),/条件不符 0/);
  assert.match(textOf(html),/不代表模拟成交/);assert.match(textOf(html),/行情缺口/);
  assert.match(html,/workbench\?symbol=600825/);
 });
});
