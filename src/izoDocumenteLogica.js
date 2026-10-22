// ════════════════════════════════════════════════════════════════════════
// IZOMETRIE E3 — documentele de intrare (aviz țeavă / listă de ambalare curbe): logica pură a ecranului
// ════════════════════════════════════════════════════════════════════════
// Folosit de src/IzoDocumenteIntrare.jsx (Magazie → 🧾 Documente de intrare). Fără React; Storage doar prin clientul primit ca
// argument (scanurile). Seria canonică, numerele (format furnizor / RO), validarea rândurilor, totalurile, lipirea din Excel și
// argumentele / răspunsurile RPC-urilor E3 EXACT după contractul RPC al sesiunii Izometrie (21.10.2026): fn_izo_doc_salveaza
// (5 argumente, liste ÎNCHISE de chei) / _verifica / _confirma / _pv / _anuleaza_draft + bucket-ul dedicat izo-documente.
// Verificările de aici sunt LOCALE (ajutor pentru gestionar). Acoperă tot ce blochează serverul în fn_izo_doc_blocante (totalurile
// cerute — total_m / total_bucati — și cele scrise, motivul de 3+ caractere, peretele, lungimea / unghiul, dublurile) și sunt uneori
// mai stricte (toleranțele fără explicație, intervalele, precizia). Totalurile pe care serverul le verifică doar dacă sunt scrise
// (kg, pachete, net, brut) sunt și aici opționale, cu avertisment când lipsesc. Serverul recalculează tot și decide.

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

// ── contractul RPC: listele ÎNCHISE de chei (o cheie necunoscută = refuz pe server) ─────────────────────────────
export const CHEI_ANTET = {
  creare: ['proiect_id', 'depozit_id', 'sablon', 'inlocuieste_document_id', 'motiv_inlocuire'],   // doar la creare
  comune: ['furnizor', 'furnizor_cif', 'nr_document', 'data_document', 'observatii'],
  aviz_teava: ['cumparator', 'transport_nr', 'nume_proiect', 'lot', 'loc_livrare', 'data_incarcare', 'data_descarcare', 'nr_camion', 'total_m', 'total_kg'],
  lista_ambalare_curbe: ['factura', 'importator', 'destinatar', 'referinta_client', 'referinta_furnizor', 'placa_camion_container', 'total_bucati',
    'total_pachete', 'total_net_kg', 'total_brut_kg'],
}
export const CHEI_RAND = {
  comune: ['nr_crt', 'serie', 'sarja', 'lot', 'specificatie', 'dimensiune', 'grad_otel', 'standard', 'izolatie', 'diametru_mm', 'perete_mm', 'greutate_kg',
    'decizie', 'motiv', 'observatie'],
  aviz_teava: ['lungime_doc_mm', 'lungime_masurata_mm'],
  lista_ambalare_curbe: ['cod', 'item', 'unghi_doc', 'unghi_masurat', 'cantitate', 'pachet_nr', 'dimensiuni_cm', 'net_kg', 'brut_kg'],
}
export const CHEI_SCAN = ['cale', 'sha256_original', 'sha256_pdf', 'marime', 'mime']
export const IZOLATII = ['neizolata', 'PEHD', 'GRP']

export const DECIZII = [
  { cheie: 'primit', label: 'Primit' },
  { cheie: 'primit_neconform', label: 'Neconform → carantină' },
  { cheie: 'refuzat_la_receptie', label: 'Refuzat' },
]

// coloanele rândului, pe șablon: [câmp, etichetă, tip] — ordinea din tabel; TOATE cheile comune ale rândului sunt editabile
// (rândurile se înlocuiesc integral la salvare: un câmp nevăzut în editor s-ar pierde)
export const COLOANE = {
  aviz_teava: [['nr_crt', 'Nr.', 'int'], ['serie', 'Nr. țeavă', 'txt'], ['sarja', 'Șarjă', 'txt'], ['lot', 'Lot', 'txt'],
    ['lungime_doc', 'L aviz (m)', 'm'], ['lungime_masurata', 'L măsurat (m)', 'm'], ['greutate_kg', 'Kg', 'kg'],
    ['perete_mm', 'Perete', 'zec'], ['diametru_mm', 'Diam.', 'int'], ['specificatie', 'Specificație', 'txt'], ['standard', 'Standard', 'txt'],
    ['dimensiune', 'Dimensiune', 'txt'], ['grad_otel', 'Grad oțel', 'txt'], ['izolatie', 'Izolație', 'izolatie']],
  lista_ambalare_curbe: [['nr_crt', 'Nr.', 'int'], ['serie', 'Bend no.', 'txt'], ['sarja', 'Heat (șarjă)', 'txt'], ['cod', 'Cod', 'txt'],
    ['item', 'Item', 'txt'], ['diametru_mm', 'Diam.', 'int'], ['perete_mm', 'Perete', 'zec'], ['unghi_doc', 'Unghi listă (°)', 'zec'],
    ['unghi_masurat', 'Unghi măsurat (°)', 'zec'], ['standard', 'Standard', 'txt'], ['cantitate', 'Buc', 'int'], ['pachet_nr', 'Pachet', 'txt'],
    ['dimensiuni_cm', 'Dim. pachet (cm)', 'txt'], ['net_kg', 'Net kg', 'kg'], ['brut_kg', 'Brut kg', 'kg'], ['specificatie', 'Descriere', 'txt'],
    ['lot', 'Lot', 'txt'], ['greutate_kg', 'Greutate (kg)', 'kg'], ['dimensiune', 'Dimensiune', 'txt'], ['grad_otel', 'Grad oțel', 'txt'],
    ['izolatie', 'Izolație', 'izolatie']],
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

// toleranțele măsurat ↔ document (Q-E3-4, decizia Razvan 21.10): la prag exact NU e avertisment. Serverul le dă ca
// AVERTISMENTE; în ecran, o diferență peste prag fără explicație e blocantă LOCAL (regulă de UI, nu a serverului)
export const TOL_LUNGIME_MM = 10
export const TOL_UNGHI = 0.5
// intervalele fizice (verificare locală)
export const LUNGIME_MIN_MM = 1, LUNGIME_MAX_MM = 30000

const txt = v => { const s = v == null ? '' : String(v).trim(); return s || null }
const normAntet = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
/** primul element dacă e listă (răspunsurile RPC pot veni ca [obiect]) */
export const unu = data => (Array.isArray(data) ? data[0] : data)

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
/** câte zecimale are cel mult numărul (diametru: 0, perete / unghi: 1 — contractul RPC) */
export const areMaxZecimale = (x, z) => !esteNr(x) || Math.abs(x * 10 ** z - Math.round(x * 10 ** z)) < 1e-6
/** metri (text) → mm întregi (contractul: lungimile în mm întregi; sub-milimetrul se rotunjește) */
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
/** metri pentru afișare în listă / totaluri: 2 zecimale, 3 când milimetrii contează (90,755 m nu devine 90,76) */
export const fmtM = m => { if (m == null || !esteNr(Number(m))) return '—'; const mm = Math.round(Number(m) * 1000); return fmtNr(mm / 1000, mm % 10 ? 3 : 2) }

/** Izolația din text (Excel / editor) → cheia contractului ('neizolata' | 'PEHD' | 'GRP'); gol → null; necunoscut → textul (blocant). */
export function izolatieDinText(v) {
  const s = txt(v)
  if (!s) return null
  const n = normAntet(s).replace(/[\s._-]+/g, '')
  if (/^neizol/.test(n)) return 'neizolata'
  // „izolată / izolate” pe avizele de țeavă = izolație PEHD (regulă Razvan 22.10.2026: ori PEHD, ori neizolată)
  if (n === 'pehd' || n === '3lpe' || /^izolat/.test(n) || /^polietilen/.test(n)) return 'PEHD'
  if (n === 'grp') return 'GRP'
  return s
}

// ── rândurile ─────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Rând gol pentru editor (câmpurile = text). Din rândul de deasupra se preiau DOAR constantele fizice (perete / diametru /
 * specificație / standard / dimensiune / grad / izolație) — șarja, lotul și item-ul nu (o șarjă uitată ar deveni trasabilitate greșită).
 */
