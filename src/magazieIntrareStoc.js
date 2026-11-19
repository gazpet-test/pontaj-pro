// TKT-0353 (etapa 2): intrare nouă PESTE stocul existent la Magazie → Echipamente.
// Logică pură (fără ceas, fără aleator propriu); singura funcție cu acces la BD (aplicaIntrare)
// primește clientul ca parametru, ca să poată fi testată cu un client fals.
// Fără coloane noi: urma intrării (cantitate, factură, furnizor, preț, data) e o linie adăugată la `observatii`.
import { normalizeazaNumar } from './eipIntrareLogica.js'
import { dataCalendaristicaValida } from './magazieEipLogica.js'

const LIMITA_TEXT = { facturaNr: 60, furnizor: 120 }

// „1.000” poate fi o mie (scriere românească) sau 1 (punct zecimal): refuzăm în loc să ghicim.
const ambiguuMii = text => /^\d{1,3}\.\d{3}$/.test(String(text ?? '').trim())

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

export async function aplicaIntrare(db, { id, totalVazut, primit, linie, ref }) {
  if (!ref || !String(linie || '').includes(`ref ${ref}`)) return { stare: 'eroare', mesaj: 'Linia intrării nu are referința. Redeschide formularul.' }
  const citeste = () => db.from('magazie_echipamente').select('id,cantitate_total,observatii,activ').eq('id', id).maybeSingle()
  const r0 = await citeste()
  if (r0.error) return { stare: 'eroare', mesaj: 'Nu am putut citi stocul curent: ' + (r0.error.message || 'eroare necunoscută') + '. Nimic nu a fost scris.' }
  const b = r0.data
  if (!b) return { stare: 'eroare', mesaj: 'Echipamentul nu mai există sau nu îl poți vedea. Reîncarcă lista.' }
  if (String(b.observatii || '').includes(`ref ${ref}`)) return { stare: 'deja', total: b.cantitate_total }
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
  if (r2.error || !r2.data) return { stare: 'necunoscut', mesaj: 'Rezultatul nu poate fi confirmat. Reîncarcă și verifică dacă observațiile conțin „ref ' + ref + '” înainte de a reîncerca.' }
  if (String(r2.data.observatii || '').includes(`ref ${ref}`)) return { stare: 'deja', total: r2.data.cantitate_total }
  if (r1.error) return { stare: 'eroare', mesaj: (r1.error.message || 'eroare necunoscută') + '. Nimic nu a fost scris.' }
  const neschimbat = egalNr(r2.data.cantitate_total, b.cantitate_total) && (r2.data.observatii ?? null) === (b.observatii ?? null) && r2.data.activ !== false
  if (neschimbat) return { stare: 'refuzat', mesaj: 'Scrierea nu a fost acceptată (posibil fără drept de modificare). Nimic nu a fost scris.' }
  return { stare: 'conflict', total: r2.data.cantitate_total }
}

export const MESAJ_CONFLICT = 'Stocul s-a schimbat între timp (altcineva a modificat echipamentul). Reîncarcă lista și verifică totalul înainte de a adăuga din nou.'
