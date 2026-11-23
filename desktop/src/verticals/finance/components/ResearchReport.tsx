import type { backend } from "../lib/backend";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { noRemoteImages } from "../../../core/ai/noRemoteImages";
import { useId, useMemo, useRef } from "react";
import type { Components } from "react-markdown";
import { appendixIds, citationPlugin } from "../lib/reportCitations";
import { PRODUCT_NAME } from "@/lib/brand";


export function ResearchReport({ result }: { result: Awaited<ReturnType<typeof backend.report>> }) {
  const prefix = `reference-${useId()}-${encodeURIComponent(result.run_id)}-`;
  const panel = useRef<HTMLDetailsElement>(null);
  const ids = useMemo(() => appendixIds(result.appendix ?? ""), [result.appendix]);
  const headings = useMemo(() => {
    let fence = "", fenceLength = 0;
    return (result.report ?? "").split("\n").flatMap((line, index) => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker) {
        if (!fence) { fence = marker[0]!; fenceLength = marker.length; }
        else if (marker[0] === fence && marker.length >= fenceLength && /^ {0,3}(?:`+|~+)\s*$/.test(line)) { fence = ""; fenceLength = 0; }
        return [];
      }
      if (fence) return [];
      const heading = /^ {0,3}(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
      return heading ? [{ line: index + 1, level: heading[1]!.length, title: heading[2]! }] : [];
    });
  }, [result.report]);
  const headingIds = new Map(headings.map(h => [h.line, `${prefix}heading-${h.line}`]));
  const components: Components = {
    ...noRemoteImages,
    h2: ({node, children, ...props}) => <h2 {...props} id={headingIds.get(node?.position?.start.line ?? -1)}>{children}</h2>,
    h3: ({node, children, ...props}) => <h3 {...props} id={headingIds.get(node?.position?.start.line ?? -1)}>{children}</h3>,
    a: ({ node: _node, href, children, ...props }) => <a {...props} href={href} onClick={event => {
      if (!href?.startsWith(`#${prefix}`)) return;
      const target = [...(panel.current?.querySelectorAll<HTMLElement>("[id]") ?? [])]
        .find(element => `#${element.id}` === href);
      if (!target || !panel.current) return;
      event.preventDefault();
      panel.current.open = true;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    }}>{children}</a>,
  };
  const appendixComponents = { ...components };
  delete appendixComponents.h2;
  delete appendixComponents.h3;
  if (result.availability === "missing") return <p className="text-sm text-muted-foreground">这次运行尚无报告文件，请查看上方运行状态。</p>;
  if (result.availability !== "ready" || result.report === null) return <p role="status" className="text-sm text-muted-foreground">报告尚未通过最终校验，正文暂不可用。本地草稿保留供排查；研究结束后可从归档重新打开。</p>;
  return <>
    {result.run_status === "incomplete" && <p role="status" className="mb-2 text-sm text-muted-foreground">这份报告资料不完整，请先查看报告中的数据缺口。</p>}
    <div className={result.appendix ? "grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(260px,.65fr)]" : "min-w-0"}>
      <article className="research-paper rounded border border-border" aria-label="已校验研究报告">
        <p className="workspace-kicker mb-6 border-b border-border pb-4">{PRODUCT_NAME} / Research Note</p>
        {headings.length > 1 && <nav aria-label="报告目录" className="mb-6 rounded border border-border p-3 text-xs"><strong>报告目录</strong><ol className="mt-2 space-y-1">{headings.map(h=><li key={h.line} className={h.level===3?"ml-4":""}><a className="text-primary" href={`#${headingIds.get(h.line)}`}>{h.title}</a></li>)}</ol></nav>}
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm, citationPlugin(ids, prefix)]} components={components}>{result.report}</ReactMarkdown>
        </div>
      </article>
      {result.appendix && <details ref={panel} className="research-evidence rounded">
        <summary className="cursor-pointer text-sm font-semibold">证据附录</summary>
        <p className="mb-4 mt-2 text-xs leading-6 text-muted-foreground">点击正文引用可定位到同一次运行的证据或计算记录；计算的输入引用也可继续追溯。没有对应记录的编号保留为普通文字，不推断缺失出处。</p>
        <div className="prose prose-sm dark:prose-invert max-h-[70vh] max-w-none overflow-auto break-words">
          <ReactMarkdown remarkPlugins={[remarkGfm, citationPlugin(ids, prefix, true)]} components={appendixComponents}>{result.appendix}</ReactMarkdown>
        </div>
      </details>}
    </div>
  </>;
}
