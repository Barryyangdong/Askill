import {useId,useMemo} from "react";
import type {Components} from "react-markdown";

/** TOC from actual ATX headings; fenced examples never become navigation targets. */
export function useMarkdownOutline(content:string) {
 const prefix=`outline-${useId()}-`;
 const headings=useMemo(()=>{
  let fence="",length=0;
  return content.split("\n").flatMap((line,index)=>{
   const mark=/^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
   if(mark){if(!fence){fence=mark[0]!;length=mark.length;}else if(mark[0]===fence&&mark.length>=length&&/^ {0,3}(?:`+|~+)\s*$/.test(line)){fence="";length=0;}return [];}
   if(fence)return [];
   const match=/^ {0,3}(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
   return match?[{line:index+1,level:match[1]!.length,title:match[2]!}]:[];
  });
 },[content]);
 const ids=new Map(headings.map(h=>[h.line,`${prefix}${h.line}`]));
 const components:Components={
  h2:({node,children,...props})=><h2 {...props} id={ids.get(node?.position?.start.line??-1)}>{children}</h2>,
  h3:({node,children,...props})=><h3 {...props} id={ids.get(node?.position?.start.line??-1)}>{children}</h3>,
 };
 const outline=headings.length>1?<nav aria-label="报告目录" className="not-prose mb-4 rounded border border-border p-3 text-xs"><strong>报告目录</strong><ol className="mt-2 max-h-40 space-y-1 overflow-auto">{headings.map(h=><li key={h.line} className={h.level===3?"ml-4":""}><a className="text-primary" href={`#${ids.get(h.line)}`}>{h.title}</a></li>)}</ol></nav>:null;
 return {outline,components};
}
