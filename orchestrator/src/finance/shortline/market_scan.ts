import fs from 'node:fs';
import path from 'node:path';
import {fetchEndpoint,type ServiceContext} from '../../service.ts';
import {registerView} from '../../views.ts';
import {pool,rowsOf} from '../schedule.ts';
import {clockOf,fetchTodayCalendar} from './intraday.ts';
import {recordMarketCycle,marketHealth} from './market_health.ts';
import {phaseOf,detect,newDetectState,type Alert} from './watch.ts';

type Stock={symbol:string;name:string};
export type MarketQuote=Stock&{price:number|null;pct:number|null;open:number|null;last_close:number|null;high:number|null;low:number|null;amount:number|null;limit_up:number|null;quote_time:string;source?:string};
interface Scan {day:string;inventory_at:string|null;expected:number|null;stocks:Stock[];quotes:MarketQuote[];started_at:string|null;completed_at:string|null;duration_ms:number|null;running:boolean;error:string|null;failed_batches:number;repaired:number;cycle:number}
const states=new Map<string,Scan>();
const active=new Map<string,Promise<void>>();
const controllers=new Map<string,AbortController>();
const detectors=new Map<string,{day:string;state:ReturnType<typeof newDetectState>;times:Map<string,number>}>();
const marketAlerts=new Map<string,Alert[]>();
export const MARKET_CADENCE_MS=30000;
const file=(ctx:ServiceContext)=>path.join(ctx.dataRoot,'market-scan.json');
function state(ctx:ServiceContext){let s=states.get(ctx.dataRoot);if(!s){try{s=JSON.parse(fs.readFileSync(file(ctx),'utf8')) as Scan;}catch{s={day:'',inventory_at:null,expected:null,stocks:[],quotes:[],started_at:null,completed_at:null,duration_ms:null,running:false,error:null,failed_batches:0,repaired:0,cycle:0};}s.running=false;states.set(ctx.dataRoot,s);}return s;}
const result=(env:unknown)=> (env as {extra?:{result?:Record<string,unknown>}})?.extra?.result;
const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
export function quoteAge(time:string,now:number):number|null{
 if(!/^\d{14}$/.test(time))return null;
 const stamp=Date.parse(`${time.slice(0,4)}-${time.slice(4,6)}-${time.slice(6,8)}T${time.slice(8,10)}:${time.slice(10,12)}:${time.slice(12)}+08:00`);
 const age=now-stamp;return Number.isFinite(age)&&age>=-5000?Math.max(0,age):null;
}
export function coverage(stocks:Stock[],quotes:MarketQuote[],expected:number|null,now=Date.now()){
 const by=new Map(quotes.map(q=>[q.symbol,q]));let fresh=0,stale=0,unknown=0,missing=0;
 for(const s of stocks){const q=by.get(s.symbol);if(!q||q.price===null||q.price<=0){missing++;continue;}const age=quoteAge(q.quote_time,now);if(age===null)unknown++;else if(age<=60000)fresh++;else stale++;}
 const markets={sh:stocks.filter(s=>s.symbol.startsWith('sh')).length,sz:stocks.filter(s=>s.symbol.startsWith('sz')).length,bj:stocks.filter(s=>s.symbol.startsWith('bj')).length};
 return {expected,listed:stocks.length,markets,inventory_complete:expected!==null&&expected===stocks.length,fresh,stale,unknown,missing,unlisted:expected===null?null:Math.max(0,expected-stocks.length),fresh_ratio:expected?fresh/expected:null};
}
function view(ctx:ServiceContext,query:Record<string,string>={}){const s=state(ctx);const term=(query.q??'').trim();const now=Date.now();const rows=s.quotes.filter(q=>!term||q.symbol.includes(term)||q.name.includes(term)).sort((a,b)=>(b.amount??-1)-(a.amount??-1));return {...s,health:marketHealth(ctx.dataRoot,clockOf(new Date()).day),stocks:undefined,quotes:undefined,alerts:marketAlerts.get(ctx.dataRoot)??[],coverage:coverage(s.stocks,s.quotes,s.expected,now),rows:rows.slice(0,200).map(q=>({...q,age_ms:quoteAge(q.quote_time,now)})),matched:rows.length,phase:phaseOf(new Date()),cadence_ms:MARKET_CADENCE_MS,source:'新浪沪深京名单 · 腾讯时间戳报价（失败时新浪备源）',scope_note:'源端名单核验；每轮分批轮询，不是同一时刻的推送快照。停牌或无新成交也计入旧报价，不冒充实时覆盖。'};}
export function marketQuotes(ctx:ServiceContext){return state(ctx).quotes;}
async function scan(ctx:ServiceContext,signal:AbortSignal){
 signal=AbortSignal.any([signal,AbortSignal.timeout(180000)]);
 const s=state(ctx),start=Date.now(),day=clockOf(new Date()).day;s.running=true;s.started_at=new Date().toISOString();s.error=null;
 let tradingDay:boolean|null=null;
 try{
  const cal=await fetchTodayCalendar(ctx,day,fetchEndpoint,signal);tradingDay=cal?.is_today_trading_day??null;
  if(s.day!==day||!s.expected||s.stocks.length!==s.expected){
   const first=result((await fetchEndpoint(ctx,{endpoint:'cn_market_inventory',args:{page:1},consistency:{mode:'fresh'},signal})).envelope);
   const total=number(first?.total);if(!total||total<1000||total>10000)throw Error('全市场名单总数未确认');
   const pages=await pool(Array.from({length:Math.ceil(total/100)-1},(_,i)=>i+2),3,async page=>{try{return result((await fetchEndpoint(ctx,{endpoint:'cn_market_inventory',args:{page},consistency:{mode:'fresh'},signal})).envelope);}catch{return undefined;}});
   if(signal.aborted)throw Error('采集已中止');
   const stocks=[first,...pages].flatMap(p=>Array.isArray(p?.stocks)?p.stocks as Stock[]:[]);
   s.stocks=[...new Map(stocks.filter(x=>/^(sh|sz|bj)\d{6}$/.test(x.symbol)).map(x=>[x.symbol,x])).values()];s.expected=total;s.inventory_at=new Date().toISOString();s.day=day;
  }
  const quotes=new Map<string,MarketQuote>();s.failed_batches=0;s.repaired=0;
  const fetchBatch=async(batch:Stock[],endpoint='cn_market_quotes')=>{
   try{
    const r=await fetchEndpoint(ctx,{endpoint,args:{codes:batch.map(x=>x.symbol)},consistency:{mode:'fresh'},signal});
    for(const row of rowsOf(r.envelope)){
     const stock=batch.find(s=>s.symbol===row.key);if(!stock)continue;
     const val=(f:string)=>row.f[f]?.value;
     const price=number(val('price')),prev=number(val('last_close'));
     quotes.set(stock.symbol,{...stock,price,pct:number(val('change_pct'))??(price!==null&&prev!==null&&prev>0?(price/prev-1)*100:null),open:number(val('open')),last_close:prev,high:number(val('high')),low:number(val('low')),amount:number(val('turnover_amount')),limit_up:number(val('limit_up_price')),quote_time:typeof val('quote_time')==='string'?String(val('quote_time')):'',source:endpoint==='cn_market_quotes'?'腾讯':'新浪备源'});
    }
   }catch{if(signal.aborted)throw Error('采集已中止');s.failed_batches++;}
  };
  const batches:Stock[][]=[];for(let i=0;i<s.stocks.length;i+=200)batches.push(s.stocks.slice(i,i+200));
  await pool(batches,3,b=>fetchBatch(b));
  const missing=s.stocks.filter(x=>{const q=quotes.get(x.symbol);return !q||q.price===null||q.price<=0;});
  // One bounded repair pass; never amplify a complete source outage.
  if(missing.length){const retry:Stock[][]=[];for(let i=0;i<missing.length;i+=50)retry.push(missing.slice(i,i+50));await pool(retry,2,b=>fetchBatch(b,'cn_market_quotes_backup'));s.repaired=missing.filter(x=>(quotes.get(x.symbol)?.price??0)>0).length;}
  if(signal.aborted)throw Error('采集已中止');
  s.quotes=[...quotes.values()];s.completed_at=new Date().toISOString();s.duration_ms=Date.now()-start;s.cycle++;
  if(['morning','afternoon'].includes(phaseOf(new Date()))){
   const segment=day+'-'+phaseOf(new Date());let detector=detectors.get(ctx.dataRoot);
   if(!detector||detector.day!==segment){
    detector={day:segment,state:newDetectState(),times:new Map()};detectors.set(ctx.dataRoot,detector);
    try{const lines=fs.readFileSync(path.join(ctx.dataRoot,'shortline','market-alerts',day+'.jsonl'),'utf8').trim().split('\n').filter(Boolean);marketAlerts.set(ctx.dataRoot,lines.slice(-100).map(l=>JSON.parse(l) as Alert).reverse());}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw Error('全市场异动归档读取失败');marketAlerts.set(ctx.dataRoot,[]);}
   }
   const alerts:Alert[]=[];
   for(const q of s.quotes){const instant=Date.now();const age=quoteAge(q.quote_time,instant);if(age===null||age>60000||!q.price||!q.quote_time.startsWith(day.replaceAll('-','')))continue;const time=instant-age;if(time<=(detector.times.get(q.symbol)??0))continue;detector.times.set(q.symbol,time);alerts.push(...detect(detector.state,q.symbol.slice(2),{name:q.name,price:q.price,pct:q.pct,limit_up:q.limit_up},time,clockOf(new Date(time)).hms,['全市场',q.source??'腾讯']));}
   marketAlerts.set(ctx.dataRoot,[...alerts.reverse(),...(marketAlerts.get(ctx.dataRoot)??[])].slice(0,100));
   if(alerts.length){const dir=path.join(ctx.dataRoot,'shortline','market-alerts');fs.mkdirSync(dir,{recursive:true});fs.appendFileSync(path.join(dir,day+'.jsonl'),[...alerts].reverse().map(a=>JSON.stringify(a)).join('\n')+'\n',{mode:0o600});}
  }
  if(s.stocks.length!==s.expected||s.quotes.filter(q=>(q.price??0)>0).length!==s.stocks.length)s.error='覆盖不完整；缺失项保留缺口，下轮补采。';
 }catch(e){s.error=e instanceof Error?e.message:'采集失败';}
 finally{const end=Date.now();s.running=false;try{const c=coverage(s.stocks,s.quotes,s.expected,end);recordMarketCycle(ctx.dataRoot,day,{started_at:new Date(start).toISOString(),finished_at:new Date(end).toISOString(),duration_ms:end-start,error:s.error,expected:s.expected,fresh:c.fresh,stale:c.stale,missing:c.missing,unknown:c.unknown,inventory_complete:c.inventory_complete,repaired:s.repaired,trading_day:tradingDay});}catch{s.error=[s.error,'采集记录写入失败'].filter(Boolean).join('；');}fs.mkdirSync(ctx.dataRoot,{recursive:true});fs.writeFileSync(file(ctx)+'.tmp',JSON.stringify(s),{mode:0o600});fs.renameSync(file(ctx)+'.tmp',file(ctx));}
}
export function tickMarket(ctx:ServiceContext,signal:AbortSignal,force=false):Promise<void>{
 const existing=active.get(ctx.dataRoot);if(existing)return existing;
 const s=state(ctx);if(!force&&s.started_at&&Date.now()-Date.parse(s.started_at)<(s.error?120000:MARKET_CADENCE_MS))return Promise.resolve();
 const controller=new AbortController();controllers.set(ctx.dataRoot,controller);
 const task=scan(ctx,AbortSignal.any([signal,controller.signal])).finally(()=>{active.delete(ctx.dataRoot);controllers.delete(ctx.dataRoot);});active.set(ctx.dataRoot,task);return task;
}
export function cancelMarket(ctx:ServiceContext){controllers.get(ctx.dataRoot)?.abort();}
registerView({id:'market_scan',label:'全市场覆盖',run:async(ctx,q)=>view(ctx,q),act:async(ctx,body,signal)=>{if(body.action!=='refresh')throw Error('不支持的操作');await tickMarket(ctx,signal,true);return view(ctx);}});
