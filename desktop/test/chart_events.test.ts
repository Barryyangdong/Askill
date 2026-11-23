import test from 'node:test';
import assert from 'node:assert/strict';
import {chartEvents} from '../src/verticals/finance/lib/chartEvents.ts';
const row={date:'2026-11-13 18:00',title:'公告',type:'',url:'https://example.com'};
test('event dates do not backfill weekends and duplicate notices do not inflate counts',()=>{
 const result=chartEvents([row,row,{...row,title:'第二份'},{...row,date:'2026-11-14'}],['2026-11-13','2026-11-16'],[10,11],true);
 assert.equal(result.length,1);assert.equal(result[0]?.items.length,2);assert.equal(result[0]?.price,10);
});
test('replay/disabled events and invalid prices produce no marks',()=>{
 assert.deepEqual(chartEvents([row],['2026-11-13'],[10],false),[]);
 assert.deepEqual(chartEvents([row],['2026-11-13'],[NaN],true),[]);
});
