// Public, platform-authored campaign evidence. No account or paid crawler.
import {allowedAdRequest} from './ad-crawler.js';
const ORIGIN='https://ads.tiktok.com';
export function caseStudyUrl(value){try{const u=new URL(value,ORIGIN);if(u.origin!==ORIGIN||u.username||u.password||!/^\/business\/en(?:-US)?\/inspiration\/(?!industry(?:\/|$)|solution(?:\/|$))[a-z0-9-]+\/?$/i.test(u.pathname))return null;u.search='';u.hash='';return u.href;}catch{return null;}}
export function caseStudyLinks(html){const urls=[];for(const match of html.matchAll(/href=["']([^"']+)["']/gi)){const url=caseStudyUrl(match[1].replaceAll('&amp;','&'));if(url&&!urls.includes(url))urls.push(url);}return urls.slice(0,40);}
export function caseStudySeeds(topic){
 const t=topic.toLowerCase(),labels=[];
 if(/financ|invest|trading|broker|bank/.test(t))labels.push('Financial services');
 if(/software|technology|\bsaas\b|\bai\b|automation|digital/.test(t))labels.push('Technology');
 if(/consult|professional|logistic|freight|trucking|business service/.test(t))labels.push('Professional services');
 if(/food|bakery|restaurant|beverage/.test(t))labels.push('Food & beverage');
 if(/retail|commerce|store|distribut|manufactur/.test(t))labels.push('Retail');
 return labels.slice(0,2).map(x=>ORIGIN+'/business/en/inspiration/industry/'+encodeURIComponent(x)).concat(ORIGIN+'/business/en/inspiration');
}
export function caseStudyText(html){
 const article=html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]??html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]??html;
 return article.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp|quot|#39);/g,' ').replace(/\s+/g,' ').trim().slice(0,12000);
}
export function relevantCase(text,topic){
 const generic=new Set(['business','services','service','content','social','media','platform','audience','campaign','growth','customers','customer','marketing','tiktok','instagram','facebook','generate','increase','target','people','their','with','that','this','brand','brands','sales','engagement','awareness']);
 const words=[...new Set(topic.toLowerCase().match(/[a-z]{4,}/g)??[])].filter(w=>!generic.has(w));
 const lower=text.toLowerCase();
 return words.filter(w=>lower.includes(w));
}
export async function readOfficialAdPage(value,transport=fetch){
 let url=new URL(value);
 for(let hop=0;hop<4;hop++){
  if(url.origin!==ORIGIN||!await allowedAdRequest(url.href))throw Error('case_study_host_unavailable');
  const r=await transport(url,{redirect:'manual',signal:AbortSignal.timeout(7000)});
  if([301,302,303,307,308].includes(r.status)){const location=r.headers.get('location');await r.body?.cancel();if(!location)throw Error('case_study_redirect_invalid');url=new URL(location,url);continue;}
  if(!r.ok||!/text\/html/i.test(r.headers.get('content-type')??''))throw Error('case_study_unavailable');
  const reader=r.body.getReader(),chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2000000){await reader.cancel();throw Error('case_study_too_large');}chunks.push(value);}
  return {url:url.href,html:new TextDecoder().decode(Buffer.concat(chunks))};
 }
 throw Error('case_study_redirect_limit');
}
export async function crawlCaseStudies({topic='',urls=[]}={},read=readOfficialAdPage){
 const explicit=urls.filter(caseStudyUrl).map(caseStudyUrl),seeds=urls.length?[]:caseStudySeeds(topic),queue=[...explicit],seen=new Set(),sources=[],failures=[];
 const deadline=Date.now()+30000;
 for(const seed of seeds){if(Date.now()>deadline||queue.length>=12)break;try{const page=await read(seed);for(const link of caseStudyLinks(page.html))if(!queue.includes(link))queue.push(link);}catch(e){failures.push({url:seed,error:e.message});}}
 for(const url of queue.slice(0,8)){
  if(seen.has(url)||Date.now()>deadline||sources.length>=4)continue;seen.add(url);
  try{const page=await read(url);if(!caseStudyUrl(page.url))throw Error('case_study_redirect_blocked');const excerpt=caseStudyText(page.html),matched=relevantCase(excerpt,topic);
   if(!/<h1\b/i.test(page.html)||/page not found|verify you are human|captcha/i.test(excerpt))throw Error('case_study_not_available');
   if(sources.some(s=>s.url===caseStudyUrl(page.url)))continue;
   if(excerpt.length<150||!matched.length){failures.push({url,error:'case_study_not_relevant'});continue;}
   sources.push({url:caseStudyUrl(page.url),excerpt:excerpt.slice(0,6000),retrieved_at:new Date().toISOString(),kind:'platform_case_study',platform:'tiktok',matched_terms:matched,performance:'platform_reported_campaign_results',limitation:'Historical campaign-level results published by the platform, not independently verified. Does not establish current performance, competitor spend or a single creative’s causal effect.'});
  }catch(e){failures.push({url,error:e.message});}
 }
 return {sources,failures,visited:seen.size,status:sources.length>=2?'ready':'insufficient_evidence'};
}
