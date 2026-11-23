import type { ServiceContext } from "./service.ts";
const services = new Map<string, (ctx:ServiceContext)=>()=>void>();
export function registerBackgroundService(id:string, start:(ctx:ServiceContext)=>()=>void) { services.set(id,start); }
export function startBackgroundServices(ctx:ServiceContext) {
  const stops = [...services.values()].map(start=>start(ctx));
  return () => {
    const errors: unknown[] = [];
    for (const stop of stops) { try { stop(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, "后台服务停止失败");
  };
}
