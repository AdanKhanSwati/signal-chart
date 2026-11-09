'use strict';
/** SignalChart manual BTC billing. No gateway, no auto-activation.
 * All writes are immutable and must go through server-authenticated routes. */
const {randomUUID}=require('node:crypto');
const {submitPayment,reviewPayment,normalizeTxid,MAX_RECEIPT_BYTES}=require('./manual-payments');
const WALLET='bc1p3hkr3959rtl8rd4rds5p4par7q4lhz2x4q0rwpsfvc2njht3s77qt7v8tt';
const err=(status,message)=>Object.assign(new Error(message),{status});
const validId=x=>typeof x==='string'&&(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)||/^[0-9a-f]{32}$/i.test(x));
const toUTC=x=>new Date(x).toISOString();
function decodeReceipt(value){
 if(typeof value!=='string')throw err(400,'Receipt screenshot required');
 const match=/^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if(!match)throw err(400,'Only PNG and JPEG screenshots are accepted');
 const bytes=Buffer.from(match[2],'base64');
 if(!bytes.length||bytes.length>MAX_RECEIPT_BYTES)throw err(413,'Receipt must not exceed 1.4 MB');
 const magic=match[1]==='image/png'
  ?bytes.length>8&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))
  :bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(!magic)throw err(400,'Screenshot data does not match its file type');
 return {bytes,mime:match[1],ext:match[1]==='image/png'?'png':'jpg'};
}
function createService(core,{fetchFn=globalThis.fetch,now=()=>Date.now()}={}){
 const {read,write,records}=core;
 async function billing(){
  const baseline=await read('cv4/billing/settings.json');
  const events=await records('cv5/billing/settings/',1000);
  const newest=events.filter(e=>e&&e.type==='billing_settings'&&Number.isFinite(Date.parse(e.at)))
    .sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
  const cfg={...baseline,...newest};
  const btcMonthly=Number(cfg.btcMonthly);
  // Displayed wallet and browser QR are fixed to the original published BTC address.
  // Do not allow an environment mismatch to direct customer funds elsewhere.
  const wallet=WALLET;
  const walletConsistent=!process.env.CANDRIVA_BTC_WALLET||process.env.CANDRIVA_BTC_WALLET===WALLET;
  return {btcMonthly:Number.isFinite(btcMonthly)&&btcMonthly>0&&btcMonthly<10?btcMonthly:null,
   priceUSD:20,network:'BTC mainnet',wallet,renewalDays:30,
   enabled:walletConsistent&&process.env.CANDRIVA_PAYMENTS_ENABLED==='true'&&cfg.enabled===true&&
     Number.isFinite(btcMonthly)&&btcMonthly>0&&btcMonthly<10&&/^bc1[a-z0-9]{30,90}$/.test(wallet),
   requestedEnabled:cfg.enabled===true};
 }
 async function saveBilling(admin,{btcMonthly,enabled}){
  const amount=Number(btcMonthly);
  if(!Number.isFinite(amount)||amount<=0||amount>=10||!Number.isInteger(Math.round(amount*1e8)))
   throw err(400,'Enter a valid BTC amount');
  const event={type:'billing_settings',id:randomUUID(),at:toUTC(now()),issuedBy:admin.uid,
    btcMonthly:Math.round(amount*1e8)/1e8,enabled:enabled===true};
  await write('cv5/billing/settings/'+event.id+'.json',event);
  return billing();
 }
 async function allPayments(){
  const [current,previous]=await Promise.all([records('cv5/payments/',3000),records('cv4/payments/',3000)]);
  const map=new Map();
  for(const p of [...previous,...current])if(p&&validId(p.id))map.set(p.id,p);
  return [...map.values()].sort((a,b)=>String(b.submittedAt||b.at||'').localeCompare(String(a.submittedAt||a.at||'')));
 }
 async function reviewOf(payment){
  if(!payment||!validId(payment.id))return null;
  return await read('cv5/reviews/'+payment.id+'.json')||await read('cv4/reviews/'+payment.id+'.json');
 }
 async function displayPayment(p){
  const r=await reviewOf(p);
  const decision=r?.decision||p.decision?.decision||p.decision||'pending';
  return {id:p.id,uid:p.uid||p.memberId,email:p.email||null,submittedAt:p.submittedAt||p.at,
   txid:p.txid,priceBTC:p.priceBTC,network:p.network||'BTC mainnet',
   recipientWallet:p.recipientWallet||p.wallet||WALLET,
   decision:decision==='approved'||decision==='rejected'?decision:'pending',
   note:p.note||'',reviewNote:r?.reviewNote||r?.note||''};
 }
 async function paymentsFor(uid){
  const list=await allPayments();
  return Promise.all(list.filter(p=>(p.uid||p.memberId)===uid).map(displayPayment));
 }
 async function submit(person,{txid,receipt,note='' }){
  const config=await billing();
  if(!config.enabled)throw err(503,'Payment submissions are currently paused. Do not transfer funds.');
  const proof=decodeReceipt(receipt),transactionId=normalizeTxid(txid);
  const historical=await allPayments();
  if(historical.some(p=>String(p.txid||'').toLowerCase()===transactionId))
   throw err(409,'This transaction ID has already been submitted');
  const item=submitPayment({memberId:person.uid,transactionId,receiptMime:proof.mime,
    receiptSize:proof.bytes.length,quotedAmountBTC:config.btcMonthly,
    recipientWallet:config.wallet,note},{now:now()});
  // Immutable TXID reservation prevents concurrent reuse. Failure is fail-closed.
  try{await write('cv5/txid-reservations/'+item.txid+'.json',
    {txid:item.txid,paymentId:item.id,memberId:person.uid,reservedAt:item.submittedAt})}
  catch(e){if(core.isConflict?.(e))throw err(409,'This transaction ID has already been submitted');throw e}
  const receiptPath='cv5/receipts/'+person.uid+'/'+item.id+'.'+proof.ext;
  await write(receiptPath,proof.bytes,proof.mime);
  await write('cv5/payments/'+item.id+'.json',
    {...item,uid:person.uid,email:person.email,receiptPath});
  return {id:item.id,decision:'pending'};
 }
 async function paymentById(id){
  if(!validId(id))throw err(400,'Invalid payment ID');
  const all=await allPayments(),p=all.find(x=>x.id===id);
  if(!p)throw err(404,'Payment not found');
  return p;
 }
 async function receipt(id){
  const p=await paymentById(id);
  if(typeof p.receiptPath!=='string'||!p.receiptPath.startsWith('cv5/receipts/'))
   throw err(404,'Private receipt unavailable');
  const bytes=await core.readBinary(p.receiptPath);
  if(!bytes)throw err(404,'Private receipt unavailable');
  return {bytes,mime:p.receiptMime==='image/jpeg'?'image/jpeg':'image/png'};
 }
 async function verifyChain(p){
  const txid=normalizeTxid(p.txid);
  const timeout=ms=>AbortSignal.timeout(ms);
  let tx,tip;
  try{
   const response=await fetchFn('https://mempool.space/api/tx/'+txid,
     {signal:timeout(10000),headers:{Accept:'application/json'}});
   if(!response.ok)throw Error('Transaction unavailable');
   tx=await response.json();
   if(tx?.status?.confirmed&&Number.isInteger(Number(tx.status.block_height))){
    const r=await fetchFn('https://mempool.space/api/blocks/tip/height',{signal:timeout(10000)});
    if(!r.ok)throw Error('Chain height unavailable');
    tip=Number(await r.text());
   }
  }catch{return {verified:false,received:{receivedBTC:0,confirmations:0},reason:'Blockchain lookup unavailable; do not approve'};}
  const sats=Array.isArray(tx.vout)?tx.vout.filter(v=>v.scriptpubkey_address===(p.recipientWallet||WALLET))
    .reduce((acc,v)=>acc+(Number.isSafeInteger(Number(v.value))?Number(v.value):0),0):0;
  const confirmations=tx.status?.confirmed&&Number.isSafeInteger(tip)
    ?Math.max(0,tip-Number(tx.status.block_height)+1):0;
  const required=Math.round(Number(p.priceBTC)*1e8);
  const verified=confirmations>=1&&Number.isSafeInteger(required)&&required>0&&sats>=required;
  const reason=verified?'Confirmed transfer to receiving wallet meets invoice amount':
    confirmations<1?'Transaction is not confirmed':'Receiving wallet or transferred amount does not match invoice';
  return {verified,received:{receivedBTC:sats/1e8,confirmations},reason};
 }
 async function review(admin,{paymentId,decision,note='',confirmedOnChain=false}){
  const p=await paymentById(paymentId);
  if(await reviewOf(p))throw err(409,'Payment has already been reviewed');
  let passed=false;
  if(decision==='approved'){
   if(confirmedOnChain!==true)throw err(400,'Administrator confirmation is required');
   const check=await verifyChain(p);
   if(!check.verified)throw err(409,'Payment not verified: '+check.reason);
   passed=true;
  }
  let record;
  try{
   record=reviewPayment({...p,status:'pending',decision:null},{
     decision,adminUserId:admin.uid,verifiedOnChain:passed,note,now:now()});
  }catch(e){throw err(400,e.message)}
  const event={paymentId:p.id,uid:p.uid||p.memberId,decision:record.decision,
    at:record.at,reviewedAt:record.reviewedAt,reviewedBy:admin.uid,
    reviewNote:record.reviewNote,verifiedOnChain:passed};
  try{await write('cv5/reviews/'+p.id+'.json',event)}
  catch(e){if(core.isConflict?.(e))throw err(409,'Payment has already been reviewed');throw e}
  return event;
 }
 async function quote(){
  // Reference-rate only. Payments never become active from this quote.
  let price;
  try{
   const r=await fetchFn('https://api.coinbase.com/v2/prices/BTC-USD/spot',
     {signal:AbortSignal.timeout(9000),headers:{Accept:'application/json'}});
   if(!r.ok)throw Error('Quote unavailable');
   const v=await r.json();price=Number(v?.data?.amount);
  }catch{throw err(503,'BTC/USD quote temporarily unavailable')}
  if(!Number.isFinite(price)||price<=0)throw err(503,'BTC/USD quote temporarily unavailable');
  return {btcMonthly:Math.ceil(20/price*1e8)/1e8,usdMonthly:20,provider:'Coinbase spot reference',
    quotedAt:toUTC(now()),note:'Reference only. Pay only when the administrator enables a payable invoice.'};
 }
 return {billing,saveBilling,allPayments,reviewOf,displayPayment,paymentsFor,
   submit,paymentById,receipt,verifyChain,review,quote};
}
module.exports={createService,WALLET,decodeReceipt};
