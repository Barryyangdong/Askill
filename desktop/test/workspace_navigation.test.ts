import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {withRenderer,textOf} from './helpers/render.ts';
test('stock actions preserve the selected stock and mode actions preserve the experiment',async()=>{
 await withRenderer(async r=>{
  const {WorkspaceNavigation}=await r.load('/src/verticals/finance/components/WorkspaceNavigation.tsx');
  const {MemoryRouter}=await r.load('react-router-dom');
  const render=(route:string)=>r.html(()=>createElement(MemoryRouter,{initialEntries:[route]},createElement(WorkspaceNavigation)),{});
  const stock=render('/research?symbol=600825');
  assert.match(textOf(stock),/行情/);assert.match(stock,/\/debate\?symbol=600825/);
  const mode=render('/backtest?mode=example&version=2');
  assert.match(mode,/\/observations\?mode=example&amp;version=2/);
  assert.match(textOf(mode),/模式研究/);assert.doesNotMatch(textOf(mode),/产业信号/);
 });
});

test('模式跟踪不继承无关盯盘股票，但保留明确的候选来源',async()=>{
 await withRenderer(async r=>{
  const {WorkspaceNavigation}=await r.load('/src/verticals/finance/components/WorkspaceNavigation.tsx');
  const {WorkspaceContextScope}=await r.load('/src/verticals/finance/components/WorkspaceLink.tsx');
  const {MemoryRouter}=await r.load('react-router-dom');
  const render=(route:string)=>r.html(()=>createElement(MemoryRouter,{initialEntries:[route]},createElement(WorkspaceContextScope.Provider,{value:{symbol:'600000'}},createElement(WorkspaceNavigation))),{});
  const all=render('/modes?pattern=leader');
  assert.match(all,/href="\/observations\?pattern=leader&amp;source=/);
  assert.doesNotMatch(all,/symbol=600000/);
  const explicit=render('/observations?pattern=leader&run=sample1&symbol=002187');
  assert.match(explicit,/href="\/observations\?symbol=002187&amp;run=sample1&amp;pattern=leader"/);
 });
});

test('个股页返回市场保留当前工作区股票',async()=>{
 await withRenderer(async r=>{
  const {WorkspaceNavigation}=await r.load('/src/verticals/finance/components/WorkspaceNavigation.tsx');
  const {WorkspaceContextScope}=await r.load('/src/verticals/finance/components/WorkspaceLink.tsx');
  const {MemoryRouter}=await r.load('react-router-dom');
  const html=r.html(()=>createElement(MemoryRouter,{initialEntries:['/research?symbol=600825']},createElement(WorkspaceContextScope.Provider,{value:{symbol:'600825'}},createElement(WorkspaceNavigation))),{});
  assert.match(html,/href="\/watch\?symbol=600825&amp;source=[^"]+"[^>]*>市场总览/);
 });
});

test('普通入口不再重复侧栏；个股入口携带股票直达公告', async () => {
 await withRenderer(async r => {
  const {WorkspaceNavigation} = await r.load('/src/verticals/finance/components/WorkspaceNavigation.tsx');
  const {MemoryRouter} = await r.load('react-router-dom');
  const render = (route:string) => r.html(() => createElement(MemoryRouter, {initialEntries:[route]}, createElement(WorkspaceNavigation)), {});
  for (const path of ['/watch','/shortline','/distillation','/intel','/notes','/calendar']) assert.equal(textOf(render(path)), '');
  assert.match(render('/research?symbol=600825'), /href="\/intel\/filings\?symbol=600825/);
 });
});
