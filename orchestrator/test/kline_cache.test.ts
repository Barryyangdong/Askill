import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import "../src/finance/register.ts";
import { runToolRequest, type ServiceContext } from "../src/service.ts";
import { financeToolRequest } from "../src/finance/tool_cache.ts";

const input = {symbol:"600519", period:"day", adjust:"qfq", charts:true};
const result = (value: number) => ({ok:true,result:{symbol:"600519.SH",period:"day",bars:1,fetched_at:"2026-10-12T02:00:00Z",ui_only:{series:{dates:["2026-10-12"],open:[value],high:[value],low:[value],close:[value],volume:[100],change:[null]}}}});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("实际工具请求：重载命中、强刷穿透、根与参数隔离", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vra-chart-tool-"));
  const repo = path.join(root, "repo"), data = path.join(root, "data"), other = path.join(root, "other");
  fs.mkdirSync(path.join(repo, "backtest"), {recursive:true}); fs.mkdirSync(data); fs.mkdirSync(other);
  fs.writeFileSync(path.join(repo, "backtest", "__init__.py"), "");
  fs.writeFileSync(path.join(repo, "backtest", "kline.py"), `import json, pathlib, sys, time\nr=json.load(sys.stdin)\np=pathlib.Path('calls.txt')\nwith p.open('a') as f: f.write('1\\n')\nif r.get('period') == 'month': time.sleep(0.5)\ns={'dates':['2026-10-12'],'open':[1],'high':[1],'low':[1],'close':[1],'volume':[1],'change':[None]}\nprint(json.dumps({'ok':True,'result':{'symbol':r['symbol'],'period':r.get('period','day'),'bars':1,'fetched_at':'2026-10-12T02:00:00Z','ui_only':{'series':s}}}))\n`);
  const python = process.env.VRA_TEST_PYTHON || path.resolve("..", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const ctx: ServiceContext = {repoRoot:repo,dataRoot:data,python,node:process.execPath};
  const run = (rootPath = data, arg = input, policy: "prefer" | "fresh" = "prefer") => runToolRequest({...ctx,dataRoot:rootPath}, "kline", {input:arg,executionMode:"direct",cachePolicy:policy});
  const count = () => fs.readFileSync(path.join(repo,"calls.txt"),"utf8").trim().split("\n").length;
  try {
    let started = performance.now();
    const first = await run(); const coldMs = performance.now() - started;
    started = performance.now(); const again = await run(); const hitMs = performance.now() - started;
    console.log(`替身工具: 首次 ${coldMs.toFixed(2)}ms/1进程，重载 ${hitMs.toFixed(2)}ms/0进程`);
    assert.deepEqual(again, {...(first as object), cached:true}); assert.equal(count(), 1, "模拟整个页面重载，服务进程继续运行");
    await run(data,input,"fresh"); assert.equal(count(),2);
    await run(); assert.equal(count(),2);
    await run(other); await run(data,{...input,period:"week"}); await run(data,{...input,adjust:"none"});
    assert.equal(count(),5);
    await run(data,{...input,charts:false}); await run(data,{...input,charts:false});
    assert.equal(count(),7, "非画图请求不缓存");
    await runToolRequest(ctx,"kline",{input,executionMode:"direct"});
    assert.equal(count(),8, "旧调用者保持原执行行为");
    const ctl = new AbortController(), slow = {...input,symbol:"AAPL",period:"month"};
    const cancelled = runToolRequest(ctx,"kline",{input:slow,executionMode:"direct",cachePolicy:"prefer"},ctl.signal);
    const survivor = runToolRequest(ctx,"kline",{input:slow,executionMode:"direct",cachePolicy:"prefer"});
    setTimeout(() => ctl.abort(),200);
    const both = await Promise.allSettled([cancelled,survivor]);
    assert.equal(both[0].status,"rejected"); assert.equal(both[1].status,"fulfilled");
    assert.equal(count(),10,"取消不影响另一独立进程");
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test("失败、缺数、取消和强刷竞态", async () => {
  const root = path.join(os.tmpdir(), `vra-chart-${crypto.randomUUID()}`);
  const base = {dataRoot:root,repoRoot:root,python:"python",name:"kline",input,policy:"prefer" as const};
  let n=0;
  for (const value of [{ok:false}, {ok:true,result:{fetched_at:"2026-10-12T02:00:00Z",ui_only:{series:{dates:[]}}}}]) {
    const run = async () => {n++;return value;};
    await financeToolRequest({...base,run}); await financeToolRequest({...base,run});
  }
  assert.equal(n,4);
  let resolveOld!: (v:unknown)=>void, resolveForce!: (v:unknown)=>void;
  const old = financeToolRequest({...base,run:()=>new Promise(r=>{resolveOld=r;})});
  const force = financeToolRequest({...base,policy:"fresh",run:()=>new Promise(r=>{resolveForce=r;})});
  const during = financeToolRequest({...base,run:async()=>result(3)});
  await tick(); resolveForce(result(2)); await force; resolveOld(result(1)); await old; await during;
  let calls=0; const cached = await financeToolRequest({...base,run:async()=>{calls++;return result(4);}});
  assert.deepEqual(cached,{...result(2),cached:true}); assert.equal(calls,0);
  const ctl = new AbortController(); ctl.abort();
  await assert.rejects(financeToolRequest({...base,signal:ctl.signal,run:async()=>result(5)}));
});

test("并发取消互不影响，强刷失败后不复用旧缓存", async () => {
  const root = path.join(os.tmpdir(), `vra-chart-${crypto.randomUUID()}`);
  const base = {dataRoot:root,repoRoot:root,python:"python",name:"kline",input,policy:"prefer" as const};
  const controller = new AbortController();
  let finish1!: (v:unknown)=>void, finish2!: (v:unknown)=>void;
  const a = financeToolRequest({...base,signal:controller.signal,run:()=>new Promise(r=>{finish1=r;})});
  const b = financeToolRequest({...base,run:()=>new Promise(r=>{finish2=r;})});
  controller.abort(); finish1(result(1)); finish2(result(2));
  await assert.rejects(a); assert.deepEqual(await b,result(2));
  await assert.rejects(financeToolRequest({...base,policy:"fresh",run:async()=>{throw Error("fail");}}));
  let calls = 0;
  const next = await financeToolRequest({...base,run:async()=>{calls++;return result(3);}});
  assert.equal(calls,1); assert.deepEqual(next,result(3));
});

test("缓存严格过期，结果缺少采集时间不缓存", async () => {
  const root = path.join(os.tmpdir(), `vra-chart-${crypto.randomUUID()}`);
  const base = {dataRoot:root,repoRoot:root,python:"python",name:"kline",input,policy:"prefer" as const};
  const realNow = Date.now; let now = realNow(); Date.now = () => now;
  try {
    let calls=0; const run=async()=>{calls++;return result(calls);};
    await financeToolRequest({...base,run}); now += 29_999;
    await financeToolRequest({...base,run}); assert.equal(calls,1);
    now += 1; await financeToolRequest({...base,run}); assert.equal(calls,2);
    const invalid = {...base,input:{...input,symbol:"AAPL"},run:async()=>{calls++;const x=result(1); x.result.fetched_at=""; return x;}};
    await financeToolRequest(invalid); await financeToolRequest(invalid); assert.equal(calls,4);
  } finally { Date.now=realNow; }
});
