import type { KlineView } from "@/lib/klineView";
import { fmtPrice } from "@/lib/klineView";
import { ContextHelp } from "@/components/ui/ContextHelp";

export function KlineStructure({ view }: { view: KlineView }) {
  const readings = view.series.structure;
  const i = view.series.dates.length - 1;
  const value = (key: string) => readings?.[key]?.[i] ?? null;
  const percent = (key: string) => value(key) === null ? "—" : `${(value(key)! * 100).toFixed(1)}%`;
  return <section aria-label="形态读数" className="my-3 rounded border border-border p-3">
    <div className="mb-2 flex items-center gap-2 text-xs"><strong>形态读数</strong><span className="text-muted-foreground">截至 {view.last}</span><ContextHelp label="形态计算口径">按当前周期与复权口径计算。区间位置=(收盘−近20根最低)/(近20根最高−近20根最低)；量比=本根成交量/之前5根平均量，不是分时量比；上下影占本根高低差。波动带=20根收盘均值±2倍总体标准差。窗口不足、缺值或分母为零显示—。仅描述已发生行情，不给出买卖信号。</ContextHelp></div>
    <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
      {[["20根区间位置", percent("range20")], ["相对前5根量", value("volume5") === null ? "—" : `${value("volume5")!.toFixed(2)}倍`], ["上影占比", percent("upper_wick")], ["下影占比", percent("lower_wick")]].map(([label, text]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-mono text-sm">{text}</dd></div>)}
    </dl>
    <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground"><span>20根波动带</span>{[["上", "band_upper"], ["中", "band_middle"], ["下", "band_lower"]].map(([label, key]) => <span key={key}>{label} <b className="font-mono font-normal text-foreground">{fmtPrice(value(key!))}</b></span>)}</p>
  </section>;
}