export function randGol(sablon, nrCrt, prev = null) {
  return { nr_crt: String(nrCrt), serie: '', sarja: '', lot: '', lungime_doc: '', lungime_masurata: '', greutate_kg: '',
    perete_mm: prev?.perete_mm || '', diametru_mm: prev?.diametru_mm || '', specificatie: prev?.specificatie || '', standard: prev?.standard || '',
    dimensiune: prev?.dimensiune || '', grad_otel: prev?.grad_otel || '', izolatie: prev?.izolatie || '',
    cod: '', item: '', unghi_doc: '', unghi_masurat: '', cantitate: esteCurba(sablon) ? '1' : '', pachet_nr: '', dimensiuni_cm: '',
    net_kg: '', brut_kg: '', decizie: 'primit', motiv: '', observatie: '' }
}

/**
 * Rândul editorului → valorile tipizate (lungimi în mm întregi). Diametrul / peretele / unghiurile / kilogramele rămân cum au fost
 * scrise (precizia lor e verificată, nu rotunjită tăcut — review #826 r1). NaN rămâne NaN (îl prinde validarea).
 */
export function randNormalizat(r, sablon) {
  const curba = esteCurba(sablon)
  const n = (v, o) => parseNumar(v, o)
  return {
    nr_crt: n(r.nr_crt), serie: txt(r.serie), serie_canon: serieCanon(r.serie) || null, sarja: txt(r.sarja), lot: txt(r.lot),
    specificatie: txt(r.specificatie), dimensiune: txt(r.dimensiune), grad_otel: txt(r.grad_otel), standard: txt(r.standard),
    izolatie: izolatieDinText(r.izolatie), diametru_mm: n(r.diametru_mm), perete_mm: n(r.perete_mm),
    greutate_kg: n(r.greutate_kg, { mii: true }),
    lungime_doc_mm: curba ? null : mmDinM(r.lungime_doc), lungime_masurata_mm: curba ? null : mmDinM(r.lungime_masurata),
    unghi_doc: curba ? n(r.unghi_doc) : null, unghi_masurat: curba ? n(r.unghi_masurat) : null,
    cod: curba ? txt(r.cod) : null, item: curba ? txt(r.item) : null,
    cantitate: curba ? (n(r.cantitate) ?? 1) : null, pachet_nr: curba ? txt(r.pachet_nr) : null, dimensiuni_cm: curba ? txt(r.dimensiuni_cm) : null,
    net_kg: curba ? n(r.net_kg, { mii: true }) : null, brut_kg: curba ? n(r.brut_kg, { mii: true }) : null,
    decizie: r.decizie || null, motiv: txt(r.motiv), observatie: txt(r.observatie),
  }
}
/** lungimea bucății în registru (Q-E3-5 A): cea măsurată dacă există, altfel cea din document */
export const lungimeRegistruMm = rn => (esteNr(rn.lungime_masurata_mm) ? rn.lungime_masurata_mm : rn.lungime_doc_mm)
/** unghiul curbei în registru: cel măsurat dacă există, altfel cel de pe listă (unghi_curba al bucății) */
export const unghiRegistru = rn => (esteNr(rn.unghi_masurat) ? rn.unghi_masurat : esteNr(rn.unghi_doc) ? rn.unghi_doc : null)
/**
 * Cheia de dublură a unui rând în același document: țeava = seria canonică; curba = serie + șarjă + unghi (o bucată pe rând;
 * aceeași serie + șarjă cu alt unghi e legitimă — regula convenită pentru E3, aceeași cheie ca indexul curbelor din registru,
 * ux_magbuc_izo_curba). Din 20261103b r5f serverul folosește aceeași cheie (serie canonică + șarjă + coalesce(unghi_masurat,
 * unghi_doc)), cu blocantul serie_dublura și mesajul „curba X / șarjă la U° apare de mai multe ori”.
 */
export function cheieDubluraRand(rn, sablon) {
  if (!rn.serie_canon) return null
  return esteCurba(sablon) ? JSON.stringify([rn.serie_canon, rn.sarja ?? null, unghiRegistru(rn)]) : rn.serie_canon
}

const CAMPURI_NUMERICE = { nr_crt: 'nr. crt.', lungime_doc_mm: 'lungimea de pe document', lungime_masurata_mm: 'lungimea măsurată', greutate_kg: 'greutatea',
  perete_mm: 'peretele', diametru_mm: 'diametrul', unghi_doc: 'unghiul de pe listă', unghi_masurat: 'unghiul măsurat', cantitate: 'cantitatea',
  net_kg: 'greutatea netă', brut_kg: 'greutatea brută' }
// precizia cerută de contract: [câmp, zecimale, mesaj]
const PRECIZIE = [['diametru_mm', 0, 'diametrul se scrie în mm întregi'], ['perete_mm', 1, 'peretele are cel mult o zecimală (ex. 7,1)'],
  ['unghi_doc', 1, 'unghiul de pe listă are cel mult o zecimală'], ['unghi_masurat', 1, 'unghiul măsurat are cel mult o zecimală'],
  ['greutate_kg', 1, 'greutatea are cel mult o zecimală'], ['net_kg', 1, 'greutatea netă are cel mult o zecimală'],
  ['brut_kg', 1, 'greutatea brută are cel mult o zecimală']]
// motivul unui rând refuzat / neconform: serverul (fn_izo_doc_blocante, motiv_lipsa) cere char_length(btrim(motiv)) >= 3
export const MOTIV_MIN = 3
const motivOk = m => (txt(m) || '').length >= MOTIV_MIN
const izolatieRea = rn => rn.izolatie != null && !IZOLATII.includes(rn.izolatie)
const blocant = (camp, mesaj) => ({ camp, nivel: 'blocant', mesaj })
const avert = (camp, mesaj) => ({ camp, nivel: 'avertisment', mesaj })

