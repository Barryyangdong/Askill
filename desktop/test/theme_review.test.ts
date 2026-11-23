import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { withRenderer, textOf } from "./helpers/render.ts";

const data = JSON.parse(readFileSync(new URL("./fixtures/shortline-2026-10-09.json", import.meta.url), "utf8"));
const done = (result: unknown) => ({state: "done", result, status: "ok", why: ""});

test("联动股票栏用原位详情按钮选择成员，收盘及区间涨幅可排序", async () => {
  await withRenderer(async r => {
    const { ThemeMembers } = await r.load("/src/verticals/finance/shortline/ThemeReview.tsx");
    const html = r.html(ThemeMembers, {
      cell: {date: data.date, tag: "固态电池"}, reviewDay: data.date, linked: true,
      themes: done(data.themes), ladder: done(data.ladder),
    });
    assert.match(html, /aria-label="查看紫竹高科详情" aria-expanded="false"/);
    for (const title of ["板位", "收盘", "涨跌幅", "10日", "20日"]) {
      assert.ok(html.includes(`aria-label="按本页${title}排序"`));
    }
    assert.doesNotMatch(html, /href="\/workbench/);
  });
});

test("管理目录按复盘日、题材来源和股票代码归并", async () => {
  await withRenderer(async r => {
    const { reviewSources } = await r.load("/src/verticals/finance/shortline/ThemeWorkspace.tsx");
    const sample = {date: "2026-11-20", groups: [{industry: "半导体", stocks: [
      {symbol: "SH600001", name: "样本甲", tags: ["半导体", "芯片"]},
      {symbol: "600001.SH", name: "样本甲", tags: ["芯片"]},
    ]}]};
    const catalog = reviewSources(sample, sample.date) as {name: string; parent:string; stocks: {code:string}[]}[];
    assert.equal(catalog.length, 3);
    assert.equal(new Set(catalog.filter(t => t.name === "半导体").map(t => t.parent)).size, 2);
    assert.deepEqual(catalog.find(t => t.name === "芯片")?.stocks.map(s => s.code), ["600001"]);
    assert.deepEqual(reviewSources(sample, "2026-11-19"), []);
  });
});

test("历史活跃股与当日样本口径独立，显示最近涨停日和缺口", async () => {
  await withRenderer(async r => {
    const { ThemeMembers } = await r.load("/src/verticals/finance/shortline/ThemeReview.tsx");
    const html = r.html(ThemeMembers, {
      cell:{date:data.date,tag:"固态电池"}, reviewDay:data.date, linked:true,
      themes:done(data.themes), ladder:done(data.ladder),
      history:{members:[{code:"600000",name:"往期成员",lastHit:"2026-10-08",hitDays:2,maxBoards:3}],
        loading:false,availableDays:["2026-10-08"],missingDays:[data.date]},
    });
    assert.match(textOf(html), /覆盖 1 个交易日 · 1 只历史涨停股 1 日源数据有缺口/);
    assert.match(textOf(html), /往期成员 600000 10-08 · 2日/);
    assert.doesNotMatch(textOf(html), /紫竹高科/);
  });
});

test("复盘股票区只用自管角色分核心股，匿名成员留在其他组", async () => {
  await withRenderer(async r => {
    const { ThemeMembers } = await r.load("/src/verticals/finance/shortline/ThemeReview.tsx");
    const html = r.html(ThemeMembers, {
      cell:{date:data.date,tag:"自管题材"}, reviewDay:data.date, linked:true,
      themes:done(data.themes), ladder:done(data.ladder),
      managed:{id:"local:1",name:"自管题材",members:[
        {code:"000001",name:"普通成员"}, {code:"600000",name:"用户标记",role:"领涨"},
      ]},
    });
    assert.match(textOf(html), /自管成分名单.*核心股票 用户标记 600000 领涨.*其他成分股 普通成员/);
  });
});

test("矩阵格区分日期，缺数和零均不生成可钻取的样本", async () => {
  await withRenderer(async r => {
    const { ThemeRotationSection } = await r.load("/src/verticals/finance/shortline/ThemeRotationPanel.tsx");
    const snapshot = structuredClone(data.rotation);
    snapshot.rotation.themes[0].series[2] = null;
    const html = r.html(ThemeRotationSection, {p: done(snapshot), onSelect: () => {}, selected: {date: "2026-10-08", tag: "固态电池"}});
    assert.match(html, /aria-pressed="true" aria-label="2026-10-08 固态电池，5 只涨停，查看样本"/);
    assert.match(html, /aria-label="2026-10-09 固态电池，4 只涨停，查看样本"/);
    assert.match(html, /aria-label="查看题材 固态电池（2026-10-08）"/);
    assert.doesNotMatch(html, /aria-label="2026-09-(?:28|30) 固态电池/);
    assert.match(html, /aria-label="矩阵读数"/);
    assert.match(textOf(html), /涨停只数 当日排名 最高板/);
  });
});

test("侧栏矩阵在题材和交易日两个方向标出选择，默认优先显示日期", async () => {
  await withRenderer(async r => {
    const { ThemeRotationSection } = await r.load("/src/verticals/finance/shortline/ThemeRotationPanel.tsx");
    const html = r.html(ThemeRotationSection, {p: done(data.rotation), rail: true, scores: {"2026-10-08":38},
      onSelect: () => {}, selected: {date: "2026-10-08", tag: "固态电池"}});
    assert.match(html, /aria-label="题材轮动矩阵"/);
    assert.match(html, /aria-current="date"[^>]*>10-08/);
    assert.match(html, /aria-pressed="true" aria-label="查看题材 固态电池（2026-10-08）"/);
    assert.match(html, /aria-pressed="true" aria-label="2026-10-08 固态电池/);
    assert.match(html, /展开统计列/);
    assert.match(html, /<thead[\s\S]+市场阶段[\s\S]+退潮[\s\S]+<\/thead>/);
    assert.doesNotMatch(html, />有涨停天数<|>今天板数最高的</);
  });
});

test("侧栏切换题材保留复盘日，包括该题材当日零样本或缺数", async () => {
  await withRenderer(async r => {
    const { ThemeRotationSection } = await r.load("/src/verticals/finance/shortline/ThemeRotationPanel.tsx");
    const snapshot = structuredClone(data.rotation);
    const date = "2026-10-08";
    const dayIndex = snapshot.rotation.dates.indexOf(date);
    assert.ok(dayIndex >= 0);
    for (const count of [0, null]) {
      snapshot.rotation.themes[0].series[dayIndex] = count;
      const props = {p: done(snapshot), onSelect: () => {}, selected: {date, tag: "另一个题材"}};
      const html = r.html(ThemeRotationSection, {...props, rail: true});
      const target = `aria-label="查看题材 ${snapshot.rotation.themes[0].tag}（${date}）"`;
      assert.ok(html.includes(target));
      assert.ok(!html.includes(`aria-label="${date} ${snapshot.rotation.themes[0].tag}，`));
      assert.ok(!r.html(ThemeRotationSection, props).includes(target));
    }
  });
});

test("自管题材与同名市场标签使用各自成员名单", async () => {
  await withRenderer(async r => {
    const { ThemeMembers } = await r.load("/src/verticals/finance/shortline/ThemeReview.tsx");
    const { MemoryRouter } = await r.load("react-router-dom");
    const html = r.html(() => createElement(MemoryRouter, {}, createElement(ThemeMembers, {
      cell: {date: data.date, tag: "固态电池"}, reviewDay: data.date,
      themes: done(data.themes), ladder: done(data.ladder),
      managed: { id: "local:1", name: "固态电池", members: [{code:"000001", name:"样本股票"}] },
    })), {});
    assert.match(textOf(html), /样本股票 000001/);
    assert.doesNotMatch(textOf(html), /紫竹高科/);
  });
});

test("当日事件树前十以外按同日天梯精确标签取成员，两源按代码去重", async () => {
  await withRenderer(async r => {
    const { ThemeMembers } = await r.load("/src/verticals/finance/shortline/ThemeReview.tsx");
    const { MemoryRouter } = await r.load("react-router-dom");
    const date = data.date;
    const themes = {...data.themes, tree: {...data.themes.tree, themes: []}};
    const render = (tag: string, tree: unknown, ladder: unknown) => r.html(() => createElement(MemoryRouter, {},
      createElement(ThemeMembers, {cell:{date,tag}, reviewDay:date, themes:done(tree),ladder:done(ladder)})), {});
    assert.match(textOf(render("固态电池", themes, data.ladder)), /当日连板天梯匹配.*紫竹高科/);
    assert.doesNotMatch(textOf(render("固态", themes, data.ladder)), /紫竹高科/);
    assert.doesNotMatch(textOf(render("固态电池", themes, {...data.ladder, date:"2026-10-08"})), /紫竹高科/);
    const actual = render("固态电池", data.themes, data.ladder);
    assert.equal((actual.match(/>紫竹高科<\/a>/g) || []).length, 1);
  });
});

test("题材个股、板高和归因取自所选日期，跨日返回不会填入日明细", async () => {
  await withRenderer(async r => {
    const { ThemeMembers } = await r.load("/src/verticals/finance/shortline/ThemeReview.tsx");
    const { MemoryRouter } = await r.load("react-router-dom");
    const render = (date: string, ladder: unknown) => r.html(() => createElement(MemoryRouter, {initialEntries:["/shortline/themes?date=2026-10-09"]},
      createElement(ThemeMembers, {cell: {date, tag: "固态电池"}, reviewDay: "2026-10-09", themes: done(data.themes), ladder: done(ladder)})), {});
    const html = render("2026-10-09", data.ladder);
    assert.match(textOf(html), /紫竹高科 002058 4板/);
    assert.match(textOf(html), /固态电池\+铝塑膜\+电池客户/);
    assert.match(html, /href="\/workbench\?symbol=002058&amp;date=2026-10-09/);
    assert.doesNotMatch(textOf(render("2026-10-08", data.ladder)), /紫竹高科|铝塑膜/);
    assert.match(textOf(render("2026-10-09", {...data.ladder, date: "2026-10-08"})), /当日涨停原因原文未取得/);
  });
});
