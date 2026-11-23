import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CandlestickChart, Loader2, RefreshCw } from "lucide-react";

import { EChart } from "@/components/ui/EChart";
import { GlassCard } from "@/components/ui/GlassCard";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { usePalette } from "@/components/ui/chartPalette";
import { ApiError, backend } from "@/lib/backend";
import { fmtChange, fmtPrice, fmtVolume, klineOption, parseKline, type KlineResult } from "@/lib/klineView";

import { replayView } from "@/lib/klineReplay";
import { ContextHelp } from "@/components/ui/ContextHelp";
import { KlineStructure } from "@/components/KlineStructure";
import { DataStamp } from "@/components/ui/DataStamp";
import {ChartAnnotations} from './ChartAnnotations';
import {parseChartSettings,visibleChartLines} from '../lib/chartAnnotations';
import {useLocalPreference} from '../hooks/useLocalPreference';
import {usePrivacyMode} from '../hooks/usePrivacyMode';
import {api,type Announcement} from '../lib/api';
import {chartEvents} from '../lib/chartEvents';
import {Link} from 'react-router-dom';
import { ChartCache, chartRequest, currentChart, intelEntry, looksLikeAShare, type Period, type Adjust } from "../lib/chartRequest";

// Memory-only, bounded reuse. Never persist quote data or cache failures.
const chartCache = new ChartCache<KlineResult>();

const PERIODS: { key: Period; label: string }[] = [{ key: "day", label: "日线" }, { key: "week", label: "周线" }, { key: "month", label: "月线" }];
const MINUTES: {key:Period;label:string}[]=[{key:'m5',label:'5分'},{key:'m15',label:'15分'},{key:'m60',label:'60分'}];
const ADJUSTS: { key: Adjust; label: string }[] = [{ key: "qfq", label: "前复权" }, { key: "hfq", label: "后复权" }, { key: "none", label: "不复权" }];

/**
 * 个股走势：K 线 + 均线 + 成交量。数据来自 K 线工具（不需要接 AI）。
 * 🔴 只画行情，不画买卖点；红涨绿跌。
 */
