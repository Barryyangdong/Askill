import { useEffect, useRef, useState } from "react";
import { backend } from "../lib/backend";
import { playerControl } from "../lib/playerAnalysis";
import { activeMembership, contestId, type PlayerMembership } from "../lib/playerEnrollment";
import { PlayerContestReader } from "./PlayerContestReader";
import { GlassCard } from "./ui/GlassCard";

interface Connection {id:string;name:string|null;userId:string|null;lastDate:string|null;message:string;paused:number}
interface VisibleDay {matchId:string;day:string;players:number}
interface VisiblePlayer {id:string;name:string;rank:number|null;totalReturn:number|null;dayReturn:number|null;exposure:number|null;symbols:string[];holdingsState:string}
interface Status {busy:boolean;message:string;contests:Connection[];visibleDays?:VisibleDay[];time:string;windows:boolean;attempt?:string;connectionError?:string|null}
const contestUrl=(id:string)=>"https://www.tgb.cn/spmatch/matchAll?tid="+encodeURIComponent(id);
const percent=(v:number|null)=>v===null?"—":(100*v).toFixed(2)+"%";

function VisibleStandings({day}:{day:VisibleDay}){
  const [rows,setRows]=useState<VisiblePlayer[]|null>(null),[page,setPage]=useState(0),[error,setError]=useState("");
  async function load(){
    setError("");
    try{const result=await backend.playerSync<{players:VisiblePlayer[]}>({action:"visibleResult",url:contestUrl(day.matchId),day:day.day});setRows(result.players);}
    catch(e){setError(e instanceof Error?e.message:"读取榜单失败");}
  }
  return <details className="border-t border-border pt-2 text-sm" onToggle={e=>{if(e.currentTarget.open)void load();}}>
    <summary className="cursor-pointer">官网可见榜单 · {day.matchId} · {day.day} · {day.players} 名选手</summary>
    {error&&<p role="alert">{error}</p>}
    {rows&&<div className="mt-2 overflow-auto"><table className="w-full text-left text-xs"><thead><tr>{["总排名","选手","总收益","当日收益","仓位","可见持仓"].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>
      {rows.slice(page*50,(page+1)*50).map(p=><tr key={p.id} className="border-t border-border"><td className="p-2">{p.rank??"—"}</td><td>{p.name}</td><td>{percent(p.totalReturn)}</td><td>{percent(p.dayReturn)}</td><td>{percent(p.exposure)}</td><td>{p.holdingsState==="empty"?"空仓":p.symbols.length?p.symbols.join("、"):"未披露或不可见"}</td></tr>)}
    </tbody></table>{rows.length>50&&<div className="flex items-center gap-2"><button className={playerControl} disabled={!page} onClick={()=>setPage(page-1)}>上一页</button>{page+1} / {Math.ceil(rows.length/50)}<button className={playerControl} disabled={(page+1)*50>=rows.length} onClick={()=>setPage(page+1)}>下一页</button></div>}</div>}
  </details>;
}

export function PlayerSync({onChanged,membership=null}:{onChanged:()=>void;membership?:PlayerMembership|null}){
  const [state,setState]=useState<Status|null>(null);
  const [url,setUrl]=useState("");
  const [time,setTime]=useState("18:30");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [sending,setSending]=useState(false);
  const prior=useRef("");
  const savedTime=useRef("");
  const change=useRef(onChanged);
  change.current=onChanged;
  const epoch=useRef(0);
  const attempt=useRef<string|undefined>(undefined);
  function apply(value:Status){
    if(value.attempt)attempt.current=value.attempt;
    if(value.connectionError){setError(value.connectionError);attempt.current=undefined;}
    if(!value.busy)attempt.current=undefined;
    if(value.time!==savedTime.current){savedTime.current=value.time;if(value.time)setTime(value.time);}
    const signature=JSON.stringify(value.contests);
    if(prior.current && prior.current!==signature && !value.busy) change.current();
    if(!value.busy)prior.current=signature;
    setState(value);
  }
  useEffect(()=>{
    const ctl=new AbortController();
    let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      const version=epoch.current;
      let next=3500;
      try {
        const value=await backend.playerSync<Status>(undefined,ctl.signal,attempt.current);
        if(ctl.signal.aborted)return;
        if(version===epoch.current){apply(value);next=value.busy?2000:10000;}
      } catch(e){if(!ctl.signal.aborted)setError(e instanceof Error?e.message:"无法读取同步状态");}
      if(!ctl.signal.aborted)timer=setTimeout(poll,next);
    }
    void poll();return ()=>{ctl.abort();clearTimeout(timer);};
  },[]);
  async function act(body:Record<string,unknown>){
    epoch.current++;setSending(true);setError("");setNotice("");
    try{apply(await backend.playerSync<Status>(body));}
    catch(e){setError(e instanceof Error?e.message:"比赛同步操作失败");}
    finally{epoch.current++;setSending(false);}
  }
  async function openContest(link:string){
    if(!contestId(link)){setNotice("");setError("请粘贴带 tid 的淘股吧比赛详情链接。");return;}
    setSending(true);setNotice("");setError("");
    try{
      await backend.playerSync({action:"openInBrowser",url:link});
      const linked=state?.contests.find(c=>c.id===contestId(link));
      setNotice(linked?.userId
        ? (linked.paused?"已将比赛链接交给浏览器。该场后台同步已暂停，请重新连接同步账号。":"已将比赛链接交给浏览器。该场已连接，可点击「立即同步」。")
        : "已将比赛链接交给默认浏览器。已核验的参赛账号可用本场读取书签采集并送回工作台。");
    } catch(e){setError(e instanceof Error?e.message:"系统未能打开比赛链接");}
    finally{setSending(false);}
  }
  const disabled=sending||!!state?.busy;
  const selected=activeMembership(membership)?membership.matches.find(m=>m.matchId===contestId(url)):undefined;
  return <GlassCard className="space-y-3"><h2 className="font-semibold">淘股吧比赛</h2>
    <p className="text-sm text-muted-foreground">粘贴比赛链接，在采集窗口登录淘股吧。未报名也可读取官网可见榜单。核验到本场报名后，可继续使用参赛账号同步和盘后任务。</p>
    <form className="flex flex-wrap gap-2" onSubmit={e=>{
      e.preventDefault();if(!contestId(url)){setError("请粘贴带 tid 的淘股吧比赛详情链接。");return;}
      if(!disabled)void act({action:"connect",url});
    }}>
      <input className={playerControl+" min-w-52 flex-1"} aria-label="比赛详情链接" placeholder="粘贴淘股吧比赛链接" value={url} onChange={e=>setUrl(e.target.value)}/>
      <button className={playerControl} disabled={disabled||!url.trim()}>登录并采集</button>
      <button type="button" className={playerControl} disabled={sending||!url.trim()} onClick={()=>void openContest(url)}>用默认浏览器查看</button>
    </form>
    {notice&&<p className="text-xs text-muted-foreground" role="status">{notice}</p>}
    {selected?.spmatchSeq&&membership?<PlayerContestReader match={selected} userId={membership.userId} title="用已登录的默认浏览器采集"/>:
      <details className="text-sm"><summary className="cursor-pointer">用已登录的默认浏览器采集</summary>
        <p className="mt-2 text-xs text-muted-foreground">先在下方核验本人参赛记录，再在上方填写该场比赛链接，即可获取本场读取书签。</p>
      </details>}
    {state?.message&&<p className="text-xs text-muted-foreground" role="status">{state.message}</p>}
    {state?.visibleDays?.map(day=><VisibleStandings key={day.matchId+day.day} day={day}/>)}
    {state?.contests.map(c=><div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
      <div className="min-w-0"><p className="text-sm font-medium">{c.name||"比赛 "+c.id}</p><p className="text-xs text-muted-foreground">{c.message}{c.lastDate?" · 最近入库 "+c.lastDate:""}</p></div>
      <div className="flex flex-wrap gap-2"><button className={playerControl} disabled={sending} onClick={()=>void openContest(contestUrl(c.id))}>用默认浏览器打开</button>
      <button className={playerControl} disabled={disabled} onClick={()=>void act({action:"connect",url:contestUrl(c.id)})}>重新连接同步账号</button>
      {c.userId&&!c.paused&&<button className={playerControl} disabled={disabled} onClick={()=>void act({action:"sync",url:contestUrl(c.id)})}>立即同步</button>}</div>
    </div>)}
    {state?.windows&&(state.time||state.contests.some(c=>c.userId&&!c.paused))&&<div className="space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2 text-sm"><label>盘后自动同步 <input className={playerControl} type="time" value={time} onChange={e=>setTime(e.target.value)}/></label>
      <button className={playerControl} disabled={disabled||!time} onClick={()=>void act({action:"schedule",time})}>{state.time?"更新时间":"启用定时"}</button>
      {state.time&&<button className={playerControl} disabled={disabled} onClick={()=>void act({action:"schedule",time:""})}>关闭定时</button>}</div>
      <p className="text-xs text-muted-foreground">{state.time?"已启用，每周一至五 "+state.time+"（本机时间）。":"定时未启用。"}电脑开机且 Windows 用户已登录时，可关闭工作台，由系统同步已连接比赛。</p>
    </div>}
    {error&&<p role="alert" className="text-xs text-warning">{error} <button type="button" onClick={()=>setError("")} aria-label="关闭提示">关闭</button></p>}
  </GlassCard>;
}
