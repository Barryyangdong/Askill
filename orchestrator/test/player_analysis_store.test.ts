import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "../src/finance/register.ts";
import { bindPlayerProfile, readPlayerAnalysis, writePlayerAnalysis } from "../src/finance/player_analysis.ts";
import { normalizePlayerImport } from "../src/finance/player_analysis_import.ts";

const sample = {schemaVersion:1, matchId:"m",matchName:"赛事",divisionId:"all",divisionName:"总榜",date:"2025-01-03",rankComplete:true,
  expected:2,players:[{id:"a",name:"甲",state:"reported",rank:1,exposure:.6,dayReturn:.01,totalReturn:.1,holdingsState:"complete",symbols:["sh600001"]},
  {id:"b",name:"乙",state:"reported",rank:2,exposure:0,dayReturn:0,totalReturn:0,holdingsState:"empty",symbols:[]}]};

test("当日核图需同场资格，逐字段保存依据，重复提交、历史版本和统计一致",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"player-screenshot-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const ctx={repoRoot:root,dataRoot:root,python:"python",node:process.execPath};
  const scope={matchId:"m",divisionId:"all",date:sample.date,expectedUserId:"101"};
  const base={...sample,players:[{...sample.players[0],state:"unknown",symbols:[],holdingsState:"unknown"},sample.players[1]]};
  const image="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/M9sAAAAASUVORK5CYII=";
  const body={action:"reviewScreenshot",...scope,playerId:"a",revision:1,image,confirmed:true,exposure:1.12};
  assert.throws(()=>writePlayerAnalysis(ctx,body),/核验/);
  await bindPlayerProfile(ctx,"101",new AbortController().signal,async()=>({userId:"101",checkedAt:"",matches:[{matchId:"m",name:"赛事"}]}));
  const pre=writePlayerAnalysis(ctx,{action:"previewImport",data:base});assert.ok("previewId" in pre);
  writePlayerAnalysis(ctx,{action:"commitImport",previewId:pre.previewId});
  assert.throws(()=>writePlayerAnalysis(ctx,{...body,confirmed:false}),/确认/);
  assert.throws(()=>writePlayerAnalysis(ctx,{...body,image:"data:image/png;base64,AAAA"}),/识别/);
  assert.throws(()=>writePlayerAnalysis(ctx,{...body,expectedUserId:"102"}),/账号/);
  assert.deepEqual(writePlayerAnalysis(ctx,body),{revision:2});
  assert.deepEqual(writePlayerAnalysis(ctx,body),{revision:2});
  assert.throws(()=>writePlayerAnalysis(ctx,{...body,exposure:.6}),/新版本/);
  const stockReview={...body,revision:2,exposure:undefined,holdingsState:"complete",symbols:["sh600001"]};
  assert.deepEqual(writePlayerAnalysis(ctx,stockReview),{revision:3});
  const q={...scope,mode:"screenshot",playerId:"a",revision:"3",field:"exposure"};
  assert.deepEqual(readPlayerAnalysis(ctx,q),{image});
  assert.throws(()=>readPlayerAnalysis(ctx,{...q,playerId:"b"}),/没有/);
  assert.throws(()=>readPlayerAnalysis(ctx,{...q,revision:"1"}),/没有/);
  const latest=readPlayerAnalysis(ctx,{...scope,rankBasis:"today"});
  assert.ok("analysis" in latest&&latest.analysis);
  assert.equal(latest.analysis.coverage.reported,1);
  assert.equal(latest.analysis.groups.all.exposure.denominator,2);
  assert.equal(latest.analysis.groups.all.dayReturn.denominator,1);
  assert.deepEqual(latest.analysis.stocks[0].all.holders,["a"]);
});

test("导入校验保留未知字段状态，拒绝重复身份、矛盾的持仓及无效日期",()=>{
  assert.equal(normalizePlayerImport(sample).players[0].symbols[0],"600001");
  assert.throws(()=>normalizePlayerImport({...sample,players:[sample.players[0],sample.players[0]]}),/重复/);
  assert.throws(()=>normalizePlayerImport({...sample,date:"2025-02-31"}),/无效/);
  assert.throws(()=>normalizePlayerImport({...sample,date:"2025-01-04"}),/周末/);
  assert.throws(()=>normalizePlayerImport({...sample,players:[sample.players[0],{...sample.players[1],rank:3}]}),/断档/);
  assert.throws(()=>normalizePlayerImport({...sample,players:[{...sample.players[0],holdingsState:"empty"}]}),/冲突/);
  assert.throws(()=>normalizePlayerImport({...sample,previousTradeDate:sample.date}),/早于/);
});

