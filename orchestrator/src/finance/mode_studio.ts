import fs from "node:fs";
import crypto from "node:crypto";
import { safePath, ServiceError, type ServiceContext } from "../service.ts";
import { registerView } from "../views.ts";
import { candidatePool, METRICS, UNIVERSES, parseRanges, type CandidateResult } from "./candidates.ts";

interface Rule { id:string; version:number; name:string; query:Record<string,string>; created_at:string }
interface Combination {id:string;version:number;name:string;rules:{id:string;version:number}[];limit:number;created_at:string}
interface Sample {symbol:string;name:string;rule:string;status:"included"|"unmet"|"missing"|"duplicate"|"capacity";checks:CandidateResult["rows"][number]["checks"]}
interface Experiment {id:string;created_at:string;combination:Combination;rules:Rule[];results:CandidateResult[];samples:Sample[];added:string[];removed:string[];uncertain:string[];previous_id:string|null}
interface Tracking {enabled:boolean;enabled_at:string;last_attempt:string|null;error:string|null}
interface Store {rules:Rule[];combinations:Combination[];runs:Experiment[];tracking?:Record<string,Tracking>}
function file(ctx:ServiceContext){return safePath(ctx,"mode-studio.json");}
function read(ctx:ServiceContext):Store {
  try{return JSON.parse(fs.readFileSync(file(ctx),"utf8")) as Store;}
  catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return {rules:[],combinations:[],runs:[]};throw e;}
}
function write(ctx:ServiceContext,s:Store){fs.mkdirSync(ctx.dataRoot,{recursive:true});const tmp=safePath(ctx,"mode-studio.json.tmp");fs.writeFileSync(tmp,JSON.stringify(s),{mode:0o600});fs.renameSync(tmp,file(ctx));}
function fail(message:string):never{throw new ServiceError("bad_request",message);}
function nameOf(value:unknown){if(typeof value!=="string"||!value.trim()||value.trim().length>60)fail("名称需为 1–60 个字符");return value.trim();}
export function validateModeQuery(raw:unknown):Record<string,string>{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))fail("请提供条件");
  const allowed=new Set(["universe","exclude_st","exclude_halted",...Object.keys(METRICS).flatMap(k=>[`${k}_min`,`${k}_max`])]);
  const query:Record<string,string>={};
  for(const [k,v] of Object.entries(raw)){if(!allowed.has(k)||typeof v!=="string"||v.length>40)fail("条件字段无效");query[k]=v;}
  if(!UNIVERSES.some(u=>u.id===query.universe)||query.universe==="position")fail("请选择自选或公开指数范围");
  for(const key of ["exclude_st","exclude_halted"])if(query[key]!==undefined&&!["0","1"].includes(query[key]!))fail("排除条件无效");
  if(!Object.keys(parseRanges(query)).length)fail("至少设置一个数值条件");
  return query;
}
export function combineSamples(results:CandidateResult[],refs:{id:string;version:number}[],limit:number):Sample[]{
  const seen=new Set<string>();const samples:Sample[]=[];
  for(const [index,result] of results.entries())for(const row of [...result.rows].sort((a,b)=>a.symbol.localeCompare(b.symbol))){
    let status:Sample["status"]=row.verdict==="met"?"included":row.verdict;
    if(status==="included"){
      if(seen.has(row.symbol))status="duplicate";
      else if(seen.size>=limit)status="capacity";
      else seen.add(row.symbol);
    }
    samples.push({...row,rule:`${refs[index]!.id}@${refs[index]!.version}`,status});
  }
  return samples;
}
const running=new Set<string>();
export async function modeAction(ctx:ServiceContext,body:Record<string,unknown>,signal:AbortSignal){
  const store=read(ctx);const now=new Date().toISOString();
  if(body.action==="create_preset"){
    const templates:Record<string,{name:string;query:Record<string,string>}>={
      active:{name:'量能活跃观察',query:{universe:'watch',exclude_st:'1',amount_min:'1',volume_ratio_min:'1.5'}},
      pullback:{name:'大额回撤观察',query:{universe:'watch',exclude_st:'1',change_pct_max:'-3',amount_min:'1'}}
    };
    const preset=typeof body.preset==='string'?templates[body.preset]:undefined;
    if(!preset)fail('预设不存在');
    const rule:Rule={id:crypto.randomUUID(),version:1,name:preset.name,query:validateModeQuery(preset.query),created_at:now};
    store.rules.push(rule);
    store.combinations.push({id:crypto.randomUUID(),version:1,name:preset.name,rules:[{id:rule.id,version:1}],limit:10,created_at:now});
    write(ctx,store);
  }else if(body.action==="save_rule"){
    const id=typeof body.id==="string"?body.id:crypto.randomUUID();
    const previous=store.rules.filter(r=>r.id===id).at(-1);
    if(body.id&&!previous)fail("原规则不存在");
    if((previous?.version??0)!==body.base_version)fail("规则已变化，请刷新后再保存");
    store.rules.push({id,version:(previous?.version??0)+1,name:nameOf(body.name),query:validateModeQuery(body.query),created_at:now});write(ctx,store);
  }else if(body.action==="save_combination"){
    if(!Array.isArray(body.rules)||!body.rules.length||body.rules.length>10)fail("组合需要 1–10 个规则版本");
    const refs=body.rules.map((r:unknown)=>{const ref=r as {id:string;version:number};if(!ref||!store.rules.some(x=>x.id===ref.id&&x.version===ref.version))fail("规则版本不存在");return {id:ref.id,version:ref.version};});
    if(new Set(refs.map(r=>r.id)).size!==refs.length)fail("同一组合不能重复添加同一规则");
    if(!Number.isInteger(body.limit)||Number(body.limit)<1||Number(body.limit)>100)fail("观察名额需为 1–100");
    const id=typeof body.id==="string"?body.id:crypto.randomUUID();const previous=store.combinations.filter(c=>c.id===id).at(-1);
    if(body.id&&!previous)fail("原组合不存在");
    if((previous?.version??0)!==body.base_version)fail("组合已变化，请刷新后再保存");
    store.combinations.push({id,version:(previous?.version??0)+1,name:nameOf(body.name),rules:refs,limit:Number(body.limit),created_at:now});write(ctx,store);
  }else if(body.action==="track"){
    if(typeof body.enabled!=="boolean"||!store.combinations.some(c=>c.id===body.id&&c.version===body.version))fail("组合版本或开关无效");
    const key=`${body.id}@${body.version}`;
    store.tracking??={};
    store.tracking[key]={enabled:body.enabled,enabled_at:now,last_attempt:null,error:null};write(ctx,store);
  }else if(body.action==="observe"){
    const combination=store.combinations.find(c=>c.id===body.id&&c.version===body.version);if(!combination)fail("组合版本不存在");
    if(running.has(ctx.dataRoot))fail("已有模式观察正在取数，请稍后查看");running.add(ctx.dataRoot);
    try{
      const rules=combination.rules.map(ref=>store.rules.find(r=>r.id===ref.id&&r.version===ref.version)!);
      const results:CandidateResult[]=[];
      for(const rule of rules){if(signal.aborted)throw Error("观察已取消");results.push(await candidatePool(ctx,{...rule.query,refresh:"1"},signal));}
      if(signal.aborted)throw Error("观察已取消");
      const samples=combineSamples(results,combination.rules,combination.limit);
      const current=read(ctx); // Preserve versions saved while fetching.
      const previous=current.runs.filter(r=>r.combination.id===combination.id&&r.combination.version===combination.version).at(-1);
      const old=new Set(previous?.samples.filter(s=>s.status==="included").map(s=>s.symbol)??[]);
      const chosen=new Set(samples.filter(s=>s.status==="included").map(s=>s.symbol));
      const absent=[...old].filter(s=>!chosen.has(s));
      const uncertain=absent.filter(symbol=>!samples.some(s=>s.symbol===symbol)||samples.some(s=>s.symbol===symbol&&s.status==='missing'));
      current.runs.push({id:crypto.randomUUID(),created_at:new Date().toISOString(),combination,rules,results,samples,added:[...chosen].filter(s=>!old.has(s)),removed:absent.filter(s=>!uncertain.includes(s)),uncertain,previous_id:previous?.id??null});write(ctx,current);
    }finally{running.delete(ctx.dataRoot);}
  }else fail("不支持的模式操作");
  return read(ctx);
}
/** Called only during confirmed continuous sessions, with global monitoring enabled. */
export async function tickModes(ctx:ServiceContext,signal:AbortSignal){
  if(running.has(ctx.dataRoot))return;
  for(const [key,tracking] of Object.entries(read(ctx).tracking??{})){
    if(signal.aborted)return;
    if(!tracking.enabled||(tracking.last_attempt&&Date.now()-Date.parse(tracking.last_attempt)<15*60*1000))continue;
    const [id,version]=key.split('@');
    const store=read(ctx);const current=store.tracking?.[key];if(!current?.enabled)continue;
    current.last_attempt=new Date().toISOString();current.error=null;write(ctx,store);
    try{await modeAction(ctx,{action:'observe',id,version:Number(version)},signal);}
    catch{const latest=read(ctx);if(latest.tracking?.[key]){latest.tracking[key]!.error='本轮观察未完成；下个周期重试，不补造中断期间样本。';write(ctx,latest);}}
  }
}
registerView({id:"mode_studio",label:"模式工作室",run:async ctx=>read(ctx),act:modeAction});