/** Verificările locale ale unui rând: [{camp, nivel: blocant|avertisment, mesaj}]. */
export function validareRand(rn, sablon) {
  const curba = esteCurba(sablon), v = []
  for (const [c, et] of Object.entries(CAMPURI_NUMERICE)) if (Number.isNaN(rn[c])) v.push(blocant(c, `${et} nu e un număr`))
  for (const [c, z, mesaj] of PRECIZIE) if (!areMaxZecimale(rn[c], z)) v.push(blocant(c, mesaj))
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
  if (izolatieRea(rn)) v.push(blocant('izolatie', `izolația „${rn.izolatie}” nu e recunoscută: neizolată / PEHD / GRP (sau gol)`))
  if (!DECIZII.some(d => d.cheie === rn.decizie)) v.push(blocant('decizie', 'alege decizia (primit / neconform / refuzat)'))
  const neprimit = rn.decizie === 'refuzat_la_receptie' || rn.decizie === 'primit_neconform'
  // ca serverul (motiv_lipsa): motivul are cel puțin 3 caractere după trim — altfel ecranul ar spune „fără blocante” degeaba
  if (neprimit && !motivOk(rn.motiv)) v.push(blocant('motiv', `${rn.decizie === 'refuzat_la_receptie' ? 'refuzul' : 'neconformitatea'} cere motiv (cel puțin ${MOTIV_MIN} caractere)`))
  const inInterval = (x, camp, et) => { if (esteNr(x) && (x < LUNGIME_MIN_MM || x > LUNGIME_MAX_MM)) v.push(blocant(camp, `${et} în afara intervalului 0,001–30 m`)) }
  // diferența peste toleranță cere o explicație (regulă LOCALĂ): observația, sau motivul unui rând neconform / refuzat
  const explicat = !!rn.observatie || (neprimit && motivOk(rn.motiv))
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
    // un rând = o bucată: cantitatea e 1 sau goală — aceeași regulă ca serverul din 20261103b r5f (refuz 23514 „un rând = o bucată”),
    // iar blocantul total_bucati de pe server compară cu numărul de rânduri
    if (esteNr(rn.cantitate) && rn.cantitate !== 1) v.push(blocant('cantitate', 'o curbă pe rând (cantitatea 1); pune fiecare curbă pe rândul ei'))
    if (rn.net_kg == null) v.push(avert('net_kg', 'lipsește greutatea netă (intră în total)'))
    const cod = verificaCodCurba(rn)
    if (cod) v.push(avert('cod', cod))
  }
  for (const [c, et] of [['perete_mm', 'peretele'], ['diametru_mm', 'diametrul']]) if (esteNr(rn[c]) && rn[c] <= 0) v.push(blocant(c, `${et} trebuie > 0`))
  // ca serverul (perete_lipsa): peretele e obligatoriu pe rândurile care intră în registru (primit / neconform); la refuz, doar avertisment
  if (rn.perete_mm == null) v.push(rn.decizie === 'refuzat_la_receptie' ? avert('perete_mm', 'lipsește peretele (7,1 / 8,8)')
    : blocant('perete_mm', 'lipsește peretele (7,1 / 8,8 — împarte stocul; bucata intră în registru)'))
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
  const s = { randuri: randuriNorm.length, primit: 0, neconform: 0, refuzat: 0, m_doc_mm: 0, m_primit_mm: 0, m_real_mm: 0,
    kg: 0, bucati: 0, pachete: 0, net: 0, brut: 0 }
  const pachete = new Set()
  for (const r of randuriNorm) {
    if (r.decizie === 'primit') s.primit++
    else if (r.decizie === 'primit_neconform') s.neconform++
    else if (r.decizie === 'refuzat_la_receptie') s.refuzat++
    if (!curba) {
      if (esteNr(r.lungime_doc_mm)) s.m_doc_mm += r.lungime_doc_mm
      if (esteNr(r.greutate_kg)) s.kg += r.greutate_kg
      if (r.decizie === 'primit' && esteNr(r.lungime_doc_mm)) { s.m_primit_mm += r.lungime_doc_mm; s.m_real_mm += lungimeRegistruMm(r) }
    } else {
      s.bucati += esteNr(r.cantitate) ? r.cantitate : 0
      if (r.pachet_nr) pachete.add(r.pachet_nr)   // ca serverul: count(DISTINCT pachet_nr) pe valoarea salvată (trim), nu pe seria canonică
      if (esteNr(r.net_kg)) s.net += r.net_kg
      if (esteNr(r.brut_kg)) s.brut += r.brut_kg
    }
  }
  s.pachete = pachete.size
  s.kg = rot(s.kg, 1); s.net = rot(s.net, 1); s.brut = rot(s.brut, 1)
  const cmp = []
  const doc = (camp, o) => nr(antet?.[camp], o)
  const adauga = (cheie, label, calculat, document, z, fmt, optional = false) => {
    const lipsa = document == null
    const invalid = Number.isNaN(document)
    cmp.push({ cheie, label, calculat, document: lipsa || invalid ? null : document, fmt, optional,
      bate: lipsa ? (optional ? null : false) : invalid ? false : egalZ(calculat, document, z),
      mesaj: invalid ? 'nu e un număr' : lipsa ? (optional ? 'nescris pe document' : 'lipsește totalul de pe document') : null })
  }
  // obligatorii = cele pe care serverul le cere și goale (total_m / total_bucati); restul se compară doar dacă sunt scrise (review #826 r1)
  if (!curba) {
    adauga('total_m', 'Metri', m2(s.m_doc_mm), doc('total_m'), 3, 'm')
    adauga('total_kg', 'Kg', s.kg, doc('total_kg', { mii: true }), 1, 'kg', true)
  } else {
    adauga('total_bucati', 'Bucăți', s.bucati, doc('total_bucati'), 0, 'int')
    adauga('total_pachete', 'Pachete', s.pachete, doc('total_pachete'), 0, 'int', true)
    adauga('total_net_kg', 'Net kg', s.net, doc('total_net_kg', { mii: true }), 1, 'kg', true)
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
  const vazut = new Map(), vazutNr = new Map(), curba = esteCurba(doc.sablon)
  norm.forEach((rn, i) => {
    const cheie = cheieDubluraRand(rn, doc.sablon)
    if (cheie) {
      if (vazut.has(cheie)) {
        const j = vazut.get(cheie), pe = `(și pe rândul ${norm[j].nr_crt ?? j + 1})`
        randuri[i].push(blocant('serie', curba
          ? `curba ${rn.serie_canon} / șarja ${rn.sarja ?? '—'} / ${textNr(unghiRegistru(rn)) || '?'}° apare de două ori în document ${pe}`
          : `seria ${rn.serie_canon} apare de două ori în document ${pe}`))
      } else vazut.set(cheie, i)
    }
    if (esteNr(rn.nr_crt)) {
      if (vazutNr.has(rn.nr_crt)) randuri[i].push(blocant('nr_crt', `nr. crt. ${rn.nr_crt} e folosit de două ori`))
      else vazutNr.set(rn.nr_crt, i)
    } else if (rn.nr_crt == null) randuri[i].push(blocant('nr_crt', 'lipsește nr. crt.'))
  })
  for (const [camp, et] of [['furnizor', 'furnizorul'], ['nr_document', 'nr. documentului'], ['data_document', 'data documentului']])
    if (!txt(doc.antet?.[camp])) document.push(blocant(camp, `lipsește ${et}`))
  if (!doc.depozit_id) document.push(blocant('depozit_id', 'alege depozitul'))
  if (!doc.id && doc.inlocuieste_document_id && eroareMotiv(doc.motiv_inlocuire, 'motivul înlocuirii'))
    document.push(blocant('motiv_inlocuire', eroareMotiv(doc.motiv_inlocuire, 'motivul înlocuirii')))
  const totaluri = totaluriDocument(doc.sablon, doc.antet, norm)
  for (const c of totaluri.comparatii) {
    if (c.bate === false) document.push(blocant(c.cheie, c.mesaj ? `${c.label}: ${c.mesaj}` : `${c.label}: rândurile dau ${c.calculat}, documentul spune ${c.document}`))
    // totalul opțional nescris: nu blochează (nici serverul), dar se vede — de obicei e pe hârtie (brutul lipsește des, fără avertisment)
    else if (c.bate === null && c.cheie !== 'total_brut_kg') document.push(avert(c.cheie, `${c.label}: totalul nu e scris — dacă e pe document, scrie-l (se compară cu rândurile)`))
  }
  const toate = [...document, ...randuri.flat()]
  return { norm, randuri, document, totaluri, blocante: toate.filter(x => x.nivel === 'blocant').length, avertismente: toate.filter(x => x.nivel === 'avertisment').length }
}

