import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {withRenderer,textOf} from './helpers/render.ts';
test('资料正文依据真实页码分段，引用页缺失明确提示',async()=>{
 await withRenderer(async r=>{
  const {reportPages,ReportText}=await r.load('/src/verticals/finance/components/ReportText.tsx');
  assert.deepEqual(reportPages('前言\n--- 第 1 页 ---\n第一页\n--- 第 3 页 ---\n第三页'),[{page:null,text:'前言\n'},{page:'1',text:'第一页'},{page:'3',text:'第三页'}]);
  const text=textOf(r.html(ReportText,{text:'--- 第 1 页 ---\n正文',page:'2'}));
  assert.match(text,/预览中没有第 2 页标记/);
  assert.deepEqual(reportPages('无分页正文'),[{page:null,text:'无分页正文'}]);
 });
});
test('资料与研究记录首屏显示读取状态而不是错误空态',async()=>{
 await withRenderer(async r=>{
  const {MemoryRouter}=await r.load('react-router-dom');
  const {AiPageProvider}=await r.load('/src/core/ai/pageContext.tsx');
  const {MyReports}=await r.load('/src/verticals/finance/pages/MyReports.tsx');
  const report=textOf(r.html(()=>createElement(MemoryRouter,{},createElement(AiPageProvider,{},createElement(MyReports))),{}));
  assert.match(report,/正在读取本地资料库/);assert.doesNotMatch(report,/还没有归档的研报/);
  const {Notes}=await r.load('/src/verticals/finance/pages/Notes.tsx');
  const notes=textOf(r.html(()=>createElement(MemoryRouter,{},createElement(AiPageProvider,{},createElement(Notes))),{}));
  assert.match(notes,/正在同步研究记录/);assert.doesNotMatch(notes,/还没有记录。在/);
 });
});
test('事件概率在失败和空结果时保留刷新并区分覆盖',async()=>{
 await withRenderer(async r=>{
  const {EventsStatus}=await r.load('/src/verticals/finance/components/EventsStatus.tsx');
  const props={loading:false,refreshing:false,refresh:()=>{},staleNote:null};
  const failed=textOf(r.html(EventsStatus,{...props,data:null,err:'离线'}));assert.match(failed,/离线/);assert.match(failed,/刷新/);
  const partial=textOf(r.html(EventsStatus,{...props,data:{items:[],partial:true,updated:'t'},err:null,staleNote:'刷新失败，保留存档'}));assert.match(partial,/不完整/);assert.match(partial,/存档/);assert.match(partial,/刷新/);
  const empty=textOf(r.html(EventsStatus,{...props,data:{items:[],partial:false,updated:'t'},err:null}));assert.match(empty,/没有符合条件/);
 });
});
