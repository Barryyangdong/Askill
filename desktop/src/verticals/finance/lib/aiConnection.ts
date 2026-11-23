import { SUBSCRIPTION_MODELS } from "./ai-models.ts";
import { parseAiRuntime, type AiRuntimeRead, type LlmConfig } from "./llmStore.ts";

const SOURCE_LABELS: Record<string, string> = {
  "cli-codex": "Codex订阅版", "cli-claude": "Claude订阅", "cli-codebuddy": "WorkBuddy CLI",
  deepseek: "DeepSeek API", mimo: "MiMo API", "openai-api": "OpenAI API", silicon: "硅基流动 API",
  minimax: "MiniMax API", openrouter: "OpenRouter API", groq: "Groq API", together: "Together API",
  glm: "智谱 GLM API", kimi: "Kimi API", qwen: "通义千问 API",
};

/** 接的是哪家(给人看的名字);认不出的一律叫「自定义 API」 */
export function aiSourceName(provider: string): string {
  return SOURCE_LABELS[provider] ?? "自定义 API";
}

/** Saved connection identity, not a claim that the remote subscription never expires. */
export function aiConnectionLabel(runtime: AiRuntimeRead): string {
  if (runtime.status !== "ok" || !runtime.config) return "未接入AI，请设置";
  return `已接入AI：${aiSourceName(runtime.config.source.provider)}`;
}

export function subscriptionConfig(provider: string): LlmConfig {
  const model = SUBSCRIPTION_MODELS.find((entry) => entry.provider === provider);
  if (!model) throw new Error("不支持的快捷接入方式");
  return { provider: model.provider, model: model.id, baseURL: "", apiKey: "" };
}

interface ConnectionActions {
  read: () => string | null;
  probe: (config: LlmConfig, signal?: AbortSignal) => Promise<{ ok: true }>;
  save: (config: LlmConfig) => void;
}

/** Settings and home share the same probe-before-save contract. Never overwrite a newer choice. */
export async function testAndSaveAi(config: LlmConfig, actions: ConnectionActions, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await probeAndSave(config, actions, actions.read(), signal);
}

async function probeAndSave(config: LlmConfig, actions: ConnectionActions, previous: string | null, signal?: AbortSignal) {
  const probe = await actions.probe(config, signal);
  signal?.throwIfAborted();
  if (probe.ok !== true) throw new Error("连接测试未成功，请重试");
  if (actions.read() !== previous) throw new Error("AI 接入配置已在其他页面更改，请重新确认当前选择");
  actions.save(config);
}

/** Automatic setup may initialize empty storage only; a manual choice belongs to the user. */
export async function connectWorkBuddy(actions: ConnectionActions, signal?: AbortSignal) {
  signal?.throwIfAborted();
  let previous: string | null;
  try { previous = actions.read(); }
  catch { return { ok: false, message: "浏览器无法读取 AI 配置。请检查本地存储权限后重试。" }; }
  const runtime = parseAiRuntime(previous);
  if (runtime.status === "broken") return { ok: false, message: "浏览器已有 AI 配置，但无法解析。请先在设置中核对原配置。" };
  if (runtime.config) {
    if (runtime.config.source.provider === "cli-codebuddy") return { ok: true, message: "此浏览器已保存 WorkBuddy 接入，可返回工作台使用。" };
    return { ok: false, message: "此浏览器已配置其他 AI。如需切换，请在下方选择 WorkBuddy 并测试保存。" };
  }
  await probeAndSave(subscriptionConfig("cli-codebuddy"), actions, previous, signal);
  return { ok: true, message: "WorkBuddy 已通过真实连接测试并保存，可返回工作台使用。" };
}
