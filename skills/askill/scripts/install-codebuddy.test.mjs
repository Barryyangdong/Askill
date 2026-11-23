import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { installCLI, installedEntry, PACKAGE } from './install-codebuddy.mjs';

test('fresh machine installs once; paths with spaces and Chinese characters survive; restart reuses installation', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askill-skill-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const prefix = path.join(dir, '用户 tools');
  let calls = 0;
  const runner = async (entry, args) => {
    calls++;
    assert.equal(entry, path.join(dir, 'npm-cli.js'));
    assert.equal(args[args.indexOf('--prefix') + 1], prefix);
    assert.ok(args.includes('--registry=https://registry.npmjs.org'));
    assert.equal(args.at(-1), PACKAGE);
    const root = path.join(prefix, 'node_modules', '@tencent-ai', 'codebuddy-code');
    fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: PACKAGE, version: 'fixture', bin: { codebuddy: 'bin/codebuddy' } }));
    fs.writeFileSync(path.join(root, 'bin/codebuddy'), '#!/usr/bin/env node\n');
    fs.mkdirSync(path.join(prefix, 'node_modules/.bin'), { recursive: true });
    fs.writeFileSync(path.join(prefix, 'node_modules/.bin/codebuddy.ps1'), '# fixture');
    if (process.platform !== 'win32') fs.symlinkSync(path.join(root, 'bin/codebuddy'), path.join(prefix, 'node_modules/.bin/codebuddy'));
  };
  const result = await installCLI(prefix, path.join(dir, 'npm-cli.js'), runner);
  assert.equal(result.reused, false);
  assert.equal(result.verified, false);
  assert.equal(fs.existsSync(result.cli_path), true);
  assert.equal((await installCLI(prefix, path.join(dir, 'npm-cli.js'), runner)).reused, true);
  assert.equal(calls, 1);
  const root = path.join(prefix, 'node_modules', '@tencent-ai', 'codebuddy-code');
  fs.writeFileSync(path.join(prefix, 'outside'), 'not a CLI');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: PACKAGE, bin: '../../../outside' }));
  assert.throws(() => installedEntry(prefix), /inside the package/);
});

test('failed install never reports success and relative destinations are rejected', async () => {
  await assert.rejects(installCLI('relative', path.resolve('npm-cli.js')), /absolute/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askill-install-fail-'));
  try {
    await assert.rejects(installCLI(dir, path.resolve('npm-cli.js'), async () => { throw new Error('offline'); }), /offline/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('installer launches its Node entry without shell quoting and propagates process failure', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askill-runner-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const entry = path.join(dir, 'npm fixture.cjs');
  fs.writeFileSync(entry, `
    const fs = require('node:fs'), path = require('node:path');
    const args = process.argv.slice(2);
    const prefix = args[args.indexOf('--prefix') + 1];
    const root = path.join(prefix, 'node_modules/@tencent-ai/codebuddy-code');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: '@tencent-ai/codebuddy-code', bin: 'cli.cjs', version: 'fixture'}));
    fs.writeFileSync(path.join(root, 'cli.cjs'), '');
    fs.mkdirSync(path.join(prefix, 'node_modules/.bin'), {recursive: true});
    fs.writeFileSync(path.join(prefix, 'node_modules/.bin/codebuddy.ps1'), '# fixture');
    if (process.platform !== 'win32') fs.symlinkSync(path.join(root, 'cli.cjs'), path.join(prefix, 'node_modules/.bin/codebuddy'));
  `);
  assert.equal((await installCLI(path.join(dir, '测试 space'), entry)).ok, true);
  fs.writeFileSync(entry, 'process.exit(3)');
  await assert.rejects(installCLI(path.join(dir, 'failed'), entry), /exit 3/);
});

test('real npm repairs interrupted installs and relinks a missing Windows launcher offline', async t => {
  const npmCLI = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!fs.existsSync(npmCLI)) return t.skip('npm-cli.js is unavailable');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askill-repair-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'fixture');
  const prefix = path.join(dir, 'tools');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
    name: PACKAGE, version: '1.0.0', bin: { codebuddy: 'cli.js' },
  }));
  fs.writeFileSync(path.join(source, 'cli.js'), '#!/usr/bin/env node\n');
  const npm = args => execFileSync(process.execPath, [npmCLI, ...args, '--offline', '--cache', path.join(dir, 'cache')], {
    cwd: source, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tarball = path.join(dir, JSON.parse(npm(['pack', '--json', '--pack-destination', dir]))[0].filename);
  const commands = [];
  const runner = async (_, args) => {
    commands.push(args[0]);
    npm(args[0] === 'install' ? [...args.slice(0, -1), tarball] : args);
  };
  await installCLI(prefix, npmCLI, runner);
  const root = path.join(prefix, 'node_modules', PACKAGE);
  const shim = path.join(prefix, 'node_modules/.bin', process.platform === 'win32' ? 'codebuddy.ps1' : 'codebuddy');
  fs.unlinkSync(shim);
  assert.equal((await installCLI(prefix, npmCLI, runner)).cli_path, shim);
  if (process.platform === 'win32') assert.match(fs.readFileSync(shim, 'utf8'), /cli\.js/);
  else assert.equal(fs.realpathSync(shim), fs.realpathSync(path.join(root, 'cli.js')));
  assert.equal(commands.at(-1), 'rebuild');
  for (const damage of [
    () => fs.unlinkSync(path.join(root, 'cli.js')),
    () => fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: PACKAGE, version: '1.0.0' })),
    () => fs.writeFileSync(path.join(root, 'package.json'), '{'),
    () => fs.unlinkSync(path.join(root, 'package.json')),
  ]) {
    damage();
    assert.equal((await installCLI(prefix, npmCLI, runner)).reused, false);
    assert.deepEqual(commands.slice(-2), ['uninstall', 'install']);
    assert.equal((await installCLI(prefix, npmCLI, async () => assert.fail('unexpected reinstall'))).reused, true);
  }
});
