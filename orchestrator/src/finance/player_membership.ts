import {ServiceError} from '../service.ts';
import {readPublicTgbPage} from './player_analysis_catalog.ts';

/** Check the declared public profile's visible active entries. This proves neither
 * ownership of the profile nor access to any authenticated report. */
export function parsePlayerMembership(html: string, userId: string) {
  const heading = /<div\b[^>]*class=["']msgC_Right_title_act["'][^>]*>\s*参加的比赛/.exec(html);
  if (!heading) throw new ServiceError('source_unavailable','官网未返回可识别的参赛栏目，请打开公开主页核对。');
  const chunks = html.slice(heading.index).split(/<div\s+class=["']container-match-list["']\s*>/);
  const matches = new Map<string,{matchId:string;name:string;spmatchSeq?:string}>();
  for (const chunk of chunks.slice(1)) {
    const top = chunk.split(/<div\s+class=["']container-match-bottom["']/)[0];
    const record = /href=["']\/spmatch\/gains\/readInfo\?lookeUserID=(\d+)(?:&amp;|&)spmatchSeq=(\d+)["']/i.exec(top);
    const entry = /href=["']\/spmatch\/matchAll\?tid=([A-Za-z0-9]+)["']/i.exec(top);
    const active = /class=["']match-top-state\s+left["'][^>]*>\s*进行中\s*<\/div>/.test(top);
    const name = /class=["']match-top-name\s+left["'][^>]*>([^<>]*)<\/div>/.exec(top)?.[1]
      .replace(/^[\s\S]*?[•·]/,'').trim().replace(/&amp;/g,'&');
    if (active && entry && name && record?.[1] === userId && !/(?:已退赛|取消资格|已被移除)/.test(top)) {
      const matchId = entry[1], spmatchSeq = record[2], existing = matches.get(matchId);
      if (!existing) matches.set(matchId,{matchId,name,spmatchSeq});
      else if (existing.spmatchSeq !== spmatchSeq) delete existing.spmatchSeq;
    }
  }
  return [...matches.values()];
}
export async function getPlayerMembership(userId:string,signal:AbortSignal) {
  if (!/^[1-9]\d{0,15}$/.test(userId)) throw new ServiceError('bad_request','请输入本人淘股吧公开主页的数字用户 ID。');
  const url='https://www.tgb.cn/user/blog/myspmath?userID='+userId;
  try {
    const html = await readPublicTgbPage(url,signal);
    return {userId,checkedAt:new Date().toISOString(),matches:parsePlayerMembership(html,userId)};
  } catch (error) {
    if (signal.aborted || error instanceof ServiceError) throw error;
    throw new ServiceError('source_unavailable','未能从官网核对在赛记录，请稍后重试。');
  }
}
