import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { invalid, normalizeRow, type PlayerImport } from "./player_analysis_import.ts";

export function screenshotBytes(image:unknown) {
  if (typeof image!=="string" || image.length>7_000_000) invalid("请选择小于 5 MiB 的 PNG 或 JPEG 图片");
  const match=/^data:image\/(png|jpeg);base64,([a-zA-Z0-9+/]+={0,2})$/.exec(image);
  if (!match) invalid("图片格式须为 PNG 或 JPEG");
  const bytes=Buffer.from(match[2],"base64");
  const signature=match[1]==="png"?"89504e470d0a1a0a":"ffd8ff";
  if (bytes.length>5*1024*1024 || !bytes.subarray(0,signature.length/2).equals(Buffer.from(signature,"hex"))) invalid("无法识别该截图");
  return {bytes,mime:"image/"+match[1]};
}

export async function recognizeScreenshot(image:unknown,signal:AbortSignal) {
  const {bytes}=screenshotBytes(image);
  if (process.platform!=="win32") invalid("此系统暂无本机文字识别，请对照原图填写");
  const script=fileURLToPath(new URL("./player_ocr.ps1",import.meta.url));
  const text=await new Promise<string>((resolve,reject)=>{
    const child=execFile("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-ExecutionPolicy","RemoteSigned","-File",script],
      {windowsHide:true,signal,timeout:25000,encoding:"utf8",maxBuffer:256*1024},(err,out)=>err?reject(err):resolve(out));
    child.stdin?.on("error",reject);
    child.stdin?.end(bytes.toString("base64"));
  }).catch(()=>invalid("本机未能识别这张截图，可对照原图手工填写"));
  // Broker screenshots can contain unrelated amounts and account numbers.
  // Candidates require user review and are never committed by this operation.
  const symbols=[...new Set(text.match(/(?<![0-9A-Za-z])(?:[036489]\d{5})(?![0-9A-Za-z])/g)??[])];
  const values=[...text.replace(/[ \t]/g,"").matchAll(/(?:总仓位|股票仓位|仓位)[：:]?(\d+(?:\.\d+)?)[%％]/g)].map(m=>m[1]);
  return {symbols,exposurePercent:new Set(values).size===1?values[0]:null};
}

export function reviewScreenshot(db:DatabaseSync,body:Record<string,unknown>) {
  const {matchId,divisionId,date,playerId,revision}=body;
  if(typeof matchId!=="string"||typeof divisionId!=="string"||typeof date!=="string"||typeof playerId!=="string"||typeof revision!=="number"||!Number.isSafeInteger(revision))
    invalid("缺少需要核对的赛事、日期、版本或选手");
  const keys=[matchId,divisionId,date];
  const base=db.prepare("SELECT payload FROM snapshots WHERE matchId=? AND divisionId=? AND tradeDate=? AND revision=?").get(...keys,revision);
  if (!base) invalid("找不到要核对的快照");
  const data=JSON.parse(String(base.payload)) as PlayerImport;
  const player=data.players.find(p=>p.id===playerId);
  if (!player) invalid("此选手没有该日记录");
  const {bytes,mime}=screenshotBytes(body.image);
  const exposure=body.exposure!==undefined, holdings=body.holdingsState!==undefined;
  if (body.confirmed!==true || (!exposure&&!holdings)) invalid("请对照该选手当日原图，至少确认一项");
  if (exposure && typeof body.exposure!=="number") invalid("核对仓位须填写百分比");
  if (holdings && (!["empty","complete","partial"].includes(String(body.holdingsState)) || !Array.isArray(body.symbols))) invalid("请标注截图显示的持仓范围");
  const checked=normalizeRow({...player,...(exposure?{exposure:body.exposure}:{}),...(holdings?{holdingsState:body.holdingsState,symbols:body.symbols}:{})},0);
  const id=createHash("sha256").update(bytes).digest("hex");
  const prior=player.screenshot;
  const exposureId=exposure?id:(prior?.exposureId??(prior?.exposure?prior.id:undefined));
  const holdingsId=holdings?id:(prior?.holdingsId??(prior?.holdings?prior.id:undefined));
  Object.assign(player,checked,{screenshot:{id,exposure:Boolean(exposureId),holdings:Boolean(holdingsId),
    ...(exposureId && exposureId!==id?{exposureId}:{}),...(holdingsId && holdingsId!==id?{holdingsId}:{})}});
  const payload=JSON.stringify(data), digest=createHash("sha256").update(payload).digest("hex");
  const head=db.prepare("SELECT revision,digest FROM snapshots WHERE matchId=? AND divisionId=? AND tradeDate=? ORDER BY revision DESC LIMIT 1").get(...keys)!;
  if (head.digest===digest) return {revision:Number(head.revision)};
  if (head.revision!==revision) invalid("该日已有新版本，请切换至最新版本核对截图");
  const last=db.prepare("SELECT MAX(importedAt) AS t FROM snapshots").get()?.t;
  const importedAt=new Date(Math.max(Date.now(),last?Date.parse(String(last))+1:0)).toISOString();
  db.prepare("INSERT OR IGNORE INTO screenshot_blobs(id,mime,image) VALUES(?,?,?)").run(id,mime,bytes);
  db.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?,?,?,?,?)").run(matchId,data.matchName,divisionId,data.divisionName,date,revision+1,importedAt,digest,payload);
  return {revision:revision+1};
}
