/** Detached research cancellation: durable request/ack, never trust a stored PID.
 * Control lives outside the agent's run workspace. A run id is reserved once;
 * retries use a new id, so a late cancel cannot affect a replacement worker.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NOFOLLOW_FLAG, writeJson } from "./fsutil.ts";
import { tryAcquireOwnership } from "./process_ownership.ts";

export class ResearchControlError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export interface ResearchControl {
  token: string;
  state: "starting" | "running" | "complete" | "incomplete" | "stale" | "failed" | "cancelled";
  finished_at: string | null;
  ownership?: "sqlite-v1";
}
export function isResearchCancellation(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true && error === signal.reason && !(error instanceof ResearchControlError);
}
const states = new Set(["starting", "running", "complete", "incomplete", "stale", "failed", "cancelled"]);
function controlPath(dataRoot: string, runId: string, file?: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(runId)) throw new ResearchControlError("bad_run_id", "非法研究编号");
  let current = path.resolve(dataRoot);
  for (const segment of ["research-control", runId, ...(file ? [file] : [])]) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new ResearchControlError("path_symlink", "研究控制路径包含链接");
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  return current;
}
function readRecord(file: string): ResearchControl | null {
  let fd: number;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW_FLAG | fs.constants.O_NONBLOCK); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > 4096) throw new Error("shape");
    const v = JSON.parse(fs.readFileSync(fd, "utf8")) as ResearchControl;
    if (!v || !/^[a-f0-9-]{36}$/.test(v.token) || !states.has(v.state) ||
        !(v.finished_at === null || typeof v.finished_at === "string")) throw new Error("shape");
    return v;
  } catch { throw new ResearchControlError("control_invalid", "研究控制记录损坏，未执行取消"); }
  finally { fs.closeSync(fd); }
}
function readControl(dataRoot: string, runId: string): ResearchControl | null {
  return readRecord(controlPath(dataRoot, runId, "owner.json"));
}
function deletionPath(dataRoot: string, runId: string): string {
  const dir = path.join(path.dirname(path.dirname(controlPath(dataRoot, runId))), "research-deletions");
  const file = path.join(dir, `${runId}.json`);
  for (const item of [dir, file]) {
    try { if (fs.lstatSync(item).isSymbolicLink()) throw new ResearchControlError("path_symlink", "删除记录路径包含链接"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return file;
}
/** Durable terminal receipt survives partial removal of the control directory. */
export function readResearchDeletion(dataRoot: string, runId: string): ResearchControl | null {
  const record = readRecord(deletionPath(dataRoot, runId));
  if (record && (!record.finished_at || !Number.isFinite(Date.parse(record.finished_at)) || ["starting", "running"].includes(record.state))) {
    throw new ResearchControlError("control_invalid", "研究删除记录损坏");
  }
  return record;
}
/** A live detached worker retains its kernel lock even when its service exits.
 * Recover only records published by a worker under this protocol; legacy and
 * not-yet-started workers have no safely provable death signal.
 */
export function readResearchControl(dataRoot: string, runId: string): ResearchControl | null {
  const record = readControl(dataRoot, runId);
  if (!record || record.finished_at || record.ownership !== "sqlite-v1") return record;
  const release = tryAcquireOwnership(controlPath(dataRoot, runId, "ownership.sqlite"));
  if (!release) return readControl(dataRoot, runId);
  try {
    const current = readControl(dataRoot, runId);
    if (!current || current.finished_at || current.ownership !== "sqlite-v1") return current;
    const failed: ResearchControl = { ...current, state: "failed", finished_at: new Date().toISOString() };
    writeJson(controlPath(dataRoot, runId, "owner.json"), failed);
    return failed;
  } finally { release(); }
}
export function reserveResearch(dataRoot: string, runId: string): ResearchControl {
  const dir = controlPath(dataRoot, runId);
  if (fs.existsSync(deletionPath(dataRoot, runId))) throw new ResearchControlError("run_exists", "研究删除尚未完成，请先重试删除");
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  try { fs.mkdirSync(controlPath(dataRoot, runId), { mode: 0o700 }); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new ResearchControlError("run_exists", "研究编号已使用，请创建新的研究");
    throw e;
  }
  const record: ResearchControl = { token: randomUUID(), state: "starting", finished_at: null };
  writeJson(controlPath(dataRoot, runId, "owner.json"), record);
  return record;
}
/** 删掉一次运行的控制记录目录(研究归档被删除时同步清掉)。
 *  目录不存在按成功处理;runId 非法或路径含链接由 controlPath 拦下(抛 ResearchControlError),
 *  不会顺着链接删到数据区外面去。调用方必须先确认这条运行已经结束。 */
