// ════════════════════════════════════════════════════════════════════════
// IZOMETRIE E3 — documentele de intrare (aviz țeavă / listă de ambalare curbe): logica pură a ecranului
// ════════════════════════════════════════════════════════════════════════
// Folosit de src/IzoDocumenteIntrare.jsx (Magazie → 🧾 Documente de intrare). Fără BD, fără React: seria canonică,
// numerele (format furnizor / RO), validarea rândurilor, toleranțele, confuziile de caractere, totalurile, lipirea din
// Excel și argumentele RPC-urilor E3 (design r4: fn_izo_doc_salveaza / _verifica / _confirma / _pv).
// Serverul recalculează TOT la confirmare (design §7) — verificările de aici ajută gestionarul, nu sunt frontiera.

export const SABLOANE = {
  aviz_teava: {
    label: 'Aviz țeavă', emoji: '🧱',
    antet: [['cumparator', 'Cumpărător'], ['transport_nr', 'Nr. transport'], ['nume_proiect', 'Proiect (pe aviz)'], ['lot', 'Lot'],
      ['loc_livrare', 'Loc livrare'], ['data_incarcare', 'Data încărcării', 'date'], ['data_descarcare', 'Data descărcării', 'date'], ['nr_camion', 'Nr. camion']],
    totaluri: [['total_m', 'Total metri', 'm'], ['total_kg', 'Total kg', 'kg']],
  },
  lista_ambalare_curbe: {
    label: 'Listă de ambalare curbe', emoji: '↪️',
    antet: [['factura', 'Factura'], ['importator', 'Importator'], ['destinatar', 'Destinatar'], ['referinta_client', 'Referința clientului'],
      ['referinta_furnizor', 'Referința furnizorului'], ['placa_camion_container', 'Camion / container']],
    totaluri: [['total_bucati', 'Total bucăți', 'int'], ['total_pachete', 'Total pachete', 'int'], ['total_net_kg', 'Net kg', 'kg'], ['total_brut_kg', 'Brut kg (dacă e scris)', 'kg']],
  },
}
export const esteCurba = sablon => sablon === 'lista_ambalare_curbe'

export const DECIZII = [
  { cheie: 'primit', label: 'Primit' },
  { cheie: 'primit_neconform', label: 'Neconform → carantină' },
  { cheie: 'refuzat_la_receptie', label: 'Refuzat' },
]

// coloanele rândului, pe șablon: [câmp, etichetă, tip] — aceeași ordine în tabel și la lipirea fără antet
export const COLOANE = {
  aviz_teava: [['nr_crt', 'Nr.', 'int'], ['serie', 'Nr. țeavă', 'txt'], ['sarja', 'Șarjă', 'txt'], ['lot', 'Lot', 'txt'],
    ['lungime_doc', 'L aviz (m)', 'm'], ['lungime_masurata', 'L măsurat (m)', 'm'], ['greutate_kg', 'Kg', 'kg'],
    ['perete_mm', 'Perete', 'zec'], ['diametru_mm', 'Diam.', 'zec'], ['specificatie', 'Specificație', 'txt']],
  lista_ambalare_curbe: [['nr_crt', 'Nr.', 'int'], ['serie', 'Bend no.', 'txt'], ['sarja', 'Heat (șarjă)', 'txt'], ['cod', 'Cod', 'txt'],
    ['item', 'Item', 'txt'], ['diametru_mm', 'Diam.', 'zec'], ['perete_mm', 'Perete', 'zec'], ['unghi_doc', 'Unghi listă (°)', 'zec'],
    ['unghi_masurat', 'Unghi măsurat (°)', 'zec'], ['standard', 'Standard', 'txt'], ['cantitate', 'Buc', 'int'], ['pachet_nr', 'Pachet', 'txt'],
    ['dimensiuni_cm', 'Dim. pachet (cm)', 'txt'], ['net_kg', 'Net kg', 'kg'], ['brut_kg', 'Brut kg', 'kg'], ['specificatie', 'Descriere', 'txt']],
}
// lipirea fără rând de antet: ordinea coloanelor de pe documentele reale (aviz: Nr. Crt · Nr Teava · Specificatia · Nr Sarja ·
// Nr Lot · Cantitate livrata (m) · Greutate (kg); listă: BEND NUMBER · CODE · PIPE HEAT NUMBER · ITEM · SIZE · WALL THICKNESS ·
// DESCRIPTION · DEGREE · SIZE-MATERIAL STD · QUANTITY (PCS) · PACKING NO · DIMENSIONS CM · NET KG · GROSS KG)
export const ORDINE_DOCUMENT = {
  aviz_teava: ['nr_crt', 'serie', 'specificatie', 'sarja', 'lot', 'lungime_doc', 'greutate_kg', 'lungime_masurata'],
  lista_ambalare_curbe: ['serie', 'cod', 'sarja', 'item', 'diametru_mm', 'perete_mm', 'specificatie', 'unghi_doc', 'standard', 'cantitate',
    'pachet_nr', 'dimensiuni_cm', 'net_kg', 'brut_kg', 'unghi_masurat'],
}
// ordinea scurtă (mai puține coloane decât documentul): doar ce se citește de obicei de pe hârtie
export const ORDINE_SCURTA = {
  aviz_teava: ['serie', 'sarja', 'lot', 'lungime_doc', 'greutate_kg', 'lungime_masurata'],
  lista_ambalare_curbe: ['serie', 'sarja', 'unghi_doc', 'perete_mm', 'net_kg', 'brut_kg', 'pachet_nr', 'unghi_masurat'],
}

// toleranțele măsurat ↔ document (Q-E3-4, decizia Razvan 21.10): la prag exact NU e avertisment (design §7)
export const TOL_LUNGIME_MM = 10
export const TOL_UNGHI = 0.5
// intervalele fizice verificate și de server la confirmare (design §7)
export const LUNGIME_MIN_MM = 1, LUNGIME_MAX_MM = 30000

