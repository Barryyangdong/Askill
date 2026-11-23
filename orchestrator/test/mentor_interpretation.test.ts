import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import type { lightChatTurn } from "../src/light_chat.ts";
import { createApiServer } from "../src/api.ts";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { removeTestTemp } from "./helpers/temp_cleanup.ts";
import { askMentor, savedSynthesis, synthesizeMentor } from "../src/finance/mentor_interpretation.ts";
import { buildMentorInsight } from "../src/finance/mentor_insight.ts";
import { emptyFrame } from "../src/finance/mentor_insight_market.ts";
import { mentorRoute, type MentorPack } from "../src/finance/mentors.ts";

const repoRoot = fileURLToPath(new URL("../../",import.meta.url));
const pack:MentorPack = JSON.parse(fs.readFileSync(path.join(repoRoot,"knowledge","mentors","tuixue.json"),"utf8"));
function context(t:TestContext) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(),"vra-mentor-interpretation-"));
  t.after(()=>removeTestTemp(dataRoot));
  return {dataRoot,repoRoot,python:"python",node:process.execPath};
}
test("六万字公开材料可经页面使用的 HTTP 入口导入",async t=>{
  const ctx = context(t);
  const token = randomUUID();
  const server = createApiServer(ctx,{token});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const url = "http://127.0.0.1:"+(server.address() as AddressInfo).port+"/mentors/tuixue/materials";
    const response = await fetch(url,{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
      body:JSON.stringify({kind:"statement",publicSource:true,title:"资料长度验收",sourceUrl:"https://example.org/long",publishedAt:"2017-07-10",text:"收盘观察。".repeat(12_000)})});
    const result = await response.json();
    assert.equal(response.status,200,result.error);
    assert.equal(result.version,1);
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});
test("人物注册、资料修订和追问只使用所选复盘日可见的版本，保留同名人物",async t=>{
  const ctx = context(t);
  const call = (parts:string[],body:Record<string,unknown>)=>mentorRoute(ctx,"POST",parts,async()=>body);
  const created = await call([],{name:"研究人物"});
  assert.deepEqual(await call([],{name:"研究人物"}),created);
  const info = JSON.parse(JSON.stringify(created));
  assert.match(info.id,/^person-/);
  const base = {kind:"statement",publicSource:true,title:"公开谈话",sourceUrl:"https://example.org/interview",text:"只有市场广度得到确认，我才会再研究题材。"};
  await call(["tuixue","materials"],{...base,publishedAt:"2017-07-13T10:00"});
  await call(["tuixue","materials"],{...base,publishedAt:"2017-07-14T18:00",text:"之后才公布的修订。"});
  const view = JSON.parse(JSON.stringify(await call(["tuixue","insight"],{date:"2017-07-14"})));
  assert.match(JSON.stringify(view.observations),/只有市场广度得到确认/);
  assert.doesNotMatch(JSON.stringify(view),/之后才公布/);
  const ask = await call(["tuixue","ask"],{date:view.date,basis:view.basis,question:"公开谈话里怎么说市场广度？"});
  assert.match(JSON.stringify(ask),/只有市场广度得到确认/);
  await assert.rejects(call(["tuixue","ask"],{date:view.date,basis:"旧快照",question:"依据"}),/依据已更新/);
  assert.deepEqual(await mentorRoute(ctx,"GET",[info.id,"materials"],async()=>({})),{version:0,materials:[]});
});
test("人物自由追问可顺着前文列出八个已披露反例，同时保留时间边界",async t=>{
  const ctx = context(t);
  const ask = (date:string)=>askMentor(ctx,pack,buildMentorInsight(pack,date,emptyFrame()),{
    question:"哪些天是反例？",history:["下跌家数超过上涨家数三倍，会暂缓开新仓吗？"],
  });
  const reply = await ask("2026-11-20");
  assert.equal(reply.evidence.length,8);
  assert.match(reply.text,/英维克/);
  assert.ok((await ask("2017-05-23")).evidence.every(e=>e.date<="2017-05-23"));
});
test("深入研判按人物、快照和大脑复用；伪造引用没有进入档案",async t=>{
  const ctx = context(t);
  const view = buildMentorInsight(pack,"2017-07-14",emptyFrame());
  let calls = 0;
  const engine:typeof lightChatTurn = async (opts)=>{
    calls++;
    const refs = opts.reportSources!.map(s=>"[资料:"+s.id+" p.-]").join(" ");
    return {reply:"历史案例可与收盘读数对照。"+refs,redacted:0,duration_ms:1,session:"test"};
  };
  const input = {llm:{provider:"local-codex"}};
  const [one,two] = await Promise.all([1,2].map(()=>synthesizeMentor(ctx,pack,view,"abc",input,engine)));
  assert.equal(one.mode,"ai");assert.deepEqual(two,one);assert.equal(calls,1);
  assert.deepEqual(savedSynthesis(ctx,pack,view.date,"abc"),one);
  assert.deepEqual(savedSynthesis(ctx,pack,view.date,"abc",input.llm),one);
  assert.equal(savedSynthesis(ctx,pack,view.date,"abc",{provider:"local-claude"}),undefined);
  await synthesizeMentor(ctx,pack,view,"abc",input,engine);assert.equal(calls,1);
  const oldFile = path.join(ctx.dataRoot,"mentor-synthesis",pack.id,view.date,"abc.json");
  const [old] = JSON.parse(fs.readFileSync(oldFile,"utf8"));
  delete old.groundingVersion;
  fs.writeFileSync(oldFile,JSON.stringify([old]));
  assert.equal(savedSynthesis(ctx,pack,view.date,"abc"),undefined);
  await synthesizeMentor(ctx,pack,view,"abc",input,engine);assert.equal(calls,2);
  const fake:typeof engine = async ()=>({reply:"[资料:00000000000000000000000000000000 p.-]",redacted:0,duration_ms:1,session:"test"});
  const rejected = await synthesizeMentor(ctx,pack,view,"changed",input,fake);
  assert.equal(rejected.mode,"local");
  assert.equal(savedSynthesis(ctx,pack,view.date,"changed"),undefined);
  const disconnected:typeof engine = async opts=>{
    const market = opts.reportSources!.find(s=>s.name==="市场广度")!;
    const person = opts.reportSources!.find(s=>s.id!==market.id && !s.name.includes("近涨停组"))!;
    return {reply:`市场上涨覆盖有限[资料:${market.id} p.-]。人物留下过公开材料[资料:${person.id} p.-]。`,
      redacted:0,duration_ms:1,session:"test"};
  };
  assert.equal((await synthesizeMentor(ctx,pack,view,"disconnected",input,disconnected)).mode,"local");
  let attempts = 0;
  const repair:typeof engine = async (opts,req)=>{
    attempts++;
    if (attempts===1)
      return {reply:"只有市场描述，并且没有引用。",redacted:0,duration_ms:1,session:"test"};
    assert.match(req.message,/上一稿未通过校验/);
    assert.match(req.message,/不要写标题、列表、精确数字/);
    const citations = opts.reportSources!.map(source=>`[资料:${source.id} p.-]`).join("");
    return {reply:"结合人物的观察方法与当天盘面，仍需确认题材里是否有更多股票跟上"+citations+"。",
      redacted:0,duration_ms:1,session:"test"};
  };
  const repaired = await synthesizeMentor(ctx,pack,view,"repair",input,repair);
  assert.equal(repaired.mode,"ai");
  assert.equal(attempts,2);
  assert.deepEqual(savedSynthesis(ctx,pack,view.date,"repair",input.llm),repaired);
  assert.equal(rejected.text,"", "拒绝稿不能用程序观点替代");
  const noProfile = {...view,evidence:view.evidence.filter(e=>e.kind==="market")};
  const count = calls;
  const missing = await synthesizeMentor(ctx,pack,noProfile,"missing",input,engine);
  assert.equal(missing.mode,"local");
  assert.match("note" in missing ? missing.note ?? "" : "",/资料不足/);
  assert.equal(calls,count);
});

