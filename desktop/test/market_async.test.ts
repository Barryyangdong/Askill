import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import { chartRequest, ChartCache, currentChart, looksLikeAShare } from "../src/verticals/finance/lib/chartRequest.ts";
import { mergePolledQuotes, quoteFailure, quoteSnapshotTime } from "../src/verticals/finance/lib/quoteSnapshot.ts";

function deferred(){ let resolve:any, reject:any; const promise=new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; }
function harness(path:string, dependencies:Record<string,any>) {
  let slots:any[]=[], i=0, effects:any[]=[], pending:any[]=[];
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
  runInNewContext(js,{exports,require:req,AbortController,setTimeout,clearTimeout,Date,document:{hidden:false,addEventListener(){},removeEventListener(){}}});
  return {exports,render(fn:any,...args:any[]){i=0;pending=[];const out=fn(...args);const work=pending;pending=[];work.forEach(f=>f());return out;}};
}
const tick=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};

test('实际报价 hook：名单立即替换在途请求，旧完成不改状态，时间仅取可见报价',async()=>{
 const calls:any[]=[];
 const h=harness('../src/verticals/finance/hooks/useLiveQuotes.ts',{
  '@/lib/api':{api:{quote:(codes:string)=>{const d=deferred();calls.push({codes,...d});return d.promise;}}},
  '@/lib/marketSymbol':{isAnyMarketTrading:()=>false,tradingMarketSymbols:(x:any)=>x},
  '@/lib/pollLoop':{startPollLoop:()=>({stop(){},kick(){}})},
  '@/lib/quoteSnapshot':{mergePolledQuotes,quoteFailure,quoteSnapshotTime},
 });
 const use=h.exports.useLiveQuotes; const a=['600519','AAPL']; const b=['600519'];
 h.render(use,a,false); assert.equal(calls.length,1);
 calls[0].resolve({'600519':{price:1,fetched_at:'2026-01-02T00:00:00Z'},AAPL:{price:2,fetched_at:'2026-01-01T00:00:00Z'}}); await tick();
 let v=h.render(use,a,false); assert.equal(v.updatedAt,Date.parse('2026-01-01T00:00:00Z'));
 v.refresh(); assert.equal(calls.length,2);
 v=h.render(use,b,false); assert.equal(calls.length,3); assert.equal(v.updatedAt,Date.parse('2026-01-02T00:00:00Z'));
 v=h.render(use,b,false); assert.equal(v.loading,true);
 calls[1].resolve({'600519':{price:99,fetched_at:'2026-01-03T00:00:00Z'}}); await tick();
 v=h.render(use,b,false); assert.equal(v.loading,true); assert.notEqual(v.settled,'600519'); assert.equal(v.quotes['600519'].price,1);
 calls[2].resolve({'600519':{price:3,fetched_at:'2026-01-04T00:00:00Z'}}); await tick();
 v=h.render(use,b,false); assert.equal(v.loading,false); assert.equal(v.settled,'600519'); assert.equal(v.quotes['600519'].price,3);
 v.refresh(); v.refresh(); assert.equal(calls.length,4); calls[3].resolve({}); await tick(); assert.equal(calls.length,5); calls[4].resolve({}); await tick();
});

test('实际 K 线组件：回看切美股周线再回 A 股可操作且请求一致',async()=>{
 const calls:any[]=[];
 const h=harness('../src/verticals/finance/components/KlineCard.tsx',{
  '@/lib/backend':{ApiError:Error,backend:{runTool:(_tool:any,body:any,signal:any,policy:any)=>{const d=deferred();calls.push({body,signal,policy,...d});return d.promise;}}},
  '../lib/chartRequest':{chartRequest,ChartCache,currentChart,looksLikeAShare},
  '@/lib/klineView':{parseKline:()=>({ok:false,error:'合成失败'}),klineOption:()=>({})},
  '@/components/ui/chartPalette':{usePalette:()=>({})},
  '../hooks/useLocalPreference':{useLocalPreference:()=>({value:{lines:[],template:'ma'},ready:true})},
  '../hooks/usePrivacyMode':{usePrivacyMode:()=>({on:false})},
  '../lib/chartEvents':{chartEvents:()=>[]},
  '../lib/chartAnnotations':{visibleChartLines:()=>[],parseChartSettings:()=>({})},
 });
 const C=h.exports.KlineCard;
 const nodes=(root:any):any[]=>{if(!root||typeof root!=='object')return [];if(Array.isArray(root))return root.flatMap(nodes);return [root,...nodes(root.props?.children)];};
 const render=(symbol:string)=>h.render(C,{symbol});
 let tree=render('600519'); assert.equal(calls[0].policy,'prefer'); calls[0].resolve({}); await tick(); tree=render('600519');
 nodes(tree).find(n=>n.type==='button'&&n.props['aria-label']==='刷新 K 线').props.onClick();
 tree=render('600519'); assert.equal(calls.at(-1).policy,'fresh'); calls.at(-1).resolve({}); await tick(); tree=render('600519');
 let replay=nodes(tree).find(n=>n.type==='button'&&n.props.children==='逐日回看'); assert.ok(replay); replay.props.onClick();
 tree=render('600519'); assert.ok(nodes(tree).some(n=>n.type==='button'&&n.props.children==='退出回看'));
 tree=render('AAPL'); assert.equal(calls.at(-1).body.period,'day');
 const toggle=nodes(tree).find(n=>n.props?.label==='周期'); toggle.props.onChange('week');
 tree=render('AAPL'); assert.equal(calls.at(-1).body.period,'week');
 tree=render('600519'); const period=nodes(tree).find(n=>n.props?.label==='周期');
 assert.equal(period.props.value,'week'); assert.equal(period.props.disabled,false); assert.equal(calls.at(-1).body.period,'week');
 assert.ok(nodes(tree).some(n=>n.type==='button'&&n.props.children==='逐日回看'));
 calls.at(-1).resolve({}); await tick();
});
