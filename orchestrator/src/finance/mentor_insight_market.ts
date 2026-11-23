import { localClock } from "../notify.ts";
import { fetchEndpoint, ServiceError, type FetchResult, type ServiceContext } from "../service.ts";
import { readSnapshot, snapshotKey } from "../snapshot.ts";
import { calendarFromEnvelope, resolveSession } from "./session.ts";
import { fetchTodayCalendar, isWeekend } from "./shortline/intraday.ts";
import { retentionFloor, validDate } from "./shortline/history.ts";
import { closingBreadth } from "./shortline/sentiment_rhythm.ts";
import { closedReviewBlock } from "./review_business_day.ts";

interface Row { field?: string; record_key?: string; period?: string; source?: string; value?: unknown; unit?: string; note?: string }
interface ReviewEvidence { key: string; title: string; text: string; source: string; date: string }
interface Input {
  status?: string; extra?: { date?: string; settled?: boolean; exchange_close_dates?: Record<string,string> };
  evidence?: Row[];
}
export interface MarketFrame {
  breadth: number | null; feedback: number | null; promotion: number | null; broken: number | null;
  height: number | null; theme: string | null; turnover: number | null; dragon: string | null;
  sources: Record<string, string>; fetchedAt: string[]; gaps: string[];
  reviewEvidence: ReviewEvidence[]; reviewGaps: string[];
}
export const emptyFrame = (): MarketFrame => ({ breadth: null, feedback: null, promotion: null, broken: null,
  height: null, theme: null, turnover: null, dragon: null, sources:{}, fetchedAt:[], gaps: [], reviewEvidence:[], reviewGaps:[] });
const numeric = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const daily = "cn_shortline_daily", breadth = "cn_market_breadth_history", theme = "cn_shortline_themes", dragon = "cn_review_dragon";
const sourceName: Record<string,string> = {
  [daily]:"复盘 · 每日情绪（东财涨停、炸板、昨日涨停池）", [breadth]:"复盘 · 通达信沪深京收盘统计",
  [theme]:"复盘 · 题材事件树（涨停原因归组，可多标签）", [dragon]:"复盘 · 龙虎榜收盘披露",
};

function dateRows(result: FetchResult | null, date: string, endpoint: string, knownBy=Date.now()) {
  if (!result) return null;
  const input = result.envelope as Input;
  if (!["ok","partial"].includes(input.status ?? "") || input.extra?.date !== date ||
      !(Date.parse(result.fetched_at) >= Date.parse(date+"T15:00:00+08:00")) ||
      Date.parse(result.fetched_at)>knownBy) return null;
  if (endpoint === daily || endpoint === theme) {
    if (!input.extra.settled) return null;
  } else if (endpoint === breadth && !closingBreadth(result.envelope,date)) {
    return null;
  } else if (endpoint === dragon) {
    // A later historical download does not establish when the original disclosure was public.
    if (Date.parse(result.fetched_at) > Date.parse(date+"T23:59:59.999+08:00")) return null;
  }
  const rows = input.evidence?.filter(row => row.period === date) ?? [];
  return rows.length ? rows : null;
}
function completeClose(endpoint:string,rows:Row[],result:FetchResult) {
  if (result.envelope.status!=="ok") return false;
  if (endpoint===daily) return valueOf(rows,"money_effect_median_ret")!==null && valueOf(rows,"ladder_highest")!==null &&
    valueOf(rows,"promotion_rate","1进2")!==null && valueOf(rows,"broken_rate")!==null;
  if (endpoint===theme) return rows.some(r=>r.field==="topic_limit_up" && numeric(r.value));
  return true;
}

