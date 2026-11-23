import {useEffect,useState} from 'react';
const phases:Record<string,string>={catalog:'读取工具能力',plan:'确认参数与实验规则',execute:'读取历史数据并计算',compose:'整理结果与口径',complete:'计算完成，正在保存报告',needs_input:'等待补充信息',failed:'本轮未完成',cancelled:'本轮已取消'};
export function BacktestProgress({phase,startedAt,onCancel,canCancel=true}:{phase:string;startedAt:number;onCancel:()=>Promise<void>;canCancel?:boolean}){
 const [seconds,setSeconds]=useState(0);const [cancelling,setCancelling]=useState(false);
 useEffect(()=>{const tick=()=>setSeconds(Math.max(0,Math.floor((Date.now()-startedAt)/1000)));tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);},[startedAt]);
 return <div role="status" className="flex flex-wrap items-center gap-3 text-xs"><span>{phases[phase]??'正在提交'}</span><span className="font-mono">已用 {seconds} 秒</span><button type="button" disabled={cancelling||!canCancel} onClick={()=>{setCancelling(true);void onCancel().catch(()=>setCancelling(false));}} className="rounded border border-border px-2 py-1">{cancelling?'正在中止':'中止本轮'}</button></div>;
}
