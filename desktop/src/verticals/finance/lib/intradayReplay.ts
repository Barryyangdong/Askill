import type { IntradayResult, Snapshot } from "../shortline/watchTypes.ts";

/** Only archived market snapshots are replayable. Current verification records have no version history. */
export function replaySnapshots(result: IntradayResult, capturedAt: string): IntradayResult {
  const cutoff = Date.parse(capturedAt);
  const eligible = (s: Snapshot | null) => s !== null && s.date === result.date &&
    Number.isFinite(Date.parse(s.captured_at)) && Date.parse(s.captured_at) <= cutoff;
  const slots = result.slots.filter(row => row.state === "saved" && eligible(row.snapshot));
  const auction = eligible(result.auction) ? result.auction : null;
  return {
    ...result, today: false, slots, auction,
    auction_reason: auction ? null : "所选时刻之前没有可用竞价快照",
    checks: { set_date: null, items: [] },
    warnings: ["仅回看当场保存的市场快照；人工验证记录没有历史版本，不纳入本次回看。"],
    gaps: slots.flatMap(row => row.snapshot?.gaps ?? []),
  };
}