const txt = v => { const s = v == null ? '' : String(v).trim(); return s || null }
const normAntet = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

// ── seria ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Seria canonică = expresia coloanei generate E2a: upper(regexp_replace(serie, '[[:space:]._/-]', '', 'g')). */
export const serieCanon = s => String(s ?? '').toUpperCase().replace(/[\s._/-]/g, '')
// formatul seriei de țeavă Transgaz: 3 cifre, 2 litere, 5 cifre (ex. 247EK08603)
export const FORMAT_SERIE = /^\d{3}[A-Z]{2}\d{5}$/
const CIFRA_DIN_LITERA = { S: '5', O: '0', I: '1', B: '8' }
const LITERA_DIN_CIFRA = { 5: 'S', 0: 'O', 1: 'I', 8: 'B' }

/**
 * Seria de țeavă față de formatul 999AA99999 + caracterele ușor de confundat (5/S, 0/O, 1/I, 8/B) puse în poziția greșită.
 * Întoarce { canon, formatOk, confuzii: [{poz, gasit, propus}], sugestie } — sugestia doar dacă, corectată, seria are formatul.
 */
export function verificaSerie(serie) {
  const canon = serieCanon(serie)
  const r = { canon, formatOk: FORMAT_SERIE.test(canon), confuzii: [], sugestie: null }
  if (r.formatOk || canon.length !== 10) return r
  let sug = ''
  for (let i = 0; i < 10; i++) {
    const ch = canon[i], cifra = i < 3 || i > 4
    const propus = cifra ? CIFRA_DIN_LITERA[ch] : LITERA_DIN_CIFRA[ch]
    if (propus) r.confuzii.push({ poz: i + 1, gasit: ch, propus })
    sug += propus || ch
  }
  if (r.confuzii.length && FORMAT_SERIE.test(sug)) r.sugestie = sug
  return r
}

/** Numerele care ar trebui să fie doar cifre (bend number, heat): literele S/O/I/B probabil citite greșit. */
export function confuziiNumerice(valoare) {
  const c = serieCanon(valoare)
  if (!c || !/^[0-9SOIB]+$/.test(c) || !/\d/.test(c) || !/[SOIB]/.test(c)) return null
  return c.replace(/[SOIB]/g, ch => CIFRA_DIN_LITERA[ch])
}

// ── numerele ──────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Număr din text, în ambele formate: furnizor (12.22, 20,318 = douăzeci de mii) și RO (12,22, 20 318).
 * Ambele separatoare → ultimul e zecimal. Doar virgula → zecimală, cu excepția `mii` (kilogramele): grupurile exacte de câte 3
 * cifre (1,342 / 20,318 / 1.342) sunt mii. Gol → null; nenumeric → NaN (validarea îl arată, nu se pierde tăcut).
 */
export function parseNumar(v, { mii = false } = {}) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
  let s = String(v).trim().replace(/[\s  ']/g, '')
  if (!s) return null
  const virg = s.lastIndexOf(','), punct = s.lastIndexOf('.')
  if (virg >= 0 && punct >= 0) {
    const zec = virg > punct ? ',' : '.'
    s = s.split(zec === ',' ? '.' : ',').join('').replace(zec, '.')
  } else if (virg >= 0 || punct >= 0) {
    const sep = virg >= 0 ? ',' : '.'
    if (mii && new RegExp(`^-?\\d{1,3}(\\${sep}\\d{3})+$`).test(s)) s = s.split(sep).join('')
    else if (sep === ',') s = s.split(',').length > 2 ? 'x' : s.replace(',', '.')
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN
}
const esteNr = x => typeof x === 'number' && Number.isFinite(x)
const rot = (x, z) => (esteNr(x) ? Math.round(x * 10 ** z) / 10 ** z : x)
/** metri (text) → mm întregi */
export const mmDinM = v => { const x = parseNumar(v); return esteNr(x) ? Math.round(x * 1000) : x }
/** pentru câmpurile editorului: număr → text cu virgulă (convenția RO din ERP) */
export function textNr(x, zecimale = null) {
  if (x == null || x === '' || Number.isNaN(Number(x))) return ''
  const n = Number(x)
  return (zecimale == null ? String(n) : n.toFixed(zecimale)).replace('.', ',')
}
/** mm → metri pentru afișare: 2 zecimale, 3 dacă mm nu e multiplu de 10 */
export const mDinMm = mm => (mm == null || !esteNr(Number(mm)) ? '' : textNr(Number(mm) / 1000, Number(mm) % 10 ? 3 : 2))
export const fmtNr = (n, z = 2) => (n == null || !esteNr(Number(n)) ? '—' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: z, maximumFractionDigits: z }))

// ── rândurile ─────────────────────────────────────────────────────────────────────────────────────────────
/** Rând gol pentru editor (câmpurile = text). Perete / diametru / lot / șarjă se preiau din rândul de deasupra. */
export function randGol(sablon, nrCrt, prev = null) {
  const r = { nr_crt: String(nrCrt), serie: '', sarja: prev?.sarja || '', lot: prev?.lot || '', lungime_doc: '', lungime_masurata: '', greutate_kg: '',
    perete_mm: prev?.perete_mm || '', diametru_mm: prev?.diametru_mm || '', specificatie: prev?.specificatie || '', cod: '', item: prev?.item || '',
    unghi_doc: '', unghi_masurat: '', standard: prev?.standard || '', cantitate: esteCurba(sablon) ? '1' : '', pachet_nr: '', dimensiuni_cm: '',
    net_kg: '', brut_kg: '', decizie: 'primit', motiv: '', observatie: '' }
  return r
}

