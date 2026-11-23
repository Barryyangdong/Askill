import { NAV_SECTIONS } from "./nav.ts";

const descriptions: Record<string, string> = {
  '/watch': '查看行情池、盘中异动与竞价表现',
  '/shortline': '梳理情绪、梯队和题材变化',
  '/player-analysis': '按比赛对照选手收益、仓位和共同持股',
  '/modes': '定义观察条件，再用历史数据验证',
  '/my-stocks': '管理自选、持仓和自己的交易记录',
};

/** Keep home shortcuts aligned with sidebar routes. */
export const HOME_FEATURE_GROUPS = NAV_SECTIONS.filter(s => !s.pinned && s.pages[0]?.to !== "/").map(s => ({
  title: s.label,
  detail: s.label,
  features: s.pages.map(p => ({ to: p.to, title: p.label, detail: descriptions[p.to] ?? p.label })),
}));
