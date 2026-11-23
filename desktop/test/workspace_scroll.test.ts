import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceScroll } from "../src/verticals/finance/lib/workspaceScroll.ts";
function setup() {
  let top = 0, height = 2000;
  let resize: (() => void) | null = null, timeout: (() => void) | null = null;
  const surface = {
    get scrollTop() { return top; },
    set scrollTop(value: number) { top = Math.max(0, Math.min(value, height - 400)); },
    get scrollHeight() { return height; }, clientHeight: 400,
  };
  const scroll = new WorkspaceScroll('/watch', 'a', surface, {
    observe: callback => { resize = callback; return () => { resize = null; }; },
    later: callback => { timeout = callback; return () => { timeout = null; }; },
  });
  return {surface, scroll, height(value: number) {height = value; surface.scrollTop = top;}, resize() {resize?.();}, timeout() {timeout?.();}, observing: () => resize !== null};
}
test('详情 query 新记录继承滚动，异步内容长够后恢复原位置', () => {
  const x = setup(); x.surface.scrollTop = 623; x.scroll.onScroll();
  assert.equal(x.scroll.navigate('/watch', 'detail', 'PUSH'), false);
  assert.equal(x.scroll.navigate('/watch', 'closed', 'PUSH'), false);
  x.scroll.navigate('/shortline', 'review', 'PUSH'); assert.equal(x.surface.scrollTop, 0);
  x.height(500); x.scroll.navigate('/watch', 'closed', 'POP'); assert.equal(x.surface.scrollTop, 100);
  x.scroll.onScroll(); x.height(2000); x.resize();
  assert.equal(x.surface.scrollTop, 623); assert.equal(x.observing(), false);
});
test('模式 query 切换后结果滚动在返回时恢复，用户介入则不抢回', () => {
  const x = setup(); x.scroll.navigate('/modes', 'mode', 'PUSH');
  x.scroll.navigate('/modes', 'first', 'REPLACE'); x.surface.scrollTop = 920; x.scroll.onScroll();
  x.scroll.navigate('/shortline', 'review', 'PUSH'); x.height(500); x.scroll.navigate('/modes', 'first', 'POP');
  x.scroll.cancel(); x.surface.scrollTop = 30; x.scroll.onScroll(); x.height(2000); x.resize();
  assert.equal(x.surface.scrollTop, 30); assert.equal(x.observing(), false);
});
test('短内容超时和再次导航均清理待恢复任务', () => {
  const x = setup(); x.surface.scrollTop = 800; x.scroll.onScroll();
  x.scroll.navigate('/shortline', 'review', 'PUSH'); x.height(500);
  x.scroll.navigate('/watch', 'a', 'POP'); assert.equal(x.observing(), true);
  x.timeout(); assert.equal(x.observing(), false); x.height(2000); x.resize(); assert.equal(x.surface.scrollTop, 100);
  x.scroll.navigate('/other', 'other', 'PUSH'); x.scroll.dispose();
});

test('模式结果在异步记录加载后恢复，前进跨栏目回到页首', () => {
  const x = setup(); x.scroll.navigate('/modes', 'mode', 'PUSH');
  x.scroll.navigate('/modes', 'first', 'REPLACE'); x.surface.scrollTop = 920; x.scroll.onScroll();
  x.scroll.navigate('/shortline', 'review', 'PUSH'); x.height(500);
  x.scroll.navigate('/modes', 'first', 'POP'); x.scroll.onScroll();
  x.height(2000); x.resize(); assert.equal(x.surface.scrollTop, 920);
  x.scroll.navigate('/shortline', 'review', 'POP'); assert.equal(x.surface.scrollTop, 0);
});
