// TKT-0353 (etapa 2): intrare nouă PESTE stocul existent la Magazie → Echipamente.
// Logică pură (fără ceas, fără aleator propriu); singura funcție cu acces la BD (aplicaIntrare)
// primește clientul ca parametru, ca să poată fi testată cu un client fals.
// Urma intrării (cantitate, factură, furnizor, preț, data) e o linie adăugată la `observatii`. Singura coloană nouă (r5, migrarea
// 20261231a): `referinta_intentie` pe rândurile noi din factură, UNIQUE în BD, ca aceeași intrare să nu poată fi salvată de două ori.
import { normalizeazaNumar } from './eipIntrareLogica.js'
import { dataCalendaristicaValida } from './magazieEipLogica.js'
import { paginareKeyset } from './hrDeciziiUtil.js'

const LIMITA_TEXT = { facturaNr: 60, furnizor: 120 }

// „1.000” scris de om poate fi o mie (scriere românească) sau 1 (punct zecimal): refuzăm în loc să ghicim.
// Doar TEXTUL e ambiguu: un număr deja citit din formular (1,001 → 1.001) nu se mai reinterpretează (r2 P3).
const ambiguuMii = valoare => typeof valoare === 'string' && /^\d{1,3}\.\d{3}$/.test(valoare.trim())

// Cantitate primită: număr > 0, acceptă virgula zecimală; text / 0 / negativ / ambiguu = refuz.
export function eroareCantitateIntrare(valoare) {
  if (ambiguuMii(valoare)) return 'Cantitatea e ambiguă: pentru zecimale folosește virgula (ex. 2,5), fără separator de mii.'
  const q = normalizeazaNumar(valoare)
  if (!(q > 0)) return 'Completează cantitatea primită cu un număr mai mare decât 0 (ex. 10 sau 2,5).'
  return ''
}

// Text zecimal fără exponent; null dacă numărul nu poate fi scris exact (exponent, NaN).
function textZecimalExact(n) {
  if (!Number.isFinite(n) || n < 0) return null
  const t = String(n)
  return /^\d+(?:\.\d+)?$/.test(t) ? t : null
}

// Adunare exactă pe zecimale (29 + 10 = 39; 0,1 + 0,2 = 0,3, nu 0,30000000000000004).
export function sumaStoc(vechi, primit) {
  const a = normalizeazaNumar(vechi)
  if (!Number.isFinite(a) || a < 0) return { ok: false, eroare: 'Stocul curent nu este valid. Reîncarcă lista de echipamente.' }
  const eroare = eroareCantitateIntrare(primit)
  if (eroare) return { ok: false, eroare }
  const b = normalizeazaNumar(primit)
  const ta = textZecimalExact(a), tb = textZecimalExact(b)
  if (ta == null || tb == null) return { ok: false, eroare: 'Cantitatea nu poate fi adunată exact. Verifică valorile.' }
  const scala = Math.max((ta.split('.')[1] || '').length, (tb.split('.')[1] || '').length)
  const intreg = t => { const [x, y = ''] = t.split('.'); return BigInt(x + y.padEnd(scala, '0')) }
  const cifre = (intreg(ta) + intreg(tb)).toString().padStart(scala + 1, '0')
  const text = scala ? (cifre.slice(0, -scala) + '.' + cifre.slice(-scala)).replace(/\.?0+$/, '') : cifre
  const total = Number(text)
  if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) return { ok: false, eroare: 'Totalul rezultat este prea mare.' }
  return { ok: true, total, text }
}

// Afișare românească a unei cantități deja validate (doar pentru text, nu se mai citește înapoi).
export const fmtCantitate = n => String(n).replace('.', ',')

const unRand = v => String(v ?? '').replace(/\s+/g, ' ').trim()

// Validează formularul de intrare. `azi` = 'AAAA-LL-ZZ' (Europe/Bucharest), dat de apelant.
export function validareIntrare(form, azi) {
  const eroare = e => ({ ok: false, eroare: e })
  const e1 = eroareCantitateIntrare(form?.cantitate)
  if (e1) return eroare(e1)
  const facturaNr = unRand(form.facturaNr)
  const furnizor = unRand(form.furnizor)
  if (facturaNr.length > LIMITA_TEXT.facturaNr) return eroare(`Numărul facturii are peste ${LIMITA_TEXT.facturaNr} de caractere.`)
  if (furnizor.length > LIMITA_TEXT.furnizor) return eroare(`Furnizorul are peste ${LIMITA_TEXT.furnizor} de caractere.`)
  const facturaData = String(form.facturaData ?? '').trim()
  if (facturaData) {
    if (!dataCalendaristicaValida(facturaData)) return eroare('Data facturii nu este validă.')
    if (!dataCalendaristicaValida(azi)) return eroare('Data curentă nu este validă.')
    if (facturaData > azi) return eroare('Data facturii nu poate fi în viitor.')
  }
  const pretText = String(form.pret ?? '').trim()
  let pret = null
  if (pretText) {
    if (ambiguuMii(pretText)) return eroare('Prețul e ambiguu: pentru zecimale folosește virgula (ex. 25,50), fără separator de mii.')
    pret = normalizeazaNumar(pretText)
    if (!Number.isFinite(pret) || pret < 0) return eroare('Prețul unitar trebuie să fie un număr mai mare sau egal cu 0 (sau gol).')
  }
  return { ok: true, cantitate: normalizeazaNumar(form.cantitate), facturaNr, facturaData: facturaData || null, furnizor, pret }
}

