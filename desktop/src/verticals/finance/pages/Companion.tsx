import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {backend,type BackgroundJob} from '../lib/backend';
import {PageHeader} from '../components/ui/PageHeader';
import {HomeTasks} from '../components/HomeTasks';
import {MonitorStatus} from '../components/MonitorStatus';
import {usePrivacyMode} from '../hooks/usePrivacyMode';
import {maskPrivateText} from '../lib/privacy';

export function CompanionJobs({jobs,hide=false}:{jobs:BackgroundJob[];hide?:boolean}){
 const labels:Record<string,string>={running:'进行中',cancelling:'正在中止',completed:'已完成',failed:'未完成',cancelled:'已中止'};
 return <section aria-label="最近研究任务" className="rounded border border-border p-3"><h2 className="mb-2 text-sm font-semibold">最近研究</h2>{jobs.slice(0,6).map(job=><Link key={job.id} className="flex min-h-14 items-center justify-between gap-3 border-t border-border py-3 text-sm" to={`/tasks?job=${encodeURIComponent(job.id)}`}><span className="min-w-0 break-words">{hide?maskPrivateText(job.title):job.title}</span><span className="shrink-0 text-xs text-muted-foreground">{job.outcome==='needs_input'?'等待补参':labels[job.status]??'状态未知'}</span></Link>)}{!jobs.length&&<p className="py-3 text-xs text-muted-foreground">暂无研究任务</p>}</section>;
}
export function Companion(){
 const [jobs,setJobs]=useState<BackgroundJob[]|null>(null);const [error,setError]=useState('');const [updated,setUpdated]=useState<string|null>(null);const {on:hide}=usePrivacyMode();
 const retryRef=useRef<()=>void>(()=>{});
 useEffect(()=>{
  let gone=false; let timer:ReturnType<typeof setTimeout>|undefined; let timeout:ReturnType<typeof setTimeout>|undefined;
  let controller:AbortController|null=null; let generation=0;
  const clear=()=>{if(timer)clearTimeout(timer);if(timeout)clearTimeout(timeout);};
  const load=()=>{
   clear(); controller?.abort(); const run=++generation;
   if(document.visibilityState==='hidden'){timer=setTimeout(load,5000);return;}
   const ctrl=new AbortController();controller=ctrl;
   timeout=setTimeout(()=>{if(gone||run!==generation)return;ctrl.abort();generation++;setError('任务读取超时，可重试；下方保留上次结果。');timer=setTimeout(load,5000);},12000);
   void backend.backgroundJobs(ctrl.signal).then(data=>{if(gone||run!==generation)return;setJobs(data);setError('');setUpdated(new Date().toLocaleString('zh-CN'));}).catch(()=>{if(!gone&&run===generation)setError('连接暂不可用，下方保留上次结果。');}).finally(()=>{if(gone||run!==generation)return;if(timeout)clearTimeout(timeout);timer=setTimeout(load,5000);});
  };
  retryRef.current=load;load();return()=>{gone=true;generation++;clear();controller?.abort();retryRef.current=()=>{};};
 },[]);
 return <div className="mx-auto max-w-3xl"><PageHeader title="随身看板" subtitle="观察、提醒与研究进度"/><div className="mb-4 grid grid-cols-2 gap-2">{[['/observations','观察条件'],['/inbox','提醒收件箱'],['/shortline','盘后复盘'],['/workbench','完整工作台']].map(([to,label])=><Link key={to} to={to!} className="flex min-h-12 items-center justify-center rounded border border-border bg-card px-3 text-sm">{label}</Link>)}</div><MonitorStatus/><button type="button" className="mb-3 rounded border border-border px-3 py-1 text-xs" onClick={()=>retryRef.current()}>刷新研究任务</button>{error&&<p role="status" className="mb-3 text-xs text-warning">{error}</p>}{updated&&<p className="mb-3 text-xs text-muted-foreground">任务状态更新 {updated} · 服务运行时每 5 秒检查</p>}<HomeTasks/>{jobs?<CompanionJobs jobs={jobs} hide={hide}/>:<p role="status" className="p-3 text-xs text-muted-foreground">{error?"研究任务尚未加载":"正在读取研究任务…"}</p>}<details className="mt-4 text-xs text-muted-foreground"><summary className="cursor-pointer">跨设备连接</summary><p className="mt-2">本页是窄屏入口。手机必须通过部署者已配置的 HTTPS 访问地址连接同一服务；localhost 只指向当前设备。关闭电脑服务后不能继续接收更新。此入口不自动开放端口，不绕过原有访问认证。</p><Link className="mt-2 inline-block text-primary" to="/settings">查看部署与连接设置 →</Link></details></div>;
}
