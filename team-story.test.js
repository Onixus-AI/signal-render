import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBeatStoryProps} from './motion-render.js';
const p={client_id:'cf7fd56a-ef84-48f4-8049-36282dec583b',plan:{creative_template:'OnixusTeamMotion'},brand:{logo_url:'https://example.com/old.png'},scenes:[{idx:0,start_ms:0,end_ms:4000,character:'onyx',character_action:'question',image_url:'https://example.com/work.png'}]};
test('team story uses only exact character and logo assets',()=>{const r=buildBeatStoryProps(p);assert.equal(r.teamStory,true);assert.equal(r.scenes[0].characterSrc,'https://veltra-model-1.vercel.app/team/onyx-v1.png');assert.match(r.brand.logoUrl,/onixus-workspace-icon-v2.png$/);});
test('unknown cast, foreign tenant and unreviewed aspect ratio fail closed',()=>{assert.throws(()=>buildBeatStoryProps({...p,client_id:'other'}));assert.throws(()=>buildBeatStoryProps({...p,scenes:[{...p.scenes[0],character:'invented'}]}));assert.throws(()=>buildBeatStoryProps(p,1080,1080));});
test('ordinary motion ads keep their own branding without Onixus cast',()=>{const r=buildBeatStoryProps({...p,client_id:'other',plan:{}});assert.equal(r.teamStory,false);assert.equal(r.brand.logoUrl,p.brand.logo_url);assert.equal(r.scenes[0].characterSrc,undefined);});