// Referință scurtă a intenției: refolosită la reîncercare, ca aceeași intrare să nu se adune de două ori.
export function refNou(octeti) {
  if (!octeti || octeti.length < 4) throw new Error('Lipsesc octeții aleatori pentru referința intrării.')
  return Array.from(octeti.slice(0, 4), b => (b & 255).toString(16).padStart(2, '0')).join('')
}

// r5 (decizia owner-ului 20.11.2026, migrarea 20261231a): cheia intenției „rând nou din factură” = UUID v4 din 16 octeți aleatori,
// scrisă în magazie_echipamente.referinta_intentie (UNIQUE în BD). Ref-ul scurt din observații = primele 8 cifre ale cheii.
export const UUID_VALID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export function cheieIntentie(octeti) {
  if (!octeti || octeti.length < 16) throw new Error('Lipsesc octeții aleatori pentru cheia intrării.')
  const b = Array.from(octeti.slice(0, 16), x => x & 255)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = b.map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// Linia de urmă: „Intrare +10 buc · Factura X din AAAA-LL-ZZ · furnizor Z · preț unitar P lei · AAAA-LL-ZZ · ref abcd1234”.
export function linieIntrare({ cantitate, um, facturaNr, facturaData, furnizor, pret, dataIntrare, ref }) {
  const factura = [facturaNr && `Factura ${unRand(facturaNr)}`, facturaData && `din ${facturaData}`].filter(Boolean).join(' ')
  return [
    `Intrare +${fmtCantitate(cantitate)} ${unRand(um) || 'buc'}`,
    factura,
    furnizor && `furnizor ${unRand(furnizor)}`,
    pret != null && `preț unitar ${fmtCantitate(pret)} lei`,
    dataIntrare,
    ref && `ref ${ref}`,
  ].filter(Boolean).join(' · ')
}

// Adaugă linia la observațiile existente; nu șterge și nu rescrie nimic din ce era.
export function adaugaLaObservatii(vechi, linie) {
  const v = String(vechi ?? '').replace(/\s+$/, '')
  return v ? `${v}\n${linie}` : linie
}

// ── Potrivirea denumirii pentru „Adaugă din factură” ──
// Fără diacritice (inclusiv ş/ţ cu sedilă), fără majuscule, spații comprimate.
export function cheieText(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}
export const cheieUm = um => cheieText(um) || 'buc'

// Articolele EIP din catalog (cu mărimi) au total legat de jurnalul de intrări EIP:
// acolo intrarea se face doar din „Intrare EIP”, nu direct pe total.
// catalogIds: Set de id-uri din v_eip_stoc; null = necunoscut (citirea a eșuat) → refuz pe EIP.
export function motivFaraIntrare(e, catalogIds) {
  if (!e || e.activ === false) return 'Echipamentul nu mai este activ.'
  if (e.articol_id != null || (catalogIds && catalogIds.has(e.id))) return 'Articol EIP din catalog (cu mărimi): intrarea se face din „Intrare EIP”.'
  if (!catalogIds && e.este_eip) return 'Nu am putut verifica legătura cu catalogul EIP. Reîncarcă lista.'
  return ''
}

// Rândurile existente active cu aceeași denumire normalizată, aceeași categorie și aceeași UM.
// Echipamentele cu serie / nr. de inventar sunt bucăți individuale: nu se adună peste ele.
// Fiecare potrivire primește motivBlocat (gol = se poate adăuga la ea), după motivFaraIntrare.
export function potrivireExistente(rand, categorie, echipamente, catalogIds) {
  const d = cheieText(rand?.denumire)
  if (!d || unRand(rand?.serie)) return []
  const um = cheieUm(rand?.um)
  return (echipamente || []).filter(e => e && e.activ !== false && e.categorie === categorie &&
    !unRand(e.serie) && cheieText(e.denumire) === d && cheieUm(e.um) === um)
    .map(e => ({ ...e, motivBlocat: motivFaraIntrare(e, catalogIds) }))
}

// Ținta unui rând din factură: 'nou' | id-ul rândului existent | null (ambiguu, trebuie ales).
// alegere: undefined = implicit; 'nou' = rând separat; id = rândul existent ales.
export function tintaRand(alegere, potriviri) {
  const permise = potriviri.filter(p => !p.motivBlocat)
  if (alegere === 'nou') return 'nou'
  if (alegere != null && permise.some(p => p.id === alegere)) return alegere
  if (permise.length === 1) return permise[0].id
  if (permise.length > 1) return null
  return 'nou'
}

// ── Scrierea protejată la concurență ──
// 1) recitește rândul din tabel; 2) dacă linia cu ref-ul nostru e deja acolo → intrarea e înregistrată (reîncercare);
// 3) dacă totalul diferă de cel văzut în ecran → conflict, nu scrie; 4) UPDATE condiționat pe valorile citite
// (total, observații, activ) cu .select('id'): exact 1 rând = ok; altfel recitește și clasifică, fără reîncercare oarbă.
// Rezultat: { stare: 'ok'|'deja'|'conflict'|'refuzat'|'eroare'|'necunoscut', total?, mesaj? }
const egalNr = (a, b) => a != null && b != null && Number(a) === Number(b)

// r2 P4 (L04): referința e legată de CONȚINUTUL liniei (cantitate, UM, factură, furnizor, preț, data).
// Orice apariție a „ref X” în observații înseamnă că referința a fost folosită; e „aceeași” intrare doar dacă
// există o singură linie cu ref-ul și ea e IDENTICĂ cu linia trimisă acum. Altfel = alt conținut cu aceeași cheie → refuz.
const REF_VALID = /^[0-9a-f]{8}$/
function liniiCuRef(observatii, ref) {
  if (!REF_VALID.test(String(ref ?? ''))) return []
  const token = new RegExp(`(?:^|[^0-9A-Za-z])ref ${ref}(?![0-9A-Za-z])`)
  return String(observatii ?? '').split('\n').map(l => l.replace(/\r$/, '')).filter(l => token.test(l))
}
export function stareRef(observatii, linie, ref) {
  const cu = liniiCuRef(observatii, ref)
  if (!cu.length) return 'absent'
  return cu.length === 1 && cu[0].trim() === String(linie).trim() ? 'aceeasi' : 'alta'
}

export const MESAJ_REF_ALT = 'Referința acestei intrări apare deja în observații cu alt conținut (altă cantitate, factură sau dată). Nimic nu a fost scris. Închide formularul, verifică observațiile și, dacă e nevoie, deschide o intrare nouă.'

// ── r3 P1 (L04, L19): rândul NOU din factură = un singur payload, construit AICI și folosit și la inserare, și la
// recunoașterea lui după un rezultat necunoscut. Linia din observații poartă cantitatea inițială și ref-ul, deci
// identitatea intenției e legată de conținut (cantitate, UM, factură, dată, furnizor, preț), nu doar de referință.
// Prețul se citește ca în TKT-0279 (neschimbat aici). `fact` = antetul facturii (nr, data, furnizor, categorie).
export function randNou(rand, fact) {
  const pv = String(rand?.pret || '').replace(',', '.').trim()
  const pret = pv !== '' && !isNaN(Number(pv)) ? Number(pv) : null
  const um = unRand(rand?.um) || 'buc'
  const cantitate = Number(String(rand?.cantitate).replace(',', '.')) || 0
  const antet = [unRand(fact?.nr) && `Factura ${unRand(fact.nr)}`, fact?.data && `din ${fact.data}`, unRand(fact?.furnizor) && `furnizor ${unRand(fact.furnizor)}`].filter(Boolean).join(' ')
  const linie = [`Intrare inițială ${fmtCantitate(cantitate)} ${um}`, antet, pret != null && `preț unitar ${fmtCantitate(pret)} lei`, `ref ${rand?.ref}`].filter(Boolean).join(' · ')
  // r5: referinta_intentie = cheia rândului (UUID), aceeași la orice retrimitere a intenției (rândul blocat păstrează rândul trimis)
  const cheie = typeof rand?.cheie === 'string' ? rand.cheie.toLowerCase() : null
  return {
    linie,
    ref: rand?.ref,
    payload: { denumire: unRand(rand?.denumire), categorie: fact?.categorie, este_eip: fact?.categorie === 'eip', um, serie: unRand(rand?.serie) || null, cantitate_total: cantitate, stare: 'functional', observatii: linie, referinta_intentie: cheie },
  }
}

// Rândul nou creat de ACEEAȘI intenție: ref-ul o singură dată, linia identică, aceleași denumire / categorie / UM / serie / EIP,
// rând activ. Cantitatea curentă nu se compară (o intrare ulterioară legitimă o poate schimba): cantitatea inițială e în linie.
// r5: dacă rândul citit are coloana referinta_intentie (recitirea din tabel; vederea listei nu o are), ea trebuie să fie cheia intenției.
const cheieEgala = (e, p) => !Object.prototype.hasOwnProperty.call(e, 'referinta_intentie') ||
  (e.referinta_intentie != null && String(e.referinta_intentie).toLowerCase() === p.referinta_intentie)
function eRandulNou(e, intentie, ref) {
  const p = intentie?.payload
  return !!p && e.activ !== false && stareRef(e.observatii, intentie.linie, ref) === 'aceeasi' &&
    unRand(e.denumire) === p.denumire && e.categorie === p.categorie && (unRand(e.um) || 'buc') === p.um &&
    (unRand(e.serie) || null) === p.serie && !!e.este_eip === p.este_eip && cheieEgala(e, p)
}

// Judecata unui rând din factură pe lista RECITITĂ, înaintea oricărei scrieri. `intentie` = randNou(...) al rândului.
// 'absent' = ref-ul nu apare nicăieri; 'creat' = rândul nou cu exact acest conținut există deja (nu se mai trimite);
// 'tinta' = ref-ul apare doar pe echipamentul ales (judecă aplicaIntrare: „deja” sau alt conținut);
// 'alta' = ref-ul e folosit cu alt conținut sau pe alt echipament → refuz, nimic nu se scrie (nu „deja salvat”).
export function judecaRandFactura({ ref, tinta }, intentie, lista) {
  const cu = (lista || []).filter(e => e && liniiCuRef(e.observatii, ref).length > 0)
  if (!cu.length) return { stare: 'absent' }
  if (cu.length === 1 && eRandulNou(cu[0], intentie, ref)) return { stare: 'creat', echip: cu[0] }
  if (tinta != null && tinta !== 'nou' && cu.every(e => String(e.id) === String(tinta))) return { stare: 'tinta' }
  return { stare: 'alta', echip: cu[0] }
}

// ── r3 P2 (L05, L18): doar un răspuns 4xx (cererea a ajuns și a fost refuzată, tranzacția anulată) dovedește că nu s-a scris
// nimic. Fără status (rețea: „Failed to fetch” vine cu status 0), 408, 5xx sau excepție = NECUNOSCUT: scrierea poate încă ajunge.
export function esecCert(res) {
  const s = res?.status
  return !!res?.error && Number.isInteger(s) && s >= 400 && s < 500 && s !== 408
}
const MESAJ_NECUNOSCUT = ref => 'Rezultatul nu poate fi confirmat (scrierea poate încă să ajungă). Reîncearcă ACEEAȘI intrare (nu se adună de două ori) sau reîncarcă și verifică dacă observațiile conțin „ref ' + ref + '”.'

export async function aplicaIntrare(db, { id, totalVazut, primit, linie, ref }) {
  if (!REF_VALID.test(String(ref ?? '')) || /[\r\n]/.test(String(linie ?? '')) || stareRef(linie, linie, ref) !== 'aceeasi') {
    return { stare: 'eroare', mesaj: 'Linia intrării nu are referința. Redeschide formularul.' }
  }
  const citeste = () => db.from('magazie_echipamente').select('id,cantitate_total,observatii,activ').eq('id', id).maybeSingle()
  const r0 = await citeste()
  if (r0.error) return { stare: 'eroare', mesaj: 'Nu am putut citi stocul curent: ' + (r0.error.message || 'eroare necunoscută') + '. Nimic nu a fost scris.' }
  const b = r0.data
  if (!b) return { stare: 'eroare', mesaj: 'Echipamentul nu mai există sau nu îl poți vedea. Reîncarcă lista.' }
  const s0 = stareRef(b.observatii, linie, ref)
  if (s0 === 'aceeasi') return { stare: 'deja', total: b.cantitate_total }
  if (s0 === 'alta') return { stare: 'eroare', mesaj: MESAJ_REF_ALT }
  if (b.activ === false) return { stare: 'eroare', mesaj: 'Echipamentul a fost scos din evidență între timp. Reîncarcă lista.' }
  if (!egalNr(b.cantitate_total, totalVazut)) return { stare: 'conflict', total: b.cantitate_total }
  const suma = sumaStoc(b.cantitate_total, primit)
  if (!suma.ok) return { stare: 'eroare', mesaj: suma.eroare }
  let q = db.from('magazie_echipamente')
    .update({ cantitate_total: suma.total, observatii: adaugaLaObservatii(b.observatii, linie) })
    .eq('id', id).eq('activ', true).eq('cantitate_total', b.cantitate_total)
  q = b.observatii == null ? q.is('observatii', null) : q.eq('observatii', b.observatii)
  const r1 = await q.select('id')
  if (!r1.error && Array.isArray(r1.data) && r1.data.length === 1 && String(r1.data[0]?.id) === String(id)) return { stare: 'ok', total: suma.total }
  // Rezultat neconfirmat: recitim, nu reîncercăm.
  const r2 = await citeste()
  if (r2.error || !r2.data) return { stare: 'necunoscut', mesaj: MESAJ_NECUNOSCUT(ref) }
  const s2 = stareRef(r2.data.observatii, linie, ref)
  if (s2 === 'aceeasi') return { stare: 'deja', total: r2.data.cantitate_total }
  if (s2 === 'alta') return { stare: 'eroare', mesaj: MESAJ_REF_ALT }
  // r3 P2: recitirea care NU vede ref-ul nu dovedește nimic dacă cererea n-a primit un refuz 4xx (commit întârziat):
  // rămâne necunoscut, formularul se blochează, iar reîncercarea identică e apărată de CAS (total + observații).
  if (r1.error ? !esecCert(r1) : !Array.isArray(r1.data)) return { stare: 'necunoscut', mesaj: MESAJ_NECUNOSCUT(ref) }
  if (r1.error) return { stare: 'eroare', mesaj: (r1.error.message || 'eroare necunoscută') + '. Nimic nu a fost scris.' }
  const neschimbat = egalNr(r2.data.cantitate_total, b.cantitate_total) && (r2.data.observatii ?? null) === (b.observatii ?? null) && r2.data.activ !== false
  if (neschimbat) return { stare: 'refuzat', mesaj: 'Scrierea nu a fost acceptată (posibil fără drept de modificare). Nimic nu a fost scris.' }
  return { stare: 'conflict', total: r2.data.cantitate_total }
}

export const MESAJ_CONFLICT = 'Stocul s-a schimbat între timp (altcineva a modificat echipamentul). Reîncarcă lista și verifică totalul înainte de a adăuga din nou.'

// Validare + linia de urmă, aceeași pentru „+ Intrare” și pentru rândurile din factură.
// `azi` vine de la apelant; la reîncercarea după un rezultat necunoscut se refolosește ziua primei încercări,
// ca linia (deci intenția) să fie identică (r2 P4).
export function pregatesteIntrare({ um, form, azi, ref }) {
  const v = validareIntrare(form, azi)
  if (!v.ok) return v
  return { ...v, linie: linieIntrare({ cantitate: v.cantitate, um, facturaNr: v.facturaNr, facturaData: v.facturaData, furnizor: v.furnizor, pret: v.pret, dataIntrare: azi, ref }) }
}

// ── r2 P1 (L18, L23): lista COMPLETĂ de echipamente ──
// Keyset pe id până la pagina goală (plafonul de 1000 al serverului nu mai trunchiază tăcut), apoi ordonare după denumire.
// Eroarea se aruncă (apelantul o arată), nu devine listă goală.
export async function citesteEchipamente(db, pas = 1000) {
  const toate = await paginareKeyset((ultim, n) => {
    const q = db.from('v_magazie_echipamente').select('*').order('id', { ascending: true }).limit(n)
    return ultim == null ? q : q.gt('id', ultim)
  }, pas)
  return toate.sort((a, b) => String(a.denumire ?? '').localeCompare(String(b.denumire ?? ''), 'ro') || (a.id > b.id ? 1 : a.id < b.id ? -1 : 0))
}

// Înaintea inserării, rândurile „nou” se reverifică pe lista completă RECITITĂ din BD: o potrivire pe care omul nu a văzut-o
// în ecran (listă veche sau rând apărut între timp) = refuz, nu dublură tăcută. `vazute` = id-urile arătate în ecran pentru rând.
export function dubluriNevazute(randuri, categorie, listaProaspata) {
  return (randuri || []).filter(r => r.tinta === 'nou').flatMap(r => {
    const vazute = new Set((r.vazute || []).map(String))
    const noi = potrivireExistente(r, r.categorie ?? categorie, listaProaspata, new Set()).filter(p => !vazute.has(String(p.id)))
    return noi.length ? [{ k: r.k, denumire: r.denumire, ids: noi.map(p => p.id) }] : []
  })
}

// ── r2 P2 (L01, L20): rândurile din factură cu țintă existentă, aplicate în ordine ──
// Pentru ACELAȘI echipament, totalul de comparat al rândului următor = totalul scris de rândul nostru anterior (confirmat
// prin CAS), nu cel din ecran; altfel a doua intrare intră în conflict cu prima. „deja” (aplicat la o încercare anterioară,
// lista reîncărcată după) nu mută baza. Se oprește la primul rezultat care nu e ok/deja: { aplicate: [k...], oprit: {k, stare, mesaj} | null }.
export async function aplicaLot(db, pasi) {
  const baza = new Map()
  const aplicate = []
  for (const p of pasi) {
    const totalVazut = baza.has(p.id) ? baza.get(p.id) : p.totalVazut
    let r
    try {
      r = await aplicaIntrare(db, { id: p.id, totalVazut, primit: p.primit, linie: p.linie, ref: p.ref })
    } catch (e) {
      r = { stare: 'necunoscut', mesaj: `Rezultat necunoscut (${e?.message || 'eroare'}). Reîncearcă aceeași intrare.` }
    }
    if (r.stare === 'ok') baza.set(p.id, r.total)
    else if (r.stare !== 'deja') return { aplicate, oprit: { k: p.k, ...r } }
    aplicate.push(p.k)
  }
  return { aplicate, oprit: null }
}

// ── r3 P2: inserarea rândurilor noi, clasificată ca la UPDATE (L05) ──
// 'ok' | 'eroare' (refuz 4xx: nimic scris, rândurile rămân editabile) | 'necunoscut' (rețea / 5xx / excepție: rândurile se blochează).
// ── r5 (L04, L16; migrarea 20261231a): fiecare rând nou poartă referinta_intentie (UUID, UNIQUE în BD). Inserarea =
// INSERT … ON CONFLICT (referinta_intentie) DO NOTHING (upsert cu ignoreDuplicates): o retrimitere a aceleiași intenții, oricând ar
// ajunge cererea anterioară, nu mai poate crea al doilea rând. După un răspuns fără eroare, RECITIREA pe referință decide fiecare rând:
// exact un rând cu conținutul intenției = 'ok' (creat acum sau la o încercare anterioară, nu dublură); aceeași referință cu alt conținut
// = 'alta' (nimic scris pentru rândul acela); negăsit / recitire eșuată = 'necunoscut' (retrimiterea rămâne sigură).
// intentii: [{ ref, linie, payload }] (randNou); rezultat: { stare, mesaj?, stari?: ['ok'|'alta'|'necunoscut', … în ordinea intențiilor] }.
const COLOANE_RECITIRE = 'id,denumire,categorie,um,serie,este_eip,activ,observatii,referinta_intentie'
export async function insereazaNoi(db, intentii, uid) {
  const lista = intentii || []
  const chei = lista.map(i => i?.payload?.referinta_intentie)
  if (!lista.length || chei.some(c => !UUID_VALID.test(String(c ?? ''))) || new Set(chei).size !== chei.length ||
      lista.some(i => !REF_VALID.test(String(i?.ref ?? '')) || stareRef(i.linie, i.linie, i.ref) !== 'aceeasi' || i.payload.observatii !== i.linie)) {
    return { stare: 'eroare', mesaj: 'Rândurile noi nu au referința intrării. Redeschide formularul. Nimic nu a fost scris.' }
  }
  const toate = cuStare => ({ stari: lista.map(() => cuStare) })
  let r
  try {
    r = await db.from('magazie_echipamente').upsert(lista.map(i => ({ ...i.payload, created_by: uid })), { onConflict: 'referinta_intentie', ignoreDuplicates: true })
  } catch (e) { return { stare: 'necunoscut', mesaj: `Rezultatul inserării nu poate fi confirmat (${e?.message || 'eroare'}).`, ...toate('necunoscut') } }
  if (!r || r.error) {
    const m = r?.error?.message || 'eroare necunoscută'
    if (esecCert(r)) return { stare: 'eroare', mesaj: `${m}. Rândurile noi nu au fost scrise.` }
    return { stare: 'necunoscut', mesaj: `Rezultatul inserării nu poate fi confirmat (${m}).`, ...toate('necunoscut') }
  }
  // recitirea pe referință (L04), pe bucăți (cererea rămâne scurtă; cel mult un rând pe cheie, deci sub plafonul serverului)
  const gasite = []
  try {
    for (let i = 0; i < chei.length; i += 100) {
      const q = await db.from('magazie_echipamente').select(COLOANE_RECITIRE).in('referinta_intentie', chei.slice(i, i + 100))
      if (q.error || !Array.isArray(q.data)) throw new Error(q.error?.message || 'răspuns fără listă')
      gasite.push(...q.data)
    }
  } catch (e) {
    return { stare: 'necunoscut', mesaj: `Inserarea a răspuns, dar rândurile nu au putut fi recitite (${e?.message || 'eroare'}). Retrimiterea aceleiași intrări nu creează al doilea rând.`, ...toate('necunoscut') }
  }
  const stari = lista.map((i, j) => {
    const cu = gasite.filter(e => e && String(e.referinta_intentie ?? '').toLowerCase() === chei[j])
    if (!cu.length) return 'necunoscut'
    return cu.length === 1 && eRandulNou(cu[0], i, i.ref) ? 'ok' : 'alta'
  })
  const stare = stari.every(s => s === 'ok') ? 'ok' : stari.includes('necunoscut') ? 'necunoscut' : 'alta'
  const mesaj = stari.includes('necunoscut') ? 'Rezultatul inserării nu poate fi confirmat (rândul nu apare la recitire).' : undefined
  return { stare, ...(mesaj ? { mesaj } : {}), stari }
}

// Intenția „rând nou” a unui rând din factură: după un rezultat necunoscut se folosesc valorile ȘI antetul primei încercări.
export const intentieRand = (r, fact) => randNou(r.fixat?.rand || r, r.fixat?.fact || fact)

// ── r4 (NO-GO Jak r3; L04, L05, L16): fără index unic în BD, o REINSERARE după un rezultat necunoscut poate dubla rândul
// (cererea inițială întârziată + retrimiterea ajung amândouă). Deci după ORICE inserare cu rezultat necunoscut nu se mai
// reinserează automat: rândul se marchează `fixat.inserare = 'necunoscuta'`, lista se reîncarcă, omul verifică.
// Dacă ref-ul intenției apare în lista recitită cu exact acest conținut → „creat” (nu se trimite). Dacă NU apare,
// retrimiterea cere confirmarea explicită a omului (`r.retrimitereConfirmata === true`), dată DUPĂ rezultatul necunoscut.
export const MESAJ_INSERARE_NECUNOSCUTA = 'Nu se știe dacă intrarea s-a salvat — verifică lista (reîncărcată) înainte să trimiți din nou.'
// r5: plasa r4 rămâne (omul verifică lista înainte), dar retrimiterea e acum sigură: aceeași referință nu se salvează de două ori (BD).
export const MESAJ_CERE_CONFIRMARE = 'Rândul nu apare în lista reîncărcată. Trimiterea din nou se face doar după ce confirmi că ai verificat lista (bifa de la rând); aceeași intrare nu poate fi salvată de două ori, chiar dacă cererea anterioară ajunge mai târziu. Nimic nu a fost scris.'
export const inserareNecunoscuta = r => r?.fixat?.inserare === 'necunoscuta'

// Rezultatul salvării aplicat pe rândurile din ecran (pur, folosit de modal): rândurile aplicate ies; cele cu rezultat
// necunoscut se blochează pe valorile trimise, iar confirmarea de retrimitere se ȘTERGE (fiecare rezultat necunoscut
// cere o verificare nouă). `randGol` = fabrica de rând gol (lista nu rămâne niciodată fără rânduri).
export function randuriDupaSalvare(rows, res, randGol) {
  const gata = new Set(res?.aplicate || [])
  const nec = new Map((res?.necunoscute || []).map(x => [x.k, x.fixat]))
  const rest = (rows || []).filter(r => !gata.has(r.k)).map(r => nec.has(r.k) ? { ...r, fixat: nec.get(r.k), retrimitereConfirmata: false } : r)
  return rest.length ? rest : [randGol()]
}

// ── r3: salvarea din factură, ca funcție testabilă (Magazie.jsx doar o apelează și arată rezultatul) ──
// rows: rândurile valide din ecran { k, ref, tinta, vazute, denumire, cantitate, um, pret, serie, fixat? };
// echipamente: lista din ecran (totalul VĂZUT de om pentru țintă); azi: ziua (Europe/Bucharest), dată de apelant.
// Ordinea: lista completă recitită → judecata ref-urilor (alt conținut = refuz, nimic scris) → validare → dubluri nevăzute
// → adunări (aplicaLot, oprire la primul eșec) → inserarea rândurilor noi. Nu aruncă: { aplicate, necunoscute, eroare, laStoc, noi }.
// necunoscute: [{ k, fixat }] = rândurile cu rezultat necunoscut, de blocat pe valorile trimise. Adunarea (UPDATE) se
// retrimite identic (apărată de CAS); inserarea NU (r4): fixat.inserare = 'necunoscuta' → verificare + confirmare umană.
// deConfirmat: [k] (doar la refuzul r4) = rândurile cu inserare necunoscută, negăsite în listă, fără confirmarea omului.
export async function salveazaFactura(db, { rows, fact, uid, azi, echipamente, catalogIds }) {
  const aplicate = [], necunoscute = []
  const gata = (eroare, extra = {}) => ({ aplicate, necunoscute, eroare, ...extra })
  try {
    let proaspata
    try { proaspata = await citesteEchipamente(db) }
    catch (e) { return gata(`Nu am putut verifica lista completă de echipamente (${e?.message || 'eroare necunoscută'}). Nimic nu a fost scris.`) }
    const judecate = (rows || []).map(r => ({ r, j: judecaRandFactura(r, intentieRand(r, fact), proaspata) }))
    const alte = judecate.filter(x => x.j.stare === 'alta')
    if (alte.length) return gata(`${alte.map(x => `„${unRand(x.r.denumire)}”`).join(', ')}: ${MESAJ_REF_ALT}`)
    for (const x of judecate) if (x.j.stare === 'creat') aplicate.push(x.r.k)
    // r4: rândul cu inserare necunoscută care NU apare în lista recitită nu se mai trimite fără confirmarea omului (nimic scris).
    const neconfirmate = judecate.filter(x => x.j.stare !== 'creat' && inserareNecunoscuta(x.r) && x.r.retrimitereConfirmata !== true).map(x => x.r)
    if (neconfirmate.length) return gata(`${neconfirmate.map(r => `„${unRand(r.denumire)}”`).join(', ')}: ${MESAJ_CERE_CONFIRMARE}`, { deConfirmat: neconfirmate.map(r => r.k) })
    const rest = judecate.filter(x => x.j.stare !== 'creat').map(x => x.r)
    const pasi = []
    for (const r of rest.filter(x => x.tinta !== 'nou')) {
      const echip = (echipamente || []).find(e => e.id === r.tinta)
      if (!echip || motivFaraIntrare(echip, catalogIds)) return gata(`„${unRand(r.denumire)}”: rândul existent ales nu mai poate primi intrări. Reîncarcă.`)
      const ziua = r.fixat?.azi || azi
      const form = r.fixat?.form || { cantitate: r.cantitate, facturaNr: fact.nr, facturaData: fact.data, furnizor: fact.furnizor, pret: r.pret }
      const p = pregatesteIntrare({ um: echip.um, form, azi: ziua, ref: r.ref })
      if (!p.ok) return gata(`„${unRand(r.denumire)}”: ${p.eroare}`)
      pasi.push({ k: r.k, id: echip.id, totalVazut: echip.cantitate_total, primit: p.cantitate, linie: p.linie, ref: r.ref, azi: ziua, form, denumire: unRand(r.denumire) })
    }
    const noi = rest.filter(x => x.tinta === 'nou').map(r => ({ r, i: intentieRand(r, fact) }))
    const dubluri = dubluriNevazute(noi.map(({ r, i }) => ({ ...r, categorie: i.payload.categorie })), fact.categorie, proaspata)
    if (dubluri.length) return gata(`${dubluri.map(d => `„${unRand(d.denumire)}”`).join(', ')} există deja în evidență (rând pe care nu l-ai văzut în listă). Nimic nu a fost scris: reîncarcă și alege unde se adaugă.`)
    const lot = await aplicaLot(db, pasi)
    aplicate.push(...lot.aplicate)
    if (lot.oprit) {
      const pas = pasi.find(x => x.k === lot.oprit.k)
      if (lot.oprit.stare === 'necunoscut') necunoscute.push({ k: pas.k, fixat: { azi: pas.azi, form: pas.form, tinta: pas.id } })
      return gata(`„${pas.denumire}”: ${lot.oprit.stare === 'conflict' ? MESAJ_CONFLICT : lot.oprit.mesaj}`)
    }
    if (noi.length) {
      const ins = await insereazaNoi(db, noi.map(({ i }) => i), uid)
      if (ins.stare === 'eroare') return gata(ins.mesaj)
      // r5: fiecare rând după starea lui la recitire. 'ok' iese din formular; 'alta' = refuz (nimic scris pentru el);
      // 'necunoscut': rândul se blochează pe valorile ȘI antetul trimise și se marchează „inserare necunoscută” (r4):
      // la salvarea următoare cel creat se recunoaște ('creat'), iar cel negăsit cere confirmarea omului; retrimiterea e apărată de BD.
      const cu = s => noi.filter((_, j) => ins.stari?.[j] === s)
      aplicate.push(...cu('ok').map(({ r }) => r.k))
      necunoscute.push(...cu('necunoscut').map(({ r }) => ({ k: r.k, fixat: { ...(r.fixat || { tinta: 'nou', rand: { ...r, fixat: undefined, retrimitereConfirmata: undefined }, fact: { ...fact } }), inserare: 'necunoscuta' } })))
      const erori = []
      if (cu('alta').length) erori.push(`${cu('alta').map(({ r }) => `„${unRand(r.denumire)}”`).join(', ')}: ${MESAJ_REF_ALT}`)
      if (cu('necunoscut').length) erori.push(`${MESAJ_INSERARE_NECUNOSCUTA} (${ins.mesaj})`)
      if (erori.length) return gata(erori.join(' '))
    }
    return gata(null, { laStoc: pasi.length, noi: noi.length })
  } catch (e) {
    // neprevăzut: ce s-a aplicat până aici rămâne raportat; nimic nu se declară „nescris”
    return gata(`Eroare neprevăzută (${e?.message || 'eroare'}). Reîncarcă și verifică stocul înainte de a reîncerca.`)
  }
}
