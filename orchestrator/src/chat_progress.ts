type Phase = "waiting" | "tool" | "complete" | "failed";
export interface ChatProgress { phase: Phase; completed: number }
const entries = new Map<string, { value: ChatProgress; updated: number }>();
const keyOf = (root: string, id: string) => JSON.stringify([root, id]);
export function beginChatProgress(root: string, id: unknown) {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid progress id");
  for (const [key, entry] of entries) if (Date.now() - entry.updated > 900_000) entries.delete(key);
  const key = keyOf(root, id);
  if (entries.has(key) || entries.size >= 128) throw new Error("Progress capacity or duplicate id");
  const entry = { value: { phase: "waiting", completed: 0 } as ChatProgress, updated: Date.now() };
  entries.set(key, entry);
  return (phase: Phase) => {
    if (entry.value.phase === "complete" || entry.value.phase === "failed") return;
    if (phase === "waiting" && entry.value.phase === "tool") entry.value.completed++;
    entry.value.phase = phase; entry.updated = Date.now();
  };
}
export function readChatProgress(root: string, id: string): ChatProgress | null {
  const entry = entries.get(keyOf(root, id));
  return entry && Date.now() - entry.updated <= 900_000 ? { ...entry.value } : null;
}
