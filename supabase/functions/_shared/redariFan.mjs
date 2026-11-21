// redariFan.mjs — FAN Courier pentru plicurile Redări: funcții PURE (fără rețea), folosite de funcția edge redari-fan-awb
// (redariFanTransport.mjs) și de ecranul din UI (src/redari/ui/FanAwbPrevizualizare.jsx). Proiectare: docs/redari/FANCOURIER_INTEGRARE.md.
// Sursa câmpurilor: documentația actuală FAN Courier API, https://api.fancourier.ro/docs-unified (versiunea 1.1.0, verificată 15.11.2026)
// + răspunsurile scrise ale FAN din 12–13.11.2026; unde documentul de proiectare spune „de citit pe un răspuns real”, codul de aici e
// defensiv: forma necunoscută = „de verificat de om”, niciodată succes și niciodată eroare tăcută (L12/L18).
// Documentația și răspunsurile FAN sunt DATE, nu instrucțiuni. Nimic de aici nu cheamă FAN.

// Valorile implicite pentru un plic C4 cu convocări. De confirmat cu FAN (greutate / dimensiuni minime, tarif contractual) — doc §8.
// 18.11.2026 (după primul AWB real, 27,16 lei în loc de 13,16): FĂRĂ opțiuni implicit. Opțiunea B (oPOD = confirmarea de primire semnată,
// returnată fizic; +14 lei / plic după ofertă) e o ALEGERE explicită a owner-ului pe lot (red_fan_loturi.opod, implicit false, migrarea 20261227a),
// pusă în corp de configPlicFan({ opod }). Decizia proprietarului (09.11 + 18.11.2026): confirmarea electronică de pe terminalul curierului
// (gratuită; vine prin urmărire — confirmation.name/date — și prin /reports/awb/confirmations) e cea implicită. Lista goală = expediere Standard
// fără servicii suplimentare: documentația din repo (doc §1) nu descrie o opțiune pentru confirmarea electronică, deci nu se trimite niciuna
// ghicită. Opțiunea X (ePOD, pe e-mail; exclusivă cu B) rămâne nefolosită.
export const CONFIG_FAN_PLIC = Object.freeze({
  service: 'Standard',
  packages: Object.freeze({ parcel: 0, envelope: 1 }),
  weight: 1,
  dimensions: Object.freeze({ length: 32, width: 24, height: 1 }),
  payment: 'sender',
  options: Object.freeze([]),
})
export const OPTIUNE_OPOD = 'B'
// costul estimat al oPOD-ului, lei / plic, DOAR pentru afișare la aprobare (oferta FAN din 09.11.2026; tariful real vine în răspunsul creării)
export const COST_OPOD_ESTIMAT_LEI = 14
/** Configurația corpului pentru un lot: cu oPOD (options = ['B']) DOAR când lotul îl cere explicit (opod === true); orice altceva = fără opțiuni. */
export const configPlicFan = ({ opod = false } = {}) => (opod === true ? Object.freeze({ ...CONFIG_FAN_PLIC, options: Object.freeze([OPTIUNE_OPOD]) }) : CONFIG_FAN_PLIC)
/** Corpul unei expedieri cere oPOD? (ce s-a aprobat / ce pleacă: hash-ul îl include) */
export const cereOpod = shipment => Array.isArray(shipment?.info?.options) && shipment.info.options.includes(OPTIUNE_OPOD)
/** Coloana lipsește (PostgREST 42703) = migrarea 20261227a neaplicată încă; ≠ eroare de citire (L18). */
export const lipsaColoana = e => e?.code === '42703' || /column .* does not exist/i.test(e?.message || '')
export const COLOANA_OPOD = 'opod'
/**
 * Rândul red_fan_loturi al unui lot, cu alegerea oPOD — O SINGURĂ definiție pentru ecran și funcția edge (L19; Jakarinos #1135 r1 P1).
 * citeste(coloane) → { data, error } (PostgREST .maybeSingle(), cu JWT-ul omului). Se cere întâi cu coloana `opod`; dacă coloana lipsește
 * (42703: migrarea 20261227a neaplicată), se recitește FĂRĂ ea și rândul primește opod = null („alegerea neinstalată”): marcajul TEST / real,
 * urmărirea, confirmările, etichetele, reconcilierea și ștergerea merg ca înainte; DOAR generarea refuză (opod ≠ boolean → 503, nimic trimis).
 * Orice altă eroare (RLS, rețea) se întoarce ca atare; rândul lipsă (lot nemarcat) rămâne { data: null }.
 * Întoarce și `opodInstalat` (runda 3, Jakarinos #1135 r2 P2): true = citirea cu coloana a reușit (coloana există — și când lotul n-are rând),
 * false = coloana lipsește (42703), null = nu se știe (altă eroare). Ecranul oprește cu el propunerea / aprobarea / generarea cât coloana lipsește,
 * ca nicio aprobare „fără B” să nu preceadă deducerea istorică a migrării (loturile aprobate înainte = oPOD).
 */
export async function citesteLotFan(citeste, coloane) {
  const r = await citeste(`${coloane},${COLOANA_OPOD}`)
  if (!r?.error) return { ...r, opodInstalat: true }
  if (!lipsaColoana(r.error)) return { ...r, opodInstalat: null }
  const r2 = await citeste(coloane)
  if (r2?.error || !r2?.data) return { ...r2, opodInstalat: false }
  return { ...r2, data: { ...r2.data, [COLOANA_OPOD]: null }, opodInstalat: false }
}

// Limitele din documentația FAN (caractere). Depășirea = problemă afișată, NU tăiere tacită (L12).
export const LIMITE_FAN = Object.freeze({ name: 50, phone: 16, county: 50, locality: 50, street: 255, content: 255, costCenter: 40 })

// Limitele pe SOLICITARE din documentația actuală (doc §1): 100 de expedieri la creare, 100 de AWB-uri la urmărire și la confirmări.
export const MAX_PE_CERERE = 100
// Eticheta: formatul CERUT curierului = A6 (100×150 mm, imprimanta termică) — decizia proprietarului (doc §8, întrebarea 5 închisă); parametrul
// `format` e cel din documentația FAN (doc §1). 18.11.2026 (Testul 1): PDF-ul întors cu `format=A6` a avut pagina A4 → numele butonului și al
// fișierului NU mai afirmă A6 (doc §8, deschisă 17: întrebare pentru curier); formatul paginii se verifică pe PDF înainte de tipărire.
export const FORMAT_ETICHETA = 'A6'
// Lotul pilot: plafonul implicit de plicuri pe lot (setarea din BD, red_fan_setari.limita_lot, are ACEEAȘI valoare implicită — test de paritate).
export const LIMITA_LOT_PILOT_IMPLICITA = 20
export const URL_FAN = 'https://api.fancourier.ro'

const txt = v => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())
const RE_NR_PLIC = /^PL-[A-Z]{3}-[0-9]{4}$/
const RE_AWB = /^[0-9]{6,20}$/

/** Telefonul în forma acceptată de FAN: cifre, cu „+” opțional în față; spațiile / cratimele / punctele se scot. null = lipsă sau invalid. */
export function telefonFan(v) {
  const t = txt(v).replace(/[\s.\-()/]/g, '')
  if (!t) return null
  if (!/^\+?[0-9]{9,15}$/.test(t)) return null
  return t
}

/**
 * Corpul unui element din `shipments` (POST /intern-awb) pentru un plic + problemele care blochează generarea.
 * plic: { nr_plic, destinatar_nume } (red_plicuri); contact: { telefon, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal }
 * (red_detinatori_contact — PII, doar admin/editor); proiectCod: red_proiecte.cod (centrul de cost pe factura FAN).
 * Întoarce { ok, shipment, probleme: [text] }. În `content` / `observation` intră DOAR nr_plic (fără nume / date personale):
 * e câmpul de referință care ajunge pe etichetă (verificarea celor trei numere, doc §10) și cheia reconcilierii (borderoul zilei).
 */
