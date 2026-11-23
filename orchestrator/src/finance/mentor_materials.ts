import { createHash } from "node:crypto";
import fs from "node:fs";
import { readJson, writeJson } from "../fsutil.ts";
import { withLock } from "../ledger.ts";
import { safePath, ServiceError, type ServiceContext } from "../service.ts";
import { validDate } from "./shortline/history.ts";
import type { MentorCase } from "./mentors.ts";
import { materialActionCheck } from "./mentor_material_validation.ts";

type Context = Pick<ServiceContext, "dataRoot">;
type MaterialKind = "statement" | "interview" | "trades";
export interface MaterialEvidence {
  id: string;
  kind: MaterialKind;
  date: string;
  title: string;
  sourceUrl: string;
  summary: string;
  excerpt: string;
  selfReported: boolean;
  topics: string[];
  citation: string;
  trade?: { symbol: string; side: "买入" | "卖出" };
  basisIds?: string[];
  actionCheck?: NonNullable<ReturnType<typeof materialActionCheck>>;
}
export interface MaterialRevision {
  id: string;
  version: number;
  kind: MaterialKind;
  title: string;
  sourceUrl: string;
  publishedAt: string;
  importedAt: string;
  previousVersion: number | null;
  added: string[];
  removed: string[];
  evidence: MaterialEvidence[];
}
export interface MaterialHistory { version: number; materials: MaterialRevision[] }
type Extract = Pick<MaterialEvidence, "date" | "summary" | "excerpt" | "selfReported" | "topics" | "trade">;

