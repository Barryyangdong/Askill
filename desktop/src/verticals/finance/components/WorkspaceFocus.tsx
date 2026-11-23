import { useState } from "react";
import { WorkspaceLink as Link } from "@/components/WorkspaceLink";
import { storageGet, storageSet } from "@/lib/storage";
import { PageTabs } from "@/components/ui/PageTabs";

const MODES = [
  { key: "prepare", label: "盘前", links: [
    { to: "/shortline/verify", title: "观察条件", detail: "查看上次计划与验证" },
    { to: "/calendar", title: "事件日历", detail: "关注对象的日程" },
    { to: "/watch/intraday", title: "竞价与盘中", detail: "查看已记录快照" },
  ] },
  { key: "watch", label: "盘中", links: [
    { to: "/watch", title: "行情与异动", detail: "进入上次查看的行情池" },
    { to: "/candidates", title: "条件筛选", detail: "载入方案核对最新读数" },
    { to: "/inbox", title: "提醒收件箱", detail: "查看真实提醒记录" },
  ] },
  { key: "review", label: "盘后", links: [
    { to: "/shortline", title: "情绪复盘", detail: "市场事实与题材结构" },
    { to: "/shortline/history", title: "历史对照", detail: "多图查看读数变化" },
    { to: "/journal", title: "交易日志", detail: "核对自己的交易记录" },
  ] },
] as const;

export function WorkspaceFocus() {
  const [mode, setMode] = useState(() => storageGet("Askill-home-focus") ?? "watch");
  const current = MODES.find(m => m.key === mode) ?? MODES[1];
  return <section aria-label="工作场景" className="mb-5 rounded border border-border px-4 pt-3 pb-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-medium">工作场景</h2>
      <Link to="/companion" className="text-xs text-primary">随身看板 →</Link>
    </div>
    <PageTabs label="工作场景选择" options={MODES.map(({ key, label }) => ({ key, label }))} value={current.key}
      onChange={next => { setMode(next); storageSet("Askill-home-focus", next); }} />
    <div className="grid gap-2 sm:grid-cols-3">{current.links.map(link => <Link key={link.to} to={link.to}
      className="rounded border border-border px-3 py-3 hover:border-primary/50 hover:bg-primary/5">
      <span className="block text-sm font-medium">{link.title}<span aria-hidden className="float-right text-muted-foreground">↗</span></span>
      <span className="mt-1 block text-xs text-muted-foreground">{link.detail}</span>
    </Link>)}</div>
  </section>;
}
