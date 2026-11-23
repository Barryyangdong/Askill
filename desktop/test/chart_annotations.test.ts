import test from 'node:test';
import assert from 'node:assert/strict';
import {parseChartLines,parseChartSettings,visibleChartLines} from '../src/verticals/finance/lib/chartAnnotations.ts';
import {withRenderer,textOf} from './helpers/render.ts';
const line={id:'a',context:'600825:day:none',price:12.345,label:'个人测试线',createdAt:'2026-11-16T03:00:00Z'};
test('chart settings migrate existing annotations without discarding lines',()=>{
 assert.deepEqual(parseChartSettings([line]),{lines:[line],template:'ma'});
 assert.deepEqual(parseChartSettings({lines:[line],template:'bands'}),{lines:[line],template:'bands'});
});
test('annotations stay within data context and never leak into replay or privacy mode',()=>{
 const lines=parseChartLines([line,{...line,price:Infinity},{...line,price:-1}]);
 assert.equal(lines.length,1);
 assert.equal(visibleChartLines(lines,line.context,false,false).length,1);
 for(const [context,hide,replay] of [[line.context,true,false],[line.context,false,true],['600825:day:qfq',false,false]] as const) assert.equal(visibleChartLines(lines,context,hide,replay).length,0);
});
test('annotation editor masks custom price and label',async()=>{
 await withRenderer(async r=>{
  const {ChartAnnotations}=await r.load('/src/verticals/finance/components/ChartAnnotations.tsx');
  const html=r.html(ChartAnnotations,{lines:[line],context:line.context,ready:true,hide:true,error:'',save:async()=>true});
  assert.doesNotMatch(html,/12\.345|个人测试线/);
  assert.match(textOf(html),/仅供个人标注，不进入 AI/);
 });
});
