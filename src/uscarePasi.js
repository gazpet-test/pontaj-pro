// ═══════════════════════════════════════════════════════════════════════════
// uscarePasi.js — logica PURĂ a ecranului de uscare „pe pași” (telefon): tronsonul → etapa 1 (introducerea pistoanelor) → etapa 2 (ieșirea)
// → rezumat + raport. FĂRĂ schemă nouă: totul se deduce din rândul SALVAT al raportului (executie_uscari, 20261225a) și din pozele lui
// înregistrate; nu există o „stare a pasului” în baza de date.
// Definițiile de aici sunt singurele (L19) pentru: ce cere fiecare etapă, pasul la care a rămas un raport, diferența în grame, pragul de lucru
// și verdictul PROPUS. Ce cere închiderea („Generează raportul”) rămâne `lipsaDinRand` din uscareLogica.js (= fn_executie_uscare_lipsa):
// etapele de aici nu o dublează și nu o relaxează, doar ordonează completarea.
// Pragul de lucru (100 g pe km × lungimea tronsonului) e o CONSTANTĂ în cod în această felie (devine parametru de proiect în felia cu
// schema, docs/executie/USCARE_CONDUCTA_V2_SPEC.md §3); calculul doar PROPUNE, omul confirmă „uscat” / „umed”.
// ═══════════════════════════════════════════════════════════════════════════

import { parseNumar, textNr, areMaxZecimale } from './izoDocumenteLogica.js'
import {
  formularNou, formularDinRand, cantaririPentru, oraLocalaDinIso, alegereDinIso, isoDinOraLocala, ziBucuresti, fmtZi, fmtNr, MAX_BURETI,
  lipsaDinRand, pozeJustificate,
} from './uscareLogica.js'

/** pragul de lucru, g pe km (decizia proprietarului D3, 17.11.2026); aici constantă, apoi parametru de proiect cu istoric */
export const PRAG_G_PE_KM = 100
/** câte pistoane-burete propune etapa 1 */
export const BURETI_IMPLICIT = 2
/** pașii ecranului, în ordine; „inchis” / „anulat” sunt stările finale ale raportului (doar citire) */
export const PASI = ['tronson', 'etapa1', 'etapa2', 'rezumat']
export const ETICHETE_PAS = {
  tronson: 'Tronsonul', etapa1: 'Etapa 1 din 2 · introducerea pistoanelor', etapa2: 'Etapa 2 din 2 · ieșirea pistoanelor',
  rezumat: 'Rezumat și raport', inchis: 'Raport generat (închis)', anulat: 'Raport anulat',
}
// plauzibilitatea greutăților (aceleași valori ca propunerile din V2 §3.2 / §11): avertismente, nu blocări
export const KG_PARE_GRAME = 100      // ≥ 100 kg pe un piston-burete: aproape sigur s-au scris grame
export const KG_MARE = 50             // peste 50 kg: nefiresc de mare
export const KG_MIC = 0.1             // sub 0,1 kg: nefiresc de mic

const esteNr = x => typeof x === 'number' && Number.isFinite(x)
const nr = v => (v == null || v === '' ? null : typeof v === 'number' ? v : Number(v))
const lista = r => (Array.isArray(r?.cantariri) ? r.cantariri : [])
const cantarit = c => typeof c?.motiv !== 'string'
const arePoza = (poze, cat, n = null) => (poze || []).some(p => p.categorie === cat && (n == null || Number(p.burete_nr) === Number(n)))

