// ════════════════════════════════════════════════════════════════
// garantiiBileteOrdin.js — bilete la ordin (BO) date de Gazpet ca GARANȚIE la polițele de asigurare (cererea Marilenei
//   Tudorache, decizia lui Răzvan 02.10.2026 „1B”, claude_context #1544). Regula de business: BO-ul NU e plata primei —
//   e garanția cerută de asigurător la poliță și se urmărește până la restituire (sau executare). Tabela
//   garantii_bilete_ordin (migrarea 20261003a) e legată de rândul poliței din Registrul garanții
//   (garantii.forma = 'polita_asigurare'); lucrarea și asigurătorul vin de acolo.
//   Doar logică PURĂ (fără React/Supabase) — testată cu vitest (garantiiBileteOrdin.test.js).
// ════════════════════════════════════════════════════════════════

export const PRAG_SCADENT_ZILE = 14              // ≤ 14 zile până la scadență ⇒ „scadent” (același prag ca alerta bo_scadent din BD)
export const BUCKET_SCAN_BO = 'documente-firma'  // scanurile: bucket privat, DOAR PDF, max 50 MB (restricțiile bucketului)
export const MAX_SCAN_OCTETI = 50 * 1024 * 1024
export const MONEDE_BO = ['RON', 'EUR']
export const STARI_BO = {
  emis:      { eticheta: 'Emis',      culoare: 'yellow', descriere: 'la asigurător, nerestituit' },
  restituit: { eticheta: 'Restituit', culoare: 'green',  descriere: 'înapoi la Gazpet' },
  executat:  { eticheta: 'Executat',  culoare: 'red',    descriere: 'încasat de asigurător' },
}

// azi ca 'AAAA-LL-ZZ' în ora locală (ca <input type="date">), nu UTC
export const aziISO = (d = new Date()) => {
  const z = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}
// 'AAAA-LL-ZZ…' → ms UTC la miezul nopții; null dacă nu e dată
const laZi = s => { const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null }
// '1234.5' / '1234,5' / '1.234,56' / 1234 → număr; null dacă nu e număr
export function laNumar(v) {
  if (v == null || v === '') return null
  let s = String(v).replace(/\s/g, '')
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(',', '.')
  const x = Number(s)
  return Number.isFinite(x) ? x : null
}

// zile întregi până la scadență (negativ = depășită); null fără scadență / dată invalidă
export function zilePanaLaScadenta(dataScadenta, azi = aziISO()) {
  const a = laZi(dataScadenta), b = laZi(azi)
  if (a == null || b == null) return null
  return Math.round((a - b) / 86400000)
}
// BO emis cu scadența în ≤ prag zile (inclusiv depășită) — indicatorul „🧾 BO scadent” din listă
export const eScadent = (bo, azi = aziISO(), prag = PRAG_SCADENT_ZILE) => {
  if (!bo || bo.stare !== 'emis') return false
  const z = zilePanaLaScadenta(bo.data_scadenta, azi)
  return z != null && z <= prag
}
export const eDepasit = (bo, azi = aziISO()) => {
  if (!bo || bo.stare !== 'emis') return false
  const z = zilePanaLaScadenta(bo.data_scadenta, azi)
  return z != null && z < 0
}
// textul de sub scadență: 'depășită de N zile' / 'scadent azi' / 'N zile'; '' când nu e nimic de semnalat
export function etichetaScadenta(bo, azi = aziISO(), prag = PRAG_SCADENT_ZILE) {
  if (!bo || bo.stare !== 'emis') return ''
  const z = zilePanaLaScadenta(bo.data_scadenta, azi)
  if (z == null || z > prag) return ''
  if (z < 0) return `depășită de ${-z} ${-z === 1 ? 'zi' : 'zile'}`
  if (z === 0) return 'scadent azi'
  return `${z} ${z === 1 ? 'zi' : 'zile'}`
}

// formularul gol (BO nou) și formularul din rândul existent (câmpurile ca string-uri, pentru inputuri)
export const formularGol = (azi = aziISO()) => ({
  serie: '', numar: '', suma: '', moneda: 'RON', data_emitere: azi, data_scadenta: '', stare: 'emis', restituit_la: '',
  document_path: null, observatii: '',
})
export const formularDinBO = (bo, azi = aziISO()) => ({
  ...formularGol(azi), id: bo.id,
  serie: bo.serie ?? '', numar: bo.numar ?? '', suma: bo.suma ?? '', moneda: bo.moneda || 'RON',
  data_emitere: bo.data_emitere ?? '', data_scadenta: bo.data_scadenta ?? '', stare: bo.stare || 'emis',
  restituit_la: bo.restituit_la ?? '', document_path: bo.document_path || null, observatii: bo.observatii ?? '',
})
// schimbarea stării: „restituit” cere data restituirii (implicit azi); celelalte stări o golesc
export function laSchimbareStare(f, stare, azi = aziISO()) {
  if (stare === 'restituit') return { ...f, stare, restituit_la: f.restituit_la || azi }
  return { ...f, stare, restituit_la: '' }
}

