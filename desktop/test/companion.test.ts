import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {withRenderer,textOf} from './helpers/render.ts';
test('companion restores a specific task and distinguishes input required from completion',async()=>{
 await withRenderer(async r=>{
  const {CompanionJobs}=await r.load('/src/verticals/finance/pages/Companion.tsx');
  const {MemoryRouter}=await r.load('react-router-dom');
  const html=r.html(()=>createElement(MemoryRouter,null,createElement(CompanionJobs,{jobs:[{id:'example',title:'公开样本',status:'completed',outcome:'needs_input'}]})),{});
  assert.match(textOf(html),/等待补参/);assert.doesNotMatch(textOf(html),/已完成/);assert.match(html,/tasks\?job=example/);
 });
});
