/** Explicit local quality run; never reads ledgers, credentials or user documents. */
import fs from 'node:fs';
import path from 'node:path';
import {runLocalAgent,loadSavedAgentPaths,type LocalAgentId} from '../orchestrator/src/local_agent_runtime.ts';
import {FINANCE_DEBATE} from '../orchestrator/src/finance/debate_policy.ts';
import {RESEARCH_QUALITY_CASES} from '../orchestrator/src/finance/research_quality_cases.ts';
import '../orchestrator/src/finance/register.ts';
import {startDebate,advanceDebate,DEBATE_PREAMBLE,resetDebates} from '../orchestrator/src/debate.ts';
const args=process.argv.slice(2);
const option=(name:string)=>args[args.indexOf(name)+1];
if(!args.includes('--out')||!args.includes('--provider'))throw Error('Usage: node scripts/evaluate-research.mts --provider codebuddy|codex|claude --out <new absolute directory>');
const provider=option('--provider') as LocalAgentId;
if(!['codebuddy','codex','claude'].includes(provider))throw Error('Unsupported provider');
const root=option('--out');
if(!path.isAbsolute(root)||fs.existsSync(root))throw Error('Use a new absolute output directory');
// Reuse the product's configured executable location, never its authentication files.
loadSavedAgentPaths(path.resolve('.local'));
const results:Record<string,unknown>[]=[];
let failures=0;
const selected=args.includes('--cases')?option('--cases').split(','):null;
if(selected?.some(id=>!RESEARCH_QUALITY_CASES.some(c=>c[0]===id)))throw Error('Unknown case ID');
const cases=RESEARCH_QUALITY_CASES.filter(c=>!selected||selected.includes(c[0]));
fs.mkdirSync(root,{recursive:true});
for(const [id,facts,rubric] of cases){
 const started=Date.now();
 try{
  const report= args.includes('--gate') ? await (async()=>{
   resetDebates();startDebate({id,symbol:'SYNTHETIC',depth:'1',envelopes:[{script:'controlled_case',evidence:[{id:'ev-case',field:'synthetic_facts',value:facts,unit:'text',period:'以事实中分析时点为准'}]}],gaps:['合成控制场景，不是真实股票；仅核验角色输出边界']});
   const result=await advanceDebate({repoRoot:process.cwd()},{id,stageId:'bull'},(message,_session,signal,timeoutMs)=>runLocalAgent(provider,{systemPrompt:DEBATE_PREAMBLE,userPrompt:message,timeoutMs:Math.min(90000,timeoutMs??90000),signal,thinkingEnabled:false,reasoningEffort:'low'}));
   const stage=result.stages[0]!;if(stage.status!=='done')throw Error(stage.error??'Output gate did not accept the result');return stage.text;
  })():await runLocalAgent(provider,{systemPrompt:FINANCE_DEBATE.stages.find(s=>s.id==='bull')!.prompt,
   userPrompt:`这是合成控制场景，不是真实股票，不得扩展包外事实。共同资料只有：\n[ev-case] ${facts}\n按角色要求输出，正文控制在350字以内，保留真实引用。`,
   timeoutMs:90000,thinkingEnabled:false,reasoningEffort:'low'});
  const citations=[...report.matchAll(/ev-[a-zA-Z0-9_-]+/g)].map(m=>m[0]);
  const record={id,facts,rubric,provider,productionGate:args.includes('--gate'),seconds:(Date.now()-started)/1000,report,
   citationCheck:citations.length>0&&citations.every(c=>c==='ev-case')?'pass':'review',semanticReview:'pending'};
  fs.writeFileSync(path.join(root,`${id}.json`),JSON.stringify(record,null,2));results.push(record);
  failures=0;
 }catch(e){failures++;results.push({id,provider,seconds:(Date.now()-started)/1000,error:e instanceof Error?e.message:String(e),semanticReview:'not_run'});}
 fs.writeFileSync(path.join(root,'index.json'),JSON.stringify({kind:'synthetic_control_cases',historicalBenchmark:false,results},null,2));
 console.log(JSON.stringify({id,completed:results.length,total:cases.length,error:!!results.at(-1)?.error}));
 if(failures>=2){process.exitCode=1;break;}
}
