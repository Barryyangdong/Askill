import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "../src/finance/register.ts";
import {ledgerUpsert,ledgerSnapshot,type ServiceContext} from "../src/service.ts";
test("记录来源结构化校验及旧记录兼容",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"source-record-"));
 const ctx:ServiceContext={repoRoot:process.cwd(),dataRoot:root,python:"python",node:process.execPath};
 try{
  ledgerUpsert(ctx,{kind:"note",record:{title:"旧",body:"正文"}});
  const source={page:"/debate",job:"job-1",symbol:"600519"};
  const saved=ledgerUpsert(ctx,{kind:"note",record:{title:"新",workspace_source:source}});
  assert.deepEqual(saved.workspace_source,source);
  const obs=ledgerUpsert(ctx,{kind:"criterion",record:{type:"decision_point",statement:"观察",workspace_source:{page:"/shortline/history",date:"2026-10-12"}}});
  assert.equal((obs.workspace_source as {page:string}).page,"/shortline/history");
  assert.throws(()=>ledgerUpsert(ctx,{kind:"note",record:{title:"坏",workspace_source:{page:"/tasks",job:"x",token:"secret"}}}));
  assert.equal(ledgerSnapshot(ctx).records.note?.length,2);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
