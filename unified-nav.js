(()=>{'use strict';
const body=document.body,marketing=body.dataset.unified==='marketing',dashboard=body.dataset.unified==='dashboard',path=location.pathname;
if(!marketing){
 const legacy=body.querySelector('.v2-header,.cand-header');
 if(legacy)legacy.hidden=true;
 const nav=document.createElement('header');nav.className='cx-header';
 const links=[['/dashboard.html','Dashboard'],['/crypto.html','Crypto'],['/forex.html','Forex'],['/terminal.html','Markets'],['/billing.html','Membership'],['/support.html','Support']];
 const header=document.createElement('div');header.className='cx-head-inner';
 const brand=document.createElement('a');brand.className='cx-logo';brand.href='/';brand.innerHTML='<img src="/candriva-wordmark.svg" width="154" height="39" alt="Candriva Signals">';
 const main=document.createElement('nav');main.className='cx-main-nav';main.setAttribute('aria-label','Main navigation');
 for(const[href,title]of links){const a=document.createElement('a');a.href=href;a.textContent=title;if(path===href)a.setAttribute('aria-current','page');main.append(a)}
 const actions=document.createElement('div');actions.className='cx-header-actions';
 const account=document.createElement('a');account.className='cx-quiet';account.href='/account.html';account.textContent='Account';
 const cta=document.createElement('a');cta.className='cx-primary cx-head-cta';cta.href=path==='/account.html'?'/dashboard.html':'/dashboard.html';cta.innerHTML='My dashboard <span>↗</span>';
 const toggle=document.createElement('button');toggle.type='button';toggle.className='cx-menu-button';toggle.setAttribute('aria-label','Open navigation');toggle.setAttribute('aria-expanded','false');toggle.dataset.menuToggle='';toggle.innerHTML='<span></span><span></span><span></span>';
 
const originalSignout=body.querySelector('#signout');
let logout=null;
if(originalSignout){
 logout=document.createElement('button');
 logout.type='button';logout.className='cx-quiet cx-logout';logout.textContent='Sign out';logout.hidden=true;
 logout.onclick=()=>originalSignout.click();
 actions.append(logout);
 const update=()=>{logout.hidden=originalSignout.hidden||originalSignout.style.display==='none'};
 update();
 new MutationObserver(update).observe(originalSignout,{attributes:true,attributeFilter:['hidden','style','class']});
}
actions.append(account,cta,toggle);header.append(brand,main,actions);nav.append(header);body.prepend(nav);

 const menu=document.createElement('div');menu.className='cx-mobile-menu';menu.id='cx-mobile-menu';menu.hidden=true;
 const options=document.createElement('nav');options.setAttribute('aria-label','Mobile navigation');
 for(const [href,title] of [['/','Website'],...links,['/account.html','My account']]){const a=document.createElement('a');a.href=href;a.textContent=title;options.append(a)}
 if(['admin','ops'].includes(body.dataset.candrivaPage)||body.dataset.candPage==='ops'){for(const[href,title]of[['/admin.html','Members'],['/ops.html','Admin operations']]){const a=document.createElement('a');a.href=href;a.textContent=title;options.append(a)}}
 
if(originalSignout){
 const link=document.createElement('button');link.type='button';link.className='cx-mobile-signout';link.textContent='Sign out';link.hidden=true;
 link.onclick=()=>originalSignout.click();
 const update=()=>{link.hidden=originalSignout.hidden||originalSignout.style.display==='none'};
 update();new MutationObserver(update).observe(originalSignout,{attributes:true,attributeFilter:['hidden','style','class']});
 options.append(link);
}

const legacyAdminLink=body.querySelector('#admin-link');
if(legacyAdminLink){
 const menuAdmin=document.createElement('a');menuAdmin.href='/ops.html';menuAdmin.textContent='Admin operations';menuAdmin.hidden=true;
 const desktopAdmin=document.createElement('a');desktopAdmin.href='/ops.html';desktopAdmin.textContent='Admin';desktopAdmin.hidden=true;
 options.append(menuAdmin);main.append(desktopAdmin);
 const updateAdmin=()=>{const yes=!legacyAdminLink.hidden;menuAdmin.hidden=!yes;desktopAdmin.hidden=!yes};
 updateAdmin();new MutationObserver(updateAdmin).observe(legacyAdminLink,{attributes:true,attributeFilter:['hidden','style','class']});
}
menu.append(options);nav.after(menu);


 if(body.dataset.candrivaPage==='account'){const member=body.querySelector('#member-area'),box=member?.querySelector('.v2-2col');
  if(member&&box){const link=document.createElement('a');link.className='cx-account-link';link.href='/billing.html';link.innerHTML='<div><strong>Membership & BTC billing</strong><span>Review your plan, renew early or view payments.</span></div><span aria-hidden="true">↗</span>';box.before(link)}
 }
 if(body.dataset.candrivaPage==='admin'){const area=body.querySelector('#admin-area');if(area){const link=document.createElement('a');link.className='cx-legacy-admin-link';link.href='/ops.html';link.textContent='Open billing, messages and notifications ↗';area.prepend(link)}}
 if(path==='/terminal.html'){body.classList.add('cx-signals-terminal');const old=body.querySelector('.signal-context h3');if(old)old.textContent='Signal analysis, not trading.';const para=body.querySelector('.signal-context p');if(para)para.textContent='Select Crypto or Forex Signals to review published research. The charts here are for market context only.';}
 const foot=document.createElement('footer');foot.className='cx-internal-footer';foot.innerHTML='<span>© Candriva Signals</span><span><a href="/">Website</a> · <a href="/support.html">Support</a> · <a href="/billing.html">Membership</a></span>';body.append(foot);
}
const toggle=body.querySelector('[data-menu-toggle]'),menu=body.querySelector('#cx-mobile-menu');
const setMenu=open=>{if(!toggle||!menu)return;menu.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Close navigation':'Open navigation');document.documentElement.style.overflow=open?'hidden':''};
toggle?.addEventListener('click',()=>setMenu(menu?.hidden));
menu?.addEventListener('click',e=>{if(e.target.closest('a'))setMenu(false)});
document.addEventListener('keydown',e=>{if(e.key==='Escape')setMenu(false)});
window.addEventListener('resize',()=>{if(innerWidth>900)setMenu(false)});
})();