// ── greutăți și prag (grame ÎNTREGI, ca nimic să nu se rotunjească înainte de comparație) ──
/** kg (cel mult 3 zecimale) → grame întregi; lipsă / invalid → null */
export const grame = kg => { const x = nr(kg); return esteNr(x) ? Math.round(x * 1000) : null }
/** diferența ieșire − intrare, în grame întregi (pozitivă = a reținut apă); o greutate lipsă → null */
export function diferentaGrame(c) {
  const a = grame(c?.intrare_kg), b = grame(c?.iesire_kg)
  return a == null || b == null ? null : b - a
}
/** pragul tronsonului în grame (poate avea zecimale): v g/km × L m / 1000; lungime lipsă / ≤ 0 → null */
export function pragGrame(lungimeM, v = PRAG_G_PE_KM) {
  const L = nr(lungimeM)
  return esteNr(L) && L > 0 && esteNr(v) && v > 0 ? (v * L) / 1000 : null
}
/**
 * Δ ≤ prag, în ÎNTREGI (aceeași formă ca în V2 §3.1, ca SQL-ul viitor să dea exact același rezultat):
 * Δ ≤ v·L/1000  ⇔  100.000·Δ ≤ (10·v)·(10·L)   (v și L au cel mult o zecimală; egalitatea TRECE)
 */
export function inPrag(dG, lungimeM, v = PRAG_G_PE_KM) {
  const L = nr(lungimeM)
  if (!Number.isInteger(dG) || !esteNr(L) || L <= 0) return null
  return 100000 * dG <= Math.round(10 * v) * Math.round(10 * L)
}
/** ultimul piston vehiculat = cântărirea cu numărul cel mai MARE (buretele 1 = primul introdus) */
export function ultimulPiston(r) {
  const l = lista(r).slice().sort((a, b) => Number(a.nr) - Number(b.nr))
  return l.length ? l[l.length - 1] : null
}
/**
 * Verdictul PROPUS din diferența ultimului piston față de pragul de lucru (omul îl confirmă sau îl contrazice cu motiv).
 * → { stare: 'trece' | 'nu_trece' | 'de_verificat' | 'necalculabil', propus: 'uscat' | 'umed' | null, nr, diferenta_g, prag_g, calcul, motiv }
 * Δ negativ mic (cel mult 1% din intrare) = „fără acumulare” → trece; Δ negativ mai mare = de verificat (cântărirea), fără propunere.
 * Runda 3: „cel mult 1%” se compară în ÎNTREGI (100 × pierdere_g ≤ intrare_g), fără toleranță minimă de 1 g (la 50 g, 1 g = 2%).
 */
