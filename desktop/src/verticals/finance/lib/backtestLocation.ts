/** Keep experiment context stable while a detached turn starts or resumes. */
export function backtestSourceKey(params:URLSearchParams):string {
 return JSON.stringify(['pattern','mode','version'].map(key=>params.get(key)??''));
}
export function backtestJobParams(params:URLSearchParams,job?:string):URLSearchParams {
 const next=new URLSearchParams(params);
 if(job)next.set('job',job);else next.delete('job');
 return next;
}
