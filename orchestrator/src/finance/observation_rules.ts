import fs from "node:fs";
import path from "node:path";
import { fetchEndpoint, ledgerList, ledgerUpsert, type ServiceContext } from "../service.ts";
import { localNotice } from "../notify.ts";
import { wquotesOf, type WQuote } from "./shortline/watch.ts";
import { registerView } from "../views.ts";

export interface ObservationRule {metric:"price"|"pct"|"amount_yuan";operator:"gte"|"lte";value:number}
export function evaluateRule(rule:ObservationRule,quote:WQuote|undefined,now:Date,createdAt:string) {
  if(!["price","pct","amount_yuan"].includes(rule.metric)||!["gte","lte"].includes(rule.operator)||!Number.isFinite(rule.value)||!Number.isFinite(Date.parse(createdAt)))return {status:"unknown",reason:"条件定义或建立时间无效"};
  if(!quote||!/^\d{14}$/.test(quote.quote_time))return {status:"unknown",reason:"行情时间缺失"};
  const t=quote.quote_time;
  const at=Date.parse(`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}T${t.slice(8,10)}:${t.slice(10,12)}:${t.slice(12,14)}+08:00`);
  if(!Number.isFinite(at)||now.getTime()-at>90000||at>now.getTime()+5000||at<Date.parse(createdAt))return {status:"unknown",reason:"行情过期或早于条件建立时间"};
  const value=quote[rule.metric];
  if(value===null||!Number.isFinite(value))return {status:"unknown",reason:"指标缺失"};
  return {status:(rule.operator==="gte"?value>=rule.value:value<=rule.value)?"triggered":"waiting",reason:"",value,quote_time:t};
}
const active=new Set<string>();
interface PendingNotice {id:string;symbol:string;statement:string;reason:string}
function readJsonFile<T>(file:string,fallback:T):T {
  try { return JSON.parse(fs.readFileSync(file,"utf8")) as T; }
  catch(error) { if((error as NodeJS.ErrnoException).code==="ENOENT")return fallback; throw error; }
}
function writeJsonFile(file:string,value:unknown) {
  fs.writeFileSync(file+".tmp",JSON.stringify(value),{mode:0o600});fs.renameSync(file+".tmp",file);
}
async function deliverPending(ctx:ServiceContext,file:string,pending:PendingNotice[]) {
  const records=ledgerList(ctx,"criterion").criterion??[];
  for(const item of [...pending]) {
    const record=records.find(r=>r.id===item.id);
    if(record?.verdict_note===item.reason&&["met","broken"].includes(String(record.status))) {
      await localNotice(ctx.dataRoot,{id:`criterion-${item.id}`,job:"observation",job_label:"观察条件",title:`${item.symbol} · 条件命中`,lines:[item.statement,item.reason],link:`/observations?id=${encodeURIComponent(item.id)}`});
    }
    // An unapplied or edited verdict must not produce a stale notification.
    pending.splice(pending.indexOf(item),1);writeJsonFile(file,pending);
  }
}
export async function evaluateObservations(ctx:ServiceContext,signal:AbortSignal) {
  if(active.has(ctx.dataRoot))return;
  active.add(ctx.dataRoot);
  try {
    const noticeFile=path.join(ctx.dataRoot,"observation-notices.json");
    const pending=readJsonFile<PendingNotice[]>(noticeFile,[]);
    await deliverPending(ctx,noticeFile,pending);
    const records=(ledgerList(ctx,"criterion").criterion??[]).filter(r=>r.status==="pending"&&r.rule&&/^\d{6}$/.test(String(r.symbol??"")));
    if(!records.length)return;
    const codes=[...new Set(records.map(r=>String(r.symbol)))];
    const envs:unknown[]=[];
    for(let i=0;i<codes.length;i+=50){const r=await fetchEndpoint(ctx,{endpoint:"tx_quotes_batch",args:{codes:codes.slice(i,i+50)},consistency:{mode:"fresh"},signal});envs.push(r.envelope);}
    const quotes=wquotesOf(envs);const now=new Date();const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
    const file=path.join(ctx.dataRoot,"observation-checks.json");
    const checks=readJsonFile<Record<string,unknown>>(file,{});
    for(const record of records){
      const result=record.due&&String(record.due)<date?{status:"expired",reason:"观察期已结束，请复核"}:evaluateRule(record.rule as ObservationRule,quotes.get(String(record.symbol)),now,record.created_at);
      checks[record.id]={...result,checked_at:now.toISOString()};
      if(result.status!=="triggered")continue;
      // Re-read before writing so a user pause/edit cannot be overwritten by an in-flight fetch.
      const current=(ledgerList(ctx,"criterion").criterion??[]).find(r=>r.id===record.id);
      if(!current||current.updated_at!==record.updated_at||current.status!=="pending")continue;
      const reason=`条件命中：${JSON.stringify(result)}；来源：腾讯行情快照。只确认该读数，不判断投资观点成立。`;
      // Persist delivery intent and evidence before changing the criterion. A restart can
      // retry the local notification only when the exact verdict actually committed.
      pending.push({id:record.id,symbol:String(record.symbol),statement:String(record.statement),reason});
      writeJsonFile(noticeFile,pending);
      fs.appendFileSync(path.join(ctx.dataRoot,"observation-events.jsonl"),JSON.stringify({at:now.toISOString(),criterion:record,result,phase:"observed"})+"\n",{mode:0o600});
      ledgerUpsert(ctx,{kind:"criterion",record:{...record,status:record.type==="falsifier"?"broken":"met",judged_at:date,verdict_note:reason}});
      await deliverPending(ctx,noticeFile,pending);
    }
    fs.writeFileSync(file+".tmp",JSON.stringify(checks),{mode:0o600});fs.renameSync(file+".tmp",file);
  } finally {active.delete(ctx.dataRoot);}
}
registerView({id:"observation_checks",label:"条件核验",run:async ctx=>readJsonFile(path.join(ctx.dataRoot,"observation-checks.json"),{})});
