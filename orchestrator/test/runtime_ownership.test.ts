import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { BackgroundJobs } from "../src/background_jobs.ts";
import { readResearchControl, reserveResearch, watchResearchCancellation, updateResearchControl, removeResearchControl } from "../src/research_control.ts";

const waitFor = async (predicate: () => boolean) => {
  const until = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > until) throw Error("worker timeout");
    await new Promise(r => setTimeout(r, 20));
  }
};

for (const kind of ["background", "research"] as const) {
  test(`${kind}: kernel ownership survives launcher exit and GC; crash releases it`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ownership-"));
    const ready = path.join(root, "ready");
    const stop = path.join(root, "stop");
    const token = kind === "research" ? reserveResearch(root, "run").token : "";
    const moduleUrl = new URL(`../src/${kind === "background" ? "background_jobs" : "research_control"}.ts`, import.meta.url).href;
    const action = kind === "background"
      ? `const owner = new m.BackgroundJobs(root); const id = owner.start('key','title',async (_s,emit)=>{emit({text:'kept'});await new Promise(()=>{});}); await new Promise(r=>setTimeout(r,20));`
      : `const owner = m.watchResearchCancellation(root,'run',${JSON.stringify(token)}); const id='run';`;
    const script = `import fs from 'node:fs'; import * as m from ${JSON.stringify(moduleUrl)};
      const root=${JSON.stringify(root)}; ${action}
      globalThis.gc(); fs.writeFileSync(${JSON.stringify(ready)},id);
      setInterval(()=>{globalThis.gc(); if(fs.existsSync(${JSON.stringify(stop)})) process.exit(17);},20);`;
    // The launcher exits without owning or killing the independent worker.
    const launcher = spawn(process.execPath, ["--input-type=module", "-e",
      `import {spawn} from 'node:child_process';spawn(process.execPath,['--expose-gc','--input-type=module','-e',${JSON.stringify(script)}],{detached:true,stdio:'ignore',windowsHide:true}).unref();`], { windowsHide: true });
    try {
      const [code] = await once(launcher, "close");
      assert.equal(code, 0);
      await waitFor(() => fs.existsSync(ready));
      const id = fs.readFileSync(ready, "utf8");
      if (kind === "background") {
        assert.throws(() => new BackgroundJobs(root), /已有后台任务服务/);
      } else {
        assert.equal(readResearchControl(root, id)?.state, "running");
        assert.throws(() => watchResearchCancellation(root, id, token), /已有执行进程/);
      }
      fs.writeFileSync(stop, "exit");
      if (kind === "background") {
        let recovered: BackgroundJobs | undefined;
        await waitFor(() => { try { recovered = new BackgroundJobs(root); return true; } catch { return false; } });
        try {
          assert.equal(recovered!.get(id)?.status, "failed");
          assert.equal(recovered!.get(id)?.events.length, 1);
        } finally { recovered!.close(); }
      } else {
        await waitFor(() => readResearchControl(root, id)?.state === "failed");
        assert.ok(readResearchControl(root, id)?.finished_at);
        assert.throws(() => watchResearchCancellation(root, id, token), /身份不匹配/);
      }
    } finally {
      fs.writeFileSync(stop, "exit");
      // The bounded worker cleanup above normally completes before this point.
      await new Promise(r => setTimeout(r, 100));
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test("closing a service retains ownership until running callbacks settle", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ownership-drain-"));
  const jobs = new BackgroundJobs(root);
  let finish!: () => void;
  let late!: (event: unknown) => void;
  const id = jobs.start("key", "title", async (_s, emit) => {
    late = emit;
    await new Promise<void>(r => { finish = r; });
  });
  await new Promise(r => setTimeout(r, 10));
  jobs.close();
  assert.throws(() => new BackgroundJobs(root), /已有后台任务服务/);
  assert.throws(() => jobs.start("other", "title", async () => {}), /关闭/);
  finish();
  await waitFor(() => jobs.get(id)?.status === "cancelled");
  const replacement = new BackgroundJobs(root);
  late({ text: "stale" });
  assert.equal(replacement.get(id)?.events.length, 0);
  replacement.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("terminal control cannot be deleted while its worker still owns the inode", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ownership-delete-"));
  const record = reserveResearch(root, "run");
  const worker = watchResearchCancellation(root, "run", record.token);
  updateResearchControl(root, "run", record.token, "complete");
  assert.throws(() => removeResearchControl(root, "run"), /尚未退出/);
  worker.close();
  assert.throws(worker.finalize, /释放所有权/);
  removeResearchControl(root, "run");
  assert.equal(readResearchControl(root, "run"), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test("shutdown aborts all runners even when cancellation cannot be persisted", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ownership-disk-"));
  const jobs = new BackgroundJobs(root);
  let aborted = 0;
  for (const key of ["one", "two"]) jobs.start(key, key, async signal => {
    await new Promise<void>(resolve => signal.addEventListener("abort", () => { aborted++; resolve(); }, { once: true }));
  });
  await new Promise(r => setTimeout(r, 10));
  const write = t.mock.method(fs, "writeFileSync", () => { throw Error("disk unavailable"); });
  jobs.close();
  assert.equal(aborted, 2);
  write.mock.restore();
  await waitFor(() => jobs.list().every(j => j.status === "cancelled"));
  const reopened = new BackgroundJobs(root);
  reopened.close();
  fs.rmSync(root, { recursive: true, force: true });
});