export function verdictPropus(r, v = PRAG_G_PE_KM) {
  const u = ultimulPiston(r)
  const L = nr(r?.lungime_m)
  const P = pragGrame(L, v)
  const calcul = P == null ? null : `${fmtNr(v, 1)} g/km × ${fmtNr(L / 1000, 4)} km = ${fmtNr(P, 2)} g`
  const baza = { nr: u ? Number(u.nr) : null, diferenta_g: null, prag_g: P, calcul, propus: null }
  if (!u) return { ...baza, stare: 'necalculabil', motiv: 'niciun piston declarat' }
  if (!cantarit(u)) return { ...baza, stare: 'necalculabil', motiv: `ultimul piston (nr. ${u.nr}) nu are cântărire („nu se aplică”)` }
  const d = diferentaGrame(u)
  if (d == null) return { ...baza, stare: 'necalculabil', motiv: `lipsește greutatea ultimului piston (nr. ${u.nr}) la ${grame(u.intrare_kg) == null ? 'intrare' : 'ieșire'}` }
  if (P == null) return { ...baza, diferenta_g: d, stare: 'necalculabil', motiv: 'lipsește lungimea tronsonului (pragul se calculează din ea)' }
  if (d < 0) {
    return 100 * -d <= grame(u.intrare_kg)
      ? { ...baza, diferenta_g: d, stare: 'trece', propus: 'uscat', motiv: `a ieșit cu ${fmtNr(-d, 0)} g mai ușor: fără acumulare de apă` }
      : { ...baza, diferenta_g: d, stare: 'de_verificat', motiv: `a ieșit cu ${fmtNr(-d, 0)} g mai ușor (peste 1% din greutate): verifică cântărirea` }
  }
  const ok = inPrag(d, L, v)
  return { ...baza, diferenta_g: d, stare: ok ? 'trece' : 'nu_trece', propus: ok ? 'uscat' : 'umed',
    motiv: `diferența ${fmtNr(d, 0)} g ${ok ? '≤' : '>'} pragul de ${fmtNr(P, 2)} g` }
}
/** omul a ales altceva decât calculul (sau a ales deși calculul nu propune nimic) → cere un motiv scurt în observații */
export const contrazice = (rezultat, verdict) => !!rezultat && verdict?.propus !== rezultat
// ── motivul verdictului contrar: câmp DISTINCT pe ecran, inclus apoi în observații (fără schemă nouă, runda 3) ──
/** textul automat pus în observații de „Trecere nouă”; NU contează ca motiv */
export const textTrecere = (n, zi) => `Trecerea ${n} pe acest tronson (trecerea anterioară: raportul din ${zi || 'fără dată'}, ultimul piston nu a ieșit uscat).`
const RX_TEXT_TRECERE = /Trecerea \d+ pe acest tronson \(trecerea anterioară: raportul din [^)]*, ultimul piston nu a ieșit uscat\)\./g
/** eticheta cu care motivul scris de om intră în observații */
export const PREFIX_MOTIV_VERDICT = 'Verdictul diferit de calcul, motivul:'
/** ce rămâne din observații după scoaterea textului automat al trecerii = motivul scris de om ('' = niciun motiv) */
export const motivDinObservatii = obs => String(obs ?? '').replace(RX_TEXT_TRECERE, '').trim()
/** rândul cu care motivul intră în observații ('' = niciun motiv) */
const randMotiv = motiv => { const m = String(motiv ?? '').trim(); return m ? `${PREFIX_MOTIV_VERDICT} ${m}` : '' }
// liniile normalizate (CRLF, spații la capete), încadrate de \n: „conține rândul” = conține TOATE liniile lui, consecutive (motivul poate avea mai multe linii)
const liniiNorm = s => '\n' + String(s ?? '').replace(/\r\n?/g, '\n').split('\n').map(x => x.trim()).join('\n') + '\n'
/** observațiile au deja motivul: aceeași etichetă + același text (motiv gol = false) */
export const areMotivVerdict = (obs, motiv) => { const l = randMotiv(motiv); return !!l && liniiNorm(obs).includes(liniiNorm(l)) }
/**
 * formularul cu motivul verdictului (câmpul distinct de pe ecran) adăugat la observații; motiv gol = formularul neschimbat.
 * IDEMPOTENT (P2 din review-ul #1127): o reîncercare după refuz / eroare / conflict pornește de la formularul care are deja motivul
 * (salveaza îl pune pe ecran înaintea răspunsului, câmpul se golește doar după succes) → motivul deja prezent nu se adaugă a doua oară.
 */
export function cuMotivVerdict(form, motiv) {
  const l = randMotiv(motiv)
  if (!l || areMotivVerdict(form?.observatii, motiv)) return form
  return { ...form, observatii: [String(form?.observatii ?? '').trim(), l].filter(Boolean).join('\n') }
}

