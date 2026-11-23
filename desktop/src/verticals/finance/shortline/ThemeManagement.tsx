import { useEffect, useRef, useState } from "react";
import { ChevronRight, FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { SymbolSearch } from "@/components/SymbolSearch";
import { ThemePriceChart, useThemePrices } from "./ThemePriceChart";
import { parseThemeStocks, useThemeCatalog, type ManagedTheme, type ThemeCommand, type ThemeSource, type ThemeStock } from "./themeCatalog";

export { useThemeCatalog };
export type { ManagedTheme, ThemeSource, ThemeStock };
type Catalog = ReturnType<typeof useThemeCatalog>;
const input = "rounded-md border border-border bg-background px-3 py-2 text-sm";
const button = "inline-flex items-center justify-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50";
const primary = button + " bg-primary text-primary-foreground hover:bg-primary/90";
const pageSize = 30;
const sourceId = (theme: ThemeSource) => "source:" + (theme.parent ?? "") + "|" + theme.name;

type Props = { day: string; catalog: Catalog; sources: ThemeSource[]; onReview: (theme: ManagedTheme | ThemeSource) => void;
  onStock?: (stock: ThemeStock) => void; onSelect?: (theme: ManagedTheme | ThemeSource) => void; onEmpty?: () => void; initialId?: string | null };

export function ThemeManagement({ day, catalog, sources, onReview, onSelect, onStock, onEmpty, initialId }: Props) {
  const [library, setLibrary] = useState<"mine" | "source">(initialId?.startsWith("source:") ? "source" : "mine");
  const [selectedId, setSelectedId] = useState(initialId ?? "");
  const [sourceName, setSourceName] = useState(initialId?.startsWith("source:") ? initialId : "");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fault, setFault] = useState("");
  const [symbol, setSymbol] = useState("");
  const [batch, setBatch] = useState<string | null>(null);
  const [chartCode, setChartCode] = useState("");
  const chartRef = useRef<HTMLDivElement>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [page, setPage] = useState(0);
  const mine = library === "mine";
  const roots = catalog.themes.filter(t => !t.parentId);
  const selected = catalog.themes.find(t => t.id === selectedId) ?? catalog.themes[0];
  const source = sourceName ? sources.find(t => sourceId(t) === sourceName) : sources[0];
  const current = mine ? selected : source;
  const chartStock = current?.stocks.find(stock => stock.code === chartCode);
  const memberNeedle = memberSearch.trim().toLowerCase();
  const foundStocks = current?.stocks.filter(stock => !memberNeedle || stock.code.includes(memberNeedle) || stock.name.toLowerCase().includes(memberNeedle)) ?? [];
  const pages = Math.max(1, Math.ceil(foundStocks.length/pageSize));
  const currentPage = Math.min(page, pages - 1);
  const shownStocks = foundStocks.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const {byCode: prices, loading: pricesLoading} = useThemePrices(day, form ? [] : shownStocks);
  const needle = search.trim().toLowerCase();
  const matches = (theme: ThemeSource | ManagedTheme) => !needle || theme.name.toLowerCase().includes(needle)
    || theme.stocks.some(s => s.code.includes(needle) || s.name.toLowerCase().includes(needle));
  const parentOptions = roots.filter(t => form !== "edit" || t.id !== editingId);
  const sourceGroups = new Map<string, ThemeSource[]>();
  if (!mine) for (const item of sources.filter(matches)) {
    const group = item.parent ?? "";
    if (!sourceGroups.has(group)) sourceGroups.set(group, []);
    sourceGroups.get(group)!.push(item);
  }
  useEffect(() => {
    if (!initialId) return;
    if (initialId.startsWith("source:")) { setLibrary("source"); setSourceName(initialId); }
    else { setLibrary("mine"); setSelectedId(initialId); }
  }, [initialId]);
  useEffect(() => { setSymbol(""); setChartCode(""); setMemberSearch(""); setPage(0); setBatch(null); setConfirmDelete(false); setFault(""); },
    [library, sourceName, selected?.id, day]);
  function clearForm() { setForm(null); setConfirmDelete(false); setFault(""); setMessage(""); }
  function begin(create: boolean) {
    clearForm(); setName(create ? "" : selected?.name ?? ""); setParentId(create ? "" : selected?.parentId ?? "");
    setEditingId(selected?.id ?? ""); setForm(create ? "create" : "edit");
  }
  async function save(cmd: ThemeCommand, success: string, after?: (themes: ManagedTheme[]) => void) {
    if (busy) return;
    setBusy(true); setFault(""); setMessage("");
    try { const next = await catalog.mutate(cmd); setMessage(success); after?.(next); }
    catch (e) { setFault(e instanceof Error ? e.message : "保存失败，请重试。"); }
    finally { setBusy(false); }
  }
  function add(stocks: ThemeStock[]) {
    if (!selected || !stocks.length) return;
    void save({type:"add",id:selected.id,stocks}, "已更新成分股。", () => { setSymbol(""); setBatch(null); });
  }
  function addText(value: string) {
    try { add(parseThemeStocks(value)); } catch(e) { setFault(e instanceof Error ? e.message : "请核对股票代码。"); }
  }
  function viewStock(code: string) {
    setChartCode(code);
    const el = chartRef.current;
    if (el && el.getBoundingClientRect().bottom < (el.closest("main")?.getBoundingClientRect().top ?? 0) + 80)
      el.scrollIntoView({ block: "start" });
  }
  function row(theme: ManagedTheme | ThemeSource, child = false) {
    const id = "id" in theme ? theme.id : sourceId(theme);
    const active = mine ? id === selected?.id : !!source && id === sourceId(source);
    return <button type="button" key={id} aria-pressed={active} aria-label={"parent" in theme && theme.parent ? `${theme.parent} · ${theme.name}` : theme.name}
      className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm ${active ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted"}`}
      onClick={() => { clearForm(); if (mine) setSelectedId(id); else setSourceName(id); onSelect?.(theme); }}>
      {child && <ChevronRight aria-hidden="true" size={13} className="ml-3 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1 break-words">{theme.name}</span><small className="text-muted-foreground">{theme.stocks.length}</small>
    </button>;
  }
  return <div className="grid min-w-0 items-start gap-4 md:grid-cols-[minmax(13rem,1fr)_minmax(0,3fr)]">
    <aside className="glass min-w-0 space-y-3 p-4" aria-label="题材目录">
      <div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2"><FolderTree size={17}/>题材目录</h2>
        <button type="button" className={button} disabled={busy || !catalog.ready} onClick={() => {setLibrary("mine");begin(true);}}><Plus size={14}/>新建</button></div>
      <div className="flex gap-1" role="group" aria-label="题材来源">
        {(["mine","source"] as const).map(key => <button type="button" key={key} aria-pressed={library===key} className={library===key?primary:button}
          onClick={() => {clearForm();setLibrary(key);setSearch("");}}>{key==="mine"?"我的题材":"来源题材"}</button>)}
      </div>
      <input className={input+" w-full"} aria-label="搜索题材或股票" placeholder="题材、股票名称或代码" value={search} onChange={e=>setSearch(e.target.value)} />
      <div className="max-h-80 overflow-y-auto md:max-h-[60vh]">
        {mine ? roots.map(root => {const children=catalog.themes.filter(t=>t.parentId===root.id);
          const visible=matches(root)?children:children.filter(matches);
          return matches(root)||visible.length?<div key={root.id}>{row(root)}{visible.map(t=>row(t,true))}</div>:null;})
          : [...sourceGroups].map(([group, items])=><div key={group}>{group && <h3 className="mt-2 px-2 text-xs text-muted-foreground">{group}</h3>}{items.map(t=>row(t))}</div>)}
        {!(mine?catalog.themes:sources).some(matches) && <p className="py-3 text-sm text-muted-foreground">{search?"没有匹配的题材。":mine?"还没有自定义题材。":"当前没有可用来源题材。"}</p>}
      </div>
    </aside>
    <section className="glass min-w-0 space-y-4 p-4" aria-label="题材管理详情">
      {catalog.error && <p role="alert">{catalog.error} <button type="button" className={button} onClick={()=>void catalog.reload()}>重新读取</button></p>}
      {fault && <p role="alert" className="text-sm text-destructive">{fault}</p>}
      {message && <p role="status" className="text-sm text-primary">{message}</p>}
      {form ? <form className="space-y-3" onSubmit={ev=>{ev.preventDefault();
        if (form==="create") {
          const names=name.split(/[\r\n]+/).map(s=>s.trim()).filter(Boolean);
          void save({type:"create", names, parentId:parentId||null}, "已创建题材。", next=>{
            const created = next.find(t=>t.name===names[0] && t.parentId===(parentId||null));
            setSelectedId(created?.id ?? ""); if (created) onSelect?.(created); setForm(null);setSearch("");
          });
        } else void save({type:"rename",id:editingId,name,parentId:parentId||null},"已更新题材。",next=>{
          const updated=next.find(t=>t.id===editingId);
          if(updated) onSelect?.(updated);
          setForm(null);
        });
      }}>
        <h2>{form==="create"?"新建题材":"编辑题材"}</h2>
        <label className="grid gap-1.5 text-sm">上级题材
          <select className={input} value={parentId} onChange={e=>setParentId(e.target.value)}><option value="">无（一级题材）</option>
            {parentOptions.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="grid gap-1.5 text-sm">题材名称
          {form==="create"?<textarea required autoFocus className={input} rows={4} placeholder="可批量创建，每行一个名称" value={name} onChange={e=>setName(e.target.value)}/>
            :<input required autoFocus maxLength={80} className={input} value={name} onChange={e=>setName(e.target.value)}/>}</label>
        <div className="flex gap-2"><button disabled={busy} className={primary}>保存</button><button type="button" disabled={busy} className={button} onClick={clearForm}>取消</button></div>
      </form> : !current ? <div className="space-y-3 py-3"><h2>{mine?"我的题材":"来源题材"}</h2>
        <p className="text-sm text-muted-foreground">{mine?"新建题材，或在来源题材中选择一项加入我的题材。"
          : sourceName && sources.length ? "当日来源目录未收录所选题材，可从左侧选择其他题材。" : "当日数据加载后可查看来源题材及已披露成员。"}</p></div> : <>
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div><h2>{current.name}</h2><p className="mt-1 text-xs text-muted-foreground">{mine?(selected?.parentId?`二级题材 · ${roots.find(t=>t.id===selected.parentId)?.name ?? ""}`:"一级题材")
            : source?.parent === "标准行业分类" ? "标准行业分类 · 沪深 A 股" : `${source?.parent || "来源题材"} · 当日已披露样本`} · {current.stocks.length} 只</p></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} onClick={()=>onReview(current)}>查看题材复盘</button>
            {mine?<><button type="button" className={button} disabled={busy} onClick={()=>begin(false)}><Pencil size={13}/>编辑</button>
              <button type="button" className={button} disabled={busy} onClick={()=>setConfirmDelete(true)}><Trash2 size={13}/>删除</button></>
              :<button type="button" className={button} disabled={busy || !catalog.ready} onClick={()=>void save({type:"create",names:[current.name],parentId:null,stocks:current.stocks},"已加入我的题材。",next=>{
                const imported = next.find(t=>t.name===current.name && !t.parentId)!;
                setSelectedId(imported.id); onSelect?.(imported); setLibrary("mine");setSearch("");
              })}>加入我的题材</button>}
          </div>
        </header>
        {mine && selected?.updatedAt && <p className="text-xs text-muted-foreground">{selected.createdAt && <>创建于 {new Date(selected.createdAt).toLocaleDateString("zh-CN")} · </>}
          更新于 {new Date(selected.updatedAt).toLocaleString("zh-CN")}</p>}
        {mine && confirmDelete && selected && <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-sm">
          删除「{selected.name}」及其 {selected.stocks.length} 条成员关系？
          <button type="button" disabled={busy} className={button} onClick={()=>void save({type:"delete",id:selected.id},"已删除题材。",next=>{
            setConfirmDelete(false);setSelectedId(next[0]?.id ?? "");
            if(next[0]) onSelect?.(next[0]); else onEmpty?.();
          })}>确认删除</button>
          <button type="button" className={button} onClick={()=>setConfirmDelete(false)}>取消</button></div>}
        {mine && selected && <div className="space-y-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-2"><div className="min-w-[12rem] flex-1">
            <SymbolSearch ariaLabel="搜索要添加的股票" value={symbol} onChange={setSymbol} markets={["CN"]} disabled={busy}
              onPick={s=>add([{code:s.symbol,name:s.name}])} onEnter={()=>addText(symbol)} placeholder="搜索股票名称、代码或拼音"/></div>
            <button type="button" className={button} disabled={busy || !symbol.trim()} onClick={()=>addText(symbol)}>添加</button>
            <button type="button" className={button} onClick={()=>setBatch(batch===null?"":null)}>批量添加</button></div>
          {batch!==null && <div className="space-y-2"><textarea className={input+" w-full"} rows={3} aria-label="批量股票代码" placeholder="每行一个六位代码，可在代码后加空格和股票名" value={batch} onChange={e=>setBatch(e.target.value)}/>
            <button type="button" className={primary} disabled={busy || !batch.trim()} onClick={()=>addText(batch)}>确认添加</button></div>}
        </div>}
        <div className="min-w-0 scroll-mt-4" ref={chartRef}>
          {chartStock && <button type="button" className={button+" mb-2"} onClick={()=>setChartCode("")}>返回题材走势</button>}
          <ThemePriceChart day={day} name={chartStock?.name || current.name} members={current.stocks} symbol={chartStock?.code} />
        </div>
        <div><header className="flex flex-wrap items-center justify-between gap-2"><h3>成分股</h3>
          {current.stocks.length > 10 && <input className={input} value={memberSearch} aria-label="搜索成分股" placeholder="搜索成分股" onChange={e=>{setMemberSearch(e.target.value);setPage(0);}}/>}</header>
          {current.stocks.length?<><p className="my-2 text-xs text-muted-foreground">{day} 收盘 · 沪深 A 股不复权行情 · {pricesLoading?"正在读取本页行情…":"缺少同日或对比日行情时显示 —"}</p>
          <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm" aria-label="成分股行情"><thead><tr className="border-b border-border text-xs text-muted-foreground">
            {["股票","收盘价","涨跌幅","近10日","近20日",...(mine||onStock?["操作"]:[])].map(label=><th key={label} scope="col" className="px-2 py-2 font-medium">{label}</th>)}</tr></thead>
            <tbody>{shownStocks.map(s=><tr className={`theme-member-row cursor-pointer border-b border-border/60 ${chartCode===s.code ? "theme-member-current" : ""}`} key={s.code}
              onClick={e => {
                if (e.target instanceof Element && !e.target.closest("button, select, a, input, label")) viewStock(s.code);
              }}><td className="px-2 py-2">
            <button type="button" aria-pressed={chartCode===s.code} className="text-left font-medium text-primary hover:underline" onClick={()=>viewStock(s.code)}>{s.name||s.code}</button>
            {s.name&&<small className="ml-1 font-mono text-muted-foreground">{s.code}</small>}</td>
            <td className="px-2 py-2 tabular-nums">{prices[s.code]?.close?.toFixed(2) ?? "—"}</td>
            {(["change","return10","return20"] as const).map(field=>{
              const value=prices[s.code]?.[field];
              return <td key={field} className={`px-2 py-2 tabular-nums ${value==null?"text-muted-foreground":value>0?"text-danger":value<0?"text-success":""}`}>{value==null?"—":`${value>0?"+":""}${value.toFixed(2)}%`}</td>;
            })}
            {(mine||onStock)&&<td className="space-x-2 px-2 py-2">
            {onStock && <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={()=>onStock(s)}>个股资料</button>}
            {mine && selected && <select aria-label={`设置 ${s.name||s.code} 地位`} className={input} disabled={busy} value={s.role ?? ""} onChange={e=>void save({type:"role",id:selected.id,code:s.code,role:(e.target.value || undefined) as ThemeStock["role"]}, "已更新股票地位。")}><option value="">清除地位</option><option value="龙头">龙头</option><option value="领涨">领涨</option></select>}
            {mine && selected && <button type="button" className="ml-auto text-xs text-muted-foreground hover:text-destructive" disabled={busy}
              aria-label={`移除 ${s.name||s.code}`} onClick={()=>void save({type:"remove",id:selected.id,code:s.code},"已移出该题材。")}>移出</button>}
            </td>}</tr>)}</tbody></table></div>
          {!foundStocks.length && <p className="py-3 text-sm text-muted-foreground">没有匹配的成分股。</p>}
          {pages>1 && <div className="mt-3 flex items-center gap-2 text-xs"><button type="button" className={button} disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>上一页</button>
            <span>{currentPage+1} / {pages} 页 · {foundStocks.length} 只</span><button type="button" className={button} disabled={currentPage+1>=pages} onClick={()=>setPage(currentPage+1)}>下一页</button></div>}
          </>:<p className="py-3 text-sm text-muted-foreground">{mine?"尚未添加成分股。":"当日暂无成员明细。"}</p>}
        </div>
      </>}
    </section>
  </div>;
}