test("预览隔离、提交幂等、修订回看、关注持久化与跨日历史",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"player-analysis-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const ctx={repoRoot:root,dataRoot:root,python:"python",node:process.execPath};
  assert.deepEqual(readPlayerAnalysis(ctx,{}),{matches:[],membership:null});
  assert.deepEqual(fs.readdirSync(root),[]);
  const prepare=(data:unknown)=> {
    const result=writePlayerAnalysis(ctx,{action:"previewImport",data});
    assert.ok("previewId" in result);
    return result.previewId;
  };
  const commit=(previewId:string)=>writePlayerAnalysis(ctx,{action:"commitImport",previewId});
  const bind=(userId:string, ids:string[])=>bindPlayerProfile(ctx,userId,new AbortController().signal,
    async()=>({userId,checkedAt:new Date().toISOString(),matches:ids.map(matchId=>({matchId,name:"赛事",spmatchSeq:"88"}))}));
  assert.throws(()=>prepare(sample),/核验/);
  await bind("100",["m"]);
  await bind("200",["m"]);
  assert.throws(()=>prepare({...sample,sourceUserId:"100",sourceMatchSeq:"88"}),/登录账号或战绩赛事序号/);
  assert.throws(()=>prepare({...sample,sourceUserId:"200",sourceMatchSeq:"89"}),/登录账号或战绩赛事序号/);
  assert.ok(prepare({...sample,sourceUserId:"200",sourceMatchSeq:"88"}));
  assert.throws(()=>prepare({...sample,matchId:"other"}),/有效参赛/);
  const preview=prepare(sample);
  assert.throws(()=>writePlayerAnalysis({...ctx,dataRoot:path.join(root,"other")},{action:"commitImport",previewId:preview}),/过期/);
  assert.deepEqual(commit(preview),commit(preview));
  await assert.rejects(bind("100",["m"]),/其他账号/);
  assert.throws(()=>writePlayerAnalysis(ctx,{action:"setFollow",matchId:"m",divisionId:"all",playerId:"a",followed:true,expectedUserId:"100"}),/账号已变更/);
  assert.throws(()=>writePlayerAnalysis(ctx,{action:"setFollow",matchId:"m",divisionId:"all",playerId:"absent",followed:true}),/没有此选手/);
  writePlayerAnalysis(ctx,{action:"setFollow",matchId:"m",divisionId:"all",playerId:"a",followed:true});
  const q={matchId:"m",divisionId:"all",date:sample.date,rankBasis:"today"};
  const first=readPlayerAnalysis(ctx,q);
  assert.ok("analysis" in first && first.analysis);
  assert.deepEqual(first.followed,["a"]);
  const missingPlayer = {...sample,rankComplete:false,players:sample.players.slice(0,1)};
  const staleDay = prepare(missingPlayer);
  commit(prepare({...sample,matchName:"赛事",players:sample.players.map(p=>({...p,name:p.name+"修订"}))}));
  assert.throws(()=>commit(staleDay),/已发布新版本/);
  const previewAgain=writePlayerAnalysis(ctx,{action:"previewImport",data:missingPlayer});
  assert.ok("warnings" in previewAgain && previewAgain.warnings.some(w=>w.includes("覆盖下降")));
  // An already-published identical payload remains safe to retry even after another revision.
  assert.deepEqual(commit(preview),{matchId:"m",divisionId:"all",date:sample.date,revision:1});
  commit(prepare({...sample,date:"2025-01-06",previousTradeDate:"2025-01-03"}));
  const observed=readPlayerAnalysis(ctx,{...q,mode:"history",asOf:first.asOf,playerId:"a"});
  assert.ok("history" in observed && observed.history);
  assert.equal(observed.revision,1);
  assert.equal((observed.history[0] as {name:string}).name,"甲");
  const old=readPlayerAnalysis(ctx,{...q,mode:"history",revision:"1",playerId:"a"});
  assert.ok("history" in old && old.history);
  assert.equal((old.history[0] as {name:string}).name,"甲");
  const current=readPlayerAnalysis(ctx,{...q,date:"2025-01-06",mode:"history",playerId:"a"});
  assert.ok("history" in current && current.history);
  assert.deepEqual(current.history.map(row=>row.date),["2025-01-03","2025-01-06"]);
  assert.equal((current.history[0] as {name:string}).name,"甲修订");
  const stale=prepare(sample);
  await bind("200",["m"]);
  assert.throws(()=>commit(stale),/重新预览/);
  const revoked=prepare(sample);
  await bind("200",[]);
  assert.throws(()=>readPlayerAnalysis(ctx,{...q,mode:"history",playerId:"a"}),/有效参赛/);
  assert.throws(()=>commit(revoked),/有效参赛/);
  assert.throws(()=>writePlayerAnalysis(ctx,{action:"setFollow",...q,playerId:"a",followed:false}),/有效参赛/);
  assert.deepEqual(readPlayerAnalysis(ctx,{}).matches,[]);
  await bind("200",["m"]);
  const future=Date.now()+11*60_000;
  t.mock.method(Date,"now",()=>future);
  assert.throws(()=>readPlayerAnalysis(ctx,q),/核验已过期/);
  assert.deepEqual(readPlayerAnalysis(ctx,{}).matches,[]);
});
