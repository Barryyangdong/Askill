/** Component-free contract shared by the actual router and safe workspace navigation. */
export const WORKSPACE_PATHS = ["/", "/tasks", "/companion", "/distillation", "/player-analysis", "/modes", "/workbench", "/observations", "/watch", "/watch/intraday", "/watch/market", "/shortline", "/shortline/:tab", "/journal", "/journal/:tab", "/daily-review", "/intel", "/intel/:tab", "/signals", "/signals/:tab", "/sectors", "/sectors/:key", "/candidates", "/my-stocks", "/calendar", "/backtest", "/research", "/debate", "/my-reports", "/notes", "/inbox", "/settings", "/stock-data", "/watchlist", "/portfolio"] as const;
export type WorkspacePath = (typeof WORKSPACE_PATHS)[number];
export const workspaceRoute = (path: WorkspacePath): WorkspacePath => path;
export function isWorkspacePath(path: string): boolean {
 if(!path.startsWith('/')||path.includes('\\')||/%(?:2f|5c)/i.test(path))return false;
 const parts=path.replace(/\/$/,'').split('/');
 return WORKSPACE_PATHS.some(pattern=>{
  const expected=pattern.replace(/\/$/,'').split('/');
  return parts.length===expected.length&&expected.every((part,i)=>part.startsWith(':')? /^[A-Za-z0-9_-]+$/.test(parts[i]!):part===parts[i]);
 });
}
export const WORKSPACE_ALIASES: Record<string,{path:string;tab?:string}> = {
 '/':{path:'/watch'}, '/daily-review':{path:'/shortline'}, '/stock-data':{path:'/research'},
 '/watchlist':{path:'/my-stocks',tab:'watch'}, '/portfolio':{path:'/my-stocks',tab:'hold'},
};
