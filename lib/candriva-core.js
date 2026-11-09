'use strict';
/**
 * Reconstructed SignalChart membership/storage adapter.
 * This replaces an unrecovered Vercel-only source module on the STAGING branch.
 * It must not be deployed until API compatibility and real storage are verified.
 */
const {createHash,randomBytes,randomUUID}=require('node:crypto');
const {get,put,list}=require('@vercel/blob');
const {entitlement,HOUR}=require('./subscription-rules');
const {approvedForMember}=require('./entitlement-store');
const sha=x=>createHash('sha256').update(String(x)).digest('hex');
const hex=()=>randomBytes(16).toString('hex');
const stamp=()=>new Date().toISOString();
const err=(status,message)=>Object.assign(new Error(message),{status});
const isMissing=e=>/BlobNotFoundError|does not exist|not found|404/i.test(String(e?.message||e));
const isConflict=e=>/BlobAlreadyExistsError|already exists|conflict|409/i.test(String(e?.message||e));
function authConfig(){
 const url=String(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||'').replace(/\/+$/,'');
 const key=String(process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||'');
 return {url,key,ready:/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)&&key.length>15};
}
function assertStorage(){if(!process.env.BLOB_READ_WRITE_TOKEN)throw err(503,'Private member storage unavailable');}
function safePath(path){
 if(typeof path!=='string'||!path||path.startsWith('/')||path.includes('..')||!/^[a-zA-Z0-9_./-]+$/.test(path))
  throw err(400,'Invalid storage path');
 return path;
}
async function read(path){
 assertStorage();safePath(path);
 try{const o=await get(path,{access:'private'});return o?.stream?JSON.parse(await new Response(o.stream).text()):null}
 catch(e){if(isMissing(e))return null;throw e}
}
async function readBinary(path){
 assertStorage();safePath(path);
 try{const o=await get(path,{access:'private'});return o?.stream?Buffer.from(await new Response(o.stream).arrayBuffer()):null}
 catch(e){if(isMissing(e))return null;throw e}
}
async function write(path,data,type='application/json'){
 assertStorage();safePath(path);
 const body=type==='application/json'?JSON.stringify(data):data;
 if(typeof body!=='string'&&!Buffer.isBuffer(body)&&!(body instanceof Uint8Array))throw err(400,'Invalid storage payload');
 return put(path,body,{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:type});
}
async function records(prefix,limit=1000){
 assertStorage();safePath(prefix);
 const all=[];let cursor;
 for(let pages=0;pages<30&&all.length<Math.min(limit,3000);pages++){
  const result=await list({prefix,limit:Math.min(1000,Math.max(1,limit-all.length)),cursor});
  for(const b of result.blobs||[]){
   if(all.length>=limit)break;
   if(!b.pathname?.endsWith('.json'))continue;
   const data=await read(b.pathname);
   if(data&&typeof data==='object')all.push(data);
  }
  if(!result.hasMore||!result.cursor)break;cursor=result.cursor;
 }
 return all;
}
function authHeader(req){
 const h=String(req.headers?.authorization||req.headers?.Authorization||'');
 const m=/^Bearer ([A-Za-z0-9._~+/-]+)$/i.exec(h);
 if(!m)throw err(401,'Sign in required');
 return m[1];
}
async function identity(req){
 const config=authConfig();
 if(!config.ready)throw err(503,'Authentication service unavailable');
 const token=authHeader(req);
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);
 let response;
 try{response=await fetch(config.url+'/auth/v1/user',{headers:{apikey:config.key,Authorization:'Bearer '+token},signal:controller.signal,cache:'no-store'})}
 finally{clearTimeout(timer)}
 if(!response.ok)throw err(401,'Invalid or expired session');
 const user=await response.json();
 if(!/^[0-9a-f-]{36}$/i.test(String(user.id||''))||!user.email||!user.email_confirmed_at)
  throw err(401,'Verified email session required');
 return {uid:user.id.toLowerCase(),email:String(user.email).trim().toLowerCase(),name:String(user.user_metadata?.full_name||'').slice(0,100)};
}
function isAdminEmail(email){
 const configured=String(process.env.CANDRIVA_ADMIN_EMAIL||'').trim().toLowerCase();
 return !!configured&&email===configured;
}
async function findMemberRecord(uid){
 const direct=await read('cv2/members/'+uid+'.json');
 if(direct?.uid===uid)return direct;
 const all=await records('cv2/members/',2000);
 return all.find(r=>r?.uid===uid&&r.trialStartedAt&&r.trialEndsAt)||null;
}
async function ensureMember(person){
 let record=await findMemberRecord(person.uid);
 if(record)return record;
 const at=Date.now();const created={uid:person.uid,email:person.email,name:person.name,trialStartedAt:new Date(at).toISOString(),trialEndsAt:new Date(at+24*HOUR).toISOString(),createdAt:new Date(at).toISOString()};
 try{await write('cv2/members/'+person.uid+'.json',created)}
 catch(e){if(!isConflict(e))throw e}
 record=await findMemberRecord(person.uid);
 if(!record)throw err(503,'Member record could not be verified');
 return record;
}
async function member(person){
 if(!person||!person.uid)throw err(401,'Verified member required');
 const uid=String(person.uid).toLowerCase();
 const record=await ensureMember({...person,uid});
 const [legacyPayments,oldPayments,currentPayments,legacyDecisions,oldReviews,currentReviews,grants]=await Promise.all([
  records('cv2/payments/',1500),records('cv4/payments/',1500),records('cv5/payments/',3000),
  records('cv2/members/'+uid+'/decisions/',1500),records('cv4/reviews/',1500),
  records('cv5/reviews/',3000),records('cv5/grants/'+uid+'/',1500)]);
 const decisions=approvedForMember(uid,[...legacyPayments,...oldPayments,...currentPayments],
   [...legacyDecisions,...oldReviews,...currentReviews]);
 const admin=isAdminEmail(person.email);
 const state=entitlement(record,decisions,Date.now(),admin,grants,uid);
 return {...state,uid,email:person.email,name:person.name,isAdmin:admin};
}
function adminOnly(state){if(!state?.isAdmin)throw err(403,'Administrator permission required')}
async function settings(){return await read('cv2/settings.json')||{priceUSD:20,network:'BTC mainnet',wallet:null,enabled:false}}
function paymentsEnabled(cfg){return process.env.CANDRIVA_PAYMENTS_ENABLED==='true'&&cfg?.enabled===true}
async function audit(type,details,actor){
 const entry={id:randomUUID(),type,at:stamp(),adminUid:actor?.uid||null,details};
 await write('cv5/audit/'+entry.id+'.json',entry);return entry;
}
function securePost(req,max=2850000){
 if(req.method!=='POST')throw err(405,'POST required');
 const size=Number(req.headers?.['content-length']||0);
 if(Number.isFinite(size)&&size>max)throw err(413,'Request too large');
 if(!String(req.headers?.['content-type']||'').toLowerCase().includes('application/json'))throw err(415,'JSON required');
 if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw err(400,'Invalid JSON body');
 return req.body;
}
function handleError(res,error){
 const code=[400,401,403,404,405,409,413,415,429,503].includes(error?.status)?error.status:500;
 res.setHeader('Cache-Control','no-store');
 return res.status(code).json({error:code===500?'Request failed. Please try again.':error.message});
}
module.exports={sha,hex,stamp,isMissing,isConflict,authConfig,read,readBinary,write,records,securePost,identity,member,adminOnly,settings,paymentsEnabled,audit,handleError};
