import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './configure-workbuddy.mjs';

function failure(stage, code, message) {
  return Object.assign(new Error(message), { stage, code });
}

function samePath(a, b) {
  if (typeof a !== 'string' || !path.isAbsolute(a) || !path.isAbsolute(b)) return false;
  try {
    return path.relative(fs.realpathSync.native(a), fs.realpathSync.native(b)) === '';
  } catch { return false; }
}

async function request(fetcher, origin, route, stage, body) {
  let response;
  try {
    response = await fetcher(new URL('/api/' + route, origin), {
      redirect: 'error', signal: AbortSignal.timeout(stage === 'instance' ? 10000 : 180000),
      ...(body === undefined ? {} : { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    throw failure(stage, 'service_unreachable', '本机页面代理没有完成请求，请检查当前实例与端口。');
  }
  let json;
  try { json = await response.json(); } catch { throw failure(stage, 'unexpected_response', '本机页面代理未返回有效 JSON。'); }
  if (!response.ok) {
    const code = typeof json?.error === 'string' && /^[a-z][a-z0-9_]{0,64}$/.test(json.error) ? json.error : 'http_error';
    const err = failure(stage, code, '本机服务请求未通过（HTTP ' + response.status + '）。');
    // Older compatible services identify strict path validation by its error. Never report response bodies.
    err.strictPathValidation = response.status === 400 && code === 'bad_agent_path' && json.message === 'require_ready 必须是布尔值';
    throw err;
  }
  return json;
}

export async function verifyWorkBuddyInstance(options, deps = {}) {
  const { repo, uiURL } = parseArgs(['--repo', options.repo, '--ui-url', options.uiURL]);
  const origin = new URL(uiURL).origin;
  const info = await request(deps.fetch ?? fetch, origin, 'product', 'instance');
  const configFile = path.join(repo, 'vibe-research.config.json');
  const { resolveDataRoot, readConfiguredDataRoot } = await import(pathToFileURL(path.join(repo, 'orchestrator/src/data_root.ts')).href);
  const dataRoot = resolveDataRoot(repo, readConfiguredDataRoot(repo), deps.env ?? process.env);
  if (!Array.isArray(info?.sources) || !info.sources.some(source => samePath(source, configFile)) || !samePath(info.paths?.data_root, dataRoot)) {
    throw failure('instance', 'instance_mismatch', '页面服务与所选项目的源码或数据目录不匹配。');
  }
  return { ok: true, stage: 'instance', uiURL: origin, dataRoot, capabilities: info.capabilities ?? {} };
}

async function canReload(instance, fetcher) {
  if (instance.capabilities.workbuddy_require_ready === true) return true;
  // Both generations reject a non-string path without running a binary or changing settings.
  // Only the generation with strict writes first rejects the non-boolean require_ready.
  try {
    await request(fetcher, instance.uiURL, 'local-agents/codebuddy/path', 'instance', { path: {}, require_ready: 'capability-check' });
  } catch (err) { return err.strictPathValidation === true; }
  return false;
}

export function openDefaultBrowser(url) {
  const [command, args] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true, detached: true });
    // Some desktop launchers stay alive for the browser session.
    const timer = setTimeout(() => { child.unref(); resolve(true); }, 2500);
    child.once('error', () => { clearTimeout(timer); resolve(false); });
    child.once('exit', code => { clearTimeout(timer); resolve(code === 0); });
  });
}

export async function finishWorkBuddy(options, deps = {}) {
  const fetcher = deps.fetch ?? fetch;
  try {
    const instance = await verifyWorkBuddyInstance(options, deps);
    if (options.expectedCliPath) {
      if (options.cliPath || !path.isAbsolute(options.expectedCliPath)) throw failure('instance', 'bad_cli_path', '只读核验需要单独提供 CLI 文件绝对路径。');
      if (!instance.capabilities.workbuddy_match_path) return { ok: false, stage: 'instance', code: 'cannot_confirm_locked_cli', next_action: 'restart_verified_instance', browser_saved: false };
      const check = await request(fetcher, instance.uiURL, 'local-agents/codebuddy/match', 'connection', { path: options.expectedCliPath });
      if (check?.matches !== true) return { ok: false, stage: 'instance', code: 'locked_cli_mismatch', next_action: 'restart_verified_instance', browser_saved: false };
    }
    if (options.cliPath) {
      if (!path.isAbsolute(options.cliPath) || !fs.statSync(options.cliPath, { throwIfNoEntry: false })?.isFile()) {
        throw failure('persistence', 'bad_cli_path', '需要已经过真实验证的 CLI 文件绝对路径。');
      }
      if (!await canReload(instance, fetcher)) return { ok: false, stage: 'instance', code: 'requires_updated_service', next_action: 'restart_verified_instance', browser_saved: false };
      const state = await request(fetcher, instance.uiURL, 'local-agents/codebuddy/path', 'persistence', { path: options.cliPath, require_ready: true });
      if (!(state?.provider === 'cli-codebuddy' && state.status === 'ready' && state.available && state.saved_path && state.custom_path)) {
        throw failure('persistence', 'cli_path_not_active', '运行中的工作台未确认所选 CLI 已生效。');
      }
    }
    const probe = await request(fetcher, instance.uiURL, 'llm-probe', 'connection', { llm: { provider: 'cli-codebuddy', model: 'codebuddy', baseURL: '', apiKey: '' } });
    if (probe?.ok !== true) throw failure('connection', 'probe_failed', '运行中的工作台未通过真实连接测试。');
    const setup_url = new URL('/settings?setup=workbuddy&next=workbench', instance.uiURL).href;
    let browser_opened = false;
    if (options.openBrowser !== false) {
      try { browser_opened = await (deps.openBrowser ?? openDefaultBrowser)(setup_url); } catch { /* Caller can offer the same link. */ }
    }
    return { ok: true, stage: 'connection', verified: true, browser_saved: false, browser_opened, setup_url };
  } catch (err) {
    return { ok: false, stage: err.stage ?? 'instance', code: err.code ?? 'invalid_setup', browser_saved: false,
      detail: err.stage ? err.message : '请检查项目目录、正在运行的配套服务和本机页面地址。' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const noOpen = args.includes('--no-open');
    if (!args.includes('--ui-url')) throw new Error('--ui-url is required');
    const options = parseArgs(args.filter(arg => arg !== '--no-open'));
    const result = await finishWorkBuddy({ ...options, openBrowser: !noOpen });
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 2;
  } catch { console.error(JSON.stringify({ ok: false, stage: 'arguments', code: 'invalid_arguments' })); process.exitCode = 1; }
}
