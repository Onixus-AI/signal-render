import test from 'node:test';import assert from 'node:assert/strict';
import {caseStudyUrl,caseStudyLinks,caseStudyText,relevantCase,caseStudySeeds,crawlCaseStudies} from './ad-case-studies.js';
test('only actual official case-study paths become evidence',()=>{
 assert.equal(caseStudyUrl('https://evil.test/business/en/inspiration/example'),null);
 assert.equal(caseStudyUrl('https://ads.tiktok.com/business/en/inspiration/industry/Technology'),null);
 assert.equal(caseStudyUrl('https://ads.tiktok.com/business/en/inspiration/solution/Ads'),null);
 assert.equal(caseStudyUrl('https://ads.tiktok.com/business/en/inspiration/example?tracking=x'),'https://ads.tiktok.com/business/en/inspiration/example');
 assert.equal(caseStudyLinks('<a href="/business/en/inspiration/example">Example</a><a href="/business/en/inspiration/industry/Technology">Industry</a>').length,1);
});
test('navigation and generic marketing language cannot establish topic relevance',()=>{
 const text=caseStudyText('<body><nav>financial trading</nav><main><h1>Cakes</h1><p>Bakery advertising results</p></main><script>finance</script></body>');
 assert.deepEqual(relevantCase(text,'financial trading business marketing'),[]);
 assert.ok(relevantCase(text,'bakery food').includes('bakery'));
 assert.ok(caseStudySeeds('financial software').some(x=>x.includes('Financial%20services')));
});
test('campaign case studies retain provenance and cannot invent ad-level performance',async()=>{
 const html='<main><h1>Technology software campaign</h1><p>'+('Software product demonstration and platform-reported campaign results. '.repeat(5))+'</p></main>';
 const read=async url=>({url,html:url.includes('/industry/')||url.endsWith('/inspiration')?'<a href="/business/en/inspiration/software-one">One</a><a href="/business/en/inspiration/software-two">Two</a>':html});
 const result=await crawlCaseStudies({topic:'software technology'},read);
 assert.equal(result.status,'ready');assert.equal(result.sources.length,2);
 assert.equal(result.sources[0].kind,'platform_case_study');assert.match(result.sources[0].limitation,/not independently verified/);
 assert.equal((await crawlCaseStudies({topic:'bakery'},read)).status,'insufficient_evidence');
});
