'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const pages=['markets','platform','research','membership'];

test('Main desktop and mobile nav link to distinct complete landing pages',()=>{
 const home=read('launch.html');
 for(const n of pages){
  assert.equal((home.match(new RegExp('href="/'+n+'.html"','g'))||[]).length>=2,true,n);
  assert.doesNotMatch(home,new RegExp('href="#'+n+'"'),n);
  const sub=read(n+'.html');
  assert.match(sub,/<main id="main">/);
  assert.match(sub,/class="info-hero/);
  assert.match(sub,new RegExp('<a href="/'+n+'.html" aria-current="page"'));
  for(const other of pages)assert.ok(sub.includes('href="/'+other+'.html"'),n+'=>'+other);
 }
});

test('Terminal preview loads true scaled full-height viewport, with mobile app variant',()=>{
 const html=read('launch.html'),js=read('launch.js'),css=read('launch.css'),platform=read('platform.html');
 for(const markup of [html,platform]){
  assert.match(markup,/data-src="\/terminal.html" data-mobile-src="\/app.html"/);
  assert.match(markup,/id="terminal-frame-wrap"/);
 }
 assert.match(js,/virtualWidth=mobile\?390:1440,virtualHeight=mobile\?900:1120/);
 assert.match(js,/ResizeObserver/);
 assert.match(js,/--preview-scale/);
 assert.match(js,/frame.src=selected/);
 assert.match(js,/frame.dataset.mobileSrc/);
 assert.match(css,/aspect-ratio:1440 \/ 1120/);
 assert.match(css,/aspect-ratio:390 \/ 900/);
 assert.match(css,/transform:scale\(var\(--preview-scale/);
 assert.match(css,/\.device-screen iframe\{display:block!important\}/);
});

test('Touch buttons suppress blue tap box but retain amber focus for keyboard users',()=>{
 const css=read('launch.css');
 assert.match(css,/-webkit-tap-highlight-color:transparent/);
 assert.match(css,/:focus:not\(:focus-visible\)\{outline:0!important/);
 assert.match(css,/:focus-visible\{outline:2px solid #ff9e52!important/);
});

test('Globe slowly rotates real latitude-longitude dot positions and honors reduced motion',()=>{
 const home=read('launch.html'),globe=read('signalchart-globe-rotate.js'),css=read('launch.css');
 assert.match(home,/id="rotating-globe"/);
 assert.match(home,/src="\/signalchart-globe\.svg"/);
 assert.match(home,/src="\/signalchart-globe-rotate\.js"/);
 assert.match(globe,/const LAND=\[\[/);
 assert.match(globe,/requestAnimationFrame/);
 assert.match(globe,/IntersectionObserver/);
 assert.match(globe,/prefers-reduced-motion/);
 assert.match(globe,/document.hidden/);
 assert.match(globe,/Math.cos\(lat\)\*Math.sin\(d\)/);
 assert.match(css,/\.world-visual\.is-animated canvas\{opacity:1\}/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\.world-visual canvas\{display:none!important/);
});

test('New pages preserve accurate membership and non-execution financial risk messaging',()=>{
 const member=read('membership.html'),research=read('research.html'),markets=read('markets.html');
 assert.match(member,/\$20/);
 assert.match(member,/72-hour trial/);
 assert.match(member,/Checkout, automatic premium signals and trial activation remain unavailable/);
 assert.match(member,/Trading can result in loss/);
 assert.match(research,/provider|source/i);
 assert.match(markets,/id="lp-btc"/);
 assert.match(markets,/id="lp-eur"/);
 for(const p of pages)assert.doesNotMatch(read(p+'.html'),/guaranteed profits|verified win rate|98% accurate/i);
});

test('New public pages and rotation script are allowlisted; no backend code is exported',()=>{
 const files=JSON.parse(read('cloudflare/public-assets.json')).files;
 for(const p of [...pages.map(p=>p+'.html'),'launch-pages.css','signalchart-globe-rotate.js'])assert.ok(files.includes(p),p);
 assert.ok(!files.some(p=>p.includes('secret')||p.includes('/tests/')||p.includes('.env')));
});
