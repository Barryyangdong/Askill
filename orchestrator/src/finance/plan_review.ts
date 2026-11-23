import {listRecords,upsertRecord} from '../ledger.ts';
import {registerView} from '../views.ts';
import {ServiceError,type ServiceContext} from '../service.ts';

export function planReviewData(ctx:Pick<ServiceContext,'dataRoot'>){
 const criteria=listRecords(ctx.dataRoot,'criterion');
 const reviews=listRecords(ctx.dataRoot,'plan_review').reverse().sort((a,b)=>b.created_at.localeCompare(a.created_at));
 const latest=new Map<string,typeof reviews[number]>();
 for(const r of reviews)if(!latest.has(String(r.criterion_id)))latest.set(String(r.criterion_id),r);
 const counts:Record<string,number>={unreviewed:0,stale:0,not_triggered:0,unexecuted:0,as_planned:0,deviation:0,unknown:0};
 for(const c of criteria){const r=latest.get(c.id);const saved=(r?.snapshot as {criterion?:unknown}|undefined)?.criterion;
   const state=!r?'unreviewed':JSON.stringify(saved)!==JSON.stringify(c)?'stale':String(r.outcome);counts[state]++;
 }
 return {criteria,reviews,trades:listRecords(ctx.dataRoot,'trade'),counts};
}
export function savePlanReview(ctx:Pick<ServiceContext,'dataRoot'>,body:Record<string,unknown>){
 const criterion=listRecords(ctx.dataRoot,'criterion').find(r=>r.id===body.criterion_id);
 if(!criterion)throw new ServiceError('bad_request','观察条件不存在');
 if(!['not_triggered','unexecuted','as_planned','deviation','unknown'].includes(String(body.outcome)))throw new ServiceError('bad_request','复核分类无效');
 if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>2000)throw new ServiceError('bad_request','请填写复核依据（最多 2000 字）');
 if(!Array.isArray(body.trade_ids)||body.trade_ids.length>50||body.trade_ids.some(x=>typeof x!=='string')||new Set(body.trade_ids).size!==body.trade_ids.length)throw new ServiceError('bad_request','成交关联无效');
 const trades=listRecords(ctx.dataRoot,'trade');
 const selected=body.trade_ids.map(id=>trades.find(r=>r.id===id));
 if(selected.some(r=>!r||!criterion.symbol||r.symbol!==criterion.symbol))throw new ServiceError('bad_request','只能关联同一股票的已有成交');
 if(['as_planned','deviation'].includes(String(body.outcome))&&!selected.length)throw new ServiceError('bad_request','执行复核需要关联已有成交；没有明细时请选择证据不足');
 if(['not_triggered','unexecuted'].includes(String(body.outcome))&&selected.length)throw new ServiceError('bad_request','未执行分类不能同时关联已执行成交');
 if(body.outcome==='not_triggered'&&criterion.status==='met')throw new ServiceError('bad_request','条件已有命中记录，请核对依据；存在争议时选择证据不足');
 if(body.outcome==='unexecuted'&&criterion.status!=='met')throw new ServiceError('bad_request','尚无条件命中记录，不能认定发生但未执行；请先核验条件或选择证据不足');
 const result=upsertRecord(ctx.dataRoot,'plan_review',{
   criterion_id:criterion.id,symbol:criterion.symbol,outcome:body.outcome,reason:body.reason.trim(),trade_ids:body.trade_ids,
   snapshot:{criterion, trades:selected, reviewed_at:new Date().toISOString()},
 });
 return result;
}
registerView({id:'plan_review',label:'计划执行复核',run:async ctx=>planReviewData(ctx),act:async(ctx,body)=>savePlanReview(ctx,body)});
