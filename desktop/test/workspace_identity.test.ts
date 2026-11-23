import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {withRenderer} from './helpers/render.ts';
import {workspaceReturn,journeyHref} from '../src/verticals/finance/lib/workspaceJourney.ts';
import {workbenchRestore,intelReturnLocation} from '../src/verticals/finance/lib/workbenchIntel.ts';
import {normalizeMarketSymbol} from '../src/verticals/finance/lib/marketSymbol.ts';
function harness(path:string, dependencies:Record<string,any>) {
  let interval:any; let slots:any[]=[], i=0, effects:any[]=[], pending:any[]=[];
  const react = {
    useState(initial:any){const n=i++; if(!(n in slots))slots[n]=typeof initial==='function'?initial():initial; return [slots[n],(v:any)=>{slots[n]=typeof v==='function'?v(slots[n]):v;}];},
    useRef(value:any){const n=i++; return slots[n]??=( {current:value} );},
    useMemo(fn:any,deps:any[]){const n=i++;const prev=slots[n];if(!prev||deps.some((x,j)=>!Object.is(x,prev.deps[j])))slots[n]={deps,value:fn()};return slots[n].value;},
    useCallback(fn:any,deps:any[]){const n=i++;const prev=slots[n];if(!prev||deps.some((x,j)=>!Object.is(x,prev.deps[j])))slots[n]={deps,value:fn};return slots[n].value;},
    useEffect(fn:any,deps:any[]){const n=i++;const prev=effects[n];if(!prev||!deps||deps.some((x,j)=>!Object.is(x,prev.deps[j]))){pending.push(()=>{prev?.cleanup?.();effects[n]={deps,cleanup:fn()};});}},
  };
  const jsx={jsx:(type:any,props:any)=>({type,props:props??{}}),jsxs:(type:any,props:any)=>({type,props:props??{}}),Fragment:'fragment'};
  const text=readFileSync(new URL(path,import.meta.url),'utf8');
  const js=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:any={};
  const req=(name:string)=> name==='react'?react:name==='react/jsx-runtime'?jsx:dependencies[name]??new Proxy({}, {get:(_t,k)=>k==='__esModule'?true:()=>null});
  runInNewContext(js,{exports,require:req,AbortController,URLSearchParams,setTimeout:(fn:any,ms:number)=>{const timer={fn,ms,cleared:false};dependencies.__timers?.push(timer);return timer;},clearTimeout:(timer:any)=>{if(timer)timer.cleared=true;},setInterval:(fn:any)=>{interval=fn;return 1;},clearInterval(){},Event:class {},window:{dispatchEvent(){},addEventListener(){},removeEventListener(){}},Date,document:dependencies.__document??{getElementById(){return null;},hidden:false,addEventListener(){},removeEventListener(){}}});
  return {exports,remount(){slots=[];effects=[];},poll(){interval?.();},dispose(){effects.forEach(e=>e?.cleanup?.());},render(fn:any,...args:any[]){i=0;pending=[];const out=fn(...args);const work=pending;pending=[];work.forEach(f=>f());return out;}};
}
const tick=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};

function nodes(x:any):any[]{if(!x)return [];if(Array.isArray(x))return x.flatMap(nodes);if(typeof x!=='object')return [];return [x,...nodes(x.props?.children),...nodes(x.props?.actions)];}
function words(x:any):string{if(x==null)return '';if(Array.isArray(x))return x.map(words).join(' ');if(typeof x==='object')return words(x.props?.children);return String(x);}

