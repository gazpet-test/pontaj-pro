// ════════════════════════════════════════════════════════════════════════
// IZOMETRIE E2a-2 — citirea stocului LOT 2 din Excelurile Topleț / Jupânești (preview, fără scriere)
// ════════════════════════════════════════════════════════════════════════
// Funcții pure pe rânduri (array-uri de celule, ca XLSX.utils.sheet_to_json(ws, {header:1, raw:true})): merg și în
// scriptul de preview (Node) și, mai târziu, în ecranul de import (E2b). Excelurile sunt conținut extern = date.
// Regula R13 (review E2): fiecare rând poartă fișierul, foaia și rândul sursă; orice 2545CA, perete lipsă, depozit
// neclar, neconformitate sau coliziune face preview-ul NEAPLICABIL până la o decizie scrisă (fișierul de decizii).

// Layout-urile foilor (indexuri de coloană, 0 = A). „TEAVA 7.1 TOPLET” are ieșirile în R–V și PV-ul în W–X.
export const LAYOUT = {
  toplet71: { start: 11, poz: 0, serie: 1, desc: 2, sarja: 3, kg: 4, nrAviz: 5, dataAviz: 6, cant: 7, um: 8, dataNrcd: 9,
    gestiune: 13, dtos: 14, neconf: 15, iesAviz: 17, iesSerie: 18, iesData: 19, iesCant: 20, iesTr: 21, pvNr: 22, pvData: 23, obs: 26 },
  standard: { start: 12, poz: 0, serie: 1, desc: 2, sarja: 3, kg: 4, nrAviz: 5, dataAviz: 6, cant: 7, um: 8, pvNr: 9, pvData: 10,
    gestiune: 14, dtos: 15, iesAviz: 16, iesTr: 17, iesSerie: 18, iesCant: 19, debitare: 20, inDm: 21, iesData: 22, obs: 23 },
  curbe: { start: 12, poz: 0, serie: 1, desc: 2, sarja: 3, kg: 4, nrAviz: 5, dataAviz: 6, cant: 7, dataRec: 8,
    gestiune: 12, dtos: 13, neconf: 14, iesAviz: 16, iesData: 17, iesCant: 18, iesSerie: 19, iesTr: 20, pvNr: 22, pvData: 23, obs: 24 },
}

// Foile cunoscute: layout, tipul, peretele așteptat (7,1 / 8,8 din numele foii) și depozitul implicit
export const FOI = {
  'TEAVA 7.1 TOPLET': { layout: 'toplet71', tip: 'teava', perete: 7.1, fisier: 'toplet' },
  '8,8 TOPLET':       { layout: 'standard', tip: 'teava', perete: 8.8, fisier: 'toplet' },
  '7.1 X 6ML':        { layout: 'standard', tip: 'teava', perete: 7.1, fisier: 'toplet' },
  'CURBE LOT 2':      { layout: 'curbe',    tip: 'curba', perete: null, fisier: 'toplet' },
  'TEAVA 7.1 MM':     { layout: 'standard', tip: 'teava', perete: 7.1, fisier: 'jupanesti' },
  'TEAVA 8.8 MM':     { layout: 'standard', tip: 'teava', perete: 8.8, fisier: 'jupanesti' },
}

const txt = v => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim()
const num = v => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

// Data din Excel: număr serial (1900, cu bug-ul 1900) sau text „zz/ll/aaaa” / „zz.ll.aaaa” → „AAAA-LL-ZZ” (fără fus orar)
export function dataExcel(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    const ms = Math.round((v - 25569) * 86400000)
    return new Date(ms).toISOString().slice(0, 10)
  }
  // același separator în toată data: „6/12.2026” (greșeala din foaie) rămâne invalidă, nu se ghicește
  const m = String(v).trim().match(/^(\d{1,2})([./])(\d{1,2})\2(\d{4})$/)
  if (m) {
    const [z, l, a] = [Number(m[1]), Number(m[3]), Number(m[4])]
    const iso = `${a}-${String(l).padStart(2, '0')}-${String(z).padStart(2, '0')}`
    // calendarul real (31/02, 29/02 în an nebisect → invalid), fără fus orar
    if (l >= 1 && l <= 12 && z >= 1 && z <= 31 && new Date(Date.UTC(a, l - 1, z)).toISOString().slice(0, 10) === iso) return iso
  }
  return { invalid: String(v) }
}

