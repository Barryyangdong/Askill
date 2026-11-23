import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { backend, type BackgroundJob, type DebateState } from "../lib/backend";
import { PageHeader } from "../components/ui/PageHeader";
import { DebateReport } from "../components/DebateReport";
import { JourneyLink } from "../components/JourneyLink";
import { MonitorStatus } from "../components/MonitorStatus";
import { hydrateNotes, loadNotes } from "../lib/notes";

const labels: Record<string,string> = { running: "进行中", cancelling: "正在中止", completed: "已完成", failed: "未完成", cancelled: "已中止" };
const statusLabel=(job:BackgroundJob)=>job.status==='completed'&&job.outcome==='needs_input'?'等待补充参数':labels[job.status]??job.status;
export function Tasks() {
  const [params,setParams]=useSearchParams();
  const [filter,setFilter]=useState('all');
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const selected = params.get('job')??"";
  const [received, setDetail] = useState<BackgroundJob | null>(null);
  const detail = received?.id === selected ? received : null;
  const [error, setError] = useState("");
  const [healthError, setHealthError] = useState(false);
  const [health,setHealth]=useState<Awaited<ReturnType<typeof backend.sourceHealth>>>([]);
  const [listLoading,setListLoading]=useState(true);
  const [detailError,setDetailError]=useState('');
  const [refreshVersion,setRefreshVersion]=useState(0);
  const [archiveMatch,setArchiveMatch]=useState<{job:string; id:string}|null>(null);
  useEffect(()=>{
    if(!selected || !detail || detail.status === 'running')return;
    let gone=false;
    void hydrateNotes().then(()=>{if(gone)return;const found=loadNotes().filter(n=>n.source?.job===selected);setArchiveMatch(found.length===1?{job:selected,id:found[0]!.id}:null);}).catch(()=>{if(!gone)setArchiveMatch(null);});
    return()=>{gone=true;};
  },[selected,detail?.status]);
  useEffect(() => {
    let disposed=false; let timer:ReturnType<typeof setTimeout>;
    const refresh=async()=>{
      try{const rows=await backend.backgroundJobs();if(!disposed){setJobs(rows);setError('');}}
      catch{if(!disposed)setError('任务列表暂未更新，已有任务仍在后台运行。');}
      finally{if(!disposed){setListLoading(false);timer=setTimeout(refresh,2000);}}
    };
    void refresh();return()=>{disposed=true;clearTimeout(timer);};
  },[refreshVersion]);
  useEffect(()=>{
    if(!selected)return;
    let disposed=false;let timer:ReturnType<typeof setTimeout>;
    setDetailError('');
    const refresh=async()=>{
      try{const job=await backend.backgroundJob(selected);if(!disposed){setDetail(job);setDetailError('');}}
      catch{if(!disposed)setDetailError('所选任务暂时无法读取。可重试或选择其他任务。');}
      finally{if(!disposed)timer=setTimeout(refresh,2000);}
    };
    void refresh();return()=>{disposed=true;clearTimeout(timer);};
  },[selected,refreshVersion]);
  useEffect(()=>{
    let disposed=false;let timer:ReturnType<typeof setTimeout>;
    const refresh=async()=>{
      try{const sources=await backend.sourceHealth();if(!disposed){setHealth(sources);setHealthError(false);}}
      catch{if(!disposed)setHealthError(true);}
      finally{if(!disposed)timer=setTimeout(refresh,30000);}
    };
    void refresh();return()=>{disposed=true;clearTimeout(timer);};
  },[]);
  const matches=(job:BackgroundJob)=>filter==='all'||(filter==='active'&&['running','cancelling'].includes(job.status))||(filter==='attention'&&(job.status==='failed'||job.outcome==='needs_input'))||(filter==='done'&&job.status==='completed'&&job.outcome!=='needs_input');
  const visibleJobs=jobs.filter(matches);
  const state = [...(detail?.events ?? [])].reverse().find(r => r.event.type === "done" || r.event.type === "state")?.event as { state?: DebateState } | undefined;
  const latestPreview=(id:string)=>[...(detail?.events??[])].reverse().find(r=>r.event.type==='preview'&&r.event.stage===id)?.event as {text?:string}|undefined;
  const dossier=[...(detail?.events??[])].reverse().find(r=>r.event.type==='dossier')?.event as {title?:string;loaded?:number;total?:number}|undefined;
  const phase=[...(detail?.events??[])].reverse().map(r=>r.event as unknown as {type:string;phase?:string}).find(e=>e.type==='guided_phase')?.phase;
  return <div>
    <PageHeader title="任务中心" subtitle="后台运行 · 离开页面继续处理" />
    <MonitorStatus />
    <details className="mb-4 rounded border border-border p-3"><summary className="cursor-pointer text-sm">数据源状态 · {health.filter(r=>r.consecutive_failures>0).length} 项最近失败</summary>
      {healthError && <p role="status" className="text-xs text-warning">数据源统计暂未更新，任务状态独立更新。</p>}
      <div className="mt-3 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>来源端点</th><th>成功 / 失败</th><th>缓存命中</th><th>直连成功率</th><th>近100次耗时 P50 / P95</th><th>最近耗时</th><th>最近访问</th></tr></thead><tbody>{health.map(r=><tr key={r.endpoint} className="border-t border-border"><td className="py-2">{r.endpoint}</td><td className={r.consecutive_failures?"text-warning":""}>{r.success} / {r.failed}</td><td>{r.cached}</td><td>{r.success_rate==null?"—":`${(r.success_rate*100).toFixed(1)}%`}</td><td>{r.p50_ms==null?"—":`${r.p50_ms} / ${r.p95_ms} ms`}<span className="ml-2 text-muted-foreground">n={r.latency_samples??0}</span></td><td>{r.last_ms} ms</td><td>{new Date(r.last_at).toLocaleString("zh-CN")}</td></tr>)}</tbody></table></div>
      <p className="mt-2 text-xs text-muted-foreground">本机观测；缓存命中单列，成功次数不代表行情实时性。</p>
    </details>
    {error && <p role="alert" className="mb-3 text-sm text-warning">{error}</p>}
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <section aria-label="后台任务" className="space-y-2">
        <div role="group" aria-label="任务状态筛选" className="mb-3 flex flex-wrap gap-1 text-xs">{[['all','全部'],['active','进行中'],['attention','待处理'],['done','已完成']].map(([key,label])=><button key={key} type="button" aria-pressed={filter===key} className={`rounded px-2 py-2 ${filter===key?'bg-muted text-foreground':'text-muted-foreground'}`} onClick={()=>setFilter(key!)}>{label}</button>)}</div>
        {!!jobs.length&&!visibleJobs.length&&<p role="status" className="p-3 text-xs text-muted-foreground">这个状态下没有任务。</p>}

        {listLoading&&<p role="status" className="p-4 text-sm text-muted-foreground">正在读取任务列表…</p>}
        {!listLoading&&!error&&!jobs.length && <p className="p-4 text-sm text-muted-foreground">还没有后台任务。发起多空辩论或回测后可在此跟踪。</p>}
        {visibleJobs.map(j => <button key={j.id} aria-pressed={selected === j.id} onClick={() => { setParams(previous=>{const next=new URLSearchParams(previous);next.set("job",j.id);return next;},{replace:true}); }} className={`w-full rounded border p-3 text-left ${selected === j.id ? "border-primary" : "border-border"}`}>
          <span className="flex justify-between text-sm"><strong>{j.title}</strong><span>{statusLabel(j)}</span></span>
          <time className="mt-1 block text-xs text-muted-foreground">{new Date(j.created_at).toLocaleString("zh-CN")}</time>
        </button>)}
      </section>
      <section className="min-w-0 rounded border border-border p-4">
        {detailError&&<p role="alert" className="mb-3 text-sm text-warning">{detailError} <button type="button" className="underline" onClick={()=>setRefreshVersion(n=>n+1)}>重试</button></p>}
        {!detail ? <p role="status" className="text-sm text-muted-foreground">{selected ? (detailError ? "任务内容尚未取得。" : "正在读取所选任务…") : "选择任务查看阶段和已生成内容。"}</p> : <>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm"><strong>{detail.title} · {statusLabel(detail)}</strong>
            {detail.key.startsWith("debate:") && <JourneyLink className="text-primary" to={`/debate?job=${encodeURIComponent(detail.id)}&symbol=${encodeURIComponent(detail.key.slice(7))}`}>打开辩论</JourneyLink>}
            {detail.key.startsWith("guided:backtest:")&&<JourneyLink className="text-primary" to={`/backtest?job=${encodeURIComponent(detail.id)}`}>查看回测结果 / 继续补充</JourneyLink>}
            {archiveMatch?.job===detail.id?<JourneyLink className="text-primary" to={`/notes?id=${encodeURIComponent(archiveMatch.id)}`}>查看本轮记录</JourneyLink>:<><JourneyLink className="text-primary" to="/notes">浏览全部记录</JourneyLink><span className="text-xs text-muted-foreground">本轮归档尚无法可靠关联，请以任务内成果为准。</span></>}
            {detail.status === "running" && <button className="text-warning" onClick={() => void backend.cancelBackgroundJob(detail.id).catch(() => setError("中止请求未送达，请重试。"))}>中止任务</button>}
          </div>
          {detail.error && <p role="alert" className="mb-3 text-sm text-warning">{detail.error}</p>}
          {detail.status==='running'&&<p role="status" className="mb-3 text-xs text-muted-foreground">已运行 {Math.max(0,Math.floor((Date.now()-Date.parse(detail.created_at))/1000))} 秒 · {dossier?.title}{dossier?.total?` ${dossier.loaded}/${dossier.total}`:''}</p>}
          {state?.state?.stages.map(s => <details key={s.id} className="mb-3 rounded border border-border p-3" open={s.id === "referee"}>
            <summary className="cursor-pointer text-sm font-medium">{s.label} · {({done:"已完成",pending:"待开始",running:"进行中",failed:"未完成",cancelled:"已中止",aborted:"已中止"} as Record<string,string>)[s.status] ?? s.status}</summary>
            {(s.text||latestPreview(s.id)?.text)&&<div className="mt-3">{s.status==='running'&&<p className="mb-2 text-xs text-muted-foreground">正在生成 · 尚未定稿</p>}<DebateReport content={s.text||latestPreview(s.id)!.text!} /></div>}
          </details>)}
          {!state && <p role="status" className="text-sm text-muted-foreground">{detail.key.startsWith("guided:")?`${detail.status==='running'?({catalog:'读取工具能力',plan:'确认参数与实验规则',execute:'读取历史数据并计算',compose:'整理结果与口径'} as Record<string,string>)[phase??'']??'正在准备':''} · 完整回复与图表可从上方入口查看。`:detail.status==="running"?"正在准备共同资料…":"本轮没有生成完整阶段内容。"}</p>}
        </>}
      </section>
    </div>
  </div>;
}
