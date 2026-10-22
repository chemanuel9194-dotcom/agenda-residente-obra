// Incrementar VERSION en cada publicación que cambie HTML, CSS, JS o iconos.
const VERSION='2026.10.21.1';
const PREFIX='agenda-obra-shell-'+encodeURIComponent(new URL(self.registration.scope).pathname)+'-';
const CACHE=PREFIX+VERSION;
const FILES=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./icon-maskable-512.png'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 await cache.addAll(FILES.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})));
 // La actualización espera hasta que el usuario autorice su activación.
})()));
self.addEventListener('message',event=>{
 if(event.data?.type==='APPLY_UPDATE')event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 // Solo cachés del programa y de este alcance. Nunca IndexedDB.
 const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)));
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE),cached=await cache.match(request);if(cached)return cached;
  if(request.mode==='navigate')return (await cache.match(new URL('./index.html',self.registration.scope)))||Response.error();
  try{return await fetch(request)}catch{return Response.error()}
 })());
});
