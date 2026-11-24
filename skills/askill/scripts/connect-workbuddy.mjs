import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, requireCompatibleRuntime } from './configure-workbuddy.mjs';
import { installCLI, installedEntry } from './install-codebuddy.mjs';

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

export function parseConnectArgs(args) {
  const common = [];
  const seen = new Set();
  let site = 'cn';
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!['--repo', '--ui-url', '--cli-path', '--site'].includes(flag) || seen.has(flag) || !value || value.startsWith('--'))
      throw new Error('Usage: --repo ABS_REPO --ui-url LOOPBACK_ORIGIN [--cli-path ABS_CLI] [--site cn|international]');
    seen.add(flag);
    if (flag === '--site') site = value;
    else common.push(flag, value);
  }
  if (!seen.has('--ui-url')) throw new Error('--ui-url must be the actual running Askill UI origin');
  if (!['cn', 'international'].includes(site)) throw new Error('--site must be cn or international');
  return { ...parseArgs(common), site };
}

const key = file => process.platform === 'win32' ? path.normalize(file).toLowerCase() : path.normalize(file);

export async function connectWorkBuddy(options, deps) {
  let stage = 'instance';
  try {
    const instance = await deps.instance(options);
    if (!instance?.ok) return { ...instance, ok: false, verified: false, browser_saved: false };
    stage = 'discovery';
    const requested = options.cliPath ? deps.resolve(options.cliPath) : undefined;
    const locked = deps.lockedCli;
    if (requested && locked && key(requested) !== key(locked))
      throw problem('agent_path_env_locked', 'CODEBUDDY_BIN 已指定其他 CLI，请核对当前环境。');
    const pinned = requested || locked;
    let candidate = await deps.discover(pinned);
    if (requested && candidate && key(requested) !== key(candidate.path))
      throw problem('unexpected_candidate', '检测结果与用户选定的 CLI 不一致。');
    let persist = Boolean(requested && !locked);

    async function verify() {
      stage = 'verification';
      if (!candidate) return 'agent_not_installed';
      try {
        const result = await deps.verify(candidate.path);
        if (result?.ok !== true) throw problem('probe_failed', '模型未通过真实连接验证。');
        return 'ready';
      } catch (error) {
        if (['agent_not_authenticated', 'agent_cli_too_old', 'agent_not_installed'].includes(error?.code)) return error.code;
        throw error;
      }
    }

    async function verifyAndAuthorize() {
      const status = await verify();
      if (status !== 'agent_not_authenticated') return status;
      stage = 'authorization';
      try {
        await deps.authorize({ repo: options.repo, cliPath: candidate.path, site: options.site ?? 'cn',
          realAuthRejected: true, onProgress: deps.onProgress });
      } catch (error) {
        if (error?.code === 'auth_unsupported') return 'auth_unsupported';
        if (error?.code !== 'auth_session_exists') throw error;
      }
      if (candidate.kind === 'standalone' && !locked) persist = true;
      return verify();
    }

    let status = await verifyAndAuthorize();
    if (!pinned && !candidate?.saved && ['agent_not_installed', 'agent_cli_too_old', 'auth_unsupported'].includes(status)) {
      stage = 'cli_install';
      const installed = await deps.install(instance.dataRoot);
      const selected = deps.resolve(installed.cli_path);
      if (candidate && key(selected) === key(candidate.path) && installed.reused)
        throw problem(status, '已安装的官方独立 CLI 也未提供所需能力，请更新该 CLI。');
      candidate = await deps.discover(selected);
      if (!candidate || key(candidate.path) !== key(selected) || candidate.kind !== 'standalone')
        throw problem('unexpected_candidate', '无法在官方安装目录确认独立 CLI。');
      persist = true;
      status = await verifyAndAuthorize();
    }
    if (status !== 'ready') {
      const detail = { agent_not_installed: '未找到选定的 CLI。', agent_cli_too_old: '选定的 CLI 版本不支持工作台的受限对话。',
        auth_unsupported: '选定的 CLI 未提供所选站点的官方 ACP 浏览器授权。',
        agent_not_authenticated: '选定的 CLI 仍未通过真实模型验证，请核对官方账号状态。' };
      throw problem(status, detail[status]);
    }
    stage = 'handoff';
    return await deps.finish({ repo: options.repo, uiURL: options.uiURL,
      ...(locked ? { expectedCliPath: candidate.path } : persist ? { cliPath: candidate.path } : {}) });
  } catch (error) {
    return { ok: false, verified: false, browser_saved: false, stage: error?.stage ?? stage,
      code: error?.code ?? 'setup_failed', detail: error instanceof Error ? error.message : '接入失败。' };
  }
}

