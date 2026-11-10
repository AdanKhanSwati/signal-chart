'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('all first-party browser API calls preserve preview access cookies',()=>{
 const expected={'candriva-v2.js':2,'crypto-ui.js':1,'sc-trial-ui.js':2,'site-app.js':3};
 for(const [file,count] of Object.entries(expected)){
  const source=read(file);
  const occurrences=source.match(/credentials\s*[:=]\s*['"]same-origin['"]/g)||[];
  assert.equal(occurrences.length,count,file+': expected '+count+' same-origin credentials usages');
  assert.doesNotMatch(source,/credentials\s*[:=]\s*['"]omit['"]/,file+' must not omit cookies on same-origin APIs');
 }
});

async function accountScenario(memberReply){
 const status={textContent:'',children:[],classList:{toggle(){}},append(...nodes){this.children.push(...nodes)}};
 const authOff={hidden:true},sent=[];
 const elements={'#v2-status':status,'#auth-off':authOff};
 const document={
  body:{dataset:{candrivaPage:'account'}},
  querySelector:sel=>elements[sel]||null,
  querySelectorAll:()=>[],
  createElement:tag=>({tagName:tag.toUpperCase(),textContent:'',className:'',onclick:null})
 };
 const window={supabase:{createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'test-only-verified-token'}}})}})}};
 const fetch=async(url,options)=>{
  sent.push({url,options});
  if(url==='/api/config')return {ok:true,status:200,json:async()=>({
   authReady:true,supabaseUrl:'https://test.supabase.co',supabaseAnonKey:'test-public-key'
  })};
  if(url==='/api/member?action=me')return await memberReply();
  throw Error('Unexpected API call: '+url);
 };
 const loc={href:'https://protected-preview.vercel.app/account.html',origin:'https://protected-preview.vercel.app',reload(){}};
 vm.runInNewContext(read('candriva-v2.js'),{document,window,location:loc,URL,setTimeout,console,fetch});
 await new Promise(resolve=>setTimeout(resolve,40));
 return {status,authOff,sent};
}

test('signed-in member request sends the bearer token AND Vercel preview cookie credentials',async()=>{
 const r=await accountScenario(async()=>({ok:false,status:401,json:async()=>({error:'Session not authorized'})}));
 const api=r.sent.find(x=>x.url.startsWith('/api/member?'));
 assert.ok(api,'profile must request membership after Supabase session');
 assert.equal(api.options.credentials,'same-origin');
 assert.equal(api.options.headers.Authorization,'Bearer test-only-verified-token');
 assert.equal(r.authOff.hidden,true,'the site must not report missing Supabase on API authorization failure');
 assert.match(r.status.textContent,/Session not authorized/);
});

test('protected preview HTML response is diagnosed without claiming Supabase is unconfigured',async()=>{
 const r=await accountScenario(async()=>({ok:true,status:200,headers:{get:()=> 'text/html; charset=utf-8'},json:async()=>({})}));
 assert.match(r.status.textContent,/returned a webpage instead of JSON/i);
 assert.equal(r.authOff.hidden,true);
});

test('blocked protected-preview network request shows actionable account-access message',async()=>{
 const r=await accountScenario(async()=>{throw new TypeError('Failed to fetch')});
 assert.match(r.status.textContent,/protected preview/i);
 assert.equal(r.authOff.hidden,true);
});