/** Rândul editorului → valorile tipizate (mm întregi, kg / unghi cu o zecimală). NaN rămâne NaN (îl prinde validarea). */
export function randNormalizat(r, sablon) {
  const curba = esteCurba(sablon)
  const n = (v, o) => parseNumar(v, o)
  return {
    nr_crt: n(r.nr_crt), serie: txt(r.serie), serie_canon: serieCanon(r.serie) || null, sarja: txt(r.sarja), lot: curba ? null : txt(r.lot),
    specificatie: txt(r.specificatie), greutate_kg: curba ? null : rot(n(r.greutate_kg, { mii: true }), 1),
    lungime_doc_mm: curba ? null : mmDinM(r.lungime_doc), lungime_masurata_mm: curba ? null : mmDinM(r.lungime_masurata),
    perete_mm: rot(n(r.perete_mm), 2), diametru_mm: rot(n(r.diametru_mm), 1),
    unghi_doc: curba ? rot(n(r.unghi_doc), 1) : null, unghi_masurat: curba ? rot(n(r.unghi_masurat), 1) : null,
    cod: curba ? txt(r.cod) : null, item: curba ? txt(r.item) : null, standard: curba ? txt(r.standard) : null,
    cantitate: curba ? (n(r.cantitate) ?? 1) : null, pachet_nr: curba ? txt(r.pachet_nr) : null, dimensiuni_cm: curba ? txt(r.dimensiuni_cm) : null,
    net_kg: curba ? rot(n(r.net_kg, { mii: true }), 1) : null, brut_kg: curba ? rot(n(r.brut_kg, { mii: true }), 1) : null,
    decizie: r.decizie || null, motiv: txt(r.motiv), observatie: txt(r.observatie),
  }
}
/** lungimea bucății în registru (Q-E3-5 A): cea măsurată dacă există, altfel cea din document */
export const lungimeRegistruMm = rn => (esteNr(rn.lungime_masurata_mm) ? rn.lungime_masurata_mm : rn.lungime_doc_mm)

const CAMPURI_NUMERICE = { nr_crt: 'nr. crt.', lungime_doc_mm: 'lungimea de pe document', lungime_masurata_mm: 'lungimea măsurată', greutate_kg: 'greutatea',
  perete_mm: 'peretele', diametru_mm: 'diametrul', unghi_doc: 'unghiul de pe listă', unghi_masurat: 'unghiul măsurat', cantitate: 'cantitatea',
  net_kg: 'greutatea netă', brut_kg: 'greutatea brută' }
const blocant = (camp, mesaj) => ({ camp, nivel: 'blocant', mesaj })
const avert = (camp, mesaj) => ({ camp, nivel: 'avertisment', mesaj })

/** Verificările unui rând: [{camp, nivel: blocant|avertisment, mesaj}]. */
export function validareRand(rn, sablon) {
  const curba = esteCurba(sablon), v = []
  for (const [c, et] of Object.entries(CAMPURI_NUMERICE)) if (Number.isNaN(rn[c])) v.push(blocant(c, `${et} nu e un număr`))
  if (esteNr(rn.nr_crt) && (rn.nr_crt <= 0 || !Number.isInteger(rn.nr_crt))) v.push(blocant('nr_crt', 'nr. crt. trebuie să fie întreg > 0'))
  if (!rn.serie) v.push(blocant('serie', curba ? 'lipsește bend number' : 'lipsește nr. țevii'))
  else if (!curba) {
    const s = verificaSerie(rn.serie)
    if (s.sugestie) v.push(avert('serie', `seria pare citită greșit: ${s.confuzii.map(c => `poz. ${c.poz} „${c.gasit}” → „${c.propus}”`).join(', ')} (propus ${s.sugestie})`))
    else if (!s.formatOk) v.push(avert('serie', `seria ${s.canon} nu are formatul 999AA99999`))
  } else {
    const p = confuziiNumerice(rn.serie)
    if (p) v.push(avert('serie', `bend number cu litere ușor de confundat (5/S, 0/O, 1/I, 8/B) — poate ${p}?`))
  }
  if (curba && rn.sarja) { const p = confuziiNumerice(rn.sarja); if (p) v.push(avert('sarja', `heat cu litere ușor de confundat — poate ${p}?`)) }
  if (!DECIZII.some(d => d.cheie === rn.decizie)) v.push(blocant('decizie', 'alege decizia (primit / neconform / refuzat)'))
  if ((rn.decizie === 'refuzat_la_receptie' || rn.decizie === 'primit_neconform') && !rn.motiv) v.push(blocant('motiv', rn.decizie === 'refuzat_la_receptie' ? 'refuzul cere motiv' : 'neconformitatea cere motiv'))
  const inInterval = (x, camp, et) => { if (esteNr(x) && (x < LUNGIME_MIN_MM || x > LUNGIME_MAX_MM)) v.push(blocant(camp, `${et} în afara intervalului 0,001–30 m`)) }
  // diferența peste toleranță cere o explicație: observația, sau motivul unui rând neconform / refuzat
  const explicat = !!rn.observatie || ((rn.decizie === 'primit_neconform' || rn.decizie === 'refuzat_la_receptie') && !!rn.motiv)
  let pesteTol = false
  if (!curba) {
    if (rn.lungime_doc_mm == null) v.push(blocant('lungime_doc_mm', 'lipsește lungimea de pe aviz'))
    inInterval(rn.lungime_doc_mm, 'lungime_doc_mm', 'lungimea de pe aviz')
    inInterval(rn.lungime_masurata_mm, 'lungime_masurata_mm', 'lungimea măsurată')
    if (esteNr(rn.lungime_doc_mm) && esteNr(rn.lungime_masurata_mm)) {
      const d = rn.lungime_masurata_mm - rn.lungime_doc_mm
      if (Math.abs(d) > TOL_LUNGIME_MM) {
        pesteTol = true
        const t = `măsurat ${mDinMm(rn.lungime_masurata_mm)} m față de ${mDinMm(rn.lungime_doc_mm)} m pe aviz (${d > 0 ? '+' : ''}${d} mm, peste ±${TOL_LUNGIME_MM} mm)`
        v.push(explicat ? avert('lungime_masurata_mm', t) : blocant('observatie', `${t} — scrie observația`))
      }
    }
    if (rn.greutate_kg == null) v.push(avert('greutate_kg', 'lipsește greutatea (intră în totalul de kg)'))
  } else {
    if (rn.unghi_doc == null) v.push(blocant('unghi_doc', 'lipsește unghiul de pe listă'))
    for (const [c, et] of [['unghi_doc', 'unghiul de pe listă'], ['unghi_masurat', 'unghiul măsurat']]) if (esteNr(rn[c]) && (rn[c] <= 0 || rn[c] > 90)) v.push(blocant(c, `${et} trebuie să fie între 0 și 90°`))
    if (esteNr(rn.unghi_doc) && esteNr(rn.unghi_masurat)) {
      const d = Math.round((rn.unghi_masurat - rn.unghi_doc) * 10) / 10
      if (Math.abs(d) > TOL_UNGHI) {
        pesteTol = true
        const t = `măsurat ${textNr(rn.unghi_masurat)}° față de ${textNr(rn.unghi_doc)}° pe listă (peste ±${textNr(TOL_UNGHI)}°)`
        v.push(explicat ? avert('unghi_masurat', t) : blocant('observatie', `${t} — scrie observația`))
      }
    }
    if (esteNr(rn.cantitate) && rn.cantitate !== 1) v.push(blocant('cantitate', 'o curbă pe rând (cantitatea 1); pune fiecare curbă pe rândul ei'))
    if (rn.net_kg == null) v.push(avert('net_kg', 'lipsește greutatea netă (intră în total)'))
    const cod = verificaCodCurba(rn)
    if (cod) v.push(avert('cod', cod))
  }
  for (const [c, et] of [['perete_mm', 'peretele'], ['diametru_mm', 'diametrul']]) if (esteNr(rn[c]) && rn[c] <= 0) v.push(blocant(c, `${et} trebuie > 0`))
  if (rn.perete_mm == null) v.push(avert('perete_mm', 'lipsește peretele (7,1 / 8,8 — împarte stocul)'))
  if (rn.decizie === 'primit' && pesteTol)
    v.push(avert('decizie', 'diferență peste toleranță: dacă bucata e neconformă, alege „Neconform → carantină”'))
  return v
}

