import test from "node:test";
import assert from "node:assert/strict";
import "../src/finance/register.ts";
import {evaluateRule} from "../src/finance/observation_rules.ts";
const quote={name:"公开样例",price:10,pct:2,amount_yuan:5000000,limit_up:11,quote_time:"20261116093030"};
test("conditions only evaluate fresh post-creation readings; missing never becomes zero",()=>{
  const rule={metric:"price" as const,operator:"gte" as const,value:10};
  const now=new Date("2026-11-16T09:31:00+08:00");
  assert.equal(evaluateRule(rule,quote,now,"2026-11-16T09:30:00+08:00").status,"triggered");
  assert.equal(evaluateRule(rule,quote,now,"2026-11-16T09:30:45+08:00").status,"unknown");
  assert.equal(evaluateRule(rule,{...quote,price:null},now,"2026-11-15").status,"unknown");
  assert.equal(evaluateRule(rule,quote,new Date("2026-11-16T10:00:00+08:00"),"2026-11-15").status,"unknown");
  assert.equal(evaluateRule({...rule,value:11},quote,now,"2026-11-15").status,"waiting");
});
