// Customer PWA scope is /app.html only; no privileged administrator push
// registrations and no offline copies of private accounts, quotes or signals.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{ /* Network-only for authenticated / market content. */ });
