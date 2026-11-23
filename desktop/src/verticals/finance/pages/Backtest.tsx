import { backtestSourceKey, backtestJobParams } from "../lib/backtestLocation";
import {BacktestProgress} from '../components/BacktestProgress';
import {BacktestOutcome} from '../components/BacktestOutcome';
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BacktestStarters } from "../components/BacktestStarters";
import { Bot, Loader2, Plus, Send, UserRound } from "lucide-react";
import {ReportAnswer} from "../components/ReportAnswer";

import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { ReportHistory } from "@/components/ui/ReportHistory";
import { JourneyLink } from "../components/JourneyLink";
import { BacktestCharts } from "@/components/BacktestCharts";
import { backend, ApiError, friendlyAgentError } from "@/lib/backend";
import { hydrateNotes, loadNotes, type Note } from "@/lib/notes";
import { appendixMarkdown, parseBacktestView, type BacktestView } from "@/lib/backtestView";
import { useAiPage } from "../../../core/ai/pageContext";
import { usePrivacyMode } from "@/hooks/usePrivacyMode";
import { maskPrivateText } from "@/lib/privacy";

interface Message { id: string; role: "user" | "agent"; content: string }
// #34：明文局域网页面不提供 crypto.randomUUID；这里只生成 UI 标识，不作为鉴权凭据。
const id = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const session = () => `bt-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 24);

export function Backtest() {
  const [params]=useSearchParams();
  return <BacktestWorkspace key={backtestSourceKey(params)} />;
}
function BacktestWorkspace() {
  const [params,setParams]=useSearchParams();
  const jobId=params.get("job")??"";
  const [jobPhase,setJobPhase]=useState("正在提交");
  const [jobStarted,setJobStarted]=useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(Boolean(jobId));
  const [notes, setNotes] = useState<Note[]>(loadNotes);
  const [archiveError, setArchiveError] = useState("");
  const [lastReport, setLastReport] = useState("");
  // 隐私模式：对话里自己写的股数、金额只在屏幕上遮（审计第三轮 C2）
  const { on: hide } = usePrivacyMode();
  const shown = (t: string) => (hide ? maskPrivateText(t) : t);
  // 最近一次回测的图表数据（工具原样返回，只在当次会话显示；归档里保留附表）
  const [view, setView] = useState<BacktestView | null>(null);
  const [result,setResult]=useState<unknown>(null);
  const sessionRef = useRef(session());
  const sendVersion=useRef(0);
  const previousJob=useRef(jobId);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(()=>{
    const id=params.get('pattern');if(!id||jobId)return;let gone=false;
    void backend.patternLab().then(data=>{const p=data.patterns.find(p=>p.id===id);if(p&&!gone)setDraft(current=>current||`请设计并核查「${p.name} v1」的历史实验。规则：${p.rule} 时点：${p.timing}。先查正式工具目录及历史样本覆盖；不要用今天名单回填过去，也不要把样本涨跌统计当成交收益。明确次日执行、涨跌停无法成交、T+1、费用与样本量；缺历史数据时明确拒绝收益计算并说明缺口。`);}).catch(()=>{if(!gone)setArchiveError('战法定义未加载');});return()=>{gone=true;};
  },[params]);
  useEffect(()=>{
    const mode=params.get("mode"),version=Number(params.get("version"));if(!mode||!Number.isInteger(version)||jobId)return;
    let gone=false;
    void backend.modeStudio().then(data=>{
      const combo=data.combinations.find(c=>c.id===mode&&c.version===version);
      if(!combo)throw Error("所选模式版本不存在");
      const rules=combo.rules.map(ref=>data.rules.find(r=>r.id===ref.id&&r.version===ref.version));
      if(!gone)setDraft(current=>current||`请先评估以下冻结模式能否使用正式回测工具验证，不要用当前成分或观察快照替代历史数据。缺少区间、成交假设或历史指标时先补问；工具不支持时明确说明。\n模式：${combo.name} v${combo.version}；观察名额 ${combo.limit}（不是交易仓位）。\n规则顺序与条件：${JSON.stringify(rules)}\n先核查历史数据和规则支持，再讨论实验设计。`);
    }).catch(()=>{if(!gone)setArchiveError("模式版本未加载，请回模式工作室核对。");});
    return()=>{gone=true;};
  },[params]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, running]);
  useEffect(() => () => { sendVersion.current++; }, []);
  useAiPage({
    key: "backtest-agent", title: "回测 Agent",
    context: lastReport || "回测 Agent：先通过对话厘清假设与规则，再调用真实回测工具，完成后自动生成并归档报告。",
    suggestions: ["这份回测最关键的限制是什么", "结果相对基准说明什么", "这个假设还缺哪种验证"],
  });

  const reset = () => {
    if(running)return;
    setParams({}, {replace:true});
    sessionRef.current = session();
    setMessages([]); setDraft(""); setRunning(false); setArchiveError(""); setLastReport(""); setView(null);setResult(null);
  };

  useEffect(()=>{
    const switched = Boolean(previousJob.current && jobId && previousJob.current !== jobId);
    previousJob.current = jobId;
    if (switched) { setMessages([]); setDraft(""); setArchiveError(""); }
    if(!jobId)return;
    let gone=false;let timer:ReturnType<typeof setTimeout>;
    setRunning(true);setView(null);setResult(null);setLastReport("");
    const poll=async()=>{
      try{
        const job=await backend.guidedJob(jobId);
        if(gone)return;
        if(!job.key.startsWith('guided:backtest:')){setRunning(false);setArchiveError('任务类型不匹配，请从任务中心打开正确任务。');return;}
        setArchiveError('');
        sessionRef.current=job.key.split(':')[2]!;
        setJobStarted(Date.parse(job.created_at));
        const events=job.events??[];
        const computed=events.find(r=>r.event.type==="guided_data")?.event.value;
        if(computed){setResult(computed);setView(parseBacktestView(computed));}
        setJobPhase([...events].reverse().find(r=>r.event.type==='guided_phase')?.event.phase??'catalog');
        if(['running','cancelling'].includes(job.status)){timer=setTimeout(poll,1500);return;}
        setRunning(false);
        const out=[...events].reverse().find(r=>r.event.type==='guided_result')?.event.reply;
        if(out?.status==='needs_input')setMessages(m=>[...m,{id:id(),role:'agent',content:out.message}]);
        else if(out?.status==='complete'){
        const parsed = parseBacktestView(out.tool_result);
        const appendix = parsed ? appendixMarkdown(parsed) : "";
        const archive = [
          `# ${out.title}`, "", "## 回测问题", "", out.question,
          "", "## 回测假设", "", out.hypothesis,
          "", "## 回测逻辑", "", ...out.logic.map((x) => `- ${x}`),
          "", "## 回测结果", "", out.report,
          ...(appendix ? ["", appendix] : []),
        ].join("\n");
        setLastReport(archive);
        setView(parsed);
        setResult(out.tool_result);
        setMessages((m) => [...m, { id: id(), role: "agent", content: `${out.message}\n\n${archive}` }]);
        try { await hydrateNotes(); if(!gone)setNotes(loadNotes()); }
        catch (e) { if(!gone)setArchiveError(`报告已经生成，但记录列表未刷新：${e instanceof Error ? e.message : String(e)}`); }
        }
        else setMessages(m=>[...m,{id:id(),role:'agent',content:job.status==='cancelled'?'本轮已中止，未生成完整报告。':job.error??'任务未完成，请重新发起。'}]);
        if(job.status==='failed'&&out)setArchiveError('结果已保留在任务中心，但归档未完成。');
      }catch(e){
        if(e instanceof ApiError&&e.status===404){if(!gone){setRunning(false);setArchiveError("任务不存在，请从任务中心重新选择。");}return;}
        if(!gone){setArchiveError('任务状态暂未更新，后台继续运行。可到任务中心查看。');timer=setTimeout(poll,3000);}
      }
    };
    void poll();return()=>{gone=true;clearTimeout(timer);};
  },[jobId]);

  const send = async () => {
    const text=draft.trim();if(!text||running)return;
    const version=++sendVersion.current;
    setParams(previous=>backtestJobParams(previous), {replace:true});
    setRunning(true);setArchiveError('');setDraft('');setResult(null);setView(null);setLastReport('');setJobStarted(Date.now());setJobPhase('catalog');
    setMessages(m=>[...m,{id:id(),role:'user',content:text}]);
    try{
      const job=await backend.startGuidedJob('backtest',sessionRef.current,id(),text);
      if(version===sendVersion.current)setParams(previous=>backtestJobParams(previous,job.id),{replace:true});
    }catch(e){if(version===sendVersion.current){setRunning(false);setDraft(text);setArchiveError(friendlyAgentError(e));}}
  };

  return (
    <div className="space-y-5">
      <PageHeader title="回测" subtitle="历史假设验证" description="把想验证的假设直接告诉 Agent。它会补齐必要条件、选择工具、执行回测，并自动保存完整报告。"
        actions={messages.length > 0 && <button disabled={running} onClick={reset} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          <Plus className="h-3.5 w-3.5" /> 新建会话
        </button>} />


      {messages.length||jobId||running?<details className="mb-3 rounded border border-border p-3 text-xs"><summary className="cursor-pointer text-muted-foreground">实验预设与规则说明</summary><div className="mt-3"><BacktestStarters disabled={running} onChoose={text=>setDraft(text)}/></div></details>:<BacktestStarters disabled={running} onChoose={text=>setDraft(text)} />}
      <BacktestOutcome result={result} hide={hide}/>
      <GlassCard className="ai-surface !p-0 overflow-hidden border-primary/25">
        <div className="ai-surface-header flex items-center gap-3 border-b border-border/60 px-5 py-4">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary"><Bot className="h-5 w-5" /></div>
          <p className="text-sm font-semibold">回测 Agent</p>
        </div>

        <div className="min-h-[360px] max-h-[620px] space-y-5 overflow-y-auto px-5 py-5">
          {messages.length === 0 && !running && <div className="mx-auto flex max-w-xl flex-col items-center py-16 text-center">
            <Bot className="mb-4 h-9 w-9 text-primary/60" />
            <p className="text-base font-medium">想验证什么，直接说。</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">可以从一句不完整的想法开始。Agent 会判断还缺哪些标的、时间范围、规则或对照，再继续追问。</p>
          </div>}
          {messages.map((m) => <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "agent" && <div className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary"><Bot className="h-4 w-4" /></div>}
            <div className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-6 ${m.role === "user" ? "ai-message-user" : "ai-message-assistant"}`}>
              {m.role === "agent" ? <details open><summary className="cursor-pointer text-xs text-primary">{m.content.length<2400?'Agent 回复':'完整报告、假设与数据口径'}</summary><div className="prose prose-sm dark:prose-invert mt-2 max-w-none prose-table:text-sm"><ReportAnswer content={shown(m.content)} displayName={hide ? maskPrivateText : undefined} /></div></details> : <div className="whitespace-pre-wrap">{shown(m.content)}</div>}
            </div>
            {m.role === "user" && <div className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><UserRound className="h-4 w-4" /></div>}
          </div>)}
          {running && <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary"><Loader2 className="h-4 w-4 animate-spin" /></div>
            <BacktestProgress canCancel={Boolean(jobId)} phase={jobPhase} startedAt={jobStarted} onCancel={async()=>{if(jobId){try{await backend.cancelBackgroundJob(jobId);}catch{setArchiveError('中止请求未送达，请重试。');throw Error('cancel_failed');}}}}/>
          </div>}
          <div ref={bottomRef} />
        </div>

        <div className="ai-composer border-t border-border/60 p-4">
          <div className="ai-input flex items-end gap-3 rounded-2xl border border-border p-2 focus-within:border-primary/60">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
            }} disabled={running} rows={2}
              placeholder="例如：验证过去五年，某个均线策略在贵州茅台上是否跑赢买入持有…（Shift+Enter 换行）"
              className="max-h-36 min-h-[52px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground/70 disabled:opacity-50" />
            <button onClick={() => void send()} disabled={!draft.trim() || running}
              className="ai-send grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-opacity disabled:opacity-35" aria-label="发送">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground/65">可以离开或刷新页面，任务在后台继续；完整结果保留在任务中心，报告由服务端归档。</p>
          {archiveError && <p className="mt-2 text-center text-xs text-destructive">{archiveError}</p>}
        </div>
      </GlassCard>

      {view && <BacktestCharts view={view} />}

      {jobId && <p className="mb-3 text-xs"><JourneyLink className="text-primary" to={`/tasks?job=${encodeURIComponent(jobId)}`}>返回本轮任务</JourneyLink></p>}
      <ReportHistory kind="回测" notes={notes} onChange={setNotes} />
      <Disclaimer />
    </div>
  );
}
