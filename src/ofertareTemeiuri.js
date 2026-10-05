// Temeiuri CNSC pentru clarificări — logică pură (fără React, fără Supabase), testată în ofertareTemeiuri.test.js.
// Pasul B din docs/juridic/MAPARE_CNSC_IN_ERP.md (sesiunea juridică, 05.10.2026). Regulile de aici sunt reguli de COD, nu de bun-simț:
//  - o decizie modificată/desființată în instanță sau neverificată nu e propusă niciodată (apare separat, cu motiv)
//  - platforma nu produce citate: singurul text citabil e citate_cheie[i].text, cu pagină și link — fără ele nu se exportă
//  - „regula”, „cum_ne_ajuta”, rezumatele = interpretare AI, nu intră între ghilimele

// precedente_cnsc din clarificari_tipare sunt source_id-uri „SRC-CNSC-…”; cnsc_decizii.id = fără prefixul „SRC-”.
export const idDecizieDinPrecedent = p => String(p || '').replace(/^SRC-/, '')

// Rangul controlului judiciar pentru ordonare: menținută > neverificat (null) > necunoscut. Modificată/desființată = excluse.
const RANG_CJ = { mentinuta: 0, neverificat: 1, necunoscut: 2 }
export const rezultatCJ = d => (d?.control_judiciar?.rezultat || 'neverificat')
export const esteExclusa = d => !d || d.verificat !== true || ['modificata', 'desfiintata'].includes(rezultatCJ(d))   // verificat NULL = neverificat (fail-closed)

// Domeniul deciziei (gaze / distributie / apa_canal / lucrari_general) ↔ segmentul licitației din ERP.
export function domeniuLicitatie(l) {
  const s = String(l?.segment || '').toLowerCase()
  if (s === 'distributie') return 'distributie'
  if (['transgaz', 'romgaz', 'conpet', 'gaze'].includes(s)) return 'gaze'
  if (['apa', 'apa_canal'].includes(s)) return 'apa_canal'
  return null
}
// Legea aplicabilă licitației: clasic → L98, sectorial → L99 (regim_achizitie din ofertare_licitatii).
export function legeLicitatie(l) {
  const r = String(l?.regim_achizitie || '').toLowerCase()
  return r === 'sectorial' ? 'L99' : r === 'clasic' ? 'L98' : null
}

// Avertismentele care însoțesc o decizie propusă (nu o exclud): vechime > 5 ani, altă lege decât a licitației.
export function avertismente(d, l, azi = new Date()) {
  const a = []
  const an = Number(d?.an) || (d?.data ? Number(String(d.data).slice(0, 4)) : null)
  if (an && azi.getFullYear() - an > 5) a.push(`decizie din ${an} — legislația s-a modificat, verifică articolul citat`)
  const lege = legeLicitatie(l)
  if (lege && d?.lege_aplicabila && d.lege_aplicabila !== lege) a.push(`decizie pe ${d.lege_aplicabila}, licitația e pe ${lege} — articolele se citează așa cum sunt în decizie, nu se „traduc”`)
  if (rezultatCJ(d) === 'necunoscut') a.push('control judiciar necunoscut')
  if (rezultatCJ(d) === 'neverificat') a.push('neverificată în instanță')
  return a
}

