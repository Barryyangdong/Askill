import {useState} from "react";
import {backend} from "../lib/backend";
export function PreferenceBackup(){
  const [draft,setDraft]=useState<unknown>(null);const [status,setStatus]=useState("");const [busy,setBusy]=useState(false);
  return <section className="mb-4 rounded border border-border bg-card p-4">
    <h3 className="mb-2 font-semibold">工作台设置备份</h3>
    <p className="mb-3 text-xs text-muted-foreground">包含布局、筛选方案与个人图表标注；不包含 AI 登录、密钥、报告和交易台账。</p>
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <button disabled={busy} className="text-primary" onClick={async()=>{setBusy(true);try{const bundle=await backend.preferenceBackup();const url=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="Askill-workspace.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setStatus("备份已下载");}catch{setStatus("备份失败，请检查本机服务。");}finally{setBusy(false);}}}>导出设置</button>
      <label>选择设置备份 <input type="file" accept=".json,application/json" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];setDraft(null);if(!file)return;if(file.size>640000){setStatus("文件过大，不是有效的设置备份。");return;}try{const value=JSON.parse(await file.text());if(value.version!==1||!value.preferences)throw Error();setDraft(value);setStatus(`待恢复：${Object.keys(value.preferences).length} 项设置。确认后覆盖当前布局与方案。`);}catch{setStatus("无法识别该备份。");}}}/></label>
      {draft!==null&&<button disabled={busy} className="rounded border border-border px-3 py-1" onClick={async()=>{setBusy(true);try{const result=await backend.restorePreferences(draft);setDraft(null);setStatus(`已恢复 ${result.restored} 项设置，刷新页面后生效；恢复前设置已在本机留存。`);}catch{setStatus("恢复失败，未完成的写入已回退；请检查备份与磁盘状态。");}finally{setBusy(false);}}}>确认恢复设置</button>}
    </div><p role="status" className="mt-2 text-xs">{status}</p>
  </section>;
}
