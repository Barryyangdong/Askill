import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { connectWorkBuddy, parseConnectArgs } from './connect-workbuddy.mjs';

const repo = path.resolve('project'), uiURL = 'http://127.0.0.1:6249';
const bundled = path.resolve('WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy');
const standalone = path.resolve('independent tools', 'codebuddy');
const options = { repo, uiURL };
const failure = code => Object.assign(new Error(code), { code });

function machine({ automatic = bundled, responses = ['ready'], lockedCli, authorizeError } = {}) {
  const calls = [];
  const deps = {
    lockedCli,
    async instance() { calls.push('instance'); return { ok: true, dataRoot: path.join(repo, '.local') }; },
    resolve: p => p,
    async discover(pin) {
      const file = pin || automatic;
      calls.push(['discover', file]);
      return file ? { path: file, kind: file === bundled ? 'bundled' : 'standalone' } : null;
    },
    async verify(file) {
      calls.push(['verify', file]);
      const status = responses.shift();
      assert.ok(status, 'unexpected additional probe');
      if (status !== 'ready') throw failure(status);
      return { ok: true };
    },
    async install() { calls.push('install'); return { cli_path: standalone }; },
    async authorize({ cliPath, site, realAuthRejected }) {
      assert.equal(realAuthRejected, true);
      calls.push(['authorize', cliPath, site]);
      const code = Array.isArray(authorizeError) ? authorizeError.shift() : authorizeError;
      if (code) throw failure(code);
    },
    async finish(args) { calls.push(['finish', args]); return { ok: true, verified: true, browser_opened: true, browser_saved: false, setup_url: uiURL + '/settings?setup=workbuddy' }; },
  };
  return { deps, calls };
}

test('one command requires the actual local UI origin and accepts explicit region and CLI', () => {
  assert.throws(() => parseConnectArgs(['--repo', repo]), /ui-url/);
  assert.throws(() => parseConnectArgs(['--repo', repo, '--ui-url', 'https://example.org']), /local HTTP/);
  assert.equal(parseConnectArgs(['--repo', repo, '--ui-url', uiURL]).site, 'cn');
  assert.equal(parseConnectArgs(['--repo', repo, '--ui-url', uiURL, '--cli-path', standalone, '--site', 'international']).cliPath, standalone);
  assert.throws(() => parseConnectArgs(['--repo', repo, '--ui-url', uiURL, '--site', 'invalid']), /international/);
});

test('authorized bundled CLI goes from a real model check directly to the identified running instance', async () => {
  const { calls, deps } = machine();
  const result = await connectWorkBuddy(options, deps);
  assert.equal(result.verified, true);
  assert.equal(result.browser_saved, false);
  assert.deepEqual(calls, ['instance', ['discover', bundled], ['verify', bundled], ['finish', options]]);
});

test('authorized access to the bundled CLI resumes after the official browser without any extra installation', async () => {
  const { calls, deps } = machine({ responses: ['agent_not_authenticated', 'ready'] });
  assert.equal((await connectWorkBuddy(options, deps)).ok, true);
  assert.deepEqual(calls, ['instance', ['discover', bundled], ['verify', bundled], ['authorize', bundled, 'cn'], ['verify', bundled], ['finish', options]]);
});

test('only unsupported bundled authorization switches to standalone, awaits its authorization, rechecks and hot-loads', async () => {
  const { calls, deps } = machine({ responses: ['agent_not_authenticated', 'agent_not_authenticated', 'ready'], authorizeError: ['auth_unsupported'] });
  assert.equal((await connectWorkBuddy({ ...options, site: 'international' }, deps)).ok, true);
  assert.deepEqual(calls, ['instance', ['discover', bundled], ['verify', bundled], ['authorize', bundled, 'international'], 'install', ['discover', standalone],
    ['verify', standalone], ['authorize', standalone, 'international'], ['verify', standalone], ['finish', { ...options, cliPath: standalone }]]);
});

test('missing and incompatible candidates can select an already authorized private installation without opening sign-in', async () => {
  for (const [automatic, responses] of [[null, ['ready']], [bundled, ['agent_cli_too_old', 'ready']]]) {
    const { calls, deps } = machine({ automatic, responses });
    assert.equal((await connectWorkBuddy(options, deps)).ok, true);
    assert.ok(calls.includes('install'));
    assert.ok(!calls.some(call => call[0] === 'authorize'));
    assert.deepEqual(calls.at(-1), ['finish', { ...options, cliPath: standalone }]);
  }
});

test('explicit choice and environment locks do not switch candidates', async () => {
  const locked = machine({ lockedCli: bundled, responses: ['agent_cli_too_old'] });
  assert.equal((await connectWorkBuddy(options, locked.deps)).code, 'agent_cli_too_old');
  assert.ok(!locked.calls.includes('install'));
  const conflict = machine({ lockedCli: bundled });
  assert.equal((await connectWorkBuddy({ ...options, cliPath: standalone }, conflict.deps)).code, 'agent_path_env_locked');
  assert.deepEqual(conflict.calls, ['instance']);
  const saved = machine({ responses: ['agent_cli_too_old'] });
  saved.deps.discover = async () => ({ path: bundled, kind: 'bundled', saved: true });
  assert.equal((await connectWorkBuddy(options, saved.deps)).code, 'agent_cli_too_old');
  assert.ok(!saved.calls.includes('install'));
  const same = machine({ lockedCli: standalone });
  assert.equal((await connectWorkBuddy(options, same.deps)).ok, true);
  assert.deepEqual(same.calls.at(-1), ['finish', { ...options, expectedCliPath: standalone }]);
  const named = machine({ responses: ['agent_not_authenticated', 'ready'] });
  assert.equal((await connectWorkBuddy({ ...options, cliPath: standalone }, named.deps)).ok, true);
  assert.deepEqual(named.calls, ['instance', ['discover', standalone], ['verify', standalone], ['authorize', standalone, 'cn'], ['verify', standalone], ['finish', { ...options, cliPath: standalone }]]);
});

