import assert from 'node:assert/strict';
import test from 'node:test';
import {withRenderer,textOf} from './helpers/render.ts';
test('股票详情默认在工作区内，浮窗作为明确的次要操作',async()=>{
 await withRenderer(async r=>{
  const {StockDetail}=await r.load('/src/verticals/finance/components/StockDetail.tsx');
  const html=r.html(StockDetail,{title:'示例股票 600000',onClose:()=>{},children:'行情与观察记录'});
  assert.match(textOf(html),/示例股票 600000 弹出查看 返回列表 行情与观察记录/);
  assert.match(html,/class="stock-detail"/);
  assert.doesNotMatch(html,/stock-preview-window/);
 });
});
