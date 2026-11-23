import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { safePath, serviceContext, type ServiceContext } from "../service.ts";
import { bindPlayerProfile, publishContestDay } from "./player_analysis.ts";
import { parsePlayerMembership } from "./player_membership.ts";
import { contestPageScript } from "./contest_page_script.ts";
import { heartbeat, recordContest, recordSyncFailure, releaseJob, reserveJob, saveVisibleDay, syncKey, syncStatus } from "./player_sync.ts";

const official="https://www.tgb.cn";
const matchUrl=(id:string)=>official+"/spmatch/matchAll?tid="+encodeURIComponent(id);
const readerSource=fs.readFileSync(new URL("./readContestDay.js",import.meta.url),"utf8");
const viewerScript=contestPageScript(readerSource.split("export async function readContestDay")[0],"contestViewerId")+"()";
class LoginNeeded extends Error {}
function browserExecutable() {
  const roots=[process.env.ProgramFiles,process.env["ProgramFiles(x86)"],process.env.LOCALAPPDATA].filter((x):x is string=>!!x);
  const names=process.platform==="win32"?roots.flatMap(root=>["Microsoft/Edge/Application/msedge.exe","Google/Chrome/Application/chrome.exe"].map(file=>path.join(root,file))):
    process.platform==="darwin"?["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome","/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]:
    ["/usr/bin/google-chrome","/usr/bin/microsoft-edge","/usr/bin/chromium","/usr/bin/chromium-browser"];
  const found=names.find(file=>fs.existsSync(file));
  if(!found) throw new Error("本机未找到 Edge 或 Chrome，请先安装浏览器。");
  return found;
}
async function launch(ctx:ServiceContext,interactive:boolean) {
  const base=process.platform==="win32"?process.env.LOCALAPPDATA:process.platform==="darwin"?path.join(os.homedir(),"Library/Application Support"):process.env.XDG_DATA_HOME;
  const profile=path.join(base||path.join(os.homedir(),".local/share"),"Askill","contest-browser",syncKey(ctx));
  const executablePath=browserExecutable();
  fs.mkdirSync(profile,{recursive:true,mode:0o700});
  return chromium.launchPersistentContext(profile,{executablePath,headless:!interactive,chromiumSandbox:true,acceptDownloads:false,
    ...(interactive ? {viewport:null} : {}),
    timeout:30000,args:["--disable-sync","--disable-session-crashed-bubble"]}).catch(()=>{throw new Error("比赛专用浏览器启动失败，请关闭仍打开的比赛专用窗口后重试。");});
}

// One local troubleshooting run. Log only coarse navigation, transport results and window geometry.
function observeLogin(ctx:ServiceContext,browser:BrowserContext) {
  let log:string;
  try {
    const flag=safePath(ctx,"player-analysis","observe-next-login");
    if(!fs.existsSync(flag))return ()=>{};
    fs.unlinkSync(flag);
    log=safePath(ctx,"player-analysis","login-diagnostic.jsonl");
    fs.writeFileSync(log,"",{mode:0o600});
  } catch {return ()=>{};}
  let count=0,stopped=false,sampling=false;
  const emit=(event:string,value:string)=>{
    if(!stopped && count++<1000)try {fs.appendFileSync(log,JSON.stringify({at:new Date().toISOString(),event,value})+"\n");} catch { /* Diagnostics must not interrupt login. */ }
  };
  const area=(raw:string)=>{
    if(!URL.canParse(raw))return "其他";
    const url=new URL(raw);
    if(url.hostname==="sso.tgb.cn")return "官网登录";
    if(url.hostname==="www.tgb.cn" && url.pathname==="/spmatch/matchAll")return "比赛榜单";
    return /(^|\.)tgb\.cn$/.test(url.hostname)?"官网":"其他";
  };
  const watch=(page:Page)=>{page.on("framenavigated",frame=>{if(frame===page.mainFrame())emit("页面",area(frame.url()));});};
  browser.pages().forEach(watch);
  browser.on("page",watch);
  browser.on("response",res=>{
    if(res.status()>=400 || ["xhr","fetch"].includes(res.request().resourceType()))
      emit("HTTP",area(res.url())+" "+res.status());
  });
  browser.on("requestfailed",r=>emit("网络",area(r.url())+" "+(r.failure()?.errorText.match(/net::ERR_[A-Z_]+/)?.[0]??"失败")));
  let last="";
  const timer=setInterval(async()=>{
    if(sampling)return;
    sampling=true;
    try{
      const page=browser.pages().at(-1);
      if(!page)return;
      const size=await page.evaluate(()=>[outerWidth,outerHeight,innerWidth,innerHeight]);
      let notice="";
      for(const frame of page.frames()){
        if(await frame.getByText(/^(?:滑动|安全)?验证失败(?:[，,、。\s].*)?$/).last().isVisible()){
          notice=" · 显示验证失败";break;
        }
        if(await frame.getByText(/登录失败[，,、。\s]*请刷新/).last().isVisible())notice=" · 显示登录失败";
      }
      const value=area(page.url())+" "+size.join(" / ")+notice;
      if(value!==last){emit("窗口与页面",value);last=value;}
    }catch{ /* A redirect can replace the document while it is being sampled. */ }
    finally{sampling=false;}
  },1000);
  emit("观察","开始");
  return ()=>{clearInterval(timer);emit("观察","结束");stopped=true;};
}
function onContest(page:Page,id:string) {
  const url=new URL(page.url());
  return url.origin===official && url.pathname==="/spmatch/matchAll" && url.searchParams.get("tid")===id;
}
const verificationFailure=/^(?:滑动|安全)?验证失败\s*[，,、。]?\s*请刷新[。！!]?$/;
const certifyLabel=/^CertifyId\s*[:：]\s*([a-z\d_-]{1,80})$/i;
async function visibleLoginFailure(tab:Page) {
  const url=new URL(tab.url());
  if(url.origin!=="https://sso.tgb.cn" || !url.pathname.startsWith("/web/login/"))return "";
  // Only inspect the two user-visible labels. Never read inputs, QR images or challenge traffic.
  for(const frame of tab.frames()){
    const failure=frame.getByText(verificationFailure).filter({visible:true}).first();
    if(!await failure.isVisible().catch(()=>false))continue;
    const labels=await frame.getByText(certifyLabel).filter({visible:true}).allTextContents().catch(()=>[]);
    const ref=labels.map(t=>certifyLabel.exec(t.trim())?.[1]).find(Boolean);
    return "官网安全验证显示「验证失败，请刷新」。"+(ref?"本次查询编号 CertifyId："+ref+"。":"");
  }
  return "";
}
export async function identify(browser:BrowserContext,id:string,interactive:boolean,onProgress?:(message:string)=>void,allowVisible=false) {
  const page=browser.pages().find(tab=>tab.url()==="about:blank")??await browser.newPage();
  await page.goto(matchUrl(id),{waitUntil:"domcontentloaded",timeout:45000});
  const until=Date.now()+(interactive?8*60_000:12000);
  let lastIssue="",lastProgress="",returnedToContest=false;
  let timeoutMessage="等待已登录的比赛榜单超时。";
  const openedLists=new Set<Page>();
  const progress=(message:string)=>{
    if(message!==lastProgress){lastProgress=message;onProgress?.(message);}
  };
  while(Date.now()<until) {
    if(!browser.pages().length) throw new LoginNeeded("登录窗口已关闭，请重新连接比赛。"+(lastIssue?"此前"+lastIssue:""));
    for(const tab of browser.pages()){
      // Leave authentication to the user. Resume only from the official homepage.
      if(interactive){
        const issue=await visibleLoginFailure(tab);
        if(issue){lastIssue=issue;progress(issue+"正在等待已登录的比赛榜单。");}
        const url=new URL(tab.url());
        if(url.origin==="https://sso.tgb.cn")timeoutMessage="等待官网登录并返回比赛榜单超时。";
        if(!returnedToContest && url.origin===official && /^\/(?:index(?:\.html?)?\/?)?$/.test(url.pathname)){
          returnedToContest=true;
          progress("已到官网首页，正在返回本次填写的比赛。");
          await tab.goto(matchUrl(id),{waitUntil:"domcontentloaded",timeout:45000});
          continue;
        }
      }
      if(!onContest(tab,id))continue;
      if(!await tab.locator(".sin-match-user-th:visible").first().isVisible().catch(()=>false)){
        timeoutMessage="已打开比赛，但未能识别可见的选手榜单。";
        progress("已打开本场比赛，正在等待选手列表。");
        const list=tab.getByText("选手列表",{exact:true}).filter({visible:true});
        if(!openedLists.has(tab) && await list.count()===1){
          await list.click({timeout:3000});
          openedLists.add(tab);
        }
        continue;
      }
      timeoutMessage="已看到比赛榜单，但未能从页首识别当前官网账号。";
      progress("已看到本场选手榜单，正在识别当前官网账号。");
      const userId=await tab.evaluate<string>(viewerScript).catch(()=>"");
      if((userId || allowVisible) && onContest(tab,id))return {page:tab,userId};
    }
    await delay(650);
  }
  throw new LoginNeeded(timeoutMessage+(lastIssue?"此前"+lastIssue:""));
}
// Use the contest's own published date labels. A weekend or an unpublished date cannot create a snapshot.
export function contestDates(text:string,update:string,labels:string[],lastDate:string) {
  const range=text.match(/比赛时间\s*[：:]\s*(\d{4}-\d\d-\d\d)[\s\S]{0,30}?至\s*(\d{4}-\d\d-\d\d)/);
  if(!range || range[1].slice(0,4)!==range[2].slice(0,4)) throw new Error("无法确认比赛所在年份。");
  const today=new Date(Date.now()+8*3600_000).toISOString().slice(0,10);
  const current=update.match(/(\d\d-\d\d)更新/)?.[1];
  const dates=[...new Set([...labels,...(current?[current]:[])].filter(md=>/^\d\d-\d\d$/.test(md)).map(md=>range[1].slice(0,5)+md))]
    .filter(d=>{const day=new Date(d+"T00:00:00Z");return d>=range[1] && d<=range[2] && d<=today && Number.isFinite(+day) &&
      day.toISOString().startsWith(d) && ![0,6].includes(day.getUTCDay());}).sort();
  if(!dates.length) throw new Error("官网尚无可确认的交易日榜单。");
  const latest=dates[dates.length-1];
  if(lastDate && latest<lastDate) throw new Error("官网可见榜单早于本地最新快照，请稍后重试。");
  return lastDate?dates.filter(d=>d>=lastDate):dates.slice(-1);
}
export async function readDays(ctx:ServiceContext,page:Page,id:string,userId:string,match:{name:string;spmatchSeq?:string;visibleOnly?:boolean},progress:(m:string)=>void) {
  await page.locator(".sin-match-new-upd:visible").first().waitFor({timeout:18000}).catch(()=>{throw new Error("已看到榜单，未找到官网的更新日期。");});
  const text=await page.locator("body").innerText();
  const labels=await page.getByText(/^\d\d-\d\d$/).allTextContents();
  const prior=syncStatus(ctx).contests.find(c=>c.id===id);
  const dates=contestDates(text,await page.locator(".sin-match-new-upd:visible").first().innerText(),labels,match.visibleOnly?"":String(prior?.lastDate??""));
  const source=contestPageScript(readerSource,"readContestDay");
  for(const date of dates){
    if(!onContest(page,id)) throw new LoginNeeded("比赛页面已离开，请重新连接官网。");
    if(dates.indexOf(date)>0) await page.goto(matchUrl(id),{waitUntil:"domcontentloaded"});
    const updated=page.locator(".sin-match-new-upd:visible").first();
    if(!(await updated.innerText()).includes(date.slice(5)+"更新")){
      const chip=page.getByText(date.slice(5),{exact:true}).filter({visible:true});
      if(await chip.count()!==1) throw new Error("官网未提供可确认的 "+date+" 日期入口。");
      await chip.click();
      await page.locator(".sin-match-new-upd:visible").filter({hasText:date.slice(5)+"更新"}).first().waitFor({timeout:18000});
    }
    progress("正在读取 "+match.name+" · "+date);
    const scope={date,userId,matchId:id,seq:match.spmatchSeq,matchName:match.name,access:match.visibleOnly?"visible":"enrolled"};
    const data=await page.evaluate<Record<string,unknown>|null>("("+source+")("+JSON.stringify(scope)+")");
    if(!data || data.matchId!==id || data.date!==date || data.divisionId!=="all" ||
        data.sourceUserId!==userId || data.sourceMatchSeq!==match.spmatchSeq || !onContest(page,id))
      throw new Error("返回榜单与本次账号、比赛或日期不符，已停止入库。");
    if(match.visibleOnly){
      saveVisibleDay(ctx,id,date,data);
      continue;
    }
    // Full tournaments can outlast the ten-minute membership cache.
    await verify(ctx,page,userId,id);
    const result=publishContestDay(ctx,userId,data);
    recordContest(ctx,id,date+" 已同步 · "+result.playerCount+" 名选手 · 版本 "+result.revision,{date});
  }
}
async function verify(ctx:ServiceContext,page:Page,userId:string,id:string,allowVisible=false):Promise<{name:string;spmatchSeq?:string;visibleOnly?:boolean}> {
  if(!onContest(page,id)) throw new LoginNeeded("请在登录后的本场比赛榜单核验报名。");
  const matches=userId?await page.evaluate(async(userId)=>{
    if(location.origin!=="https://www.tgb.cn")throw new Error("已离开淘股吧比赛页。");
    const response=await fetch("/user/blog/myspmath?userID="+encodeURIComponent(userId),{
      credentials:"omit",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(25000)
    });
    if(!response.ok)throw new Error("官网参赛记录暂时无法读取。");
    return response.text();
  },userId).then(html=>parsePlayerMembership(html,userId)).catch(error=>{if(allowVisible)return [];throw error;}):[];
  const result={userId,checkedAt:new Date().toISOString(),matches};
  const match=result.matches.find(m=>m.matchId===id && m.spmatchSeq);
  if(!match && allowVisible){
    return {name:"比赛 "+id,visibleOnly:true};
  }
  if(!match) throw new LoginNeeded("当前登录账号未核验到该场有效报名，请确认官网账号和比赛链接。");
  await bindPlayerProfile(ctx,userId,AbortSignal.timeout(10000),async()=>result);
  return match;
}
function safeMessage(error:unknown) {
  const msg=error instanceof Error?error.message:"";
  // Browser stack traces, command lines, URLs and page text do not belong in the task log.
  return msg.split("\n")[0].replace(/^page\.evaluate: (Error: )?/,"").match(/^[\u3400-\u9fff「][^<>\r\n]{0,170}$/)?.[0]??"官网页面未能完成读取，请检查网络、登录状态和官网榜单后重试。";
}
export async function runWorker(ctx:ServiceContext,action:string,id:string,token:string,playerId?:string,reportDate?:string,openBrowser=launch) {
  const scheduled=action==="scheduled";
  if(scheduled){
    if(!syncStatus(ctx).time) return;
    token=reserveJob(ctx,"开始盘后同步");
  }
  let message=action==="connect"?"正在打开比赛。若官网要求登录，可用参赛账号扫码，完成后将自动返回本场比赛。":"正在打开比赛榜单";
  heartbeat(ctx,token,message);
  let browser:BrowserContext|undefined;
  const timer=setInterval(()=>{try {heartbeat(ctx,token,message);} catch {void browser?.close();}},5000);
  try {
    const entries=scheduled?syncStatus(ctx).contests.filter(c=>c.userId && !c.paused).map(c=>String(c.id)):[id];
    for(const contest of entries){
      try {
        const interactive=action==="connect" || action==="report";
        browser=await openBrowser(ctx,interactive);
        const stop=action==="connect"?observeLogin(ctx,browser):()=>{};
        const progress=(m:string)=>{message=m;heartbeat(ctx,token,m);};
        const prior=syncStatus(ctx).contests.find(c=>c.id===contest);
        const allowVisible=action==="connect" && !prior?.userId;
        const {page,userId}=await identify(browser,contest,interactive,progress,allowVisible).finally(stop);
        if(prior?.userId && prior.userId!==userId) throw new LoginNeeded("当前官网账号与该场已绑定账号不同，请切换回原参赛账号。");
        progress(userId?"已识别官网账号和选手榜单，正在核验本场报名。":"已看到本场选手榜单，准备读取页面可见数据。");
        const match=await verify(ctx,page,userId,contest,allowVisible);
        if(action==="report" && playerId && reportDate && match.spmatchSeq){
          message="正在官网查看报单，查看完毕后请关闭比赛窗口。";
          const params=new URLSearchParams({lookeUserID:playerId,spmatchSeq:match.spmatchSeq,dateNum:reportDate.replaceAll("-","")});
          await page.goto(official+"/spmatch/gains/readInfo?"+params,{waitUntil:"domcontentloaded"});
          await browser.waitForEvent("close",{timeout:10*60_000}).catch(()=>{});
        } else {
          if(match.visibleOnly)progress("正在采集当前窗口可见的榜单。");
          else if(action==="connect") recordContest(ctx,contest,"已核验报名，正在读取比赛榜单。",{userId,name:match.name,paused:false});
          const poll=setInterval(()=>{void page.locator("#askill-player-capture span").textContent({timeout:700}).then(t=>{if(t)message=match.name+" · "+t;}).catch(()=>{});},6000);
          const deadline=setTimeout(()=>{void browser?.close();},90*60_000);
          try {await readDays(ctx,page,contest,userId,match,progress);}
          finally {clearTimeout(deadline);clearInterval(poll);}
        }
      } catch(e){recordSyncFailure(ctx,contest,token,safeMessage(e),e instanceof LoginNeeded);}
      finally {await browser?.close().catch(()=>{});browser=undefined;}
    }
  } finally {clearInterval(timer);releaseJob(ctx,token);}
}
if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const [, ,action,dataRoot,repoRoot,id,token,playerId,reportDate]=process.argv;
  if(["scheduled","sync","connect","report"].includes(action) && path.isAbsolute(dataRoot) && path.isAbsolute(repoRoot)){
    const ctx=serviceContext({repoRoot,env:{...process.env,VRA_DATA_ROOT:dataRoot}});
    runWorker(ctx,action,id,token,playerId,reportDate).catch(()=>{process.exitCode=1;});
  } else process.exitCode=2;
}
