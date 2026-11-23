import type { Industry } from './api';
/** Exact source snapshot identity; does not rely on the first industry's timestamp. */
export function digestIdentity(ind: Pick<Industry, 'key' | 'items'>): string {
 return JSON.stringify([ind.key, ind.items.map(it => [it.time, it.source, it.title, it.url, it.zh ?? null])]);
}
