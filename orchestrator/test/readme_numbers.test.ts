import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { NAV_SECTIONS } from "../../desktop/src/verticals/finance/lib/nav.ts";
import { FINANCE_STAGES } from "../src/finance/plugin.ts";
import { RUN_TOOLS } from "../src/run_tools.ts";
import { PRODUCT_SLUG } from "../src/brand.ts";

/**
 * README 里的数字由这里兜住:端点数、层数、栏目数、受控工具数、研究阶段数、上游版本号。
 * 注册表、导航或工具改了而 README 没跟着改,这里变红。
 * 🔴 每条写法都要求「至少找到几处」:README 换了说法、正则一处都没匹配上时也要变红,不能悄悄失效。
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");
const ZH = read("README.md");
const EN = read("README_en.md");

const ZH_NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const EN_NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
/** 英文 README 用单词写的小数字 */
const EN_WORD = `(?:${EN_NUM.join("|")})`;
const toNum = (s: string) => (/^\d+$/.test(s) ? Number(s) : ZH_NUM.includes(s) ? ZH_NUM.indexOf(s) : EN_NUM.indexOf(s.toLowerCase()));

/** 每处匹配的第 group 组转成数字;少于 min 处就报错 */
function numbersAt(md: string, re: RegExp, min: number, label: string, group = 1): number[] {
  const out = [...md.matchAll(re)].map((m) => toNum(m[group]!));
  assert.ok(out.length >= min, `${label}:只找到 ${out.length} 处,至少应有 ${min} 处(README 换了写法就同步改这条测试)`);
  return out;
}
function allEqual(md: string, re: RegExp, min: number, want: number, label: string, group = 1) {
  for (const n of numbersAt(md, re, min, label, group)) assert.equal(n, want, `${label}写的是 ${n},实际是 ${want}`);
}

test("README 端点数 / 层数 / 停用数跟数据注册表一致", () => {
  const reg = JSON.parse(read("datasources/registry.json")) as { endpoints: { id: string; layer: string; enabled?: boolean; source?: string }[] };
  const total = reg.endpoints.length;
  // 与取数器、编排器同一口径:没写 enabled 算启用
  const disabled = reg.endpoints.filter((e) => e.enabled === false);
  const enabled = total - disabled.length;
  const layers = new Set(reg.endpoints.map((e) => e.layer)).size;

  allEqual(ZH, /(\d+) 个数据端点/g, 4, enabled, "中文 README「N 个数据端点」");
  allEqual(ZH, /（(\d+) 层）/g, 1, layers, "中文 README「（N 层）」");
  allEqual(ZH, /共 \*\*(\d+) 个端点、\d+ 层\*\*/g, 1, total, "中文 README 注册表总数");
  allEqual(ZH, /共 \*\*\d+ 个端点、(\d+) 层\*\*/g, 1, layers, "中文 README 注册表层数");
  // 有停用端点时要写明可用几个、停用几个;全部可用时不许留着旧的停用说明
  if (disabled.length) {
    allEqual(ZH, /可用 (\d+) 个/g, 1, enabled, "中文 README「可用 N 个」");
    allEqual(ZH, /(\d+) 个端点因服务器不再返回数据而默认停用/g, 1, disabled.length, "中文 README 停用数");
  } else {
    assert.doesNotMatch(ZH, /可用 \d+ 个|默认停用/, "注册表已没有停用端点,中文 README 还写着停用说明");
  }

  allEqual(EN, /(\d+) data endpoints/g, 4, enabled, "English README 'N data endpoints'");
  allEqual(EN, /\((\d+) layers\)/g, 1, layers, "English README '(N layers)'");
  allEqual(EN, /\*\*(\d+) endpoints across \d+ layers\*\*/g, 1, total, "English README registry total");
  allEqual(EN, /\*\*\d+ endpoints across (\d+) layers\*\*/g, 1, layers, "English README registry layers");
  if (disabled.length) {
    allEqual(EN, /(\d+) of them enabled/g, 1, enabled, "English README 'N of them enabled'");
    allEqual(EN, /the (\w+) TDX candle/g, 1, disabled.length, "English README disabled count");
  } else {
    assert.doesNotMatch(EN, /of them enabled|off by default because/, "no disabled endpoints left, but the English README still describes them");
  }

  // 两边的徽标同一个数
  for (const md of [ZH, EN]) allEqual(md, /badge\/data-(\d+)%20endpoints/g, 1, enabled, "数据端点徽标");
  // README 点名停用的是通达信的三个端点;停用别的端点时要改说明
  assert.ok(disabled.every((e) => e.id.startsWith("tdx_")), `停用的不全是通达信端点:${disabled.map((e) => e.id).join(", ")}`);
});

