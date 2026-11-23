import {useContext} from 'react';
import {WorkspaceContextScope} from './WorkspaceLink';
import {normalizeMarketSymbol} from '../lib/marketSymbol';
import {Link,useLocation,useSearchParams} from 'react-router-dom';
const steps=[{to:'/shortline',name:'复盘发现'},{to:'/modes',name:'定义观察'},{to:'/backtest',name:'历史实验'},{to:'/observations',name:'向前核验'}];
export function ResearchWorkflow(){
 const {pathname}=useLocation();const [params]=useSearchParams();const context=useContext(WorkspaceContextScope);const symbol=normalizeMarketSymbol(params.get('symbol'))??context.symbol;
 return <nav aria-label="研究验证流程" className="mb-4 flex flex-wrap items-center gap-2 text-xs">{steps.map((s,i)=><Link key={s.to} aria-current={pathname===s.to?'page':undefined} to={`${s.to}${symbol?`?symbol=${encodeURIComponent(symbol)}`:''}`} className={`rounded border px-3 py-2 ${pathname===s.to?'border-primary/40 bg-primary/10 text-primary':'border-border text-muted-foreground hover:text-foreground'}`}>{i+1} · {s.name}</Link>)}</nav>;
}