/** avertismentele unei greutăți scrise (text de pe ecran): unitatea greșită, valori nefirești; [] = nimic de spus */
export function avertismenteGreutate(text) {
  const x = parseNumar(text)
  if (x === null) return []
  if (!esteNr(x)) return ['nu e un număr (ex. 1,25)']
  if (x <= 0) return ['greutatea trebuie să fie mai mare ca zero']
  const out = []
  if (!areMaxZecimale(x, 3)) out.push('cel mult 3 zecimale (grame)')
  if (x >= KG_PARE_GRAME) out.push(`${fmtNr(x, 3)} kg pare scris în GRAME: dacă cântarul arată ${fmtNr(x, 0)} g, scrie ${textNr(x / 1000)} kg`)
  else if (x > KG_MARE) out.push(`${fmtNr(x, 3)} kg e nefiresc de mult pentru un piston-burete: verifică`)
  if (x < KG_MIC) out.push(`${fmtNr(x, 3)} kg e nefiresc de puțin: verifică (kg, nu grame)`)
  return out
}
/** plauzibilitatea perechii intrare / ieșire a unui piston (V2 §3.2): ieșirea peste 3 × intrarea, Δ peste 20 × prag */
export function avertismentePereche(c, pragG) {
  const a = grame(c?.intrare_kg), b = grame(c?.iesire_kg)
  if (a == null || b == null || a <= 0) return []
  const out = []
  if (b > 3 * a) out.push('la ieșire cântărește de peste 3 ori cât la intrare: verifică greutățile')
  if (esteNr(pragG) && pragG > 0 && b - a > 20 * pragG) out.push(`diferența e de peste 20 de ori pragul (${fmtNr(pragG, 2)} g): verifică`)
  return out
}

// ── ce cere fiecare etapă (pe un rând „ca al serverului”: cel salvat sau formularul convertit cu payloadDinFormular) ──
// Runda 3 (verdict P1): etapele NU cer nimic peste regula comună a închiderii (lipsaDinRand): pozele lipsă JUSTIFICATE (poze_justificare,
// aceeași ieșire ca în formularul complet) nu mai sunt cerute; poza ultimului piston e cerută doar ca dovadă a lui USCAT (ca dovada_conform);
// zero pistoane-burete e o configurație permisă (bureti_buc = 0, fără rânduri).
/** etapa 1: ora introducerii, câte pistoane, greutatea la intrare + poza cântarului pe fiecare, poza ansamblului → textele care lipsesc */
export function lipsaEtapa1(r, poze) {
  const out = []
  if (r?.ora_inceput == null) out.push('ora introducerii')
  const b = nr(r?.bureti_buc)
  if (!Number.isInteger(b) || b < 0) { out.push('câte pistoane-burete'); return out }
  const l = lista(r)
  if (l.length !== b || l.some(c => Number(c?.nr) > b)) out.push('rândurile de cântărire (câte unul pe piston)')
  const just = pozeJustificate(r)
  for (const c of l.slice().sort((x, y) => Number(x.nr) - Number(y.nr))) {
    if (!cantarit(c)) continue
    if (grame(c.intrare_kg) == null) out.push(`greutatea pistonului ${c.nr} la intrare`)
    if (!just && !arePoza(poze, 'cantar_intrare', c.nr)) out.push(`poza cântarului pentru pistonul ${c.nr} (intrare)`)
  }
  if (!just && !arePoza(poze, 'pistoane')) out.push('poza ansamblului de pistoane')
  return out
}
/**
 * etapa 2: ora ieșirii, greutatea la ieșire + poza cântarului pe fiecare piston cântărit, verdictul confirmat de om, poza ultimului piston
 * dacă iese USCAT (dovada); dacă omul contrazice calculul, un motiv scris de el (textul automat al trecerii nu contează).
 * Presiunea (și poza ei) NU blochează etapa (o cere doar închiderea, ca azi).
 */
