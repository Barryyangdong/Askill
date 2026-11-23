import type { DebateStage } from "@/lib/backend";

export const debatePlan = (rounds: number) => [
  { id: "bull", label: "多方立论" }, { id: "bear", label: "空方立论" },
  ...(rounds === 2 ? [{ id: "bull_rebut", label: "多方质询" }, { id: "bear_rebut", label: "空方质询" }, { id: "bull_reply", label: "多方回应与修正" }, { id: "bear_reply", label: "空方回应与修正" }] : []),
  { id: "referee", label: "综合判断与后续观察" },
];
export const elapsedLabel = (ms: number) => `${Math.floor(Math.max(0, ms) / 60000)}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, "0")}`;

export function DebateProgress({ stages, rounds, startedAt, now, running, dossierReady, lastActivity }: {
  stages: DebateStage[]; rounds: number; startedAt: number; now: number; running: boolean; dossierReady: boolean; lastActivity: number;
}) {
  const plan = stages.length ? stages.map(s => ({ id: s.id, label: s.label || debatePlan(rounds).find(p => p.id === s.id)?.label || s.id })) : debatePlan(rounds);
  const complete = stages.filter(s => s.status === "done").length;
  return <div className="mt-4 border-t border-border/50 pt-3" aria-label="辩论流程">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>{complete}/{plan.length} 个环节完成 · 已用 {elapsedLabel(now - startedAt)}</span>
      {running && <span role="status">{now - lastActivity > 20000 ? "暂未收到后台更新，正在等待连接响应" : "实时连接中"}</span>}
    </div>
    <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      <li className="rounded border border-border/60 px-3 py-2 text-xs"><span className="mr-2 text-muted-foreground">准备资料</span>{dossierReady ? "已就绪" : running ? "取数中…" : "未完成"}</li>
      {plan.map(step => {
        const stage = stages.find(s => s.id === step.id);
        const status = stage?.status ?? "pending";
        const label = status === "done" ? "已完成" : status === "failed" ? "未完成" : status === "cancelled" ? "已中止" : status === "running" ? running ? "生成中" : "未确认完成" : running ? "等待前序环节" : "未运行";
        const end = stage?.finished_at ? Date.parse(stage.finished_at) : now;
        return <li key={step.id} className={`flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-xs ${status === "running" ? "border-primary/40 bg-primary/5" : "border-border/60"}`}>
          <span>{step.label}</span><span className="text-muted-foreground">{label}{stage?.started_at ? ` · ${elapsedLabel(end - Date.parse(stage.started_at))}` : ""}</span>
        </li>;
      })}
    </ol>
    {running && stages.some(s => s.id === "referee" && s.status === "running") && <p className="mt-2 text-xs text-muted-foreground">多空陈述已结束，正在归纳综合判断与后续观察；这一环完成后自动归档。</p>}
  </div>;
}
