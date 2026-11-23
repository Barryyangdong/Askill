import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { noRemoteImages } from "../../../core/ai/noRemoteImages";
import { Link } from "react-router-dom";
import { cleanAutoLinks } from "../../../core/ai/cleanAutoLinks";
import { backend } from "../lib/backend";
import { libraryCitations, LIBRARY_CITATION, type CitationDocument } from "../lib/libraryCitations";
import {useMarkdownOutline} from "./MarkdownOutline";
import {JourneyLink} from "./JourneyLink";
import {workspaceReturn} from "../lib/workspaceJourney";

export function ReportAnswer({ content, displayName }: { content: string; displayName?: (name: string) => string }) {
  const outline=useMarkdownOutline(content);
  const ids = [...content.matchAll(LIBRARY_CITATION)].map(m => m[1]).sort().join(",");
  const [documents, setDocuments] = useState<CitationDocument[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setDocuments([]); setError(false);
    if (ids) void backend.reports().then(rows => { if (active) setDocuments(rows); }, () => { if (active) setError(true); });
    return () => { active = false; };
  }, [ids]);
  return <>
    {outline.outline}
    <ReactMarkdown remarkPlugins={[remarkGfm, cleanAutoLinks, libraryCitations(documents, displayName)]}
      components={{ ...noRemoteImages, ...outline.components, a: ({ href, children, ...props }) => href?.startsWith("/tasks?job=") && workspaceReturn(href)
        ? <JourneyLink to={workspaceReturn(href)!} title={props.title}>{children}</JourneyLink>
        : href?.startsWith("/my-reports?report=") ? <Link to={href} title={props.title}>{children}</Link>
        : <a href={href} title={props.title}>{children}</a> }}>{content}</ReactMarkdown>
    {error && <p role="status" className="text-xs text-muted-foreground">资料名称暂时读取失败，原始引用编号已保留。可到“我的研报”核对。</p>}
  </>;
}
