import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import App from './App.jsx'
// Redări teren (01.11.2026, review Jakarinos P1-4 / P2-3): tokenul public din /redari/raspuns/<token> NU ajunge în telemetrie —
// src/redari/sentryScrub.js (testat în sentryScrub.test.js) redactează URL-uri, variante %2F, `p_token`, chei, la orice adâncime.
import { scrubSentryEvent, scrubSentrySpan, esteDinFormularulPublic } from './redari/sentryScrub.js'
// Redări (03.11.2026): pe redari.gazpet.ro se deschid doar paginile publice; orice altă cale merge pe domeniul principal
import { tintaRedirectHostPublic, HOST_PUBLIC_REDARI } from './redari/domeniuPublic.js'

// Forțează tema întunecată pentru controalele native (dropdown-uri select,
// scrollbars, input-uri) pe tot ERP-ul, indiferent de setarea OS light/dark.
document.documentElement.style.colorScheme = 'dark'

Sentry.init({
  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
  // Jakarinos r7 P1-1: spanurile INP sunt envelope-uri separate care ocolesc beforeSend* și nu pot fi eliminate din beforeSendSpan →
  // INP oprit; fără tracing pe formularul public; beforeSendSpan redactează ce mai trece (spanuri copil ale tranzacțiilor)
  beforeSendSpan: scrubSentrySpan,
  dsn: 'https://78d9760da35bcd9f1271f8d782682e4f@o4511469034864640.ingest.de.sentry.io/4511469069729872',
  integrations: [Sentry.browserTracingIntegration({ enableInp: false })],
  tracesSampler: () => (esteDinFormularulPublic(null) ? 0 : 0.1),
  environment: import.meta.env.MODE,
  enabled: import.meta.env.PROD,
  // 08.09.2026: zgomot din browserele in-app (Facebook/Instagram/TikTok injectează scripturi proprii — „Java object is gone”,
  // iabjs://…) — nu sunt erori ale platformei; nu ne trezesc pe mail
  ignoreErrors: [/Java object is gone/i, /postMessage/i, /iabjs:\/\//i, /ResizeObserver loop/i],
  denyUrls: [/^iabjs:\/\//i, /fbcdn\.net/i, /connect\.facebook\.net/i, /_next-live\//i, /vercel\.live/i],
})

// A doua barieră după regula din vercel.json: cale ERP pe host-ul public → domeniul principal, fără să pornească aplicația
const tintaErp = tintaRedirectHostPublic(window.location)
const pePublic = window.location.hostname.toLowerCase() === HOST_PUBLIC_REDARI

// PWA: service worker doar în producție (în dev ar încurca hot-reload-ul); nu pe host-ul public Redări
if (import.meta.env.PROD && !pePublic && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

if (tintaErp) window.location.replace(tintaErp)
else ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
