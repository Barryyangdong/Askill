import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
function deferred(){ let resolve:any, reject:any; const promise=new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; }
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
  runInNewContext(js,{exports,require:req,AbortController,URLSearchParams,setTimeout:(fn:any,ms:number)=>{const timer={fn,ms,cleared:false};dependencies.__timers?.push(timer);return timer;},clearTimeout:(timer:any)=>{if(timer)timer.cleared=true;},setInterval:(fn:any)=>{interval=fn;return 1;},clearInterval(){},Event:class {},window:{dispatchEvent(){},addEventListener(){},removeEventListener(){}},Date,navigator:dependencies.__navigator,document:dependencies.__document??{getElementById(){return null;},hidden:false,addEventListener(){},removeEventListener(){}}});
  return {exports,remount(){slots=[];effects=[];},poll(){interval?.();},dispose(){effects.forEach(e=>e?.cleanup?.());},render(fn:any,...args:any[]){i=0;pending=[];const out=fn(...args);const work=pending;pending=[];work.forEach(f=>f());return out;}};
}
const tick=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};

function nodes(x:any):any[]{if(!x)return [];if(Array.isArray(x))return x.flatMap(nodes);if(typeof x!=='object')return [];return [x,...nodes(x.props?.children),...nodes(x.props?.actions)];}
function words(x:any):string{if(x==null)return '';if(Array.isArray(x))return x.map(words).join(' ');if(typeof x==='object')return words(x.props?.children);return String(x);}

test('慢存档不能覆盖手动成功，离开不再刷新',async()=>{
 const archive=deferred(), fresh=deferred();let calls:boolean[]=[];const h=harness('../src/core/data/useArchiveThenRefresh.ts',{});const load=(refresh:boolean)=>{calls.push(refresh);return refresh?fresh.promise:archive.promise;};
 let out=h.render(h.exports.useArchiveThenRefresh,load,[]);out.refresh();fresh.resolve({value:'new'});await tick();archive.resolve({value:'old'});await tick();out=h.render(h.exports.useArchiveThenRefresh,load,[]);assert.equal(out.data.value,'new');assert.deepEqual(calls,[false,true]);h.dispose();
 const pending=deferred();calls=[];const h2=harness('../src/core/data/useArchiveThenRefresh.ts',{});h2.render(h2.exports.useArchiveThenRefresh,(r:boolean)=>{calls.push(r);return pending.promise;},[]);h2.dispose();pending.resolve({});await tick();assert.deepEqual(calls,[false]);
});
test('手动失败后迟到存档显示过时提示',async()=>{
 const archive=deferred(),fresh=deferred();const h=harness('../src/core/data/useArchiveThenRefresh.ts',{});const load=(r:boolean)=>r?fresh.promise:archive.promise;let out=h.render(h.exports.useArchiveThenRefresh,load,[]);out.refresh();fresh.reject(Error('offline'));await tick();archive.resolve({value:'old'});await tick();out=h.render(h.exports.useArchiveThenRefresh,load,[]);assert.equal(out.data.value,'old');assert.match(out.staleNote,/刷新没成功/);assert.equal(out.err,null);h.dispose();
});
test('随身任务挂起超时并重试，旧响应不能覆盖',async()=>{
 const timers:any[]=[], requests:any[]=[];const doc={visibilityState:'visible'};const backend={backgroundJobs:(signal:AbortSignal)=>{const d=deferred();requests.push({signal,...d});return d.promise;}};
 const h=harness('../src/verticals/finance/pages/Companion.tsx',{'../lib/backend':{backend},'../hooks/usePrivacyMode':{usePrivacyMode:()=>({on:false})},__timers:timers,__document:doc});
 let tree=h.render(h.exports.Companion);assert.equal(requests.length,1);timers.find(t=>t.ms===12000&&!t.cleared).fn();assert.equal(requests[0].signal.aborted,true);tree=h.render(h.exports.Companion);assert.match(words(tree),/超时/);nodes(tree).find(n=>n.type==='button'&&words(n)==='刷新研究任务').props.onClick();assert.equal(requests.length,2);requests[1].resolve([{id:'new',title:'新',status:'running'}]);await tick();requests[0].resolve([{id:'old',title:'旧',status:'running'}]);await tick();tree=h.render(h.exports.Companion);const card=nodes(tree).find(n=>n.type===h.exports.CompanionJobs);assert.equal(card.props.jobs[0].id,'new');h.dispose();
});
test('复制完成迟到不显示到另一提示词',async()=>{
 const pending=deferred();const h=harness('../src/verticals/finance/pages/SectorDetail.tsx',{__navigator:{clipboard:{writeText:()=>pending.promise}}});
 // navigator is provided by the harness below.
 const a={n:1,title:'A',prompt:'A prompt'},b={n:1,title:'B',prompt:'B prompt'};let tree=h.render(h.exports.StepCard,{step:a,onSend:null});nodes(tree).find(n=>n.type==='button').props.onClick();h.render(h.exports.StepCard,{step:b,onSend:null});pending.resolve();await tick();tree=h.render(h.exports.StepCard,{step:b,onSend:null});assert.doesNotMatch(words(tree),/已复制/);h.dispose();
});
test('首次 GPU 读取不会显示已确认空态',()=>{
 const h=harness('../src/verticals/finance/pages/Signals.tsx',{'react-router-dom':{useParams:()=>({}),useNavigate:()=>()=>{}},'../../../core/data/useArchiveThenRefresh':{useArchiveThenRefresh:()=>({data:null,err:null,loading:true,refreshing:false,staleNote:null,refresh:()=>{}})},'@/lib/utils':{cn:()=>''}});
 const page = h.render(h.exports.Signals);
 const panel = nodes(page).find(n => typeof n.type === 'function' && n.type.name === 'GpuRentPanel');
 assert.ok(panel);
 const tree = h.render(panel.type);
 const status = nodes(tree).find(n => n.props.role === 'status');
 assert.match(words(status), /正在取数据/);
 assert.doesNotMatch(words(tree), /还没有抓取数据|还没有存档/);
 h.dispose();
});
test('随身任务已成功后挂起保留旧结果并可恢复',async()=>{
 const timers:any[]=[],requests:any[]=[];const h=harness('../src/verticals/finance/pages/Companion.tsx',{'../lib/backend':{backend:{backgroundJobs:(signal:AbortSignal)=>{const d=deferred();requests.push({signal,...d});return d.promise;}}},'../hooks/usePrivacyMode':{usePrivacyMode:()=>({on:false})},__timers:timers,__document:{visibilityState:'visible'}});
 h.render(h.exports.Companion);requests[0].resolve([{id:'old',title:'旧',status:'running'}]);await tick();timers.filter(t=>t.ms===5000&&!t.cleared).at(-1).fn();timers.filter(t=>t.ms===12000&&!t.cleared).at(-1).fn();let tree=h.render(h.exports.Companion);assert.match(words(tree),/超时/);assert.equal(nodes(tree).find(n=>n.type===h.exports.CompanionJobs).props.jobs[0].id,'old');nodes(tree).find(n=>n.type==='button'&&words(n)==='刷新研究任务').props.onClick();requests[2].resolve([{id:'new',title:'新',status:'completed'}]);await tick();tree=h.render(h.exports.Companion);assert.equal(nodes(tree).find(n=>n.type===h.exports.CompanionJobs).props.jobs[0].id,'new');h.dispose();
});
