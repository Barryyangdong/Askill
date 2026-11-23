import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PACKAGE = '@tencent-ai/codebuddy-code';

export function installedEntry(prefix, platform = process.platform) {
  const root = path.join(prefix, 'node_modules', '@tencent-ai', 'codebuddy-code');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.name !== PACKAGE) throw new Error('Unexpected CLI package');
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.codebuddy;
  if (typeof bin !== 'string' || !bin.trim()) {
    throw Object.assign(new Error('Official package has no codebuddy entry'), { code: 'MISSING_ENTRY' });
  }
  const entry = path.resolve(root, bin);
  const declared = path.relative(root, entry);
  if (!declared || declared === '..' || declared.startsWith(`..${path.sep}`) || path.isAbsolute(declared)) throw new Error('CLI entry must stay inside the package');
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(entry));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.statSync(entry).isFile()) throw new Error('CLI entry must stay inside the package');
  // Windows cannot execute a shebang file directly. Use npm's standard PowerShell
  // shim, which the existing adapter validates and resolves without running a shell.
  const launcher = path.join(prefix, 'node_modules', '.bin', platform === 'win32' ? 'codebuddy.ps1' : 'codebuddy');
  if (!fs.statSync(launcher, { throwIfNoEntry: false })?.isFile()) {
    throw Object.assign(new Error('Official CLI launcher is missing; repair this installation'), { code: 'MISSING_SHIM' });
  }
  if (platform !== 'win32' && fs.realpathSync(launcher) !== fs.realpathSync(entry)) {
    throw new Error('Official CLI launcher must resolve to the package entry');
  }
  return { cli_path: launcher, version: manifest.version };
}

export async function installCLI(prefix, npmCLI, run = runNode) {
  if (!path.isAbsolute(prefix) || !path.isAbsolute(npmCLI)) throw new Error('Use absolute --prefix and --npm-cli paths');
  // Idempotent: a previous successful install does not need another download.
  const npmOptions = ['--prefix', prefix, '--registry=https://registry.npmjs.org', '--no-audit', '--no-fund'];
  if (fs.existsSync(path.join(prefix, 'node_modules', '@tencent-ai', 'codebuddy-code'))) {
    try {
      return { ok: true, reused: true, ...installedEntry(prefix), verified: false };
    } catch (error) {
      if (error.code === 'MISSING_SHIM') {
        // A satisfied dependency may be skipped by npm install even if .bin was lost.
        await run(npmCLI, ['rebuild', ...npmOptions, '--bin-links=true', '--ignore-scripts', PACKAGE]);
        return { ok: true, reused: false, ...installedEntry(prefix), verified: false };
      }
      if (!(error instanceof SyntaxError) && !['ENOENT', 'ENOTDIR', 'MISSING_ENTRY'].includes(error.code)) throw error;
      // Remove the incomplete dependency from npm's installed tree before reinstalling.
      await run(npmCLI, ['uninstall', ...npmOptions, '--ignore-scripts', '--no-save', PACKAGE]);
    }
  }
  fs.mkdirSync(prefix, { recursive: true });
  await run(npmCLI, ['install', ...npmOptions, '--bin-links=true', '--save-exact', PACKAGE]);
  return { ok: true, reused: false, ...installedEntry(prefix), verified: false };
}

function runNode(entry, args) {
  return new Promise((resolve, reject) => {
    // No shell interpolation: spaces and non-ASCII user directories remain literal.
    const child = spawn(process.execPath, [entry, ...args, '--fetch-retries=1', '--fetch-timeout=30000'], { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const codes = new Set();
    // Keep only known error categories, never echo npm output containing user paths or credentials.
    child.stderr.on('data', chunk => {
      for (const code of ['EACCES', 'EPERM', 'ENOSPC', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET']) {
        if (String(chunk).includes(code)) codes.add(code);
      }
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Official CLI installation timed out after 180 seconds; inspect network access before retrying'));
    }, 180_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Official CLI installation failed (exit ${code}; ${[...codes].join(',') || 'npm_error'}); check npm connectivity and directory permissions`));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--prefix', '--npm-cli'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: --prefix ABS_DIRECTORY --npm-cli ABS_NPM_CLI_JS');
    values[args[i]] = args[i + 1];
  }
  const npmCLI = values['--npm-cli'] ?? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(npmCLI)) throw new Error('Locate the npm-cli.js belonging to the selected Node installation and supply --npm-cli');
  console.log(JSON.stringify(await installCLI(values['--prefix'] ?? '', npmCLI)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(JSON.stringify({ ok: false, stage: 'cli_install', error: error.message })); process.exitCode = 1; });
}
