import { profileId } from './playerEnrollment.ts';
import { readPlayerTable } from './playerTable.ts';

type ClipboardCell = { text: string; links: string[] };
const idHeading = /^(?:选手\s*ID|用户\s*ID|ID)$/i;

function linkedIdentity(href: string) {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  const profile = profileId(url.href);
  if (profile) return { id: profile, seq: null };
  if (url.protocol !== 'https:' || !['www.tgb.cn','tgb.cn','m.tgb.cn'].includes(url.hostname) || url.port || url.username || url.password) return null;
  if (url.pathname !== '/spmatch/gains/readInfo') return null;
  const ids = url.searchParams.getAll('lookeUserID');
  const sequences = url.searchParams.getAll('spmatchSeq');
  if (ids.length !== 1 || sequences.length !== 1 || !/^\d{1,16}$/.test(ids[0]!) || !/^\d{1,16}$/.test(sequences[0]!)) {
    throw new Error('战绩链接缺少唯一选手或赛事序号，请重新复制官网榜单。');
  }
  return { id: ids[0]!, seq: sequences[0]! };
}

/** Join only a single unambiguous player to each row. Plain text imports can still supply their own ID column. */
export function linkedPlayerTable(grid: ClipboardCell[][], expectedSeq: string | undefined, plain: string) {
  if (grid.length < 2) return null;
  const sequences = new Set<string>();
  const rows = grid.slice(1).map((cells,index)=>{
    const ids = new Set<string>();
    for (const cell of cells) for (const href of cell.links) {
      const linked = linkedIdentity(href);
      if (!linked) continue;
      ids.add(linked.id);
      if (linked.seq) sequences.add(linked.seq);
    }
    if (ids.size>1) throw new Error(`第 ${index+2} 行包含多位选手的链接，请只复制选手榜单。`);
    return {id:[...ids][0]};
  });
  if (!rows.some(row=>row.id)) return null;
  if (sequences.size>1 || (expectedSeq && sequences.size && !sequences.has(expectedSeq))) throw new Error('战绩链接的赛事序号与当前赛场不一致，请重新复制同一场比赛的榜单。');
  // CSS on the original page can hide text without leaving a hidden attribute in the copied HTML.
  // Read values from the clipboard's visible text and enrich only on exact row/column alignment.
  let visible: ReturnType<typeof readPlayerTable>;
  try { visible = readPlayerTable(plain); } catch { return null; }
  const visibleGrid = [visible.columns, ...visible.rows];
  const normalized = (text: string) => text.replace(/\s+/g, ' ').trim();
  if (visibleGrid.length !== grid.length || grid.some((row, i) => {
    const text = visibleGrid[i]!;
    return text.length !== row.length || row.some((cell, j) => normalized(cell.text) !== normalized(text[j]!));
  })) return null;
  const columns = visible.columns;
  const idColumns = columns.flatMap((label,i)=>idHeading.test(label)?[i]:[]);
  if (idColumns.length>1) throw new Error('表头包含多个 ID 列，请保留选手 ID 和选手名。');
  const idIndex = idColumns[0] ?? columns.length;
  if (idIndex===columns.length) columns.push('选手 ID');
  else columns[idIndex]='选手 ID';
  const lines = rows.map(({id},index)=>{
    const cells = visible.rows[index]!;
    if (cells[idIndex] && id && cells[idIndex]!==id) throw new Error(`第 ${index+2} 行的 ID 与选手链接不符。`);
    if (!cells[idIndex] && !id) throw new Error(`第 ${index+2} 行缺少可核对的选手 ID，复制时请保留个人主页或战绩链接。`);
    cells[idIndex]=id ?? cells[idIndex]!;
    return cells.join('\t');
  });
  const raw = [columns.join('\t'),...lines].join('\n');
  return { raw, table: readPlayerTable(raw), sourceSpmatchSeq: sequences.values().next().value };
}

export function readPlayerClipboard(html: string, expectedSeq: string | undefined, plain: string) {
  if (!html) return null;
  if (html.length>8_000_000) throw new Error('网页表格过大，请按赛组和日期复制。');
  // Template contents have an inert owner document. They are never attached to the page.
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const node of template.content.querySelectorAll('script,style,iframe,object,embed,svg,template,[hidden],[aria-hidden="true"]')) node.remove();
  for (const node of template.content.querySelectorAll<HTMLElement>('[style]')) {
    if (node.style.display === 'none' || ['hidden','collapse'].includes(node.style.visibility)) node.remove();
  }
  const tables = template.content.querySelectorAll('table');
  if (!tables.length) return null;
  if (tables.length!==1) throw new Error('请一次只复制一张榜单，避免混入其他赛组或日期。');
  const table = tables[0]!;
  const grid = Array.from(table.rows,row=>Array.from(row.cells,cell=>({
    text:(cell.textContent ?? '').replace(/\s+/g,' ').trim(),
    links:Array.from(cell.querySelectorAll('a[href]'),a=>a.getAttribute('href')!),
  })));
  return linkedPlayerTable(grid, expectedSeq, plain);
}