export function lipsaEtapa2(r, poze, v = PRAG_G_PE_KM) {
  const out = []
  if (r?.ora_final == null) out.push('ora ieșirii')
  const just = pozeJustificate(r)
  for (const c of lista(r).slice().sort((x, y) => Number(x.nr) - Number(y.nr))) {
    if (!cantarit(c)) continue
    if (grame(c.iesire_kg) == null) out.push(`greutatea pistonului ${c.nr} la ieșire`)
    if (!just && !arePoza(poze, 'cantar_iesire', c.nr)) out.push(`poza cântarului pentru pistonul ${c.nr} (ieșire)`)
  }
  const rez = r?.piston_final_rezultat
  if (rez !== 'uscat' && rez !== 'umed') out.push('verdictul ultimului piston (uscat / umed)')
  else if (contrazice(rez, verdictPropus(r, v)) && !motivDinObservatii(r?.observatii)) out.push('motivul scris de tine pentru verdictul diferit de calcul')
  if (rez === 'uscat' && !arePoza(poze, 'piston_final')) out.push('poza ultimului piston (dovada că iese uscat)')
  return out
}
/**
 * Pasul la care a rămas un raport, DEDUS din datele lui (nimic stocat): fără raport = tronsonul; anulat / închis = final;
 * dacă regula COMUNĂ a închiderii (lipsaDinRand = fn_executie_uscare_lipsa) nu mai cere nimic → rezumatul, pe orice drum ar fi fost
 * completat raportul (formularul complet, birou, redeschidere) — o singură regulă decide dacă raportul se poate genera (runda 3, P1);
 * altfel prima etapă incompletă, apoi rezumatul. `poze` = pozele ÎNREGISTRATE ale raportului; `deschise` = încărcările nelămurite.
 */
export function pasCurent(r, poze, deschise = 0, v = PRAG_G_PE_KM) {
  if (!r) return 'tronson'
  if (r.stare === 'anulata') return 'anulat'
  if (r.stare === 'inchisa') return 'inchis'
  if (!lipsaDinRand(r, poze, deschise).length) return 'rezumat'
  if (lipsaEtapa1(r, poze).length) return 'etapa1'
  if (lipsaEtapa2(r, poze, v).length) return 'etapa2'
  return 'rezumat'
}

// ── formularele propuse ──
/** câmpurile „de birou” luate din ULTIMUL raport neanulat al proiectului (de confirmat la rezumat): patch de formular + sursa */
export const CHEI_PRECOMPLETARE = ['constructor', 'utilaje', 'pig_metalic_buc', 'piston_pu_buc', 'semn_constructor_nume', 'semn_constructor_functie',
  'semn_beneficiar_nume', 'semn_beneficiar_functie']
export function precompletare(uscari, exceptId = null) {
  const u = (uscari || []).filter(x => x.stare !== 'anulata' && x.id !== exceptId).sort((a, b) => b.id - a.id)[0]
  if (!u) return { patch: {}, sursa: null }
  const f = formularDinRand(u), patch = {}
  for (const k of CHEI_PRECOMPLETARE) {
    const val = f[k]
    if (Array.isArray(val) ? val.length > 0 : String(val ?? '').trim() !== '') patch[k] = val
  }
  return { patch, sursa: { id: u.id, tronson: u.tronson, data_operatie: u.data_operatie } }
}
/** formularul unei uscări noi pe pași: tronsonul (dacă e ales), detaliile din ultimul raport, ziua de azi, 2 pistoane-burete */
export function formularPasNou({ proba = null, uscari = [], constructor = '', acum = Date.now() } = {}) {
  const { patch } = precompletare(uscari)
  return { ...formularNou({ proba, constructor }), ...patch, data_operatie: ziBucuresti(acum), bureti_buc: String(BURETI_IMPLICIT),
    cantariri: cantaririPentru(BURETI_IMPLICIT) }
}
/** câte rapoarte (neanulate) are același tronson: același tronson de probă, altfel același interval de km */
export function treceriPeTronson(uscari, u) {
  return (uscari || []).filter(x => x.stare !== 'anulata' && (u.proba_id != null ? x.proba_id === u.proba_id
    : x.proba_id == null && x.km_de_la_m === u.km_de_la_m && x.km_pana_la_m === u.km_pana_la_m)).length
}
/**
 * „Trecere nouă” după un ultim piston umed: modelul de date ține O trecere pe raport (cântăririle au cheile exacte nr / intrare / ieșire /
 * motiv, o singură oră de început și de final), deci trecerea următoare = raport NOU pe același tronson, cu tronsonul, km-ii, lungimea,
 * configurația și detaliile copiate (nu greutățile); observațiile spun a câta trecere e.
 */
