import { useState } from "react";
import { mentorApi, type Example, type Lesson, type Method, type Profile, type Today } from "@/lib/distillation";

const panel = "space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5";
const sub = "text-sm leading-6 text-muted-foreground";
const button = "rounded border border-border bg-background px-3 py-2 text-sm hover:border-primary disabled:opacity-50";

export function HistoricalScene({ lesson }: { lesson: Lesson }) {
  const { scene, market } = lesson;
  const pct = market?.pct;
  const week = market?.d5;
  const trend = (v: number) => v > 0 ? "上涨" : v < 0 ? "下跌" : "持平";
  const metric = (key: string) => scene?.metrics.find(m => m.key === key)?.value;
  const up = metric("up"), down = metric("dn"), median = metric("med");
  const nearUp = metric("zt"), nearDown = metric("dt"), premium = metric("premium");
  const ladder = ["ladder1", "ladder2", "ladder3", "ladder4"].map(metric);
  const groupFor = (key: string) => {
    if (/^ladder|^maxHeight$/.test(key)) return "接力梯队";
    if (["zt","dt","premium","premiumN","big_up","big_dn"].includes(key)) return "强弱反馈";
    return "市场广度";
  };
  return <section className="space-y-3" aria-label="还原收盘现场">
    <h3 className="font-semibold">当时能看到什么</h3>
    {pct != null && week != null && <p className="text-sm">当日上证{trend(pct)}，近五日累计{trend(week)}。</p>}
    {scene && <p className="text-xs text-muted-foreground">历史数据截至 {scene.asOf}</p>}
    {scene?.metrics.length ? <div className="grid items-start gap-3 md:grid-cols-3">
      {["市场广度","强弱反馈","接力梯队"].map(group => {
        const metrics = scene.metrics.filter(m => groupFor(m.key) === group);
        if (!metrics.length) return null;
        return <article key={group} className="rounded border border-border p-3">
          <h4 className="mb-2 font-semibold">{group}</h4>
          {group === "市场广度" && <div className="space-y-1 text-sm">
            {up != null && down != null && <p>上涨 {up} 家，下跌 {down} 家。</p>}
            {median != null && <p>涨跌幅中位数 {median}%。</p>}
          </div>}
          {group === "强弱反馈" && <div className="space-y-1 text-sm">
            {nearUp != null && nearDown != null && <p>收盘近涨停 {nearUp} 家，近跌停 {nearDown} 家。</p>}
            {premium != null && <p>昨日近涨停组今日均值 {premium}%（样本 {metric("premiumN") ?? "未记载"}）。</p>}
          </div>}
          {group === "接力梯队" && ladder.every(n => n != null) && <div className="space-y-2">
            {ladder.map((n,i) => {
              const members = metrics.find(m => m.key === "ladder" + (i + 1))?.members;
              return <div key={i} className="space-y-1 text-xs"><div className="flex items-center gap-2">
              <span className="w-12">{["一板","二板","三板","四板以上"][i]}</span>
              <div aria-hidden="true" className="h-2 flex-1 overflow-hidden rounded bg-muted">
                <div className="h-full bg-primary" style={{width: (100 * n / Math.max(1,...ladder)) + "%"}}/>
              </div><span className="w-9 text-right tabular-nums">{n} 家</span>
              </div>
                {!!members?.length && <p className="text-xs text-muted-foreground">代表代码 · {members.join("、")}</p>}
              </div>;
            })}
            <p className="text-xs text-muted-foreground">按连续收盘近涨停估算</p>
          </div>}
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer text-primary">指标口径与来源</summary>
            <dl>{metrics.map(m => <div key={m.key} className="mt-2 border-t border-border pt-2">
              <dt className="font-semibold">{m.label} · {m.value}{m.unit}</dt><dd>{m.definition}</dd><dd>{m.source}</dd>
            </div>)}</dl>
          </details>
        </article>;
      })}
    </div> : <p className={sub}>此案例仅提供指数与账户概况，市场情绪、连板和板块强弱缺少同期证据。</p>}
    <div className="rounded border-l-2 border-primary bg-muted/30 p-3">
      <h4 className="text-sm font-medium">判断之前，先核对两件事</h4>
      <ol className="ml-5 mt-1 list-decimal space-y-1 text-sm">
        <li>{up != null && down != null && pct != null
          ? "上证指数的方向与多数个股一致吗？用上涨、下跌家数解释你看到的赚钱效应。"
          : "指数当日和近五日的方向是否一致？只凭指数还有哪些问题判断不了？"}</li>
        <li>{premium != null && median != null
          ? "昨日强势股今天的平均涨跌幅，与全样本的涨跌幅中位数相比如何？这种差异会改变你的新开仓条件吗？"
          : "现有仓位占用了多少空间？新增标的前，你还要看到哪条可核对的条件？"}</li>
      </ol>
    </div>
    {!!scene?.missing.length && <div className="rounded bg-muted/40 p-3">
      <h4 className="text-sm font-medium">现有史料未覆盖</h4>
      <ul className="mt-1 space-y-1 text-sm">{scene.missing.map(x => <li key={x.label}>{x.label} · {x.reason}</li>)}</ul>
    </div>}
  </section>;
}

