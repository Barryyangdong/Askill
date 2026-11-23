import {useEffect,useMemo,useRef} from 'react';

export function reportPages(text:string):{page:string|null;text:string}[]{
 const markers=[...text.matchAll(/^--- 第 (\d+) 页 ---\s*$/gm)];
 if(!markers.length)return [{page:null,text}];
 const pages:{page:string|null;text:string}[]=[];
 if(markers[0]!.index!>0)pages.push({page:null,text:text.slice(0,markers[0]!.index)});
 markers.forEach((match,i)=>pages.push({page:match[1]!,text:text.slice(match.index!+match[0].length,markers[i+1]?.index??text.length).trim()}));
 return pages;
}
export function ReportText({text,page}:{text:string;page?:string|null}){
 const pages=useMemo(()=>reportPages(text),[text]);
 const root=useRef<HTMLDivElement>(null);
 const jump=(target:string)=>{const section=[...(root.current?.querySelectorAll<HTMLElement>('[data-report-page]')??[])].find(el=>el.dataset.reportPage===target);section?.scrollIntoView({block:'start'});section?.focus({preventScroll:true});};
 useEffect(()=>{if(page)jump(page);},[page,text]);
 return <div>
  {pages.some(p=>p.page)&&<label className="mb-3 flex items-center gap-2 text-xs">定位页码<select aria-label="定位资料页码" className="rounded border border-border bg-background px-2 py-2" defaultValue={pages.some(p=>p.page===page)?page!:'start'} onChange={e=>{if(e.target.value==='start')root.current?.scrollTo({top:0});else jump(e.target.value);}}><option value="start">正文开头</option>{pages.filter(p=>p.page).map(p=><option key={p.page} value={p.page!}>第 {p.page} 页</option>)}</select></label>}
  {page&&!pages.some(p=>p.page===page)&&<p role="status" className="mb-3 text-xs text-warning">预览中没有第 {page} 页标记，请下载原文件核对。</p>}
  <div ref={root} className="max-h-[60vh] overflow-auto" aria-label="资料正文">{pages.map((p,i)=><section key={i} data-report-page={p.page??'start'} tabIndex={-1} className="mb-5 scroll-mt-2">{p.page&&<h3 className="mb-2 border-b border-border pb-2 text-xs text-muted-foreground">第 {p.page} 页</h3>}<pre className="whitespace-pre-wrap break-words text-sm">{p.text}</pre></section>)}</div>
 </div>;
}
