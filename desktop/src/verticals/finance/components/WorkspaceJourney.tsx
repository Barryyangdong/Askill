import { Link, useLocation } from 'react-router-dom';
import { navPageOf } from '../lib/nav';
import { workspaceReturn, sameWorkspaceLocation } from '../lib/workspaceJourney';

export function WorkspaceJourney(_props: {date?: string | null} = {}) {
  const {pathname, search, hash} = useLocation();
  const back = workspaceReturn(new URLSearchParams(search).get('returnTo'));
  if (!back || sameWorkspaceLocation(back, pathname + search + hash)) return null;
  const path = back.split(/[?#]/)[0]!;
  const label = navPageOf(path)?.page.label ?? ({'/tasks':'任务中心','/inbox':'提醒'}[path]) ?? '来源页';
  return (
    <div className="workspace-journey">
      <div className="workspace-location">
        <Link to={back} className="inline-flex items-center gap-1 text-xs hover:text-primary transition-colors">
          <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true"><path d="M7.5 2L3.5 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
          返回{label}
        </Link>
      </div>
    </div>
  );
}
