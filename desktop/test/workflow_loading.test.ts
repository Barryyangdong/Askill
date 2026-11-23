import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {withRenderer,textOf} from './helpers/render.ts';
test('任务首屏区分正在读取与空列表，深链接显示读取目标',async()=>{
 await withRenderer(async r=>{
  const {Tasks}=await r.load('/src/verticals/finance/pages/Tasks.tsx');
  const {MemoryRouter}=await r.load('react-router-dom');
  const html=r.html(()=>createElement(MemoryRouter,{initialEntries:['/tasks?job=example']},createElement(Tasks)),{});
  const text=textOf(html);
  assert.match(text,/正在读取任务列表/);
  assert.match(text,/正在读取所选任务/);
  assert.doesNotMatch(text,/还没有后台任务/);
  assert.match(text,/待处理/);
 });
});
