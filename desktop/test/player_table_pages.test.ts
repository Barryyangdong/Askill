import assert from 'node:assert/strict';
import test from 'node:test';
import { combinePlayerPages, type PlayerTablePage } from '../src/verticals/finance/lib/playerTablePages.ts';

const player = {id:'1',name:'甲',rank:1,state:'reported',dayReturn:0,totalReturn:null,exposure:null,
  holdingsState:'complete',symbols:['600000','000001']};
const page: PlayerTablePage = {schemaVersion:1,matchId:'m',matchName:'赛事',divisionId:'all',divisionName:'总榜',
  date:'2026-11-20',previousTradeDate:undefined,rankComplete:false,players:[player]};

test('分页榜单按稳定 ID 去重，用户核全后才能标为完整', () => {
  const first = combinePlayerPages(null,page);
  const result = combinePlayerPages(first,{...page,rankComplete:true,players:[
    {...player,symbols:[...player.symbols].reverse()}, {...player,id:'2',name:'乙',rank:2}]});
  assert.deepEqual(result.players.map(p=>p.id),['1','2']);
  assert.equal(result.rankComplete,true);
  assert.equal(first.players.length,1);
  assert.equal(first.rankComplete,false);
});

test('跨范围、日期及同人不同记录均拒绝合并，保留原页', () => {
  for (const difference of [{matchId:'other'},{divisionId:'other'},{date:'2026-11-19'},{previousTradeDate:'2026-11-19'}]) {
    assert.throws(()=>combinePlayerPages(page,{...page,...difference}),/不一致/);
  }
  assert.throws(()=>combinePlayerPages(page,{...page,players:[{...player,dayReturn:0.1}]}),/数据不同/);
  assert.equal(page.players[0]?.dayReturn,0);
});
