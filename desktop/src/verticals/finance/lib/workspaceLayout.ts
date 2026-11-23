export const HOME_WIDGETS = ["market", "tasks", "focus", "features", "assistant"] as const;
export type HomeWidget = typeof HOME_WIDGETS[number];
export interface WorkspaceLayout { order: HomeWidget[]; hidden: HomeWidget[] }
export const defaultLayout = (): WorkspaceLayout => ({ order: [...HOME_WIDGETS], hidden: [] });
export function parseLayout(raw: string | null): WorkspaceLayout {
  try {
    const value = JSON.parse(raw ?? "null");
    const valid = (x: unknown): x is HomeWidget => HOME_WIDGETS.includes(x as HomeWidget);
    const order: HomeWidget[] = Array.isArray(value?.order) ? [...new Set<HomeWidget>(value.order.filter(valid))] : [];
    const hidden: HomeWidget[] = Array.isArray(value?.hidden) ? [...new Set<HomeWidget>(value.hidden.filter(valid))] : [];
    return { order: [...order, ...HOME_WIDGETS.filter(x => !order.includes(x))], hidden };
  } catch { return defaultLayout(); }
}
export function moveWidget(layout: WorkspaceLayout, from: HomeWidget, to: HomeWidget): WorkspaceLayout {
  const order = [...layout.order], a = order.indexOf(from), b = order.indexOf(to);
  if (a < 0 || b < 0 || a === b) return layout;
  order.splice(a, 1); order.splice(b, 0, from);
  return { ...layout, order };
}
export const LAYOUT_PRESETS: Record<string, WorkspaceLayout> = {
  "综合": defaultLayout(),
  "盯盘": { order: ["market", "tasks", "focus", "features", "assistant"], hidden: ["assistant"] },
  "研究": { order: ["tasks", "assistant", "market", "focus", "features"], hidden: ["features"] },
};
