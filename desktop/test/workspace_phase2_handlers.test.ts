import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {createElement} from 'react';
import {withRenderer} from './helpers/render.ts';
import * as modes from '../src/verticals/finance/lib/modeStudio.ts';
import * as candidates from '../src/verticals/finance/lib/candidates.ts';
import {recordSource} from '../src/verticals/finance/lib/recordSource.ts';
import {readWorkspaceContext} from '../src/verticals/finance/lib/workspaceContext.ts';
import {journeyHref, workspaceReturn} from '../src/verticals/finance/lib/workspaceJourney.ts';
import {recordSourceHref} from '../src/verticals/finance/lib/recordSource.ts';
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
  runInNewContext(js,{exports,require:req,AbortController,URL,URLSearchParams,setTimeout:(fn:any,ms:number)=>{const timer={fn,ms,cleared:false};dependencies.__timers?.push(timer);return timer;},clearTimeout:(timer:any)=>{if(timer)timer.cleared=true;},setInterval:(fn:any)=>{interval=fn;return 1;},clearInterval(){},Event:class {},window:{dispatchEvent(){},addEventListener(){},removeEventListener(){}},Date,document:dependencies.__document??{getElementById(){return null;},hidden:false,addEventListener(){},removeEventListener(){}}});
  return {exports,remount(){slots=[];effects=[];},poll(){interval?.();},dispose(){effects.forEach(e=>e?.cleanup?.());},render(fn:any,...args:any[]){i=0;pending=[];const out=fn(...args);const work=pending;pending=[];work.forEach(f=>f());return out;}};
}
const tick=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};

function nodes(x:any):any[]{if(!x)return [];if(Array.isArray(x))return x.flatMap(nodes);if(typeof x!=='object')return [];return [x,...nodes(x.props?.children),...nodes(x.props?.actions)];}
function words(x:any):string{if(x==null)return '';if(Array.isArray(x))return x.map(words).join(' ');if(typeof x==='object')return words(x.props?.children);return String(x);}


test('actual ModeStudio record handler persists run and restores that run without latest fallback',async()=>{
 let params=new URLSearchParams('date=2026-11-16');
 const run=(id:string)=>({id,created_at:'2026-11-16T03:00:00Z',combination:{name:id,version:1},rules:[],results:[],samples:[],added:[],removed:[],previous_id:null});
 const data={rules:[],combinations:[],runs:[run('R1'),run('R2')]};
 const h=harness('../src/verticals/finance/pages/ModeStudio.tsx',{
  'react-router-dom':{useSearchParams:()=>[params,(update:any)=>{params=update(params);}]},
  '../lib/backend':{backend:{modeStudio:async()=>data}},'../lib/modeStudio':modes,
 });
 h.render(h.exports.ModeStudio);await tick();h.render(h.exports.ModeStudio);let tree=h.render(h.exports.ModeStudio);
 assert.equal(params.get('run'),'R2');
 nodes(tree).find(n=>n.type==='button'&&/^R1\s+v\s*1/.test(words(n)))!.props.onClick();tree=h.render(h.exports.ModeStudio);
 assert.equal(params.get('run'),'R1');assert.equal(nodes(tree).find(n=>n.props?.run)?.props.run.id,'R1');
 const onward=new URL(journeyHref('/workbench?symbol=600002','/modes',`?${params}`),'https://test.invalid');
 params=new URL(onward.searchParams.get('returnTo')!,'https://test.invalid').searchParams;
 h.dispose();h.remount();h.render(h.exports.ModeStudio);await tick();tree=h.render(h.exports.ModeStudio);assert.equal(nodes(tree).find(n=>n.props?.run)?.props.run.id,'R1');
 params.set('run','deletedRun');tree=h.render(h.exports.ModeStudio);assert.match(words(tree),/原观察快照不存在/);assert.equal(nodes(tree).find(n=>n.props?.run),undefined);h.dispose();
});
test('actual candidate fetch handler → actual row JourneyLink prioritizes row stock and preserves source mode',async()=>{
 const result={universe:{id:'watch',label:'合成范围',size:1,source:'synthetic',as_of:null},quotes:{source:'synthetic',fetched_at:null,cached:false},conditions:[],rows:[{symbol:'600002',name:'合成',verdict:'met',checks:[]}],counts:{met:1,missing:0,unmet:0},generated_at:'',gaps:[]};
 const h=harness('../src/verticals/finance/pages/Candidates.tsx',{
  '@/lib/candidates':candidates,'@/lib/storage':{storageGet:()=>null,storageSet:()=>{}},
  '../hooks/useLocalPreference':{useLocalPreference:()=>({value:[],ready:true,save:()=>{}})},
  '@/lib/backend':{backend:{candidates:async()=>result},ApiError:Error},'@/lib/utils':{cn:()=>''},
 });
 let tree=h.render(h.exports.Candidates);
 const submit=nodes(tree).find(n=>n.type==='form'&&typeof n.props.onSubmit==='function');
 assert.ok(submit);submit.props.onSubmit({preventDefault(){}});await tick();tree=h.render(h.exports.Candidates);
 const rowLink=nodes(tree).find(n=>n.props?.to==='/research?symbol=600002');assert.ok(rowLink);
 await withRenderer(async r=>{
  const {MemoryRouter}=await r.load('react-router-dom');const {JourneyLink}=await r.load('/src/verticals/finance/components/JourneyLink.tsx');
  const html=r.html(()=>createElement(MemoryRouter,{initialEntries:['/candidates?symbol=600001&pattern=P1&mode=M1&version=2&date=2026-11-16']},createElement(JourneyLink,rowLink.props)),{});
  const target=new URL(html.match(/href="([^"]+)"/)![1]!.replaceAll('&amp;','&'),'https://test.invalid');assert.equal(target.searchParams.get('symbol'),'600002');
  const source=new URL(target.searchParams.get('returnTo')!,'https://test.invalid');assert.equal(source.searchParams.get('mode'),'M1');assert.equal(source.searchParams.get('pattern'),'P1');assert.equal(source.searchParams.get('version'),'2');
 });h.dispose();
});

