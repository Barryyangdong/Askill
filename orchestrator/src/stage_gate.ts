/** Shared stage-text gate for tool submission and final validation. */
import { gateRegexps, gateStagePatterns } from "./config.ts";
import { complianceGate } from "./gate.ts";

// Only constrained identifiers/enums are excluded. Free-text fields, including
// operation, must still be checked recursively as the contract evolves.
const NON_PROSE_KEYS = new Set(["evidence_ids", "calculation_ids", "raw_ref", "id", "calculation_id", "stage", "status", "reason_code"]);
export function proseStrings(v: unknown, key = ""): string[] {
  if (typeof v === "string") return NON_PROSE_KEYS.has(key) ? [] : [v];
  if (Array.isArray(v)) return v.flatMap((x) => proseStrings(x, key));
  if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => proseStrings(x, k));
  return [];
}

export function stageComplianceErrors(stage: string, output: unknown): string[] {
  // Separate fields by a blank line, matching final-validation semantics.
  const gate = complianceGate(proseStrings(output).join("\n\n"), gateStagePatterns(), [], gateRegexps());
  return gate.hits.map(hit => `阶段 ${stage} 的产物文本触发产出红线(${hit.pattern}):${hit.text.slice(0, 100)}`);
}
