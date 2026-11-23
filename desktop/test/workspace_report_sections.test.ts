import {test} from "node:test";
import assert from "node:assert/strict";
import {withRenderer,textOf} from "./helpers/render.ts";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";

test("研究报告目录对应原文标题，附录默认收起", async()=>withRenderer(async r=>{
 const {ResearchReport}=await r.load("/src/verticals/finance/components/ResearchReport.tsx");
 const html=r.html(ResearchReport,{result:{run_id:"run-1",report:"## 核心结论\n\n正文\n\n### 风险\n\n说明",appendix:"## 附录\n\n证据",availability:"ready",run_status:"complete"}});
 assert.match(textOf(html),/报告目录/);assert.match(html,/href="#reference-.*heading-1"/);assert.match(html,/<h2 id="reference-.*heading-1"/);
 assert.match(html,/<details class="research-evidence rounded">/);assert.match(textOf(html),/正文/);
 const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
}));

test("研究报告的长围栏包含短围栏时目录仍对应正文", async()=>withRenderer(async r=>{
 const {ResearchReport}=await r.load("/src/verticals/finance/components/ResearchReport.tsx");
 const report="## Intro\n\n````markdown\n```\n## FENCED_ONLY\n````\n\n## RealResult";
 const html=r.html(ResearchReport,{result:{run_id:"SYNTHETIC-R1",report,appendix:"## 附录",availability:"ready",run_status:"complete"}});
 const nav=/<nav aria-label="报告目录"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
 assert.match(nav,/>Intro<\/a>/);assert.match(nav,/>RealResult<\/a>/);assert.doesNotMatch(nav,/FENCED_ONLY/);
 const targets=[...nav.matchAll(/href="#([^"]+)"/g)].map(m=>m[1]!);
 assert.equal(targets.length,2);
 for(const target of targets) {
   const matches=[...html.matchAll(/<h[23] id="([^"]+)"[^>]*>/g)].filter(m=>m[1]===target);
   assert.equal(matches.length,1,`目录目标 ${target} 必须对应唯一正文标题`);
 }
 assert.match(html,/<code[^>]*>[\s\S]*FENCED_ONLY[\s\S]*<\/code>/);
}));

test("记录与辩论目录可区分多个实例，代码围栏不生成目录", async()=>withRenderer(async r=>{
 const {ReportAnswer}=await r.load("/src/verticals/finance/components/ReportAnswer.tsx");
 const {DebateReport}=await r.load("/src/verticals/finance/components/DebateReport.tsx");
 const {MemoryRouter}=await r.load("react-router-dom");
 const content="## 结论\n\n保留正文\n\n```\n## 不是标题\n```\n\n### 风险\n\n[ev-abcdef]";
 const html=renderToStaticMarkup(createElement(MemoryRouter,{},createElement("div",{},createElement(ReportAnswer,{content}),createElement(DebateReport,{content}))));
 assert.equal((html.match(/aria-label="报告目录"/g)??[]).length,2);
 const targets=[...html.matchAll(/<h[23] id="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(targets.length,4);assert.equal(new Set(targets).size,4);
 for(const id of targets)assert.ok(html.includes(`href="#${id}"`));
 assert.match(textOf(html),/保留正文/);assert.match(html,/aria-label="查看引用/);
}));

test("记录和辩论的目录不把带尾随文本的围栏视为闭合", async()=>withRenderer(async r=>{
 const {ReportAnswer}=await r.load("/src/verticals/finance/components/ReportAnswer.tsx");
 const {DebateReport}=await r.load("/src/verticals/finance/components/DebateReport.tsx");
 const {MemoryRouter}=await r.load("react-router-dom");
 const content="## Intro\n\n```text\n```js\n## FENCED_ONLY\n```\n\n## RealResult";
 for(const Component of [ReportAnswer,DebateReport]){
  const html=renderToStaticMarkup(createElement(MemoryRouter,{},createElement(Component,{content})));
  const nav=/<nav aria-label="报告目录"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1]??"";
  assert.match(nav,/>Intro<\/a>/);assert.match(nav,/>RealResult<\/a>/);assert.doesNotMatch(nav,/FENCED_ONLY/);
  const targets=[...nav.matchAll(/href="#([^"]+)"/g)].map(m=>m[1]!);assert.equal(targets.length,2);
  for(const target of targets)assert.equal([...html.matchAll(/<h[23] id="([^"]+)"[^>]*>/g)].filter(m=>m[1]===target).length,1);
  assert.match(html,/<code[^>]*>[\s\S]*FENCED_ONLY[\s\S]*<\/code>/);
 }
}));