// Peretele din descriere: „ø 610 x7.1 mm”, „ø 610 x 8,8 mm” (țeavă) sau „CMFØ 610/8/L360NE/6,1 - 20˚” (curbă)
export function pereteDinDescriere(desc) {
  const s = txt(desc)
  let m = s.match(/610\s*[xX]\s*(\d{1,2}(?:[.,]\d)?)\s*mm/i)
  if (m) return Number(m[1].replace(',', '.'))
  m = s.match(/CMF\s*Ø?\s*610\s*\/\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*\//i)
  if (m) return Number(m[1].replace(',', '.'))
  return null
}
export function unghiDinDescriere(desc) {
  const m = txt(desc).match(/-\s*(\d{1,2}(?:[.,]\d)?)\s*[˚°º]/)
  return m ? Number(m[1].replace(',', '.')) : null
}

// Seria țevii: 3 cifre + 2 litere + 5 cifre. Placeholder-ele (247EK0, 264DB00, 254CA10) și „SBD” sunt rânduri de test.
export const RE_SERIE_TEAVA = /^\d{3}[A-Z]{2}\d{5}$/
export function clasificaSerieTeava(s) {
  const v = txt(s).toUpperCase()
  if (!v) return { clasa: 'gol' }
  if (v === 'SBD') return { clasa: 'test' }
  if (/^(247EK0|264DB00|254CA10)$/.test(v)) return { clasa: 'placeholder' }
  if (/^2545CA\d{5}$/.test(v)) return { clasa: 'conflict_2545CA', propunere: '254CA' + v.slice(6) }
  if (RE_SERIE_TEAVA.test(v)) return { clasa: 'ok', serie: v }
  return { clasa: 'format' }
}
export const serieCanon = s => txt(s).toUpperCase().replace(/[\s._/-]/g, '')

// Tronsonul de ieșire: „17”, „TR 12”, „TR12” → 17 / 12; „16-17” → ambiguu
export function tronsonIesire(v) {
  const s = txt(v).toUpperCase().replace(/^TR\s*/, '')
  if (!s) return null
  if (/^\d{2}$/.test(s)) return { nr: Number(s) }
  return { ambiguu: txt(v) }
}

/**
 * Citește o foaie. Întoarce rânduri normalizate (fără decizii aplicate) + excluderile numărate + rândurile fără serie
 * dar cu alte celule de material completate (fara_serie — blocante, review #807).
 * opt: { fisier (numele), foaie, rows, tipFisier ('toplet' | 'jupanesti' — workbook-ul real; foaia trebuie să-i aparțină) }
 */
export function citesteFoaie({ fisier, foaie, rows, tipFisier = null }) {
  const def = FOI[foaie]
  if (!def) return { necunoscuta: true, randuri: [], excluse: [], fara_serie: [] }
  // foaia legată de workbook-ul real (review #807 P1): o foaie mutată în alt fișier ar primi depozitul greșit
  if (tipFisier && def.fisier !== tipFisier) return { foaie_gresita: true, randuri: [], excluse: [], fara_serie: [] }
  const L = LAYOUT[def.layout]
  const randuri = [], excluse = [], fara_serie = []
  for (let i = L.start; i < rows.length; i++) {
    const r = rows[i] || []
    const rand = i + 1
    const serieBruta = txt(r[L.serie])
    const sursa = { fisier, foaie, rand }
    if (!serieBruta) {
      // doar rândul cu adevărat gol se ignoră; descriere / șarjă / greutate / aviz / cantitate fără serie = blocant
      const pline = ['desc', 'sarja', 'kg', 'nrAviz', 'cant'].filter(k => txt(r[L[k]]) !== '')
      if (pline.length) fara_serie.push({ sursa, campuri: pline })
      continue
    }
    const descriere = txt(r[L.desc])
    const gestiune = txt(r[L.gestiune]).toUpperCase()
    const dtos = txt(r[L.dtos]).toUpperCase()
    const neconf = L.neconf !== undefined ? txt(r[L.neconf]) : ''
    const iesAviz = txt(r[L.iesAviz]).toUpperCase()
    const tr = tronsonIesire(r[L.iesTr])
    const pvNr = txt(r[L.pvNr])
    const pvData = dataExcel(r[L.pvData] ?? (L.dataRec !== undefined ? r[L.dataRec] : null))
    const b = {
      // șarja normalizată ca la import (fără spații, majuscule) — aceeași cheie de coliziune în preview și în BD
      sursa, tip: def.tip, serie_bruta: serieBruta, sarja: txt(r[L.sarja]).toUpperCase().replace(/\s+/g, '') || null,
      sarja_bruta: txt(r[L.sarja]) || null, descriere,
      greutate_kg: num(r[L.kg]), nr_aviz: txt(r[L.nrAviz]) || null, data_aviz: dataExcel(r[L.dataAviz]),
      cantitate: num(r[L.cant]), gestiune, dt_os: dtos, neconformitate: neconf || null, aviz_iesire: iesAviz || null,
      tronson_iesire: tr, cant_iesire: num(r[L.iesCant]), debitare: L.debitare !== undefined ? num(r[L.debitare]) : null,
      cant_in_dm: L.inDm !== undefined ? num(r[L.inDm]) : null, pv_nr: pvNr || null, pv_data: pvData,
      data_nrcd: L.dataNrcd !== undefined ? dataExcel(r[L.dataNrcd]) : null,
      ies_serie: txt(r[L.iesSerie]).toUpperCase() || null, data_iesire: dataExcel(r[L.iesData]),
      obs: txt(r[L.obs]) || null,
    }
    if (def.tip === 'teava') {
      const c = clasificaSerieTeava(serieBruta)
      if (c.clasa === 'placeholder' || c.clasa === 'test') { excluse.push({ sursa, serie: serieBruta, motiv: c.clasa }); continue }
      b.clasa_serie = c.clasa
      b.serie = c.serie || serieBruta.toUpperCase()
      if (c.propunere) b.propunere_serie = c.propunere
      b.lungime_mm = b.cantitate === null ? null : Math.round(b.cantitate * 1000)
      b.perete_foaie = def.perete
      b.perete_desc = pereteDinDescriere(descriere)
    } else {
      if (/LOT\s*[13]\b/.test(gestiune)) { excluse.push({ sursa, serie: serieBruta, motiv: `curbă ${gestiune}` }); continue }
      b.serie = serieBruta.toUpperCase()
      b.perete_desc = pereteDinDescriere(descriere)
      b.unghi = unghiDinDescriere(descriere)
    }
    randuri.push(b)
  }
  return { randuri, excluse, fara_serie }
}

// depozitul propus: Jupânești → JUP; Topleț → ORN pentru DT/OS „ORSOVA” sau avize CJPT-O, TOP pentru „TOPLET”
export function depozitPropus(b, coduri) {
  const f = FOI[b.sursa.foaie]?.fisier
  if (f === 'jupanesti') return b.dt_os === 'DM JUPANESTI' ? { cod: 'JUP', id: coduri.JUP } : { grup: `Jupânești · DT/OS „${b.dt_os || '—'}”` }
  if (/^CJPT-O/.test(b.aviz_iesire || '') || b.dt_os === 'ORSOVA') return { cod: 'ORN', id: coduri.ORN }
  if (b.dt_os === 'TOPLET') return { cod: 'TOP', id: coduri.TOP }
  return { grup: `Topleț · DT/OS „${b.dt_os || '—'}”` }
}

// corecțiile de câmp scrise de oameni (răspunsurile MP): selector pe rânduri sau pe avize, câmp permis, valoare validată
const CAMPURI_CORECTABILE = new Set(['data_iesire', 'pv_nr', 'pv_data', 'data_aviz', 'data_nrcd'])
const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const isoValid = v => { const m = String(v || '').match(RE_ISO); return !!m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10) === v }
// rândurile unei corecții: [{rand, serie}] (lot) sau [rand] + serie (un singur rând) — seria de control e obligatorie
const randuriCorectie = c => (c.randuri || []).map(r => (typeof r === 'object' ? { rand: r.rand, serie: r.serie } : { rand: r, serie: c.serie }))
/** Validarea corecțiilor de câmp, ÎNAINTEA aplicării (Copilot #807 r4 P1): un selector pe rânduri cere fișier + foaie
 *  (numărul de rând e unic doar în foaie) și seria de control pentru fiecare rând; lipsa = problemă globală (fail-closed). */
