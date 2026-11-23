interface ProgressRun {
  status: string | null;
  stages: { stage: string; status: string }[];
  last_events?: unknown[];
}

export function researchStages(run: ProgressRun, known: string[]) {
  const busy = ["running", "cancelling", "finalizing"].includes(run.status ?? "");
  if (!busy && run.stages.length) return run.stages;
  const saved = new Map(run.stages.map(stage => [stage.stage, stage]));
  const latest = [...(run.last_events ?? [])].reverse()
    .filter((event): event is Record<string, unknown> => !!event && typeof event === "object" && !Array.isArray(event))
    .find(event => typeof event.stage === "string" && known.includes(event.stage));
  return known.map(stage => {
    const value = saved.get(stage) ?? { stage, status: "pending" };
    if (busy && latest?.stage === stage && !["complete", "incomplete", "cancelled"].includes(value.status) &&
        !["stage.completed", "stage.failed", "stage.cancelled"].includes(String(latest.type))) {
      return { stage, status: run.status === "cancelling" ? "cancelling" : "running" };
    }
    return value;
  });
}

export function ResearchProgress({ run, labels, statuses }: { run: ProgressRun; labels: Record<string, string>; statuses: Record<string, string> }) {
  const stages = researchStages(run, Object.keys(labels));
  const current = stages.find(stage => stage.status === "running" || stage.status === "cancelling");
  return <>
    {current && <p role="status" className="mb-3 text-xs text-primary">{current.status === "cancelling" ? "等待停止" : "正在执行"}：{labels[current.stage] ?? current.stage}</p>}
    <div className="research-stages" aria-label="研究阶段索引">
      {stages.map((stage, index) => <span key={stage.stage} data-status={stage.status} className="research-stage min-w-0 rounded-b text-xs">
        <span className="mb-2 block font-mono text-[10px] text-primary">{String(index + 1).padStart(2, "0")}</span>
        <span className="block font-medium">{labels[stage.stage] ?? stage.stage}</span>
        <span className="mt-1 block text-[10px] text-muted-foreground">{statuses[stage.status] ?? stage.status}</span>
      </span>)}
    </div>
  </>;
}
