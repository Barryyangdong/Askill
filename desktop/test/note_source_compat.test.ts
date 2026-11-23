import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import {recordSource,recordSourceHref} from "../src/verticals/finance/lib/recordSource.ts";
test("记录保存只向支持来源的新服务发送来源",async()=>{
 const code=ts.transpileModule(fs.readFileSync(new URL("../src/verticals/finance/lib/notes.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 let supported=false;const writes:any[]=[];
 const backend={ledger:async()=>({kinds:{note:{properties:{category:{enum:["research"]},...(supported?{workspace_source:{}}:{})}}},labels:{enums:{}},records:{note:[]}}),ledgerSave:async(_kind:string,record:any)=>{writes.push(record);return {...record,id:"note-1",created_at:"2026-01-01T00:00:00Z"};}};
 const exports:any={};runInNewContext(code,{exports,Date,require:(id:string)=>id==="./backend"?{backend}:id==="./recordSource"?{recordSource,recordSourceHref}:null});
 await exports.hydrateNotes();const source={page:"/research",symbol:"600519",run:"run-1"};
 await exports.addNote("研究报告","旧服务","正文",source);assert.equal(writes[0].workspace_source,undefined);
 supported=true;await exports.hydrateNotes();await exports.addNote("研究报告","新服务","正文",source);
 assert.equal(writes[1].workspace_source.run,"run-1");assert.equal(writes[1].symbol,"600519");
});
