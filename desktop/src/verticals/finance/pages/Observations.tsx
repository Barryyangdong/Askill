import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { backend, type LedgerRecord } from "../lib/backend";
import { PageHeader } from "../components/ui/PageHeader";
import { MonitorStatus } from "../components/MonitorStatus";
import { normalizeMarketSymbol } from "../lib/marketSymbol";
import { usePrivacyMode } from "../hooks/usePrivacyMode";
import { maskPrivateText } from "../lib/privacy";
import {createPatternSourceLoader, patternPlan} from "../lib/patternPlan";
import {recordSource, recordSourceHref} from "../lib/recordSource";
import {workspaceReturn} from "../lib/workspaceJourney";
import {JourneyLink} from "../components/JourneyLink";

const labels:Record<string,string>={pending:"观察中",met:"条件命中",broken:"已失效",dropped:"已停止"};
export function Observations(){
  const [params]=useSearchParams();
  return <ObservationPlan key={['id','symbol','run','pattern','thesis'].map(key=>params.get(key)??'').join(':')} />;
}
function ObservationPlan(){
  const [params]=useSearchParams();const [symbol,setSymbol]=useState(params.get("symbol")??"");const [statement,setStatement]=useState("");
  const [metric,setMetric]=useState("price");const [operator,setOperator]=useState("gte");const [threshold,setThreshold]=useState("");const [due,setDue]=useState("");const [automatic,setAutomatic]=useState(false);const [thesisId,setThesisId]=useState(params.get("thesis")??"");
  const [records,setRecords]=useState<LedgerRecord[]>([]);const [theses,setTheses]=useState<LedgerRecord[]>([]);const [checks,setChecks]=useState<Record<string,{status:string;reason?:string;checked_at:string}>>({});
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);const {on:hide}=usePrivacyMode();
  const [source,setSource]=useState<NonNullable<ReturnType<typeof patternPlan>>['source']|null>(null);
  const [recordsReady,setRecordsReady]=useState(false);const [loadError,setLoadError]=useState("");const [sourceLoading,setSourceLoading]=useState(false);const [saved,setSaved]=useState("");const [savedId,setSavedId]=useState("");const [loading,setLoading]=useState(true);
  const [sourceSupported,setSourceSupported]=useState(false);
  const returnTo=workspaceReturn(params.get("returnTo"));
  const [sourceError,setSourceError]=useState("");const statementEdited=useRef(false);
  const runId=params.get('run')??'';const requestedSymbol=params.get('symbol')??'';const pattern=params.get('pattern')??'';
  const sourceLoader=useRef<ReturnType<typeof createPatternSourceLoader>|null>(null);
  useEffect(()=>{
    if(!runId)return;
    const loader=createPatternSourceLoader(()=>backend.patternLab(),state=>{
      setSourceLoading(state.status==='loading');
      if(state.status==='loading'){setSourceError('');return;}
      if(state.status==='ready'){setSource(state.draft.source);if(!statementEdited.current)setStatement(state.draft.statement);setSourceError('');return;}
      setSource(null);setSourceError(state.status==='missing'?'原始候选记录不存在或不匹配，请回到模式重新选择。':'候选来源读取失败，请重试。');
    });
    sourceLoader.current=loader;void loader.load(runId,requestedSymbol,pattern);
    return()=>{loader.dispose();sourceLoader.current=null;};
  },[runId,requestedSymbol,pattern]);
  const requestedId=params.get("id");
  useEffect(()=>{if(recordsReady&&requestedId){const element=document.getElementById(`observation-${requestedId}`);element?.scrollIntoView({block:"center"});element?.focus();}},[recordsReady,requestedId]);
  const visible=records.filter(r=>(!requestedId||r.id===requestedId)&&(!pattern||(r.pattern_source as {pattern?:string}|undefined)?.pattern===pattern)&&(!requestedSymbol||r.symbol===normalizeMarketSymbol(requestedSymbol)));
  const load=async()=>{setLoading(true);try{const [l,c]=await Promise.all([backend.ledger(),backend.observationChecks()]);setRecords(l.records.criterion??[]);setTheses(l.records.thesis??[]);setChecks(c);setSourceSupported(!!l.kinds.criterion?.properties?.workspace_source);setRecordsReady(true);setLoadError("");}catch{setLoadError("观察记录读取失败，请重试。已有记录可能不是最新。");}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);
  const control="rounded border border-border bg-background px-3 py-2 text-xs";
  return <div><PageHeader title="观察计划" subtitle="条件、证据与核验记录"/><MonitorStatus/>
    {returnTo&&<p className="mb-3 text-xs"><Link className="text-primary" to={returnTo}>← 返回来源</Link>{!sourceSupported&&recordsReady&&<span className="ml-2 text-muted-foreground">当前服务不支持保存来源。</span>}</p>}
    {pattern&&<p className="mb-3 text-xs"><Link className="text-primary" to={`/modes?pattern=${encodeURIComponent(pattern)}`}>← 返回当前模式选候选</Link><Link className="ml-4 text-primary" to="/observations">查看全部计划</Link></p>}
    {requestedId&&recordsReady&&!loadError&&!visible.length&&<p role="status">原计划已删除或无法定位；未选择同股其他计划。</p>}
    {sourceLoading&&<p role="status">正在读取原始候选…</p>}
    {sourceError&&<p role="alert" className="mb-3 text-sm text-warning">{sourceError} <button type="button" className="underline" onClick={()=>void sourceLoader.current?.load(runId,requestedSymbol,pattern)}>重新读取候选来源</button></p>}
    {source&&<div className="mb-3 rounded border border-border p-3 text-xs">来自 {source.name} · v{source.version} · 样本日 {source.sample_date}<p className="mt-2 text-muted-foreground">{source.reason}</p><p className="mt-2">计划默认人工复核；需要自动提醒时，请另设行情条件。</p></div>}
    {(!pattern||runId)&&<form className="mb-4 grid gap-3 rounded border border-border p-4 sm:grid-cols-2" onSubmit={async e=>{
      e.preventDefault();const code=normalizeMarketSymbol(symbol);if(!code||busy||loading||!recordsReady||!!loadError||sourceLoading||(runId&&!source))return;
      if(automatic&&(!/^\d{6}$/.test(code)||!threshold.trim()||!Number.isFinite(Number(threshold)))){setError("自动核验需要 A 股代码与有效数值。");return;}
      if(thesisId&&!theses.some(t=>t.id===thesisId&&t.symbol===code)){setError("关联论点与股票不匹配，请重新选择。");return;}
      if(source&&records.some(r=>r.symbol===code&&r.status==='pending'&&(r.pattern_source as {run_id?:string}|undefined)?.run_id===source.run_id)){setError('这只股票在本次样本中已有观察计划，可在下方继续查看。');return;}
      setBusy(true);setError("");try{const origin=recordSource(returnTo);const record=await backend.ledgerSave("criterion",{symbol:code,thesis_id:thesisId,type:"decision_point",statement:statement.trim(),due,status:"pending",...(sourceSupported&&origin?{workspace_source:origin}:{}),...(source?{pattern_source:source}:{}),...(automatic?{rule:{metric,operator,value:Number(threshold)}}:{})});setRecords(previous=>[record,...previous.filter(r=>r.id!==record.id)]);setSavedId(record.id);setStatement("");setSaved(returnTo&&(!sourceSupported||!origin)?'观察计划已保存；来源未保存':'观察计划已保存');}catch(e){setError(e instanceof Error?e.message:"保存失败");}finally{setBusy(false);}
    }}>
      <label className="grid gap-1 text-xs">股票代码<input required readOnly={!!runId} className={control} value={symbol} onChange={e=>{setSymbol(e.target.value);setThesisId("");}}/></label>
      <label className="grid gap-1 text-xs">关联观察论点<select className={control} value={thesisId} onChange={e=>setThesisId(e.target.value)}><option value="">独立观察条件</option>{theses.filter(t=>t.symbol===normalizeMarketSymbol(symbol)).map(t=><option key={t.id} value={t.id}>{hide?maskPrivateText(String(t.title)):String(t.title)}</option>)}</select></label>
      <label className="grid gap-1 text-xs sm:col-span-2">观察什么<textarea required maxLength={1000} className={control} value={hide?"••••":statement} readOnly={hide} onChange={e=>{statementEdited.current=true;setStatement(e.target.value);}}/></label>
      <label className="grid gap-1 text-xs">复核日期<input type="date" className={control} value={due} onChange={e=>setDue(e.target.value)}/></label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={automatic} onChange={e=>setAutomatic(e.target.checked)}/>自动核验行情条件</label>
      {automatic&&<div className="flex flex-wrap gap-2 sm:col-span-2"><select aria-label="条件指标" className={control} value={metric} onChange={e=>setMetric(e.target.value)}><option value="price">现价（元）</option><option value="pct">涨跌幅（%）</option><option value="amount_yuan">成交额（元）</option></select><select aria-label="比较条件" className={control} value={operator} onChange={e=>setOperator(e.target.value)}><option value="gte">大于或等于</option><option value="lte">小于或等于</option></select><input aria-label="条件阈值" type={hide?"password":"text"} inputMode="decimal" required className={control} value={threshold} onChange={e=>setThreshold(e.target.value)}/><span className="self-center text-xs text-muted-foreground">连续竞价期间核验；缺数据保持无法判断</span></div>}
      <div className="sm:col-span-2"><button disabled={busy||hide||loading||!recordsReady||!!loadError||sourceLoading||!!(runId&&!source)} className="rounded bg-primary px-4 py-2 text-xs text-primary-foreground disabled:opacity-40">{busy?"保存中…":"确认建立观察条件"}</button></div>
    </form>}
    {saved&&<p role="status" className="mb-3 text-xs text-primary">{saved} <button type="button" className="ml-2 underline" onClick={()=>{const record=document.getElementById(`observation-${savedId}`);record?.scrollIntoView({block:'center'});record?.focus();}}>查看刚保存的计划 →</button></p>}
    {loadError&&<p role="alert" className="mb-3 text-sm text-warning">{loadError} <button type="button" className="underline" disabled={loading} onClick={()=>void load()}>重新读取</button></p>}
    {error&&<p role="alert" className="mb-3 text-sm text-warning">{error}</p>}
    <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs"><span>{recordsReady?`共 ${visible.length} 条 · 当前观察记录`:"观察记录尚未读取"}</span><Link className="text-primary" to="/journal/plans">复核实际执行与偏差 →</Link><button className="text-primary" disabled={loading} onClick={()=>void load()}>刷新核验结果</button></div>
    {loading&&<p role="status" className="my-6 text-sm text-muted-foreground">正在读取观察计划…</p>}
    {!loading&&recordsReady&&!loadError&&!visible.length&&<p className="my-6 text-sm text-muted-foreground">当前范围还没有观察计划。从模式候选建立，或填写上方条件。</p>}
    <div className="space-y-3">{visible.map(r=><article key={r.id} id={`observation-${r.id}`} tabIndex={-1} className="rounded border border-border p-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><JourneyLink className="text-primary" to={`/research?symbol=${encodeURIComponent(String(r.symbol??""))}`}>{String(r.symbol??"未指定股票")}</JourneyLink><span>{labels[String(r.status)]??"待复核"}{r.due?` · ${r.due}`:""}</span></div>{recordSourceHref(r.workspace_source)&&<Link className="text-primary" to={recordSourceHref(r.workspace_source)!}>返回记录来源</Link>}<p className="my-2 text-sm">{hide?maskPrivateText(String(r.statement)):String(r.statement)}</p>
      {!!r.pattern_source&&<p className="my-2 text-muted-foreground">来源：{String((r.pattern_source as Record<string,unknown>).name)} · v{String((r.pattern_source as Record<string,unknown>).version)} · 样本日 {String((r.pattern_source as Record<string,unknown>).sample_date)} <Link className="text-primary" to={`/modes?pattern=${encodeURIComponent(String((r.pattern_source as Record<string,unknown>).pattern))}`}>返回模式</Link></p>}
      {checks[r.id]&&<p className="text-muted-foreground">最近核验：{({waiting:"未命中",triggered:"条件命中",unknown:"无法判断",expired:"观察期结束"} as Record<string,string>)[checks[r.id]!.status]}{checks[r.id]!.reason?` · ${checks[r.id]!.reason}`:""} · {new Date(checks[r.id]!.checked_at).toLocaleString("zh-CN")}</p>}
      {!!r.verdict_note&&<details className="mt-2"><summary>判定依据</summary><p className="mt-2 break-words">{hide?maskPrivateText(String(r.verdict_note)):String(r.verdict_note)}</p></details>}
      {r.status==="pending"&&<button className="mt-2 text-muted-foreground" disabled={busy} onClick={async()=>{if(busy)return;setBusy(true);try{const record=await backend.ledgerSave("criterion",{...r,status:"dropped"});setRecords(previous=>previous.map(item=>item.id===record.id?record:item));}catch{setError("停止观察未保存，请重试。");}finally{setBusy(false);}}}>停止观察</button>}
    </article>)}</div>
  </div>;
}
