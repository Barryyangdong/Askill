import {test} from "node:test";
import assert from "node:assert/strict";
import {recordSource,recordSourceHref} from "../src/verticals/finance/lib/recordSource.ts";
test("来源保留明确身份并丢弃未知字段和嵌套返回",()=>{
 const s=recordSource("/workbench?symbol=600519&group=2&firstSymbol=000001&token=SECRET&returnTo=%2Fnotes");
 assert.deepEqual(s,{page:"/workbench",symbol:"600519",group:"2",firstSymbol:"000001"});
 assert.equal(recordSourceHref(s),"/workbench?symbol=600519&group=2&firstSymbol=000001");
 assert.deepEqual(recordSource("/tasks?job=task-1"),{page:"/tasks",job:"task-1"});
 assert.deepEqual(recordSource("/research?run=run-1&symbol=600519"),{page:"/research",symbol:"600519",run:"run-1"});
 assert.equal(recordSource("/calendar?kind=criterion&criteria=%5B%7B%22id%22%3A%22a%22%2C%22due%22%3A%222026-11-18%22%7D%5D"),null);
 assert.equal(recordSource("https://evil.test/notes"),null);
 assert.deepEqual(recordSource("/shortline/history?date=2026-10-12"),{page:"/shortline/history",date:"2026-10-12"});
 assert.deepEqual(recordSource("/intel/filings?symbol=600519&group=2&firstSymbol=000001&groupSymbol=000002"),{page:"/intel/filings",symbol:"600519",group:"2",firstSymbol:"000001",groupSymbol:"000002"});
 assert.deepEqual(recordSource("/calendar?kind=criterion&object=abc&due=2026-10-12"),{page:"/calendar",object:"abc",kind:"criterion",due:"2026-10-12"});
});
