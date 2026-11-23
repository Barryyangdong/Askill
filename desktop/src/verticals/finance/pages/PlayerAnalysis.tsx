import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { RefreshCw, FileUp } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { GlassCard } from "../components/ui/GlassCard";
import { PlayerEnrollment } from "../components/PlayerEnrollment";
import { PlayerSync } from "../components/PlayerSync";
import { PlayerBrowserReceive } from "../components/PlayerBrowserReceive";
import { activeMembership, type PlayerMembership } from "../lib/playerEnrollment";
import { PlayerImport, type Imported } from "../components/PlayerImport";
import { PlayerResults } from "../components/PlayerResults";
import { backend } from "../lib/backend";
import { playerControl, type Contest, type AnalysisResult } from "../lib/playerAnalysis";
import { storageGet, storageSet } from "../lib/storage";
import { usePrivacyMode } from "../hooks/usePrivacyMode";

const lastScope="player-analysis-last-scope";
export function PlayerAnalysis(){
  const [,setParams]=useSearchParams();
  const receipt=/^#contest-receive=([a-f0-9-]{36})$/.exec(useLocation().hash)?.[1];
  const [scope,setScope]=useState<{membership:PlayerMembership|null;matches:Contest[]}|null>(null);
  const [checking,setChecking]=useState(false);
  const [epoch,setEpoch]=useState(0);
  const [scopeError,setScopeError]=useState("");
  const [bindError,setBindError]=useState("");
  const {on:privateMode}=usePrivacyMode();
  const member=scope?.membership??null;
  const active=activeMembership(member)&&!checking;
  function refresh(){setScope(null);setScopeError("");setEpoch(v=>v+1);}
  useEffect(()=>{
    if(privateMode||checking)return;
    const ctl=new AbortController();
    let sequence=0;
    function readScope(){const request=++sequence;backend.playerAnalysis<{membership:PlayerMembership|null;matches:Contest[]}>(new URLSearchParams(),ctl.signal)
      .then(value=>{if(!ctl.signal.aborted&&sequence===request){setScopeError("");setScope(value);}})
      .catch(e=>{if(!ctl.signal.aborted&&sequence===request){setScope(null);const message=e instanceof Error?e.message:"无法读取绑定状态";setScopeError(/没有这个视图[:：]\s*player_analysis/.test(message)?"本机后端还在运行旧版本。请重新启动短线王后重新读取。":message);}});}
    readScope();
    const onVisible=()=>{if(document.visibilityState==="visible")readScope();};
    document.addEventListener("visibilitychange",onVisible);
    return ()=>{ctl.abort();document.removeEventListener("visibilitychange",onVisible);};
  },[epoch,privateMode,checking]);
  useEffect(()=>{
    if(privateMode||!member||member.expired)return;
    const expires=Date.parse(member.expiresAt);
    if(!Number.isFinite(expires))return;
    const timer=window.setTimeout(refresh,Math.max(0,expires-Date.now()+1));
    return ()=>window.clearTimeout(timer);
  },[member,privateMode]);
  return <main className="space-y-4"><PageHeader title="选手分析" subtitle="淘股吧实盘比赛 · 选手、仓位与共同持仓"/>
    {privateMode?<GlassCard>隐私模式已开启，退出后查看选手和持仓。</GlassCard>:<>
      {receipt&&<PlayerBrowserReceive key={receipt} nonce={receipt} membership={member} onSaved={saved=>{
        setParams({matchId:saved.matchId,divisionId:saved.divisionId,date:saved.date,revision:String(saved.revision)},{replace:true});refresh();
      }}/>}
      <PlayerSync onChanged={refresh} membership={member}/>
      {bindError&&<p role="alert" className="text-sm text-warning">{bindError}</p>}
      {scopeError&&<p role="alert" className="text-sm text-warning">{scopeError} <button onClick={refresh}>重新读取</button></p>}
      {member?.expired&&<button className={playerControl} disabled={checking} onClick={async()=>{
        setChecking(true);setBindError("");
        try{await backend.playerAnalysisAction({action:"bindProfile",userId:member.userId});}
        catch(e){setBindError(e instanceof Error?e.message:"暂时无法核验参赛记录");}
        finally{setChecking(false);refresh();}
      }}>{checking?"正在核验…":"核验参赛资格，查看本地快照"}</button>}
      {!scope&&!scopeError&&<p role="status" className="text-xs text-muted-foreground">正在读取参赛资格…</p>}
      {scope&&<details><summary className="cursor-pointer text-sm text-muted-foreground">查看公开赛事与手动核验</summary><PlayerEnrollment key={member?.userId??"new"} membership={member} onMatch={id=>setParams({matchId:id})} onChecking={value=>{setChecking(value);if(value)setBindError("");}} onVerified={error=>{setBindError(error??"");refresh();}}/></details>}
      {active&&scope&&member&&<ParticipantWorkspace key={member.userId+":"+member.checkedAt} membership={member} matches={scope.matches.filter(m=>member.matches.some(allowed=>allowed.matchId===m.matchId))} onRefresh={refresh}/>}
    </>}
  </main>;
}
function ParticipantWorkspace({membership,matches,onRefresh}:{membership:PlayerMembership;matches:Contest[];onRefresh:()=>void}){
  const [params,setParams]=useSearchParams();
  const [record,setRecord]=useState<{key:string;data:AnalysisResult}|null>(null);
  const [error,setError]=useState("");
  const [reload,setReload]=useState(0);
  const [importOpen,setImportOpen]=useState(false);
  const [message,setMessage]=useState("");

  const {on:privateMode}=usePrivacyMode();
  const matchId=params.get("matchId")||"", divisionId=params.get("divisionId")||"";
  const [remembered]=useState(()=>storageGet(lastScope+membership.userId));
  const pick=matches?.find(m=>m.matchId===matchId&&(!divisionId||m.divisionId===divisionId))||
    (!matchId?(matches?.find(m=>JSON.stringify([m.matchId,m.divisionId])===remembered)||matches?.[0]):undefined);
  const date=params.get("date")||pick?.dates[0]||"";
  const basis=params.get("rankBasis")==="today"?"today":"previous";
  const pct=params.get("groupPct");const size=pct||params.get("groupSize")||"20";
  const query=pick&&date?new URLSearchParams({expectedUserId:membership.userId,matchId:pick.matchId,divisionId:pick.divisionId,date,rankBasis:basis,[pct?"groupPct":"groupSize"]:size}):null;
  if(params.get("revision"))query?.set("revision",params.get("revision")!);
  if(params.get("asOf"))query?.set("asOf",params.get("asOf")!);
  const key=query?.toString()||"";
  const result=record?.key===key?record.data:null;
  function update(changes:Record<string,string|null>){
    setParams(prev=>{const next=new URLSearchParams(prev);for(const [k,v] of Object.entries(changes)){if(v)next.set(k,v);else next.delete(k);}return next;});
  }
  useEffect(()=>{if(!key||privateMode)return;const ctl=new AbortController();setError("");setRecord(null);
    backend.playerAnalysis<AnalysisResult>(new URLSearchParams(key),ctl.signal).then(data=>{if(!ctl.signal.aborted)setRecord({key,data});})
      .catch(e=>{if(!ctl.signal.aborted)setError(String(e.message||e));});return ()=>ctl.abort();
  },[key,reload,privateMode]);
  useEffect(()=>{if(pick)storageSet(lastScope+membership.userId,JSON.stringify([pick.matchId,pick.divisionId]));},[pick]);
  function imported(saved:Imported){
    setImportOpen(false);setMessage("已导入所选交易日的数据。");setError("");
    setParams({matchId:saved.matchId,divisionId:saved.divisionId,date:saved.date,revision:String(saved.revision)});onRefresh();
  }
  const controls="flex flex-col gap-1 text-[11px] text-muted-foreground";
  return <section className="space-y-4"><div className="flex flex-wrap justify-end gap-2">
    <button className={playerControl+" inline-flex items-center gap-1.5"} onClick={()=>setImportOpen(!importOpen)} aria-expanded={importOpen}><FileUp size={14}/>手动导入</button>
    <button className={playerControl+" inline-flex items-center gap-1.5"} onClick={()=>{setError("");setReload(v=>v+1);onRefresh();}}><RefreshCw size={13}/>重读本地数据</button></div>
    {privateMode?<GlassCard>隐私模式已开启，退出后查看选手和持仓。</GlassCard>:<>
    {message&&<p role="status" className="text-xs text-primary">{message}</p>}
    {error&&<p role="alert" className="text-sm text-warning">{error}</p>}
    {!importOpen&&!pick&&<p className="text-sm text-muted-foreground">该比赛尚无本地快照。点击「登录并采集」读取首份榜单，也可手动导入。</p>}
    {importOpen&&<section id="player-import-source"><PlayerImport key={matchId} initialMatch={matchId} membership={membership} onImported={imported}/></section>}
    {matches&&matches.length>0&&<GlassCard className="flex flex-wrap items-end gap-3">
      <label className={controls}>比赛 · 赛组<select className={playerControl} value={pick?matches.indexOf(pick):""} onChange={e=>{const m=matches[Number(e.target.value)];if(m){setMessage("");setParams({matchId:m.matchId,divisionId:m.divisionId});}}}>
        {!pick&&<option value="">请选择赛事</option>}{matches.map((m,i)=><option key={m.matchId+"|"+m.divisionId} value={i}>{m.matchName} · {m.divisionName}</option>)}</select></label>
      {pick&&<><label className={controls}>交易日<select className={playerControl} value={date} onChange={e=>update({date:e.target.value,revision:null,asOf:null,player:null,symbol:null})}>{pick.dates.map(d=><option key={d}>{d}</option>)}</select></label>
      <label className={controls}>累计收益榜分组<select className={playerControl} value={basis} onChange={e=>update({rankBasis:e.target.value})}><option value="previous">按上一交易日</option><option value="today">按所选交易日</option></select></label>
      <label className={controls}>前后组范围<select className={playerControl} value={pct?"pct":"count"} onChange={e=>update(e.target.value==="pct"?{groupPct:"10",groupSize:null}:{groupSize:"20",groupPct:null})}><option value="count">前后 N 名</option><option value="pct">前后百分比</option></select></label>
      <label className={controls}>{pct?"每组百分比（%）":"每组人数"}<input key={(pct?"p":"n")+size} type="number" min={1} max={pct?50:10000} defaultValue={size} className={playerControl+" w-24"} onBlur={e=>{const v=Number(e.target.value);if(Number.isSafeInteger(v)&&v>0&&v<=(pct?50:10000)&&v!==Number(size))update({[pct?"groupPct":"groupSize"]:String(v)});else e.target.value=size;}} onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur();}}/></label>
      {result&&<label className={controls}>数据版本<select className={playerControl} value={params.get("revision")||""} onChange={e=>update({revision:e.target.value,asOf:null})}><option value="">最新（v{result.versions[0]?.revision??result.revision}）</option>{result.versions.map(v=><option key={v.revision} value={v.revision}>v{v.revision} · {v.importedAt.slice(0,10)}</option>)}</select></label>}</>}
    </GlassCard>}
    {!error&&(!matches||(key&&!result))&&<p role="status" className="text-sm text-muted-foreground">正在读取本地赛事数据…</p>}
    {result&&pick&&<PlayerResults key={key} result={result} contest={pick} query={key} onReload={()=>setReload(v=>v+1)}/>}
    </>}
  </section>;
}