/** Motivul (anulare / înlocuire): obligatoriu, 3–1000 de caractere după trim — altfel mesajul erorii. */
export function eroareMotiv(motiv, et = 'motivul') {
  const n = (txt(motiv) || '').length
  return n < 3 ? `Scrie ${et} (cel puțin 3 caractere).` : n > 1000 ? `${et[0].toUpperCase()}${et.slice(1)} are peste 1000 de caractere.` : null
}

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/
/**
 * Ce oprește SALVAREA draftului (nu confirmarea): ce ar refuza serverul la fn_izo_doc_salveaza după contract — identitatea și
 * depozitul (coloane obligatorii), motivul înlocuirii, datele YYYY-MM-DD, totalurile numerice, seria, nr. crt. întreg > 0 unic,
 * decizia (fără ea serverul ar pune „primit”), izolația, precizia (diametru întreg, perete / unghi / kg o zecimală, totalurile) și
 * curba = 1 bucată pe rând (cantitatea 1 sau goală — refuz 23514 pe server din 20261103b r5f).
 */
export function eroriSalvare(doc) {
  const e = []
  for (const [camp, et] of [['furnizor', 'furnizorul'], ['nr_document', 'nr. documentului'], ['data_document', 'data documentului']])
    if (!txt(doc.antet?.[camp])) e.push(`Completează ${et}.`)
  if (!doc.depozit_id) e.push('Alege depozitul.')
  if (!doc.id && doc.inlocuieste_document_id) { const m = eroareMotiv(doc.motiv_inlocuire, 'motivul înlocuirii'); if (m) e.push(m) }
  for (const c of ['data_document', ...(SABLOANE[doc.sablon]?.antet || []).filter(x => x[2] === 'date').map(x => x[0])]) {
    const v = txt(doc.antet?.[c]); if (v && !RE_DATA.test(v)) e.push(`Data „${v}” nu e în formatul AAAA-LL-ZZ.`)
  }
  for (const [camp, et, tip] of SABLOANE[doc.sablon]?.totaluri || []) {
    const x = parseNumar(doc.antet?.[camp], { mii: tip === 'kg' })
    if (Number.isNaN(x)) e.push(`„${et}” nu e un număr.`)
    else if (tip === 'int' && esteNr(x) && !Number.isInteger(x)) e.push(`„${et}” trebuie să fie număr întreg.`)
    // precizia coloanelor (total_m numeric(12,3), kg numeric(12,1)): fără rotunjire tăcută pe server
    else if (!areMaxZecimale(x, tip === 'm' ? 3 : tip === 'kg' ? 1 : 0)) e.push(`„${et}” are prea multe zecimale (${tip === 'm' ? '3' : '1'} cel mult).`)
  }
  const curba = esteCurba(doc.sablon), nrs = new Set()
  ;(doc.randuri || []).forEach((r, i) => {
    const rn = randNormalizat(r, doc.sablon), et = `Rândul ${r.nr_crt || i + 1}`
    if (!rn.serie) e.push(`${et}: lipsește ${curba ? 'bend number' : 'seria țevii'}.`)
    const rau = Object.entries(CAMPURI_NUMERICE).filter(([c]) => Number.isNaN(rn[c])).map(([, x]) => x)
    if (rau.length) e.push(`${et}: ${rau.join(', ')} nu e număr.`)
    for (const [c, z, mesaj] of PRECIZIE) if (!areMaxZecimale(rn[c], z)) e.push(`${et}: ${mesaj}.`)
    if (!DECIZII.some(d => d.cheie === rn.decizie)) e.push(`${et}: alege decizia (primit / neconform / refuzat).`)
    if (izolatieRea(rn)) e.push(`${et}: izolația „${rn.izolatie}” nu e recunoscută (neizolată / PEHD / GRP).`)
    if (curba && esteNr(rn.cantitate) && rn.cantitate !== 1) e.push(`${et}: o curbă pe rând (cantitatea 1).`)
    if (!esteNr(rn.nr_crt) || rn.nr_crt <= 0 || !Number.isInteger(rn.nr_crt)) e.push(`Rândul ${i + 1}: nr. crt. lipsește sau nu e întreg > 0.`)
    else if (nrs.has(rn.nr_crt)) e.push(`Nr. crt. ${rn.nr_crt} e folosit de două ori.`)
    else nrs.add(rn.nr_crt)
  })
  return e
}

