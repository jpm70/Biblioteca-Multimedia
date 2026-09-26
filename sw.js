/* Nextflix — Service Worker: proxy autenticado de Google Drive para <video> nativo.
   El navegador de la TV pide  <origen>/nfmedia/<fileId>  y el SW lo reenvía a
   la API de Drive añadiendo el token OAuth y propagando las peticiones Range
   (necesario para poder avanzar/retroceder en el vídeo).                        */

const AUTH_CACHE = 'nf-auth-v1';
const TOKEN_KEY  = 'nf-token-store';
const PASS_HEADERS = ['Content-Type','Content-Length','Content-Range','Accept-Ranges','ETag','Last-Modified','Cache-Control'];

self.addEventListener('install',  e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/* respaldo: la página también puede mandar el token por postMessage */
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'token') {
    e.waitUntil(caches.open(AUTH_CACHE).then(c => c.put(TOKEN_KEY, new Response(e.data.token || ''))));
  }
});

async function getToken() {
  try {
    const c = await caches.open(AUTH_CACHE);
    const r = await c.match(TOKEN_KEY);
    return r ? (await r.text()) : '';
  } catch (e) { return ''; }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.includes('/nfmedia/')) return;
  event.respondWith(proxy(event.request, url));
});

async function proxy(req, url) {
  const id = decodeURIComponent(url.pathname.split('/nfmedia/')[1].split('/')[0].split('?')[0]);
  const token = await getToken();
  if (!id)    return new Response('id ausente', { status: 400 });
  if (!token) return new Response('sin sesión', { status: 401 });

  const headers = { 'Authorization': 'Bearer ' + token };
  const range = req.headers.get('Range');
  if (range) headers['Range'] = range;

  const driveUrl = 'https://www.googleapis.com/drive/v3/files/' +
                   encodeURIComponent(id) + '?alt=media&supportsAllDrives=true';

  let resp;
  try {
    resp = await fetch(driveUrl, { method: 'GET', headers });
  } catch (e) {
    return new Response('proxy: fallo de red — ' + e.message, { status: 502 });
  }

  const out = new Headers();
  for (const k of PASS_HEADERS) { const v = resp.headers.get(k); if (v) out.set(k, v); }
  if (!out.has('Accept-Ranges')) out.set('Accept-Ranges', 'bytes');

  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: out });
}
