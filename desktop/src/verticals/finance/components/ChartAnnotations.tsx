import {useState} from 'react';
import type {ChartLine} from '../lib/chartAnnotations';
export function ChartAnnotations({lines,context,ready,hide,error,save}:{lines:ChartLine[];context:string;ready:boolean;hide:boolean;error:string;save:(lines:ChartLine[])=>Promise<boolean>}){
 const [price,setPrice]=useState(''); const [label,setLabel]=useState('');const [busy,setBusy]=useState(false);
 const current=lines.filter(line=>line.context===context);
 return <details className="my-3 text-xs"><summary className="cursor-pointer text-muted-foreground">我的水平线 · {current.length} 条</summary>
 <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={async e=>{e.preventDefault();const n=Number(price);if(!ready||busy||!Number.isFinite(n)||n<=0)return;setBusy(true);try{if(await save([...lines,{id:`line-${Date.now()}-${Math.random().toString(36).slice(2)}`,context,price:n,label:label.trim()||'观察线',createdAt:new Date().toISOString()}].slice(-200))){setPrice('');setLabel('');}}finally{setBusy(false);}}}>
 <label>价位<input aria-label="水平线价位" type={hide?'password':'number'} step="any" required value={price} onChange={e=>setPrice(e.target.value)} className="ml-2 w-24 rounded border border-border bg-background px-2 py-1"/></label>
 <input aria-label="水平线名称" type={hide?'password':'text'} maxLength={40} placeholder="观察线名称" value={label} onChange={e=>setLabel(e.target.value)} className="w-32 rounded border border-border bg-background px-2 py-1"/>
 <button disabled={!ready||busy} className="rounded border border-border px-2 py-1 disabled:opacity-40">保存水平线</button></form>
 <div className="mt-2 flex flex-wrap gap-3">{current.map(line=><span key={line.id}>{hide?'••••':`${line.label} · ${line.price}`} <button disabled={!ready||busy} aria-label={hide?'删除隐藏水平线':`删除水平线 ${line.label}`} className="text-muted-foreground" onClick={async()=>{setBusy(true);try{await save(lines.filter(l=>l.id!==line.id));}finally{setBusy(false);}}}>×</button></span>)}</div>
 {error&&<p role="alert" className="mt-2 text-warning">{error}</p>}<p className="mt-2 text-muted-foreground">按股票、周期和复权分别保存到本机；仅供个人标注，不进入 AI。历史回看不显示当前标注。</p></details>;
}
