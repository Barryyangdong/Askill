import {BacktestHoldout} from './BacktestHoldout';
export function BacktestOutcome({result,hide=false}:{result:unknown;hide?:boolean}){
 const out=result as {ok?:boolean;result?:{holdout?:unknown;metrics?:Record<string,unknown>;benchmark_is_self?:boolean;missing?:Record<string,unknown>}}|null;
 if(out?.ok!==true||!out.result?.metrics)return null;
 const m=out.result.metrics;
 const pct=(key:string)=>typeof m[key]==='number'&&Number.isFinite(m[key])?`${(Number(m[key])*100).toFixed(2)}%`:'—';
 const count=(key:string)=>typeof m[key]==='number'&&Number.isFinite(m[key])?String(m[key]):'—';
 const unsettled=m.unsettled_positions&&typeof m.unsettled_positions==='object'?Object.keys(m.unsettled_positions).length:0;
 return <section aria-label="回测结果概览" className="rounded border border-border bg-card p-4"><div className="mb-3 flex flex-wrap justify-between gap-2"><h2 className="text-sm font-semibold">本次历史实验 · 计算结果</h2><span className="text-xs text-muted-foreground">仅代表固定样本与本次数据版本</span></div><dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">{[['总收益',pct('total_return')],['年化',pct('annual_return')],['最大回撤',pct('max_drawdown')],['基准收益',pct('benchmark_return')],['成交记录',count('fill_count')],['平均资金暴露',pct('avg_gross_exposure')]].map(([label,value])=><div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-mono text-lg">{value}</dd></div>)}</dl>
 <div className="mt-3 flex flex-wrap gap-3 border-t border-border pt-3 text-xs"><span>基准：{out.result.benchmark_is_self?'同样本买入持有':String(m.benchmark_label??'未提供')}</span><span>期末未平仓 {unsettled} 只</span><span>已扣费用 {hide?'••••':typeof m.execution_fees==='number'?m.execution_fees.toFixed(2):'—'}（本次计价币种）</span><span className="text-warning">未平仓、数据缺口与复权口径见完整报告</span></div><BacktestHoldout value={out.result.holdout}/></section>;
}
