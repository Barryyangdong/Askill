// Only public review data belongs here. Persistence is opt-in for individual read models.
const hour = 3_600_000;
const dayMs = 24 * hour;
const sessionStarts = [555, 570, 690, 780, 900];

function marketPeriod(now: number) {
  const local = now + 8 * hour;
  const minutes = Math.floor((local % dayMs) / 60_000);
  return Math.floor(local / dayMs) * 10 + sessionStarts.filter(start => minutes >= start).length;
}

export function reviewTtl(date: string | null | undefined, settled = true) {
  const today = new Date(Date.now() + 8 * hour).toISOString().slice(0, 10);
  return settled && date && date < today ? 30 * 60_000 : 60_000;
}

interface SessionSnapshot<T> {
  namespace: string;
  limit: number;
  // Only explicitly dated, confirmed closing snapshots can use this scope.
  archive?: boolean;
  project: (value: T) => T;
  valid: (value: T) => boolean;
}

export function createReviewCache<T>(limit = 32, session?: SessionSnapshot<T>) {
  type Entry = { request: Promise<T>; expires: number; fresh: boolean; pending: boolean; value?: T };
  const entries = new Map<string, Entry>();
  const prefix = `askill:market:v2:${session?.namespace}:`;
  const keyOf = (key: string, now: number) => session?.archive ? key : marketPeriod(now) + ':' + key;
  const storageOf = () => session?.archive ? window.localStorage : window.sessionStorage;

  function peek(key: string): T | undefined {
    const now = Date.now();
    const id = keyOf(key, now);
    const prior = entries.get(id);
    if (prior) return !prior.pending && prior.expires > now ? prior.value : undefined;
    if (!session) return;
    try {
      const storage = storageOf();
      const raw = storage.getItem(prefix + id);
      if (!raw) return;
      const { expires, value } = JSON.parse(raw);
      if (!Number.isFinite(expires) || expires <= now || !session.valid(value)) {
        storage.removeItem(prefix + id);
        return;
      }
      remember(id, { request: Promise.resolve(value), value, expires, pending: false, fresh: false });
      return value;
    } catch { return; } // Storage may be disabled, full, or left over from an interrupted write.
  }

  function remember(id: string, entry: Entry) {
    entries.delete(id);
    entries.set(id, entry);
    if (entries.size > limit) entries.delete(entries.keys().next().value!);
  }

  function persist(id: string, value: T, expires: number) {
    if (!session || typeof window === "undefined") return;
    try {
      const storage = storageOf();
      storage.removeItem(prefix + id);
      const raw = JSON.stringify({ expires, value: session.project(value) });
      if (raw.length > 240_000) return; // Large optional detail responses stay in memory.
      const keys = Object.keys(storage).filter(k => k.startsWith(prefix) && k !== prefix + id);
      let total = raw.length + (session.archive ? keys.reduce((size, key) => size + (storage.getItem(key)?.length ?? 0), 0) : 0);
      while (keys.length && (keys.length >= session.limit || total > 640_000)) {
        const key = keys.shift()!;
        if (session.archive) total -= storage.getItem(key)?.length ?? 0;
        storage.removeItem(key);
      }
      storage.setItem(prefix + id, raw);
    } catch { /* An unavailable session cache must never interrupt a valid response. */ }
  }

  function save(key: string, value: T, ttl: number) {
    const now = Date.now();
    const id = keyOf(key, now);
    const expires = now + ttl;
    remember(id, { request: Promise.resolve(value), value, expires, pending: false, fresh: false });
    persist(id, value, expires);
  }

  function forget(key: string) {
    const id = keyOf(key, Date.now());
    entries.delete(id);
    if (session) {
      try { storageOf().removeItem(prefix + id); } catch { /* memory-only */ }
    }
  }

  function read(key: string, refresh: boolean, fetchValue: () => Promise<T>, ttlMs: (value: T) => number): Promise<T> {
    const now = Date.now();
    const id = keyOf(key, now);
    if (!refresh && !entries.has(id)) peek(key);
    const prior = entries.get(id);
    if (prior && ((!refresh && prior.expires > now) || (prior.pending && (!refresh || prior.fresh)))) return prior.request;

    if (session) {
      try { storageOf().removeItem(prefix + id); } catch { /* memory-only */ }
    }
    const request = Promise.resolve().then(fetchValue).then(value => {
      if (entries.get(id) === entry) {
        entry.pending = false;
        const ttl = ttlMs(value);
        if (ttl > 0) {
          entry.expires = Date.now() + ttl;
          entry.value = value;
          persist(id, value, entry.expires);
        } else entries.delete(id);
      }
      return value;
    }).catch(error => {
      if (entries.get(id) === entry) entries.delete(id);
      throw error;
    });
    const entry: Entry = { request, expires: 0, fresh: refresh, pending: true };
    remember(id, entry);
    return request;
  }
  return { read, peek, save, forget };
}
