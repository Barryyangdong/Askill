import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BackgroundJobs } from "../src/background_jobs.ts";

test("recovery persistence failure refuses startup and releases ownership without losing output", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "askill-recover-write-"));
  const dir = path.join(root, "background-jobs");
  fs.mkdirSync(dir);
  const id = "11111111-2222-3333-4444-555555555555";
  const file = path.join(dir, `${id}.json`);
  const stored = { id, key: "key", title: "title", status: "running", created_at: "2026-11-17", updated_at: "2026-11-17", seq: 1, events: [{ seq: 1, event: { text: "retained output" } }] };
  fs.writeFileSync(file, JSON.stringify(stored));
  const rename = t.mock.method(fs, "renameSync", () => { throw Error("recovery rename failed"); });
  try {
    assert.throws(() => new BackgroundJobs(root), /recovery rename failed/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), stored);
    rename.mock.restore();
    const reopened = new BackgroundJobs(root);
    try {
      assert.equal(reopened.get(id)?.status, "failed");
      assert.deepEqual(reopened.get(id)?.events, stored.events);
    } finally { reopened.close(); }
  } finally { rename.mock.restore(); fs.rmSync(root, { recursive: true, force: true }); }
});

for (const terminal of ["completed", "failed", "cancelled"] as const) {
  for (const action of ["close", "cancel"] as const) {
    test(`${action} between ${terminal} settlement and persistence preserves the terminal state`, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "askill-settle-"));
      const jobs = new BackgroundJobs(root);
      const id = jobs.start("key", "title", async () => {
        if (terminal === "failed") throw Error("runner failed");
      });
      if (terminal === "cancelled") jobs.cancel(id);
      try {
        await new Promise<void>((resolve, reject) => {
          let turns = 0;
          const inspect = () => {
            try {
              if (jobs.get(id)?.status !== terminal) {
                assert.ok(++turns < 40, "runner must settle within the microtask sequence");
                queueMicrotask(inspect);
                return;
              }
              // No timer: observe .then's terminal assignment before .finally saves.
              const disk = JSON.parse(fs.readFileSync(path.join(root, "background-jobs", `${id}.json`), "utf8"));
              assert.equal(disk.status, terminal === "cancelled" ? "cancelling" : "running");
              if (action === "cancel") assert.equal(jobs.cancel(id), false);
              jobs.close();
              assert.equal(jobs.get(id)?.status, terminal);
              resolve();
            } catch (error) { reject(error); }
          };
          queueMicrotask(inspect);
        });
        await new Promise<void>(resolve => setImmediate(resolve));
        const reopened = new BackgroundJobs(root);
        try { assert.equal(reopened.get(id)?.status, terminal); }
        finally { reopened.close(); }
      } finally {
        await new Promise<void>(resolve => setImmediate(resolve));
        jobs.close();
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
}

test("detached output survives reload; active keys deduplicate; interrupted work never silently restarts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "askill-jobs-"));
  const jobs = new BackgroundJobs(root);
  let finish!: () => void;
  const id = jobs.start("same", "public title", async (_signal, emit) => {
    emit({type:"preview",text:"public output"}); await new Promise<void>(r => {finish=r;});
    emit({type:"done"});
  });
  assert.equal(jobs.start("same", "same", async () => {throw Error("must not start");}), id);
  await new Promise(r => setTimeout(r, 15));
  assert.throws(() => new BackgroundJobs(root), /已有后台任务服务/);
  assert.equal(jobs.get(id)?.events.length, 1);
  finish(); await new Promise(r => setTimeout(r, 15));
  assert.equal(jobs.get(id)?.status, "completed");
  jobs.close(); const reopened = new BackgroundJobs(root); assert.equal(reopened.get(id,1)?.events.length,1); reopened.close();
  assert.equal(jobs.cancel(id),false);
});

test("cancellation waits for runner settlement", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "askill-cancel-"));
  const jobs = new BackgroundJobs(root);
  const id = jobs.start("cancel", "title", async signal => {
    await new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), {once:true}));
  });
  await new Promise(r => setTimeout(r,5));
  jobs.cancel(id); assert.equal(jobs.get(id)?.status,"cancelling");
  await new Promise(r => setTimeout(r,5));
  assert.equal(jobs.get(id)?.status,"cancelled");
});

test("late callbacks cannot alter a settled job or its persisted result", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "askill-late-"));
  try {
    const jobs = new BackgroundJobs(root);
    let emitLate!: (event: unknown) => void;
    const id = jobs.start("late", "original", async (_signal, emit) => {
      emitLate = emit;
      emit({ type: "guided_result", reply: { status: "complete", title: "confirmed" } });
    });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(jobs.get(id)?.status, "completed");
    emitLate({ type: "guided_result", reply: { status: "needs_input", title: "stale" } });
    jobs.close(); const reopened = new BackgroundJobs(root); const saved = reopened.get(id)!; reopened.close();
    assert.equal(saved.title, "confirmed");
    assert.equal(saved.outcome, "complete");
    assert.equal(saved.events.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("cancelling before the runner starts prevents execution", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "askill-precancel-"));
  try {
    const jobs = new BackgroundJobs(root);
    let called = false;
    const id = jobs.start("pre", "title", async () => { called = true; });
    assert.equal(jobs.cancel(id), true);
    await new Promise(r => setTimeout(r, 20));
    assert.equal(called, false);
    jobs.close(); const reopened = new BackgroundJobs(root); assert.equal(reopened.get(id)?.status, "cancelled"); reopened.close();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

