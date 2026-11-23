/** Scroll state for a persistent main element across route entries. */
export interface ScrollSurface {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}
export interface ScrollRestoreEnvironment {
  observe: (callback: () => void) => () => void;
  later: (callback: () => void, ms: number) => () => void;
}
export class WorkspaceScroll {
  private positions = new Map<string, number>();
  private path: string;
  private key: string;
  private pending: number | null = null;
  private stopObserver: (() => void) | null = null;
  private stopTimer: (() => void) | null = null;
  private surface: ScrollSurface;
  private env: ScrollRestoreEnvironment;
  constructor(path: string, key: string, surface: ScrollSurface, env: ScrollRestoreEnvironment) {
    this.path = path; this.key = key; this.surface = surface; this.env = env;
    this.positions.set(key, surface.scrollTop);
  }
  onScroll() {
    if (this.pending === null) this.positions.set(this.key, this.surface.scrollTop);
  }
  cancel() {
    if (this.pending === null) return;
    this.clearPending();
    this.positions.set(this.key, this.surface.scrollTop);
  }
  dispose() { this.clearPending(); }
  private clearPending() {
    this.pending = null;
    this.stopObserver?.(); this.stopObserver = null;
    this.stopTimer?.(); this.stopTimer = null;
  }
  private attempt = () => {
    if (this.pending === null) return;
    const target = this.pending;
    this.surface.scrollTop = target;
    if (this.surface.scrollHeight - this.surface.clientHeight >= target) {
      this.clearPending();
      this.positions.set(this.key, this.surface.scrollTop);
    }
  };
  navigate(path: string, key: string, action: string) {
    const samePath = path === this.path;
    this.clearPending();
    this.path = path; this.key = key;
    if (samePath) {
      // Query-only changes preserve the current view, including the new entry's key.
      this.positions.set(key, this.surface.scrollTop);
      return false;
    }
    const target = action === "POP" ? (this.positions.get(key) ?? 0) : 0;
    this.pending = target;
    this.attempt();
    if (this.pending !== null) {
      this.stopObserver = this.env.observe(this.attempt);
      this.stopTimer = this.env.later(() => this.cancel(), 15000);
    }
    return true;
  }
}
