import test from 'node:test';
import assert from 'node:assert/strict';
import {coverage,quoteAge,type MarketQuote} from '../src/finance/shortline/market_scan.ts';
import {evaluatePattern,validatePatternPool} from '../src/finance/shortline/pattern_lab.ts';
import {assertArgs} from '../src/service.ts';
test('larger batches require a bounded trusted endpoint declaration',()=>{
 const ep={id:'example',module:'example',function:'example',market:[],args:{codes:[]}};
 assert.throws(()=>assertArgs(ep,{codes:Array(51).fill('x')}));
 assert.equal((assertArgs({...ep,arg_array_limits:{codes:200}},{codes:Array(200).fill('x')}).codes as string[]).length,200);
 assert.throws(()=>assertArgs({...ep,arg_array_limits:{codes:200}},{codes:Array(201).fill('x')}));
 assert.throws(()=>assertArgs({...ep,arg_array_limits:{codes:10000}},{codes:Array(51).fill('x')}));
 assert.throws(()=>assertArgs(ep,{arg_array_limits:200}));
});
const now=Date.parse('2026-11-16T10:00:30+08:00');
test('historical pools reject duplicate stocks and invalid board counts',()=>{
 const stock={code:'600000',name:'样本',boards:2};
 assert.doesNotThrow(()=>validatePatternPool([stock]));
 assert.throws(()=>validatePatternPool([stock,stock]));
 assert.throws(()=>validatePatternPool([{...stock,boards:0}]));
});
const quote:MarketQuote={symbol:'sh600000',name:'样本',price:10.3,pct:3,open:9.9,last_close:10,high:10.4,low:9.8,amount:100,limit_up:11,quote_time:'20261116100000'};
test('coverage keeps missing inventory, stale prices and invalid future time visible',()=>{
 const stocks=[quote,{symbol:'sz000001',name:'二'},{symbol:'bj920001',name:'三'}];
 const c=coverage(stocks,[quote,{...quote,symbol:'sz000001',quote_time:'20261113095900'}],4,now);
 assert.deepEqual([c.fresh,c.stale,c.missing,c.unlisted,c.inventory_complete],[1,1,1,1,false]);
 assert.equal(quoteAge('20261116110000',now),null);assert.equal(quoteAge('garbage',now),null);
 assert.equal(coverage(stocks,[{...quote,price:0}],3,now).missing,3);
});
test('leader uses full pool before exclusions, retains ties, no single-board leader',()=>{
 const stocks=[{code:'600000',name:'A',boards:3},{code:'000001',name:'B',boards:3},{code:'000002',name:'C',boards:2}];
 assert.deepEqual(evaluatePattern('leader',stocks,[],now).filter(r=>r.status==='met').map(r=>r.code),['600000','000001']);
 assert.equal(evaluatePattern('leader',[{code:'600000',name:'A',boards:1}],[],now)[0]?.status,'unmet');
 assert.equal(evaluatePattern('first_board',[{code:'600000',name:'ST A',boards:1}],[],now)[0]?.status,'unmet');
});
test('weak-to-strong needs real prior weakness and current-session fresh prices',()=>{
 const stock={code:'600000',name:'样本',boards:2,broken_times:2};
 assert.equal(evaluatePattern('weak_to_strong',[stock],[quote],now)[0]?.status,'met');
 assert.equal(evaluatePattern('weak_to_strong',[{...stock,broken_times:undefined}],[quote],now)[0]?.status,'missing');
 assert.equal(evaluatePattern('weak_to_strong',[stock],[{...quote,quote_time:'20261113095900'}],now)[0]?.status,'missing');
 assert.equal(evaluatePattern('weak_to_strong',[stock],[{...quote,open:10.1}],now)[0]?.status,'unmet');
 assert.equal(evaluatePattern('weak_to_strong',[stock],[quote],Date.parse('2026-11-16T15:01:00+08:00'))[0]?.status,'missing');
});
