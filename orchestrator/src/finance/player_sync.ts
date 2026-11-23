import { spawn, execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { safePath, ServiceError, type ServiceContext } from "../service.ts";

const worker = fileURLToPath(new URL("./player_sync_worker.ts", import.meta.url));
const staleMs = 120_000;
const attemptId=(token:string)=>createHash("sha256").update(token).digest("hex");
export const syncKey = (ctx:ServiceContext) => createHash("sha256").update(path.resolve(ctx.dataRoot)).digest("hex").slice(0,24);
export function contestLink(value:unknown) {
  try {
    const u=new URL(String(value));
    const ids=u.searchParams.getAll("tid");
    if (["https://tgb.cn","https://www.tgb.cn"].includes(u.origin) && !u.username && !u.password &&
        u.pathname==="/spmatch/matchAll" && ids.length===1 && /^[a-zA-Z0-9]{1,64}$/.test(ids[0])) return ids[0];
  } catch { /* invalid link */ }
  throw new ServiceError("bad_request","请粘贴淘股吧比赛详情链接，链接中应包含 tid。");
}
function store<T>(ctx:ServiceContext,write:boolean,fn:(db:DatabaseSync)=>T) {
  const file=safePath(ctx,"player-analysis","sync.sqlite");
  if(!write && !fs.existsSync(file)) return null;
  if(write) fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const db=new DatabaseSync(file,{readOnly:!write});
  try {
    db.exec("PRAGMA busy_timeout=5000");
    if(write) db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS contests(id TEXT PRIMARY KEY,userId TEXT,name TEXT,lastDate TEXT,lastRun TEXT,message TEXT,paused INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY,time TEXT);
      CREATE TABLE IF NOT EXISTS visible_days(matchId TEXT,day TEXT,payload TEXT NOT NULL,PRIMARY KEY(matchId,day));
      CREATE TABLE IF NOT EXISTS connect_feedback(id INTEGER PRIMARY KEY CHECK(id=1),attempt TEXT,created INTEGER,message TEXT);
      CREATE TABLE IF NOT EXISTS job(id INTEGER PRIMARY KEY,token TEXT,beat INTEGER,message TEXT);`);
    const result=fn(db);
    if(write) db.exec("COMMIT");
    return result;
  } finally { db.close(); }
}
export function syncStatus(ctx:ServiceContext,attempt?:string) {
  return store(ctx,false,db=>{
    const job=db.prepare("SELECT beat,message FROM job WHERE id=1").get();
    const busy=Boolean(job && Date.now()-Number(job.beat)<staleMs);
    const feedback=attempt && /^[a-f0-9]{64}$/.test(attempt) &&
      db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='connect_feedback'").get()
      ? db.prepare("SELECT message FROM connect_feedback WHERE id=1 AND attempt=? AND created>=?").get(attempt,Date.now()-10*60_000) : null;
    const visibleDays=db.prepare("SELECT 1 FROM sqlite_schema WHERE name='visible_days'").get()
      ? db.prepare("SELECT matchId,day,json_array_length(payload,'$.players') AS players FROM visible_days ORDER BY day DESC,matchId").all():[];
    return {visibleDays,busy,message:job?(busy?String(job.message):"上次任务中断，可重新同步。"):"",
      connectionError:feedback?String(feedback.message):null,
      contests:db.prepare("SELECT * FROM contests WHERE userId IS NOT NULL ORDER BY id").all(),
      time:db.prepare("SELECT time FROM settings WHERE id=1").get()?.time??"",windows:process.platform==="win32"};
  })??{busy:false,message:"",connectionError:null,contests:[],time:"",windows:process.platform==="win32"};
}
export function saveVisibleDay(ctx:ServiceContext,id:string,day:string,data:Record<string,unknown>) {
  if(data.matchId!==id || data.date!==day || data.access!=="visible" || !Array.isArray(data.players) || !data.players.length)
    throw new Error("官网可见榜单缺少比赛、日期或选手数据。");
  store(ctx,true,db=>db.prepare("INSERT OR REPLACE INTO visible_days VALUES(?,?,?)").run(id,day,JSON.stringify(data)));
}
export function reserveJob(ctx:ServiceContext,message:string) {
  const token=randomUUID();
  store(ctx,true,db=>{
    const job=db.prepare("SELECT beat FROM job WHERE id=1").get();
    if(job && Date.now()-Number(job.beat)<staleMs) throw new ServiceError("bad_request","已有任务正在使用比赛连接，请稍后重试。");
    db.prepare("INSERT OR REPLACE INTO job VALUES(1,?,?,?)").run(token,Date.now(),message);
  });
  return token;
}
export function heartbeat(ctx:ServiceContext,token:string,message:string) {
  const count=store(ctx,true,db=>db.prepare("UPDATE job SET beat=?,message=? WHERE id=1 AND token=?").run(Date.now(),message,token).changes);
  if(!count) throw new Error("任务已被更新，请重新同步。");
}
export function releaseJob(ctx:ServiceContext,token:string) {
  store(ctx,true,db=>db.prepare("DELETE FROM job WHERE token=?").run(token));
}
export function recordContest(ctx:ServiceContext,id:string,message:string,opts:{userId?:string;name?:string;date?:string;paused?:boolean}={}) {
  store(ctx,true,db=>{
    if(opts.userId) db.prepare("INSERT OR IGNORE INTO contests(id) VALUES(?)").run(id);
    db.prepare(`UPDATE contests SET message=?,userId=COALESCE(?,userId),name=COALESCE(?,name),
      lastRun=?,lastDate=COALESCE(?,lastDate),paused=COALESCE(?,paused) WHERE id=?`).run(message,opts.userId??null,opts.name??null,
        new Date().toISOString(),opts.date??null,opts.paused===undefined?null:Number(opts.paused),id);
  });
}
export function recordSyncFailure(ctx:ServiceContext,id:string,token:string,message:string,needsLogin:boolean) {
  store(ctx,true,db=>{
    if(!db.prepare("SELECT 1 FROM job WHERE id=1 AND token=?").get(token))return;
    const updated=db.prepare(`UPDATE contests SET message=?,lastRun=?,paused=CASE WHEN ? THEN 1 ELSE paused END
      WHERE id=? AND userId IS NOT NULL`).run(message,new Date().toISOString(),Number(needsLogin),id);
    if(!updated.changes) db.prepare("INSERT OR REPLACE INTO connect_feedback VALUES(1,?,?,?)").run(attemptId(token),Date.now(),message);
  });
}
export async function syncAction(ctx:ServiceContext,body:Record<string,unknown>) {
  const action=body.action;
  if(action==="visibleResult"){
    const id=contestLink(body.url);
    const row=store(ctx,false,db=>db.prepare("SELECT payload FROM visible_days WHERE matchId=? AND day=?").get(id,String(body.day)));
    if(!row)throw new ServiceError("bad_request","未找到该日可见榜单。");
    return JSON.parse(String(row.payload));
  }
  if(action==="openInBrowser"){
    const url="https://www.tgb.cn/spmatch/matchAll?tid="+encodeURIComponent(contestLink(body.url));
    // Dispatch HTTPS through the signed-in desktop user's URL handler.
    try {
      if(process.platform==="win32"){
        await promisify(execFile)("powershell.exe",["-NoProfile","-NonInteractive","-Command","Start-Process -FilePath $env:ASKILL_CONTEST_URL -ErrorAction Stop"],
          {windowsHide:true,timeout:10000,env:{...process.env,ASKILL_CONTEST_URL:url}});
      } else if(process.platform==="darwin" || process.platform==="linux") {
        const child=spawn(process.platform==="darwin"?"open":"xdg-open",[url],{detached:true,stdio:"ignore"});
        await new Promise<void>((resolve,reject)=>{
          const timer=setTimeout(resolve,1000);
          child.once("error",e=>{clearTimeout(timer);reject(e);});
          child.once("exit",code=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error("open"));});
        });
        child.unref();
      } else throw new Error("unsupported");
    } catch {throw new ServiceError("bad_request","系统未能打开比赛链接，请检查默认浏览器设置。");}
    return {dispatched:true};
  } else if(action==="schedule"){
    const time=body.time;
    if(process.platform!=="win32" || typeof time!=="string" || (time!=="" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))
      throw new ServiceError("bad_request","请选择 Windows 本机的有效定时时间。");
    if(time && !syncStatus(ctx).contests.some(row=>row.userId && !row.paused)) throw new ServiceError("bad_request","请先连接已报名的比赛。");
    const token=reserveJob(ctx,"正在更新系统定时任务");
    try {
      const script=fileURLToPath(new URL("./player_sync_schedule.ps1",import.meta.url));
      await promisify(execFile)("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",script],
        {windowsHide:true,timeout:25000,env:{...process.env,ASKILL_NAME:"Askill-PlayerSync-"+syncKey(ctx),
          ASKILL_NODE:process.execPath,ASKILL_WORKER:worker,ASKILL_DATA:ctx.dataRoot,ASKILL_REPO:ctx.repoRoot,ASKILL_TIME:time}});
      store(ctx,true,db=>db.prepare("INSERT OR REPLACE INTO settings VALUES(1,?)").run(time));
    } catch {throw new ServiceError("bad_request","Windows 任务计划程序设置失败。请检查当前用户使用任务计划程序的权限。");}
    finally {releaseJob(ctx,token);}
  } else {
    if(action!=="connect" && action!=="sync" && action!=="report") throw new ServiceError("bad_request","未知同步操作。");
    const id=contestLink(body.url);
    if(action!=="connect" && !syncStatus(ctx).contests.some(row=>row.id===id && row.userId && !row.paused)) throw new ServiceError("bad_request","请先连接并核验该场比赛。");
    const report=action==="report"?(await import("./player_analysis.ts")).checkContestReport(ctx,id,body):[];
    const token=reserveJob(ctx,action==="connect"?"正在打开淘股吧登录窗口":action==="report"?"正在打开选手报单":"正在启动同步");
    try {
      const child=spawn(process.execPath,[worker,action,ctx.dataRoot,ctx.repoRoot,id,token,...report],{cwd:ctx.repoRoot,detached:true,windowsHide:true,stdio:"ignore"});
      await new Promise<void>((resolve,reject)=>{child.once("spawn",resolve);child.once("error",reject);});
      child.unref();
    } catch { releaseJob(ctx,token);throw new ServiceError("bad_request","无法启动本机同步进程。"); }
    if(action==="connect") return {...syncStatus(ctx,attemptId(token)),attempt:attemptId(token)};
  }
  return syncStatus(ctx);
}
