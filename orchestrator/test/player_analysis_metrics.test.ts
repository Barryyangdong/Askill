import assert from "node:assert/strict";
import test from "node:test";
import {analyzePlayers, playerHistory, stockHistory, type PlayerDay, type PlayerRow} from "../src/finance/player_analysis_metrics.ts";
import {normalizePlayerImport} from "../src/finance/player_analysis_import.ts";

function player(id: string, rank: number, symbols: string[], values: Partial<PlayerRow> = {}): PlayerRow {
  return {id, name:id, rank, state:"reported", holdingsState:symbols.length ? "complete" : "empty", symbols,
    totalReturn:0, dayReturn:0, exposure:symbols.length ? 1 : 0, ...values};
}
function day(date: string, players: PlayerRow[], values: Partial<PlayerDay> = {}): PlayerDay {
  return {date, players, rankComplete:true, ...values};
}
const friday = day("2026-11-20", [player("甲",1,["X","Y"]), player("乙",2,[]), player("丙",3,["X"]), player("丁",4,["X"])]);
const monday = day("2026-11-23", [player("丙",1,[]), player("乙",2,["X","X"]), player("甲",3,["X"]), player("丁",4,[],{holdingsState:"partial"})]);
const options = {date:monday.date, n:2, watch:["X"], followed:["乙"]};
test("官方首日无排名和收益，打码实报保留公开数字并排除持仓差分", () => {
  const meta = {schemaVersion:1,matchId:"m",matchName:"赛",divisionId:"all",divisionName:"总榜", rankComplete:true};
  const baseline = normalizePlayerImport({...meta,date:"2026-01-05",players:[
    player("甲",1,["600001"],{rank:null,dayReturn:null,totalReturn:null}),
    player("乙",2,[],{rank:null,dayReturn:null,totalReturn:null}),
  ]});
  const report = {...player("甲",1,["600001","＊＊"]),exposure:"***",dayReturn:.015};
  const next = normalizePlayerImport({...meta,date:"2026-01-06",players:[report,player("乙",2,[])]});
  const initial = analyzePlayers([baseline],{date:baseline.date,rankBasis:"today"});
  assert.equal(initial.groups.all.dayReturn.denominator,0);
  assert.equal(initial.size,0);
  const now = analyzePlayers([baseline,next],{date:next.date,rankBasis:"today"});
  assert.equal(now.groups.all.profit.denominator,2);
  assert.equal(now.groups.all.exposure.denominator,1);
  assert.equal(now.coverage.complete,1);
  assert.equal(now.stocks.length,0);
  const maskedPlayer = now.players.find(p=>p.id==="甲")!;
  assert.equal(maskedPlayer.holdingsState,"partial");
  assert.deepEqual(maskedPlayer.symbols,["600001"]);
  assert.throws(()=>normalizePlayerImport({...meta,date:next.date,players:[{...report,rank:"★"}]}),/排名/);
});
test("fixed group changes, partial and empty holdings, and exited-only symbols reconcile to IDs", () => {
  const out = analyzePlayers([friday,monday],options);
  const x = out.stocks.find(s => s.symbol === "X")!;
  assert.equal(x.all.denominator,3);
  assert.equal(x.all.comparable,3);
  assert.deepEqual(x.all.added,["乙"]);
  assert.deepEqual(x.all.kept,["甲"]);
  assert.deepEqual(x.all.exited,["丙"]);
  assert.equal(x.all.net,0);
  assert.deepEqual(out.groups.top.ids,["甲","乙"]);
  assert.deepEqual(x.top.holders,["甲","乙"]);
  assert.ok(Math.abs(x.preference! - 100 / 3) < 1e-9);
  assert.equal(out.stocks.find(s=>s.symbol==="Y")!.all.net,-1);
  assert.equal(out.digest.length,1);
  assert.match(out.digest[0].text,/1 位关注选手/);
  assert.equal(out.players.find(p=>p.id==="丙")!.migration,"new");
  assert.equal(out.players.find(p=>p.id==="甲")!.migration,"out");
  assert.equal(playerHistory([friday,monday],friday.date,"甲").length,1);
  const series = stockHistory([friday,monday],options,"X");
  assert.equal(series.length,2);
  assert.equal(series[0].all.net,null);
});
test("actual zero and partial coverage stay distinct, with no stale or synthetic returns", () => {
  const sample = day("2026-11-24",[player("乙",1,[],{state:"leave"}),player("甲",2,[],{state:"suspended"}),
    player("丙",3,[],{state:"missing"}),player("丁",4,[],{state:"unknown"})],{rankComplete:false});
  const out = analyzePlayers([friday,sample],{date:sample.date,rankBasis:"today"});
  assert.deepEqual(out.coverage,{expected:null,roster:4,reported:0,published:0,carried:2,missing:1,unknown:1,complete:0});
  assert.equal(out.groups.all.profit.value,null);
  assert.equal(out.groups.all.exposure.value,null);
  assert.equal(out.groups.top.ids.length,0);
  assert.match(out.groupReason!,/覆盖/);
  assert.equal(out.stocks.length,0);
});
test("官网榜单披露可计算收益与持仓，实报数独立",()=>{
  const sample=day("2026-11-20",[player("甲",1,["600000"],{state:"published",dayReturn:0.1,exposure:1.41})]);
  const result=analyzePlayers([sample],{date:sample.date,rankBasis:"today"});
  assert.equal(result.coverage.published,1);
  assert.equal(result.coverage.reported,0);
  assert.equal(result.groups.all.profit.value,1);
  assert.equal(result.groups.all.exposure.value,1.41);
  assert.equal(result.stocks[0]?.all.denominator,1);
  assert.equal(result.players[0]?.reportDays,0);
});
test("an observation gap requires the previous trading day, and a source calendar can bridge a holiday", () => {
  const tuesday = {...monday,date:"2026-11-24"};
  const gap = analyzePlayers([friday,tuesday],{date:tuesday.date});
  assert.equal(gap.rankDate,null);
  assert.equal(gap.players[0].windowDays,1);
  assert.equal(gap.groups.all.rising.denominator,0);
  const knownHoliday = {...tuesday,previousTradeDate:friday.date};
  assert.equal(analyzePlayers([friday,knownHoliday],{date:tuesday.date}).rankDate,friday.date);
});
test("distribution boundaries form a partition and zero return counts in the profitability denominator", () => {
  const d = day(monday.date,[0,.3,.7,1,1.2].map((exposure,i)=>player(String(i),i+1,[],{exposure,dayReturn:[-.05,-.01,0,.01,.05][i]})));
  const g = analyzePlayers([d],{date:d.date,rankBasis:"today",pct:.1}).groups;
  assert.deepEqual(g.all.exposureBins.map(b=>b.ids.length),[1,1,1,1,1]);
  assert.deepEqual(g.all.returnBins.map(b=>b.ids.length),[1,1,1,1,1]);
  assert.equal(g.all.profit.value,.4);
  assert.equal(g.all.dayReturn.value,0);
  assert.equal(g.all.exposure.value,.7);
  assert.equal(g.top.ids.length,1);
});
test("rank boundary ties remain unknown; twenty complete trading days gate sustained comparison", () => {
  const tie = day(friday.date,[player("x",1,[]),player("y",1,[]),player("z",3,[])]);
  assert.deepEqual(analyzePlayers([tie],{date:tie.date,rankBasis:"today",n:1}).groups.top.ids,[]);
  const dates: string[] = [];
  const date = new Date("2026-10-12T00:00:00Z");
  while (dates.length < 20) {
    if (![0,6].includes(date.getUTCDay())) dates.push(date.toISOString().slice(0,10));
    date.setUTCDate(date.getUTCDate()+1);
  }
  const history = dates.map((d,i)=>day(d,[player("甲",1,[],{nav:i===1?1.25:1}),player("乙",2,[])]));
  const full = analyzePlayers(history,{date:dates[19]}).players[0];
  assert.equal(full.eligible,true);
  assert.equal(full.topDays,20);
  assert.equal(full.streak,20);
  assert.ok(Math.abs(full.drawdown! - .2) < 1e-12);
  assert.equal(analyzePlayers(history,{date:dates[5]}).players[0].eligible,false);
});
