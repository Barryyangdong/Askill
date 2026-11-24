import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { finishWorkBuddy, verifyWorkBuddyInstance } from './finish-workbuddy.mjs';

function fixture(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'askill-finish-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const config = path.join(repo, 'vibe-research.config.json');
  const dataRoot = path.join(repo, 'local-data');
  fs.mkdirSync(dataRoot);
  fs.writeFileSync(config, JSON.stringify({ paths: { data_root: 'local-data' } }));
  fs.mkdirSync(path.join(repo, 'orchestrator/src'), { recursive: true });
  fs.copyFileSync(new URL('../../../orchestrator/src/data_root.ts', import.meta.url), path.join(repo, 'orchestrator/src/data_root.ts'));
  const cliPath = path.join(repo, 'codebuddy');
  fs.writeFileSync(cliPath, '');
  const info = { sources: ['builtin', config], paths: { data_root: dataRoot }, capabilities: { workbuddy_require_ready: true } };
  const calls = [];
  const opened = [];
  const opts = { repo, uiURL: 'http://127.0.0.1:5940', cliPath };
  const state = { provider: 'cli-codebuddy', status: 'ready', available: true, saved_path: true, custom_path: true };
  const deps = { env: {}, openBrowser: async url => { opened.push(url); return true; }, fetch: async (url, init) => {
    assert.equal(init.redirect, 'error');
    const body = init.body && JSON.parse(init.body);
    calls.push([url.pathname, body]);
    if (url.pathname.endsWith('/product')) return Response.json(info);
    assert.equal(init.headers.Origin, opts.uiURL);
    if (url.pathname.endsWith('/path')) return Response.json(state);
    return Response.json({ ok: true });
  } };
  return { info, calls, opened, opts, deps, state };
}

test('matches repo and data directory before any action; rejects remote and redirected origins', async t => {
  const { info, calls, opened, opts, deps } = fixture(t);
  const copy = { ...info.paths };
  info.paths.data_root = opts.repo;
  assert.equal((await finishWorkBuddy(opts, deps)).code, 'instance_mismatch');
  info.paths = copy; info.sources = ['builtin'];
  await assert.rejects(verifyWorkBuddyInstance(opts, deps), { code: 'instance_mismatch' });
  await assert.rejects(verifyWorkBuddyInstance({ ...opts, uiURL: 'https://example.org' }, deps));
  assert.deepEqual(calls.map(c => c[0]), ['/api/product', '/api/product']);
  assert.equal(opened.length, 0);
});

test('reloads exact candidate only on capable service, probes running provider, opens fixed local handoff', async t => {
  const { calls, opened, opts, deps } = fixture(t);
  const result = await finishWorkBuddy(opts, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(calls[1], ['/api/local-agents/codebuddy/path', { path: opts.cliPath, require_ready: true }]);
  assert.equal(calls[2][1].llm.provider, 'cli-codebuddy');
  assert.deepEqual(opened, [opts.uiURL + '/settings?setup=workbuddy&next=workbench']);
  assert.equal(result.browser_saved, false);
});

test('an incompatible service never receives a writable path; failed reload never opens a browser', async t => {
  const { calls, opened, opts, deps, info, state } = fixture(t);
  info.capabilities = {};
  assert.equal((await finishWorkBuddy(opts, deps)).next_action, 'restart_verified_instance');
  assert.equal(typeof calls[1][1].path, 'object');
  assert.equal(calls.length, 2);
  info.capabilities = { workbuddy_require_ready: true };
  state.custom_path = false;
  assert.equal((await finishWorkBuddy(opts, deps)).code, 'cli_path_not_active');
  assert.equal(opened.length, 0);
});

test('without a new path, only probes; blocked browser returns a clickable handoff', async t => {
  const { calls, opts, deps } = fixture(t);
  delete opts.cliPath;
  deps.openBrowser = async () => { throw Error('policy'); };
  const result = await finishWorkBuddy(opts, deps);
  assert.equal(result.browser_opened, false);
  assert.equal(result.verified, true);
  assert.equal(result.setup_url, opts.uiURL + '/settings?setup=workbuddy&next=workbench');
  assert.deepEqual(calls.map(c => c[0]), ['/api/product', '/api/llm-probe']);
});

test('locked environment choice must match in the service, without sending a write', async t => {
  const { calls, opts, deps, info, opened } = fixture(t);
  opts.expectedCliPath = opts.cliPath;
  delete opts.cliPath;
  assert.equal((await finishWorkBuddy(opts, deps)).code, 'cannot_confirm_locked_cli');
  info.capabilities.workbuddy_match_path = true;
  const fetcher = deps.fetch;
  let matched = false;
  deps.fetch = async (url, init) => {
    if (!url.pathname.endsWith('/match')) return fetcher(url, init);
    assert.deepEqual(JSON.parse(init.body), { path: opts.expectedCliPath });
    return Response.json({ matches: matched });
  };
  assert.equal((await finishWorkBuddy(opts, deps)).code, 'locked_cli_mismatch');
  assert.equal(opened.length, 0);
  matched = true;
  assert.equal((await finishWorkBuddy(opts, deps)).ok, true);
  assert.ok(calls.every(([route]) => !route.endsWith('/path')));
});

test('recognizes legacy strict validation before sending the real path; failed service probe blocks opening', async t => {
  const { opts, deps, info, opened } = fixture(t);
  info.capabilities = {};
  const fetcher = deps.fetch;
  const pathTypes = [];
  deps.fetch = async (url, init) => {
    if (url.pathname.endsWith('/path')) {
      const body = JSON.parse(init.body);
      pathTypes.push(typeof body.path);
      if (typeof body.path !== 'string') return Response.json({ error: 'bad_agent_path', message: 'require_ready 必须是布尔值' }, { status: 400 });
    }
    if (url.pathname.endsWith('/llm-probe')) return Response.json({ ok: false });
    return fetcher(url, init);
  };
  assert.equal((await finishWorkBuddy(opts, deps)).code, 'probe_failed');
  assert.deepEqual(pathTypes, ['object', 'string']);
  assert.equal(opened.length, 0);
});
