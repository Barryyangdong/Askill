export interface EnrolledMatch {matchId:string; name:string; spmatchSeq?:string}
export function contestId(input:string):string|null {
  try {
    const url=new URL(input.trim());
    const ids=url.searchParams.getAll("tid");
    return ["https://www.tgb.cn","https://tgb.cn"].includes(url.origin) && !url.username && !url.password &&
      url.pathname==="/spmatch/matchAll" && ids.length===1 && /^[A-Za-z0-9]+$/.test(ids[0]!) ? ids[0]! : null;
  } catch {return null;}
}
export interface PlayerMembership {
  userId:string; checkedAt:string; expiresAt:string; expired:boolean; canRebind?:boolean; matches:EnrolledMatch[];
}
export function profileId(input:string):string|null {
  const text=input.trim();
  if (/^\d{1,20}$/.test(text)) return text;
  try {
    const url=new URL(text);
    if (url.protocol!=="https:" || !["tgb.cn","www.tgb.cn","m.tgb.cn","www.taoguba.com.cn","taoguba.com.cn"].includes(url.hostname) || url.username || url.password || url.port) return null;
    return /^\/blog\/(\d{1,20})\/?$/.exec(url.pathname)?.[1]??null;
  } catch {return null;}
}
export function activeMembership(value:PlayerMembership|null, now=Date.now()):value is PlayerMembership {
  return !!value && !value.expired && Date.parse(value.expiresAt)>now && value.matches.length>0;
}

