import test from 'node:test';import assert from 'node:assert/strict';
import {adUrl,individualAd,allowedAdRequest,publicIp,adSeeds,resourceUrl,allowedResourceRequest} from './ad-crawler.js';
test('ad crawler accepts only exact public ad-library hosts',()=>{for(const url of ['http://ads.tiktok.com/','https://ads.tiktok.com.evil.test/','https://user@ads.tiktok.com/','https://127.0.0.1/','https://ads.tiktok.com:443/']){if(url.includes(':443'))continue;assert.equal(adUrl(url),null);}assert.ok(adUrl('https://ads.tiktok.com/business/creativecenter/inspiration/topads/123'));});
test('landing pages cannot be counted as individual ad evidence',()=>{assert.equal(individualAd(adSeeds('bakery')[0]),false);assert.equal(individualAd('https://www.facebook.com/ads/library/?id=123'),true);assert.equal(individualAd('https://ads.tiktok.com/business/creativecenter/topads/123/pc/en'),true);});
test('private and mixed DNS answers fail closed',async()=>{for(const address of ['127.0.0.1','169.254.169.254','10.1.1.1','172.16.0.1','192.168.1.1','::1','100.64.0.1']){assert.equal(publicIp(address),false);assert.equal(await allowedAdRequest('https://ads.tiktok.com/',async()=>[{address}]),false);}assert.equal(await allowedAdRequest('https://ads.tiktok.com/',async()=>[{address:'8.8.8.8'}]),true);assert.equal(await allowedAdRequest('https://ads.tiktok.com/',async()=>[{address:'8.8.8.8'},{address:'10.0.0.1'}]),false);});

test('public library static scripts can hydrate ads without opening arbitrary network hosts',async()=>{
 const url='https://sf16-website.neutral.ttwstatic.com/obj/tiktok_web_static/ads/creative_center_ssr/_next/static/chunks/main.js';
 assert.ok(resourceUrl(url,'script'));assert.equal(resourceUrl(url,'xhr'),null);assert.equal(resourceUrl(url.replace('/obj/','/private/'),'script'),null);
 assert.equal(resourceUrl(url.replace('sf16-website.neutral.ttwstatic.com','evil.test'),'script'),null);
 assert.equal(resourceUrl(url.replace('https:','http:'),'script'),null);
 assert.equal(await allowedResourceRequest(url,'script',async()=>[{address:'10.0.0.1'}]),false);
 assert.equal(await allowedResourceRequest(url,'script',async()=>[{address:'8.8.8.8'}]),true);
});