// erorile formularului (listă goală = valid): număr obligatoriu, sumă > 0, emitere obligatorie, scadență ≥ emitere,
// la „restituit” data restituirii (≥ emitere)
export function valideazaBO(f) {
  const e = []
  const emis = laZi(f?.data_emitere), scad = laZi(f?.data_scadenta), rest = laZi(f?.restituit_la)
  if (!String(f?.numar ?? '').trim()) e.push('numărul biletului e obligatoriu')
  const s = laNumar(f?.suma)
  if (s == null || !(s > 0)) e.push('suma trebuie să fie un număr mai mare decât 0')
  if (!MONEDE_BO.includes(f?.moneda || 'RON')) e.push('moneda trebuie să fie RON sau EUR')
  if (emis == null) e.push('data emiterii e obligatorie')
  if (f?.data_scadenta && scad == null) e.push('data scadenței nu e validă')
  if (emis != null && scad != null && scad < emis) e.push('scadența nu poate fi înaintea emiterii')
  if (!STARI_BO[f?.stare || 'emis']) e.push('stare necunoscută')
  if (f?.stare === 'restituit') {
    if (rest == null) e.push('la „restituit” trebuie data restituirii')
    else if (emis != null && rest < emis) e.push('restituirea nu poate fi înaintea emiterii')
  }
  return e
}
// rândul pentru BD (insert/update) din formular
export function normalizeazaBO(f, garantieId) {
  const stare = STARI_BO[f?.stare] ? f.stare : 'emis'
  return {
    garantie_id: garantieId ?? f?.garantie_id ?? null,
    serie: String(f?.serie ?? '').trim() || null,
    numar: String(f?.numar ?? '').trim(),
    suma: laNumar(f?.suma),
    moneda: MONEDE_BO.includes(f?.moneda) ? f.moneda : 'RON',
    data_emitere: f?.data_emitere || null,
    data_scadenta: f?.data_scadenta || null,
    stare,
    restituit_la: stare === 'restituit' ? (f?.restituit_la || null) : null,
    document_path: f?.document_path || null,
    observatii: String(f?.observatii ?? '').trim() || null,
  }
}

// rezumat per garanție din BO-urile încărcate într-un singur select (fără N+1): {garantie_id: {total, emise, scadente, depasite}}
export function rezumatBOPeGarantie(randuri, azi = aziISO(), prag = PRAG_SCADENT_ZILE) {
  const r = {}
  for (const bo of randuri || []) {
    const k = String(bo.garantie_id)
    const x = r[k] || (r[k] = { total: 0, emise: 0, scadente: 0, depasite: 0 })
    x.total++
    if (bo.stare === 'emis') {
      x.emise++
      if (eScadent(bo, azi, prag)) x.scadente++
      if (eDepasit(bo, azi)) x.depasite++
    }
  }
  return r
}

// scanul: calea în bucket (garantii/bo/<garantie_id>/<uuid>.<ext>) și verificarea fișierului înainte de upload
export const caleScanBO = (garantieId, uuid, numeFisier = '') => {
  const ext = (String(numeFisier).match(/\.([A-Za-z0-9]+)$/)?.[1] || 'pdf').toLowerCase()
  return `garantii/bo/${garantieId}/${uuid}.${ext}`
}
export function verificaScan(f) {
  if (!f) return null
  const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '')
  if (!pdf) return 'scanul trebuie să fie PDF (bucketul documente-firma primește doar PDF)'
  if (f.size > MAX_SCAN_OCTETI) return 'scanul depășește 50 MB'
  return null
}
// mesaj pe înțelesul omului pentru erorile BD la citire/salvare
export function mesajEroareSalvare(err) {
  const m = String(err?.message || err || '')
  if (err?.code === '23505' || /garantii_bo_serie_numar_uidx/.test(m)) return 'Există deja un bilet cu această serie și număr.'
  if (err?.code === '42501' || /row-level security/i.test(m)) return 'Nu ai drept de scriere pe registrul de garanții.'
  if (err?.code === '42P01' || err?.code === 'PGRST205' || (/garantii_bilete_ordin/.test(m) && /does not exist|schema cache/i.test(m))) {
    return 'Tabela biletelor la ordin nu e încă în baza de date (migrarea 20261003a nu e aplicată).'
  }
  return m || 'eroare necunoscută'
}