/** Codul curbei (ex. 9006-610-8,8-45-6100-9990003-3 = bend-diametru-perete-unghi-?-heat-item) față de câmpurile rândului. */
export function verificaCodCurba(rn) {
  if (!rn.cod) return null
  const p = rn.cod.split('-')
  if (p.length !== 7) return null
  const dif = []
  const cmpNr = (a, b, et) => { const x = parseNumar(a); if (esteNr(x) && esteNr(b) && Math.abs(x - b) > 1e-9) dif.push(`${et} ${a}`) }
  if (rn.serie_canon && serieCanon(p[0]) !== rn.serie_canon) dif.push(`bend ${p[0]}`)
  cmpNr(p[1], rn.diametru_mm, 'diametru')
  cmpNr(p[2], rn.perete_mm, 'perete')
  cmpNr(p[3], rn.unghi_doc, 'unghi')
  if (rn.sarja && serieCanon(p[5]) !== serieCanon(rn.sarja)) dif.push(`heat ${p[5]}`)
  if (rn.item && serieCanon(p[6]) !== serieCanon(rn.item)) dif.push(`item ${p[6]}`)
  return dif.length ? `codul spune ${dif.join(', ')} — nu bate cu rândul` : null
}

// ── documentul ────────────────────────────────────────────────────────────────────────────────────────────
const m2 = mm => Math.round(mm) / 1000
const egalZ = (a, b, z) => Math.round(a * 10 ** z) === Math.round(b * 10 ** z)

/** Totalurile calculate din rânduri (rândurile refuzate INCLUSE — D#14) și comparația cu cele de pe document. */
export function totaluriDocument(sablon, antet, randuriNorm) {
  const curba = esteCurba(sablon), nr = (v, o) => parseNumar(v, o)
  const s = { randuri: randuriNorm.length, primit: 0, neconform: 0, refuzat: 0, m_doc_mm: 0, m_primit_mm: 0, m_real_mm: 0, m_neconform_mm: 0,
    kg: 0, bucati: 0, pachete: 0, net: 0, brut: 0, brut_complet: true }
  const pachete = new Set()
  for (const r of randuriNorm) {
    if (r.decizie === 'primit') s.primit++
    else if (r.decizie === 'primit_neconform') s.neconform++
    else if (r.decizie === 'refuzat_la_receptie') s.refuzat++
    if (!curba) {
      if (esteNr(r.lungime_doc_mm)) s.m_doc_mm += r.lungime_doc_mm
      if (esteNr(r.greutate_kg)) s.kg += r.greutate_kg
      if (r.decizie === 'primit' && esteNr(r.lungime_doc_mm)) { s.m_primit_mm += r.lungime_doc_mm; s.m_real_mm += lungimeRegistruMm(r) }
      if (r.decizie === 'primit_neconform' && esteNr(lungimeRegistruMm(r))) s.m_neconform_mm += lungimeRegistruMm(r)
    } else {
      s.bucati += esteNr(r.cantitate) ? r.cantitate : 0
      if (r.pachet_nr) pachete.add(serieCanon(r.pachet_nr))
      if (esteNr(r.net_kg)) s.net += r.net_kg
      if (esteNr(r.brut_kg)) s.brut += r.brut_kg; else s.brut_complet = false
    }
  }
  s.pachete = pachete.size
  s.kg = rot(s.kg, 1); s.net = rot(s.net, 1); s.brut = rot(s.brut, 1)
  const cmp = []
  const doc = (camp, o) => { const x = nr(antet?.[camp], o); return x }
  const adauga = (cheie, label, calculat, document, z, fmt, optional = false) => {
    const lipsa = document == null
    const invalid = Number.isNaN(document)
    cmp.push({ cheie, label, calculat, document: lipsa || invalid ? null : document, fmt, optional,
      bate: lipsa ? (optional ? null : false) : invalid ? false : egalZ(calculat, document, z),
      mesaj: invalid ? 'nu e un număr' : lipsa ? (optional ? 'nescris pe document' : 'lipsește totalul de pe document') : null })
  }
  if (!curba) {
    adauga('total_m', 'Metri', m2(s.m_doc_mm), doc('total_m'), 3, 'm')
    adauga('total_kg', 'Kg', s.kg, doc('total_kg', { mii: true }), 1, 'kg')
  } else {
    adauga('total_bucati', 'Bucăți', s.bucati, doc('total_bucati'), 0, 'int')
    adauga('total_pachete', 'Pachete', s.pachete, doc('total_pachete'), 0, 'int')
    adauga('total_net_kg', 'Net kg', s.net, doc('total_net_kg', { mii: true }), 1, 'kg')
    adauga('total_brut_kg', 'Brut kg', s.brut, doc('total_brut_kg', { mii: true }), 1, 'kg', true)
  }
  return { ...s, comparatii: cmp }
}

