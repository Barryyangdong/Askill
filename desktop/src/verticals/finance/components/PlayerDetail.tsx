import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { GlassCard } from "./ui/GlassCard";
import { KlineCard } from "./KlineCard";
import { ObservationDraftButton } from "./ui/ObservationDraftButton";
import { DataTable, MemberDialog, stockTitle } from "./PlayerAnalysisTable";
import { backend } from "../lib/backend";
import { holdingsLabels, playerControl, playerTabs, ratio, reportLabels, type AnalysisResult, type Contest, type Holdings, type Player, type PlayerRow, type Stock } from "../lib/playerAnalysis";

function useHistory<T>(query:string, field:"playerId"|"symbol",value:string){
  const [result,setResult]=useState<{key:string;rows?:T[];error?:string}|null>(null);
  const [retry,setRetry]=useState(0);
  const key=query+"|"+field+"|"+value;
  useEffect(()=>{const ctl=new AbortController();setResult(null);
    const q=new URLSearchParams(query);q.set("mode","history");q.set(field,value);
    backend.playerAnalysis<{history:T[]}>(q,ctl.signal).then(data=>{if(!ctl.signal.aborted)setResult({key,rows:data.history});})
      .catch(e=>{if(!ctl.signal.aborted)setResult({key,error:String(e.message||e)});});return ()=>ctl.abort();
  },[key,query,field,value,retry]);
  return {rows:result?.key===key?result.rows:undefined,error:result?.key===key?result.error:undefined,retry:()=>setRetry(v=>v+1)};
}
function HistoryState({error,retry}:{error?:string;retry:()=>void}) {
  return error?<p role="alert" className="text-xs text-warning">{error} <button onClick={retry}>重试</button></p>:<p role="status" className="text-xs text-muted-foreground">正在读取历史记录…</p>;
}
export function PlayerDetail({player:p,query,followed,busy,follow,openSymbol,availableSymbols,children}:{player:Player;query:string;followed:boolean;busy:boolean;follow:()=>void;openSymbol:(s:string)=>void;availableSymbols:Set<string>;children?:ReactNode}){
  const history=useHistory<PlayerRow&{date:string}>(query,"playerId",p.id);
  return <><GlassCard><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">{p.name}</h2>
    <button className={playerControl} disabled={busy} aria-pressed={followed} onClick={follow}>{followed?"取消关注":"关注选手"}</button></div>
    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[["总榜名次",p.rank??"—"],["累计收益",ratio(p.totalReturn)],["当日收益",ratio(p.dayReturn)],["收盘仓位",ratio(p.exposure)],["连续领先",p.streak===null?"—":(p.streakIsLowerBound?"至少 ":"")+p.streak+" 日"],["近20日前10%",p.topDays+" / "+p.rankDays+" 个可判定日"],["近20日实报",p.reportDays+" 日"],["观察期最大回撤",ratio(p.drawdown)]].map(([label,value])=><div key={label}><div className="text-xs text-muted-foreground">{label}</div><strong>{value}</strong></div>)}</div>
    <div className="mt-3 border-t border-border pt-3 text-xs">当日持仓 · {holdingsLabels[p.holdingsState]} <span className="text-muted-foreground">({reportLabels[p.state]})</span>
      <div className="mt-2 flex flex-wrap gap-2">{p.symbols.map(s=>availableSymbols.has(s)?<button className={playerControl} key={s} onClick={()=>openSymbol(s)}>{stockTitle(s)} →</button>:<span key={s}>{stockTitle(s)}</span>)}</div></div>{children}</GlassCard>
    <GlassCard><h3 className="mb-2 font-semibold">选手时间轴</h3>{!history.rows?<HistoryState {...history}/>:<DataTable labels={["交易日","报单状态","名次","日收益","累计收益","仓位","持股与可读状态"]}>{history.rows.slice().reverse().map(r=><tr key={r.date}><td>{r.date}</td><td>{reportLabels[r.state]}</td><td>{r.rank??"—"}</td><td>{ratio(r.dayReturn)}</td><td>{ratio(r.totalReturn)}</td><td>{ratio(r.exposure)}</td><td>{holdingsLabels[r.holdingsState]} {r.symbols.map(stockTitle).join("、")}</td></tr>)}</DataTable>}</GlassCard></>;
}
export function StockDetail({stock:s,result,contest,query,names,openPlayer}:{stock:Stock;result:AnalysisResult;contest:Contest;query:string;names:Map<string,Player>;openPlayer:(id:string)=>void}){
  const [params]=useSearchParams();
  const initialGroup=params.get("holdingGroup");
  const [group,setGroup]=useState<"all"|"top"|"bottom">(initialGroup==="top"||initialGroup==="bottom"?initialGroup:"all");
  const [showChart,setShowChart]=useState(false);
  const [members,setMembers]=useState<{label:string;ids:string[]}|null>(null);
  const history=useHistory<{date:string;all:Holdings;top:Holdings;bottom:Holdings}>(query,"symbol",s.symbol);
  const link=new URLSearchParams(query);link.delete("expectedUserId");link.set("symbol",s.symbol);link.set("tab","stocks");link.set("holdingGroup",group);
  const groups={all:"全组",top:"领先组",bottom:"落后组"};
  const totals=s[group];
  const changes=["holders","added","kept","exited"] as const;
  const labels={holders:"当日持有",added:"新增持有",kept:"继续持有",exited:"退出持有"};
  const sourceNote=contest.matchName+" · "+contest.divisionName+" · "+result.date+" · v"+result.revision+"\n/player-analysis?"+link;
  return <><GlassCard><h2 className="text-lg font-semibold">{stockTitle(s.symbol)}</h2>
    <p className="my-2 text-xs text-muted-foreground">{result.date} · 领先组与全组持有率相差 {s.preference?.toFixed(1)??"—"} 个百分点</p>
    <div className="flex gap-2">{(["all","top","bottom"] as const).map(g=><button className={playerTabs} aria-pressed={group===g} key={g} onClick={()=>setGroup(g)}>{groups[g]}</button>)}</div>
    <div className="my-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{changes.map(k=><button className="rounded border border-border p-2 text-left" key={k} disabled={!(k==="holders"?totals.denominator:totals.comparable)} onClick={()=>setMembers({label:groups[group]+" · "+labels[k],ids:totals[k]})}><span className="block text-xs text-muted-foreground">{labels[k]}</span><b>{(k==="holders"?totals.denominator:totals.comparable)?totals[k].length:"—"}</b></button>)}</div>
    <p className="text-xs text-muted-foreground">当日有效 {totals.denominator} 人，连续两日可比 {totals.comparable} 人。</p>
    <ObservationDraftButton key={query+s.symbol+group} initialSymbol={s.symbol} initialNote={sourceNote} question={stockTitle(s.symbol)+" 持仓观察"} reply={result.date+"，"+groups[group]+"共有 "+totals.denominator+" 人持仓可读，其中 "+totals.holders.length+" 人持有该股。"} /></GlassCard>
    <GlassCard><h3 className="mb-2 font-semibold">近五日持仓变化 · {groups[group]}</h3>{!history.rows?<HistoryState {...history}/>:<DataTable labels={["交易日","持有人 / 有效人数","新增","继续","退出","净增","可比人数"]}>{history.rows.map(d=><tr key={d.date}><td>{d.date}</td><td>{d[group].holders.length} / {d[group].denominator}</td>{(["added","kept","exited"] as const).map(k=><td key={k}>{d[group].comparable?d[group][k].length:"—"}</td>)}<td>{d[group].net??"—"}</td><td>{d[group].comparable}</td></tr>)}</DataTable>}</GlassCard>
    <button className={playerControl} onClick={()=>setShowChart(!showChart)}>{showChart?"收起 K 线":"查看截至 "+result.date+" 的 K 线"}</button>
    {showChart&&<KlineCard key={s.symbol+result.date} symbol={s.symbol} asOf={result.date} compact/>}
    {members&&<MemberDialog {...members} names={names} close={()=>setMembers(null)} select={id=>{setMembers(null);openPlayer(id);}}/>}</>;
}

