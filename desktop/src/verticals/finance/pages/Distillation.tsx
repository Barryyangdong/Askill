import { HistoricalScene, ShortlineScene, MethodsPanel, MethodExamples } from '@/components/MentorLearning';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, FileStack, ScanLine, UserPlus, Scale } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageTabs } from '@/components/ui/PageTabs';
import { MentorInsightDesk } from '@/components/MentorInsight';
import { MentorMaterials } from '@/components/MentorMaterials';
import { choices, mentorApi, type Attempt, type Choice, type Decision, type Lesson, type Market, type Mentor, type Plan, type Profile } from '@/lib/distillation';
import './mentorDesk.css';

const panel = 'rounded-lg border border-border bg-card p-4 sm:p-5 space-y-3';
const field = 'w-full rounded border border-border bg-background px-3 py-2 text-sm';
const button = 'rounded border border-border bg-background px-3 py-2 text-sm hover:border-primary disabled:opacity-50';
const primary = 'rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50';
const muted = 'text-sm leading-6 text-muted-foreground';
const errorText = (e: unknown) => e instanceof Error ? e.message : '操作未完成，请重试。';
// 一级视图：盘面研判 / 方法与历史 / 素材管理
type SectionKey = 'insight' | 'study' | 'materials';
// 二级 tab（Workspace 内部，保持现有逻辑不变）
type Tab = '方法研习' | '历史盲练' | '人物原话' | '今日盘面' | '学习档案';

function useLoad<T>(load: () => Promise<T>, identity: string) {
  const [value, setValue] = useState<T>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setValue(undefined); setError('');
    load().then(v => { if (active) setValue(v); }, e => { if (active) setError(errorText(e)); });
    return () => { active = false; };
  }, [identity, retry]);
  return { value, setValue, error, retry: () => setRetry(n => n + 1) };
}

function Status({ error, retry }: { error: string; retry: () => void }) {
  return error ? <div role="alert" className={panel}>{error} <button className={button} onClick={retry}>重新读取</button></div> :
    <p role="status" className={muted}>正在读取资料…</p>;
}

function useAction() {
  const [busy, pending] = useState(false);
  const [error, setError] = useState('');
  async function run(work: () => Promise<void>) {
    if (busy) return;
    pending(true); setError('');
    try { await work(); } catch (e) { setError(errorText(e)); } finally { pending(false); }
  }
  return { busy, run, errorNode: error && <p className="text-sm text-warning" role="alert">{error}</p> };
}

