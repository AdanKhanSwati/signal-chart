'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.resolve(__dirname,'..',file),'utf8');

test('Responsive terminal override is packaged and loaded after brand stylesheet',()=>{
 const html=read('terminal.html');
 const manifest=JSON.parse(read('cloudflare/public-assets.json'));
 const stylesheet='signalchart-terminal-responsive.css';
 assert.ok(manifest.files.includes(stylesheet));
 assert.ok(html.includes('href="/'+stylesheet+'"'));
 assert.ok(html.indexOf('signalchart-terminal-brand.css')<html.indexOf(stylesheet));
 assert.equal((html.match(new RegExp(stylesheet,'g'))||[]).length,1);
});

test('Mobile terminal arranges watchlist, chart toolbar and cards as width-safe responsive rows',()=>{
 const css=read('signalchart-terminal-responsive.css');
 assert.match(css,/body\.cx-market-page/);
 assert.match(css,/@media\s*\(max-width:\s*800px\)/);
 assert.match(css,/@media\s*\(max-width:\s*385px\)/);
 assert.match(css,/grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
 assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/scroll-snap-type:x proximity/);
 assert.match(css,/height:clamp\(295px,43dvh,440px\)/);
 assert.match(css,/env\(safe-area-inset-bottom/);
 assert.match(css,/\.mc-watch-search input\s*\{font-size:\s*16px/);
 assert.match(css,/\.mc-chart-foot\s*\{\s*display:flex;flex-wrap:wrap/);
 assert.doesNotMatch(css,/\bzoom:\s*[.0-9]+/);
 assert.doesNotMatch(css,/\btransform:\s*scale\(/);
});

test('Chart renderer uses legible 12px axes in the Market Terminal and high contrast labels',()=>{
 const source=read('market-charts.js');
 const canvas=read('interactive-chart.js');
 const css=read('signalchart-terminal-responsive.css');
 assert.match(source,/textColor:'#e1dce5',fontSize:12/);
 assert.match(source,/axisFontSize:12/);
 assert.match(canvas,/axisFontSize=Number\.isFinite\(options\.axisFontSize\)/);
 assert.match(canvas,/ctx\.setTransform\(pw\/g\.w,0,0,ph\/g\.h,0,0\)/);
 assert.match(canvas,/timeSteps=axisFontSize>=12&&g\.w<440\?3:5/);
 assert.match(canvas,/ctx\.fillStyle='#e1dce5'/);
 assert.match(css,/image-rendering: auto !important/);
 assert.match(css,/filter: none !important/);
});

test('Legible text and touch controls stay scoped to terminal without altering branding or other modules',()=>{
 const css=read('signalchart-terminal-responsive.css');
 assert.match(css,/body\.cx-market-page \.mc-chart-loading/);
 assert.match(css,/font-size:\s*13px/);
 assert.match(css,/\.mc-intervals button\s*\{/);
 assert.match(css,/min-height:\s*36px/);
 assert.match(css,/\.mc-chart-tools \.mc-chart-toggle/);
 assert.doesNotMatch(css,/(?:background-image|content):\s*url\(/);
 assert.doesNotMatch(css,/\.sc-logo img|\.sc-mobile-logo img|\.sc-avatar/);
 assert.doesNotMatch(css,/(?:^|\n)\s*body\s*\{/);
});
