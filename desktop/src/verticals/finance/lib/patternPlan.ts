import type {PatternStore} from './marketPatterns';

export function patternPlan(store:PatternStore, runId:string, symbol:string) {
 const run=store.runs.find(r=>r.id===runId);
 const row=run?.rows.find(r=>r.code===symbol);
 const pattern=store.patterns.find(p=>p.id===run?.pattern);
 if(!run||!row||!pattern||row.status==='unmet')return null;
 return {
  source:{pattern:run.pattern,run_id:run.id,version:run.version,name:pattern.name,sample_date:run.sample_date,observed_at:run.at,reason:row.reason},
  statement:`跟踪${row.name}（${row.code}）在${pattern.name}模式下的后续表现。留存时${row.status==='met'?'满足规则':'资料待确认'}：${row.reason}。复核后续行情及原条件是否仍成立。`.slice(0,1000),
 };
}

export function patternPlanHref(pattern:string,run:string,symbol:string) {
 return '/observations?'+new URLSearchParams({pattern,run,symbol}).toString();
}

/** Only the latest request may update the current candidate. Disposing invalidates pending work. */
export function createPatternSourceLoader(fetchStore:()=>Promise<PatternStore>, update:(state:PatternSourceState)=>void) {
 let sequence=0;
 return {
  async load(run:string,symbol:string,pattern:string) {
   const request=++sequence; update({status:'loading'});
   try {
    const draft=patternPlan(await fetchStore(),run,symbol);
    if(request!==sequence)return;
    update(draft&&draft.source.pattern===pattern?{status:'ready',draft}:{status:'missing'});
   } catch { if(request===sequence)update({status:'error'}); }
  },
  dispose() { sequence++; },
 };
}
export type PatternSourceState =
 | {status:'loading'} | {status:'error'} | {status:'missing'}
 | {status:'ready';draft:NonNullable<ReturnType<typeof patternPlan>>};
