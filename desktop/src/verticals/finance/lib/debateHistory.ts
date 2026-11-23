import type { Note } from "./notes";

/** Only the latest earlier report for this exact symbol; no personal ledger data. */
export function previousDebate(notes: Note[], symbol: string, before = Date.now()) {
  const candidates = notes.filter(n => n.kind === "多空辩论" && n.title === `多空辩论 · ${symbol}` && n.ts < before)
    .sort((a, b) => b.ts - a.ts);
  for (const note of candidates) {
    const match = /^## (?:综合判断|裁判)[ \t]*\r?\n/m.exec(note.content);
    const text = match ? note.content.slice(match.index + match[0].length).split(/\r?\n### 数字复核|\r?\n---/)[0]!.trim() : "";
    if (text) return { text: text.slice(0, 6000), at: new Date(note.ts).toISOString() };
  }
  return undefined;
}
