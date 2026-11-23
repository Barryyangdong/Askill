import { useState, useRef, useEffect } from "react";
import { Palette, Check } from "lucide-react";
import { THEMES, useTheme, type ThemeId } from "@/hooks/useTheme";

/** 主题切换入口：顶栏右侧，点开四个主题色块 */
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        aria-label="切换主题"
        aria-expanded={open}
        aria-haspopup="true"
        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Palette className="h-4 w-4" />
      </button>
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-lg border border-border bg-card shadow-lg"
          style={{ boxShadow: "var(--shadow-pop)" }}
          role="menu"
          aria-label="选择主题"
        >
          <div className="p-2">
            <div className="mb-2 px-2 py-1 text-xs font-medium text-muted-foreground">选择主题</div>
            {THEMES.map((t) => {
              const active = theme === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setTheme(t.id as ThemeId);
                    setOpen(false);
                  }}
                  role="menuitemradio"
                  aria-checked={active}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                >
                  <div className="flex gap-1">
                    {t.swatch.map((color, i) => (
                      <div
                        key={i}
                        className="h-5 w-5 rounded border border-border/60"
                        style={{ backgroundColor: color }}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground">{t.label}</div>
                    <div className="text-xs text-muted-foreground">{t.hint}</div>
                  </div>
                  {active && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