export function problemeCorectii(decizii) {
  const out = []
  for (const [i, c] of (decizii.corectii_camp || []).entries()) {
    const et = `corectii_camp[${i}] (${c.camp})`
    if (!c.fisier) out.push(`${et}: fără fișier`)
    if (!c.randuri && !c.aviz_iesire) out.push(`${et}: fără selector (rânduri sau avize)`)
    if (c.randuri) {
      if (!c.foaie) out.push(`${et}: selector pe rânduri fără foaie (rândul e unic doar în foaie)`)
      if (!Array.isArray(c.randuri) || !c.randuri.length) out.push(`${et}: randuri gol`)
      else if (c.randuri.length > 1 && c.randuri.some(r => typeof r !== 'object')) out.push(`${et}: un lot de rânduri cere perechi {rand, serie}`)
      else if (randuriCorectie(c).some(r => !Number.isInteger(r.rand) || !r.serie)) out.push(`${et}: fiecare rând cere numărul și seria de control`)
    }
  }
  return out
}
function selectorBate(c, b) {
  if (!c.randuri && !c.aviz_iesire) return false   // fără selector pe rânduri / avize = nu se aplică nicăieri (fără wildcard)
  if (!c.fisier || c.fisier !== b.sursa.fisier) return false   // fișierul e obligatoriu (fără potriviri între workbook-uri)
  if (c.randuri && !c.foaie) return false                     // rândul fără foaie nu identifică unic (problemă globală)
  if (c.foaie && c.foaie !== b.sursa.foaie) return false
  if (c.randuri && !randuriCorectie(c).some(r => r.rand === b.sursa.rand)) return false
  if (c.aviz_iesire && !c.aviz_iesire.includes(b.aviz_iesire)) return false
  if (!c.randuri && c.serie && String(c.serie).toUpperCase() !== b.serie) return false
  return true
}

