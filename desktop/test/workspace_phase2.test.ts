import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {readFileSync} from 'node:fs';
import {withRenderer,textOf} from './helpers/render.ts';
import {journeyHref,workspaceReturn,sameWorkspaceLocation} from '../src/verticals/finance/lib/workspaceJourney.ts';
const url=(value:string)=>new URL(value,'https://test.invalid');
const links=(html:string)=>[...html.matchAll(/href="([^"]+)"/g)].map(m=>m[1]!.replaceAll('&amp;','&'));
test('same-page actions preserve original source without creating self-return, including aliases',()=>{
 assert.equal(journeyHref('/watch','/watch',''),'/watch');
 assert.equal(journeyHref('/watch?date=2026-11-16','/watch','?date=2026-11-13'),'/watch?date=2026-11-16');
 const next=url(journeyHref('/workbench?symbol=600002','/workbench','?symbol=600001&source=/watch&returnTo=%2Fwatch%3Fdate%3D2026-11-16'));
 assert.equal(next.searchParams.get('returnTo'),'/watch?date=2026-11-16');assert.equal(next.searchParams.get('symbol'),'600002');
 assert.equal(journeyHref('/watchlist','/my-stocks','?tab=watch'),'/my-stocks?tab=watch');
 assert.ok(sameWorkspaceLocation('/watch?date=2026-11-16&symbol=600000','/watch?symbol=600000&date=2026-11-16&source=/watch'));
 assert.equal(journeyHref('/workbench/unknown','/watch','?symbol=600000'),'/watch?symbol=600000');
 assert.equal(journeyHref('https://evil.invalid/watch','/watch',''),'/watch');
});
test('actual public navigation retains selected job/run; return UI suppresses legacy self-links',async()=>{
 await withRenderer(async r=>{
  const {MemoryRouter}=await r.load('react-router-dom');
  const {WorkspaceNavigation}=await r.load('/src/verticals/finance/components/WorkspaceNavigation.tsx');
  const {WorkspaceJourney}=await r.load('/src/verticals/finance/components/WorkspaceJourney.tsx');
  const render=(route:string,C:any)=>r.html(()=>createElement(MemoryRouter,{initialEntries:[route]},createElement(C)),{});
  for(const route of ['/modes?run=R1','/backtest?job=taskA&mode=m1&version=2','/observations?id=O1&thesis=T1&symbol=600001']){
   const html=render(route,WorkspaceNavigation);const current=links(html).find(h=>url(h).pathname===url(route).pathname)!;
   assert.ok(sameWorkspaceLocation(current,route));assert.equal(url(current).searchParams.has('returnTo'),false);
  }
  const self=render('/watch?symbol=600000&returnTo=%2Fwatch%3Fsymbol%3D600000',WorkspaceJourney);
  assert.doesNotMatch(textOf(self),/返回盯盘/);
 });
});
test('migrated history row and mode sample links carry exact row target and source identity',async()=>{
 await withRenderer(async r=>{
  const {MemoryRouter}=await r.load('react-router-dom');
  const {HistoryView}=await r.load('/src/verticals/finance/shortline/HistoryTab.tsx');
  const fx=JSON.parse(readFileSync(new URL('./fixtures/shortline-views-2026-10-09.json',import.meta.url),'utf8'));
  const html=r.html(()=>createElement(MemoryRouter,{initialEntries:['/shortline/history?date=2026-10-09&symbol=600001']},createElement(HistoryView,{r:fx.history})),{});
  const dates=links(html).filter(h=>url(h).pathname==='/shortline');assert.ok(dates.length>0);
  for(const href of dates){const next=url(href);assert.equal(next.searchParams.get('symbol'),'600001');assert.equal(next.searchParams.get('returnTo'),'/shortline/history?symbol=600001&date=2026-10-09');assert.ok(next.searchParams.get('date'));}
  const {ModeRunReport}=await r.load('/src/verticals/finance/pages/ModeStudio.tsx');
  const run={id:'R1',created_at:'2026-11-16T03:00:00Z',combination:{name:'合成',version:2},rules:[],results:[],samples:[{symbol:'600002',name:'合成股票',rule:'rule',status:'missing',checks:[]}],added:[],removed:[],previous_id:null};
  const report=r.html(()=>createElement(MemoryRouter,{initialEntries:['/modes?run=R1&symbol=600001&date=2026-11-16']},createElement(ModeRunReport,{run})),{});
  const stock=url(links(report).find(h=>url(h).pathname==='/workbench')!);
  assert.equal(stock.searchParams.get('symbol'),'600002');assert.equal(stock.searchParams.get('date'),'2026-11-16');assert.equal(url(stock.searchParams.get('returnTo')!).searchParams.get('run'),'R1');
 });
});
test('JourneyLink context uses actual business date while explicit destination remains authoritative',async()=>{
 await withRenderer(async r=>{
  const {MemoryRouter}=await r.load('react-router-dom');const {JourneyLink}=await r.load('/src/verticals/finance/components/JourneyLink.tsx');
  const html=r.html(()=>createElement(MemoryRouter,{initialEntries:['/daily-review?date=2026-11-13&symbol=600001']},createElement(JourneyLink,{to:'/research?symbol=600002',context:{date:'2026-11-16'},children:'继续研究'})),{});
  const target=url(links(html)[0]!);assert.equal(target.searchParams.get('date'),'2026-11-16');assert.equal(target.searchParams.get('symbol'),'600002');
  assert.equal(url(target.searchParams.get('returnTo')!).searchParams.get('date'),'2026-11-16');assert.doesNotMatch(html,/context=/);
  const explicit=url(journeyHref('/shortline?date=2026-11-12','/shortline/history','?date=2026-11-13',{date:'2026-11-16'}));assert.equal(explicit.searchParams.get('date'),'2026-11-12');
  assert.equal(workspaceReturn(explicit.searchParams.get('returnTo')),'/shortline/history?date=2026-11-16');
 });
});

test('precise research and note targets remain independent of source IDs and preserve implemented anchors',async()=>{
 await withRenderer(async r=>{
  const {MemoryRouter}=await r.load('react-router-dom');const {JourneyLink}=await r.load('/src/verticals/finance/components/JourneyLink.tsx');
  const render=(to:string)=>r.html(()=>createElement(MemoryRouter,{initialEntries:['/research?run=sourceRun&symbol=600001#observation-sourceThesis']},createElement(JourneyLink,{to,children:'保存后查看'})),{});
  const note=url(links(render('/notes?id=noteB&private=secret'))[0]!);
  assert.equal(note.searchParams.get('id'),'noteB');assert.equal(note.searchParams.get('run'),null);assert.equal(note.searchParams.get('private'),null);
  const origin=url(note.searchParams.get('returnTo')!);assert.equal(origin.searchParams.get('run'),'sourceRun');assert.equal(origin.hash,'#observation-sourceThesis');
  const target=url(links(render('/research?run=targetRun&symbol=600002#observation-targetThesis'))[0]!);
  assert.equal(target.searchParams.get('run'),'targetRun');assert.equal(target.searchParams.get('symbol'),'600002');assert.equal(target.hash,'#observation-targetThesis');
  assert.equal(workspaceReturn('/research?run=../../bad#observation-%2Fbad'),'/research');
  assert.equal(workspaceReturn('/notes?id=noteB#arbitrary'),'/notes?id=noteB');
  assert.equal(workspaceReturn('/calendar?object=C1#criterion-C1'),'/calendar?kind=criterion&object=C1#criterion-C1');
 });
});
