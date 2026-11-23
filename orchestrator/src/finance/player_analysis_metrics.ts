/** Ratios are fractions throughout, except preference, which is in percentage points. */
export interface PlayerRow {
  id: string;
  name: string;
  rank: number | null;
  state: "reported" | "published" | "leave" | "suspended" | "missing" | "unknown" | "withdrawn";
  dayReturn: number | null;
  totalReturn: number | null;
  exposure: number | null;
  holdingsState: "complete" | "empty" | "partial" | "unknown";
  symbols: string[];
  nav?: number | null;
  screenshot?: {id:string; exposure:boolean; holdings:boolean; exposureId?:string; holdingsId?:string};
}
export interface PlayerDay {
  date: string;
  previousTradeDate?: string | null;
  players: PlayerRow[];
  rankComplete: boolean;
  expected?: number | null;
}
export interface PlayerOptions {
  date: string;
  previousDate?: string | null;
  rankBasis?: "previous" | "today";
  n?: number;
  pct?: number;
  followed?: string[];
  watch?: string[];
}
export interface Metric {
  value: number | null;
  numerator: number | null;
  denominator: number;
  ids: string[];
}
export interface HoldingStat {
  holders: string[];
  denominator: number;
  comparable: number;
  added: string[];
  kept: string[];
  exited: string[];
  net: number | null;
}
type GroupKey = "all" | "top" | "bottom";
const keys: GroupKey[] = ["all", "top", "bottom"];
export const disclosed = (p:PlayerRow) => p.state === "reported" || p.state === "published";
export const complete = (p?: PlayerRow) => p && (disclosed(p) || p.screenshot?.holdings) && (p.holdingsState === "complete" || p.holdingsState === "empty");
const numeric = (x: number | undefined | null): x is number => typeof x === "number" && Number.isFinite(x);

function precedingDay(day: PlayerDay) {
  if (day.previousTradeDate !== undefined) return day.previousTradeDate;
  // Without an exchange calendar, accept only adjacent weekdays. A holiday gap
  // therefore stays unknown unless the source supplied its previous trading day.
  const prior = new Date(day.date + "T00:00:00Z");
  do { prior.setUTCDate(prior.getUTCDate() - 1); } while ([0, 6].includes(prior.getUTCDay()));
  return prior.toISOString().slice(0, 10);
}

