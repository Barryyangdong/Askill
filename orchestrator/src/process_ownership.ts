import { DatabaseSync } from "node:sqlite";

// Ownership must never depend on GC reachability of a caller's handle.
const owners = new Set<DatabaseSync>();

/** Kernel-backed exclusion, with no PID, lease expiry, or stale-file deletion.
 * Keep the database inode in place forever: replacing it would split ownership.
 * Use only on a local filesystem with working SQLite file locks.
 */
export function tryAcquireOwnership(file: string): (() => void) | null {
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE");
  } catch (error) {
    db.close();
    if ((error as { errcode?: number }).errcode === 5) return null; // SQLITE_BUSY
    throw error;
  }
  owners.add(db);
  let closed = false;
  return () => {
    if (closed) return;
    db.close();
    owners.delete(db);
    closed = true;
  };
}
