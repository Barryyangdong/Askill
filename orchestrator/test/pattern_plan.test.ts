import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../src/finance/register_tasks.ts';
import {ledgerUpsert,ledgerList} from '../src/service.ts';
test('模式来源和普通观察计划均可保存并读回',()=>{
 const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'askill-pattern-plan-'));
 const ctx={repoRoot:path.resolve('..'),dataRoot,python:'false',node:process.execPath};
 const source={pattern:'leader',run_id:'test-run',version:1,name:'空间龙头',sample_date:'2026-11-13',observed_at:'2026-11-16T07:00:00Z',reason:'最高连板样本'};
 const record=ledgerUpsert(ctx,{kind:'criterion',record:{symbol:'600825',type:'decision_point',statement:'复核后续变化',status:'pending',pattern_source:source}});
 assert.deepEqual(ledgerList(ctx,'criterion').criterion!.find(r=>r.id===record.id)!.pattern_source,source);
 assert.doesNotThrow(()=>ledgerUpsert(ctx,{kind:'criterion',record:{symbol:'600825',type:'decision_point',statement:'普通观察'}}));
 assert.throws(()=>ledgerUpsert(ctx,{kind:'criterion',record:{type:'decision_point',statement:'无效来源',pattern_source:{...source,version:0}}}));
});
