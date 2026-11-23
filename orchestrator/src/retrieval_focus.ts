/** Expand only declared vocabulary; untrusted prose never supplies URLs or tool arguments. */
export function retrievalFocus(text:string,policy:{keywords:readonly string[];expansions?:Readonly<Record<string,readonly string[]>>}):string[]{
  const groups=policy.keywords.map((key,index)=>{
    const terms=[key,...(policy.expansions?.[key]??[])].filter(t=>t.length>=2&&t.length<=60);
    return {terms,index,hits:terms.filter(t=>text.includes(t)).length};
  }).filter(g=>g.hits>0).sort((a,b)=>b.hits-a.hits||a.index-b.index).slice(0,3);
  return [...new Set(groups.flatMap(g=>g.terms))].slice(0,12);
}
