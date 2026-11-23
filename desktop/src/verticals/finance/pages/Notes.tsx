import { ReportAnswer } from "../components/ReportAnswer";
import { useEffect, useRef, useState } from "react";
import { Trash2, ChevronDown, ChevronRight, NotebookPen, ScanSearch, Save } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { noRemoteImages } from "../../../core/ai/noRemoteImages";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAiPage } from "../../../core/ai/pageContext";
import { GlassCard } from "@/components/ui/GlassCard";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { hydrateNotes, loadNotes, deleteNote, clearNotes, addNote, type Note } from "@/lib/notes";
import { reflectStream } from "@/lib/agents";
import { ApiError } from "@/lib/api";
import { usePrivacyMode } from "@/hooks/usePrivacyMode";
import { maskPrivateText } from "@/lib/privacy";
import { AuditCard } from "@/components/AuditCard";
import { Link, useSearchParams } from "react-router-dom";
import { workspaceReturn } from "../lib/workspaceJourney";
import { recordSourceHref } from "../lib/recordSource";
import { JourneyLink } from "../components/JourneyLink";

const KIND_COLOR: Record<string, string> = {
  复盘: "bg-primary/15 text-primary",
  今日要点: "bg-warning/15 text-warning",
  问AI: "bg-success/15 text-success",
  "问 Agent": "bg-success/15 text-success",
  多空辩论: "bg-sky-500/15 text-sky-400",
  反思审计: "bg-violet-500/15 text-violet-400",
};

