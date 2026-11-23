import type { WatchRow } from './watchTypes';

export function quoteEpoch(value: string | null): number | null {
  if (!value) return null;
  const compact = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value);
  const iso = compact ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}+08:00` : value;
  if (!compact && !/(Z|[+-]\d{2}:\d{2})$/.test(iso)) return null;
  const epoch = Date.parse(iso);
  return Number.isFinite(epoch) ? epoch : null;
}

export function quoteCoverage(rows: WatchRow[], now: number) {
  const unique = [...new Map(rows.map(row => [row.code, row])).values()];
  let missing = 0, unknown = 0, fresh = 0, old = 0;
  const times: number[] = [];
  for (const row of unique) {
    if (row.price === null || !Number.isFinite(row.price)) { missing++; continue; }
    const time = quoteEpoch(row.quote_time);
    if (time === null || time > now + 5000) { unknown++; continue; }
    times.push(time);
    if (row.today && now - time <= 60000) fresh++; else old++;
  }
  return { total: unique.length, missing, unknown, fresh, old, latest: times.length ? Math.max(...times) : null };
}
