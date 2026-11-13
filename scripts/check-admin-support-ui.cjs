'use strict';
// Local browser QA with synthetic identities and a mocked Supabase transport.
// Requires Playwright + Chromium. Never calls a live database or sends a message.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const ADMIN='e29aafda-2cc8-4e11-a587-c983dd3f9113';
const CUSTOMER='17aac18d-cb89-49a5-9aba-92a119c9554e';
const TICKET='fe13386e-c87a-4f15-92dd-4c1ebff476e1';
const env={SUPABASE_URL:'https://qa-instance.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:'sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
 SUPABASE_SECRET_KEY:'sb_secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',SC_SUPER_ADMIN_UID:ADMIN};
(async()=>{
 const {createWorker}=await import(pathToFileURL(path.join(root,'cloudflare/worker.mjs')));
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 try{
 for(const width of [390,1280]){
  let revoked=false,status='open',replies=0;
  const messages=[{ticket_id:TICKET,sender_type:'customer',message:'Please check my chart',created_at:'2026-11-13T06:00:00Z'}];
  const ticket=()=>({id:TICKET,user_id:CUSTOMER,subject:'Chart support',category:'technical',status,updated_at:'2026-11-13T06:00:00Z'});
  const worker=createWorker({fetchFn:async(raw,opts={})=>{
   const url=new URL(raw);let data;
   if(url.pathname==='/auth/v1/user')data={id:revoked?CUSTOMER:ADMIN,email:'qa@example.test',email_confirmed_at:'2026-11-13T00:00:00Z'};
   else if(url.pathname==='/rest/v1/sc_support_tickets')data=url.searchParams.has('id')||url.searchParams.get('status')==='eq.'+status?[ticket()]:[];
   else if(url.pathname==='/rest/v1/sc_support_messages')data=messages;
   else if(url.pathname==='/rest/v1/rpc/sc_support_reply'){
    const body=JSON.parse(opts.body);assert.equal(body.p_admin,true);assert.equal(body.p_actor,ADMIN);
    messages.push({ticket_id:TICKET,sender_type:'admin',message:body.p_message,created_at:'2026-11-13T07:00:00Z'});
    replies++;data={status:'sent'};
   }else if(url.pathname==='/rest/v1/rpc/sc_support_close'){status='closed';data={status:'closed'};}
   else throw Error('Unexpected backend request '+url.pathname);
   return Response.json(data);
  }});
  const page=await browser.newPage({viewport:{width,height:850}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'synthetic.browser.qa-token-12345678901234567890'}}})}})};
  });
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.hostname!=='signalchart.test')return route.abort();
   if(url.pathname.startsWith('/api/')){
    const response=await worker.fetch(new Request(request.url(),{method:request.method(),headers:request.headers(),body:request.method()==='POST'?request.postData():undefined}),env);
    return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
   }
   const file=path.join(root,path.basename(url.pathname));
   if(url.pathname.endsWith('.js')&&url.pathname!=='/site-app.js')return route.fulfill({contentType:'text/javascript',body:''});
   if(!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
   const type={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)]||'application/octet-stream';
   return route.fulfill({contentType:type,body:fs.readFileSync(file)});
  });
  await page.goto('http://signalchart.test/ops.html');
  await page.locator('#ops-ticket-list button').waitFor();
  assert.equal(await page.locator('#ops-tab-messages').isVisible(),true);
  for(const tab of ['payments','settings','members','trials'])assert.equal(await page.locator(`[data-ops-tab="${tab}"]`).isVisible(),false);
  assert.equal(await page.locator('#ops-push').isVisible(),false);
  await page.locator('#ops-ticket-list button').click();
  await page.locator('#ops-reply-form').waitFor({state:'visible'});
  await page.locator('#ops-reply').fill('Investigating the chart now.');
  await page.locator('#ops-reply-form button[type=submit]').click();
  await page.getByText('Reply delivered.',{exact:true}).waitFor();assert.equal(replies,1);
  await page.locator('#ops-close-ticket').click();
  await page.locator('#ops-thread-state').filter({hasText:'CLOSED'}).waitFor();
  assert.equal(await page.locator('#ops-reply-form').isVisible(),false);
  await page.locator('#ops-support-filter').selectOption('closed');
  await page.locator('#ops-ticket-list button').waitFor();
  assert.equal(await page.locator('#ops-support-next').isDisabled(),true);
  revoked=true;
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.locator('#ops-main').waitFor({state:'hidden'});
  assert.equal(await page.locator('#ops-messages').textContent(),'');
  assert.deepEqual(errors,[]);
  console.log(`PASS ${width}px: inbox, reply, resolve, resolved queue, disabled payments, role revocation`);
  await page.close();
 }
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
