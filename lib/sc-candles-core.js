'use strict';
/* Historical crypto futures and indicative FX candles for the expandable SignalChart market catalog. */
const FXPAIRS=["EURUSD","GBPUSD","USDJPY","USDCHF","USDCAD","AUDUSD","NZDUSD","EURGBP","EURJPY","EURCHF","EURAUD","EURCAD","EURNZD","GBPJPY","GBPCHF","GBPAUD","GBPCAD","GBPNZD","AUDJPY","AUDCAD","AUDNZD","AUDCHF","NZDJPY","NZDCAD","NZDCHF","CADJPY","CADCHF","CHFJPY","USDSGD","USDHKD","USDNOK","USDSEK","USDCNH","USDMXN","USDZAR","USDTRY","USDINR","USDPKR"],SPECIAL={"USDJPY":"JPY=X","USDCHF":"CHF=X","USDCAD":"CAD=X","USDSGD":"SGD=X","USDHKD":"HKD=X","USDNOK":"NOK=X","USDSEK":"SEK=X","USDCNH":"CNH=X","USDMXN":"MXN=X","USDZAR":"ZAR=X","USDTRY":"TRY=X","USDINR":"INR=X","USDPKR":"PKR=X"},FX=Object.fromEntries(FXPAIRS.map(s=>[s,SPECIAL[s]||s+'=X']));
const INTERVALS={ '1m':{i:'1m',range:'7d'},'3m':{i:'2m',range:'60d'},'5m':{i:'5m',range:'60d'},'15m':{i:'15m',range:'60d'},'30m':{i:'30m',range:'60d'},'1h':{i:'60m',range:'60d'},'4h':{i:'60m',range:'60d',bucket:14400},'1d':{i:'1d',range:'1y'},'1w':{i:'1wk',range:'5y'}};
async function get(url){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),11500);
 try{const r=await fetch(url,{signal:ctrl.signal,headers:{Accept:'application/json','User-Agent':'SignalChartResearch/1.1'},cache:'no-store'});if(!r.ok)throw Error('Provider HTTP '+r.status);return r.json()}finally{clearTimeout(timer)}
}
const finite=n=>Number.isFinite(Number(n))&&n!==null&&n!==undefined;
function aggregate(bars,bucket){
 const groups=new Map();
 for(const row of bars){const stamp=Math.floor(row.time/bucket)*bucket,existing=groups.get(stamp);
 if(!existing)groups.set(stamp,{...row,time:stamp});
 else{existing.high=Math.max(existing.high,row.high);existing.low=Math.min(existing.low,row.low);existing.close=row.close;existing.volume+=row.volume||0}}
 return [...groups.values()].sort((a,b)=>a.time-b.time)
}
module.exports=async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','public,s-maxage=10,stale-while-revalidate=25');
 if(req.method!=='GET')return res.status(405).json({error:'GET only'});
 const market=String(req.query?.market||'crypto'),symbol=String(req.query?.symbol||'BTCUSDT').toUpperCase(),interval=String(req.query?.interval||'15m');
 if(!Object.hasOwn(INTERVALS,interval))return res.status(400).json({error:'Unsupported interval'});
 if(market==='crypto'&&!/^[A-Z0-9]{2,15}USDT$/.test(symbol))return res.status(400).json({error:'Only USD-M USDT pairs supported'});
 if(market==='forex'&&!Object.hasOwn(FX,symbol))return res.status(400).json({error:'Unsupported forex symbol'});
 if(!['crypto','forex'].includes(market))return res.status(400).json({error:'Unsupported market'});
 try{
  let bars=[],source='';
  if(market==='crypto'){
   const url='https://fapi.binance.com/fapi/v1/klines?symbol='+symbol+'&interval='+interval+'&limit=240';
   const raw=await get(url);if(!Array.isArray(raw))throw Error('Invalid Binance response');
   bars=raw.map(v=>({time:Math.floor(Number(v[0])/1000),open:Number(v[1]),high:Number(v[2]),low:Number(v[3]),close:Number(v[4]),volume:Number(v[5])})).filter(x=>[x.time,x.open,x.high,x.low,x.close].every(Number.isFinite));source='Binance USD-M Futures';
  }else{
   const o=INTERVALS[interval];
   let last;
   for(const h of ['query1.finance.yahoo.com','query2.finance.yahoo.com'])try{
    const url='https://'+h+'/v8/finance/chart/'+encodeURIComponent(FX[symbol])+'?range='+o.range+'&interval='+o.i;
    const r=await get(url),chart=r?.chart?.result?.[0],t=chart?.timestamp||[],q=chart?.indicators?.quote?.[0];
    if(!q||!t.length)throw Error('FX provider returned no candles');
    bars=t.map((v,i)=>({time:Number(v),open:Number(q.open?.[i]),high:Number(q.high?.[i]),low:Number(q.low?.[i]),close:Number(q.close?.[i]),volume:Number(q.volume?.[i])||0})).filter(x=>[x.time,x.open,x.high,x.low,x.close].every(Number.isFinite)&&x.close>0);
    if(o.bucket)bars=aggregate(bars,o.bucket);
    if(bars.length<8)throw Error('Not enough FX candle history');
    source='Yahoo Finance indicative FX chart';break;
   }catch(e){last=e}
   if(!bars.length)throw last||Error('FX provider unavailable');
  }
  if(bars.length<5)throw Error('Insufficient market candles');
  return res.status(200).json({market,symbol,interval,source,quoteBasis:market==='forex'?'Indicative OHLC; not broker-executable':'Futures traded-market OHLC',candles:bars.slice(-240),asof:new Date().toISOString()});
 }catch(e){return res.status(502).json({error:'Market candles unavailable',detail:String(e.message||e).slice(0,100)})}
};
