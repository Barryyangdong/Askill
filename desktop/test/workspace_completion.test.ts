import assert from "node:assert/strict";
import test from "node:test";
import { beijingDay, dueTasks } from "../src/verticals/finance/lib/homeTasks.ts";
import { readWorkspaceContext, rememberWorkspace, workspaceHref } from "../src/verticals/finance/lib/workspaceContext.ts";
import { replayView } from "../src/verticals/finance/lib/klineReplay.ts";
import type { KlineView } from "../src/verticals/finance/lib/klineView.ts";
import { withRenderer, textOf } from "./helpers/render.ts";

test("待办按北京时间到期，排除已结束、未来和私人交易记录", () => {
  assert.equal(beijingDay(new Date("2026-11-14T16:01:00Z")), "2026-11-15");
  const records: any = {
    thesis: [{ id: "t", title: "观察复核", review_by: "2026-11-15", status: "active" }, { id: "closed", review_by: "2026-01-01", status: "closed" }],
    criterion: [{ id: "c", statement: "应回看", due: "2026-11-14" }, { id: "done", due: "2026-11-13", status: "met" }, { id: "future", due: "2026-11-16" }],
    action: [{ id: "a", title: "今日待办", due: "2026-11-15", status: "open" }],
    trade: [{ id: "private", title: "不能出现", due: "2026-11-13", status: "open" }],
  };
  assert.deepEqual(dueTasks(records, "2026-11-15").map(t => t.id), ["c", "a", "t"]);
});

test("侧栏恢复明确选择的股票和日期，不污染实时盯盘或覆盖显式链接", () => {
  let context = rememberWorkspace({}, "/research", "?symbol=sh600000");
  context = rememberWorkspace(context, "/shortline/history", "?date=2026-11-13");
  assert.equal(workspaceHref("/research", context), "/research?symbol=600000");
  assert.equal(workspaceHref("/watch/intraday", context), "/watch/intraday?date=2026-11-13");
  assert.equal(workspaceHref("/watch", context), "/watch?symbol=600000");
  assert.equal(workspaceHref("/journal", context), "/journal");
  assert.equal(workspaceHref("/observations",context),"/observations?symbol=600000");
  assert.equal(rememberWorkspace(context,"/workbench","?symbol=600825").symbol,"600825");
  assert.equal(workspaceHref("/shortline?date=2026-11-12", context), "/shortline?date=2026-11-12");
  assert.equal(workspaceHref("/shortline", rememberWorkspace(context, "/shortline", "")), "/shortline");
  assert.deepEqual(readWorkspaceContext("not json"), {});
});

test("逐日回看截断所有价格/成交量/均线序列，拒绝复权和乱序数据，不改变原数据", () => {
  const view = { period: "day", adjust: "none", bars: 3, first: "2026-11-11", last: "2026-11-13", series: {
    dates: ["2026-11-11", "2026-11-12", "2026-11-13"], open: [1, 2, 999], close: [1, 2, 999], high: [1, 2, 999], low: [1, 2, 999], volume: [1, null, 999], change: [0, 1, 999], ma: { "5": [null, 2, 999] },
  } } as unknown as KlineView;
  const clipped = replayView(view, "2026-11-12")!;
  assert.equal(clipped.last, "2026-11-12");
  assert.equal(clipped.bars, 2);
  assert.doesNotMatch(JSON.stringify(clipped), /999|2026-11-13/);
  assert.deepEqual(clipped.series.volume, [1, null]);
  assert.equal(view.series.close.length, 3);
  assert.equal(replayView(view, "2026-11-01"), null);
  assert.equal(replayView({ ...view, adjust: "qfq" }, "2026-11-12"), null);
  assert.equal(replayView({ ...view, period: "week" }, "2026-11-12"), null);
  assert.equal(replayView({ ...view, series: { ...view.series, dates: [...view.series.dates].reverse() } }, "2026-11-12"), null);
});

test("AI 观察草稿默认折叠，不在生成回答时展示或提交保存表单", async () => {
  await withRenderer(async r => {
    const { ObservationDraftButton } = await r.load("/src/verticals/finance/components/ui/ObservationDraftButton.tsx");
    const html = r.html(ObservationDraftButton, { question: "观察问题", reply: "待核对的回答" });
    assert.match(textOf(html), /转为观察草稿/);
    assert.match(html, /aria-expanded="false"/);
    assert.doesNotMatch(html, /<form|确认保存观察|待核对的回答/);
  });
});
