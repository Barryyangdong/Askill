import type {MarketHealthData} from '../lib/marketPatterns';
export function MarketHealth({data}:{data:MarketHealthData}){
 return <details className="mt-3 text-xs"><summary>今日采集记录 · {data.cycles}轮 · {data.failures}轮异常</summary>
 {data.error&&<p role="alert" className="my-2 text-warning">{data.error}</p>}
 {data.acceptance&&<div className="my-3 rounded border border-border p-3"><strong>全天快照验收 · {({passed:'通过',failed:'未通过',pending:'交易时段尚未结束',unconfirmed:'交易日未确认'})[data.acceptance.status]}</strong><p className="my-2">有效时段 {data.acceptance.covered_slots} / {data.acceptance.expected_slots} · 最长未达标缺口 {data.acceptance.max_gap_seconds}秒</p><p className="text-muted-foreground">09:30–11:30、13:00–15:00，每30秒一格。每格须有至少99%名单股票的60秒内报价；全天达标格≥95%，连续缺口≤120秒。午休不计，收盘后补采不补回盘中缺口；不包含盘前竞价或逐笔推送验收。</p>{data.acceptance.gaps.length>0&&<details className="mt-2"><summary>未达标时段 · {data.acceptance.gaps.length}段</summary>{data.acceptance.gaps.map(g=><p key={g.from}>{new Date(g.from).toLocaleTimeString('zh-CN')}–{new Date(g.to).toLocaleTimeString('zh-CN')} · {g.seconds}秒</p>)}</details>}</div>}
 {data.cycles===0?<p className="my-2 text-muted-foreground">尚无采集记录，不能判断持续稳定性。</p>:<>
 <p className="my-2 text-muted-foreground">从 {data.first_at?new Date(data.first_at).toLocaleTimeString('zh-CN'):'—'} 开始留存 · 95%轮次耗时不超过 {data.p95_ms===null?'—':(data.p95_ms/1000).toFixed(1)+'秒'} · 完成时最低新鲜覆盖 {data.lowest_fresh_ratio===null?'—':(data.lowest_fresh_ratio*100).toFixed(2)+'%'}</p>
 <p className="mb-2 text-muted-foreground">仅统计实际记录的轮次；停机空白不算成功，不能据此认定全天无中断。展示最近30轮。</p>
 <div className="max-h-64 overflow-auto"><table className="w-full text-left tabular-nums"><thead><tr><th>完成时间</th><th>耗时</th><th>新鲜 / 总数</th><th>缺价 / 时间未知</th><th>状态</th></tr></thead><tbody>{data.rows.map(r=><tr key={r.started_at} className="border-t border-border"><td className="py-2 whitespace-nowrap">{new Date(r.finished_at).toLocaleTimeString('zh-CN')}</td><td>{(r.duration_ms/1000).toFixed(1)}秒</td><td>{r.fresh} / {r.expected??'未知'}</td><td>{r.missing} / {r.unknown}</td><td className={r.error?'text-warning':''}>{r.error??'完成'}</td></tr>)}</tbody></table></div></>}
 </details>;
}
