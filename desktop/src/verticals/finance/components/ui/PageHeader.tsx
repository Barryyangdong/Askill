import { type ReactNode } from "react";


interface Props {
  title: string;
  subtitle?: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, description, actions }: Props) {
  return (
    <header className="page-header mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3"><h1 className="workspace-title">{title}</h1>

        </div>
        {description && <p className="page-description mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">{description}</p>}
        {subtitle && <p className="mt-1 max-w-4xl text-[12.5px] leading-5 text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="page-header-actions flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
