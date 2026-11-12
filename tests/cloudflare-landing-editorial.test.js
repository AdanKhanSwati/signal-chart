'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const r=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('Editorial marketing page uses verified public Unsplash photography rather than generated graphics',()=>{
 const html=r('launch.html');
 assert.match(html,/images\.unsplash\.com\/photo-1611974789855-9c2a0a7236a3/);
 assert.match(html,/images\.unsplash\.com\/photo-1553877522-43269d4ea984/);
 assert.match(html,/alt="Real photograph/);
 assert.match(html,/alt="Real black-and-white photograph/);
 assert.match(html,/loading="lazy"/);
 assert.match(html,/fetchpriority="high"/);
});
test('Homepage retains exact product navigation and no invented signal or trading claims',()=>{
 const html=r('launch.html');
 for(const p of ['/dashboard.html','/terminal.html','/app.html','/account.html','/analytics.html','/support.html'])
  assert.ok(html.includes('href="'+p+'"'),p);
 assert.match(html,/Checkout, automatic premium signals and trial activation remain unavailable/);
 assert.match(html,/Trading can result in loss/);
 assert.doesNotMatch(html,/guaranteed returns|high win.rate|\d+% win.rate|verified profits/i);
});
test('Responsive visual system keeps small screens accessible and motion preferences respected',()=>{
 const css=r('launch.css');
 for(const marker of ['@media(max-width:920px)','@media(max-width:660px)','@media(max-width:400px)','prefers-reduced-motion','focus-visible'])
  assert.ok(css.includes(marker),marker);
 assert.ok(css.includes('backdrop-filter:blur'));
});
test('Public market snapshot never labels an FX daily reference as executable or a live ticker',()=>{
 const src=r('launch.js');
 assert.match(src,/\/api\/candles\?market=/);
 assert.match(src,/\/api\/quotes\?market=forex&symbol=/);
 assert.match(src,/daily\.referenceOnly!==true/);
 assert.match(src,/Daily indicative/);
 assert.match(src,/Source temporarily unavailable/);
 assert.doesNotMatch(src,/Math\.random|fakePrice|dummyChart/);
});
test('Read-only staging smoke tracks redesigned homepage marker',()=>{
 const src=r('scripts/check-live-staging.cjs');
 assert.match(src,/html\.includes\('See the market\.'\)/);
});
