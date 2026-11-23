import {createElement} from 'react';
import * as calendar from '../src/verticals/finance/lib/calendar.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {reminderTarget} from '../src/verticals/finance/lib/reminderTarget.ts';
import {reviewNavigation} from '../src/verticals/finance/lib/reviewNavigation.ts';
import {withRenderer,textOf} from './helpers/render.ts';
import * as reviewCache from '../src/verticals/finance/shortline/reviewCache.ts';
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
  runInNewContext(js,{exports,require:req,AbortController,URLSearchParams,setTimeout:(fn:any,ms:number)=>{const timer={fn,ms,cleared:false};dependencies.__timers?.push(timer);return timer;},clearTimeout:(timer:any)=>{if(timer)timer.cleared=true;},setInterval:(fn:any)=>{interval=fn;return 1;},clearInterval(){},Event:class {},window:{dispatchEvent(){},addEventListener(){},removeEventListener(){}},Date,document:dependencies.__document??{getElementById(){return null;},hidden:false,addEventListener(){},removeEventListener(){}}});
  return {exports,remount(){slots=[];effects=[];},poll(){interval?.();},dispose(){effects.forEach(e=>e?.cleanup?.());},render(fn:any,...args:any[]){i=0;pending=[];const out=fn(...args);const work=pending;pending=[];work.forEach(f=>f());return out;}};
}
const tick=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};