test('transport, quota, bad model output and wrong instances never initiate authorization or persistence', async () => {
  for (const code of ['agent_timeout', 'agent_quota', 'probe_bad_output', 'probe_failed']) {
    const { calls, deps } = machine({ responses: [code] });
    const result = await connectWorkBuddy(options, deps);
    assert.equal(result.code, code);
    assert.equal(result.verified, false);
    assert.deepEqual(calls, ['instance', ['discover', bundled], ['verify', bundled]]);
  }
  const { calls, deps } = machine();
  deps.instance = async () => ({ ok: false, stage: 'instance', code: 'wrong_instance' });
  assert.equal((await connectWorkBuddy(options, deps)).code, 'wrong_instance');
  assert.deepEqual(calls, []);
});

test('cancelled sign-in and a rejected second probe end without further login or changes', async () => {
  for (const authorizeError of ['auth_cancelled', undefined]) {
    const { calls, deps } = machine({ automatic: standalone, responses: ['agent_not_authenticated', 'agent_not_authenticated'], authorizeError });
    const result = await connectWorkBuddy(options, deps);
    assert.equal(result.code, authorizeError || 'agent_not_authenticated');
    assert.equal(calls.filter(call => call[0] === 'authorize').length, 1);
    assert.equal(calls.filter(call => call[0] === 'verify').length, authorizeError ? 1 : 2);
    assert.ok(!calls.some(call => call[0] === 'finish'));
  }
});

test('a failed real service probe never returns success or a setup link', async () => {
  const { deps } = machine();
  deps.finish = async () => ({ ok: false, stage: 'service_probe', code: 'agent_quota', verified: false });
  const result = await connectWorkBuddy(options, deps);
  assert.equal(result.ok, false);
  assert.equal(result.setup_url, undefined);
  assert.equal(result.code, 'agent_quota');
});

test('a session found by the official CLI is rechecked once without replacing the existing login', async () => {
  const { calls, deps } = machine({ automatic: standalone, responses: ['agent_not_authenticated', 'ready'], authorizeError: 'auth_session_exists' });
  assert.equal((await connectWorkBuddy(options, deps)).ok, true);
  assert.equal(calls.filter(call => call[0] === 'authorize').length, 1);
  assert.deepEqual(calls.at(-2), ['verify', standalone]);
  assert.deepEqual(calls.at(-1), ['finish', { ...options, cliPath: standalone }]);
});

test('CLI entry pins the verified executable and reports the running HTTP service’s failed probe', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'askill-connect-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'orchestrator/src'), dataRoot = path.join(root, '.local');
  fs.mkdirSync(path.join(source, 'finance'), { recursive: true });
  fs.mkdirSync(dataRoot);
  const config = path.join(root, 'vibe-research.config.json'), cli = path.join(root, 'codebuddy');
  fs.writeFileSync(config, '{}');
  fs.writeFileSync(cli, 'fixture');
  fs.writeFileSync(path.join(source, 'finance/register.ts'), 'export {};');
  fs.writeFileSync(path.join(source, 'data_root.ts'), `export const readConfiguredDataRoot = () => null; export const resolveDataRoot = () => ${JSON.stringify(dataRoot)};`);
  fs.writeFileSync(path.join(source, 'local_agent_runtime.ts'), [
    'export const loadSavedAgentPaths = () => {};',
    'export const resolveSavableCodeBuddyLocation = (_, file) => file;',
    'export const probeCodeBuddyForSetup = env => ({ status: "ready", cli_path: env.CODEBUDDY_BIN });',
    'export const isWorkBuddyBundledCli = () => false;',
  ].join('\n'));
  fs.writeFileSync(path.join(source, 'service.ts'), [
    `export const serviceContext = () => ({dataRoot: ${JSON.stringify(dataRoot)}});`,
    `export const llmProbe = (_, body) => ({ok: process.env.CODEBUDDY_BIN === ${JSON.stringify(cli)} && body.llm.provider === 'cli-codebuddy'});`,
  ].join('\n'));
  const routes = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    routes.push({ url: req.url, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/product') res.end(JSON.stringify({ sources: [config], paths: { data_root: dataRoot }, capabilities: { workbuddy_require_ready: true } }));
    else if (req.url === '/api/local-agents/codebuddy/path') res.end(JSON.stringify({ provider: 'cli-codebuddy', status: 'ready', available: true, saved_path: true, custom_path: true }));
    else { res.statusCode = 429; res.end(JSON.stringify({ error: 'agent_quota' })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const env = { ...process.env }; delete env.CODEBUDDY_BIN;
  const entry = fileURLToPath(new URL('connect-workbuddy.mjs', import.meta.url));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await assert.rejects(promisify(execFile)(process.execPath, [entry, '--repo', root, '--ui-url', origin, '--cli-path', cli], { env, timeout: 20_000 }), err => {
    assert.equal(err.code, 2, err.stderr);
    assert.equal(JSON.parse(err.stdout).code, 'agent_quota');
    return true;
  });
  assert.deepEqual(routes.map(row => row.url), ['/api/product', '/api/product', '/api/local-agents/codebuddy/path', '/api/llm-probe']);
  assert.deepEqual(routes[2].body, { path: cli, require_ready: true });
  assert.equal(routes[3].body.llm.provider, 'cli-codebuddy');
});
