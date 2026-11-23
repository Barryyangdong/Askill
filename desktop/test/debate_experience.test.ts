import assert from "node:assert/strict";
import test from "node:test";
import { withRenderer, textOf } from "./helpers/render.ts";
import { readNdjson } from "../src/verticals/finance/lib/ndjson.ts";

test("恢复辩论时无实时进度仍显示资料缺口并还原有效深度", async () => {
  await withRenderer(async r => {
    const { DebateDossier, restoredDebateRounds } = await r.load("/src/verticals/finance/pages/Debate.tsx");
    assert.match(textOf(r.html(DebateDossier, { progress: [], missing: ["财报缺失"] })), /资料限制：财报缺失/);
    assert.equal(restoredDebateRounds(1, 2), 1);
    assert.equal(restoredDebateRounds("1", 2), 2);
  });
});

test("综合结果按判断、分歧和观点变化分卡，保留非标准旧报告", async () => {
  await withRenderer(async r => {
    const { DebateConclusion } = await r.load("/src/verticals/finance/components/DebateConclusion.tsx");
    const html = r.html(DebateConclusion, { content: "## 综合判断\n倾向：证据不足\n## 交锋带来的变化\n多方撤回原主张\n## 后续观察\n核实报价日期", provisional: true });
    assert.match(textOf(html), /尚未定稿/);
    assert.match(textOf(html), /多方撤回原主张/);
    assert.equal((html.match(/<article/g) ?? []).length, 3);
    assert.match(textOf(r.html(DebateConclusion, { content: "旧版完整结论仍可读" })), /旧版完整结论仍可读/);
  });
});

test("实时消息跨 UTF-8 字节分包仍保持完整，不吞掉连接错误", async () => {
  const bytes = new TextEncoder().encode('{"type":"preview","text":"正式结论"}\n{"type":"done"}\n');
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const events: any[] = [];
  await readNdjson(new Response(body), event => events.push(event));
  assert.equal(events[0].text, "正式结论"); assert.equal(events[1].type, "done");
  await assert.rejects(readNdjson(new Response('{broken}\n'), () => {}));
});

test("证据编号变成紧凑引用，中文字段易读，原始内容仍能查验", async () => {
  await withRenderer(async r => {
    const { DebateReport, readableDebate } = await r.load("/src/verticals/finance/components/DebateReport.tsx");
    const original = "收盘 ind_close 13.11元 [ev-abc123, 2026-11-13]；再次引用 [ev-abc123, 2026-11-13]。";
    const parsed = readableDebate(original);
    assert.deepEqual(parsed.references, ["ev-abc123, 2026-11-13"]);
    assert.doesNotMatch(parsed.body, /ev-abc123|ind_close/);
    const html = r.html(DebateReport, { content: original });
    assert.match(textOf(html), /收盘价 13.11元/);
    assert.match(textOf(html), /引用依据（1）/);
    assert.match(textOf(html), /查看原始正文/);
    assert.match(html, /<details/); assert.match(html, /ev-abc123/);
  });
});

test("双方完成后清楚展示尚在生成的归纳环节，不能冒充整场完成", async () => {
  await withRenderer(async r => {
    const { DebateProgress } = await r.load("/src/verticals/finance/components/DebateProgress.tsx");
    const stages = [{ id: "bull", status: "done" }, { id: "bear", status: "done" }, { id: "referee", status: "running" }];
    const html = r.html(DebateProgress, { stages, rounds: 1, startedAt: 1000, now: 121000, running: true, dossierReady: true, lastActivity: 120000 });
    assert.match(textOf(html), /2\/3 个环节完成/);
    assert.match(textOf(html), /综合判断与后续观察/);
    assert.match(textOf(html), /这一环完成后自动归档/);
    assert.match(textOf(html), /已用 2:00/);
  });
});
