import { useEffect, useState } from "react";
import { backend, type Envelope } from "@/lib/backend";
import { createReviewCache } from "./reviewCache";

type Member = { code: string; name?: string };
type Article = { date: string; title: string; link: string; source: string; code?: string };
const newsCache = createReviewCache<Article[]>(96);

export function themeArticles(envelope: Envelope, day: string, code?: string): Article[] {
  const rows: Article[] = [];
  for (const e of envelope.evidence) {
    if (e.period !== day || e.field !== (code ? "announcement_title" : "market_news_title") || typeof e.value !== "string") continue;
    const url = /(?:^|;\s*)url=(https:\/\/[^;\s]+)/.exec(e.note ?? "")?.[1];
    const time = /(?:^|;)time=(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/.exec(e.note ?? "")?.[1];
    if (!code && (!time || !time.startsWith(day) || time > day + " 15:00:00")) continue;
    if (!url || !(code ? /^https:\/\/(?:www|static)\.cninfo\.com\.cn\// : /^https:\/\/(?:www\.)?wallstreetcn\.com\//).test(url)) continue;
    const title = e.value.replace(/<[^>]*>/g, "").trim();
    if (title) rows.push({ date: code ? day : time!, title, link: url, source: code ? "巨潮资讯" : "华尔街见闻", code });
  }
  return rows;
}

async function newsOnDay(day: string) {
  return newsCache.read("news:" + day, false, async () => {
    let cursor = Math.floor(Date.parse(day + "T15:00:01+08:00") / 1000);
    const rows: Article[] = [];
    for (let page = 0; page < 3; page++) {
      const { envelope } = await backend.fetch("wscn_lives", { args: { channel: "a-stock-channel", limit: 30, cursor } });
      if (envelope.status === "failed") throw new Error("A 股快讯暂不可用");
      rows.push(...themeArticles(envelope, day));
      const next = Number(envelope.extra?.next_cursor);
      if (!Number.isFinite(next) || next <= 0 || next >= cursor || next < Date.parse(day + "T00:00:00+08:00") / 1000) break;
      cursor = next;
    }
    return rows;
  }, () => 3600000);
}

function announcements(day: string, code: string) {
  return newsCache.read(day + ":" + code, false, async () => {
    const { envelope } = await backend.fetch("cninfo_announcements", { symbol: code, args: { day, page_size: 30 } });
    if (envelope.status === "failed" || !Array.isArray(envelope.evidence)) throw new Error("公告暂不可用");
    return themeArticles(envelope, day, code);
  }, () => 3600000);
}

export function ThemeNews({ day, name, members }: { day: string; name: string; members: readonly Member[] }) {
  return <NewsList key={day + ":" + name} day={day} name={name} members={members} />;
}

function NewsList({ day, name, members }: { day: string; name: string; members: readonly Member[] }) {
  const [limit, setLimit] = useState(4);
  const [retry, setRetry] = useState(0);
  const stocks = new Map(members.filter(m => /^\d{6}$/.test(m.code)).map(m => [m.code, m.name]));
  const codesKey = [...stocks.keys()].slice(0, limit).join(",");
  const [items, setItems] = useState<{ key: string; articles: Article[]; missing: string[]; loading: boolean }>();
  useEffect(() => {
    let active = true;
    const articles: Article[] = [], missing: string[] = [];
    const codes = codesKey ? codesKey.split(",") : [];
    let pending = codes.length + 1;
    const publish = () => {
      if (active) setItems({key: codesKey, articles: [...articles], missing: [...missing], loading: pending > 0});
    };
    async function load(label: string, read: () => Promise<Article[]>) {
      try { articles.push(...await read()); }
      catch { missing.push(label); }
      finally { pending--; publish(); }
    }
    publish();
    void load("快讯", () => newsOnDay(day));
    async function worker() {
      while (codes.length && active) {
        const code = codes.shift()!;
        await load(code, () => announcements(day, code));
      }
    }
    void worker(); void worker();
    return () => { active = false; };
  }, [day, codesKey, retry]);
  const current = items?.key === codesKey ? items : null;
  const terms = [name, ...stocks.keys(), ...stocks.values()].filter((s): s is string => !!s?.trim() && s.trim().length >= 2);
  const unique = new Map<string, Article>();
  for (const row of current?.articles ?? []) {
    if (row.code || terms.some(term => row.title.includes(term))) unique.set(row.link, row);
  }
  const sorted = [...unique.values()].sort((a, b) => b.date.localeCompare(a.date));
  return <section className="glass min-w-0 space-y-2 p-4">
    <h3 className="text-sm font-semibold">题材消息与成分股公告</h3>
    <p className="text-xs text-muted-foreground">{day} · 当日收盘前最多 90 条 A 股快讯，按题材、股票名称或代码匹配。每股最多 30 条同日公告，含盘后披露。</p>
    {sorted.length > 0 && <ul className="divide-y divide-border/60">{sorted.map(row =>
      <li key={row.link} className="space-y-1 py-2"><a href={row.link} target="_blank" rel="noreferrer" className="text-sm hover:text-primary hover:underline">{row.title}</a>
        <p className="text-xs text-muted-foreground">{row.source} · {row.date}{row.code && " · " + (stocks.get(row.code) || row.code)}</p>
      </li>)}</ul>}
    {(!current || current.loading) && <p role="status" className="text-xs text-muted-foreground">正在读取所选日期的快讯与公告…</p>}
    {current && !current.loading && sorted.length === 0 && <p role="status" className="text-xs text-muted-foreground">已读取的记录中未匹配到相关消息。</p>}
    {!!current?.missing.length && <p className="text-xs text-warning">未取得：{current.missing.join("、")} <button type="button" onClick={() => setRetry(n => n + 1)} className="text-primary hover:underline">重试</button></p>}
    {stocks.size > limit && <button type="button" onClick={() => setLimit(n => n + 4)} className="text-xs text-primary hover:underline">查看更多成分股公告（已选 {limit} / {stocks.size}）</button>}
  </section>;
}
