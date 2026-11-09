
(()=>{'use strict';
const path=location.pathname;
const is=(p)=>path===p||(p==='/'&&path==='/index.html');
const links=[
['/','Overview','⌂'],
['/crypto.html','Crypto','₿'],
['/forex.html','Forex','⌁'],
['/account.html','Membership','♙']
];
const active=(href)=>href==='/'?is('/'):href.startsWith('/crypto')?is('/crypto.html'):path===href;
function node(tag,cls,txt,href){const x=document.createElement(tag);if(cls)x.className=cls;if(txt)x.textContent=txt;if(href)x.href=href;return x}
function switcher(){
const el=node('div','cv-switch');
const t=node('span','cv-switch-label','EXPLORE MARKETS');el.append(t);
for(const [href,label] of links.slice(1)){
const a=node('a',active(href)?'cv-current':'',label,href);el.append(a)
}
return el}
function bottom(){
if(window.matchMedia&&!document.querySelector('.cv-app-bottom')&&!document.body.dataset.screen){
const nav=node('nav','cv-app-bottom');nav.setAttribute('aria-label','Primary navigation');
for(const [href,label,icon] of links){
const a=node('a','',null,href);
const glyph=node('span','',icon);a.append(glyph,document.createTextNode(label));
if(active(href))a.setAttribute('aria-current','page');nav.append(a)}
document.body.append(nav);
}}
if(document.body.classList.contains('v2-page')){
const header=document.querySelector('.v2-header');
if(header){
const brand=header.querySelector('.v2-brand');const tiny=brand?.querySelector('small');if(tiny)tiny.textContent='MARKET INTELLIGENCE';
const nav=header.querySelector('nav');
if(nav){
for(const a of Array.from(nav.querySelectorAll('a'))){if(a.id!=='admin-link')a.remove()}
const admin=nav.querySelector('#admin-link');const signout=nav.querySelector('#signout');
for(const [href,label] of links){
const a=node('a','cv-navlink',label,href);if(active(href))a.setAttribute('aria-current','page');
if(admin)nav.insertBefore(a,admin);else if(signout)nav.insertBefore(a,signout);else nav.append(a);
}
if(admin)admin.classList.add('cv-navlink');
if(signout)signout.setAttribute('aria-label','Sign out');
}}
const main=document.querySelector('.v2-container');
const hero=main?.querySelector('.v2-hero');
if(hero){
const market=switcher();hero.after(market);
if(is('/account.html')){
const p=hero.querySelector('p');if(p)p.textContent='Manage your profile, 24-hour trial and access to crypto and forex research in one place.';
}
if(is('/forex.html')){
const p=hero.querySelector('p');if(p)p.textContent='Experimental EUR/USD, GBP/USD and USD/JPY research from completed 15-minute candles. Open Crypto to explore digital-asset markets.';
}
}
bottom();
}
if(document.body.dataset.screen==='terminal'){
const side=document.querySelector('.sidebar-nav');
if(side){
const section=document.createElement('div');section.style.cssText='border-bottom:1px solid #304957;padding-bottom:9px;margin-bottom:10px;';
for(const [href,label] of [links[1],links[2],links[3]]){const a=node('a','cv-side-link',label,href);section.append(a)}
side.prepend(section);
}
const title=document.querySelector('.page-title');
if(title){const toggle=switcher();toggle.classList.add('cv-terminal-switch');title.before(toggle);
const h=title.querySelector('h1');if(h&&h.textContent.trim()==='Live Trading Signals')h.textContent='Crypto & Forex Markets';
}
}
})();
