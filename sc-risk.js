(()=>{
'use strict';if(document.querySelector('.sc-risk-disclosure'))return;
const main=document.querySelector('main');if(!main)return;
const box=document.createElement('section');box.className='sc-risk-disclosure';box.setAttribute('role','note');box.setAttribute('aria-label','Trading risk disclosure');
const heading=document.createElement('strong');heading.textContent='Trading involves risk.';
const p=document.createElement('p');p.textContent='Cryptocurrency and foreign exchange markets are volatile. You may lose some or all of the capital you commit. SignalChart uses technical analysis, stop-loss levels, position sizing and economic-event checks as risk-management tools, but none can prevent losses or guarantee profitable trades. Our signals are research, not personal investment advice; trading decisions and execution remain yours. Historical simulations and past results do not predict future performance.';
box.append(heading,p);
const footer=main.querySelector('footer');if(footer)main.insertBefore(box,footer);else main.append(box);
})();