import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';

type Geometry = { x: number; y: number; width: number; height: number };
let remembered: Geometry | null = null;
export function fitPreview(g: Geometry, width: number, height: number): Geometry {
  const w = Math.min(Math.max(320, g.width), Math.max(0, width - 16));
  const h = Math.min(Math.max(240, g.height), Math.max(0, height - 16));
  return { width: w, height: h, x: Math.max(8, Math.min(g.x, width - w - 8)), y: Math.max(8, Math.min(g.y, height - h - 8)) };
}

/** Non-modal: keep the source list usable while comparing successive stocks. */
export function StockPreview({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const opener = useRef(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  const initial = () => {
    const width = window.innerWidth, height = window.innerHeight;
    const anchor = opener.current?.getBoundingClientRect();
    return fitPreview(remembered ?? { x: anchor && anchor.width ? anchor.right + 16 : (width - 720) / 2, y: anchor && anchor.height ? anchor.top - 40 : (height - 540) / 2, width: 720, height: 540 }, width, height);
  };
  const [geometry, setGeometry] = useState<Geometry | null>(() => typeof window === 'undefined' ? null : initial());
  const drag = useRef<{ x: number; y: number; g: Geometry; resize: boolean } | null>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const close = () => { closeRef.current(); if (opener.current?.isConnected) opener.current.focus(); };
  useEffect(() => {
    const resize = () => setGeometry(g => g && fitPreview(g, window.innerWidth, window.innerHeight));
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close(); } };
    window.addEventListener('resize', resize); document.addEventListener('keydown', key);
    return () => { window.removeEventListener('resize', resize); document.removeEventListener('keydown', key); };
  }, []);
  const update = (g: Geometry) => { const next = fitPreview(g, window.innerWidth, window.innerHeight); remembered = next; setGeometry(next); };
  const start = (e: PointerEvent<HTMLButtonElement>, resize: boolean) => {
    if (e.button !== 0 || !geometry) return;
    e.currentTarget.setPointerCapture(e.pointerId); drag.current = {x: e.clientX, y: e.clientY, g: geometry, resize};
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    update(d.resize ? {...d.g, width: Math.min(d.g.width + dx, window.innerWidth - d.g.x - 8), height: Math.min(d.g.height + dy, window.innerHeight - d.g.y - 8)} : {...d.g, x: d.g.x + dx, y: d.g.y + dy});
  };
  if (!geometry || typeof document === 'undefined') return null;
  const pointer = {onPointerMove: move, onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; }, onLostPointerCapture: () => { drag.current = null; }};
  return createPortal(<section role="region" aria-label={`${title} · 走势预览`} className="stock-preview-window" style={{left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height}}>
    <header className="stock-preview-header">
      <button type="button" className="stock-preview-drag" aria-label="移动走势窗口，方向键移动" onPointerDown={e => start(e, false)} {...pointer} onKeyDown={e => {
        const steps: Record<string, number[]> = {ArrowLeft: [-20,0], ArrowRight: [20,0], ArrowUp: [0,-20], ArrowDown: [0,20]};
        const delta = steps[e.key]; if (delta) { e.preventDefault(); update({...geometry, x: geometry.x + delta[0]!, y: geometry.y + delta[1]!}); }
      }}><span aria-hidden="true">⠿</span> {title} · 走势预览</button>
      <button type="button" onClick={() => { remembered = null; update(fitPreview({x:(window.innerWidth-720)/2,y:(window.innerHeight-540)/2,width:720,height:540},window.innerWidth,window.innerHeight)); }}>居中复位</button>
      <button type="button" onClick={close}>关闭</button>
    </header>
    <div className="stock-preview-body">{children}</div>
    <button type="button" className="stock-preview-resize" aria-label="调整走势窗口大小，方向键调整" onPointerDown={e => start(e, true)} {...pointer} onKeyDown={e => {
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
      e.preventDefault(); update({...geometry,width:geometry.width+(e.key==='ArrowRight'?20:e.key==='ArrowLeft'?-20:0),height:geometry.height+(e.key==='ArrowDown'?20:e.key==='ArrowUp'?-20:0)});
    }}>◢</button>
  </section>, document.body);
}
