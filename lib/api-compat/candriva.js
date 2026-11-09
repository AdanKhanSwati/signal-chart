'use strict';
module.exports=function retired(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.status(410).json({error:'The legacy password and subscription API is retired. Use Candriva Clerk authentication and /api/member. No custom-password sessions are accepted.'});
};
