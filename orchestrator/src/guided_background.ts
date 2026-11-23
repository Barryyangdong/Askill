import type { GuidedToolReply } from './guided_tool.ts';
import type { BackgroundJobs } from './background_jobs.ts';

export function startGuidedJob(jobs:BackgroundJobs,name:string,session:string,turn:string,label:string,
  run:(signal:AbortSignal,phase:(phase:string)=>void,output:(value:unknown)=>void)=>Promise<GuidedToolReply>,
  archive:(reply:GuidedToolReply,marker:string)=>void) {
  if(!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(name)||![session,turn].every(v=>/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(v)))throw Error('Invalid task identifier');
  const key=`guided:${name}:${session}:${turn}`;
  // A lost acceptance response must not execute the same turn twice, even after completion.
  const previous=jobs.list().find(j=>j.key===key);
  if(previous)return previous.id;
  if(jobs.list().some(j=>j.key.startsWith(`guided:${name}:${session}:`)&&['running','cancelling'].includes(j.status)))throw Error('Session already active');
  return jobs.start(key,label,async(signal,emit)=>{
    const reply=await run(signal,phase=>emit({type:'guided_phase',phase}),value=>emit({type:'guided_data',value}));
    if(signal.aborted)throw Error('Cancelled');
    // Save the complete result before archiving; a disk failure never discards generated output.
    emit({type:'guided_result',reply});
    if(reply.status==='complete')archive(reply,key);
    emit({type:'guided_saved',saved:reply.status==='complete'});
  });
}
