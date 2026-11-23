import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { GlassCard } from "./ui/GlassCard";
import { backend } from "../lib/backend";
import { holdingsLabels, playerControl, playerTabs, ratio, reportLabels, type AnalysisResult, type Contest, type Group, type Player, type Stock } from "../lib/playerAnalysis";
import { DataTable, MemberDialog, stockTitle } from "./PlayerAnalysisTable";
import { PlayerDetail, StockDetail } from "./PlayerDetail";
import { PlayerScreenshot } from "./PlayerScreenshot";
import { loadWatch } from "../lib/watchlist";

type GroupKey="all"|"top"|"bottom";
const groupKeys:GroupKey[]=["all","top","bottom"];
const groupLabels={all:"全组",top:"领先组",bottom:"落后组"};
const metricLabels={profit:"盈利人数占比",dayReturn:"当日收益中位数",exposure:"收盘仓位中位数",rising:"仓位上升人数占比"};
const metrics=["profit","dayReturn","exposure","rising"] as const;
const migration:Record<string,string>={new:"新晋",stayed:"留榜",out:"跌出"};
export function PlayerResults({result,contest,query,onReload}:{result:AnalysisResult;contest:Contest;query:string;onReload:()=>void}){
  const a=result.analysis, c=a.coverage;
  const [params,setParams]=useSearchParams();
  const tab=params.get("tab")||"overview";
  const [group,setGroup]=useState<GroupKey>("all");
  const [sort,setSort]=useState("preference");
  const [filter,setFilter]=useState("");
  const [playerFilter,setPlayerFilter]=useState("all");
  const [members,setMembers]=useState<{label:string;ids:string[]}|null>(null);
  const [page,setPage]=useState(0);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  function nav(changes:Record<string,string|null>){
    setParams(prev=>{const next=new URLSearchParams(prev);for(const [k,v] of Object.entries(changes)){if(v)next.set(k,v);else next.delete(k);}return next;});
  }
  function selectPlayer(id:string){nav({player:id,symbol:null});}
  function selectStock(symbol:string){nav({symbol,player:null});}
  const selectedPlayer=a.players.find(p=>p.id===params.get("player"));
  const selectedStock=a.stocks.find(s=>s.symbol===params.get("symbol"));
  const reference=new URLSearchParams(query);
  reference.set("revision",String(result.revision));if(result.asOf)reference.set("asOf",result.asOf);
  const byId=useMemo(()=>new Map(a.players.map(p=>[p.id,p])),[a.players]);
  const watch=useMemo(()=>new Set(loadWatch()),[result]);
  const stocks=useMemo(()=>a.stocks.filter(s=>(sort!=="watch"||watch.has(s.symbol))&&stockTitle(s.symbol).toLowerCase().includes(filter.toLowerCase())).sort((x,y)=>{
    function score(s:Stock){return sort==="common"||sort==="watch"?s.all.holders.length:sort==="change"?s.all.net:s.preference;}
    return (score(y)??-Infinity)-(score(x)??-Infinity)||y.top.holders.length-x.top.holders.length||x.symbol.localeCompare(y.symbol);
  }),[a.stocks,sort,watch,filter]);
  const players=useMemo(()=>a.players.filter(p=>(p.name+" "+p.id).toLowerCase().includes(filter.toLowerCase())&&
    (playerFilter==="following"?result.followed.includes(p.id):playerFilter==="eligible"?p.eligible:playerFilter==="top"||playerFilter==="bottom"?a.groups[playerFilter].ids.includes(p.id):playerFilter==="all"||p.migration===playerFilter)).sort((x,y)=>
    (playerFilter==="eligible"?y.topDays-x.topDays||(x.drawdown??Infinity)-(y.drawdown??Infinity):0)||(x.rank??Infinity)-(y.rank??Infinity)||x.id.localeCompare(y.id)),[a,filter,playerFilter,result.followed]);
  async function follow(p:Player){if(busy)return;setBusy(true);setError("");
    try{await backend.playerAnalysisAction({action:"setFollow",expectedUserId:reference.get("expectedUserId"),matchId:contest.matchId,divisionId:contest.divisionId,playerId:p.id,followed:!result.followed.includes(p.id)});onReload();}
    catch(e){setError(String(e instanceof Error?e.message:e));}finally{setBusy(false);}
  }
  function openMembers(label:string,ids:string[]){setMembers({label,ids});}
  function bins(kind:"exposureBins"|"returnBins",data:Group){
    const counts=data[kind];const total=counts.reduce((sum,b)=>sum+b.ids.length,0);
    return <GlassCard><h3 className="mb-1 font-semibold">{kind==="exposureBins"?"收盘仓位分布":"当日盈亏分布"}</h3>
      <p className="mb-3 text-xs text-muted-foreground">有效 {total} 人 · 缺少读数 {data.ids.length-total} 人</p>
      {counts.map(b=><button key={b.label} onClick={()=>openMembers(b.label,b.ids)} className="flex w-full items-center gap-3 py-1.5 text-left text-xs">
        <span className="w-28">{b.label}</span><span className="h-2 flex-1 overflow-hidden rounded bg-muted"><span className="block h-full bg-primary/70" style={{width:(total?100*b.ids.length/total:0)+"%"}}/></span>
        <span className="w-24 text-right tabular-nums">{b.ids.length} 人 · {ratio(total?b.ids.length/total:null)}</span></button>)}</GlassCard>;
  }
  const paged=tab==="stocks"?stocks:players;
  const pages=Math.max(1,Math.ceil(paged.length/40));const currentPage=Math.min(page,pages-1);
  const pageButtons=<div className="mt-3 flex items-center justify-end gap-3 text-xs"><span>{paged.length} 条 · 第 {currentPage+1}/{pages} 页</span>
    <button className={playerControl} disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>上一页</button><button className={playerControl} disabled={currentPage+1>=pages} onClick={()=>setPage(currentPage+1)}>下一页</button></div>;
  const detail=(selectedStock||selectedPlayer)?<aside aria-label="分析详情" className="min-w-0 space-y-3 xl:sticky xl:top-2 xl:max-h-[85vh] xl:overflow-auto"><button className={playerControl} onClick={()=>nav({symbol:null,player:null})}>← 返回{tab==="overview"?"赛事总览":tab==="stocks"?"股票列表":"选手列表"}</button>
    {error&&<p className="text-warning" role="alert">{error}</p>}
    {selectedPlayer?<PlayerDetail player={selectedPlayer} query={reference.toString()} followed={result.followed.includes(selectedPlayer.id)} busy={busy} follow={()=>void follow(selectedPlayer)} availableSymbols={new Set(a.stocks.map(s=>s.symbol))} openSymbol={selectStock}>
      <PlayerScreenshot key={selectedPlayer.id+reference.toString()} player={selectedPlayer} query={reference.toString()} seq={result.officialMatchSeq} onSaved={revision=>{nav({revision:String(revision),asOf:null});onReload();}}/></PlayerDetail>:
      selectedStock&&<StockDetail stock={selectedStock} result={result} contest={contest} query={reference.toString()} openPlayer={selectPlayer} names={byId}/>}</aside>:null;
  return <div className={detail?"grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]":"block"}><section className={(detail?"hidden xl:block ":"")+"min-w-0 space-y-3"}>
    <p className="text-xs text-muted-foreground">{contest.matchName} · {contest.divisionName} · 本地导入 v{result.revision} · {new Date(result.importedAt).toLocaleString("zh-CN")}</p>
    <div className="flex flex-wrap gap-2">{[["overview","赛事总览"],["stocks","股票持仓"],["players","选手榜单"]].map(([id,label])=><button key={id} className={playerTabs} aria-pressed={tab===id} onClick={()=>{nav({tab:id??null,symbol:null,player:null});setPage(0);setFilter("");setMembers(null);}}>{label}</button>)}</div>
    {a.groupReason&&<p className="text-xs text-warning">{a.groupReason} {a.rankBasis==="previous"&&<button className="underline" onClick={()=>nav({rankBasis:"today"})}>查看当日榜单</button>}</p>}
    {tab==="overview"?<>
      {Boolean(c.published)&&<p className="text-xs text-muted-foreground">官网榜单披露了 {c.published} 名选手的当日数据。可见数值参与收益与仓位统计，主动报单人数单独核算。</p>}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{[["当日主动报单",c.reported+" / "+(c.expected??"未知")],["完整持仓可读",c.complete+" 人"],["请假／停牌沿用",c.carried+" 人"],["未报／状态未知",c.missing+" / "+c.unknown]].map(([label,v])=><GlassCard key={label}><p className="text-xs text-muted-foreground">{label}</p><strong className="mt-1 block text-xl tabular-nums">{v}</strong></GlassCard>)}</div>
      <GlassCard><h2 className="font-semibold">分组对照</h2><p className="my-2 text-xs text-muted-foreground">排名日 {a.rankDate??"未取得"} · 按人数点开查看计算样本</p>
        <DataTable labels={["指标","全组","前 "+a.size+" 名","后 "+a.size+" 名"]}><tr><td>实报 / 组内人数</td>{groupKeys.map(g=><td key={g}><button className="text-primary" onClick={()=>openMembers(groupLabels[g],a.groups[g].ids)}>{a.groups[g].reported} / {a.groups[g].ids.length}</button></td>)}</tr>
        {metrics.map(m=><tr key={m}><td>{metricLabels[m]}</td>{groupKeys.map(g=>{const v=a.groups[g][m];return <td key={g}><button className="text-left text-primary" onClick={()=>openMembers(groupLabels[g]+" · "+metricLabels[m],v.ids)}>{ratio(v.value)} <small className="text-muted-foreground">({v.numerator===null?"":v.numerator+"/"}{v.denominator}人)</small></button></td>;})}</tr>)}</DataTable></GlassCard>
      <div className="flex gap-1">{groupKeys.map(g=><button className={playerTabs} key={g} aria-pressed={g===group} onClick={()=>setGroup(g)}>{groupLabels[g]}</button>)}</div>
      <div className="grid gap-3 lg:grid-cols-2">{bins("exposureBins",a.groups[group])}{bins("returnBins",a.groups[group])}</div>
      <GlassCard><div className="mb-2 flex justify-between"><h2 className="font-semibold">自选股收盘速览</h2><button className="text-xs text-primary" onClick={()=>{setSort("watch");setFilter("");setPage(0);nav({tab:"stocks"});}}>全部匹配 →</button></div>
        <p className="mb-2 text-xs text-muted-foreground">按当前自选股匹配 {a.date} 的赛事数据</p>
        {a.digest.length?a.digest.map(d=><button key={d.symbol} className="block w-full border-t border-border py-2 text-left text-sm text-primary" onClick={()=>selectStock(d.symbol)}>{stockTitle(d.symbol)} · {d.text} →</button>):
          <p className="text-sm">{!watch.size?"当前自选股为空。":!c.complete?"持仓明细不足，暂无法匹配。":!a.stocks.some(s=>watch.has(s.symbol))?"当前自选股与赛事持仓没有交集。":"已有匹配，今天暂无符合摘要条件的变化。"}</p>}</GlassCard>
    </>:<GlassCard><div className="mb-3 flex flex-wrap items-center gap-2">
      <input className={playerControl} aria-label="搜索列表" placeholder={tab==="stocks"?"搜索股票代码":"搜索选手名称或 ID"} value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);}}/>
      {tab==="stocks"?<select className={playerControl} aria-label="股票排序" value={sort} onChange={e=>{setSort(e.target.value);setPage(0);}}><option value="preference">领先组偏好</option><option value="common">共同持仓人数</option><option value="change">持有人数净增</option><option value="watch">我的自选股</option></select>:
      <select className={playerControl} aria-label="选手范围" value={playerFilter} onChange={e=>{setPlayerFilter(e.target.value);setPage(0);}}>{Object.entries({all:"全部选手",top:"领先组",bottom:"落后组",new:"新晋",stayed:"留榜",out:"跌出",eligible:"持续领先 · 满 20 日",following:"我关注的选手"}).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>}</div>
      {tab==="stocks"?<DataTable labels={["股票","全组持有率","领先组持有率","落后组持有率","偏好差（百分点）","全组新增 / 退出","净增"]}>{stocks.slice(currentPage*40,currentPage*40+40).map(s=><tr key={s.symbol}><td><button className="text-primary" onClick={()=>selectStock(s.symbol)}>{stockTitle(s.symbol)}</button></td>{groupKeys.map(g=><td key={g}>{ratio(s[g].denominator?s[g].holders.length/s[g].denominator:null)} <small>({s[g].holders.length}/{s[g].denominator})</small></td>)}<td>{s.preference?.toFixed(1)??"—"}</td><td>{s.all.comparable?s.all.added.length+" / "+s.all.exited.length:"—"}</td><td>{s.all.net??"—"}</td></tr>)}</DataTable>:
        <DataTable labels={["选手","名次","报单","当日收益","累计收益","仓位","迁移","近20日前10%","最大回撤"]}>{players.slice(currentPage*40,currentPage*40+40).map(p=><tr key={p.id}><td><button className="text-primary" onClick={()=>selectPlayer(p.id)}>{result.followed.includes(p.id)?"★ ":""}{p.name}</button></td><td>{p.rank??"—"}</td><td>{reportLabels[p.state]}</td><td>{ratio(p.dayReturn)}</td><td>{ratio(p.totalReturn)}</td><td title={holdingsLabels[p.holdingsState]}>{ratio(p.exposure)}</td><td>{migration[p.migration??""]??"—"}</td><td>{p.topDays} / {p.rankDays} 日</td><td>{ratio(p.drawdown)}</td></tr>)}</DataTable>}
      {!paged.length&&<p role="status" className="py-4 text-sm text-muted-foreground">{tab==="players"&&playerFilter==="eligible"?"本组尚无 20 日覆盖完整的选手。":"当前条件下暂无记录。"}</p>}{pageButtons}</GlassCard>}
    {members&&<MemberDialog label={members.label} ids={members.ids} names={byId} close={()=>setMembers(null)} select={id=>{setMembers(null);selectPlayer(id);}}/>}
  </section>{detail}</div>;
}
