import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {createServer} from "vite";
import "../../orchestrator/src/finance/register.ts";
import {bindPlayerProfile,readPlayerAnalysis,writePlayerAnalysis} from "../../orchestrator/src/finance/player_analysis.ts";

const chrome=[process.env.CHROME_PATH,"C:/Program Files/Google/Chrome/Application/chrome.exe","/usr/bin/chromium","/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(p=>p&&fs.existsSync(p));
test("默认浏览器的本场书签送回真实工作台，确认后发布可查询的快照",{skip:!chrome,timeout:90000},async()=>{
  const root=fileURLToPath(new URL("../",import.meta.url));
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"askill-browser-receive-"));
  const ctx={dataRoot:path.join(tmp,"data"),repoRoot:path.resolve(root,".."),python:"",node:process.execPath};
  const official="https://www.tgb.cn";
  const profile={userId:"10",checkedAt:new Date().toISOString(),matches:[{matchId:"m",name:"样例赛事",spmatchSeq:"88"}]};
  await bindPlayerProfile(ctx,"10",AbortSignal.timeout(5000),async()=>profile);
  const server=await createServer({root,cacheDir:path.join(tmp,"vite"),logLevel:"error",server:{host:"127.0.0.1",port:0,hmr:false,open:false},
    plugins:[{name:"player-analysis-test-page",configureServer(vite){
      vite.middlewares.use((req,res,next)=>{
        if(req.url?.split("?")[0]!=="/player-analysis")return next();
        const html='<!doctype html><div id="root"></div><script type="module">'+
          'import React from "react";import {createRoot} from "react-dom/client";import {BrowserRouter} from "react-router-dom";'+
          'import {PlayerAnalysis} from "/src/verticals/finance/pages/PlayerAnalysis.tsx";'+
          'createRoot(document.getElementById("root")).render(React.createElement(BrowserRouter,null,React.createElement(PlayerAnalysis)));</script>';
        vite.transformIndexHtml("/player-analysis",html).then(body=>{res.setHeader("Content-Type","text/html");res.end(body);}).catch(next);
      });
    }}]});
  const {chromium}=createRequire(new URL("../../orchestrator/package.json",import.meta.url))("playwright-core");
  const browser=await chromium.launch({executablePath:chrome,headless:true,chromiumSandbox:true});
  try{
    await server.listen();
    const origin=server.resolvedUrls!.local[0];
    const matchUrl=official+"/spmatch/matchAll?tid=m";
    const context=await browser.newContext();
    let commits=0;
    await context.route("**/api/**",async(route:any)=>{
      const req=route.request(),u=new URL(req.url());
      let data:unknown={};
      if(u.pathname==="/api/view/player_analysis"){
        if(req.method()==="POST"){
          const body=req.postDataJSON();
          data=writePlayerAnalysis(ctx,body);
          if(body.action==="commitImport")commits++;
        }else if(!u.searchParams.has("mode")) data=readPlayerAnalysis(ctx,Object.fromEntries(u.searchParams));
      }else if(u.pathname==="/api/view/player_sync")data={contests:[],busy:false,time:"",windows:true};
      await route.fulfill({json:data});
    });
    const anchor='<a href="/spmatch/gains/readInfo?lookeUserID=11&amp;spmatchSeq=88">甲</a>';
    const cells=["1",anchor,"5%","10万","1%","--","空仓","空仓","--"].map(v=>"<span>"+v+"</span>").join("");
    const matchPage='<meta charset="utf-8"><div class="header-user"><a href="/blog/10">账户</a></div>比赛时间：2025-01-01 至 2025-12-31 参赛人数：1'+
      '<div class="sin-user-sel-active">全部选手</div><div class="sin-match-new-upd">01-07更新</div><div id="pageNo">1</div><div id="pageSize">1</div>'+
      '<div class="sin-match-user-th">总排名 选手笔名 总收益 今资产 今收益 今存取 今交易 仓位 备注</div><div class="sin-match-user-tbody"><div class="sin-match-user-tr">'+cells+"</div></div>";
    await context.route(official+"/**",(route:any)=>route.fulfill({contentType:"text/html",body:route.request().url()===matchUrl?matchPage:
      '<div class="msgC_Right_title_act">参加的比赛</div><div class="container-match-list"><div class="match-top-state">进行中</div><a href="/spmatch/matchAll?tid=m">比赛</a><a href="/spmatch/gains/readInfo?lookeUserID=10&amp;spmatchSeq=88">战绩</a></div>'}));
    const app=await context.newPage();
    app.on("pageerror",(e:Error)=>console.error(e.message));
    await app.goto(origin+"player-analysis");
    await app.getByRole("textbox",{name:"比赛详情链接"}).fill(matchUrl);
    await app.getByText("用已登录的默认浏览器采集",{exact:true}).click();
    const download=app.waitForEvent("download");
    await app.getByRole("button",{name:"下载本场读取书签"}).first().click();
    const bookmark=fs.readFileSync(await (await download).path(),"utf8").match(/HREF="javascript:([^"]+)"/)![1];
    const tab=await context.newPage();
    await tab.goto(matchUrl);
    tab.on("dialog",(d:any)=>d.accept("2025-01-07"));
    await tab.evaluate(decodeURIComponent(bookmark));
    const popup=tab.waitForEvent("popup");
    await tab.getByRole("button",{name:"送回短线王"}).click();
    const receive=await popup;
    await receive.getByText("样例赛事 · 2025-01-07 · 1 名选手",{exact:true}).waitFor();
    assert.equal(commits,0);
    await receive.getByRole("button",{name:"保存并查看分析"}).click();
    await receive.waitForURL((u:URL)=>u.searchParams.get("date")==="2025-01-07"&&!u.hash);
    assert.equal(commits,1);
    const saved=readPlayerAnalysis(ctx,{matchId:"m",divisionId:"all",date:"2025-01-07"});
    assert.ok("analysis" in saved && saved.analysis);
  }finally{await browser.close();await server.close();fs.rmSync(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