test('actual daily-review save props and SaveNote handler retain report day after page business day changes',async()=>{
 const source=readFileSync(new URL('../src/verticals/finance/pages/DailyReview.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('DailyReview.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let button:ts.JsxSelfClosingElement|undefined;
 const visit=(node:ts.Node)=>{if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(ast)==='SaveNoteButton')button=node;ts.forEachChild(node,visit);};visit(ast);assert.ok(button);
 const compiled=ts.transpileModule(`const captured=${button.getText(ast)}; exports.captured=captured;`,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const captured:any={};runInNewContext(compiled,{exports:captured,require:()=>({jsx:(_type:any,props:any)=>props}),SaveNoteButton:()=>{},reviewDay:'2026-11-13',bizDay:'2026-11-16',review:'合成复盘正文'});
 const requests:any[]=[];
 const h=harness('../src/verticals/finance/components/ui/SaveNoteButton.tsx',{
  'react-router-dom':{useLocation:()=>({pathname:'/daily-review',search:'?date=2026-11-16',hash:''})},
  '@/lib/notes':{addNote:async(...args:any[])=>{requests.push(args);},canSaveNoteSource:()=>true},
  '../../lib/recordSource':{recordSource},'../../lib/workspaceContext':{readWorkspaceContext},
 });
 const tree=h.render(h.exports.SaveNoteButton,captured.captured);await nodes(tree).find(n=>n.type==='button')!.props.onClick();
 assert.equal(requests.length,1);assert.equal(requests[0][3].date,'2026-11-13');assert.equal(requests[0][3].page,'/shortline');assert.match(requests[0][1],/2026-11-13/);h.dispose();
});

test('Notes 失效记录清除筛选后恢复全部，同时保留来源且不自动打开另一条',async()=>{
 let params=new URLSearchParams('id=deletedA&date=2026-11-16&returnTo=%2Ftasks%3Fjob%3Djob-1&source=%2Ftasks');
 const records=[{id:'noteB',kind:'回测',title:'保留记录 B',content:'正文 B',ts:1}];
 const h=harness('../src/verticals/finance/pages/Notes.tsx',{
  'react-router-dom':{useSearchParams:()=>[params,(update:any)=>{params=typeof update==='function'?update(params):update;}],Link:()=>null},
  '@/lib/notes':{hydrateNotes:async()=>{},loadNotes:()=>records},
  '@/hooks/usePrivacyMode':{usePrivacyMode:()=>({on:false})},'../../../core/ai/pageContext':{useAiPage:()=>{}},
  '../lib/workspaceJourney':{workspaceReturn},'../lib/recordSource':{recordSourceHref},
 });
 h.render(h.exports.Notes);await tick();let tree=h.render(h.exports.Notes);
 assert.match(words(tree),/原记录已删除/);assert.doesNotMatch(words(tree),/保留记录 B/);
 const clear=nodes(tree).find(n=>n.type==='button'&&words(n)==='清除筛选');assert.ok(clear);clear.props.onClick();
 tree=h.render(h.exports.Notes);
 assert.equal(params.has('id'),false);assert.equal(params.get('date'),'2026-11-16');assert.equal(params.get('returnTo'),'/tasks?job=job-1');assert.equal(params.get('source'),'/tasks');
 assert.match(words(tree),/保留记录 B/);assert.doesNotMatch(words(tree),/原记录已删除/);
 const row=nodes(tree).find(n=>n.type==='button'&&words(n).includes('保留记录 B'));assert.equal(row?.props['aria-expanded'],false);
 params.set('id','noteB');tree=h.render(h.exports.Notes);tree=h.render(h.exports.Notes);
 assert.equal(nodes(tree).find(n=>n.type==='button'&&words(n).includes('保留记录 B'))?.props['aria-expanded'],true);
 h.dispose();
});

test('Notes 行动以记录日期为目标，保留当前记录作为返回来源',async()=>{
 const params=new URLSearchParams('id=noteA&date=2026-11-17');
 const record:any={id:'noteA',kind:'回测',title:'合成记录',content:'正文',ts:1,symbol:'600519',source:{page:'/shortline',date:'2026-11-16'}};
 const h=harness('../src/verticals/finance/pages/Notes.tsx',{
  'react-router-dom':{useSearchParams:()=>[params,()=>{}],Link:()=>null},
  '@/lib/notes':{hydrateNotes:async()=>{},loadNotes:()=>[record]},
  '@/hooks/usePrivacyMode':{usePrivacyMode:()=>({on:false})},'../../../core/ai/pageContext':{useAiPage:()=>{}},
  '../lib/workspaceJourney':{workspaceReturn},'../lib/recordSource':{recordSourceHref},
 });
 h.render(h.exports.Notes);await tick();let tree=h.render(h.exports.Notes);tree=h.render(h.exports.Notes);
 await withRenderer(async r=>{
  const {MemoryRouter}=await r.load('react-router-dom');const {JourneyLink}=await r.load('/src/verticals/finance/components/JourneyLink.tsx');
  const verify=(expected:string|null)=>{
   const links=nodes(tree).filter(n=>typeof n.props?.to==='string' && (/^\/(?:research|observations)\?/.test(n.props.to)));
   assert.equal(links.length,2);
   for(const link of links){
    const html=r.html(()=>createElement(MemoryRouter,{initialEntries:['/notes?id=noteA&date=2026-11-17']},createElement(JourneyLink,link.props)),{});
    const dest=new URL(html.match(/href="([^"]+)"/)![1]!.replaceAll('&amp;','&'),'https://test.invalid');
    assert.equal(dest.searchParams.get('date'),expected);assert.equal(dest.searchParams.get('symbol'),'600519');
    const back=new URL(dest.searchParams.get('returnTo')!,'https://test.invalid');
    assert.equal(back.pathname,'/notes');assert.equal(back.searchParams.get('id'),'noteA');assert.equal(back.searchParams.get('date'),'2026-11-17');
   }
  };
  verify('2026-11-16');
  delete record.source;tree=h.render(h.exports.Notes);verify(null);
 });
 h.dispose();
});
