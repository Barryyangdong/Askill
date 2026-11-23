import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeMarketSymbol } from "../lib/marketSymbol";

export type ThemeStock = { code: string; name: string; role?: "龙头" | "领涨" };
export type ManagedTheme = { id: string; name: string; parentId: string | null; stocks: ThemeStock[]; createdAt?: string; updatedAt?: string };
export type ThemeSource = { name: string; stocks: ThemeStock[]; parent?: string };
export type ThemeCommand =
  | { type: "create"; names: string[]; parentId: string | null; stocks?: ThemeStock[] }
  | { type: "rename"; id: string; name: string; parentId: string | null }
  | { type: "delete"; id: string }
  | { type: "add"; id: string; stocks: ThemeStock[] }
  | { type: "remove"; id: string; code: string }
  | { type: "role"; id: string; code: string; role?: ThemeStock["role"] };

function validName(name: string) {
  const text = name.trim();
  if (!text || text.length > 80) throw new Error("题材名称须为 1 至 80 个字。");
  return text;
}

export function parseThemeStocks(text: string): ThemeStock[] {
  const rows = text.trim().split(/[\n,，;；]+/).map(s => s.trim()).filter(Boolean);
  return rows.map(row => {
    const [symbol, ...rest] = row.split(/\s+/);
    const code = normalizeMarketSymbol(symbol);
    if (!code || !/^\d{6}$/.test(code)) throw new Error(`请核对股票代码「${symbol}」。`);
    return {code, name: rest.join(" ").trim()};
  });
}

function mergeStocks(previous: ThemeStock[], added: ThemeStock[]) {
  const stocks = new Map(previous.map(s => [s.code, s]));
  for (const stock of added) {
    if (!/^\d{6}$/.test(stock.code)) throw new Error(`无法识别股票代码「${stock.code}」。`);
    const role = stocks.get(stock.code)?.role ?? stock.role;
    stocks.set(stock.code, {code: stock.code, name: stock.name.trim() || stocks.get(stock.code)?.name || "", ...(role ? {role} : {})});
  }
  return [...stocks.values()];
}

export function applyThemeCommand(themes: ManagedTheme[], cmd: ThemeCommand): ManagedTheme[] {
  if (cmd.type === "create" || cmd.type === "rename") {
    if (cmd.parentId && !themes.some(t => t.id === cmd.parentId && t.parentId === null))
      throw new Error("请选择现有一级题材。");
    const occupied = new Set(themes.filter(t => t.parentId === cmd.parentId && !(cmd.type === "rename" && t.id === cmd.id)).map(t => t.name));
    const names = (cmd.type === "create" ? cmd.names : [cmd.name]).map(validName);
    if (!names.length) throw new Error("请填写题材名称。");
    for (const name of names) {
      if (occupied.has(name)) throw new Error(`同一层级已有「${name}」。`);
      occupied.add(name);
    }
    if (cmd.type === "create") {
      const now = new Date().toISOString();
      return [...themes, ...names.map(name => ({
        id: crypto.randomUUID(), name, parentId: cmd.parentId, stocks: mergeStocks([], cmd.stocks ?? []), createdAt:now, updatedAt:now,
      }))];
    }
    if (cmd.parentId && (cmd.parentId === cmd.id || themes.some(t => t.parentId === cmd.id)))
      throw new Error("含二级题材的目录和题材自身须保留在一级。");
  }
  const selected = themes.find(t => t.id === cmd.id);
  if (!selected) throw new Error("该题材已被删除，请重新选择。");
  if (cmd.type === "delete") {
    if (themes.some(t => t.parentId === cmd.id)) throw new Error("请先移出或删除下属二级题材。");
    return themes.filter(t => t.id !== cmd.id);
  }
  const updated = cmd.type === "rename" ? { ...selected, name: cmd.name.trim(), parentId: cmd.parentId }
    : { ...selected, stocks: cmd.type === "remove" ? selected.stocks.filter(s => s.code !== cmd.code) : cmd.type === "role" ? selected.stocks.map(s => s.code === cmd.code ? { ...s, role: cmd.role } : s) : mergeStocks(selected.stocks, cmd.stocks) };
  return themes.map(t => t.id === cmd.id ? { ...updated, updatedAt:new Date().toISOString() } : t);
}

const databaseName = "Askill-theme-catalog";
let connection: Promise<IDBDatabase> | undefined;
function openCatalog() {
  if (!connection) connection = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(databaseName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("library");
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); connection = undefined; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  }).catch(error => { connection = undefined; throw error; });
  return connection;
}

async function transact(command?: ThemeCommand): Promise<ManagedTheme[]> {
  const db = await openCatalog();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("library", command ? "readwrite" : "readonly");
    const store = transaction.objectStore("library");
    const read = store.get("themes");
    let result: ManagedTheme[] = [];
    let failure: unknown;
    read.onsuccess = () => {
      try {
        result = read.result ?? [];
        if (command) { result = applyThemeCommand(result, command); store.put(result, "themes"); }
      } catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("题材库保存失败。"));
  });
}

export function useThemeCatalog() {
  const [themes, setThemes] = useState<ManagedTheme[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const channel = useRef<BroadcastChannel | null>(null);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const request = ++seq.current;
    try {
      const data = await transact();
      if (request === seq.current) { setThemes(data); setError(""); setReady(true); }
    } catch (e) {
      if (request === seq.current) { setError(e instanceof Error ? e.message : "无法读取题材库"); setReady(false); }
    }
  }, []);
  useEffect(() => {
    void reload();
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel(databaseName);
      channel.current.onmessage = reload;
    }
    window.addEventListener(databaseName, reload);
    window.addEventListener("focus", reload);
    return () => { ++seq.current; channel.current?.close(); channel.current = null;
      window.removeEventListener(databaseName, reload); window.removeEventListener("focus", reload); };
  }, [reload]);
  const mutate = useCallback(async (command: ThemeCommand) => {
    const next = await transact(command);
    window.dispatchEvent(new Event(databaseName));
    channel.current?.postMessage("updated");
    return next;
  }, []);
  return { themes, error, ready, reload, mutate };
}
