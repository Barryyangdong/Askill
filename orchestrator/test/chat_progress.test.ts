import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { beginChatProgress, readChatProgress } from "../src/chat_progress.ts";
import { createApiServer } from "../src/api.ts";
import { serviceContext } from "../src/service.ts";
import "../src/finance/register.ts";
import path from "node:path";

test("progress is scoped by data root and request, contains only actual execution state", () => {
  const id = randomUUID();
  const update = beginChatProgress("root-a", id);
  assert.deepEqual(readChatProgress("root-a", id), { phase: "waiting", completed: 0 });
  assert.equal(readChatProgress("root-b", id), null);
  assert.equal(readChatProgress("root-a", randomUUID()), null);
  assert.throws(() => beginChatProgress("root-a", id));
  assert.throws(() => beginChatProgress("root-a", "bad"));
  update("tool"); update("waiting"); update("tool"); update("waiting"); update("complete");
  assert.deepEqual(readChatProgress("root-a", id), { phase: "complete", completed: 2 });
  const snapshot = readChatProgress("root-a", id)!;
  snapshot.completed = 999;
  assert.equal(readChatProgress("root-a", id)?.completed, 2);
  update("waiting");
  assert.equal(readChatProgress("root-a", id)?.phase, "complete");
});

test("live progress endpoint requires API authorization and never exposes tool parameters", async () => {
  const ctx = serviceContext({ repoRoot: path.resolve("..") });
  const id = randomUUID();
  const update = beginChatProgress(ctx.dataRoot, id);
  const server = createApiServer(ctx, { token: "test-progress-token" });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/chat/progress/${id}`;
    assert.equal((await fetch(url)).status, 401);
    update("tool");
    const response = await fetch(url, { headers: { authorization: "Bearer test-progress-token" } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { phase: "tool", completed: 0 });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
