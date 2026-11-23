import { journeyHref } from '../lib/workspaceJourney';
import {useContext} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {WorkspaceContextScope} from './WorkspaceLink';
import {workspaceHref} from '../lib/workspaceContext';

const experiments = new Set(['/modes','/candidates','/backtest','/observations']);
const experimentLinks:[string,string][]=[['/modes','模式研究'],['/candidates','候选筛选'],['/backtest','历史验证'],['/observations','观察计划']];
const stock:[string,string][]=[['/workbench','行情'],['/intel/filings','公告与资讯'],['/research','研究'],['/debate','多空观点']];
export function WorkspaceNavigation(){
 const {pathname,search,hash}=useLocation();const context=useContext(WorkspaceContextScope);
 const stockPage = ['/workbench','/research','/debate','/intel'].some(p=>pathname===p||pathname.startsWith(p+'/')) && !!new URLSearchParams(search).get('symbol');
 const experiment = experiments.has(pathname);
 const sector = pathname.startsWith('/sectors') || pathname.startsWith('/signals');
 if(!stockPage && !experiment && !sector)return null;
 const primary:[string,string][] = stockPage ? stock : experiment ? experimentLinks : [['/sectors','题材研究'],['/signals','产业信号']];
 const href=(to:string)=>{
  if(pathname===to||pathname.startsWith(to+'/'))return journeyHref(pathname+search+hash,pathname,search,{hash});
  const url=new URL(workspaceHref(to,context),'http://local');const source=new URLSearchParams(search);
  for(const key of ['symbol','date'])if(source.get(key))url.searchParams.set(key,source.get(key)!);
  if(experiment){
    // A market selection is not an experiment scope. Only explicit context travels.
    url.searchParams.delete('symbol');
    for(const key of ['mode','version','pattern']){const value=source.get(key);if(value)url.searchParams.set(key,value);}
    if(to==='/observations')for(const key of ['symbol','run','thesis']){const value=source.get(key);if(value)url.searchParams.set(key,value);}
  }
  return journeyHref(url.pathname+url.search,pathname,search,{hash});
 };
 return <nav aria-label={stockPage?'个股功能':(experiment?'模式研究工具':'题材研究工具')} className="workspace-subnav flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-4 py-2 text-xs">
 {stockPage&&<Link className="mr-2 text-xs text-muted-foreground hover:text-primary" to={href('/watch')}>市场总览</Link>}
 <div className="workspace-subnav-track">
 {primary.map(([to, label]) => {
   const sectionPath = to === '/intel/filings' ? '/intel' : to;
   const active = pathname === sectionPath || pathname.startsWith(sectionPath + '/');
   return <Link key={to} to={href(to)} aria-current={active ? 'page' : undefined}
     className={`rounded-md px-3 py-1.5 text-xs transition-colors ${active ? 'bg-card font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
     {label}
   </Link>;
 })}
 </div>
 </nav>;
}
