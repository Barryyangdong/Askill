import { digestIdentity } from '../src/verticals/finance/lib/digestIdentity.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function handler(page: string, name: string) {
 const source=ts.createSourceFile(page,fs.readFileSync(new URL(`../src/verticals/finance/pages/${page}.tsx`,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let code=''; const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(source)===name&&n.initializer)code=n.initializer.getText(source); if(ts.isFunctionDeclaration(n)&&n.name?.text===name)code=n.getText(source);ts.forEachChild(n,visit);};visit(source);assert.ok(code);
 return ts.transpileModule(`(${code})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
test('深研断线重试只查询原任务',async()=>{
 let starts=0;const calls:string[]=[];const route={target:'deep',routeFingerprint:'fp',reason:'x'};
 const c:any={objective:'goal',selected:['r'],reports:[{id:'r',symbols:['600000']}],taskBusy:false,busy:false,deleting:false,deepRunId:null,deepFingerprint:null,AbortController,taskAbortRef:{current:null},newAnalysisSession:()=> 'task',DEEP_REPORT_LIMIT:16,waitFor:async()=>{},pollDeepRun:(id:string,fp:string,resume:any)=>resume(id,fp),friendlyAgentError:String,
 backend:{routeTask:async()=>({route,executionAvailable:true}),runTask:async()=>{starts++;return {route,status:'running',events:[{type:'started',runId:'run-1'}]};},resumeTask:async(id:string,fp:string)=>{calls.push(`${id}:${fp}`);if(calls.length===1)throw Error('offline');return {status:'completed',events:[{type:'artifact',payload:{report:'完成'}}]};}}};
 for(const [key,field] of Object.entries({setTaskBusy:'taskBusy',setDeepRunId:'deepRunId',setDeepFingerprint:'deepFingerprint',setTaskError:'error',setTaskAnswer:'answer'}))c[key]=(value:any)=>{c[field as string]=value;};
 for(const key of ['setTaskNotice','setCancelPending','setRouteDecision'])c[key]=()=>{};
 const submit=vm.runInNewContext(handler('MyReports','submitTask'),c);const retry=vm.runInNewContext(handler('MyReports','retryDeep'),c);
 await submit();assert.equal(c.deepRunId,'run-1');await submit();await retry();assert.equal(starts,1);assert.deepEqual(calls,['run-1:fp','run-1:fp']);assert.equal(c.answer,'完成');
});
test('审计保存失败保留正文，重试不重新生成',async()=>{
 let writes=0,generations=0;const contents:string[]=[];const c:any={saving:false,reflectSaved:false,reflectText:'原审计正文',ApiError:class extends Error {},addNote:async(_kind:string,_title:string,text:string)=>{contents.push(text);if(++writes===1)throw Error('disk');return [];},reflectStream:()=>{generations++;}};
 for(const [key,field] of Object.entries({setSaving:'saving',setReflectSaved:'reflectSaved',setSaveError:'saveError'}))c[key]=(value:any)=>{c[field as string]=value;};c.setNotes=()=>{};
 const save=vm.runInNewContext(handler('Notes','saveReflection'),c);await save({title:'记录'});assert.match(c.saveError,/disk/);assert.equal(c.reflectText,'原审计正文');assert.equal(c.reflectSaved,false);await save({title:'记录'});assert.equal(c.reflectSaved,true);assert.deepEqual(contents,['原审计正文','原审计正文']);assert.equal(generations,0);
});
test('引用地址变化关闭旧预览，并在资料重读后打开新引用',async()=>{
 const source=ts.createSourceFile('MyReports',fs.readFileSync(new URL('../src/verticals/finance/pages/MyReports.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let effect='';const visit=(n:ts.Node)=>{if(ts.isCallExpression(n)&&n.expression.getText(source)==='useEffect'&&n.arguments[0]?.getText(source).includes('openedCitation.current')&&n.arguments[0]?.getText(source).includes('linkedReport'))effect=n.arguments[0].getText(source);ts.forEachChild(n,visit);};visit(source);assert.ok(effect);
 const c:any={linkedReport:'A',linkedPage:null,loaded:true,reports:[{id:'A'}],openedCitation:{current:''},previewSequence:{current:0},panelOrigin:{current:null},panel:'',citationError:'',setPanel:(p:any)=>c.panel=p,setCitationError:(e:string)=>c.citationError=e,preview:(r:any)=>{c.panel=r.id;c.panelOrigin.current='citation';}};
 const run=()=>vm.runInNewContext(ts.transpileModule(`(${effect})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c)();
 run();assert.equal(c.panel,'A');c.linkedReport=null;run();assert.equal(c.panel,null);c.linkedReport='A';run();c.linkedReport='B';run();assert.equal(c.panel,null);assert.match(c.citationError,/无法打开/);c.reports=[{id:'A'},{id:'B'}];run();assert.equal(c.panel,'B');
});