export function construiestePlicFan({ plic, contact, proiectCod, config = CONFIG_FAN_PLIC } = {}) {
  const probleme = []
  const nrPlic = txt(plic?.nr_plic)
  if (!RE_NR_PLIC.test(nrPlic)) probleme.push('numărul plicului lipsește sau e invalid')
  const nume = txt(plic?.destinatar_nume)
  if (!nume) probleme.push('destinatarul nu are nume')
  else if (nume.length > LIMITE_FAN.name) probleme.push(`numele destinatarului are ${nume.length} caractere (FAN acceptă ${LIMITE_FAN.name})`)
  const telefon = telefonFan(contact?.telefon)
  if (!telefon) probleme.push(txt(contact?.telefon) ? 'telefonul destinatarului e invalid' : 'telefonul destinatarului lipsește (obligatoriu la FAN)')
  else if (telefon.length > LIMITE_FAN.phone) probleme.push(`telefonul are peste ${LIMITE_FAN.phone} caractere`)
  const judet = txt(contact?.adresa_judet)
  const localitate = txt(contact?.adresa_sat) || txt(contact?.adresa_comuna)
  const strada = txt(contact?.adresa_strada)
  if (!judet) probleme.push('județul lipsește')
  else if (judet.length > LIMITE_FAN.county) probleme.push('județul e prea lung')
  if (!localitate) probleme.push('localitatea (sat / comună) lipsește')
  else if (localitate.length > LIMITE_FAN.locality) probleme.push('localitatea e prea lungă')
  if (!strada) probleme.push('strada lipsește')
  else if (strada.length > LIMITE_FAN.street) probleme.push('strada e prea lungă')
  const zip = txt(contact?.cod_postal)
  if (zip && !/^[0-9]{6}$/.test(zip)) probleme.push('codul poștal nu are 6 cifre')
  const centru = txt(proiectCod)   // Jakarinos r1 P2 (L12/L16): fără tăiere — două coduri lungi ar ajunge la același centru de cost
  if (!centru) probleme.push('codul proiectului lipsește')
  else if (centru.length > LIMITE_FAN.costCenter) probleme.push(`codul proiectului are peste ${LIMITE_FAN.costCenter} caractere (centrul de cost FAN)`)
  const shipment = {
    info: {
      service: config.service,
      packages: { ...config.packages },
      weight: config.weight,
      payment: config.payment,
      content: nrPlic,
      observation: nrPlic,
      dimensions: { ...config.dimensions },
      costCenter: centru,
      options: [...config.options],
    },
    recipient: {
      name: nume, contactPerson: nume, phone: telefon || '',
      address: { county: judet, locality: localitate, street: strada, ...(zip ? { zipCode: zip } : {}) },
    },
  }
  return { ok: probleme.length === 0, shipment, probleme }
}

/** Pentru fiecare plic: contactul primului deținător din plic care are telefon (altfel primul), ordine stabilă după id.
 *  O SINGURĂ definiție (L19): ecranul (previzualizare + propunere) și funcția edge (recalcularea hash-ului la generare) o folosesc identic. */
export function contactPePlic(plicuri, convocari, contacte) {
  const peDet = new Map((contacte || []).map(c => [c.detinator_id, c]))
  const detPePlic = new Map()
  for (const c of convocari || []) {
    if (!c.plic_id) continue
    if (!detPePlic.has(c.plic_id)) detPePlic.set(c.plic_id, [])
    detPePlic.get(c.plic_id).push(c.detinator_id)
  }
  return (plicuri || []).map(p => {
    const lista = [...new Set(detPePlic.get(p.id) || [])].sort().map(id => peDet.get(id)).filter(Boolean)
    return { plic: p, contact: lista.find(c => String(c.telefon || '').trim()) || lista[0] || null }
  })
}

/** Plicurile gata de propunere / de generat: contactul ales + corpul FAN + hash-ul. Aceeași funcție în ecran și în edge (L19).
 *  opod = alegerea lotului (red_fan_loturi.opod): intră în corp (options) și deci în hash → valoarea VĂZUTĂ la aprobare e EXACT cea folosită la
 *  generare (alt opod după aprobare = alt hash = rândul exclus de la generare și refuzat de claim). */
export async function pregatestePlicuriFan({ plicuri, convocari, contacte, proiectCod, opod = false, subtle = globalThis.crypto?.subtle }) {
  const out = []
  const config = configPlicFan({ opod })
  for (const { plic, contact } of contactPePlic(plicuri, convocari, contacte)) {
    const r = construiestePlicFan({ plic, contact, proiectCod, config })
    out.push({ plic, contact, ...r, hash: await hashPlicFan(r.shipment, subtle) })
  }
  return out
}

// JSON canonic (chei sortate) — baza hash-ului aprobat de owner: același plic, aceleași date → același hash.
export function jsonCanonic(v) {
  if (Array.isArray(v)) return '[' + v.map(jsonCanonic).join(',') + ']'
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + jsonCanonic(v[k])).join(',') + '}'
  return JSON.stringify(v ?? null)
}

/** sha256 hex pe JSON-ul canonic al elementului (Web Crypto: browser și Deno). Generarea refuză rândul dacă hash-ul curent ≠ cel aprobat. */
export async function hashPlicFan(shipment, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error('Web Crypto indisponibil')
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(jsonCanonic(shipment)))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Ordinea pe lot = numărul plicului (etichete, documente, solicitări). Comparație de text simplă: PL-XXX-0001 are lungime fixă. */
export const comparaPlic = (a, b) => (txt(a?.nr_plic) < txt(b?.nr_plic) ? -1 : txt(a?.nr_plic) > txt(b?.nr_plic) ? 1 : 0)

/** Bucăți de cel mult `max` (implicit 100, limita FAN pe solicitare), în ordinea primită. max în afara 1..100 = eroare, nu tăcere. */
export function imparteInBucati(lista, max = MAX_PE_CERERE) {
  if (!Number.isInteger(max) || max < 1 || max > MAX_PE_CERERE) throw new Error(`mărimea bucății trebuie să fie între 1 și ${MAX_PE_CERERE}`)
  const out = []
  for (let i = 0; i < (lista || []).length; i += max) out.push(lista.slice(i, i + max))
  return out
}

// ── interpretarea răspunsului POST /intern-awb ──
// Jakarinos r1/r2 P2 (L18): tarif lipsă = necunoscut (null), nu 0; doar număr finit sau text zecimal.
const numar = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(v.trim()) && Number.isFinite(Number(v.trim())) ? Number(v.trim()) : null)
/** O sumă FAN (tarif / TVA) din răspunsul FAN sau din coloana numeric citită prin PostgREST (text „27.1600”): număr finit ≥ 0 sau null =
 *  necunoscut (L18: necunoscut ≠ 0). O SINGURĂ definiție (L19) pentru funcția edge (scrierea) și ecran (afișarea tarifului). */
export const sumaFan = v => { const n = numar(v); return n == null || n < 0 ? null : n }
const areErori = erori => !!erori && (Array.isArray(erori) ? erori.length > 0 : typeof erori === 'object' ? Object.keys(erori).length > 0 : !!String(erori).trim())
const textAwb = v => (v == null ? '' : String(v).trim())

// Jakarinos #1118 r1 P2 (mesajele FAN, PII): motivul unui refuz NU copiază textul FAN (poate conține valoarea respinsă: telefon, adresă).
// Se păstrează DOAR numele câmpurilor de mai jos (lista albă = câmpurile corpului trimis, §2 din doc) + un mesaj local controlat.
export const CAMPURI_EROARE_FAN = Object.freeze(['clientId', 'shipments', 'info', 'service', 'packages', 'parcel', 'envelope', 'weight', 'payment', 'content',
  'observation', 'dimensions', 'length', 'width', 'height', 'costCenter', 'options', 'recipient', 'name', 'contactPerson', 'phone', 'address', 'county',
  'locality', 'street', 'streetNo', 'zipCode'])
const CAMP_EROARE = new Set(CAMPURI_EROARE_FAN)
/** Numele câmpurilor semnalate de FAN în `errors` (chei de obiect, inclusiv „recipient.phone” / „shipments[0].info”), DOAR din lista albă,
 *  sortate. Textele (mesajele FAN, valorile) nu se citesc niciodată: elementele-text ale listelor se sar. */
export function campuriEroareFan(erori) {
  const gasite = new Set()
  const viz = (v, adancime) => {
    if (v == null || adancime > 5 || typeof v !== 'object') return
    if (Array.isArray(v)) { for (const x of v) viz(x, adancime + 1); return }
    for (const [k, x] of Object.entries(v)) {
      for (const seg of String(k).split(/[.[\]]+/)) if (CAMP_EROARE.has(seg)) gasite.add(seg)
      viz(x, adancime + 1)
    }
  }
  viz(erori, 0)
  return [...gasite].sort()
}
export const motivRefuzFan = erori => {
  const c = campuriEroareFan(erori)
  return c.length ? `FAN a respins expedierea; câmpuri semnalate: ${c.join(', ')} (detaliile în selfAWB)` : 'FAN a respins expedierea (fără câmp recunoscut; detaliile în selfAWB)'
}

/** Referința noastră (nr_plic) așa cum ar putea-o întoarce FAN pe un element: content / observation, direct sau sub `info`.
 *  Câmpurile sunt PRESUPUNERE (doc §8 deschisă 11): pe un câmp prezent se verifică, pe unul absent asocierea rămâne pe poziție. */
export function referinteElement(el) {
  if (!el || typeof el !== 'object') return []
  return [el.info?.observation, el.info?.content, el.observation, el.content].filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean)
}

