import assert from "node:assert/strict";
import test from "node:test";
import { shortlineGroup } from "../src/finance/mentor_shortline.ts";

test("盘面只读目标日收盘定稿，区分真实零与缺失", () => {
  const panel = {endpoint:"cn_shortline_daily",title:"情绪与接力反馈",source:"短线王每日情绪 · 东财涨停池及昨日涨停股表现"} as const;
  const date = "2026-11-19";
  const envelope = {status:"ok",extra:{date,settled:true},evidence:[
    {period:"2026-11-18",field:"limit_up_count",value:70},
    {period:date,field:"limit_up_count",value:0},
    {period:date,field:"broken_rate",value:0.25},
  ]};
  const result = shortlineGroup(panel,date,envelope);
  assert.equal(result.rows.find(r=>r.label==="涨停家数")?.value,"0家");
  assert.equal(result.rows.find(r=>r.label==="炸板率")?.value,"25.0%");
  assert.equal(result.rows.find(r=>r.label==="最高连板")?.value,"缺数据");
  assert.deepEqual(shortlineGroup(panel,date,{...envelope,extra:{date,settled:false}}).rows,[]);
});