const decode=(s:string)=>s.replaceAll('&amp;','&');
function linkTo(html:string,path:string){const links=[...html.matchAll(/href="([^"]+)"/g)].map(m=>decode(m[1]!));const result=links.find(s=>s.split('?')[0]===path);assert.ok(result,`${path} link exists`);return result;}
test('actual group and stock handlers → stock navigation and observation link → LIB-compatible return',async()=>{
 let params=new URLSearchParams('symbol=600001&date=2026-11-16&source=/watch&returnTo=%2Fwatch');
 const saved={symbol:'600001',groups:{'1':'600001','2':'600002','3':'600003'},panels:[]};
 const h=harness('../src/verticals/finance/pages/Workbench.tsx',{
  'react-router-dom':{useSearchParams:()=>[params,(update:any)=>{params=typeof update==='function'?update(params):update;}]},
  '../hooks/useLocalPreference':{useLocalPreference:()=>({value:saved,ready:true,save:()=>{},error:null})},
  '../lib/workbenchIntel':{workbenchRestore},'../lib/marketSymbol':{normalizeMarketSymbol},
  '../lib/backend':{backend:{ledger:()=>new Promise(()=>{})}},'../hooks/useLiveQuotes':{useLiveQuotes:()=>({})},
  '../components/JourneyLink':{JourneyLink:'JourneyLink'},
 });
 h.render(h.exports.Workbench);let tree=h.render(h.exports.Workbench);
 nodes(tree).find(n=>n.props?.['aria-label']==='当前联动组')!.props.onChange({target:{value:'2'}});
 tree=h.render(h.exports.Workbench);
 assert.equal(params.get('symbol'),'600002');assert.equal(params.get('group'),'2');assert.equal(params.get('firstSymbol'),'600001');
 assert.ok(nodes(tree).some(n=>n.props?.subtitle==='当前股票 600002'));
 await withRenderer(async r=>{
  const {MemoryRouter}=await r.load('react-router-dom');
  const {WorkspaceNavigation}=await r.load('/src/verticals/finance/components/WorkspaceNavigation.tsx');
  const {JourneyLink}=await r.load('/src/verticals/finance/components/JourneyLink.tsx');
  for(const expected of ['600002','600009']){
   if(expected==='600009'){
    nodes(tree).find(n=>n.props?.placeholder==='切换股票 / 代码 / 拼音')!.props.onPick({symbol:expected});
    tree=h.render(h.exports.Workbench);
   }
   const render=(component:any,props:Record<string,any>={})=>r.html(()=>createElement(MemoryRouter,{initialEntries:[`/workbench?${params}`]},createElement(component,props)),{});
   const nav=render(WorkspaceNavigation);
   const observation=nodes(tree).find(n=>n.type==='JourneyLink'&&n.props.to===`/observations?symbol=${expected}`);
   assert.ok(observation,'当前工作台提供所选股票的观察入口');
   const businessLink=render(JourneyLink,observation.props);
   for(const [html,path] of [[nav,'/research'],[nav,'/intel/filings'],[nav,'/debate'],[nav,'/watch'],[businessLink,'/observations']]){
    const target=new URL(linkTo(html!,path!),'https://test.invalid');
    assert.equal(target.searchParams.get('symbol'),expected);
    const back=new URL(target.searchParams.get('returnTo')!,'https://test.invalid');
    assert.equal(back.searchParams.get('symbol'),expected);assert.equal(back.searchParams.get('group'),'2');assert.equal(back.searchParams.get('firstSymbol'),'600001');assert.equal(back.searchParams.get('date'),'2026-11-16');
   }
  }
 });
 const lib=new URL(intelReturnLocation('600009',2,'600001','600009'),'https://test.invalid');
 assert.deepEqual(workbenchRestore(lib.searchParams),{symbol:'600009',group:2,firstSymbol:'600001'});
 nodes(tree).find(n=>n.props?.['aria-label']==='当前联动组')!.props.onChange({target:{value:'1'}});
 tree=h.render(h.exports.Workbench);assert.equal(params.get('symbol'),'600001');assert.equal(params.has('group'),false);
 h.dispose();
});
test('JourneyLink with Calendar source → return link restores original reminder lookup',async()=>{
 let returned='';
 await withRenderer(async r=>{
  const {MemoryRouter}=await r.load('react-router-dom');
  const {JourneyLink}=await r.load('/src/verticals/finance/components/JourneyLink.tsx');
  const {WorkspaceJourney}=await r.load('/src/verticals/finance/components/WorkspaceJourney.tsx');
  const render=(route:string,component:any,props:Record<string,any>={})=>r.html(()=>createElement(MemoryRouter,{initialEntries:[route]},createElement(component,props)),{});
  const next=linkTo(render('/calendar?message=SYNTHETIC-M1&private=secret&unknown=bad',JourneyLink,{to:'/notes',children:'查看研究记录'}),'/notes');
  assert.doesNotMatch(next,/secret|unknown|private/);
  returned=linkTo(render(next,WorkspaceJourney),'/calendar');
  assert.equal(returned,'/calendar?message=SYNTHETIC-M1');
 });
 const calls:string[]=[];
 const h=harness('../src/verticals/finance/pages/CalendarTargets.tsx',{
  'react-router-dom':{useSearchParams:()=>[new URL(returned,'https://test.invalid').searchParams]},
  '../lib/backend':{backend:{calendarReminder:(id:string)=>{calls.push(id);return new Promise(()=>{});}}},
 });
 h.render(h.exports.CalendarTargets,{revision:'test'});assert.deepEqual(calls,['SYNTHETIC-M1']);h.dispose();
});
test('route protocols retain objects and jobs, validate values, never leak unknown or nested fields',()=>{
 for(const path of ['/tasks','/backtest','/debate']){
  const next=new URL(journeyHref('/notes',path,'?job=taskA&private=secret&returnTo=/tasks?job=taskB'),'https://test.invalid');
  assert.equal(next.searchParams.get('returnTo'),`${path}?job=taskA`);
 }
 const observation=new URL(workspaceReturn('/observations?id=O1&thesis=T1&symbol=600000&run=R1&pattern=P1')!,'https://test.invalid');
 for(const [key,value] of Object.entries({id:'O1',thesis:'T1',symbol:'600000',run:'R1',pattern:'P1'}))assert.equal(observation.searchParams.get(key),value);
 assert.equal(workspaceReturn('/watch?job=taskA&message=M1&apiKey=secret&unknown=bad'),'/watch');
 assert.equal(workspaceReturn('/tasks?job=../../other'),'/tasks');
 assert.equal(workspaceReturn('/calendar?message=%20&object=other&kind=thesis'),'/calendar');
 assert.equal(workspaceReturn('/calendar?kind=invalid&object=O1'),'/calendar');
 assert.equal(workspaceReturn('/calendar?kind=thesis&object=O1&due=2026-02-30'),'/calendar');
 assert.equal(workspaceReturn('/calendar?criteria=broken'),'/calendar');
 const targets=Array.from({length:201},(_,i)=>({id:`O${i}`,due:'2026-11-16',private:'secret'}));
 const calendar=new URL(workspaceReturn('/calendar?criteria='+encodeURIComponent(JSON.stringify(targets)))!,'https://test.invalid');
 assert.deepEqual(JSON.parse(calendar.searchParams.get('criteria')!),targets.map(({id,due})=>({id,due})));
 const direct=new URL(workspaceReturn('/calendar?kind=action&object=O1&due=2026-11-16')!,'https://test.invalid');
 assert.equal(direct.searchParams.get('kind'),'action');assert.equal(direct.searchParams.get('object'),'O1');assert.equal(direct.searchParams.get('due'),'2026-11-16');
});

test('task A return drives actual task detail lookup for A',()=>{
 const next=new URL(journeyHref('/notes','/tasks','?job=taskA&private=secret'),'https://test.invalid');
 const back=workspaceReturn(next.searchParams.get('returnTo'))!;
 const calls:string[]=[];
 const never=()=>new Promise(()=>{});
 const h=harness('../src/verticals/finance/pages/Tasks.tsx',{
  'react-router-dom':{useSearchParams:()=>[new URL(back,'https://test.invalid').searchParams,()=>{}]},
  '../lib/backend':{backend:{backgroundJobs:never,sourceHealth:never,backgroundJob:(id:string)=>{calls.push(id);return never();}}},
 });
 h.render(h.exports.Tasks);assert.deepEqual(calls,['taskA']);h.dispose();
});
