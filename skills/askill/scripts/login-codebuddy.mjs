import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from './configure-workbuddy.mjs';

export function loginArguments() {
  return ['--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', 'none', '--no-session-persistence'];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.cliPath || options.persistCLI || options.verify) throw new Error('Use --repo ABS_REPO --cli-path ABS_CLI for interactive official sign-in');
  const runtime = await import(pathToFileURL(path.join(options.repo, 'orchestrator/src/local_agent_runtime.ts')).href);
  const bin = runtime.resolveCodeBuddyLocation(options.cliPath);
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
