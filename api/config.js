'use strict';
const {authConfig}=require('../lib/candriva-core');
module.exports=(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const auth=authConfig();
 // Use only canonical key names. Old typo'd aliases are not accepted by the app.
 const turnstileSite=String(process.env.SC_TURNSTILE_SITE_KEY||'');
 const turnstileSecret=String(process.env.SC_TURNSTILE_SECRET_KEY||'');
 const emailTrialReady=process.env.SC_EMAIL_DEVICE_TRIAL_ENABLED==='true'&&
  turnstileSecret.length>=20&&
  turnstileSite.length>5&&
  String(process.env.SC_TRIAL_HMAC_SECRET||'').length>=32&&
  Number.isFinite(Date.parse(String(process.env.SC_TRIAL_ROLLOUT_AT||'')))&&
  !!(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY);
 return res.status(200).json({brand:'SignalChart',authProvider:'supabase',supabaseUrl:auth.ready?auth.url:null,supabaseAnonKey:auth.ready?auth.key:null,authReady:auth.ready,trialHours:72,trialSignalLimit:3,requiresVerifiedPhone:false,requiresVerifiedEmail:true,trialVerificationMethod:'verified_email_browser',emailDeviceTrialEnabled:emailTrialReady,turnstileSiteKey:emailTrialReady?turnstileSite:null,phoneVerificationChannel:'disabled',phoneVerificationEnabled:false,renewalDays:30,monthlyUSD:20,priceCurrency:'USD',walletNetwork:'BTC mainnet',paymentMethod:'Manual BTC transfer after administrator verification',signalsEnabled:process.env.CANDRIVA_SIGNALS_ENABLED==='true',paymentsEnabled:process.env.CANDRIVA_PAYMENTS_ENABLED==='true',hourlySignals:'on-demand'});
};