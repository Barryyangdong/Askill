// Column names here describe the local import format. The user maps the columns of their source table.
export const tableFields = [
  ['id', '选手 ID'], ['name', '选手名'], ['rank', '累计排名'], ['state', '报单状态'],
  ['dayReturn', '当日收益率'], ['totalReturn', '累计收益率'], ['exposure', '总仓位'],
  ['holdingsState', '持仓完整性'], ['symbols', '持仓代码'],
] as const;
export type TableField = typeof tableFields[number][0];
export type TableMapping = Partial<Record<TableField, number>>;
export interface TableMeta {
  matchId: string; matchName: string; divisionId: string; divisionName: string;
  date: string; previousTradeDate: string; rankComplete: boolean;
}

export function readPlayerTable(raw: string) {
  if (raw.length > 3_000_000) throw new Error('表格超过 300 万字符，请按赛组或交易日拆分。');
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) throw new Error('请复制带表头和至少一位选手的表格。');
  const columns = lines[0]!.split('\t').map(x => x.trim());
  if (columns.length < 2) throw new Error('请从电子表格复制多列，列之间应为制表符。');
  const rows = lines.slice(1).map((line, i) => {
    const cells = line.split('\t').map(x => x.trim());
    if (cells.length !== columns.length) throw new Error(`第 ${i + 2} 行与表头列数不一致。`);
    return cells;
  });
  return { columns, rows };
}

const states: Record<string, string> = {
  '已报': 'reported', '实报': 'reported', '请假沿用': 'leave', '停牌沿用': 'suspended',
  '缺报': 'missing', '未报': 'missing', '退赛': 'withdrawn', '未知': 'unknown',
};
const completeness: Record<string, string> = {
  '完整': 'complete', '明确空仓': 'empty', '空仓': 'empty', '部分': 'partial', '遮挡': 'partial', '未知': 'unknown',
};
function status(raw: string, values: Record<string,string>, field: string) {
  if (!raw || raw === '—' || raw === '--') return 'unknown';
  if (Object.hasOwn(values, raw)) return values[raw]!;
  if (Object.values(values).includes(raw)) return raw;
  throw new Error(`${field}“${raw}”无法识别，请核对表格或将此列设为未提供。`);
}
function percentage(raw: string) {
  if (!raw || ['--','—','未知'].includes(raw) || isMask(raw)) return null;
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*[%％]?$/.test(raw)) throw new Error(`“${raw}”不是百分数。`);
  return Number(raw.replace(/[%％]/, '')) / 100;
}
const isMask = (value:string) => /^[*＊★]+$/.test(value);
export function playerTablePayload(table: ReturnType<typeof readPlayerTable>, fields: TableMapping, meta: TableMeta) {
  if (!meta.matchId.trim() || !meta.matchName.trim() || !meta.divisionId.trim() || !meta.divisionName.trim() || !meta.date)
    throw new Error('请填写比赛、赛组标识及名称和交易日，跨日导入沿用相同标识。');
  if (fields.id == null || fields.name == null) throw new Error('请选择跨日稳定的选手 ID 列和选手名列。');
  const selected = Object.values(fields);
  if (new Set(selected).size !== selected.length) throw new Error('同一列不能映射到多个字段。');
  const players = table.rows.map((row, i) => {
    const cell = (key: TableField) => row[fields[key] ?? -1] ?? '';
    try {
      const id = cell('id'), name = cell('name'), rank = cell('rank');
      if (!id || !name) throw new Error('缺少选手 ID 或名称。');
      const rankMissing = !rank || ['--','—'].includes(rank) || isMask(rank);
      const state = status(cell('state'), states, '报单状态');
      if (meta.rankComplete && state !== 'withdrawn' && isMask(rank))
        throw new Error('累计排名已遮挡，请取消勾选完整榜单。');
      if (!rankMissing && !/^[1-9]\d*$/.test(rank)) throw new Error('累计排名应为正整数或留空。');
      const rawSymbols = cell('symbols').split(/[\s,，、;；]+/).filter(Boolean);
      const masked = rawSymbols.some(isMask) || isMask(cell('holdingsState'));
      const symbols = rawSymbols.filter(s=>!isMask(s));
      const declaredState = masked ? 'partial' : status(cell('holdingsState'), completeness, '持仓完整性');
      // A few visible codes establish presence, not a complete portfolio.
      const holdingsState = declaredState === 'unknown' && symbols.length ? 'partial' : declaredState;
      if (holdingsState === 'complete' && !symbols.length) throw new Error('请填写完整持仓的代码，已确认空仓请标记为“空仓”。');
      if (holdingsState === 'empty' && symbols.length) throw new Error('空仓行同时含有证券代码。');
      return {id, name, rank: rankMissing ? null : Number(rank),
        state, dayReturn: percentage(cell('dayReturn')),
        totalReturn: percentage(cell('totalReturn')), exposure: percentage(cell('exposure')),
        holdingsState, symbols};
    } catch (error) { throw new Error(`第 ${i + 2} 行：${error instanceof Error ? error.message : String(error)}`); }
  });
  return {schemaVersion: 1, ...meta, previousTradeDate: meta.previousTradeDate || undefined, players};
}
