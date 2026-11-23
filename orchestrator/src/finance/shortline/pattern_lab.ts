import fs from 'node:fs';
import path from 'node:path';
import {fetchEndpoint,ServiceError,type ServiceContext} from '../../service.ts';
import {registerView} from '../../views.ts';
import {marketQuotes,quoteAge,type MarketQuote} from './market_scan.ts';
import {clockOf,fetchTodayCalendar} from './intraday.ts';
import {phaseOf} from './watch.ts';
import {tradeWindow,consistencyFor,retentionFloor} from './history.ts';
import {rowsOf as settledRows} from './samples.ts';

export const PATTERNS=[
 {id:'leader',name:'空间龙头',rule:'前一交易日完整涨停池中，连板数最高且至少2板；同高全部保留，排除ST。',timing:'昨日收盘形成名单，今日观察',history:'昨日高标的次日表现；不等同于题材龙头或可成交收益'},
 {id:'first_board',name:'首板次日',rule:'前一交易日连板数为1，排除ST；完整保留首板样本，不事后只挑晋级股。',timing:'昨日收盘形成名单，今日观察',history:'昨日首板的次日表现；不等同于昨日打板可买到'},
 {id:'weak_to_strong',name:'弱转强',rule:'昨日涨停且开板至少1次；今日开盘不高于昨收，当前价高于开盘且比昨收上涨至少2%；排除ST。',timing:'今日新鲜报价确认；日内形态，不推断先后触价路径',history:'需当时盘中快照；不拿今日收盘倒推早盘信号'},
] as const;
export const EXECUTION_READINESS={
 status:'data_required',engine:'保守撮合内核已实现；尚未完成真实历史实跑',
 items:[
  {name:'前日涨停池',state:'已有样本核对',detail:'当前历史样本报告可用；下单前可用时间与完整原始池仍需适配器核验'},
  {name:'历史未复权行情',state:'待组装',detail:'日线能力已存在，尚未组装成逐日成交数据包'},
  {name:'历史涨跌停价与交易状态',state:'缺少完整适配',detail:'不能直接以当前板块比例替代ST、上市初期与历史规则'},
  {name:'开盘竞价成交量',state:'缺失',detail:'当前日线与报价接口不满足；禁止用全天成交量替代'},
  {name:'除权事件与历史费率',state:'待核验',detail:'当前内核拒绝除权日；费用使用明确的实验假设'},
 ],
 note:'数据不足不生成收益。保守撮合仍不是逐笔队列重建；不提供涨停排队成交保证。',
};
type PoolRow={code:string;name:string;boards:number;broken_times?:number|null};
export function validatePatternPool(stocks:PoolRow[]){
 if(stocks.some(s=>!/^\d{6}$/.test(s.code)||typeof s.name!=='string'||!Number.isInteger(s.boards)||s.boards<1)||new Set(stocks.map(s=>s.code)).size!==stocks.length)throw Error('历史样本存在异常或重复代码');
}
export interface PatternRow {code:string;name:string;boards:number;status:'met'|'unmet'|'missing';reason:string;price:number|null;pct:number|null;quote_time:string|null}
export function evaluatePattern(id:string,stocks:PoolRow[],quotes:MarketQuote[],now=Date.now()):PatternRow[]{
 if(!PATTERNS.some(p=>p.id===id))throw Error('模式不存在');
 const by=new Map(quotes.map(q=>[q.symbol.slice(2),q]));const highest=Math.max(0,...stocks.map(s=>s.boards));
 return stocks.map(s=>{
  const q=by.get(s.code);const row={code:s.code,name:s.name,boards:s.boards,price:q?.price??null,pct:q?.pct??null,quote_time:q?.quote_time??null};
  if(/ST/i.test(s.name))return {...row,status:'unmet',reason:'排除 ST'};
  if(id==='leader')return {...row,status:s.boards>=2&&s.boards===highest?'met':'unmet',reason:`昨日${s.boards}板 · 全池最高${highest}板`};
  if(id==='first_board')return {...row,status:s.boards===1?'met':'unmet',reason:`昨日${s.boards}板`};
  if(s.broken_times===null||s.broken_times===undefined)return {...row,status:'missing',reason:'昨日开板次数缺失'};
  if(s.broken_times<1)return {...row,status:'unmet',reason:'昨日没有开板记录'};
  const age=q?quoteAge(q.quote_time,now):null;
  if(!q||age===null||age>60000||q.price===null||q.price<=0||q.open===null||q.last_close===null||q.last_close<=0||q.open<=0)return {...row,status:'missing',reason:'需要60秒内有效报价及开盘、昨收'};
  if(!['morning','afternoon'].includes(phaseOf(new Date(now))))return {...row,status:'missing',reason:'仅连续竞价期间确认，休市不沿用旧信号'};
  const hit=q.open<=q.last_close&&q.price>q.open&&q.price/q.last_close>=1.02;
  return {...row,status:hit?'met':'unmet',reason:`昨日开板${s.broken_times}次 · 开盘${q.open} · 昨收${q.last_close} · 当前${q.price}`};
 });
}
interface Run {id:string;pattern:string;version:1;at:string;sample_date:string;quote_date:string;pool_count:number;rows:PatternRow[]}
const file=(ctx:ServiceContext)=>path.join(ctx.dataRoot,'pattern-observations.json');
function read(ctx:ServiceContext):Run[]{try{return JSON.parse(fs.readFileSync(file(ctx),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}}
const busy=new Set<string>();
const historyFile=(ctx:ServiceContext)=>path.join(ctx.dataRoot,'pattern-history.json');
function history(ctx:ServiceContext):unknown[]{try{return JSON.parse(fs.readFileSync(historyFile(ctx),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}}
async function historical(ctx:ServiceContext,id:string,signal:AbortSignal){
 if(id==='weak_to_strong')throw new ServiceError('bad_request','弱转强需当时盘中快照；当前日线资料不能还原触发时刻，不计算伪回测。');
 const now=new Date(),{day,hm}=clockOf(now),cal=await fetchTodayCalendar(ctx,day,fetchEndpoint,signal);
 const end=cal?.is_today_trading_day&&hm<'16:00'?cal.previous_trading_day:cal?.last_trading_day;
 if(!end)throw Error('已收盘交易日未确认');
 const {window,gap}=await tradeWindow(ctx,end,5,signal);if(gap||window.length!==5)throw Error('历史交易日窗口不完整');
 const days: {date:string;sample_date:string|null;expected:number|null;rows:{code:string;name:string;ret:number|null}[];error:string|null}[]=[];
 for(const date of window){
  if(signal.aborted)throw Error('历史检查已取消');
  try{
   const request={args:{date},consistency:consistencyFor(date,retentionFloor(now),false),signal};
   const raw=(await fetchEndpoint(ctx,{endpoint:'cn_shortline_ladder',...request})).envelope as {extra?:{result?:{stocks:PoolRow[];total:number;sample_date:string;quote_date:string}}};
   const p=raw.extra?.result;if(!p||!p.stocks?.length||p.total!==p.stocks.length||p.quote_date!==date||p.sample_date>=date)throw Error('完整历史样本缺失');
   validatePatternPool(p.stocks);
   const selected=evaluatePattern(id,p.stocks,[],now.getTime()).filter(r=>r.status==='met');
   const result=(await fetchEndpoint(ctx,{endpoint:'cn_shortline_settled',...request})).envelope as {extra?:{settled?:boolean;result?:{prev_date?:string;date?:string}}};
   if(result.extra?.settled!==true||result.extra.result?.prev_date!==p.sample_date||result.extra.result?.date!==date)throw Error('后续表现的日期或定稿状态不匹配');
   const by=new Map(settledRows(result).map(r=>[r.code,r.ret]));
   days.push({date,sample_date:p.sample_date,expected:selected.length,rows:selected.map(r=>({code:r.code,name:r.name,ret:by.get(r.code)??null})),error:null});
  }catch(e){if(signal.aborted)throw e;days.push({date,sample_date:null,expected:null,rows:[],error:e instanceof Error?e.message:'历史资料未取得'});}
 }
 const rows=days.flatMap(d=>d.rows),returns=rows.flatMap(r=>r.ret===null?[]:[r.ret]);
 const complete=days.every(d=>!d.error)&&rows.every(r=>r.ret!==null);
 const report={id:crypto.randomUUID(),pattern:id,version:1,at:now.toISOString(),days,complete,sample:rows.length,known:returns.length,mean:complete&&returns.length>=20?returns.reduce((a,b)=>a+b,0)/returns.length:null,note:'历史样本表现：先按前日完整涨停池选样，再核对次日收盘涨跌。不是成交回测；不含排队、成本或可买到假设，不输出年化/策略净值。缺日或缺股时不出汇总，少于20只次仅看明细。'};
 const reports=[...history(ctx),report];fs.mkdirSync(ctx.dataRoot,{recursive:true});fs.writeFileSync(historyFile(ctx)+'.tmp',JSON.stringify(reports),{mode:0o600});fs.renameSync(historyFile(ctx)+'.tmp',historyFile(ctx));
}
registerView({id:'pattern_lab',label:'经典战法',run:async ctx=>({patterns:PATTERNS,runs:read(ctx),history:history(ctx),execution:EXECUTION_READINESS}),act:async(ctx,body,signal)=>{
 signal=AbortSignal.any([signal,AbortSignal.timeout(180000)]);
 if(!['observe','history'].includes(String(body.action))||typeof body.pattern!=='string'||!PATTERNS.some(p=>p.id===body.pattern))throw new ServiceError('bad_request','请选择有效模式');
 if(busy.has(ctx.dataRoot))throw new ServiceError('bad_request','模式取数进行中');busy.add(ctx.dataRoot);
 try{
  if(body.action==='history'){await historical(ctx,body.pattern,signal);return {patterns:PATTERNS,runs:read(ctx),history:history(ctx),execution:EXECUTION_READINESS};}
  const day=clockOf(new Date()).day,cal=await fetchTodayCalendar(ctx,day,fetchEndpoint,signal);if(!cal?.last_trading_day)throw Error('交易日历未确认，不能替换样本日期');
  const fetched=await fetchEndpoint(ctx,{endpoint:'cn_shortline_ladder',args:{date:cal.last_trading_day},signal});
  const env=fetched.envelope as {status?:string;extra?:{result?:{stocks?:PoolRow[];total?:number;sample_date?:string;quote_date?:string}}};const p=env.extra?.result;
  if(env.status==='failed'||!p?.stocks?.length||p.total!==p.stocks.length||p.quote_date!==cal.last_trading_day||!p.sample_date||p.sample_date>=p.quote_date)throw Error('完整历史涨停池未确认，本次不产生名单');
  validatePatternPool(p.stocks);
  const at=new Date().toISOString();const run:Run={id:crypto.randomUUID(),pattern:body.pattern,version:1,at,sample_date:p.sample_date,quote_date:p.quote_date,pool_count:p.stocks.length,rows:evaluatePattern(body.pattern,p.stocks,marketQuotes(ctx))};
  const runs=[...read(ctx),run];fs.mkdirSync(ctx.dataRoot,{recursive:true});fs.writeFileSync(file(ctx)+'.tmp',JSON.stringify(runs),{mode:0o600});fs.renameSync(file(ctx)+'.tmp',file(ctx));return {patterns:PATTERNS,runs,history:history(ctx),execution:EXECUTION_READINESS};
 }finally{busy.delete(ctx.dataRoot);}
}});
