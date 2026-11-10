'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const account=read('account.html'),signals=read('signals.html'),
 ui=read('sc-trial-ui.js'),css=read('sc-trial-ui.css'),
 config=read('api/config.js'),gate=read('lib/trial-gate.js');

test('WhatsApp onboarding is visible on Account before a member session',()=>{
 const intro=account.indexOf('id="sc-whatsapp-guide"');
 const login=account.indexOf('id="auth-area"');
 const hiddenMember=account.indexOf('id="member-area" hidden');
 assert.ok(intro>0&&intro<login&&login<hiddenMember,'Visible guide should not be inside a hidden section');
 assert.ok(account.includes('id="sc-whatsapp-availability"'));
 assert.ok(/id="sc-whatsapp-guide-link"[^>]*href="#auth-area"/.test(account));
});
test('Account retains phone input and code form for signed-in members',()=>{
 for(const id of ['sc-phone-verification','sc-phone-form','sc-send-otp','sc-otp-form','sc-confirm-otp','sc-existing-phone'])
  assert.ok(account.includes('id="'+id+'"'),'Missing phone control '+id);
 assert.ok(account.includes('pattern="\\+[1-9][0-9]{7,14}"'));
 assert.ok(account.includes('WhatsApp delivery requires provider')||account.includes('WhatsApp code delivery is not available'));
});
test('Trading Signals has discoverable link to Account verification',()=>{
 assert.ok(signals.includes('id="sc-trial-phone-cta"'));
 assert.ok(signals.includes('href="/account.html#sc-phone-verification"'));
 assert.ok(signals.includes('id="sc-signal-phone-delivery"'));
});
test('frontend never claims OTP can be sent while backend delivery is disabled',()=>{
 assert.ok(ui.includes("phoneDeliveryEnabled=c.phoneVerificationEnabled===true&&c.phoneVerificationChannel==='whatsapp'"));
 assert.ok(ui.includes('updateVerificationGuide(!!t)'));
 assert.ok(ui.includes("send.disabled=true;send.textContent='WhatsApp verification unavailable'"));
 assert.ok(ui.includes('No verification message is sent while unavailable.'));
 assert.ok(ui.includes('updateVerificationGuide(false)'));
 assert.ok(config.includes("phoneVerificationEnabled:process.env.SC_TRIAL_PHONE_DELIVERY_ENABLED==='true'"));
 assert.ok(gate.includes("if(env.SC_TRIAL_PHONE_DELIVERY_ENABLED!=='true')"));
 assert.ok(!gate.includes('Enter the OTP code from your SMS'));
});
test('WhatsApp setup guide is compact on smaller screens and preserves hidden form behavior',()=>{
 assert.ok(css.includes('.sc-whatsapp-guide,.sc-whatsapp-signal-cta'));
 assert.ok(css.includes('@media(max-width:650px)'));
 assert.ok(css.includes('.sc-trial-box[hidden],.sc-trial-box *[hidden]'));
 assert.ok(ui.includes("if(phone)phone.hidden=!!paidOverride||trial.trialStatus!=='not_activated';"));
});
