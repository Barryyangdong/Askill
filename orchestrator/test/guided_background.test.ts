import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {BackgroundJobs} from '../src/background_jobs.ts';
import {startGuidedJob} from '../src/guided_background.ts';
const settle=()=>new Promise(r=>setTimeout(r,20));
test('detached turn persists complete output, archives once, and deduplicates completed retries',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'askill-guided-'));const jobs=new BackgroundJobs(root);
 let calls=0,saves=0;
 const run=async(_s:AbortSignal,phase:(v:string)=>void)=>{calls++;phase('execute');return {status:'complete' as const,message:'done',report:'entire content',tool_result:{sample:[1,2]}};};
 const launch=()=>startGuidedJob(jobs,'sample','s1','t1','Sample',run,()=>{saves++;});
 const id=launch();assert.equal(launch(),id);await settle();assert.equal(jobs.get(id)?.status,'completed');assert.equal(launch(),id);assert.equal(calls,1);assert.equal(saves,1);
 jobs.close(); const reopened=new BackgroundJobs(root); assert.equal(reopened.get(id)?.events.length,3); reopened.close();
});
test('archive failure retains result and does not pretend success; cancellation never archives',async()=>{
 const jobs=new BackgroundJobs(fs.mkdtempSync(path.join(os.tmpdir(),'askill-guided-')));
 const id=startGuidedJob(jobs,'sample','s1','t1','Sample',async()=>({status:'complete',message:'done',report:'keep me'}),()=>{throw Error('disk full');});
 await settle();assert.equal(jobs.get(id)?.status,'failed');assert.equal((jobs.get(id)?.events[0].event as any).reply.report,'keep me');
 let finish!:()=>void;
 const cancel=startGuidedJob(jobs,'sample','s2','t1','Sample',async()=>{await new Promise<void>(r=>{finish=r;});return {status:'complete',message:'late'};},()=>{throw Error('must not archive');});
 await settle();assert.throws(()=>startGuidedJob(jobs,'sample','s2','t2','Sample',async()=>({status:'needs_input',message:'ask'}),()=>{}));
 jobs.cancel(cancel);finish();await settle();assert.equal(jobs.get(cancel)?.status,'cancelled');assert.equal(jobs.get(cancel)?.events.length,0);
});
test('computed output is available before composition finishes',async()=>{
 const jobs=new BackgroundJobs(fs.mkdtempSync(path.join(os.tmpdir(),'askill-early-')));
 let finish!:()=>void;
 const id=startGuidedJob(jobs,'sample','s1','t1','Sample',async(_signal,phase,output)=>{
   output({ok:true,result:{value:42}});phase('compose');await new Promise<void>(r=>{finish=r;});return {status:'complete',message:'done'};
 },()=>{});
 await settle();assert.equal(jobs.get(id)?.status,'running');assert.equal((jobs.get(id)?.events[0].event as any).value.result.value,42);
 finish();await settle();assert.equal(jobs.get(id)?.status,'completed');
});

