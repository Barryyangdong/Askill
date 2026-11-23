import { ServiceError } from '../service.ts';

const sourceUrl = 'https://www.tgb.cn/spmatch/index/';
const maxBytes = 2_000_000;
type CatalogRow = {matchId: string; name: string; url: string; players: number | null; organizer: string | null};
type Catalog = {sourceUrl: string; fetchedAt: string; rows: CatalogRow[]};
let cached: Catalog | undefined;

// The public landing page contains other tables as well. Bind to the column names and the match link.
function label(cell: string) {
  return cell.replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim();
}
export function parsePlayerCatalog(html: string): CatalogRow[] {
  const result = new Map<string,CatalogRow>();
  for (const [table] of html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
    const headings = Array.from(table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi),m=>label(m[1]!));
    const title = headings.indexOf('比赛名称'), players = headings.indexOf('选手数'), organizer = headings.indexOf('主办方');
    if (title < 0 || players < 0) continue;
    for (const [row] of table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
      const cells = Array.from(row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi),m=>m[1]!);
      const cell = cells[title] ?? '';
      const match = /<a\b[^>]*?\shref\s*=\s*["'](?:https:\/\/www\.tgb\.cn)?\/spmatch\/matchAll\?tid=([A-Za-z0-9]+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(cell);
      if (!match) continue;
      const id = match[1]!, name = label(match[2]!), count = label(cells[players] ?? '').replace(/,/g,'');
      if (name) result.set(id,{matchId:id,name,url:`https://www.tgb.cn/spmatch/matchAll?tid=${id}`,players:/^\d+$/.test(count)?Number(count):null,organizer:label(cells[organizer] ?? '') || null});
    }
  }
  return Array.from(result.values());
}
export async function readPublicTgbPage(url:string,signal:AbortSignal) {
    const res = await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(12000)]),redirect:'error',credentials:'omit'});
    if (!res.ok || !res.body) throw new Error('unavailable');
    const reader = res.body.getReader(), chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error('page too large'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
}
export async function getPlayerCatalog(signal: AbortSignal): Promise<Catalog> {
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 300_000) return cached;
  try {
    const rows = parsePlayerCatalog(await readPublicTgbPage(sourceUrl,signal));
    if (!rows.length) throw new Error('unrecognized directory');
    cached = {sourceUrl,fetchedAt:new Date().toISOString(),rows};
    return cached;
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ServiceError('source_unavailable','暂时无法读取淘股吧公开赛事目录，可打开官网查看。');
  }
}
