'use strict';
/** Vercel Hobby-compatible transport for six existing API routes.
 * Every handler remains the same as its previous secure implementation.
 * The fixed route allowlist prevents arbitrary code loading.
 */
const ROUTES=Object.freeze({
 checkout:()=>require('../lib/api-compat/checkout'),
 'cv-ops':()=>require('../lib/api-compat/cv-ops'),
 crypto:()=>require('../lib/api-compat/crypto'),
 forex:()=>require('../lib/api-compat/forex'),
 signals:()=>require('../lib/api-compat/signals'),
 candriva:()=>require('../lib/api-compat/candriva')
});
function createHandler(map=ROUTES){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  const name=req.query?.sc_route;
  if(typeof name!=='string'||!Object.hasOwn(map,name))
   return res.status(404).json({error:'Unknown API route'});
  try{return await map[name]()(req,res)}
  catch{return res.status(503).json({error:'API temporarily unavailable'})}
 };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
