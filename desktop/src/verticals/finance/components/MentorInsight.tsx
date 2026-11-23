import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BookmarkPlus, Check, ChevronDown, FileText, MessageCircle, RefreshCw, ScanLine, Search, Sparkles } from 'lucide-react';
import { mentorApi, mentorRuntimeKey, type InsightEvidence, type MentorAnswer, type MentorInsight } from '@/lib/distillation';
import { ApiError } from '@/lib/backend';
import { AI_RUNTIME_CHANGED, readAiRuntime } from '@/lib/llmStore';

const kindLabel = { market: '盘面', behavior: '行为统计', quote: '人物材料', case: '历史案例' };
const statusLabel = {ready: '数据可核对', partial: '部分数据待补', unavailable: '资料待补'};
const message = (error: unknown) => error instanceof Error ? error.message : '读取失败，请重试。';
const metricLabels: Record<string, string> = {
  money_effect_median: '赚钱效应中位数', deep_loss_count: '昨日强势股跌超 5% 家数', promotion_1to2: '首板晋级率',
  limit_up_count: '涨停家数', market_limit_down: '全市场跌停家数', highest_board: '最高连板高度',
  broken_rate: '炸板率', theme_concentration: '头部题材集中度',
};
const directionLabel = {up: '上升', down: '下降', flat: '持平'};
function shanghaiTime(value: string) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(instant);
}

function SourceDetail({item}: {item: InsightEvidence}) {
  return <div className="mentor-source-detail">
    <strong>{item.title}</strong>
    <p>{item.text}</p>
    <small>{item.date} · {item.source}</small>
    {item.url && /^https?:\/\//i.test(item.url) && <a href={item.url} rel="noreferrer" target="_blank">打开原始出处 <ArrowUpRight size={13}/></a>}
  </div>;
}

function Sources({ids, evidence}: {ids: string[]; evidence: InsightEvidence[]}) {
  const [active, setActive] = useState('');
  const items = [...new Set(ids)].map(id => evidence.find(item => item.id === id)).filter((item): item is InsightEvidence => !!item);
  const selected = items.find(e => e.id === active);
  if (!items.length) return null;
  return <div className="mentor-citations">
    <div className="mentor-source-links">{items.map(item => <button key={item.id} type="button"
      className="mentor-source-link" data-kind={item.kind} aria-expanded={active === item.id}
      onClick={() => setActive(active === item.id ? '' : item.id)}>
      <FileText size={12}/><span>{kindLabel[item.kind]} · {item.title}</span><ChevronDown size={12}/>
    </button>)}</div>
    {selected && <SourceDetail item={selected}/>}
  </div>;
}

export function AnswerText({reply, evidence}: {reply: MentorAnswer; evidence: InsightEvidence[]}) {
  const [active, setActive] = useState('');
  const parts = reply.text.split(/(\[资料:[a-f\d]{32}(?: p\.(?:\d+|-))?\])/ig);
  const cited = [...new Set(parts.filter((_, index) => index % 2 === 1))];
  if (!cited.length) return <p>{reply.text}</p>;
  const selectedId = active.slice(4, 36);
  const selected = evidence.find(e => e.citationId === selectedId || e.id === selectedId);
  return <div className="mentor-answer">
    <p>{parts.map((part, i) => {
      if (i % 2 === 0) return part;
      const n = cited.indexOf(part) + 1;
      return <button key={i} className="mentor-inline-cite" type="button" aria-expanded={active === part}
        aria-label={'核对引用 ' + n} onClick={() => setActive(active === part ? '' : part)}>[{n}]</button>;
    })}</p>
    {active && <div className="mentor-citation-original">{selected && <SourceDetail item={selected}/>}<code>{active}</code></div>}
  </div>;
}

function Synthesis({data, refreshStale}: {data: MentorInsight; refreshStale?: () => boolean}) {
  const {status} = readAiRuntime();
  const hasMarket = data.evidence.some(source => source.kind === 'market' && source.date === data.date);
  const hasPerson = data.evidence.some(source => source.kind !== 'market');
  const eligible = status === 'ok' && hasMarket && hasPerson;
  const cached = data.synthesis?.mode === 'ai' ? data.synthesis : mentorApi.cachedSynthesis(data.mentorId, data.date, data.basis);
  const [reply, setReply] = useState(cached);
  const [busy, setBusy] = useState(eligible && !cached);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (cached?.mode === 'ai' || !eligible) return;
    let current = true;
    setBusy(true); setError('');
    // The in-flight request is shared across views. Only the active view displays its result.
    Promise.resolve().then(() => mentorApi.synthesize(data.mentorId, data.date, data.basis)).then(result => {
      if (!current) return;
      if (result.mode === 'ai') setReply(result);
      else setError(result.note ?? 'AI 观点未能通过核验，请重试。');
    }, err => {
      if (!current) return;
      if (err instanceof ApiError && err.code === 'stale_mentor_basis' && refreshStale?.()) return;
      setError(message(err));
    }).finally(() => {if (current) setBusy(false);});
    return () => {current = false;};
  }, [attempt, cached, eligible, data.mentorId, data.date, data.basis, refreshStale]);
  const answer = cached ?? reply;
  const evidence = [...(answer?.evidence ?? []), ...data.evidence];
  return <section className="mentor-verdict">
    <div className="mentor-heading-line"><Sparkles size={17}/>AI 人物观点</div>
    <h2>{data.mentorName}的盘面解读</h2>
    <small>复盘日 {data.date}</small>
    <div className="mentor-synthesis">
      {answer?.mode === 'ai' ? <><AnswerText reply={answer} evidence={evidence}/><Sources ids={answer.evidenceIds} evidence={evidence}/>
        {answer.note && <p className="mentor-note">{answer.note}</p>}</>
        : busy ? <p role="status">正在检索人物资料并结合当日盘面生成观点…</p>
        : error ? <><p role="alert" className="mentor-error">{error}</p>
          <button type="button" className="mentor-button" onClick={() => {setBusy(true); setAttempt(n => n + 1);}}>重试 AI 研判</button></>
        : !hasMarket || !hasPerson ? <p className="mentor-note">{!hasMarket ? '该日尚缺可核对的盘面数据。' : '缺少该日期前可引用的游资资料，可在「材料与版本」补充。'}</p>
        : <p className="mentor-note">{status === 'none' ? '请在「接入 AI」配置模型，配好后会自动生成观点。' : '当前无法读取 AI 配置，请在「接入 AI」检查。'}</p>}
    </div>
  </section>;
}

