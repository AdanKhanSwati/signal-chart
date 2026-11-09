self.addEventListener('install',event=>{self.skipWaiting()});self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim())});self.addEventListener('push',event=>{
 let data={title:'SignalChart Ops',body:'A new administrator item needs review.',url:'/ops.html'};
 try{const incoming=event.data?.json();if(incoming&&typeof incoming==='object')data={...data,...incoming}}catch{}
 const url=String(data.url||'/ops.html');const path=url.startsWith('/ops.html')?url:'/ops.html';
 event.waitUntil(self.registration.showNotification(String(data.title||'SignalChart Ops').slice(0,90),{body:String(data.body||'Open operations').slice(0,200),icon:'/ops-icon.svg',badge:'/ops-icon.svg',tag:String(data.tag||'ops'),renotify:true,data:{url:path}}));
});
self.addEventListener('notificationclick',event=>{event.notification.close();const target=event.notification.data?.url||'/ops.html';event.waitUntil((async()=>{const clientsList=await clients.matchAll({type:'window',includeUncontrolled:true});for(const client of clientsList){if(new URL(client.url).origin===self.location.origin){await client.focus();if(client.navigate)return client.navigate(target)}}return clients.openWindow(target)})())});
self.addEventListener('fetch',event=>{ /* API and account traffic remain network-only, never cached. */ });