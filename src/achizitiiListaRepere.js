// TKT-2026-0325 (05.10.2026): „lista reperelor primite” pentru magazie — FĂRĂ prețuri, doar repere și cantități,
// ca foaie de identificare la descărcare. Logică pură (testată în achizitiiListaRepere.test.js); Achizitii.jsx doar o
// deschide în fereastra de print a browserului (paginare corectă și la liste lungi, spre deosebire de PDF-ul de o pagină).

// Cantitatea EFECTIV primită — aceeași regulă ca liniiReceptionate din Achizitii.jsx (TKT-2026-0176): dacă s-a
// completat „Recepție pe repere”, primează cantitate_primita (reper anulat = 0); altfel cantitatea comandată.
const qtyEfectiva = l => (l.cantitate_primita != null ? (Number(l.cantitate_primita) || 0) : (Number(l.cantitate) || 0))
export const liniiPrimite = linii => (linii || [])
  .filter(l => l && l.denumire && qtyEfectiva(l) > 0)
  .map(l => ({ denumire: l.denumire, um: l.um || '', cantitate: qtyEfectiva(l), observatii: l.observatii || '' }))

// Textul din BD ajunge într-un document HTML: se escapează (denumiri cu „<”, „&” etc.)
export const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
const fmtCant = n => Number(n).toLocaleString('ro-RO', { maximumFractionDigits: 3 })
const fmtZi = d => d.toLocaleDateString('ro-RO', { timeZone: 'Europe/Bucharest' })

// Documentul complet (HTML) pentru fereastra de print. `ctx` = { furnizorNume, proiectNume, livrareTxt } din ctxFor(c).
export function buildListaRepereHtml(c, ctx = {}, acum = new Date()) {
  const linii = liniiPrimite(c?.linii)
  const rand = (l, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(l.denumire)}${l.observatii ? `<div class="obs">${esc(l.observatii)}</div>` : ''}</td>
      <td class="c">${esc(l.um)}</td>
      <td class="r"><b>${fmtCant(l.cantitate)}</b></td>
      <td class="c">☐</td>
      <td></td>
    </tr>`
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8">
<title>Repere primite ${esc(c?.numar_comanda)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; margin: 0; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .sub { color: #555; font-size: 11px; margin-bottom: 10px; }
  .info { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 18px; margin-bottom: 10px; font-size: 11.5px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #888; padding: 5px 6px; vertical-align: top; }
  th { background: #eee; font-size: 11px; }
  .c { text-align: center; } .r { text-align: right; }
  .obs { font-size: 10px; color: #666; margin-top: 2px; }
  .nota { margin-top: 10px; font-size: 10px; color: #666; }
</style></head><body>
  <h1>GAZPET INSTAL S.R.L. — Listă repere primite</h1>
  <div class="sub">Comanda ${esc(c?.numar_comanda)} · fără prețuri · pentru identificarea reperelor în magazie</div>
  <div class="info">
    <div><b>Furnizor:</b> ${esc(ctx.furnizorNume || '—')}</div>
    <div><b>Proiect:</b> ${esc(ctx.proiectNume || '—')}</div>
    <div><b>Livrare:</b> ${esc(ctx.livrareTxt || '—')}</div>
    <div><b>Data listei:</b> ${fmtZi(acum)}</div>
  </div>
  ${linii.length ? `<table>
    <colgroup><col style="width:6%"><col style="width:50%"><col style="width:8%"><col style="width:12%"><col style="width:6%"><col style="width:18%"></colgroup>
    <thead><tr><th>Nr.</th><th>Reper</th><th>UM</th><th>Cant. primită</th><th>✓</th><th>Loc depozitare</th></tr></thead>
    <tbody>${linii.map(rand).join('')}</tbody>
  </table>` : '<p>Nu există repere primite pe această comandă.</p>'}
  <div class="nota">${linii.length} repere · cantitățile sunt cele efectiv recepționate (recepția pe repere primează asupra cantității comandate) · generat din Gazpet ERP la ${fmtZi(acum)}</div>
</body></html>`
}
