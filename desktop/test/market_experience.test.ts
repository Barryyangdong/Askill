import test from "node:test";
import assert from "node:assert/strict";
import { ChartCache, chartRequest, currentChart, intelEntry, sameQuoteList } from "../src/verticals/finance/lib/chartRequest.ts";
import { quoteFailure, quoteSnapshotTime } from "../src/verticals/finance/lib/quoteSnapshot.ts";
import { withRenderer, textOf } from "./helpers/render.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("跨市场周期和迟到图表", () => {
  const old = chartRequest("600519", "m5", "none");
  for (const symbol of ["AAPL", "00700.HK"]) {
    const next = chartRequest(symbol, "m5", "none");
    assert.equal(next.period, "day"); assert.equal(next.body.period, next.period);
    assert.equal(currentChart(next.key, {key:old.key,res:"旧图"}), null);
    assert.equal(currentChart(next.key, {key:next.key,res:"新图"}), "新图");
  }
  assert.equal(old.body.period,"m5");
});
test("强刷失败切回、恢复及过期", () => {
  const cache = new ChartCache<string>();
  cache.set("a", "旧成功", 1000); assert.equal(cache.get("a", false, 2000), "旧成功");
  assert.equal(cache.get("a", true, 2001), undefined);
  cache.set("b", "另一图", 2002); assert.equal(cache.get("a", false, 2003), undefined);
  cache.set("a", "恢复", 3000); assert.equal(cache.get("a", false, 3001), "恢复");
  assert.equal(cache.get("a", false, 33000), undefined);
});
test("跨市场日期边界不复用图表", () => {
  const cache = new ChartCache<string>();
  const before = Date.parse("2026-10-12T15:59:59Z");
  cache.set("a", "图", before);
  assert.equal(cache.get("a", false, before + 1000), undefined);
});
test("旧图表请求不能覆盖强刷缓存", () => {
  const cache = new ChartCache<string>();
  const old = cache.token("a");
  cache.get("a", true, 1000);
  const fresh = cache.token("a");
  cache.setIfCurrent("a", fresh, "新", 1001);
  cache.setIfCurrent("a", old, "旧", 1002);
  assert.equal(cache.get("a", false, 1003), "新");
});
test("报价源时间及名单", () => {
  assert.equal(quoteSnapshotTime({"600519": {price: 10, fetched_at:"2026-01-01T01:00:00Z"}}), Date.parse("2026-01-01T01:00:00Z"));
  assert.equal(quoteFailure(1, ["600519"]), null);
  assert.equal(sameQuoteList(["AAPL"], "600519"), false);
  assert.equal(sameQuoteList(["600519"], "600519"), true);
});
test("锁定面板入口保留查看对象和组对象", () => {
  for (const group of [1,2]) {
    const url = new URL(intelEntry("600003", group, "600001", group === 1 ? "600001" : "600002"), "https://example.test");
    assert.equal(url.searchParams.get("symbol"), "600003"); assert.equal(url.searchParams.get("firstSymbol"), "600001");
    assert.equal(url.searchParams.get("groupSymbol"), group === 1 ? "600001" : "600002");
  }
});
test("自选与报价状态渲染", async () => withRenderer(async r => {
  const {WatchStatus} = await r.load("/src/verticals/finance/pages/Workbench.tsx");
  const {MemoryRouter} = await r.load("react-router-dom");
  const quotes = {loading:false,error:null,updatedAt:null,polling:false,settled:"",quotes:{},refresh:()=>{}};
  const render = (watchState:string, symbols:string[], q=quotes) => textOf(renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(WatchStatus, {watchState,symbols,quotes:q,onRetry:()=>{}}))));
  assert.match(render("loading", []), /正在读取自选/); assert.doesNotMatch(render("loading", []), /添加自选/);
  assert.match(render("error", []), /自选读取失败.*重试/); assert.match(render("ready", []), /添加自选/);
  const failed = render("ready", ["600519"], {...quotes, error:"旧快照", updatedAt:Date.parse("2026-01-01T01:00:00Z"),settled:"600519"});
  assert.match(failed, /报价更新失败.*旧快照/); assert.match(failed, /最早取数时间/); assert.match(failed, /刷新报价/);
  assert.match(render("ready", ["600519"], {...quotes, settled:"600519"}), /取数时间未知/);
}));