function nodes(x:any):any[]{if(!x)return [];if(Array.isArray(x))return x.flatMap(nodes);if(typeof x!=='object')return [];return [x,...nodes(x.props?.children),...nodes(x.props?.actions)];}
function words(x:any):string{if(x==null)return '';if(Array.isArray(x))return x.map(words).join(' ');if(typeof x==='object')return words(x.props?.children);return String(x);}
const overview=(unread:number,title='合成提醒')=>({inbox:{total:1,unread,items:[{id:'m',title,read:!unread,lines:['原消息'],at:'',kind:'message'}]},jobs:[],settings:{quiet:{enabled:false,from:'22:00',to:'07:00'},webhooks:[]},scheduler:{}});
test('旧摘要仅取标题业务日，盘前区分提醒日与样本日，缺失不猜',()=>{
 assert.equal(reminderTarget({title:'收盘摘要 2026-11-16',lines:[],link:'/daily-review'}).link,'/shortline?date=2026-11-16&reminder=close');
 const p=reminderTarget({title:'盘前提醒 2026-11-17',lines:['2026-11-16 连板 2 只'],link:'/shortline'});assert.match(p.link!,/date=2026-11-16/);assert.match(p.link!,/reminderDay=2026-11-17/);
 assert.equal(reminderTarget({title:'旧摘要',lines:[],link:'/daily-review'}).link,undefined);
 assert.equal(reminderTarget({title:'盘前提醒 2026-11-17',lines:[],link:'/shortline'}).link,undefined);
});
test('情绪页实际日期处理器：选日、清空和回默认均退出提醒上下文，普通浏览不新增标记',()=>{
 for (const reminder of ['premarket','close','']) for (const action of ['pick','clear','default']) {
  let params=new URLSearchParams({date:'2026-11-16',keep:'unchanged',...(reminder?{reminder,reminderDay:'2026-11-17'}:{})});
  const h=harness('../src/verticals/finance/pages/Shortline.tsx',{
   'react-router-dom':{useLocation:()=>({state:null}),useNavigate:()=>()=>{},useParams:()=>({}),useSearchParams:()=>[params,(update:any)=>{params=update(params);}]},
   '@/shortline/api':{LOADING:{state:'loading'},badDayReason:()=>null,loadEmotion:()=>new Promise(()=>{})},
  });
  const first=h.render(h.exports.Shortline);if(reminder)assert.match(words(first),/2026-11-16/);
  const Workspace=nodes(first).find(n=>typeof n.type==='function')!.type;
  const workspace=h.render(Workspace);
  if(action==='default')nodes(workspace).find(n=>n.type==='button'&&/回到默认/.test(words(n)))!.props.onClick();
  else nodes(workspace).find(n=>n.type==='input'&&n.props.type==='date')!.props.onChange({target:{value:action==='pick'?'2026-11-13':''}});
  assert.equal(params.get('date'),action==='pick'?'2026-11-13':null);
  assert.equal(params.get('reminder'),null);assert.equal(params.get('reminderDay'),null);assert.equal(params.get('keep'),'unchanged');
  assert.doesNotMatch(words(h.render(h.exports.Shortline)),/收盘摘要业务日|前一交易日样本|null/);h.dispose();
 }
});
test('页面内返回只认收件箱导航 state；外部或伪造查询参数走安全首页',()=>{
 for(const state of [{inboxReturn:{source:'inbox-message',key:'original'}},null,{inboxReturn:{source:'other',key:'original'}}]){
  const calls:any[]=[];const params=new URLSearchParams('date=2026-11-16&reminder=close&inboxReturn=original');
  const h=harness('../src/verticals/finance/pages/Shortline.tsx',{'react-router-dom':{useLocation:()=>({state}),useSearchParams:()=>[params],useNavigate:()=>((target:any)=>calls.push(target))}});
  const tree=h.render(h.exports.Shortline);nodes(tree).find(n=>n.type==='button'&&words(n)==='返回提醒')!.props.onClick();
  assert.deepEqual(calls,[state?.inboxReturn.source==='inbox-message'?-1:'/inbox']);h.dispose();
 }
});
test('提醒连续两次分页替换同一详情项再返回原收件箱；外部和普通分页仍追加历史',()=>{
 for(const scenario of ['inbox','external','ordinary']) {
  const source={inboxReturn:{source:'inbox-message',key:'original'}};
  const search=`?date=2026-11-16${scenario==='ordinary'?'':'&reminder=close'}`;
  const history:any[]=[{key:'original',pathname:scenario==='external'?'/outside':'/inbox',search:'',state:null},{key:'detail',pathname:'/shortline',search,state:scenario==='external'?null:source}];
  const calls:any[]=[];
  const navigate=(target:any,options:any)=>{
   calls.push({target,options});
   if(typeof target==='number'){assert.equal(target,-1);history.pop();return;}
   const next={key:`nav-${calls.length}`,pathname:typeof target==='string'?target:target.pathname,search:typeof target==='string'?'':target.search,state:options?.state??null};
   if(options?.replace)history[history.length-1]=next;else history.push(next);
  };
  const h=harness('../src/verticals/finance/pages/Shortline.tsx',{
   'react-router-dom':{useLocation:()=>history.at(-1),useNavigate:()=>navigate,useParams:()=>({tab:history.at(-1).pathname.split('/')[2]}),useSearchParams:()=>[new URLSearchParams(history.at(-1).search),()=>{}]},
   '@/shortline/api':{LOADING:{state:'loading'},badDayReason:()=>null,loadEmotion:()=>new Promise(()=>{})},
  });
  for(const tab of ['weekly','verify']) {
   const current = history.at(-1);
   const {to, replace, state} = reviewNavigation('/shortline/'+tab, current.search, current.state);
   assert.match(to.search, /date=2026-11-16/);
   navigate(to, {replace, state});
  }
  assert.equal(history.length,scenario==='inbox'?2:4);
  assert.deepEqual(calls.map(c=>c.options?.replace),scenario==='inbox'?[true,true]:[false,false]);
  if(scenario==='inbox')assert.equal(history.at(-1).state,source);
  const page=h.render(h.exports.Shortline);const back=nodes(page).find(n=>n.type==='button'&&words(n)==='返回提醒');
  if(scenario==='ordinary')assert.equal(back,undefined);
  else {back!.props.onClick();assert.equal(history.at(-1).pathname,'/inbox');assert.equal(calls.at(-1).target,scenario==='inbox'?-1:'/inbox');if(scenario==='inbox')assert.equal(history.at(-1).key,'original');}
  h.dispose();
 }
});
test('切换复盘主入口保留业务日、股票和来源，清除题材页的局部状态', () => {
 const {to} = reviewNavigation('/shortline/weekly','?date=2026-11-20&symbol=600001&theme=%E8%8A%AF%E7%89%87&sampleDate=2026-11-19&themeView=manage&themeId=1');
 assert.deepEqual(to, {pathname:'/shortline/weekly', search:'?date=2026-11-20&symbol=600001'});
});
test('旧摘要目的地实际请求固定业务日，默认日变更不影响；历史缺失可读错误',async()=>{
 const calls:any[]=[];let missing=false;
 const h=harness('../src/verticals/finance/shortline/api.ts',{'./reviewCache':reviewCache,'@/lib/backend':{backend:{page:async(query:string,opts:any)=>{calls.push([query,opts]);return {context:{review_date:'2026-11-20'},blocks:[{id:'emotion',status:missing?'failed':'ok',error:missing?'历史数据缺失':undefined,envelope:{extra:{result:{date:'2026-11-16'}}}}]};}}}});
 const target=reminderTarget({title:'收盘摘要 2026-11-16',lines:[],link:'/daily-review'});const date=new URL(target.link!,'http://local').searchParams.get('date')!;
 const result=await h.exports.loadEmotion({date});assert.equal(result.head.day,date);assert.equal(calls[0][1].blockArgs.emotion.date,date);assert.equal(result.defaultDay,'2026-11-20');
 await h.exports.loadBlocks('shortline_facts',['facts','themes'],date,false);assert.equal(calls[1][1].blockArgs.facts.date,date);
 await h.exports.loadEmotion({date});assert.equal(calls.length,2,'返回同一日期直接复用成功数据');
 missing=true;const unavailable=await h.exports.loadEmotion({date,refresh:true});assert.equal(unavailable.head.day,date);assert.equal(unavailable.emotion.result,null);assert.match(unavailable.emotion.why,/历史数据缺失/);
 await h.exports.loadEmotion({date});assert.equal(calls.length,4,'缺失的数据可再次请求');
});
test('目标集合按 ID 核对，同股已裁决、改期及删除均不误选',async()=>{
 const params=new URLSearchParams({criteria:JSON.stringify([{id:'A',due:'2026-11-16'},{id:'B',due:'2026-11-17'},{id:'deleted',due:'2026-11-17'}])});
 const read=deferred();const calls:any[]=[];
 const h=harness('../src/verticals/finance/pages/CalendarTargets.tsx',{'react-router-dom':{useSearchParams:()=>[params]},'../lib/backend':{backend:{calendarObjects:(kind:string,ids:string[])=>{calls.push([kind,ids]);return read.promise;}}}});
 const render=()=>h.render(h.exports.CalendarTargets,{revision:'1'});render();read.resolve({records:[{id:'A',symbol:'600000',status:'met',due:'2026-11-16',statement:'第一条'},{id:'B',symbol:'600000',status:'pending',due:'2026-11-20',statement:'第二条'}]});await tick();const tree=render();assert.match(words(tree),/已裁决/);assert.match(words(tree),/已改期/);assert.match(words(tree),/已删除或无法定位/);assert.equal(nodes(tree).filter(n=>n.type==='a').length,0);assert.equal(JSON.stringify(calls),JSON.stringify([['criterion',['A','B','deleted']]]));h.dispose();
});
test('短消息入口枚举全部 201 项并按 200 分批；清空不回退别条，旧无关联消息可读',async()=>{
 const params=new URLSearchParams({message:'message-1',criteria:JSON.stringify([{id:'wrong',due:'2026-11-17'}])});
 const targets=Array.from({length:201},(_,i)=>({id:`criterion-${i}`,due:i%2?'2026-11-16':'2026-11-17'}));
 const calls:string[][]=[];const h=harness('../src/verticals/finance/pages/CalendarTargets.tsx',{'react-router-dom':{useSearchParams:()=>[params]},'../lib/backend':{backend:{calendarReminder:async(id:string)=>id==='message-1'?{status:'ok',targets,message:{title:'原提醒',lines:['原消息正文']}}:id==='missing'?{status:'missing',targets:[],message:null}:{status:'unlinked',targets:[],message:{title:'旧消息',lines:['仍可阅读的原文']}},calendarObjects:async(_kind:string,ids:string[])=>{calls.push(ids);return {records:ids.map(id=>({id,status:'pending',statement:id,due:targets.find(t=>t.id===id)!.due}))};}}}});
 const render=()=>h.render(h.exports.CalendarTargets,{revision:'1'});render();await tick();render();await tick();let tree=render();assert.deepEqual(calls.map(x=>x.length),[200,1]);assert.equal(nodes(tree).filter(n=>n.type==='article').length,201);assert.match(words(tree),/criterion-200/);assert.match(words(tree),/原消息正文/);assert.doesNotMatch(words(tree),/wrong/);
 params.set('message','missing');render();await tick();tree=render();assert.match(words(tree),/已清空/);assert.equal(nodes(tree).filter(n=>n.type==='article').length,0);assert.equal(calls.length,2);
 params.set('message','old');render();await tick();tree=render();assert.match(words(tree),/仍可阅读的原文/);assert.match(words(tree),/没有可校验/);h.dispose();
});
test('实际收件箱：重试、驻留刷新、补读迟到不覆盖已读、刷新失败保留快照',async()=>{
 const reads:any[]=[],writes:any[]=[];
 const h=harness('../src/verticals/finance/pages/Inbox.tsx',{'react-router-dom':{useLocation:()=>({key:'inbox'}),useNavigationType:()=>'POP'},'@/lib/backend':{ApiError:Error,backend:{notify:()=>{const d=deferred();reads.push(d);return d.promise;},notifyAction:()=>{const d=deferred();writes.push(d);return d.promise;}}},'../lib/reminderTarget':{reminderTarget},'@/lib/notify':{formatInboxTime:()=>'',WEBHOOK_KINDS:[]}});
 const render=()=>h.render(h.exports.Inbox);const button=(tree:any,label:string)=>nodes(tree).find(n=>n.type==='button'&&words(n)===label);let tree=render();reads[0].reject(Error('offline'));await tick();tree=render();assert.match(words(tree),/offline/);
 button(tree,'刷新消息 / 重试读取').props.onClick();reads[1].resolve(overview(1));await tick();tree=render();assert.match(words(tree),/合成提醒/);
 h.poll();reads[2].resolve(overview(1,'新增消息'));await tick();tree=render();assert.match(words(tree),/新增消息/);
 button(tree,'标为已读').props.onClick();writes[0].reject(Error('write failed'));await tick();tree=render();assert.match(words(tree),/write failed/);
 button(tree,'标为已读').props.onClick();writes[1].resolve(overview(0,'成功已读'));await tick();reads[3].resolve(overview(1,'过时快照'));await tick();tree=render();assert.match(words(tree),/成功已读/);assert.doesNotMatch(words(tree),/过时快照/);
 h.poll();reads[4].reject(Error('refresh failed'));await tick();tree=render();assert.match(words(tree),/尚未更新/);assert.match(words(tree),/成功已读/);h.dispose();
});
test('慢 GET 跨三个轮询周期仍可落地；写入失效旧读后新读不被旧 finally 解锁',async()=>{
 const reads:any[]=[],writes:any[]=[];
 const h=harness('../src/verticals/finance/pages/Inbox.tsx',{'react-router-dom':{useLocation:()=>({key:'inbox'}),useNavigationType:()=>'POP'},'@/lib/backend':{ApiError:Error,backend:{notify:()=>{const d=deferred();reads.push(d);return d.promise;},notifyAction:()=>{const d=deferred();writes.push(d);return d.promise;}}},'../lib/reminderTarget':{reminderTarget},'@/lib/notify':{formatInboxTime:()=>'',WEBHOOK_KINDS:[]}});
 const render=()=>h.render(h.exports.Inbox);render();h.poll();h.poll();h.poll();assert.equal(reads.length,1);
 reads[0].resolve(overview(1,'慢首屏成功'));await tick();let tree=render();assert.match(words(tree),/慢首屏成功/);
 h.poll();h.poll();h.poll();assert.equal(reads.length,2);
 nodes(tree).find(n=>n.type==='button'&&words(n)==='标为已读')!.props.onClick();writes[0].resolve(overview(0,'写入成功'));await tick();
 h.poll();assert.equal(reads.length,3);reads[1].resolve(overview(1,'作废旧读'));await tick();h.poll();h.poll();assert.equal(reads.length,3);
 reads[2].resolve(overview(0,'慢刷新成功'));await tick();tree=render();assert.match(words(tree),/慢刷新成功/);assert.doesNotMatch(words(tree),/作废旧读/);h.dispose();
});
test('首个 GET 永不返回时显式重试取消并替换；作废请求不阻止后续读取',async()=>{
 const reads:any[]=[],signals:AbortSignal[]=[];
 const h=harness('../src/verticals/finance/pages/Inbox.tsx',{'react-router-dom':{useLocation:()=>({key:'inbox'}),useNavigationType:()=>'POP'},'@/lib/backend':{ApiError:Error,backend:{notify:(signal:AbortSignal)=>{signals.push(signal);const d=deferred();reads.push(d);return d.promise;}}},'../lib/reminderTarget':{reminderTarget},'@/lib/notify':{formatInboxTime:()=>'',WEBHOOK_KINDS:[]}});
 const render=()=>h.render(h.exports.Inbox);let tree=render();h.poll();h.poll();h.poll();assert.equal(reads.length,1);
 nodes(tree).find(n=>n.type==='button'&&words(n)==='刷新消息 / 重试读取')!.props.onClick();assert.equal(reads.length,2);assert.equal(signals[0].aborted,true);
 // The first fake deliberately ignores cancellation and never resolves.
 reads[1].resolve(overview(1,'手动恢复成功'));await tick();tree=render();assert.match(words(tree),/手动恢复成功/);
 h.poll();assert.equal(reads.length,3);assert.equal(signals[2].aborted,false);h.dispose();assert.equal(signals[2].aborted,true);
});
test('读取超过一分钟截止后显示超时，可在下一轮重新读取',async()=>{
 const timers:any[]=[],reads:any[]=[];
 const h=harness('../src/verticals/finance/pages/Inbox.tsx',{
  __timers:timers,'react-router-dom':{useLocation:()=>({key:'inbox'}),useNavigationType:()=>'POP'},
  '@/lib/backend':{ApiError:Error,backend:{notify:(signal:AbortSignal)=>{const d=deferred();signal.addEventListener('abort',()=>d.reject(signal.reason));reads.push(d);return d.promise;}}},
  '../lib/reminderTarget':{reminderTarget},'@/lib/notify':{formatInboxTime:()=>'',WEBHOOK_KINDS:[]},
 });
 const render=()=>h.render(h.exports.Inbox);render();const deadline=timers.find(t=>t.ms===60000);assert.ok(deadline);deadline.fn();await tick();let tree=render();assert.match(words(tree),/消息读取超时/);assert.equal(deadline.cleared,true);
 h.poll();reads[1].resolve(overview(0,'截止后恢复'));await tick();tree=render();assert.match(words(tree),/截止后恢复/);assert.doesNotMatch(words(tree),/消息读取超时/);h.dispose();
});
test('指定辩论只查询 A；拒绝 B，不启动也不查同股列表',async()=>{
 const calls:string[]=[];const jobs:any[]=[];
 const h=harness('../src/verticals/finance/pages/HistoricalDebate.tsx',{'../lib/backend':{backend:{backgroundJob:(id:string)=>{calls.push(id);const d=deferred();jobs.push(d);return d.promise;}}}});
 const props={id:'A',symbol:'600000'};h.render(h.exports.HistoricalDebate,props);jobs[0].resolve({id:'B',key:'debate:600000'});await tick();const tree=h.render(h.exports.HistoricalDebate,props);assert.match(words(tree),/不匹配/);assert.deepEqual(calls,['A']);h.dispose();
});
test('提醒返回焦点绑定原历史项且只消费一次；成功补读保留操作错误',async()=>{
 const reads:any[]=[],writes:any[]=[],focused:string[]=[];let key='inbox',navigation='POP';
 const h=harness('../src/verticals/finance/pages/Inbox.tsx',{'react-router-dom':{Link:'a',useLocation:()=>({key}),useNavigationType:()=>navigation},__document:{getElementById:(id:string)=>({focus:()=>focused.push(id)})},'@/lib/backend':{ApiError:Error,backend:{notify:()=>{const d=deferred();reads.push(d);return d.promise;},notifyAction:()=>{const d=deferred();writes.push(d);return d.promise;}}},'../lib/reminderTarget':{reminderTarget},'@/lib/notify':{formatInboxTime:()=>'',WEBHOOK_KINDS:[]}});
 const data=overview(1);Object.assign(data.inbox.items[0],{link:'/shortline?date=2026-11-16&reminder=close'});const render=()=>h.render(h.exports.Inbox);render();reads[0].resolve(data);await tick();let tree=render();nodes(tree).find(n=>n.type==='button'&&words(n)==='标为已读').props.onClick();writes[0].reject(Error('operation failed'));await tick();reads[1].resolve(data);await tick();tree=render();assert.match(words(tree),/operation failed/);
 const messageLink=nodes(tree).find(n=>n.type==='a');messageLink.props.onClick();
 const returns:any[]=[];const shortline=harness('../src/verticals/finance/pages/Shortline.tsx',{'react-router-dom':{useLocation:()=>({state:messageLink.props.state}),useSearchParams:()=>[new URLSearchParams(messageLink.props.to.split('?')[1])],useNavigate:()=>((target:any)=>returns.push(target))}});
 const destination=shortline.render(shortline.exports.Shortline);nodes(destination).find(n=>n.type==='button'&&words(n)==='返回提醒')!.props.onClick();assert.deepEqual(returns,[-1]);shortline.dispose();
 h.dispose();h.remount();render();reads[2].resolve(data);await tick();render();assert.deepEqual(focused,['message-m']);h.dispose();h.remount();key='other';navigation='PUSH';render();reads[3].resolve(data);await tick();render();assert.deepEqual(focused,['message-m']);h.dispose();
});
test('日历事件失败不遮挡判据；换范围失败不显示旧时间轴；旧响应不覆盖',async()=>{
 const events:any[]=[],verdicts:any[]=[];
 const h=harness('../src/verticals/finance/pages/Calendar.tsx',{'@/lib/backend':{ApiError:Error,backend:{calendar:()=>{const d=deferred();events.push(d);return d.promise;},verdicts:()=>{const d=deferred();verdicts.push(d);return d.promise;}}},'@/lib/calendar':calendar,'@/lib/storage':{storageGet:()=>null,storageSet(){}}});
 const render=()=>h.render(h.exports.Calendar);render();const verdict={generated_at:'now',today:'2026-11-17',due:[],judged:[],calibration:[],gaps:[]};verdicts[0].resolve(verdict);events[0].reject(Error('company offline'));await tick();let tree=render();assert.ok(nodes(tree).find(n=>n.props?.data===verdict));assert.match(words(tree),/company offline/);
 const toggle=nodes(tree).find(n=>n.props?.label==='看多少天');toggle.props.onChange('7');render();events[1].resolve({window:{days:7,from:'2026-11-17',to:'2026-11-24'},symbols:[],events:[],overdue:[],gaps:[]});await tick();tree=render();assert.match(words(tree),/2026-11-24/);
 nodes(tree).find(n=>n.props?.label==='看多少天').props.onChange('90');render();events[2].reject(Error('90 failed'));await tick();tree=render();assert.doesNotMatch(words(tree),/2026-11-24/);assert.ok(nodes(tree).find(n=>n.props?.data===verdict));
 nodes(tree).find(n=>n.props?.label==='看多少天').props.onChange('7');tree=render();nodes(tree).find(n=>n.props?.label==='看多少天').props.onChange('30');render();
 events[4].resolve({window:{days:30,from:'2026-11-17',to:'2026-12-17'},symbols:[],events:[],overdue:[],gaps:[]});await tick();events[3].resolve({window:{days:7,from:'2026-11-17',to:'2026-11-24'},symbols:[],events:[],overdue:[],gaps:[]});await tick();tree=render();assert.match(words(tree),/2026-12-17/);assert.doesNotMatch(words(tree),/2026-11-24/);h.dispose();
});
test('旧判据保存回调只刷新当前范围，倒序旧响应不废掉当前日历',async()=>{
 const calls:any[]=[],verdictReads:any[]=[];
 const h=harness('../src/verticals/finance/pages/Calendar.tsx',{'@/lib/backend':{ApiError:Error,backend:{calendar:(opts:any)=>{const d=deferred();calls.push({days:opts.days,...d});return d.promise;},verdicts:()=>{const d=deferred();verdictReads.push(d);return d.promise;}}},'@/lib/calendar':calendar,'@/lib/storage':{storageGet:()=>null,storageSet(){}}});
 const render=()=>h.render(h.exports.Calendar);let tree=render();
 const onSaved=nodes(tree).find(n=>typeof n.props?.onChanged==='function')!.props.onChanged;
 nodes(tree).find(n=>n.props?.label==='看多少天')!.props.onChange('7');render();onSaved();
 assert.deepEqual(calls.map(c=>c.days),[30,7,7]);assert.equal(verdictReads.length,2);
 const result=(days:number,to:string)=>({window:{days,from:'2026-11-17',to},symbols:[],events:[],overdue:[],gaps:[]});
 calls[2].resolve(result(7,'2026-11-24'));await tick();calls[0].resolve(result(30,'2026-12-17'));calls[1].reject(Error('旧7天读取失败'));await tick();tree=render();
 assert.match(words(tree),/2026-11-24/);assert.doesNotMatch(words(tree),/2026-12-17|旧7天读取失败|正在取数/);
 h.dispose();onSaved();assert.equal(calls.length,3);
});
test('真实渲染：历史 A 成果；判据刷新失败保留快照且禁写',async()=>withRenderer(async r=>{
 const {HistoricalDebateResult}=await r.load('/src/verticals/finance/pages/HistoricalDebate.tsx');const {VerdictPanel}=await r.load('/src/verticals/finance/components/ui/VerdictPanel.tsx');const {MemoryRouter}=await r.load('react-router-dom');
 const render=(component:any,props:any)=>r.html(()=>createElement(MemoryRouter,null,createElement(component,props)),{});
 const html=render(HistoricalDebateResult,{job:{id:'A',key:'debate:600000',title:'旧轮 A',status:'completed',events:[{event:{type:'done',state:{stages:[{id:'bull',label:'多方',text:'仅 A 的成果',status:'done'}]}}}]}});assert.match(textOf(html),/仅 A 的成果/);assert.match(textOf(html),/无法可靠关联/);
 const data={generated_at:'2026-11-17T00:00:00Z',today:'2026-11-17',due:[],judged:[],calibration:[],gaps:[]};const stale=render(VerdictPanel,{data,error:'offline',onChanged(){}});assert.match(stale,/<fieldset disabled/);assert.match(textOf(stale),/2026-11-17T00:00:00Z/);assert.match(textOf(stale),/未更新/);
}));

