import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { backend } from "@/lib/backend";
import { beijingDay, dueTasks, type HomeTask } from "@/lib/homeTasks";
import { usePrivacyMode } from "@/hooks/usePrivacyMode";
import { maskPrivateText } from "@/lib/privacy";

export function HomeTasks() {
  const [tasks, setTasks] = useState<HomeTask[] | null>(null);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [day, setDay] = useState(beijingDay);
  const seq = useRef(0);
  const { on: hide } = usePrivacyMode();
  const load = async () => {
    const mine = ++seq.current;
    setBusy(true); setError("");
    try {
      const result = await backend.ledger();
      if (mine !== seq.current) return;
      const today = beijingDay();
      setStale(false); setDay(today); setTasks(dueTasks(result.records, today));
      const bad = ["thesis", "criterion", "action"].reduce((n, k) => n + (result.issues[k]?.length ?? 0), 0);
      if (bad) setError(`${bad} 条记录格式异常，未计入待办`);
    } catch (e) { if (mine === seq.current) { setStale(true); setError(`待办未更新：${e instanceof Error ? e.message : String(e)}`); } }
    finally { if (mine === seq.current) setBusy(false); }
  };
  useEffect(() => {
    void load();
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { ++seq.current; document.removeEventListener("visibilitychange", visible); };
  }, []);
  if (tasks?.length === 0 && !error) return <div className="mb-3 flex justify-between text-xs text-muted-foreground"><span>暂无到期待办</span><Link to="/calendar" className="text-primary">查看观察日历 →</Link></div>;
  return <section aria-label="到期待办" className="mb-5 rounded border border-border p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-medium">到期待办 <span className="tabular-nums text-primary">{tasks?.length ?? "—"}</span></h2>
      <div className="flex items-center gap-3 text-xs text-muted-foreground"><span>{day} · 北京时间</span><button type="button" disabled={busy} onClick={() => void load()} className="text-primary disabled:opacity-50">{busy ? "更新中…" : "刷新待办"}</button><Link to="/calendar" className="text-primary">查看全部</Link></div>
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-warning">{error}{tasks && stale && " · 下方保留上次读取结果"}</p>}
    {!tasks && !error && <p role="status" className="mt-3 text-xs text-muted-foreground">正在读取本地记录…</p>}
    {tasks?.length === 0 && !error && <p className="mt-3 text-xs text-muted-foreground">当前没有到期的观察、条件或待办。</p>}
    <ul className="mt-2 divide-y divide-border">{tasks?.slice(0, 5).map(task => <li key={`${task.kind}:${task.id}`}>
      <Link to={task.kind === "thesis" && task.symbol ? `/research?symbol=${encodeURIComponent(task.symbol)}` : "/calendar"} className="flex items-start gap-3 py-2 text-xs hover:text-primary">
        <span className={task.date < day ? "shrink-0 text-warning" : "shrink-0 text-muted-foreground"}>{task.date}{task.date < day ? " · 逾期" : " · 今天"}</span>
        <span className="min-w-0 flex-1 break-words">{hide ? maskPrivateText(task.title) : task.title}</span><span className="shrink-0 text-muted-foreground">{task.label}</span>
      </Link>
    </li>)}</ul>
  </section>;
}