/** PV-ul: numărul (1–80 de caractere, fără „|” — serverul îl refuză) și data. */
export function eroriPv(nr, data) {
  const e = [], n = txt(nr)
  if (!n) e.push('Completează numărul PV-ului.')
  else if (n.length > 80) e.push('Numărul PV-ului are peste 80 de caractere.')
  else if (n.includes('|')) e.push('Numărul PV-ului nu poate conține „|”.')
  if (!data || !RE_DATA.test(String(data))) e.push('Completează data PV-ului.')
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
// „SIZE-MATERIAL STD” e standard, „Cantitate livrata (m)” e lungime, „QUANTITY (PCS)” e cantitate, „Dim. pachet (cm)” sunt
// dimensiunile pachetului (înaintea „pachet”), „Dimensiune” (singular) e dimensiunea țevii.
const ALIAS = [
  ['nr_crt', /^(nr\.? ?crt\.?|crt\.?|nr\.?|poz\.?|pos\.?)$/],
  ['_masurat', /(masurat|measured)/],
  ['decizie', /decizi/], ['motiv', /motiv/], ['observatie', /^obs/],
  ['sarja', /(sarj|heat|charge)/],
  ['standard', /(\bstd\b|standard)/],
  ['izolatie', /izol/],
  ['net_kg', /\bnet\b/], ['brut_kg', /(brut|gross)/],
  ['dimensiune', /^dimensiunea?$/],
  ['dimensiuni_cm', /(dimensiuni|dimension|dims|^dim\b|\bcm\b)/],
  ['pachet_nr', /(pachet|packing|package|pkg|colet)/],
  ['grad_otel', /(\botel\b|\bsteel\b|^grad$)/],   // „Grade” singur rămâne unghi (ca înainte)
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
/**
 * Decizia scrisă în Excel → cheia deciziei, EXPLICIT (fail-closed, review #E3-UI P2): refuz / respins → refuzat; neconform /
 * carantină → neconform; primit / ok / conform / da → primit. Orice alt text („NU”, „x”, „?”) → '' = „alege decizia” (blocant,
 * inclusiv la salvare), nu „primit” — o țeavă marcată altfel în Excel nu intră tăcut în registru ca disponibilă.
 */
export function decizieDinText(v) {
  const n = normAntet(v).replace(/[_→>.,;:!()\-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!n) return ''
  if (/(refuz|respin)/.test(n)) return 'refuzat_la_receptie'
  if (/(neconf|carant)/.test(n)) return 'primit_neconform'
  if (/^(primit[aei]?|ok|conform[aei]?|da)( (conform[aei]?|ok))?$/.test(n)) return 'primit'
  return ''
}

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
      if (camp === 'decizie') { if (v) r.decizie = decizieDinText(v) }
      else if (camp === 'izolatie') r.izolatie = izolatieDinText(v) || ''
      else if (v || camp !== 'cantitate') r[camp] = v
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
/** Rândul din izo_documente_intrare_randuri → rândul editorului (text). Lungimile vin în mm întregi (contract). */
export function randDinBd(r) {
  const g = x => (x == null ? '' : textNr(x))
  const t = x => (x == null ? '' : String(x))
  return {
    nr_crt: t(r.nr_crt), serie: t(r.serie), sarja: t(r.sarja), lot: t(r.lot), specificatie: t(r.specificatie), dimensiune: t(r.dimensiune),
    grad_otel: t(r.grad_otel), standard: t(r.standard), izolatie: t(r.izolatie),
    lungime_doc: mDinMm(r.lungime_doc_mm), lungime_masurata: mDinMm(r.lungime_masurata_mm),
    greutate_kg: g(r.greutate_kg), perete_mm: g(r.perete_mm), diametru_mm: g(r.diametru_mm), unghi_doc: g(r.unghi_doc), unghi_masurat: g(r.unghi_masurat),
    cod: t(r.cod), item: t(r.item), cantitate: t(r.cantitate), pachet_nr: t(r.pachet_nr), dimensiuni_cm: t(r.dimensiuni_cm),
    net_kg: g(r.net_kg), brut_kg: g(r.brut_kg), decizie: r.decizie || '', motiv: t(r.motiv), observatie: t(r.observatie), bucata_id: r.bucata_id ?? null,
  }
}
/** Antetul din izo_documente_intrare → câmpurile editorului (text): comune + ale ambelor șabloane + totalurile. */
export function antetDinBd(d) {
  const a = {}
  for (const c of [...CHEI_ANTET.comune, ...Object.values(SABLOANE).flatMap(s => s.antet.map(x => x[0]))]) a[c] = d[c] == null ? '' : String(d[c])
  for (const s of Object.values(SABLOANE)) for (const [c] of s.totaluri) a[c] = d[c] == null ? '' : textNr(d[c])
  for (const c of ['data_document', 'data_incarcare', 'data_descarcare']) a[c] = a[c] ? a[c].slice(0, 10) : ''
  return a
}

// ── argumentele RPC-urilor (contractul RPC E3, 21.10.2026) ─────────────────────────────────────────────────────
/** Rândul pentru p_randuri: EXACT cheile comune + cele ale șablonului (fără bucata_id / serie_canon — le pune serverul). */
export function randPentruRpc(rn, sablon) {
  if (!DECIZII.some(d => d.cheie === rn.decizie)) throw new Error(`rândul ${rn.nr_crt ?? '?'} n-are decizie validă`)   // fail-closed: serverul ar pune „primit”
  const r = {}
  for (const k of [...CHEI_RAND.comune, ...(CHEI_RAND[sablon] || [])]) r[k] = rn[k] === undefined || Number.isNaN(rn[k]) ? null : rn[k]
  if (r.izolatie != null && !IZOLATII.includes(r.izolatie)) r.izolatie = null
  return r
}
/** Elementul manifestului: EXACT cheile cale, sha256_original, sha256_pdf, marime, mime. */
export const manifestScan = x => ({ cale: x.cale, sha256_original: x.sha256_original, sha256_pdf: x.sha256_pdf, marime: Number(x.marime), mime: x.mime })

/**
 * fn_izo_doc_salveaza(p_doc_id, p_versiune, p_antet, p_randuri, p_scanuri).
 * Creare: p_doc_id / p_versiune NULL, p_antet cu proiect_id, depozit_id, sablon (+ inlocuieste_document_id ȘI motiv_inlocuire).
 * Editare: CAS pe versiune; cheile de identitate NU se trimit (rămân cum sunt pe server). p_antet poartă TOATE cheile șablonului
 * (+ observatii): un câmp omis s-ar goli. p_randuri = toate rândurile (înlocuire integrală). p_scanuri: null = manifest
 * neschimbat (opțiunea implicită); listă = manifestul întreg ([] = golire explicită).
 */
export function argumenteSalveaza(doc, { scanuri } = {}) {
  const s = SABLOANE[doc.sablon]
  if (!s) throw new Error(`șablon necunoscut: ${doc.sablon}`)
  const a = doc.antet || {}, p_antet = {}
  if (!doc.id) {
    Object.assign(p_antet, { proiect_id: Number(doc.proiect_id), depozit_id: Number(doc.depozit_id), sablon: doc.sablon })
    if (doc.inlocuieste_document_id) Object.assign(p_antet, { inlocuieste_document_id: Number(doc.inlocuieste_document_id), motiv_inlocuire: txt(doc.motiv_inlocuire) })
  }
  for (const c of CHEI_ANTET.comune) p_antet[c] = txt(a[c])
  for (const [c] of s.antet) p_antet[c] = txt(a[c])
  for (const [c, , tip] of s.totaluri) { const x = parseNumar(a[c], { mii: tip === 'kg' }); p_antet[c] = esteNr(x) ? x : null }
  return {
    p_doc_id: doc.id ? Number(doc.id) : null, p_versiune: doc.id && doc.versiune != null ? Number(doc.versiune) : null, p_antet,
    p_randuri: (doc.randuri || []).map(r => randPentruRpc(randNormalizat(r, doc.sablon), doc.sablon)),
    p_scanuri: scanuri === undefined || scanuri === null ? null : scanuri.map(manifestScan),
  }
}
/** fn_izo_doc_confirma: versiunea și hash-ul EXACT cele întoarse de verificare (nu ale salvării). */
export const argumenteConfirma = (docId, verif) => ({ p_doc_id: Number(docId), p_versiune: verif?.versiune ?? null, p_hash: verif?.hash ?? null })
export const argumentePv = (doc, nr, data) => ({ p_doc_id: Number(doc.id), p_versiune: doc.versiune == null ? null : Number(doc.versiune), p_pv_nr: txt(nr), p_pv_data: data || null })
export const argumenteAnuleazaDraft = (doc, motiv) => ({ p_doc_id: Number(doc.id), p_versiune: doc.versiune == null ? null : Number(doc.versiune), p_motiv: txt(motiv) })

// ── răspunsurile RPC (validate: forma din contract + documentul cerut; fără fallback pe id-ul local) ───────────────
const idValid = x => x != null && x !== '' && typeof x !== 'boolean' && Number.isInteger(Number(x)) && Number(x) > 0
/** {nr_crt|null, cod, mesaj} din elementele serverului (blocante / avertismente) */
export const elementServer = x => (x && typeof x === 'object' && !Array.isArray(x)
  ? { nr_crt: x.nr_crt ?? null, cod: x.cod == null ? null : String(x.cod), mesaj: x.mesaj == null ? String(x.cod ?? JSON.stringify(x)) : String(x.mesaj) }
  : { nr_crt: null, cod: null, mesaj: String(x) })
export const listaServer = v => (Array.isArray(v) ? v : v == null ? [] : [v]).map(elementServer)

function raspuns(data, docId, et) {
  const d = unu(data)
  if (!d || typeof d !== 'object') throw new Error(`${et}: răspuns gol de la server`)
  if (!idValid(d.document_id)) throw new Error(`${et}: răspunsul n-are document_id`)
  if (docId != null && Number(d.document_id) !== Number(docId)) throw new Error(`${et}: serverul a întors alt document (#${d.document_id}, cerut #${docId})`)
  if (!idValid(d.versiune)) throw new Error(`${et}: răspunsul n-are versiunea`)
  return d
}
/** fn_izo_doc_salveaza → {document_id, versiune, hash}; la editare documentul trebuie să fie cel trimis. */
export function normalizeazaSalvare(data, docId = null) {
  const d = raspuns(data, docId, 'salvarea')
  if (typeof d.hash !== 'string' || !d.hash) throw new Error('salvarea: răspunsul n-are hash')
  return { document_id: Number(d.document_id), versiune: Number(d.versiune), hash: d.hash }
}
/**
 * fn_izo_doc_verifica → {document_id, versiune, hash, stare, ok, blocante: [{nr_crt|null, cod, mesaj}], avertismente: [...], eroare}.
 * `ok` doar cu `ok === true` de la server, zero blocante, forma completă și documentul cerut — altfel „Confirmă” rămâne oprit.
 */
export function normalizeazaVerificare(data, docId = null) {
  const d = unu(data)
  if (!d || typeof d !== 'object') return { document_id: null, versiune: null, hash: null, stare: null, ok: false, blocante: [], avertismente: [], eroare: 'răspunsul verificării lipsește' }
  const lipsa = []
  if (typeof d.ok !== 'boolean') lipsa.push('ok')
  if (!Array.isArray(d.blocante)) lipsa.push('blocante')
  if (!Array.isArray(d.avertismente)) lipsa.push('avertismente')
  if (!idValid(d.document_id)) lipsa.push('document_id')
  if (!idValid(d.versiune)) lipsa.push('versiune')
  if (typeof d.hash !== 'string' || !d.hash) lipsa.push('hash')
  const blocante = listaServer(d.blocante), avertismente = listaServer(d.avertismente)
  const eroare = lipsa.length ? `răspuns neașteptat al verificării (lipsă / greșit: ${lipsa.join(', ')})`
    : docId != null && Number(d.document_id) !== Number(docId) ? `verificarea a întors alt document (#${d.document_id}, cerut #${docId})` : null
  return { document_id: idValid(d.document_id) ? Number(d.document_id) : null, versiune: idValid(d.versiune) ? Number(d.versiune) : null,
    hash: typeof d.hash === 'string' ? d.hash : null, stare: d.stare ?? null,
    ok: !eroare && d.ok === true && blocante.length === 0, blocante, avertismente, eroare }
}
/** fn_izo_doc_confirma → {document_id, eveniment_id, bucati: [id…], avertismente, versiune, idempotent} */
export function normalizeazaConfirmare(data, docId) {
  const d = raspuns(data, docId, 'confirmarea')
  if (!Array.isArray(d.bucati)) throw new Error('confirmarea: răspunsul n-are lista bucăților')
  return { document_id: Number(d.document_id), eveniment_id: d.eveniment_id ?? null, bucati: d.bucati, avertismente: listaServer(d.avertismente),
    versiune: Number(d.versiune), idempotent: d.idempotent === true }
}
/** fn_izo_doc_pv → {document_id, eveniment_pv_id, bucati_receptionate, avertismente, versiune, idempotent} */
export function normalizeazaPv(data, docId) {
  const d = raspuns(data, docId, 'PV-ul')
  const n = Number(d.bucati_receptionate)
  if (d.bucati_receptionate == null || !Number.isInteger(n) || n < 0) throw new Error('PV-ul: răspunsul n-are numărul bucăților recepționate')
  return { document_id: Number(d.document_id), eveniment_pv_id: d.eveniment_pv_id ?? null, bucati_receptionate: n, avertismente: listaServer(d.avertismente),
    versiune: Number(d.versiune), idempotent: d.idempotent === true }
}
/** fn_izo_doc_anuleaza_draft → {document_id, versiune, stare: 'anulat'} */
export function normalizeazaAnulare(data, docId) {
  const d = raspuns(data, docId, 'anularea')
  if (d.stare !== 'anulat') throw new Error(`anularea: serverul spune starea „${d.stare}”`)
  return { document_id: Number(d.document_id), versiune: Number(d.versiune), stare: d.stare }
}

// ── erorile ─────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * „Recepția nu e instalată” DOAR când eroarea numește un obiect E3 (sau registrul E2a) care lipsește — orice altă eroare
 * (drepturi, rețea) se arată ca eroare, nu ca „în pregătire” (aceeași regulă ca lipsaRegistru din E2b, review #809).
 * Se folosește DOAR la sonda inițială (incarca / incarcaDocs); acțiunile (deschidere / salvare / verificare / confirmare / PV /
 * anulare / scan) arată eroarea brută și păstrează draftul din editor (review #E3-UI P2).
 */
export function lipsaReceptie(error) {
  if (!error) return false
  const m = `${error.code || ''} ${error.message || ''} ${error.details || ''} ${error.hint || ''}`
  const obiect = /(izo_documente_intrare\w*|izo_documente_scanuri|fn_izo_doc_\w+|fn_izo_proiecte_protejate|izo_atribuiri)/i.test(m)
  // doar funcția / tabelul lipsă; o coloană lipsă (42703) e o nepotrivire de contract și se arată ca eroare
  const lipsa = ['PGRST202', 'PGRST205', '42883', '42P01'].includes(String(error.code || ''))
    || /(could not find the (function|table)|(relation|function) \S+ does not exist)/i.test(m)
  if (!obiect || !lipsa || String(error.code || '') === '42703') return false
  // PGRST202 cu „Perhaps you meant … <aceeași funcție>(…)”: funcția EXISTĂ, doar numele argumentelor diferă → nepotrivire de contract
  const fn = /function\s+(?:\w+\.)?(\w+)\s*\(/i.exec(error.message || '')?.[1]
  if (fn && new RegExp(`perhaps you meant[^]*\\b${fn}\\s*\\(`, 'i').test(error.hint || '')) return false
  return true
}

// funcție / tabel / coloană / argumente care nu se potrivesc cu serverul (PostgREST PGRST1xx / PGRST2xx, Postgres 42883 / 42P01 / 42703)
const COD_CONTRACT = /^(PGRST1\d\d|PGRST2\d\d|42883|42P01|42703)$/
/** Textul brut al erorii: [cod] mesaj — detalii — hint (nimic ascuns: la integrare se vede exact ce nu se potrivește). */
export function eroareBruta(error) {
  if (!error || typeof error !== 'object') return String(error ?? '')
  const corp = [error.message, error.details && `detalii: ${error.details}`, error.hint && `hint: ${error.hint}`].filter(Boolean).join(' — ')
  return `${error.code ? `[${error.code}] ` : ''}${corp || String(error)}`
}

/** Mesajul pentru gestionar, din eroarea unui RPC / SELECT E3. Mesajul serverului rămâne vizibil; necunoscutele se arată brut. */
export function mesajEroareDoc(error) {
  if (!error || typeof error !== 'object') return String(error ?? 'eroare necunoscută')
  const cod = String(error.code || ''), srv = String(error.message || '')
  if (COD_CONTRACT.test(cod)) return `nepotrivire cu serverul (funcție / tabel / argumente) — anunță-l pe Răzvan; draftul din ecran rămâne: ${eroareBruta(error)}`
  if (cod === '40001' || /s-a schimbat (între timp|de la verificare)/i.test(srv)) return `documentul s-a schimbat între timp (salvat de altcineva sau din altă fereastră) — reîncarcă-l și apasă din nou „Verifică” (${srv || cod})`
  if (cod === '23505') {
    if (/ux_izo_doc_identitate/i.test(srv)) return 'există deja un document viu (draft sau confirmat) cu același furnizor, număr și dată — deschide-l din listă; un document anulat se poate reintroduce'
    if (/inlocuieste/i.test(srv)) return `documentul anulat ales e deja înlocuit de alt document — alege altul (${srv})`
    if (/ux_magbuc_ev_doc|deja confirmat|deja PV/i.test(srv)) return `documentul are deja confirmarea / PV-ul înregistrat — reîncarcă-l (${srv})`
    if (/seri|registru|magbuc/i.test(srv)) return `o serie din document e deja în registru — ${srv}`
    return eroareBruta(error)
  }
  if (/se editează doar ciornele|doar ciornele|documentul e (confirmat|anulat)/i.test(srv)) return `documentul nu mai e draft (confirmat sau anulat între timp) — reîncarcă-l (${srv})`
  if (cod === '42501' || /permission denied/i.test(srv)) {
    return /gestionar|permission denied|autentificat|acces/i.test(srv) || !srv
      ? `nu ai drept pe acest document (${srv || cod}) — trebuie să fii gestionar pe proiectul și pe depozitul documentului (atribuirea o dă Răzvan) și să ai Magazie cu nivel editor`
      : `refuzat de server: ${srv}`
  }
  // mesajele de business (RAISE EXCEPTION, P0001) rămân curate; restul primesc și codul
  const corp = [error.message, error.details, error.hint].filter(Boolean).join(' — ') || String(error)
  return cod && cod !== 'P0001' ? `${corp} [${cod}]` : corp
}

/** Dreptul de scriere în UI (oglinda autorizării serverului; serverul decide oricum): owner, sau gestionar pe (proiect, depozit) + Magazie editor/admin. */
export function poateScrie({ owner, nivelMagazie, atribuiri = [], proiectId, depozitId, azi = new Date().toISOString().slice(0, 10) }) {
  if (owner) return true
  if (!['editor', 'admin'].includes(nivelMagazie) || !proiectId || !depozitId) return false
  return atribuiri.some(a => a.rol === 'gestionar' && a.activ !== false && Number(a.proiect_id) === Number(proiectId) && Number(a.depozit_id) === Number(depozitId)
    && (!a.valabil_de || a.valabil_de <= azi) && (!a.valabil_pana || a.valabil_pana >= azi))
}

// ── scanurile: bucket DEDICAT `izo-documente` (contract + review #E3-UI P1) ───────────────────────────────────────
// NU `avize`: acela e al Logisticii și are pe live politici PERMISIVE (orice cont autentificat citește / încarcă); politicile
// permisive se adună prin OR, deci politicile E3 n-ar putea restrânge nimic acolo. `izo-documente`: privat, doar
// application/pdf, 10 MB, politicile izo_doc_scan_ins / _sel / _del, fără UPDATE (upsert / mutare refuzate). Ordinea: upload
// fără upsert → salvare cu manifestul întreg; scoaterea: salvare fără el → DELETE pe obiect (un obiect din manifest nu se șterge).
export const BUCKET_SCANURI = 'izo-documente'
export const MAX_SCAN_OCTETI = 10 * 1024 * 1024
// calea obiectului: <document_id>/<uuid v4>.pdf (generată de client cu crypto.randomUUID(); politica verifică formatul)
export const RE_CALE_SCAN = /^[0-9]{1,18}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/
export function caleScan(docId, uuid) {
  const c = `${Number(docId)}/${String(uuid).toLowerCase()}.pdf`
  if (!idValid(docId) || !RE_CALE_SCAN.test(c)) throw new Error(`calea scanului „${c}” nu are forma <document>/<uuid v4>.pdf`)
  return c
}

/** sha256 hex al unui Blob / ArrayBuffer / TypedArray (hash-urile scanului sunt „declarate de client” până la E9). */
export async function sha256Hex(x) {
  const buf = x instanceof ArrayBuffer || ArrayBuffer.isView(x) ? x : await x.arrayBuffer()
  const h = await globalThis.crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Fișierul ales → scanul gata de încărcat: PDF (poza devine PDF în browser, cu imageToPdf — „TOTUL PDF”), verificat la
 * maximum 10 MB DUPĂ conversie, hash-urile, calea <document>/<uuid v4>.pdf. Întoarce {cale, sha256_original, sha256_pdf, marime, mime, pdf, nume}.
 */
export async function pregatesteScan(docId, fisier, { imageToPdf, uuid = () => globalThis.crypto.randomUUID() } = {}) {
  const tip = fisier?.type || ''
  const ePoza = tip.startsWith('image/'), ePdf = tip === 'application/pdf' || /\.pdf$/i.test(fisier?.name || '')
  if (!ePoza && !ePdf) throw new Error('se acceptă doar PDF sau poză')
  if (ePoza && typeof imageToPdf !== 'function') throw new Error('conversia pozei în PDF nu e disponibilă')
  const pdf = ePoza ? await imageToPdf(fisier) : fisier
  if (!pdf?.size) throw new Error('fișierul e gol')
  if (pdf.size > MAX_SCAN_OCTETI) throw new Error(`scanul are ${textNr(pdf.size / 1024 / 1024, 1)} MB, maxim 10 MB — scanează la rezoluție mai mică`)
  const sha256_original = await sha256Hex(fisier)
  const sha256_pdf = ePoza ? await sha256Hex(pdf) : sha256_original
  return { cale: caleScan(docId, uuid()), sha256_original, sha256_pdf, marime: pdf.size, mime: 'application/pdf', pdf, nume: fisier.name || null }
}
/**
 * Încărcarea în izo-documente, FĂRĂ upsert (politica nu are UPDATE). `storage` = supabase.storage. Eroarea aruncată poartă `ambiguu`:
 * false doar când Storage a răspuns clar cu 4xx (fără 408) = obiectul NU s-a scris; transport căzut / 5xx / 408 = poate s-a scris.
 */
export async function urcaScan(storage, s) {
  let error
  try { ({ error } = await storage.from(BUCKET_SCANURI).upload(s.cale, s.pdf, { contentType: 'application/pdf', upsert: false })) }
  catch (e) { error = { message: e?.message || String(e) } }
  if (!error) return
  const st = Number(error.status ?? error.statusCode)
  const err = new Error(/bucket not found/i.test(error.message || '') ? `stocarea scanurilor (bucket „${BUCKET_SCANURI}”) nu e încă instalată` : `încărcarea scanului a eșuat: ${error.message || error}`)
  err.ambiguu = !(Number.isInteger(st) && st >= 400 && st < 500 && st !== 408)
  throw err
}

/**
 * Eroare DEFINITIVĂ a unui RPC = serverul a răspuns clar că tranzacția NU s-a aplicat: excepție Postgres (SQLSTATE 22 / 23 / 25 / 40 /
 * 42 / P0 — RPC-ul a ridicat, tranzacția s-a anulat); cod PostgREST din grupele care resping cererea ÎNAINTE de execuție sau o anulează:
 * PGRST1xx (cererea: parsare / negociere / limite), PGRST2xx (schema cache: funcție / tabel negăsit), PGRST3xx (JWT); sau HTTP 4xx fără
 * 408. NU sunt definitive (review #826 r2): PGRST0xx (conexiunea la BD / pool / „Database client error” în timpul comenzii — nu dovedește
 * rollback-ul, răspunsul la COMMIT se poate pierde), PGRSTX00 (internă), transportul căzut (status 0, fără cod), 5xx fără cod, 408 /
 * timeout = AMBIGUU (salvarea poate fi încă în zbor sau comisă). Aceeași disciplină ca #833 r3.
 */
export function eroareDefinitivaRpc(error, status) {
  const cod = String(error?.code || '')
  if (/^(22|23|25|40|42|P0)[0-9A-Z]{3}$/.test(cod) || /^PGRST[123]\d\d$/.test(cod)) return true
  if (/^PGRST/.test(cod)) return false
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 408
}

/**
 * Atașarea unui scan (testabilă, fără React): upload FĂRĂ upsert → salvarea cu manifestul ÎNTREG (`salveaza()` = apelul RPC, întoarce
 * {data, error, status}). Fișierul urcat se șterge DOAR când e sigur că nu e și nu va fi în niciun manifest: upload eșuat AMBIGUU
 * (încercare best-effort — nicio salvare nu pornește după el) sau salvare refuzată DEFINITIV. La eroare AMBIGUĂ a salvării fișierul
 * RĂMÂNE (review #826 r1, P1 Copilot: un DELETE ar putea ajunge înaintea unei salvări încă în zbor → manifest spre un obiect șters).
 * Întoarce { rez: 'atasat' | 'nesalvat' | 'necunoscut', data, error, orfan: calea rămasă posibil fără manifest | null }.
 */
export async function ataseazaScanSigur({ storage, scan, salveaza }) {
  try { await urcaScan(storage, scan) } catch (e) {
    if (!e?.ambiguu) return { rez: 'nesalvat', data: null, error: e, orfan: null }
    // upload ambiguu: ștergerea e best-effort — un upload încă în zbor se poate materializa DUPĂ ea (chiar după un DELETE reușit), deci
    // calea rămâne raportată ca posibil orfan oricum (review #826 r2); niciun manifest nu ajunge la ea (salvarea nu pornește)
    await stergeScanObiect(storage, scan.cale)
    return { rez: 'nesalvat', data: null, error: e, orfan: scan.cale }
  }
  let rasp
  try { rasp = await salveaza() } catch (e) { rasp = { error: { message: e?.message || String(e) }, status: 0, transport: true } }
  if (!rasp?.error) return { rez: 'atasat', data: rasp?.data ?? null, error: null, orfan: null }
  if (!rasp.transport && eroareDefinitivaRpc(rasp.error, rasp.status)) {
    const sters = await stergeScanObiect(storage, scan.cale)
    return { rez: 'nesalvat', data: null, error: rasp.error, orfan: sters ? null : scan.cale }
  }
  return { rez: 'necunoscut', data: null, error: rasp.error, orfan: scan.cale }
}
/** DELETE pe obiect; true doar dacă s-a șters exact obiectul (un refuz RLS întoarce error = null și data = []). */
export async function stergeScanObiect(storage, cale) {
  try {
    const { data, error } = await storage.from(BUCKET_SCANURI).remove([cale])
    return !error && Array.isArray(data) && data.length === 1
  } catch { return false }
}
/** Link semnat (10 minute) pentru vizualizare. */
export async function linkScan(storage, cale, secunde = 600) {
  const { data, error } = await storage.from(BUCKET_SCANURI).createSignedUrl(cale, secunde)
  if (error || !data?.signedUrl) throw new Error(error?.message || 'fără link')
  return data.signedUrl
}
