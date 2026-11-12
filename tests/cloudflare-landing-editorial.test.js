'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('Public homepage foregrounds the actual same-origin SignalChart trading terminal',()=>{
 const html=read('launch.html'),js=read('launch.js');
 assert.match(html,/The chart<br>comes/);
 assert.match(html,/data-src="\/terminal\.html"/);
 assert.match(html,/Actual SignalChart interactive market terminal preview/);
 assert.match(html,/id="terminal-preview"/);
 assert.match(js,/IntersectionObserver/);
 assert.match(js,/matchMedia\('\(min-width:621px\)'\)/);
 assert.doesNotMatch(html,/mock trading|fictional app screenshot/i);
});
test('Marketing photography is one genuine market photograph, not fabricated product proof',()=>{
 const html=read('launch.html');
 assert.match(html,/images\.unsplash\.com\/photo-1611974789855-9c2a0a7236a3/);
 assert.match(html,/alt="Photograph of financial market charts on a real monitor"/);
 assert.match(html,/loading="lazy"/);
 assert.equal((html.match(/images\.unsplash\.com\/photo-/g)||[]).length,1);
});
test('Editorial redesign has responsive, accessible, reduced-motion-aware styling and no generic feature grid',()=>{
 const css=read('launch.css'),html=read('launch.html');
 for(const marker of ['@media(max-width:800px)','@media(max-width:620px)','@media(max-width:380px)','prefers-reduced-motion','focus-visible'])
 assert.ok(css.includes(marker),marker);
 assert.match(html,/class="principle-row"/);
 assert.doesNotMatch(html,/class="features"|class="feature-grid"|class="bento/);
 assert.match(html,/class="skip"/);
});
test('Landing retains navigation and makes no false product-readiness or trading claims',()=>{
 const html=read('launch.html');
 for(const p of ['/dashboard.html','/terminal.html','/app.html','/account.html','/analytics.html','/support.html'])
 assert.ok(html.includes('href="'+p+'"'),p);
 assert.match(html,/Checkout, automatic premium signals and trial activation remain unavailable/);
 assert.match(html,/Trading can result in loss/);
 assert.doesNotMatch(html,/guaranteed return|verified performance|\d+% win.rate|100% accurate/i);
});
test('Market snapshot only displays genuine provider candles or marked daily indicative forex reference',()=>{
 const src=read('launch.js');
 assert.match(src,/\/api\/candles\?market=/);
 assert.match(src,/\/api\/quotes\?market=forex&symbol=/);
 assert.match(src,/daily\.referenceOnly!==true/);
 assert.match(src,/Daily indicative/);
 assert.match(src,/Source temporarily unavailable/);
 assert.doesNotMatch(src,/Math\.random|fakePrice|dummyChart/);
});
test('Staging release smoke recognizes the new design rather than the superseded headline',()=>{
 assert.match(read('scripts/check-live-staging.cjs'),/html\.includes\('The chart<br>comes'\)/);
});
