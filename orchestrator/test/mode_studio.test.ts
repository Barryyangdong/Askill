import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../src/finance/register.ts';
import {modeAction,validateModeQuery,combineSamples,tickModes} from '../src/finance/mode_studio.ts';
import type {ServiceContext} from '../src/service.ts';
import type {CandidateResult} from '../src/finance/candidates.ts';

test('starter creates a frozen rule and combination atomically without enabling tracking',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'askill-preset-'));
 try {
  const ctx={dataRoot:root} as ServiceContext;const signal=new AbortController().signal;
  const saved=await modeAction(ctx,{action:'create_preset',preset:'active'},signal);
  assert.equal(saved.rules.length,1);assert.equal(saved.combinations.length,1);
  assert.deepEqual(saved.combinations[0]!.rules,[{id:saved.rules[0]!.id,version:1}]);
  assert.equal(saved.rules[0]!.query.volume_ratio_min,'1.5');assert.equal(saved.runs.length,0);assert.equal(saved.tracking,undefined);
  await assert.rejects(modeAction(ctx,{action:'create_preset',preset:'unknown'},signal));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'mode-studio.json'),'utf8')).rules.length,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('rule revisions retain frozen versions and reject stale edits or private scope',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'askill-modes-'));
 try{const ctx={dataRoot:root} as ServiceContext;const signal=new AbortController().signal;
 const s=await modeAction(ctx,{action:'save_rule',name:'范围观察',base_version:0,query:{universe:'watch',change_pct_min:'2'}},signal);
 const first=s.rules[0]!;
 const s2=await modeAction(ctx,{action:'save_rule',id:first.id,name:'修订',base_version:1,query:{universe:'watch',change_pct_min:'3'}},signal);
 assert.equal(s2.rules[0]!.query.change_pct_min,'2');assert.equal(s2.rules[1]!.version,2);
 await assert.rejects(modeAction(ctx,{action:'save_rule',id:first.id,name:'迟到修改',base_version:1,query:first.query},signal));
 assert.throws(()=>validateModeQuery({universe:'position',change_pct_min:'1'}));
 assert.throws(()=>validateModeQuery({universe:'watch',change_pct_min:'3',change_pct_max:'2'}));
 assert.throws(()=>validateModeQuery({universe:'watch',script:'process.exit()'}));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('sample funnel separates missing data, duplicates and capacity',()=>{
 const result=(rows:CandidateResult['rows'])=>({rows}) as CandidateResult;
 const row=(symbol:string,verdict:'met'|'missing'|'unmet')=>({symbol,name:symbol,verdict,checks:[]});
 const s=combineSamples([result([row('600002','met'),row('600001','met'),row('600003','missing')]),result([row('600001','met'),row('600004','met'),row('600005','unmet')])],[{id:'a',version:1},{id:'b',version:1}],2);
 assert.deepEqual(s.map(r=>r.status),['included','included','missing','duplicate','capacity','unmet']);
 assert.equal(s[0]!.symbol,'600001');
});
test('forward monitoring is opt-in and repeated ticks do not duplicate the interval',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'askill-forward-'));
 try{
  const ctx={dataRoot:root} as ServiceContext;const signal=new AbortController().signal;
  const a=await modeAction(ctx,{action:'save_rule',name:'范围',base_version:0,query:{universe:'watch',amount_min:'1'}},signal);
  const b=await modeAction(ctx,{action:'save_combination',name:'组合',base_version:0,rules:[{id:a.rules[0]!.id,version:1}],limit:10},signal);
  await tickModes(ctx,signal);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'mode-studio.json'),'utf8')).runs.length,0);
  await modeAction(ctx,{action:'track',id:b.combinations[0]!.id,version:1,enabled:true},signal);
  await tickModes(ctx,signal);await tickModes(ctx,signal);
  const stored=JSON.parse(fs.readFileSync(path.join(root,'mode-studio.json'),'utf8'));
  assert.equal(stored.runs.length,1);assert.equal(stored.runs[0].samples.length,0);assert.equal(stored.runs[0].results[0].universe.size,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
