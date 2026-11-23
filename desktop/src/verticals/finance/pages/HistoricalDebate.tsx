import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { backend, type BackgroundJob } from '../lib/backend';
import { DebateReport } from '../components/DebateReport';

export function validateDebateJob(job: BackgroundJob, id: string, symbol: string) {
  if (job.id !== id || !/^debate:\d{6}$/.test(job.key) || (symbol && job.key !== `debate:${symbol}`)) throw Error('任务 ID 或股票不匹配，未打开其他轮次。');
  return job;
}
export function HistoricalDebateResult({job}: {job: BackgroundJob}) {
  const state = [...(job.events??[])].reverse().map(r=>r.event).find(e=>e.type==='done'||e.type==='state');
  return <section><h1>多空辩论 · 指定任务</h1><p>{job.title} · {({running:'进行中',cancelling:'正在中止',completed:'已完成',failed:'未完成',cancelled:'已中止'} as Record<string,string>)[job.status]??job.status}</p><p>任务 ID：{job.id}</p>
    {job.error&&<p role="alert">{job.error}</p>}
    {state && 'state' in state ? state.state.stages.map(s=>{
      const preview=[...(job.events??[])].reverse().map(r=>r.event).find(e=>e.type==='preview'&&e.stage===s.id);
      return <section key={s.id}><h2>{s.label} · {s.status}</h2><DebateReport content={s.text||(preview&&'text'in preview?preview.text:'')}/></section>;
    }):<p>本轮尚无已保存阶段内容。</p>}
    <p>本轮归档尚无法可靠关联；这里仅展示该任务已保存的成果。</p><Link to="/notes">浏览全部记录</Link>
  </section>;
}
export function HistoricalDebate({id,symbol}: {id:string;symbol:string}) {
  const [job,setJob]=useState<BackgroundJob|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{let disposed=false;let timer:ReturnType<typeof setTimeout>;
    const load=async()=>{let again=true;try {const result=validateDebateJob(await backend.backgroundJob(id),id,symbol);if(!disposed){setJob(result);setError('');again=['running','cancelling'].includes(result.status);}}
      catch(e){if(!disposed)setError(e instanceof Error?e.message:'任务读取失败');}
      finally{if(!disposed&&again)timer=setTimeout(load,3000);}};
    void load();return()=>{disposed=true;clearTimeout(timer);};
  },[id,symbol,retry]);
  return <div><Link to={`/tasks?job=${encodeURIComponent(id)}`}>返回该任务</Link>{error&&<p role="alert">{error} · 已有内容可能未更新 <button onClick={()=>setRetry(n=>n+1)}>重试</button></p>}{job?<HistoricalDebateResult job={job}/>:!error&&<p role="status">正在读取指定任务…</p>}</div>;
}
