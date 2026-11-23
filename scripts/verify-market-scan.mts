import '../orchestrator/src/finance/register.ts';
import {tickMarket} from '../orchestrator/src/finance/shortline/market_scan.ts';
import {runView} from '../orchestrator/src/views.ts';
const repo=process.cwd();const ctx={repoRoot:repo,dataRoot:repo+'/.local',python:repo+'/.venv/Scripts/python.exe',node:process.execPath};
await tickMarket(ctx,new AbortController().signal,true);
const v=await runView(ctx,'market_scan',{},new AbortController().signal);
console.log(JSON.stringify({coverage:v.coverage,error:v.error,duration_ms:v.duration_ms,cycle:v.cycle,first:v.rows.slice(0,2)},null,2));
