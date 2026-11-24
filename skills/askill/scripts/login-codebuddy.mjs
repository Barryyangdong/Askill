import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from './configure-workbuddy.mjs';

export function loginArguments() {
  return ['--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', 'none', '--no-session-persistence'];
}

function parseLoginArgs(args) {
  const prepare = args.includes('--prepare-windows');
  const location = args.indexOf('--output');
  let output;
  if (location !== -1) {
    output = args[location + 1];
    if (!prepare || !output || !path.isAbsolute(output) || path.extname(output).toLowerCase() !== '.cmd')
      throw new Error('--output requires --prepare-windows and a new absolute .cmd filename');
    args.splice(location, 2);
  }
  const options = parseArgs(args.filter(arg => arg !== '--prepare-windows'));
  if (!options.cliPath || options.persistCLI || options.verify)
    throw new Error('Use --repo ABS_REPO --cli-path ABS_CLI for interactive official sign-in');
  return { ...options, prepare, output };
}

function prepareWindowsLauncher(repo, bin, output) {
  if (process.platform !== 'win32') throw new Error('--prepare-windows requires Windows');
  const launcher = output ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'Askill-login-')), 'WorkBuddy-login.cmd');
  const config = { node: process.execPath, script: fileURLToPath(import.meta.url), repo, cli: bin };
  // The final comment contains data only. Neither cmd nor PowerShell interprets paths as source.
  const data = Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
  const command = [
    "$ErrorActionPreference='Stop'",
    '$payload=([IO.File]::ReadAllLines($env:ASKILL_LOGIN_FILE))[-1].Substring(3)',
    '$cfg=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)))',
    '& $cfg.node $cfg.script --repo $cfg.repo --cli-path $cfg.cli',
    'exit $LASTEXITCODE',
  ].join('; ');
  const batch = [
    '@echo off', 'setlocal DisableDelayedExpansion', 'set "ASKILL_LOGIN_FILE=%~f0"',
    'echo Opening official CodeBuddy sign-in. Return to WorkBuddy after authorization.',
    `"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -Command "${command}"`,
    'set "ASKILL_LOGIN_RC=%ERRORLEVEL%"',
    'if not "%ASKILL_LOGIN_RC%"=="0" (echo Sign-in failed. Return to WorkBuddy with the error above. & pause)',
    'exit /b %ASKILL_LOGIN_RC%', `:: ${data}`,
  ].join('\r\n') + '\r\n';
  fs.writeFileSync(launcher, batch, { encoding: 'ascii', flag: 'wx' });
  return { ok: true, launcher_path: launcher, verified: false };
}

async function main() {
  const options = parseLoginArgs(process.argv.slice(2));
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18) || !process.features.typescript)
    throw new Error('请使用支持原生 TypeScript 的 Node.js 22.18 或更高版本，并启用类型剥离后重试。');
  const runtime = await import(pathToFileURL(path.join(options.repo, 'orchestrator/src/local_agent_runtime.ts')).href);
  // The setup probe supplies an absolute path. A literal %NAME% in it must stay literal.
  const bin = runtime.resolveCodeBuddyLocation(options.cliPath, {});
  if (options.prepare) {
    console.log(JSON.stringify(prepareWindowsLauncher(options.repo, bin, options.output)));
    return;
  }
  const env = { ...runtime.localSubscriptionEnv(process.env, 'codebuddy'), DISABLE_AUTOUPDATER: '1',
    CODEBUDDY_DISABLE_AUTO_MEMORY: '1', CODEBUDDY_CODE_DISABLE_AUTO_MEMORY: '1',
    ...(runtime.isWorkBuddyBundledCli(bin) ? { CODEBUDDY_FORCE_LITE_WB_BUNDLE: '1' } : {}) };
  const invocation = runtime.executableInvocation(bin, loginArguments(), env);
  // Interactive sign-in only. Native argv preserves empty tools/JSON on Windows.
  // The official CLI owns browser authorization and storage; this script sees no credentials.
  const child = spawn(invocation.file, invocation.args, { env, cwd: path.dirname(bin), shell: false, stdio: 'inherit' });
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