test("README 栏目数和栏目名跟左侧导航一致", () => {
  const workspaces = NAV_SECTIONS.filter(s => !s.pinned);
  const sections = workspaces.map((s) => s.label);
  assert.deepEqual(sections, ["盯盘", "复盘", "选手分析", "研究", "游资蒸馏", "我的"]);
  assert.equal(NAV_SECTIONS.at(-1)?.pinned, true);
  const tableRows = (md: string, header: string) => {
    const start = md.indexOf(header);
    assert.ok(start >= 0, `找不到栏目表头: ${header}`);
    const end = md.indexOf("</table>", start);
    assert.ok(end > start, "栏目表缺少结束标签");
    return [...md.slice(start, end).matchAll(/<tr><td nowrap>(.*?)<\/td><td>(.*?)<\/td><\/tr>/g)]
      .map((m) => [m[1]!, m[2]!] as const);
  };
  const zhRows = tableRows(ZH, "<th nowrap>一级栏目</th><th nowrap>相关功能</th>");
  const enRows = tableRows(EN, "<th nowrap>Section</th><th nowrap>Related features</th>");
  assert.deepEqual(zhRows.map(([label]) => label), sections, "中文栏目表顺序及唯一性");
  assert.deepEqual(enRows.map(([label]) => label), ["Watch", "Review", "Player Analysis", "Research", "Trader Distillation", "My"], "英文栏目表顺序及唯一性");
  allEqual(ZH, /\*\*(\d+) 个一级栏目\*\*/g, 1, sections.length, "中文栏目数");
  allEqual(EN, /\*\*(\d+) primary sections\*\*/g, 1, sections.length, "英文栏目数");
  for (const [i, section] of workspaces.entries()) {
    const [main, related] = zhRows[i]![1].split("；相关入口：");
    assert.deepEqual(main!.split("、"), section.pages.map(p => p.label));
    assert.deepEqual(related ? related.split("、") : [], (section.related ?? []).filter(p => p.to !== "/").map(p => p.label));
  }

});

test("README 受控工具数和研究阶段数跟实现一致", () => {
  const tools = RUN_TOOLS.length;
  allEqual(ZH, /(\d+) 个受控工具/g, 3, tools, "中文 README「N 个受控工具」");
  const zhList = ZH.match(/\d+ 个受控工具（(.+?)）/)![1]!.split("、");
  assert.equal(zhList.length, tools, `中文 README 列了 ${zhList.length} 个受控工具:${zhList.join(" / ")}`);
  allEqual(EN, new RegExp(`\\b(${EN_WORD}|\\d+) controlled (?:${PRODUCT_SLUG} )?tools`, "gi"), 3, tools, "English README 'N controlled tools'");

  const stages = FINANCE_STAGES.length;
  allEqual(ZH, /([一二三四五六七八九十])个?阶段/g, 4, stages, "中文 README「六阶段」");
  allEqual(EN, new RegExp(`\\b(${EN_WORD})[- ]stages?\\b`, "gi"), 4, stages, "English README 'six-stage'");
});

test("README 写的上游版本跟 datasources/UPSTREAM.md 的移植版本一致", () => {
  const upstream = read("datasources/UPSTREAM.md");
  const semver = (s: string) => s.split(".").map(Number);
  const newest = (cell: string) => [...cell.matchAll(/v(\d+\.\d+\.\d+)/g)].map((m) => m[1]!)
    .sort((a, b) => { const [x, y] = [semver(a), semver(b)]; return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!; }).at(-1);
  for (const repo of ["a-stock-data", "global-stock-data"]) {
    const row = upstream.split("\n").find((l) => l.startsWith(`| [${repo}]`));
    assert.ok(row, `UPSTREAM.md 没有 ${repo} 这一行`);
    const ported = newest(row.split("|")[2]!);
    assert.ok(ported, `UPSTREAM.md 的 ${repo} 行没有版本号`);
    const re = new RegExp(`\\[${repo}\\]\\([^)]*\\) v(\\d+\\.\\d+\\.\\d+)`, "g");
    for (const [name, md] of [["中文", ZH], ["English", EN]] as const) {
      const said = [...md.matchAll(re)].map((m) => m[1]!);
      assert.ok(said.length >= 1, `${name} README 没写 ${repo} 的版本`);
      for (const v of said) assert.equal(v, ported, `${name} README 写 ${repo} v${v},UPSTREAM.md 是 v${ported}`);
    }
  }
});