function MarketRow({ market }: { market: Market | null }) {
  if (!market) return <p className={muted}>缺少对应时点的指数数据。</p>;
  return <dl className="grid grid-cols-3 gap-2 rounded bg-muted/40 p-3">
    {([['pct', '上证当日'], ['d5', '近五日'], ['d20', '近二十日']] as const).map(([key, label]) =>
      <div key={key}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium tabular-nums">{market[key] == null ? '缺数据' : market[key] + '%'}</dd></div>)}
  </dl>;
}

function readLocal(key: string) {
  try { return sessionStorage.getItem('distillation:' + key) ?? ''; } catch { return ''; }
}

function writeLocal(key: string, value: string) {
  try {
    if (value) sessionStorage.setItem('distillation:' + key, value);
    else sessionStorage.removeItem('distillation:' + key);
  } catch { /* The form remains usable when browser storage is unavailable. */ }
}

function initialDraft(key: string): Decision {
  try {
    const draft = JSON.parse(readLocal(key));
    if (Object.hasOwn(choices, draft.choice) && typeof draft.reason === 'string' && typeof draft.condition === 'string') return draft;
  } catch { /* No saved draft. */ }
  return { choice: 'unknown', reason: '', condition: '' };
}

export function PracticeGuide({ profile, open }: { profile: Profile; open: (id: string) => void }) {
  const independent = profile.attempts.filter(a => !a.hinted).sort((a,b) => b.at.localeCompare(a.at));
  const last = independent[0];
  const remaining = profile.cases.filter(c => !c.hinted && !profile.attempts.some(a => a.caseId === c.id));
  let next = remaining[0];
  let task = '先独立完成一题，留下判断依据和复核条件。';
  if (last) {
    const previous = profile.cases.find(c => c.id === last.caseId);
    if (previous && previous.holdingCount && !/持股|持仓|原仓|底仓|仓位/.test(last.reason)) {
      task = '上一次的依据里没有明确写出原持仓。下一题先区分继续持有和新增标的，再做决定。';
      next = remaining.find(c => (c.holdingCount ?? 0) > 0) ?? next;
    } else if (!/指数|涨跌|涨幅|跌幅|涨停|成交|量能|放量|缩量|均线|板块|仓位|持仓|突破|跌破|[%％\d]/.test(last.condition)) {
      task = '上一次的条件中没有识别到可观察的指标。下一题试着写出一项指标，以及它朝哪个方向变化时你会改主意。';
    } else {
      task = '上一题已留下可复核的线索。换一个持仓或市场条件不同的现场，检验原来的判断还适用吗。';
      next = remaining.find(c => previous && (c.holdingCount !== previous.holdingCount || Math.sign(c.market.pct ?? 0) !== Math.sign(previous.market.pct ?? 0))) ?? next;
    }
  }
  return <section className={panel}><h2 className="font-semibold">下一次练什么</h2>
    {last && <blockquote className="border-l-2 border-border pl-3 text-sm"><p>上次的依据 · {last.reason}</p><p>上次的条件 · {last.condition}</p></blockquote>}
    <p className={muted}>{task}</p>{next ? <button className={button} onClick={() => open(next.id)}>练习 {next.date} 的盘面 →</button> : <p className={muted}>当前资料包的独立练习已完成或已看过对照，可以回看初答，补写复盘。</p>}
  </section>;
}
function DecisionForm({ busy, submit, label, draftKey }: { draftKey: string; busy: boolean; submit: (value: Decision) => void; label: string }) {
  const [draft] = useState(() => initialDraft(draftKey));
  const [choice, choose] = useState<Choice>(draft.choice);
  const [reason, setReason] = useState(draft.reason);
  const [condition, setCondition] = useState(draft.condition);
  useEffect(() => writeLocal(draftKey, JSON.stringify({choice,reason,condition})), [draftKey,choice,reason,condition]);
  function send(event: FormEvent) {
    event.preventDefault();
    if (reason.trim() && condition.trim()) submit({ choice, reason: reason.trim(), condition: condition.trim() });
  }
  return <form onSubmit={send} className="space-y-3">
    <fieldset disabled={busy}><legend className="mb-2 text-sm font-medium">我的判断</legend><div className="flex flex-wrap gap-2">
      {(Object.entries(choices) as [Choice, string][]).map(([id, text]) => <label key={id} className={button}><input className="mr-2" type="radio" name="choice" checked={choice === id} onChange={() => choose(id)}/>{text}</label>)}
    </div></fieldset>
    <label className="block text-sm">判断依据<textarea className={field} required maxLength={500} rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="你看到了哪条盘面或持仓证据？"/></label>
    <label className="block text-sm">改变判断的条件<textarea className={field} required maxLength={500} rows={2} value={condition} onChange={e => setCondition(e.target.value)} placeholder="下一交易日出现什么情况，你会调整计划？"/></label>
    <button className={primary} disabled={busy || !reason.trim() || !condition.trim()}>{busy ? '正在保存…' : label}</button>
  </form>;
}

function DecisionRead({ decision }: { decision: Decision }) {
  return <div className="space-y-1 border-l-2 border-primary pl-3 text-sm"><strong>{choices[decision.choice]}</strong><p>依据 · {decision.reason}</p><p>复核条件 · {decision.condition}</p></div>;
}

function NoteForm({ saved, label, busy, submit }: { saved?: string; label: string; busy: boolean; submit: (v: string) => void }) {
  const [text, setText] = useState(saved ?? '');
  return <form className="space-y-2" onSubmit={e => { e.preventDefault(); if (text.trim()) submit(text.trim()); }}>
    <label className="block text-sm">{label}<textarea className={field} value={text} rows={2} maxLength={800} onChange={e => setText(e.target.value)}/></label>
    <button className={button} disabled={busy || !text.trim() || saved === text.trim()}>保存{label}</button>
  </form>;
}

export function LessonPanel({ id, lesson, answer, update }: { id: string; lesson: Lesson; answer?: Attempt; update: (a: Attempt) => void }) {
  const act = useAction();
  return <section className={panel}>
    <header><p className="text-xs text-muted-foreground">{lesson.date} 收盘现场</p><h2 className="mt-1 text-lg font-semibold">{lesson.prompt}</h2></header>
    <MarketRow market={lesson.market}/>
    <HistoricalScene lesson={lesson}/>
    <p className={muted}>起始持股 {lesson.holdingCount ?? '未知'} 只 · 仓位 {lesson.positionPct == null ? '未知' : lesson.positionPct + '%'} · 下一交易日 {lesson.nextDate}</p>
    {answer ? <>
      <h3 className="font-medium">我的初答</h3><DecisionRead decision={answer}/>
      <h3 className="font-medium">实盘揭晓</h3><p>{answer.reveal.summary}</p>
      <details className={muted}>
        <summary>核对成交来源</summary>
        <ul className="mt-2 list-disc pl-5">
          {answer.reveal.sources.map((s,i) => <li key={i}>{s}</li>)}
        </ul>
        {answer.reveal.sourcePosts?.filter(p => /^https?:\/\//i.test(p.url)).map(p => (
          <a key={p.url} className="mr-3 text-primary underline" target="_blank" rel="noreferrer" href={p.url}>
            {p.title}
          </a>
        ))}
      </details>
      <h3 className="font-medium">练习反馈</h3><p className={muted}>{answer.feedback}</p>
      {answer.coach ? <div className="rounded bg-muted/40 p-3"><strong className="text-sm">AI 教练 · 案例与作答标签追问</strong><p className="whitespace-pre-wrap text-sm">{answer.coach}</p></div> :
        <button className={button} disabled={act.busy} onClick={() => void act.run(async () => { const coach = await mentorApi.coach(id, lesson.id); update({ ...answer, coach: coach.text }); })}>请 AI 根据案例与作答标签追问</button>}
      <NoteForm saved={answer.revision} busy={act.busy} label="复盘笔记" submit={v => void act.run(async () => update(await mentorApi.revise(id, lesson.id, v)))}/>
    </> : <DecisionForm draftKey={id + lesson.id} busy={act.busy} label="保存初答并揭晓" submit={v => void act.run(async () => { update(await mentorApi.answer(id, lesson.id, v)); writeLocal(id + lesson.id, ''); })}/>}
    {act.errorNode}
  </section>;
}

function TodayPanel({ profile, update, open, onHint }: { onHint: (ids: string[]) => void; profile: Profile; update: (p: Plan) => void; open: (id: string) => void }) {
  const { value, setValue, error, retry } = useLoad(() => mentorApi.today(profile.id), profile.id);
  const [revealed, reveal] = useState(false);
  const act = useAction();
  if (!value) return <Status error={error} retry={retry}/>;
  const date = value.date;
  const plan = profile.plans.find(p => p.date === date);
  async function compare() { const current = await mentorApi.compare(profile.id); setValue(current); reveal(true); onHint(current.matches.map(m => m.caseId)); }
  return <section className={panel}><header><p className="text-xs text-muted-foreground">{date ?? '行情日期待确认'} · 收盘复盘</p><h2 className="mt-1 text-lg font-semibold">下一交易日要考虑新开仓吗？</h2></header>
    <MarketRow market={value.market}/><ShortlineScene today={value}/><p className={muted}>{value.summary}</p>
    {value.asOf && <p className="text-xs text-muted-foreground">数据截至 {value.asOf}</p>}
    {date && value.status === 'ready' && <>
      {plan ? <DecisionRead decision={plan}/> : <DecisionForm draftKey={profile.id + date} label="保存我的计划" busy={act.busy} submit={v => void act.run(async () => { update(await mentorApi.plan(profile.id, date, v, revealed)); writeLocal(profile.id + date, ''); await compare(); })}/>}
      {!revealed ? <button className={button} disabled={act.busy} onClick={() => void act.run(compare)}>查看历史对照</button> :
        <div className="space-y-2"><h3 className="font-medium">相似历史盘面</h3>{value.matches.map(m => <button key={m.caseId} className={`${button} block w-full text-left`} onClick={() => open(m.caseId)}>{m.date} · {m.summary} →</button>)}{!value.matches.length && <p className={muted}>当前没有可比案例。</p>}</div>}
    </>}{act.errorNode}</section>;
}

function ArchivePlan({ id, plan, update }: { id: string; plan: Plan; update: (p: Plan) => void }) {
  const act = useAction();
  return <details className={panel}><summary>{plan.date} · {plan.hinted ? '看过对照' : '独立计划'}</summary><DecisionRead decision={plan}/>
    {plan.market && <MarketRow market={plan.market}/>}
    {plan.asOf && <p className={muted}>计划行情截至 {plan.asOf}</p>}
    <NoteForm label="执行复核" saved={plan.review} busy={act.busy} submit={v => void act.run(async () => update(await mentorApi.review(id, plan.date, v)))}/>{act.errorNode}</details>;
}

function Workspace({ id }: { id: string }) {
  const { value: profile, setValue, error, retry } = useLoad(() => mentorApi.profile(id), id);
  const [requestedTab, setTab] = useState<Tab>(() => (['方法研习','历史盲练','人物原话','今日盘面','学习档案'] as Tab[]).find(t => t === readLocal(id + 'tab')) ?? '方法研习');
  const [active, select] = useState(() => readLocal(id + 'active'));
  useEffect(() => { writeLocal(id + 'tab', requestedTab); writeLocal(id + 'active', active); }, [id, requestedTab, active]);
  const [methodId, selectMethod] = useState('');
  const [quoteLimit, more] = useState(12);
  if (!profile) return <Status error={error} retry={retry}/>;
  const lesson = profile.cases.find(c => c.id === active) ?? profile.cases[0];
  const open = (caseId: string) => { select(caseId); setTab('历史盲练'); };
  const updatePlan = (plan: Plan) => setValue(p => p && ({ ...p, plans: [plan, ...p.plans.filter(x => x.date !== plan.date)] }));
  const updateAttempt = (a: Attempt) => setValue(p => p && ({ ...p, attempts: [a, ...p.attempts.filter(x => x.caseId !== a.caseId)] }));
  const method = profile.methods?.find(m => m.id === methodId && lesson && m.exampleIds.includes(lesson.id));
  const markHint = (caseId: string) => setValue(p => p && ({ ...p, cases: p.cases.map(c => c.id === caseId ? { ...c, hinted: true } : c) }));
  const tabs: Tab[] = [];
  if (profile.methods?.length) tabs.push('方法研习');
  if (profile.cases.length) tabs.push('历史盲练');
  if (profile.quotes.length) tabs.push('人物原话');
  if (profile.cases.length) tabs.push('今日盘面', '学习档案');
  const tab = tabs.includes(requestedTab) ? requestedTab : tabs[0];

  function caseStatus(c: Lesson) {
    const answer = profile?.attempts.find(a => a.caseId === c.id);
    if (answer) return answer.hinted ? '提示后作答' : '已独立作答';
    return c.hinted ? '看过对照' : '待独立练习';
  }

  let body: ReactNode;
  if (tab === '方法研习') {
    body = <MethodsPanel profile={profile} onHint={markHint} practice={(caseId, selectedMethod) => {
      selectMethod(selectedMethod); open(caseId);
    }}/>;
  } else if (tab === '历史盲练' && lesson) {
    body = (
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(160px,240px)_1fr]">
        <aside className={panel}>
          <h2 className="font-semibold">历史案例</h2>
          <div className="max-h-52 space-y-1 overflow-auto lg:max-h-[64vh]">
            {profile.cases.map(c => (
              <button key={c.id} aria-pressed={lesson.id === c.id} onClick={() => select(c.id)}
                className={'block w-full rounded p-2 text-left text-sm ' + (lesson.id === c.id ? 'bg-muted font-medium' : '')}>
                {c.date}<span className="ml-2 text-xs text-muted-foreground">{caseStatus(c)}</span>
              </button>
            ))}
          </div>
        </aside>
        <div className="space-y-3">
          {method && <p className={muted}>本题练习 · {method.title} · {method.trigger}</p>}
          <LessonPanel key={lesson.id} id={id} lesson={lesson}
          answer={profile.attempts.find(a => a.caseId === lesson.id)} update={updateAttempt}/>
          {profile.attempts.some(a => a.caseId === lesson.id) && profile.methods?.filter(m => m.exampleIds.includes(lesson.id)).map(m => (
            <section key={m.id + lesson.id} className={panel}><h3 className="font-semibold">核对方法 · {m.title}</h3>
              <MethodExamples profileId={id} method={m} cases={[lesson]} onHint={markHint}/>
            </section>
          ))}
        </div>
      </div>
    );
  } else if (tab === '人物原话') {
    body = (
      <section className={panel}>
        <h2 className="font-semibold">成长时间线</h2>
        {profile.quotes.slice(0, quoteLimit).map((q, i) => (
          <article className="border-t border-border pt-3" key={i}>
            <time className="text-xs text-muted-foreground">{q.date} · 本人发言</time>
            <blockquote className="my-2 whitespace-pre-wrap text-sm">{q.text}</blockquote>
            {/^https?:\/\//i.test(q.url)
              ? <a className="text-xs text-primary underline" target="_blank" rel="noreferrer" href={q.url}>{q.source}</a>
              : <small>{q.source}</small>}
          </article>
        ))}
        {profile.quotes.length > quoteLimit && (
          <button className={button} onClick={() => more(n => n + 12)}>查看更多发言</button>
        )}
      </section>
    );
  } else if (tab === '今日盘面') {
    body = <TodayPanel profile={profile} update={updatePlan} open={open}
      onHint={ids => setValue(p => p && ({
        ...p, cases: p.cases.map(c => ids.includes(c.id) ? { ...c, hinted: true } : c),
      }))}/>;
  } else if (tab === '学习档案') {
    body = (
      <div className="space-y-4">
        <PracticeGuide profile={profile} open={open}/>
        <section className={panel}>
          <h2 className="font-semibold">练习记录</h2>
          <p className={muted}>
            独立初答 {profile.attempts.filter(a => !a.hinted).length} 次 ·
            看过提示 {profile.attempts.filter(a => a.hinted).length} 次 ·
            已写复盘 {profile.attempts.filter(a => a.revision).length} 次
          </p>
          {profile.attempts.map(a => (
            <button className={button + ' block w-full text-left'} key={a.caseId} onClick={() => open(a.caseId)}>
              {profile.cases.find(c => c.id === a.caseId)?.date} · {choices[a.choice]} ·
              {a.hinted ? '提示后作答' : '独立初答'} · 查看初答与反馈 →
            </button>
          ))}
          {!profile.attempts.length && <button className={button} onClick={() => setTab('历史盲练')}>开始第一堂练习</button>}
        </section>
        <h2 className="font-semibold">收盘计划与复核</h2>
        {profile.plans.map(p => <ArchivePlan key={p.date} id={id} plan={p} update={updatePlan}/>)}
        {!profile.plans.length && <p className={muted}>在今日盘面保存计划后，可在这里记录条件是否出现。</p>}
      </div>
    );
  } else {
    body = <p className={muted}>当前人物暂无可展示的资料。</p>;
  }

  return <>
    <p className={muted}>{profile.summary}</p>
    <nav aria-label="游资研习功能" className="my-4 flex flex-wrap gap-2">
      {tabs.map(t => (
        <button aria-pressed={t === tab} key={t} className={t === tab ? primary : button} onClick={() => setTab(t)}>
          {t}
        </button>
      ))}
    </nav>
    {body}
  </>;
}

