// Service worker PontajPRO — minim și sigur.
// Regula de aur: index.html mereu network-first (deploy-urile ajung instant),
// doar /assets/ (fișiere cu hash, imuabile) sunt cache-first.
const VER = 'pontajpro-v1'

self.addEventListener('install', () => { self.skipWaiting() })

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return // Supabase & co. rămân direct pe rețea

  // Navigații: rețea întâi, fallback la shell-ul din cache când ești offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(r => { const c = r.clone(); caches.open(VER).then(x => x.put('/index.html', c)); return r })
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  // Asset-uri hash-uite de Vite: cache-first
  if (url.pathname.startsWith('/assets/') || url.pathname.match(/\.(png|webmanifest)$/)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(r => {
        if (r.ok) { const c = r.clone(); caches.open(VER).then(x => x.put(req, c)) }
        return r
      }))
    )
  }
})
