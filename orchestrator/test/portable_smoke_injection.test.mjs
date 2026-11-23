import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {stripTypeScriptTypes} from 'node:module';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../scripts/portable/smoke.mts',import.meta.url),'utf8');
const code=stripTypeScriptTypes(source).replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'').replaceAll('import.meta.url','"synthetic-module"')+'\nglobalThis.auditSmoke=smoke;';
const results=[];
for(const mode of ['success','close-throws','connections-throws','signal-exit','early-exit','validation-fail','stop-throws','stop-nonzero','remove-throws','shim-write-throws','spawn-throws','spawn-error','unknown-ui','success-stop-nonzero','occupied-default','occupied-candidate','late-child-error','late-error-close','version-late-close','unknown-ui-occupied']){
 let childEnv, now=0, started=false, stopCalled=false, blockerOpen=false, shimExists=false, removed=false, child, uncaughtError='', errorListeners=-1;
 const calls=[], portsAfter=[], messages=[];
 const pkg=path.resolve('D:/synthetic/ship02-package');
 const errorDuringClose = mode === 'late-error-close' || mode === 'version-late-close';
 const viaCli = mode === 'late-child-error' || errorDuringClose;
 let finishCli, cliExit, cliError;
 const cliDone = new Promise(resolve => { finishCli = resolve; });
 const later=(fn)=>queueMicrotask(fn);
 const mockFs={
  readFileSync:()=>JSON.stringify({version:'fixture-version',target:'win-x64'}),
  mkdtempSync:()=>{shimExists=true;return 'D:/synthetic/ship02-shims';},mkdirSync:()=>{},
  writeFileSync:()=>{if(mode==='shim-write-throws')throw new Error('SYNTHETIC_SHIM_WRITE_FAILURE');},
  rmSync:()=>{if(mode==='remove-throws')throw new Error('SYNTHETIC_REMOVE_FAILURE');shimExists=false;removed=true;},
  realpathSync:(p)=>p,
 };
 const fakeNet={connect:({port})=>{
  const s=new EventEmitter();s.destroy=()=>{};s.setTimeout=()=>{};
  if(started)portsAfter.push(port);
  const open = (mode === 'occupied-default' && port === 5940)
    || (mode === 'occupied-candidate' && port === 5941)
    || (mode === 'unknown-ui-occupied' && stopCalled && port === 5941);
  later(() => s.emit(open ? 'connect' : 'error', new Error('synthetic closed')));
  return s;
 }};
 const fakeHttp={createServer:()=>{
  const b=new EventEmitter();b.listen=(p,h,cb)=>{blockerOpen=true;later(cb);};
  b.closeAllConnections=()=>{calls.push('closeConnections');if(mode==='connections-throws')throw Error('SYNTHETIC_CONNECTIONS');};
  b.close = (cb) => {
   if (mode === 'close-throws') throw Error('SYNTHETIC_CLOSE');
   blockerOpen = false;
   later(() => {
    if (errorDuringClose) child.emit('error', new Error('SYNTHETIC_CLOSE_CHILD_ERROR'));
    cb?.();
   });
  };
  return b;
 }};
 const spawn=(cmd,args,opts)=>{
  childEnv=opts.env;
  if(mode==='spawn-throws')throw new Error('SYNTHETIC_SPAWN_THROW');
  started=true;child=new EventEmitter();child.exitCode=null;child.signalCode=null;child.pid=mode==='spawn-error'?undefined:2147483001;
  if(mode==='early-exit'||mode==='spawn-error'||mode==='signal-exit')later(()=>{
   if(mode==='spawn-error'){
    errorListeners=child.listenerCount('error');
    try{child.emit('error',new Error('SYNTHETIC_SPAWN_ERROR'));}catch(e){uncaughtError=e.message;}
    return; // A failed spawn has no PID and need not emit an exit event.
   }
   if(mode==='signal-exit'){child.signalCode='SIGTERM';child.emit('exit',null,'SIGTERM');} else { child.exitCode=7;child.emit('exit',7); }
  });
  return child;
 };
 const spawnSync=(cmd,args)=>{
  if(cmd==='taskkill'){
   stopCalled=true;calls.push('taskkill:'+args[1]);
   if(mode==='stop-throws')throw new Error('SYNTHETIC_STOP_THROW');
   if(mode==='stop-nonzero'||mode==='success-stop-nonzero')return {status:5,stdout:'',stderr:'SYNTHETIC_ACCESS_DENIED'};
   if (mode === 'late-child-error') {
    later(() => child.emit('error', new Error('SYNTHETIC_LATE_CHILD_ERROR')));
    return {status:0,stdout:'',stderr:''};
   }
   child.exitCode=0;child.emit('exit',0);return {status:0,stdout:'',stderr:''};
  }
  calls.push('doctor-stub');
  return {status:0,stdout:JSON.stringify({checks:['node','config','python','calc','registry','constitution','skills','data_root'].map(id=>({id,status:'ok'}))}),stderr:''};
 };
 const fetch=async(url)=>{
  const u=new URL(url);let body;
  if(['early-exit','spawn-error','signal-exit','unknown-ui','unknown-ui-occupied'].includes(mode)){now+=1000;return {status:503,text:async()=>''};}
  if(u.pathname==='/api/health')body=JSON.stringify({ok:true,version:['success','success-stop-nonzero','late-child-error','late-error-close'].includes(mode)?'fixture-version':'WRONG_VERSION'});
  else if(u.pathname==='/api/product')body=JSON.stringify({paths:{python:path.join(pkg,'runtime/python/python.exe'),data_root:path.join(pkg,'.local')}});
  else body='<html><div id="root"></div></html>';
  return {status:200,text:async()=>body};
 };
 const ctx=vm.createContext({fs:mockFs,net:fakeNet,http:fakeHttp,os:{tmpdir:()=> 'D:/synthetic'},path,
  spawn,spawnSync,fetch,API_PORT:8770,UI_PORT:5940,isMain:()=>viaCli,layoutOf:()=>({python:'runtime/python/python.exe',node:'runtime/node/node.exe'}),
  process:{platform:'win32',env:{VRA_UI_PORT:'9999',vra_api_port:'9998'},argv:['node','smoke.mts',pkg],exit:(code)=>{cliExit=code;finishCli();}},AbortSignal:{timeout:()=>undefined},
  Date:{now:()=>now},setTimeout:(cb,ms)=>{if(ms<5000){now+=ms;later(cb);}return 1;},clearTimeout:()=>{},console:{
   log:(...a)=>{const line=a.join(' ');messages.push(line);if(line==='[smoke] 通过')finishCli();},
   error:(...a)=>{cliError=a.join(' ');},
  },URL,
 });
 vm.runInContext(code,ctx,{filename:'production-smoke-isolated.js'});
 let error=null;
 if (viaCli) { await cliDone; error = cliError; }
 else { try{await ctx.auditSmoke(pkg);}catch(e){error=e.message;} }
 const r={mode,error,started,childAlive:!!child&&child.pid!==undefined&&child.exitCode===null&&child.signalCode===null,taskkillCalls:calls.filter(c=>c.startsWith('taskkill:')),portsAfter:[...new Set(portsAfter)],blockerOpen,shimExists,removed,simulatedMs:now,...(mode==='spawn-error'?{errorListeners,uncaughtError}:{}),successMessage:messages.some(m=>m.includes('启动器已退出')||m==='[smoke] 通过')};
 assert.ok(r.taskkillCalls.every(c=>c==='taskkill:2147483001'));
 if(started) { assert.equal(ctx.process.env.VRA_UI_PORT,'9999'); assert.equal(ctx.process.env.vra_api_port,'9998'); assert.equal(childEnv.VRA_UI_PORT,undefined); assert.equal(childEnv.vra_api_port,undefined); }
 if(mode==='success') assert.ok(!error&&!r.childAlive&&r.successMessage&&removed&&!blockerOpen&&portsAfter.includes(5941)&&portsAfter.includes(8770));
 if(mode==='connections-throws') assert.ok(error.includes('WRONG_VERSION')&&error.includes('SYNTHETIC_CONNECTIONS')&&!blockerOpen);
 if(mode==='close-throws') assert.ok(error.includes('WRONG_VERSION')&&error.includes('SYNTHETIC_CLOSE')&&removed);
 if(mode==='signal-exit') assert.ok(error.includes('信号 SIGTERM')&&!r.childAlive&&r.taskkillCalls.length===0);
 if(mode==='validation-fail') assert.ok(error.includes('WRONG_VERSION')&&portsAfter.length&&removed&&!blockerOpen);
 if(mode==='early-exit') assert.ok(error.includes('提前退出')&&portsAfter.length);
 if(mode==='stop-throws'||mode==='remove-throws') assert.ok(error.includes('WRONG_VERSION')&&!blockerOpen);
 if(mode==='spawn-error') assert.ok(errorListeners>0&&!uncaughtError&&error.includes('SYNTHETIC_SPAWN_ERROR')&&!error.includes('退出未确认')&&r.taskkillCalls.length===0);
 if(mode==='success-stop-nonzero') assert.ok(error&&r.childAlive&&!r.successMessage);
 if(mode==='shim-write-throws'||mode==='spawn-throws') assert.ok(error&&removed&&!blockerOpen);
 if(mode==='occupied-default') assert.ok(!started&&!blockerOpen);
 if (mode === 'late-child-error') {
  assert.equal(cliExit, 1);
  assert.ok(error.includes('SYNTHETIC_LATE_CHILD_ERROR') && error.includes('退出未确认'));
  assert.ok(r.childAlive && !r.successMessage && removed && !blockerOpen);
 }
 if (errorDuringClose) {
  assert.equal(cliExit, 1);
  assert.ok(error.includes('SYNTHETIC_CLOSE_CHILD_ERROR') && !error.includes('退出未确认'));
  if (mode === 'version-late-close') assert.match(error, /^\[smoke\] 失败：.*WRONG_VERSION/);
  assert.ok(!r.childAlive && !r.successMessage && removed && !blockerOpen);
 }
 if (mode === 'unknown-ui-occupied') {
  assert.ok(error.includes('5941 仍被占用（归属未知）') && error.includes('未确定实际页面端口'));
  assert.deepEqual(r.taskkillCalls, ['taskkill:2147483001']);
 }
 results.push(r);
}
for(const r of results)console.log(JSON.stringify(r));
