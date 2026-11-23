import type { MacroProbability } from '../lib/api';
export function EventsStatus({data,err,loading,refreshing,staleNote,refresh}:{data:MacroProbability|null;err:string|null;loading:boolean;refreshing:boolean;staleNote:string|null;refresh:()=>void}) {
 return <div className="mt-3 text-sm text-muted-foreground">
  <button type="button" onClick={refresh} disabled={refreshing} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50">{refreshing?'刷新中…':'刷新'}</button>
  {loading && <p role="status">正在取…（这一页还没有存档）</p>}
  {err && <p role="alert" className="text-destructive">{err}</p>}
  {staleNote && <p className="text-warning">{staleNote}</p>}
  {data && <><p>共 {data.items.length} 份合约 · 更新于 {data.updated}{data.partial && <span className="text-warning"> · 部分源没取到，覆盖不完整</span>}</p>
   {!data.items.length && <p>{data.partial ? '本次没有取得合约，覆盖不完整，不能确定没有相关事件。' : '本次查询没有符合条件的合约。'}</p>}</>}
 </div>;
}
