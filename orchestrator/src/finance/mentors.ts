import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readJson, sha256Text, writeJson } from "../fsutil.ts";
import { checkLlmShape, safePath, ServiceError, type ServiceContext } from "../service.ts";
import { lightChatTurn } from "../light_chat.ts";
import { mentorShortline } from "./mentor_shortline.ts";
import { mentorToday } from "./mentor_market.ts";
import { mentorInsight } from "./mentor_insight.ts";
import { importMentorMaterial, listMentorMaterials, mentorMaterialEvidence } from "./mentor_materials.ts";
import { askMentor, savedSynthesis, synthesizeMentor, withMaterialEvidence } from "./mentor_interpretation.ts";
import { itemsByDate, LEDGER_KIND, shortlineVerifyAct } from "./shortline/verification.ts";
import { ledgerList } from "../service.ts";

const idPattern = /^[a-z][a-z0-9_-]{0,63}$/;
const sourceUrl = z.url({protocol: /^https?$/});
const marketSchema = z.object({pct:z.number(), d5:z.number(), d20:z.number()});
const revealSchema = z.object({
  action:z.enum(["open","no_open","unknown"]), summary:z.string().trim().min(1),
  sources:z.array(z.string().trim().min(1)).min(1),
  sourcePosts:z.array(z.object({title:z.string().trim().min(1),url:sourceUrl})).optional(),
});
const label = z.string().trim().min(1);
const sceneSchema = z.object({
  asOf:label,
  metrics:z.array(z.object({key:label,label,value:z.number(),unit:z.string(),definition:label,source:label,
    members:z.array(z.string().regex(/^\d{6}$/)).max(4).optional()})),
  missing:z.array(z.object({label,reason:label})),
});
const exampleSchema = z.object({caseId:z.string().regex(idPattern),note:label});
const methodSchema = z.object({
  id:z.string().regex(idPattern),title:label,principle:label,trigger:label,limits:label,quoteDate:label,
  support:exampleSchema,counter:exampleSchema,
  pairedEvidence:z.object({date:z.iso.date(),stock:label,source:label,note:label}).optional(),
  testResult:z.object({total:z.int().nonnegative(),known:z.int().nonnegative(),
    support:z.int().nonnegative(),counter:z.int().nonnegative()})
    .refine(r=>r.total>=r.known && r.support+r.counter===r.known).optional(),
});
const lessonSchema = z.object({
  id:z.string().regex(idPattern), date:z.iso.date(), nextDate:z.iso.date(), prompt:z.string().trim().min(1),
  market:marketSchema, holdingCount:z.int().nonnegative(), positionPct:z.number().min(0).max(100), reveal:revealSchema, scene:sceneSchema.optional(),
}).refine(c => c.date < c.nextDate && (!c.scene || c.scene.asOf === c.date + "T15:00:00+08:00"));
const packSchema = z.object({
  id:z.string().regex(idPattern),name:z.string().trim().min(1),summary:z.string(),version:z.string().trim().min(1),
  validationSummary:z.string().optional(),
  behavior:z.object({title:label,scope:label,interpretation:label,source:label,
    metrics:z.array(z.object({label,value:label,comparison:label})).min(1)}).optional(),
  quotes:z.array(z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}(?: [0-2]\d:[0-5]\d)?$/),
    text:z.string().trim().min(1),source:z.string().trim().min(1),url:sourceUrl})),
  cases:z.array(lessonSchema),methods:z.array(methodSchema).default([]),
}).refine(p => {
  const ids = new Set(p.cases.map(c=>c.id));
  return ids.size === p.cases.length && new Set(p.methods.map(m=>m.id)).size === p.methods.length &&
    p.methods.every(m=>p.quotes.some(q=>q.date === m.quoteDate) &&
      m.support.caseId !== m.counter.caseId && ids.has(m.support.caseId) && ids.has(m.counter.caseId));
});
type Pack = z.infer<typeof packSchema>;
export type MentorPack = Pack;
type Reveal = z.infer<typeof revealSchema>;
type Choice = Reveal["action"];
export type MentorCase = z.infer<typeof lessonSchema>;
interface Answer { packVersion: string; choice: Choice; reason: string; condition: string; at: string; hinted: boolean }
interface Attempt extends Answer {
  caseId: string; hintSources?: string[]; reveal: Reveal; feedback: string; revision?: string; revisionAt?: string; coach?: string;
}
interface Plan extends Answer { date: string; market?: MentorCase["market"]; asOf?: string; review?: string; reviewAt?: string }
interface History { attempts: Attempt[]; plans: Plan[]; hintedCases: string[]; hintedDates: string[]; hintSources?: Record<string,string[]> }
function hintsFor(state:History, caseId:string):string[] {
  return state.hintSources && Object.hasOwn(state.hintSources,caseId) ? state.hintSources[caseId] : [];
}
function markHint(state:History, caseId:string, source:string) {
  if (!state.hintedCases.includes(caseId)) state.hintedCases.push(caseId);
  state.hintSources ??= {};
  const sources = hintsFor(state,caseId);
  if (!sources.includes(source)) state.hintSources[caseId] = [...sources,source];
}
function invalid(message: string): never { throw new ServiceError("bad_request", message); }
function field(body: Record<string, unknown>, key: string, limit = 1200): string {
  const v = body[key];
  if (typeof v !== "string" || !v.trim() || v.trim().length > limit) invalid("内容缺失或过长：" + key);
  return v.trim();
}
function answer(body: Record<string, unknown>, hinted: boolean, packVersion: string): Answer {
  const choice = body.choice;
  if (choice !== "open" && choice !== "no_open" && choice !== "unknown") invalid("请选择出手判断");
  return {choice, packVersion, reason: field(body, "reason"), condition: field(body, "condition"), hinted, at: new Date().toISOString()};
}
function history(file: string): History {
  if (!fs.existsSync(file)) return { attempts: [], plans: [], hintedCases: [], hintedDates: [] };
  return readJson<History>(file);
}
function loadPack(dir: string, id: string): Pack {
  if (!idPattern.test(id)) invalid("人物编号无效");
  const file = path.join(dir, id + ".json");
  if (!fs.existsSync(file)) invalid("没有找到该人物资料包");
  try {
    const pack = packSchema.parse(readJson(file));
    if (pack.id === id) return pack;
  } catch { /* Report a bounded user-facing error; never expose the raw source file. */ }
  return invalid("人物资料包格式异常：" + id);
}
function localFeedback(item: MentorCase, a: Answer): string {
  const diff = item.reveal.action === "unknown" ? "历史记录不足以核定动作。" : a.choice === item.reveal.action ? "你的选择与这次记录一致。" : "你的选择与这次记录有差异。";
  const inquiry = item.holdingCount > 0 ? "检查你的依据是否区分了原持仓与新开仓。" : "检查你的依据是否说明从空仓转为持仓需要观察什么。";
  return diff + inquiry + "回看你写的条件“" + a.condition.slice(0,160) + "”，它在下一交易日能被哪一项数据证实或推翻？";
}

