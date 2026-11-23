import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, BookOpen, FilePlus2 } from 'lucide-react';
import { mentorApi, type MaterialKind, type Mentor, type MentorMaterials as Materials } from '@/lib/distillation';

const kindLabel: Record<MaterialKind, string> = {statement: '公开文章 / 发言', interview: '访谈 / 对话', trades: '公开交割单'};
const message = (error: unknown) => error instanceof Error ? error.message : '读取失败，请重试。';
const materialLimit = 60_000;

export function decodePublicMaterial(bytes: Uint8Array) {
  let result: string;
  const utf16 = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : null;
  try { result = new TextDecoder(utf16 ?? 'utf-8', {fatal: true}).decode(bytes); }
  catch { result = new TextDecoder('gb18030', {fatal: true}).decode(bytes); }
  if (result.includes('\0')) throw new Error('请选择文本格式的发言或成交表格。');
  if (result.length > materialLimit) throw new Error('原文超过 6 万字符，请按材料分段导入。');
  return result;
}

export function MaterialHistory({data}: {data: Materials}) {
  return <section className="mentor-card"><h3><BookOpen size={17}/>材料版本</h3>
    {data.materials.length ? [...data.materials].sort((a, b) => b.version - a.version).map(row => <details className="mentor-disclosure" key={row.id + ':' + row.version}>
      <summary><span>v{row.version} · {row.title}</span> <small>{kindLabel[row.kind]}</small></summary>
      <div className="mentor-material-info"><small>公开时间 {new Date(row.publishedAt).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false})}（北京时间） · {row.previousVersion ? '修订自 v' + row.previousVersion : '首次收录'}</small>
      {/^https?:\/\//i.test(row.sourceUrl) && <a href={row.sourceUrl} rel="noreferrer" target="_blank">查看原始来源 <ArrowUpRight size={13}/></a>}</div>
      {row.previousVersion ? <details className="mentor-disclosure"><summary>版本变化 · 新增 {row.added.length} 条，移除 {row.removed.length} 条</summary>
        <ul>{row.added.map(t => <li key={'+'+t}>新增 · {t}</li>)}{row.removed.map(t => <li key={'-'+t}>移除 · {t}</li>)}</ul></details>
        : <p className="mentor-note">首次提取 {row.evidence.length} 条证据。</p>}
      {row.evidence.map(entry => <div className="mentor-source-detail" key={entry.id}>
        <strong>{entry.summary}</strong>{entry.excerpt && entry.excerpt !== entry.summary && <p>{entry.excerpt}</p>}</div>)}
    </details>) : <p className="mentor-note">尚未导入补充材料。</p>}
  </section>;
}

export function MentorMaterials({mentor}: {mentor: Mentor}) {
  const [data, setData] = useState<Materials>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<MaterialKind>('statement');
  const [draft, setDraft] = useState('');
  const [reading, setReading] = useState(false);
  const fileVersion = useRef(0);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let current = true; setError('');
    mentorApi.materials(mentor.id).then(result => {
      if (current) setData(previous => previous && previous.version > result.version ? previous : result);
    }, err => {if (current) setError(message(err));});
    return () => { current = false; };
  }, [mentor.id, retry]);
  async function readFile(file?: File) {
    if (!file) return;
    const revision = ++fileVersion.current;
    setReading(true); setError(''); setNotice('');
    try {
      if (!(kind === 'trades' ? /\.(csv|tsv)$/i : /\.(txt|md)$/i).test(file.name)) {
        throw new Error(kind === 'trades' ? '请选择 CSV 或 TSV 成交表格。' : '请选择 TXT 或 Markdown 原文。');
      }
      if (file.size > materialLimit * 4 + 4) throw new Error('文件超过可读取的文本上限，请分段导入。');
      const text = decodePublicMaterial(new Uint8Array(await file.arrayBuffer()));
      if (revision === fileVersion.current) {setDraft(text); setNotice('已载入「' + file.name + '」，请核对原文后导入。');}
    } catch(err) { if (revision === fileVersion.current) setError(message(err)); }
    finally { if (revision === fileVersion.current) setReading(false); }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || reading) return;
    const form = e.currentTarget;
    const values = new FormData(form);
    const input = (key: string) => String(values.get(key) ?? '').trim();
    const title = input('title');
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await mentorApi.importMaterial(mentor.id, {
        kind, title, sourceUrl: input('sourceUrl'), publishedAt: input('publishedAt') + (input('publishedTime') ? 'T' + input('publishedTime') : ''),
        text: input('text'), publicSource: values.has('publicSource'),
      });
      setData(result); form.reset(); setKind('statement'); setDraft('');
      setNotice('已收录《' + title + '》，当前材料版本 v' + result.version + '。');
    } catch(err) { setError(message(err)); } finally { setBusy(false); }
  }
  return <div className="mentor-material-grid">
    <section className="mentor-card"><h3><FilePlus2 size={17}/>为{mentor.name}补充材料</h3>
      <form onSubmit={e => void submit(e)}>
        <fieldset className="mentor-material-form" disabled={busy}>
        <div className="mentor-form-row"><label>材料类型<select disabled={busy || reading} value={kind} onChange={e => setKind(e.target.value as MaterialKind)}>
          {Object.entries(kindLabel).map(([value, name]) => <option value={value} key={value}>{name}</option>)}
        </select></label><label>公开日期<input required name="publishedAt" type="date"/></label></div>
        <label>公开时刻（选填，北京时间）<input name="publishedTime" type="time"/></label>
        <label>标题<input name="title" required maxLength={160}/></label>
        <label>公开出处<input name="sourceUrl" type="url" required placeholder="https://…"/></label>
        <label>{kind === 'trades' ? '公开成交记录' : '原文摘录'}
          <textarea name="text" rows={6} required maxLength={materialLimit} disabled={reading} value={draft} onChange={e => setDraft(e.target.value)}
            placeholder={kind === 'trades' ? '日期,股票代码,方向\n2017-05-02,000001,买入' : '粘贴人物原话或已公开的访谈片段'}/>
        </label>
        <label>从本机文件载入原文<input type="file" key={kind} accept={kind === 'trades' ? '.csv,.tsv' : '.txt,.md'} disabled={busy || reading}
          onChange={e => {const file = e.target.files?.[0]; e.target.value = ''; void readFile(file);}}/></label>
        <label className="mentor-confirm"><input name="publicSource" type="checkbox" required/>这是该人物已公开的资料</label>
        <div><button className="mentor-button is-primary" disabled={busy || reading}>{busy ? '正在核对…' : reading ? '正在载入…' : '导入并记录版本'}</button></div>
        </fieldset>
      </form>{notice && <p role="status" className="mentor-success">{notice}</p>}
      {error && <p className="mentor-error" role="alert">{error} {!data && <button className="mentor-button" onClick={() => setRetry(n => n + 1)}>重试</button>}</p>}
    </section>
    {data ? <MaterialHistory data={data}/> : !error && <p role="status" className="mentor-note">正在读取材料版本…</p>}
  </div>;
}
