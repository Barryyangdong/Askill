import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { backend, type LedgerRecord } from '../lib/backend';

export function CalendarTargets({revision}: {revision:string}) {
 const [params]=useSearchParams();
 const messageId=params.get('message');
 const [messageReply,setMessageReply]=useState<{id:string;value:Awaited<ReturnType<typeof backend.calendarReminder>>}|null>(null);
 const [messageError,setMessageError]=useState('');
 const message=messageReply?.id===messageId?messageReply.value:null;
 let targets:{id:string;due?:string}[]=[];
 try {const value=JSON.parse(params.get('criteria')??'[]');if(Array.isArray(value))targets=value.filter(x=>x&&typeof x.id==='string'&&typeof x.due==='string');} catch { /* Invalid links never select another record. */ }
 if(params.get('object'))targets=[{id:params.get('object')!,due:params.get('due')??undefined}];
 if(messageId)targets=message?.status==='ok'?message.targets:[];
 const key=JSON.stringify(targets),kind=messageId?'criterion':params.get('kind')??'criterion';
 const [received,setRecords]=useState<{key:string;kind:string;records:LedgerRecord[]}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let disposed=false;setMessageReply(null);setMessageError('');if(messageId)void backend.calendarReminder(messageId).then(value=>{if(!disposed)setMessageReply({id:messageId,value});}).catch(()=>{if(!disposed)setMessageError('原提醒读取失败，请重试。');});return()=>{disposed=true;};},[messageId,retry]);
 useEffect(()=>{let disposed=false;setRecords(null);setError('');const list=JSON.parse(key) as {id:string}[];if(list.length)void Promise.all(Array.from({length:Math.ceil(list.length/200)},(_,i)=>backend.calendarObjects(kind,list.slice(i*200,(i+1)*200).map(x=>x.id)))).then(results=>{if(!disposed)setRecords({key,kind,records:results.flatMap(r=>r.records)});}).catch(()=>{if(!disposed)setError('原记录读取失败，请重试。');});return()=>{disposed=true;};},[key,kind,revision,retry]);
 const records=received?.key===key&&received.kind===kind?received.records:null;
 if(messageId&&message?.status!=='ok')return <section aria-label="提醒关联对象"><h2>提醒关联对象</h2>{messageError?<p role="alert">{messageError}<button onClick={()=>setRetry(n=>n+1)}>重试原提醒</button></p>:!message?<p role="status">正在读取原提醒…</p>:<><p role="status">{message.status==='missing'?'原提醒已清空、过期移除或不存在，无法恢复原对象集合；未选择其他提醒。':'原提醒没有可校验的对象集合，请阅读原消息；未选择其他记录。'}</p>{message.message&&<div><h3>{message.message.title}</h3>{message.message.lines.map((line,i)=><p key={i}>{line}</p>)}</div>}</>}</section>;
 if(!targets.length)return null;
 return <section aria-label="提醒关联对象" className="mb-4 rounded border border-primary p-3"><h2>提醒关联对象</h2>{message?.message&&<details><summary>{message.message.title} · 原消息</summary>{message.message.lines.map((line,i)=><p key={i}>{line}</p>)}</details>}{error?<p role="alert">{error}<button onClick={()=>setRetry(n=>n+1)}>重试原记录</button></p>:!records?<p role="status">正在核对原记录…</p>:targets.map(t=>{
 const r=records.find(x=>x.id===t.id);const changed=!!(r&&t.due&&String(r.due??r.review_by??'')!==t.due);
 return <article key={t.id} className="my-2"><p>记录 {t.id} · 原日期 {t.due??'未记录'}</p>{!r?<p>原记录已删除或无法定位，未选择其他记录。</p>:<><p>{String(r.statement??r.title??'')} · 当前状态 {({pending:'待复核',met:'已裁决：兑现 / 条件命中',broken:'已裁决：未兑现 / 触发证伪',dropped:'已停止',active:'进行中',closed:'已结束',done:'已完成'} as Record<string,string>)[String(r.status)]??String(r.status??'未记录')} · 当前日期 {String(r.due??r.review_by??'未记录')}</p>{changed&&<p>原记录已改期，请按当前日期复核。</p>}{kind==='criterion'&&r.status==='pending'&&!changed&&<a href={`#criterion-${encodeURIComponent(t.id)}`} onClick={e=>{const node=document.getElementById(`criterion-${t.id}`);if(node){e.preventDefault();node.scrollIntoView({block:'center'});node.focus();}}}>定位这条待判判据</a>}</>}</article>;
 })}</section>;
}
