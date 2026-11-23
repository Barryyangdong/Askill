import { useEffect, useRef, useState } from 'react';
import { backend } from '../lib/backend';

type Catalog = {fetchedAt:string; rows:{matchId:string; name:string; organizer:string|null; players:number|null; url:string}[]};

export function PlayerPublicCatalog() {
  const [catalog,setCatalog] = useState<Catalog>();
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  async function load() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError('');
    try {
      const value = await backend.playerAnalysis<Catalog>(new URLSearchParams({mode:'catalog'}),controller.signal);
      if (!controller.signal.aborted) setCatalog(value);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '目录读取失败');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }
  return <div className="space-y-2 text-xs">
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-50" disabled={loading} onClick={load}>
        {loading ? '正在读取赛事目录…' : catalog ? '刷新公开赛事目录' : '读取公开赛事目录'}
      </button>
      <a className="text-primary hover:underline" href="https://www.tgb.cn/spmatch/index/" target="_blank" rel="noreferrer">全部比赛 ↗</a>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {catalog && <div className="overflow-x-auto"><table className="w-full text-left tabular-nums">
      <caption className="py-1 text-left text-muted-foreground">淘股吧首页公开赛事 · {new Date(catalog.fetchedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} 读取</caption>
      <thead className="text-muted-foreground"><tr>{['比赛','赛事标识','主办方','参赛人数'].map(label=><th className="p-2 font-medium" key={label}>{label}</th>)}</tr></thead>
      <tbody>{catalog.rows.map(row=><tr key={row.matchId} className="border-t border-border">
        <td className="p-2"><a className="text-primary hover:underline" href={row.url} target="_blank" rel="noreferrer">{row.name} ↗</a></td>
        <td className="p-2">{row.matchId}</td><td className="p-2">{row.organizer ?? '—'}</td><td className="p-2">{row.players ?? '—'}</td>
      </tr>)}</tbody>
    </table></div>}
  </div>;
}