export function ShortlineScene({ today }: { today: Today }) {
  return <section className="space-y-3">
    <h3 className="font-semibold">短线市场现场</h3>
    {today.shortline ? <>
      <p className={sub}>{today.shortline.date} 收盘 · 分项核对情绪、接力和板块</p>
      <div className="grid items-start gap-3 md:grid-cols-3">{today.shortline.groups.map(g =>
        <article key={g.title} className="rounded border border-border p-3">
          <h4 className="font-medium">{g.title}</h4>
          <dl className="my-2 space-y-2 text-sm">{g.rows.map((r, i) =>
            <div key={i}><dt className="text-xs text-muted-foreground">{r.label}</dt><dd>{r.value}</dd></div>)}</dl>
          {g.gap && <p className={sub}>数据缺口 · {g.gap}</p>}
          <p className="mt-2 text-xs text-muted-foreground">{g.source}</p>
        </article>)}</div>
    </> : <p className={sub}>本次尚未取得可核对的情绪、连板与主线题材数据。</p>}
    <p className={sub}>历史匹配使用可核对的同口径指标。今日板块和个股的强弱仅用于观察，无法据此还原历史关注名单。</p>
  </section>;
}

function ExampleReview({ example }: { example: Example }) {
  return <div className="space-y-2 rounded bg-muted/40 p-3 text-sm">
    <strong>{example.date} · {example.role === "support" ? "支持案例" : "边界与反例"}</strong>
    <p>实盘记录 · {example.reveal.summary}</p>
    <p>方法解读 · {example.note}</p>
    <details className={sub}>
      <summary>核对原始记录</summary>
      {example.reveal.sources.map((source, i) => <p key={i}>{source}</p>)}
      {example.reveal.sourcePosts?.filter(p => /^https?:\/\//i.test(p.url)).map(p =>
        <a key={p.url} className="mr-3 text-primary underline" href={p.url} target="_blank" rel="noreferrer">{p.title}</a>)}
    </details>
  </div>;
}

export function MethodExamples({ profileId, method, cases, onHint, practice }: {
  profileId: string; method: Method; cases: Lesson[]; onHint: (id: string) => void;
  practice?: (id: string) => void;
}) {
  const [example, setExample] = useState<Example>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function show(caseId: string) {
    setBusy(true); setError("");
    try {
      const result = await mentorApi.example(profileId, method.id, caseId);
      method.exampleIds.forEach(onHint); setExample(result);
    } catch (e) { setError(e instanceof Error ? e.message : "读取案例失败，请重试。"); }
    finally { setBusy(false); }
  }
  const linked = cases.filter(c => method.exampleIds.includes(c.id));
  return <div className="space-y-2">
    {practice && <p className={sub}>先盲练可保留独立初答；直接看解读会将该方法的配对题标为已提示。</p>}
    {linked.map(c => <div key={c.id} className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
      <span className="mr-auto text-sm">{c.date} 收盘{c.hinted && " · 已看对照"}</span>
      {practice && <button className={button} onClick={() => practice(c.id)}>练习这个现场</button>}
      <button className={button} disabled={busy} onClick={() => void show(c.id)}>查看实盘与方法解读</button>
    </div>)}
    {error && <p role="alert" className="text-sm text-warning">{error}</p>}
    {example && <ExampleReview example={example}/>}
  </div>;
}

