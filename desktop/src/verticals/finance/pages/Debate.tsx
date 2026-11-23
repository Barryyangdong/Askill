import { HistoricalDebate } from "./HistoricalDebate";
import { ObservationDraftButton } from "../components/ui/ObservationDraftButton";
import { JourneyLink } from "../components/JourneyLink";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Swords, Play, Square, CheckCircle2, Circle, AlertTriangle } from "lucide-react";
import { useAiPage } from "../../../core/ai/pageContext";
import { GlassCard } from "@/components/ui/GlassCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { FormActions, FormField, FormToolbar } from "@/components/ui/FormToolbar";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { DebateConclusion } from "../components/DebateConclusion";
import { DebateReport } from "../components/DebateReport";
import { DebateProgress } from "../components/DebateProgress";
import { SymbolSearch } from "../components/SymbolSearch";
import { ReportHistory } from "@/components/ui/ReportHistory";
import { previousDebate } from "../lib/debateHistory";
import { debateStream, type DebateStage } from "@/lib/agents";
import { backend, type DebateNumberAudit, type DebateStage as BackendStage } from "@/lib/backend";
import { parseSearch } from "@/lib/symbolSearch";
import { hydrateNotes, loadNotes, type Note } from "@/lib/notes";
import { marketOfSymbol, normalizeMarketSymbol } from "@/lib/marketSymbol";
import { storageGet, storageSet } from "@/lib/storage";

interface StageBox {
  stage: DebateStage;
  label: string;
  content: string;
  done: boolean;
  status?: BackendStage["status"];
  started_at?: string;
  finished_at?: string;
  /** 这一段里数字的着落（后端就地自查的结果） */
  audit?: DebateNumberAudit;
}

// 多方用品牌橙、空方用蓝灰、主持用中性——刻意不用红绿，
// 免得和 A 股「红涨绿跌」撞车被读成涨跌信号。
const STAGE_TONE: Record<DebateStage, string> = {
  bull: "border-primary/50 bg-primary/[0.06]",
  bull_rebut: "border-primary/30 bg-primary/[0.03]",
  bear: "border-sky-500/40 bg-sky-500/[0.06]",
  bear_rebut: "border-sky-500/25 bg-sky-500/[0.03]",
  bull_reply: "border-primary/30 bg-primary/[0.03]",
  bear_reply: "border-sky-500/25 bg-sky-500/[0.03]",
  referee: "border-border bg-background/40",
};

const DOSSIER_HINT = "多空双方拿到的是同一份接口实时拉取的数据，谁也不能靠编数字赢。";

export function DebateDossier({ progress, missing }: { progress: { title: string; ok: boolean }[]; missing: string[] }) {
  if (!progress.length && !missing.length) return null;
  return <div className="mt-4 border-t border-border/40 pt-3">
    <p className="mb-2 text-[11px] text-muted-foreground">{DOSSIER_HINT}</p>
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">{progress.map(p => <span key={p.title} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">{p.ok ? <CheckCircle2 className="h-3 w-3 text-primary/70" /> : <Circle className="h-3 w-3 text-muted-foreground/40" />}{p.title}</span>)}</div>
    {missing.length > 0 && <p className="mt-2 text-[11px] text-warning">资料限制：{missing.join("、")}（双方立论时不得臆测这部分）</p>}
  </div>;
}
export function restoredDebateRounds(value: unknown, fallback: number): number {
  return value === 1 || value === 2 ? value : fallback;
}


/**
 * 这一段里数字的着落。
 *
 * 🔴 **三档分开显示**：「对得上资料包」「写了算式且重算通过」「两样都不是」
 *    是三种不同的可信度，合成一个「有 N 个数字」等于什么都没说。
 * 🔴 `badMath` 是唯一能断言「这里错了」的一类 —— 算式是它自己写的，结果对不上。
 *    实测抓到过同比算反方向（写 +0.2%，实为 −2.04%）。这一条必须显眼。
 * ⚠️ 「没着落」**不等于错**（可能只是没写算式），所以措辞是「没有交代出处」而不是「错」。
 */
