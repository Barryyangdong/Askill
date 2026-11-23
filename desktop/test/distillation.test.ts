import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { withRenderer, textOf } from "./helpers/render.ts";

test("游资研习在初答前隐藏实盘结果，下一题推荐排除已看提示的样本", async () => {
  await withRenderer(async renderer => {
    const page = await renderer.load("/src/verticals/finance/pages/Distillation.tsx");
    const lesson = { id: "a", date: "2017-06-01", nextDate: "2017-06-02", prompt: "是否新增持仓？", market: {pct:1,d5:2,d20:3}, positionPct:50,holdingCount:1 };
    const first = textOf(renderer.html(page.LessonPanel, { id:"tuixue",lesson,update:()=>{} }));
    assert.match(first,/保存初答并揭晓/);
    assert.doesNotMatch(first,/实盘揭晓|核对成交来源/);
    const answer = {caseId:"a",at:"2017-06-01",hinted:false,choice:"unknown",reason:"涨幅大",condition:"跌破均线",feedback:"核对持仓",reveal:{summary:"当日未开新仓",sources:["交割单原始行"]}};
    const reveal = textOf(renderer.html(page.LessonPanel,{id:"tuixue",lesson,answer,update:()=>{}}));
    assert.match(reveal,/当日未开新仓/);
    assert.match(reveal,/交割单原始行/);
    const guide = textOf(renderer.html(page.PracticeGuide,{profile:{attempts:[answer],cases:[lesson,{...lesson,id:"b",hinted:true,date:"2017-06-05"},{...lesson,id:"c",date:"2017-06-08"}]},open:()=>{}}));
    assert.match(guide,/原持仓/);
    assert.match(guide,/2017-06-08/);
    assert.doesNotMatch(guide,/2017-06-05/);
  });
});

test("方法卡默认展示原话、方法边界及可独立练习的日期，实盘动作需主动揭晓", async () => {
  await withRenderer(async renderer => {
    const ui = await renderer.load("/src/verticals/finance/components/MentorLearning.tsx");
    const profile = {
      id: "sample", behavior: {title:"他新开的股票，上一日有多强？",scope:"同日样本",metrics:[{label:"涨幅",value:"4.2%",comparison:"对照中位数 0.8%"}],source:"交割单",interpretation:"用于描述选择"}, quotes: [{ date:"2017-05-10",text:"示例讨论原文",source:"主题楼层",url:"https://example.org/a" }],
      methods:[{id:"m",title:"如何观察仓位",quoteDate:"2017-05-10",pairedEvidence:{date:"2017-05-10",stock:"历史样例",source:"源图定位",note:"原帖与快照同日同标的"},testResult:{total:8,known:7,support:4,counter:3},principle:"示例原则",trigger:"观察变化",limits:"缺少同期成交量",exampleIds:["c"]}],
      cases:[{id:"c",date:"2017-05-12",reveal:{summary:"实际开仓信息"}}]
    };
    const view = textOf(renderer.html(ui.MethodsPanel, {profile,practice:()=>{},onHint:()=>{}}));
    assert.match(view,/同日同标的/);
    assert.match(view,/对照中位数 0.8%/);
    assert.match(view,/可核定 7 日/);
    assert.match(view,/示例讨论原文/);
    assert.match(view,/缺少同期成交量/);
    assert.match(view,/练习这个现场/);
    assert.doesNotMatch(view,/实际开仓信息|支持案例|边界与反例/);
    const scene = textOf(renderer.html(ui.HistoricalScene,{ lesson: {market:{pct:-1,d5:2},scene:{asOf:"2017-05-12",metrics:[{key:"fall",label:"下跌家数",value:320,unit:"家",definition:"收盘下跌家数",source:"数据源"}],missing:[{label:"连板梯队",reason:"未取得日内明细"}]}} }));
    assert.match(scene,/320家/);
    assert.match(scene,/收盘下跌家数/);
    assert.match(scene,/未取得日内明细/);
    const today = textOf(renderer.html(ui.ShortlineScene,{today:{ shortline:{date:"2017-05-12",groups:[{title:"情绪",source:"归档",rows:[{label:"涨停",value:"25 家"}],gap:null},{title:"题材",source:"归档",rows:[],gap:"当日题材未归档"}]}}}));
    assert.match(today,/25 家/);
    assert.match(today,/当日题材未归档/);
  });
});



test("研判独立页加载时展示标题并保留读取状态",async()=>{
 await withRenderer(async r=>{
  const {Distillation}=await r.load('/src/verticals/finance/pages/Distillation.tsx');
  const { MemoryRouter } = await r.load('react-router-dom');
  const html=r.html(() => createElement(MemoryRouter, {}, createElement(Distillation)),{});assert.match(html,/<h1[^>]*>游资研判<\/h1>/);
  assert.match(textOf(html),/正在读取资料/);assert.doesNotMatch(textOf(html),/蒸馏游资/);
 });
});

