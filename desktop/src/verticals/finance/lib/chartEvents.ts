import type {Announcement} from './api';

/** Publication date only: never shift weekend notices onto an earlier session. */
export function chartEvents(items:Announcement[],dates:string[],close:(number|null)[],enabled:boolean){
  if(!enabled)return [];
  const groups=new Map<string,Announcement[]>();
  for(const item of items){
    const date=item.date.slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!dates.includes(date))continue;
    const rows=groups.get(date)??[];
    if(!rows.some(r=>r.title===item.title&&r.url===item.url))rows.push(item);
    groups.set(date,rows);
  }
  return [...groups].flatMap(([date,items])=>{
    const price=close[dates.indexOf(date)];
    return typeof price==='number'&&Number.isFinite(price)?[{date,price,items}]:[];
  });
}
