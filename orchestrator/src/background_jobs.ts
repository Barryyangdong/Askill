import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { tryAcquireOwnership } from "./process_ownership.ts";

export interface Job {
  id: string; key: string; title: string; status: "running" | "cancelling" | "completed" | "failed" | "cancelled";
  created_at: string; updated_at: string; error?: string; seq: number;
  outcome?: "needs_input" | "complete";
  events: { seq: number; event: unknown }[];
}
/** Only public output is persisted. Inputs and credentials remain in the runner closure. */
export class BackgroundJobs {
  private jobs = new Map<string, Job>();
  private controls = new Map<string, AbortController>();
  private dir: string;
  private release: () => void;
  private closing = false;
  constructor(root: string) {
    this.dir = path.join(root, "background-jobs");
    fs.mkdirSync(this.dir, { recursive: true });
    const release = tryAcquireOwnership(path.join(this.dir, "ownership.sqlite"));
    if (!release) throw new Error("此数据目录已有后台任务服务运行，请使用现有服务或等待其退出。");
    this.release = release;
    try {
    for (const name of fs.readdirSync(this.dir).filter(n => /^[a-f0-9-]+\.json$/.test(n))) {
      let job: Job;
      try {
        job = JSON.parse(fs.readFileSync(path.join(this.dir, name), "utf8"));
        if (job.id !== name.slice(0,-5) || !Array.isArray(job.events)) continue;
      } catch { continue; /* Keep malformed files for diagnosis. */ }
      if (job.status === "running" || job.status === "cancelling") {
        job.status = "failed"; job.error = "服务重启，任务已中断；已生成内容保留，未自动重复调用。";
        job.updated_at = new Date().toISOString(); this.save(job);
      }
      this.jobs.set(job.id, job);
    }
    } catch (error) { release(); throw error; }
  }
  /** Stop accepting work; retain ownership until every runner has settled. */
  close() {
    this.closing = true;
    for (const id of this.controls.keys()) {
      // cancel always aborts in finally; a disk failure must not skip siblings.
      try { this.cancel(id); }
      catch { console.error("[background-jobs] 无法保存取消状态；正在等待任务退出。"); }
    }
    if (!this.controls.size) this.release();
  }
  private save(job: Job) {
    const file = path.join(this.dir, `${job.id}.json`);
    fs.writeFileSync(file + ".tmp", JSON.stringify(job), { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
  }
  list() { return [...this.jobs.values()].map(({ events, ...job }) => job).sort((a,b) => b.created_at.localeCompare(a.created_at)); }
  get(id: string, after = 0) {
    const job = this.jobs.get(id);
    return job ? { ...job, events: job.events.filter(e => e.seq > after) } : null;
  }
  start(key: string, title: string, run: (signal: AbortSignal, emit: (event: unknown) => void) => Promise<void>) {
    if (this.closing) throw new Error("后台任务服务正在关闭。");
    const existing = [...this.jobs.values()].find(j => j.key === key && ["running", "cancelling"].includes(j.status));
    if (existing) return existing.id;
    if (this.controls.size >= 3) throw new Error("已有三个后台任务运行，请等待或中止一个任务。");
    const now = new Date().toISOString();
    const job: Job = { id: crypto.randomUUID(), key, title, status: "running", created_at: now, updated_at: now, seq: 0, events: [] };
    const controller = new AbortController();
    this.save(job); this.jobs.set(job.id, job); this.controls.set(job.id, controller);
    const emit = (event: unknown) => {
      if (job.status !== "running" && job.status !== "cancelling") return;
      const item=event as {type?:string;reply?:{status?:string;title?:string}};
      if(item?.type==='guided_result'&&['needs_input','complete'].includes(String(item.reply?.status)))job.outcome=item.reply!.status as 'needs_input'|'complete';
      if(item?.type==='guided_result'&&typeof item.reply?.title==='string'&&item.reply.title.trim())job.title=item.reply.title.slice(0,160);
      job.events.push({ seq: ++job.seq, event: structuredClone(event) });
      // State events contain confirmed output; preserve them even under preview load.
      if (job.events.length > 600) {
        const i = job.events.findIndex(e => (e.event as {type?: string})?.type === "preview");
        if (i >= 0) job.events.splice(i, 1);
      }
      job.updated_at = new Date().toISOString(); this.save(job);
    };
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return run(controller.signal, emit);
    }).then(() => {
      job.status = controller.signal.aborted ? "cancelled" : "completed";
    }, () => {
      job.status = controller.signal.aborted ? "cancelled" : "failed";
      job.error = controller.signal.aborted ? "任务已中止，已完成内容保留。" : "任务未完成，已完成内容保留。请检查任务阶段或数据连接。";
    }).finally(() => {
      job.updated_at = new Date().toISOString(); this.controls.delete(job.id);
      try { this.save(job); } catch { job.status = "failed"; job.error = "任务状态未能保存到磁盘，请检查磁盘空间和文件权限。"; }
      if (this.closing && !this.controls.size) this.release();
    });
    return job.id;
  }
  cancel(id: string) {
    const job = this.jobs.get(id); const control = this.controls.get(id);
    if (!job || !control || (job.status !== "running" && job.status !== "cancelling")) return false;
    job.status = "cancelling";
    try { this.save(job); } finally { control.abort(); }
    return true;
  }
}
