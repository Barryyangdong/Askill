import assert from 'node:assert/strict';
import test from 'node:test';
import {NAV_SECTIONS,isGroup,movedUrl,navPageOf,navTitle,sectionPages} from '../src/verticals/finance/lib/nav.ts';
test('six task areas; utilities stay outside main navigation',()=>{
 assert.deepEqual(NAV_SECTIONS.filter(s=>!s.pinned).map(s=>s.label),['盯盘','复盘','选手分析','研究','游资蒸馏','我的']);
 assert.equal(NAV_SECTIONS.some(isGroup),true);
 const paths=NAV_SECTIONS.flatMap(sectionPages).map(p=>p.to);
 assert.equal(new Set(paths).size, paths.length);
});
test('old routes retain task ownership and specific child titles',()=>{
 for(const path of ['/','/watch','/workbench','/intel/news'])assert.equal(navPageOf(path)?.section.label,'盯盘');
 for(const path of ['/modes','/research','/debate','/backtest','/candidates','/observations'])assert.equal(navPageOf(path)?.section.label,'研究');
 assert.equal(navPageOf('/distillation')?.section.label,'游资蒸馏');
 assert.equal(navPageOf('/player-analysis')?.section.label,'选手分析');
 assert.equal(navTitle('/watch/intraday'),'竞价与盘中');
 assert.equal(navPageOf('/sectors/humanoid')?.section.label,'研究');
 assert.equal(navPageOf('/journal')?.section.label,'我的');
 assert.equal(navPageOf('/intelx'),null);
});
test('redirects preserve stock, date and anchor',()=>{
 assert.equal(movedUrl('/watch','?symbol=600825&date=2026-11-16','#x'),'/watch?symbol=600825&date=2026-11-16#x');
 assert.equal(movedUrl('/my-stocks','?tab=old&x=1','','hold'),'/my-stocks?tab=hold&x=1');
});
test('复盘五个入口在侧栏，AI 报告和统计子页高亮各自入口', () => {
 const review = NAV_SECTIONS.find(s => s.label === '复盘')!;
 assert.ok(isGroup(review));
 assert.deepEqual(review.pages.map(p => p.label), ['盘面','题材','AI 解读','历史与统计','次日验证']);
 assert.equal(navPageOf('/daily-review')?.page.to, '/shortline');
 for (const tab of ['market-report','weekreview']) assert.equal(navPageOf('/shortline/'+tab)?.page.to, '/shortline/review');
 for (const tab of ['history','samples','structure']) assert.equal(navPageOf('/shortline/'+tab)?.page.to, '/shortline/weekly');
});

import {rememberWorkspace} from '../src/verticals/finance/lib/workspaceContext.ts';
test('returning to market does not forget the selected stock',()=>{assert.equal(rememberWorkspace({symbol:'600825'},'/watch','').symbol,'600825');});