export function InsightReport({data, refreshStale}: {data: MentorInsight; refreshStale?: () => boolean}) {
  return <div className="mentor-report">
    <Synthesis data={data} refreshStale={refreshStale}/>
    <section className="mentor-card">
      <div className="mentor-heading-line"><ScanLine size={17}/><span>收盘事实</span>
        <span className="mentor-status" data-status={data.status}>{statusLabel[data.status]}</span>
      </div>
      <h2>{data.headline}</h2><p>{data.summary}</p>
      <small>复盘日 {data.date} · 人物版本 {data.version}{data.asOf && ' · 截至 ' + shanghaiTime(data.asOf) + '（北京时间）'}</small>
    </section>
    <EvidenceIndex data={data}/>
  </div>;
}

function EvidenceIndex({data}: {data: MentorInsight}) {
  const groups = [
    {label: '当日盘面', items: data.evidence.filter(item => item.kind === 'market' && item.date === data.date)},
    {label: '历史盘面对照', items: data.evidence.filter(item => item.kind === 'market' && item.date !== data.date)},
    {label: '人物材料与历史成交', items: data.evidence.filter(item => item.kind !== 'market')},
  ];
  return <section className="mentor-card mentor-index"><h3><FileText size={17}/>核对原始证据</h3>
    {groups.filter(group => group.items.length).map(group => <details className="mentor-disclosure" key={group.label}>
      <summary>{group.label}（{group.items.length}）</summary>
      {group.items.map(item => <SourceDetail key={item.id} item={item}/>)}
    </details>)}
    {!data.evidence.length && <p className="mentor-note">该时点暂无记录。</p>}
    {data.gaps.length > 0 && <details className="mentor-disclosure"><summary>数据缺口（{data.gaps.length}）</summary>
      <ul>{data.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></details>}
  </section>;
}

function Conditions({data}: {data: MentorInsight}) {
  const [stored, setStored] = useState<string[]>(data.savedMetrics ?? []);
  useEffect(() => setStored(data.savedMetrics ?? []), [data.savedMetrics]);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  async function save(metric: string) {
    if (saving || stored.includes(metric)) return;
    setSaving(metric); setError('');
    try { await mentorApi.condition(data.mentorId, data.date, data.basis, metric); setStored(prev => [...prev, metric]); }
    catch(e) { setError(message(e)); } finally { setSaving(''); }
  }
  return <section className="mentor-card"><div className="mentor-card-header">
    <h3><BookmarkPlus size={17}/>次日验证</h3>
    <Link to={'/shortline/verify?date=' + encodeURIComponent(data.date)}>查看验证 <ArrowUpRight size={13}/></Link>
  </div>
    {data.conditions.map(row => <div className="mentor-condition" key={row.metric}><div>
      <strong>{metricLabels[row.metric] ?? '观察指标'} · {directionLabel[row.direction]}</strong><p>{row.reason}</p></div>
      <button className="mentor-button" disabled={!!saving || stored.includes(row.metric)} onClick={() => void save(row.metric)}>
        {stored.includes(row.metric) && <Check size={13}/>}
        {stored.includes(row.metric) ? '已加入' : saving === row.metric ? '保存中…' : '加入验证'}</button>
    </div>)}
    {!data.conditions.length && <p className="mentor-note">当前证据尚不足以提出可核对的次日条件。</p>}
    {error && <p role="alert" className="mentor-error">{error}</p>}
  </section>;
}

interface Turn {question: string; reply: MentorAnswer}
function FollowUp({data}: {data: MentorInsight}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function ask(e: FormEvent) {
    e.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true); setError('');
    try {
      const reply = await mentorApi.ask(data.mentorId, data.date, data.basis, text, turns.map(t => t.question));
      setTurns(prev => [...prev, {question: text, reply}]); setQuestion('');
    } catch(err) { setError(message(err)); } finally { setBusy(false); }
  }
  return <section className="mentor-card"><h3><MessageCircle size={17}/>追问这次研判</h3>
    <div aria-live="polite">{turns.map(({question: q, reply}, i) => <article className="mentor-reply" key={i}>
      <strong>{q}</strong><small>{reply.mode === 'ai' ? 'AI 证据解读' : '本地证据检索'}</small>
      <AnswerText reply={reply} evidence={[...(reply.evidence ?? []), ...data.evidence]}/><Sources ids={reply.evidenceIds} evidence={[...(reply.evidence ?? []), ...data.evidence]}/>
      {reply.note && <p className="mentor-note">{reply.note}</p>}
    </article>)}</div>
    <form className="mentor-ask" onSubmit={e => void ask(e)}>
      <label htmlFor="mentor-question">关于 {data.date} 的问题</label>
      <textarea id="mentor-question" placeholder="比如：有哪些历史反例？它们与这次盘面哪里不同？"
        maxLength={1200} rows={2} value={question} disabled={busy} onChange={e => setQuestion(e.target.value)}/>
      <button className="mentor-button is-primary" disabled={!question.trim() || busy}>{busy ? '正在核对…' : '发送追问'}</button>
    </form>{error && <p className="mentor-error" role="alert">{error}</p>}
  </section>;
}

