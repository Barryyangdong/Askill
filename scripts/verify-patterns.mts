import '../orchestrator/src/finance/register.ts';
import '../orchestrator/src/finance/shortline/pattern_lab.ts';
import {runViewAction} from '../orchestrator/src/views.ts';
const repo=process.cwd();const ctx={repoRoot:repo,dataRoot:repo+'/.local',python:repo+'/.venv/Scripts/python.exe',node:process.execPath};
for(const pattern of ['leader','first_board','weak_to_strong']){
 const v=await runViewAction(ctx,'pattern_lab',{action:'observe',pattern},new AbortController().signal);
 const r=v.runs.at(-1); console.log(JSON.stringify({pattern,pool:r.pool_count,sample_date:r.sample_date,quote_date:r.quote_date,met:r.rows.filter(x=>x.status==='met').length,missing:r.rows.filter(x=>x.status==='missing').length}));
}
const v=await runViewAction(ctx,'pattern_lab',{action:'history',pattern:'leader'},new AbortController().signal);
console.log(JSON.stringify({history:v.history.at(-1)}));
