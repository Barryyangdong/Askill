import { useEffect, useState } from "react";
import { backend, type MonitorStatus as Status } from "../lib/backend";
export function MonitorStatus() {
  const [state,setState]=useState<Status|null>(null); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  useEffect(()=>{
    let gone=false; let timer:ReturnType<typeof setTimeout>;
    const load=async()=>{try {const data=await backend.monitor();if(!gone){setState(data);setError("");}}catch{if(!gone)setError("监测服务暂不可用");}if(!gone)timer=setTimeout(load,5000);};
    void load(); return ()=>{gone=true;clearTimeout(timer);};
  },[]);
  return <section aria-label="持续监测" className="mb-3 flex flex-wrap items-center gap-3 rounded border border-border bg-card px-3 py-2 text-xs">
    <strong>后台监测</strong><span>{!state?'正在读取状态':state.enabled?"已开启 · 切页继续":"已暂停"}</span>
    <button disabled={!state||busy} className="text-primary disabled:opacity-40" onClick={async()=>{setBusy(true);try{setState(await backend.setMonitor(!state?.enabled));setError("");}catch{setError("设置未保存，请重试。");}finally{setBusy(false);}}}>{state?.enabled?"暂停":"开启"}</button>
    {state?.last_at&&<span className="text-muted-foreground">最近运行 {new Date(state.last_at).toLocaleTimeString("zh-CN")}</span>}
    {!!state?.interruptions&&<span className="text-warning">累计中断 {state.interruptions} 次 · 中断期间未覆盖</span>}
    {!!state?.gaps?.length&&<details className="w-full text-muted-foreground"><summary>最近覆盖缺口</summary><ul className="mt-2 space-y-1">{state.gaps.slice(-5).reverse().map((gap,i)=><li key={i}>{new Date(gap.from).toLocaleString('zh-CN')} — {new Date(gap.to).toLocaleString('zh-CN')} · {gap.reason}</li>)}</ul></details>}
    {(error||state?.error)&&<span role="status" className="text-warning">{error||state?.error}</span>}
  </section>;
}
