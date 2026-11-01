/* FP Compass Service Worker
   2026-10-30 追加。目的は「アプリとしてインストールできる状態にする」こと だけ。
   このアプリ は version.txt + 自動 reload で 更新 を 管理 している ので、
   HTML / JS / CSS は 一切 キャッシュ しない (必ず ネットワーク から 取る)。
   キャッシュ する の は 自分 の アイコン だけ。 */
const ICON_CACHE = 'fpc-icons-v1';

self.addEventListener('install', (e) => { self.skipWaiting(); });

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== ICON_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;

  // アイコン だけ cache-first
  if (/^\/(icons|favicon)/.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(ICON_CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.status === 200) c.put(req, res.clone());
      return res;
    })());
    return;
  }

  // それ以外 は 素通し (キャッシュ しない)
  e.respondWith(fetch(req));
});
