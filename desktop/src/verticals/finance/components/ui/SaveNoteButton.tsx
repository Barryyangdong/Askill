import { useState } from "react";
import { Check, BookmarkPlus, AlertCircle } from "lucide-react";
import { addNote, canSaveNoteSource, canSaveResearchNote } from "@/lib/notes";
import { useLocation } from "react-router-dom";
import { recordSource } from "../../lib/recordSource";
import { readWorkspaceContext } from "../../lib/workspaceContext";

/**
 * 把一段 AI 结果存入「研究记录」（沉淀）—— 落**用户自有台账**，不是浏览器缓存。
 *
 * 🔴 写是异步的：**存成功了才显示"已存入"**。
 *    先前是 `addNote(...); setSaved(true)` 一起执行 —— 写失败照样显示成功，
 *    用户以为存下了、关掉页面才发现没有，这种谎比报错难查得多。
 */
export function SaveNoteButton({ kind, title, content, context }: { kind: string; title: string; content: string; context?: {symbol?: string; date?: string} }) {
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const valid = readWorkspaceContext(JSON.stringify(context ?? {}));
  if (valid.symbol) query.set("symbol", valid.symbol);
  if (valid.date) query.set("date", valid.date);
  const source = recordSource(location.pathname + (query.size ? `?${query}` : "") + location.hash);
  /**
   * 🔴 保存状态绑在「这一份」上（kind + 标题 + 正文）：同一位置的按钮换了赛道或换了内容，
   *    沿用上一份的「已存入」会让人以为这份也存了（审计第三轮 C5）。迟到的回包只改它自己那一份。
   */
  const id = `${kind}\u0000${title}\u0000${content}\u0000${JSON.stringify(source)}`;
  const [st, setSt] = useState<{ id: string; state: "idle" | "saving" | "saved" | "failed"; err: string }>({ id, state: "idle", err: "" });
  const state = st.id === id ? st.state : "idle";
  const err = st.id === id ? st.err : "";
  if (!content.trim()) return null;
  if (kind === "研究报告" && !canSaveResearchNote()) return <span className="text-xs text-muted-foreground">当前服务尚不支持保存研究报告记录。</span>;
  const save = async () => {
    const forId = id;
    setSt({ id: forId, state: "saving", err: "" });
    try {
      await addNote(kind, title, content, source ?? undefined);
      setSt((s) => (s.id === forId ? { id: forId, state: "saved", err: "" } : s));
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      setSt((s) => (s.id === forId ? { id: forId, state: "failed", err: why } : s));
    }
  };
  return (
    <button
      onClick={save}
      disabled={state === "saving" || state === "saved"}
      title={err || undefined}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-60"
    >
      {state === "saved" ? (<><Check className="h-3.5 w-3.5" /> {!source || !canSaveNoteSource() ? "已存入，来源未保存" : "已存入沉淀"}</>)
        : state === "failed" ? (<><AlertCircle className="h-3.5 w-3.5 text-destructive" /> 没存上，点这里重试</>)
        : state === "saving" ? (<><BookmarkPlus className="h-3.5 w-3.5" /> 存入中…</>)
        : (<><BookmarkPlus className="h-3.5 w-3.5" /> 存入沉淀</>)}
    </button>
  );
}
