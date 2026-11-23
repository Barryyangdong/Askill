import type { ReactNode } from "react";

/** Secondary guidance stays accessible on keyboard and touch; data warnings remain inline. */
export function ContextHelp({ children, label = "说明" }: { children: ReactNode; label?: string }) {
  return <details className="context-help">
    <summary>{label}</summary>
    <div className="context-help-body">{children}</div>
  </details>;
}
