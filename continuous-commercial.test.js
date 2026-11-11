import test from 'node:test';
import assert from 'node:assert/strict';
import {continuousCommercialFit,motionTimelineFit} from './ugc-timing.js';
test('a short continuous take retains the full 30-second commercial and CTA holds',()=>{
 assert.deepEqual(continuousCommercialFit(30,23.2),{scale:1,total:30});
 assert.notEqual(motionTimelineFit(30,23.2).scale,1);
});
test('an overlong take is rejected rather than truncated or sped up',()=>{
 assert.throws(()=>continuousCommercialFit(30,30.5),/exceeds/);
 assert.throws(()=>continuousCommercialFit(30,NaN),/invalid/);
});