const topicPatterns: [string, RegExp][] = [
  ["市场广度", /上涨家数|下跌家数|市场广度|普跌|普涨/],
  ["强势股反馈", /涨停|炸板|连板|晋级|强势|龙头|接力|溢价/],
  ["题材", /板块|题材|主线|轮动|跟风/],
  ["量能", /成交量|成交额|量能|放量|缩量|换手/],
  ["仓位", /持仓|空仓|仓位|开仓|减仓|加仓/],
  ["执行节奏", /竞价|分时|早盘|尾盘|午后|开盘|收盘|计划|临时起意/],
  ["风险", /风险|止损|回撤|亏损|失误|撤退/],
];
const hash = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
function invalid(message: string): never { throw new ServiceError("bad_request", message); }
function getText(value: unknown, limit: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) invalid(`请填写${label}，最多 ${limit} 个字符。`);
  return value.trim().replace(/\r\n?/g, "\n");
}
function storeFile(ctx: Context, mentor: string, file: string) {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(mentor)) invalid("人物编号无效");
  return safePath(ctx, "mentor-materials", mentor, file);
}
function sourceUrl(value: unknown): string {
  const input = getText(value, 1500, "公开出处链接");
  let url: URL;
  try { url = new URL(input); } catch { return invalid("请填写完整的公开出处链接。"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) invalid("请填写不含登录凭据的网页链接。");
  return url.href;
}
function timestamp(value: unknown, dateOnlyTime: string): string {
  const text = getText(value, 40, "时间");
  if (!validDate(text.slice(0, 10))) invalid("日期无效。");
  if (text.length === 10) return new Date(text + "T" + dateOnlyTime + "+08:00").toISOString();
  const match = /^(\d{4}-\d{2}-\d{2})[T ]((?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?)(Z|[+-]\d{2}:\d{2})?$/.exec(text);
  if (!match) invalid("请填写有效的北京时间或带时区的发布时间。");
  const time = Date.parse(`${match[1]}T${match[2]}${match[3] ?? "+08:00"}`);
  if (!Number.isFinite(time)) invalid("发布时间无效。");
  return new Date(time).toISOString();
}
const chinaDate = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10);

function extractSpeech(text: string, kind: MaterialKind, date: string): Extract[] {
  const found: Extract[] = [];
  let voice: "answer" | "question" | "unspecified" = "unspecified";
  const lines = kind === "interview" ? text.replace(/([。？！?!])\s*(?=(?:问|答|采访者|主持人|记者|受访者|嘉宾|Q|A)\s*[：:])/gi, "$1\n") : text;
  for (const paragraph of lines.split("\n")) {
    const speaker = /^\s*(采访者|主持人|记者|提问|问|Q|答|回答|受访者|嘉宾|A)\s*[：:]\s*/i.exec(paragraph);
    if (kind === "interview" && speaker) {
      voice = /^(答|回答|受访者|嘉宾|A)$/i.test(speaker[1]) ? "answer" : "question";
    }
    if (kind === "interview" && voice === "question") continue;
    const body = paragraph.slice(speaker && kind === "interview" ? speaker[0].length : 0).trim();
    const sentences = body.match(/[^。！？!?]+[。！？!?]*/gu) ?? [];
    for (const raw of sentences) {
      const excerpt = raw.trim();
      if (!excerpt) continue;
      const topics = topicPatterns.filter(([, pattern]) => pattern.test(excerpt)).map(([name]) => name);
      const selfReported = kind === "statement" || voice === "answer";
      const conditional = /如果|一旦|只有|除非|只要|若|的时候|时[，,]/u.test(excerpt);
      const scope = selfReported ? conditional ? "人物自述的条件" : "人物自述" : "访谈摘录，发言人待核对";
      found.push({ date, topics, selfReported, excerpt, summary: scope + (topics.length ? " · " + topics.join("、") : "") });
    }
  }
  if (!found.length) invalid("资料中没有可提取的发言，请补充原话或访谈回答。");
  return found;
}

function tradeColumns(line: string, row: number): string[] {
  const result: string[] = [];
  let cell = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && [",", "，", "\t"].includes(ch)) {
      result.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  if (quoted) invalid(`第 ${row} 行的引号未闭合。`);
  result.push(cell.trim());
  return result;
}

function tradeExtracts(text: string, publishedDay: string): Extract[] {
  const lines = text.split("\n").map((line, index) => ({ index, text: line.trim() })).filter(row => row.text);
  const head = tradeColumns(lines[0].text, lines[0].index + 1);
  const dateIndex = head.findIndex(s => /^(成交日期|交易日期|日期)$/.test(s));
  const codeIndex = head.findIndex(s => /^(证券代码|股票代码|代码)$/.test(s));
  const sideIndex = head.findIndex(s => /^(成交方向|买卖方向|买卖标志|买卖类别|业务名称|操作|方向)$/.test(s));
  const hasHeader = [dateIndex, codeIndex, sideIndex].some(i => i >= 0);
  if (hasHeader && [dateIndex, codeIndex, sideIndex].some(i => i < 0)) invalid("交割单表头需要日期、股票代码和方向。");
  const events = new Map<string, Extract>();
  for (const row of lines.slice(hasHeader ? 1 : 0)) {
    const parts = tradeColumns(row.text, row.index + 1);
    const rawDate = parts[hasHeader ? dateIndex : 0] ?? "";
    const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(rawDate);
    const pieces = compact ?? /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(rawDate);
    const date = pieces ? [pieces[1], pieces[2].padStart(2, "0"), pieces[3].padStart(2, "0")].join("-") : rawDate;
    const rawCode = parts[hasHeader ? codeIndex : 1] ?? "";
    const code = /^(?:SH|SZ|BJ)?(\d{6})(?:\.(?:SH|SZ|BJ))?$/i.exec(rawCode)?.[1];
    const rawSide = parts[hasHeader ? sideIndex : 2] ?? "";
    const side = /^(证券买入|买入|买|B|BUY)$/i.test(rawSide) ? "买入" : /^(证券卖出|卖出|卖|S|SELL)$/i.test(rawSide) ? "卖出" : null;
    if ((!hasHeader && parts.length !== 3) || !validDate(date) || !code || !side || date > publishedDay) {
      invalid(`第 ${row.index + 1} 行需要可核对的交易日期、六位股票代码和买卖方向，交易日不可晚于材料公开日。`);
    }
    // One observation per day, symbol and side. Round trips and partial fills do not establish opening or closing inventory.
    const key = [date, code, side].join("|");
    if (!events.has(key)) events.set(key, {
      date, topics: ["披露成交"], selfReported: false, summary: `公开交割摘录记录 ${side} ${code}`,
      trade: { symbol: code, side },
      excerpt: [date, rawCode, rawSide].join(" · "),
    });
  }
  if (!events.size) invalid("请填写至少一行交割记录。");
  return [...events.values()];
}

function history(ctx: Context, mentor: string): MaterialRevision[] {
  const file = storeFile(ctx, mentor, "index.json");
  // A malformed store must not be mistaken for an empty one on the next import.
  return fs.existsSync(file) ? readJson<MaterialRevision[]>(file) : [];
}

/** Within-statement activity only. Repeated fills were already collapsed by day, symbol and side. */
function tradePattern(entries: MaterialEvidence[], day: string): MaterialEvidence | null {
  if (entries.length < 2) return null;
  const buy = new Set<string>(), sell = new Set<string>(), days = new Set<string>();
  const buyDates = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!entry.trade) return null;
    const { side, symbol } = entry.trade;
    days.add(entry.date);
    if (side === "买入") {
      buy.add(entry.date + "/" + symbol);
      const dates = buyDates.get(symbol) ?? new Set<string>();
      dates.add(entry.date);
      buyDates.set(symbol, dates);
    } else {
      sell.add(entry.date + "/" + symbol);
    }
  }
  const both = [...buy].filter(key => sell.has(key)).length;
  const repeated = [...buyDates.values()].filter(dates => dates.size > 1).length;
  const summary = `该份摘录覆盖 ${days.size} 个有记录的交易日。按日期和标的去重，买入 ${buy.size} 组，卖出 ${sell.size} 组。` +
    `同日同标的双向成交 ${both} 组，跨日重复买入的标的 ${repeated} 只。持仓连续性与完整仓位仍待核对。`;
  const basisIds = entries.map(e => e.id);
  const id = hash(["public-trades-v1", ...basisIds]);
  const { kind, title, sourceUrl } = entries[0];
  return { kind, title, sourceUrl, id, date: day, summary, excerpt: entries.slice(0, 3).map(e => e.excerpt).join("；"),
    citation: `[资料:${id} p.-]`, selfReported: false, topics: ["成交行为"], basisIds };
}
function response(revisions: MaterialRevision[]): MaterialHistory {
  return { version: revisions.at(-1)?.version ?? 0, materials: [...revisions].reverse() };
}
export function listMentorMaterials(ctx: Context, mentor: string): MaterialHistory {
  return response(history(ctx, mentor));
}
export function importMentorMaterial(ctx: Context, mentor: string, body: Record<string, unknown>, now = new Date()): MaterialHistory {
  const kind = body.kind;
  if (kind !== "statement" && kind !== "interview" && kind !== "trades") invalid("请选择原话、访谈或公开交割单。");
  if (body.publicSource !== true) invalid("请确认导入的是所选人物的公开材料。");
  const title = getText(body.title, 160, "材料标题");
  const url = sourceUrl(body.sourceUrl);
  const publishedAt = timestamp(body.publishedAt, "23:59:59.999");
  const day = chinaDate(publishedAt);
  if (day > chinaDate(now.toISOString()) || String(body.publishedAt).trim().length > 10 && Date.parse(publishedAt) > now.getTime()) invalid("发布时间不能晚于现在。");
  const text = getText(body.text, 60000, "公开材料正文");
  const id = hash([mentor, kind, title, url, publishedAt, text]);
  const index = storeFile(ctx, mentor, "index.json");
  return withLock(index, () => {
    const revisions = history(ctx, mentor);
    if (revisions.some(item => item.id === id)) return response(revisions);
    const previous = [...revisions].reverse().find(item => item.kind === kind && item.title === title && item.sourceUrl === url);
    const extracts = kind === "trades" ? tradeExtracts(text, day) : extractSpeech(text, kind, day);
    const unique = new Map<string, MaterialEvidence>();
    for (const extract of extracts) {
      const evidenceId = hash([mentor, kind, title, url, extract.date, extract.excerpt, extract.selfReported]);
      unique.set(evidenceId, { ...extract, id: evidenceId, title, sourceUrl: url, kind, citation: `[资料:${evidenceId} p.-]` });
    }
    const evidence = [...unique.values()];
    const names = (items: MaterialEvidence[]) => [...new Set(items.map(e => e.excerpt))];
    const nextNames = names(evidence);
    const priorNames = names(previous?.evidence ?? []);
    const priorSet = new Set(priorNames), nextSet = new Set(nextNames);
    const revision: MaterialRevision = {
      id, kind, title, sourceUrl: url, publishedAt, importedAt: now.toISOString(), version: (revisions.at(-1)?.version ?? 0) + 1,
      previousVersion: previous?.version ?? null, evidence, added: nextNames.filter(s => !priorSet.has(s)), removed: priorNames.filter(s => !nextSet.has(s)),
    };
    // Only the local original contains full text and extra CSV columns. The public evidence view exposes selected fields.
    writeJson(storeFile(ctx, mentor, id + ".json"), { id, title, kind, sourceUrl: url, publishedAt, text });
    revisions.push(revision);
    writeJson(index, revisions);
    return response(revisions);
  });
}

