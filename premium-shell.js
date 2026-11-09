(()=>{'use strict';
const path=location.pathname;const as=(s)=>document.querySelector(s);
const primary=[['/','Overview'],['/terminal.html?pair=BTCUSDT','Markets'],['/crypto.html','Crypto'],['/forex.html','Forex'],['/billing.html','Billing'],['/support.html','Support']];
function active(h){return h==='/'?path==='/'||path==='/index.html':path===h.split('?')[0]}
const header=as('.v2-header');
if(header){
 const nav=header.querySelector('nav');
 if(nav){
 const admin=nav.querySelector('#admin-link'),sign=nav.querySelector('#signout');
 for(const a of [...nav.querySelectorAll('a')]){if(a.id!=='admin-link')a.remove()}
 for(const [href,label] of primary){const a=document.createElement('a');a.href=href;a.textContent=label;a.className='cv-navlink';if(active(href))a.setAttribute('aria-current','page');if(admin)nav.insertBefore(a,admin);else if(sign)nav.insertBefore(a,sign);else nav.append(a)}
 if(admin){admin.textContent='Admin';admin.href='/ops.html';admin.className='cv-navlink'}
 }
}
const body=document.body;

if(body.dataset.screen==='terminal'){
 document.addEventListener('click',event=>{
  const go=event.target.closest('[data-view="subscription"],[data-open="plans"],[data-open="renew"]');
  if(go){event.preventDefault();event.stopImmediatePropagation();location.href='/billing.html'}
 },true);

 const panel=as('.terminal-side .sidebar-nav');
 if(panel){
 const wrapper=document.createElement('div');wrapper.className='cand-app-quick';
 for(const [href,label] of [['/crypto.html','Crypto signals'],['/forex.html','Forex signals'],['/billing.html','Billing'],['/support.html','Support']]){
 const a=document.createElement('a');a.href=href;a.textContent=label;wrapper.append(a)}
 panel.prepend(wrapper);
 }
 const beta=as('.beta-chip');if(beta)beta.textContent='MARKET TERMINAL';
 const page=as('.page-title h1');if(page)page.textContent='Markets & research';
 const footer=as('.app-footer');if(footer)footer.innerHTML='<span>© Candriva</span><span>Market monitoring and member research</span>';
 body.querySelectorAll('.preview-chip').forEach(el=>{el.textContent='RESEARCH'});
 body.querySelectorAll('[data-open="trial"]').forEach(el=>{el.addEventListener('click',e=>{e.stopImmediatePropagation();e.preventDefault();location.href='/billing.html'},true)});
}
if(!body.querySelector('.cand-btm')&&body.dataset.candrivaPage){
 const nav=document.createElement('nav');nav.className='cand-btm';nav.setAttribute('aria-label','Main pages');
 for(const [href,label,icon] of [['/','Home','⌂'],['/crypto.html','Crypto','₿'],['/forex.html','Forex','⌁'],['/account.html','Account','♙']]){
 const a=document.createElement('a');a.href=href;a.innerHTML='<b>'+icon+'</b>'+label;if(active(href))a.setAttribute('aria-current','page');nav.append(a)}
 body.append(nav);
}
if(path==='/account.html'){
 const hero=as('.v2-hero p');if(hero)hero.textContent='Your subscription, market access, payment history and account settings in one place.';
 const note=as('#checkout-closed');if(note){note.hidden=true}
 const m=as('#member-area');if(m){
 const links=document.createElement('div');links.className='cand-member-actions';links.innerHTML='<a class="cand-btn" href="/billing.html">Monthly subscription & BTC payments ↗</a><a class="cand-btn-secondary" href="/support.html">Messages & support</a>';m.prepend(links)
 }
}
if(path==='/admin.html'){
 const main=as('.v2-hero');if(main){
 const a=document.createElement('div');a.className='cand-member-actions';a.innerHTML='<a class="cand-btn" href="/ops.html">Open payment & support operations ↗</a>';main.after(a)}
}
})();