export function formularTrecereNoua(u, uscari = [], acum = Date.now()) {
  const f = formularDinRand(u), { patch } = precompletare([u])
  const n = treceriPeTronson(uscari, u) + 1
  return {
    ...formularNou({ constructor: f.constructor }), ...patch,
    proba_id: f.proba_id, tronson: f.tronson, km_de_la: f.km_de_la, km_pana_la: f.km_pana_la, lungime_m: f.lungime_m,
    data_operatie: ziBucuresti(acum), bureti_buc: f.bureti_buc || String(BURETI_IMPLICIT),
    cantariri: cantaririPentru(Number.isInteger(nr(f.bureti_buc)) && nr(f.bureti_buc) >= 1 && nr(f.bureti_buc) <= MAX_BURETI ? nr(f.bureti_buc) : BURETI_IMPLICIT),
    observatii: textTrecere(n, fmtZi(u.data_operatie)),
  }
}

// ── ora „ACUM” și timpul de deplasare ──
/** patch-ul de formular pentru un câmp-moment pus pe ora de acum (ora României, cu apariția aleasă la ora de iarnă) */
export function momentAcum(form, k, acum = Date.now()) {
  const iso = new Date(acum).toISOString()
  return { [k]: oraLocalaDinIso(acum), dst: { ...(form?.dst || {}), [k]: alegereDinIso(iso) } }
}
/** ora de pe ecran, sau ACUM dacă e goală („implicit acum”: se fixează la apăsarea butonului etapei) */
export const cuOraImplicita = (form, k, acum = Date.now()) => (String(form?.[k] ?? '').trim() ? form : { ...form, ...momentAcum(form, k, acum) })
/** minutele dintre două momente (ISO), cu o zecimală, în domeniul acceptat de server (0,1–10.000); altfel '' */
export function minuteIntre(a, b) {
  const x = Date.parse(a || ''), y = Date.parse(b || '')
  if (!Number.isFinite(x) || !Number.isFinite(y) || y <= x) return ''
  const m = Math.round((y - x) / 6000) / 10
  return m >= 0.1 && m <= 10000 ? textNr(m) : ''
}
/**
 * formularul trimis la „Termină etapa 2”: ora ieșirii (acum, dacă e goală), timpul de deplasare (din ore, dacă e gol), concluzia din verdict,
 * motivul verdictului contrar (câmpul distinct de pe ecran) adăugat la observații
 */
export function formularTerminaEtapa2(form, acum = Date.now(), motivVerdict = '') {
  const f = cuMotivVerdict(cuOraImplicita(form, 'ora_final', acum), motivVerdict)
  const a = isoDinOraLocala(f.ora_inceput, f.dst?.ora_inceput || null), b = isoDinOraLocala(f.ora_final, f.dst?.ora_final || null)
  const timp = String(f.timp_deplasare_min ?? '').trim() ? f.timp_deplasare_min : (typeof a === 'string' && typeof b === 'string' ? minuteIntre(a, b) : '')
  const concluzie = f.piston_final_rezultat === 'uscat' ? 'conform' : f.piston_final_rezultat === 'umed' ? 'neconform' : f.concluzie
  return { ...f, timp_deplasare_min: timp, concluzie }
}
/** formularul trimis la „Înregistrează etapa 1”: ora introducerii (acum, dacă e goală) și data operației = ziua ei */
export function formularInregistreazaEtapa1(form, acum = Date.now()) {
  const f = cuOraImplicita(form, 'ora_inceput', acum)
  const zi = /^\d{4}-\d{2}-\d{2}T/.test(String(f.ora_inceput)) ? String(f.ora_inceput).slice(0, 10) : f.data_operatie
  return { ...f, data_operatie: zi }
}
