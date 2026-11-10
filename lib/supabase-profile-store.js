'use strict';
/**
 * SignalChart migration phase 1: server-only Supabase member profile storage.
 * This module does not grant trials, paid access, manual grants, or admin roles.
 * Identity MUST be established using the verified Supabase /auth/v1/user call
 * before ensureProfile is invoked. Never import this module into browser code.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SELECT='user_id,email,display_name,legacy_status,created_at,updated_at';
const issue=(status,message)=>Object.assign(new Error(message),{status});

function createProfileStore({fetchFn=globalThis.fetch,env=process.env}={}){
 function config(){
  const url=String(env.SUPABASE_URL||'').replace(/\/+$/,'');
  const secret=String(env.SUPABASE_SECRET_KEY||'');
  const legacy=String(env.SUPABASE_SERVICE_ROLE_KEY||'');
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url))
   throw issue(503,'Member profile database is not configured');
  if(/^sb_secret_[\w-]{20,}$/.test(secret))return {url,key:secret,legacy:false};
  if(/^eyJ[\w.-]{80,}$/.test(legacy))return {url,key:legacy,legacy:true};
  throw issue(503,'Server-only member profile credential is unavailable');
 }
 function validPerson(person){
  const uid=String(person?.uid||'').toLowerCase();
  const email=String(person?.email||'').trim().toLowerCase();
  const name=String(person?.name||'').trim().slice(0,100);
  if(!UUID.test(uid)||!EMAIL.test(email)||email.length>254)
   throw issue(401,'Verified Supabase member identity required');
  return {uid,email,name};
 }
 async function request(method,query,body){
  const c=config();
  const headers={apikey:c.key,Accept:'application/json'};
  if(c.legacy)headers.Authorization='Bearer '+c.key;
  if(method==='POST'){
   headers['Content-Type']='application/json';
   headers.Prefer='resolution=ignore-duplicates,return=minimal';
  }
  let response;
  try{
   response=await fetchFn(c.url+'/rest/v1/sc_member_profiles'+query,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body),
    cache:'no-store',signal:AbortSignal.timeout(10000)
   });
  }catch{
   throw issue(503,'Member profile service is unreachable');
  }
  if(!response.ok){
   // Do not leak SQL, credentials, RLS policies, or potentially sensitive API errors.
   throw issue(503,'Member profile service unavailable');
  }
  if(method==='POST')return null;
  let data;
  try{data=await response.json()}catch{throw issue(503,'Invalid member profile response')}
  if(!Array.isArray(data))throw issue(503,'Invalid member profile response');
  return data;
 }
 async function getProfile(uid){
  const normalized=String(uid||'').toLowerCase();
  if(!UUID.test(normalized))throw issue(401,'Invalid member identity');
  const query='?user_id=eq.'+encodeURIComponent(normalized)+
    '&select='+encodeURIComponent(SELECT)+'&limit=1';
  const rows=await request('GET',query);
  const record=rows[0]||null;
  if(record&&record.user_id!==normalized)
   throw issue(503,'Member profile identity mismatch');
  return record;
 }
 async function ensureProfile(person){
  const {uid,email,name}=validPerson(person);
  // Read first: avoid writes for every login and avoid overwriting existing
  // account history. Historical status must be reconciled separately.
  const existing=await getProfile(uid);
  if(existing)return existing;
  const body={user_id:uid,email,display_name:name};
  await request('POST','?on_conflict=user_id',body);
  // Concurrency-safe insert-ignore; another tab may have inserted first.
  const created=await getProfile(uid);
  if(!created)throw issue(503,'Member profile write could not be verified');
  return created;
 }
 return {getProfile,ensureProfile};
}
module.exports={createProfileStore};
