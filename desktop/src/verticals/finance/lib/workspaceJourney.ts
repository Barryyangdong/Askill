import { isWorkspacePath, WORKSPACE_ALIASES } from './workspaceRoutes.ts';
import { readWorkspaceContext } from './workspaceContext.ts';

// Route-specific object protocols. Unknown fields, secrets and nested returnTo never travel.
type Validator = (value: string) => boolean;
const identity: Validator = value => /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const day: Validator = value => readWorkspaceContext(JSON.stringify({date:value})).date === value;
const symbol: Validator = value => readWorkspaceContext(JSON.stringify({symbol:value})).symbol === value;
const positive: Validator = value => /^[1-9]\d{0,8}$/.test(value);
const choice = (...values:string[]):Validator => value => values.includes(value);
const text: Validator = value => value.length > 0 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);
const fields: Record<string,Record<string,Validator>> = {
 '/watch':{tab:choice('live','intraday'),filter:identity},
 '/workbench':{group:choice('1','2','3'),firstSymbol:symbol},
 '/intel':{group:choice('1','2','3'),firstSymbol:symbol,groupSymbol:symbol},
 '/shortline':{reminder:choice('close','premarket'),reminderDay:day},
 '/observations':{id:identity,thesis:identity,run:identity,pattern:identity,mode:identity,version:positive},
 '/modes':{run:identity,mode:identity,version:positive,pattern:identity},
 '/candidates':{pattern:identity,mode:identity,version:positive},
 '/backtest':{job:identity,mode:identity,version:positive,pattern:identity},
 '/tasks':{job:identity}, '/debate':{job:identity},
 '/research':{tab:identity,run:identity}, '/my-stocks':{tab:choice('watch','hold')},
 '/my-reports':{report:identity,page:positive}, '/notes':{id:identity,q:text,filter:identity},
};
function calendarIdentity(source:URLSearchParams, target:URLSearchParams) {
 // Match CalendarTargets precedence. Invalid higher-priority identities must not fall back to another object.
 if(source.has('message')) {const value=source.get('message')!;if(identity(value))target.set('message',value);return;}
 const kind=source.get('kind')??'criterion';
 if(!['criterion','thesis','action'].includes(kind))return;
 if(source.has('object')) {
  const value=source.get('object')!,due=source.get('due');
  if(!identity(value)||(due!==null&&!day(due)))return;
  target.set('kind',kind);target.set('object',value);if(due)target.set('due',due);return;
 }
 if(source.has('criteria')) {
  const raw=source.get('criteria')!;if(raw.length>256000)return;
  try {
   const items:unknown=JSON.parse(raw);
   if(!Array.isArray(items)||!items.length||items.length>1000||!items.every(item=>item&&typeof item==='object'&&typeof item.id==='string'&&identity(item.id)&&typeof item.due==='string'&&day(item.due)))return;
   target.set('kind',kind);
   target.set('criteria',JSON.stringify(items.map(item=>({id:item.id,due:item.due}))));
  } catch { /* A malformed target never becomes a partial selection. */ }
 }
}
// Only anchors implemented by ThesisPanel/CalendarTargets; never arbitrary fragments.
function workspaceHash(path:string,hash:string):string {
 try {
  const decoded=decodeURIComponent(hash);
  const prefix=['/research','/workbench'].includes(path)?'#observation-':path==='/calendar'?'#criterion-':null;
  if(prefix&&decoded.startsWith(prefix)&&identity(decoded.slice(prefix.length)))return prefix+encodeURIComponent(decoded.slice(prefix.length));
 } catch { /* Invalid escape sequences are not a target. */ }
 return '';
}
export function workspaceReturn(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  try {
    const url = new URL(raw, 'https://workspace.invalid');
    if (url.origin !== 'https://workspace.invalid' || !isWorkspacePath(url.pathname)) return null;
    const normalized=url.pathname.length>1?url.pathname.replace(/\/$/,''):url.pathname;
    const alias=WORKSPACE_ALIASES[normalized];
    url.pathname=alias?.path??normalized;
    if(alias?.tab)url.searchParams.set('tab',alias.tab);
    const route='/'+url.pathname.split('/')[1];
    const query = new URLSearchParams();
    const allowed={symbol,date:day,...fields[route]};
    for (const [key,valid] of Object.entries(allowed)) {
      const value=url.searchParams.get(key);
      if(value!==null&&valid(value))query.set(key,value);
    }
    if(route==='/calendar')calendarIdentity(url.searchParams,query);
    return url.pathname + (query.size ? `?${query}` : '') + workspaceHash(url.pathname,url.hash);
  } catch { return null; }
}
/** Compare route + validated business identity, ignoring ordering and navigation metadata. */
export function sameWorkspaceLocation(left: string, right: string): boolean {
 const a=workspaceReturn(left),b=workspaceReturn(right);if(!a||!b)return false;
 const canonical=(raw:string)=>{const url=new URL(raw,'https://workspace.invalid');url.searchParams.sort();return url.pathname+url.search;};
 return canonical(a)===canonical(b);
}
export function journeyHref(target: string, pathname: string, search: string, overrides: {symbol?: string; date?: string; hash?: string} = {}): string {
  const origin='https://workspace.invalid';
  const source = new URLSearchParams(search);
  const returnQuery = new URLSearchParams(source);
  const context = readWorkspaceContext(JSON.stringify({symbol: overrides.symbol ?? source.get('symbol'), date: overrides.date ?? source.get('date')}));
  for(const key of ['symbol','date'] as const)if(overrides[key]&&context[key])returnQuery.set(key,context[key]!);
  const current=workspaceReturn(pathname+(returnQuery.size?`?${returnQuery}`:'')+(overrides.hash??''))??'/watch';
  // Only internal destinations are accepted. Never reinterpret an external URL as a local path.
  const safeTarget=workspaceReturn(target);
  if(!safeTarget)return current;
  const destination = new URL(safeTarget, origin);
  for (const key of ['symbol', 'date'] as const) if (context[key] && !destination.searchParams.has(key)) destination.searchParams.set(key, context[key]!);
  const currentPath=new URL(current,origin).pathname;
  if(destination.pathname===currentPath){
    const back=workspaceReturn(source.get('returnTo'));
    if(back&&!sameWorkspaceLocation(back,destination.pathname+destination.search)){
      destination.searchParams.set('source',new URL(back,origin).pathname);
      destination.searchParams.set('returnTo',back);
    }
    return destination.pathname+destination.search+destination.hash;
  }
  destination.searchParams.set('source',currentPath);
  destination.searchParams.set('returnTo',current);
  return destination.pathname + destination.search + destination.hash;
}