// Treapta 1 (deterministă, gratuită): propunerile pentru un tipar = precedentele lui, ordonate
// domeniu == domeniul licitației → lege == regimul licitației → control judiciar → an desc. Excluse: modificată / desființată / neverificată.
export function propuneriDinTipar(tipar, deciziiMap, licitatie, azi = new Date()) {
  const ids = (tipar?.precedente_cnsc || []).map(idDecizieDinPrecedent)
  const dom = domeniuLicitatie(licitatie), lege = legeLicitatie(licitatie)
  const propuse = [], excluse = [], lipsa = []
  for (const id of ids) {
    const d = deciziiMap instanceof Map ? deciziiMap.get(id) : deciziiMap?.[id]
    if (!d) { lipsa.push(id); continue }
    if (esteExclusa(d)) {
      const cj = rezultatCJ(d)
      excluse.push({ decizie: d, motiv: d.verificat !== true ? 'neverificată pe sursă' : cj === 'desfiintata' ? 'desființată în instanță' : 'modificată în instanță',
        hotarare: d.control_judiciar?.nr_hotarare || null, instanta: d.control_judiciar?.instanta || null })
      continue
    }
    propuse.push({ decizie: d, scor: [dom && d.domeniu === dom ? 0 : 1, lege && d.lege_aplicabila === lege ? 0 : 1, RANG_CJ[rezultatCJ(d)] ?? 1, -(Number(d.an) || 0)], avertismente: avertismente(d, licitatie, azi) })
  }
  propuse.sort((a, b) => { for (let i = 0; i < 4; i++) if (a.scor[i] !== b.scor[i]) return a.scor[i] - b.scor[i]; return 0 })
  return { propuse, excluse, lipsa }
}

// Pagina din „p. 19 (din 24)” / „pag. 3” / „pagina 7” → „p. N”. „cap. 12” NU e pagină (B5 Jakarinos). Fără pagină → null.
export function paginaDinLoc(loc) {
  const m = String(loc || '').match(/(?:^|[^a-zăâîșț])p(?:ag(?:ina)?)?\.?\s*(\d+)/i)
  return m ? `p. ${m[1]}` : null
}

// Formatul UNIC de proveniență (§4). Întoarce null dacă lipsește pagina sau link-ul — atunci nu se exportă.
//  „Decizia CNSC nr. 3657/C1/4067 din 23.12.2024, p. 28 — <link>”
//  „Decizia CNSC publicată în BO nr. BO2022_2473 (nr./data anonimizate), p. 19 — <link>”
export function formatCitare(d, citat) {
  if (!d || !citat) return null
  const pag = paginaDinLoc(citat.loc)
  if (!pag || !d.link_sursa) return null
  if (typeof citat.text !== 'string' || !citat.text.trim()) return null   // fără citat gol — și fără trim pe textul înghețat (B12)
  const anonim = !d.nr_decizie || !d.data || /anonimiz/i.test(d.nr_decizie)
  const data = d.data ? String(d.data).slice(0, 10).split('-').reverse().join('.') : null
  const cap = anonim
    ? `Decizia CNSC publicată în BO nr. ${d.buletin_oficial || d.id} (nr./data anonimizate), ${pag}`
    : `Decizia CNSC nr. ${d.nr_decizie} din ${data}, ${pag}`
  return { referinta: `${cap} — ${d.link_sursa}`, citat: citat.text, nota: 'practică de interpretare, nu normă' }
}

// „Tabelul temeiurilor nu e încă aplicat” se recunoaște DOAR după codul de eroare (Jakarinos r2): 42P01 = undefined_table (Postgres),
// PGRST205 = PostgREST nu găsește TABELUL în schema cache. O eroare de RELAȚIE (PGRST200, alias FK greșit) sau de coloană NU e „tabel lipsă” —
// altfel exportul ar sări tăcut peste secțiune, iar componenta ar minți că migrarea nu e aplicată.
export function tabelLipsa(e) {
  if (!e) return false
  if (e.code === '42P01') return /ofertare_clarificari_temeiuri/.test(e.message || '')
  if (e.code === 'PGRST205') return /ofertare_clarificari_temeiuri/.test(e.message || '')
  return false
}

// Un temei bifat „include în adresă” iese în PDF doar prin formatCitare (pagină + link + citat înghețat). Dacă nu poate ieși,
// bifa nu are ce face în platformă → UI nu o oferă, iar exportul se blochează în loc să sară rândul (Copilot r2, P1).
export function motivNeexportabil(t) {
  const d = t?.decizie
  if (!d) return 'nu e decizie CNSC'
  if (esteExclusa(d)) return d.verificat !== true ? 'decizie neverificată' : `decizie ${rezultatCJ(d)} în instanță`
  if (t.citat_idx == null) return 'doar referință, fără citat'
  if (!formatCitare(d, { loc: t.citat_loc, text: t.citat_text })) return 'fără pagină sau link sursă'
  return null
}