export function MethodsPanel({ profile, practice, onHint }: {
  profile: Profile; practice: (caseId: string, methodId: string) => void; onHint: (id: string) => void;
}) {
  const methods = profile.methods ?? [];
  const [selected, select] = useState(methods[0]?.id);
  const method = methods.find(x => x.id === selected) ?? methods[0];
  if (!method) return null;
  const quote = profile.quotes.find(q => q.date === method.quoteDate);
  const behavior = profile.behavior;
  return <div className="space-y-4">
    {behavior && <section className={panel}>
      <h2 className="text-lg font-semibold">{behavior.title}</h2>
      <p className={sub}>{behavior.scope}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th className="pb-2">观察维度</th>
            <th className="px-2 pb-2">新开仓标的</th><th className="pb-2">同时点对照</th></tr></thead>
          <tbody>{behavior.metrics.map(m => <tr key={m.label} className="border-t border-border">
            <th className="py-2 font-medium">{m.label}</th><td className="px-2">{m.value}</td><td>{m.comparison}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="text-sm">{behavior.interpretation}</p>
      <details className={sub}><summary>计算与来源</summary>{behavior.source}</details>
    </section>}
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(180px,250px)_1fr]">
    <aside className={panel}><h2 className="font-semibold">从一个交易问题开始</h2>
      {methods.map(m => <button key={m.id} aria-pressed={m.id === method.id}
        className={button + (m.id === method.id ? " w-full text-left font-semibold text-primary" : " w-full text-left")}
        onClick={() => select(m.id)}>{m.title}</button>)}
    </aside>
    <article className={panel}>
      <h2 className="text-lg font-semibold">{method.title}</h2>
      <h3 className="text-sm font-semibold">他在讨论什么</h3>
      {quote && <blockquote className="space-y-2 border-l-2 border-primary pl-3 text-sm">
        <p>{quote.text}</p>
        <footer className={sub}>{quote.date} · {/^https?:\/\//i.test(quote.url)
          ? <a className="text-primary underline" href={quote.url} target="_blank" rel="noreferrer">{quote.source}</a>
          : quote.source}</footer>
      </blockquote>}
      {method.pairedEvidence && <section className="rounded bg-muted/40 p-3">
        <h3 className="text-sm font-semibold">同日持仓与原话对照</h3>
        <p className="mt-1 text-sm">{method.pairedEvidence.date} · {method.pairedEvidence.stock}</p>
        <p className={sub}>{method.pairedEvidence.note}</p>
        <details className="mt-1 text-xs text-muted-foreground"><summary>查看原始截图定位</summary>{method.pairedEvidence.source}</details>
      </section>}
      <h3 className="text-sm font-semibold">结合实盘提炼的方法</h3><p className="text-sm">{method.principle}</p>
      <dl className="space-y-2 text-sm"><div><dt className="font-medium">什么时候观察</dt><dd>{method.trigger}</dd></div>
        <div><dt className="font-medium">应用边界</dt><dd>{method.limits}</dd></div></dl>
      {method.testResult && <div className="rounded border border-border p-3">
        <h3 className="text-sm font-semibold">这项条件在实盘样本中是否成立</h3>
        <dl className="mt-2 grid grid-cols-4 gap-2 text-sm">
          {([["覆盖",method.testResult.total],["可核定",method.testResult.known],
            ["支持",method.testResult.support],["反例",method.testResult.counter]] as const).map(([label,count]) =>
            <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd>{count} 日</dd></div>)}
        </dl>
      </div>}
      <h3 className="font-semibold">用历史交易核对</h3>
      <MethodExamples key={method.id} profileId={profile.id} method={method} cases={profile.cases}
        onHint={onHint} practice={caseId => practice(caseId, method.id)}/>
    </article>
    </div>
  </div>;
}





