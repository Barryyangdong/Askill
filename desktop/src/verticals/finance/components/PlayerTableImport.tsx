import { useState } from 'react';
import { playerTablePayload, readPlayerTable, tableFields, type TableMapping, type TableMeta } from '../lib/playerTable';
import { readPlayerClipboard } from '../lib/playerClipboard';
import { combinePlayerPages, type PlayerTablePage } from '../lib/playerTablePages';
import type { EnrolledMatch } from '../lib/playerEnrollment';

const inputClass = 'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm';
const emptyMeta: TableMeta = {matchId:'', matchName:'', divisionId:'', divisionName:'', date:'', previousTradeDate:'', rankComplete:false};
const labels = [
  ['matchName','比赛名称'], ['matchId','比赛标识'], ['divisionName','赛组名称'], ['divisionId','赛组标识'],
  ['date','交易日'], ['previousTradeDate','上一赛事交易日（可选）'],
] as const;

export function PlayerTableImport({onPreview,busy,match}: {match:EnrolledMatch;onPreview:(payload:Record<string,unknown>)=>Promise<unknown>|void; busy:boolean}) {
  const [raw,setRaw] = useState('');
  const [table,setTable] = useState<ReturnType<typeof readPlayerTable>>();
  const [mapping,setMapping] = useState<TableMapping>({});
  const [meta,setMeta] = useState({...emptyMeta,matchId:match.matchId,matchName:match.name});
  const [error,setError] = useState('');
  const [staged,setStaged] = useState<PlayerTablePage | null>(null);
  const [stagedMaskedRank,setStagedMaskedRank] = useState(false);
  const [stagedSequence,setStagedSequence] = useState<string>();
  const [pageSequence,setPageSequence] = useState<string>();
  const [lastColumns,setLastColumns] = useState<string[]>([]);
  function setColumns(parsed:ReturnType<typeof readPlayerTable>) {
      if (staged && parsed.columns.length === lastColumns.length && parsed.columns.every((c,i)=>c===lastColumns[i])) {
        setTable(parsed); return;
      }
      const fields: TableMapping = {};
      for (const [key,label] of tableFields) {
        const index = parsed.columns.findIndex(column => column === label || column === key);
        if (index >= 0) fields[key] = index;
      }
      setMapping(fields); setTable(parsed); setLastColumns(parsed.columns);
  }
  function readColumns() {
    setError('');
    try {
      setColumns(readPlayerTable(raw));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function collect(savePage: boolean) {
    setError('');
    try {
      if (raw.trim() && !table) throw new Error('请先识别当前页的表头。');
      if (!savePage && meta.rankComplete && stagedMaskedRank) throw new Error('已暂存页含遮挡排名，请取消勾选完整榜单。');
      const batch = table ? combinePlayerPages(staged,playerTablePayload(table,mapping,{...meta,rankComplete:!savePage && meta.rankComplete})) : staged;
      if (!batch) return;
      if (savePage && table) {
        const masked = table.rows.some(row=>/^[*＊★]+$/.test(row[mapping.rank ?? -1] ?? ''));
        setStagedMaskedRank(stagedMaskedRank || masked);
        setStagedSequence(stagedSequence ?? pageSequence); setPageSequence(undefined);
        setStaged({...batch,rankComplete:false}); setRaw(''); setTable(undefined); setMeta({...meta,rankComplete:false});
      } else if (!savePage) await onPreview({...batch,rankComplete:meta.rankComplete});
    }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  return <details className="mt-3 rounded-md border border-border p-3 text-sm">
    <summary className="cursor-pointer font-medium">从表格粘贴</summary>
    <p className="my-2 text-xs text-muted-foreground">复制同一赛组、同一交易日的表格并保留表头。官网主页或战绩链接可用于识别选手 ID，纯文本需含 ID 列。收益与仓位按百分数填写，25 或 25% 都表示 25%。</p>
    <textarea className={inputClass} aria-label="赛事表格" rows={4} value={raw}
      onPaste={e=>{
        try {
          const source=readPlayerClipboard(e.clipboardData.getData('text/html'),match.spmatchSeq ?? stagedSequence,e.clipboardData.getData('text/plain'));
          if (!source) return;
          e.preventDefault();setPageSequence(source.sourceSpmatchSeq);setRaw(source.raw);setError('');setColumns(source.table);
        } catch (err) {
          e.preventDefault();setRaw('');setPageSequence(undefined);setTable(undefined);setError(err instanceof Error?err.message:String(err));
        }
      }}
      onChange={e=>{setRaw(e.target.value);setPageSequence(undefined);setTable(undefined);setError('');}}
      placeholder="在这里粘贴用制表符分列的表格"/>
    <button type="button" disabled={!raw.trim() || busy} className="mt-1 text-primary disabled:opacity-40" onClick={readColumns}>识别表头</button>
    {staged && <div role="status" className="mt-2 flex flex-wrap items-center gap-3 text-xs"><span>{staged.divisionName} · {staged.date} · 已暂存 {staged.players.length} 名选手，可继续粘贴下一页。</span>
      <button type="button" disabled={busy} className="text-primary" onClick={()=>{setStaged(null);setStagedSequence(undefined);setStagedMaskedRank(false);setMeta({...meta,rankComplete:false});}}>清空暂存</button></div>}
    {(staged || table) && <div className="mt-3 space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">{labels.map(([key,label])=><label key={key} className="text-xs">{label}
        <input readOnly={Boolean(staged)||key==="matchId"||key==="matchName"} className={inputClass} type={key === 'date' || key === 'previousTradeDate' ? 'date':'text'} value={meta[key]}
          onChange={e=>setMeta({...meta,[key]:e.target.value})}/></label>)}</div>
      {table && <><p className="text-xs text-muted-foreground">本页已识别 {table.rows.length} 行。请核对各列，缺少的信息保留“未提供”。</p>
      <div className="grid gap-2 sm:grid-cols-3">{tableFields.map(([key,label])=><label key={key} className="text-xs">{label}
        <select className={inputClass} value={mapping[key] ?? ''} onChange={e=>{
          const next = {...mapping}; if (e.target.value === '') delete next[key]; else next[key] = Number(e.target.value); setMapping(next);
        }}><option value="">未提供</option>{table.columns.map((column,index)=><option key={index} value={index}>{column || `列 ${index + 1}`}</option>)}</select></label>)}</div></>}
      <p className="text-xs text-muted-foreground">报单状态支持实报、请假沿用、停牌沿用、未报、退赛、未知。持仓可标完整、空仓、部分、未知。星号按遮挡处理；只导入部分代码时，保留可见记录。请按页面对应的历史交易日填写。</p>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={meta.rankComplete}
        onChange={e=>setMeta({...meta,rankComplete:e.target.checked})}/>我已核对本次导入包含该赛组完整的累计收益榜</label>
      <div className="flex items-center gap-3">
        {table && <button type="button" className="text-primary disabled:opacity-40" disabled={busy} onClick={()=>void collect(true)}>暂存并添加下一页</button>}
        <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-40" disabled={busy || (!table && Boolean(raw.trim()))} onClick={()=>void collect(false)}>预览这批选手</button>
      </div>
    </div>}
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
  </details>;
}