export function KlineCard({ symbol, title, action, initialPeriod = "day", asOf, compact = false, syncGroup, intelGroup, intelFirstSymbol, intelGroupSymbol }: { symbol: string; title?: string; action?: ReactNode; initialPeriod?: Period; asOf?: string; compact?: boolean; syncGroup?:string; intelGroup?:number; intelFirstSymbol?:string; intelGroupSymbol?:string }) {
  const palette = usePalette();
  const annotations=useLocalPreference('chart-settings',()=>parseChartSettings(null),parseChartSettings);
  const {on:hide}=usePrivacyMode();
  const [selectedPeriod, setPeriod] = useState<Period>(initialPeriod);
  const request = chartRequest(symbol, selectedPeriod, "qfq");
  const period = request.period;
  useEffect(() => { if (period !== selectedPeriod) setPeriod(period); }, [period, selectedPeriod]);
  const [adjust, setAdjust] = useState<Adjust>(asOf ? "none" : "qfq");
  const minute=period.startsWith('m')&&period!=='month';
  // 结果连同它是哪只一起记：换了股票、新的还没回来时不显示上一只的图（放在 effect 里清空会先闪一帧旧图）
  const { key: requestKey, body } = chartRequest(symbol, period, adjust);
  const [got, setGot] = useState<{ key: string; res: KlineResult } | null>(null);
  const res = currentChart(requestKey, got);
  const [replaySymbol, setReplaySymbol] = useState<string | null>(null);
  const replay = !!asOf || replaySymbol === symbol;
  const [structure, setStructure] = useState(false);
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => { setStep(null); setReplaySymbol(null); }, [symbol]);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const previousRetry = useRef(retry);
  const [eventsOn,setEventsOn]=useState(false);
  const [eventData,setEventData]=useState<{code:string;items:Announcement[];error?:string}|null>(null);
  const eventCode=looksLikeAShare(symbol)?symbol.match(/\d{6}/)?.[0]??'':'';
  const eventsVisible=eventsOn&&period==='day'&&!replay&&!!eventCode;
  useEffect(()=>{
    if(!eventsVisible)return;
    let current=true;
    setEventData(null);
    api.announcements(eventCode).then(items=>{if(current)setEventData({code:eventCode,items});})
      .catch(()=>{if(current)setEventData({code:eventCode,items:[],error:'公告暂未取到，可重开重试'});});
    return()=>{current=false;};
  },[eventCode,eventsVisible,retry]);

  const aShareCode = looksLikeAShare(symbol);
  useEffect(() => {
    const ctl = new AbortController();
    const force = previousRetry.current !== retry;
    previousRetry.current = retry;
    const cached = chartCache.get(requestKey, force, Date.now());
    setSlow(false);
    if (cached) {
      setGot({key: requestKey, res: cached.ok ? { ...cached, view: { ...cached.view, cached: true } } : cached}); setLoading(false);
      return () => ctl.abort();
    }
    const cacheToken = chartCache.token(requestKey);
    setLoading(true);
    const slowTimer = setTimeout(() => setSlow(true), 5000);
    // 港美股不传复权：页面上不显示这个选项，传了上一只 A 股留下的选择只会换来一句看不懂的提示
    backend.runTool<unknown>("kline", body, ctl.signal, force ? "fresh" : "prefer")
      .then((out) => {
        if (ctl.signal.aborted) return;
        const result = parseKline(out);
        if (result.ok && result.view.fetchedAt && Number.isFinite(Date.parse(result.view.fetchedAt)) && !(out && typeof out === "object" && "cached" in out && out.cached === true)) {
          chartCache.setIfCurrent(requestKey, cacheToken, result, Date.now());
        }
        setGot({ key: requestKey, res: result });
      })
      .catch((e) => {
        if (ctl.signal.aborted) return;
        setGot({ key: requestKey, res: { ok: false, error: e instanceof ApiError ? e.message : String(e) } });
      })
      .finally(() => { clearTimeout(slowTimer); if (!ctl.signal.aborted) setLoading(false); });
    // 切代码 / 周期 / 复权时丢掉上一次还没回来的请求，免得慢的那次后到把新图盖掉
    return () => { clearTimeout(slowTimer); ctl.abort(); };
  }, [symbol, period, adjust, aShareCode, requestKey, retry]);

  const rawView = res?.ok ? res.view : null;
  const sourceView = rawView && asOf ? replayView(rawView, asOf) : rawView;
  const replayActive = replay && aShareCode;
  const replayIndex = Math.max(0, Math.min(step ?? Infinity, (sourceView?.series.dates.length ?? 1) - 1));
  const view = sourceView && replayActive ? replayView(sourceView, sourceView.series.dates[replayIndex]!) : sourceView;
  const events=useMemo(()=>chartEvents(eventData?.code===eventCode?eventData.items:[],view?.series.dates??[],view?.series.close??[],eventsVisible),[eventData,eventCode,view,eventsVisible]);
  const option = useMemo(() => {
    if(!view)return null;
    const base=klineOption(view,palette);
    const lines=visibleChartLines(annotations.value.lines,requestKey,hide,replayActive);
    let series=base.series as Record<string,unknown>[];
    if(annotations.value.template!=='ma'){
      series=series.filter(s=>!String(s.name).startsWith('MA'));
      const bands=annotations.value.template==='bands'?[['band_upper','上轨'],['band_middle','中轨'],['band_lower','下轨']]:[];
      for(const [key,label] of bands)series.push({name:label,type:'line',data:view.series.structure?.[key!]?.map(v=>v??'-')??[],showSymbol:false,lineStyle:{width:1,color:'#a3a3a3'}});
      base.series=series;base.legend={...base.legend as object,data:bands.map(([,label])=>label)};
    }
    if(lines.length&&series?.[0])series[0]={...series[0],markLine:{silent:true,symbol:'none',lineStyle:{type:'dashed',color:'#d4a017'},label:{formatter:'{b}',position:'insideEndTop'},data:lines.map(l=>({name:`${l.label} · ${l.price}`,yAxis:l.price}))}};
    if(events.length&&series?.[0])series[0]={...series[0],markPoint:{symbol:'pin',symbolSize:30,itemStyle:{color:'#667085'},label:{formatter:'公',fontSize:10},tooltip:{show:false},data:events.map(e=>({name:`${e.date} · ${e.items.length} 条公告`,coord:[e.date,e.price]}))}};
    return base;
  }, [view,palette,annotations.value,requestKey,hide,replayActive,events]);
  const aShare = view ? view.market === "a_share" : aShareCode;
  const s = view?.series;
  const last = s ? s.dates.length - 1 : -1;
  const tone = (x: number | null | undefined) => (x == null || x === 0 ? "" : x > 0 ? "text-danger" : "text-success");

  return (
    <GlassCard className="mb-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <CandlestickChart className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">走势</h3>
        {title && <span className="text-sm font-medium">{title}</span>}
        <span className="font-mono text-sm">{view?.symbol || symbol}</span>
        {view && <span className="text-xs text-muted-foreground">{view.marketLabel} · {view.adjustLabel}</span>}
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="正在取 K 线" />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SegmentedToggle label="周期" value={period} onChange={p=>{setPeriod(p);if(MINUTES.some(m=>m.key===p))setAdjust('none');}} options={aShareCode?[...PERIODS,...MINUTES]:PERIODS} disabled={replayActive} />
          {aShare && <SegmentedToggle label="复权" value={adjust} onChange={setAdjust} options={ADJUSTS} disabled={replayActive || minute} />}
          <button type="button" aria-label="刷新 K 线" disabled={loading} onClick={() => { setGot(null); setRetry(n => n + 1); }} className="rounded border border-border p-1.5 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /></button>
          {aShareCode && !asOf && <button type="button" aria-pressed={replayActive} disabled={loading} onClick={() => { setReplaySymbol(replay ? null : symbol); setStep(null); setPeriod("day"); setAdjust("none"); }} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50">{replayActive ? "退出回看" : "逐日回看"}</button>}
          {action}
          {aShareCode&&<button type="button" aria-pressed={eventsVisible} disabled={period!=='day'||replayActive} onClick={()=>setEventsOn(on=>!on)} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40">公告标记</button>}
          <button type="button" aria-pressed={structure} onClick={() => setStructure(on => !on)} className="rounded border border-border px-2 py-1 text-xs">形态读数</button>
          <select aria-label="指标模板" disabled={!annotations.ready} value={annotations.value.template} onChange={e=>void annotations.save({...annotations.value,template:e.target.value as 'ma'|'bands'|'plain'})} className="rounded border border-border bg-background px-2 py-1 text-xs"><option value="ma">均线模板</option><option value="bands">波动带模板</option><option value="plain">裸 K 模板</option></select>
        </div>
      </div>

      {res && !res.ok && <p role="alert" className="text-sm text-muted-foreground">K 线没有画出来：{res.error}</p>}
      {!res && <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-3 rounded border border-dashed border-border bg-muted/20 text-sm text-muted-foreground" style={{height: compact ? 280 : 420}}>
        <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
        <p>正在读取 {title || symbol} 的{[...PERIODS,...MINUTES].find(p => p.key === period)?.label}…</p>
        <p className="text-xs">{slow ? '行情源响应较慢，可继续切换股票或关闭面板。' : '图表就绪后会显示在这里'}</p>
      </div>}

      {replayActive && <p className="mb-3 text-xs text-warning">不复权日线 · 使用当前历史数据回看，不等同当时可得数据快照；不用于验证策略收益。</p>}
      {asOf && rawView && !sourceView && <p role="status" className="text-xs text-muted-foreground">行情源返回的日线未覆盖所选交易日。</p>}
      {replayActive && sourceView && !view && <p role="alert" className="text-xs text-warning">当前序列不满足回看要求，请刷新后重试。</p>}
      {replayActive && view && sourceView && <div tabIndex={0} aria-label="逐日回看控制，左右方向键切换交易日" onKeyDown={e=>{
        if(e.target!==e.currentTarget)return;
        if(e.key==='ArrowLeft'){e.preventDefault();setStep(Math.max(0,replayIndex-1));}
        if(e.key==='ArrowRight'){e.preventDefault();setStep(Math.min(sourceView.bars-1,replayIndex+1));}
      }} className="mb-3 flex flex-wrap items-center gap-3 rounded border border-border p-3 text-xs">
        <button type="button" disabled={replayIndex <= 0} onClick={() => setStep(replayIndex - 1)} className="disabled:opacity-40">前一交易日</button>
        <strong className="font-mono">{view.last}</strong>
        <button type="button" disabled={replayIndex >= sourceView.bars - 1} onClick={() => setStep(replayIndex + 1)} className="disabled:opacity-40">后一交易日</button>
        <input type="range" aria-label="回看交易日" className="min-w-24 flex-1" min={0} max={sourceView.bars - 1} value={replayIndex} onChange={e => setStep(Number(e.target.value))} />
      </div>}
      {view && s && option && (
        <>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground">{s.dates[last]}</span>
            <span>收盘 <b className={`font-mono text-sm ${tone(s.change[last])}`}>{fmtPrice(s.close[last] ?? null)}</b></span>
            <span className={`font-mono ${tone(s.change[last])}`}>{fmtChange(s.change[last] ?? null)}</span>
            <span className="text-muted-foreground">开 <span className="font-mono text-foreground">{fmtPrice(s.open[last] ?? null)}</span></span>
            <span className="text-muted-foreground">高 <span className="font-mono text-foreground">{fmtPrice(s.high[last] ?? null)}</span></span>
            <span className="text-muted-foreground">低 <span className="font-mono text-foreground">{fmtPrice(s.low[last] ?? null)}</span></span>
            {view.volumeUnit && <span className="text-muted-foreground">量 <span className="font-mono text-foreground">{fmtVolume(s.volume[last] ?? null)}</span> {view.volumeUnit}</span>}
          </div>
          <EChart option={option} height={compact ? 280 : 420} syncGroup={syncGroup&&!replayActive?`${syncGroup}:${requestKey}`:undefined} />
          {eventsVisible&&<div className="mt-2 text-xs text-muted-foreground">
            {!eventData||eventData.code!==eventCode?'正在加载公告…':eventData.error??<><Link className="text-primary" to={intelGroup ? intelEntry(eventCode, intelGroup, intelFirstSymbol ?? "", intelGroupSymbol ?? symbol) : `/intel/filings?symbol=${eventCode}`}>查看本股公告 →</Link><span className="ml-3">当前日线内 {events.length} 个披露日</span><details className="mt-1"><summary className="cursor-pointer">公告明细与口径</summary><p>仅覆盖接口返回的近期公告；按披露日期标记，不代表当日开盘前可得，也不解释涨跌原因。非交易日公告见公告列表，历史回看不显示。</p>{events.slice().reverse().map(e=><div className="mt-2" key={e.date}><b>{e.date}</b>{e.items.map((item,i)=><p key={i}>{item.title}</p>)}</div>)}</details></>}
          </div>}
          {!replayActive&&<ChartAnnotations lines={annotations.value.lines} context={requestKey} ready={annotations.ready} hide={hide} error={annotations.error} save={lines=>annotations.save({...annotations.value,lines})}/>}
          {structure && <KlineStructure view={view} />}
          <div className="mt-2 space-y-0.5 text-[11px] leading-5 text-muted-foreground">
            {minute&&<p>最近最多 320 根 · 北京时间 · 末根可能未结束</p>}
            {view.notes.length>0&&<ContextHelp label="数据口径与限制">{view.notes.map((n) => <p key={n}>{n}</p>)}</ContextHelp>}
            <DataStamp mode="history" dataAt={view.last} fetchedAt={view.fetchedAt} source={view.source} cached={view.cached} />
            <p>{view.periodLabel} {view.bars} 根（{view.first} 至 {view.last}）。</p>
            <ContextHelp label="图表操作与口径">拖动下方滑条或图表看更早；Ctrl 滚轮或双指捏合缩放。均线为收盘价的简单移动平均。</ContextHelp>
          </div>
        </>
      )}
    </GlassCard>
  );
}