test('赛道要点晚到内容保留在原资讯批次并记录真实来源',async()=>{
 const pending:any[]=[];const state:any={};const c:any={digestIdentity,data:{generated_at:'A'},digestRuns:{current:new Map()},hasLlm:()=>true,translationCache:{current:new Map()},displayedHeadlineTranslation:()=>null,ApiError:class extends Error{},chatStream:async(_m:any,_ctx:any,callbacks:any)=>new Promise<void>(resolve=>pending.push({callbacks,resolve})),setDigests:(fn:any)=>Object.assign(state,fn(state))};
 const gen=vm.runInNewContext(handler('Intel','genDigest'),c);const ia={key:'ai',name:'AI',items:[{time:'t',source:'s',title:'旧',url:'https://old.example/a'}]};const ib={key:'ai',name:'AI',items:[{time:'t',source:'s',title:'新',url:'https://new.example/b'}]};const a=gen(ia);
 c.data={generated_at:'A'};const b=gen(ib);
 pending[1].callbacks.onDelta('新要点');pending[1].resolve();await b;pending[0].callbacks.onDelta('旧要点');pending[0].resolve();await a;
 assert.equal(state[digestIdentity(ib)].text,'新要点');assert.equal(state[digestIdentity(ia)].text,'旧要点');assert.match(state[digestIdentity(ia)].sources,/https:\/\/old.example\/a/);
});

