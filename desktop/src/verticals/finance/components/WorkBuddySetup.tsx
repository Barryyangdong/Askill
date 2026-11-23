import { useEffect, useState } from "react";
import { backend, friendlyAgentError } from "@/lib/backend";
import { saveLlm } from "@/lib/llm";
import { LLM_KEY } from "@/lib/llmStore";
import { connectWorkBuddy } from "@/lib/aiConnection";

/** Explicit Skill handoff only: merely opening settings never configures a provider. */
export function WorkBuddySetup({ onDone }: { onDone: (message: string) => void }) {
  const [state, setState] = useState("正在自动连接 WorkBuddy…");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    // Deferring one tick lets StrictMode cancel its rehearsal before any request.
    const timer = window.setTimeout(() => { void (async () => {
      try {
        const result = await connectWorkBuddy({
          read: () => localStorage.getItem(LLM_KEY), probe: backend.llmProbe, save: saveLlm,
        }, ctl.signal);
        if (ctl.signal.aborted) return;
        if (result.ok) onDone(result.message);
        else { setFailed(true); setState(result.message); }
      } catch (e) { if (!ctl.signal.aborted) { setFailed(true); setState(friendlyAgentError(e)); } }
    })(); }, 0);
    return () => { window.clearTimeout(timer); ctl.abort(); };
  }, []);
  return <section aria-label="Skill 自动接入 WorkBuddy" className="mb-4 rounded border border-border p-4 text-sm">
    <strong>WorkBuddy 自动接入</strong><p role={failed ? "alert" : "status"} className="mt-2 text-muted-foreground">{state}</p>
    {failed && <p className="mt-2 text-xs text-muted-foreground">接入未完成，原配置保持不变。由 Skill 继续检查 CLI 和登录状态。</p>}
  </section>;
}