function argsFor(endpoint: string, date: string): Record<string,unknown> {
  return endpoint === dragon ? {day:date} : {date};
}
function snapshot(ctx: ServiceContext, endpoint: string, date: string) {
  return readSnapshot<FetchResult>(ctx.dataRoot, snapshotKey(endpoint, "", argsFor(endpoint,date)))?.payload ?? null;
}
async function readClose(ctx: ServiceContext, endpoint: string, date: string, signal: AbortSignal, refresh: boolean) {
  const cached = snapshot(ctx,endpoint,date);
  const valid = dateRows(cached,date,endpoint);
  // The partial sources can improve after publication. Reuse them briefly.
  if (valid && cached && !refresh && (completeClose(endpoint,valid,cached) || Date.now()-Date.parse(cached.fetched_at)<300_000)) return cached;
  if ((endpoint === daily || endpoint === theme) && date < retentionFloor(new Date())) return valid ? cached : null;
  if (endpoint === dragon && date < localClock(new Date(),"Asia/Shanghai").day) return valid ? cached : null;
  try {
    const result = await fetchEndpoint(ctx,{endpoint, args:argsFor(endpoint,date), consistency:{mode:"fresh"}, signal, timeout_ms:15_000});
    const rows = dateRows(result,date,endpoint);
    if (rows && (completeClose(endpoint,rows,result) || !cached || !valid || !completeClose(endpoint,valid,cached))) return result;
  } catch { signal.throwIfAborted(); }
  return valid ? cached : null;
}
function valueOf(rows: Row[], field: string, record?: string) {
  const v = rows.find(r => r.field===field && (record === undefined || r.record_key===record))?.value;
  return numeric(v) ? v : null;
}

