'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('SignalChart landing matches approved sans-serif luxury composition and shows actual globe artwork',()=>{
 const html=read('launch.html'),css=read('launch.css'),globe=read('signalchart-globe.svg');
 assert.match(html,/Trade with<br><span>market context\./);
 assert.match(html,/One platform<br>for global markets\./);
 assert.match(html,/src="\/signalchart-globe\.svg"/);
 assert.match(html,/fonts\.googleapis\.com\/css2\?family=Manrope/);
 assert.match(css,/--font:'Manrope',Inter/);
 assert.doesNotMatch(css,/Times New Roman|Georgia|serif/);
 assert.match(globe,/role="img"/);
 assert.match(globe,/world markets globe/);
 assert.match(globe,/#ed8f39/);
 assert.match(globe,/clip-path="url\(#sphere\)"/);
});
test('Four market price cards are translucent and only use provider prices',()=>{
 const html=read('launch.html'),css=read('launch.css'),js=read('launch.js');
 for(const id of ['lp-btc','lp-eth','lp-eur','lp-gbp']){
  assert.match(html,new RegExp('id="'+id+'"'));assert.match(html,new RegExp('id="'+id+'-source"'));assert.match(html,new RegExp('id="'+id+'-chart"'));
 }
 assert.equal((html.match(/class="market-card"/g)||[]).length,4);
 assert.match(css,/\.market-card\{[^}]+backdrop-filter:blur\(22px\)/);
 assert.match(js,/\/api\/candles\?market=/);
 assert.match(js,/\/api\/quotes\?market=forex&symbol=/);
 assert.match(js,/daily\.referenceOnly!==true/);
 assert.match(js,/Daily indicative/);
 assert.match(js,/Source temporarily unavailable/);
 assert.match(js,/createElementNS|querySelector\('path'\)/);
 assert.doesNotMatch(js,/Math\.random|fakePrice|dummyChart/);
});
test('Landing is mobile-responsive, accessible and promotes the actual platform without fabricating a mockup',()=>{
 const html=read('launch.html'),css=read('launch.css'),js=read('launch.js');
 for(const p of ['/dashboard.html','/terminal.html','/app.html','/account.html','/analytics.html','/support.html'])
  assert.ok(html.includes('href="'+p+'"'),p);
 assert.match(html,/data-src="\/terminal\.html"/);
 assert.match(html,/Actual SignalChart interactive market terminal preview/);
 assert.match(html,/id="terminal-preview"/);
 assert.match(html,/id="menu-toggle" aria-expanded="false"/);
 assert.match(js,/IntersectionObserver/);
 assert.match(js,/matchMedia\('\(min-width:621px\)'\)/);
 for(const marker of ['@media(max-width:900px)','@media(max-width:620px)','@media(max-width:380px)','prefers-reduced-motion','focus-visible'])
  assert.ok(css.includes(marker),marker);
 assert.match(html,/class="skip"/);
});
test('Paid gates and financial risk disclaimer remain explicit on luxury homepage',()=>{
 const html=read('launch.html');
 assert.match(html,/Checkout, automatic premium signals and trial activation remain unavailable/);
 assert.match(html,/Trading can result in loss/);
 assert.doesNotMatch(html,/guaranteed returns|verified performance|\d+% win rate|100% accurate/i);
});
test('Cloudflare marketing assets publish only reviewed SVG and frontend files',()=>{
 const a=JSON.parse(read('cloudflare/public-assets.json')).files;
 for(const f of ['launch.html','launch.css','launch.js','signalchart-globe.svg'])assert.ok(a.includes(f));
 assert.ok(!a.some(x=>x.includes('secret')||x.includes('.env')||x.includes('/tests/')));
});
test('Live smoke identifies new market-context headline',()=>{
 assert.match(read('scripts/check-live-staging.cjs'),/html\.includes\('Trade with<br><span>market context\.'/);
});
