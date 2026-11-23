import assert from "node:assert/strict";
import test from "node:test";
import { withRenderer, textOf } from "./helpers/render.ts";

test("研究索引保留尚未完成阶段，按真实事件显示当前步骤；结束后不显示运行中", async () => {
  await withRenderer(async r => {
    const { ResearchProgress, researchStages } = await r.load("/src/verticals/finance/components/ResearchProgress.tsx");
    const labels = { profile: "公司画像", risk: "风险", report: "成稿" };
    const statuses = { complete: "完成", running: "进行中", pending: "待运行", cancelling: "正在取消" };
    const run = { status: "running", stages: [{ stage: "profile", status: "complete" }], last_events: [{ type: "local_agent.turn_start", stage: "risk" }] };
    const html = r.html(ResearchProgress, { run, labels, statuses });
    assert.match(textOf(html), /正在执行：.*风险/);
    assert.match(textOf(html), /公司画像.*完成.*风险.*进行中.*成稿.*待运行/);
    assert.equal(researchStages(run, Object.keys(labels)).length, 3);
    const finished = r.html(ResearchProgress, { run: { ...run, status: "complete" }, labels, statuses });
    assert.doesNotMatch(textOf(finished), /正在执行|进行中/);
    const cancelled = r.html(ResearchProgress, { run: { ...run, status: "cancelling" }, labels, statuses });
    assert.match(textOf(cancelled), /等待停止：.*风险/);
    const noEvent = researchStages({ ...run, last_events: [] }, Object.keys(labels));
    assert.equal(noEvent.filter((s: { status: string }) => s.status === "running").length, 0);
  });
});
