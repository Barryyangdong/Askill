import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mentorRoute } from "../src/finance/mentors.ts";

test("independent attempts stay blind, survive retries and keep separate revisions", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),"mentor-route-"));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const dir = path.join(root,"knowledge","mentors");
  fs.mkdirSync(dir,{recursive:true});
  const pack = {id:"example",name:"样例",summary:"",version:"1",quotes:[],
    cases:[{id:"lesson",date:"2017-05-03",nextDate:"2017-05-04",prompt:"提问",market:{pct:1,d5:1,d20:0},
      positionPct:0,holdingCount:0,reveal:{action:"open",summary:"揭晓专用",sources:["可信原件"]}}]};
  fs.writeFileSync(path.join(dir,"example.json"),JSON.stringify(pack));
  const ctx = {repoRoot:root,dataRoot:path.join(root,"local"),python:"python",node:process.execPath};
  const get = () => mentorRoute(ctx,"GET",["example"],async()=>({}));
  const post = (op:string, fields:Record<string,unknown>) => mentorRoute(ctx,"POST",["example",op],async()=>fields);
  assert.doesNotMatch(JSON.stringify(await get()),/揭晓专用|可信原件/);
  await assert.rejects(post("coach",{caseId:"lesson"}),/先独立提交/);
  const original = {caseId:"lesson",choice:"unknown",reason:"样本太少",condition:"核对市场宽度"};
  const entry = await post("attempt",original);
  assert.match(JSON.stringify(entry),/揭晓专用/);
  assert.deepEqual(await post("attempt",{...original,choice:"open"}),entry);
  await post("revise",{caseId:"lesson",revision:"记录起始仓位"});
  assert.match(JSON.stringify(await get()),/记录起始仓位/);
  assert.match(JSON.stringify(await get()),/样本太少/);
  await assert.rejects(mentorRoute(ctx,"GET",[".."],async()=>({})),/人物编号/);
  assert.equal(fs.readdirSync(path.join(ctx.dataRoot,"mentor-study")).length,1);
});

test("speech-only mentor has no exercises or data from other mentors",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"mentor-speech-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const dir=path.join(root,"knowledge","mentors");fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,"speech.json"),JSON.stringify({id:"speech",name:"发言",version:"1",summary:"",quotes:[],cases:[]}));
  fs.writeFileSync(path.join(dir,"bad.json"), "{");
  fs.writeFileSync(path.join(dir,"other.json"),JSON.stringify({id:"other",name:"损坏",version:"1",summary:"",quotes:[],cases:[{id:"wrong"}]}));
  const ctx={repoRoot:root,dataRoot:path.join(root,"local"),python:"python",node:process.execPath};
  await assert.rejects(mentorRoute(ctx,"GET",["other"],async()=>({})),/资料包格式异常/);
  assert.deepEqual(await mentorRoute(ctx,"GET",[],async()=>({})),{mentors:[{id:"speech",name:"发言",summary:"",version:"1",quoteCount:0,caseCount:0}]});
  await assert.rejects(mentorRoute(ctx,"POST",["speech","attempt"],async()=>({caseId:"other"})),/未找到历史案例/);
});

test("revealing an analogy labels subsequent work; coach input excludes private answers",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"mentor-privacy-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const dir=path.join(root,"knowledge","mentors");fs.mkdirSync(dir,{recursive:true});
  const item={id:"k",date:"2017-06-09",nextDate:"2017-06-12",prompt:"选择",market:{pct:1,d5:0,d20:0},holdingCount:1,positionPct:20,
    reveal:{action:"open",summary:"公开的历史动作",sources:["公开出处"]}};
  fs.writeFileSync(path.join(dir,"person.json"),JSON.stringify({id:"person",name:"案例",version:"2",summary:"",quotes:[],cases:[item]}));
  const ctx={repoRoot:root,dataRoot:path.join(root,"local"),python:"python",node:process.execPath};
  let date="2025-03-03",sent="";
  let status:"ready"|"unavailable"="ready";
  const services={
    shortline:async (_ctx:unknown,date:string)=>({date,groups:[]}),
    today:async()=>({date,status,asOf:date+"T15:00:00+08:00",summary:"公开的历史动作",market:item.market,
      matches:[{caseId:"k",date:item.date,action:"open",summary:"公开的历史动作"}]}),
    coach:async (_ctx:unknown,req:{message:string})=>{sent=req.message;return {reply:"模型追问",session:"mentor",redacted:0,duration_ms:1}},
  };
  const request=(method:string,route:string,body:Record<string,unknown>={})=>mentorRoute(ctx,method,["person",route],async()=>body,services);
  assert.doesNotMatch(JSON.stringify(await request("GET","today")),/公开的历史动作/);
  assert.match(JSON.stringify(await request("POST","today")),/公开的历史动作/);
  const input={caseId:"k",choice:"open",reason:"指数 private-alpha",condition:"如果 private-beta"};
  assert.match(JSON.stringify(await request("POST","attempt",input)),/"hinted":true/);
  assert.match(JSON.stringify(await request("POST","plan",{...input,date,hinted:false})),/"hinted":true/);
  await assert.rejects(request("POST","review",{date,review:"事后复核"}),/下一交易日/);
  date="2025-03-04";
  assert.match(JSON.stringify(await request("POST","review",{date:"2025-03-03",review:"事后复核"})),/事后复核/);
  const plan={...input,date,reason:"独立计划"};
  assert.doesNotMatch(JSON.stringify(await request("GET","today")),/公开的历史动作/);
  assert.match(JSON.stringify(await request("POST","plan",plan)),/"hinted":false/);
  await request("POST","today");
  const retry=await request("POST","plan",{...plan,reason:"重复提交"});
  assert.match(JSON.stringify(retry),/独立计划/);
  const saved=JSON.parse(JSON.stringify(retry));
  assert.deepEqual(saved.market,item.market);
  assert.equal(saved.asOf,"2025-03-04T15:00:00+08:00");
  assert.doesNotMatch(JSON.stringify(retry),/重复提交/);
  date="2025-03-05";
  status="unavailable";
  await assert.rejects(request("POST","plan",{...plan,date}),/完整收盘数据/);
  await request("POST","coach",{caseId:"k"});
  assert.doesNotMatch(sent,/private-|事后复核/);
  assert.match(sent,/提示后作答/);
  assert.match(sent,/提及指数/);
});


