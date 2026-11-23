import assert from "node:assert/strict";
import test from "node:test";
import { LocalTextStream } from "../src/local_text_stream.ts";
import "../src/finance/register.ts";
import { chatSend } from "../src/chat.ts";

test("preview screening removes hidden reasoning and keeps per-turn settings private", async () => {
  const previews: string[] = [];
  const result = await chatSend({ repoRoot: process.cwd(), persistent: false, thinkingEnabled: false,
    onPreview: text => previews.push(text),
    localAgentRunner: async (_agent, opts) => {
      assert.equal(opts.thinkingEnabled, false);
      opts.onText?.("<think>hidden working notes</think>\n\n现有资料不足，暂不能判断。");
      return "现有资料不足，暂不能判断。";
    },
  }, { message: "归纳现有证据。", llm: { provider: "cli-codebuddy" } });
  assert.equal(result.reply, "现有资料不足，暂不能判断。");
  assert.match(previews[0]!, /现有资料不足/);
  assert.doesNotMatch(previews[0]!, /hidden|think/);
});

test("visible previews exclude reasoning and tool payloads, deduplicate complete paragraphs", () => {
  const previews: string[] = [];
  const stream = new LocalTextStream(text => previews.push(text));
  const emit = (event: unknown) => stream.push(JSON.stringify({ type: "stream_event", event }) + "\n");
  emit({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "private draft" } });
  emit({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "private reasoning" } });
  emit({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
  emit({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "正式结论。\n\n" } });
  emit({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "下一段" } });
  emit({ type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "secret tool input" } });
  assert.deepEqual(previews, ["正式结论。"]);
  const final = JSON.stringify({ type: "result", result: "正式结论。\n\n下一段" });
  stream.push(final.slice(0, 10)); stream.push(final.slice(10));
  assert.equal(stream.finish(), final);
  assert.doesNotMatch(previews.join(""), /private|secret/);
});
