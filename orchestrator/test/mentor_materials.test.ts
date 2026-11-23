import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { importMentorMaterial, listMentorMaterials, mentorMaterialEvidence } from "../src/finance/mentor_materials.ts";
import type { MentorCase } from "../src/finance/mentors.ts";
import { materialActionCheck } from "../src/finance/mentor_material_validation.ts";

const at = new Date("2026-05-20T12:00:00Z");
const speech = {
  kind: "statement", title: "收盘笔记", sourceUrl: "https://example.org/posts/12",
  publishedAt: "2026-05-04T14:00", publicSource: true, text: "如果昨日强势股没有溢价，我会继续观察。收盘后再看成交量。",
};
function setup(t: TestContext) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mentor-material-test-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  return { dataRoot };
}

test("imports return attributable statements with stable citations, keep old revisions and select the as-of version", t => {
  const ctx = setup(t);
  const first = importMentorMaterial(ctx, "example", speech, at);
  assert.equal(first.version, 1);
  assert.equal(first.materials[0].evidence.length, 2);
  assert.match(first.materials[0].evidence[0].citation, /^\[资料:[0-9a-f]{32} p\.-\]$/);
  assert.ok(first.materials[0].evidence[0].topics.includes("强势股反馈"));
  assert.equal(first.materials[0].evidence[0].selfReported, true);
  const update = { ...speech, publishedAt: "2026-05-05T20:55", text: "如果放量，我会重新观察板块的强弱。收盘后再看成交量。" };
  assert.equal(importMentorMaterial(ctx, "example", update, at).materials[0].previousVersion, 1);
  const archive = listMentorMaterials(ctx, "example");
  assert.deepEqual(archive.materials.map(row => row.version), [2, 1]);
  assert.deepEqual(archive.materials[0].added, ["如果放量，我会重新观察板块的强弱。"]);
  assert.deepEqual(archive.materials[0].removed, ["如果昨日强势股没有溢价，我会继续观察。"]);
  assert.equal(importMentorMaterial(ctx, "example", speech, at).version, 2);
  assert.deepEqual(mentorMaterialEvidence(ctx, "example", "2026-05-03"), []);
  assert.deepEqual(mentorMaterialEvidence(ctx, "example", "2026-05-05"), first.materials[0].evidence);
  assert.deepEqual(mentorMaterialEvidence(ctx, "example", "2026-05-05T20:55:00+08:00"), archive.materials[0].evidence);
  assert.deepEqual(mentorMaterialEvidence(ctx, "another", "2026-05-08"), []);
});

test("interview questions stay out of the character's voice; missing publication time becomes known after that calendar day", t => {
  const ctx = setup(t);
  importMentorMaterial(ctx, "example", {
    ...speech, publishedAt: "2026-05-05", kind: "interview", text: "开场介绍。\n问：您是不是一定会开仓？\n为什么？\n答：我会先看题材，再确认量能。",
  }, at);
  assert.deepEqual(mentorMaterialEvidence(ctx, "example", "2026-05-05"), []);
  const excerpts = mentorMaterialEvidence(ctx, "example", "2026-05-06");
  assert.deepEqual(excerpts.map(e => [e.excerpt, e.selfReported]), [["开场介绍。", false], ["我会先看题材，再确认量能。", true]]);
});

test("trade evidence contains dated public side and code, omits unrelated columns, and deduplicates partial fills", t => {
  const ctx = setup(t);
  const input = { ...speech, kind: "trades", publishedAt: "2026-05-06", text: '日期,股东账户,证券代码,操作\n20260504,"private-account,1",600000.SH,证券买入\n2026/5/4,private-account,600000.SH,证券买入\n2026-05-04,private-account,600000.SH,卖出' };
  const result = importMentorMaterial(ctx, "example", input, at);
  assert.equal(result.materials[0].evidence.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /private-account|新开仓|清仓/);
  assert.equal(result.materials[0].evidence[1].date, "2026-05-04");
  assert.equal(result.materials[0].evidence[1].selfReported, false);
  assert.deepEqual(mentorMaterialEvidence(ctx, "example", "2026-05-05"), []);
  const dated = mentorMaterialEvidence(ctx, "example", "2026-05-07");
  assert.equal(dated.length, 3);
  assert.equal(dated[0].basisIds?.length, 2);
  assert.match(dated[0].summary, /买入 1 组，卖出 1 组。.*双向成交 1 组/);
  assert.throws(() => importMentorMaterial(ctx, "example", { ...input, text: input.text + "\n2026-05-08,X,000002.SZ,买入" }, at), /第 5 行/);
  assert.equal(listMentorMaterials(ctx, "example").version, 1);
});

test("an unconfirmed or invalid import cannot alter the library", t => {
  const ctx = setup(t);
  for (const bad of [{ publicSource: false }, { publishedAt: "2026-02-30" }, { publishedAt: "2027-01-02" }, { sourceUrl: "file:///D:/private" }, { text: "" }]) {
    assert.throws(() => importMentorMaterial(ctx, "example", { ...speech, ...bad }, at));
  }
  assert.throws(() => importMentorMaterial(ctx, "../escape", speech, at), /人物编号/);
  assert.deepEqual(listMentorMaterials(ctx, "example"), { version: 0, materials: [] });
});

test("new explicit propositions are compared with all eligible known actions and counterexamples, with no future answers", t => {
  const ctx = setup(t);
  const cases: MentorCase[] = JSON.parse(fs.readFileSync(new URL("../../knowledge/mentors/tuixue.json", import.meta.url), "utf8")).cases;
  const proposition = "当下跌家数超过上涨家数三倍时，次日不开新仓。";
  importMentorMaterial(ctx, "example", { ...speech, text: proposition, publishedAt: "2017-01-03" }, at);
  const tested = mentorMaterialEvidence(ctx, "example", "2026-05-05", cases)[0];
  assert.equal(tested.actionCheck?.total, 12);
  assert.equal(tested.actionCheck?.counterCaseIds.length, 8);
  assert.equal(tested.actionCheck?.supportingCaseIds.length, 4);
  const early = mentorMaterialEvidence(ctx, "example", "2017-04-24", cases)[0];
  assert.equal(early.actionCheck?.total, 0);
  assert.equal(materialActionCheck("三倍以上会不会不买？", cases, "2026-05-05"), null);
  assert.equal(materialActionCheck("若下跌家数超过上涨家数三倍且量能不足，次日不开新仓。", cases, "2026-05-05"), null);
  assert.equal(materialActionCheck("若下跌家数超过上涨家数三倍，次日不开新仓，前提是流动性较弱。", cases, "2026-05-05"), null);
});
