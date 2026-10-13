// ===========================================================================
// raportDistributie.js — „Raport lucrări executate" pentru distribuție gaze (13.10.2026)
// Modelul de hârtie: titlu + linie (localitate/stradă + data), tabel CONDUCTE
// (tronson / descriere „Montat conducta" / diam. / lungime / suduri-tip sudură / observații)
// și tabel BRANȘAMENTE (tronson / „Branșament" / diam. 32 / lungime / SE1 TEU / SE2 MUFĂ /
// SE3 MUFĂ / observații). Rândurile se adaugă după nevoie; în PDF se completează cu
// rânduri goale până la 4 / 10, ca pe formular.
// Logică pură (fără Supabase/DOM) — testată cu vitest.
// ===========================================================================

export const DIAMETRE_PE = [20, 25, 32, 40, 50, 63, 90, 110, 125, 160, 200, 225, 250, 315]
export const TIPURI_SUDURA = [
  { cod: 'electrofuziune', label: 'Electrofuziune' },
  { cod: 'cap_la_cap', label: 'Cap la cap' },
  { cod: 'altul', label: 'Altul' },
]
export const RANDURI_PDF = { conducta: 4, bransament: 10 }

export const randNou = (tabel) => tabel === 'bransament'
  ? { tabel, tronson: '', unitate_id: null, descriere: 'Branșament', diametru_mm: 32, lungime_m: '', se1: '', se2: '', se3: '', observatii: '' }
  : { tabel: 'conducta', tronson: '', unitate_id: null, descriere: 'Montat conducta', diametru_mm: '', lungime_m: '', suduri_nr: '', sudura_tip: '', observatii: '' }

const gol = (v) => v == null || String(v).trim() === ''

// Un rând contează doar dacă are ceva completat în afară de valorile implicite.
export function randCompletat(r) {
  if (!r) return false
  const camp = ['tronson', 'lungime_m', 'observatii', 'suduri_nr', 'se1', 'se2', 'se3']
  return camp.some(k => !gol(r[k])) || !!r.unitate_id
}

