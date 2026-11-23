import fs from "node:fs";
import path from "node:path";

const KEYS = new Set(["workspace", "candidate-presets", "candidate-form", "workbench", "chart-settings"]);
export function preference(root: string, key: string) {
  if (!KEYS.has(key)) throw new Error("Unsupported preference");
  const file = path.join(root, "preferences", `${key}.json`);
  if (!fs.existsSync(file)) return { revision: 0, value: null };
  return JSON.parse(fs.readFileSync(file, "utf8")) as {revision: number; value: unknown};
}
export function savePreference(root: string, key: string, value: unknown, expected: number) {
  const prev = preference(root, key);
  if (prev.revision !== expected) throw new Error("设置已在其他窗口更新，请重新载入后修改。");
  const next = { revision: prev.revision + 1, value };
  const json = JSON.stringify(next);
  if (Buffer.byteLength(json) > 128000) throw new Error("设置内容过大");
  const dir = path.join(root, "preferences"); fs.mkdirSync(dir, {recursive:true});
  const file = path.join(dir, `${key}.json`);
  if (fs.existsSync(file)) fs.copyFileSync(file, file + ".backup");
  fs.writeFileSync(file + ".tmp", json, {mode:0o600}); fs.renameSync(file + ".tmp", file);
  return next;
}

export function preferenceBackup(root: string) {
  return {version:1,created_at:new Date().toISOString(),preferences:Object.fromEntries([...KEYS].map(key=>[key,preference(root,key)]))};
}
export function restorePreferences(root:string, input:unknown) {
  const bundle=input as ReturnType<typeof preferenceBackup>;
  if(!bundle||bundle.version!==1||!bundle.preferences||typeof bundle.preferences!=="object"||Array.isArray(bundle.preferences))throw Error("Invalid backup format");
  const entries=Object.entries(bundle.preferences);
  if(!entries.length||entries.some(([key,item])=>!KEYS.has(key)||!item||!Number.isInteger(item.revision)||!Object.hasOwn(item,"value"))||Buffer.byteLength(JSON.stringify(bundle))>640000)throw Error("Invalid backup entries");
  // Validate every entry before the first write. Preserve the previous complete bundle.
  for(const [,item] of entries)if(Buffer.byteLength(JSON.stringify(item))>128000)throw Error("Preference too large");
  const before=preferenceBackup(root);
  const dir=path.join(root,"preferences");fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,"before-restore.json"),JSON.stringify(before),{mode:0o600});
  try { for(const [key,item] of entries)savePreference(root,key,item.value,preference(root,key).revision); }
  catch(error) {
    for(const [key,item] of Object.entries(before.preferences)) {
      const file=path.join(dir,`${key}.json`);
      if(item.revision===0)fs.rmSync(file,{force:true});
      else {fs.writeFileSync(file+".tmp",JSON.stringify(item),{mode:0o600});fs.renameSync(file+".tmp",file);}
    }
    throw error;
  }
  return {restored:entries.length};
}
