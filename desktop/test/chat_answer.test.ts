import assert from "node:assert/strict";
import test from "node:test";
import { withRenderer, textOf } from "./helpers/render.ts";

test("长回答折叠完整数据但保留原文，来源失败始终显示提示", async () => {
  await withRenderer(async r => {
    const { ChatAnswer, answerSections } = await r.load("/src/verticals/finance/components/ui/ChatAnswer.tsx");
    const body = "报价为上一交易日快照。\n\n" + "详细证据。".repeat(400);
    const source = "\n\n---\n**本轮来源**\n\n- 腾讯财经\n\n没成功的:\n- 备用行情";
    const html = r.html(ChatAnswer, { content: body + source });
    assert.match(textOf(html), /报价为上一交易日快照/);
    assert.match(textOf(html), /展开完整回答/);
    assert.match(textOf(html), /本轮有数据或资料未取到/);
    assert.match(html, /<details>/);
    assert.doesNotMatch(html, /<details open/);
    assert.equal(answerSections(body + source).body, body);
    assert.match(html, /备用行情/);
    assert.match(html, /详细证据/);
    const warning = r.html(ChatAnswer, { content: body + "\n\n⚠️ 内容已移除" });
    assert.doesNotMatch(textOf(warning), /展开完整回答/);
    assert.match(textOf(warning), /⚠️ 内容已移除/);
  });
});

test("短回答与未查询来源提示不被折叠，等待状态不虚构执行阶段", async () => {
  await withRenderer(async r => {
    const { ChatAnswer } = await r.load("/src/verticals/finance/components/ui/ChatAnswer.tsx");
    const html = r.html(ChatAnswer, { content: "简短回答。\n\n---\n本轮没有查数据或资料，回答里的内容没有来源可以核对。" });
    assert.doesNotMatch(html, /<details/);
    assert.match(textOf(html), /本轮没有查数据或资料/);
    const { WaitingStatus } = await r.load("/src/core/ai/AiMessages.tsx");
    assert.match(textOf(r.html(WaitingStatus, { seconds: 75 })), /1 分 15 秒/);
    assert.match(textOf(r.html(WaitingStatus, { seconds: 75 })), /暂时无法确认执行阶段/);
    assert.doesNotMatch(textOf(r.html(WaitingStatus, { seconds: 2 })), /暂时无法确认/);
    assert.match(textOf(r.html(WaitingStatus, { seconds: 30, progress: "正在执行受控工具" })), /正在执行受控工具/);
    const { AiMessages } = await r.load("/src/core/ai/AiMessages.tsx");
    const props = { msgs: [], loading: false, err: "失败", recoverableQuestion: "原问题", onRecover: () => {} };
    assert.match(textOf(r.html(AiMessages, props)), /恢复上一问到输入框/);
    assert.doesNotMatch(textOf(r.html(AiMessages, { ...props, loading: true })), /恢复上一问到输入框/);
  });
});