/**
 * Toate verificările locale ale documentului din editor ({sablon, antet, randuri}).
 * Întoarce { norm, randuri: [[...] aliniat cu doc.randuri], document: [...], totaluri, blocante, avertismente }.
 */
export function validareDocument(doc) {
  const norm = (doc.randuri || []).map(r => randNormalizat(r, doc.sablon))
  const randuri = norm.map(rn => validareRand(rn, doc.sablon))
  const document = []
  if (!norm.length) document.push(blocant('randuri', 'documentul n-are niciun rând'))
  const vazut = new Map(), vazutNr = new Map()
  norm.forEach((rn, i) => {
    if (rn.serie_canon) {
      if (vazut.has(rn.serie_canon)) randuri[i].push(blocant('serie', `seria ${rn.serie_canon} apare de două ori în document (și pe rândul ${norm[vazut.get(rn.serie_canon)].nr_crt ?? vazut.get(rn.serie_canon) + 1})`))
      else vazut.set(rn.serie_canon, i)
    }
    if (esteNr(rn.nr_crt)) {
      if (vazutNr.has(rn.nr_crt)) randuri[i].push(blocant('nr_crt', `nr. crt. ${rn.nr_crt} e folosit de două ori`))
      else vazutNr.set(rn.nr_crt, i)
    } else if (rn.nr_crt == null) randuri[i].push(blocant('nr_crt', 'lipsește nr. crt.'))
  })
  for (const [camp, et] of [['furnizor', 'furnizorul'], ['nr_document', 'nr. documentului'], ['data_document', 'data documentului']])
    if (!txt(doc.antet?.[camp])) document.push(blocant(camp, `lipsește ${et}`))
  if (!doc.depozit_id) document.push(blocant('depozit_id', 'alege depozitul'))
  const totaluri = totaluriDocument(doc.sablon, doc.antet, norm)
  for (const c of totaluri.comparatii) if (c.bate === false) document.push(blocant(c.cheie, c.mesaj ? `${c.label}: ${c.mesaj}` : `${c.label}: rândurile dau ${c.calculat}, documentul spune ${c.document}`))
  const toate = [...document, ...randuri.flat()]
  return { norm, randuri, document, totaluri, blocante: toate.filter(x => x.nivel === 'blocant').length, avertismente: toate.filter(x => x.nivel === 'avertisment').length }
}

/** Ce oprește SALVAREA draftului (nu confirmarea): identitatea documentului, depozitul, numerele nenumerice, nr. crt. */
export function eroriSalvare(doc) {
  const e = []
  for (const [camp, et] of [['furnizor', 'furnizorul'], ['nr_document', 'nr. documentului'], ['data_document', 'data documentului']])
    if (!txt(doc.antet?.[camp])) e.push(`Completează ${et}.`)
  if (!doc.depozit_id) e.push('Alege depozitul.')
  for (const [camp, et, tip] of SABLOANE[doc.sablon]?.totaluri || []) if (Number.isNaN(parseNumar(doc.antet?.[camp], { mii: tip === 'kg' }))) e.push(`„${et}” nu e un număr.`)
  const nrs = new Set()
  ;(doc.randuri || []).forEach((r, i) => {
    const rn = randNormalizat(r, doc.sablon)
    const rau = Object.entries(CAMPURI_NUMERICE).filter(([c]) => Number.isNaN(rn[c])).map(([, et]) => et)
    if (rau.length) e.push(`Rândul ${r.nr_crt || i + 1}: ${rau.join(', ')} nu e număr.`)
    if (!esteNr(rn.nr_crt) || rn.nr_crt <= 0 || !Number.isInteger(rn.nr_crt)) e.push(`Rândul ${i + 1}: nr. crt. lipsește sau nu e întreg > 0.`)
    else if (nrs.has(rn.nr_crt)) e.push(`Nr. crt. ${rn.nr_crt} e folosit de două ori.`)
    else nrs.add(rn.nr_crt)
  })
  return e
}

/** Rezumatul recepției pe mai multe documente (ce ajunge în registru după confirmare). Metrii: de pe document și cu măsurătoarea. */
export function rezumatRegistru(docs) {
  const r = { disponibile: { n: 0, teava: 0, curbe: 0, m_doc: 0, m_real: 0 }, carantina: { n: 0, teava: 0, curbe: 0, m: 0 }, refuzate: 0 }
  let mDoc = 0, mReal = 0, mCar = 0
  for (const d of docs) {
    const curba = esteCurba(d.sablon)
    for (const rand of d.randuri) {
      const rn = rand.serie_canon !== undefined && rand.lungime_doc_mm !== undefined ? rand : randNormalizat(rand, d.sablon)
      if (rn.decizie === 'primit') {
        r.disponibile.n++; r.disponibile[curba ? 'curbe' : 'teava']++
        if (!curba) { mDoc += rn.lungime_doc_mm || 0; mReal += lungimeRegistruMm(rn) || 0 }
      } else if (rn.decizie === 'primit_neconform') {
        r.carantina.n++; r.carantina[curba ? 'curbe' : 'teava']++
        if (!curba) mCar += lungimeRegistruMm(rn) || 0
      } else if (rn.decizie === 'refuzat_la_receptie') r.refuzate++
    }
  }
  r.disponibile.m_doc = m2(mDoc); r.disponibile.m_real = m2(mReal); r.carantina.m = m2(mCar)
  return r
}