test("自动研判送入当日复盘与已公开资料，材料更新后才重新生成",async t=>{
  const ctx = context(t);
  const day = "2017-07-14";
  const material = {kind:"statement",publicSource:true,title:"复盘访谈",sourceUrl:"https://example.org/market-talk",
    publishedAt:"2017-07-13T12:00",text:"我先看昨日强势股反馈，也会观察同题材的跟随。"};
  const received:string[] = [];
  const model = createServer(async (req,res)=>{
    let raw = "";
    for await (const part of req) raw += part;
    received.push(raw);
    const refs = [...new Set(raw.match(/\[资料:[a-f0-9]{32} p\.-\]/g))].join(" ");
    res.setHeader("Content-Type","application/json");
    const grounded = "综合看当日盘面和人物材料，题材延续还需要核对"+refs+"。";
    const content = received.length===1 ? "这份初稿缺少引用。" : received.length===3
      ? "先说一条没有引用的观点。"+grounded+"2026-12-25 他买入了 999999 "+refs+"。"
      : grounded;
    res.end(JSON.stringify({choices:[{message:{content}}]}));
  });
  await new Promise<void>(resolve=>model.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise<void>(resolve=>model.close(()=>resolve())));
  const llm = {provider:"custom",baseURL:`http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`,apiKey:"mentor-test-key",model:"fixture"};
  const call = (action:string,body:Record<string,unknown>)=>mentorRoute(ctx,"POST",["tuixue",action],async()=>body,
  ).then(value=>JSON.parse(JSON.stringify(value)));
  await call("materials",material);
  await call("materials",{...material,publishedAt:"2017-07-14T18:00",text:"次日才披露的访谈"});
  const first = await call("insight",{date:day,llm});
  assert.equal(first.synthesis,undefined);
  assert.equal((await call("synthesis",{date:day,basis:first.basis,llm})).mode,"ai");
  assert.equal((await call("insight",{date:day,llm})).synthesis.mode,"ai");
  assert.equal(received.length,2);
  assert.match(received[1],/上一稿未通过校验/);
  assert.match(received[0],/昨日强势股反馈/);
  assert.doesNotMatch(received[0],/次日才披露的访谈/);
  await call("materials",{...material,title:"早前访谈补录",text:"我还观察昨日强势股反馈和板块内涨停家数。"});
  const changed = await call("insight",{date:day,llm});
  assert.notEqual(changed.basis,first.basis);
  assert.equal(changed.synthesis,undefined);
  const partial = await call("synthesis",{date:day,basis:changed.basis,llm});
  assert.equal(partial.mode,"ai");
  assert.match(partial.text,/题材延续还需要核对/);
  assert.doesNotMatch(partial.text,/没有引用|2026-12-25|999999/);
  assert.match(partial.note,/其余表述未展示/);
  assert.deepEqual((await call("insight",{date:day,llm})).synthesis,partial);
  assert.equal(received.length,3);
});
