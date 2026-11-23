import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PageTab<T extends string> { key: T; label: string; icon?: LucideIcon; badge?: ReactNode }

/** 页面内分段切换控件（自选/持仓、概览/深度…），和二级导航用同一套 .workspace-tabs 样式。 */
export function PageTabs<T extends string>({ value, options, onChange, label, className }: {
  value: T; options: PageTab<T>[]; onChange: (v: T) => void; label: string; className?: string; primaryKeys?: T[];
}) {
  return (
    <div role="group" aria-label={label} className={cn("workspace-tabs mb-4", className)}>
      {options.map(({ key, label: text, icon: Icon, badge }) => (
        <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}
          className="inline-flex items-center gap-1.5">
          {Icon && <Icon className="h-3.5 w-3.5" />}{text}{badge}
        </button>
      ))}
    </div>
  );
}
