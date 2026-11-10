#!/usr/bin/env node
'use strict';
/* Offline real-Chromium Account/Turnstile smoke test: no production or
   Supabase customer access. Requires an optional local Playwright install. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..');
const account={uid:'11111111-1111-4111-8111-111111111111',email:'qa@example.test',
 name:'Local QA',status:'locked',trialStatus:'not_activated',access:false,
 isAdmin:false,signalsUsed:0,signalsRemaining:3,trialEndsAt:null};
function json(res,value,code=200){
 res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});
 res.end(JSON.stringify(value));
}
function createServer(){
 return http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/config')return json(res,{
   brand:'SignalChart',authReady:true,supabaseUrl:'https://qa.supabase.co',
   supabaseAnonKey:'sb_publishable_qa_only',emailDeviceTrialEnabled:true,
   trialVerificationMethod:'verified_email_browser',
   turnstileSiteKey:'local-browser-qa-not-production',requiresVerifiedEmail:true
  });
  if(url.pathname==='/api/member'&&url.searchParams.get('action')==='me')
   return json(res,{account,payment:{enabled:false,priceUSD:20},requests:[]});
  if(url.pathname==='/api/trial'&&url.searchParams.get('action')==='state')
   return json(res,{trialStatus:'not_activated',signalsUsed:0,
    signalsRemaining:3,expiresAt:null,serverNow:new Date().toISOString()});
  if(url.pathname==='/api/premium-signals'&&url.searchParams.get('action')==='list')
   return json(res,{signals:[]});
  if(url.pathname.startsWith('/api/'))return json(res,{error:'Offline QA mutation blocked'},503);
  const relative=url.pathname==='/'?'account.html':url.pathname.replace(/^\/+/,'');
  if(relative.includes('..')||!/^[-a-zA-Z0-9_./]+$/.test(relative)){
   res.writeHead(400);res.end();return;
  }
  const filepath=path.resolve(ROOT,relative);
  if(!filepath.startsWith(ROOT+path.sep)){res.writeHead(404);res.end();return}
  try{
   const data=await fs.readFile(filepath);
   const mime=/\.html$/.test(filepath)?'text/html':/\.js$/.test(filepath)?'application/javascript':
    /\.css$/.test(filepath)?'text/css':/\.svg$/.test(filepath)?'image/svg+xml':
    /\.png$/.test(filepath)?'image/png':'application/octet-stream';
   res.writeHead(200,{'Content-Type':mime});res.end(data);
  }catch{res.writeHead(404);res.end('Not found')}
 });
}
const authStub="window.__scQaClientCount=0;window.__scQaSignedIn=true;"+
 "window.supabase={createClient:function(){window.__scQaClientCount++;return {auth:{"+
 "getSession:async()=>({data:{session:window.__scQaSignedIn?{access_token:'qa.local.token'}:null},error:null}),"+
 "onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),"+
 "signOut:async()=>{window.__scQaSignedIn=false;return {error:null}}"+
 "}}}};";
const turnstileStub="window.__scQaTurnstileCount=0;window.turnstile={"+
 "render:function(node,opts){if(node.closest('[hidden]'))throw Error('Hidden captcha');"+
 "window.__scQaTurnstileCount++;window.__scQaAction=opts.action;"+
 "node.textContent='Mock verification ready';return window.__scQaTurnstileCount;},"+
 "getResponse:function(){return '';},reset:function(){}};";
async function main(){
 const server=createServer();
 await new Promise((resolve,reject)=>{
  server.once('error',reject);server.listen(0,'127.0.0.1',resolve);
 });
 let browser;
 try{
  browser=await chromium.launch({headless:true,channel:'chromium',args:['--no-sandbox']});
  for(const width of [390,1280]){
   const page=await browser.newPage({viewport:{width,height:844},isMobile:width<600});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',body:authStub}));
   await page.route('https://challenges.cloudflare.com/turnstile/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',body:turnstileStub}));
   await page.goto('http://127.0.0.1:'+server.address().port+'/account.html');
   await page.waitForSelector('#member-area',{state:'visible',timeout:13000});
   await page.waitForFunction(()=>window.__scQaTurnstileCount===1,null,{timeout:13000});
   const m=await page.evaluate(()=>{
    const widget=document.querySelector('#sc-turnstile');
    return {count:window.__scQaTurnstileCount,clients:window.__scQaClientCount,
     action:window.__scQaAction,panelHidden:document.querySelector('#sc-browser-activation').hidden,
     width:widget.getBoundingClientRect().width,
     scrollWidth:document.documentElement.scrollWidth,
     viewport:document.documentElement.clientWidth};
   });
   assert.equal(m.count,1);assert.equal(m.clients,1);
   assert.equal(m.action,'trial_activate');assert.equal(m.panelHidden,false);
   assert.ok(m.width>0,'Captcha container width must be positive');
   assert.ok(m.scrollWidth<=m.viewport+2,
    'Horizontal overflow at '+width+': '+m.scrollWidth+' > '+m.viewport);
   await page.evaluate(()=>{
    window.__scQaSignedIn=false;
    window.dispatchEvent(new Event('signalchart:auth-changed'));
   });
   await page.waitForFunction(()=>document.querySelector('#sc-browser-activation').hidden,
    null,{timeout:3500});
   assert.deepEqual(errors,[],'No browser JS errors expected');
   console.log('BROWSER_QA_PASS '+JSON.stringify({width,clients:m.clients,
    turnstileRenders:m.count,horizontalOverflow:false}));
   await page.close();
  }
 }finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
 }
}
if(require.main===module)main().catch(e=>{
 console.error('BROWSER_QA_FAIL:',e.stack||e.message);process.exitCode=1;
});
