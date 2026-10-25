// The board's service worker: the page and its files load with no network, and the last state it read is read back, marked, until the board answers again.
// Writes and answers are never cached or queued: a send with no network fails on the page as it does now. BUILD is put above this file by src/cli.ts.
const SHELL = `shell-${BUILD}`, DATA = 'state', STATE = '/api/decisions', SAVED = 'x-sign-off-saved', OFFLINE = 'x-sign-off-offline';
const FILES = /^\/(?:tokens\.css|ui\.css|pwa\.js|inter\.woff2|icon\.svg|apple-touch-icon\.png|icon-(?:192|512|maskable-512)\.png)$/;

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const shell = await caches.open(SHELL), page = await fetch('/', { cache: 'reload' });
  if (!page.ok) throw new Error(`The board answered ${page.status}`);
  // The page names its files, with their content hashes: keep exactly those.
  const names = [...(await page.clone().text()).matchAll(/(?:href|src)="([^"#]+)"/g)].map((m) => m[1]).filter((n) => FILES.test(`/${n.split('?')[0]}`));
  await shell.put('/', page);
  await shell.addAll(names.map((n) => new Request(n, { cache: 'reload' })));
  await self.skipWaiting();
})()));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('shell-') && name !== SHELL) await caches.delete(name);
  await self.clients.claim();
})()));

/** The state, from the board when it answers; the last good copy, marked, when it cannot be reached. A part of the board answers a part of it; the copy is the
 * last answer, whichever part it was (a whole board answers every part of it). A refused token empties the copy: it is not for this person any more. */
async function state(request) {
  const store = await caches.open(DATA);
  try {
    const res = await fetch(request);
    if (res.status === 401 || res.status === 403) await store.delete(STATE);
    else if (res.ok) await store.put(STATE, new Response(await res.clone().blob(), { headers: { 'content-type': 'application/json', [SAVED]: String(Date.now()) } }));
    return res;
  } catch {
    const kept = await store.match(STATE);
    if (kept) return new Response(kept.body, { headers: { 'content-type': 'application/json', [SAVED]: kept.headers.get(SAVED), [OFFLINE]: '1' } });
    return Response.json({ error: 'You are offline and this device has no saved copy of the board yet.' }, { status: 503 });
  }
}

/** The page: the board's own when it answers, the kept one otherwise. Only the bare address is kept, so a link's access token is never in a cache key. */
async function page(request) {
  const shell = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    if (res.ok) await shell.put('/', res.clone());
    return res;
  } catch {
    return (await shell.match('/')) ?? new Response('You are offline and this device has not opened the board yet.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (e) => {
  const { request } = e, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && url.pathname === '/' && !url.search) return e.respondWith(page(request));
  // The board's state, whatever part of it a page asks for: kept as the last good copy, and read back offline for whatever part comes asking.
  if (url.pathname === STATE) return e.respondWith(state(request));
  if (FILES.test(url.pathname)) e.respondWith(caches.match(request, { cacheName: SHELL }).then((kept) => kept ?? fetch(request).then((res) => {
    if (res.ok) caches.open(SHELL).then((c) => c.put(request, res.clone()));
    return res;
  })));
});
