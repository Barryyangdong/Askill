import { callBackend, selectedAiRuntime } from './backend';
import { readAiRuntime } from './llmStore';
import { createReviewCache, reviewTtl } from '../shortline/reviewCache';

export const choices = { open: '考虑新开仓', no_open: '暂缓新开仓', unknown: '资料不足' } as const;
export type Choice = keyof typeof choices;
export interface Decision { choice: Choice; reason: string; condition: string }
export interface Mentor { id: string; name: string; summary: string; version: string; caseCount: number; quoteCount: number }
export interface Market { pct: number | null; d5: number | null; d20: number | null }
export interface Scene { asOf: string; metrics: {key: string; label: string; members?: string[]; value: number; unit: string; definition: string; source: string}[]; missing: {label: string; reason: string}[] }
export interface Method { pairedEvidence?: { date: string; stock: string; source: string; note: string }; testResult?: { total: number; known: number; support: number; counter: number }; id: string; title: string; principle: string; trigger: string; limits: string; quoteDate: string; exampleIds: string[] }
export interface Example { caseId: string; date: string; methodId: string; role: "support" | "counter"; note: string; reveal: Attempt["reveal"] }
export interface Lesson { scene?: Scene; hintSources?: string[]; hinted?: boolean; id: string; date: string; nextDate: string; prompt: string; market: Market; holdingCount: number | null; positionPct: number | null }
export interface Attempt extends Decision { caseId: string; at: string; reveal: { action: string; summary: string; sources: string[]; sourcePosts?: { title: string; url: string }[] }; feedback: string; revision?: string; coach?: string; hinted: boolean }
export interface Plan extends Decision { market?: Market | null; asOf?: string | null; date: string; at: string; review?: string; hinted: boolean }
export interface Profile extends Mentor { behavior?: {title: string; scope: string; metrics: {label: string; value: string; comparison: string}[]; interpretation: string; source: string}; methods?: Method[]; quotes: { date: string; text: string; source: string; url: string }[]; cases: Lesson[]; attempts: Attempt[]; plans: Plan[] }
export interface Today { shortline?: {date: string; groups: {title: string; source: string; rows: {label:string;value:string}[];gap:string|null}[]}; date: string | null; asOf: string | null; status: 'ready' | 'unavailable' | 'stale'; summary: string; market: Market | null; matches: { caseId: string; date: string; action: string; summary: string }[] }
const path = (id: string) => '/mentors/' + encodeURIComponent(id);
const post = <T,>(id: string, route: string, body: unknown) =>
  callBackend<T>(path(id) + route, { method: 'POST', body: JSON.stringify(body) });

export interface InsightEvidence {
  id: string; kind: 'market' | 'behavior' | 'quote' | 'case';
  title: string; text: string; source: string; date: string; url?: string; caseId?: string; citationId?: string;
}
export interface InsightClaim { title: string; text: string; evidenceIds: string[] }
export interface MentorInsight {
  mentorId: string; mentorName: string; version: string; date: string; asOf: string; basis: string;
  status: 'ready' | 'partial' | 'unavailable'; headline: string; summary: string;
  observations: InsightClaim[]; counterpoints: InsightClaim[]; evidence: InsightEvidence[]; gaps: string[];
  reasoning?: InsightClaim;
  conditions: {metric: string; direction: 'up' | 'down' | 'flat'; reason: string}[]; savedMetrics: string[];
  synthesis?: MentorAnswer;
}
export interface MentorAnswer { text: string; evidenceIds: string[]; evidence?: InsightEvidence[]; mode: 'local' | 'ai'; note?: string }
export type MaterialKind = 'statement' | 'interview' | 'trades';
export interface MaterialInput { kind: MaterialKind; title: string; sourceUrl: string; publishedAt: string; text: string; publicSource: boolean }
export interface MaterialRevision {
  id: string; version: number; kind: MaterialKind; title: string; sourceUrl: string; publishedAt: string; importedAt: string;
  previousVersion: number | null; added: string[]; removed: string[];
  evidence: {id: string; summary: string; excerpt: string; date: string}[];
}
export interface MentorMaterials { version: number; materials: MaterialRevision[] }

