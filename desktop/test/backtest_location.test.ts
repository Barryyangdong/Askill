import test from 'node:test';
import assert from 'node:assert/strict';
import {backtestSourceKey,backtestJobParams} from '../src/verticals/finance/lib/backtestLocation.ts';
test('回测从模式提交、继续补充、恢复任务时来源身份保持稳定',()=>{
 const source=new URLSearchParams('pattern=leader&mode=custom&version=2&symbol=600000&job=old');
 const start=backtestJobParams(source);
 const running=backtestJobParams(start,'new');
 assert.equal(start.get('job'),null);assert.equal(source.get('job'),'old');
 assert.equal(running.get('job'),'new');assert.equal(running.get('symbol'),'600000');
 assert.equal(backtestSourceKey(source),backtestSourceKey(start));
 assert.equal(backtestSourceKey(start),backtestSourceKey(running));
 assert.notEqual(backtestSourceKey(source),backtestSourceKey(new URLSearchParams('mode=custom&version=3')));
});