/**
 * Aplică deciziile și calculează pentru fiecare rând: starea, locul, peretele, problemele blocante.
 * decizii: { corectii_serie: {brut: corect | {serie, nota}}, excluderi: [{fisier, foaie, rand, serie (null = rând fără serie), motiv}],
 *            depozit_grup: {grup: COD | {cod, nota}}, tronson_grup: {text: nr},
 *            tronson_aviz: {aviz: nr} (TR ambiguu sau lipsă), tronson_aviz_serie: {'aviz|serie': nr} (prioritar),
 *            ignora_iesire: [{fisier, foaie, rand, serie, motiv}] (câmpuri de ieșire care nu sunt o ieșire reală),
 *            corectii_camp: [{fisier, foaie (obligatorie cu randuri), randuri: [{rand, serie}] | [rand] + serie, | aviz_iesire,
 *                             camp, valoare, motiv}],
 *            accepta_neconformitate: [{fisier, foaie, rand, serie, nota?, carantina?}], accepta_sarja: [serie],
 *            accepta_iesire_integrala: [{fisier, foaie, rand, serie, motiv}] (diferență de rotunjire, pe rândul numit) }
 * Deciziile pe rânduri (excluderi, ignora_iesire, accepta_neconformitate, accepta_iesire_integrala) poartă seria de control
 * (brută sau corectată prin corectii_serie): dacă rândul are altă serie, decizia e pe rândul greșit → blocant (Gemini r3 P2,
 * review #807 r5). Excluderile rândurilor fără serie poartă explicit serie: null.
 * Fiecare decizie pe rând trebuie să lovească EXACT un rând (perechile din corectii_camp, tronson_aviz_serie la fel); o
 * decizie pe avize trebuie să lovească cel puțin un rând; rândurile duplicate în lot și deciziile duplicate sunt blocante
 * globale (review #807 r5 P1/P2) — fail-closed, o decizie moartă sau ambiguă nu trece neobservată.
 */
