// 兼容层：旧版只有深浅两态，现在扩展成四主题。
// 老代码里的 useDarkMode 仍可用，但实际走 useTheme。
import { useTheme } from "./useTheme";

export function useDarkMode() {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark" || theme === "original";
  const toggle = () => setTheme(dark ? "light" : "dark");
  return { dark, toggle };
}