export async function mentorRoute(ctx: ServiceContext, method: string, parts: string[], body: (maxBytes?: number) => Promise<Record<string, unknown>>,
  services = {today: mentorToday, coach: lightChatTurn, shortline:mentorShortline}) {
  const dir = path.join(ctx.repoRoot, "knowledge", "mentors");
  const customDir = safePath(ctx, "mentor-profiles");
  const files = (root: string) => fs.existsSync(root) ? fs.readdirSync(root).filter(name => /^[a-z][a-z0-9_-]*\.json$/.test(name)).sort() : [];
  const card = (p: Pack) => ({id:p.id, name:p.name, summary:p.summary, version:p.version, caseCount:p.cases.length, quoteCount:p.quotes.length});
  if (!parts.length && (method === "GET" || method === "POST")) {
    const mentors = [dir,customDir].flatMap(root => files(root).flatMap(name => {
      try {
        if (root === customDir) safePath(ctx, "mentor-profiles", name);
        return [card(loadPack(root, name.slice(0,-5)))];
      } catch (error) {
        if (!(error instanceof ServiceError)) throw error;
        return [];
      }
    }));
    if (method === "GET") return {mentors};
    const name = field(await body(), "name", 36).normalize("NFKC").trim();
    if (!name || /[\u0000-\u001f<>]/u.test(name)) invalid("人物名称含有无效字符");
    const existing = mentors.find(p => p.name === name);
    if (existing) return existing;
    const id = "person-" + sha256Text(name).slice(0, 20);
    const target = safePath(ctx, "mentor-profiles", id + ".json");
    if (!fs.existsSync(target)) writeJson(target, {id,name,version:"1",summary:"由本地收录的公开资料建立人物档案。",methods:[],quotes:[],cases:[]});
    return card(loadPack(customDir, id));
  }
  if (!parts[0] || parts.length > 2) invalid("无效的人物路径");
  const isCustom = /^person-[0-9a-f]{20}$/.test(parts[0]) && !fs.existsSync(path.join(dir, parts[0]+".json"));
  if (isCustom) safePath(ctx, "mentor-profiles", parts[0]+".json");
  const pack = loadPack(isCustom ? customDir : dir, parts[0]);
  const file = safePath(ctx, "mentor-study", pack.id + ".json");
  const action = parts[1];
  if (action === "materials") {
    if (method === "GET") return listMentorMaterials(ctx, pack.id);
    if (method === "POST") return importMentorMaterial(ctx, pack.id, await body(256 * 1024));
    invalid("资料操作无效");
  }
  if (method === "POST" && (action === "insight" || action === "ask" || action === "condition" || action === "synthesis")) {
    const input = await body();
    const date = action === "insight" && input.date === undefined ? undefined : field(input, "date", 10);
    const result = await mentorInsight(ctx, pack, date, undefined, action === "insight" && input.refresh === true);
    const insight = withMaterialEvidence(result, result.asOf ? mentorMaterialEvidence(ctx, pack.id, result.asOf, pack.cases) : [], pack);
    // A later wall clock on the same evening is not a change of evidence.
    const basis = sha256Text(JSON.stringify({...insight,asOf:undefined,evidence:insight.evidence.map(e=>({
      ...e,source:e.source.replace(/ · \d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/, ""),
    }))})).slice(0, 24);
    if (input.basis !== undefined && input.basis !== basis) throw new ServiceError("stale_mentor_basis","研判依据已更新，请刷新研判后重试。");
    function noteHints(caseIds: string[]) {
      if (!caseIds.length) return;
      const state = history(file);
      const added = caseIds.filter(id => !hintsFor(state,id).includes("人物研判对照"));
      if (!added.length) return;
      for (const id of added) markHint(state,id,"人物研判对照");
      writeJson(file,state);
    }
    if (action === "ask" || action === "synthesis") {
      const reply = action === "ask" ? await askMentor(ctx, pack, insight, input, services.coach)
        : await synthesizeMentor(ctx,pack,insight,basis,input,services.coach);
      noteHints(reply.evidence.flatMap(item => item.caseId ? [item.caseId] : []));
      return reply;
    }
    if (action === "condition") {
      const condition = insight.conditions.find(item => item.metric === input.metric);
      if (!condition) invalid("本次研判没有这条可验证的条件");
      await shortlineVerifyAct(ctx, {action:"append",date:insight.date,items:[condition]}, AbortSignal.timeout(60_000));
      return {date:insight.date,metric:condition.metric};
    }
    noteHints(insight.hintedCaseIds);
    const stored = insight.conditions.length ? itemsByDate(ledgerList(ctx, LEDGER_KIND)[LEDGER_KIND] ?? []).byDate.get(insight.date) ?? [] : [];
    return {...insight,basis,synthesis:savedSynthesis(ctx,pack,insight.date,basis,input.llm),savedMetrics:insight.conditions.filter(c => stored.some(s => s.metric === c.metric && s.direction === c.direction)).map(c => c.metric)};
  }
  if (method === "GET" && !action) {
    const state = history(file);
    return {id:pack.id,name:pack.name,summary:pack.summary,version:pack.version,quotes:pack.quotes,behavior:pack.behavior,
      methods:pack.methods.map(({support,counter,...method}) => ({
        ...method,exampleIds:[support.caseId,counter.caseId].sort(),
      })),
      cases:pack.cases.map(({id,date,nextDate,prompt,market,holdingCount,positionPct,scene}) =>
        ({id,date,nextDate,prompt,market,holdingCount,positionPct,scene,hinted:state.hintedCases.includes(id),hintSources:hintsFor(state,id)})),
      attempts:state.attempts, plans:state.plans};
  }
  if (action === "today" && (method === "POST" || method === "GET")) {
    const today = await services.today(ctx, pack.cases);
    const shortline = today.date && today.status !== "unavailable"
      ? await services.shortline(ctx,today.date) : null;
    const validation = typeof pack.validationSummary === "string" ? pack.validationSummary : "";
    if (method === "GET") {
      const summary = today.matches.length ? "可展开历史对照，或先写下自己的判断。" : today.summary;
      return {...today, shortline, summary:summary + validation, matches:[]};
    }
    if (today.status === "ready" && today.date) {
      const state = history(file);
      state.hintedDates = [...new Set([...state.hintedDates, today.date])];
      for (const match of today.matches) markHint(state,match.caseId,"今日盘面对照");
      writeJson(file,state);
    }
    return {...today, shortline, summary:today.summary + validation};
  }
  if (method !== "POST") invalid("请求方法无效");
  const input = await body();
  if (action === "plan" || action === "review") {
    const date = field(input,"date",10);
    const today = await services.today(ctx,pack.cases);
    const state = history(file);
    let plan = state.plans.find(p=>p.date === date);
    if (action === "plan") {
      if (plan) return plan;
      if (today.date !== date || today.status !== "ready" || !today.asOf || !today.market) invalid("请使用已更新的完整收盘数据保存计划");
      plan = {date,market:today.market,asOf:today.asOf,...answer(input,state.hintedDates.includes(date),pack.version)};
      state.plans.push(plan);
    } else {
      if (!plan || today.status === "unavailable" || !today.date || today.date <= date) invalid("需要下一交易日的收盘数据后再复核计划");
      plan.review = field(input,"review"); plan.reviewAt = new Date().toISOString();
    }
    writeJson(file,state);
    return plan;
  }
  const item = pack.cases.find(c=>c.id === input.caseId);
  if (!item) invalid("未找到历史案例");
  const state = history(file);
  if (action === "example") {
    const method = pack.methods.find(m=>m.id === input.methodId);
    if (!method) invalid("未找到方法");
    const role = method.support.caseId === item.id ? "support" : method.counter.caseId === item.id ? "counter" : null;
    if (!role) invalid("此题不属于该方法");
    markHint(state,item.id,"方法案例 · " + method.title);
    // The two linked exercises form an explicit support/counter pair.
    // Opening either role also tells the learner the remaining exercise's role.
    const paired = role === "support" ? method.counter : method.support;
    markHint(state,paired.caseId,"已看配对案例 · " + method.title);
    writeJson(file,state);
    return {caseId:item.id,date:item.date,note:method[role].note,role,reveal:item.reveal,methodId:method.id};
  }
  let entry = state.attempts.find(a=>a.caseId === item.id);
  if (action === "attempt") {
    if (entry) return entry;
    const a = answer(input,state.hintedCases.includes(item.id),pack.version);
    entry = {...a,caseId:item.id,hintSources:[...hintsFor(state,item.id)],reveal:item.reveal,feedback:localFeedback(item,a)};
    state.attempts.push(entry);
    writeJson(file,state);
    return entry;
  }
  if (!entry) invalid("请先独立提交这道练习");
  if (action === "revise") {
    entry.revision = field(input,"revision"); entry.revisionAt = new Date().toISOString();
    writeJson(file,state);
    return entry;
  }
  if (action === "coach") {
    if (entry.coach) return {text:entry.coach};
    if (entry.packVersion !== pack.version) invalid("此练习来自较早的资料版本，请查看保存的历史反馈");
    const llm = checkLlmShape(input.llm);
    const reasoning = {
      choice: entry.choice,
      practice: entry.hinted ? "提示后作答" : "独立作答",
      reasonCategory: /指数|涨跌|涨幅|跌幅/.test(entry.reason) ? "提及指数" :
        /仓位|空仓|持仓/.test(entry.reason) ? "提及仓位" : "其他依据",
      conditionCategory: /如果|若|一旦|突破|跌破|超过|低于|高于/.test(entry.condition) ? "提及条件或阈值" : "其他表述",
    };
    const methods = pack.methods.filter(m=>m.support.caseId===item.id || m.counter.caseId===item.id)
      .map(m=>({title:m.title,principle:m.principle,limits:m.limits,
        example:m.support.caseId===item.id ? m.support.note : m.counter.note}));
    const message = "请根据下面的公开历史案例，结合学习者的选择与表述类别，用两句中文提出一个复盘问题，引导区分持仓与新开仓。仅讨论历史，避免代言和推荐。材料：" + JSON.stringify({date:item.date,prompt:item.prompt,action:item.reveal.action,summary:entry.reveal.summary,scene:item.scene,methods,reasoning});
    let text: string;
    try { text = (await services.coach(ctx,{llm,message,session:"mentor-coach"})).reply; }
    catch { throw new ServiceError("mentor_coach_unavailable","AI 教练暂不可用，请检查接入 AI。初答和本地反馈已保存。"); }
    const latest = history(file);
    const saved = latest.attempts.find(a=>a.caseId === item.id);
    if (!saved) invalid("初答已不存在，请刷新");
    saved.coach ??= text;
    writeJson(file,latest);
    return {text:saved.coach};
  }
  invalid("无效的学习操作");
}

