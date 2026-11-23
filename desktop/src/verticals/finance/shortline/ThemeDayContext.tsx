import { useEffect, useRef, useState } from "react";
import { addNote, type Note } from "@/lib/notes";
import { exchangeHeadline, yiText } from "@/lib/marketReview";
import { readHistoricalBreadth, peekHistoricalBreadth } from "@/lib/historicalBreadth";
import { readLimits } from "@/components/ReviewMarketCharts";
import type { RotationTheme } from "./types";

export function ThemeMarketClose({ day, revision }: { day: string; revision: number }) {
  const [breadth, setBreadth] = useState(() => peekHistoricalBreadth(day));
  const [limits, setLimits] = useState<{ date: string; up: number | null; down: number | null }>();
  const [error, setError] = useState("");
  const last = useRef(revision);
  useEffect(() => {
    let active = true;
    const fresh = last.current !== revision;
    last.current = revision;
    setError("");
    void readHistoricalBreadth(day, fresh).then(r => { if (active) setBreadth(r); })
      .catch(() => { if (active) setError("当日收盘涨跌家数暂未取得。"); });
    void readLimits(day, fresh).then(r => { if (active) setLimits(r.find(point => point.date === day)); })
      .catch(() => { if (active) setLimits(undefined); });
    return () => { active = false; };
  }, [day, revision]);
  const record = breadth?.date === day ? breadth : null;
  const market = exchangeHeadline(record) ?? record;
  const counts = limits?.date === day ? limits : null;
  return <section className="glass space-y-3 p-4" aria-label="当日大盘">
    <header className="flex items-baseline justify-between"><h3>当日大盘</h3><time className="text-xs text-muted-foreground">{day}</time></header>
    <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
      <div><dt>上涨 / 下跌</dt><dd className="mt-1 font-mono text-base"><b className="text-danger">{market?.up ?? "—"}</b> / <b className="text-success">{market?.down ?? "—"}</b></dd></div>
      <div><dt>涨停 / 跌停</dt><dd className="mt-1 font-mono text-base">{counts?.up ?? record?.limitUp ?? "—"} / {counts?.down ?? record?.limitDown ?? "—"}</dd></div>
      <div><dt>沪深京成交额</dt><dd className="mt-1 whitespace-nowrap font-mono text-sm">{yiText(market?.amount ?? null)}</dd></div>
      <div><dt>市场涨跌面</dt><dd className="mt-1 text-base">{market?.label || "—"}</dd></div>
    </dl>
    {error && <p role="status" className="text-xs text-muted-foreground">{error}</p>}
  </section>;
}

const noteTitle = (name: string, day: string, id?: string) => `题材预期 · ${name} · ${day}${id ? " · " + id : ""}`;
export function findExpectation(notes: Note[], name: string, day: string, id?: string) {
  return notes.find(n => n.title === noteTitle(name, day, id) || (id && n.title.startsWith("题材预期 · ") && n.title.endsWith(` · ${day} · ${id}`)));
}

export function ThemeExpectations({ name, identity, dates, date, trend, notes, onSave }: { name: string; identity?: string; dates: string[]; date: string; trend?: Pick<RotationTheme,"series">; notes:Note[]; onSave:(notes:Note[])=>void }) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  async function save() {
    if (!draft.trim() || lock.current) return;
    lock.current = true;
    setSaving(true); setMessage("");
    try {
      onSave(await addNote("复盘", noteTitle(name, date, identity), draft.trim(), { page: "/shortline/themes", date }));
      setDraft(""); setMessage("预期已存入复盘记录。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败，请重试。"); }
    finally { lock.current = false; setSaving(false); }
  }
  return <section className="glass space-y-3 p-4" aria-label="历史预期与实际">
    <h3>历史预期与实际</h3>
    <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-muted-foreground"><tr>
      <th className="py-2">复盘日</th><th>次日预期</th><th>下一交易日实测</th></tr></thead><tbody>
      {dates.map((d, i) => {
        const note = findExpectation(notes, name, d, identity);
        const next = dates[i + 1];
        return <tr key={d} className="border-t border-border/50"><td className="whitespace-nowrap py-2 pr-3">{d.slice(5)}</td>
          <td className="break-words pr-2">{note ? <>{note.content}<small className="block text-muted-foreground">记录于 {new Date(note.ts).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</small></> : "未记录"}</td>
          <td>{!next ? "待次日收盘" : trend?.series[i + 1] != null ? `${next.slice(5)} · ${trend.series[i + 1]} 只涨停` : "当日题材样本缺失"}</td></tr>;
      })}
    </tbody></table></div>
    <label className="block text-xs text-muted-foreground">{date} 的次日预期
      <textarea maxLength={1500} rows={2} value={draft} onChange={e => setDraft(e.target.value)} className="mt-1 block w-full rounded border border-border bg-background p-2 text-sm text-foreground" />
    </label>
    <button type="button" onClick={() => void save()} disabled={saving || !draft.trim()} className="rounded border border-border px-3 py-1.5 text-xs disabled:opacity-50">{saving ? "保存中…" : "保存预期"}</button>
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>;
}
