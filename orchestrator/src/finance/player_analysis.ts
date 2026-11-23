import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ledgerList, safePath, ServiceError, type ServiceContext } from "../service.ts";
import { registerView } from "../views.ts";
import { analyzePlayers, complete, playerHistory, stockHistory, type PlayerOptions } from "./player_analysis_metrics.ts";
import { invalid, normalizePlayerImport, type PlayerImport } from "./player_analysis_import.ts";
import { recognizeScreenshot, reviewScreenshot } from "./player_screenshot.ts";

type Match = Pick<PlayerImport,"matchId"|"matchName"|"divisionId"|"divisionName"> & {dates:string[]};
type Version = {revision:number; importedAt:string};
interface MembershipResult {userId:string;checkedAt:string;matches:{matchId:string;name:string;spmatchSeq?:string}[]}
type Preview = {data:PlayerImport; digest:string; root:string; expires:number; generation:string; baseRevision:number};
const previews = new Map<string, Preview>();
const limitBytes = 8 * 1024 * 1024;

function withStore<T>(ctx:ServiceContext, write:boolean, work:(db:DatabaseSync|null)=>T):T {
  // Ownership of snapshots created before enrollment checks cannot be inferred.
  const file = safePath(ctx,"player-analysis","member-store.sqlite");
  for (const suffix of ["-journal","-wal","-shm"]) safePath(ctx,"player-analysis","member-store.sqlite"+suffix);
  if (!write && !fs.existsSync(file)) return work(null);
  if (write) fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const db = new DatabaseSync(file,{readOnly:!write});
  try {
    db.exec("PRAGMA busy_timeout=4000");
    if (write) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS binding(id INTEGER PRIMARY KEY CHECK(id=1), userId TEXT NOT NULL,
          checkedAt TEXT NOT NULL, matches TEXT NOT NULL, generation TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS snapshots(
          matchId TEXT NOT NULL, matchName TEXT NOT NULL, divisionId TEXT NOT NULL, divisionName TEXT NOT NULL,
          tradeDate TEXT NOT NULL, revision INTEGER NOT NULL, importedAt TEXT NOT NULL,
          digest TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(matchId,divisionId,tradeDate,revision),
          UNIQUE(matchId,divisionId,tradeDate,digest));
        CREATE TABLE IF NOT EXISTS screenshot_blobs(id TEXT PRIMARY KEY,mime TEXT NOT NULL,image BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS follows(
          matchId TEXT NOT NULL, divisionId TEXT NOT NULL, playerId TEXT NOT NULL,
          PRIMARY KEY(matchId,divisionId,playerId));`);
    } else db.exec("BEGIN");
    const result = work(db);
    db.exec("COMMIT");
    return result;
  } finally { db.close(); }
}

const freshnessMs = 10 * 60_000;
function membershipOf(db:DatabaseSync|null) {
  const row = db?.prepare("SELECT * FROM binding WHERE id=1").get();
  if (!row) return null;
  const checkedAt = String(row.checkedAt);
  const until = Date.parse(checkedAt)+freshnessMs;
  return {userId:String(row.userId),checkedAt,matches:JSON.parse(String(row.matches)) as MembershipResult["matches"],
    expiresAt:new Date(until).toISOString(),expired:Date.now()>=until,
    canRebind:!db!.prepare("SELECT 1 FROM snapshots LIMIT 1").get(),generation:String(row.generation)};
}
type Membership = NonNullable<ReturnType<typeof membershipOf>>;
function publicBinding(member:Membership|null) {
  if (!member) return null;
  const {generation:_,...publicData}=member;
  return publicData;
}
function authorize(member:Membership|null,matchId:unknown,expected:unknown):Membership {
  if (!member) invalid("请先核验本机绑定账号的参赛资格");
  if (expected!==undefined && expected!==member.userId) invalid("绑定账号已变更，请刷新重试");
  if (member.expired) invalid("参赛核验已过期，请重新核验账号");
  if (!member.matches.some(m=>m.matchId===matchId)) invalid("该账号当前未在此比赛的有效参赛名单中");
  return member;
}

export async function bindPlayerProfile(ctx:ServiceContext,userId:unknown,signal:AbortSignal,
  verify:(id:string,signal:AbortSignal)=>Promise<MembershipResult>) {
  if (typeof userId!=="string" || !/^[1-9]\d{0,15}$/.test(userId)) invalid("请输入有效的数字用户 ID");
  const generation = randomUUID();
  // Clear the cached grant before rechecking so a failed refresh never keeps it alive.
  withStore(ctx,true,db=>{
    const prior=membershipOf(db);
    if (prior && prior.userId!==userId && !prior.canRebind) invalid("本机已有其他账号的导入资料，不能切换账号查看");
    if (prior) db!.prepare("UPDATE binding SET matches='[]',checkedAt=?,generation=? WHERE id=1").run(new Date(0).toISOString(),generation);
  });
  const result=await verify(userId,signal);
  signal.throwIfAborted();
  if (result.userId!==userId || !Array.isArray(result.matches)) invalid("来源未确认此账号的参赛信息");
  return withStore(ctx,true,db=>{
    const prior=membershipOf(db);
    if (prior && prior.generation!==generation) invalid("账号核验已更新，请刷新");
    if ((!prior || prior.userId!==userId) && result.matches.length===0) invalid("该账号没有可核验的进行中比赛");
    const checkedAt=new Date().toISOString();
    db!.prepare("INSERT OR REPLACE INTO binding VALUES(1,?,?,?,?)").run(userId,checkedAt,JSON.stringify(result.matches),generation);
    return {membership:publicBinding(membershipOf(db))};
  });
}

function matchesOf(db:DatabaseSync|null):Match[] {
  if (!db) return [];
  const rows = db.prepare(`SELECT matchId,matchName,divisionId,divisionName,tradeDate,MAX(revision)
    FROM snapshots GROUP BY matchId,divisionId,tradeDate ORDER BY tradeDate DESC, matchId, divisionId`).all();
  const groups = new Map<string,Match>();
  for (const r of rows) {
    const key = JSON.stringify([r.matchId,r.divisionId]);
    if (!groups.has(key)) groups.set(key,{matchId:String(r.matchId),matchName:String(r.matchName),divisionId:String(r.divisionId),divisionName:String(r.divisionName),dates:[]});
    groups.get(key)!.dates.push(String(r.tradeDate));
  }
  return [...groups.values()];
}

function bounded(value:string|undefined, fallback:number, max:number):number {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n<1 || n>max) invalid("分组或版本参数超出范围");
  return n;
}

export function readPlayerAnalysis(ctx:ServiceContext,q:Record<string,string>) {
  return withStore(ctx,false,db=>{
    const bound=membershipOf(db);
    if (q.expectedUserId && q.expectedUserId!==bound?.userId) invalid("绑定账号不符，请刷新重试");
    const matches = bound && !bound.expired ? matchesOf(db).filter(m=>bound.matches.some(x=>x.matchId===m.matchId)) : [];
    if (!q.matchId && !q.divisionId) return {matches,membership:publicBinding(bound)};
    authorize(bound,q.matchId,q.expectedUserId);
    const match = matches.find(m=>m.matchId===q.matchId && m.divisionId===q.divisionId);
    if (!db || !match) throw new ServiceError("not_found","本地没有该赛事赛组的数据");
    const date = q.date || match.dates[0];
    const versions = db.prepare("SELECT revision,importedAt FROM snapshots WHERE matchId=? AND divisionId=? AND tradeDate=? ORDER BY revision DESC").all(q.matchId,q.divisionId,date) as Version[];
    const version = q.revision ? versions.find(v=>v.revision===bounded(q.revision,1,Number.MAX_SAFE_INTEGER))
      : versions.find(v=>!q.asOf || v.importedAt<=q.asOf);
    if (!version) throw new ServiceError("not_found","该日期或版本无快照");
    const asOf = q.asOf || (q.revision ? version.importedAt : String(db.prepare("SELECT MAX(importedAt) AS t FROM snapshots").get()?.t));
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(asOf) || asOf<version.importedAt) invalid("快照截止时间与所选版本不一致");
    if(q.mode==="screenshot"){
      const snapshot=db.prepare("SELECT payload FROM snapshots WHERE matchId=? AND divisionId=? AND tradeDate=? AND revision=?").get(q.matchId,q.divisionId,date,version.revision)!;
      const player=(JSON.parse(String(snapshot.payload)) as PlayerImport).players.find(p=>p.id===q.playerId);
      if(!player?.screenshot) throw new ServiceError("not_found","该版本没有选手截图");
      const ref=player.screenshot;
      const imageId=q.field==="exposure"&&ref.exposure?(ref.exposureId??ref.id):q.field==="holdings"&&ref.holdings?(ref.holdingsId??ref.id):!q.field?ref.id:null;
      if(!imageId) throw new ServiceError("not_found","该字段没有对应截图");
      const blob=db.prepare("SELECT mime,image FROM screenshot_blobs WHERE id=?").get(imageId);
      if(!blob) throw new ServiceError("not_found","未找到此版本的截图");
      return {image:"data:"+blob.mime+";base64,"+Buffer.from(blob.image as Uint8Array).toString("base64")};
    }
    const history = db.prepare(`SELECT payload,MAX(revision) FROM snapshots WHERE matchId=? AND divisionId=?
      AND tradeDate<=? AND importedAt<=? AND (tradeDate<>? OR revision=?) GROUP BY tradeDate ORDER BY tradeDate`)
      .all(q.matchId,q.divisionId,date,asOf,date,version.revision).map(r=>JSON.parse(String(r.payload)) as PlayerImport);
    const followed = db.prepare("SELECT playerId FROM follows WHERE matchId=? AND divisionId=? ORDER BY playerId").all(q.matchId,q.divisionId).map(r=>String(r.playerId));
    if (q.rankBasis && !["today","previous","yesterday"].includes(q.rankBasis)) invalid("分组依据无效");
    const options:PlayerOptions = {date,rankBasis:q.rankBasis==="today"?"today":"previous",n:bounded(q.groupSize,20,10000),
      ...(q.groupPct ? {pct:bounded(q.groupPct,10,50)/100} : {}), followed,watch:(ledgerList(ctx,"watch").watch??[]).map(r=>String(r.symbol))};
    const common = {date,revision:version.revision,importedAt:version.importedAt,asOf};
    const officialMatchSeq=bound?.matches.find(m=>m.matchId===q.matchId)?.spmatchSeq;
    if (q.mode==="history") {
      if (q.playerId) return {...common,history:playerHistory(history,date,q.playerId)};
      if (q.symbol) return {...common,history:stockHistory(history,options,q.symbol)};
      invalid("请选择股票或选手");
    }
    return {...common,officialMatchSeq,matches,membership:publicBinding(bound),versions,followed,analysis:analyzePlayers(history,options)};
  });
}

function prepare(ctx:ServiceContext, value:unknown, expectedUserId:unknown, automated=false) {
  const inputMatch=(value && typeof value==="object" && "matchId" in value) ? value.matchId : null;
  const member=withStore(ctx,false,db=>authorize(membershipOf(db),inputMatch,expectedUserId));
  if (value && typeof value==="object" && ("sourceUserId" in value || "sourceMatchSeq" in value)) {
    const match=member.matches.find(m=>m.matchId===inputMatch);
    if (!("sourceUserId" in value) || value.sourceUserId!==member.userId || !("sourceMatchSeq" in value) ||
      !match?.spmatchSeq || value.sourceMatchSeq!==match.spmatchSeq) invalid("官网快照的登录账号或战绩赛事序号与本地参赛记录不符");
  }
  const data = normalizePlayerImport(value);
  const now = Date.now();
  for (const [id,p] of previews) if (p.expires <= now) previews.delete(id);
  while (previews.size>=8) previews.delete(previews.keys().next().value!);
  const previewId = randomUUID();
  const warnings:string[]=[];
  if (!data.rankComplete) warnings.push("榜单覆盖不完整，无法确认首尾组成员。");
  if (data.expected==null) warnings.push("应报人数未知。");
  if (!data.previousTradeDate) warnings.push("未声明上一赛事交易日，跨日统计仅采用可确认相邻的快照。");
  const current = withStore(ctx,false,db=>{
    if (authorize(membershipOf(db),data.matchId,expectedUserId).generation!==member.generation) invalid("参赛资格已更新，请重新预览");
    return db?.prepare("SELECT revision,digest,payload FROM snapshots WHERE matchId=? AND divisionId=? AND tradeDate=? ORDER BY revision DESC LIMIT 1").get(data.matchId,data.divisionId,data.date);
  });
  if (automated && current) {
    const prior=JSON.parse(String(current.payload)) as PlayerImport;
    const byId=new Map(data.players.map(row=>[row.id,row]));
    for (const p of prior.players) {
      const row=byId.get(p.id);
      if (!p.screenshot) continue;
      if (!row) invalid("新榜单缺少已有原图记录的选手，已保留原版本。");
      row.screenshot=p.screenshot;
      if (p.screenshot.exposure) row.exposure=p.exposure;
      if (p.screenshot.holdings) {row.symbols=p.symbols;row.holdingsState=p.holdingsState;}
    }
  }
  const payload = JSON.stringify(data);
  if (Buffer.byteLength(payload)>limitBytes) invalid("文件超过 8 MiB");
  const digest = createHash("sha256").update(payload).digest("hex");
  if (current && current.digest!==digest) {
    const prior = JSON.parse(String(current.payload)) as PlayerImport;
    const readable = (d:PlayerImport)=>d.players.filter(complete).length;
    if ((prior.rankComplete && !data.rankComplete) || prior.players.length>data.players.length || readable(prior)>readable(data)) {
      if(automated) invalid("本次榜单或可读持仓覆盖下降，已保留原版本，请核对官网。");
      warnings.push(`此次覆盖下降：名单 ${prior.players.length} → ${data.players.length} 人，完整可读持仓 ${readable(prior)} → ${readable(data)} 人，完整榜单 ${prior.rankComplete?"是":"否"} → ${data.rankComplete?"是":"否"}。确认后将默认显示新版本，旧版本仍可回看。`);
    } else warnings.push("该日已有快照，本次文件按整日版本保存；请核对覆盖范围。");
  }
  previews.set(previewId,{data,digest,root:ctx.dataRoot,expires:Math.min(now+10*60000,Date.parse(member.expiresAt)),generation:member.generation,baseRevision:Number(current?.revision??0)});
  return {previewId,matchName:data.matchName,divisionName:data.divisionName,date:data.date,playerCount:data.players.length,warnings};
}

export function publishContestDay(ctx:ServiceContext,userId:string,data:unknown) {
  const preview=prepare(ctx,data,userId,true);
  const saved=writePlayerAnalysis(ctx,{action:"commitImport",expectedUserId:userId,previewId:preview.previewId});
  if(!("revision" in saved)) invalid("快照未发布");
  return {playerCount:preview.playerCount,revision:saved.revision};
}

export function checkContestReport(ctx:ServiceContext,matchId:string,body:Record<string,unknown>) {
  return withStore(ctx,false,db=>{
    authorize(membershipOf(db),matchId,body.expectedUserId);
    if(typeof body.date!=="string" || !/^\d{4}-\d\d-\d\d$/.test(body.date) || typeof body.playerId!=="string" ||
       !/^\d{1,16}$/.test(body.playerId) || typeof body.divisionId!=="string" || typeof body.revision!=="number" || !Number.isSafeInteger(body.revision)) invalid("选手或报单日期无效");
    const row=db?.prepare(`SELECT 1 FROM snapshots s,json_each(s.payload,'$.players') p WHERE
      matchId=? AND divisionId=? AND tradeDate=? AND revision=? AND json_extract(p.value,'$.id')=? LIMIT 1`)
      .get(matchId,body.divisionId,body.date,body.revision,body.playerId);
    if(!row)invalid("当前版本未找到该选手的报单记录");
    return [body.playerId,body.date];
  });
}

export function writePlayerAnalysis(ctx:ServiceContext,body:Record<string,unknown>) {
  if(body.action==="reviewScreenshot") return withStore(ctx,true,db=>{
    authorize(membershipOf(db),body.matchId,body.expectedUserId);
    return reviewScreenshot(db!,body);
  });
  if (body.action==="previewImport") return prepare(ctx,body.data,body.expectedUserId);
  if (body.action==="commitImport") {
    const preview = previews.get(String(body.previewId));
    if (!preview || preview.root!==ctx.dataRoot || preview.expires<=Date.now()) invalid("导入预览已过期，请重新选择文件");
    const {data,digest} = preview;
    return withStore(ctx,true,db=>{
      const member=authorize(membershipOf(db),data.matchId,body.expectedUserId);
      if (preview.generation!==member.generation) invalid("参赛资格已更新，请重新预览文件");
      const keys = [data.matchId,data.divisionId,data.date];
      const old = db!.prepare("SELECT revision FROM snapshots WHERE matchId=? AND divisionId=? AND tradeDate=? AND digest=?").get(...keys,digest);
      let revision = Number(old?.revision??0);
      if (!old) {
        const head = Number(db!.prepare("SELECT COALESCE(MAX(revision),0) AS rev FROM snapshots WHERE matchId=? AND divisionId=? AND tradeDate=?").get(...keys)?.rev);
        if (head!==preview.baseRevision) invalid("该交易日已发布新版本，请重新预览并核对覆盖范围");
        revision = head+1;
        const last = db!.prepare("SELECT MAX(importedAt) AS t FROM snapshots").get()?.t;
        const importedAt = new Date(Math.max(Date.now(),last?Date.parse(String(last))+1:0)).toISOString();
        db!.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?,?,?,?,?)").run(data.matchId,data.matchName,data.divisionId,data.divisionName,data.date,revision,importedAt,digest,JSON.stringify(data));
      }
      return {matchId:data.matchId,divisionId:data.divisionId,date:data.date,revision};
    });
  }
  if (body.action==="setFollow") {
    const {matchId,divisionId,playerId,followed} = body;
    if (typeof matchId!=="string" || typeof divisionId!=="string" || typeof playerId!=="string" || typeof followed!=="boolean") invalid("关注参数无效");
    return withStore(ctx,true,db=>{
      authorize(membershipOf(db),matchId,body.expectedUserId);
      if (followed) {
        const exists = db!.prepare("SELECT 1 FROM snapshots AS s,json_each(s.payload,'$.players') AS p WHERE matchId=? AND divisionId=? AND json_extract(p.value,'$.id')=? LIMIT 1").get(matchId,divisionId,playerId);
        if (!exists) invalid("赛事中没有此选手");
        db!.prepare("INSERT OR IGNORE INTO follows VALUES(?,?,?)").run(matchId,divisionId,playerId);
      } else db!.prepare("DELETE FROM follows WHERE matchId=? AND divisionId=? AND playerId=?").run(matchId,divisionId,playerId);
      return {playerId,followed};
    });
  }
  invalid("未知的选手分析操作");
}

registerView({id:"player_analysis",label:"选手分析",maxActionBytes:limitBytes,
  run:async(ctx,q,signal)=>{
    if (q.mode==="catalog") return (await import("./player_analysis_catalog.ts")).getPlayerCatalog(signal);
    return readPlayerAnalysis(ctx,q);
  },
  act:async(ctx,body,signal)=>{
    if(body.action==="recognizeScreenshot"){
      const generation=withStore(ctx,false,db=>authorize(membershipOf(db),body.matchId,body.expectedUserId).generation);
      const result=await recognizeScreenshot(body.image,signal);
      withStore(ctx,false,db=>{if(authorize(membershipOf(db),body.matchId,body.expectedUserId).generation!==generation) invalid("参赛记录已更新，请重新选择截图");});
      return result;
    }
    if (body.action==="bindProfile") return bindPlayerProfile(ctx,body.userId,signal,(await import("./player_membership.ts")).getPlayerMembership);
    return writePlayerAnalysis(ctx,body);
  }});

registerView({id:"player_sync",label:"选手比赛同步",
  run:async(ctx,q)=>(await import("./player_sync.ts")).syncStatus(ctx,q.attempt),
  act:async(ctx,body)=>(await import("./player_sync.ts")).syncAction(ctx,body)});
