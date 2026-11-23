import assert from "node:assert/strict";
import test from "node:test";

test("研究页观察保留来源与定位锚点，隐私模式遮盖标题正文和依据", async () => {
  await withRenderer(async r => {
    const { ThesisRecordView } = await r.load("/src/verticals/finance/components/ui/ThesisPanel.tsx");
    const record = { id: "draft-1", title: "成本 12345 元", statement: "持有 1000股", note: "公告依据，买入金额 88888 元", status: "active", review_by: "2026-12-01" };
    const html = r.html(ThesisRecordView, { record, hide: false });
    assert.match(html, /id="observation-draft-1"/);
    assert.match(html, /tabindex="-1"/);
    assert.match(textOf(html), /复核 2026-12-01/);
    assert.match(html, /公告依据/);
    const masked = r.html(ThesisRecordView, { record, hide: true });
    assert.doesNotMatch(masked, /12345|1000|88888/);
    assert.match(masked, /••••/);
    const managed = r.html(ThesisRecordView, { record, hide: false, onUpdate: async () => true });
    assert.match(textOf(managed), /编辑观察.*暂停观察.*结束观察/);
    const paused = r.html(ThesisRecordView, { record: { ...record, status: "paused" }, hide: false, onUpdate: async () => true });
    assert.match(textOf(paused), /继续观察/);
    const closed = r.html(ThesisRecordView, { record: { ...record, status: "closed" }, hide: false, onUpdate: async () => true });
    assert.match(textOf(closed), /重新启用/);
    assert.doesNotMatch(textOf(closed), /暂停观察/);
    const privateView = r.html(ThesisRecordView, { record, hide: true, onUpdate: async () => true });
    assert.doesNotMatch(textOf(privateView), /编辑观察|暂停观察|结束观察/);
  });
});
import { withRenderer, textOf } from "./helpers/render.ts";

test("观察卡片保留依据、到期与回看结果，只关联本卡本股票条件", async () => {
  await withRenderer(async r => {
    const { ObservationCardView } = await r.load("/src/verticals/finance/components/ObservationCards.tsx");
    const card = { id: "thesis-1", symbol: "600000", title: "核对公告", statement: "等公告披露", note: "交易所公告", review_by: "2026-12-01", status: "active" };
    const conditions = [
      { id: "a", thesis_id: "thesis-1", symbol: "600000", statement: "核对收入变化", due: "2026-12-01", status: "met", verdict_note: "已阅读原始公告" },
      { id: "b", thesis_id: "other", symbol: "600000", statement: "别的观察" },
      { id: "c", thesis_id: "thesis-1", symbol: "000001", statement: "别的股票" },
    ];
    const html = r.html(ObservationCardView, { card, conditions, hide: false, disabled: false, onSave: async () => true });
    const text = textOf(html);
    assert.match(text, /核对公告.*复核 2026-12-01.*等公告披露/);
    assert.match(text, /交易所公告/);
    assert.match(text, /已达成.*2026-12-01.*已阅读原始公告/);
    assert.doesNotMatch(text, /别的观察|别的股票/);
    assert.match(html, /aria-label="回看条件"/);
    assert.match(html, /type="date" required/);
  });
});

test("隐私模式遮盖记录中的个人金额，隐藏编辑；结束的观察不再添加条件", async () => {
  await withRenderer(async r => {
    const { ObservationCardView } = await r.load("/src/verticals/finance/components/ObservationCards.tsx");
    const props = { card: { id: "one", title: "观察", statement: "成本 12345 元，1000股", note: "买入金额 88888 元", status: "active" }, conditions: [], hide: true, disabled: false, onSave: async () => true };
    const html = r.html(ObservationCardView, props);
    assert.doesNotMatch(html, /12345|1000|88888|<textarea|type="date"/);
    assert.match(html, /••••/);
    const closed = r.html(ObservationCardView, { ...props, hide: false, card: { ...props.card, status: "closed" } });
    assert.match(textOf(closed), /已结束/);
    assert.doesNotMatch(closed, /添加回看条件/);
  });
});
