import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import { playerControl } from "../lib/playerAnalysis";
import { activeMembership, type PlayerMembership } from "../lib/playerEnrollment";
import type { Imported } from "./PlayerImport";
import { GlassCard } from "./ui/GlassCard";

const official="https://www.tgb.cn";
type Snapshot=Record<string,unknown>;
interface Preview {previewId:string;matchName:string;date:string;playerCount:number;warnings:string[]}

export function PlayerBrowserReceive({nonce,membership,onSaved}:{nonce:string;membership:PlayerMembership|null;onSaved:(saved:Imported)=>void}){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  useEffect(()=>{
    const source=window.opener as Window|null;
    if(!source || !["127.0.0.1","localhost","[::1]"].includes(window.location.hostname)){
      setError("当前窗口无法接收本机比赛数据，可在原比赛页保存 JSON 后导入。");return;
    }
    let received=false;
    const ready=()=>source.postMessage({type:"askill-contest-ready",nonce},official);
    const timer=window.setInterval(ready,800);
    const deadline=window.setTimeout(()=>{clearInterval(timer);setError("未收到比赛数据。请回到比赛页重新发送，或保存 JSON。");},40000);
    function onMessage(event:MessageEvent){
      if(received || event.origin!==official || event.source!==source || event.data?.nonce!==nonce || event.data?.type!=="askill-contest-snapshot")return;
      const data=event.data.snapshot;
      if(data?.schemaVersion!==1 || typeof data.matchId!=="string" || typeof data.sourceUserId!=="string" ||
         !Array.isArray(data.players) || data.players.length<1 || data.players.length>10000)return;
      received=true;clearInterval(timer);clearTimeout(deadline);setError("");setSnapshot(data);
      source?.postMessage({type:"askill-contest-received",nonce},official);
    }
    window.addEventListener("message",onMessage);ready();
    return ()=>{clearInterval(timer);clearTimeout(deadline);window.removeEventListener("message",onMessage);};
  },[nonce]);
  useEffect(()=>{
    let current=true;
    setPreview(null);
    if(!snapshot || !activeMembership(membership))return;
    if(membership.userId!==snapshot.sourceUserId || !membership.matches.some(m=>m.matchId===snapshot.matchId&&m.spmatchSeq===snapshot.sourceMatchSeq)){
      setError("来源账号或比赛与本机核验记录不符。");return;
    }
    setError("");
    backend.playerAnalysisAction<Preview>({action:"previewImport",expectedUserId:membership.userId,data:snapshot})
      .then(p=>{if(current)setPreview(p);})
      .catch(e=>{if(current)setError(e instanceof Error?e.message:"榜单校验失败");});
    return ()=>{current=false;};
  },[snapshot,membership]);
  async function save(){
    if(!preview || !activeMembership(membership) || saving)return;
    setSaving(true);setError("");
    try{onSaved(await backend.playerAnalysisAction<Imported>({action:"commitImport",expectedUserId:membership.userId,previewId:preview.previewId}));}
    catch(e){setError(e instanceof Error?e.message:"保存失败");}
    finally{setSaving(false);}
  }
  return <GlassCard className="space-y-2"><h2 className="font-semibold">接收浏览器采集结果</h2>
    {preview&&activeMembership(membership)?<>
      <p className="text-sm">{preview.matchName} · {preview.date} · {preview.playerCount} 名选手</p>
      {preview.warnings.map(w=><p className="text-xs text-warning" key={w}>{w}</p>)}
      <button className={playerControl} disabled={saving} onClick={()=>void save()}>{saving?"正在保存…":"保存并查看分析"}</button>
    </>:!error&&<p role="status" className="text-sm text-muted-foreground">{snapshot?(activeMembership(membership)?"正在核对当日榜单…":"已收到榜单，请在下方核验本机参赛账号。"):"等待比赛页发送已采集的榜单…"}</p>}
    {error&&<p role="alert" className="text-xs text-warning">{error}</p>}
  </GlassCard>;
}
