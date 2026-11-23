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

export async function configure(options, deps) {
  const status = await deps.detect();
  if (!status?.available) return { ok: false, stage: 'discovery', status: status?.status ?? 'probe_failed', detail: status?.detail ?? '未能检测 WorkBuddy' };
  if (!options.verify) return { ok: true, stage: 'discovery', status: status.status, version: status.version, verified: false };
  let result;
  try { result = await deps.verify(); }
  catch (error) {
    if (error?.code !== 'agent_not_authenticated') throw error;
    return { ok: false, stage: 'connection', status: 'not_authenticated', verified: false,
      browser_saved: false, next_action: 'confirm_workbuddy_login',
      detail: 'CLI 检测到了账号，但真实对话认证失败。确认 WorkBuddy 内可正常对话后重试；不要复制认证文件。' };
  }
  if (result?.ok !== true) throw new Error('WorkBuddy connection verification did not succeed');
  if (options.persistCLI) await deps.persist();
  const url = new URL('/settings?setup=workbuddy', options.uiURL);
  return { ok: true, stage: 'connection', verified: true, browser_saved: false,
    ...(options.persistCLI ? { cli_path_saved: true, restart_existing_service: true } : {}), setup_url: url.href };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = path.resolve(options.repo);
  if (!fs.existsSync(path.join(repo, 'desktop/src/verticals/finance/components/WorkBuddySetup.tsx'))) throw new Error('项目版本未包含 Skill 自动接入组件，请使用配套 Askill 源码版本');
  const module = file => import(pathToFileURL(path.join(repo, 'orchestrator/src', file)).href);
  await module('finance/register.ts');
  const service = await module('service.ts');
  const runtime = await module('local_agent_runtime.ts');
  const ctx = service.serviceContext({ repoRoot: repo });
  runtime.loadSavedAgentPaths(ctx.dataRoot);
  const originalBin = process.env.CODEBUDDY_BIN;
  if (options.cliPath) {
    if (originalBin) throw new Error('CODEBUDDY_BIN 已由当前环境指定，不能自动替换');
    process.env.CODEBUDDY_BIN = runtime.resolveCodeBuddyLocation(options.cliPath, process.env);
  }
  try {
  const result = await configure(options, {
    detect: async () => (await service.localAgents(ctx, process.env, 'cli-codebuddy'))[0],
    verify: () => service.llmProbe(ctx, { llm: { provider: 'cli-codebuddy' } }),
    persist: async () => {
      // The candidate has already passed a real conversation. Do not persist it earlier.
      const env = { ...process.env };
      delete env.CODEBUDDY_BIN;
      await service.setCodeBuddyLocation(ctx, options.cliPath, env);
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
