import type { InboxItem } from './notify.ts';
/** Legacy dates come only from stored business text, never arrival time. */
export function reminderTarget(x: Pick<InboxItem,'title'|'lines'|'link'> & Partial<Pick<InboxItem,'id'|'job'>>) {
 const close=/^收盘摘要 (\d{4}-\d{2}-\d{2})$/.exec(x.title);
 const pre=/^盘前提醒 (\d{4}-\d{2}-\d{2})$/.exec(x.title);
 if(close)return {link:`/shortline?date=${close[1]}&reminder=close`,note:`摘要业务日 ${close[1]}；原摘要保留如下，历史页仅展示当日情绪数据。`};
 if(pre){const sample=x.lines.map(l=>/^(\d{4}-\d{2}-\d{2}) (?:连板|没有连板股)/.exec(l)?.[1]).find(Boolean);
 const explicit=x.link?.startsWith('/shortline?')?x.link:undefined;
 return {link:explicit??(sample?`/shortline?date=${sample}&reminder=premarket&reminderDay=${pre[1]}`:undefined),note:`提醒日 ${pre[1]}；${sample?`前一交易日样本 ${sample}`:'旧记录未能定位样本日，请阅读原消息' }。`};}
 if(x.link==='/daily-review'||x.link==='/shortline')return {link:undefined,note:'旧记录未能定位业务日，请阅读原消息。'};
 if(x.link==='/calendar')return {link:x.link,note:'旧提醒没有对象 ID，无法关联原待判集合；打开后请逐条核对，已读不代表已复核。'};
 if(x.job==='observation'&&x.id?.startsWith('criterion-'))return {link:`/observations?id=${encodeURIComponent(x.id.slice(10))}`,note:'按原消息的计划 ID 定位，已读不改变计划状态。'};
 if(x.link?.startsWith('/observations?symbol='))return {link:undefined,note:'旧提醒没有计划 ID，无法定位原计划，请阅读原消息。'};
 return {link:x.link,note:x.link?.startsWith('/calendar')?'已读只标记消息；仍需逐条复核并确认裁决。':''};
}
