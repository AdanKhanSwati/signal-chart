'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const load=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
test('Animated globe preserves circular proportions instead of stretching to parent height',()=>{
 const css=load('launch.css');
 const base=css.match(/\.world-visual canvas\{[^}]*\}/);
 assert.ok(base,'globe canvas styles present');
 assert.match(base[0],/width:118%/);
 assert.match(base[0],/height:auto/);
 assert.match(base[0],/aspect-ratio:660\s*\/\s*575/);
 assert.doesNotMatch(base[0],/height:100%/);
 assert.match(css,/@media\(max-width:620px\)\{[\s\S]*?\.world-visual img\{[^}]*width:100%;height:auto/);
 assert.match(css,/@media\(max-width:620px\)\{[\s\S]*?\.world-visual canvas\{[^}]*width:100%;height:auto/);
});
test('Small mobile grids do not force overflowing columns',()=>{
 const css=load('launch.css');
 const pages=load('launch-pages.css');
 assert.match(css,/@media\(max-width:780px\)/);
 assert.match(css,/\.world-services\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/\.membership-inner\{grid-template-columns:1fr/);
 assert.match(css,/\.research-inner\{grid-template-columns:1fr/);
 assert.match(pages,/@media\(max-width:780px\)/);
 assert.match(pages,/\.info-head-grid\{grid-template-columns:minmax\(0,1fr\)/);
 assert.match(pages,/\.info-three-steps\{grid-template-columns:minmax\(0,1fr\)/);
});
test('Globe still respects reduced motion preference and static fallback',()=>{
 const css=load('launch.css'),js=load('signalchart-globe-rotate.js');
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/\.world-visual canvas\{display:none!important\}/);
 assert.match(js,/if\(reduced.matches\)return/);
 assert.match(load('launch.html'),/src="\/signalchart-globe\.svg"/);
});
