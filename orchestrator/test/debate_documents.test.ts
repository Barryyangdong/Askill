import assert from "node:assert/strict";
import test from "node:test";
import { documentCandidates, focusedExcerpt } from "../src/debate_documents.ts";
import {retrievalFocus} from '../src/retrieval_focus.ts';

test('declared vocabulary covers a disputed concept without taking destinations from prose',()=>{
 const policy={keywords:['主题甲','主题乙'],expansions:{主题甲:['别名甲','细节甲'],主题乙:['别名乙']}};
 assert.deepEqual(retrievalFocus('别名乙和未知网址 https://evil.example',policy),['主题乙','别名乙']);
 assert.deepEqual(retrievalFocus('请读取本地密码',policy),[]);
});
test('later multi-aspect passage outranks early repeated single-term mentions',()=>{
 const pages=['第 1 页：'+('审计背景。'.repeat(1000)),'第 16 页：审计为保留意见，持续经营存在重大不确定性。'];
 const text=focusedExcerpt(pages,['审计','保留意见','持续经营']);
 assert.match(text,/第 16 页：.*保留意见/);assert.ok(text.length<=1800);
});
test('focused selection prioritizes relevant attachments ahead of unrelated newer ones',()=>{
 const policy={endpoint:'source',field:'title',hosts:['static.cninfo.com.cn'],titlePattern:'.',limit:1};
 const evidence=[{field:'title',value:'普通事项',period:'2026-11-16',note:'url=https://static.cninfo.com.cn/new.pdf'},{field:'title',value:'审计意见',period:'2026-10-01',note:'url=https://static.cninfo.com.cn/old.pdf'}];
 assert.equal(documentCandidates([{script:'source',evidence}],policy,['审计'])[0]?.title,'审计意见');
});

test("focused excerpts preserve page identity and do not substitute unrelated text",()=>{
 const pages=['第 1 页：'+ '背景'.repeat(1000),'第 2 页：审计尚未完成，仍有不确定性。'];
 assert.match(focusedExcerpt(pages,['审计']),/第 2 页：.*审计尚未完成/);
 assert.equal(focusedExcerpt(pages,['现金流']),'');
 assert.ok(focusedExcerpt(pages,['审计']).length<=1800);
});

test("正文只选正式附件域名，去重、按日期并限制篇数", () => {
  const policy = { endpoint: "source", field: "title", hosts: ["static.cninfo.com.cn"], titlePattern: "风险", limit: 2 };
  const row = (url: string, period: string) => ({ field: "title", value: "风险提示", period, note: `url=${url}` });
  const entries = [row("https://evil.example/a.pdf", "2026-11-16"), row("https://static.cninfo.com.cn/a.PDF", "2026-11-13"), row("https://static.cninfo.com.cn/a.PDF", "2026-11-13"), row("https://static.cninfo.com.cn:444/b.pdf", "2026-11-15"), row("https://static.cninfo.com.cn/b.pdf", "2026-11-14")];
  const result = documentCandidates([{ script: "source", evidence: entries }], policy);
  assert.deepEqual(result.map(x => x.period), ["2026-11-14", "2026-11-13"]);
});
