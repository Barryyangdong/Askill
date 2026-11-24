import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const messages = {
  auth_busy: '此账户已有授权流程正在进行，请等待该流程结束后再验证。',
  auth_cancelled: '本次官方授权已取消。',
  auth_timeout: '等待官方授权超时，请重新开始授权。',
  auth_unsupported: '当前 CLI 未提供所选站点的 ACP 浏览器授权，请更新官方独立 CLI。',
  auth_session_exists: 'CLI 已有登录会话，请先重新验证该会话。',
  auth_failed: '无法确认官方授权状态，请检查 CLI 与网络后重试。',
};
const failure = code => Object.assign(new Error(messages[code]), { code });

async function acquireLock() {
  // The bundled and standalone clients may share the same account store.
  const id = createHash('sha256').update(os.homedir()).digest('hex').slice(0, 24);
  const name = 'askill-codebuddy-auth-' + id;
  const address = process.platform === 'win32' ? '\\\\.\\pipe\\' + name
    : process.platform === 'linux' ? '\0' + name : path.join(os.tmpdir(), name + '.sock');
  const server = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', error => reject(failure(error.code === 'EADDRINUSE' ? 'auth_busy' : 'auth_failed')));
    server.listen(address, resolve);
  });
  return () => new Promise(resolve => server.close(resolve));
}

// The official CLI opens the browser, waits for its callback and saves the
// subscription. Only the RPC status is used; account metadata is never exposed.
export function runAuthorization(child, { methodId, cwd, signal, timeoutMs, onProgress }) {
  return new Promise((resolve, reject) => {
    let id = 1, pending = '', settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      process.removeListener('SIGINT', cancel);
      process.removeListener('SIGTERM', cancel);
      process.removeListener('exit', stop);
      const done = () => error ? reject(error) : resolve({ authorized: true });
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        child.once('close', done);
        stop();
      } else done();
    };
    const stop = () => {
      child.stdin.destroy();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    };
    const cancel = () => finish(failure('auth_cancelled'));
    const timer = setTimeout(() => finish(failure('auth_timeout')), timeoutMs);
    const send = message => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
    const request = (method, params) => send({ id, method, params });
    const handle = msg => {
      if (msg?.jsonrpc !== '2.0') throw failure('auth_failed');
      if (msg.method) {
        if (msg.id != null) send({ id: msg.id, error: { code: -32601, message: 'Method not supported' } });
        return;
      }
      if (msg.id !== id) return;
      if (id === 1) {
        if (msg.result?.protocolVersion !== 1 || !msg.result.authMethods?.some(method => method.id === methodId))
          throw failure('auth_unsupported');
        id++;
        // Both official versions check the live account BEFORE loading a session.
        // A fresh ID cannot refer to a user's existing chat. Never authenticate
        // after a generic load failure: authenticate signs out an existing user.
        request('session/load', { sessionId: randomUUID(), cwd, mcpServers: [] });
      } else if (id === 2) {
        if (!msg.error) throw failure('auth_session_exists');
        if (msg.error.code === -32002) throw failure('auth_session_exists');
        if (msg.error.code !== -32000 || msg.error.data?.category !== 'auth' || msg.error.message !== 'Authentication required')
          throw failure('auth_failed');
        id++;
        request('authenticate', { methodId });
        onProgress?.('请在官方浏览器页面完成账号授权，完成后将自动验证连接。');
      } else {
        if (msg.error || !msg.result || typeof msg.result !== 'object') throw failure('auth_failed');
        finish();
      }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (settled) return;
      pending += chunk;
      try {
        let end;
        while (!settled && (end = pending.indexOf('\n')) >= 0) {
          if (end > 1024 * 1024) throw failure('auth_failed');
          const line = pending.slice(0, end).trim();
          pending = pending.slice(end + 1);
          if (line) handle(JSON.parse(line));
        }
        if (pending.length > 1024 * 1024) throw failure('auth_failed');
      } catch (error) { finish(failure(Object.hasOwn(messages, error?.code) ? error.code : 'auth_failed')); }
    });
    child.stdin.on('error', () => finish(failure('auth_failed')));
    child.on('error', () => finish(failure('auth_failed')));
    child.once('close', code => finish(failure(id === 1 && code === 0 ? 'auth_unsupported' : 'auth_failed')));
    process.once('exit', stop);
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) return cancel();
    request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'askill', version: '1' } });
  });
}

export async function authorizeWorkBuddy({ repo, cliPath, site = 'cn', realAuthRejected = false, signal, onProgress, timeoutMs = 300_000 }) {
  if (!path.isAbsolute(repo) || !path.isAbsolute(cliPath) || !['cn', 'international'].includes(site)) throw failure('auth_unsupported');
  if (signal?.aborted) throw failure('auth_cancelled');
  const release = await acquireLock();
  try {
    const runtime = await import(pathToFileURL(path.join(repo, 'orchestrator/src/local_agent_runtime.ts')).href);
    const bin = runtime.resolveCodeBuddyLocation(cliPath, {});
    const status = await runtime.probeCodeBuddyForSetup({ ...process.env, CODEBUDDY_BIN: bin });
    if (signal?.aborted) throw failure('auth_cancelled');
    if (status.cli_path !== bin) throw failure('auth_failed');
    if (status.status === 'ready' && status.authenticated) {
      if (!realAuthRejected) throw failure('auth_session_exists');
    } else if (status.status !== 'not_authenticated' || status.authenticated) throw failure('auth_failed');
    const env = { ...runtime.localSubscriptionEnv(process.env, 'codebuddy'), DISABLE_AUTOUPDATER: '1',
      ...(runtime.isWorkBuddyBundledCli(bin) ? { CODEBUDDY_FORCE_LITE_WB_BUNDLE: '1' } : {}) };
    const invocation = runtime.executableInvocation(bin, ['--acp', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', 'none'], env);
    const cwd = path.dirname(bin);
    const child = spawn(invocation.file, invocation.args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    return await runAuthorization(child, { methodId: site === 'cn' ? 'internal' : 'external', cwd, signal, timeoutMs, onProgress });
  } catch (error) { throw failure(Object.hasOwn(messages, error?.code) ? error.code : 'auth_failed'); }
  finally { await release(); }
}