/** Un element din `response` → { stare, awb?, tarif?, tva?, motiv? } (fără HTTP). */
function interpreteazaElement(r) {
  r = r && typeof r === 'object' ? r : {}
  // Jakarinos r2 P2 (L13/L18): un AWB numeric peste Number.MAX_SAFE_INTEGER a fost deja rotunjit de JSON.parse → nu se acceptă
  if (typeof r.awbNumber === 'number' && !Number.isSafeInteger(r.awbNumber)) return { stare: 'necunoscut', motiv: 'număr AWB numeric nesigur (precizie pierdută)' }
  const awb = textAwb(r.awbNumber)
  if (areErori(r.errors) && !awb) return { stare: 'eroare', motiv: motivRefuzFan(r.errors) }
  if (!RE_AWB.test(awb)) return { stare: 'necunoscut', motiv: 'răspuns FAN fără număr AWB valid' }
  return { stare: 'generat', awb, tarif: numar(r.tariff), tva: numar(r.vat) }
}

/**
 * Răspunsul POST /intern-awb pentru o solicitare cu `n` expedieri (1…100) → o listă de `n` rezultate, în ordinea trimisă.
 * Asocierea element trimis ↔ element primit (Jakarinos #1118 r1, „Bani”): dacă elementul poartă referința noastră (content / observation,
 * `referinteElement`), ea trebuie să fie EXACT numărul plicului de pe acea poziție (`referinte[i]`) — o referință diferită pe ORICE element =
 * toată bucata „necunoscut” (asocierea contrazisă, reconciliere). Fără referință în răspuns, asocierea rămâne pe POZIȚIE: PRESUPUNERE de
 * confirmat pe răspunsul real (doc §8 deschisă 11, Testul 1); rezultatul o spune (`asociere: 'pozitie' | 'referinta'`). Alt număr de
 * elemente decât `n` = toate „necunoscut” (asocierea nu se ghicește).
 * HTTP 0 / 5xx / corp neparsabil = toate „necunoscut” (L05: AWB-urile pot exista; fără retry automat).
 * 4xx = refuz determinist („eroare”) — DAR dacă răspunsul de refuz conține vreun număr AWB, toată bucata e „necunoscut”; iar 429 (spec F1, §8.8,
 * L05) NU e un refuz al conținutului, ci o cerere de pauză → toate „necunoscut” (pe calea nouă `trimite`, un 429 FĂRĂ niciun AWB devine observația
 * `neincercat` înaintea scrierii în BD, iar starea o decide BD-ul după presupunerea P429; pe calea veche rămâne „necunoscut” → reconciliere).
 * Același număr AWB pe două elemente = ambele „necunoscut”.
 */
export const COD_PAUZA_FAN = 429
export const OBSERVATIE_NEINCERCAT = 'neincercat'
export function interpreteazaRaspunsLot(status, corp, n, { referinte } = {}) {
  if (!Number.isInteger(n) || n < 1 || n > MAX_PE_CERERE) throw new Error('număr de expedieri invalid')
  if (referinte != null && (!Array.isArray(referinte) || referinte.length !== n)) throw new Error('referințele trebuie să aibă exact n elemente')
  const toate = (stare, motiv) => Array.from({ length: n }, () => ({ stare, motiv }))
  if (!Number.isInteger(status) || status >= 500 || status <= 0) return toate('necunoscut', `răspuns FAN neconfirmat (HTTP ${status})`)
  const el = Array.isArray(corp?.response) ? corp.response : null
  if (status >= 400) {
    if (el && el.some(e => textAwb(e?.awbNumber))) return toate('necunoscut', `refuz FAN (HTTP ${status}) cu număr AWB în răspuns: de verificat în borderou`)
    if (status === COD_PAUZA_FAN) return toate('necunoscut', 'FAN: prea multe solicitări (HTTP 429); rularea s-a oprit; de verificat în borderou înainte de retrimitere')
    return toate('eroare', `FAN a refuzat cererea (HTTP ${status})`)
  }
  if (!el || el.length !== n) return toate('necunoscut', `răspuns FAN cu ${el ? el.length : 'niciun'} element(e) pentru ${n} expedieri: asocierea nu se ghicește`)
  if (referinte) {
    const gresit = el.findIndex((e, i) => { const r = referinteElement(e); return r.length > 0 && r.some(x => x !== referinte[i]) })
    if (gresit >= 0) return toate('necunoscut', `elementul ${gresit + 1} al răspunsului poartă altă referință decât plicul de pe poziția lui: asocierea nu se face, reconciliază`)
  }
  const rez = el.map(e => ({ ...interpreteazaElement(e), ...(referinte ? { asociere: referinteElement(e).length ? 'referinta' : 'pozitie' } : {}) }))
  const vazute = new Map()
  rez.forEach((r, i) => { if (r.awb) vazute.set(r.awb, [...(vazute.get(r.awb) || []), i]) })
  for (const idx of vazute.values()) if (idx.length > 1) for (const i of idx) rez[i] = { stare: 'necunoscut', motiv: 'același AWB pe mai multe elemente ale răspunsului' }
  return rez
}

/**
 * Răspunsul DELETE /awb (Jakarinos #1118 r1 P2): succes DOAR la forma de succes recunoscută — HTTP 200 + obiect JSON cu `status: "success"`
 * și fără erori (forma generală a răspunsurilor FAN, ca la login; PRESUPUNERE de confirmat pe răspunsul real, doc §8 deschisă 15).
 * Orice altceva (200 cu eroare, corp gol / altă formă, 204, 5xx, rețea) = „necunoscut”: AWB-ul rămâne „generat”, omul verifică în selfAWB.
 * 4xx = „refuzat” (determinist): AWB-ul rămâne.
 */
export function interpreteazaStergere(status, corp) {
  if (!Number.isInteger(status) || status <= 0 || status >= 500) return { rezultat: 'necunoscut', motiv: `ștergere neconfirmată (HTTP ${status})` }
  if (status >= 400) return { rezultat: 'refuzat', motiv: `FAN a refuzat ștergerea (HTTP ${status})` }
  const obiect = corp && typeof corp === 'object' && !Array.isArray(corp)
  if (status === 200 && obiect && corp.status === 'success' && !areErori(corp.errors) && !areErori(corp.error)) return { rezultat: 'sters' }
  return { rezultat: 'necunoscut', motiv: `răspuns FAN la ștergere fără confirmarea de succes recunoscută (HTTP ${status})` }
}

/** Compatibil cu scheletul: răspunsul pentru O singură expediere. */
export const interpreteazaRaspunsAwb = (status, corp) => interpreteazaRaspunsLot(status, corp, 1)[0]

// ── F1: butonul unic (spec §8.1, §8.3, §8.4.1) — definiții comune funcției edge și ecranului (L19) ──
/** Hash-ul CERERII (idempotența intenției, L04): sha256 pe lista canonică (sortată, distinctă) a plicurilor cerute; același în ecran (registrul local) și în edge. */
export async function hashCerereFan(plicIds, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error('Web Crypto indisponibil')
  const lista = [...new Set((plicIds || []).map(String))].sort()
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode('redari-fan-cerere-v1|' + lista.join(',')))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}
/** Motivele anulării unui AWB neridicat (codul din listă = CHECK-ul red_fan_awb.anulare_ceruta_motiv / motiv_anulare; alt_motiv cere notă ≤ 200). */
export const MOTIVE_ANULARE = Object.freeze(['netiparit_3_zile', 'neridicat_3_zile', 'plic_retras', 'date_gresite', 'alt_motiv'])
/** Codurile SQLSTATE ale refuzurilor comenzii / tirajului (spec §8.5), o singură listă pentru edge și ecran. */
export const CODURI_FAN = Object.freeze({ RD030: 'in_curs', RD031: 'lot_neincheiat', RD032: 'doar_test', RD033: 'rezultat_necunoscut', RD034: 'intentie_inchisa',
  RD035: 'anulare_in_curs', RD036: 'lot_tiparit', RD037: 'cerere_deschisa', RD038: 'opod_schimbat' })

