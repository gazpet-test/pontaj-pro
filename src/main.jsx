import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import App from './App.jsx'

// Forțează tema întunecată pentru controalele native (dropdown-uri select,
// scrollbars, input-uri) pe tot ERP-ul, indiferent de setarea OS light/dark.
document.documentElement.style.colorScheme = 'dark'

// Redări teren (01.11.2026, review Jakarinos P1-4): tokenul public din /redari/raspuns/<token> NU ajunge în telemetrie.
// Se înlocuiește în orice șir din eveniment (request.url, transaction, breadcrumbs, spans, contexts) cu „[token]”.
const RX_TOKEN_REDARI = /\/redari\/raspuns\/[^\s/?#"'&]+/g
const redacteazaToken = (s) => s.replace(RX_TOKEN_REDARI, '/redari/raspuns/[token]')
function redacteazaAdanc(val, adancime = 0) {
  if (adancime > 12 || val === null || val === undefined) return val
  if (typeof val === 'string') return val.includes('/redari/raspuns/') ? redacteazaToken(val) : val
  if (Array.isArray(val)) { for (let i = 0; i < val.length; i++) val[i] = redacteazaAdanc(val[i], adancime + 1); return val }
  if (typeof val === 'object') { for (const k of Object.keys(val)) val[k] = redacteazaAdanc(val[k], adancime + 1); return val }
  return val
}
const faraTokenRedari = (event) => { try { return redacteazaAdanc(event) } catch { return event } }

Sentry.init({
  beforeSend: faraTokenRedari,
  beforeSendTransaction: faraTokenRedari,
  dsn: 'https://78d9760da35bcd9f1271f8d782682e4f@o4511469034864640.ingest.de.sentry.io/4511469069729872',
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.1,
  environment: import.meta.env.MODE,
  enabled: import.meta.env.PROD,
  // 08.09.2026: zgomot din browserele in-app (Facebook/Instagram/TikTok injectează scripturi proprii — „Java object is gone”,
  // iabjs://…) — nu sunt erori ale platformei; nu ne trezesc pe mail
  ignoreErrors: [/Java object is gone/i, /postMessage/i, /iabjs:\/\//i, /ResizeObserver loop/i],
  denyUrls: [/^iabjs:\/\//i, /fbcdn\.net/i, /connect\.facebook\.net/i, /_next-live\//i, /vercel\.live/i],
})

// PWA: service worker doar în producție (în dev ar încurca hot-reload-ul)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
