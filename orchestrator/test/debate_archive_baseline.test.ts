import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../src/finance/register.ts';
import {currentPlugin} from '../src/plugin.ts';
import {upsertRecord} from '../src/ledger.ts';
import {latestArchivedComparison,type ServiceContext} from '../src/service.ts';
test('latest server archive selects exact subject and excludes audit appendix',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'askill-baseline-'));
 try{
  const add=(symbol:string,text:string)=>upsertRecord(root,'note',{category:'debate',title:`多空辩论 · ${symbol}`,body:`## 综合判断\n${text}\n### 数字复核\n不应进入比较基线`});
  add('600825','较早判断');await new Promise(r=>setTimeout(r,10));
  const latest=add('600825','最近一次已保存判断');add('600519','其他股票不得混入');
  const result=latestArchivedComparison({dataRoot:root} as ServiceContext,currentPlugin().debate!,'600825');
  assert.deepEqual(result,{text:'最近一次已保存判断',at:latest.created_at});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
