import test from 'node:test';
import assert from 'node:assert/strict';
import {parseModeDraft} from '../src/verticals/finance/lib/modeDraft.ts';
test('plain-language draft converts amounts, retains exclusion and never saves automatically',()=>{
 const r=parseModeDraft('自选，非 ST，成交额至少 5000 万，量比 ≥ 1.5，涨跌幅 ≤ 5%');
 assert.ok('query'in r);assert.deepEqual(r.query,{universe:'watch',exclude_st:'1',amount_min:'0.5',volume_ratio_min:'1.5',change_pct_max:'5'});
});
test('ambiguous, unsupported or conflicting clauses block the whole draft',()=>{
 for(const input of ['自选 成交额至少1','自选 龙头明天上涨','自选 量比>1.5','自选 量比≥2 量比≤1','自选 沪深300 量比≥1','我的持仓 量比≥1','自选 换手率≥2万元','自选 量比≥1.5 量比≥2'])assert.ok('error'in parseModeDraft(input),input);
});
