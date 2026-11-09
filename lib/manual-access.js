'use strict';
/* Immutable, server-authored manual membership grant events.
   Only a verified server administrator may create/revoke these events. */
const {randomUUID}=require('node:crypto');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function uid(value,name){
 if(typeof value!=='string'||!UUID.test(value))throw Error('Invalid '+name);
 return value.toLowerCase();
}
function instant(value,name){
 const n=typeof value==='number'?value:Date.parse(value);
 if(!Number.isFinite(n)||!Number.isFinite(new Date(n).getTime()))throw Error('Invalid '+name);
 return n;
}
function reasonText(value){
 if(typeof value!=='string'||!value.trim()||value.trim().length>500)throw Error('A reason of 1–500 characters is required');
 return value.trim();
}
function createGrantEvent({memberId,startsAt,expiresAt,reason},{adminUserId,now=Date.now()}){
 const at=instant(now,'now'),start=startsAt?instant(startsAt,'startsAt'):at,end=instant(expiresAt,'expiresAt');
 if(start<at-60000)throw Error('Grant cannot be backdated');
 if(end<=start||end<=at)throw Error('Grant expiry must be after its start and in the future');
 return Object.freeze({type:'grant',id:randomUUID(),memberId:uid(memberId,'memberId'),
 issuedBy:uid(adminUserId,'adminUserId'),issuedAt:new Date(at).toISOString(),
 startsAt:new Date(start).toISOString(),expiresAt:new Date(end).toISOString(),reason:reasonText(reason)});
}
function createRevokeEvent({memberId,grantId,reason},{adminUserId,now=Date.now()}){
 return Object.freeze({type:'revoke',id:randomUUID(),memberId:uid(memberId,'memberId'),
 grantId:uid(grantId,'grantId'),issuedBy:uid(adminUserId,'adminUserId'),
 issuedAt:new Date(instant(now,'now')).toISOString(),reason:reasonText(reason)});
}
function resolveManualGrants(events,at,memberUserId){
 // Fail closed unless the authenticated caller supplies the member's verified UID.
 if(typeof memberUserId!=='string'||!UUID.test(memberUserId)||!Number.isFinite(Number(at)))
  return {active:false,endsAt:null,activeGrantIds:[]};
 const id=memberUserId.toLowerCase(),seen=new Set(),grants=new Map(),revokeIds=[];
 for(const e of Array.isArray(events)?events:[]){
  if(!e||String(e.memberId||'').toLowerCase()!==id||typeof e.id!=='string'||seen.has(e.id))continue;
  const issued=Date.parse(e.issuedAt);
  if(!Number.isFinite(issued)||issued>at)continue;
  seen.add(e.id);
  if(e.type==='grant'){
   const start=Date.parse(e.startsAt),end=Date.parse(e.expiresAt);
   if(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&issued<=start)grants.set(e.id,{start,end});
  }else if(e.type==='revoke'&&typeof e.grantId==='string')revokeIds.push(e.grantId);
 }
 for(const target of revokeIds)grants.delete(target);
 let end=0;const ids=[];
 for(const [grantId,g] of grants)if(g.start<=at&&at<g.end){ids.push(grantId);end=Math.max(end,g.end)}
 return {active:ids.length>0,endsAt:end?new Date(end).toISOString():null,activeGrantIds:ids};
}
module.exports={createGrantEvent,createRevokeEvent,resolveManualGrants};
