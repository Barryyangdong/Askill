const code = (value: string | null | undefined) => value && /^(?:\d{6}|\d{5}\.HK|[A-Z][A-Z0-9]{0,9}(?:[.-][A-Z0-9]{1,4})?)$/.test(value) ? value : null;
export function intelReturnLocation(symbol: string, group: number, firstSymbol: string, groupSymbol?: string | null) {
 const restoredSymbol = code(groupSymbol) ?? symbol;
 const params = new URLSearchParams({ symbol: restoredSymbol, group: String(group), firstSymbol });
 return `/workbench?${params}`;
}
export function workbenchRestore(params: URLSearchParams) {
 const group = Number(params.get('group'));
 return { symbol: code(params.get('symbol')), group: [1,2,3].includes(group) ? group : 1, firstSymbol: code(params.get('firstSymbol')) };
}
