import { useEffect, useState } from "react";
import { backend, friendlyAgentError } from "@/lib/backend";
import { loadUserLlm, saveLlm } from "@/lib/llm";
import { LLM_KEY } from "@/lib/llmStore";
import { subscriptionConfig, testAndSaveAi } from "@/lib/aiConnection";

/** Explicit Skill handoff only: merely opening settings never configures a provider. */
export function WorkBuddySetup({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState("正在自动连接 WorkBuddy…");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    // Deferring one tick lets StrictMode cancel its rehearsal before any request.
    const timer = window.setTimeout(() => { void (async () => {
      try {
        const existing = loadUserLlm();
        if (existing && existing.provider !== "cli-codebuddy") throw new Error("已有其他 AI 配置，未覆盖。请由 Skill 核对后在下方选择 WorkBuddy 并测试保存。");
        await testAndSaveAi(subscriptionConfig("cli-codebuddy"), {
          read: () => localStorage.getItem(LLM_KEY), probe: backend.llmProbe, save: saveLlm,
        }, ctl.signal);
        if (!ctl.signal.aborted) { setState("WorkBuddy 已通过真实连接测试并保存，可返回工作台使用。"); onDone(); }
      } catch (e) { if (!ctl.signal.aborted) { setFailed(true); setState(friendlyAgentError(e)); } }
    })(); }, 0);
    return () => { window.clearTimeout(timer); ctl.abort(); };
  }, []);
  return <section aria-label="Skill 自动接入 WorkBuddy" className="mb-4 rounded border border-border p-4 text-sm">
    <strong>WorkBuddy 自动接入</strong><p role={failed ? "alert" : "status"} className="mt-2 text-muted-foreground">{state}</p>
    {failed && <p className="mt-2 text-xs text-muted-foreground">接入未完成，原配置保持不变。由 Skill 继续检查 CLI 和登录状态。</p>}
  </section>;
}
