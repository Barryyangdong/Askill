import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file: string) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

test("所有对话入口共用主题适配表面，普通数据卡不染色", () => {
  for (const file of ["core/ai/AiDock.tsx", "core/ai/AiConsole.tsx",
    "verticals/finance/components/ui/FinanceAiDock.tsx", "verticals/finance/pages/Backtest.tsx",
    "verticals/finance/pages/MyReports.tsx"]) assert.match(read(file), /ai-surface/, file);
  assert.match(read("core/ai/AiMessages.tsx"), /ai-composer/);
  assert.match(read("core/ai/AiMessages.tsx"), /ai-message-assistant/);
  assert.match(read("core/ai/AiDock.tsx"), /ai-chat-trigger/);
  assert.doesNotMatch(read("verticals/finance/components/ui/GlassCard.tsx"), /ai-surface/);
  const css = read("index.css");
  assert.match(css, /\.ai-surface\s*\{/);
  assert.match(css, /\.ai-surface \.prose/);
  assert.match(css, /color-scheme: light/);
  // Neutral assistant surfaces inherit both workspace themes; do not reintroduce a private orange palette.
  assert.doesNotMatch(css, /#fff7f0|#ff6429|linear-gradient/);
  for (const hook of ["ai-message-assistant", "ai-message-user", "ai-input", "ai-send"]) {
    assert.ok(read("verticals/finance/pages/Backtest.tsx").includes(hook), hook);
  }

});

test("侧栏只显示已接入的 AI，不再有 Agent 开关", () => {
  const layout = read("verticals/finance/components/layout/Layout.tsx");
  assert.match(layout, /data-ai-identity className="mt-1\.5 space-y-0\.5"/);
  assert.match(layout, /aiConnectionLabel\(aiRuntime\)/);
  assert.doesNotMatch(layout, /AgentToggle/);
  assert.equal(fs.existsSync(new URL("../src/verticals/finance/components/ui/AgentToggle.tsx", import.meta.url)), false);
});
