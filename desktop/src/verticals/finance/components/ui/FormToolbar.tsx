import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Controls share a label track; feedback remains below its own control. */
export function FormToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("form-toolbar", className)}>{children}</div>;
}

export function FormField({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return <div className={cn("form-toolbar-field", className)}>
    <div className="form-toolbar-label" title={typeof label === "string" ? label : undefined}>{label}</div>
    <div className="form-toolbar-control">{children}</div>
  </div>;
}

export function FormActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("form-toolbar-field form-toolbar-actions", className)}>
    <div className="form-toolbar-label" aria-hidden="true" />
    <div className="form-toolbar-control">{children}</div>
  </div>;
}
