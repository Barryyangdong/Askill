import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones = {
  neutral: "border-border/70 bg-muted/35 text-muted-foreground",
  blue: "border-primary/25 bg-primary/10 text-primary",
  gold: "border-warning/30 bg-warning/10 text-warning",
};

export function ReviewBadge({ children, tone = "neutral", title }: {
  children: ReactNode; tone?: keyof typeof tones; title?: string;
}) {
  return <span title={title} className={cn(
    "inline-flex max-w-full items-baseline gap-1 rounded-md border px-2 py-0.5 text-xs leading-4",
    tones[tone],
  )}>{children}</span>;
}

export function BoardBadge({ boards, plus, count }: { boards: number; plus?: boolean; count?: number }) {
  return <ReviewBadge tone={boards >= 4 ? "gold" : boards > 1 ? "blue" : "neutral"}>
    <span className="font-semibold">{boards === 1 ? "首板" : `${boards} 板${plus ? "及以上" : ""}`}</span>
    {count !== undefined && <span className="tabular-nums">· {count} 只</span>}
  </ReviewBadge>;
}
