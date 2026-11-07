// ❓ Întreabă echipa — corpusul intern pentru cercetare (06.11.2026). Funcții pure, testate în corpus.test.mjs.
// construieste_corpus.mjs citește fișierele de mai jos din repo și scrie indexul JSON pe care workerul îl caută pe cuvinte-cheie
// (cercetare.py: pregateste_index / selecteaza_extrase). Fără serviciu extern, fără date de proiect: doar cercetarea normativă.
import { createHash } from 'node:crypto'

// Ce intră în corpus: cercetarea normativă din docs/cercetare (acte, cerințe atomice cu locator, surse, practica CNSC, lipsuri).
// NU intră: brief-uri și rapoarte de lucru, audituri QA, SQL, duplicatele JSON ale fișierelor .md, docs/juridic (dosare cu date de
// proiect și contracte), docs/as-is (analiza ERP), skill-ul juridic (reguli de echipă, nu norme).
export const CORPUS = [
  'docs/cercetare/README.md',
  'docs/cercetare/baza_normativa.md',
  'docs/cercetare/registre_evidenta.md',
  'docs/cercetare/registru_cerinte.json',
  'docs/cercetare/registru_surse.json',
  'docs/cercetare/surse_lipsa.md',
  'docs/cercetare/pentru_echipa.md',
  'docs/cercetare/cnsc_practica.md',
  'docs/cercetare/cnsc_teme.md',
  'docs/cercetare/clarificari_tipare.md',
  'docs/cercetare/catalog_clarificari.md',
  'docs/cercetare/CORPUS_CJ_PAGINI_2026-10-19.md',
]
export const BUCATA_MAX = 1500
const CHEI_TITLU = ['requirement_id', 'identificator', 'cod', 'id', 'source_id']
const CHEI_SARITE = new Set(['snapshot_sha256', 'snapshot_data', 'encrypted_content'])

export const caleValida = c => typeof c === 'string' && /^docs\/[A-Za-z0-9_\-./]+\.(md|json)$/.test(c) && !c.includes('..')

/** Taie un text lung în bucăți ≤ max, pe paragrafe (apoi pe rânduri / tare, dacă un paragraf e prea lung). */
export function taie(text, max = BUCATA_MAX) {
  const out = []; let cur = ''
  const pune = p => {
    if (p.length > max) {
      if (cur) { out.push(cur); cur = '' }
      for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max))
      return
    }
    if (cur && cur.length + 2 + p.length > max) { out.push(cur); cur = '' }
    cur = cur ? cur + '\n\n' + p : p
  }
  for (const p of String(text ?? '').replace(/\r/g, '').split(/\n\s*\n/)) { const t = p.trim(); if (t) pune(t) }
  if (cur) out.push(cur)
  return out
}

/** Markdown → bucăți pe secțiuni (titlu = calea titlurilor, max 3 niveluri). */
export function bucatiMd(cale, text, max = BUCATA_MAX) {
  const out = [], stiva = []
  let corp = []
  const inchide = () => {
    const titlu = stiva.filter(Boolean).slice(-3).join(' › ')
    for (const b of taie(corp.join('\n'), max)) out.push({ cale, titlu, text: b })
    corp = []
  }
  let inCod = false
  for (const linie of String(text ?? '').replace(/\r/g, '').split('\n')) {
    if (/^\s*```/.test(linie)) inCod = !inCod
    const m = !inCod && linie.match(/^(#{1,4})\s+(.*)$/)
    if (m) { inchide(); stiva.length = m[1].length - 1; stiva[m[1].length - 1] = m[2].trim().slice(0, 200); continue }
    corp.push(linie)
  }
  inchide()
  return out
}

function valoareText(v) {
  if (v == null || v === '' || v === false) return ''
  if (Array.isArray(v)) return v.map(valoareText).filter(Boolean).join('; ')
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => { const t = valoareText(x); return t ? `${k}: ${t}` : '' }).filter(Boolean).join(', ')
  return String(v)
}

/** JSON (listă de înregistrări) → o bucată pe înregistrare: „cheie: valoare” pe rânduri. */
export function bucatiJson(cale, date, max = BUCATA_MAX) {
  const lista = Array.isArray(date) ? date : Array.isArray(date?.items) ? date.items : []
  const out = []
  for (const o of lista) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) continue
    const id = CHEI_TITLU.map(k => o[k]).find(x => typeof x === 'string' && x.trim())
    const titlu = [id, o.locator, o.titlu].filter(x => typeof x === 'string' && x.trim()).join(' · ').slice(0, 300)
    const text = Object.entries(o).filter(([k]) => !CHEI_SARITE.has(k)).map(([k, v]) => { const t = valoareText(v); return t ? `${k}: ${t}` : '' })
      .filter(Boolean).join('\n')
    if (text.trim()) out.push({ cale, titlu: titlu || cale, text: text.slice(0, max) })
  }
  return out
}

/** sha256 pe text cu capetele de rând unificate (LF): checkout-ul Windows (autocrlf) și cel Linux dau aceeași amprentă. */
export const sha256Text = t => createHash('sha256').update(String(t ?? '').replace(/\r\n?/g, '\n'), 'utf8').digest('hex')
export const sha256Octeti = b => createHash('sha256').update(b).digest('hex')

/** Manifestul din repo (worker/intrebari-tehnice/corpus_manifest.json): amprenta indexului + a fiecărui fișier din corpus. */
export function manifestDin(index, indexSha256) {
  return { versiune: 1, index_sha256: indexSha256, bucati: index.bucati.length,
           fisiere: index.fisiere.map(f => ({ cale: f.cale, sha256: f.sha256 ?? null, bucati: f.bucati ?? 0 })) }
}

/** [{cale, continut, sha256?}] → indexul pentru worker. Fișierele cu cale invalidă sau JSON stricat se raportează, nu se ghicesc.
 *  Fără dată de generare: indexul trebuie să fie determinist (manifestul din repo îi fixează sha256). */
export function construiesteIndex(fisiere, generatLa = null) {
  const bucati = [], raport = []
  for (const f of fisiere || []) {
    if (!caleValida(f?.cale)) { raport.push({ cale: f?.cale ?? null, eroare: 'cale invalidă' }); continue }
    let b
    if (f.cale.endsWith('.json')) {
      try { b = bucatiJson(f.cale, JSON.parse(f.continut)) } catch { raport.push({ cale: f.cale, eroare: 'JSON invalid' }); continue }
    } else b = bucatiMd(f.cale, f.continut)
    bucati.push(...b)
    raport.push({ cale: f.cale, bucati: b.length, ...(f.sha256 ? { sha256: f.sha256 } : {}) })
  }
  return { versiune: 1, generat_la: generatLa, fisiere: raport, bucati }
}
