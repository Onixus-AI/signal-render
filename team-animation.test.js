import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyTeamClip} from './team-animation.js';
test('changed or unreviewed character footage cannot silently replace approved Onyx',()=>{
 assert.throws(()=>verifyTeamClip('onixa','wave',new Uint8Array([1])));
 assert.throws(()=>verifyTeamClip('onyx','dance',new Uint8Array([1])));
 assert.throws(()=>verifyTeamClip('onyx','wave',new Uint8Array([1])),/changed/);
});
