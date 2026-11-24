import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authorizeWorkBuddy } from './auth-workbuddy.mjs';

function fixture(t, settings = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'askill-auth-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 }));
  const source = path.join(repo, 'orchestrator', 'src');
  fs.mkdirSync(source, { recursive: true });
  const cliPath = path.join(repo, 'fixture.cjs');
  fs.writeFileSync(path.join(source, 'local_agent_runtime.ts'), `
    export const resolveCodeBuddyLocation = bin => bin;
    export const probeCodeBuddyForSetup = async env => ({status: ${JSON.stringify(settings.ready ? 'ready' : 'not_authenticated')},
      authenticated: ${Boolean(settings.ready)}, cli_path: env.CODEBUDDY_BIN});
    export const localSubscriptionEnv = () => ({});
    export const isWorkBuddyBundledCli = () => false;
    export const executableInvocation = bin => ({ file: process.execPath, args: [bin] });
  `);
  fs.writeFileSync(cliPath, `
    const fs = require('node:fs');
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      const q = JSON.parse(line);
      fs.appendFileSync('requests', q.method + ':' + (q.params.methodId ?? '') + '\\n');
      let response = {};
      if (q.method === 'initialize') response.result = {protocolVersion:1,authMethods:${JSON.stringify(settings.methods ?? [{id:'internal'},{id:'external'}])}};
      if (q.method === 'session/load') response = ${JSON.stringify(settings.guard ?? {error:{code:-32000,data:{category:'auth'},message:'Authentication required'}})};
      if (q.method === 'authenticate') {
        if (${Boolean(settings.hold)}) return;
        response = ${JSON.stringify(settings.auth ?? {result:{_meta:{sensitiveFixture:'MUST_STAY_PRIVATE'}}})};
      }
      console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,...response}));
    });
  `);
  const requests = () => {
    try { return fs.readFileSync(path.join(repo,'requests'),'utf8').trim().split('\n'); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  return { options: {repo, cliPath, timeoutMs: 4000}, requests };
}

for (const [site, method] of [['cn','internal'],['international','external']]) {
  test('official browser authorization uses ' + site + ' after an explicit same-process auth error', async t => {
    const { options, requests } = fixture(t, {ready:true});
    const progress = [];
    assert.deepEqual(await authorizeWorkBuddy({...options, site, realAuthRejected:true, onProgress: msg => progress.push(msg)}), {authorized:true});
    assert.deepEqual(requests(), ['initialize:', 'session/load:', 'authenticate:'+method]);
    assert.equal(progress.length, 1);
    assert.doesNotMatch(JSON.stringify(progress), /MUST_STAY_PRIVATE/);
  });
}

test('absent methods, existing sessions and ambiguous failures never trigger reauthentication', async t => {
  for (const [settings, code] of [[{ready:true},'auth_session_exists'],[{methods:[]},'auth_unsupported'],
    [{guard:{result:{}}},'auth_session_exists'],[{guard:{error:{code:-32000,data:{category:'auth'},message:'MUST_STAY_PRIVATE'}}},'auth_failed']]) {
    const { options, requests } = fixture(t, settings);
    await assert.rejects(authorizeWorkBuddy(options), e => e.code === code && !e.message.includes('MUST_STAY_PRIVATE'));
    assert.ok(!requests().includes('authenticate:internal'));
  }
});

test('one pending authorization per user, with cancellation, timeout and subsequent retry', async t => {
  const { options } = fixture(t, {hold:true});
  const controller = new AbortController();
  const started = Promise.withResolvers();
  const pending = authorizeWorkBuddy({...options,signal:controller.signal,onProgress:()=>started.resolve()});
  await Promise.race([started.promise, pending]);
  await assert.rejects(authorizeWorkBuddy(options), {code:'auth_busy'});
  controller.abort();
  await assert.rejects(pending, {code:'auth_cancelled'});
  await assert.rejects(authorizeWorkBuddy({...options,timeoutMs:150}), {code:'auth_timeout'});
  const retry = fixture(t);
  assert.deepEqual(await authorizeWorkBuddy(retry.options), {authorized:true});
});
