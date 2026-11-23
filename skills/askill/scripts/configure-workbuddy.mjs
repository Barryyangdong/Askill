import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function parseArgs(args) {
  const options = { verify: false, repo: '', uiURL: 'http://127.0.0.1:5940' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--verify') options.verify = true;
    else if (arg === '--check') options.verify = false;
    else if (arg === '--persist-cli') options.persistCLI = true;
    else if (arg === '--repo' || arg === '--ui-url' || arg === '--cli-path') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[arg === '--repo' ? 'repo' : arg === '--cli-path' ? 'cliPath' : 'uiURL'] = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.repo || !path.isAbsolute(options.repo)) throw new Error('--repo must be an absolute project path');
  if (options.cliPath && !path.isAbsolute(options.cliPath)) throw new Error('--cli-path must be absolute');
  if (options.persistCLI && (!options.verify || !options.cliPath)) throw new Error('--persist-cli requires --verify and --cli-path');
  const url = new URL(options.uiURL);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('--ui-url must be a local HTTP origin');
  return options;
}

function failure(stage, status, selected = status) {
  const result = { ok: false, stage, status: status?.status ?? 'probe_failed',
    detail: status?.detail ?? '未能检测 WorkBuddy / CodeBuddy CLI', verified: false, browser_saved: false };
  if (result.status === 'not_authenticated') {
    const standalone = (status?.cli_kind ?? selected?.cli_kind) === 'standalone';
    if (standalone) result.cli_path = selected?.cli_path;
    result.next_action = standalone ? 'login_codebuddy_cli' : 'confirm_workbuddy_login';
    result.detail = standalone
      ? '请在当前独立 CodeBuddy CLI 中完成官方登录（login-codebuddy.mjs），然后重新验证。'
      : '请确认 WorkBuddy 桌面版已登录并可正常对话，然后重新验证。';
  }
  return result;
}

export function requireCompatibleRuntime(runtime) {
  if (typeof runtime.resolveSavableCodeBuddyLocation !== 'function' || typeof runtime.probeCodeBuddyForSetup !== 'function')
    throw new Error('当前 Askill 源码缺少新版 Skill 的 CLI 验证与安全保存能力，请先更新配套源码并重启已有服务。');
}

export async function configure(options, deps) {
  const status = await deps.detect();
  if (!status?.available || status.status !== 'ready') return failure('discovery', status);
  if (!options.verify) return { ok: true, stage: 'discovery', status: status.status, version: status.version, verified: false };
  let result;
  try { result = await deps.verify(status.cli_path); }
  catch (error) {
    if (error?.code !== 'agent_not_authenticated') throw error;
    return failure('connection', { status: 'not_authenticated' }, status);
  }
  if (result?.ok !== true) throw new Error('WorkBuddy connection verification did not succeed');
  if (options.persistCLI) {
    const saved = await deps.persist();
    if (!saved?.available || saved.status !== 'ready') return failure('persistence', saved, status);
    if (!saved.custom_path || !saved.saved_path)
      return failure('persistence', { status: 'path_not_saved', detail: 'CLI 仍可运行，但指定路径未生效。' });
  }
  const url = new URL('/settings?setup=workbuddy', options.uiURL);
  return { ok: true, stage: 'connection', verified: true, browser_saved: false,
    ...(options.persistCLI ? { cli_path_saved: true, cli_path: options.cliPath, restart_existing_service: true } : {}), setup_url: url.href };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = path.resolve(options.repo);
  if (!fs.existsSync(path.join(repo, 'desktop/src/verticals/finance/components/WorkBuddySetup.tsx'))) throw new Error('项目版本未包含 Skill 自动接入组件，请使用配套 Askill 源码版本');
  const module = file => import(pathToFileURL(path.join(repo, 'orchestrator/src', file)).href);
  await module('finance/register.ts');
  const service = await module('service.ts');
  const runtime = await module('local_agent_runtime.ts');
  requireCompatibleRuntime(runtime);
  const ctx = service.serviceContext({ repoRoot: repo });
  runtime.loadSavedAgentPaths(ctx.dataRoot);
  const originalBin = process.env.CODEBUDDY_BIN;
  if (options.cliPath) {
    if (originalBin) throw new Error('CODEBUDDY_BIN 已由当前环境指定，不能自动替换');
    options.cliPath = runtime.resolveSavableCodeBuddyLocation(ctx.dataRoot, options.cliPath, process.env);
    process.env.CODEBUDDY_BIN = options.cliPath;
  }
  try {
    const result = await configure(options, {
      detect: () => runtime.probeCodeBuddyForSetup(process.env),
      verify: cliPath => {
        process.env.CODEBUDDY_BIN = cliPath;
        return service.llmProbe(ctx, { llm: { provider: 'cli-codebuddy' } });
      },
      persist: async () => {
        // The candidate has already passed a real conversation. Do not persist it earlier.
        const env = { ...process.env };
        delete env.CODEBUDDY_BIN;
        return service.setCodeBuddyLocation(ctx, options.cliPath, env, true);
      },
    });
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 2;
  } finally {
    if (originalBin === undefined) delete process.env.CODEBUDDY_BIN;
    else process.env.CODEBUDDY_BIN = originalBin;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(JSON.stringify({ ok: false, stage: 'setup', code: error?.code ?? 'setup_failed', error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; });
}
