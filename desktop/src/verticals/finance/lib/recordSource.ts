import {workspaceReturn} from "./workspaceJourney.ts";

const pages = new Set(["/research","/backtest","/debate","/tasks","/observations","/workbench","/intel","/watch","/watch/intraday","/shortline","/daily-review","/modes","/candidates","/calendar","/notes","/my-stocks"]);
const allowedPage=(page:string)=>pages.has(page)||/^\/(?:shortline|intel)\/[A-Za-z0-9_-]+$/.test(page) && page.length<=120;
const keys = ["symbol","date","job","run","id","mode","pattern","thesis","message","object","kind","due","reminderDay","reminder","group","version","firstSymbol","groupSymbol","tab"] as const;
export type RecordSource = {page:string;anchor?:string} & Partial<Record<(typeof keys)[number],string>>;
/** Preserve only the validated identities that can be stored without truncation. */
export function recordSource(raw: string | null): RecordSource | null {
  const safe=workspaceReturn(raw); if(!safe)return null;
  const url=new URL(safe,"https://workspace.invalid"); if(!allowedPage(url.pathname) || url.searchParams.has("criteria"))return null;
  const out:RecordSource={page:url.pathname};
  for(const key of keys){const value=url.searchParams.get(key);if(value)out[key]=value;}
  if(url.hash)out.anchor=url.hash;
  return out;
}
export function recordSourceHref(value: unknown): string | null {
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const v=value as Record<string,unknown>;if(typeof v.page!=="string"||!allowedPage(v.page))return null;
  const q=new URLSearchParams();for(const k of keys)if(typeof v[k]==="string")q.set(k,v[k] as string);
  const safe=workspaceReturn(v.page+(q.size?`?${q}`:"")+(typeof v.anchor==="string"?v.anchor:""));
  if(!safe)return null;
  const parsed=new URL(safe,"https://workspace.invalid");
  if(parsed.pathname!==v.page || keys.some(k=>typeof v[k]==="string" && parsed.searchParams.get(k)!==v[k]) || (typeof v.anchor==="string" && parsed.hash!==v.anchor))return null;
  return safe;
}
