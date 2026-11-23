import type { playerTablePayload } from './playerTable';

export type PlayerTablePage = ReturnType<typeof playerTablePayload>;

function comparable(row: PlayerTablePage['players'][number]) {
  return JSON.stringify({...row, symbols: [...new Set(row.symbols)].sort()});
}

/** One batch represents one user-selected leaderboard and trading day. */
export function combinePlayerPages(saved: PlayerTablePage | null, page: PlayerTablePage): PlayerTablePage {
  if (saved && (saved.matchId !== page.matchId || saved.divisionId !== page.divisionId ||
      saved.date !== page.date || saved.previousTradeDate !== page.previousTradeDate ||
      saved.divisionName !== page.divisionName)) {
    throw new Error('比赛、赛组或交易日与已暂存页不一致，请核对后再合并。');
  }
  const players = new Map(saved?.players.map(player => [player.id, player]));
  for (const player of page.players) {
    const prior = players.get(player.id);
    if (prior) {
      // Display order of holdings can differ on an overlapping leaderboard page.
      if (comparable(player) !== comparable(prior)) {
        throw new Error(`选手 ${player.name}（${player.id}）在两行中的数据不同，请核对官网页面后重试。`);
      }
    } else {
      players.set(player.id, player);
    }
  }
  if (players.size > 10000) throw new Error('一个赛组每天最多可导入 10000 名选手。');
  return {...page, players: [...players.values()]};
}
