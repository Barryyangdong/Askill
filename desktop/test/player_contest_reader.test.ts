import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readContestDay,contestViewerId} from '../src/verticals/finance/lib/readContestDay.js';

const chrome=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>p && existsSync(p));

test('普通浏览器读取两页可见榜单，校验报名、组别、遮挡及持仓/卖出分表', {skip:!chrome},()=>{
  const dir=mkdtempSync(join(tmpdir(),'askill-contest-test-'));
  try {
    const official='https://www.tgb.cn';
    const scope={userId:'10',matchId:'m',matchName:'样例赛事',seq:'88'};
    const url=official+'/spmatch/matchAll?tid=m';
    const row=(id:number,rank:number,trade:string,exposure:string)=>'<div class="sin-match-user-tr">'+
      [rank,'<a href="'+official+'/spmatch/gains/readInfo?lookeUserID='+id+'&amp;spmatchSeq=88&amp;dateNum=20261122">甲</a>',
      '30%','57万','1%','--',trade,exposure,'--'].map(x=>'<span>'+x+'</span>').join('')+'</div>';
    const stock=(title:string,code:string)=>'<table><tr><td>'+title+'</td><td>股票名称</td><td>当日涨幅</td><td>操作</td><td>数量</td><td>持仓金额</td></tr>'+
      '<tr><td></td><td><a href="'+official+'/spmatch/gains/readStockInfo?fullCode='+code+'&amp;spmatchSeq=88&amp;lookeuserID=11&amp;dateNum=20261111">证券</a></td><td>1%</td><td>买入</td><td>100</td><td>5万元</td></tr></table>';
    const secondPage=row(12,2,'2支 解锁','40%')+row(13,3,'空仓','100%');
    const html='<meta charset="utf-8"><style>.sin-match-user-th span,.sin-match-user-tr>span{display:block}</style>'+
      '<div class="header-user"><a href="'+official+'/blog/10">账户</a></div><p>比赛时间：2026-01-05 15:00:00 至 2026-12-31 23:59:00</p>'+
      '<div>参赛人数：3</div><span class="sin-user-sel-active">全部选手</span><span class="sin-match-new-upd">（11-11更新）</span>'+
      '<span id="pageNo">1</span>/<span id="pageSize">2</span><div class="sin-match-user-th">'+
      '总排名 选手笔名 总收益 今资产 今收益 今存取 今交易 仓位 备注'.split(' ').map(x=>'<span>'+x+'</span>').join('')+'</div>'+
      '<div class="sin-match-user-tbody">'+row(11,1,'2支 <b id="open">展开</b>','141%')+
      '<div class="sin-match-expand" hidden>'+stock('持仓','sh600000')+stock('卖出','sz000001')+'</div></div>'+
      '<div class="sin-match-page-bottom"><span>下一页</span></div><output id="result"></output>';
    const card='<div class="msgC_Right_title_act">参加的比赛</div><div class="container-match-list"><span class="match-top-state">进行中</span><a href="/spmatch/matchAll?tid=m">样例</a>'+
      '<a href="/spmatch/gains/readInfo?lookeUserID=10&amp;spmatchSeq=88">战绩</a></div>';
    // All navigation, public membership and downloads are replaced inside an isolated local fixture.
    const script=`(async()=>{const location={href:${JSON.stringify(url)}},prompt=()=>'2026-11-11';
      let joined=false, facts;
      const fetch=async()=>({ok:true,text:async()=>joined?${JSON.stringify(card)}:''});
      URL.createObjectURL=blob=>{facts=blob.text();return 'blob:fixture'};
      HTMLAnchorElement.prototype.click=function(){};
      document.querySelector('#open').onclick=()=>{document.querySelector('.sin-match-expand').hidden=false;document.querySelector('#open').textContent='收起'};
      document.querySelector('.sin-match-page-bottom span').onclick=()=>{document.querySelector('#pageNo').textContent='2';document.querySelector('.sin-match-user-tbody').innerHTML=${JSON.stringify(secondPage)}};
      const contestViewerId=${contestViewerId.toString()}, run=${readContestDay.toString()}, scope=${JSON.stringify(scope)};
      let denied=false;try{await run(scope)}catch(e){denied=e.message.includes('未确认')}
      joined=true;await run(scope);const data=JSON.parse(await facts);
      document.querySelector('#result').textContent=JSON.stringify({denied,data});
    })().catch(e=>document.querySelector('#result').textContent=e.message)`;
    const file=join(dir,'index.html');writeFileSync(file,html+'<script>'+script+'</script>');
    const dump=execFileSync(chrome!,['--headless','--disable-gpu','--disable-background-networking',
      '--disable-extensions','--no-first-run','--user-data-dir='+join(dir,'profile'),'--virtual-time-budget=5000',
      '--dump-dom',pathToFileURL(file).href],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:45000});
    const result=/<output id="result">([^<]*)<\/output>/.exec(dump)?.[1]||'';
    assert.ok(result.startsWith('{'),result||'缺少读取结果');
    const {denied,data}=JSON.parse(result);
    assert.equal(denied,true);assert.equal(data.rankComplete,true);assert.equal(data.date,'2026-11-11');
    assert.equal(data.sourceUserId,'10');assert.equal(data.players.length,3);
    assert.deepEqual(data.players[0].symbols,['600000']);assert.equal(data.players[0].exposure,1.41);
    assert.equal(data.players[0].state,'published');assert.equal(data.players[1].holdingsState,'partial');
    assert.equal(data.players[2].holdingsState,'unknown');
  } finally { rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
});