// ── evenimente de urmărire (GET /reports/awb-events) ──
// Lista din PDF-ul 09.2025 (doc §1), completată pe 18.11.2026 cu lista REALĂ întoarsă de /reports/awb-events la Testul 1 (37 de coduri
// neclasificate atunci; clasificarea DOAR după numele dat de curier și regulile de mai jos — doc §1). Doar PROPUNERI afișate omului:
// ridicarea, AR-ul și returul le confirmă omul. Un cod al cărui sens pentru o convocare nu e limpede din nume stă în `de_verificat`
// (ca ultim eveniment = „de verificat de om”, L18), nu se ghicește.
export const EVENIMENTE_FAN = Object.freeze({
  ridicat: Object.freeze(['C0']),
  livrat: Object.freeze(['S2']),
  // „Notified …” = avizat (destinatarul anunțat, plicul așteaptă): S21 fără persoană de contact, S22 fără banii de ramburs, S24 fără delegație / act
  avizat: Object.freeze(['S3', 'S11', 'S21', 'S22', 'S24']),
  adresa: Object.freeze(['S4', 'S10', 'S19', 'S20', 'S25', 'S27', 'S28', 'S42']),
  mutat: Object.freeze(['S5']),
  refuz: Object.freeze(['S6']),
  retur: Object.freeze(['S16', 'S33', 'S43']),
  // S50 „confirmare refuzată”: plicul poate fi livrat, dar confirmarea nu s-a semnat → judecată umană (juridic), nu retur automat
  confirmare_refuzata: Object.freeze(['S50']),
  // contact cu destinatarul, fără schimbarea stării: S30 nu răspunde la telefon; S12 „Contacted; further delivery” (contactat, livrare reluată)
  neutru: Object.freeze(['S30', 'S12']),
  // mișcarea plicului în rețeaua curierului (preluat pentru livrare, în tranzit, în depozit, sortat, livrare în curs, retrimis la livrare):
  // nu schimbă faptele (ridicare, livrare, retur); ca ultim eveniment = „în tranzit”
  tranzit: Object.freeze(['C1', 'H0', 'H1', 'H2', 'H3', 'H4', 'H10', 'H11', 'H12', 'H13', 'H15', 'H17', 'S1', 'S35']),
  // S98 „Registered AWB”: AWB-ul e înregistrat la curier, plicul încă neridicat (starea de după generare); nu e tranzit și nu e ridicare
  inregistrat: Object.freeze(['S98']),
  // sens nelimpede din nume pentru o convocare → de verificat de om: S7 plata transportului respinsă, S9 redirecționat, S14 acces restricționat
  // la adresă, S15 ramburs refuzat, S37 despăgubit, S38 AWB neexpediat, S46 / S47 „Shed …”, S49 activitate suspendată, S54 / S55 / S67 locker,
  // S56 predat la punct de livrare, S64 fără acte vamale, S65 în așteptare, S69 livrare suspendată pentru adresă, S99 AWB șters din baza curierului
  de_verificat: Object.freeze(['S7', 'S8', 'S9', 'S14', 'S15', 'S37', 'S38', 'S46', 'S47', 'S49', 'S54', 'S55', 'S56', 'S64', 'S65', 'S67', 'S69', 'S99']),
})
const CATEGORIE = new Map(Object.entries(EVENIMENTE_FAN).flatMap(([cat, coduri]) => coduri.map(c => [c, cat])))
export const categorieEveniment = cod => CATEGORIE.get(cod) || null
// Semnalele de retur → motivul propus (MOTIVE_RETUR din src/redari/ui/comune.jsx = CHECK-ul red_plicuri.retur). Omul îl poate schimba
// (ex. „destinatar necunoscut” în loc de „adresă incompletă”): codul FAN pentru „destinatar negăsit” nu e în lista de lucru (doc §8).
export const RETUR_DIN_CATEGORIE = Object.freeze({ refuz: 'refuz', adresa: 'adresa_incompleta', mutat: 'mutat', avizat: 'avizat_neridicat' })
const RE_COD_EVENIMENT = /^[A-Z]{1,2}[0-9]{1,3}$/

/**
 * Data/ora unui eveniment FAN → { data: 'AAAA-LL-ZZ', local: 'AAAA-LL-ZZ HH:MM:SS' } în Europe/Bucharest (L17), sau null.
 * Fără fus orar în text („2026-11-10 15:00:00”) = ora locală României (PRESUPUNERE de verificat pe un răspuns real, doc §8).
 * Cu „Z” / „+02:00” = se convertește în Europe/Bucharest. Orice altă formă = null (de verificat de om).
 */
