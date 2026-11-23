import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import "../src/finance/register.ts";
import { upsertRecord, listRecords, LedgerError } from "../src/ledger.ts";
import { judgedRecord } from "../../desktop/src/verticals/finance/lib/verdicts.ts";
import { dueTasks } from "../../desktop/src/verticals/finance/lib/homeTasks.ts";

test("观察保存→关联条件→首页到期→人工回看持久化闭环（隔离临时台账）", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "askill-observation-"));
  t.after(() => { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  const card = upsertRecord(root, "thesis", { symbol: "600000", title: "测试观察", statement: "核对已披露事实", note: "测试依据", review_by: "2026-11-15", status: "active" });
  const condition = upsertRecord(root, "criterion", { symbol: "600000", thesis_id: card.id, type: "decision_point", statement: "核对公告", due: "2026-11-15", status: "pending" });
  assert.equal(listRecords(root, "criterion")[0]?.thesis_id, card.id);
  assert.equal(dueTasks({ thesis: listRecords(root, "thesis"), criterion: listRecords(root, "criterion") }, "2026-11-15").length, 2);
  upsertRecord(root, "criterion", judgedRecord(condition, "met", "已核对原始公告", "2026-11-15"));
  const reread = listRecords(root, "criterion");
  assert.equal(reread[0]?.verdict_note, "已核对原始公告");
  assert.equal(reread[0]?.thesis_id, card.id);
  assert.equal(dueTasks({ criterion: reread }, "2026-11-15").length, 0);
  assert.throws(() => upsertRecord(root, "criterion", { symbol: "600000", type: "decision_point", statement: "无效日期", due: "2026-02-31" }), LedgerError);
  assert.equal(listRecords(root, "criterion").length, 1);
  for (const status of ["paused", "closed", "active"]) {
    upsertRecord(root, "thesis", { id: card.id, symbol: "600000", title: "已修订的观察", statement: "补充核对理由", note: "补充来源", review_by: "2026-11-15", status });
    assert.equal(listRecords(root, "thesis").length, 1);
    assert.equal(listRecords(root, "thesis")[0]?.status, status);
    assert.equal(listRecords(root, "criterion")[0]?.status, "met");
    assert.equal(listRecords(root, "criterion")[0]?.thesis_id, card.id);
    assert.equal(listRecords(root, "criterion")[0]?.verdict_note, "已核对原始公告");
  }
});
