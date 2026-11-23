import test from "node:test";
import assert from "node:assert/strict";
import { withRenderer } from "./helpers/render.ts";

test("题材消息只采信同日来源，盘后快讯不作收盘前线索", async () => {
  await withRenderer(async renderer => {
    const {themeArticles} = await renderer.load("/src/verticals/finance/shortline/ThemeNews.tsx");
    const day = "2026-11-20";
    const row = {field:"market_news_title", period:day, value:"半导体盘中消息", note:"time=2026-11-20 14:59:00;url=https://wallstreetcn.com/livenews/123"};
    const env = {evidence:[row, {...row,period:"2026-11-19"}, {...row,note:row.note.replace("14:59","15:01")}, {...row,note:row.note.replace(".com/",".com.invalid/")}]};
    assert.equal(themeArticles(env,day).length,1);
    const announcement = {field:"announcement_title", period:day, value:"<em>公告</em>",note:"type=报告; url=https://static.cninfo.com.cn/abc.pdf"};
    assert.equal(themeArticles({evidence:[announcement]},day,"002148")[0].title,"公告");
  });
});

test("题材日线拒绝错日和复权口径，收益区间采用上证交易日", async () => {
  await withRenderer(async renderer => {
    const { parseThemeBars, themePriceMetrics } = await renderer.load("/src/verticals/finance/shortline/ThemePriceChart.tsx");
    const days = Array.from({length: 21}, (_, i) => ({
      date: new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10),
      open: 10, high: 12, low: 9, close: i === 20 ? 12 : 10,
    }));
    const day = days.at(-1)!.date;
    const extra = {code: "sz000001", period: "day", adjust: "none", close_series: days};
    const parse = (patch: Record<string, unknown>) => parseThemeBars({status:"ok", extra:{...extra,...patch}}, "sz000001", days[0]!.date, day);
    assert.deepEqual(parse({}), days);
    for (const patch of [{code:"sh000001"}, {adjust:"qfq"}, {close_series:days.slice(0,-1)}, {close_series:[...days, {...days[0],date:"2026-10-22"}]}]) assert.deepEqual(parse(patch), []);
    const gaps = days.filter((_, i) => i !== 10);
    const metrics = themePriceMetrics(gaps, days);
    assert.equal(metrics.close, 12);
    assert.ok(Math.abs(metrics.change - 20) < 1e-8);
    assert.equal(metrics.return10, null);
    assert.ok(Math.abs(metrics.return20 - 20) < 1e-8);
  });
});
