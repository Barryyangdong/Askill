/** Real-time events for the local workflow; credentials stay in the request boundary. */
import { ApiError, backend, type DebateNumberAudit, type DebateState } from "./backend.ts";
import { newAnalysisSession } from "./analysisSession.ts";

export type DebateStage = "bull" | "bear" | "bull_rebut" | "bear_rebut" | "bull_reply" | "bear_reply" | "referee";

export interface DebateHandlers {
  onState?: (state: DebateState) => void;
  onPreview?: (stage: DebateStage, text: string) => void;
  onActivity?: () => void;
  onStatus?: (message: string) => void;
  onDossierProgress?: (title: string, ok: boolean, loaded: number, total: number) => void;
  onDossierReady?: (sections: { title: string; tool: string }[], missing: string[]) => void;
  onStageStart?: (stage: DebateStage, label: string) => void;
  onDelta?: (stage: DebateStage, text: string, audit?: DebateNumberAudit) => void;
  onStageDone?: (stage: DebateStage, label: string, content: string) => void;
  onError?: (message: string, stage?: DebateStage) => void;
}

/** Stage state, connection activity and screened paragraph previews share one connection. */
export async function debateStream(
  code: string,
  /**
   * 深度档位。🔴 原来这里叫 `_rounds` —— 下划线前缀声明「我不用它」,
   *    于是界面上那个"一轮 / 两轮"**选了没有任何效果**,永远跑完整五阶段,
   *    而旁边的耗时提示还跟着档位变:告诉你 100 秒 / 3 次调用,实际 6 分钟 / 5 次。
   *    控件说一套、系统做一套,比没有这个控件更糟。
   */
  rounds: number,
  handlers: DebateHandlers = {},
  signal?: AbortSignal,
  previous?: { text: string; at: string },
  resumeId?: string,
): Promise<DebateState | undefined> {
  const emitted = new Set<string>();
  try {
    if (signal?.aborted) return undefined;
    handlers.onStatus?.("正在准备共同资料…");
    const final = await backend.debateRun(code, String(rounds), event => {
      if (signal?.aborted) return;
      handlers.onActivity?.();
      if (event.type === "dossier") {
        const titles: Record<string, string> = { tx_quote: "实时行情", fetch_profile: "公司资料", fetch_financials: "财务数据", indicators_cn: "技术指标", fetch_announcements: "近期公告线索", cninfo_announcements: "近期公告", document_text: "公告正文", em_stock_news: "个股新闻", em_concept_blocks: "所属板块", em_market_breadth: "市场涨跌环境" };
        handlers.onDossierProgress?.(titles[event.title] ?? event.title, event.ok, event.loaded, event.total);
      } else if (event.type === "preview") {
        handlers.onPreview?.(event.stage as DebateStage, event.text);
      } else if (event.type === "state" || event.type === "done") {
        const st = event.state;
        if (!emitted.has("ready")) {
          emitted.add("ready");
          handlers.onDossierReady?.([{ title: `共同资料 ${st.evidence_count} 条`, tool: "取数层" }], st.gaps);
        }
        handlers.onState?.(st);
        for (const stage of st.stages) {
          if (stage.status === "running" && !emitted.has(`start:${stage.id}`)) {
            emitted.add(`start:${stage.id}`);
            handlers.onStageStart?.(stage.id as DebateStage, stage.label);
          }
          if (stage.status === "done" && !emitted.has(`done:${stage.id}`)) {
            emitted.add(`done:${stage.id}`);
            handlers.onDelta?.(stage.id as DebateStage, stage.text, stage.audit);
            handlers.onStageDone?.(stage.id as DebateStage, stage.label, stage.text);
          }
          if (stage.status === "failed" && !emitted.has(`failed:${stage.id}`)) {
            emitted.add(`failed:${stage.id}`);
            handlers.onError?.(stage.error ?? "这个环节未完成", stage.id as DebateStage);
          }
        }
        const active = st.stages.filter(s => s.status === "running").map(s => s.label);
        handlers.onStatus?.(active.length ? `正在生成：${active.join("、")}` : st.done ? "各阶段已结束，正在整理归档…" : "准备下一阶段…");
      }
    }, signal, previous, resumeId);
    if (signal?.aborted) return undefined;
    if (final.outcome === "failed") handlers.onError?.("本次未能完成，请查看各阶段状态。已完成内容保留。");
    return final;
  } catch (error) {
    if (signal?.aborted) return undefined;
    handlers.onError?.(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

export interface ReflectHandlers {
  onStatus?: (message: string) => void;
  onDelta?: (text: string) => void;
  onDone?: (content: string, truncated: boolean) => void;
  onError?: (message: string) => void;
}

/**
 * 对一段已写好的分析做**推理审计**:哪些有数据撑着、哪些是脑补、最脆弱的一环在哪。
 * ⚠️ 明确要求它**只审不建议** —— 审计一旦滑成"那你应该怎么做",就越过产出红线了。
 */
export async function reflectStream(
  source: string,
  title: string,
  handlers: ReflectHandlers = {},
  signal?: AbortSignal,
): Promise<void> {
  try {
    if (signal?.aborted) return;
    handlers.onStatus?.("审计中…");
    // 正文放在页面数据那一段、要求放在问题里：整篇塞进问题，长一点的记录就超过手打问题的 4000 字上限
    const msg = [
      "【当前页面的数据】",
      `标题:${title}`,
      "",
      source || "(没有正文)",
      "",
      "【问题】",
      "回头审上面这段我自己写的推理,逐条标出:哪些结论有数据撑着、哪些是脑补、最脆弱的一环在哪。",
      "**只做审计,不要给我任何操作建议。**",
    ].join("\n");
    const r = await backend.chat(msg, newAnalysisSession("note-reflection"), signal);
    if (signal?.aborted) return;
    handlers.onDelta?.(r.reply);
    handlers.onDone?.(r.reply, false);
  } catch (e) {
    if (signal?.aborted) return;
    handlers.onError?.(e instanceof ApiError ? e.message : String(e));
  }
}
