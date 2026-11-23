/** Askill navigation: daily workflow first; existing route URLs stay compatible. */
export const NAV_ICONS = [
  "Home", "Swords", "Activity", "Flame", "Zap", "Gavel", "Radar", "Thermometer", "LayoutGrid", "CandlestickChart",
  "FlaskConical", "ListFilter", "Star", "Wallet", "CalendarDays", "Bell", "Library", "FileText", "NotebookPen", "Settings", "BookOpenCheck",
  "Sparkles", "History", "ClipboardCheck", "UsersRound",
  // 各板块（sectors.json 的 icon 字段）
  "Bot", "Cpu", "MemoryStick", "Cable", "CircuitBoard", "Microchip", "BatteryFull", "Plane", "Car", "Pill",
  "UtilityPole", "Shield", "Atom", "Rocket", "Dna", "Pickaxe", "BrainCircuit", "Glasses", "BatteryCharging", "Database",
] as const;
export type NavIcon = (typeof NAV_ICONS)[number];
export const isNavIcon = (x: unknown): x is NavIcon => typeof x === "string" && (NAV_ICONS as readonly string[]).includes(x);

export interface NavPage { to: string; label: string; icon: NavIcon; activePaths?: readonly string[] }
export interface NavSection {
  /** 一级栏目名；同时是展开状态的存储键的一部分 */
  label: string;
  icon: NavIcon;
  pages: NavPage[];
  related?: NavPage[];
  /** 一级文字进的总览页，不在二级里列（产业研究：点它看全部板块一览，二级直接是各板块） */
  overview?: NavPage;
  /** 二级在 pages 之后接着列各板块（产业研究） */
  listsSectors?: true;
  /** 固定在侧栏底部（接入 AI） */
  pinned?: true;
}

const page=(to:string,label:string,icon:NavIcon):NavPage=>({to,label,icon});
export const NAV_SECTIONS: NavSection[] = [
  { label: '盯盘', icon: 'Zap', pages: [
    page('/watch','市场动态','Activity'), page('/watch/intraday','竞价与盘中','Gavel'),
    page('/workbench','个股行情','CandlestickChart'), page('/intel','市场资讯','Radar'),
  ], related: [page('/','市场动态','Activity'), page('/watch/market','市场快照','Activity')] },
  { label: '复盘', icon: 'Flame', pages: [
    { ...page('/shortline','盘面','Flame'), activePaths: ['/daily-review'] },
    page('/shortline/themes','题材','LayoutGrid'),
    { ...page('/shortline/review','AI 解读','Sparkles'), activePaths: ['/shortline/market-report', '/shortline/weekreview'] },
    { ...page('/shortline/weekly','历史与统计','History'), activePaths: ['/shortline/history', '/shortline/samples', '/shortline/structure'] },
    page('/shortline/verify','次日验证','ClipboardCheck'),
  ] },
  { label: '选手分析', icon: 'UsersRound', pages: [page('/player-analysis','选手分析','UsersRound')] },
  { label: '研究', icon: 'FlaskConical', pages: [
    page('/research','个股研究','CandlestickChart'), page('/sectors','题材研究','LayoutGrid'),
    page('/modes','模式研究','FlaskConical'), page('/backtest','历史验证','Activity'),
    page('/observations','观察计划','ListFilter'), page('/my-reports','研报资料','FileText'),
    page('/notes','研究记录','NotebookPen'),
  ], related: [page('/debate','多空观点','Swords'), page('/signals','产业信号','Thermometer'), page('/candidates','候选筛选','ListFilter')] },
  { label: '游资蒸馏', icon: 'BookOpenCheck', pages: [page('/distillation','游资研判','BookOpenCheck')] },
  { label: '我的', icon: 'Star', pages: [
    page('/my-stocks','自选与持仓','Star'), page('/journal','交易日志','Wallet'),
    page('/calendar','事件日历','CalendarDays'), page('/companion','随身看板','LayoutGrid'),
  ] },
  { label: '设置', icon: 'Settings', pages: [page('/settings','设置','Settings')], pinned: true },
];

/** 有二级栏目的一级（展开 / 收起、收起侧栏时弹出二级） */
export const isGroup = (s: NavSection) => s.pages.length > 1 || !!s.listsSectors;

/** 一级文字点进去的页面：有总览页进总览，否则进第一个二级 */
export const sectionHome = (s: NavSection) => (s.overview ?? s.pages[0]!).to;
/** 一级栏目下所有能认出来的页面（总览页 + 二级） */
export const sectionPages = (s: NavSection) => [...(s.overview ? [s.overview, ...s.pages] : s.pages), ...(s.related??[])];

/** 侧栏里一个板块：地址里的 key、名字、图标（sectors.json 里写的；不认识的名字用格子图标） */
export interface SectorLink { key: string; label: string; icon?: string }

/** 把各板块按名单顺序接到产业研究的二级里；其他栏目原样返回 */
export function withSectors(sections: NavSection[], sectors: readonly SectorLink[]): NavSection[] {
  return sections.map((s) => s.listsSectors
    ? { ...s, pages: [...s.pages, ...sectors.map((x): NavPage => ({ to: `/sectors/${x.key}`, label: x.label, icon: isNavIcon(x.icon) ? x.icon : "LayoutGrid" }))] }
    : s);
}

/**
 * 这个地址属于哪个页面：本身或它下面的子路径（/intel/news 算资讯雷达）。首页只认 "/" 本身。
 * 几个都对得上时取地址最长的那个：接了板块以后 /sectors/humanoid 算「人形机器人」，不算产业研究总览。
 */
export function navPageOf(pathname: string, sections: NavSection[] = NAV_SECTIONS): { section: NavSection; page: NavPage } | null {
  let best: { section: NavSection; page: NavPage } | null = null;
  let bestLength = 0;
  for (const section of sections) {
    for (const page of sectionPages(section)) {
      for (const path of [page.to, ...(page.activePaths ?? [])]) {
        if (path.length > bestLength && (pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)))) {
          best = { section, page };
          bestLength = path.length;
        }
      }
    }
  }
  return best;
}

/** 顶栏显示的当前位置 */
export const navTitle = (pathname: string, sections: NavSection[] = NAV_SECTIONS) => navPageOf(pathname, sections)?.page.label ?? "工作空间";

/** 搬了家的旧地址跳去哪：原来的查询参数和锚点照带（如 `?symbol=`），再切到新页面里对应的分页（覆盖原来的 tab）。 */
export function movedUrl(to: string, search: string, hash: string, tab?: string): string {
  const q = new URLSearchParams(search);
  if (tab) q.set("tab", tab);
  const s = q.toString();
  return `${to}${s ? `?${s}` : ""}${hash}`;
}
