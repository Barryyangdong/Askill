import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { noRemoteImages } from "../../../core/ai/noRemoteImages";
import {useMarkdownOutline} from "./MarkdownOutline";

const FIELD_NAMES: Record<string, string> = {
  ind_close: "收盘价", ind_ma5: "5 日均线", ind_ma10: "10 日均线", ind_ma20: "20 日均线", ind_ma60: "60 日均线",
  ind_ema26: "26 日指数均线", ind_macd_dif: "MACD DIF", ind_macd_dea: "MACD DEA", ind_macd_hist: "MACD 柱",
  ind_kdj_k: "KDJ K", ind_kdj_d: "KDJ D", pe_ttm: "滚动市盈率", pe_static: "静态市盈率", pb: "市净率",
  market_cap: "总市值", eps_basic_cum: "累计每股收益", change_pct: "涨跌幅", limit_down_price: "跌停价",
  last_close: "前收盘价", volume_ratio: "量比", turnover_rate: "换手率", turnover_amount: "成交额",
  quote_time: "行情时间", tx_quote: "行情快照", indicators_cn: "技术指标", price: "现价",
};

export function readableDebate(content: string) {
  const references: string[] = [];
  let body = content.replace(/\[((?:ev|calc)-[A-Za-z0-9_-]+[^\]\n]*)\]/g, (_match, ref: string) => {
    let index = references.indexOf(ref);
    if (index < 0) { index = references.length; references.push(ref); }
    return `[〔${index + 1}〕](#debate-ref-${index + 1})`;
  });
  body = body.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, token => FIELD_NAMES[token] ?? token);
  return { body, references };
}

export function DebateReport({ content }: { content: string }) {
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [originalOpen, setOriginalOpen] = useState(false);
  const { body, references } = readableDebate(content);
  const outline=useMarkdownOutline(body);
  return <div className="min-w-0">
    {outline.outline}
    <div className="prose prose-sm dark:prose-invert max-w-none break-words text-foreground prose-table:text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ ...noRemoteImages, ...outline.components,
        a: ({ href, children }) => href?.startsWith("#debate-ref-")
          ? <button type="button" onClick={() => setReferencesOpen(true)} className="mx-0.5 text-[11px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-primary" aria-label={`查看引用 ${String(children)}`}>{children}</button>
          : <a href={href} target="_blank" rel="noreferrer">{children}</a>,
      }}>{body}</ReactMarkdown>
    </div>
    {!!references.length && <details className="mt-3 text-xs text-muted-foreground" open={referencesOpen} onToggle={e => setReferencesOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer py-1">引用依据（{references.length}）</summary>
      <ol className="mt-2 max-h-56 space-y-1 overflow-auto rounded border border-border bg-muted/20 p-3">
        {references.map((ref, i) => <li key={ref} className="break-all">〔{i + 1}〕 {ref}</li>)}
      </ol>
    </details>}
    <details className="mt-1 text-xs text-muted-foreground" open={originalOpen} onToggle={e => setOriginalOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer py-1">查看原始正文</summary>
      {originalOpen && <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-border p-3">{content}</pre>}
    </details>
  </div>;
}
