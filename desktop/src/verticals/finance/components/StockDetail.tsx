import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StockPreview } from './StockPreview';

/** Stable detail surface shared by market lists; floating is an explicit choice. */
export function StockDetail({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  const [floating,setFloating]=useState(false);
  const panel=useRef<HTMLElement>(null);
  const close=useRef(onClose); close.current=onClose;
  useEffect(()=>{
    if(floating)return;
    const opener=document.activeElement as HTMLElement|null;
    const narrow=window.matchMedia('(max-width: 1100px)');
    const focus=()=>{if(narrow.matches)panel.current?.querySelector<HTMLButtonElement>('button')?.focus();};
    focus();narrow.addEventListener('change',focus);
    const keyboard=(event:KeyboardEvent)=>{
      if(!narrow.matches||event.defaultPrevented)return;
      if(event.key==='Escape'){event.preventDefault();close.current();}
      if(event.key==='Tab'){
        const elements=[...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')??[])].filter(el=>el.getClientRects().length);
        const first=elements[0],last=elements.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown',keyboard);
    return()=>{narrow.removeEventListener('change',focus);document.removeEventListener('keydown',keyboard);if(opener?.isConnected)opener.focus();};
  },[floating]);
  if(floating)return <StockPreview title={title} onClose={()=>setFloating(false)}>
    <button type="button" className="m-3 rounded border border-border px-3 py-2 text-xs" onClick={()=>setFloating(false)}>返回分栏</button>{children}
  </StockPreview>;
  return <section ref={panel} className="stock-detail" aria-label={`${title} 个股详情`}>
    <header className="stock-detail-heading"><strong className="min-w-0 truncate" aria-live="polite">{title}</strong><div className="flex shrink-0 gap-2">
      <button type="button" onClick={()=>setFloating(true)}>弹出查看</button><button type="button" onClick={onClose}>返回列表</button>
    </div></header>
    <div className="stock-detail-content">{children}</div>
  </section>;
}
