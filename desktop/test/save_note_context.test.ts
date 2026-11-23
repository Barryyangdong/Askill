import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import {recordSource} from "../src/verticals/finance/lib/recordSource.ts";
import {readWorkspaceContext} from "../src/verticals/finance/lib/workspaceContext.ts";
test("保存按钮的业务日期进入来源，相同正文切日不沿用保存状态",async()=>{
 const source=fs.readFileSync(new URL("../src/verticals/finance/components/ui/SaveNoteButton.tsx",import.meta.url),"utf8");
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 let state:any;let written:any;const exports:any={};
 const react={useState:(initial:any)=>{if(!state)state=initial;return [state,(f:any)=>{state=typeof f==="function"?f(state):f;}];}};
 const deps:any={react,"react/jsx-runtime":{jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props}),Fragment:"fragment"},"react-router-dom":{useLocation:()=>({pathname:"/shortline",search:"",hash:""})},"@/lib/notes":{addNote:async(...args:any[])=>{written=args;},canSaveNoteSource:()=>true,canSaveResearchNote:()=>true},"../../lib/recordSource":{recordSource},"../../lib/workspaceContext":{readWorkspaceContext},"lucide-react":{Check:"check",BookmarkPlus:"bookmark",AlertCircle:"alert"}};
 runInNewContext(code,{exports,URLSearchParams,JSON,require:(id:string)=>deps[id]});
 const render=(date:string)=>exports.SaveNoteButton({kind:"复盘",title:"标题",content:"正文",context:{date}});
 await render("2026-10-12").props.onClick();
 assert.equal(written[3].date,"2026-10-12");assert.equal(render("2026-10-12").props.disabled,true);
 assert.equal(render("2026-10-13").props.disabled,false);
});