async function installStandalone(dataRoot) {
  const base = process.platform === 'win32' ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')) :
    (process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));
  if (!path.isAbsolute(base)) throw new Error('用户工具目录必须是绝对路径。');
  const prefix = path.join(base, 'Askill', 'tools', 'codebuddy');
  let existing = prefix;
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
  const target = path.resolve(fs.realpathSync.native(existing), path.relative(existing, prefix));
  const relative = path.relative(fs.realpathSync.native(dataRoot), target);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)))
    throw new Error('独立 CLI 工具目录必须位于项目数据目录之外。');
  const nodeDir = path.dirname(process.execPath);
  const sources = [path.join(nodeDir, 'node_modules/npm/bin/npm-cli.js'), path.resolve(nodeDir, '../lib/node_modules/npm/bin/npm-cli.js')];
  for (const dir of String(process.env.PATH ?? '').split(path.delimiter).filter(dir => path.isAbsolute(dir))) {
    if (process.platform === 'win32') sources.push(path.join(dir, 'node_modules/npm/bin/npm-cli.js'));
    else {
      const link = path.join(dir, 'npm');
      if (fs.existsSync(link)) sources.push(fs.realpathSync(link));
    }
  }
  const npm = sources.find(file => path.basename(file) === 'npm-cli.js' && fs.statSync(file, { throwIfNoEntry: false })?.isFile());
  if (!npm) {
    try { return installedEntry(prefix); } catch { throw problem('npm_not_found', '请安装包含 npm 的官方 Node.js 发行版后重试。'); }
  }
  return installCLI(prefix, npm);
}

async function main() {
  const options = parseConnectArgs(process.argv.slice(2));
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18) || !process.features.typescript)
    throw new Error('请使用支持原生 TypeScript 的 Node.js 22.18 或更高版本。');
  const module = file => import(pathToFileURL(path.join(options.repo, 'orchestrator/src', file)).href);
  await module('finance/register.ts');
  const runtime = await module('local_agent_runtime.ts');
  requireCompatibleRuntime(runtime);
  const service = await module('service.ts');
  const { verifyWorkBuddyInstance, finishWorkBuddy } = await import('./finish-workbuddy.mjs');
  const { authorizeWorkBuddy } = await import('./auth-workbuddy.mjs');
  const ctx = service.serviceContext({ repoRoot: options.repo });
  runtime.loadSavedAgentPaths(ctx.dataRoot);
  const initialBin = process.env.CODEBUDDY_BIN;
  const resolve = file => runtime.resolveSavableCodeBuddyLocation(ctx.dataRoot, file, {});
  const result = await connectWorkBuddy(options, {
    instance: verifyWorkBuddyInstance, lockedCli: initialBin?.trim() || undefined, resolve,
    async discover(file) {
      const env = file ? { ...process.env, CODEBUDDY_BIN: file } : process.env;
      const status = await runtime.probeCodeBuddyForSetup(env);
      if (status.status === 'not_installed') return null;
      // Even when discovery metadata is stale, let the real, pinned conversation decide.
      const selected = status.cli_path || file || await runtime.locateCodeBuddy(env);
      if (!selected) throw problem('probe_failed', '无法确认本次检测到的 CLI 路径。');
      return { path: selected, kind: runtime.isWorkBuddyBundledCli(selected) ? 'bundled' : 'standalone', saved: status.custom_path === true };
    },
    async verify(file) {
      process.env.CODEBUDDY_BIN = file;
      try { return await service.llmProbe(ctx, { llm: { provider: 'cli-codebuddy' } }, AbortSignal.timeout(180_000)); }
      finally {
        if (initialBin === undefined) delete process.env.CODEBUDDY_BIN;
        else process.env.CODEBUDDY_BIN = initialBin;
      }
    },
    install: installStandalone, authorize: authorizeWorkBuddy, finish: finishWorkBuddy,
    onProgress: message => console.error(message),
  });
  console.log(JSON.stringify(result));
  if (!result?.ok) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(JSON.stringify({ ok: false, verified: false, stage: 'setup', code: error?.code ?? 'setup_failed', detail: error.message })); process.exitCode = 1; });
}
