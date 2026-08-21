import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import App from './App.jsx'

// Forțează tema întunecată pentru controalele native (dropdown-uri select,
// scrollbars, input-uri) pe tot ERP-ul, indiferent de setarea OS light/dark.
document.documentElement.style.colorScheme = 'dark'

Sentry.init({
  dsn: 'https://78d9760da35bcd9f1271f8d782682e4f@o4511469034864640.ingest.de.sentry.io/4511469069729872',
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.1,
  environment: import.meta.env.MODE,
  enabled: import.meta.env.PROD,
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