const sections = [
  {key: 'insight' as SectionKey, label: '今日研判', icon: ScanLine},
  {key: 'study'   as SectionKey, label: '方法与历史', icon: BookOpen},
  {key: 'materials' as SectionKey, label: '素材管理', icon: FileStack},
] as const;

function MentorPicker({items, current, onSelect, onCreate}: {items: Mentor[]; current?: Mentor; onSelect: (id: string) => void; onCreate: (item: Mentor) => void}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const act = useAction();
  if (adding) return <form className="mentor-toolbar" onSubmit={e => {
    e.preventDefault(); if (!name.trim()) return;
    void act.run(async () => {const item = await mentorApi.create(name.trim()); setAdding(false); setName(''); onCreate(item);});
  }}>
    <input aria-label="新人物名称" autoFocus required maxLength={36} value={name} placeholder="人物名称" onChange={e => setName(e.target.value)}/>
    <button className="mentor-button is-primary" disabled={act.busy || !name.trim()}>创建</button>
    <button className="mentor-button" type="button" onClick={() => setAdding(false)} disabled={act.busy}>取消</button>{act.errorNode}
  </form>;
  return <div className="mentor-toolbar">
    {current && <label>人物 <select aria-label="选择研判人物" value={current.id} onChange={e => onSelect(e.target.value)}>
      {items.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}
    </select></label>}
    <button className="mentor-button" onClick={() => setAdding(true)}><UserPlus size={14}/>添加人物</button>
  </div>;
}

