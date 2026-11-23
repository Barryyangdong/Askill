import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import '../src/finance/register_tasks.ts';
import { verdictMessage, type VerdictItem } from '../src/finance/verdicts.ts';
import { messageText, notifyAction, notifyOverview, type ScheduleDef } from '../src/notify.ts';
import { runView } from '../src/views.ts';
import type { ServiceContext } from '../src/service.ts';

test('201 条生产聚合提醒持久化完整集合，短链接可通过默认 HTTP，已读保留/清空失效',async(t)=>{
 const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'calendar-reminder-'));
 const ctx:ServiceContext={dataRoot,repoRoot:process.cwd(),python:'false',node:process.execPath};
 const items=Array.from({length:201},(_,i)=>({id:`criterion-${randomUUID()}`,due:i%2?'2026-11-16':'2026-11-17',symbol:'600000',name:'合成对象',type:'decision_point',statement:`合成判据 ${i}`,since:'2026-11-01',facts:[],facts_total:0,facts_note:''} as unknown as VerdictItem));
 const m=verdictMessage('2026-11-17',items,0);
 const expected=items.map(({id,due})=>({id,due}));
 assert.ok(Buffer.byteLength(`/calendar?criteria=${encodeURIComponent(JSON.stringify(expected))}`)>16384);
 assert.ok(Buffer.byteLength(m.link!)<256);
 let pushes=0;
 const def:ScheduleDef={timeZone:'Asia/Shanghai',gateNote:'合成',gate:async()=>({status:'open'}),jobs:[{id:'synthetic',label:'合成',description:'隔离',at:'12:00',defaultEnabled:true,run:async()=>({messages:[m]})}]};
 const server=http.createServer((request,response)=>{assert.equal(request.url,storedLink);response.writeHead(200);response.end('synthetic page');});
 let storedLink='';
 try {
  await notifyAction(ctx,'jobs/run',{id:'synthetic'},{def,deps:{system:async()=>{pushes++;},fetch:async()=>{pushes++;throw Error('must not push');}}});
  const saved=notifyOverview(ctx,{def}).inbox.items[0]!;storedLink=saved.link!;
  assert.ok(Buffer.byteLength(storedLink)<256);assert.equal(pushes,0);
  assert.equal(new URL(storedLink,'http://local').searchParams.get('message'),saved.id);
  assert.equal(saved.context?.refs.length,201);
  const signal=new AbortController().signal;
  const get=()=>runView(ctx,'calendar_reminder',{message:saved.id},signal) as Promise<{status:string;targets:typeof expected}>;
  assert.deepEqual((await get()).targets,expected);
  const pushText=messageText({...m,link:storedLink});assert.ok(Buffer.byteLength(pushText)<4096);assert.ok(!pushText.includes(items[200]!.id));
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
  const port=(server.address() as {port:number}).port;
  const response=await fetch(`http://127.0.0.1:${port}${storedLink}`);assert.equal(response.status,200);await response.text();
  t.diagnostic(`refs=${saved.context!.refs.length}; generated_link_bytes=${Buffer.byteLength(m.link!)}; persisted_link_bytes=${Buffer.byteLength(storedLink)}; push_text_bytes=${Buffer.byteLength(pushText)}; loopback_status=${response.status}; real_pushes=${pushes}`);
  await notifyAction(ctx,'inbox/read',{ids:[saved.id]},{def});assert.deepEqual((await get()).targets,expected);
  await notifyAction(ctx,'inbox/clear',{}, {def});assert.equal((await get()).status,'missing');
  assert.equal((await runView(ctx,'calendar_reminder',{message:'different-id'},signal) as {status:string}).status,'missing');
 } finally {if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(dataRoot,{recursive:true,force:true});}
});
