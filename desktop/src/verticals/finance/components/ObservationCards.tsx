import { ObservationEvidence } from "./ui/ObservationEvidence";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { backend, type LedgerRecord } from "@/lib/backend";
import { normalizeMarketSymbol } from "@/lib/marketSymbol";
import { GlassCard } from "@/components/ui/GlassCard";
import { ContextHelp } from "@/components/ui/ContextHelp";

import { usePrivacyMode } from "@/hooks/usePrivacyMode";
import { maskPrivateText } from "@/lib/privacy";

const INPUT = "w-full rounded border border-border bg-background px-3 py-2 text-sm";
const BTN = "rounded border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50";
const text = (r: LedgerRecord, key: string) => typeof r[key] === "string" ? r[key] as string : "";
const STATUS: Record<string, string> = { active: "观察中", paused: "暂停", closed: "已结束", pending: "待回看", met: "已达成", broken: "已触发", dropped: "已放弃" };

/** Reuse the thesis/criterion ledger: no duplicate store and no automated verdicts. */
export function ObservationCards({ symbol }: { symbol: string }) {
  // Remount on object changes so neither drafts nor slow responses cross symbols.
  return <ObservationEditor key={symbol} symbol={symbol} />;
}

function ObservationEditor({ symbol }: { symbol: string }) {
  const code = normalizeMarketSymbol(symbol);
  const { on: hide } = usePrivacyMode();
  const [records, setRecords] = useState<Record<string, LedgerRecord[]> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [date, setDate] = useState("");
  const [adding, setAdding] = useState(false);
  const alive = useRef(true);
  const writing = useRef(false);
  const seq = useRef(0);
  const load = async () => {
    const id = ++seq.current;
    setLoading(true); setError("");
    try {
      const data = await backend.ledger();
      if (alive.current && seq.current === id) setRecords(data.records);
    } catch (e) { if (alive.current && seq.current === id) setError(`读取失败：${String(e)}`); }
    finally { if (alive.current && seq.current === id) setLoading(false); }
  };
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; ++seq.current; }; }, []);
  const save = async (kind: string, record: Record<string, unknown>): Promise<boolean> => {
    if (writing.current || loading) return false;
    writing.current = true; setBusy(true); setError("");
    try {
      const saved = await backend.ledgerSave(kind, record);
      if (!alive.current) return false;
      ++seq.current; // An older ledger read must not erase a confirmed write.
      setRecords(prev => ({ ...prev, [kind]: [saved, ...(prev?.[kind] ?? []).filter(r => r.id !== saved.id)] }));
      return true;
    } catch (e) { if (alive.current) setError(`未保存：${String(e)}`); return false; }
    finally { writing.current = false; if (alive.current) setBusy(false); }
  };
  const cards = (records?.thesis ?? []).filter(r => r.symbol === code);
  return <GlassCard className="mb-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-medium">观察卡片 <span className="font-mono text-muted-foreground">{code}</span></h3>
      <div className="flex gap-2">
        <button type="button" className={BTN} disabled={busy || loading} onClick={() => void load()}>刷新记录</button>
        <button type="button" className={BTN} disabled={!code || !records || loading || busy || hide} onClick={() => setAdding(v => !v)}>{adding ? "收起草稿" : "新建观察"}</button>
        <Link to="/calendar" className={BTN}>到期回看</Link>
        {code && <Link to={`/research?symbol=${encodeURIComponent(code)}`} className={BTN}>全部论点与判据</Link>}
      </div>
    </div>
    <p className="mb-3 text-xs text-muted-foreground">手动记录 · 本地台账 · 不计入明日验证战绩</p>
    {error && <p role="alert" className="mb-3 text-xs text-destructive">{error}</p>}
    {loading && <p role="status" className="text-xs text-muted-foreground">正在读取观察记录…</p>}
    {adding && !hide && <form className="mb-4 space-y-3 border-b border-border pb-4" onSubmit={async e => {
      e.preventDefault();
      if (!code || !title.trim() || !reason.trim()) return;
      if (await save("thesis", { symbol: code, title: title.trim(), statement: reason.trim(), note: evidence.trim(), review_by: date, status: "active" })) {
        setTitle(""); setReason(""); setEvidence(""); setDate(""); setAdding(false);
      }
    }}>
      <input className={INPUT} aria-label="观察标题" placeholder="观察标题" required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} />
      <textarea className={INPUT} aria-label="观察理由" placeholder="关注理由与待核实的问题" required maxLength={4000} value={reason} onChange={e => setReason(e.target.value)} />
      <textarea className={INPUT} aria-label="观察依据" placeholder="依据、来源与数据日期（可选）" maxLength={1000} value={evidence} onChange={e => setEvidence(e.target.value)} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs">复核日期<input type="date" className={INPUT} value={date} onChange={e => setDate(e.target.value)} /></label>
        <button type="submit" disabled={busy || loading || !title.trim() || !reason.trim()} className={BTN}>{busy ? "保存中…" : "保存观察"}</button>
      </div>
    </form>}
    {!loading && records && !cards.length && <p className="py-3 text-sm text-muted-foreground">还没有这只股票的观察记录。</p>}
    <div className="space-y-3">{cards.map(card => <ObservationCardView key={card.id} card={card} conditions={records?.criterion ?? []} hide={hide} disabled={busy || loading}
      onSave={(statement, due) => save("criterion", { symbol: code, thesis_id: card.id, type: "decision_point", statement, due, status: "pending" })} />)}</div>
  </GlassCard>;
}

