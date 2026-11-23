import { useEffect, useRef, useState } from "react";
import { backend } from "../lib/backend";

export function useLocalPreference<T>(key:string, initial:()=>T, parse:(value:unknown)=>T) {
  const [value,setValue]=useState(initial);
  const [ready,setReady]=useState(false);
  const [error,setError]=useState("");
  const revision=useRef(0); const busy=useRef(false); const parser=useRef(parse); parser.current=parse;
  useEffect(()=>{
    let gone=false;
    const changed=(event:Event)=>{
      const detail=(event as CustomEvent<{key:string;result:{revision:number;value:unknown}}>).detail;
      if(detail?.key!==key||detail.result.revision<revision.current)return;
      revision.current=detail.result.revision;setValue(parser.current(detail.result.value));setError('');
    };
    window.addEventListener('askill-preference-saved',changed);
    void backend.preference(key).then(async result=>{
      if(gone) return;
      if(result.value===null) {
        try { result=await backend.savePreference(key,initial(),result.revision); }
        catch(error) {
          // 多面板首次挂载可能同时迁移，重新读取已成功写入的版本。
          const latest=await backend.preference(key);
          if(latest.value===null)throw error;
          result=latest;
        }
      }
      if(!gone) {revision.current=result.revision;setValue(parser.current(result.value));setReady(true);}
    }).catch(()=>{if(!gone)setError("本地设置未读取，请刷新后重试；现有设置不会被覆盖。");});
    return ()=>{gone=true;window.removeEventListener('askill-preference-saved',changed);};
  },[key]);
  const save=async(next:T)=>{
    if(!ready||busy.current) return false;
    busy.current=true;
    try {const result=await backend.savePreference(key,next,revision.current);revision.current=result.revision;setValue(parser.current(result.value));setError("");window.dispatchEvent(new CustomEvent('askill-preference-saved',{detail:{key,result}}));return true;}
    catch {setError("设置未保存，可能已在其他窗口更新；请刷新后重试。");return false;}
    finally {busy.current=false;}
  };
  return {value,save,ready,error};
}