test("methods hide evidence roles until opened and preserve the original hint status",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"mentor-method-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const dir=path.join(root,"knowledge","mentors");fs.mkdirSync(dir,{recursive:true});
  const ctx={repoRoot:root,dataRoot:path.join(root,"local"),python:"python",node:process.execPath};
  const scene={asOf:"2017-06-09T15:00:00+08:00",metrics:[{key:"width",label:"收盘宽度",value:30,unit:"只",definition:"当日口径",source:"当日行",members:["000001","600002"]}],missing:[]};
  const item={id:"bbb",date:"2017-06-09",nextDate:"2017-06-12",prompt:"选择",market:{pct:1,d5:0,d20:0},holdingCount:1,positionPct:20,scene,
    reveal:{action:"open",summary:"结局已展开",sources:["公开出处"]}};
  const method={id:"practice",title:"区分新开仓",principle:"分辨动作",limits:"语境有限",trigger:"有完整持仓",quoteDate:"2015-01-01",
    support:{caseId:"bbb",note:"独有的支持证据"},counter:{caseId:"aaa",note:"独有的边界证据"}};
  const pack={id:"subject",name:"案例",version:"3",summary:"",quotes:[{date:method.quoteDate,text:"反思",source:"楼层",url:"https://example.org/1"}],
    behavior:{title:"实盘画像",scope:"已观测样本",metrics:[{label:"前日强弱",value:"样本中位数",comparison:"同日市场"}],interpretation:"仅描述行为",source:"归档记录"},
    methods:[method],cases:[item,{...item,id:"aaa"}]};
  const file=path.join(dir,"subject.json");fs.writeFileSync(file,JSON.stringify(pack));
  const detail=()=>mentorRoute(ctx,"GET",["subject"],async()=>({}));
  const post=(action:string,input:Record<string,unknown>)=>mentorRoute(ctx,"POST",["subject",action],async()=>input);
  const overview=JSON.stringify(await detail());
  assert.doesNotMatch(overview,/独有的支持证据|独有的边界证据|结局已展开|"support"|"counter"/);
  assert.match(overview,/"exampleIds":\["aaa","bbb"\]/);
  assert.match(overview,/收盘宽度/);
  assert.deepEqual(JSON.parse(overview).cases[0].scene.metrics[0].members,["000001","600002"]);
  assert.deepEqual(JSON.parse(overview).behavior,pack.behavior);
  const answer={choice:"unknown",reason:"观察",condition:"核对持仓"};
  await post("attempt",{caseId:"aaa",...answer});
  assert.match(JSON.stringify(await post("example",{caseId:"aaa",methodId:"practice"})),/"role":"counter"/);
  assert.match(JSON.stringify(await post("attempt",{caseId:"aaa",...answer})),/"hinted":false/);
  assert.match(JSON.stringify(await detail()),/已看配对案例/);
  assert.match(JSON.stringify(await post("example",{caseId:"bbb",methodId:"practice"})),/独有的支持证据/);
  const attempt=JSON.stringify(await post("attempt",{caseId:"bbb",...answer}));
  assert.match(attempt,/"hinted":true/);assert.match(attempt,/方法案例 · 区分新开仓/);
  item.scene.asOf="2017-06-12T15:00:00+08:00";
  fs.writeFileSync(file,JSON.stringify(pack));
  await assert.rejects(detail(),/资料包格式异常/);
});
