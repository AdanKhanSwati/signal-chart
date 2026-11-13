'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const workerModule=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
const USER='e29aafda-2cc8-4e11-a587-c983dd3f9113';
const OTHER='17aac18d-cb89-49a5-9aba-92a119c9554e';
const TICKET='fe13386e-c87a-4f15-92dd-4c1ebff476e1';
const TOKEN='jwt.payload.synthetic-support-verified-12345678901234567890';
const env={
 SUPABASE_URL:'https://example-test.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:'sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
 SUPABASE_SECRET_KEY:'sb_secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'
};
const auth={id:USER,email:'support-qa@example.test',email_confirmed_at:'2026-11-11T01:00:00Z',
 created_at:'2026-11-11T00:00:00Z',user_metadata:{role:'superadmin',isAdmin:true}};
const ticket={id:TICKET,user_id:USER,subject:'Need assistance',category:'technical',
 status:'open',updated_at:'2026-11-11T02:00:00Z'};
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
function server({calls=[],authUser=auth,tickets=[ticket],messages=[{
 ticket_id:TICKET,sender_type:'customer',message:'Help with my account',created_at:'2026-11-11T02:00:00Z'
}],rpcResult=null}={}){
 return async (raw,opts={})=>{
  const url=new URL(raw),route=url.pathname;
  calls.push({route,method:opts.method,body:opts.body,query:url.search,headers:opts.headers});
  if(route==='/auth/v1/user'){
   if(opts.headers.Authorization!=='Bearer '+TOKEN)return new Response('No',{status:401});
   return json(authUser);
  }
  if(route==='/rest/v1/sc_member_profiles')return json([{
   user_id:USER,email:authUser.email,display_name:'Support QA',legacy_status:'unreconciled'
  }]);
  if(route==='/rest/v1/rpc/sc_trial_state')return json({
   trialStatus:'not_activated',signalsUsed:0,signalsRemaining:0,
   activatedAt:null,expiresAt:null
  });
  if(route==='/rest/v1/sc_paid_access')return json([]);
  if(route==='/rest/v1/sc_support_tickets'){
   if(url.searchParams.has('id')){
    const id=url.searchParams.get('id').slice('eq.'.length);
    return json(tickets.filter(x=>x.id===id));
   }
   return json(tickets);
  }
  if(route==='/rest/v1/sc_support_messages')return json(messages);
  if(route==='/rest/v1/rpc/sc_support_create')return json(rpcResult||{ticketId:TICKET,status:'open'});
  if(route==='/rest/v1/rpc/sc_support_reply')return json(rpcResult||{ticketId:TICKET,status:'sent'});
  if(route==='/rest/v1/rpc/sc_support_close')return json(rpcResult||{ticketId:TICKET,status:'closed'});
  throw Error('Unexpected upstream path '+route);
 };
}
const req=(action,{method='GET',body=null,token=TOKEN,params={}}={})=>{
 const qs=new URLSearchParams({action,...params});
 const headers=token?{Authorization:'Bearer '+token}:{};
 if(method==='POST')headers['Content-Type']='application/json';
 return new Request('https://staging.example.test/api/cv-ops?'+qs.toString(),{
  method,headers,body:method==='POST'?JSON.stringify(body||{}):undefined
 });
};
async function w(fetchFn){return (await workerModule).createWorker({fetchFn})}
test('Customer inbox includes only owned ticket metadata and no payment history claims',async()=>{
 const calls=[],worker=await w(server({calls}));
 const res=await worker.fetch(req('me'),env);
 assert.equal(res.status,200);
 const payload=await res.json();
 assert.equal(payload.tickets.length,1);
 assert.deepEqual(payload.tickets[0],{
  ticketId:TICKET,uid:USER,subject:ticket.subject,category:'technical',
  status:'open',lastAt:ticket.updated_at
 });
 assert.deepEqual(payload.payments,[]);
 assert.equal(payload.checkout.enabled,false);
 assert.ok(calls.some(x=>x.route==='/rest/v1/sc_support_tickets'&&
  x.query.includes('user_id=eq.'+USER)));
});
test('Cross-user ticket row in owner-scoped response fails closed',async()=>{
 const worker=await w(server({tickets:[{...ticket,user_id:OTHER}]}));
 const res=await worker.fetch(req('me'),env);
 assert.equal(res.status,503);
});
test('Verified user may read messages only for their own ticket',async()=>{
 const calls=[],worker=await w(server({calls}));
 const res=await worker.fetch(req('messages',{params:{ticketId:TICKET}}),env);
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.ticket.ticketId,TICKET);
 assert.deepEqual(data.messages,[{from:'customer',text:'Help with my account',at:'2026-11-11T02:00:00Z'}]);
 assert.equal(calls.some(x=>x.route==='/rest/v1/sc_support_messages'),true);
});
test('Forged superadmin user_metadata cannot read another account ticket',async()=>{
 const calls=[],worker=await w(server({calls,tickets:[{...ticket,user_id:OTHER}]}));
 const res=await worker.fetch(req('messages',{params:{ticketId:TICKET}}),env);
 assert.equal(res.status,404);
 assert.equal(calls.some(x=>x.route==='/rest/v1/sc_support_messages'),false);
});
test('Private message rows from a different ticket are rejected before display',async()=>{
 const worker=await w(server({messages:[{
  ticket_id:OTHER,sender_type:'admin',message:'Confidential',created_at:'2026-11-11T01:00:00Z'
 }]}));
 const res=await worker.fetch(req('messages',{params:{ticketId:TICKET}}),env);
 assert.equal(res.status,503);
});
test('New support ticket uses server-verified Supabase UUID and strict input allowlist',async()=>{
 const calls=[],worker=await w(server({calls}));
 const res=await worker.fetch(req('new_ticket',{method:'POST',body:{
  uid:OTHER,admin:true,subject:'Unable to use charts',
  category:'technical',message:'Candles are not showing on the dashboard.'
 }}),env);
 assert.equal(res.status,201);
 assert.deepEqual(await res.json(),{ticketId:TICKET,status:'open'});
 const rpc=calls.find(x=>x.route==='/rest/v1/rpc/sc_support_create');
 assert.deepEqual(JSON.parse(rpc.body),{p_actor:USER,
  p_subject:'Unable to use charts',p_category:'technical',
  p_message:'Candles are not showing on the dashboard.'});
});
test('Malformed or oversized support messages never reach SQL write functions',async()=>{
 const calls=[],worker=await w(server({calls}));
 for(const body of [
  {subject:'x',category:'general',message:'Hello'},
  {subject:'Valid subject',category:'unknown',message:'Hello'},
  {subject:'Valid subject',category:'general',message:'  '},
  {subject:'Valid subject',category:'general',message:'X'.repeat(2100)}
 ]){
  const res=await worker.fetch(req('new_ticket',{method:'POST',body}),env);
  assert.equal(res.status,400);
 }
 assert.equal(calls.some(x=>x.route==='/rest/v1/rpc/sc_support_create'),false);
});
test('Reply to owned ticket uses server-scoped actor and defaults to customer role',async()=>{
 const calls=[],worker=await w(server({calls}));
 const res=await worker.fetch(req('reply',{method:'POST',body:{ticketId:TICKET,
  message:'Please investigate this when convenient.',p_admin:true,uid:OTHER}}),env);
 assert.equal(res.status,200);
 const data=await res.json();assert.equal(data.status,'sent');
 const rpc=JSON.parse(calls.find(x=>x.route==='/rest/v1/rpc/sc_support_reply').body);
 assert.deepEqual(rpc,{p_actor:USER,p_ticket:TICKET,p_admin:false,
  p_message:'Please investigate this when convenient.'});
});
test('Unauthorized user cannot reply to another customer, even with admin metadata',async()=>{
 const calls=[],worker=await w(server({calls,tickets:[{...ticket,user_id:OTHER}]}));
 const res=await worker.fetch(req('reply',{method:'POST',body:{
  ticketId:TICKET,message:'Trying to hijack this support conversation'}}),env);
 assert.equal(res.status,404);
 assert.equal(calls.some(x=>x.route==='/rest/v1/rpc/sc_support_reply'),false);
});
test('Support replies honor closed and rate-limited SQL results',async()=>{
 for(const [status,http] of [['closed',409],['rate_limited',429],['forbidden',403]]){
  const worker=await w(server({rpcResult:{status}}));
  const res=await worker.fetch(req('reply',{method:'POST',body:{ticketId:TICKET,message:'Hello'}}),env);
  assert.equal(res.status,http,status);
 }
});
test('Customer can close their own conversation, but cannot close another customer ticket',async()=>{
 const calls=[],worker=await w(server({calls}));
 const res=await worker.fetch(req('close_ticket',{method:'POST',body:{ticketId:TICKET}}),env);
 assert.equal(res.status,200);
 assert.equal((await res.json()).status,'closed');
 const rpc=JSON.parse(calls.find(x=>x.route==='/rest/v1/rpc/sc_support_close').body);
 assert.deepEqual(rpc,{p_actor:USER,p_ticket:TICKET,p_admin:false});
 const another=await w(server({tickets:[{...ticket,user_id:OTHER}]}));
 assert.equal((await another.fetch(req('close_ticket',{method:'POST',body:{ticketId:TICKET}}),env)).status,404);
});
test('Only a server-configured superadmin UUID allows support agent access',async()=>{
 const calls=[],worker=await w(server({calls,tickets:[{...ticket,user_id:OTHER}]}));
 const opts={...env,SC_SUPER_ADMIN_UID:USER};
 const res=await worker.fetch(req('reply',{method:'POST',body:{
  ticketId:TICKET,message:'Investigating now'}}),opts);
 assert.equal(res.status,200);
 const rpc=JSON.parse(calls.find(x=>x.route==='/rest/v1/rpc/sc_support_reply').body);
 assert.equal(rpc.p_admin,true);
});
test('Unauthenticated support operations fail before DB reads/writes',async()=>{
 const calls=[],worker=await w(server({calls}));
 for(const action of ['new_ticket','messages']){
  const res=await worker.fetch(req(action,{method:action==='messages'?'GET':'POST',
   body:{subject:'Valid subject',category:'general',message:'Hello'},
   params:{ticketId:TICKET},token:null}),env);
  assert.equal(res.status,401);
 }
 assert.equal(calls.length,0);
});

