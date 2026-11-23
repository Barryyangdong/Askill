type Segment={label:string;start:string;end:string;metrics:Record<string,unknown>};
export function BacktestHoldout({value}:{value:unknown}){
 if(!value||typeof value!=='object')return null;
 const v=value as {complete?:boolean;segments?:Segment[];error?:string;note?:string};
 if(!Array.isArray(v.segments))return null;
 const fmt=(n:unknown,pct=false)=>typeof n==='number'&&Number.isFinite(n)?pct?`${(n*100).toFixed(2)}%`:String(n):'—';
 return <section aria-label="固定参数留出验证" className="mt-3 rounded border border-border p-3 text-xs"><h3 className="font-semibold">固定参数 · 留出验证 {v.complete?'':'（未完成）'}</h3><div className="overflow-x-auto"><table className="mt-2 w-full text-left"><thead><tr>{['区间','总收益','最大回撤','成交记录'].map(h=><th key={h} className="p-2 font-normal text-muted-foreground">{h}</th>)}</tr></thead><tbody>{v.segments.map(s=><tr key={s.label} className="border-t border-border"><td className="p-2">{s.label}<span className="block text-muted-foreground">{s.start} — {s.end}</span></td><td className="p-2 font-mono">{fmt(s.metrics?.total_return,true)}</td><td className="p-2 font-mono">{fmt(s.metrics?.max_drawdown,true)}</td><td className="p-2 font-mono">{fmt(s.metrics?.fill_count)}</td></tr>)}</tbody></table></div>{v.error&&<p role="alert" className="mt-2 text-warning">{v.error}</p>}<p className="mt-2 text-muted-foreground">{v.note??'各段独立资金与预热，不拼接收益，不代表已经通过样本外检验。'}</p></section>;
}
