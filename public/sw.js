/* Service Worker ของ SMART-POS (ค่าเริ่มต้น) — ตัวแปร BUILD / PRECACHE ถูกเติมตอน `vite build`
   ถ้าคุณมี sw.js เดิมที่ปรับแต่งไว้ ให้ผสานเอง: ต้อง precache ไฟล์ใน ./js/ และ ./assets/ ด้วย */
const BUILD = '__BUILD_ID__';
const CACHE = 'smartpos-' + BUILD;
const PRECACHE = /*PRECACHE_START*/[]/*PRECACHE_END*/;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(PRECACHE.map((u) => {
        const cross = /^https?:/i.test(u);
        return c.add(new Request(u, cross ? { mode: 'no-cors' } : { cache: 'reload' })).catch(() => { });   // ไฟล์ไหนโหลดไม่ได้ไม่ทำให้ติดตั้งล้ม
      })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('smartpos-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  // API ของ Supabase (ข้อมูลสด/ยืนยันตัวตน) ไม่เก็บแคช — ให้แอปจัดการออฟไลน์เองด้วยคิวซิงก์
  if (/\.supabase\.co$/i.test(u.hostname) && !u.pathname.startsWith('/storage/v1/object/public')) return;

  if (r.mode === 'navigate') {   // หน้าเว็บ: ลองเน็ตก่อน (ได้เวอร์ชันใหม่) ไม่มีเน็ตใช้ของในแคช
    e.respondWith(
      fetch(r).then((res) => { const cp = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', cp)); return res; })
        .catch(() => caches.match('./index.html').then((h) => h || caches.match('./')))
    );
    return;
  }
  // ไฟล์คงที่ (js/css/ฟอนต์/CDN): ใช้แคชก่อน ไม่มีค่อยโหลดแล้วเก็บ
  e.respondWith(
    caches.match(r).then((hit) => hit || fetch(r).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(r, cp)); }
      return res;
    }))
  );
});
