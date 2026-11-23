import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { configure, parseArgs, requireCompatibleRuntime } from './configure-workbuddy.mjs';
import { loginArguments } from './login-codebuddy.mjs';

test('official interactive login keeps empty tool restrictions as native argv', () => {
  const args = loginArguments();
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.deepEqual(JSON.parse(args[args.indexOf('--mcp-config') + 1]), { mcpServers: {} });
  assert.ok(args.includes('--no-session-persistence'));
  assert.equal(args[args.indexOf('--setting-sources') + 1], 'none');
});

test('handoff is restricted to loopback and rejects unknown arguments', () => {
  const repo = path.resolve('.');
  assert.equal(parseArgs(['--repo', repo, '--verify']).verify, true);
  for (const url of ['https://example.com', 'http://127.0.0.1@evil.invalid', 'http://localhost/path', 'http://localhost/?token=x']) {
    assert.throws(() => parseArgs(['--repo', repo, '--ui-url', url]));
  }
  assert.throws(() => parseArgs(['--repo', repo, '--typo']));
});
test('discovery is not verification and unavailable CLI never launches a model', async () => {
  let calls = 0;
  const deps = { detect: async () => ({ available: false, status: 'not_installed' }), verify: async () => { calls++; return { ok: true }; } };
  assert.equal((await configure({ verify: true }, deps)).ok, false);
  assert.equal(calls, 0);
  deps.detect = async () => ({ available: true, status: 'ready' });
  assert.equal((await configure({ verify: false }, deps)).verified, false);
  assert.equal(calls, 0);
});
test('only real successful probe creates handoff, browser saving is a separate outcome', async () => {
  const options = { verify: true, uiURL: 'http://127.0.0.1:5999' };
  const detect = async () => ({ available: true, status: 'ready' });
  await assert.rejects(configure(options, { detect, verify: async () => ({ ok: false }) }));
  const result = await configure(options, { detect, verify: async () => ({ ok: true }) });
  assert.equal(result.setup_url, 'http://127.0.0.1:5999/settings?setup=workbuddy');
  assert.equal(result.browser_saved, false);
});

test('account metadata cannot turn a failed real login into a successful handoff', async () => {
  const result = await configure({ verify: true }, {
    detect: async () => ({ available: true, status: 'ready' }),
    verify: async () => { throw Object.assign(new Error('auth'), { code: 'agent_not_authenticated' }); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'not_authenticated');
  assert.equal(result.browser_saved, false);
  assert.equal(result.setup_url, undefined);
  assert.equal(result.next_action, 'confirm_workbuddy_login');
});

test('candidate CLI is persisted only after real verification; failure preserves the active path', async () => {
  const events = [];
  const options = { verify: true, persistCLI: true, uiURL: 'http://localhost:5940' };
  const deps = {
    detect: async () => ({ available: true, status: 'ready' }),
    verify: async () => { events.push('verify'); return { ok: true }; },
    persist: async () => { events.push('persist'); return { status: 'ready', available: true, custom_path: true, saved_path: true }; },
  };
  assert.equal((await configure(options, deps)).restart_existing_service, true);
  assert.deepEqual(events, ['verify', 'persist']);
  const autoDetected = await configure(options, {
    ...deps, persist: async () => ({ status: 'ready', available: true, saved_path: true, custom_path: false }),
  });
  assert.equal(autoDetected.ok, false);
  assert.equal(autoDetected.status, 'path_not_saved');
  assert.equal(autoDetected.setup_url, undefined);
  events.length = 0;
  await assert.rejects(configure(options, { ...deps, verify: async () => { throw new Error('timeout'); } }));
  assert.deepEqual(events, []);
  assert.throws(() => parseArgs(['--repo', path.resolve('.'), '--persist-cli']));
});

test('standalone CLI sign-in is reported consistently at discovery, connection and persistence', async () => {
  const options = { verify: true, persistCLI: true, cliPath: path.resolve('codebuddy'), uiURL: 'http://localhost:5940' };
  const ready = { status: 'ready', available: true, cli_kind: 'standalone', cli_path: options.cliPath };
  const loggedOut = { ...ready, status: 'not_authenticated', available: false };
  for (const stage of ['discovery', 'connection', 'persistence']) {
    const calls = [];
    const result = await configure(options, {
      detect: async () => stage === 'discovery' ? loggedOut : ready,
      verify: async selected => {
        assert.equal(selected, options.cliPath);
        calls.push('verify');
        if (stage === 'connection') throw Object.assign(new Error('needs login'), { code: 'agent_not_authenticated' });
        return { ok: true };
      },
      persist: async () => { calls.push('persist'); return loggedOut; },
    });
    assert.equal(result.stage, stage);
    assert.equal(result.next_action, 'login_codebuddy_cli');
    assert.equal(result.cli_path, options.cliPath);
    assert.equal(result.verified, false);
    assert.equal(result.setup_url, undefined);
    assert.deepEqual(calls, stage === 'discovery' ? [] : stage === 'connection' ? ['verify'] : ['verify', 'persist']);
  }
});

test('older source fails before the installer can call its save-first API', () => {
  assert.throws(() => requireCompatibleRuntime({ resolveCodeBuddyLocation() {} }), /更新配套源码/);
  assert.doesNotThrow(() => requireCompatibleRuntime({ resolveSavableCodeBuddyLocation() {}, probeCodeBuddyForSetup() {} }));
});

test('automatic check returns the discovered standalone executable for interactive login', async () => {
  const cli = path.resolve('工具', 'node_modules', '.bin', process.platform === 'win32' ? 'codebuddy.ps1' : 'codebuddy');
  const result = await configure({ verify: false }, { detect: async () =>
    ({ status: 'not_authenticated', available: false, cli_kind: 'standalone', cli_path: cli }) });
  assert.equal(result.next_action, 'login_codebuddy_cli');
  assert.equal(result.cli_path, cli);
  assert.equal(parseArgs(['--repo', path.resolve('.'), '--cli-path', result.cli_path]).cliPath, cli);
});