export function MentorInsightDesk({id, date, onDate}: {id: string; date: string; onDate: (date: string) => void}) {
  const runtimeKey = useSyncExternalStore(subscribeRuntime, mentorRuntimeKey, () => 'none');
  return <MentorReview key={JSON.stringify([id, date, runtimeKey])} id={id} date={date} onDate={onDate}/>;
}

function subscribeRuntime(listener: () => void) {
  window.addEventListener(AI_RUNTIME_CHANGED, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(AI_RUNTIME_CHANGED, listener);
    window.removeEventListener('storage', listener);
  };
}

function MentorReview({id, date, onDate}: {id: string; date: string; onDate: (date: string) => void}) {
  const [data, setData] = useState(() => mentorApi.cachedInsight(id, date));
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!data);
  const refreshedStale = useRef(false);
  const refreshStale = useCallback(() => {
    if (refreshedStale.current) return false;
    refreshedStale.current = true;
    setData(undefined);
    setLoading(true);
    setReload(n => n + 1);
    return true;
  }, []);
  useEffect(() => {
    let current = true;
    setError(''); setLoading(true);
    Promise.resolve().then(() => mentorApi.insight(id, date, reload > 0)).then(value => {if (current) setData(value);}, err => {if (current) setError(message(err));})
      .finally(() => {if (current) setLoading(false);});
    return () => { current = false; };
  }, [id, date, reload]);
  return <div className="mentor-desk">
    <div className="mentor-toolbar"><label>复盘日 <input aria-label="复盘日期" type="date" value={date || data?.date || ''} onChange={e => onDate(e.target.value)}/></label>
      {date && <button className="mentor-button" onClick={() => onDate('')}>最近收盘日</button>}
      <button className="mentor-button" disabled={loading} onClick={() => {refreshedStale.current = false; setReload(n => n + 1);}}><RefreshCw size={14}/>{loading ? '读取中…' : '刷新'}</button>
    </div>
    {error && <p role="alert" className="mentor-error">{error}</p>}
    {!data && loading && <p role="status" className="mentor-loading"><Search size={18}/>正在核对复盘数据与人物资料…</p>}
    {data && <div className="mentor-desk" key={data.date + data.basis}>
      <InsightReport data={data} refreshStale={refreshStale}/><Conditions data={data}/><FollowUp data={data}/>
    </div>}
  </div>;
}
