import { useLocalPreference } from "../hooks/useLocalPreference";
import { useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, GripVertical, Settings2 } from "lucide-react";
import { defaultLayout, LAYOUT_PRESETS, moveWidget, parseLayout, type HomeWidget, type WorkspaceLayout as Layout } from "@/lib/workspaceLayout";

const KEY = "Askill-home-layout-v1";
const labels: Record<HomeWidget, string> = { focus: "工作场景", tasks: "到期待办", market: "市场与我的股票", features: "常用功能", assistant: "研究助手" };
export function WorkspaceLayout({ widgets }: { widgets: Record<HomeWidget, ReactNode> }) {
  const {value:layout,save,ready,error}=useLocalPreference("workspace",()=>{try{return parseLayout(localStorage.getItem(KEY));}catch{return defaultLayout();}},value=>parseLayout(JSON.stringify(value)));
  const [editing, setEditing] = useState(false);
  const dragging = useRef<HomeWidget | null>(null);
  const update = (next: Layout) => { void save(next); };
  return <>
    <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
      {error && <span role="alert" className="text-xs text-warning">{error}</span>}
      <button type="button" disabled={!ready} aria-expanded={editing} onClick={() => setEditing(x => !x)} className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-muted-foreground"><Settings2 className="h-3.5 w-3.5" />{editing ? "完成布局" : "自定义布局"}</button>
    </div>
    {editing && <section aria-label="布局设置" className="mb-4 rounded border border-border bg-card p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs"><span className="text-muted-foreground">预设</span>{Object.entries(LAYOUT_PRESETS).map(([name, value]) => <button key={name} type="button" onClick={() => update(value)} className="rounded border border-border px-2 py-1">{name}</button>)}</div>
      <ul className="space-y-1">{layout.order.map((id, i) => <li key={id} draggable onDragStart={e => { dragging.current = id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); }} onDragEnd={() => { dragging.current = null; }} onDragOver={e => { if (dragging.current) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (dragging.current) update(moveWidget(layout, dragging.current, id)); dragging.current = null; }} className="flex items-center gap-2 rounded border border-border/60 px-2 py-2 text-xs">
        <GripVertical aria-hidden className="h-4 w-4 cursor-grab text-muted-foreground" />
        <label className="flex flex-1 items-center gap-2"><input type="checkbox" checked={!layout.hidden.includes(id)} onChange={e => update({ ...layout, hidden: e.target.checked ? layout.hidden.filter(x => x !== id) : [...layout.hidden, id] })} />{labels[id]}</label>
        <button type="button" aria-label={`上移${labels[id]}`} disabled={i === 0} onClick={() => update(moveWidget(layout, id, layout.order[i - 1]!))} className="rounded p-1 disabled:opacity-25"><ArrowUp className="h-4 w-4" /></button>
        <button type="button" aria-label={`下移${labels[id]}`} disabled={i === layout.order.length - 1} onClick={() => update(moveWidget(layout, id, layout.order[i + 1]!))} className="rounded p-1 disabled:opacity-25"><ArrowDown className="h-4 w-4" /></button>
      </li>)}</ul>
      <p className="mt-2 text-xs text-muted-foreground">拖动或用箭头排序 · 保存在本机 · 浏览器之间共用</p>
    </section>}
    {layout.order.filter(id => !layout.hidden.includes(id)).map(id => <div key={id} data-workspace-widget={id}>{widgets[id]}</div>)}
    {layout.hidden.length === layout.order.length && <p className="rounded border border-dashed border-border p-6 text-center text-sm text-muted-foreground">模块均已隐藏，可在「自定义布局」中恢复。</p>}
  </>;
}