export function ObservationCardView({ card, conditions, hide, disabled, onSave }: {
  card: LedgerRecord; conditions: LedgerRecord[]; hide: boolean; disabled: boolean;
  onSave: (statement: string, due: string) => Promise<boolean>;
}) {
  const shown = (value: string) => hide ? maskPrivateText(value) : value;
  return <article className="rounded border border-border p-3">
      <div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-medium">{shown(text(card, "title"))}</h4><span className="text-xs text-muted-foreground">{STATUS[text(card, "status")] ?? "观察中"}{card.review_by ? ` · 复核 ${text(card, "review_by")}` : ""}</span></div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{shown(text(card, "statement"))}</p>
      {Boolean(card.note) && <ContextHelp label="观察依据"><ObservationEvidence text={shown(text(card, "note"))} hide={hide}/></ContextHelp>}
      <ul className="mt-3 space-y-2">{conditions.filter(c => c.thesis_id === card.id && (!c.symbol || c.symbol === card.symbol)).map(c => <li key={c.id} className="border-l-2 border-primary/30 pl-3 text-xs">
        <p className="whitespace-pre-wrap break-words">{shown(text(c, "statement"))}</p>
        <p className="mt-1 text-muted-foreground">{STATUS[text(c, "status")] ?? "待回看"}{c.due ? ` · ${c.due}` : ""}</p>
        {Boolean(c.verdict_note) && <p className="mt-1 whitespace-pre-wrap break-words">回看依据：{shown(text(c, "verdict_note"))}</p>}
      </li>)}</ul>
      {!hide && text(card, "status") !== "closed" && <ConditionForm disabled={disabled} onSave={onSave} />}
    </article>;
}

function ConditionForm({ disabled, onSave }: { disabled: boolean; onSave: (statement: string, due: string) => Promise<boolean> }) {
  const [statement, setStatement] = useState("");
  const [due, setDue] = useState("");
  return <details className="mt-3 text-xs"><summary className="cursor-pointer text-primary">添加回看条件</summary>
    <form className="mt-2 space-y-2" onSubmit={async e => { e.preventDefault(); if (statement.trim() && due && await onSave(statement.trim(), due)) { setStatement(""); setDue(""); } }}>
      <textarea className={INPUT} aria-label="回看条件" placeholder="届时核对什么事实" maxLength={1000} required value={statement} onChange={e => setStatement(e.target.value)} />
      <label className="flex items-center gap-2">到期日期<input type="date" required className={INPUT} value={due} onChange={e => setDue(e.target.value)} /></label>
      <button type="submit" className={BTN} disabled={disabled || !statement.trim() || !due}>保存条件</button>
    </form>
  </details>;
}