/** Only the latest publicly available revision per source at that instant. Imported dates never stand in for publication dates. */
export function mentorMaterialEvidence(ctx: Context, mentor: string, asOf: string, cases?: MentorCase[]): MaterialEvidence[] {
  const cutoff = timestamp(asOf, "15:00:00");
  const current = new Map<string, MaterialRevision>();
  for (const revision of history(ctx, mentor)) {
    if (revision.publishedAt > cutoff) continue;
    const key = JSON.stringify([revision.kind, revision.title, revision.sourceUrl]);
    const prior = current.get(key);
    if (!prior || revision.publishedAt >= prior.publishedAt) current.set(key, revision);
  }
  const evidence = [...current.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.version - a.version).flatMap(r => {
    const pattern = r.kind === "trades" ? tradePattern(r.evidence, chinaDate(r.publishedAt)) : null;
    return pattern ? [pattern, ...r.evidence] : r.evidence;
  });
  if (!cases?.length) return evidence;
  const day = chinaDate(cutoff);
  return evidence.map(item => {
    const actionCheck = item.selfReported ? materialActionCheck(item.excerpt, cases, day) : null;
    if (!actionCheck) return item;
    const counts = `覆盖 ${actionCheck.total} 个可比日，已知动作中 ${actionCheck.supportingCaseIds.length} 个相符、${actionCheck.counterCaseIds.length} 个相反，${actionCheck.total - actionCheck.known} 个动作未核实。`;
    return { ...item, actionCheck, summary: item.summary + "。按公开交割案例回看次日实际新开仓行为，" + counts };
  });
}
