import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePlayerCatalog } from '../src/finance/player_analysis_catalog.ts';
import { parsePlayerMembership } from '../src/finance/player_membership.ts';

test('目录按官方表头定位且仅接受赛事链接',()=>{
  const html = '<table><tr><th>主办方</th><th>比赛名称</th><th>选手数</th></tr><tr><td>主办方甲</td><td><a href="/spmatch/matchAll?tid=test1"> 年赛 </a></td><td>2,010</td></tr><tr><td>乙</td><td><a href="https://example.org/spmatch/matchAll?tid=t">未知站点</a></td><td>0</td></tr></table>';
  assert.deepEqual(parsePlayerCatalog(html),[{matchId:'test1',name:'年赛',url:'https://www.tgb.cn/spmatch/matchAll?tid=test1',players:2010,organizer:'主办方甲'}]);
  assert.deepEqual(parsePlayerCatalog(html.replace('选手数','未知字段')),[]);
});
test('公开参赛卡须同时匹配账号、赛事链接和进行中状态',()=>{
  const start='<div class="msgC_Right_title_act">参加的比赛</div>';
  const card=(state:string,id:string,tid:string)=>`<div class="container-match-list"><a href="/spmatch/matchAll?tid=${tid}"><div class="match-top-name left">年赛• 年赛甲</div></a><div class="match-top-state left">${state}</div><a href="/spmatch/gains/readInfo?lookeUserID=${id}&amp;spmatchSeq=881">查看战绩</a><div class="container-match-bottom">`;
  assert.deepEqual(parsePlayerMembership(start+card('进行中','123','a')+card('已结束','123','b')+card('进行中','456','c'),'123'),[{matchId:'a',name:'年赛甲',spmatchSeq:'881'}]);
  assert.deepEqual(parsePlayerMembership(start+card('进行中','123','a')+card('进行中','123','a').replace('spmatchSeq=881','spmatchSeq=999'),'123'),[{matchId:'a',name:'年赛甲'}]);
  assert.throws(()=>parsePlayerMembership('<title>登录</title>','123'),/参赛栏目/);
});