// ── lipirea din Excel (text separat cu tab) ───────────────────────────────────────────────────────────────
/** TSV ca din Excel: tab între celule, rânduri noi; celulele cu ghilimele pot conține tab / rând nou ("" = ghilimea). */
export function parseTsv(text) {
  const rows = [], s = String(text ?? '').replace(/\r\n?/g, '\n')
  let row = [], cel = '', i = 0, inGhil = false, start = true
  while (i < s.length) {
    const ch = s[i]
    if (inGhil) {
      if (ch === '"' && s[i + 1] === '"') { cel += '"'; i += 2; continue }
      if (ch === '"') { inGhil = false; i++; continue }
      cel += ch; i++; continue
    }
    if (ch === '"' && start) { inGhil = true; start = false; i++; continue }
    if (ch === '\t') { row.push(cel); cel = ''; start = true; i++; continue }
    if (ch === '\n') { row.push(cel); rows.push(row); row = []; cel = ''; start = true; i++; continue }
    cel += ch; start = false; i++
  }
  if (cel !== '' || row.length) { row.push(cel); rows.push(row) }
  return rows.filter(r => r.some(c => String(c).trim() !== ''))
}

// antetul coloanei → câmpul (textul e normalizat: fără diacritice, litere mici). Ordinea contează: „PIPE HEAT NUMBER” e șarjă,
// „SIZE-MATERIAL STD” e standard, „Cantitate livrata (m)” e lungime, „QUANTITY (PCS)” e cantitate.
const ALIAS = [
  ['nr_crt', /^(nr\.? ?crt\.?|crt\.?|nr\.?|poz\.?|pos\.?)$/],
  ['_masurat', /(masurat|measured)/],
  ['decizie', /decizi/], ['motiv', /motiv/], ['observatie', /^obs/],
  ['sarja', /(sarj|heat|charge)/],
  ['standard', /(\bstd\b|standard)/],
  ['net_kg', /\bnet\b/], ['brut_kg', /(brut|gross)/],
  ['pachet_nr', /(pachet|packing|package|pkg|colet)/],
  ['dimensiuni_cm', /(dimensiun|dimension|dims)/],
  ['perete_mm', /(perete|wall|grosime|thick)/],
  ['unghi_doc', /(unghi|degree|\bdeg\b|angle|grade)/],
  ['cod', /^(cod|code)\b/], ['item', /^item\b/],
  ['diametru_mm', /^(size|diametru|diam|dn|od)\b/],
  ['specificatie', /(specifica|descri)/],
  ['lungime_doc', /(lungime|length|\(m\)|livrat)/],
  ['cantitate', /(cantitate|quantity|qty|pcs|\bbuc)/],
  ['greutate_kg', /(greutate|weight|\bkg\b|masa)/],
  ['lot', /\blot\b/],
  ['serie', /(teav|pipe|tub|bend|serie|seria|number|\bnr\b)/],
]
export function campDinAntet(h, sablon) {
  const n = normAntet(h)
  if (!n) return null
  for (const [camp, re] of ALIAS) if (re.test(n)) {
    if (camp === '_masurat') return esteCurba(sablon) ? 'unghi_masurat' : 'lungime_masurata'
    return camp
  }
  return null
}
const DECIZIE_TEXT = v => { const n = normAntet(v); return /refuz/.test(n) ? 'refuzat_la_receptie' : /(neconf|carant)/.test(n) ? 'primit_neconform' : 'primit' }

/**
 * Textul lipit din Excel → rânduri de editor. Antetul (dacă există) decide coloanele; altfel ordinea documentului (sau cea scurtă,
 * când sunt mai puține coloane). Rândurile de total / goale se sar; la curbe pachetul și dimensiunile se completează în jos
 * (celulele unite din listă vin goale). Întoarce { randuri, coloane, antet, ignorate }.
 */
export function randuriDinLipire(text, sablon, { nrStart = 1 } = {}) {
  const rows = parseTsv(text)
  if (!rows.length) return { randuri: [], coloane: [], antet: false, ignorate: 0 }
  let coloane = null, antet = false, start = 0
  const hartaRand = r => r.map(c => campDinAntet(c, sablon))
  for (let i = 0; i < Math.min(rows.length, 3) && !coloane; i++) {
    const h = hartaRand(rows[i]), nevide = rows[i].filter(c => String(c).trim()).length
    const distincte = new Set(h.filter(Boolean)).size
    if (distincte >= 2 && distincte * 2 >= nevide) { coloane = h; antet = true; start = i + 1 }
  }
  if (!coloane) {
    const lat = Math.max(...rows.map(r => r.length))
    coloane = lat >= ORDINE_DOCUMENT[sablon].length - 1 ? ORDINE_DOCUMENT[sablon] : ORDINE_SCURTA[sablon]
  }
  const randuri = []
  let ignorate = 0, nr = nrStart, prevPachet = '', prevDim = ''
  for (const row of rows.slice(start)) {
    const r = randGol(sablon, nr)
    coloane.forEach((camp, j) => {
      if (!camp || row[j] == null) return
      const v = String(row[j]).replace(/\s+/g, ' ').trim()
      if (camp === 'decizie') { if (v) r.decizie = DECIZIE_TEXT(v) } else if (v || camp !== 'cantitate') r[camp] = v
    })
    const total = row.some(c => /^\s*total/i.test(String(c)))
    if (!r.serie.trim() || total) { ignorate++; continue }
    if (esteCurba(sablon)) {
      if (r.pachet_nr) { prevPachet = r.pachet_nr; prevDim = r.dimensiuni_cm || prevDim; if (!r.dimensiuni_cm) r.dimensiuni_cm = prevDim } else { r.pachet_nr = prevPachet; r.dimensiuni_cm = r.dimensiuni_cm || prevDim }
      if (!r.cantitate) r.cantitate = '1'
    }
    if (!coloane.includes('nr_crt') || !String(r.nr_crt).trim()) r.nr_crt = String(nr)
    nr = (parseNumar(r.nr_crt) || nr) + 1
    randuri.push(r)
  }
  return { randuri, coloane, antet, ignorate }
}

