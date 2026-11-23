import { useEffect, useRef, useState } from "react";
import { useShortlineView } from "./useView";
import { reading } from "./format";
import type { Check, ItemResult, VerifyResult } from "./viewTypes";

const visibleRows = 3;

function ResultList({ items }: { items: ItemResult[] }) {
  return <ul className="divide-y divide-border/60">
    {items.map(item => <li key={item.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2">
      <b>{item.label}</b>
      <span>预期 {item.direction_label}</span>
      <span>实际 {item.actual_label ?? "读数缺失"}{item.cur_value != null && `（${reading(item.cur_value, item.kind, item.unit)}）`}</span>
      <span>{item.verified === null ? "待核实" : item.verified ? "成立" : "未成立"}</span>
      {item.late && <span className="text-warning">开盘竞价后记录，不计入统计</span>}
    </li>)}
  </ul>;
}

function CheckNotice({ message, retry }: { message: string; retry: () => void }) {
  return <div className="flex flex-wrap items-center gap-3">
    <p role="status">{message}</p>
    <button type="button" className="text-xs text-primary hover:underline" onClick={retry}>重新读取</button>
  </div>;
}

export function ReviewCheckRows({ check, retry }: { check: Check; retry: () => void }) {
  if (!check.available) return <CheckNotice message={check.reason || "当日核验数据暂不可用"} retry={retry} />;
  if (!check.results.length) return <CheckNotice message={`${check.set_date} 没有保存验证条件。`} retry={retry} />;
  return <>
    <p className="text-xs text-muted-foreground">{check.set_date} 的预期 · {check.date} 的实测</p>
    {check.provisional && <p role="status" className="text-warning">结果暂定，尚未计入统计。</p>}
    <ResultList items={check.results.slice(0, visibleRows)} />
    {check.results.length > visibleRows && <details open>
      <summary className="cursor-pointer py-1 text-xs text-muted-foreground hover:text-foreground">其余 {check.results.length - visibleRows} 条条件</summary>
      <ResultList items={check.results.slice(visibleRows)} />
    </details>}
  </>;
}

function CheckData({ day, refreshNonce }: { day: string; refreshNonce: number }) {
  const [retries, setRetries] = useState(0);
  const [state] = useShortlineView<VerifyResult>("shortline_verify", day, undefined, refreshNonce + retries);
  const retry = () => setRetries(n => n + 1);
  if (state.state === "loading") return <p role="status">正在读取昨日条件…</p>;
  if (state.state === "failed") return <CheckNotice message={`核验数据暂不可用：${state.why}`} retry={retry} />;
  if (state.data.date !== day) return <CheckNotice message="当前数据与复盘日期不一致。" retry={retry} />;
  return <ReviewCheckRows check={state.data.check} retry={retry} />;
}

export function ReviewCheckSummary({ day, refreshNonce, onOpen }: { day: string; refreshNonce: number; onOpen: () => void }) {
  const section = useRef<HTMLElement>(null);
  const [nearby, setNearby] = useState(false);

  useEffect(() => {
    const element = section.current;
    if (!element || nearby || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setNearby(true);
    }, { root: element.closest("main"), rootMargin: "160px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [nearby]);

  return <section ref={section} className="glass p-4 text-sm">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">昨日条件验证</h3>
      <button type="button" onClick={onOpen} className="text-xs text-primary hover:underline">写下次日验证条件</button>
    </header>
    <div className="mt-3 space-y-2">
      {nearby ? <CheckData key={day} day={day} refreshNonce={refreshNonce} />
        : <button type="button" onClick={() => setNearby(true)} className="text-xs text-muted-foreground hover:underline">读取核验结果</button>}
    </div>
  </section>;
}
