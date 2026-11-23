import fs from "node:fs";
import path from "node:path";
import { readJson } from "../fsutil.ts";
import type { ArchiveMarketDay } from "./mentor_case_comparison.ts";

// These sessions come from the reviewed, bundled 2017 archive. Retain only its
// market projection; participant-specific holdings, statements and actions stay in their pack.
let cached: {file:string; modified:number; size:number; days:Map<string,ArchiveMarketDay>} | undefined;
export function sharedArchiveMarketDay(repoRoot:string, day:string):ArchiveMarketDay | undefined {
  const file = path.join(repoRoot,"knowledge","mentors","tuixue.json");
  const stat = fs.statSync(file,{throwIfNoEntry:false});
  if (!stat?.isFile()) return undefined;
  if (!cached || cached.file!==file || cached.modified!==stat.mtimeMs || cached.size!==stat.size) {
    const source = readJson<{cases:ArchiveMarketDay[]}>(file);
    const days = new Map<string,ArchiveMarketDay>();
    for (const {date,market,scene} of source.cases) {
      if (scene?.asOf===date+"T15:00:00+08:00") days.set(date,{date,market,scene});
    }
    cached = {file,modified:stat.mtimeMs,size:stat.size,days};
  }
  return cached.days.get(day);
}