// ── încărcarea din BD (SELECT pe tabelele E3, filtrate de RLS) → editor ──────────────────────────────────────────
/** Rândul din izo_documente_intrare_randuri → rândul editorului (text). Acceptă și numele vechi din plan (lungime_*_m). */
export function randDinBd(r) {
  const mm = (a, b) => (a != null ? a : b != null ? Math.round(Number(b) * 1000) : null)
  const g = (x, z = null) => (x == null ? '' : textNr(x, z))
  return {
    nr_crt: r.nr_crt == null ? '' : String(r.nr_crt), serie: r.serie || '', sarja: r.sarja || '', lot: r.lot || '', specificatie: r.specificatie || '',
    lungime_doc: mDinMm(mm(r.lungime_doc_mm, r.lungime_doc_m)), lungime_masurata: mDinMm(mm(r.lungime_masurata_mm, r.lungime_masurata_m)),
    greutate_kg: g(r.greutate_kg), perete_mm: g(r.perete_mm), diametru_mm: g(r.diametru_mm), unghi_doc: g(r.unghi_doc), unghi_masurat: g(r.unghi_masurat),
    cod: r.cod || '', item: r.item == null ? '' : String(r.item), standard: r.standard || '', cantitate: r.cantitate == null ? '' : String(r.cantitate),
    pachet_nr: r.pachet_nr == null ? '' : String(r.pachet_nr), dimensiuni_cm: r.dimensiuni_cm || '', net_kg: g(r.net_kg), brut_kg: g(r.brut_kg),
    decizie: r.decizie || 'primit', motiv: r.motiv || '', observatie: r.observatie || '', bucata_id: r.bucata_id ?? null,
    avertismente_bd: r.avertismente || null,
  }
}
const CAMPURI_ANTET_COMUNE = ['furnizor', 'furnizor_cif', 'nr_document', 'data_document']
/** Antetul din izo_documente_intrare → câmpurile editorului (text). furnizor / nr_document cad pe forma canonică dacă lipsesc. */
export function antetDinBd(d) {
  const a = {}
  for (const c of [...CAMPURI_ANTET_COMUNE, ...Object.values(SABLOANE).flatMap(s => s.antet.map(x => x[0]))]) a[c] = d[c] == null ? '' : String(d[c])
  if (!a.furnizor && d.furnizor_canon) a.furnizor = d.furnizor_canon
  if (!a.nr_document && d.nr_document_canon) a.nr_document = d.nr_document_canon
  for (const s of Object.values(SABLOANE)) for (const [c] of s.totaluri) a[c] = d[c] == null ? '' : textNr(d[c])
  for (const c of ['data_document', 'data_incarcare', 'data_descarcare']) a[c] = a[c] ? a[c].slice(0, 10) : ''
  return a
}

// ── argumentele RPC-urilor (design r4 §1, §5, §7, §8) ───────────────────────────────────────────────────────
/** Rândul pentru p_randuri: valorile tipizate; fără bucata_id / avertismente (le pune serverul). */
export function randPentruRpc(rn, sablon) {
  const curba = esteCurba(sablon)
  const r = { nr_crt: rn.nr_crt, serie: rn.serie, sarja: rn.sarja, specificatie: rn.specificatie, perete_mm: rn.perete_mm, diametru_mm: rn.diametru_mm,
    decizie: rn.decizie, motiv: rn.motiv, observatie: rn.observatie }
  if (!curba) Object.assign(r, { lot: rn.lot, lungime_doc_mm: rn.lungime_doc_mm, lungime_masurata_mm: rn.lungime_masurata_mm, greutate_kg: rn.greutate_kg })
  else Object.assign(r, { cod: rn.cod, item: rn.item, unghi_doc: rn.unghi_doc, unghi_masurat: rn.unghi_masurat, standard: rn.standard,
    cantitate: rn.cantitate, pachet_nr: rn.pachet_nr, dimensiuni_cm: rn.dimensiuni_cm, net_kg: rn.net_kg, brut_kg: rn.brut_kg })
  for (const k of Object.keys(r)) if (Number.isNaN(r[k])) r[k] = null
  return r
}

/**
 * fn_izo_doc_salveaza(p_doc_id, p_versiune, p_antet, p_randuri) — creare (p_doc_id NULL, versiune NULL) sau editare cu CAS pe
 * `versiune`. Manifestul scanurilor (design §5: se schimbă doar prin salvare) merge în p_antet.scanuri (întrebare deschisă).
 */
export function argumenteSalveaza(doc) {
  const s = SABLOANE[doc.sablon]
  const a = doc.antet || {}
  const p_antet = { proiect_id: Number(doc.proiect_id), depozit_id: Number(doc.depozit_id), sablon: doc.sablon }
  for (const c of CAMPURI_ANTET_COMUNE) p_antet[c] = txt(a[c])
  for (const [c] of s.antet) p_antet[c] = txt(a[c])
  for (const [c, , tip] of s.totaluri) { const x = parseNumar(a[c], { mii: tip === 'kg' }); p_antet[c] = esteNr(x) ? x : null }
  if (!doc.id && doc.inlocuieste_document_id) p_antet.inlocuieste_document_id = Number(doc.inlocuieste_document_id)
  p_antet.scanuri = (doc.scanuri || []).map(x => ({ cale: x.cale, sha256_original: x.sha256_original, sha256_pdf: x.sha256_pdf, marime: x.marime, mime: x.mime }))
  return {
    p_doc_id: doc.id ?? null, p_versiune: doc.id ? doc.versiune ?? null : null, p_antet,
    p_randuri: (doc.randuri || []).map(r => randPentruRpc(randNormalizat(r, doc.sablon), doc.sablon)),
  }
}
export const argumenteConfirma = (docId, verif) => ({ p_doc_id: docId, p_versiune: verif?.versiune ?? null, p_hash: verif?.hash ?? null })
export const argumentePv = (doc, nr, data) => ({ p_doc_id: doc.id, p_versiune: doc.versiune, p_pv_nr: txt(nr), p_pv_data: data || null })

