import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { activeMembership, contestId, profileId } from "../src/verticals/finance/lib/playerEnrollment.ts";
import { withRenderer, textOf } from "./helpers/render.ts";
import { analyzePlayers, type PlayerDay } from "../../orchestrator/src/finance/player_analysis_metrics.ts";

test("比赛主操作登录后开始采集，同时保留独立的默认浏览器查看入口",async()=>{
  await withRenderer(async r=>{
    const {PlayerSync}=await r.load("/src/verticals/finance/components/PlayerSync.tsx");
    const html=r.html(PlayerSync,{onChanged:()=>{}});
    assert.match(html,/<form\b[^]*?登录并采集<\/button>[^]*?<button type="button"[^>]*>用默认浏览器查看<\/button>[^]*?<\/form>/);
  });
});

test("未绑定、非在赛或过期时只展示参赛核验与报名入口",async()=>{
  const now=Date.now();
  const record={userId:"123",checkedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+600_000).toISOString(),expired:false,matches:[{matchId:"m",name:"我的比赛"}]};
  assert.equal(profileId("https://www.tgb.cn/blog/123"),"123");
  assert.equal(profileId("123"),"123");
  assert.equal(profileId("https://www.tgb.cn.example.org/blog/123"),null);
  assert.equal(contestId("https://www.tgb.cn/spmatch/matchAll?tid=abc12"),"abc12");
  assert.equal(contestId("https://www.tgb.cn/spmatch/matchAll?tid=a&tid=b"),null);
  assert.equal(contestId("https://www.tgb.cn.example.org/spmatch/matchAll?tid=a"),null);
  assert.equal(activeMembership(record,now),true);
  for(const v of [null,{...record,matches:[]},{...record,expired:true},{...record,expiresAt:new Date(now).toISOString()}])assert.equal(activeMembership(v,now),false);
  await withRenderer(async r=>{
    const {PlayerEnrollment}=await r.load("/src/verticals/finance/components/PlayerEnrollment.tsx");
    const html=r.html(PlayerEnrollment,{membership:null,onChecking:()=>{},onVerified:()=>{}});
    assert.match(textOf(html),/核验参赛记录.*报名.*核验我的比赛/);
    assert.doesNotMatch(textOf(html),/导入数据|自选股收盘速览|读取选手持仓/);
  });
});

test("首次导入显示真实来源、表格入口和文件格式，展示预览前没有保存操作", async () => {
  await withRenderer(async r => {
    const {PlayerImport} = await r.load("/src/verticals/finance/components/PlayerImport.tsx");
    const membership={userId:"1234",checkedAt:"2026-11-22T00:00:00Z",expiresAt:"2026-11-23T00:00:00Z",expired:false,matches:[{matchId:"100",name:"赛组测试",spmatchSeq:"88"}]};
    const html = r.html(PlayerImport, {onImported:()=>{},membership});
    assert.ok(html.includes('href="https://www.tgb.cn/spmatch/matchAll?tid=100"'));
    assert.match(textOf(html),/赛组测试/);
    assert.match(textOf(html),/从官网读取全场榜单.*下载本场读取书签/);
    assert.match(textOf(html),/从表格粘贴/);
    assert.match(textOf(html),/下载格式示例/);
    assert.doesNotMatch(textOf(html),/确认导入/);
  });
});

test("有数据的首屏、股票表及选手榜展示同一版本", async () => {
  const date="2026-11-20";
  const day:PlayerDay={date,rankComplete:true,expected:2,players:[
    {id:"p1",name:"参赛甲",rank:1,state:"reported",dayReturn:.1,totalReturn:.2,exposure:.5,holdingsState:"complete",symbols:["600000"]},
    {id:"p2",name:"参赛乙",rank:2,state:"reported",dayReturn:0,totalReturn:0,exposure:0,holdingsState:"empty",symbols:[]}
  ]};
  const analysis=analyzePlayers([day],{date,rankBasis:"today",n:1,watch:["600000"]});
  const contest={matchId:"m",matchName:"测试比赛",divisionId:"all",divisionName:"总榜",dates:[date]};
  const props={result:{analysis,date,revision:2,asOf:date,importedAt:"2026-11-20T10:00:00Z",followed:[]},contest,query:"",onReload:()=>{}};
  await withRenderer(async r=>{
    const {PlayerResults}=await r.load("/src/verticals/finance/components/PlayerResults.tsx");
    const {MemoryRouter}=await r.load("react-router-dom");
    const page=(tab:string)=>textOf(r.html(()=>createElement(MemoryRouter,{initialEntries:["/player-analysis?tab="+tab]},createElement(PlayerResults,props)),{}));
    assert.match(page("overview"),/测试比赛.*v2.*当日主动报单.*2 \/ 2.*盈利人数占比.*50%.*收盘仓位分布.*自选股收盘速览/);
    assert.match(page("stocks"),/偏好差.*600000.*50%.*100%/);
    assert.match(page("players"),/参赛甲.*10%.*20%.*50%.*参赛乙/);
    assert.match(page("players&player=p1"),/连续领先.*近20日实报.*当日持仓.*报单原图.*报单与原图不一致.*选手时间轴/);
    assert.match(page("stocks&symbol=600000"),/近五日持仓变化.*查看截至 2026-11-20 的 K 线/);
  });
});

test("观察来源保留可返回的本地快照链接，隐私视图关闭链接",async()=>{
  await withRenderer(async r=>{
    const {ObservationEvidence}=await r.load("/src/verticals/finance/components/ui/ObservationEvidence.tsx");
    const note="示例赛组\n/player-analysis?date=2026-11-20&revision=2&symbol=600000";
    assert.match(r.html(ObservationEvidence,{text:note,hide:false}),/href="\/player-analysis\?date=2026-11-20&amp;revision=2&amp;symbol=600000"/);
    assert.doesNotMatch(r.html(ObservationEvidence,{text:note,hide:true}),/href=/);
  });
});
