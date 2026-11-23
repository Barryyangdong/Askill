import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playerTablePayload, readPlayerTable } from '../src/verticals/finance/lib/playerTable.ts';

const meta = {matchId:'a',matchName:'赛事',divisionId:'g',divisionName:'全组',date:'2026-11-20',previousTradeDate:'',rankComplete:false};
test('打码排名须保留为未知，并阻止误声明完整榜单',()=>{
  const table=readPlayerTable('ID\t昵称\t累计排名\n1\t甲\t＊＊');
  const mapping={id:0,name:1,rank:2};
  assert.equal(playerTablePayload(table,mapping,meta).players[0]!.rank,null);
  assert.throws(()=>playerTablePayload(table,mapping,{...meta,rankComplete:true}),/完整榜单/);
});
test('表格百分数、缺字段及遮挡保留各自含义',()=>{
  const source = readPlayerTable('ID\t昵称\t仓位\t日收益\t持仓完整性\t代码\n1\t选手\t0\t-2.5%\t部分\t600001\n2\t乙\t\t\t\t');
  const {players} = playerTablePayload(source,{id:0,name:1,exposure:2,dayReturn:3,holdingsState:4,symbols:5},meta);
  assert.equal(players[0]!.dayReturn,-0.025); assert.equal(players[0]!.exposure,0);
  assert.equal(players[1]!.exposure,null); assert.equal(players[1]!.holdingsState,'unknown');
  assert.equal(players[0]!.state,'unknown'); assert.deepEqual(players[0]!.symbols,['600001']);
});
test('缺少 ID、错列、未知状态与歧义空仓须先校对',()=>{
  assert.throws(()=>readPlayerTable('id\tname\n1'),/第 2 行/);
  const table = readPlayerTable('id\tname\t状态\n1\t甲\t完整');
  assert.throws(()=>playerTablePayload(table,{name:1},meta),/稳定/);
  assert.throws(()=>playerTablePayload(table,{id:0,name:1,state:2},meta),/无法识别/);
  assert.throws(()=>playerTablePayload(table,{id:0,name:1,holdingsState:2},meta),/空仓/);
});
test('未参赛页面星号遮挡不抹去可见收益，也不会产生空仓或虚假完整样本',()=>{
  const source = readPlayerTable('ID\t昵称\t仓位\t收益\t持仓\t完整性\n1\t甲\t***\t3.2%\t600001、＊＊＊\t完整\n2\t乙\t50%\t★\t***\t');
  const {players} = playerTablePayload(source,{id:0,name:1,exposure:2,dayReturn:3,symbols:4,holdingsState:5},meta);
  assert.deepEqual(players.map(p=>[p.exposure,p.dayReturn,p.symbols,p.holdingsState]),[[null,0.032,['600001'],'partial'],[0.5,null,[],'partial']]);
});
