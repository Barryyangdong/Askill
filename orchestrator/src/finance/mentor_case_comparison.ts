import type { MentorCase } from "./mentors.ts";

export type ArchiveMarketDay = Pick<MentorCase, "date" | "market" | "scene">;

export function archiveMeasurements(item: ArchiveMarketDay) {
  const fields = new Map(item.scene?.metrics.map(metric => [metric.key, metric.value]));
  const up = fields.get("up"), down = fields.get("dn");
  const breadth = up !== undefined && down !== undefined && up + down > 0
    ? 100 * up / (up + down) : null;
  return { breadth, premium: fields.get("premium") ?? null };
}

/** Only compare like-for-like archive measurements. Never turn an absent value into zero. */
export function compareMentorCases(target: ArchiveMarketDay, candidates: MentorCase[]) {
  const targetFacts = archiveMeasurements(target);
  if (targetFacts.breadth === null || targetFacts.premium === null) return [];
  const hits: { item: MentorCase; distance: number; common: string[] }[] = [];
  for (const item of candidates) {
    if (item.date >= target.date || item.nextDate > target.date || item.reveal.action === "unknown") continue;
    const facts = archiveMeasurements(item);
    if (facts.breadth === null || facts.premium === null) continue;
    const dimensions = [
      { label: "上涨家数占涨跌家数", a: targetFacts.breadth, b: facts.breadth, tolerance: 15 },
      { label: "昨日近涨停组平均涨幅", a: targetFacts.premium, b: facts.premium, tolerance: 2 },
      { label: "上证当日涨跌幅", a: target.market.pct, b: item.market.pct, tolerance: 1 },
    ];
    const differences = dimensions.map(row => Math.abs(row.a - row.b) / row.tolerance);
    if (Math.max(...differences) > 1) continue;
    hits.push({ item, distance: differences.reduce((a,b) => a+b, 0) / differences.length,
      common: dimensions.map(row => `${row.label} ${row.b.toFixed(2)}%（所选日 ${row.a.toFixed(2)}%）`) });
  }
  return hits.sort((a,b) => a.distance - b.distance || a.item.date.localeCompare(b.item.date));
}