function AuditBar({ a }: { a: DebateNumberAudit }) {
  if (!a.total && !a.badMath.length) return null;
  return (
    <div className="mt-3 border-t border-border/40 pt-2 text-[11px]">
      {a.badMath.length > 0 && (
        <div className="mb-1.5 rounded-lg border border-destructive/40 bg-destructive/[0.07] p-2">
          <p className="font-semibold text-destructive">
            🔴 这一段有 {a.badMath.length} 处算式重算对不上（算式是它自己写的）：
          </p>
          <ul className="mt-1 space-y-0.5 font-mono text-muted-foreground">
            {a.badMath.slice(0, 4).map((b, i) => (
              <li key={i}>
                「{b.raw}」→ 重算应为 <b className="text-destructive">
                  {b.recomputed.toFixed(2)}{b.percent ? "%" : ""}
                </b>
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="text-muted-foreground">
        <summary className="cursor-pointer py-1">数字复核 · 来源吻合 {a.bound} · 自算通过 {a.derived} · <span className={a.loose ? "text-warning" : ""}>待核对 {a.loose}</span></summary>
        <p className="mt-1 leading-relaxed">共识别 {a.total} 个数字。来源吻合只表示数值与共同资料一致；自算通过只表示已写明的算式重算一致；待核对不等于错误。资料期、口径及结论仍需单独判断。</p>
      </details>
    </div>
  );
}


/**
 * 「研究工具 → 多空辩论」页：自己选股票（目前只做 A 股）。正在看哪只记在地址里（?symbol=），
 * 个股深挖页的「多空辩论」按钮会带着那只过来；旧的 /research?tab=debate 也跳到这里。
 * 选股票只是选定，不会自动开始（辩论要用 AI 额度）。跑的途中不让换股票。
 */
export function DebatePage() {
 const [params] = useSearchParams();
 return params.has('job') ? <HistoricalDebate key={`${params.get('job')}:${params.get('symbol')}`} id={params.get('job')??''} symbol={params.get('symbol')??''}/> : <NewDebatePage/>;
}
function NewDebatePage() {
  const [params, setParams] = useSearchParams();
  const code = normalizeMarketSymbol(params.get("symbol")) ?? "";
  const [input, setInput] = useState(code);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(false);
  const lookup = useRef<AbortController | null>(null);
  useEffect(() => { setInput(code); lookup.current?.abort(); lookup.current = null; setResolving(false); }, [code]);
  useEffect(() => () => lookup.current?.abort(), []);
  const choose = async (raw: string) => {
    lookup.current?.abort();
    lookup.current = null;
    const c = normalizeMarketSymbol(raw);
    const apply = (symbol: string) => {
      setInput(symbol);
      if (symbol !== code) setParams((prev) => { const next = new URLSearchParams(prev); next.set("symbol", symbol); return next; });
    };
    setErr("");
    setResolving(false);
    if (c && marketOfSymbol(c) === "CN") { apply(c); return; }
    if (!raw.trim()) { setErr("请输入 A 股代码、名称或拼音"); return; }
    const ac = new AbortController();
    lookup.current = ac;
    setResolving(true);
    try {
      const reply = parseSearch(await backend.runTool("search", { query: raw.trim() }, ac.signal));
      if (ac.signal.aborted) return;
      if (!reply.ok) { setErr(reply.error); return; }
      const matches = reply.matches.filter(m => m.market === "CN");
      const exact = matches.filter(m => m.name === raw.trim() || m.pinyin.toUpperCase() === raw.trim().toUpperCase());
      const candidates = exact.length ? exact : matches;
      if (candidates.length === 1) apply(candidates[0]!.symbol);
      else setErr(candidates.length ? "找到多个 A 股标的，请从下拉候选中选择" : "没找到匹配的 A 股标的，请核对名称或输入 6 位代码");
    } catch {
      if (!ac.signal.aborted) setErr("名称搜索暂不可用，请稍后重试，或输入 6 位 A 股代码");
    } finally {
      if (lookup.current === ac) { lookup.current = null; setResolving(false); }
    }
  };
  return (
    <div>
      <PageHeader
        title="多空辩论"
        subtitle="多空观点核对 · A股" description="同一份客观数据，多方与空方各自立论、互相质疑，通过质询与回应修正观点，形成有依据、有条件的方向判断。目前只做 A 股"
      />
      <GlassCard className="mb-4">
        <FormToolbar>
          <FormField label="A 股代码 / 名称 / 拼音">
            <SymbolSearch value={input} onChange={setInput} onPick={(m) => void choose(m.symbol)} onEnter={() => void choose(input)}
              markets={["CN"]} placeholder="600825 / 新华传媒 / xhcm" disabled={busy || resolving} ariaLabel="A 股代码" className="w-56" />
          </FormField>
          <FormActions>
            <button onClick={() => void choose(input)} disabled={busy || resolving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/40 disabled:opacity-50">
              <Swords className="h-4 w-4" /> {resolving ? "查找中…" : "选这只"}
            </button>
            {code && (
              <JourneyLink to={`/research?symbol=${encodeURIComponent(code)}`} className="text-xs text-muted-foreground hover:text-primary">
                去个股深挖看走势和财报 →
              </JourneyLink>
            )}
          </FormActions>
        </FormToolbar>
        {err && <p role="alert" className="mt-2 text-xs text-destructive">{err}</p>}
      </GlassCard>
      <Debate key={code} symbol={code} onBusy={setBusy} />
      <Disclaimer />
    </div>
  );
}

/**
 * 辩论本体：股票由外面选好传进来。
 * `active`：正在显示（藏起来时不登记 AI 上下文）；`onBusy`：告诉外面辩论在不在跑。
 */
export function Debate({ symbol, active = true, onBusy }: { symbol: string; active?: boolean; onBusy?: (busy: boolean) => void }) {
  const code = normalizeMarketSymbol(symbol) ?? "";
  const market = marketOfSymbol(code);
  /** 下面显示的这场辩论是哪只的（开始那一刻定下，跑的中途换股票也不变） */
  const [runCode, setRunCode] = useState("");
  const [rounds, setRounds] = useState(2);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  runningRef.current = running;
  useEffect(() => { onBusy?.(running); }, [running, onBusy]);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<{ title: string; ok: boolean }[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [stages, setStages] = useState<StageBox[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const lastActivity = useRef(Date.now());
  const [dossierReady, setDossierReady] = useState(false);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const [notes, setNotes] = useState<Note[]>(loadNotes);
  const abortRef = useRef<AbortController | null>(null);
  const stagesRef = useRef<StageBox[]>([]);
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const updateStages = (fn: (rows: StageBox[]) => StageBox[]) => {
    const next = fn(stagesRef.current);
    stagesRef.current = next;
    setStages(next);
  };

  const reset = () => {
    stagesRef.current = [];
    setStartedAt(0);
    setDossierReady(false);
    setStatus(""); setProgress([]); setMissing([]); setStages([]); setError(""); setSaved(false);
  };
  // 换了股票、又没在跑：上一只的辩论收起来（结果已自动归档在下面的历史里）
  useEffect(() => {
    if (!runningRef.current && runCode && runCode !== code) { reset(); setRunCode(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);
  useEffect(() => {
    let cancelled = false;
    void backend.backgroundJobs().then(jobs => {
      const job = jobs.find(j => j.key === `debate:${code}` && ["running", "cancelling"].includes(j.status));
      if (!cancelled && job && !runningRef.current) void start(job.id);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [code]);
  // Refresh restores confirmed output; it never silently starts more model calls.
  useEffect(() => {
    if (!code || runningRef.current) return;
    try {
      const cached = JSON.parse(storageGet(`askill-debate:${code}`) ?? "null");
      if (cached?.version !== 1 || cached.state?.symbol !== code || !Array.isArray(cached.state.stages) || !Number.isFinite(cached.startedAt) || !Number.isFinite(cached.savedAt)) return;
      const rows = cached.state.stages.filter((s: BackendStage) => s && typeof s.id === "string" && typeof s.label === "string" && typeof s.text === "string").map((s: BackendStage) => ({
        stage: s.id as DebateStage, label: s.label, content: s.text, done: s.status === "done", status: s.status, audit: s.audit, started_at: s.started_at, finished_at: s.finished_at,
      }));
      updateStages(() => rows);
      setRounds(current => restoredDebateRounds(cached.rounds, current));
      setRunCode(code); setStartedAt(cached.startedAt); setNow(cached.savedAt); setDossierReady(true); setMissing(cached.state.gaps ?? []);
      setStatus(cached.state.outcome === "completed" ? "已恢复上次辩论结果" : "已恢复上次未完成的内容；未完成环节需重新开始");
    } catch { /* Malformed or unavailable local cache does not block a fresh run. */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);


  async function start(resumeId?: string) {
    const c = code;
    if (!/^\d{6}$/.test(c)) { setError("多空辩论目前只支持 A 股，请在页头选一只 A 股"); return; }
    reset();
    setRunCode(c);
    setRunning(true);
    const begun = Date.now(); setStartedAt(begun); setNow(begun); lastActivity.current = begun;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const final = await debateStream(c, rounds, {
        onActivity: () => { if (abortRef.current === ctrl) lastActivity.current = Date.now(); },
        onState: state => {
          if (abortRef.current !== ctrl) return;
          storageSet(`askill-debate:${c}`, JSON.stringify({ version: 1, state, rounds, startedAt: begun, savedAt: Date.now() }));
          updateStages(rows => state.stages.map(stage => ({
            stage: stage.id as DebateStage, label: stage.label, status: stage.status,
            done: stage.status === "done", audit: stage.audit,
            started_at: stage.started_at, finished_at: stage.finished_at,
            content: stage.text || (stage.status === "running" ? rows.find(row => row.stage === stage.id)?.content ?? "" : ""),
          })));
        },
        onPreview: (stage, text) => {
          if (abortRef.current === ctrl) updateStages(rows => rows.map(row => row.stage === stage && !row.done ? { ...row, content: text } : row));
        },
        onStatus: (message) => { if (abortRef.current === ctrl) setStatus(message); },
        onDossierProgress: (title, ok, loaded, total) => {
          if (abortRef.current !== ctrl) return;
          setStatus(`正在拉取客观事实底稿… ${loaded}/${total}`);
          setProgress((p) => [...p, { title, ok }]);
        },
        onDossierReady: (_sections, miss) => {
          if (abortRef.current === ctrl) { setDossierReady(true); setMissing(miss); setStatus("底稿就绪，辩论开始"); }
        },
        onStageStart: (stage, label) => {
          if (abortRef.current === ctrl) updateStages((s) => s.some(b => b.stage === stage) ? s : [...s, { stage, label, content: "", done: false, status: "running" }]);
        },
        onDelta: (stage, text, audit) => {
          if (abortRef.current === ctrl) updateStages((s) => s.map((b) => (b.stage === stage && !b.done ? { ...b, content: b.content + text, ...(audit ? { audit } : {}) } : b)));
        },
        onStageDone: (stage, _label, content) => {
          if (abortRef.current === ctrl) updateStages((s) => s.map((b) => (b.stage === stage && !b.done ? { ...b, content, done: true } : b)));
        },
        onError: (message, stage) => {
          if (abortRef.current === ctrl) setError(stage ? `${stagesRef.current.find(s => s.stage === stage)?.label ?? stage}：${message}` : message);
        },
      }, ctrl.signal, previousDebate(notes, c, begun), resumeId);
      if (abortRef.current === ctrl && !ctrl.signal.aborted && final?.done
          && final.outcome !== "failed" && final.outcome !== "cancelled" && stagesRef.current.some((s) => s.done)) {
        try {
          await hydrateNotes(); setNotes(loadNotes());
          setSaved(true);
          setStatus(final.outcome === "completed" ? "辩论完成，报告已自动归档" : "辩论结束（有环节未完成），现有报告已自动归档");
        } catch (e) {
          setError(`报告已在后台归档，但页面记录未刷新：${e instanceof Error ? e.message : String(e)}`);
        }
      } else if (abortRef.current === ctrl && !ctrl.signal.aborted) {
        setStatus(final?.outcome === "cancelled" ? "本次已中止，已完成内容保留" : "本次未完成，已生成内容保留");
      }
    } catch (e) {
      if (abortRef.current === ctrl) {
        if (e instanceof DOMException && e.name === "AbortError") setStatus("页面已断开，后台任务可在任务中心继续查看");
        else setError((e instanceof Error ? e.message : String(e)) + " 可在任务中心查看后台结果。");
      }
    } finally {
      if (abortRef.current === ctrl) {
        if (ctrl.signal.aborted) setStatus("页面已断开，后台任务可在任务中心继续查看");
        setNow(Date.now());
        setRunning(false);
        abortRef.current = null;
      }
    }
  }

  async function stop() {
    setStatus("正在请求后台中止…");
    try {
      const jobs = await backend.backgroundJobs();
      const job = jobs.find(j => j.key === `debate:${runCode}` && ["running", "cancelling"].includes(j.status));
      if (job) await backend.cancelBackgroundJob(job.id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  const finished = stages.length > 0 && stages.every((s) => s.done);
  const conclusion = stages.find(s=>s.stage==="referee"&&s.done)?.content;

  const shown = runCode || code;
  useAiPage({
    key: `debate:${shown || "none"}`,
    title: shown ? `多空辩论 · ${shown}` : "多空辩论",
    context: stages.length
      ? `多空辩论 · 标的 ${runCode}\n` + stages.map((s) => `【${s.label}】${s.done ? s.content : "（还在跑）"}`).join("\n\n")
      : "多空辩论：还没跑过。这一页会用同一份客观资料让多方与空方各自立论、互相质疑，最后由中立主持归纳分歧点与验证清单。",
    suggestions: ["双方最大的分歧在哪", "哪一方的论据更硬", "验证清单该怎么排优先级"],
  }, active);

  const canStart = market === "CN";
  return (
    <div>
      <GlassCard>
        <div className="mb-3 flex items-center gap-2">
          <Swords className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">多空辩论{code && <span className="ml-1.5 font-normal text-muted-foreground">· {code}</span>}</h3>
        </div>
        {/* 介绍写在页头，这里不再重复一遍 */}
        {/* 只做 A 股：底稿的几个来源只有 A 股数据。港美股给出去处，而不是一个点了才报错的按钮 */}
        {!code && <p className="mb-3 text-xs text-primary">先在上面选一只 A 股。</p>}
        {code && !canStart && (
          <p className="mb-3 rounded-lg border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">
            多空辩论目前只支持 A 股。{code} 是{market === "HK" ? "港股" : "美股"}，可以去<Link to={`/research?symbol=${encodeURIComponent(code)}`} className="text-primary hover:underline">个股深挖</Link>看走势、财报和事件回看，或做六阶段研究。
          </p>
        )}
        {runCode && runCode !== code && (
          <p className="mb-3 text-xs text-warning">
            {running
              ? `下面还在跑的是 ${runCode} 的辩论；它结束后才能为当前这只开始。`
              : `下面是 ${runCode} 的辩论结果，不是 ${code || "当前选的股票"}；点「开始辩论」会换成当前这只。`}
          </p>
        )}
        <FormToolbar>
          <FormField label="辩论深度">
            <select aria-label="辩论深度"
              value={rounds}
              onChange={(e) => setRounds(Number(e.target.value))}
              disabled={running}
              className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
            >
              <option value={1}>快速对照 · 不含交叉质询</option>
              <option value={2}>完整辩论 · 质询、回应与修正</option>
            </select>
          </FormField>
          <FormActions>
            {running ? (
              <button onClick={stop}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-4 py-2 text-sm hover:text-destructive">
                <Square className="h-4 w-4" /> 中止
              </button>
            ) : (
              <button onClick={() => void start()} disabled={!canStart}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary/90 px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary disabled:opacity-40">
                <Play className="h-4 w-4" /> 开始辩论
              </button>
            )}
            {finished && !running && saved && <span className="form-toolbar-summary text-xs text-success">报告已自动归档</span>}
        </FormActions>
        </FormToolbar>

        {!running && !status && <p className="mt-3 text-xs text-muted-foreground">
          多空独立陈述并行生成{rounds === 2 ? " → 交叉质询 → 回应与修正" : ""} → 综合判断 → 自动归档
        </p>}
        {startedAt > 0 && <DebateProgress
          stages={stages.map(s => ({ id: s.stage, label: s.label, text: s.content, status: s.status ?? (s.done ? "done" : "pending"), started_at: s.started_at, finished_at: s.finished_at }))}
          rounds={rounds} startedAt={startedAt} now={now} running={running} dossierReady={dossierReady} lastActivity={lastActivity.current}
        />}
        {status && <p className="mt-3 text-xs text-muted-foreground">{status}</p>}
        {error && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}

        <DebateDossier progress={progress} missing={missing} />
      </GlassCard>

      {stages.find(s => s.stage === "referee" && s.content) && <div className="mt-4">
        <DebateConclusion content={stages.find(s => s.stage === "referee")!.content} provisional={!stages.find(s => s.stage === "referee")!.done} />
        {stages.find(s => s.stage === "referee")?.audit && <AuditBar a={stages.find(s => s.stage === "referee")!.audit!} />}
      </div>}
      {conclusion && <ObservationDraftButton initialSymbol={shown} question={`${shown} · 辩论后的观察`} reply={conclusion} />}
      <details className="mt-4" open={running || !stages.some(s => s.stage === "referee" && s.done)}>
      <summary className="cursor-pointer py-2 text-sm font-medium">完整交锋过程{finished ? " · 已完成" : ""}</summary>
      <div className="mt-2 space-y-4">
        {stages.filter(s => s.status !== "pending" && s.stage !== "referee").map((s) => (
          <div key={s.stage} className={`rounded-xl border p-4 ${STAGE_TONE[s.stage]}`}>
            <div className="mb-2 flex items-center gap-2">
              <Swords className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">{s.label}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{s.done ? "已完成" : s.status === "failed" ? "未完成" : s.status === "cancelled" ? "已中止" : running ? "生成预览 · 数字待复核" : "未确认完成"}</span>
            </div>
            {s.content ? <DebateReport content={s.content} /> : <p className="py-4 text-sm text-muted-foreground">{running && s.status === "running" ? "正在组织观点，正文返回后将在这里逐段显示…" : "这个环节没有返回可用正文。"}</p>}
            {s.audit && <AuditBar a={s.audit} />}
          </div>
        ))}
      </div>

      </details>

      {stages.length === 0 && !running && (
        <GlassCard className="mt-4">
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <Swords className="h-8 w-8 text-muted-foreground/40" />
            点「开始辩论」。后端会先拉一份客观事实底稿，再让多方 / 空方基于同一份数据互相质疑。
            <span className="text-xs">默认包含独立立论、交叉质询、回应修正与综合判断。</span>
          </div>
        </GlassCard>
      )}

      <ReportHistory kind="多空辩论" notes={notes} onChange={setNotes} renderContent={content => <DebateReport content={content} />} />
    </div>
  );
}