test('研判保留收盘事实和可核对的来源，旧的本地推演不会顶替 AI 观点', async () => {
  await withRenderer(async r => {
    const {InsightReport} = await r.load('/src/verticals/finance/components/MentorInsight.tsx');
    const data = {mentorName:'人物甲', version:'1.2', date:'2017-05-12', asOf:'2017-05-12T15:00:00+08:00', status:'partial',
      headline:'昨日强势股的反馈减弱', summary:'本日资料覆盖不全', observations:[{title:'观察延续性',text:'昨日强势股承压',evidenceIds:['p1']}],
      reasoning:{title:'先看同题材有多少股票跟上',text:'题材中的其他股票需要同步走强',evidenceIds:['p1']},
      counterpoints:[{title:'相同条件下也有例外',text:'历史行为存在分歧',evidenceIds:['c1']}],gaps:['当日缺少题材成分'],
      evidence:[{id:'p1',kind:'market',title:'昨日涨停股收益',date:'2017-05-12'},{id:'c1',kind:'case',title:'历史成交记录', date:'2017-05-08'}]};
    const view = textOf(r.html(InsightReport,{data}));
    for (const fragment of ['收盘事实','昨日强势股的反馈减弱','部分数据待补','当日盘面','昨日涨停股收益','人物材料与历史成交','历史成交记录','当日缺少题材成分']) assert.ok(view.includes(fragment), fragment);
    assert.doesNotMatch(view, /人物甲的观察方法|先看同题材有多少股票跟上|观察延续性|相同条件下也有例外/);
    const saved = textOf(r.html(InsightReport, {data:{...data,synthesis:{mode:'ai',text:'先看前排股票能否带动同题材走强。',evidenceIds:['p1']}}}));
    assert.ok(saved.indexOf('先看前排股票能否带动同题材走强。') > 0);
    assert.ok(saved.indexOf('先看前排股票能否带动同题材走强。') < saved.indexOf('收盘事实'));
  });
});

test('同一人物、日期、证据和模型共享研判请求，切换模型后重新查找', async t => {
  const savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let model = 'mentor-model-a';
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:{getItem:() => JSON.stringify({
    provider:'openai-compatible', baseURL:'https://example.org/v1', apiKey:'test-key', model,
  })}});
  t.after(() => {
    if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  const calls: {url:string;body:{llm:{model:string};basis?:string}}[] = [];
  t.mock.method(globalThis, 'fetch', async (url:string, init:RequestInit) => {
    calls.push({url,body:JSON.parse(init.body as string)});
    return Response.json(url.endsWith('/insight') ? {status:'ready'} : {mode:'ai',text:'证据支持的观点',evidenceIds:[]});
  });
  await withRenderer(async r => {
    const {mentorApi} = await r.load('/src/verticals/finance/lib/distillation.ts');
    const day = '2020-05-12';
    await mentorApi.insight('sample', day);
    await Promise.all([mentorApi.synthesize('sample', day, 'source-a'), mentorApi.synthesize('sample', day, 'source-a')]);
    assert.equal(mentorApi.cachedSynthesis('sample', day, 'source-a').mode, 'ai');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.llm.model, 'mentor-model-a');
    assert.equal(calls[1].body.basis, 'source-a');
    model = 'mentor-model-b';
    assert.equal(mentorApi.cachedSynthesis('sample', day, 'source-a'), undefined);
    await mentorApi.insight('sample', day);
    await mentorApi.synthesize('sample', day, 'source-a');
    assert.deepEqual(calls.slice(2).map(call=>call.body.llm.model), ['mentor-model-b','mentor-model-b']);
  });
});

test('解读正文以可展开的短编号展示经过核对的引用', async () => {
  await withRenderer(async r => {
    const {AnswerText} = await r.load('/src/verticals/finance/components/MentorInsight.tsx');
    const id = 'abcd'.repeat(8), tag = '[资料:' + id + ' p.-]';
    const html = r.html(AnswerText, {reply:{text:'样本覆盖有限。'+tag+'还有另一处观察。'+tag}, evidence:[]});
    assert.equal((html.match(/aria-label="核对引用 1"/g) ?? []).length, 2);
    assert.doesNotMatch(textOf(html), /资料:abcd/);
  });
});

test('人物原文草稿可解码券商 GB18030 文本和 UTF-8，并限制预览长度', async () => {
  await withRenderer(async r => {
    const {decodePublicMaterial} = await r.load('/src/verticals/finance/components/MentorMaterials.tsx');
    assert.equal(decodePublicMaterial(Uint8Array.from([0xc8,0xd5,0xc6,0xda])), '日期');
    assert.equal(decodePublicMaterial(new TextEncoder().encode('示例人物原话')), '示例人物原话');
    assert.throws(() => decodePublicMaterial(new Uint8Array([97,0,98])), /文本格式/);
    assert.throws(() => decodePublicMaterial(new TextEncoder().encode('a'.repeat(60_001))), /6 万/);
  });
});
