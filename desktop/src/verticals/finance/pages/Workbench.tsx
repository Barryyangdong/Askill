import { JourneyLink as Link } from "../components/JourneyLink";
import { PageHeader } from "../components/ui/PageHeader";
import { intelEntry } from "../lib/chartRequest";
import { workbenchRestore } from "../lib/workbenchIntel";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { backend } from "../lib/backend";
import { api } from "../lib/api";
import { SymbolSearch } from "../components/SymbolSearch";
import { KlineCard } from "../components/KlineCard";
import { ThesisPanel } from "../components/ui/ThesisPanel";
import { MonitorStatus } from "../components/MonitorStatus";
import { useLocalPreference } from "../hooks/useLocalPreference";
import { normalizeMarketSymbol } from "../lib/marketSymbol";
import { useLiveQuotes } from "../hooks/useLiveQuotes";

type PanelId="list"|"chart"|"compare"|"events"|"plan";
interface Panel {id:PanelId;span:number;locked?:string;hidden?:boolean;group?:number;height?:number}
interface Layout {symbol:string;panels:Panel[];groups?:Record<string,string>}
const names:Record<PanelId,string>={list:"我的观察",chart:"行情图表",compare:"多周期对照",events:"公告与事件",plan:"观察与验证"};
const defaults=():Layout=>({symbol:"600825",panels:[{id:"list",span:3},{id:"chart",span:6},{id:"events",span:3},{id:"compare",span:6},{id:"plan",span:6}]});
function parse(value:unknown):Layout {
  const raw=value as Partial<Layout>|null;
  if(!raw||!Array.isArray(raw.panels))return defaults();
  const seen=new Set<string>();
  return {symbol:normalizeMarketSymbol(raw.symbol)??"600825",groups:Object.fromEntries([1,2,3].map(n=>[String(n),normalizeMarketSymbol(raw.groups?.[String(n)])??normalizeMarketSymbol(raw.symbol)??"600825"])),panels:raw.panels.filter(p=>p&&p.id in names&&!seen.has(p.id)&&!!seen.add(p.id)).map(p=>({id:p.id,span:[3,4,6,8,9,12].includes(p.span)?p.span:6,hidden:p.hidden===true,group:[1,2,3].includes(p.group??1)?p.group:1,height:Math.max(240,Math.min(1200,Number(p.height)||460)),locked:normalizeMarketSymbol(p.locked)??undefined}))};
}
function Events({symbol,group,firstSymbol,groupSymbol}:{symbol:string;group:number;firstSymbol:string;groupSymbol:string}) {
  const [rows,setRows]=useState<Awaited<ReturnType<typeof api.announcements>>>([]);const [error,setError]=useState("");const [loading,setLoading]=useState(true);
  useEffect(()=>{let gone=false;setRows([]);setLoading(true);setError("");void api.announcements(symbol).then(r=>{if(!gone)setRows(r);}).catch(()=>{if(!gone)setError("公告暂未更新，可到资讯雷达重试。");}).finally(()=>{if(!gone)setLoading(false);});return()=>{gone=true;};},[symbol]);
  return <div className="space-y-2 p-3 text-xs">{/^\d{6}$/.test(symbol)&&<Link className="block text-primary" to={intelEntry(symbol,group,firstSymbol,groupSymbol)}>查看该股公告与新闻 →</Link>}{loading&&<p role="status">正在读取公告…</p>}{error&&<p role="alert" className="text-warning">{error}</p>}{!loading&&!error&&!rows.length&&<p>本次没有返回公告。</p>}{rows.slice(0,20).map((r,i)=><a key={`${r.url}:${i}`} href={/^https:\/\//.test(r.url)?r.url:undefined} target="_blank" rel="noopener noreferrer" className="block border-b border-border pb-2 hover:text-primary"><time className="mb-1 block text-muted-foreground">{r.date}</time>{r.title}</a>)}</div>;
}
export function WatchStatus({watchState, symbols, quotes, onRetry}: {watchState:"loading"|"ready"|"error"; symbols:string[]; quotes:ReturnType<typeof useLiveQuotes>; onRetry:()=>void}) {
  return <>{watchState==="loading"&&<p role="status" className="text-xs">正在读取自选…</p>}{watchState==="error"&&<p role="alert" className="text-xs text-warning">自选读取失败。 <button onClick={onRetry}>重试</button></p>}{watchState==="ready"&&!symbols.length&&<Link className="text-xs text-primary" to="/my-stocks">添加自选后显示在这里 →</Link>}{watchState==="ready"&&symbols.length>0&&<div className="mb-2 text-xs text-muted-foreground"><p>{quotes.loading ? "正在读取报价…" : quotes.error ? `报价更新失败：${quotes.error}` : quotes.settled !== symbols.join(",") ? "等待报价…" : "报价快照"}</p><p>{quotes.updatedAt != null ? `最早取数时间：${new Date(quotes.updatedAt).toLocaleString()}` : "取数时间未知"}{!quotes.polling && " · 自动轮询已暂停"}</p><button type="button" disabled={quotes.loading} onClick={quotes.refresh} className="text-primary disabled:opacity-50">刷新报价</button></div>}</>;
}
export function Workbench() {
  const {value:savedLayout,save,ready,error}=useLocalPreference("workbench",defaults,parse);
  const [sessionGroups,setSessionGroups]=useState<Record<string,string>>({});
  const layout={...savedLayout,symbol:sessionGroups['1']??savedLayout.symbol,groups:{...savedLayout.groups,...sessionGroups}};
  const [params,setParams]=useSearchParams();const appliedSymbol=useRef("");
  const [activeGroup,setActiveGroup]=useState(1);
  const restored = workbenchRestore(params);
  const requestedSymbol=normalizeMarketSymbol(restored.symbol);
  const requestedGroup=restored.group; const firstSymbol=restored.firstSymbol;
  useEffect(()=>{
    if(!ready)return;
    if(!requestedSymbol){appliedSymbol.current=layout.symbol;setParams(previous=>{const next=new URLSearchParams(previous);next.set('symbol',layout.symbol);return next;},{replace:true});return;}
    const key=`${requestedGroup}:${requestedSymbol}:${firstSymbol ?? ""}`;
    if(appliedSymbol.current===key)return;
    appliedSymbol.current=key;
    setActiveGroup(requestedGroup);
    setSessionGroups(previous=>({...previous,...(firstSymbol ? {"1":firstSymbol} : {}),[String(requestedGroup)]:requestedSymbol}));
  },[ready,requestedSymbol,requestedGroup,firstSymbol,layout.symbol,setParams]);
  const [input,setInput]=useState("");const [symbols,setSymbols]=useState<string[]>([]);const [expanded,setExpanded]=useState<PanelId|null>(null);const drag=useRef<PanelId|null>(null);
  const quotes=useLiveQuotes(symbols,true);
  const [watchState,setWatchState]=useState<"loading"|"ready"|"error">("loading");
  const [watchRetry,setWatchRetry]=useState(0);
  useEffect(()=>{let current=true;setWatchState("loading");void backend.ledger().then(l=>{if(current){setSymbols((l.records.watch??[]).map(r=>normalizeMarketSymbol(r.symbol)).filter((x):x is string=>!!x));setWatchState("ready");}}).catch(()=>{if(current)setWatchState("error");});return()=>{current=false;};},[watchRetry]);
  const selectedSymbol=layout.groups?.[String(activeGroup)]??layout.symbol;
  const [watchBusy,setWatchBusy]=useState(false);const [watchMessage,setWatchMessage]=useState('');
  const addWatch=async()=>{if(watchBusy)return;const code=selectedSymbol;setWatchBusy(true);setWatchMessage('');try{
    const ledger=await backend.ledger();const existing=(ledger.records.watch??[]).map(r=>normalizeMarketSymbol(r.symbol)).filter((s):s is string=>!!s);
    if(!existing.includes(code))await backend.ledgerSave('watch',{symbol:code});
    setSymbols([...new Set([...existing,code])]);setWatchState("ready");setWatchMessage(`${code} 已在自选中`);
  }catch{setWatchMessage('加入自选失败，请重试。');}finally{setWatchBusy(false);}};
  // The selected group is the public navigation identity; other groups remain session-local.
  const publishSelection=(symbol:string,group:number,first:string)=>{
    setActiveGroup(group);
    appliedSymbol.current=`${group}:${symbol}:${group===1?'':first}`;
    setParams(previous=>{
      const next=new URLSearchParams(previous);next.set('symbol',symbol);
      if(group===1){next.delete('group');next.delete('firstSymbol');}
      else {next.set('group',String(group));next.set('firstSymbol',first);}
      return next;
    },{replace:true});
  };
  const select=(value:string,group=activeGroup)=>{
    const symbol=normalizeMarketSymbol(value); if(!symbol)return;
    setSessionGroups(previous=>({...previous,[String(group)]:symbol}));
    publishSelection(symbol,group,group===1?symbol:layout.groups?.['1']??layout.symbol);
  };
  const selectGroup=(group:number)=>{
    if(![1,2,3].includes(group))return;
    publishSelection(layout.groups?.[String(group)]??layout.symbol,group,layout.groups?.['1']??layout.symbol);
  };
  const change=(id:PanelId,patch:Partial<Panel>)=>void save({...layout,panels:layout.panels.map(p=>p.id===id?{...p,...patch}:p)});
  return <div>
    <PageHeader title="个股行情" subtitle={`当前股票 ${selectedSymbol}`} description="先核对行情与公告，再写下观察条件或继续研究。" actions={<>
      <SymbolSearch value={input} onChange={setInput} onPick={m=>select(m.symbol)} onEnter={()=>select(input)} placeholder="切换股票 / 代码 / 拼音" disabled={!ready} />
      <select aria-label="当前联动组" className="rounded border border-border bg-card p-2 text-xs" value={activeGroup} onChange={e=>selectGroup(Number(e.target.value))}>{[1,2,3].map(n=><option key={n} value={n}>联动组 {n}</option>)}</select><span className="text-sm font-mono">{selectedSymbol}</span><Link className="text-xs text-primary" to={`/debate?symbol=${selectedSymbol}`}>多空辩论</Link><Link className="text-xs text-primary" to="/tasks">任务中心</Link>
    </>} />
    <div className="mb-3 flex items-center gap-3 text-xs"><button disabled={!ready||watchState==="loading"||watchBusy||symbols.includes(selectedSymbol)} onClick={()=>void addWatch()} className="rounded border border-border px-3 py-2 disabled:opacity-50">{symbols.includes(selectedSymbol)?'已加入自选':watchBusy?'保存中…':'加入自选'}</button><Link className="text-primary" to={`/observations?symbol=${selectedSymbol}`}>建立观察计划</Link><span role="status" className="text-muted-foreground">{watchMessage}</span></div>
    <MonitorStatus />
    {error&&<p role="alert" className="mb-3 text-xs text-warning">{error}</p>}
    <details className="mb-3"><summary className="cursor-pointer text-xs text-muted-foreground">布局设置</summary><div className="my-3 flex flex-wrap items-center gap-2 text-xs"><span className="text-muted-foreground">面板</span>{layout.panels.map(p=><button disabled={!ready} key={p.id} className={`rounded border px-2 py-1 ${p.hidden?"border-border text-muted-foreground":"border-primary/40"}`} onClick={()=>change(p.id,{hidden:!p.hidden})}>{names[p.id]}</button>)}<button disabled={!ready} className="ml-auto text-muted-foreground" onClick={()=>void save({...defaults(),symbol:layout.symbol})}>恢复默认布局</button></div>
    <div className="mb-3 flex flex-wrap gap-3 text-xs"><span className="text-muted-foreground">场景布局</span><button disabled={!ready} onClick={()=>void save({...layout,panels:[{id:'list',span:3},{id:'chart',span:9},{id:'events',span:6},{id:'plan',span:6},{id:'compare',span:6,hidden:true}]})}>盘中观察</button><button disabled={!ready} onClick={()=>void save({...layout,panels:[{id:'chart',span:6},{id:'compare',span:6},{id:'list',span:3},{id:'events',span:3},{id:'plan',span:6}]})}>研究对照</button><span className="text-muted-foreground">同组、同股票、同周期图表同步缩放与十字线；回看时独立</span></div></details>
    <div className="askill-panels grid grid-cols-12 gap-3">{layout.panels.filter(p=>!p.hidden&&(!expanded||expanded===p.id)).map(panel=>{
      const group=panel.group??1;const symbol=panel.locked??layout.groups?.[String(group)]??layout.symbol;
      return <section key={panel.id} aria-label={names[panel.id]} className="askill-panel min-w-0 rounded border border-border bg-card" style={{gridColumn:`span ${expanded?12:panel.span}`}} onDragOver={e=>{if(drag.current)e.preventDefault();}} onDrop={e=>{e.preventDefault();const from=layout.panels.find(p=>p.id===drag.current);if(from&&from.id!==panel.id){const next=layout.panels.filter(p=>p.id!==from.id);next.splice(next.findIndex(p=>p.id===panel.id),0,from);void save({...layout,panels:next});}drag.current=null;}}>
        <header draggable={ready} onDragStart={()=>{drag.current=panel.id;}} onDragEnd={()=>{drag.current=null;}} className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-border px-2 py-2 text-xs">
          <h2 className="mr-auto min-w-20 cursor-grab whitespace-nowrap">⠿ {names[panel.id]}</h2>
          <div className="flex max-w-full shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap">
          {panel.id!=="list"&&<button title="锁定当前股票，不随列表切换" onClick={()=>change(panel.id,{locked:panel.locked?undefined:symbol})}>{panel.locked?"锁定":"联动"}</button>}
          <select disabled={!ready} aria-label={`${names[panel.id]}联动组`} className="bg-card" value={group} onChange={e=>change(panel.id,{group:Number(e.target.value)})}>{[1,2,3].map(n=><option key={n} value={n}>组 {n}</option>)}</select>
          <select aria-label={`${names[panel.id]}宽度`} className="bg-card" value={panel.span} onChange={e=>change(panel.id,{span:Number(e.target.value)})}>{[3,4,6,8,9,12].map(n=><option key={n} value={n}>{n}/12</option>)}</select>
          <button onClick={()=>setExpanded(expanded?null:panel.id)}>{expanded?"还原":"放大"}</button>
          </div>
        </header>
        <div className="min-h-48 overflow-auto" style={{height:expanded?"70vh":panel.height??460,resize:"vertical"}} onPointerUp={e=>{if(expanded||e.target!==e.currentTarget)return;const height=Math.round(e.currentTarget.getBoundingClientRect().height);if(Math.abs(height-(panel.height??460))>3)change(panel.id,{height});}}>
          {panel.id==="list"?<div className="p-2"><WatchStatus watchState={watchState} symbols={symbols} quotes={quotes} onRetry={()=>setWatchRetry(n=>n+1)}/>{symbols.map(code=><button key={code} onClick={()=>select(code,group)} className={`flex w-full justify-between gap-2 border-b border-border p-2 text-left text-xs ${code===symbol?"bg-primary/10":""}`}><span>{quotes.quotes[code]?.name||code}<small className="block text-muted-foreground">{code}</small></span><span>{quotes.quotes[code]?.price??"暂无报价"}</span></button>)}</div>:panel.id==="chart"?<KlineCard symbol={symbol} compact={!expanded} syncGroup={`workbench-${group}`} intelGroup={group} intelFirstSymbol={layout.groups?.["1"] ?? layout.symbol} intelGroupSymbol={layout.groups?.[String(group)] ?? layout.symbol}/>:panel.id==="compare"?<KlineCard symbol={symbol} initialPeriod="week" compact={!expanded} syncGroup={`workbench-${group}`} intelGroup={group} intelFirstSymbol={layout.groups?.["1"] ?? layout.symbol} intelGroupSymbol={layout.groups?.[String(group)] ?? layout.symbol}/>:panel.id==="events"?<Events symbol={symbol} group={group} firstSymbol={layout.groups?.["1"] ?? layout.symbol} groupSymbol={layout.groups?.[String(group)] ?? layout.symbol}/>:<div className="p-3"><Link className="mb-3 block text-xs text-primary" to={`/observations?symbol=${symbol}`}>建立条件 / 查看核验 →</Link><ThesisPanel symbol={symbol}/></div>}
        </div>
      </section>;
    })}</div>
  </div>;
}
