'use strict';
/* Manual BTC payment submission and human review helpers.
   These do NOT collect crypto, interact with a gateway or verify on-chain activity. */
const {randomUUID}=require('node:crypto');
const MAX_RECEIPT_BYTES=1400000;
const TXID=/^[a-f0-9]{64}$/i;
function normalizeTxid(value){
 if(typeof value!=='string'||!TXID.test(value.trim()))throw Error('A 64-character Bitcoin transaction ID is required');
 return value.trim().toLowerCase();
}
function submitPayment({memberId,transactionId,receiptMime,receiptSize,quotedAmountBTC,recipientWallet,note=''},{now=Date.now()}={}){
 if(typeof memberId!=='string'||!memberId.trim())throw Error('Authenticated member ID required');
 if(!['image/png','image/jpeg'].includes(receiptMime))throw Error('Receipt must be PNG or JPEG');
 if(!Number.isInteger(receiptSize)||receiptSize<=0||receiptSize>MAX_RECEIPT_BYTES)throw Error('Receipt must not exceed 1.4 MB');
 if(!Number.isFinite(Number(quotedAmountBTC))||Number(quotedAmountBTC)<=0)throw Error('An active BTC invoice is required');
 if(typeof recipientWallet!=='string'||!recipientWallet.trim())throw Error('A receiving wallet is required');
 if(typeof note!=='string'||note.length>500)throw Error('Note must be 500 characters or fewer');
 const t=Number(now);if(!Number.isFinite(t))throw Error('Invalid submission time');
 return Object.freeze({id:randomUUID(),memberId:memberId.trim(),txid:normalizeTxid(transactionId),
 network:'BTC mainnet',receiptMime,receiptSize,priceBTC:Number(quotedAmountBTC),
 recipientWallet:recipientWallet.trim(),note:note.trim(),submittedAt:new Date(t).toISOString(),
 status:'pending',decision:null});
}
function reviewPayment(payment,{decision,verifiedOnChain=false,adminUserId,note='',now=Date.now()}){
 if(!payment||payment.status!=='pending'||payment.decision)throw Error('Only a pending payment may be reviewed');
 if(!['approved','rejected'].includes(decision))throw Error('Invalid payment decision');
 if(!adminUserId||typeof adminUserId!=='string')throw Error('Authenticated administrator required');
 if(decision==='approved'&&verifiedOnChain!==true)throw Error('Admin must independently verify wallet, amount and blockchain confirmation');
 if(typeof note!=='string'||note.length>500)throw Error('Review note too long');
 if(decision==='rejected'&&!note.trim())throw Error('Rejection reason is required');
 const t=Number(now);if(!Number.isFinite(t))throw Error('Invalid review time');
 return Object.freeze({...payment,status:decision,decision,paymentId:payment.id,
 reviewedAt:new Date(t).toISOString(),at:new Date(t).toISOString(),reviewedBy:adminUserId,
 reviewNote:note.trim(),verifiedOnChain:decision==='approved'});
}
module.exports={MAX_RECEIPT_BYTES,submitPayment,reviewPayment,normalizeTxid};
