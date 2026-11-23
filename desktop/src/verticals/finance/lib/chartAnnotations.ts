export interface ChartLine {id:string; context:string; price:number; label:string; createdAt:string}
export interface ChartSettings {lines:ChartLine[];template:'ma'|'bands'|'plain'}
export function parseChartSettings(raw:unknown):ChartSettings {
 const value=raw as Partial<ChartSettings>|null;
 return {lines:parseChartLines(Array.isArray(raw)?raw:value?.lines),template:value?.template==='bands'||value?.template==='plain'?value.template:'ma'};
}
export function parseChartLines(raw:unknown): ChartLine[] {
  if(!Array.isArray(raw)) return [];
  return raw.filter((v):v is ChartLine=>Boolean(v&&typeof v==='object'&&typeof v.id==='string'&&typeof v.context==='string'&&typeof v.price==='number'&&Number.isFinite(v.price)&&v.price>0&&typeof v.label==='string'&&v.label.length<=40&&typeof v.createdAt==='string'&&Number.isFinite(Date.parse(v.createdAt)))).slice(-200);
}
export function visibleChartLines(lines:ChartLine[],context:string,hide:boolean,replay:boolean){
  // 当前添加的标注不能出现在历史回看中，也不得绕过隐私遮罩。
  return hide||replay?[]:lines.filter(line=>line.context===context);
}