export function evalueaza(randuri, { decizii = {}, coduri, tronsoane, faraSerie = [] }) {
  const cheieSursa = s => `${s.fisier}|${s.foaie}|${s.rand}`
  // seria de control bate cu seria brută, cu cea curentă sau cu cea corectată (corectii_serie) — review #807 r5 (05)
  const serieCorectata = b => { const c = decizii.corectii_serie?.[String(b.serie_bruta || '').toUpperCase()]; return c ? (typeof c === 'object' ? c.serie : c) : null }
  const serieBate = (b, s) => !!s && [b.serie, b.serie_bruta, serieCorectata(b)].some(x => x && serieCanon(x) === serieCanon(s))
  // contoarele: câte rânduri lovește fiecare decizie (review #807 r5 P1)
  const contor = new Map(), numara = k => contor.set(k, (contor.get(k) || 0) + 1)
  const globale = []
  const globala = problema => globale.push({ sursa: { fisier: '(decizii)', foaie: '', rand: 0 }, problema })
  // rânduri duplicate în lot (același fișier + foaie + rând) — review #807 r5 P2
  const vazuteSursa = new Map()
  for (const r of [...randuri, ...faraSerie]) vazuteSursa.set(cheieSursa(r.sursa), (vazuteSursa.get(cheieSursa(r.sursa)) || 0) + 1)
  for (const [k, n] of vazuteSursa) if (n > 1) globale.push({ sursa: { fisier: k.split('|')[0], foaie: k.split('|')[1], rand: Number(k.split('|')[2]) }, problema: `rând duplicat în lot (${n}×)` })
  const LISTE_PE_RAND = ['excluderi', 'ignora_iesire', 'accepta_neconformitate', 'accepta_iesire_integrala']
  for (const lista of LISTE_PE_RAND) {
    const v = new Set()
    for (const [i, e] of (decizii[lista] || []).entries()) {
      if (!e.fisier || !e.foaie || !Number.isInteger(e.rand)) globala(`${lista}[${i}]: cere fișier, foaie și rând`)
      if (!('serie' in e)) globala(`${lista}[${i}]: fără seria de control (serie: null doar pentru rândurile fără serie)`)
      if (v.has(cheieSursa(e))) globala(`${lista}[${i}]: decizie duplicată pe ${cheieSursa(e)}`)
      v.add(cheieSursa(e))
    }
  }
  const vCorectii = new Set()
  for (const [i, c] of (decizii.corectii_camp || []).entries()) for (const r of c.randuri ? randuriCorectie(c) : []) {
    const k = `${c.camp}|${c.fisier}|${c.foaie}|${r.rand}`
    if (vCorectii.has(k)) globala(`corectii_camp[${i}]: a doua corecție ${c.camp} pe rândul ${r.rand}`)
    vCorectii.add(k)
  }
  const exclDec = new Map((decizii.excluderi || []).map(e => [cheieSursa(e), e]))
  const neconfOk = new Map((decizii.accepta_neconformitate || []).map(e => [cheieSursa(e), e]))
  const ignoraIes = new Map((decizii.ignora_iesire || []).map(e => [cheieSursa(e), e.motiv || 'fără ieșire reală']))
  const iesireIntegrala = new Map((decizii.accepta_iesire_integrala || []).map(e => [cheieSursa(e), e.motiv || 'ieșire integrală']))
  const out = [], excluse = []
  for (const b0 of randuri) {
    const b = { ...b0, probleme: [], avertismente: [], corectii: [] }
    // deciziile pe rând se APLICĂ doar dacă seria de control bate (Copilot #807 r10 P2); altfel rămân doar ca problemă
    const decOk = new Set()
    for (const lista of LISTE_PE_RAND) for (const e of decizii[lista] || []) {
      if (cheieSursa(e) !== cheieSursa(b.sursa)) continue
      numara(`${lista}|${cheieSursa(e)}`)
      if (serieBate(b, e.serie)) decOk.add(lista)
      else b.probleme.push(`decizia ${lista} pe rândul ${b.sursa.rand} are seria de control „${e.serie || '—'}”, rândul are „${b.serie_bruta}” — neaplicată`)
    }
    // excluderea pe rândul greșit nu exclude: rândul rămâne în preview, cu problema (review #807 r5)
    if (exclDec.has(cheieSursa(b.sursa)) && decOk.has('excluderi')) {
      excluse.push({ sursa: b.sursa, serie: b.serie, motiv: `decizie: ${exclDec.get(cheieSursa(b.sursa)).motiv}` }); continue
    }
    // câmpurile de ieșire care nu sunt o ieșire reală (ex. curba 1198: TR „16” fără aviz — încă în stoc)
    if (ignoraIes.has(cheieSursa(b.sursa)) && decOk.has('ignora_iesire')) {
      b.corectii.push({ camp: 'iesire', inainte: { aviz: b.aviz_iesire, tr: b.tronson_iesire, cant: b.cant_iesire }, motiv: ignoraIes.get(cheieSursa(b.sursa)) })
      b.aviz_iesire = null; b.tronson_iesire = null; b.cant_iesire = null; b.ies_serie = null; b.data_iesire = null
    }
    // corecțiile de câmp (răspunsurile MP), înaintea oricărei validări
    // (1) se strâng corecțiile care lovesc rândul EFECTIV (selector pe rânduri SAU pe avize), validate; (2) pe un câmp
    // cel mult O corecție — două (rânduri + aviz, aviz + aviz) = conflict: problemă și niciuna aplicată, independent de
    // ordinea din JSON (Copilot #807 r10 P1)
    const peCamp = new Map()
    for (const [ci, c] of (decizii.corectii_camp || []).entries()) {
      if (!selectorBate(c, b)) continue
      // seria de control a rândului: dacă nu bate, corecția e pe rândul greșit → blocant, nu se aplică
      const rc = c.randuri ? randuriCorectie(c).find(r => r.rand === b.sursa.rand) : null
      numara(rc ? `cc|${ci}|${rc.rand}` : `cc|${ci}|aviz`)
      if (rc && !serieBate(b, rc.serie)) {
        b.probleme.push(`corecția ${c.camp} pe rândul ${b.sursa.rand} are seria de control „${rc.serie}”, rândul are „${b.serie_bruta}”`); continue
      }
      if (!CAMPURI_CORECTABILE.has(c.camp)) { b.probleme.push(`corecție pe câmp nepermis „${c.camp}”`); continue }
      if (c.camp !== 'pv_nr' && !isoValid(c.valoare)) { b.probleme.push(`corecția ${c.camp} = „${c.valoare}” nu e o dată AAAA-LL-ZZ validă`); continue }
      peCamp.set(c.camp, [...(peCamp.get(c.camp) || []), { ci, c }])
    }
    for (const [camp, lista] of peCamp) {
      if (lista.length > 1) {
        b.probleme.push(`${lista.length} corecții pe câmpul ${camp} al rândului ${b.sursa.rand} (corectii_camp[${lista.map(x => x.ci).join(', ')}]) — conflict, niciuna aplicată`)
        continue
      }
      const { c } = lista[0]
      b.corectii.push({ camp, inainte: b[camp] ?? null, dupa: c.valoare, motiv: c.motiv || null })
      b[camp] = camp !== 'pv_nr' ? c.valoare : String(c.valoare)
    }
    // seria
    if (b.tip === 'teava') {
      // corecția: text sau { serie, nota }; revalidată cu RE_SERIE_TEAVA (review #807 P2) — o greșeală de tastare în
      // fișierul de decizii nu trece
      const corect = decizii.corectii_serie?.[b.serie_bruta.toUpperCase()]
      if (corect) {
        b.serie = String(typeof corect === 'object' ? corect.serie : corect).toUpperCase().trim(); b.serie_corectata_din = b.serie_bruta
        if (typeof corect === 'object' && corect.nota) b.nota_corectie = corect.nota
        if (!RE_SERIE_TEAVA.test(b.serie)) b.probleme.push(`corecția de serie „${b.serie}” (din ${b.serie_bruta}) nu respectă formatul 999AA99999`)
      } else if (b.clasa_serie === 'conflict_2545CA') b.probleme.push(`serie „${b.serie_bruta}” (2545CA, propunere ${b.propunere_serie}) — de decis`)
      else if (b.clasa_serie === 'format') b.probleme.push(`serie „${b.serie_bruta}” în afara formatului 999AA99999`)
      if (b.lungime_mm === null || b.lungime_mm <= 0 || b.lungime_mm > 13000) b.probleme.push(`lungime invalidă (${b.cantitate})`)
      // peretele: din foaie, verificat cu descrierea
      if (b.perete_desc !== null && b.perete_desc !== b.perete_foaie) b.probleme.push(`perete: foaia spune ${b.perete_foaie}, descrierea ${b.perete_desc}`)
      b.perete_mm = b.perete_foaie ?? b.perete_desc
      // o ieșire PARȚIALĂ ar muta toată bucata pe tronson cu lungimea inițială → blocant, ca debitarea (Copilot r2 P1)
      if (b.aviz_iesire && b.cant_iesire !== null && b.cantitate !== null && Math.abs(b.cant_iesire - b.cantitate) > 0.005) {
        // decizie pe rândul NUMIT: diferența e rotunjire, țeava a ieșit întreagă (fără rest)
        if (iesireIntegrala.has(cheieSursa(b.sursa)) && decOk.has('accepta_iesire_integrala'))
          b.corectii.push({ camp: 'cant_iesire', inainte: b.cant_iesire, dupa: b.cantitate, motiv: iesireIntegrala.get(cheieSursa(b.sursa)) })
        else b.probleme.push(`ieșire parțială: ${b.cant_iesire} din ${b.cantitate} m pe avizul ${b.aviz_iesire} — de decis`)
      }
      if (b.debitare !== null && b.cantitate !== null && b.debitare > 0 && Math.abs(b.debitare - b.cantitate) > 0.005)
        b.probleme.push(`debitare parțială (${b.debitare} din ${b.cantitate} m) — rest în DM ${b.cant_in_dm}: de decis`)
    } else {
      b.perete_mm = b.perete_desc
      if (b.unghi === null) b.probleme.push(`unghi necitit din „${b.descriere}”`)
    }
    if (b.perete_mm === null || b.perete_mm === undefined) b.probleme.push('perete lipsă (D2#3)')
    if (!b.sarja) b.probleme.push('șarjă lipsă')
    else if (b.tip === 'teava' && !/^[A-Z]{2}\d{5}$/.test(b.sarja) && !(decizii.accepta_sarja || []).includes(b.sarja))
      b.avertismente.push(`șarjă în afara formatului AA99999: ${b.sarja}`)
    const neconfAplicata = neconfOk.has(cheieSursa(b.sursa)) && decOk.has('accepta_neconformitate')
    if (b.neconformitate && !neconfAplicata) b.probleme.push(`neconformitate „${b.neconformitate}” — de decis (intră sau refuzat la recepție)`)
    // decizia de neconformitate (și carantina) pe un rând fără text de neconformitate = decizie pe rândul greșit (review #807 r5 02)
    if (!b.neconformitate && neconfOk.has(cheieSursa(b.sursa)))
      b.probleme.push(`accepta_neconformitate${neconfOk.get(cheieSursa(b.sursa)).carantina ? ' (carantină)' : ''} pe un rând fără neconformitate — de decis`)
    if (b.neconformitate && neconfAplicata) {
      const nota = neconfOk.get(cheieSursa(b.sursa)).nota
      b.nota_neconformitate = `NECONFORM: ${b.neconformitate}${nota ? ` — ${nota}` : ''}`
      b.carantina = neconfOk.get(cheieSursa(b.sursa)).carantina === true
    }
    // o dată completată dar necitită blochează (sold inițial: nu se ghicește, nu se pierde) — Copilot r2 P2
    if (b.data_aviz && typeof b.data_aviz === 'object') b.probleme.push(`data avizului necitită: ${b.data_aviz.invalid}`)
    if (b.greutate_kg !== null && b.greutate_kg <= 0) b.avertismente.push(`greutate ${b.greutate_kg} kg`)
    // datele care decid starea: o dată necitită nu se ghicește (review #807 P2)
    const pvValid = typeof b.pv_data === 'string', nrcdValid = typeof b.data_nrcd === 'string'
    if (b.pv_data && !pvValid) b.probleme.push(`data PV necitită: ${b.pv_data.invalid}`)
    if (b.data_nrcd && !nrcdValid) b.probleme.push(`data NRCD necitită: ${b.data_nrcd.invalid}`)
    if (b.data_iesire && typeof b.data_iesire === 'object') b.probleme.push(`data ieșirii necitită: ${b.data_iesire.invalid}`)
    // starea și locul
    if (b.aviz_iesire) {
      const ovSerie = decizii.tronson_aviz_serie?.[`${b.aviz_iesire}|${b.serie}`]
      const ovAviz = decizii.tronson_aviz?.[b.aviz_iesire]
      if (ovSerie != null) numara(`tas|${b.aviz_iesire}|${b.serie}`)
      if (ovAviz != null) numara(`ta|${b.aviz_iesire}`)
      const trExcel = b.tronson_iesire
      const trText = trExcel ? (trExcel.ambiguu ?? trExcel.nr) : null
      if (ovSerie != null) {
        // decizia pe bucată (aviz + serie) câștigă — cu urmă la ORICE aplicare (Copilot #807 r4 P2)
        b.corectii.push({ camp: 'tronson', inainte: trText, dupa: Number(ovSerie), motiv: 'tronson_aviz_serie' })
        b.tronson_iesire = { nr: Number(ovSerie), din_decizie: true }
      } else if (ovAviz != null) {
        if (!trExcel || trExcel.ambiguu) {
          b.corectii.push({ camp: 'tronson', inainte: trText, dupa: Number(ovAviz), motiv: 'tronson_aviz' })
          b.tronson_iesire = { nr: Number(ovAviz), din_decizie: true }
        }
        else if (trExcel.nr !== Number(ovAviz))
          b.probleme.push(`conflict tronson: Excel T${trExcel.nr}, decizia pe avizul ${b.aviz_iesire} T${ovAviz} — de decis pe bucată (tronson_aviz_serie)`)
      }
      // seria scrisă la ieșire trebuie să fie a rândului (brută sau corectată) — un aviz mutat pe alt rând nu trece
      if (b.ies_serie && serieCanon(b.ies_serie) !== serieCanon(b.serie) && serieCanon(b.ies_serie) !== serieCanon(b.serie_bruta))
        b.probleme.push(`seria la ieșire „${b.ies_serie}” ≠ seria rândului „${b.serie}”`)
      let nr = b.tronson_iesire?.nr ?? null
      if (b.tronson_iesire?.ambiguu) {
        const d = decizii.tronson_grup?.[b.tronson_iesire.ambiguu]
        if (d) nr = Number(d)
        else b.probleme.push(`tronson de ieșire ambiguu „${b.tronson_iesire.ambiguu}” — de decis`)
      }
      if (nr !== null) {
        const t = tronsoane[`T${nr}`]
        if (!t) b.probleme.push(`tronsonul T${nr} nu e pe proiect`)
        else { b.stare = 'pe_tronson'; b.tronson_id = t; b.tronson_cod = `T${nr}` }
      } else if (!b.tronson_iesire) b.probleme.push(`aviz de ieșire ${b.aviz_iesire} fără tronson`)
    } else {
      // câmpuri de ieșire completate fără aviz de ieșire = rând inconsistent (review #807 P1 / Gemini). În foi, seria și
      // cantitatea de la ieșire sunt precompletate cu ale rândului (verificat pe Excelurile din 20.10): contează doar
      // tronsonul, data sau o serie / cantitate DIFERITĂ de a rândului.
      const serieAlta = b.ies_serie && serieCanon(b.ies_serie) !== serieCanon(b.serie) && serieCanon(b.ies_serie) !== serieCanon(b.serie_bruta)
      const cantAlta = b.cant_iesire !== null && (b.cantitate === null || Math.abs(b.cant_iesire - b.cantitate) > 0.005)
      if (b.tronson_iesire || b.data_iesire || serieAlta || cantAlta)
        b.probleme.push('câmpuri de ieșire completate (tronson / dată / altă serie / altă cantitate) fără aviz de ieșire')
      // recepționat = PV (număr sau dată validă) SAU NRCD cu dată validă (review #807 P1)
      b.stare = b.pv_nr || pvValid || nrcdValid ? 'receptionat' : 'sosit'
      // carantina = stare pe server (registrul o tratează ca nedisponibilă), nu doar text
      if (b.carantina) b.stare = 'carantina'
    }
    if (b.carantina && b.aviz_iesire) b.probleme.push('bucată în carantină cu aviz de ieșire — de decis')
    // depozitul (sau originea, pentru cele de pe tronson) trebuie cunoscut în ORICE stare (review #807 P1)
    const dep = depozitPropus(b, coduri)
    if (dep.grup) {
      const dg = decizii.depozit_grup?.[dep.grup]
      const cod = dg && typeof dg === 'object' ? dg.cod : dg
      if (dg && typeof dg === 'object' && dg.nota) b.nota_depozit = dg.nota
      if (cod && coduri[cod]) { b.depozit_cod = cod; b.depozit_id = coduri[cod] }
      else { b.probleme.push(`depozit neclar: ${dep.grup} — de decis pe grup`); b.depozit_grup = dep.grup }
    } else { b.depozit_cod = dep.cod; b.depozit_id = dep.id }
    out.push(b)
  }
  // coliziuni în import: țeava pe serie canonică (R1 c), curbele pe serie + șarjă + unghi
  const vazute = new Map()
  for (const b of out) {
    const k = b.tip === 'teava' ? `T|${serieCanon(b.serie)}` : `C|${serieCanon(b.serie)}|${b.sarja}|${b.unghi}`
    if (vazute.has(k)) {
      const a = vazute.get(k)
      const m = `coliziune ${b.tip === 'teava' ? 'serie' : 'curbă'} cu ${a.sursa.foaie} r${a.sursa.rand}`
      b.probleme.push(m); a.probleme.push(`coliziune ${b.tip === 'teava' ? 'serie' : 'curbă'} cu ${b.sursa.foaie} r${b.sursa.rand}`)
    } else vazute.set(k, b)
  }
  // rândurile fără serie: excluse DOAR cu decizie explicită cu serie: null (seria de control a unui rând fără serie)
  const exclFaraSerie = f => { const e = exclDec.get(cheieSursa(f.sursa)); return !!e && 'serie' in e && !e.serie }
  for (const f of faraSerie) if (exclDec.has(cheieSursa(f.sursa))) {
    numara(`excluderi|${cheieSursa(f.sursa)}`)
    if (!exclFaraSerie(f)) globala(`excluderea rândului fără serie ${cheieSursa(f.sursa)} are seria de control „${exclDec.get(cheieSursa(f.sursa)).serie}” (trebuie null)`)
  }
  // fiecare decizie pe rând lovește EXACT un rând; deciziile pe avize cel puțin unul (review #807 r5 P1)
  for (const lista of LISTE_PE_RAND) for (const [i, e] of (decizii[lista] || []).entries()) {
    const n = contor.get(`${lista}|${cheieSursa(e)}`) || 0
    if (n !== 1) globala(`${lista}[${i}] (${cheieSursa(e)}): lovește ${n} rânduri, trebuie exact 1`)
  }
  for (const [i, c] of (decizii.corectii_camp || []).entries()) {
    if (c.randuri) for (const r of randuriCorectie(c)) {
      const n = contor.get(`cc|${i}|${r.rand}`) || 0
      if (n !== 1) globala(`corectii_camp[${i}] (${c.camp}, rândul ${r.rand}): lovește ${n} rânduri, trebuie exact 1`)
    } else if (!contor.get(`cc|${i}|aviz`)) globala(`corectii_camp[${i}] (${c.camp}, avize): nu lovește niciun rând`)
  }
  for (const k of Object.keys(decizii.tronson_aviz_serie || {})) {
    const n = contor.get(`tas|${k}`) || 0
    if (n !== 1) globala(`tronson_aviz_serie „${k}”: lovește ${n} rânduri, trebuie exact 1`)
  }
  for (const k of Object.keys(decizii.tronson_aviz || {})) if (!contor.get(`ta|${k}`)) globala(`tronson_aviz „${k}”: nu lovește niciun rând`)
  // rândurile fără serie dar cu material: blocante, cu excepția celor excluse explicit în decizii; plus deciziile malformate
  const blocante_globale = faraSerie.filter(f => !exclFaraSerie(f))
    .map(f => ({ sursa: f.sursa, problema: `rând fără serie, cu ${f.campuri.join(' / ')} completate` }))
    .concat(problemeCorectii(decizii).map(pr => ({ sursa: { fisier: '(decizii)', foaie: 'corectii_camp', rand: 0 }, problema: pr })))
    .concat(globale)
  for (const f of faraSerie) if (exclFaraSerie(f)) excluse.push({ sursa: f.sursa, serie: '', motiv: `decizie: ${exclDec.get(cheieSursa(f.sursa)).motiv}` })
  return { randuri: out, excluse, blocante_globale }
}

