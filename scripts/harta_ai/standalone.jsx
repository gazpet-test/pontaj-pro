// Harta AI — punctul de intrare al variantei standalone (HTML care se deschide direct în browser).
// Citește JSON-ul pus de genereaza_v2.mjs în <script id="harta-date"> și desenează aceeași componentă ca în ERP.
import { createRoot } from 'react-dom/client'
import HartaAI from '../../src/HartaAI.jsx'

const el = document.getElementById('harta-radacina')
let date = null
try {
  date = JSON.parse(document.getElementById('harta-date')?.textContent || 'null')
} catch (e) {
  el.textContent = `Harta nu se poate citi: ${e.message}`
}
if (date) {
  createRoot(el).render(
    <>
      <h1>{date.meta?.titlu || 'Harta AI'}</h1>
      <HartaAI date={date} />
    </>,
  )
}