const insightCache = createReviewCache<MentorInsight>();
const synthesisCache = createReviewCache<MentorAnswer>();
const revisions = new Map<string, number>();
export function mentorRuntimeKey() {
  const {status, config} = readAiRuntime();
  if (!config) return status;
  const {provider, model, baseURL} = config.source;
  return JSON.stringify([provider, model, baseURL]);
}
const insightKey = (id: string, date: string) => JSON.stringify([id, revisions.get(id) ?? 0, date, mentorRuntimeKey()]);
const synthesisKey = (id: string, date: string, basis: string) => JSON.stringify([id, date, basis, mentorRuntimeKey()]);
function optionalRuntime() {
  const runtime = readAiRuntime();
  return runtime.status === 'ok' && runtime.config ? selectedAiRuntime(runtime.config.source) : {};
}
export const mentorApi = {
  list: () => callBackend<{ mentors: Mentor[] }>('/mentors'),
  create: (name: string) => callBackend<Mentor>('/mentors', {method: 'POST', body: JSON.stringify({ name })}),
  insight(id: string, date: string, refresh = false) {
    const runtime = optionalRuntime();
    return insightCache.read(insightKey(id, date), refresh,
      () => post<MentorInsight>(id, '/insight', {date: date || undefined, refresh: refresh || undefined, ...runtime}),
      value => value.status === 'ready' ? reviewTtl(date) : 30_000);
  },
  cachedInsight: (id: string, date: string) => insightCache.peek(insightKey(id, date)),
  ask: (id: string, date: string, basis: string, question: string, history: string[]) =>
    post<MentorAnswer>(id, '/ask', {date, basis, question, history: history.slice(-3), ...optionalRuntime()}),
  cachedSynthesis: (id: string, date: string, basis: string) => synthesisCache.peek(synthesisKey(id, date, basis)),
  synthesize(id: string, date: string, basis: string) {
    const runtime = selectedAiRuntime();
    return synthesisCache.read(synthesisKey(id, date, basis), false,
      () => post<MentorAnswer>(id, '/synthesis', {date, basis, ...runtime}),
      value => value.mode === 'ai' ? reviewTtl(date) : 0);
  },
  async condition(id: string, date: string, basis: string, metric: string) {
    const result = await post<{date: string; metric: string}>(id, '/condition', {date, basis, metric});
    insightCache.forget(insightKey(id, date));
    insightCache.forget(insightKey(id, ''));
    return result;
  },
  materials: (id: string) => callBackend<MentorMaterials>(path(id) + '/materials'),
  async importMaterial(id: string, input: MaterialInput) {
    const result = await post<MentorMaterials>(id, '/materials', input);
    revisions.set(id, (revisions.get(id) ?? 0) + 1);
    return result;
  },
  profile: (id: string) => callBackend<Profile>(path(id)),
  today: (id: string) => callBackend<Today>(path(id) + '/today'),
  compare: (id: string) => post<Today>(id, '/today', {}),
  example: (id: string, methodId: string, caseId: string) => post<Example>(id, '/example', { methodId, caseId }),
  answer: (id: string, caseId: string, answer: Decision) => post<Attempt>(id, '/attempt', { caseId, ...answer }),
  revise: (id: string, caseId: string, revision: string) => post<Attempt>(id, '/revise', { caseId, revision }),
  coach: (id: string, caseId: string) => post<{ text: string }>(id, '/coach', { caseId, ...selectedAiRuntime() }),
  plan: (id: string, date: string, answer: Decision, hinted: boolean) => post<Plan>(id, '/plan', { date, ...answer, hinted }),
  review: (id: string, date: string, review: string) => post<Plan>(id, '/review', { date, review }),
};







