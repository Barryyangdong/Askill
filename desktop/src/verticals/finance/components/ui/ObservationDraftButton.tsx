import { useEffect, useRef, useState } from "react";
import { JourneyLink } from "../JourneyLink";
import { backend } from "@/lib/backend";
import { normalizeMarketSymbol } from "@/lib/marketSymbol";
import { usePrivacyMode } from "@/hooks/usePrivacyMode";

/** A user-reviewed draft from an existing reply. Opening/editing does not call AI or write a ledger. */
export function ObservationDraftButton({ reply, question, initialSymbol = "", initialNote = "" }: { reply: string; question: string; initialSymbol?: string; initialNote?: string }) {
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState(initialSymbol);
  const [title, setTitle] = useState(question.slice(0, 120));
  const [statement, setStatement] = useState(reply);
  const [note, setNote] = useState(initialNote);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ symbol: string; id: string } | null>(null);
  const [error, setError] = useState("");
  const writing = useRef(false);
  const alive = useRef(true);
  const { on: hide } = usePrivacyMode();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const code = normalizeMarketSymbol(symbol);
  const input = "w-full rounded border border-border bg-background px-3 py-2 text-xs";
  return <div className="mt-2">
    <button type="button" disabled={hide} aria-expanded={open && !hide} className="text-xs text-primary disabled:opacity-40" onClick={() => setOpen(v => !v)}>转为观察草稿</button>
    {open && !hide && <section aria-label={initialNote ? "复盘观察草稿" : "AI 回答整理的观察草稿"} className="mt-2 rounded border border-border p-3">
      {saved ? <p role="status" className="text-xs">观察已保存。<JourneyLink to={`/research?symbol=${encodeURIComponent(saved.symbol)}#observation-${encodeURIComponent(saved.id)}`} className="text-primary">查看记录</JourneyLink> · <JourneyLink to={`/observations?symbol=${encodeURIComponent(saved.symbol)}&thesis=${encodeURIComponent(saved.id)}`} className="text-primary">设置核验条件</JourneyLink></p> : <form className="space-y-2" onSubmit={async e => {
        e.preventDefault();
        if (writing.current || !code || !title.trim() || !statement.trim() || statement.length > 4000) return;
        writing.current = true; setBusy(true); setError("");
        try {
          const record = await backend.ledgerSave("thesis", { symbol: code, title: title.trim(), statement: statement.trim(), note: note.trim(), review_by: date, status: "active" });
          if (alive.current) setSaved({ symbol: code, id: record.id });
        } catch (e) { if (alive.current) setError(`未确认保存成功：${e instanceof Error ? e.message : String(e)}。请先核对已有记录再重试。`); }
        finally { writing.current = false; if (alive.current) setBusy(false); }
      }}>
        <p className="text-xs text-muted-foreground">核对股票、理由与来源后再保存；不会自动添加自选或验证条件。</p>
        <input className={input} aria-label="草稿股票代码" placeholder="股票代码" value={symbol} maxLength={20} onChange={e => setSymbol(e.target.value)} required />
        <input className={input} aria-label="草稿标题" value={title} maxLength={120} onChange={e => setTitle(e.target.value)} required />
        <textarea className={input} aria-label="草稿观察理由" rows={6} value={statement} onChange={e => setStatement(e.target.value)} required />
        <p className={`text-xs ${statement.length > 4000 ? "text-warning" : "text-muted-foreground"}`}>{statement.length}/4000 字{statement.length > 4000 ? " · 请整理后保存，原文未截断" : ""}</p>
        <textarea className={input} aria-label="草稿依据来源" placeholder="核对后的依据与来源" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} />
        <label className="flex items-center gap-2 text-xs">复核日期<input type="date" className={input} value={date} onChange={e => setDate(e.target.value)} /></label>
        {error && <p role="alert" className="text-xs text-warning">{error}</p>}
        <button type="submit" disabled={busy || !code || !title.trim() || !statement.trim() || statement.length > 4000} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-40">{busy ? "保存中…" : "确认保存观察"}</button>
      </form>}
    </section>}
  </div>;
}
