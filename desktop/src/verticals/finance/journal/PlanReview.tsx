import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {backend,type LedgerRecord} from '../lib/backend';
export const executionLabels:Record<string,string>={unreviewed:'待复核',stale:'条件已变更',not_triggered:'条件未发生',unexecuted:'发生但未执行',as_planned:'按计划执行',deviation:'执行偏差',unknown:'证据不足'};
type Data={criteria:LedgerRecord[];reviews:LedgerRecord[];trades:LedgerRecord[];counts:Record<string,number>};
export function PlanReview({hide}:{hide:boolean}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [selected,setSelected]=useState(''),[outcome,setOutcome]=useState('unknown'),[reason,setReason]=useState(''),[tradeIds,setTradeIds]=useState<string[]>([]);
 const load=async()=>setData(await backend.planReview());
 useEffect(()=>{void load().catch(()=>setError('计划复核未读取，请重试。'));},[]);
 const criterion=data?.criteria.find(c=>c.id===selected);
 const control='rounded border border-border bg-background p-2 text-xs';
 return <section aria-label="计划执行复核" className="space-y-4">
   <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">计划 → 条件 → 执行复核</h2><Link className="text-xs text-primary" to="/observations">建立或查看观察条件 →</Link></div>
   <p className="text-xs text-muted-foreground">复核由本人确认；行情命中不代表已经执行。成交与复核依据仅存本机，不进入 AI。</p>
   {error&&<p role="alert" className="text-warning text-sm">{error}<button className="ml-2 underline" onClick={()=>void load().then(()=>setError('')).catch(()=>setError('读取失败，请重试。'))}>重新读取</button></p>}
   {data&&<>
     <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{Object.entries(executionLabels).map(([key,label])=><div key={key} className="rounded border border-border p-3"><p className="text-xs text-muted-foreground">{label}</p><strong className="text-lg">{data.counts[key]??0}</strong></div>)}</div>
     {!data.criteria.length?<p className="rounded border border-dashed border-border p-6 text-sm text-muted-foreground">先建立观察条件；复核不会凭空创建计划或推断成交。</p>:<form className="grid gap-3 rounded border border-border p-4 sm:grid-cols-2" onSubmit={async e=>{e.preventDefault();if(busy||hide)return;setBusy(true);setError('');try{await backend.savePlanReview({criterion_id:selected,outcome,reason,trade_ids:tradeIds});setReason('');await load();}catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}}}>
       <label className="grid gap-1 text-xs">对应观察条件<select required className={control} value={selected} onChange={e=>{setSelected(e.target.value);setTradeIds([]);}}><option value="">选择已有条件</option>{data.criteria.map(c=><option key={c.id} value={c.id}>{String(c.symbol??'市场')} · {hide?'内容已隐藏':String(c.statement)}</option>)}</select></label>
       <label className="grid gap-1 text-xs">本次执行复核<select className={control} value={outcome} onChange={e=>{setOutcome(e.target.value);setTradeIds([]);}}>{Object.entries(executionLabels).filter(([key])=>!['unreviewed','stale'].includes(key)).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
       {criterion&&<p className="text-xs text-muted-foreground sm:col-span-2">计划建立于 {new Date(criterion.created_at).toLocaleString('zh-CN')} · 到期 {String(criterion.due||'未设置')} · 条件状态 {({pending:'待核验',met:'已命中',broken:'已失效',dropped:'已停止'} as Record<string,string>)[String(criterion.status)]??'待复核'}</p>}
       {['as_planned','deviation','unknown'].includes(outcome)&&criterion&&<fieldset className="sm:col-span-2"><legend className="mb-2 text-xs">关联同股成交（最多 50 条）</legend><div className="max-h-40 overflow-auto space-y-2">{data.trades.filter(t=>t.symbol===criterion.symbol).map(t=><label key={t.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={tradeIds.includes(t.id)} onChange={e=>setTradeIds(ids=>e.target.checked?[...ids,t.id]:ids.filter(id=>id!==t.id))}/>{String(t.date)} · {String(t.type)} · {hide?'••••':`${t.shares??'—'} 股 / ${t.price??'—'} 元`}</label>)}</div>{!data.trades.some(t=>t.symbol===criterion.symbol)&&<p className="text-xs text-muted-foreground">暂无同股成交；可先到交易记录补齐明细，或选择证据不足。</p>}</fieldset>}
       <label className="grid gap-1 text-xs sm:col-span-2">复核依据<textarea required maxLength={2000} readOnly={hide} className={control} value={hide?'••••':reason} onChange={e=>setReason(e.target.value)} placeholder="说明条件是否发生、实际执行与原计划的差异，以及依据。"/></label>
       <button disabled={busy||hide||!selected} className="rounded bg-primary px-4 py-2 text-xs text-primary-foreground disabled:opacity-40 sm:justify-self-start">{busy?'保存中…':'保存新的复核版本'}</button>
     </form>}
     <div className="space-y-2">{data.reviews.map(r=><details key={r.id} className="rounded border border-border p-3 text-xs"><summary className="cursor-pointer">{String(r.symbol??'市场')} · {executionLabels[String(r.outcome)]} · {new Date(r.created_at).toLocaleString('zh-CN')}</summary><p className="mt-2 whitespace-pre-wrap">{hide?'••••':String(r.reason)}</p><p className="mt-2 text-muted-foreground">保留当次条件与成交快照；每次复核新增版本，统计按每条条件的最新复核。</p></details>)}</div>
   </>}
 </section>;
}
