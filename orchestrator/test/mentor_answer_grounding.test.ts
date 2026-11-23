import assert from "node:assert/strict";
import test from "node:test";
import { askMentor, withMaterialEvidence } from "../src/finance/mentor_interpretation.ts";
import { buildMentorInsight } from "../src/finance/mentor_insight.ts";
import { emptyFrame } from "../src/finance/mentor_insight_market.ts";
import type { MentorPack } from "../src/finance/mentors.ts";
import type { lightChatTurn } from "../src/light_chat.ts";

const ctx = { repoRoot:".", dataRoot:".", python:"python", node:process.execPath };
const person: MentorPack = { id:"example", name:"样例人物", summary:"", version:"1", quotes:[], methods:[], cases:[] };
const id = "a".repeat(32), citation = "[资料:"+id+" p.-]";
const view = withMaterialEvidence(buildMentorInsight(person,"2026-11-20",{
  ...emptyFrame(), breadth:70, feedback:2, sources:{cn_market_breadth_history:"广度统计",cn_shortline_daily:"情绪样本"},
}),[{ id,kind:"statement",date:"2026-11-18",title:"公开访谈",sourceUrl:"https://example.org/s",
  summary:"人物自述",excerpt:"我先观察成交量。",selfReported:true,topics:["量能"],citation,
}],person);
const engine = (text: string): typeof lightChatTurn => async () => ({reply:text,redacted:0,duration_ms:1,session:"test"});
const ask = (text: string) => askMentor(ctx,person,view,{question:"他说过怎样观察成交量？",llm:{provider:"local-codex"}},engine(text));

test("a real citation on one sentence never licenses a second unsupported claim or an invented trade",async ()=>{
  assert.equal((await ask("他先观察成交量。"+citation)).mode,"ai");
  assert.equal((await ask("他先观察成交量。"+citation+"\n他已经决定次日清仓。")).mode,"local");
  assert.equal((await ask("他先观察成交量。"+citation+"他已经决定次日清仓。"+citation)).mode,"local");
  assert.equal((await ask("他已经决定次日清仓。"+citation)).mode,"local");
});
test("a why-question with an unsupported premise or no information match abstains, without a generic market answer",async ()=>{
  const askLocal = (q:string) => askMentor(ctx,person,view,{question:q});
  const trade = await askLocal("为什么他昨天清仓了？");
  assert.match(trade.text,/无法核实.*2026-11-19/);
  assert.deepEqual(trade.evidence,[]);
  const outside = await askLocal("为什么他昨天跟家人吵架？");
  assert.match(outside.text,/没有找到/);
  assert.deepEqual(outside.evidence,[]);
  const relevant = await askLocal("他为什么观察成交量？");
  assert.match(relevant.text,/我先观察成交量/);
  assert.ok(relevant.evidence.some(e => e.id === id));
  assert.ok((await askLocal("怎么看今天的盘面？")).evidence.length>0);
});

test("a caveat in a separate clause cannot establish an unrelated trade or date",async ()=>{
  assert.equal((await ask("无法确认原因，但他已经决定次日清仓。"+citation)).mode,"local");
  assert.equal((await ask("他在2024-08-12表示先观察成交量。"+citation)).mode,"local");
  assert.equal((await ask("依据现有片段，无法确认他是否清仓。"+citation)).mode,"ai");
});
test("dated executions respect the stock code; a publication-day summary is not an execution",async ()=>{
  const imported = [
    {id:"b".repeat(32),date:"2026-11-18",summary:"公开交割摘录记录 买入 000001",excerpt:"2026-11-18 · 000001 · 买入"},
    {id:"c".repeat(32),date:"2026-11-19",summary:"样本内存在跨日重复买入",excerpt:"多次买入000001",basisIds:["b".repeat(32)]},
  ].map(row=>({...row,kind:"trades" as const,title:"交易资料",sourceUrl:"https://example.org/trades",
    topics:["披露成交"],selfReported:false,citation:"[资料:"+row.id+" p.-]"}));
  const tradeView = withMaterialEvidence(view,imported,person);
  const query = (question:string)=>askMentor(ctx,person,tradeView,{question});
  assert.equal((await query("他在2026-11-18买入600002了吗？")).evidence.length,0);
  assert.equal((await query("他在2026-11-19买入000001了吗？")).evidence.length,0);
  assert.equal((await query("他在2026-11-18买入000001了吗？")).evidence.length,1);
});
