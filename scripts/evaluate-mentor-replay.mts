/** Chronological holdout for the actual archive retrieval. Run with Node: node scripts/evaluate-mentor-replay.mts [pack.json] [cutoff]. */
import fs from "node:fs";
import { compareMentorCases } from "../orchestrator/src/finance/mentor_case_comparison.ts";
import type { MentorCase } from "../orchestrator/src/finance/mentors.ts";

const file = process.argv[2] ?? new URL("../knowledge/mentors/tuixue.json", import.meta.url);
const cutoff = process.argv[3] ?? "2017-07-01";
const pack: { cases: MentorCase[] } = JSON.parse(fs.readFileSync(file, "utf8"));
const known = pack.cases.filter(item => item.reveal.action !== "unknown");
const train = known.filter(item => item.nextDate < cutoff);
const holdout = known.filter(item => item.nextDate >= cutoff);
if (!train.length || !holdout.length) throw new Error("切分日两侧均需有能核实次日动作的样本。");
const open = train.filter(item => item.reveal.action === "open").length;
const baseline = 2 * open === train.length ? "unknown" : 2 * open > train.length ? "open" : "no_open";
const rows = holdout.map(item => {
  const atClose: MentorCase = { ...item, reveal: { action: "unknown", sources: [], summary: "" } };
  const hits = compareMentorCases(atClose, train).slice(0, 3);
  const votes = hits.reduce((sum, hit) => sum + (hit.item.reveal.action === "open" ? 1 : -1), 0);
  return {
    date: item.date, actual: item.reveal.action, guess: votes === 0 ? "unknown" : votes > 0 ? "open" : "no_open",
    comparedDates: hits.map(hit => hit.item.date),
  };
});
const decided = rows.filter(row => row.guess !== "unknown");
console.log(JSON.stringify({
  cutoff, train: train.length, holdout: rows.length, decided: decided.length, noMatch: rows.filter(row => !row.comparedDates.length).length,
  tied: rows.filter(row => row.comparedDates.length && row.guess === "unknown").length,
  correct: decided.filter(row => row.guess === row.actual).length, baseline,
  baselineCorrectOnDecided: decided.filter(row => row.actual === baseline).length, baselineCorrectAll: rows.filter(row => row.actual === baseline).length, rows,
}, null, 2));
