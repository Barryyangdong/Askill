import test from 'node:test';
import assert from 'node:assert/strict';
import { pollDeepRun } from '../src/verticals/finance/lib/reportTaskPoll.ts';
test('查询暂时失败后仍使用原运行身份重试', async () => {
 const calls: string[] = [];
 const resume = async (id: string, fingerprint: string) => { calls.push(`${id}:${fingerprint}`); if (calls.length === 1) throw new Error('offline'); return {status:'completed'}; };
 await assert.rejects(pollDeepRun('run-1','route-1',resume));
 assert.equal((await pollDeepRun('run-1','route-1',resume)).status,'completed');
 assert.deepEqual(calls,['run-1:route-1','run-1:route-1']);
});
