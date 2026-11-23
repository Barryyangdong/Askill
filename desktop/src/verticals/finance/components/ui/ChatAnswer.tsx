import { ReportAnswer } from "../ReportAnswer";

/** Only separate the application's appended receipt. Preserve model text verbatim. */
export function answerSections(content: string) {
  const marker = "\n\n---\n**本轮来源**";
  const index = content.lastIndexOf(marker);
  if (index < 0) return { body: content, sources: "", failed: false };
  const sources = content.slice(index + marker.length).trim();
  return { body: content.slice(0, index), sources, failed: sources.includes("没成功的:") || sources.includes("没有成功取到的数据或资料。") };
}

export function ChatAnswer({ content }: { content: string }) {
  const { body, sources, failed } = answerSections(content);
  const first = body.split(/\n\s*\n/)[0] ?? "";
  // Preview an intact prose paragraph only; never cut tables, code or a warning.
  const preview = body.length > 1600 && first.length > 0 && first.length < 600 &&
    !/^[#|`>\-\d]/.test(first) && !body.includes("⚠️") ? first : "";
  return <div className="space-y-3">
    {preview ? <>
      <ReportAnswer content={preview} />
      <details className="rounded border border-border px-3 py-2 text-sm">
        <summary className="cursor-pointer text-primary">展开完整回答 · 含数据与证据</summary>
        <div className="mt-3"><ReportAnswer content={body} /></div>
      </details>
    </> : <ReportAnswer content={body} />}
    {sources && <div className="border-t border-border pt-2 text-xs text-muted-foreground">
      {failed && <p role="status" className="mb-2 text-warning">本轮有数据或资料未取到，请核对来源详情。</p>}
      <details><summary className="cursor-pointer text-primary">本轮来源与取数记录</summary>
        <div className="mt-2"><ReportAnswer content={sources} /></div>
      </details>
    </div>}
  </div>;
}
