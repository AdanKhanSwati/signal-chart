'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('Terminal DOM order matches chart-first mobile reading and keyboard order',()=>{
 const html=read('terminal.html');
 const start=html.indexOf('<section class="mc-body"');
 const end=html.indexOf('</main>',start);
 const body=html.slice(start,end);
 assert.ok(start>=0&&end>start);
 const chart=body.indexOf('class="mc-chart-panel"');
 const watch=body.indexOf('class="mc-instruments"');
 const insights=body.indexOf('class="mc-data-grid"');
 const table=body.indexOf('class="mc-market-overview"');
 assert.ok(chart>0&&watch>chart&&insights>watch&&table>insights);
 assert.match(body,/id="mc-browse-markets"/);
 assert.match(body,/aria-controls="mc-search"/);
 assert.match(body,/class="mc-content"/);
});

test('Small screens show chart before watchlist while desktop retains sidebar',()=>{
 const css=read('signalchart-terminal-responsive.css');
 assert.match(css,/\.mc-content\{display:contents!important\}/);
 assert.match(css,/grid-template-areas:"watch chart" "watch insights" "watch overview"/);
 assert.match(css,/grid-template-areas:"chart" "watch" "insights" "overview"/);
 assert.match(css,/@media\(max-width:800px\)/);
 assert.match(css,/\.mc-chart-area\{height:clamp\(256px,38svh,340px\)/);
 assert.match(css,/\.mc-browse-markets\{/);
 assert.match(css,/scroll-margin-top:16px/);
 assert.match(css,/body\.cx-market-page\.sc-terminal-page/);
 assert.doesNotMatch(css,/transform\s*:\s*scale\(/);
});

test('Ticker updates do not replace images or destroy the horizontally scrolled watchlist',()=>{
 const js=read('market-charts.js');
 assert.match(js,/const root=\$\('mc-watch-list'\),x=root\.scrollLeft,y=root\.scrollTop/);
 assert.match(js,/root\.scrollLeft=x;root\.scrollTop=y/);
 assert.match(js,/function updateVisibleMarketPrices\(\)/);
 assert.match(js,/updateVisibleMarketPrices\(\)/);
 assert.match(js,/\.mc-watch-row\[data-mc-symbol\]/);
 assert.match(js,/tr\.dataset\.marketSymbol=p\.s/);
 assert.match(js,/id="mc-browse-markets"|const browse=\$\('mc-browse-markets'\)/);
 const tick=js.slice(js.indexOf("window.addEventListener('signalchart:tick'"),js.indexOf("window.addEventListener('signalchart:kline'"));
 assert.doesNotMatch(tick,/renderWatch\(\)/);
});

test('Shared mobile header search button shows real icon instead of empty square',()=>{
 const base=read('sc-base-dashboard.css');
 const shared=read('signalchart.css');
 const shell=read('signalchart-shell.js');
 assert.match(base,/\.sc-search>span,\.sc-search kbd\{display:none\}/);
 assert.match(shared,/\.sc-search>\.sc-search-icon\{/);
 assert.match(shared,/display:grid!important;place-items:center!important/);
 assert.match(shared,/\.sc-search>\.sc-search-icon svg\{/);
 assert.match(shared,/@media\(max-width:360px\)/);
 assert.match(shell,/aria-label="Search markets, forex pairs and signals"/);
 assert.match(shell,/class=\\"sc-search-icon\\"/);
 assert.doesNotMatch(shared,/\.sc-logo img\{display:none/);
});
