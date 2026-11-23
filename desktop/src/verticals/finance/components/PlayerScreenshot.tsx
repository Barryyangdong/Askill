import {useRef,useState} from "react";
import {backend} from "../lib/backend";
import {playerControl,ratio,type Player} from "../lib/playerAnalysis";

export function PlayerScreenshot({player,query,seq,onSaved}:{player:Player;query:string;seq?:string;onSaved:(revision:number)=>void}) {
  const q=new URLSearchParams(query);
  const date=q.get("date")||"";
  const scope={expectedUserId:q.get("expectedUserId"),matchId:q.get("matchId"),divisionId:q.get("divisionId"),date,
    revision:Number(q.get("revision")),playerId:player.id};
  const official=seq && /^\d+$/.test(seq) && /^\d+$/.test(player.id) ? "https://www.tgb.cn/spmatch/gains/readInfo?"+
    new URLSearchParams({spmatchSeq:seq,lookeUserID:player.id,dateNum:date.replaceAll("-","")}).toString():null;
  const [image,setImage]=useState(""),[original,setOriginal]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  const [codes,setCodes]=useState(""),[level,setLevel]=useState(""),[pct,setPct]=useState("");
  const [confirmed,setConfirmed]=useState(false);
  const file=useRef<HTMLInputElement>(null);
  async function act(fn:()=>Promise<void>){
    if(busy)return;setBusy(true);setNotice("");
    try{await fn();}catch(e){setNotice(e instanceof Error?e.message:"操作失败，请重试。");}finally{setBusy(false);}
  }
  async function loadFile(item:File){
    setImage("");setConfirmed(false);setLevel("");setPct("");setCodes("");setOriginal("");
    if(item.size>5*1024*1024 || !["image/png","image/jpeg"].includes(item.type)) throw new Error("请选择 5 MiB 以内的 PNG 或 JPEG 原图。");
    const src=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(new Error("读取图片失败"));r.onload=()=>resolve(String(r.result));r.readAsDataURL(item);});
    const img=new Image();img.src=src;await img.decode();setImage(src);
  }
  async function recognize(){
    const r=await backend.playerAnalysisAction<{symbols:string[];exposurePercent:string|null}>({action:"recognizeScreenshot",...scope,image});
    setCodes(r.symbols.join(" "));setPct(r.exposurePercent??"");setLevel("");setConfirmed(false);
    setNotice(r.symbols.length||r.exposurePercent!==null?"已填入识别候选，请逐项与原图核对。":"没有识别到明确的代码或仓位，可对照原图填写。");
  }
  async function save(){
    const exposure=pct.trim()?Number(pct):undefined;
    if(exposure!==undefined&&(!Number.isFinite(exposure)||exposure<0))throw new Error("请填写有效仓位百分数。");
    const result=await backend.playerAnalysisAction<{revision:number}>({action:"reviewScreenshot",...scope,image,confirmed,
      ...(exposure!==undefined?{exposure:exposure/100}:{}),...(level?{holdingsState:level,symbols:codes.trim().split(/[\s,，、;；]+/).filter(Boolean)}:{})});
    onSaved(result.revision);
  }
  return <section className="mt-3 space-y-2 border-t border-border pt-3"><h3 className="text-sm font-semibold">报单原图</h3>
    <div className="flex flex-wrap gap-3 text-xs">{official?<a className="text-primary" href={official} target="_blank" rel="noreferrer">到选手战绩页查看 {date} 原图 ↗</a>:<span className="text-muted-foreground">这条记录缺少可定位的官网战绩链接。</span>}
    {official&&<button className="text-primary" disabled={busy} onClick={()=>void act(async()=>{
      await backend.playerSync({action:"report",url:"https://www.tgb.cn/spmatch/matchAll?tid="+encodeURIComponent(scope.matchId??""),...scope});
      setNotice("正在比赛专用窗口打开该选手的官网战绩页。查看当日报单原图后，可关闭窗口。");
    })}>使用已连接的比赛账号查看</button>}
    {player.screenshot&&(["exposure","holdings"] as const).filter(field=>player.screenshot?.[field]).map(field=><button key={field} className="text-primary" disabled={busy} onClick={()=>void act(async()=>{
      q.set("mode","screenshot");q.set("field",field);q.set("playerId",player.id);
      setOriginal((await backend.playerAnalysis<{image:string}>(q)).image);})}>查看{field==="exposure"?"仓位":"持仓"}核对图</button>)}
    {original&&<button onClick={()=>setOriginal("")}>收起原图</button>}</div>
    {player.screenshot&&<p className="mt-2 text-xs">本版本已按图核对{[player.screenshot.exposure?"仓位":"",player.screenshot.holdings?"持仓":""].filter(Boolean).join("、")}。</p>}
    {original&&<img src={original} alt="此版本核对时保存的持仓截图" className="mt-2 max-w-full"/>}
    <details><summary className="cursor-pointer text-xs text-muted-foreground">报单与原图不一致？核对并记录更正</summary>
    <p className="my-2 text-xs text-muted-foreground">{player.name} · {date} · 当前仓位 {ratio(player.exposure)}</p>
    <input ref={file} type="file" accept="image/png,image/jpeg" className="hidden" onChange={e=>{const item=e.target.files?.[0];e.target.value="";if(item)void act(()=>loadFile(item));}}/>
    <button className={playerControl+" mt-3"} disabled={busy} onClick={()=>file.current?.click()}>选择当日持仓截图</button>
    {image&&<fieldset disabled={busy} className="mt-3 space-y-2 text-xs"><img alt="待核对的当日持仓截图" src={image} className="max-w-full"/>
      <button className={playerControl} onClick={()=>void act(recognize)}>本机识别代码和仓位</button>
      <label className="block">收盘仓位（%，留空沿用原值） <input className={playerControl} value={pct} onChange={e=>{setPct(e.target.value);setConfirmed(false);}}/></label>
      <label className="block">图中持仓 <select className={playerControl} value={level} onChange={e=>{setLevel(e.target.value);setConfirmed(false);if(e.target.value==="empty")setCodes("");}}>
        <option value="">沿用原持仓</option><option value="partial">仅能核对部分持仓</option><option value="complete">已核对全部持仓</option><option value="empty">原图明确空仓</option></select></label>
      {level!=="empty"&&<label className="block">可见持仓代码 <input className={playerControl} value={codes} onChange={e=>{setCodes(e.target.value);setConfirmed(false);}}/></label>}
      <label className="block"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> 已确认是该选手当日截图，并核对所填字段</label>
      <button className={playerControl} disabled={!confirmed||(!level&&!pct.trim())} onClick={()=>void act(save)}>保存为新版本</button>
    </fieldset>}
    </details>
    {busy&&<p role="status" className="mt-2 text-xs">处理中…</p>}{notice&&<p role="status" className="mt-2 text-xs">{notice}</p>}
  </section>;
}
