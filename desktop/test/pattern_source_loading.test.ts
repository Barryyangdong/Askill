import test from 'node:test';
import assert from 'node:assert/strict';
import {createPatternSourceLoader, type PatternSourceState} from '../src/verticals/finance/lib/patternPlan.ts';
import type {PatternStore} from '../src/verticals/finance/lib/marketPatterns.ts';
const store:PatternStore={patterns:[{id:'p',name:'模式',rule:'',timing:'',history:''}],runs:[{id:'r',pattern:'p',version:2,at:'2026-11-16T07:00:00Z',sample_date:'2026-11-13',quote_date:'2026-11-16',pool_count:1,rows:[{code:'600825',name:'样本',boards:1,status:'met',reason:'依据',price:1,pct:0,quote_time:null}]}]};
function deferred<T>() { let resolve!:(v:T)=>void; let reject!:(e:Error)=>void; const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; }
test('来源失败后重试并核对来源身份',async()=>{
 const states:PatternSourceState[]=[];let calls=0;
 const loader=createPatternSourceLoader(async()=>{if(++calls===1)throw Error('offline');return store;},s=>states.push(s));
 await loader.load('r','600825','p');assert.equal(states.at(-1)?.status,'error');
 await loader.load('r','600825','p');const ready=states.at(-1);assert.equal(ready?.status,'ready');if(ready?.status==='ready')assert.equal(ready.draft.source.version,2);
 await loader.load('r','600825','other');assert.equal(states.at(-1)?.status,'missing');
});
test('切换来源和卸载后迟到的响应不会覆盖当前状态',async()=>{
 const first=deferred<PatternStore>();const second=deferred<PatternStore>();const states:PatternSourceState[]=[];let n=0;
 const loader=createPatternSourceLoader(()=>++n===1?first.promise:second.promise,s=>states.push(s));
 const old=loader.load('r','600825','p');const current=loader.load('r','000001','p');second.resolve(store);await current;assert.equal(states.at(-1)?.status,'missing');
 first.resolve(store);await old;assert.equal(states.at(-1)?.status,'missing');
 const pending=deferred<PatternStore>();const disposedStates:PatternSourceState[]=[];const disposed=createPatternSourceLoader(()=>pending.promise,s=>disposedStates.push(s));
 const request=disposed.load('r','600825','p');disposed.dispose();pending.reject(Error('offline'));await request;assert.deepEqual(disposedStates.map(s=>s.status),['loading']);
});
