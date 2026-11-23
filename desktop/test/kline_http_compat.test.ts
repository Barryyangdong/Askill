import assert from "node:assert/strict";
import {test} from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {AddressInfo} from "node:net";
import "../../orchestrator/src/finance/register.ts";
import {createApiServer} from "../../orchestrator/src/api.ts";
import {createServer} from "vite";
import http from "node:http";

const input={symbol:"600519",period:"day",adjust:"qfq",charts:true};
test("实际 HTTP: K 线缓存、强刷、旧契约重试与其他错误", async()=>{
 const vite=await createServer({root:process.cwd(),logLevel:"silent",appType:"custom",server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},ssr:{noExternal:["react-router-dom","react-router"]}});
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"chart-http-"));
 const repo=path.join(root,"repo"),data=path.join(root,"data"); fs.mkdirSync(path.join(repo,"backtest"),{recursive:true}); fs.mkdirSync(data);
 fs.writeFileSync(path.join(repo,"backtest","__init__.py"),"");
 fs.writeFileSync(path.join(repo,"backtest","kline.py"),`import json,pathlib,sys\nr=json.load(sys.stdin)\nwith pathlib.Path('calls.txt').open('a') as f: f.write('1\\n')\ns={'dates':['2026-10-12'],'open':[1],'high':[1],'low':[1],'close':[1],'volume':[1],'change':[None]}\nprint(json.dumps({'ok':True,'result':{'symbol':'600519.SH','period':'day','bars':1,'fetched_at':'2026-10-12T02:00:00Z','ui_only':{'series':s}}}))\n`);
 const python=path.resolve("..", ".venv",process.platform==="win32"?"Scripts/python.exe":"bin/python");
 const token="isolated-test-token-12345";
 const server=createApiServer({repoRoot:repo,dataRoot:data,python,node:process.execPath},{token});
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const port=(server.address() as AddressInfo).port, original=globalThis.fetch;
 let mode="new",requests:any[]=[], abortOnReject: AbortController | undefined;
 const proxy=http.createServer(async(req,res)=>{
   const chunks:Buffer[]=[]; for await(const chunk of req) chunks.push(Buffer.from(chunk));
   const raw=Buffer.concat(chunks).toString(),body=JSON.parse(raw||"{}"); requests.push(body);
   const reject=mode==="old"&&body.cachePolicy?{error:"bad_tool_request",message:"工具请求必须只包含 input、executionMode 和可选 llm"}:mode==="other"?{error:"tool_failed",message:"工具失败"}:mode==="near"?{error:"bad_tool_request",message:"不同的请求错误"}:null;
   if(reject){abortOnReject?.abort();res.writeHead(400,{"content-type":"application/json"});res.end(JSON.stringify(reject));return;}
   const upstream=await original(`http://127.0.0.1:${port}${(req.url??"").replace(/^\/api/,"")}`,{method:"POST",headers:{"content-type":"application/json",Authorization:`Bearer ${token}`},body:raw});
   res.writeHead(upstream.status,{"content-type":"application/json"});res.end(await upstream.text());
 });
 await new Promise<void>(resolve=>proxy.listen(0,"127.0.0.1",resolve));
 const proxyPort=(proxy.address() as AddressInfo).port;
 globalThis.fetch=(url,init)=>original(`http://127.0.0.1:${proxyPort}${String(url)}`,init);
 try {
   const {backend}=await vite.ssrLoadModule("/src/verticals/finance/lib/backend.ts");
   const call=(p:"prefer"|"fresh", name="kline", signal?:AbortSignal)=>backend.runTool(name,input,signal,p);
   const count=()=>fs.readFileSync(path.join(repo,"calls.txt"),"utf8").trim().split("\n").length;
   await call("prefer"); const cached=await call("prefer"); assert.equal(cached.cached,true); assert.equal(count(),1);
   await call("fresh"); assert.equal(count(),2);
   mode="old"; requests=[]; await call("fresh"); assert.equal(requests.length,2); assert.equal(requests[0].cachePolicy,"fresh"); assert.equal(requests[1].cachePolicy,undefined); assert.equal(count(),3);
   requests=[]; await assert.rejects(call("fresh","calc")); assert.equal(requests.length,1);
   requests=[]; await assert.rejects(backend.runTool("kline",{symbol:"600519"},undefined,"prefer")); assert.equal(requests.length,1);
   mode="other"; requests=[]; await assert.rejects(call("fresh")); assert.equal(requests.length,1);
   mode="near"; requests=[]; await assert.rejects(call("prefer")); assert.equal(requests.length,1);
   mode="old"; requests=[]; abortOnReject=new AbortController(); await assert.rejects(call("prefer","kline",abortOnReject.signal)); assert.equal(requests.length,1); abortOnReject=undefined;
   mode="old"; requests=[]; const ctl=new AbortController(); ctl.abort(); await assert.rejects(call("prefer","kline",ctl.signal)); assert.equal(count(),3);
 } finally {globalThis.fetch=original; await new Promise<void>(resolve=>proxy.close(()=>resolve())); await new Promise<void>(resolve=>server.close(()=>resolve())); await vite.close(); fs.rmSync(root,{recursive:true,force:true});}
});
