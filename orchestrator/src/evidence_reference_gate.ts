/** Checks reference membership, not whether a cited passage semantically entails a claim. */
export function referenceIssue(text:string,known:readonly string[]):string|null{
 const allowed=new Set(known);
 const mentions=[...text.matchAll(/\bev-[A-Za-z0-9_-]+\b/g)].map(m=>m[0]);
 if(mentions.some(id=>!allowed.has(id)))return '引用了本轮资料包不存在的证据编号';
 if(allowed.size&&text.length>=200&&!known.some(id=>text.includes(`[${id}]`)||text.includes(`【${id}`)||text.includes(`〔${id}`)||text.includes(id)))return '正式正文没有引用本轮任何可核对证据';
 return null;
}
