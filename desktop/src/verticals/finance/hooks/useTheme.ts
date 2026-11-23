import { useCallback, useLayoutEffect, useState } from "react";

import { storageGet, storageSet } from "@/lib/storage";

/** 四套主题。顺序即切换面板里的显示顺序。A 股约定：涨用红（danger），跌用绿（success），四套主题都一样。 */
export const THEMES = [
  { id: "dark", label: "深色", hint: "夜间看盘，默认", swatch: ["#0B0F17", "#131A26", "#4C8DFF", "#F0474C"] },
  { id: "light", label: "浅色", hint: "白天明亮，层次清楚", swatch: ["#F4F6FA", "#FFFFFF", "#2F6BFF", "#E5484D"] },
  { id: "tonghuashun", label: "同花顺红", hint: "红色系，行情软件风格", swatch: ["#F3F3F5", "#FFFFFF", "#D92B2B", "#1E9E5A"] },
  { id: "original", label: "午夜量化", hint: "自有风格，青绿强调", swatch: ["#070B12", "#0F1620", "#2DD4BF", "#F05252"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const KEY = "askill-theme";
/** 带 dark: 前缀的 Tailwind 样式（如 prose-invert）只在这些主题下生效 */
const DARK_THEMES = new Set<ThemeId>(["dark", "original"]);

function readTheme(): ThemeId {
  const saved = storageGet(KEY) as string | null;
  if (THEMES.some((t) => t.id === saved)) return saved as ThemeId;
  // 老版本只存了 vr-theme（dark / light），沿用它
  return storageGet("vr-theme") === "light" ? "light" : "dark";
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(readTheme);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.toggle("dark", DARK_THEMES.has(theme));
    root.classList.toggle("light", !DARK_THEMES.has(theme));
    storageSet(KEY, theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeId) => setThemeState(next), []);
  return { theme, setTheme };
}
