import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "../src/finance/register.ts";
import { createApiServer } from "../src/api.ts";
import { BackgroundJobs } from "../src/background_jobs.ts";
import { registerBackgroundService } from "../src/background_services.ts";

test("API close runs every stop callback and releases jobs ownership after a stop failure", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "askill-api-stop-"));
  let stopped = false;
  registerBackgroundService("test-stop-error", () => () => { throw Error("synthetic stop failure"); });
  registerBackgroundService("test-stop-later", () => () => { stopped = true; });
  const errors = t.mock.method(console, "error", () => {});
  const server = createApiServer({ dataRoot: root, repoRoot: root, python: "python3", node: process.execPath }, { token: "t".repeat(32) });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    assert.throws(() => new BackgroundJobs(root), /已有后台任务服务/);
    await new Promise<void>(resolve => server.close(() => resolve()));
    assert.equal(stopped, true);
    assert.ok(errors.mock.calls.some(call => String(call.arguments[0]).includes("后台服务停止失败")));
    const reopened = new BackgroundJobs(root);
    reopened.close();
  } finally {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    registerBackgroundService("test-stop-error", () => () => {});
    registerBackgroundService("test-stop-later", () => () => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});