test('Admin inbox denies anonymous and forged roles before private ticket reads',async()=>{
 const calls=[],worker=await w(server({calls}));
 assert.equal((await worker.fetch(req('admin_support',{token:null}),env)).status,401);
 assert.equal((await worker.fetch(req('admin_support'),env)).status,403);
 assert.equal((await worker.fetch(req('admin_support'),{...env,SC_SUPER_ADMIN_UID:OTHER})).status,403);
 assert.equal(calls.some(x=>x.route==='/rest/v1/sc_support_tickets'),false);
});
test('Admin inbox is bounded, deterministically ordered and excludes unneeded private fields',async()=>{
 const calls=[],tickets=Array.from({length:51},(_,n)=>({...ticket,
  id:`fe13386e-c87a-4f15-92dd-${String(n).padStart(12,'0')}`,
  user_id:OTHER,email:'private@example.test',receipt:'private-evidence'}));
 const worker=await w(server({calls,tickets}));
 const res=await worker.fetch(req('admin_support'),{...env,SC_SUPER_ADMIN_UID:USER});
 assert.equal(res.status,200);assert.match(res.headers.get('Cache-Control'),/no-store/);
 const data=await res.json();assert.equal(data.tickets.length,50);
 assert.deepEqual(data.page,{status:'open',offset:0,nextOffset:50});
 assert.equal(data.capabilities.billing,false);assert.equal(data.capabilities.push,false);
 assert.doesNotMatch(JSON.stringify(data),/private@example|private-evidence|sb_secret/);
 const query=new URLSearchParams(calls.find(x=>x.route==='/rest/v1/sc_support_tickets').query);
 assert.equal(query.get('limit'),'51');assert.equal(query.get('offset'),'0');
 assert.equal(query.get('status'),'eq.open');assert.equal(query.get('order'),'updated_at.desc,id.desc');
 assert.equal(calls.length,2,'Only auth and ticket reads; no membership or payment coupling');
});
test('Resolved queue and page boundary use validated parameters',async()=>{
 const calls=[],worker=await w(server({calls,tickets:[{...ticket,status:'closed'}]}));
 const res=await worker.fetch(req('admin_support',{params:{status:'closed',offset:'50'}}),{...env,SC_SUPER_ADMIN_UID:USER});
 assert.equal(res.status,200);
 assert.deepEqual((await res.json()).page,{status:'closed',offset:50,nextOffset:null});
 assert.ok(calls.find(x=>x.route==='/rest/v1/sc_support_tickets').query.includes('status=eq.closed'));
});
test('Admin inbox rejects malformed filters, offsets and methods without a database query',async()=>{
 const calls=[],worker=await w(server({calls})),adminEnv={...env,SC_SUPER_ADMIN_UID:USER};
 for(const params of [{status:'all'},{status:'open&select=*'},{offset:'-1'},{offset:'1.5'},{offset:'10001'}]){
  assert.equal((await worker.fetch(req('admin_support',{params}),adminEnv)).status,400);
 }
 assert.equal((await worker.fetch(req('admin_support',{method:'POST'}),adminEnv)).status,405);
 assert.equal(calls.some(x=>x.route==='/rest/v1/sc_support_tickets'),false);
});
test('Unexpected admin inbox rows fail closed and empty queue is represented honestly',async()=>{
 const adminEnv={...env,SC_SUPER_ADMIN_UID:USER};
 for(const bad of [{...ticket,user_id:'invalid'},{...ticket,status:'closed'}, {...ticket,updated_at:'invalid'}]){
  const worker=await w(server({tickets:[bad]}));
  assert.equal((await worker.fetch(req('admin_support'),adminEnv)).status,503);
 }
 const worker=await w(server({tickets:[]}));
 const res=await worker.fetch(req('admin_support'),adminEnv);
 assert.deepEqual((await res.json()).tickets,[]);
});
test('Configured admin can read and close another customer conversation; payment writes stay disabled',async()=>{
 const calls=[],worker=await w(server({calls,tickets:[{...ticket,user_id:OTHER}]}));
 const adminEnv={...env,SC_SUPER_ADMIN_UID:USER};
 assert.equal((await worker.fetch(req('messages',{params:{ticketId:TICKET}}),adminEnv)).status,200);
 assert.equal((await worker.fetch(req('close_ticket',{method:'POST',body:{ticketId:TICKET}}),adminEnv)).status,200);
 const rpc=JSON.parse(calls.find(x=>x.route==='/rest/v1/rpc/sc_support_close').body);
 assert.deepEqual(rpc,{p_actor:USER,p_ticket:TICKET,p_admin:true});
 assert.equal((await worker.fetch(req('review_payment',{method:'POST',body:{decision:'approved'}}),adminEnv)).status,503);
});
