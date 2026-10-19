// Subscription-free public-ad research using the worker's existing browser.
import {crawlCaseStudies} from './ad-case-studies.js';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
export const AD_HOSTS=new Set(['ads.tiktok.com','www.facebook.com','facebook.com','adstransparency.google.com']);
export function adUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&AD_HOSTS.has(u.hostname)?u:null;}catch{return null;}}
const STATIC_HOSTS=new Set(['sf16-website.neutral.ttwstatic.com','sf16-website-login.neutral.ttwstatic.com','sf-static.tiktokcdn.com']);
export function resourceUrl(value,type){if(adUrl(value))return adUrl(value);try{const u=new URL(value);return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&STATIC_HOSTS.has(u.hostname)&&['script','stylesheet'].includes(type)&&u.pathname.startsWith('/obj/')?u:null;}catch{return null;}}
export async function allowedResourceRequest(value,type,resolve=lookup){const u=resourceUrl(value,type);if(!u)return false;try{const ips=await resolve(u.hostname,{all:true,family:4});return ips.length>0&&ips.every(x=>publicIp(x.address));}catch{return false;}}
export function publicIp(ip){if(isIP(ip)===4){const a=ip.split('.').map(Number);return !(a[0]===0||a[0]===10||a[0]===127||a[0]>=224||(a[0]===169&&a[1]===254)||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&a[1]===168)||(a[0]===100&&a[1]>=64&&a[1]<=127)||(a[0]===198&&(a[1]===18||a[1]===19)));}return false;}
export async function allowedAdRequest(value,resolve=lookup){const u=adUrl(value);if(!u)return false;try{const ips=await resolve(u.hostname,{all:true,family:4});return ips.length>0&&ips.every(x=>publicIp(x.address));}catch{return false;}}
export function individualAd(value){const u=adUrl(value);return !!u&&(/\/topads\/\d+/.test(u.pathname)||(u.hostname.includes('facebook')&&u.pathname.startsWith('/ads/library')&&/^\d+$/.test(u.searchParams.get('id')??''))||/\/advertiser\/[^/]+\/creative\/[^/]+/.test(u.pathname));}
export function adSeeds(topic){const q=encodeURIComponent(String(topic).slice(0,120));return [`https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?search=${q}`,`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=${q}`];}
export async function crawlPublicAds(browser,{topic='',urls=[]}={}){
 const queue=(urls.length?urls:adSeeds(topic)).slice(0,6);if(queue.some(x=>!adUrl(x)))throw Error('unsupported_ad_url');
 const deadline=Date.now()+45000;
 const cases=await crawlCaseStudies({topic,urls});if(cases.status==='ready')return cases;
 const visited=new Set(),sources=[...cases.sources],failures=[...cases.failures];
 for(let i=0;i<queue.length&&visited.size<6&&sources.length<6&&Date.now()<deadline;i++){
  const url=queue[i];if(visited.has(url))continue;visited.add(url);let page;
  try{
   if(!await allowedAdRequest(url))throw Error('ad_host_unavailable');
   page=await browser.newPage();await page.setViewport({width:1280,height:900});
   const cache=new Map();await page.setRequestInterception(true);
   page.on('request',async r=>{try{if(['image','media','font','websocket'].includes(r.resourceType()))return await r.abort();const u=resourceUrl(r.url(),r.resourceType());if(!u)return await r.abort();let ok=cache.get(u.hostname);if(ok===undefined){ok=await allowedResourceRequest(r.url(),r.resourceType());cache.set(u.hostname,ok);}if(!ok)await r.abort();else await r.continue();}catch{await r.abort().catch(()=>{});}});
   await page.goto(url,{waitUntil:'domcontentloaded',timeout:8000});
   if(!adUrl(page.url()))throw Error('ad_redirect_blocked');
   // Public libraries hydrate their ad cards after DOMContentLoaded. Wait for
   // a readable result or an explicit access/empty state within the job budget.
   await page.waitForFunction(()=>/captcha|verify you are human|log in to continue|no search results/i.test(document.body?.innerText??'')||Array.from(document.querySelectorAll('a[href]')).some(a=>/\/topads\/\d+|[?&]id=\d+|\/advertiser\/[^/]+\/creative\//.test(a.href)),{timeout:Math.max(1,Math.min(6000,deadline-Date.now()))}).catch(()=>{});
   const data=await page.evaluate(()=>({text:(document.body?.innerText??'').slice(0,20000),links:Array.from(document.querySelectorAll('a[href]'),a=>a.href).slice(0,300)}));
   if(/captcha|verify you are human|unusual traffic|log in to continue/i.test(data.text))throw Error('ad_library_access_required');
   for(const link of data.links)if(individualAd(link)&&!visited.has(link)&&queue.length<12)queue.push(link);
   const excerpt=data.text.replace(/\s+/g,' ').trim().slice(0,6000);
   // A library landing page is discovery, never evidence about an actual ad.
   if(individualAd(page.url())&&excerpt.length>=150)sources.push({url:page.url(),excerpt,retrieved_at:new Date().toISOString(),kind:'public_ad_page',performance:'unknown',limitation:'Public text observation only; no verified spend, views or conversions.'});
  }catch(e){failures.push({url,error:e.message});}finally{await page?.close().catch(()=>{});}
 }
 return {sources,failures,visited:visited.size,status:sources.length>=2?'ready':'insufficient_evidence'};
}
