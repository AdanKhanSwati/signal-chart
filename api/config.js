'use strict';
const {authConfig}=require('../lib/candriva-core');
module.exports=(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const auth=authConfig();
 return res.status(200).json({brand:'SignalChart',authProvider:'supabase',supabaseUrl:auth.ready?auth.url:null,supabaseAnonKey:auth.ready?auth.key:null,authReady:auth.ready,trialHours:24,renewalDays:30,monthlyUSD:20,priceCurrency:'USD',walletNetwork:'BTC mainnet',paymentMethod:'Manual BTC transfer after administrator verification',signalsEnabled:process.env.CANDRIVA_SIGNALS_ENABLED==='true',paymentsEnabled:process.env.CANDRIVA_PAYMENTS_ENABLED==='true',hourlySignals:'on-demand'});
};