export function Notes() {
  const [params, setParams] = useSearchParams();
  const returnTo = workspaceReturn(params.get("returnTo"));
  const requestedId = params.get("id");
  // 隐私模式：存下来的对话里自己的金额和股数同样显示成 ••••（记录本身不改）
  const { on: hide } = usePrivacyMode();
  const shown = (text: string) => (hide ? maskPrivateText(text) : text);
  const [notes, setNotes] = useState<Note[]>(loadNotes);
  const [query,setQuery]=useState('');
  const [kind,setKind]=useState('all');
  const [listError,setListError]=useState('');
  const [loading,setLoading]=useState(true);
  const [deleting,setDeleting]=useState(false);
  const [saving,setSaving]=useState(false);
  const visibleNotes=notes.filter(note=>(!requestedId || note.id===requestedId)&&(kind==='all'||note.kind===kind)&&shown(`${note.title} ${note.content}`).toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(()=>{let alive=true;void hydrateNotes().then(()=>{if(alive)setNotes(loadNotes());}).catch(()=>{if(alive)setListError('研究记录未更新，保留已读取的内容。');}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[]);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(()=>{if(requestedId)setOpenId(requestedId);},[requestedId]);
  // 反思：对某条记录做推理审计。只保留「当前这条」的结果，避免一堆长文同时挂在页面上。
  const [reflectId, setReflectId] = useState<string | null>(null);
  const [reflectText, setReflectText] = useState("");
  const [reflectErr, setReflectErr] = useState("");
  const [saveError, setSaveError] = useState("");
  const [reflecting, setReflecting] = useState(false);
  const [reflectSaved, setReflectSaved] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(()=>()=>abortRef.current?.abort(),[]);

  async function runReflect(n: Note) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSaveError(""); setReflectId(n.id); setReflectText(""); setReflectErr(""); setReflectSaved(false); setReflecting(true);
    try {
      await reflectStream(n.content, n.title, {
        onDelta: (t) => {if(!ctrl.signal.aborted)setReflectText((s) => s + t);},
        onError: (error) => {if(!ctrl.signal.aborted)setReflectErr(error);},
      }, ctrl.signal);
    } catch (e) {
      if (!ctrl.signal.aborted && !(e instanceof DOMException && e.name === "AbortError")) {
        setReflectErr(e instanceof ApiError ? e.message : String(e));
      }
    } finally {
      if(abortRef.current===ctrl)setReflecting(false);
    }
  }

  // 存成功了才置"已保存" —— 写失败还显示成功等于骗自己
  async function saveReflection(n: Note) {
    if(saving||reflectSaved)return;
    setSaving(true); setSaveError("");
    try {
      setNotes(await addNote("反思审计", `反思 · ${n.title}`, reflectText, n.source));
      setReflectSaved(true);
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : String(e));
    } finally {setSaving(false);}
  }

  const fmt = (ts: number) => new Date(ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

  useAiPage({
    key: "notes",
    title: "研究记录",
    context: notes.length
      ? `研究记录（本地，共 ${notes.length} 条）：\n` +
        notes.slice(0, 40).map((n) => `- [${n.kind}] ${n.title}`).join("\n")
      : "研究记录：还没有攒下任何一条。",
    suggestions: ["帮我把这些记录归个类", "我最近在关注什么", "哪些结论该复查了"],
  });

  return (
    <div>
      <PageHeader
        title="研究记录"
        subtitle="本地研究记录" description="把 Agent 复盘 / 要点 / 问答沉淀在本地，随时回看。数据只存本地、不上传。"
        actions={notes.length > 0 && (
          <button disabled={loading||deleting||reflecting||saving} onClick={async () => {
              if(deleting||reflecting||saving||!confirm("清空所有研究记录？")) return;
              setDeleting(true);setListError('');
              // 逐条删可能删到一半失败 —— 用删完后的真实剩余刷新列表，别直接置空
              try { await clearNotes(); } catch {setListError("部分记录未删除，请查看剩余列表后重试。");} finally { setNotes(loadNotes());setDeleting(false); }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:text-destructive">
            <Trash2 className="h-4 w-4" /> 清空
          </button>
        )}
      />
      {returnTo && <p className="mb-3 text-xs"><Link className="text-primary" to={returnTo}>← 返回来源</Link></p>}

      <div className="mb-4 flex flex-wrap gap-2">
        <input aria-label="搜索研究记录" placeholder="搜索标题或正文" value={query} onChange={e=>setQuery(e.target.value)} className="min-w-0 flex-1 rounded border border-border bg-background px-3 py-2 text-sm" />
        <select aria-label="研究记录类型" value={kind} onChange={e=>setKind(e.target.value)} className="rounded border border-border bg-background px-3 py-2 text-sm"><option value="all">全部类型</option>{[...new Set(notes.map(n=>n.kind))].map(k=><option key={k} value={k}>{k}</option>)}</select>
        <button type="button" disabled={loading} className="rounded border border-border px-3 py-2 text-xs" onClick={async()=>{setLoading(true);setListError('');try{await hydrateNotes();setNotes(loadNotes());}catch{setListError('刷新失败，原记录仍保留。');}finally{setLoading(false);}}}>刷新记录</button>
      </div>
      {listError&&<p role="alert" className="mb-3 text-sm text-warning">{listError}</p>}
      {loading&&<p role="status" className="mb-3 text-xs text-muted-foreground">正在同步研究记录…</p>}
      {!loading&&!listError&&requestedId&&!notes.some(n=>n.id===requestedId)&&<p role="status" className="mb-3 text-sm">原记录已删除或无法定位；未选择其他记录。</p>}
      {!loading&&!listError&&notes.length === 0 ? (
        <GlassCard>
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <NotebookPen className="h-8 w-8 text-muted-foreground/40" />
            还没有记录。在「每日复盘」「资讯雷达」或「问 Agent」里点 <b className="text-foreground">「存入沉淀」</b> 保存分析结果。
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {!loading&&notes.length>0&&!visibleNotes.length&&<p role="status" className="py-8 text-center text-sm text-muted-foreground">没有匹配的记录。<button type="button" className="ml-2 text-primary" onClick={()=>{setQuery('');setKind('all');setOpenId(null);setParams(previous=>{const next=new URLSearchParams(previous);next.delete('id');return next;});}}>清除筛选</button></p>}
          {visibleNotes.map((n) => {
            const open = openId === n.id;
            const sourceHref = recordSourceHref(n.source);
            const sourceDate = sourceHref ? new URL(sourceHref, "https://workspace.invalid").searchParams.get("date") : null;
            // 目标日期只认记录来源；空 context 阻止旧记录继承列表页无关日期，且不改返回路径。
            const destination = new URLSearchParams();
            if (n.symbol) destination.set("symbol", n.symbol);
            if (sourceDate) destination.set("date", sourceDate);
            return (
              <GlassCard key={n.id} className="!p-0 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3">
                  <button aria-expanded={open} onClick={() => setOpenId(open ? null : n.id)} className="flex flex-1 items-center gap-2 text-left">
                    {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${KIND_COLOR[n.kind] || "bg-muted/50 text-muted-foreground"}`}>{n.kind}</span>
                    <span className="flex-1 truncate text-sm font-medium">{shown(n.title)}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground/60">{fmt(n.ts)}</span>
                  </button>
                  <button disabled={deleting||reflecting||saving} aria-label={`删除记录 ${shown(n.title)}`} onClick={async() => { if(!confirm('删除这条研究记录？'))return;setDeleting(true);setListError('');try{setNotes(await deleteNote(n.id));}catch{setListError('删除失败，记录仍保留，请重试。');}finally{setDeleting(false);} }} className="shrink-0 text-muted-foreground/60 hover:text-destructive" title="删除">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {open && (
                  <div className="border-t border-border/40 px-4 py-3">
                    <div className="mb-3 flex gap-3 text-xs">{sourceHref && <Link className="text-primary" to={sourceHref}>返回记录来源</Link>}{n.symbol && <><JourneyLink className="text-primary" context={{date:""}} to={`/research?${destination}`}>继续研究</JourneyLink><JourneyLink className="text-primary" context={{date:""}} to={`/observations?${destination}`}>继续观察</JourneyLink></>}</div>
                    <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
                      <ReportAnswer content={shown(n.content)} displayName={hide ? maskPrivateText : undefined} />
                    </div>

                    <div className="mt-3 flex items-center gap-2 border-t border-border/40 pt-3">
                      <button onClick={() => runReflect(n)} disabled={reflecting||saving}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
                        <ScanSearch className="h-3.5 w-3.5" />
                        {reflecting && reflectId === n.id ? "审计中…" : "反思审计"}
                      </button>
                      <span className="text-[11px] text-muted-foreground/70">
                        让 Agent 回头审这段推理：哪些有数据撑着、哪些是脑补、最脆弱的一环在哪
                      </span>
                    </div>

                    {reflectId===n.id&&reflecting&&<div role="status" className="mt-3 text-xs text-muted-foreground">正在审计这条记录… <button type="button" className="ml-2 underline" onClick={()=>{abortRef.current?.abort();setReflecting(false);setReflectErr('已停止审计，本次内容未保存为完整结果。');}}>停止</button></div>}
                    {reflectId === n.id && (reflectText || reflectErr) && (
                      <div className="mt-3 rounded-lg border border-violet-500/30 bg-violet-500/[0.05] p-3">
                        {reflectErr ? (
                          <p className="text-xs text-destructive">{reflectErr}</p>
                        ) : (
                          <>
                            <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
                              <ReactMarkdown remarkPlugins={[remarkGfm]} components={noRemoteImages}>{shown(reflectText)}</ReactMarkdown>
                            </div>
                            {saveError && <p role="alert" className="text-xs text-destructive">保存失败：{saveError}，请重试。</p>}
                            {!reflecting && (
                              <button onClick={() => saveReflection(n)} disabled={reflectSaved||saving}
                                className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50">
                                <Save className="h-3 w-3" /> {saving ? "保存中…" : reflectSaved ? "已存为新记录" : "把审计结果存为新记录"}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}

      <AuditCard />

      <Disclaimer />
    </div>
  );
}
