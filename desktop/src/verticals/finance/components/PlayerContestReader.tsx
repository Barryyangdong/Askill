import source from '../../../../../orchestrator/src/finance/readContestDay.js?raw';
import { contestPageScript } from '../../../../../orchestrator/src/finance/contest_page_script';
import type { EnrolledMatch } from '../lib/playerEnrollment';
import { playerControl } from '../lib/playerAnalysis';

export function PlayerContestReader({match,userId,title="从官网读取全场榜单"}:{match:EnrolledMatch;userId:string;title?:string}) {
  if (!match.spmatchSeq) return null;
  function download() {
    const scope={matchId:match.matchId,matchName:match.name,seq:match.spmatchSeq,userId,workbenchOrigin:window.location.origin};
    const reader=contestPageScript(source,"readContestDay");
    const code='void ('+reader+')('+JSON.stringify(scope)+').catch(error=>alert(error.message))';
    const bookmark='javascript:'+encodeURIComponent(code);
    // The Netscape bookmark import format is supported by Chrome and Edge.
    const file='<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">'+
      '\n<TITLE>短线王比赛工具</TITLE>\n<H1>短线王比赛工具</H1>\n<DL><p><DT><A HREF="'+bookmark+
      '">短线王 · 读取本场榜单</A></DL><p>';
    const url=URL.createObjectURL(new Blob([file],{type:'text/html;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='短线王-比赛读取书签.html';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  return <details className="my-3 rounded-md border border-border p-3 text-sm">
    <summary className="cursor-pointer font-medium">{title}</summary>
    <ol className="my-2 list-decimal space-y-1 pl-5 text-xs leading-5 text-muted-foreground">
      <li>首次使用时下载本场书签，在 Chrome 或 Edge 的书签管理器中导入。</li>
      <li>在同一浏览器用本人已报名的账号登录淘股吧。打开本场官网榜单，选择交易日和「全部选手」，回到第一页，点击「短线王 · 读取本场榜单」。登录过期时请在官网重新登录。</li>
      <li>核对日期后保持页面打开。读取器会翻页采集，完成后点「送回短线王」，在本机工作台核对人数和日期并保存。也可保存 JSON。</li>
    </ol>
    <button type="button" className={playerControl} onClick={download}>下载本场读取书签</button>
  </details>;
}
