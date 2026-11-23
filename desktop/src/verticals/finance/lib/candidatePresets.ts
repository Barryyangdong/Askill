import { formError, parseStoredForm, type CandidateForm } from "./candidates.ts";

export const PRESETS_KEY = "Askill-candidate-presets-v1";
export interface CandidatePreset { name: string; form: CandidateForm }

export function parsePresets(raw: string | null): CandidatePreset[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value)) return [];
    const names = new Set<string>();
    return value.flatMap((item): CandidatePreset[] => {
      if (!item || typeof item.name !== "string" || !item.form || typeof item.form !== "object") return [];
      const name = item.name.trim().slice(0, 40);
      const form = parseStoredForm(JSON.stringify(item.form));
      if (!name || names.has(name) || formError(form)) return [];
      names.add(name);
      return [{ name, form }];
    }).slice(0, 20);
  } catch { return []; }
}

/** Explicit saves must report storage failure; never claim a preset was persisted when it wasn't. */
export function persistPresets(storage: Pick<Storage, "setItem"> | undefined, presets: CandidatePreset[]): void {
  if (!storage) throw new Error("浏览器存储不可用，方案未保存");
  try { storage.setItem(PRESETS_KEY, JSON.stringify(presets)); }
  catch { throw new Error("浏览器存储不可用或已满，方案未保存"); }
}
