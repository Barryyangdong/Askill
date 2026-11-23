import { useState } from "react";
import { backend } from "../lib/backend";
import { playerControl } from "../lib/playerAnalysis";
import { activeMembership, contestId, profileId, type PlayerMembership } from "../lib/playerEnrollment";
import { GlassCard } from "./ui/GlassCard";
import { PlayerPublicCatalog } from "./PlayerPublicCatalog";

export function PlayerEnrollment({membership,onChecking,onVerified,onMatch}:{membership:PlayerMembership|null;onChecking:(busy:boolean)=>void;onVerified:(error?:string)=>void;onMatch?:(id:string)=>void}){
  const [input,setInput]=useState(membership?.userId??"");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [link,setLink]=useState("");
  const active=activeMembership(membership);
  async function verify(){
    const id=profileId(membership&&!membership.canRebind?membership.userId:input);
    if(!id){setError("请输入数字用户 ID，或粘贴本人淘股吧 /blog/数字ID 主页链接。");return;}
    const requested=link.trim()?contestId(link):null;
    if(link.trim()&&!requested){setError("请粘贴淘股吧比赛详情链接，链接中应包含 tid。");return;}
    setBusy(true);onChecking(true);setError("");
    try{
      const result=await backend.playerAnalysisAction<{membership:PlayerMembership}>({action:"bindProfile",userId:id});
      if(requested&&!result.membership.matches.some(m=>m.matchId===requested))throw new Error("该账号的在赛记录中没有这场比赛，请核对报名账号和比赛链接。");
      if(requested)onMatch?.(requested);
      onVerified();
    }catch(e){onVerified(e instanceof Error?e.message:"参赛记录暂时无法核验，请稍后重试。");}
    finally{setBusy(false);onChecking(false);}
  }
  return <GlassCard className="space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{active?"已核验的参赛记录":"核验参赛记录"}</h2>
      <a href="https://www.tgb.cn/spmatch/index/" target="_blank" rel="noreferrer" className="text-xs text-primary">淘股吧比赛报名 ↗</a></div>
    {membership&&<p className="text-xs text-muted-foreground">账号 {membership.userId} · 最近核验 {new Date(membership.checkedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})} · {membership.expired||Date.parse(membership.expiresAt)<=Date.now()?"已到期，请重新核验":membership.matches.length+" 场在赛记录"}</p>}
    {membership?.canRebind&&<p className="text-xs text-muted-foreground">首次导入前可更正本人主页。导入后，此本地数据区固定关联该账号。</p>}
    {active&&<><p className="text-sm">{membership.matches.map(m=>m.name).join("、")}</p><p className="text-xs text-muted-foreground">以上是所填主页的公开在赛记录。当前支持本地导入，读取官网近期持仓仍需本人登录并具有该场权限。</p></>}
    {!active&&<p className="text-xs text-muted-foreground">先在淘股吧报名，再填写本人主页和对应比赛。核验同场参赛记录后，可读取本人在官网可见的近期报单并核对持仓截图。</p>}
    <form className="flex flex-wrap items-center gap-2" onSubmit={e=>{e.preventDefault();if(!busy)void verify();}}>
      {(!membership||membership.canRebind)&&<input className={playerControl+" min-w-56"} aria-label="本人淘股吧用户 ID 或主页链接" value={input} onChange={e=>setInput(e.target.value)} placeholder="本人用户 ID 或主页链接"/>}
      <input className={playerControl+" min-w-56"} aria-label="已报名的淘股吧比赛链接" value={link} onChange={e=>setLink(e.target.value)} placeholder="已报名的比赛链接（可选）"/>
      <button disabled={busy||!(membership||input.trim())} className={playerControl}>{busy?"正在核验…":membership?"重新核验参赛记录":"核验我的比赛"}</button>
    </form>
    {error&&<p role="alert" className="text-xs text-warning">{error}</p>}
    {!active&&<PlayerPublicCatalog/>}
  </GlassCard>;
}

