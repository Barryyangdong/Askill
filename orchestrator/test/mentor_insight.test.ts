import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMentorInsight, mentorInsight } from "../src/finance/mentor_insight.ts";
import { fileURLToPath } from "node:url";
import { cachedReviewDay, emptyFrame, frameFromResults, reviewPanelEvidence, type MarketFrame } from "../src/finance/mentor_insight_market.ts";
import { compareMentorCases } from "../src/finance/mentor_case_comparison.ts";
import { marketComparison } from "../src/finance/mentor_market.ts";
import type { MentorPack } from "../src/finance/mentors.ts";
import type { FetchResult } from "../src/service.ts";
import { snapshotKey, writeSnapshot } from "../src/snapshot.ts";
import { VERIFY_METRIC_KEYS } from "../src/finance/shortline/verify_metrics.ts";

const pack:MentorPack=JSON.parse(readFileSync(new URL("../../knowledge/mentors/tuixue.json",import.meta.url),"utf8"));
const date="2026-11-20";
const frame={...emptyFrame(),breadth:20,feedback:2,promotion:0.2,broken:0.25,
  sources:{cn_market_breadth_history:"沪深京",cn_shortline_daily:"东财收盘"}};

test("相同的题库根据当日广度与接力表现给出不同结论、出处及次日条件",()=>{
  const positive=buildMentorInsight(pack,date,frame);
  const negative=buildMentorInsight(pack,date,{...frame,feedback:-2});
  assert.notEqual(positive.headline,negative.headline);
  assert.notEqual(positive.summary,negative.summary);
  assert.notEqual(positive.conditions[0].direction,negative.conditions[0].direction);
  assert.ok(positive.conditions.every(c=>VERIFY_METRIC_KEYS.includes(c.metric)));
  const ids=new Set(positive.evidence.map(e=>e.id));
  assert.ok(positive.observations.concat(positive.counterpoints).every(c=>c.evidenceIds.length>0 && c.evidenceIds.every(id=>ids.has(id))));
  assert.ok(positive.evidence.some(e=>e.kind==="behavior"));
  assert.ok(positive.evidence.some(e=>e.kind==="quote" && e.url));
  assert.deepEqual(positive.hintedCaseIds,positive.evidence.flatMap(e=>e.caseId?[e.caseId]:[]));
});
test("11 月 20 日把盘面事实和有出处的人物推理分开，并保留不同历史动作",()=>{
  const current={...frame,breadth:5.64,feedback:-5.08};
  const view=buildMentorInsight(pack,date,current);
  assert.match(view.summary,/上涨的占 5\.64%.*昨日涨停股.*中位数为 -5\.08%/);
  assert.match(view.reasoning?.text ?? "",/山鼎设计.*单独|山鼎设计.*同题材的其他股票跟上/);
  assert.equal(view.evidence.filter(e=>view.reasoning?.evidenceIds.includes(e.id) && e.kind==="quote").length,1);
  assert.match(view.counterpoints[0].text,/8 天仍开了新仓，4 天没有新开仓/);
  const other=buildMentorInsight({...pack,id:"other",methods:[],quotes:[],cases:[],behavior:undefined},date,current);
  assert.equal(view.summary,other.summary);
  assert.equal(other.reasoning,undefined);
  assert.match(buildMentorInsight(pack,date,{...current,breadth:50,feedback:0}).headline,/涨跌家数持平.*涨幅为零/);
});
test("历史重放只引用揭晓日及以前的已知动作和已发表原话，隔离当日答案和未来全样本统计",()=>{
  for(const day of ["2017-04-24","2017-06-14","2017-07-25"]) {
    const view=buildMentorInsight(pack,day,emptyFrame());
    assert.ok(view.evidence.some(e=>e.kind==="market"));
    assert.ok(!view.evidence.some(e=>e.title===pack.behavior?.title));
    for(const e of view.evidence) {
      assert.ok(e.date.slice(0,10)<=day);
      if(e.caseId) assert.ok(pack.cases.find(c=>c.id===e.caseId)!.nextDate<=day);
    }
    assert.ok(!view.hintedCaseIds.includes("tx-"+day));
  }
  const last=pack.cases.at(-1)!;
  assert.deepEqual(compareMentorCases(last,[{...last,date:"2016-03-01",nextDate:"2016-03-02",scene:undefined}]),[]);
});
test("研判回收同日复盘快照，日期冲突、未定稿或晚于复盘日的披露不会进模型资料",t=>{
  const dataRoot=mkdtempSync(join(tmpdir(),"mentor-panels-"));
  t.after(()=>rmSync(dataRoot,{recursive:true,force:true}));
  const ctx={dataRoot,repoRoot:"",python:"",node:""};
  const point=(field:string,value:number,period=date,record_key="market")=>({field,value,period,record_key});
  const put=(endpoint:string,args:Record<string,unknown>,envelope:Record<string,unknown>,fetched_at=date+"T18:03:00+08:00")=>{
    writeSnapshot(dataRoot,snapshotKey(endpoint,"",args),{endpoint,symbol:""},
      {fetched_at,envelope:{status:"ok", ...envelope}},()=>true);
  };
  put("em_market_trend",{days:300,end:date},{evidence:[
    point("index_change_pct",-1.22,date,"index|000001"),point("index_change_pct",71,"2026-11-23","index|999999"),
  ]});
  put("cn_review_industry_close",{date},{extra:{source_close_date:"2026-11-19"},evidence:[point("board_net_sw_close",8)]});
  put("cn_shortline_turnover_top",{date,top:20},{extra:{source_close_date:date},evidence:[point("turnover_amount",12_000_000_000,date,"stock|600000")]});
  put("cn_shortline_emotion",{date},{extra:{date,settled:false},evidence:[point("money_effect_sample",777)]});
  put("cn_review_abnormal",{day:date},{extra:{date},evidence:[point("review_abnormal_near_count",1)]},"2026-11-21T09:30:00+08:00");
  const current: MarketFrame={...frame,reviewEvidence:[],reviewGaps:[],fetchedAt:[]};
  reviewPanelEvidence(ctx,current,date,Date.parse("2026-11-21T23:00:00+08:00"));
  assert.deepEqual(current.reviewEvidence.map(r=>r.key),["index","turnover"]);
  assert.match(current.reviewEvidence[0].text,/-1.22/);
  assert.doesNotMatch(current.reviewEvidence[0].text,/71|999999/);
  assert.equal(current.reviewGaps.length,8);
  const view=buildMentorInsight(pack,date,current);
  assert.ok(view.evidence.some(e=>e.kind==="market" && e.title.includes("沪深京成交额前列")));
  assert.ok(view.evidence.filter(e=>e.kind==="quote").length>1);
});
test("上证走势接近的真实留出场景区分少数强势和广泛上涨",()=>{
  const wide=buildMentorInsight(pack,"2017-07-03",emptyFrame());
  const narrow=buildMentorInsight(pack,"2017-07-14",emptyFrame());
  assert.notEqual(wide.headline,narrow.headline);
  assert.ok(wide.observations.some(c=>c.text.includes("78.13%")));
  assert.ok(narrow.observations.some(c=>c.text.includes("32.24%")));
});
test("新人物使用同日可核实的存档行情，证据中只保留自己的方法与操作",async()=>{
  const day="2017-07-14";
  const ctx={dataRoot:"",repoRoot:fileURLToPath(new URL("../../",import.meta.url)),python:"python-disabled",node:process.execPath};
  const fresh:MentorPack={id:"reader",name:"新人物",version:"1",summary:"",cases:[],quotes:[],methods:[]};
  const viewed = await mentorInsight(ctx,fresh,day);
  const original = await mentorInsight(ctx,pack,day);
  const market = (view:typeof original)=>view.evidence.filter(e=>e.kind==="market").map(e=>[e.title,e.text,e.source]);
  assert.equal(viewed.date,day);
  assert.ok(market(viewed).length>=2);
  assert.deepEqual(market(viewed),market(original));
  assert.ok(viewed.evidence.every(e=>e.kind==="market"));
  assert.deepEqual(viewed.hintedCaseIds,[]);
  assert.ok(viewed.gaps.some(g=>g.includes("尚无可核验的人物材料")));
  assert.ok(!viewed.gaps.some(g=>g.includes("原帖披露时间")));
});
test("近期同口径对照排除未来和远例；空白人物不继承退学的行为或原话",()=>{
  const view=buildMentorInsight({...pack,id:"new",behavior:undefined,cases:[],quotes:[],methods:[]},date,frame,[
    {date:"2026-11-21",frame},{date:"2026-11-16",frame:{...frame,feedback:-8}},{date:"2026-11-18",frame}]);
  assert.ok(view.observations.some(r=>r.title==="近期收盘对照" && r.text.includes("2026-11-18")));
  assert.ok(!view.evidence.some(e=>e.kind!=="market" || e.date>"2026-11-20"));
  assert.ok(view.gaps.some(g=>g.includes("尚无可核验的人物材料")));
});
test("当日收盘、已公布时间和非零口径限制实际进入的数据",()=>{
  const result = {cached:true, fetched_at:date+"T17:00:00+08:00",duration_ms:0,out_dir:"",stderr_tail:"",exit_code:0,
    envelope:{status:"ok",extra:{date,settled:true},evidence:[{field:"money_effect_median_ret",value:0,period:date},
      {field:"broken_rate",value:0.5,period:"2026-11-21"}]}} satisfies FetchResult;
  const knownBy=Date.parse("2026-11-21T12:01:00+08:00");
  const v=frameFromResults({cn_shortline_daily:result,cn_review_dragon:{...result,fetched_at:"2026-11-21T12:00:00+08:00"}},date,knownBy);
  assert.equal(v.feedback,0);
  assert.equal(v.broken,null);
  assert.equal(v.dragon,null);
  assert.ok(v.gaps.some(g=>g.includes("龙虎榜")));
  assert.equal(frameFromResults({cn_shortline_daily:{...result,fetched_at:date+"T14:56:00+08:00"}},date,knownBy).feedback,null);
  const first=buildMentorInsight(pack,date,v,[],new Date(knownBy));
  const revisit=buildMentorInsight(pack,date,v,[],new Date(knownBy+86_400_000));
  assert.equal(first.asOf, new Date(result.fetched_at).toISOString());
  assert.equal(first.asOf,revisit.asOf);
});
test("离线周末需要有实际落盘的最后一场定稿，周一不把周五数据当成周一",t=>{
  const dataRoot=mkdtempSync(join(tmpdir(),"mentor-calendar-"));
  t.after(()=>rmSync(dataRoot,{recursive:true,force:true}));
  const ctx={dataRoot,repoRoot:"",python:"",node:""};
  const weekend=new Date("2026-11-21T10:00:00+08:00");
  assert.equal(cachedReviewDay(ctx,weekend),null);
  const endpoint="cn_shortline_daily";
  writeSnapshot(dataRoot,snapshotKey(endpoint,"",{date}),{endpoint,symbol:""},{
    fetched_at:date+"T16:01:00+08:00",envelope:{status:"ok",extra:{date,settled:true},
      evidence:[{period:date,field:"money_effect_median_ret",value:-2}]}},()=>true);
  assert.equal(cachedReviewDay(ctx,weekend),date);
  assert.equal(cachedReviewDay(ctx,new Date("2026-11-23T17:00:00+08:00")),null);
});
test("周末和盘中沿用日历给出的上一个已收盘业务日",()=>{
  const bars=Array.from({length:21},(_,i)=>({date:"2026-10-"+String(i+1).padStart(2,"0"),close:3200+i}));
  const result=marketComparison(bars,[],"2026-10-21T18:00:00+08:00",new Date("2026-10-24T12:00:00+08:00"),"2026-10-21");
  assert.equal(result.status,"ready");
  assert.equal(result.date,"2026-10-21");
});