const num = (v) => {
  if (gol(v)) return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

// Validează rândurile completate; întoarce lista de erori (text pentru utilizator).
export function valideaza(randuri) {
  const erori = []
  const contor = { conducta: 0, bransament: 0 }
  for (const r of randuri || []) {
    if (!randCompletat(r)) continue
    const nr = ++contor[r.tabel]
    const et = `${r.tabel === 'bransament' ? 'Branșament' : 'Conductă'} rândul ${nr}`
    const l = num(r.lungime_m)
    if (l === null) erori.push(`${et}: lipsește lungimea`)
    else if (Number.isNaN(l) || l <= 0 || l > 100000) erori.push(`${et}: lungimea trebuie să fie un număr pozitiv (metri)`)
    if (gol(r.diametru_mm)) erori.push(`${et}: alege diametrul`)
    else if (!DIAMETRE_PE.includes(Number(r.diametru_mm))) erori.push(`${et}: diametru necunoscut (${r.diametru_mm})`)
    if (r.tabel === 'conducta') {
      const s = num(r.suduri_nr)
      if (s !== null && (Number.isNaN(s) || s < 0 || !Number.isInteger(s))) erori.push(`${et}: numărul de suduri trebuie să fie întreg ≥ 0`)
      if (!gol(r.sudura_tip) && !TIPURI_SUDURA.some(t => t.cod === r.sudura_tip)) erori.push(`${et}: tip de sudură necunoscut`)
    }
    for (const k of ['se1', 'se2', 'se3']) if (String(r[k] || '').length > 40) erori.push(`${et}: ${k.toUpperCase()} are peste 40 de caractere`)
    if (String(r.observatii || '').length > 500) erori.push(`${et}: observațiile au peste 500 de caractere`)
  }
  return erori
}

// Rândurile de salvat în raport_distributie_linii (doar cele completate, numerotate pe tabel).
export function pentruSalvare(randuri, raportId) {
  const contor = { conducta: 0, bransament: 0 }
  return (randuri || []).filter(randCompletat).map(r => {
    const nr_crt = ++contor[r.tabel]
    const brans = r.tabel === 'bransament'
    return {
      raport_id: raportId, tabel: r.tabel, nr_crt,
      tronson: gol(r.tronson) ? null : String(r.tronson).trim(),
      unitate_id: r.unitate_id || null,
      descriere: gol(r.descriere) ? null : String(r.descriere).trim(),
      diametru_mm: gol(r.diametru_mm) ? null : Number(r.diametru_mm),
      lungime_m: num(r.lungime_m),
      suduri_nr: brans ? null : num(r.suduri_nr),
      sudura_tip: brans || gol(r.sudura_tip) ? null : r.sudura_tip,
      se1: brans && !gol(r.se1) ? String(r.se1).trim() : null,
      se2: brans && !gol(r.se2) ? String(r.se2).trim() : null,
      se3: brans && !gol(r.se3) ? String(r.se3).trim() : null,
      observatii: gol(r.observatii) ? null : String(r.observatii).trim(),
    }
  })
}

// Din BD înapoi în formular (valori text pentru input-uri).
export function dinBd(linii) {
  return (linii || []).slice().sort((a, b) => (a.tabel === b.tabel ? a.nr_crt - b.nr_crt : a.tabel === 'conducta' ? -1 : 1)).map(l => ({
    tabel: l.tabel, tronson: l.tronson || '', unitate_id: l.unitate_id || null, descriere: l.descriere || '',
    diametru_mm: l.diametru_mm ?? '', lungime_m: l.lungime_m ?? '',
    ...(l.tabel === 'bransament'
      ? { se1: l.se1 || '', se2: l.se2 || '', se3: l.se3 || '' }
      : { suduri_nr: l.suduri_nr ?? '', sudura_tip: l.sudura_tip || '' }),
    observatii: l.observatii || '',
  }))
}

// Linia de sub titlu: localitatea/strada (din lucrare) + data.
export function antetImplicit({ adresa, numeLucrare }) {
  return String(adresa || numeLucrare || '').trim()
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const fmtData = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''
const fmtNum = (v) => v == null || v === '' ? '' : Number(v).toLocaleString('ro-RO', { maximumFractionDigits: 2 })
export const tronsonText = (l, unitati) => {
  const u = l.unitate_id ? (unitati || []).find(x => x.id === l.unitate_id) : null
  return u ? [u.cod, u.nume].filter(Boolean).join(' · ') : (l.tronson || '')
}
const sudLabel = (cod) => TIPURI_SUDURA.find(t => t.cod === cod)?.label || ''

// HTML-ul formularului (A4 landscape, lățime utilă ~1060px), coloane în procente.
export function buildHtml({ antet, data, linii, unitati, lucrare }) {
  const cond = (linii || []).filter(l => l.tabel === 'conducta')
  const br = (linii || []).filter(l => l.tabel === 'bransament')
  const pad = (arr, n, tabel) => arr.concat(Array.from({ length: Math.max(0, n - arr.length) }, () => ({ tabel, gol: true })))
  const td = 'border:1px solid #000;padding:4px 6px;height:26px;vertical-align:middle'
  const th = 'border:1px solid #000;padding:4px 6px;font-weight:700;text-align:center;vertical-align:middle;background:#fff'
  const rowsC = pad(cond, RANDURI_PDF.conducta, 'conducta').map((l, i) => `<tr>
      <td style="${td};text-align:center">${i + 1}</td>
      <td style="${td}">${l.gol ? '' : esc(tronsonText(l, unitati))}</td>
      <td style="${td};text-align:center">${l.gol ? 'Montat conducta' : esc(l.descriere || 'Montat conducta')}</td>
      <td style="${td};text-align:center">${l.gol ? '' : esc(l.diametru_mm ?? '')}</td>
      <td style="${td};text-align:center">${l.gol ? '' : esc(fmtNum(l.lungime_m))}</td>
      <td style="${td}">${l.gol ? '' : esc([l.suduri_nr != null && l.suduri_nr !== '' ? `${l.suduri_nr} suduri` : '', sudLabel(l.sudura_tip)].filter(Boolean).join(' / '))}</td>
      <td style="${td}">${l.gol ? '' : esc(l.observatii)}</td></tr>`).join('')
  const rowsB = pad(br, RANDURI_PDF.bransament, 'bransament').map((l, i) => `<tr>
      <td style="${td};text-align:center">${i + 1}</td>
      <td style="${td}">${l.gol ? '' : esc(tronsonText(l, unitati))}</td>
      <td style="${td};text-align:center">${l.gol ? 'Bransament' : esc(l.descriere || 'Branșament')}</td>
      <td style="${td};text-align:center">${l.gol ? '32' : esc(l.diametru_mm ?? '')}</td>
      <td style="${td};text-align:center">${l.gol ? '' : esc(fmtNum(l.lungime_m))}</td>
      <td style="${td};text-align:center">${l.gol ? '' : esc(l.se1)}</td>
      <td style="${td};text-align:center">${l.gol ? '' : esc(l.se2)}</td>
      <td style="${td};text-align:center">${l.gol ? '' : esc(l.se3)}</td>
      <td style="${td}">${l.gol ? '' : esc(l.observatii)}</td></tr>`).join('')
  return `<div style="width:1060px;padding:18px 22px;background:#fff;color:#000;font-family:Arial,sans-serif;font-size:12px">
    <div style="text-align:center;font-size:18px;font-weight:700;font-style:italic;letter-spacing:.5px">RAPORT LUCRARI EXECUTATE</div>
    <div style="text-align:center;margin:6px 0 14px;font-size:13px">${esc(antet || lucrare || '')}${data ? ' — ' + esc(fmtData(data)) : ''}</div>
    <table style="width:100%;border-collapse:collapse;table-layout:fixed">
      <colgroup><col style="width:5%"><col style="width:16%"><col style="width:16%"><col style="width:7%"><col style="width:9%"><col style="width:27%"><col style="width:20%"></colgroup>
      <tr><th style="${th}">Nr. crt.</th><th style="${th}">TRONSON</th><th style="${th}">Descriere activitate</th><th style="${th}">DIAM.</th><th style="${th}">Lungime</th><th style="${th}">SUDURI / Tip Sudura</th><th style="${th}">Observatii *</th></tr>
      ${rowsC}
    </table>
    <div style="height:18px"></div>
    <table style="width:100%;border-collapse:collapse;table-layout:fixed">
      <colgroup><col style="width:5%"><col style="width:16%"><col style="width:16%"><col style="width:7%"><col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:20%"></colgroup>
      <tr><th style="${th}" rowspan="2">Nr. crt.</th><th style="${th}" rowspan="2">TRONSON</th><th style="${th}" rowspan="2">Descriere activitate</th><th style="${th}" rowspan="2">DIAM.</th><th style="${th}" rowspan="2">Lungime</th><th style="${th}" colspan="3">SUDURI</th><th style="${th}" rowspan="2">Observatii *</th></tr>
      <tr><th style="${th}">SE 1 (TEU)</th><th style="${th}">SE 2 (MUFA)</th><th style="${th}">SE 3 (MUFA)</th></tr>
      ${rowsB}
    </table>
  </div>`
}

export const numeFisier = ({ lucrare, data }) =>
  `Raport_lucrari_${String(lucrare || 'lucrare').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'lucrare'}_${data || ''}.pdf`
