import fs from "node:fs";
import path from "node:path";
import {fetchEndpoint,type ServiceContext} from "../../service.ts";
import { registerBackgroundService } from "../../background_services.ts";
import { registerView } from "../../views.ts";
import { shortlineWatchAct,phaseOf } from "./watch.ts";
import {clockOf,fetchTodayCalendar} from './intraday.ts';
import { evaluateObservations } from "../observation_rules.ts";
import {tickModes} from "../mode_studio.ts";
import {tickMarket,cancelMarket} from "./market_scan.ts";

interface CoverageGap {from:string;to:string;reason:string}
interface Monitor { enabled: boolean; running: boolean; last_at: string | null; started_at: string; error: string | null; interval_ms: number; interruptions: number; gaps:CoverageGap[] }
const states = new Map<string,Monitor>();
function state(ctx:ServiceContext) {
  let value=states.get(ctx.dataRoot);
  if(!value) {
    let previous: Partial<Monitor>={};
    try { previous=JSON.parse(fs.readFileSync(path.join(ctx.dataRoot,"monitor.json"),"utf8")); } catch { /* Opt in only. */ }
    const started=new Date().toISOString();
    const gaps=Array.isArray(previous.gaps)?previous.gaps.slice(-49):[];
    if(previous.enabled&&previous.last_at)gaps.push({from:previous.last_at,to:started,reason:'服务重启，期间未覆盖'});
    value={enabled:previous.enabled===true,running:false,last_at:previous.last_at??null,started_at:started,error:previous.enabled?"服务已重启；中断期间未监测，不补造异动。":null,interval_ms:3000,interruptions:(previous.interruptions??0)+(previous.enabled?1:0),gaps};
    states.set(ctx.dataRoot,value);
  }
  return value;
}
function persist(ctx:ServiceContext) {
  const file=path.join(ctx.dataRoot,"monitor.json"); fs.mkdirSync(ctx.dataRoot,{recursive:true});
  fs.writeFileSync(file+".tmp",JSON.stringify(state(ctx)),{mode:0o600}); fs.renameSync(file+".tmp",file);
}
registerView({id:"monitor",label:"持续监测",run:async ctx=>({...state(ctx)}),act:async(ctx,body)=>{
  if(typeof body.enabled!=="boolean") throw Error("请选择开启或暂停监测");
  const current=state(ctx);
  if(body.enabled && !current.enabled) { current.last_at=null; current.error=null; }
  current.enabled=body.enabled;if(!current.enabled)cancelMarket(ctx); persist(ctx); return {...current};
}});
registerBackgroundService("finance-monitor",ctx=>{
  let disposed=false; let timer:ReturnType<typeof setTimeout>;
  let marketTimer:ReturnType<typeof setTimeout>;
  const current=state(ctx);
  const controller=new AbortController();
  const marketLoop=async()=>{
    const started=Date.now();
    try{
      if(!disposed&&current.enabled&&['auction','morning','afternoon','closing_auction'].includes(phaseOf(new Date()))){
        const calendar=await fetchTodayCalendar(ctx,clockOf(new Date()).day,fetchEndpoint,controller.signal);
        if(!disposed&&current.enabled&&calendar?.is_today_trading_day===true)await tickMarket(ctx,controller.signal);
      }
    }catch{if(!disposed)current.error='全市场采集未完成，请查看覆盖记录。';}
    finally{if(!disposed){marketTimer=setTimeout(marketLoop,current.enabled?Math.max(1000,30000-(Date.now()-started)):3000);marketTimer.unref();}}
  };
  const loop=async()=>{
    if(disposed) return;
    const loopStarted=Date.now();
    if(current.enabled) {
      current.running=true;
      try {
        const view=await shortlineWatchAct(ctx,{action:"poll"},controller.signal);
        if(!disposed&&current.enabled&&view.trading_day===true&&["morning","afternoon"].includes(view.phase)) {
          await evaluateObservations(ctx,controller.signal);
          void tickModes(ctx,controller.signal).catch(()=>{current.error="模式观察状态未保存，请检查磁盘与权限。";});
        }
        const finished=new Date().toISOString();
        if(current.last_at&&Date.parse(current.last_at)>=Date.parse(current.started_at)&&Date.now()-Date.parse(current.last_at)>Math.max(120000,current.interval_ms*3)) {
          current.interruptions++;
          current.gaps=[...current.gaps,{from:current.last_at,to:finished,reason:'两次成功运行间隔过长，期间覆盖不完整'}].slice(-50);
        }
        current.last_at=finished; current.interval_ms=view.poll_ms;
        current.error=view.trading_day===null?"交易日历未确认，异动判断受限。":null;
      } catch { current.error="本轮数据未更新，正在退避重试。"; current.interval_ms=Math.min(60000,Math.max(5000,current.interval_ms*2)); }
      finally { current.running=false; try {persist(ctx);} catch {current.error="监测状态无法写入磁盘，请检查空间与权限。";current.enabled=false;} }
    }
    if(!disposed) { timer=setTimeout(loop,current.enabled?(current.error?current.interval_ms:Math.max(500,current.interval_ms-(Date.now()-loopStarted))):3000); timer.unref(); }
  };
  void loop();void marketLoop(); return ()=>{disposed=true;controller.abort();clearTimeout(timer);clearTimeout(marketTimer);};
});
