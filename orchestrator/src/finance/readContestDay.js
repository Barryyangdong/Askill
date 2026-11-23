// Resolve the viewer only inside the site's account header. Contest rows link to other people.
export function contestViewerId() {
  const ids = new Set();
  for (const header of document.querySelectorAll('.header-user')) {
    if (!header.checkVisibility({checkVisibilityCSS:true}) || header.querySelector('[onclick*="loginPanel"]')?.checkVisibility({checkVisibilityCSS:true})) continue;
    const marker = header.previousElementSibling;
    if (marker?.matches('input#userID')) {
      if (!/^[1-9]\d{0,15}$/.test(marker.value)) return '';
      ids.add(marker.value);
    }
    for (const a of header.querySelectorAll('a[href]')) {
      if (!a.checkVisibility({checkVisibilityCSS:true})) continue;
      const url = new URL(a.getAttribute('href'),'https://www.tgb.cn');
      const match = url.origin==='https://www.tgb.cn' && /^\/blog\/([1-9]\d{0,15})\/?$/.exec(url.pathname);
      if (match) ids.add(match[1]);
    }
  }
  return ids.size===1 ? [...ids][0] : '';
}

// This function also runs as a bookmark in the user's official contest tab.
export async function readContestDay(scope) {
  const fail = message => { throw new Error(message); };
  const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
  const visible = el => el && el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
  const text = el => visible(el) ? el.innerText.trim() : '';
  const official = 'https://www.tgb.cn';
  const url = new URL(location.href);
  if (url.origin !== official || url.pathname !== '/spmatch/matchAll' || url.searchParams.get('tid') !== scope.matchId)
    fail('请在本场淘股吧官网的选手列表运行。');
  const visibleOnly = scope.access === 'visible' && Boolean(scope.date) && !scope.workbenchOrigin;
  const account = () => (contestViewerId() || '') === (scope.userId || '') && (visibleOnly || Boolean(scope.userId));
  if (!account()) fail('请使用短线王已核验的本人参赛账号登录淘股吧。');
  if (document.getElementById('askill-player-capture')) fail('当前页面已有读取任务。');
  const group = () => text(document.querySelector('.sin-user-sel-active'));
  const update = () => text(document.querySelector('.sin-match-new-upd'));
  const num = id => Number(text(document.getElementById(id)));
  if (group() !== '全部选手' || num('pageNo') !== 1) fail('请选择全部选手，回到累计总榜第一页。');
  const range = document.body.innerText.match(/比赛时间\s*[：:]\s*(\d{4}-\d\d-\d\d)[\s\S]{0,30}?至\s*(\d{4}-\d\d-\d\d)/);
  const selectedDay=update().match(/(\d\d-\d\d)更新/)?.[1];
  const visibleDate=scope.workbenchOrigin && range && selectedDay && range[1].slice(0,4)===range[2].slice(0,4)
    ? range[1].slice(0,5)+selectedDay : null;
  const date = scope.date ?? visibleDate ?? prompt('请输入官网已选交易日（YYYY-MM-DD），须与榜单的更新日期一致。');
  if (date === null) return;
  const day = new Date(date+'T00:00:00Z');
  if (!/^\d{4}-\d\d-\d\d$/.test(date) || !Number.isFinite(+day) || day.toISOString().slice(0,10)!==date ||
      [0,6].includes(day.getUTCDay()) || !update().includes(date.slice(5)+'更新')) fail('请选择交易日，并核对官网榜单的更新日期。');
  if (!range || date < range[1] || date > range[2] || range[1].slice(0,4)!==range[2].slice(0,4))
    fail('无法从该场比赛起止日期确认交易年份。');
  if (!visibleOnly) {
    // Recheck the active card on every run. Never request private report APIs.
    const response = await fetch(official+'/user/blog/myspmath?userID='+scope.userId,{credentials:'omit',redirect:'error',cache:'no-store'});
    if (!response.ok) fail('暂时无法核对官网在赛记录。');
    const template=document.createElement('template');
    template.innerHTML=await response.text();
    const cards=[...template.content.querySelectorAll('.container-match-list')];
    const section=[...template.content.querySelectorAll('.msgC_Right_title_act')].find(el=>el.textContent.trim().startsWith('参加的比赛'));
    const enrolled=cards.some(card=>{
      if (!section || !(section.compareDocumentPosition(card)&Node.DOCUMENT_POSITION_FOLLOWING)) return false;
      card.querySelector('.container-match-bottom')?.remove();
      const top=card.querySelector('.match-top-state');
      const links=[...card.querySelectorAll('a[href]')].map(a=>new URL(a.getAttribute('href'),official));
      return top?.textContent.trim()==='进行中' && !/已退赛|取消资格|已被移除/.test(card.textContent) &&
        links.some(a=>a.origin===official && a.pathname==='/spmatch/matchAll' && a.searchParams.get('tid')===scope.matchId) &&
        links.some(a=>a.origin===official && a.pathname==='/spmatch/gains/readInfo' && a.searchParams.get('lookeUserID')===scope.userId && a.searchParams.get('spmatchSeq')===scope.seq);
    });
    if (!enrolled) fail('官网未确认当前账号正在参加这场比赛。');
  }
  const pages=num('pageSize');
  if (!Number.isInteger(pages) || pages<1 || pages>200) fail('未识别榜单页数。');
  const controls=document.createElement('div');
  controls.id='askill-player-capture';
  controls.style.cssText='position:fixed;bottom:18px;right:18px;z-index:2147483647;background:#182536;color:white;padding:14px;border-radius:8px;font:14px sans-serif';
  const progress=document.createElement('span'), cancel=document.createElement('button');
  cancel.textContent='停止读取';cancel.style.marginLeft='12px';
  let stopped=false;cancel.onclick=()=>{stopped=true;};
  controls.append(progress,cancel);document.body.append(controls);
  const players=new Map();
  function context() {
    if (stopped || !account() || location.href!==url.href || group()!=='全部选手' || !update().includes(date.slice(5)+'更新') || num('pageSize')!==pages)
      fail('读取已停止，未生成快照。请核对账号、赛组和日期。');
  }
  async function until(check) {
    for (let i=0;i<60;i++) { context(); const result=check(); if(result)return result; await pause(200); }
    fail('官网加载超时，未生成不完整的快照。');
  }
  const rows=()=>[...document.querySelectorAll('.sin-match-user-tbody > .sin-match-user-tr')].filter(visible);
  const percent=t=>/^[+-]?(?:\d+(?:,\d{3})*)(?:\.\d+)?%$/.test(t) ? Number(t.replace(/[% ,]/g,''))/100 : null;
  const headers=['总排名','选手笔名','总收益','今资产','今收益','今存取','今交易','仓位','备注'];
  function currentHoldings(block,id,seq) {
    const table=[...block.querySelectorAll('table')].filter(visible).find(t=>text(t.rows[0]?.cells[0])==='持仓');
    if (!table) return {holdingsState:'unknown',symbols:[]};
    const symbols=new Set(); let incomplete=false;
    for (const tr of [...table.rows].slice(1).filter(visible)) {
      const a=tr.cells[1]?.querySelector('a[href]'), quantity=text(tr.cells[4]);
      if (!visible(a) || !/^\d+(?:\.\d+)?$/.test(quantity) || Number(quantity)<=0) { incomplete=true;continue; }
      const link=new URL(a.href);
      if (link.origin!==official || link.pathname!=='/spmatch/gains/readStockInfo' ||
          !seq || link.searchParams.get('spmatchSeq')!==seq || link.searchParams.get('lookeuserID')!==id ||
          link.searchParams.get('dateNum')!==date.replaceAll('-','')) fail('持仓链接的赛事、选手或交易日与当前行不符。');
      const code=/^(?:sh|sz|bj)(\d{6})$/i.exec(link.searchParams.get('fullCode')||'');
      if (code) symbols.add(code[1]); else incomplete=true;
    }
    return {symbols:[...symbols],holdingsState:incomplete?'partial':symbols.size?'complete':'unknown'};
  }
  try {
    for (let page=1;page<=pages;page++) {
      context();
      if(num('pageNo')!==page) fail('榜单页码发生变化。');
      const header=[...document.querySelectorAll('.sin-match-user-th')].find(visible);
      if (!header || header.innerText.trim().split(/\s+/).join('|')!==headers.join('|')) fail('官网榜单表头已变化，请核对字段。');
      const list=rows();if (!list.length) fail('榜单尚未加载。');
      for (const row of list) {
        context();
        if(!row.isConnected || num('pageNo')!==page) fail('读取期间榜单已切换。');
        let cells=[...row.children].filter(visible);
        if(visibleOnly && cells.length!==headers.length){
          // Some rows omit fields or span several columns. Only read a value if
          // its cell occupies exactly one labelled header position.
          const positions=headers.map(label=>{
            const el=[...header.querySelectorAll('*')].find(node=>text(node)===label);
            const rect=el?.getBoundingClientRect();
            return rect && rect.width ? rect.left+rect.width/2 : null;
          });
          const aligned=headers.map((_,i)=>cells.find(cell=>{
            const box=cell.getBoundingClientRect(), x=positions[i];
            return x!==null && x>=box.left && x<box.right && positions.filter(p=>p!==null && p>=box.left && p<box.right).length===1;
          }));
          cells=aligned[0] && aligned[1]?aligned:[cells[0],cells[1]];
        }
        const anchor=cells[1]?.querySelector('a[href]');
        const name=text(anchor)||text(cells[1]);
        const link=visible(anchor)?new URL(anchor.href):null;
        const linkedId=link?.origin===official && link.pathname==='/spmatch/gains/readInfo'?link.searchParams.get('lookeUserID'):null;
        if(!visibleOnly && (!linkedId || !/^\d+$/.test(linkedId) || link.searchParams.get('spmatchSeq')!==scope.seq))fail('未识别本场榜单内选手。');
        const id=linkedId || 'name:'+name;
        if(!name || players.has(id))fail('榜单行重复或选手无法识别。');
        const rankText=text(cells[0]), totalReturn=percent(text(cells[2]));
        const rank=/^(?:|--|—|[*＊★]+)$/.test(rankText)?null:Number(rankText);
        if(rank!==null && (!Number.isSafeInteger(rank)||rank<1)) fail('无法识别官网总排名。');
        const missing=row.innerText.includes('未报单');
        if (!visibleOnly && !missing && cells.length!==headers.length) fail('报单列已改变，请核对官网。');
        const dayReturn=missing?null:percent(text(cells[4])), exposureText=missing?'':text(cells[7]);
        const exposure=exposureText==='空仓'?0:percent(exposureText);
        const hints=[...row.querySelectorAll('[title]')].filter(visible).map(e=>e.title).join(' ');
        const status=row.innerText+' '+hints;
        const state=missing?'missing':/请假/.test(status)?'leave':/满仓停牌/.test(status)?'suspended':
          /没有更新报单|未更新/.test(status)||dayReturn===null?'unknown':'published';
        let holdings={symbols:[],holdingsState:'unknown'};
        if (!missing) {
          const trade=cells[6], toggle=[...(trade?.querySelectorAll('*')||[])].find(el=>visible(el)&&['展开','收起'].includes(text(el)));
          if (toggle && (!visibleOnly || linkedId)) {
            if(text(toggle)==='展开') {toggle.click();await pause(350);}
            const block=await until(()=>{const b=row.nextElementSibling;return b?.matches('.sin-match-expand') && visible(b) && [...b.querySelectorAll('table')].some(t=>visible(t)&&t.rows.length>1) && b;});
            holdings=currentHoldings(block,id,visibleOnly?link.searchParams.get('spmatchSeq'):scope.seq);
          } else if(text(trade).includes('解锁')) holdings.holdingsState='partial';
          if (exposureText==='空仓' && text(trade)==='空仓') holdings.holdingsState='empty';
        }
        players.set(id,{id,name,rank,totalReturn,dayReturn,exposure,state,...holdings});
        progress.textContent='短线王 · 第 '+page+' / '+pages+' 页 · '+players.size+' 名';
      }
      if (page<pages) {
        const next=[...document.querySelectorAll('.sin-match-page-bottom span')].find(el=>text(el)==='下一页');
        if (!next) fail('未识别下一页。');
        next.click();
        await until(()=>num('pageNo')===page+1 && rows().length && !list[0].isConnected);
        await pause(350);
      }
    }
    context();
    const records=[...players.values()];
    const ranks=records.map(p=>p.rank).filter(r=>r!==null).sort((a,b)=>a-b);
    const advertised=Number(document.body.innerText.match(/参赛人数[：:]\s*([\d,]+)/)?.[1]?.replaceAll(',',''));
    const rankComplete=records.length===advertised && ranks.length===records.length && ranks.every((r,i)=>r===i+1);
    const result={schemaVersion:1,...(visibleOnly?{access:'visible'}:{}),sourceUserId:scope.userId,sourceMatchSeq:scope.seq,matchId:scope.matchId,matchName:scope.matchName,
      divisionId:'all',divisionName:'全部选手',date,rankComplete,players:records};
    if (scope.date) { controls.remove(); return result; }
    const blob=new Blob([JSON.stringify(result)],{type:'application/json'});
    const download=document.createElement('a');download.href=URL.createObjectURL(blob);
    download.download='选手分析-'+scope.matchId+'-'+date+'.json';
    download.textContent='保存 JSON';download.style.cssText='color:white;margin:0 12px;text-decoration:underline';
    progress.textContent='已读取 '+records.length+' 名选手 · ';
    controls.insertBefore(download,cancel);cancel.textContent='关闭';
    let stopTransfer=()=>{};
    cancel.onclick=()=>{stopTransfer();URL.revokeObjectURL(download.href);controls.remove();};
    const workbench=scope.workbenchOrigin && new URL(scope.workbenchOrigin);
    if(!workbench || !['http:','https:'].includes(workbench.protocol) ||
        !['127.0.0.1','localhost','[::1]'].includes(workbench.hostname) || workbench.origin!==scope.workbenchOrigin){
      download.click();return;
    }
    const send=document.createElement('button');
    send.textContent='送回短线王';controls.insertBefore(send,download);
    send.onclick=()=>{
      try {context();} catch {progress.textContent='当前账号或比赛页面已变化，请重新采集。';return;}
      const nonce=crypto.randomUUID();
      const target=window.open(workbench.origin+'/player-analysis#contest-receive='+nonce,'_blank');
      if(!target || target.closed){progress.textContent='接收页未能打开。可允许本次弹窗或保存 JSON。';return;}
      send.disabled=true;
      progress.textContent='等待短线王接收… ';
      let sent=false;
      function receive(event){
        if(event.origin!==workbench.origin || event.source!==target || event.data?.nonce!==nonce)return;
        if(event.data.type==='askill-contest-ready' && !sent){
          try {context();}catch{stopTransfer();progress.textContent='账号或比赛页面已变化，请重新采集。';return;}
          target.postMessage({type:'askill-contest-snapshot',nonce,snapshot:result},workbench.origin);
          sent=true;
        }else if(event.data.type==='askill-contest-received' && sent){
          stopTransfer();progress.textContent='短线王已收到，请在工作台确认保存。 ';
        }
      }
      window.addEventListener('message',receive);
      const timeout=setTimeout(()=>{stopTransfer();progress.textContent='工作台尚未收到，可重试或保存 JSON。 ';},45000);
      stopTransfer=()=>{clearTimeout(timeout);window.removeEventListener('message',receive);send.disabled=false;};
    };
  } catch (err) { controls.remove();throw err; }
}
