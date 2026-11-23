import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { withRenderer } from "./helpers/render.ts";

test("题材库同层去重，批量改动原子提交，跨层允许同名", async () => {
  await withRenderer(async r => {
    const { applyThemeCommand: apply, parseThemeStocks } = await r.load("/src/verticals/finance/shortline/themeCatalog.ts");
    const roots = apply([], { type: "create", names: ["半导体","机器人"], parentId: null });
    const parentId = roots[0].id;
    assert.throws(() => apply(roots, { type: "create", names: ["能源","半导体"], parentId: null }), /同一层级/);
    assert.equal(roots.length, 2);
    const tree = apply(roots, { type: "create", names: ["机器人"], parentId });
    const childId = tree[2].id;
    assert.throws(() => apply(tree, { type: "delete", id: parentId }), /二级题材/);
    assert.throws(() => apply(tree, { type: "rename", id: childId, parentId: null, name: "机器人" }), /同一层级/);
    assert.throws(() => apply(tree, { type: "create", names: ["三级"], parentId: childId }), /一级题材/);
    const added = apply(tree, { type: "add", id: childId, stocks: parseThemeStocks("sh600519 贵州茅台\n000001.SZ 平安银行,600519") });
    assert.deepEqual(added[2].stocks, [{code:"600519",name:"贵州茅台"},{code:"000001",name:"平安银行"}]);
    assert.throws(() => parseThemeStocks("600519\nBAD"), /核对股票代码/);
    const removed = apply(added, { type: "remove", id: childId, code:"600519" });
    assert.equal(removed[2].stocks.length, 1);
    const moved = apply(removed, { type: "rename", id: childId, parentId: null, name:"人形机器人" });
    const deleted = apply(moved, { type: "delete", id: parentId });
    assert.deepEqual(deleted.map((t: {name:string}) => t.name), ["机器人","人形机器人"]);
    assert.throws(() => apply(deleted, { type: "add", id:parentId, stocks:[] }), /已被删除/);
  });
});

test("旧题材可标记地位，重复添加保留角色并可清除", async () => {
  await withRenderer(async r => {
    const { applyThemeCommand: apply } = await r.load("/src/verticals/finance/shortline/themeCatalog.ts");
    const legacy = [{id:"old", name:"旧题材", parentId:null, stocks:[{code:"600519",name:"旧名"},{code:"000001",name:"平安银行"}]}];
    const marked = apply(legacy, {type:"role",id:"old",code:"600519",role:"龙头"});
    const reloaded = JSON.parse(JSON.stringify(marked));
    const merged = apply(reloaded, {type:"add",id:"old",stocks:[{code:"600519",name:"新名"},{code:"000001",name:""}]});
    assert.equal(merged[0].stocks[0].role, "龙头");
    assert.equal(merged[0].stocks[0].name, "新名");
    assert.equal(merged[0].stocks[1].role, undefined);
    const cleared = apply(merged, {type:"role",id:"old",code:"600519"});
    assert.equal(JSON.parse(JSON.stringify(cleared))[0].stocks[0].role, undefined);
  });
});

test("同名来源题材按分类打开，标准行业成员分页显示", async () => {
  await withRenderer(async r => {
    const { ThemeManagement } = await r.load("/src/verticals/finance/shortline/ThemeManagement.tsx");
    const stocks = Array.from({length: 55}, (_, i) => ({code:String(600000+i),name:`样本${i+1}号`}));
    const sources = [{name:"汽车",parent:"同花顺涨停题材",stocks:[]},{name:"汽车",parent:"标准行业分类",stocks}];
    const html = r.html(() => createElement(ThemeManagement, {
      day:"2026-11-20",initialId:"source:标准行业分类|汽车", sources,
      catalog:{themes:[],ready:true,error:"",reload() {},mutate() {}},onReview() {},
    }), {});
    assert.match(html, /标准行业分类 · 沪深 A 股/);
    assert.match(html, /aria-label="搜索成分股"/);
    assert.match(html, /样本30号/);
    assert.doesNotMatch(html, /样本31号/);
    assert.match(html, /近20日/);
  });
});