// ── Tipare declanșate (la citirea documentației) ──────────────────────────────────────────────────────────────
// unde_cauti din trigger ↔ tipul documentului din ofertare_documente_atribuire
export const UNDE_CAUTI_TIP = { caiet_sarcini: ['cs_volum'], contract: ['model_contract'], F3: ['lista_cantitati'], fisa_de_date: ['fisa_date'],
  raspunsuri_clarificari: ['raspuns_clarificare'], formulare: ['formular'] }

export const normalizeaza = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[„”“"']/g, '"').replace(/\s+/g, ' ').trim()

// Frazele citabile dintr-un semnal: ce e între ghilimele „…”, după trim, cu cel puțin 2 cuvinte și 12 caractere —
// un singur cuvânt („avizat”) ar declanșa pe „neavizat” (B8 Jakarinos). Fără ghilimele → nimic verificabil.
export function frazeDinSemnal(semnal) {
  const out = []
  const re = /[„“"]([^„”“"]*?)[”“"]/g
  let m
  while ((m = re.exec(String(semnal || '')))) {
    const f = m[1].trim()
    if (f.length >= 12 && f.split(/\s+/).length >= 2) out.push(f)
  }
  return out
}

// Potrivire pe limite de cuvânt în textul normalizat (nu subșir: „aviz” nu prinde „neavizat”).
export function contineFraza(textN, frazaN) {
  if (!frazaN) return false
  const esc = frazaN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`).test(textN)
}

// Detectare deterministă: doar tiparele cu tip_detectie = cuvant_cheie, doar frazele dintre ghilimele, doar în documentele
// din unde_cauti. O frază se potrivește dacă forma normalizată apare ca subșir în textul normalizat al documentului.
// texteDocs: [{ id, nume, tip, text }]. Întoarce tiparele declanșate cu dovezile (document + fraza), fără scor „inteligent”.
export function tipareDeclansate(tipare, texteDocs) {
  const docsN = (texteDocs || []).filter(d => d?.text).map(d => ({ ...d, _n: normalizeaza(d.text) }))
  const out = []
  for (const t of tipare || []) {
    if (t?.trigger?.tip_detectie !== 'cuvant_cheie') continue
    const fraze = frazeDinSemnal(t.trigger.semnal)
    if (!fraze.length) continue
    const tipuri = (t.trigger.unde_cauti || []).flatMap(u => UNDE_CAUTI_TIP[u] || [])
    if (!tipuri.length) continue   // unde_cauti lipsă sau nemapat → nu căutăm „peste tot” (B9 Jakarinos)
    const potriviri = []
    for (const d of docsN) {
      if (!tipuri.includes(d.tip)) continue
      for (const f of fraze) if (contineFraza(d._n, normalizeaza(f))) potriviri.push({ doc_id: d.id, doc: d.nume, fraza: f })
    }
    if (potriviri.length) out.push({ pattern_id: t.pattern_id, titlu: t.titlu, confidence: t.confidence, review: !!t.requires_human_legal_review,
      nr_precedente: (t.precedente_cnsc || []).length, intrebare_propusa: t.intrebare_propusa || '', potriviri })
  }
  return out.sort((a, b) => b.potriviri.length - a.potriviri.length)
}

// Eticheta scurtă a unei decizii în chip-uri: nr. exact sau codul BO.
export const etichetaDecizie = d => !d ? '' : (!d.nr_decizie || /anonimiz/i.test(d.nr_decizie)) ? `BO ${d.buletin_oficial || d.id}` : `nr. ${d.nr_decizie}${d.data ? ' / ' + String(d.data).slice(0, 10).split('-').reverse().join('.') : ''}`
