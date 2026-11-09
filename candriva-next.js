(()=>{'use strict';
const path=location.pathname;
const routes=[['/','⌂','Overview'],['/crypto.html','₿','Crypto signals'],['/forex.html','⌁','Forex signals'],['/terminal.html?pair=BTCUSDT','▥','Market terminal'],['/billing.html','◎','Membership'],['/support.html','✉','Messages & support'],['/ops.html','⚙','Operations center']];
function isCurrent(url){return (url.split('?')[0]||'/')===path||(url==='/'&&path==='/index.html')}
function buildSidebar(){
 const aside=document.createElement('aside');aside.className='cdn-rail';aside.id='cdn-sidebar';aside.setAttribute('aria-label','Main navigation');
 const b=document.createElement('a');b.className='cdn-brand';b.href='/';
 b.innerHTML='<span class="cdn-mark">⌁</span><span class="cdn-brand-name">CANDRIVA<small>MARKET INTELLIGENCE</small></span>';aside.append(b);
 const section=(title,items)=>{const titleEl=document.createElement('span');titleEl.className='cdn-menu-title';titleEl.textContent=title;aside.append(titleEl);const nav=document.createElement('nav');nav.className='cdn-menu';for(const [url,glyph,name] of items){const a=document.createElement('a');a.href=url;a.innerHTML='<span class="cdn-glyph">'+glyph+'</span> '+name;if(isCurrent(url))a.setAttribute('aria-current','page');nav.append(a)}aside.append(nav)};
 section('WORKSPACE',routes.slice(0,6));section('ADMINISTRATION',[routes[6]]);
 const plan=document.createElement('div');plan.className='cdn-rail-plan';plan.innerHTML='<small>YOUR ACCESS</small><strong>Manage membership</strong><p>Trial, renewal and BTC payment history</p><a href="/billing.html">Open billing ↗</a>';aside.append(plan);return aside;
}
function enhance(){
 if(document.body.classList.contains('cdn-home'))return;
 if(!document.body.matches('.v2-page,[data-screen="terminal"],[data-cand-page]'))return;
 const body=document.body;
 const stage=document.createElement('div');stage.className='cdn-stage';
 const existing=[...body.children];
 for(const node of existing){if(node.tagName==='SCRIPT'||node.classList?.contains('aurora'))continue;if(node.classList?.contains('cdn-rail')||node.classList?.contains('cdn-dimmed'))continue;stage.append(node)}
 body.prepend(stage);
 body.prepend(buildSidebar());
 const overlay=document.createElement('button');overlay.id='cdn-overlay';overlay.className='cdn-dimmed';overlay.type='button';overlay.setAttribute('aria-label','Close navigation');body.prepend(overlay);
 const bar=document.createElement('div');bar.className='cdn-topbar';
 const left=document.createElement('div');left.style.cssText='display:flex;gap:11px;align-items:center';
 const toggle=document.createElement('button');toggle.className='cdn-menu-btn';toggle.type='button';toggle.setAttribute('aria-label','Open navigation');toggle.setAttribute('aria-expanded','false');toggle.textContent='☰';toggle.id='cdn-menu-toggle';left.append(toggle);
 const crumb=document.createElement('span');crumb.className='cdn-breadcrumb';const current=routes.find(x=>isCurrent(x[0]));crumb.innerHTML='WORKSPACE <span style="opacity:.5;margin:0 7px">/</span> <strong>'+(current?.[2]||'Market research')+'</strong>';left.append(crumb);bar.append(left);
 const right=document.createElement('div');right.className='cdn-top-actions';right.innerHTML='<span class="cdn-pill">● CRYPTO + FOREX</span><a href="/account.html">My account ↗</a>';bar.append(right);
 stage.prepend(bar);
 if(body.dataset.screen==='terminal'){
 const scroll=stage.querySelector('.terminal-scroll');
 if(scroll){
 const tabs=document.createElement('nav');tabs.className='cdn-terminal-tabs';tabs.setAttribute('aria-label','Terminal features');
 const choices=[['signals','Overview'],['markets','Markets'],['analytics','Analytics'],['journal','Journal'],['reminders','Alerts']];
 choices.forEach(([view,label])=>{const btn=document.createElement('button');btn.type='button';btn.dataset.view=view;btn.textContent=label;if(view==='signals')btn.className='active';tabs.append(btn)});
 const billing=document.createElement('a');billing.href='/billing.html';billing.textContent='Membership ↗';tabs.append(billing);
 scroll.prepend(tabs);
 }
 }

 const mobile=document.createElement('nav');mobile.className='cdn-mobile-nav';mobile.setAttribute('aria-label','Mobile navigation');
 for(const [url,glyph,label] of [routes[0],routes[1],routes[2],['/account.html','◎','Account']]){const a=document.createElement('a');a.href=url;if(isCurrent(url))a.setAttribute('aria-current','page');a.innerHTML='<span>'+glyph+'</span>'+label;mobile.append(a)}stage.append(mobile);
}
function bind(){
 const toggle=document.getElementById('cdn-menu-toggle'),aside=document.getElementById('cdn-sidebar'),overlay=document.getElementById('cdn-overlay');
 if(toggle&&aside&&overlay){
 const set=open=>{aside.dataset.open=String(open);overlay.dataset.open=String(open);toggle.setAttribute('aria-expanded',String(open));};
 toggle.addEventListener('click',()=>set(aside.dataset.open!=='true'));overlay.addEventListener('click',()=>set(false));
 window.addEventListener('keydown',e=>{if(e.key==='Escape')set(false)});
 aside.addEventListener('click',e=>{if(e.target.closest('a'))set(false)});
 }
}
enhance();bind();
})();
