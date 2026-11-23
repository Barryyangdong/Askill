import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {verifySource} from './verify-source.mjs';
test('source verification detects changed/missing files and traversal without executing source',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'askill-source-'));
 assert.equal(verifySource(root).verified,false);
 fs.writeFileSync(path.join(root,'sample.txt'),'known source');
 const hash=crypto.createHash('sha256').update('known source').digest('hex');
 const save=files=>fs.writeFileSync(path.join(root,'source-manifest.json'),JSON.stringify({format:1,product:'Askill',release:false,files}));
 save({'sample.txt':hash});assert.equal(verifySource(root).verified,true);
 fs.writeFileSync(path.join(root,'sample.txt'),'modified');assert.throws(()=>verifySource(root),/changed/);
 save({'missing.txt':hash});assert.throws(()=>verifySource(root),/missing/);
 save({'../outside.txt':hash});assert.throws(()=>verifySource(root),/Invalid/);
});