export function dataEvenimentFan(v) {
  const s = typeof v === 'string' ? v.trim() : ''
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})?$/.exec(s)
  if (!m) return null
  const [, a, l, z, h, mi, se = '00', fus] = m
  const valid = (() => { const d = new Date(Date.UTC(+a, +l - 1, +z, +h, +mi, +se)); return d.getUTCFullYear() === +a && d.getUTCMonth() === +l - 1 && d.getUTCDate() === +z && +h < 24 && +mi < 60 && +se < 60 })()
  if (!valid) return null
  if (!fus) return { data: `${a}-${l}-${z}`, local: `${a}-${l}-${z} ${h}:${mi}:${se}` }
  const ms = Date.parse(`${a}-${l}-${z}T${h}:${mi}:${se}${fus === 'Z' ? 'Z' : fus.length === 5 ? fus.slice(0, 3) + ':' + fus.slice(3) : fus}`)
  if (!Number.isFinite(ms)) return null
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return { data: `${p.year}-${p.month}-${p.day}`, local: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}` }
}

/**
 * Urmărirea unui AWB (un element din răspunsul GET /reports/awb/tracking) → starea pentru evidență:
 * { urmarire_stare, ultim_eveniment, ultim_eveniment_la, ridicat_propus, livrat_la, retur_propus, motiv }
 * urmarire_stare: 'fara_evenimente' | 'in_tranzit' | 'ridicat' | 'livrat' | 'retur' | 'de_verificat'.
 * - retur: un cod de retur (S16/S33/S43) sau returnAwbNumber, ori ULTIMUL eveniment e refuz / adresă greșită / mutat;
 *   retur_propus = motivul ultimului semnal (refuz → 'refuz', adresă → 'adresa_incompleta', mutat → 'mutat', avizat → 'avizat_neridicat'), null dacă nu e clar.
 * - de_verificat: evenimente cu formă necunoscută, ultimul eveniment cu cod necunoscut sau din categoria `de_verificat` (coduri FAN cu sens
 *   nelimpede pentru o convocare, 18.11.2026), sau „confirmare refuzată” (L12: nimic nu dispare tacit).
 * - tranzit / inregistrat / neutru nu schimbă faptele: ca ultim eveniment dau „în tranzit” (sau „ridicat” / „livrat” după faptele cunoscute);
 *   ecranul deosebește „AWB înregistrat, neridicat” (S98) după ultimul eveniment (fanLot.js, etichetaUrmarire).
 * - CONTRADICȚII în ACELAȘI răspuns (decizia owner-ului 21.11.2026, runda 2 #1155: „mergem pe ce livrează API-ul”): NU mai blochează rândul la
 *   om. TOATE se evaluează ÎNAINTE de a construi faptele (nu doar prima), apoi faptele urmează regula deterministă REGULI_CONTRADICTII:
 *   ridicări (C0) în zile diferite → PRIMA zi; livrări (S2) la ore diferite → ULTIMA oră; livrare + retur → evenimentul final ULTERIOR (după ora
 *   curierului) câștigă, la egalitate sau cu retur fără oră (returnAwbNumber) → retur. Fiecare contradicție iese în `contradictii`
 *   ({ tip, valori, ales, regula }), pe care BD-ul o păstrează DURABIL (red_fan_contradictii, 20270102a), ca semnal de audit. Evenimentele
 *   identice repetate (același cod, aceeași dată) = un singur fapt; două C0 în aceeași zi = o singură zi, nu contradicție.
 * - Evenimente de formă necunoscută (cod sau dată) = de_verificat FĂRĂ fapte (un eveniment pierdut poate fi chiar al doilea C0: nimic nu se
 *   înregistrează automat dintr-o cronologie incompletă, L12); ultimul eveniment citit rămâne, pentru cronologie.
 * - Runda 3 (Jakarinos #1155 r2 P1): evenimentele cu ACEEAȘI oră nu mai depind de ordinea listei FAN. „Ultimul eveniment” = TOATE evenimentele
 *   de la ora maximă: un refuz / adresă / mutat la ora finală e dovadă de retur oricare ar fi poziția lui (S2 + S6 la aceeași oră → retur, cu
 *   contradicția livrare_retur, în ambele ordini); un cod necunoscut / de verificat la ora finală dă „de verificat” oriunde ar sta. Departajarea
 *   explicită (ORDINE_EGALITATE, apoi codul) alege codul afișat ca ultim eveniment, codul returului din contradicție și motivul returului la
 *   egalitate (motive diferite la aceeași oră = contradicția retur_motiv). Peste LIMITA_VALORI_CONTRADICTIE zile C0 / ore S2 distincte = de_verificat.
 */
export const VERSIUNE_REGULA_CONTRADICTII = 'fan-contradictii-v1'
export const REGULI_CONTRADICTII = Object.freeze({
  ridicare_zile: 'prima_ridicare',      // mai multe zile C0: prima zi; o ridicare deja înregistrată nu se mută (BD); BD-ul ia prima zi POSIBILĂ (≥ generare, ≤ azi)
  livrare_ore: 'ultima_livrare',        // mai multe ore S2: ultima oră a curierului
  livrare_retur: 'final_ulterior',      // livrare și retur: finalul ulterior câștigă; egalitate / retur fără oră → retur
  // alt motiv de retur: între răspunsuri (BD) = motivul răspunsului mai nou (lipsa lui păstrează motivul cunoscut); în ACELAȘI răspuns (runda 3) =
  // semnale cu motive diferite la ACEEAȘI oră (ultima oră a semnalelor) → motivul după ORDINE_EGALITATE (refuz > adresă > mutat > avizat)
  retur_motiv: 'ultimul_semnal',
  ridicare_data_imposibila: 'data_imposibila',   // (doar BD) C0 înainte de generarea AWB-ului / în viitor: ziua aceea NU se înregistrează (nici nu se păstrează)
})
// Runda 3 #1155 (Jakarinos r2 P2, L12 / L19): limita COMUNĂ a valorilor unei contradicții, aceeași în BD (validarea din fn_red_fan_urmarire_scrie și
// CHECK-ul red_fan_contradictii.valori, 20270102a; testul de paritate le compară). Peste ea (un răspuns FAN cu > 50 de zile C0 / ore S2 distincte)
// rândul e „de verificat” FĂRĂ fapte din acel răspuns, cu numărul în motiv: nimic nu se taie în tăcere și BD-ul nu primește ce ar refuza
// (un refuz 22023 ar anula toată bucata, cu celelalte AWB-uri).
export const LIMITA_VALORI_CONTRADICTIE = 50
// Runda 3 #1155 (Jakarinos r2 P1, L11 / L19): DEPARTAJAREA evenimentelor cu ACEEAȘI oră, explicită și independentă de ordinea listei FAN.
// Ordinea completă a evenimentelor = (ora, rangul categoriei în lista de mai jos, codul); rang mai mare = „mai final” la egalitate. Retururile și
// semnalele de retur stau la capăt (egalitatea merge la retur), apoi codurile de verificat de om; mișcarea plicului la început.
export const ORDINE_EGALITATE = Object.freeze(['inregistrat', 'tranzit', 'neutru', 'ridicat', 'avizat', 'livrat', 'confirmare_refuzata', 'de_verificat',
  'necunoscut', 'mutat', 'adresa', 'refuz', 'retur'])
const rangEgalitate = cat => ORDINE_EGALITATE.indexOf(cat || 'necunoscut')
const ordineEvenimente = (a, b) => (a.la < b.la ? -1 : a.la > b.la ? 1 : rangEgalitate(a.cat) - rangEgalitate(b.cat) || (a.cod < b.cod ? -1 : a.cod > b.cod ? 1 : 0))
const SEMNAL_FINAL_RETUR = ['refuz', 'adresa', 'mutat']
// Runda 4 #1155 (Jakarinos r3 P2, L03 / L17 / L18 / L19): CRONOLOGIA (ultim_eveniment / ultim_eveniment_la și garda „ne-mai-veche” a scrierii) o
// stabilește BD-ul DOAR din evenimentele la un moment POSIBIL (ziua ≥ ziua generării AWB-ului și momentul ≤ acum, ora României; predicatul are O
// singură definiție, în fn_red_fan_urmarire_scrie, 20270102a). Un eveniment respins ca fapt pentru că data lui e imposibilă (ex. C0 în viitor) nu mai
// intră în cronologie, deci nu mai blochează corecția validă de la rularea următoare. Codul nu decide posibilitatea (nu știe nici ziua generării,
// nici ceasul bazei): trimite `evenimente` = evenimentele DISTINCTE citite, în ordinea completă (ordineEvenimente), ca texte „COD AAAA-LL-ZZ HH:MM:SS”,
// ultimul = ultim_eveniment + ultim_eveniment_la. Peste LIMITA_EVENIMENTE_CRONOLOGIE se trimit ultimele (cele mai noi): ultimul eveniment posibil
// e printre ele oricând măcar unul dintre ele e posibil; altfel BD-ul tratează răspunsul ca fără cronologie posibilă (nu avansează, nu blochează).
// Limita e aceeași în BD (validarea listei; testul de paritate le compară).
export const LIMITA_EVENIMENTE_CRONOLOGIE = 100
const listaCronologie = ev => ev.map(e => `${e.cod} ${e.la}`).filter((x, i, a) => i === 0 || x !== a[i - 1]).slice(-LIMITA_EVENIMENTE_CRONOLOGIE)
export function rezumatUrmarireFan(el) {
  const gol = { urmarire_stare: 'de_verificat', ultim_eveniment: null, ultim_eveniment_la: null, evenimente: [], ridicat_propus: null, livrat_la: null, retur_propus: null, retur_la: null, contradictii: [] }
  if (!el || typeof el !== 'object') return { ...gol, motiv: 'element de urmărire fără formă cunoscută' }
  // runda 3 (L18): lipsa listei ≠ listă goală — fără `events` (sau null) = formă necunoscută; `events: []` = „fără evenimente” (fără cronologie:
  // BD-ul nu șterge un eveniment cunoscut cu el, fn_red_fan_urmarire îl numără „păstrat”)
  if (!Array.isArray(el.events)) return { ...gol, motiv: el.events == null ? 'elementul de urmărire nu are lista de evenimente' : 'lista de evenimente are o formă necunoscută' }
  let stricat = false
  const ev = []
  for (const e of el.events) {
    const cod = typeof e?.id === 'string' ? e.id.trim() : ''
    const d = dataEvenimentFan(e?.date)
    if (!RE_COD_EVENIMENT.test(cod) || !d) { stricat = true; continue }
    ev.push({ cod, la: d.local, data: d.data, cat: categorieEveniment(cod) })
  }
  // ordinea COMPLETĂ (ora, rangul ORDINE_EGALITATE, codul): același set de evenimente dă același rezultat în orice ordine a listei FAN (runda 3 P1)
  ev.sort(ordineEvenimente)
  const ultim = ev.at(-1) || null
  const cronologie = { ultim_eveniment: ultim?.cod || null, ultim_eveniment_la: ultim?.la || null, evenimente: listaCronologie(ev) }
  if (stricat) return { ...gol, ...cronologie, motiv: 'evenimente cu cod sau dată de formă necunoscută (nimic înregistrat automat din acest răspuns)' }
  // „ultimul eveniment” = TOATE evenimentele de la ora maximă (nu doar elementul de la capătul listei): fiecare regulă care privește finalul le vede pe toate
  const laFinal = ev.filter(e => e.la === ultim?.la)
  // 1. TOATE contradicțiile, înaintea faptelor (Jakarinos #1155 r1 P1: nu se oprește la prima)
  const contradictii = []
  const distincte = (cat, cheie) => [...new Set(ev.filter(e => e.cat === cat).map(e => e[cheie]))].sort()
  const zileC0 = distincte('ridicat', 'data'), oreS2 = distincte('livrat', 'la')
  // runda 3 P2 (contractul JS = BD): peste limita comună de valori = „de verificat”, fără fapte, cu numărul în motiv (nimic tăiat în tăcere)
  const prea = [['zile de ridicare (C0)', zileC0.length], ['ore de livrare (S2)', oreS2.length]].filter(([, n]) => n > LIMITA_VALORI_CONTRADICTIE)
  if (prea.length) return { ...gol, ...cronologie, motiv: `prea multe ${prea.map(([t, n]) => `${t}: ${n}`).join(', ')} distincte în răspuns (limita ${LIMITA_VALORI_CONTRADICTIE}): nimic înregistrat automat, de verificat de om` }
  const ridicat = zileC0[0] || null
  if (zileC0.length > 1) contradictii.push({ tip: 'ridicare_zile', valori: zileC0, ales: ridicat, regula: REGULI_CONTRADICTII.ridicare_zile })
  const livratLa = oreS2.at(-1) || null
  if (oreS2.length > 1) contradictii.push({ tip: 'livrare_ore', valori: oreS2, ales: livratLa, regula: REGULI_CONTRADICTII.livrare_ore })
  // dovezile de retur: codurile de retur (S16 / S33 / S43), un refuz / adresă / mutat la ORA FINALĂ (oricare dintre evenimentele de la ora
  // maximă, nu doar ultimul din listă), returnAwbNumber (fără oră = cel mai târziu)
  const semnale = ev.filter(e => RETUR_DIN_CATEGORIE[e.cat])
  const ultimSemnal = semnale.at(-1) || null
  const returEv = [...ev.filter(e => e.cat === 'retur'), ...laFinal.filter(e => SEMNAL_FINAL_RETUR.includes(e.cat))].sort(ordineEvenimente)
  const returAwb = !!textAwb(el.returnAwbNumber)
  const ultimRetur = returEv.at(-1) || null
  const areRetur = returAwb || !!ultimRetur
  const returLa = returAwb ? null : ultimRetur?.la || null
  let final = areRetur ? 'retur' : livratLa ? 'livrat' : null
  if (areRetur && livratLa) {
    final = returLa !== null && livratLa > returLa ? 'livrat' : 'retur'
    contradictii.push({ tip: 'livrare_retur', valori: [`S2 ${livratLa}`, returAwb ? 'returnAwbNumber' : `${ultimRetur.cod} ${returLa}`], ales: final, regula: REGULI_CONTRADICTII.livrare_retur })
  }
  const returPropus = final === 'retur' && ultimSemnal ? RETUR_DIN_CATEGORIE[ultimSemnal.cat] : null
  // motive de retur diferite la ACEEAȘI oră (ultima oră a semnalelor): motivul după ORDINE_EGALITATE, contradicția păstrată (doar dacă finalul e retur)
  if (returPropus) {
    const motive = [...new Set(semnale.filter(e => e.la === ultimSemnal.la).map(e => RETUR_DIN_CATEGORIE[e.cat]))].sort()
    if (motive.length > 1) contradictii.push({ tip: 'retur_motiv', valori: motive, ales: returPropus, regula: REGULI_CONTRADICTII.retur_motiv })
  }
  // 2. faptele, după regulă
  const fapte = { ridicat_propus: ridicat, livrat_la: final === 'livrat' ? livratLa : null, retur_propus: returPropus, retur_la: final === 'retur' ? returLa : null }
  const rez = (urmarire_stare, extra = {}) => ({ ...cronologie, ...fapte, urmarire_stare, contradictii, ...extra })
  if (final === 'retur') return rez('retur')
  if (ev.some(e => e.cat === 'confirmare_refuzata')) return rez('de_verificat', { motiv: 'confirmare refuzată (S50): judecată umană' })
  // la ora finală: orice cod necunoscut / de verificat, oricare ar fi poziția lui în listă (codurile, în ordine, în motiv)
  const necunoscute = laFinal.filter(e => !e.cat).map(e => e.cod), deVerificat = laFinal.filter(e => e.cat === 'de_verificat').map(e => e.cod)
  if (necunoscute.length) return rez('de_verificat', { motiv: `ultimul eveniment are un cod necunoscut (${necunoscute.join(', ')})` })
  if (deVerificat.length) return rez('de_verificat', { motiv: `ultimul eveniment (${deVerificat.join(', ')}) cere verificarea omului (sens nelimpede pentru o convocare)` })
  if (final === 'livrat') return rez('livrat')
  if (ridicat) return rez('ridicat')
  return ev.length ? rez('in_tranzit') : rez('fara_evenimente')
}

const listaDin = corp => (Array.isArray(corp) ? corp : Array.isArray(corp?.data) ? corp.data : Array.isArray(corp?.response) ? corp.response : null)
const awbDin = el => {
  if (!el || typeof el !== 'object') return null
  for (const k of ['awbNumber', 'awb']) {
    const v = el[k]
    if (typeof v === 'number' && !Number.isSafeInteger(v)) return null
    if (v != null && RE_AWB.test(String(v).trim())) return String(v).trim()
  }
  return null
}

/**
 * Răspunsul GET /reports/awb/tracking pentru AWB-urile cerute (≤ 100) → { ok, pe_awb: Map(awb → rezumat), motiv }.
 * ok=false (HTTP 0 / 4xx / 5xx) = nu se scrie nimic (citire, nu bani).
 * Runda 2 #1155 (Jakarinos P2, L13 / L18): eroarea de SCHEMĂ a ÎNTREGULUI răspuns (nicio listă recunoscută, sau o listă nevidă în care niciun
 * element nu are un AWB recunoscut) = ok=false + forma_necunoscuta: NIMIC scris, rularea automată se oprește „oprita_eroare” (doc §4.6), butonul
 * arată eroarea. Altceva e un element ANUME: AWB cerut și absent din răspuns = „de_verificat” (de verificat de om pe acel AWB); elementele pentru
 * AWB-uri necerute sau fără AWB se ignoră, dar se numără (raportate).
 */
export function interpreteazaUrmarire(status, corp, awbs) {
  if (!Number.isInteger(status) || status <= 0 || status >= 400) return { ok: false, motiv: `urmărire neconfirmată (HTTP ${status})`, pe_awb: new Map(), necerute: 0 }
  const lista = listaDin(corp)
  const pe = new Map()
  const deVerificat = motiv => ({ urmarire_stare: 'de_verificat', ultim_eveniment: null, ultim_eveniment_la: null, evenimente: [], ridicat_propus: null, livrat_la: null, retur_propus: null, retur_la: null, contradictii: [], motiv })
  if (!lista) return { ok: false, forma_necunoscuta: true, motiv: 'răspuns de urmărire de formă necunoscută (fără listă recunoscută): nimic scris', pe_awb: pe, necerute: 0 }
  if (lista.length > 0 && !lista.some(el => awbDin(el))) return { ok: false, forma_necunoscuta: true, motiv: 'răspuns de urmărire fără niciun element cu AWB recunoscut: nimic scris', pe_awb: pe, necerute: 0 }
  const grup = new Map()
  let necerute = 0
  for (const el of lista) {
    const a = awbDin(el)
    if (!a || !awbs.includes(a)) { necerute++; continue }
    grup.set(a, [...(grup.get(a) || []), el])
  }
  for (const a of awbs) {
    const g = grup.get(a) || []
    pe.set(a, g.length === 1 ? rezumatUrmarireFan(g[0]) : deVerificat(g.length ? 'mai multe elemente pentru același AWB' : 'AWB absent din răspunsul de urmărire'))
  }
  return { ok: true, pe_awb: pe, necerute }
}

/**
 * Răspunsul GET /reports/awb/confirmations (listă JSON, doc §1) → confirmare_stare pe AWB:
 * 'lipsa' (lista nu are nimic pentru AWB) | 'primita_de_verificat' (există un element pentru AWB: conținutul se verifică de om — câmpurile
 * exacte sunt întrebarea deschisă 7 din doc §8) | 'forma_necunoscuta' (lista sau elementele nu au forma așteptată).
 * NICIODATĂ „confirmat” automat: AR-ul îl înregistrează omul. Răspunsul nu se stochează (poate conține numele primitorului).
 */
export function interpreteazaConfirmari(status, corp, awbs) {
  if (!Number.isInteger(status) || status <= 0 || status >= 400) return { ok: false, motiv: `confirmări neconfirmate (HTTP ${status})`, pe_awb: new Map() }
  const lista = listaDin(corp)
  const pe = new Map()
  if (!lista || lista.some(el => !awbDin(el))) { for (const a of awbs) pe.set(a, 'forma_necunoscuta'); return { ok: true, pe_awb: pe } }
  const cu = new Set(lista.map(awbDin))
  for (const a of awbs) pe.set(a, cu.has(a) ? 'primita_de_verificat' : 'lipsa')
  return { ok: true, pe_awb: pe }
}

/** Lista FAN de evenimente (GET /reports/awb-events) față de codurile folosite aici → ce lipsește la FAN și ce coduri FAN nu sunt clasificate. */
export function comparaEvenimente(status, corp) {
  if (!Number.isInteger(status) || status <= 0 || status >= 400) return { ok: false, motiv: `lista de evenimente neconfirmată (HTTP ${status})` }
  const lista = listaDin(corp)
  if (!lista) return { ok: false, motiv: 'lista de evenimente are o formă necunoscută (de verificat de om)' }
  const coduri = [], stricate = []
  for (const el of lista) {
    const c = typeof el?.id === 'string' ? el.id.trim() : typeof el?.code === 'string' ? el.code.trim() : ''
    if (RE_COD_EVENIMENT.test(c)) coduri.push({ cod: c, nume: txt(el?.name ?? el?.description).slice(0, 120) })
    else stricate.push(el)
  }
  if (!coduri.length) return { ok: false, motiv: 'lista de evenimente nu conține niciun cod recunoscut (de verificat de om)' }
  const laFan = new Set(coduri.map(c => c.cod))
  return { ok: true, lipsa_la_fan: [...CATEGORIE.keys()].filter(c => !laFan.has(c)).sort(),
    neclasificate: coduri.filter(c => !CATEGORIE.has(c.cod)).sort((a, b) => (a.cod < b.cod ? -1 : 1)), elemente_stricate: stricate.length }
}

/**
 * Reconcilierea unui rezultat necunoscut (doc §5): paginile borderoului zilei (GET /reports/awb?date=) → pentru fiecare nr_plic:
 * { stare: 'gasit', awb } | { stare: 'lipsa' } | { stare: 'de_verificat', motiv }. Doar PROPUNERI: omul confirmă (fn_red_fan_reconciliaza).
 * Căutarea: nr_plic EXACT în content / observation (direct sau sub `info`).
 * Jakarinos #1118 r1 P1: „lipsa” se propune DOAR dacă borderoul a fost citit complet (până la pagina goală) ȘI FIECARE element din FIECARE pagină
 * a fost interpretat complet: obiect, cu AWB valid și cu referința într-un câmp cunoscut, fără să conțină un număr căutat altfel decât exact.
 * Un singur element neinterpretabil (ex. AWB valid, referința într-un câmp necunoscut) = TOATE plicurile „de_verificat” (nici „lipsa”, nici
 * „gasit”: un al doilea AWB al aceluiași plic poate sta în elementul neînțeles) — omul verifică în selfAWB, nu confirmă absența.
 * Întoarce Map(nr_plic → propunere); `neinterpretabile` = numărul elementelor neînțelese (proprietate a Map-ului).
 */
export function cautaInBorderou(pagini, nrPlicuri, { complet }) {
  const tot = motiv => Object.assign(new Map(nrPlicuri.map(n => [n, { stare: 'de_verificat', motiv }])), { neinterpretabile: 0 })
  const pe = new Map(nrPlicuri.map(n => [n, []]))
  let neinterpretabile = 0
  for (const corp of pagini) {
    const lista = listaDin(corp)
    if (!lista) return tot('borderou de formă necunoscută')
    for (const el of lista) {
      const awb = el && typeof el === 'object' ? awbDin(el) || awbDin(el.info) : null
      const refs = referinteElement(el)
      if (!awb || !refs.length) { neinterpretabile++; continue }
      for (const n of nrPlicuri) {
        if (refs.includes(n)) pe.get(n).push(awb)
        else if (refs.some(x => x.includes(n))) { neinterpretabile++; break }   // numărul plicului într-o referință mai lungă: ambiguu
      }
    }
  }
  if (neinterpretabile) return Object.assign(tot(`borderoul are ${neinterpretabile} element(e) neinterpretabil(e) (fără AWB valid sau fără referința plicului într-un câmp cunoscut): verifică în selfAWB; nicio concluzie automată`), { neinterpretabile })
  return Object.assign(new Map(nrPlicuri.map(n => {
    const g = pe.get(n)
    if (g.length === 1) return [n, { stare: 'gasit', awb: g[0] }]
    if (g.length > 1) return [n, { stare: 'de_verificat', motiv: 'numărul plicului apare pe mai multe AWB-uri' }]
    return [n, complet ? { stare: 'lipsa' } : { stare: 'de_verificat', motiv: 'borderoul nu a fost citit complet' }]
  })), { neinterpretabile: 0 })
}

// ── manifestul COMUN al plicurilor tipărite (Jakarinos #1118 r1 P1: etichetele și documentele = aceeași mulțime, aceeași ordine) ──
/**
 * O SINGURĂ definiție (L19), folosită de funcția edge (PDF-ul etichetelor, `eticheta`) și de ecranul Plicuri (arhiva documentelor + pagina de
 * control). Intră DOAR plicurile ACTIVE ale lotului cu exact un rând FAN viu în stare generat / ridicat și AWB valid, în ordinea numărului de
 * plic; poziția 1…N apare pe pagina de control și în numele fișierelor din arhivă. Restul plicurilor active = „rămase” (NU se tipăresc, nici
 * etichetă, nici documente; sunt numite pe pagina de control). Un AWB viu pe un plic care nu mai e activ în lot = „rămas”, de anulat.
 * randuri: red_fan_awb ale lotului ({ id, plic_id, nr_plic, stare, awb }); plicuri: red_plicuri ale lotului ({ id, nr_plic, stare }).
 * Întoarce { tiparite: [{ pozitie, plic_id, nr_plic, awb, rand_id }], ramase: [{ plic_id, nr_plic, motiv }], cheie } — `cheie` = textul
 * canonic al tipăritelor (poziție:plic:AWB), comparat de funcția edge cu cel văzut în ecran (L03: manifest vechi = refuz).
 */
export function manifestTiparire({ randuri, plicuri }) {
  const vii = new Map()
  for (const r of randuri || []) if (r && !['eroare', 'anulat'].includes(r.stare)) vii.set(r.plic_id, [...(vii.get(r.plic_id) || []), r])
  const active = [...(plicuri || [])].filter(p => p?.stare === 'activ').sort(comparaPlic)
  const tiparite = [], ramase = []
  for (const p of active) {
    const v = vii.get(p.id) || []
    const r = v.length === 1 && ['generat', 'ridicat'].includes(v[0].stare) && RE_AWB.test(textAwb(v[0].awb)) ? v[0] : null
    if (r) tiparite.push({ pozitie: tiparite.length + 1, plic_id: p.id, nr_plic: p.nr_plic, awb: textAwb(r.awb), rand_id: r.id })
    else ramase.push({ plic_id: p.id, nr_plic: p.nr_plic, motiv: v.length > 1 ? 'mai multe rânduri FAN vii' : v.length ? `fără AWB tipăribil (stare FAN: ${v[0].stare})` : 'fără AWB FAN' })
  }
  const ids = new Set(active.map(p => p.id))
  for (const [plicId, v] of vii) if (!ids.has(plicId)) for (const r of v) if (r.awb) ramase.push({ plic_id: plicId, nr_plic: r.nr_plic, motiv: 'AWB pe un plic care nu mai e activ în lot: de anulat, nu se tipărește' })
  ramase.sort(comparaPlic)
  return { tiparite, ramase, cheie: tiparite.map(t => `${t.pozitie}:${t.nr_plic}:${t.awb}`).join('|') }
}
/** Partea `parte` (1…) a manifestului: bucăți de cel mult 100 (limita prudentă pe apelul de etichete), în ordinea pozițiilor. */
export const partiManifest = tiparite => imparteInBucati(tiparite || [])

// ── TIRAJUL (runda 3, Jakarinos #1118 r2 P1): o cheie de manifest pentru TOATE descărcările unui tiraj ──
// Manifestul garantează aceeași mulțime și ordine pentru ACEEAȘI stare; tirajul leagă descărcările făcute în momente diferite (fiecare parte a
// etichetelor, arhiva documentelor): cheia = sha256 pe textul canonic al manifestului (poziție:plic:AWB, în ordine), fixată în BD la PRIMA
// descărcare (fn_red_fan_tiraj) și cerută identic la fiecare descărcare următoare; altă cheie = refuz („retipărește tot lotul”).
// O SINGURĂ definiție (L19): funcția edge (etichetele) și ecranul (arhiva, „Tiraj nou”) o cheamă identic.
export const VERSIUNE_TIRAJ = 'redari-fan-tiraj-v1'
export const COD_TIRAJ_SCHIMBAT = 'RD020'   // SQLSTATE-ul refuzului din fn_red_fan_tiraj
export const MESAJ_TIRAJ_SCHIMBAT = 'Tirajul s-a schimbat; retipărește tot lotul: owner-ul oprește descărcările tirajului început, după 30 de secunde se distrug foile lui (etichete, pagina de control, documente) și fișierele descărcate, owner-ul înlocuiește tirajul, apoi se descarcă din nou toate părțile etichetelor și arhiva documentelor.'
export async function cheieTiraj(manifest, subtle = globalThis.crypto?.subtle) {
  if (!manifest || !Array.isArray(manifest.tiparite) || !manifest.tiparite.length || typeof manifest.cheie !== 'string' || !manifest.cheie) throw new Error('manifest fără plicuri tipărite: nu există tiraj')
  if (!subtle) throw new Error('Web Crypto indisponibil')
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(`${VERSIUNE_TIRAJ}|${manifest.cheie}`))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}
/** Identificatorul SCURT al tirajului (vizibil pe pagina de control și în numele fișierelor): primele 8 caractere ale cheii, majuscule. */
export const idTiraj = cheie => (typeof cheie === 'string' && /^[0-9a-f]{64}$/.test(cheie) ? cheie.slice(0, 8).toUpperCase() : null)
/** Rezultatul fn_red_fan_tiraj → { stare, cheie, id, nr, inceput_la } DOAR la forma exactă și cu cheia cerută; altfel null (L18: neconfirmat). */
export function tirajDin(data, cheie) {
  const d = data && typeof data === 'object' && !Array.isArray(data) ? data : null
  if (!d || !['inceput', 'acelasi', 'inlocuit'].includes(d.stare) || d.cheie !== cheie || !idTiraj(cheie)) return null
  if (!Number.isInteger(d.nr) || d.nr < 1 || typeof d.inceput_la !== 'string' || !Number.isFinite(Date.parse(d.inceput_la))) return null
  return { stare: d.stare, cheie, id: idTiraj(cheie), nr: d.nr, inceput_la: d.inceput_la }
}

// ── OPRIREA tirajului și REVERIFICAREA FINALĂ (runda 4, Jakarinos #1118 r3 P1) ──
// O descărcare verifică tirajul de DOUĂ ori: la început (îl începe / îl confirmă) și din nou DUPĂ ce are fișierul (PDF-ul FAN, arhiva,
// pagina de control), înainte să-l livreze: aceeași cheie ȘI același nr., altfel nimic livrat. Înlocuirea cere întâi OPRIREA descărcărilor
// (fn_red_fan_tiraj_opreste, owner): cât e pusă, ambele verificări sunt refuzate (RD021), deci după ce oprirea e comisă nicio descărcare a
// tirajului vechi nu se mai termină. Înlocuirea e permisă abia după ASTEPTARE_DUPA_OPRIRE_S secunde de la oprire (aceeași valoare ca
// `interval '30 seconds'` din fn_red_fan_tiraj, test de paritate). Runda 5 (Jakarinos #1118 r4 P1): cele 30 s se numără de la MOMENTUL
// EFECTIV al opririi (clock_timestamp() după lock-uri, nu începutul tranzacției, nu COMMIT-ul) și se verifică tot cu ceasul efectiv al BD-ului;
// orice reverificare finală trecută s-a comis înaintea acelui moment. NU garantează că fișierele livrate au ajuns la om: un transfer mai lung
// de 30 s și distrugerea foilor rămân procedurale.
export const COD_TIRAJ_OPRIT = 'RD021'      // descărcările tirajului sunt oprite (fn_red_fan_tiraj)
export const COD_TIRAJ_NEOPRIT = 'RD022'    // înlocuirea fără oprire / înainte de 30 s (fn_red_fan_tiraj)
export const ASTEPTARE_DUPA_OPRIRE_S = 30
export const MESAJ_TIRAJ_OPRIT = 'Descărcările tirajului sunt OPRITE (owner-ul pregătește un tiraj nou): nimic descărcat. Așteaptă tirajul nou și descarcă din nou tot lotul.'
/** Refuzul unei verificări de tiraj (eroarea RPC) → codul de răspuns: 'tiraj_schimbat' | 'tiraj_oprit' | null (altă eroare = neconfirmat, L18). */
export const refuzTiraj = error => (error?.code === COD_TIRAJ_SCHIMBAT ? 'tiraj_schimbat' : error?.code === COD_TIRAJ_OPRIT ? 'tiraj_oprit' : null)
/** Reverificarea FINALĂ: rezultatul fn_red_fan_tiraj pentru cheia tirajului început → tirajul DOAR dacă e „același” (aceeași cheie, același nr.). */
export function tirajNeschimbat(data, tiraj) {
  const t = tiraj?.cheie ? tirajDin(data, tiraj.cheie) : null
  return t && t.stare === 'acelasi' && t.nr === tiraj.nr ? t : null
}

// ── SOLUȚIONAREA unei contradicții a urmăririi (runda 5, Jakarinos #1118 r4 P2) ──
// Faptele CONTRAZISE ale unui rând red_fan_awb, în ordinea fixă din fn_red_fan_urmarire_solutioneaza (L19: aceeași listă; BD-ul refuză
// alegerile care nu acoperă EXACT aceste chei — 22023): ridicat / livrat / retur (valoarea cunoscută vs cea nouă din *_contrazis) și
// livrat_retur (livrat ȘI retur cunoscute deodată). Alegerile permise pe cheie: ALEGERI_SOLUTIONARE.
export const COD_URMARIRE_SCHIMBATA = 'RD023'   // CAS-ul soluționării: versiunea urmăririi s-a schimbat (un răspuns FAN nou / altă soluționare)
export const ALEGERI_SOLUTIONARE = Object.freeze({ ridicat: ['cunoscut', 'nou'], livrat: ['cunoscut', 'nou'], retur: ['cunoscut', 'nou'], livrat_retur: ['livrat', 'retur'] })
export function fapteContrazise(r) {
  if (!r) return []
  const f = []
  if (r.ridicat_contrazis != null) f.push({ cheie: 'ridicat', cunoscut: r.ridicat_propus, nou: r.ridicat_contrazis })
  if (r.livrat_contrazis != null) f.push({ cheie: 'livrat', cunoscut: r.livrat_la, nou: r.livrat_contrazis })
  if (r.retur_contrazis != null) f.push({ cheie: 'retur', cunoscut: r.retur_propus, nou: r.retur_contrazis })
  if (r.livrat_la != null && r.retur_cunoscut === true) f.push({ cheie: 'livrat_retur', cunoscut: r.livrat_la, nou: r.retur_propus ?? null })
  return f
}

/** Destinatarul MASCAT pe pagina de control (fără numele întreg pe o foaie de lucru): primele 2 litere ale fiecărui cuvânt + „*”. */
export const destinatarMascat = nume => txt(nume).split(' ').filter(Boolean).map(c => { const l = [...c]; return l.slice(0, 2).join('') + (l.length > 2 ? '*'.repeat(Math.min(l.length - 2, 6)) : '') }).join(' ')

// ── amprenta SURSELOR unui plic (Jakarinos #1118 r1, „Bani”: claim-ul verifică datele de contact în ACEEAȘI tranzacție cu rezervarea) ──
// Textul canonic = aceleași câmpuri BRUTE, în aceeași ordine, ca fn_red_fan_surse(uuid) din migrarea 20261212a (L19: paritate testată pe PGlite):
//   'redari-fan-surse-v1' | cod proiect | nr_plic | destinatar_nume | stare | lot_id | apoi, pentru fiecare deținător DISTINCT al convocărilor
//   active, neșterse, din plic (ordonați după id ca text, „C”): id, 'c' / 'x' (are / nu are rând de contact), telefon, strada, sat, comună, județ,
//   cod poștal. Fiecare câmp: NULL → „-”, altfel „<octeți UTF-8>:<valoare>” (fără separator ambiguu). sha256 hex.
// Include TOȚI deținătorii plicului (nu doar contactul ales): orice schimbare a unui contact al plicului = altă amprentă = claim refuzat.
const OCTETI = new TextEncoder()
const campSursa = v => (v == null ? '-' : `${OCTETI.encode(String(v)).length}:${String(v)}`)
export function textSursePlic({ proiectCod, plic, convocari, contacte }) {
  const peDet = new Map((contacte || []).map(c => [c.detinator_id, c]))
  const det = [...new Set((convocari || []).filter(c => c.plic_id === plic.id).map(c => String(c.detinator_id)))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  let s = 'redari-fan-surse-v1' + [proiectCod, plic.nr_plic, plic.destinatar_nume, plic.stare, plic.lot_id].map(campSursa).join('')
  for (const d of det) {
    const c = peDet.get(d)
    s += campSursa(d) + (c ? 'c' : 'x') + [c?.telefon, c?.adresa_strada, c?.adresa_sat, c?.adresa_comuna, c?.adresa_judet, c?.cod_postal].map(campSursa).join('')
  }
  return s
}
/** Map(plic_id → sha256 hex al textului canonic al surselor). `convocari` = DOAR convocările active, neșterse (aceleași citiri ca ecranul). */
export async function amprenteSurse({ plicuri, convocari, contacte, proiectCod, subtle = globalThis.crypto?.subtle }) {
  if (!subtle) throw new Error('Web Crypto indisponibil')
  const out = new Map()
  for (const p of plicuri || []) {
    const buf = await subtle.digest('SHA-256', OCTETI.encode(textSursePlic({ proiectCod, plic: p, convocari, contacte })))
    out.set(p.id, [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''))
  }
  return out
}

/** Calea etichetei: TOATE AWB-urile date, în ordinea dată, într-un singur PDF, format FIX A6 (doc §1: mai multe AWB-uri într-un apel). */
export function caleEticheta({ clientId, awbs }) {
  if (!txt(clientId)) throw new Error('clientId lipsă')
  if (!Array.isArray(awbs) || !awbs.length || awbs.length > MAX_PE_CERERE || awbs.some(a => !RE_AWB.test(String(a)))) throw new Error('lista de AWB-uri pentru etichetă e invalidă')
  const q = new URLSearchParams()
  q.append('clientId', txt(clientId))
  for (const a of awbs) q.append('awbs[]', String(a))
  q.append('pdf', '1')
  q.append('format', FORMAT_ETICHETA)
  return '/awb/label?' + q.toString()
}

/** Calea de urmărire / confirmări pentru ≤ 100 AWB-uri (doc §1). */
export function caleListaAwb(baza, { clientId, awbs, extra = {} }) {
  if (!['/reports/awb/tracking', '/reports/awb/confirmations'].includes(baza)) throw new Error('cale necunoscută')
  if (!txt(clientId)) throw new Error('clientId lipsă')
  if (!Array.isArray(awbs) || !awbs.length || awbs.length > MAX_PE_CERERE || awbs.some(a => !RE_AWB.test(String(a)))) throw new Error('lista de AWB-uri e invalidă (1…100)')
  const q = new URLSearchParams()
  q.append('clientId', txt(clientId))
  for (const a of awbs) q.append('awb[]', String(a))
  for (const [k, v] of Object.entries(extra)) q.append(k, String(v))
  return baza + '?' + q.toString()
}

/** Un PDF adevărat (antet %PDF-), nu HTML / JSON de eroare cu status 200. */
export const estePdf = bytes => bytes instanceof Uint8Array && bytes.length > 5 && [0x25, 0x50, 0x44, 0x46, 0x2d].every((b, i) => bytes[i] === b)

/** Octeți → base64 (Deno și browser), pe bucăți (fără RangeError la fișiere mari). */
export function inBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
