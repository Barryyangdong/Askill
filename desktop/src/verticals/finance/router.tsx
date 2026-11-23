import { workspaceRoute } from "@/lib/workspaceRoutes";
import { createBrowserRouter, Navigate, useLocation } from "react-router-dom";
import { RouteErrorPage } from "../../core/components/RouteErrorPage";
import { Layout } from "@/components/layout/Layout";
import { movedUrl } from "@/lib/nav";

/** 搬了家的旧地址（收藏的书签、旧提醒里的链接）：带着原来的查询参数跳到新页面 */
function Moved({ to, tab }: { to: string; tab?: string }) {
  const { search, hash, state } = useLocation();
  return <Navigate replace state={state} to={movedUrl(to, search, hash, tab)} />;
}

export const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <p role="status" className="p-6 text-sm text-muted-foreground">正在打开研究工作台…</p>,
    children: [
      { path: workspaceRoute("/"), element: <Moved to="/watch" /> },
      { path: workspaceRoute("/tasks"), lazy: async () => ({ Component: (await import("@/pages/Tasks")).Tasks }) },
      { path: workspaceRoute("/companion"), lazy: async () => ({ Component: (await import("@/pages/Companion")).Companion }) },
      { path: workspaceRoute("/distillation"), lazy: async () => ({ Component: (await import("@/pages/Distillation")).Distillation }) },
      { path: workspaceRoute("/player-analysis"), lazy: async () => ({ Component: (await import("@/pages/PlayerAnalysis")).PlayerAnalysis }) },
      { path: workspaceRoute("/modes"), lazy: async () => ({ Component: (await import("@/pages/ModeStudio")).ModeStudio }) },
      { path: workspaceRoute("/workbench"), lazy: async () => ({ Component: (await import("@/pages/Workbench")).Workbench }) },
      { path: workspaceRoute("/observations"), lazy: async () => ({ Component: (await import("@/pages/Observations")).Observations }) },
      { path: workspaceRoute("/watch"), lazy: async () => ({ Component: (await import("@/pages/Watch")).Watch }) },
      // 竞价与盘中在侧栏里是单独一项,地址写死(不用 :tab),侧栏和首页目录都认得出它
      { path: workspaceRoute("/watch/intraday"), lazy: async () => ({ Component: (await import("@/pages/Watch")).Watch }) },
      { path: workspaceRoute("/watch/market"), lazy: async () => ({ Component: (await import("@/pages/DailyReview")).DailyReview }) },
      { path: workspaceRoute("/shortline"), lazy: async () => ({ Component: (await import("@/pages/Shortline")).Shortline }) },
      { path: workspaceRoute("/shortline/:tab"), lazy: async () => ({ Component: (await import("@/pages/Shortline")).Shortline }) },
      { path: workspaceRoute("/journal"), lazy: async () => ({ Component: (await import("@/pages/Journal")).Journal }) },
      { path: workspaceRoute("/journal/:tab"), lazy: async () => ({ Component: (await import("@/pages/Journal")).Journal }) },
      { path: workspaceRoute("/daily-review"), element: <Moved to="/shortline" /> },
      { path: workspaceRoute("/intel"), lazy: async () => ({ Component: (await import("@/pages/Intel")).Intel }) },
      { path: workspaceRoute("/intel/:tab"), lazy: async () => ({ Component: (await import("@/pages/Intel")).Intel }) },
      { path: workspaceRoute("/signals"), lazy: async () => ({ Component: (await import("@/pages/Signals")).Signals }) },
      { path: workspaceRoute("/signals/:tab"), lazy: async () => ({ Component: (await import("@/pages/Signals")).Signals }) },
      { path: workspaceRoute("/sectors"), lazy: async () => ({ Component: (await import("@/pages/Sectors")).Sectors }) },
      { path: workspaceRoute("/sectors/:key"), lazy: async () => ({ Component: (await import("@/pages/SectorDetail")).SectorDetail }) },
      { path: workspaceRoute("/candidates"), lazy: async () => ({ Component: (await import("@/pages/Candidates")).Candidates }) },
      { path: workspaceRoute("/my-stocks"), lazy: async () => ({ Component: (await import("@/pages/MyStocks")).MyStocks }) },
      { path: workspaceRoute("/calendar"), lazy: async () => ({ Component: (await import("@/pages/Calendar")).Calendar }) },
      { path: workspaceRoute("/backtest"), lazy: async () => ({ Component: (await import("@/pages/Backtest")).Backtest }) },
      { path: workspaceRoute("/research"), lazy: async () => ({ Component: (await import("@/pages/Research")).Research }) },
      { path: workspaceRoute("/debate"), lazy: async () => ({ Component: (await import("@/pages/Debate")).DebatePage }) },
      { path: workspaceRoute("/my-reports"), lazy: async () => ({ Component: (await import("@/pages/MyReports")).MyReports }) },
      { path: workspaceRoute("/notes"), lazy: async () => ({ Component: (await import("@/pages/Notes")).Notes }) },
      { path: workspaceRoute("/inbox"), lazy: async () => ({ Component: (await import("@/pages/Inbox")).Inbox }) },
      { path: workspaceRoute("/settings"), lazy: async () => ({ Component: (await import("@/pages/Settings")).Settings }) },
      // 旧地址保留兼容（收藏的书签、旧提醒里的链接）：自选和持仓并成「自选与持仓」。
      // 多空辩论 10-09 又回到单独一页（/debate）；个股页旧的 ?tab=debate 由个股页自己跳过去。
      { path: workspaceRoute("/stock-data"), element: <Moved to="/research" /> },
      { path: workspaceRoute("/watchlist"), element: <Moved to="/my-stocks" tab="watch" /> },
      { path: workspaceRoute("/portfolio"), element: <Moved to="/my-stocks" tab="hold" /> },
    ],
  },
]);
