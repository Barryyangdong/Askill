import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {recordSource,sourceHealth} from '../src/source_health.ts';
test('cached responses do not inflate live success rate or latency percentiles',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'askill-health-'));
 try{
  recordSource(root,'sample',true,false,100);recordSource(root,'sample',false,false,900);
  for(let i=0;i<10;i++)recordSource(root,'sample',true,true,1);
  const r=sourceHealth(root)[0]!;
  assert.equal(r.success_rate,.5);assert.equal(r.p50_ms,100);assert.equal(r.p95_ms,900);assert.equal(r.latency_samples,2);
  assert.equal(r.consecutive_failures,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
