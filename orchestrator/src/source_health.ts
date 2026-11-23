import fs from "node:fs";
import path from "node:path";
interface Health { endpoint: string; requests: number; success: number; failed: number; cached: number; consecutive_failures: number; last_ms: number; last_at: string; durations?:number[] }
const roots = new Map<string, Map<string,Health>>();
function rows(root: string) {
  if (!roots.has(root)) {
    let data: Health[] = [];
    try { data = JSON.parse(fs.readFileSync(path.join(root,"source-health.json"),"utf8")); } catch { /* Start a new observation window. */ }
    roots.set(root,new Map(data.map(r => [r.endpoint,r])));
  }
  return roots.get(root)!;
}
export function recordSource(root: string, endpoint: string, ok: boolean, cached: boolean, ms: number) {
  const map = rows(root);
  const row = map.get(endpoint) ?? {endpoint,requests:0,success:0,failed:0,cached:0,consecutive_failures:0,last_ms:0,last_at:""};
  row.requests++; if (cached) row.cached++;
  else if (ok) { row.success++; row.consecutive_failures=0; }
  else { row.failed++; row.consecutive_failures++; }
  if(!cached&&Number.isFinite(ms)&&ms>=0)row.durations=[...(row.durations??[]),Math.round(ms)].slice(-100);
  row.last_ms=ms; row.last_at=new Date().toISOString(); map.set(endpoint,row);
  try { fs.writeFileSync(path.join(root,"source-health.json.tmp"), JSON.stringify([...map.values()]), {mode:0o600}); fs.renameSync(path.join(root,"source-health.json.tmp"),path.join(root,"source-health.json")); } catch { /* Observability must not fail a successful request. */ }
}
export function sourceHealth(root:string) { return [...rows(root).values()].map(({durations,...row})=>{
  const sample=(durations??[]).filter(Number.isFinite).sort((a,b)=>a-b);
  const requests=row.success+row.failed;
  return {...row,success_rate:requests?row.success/requests:null,latency_samples:sample.length,
    p50_ms:sample.length?sample[Math.ceil(sample.length*.5)-1]:null,p95_ms:sample.length?sample[Math.ceil(sample.length*.95)-1]:null};
 }).sort((a,b)=>b.consecutive_failures-a.consecutive_failures); }
