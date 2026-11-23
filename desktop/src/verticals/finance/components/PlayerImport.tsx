import { useRef, useState } from "react";
import { ExternalLink, FileUp } from "lucide-react";
import { backend } from "../lib/backend";
import { playerControl } from "../lib/playerAnalysis";
import { GlassCard } from "./ui/GlassCard";
import { type PlayerMembership } from "../lib/playerEnrollment";
import { PlayerTableImport } from "./PlayerTableImport";
import { PlayerContestReader } from "./PlayerContestReader";

interface Preview {previewId:string;matchName:string;divisionName:string;date:string;playerCount:number;warnings:string[]}
export interface Imported {matchId:string;divisionId:string;date:string;revision:number}
const template = {
  schemaVersion:1,matchId:"example-competition",matchName:"示例比赛（请替换）",divisionId:"all",divisionName:"总榜",
  date:"2026-11-20",previousTradeDate:"2026-11-19",rankComplete:false,expected:2,
  players:[{id:"example-player",name:"示例选手",rank:1,state:"reported",dayReturn:0.01,totalReturn:0.08,exposure:0.5,
    holdingsState:"complete",symbols:["600000"]}],
};
export function PlayerImport({onImported,membership,initialMatch}:{onImported:(saved:Imported)=>void;membership:PlayerMembership;initialMatch?:string}) {
  const [matchId,setMatchId]=useState(membership.matches.find(m=>m.matchId===initialMatch)?.matchId??membership.matches[0]?.matchId??"");
  const match=membership.matches.find(m=>m.matchId===matchId);
  const expectedUserId=membership.userId;
  const [preview,setPreview]=useState<Preview|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [fileName,setFileName]=useState("");
  const file=useRef<HTMLInputElement>(null);
  async function previewData(data:Record<string,unknown>) {
    setBusy(true);setError("");setPreview(null);
    try {
      if(!match || String(data.matchId)!==match.matchId)throw new Error("文件赛事标识与所选参赛赛事不符，请核对。");
      setPreview(await backend.playerAnalysisAction<Preview>({action:"previewImport",expectedUserId,data}));
    }
    catch(e){setError(e instanceof Error?e.message:"预览失败，请检查文件格式。");}
    finally{setBusy(false);}
  }
  async function readFile(input: File) {
    setBusy(true);setError("");setFileName(input.name);
    try {
      if(input.size>8*1024*1024)throw new Error("文件超过 8 MiB，请按赛组和交易日拆分。");
      const data=JSON.parse((await input.text()).replace(/^\uFEFF/,""));
      await previewData(data);
    }catch(e){setError(e instanceof SyntaxError?"文件不是有效 JSON，请使用 UTF-8 格式。":String(e));}
    finally{setBusy(false);if(file.current)file.current.value="";}
  }
  async function commit(){
    if(!preview||busy)return;
    setBusy(true);setError("");
    try{const saved=await backend.playerAnalysisAction<Imported>({action:"commitImport",expectedUserId,previewId:preview.previewId});setPreview(null);onImported(saved);}
    catch(e){setError(e instanceof Error?e.message:"保存失败，请重试。");}
    finally{setBusy(false);}
  }
  return <GlassCard className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">导入比赛数据</h2>
      {match&&<a href={`https://www.tgb.cn/spmatch/matchAll?tid=${encodeURIComponent(match.matchId)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary">打开本场官网榜单 <ExternalLink size={13}/></a>}</div>
    <p className="text-xs leading-5 text-muted-foreground">用本人已报名的账号在官网读取可见数据，再按比赛和交易日预览导入。</p>
    <div hidden={Boolean(preview)}><label className="flex items-center gap-2 text-xs">我参加的比赛<select className={playerControl} disabled={busy} value={matchId} onChange={e=>{setMatchId(e.target.value);setError("");setFileName("");}}>{membership.matches.map(m=><option key={m.matchId} value={m.matchId}>{m.name} · {m.matchId}</option>)}</select></label>
      {match&&<><PlayerContestReader match={match} userId={membership.userId}/><PlayerTableImport key={matchId} match={match} busy={busy} onPreview={data=>{setFileName("");return previewData(data);}}/></>}
      <details className="border-t border-border pt-3"><summary className="cursor-pointer text-sm">使用 JSON 文件</summary>
        <div className="mt-3 flex flex-wrap items-center gap-3"><input className="hidden" ref={file} type="file" accept=".json,application/json" onChange={e=>{const item=e.target.files?.[0];if(item)void readFile(item);}}/>
        <button className={playerControl+" inline-flex items-center gap-2"} disabled={busy} onClick={()=>file.current?.click()}><FileUp size={14}/>选择 JSON 文件</button>
        <a className="text-xs text-primary" href={"data:application/json;charset=utf-8,"+encodeURIComponent(JSON.stringify({...template,matchId,matchName:match?.name},null,2))} download="选手分析-格式示例.json">下载格式示例</a></div>
        <p className="mt-2 text-xs text-muted-foreground">收益和仓位按小数填写，例如 0.5 表示 50%。未取得的字段留空，选手 ID 跨日保持一致。</p></details></div>
    {busy&&<p role="status" className="text-xs">正在处理数据…</p>}
    {preview&&<div className="space-y-2 rounded border border-border p-3 text-sm"><strong>核对导入预览</strong>
      <p>{preview.matchName} · {preview.divisionName} · {preview.date} · {preview.playerCount} 名选手</p>
      {fileName&&<p className="text-xs text-muted-foreground">{fileName}</p>}
      {preview.warnings?.map(w=><p key={w} className="text-xs text-warning">{w}</p>)}
      <div className="flex gap-2"><button className={playerControl} disabled={busy} onClick={()=>void commit()}>确认导入</button>
      <button className={playerControl} disabled={busy} onClick={()=>{setPreview(null);setFileName("");setError("");}}>重新选择</button></div></div>}
    {error&&<p role="alert" className="text-sm text-warning">{error}</p>}
  </GlassCard>;
}