export function removeResearchControl(dataRoot: string, runId: string, expected?: ResearchControl, removeRun?: () => void): void {
  const owner = readResearchControl(dataRoot, runId);
  const receipt = readResearchDeletion(dataRoot, runId);
  const record = owner ?? receipt;
  const matches = (current: ResearchControl | null, snapshot: ResearchControl) => current?.token === snapshot.token &&
    current.state === snapshot.state && current.finished_at === snapshot.finished_at && current.ownership === snapshot.ownership;
  if (expected && !matches(record, expected)) throw new ResearchControlError("control_mismatch", "研究运行身份已改变，未删除");
  if (owner && receipt && !matches(owner, receipt)) throw new ResearchControlError("control_mismatch", "研究运行身份已改变，未删除");
  if (!record) { removeRun?.(); return; }
  if (!record.finished_at) throw new ResearchControlError("worker_exists", "研究尚未结束，无法删除控制记录");
  // A previous control cleanup may already have removed its directory. The
  // receipt reserves the run id until cleanup finishes, so no replacement can start.
  fs.mkdirSync(controlPath(dataRoot, runId), { recursive: true });
  const release = tryAcquireOwnership(controlPath(dataRoot, runId, "ownership.sqlite"));
  if (!release) throw new ResearchControlError("worker_exists", "研究进程尚未退出，请稍后删除");
  try {
    const current = readControl(dataRoot, runId) ?? readResearchDeletion(dataRoot, runId);
    if (!current || !matches(current, record) || (expected && !matches(current, expected))) {
      throw new ResearchControlError("control_mismatch", "研究运行身份已改变，未删除");
    }
    if (!current.finished_at) throw new ResearchControlError("worker_exists", "研究尚未结束，无法删除控制记录");
    fs.mkdirSync(path.dirname(deletionPath(dataRoot, runId)), { recursive: true });
    writeJson(deletionPath(dataRoot, runId), current);
    // Preserve the receipt and original control if removal fails or only removes
    // part of the run. A retry does not depend on the surviving manifest.
    removeRun?.();
  } finally { release(); }
  // Terminal records cannot be claimed by a worker. Release before removal for
  // Windows, after proving that no live owner still holds the old inode.
  fs.rmSync(controlPath(dataRoot, runId), { recursive: true, force: true });
  fs.unlinkSync(deletionPath(dataRoot, runId));
}
export function updateResearchControl(dataRoot: string, runId: string, token: string, state: ResearchControl["state"]): void {
  const record = readControl(dataRoot, runId);
  if (!record || record.token !== token) throw new ResearchControlError("control_mismatch", "研究运行身份不匹配");
  if (record.finished_at) return;
  writeJson(controlPath(dataRoot, runId, "owner.json"), { ...record, state,
    finished_at: state === "running" || state === "starting" ? null : new Date().toISOString() });
}
export function researchDecision(dataRoot: string, runId: string): "cancel" | "finalize" | null {
  const file = controlPath(dataRoot, runId, "decision");
  let fd: number;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW_FLAG | fs.constants.O_NONBLOCK); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > 8) throw new ResearchControlError("control_invalid", "研究收尾决定损坏");
    const value = fs.readFileSync(fd, "utf8");
    if (value !== "cancel" && value !== "finalize") throw new ResearchControlError("control_invalid", "研究收尾决定损坏");
    return value;
  } finally { fs.closeSync(fd); }
}
/** Publish a fully written decision atomically, without replacing the winner.
 * Cancellation and archival compete for this single slot across processes.
 */
function decide(dataRoot: string, runId: string, value: "cancel" | "finalize") {
  const temporary = controlPath(dataRoot, runId, `decision-${randomUUID()}`);
  fs.writeFileSync(temporary, value, { flag: "wx", mode: 0o600 });
  try {
    try { fs.linkSync(temporary, controlPath(dataRoot, runId, "decision")); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    return researchDecision(dataRoot, runId);
  } finally { fs.unlinkSync(temporary); }
}
export function researchCancellationRequested(dataRoot: string, runId: string): boolean {
  return researchDecision(dataRoot, runId) === "cancel";
}
export function requestResearchCancellation(dataRoot: string, runId: string): ResearchControl {
  const record = readResearchControl(dataRoot, runId);
  if (!record) throw new ResearchControlError("cancel_unavailable", "此研究未由当前版本启动，无法安全取消");
  if (!record.finished_at) {
    decide(dataRoot, runId, "cancel");
  }
  return record;
}
export function watchResearchCancellation(dataRoot: string, runId: string, token: string) {
  const record = readControl(dataRoot, runId);
  if (!record || record.token !== token || record.finished_at) throw new ResearchControlError("control_mismatch", "研究运行身份不匹配");
  const release = tryAcquireOwnership(controlPath(dataRoot, runId, "ownership.sqlite"));
  if (!release) throw new ResearchControlError("worker_exists", "此研究已有执行进程");
  try {
    const current = readControl(dataRoot, runId);
    if (!current || current.token !== token || current.finished_at || current.ownership) {
      throw new ResearchControlError("control_mismatch", "研究运行身份不匹配");
    }
    writeJson(controlPath(dataRoot, runId, "owner.json"), { ...current, state: "running", ownership: "sqlite-v1" });
  } catch (error) { release(); throw error; }
  const controller = new AbortController();
  let closed = false;
  const check = () => {
    try {
      if (closed) throw new ResearchControlError("worker_closed", "研究执行进程已释放所有权");
      if (researchCancellationRequested(dataRoot, runId)) controller.abort(new Error("用户取消研究"));
    } catch (e) { controller.abort(e); }
  };
  check();
  const timer = setInterval(check, 200);
  timer.unref();
  const checkpoint = () => { check(); controller.signal.throwIfAborted(); };
  const finalize = () => {
    checkpoint();
    decide(dataRoot, runId, "finalize");
    checkpoint();
  };
  return { signal: controller.signal, close: () => { closed = true; clearInterval(timer); release(); }, check, checkpoint, finalize };
}
