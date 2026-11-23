import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {matchRoutes} from 'react-router-dom';
import {WORKSPACE_PATHS,workspaceRoute,isWorkspacePath} from '../src/verticals/finance/lib/workspaceRoutes.ts';
import {workspaceReturn} from '../src/verticals/finance/lib/workspaceJourney.ts';

test('actual router retains all routes, aliases, lazy loading and exact safe return matching',()=>{
 const source=readFileSync(new URL('../src/verticals/finance/router.tsx',import.meta.url),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 let routes:any;
 const exports:any={};
 const jsx=(type:any,props:any)=>({type,props});
 runInNewContext(js,{exports,require:(name:string)=>name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='react-router-dom'?{createBrowserRouter:(tree:any)=>(routes=tree),Navigate:'Navigate'}:name==='@/lib/workspaceRoutes'?{workspaceRoute}:new Proxy({},{get:(_t,key)=>key})});
 const children=routes[0].children;
 assert.deepEqual(Array.from(children,(r:any)=>r.path),[...WORKSPACE_PATHS]);
 assert.equal(typeof children.find((r:any)=>r.path==='/player-analysis')?.lazy,'function');
 assert.equal(children.filter((r:any)=>typeof r.lazy==='function').length,30);
 assert.ok(routes[0].errorElement);assert.ok(routes[0].hydrateFallbackElement);
 const cases=[...WORKSPACE_PATHS.map(p=>p.replace(':tab','history').replace(':key','semiconductor')),'/shortline/review'];
 assert.equal(cases.length,36);
 for(const path of cases){assert.ok(matchRoutes(routes,path),path);assert.ok(isWorkspacePath(path),path);assert.ok(workspaceReturn(path),path);}
 for(const path of ['/workbench/unknown','/watch/unknown','/calendar/unknown','/shortline/history/deeper','/unknown']){assert.equal(matchRoutes(routes,path),null);assert.equal(workspaceReturn(path),null);}
 for(const [path,to,tab] of [['/','/watch',undefined],['/daily-review','/shortline',undefined],['/stock-data','/research',undefined],['/watchlist','/my-stocks','watch'],['/portfolio','/my-stocks','hold']]){
  const route=children.find((r:any)=>r.path===path);assert.equal(route.element.props.to,to);assert.equal(route.element.props.tab,tab);
 }
 assert.equal(workspaceReturn('/watchlist?symbol=600000&tab=hold'),'/my-stocks?symbol=600000&tab=watch');
 assert.equal(workspaceReturn('/stock-data?symbol=600000'),'/research?symbol=600000');
});
