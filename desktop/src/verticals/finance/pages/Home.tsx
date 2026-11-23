import { MonitorStatus } from "../components/MonitorStatus";
import { HomeTasks } from "@/components/HomeTasks";
import { WorkspaceLayout } from "@/components/WorkspaceLayout";
import { WorkspaceFocus } from "@/components/WorkspaceFocus";
import { WorkspaceLink as Link } from "@/components/WorkspaceLink";
import { ArrowUpRight } from "lucide-react";
import { lazy, Suspense } from "react";
const FinanceHomeAgent = lazy(() => import("@/components/ui/FinanceAiDock").then(m => ({ default: m.FinanceHomeAgent })));
import { Disclaimer } from "@/components/ui/Disclaimer";
import { HomeDashboard } from "@/components/HomeDashboard";
import { HOME_FEATURE_GROUPS } from "@/lib/homeFeatures";
import { PageHeader } from "@/components/ui/PageHeader";
import { PRODUCT_NAME } from "@/lib/brand";

/**
 * 首页：指数 → 我的自选 / 我的持仓 → 对话 → 各栏目入口。
 * 先看自己的股票怎么样，再问问题（Simon 2026-10-09 定）。首页自己就是对话，不显示「问 Agent」浮窗，也不登记页面上下文。
 */
export function Home() {
  return (
    <div>
      <h1 className="sr-only">{PRODUCT_NAME} 研究工作台</h1>
      <PageHeader title="今日" subtitle="市场与我的股票" />
      <MonitorStatus />
      <WorkspaceLayout widgets={{ focus: <WorkspaceFocus />, tasks: <HomeTasks />, market: <HomeDashboard />, features: <section id="home-features" className="mt-5" aria-labelledby="feature-heading">
        <div className="mb-3 flex items-end justify-between gap-4">
          <h2 id="feature-heading" className="text-sm font-medium">工作台</h2>
          <span className="text-xs text-muted-foreground">常用功能</span>
        </div>
        <div data-feature-grid className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {HOME_FEATURE_GROUPS.map((group) => (
            <div key={group.title} data-feature-category className="glass min-w-0 p-3">
              <div className="mb-2 flex items-center gap-2 border-b border-primary/15 pb-2">
                <h3 className="text-[13px] font-semibold">{group.title}</h3>
              </div>
              <div className="grid gap-1.5">
                {group.features.map(({ to, title, detail }) => (
                  <Link key={to} to={to} title={detail} className="group flex min-h-10 items-center gap-2 rounded border border-transparent bg-transparent px-2.5 py-2 transition-colors hover:border-primary/40 hover:bg-primary/[0.06]">
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium group-hover:text-primary">{title}</span>{detail !== title && <span className="mt-1 block text-xs leading-5 text-muted-foreground">{detail}</span>}</span>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>, assistant: <div className="mt-5"><Suspense fallback={<p role="status" className="text-xs text-muted-foreground">正在打开研究助手…</p>}><FinanceHomeAgent /></Suspense></div> }} />
      <Disclaimer />
    </div>
  );
}
