import { useState, type ReactNode } from "react";
import { playerControl, type Player } from "../lib/playerAnalysis";
import { watchNameOf } from "../lib/watchlist";
export const tableClass="w-full whitespace-nowrap text-left text-xs [&_td]:border-t [&_td]:border-border/60 [&_td]:px-2 [&_td]:py-2 [&_th]:px-2 [&_th]:py-2 [&_th]:font-medium [&_th]:text-muted-foreground";
export function DataTable({labels,children}:{labels:string[];children:ReactNode}){
  return <div className="overflow-x-auto"><table className={tableClass}><thead><tr>{labels.map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
export function stockTitle(symbol:string){return [watchNameOf(symbol),symbol].filter(Boolean).join(" ");}
export function MemberDialog({label,ids,names,close,select}:{label:string;ids:string[];names:Map<string,Player>;close:()=>void;select:(id:string)=>void}){
  const [limit,setLimit]=useState(60);
  return <dialog ref={el=>{if(el&&!el.open)el.showModal();}} onCancel={close} aria-label={label} className="m-auto max-h-[75vh] w-[min(32rem,92vw)] overflow-auto rounded border border-border bg-background p-4 text-foreground backdrop:bg-black/60">
    <div className="mb-3 flex items-center justify-between"><h3>{label} · {ids.length} 人</h3><button className={playerControl} onClick={close}>关闭</button></div>
    <div className="flex flex-wrap gap-2">{ids.slice(0,limit).map(id=><button key={id} className={playerControl} disabled={!names.has(id)} onClick={()=>select(id)}>{names.get(id)?.name??id}</button>)}</div>
    {limit<ids.length&&<button className="mt-3 text-xs text-primary" onClick={()=>setLimit(n=>n+60)}>显示更多</button>}</dialog>;
}

