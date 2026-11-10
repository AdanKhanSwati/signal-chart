'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const account=read('account.html'),signals=read('signals.html'),
 ui=read('sc-trial-ui.js'),css=read('sc-trial-ui.css'),
 config=read('api/config.js'),gate=read('lib/trial-gate.js'),
 endpoint=read('api/trial.js');
test('verified email browser trial guide appears on Account before sign-in',()=>{
 const intro=account.indexOf('id="sc-browser-guide"'),
  auth=account.indexOf('id="auth-area"'),member=account.indexOf('id="member-area" hidden');
 assert.ok(intro>0&&intro<auth&&auth<member);
 assert.ok(account.includes('id="sc-browser-availability"'));
 assert.ok(account.includes('id="sc-browser-guide-link"'));
 assert.ok(account.includes('No WhatsApp, phone number or personal contact is required.'));
});
test('signed-in account offers browser trial and Turnstile, not a phone-number form',()=>{
 for(const id of ['sc-browser-activation','sc-activate-browser','sc-turnstile','sc-browser-delivery-note'])
  assert.ok(account.includes('id="'+id+'"'),'Missing trial control '+id);
 assert.ok(!account.includes('id="sc-phone"'));
 assert.ok(!account.includes('id="sc-send-otp"'));
 assert.ok(!account.includes('id="sc-otp-form"'));
 assert.ok(account.includes('Shared Wi-Fi does not automatically disqualify you.'));
});
test('Trading Signals page leads to Account browser trial activation',()=>{
 assert.ok(signals.includes('id="sc-trial-browser-cta"'));
 assert.ok(signals.includes('href="/account.html#sc-browser-activation"'));
 assert.ok(signals.includes('id="sc-signal-browser-status"'));
});
test('client trial start requires enabled backend and Turnstile challenge',()=>{
 assert.ok(ui.includes("browserTrialEnabled=c.emailDeviceTrialEnabled===true"));
 assert.ok(ui.includes("turnstileSiteKey=typeof c.turnstileSiteKey==='string'"));
 assert.ok(ui.includes("api('device',undefined,'GET')"));
 assert.ok(ui.includes("api('activate_browser',{turnstileToken:challenge})"));
 assert.ok(ui.includes("window.turnstile.getResponse(turnstileWidget)"));
 assert.ok(ui.includes("if(!challenge)throw Error('Complete the anti-bot verification first')"));
 assert.ok(ui.includes("btn.disabled=!ready"));
 assert.ok(config.includes("requiresVerifiedEmail:true"));
 assert.ok(config.includes("trialVerificationMethod:'verified_email_browser'"));
 assert.ok(config.includes("phoneVerificationEnabled:false"));
 assert.ok(gate.includes("if(env.SC_EMAIL_DEVICE_TRIAL_ENABLED!=='true')"));
 assert.ok(endpoint.includes("action==='activate_browser'"));
});
test('same-page login and logout refresh the trial area without a reload',()=>{
 const accountJs=read('candriva-v2.js');
 assert.ok(accountJs.includes("window.dispatchEvent(new Event('signalchart:auth-changed'))"));
 assert.ok(ui.includes("window.addEventListener('signalchart:auth-changed'"));
 assert.ok(ui.includes("if(t){await refresh()}"));
 assert.ok(ui.includes("const activation=$('#sc-browser-activation');if(activation)activation.hidden=true;"));
});
test('responsive styling and hidden trial area remain intact',()=>{
 assert.ok(css.includes('.sc-trial-box[hidden],.sc-trial-box *[hidden]'));
 assert.ok(css.includes('@media(max-width:650px)'));
 assert.ok(account.includes('id="sc-browser-activation" hidden'));
 assert.ok(account.includes('id="sc-activate-browser"')&&account.includes('disabled>Activate my free trial'));
});
