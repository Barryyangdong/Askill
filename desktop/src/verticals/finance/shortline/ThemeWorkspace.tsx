import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { backend } from "@/lib/backend";
import { createReviewCache } from "./reviewCache";
import { normalizeMarketSymbol } from "@/lib/marketSymbol";
import { peekDailyTiers, readDailyTiers } from "@/lib/dailyReviewData";
import type { ReviewTiersResult } from "@/lib/reviewTiers";
import { ThemeManagement, useThemeCatalog, type ManagedTheme, type ThemeSource } from "./ThemeManagement";
import { ThemeReviewTab } from "./ThemeReview";
import type { ViewTabProps } from "./WeeklyTab";

type Mode = "review" | "manage";
const modes: {key: Mode; label: string}[] = [{key: "review", label: "题材复盘"}, {key: "manage", label: "题材管理"}];
const topics = "同花顺涨停题材";
const industries = "东财涨停行业";
const sourceKey = (parent: string, name: string) => `source:${parent}|${name}`;
const standard = "标准行业分类";
const industryCache = createReviewCache<ThemeSource[]>(4);
function loadIndustries(day: string, refresh: boolean) {
  return industryCache.read(day, refresh, async () => {
    const {envelope} = await backend.fetch("cn_review_industry_members", {args: {day}, refresh});
    const groups = envelope.extra?.groups;
    if (envelope.status !== "ok" || envelope.extra?.date !== day || !Array.isArray(groups)) {
      throw new Error("未取得该日标准行业分类。");
    }
    return groups.map((t: ThemeSource) => ({...t, parent: standard}));
  }, () => 24 * 3_600_000);
}

export function reviewSources(result: ReviewTiersResult | undefined, day: string): ThemeSource[] {
  if (result?.date !== day) return [];
  const sources = new Map<string, ThemeSource>();
  function add(parent: string, name: string, code: string, stockName: string) {
    if (!name.trim()) return;
    const key = sourceKey(parent, name);
    const entry = sources.get(key) ?? {parent, name, stocks: []};
    if (!entry.stocks.some(s => s.code === code)) entry.stocks.push({code, name: stockName});
    sources.set(key, entry);
  }
  for (const group of result.groups) {
    for (const stock of group.stocks) {
      const code = normalizeMarketSymbol(stock.symbol);
      if (!code || !/^\d{6}$/.test(code)) continue;
      add(industries, group.industry, code, stock.name);
      for (const tag of stock.tags) add(topics, tag, code, stock.name);
    }
  }
  return Array.from(sources.values()).sort((a, b) => b.stocks.length - a.stocks.length || a.name.localeCompare(b.name, "zh-CN"));
}

