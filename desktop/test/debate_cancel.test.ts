import assert from "node:assert/strict";
import test from "node:test";
import { debateStream } from "../src/verticals/finance/lib/agents.ts";
import { ApiError, backend, friendlyAgentError, type DebateState } from "../src/verticals/finance/lib/backend.ts";
import { LLM_KEY } from "../src/verticals/finance/lib/llmStore.ts";

const pending = (): DebateState => ({ id: "fixture", symbol: "300308", evidence_count: 1, gaps: [], done: false, outcome: "running",
  stages: [{ id: "bull", label: "多方", status: "pending", text: "" }] });

test("辩论 HTTP 客户端真正向 fetch 传递信号，并保留重复编号的可操作提示", async () => {
  const originalFetch = globalThis.fetch;
  const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => key === LLM_KEY ? JSON.stringify({ schemaVersion: 2, modePreferenceVersion: 1, executionMode: "agent", source: { provider: "cli-codex" } }) : null,
  } });
  const signal = new AbortController().signal;
  const paths: string[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.signal, signal);
    paths.push(String(input));
    return new Response(JSON.stringify(pending()), { headers: { "Content-Type": "application/json" } });
  };
  try {
    await backend.debateStart("300308", "standard", signal);
    await backend.debateAdvance("fixture", signal);
    assert.deepEqual(paths, ["/api/debate", "/api/debate/fixture/advance"]);
    const message = "这个辩论编号已存在，请使用新的编号重开";
    assert.equal(friendlyAgentError(new ApiError(message, 409, "debate_exists")), message);
  } finally {
    globalThis.fetch = originalFetch;
    if (storage) Object.defineProperty(globalThis, "localStorage", storage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("辩论提前断开不发请求；离页后的迟到事件不回写页面", async () => {
  const run = backend.debateRun;
  let requests = 0, emitted = 0;
  try {
    backend.debateRun = async () => { requests++; return pending(); };
    await debateStream("300308", 1, {}, AbortSignal.abort());
    assert.equal(requests, 0);
    const ctrl = new AbortController();
    backend.debateRun = async (_symbol, _depth, onEvent, signal) => {
      assert.equal(signal, ctrl.signal); requests++;
      ctrl.abort();
      const state:DebateState = {...pending(),done:true,outcome:"completed",stages:[{id:"bull",label:"多方",status:"done",text:"迟到内容"}]};
      onEvent({type:"done",state});
      return state;
    };
    const final = await debateStream("300308",1,{onDelta:()=>emitted++,onStageDone:()=>emitted++,onError:()=>emitted++},ctrl.signal);
    assert.equal(final,undefined); assert.equal(requests,1); assert.equal(emitted,0);
  } finally {backend.debateRun=run;}
});

test("停止未确认时保留失败原因与已经完成的阶段", async () => {
  const run = backend.debateRun;
  const errors:string[]=[],completed:string[]=[];
  try {
    backend.debateRun = async (_symbol,_depth,onEvent) => {
      const state:DebateState={...pending(),done:true,outcome:"failed",stages:[
        {id:"bull",label:"多方",status:"done",text:"已完成部分"},
        {id:"bear",label:"空方",status:"failed",text:"",error:"agent_shutdown_failed:进程树退出未确认，不能视为已取消"},
      ]};
      onEvent({type:"done",state}); return state;
    };
    const result=await debateStream("300308",1,{onError:message=>errors.push(message),onStageDone:(_stage,_label,text)=>completed.push(text)});
    assert.equal(result?.outcome,"failed");assert.deepEqual(completed,["已完成部分"]);
    assert.ok(errors.some(x=>/agent_shutdown_failed.*未确认/.test(x)));
    assert.ok(errors.every(x=>!x.includes("所有阶段都失败")&&!x.includes("根本没跑起来")));
  } finally {backend.debateRun=run;}
});
