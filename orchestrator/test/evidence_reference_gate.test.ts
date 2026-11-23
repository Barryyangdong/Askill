import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceIssue} from '../src/evidence_reference_gate.ts';
test('unknown references and long uncited output are rejected without claiming semantic verification',()=>{
 assert.match(referenceIssue('事实[ev-invented]',['ev-real'])!,/不存在/);
 assert.match(referenceIssue('模型自行虚构的详细陈述。'.repeat(30),['ev-real'])!,/没有引用/);
 assert.equal(referenceIssue('仅能按本期资料判断。[ev-real]',['ev-real']),null);
 assert.equal(referenceIssue('资料不足',[]),null);
});
