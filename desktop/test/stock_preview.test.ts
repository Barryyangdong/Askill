import assert from 'node:assert/strict';
import test from 'node:test';
import { withRenderer } from './helpers/render.ts';
test('走势窗口在小屏、越界拖动和缩放后仍完整留在视口', async () => {
  await withRenderer(async r => {
    const {fitPreview} = await r.load('/src/verticals/finance/components/StockPreview.tsx');
    assert.deepEqual(fitPreview({x:1200,y:900,width:720,height:540},390,700),{x:8,y:152,width:374,height:540});
    assert.deepEqual(fitPreview({x:-100,y:-40,width:100,height:80},1440,900),{x:8,y:8,width:320,height:240});
    assert.deepEqual(fitPreview({x:100,y:100,width:720,height:540},1440,900),{x:100,y:100,width:720,height:540});
  });
});
