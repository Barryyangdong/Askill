import test from 'node:test';
import assert from 'node:assert/strict';
import {patternPlan,patternPlanHref} from '../src/verticals/finance/lib/patternPlan.ts';
import type {PatternStore} from '../src/verticals/finance/lib/marketPatterns.ts';
const store:PatternStore={patterns:[{id:'leader',name:'空间龙头',rule:'规则',timing:'盘后',history:''}],runs:[{id:'r1',pattern:'leader',version:1,at:'2026-11-16T07:00:00Z',sample_date:'2026-11-13',quote_date:'2026-11-16',pool_count:1,rows:[{code:'600825',name:'新华传媒',boards:3,status:'met',reason:'最高连板样本',price:13,pct:0,quote_time:null}]}]};
test('候选草稿来自指定留存记录，保留日期、版本及理由',()=>{
 const draft=patternPlan(store,'r1','600825');assert.equal(draft?.source.run_id,'r1');assert.equal(draft?.source.sample_date,'2026-11-13');assert.match(draft!.statement,/新华传媒.*空间龙头/);assert.match(draft!.statement,/最高连板样本/);
 assert.equal(patternPlan(store,'missing','600825'),null);assert.equal(patternPlan(store,'r1','000001'),null);
 const copy=structuredClone(store);copy.runs[0]!.rows[0]!.status='unmet';assert.equal(patternPlan(copy,'r1','600825'),null);
 assert.equal(new URL(patternPlanHref('leader','r1','600825'),'http://local').searchParams.get('run'),'r1');
});