const clean = (value: unknown, limit=82) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0,limit) : "";
function label(row: Row) {
  const key=clean(row.record_key).split("|").slice(1).join("|") || clean(row.record_key);
  const name=row.field==="board_net_sw_close" || row.field==="market_dist_count"
    ? clean(row.note,30) : /^(?!按|东财行业)[^;；(（]{1,20}(?=[(（])/.exec(clean(row.note))?.[0];
  if (row.field==="market_dist_count") return name || key;
  return name && key ? name+"（"+key+"）" : key || name || "";
}
function rowValue(row: Row) {
  if (!numeric(row.value)) return clean(row.value);
  if (row.unit==="小数") return (row.value*100).toFixed(2)+"%";
  if (row.unit==="%") return Number(row.value.toFixed(2))+"%";
  if (row.unit==="元" && Math.abs(row.value)>=1e7) return (row.value/1e8).toFixed(2)+"亿元";
  return String(row.value)+clean(row.unit, 8);
}
function summaryRows(rows: Row[], fields: Record<string,string>) {
  return rows.flatMap(row=>{
    const heading = fields[row.field ?? ""];
    const value = rowValue(row);
    return heading && value ? [heading+(row.record_key ? " "+label(row) : "")+" "+value] : [];
  }).slice(0,30).join("；");
}
function rankedRows(rows: Row[], field: string, top: number, bottom=0) {
  const ordered=rows.filter(r=>r.field===field && numeric(r.value) && !!r.record_key)
    .sort((a,b)=>Number(b.value)-Number(a.value)||String(a.record_key).localeCompare(String(b.record_key)));
  const front=ordered.slice(0,top), tail=ordered.slice(Math.max(front.length,ordered.length-bottom));
  return [...front,...tail].map(r=>label(r)+" "+rowValue(r)).join("；");
}
const panelFacts: Record<string,string> = {
  limit_down_count:"跌停", seal_never_broken_rate:"未开板封板比例", broken_pool_count:"炸板池",
  loss_sample:"昨日涨停股有反馈",loss_deep5_count:"昨日涨停股跌幅至少 5%",loss_worst_ret:"昨日涨停股最差涨幅",
};
const panelEmotion: Record<string,string> = {
  money_effect_sample:"昨日涨停反馈样本",money_effect_positive_rate:"昨日涨停样本今日收红比例",
  consec_premium_median_ret:"昨日连板组今日中位数",promotion_rate:"晋级率",ladder_tier_count:"连板梯队",
};
type Panel = {
  key:string; endpoint:string; title:string; args:(day:string)=>Record<string,unknown>;
  summarize:(rows:Row[])=>string; block?:string; sameEvening?:boolean; settled?:boolean;
};
const byDate=(date:string)=>({date});
const byDay=(day:string)=>({day});
const panels: Panel[] = [
  {key:"index",endpoint:"em_market_trend",title:"主要指数收盘与沪深量能",args:end=>({days:300,end}),block:"trend",
    summarize:rows=>summaryRows(rows,{index_change_pct:"当日涨跌",index_return_5d:"近 5 日涨跌",market_amount_total:"沪深成交额",market_amount_ma20:"20 日均量",market_amount_ma60:"60 日均量"})},
  {key:"index-intraday",endpoint:"cn_review_index_minutes",title:"上证分时",args:byDate,summarize:rows=>{
    const points=rows.filter(r=>r.field==="index_minute_price" && numeric(r.value));
    if (!points.length) return "";
    const sorted=[...points].sort((a,b)=>String(a.record_key).localeCompare(String(b.record_key)));
    const byPrice=[...points].sort((a,b)=>Number(a.value)-Number(b.value));
    const extremes: [string,Row][] = [["首点",sorted[0]!],["最高",byPrice.at(-1)!],["最低",byPrice[0]!],["末点",sorted.at(-1)!]];
    return extremes.map(([name,point])=>name+" "+label(point)+" "+rowValue(point)).join("；");
  }},
  {key:"emotion",endpoint:"cn_shortline_emotion",title:"情绪四项与晋级",args:byDate,settled:true,summarize:rows=>summaryRows(rows,panelEmotion)},
  {key:"facts",endpoint:"cn_shortline_facts",title:"封板与亏钱效应",args:byDate,settled:true,summarize:rows=>summaryRows(rows,panelFacts)},
  {key:"structure",endpoint:"cn_shortline_structure",title:"各制度涨停结构和连板股",args:byDate,
    summarize:rows=>summaryRows(rows,{structure_mix_count:"涨停结构",leader_name:"连板股",leader_boards:"连板高度",leader_sector:"行业"})},
  {key:"board-flow",endpoint:"cn_review_industry_close",title:"申万一级行业收盘资金",args:byDate,block:"board_flow",summarize:rows=>{
    const rank=rankedRows(rows,"board_net_sw_close",5,4);
    return rank ? rank+"。按申万一级成分的大单和超大单净额汇总，只摘录榜单两端" : "";
  }},
  {key:"turnover",endpoint:"cn_shortline_turnover_top",title:"沪深京成交额前列",args:date=>({date,top:20}),block:"turnover",summarize:rows=>rankedRows(rows,"turnover_amount",10)},
  {key:"margin",endpoint:"em_market_margin",title:"已披露两融",args:()=>({days:60}),block:"margin",sameEvening:true,
    summarize:rows=>summaryRows(rows,{market_margin_balance:"两融余额",market_financing_net_buy:"融资净买入"})},
  {key:"abnormal",endpoint:"cn_review_abnormal",title:"严重异动与监控",args:byDay,sameEvening:true,summarize:rows=>summaryRows(rows,{
    review_abnormal_near_count:"次日预警样本",review_abnormal_disclosures_count:"当日披露",review_abnormal_monitor_count:"监控中",
  })},
  {key:"broken-pool",endpoint:"cn_review_broken_pool",title:"炸板池",args:byDay,summarize:rows=>{
    const count=summaryRows(rows,{review_broken_pool_count:"炸板数"});
    return [count,rankedRows(rows,"review_broken_pct",3,3)].filter(Boolean).join("；");
  }},
];

/** Reuse snapshots already produced by the review panels; avoid triggering a second page's worth of network calls. */
export function reviewPanelEvidence(ctx:ServiceContext, frame:MarketFrame, date:string, knownBy=Date.now()) {
  for (const panel of panels) {
    const {key,endpoint,title} = panel;
    const result=readSnapshot<FetchResult>(ctx.dataRoot,snapshotKey(endpoint,"",panel.args(date)))?.payload;
    const rows=closedPanelRows(panel,result,date,knownBy);
    const text=rows && panel.summarize(rows);
    if (!text) { frame.reviewGaps.push(title+"暂无符合复盘口径的本地快照。"); continue; }
    const observed=rows.map(r=>r.period!).sort().at(-1) ?? date;
    const partial=result?.envelope.status==="partial";
    frame.reviewEvidence.push({key,title,text:text.slice(0,1050)+(partial?"。仅汇总可核对的部分样本。":"。"),source:"复盘 · "+title,date:observed});
    const published=publishedAt((result?.envelope.extra as {published_at?:string}|undefined)?.published_at);
    if (Number.isFinite(published)) frame.fetchedAt.push(new Date(published).toISOString());
    if (result) frame.fetchedAt.push(result.fetched_at);
  }
}
function closedPanelRows(panel: Panel, result: FetchResult | undefined, date: string, knownBy: number) {
  const status=result?.envelope.status;
  if (!result || status!=="ok" && status!=="partial" || Date.parse(result.fetched_at)>knownBy ||
      !(Date.parse(result.fetched_at)>=Date.parse(date+"T15:00:00+08:00")) ||
      panel.sameEvening && Date.parse(result.fetched_at)>Date.parse(date+"T23:59:59.999+08:00")) return [];
  const extra=result.envelope.extra as (Input["extra"] & {published_at?: string}) | undefined;
  const publication=publishedAt(extra?.published_at);
  if (Number.isFinite(publication) && publication>Math.min(knownBy,Date.parse(date+"T23:59:59.999+08:00"))) return [];
  if (panel.settled && extra?.settled!==true) return [];
  if (panel.block) {
    const verified=closedReviewBlock({id:panel.block,title:panel.title,status,
      fetched_at:result.fetched_at,envelope:result.envelope},{review_date:date});
    const day=verified.business_date;
    if (!day || (panel.block!=="margin" && day!==date)) return [];
    return (verified.envelope?.evidence as Row[]|undefined)?.filter(row=>row.period===day) ?? [];
  }
  if (extra?.date!==date) return [];
  return ((result.envelope.evidence as Row[]|undefined) ?? []).filter(row=>row.period===date);
}
function publishedAt(value: string | undefined) {
  const shanghai=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(value??"");
  return Date.parse(shanghai ? value!.replace(" ","T")+"+08:00" : value??"");
}
export function frameFromResults(results: Record<string,FetchResult|null>, date: string, knownBy=Date.now()) {
  const frame = emptyFrame();
  for (const [endpoint,result] of Object.entries(results)) {
    const rows = dateRows(result,date,endpoint,knownBy);
    if (!rows || !result) { frame.gaps.push(sourceName[endpoint]+"缺少可核验的当日记录。"); continue; }
    frame.sources[endpoint] = sourceName[endpoint]+" · "+result.fetched_at;
    frame.fetchedAt.push(result.fetched_at);
    if (endpoint === daily) {
      frame.feedback = valueOf(rows,"money_effect_median_ret");
      frame.promotion = valueOf(rows,"promotion_rate","1进2");
      frame.broken = valueOf(rows,"broken_rate");
      frame.height = valueOf(rows,"ladder_highest");
    } else if (endpoint === breadth) {
      const sum = (field: string) => {
        const counts = ["SH","SZ","BJ"].map(ex => valueOf(rows.filter(r => r.source === "tdx"),field,"exchange|"+ex));
        return counts.every(numeric) ? counts.reduce((a,b)=>a+b,0) : null;
      };
      const up = sum("market_up_count"), down = sum("market_down_count");
      if (up !== null && down !== null && up+down > 0) frame.breadth = 100*up/(up+down);
      const flat=sum("market_flat_count");
      if (up!==null && down!==null) frame.reviewEvidence.push({key:"breadth-counts",title:"沪深京收盘涨跌家数",
        text:`上涨 ${up} 家，下跌 ${down} 家`+(flat===null?"。":`，平盘 ${flat} 家。`),source:sourceName[breadth]!,date});
      const distribution=summaryRows(rows,{market_dist_count:"分档"});
      if (distribution && (result.envelope.extra as {distribution_date?:string}|undefined)?.distribution_date===date) {
        frame.reviewEvidence.push({key:"breadth-distribution",title:"全市场收盘涨跌分布",
          text:distribution+"。分档保留源站口径，与交易所合计样本可能有差异。",
          source:"复盘 · 收盘涨跌分布（"+(rows.find(r=>r.field==="market_dist_count")?.source==="eastmoney"?"东财":"通达信")+"）",date});
      }
      frame.turnover = sum("market_turnover_amount");
    } else if (endpoint === theme) {
      const top = rows.filter(r => r.field==="topic_limit_up" && r.record_key && numeric(r.value) && r.value>0)
        .sort((a,b)=>Number(b.value)-Number(a.value)).slice(0,8);
      if (top.length) frame.theme = top.slice(0,3).map(r=>r.record_key+" "+r.value+" 只").join("、");
      if (top.length) frame.reviewEvidence.push({key:"theme-structure",title:"主要涨停题材结构",date,source:sourceName[theme]!,
        text:top.map(r=>[
          clean(r.record_key)+" 涨停 "+r.value+" 只",
          ...rows.filter(other=>other.record_key===r.record_key && ["topic_first_boards","topic_highest","topic_broken","topic_state","topic_continuation_rate"].includes(other.field??""))
            .map(other=>({"topic_first_boards":"首板","topic_highest":"最高","topic_broken":"炸板","topic_state":"状态","topic_continuation_rate":"昨日样本延续"}[other.field!])+" "+rowValue(other)),
        ].join("，")).join("；")+"。按涨停原因归组，同一股票可属于多个题材。"});
    } else if (endpoint === dragon) {
      const names = new Set(rows.filter(r => r.field==="dragon_total_net" && !!r.record_key).map(r=>r.record_key));
      if (names.size) frame.dragon = "当日公布的上榜净额记录 "+names.size+" 条；披露名单只覆盖上榜标的。";
      const ranked=rankedRows(rows,"dragon_total_net",5,4);
      if (ranked) frame.reviewEvidence.push({key:"dragon-net",title:"龙虎榜净额居前与居后",date,source:sourceName[dragon]!,
        text:ranked+"。仅为披露样本，单日和多日区间可能重叠。"});
    }
    if (result.envelope.status==="partial") frame.gaps.push(sourceName[endpoint]+"仅覆盖部分记录。");
  }
  return frame;
}
export async function marketFrame(ctx: ServiceContext,date: string,signal: AbortSignal,refresh: boolean) {
  const entries = await Promise.all([daily,breadth,theme,dragon].map(async endpoint =>
    [endpoint,await readClose(ctx,endpoint,date,signal,refresh)] as const));
  const frame=frameFromResults(Object.fromEntries(entries),date);
  reviewPanelEvidence(ctx,frame,date);
  return frame;
}
/** Read previous settled local sessions only. No historical quote downloads on re-entry. */
export function previousFrames(ctx: ServiceContext,date: string) {
  const before: { date: string; frame: MarketFrame }[] = [];
  const day = new Date(date+"T00:00:00Z");
  for (let i=0;i<35 && before.length<15;i++) {
    day.setUTCDate(day.getUTCDate()-1);
    const key = day.toISOString().slice(0,10);
    if (isWeekend(key)) continue;
    const result = snapshot(ctx,daily,key);
    if (result && dateRows(result,key,daily)) before.push({date:key,frame:frameFromResults({[daily]:result},key)});
  }
  return before;
}

/** Only immutable calendar facts for this Shanghai date may serve as an offline fallback. */
export function cachedReviewDay(ctx:ServiceContext, now:Date) {
  const clock=localClock(now,"Asia/Shanghai");
  const saved=readSnapshot<FetchResult>(ctx.dataRoot,snapshotKey("fetch_trade_calendar","300308",{}))?.payload;
  const rows=saved?.envelope.evidence as Row[]|undefined;
  if (saved && saved.envelope.status==="ok" && Date.parse(saved.fetched_at)<=now.getTime() &&
      rows?.some(r=>r.field==="is_today_trading_day" && r.period===clock.day)) {
    const cal=calendarFromEnvelope({evidence:rows});
    if (cal && !cal.is_today_trading_day) return cal.last_trading_day;
    if (cal?.is_today_trading_day && clock.hm<"15:00") return cal.previous_trading_day;
    if (cal?.is_today_trading_day && ["closed","post_close"].includes(cal.session_phase) &&
        Date.parse(saved.fetched_at)>=Date.parse(clock.day+"T15:00:00+08:00")) return cal.last_trading_day;
  }
  // A confirmed close, followed only by weekend days, also proves the last business date.
  const d=new Date(clock.day+"T00:00:00Z");
  while (isWeekend(d.toISOString().slice(0,10))) d.setUTCDate(d.getUTCDate()-1);
  const key=d.toISOString().slice(0,10);
  if (key===clock.day && clock.hm<"15:00") return null;
  return dateRows(snapshot(ctx,daily,key),key,daily,now.getTime()) ? key : null;
}

export async function selectedCloseDate(ctx: ServiceContext,requested: string | undefined,signal: AbortSignal) {
  const clock = localClock(new Date(),"Asia/Shanghai");
  if (requested !== undefined && (!validDate(requested) || requested>clock.day || isWeekend(requested)))
    throw new ServiceError("bad_query","请选择已经收盘的交易日。");
  if (requested && requested < clock.day) return requested;
  let date = cachedReviewDay(ctx,new Date());
  if (!date) {
    const calendar = await fetchTodayCalendar(ctx,clock.day,(context,request)=>fetchEndpoint(context,{
      ...request,timeout_ms:10_000}),signal);
    date = calendar ? resolveSession(calendar).review_date : null;
  }
  if (!date) throw new ServiceError("bad_query","交易日历暂未取得，请选择已完成的历史交易日。");
  if (requested && requested !== date) throw new ServiceError("bad_query",`所选日期尚无完整收盘，最近的复盘日为 ${date}。`);
  return date;
}
