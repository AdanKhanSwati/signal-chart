'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.resolve(__dirname,'..',p),'utf8');

test('Market terminal uses Cloudflare catalog instead of retired eight-pair Vercel endpoint',()=>{
 const ui=read('market-charts.js'),html=read('terminal.html');
 assert.match(ui,/fetch\('\/api\/markets'/);
 assert.doesNotMatch(ui,/\/api\/quotes\?mode=catalog/);
 assert.match(ui,/pairs\.push\(x\)/);
 assert.match(ui,/pairs\.length\.toLocaleString\(\)\+' markets'/);
 assert.match(ui,/p\.label\+' '\+p\.short\+' '\+p\.s/);
 assert.match(ui,/data-mc-more/);
 assert.doesNotMatch(html,/<small>8 markets<\/small>/);
 assert.match(html,/Loading market directory/);
});
test('Market chart source labels are read from authoritative OHLC metadata rather than hard-coded Futures',()=>{
 const ui=read('market-charts.js');
 assert.match(ui,/state\.candleSource=\{symbol,source:data\.source,instrument:/);
 assert.match(ui,/state\.candleSource\?\.symbol===p\.s/);
 assert.match(ui,/data\.instrument==='spot_reference'/);
 assert.match(ui,/Historical candles unavailable/);
 assert.doesNotMatch(ui,/const data=await res\.json\(\);if\(id!==state\.loadId\)return;\s*const validBars/);
});
test('Approved orange charcoal market styling is packaged as static asset, without replacing original logo',()=>{
 const html=read('terminal.html');
 const manifest=JSON.parse(read('cloudflare/public-assets.json'));
 const css=read('signalchart-terminal-brand.css');
 assert.ok(manifest.files.includes('signalchart-terminal-brand.css'));
 assert.match(html,/href="\/signalchart-terminal-brand\.css"/);
 const release=html.indexOf('/sc-release.css');
 const brand=html.indexOf('/signalchart-terminal-brand.css');
 assert.ok(release>=0&&brand>release,'brand overrides must load last');
 assert.match(html,/href="\/signalchart-mark\.svg"/);
 assert.match(css,/body\.cx-market-page/);
 assert.match(css,/#ff9b59|#ffa46f|#ffc39d/);
 assert.match(css,/#11141d|#0e1018/);
 assert.doesNotMatch(css,/\.sc-logo img|\.sc-wordmark/);
});
test('Worker staging stays on existing signal-chart with private runtime bindings retained',()=>{
 const config=JSON.parse(read('cloudflare/wrangler.staging.json'));
 assert.equal(config.name,'signal-chart');
 assert.equal(config.keep_vars,true);
 assert.equal(config.workers_dev,true);
 assert.equal(config.assets.binding,'ASSETS');
 assert.ok(!JSON.stringify(config).includes('sb_secret_'));
});
