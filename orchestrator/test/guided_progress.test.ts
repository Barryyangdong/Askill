import test from 'node:test';
import assert from 'node:assert/strict';
import {beginProgress,progressOf} from '../src/guided_progress.ts';
test('progress rejects overlapping sessions and isolates roots without retaining inputs',()=>{
 const update=beginProgress('/a','sample','session-1');
 assert.throws(()=>beginProgress('/a','sample','session-1'));
 update('execute');assert.equal(progressOf('/a','sample','session-1')?.phase,'execute');
 assert.equal(progressOf('/b','sample','session-1'),null);
 update('complete');assert.equal(progressOf('/a','sample','session-1')?.phase,'complete');
 beginProgress('/a','sample','session-1')('cancelled');
 assert.throws(()=>progressOf('/a','sample','../outside'));
 assert.deepEqual(Object.keys(progressOf('/a','sample','session-1')!).sort(),['phase','started_at','updated_at']);
});
