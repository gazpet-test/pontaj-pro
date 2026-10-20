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
    if (l >= 1 && l <= 12 && z >= 1 && z <= 31) return `${a}-${String(l).padStart(2, '0')}-${String(z).padStart(2, '0')}`
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
 * Citește o foaie. Întoarce rânduri normalizate (fără decizii aplicate) + excluderile numărate.
 * opt: { fisier (numele), foaie, rows, sha256 }
 */
export function citesteFoaie({ fisier, foaie, rows }) {
  const def = FOI[foaie]
  if (!def) return { necunoscuta: true, randuri: [], excluse: [] }
  const L = LAYOUT[def.layout]
  const randuri = [], excluse = []
  for (let i = L.start; i < rows.length; i++) {
    const r = rows[i] || []
    const rand = i + 1
    const serieBruta = txt(r[L.serie])
    if (!serieBruta) continue
    const sursa = { fisier, foaie, rand }
    const descriere = txt(r[L.desc])
    const gestiune = txt(r[L.gestiune]).toUpperCase()
    const dtos = txt(r[L.dtos]).toUpperCase()
    const neconf = L.neconf !== undefined ? txt(r[L.neconf]) : ''
    const iesAviz = txt(r[L.iesAviz]).toUpperCase()
    const tr = tronsonIesire(r[L.iesTr])
    const pvNr = txt(r[L.pvNr])
    const pvData = dataExcel(r[L.pvData] ?? (L.dataRec !== undefined ? r[L.dataRec] : null))
    const b = {
      sursa, tip: def.tip, serie_bruta: serieBruta, sarja: txt(r[L.sarja]).toUpperCase() || null, descriere,
      greutate_kg: num(r[L.kg]), nr_aviz: txt(r[L.nrAviz]) || null, data_aviz: dataExcel(r[L.dataAviz]),
      cantitate: num(r[L.cant]), gestiune, dt_os: dtos, neconformitate: neconf || null, aviz_iesire: iesAviz || null,
      tronson_iesire: tr, cant_iesire: num(r[L.iesCant]), debitare: L.debitare !== undefined ? num(r[L.debitare]) : null,
      cant_in_dm: L.inDm !== undefined ? num(r[L.inDm]) : null, pv_nr: pvNr || null, pv_data: pvData,
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
  return { randuri, excluse }
}

// depozitul propus: Jupânești → JUP; Topleț → ORN pentru DT/OS „ORSOVA” sau avize CJPT-O, TOP pentru „TOPLET”
export function depozitPropus(b, coduri) {
  const f = FOI[b.sursa.foaie]?.fisier
  if (f === 'jupanesti') return b.dt_os === 'DM JUPANESTI' ? { cod: 'JUP', id: coduri.JUP } : { grup: `Jupânești · DT/OS „${b.dt_os || '—'}”` }
  if (/^CJPT-O/.test(b.aviz_iesire || '') || b.dt_os === 'ORSOVA') return { cod: 'ORN', id: coduri.ORN }
  if (b.dt_os === 'TOPLET') return { cod: 'TOP', id: coduri.TOP }
  return { grup: `Topleț · DT/OS „${b.dt_os || '—'}”` }
}

/**
 * Aplică deciziile și calculează pentru fiecare rând: starea, locul, peretele, problemele blocante.
 * decizii: { corectii_serie: {brut: corect}, excluderi: [{fisier, foaie, rand, motiv}], depozit_grup: {grup: COD},
 *            tronson_grup: {text: nr}, accepta_neconformitate: [{fisier, foaie, rand}], accepta_sarja: [serie] }
 */
export function evalueaza(randuri, { decizii = {}, coduri, tronsoane }) {
  const cheieSursa = s => `${s.fisier}|${s.foaie}|${s.rand}`
  const exclDec = new Map((decizii.excluderi || []).map(e => [cheieSursa(e), e.motiv]))
  const neconfOk = new Set((decizii.accepta_neconformitate || []).map(cheieSursa))
  const out = [], excluse = []
  for (const b0 of randuri) {
    const b = { ...b0, probleme: [], avertismente: [] }
    if (exclDec.has(cheieSursa(b.sursa))) { excluse.push({ sursa: b.sursa, serie: b.serie, motiv: `decizie: ${exclDec.get(cheieSursa(b.sursa))}` }); continue }
    // seria
    if (b.tip === 'teava') {
      const corect = decizii.corectii_serie?.[b.serie_bruta.toUpperCase()]
      if (corect) { b.serie = corect.toUpperCase(); b.serie_corectata_din = b.serie_bruta }
      else if (b.clasa_serie === 'conflict_2545CA') b.probleme.push(`serie „${b.serie_bruta}” (2545CA, propunere ${b.propunere_serie}) — de decis`)
      else if (b.clasa_serie === 'format') b.probleme.push(`serie „${b.serie_bruta}” în afara formatului 999AA99999`)
      if (b.lungime_mm === null || b.lungime_mm <= 0 || b.lungime_mm > 13000) b.probleme.push(`lungime invalidă (${b.cantitate})`)
      // peretele: din foaie, verificat cu descrierea
      if (b.perete_desc !== null && b.perete_desc !== b.perete_foaie) b.probleme.push(`perete: foaia spune ${b.perete_foaie}, descrierea ${b.perete_desc}`)
      b.perete_mm = b.perete_foaie ?? b.perete_desc
      if (b.cant_iesire !== null && b.cantitate !== null && Math.abs(b.cant_iesire - b.cantitate) > 0.005)
        b.avertismente.push(`cantitatea la ieșire ${b.cant_iesire} ≠ aviz ${b.cantitate}`)
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
    if (b.neconformitate && !neconfOk.has(cheieSursa(b.sursa))) b.probleme.push(`neconformitate „${b.neconformitate}” — de decis (intră sau refuzat la recepție)`)
    if (b.data_aviz && typeof b.data_aviz === 'object') b.avertismente.push(`data avizului necitită: ${b.data_aviz.invalid}`)
    // starea și locul
    if (b.aviz_iesire) {
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
      b.stare = b.pv_nr || (b.pv_data && typeof b.pv_data === 'string') ? 'receptionat' : 'sosit'
    }
    const dep = depozitPropus(b, coduri)
    if (dep.grup) {
      const cod = decizii.depozit_grup?.[dep.grup]
      if (cod && coduri[cod]) { b.depozit_cod = cod; b.depozit_id = coduri[cod] }
      else if (b.stare !== 'pe_tronson') b.probleme.push(`depozit neclar: ${dep.grup} — de decis pe grup`)
      else b.depozit_grup = dep.grup
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
  return { randuri: out, excluse }
}

/** Payload-ul pentru fn_izo_import_sold_initial — doar când nu există nicio problemă blocantă. */
export function construiestePayload(randuri, surse, motiv) {
  if (randuri.some(b => b.probleme.length)) throw new Error('preview neaplicabil: există rânduri cu probleme blocante')
  return {
    motiv, surse,
    bucati: randuri.map(b => ({
      tip: b.tip, serie: b.serie, sarja: b.sarja, lungime_mm: b.tip === 'teava' ? b.lungime_mm : undefined,
      perete_mm: b.perete_mm, diametru_mm: 610, unghi_curba: b.tip === 'curba' ? b.unghi : undefined,
      // locul exclusiv (review #806 D): pe tronson doar tronson_id; depozitul din care a plecat merge ca depozit_origine_id
      stare: b.stare, tronson_id: b.tronson_id ?? undefined,
      depozit_id: b.stare === 'pe_tronson' ? undefined : (b.depozit_id ?? undefined),
      depozit_origine_id: b.stare === 'pe_tronson' ? (b.depozit_id ?? undefined) : undefined,
      izolatie: /HDPE|PEHD/i.test(b.descriere) ? 'PEHD' : 'neizolata', izolatie_text: /HDPE B3/i.test(b.descriere) ? 'HDPE B3' : undefined,
      grad_otel: /L360NE/i.test(b.descriere) ? 'L360NE' : undefined, standard: /3183/.test(b.descriere) ? 'SR EN ISO 3183 PSL2' : undefined,
      greutate_kg: b.greutate_kg ?? undefined, nr_aviz: b.nr_aviz ?? undefined,
      data_aviz: typeof b.data_aviz === 'string' ? b.data_aviz : undefined, gestiune: b.gestiune || undefined, dt_os: b.dt_os || undefined,
      aviz_iesire: b.aviz_iesire ?? undefined, pv_receptie: b.pv_nr ? { nr: b.pv_nr, data: typeof b.pv_data === 'string' ? b.pv_data : null } : undefined,
      descriere: b.descriere, observatii: b.obs ?? undefined,
      sursa: { ...b.sursa, serie_bruta: b.serie_bruta !== b.serie ? b.serie_bruta : undefined },
    })),
  }
}