// verdictele care înseamnă „se poate confirma” (orice altceva = blocat: fail-closed)
const VERDICT_OK = /^(ok|confirmabil|fara_blocante|cu_avertismente|avertismente|valid)$/i
const elementVerificare = (x, blocantImplicit) => {
  if (x == null) return null
  if (typeof x !== 'object') return { nr_crt: null, cod: null, mesaj: String(x), blocant: blocantImplicit }
  const nivel = String(x.nivel ?? x.severitate ?? x.gravitate ?? '')
  return { nr_crt: x.nr_crt ?? x.rand ?? null, cod: x.cod ?? x.tip ?? null, mesaj: x.mesaj ?? x.message ?? x.text ?? x.cod ?? JSON.stringify(x),
    blocant: blocantImplicit || x.blocant === true || /^(blocant|eroare|error)$/i.test(nivel) }
}
/**
 * Răspunsul fn_izo_doc_verifica → { versiune, hash, verdict, lista, blocante, ok }. `ok` doar cu verdict cunoscut ca bun, zero
 * elemente blocante, hash și versiune prezente — altfel butonul „Confirmă recepția” rămâne oprit.
 */
export function normalizeazaVerificare(data) {
  const d = Array.isArray(data) ? data[0] : data
  if (!d || typeof d !== 'object') return { versiune: null, hash: null, verdict: '', lista: [], blocante: 1, ok: false }
  const sursa = (v, b) => (Array.isArray(v) ? v : v ? [v] : []).map(x => elementVerificare(x, b)).filter(Boolean)
  const lista = [...sursa(d.blocante, true), ...sursa(d.avertismente, false)]
  const verdict = String(d.verdict ?? '')
  const blocante = lista.filter(x => x.blocant).length
  return { versiune: d.versiune ?? null, hash: d.hash ?? null, verdict, lista, blocante,
    ok: VERDICT_OK.test(verdict) && blocante === 0 && !!d.hash && d.versiune != null }
}

/**
 * „Recepția nu e instalată” DOAR când eroarea numește un obiect E3 (sau registrul E2a) care lipsește — orice altă eroare
 * (drepturi, rețea) se arată ca eroare, nu ca „în pregătire” (aceeași regulă ca lipsaRegistru din E2b, review #809).
 */
export function lipsaReceptie(error) {
  if (!error) return false
  const m = `${error.code || ''} ${error.message || ''} ${error.details || ''} ${error.hint || ''}`
  const obiect = /(izo_documente_intrare\w*|izo_documente_scanuri|fn_izo_doc_\w+|fn_izo_proiecte_protejate|izo_atribuiri)/i.test(m)
  // doar funcția / tabelul lipsă; o coloană lipsă (42703) e o nepotrivire de contract și se arată ca eroare
  const lipsa = ['PGRST202', 'PGRST205', '42883', '42P01'].includes(String(error.code || ''))
    || /(could not find the (function|table)|(relation|function) \S+ does not exist)/i.test(m)
  return obiect && lipsa && String(error.code || '') !== '42703'
}

/** Mesajul pentru gestionar, din eroarea unui RPC E3. */
export function mesajEroareDoc(error) {
  const m = `${error?.code || ''} ${error?.message || error || ''}`
  if (/40001|s-a schimbat|modificat între timp/i.test(m)) return 'documentul s-a schimbat între timp (salvat de altcineva sau din altă fereastră) — reîncarcă și apasă din nou „Verifică”'
  if (/23505/.test(m)) return /seri|magbuc/i.test(m) ? `o serie din document e deja în registru — ${error?.message || m}` : 'există deja un document viu (draft sau confirmat) cu același furnizor, număr și dată — deschide-l din listă; un document anulat se poate reintroduce'
  if (/42501|permission denied|nu ai drept|neautorizat/i.test(m)) return 'nu ai drept pe acest document: trebuie să fii gestionar pe proiectul și pe depozitul documentului (atribuirea o dă Răzvan) și să ai Magazie cu nivel editor'
  if (/55000|nu mai e draft|doar draft/i.test(m)) return 'documentul nu mai e draft (a fost confirmat sau anulat între timp) — reîncarcă'
  return error?.message || String(error)
}

/** Dreptul de scriere în UI (oglinda autorizării din design §3.4; serverul decide oricum): owner, sau gestionar pe (proiect, depozit) + Magazie editor/admin. */
export function poateScrie({ owner, nivelMagazie, atribuiri = [], proiectId, depozitId, azi = new Date().toISOString().slice(0, 10) }) {
  if (owner) return true
  if (!['editor', 'admin'].includes(nivelMagazie) || !proiectId || !depozitId) return false
  return atribuiri.some(a => a.rol === 'gestionar' && a.activ !== false && Number(a.proiect_id) === Number(proiectId) && Number(a.depozit_id) === Number(depozitId)
    && (!a.valabil_de || a.valabil_de <= azi) && (!a.valabil_pana || a.valabil_pana >= azi))
}

/** sha256 hex al unui Blob / ArrayBuffer (hash-urile scanului sunt „declarate de client” până la E9 — design §6). */
export async function sha256Hex(x) {
  const buf = x instanceof ArrayBuffer ? x : await x.arrayBuffer()
  const h = await globalThis.crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('')
}
