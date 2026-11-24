import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loginArguments } from './login-codebuddy.mjs';

test('both login modes diagnose disabled TypeScript before importing repository code', () => {
  const login = fileURLToPath(new URL('login-codebuddy.mjs', import.meta.url));
  for (const args of [[], ['--prepare-windows']]) {
    const result = spawnSync(process.execPath, ['--no-experimental-strip-types', login, ...args,
      '--repo', os.tmpdir(), '--cli-path', process.execPath], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /原生 TypeScript.*22\.18/);
  }
});

test('Windows double-click launcher uses the verified Node and exact Skill, repo, CLI through shell metacharacters', { skip: process.platform !== 'win32' }, t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'askill-cmd-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, "中文 (WorkBuddy) & %ASKILL_TEST_DIR% !VAR! 100% '");
  const repo = path.join(root, '项目源码');
  const skill = path.join(root, '技能');
  const nodeBin = path.join(root, 'node.exe');
  const cliDir = path.join(root, '独立 CLI');
  const runtime = new URL('../../../orchestrator/src/local_agent_runtime.ts', import.meta.url);
  const sources = path.join(repo, 'orchestrator', 'src');
  for (const dir of [sources, skill, cliDir]) fs.mkdirSync(dir, { recursive: true });
  // Use the real resolver and adapter from this repo without touching a user's CLI or credentials.
  fs.writeFileSync(path.join(sources, 'local_agent_runtime.ts'), 'export * from ' + JSON.stringify(runtime.href) + ';');
  const login = path.join(skill, 'login-codebuddy.mjs');
  for (const name of ['login-codebuddy.mjs', 'configure-workbuddy.mjs']) {
    fs.copyFileSync(fileURLToPath(new URL(name, import.meta.url)), path.join(skill, name));
  }
  fs.copyFileSync(process.execPath, nodeBin);
  const cli = path.join(cliDir, 'codebuddy.ps1');
  const record = path.join(root, 'invocations.jsonl');
  fs.writeFileSync(cli, '#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n& "$basedir/node$exe" "$basedir/fake.cjs" $args\n');
  fs.writeFileSync(path.join(cliDir, 'fake.cjs'), [
    'const fs = require("node:fs");',
    'const invocation = { node: process.execPath, cwd: process.cwd(), args: process.argv.slice(2) };',
    `fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify(invocation) + "\\n");`,
    'process.exit(17);',
  ].join('\n'));
  const launcher = path.join(root, 'WorkBuddy-login.cmd');
  const env = { ...process.env, ASKILL_TEST_DIR: 'somewhere-else', VAR: 'expanded' };
  const prepare = () => spawnSync(nodeBin, [login, '--prepare-windows', '--repo', repo, '--cli-path', cli, '--output', launcher], { env, encoding: 'utf8' });
  const prepared = prepare();
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.deepEqual(JSON.parse(prepared.stdout), { ok: true, launcher_path: launcher, verified: false });
  assert.equal(fs.existsSync(record), false);
  const original = fs.readFileSync(launcher);
  assert.ok(original.every(byte => byte < 128));
  assert.notEqual(prepare().status, 0);
  assert.deepEqual(fs.readFileSync(launcher), original);
  const cmd = path.join(process.env.SystemRoot, 'System32', 'cmd.exe');
  const run = (searchPath = '') => spawnSync(cmd, ['/d', '/v:on', '/c', path.basename(launcher)], {
    cwd: root, env: { ...env, PATH: searchPath }, input: '\r\n', encoding: 'utf8', timeout: 25_000, windowsHide: true,
  });
  const first = run();
  assert.equal(first.status, 17, first.stderr + first.stdout);
  const lines = () => fs.readFileSync(record, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(lines(), [{ node: nodeBin, cwd: cliDir, args: loginArguments() }]);
  fs.unlinkSync(nodeBin);
  const missing = run(path.dirname(process.execPath));
  assert.notEqual(missing.status, 0);
  assert.equal(lines().length, 1, 'missing verified Node cannot trigger another login');
});
