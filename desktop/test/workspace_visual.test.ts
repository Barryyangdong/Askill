import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { withRenderer, textOf } from "./helpers/render.ts";
import { PRODUCT_NAME, REPO_URL } from "../src/verticals/finance/lib/brand.ts";
import { NAV_SECTIONS } from "../src/verticals/finance/lib/nav.ts";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
test("六项主导航与设置归属正确，保留真实 AI 入口", () => {
  const layout = read("verticals/finance/components/layout/Layout.tsx");
  // 2026-10 Simon：左侧栏目太多要合并成两级（方案与 Codex gpt-6-astra 讨论定稿）；
  // 10-09 Simon 重排：先看自己的股票（首页）→ 复盘 → 产业资讯 → 产业研究 → 研究工具（候选池放最后）
  // 10-10 Vibe AStock 偏短线：复盘一组，情绪复盘排第一；首页和复盘之间加盯盘一组
  // 10-10 复盘后面接交易日志（一个页面，页内分页），复完盘对照自己的单子
  assert.deepEqual(NAV_SECTIONS.map((s) => s.label), ["盯盘", "复盘", "选手分析", "研究", "游资蒸馏", "我的", "设置"]);
  assert.ok(NAV_SECTIONS.find(s => s.label === "游资蒸馏")!.pages.some(p => p.to === "/distillation"));
  assert.deepEqual(NAV_SECTIONS.filter((s) => s.pinned).map((s) => s.label), ["设置"]);
  assert.match(layout, /\{MAIN_SECTIONS\.map\(renderSection\)\}[\s\S]*?\{PINNED_SECTIONS\.map\(renderSection\)\}/, "接入 AI 在导航下面单独一块，不随导航滚动");
  // 页面里的小分类（资讯来源、GPU 租金）只在页面里切，不占侧栏 —— 但页面里必须真的能切到
  assert.doesNotMatch(layout, /\/intel\/|\/signals\//);
  // 例外：产业研究的各板块列在侧栏二级里（Simon 10-09），名单读产业研究页同一份数据
  assert.match(layout, /const SECTIONS = withSectors\(NAV_SECTIONS, sectorsData\.sectors\);/);
  assert.match(layout, /navPageOf\(pathname, SECTIONS\)/, "当前页按接上板块后的栏目认，板块页高亮它自己");
  assert.match(layout, /navPageOf\(pathname, SECTIONS\)/, "当前路由识别所属页面");
  assert.match(layout, /max-h-\[calc\(100dvh-16px\)\][^"]*overflow-y-auto/, "收起侧栏时弹出的二级（产业研究 20 项）超高自己滚动");
  assert.match(layout, /<Link \{\.\.\.sidebarDestination\(navSectionHome\(s\)\)\}/, "点一级栏目进入总览或首个二级");
  assert.match(layout, /flyoutSection\.overview\s*\?\s*<Link to=\{flyoutSection\.overview\.to\}/, "收起侧栏时，弹出层的标题能点回总览");
  for (const icon of ["Bot", "Cpu", "MemoryStick", "CircuitBoard", "Rocket", "Database"]) assert.match(layout, new RegExp(`\\b${icon}\\b`), `板块图标 ${icon} 要接进图标表`);
  // 一级栏目的展开按钮是实心三角：收起朝下、展开朝上，不再是往右的箭头
  assert.match(layout, /<path d="M1\.5 3\.25h7L5 7\.5z" fill="currentColor" \/>/);
  assert.match(layout, /open && "rotate-180"/);
  assert.doesNotMatch(layout, /ChevronDown|ChevronRight|-rotate-90/);
  assert.match(read("verticals/finance/pages/Intel.tsx"), /navigate\(`\/intel\/\$\{key\}\$\{focused/);
  assert.match(read("verticals/finance/pages/Signals.tsx"), /navigate\(`\/signals\/\$\{key\}`\)/);
  assert.match(read("verticals/finance/pages/Sectors.tsx"), /to=\{`\/sectors\/\$\{s\.key\}`\}/);
  // 一级文字进第一个页面，箭头只展开 / 收起；展开状态按栏目记住，没点过就跟着当前页走
  assert.match(layout, /const isOpen = \(s: NavSection\) => openGroups\[s\.label\] \?\? here\?\.section === s;/);
  assert.match(layout, /const groupKey = \(label: string\) => `vr-nav3-\$\{label\}`;/);
  const toggle = layout.slice(layout.indexOf("const toggleGroup ="), layout.indexOf("};", layout.indexOf("const toggleGroup =")));
  assert.doesNotMatch(toggle, /setMobileOpen/, "手机抽屉里展开 / 收起组不关抽屉");
  // 侧栏收成图标时，点一级图标弹出二级；Escape 关掉并把焦点还给图标
  assert.match(layout, /e\.key === "Escape"\) \{ e\.preventDefault\(\); setFlyout\(null\); flyoutOpener\.current\?\.focus\(\); \}/);
  assert.match(layout, /aria-haspopup="true" aria-expanded=\{flyout\?\.label === s\.label\}/);

  assert.doesNotMatch(layout, /FinanceAiConsole|consoleOpen|vr-ai-console|openAgent|打开普通对话/);
  assert.match(layout, /href="https:\/\/phoenixtree\.ai\/"/);
  for (const label of ["上游项目（新标签页打开）", "短线王抖音（新标签页打开）", "GitHub", "收起侧栏"]) assert.ok(layout.includes(label));
  assert.match(layout, /const \[collapsed, setCollapsed\] = useState\(\(\) => storageGet\("vr-sidebar"\) === "collapsed"\);/, "没点过收起就是展开的文字栏目");
  assert.match(layout, /compact \? "w-14" : "w-\[216px\]"/);
  assert.match(layout, /workspace-topbar flex h-11/, "顶栏 44px");
  // 给右上角「问 Agent」让位：按按钮实际宽度让（系统字体放大、文案变长都不压住主题按钮），按钮不在（首页）就不让
  assert.match(layout, /style=\{\{ marginRight: "var\(--ai-trigger-space, 0px\)" \}\}/);
  assert.doesNotMatch(layout, /"mr-2[48]"/, "不再写死让位宽度");
  const dock = read("core/ai/AiDock.tsx");
  assert.match(dock, /ref=\{triggerRef\}/);
  assert.match(dock, /setProperty\("--ai-trigger-space", `\$\{Math\.ceil\(el\.getBoundingClientRect\(\)\.width\) \+ TRIGGER_GAP\}px`\)/);
  assert.match(dock, /new ResizeObserver\(apply\);\s*ro\?\.observe\(el\);/, "字号变了按钮变宽，让位跟着变");
  assert.match(dock, /root\.style\.removeProperty\("--ai-trigger-space"\)/, "按钮卸载（回首页）就撤掉让位");
  assert.match(layout, /<FinanceAiDock/);
  assert.match(layout, /workspace-sidebar/);
  assert.match(layout, /aria-expanded=\{open\} onClick=\{\(\) => toggleGroup\(s\)\}/);
  assert.match(layout, /aria-label=\{label\}/);
  assert.match(layout, /const closeMobileNav = \(\) => \{\s*setMobileOpen\(false\);[\s\S]*?requestAnimationFrame\(\(\) => menuRef\.current\?\.focus\(\)\)/);
  assert.equal((layout.match(/onClick=\{closeMobileNav\}/g) ?? []).length, 2);
  assert.match(layout, /event\.key === "Escape"[^\n]*closeMobileNav\(\)/);
});
test("标题说明、状态与操作默认可见；页签正确标记选中项", async () => {
  await withRenderer(async r => {
    const { PageHeader } = await r.load("/src/verticals/finance/components/ui/PageHeader.tsx");
    const html = r.html(PageHeader, { title: "盯盘", subtitle: "行情延迟 · 14:29", description: "详细口径", actions: "刷新" });
    assert.match(textOf(html), /盯盘 详细口径 行情延迟 · 14:29 刷新/);
    assert.doesNotMatch(html, /<details/);
    assert.doesNotMatch(html, /<details[^>]* open/);
    const { PageTabs } = await r.load("/src/verticals/finance/components/ui/PageTabs.tsx");
    const tabs = r.html(PageTabs, { value: "live", label: "盯盘分页", options: [{key:"live",label:"实时动态"},{key:"intraday",label:"竞价与盘中"}], onChange: () => {} });
    assert.match(tabs, /aria-pressed="true"[^>]*>实时动态/);
    assert.match(tabs, /aria-pressed="false"[^>]*>竞价与盘中/);
  });
});
test("短线王品牌和 Askill 仓库一致，工作台不使用光晕与背景渐变", () => {
  assert.equal(PRODUCT_NAME, "短线王");
  assert.equal(REPO_URL, "https://github.com/Barryyangdong/Askill");
  assert.doesNotMatch(read("index.css"), /radial-gradient|linear-gradient|blur\(|text-shadow: 0 0/);
});
test("首页以 Agent 为首屏，不自动取数或启动任务", () => {
  const home = read("verticals/finance/pages/Home.tsx");
  assert.doesNotMatch(home, /backend\.fetch|backend\.research/);
  assert.match(home, /<FinanceHomeAgent/);
});