export function ThemeWorkspace(props: ViewTabProps) {
  const {day, refreshNonce} = props;
  const catalog = useThemeCatalog();
  const activeReview = useRef<{name: string; id?: string; date: string} | null>(null);
  const remember = useCallback((name: string, id: string | undefined, date: string) => {
    activeReview.current = {name, id, date};
  }, []);
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const mode = params.get("themeView") === "manage" ? "manage" : "review";
  const selectedId = params.get("themeId") || undefined;
  const name = params.get("theme") || undefined;
  const requestedDay = params.get("sampleDate");
  const sampleDay = requestedDay && /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) && requestedDay <= day ? requestedDay : day;
  const needsSources = mode === "manage" || selectedId?.startsWith("source:");
  const [loaded, setLoaded] = useState<ReviewTiersResult>();
  const [sourceError, setSourceError] = useState("");
  const [industryData, setIndustryData] = useState<{day: string; groups: ThemeSource[]}>();
  const [industryError, setIndustryError] = useState("");
  const needsIndustry = mode === "manage" || selectedId?.startsWith(sourceKey(standard, ""));
  const industryRefresh = useRef(refreshNonce);
  useEffect(() => {
    if (!needsIndustry) return;
    let active = true;
    const refresh = industryRefresh.current !== refreshNonce;
    industryRefresh.current = refreshNonce;
    setIndustryError("");
    void loadIndustries(sampleDay, refresh).then(groups => { if (active) setIndustryData({day:sampleDay, groups}); })
      .catch(() => { if (active) setIndustryError("标准行业分类暂未取得，可点页头刷新重试。"); });
    return () => { active = false; };
  }, [sampleDay, refreshNonce, needsIndustry]);
  const lastRefresh = useRef(refreshNonce);
  useEffect(() => {
    if (!needsSources) return;
    let active = true;
    const force = refreshNonce !== lastRefresh.current;
    lastRefresh.current = refreshNonce;
    setSourceError("");
    void readDailyTiers(sampleDay, force).then(res => { if (active) setLoaded(res); })
      .catch(err => { if (active) setSourceError(err instanceof Error ? err.message : "来源题材读取失败"); });
    return () => { active = false; };
  }, [sampleDay, refreshNonce, needsSources]);
  const dated = loaded?.date === sampleDay ? loaded : peekDailyTiers(sampleDay) ?? undefined;
  const sources = useMemo(() => [...reviewSources(dated, sampleDay), ...(industryData?.day === sampleDay ? industryData.groups : [])], [dated, sampleDay, industryData]);
  const selectedSource = selectedId ? sources.find(t => sourceKey(t.parent ?? "", t.name) === selectedId) : undefined;
  const managed = useMemo(() => [
    ...catalog.themes.map(t => {
      const parent = t.parentId && catalog.themes.find(item => item.id === t.parentId);
      return { id: t.id, name: t.name, path: parent ? parent.name + " / " + t.name : t.name, members: t.stocks };
    }),
    ...(selectedSource && selectedId ? [{id: selectedId, name: selectedSource.name, path: selectedSource.parent + " / " + selectedSource.name, members: selectedSource.stocks}] : []),
  ], [catalog.themes, selectedSource, selectedId]);

  function update(nextMode: Mode, tag: string | undefined, id: string | undefined, sample = sampleDay) {
    const next = new URLSearchParams(params);
    if (nextMode === "manage") next.set("themeView", "manage"); else next.delete("themeView");
    if (tag) next.set("theme", tag); else next.delete("theme");
    // A public matrix theme and its directory entry share the same notes and selection.
    if (id && !(nextMode === "review" && id === sourceKey(topics, tag ?? ""))) next.set("themeId", id);
    else next.delete("themeId");
    if (sample !== day) next.set("sampleDate", sample); else next.delete("sampleDate");
    if (next.toString() !== params.toString()) setParams(next, {replace: mode === nextMode, state: location.state, preventScrollReset: true});
  }
  function fromCatalog(theme: ManagedTheme | ThemeSource, nextMode: Mode) {
    const id = "id" in theme ? theme.id : sourceKey(theme.parent ?? "", theme.name);
    update(nextMode, theme.name, id);
  }
  return <div className={mode === "review" ? "theme-review-workspace" : "space-y-4"}>
    <SegmentedToggle value={mode} options={modes} label="题材工作区" onChange={next => {
      if (mode === next) return;
      const active = activeReview.current;
      if (next === "manage" && active?.name) update(next, active.name, active.id ?? sourceKey(topics, active.name), active.date);
      else update(next, name, selectedId);
    }} />
    {mode === "review"
      ? <ThemeReviewTab {...props} onActiveTheme={remember} managedThemes={managed} selectedTheme={name} selectedThemeId={selectedId} selectedDate={sampleDay}
          onSelectTheme={(tag, id, date) => update("review", tag, id, date ?? day)}
          onManageTheme={(tag, id, date) => update("manage", tag, id ?? sourceKey(topics, tag), date ?? day)} />
      : <>
          {sourceError && <p role="status" className="text-sm text-warning">{sampleDay} 的来源题材暂不可用 · {sourceError}</p>}
          {industryError && <p role="status" className="text-sm text-warning">{industryError}</p>}
          <ThemeManagement day={sampleDay} catalog={catalog} sources={sources}
            initialId={selectedId ?? (name ? sourceKey(topics, name) : undefined)}
            onEmpty={() => update("manage", undefined, undefined)}
            onSelect={theme => fromCatalog(theme, "manage")} onReview={theme => fromCatalog(theme, "review")} />
        </>}
  </div>;
}