function rankCut(rows: PlayerRow[], count: number, bottom = false): Set<string> | null {
  if (count === 0) return new Set();
  const cut = bottom ? rows.length - count : count;
  if (cut > 0 && cut < rows.length && rows[cut - 1].rank === rows[cut].rank) return null;
  return new Set((bottom ? rows.slice(cut) : rows.slice(0, count)).map(r => r.id));
}
function indexDay(day: PlayerDay, opt: PlayerOptions) {
  const active = day.players.filter(r => r.state !== "withdrawn");
  const ranked = active.filter(r => numeric(r.rank)).sort((a, b) => a.rank! - b.rank!);
  const requested = opt.pct === undefined ? (opt.n ?? 20) : Math.ceil(ranked.length * opt.pct);
  const size = Math.min(Math.max(0, Math.floor(requested)), Math.floor(ranked.length / 2));
  return {
    day, size, active, byId: new Map(day.players.map(r => [r.id, r])),
    top: day.rankComplete && size > 0 ? rankCut(ranked, size) : null,
    bottom: day.rankComplete && size > 0 ? rankCut(ranked, size, true) : null,
    tenth: day.rankComplete && ranked.length ? rankCut(ranked, Math.ceil(ranked.length / 10)) : null,
  };
}
type DayIndex = ReturnType<typeof indexDay>;
function prepare(days: PlayerDay[], opt: PlayerOptions) {
  const indexes = new Map(days.filter(d => d.date <= opt.date).map(d => [d.date, indexDay(d, opt)]));
  const today = indexes.get(opt.date);
  if (!today) throw new RangeError("该交易日没有赛事快照");
  const previousDate = opt.previousDate !== undefined ? opt.previousDate : precedingDay(today.day);
  const previous = previousDate && previousDate < opt.date ? indexes.get(previousDate) : undefined;
  const rankBasis = opt.rankBasis ?? "previous";
  const rankDay = rankBasis === "today" ? today : previous;
  const ids = { all: today.active.map(r => r.id), top: [...(rankDay?.top ?? [])], bottom: [...(rankDay?.bottom ?? [])] };
  const history: DayIndex[] = [today];
  let cursor = previous;
  while (cursor && cursor.day.date < history[history.length - 1].day.date) {
    history.push(cursor);
    cursor = indexes.get(precedingDay(cursor.day) ?? "");
  }
  return { today, previous, previousDate, rankBasis, rankDay, ids, history };
}
function ratio(sample: PlayerRow[], positive: (p: PlayerRow) => boolean): Metric {
  const ids = sample.filter(positive).map(p => p.id);
  return { value: sample.length ? ids.length / sample.length : null, numerator: ids.length, denominator: sample.length, ids };
}
function median(sample: PlayerRow[], field: "dayReturn" | "exposure"): Metric {
  const values = sample.map(r => r[field]!).sort((a, b) => a - b);
  const n = values.length;
  return { value: n ? (values[Math.floor((n - 1) / 2)] + values[Math.floor(n / 2)]) / 2 : null,
    numerator: null, denominator: n, ids: sample.map(r => r.id) };
}
function bins(rows: PlayerRow[], labels: string[], assign: (r: PlayerRow) => number) {
  const buckets = labels.map(label => ({ label, ids: [] as string[] }));
  for (const row of rows) buckets[assign(row)].ids.push(row.id);
  return buckets;
}
function groupStat(ids: string[], day: DayIndex, prev?: DayIndex) {
  const rows = ids.flatMap(id => {
    const row = day.byId.get(id);
    return row && row.state!=="withdrawn" ? [row] : [];
  });
  const returns = rows.filter(p => disclosed(p) && numeric(p.dayReturn));
  const exposures = rows.filter(p => (disclosed(p) || p.screenshot?.exposure) && numeric(p.exposure));
  const paired = exposures.filter(p => {
    const prior = prev?.byId.get(p.id);
    return prior && prior.state!=="withdrawn" && (disclosed(prior) || prior.screenshot?.exposure) && numeric(prior.exposure);
  });
  return {
    ids, reported: rows.filter(p=>p.state==="reported").length, profit: ratio(returns, p => p.dayReturn! > 0),
    dayReturn: median(returns, "dayReturn"), exposure: median(exposures, "exposure"),
    rising: ratio(paired, p => p.exposure! > prev!.byId.get(p.id)!.exposure!),
    exposureBins: bins(exposures, ["空仓", "轻仓 (0,30%]", "中仓 (30%,70%]", "重仓 (70%,100%]", "超满仓"], p => {
      const x = p.exposure!;
      return x === 0 ? 0 : x <= .3 ? 1 : x <= .7 ? 2 : x <= 1 ? 3 : 4;
    }),
    returnBins: bins(returns, ["≤−5%", "(−5%,0)", "持平", "(0,5%)", "≥5%"], p => {
      const x = p.dayReturn!;
      return x <= -.05 ? 0 : x < 0 ? 1 : x === 0 ? 2 : x < .05 ? 3 : 4;
    }),
  };
}
function emptyHolding(denominator: number, comparable: number): HoldingStat {
  return { holders: [], denominator, comparable, added: [], kept: [], exited: [], net: comparable ? 0 : null };
}
function holdings(ids: string[], day: DayIndex, prev?: DayIndex, onlySymbol?: string) {
  const stocks = new Map<string, HoldingStat>();
  let denominator = 0, comparable = 0;
  function add(symbol: string, field: "holders" | "added" | "kept" | "exited", id: string) {
    if (onlySymbol && onlySymbol !== symbol) return;
    const record = stocks.get(symbol) ?? emptyHolding(0, 0);
    record[field].push(id);
    stocks.set(symbol, record);
  }
  for (const id of ids) {
    const row = day.byId.get(id);
    if (!row || !complete(row)) continue;
    denominator++;
    const now = new Set(row.symbols);
    for (const symbol of now) add(symbol, "holders", id);
    const prior = prev?.byId.get(id);
    if (!prior || !complete(prior)) continue;
    comparable++;
    const before = new Set(prior.symbols);
    for (const symbol of now) add(symbol, before.has(symbol) ? "kept" : "added", id);
    for (const symbol of before) if (!now.has(symbol)) add(symbol, "exited", id);
  }
  for (const stat of stocks.values()) {
    stat.denominator = denominator;
    stat.comparable = comparable;
    stat.net = comparable ? stat.added.length - stat.exited.length : null;
  }
  return { stocks, get: (symbol: string) => stocks.get(symbol) ?? emptyHolding(denominator, comparable) };
}
function playerStat(row: PlayerRow, history: DayIndex[], followed: Set<string>) {
  let peak = 0, drawdown = 0, rankDays = 0, topDays = 0, reportDays = 0, navDays = 0;
  const window = history.slice(0, 20);
  for (const d of [...window].reverse()) {
    const r = d.byId.get(row.id);
    if (!r || r.state === "withdrawn") continue;
    if (d.tenth && numeric(r.rank)) {
      rankDays++;
      if (d.tenth.has(r.id)) topDays++;
    }
    if (!disclosed(r)) continue;
    if (r.state==="reported") reportDays++;
    const nav = r.nav ?? (numeric(r.totalReturn) ? 1 + r.totalReturn : null);
    if (numeric(nav) && nav >= 0 && (peak > 0 || nav > 0)) {
      navDays++;
      peak = Math.max(peak, nav);
      drawdown = Math.max(drawdown, 1 - nav / peak);
    }
  }
  const now = history[0].top, old = history[1]?.top;
  let migration: "new" | "stayed" | "out" | null = null;
  if (now && old) {
    if (now.has(row.id)) migration = old.has(row.id) ? "stayed" : "new";
    else if (old.has(row.id)) migration = "out";
  }
  let streak = 0;
  for (const d of history) {
    if (!d.top?.has(row.id)) break;
    streak++;
  }
  const streakIsLowerBound = streak > 0 && !history[streak]?.top;
  return { ...row, followed: followed.has(row.id), migration, streak: now ? streak : null, streakIsLowerBound,
    rankDays, topDays, reportDays, windowDays: window.length, drawdown: navDays === window.length ? drawdown : null,
    eligible: rankDays === 20 && reportDays === 20 && navDays === 20 };
}
export function analyzePlayers(days: PlayerDay[], options: PlayerOptions) {
  const {today, previous, previousDate, rankBasis, rankDay, ids, history} = prepare(days, options);
  const groups = { all: groupStat(ids.all, today, previous), top: groupStat(ids.top, today, previous), bottom: groupStat(ids.bottom, today, previous) };
  const holdingsByGroup = { all: holdings(ids.all,today,previous), top: holdings(ids.top,today,previous), bottom: holdings(ids.bottom,today,previous) };
  const symbols = new Set(keys.flatMap(k => [...holdingsByGroup[k].stocks.keys()]));
  const stocks = [...symbols].map(symbol => {
    const all = holdingsByGroup.all.get(symbol), top = holdingsByGroup.top.get(symbol), bottom = holdingsByGroup.bottom.get(symbol);
    const preference = top.denominator && all.denominator ? 100 * (top.holders.length / top.denominator - all.holders.length / all.denominator) : null;
    return {symbol, preference, all, top, bottom};
  }).sort((a,b) => (b.preference ?? -Infinity) - (a.preference ?? -Infinity) || b.top.holders.length - a.top.holders.length || a.symbol.localeCompare(b.symbol));
  const followed = new Set(options.followed);
  const roster = new Map(today.byId);
  // Keep absent group members and followed identities accessible without carrying
  // their older returns, stocks or ranks into today's observations.
  const wanted = new Set([...ids.top, ...ids.bottom, ...(previous?.top ?? []), ...followed]);
  for (const day of [...days].filter(d => d.date < options.date).sort((a,b) => b.date.localeCompare(a.date))) {
    for (const row of day.players) if (wanted.has(row.id) && !roster.has(row.id)) {
      roster.set(row.id, { id: row.id, name: row.name, rank: null, state: "unknown", dayReturn: null,
        totalReturn: null, exposure: null, holdingsState: "unknown", symbols: [] });
    }
  }
  const players = [...roster.values()].map(row => playerStat(row, history, followed))
    .sort((a,b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id.localeCompare(b.id));
  const watch = new Set(options.watch), matches = stocks.filter(s => watch.has(s.symbol));
  const digest = new Map<string,string[]>();
  function highlight(stock: typeof stocks[number], text: string) {
    const items = digest.get(stock.symbol) ?? [];
    items.push(text);
    digest.set(stock.symbol,items);
  }
  const preferred = matches.find(s => (s.preference ?? 0) > 0);
  if (preferred) highlight(preferred, `领先组 ${preferred.top.holders.length}/${preferred.top.denominator} 人持有，全场 ${preferred.all.holders.length}/${preferred.all.denominator} 人持有`);
  const net = [...matches].sort((a,b) => (b.all.net ?? -Infinity) - (a.all.net ?? -Infinity) || a.symbol.localeCompare(b.symbol))[0];
  if (net && (net.all.net ?? 0) > 0) highlight(net,`可比 ${net.all.comparable} 人中，持有人净增 ${net.all.net} 人`);
  const fresh = matches.map(s => ({s,count:s.all.added.filter(id => followed.has(id)).length}))
    .sort((a,b) => b.count-a.count || a.s.symbol.localeCompare(b.s.symbol))[0];
  if (fresh?.count) highlight(fresh.s,`有 ${fresh.count} 位关注选手新增持有`);
  const active = today.active;
  const groupReason = !rankDay ? "缺少分组日榜单" : !rankDay.day.rankComplete ? "分组日榜单覆盖不完整" :
    rankDay.size === 0 ? "可排名人数不足" : !rankDay.top || !rankDay.bottom ? "并列边界缺少官方顺序" : null;
  return { date: today.day.date, previousDate, rankBasis, rankDate: rankDay?.day.date ?? null, size: rankDay?.size ?? 0, groupReason,
    coverage: { expected: today.day.expected ?? null, roster: active.length, reported: groups.all.reported,
      published: active.filter(r=>r.state==="published").length,
      carried: active.filter(r => r.state === "leave" || r.state === "suspended").length,
      missing: active.filter(r => r.state === "missing").length, unknown: active.filter(r => r.state === "unknown").length,
      complete: active.filter(complete).length },
    groups, stocks, players, digest: [...digest].map(([symbol,texts]) => ({symbol,text:texts.join("；")})) };
}
export function playerHistory(days: PlayerDay[], date: string, id: string) {
  return [...days].filter(d => d.date <= date).sort((a,b) => a.date.localeCompare(b.date)).flatMap(d => {
    const row = d.players.find(p => p.id === id);
    return row ? [{date:d.date,...row}] : [];
  });
}
export function stockHistory(days: PlayerDay[], options: PlayerOptions, symbol: string) {
  const {history,ids} = prepare(days,options);
  return history.slice(0,5).map((d,i) => ({
    date:d.day.date, all:holdings(ids.all,d,history[i+1],symbol).get(symbol),
    top:holdings(ids.top,d,history[i+1],symbol).get(symbol), bottom:holdings(ids.bottom,d,history[i+1],symbol).get(symbol),
  })).reverse();
}
