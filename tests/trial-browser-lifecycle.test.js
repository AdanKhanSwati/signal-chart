'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'..','sc-trial-ui.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture({memberVisible=false,trialEnabled=true,verifiedSession=true,existingShared=false,trialOverride=null}={}){
 const browserPanel={hidden:true},memberArea={hidden:!memberVisible};
 const renders=[],observations=[],handlers={};let clientCreations=0;
 const nodes={
  '#sc-trial-account':{},'#sc-turnstile':{id:'sc-turnstile'},
  '#member-area':memberArea,'#sc-browser-activation':browserPanel,
  '#sc-activate-browser':{disabled:true,addEventListener(){}},
  '#sc-trial-state':{textContent:''},
  '#sc-trial-clock':{textContent:''},
  '#sc-trial-credits':{textContent:''},
  '#sc-trial-upgrade':{hidden:true},
  '#sc-browser-availability':{textContent:'',dataset:{}},
  '#sc-browser-guide-link':{href:'',textContent:''},
  '#sc-browser-delivery-note':{textContent:''}
 };
 const account={getSession:async()=>({data:{session:verifiedSession?{access_token:'qa.jwt.test'}:null},error:null})};
 const render=()=>{assert.equal(memberArea.hidden,false);assert.equal(browserPanel.hidden,false);renders.push(true);return 7};
 const context={
  document:{querySelector:sel=>nodes[sel]||null,
   querySelectorAll:()=>[],
   createElement:()=>{throw Error('Unexpected script creation')}},
  window:{supabase:{createClient:()=>{clientCreations++;return {auth:account}}},
   turnstile:{render,getResponse:()=>'',reset(){}},
   addEventListener(name,handler){handlers[name]=handler}},
  MutationObserver:class{constructor(callback){this.callback=callback;observations.push(this)}observe(){}},
  setInterval(){return 1},
  fetch:async url=>{
   const u=String(url);
   if(u==='/api/config')return {ok:true,json:async()=>({
    authReady:true,supabaseUrl:'https://qa.supabase.co',supabaseAnonKey:'publishable-qa',
    emailDeviceTrialEnabled:trialEnabled,trialVerificationMethod:'verified_email_browser',
    turnstileSiteKey:'qa-cloudflare-site'})};
   if(u==='/api/trial?action=state')return {ok:true,json:async()=>({
    trialStatus:'not_activated',serverNow:new Date().toISOString(),...(trialOverride||{})})};
   if(u==='/api/member?action=me')return {ok:true,json:async()=>({account:{status:'locked'}})};
   throw Error('Unexpected URL '+u);
  },
  Date,Math,Promise,URL,Error,Event:class{},setTimeout:()=>{},
  location:{assign:()=>{throw Error('Should not navigate')}}
 };
 if(existingShared)context.window.__scSupabaseAuthClient={
  url:'https://qa.supabase.co',anonKey:'publishable-qa',promise:Promise.resolve({auth:account})
 };
 vm.runInNewContext(script,context,{timeout:1800});
 for(let i=0;i<8;i++)await tick();
 return {nodes,renders,observations,handlers,browserPanel,memberArea,clientCreations:()=>clientCreations,async settle(){for(let i=0;i<6;i++)await tick()}};
}
test('authenticated browser trial widget is not rendered into hidden account panel',async()=>{
 const q=await fixture();
 assert.equal(q.browserPanel.hidden,false,'Signed-in trial panel should become eligible to show');
 assert.equal(q.memberArea.hidden,true);
 assert.equal(q.renders.length,0,'Cloudflare must not render before the account is visible');
 q.memberArea.hidden=false;
 for(const observer of q.observations)observer.callback();
 await q.settle();
 assert.equal(q.renders.length,1,'Show the widget as soon as the account is visible');
 q.observations.forEach(observer=>observer.callback());
 await q.settle();
 assert.equal(q.renders.length,1,'Duplicate DOM mutations must not render extra widgets');
});
test('visible authenticated account renders one anti-bot widget after state refresh',async()=>{
 const q=await fixture({memberVisible:true});
 assert.equal(q.renders.length,1);
 assert.equal(q.browserPanel.hidden,false);
});
test('disabled email/browser trial never renders an anti-bot widget',async()=>{
 const q=await fixture({memberVisible:true,trialEnabled:false});
 assert.equal(q.renders.length,0);
 assert.equal(q.nodes['#sc-activate-browser'].disabled,true);
});
test('signed-out account does not request a challenge on initial page load',async()=>{
 const q=await fixture({memberVisible:false,verifiedSession:false});
 assert.equal(q.renders.length,0);
 assert.equal(q.browserPanel.hidden,true);
});

test('trial UI reuses an existing account Supabase session instead of opening another',async()=>{
 const q=await fixture({memberVisible:true,existingShared:true});
 assert.equal(q.clientCreations(),0,'No competing Supabase Auth client should be created');
 assert.equal(q.renders.length,1,'Shared auth session must still allow verified trial onboarding');
});
test('the Account and trial pages use an identical shared Supabase client helper',()=>{
 const account=fs.readFileSync(path.join(__dirname,'..','candriva-v2.js'),'utf8');
 const extract=(s)=>{
  const begin=s.indexOf('async function sharedSupabaseClient(');
  const end=s.indexOf('\n}\n',begin);
  assert.ok(begin>0&&end>begin);
  return s.slice(begin,end+3);
 };
 assert.equal(extract(account),extract(script),'Both pages must share exactly the same client-construction policy');
 assert.ok(extract(script).includes('window.__scSupabaseAuthClient'));
});

test('an expired trial never looks active when the tab is reopened without a backend status change',async()=>{
 const q=await fixture({memberVisible:true,trialOverride:{
  trialStatus:'active',signalsUsed:1,signalsRemaining:2,
  expiresAt:new Date(Date.now()-90000).toISOString()
 }});
 assert.equal(q.nodes['#sc-trial-state'].textContent,'Free trial expired');
 assert.match(q.nodes['#sc-trial-clock'].textContent,/^Expired /);
 assert.equal(q.nodes['#sc-trial-credits'].textContent,'0 of 3 remaining');
 assert.equal(q.nodes['#sc-trial-upgrade'].hidden,false,'Expired trial must show upgrade path');
 assert.equal(q.browserPanel.hidden,true,'Expired trial must not allow a second activation');
 assert.equal(q.renders.length,0,'Expired trials do not need a CAPTCHA widget');
});
test('nonexpired trial still shows its remaining credits and stays active',async()=>{
 const q=await fixture({memberVisible:true,trialOverride:{
  trialStatus:'active',signalsUsed:1,signalsRemaining:2,
  expiresAt:new Date(Date.now()+3600000).toISOString()
 }});
 assert.equal(q.nodes['#sc-trial-state'].textContent,'Free trial active');
 assert.equal(q.nodes['#sc-trial-credits'].textContent,'2 of 3 remaining');
 assert.equal(q.nodes['#sc-trial-upgrade'].hidden,true);
});
