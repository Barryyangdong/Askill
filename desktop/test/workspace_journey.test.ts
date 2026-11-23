import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {journeyHref,workspaceReturn} from '../src/verticals/finance/lib/workspaceJourney.ts';
import {withRenderer,textOf} from './helpers/render.ts';
test('market → stock → review → observation preserves explicit stock, date and source',()=>{
 let current='/watch/intraday?date=2026-11-16&symbol=600000&tab=intraday';
 for(const target of ['/workbench','/shortline','/observations','/research','/notes']){
   const from=new URL(current,'https://test.invalid');
   const next=new URL(journeyHref(target,from.pathname,from.search),'https://test.invalid');
   assert.equal(next.searchParams.get('symbol'),'600000');
   assert.equal(next.searchParams.get('date'),'2026-11-16');
   assert.equal(next.searchParams.get('source'),from.pathname);
   assert.equal(workspaceReturn(next.searchParams.get('returnTo')),workspaceReturn(current));
   current=next.pathname+next.search;
 }
});
test('return rejects external targets and drops credentials; destination wins',()=>{
 for(const raw of ['https://evil.invalid','//evil.invalid','/unknown'])assert.equal(workspaceReturn(raw),null);
 assert.equal(workspaceReturn('/watch?symbol=600000&access=secret&key=secret'),'/watch?symbol=600000');
 const next=new URL(journeyHref('/workbench?symbol=000001','/watch','?symbol=600000&date=2026-02-30'),'https://test.invalid');
 assert.equal(next.searchParams.get('symbol'),'000001');assert.equal(next.searchParams.has('date'),false);
});
test('core choices and safe source return render without backend',async()=>{
 await withRenderer(async r=>{
  const {PageTabs}=await r.load('/src/verticals/finance/components/ui/PageTabs.tsx');
  const html=r.html(PageTabs,{value:'facts',label:'分析',primaryKeys:['facts'],options:[{key:'facts',label:'事实'},{key:'history',label:'历史分析'}],onChange:()=>{}});
  assert.match(textOf(html),/历史分析/);assert.doesNotMatch(html,/<select|<details/);
  const {WorkspaceJourney}=await r.load('/src/verticals/finance/components/WorkspaceJourney.tsx');
  const {MemoryRouter}=await r.load('react-router-dom');
  const render=(route:string)=>r.html(()=>createElement(MemoryRouter,{initialEntries:[route]},createElement(WorkspaceJourney)),{});
  const source='/workbench?symbol=600000&date=2026-11-16&group=2&firstSymbol=000001&key=secret';
  const journey=render(`/shortline?symbol=600000&returnTo=${encodeURIComponent(source)}`);
  assert.match(textOf(journey),/返回个股行情/);
  const links=[...journey.matchAll(/href="([^"]+)"/g)].map(m=>m[1]!.replaceAll('&amp;','&'));
  assert.deepEqual(links,['/workbench?symbol=600000&date=2026-11-16&group=2&firstSymbol=000001']);
  for(const route of ['/shortline','/shortline?returnTo=https%3A%2F%2Fevil.invalid','/shortline?returnTo=%2Funknown','/shortline?symbol=600000&returnTo=%2Fshortline%3Fsymbol%3D600000']){
   assert.equal(render(route),'');
  }
 });
});