/** Payload-ul pentru fn_izo_import_sold_initial — doar când nu există nicio problemă blocantă. */
export function construiestePayload(randuri, surse, motiv, blocanteGlobale = []) {
  if (randuri.some(b => b.probleme.length) || blocanteGlobale.length) throw new Error('preview neaplicabil: există rânduri cu probleme blocante')
  return {
    motiv, surse,
    bucati: randuri.map(b => ({
      tip: b.tip, serie: b.serie, sarja: b.sarja, lungime_mm: b.tip === 'teava' ? b.lungime_mm : undefined,
      perete_mm: b.perete_mm, diametru_mm: 610, unghi_curba: b.tip === 'curba' ? b.unghi : undefined,
      // locul exclusiv (review #806 D): pe tronson doar tronson_id; depozitul din care a plecat merge ca depozit_origine_id
      stare: b.stare, tronson_id: b.tronson_id ?? undefined,
      depozit_id: b.stare === 'pe_tronson' ? undefined : (b.depozit_id ?? undefined),
      depozit_origine_id: b.stare === 'pe_tronson' ? (b.depozit_id ?? undefined) : undefined,
      // izolația DOAR din descriere (Copilot r2 P2): PEHD / neizolată când e scris; altfel necunoscută (NULL), nu ghicită
      izolatie: /HDPE|PEHD/i.test(b.descriere) ? 'PEHD' : (/\bneizolat/i.test(b.descriere) ? 'neizolata' : undefined),
      izolatie_text: /HDPE B3/i.test(b.descriere) ? 'HDPE B3' : undefined,
      grad_otel: /L360NE/i.test(b.descriere) ? 'L360NE' : undefined, standard: /3183/.test(b.descriere) ? 'SR EN ISO 3183 PSL2' : undefined,
      greutate_kg: b.greutate_kg ?? undefined, nr_aviz: b.nr_aviz ?? undefined,
      data_aviz: typeof b.data_aviz === 'string' ? b.data_aviz : undefined, gestiune: b.gestiune || undefined, dt_os: b.dt_os || undefined,
      aviz_iesire: b.aviz_iesire ? { nr: b.aviz_iesire, data: typeof b.data_iesire === 'string' ? b.data_iesire : null, serie: b.ies_serie || null } : undefined,
      pv_receptie: b.pv_nr || typeof b.pv_data === 'string' ? { nr: b.pv_nr || null, data: typeof b.pv_data === 'string' ? b.pv_data : null } : undefined,
      nrcd: typeof b.data_nrcd === 'string' ? { data: b.data_nrcd } : undefined,
      descriere: b.descriere,
      observatii: [b.nota_neconformitate, b.nota_corectie, b.nota_depozit, b.obs].filter(Boolean).join(' · ') || undefined,
      sursa: { ...b.sursa, serie_bruta: b.serie_bruta !== b.serie ? b.serie_bruta : undefined,
               sarja_bruta: b.sarja_bruta && b.sarja_bruta !== b.sarja ? b.sarja_bruta : undefined,
               corectii: b.corectii?.length ? b.corectii : undefined },
    })),
  }
}
