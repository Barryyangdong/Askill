import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright-core";
import { contestLink, heartbeat, reserveJob, releaseJob, syncStatus, syncAction, syncKey, recordContest, recordSyncFailure } from "../src/finance/player_sync.ts";
import { contestDates, identify, runWorker } from "../src/finance/player_sync_worker.ts";
import { checkContestReport, readPlayerAnalysis } from "../src/finance/player_analysis.ts";
import "../src/finance/register.ts";

const range="比赛时间：2025-01-01 至 2025-12-31";
test("首次连接失败只反馈给该次请求，旧失败记录不显示，已绑定比赛仍可恢复",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"askill-connect-feedback-"));
  const ctx={repoRoot:dir,dataRoot:dir,python:"",node:process.execPath};
  try{
    const token=reserveJob(ctx,"连接");
    const attempt=createHash("sha256").update(token).digest("hex");
    const db=new DatabaseSync(path.join(dir,"player-analysis","sync.sqlite"));
    try { db.prepare("INSERT INTO contests(id,message,paused) VALUES(?,?,1)").run("old","登录窗口已关闭"); }
    finally{db.close();}
    recordSyncFailure(ctx,"new",token,"登录窗口已关闭",true);
    releaseJob(ctx,token);
    assert.deepEqual(syncStatus(ctx).contests,[]);
    assert.equal(syncStatus(ctx).connectionError,null);
    assert.equal(syncStatus(ctx,"0".repeat(64)).connectionError,null);
    assert.equal(syncStatus(ctx,attempt).connectionError,"登录窗口已关闭");
    assert.equal(syncStatus(ctx).time,"");

    recordContest(ctx,"old","已连接",{userId:"10",name:"比赛",paused:false});
    const retry=reserveJob(ctx,"同步");
    recordSyncFailure(ctx,"old",token,"旧任务",true);
    assert.equal(syncStatus(ctx).contests[0].paused,0);
    recordSyncFailure(ctx,"old",retry,"请重新连接",true);
    releaseJob(ctx,retry);
    const [match]=syncStatus(ctx).contests;
    assert.equal(match.userId,"10");assert.equal(match.message,"请重新连接");assert.equal(match.paused,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("默认浏览器入口拒绝外部地址且不创建任务或账户状态",async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"askill-default-browser-"));
  const ctx={repoRoot:dir,dataRoot:dir,python:"",node:process.execPath};
  try{
    await assert.rejects(syncAction(ctx,{action:"openInBrowser",url:"https://example.org/spmatch/matchAll?tid=m"}),/比赛详情链接/);
    assert.deepEqual(fs.readdirSync(dir),[]);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("只接受官方赛事，按官网已显示的日期补采，互斥任务不互相释放",()=>{
  assert.throws(()=>contestLink("https://www.tgb.cn.example.com/spmatch/matchAll?tid=m"));
  assert.throws(()=>contestLink("https://www.tgb.cn/spmatch/matchAll?tid=m&tid=n"));
  assert.equal(contestLink("https://tgb.cn/spmatch/matchAll?tid=m"),"m");
  assert.deepEqual(contestDates(range,"01-07更新",["01-03","01-04","01-06"],"2025-01-03"),["2025-01-03","2025-01-06","2025-01-07"]);
  assert.deepEqual(contestDates(range,"01-07更新",["01-06"],""),["2025-01-07"]);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"askill-sync-lock-"));
  const ctx={repoRoot:dir,dataRoot:dir,python:"",node:process.execPath};
  try {
    assert.equal(syncStatus(ctx).busy,false);
    assert.deepEqual(fs.readdirSync(dir),[]);
    const token=reserveJob(ctx,"读榜");
    assert.throws(()=>reserveJob(ctx,"另一个任务"));
    releaseJob(ctx,"wrong");assert.equal(syncStatus(ctx).busy,true);
    heartbeat(ctx,token,"第二页");assert.equal(syncStatus(ctx).message,"第二页");
    releaseJob(ctx,token);assert.equal(syncStatus(ctx).busy,false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

const chrome=[process.env.CHROME_PATH,"C:/Program Files/Google/Chrome/Application/chrome.exe","/usr/bin/chromium","/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(p=>p && fs.existsSync(p));
test("人工验证失败时反馈页面查询编号；继续等待同一窗口正常登录",{skip:!chrome},async()=>{
  const browser=await chromium.launch({executablePath:chrome,headless:true,chromiumSandbox:true});
  try{
    const match="https://www.tgb.cn/spmatch/matchAll?tid=m",login="https://sso.tgb.cn/web/login/index";
    const context=await browser.newContext(),page=await context.newPage();
    let visits=0,seen="";
    await context.route("**/*",route=>{
      if(route.request().url()===match && ++visits===1)return route.fulfill({contentType:"text/html",body:'<script>setTimeout(()=>location.replace("https://sso.tgb.cn/web/login/index"),50)</script>'});
      const failed='<input value="private-fixture"><div>验证失败，请刷新</div><small>CertifyId: sample-42</small>';
      const logged='<div class="sin-match-user-th">总排名</div><div class="header-user"><a href="/blog/10">账号</a></div>';
      return route.fulfill({contentType:"text/html;charset=utf-8",body:route.request().url()===login?failed:logged});
    });
    const waiting=identify(context,"m",true,msg=>{if(msg.includes("验证失败"))seen=msg;});
    void waiting.catch(()=>{});
    await page.waitForURL(login);
    for(let i=0;i<30&&!seen;i++)await delay(100);
    assert.match(seen,/验证失败.*CertifyId：sample-42/);
    assert.ok(!seen.includes("private-fixture"));
    assert.equal(visits,1);
    await page.goto(match);
    assert.equal((await waiting).userId,"10");
  }finally{await browser.close();}
});
test("扫码落到官网首页后自动返回原比赛并打开选手列表",{skip:!chrome},async()=>{
  const browser=await chromium.launch({executablePath:chrome,headless:true,chromiumSandbox:true});
  try {
    const context=await browser.newContext();
    const page=await context.newPage();
    const home="https://www.tgb.cn/";
    const match=home+"spmatch/matchAll?tid=m";
    let visits=0;
    const header='<input type="hidden" id="userID" value="10"><div class="header-user"><span>我的账号</span></div>';
    await context.route("**/*",route=>{
      if(route.request().url()===match){
        visits++;
        if(visits===1)return route.fulfill({contentType:"text/html",body:'<script>setTimeout(()=>location.replace("https://www.tgb.cn/"),50)</script>'});
        return route.fulfill({contentType:"text/html;charset=utf-8",body:header+'<button onclick="document.querySelector(\'.sin-match-user-th\').hidden=false">选手列表</button><div class="sin-match-user-th" hidden>总排名</div>'});
      }
      return route.fulfill({contentType:"text/html",body:header});
    });
    const result=await identify(context,"m",true);
    assert.equal(result.userId,"10");
    assert.equal(result.page,page);
    assert.equal(page.url(),match);
    assert.equal(visits,2);
  } finally {await browser.close();}
});
test("官网再次将比赛带回首页时停止自动跳转",{skip:!chrome},async()=>{
  const browser=await chromium.launch({executablePath:chrome,headless:true,chromiumSandbox:true});
  try {
    const context=await browser.newContext(),page=await context.newPage();
    const home="https://www.tgb.cn/",match=home+"spmatch/matchAll?tid=m";
    let visits=0;
    await context.route("**/*",route=>{
      if(route.request().url()===match){
        visits++;
        return route.fulfill({contentType:"text/html",body:'<script>setTimeout(()=>location.replace("https://www.tgb.cn/"),50)</script>'});
      }
      return route.fulfill({contentType:"text/html",body:"Home"});
    });
    const waiting=assert.rejects(identify(context,"m",true),/窗口已关闭/);
    for(let i=0;i<50 && visits<2;i++)await delay(100);
    await page.waitForURL(home,{timeout:3000});
    await delay(1400);
    assert.equal(visits,2);
    await context.close();
    await waiting;
  } finally {await browser.close();}
});
test("Windows 以当前用户独立启动定时入口并可撤销",{skip:process.platform!=="win32"||process.env.ASKILL_TEST_TASK_SCHEDULER!=="1"},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"askill-scheduler-"));
  const ctx={repoRoot:path.resolve(fileURLToPath(new URL("../../",import.meta.url))),dataRoot:dir,python:"",node:process.execPath};
  const name="Askill-PlayerSync-"+syncKey(ctx);
  const ps=(command:string)=>execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",command],{encoding:"utf8",windowsHide:true,env:{...process.env,ASKILL_TEST_TASK:name}});
  try {
    recordContest(ctx,"fixture","fixture",{userId:"10",paused:false});
    await syncAction(ctx,{action:"schedule",time:"18:30"});
    recordContest(ctx,"fixture","fixture",{paused:true}); // The OS smoke test never opens a website.
    ps("$ErrorActionPreference='Stop'; Start-ScheduledTask -TaskName $env:ASKILL_TEST_TASK");
    let result="";
    for(let i=0;i<15;i++){
      await delay(800);
      result=ps("$info=Get-ScheduledTaskInfo -TaskName $env:ASKILL_TEST_TASK; if($info.LastRunTime -gt (Get-Date).AddMinutes(-2)){ $info.LastTaskResult }").trim();
      if(result==="0")break;
    }
    assert.equal(result,"0");
  } finally {
    await syncAction(ctx,{action:"schedule",time:""});
    assert.equal(ps("Get-ScheduledTask -TaskName $env:ASKILL_TEST_TASK -ErrorAction SilentlyContinue | Select-Object -ExpandProperty TaskName; exit 0").trim(),"");
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
});

test("首次连接在同一浏览器读取参赛卡和榜单并发布，重跑去重，失去资格保留已有版本",{skip:!chrome},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"askill-sync-browser-"));
  const ctx={repoRoot:dir,dataRoot:path.join(dir,"store"),python:"",node:process.execPath};
  const profile=path.join(dir,"browser");
  const options={executablePath:chrome,headless:true,chromiumSandbox:true};
  let browser=await chromium.launchPersistentContext(profile,options);
  let joined=true;
  const official="https://www.tgb.cn";
  const rows=["1",'<a href="/spmatch/gains/readInfo?lookeUserID=11&amp;spmatchSeq=88">甲</a>',"20%","10万","1%","--","空仓","空仓","--"];
  const html='<meta charset="utf-8"><div class="header-user"><a href="/blog/10">账户</a></div><p>'+range+'</p>参赛人数：1'+
    '<div class="sin-user-sel-active">全部选手</div><div class="sin-match-new-upd">01-07更新</div><div id="pageNo">1</div><div id="pageSize">1</div>'+
    '<div class="sin-match-user-th">总排名 选手笔名 总收益 今资产 今收益 今存取 今交易 仓位 备注</div>'+
    '<div class="sin-match-user-tbody"><div class="sin-match-user-tr">'+rows.map(v=>"<span>"+v+"</span>").join("")+"</div></div>";
  const openFixture=async()=>{
    browser=await chromium.launchPersistentContext(profile,options);
    await browser.route("**/*",async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==official) return route.abort();
      if(url.pathname==="/spmatch/matchAll") return route.fulfill({contentType:"text/html",body:route.request().headers().cookie?.includes("fixture=present")?html:"请登录"});
      if(url.pathname!=="/user/blog/myspmath" || url.searchParams.get("userID")!=="10")return route.abort();
      const heading='<div class="msgC_Right_title_act">参加的比赛</div>';
      const card='<div class="container-match-list"><div class="match-top-state left">进行中</div><div class="match-top-name left">测试赛</div><a href="/spmatch/matchAll?tid=m">测试赛</a><a href="/spmatch/gains/readInfo?lookeUserID=10&amp;spmatchSeq=88">战绩</a></div>';
      return route.fulfill({contentType:"text/html",body:heading+(joined?card:"")});
    });
    return browser;
  };
  try {
    await browser.addCookies([{name:"fixture",value:"present",url:official,expires:Date.now()/1000+3600}]);
    await browser.close();
    const run=(action:string)=>runWorker(ctx,action,"m",reserveJob(ctx,"采集"),undefined,undefined,openFixture);
    joined=false;
    await run("connect");
    const visible=await syncAction(ctx,{action:"visibleResult",url:official+"/spmatch/matchAll?tid=m",day:"2025-01-07"});
    assert.equal(visible.access,"visible");
    assert.equal(visible.players.length,1);
    assert.equal(syncStatus(ctx).contests.length,0);
    joined=true;
    await run("connect");
    assert.equal(syncStatus(ctx).contests[0]?.lastDate,"2025-01-07");
    assert.equal(syncStatus(ctx).contests[0]?.userId,"10");
    await run("sync");
    assert.match(String(syncStatus(ctx).contests[0]?.message),/1 名选手/);
    joined=false;await run("sync");
    assert.equal(syncStatus(ctx).contests[0]?.paused,1);
    const day=readPlayerAnalysis(ctx,{matchId:"m",divisionId:"all",date:"2025-01-07"});
    assert.ok("versions" in day);
    assert.equal(day.versions?.length,1);
    const report={expectedUserId:"10",divisionId:"all",date:"2025-01-07",revision:1,playerId:"11"};
    assert.deepEqual(checkContestReport(ctx,"m",report),["11","2025-01-07"]);
    assert.throws(()=>checkContestReport(ctx,"m",{...report,playerId:"12"}),/未找到/);
    assert.throws(()=>checkContestReport(ctx,"m",{...report,date:"2025-01-06"}),/未找到/);
  } finally {await browser.close();fs.rmSync(dir,{recursive:true,force:true,maxRetries:6,retryDelay:200});}
});