export function Distillation() {
  const { value, setValue, error, retry } = useLoad(mentorApi.list, 'all');
  const [params, setParams] = useSearchParams();
  const selected = params.get('mentor');
  const items = value?.mentors ?? [];
  const mentor = items.find(m => m.id === selected) ?? items[0];
  const date = params.get('date') ?? '';
  const view = sections.find(s => s.key === params.get('view'))?.key ?? 'insight';
  function change(updates: Record<string, string>) {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(updates)) {
        if (v) next.set(k, v); else next.delete(k);
      }
      return next;
    });
  }
  function created(item: Mentor) {
    setValue(prev => ({ mentors: [...(prev?.mentors ?? []).filter(m => m.id !== item.id), item] }));
    change({mentor: item.id, view: 'materials'});
  }

  // PageTabs label — 保持测试锚点 '游资研判视图'
  // sections[1].key === 'study' 对应 onChange('study') 测试用例
  return <div className="mentor-page">
    <PageHeader
      title="游资研判"
      actions={value && <MentorPicker items={items} current={mentor} onSelect={id => change({mentor: id})} onCreate={created}/>}
    />
    {mentor ? <>
      <PageTabs
        label="游资研判视图"
        options={[...sections]}
        value={view}
        onChange={key => change({view: key === 'insight' ? '' : key})}
      />

      {/* ── 今日研判：双栏对比 ── */}
      {view === 'insight' && (
        <div className="mentor-compare-grid">
          {/* 左栏：退学视角 */}
          <div>
            <p className="mentor-section-title flex items-center gap-1.5">
              <ScanLine size={13}/> {mentor.name}的视角
            </p>
            <MentorInsightDesk key={mentor.id + date} id={mentor.id} date={date} onDate={day => change({date: day})}/>
          </div>
          {/* 右栏：我的判断（今日盘面里的 TodayPanel 对应功能提取到这里展示） */}
          <div className="mentor-my-verdict">
            <h3><Scale size={16}/>我来验证</h3>
            <p className="text-xs text-muted-foreground mb-3">
              先看左侧退学的分析，再写下你自己的判断——对比差异是蒸馏的核心。
            </p>
            <Workspace key={mentor.id} id={mentor.id}/>
          </div>
        </div>
      )}

      {/* ── 方法与历史 ── */}
      {view === 'study' && <Workspace key={mentor.id} id={mentor.id}/>}

      {/* ── 素材管理 ── */}
      {view === 'materials' && <MentorMaterials key={mentor.id} mentor={mentor}/>}

    </> : value ? <p>添加人物后，可以导入其公开材料。</p> : <Status error={error} retry={retry}/>}
  </div>;
}