test('工作台第二组资讯返回保留第一组与活动组',async()=>{
 const {intelReturnLocation,workbenchRestore}=await import('../src/verticals/finance/lib/workbenchIntel.ts');
 const link=intelReturnLocation('600001',2,'600000');
 const params=new URLSearchParams(link.split('?')[1]);
 assert.deepEqual(workbenchRestore(params),{symbol:'600001',group:2,firstSymbol:'600000'});
 assert.deepEqual(workbenchRestore(new URLSearchParams('symbol=600001')),{symbol:'600001',group:1,firstSymbol:null});
});
test('弹窗下载失败反馈留在当前预览，重试成功清除反馈',async()=>{
 const c:any={previewSequence:{current:1},downloadSequence:{current:0},setDownloadError:()=>{},panel:{kind:'preview',report:{id:'r',name:'报告'}},ApiError:class extends Error{},setPanel:(fn:any)=>{c.panel=fn(c.panel);},setErr:()=>{},downloadReport:async()=>{throw Error('offline');}};
 const download=vm.runInNewContext(handler('MyReports','download'),c);await download(c.panel.report);assert.match(c.panel.downloadError,/下载失败/);c.downloadReport=async()=>{};await download(c.panel.report);assert.equal(c.panel.downloadError,undefined);
});
test('旧引用正文请求迟到不会覆盖新预览',async()=>{
 const pending:any[]=[];const c:any={previewSequence:{current:0},panelOrigin:{current:null},panel:null,setPanel:(v:any)=>{c.panel=typeof v==='function'?v(c.panel):v;},backend:{reportPreview:(id:string)=>new Promise(resolve=>pending.push({id,resolve}))},friendlyAgentError:String,Number};
 const preview=vm.runInNewContext(handler('MyReports','preview'),c);const a=preview({id:'A',pages:1},'1','citation');const b=preview({id:'B',pages:1},'1','citation');pending[1].resolve({text:'B 正文'});await b;pending[0].resolve({text:'A 正文'});await a;assert.equal(c.panel.report.id,'B');assert.equal(c.panel.text,'B 正文');
});
test('公告切换新闻保留返回工作台所需参数',()=>{
 const source=ts.createSourceFile('Intel',fs.readFileSync(new URL('../src/verticals/finance/pages/Intel.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expr='';
 const visit=(n:ts.Node)=>{if(ts.isJsxAttribute(n)&&n.name.getText(source)==='onClick'&&n.initializer&&n.initializer.getText(source).includes('navigate(`/intel/${key}'))expr=(n.initializer as ts.JsxExpression).expression!.getText(source);ts.forEachChild(n,visit);};visit(source);assert.ok(expr);
 let target='';const c={navigate:(url:string)=>{target=url;},key:'news',focused:'600001',params:new URLSearchParams('symbol=600001&group=2&firstSymbol=600000')};vm.runInNewContext(ts.transpileModule(`(${expr})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c)();
 const q=new URLSearchParams(target.split('?')[1]);assert.equal(q.get('group'),'2');assert.equal(q.get('firstSymbol'),'600000');
});
test('同一顶层时间、不同赛道来源的要点不会共用',async()=>{
 const {digestIdentity}=await import('../src/verticals/finance/lib/digestIdentity.ts');const a={key:'gpu',items:[{time:'t',source:'s',title:'标题',url:'https://a.example'}]};const b={...a,items:[{...a.items[0],url:'https://b.example'}]};assert.notEqual(digestIdentity(a),digestIdentity(b));assert.equal(digestIdentity(a),digestIdentity({...a}));
});
test('正文回包不会抹掉下载错误，关闭重开后旧下载不污染',async()=>{
 const pending:any[]=[];const c:any={previewSequence:{current:0},downloadSequence:{current:0},setDownloadError:()=>{},panelOrigin:{current:null},panel:null,err:'',backend:{reportPreview:()=>new Promise(resolve=>pending.push(resolve))},friendlyAgentError:String,Number,ApiError:class extends Error{},setErr:(e:string)=>{c.err=e;}};
 c.setPanel=(v:any)=>{c.panel=typeof v==='function'?v(c.panel):v;};let rejectDownload:any;c.downloadReport=()=>new Promise((_resolve,reject)=>{rejectDownload=reject;});
 const preview=vm.runInNewContext(handler('MyReports','preview'),c),download=vm.runInNewContext(handler('MyReports','download'),c);const r={id:'a',name:'a',pages:1};const p=preview(r);const d=download(r);rejectDownload(Error('offline'));await d;pending.shift()({text:'正文'});await p;assert.match(c.panel.downloadError,/下载失败/);
 const old=download(r);c.err='';c.previewSequence.current++;c.panel=null;const newer=preview(r);rejectDownload(Error('offline'));await old;assert.equal(c.panel.downloadError,undefined);assert.equal(c.err,'');pending.shift()({text:'新正文'});await newer;
});

test('锁定面板返回恢复联动组对象，兼容旧地址',async()=>{
 const {intelReturnLocation}=await import('../src/verticals/finance/lib/workbenchIntel.ts');
 for(const [group,first,expected] of [[1,'600000','600000'],[2,'600000','600001']] as const){
  const url=intelReturnLocation('600002',group,first,group===1?'600000':'600001');const q=new URLSearchParams(url.split('?')[1]);assert.equal(q.get('symbol'),expected);assert.equal(q.get('firstSymbol'),first);assert.equal(q.get('group'),String(group));
 }
 const legacy=new URLSearchParams(intelReturnLocation('600002',2,'600000','!bad').split('?')[1]);assert.equal(legacy.get('symbol'),'600002');
 const international=new URLSearchParams(intelReturnLocation('600002',2,'AAPL','00700.HK').split('?')[1]);assert.equal(international.get('symbol'),'00700.HK');
});
test('下载失败重试成功清除下载错误，保留其他列表错误',async()=>{
 const c:any={previewSequence:{current:1},downloadSequence:{current:0},panel:{kind:'preview',report:{id:'r',name:'报告'}},err:'上传失败',downloadError:null,ApiError:class extends Error{},setPanel:(fn:any)=>{c.panel=fn(c.panel);},setErr:(v:any)=>{c.err=typeof v==='function'?v(c.err):v;},setDownloadError:(v:any)=>{c.downloadError=typeof v==='function'?v(c.downloadError):v;},downloadReport:async()=>{throw Error('offline');}};
 const download=vm.runInNewContext(handler('MyReports','download'),c);await download(c.panel.report);assert.ok(c.downloadError);c.downloadReport=async()=>{};await download(c.panel.report);assert.equal(c.downloadError,null);assert.equal(c.panel.downloadError,undefined);assert.equal(c.err,'上传失败');
});
test('较早下载失败迟于较新成功不覆盖状态',async()=>{
 const pending:any[]=[];const c:any={previewSequence:{current:1},downloadSequence:{current:0},panel:{kind:'preview',report:{id:'r',name:'报告'}},err:null,downloadError:null,ApiError:class extends Error{},setPanel:(fn:any)=>{c.panel=fn(c.panel);},setErr:(v:any)=>{c.err=v;},setDownloadError:(v:any)=>{c.downloadError=v;},downloadReport:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))};
 const download=vm.runInNewContext(handler('MyReports','download'),c);const first=download(c.panel.report);const second=download(c.panel.report);pending[1].resolve();await second;pending[0].reject(Error('offline'));await first;assert.equal(c.downloadError,null);assert.equal(c.panel.downloadError,undefined);assert.equal(c.err,null);
});
