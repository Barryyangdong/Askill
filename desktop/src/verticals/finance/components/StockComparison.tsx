import { lazy, Suspense, useState } from "react";
import { normalizeMarketSymbol } from "@/lib/marketSymbol";
const Chart = lazy(() => import("./KlineCard").then(m => ({ default: m.KlineCard })));

export function StockComparison({ initialSymbol }: { initialSymbol: string }) {
  const [symbols, setSymbols] = useState(() => [normalizeMarketSymbol(initialSymbol)].filter((s): s is string => Boolean(s)));
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  return <section aria-label="股票图表对比" className="mt-4 border-t border-border pt-4">
    <h3 className="mb-2 text-sm font-medium">双股对比</h3>
    <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={e => {
      e.preventDefault();
      const code = normalizeMarketSymbol(input);
      if (!code) { setError("请输入有效股票代码"); return; }
      if (symbols.includes(code)) { setError("这只股票已在对比中"); return; }
      if (symbols.length >= 2) { setError("最多同时对比两只股票"); return; }
      setSymbols(previous => [...previous, code]); setInput(""); setError("");
    }}>
      <input aria-label="对比股票代码" placeholder="输入另一只股票代码" value={input} onChange={e => setInput(e.target.value)} maxLength={20} className="rounded border border-border bg-background px-3 py-2 text-xs" />
      <button type="submit" disabled={symbols.length >= 2} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-40">加入对比</button>
      <span className="text-xs text-muted-foreground">独立价格轴 · 周期与复权分别设置</span>
    </form>
    {error && <p role="alert" className="mb-2 text-xs text-warning">{error}</p>}
    <div className="grid min-w-0 gap-3 xl:grid-cols-2">{symbols.map(symbol => <div key={symbol} className="min-w-0">
      <Suspense fallback={<p role="status">正在打开 {symbol} 图表…</p>}><Chart symbol={symbol} action={<button type="button" aria-label={`移除对比 ${symbol}`} onClick={() => { setSymbols(list => list.filter(s => s !== symbol)); setError(""); }} className="text-xs text-muted-foreground hover:text-foreground">移除</button>} /></Suspense>
    </div>)}</div>
  </section>;
}
