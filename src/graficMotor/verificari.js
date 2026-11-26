// ════════════════════════════════════════════════════════════════
// graficMotor/verificari.js — verificările structurale care blochează trimiterea la verificatorul Paw (spec §6.3, §5.2–5.3).
//
// Moduri (spec §5.3):
//   'schita'   — diagnoză: PRESUPUS și executant presupus permise (avertisment); nu poate fi NICIODATĂ GO.
//   'lucru'    — ieșirea normală a generatorului: fără PRESUPUS; capacitatea de echipe/utilaje poate fi încă neconfirmată.
//   'depunere' — tot ce cere depunerea: fără PRESUPUS, fără executant presupus, capacitate confirmată, calendar cu sărbători.
// Fiecare problemă: { cod, gravitate: 'eroare' | 'avertisment', mesaj, activitate?, … }. „Eroare” = graficul nu trece.
// ════════════════════════════════════════════════════════════════

import { adaugaLuni, adaugaZile, dinIso } from './calendar.js'

export const MODURI = ['schita', 'lucru', 'depunere']
// Categoriile de activități (generatorul le pune pe fiecare frunză). Doar 'executie' cere articol de deviz.
// 'aprovizionare' (livrări pe drumul critic, spec §5.3) e permisă fără articol — de confirmat la review.
export const CATEGORII = ['executie', 'organizare', 'notificare', 'verificare_receptie', 'aprovizionare', 'jalon']
const RE_SURSA = /^(norma|document|raspuns|parametru):\S/
const ePresupus = (x) => /presupus/i.test(String(x ?? ''))
const normCod = (x) => String(x ?? '').trim().toUpperCase()

// Termenul (din cerințe sau parametri) → data limită inclusivă.
//   { tip: 'data', valoare: 'AAAA-LL-ZZ' }
//   { tip: 'luni', valoare: n, numara_ziua_start = true }  — implicit ziua OI e prima zi: 3 luni de la 02.11 → 01.02 (prudent);
//                                                           numara_ziua_start: false → ziua corespunzătoare (02.02), regula din Codul civil
//   { tip: 'zile_calendaristice', valoare: n }           — OI + n − 1
//   { tip: 'zile_lucratoare', valoare: n }               — a n-a zi lucrătoare de la OI
export function dataLimita(termen, dataOI, axa) {
  const v = termen?.valoare
  switch (termen?.tip) {
    case 'data': dinIso(v); return v
    case 'luni':
      if (!(Number.isInteger(v) && v > 0)) throw new Error(`termen în luni invalid: ${JSON.stringify(v)}`)
      return termen.numara_ziua_start === false ? adaugaLuni(dataOI, v) : adaugaZile(adaugaLuni(dataOI, v), -1)
    case 'zile_calendaristice':
      if (!(Number.isInteger(v) && v > 0)) throw new Error(`termen în zile invalid: ${JSON.stringify(v)}`)
      return adaugaZile(dataOI, v - 1)
    case 'zile_lucratoare':
      if (!(Number.isInteger(v) && v > 0)) throw new Error(`termen în zile lucrătoare invalid: ${JSON.stringify(v)}`)
      return axa.zi(v - 1)
    default: throw new Error(`tip de termen necunoscut: ${JSON.stringify(termen?.tip)}`)
  }
}

export function verificaStructura({ noduri, legaturi, cpm, mod, articoleValidate, parametri = {}, calendar, axa, termen, dataOI, dataFinal }) {
  const p = []
  const err = (cod, mesaj, extra = {}) => p.push({ cod, gravitate: 'eroare', mesaj, ...extra })
  const av = (cod, mesaj, extra = {}) => p.push({ cod, gravitate: 'avertisment', mesaj, ...extra })
  const dupaMod = (strict) => (strict ? err : av)
  const schita = mod === 'schita', depunere = mod === 'depunere'
  const r = cpm.rezultate
  const frunze = noduri.filter(n => !n.rezumat)
  const propriu = String(parametri.executant_propriu || 'Gazpet').trim()

  // ── calendarul ──
  if (calendar.faraSarbatori) dupaMod(!schita)('CALENDAR_FARA_SARBATORI', 'calculul e făcut FĂRĂ sărbătorile legale — permis doar în schiță')
  for (const x of calendar.probleme) p.push({ ...x })

  // ── termenul, pe calendarul cu sărbători (spec §6.1: motorul îl prinde, nu verificatorul) ──
  let termenRez = null
  if (!termen) dupaMod(!schita)('TERMEN_LIPSA', 'nu e dat termenul de execuție (din cerințe sau parametri) — încadrarea nu se poate verifica')
  else {
    try {
      const limita = dataLimita(termen, dataOI, axa)
      const iLim = axa.index(limita)
      const iFin = Math.max(0, cpm.durata - 1)
      termenRez = { data_limita: limita, data_final: dataFinal, rezerva_zile_lucratoare: iLim - iFin, incadrat: dinIso(dataFinal) <= dinIso(limita) }
      if (!termenRez.incadrat) err('TERMEN_DEPASIT', `finalul calculat ${dataFinal} depășește termenul ${limita} cu ${iFin - iLim} zile lucrătoare`, { data_limita: limita, data_final: dataFinal, depasire_zile_lucratoare: iFin - iLim })
    } catch (e) { err('TERMEN_INVALID', `termenul nu se poate interpreta: ${e.message}`) }
  }

  // ── durate, jaloane, categorii ──
  for (const n of frunze) {
    if (n.jalon && n.d > 0) err('JALON_CU_DURATA', `${n.cod}: jalon cu durată ${n.d} (jaloanele au durată 0)`, { activitate: n.cod })
    if (!n.jalon && n.d === 0) err('DURATA_ZERO', `${n.cod}: durată 0 la o activitate care nu e jalon (o remediere eventuală se modelează cu o rezervă cerută omului)`, { activitate: n.cod })
    const cat = n.categorie == null ? (n.jalon ? 'jalon' : null) : String(n.categorie)
    if (!cat) err('CATEGORIE_LIPSA', `${n.cod}: lipsește categoria (${CATEGORII.join(' / ')})`, { activitate: n.cod })
    else if (!CATEGORII.includes(cat)) err('CATEGORIE_INVALIDA', `${n.cod}: categorie necunoscută „${cat}”`, { activitate: n.cod })
    // r1 (Jak) P1: categoria „jalon” doar pe jaloane și invers — altfel o activitate cu durată scapă de obligațiile de execuție (echipă, articol)
    else if ((cat === 'jalon') !== n.jalon) err('CATEGORIE_JALON_NECONCORDANTA', `${n.cod}: ${n.jalon ? 'jalonul are categoria „' + cat + '”' : 'activitatea cu durată are categoria „jalon”'} (categoria „jalon” ⇔ jalon)`, { activitate: n.cod })
    n._cat = cat
    // r1 (Jak) P1: ORICE marcaj PRESUPUS (și pe un jalon) interzice GO (spec §5.3, §10.5); lipsa sursei e cerută doar unde există durată
    const s = n.sursa_durata
    if (ePresupus(s)) dupaMod(!schita)('DURATA_PRESUPUSA', `${n.cod}: ${n.jalon ? 'jalonul e marcat' : 'durata e'} PRESUPUS — fără normă validată, document sau răspuns`, { activitate: n.cod })
    else if (!n.jalon && !RE_SURSA.test(String(s ?? ''))) dupaMod(!schita)('SURSA_DURATA_INVALIDA', `${n.cod}: sursa duratei lipsește sau nu e norma:/document:/raspuns:/parametru: (are ${JSON.stringify(s ?? null)})`, { activitate: n.cod })
    // r1 (Jak) P1: contractul câmpurilor de listă — o formă greșită e eroare, nu „nu cere nimic” (L12/L18)
    if (n.utilaje != null && !(Array.isArray(n.utilaje) && n.utilaje.every(u => (typeof u === 'string' && u.trim()) || (u && typeof u === 'object' && typeof u.tip === 'string' && u.tip.trim() && Number.isInteger(u.numar) && u.numar > 0))))
      err('UTILAJE_INVALIDE', `${n.cod}: utilaje trebuie să fie o listă de tipuri sau {tip, numar întreg > 0} (are ${JSON.stringify(n.utilaje)})`, { activitate: n.cod })
    if (n.articole_deviz != null && !(Array.isArray(n.articole_deviz) && n.articole_deviz.every(a => typeof a === 'string' && a.trim())))
      err('ARTICOLE_INVALIDE', `${n.cod}: articole_deviz trebuie să fie o listă de coduri (are ${JSON.stringify(n.articole_deviz)})`, { activitate: n.cod })
    if (n.tip_echipa != null && !(typeof n.tip_echipa === 'string' && n.tip_echipa.trim()))
      err('TIP_ECHIPA_INVALID', `${n.cod}: tip_echipa trebuie să fie un text nevid (are ${JSON.stringify(n.tip_echipa)})`, { activitate: n.cod })
    const ex = String(n.executant ?? '').trim()
    if (!ex || ePresupus(ex)) dupaMod(depunere)('EXECUTANT_PRESUPUS', `${n.cod}: executantul lipsește sau e presupus`, { activitate: n.cod })
  }

  // ── fiecare activitate are succesor, în afara jalonului final ──
  const areSucc = new Set(legaturi.map(l => l.de))
  const terminale = frunze.filter(n => !areSucc.has(n.cod))
  const jaloaneTerminale = terminale.filter(n => n.jalon)
  const final = jaloaneTerminale.sort((a, b) => r.get(b.cod).ef - r.get(a.cod).ef || b.ordine - a.ordine)[0] || null
  if (!final) err('JALON_FINAL_LIPSA', 'graficul nu se termină într-un jalon final (ex. PV de recepție la terminarea lucrărilor)')
  for (const n of terminale) if (n !== final) err('FARA_SUCCESOR', `${n.cod}: activitate fără succesor (doar jalonul final poate închide rețeaua)`, { activitate: n.cod })

  // ── legăturile de punct de control au motiv cu sursă (spec §5.2; r1 Jak P2) ──
  // Determinist: legătura marcată control:true de generator SAU care atinge o activitate „verificare_receptie” (PCC, probe,
  // verificare izolație, lucrări ascunse). Motivul trebuie să citeze sursa: document:<id…>, raspuns:<id> sau regula:<nume>.
  const RE_MOTIV = /\b(document|raspuns|regula)\s*:\s*\S/
  const catDe = new Map(frunze.map(n => [n.cod, n._cat]))
  for (const l of legaturi) {
    const deControl = l.control || catDe.get(l.de) === 'verificare_receptie' || catDe.get(l.la) === 'verificare_receptie'
    if (deControl && !RE_MOTIV.test(String(l.motiv ?? '')))
      dupaMod(!schita)('LEGATURA_CONTROL_FARA_MOTIV', `legătura ${l.de} → ${l.la} ține de un punct de control, dar motivul nu citează sursa (document: / raspuns: / regula:) — are ${JSON.stringify(l.motiv)}`, { de: l.de, la: l.la })
  }

  // ── corespondența cu devizul (C3) ──
  const validate = new Map()
  for (const a of articoleValidate || []) { const c = normCod(a?.cod ?? a); if (c) validate.set(c, a) }
  if (!validate.size) err('CANTITATI_NEVALIDATE', 'nu există articole de deviz validate (ofertare_cantitati, status validat) — validați cantitățile; nu se lucrează pe lista din documente')
  const acoperite = new Set()
  for (const n of noduri) {
    const art = (Array.isArray(n.articole_deviz) ? n.articole_deviz : []).map(normCod).filter(Boolean)
    if (n.rezumat) { if (art.length) err('ARTICOL_PE_REZUMAT', `${n.cod}: articolele de deviz se pun pe activități, nu pe rezumate`, { activitate: n.cod }); continue }
    if (art.length > 1) err('ARTICOLE_GRUPATE', `${n.cod}: acoperă ${art.length} articole (${art.join(', ')}) — o activitate acoperă cel mult un articol`, { activitate: n.cod, articole: art })
    for (const c of art) {
      if (validate.size && !validate.has(c)) err('ARTICOL_NECUNOSCUT', `${n.cod}: articolul ${c} nu e în cantitățile validate`, { activitate: n.cod, articol: c })
      acoperite.add(c)
    }
    if (n._cat === 'executie' && !art.length) err('EXECUTIE_FARA_ARTICOL', `${n.cod}: activitate de execuție fără articol de deviz`, { activitate: n.cod })
  }
  for (const c of validate.keys()) if (!acoperite.has(c)) err('ARTICOL_FARA_ACTIVITATE', `articolul ${c} nu are nicio activitate în grafic`, { articol: c })

  // ── capacitate: echipe pe executant + tip, utilaje (spec §5.2) — verificare zilnică ──
  const capacitate = { echipe: [], utilaje: [] }
  const grupuri = new Map()
  for (const n of frunze) {
    if (n.d === 0) continue
    if (n._cat === 'executie' && !n.tip_echipa) dupaMod(depunere)('TIP_ECHIPA_LIPSA', `${n.cod}: activitate de execuție fără tip de echipă`, { activitate: n.cod })
    if (n.tip_echipa) {
      const ex = String(n.executant ?? '').trim(), k = `e\u0000${ex}\u0000${n.tip_echipa}`
      if (!grupuri.has(k)) grupuri.set(k, { fel: 'echipa', executant: ex, tip: String(n.tip_echipa), activitati: [] })
      grupuri.get(k).activitati.push({ cod: n.cod, numar: 1 })
    }
    for (const u of Array.isArray(n.utilaje) ? n.utilaje : []) {
      const tip = typeof u === 'string' ? u : u?.tip, numar = typeof u === 'string' ? 1 : Number(u?.numar ?? 1)
      if (!tip) continue
      const k = `u\u0000${tip}`
      if (!grupuri.has(k)) grupuri.set(k, { fel: 'utilaj', tip: String(tip), activitati: [] })
      grupuri.get(k).activitati.push({ cod: n.cod, numar: Number.isInteger(numar) && numar > 0 ? numar : 1 }) // forma invalidă e deja UTILAJE_INVALIDE
    }
  }
  for (const g of grupuri.values()) {
    const cap = g.fel === 'utilaj' ? parametri.utilaje?.[g.tip]
      : g.executant === propriu ? parametri.echipe?.[g.tip] : parametri.capacitate_subcontractanti?.[g.executant]?.[g.tip]
    const coduri = g.activitati.map(a => a.cod)
    const eticheta = g.fel === 'utilaj' ? `utilajul „${g.tip}”` : `echipele „${g.tip}” ale executantului ${g.executant || '(necunoscut)'}`
    if (!(Number.isInteger(cap) && cap >= 0)) {
      dupaMod(depunere)(g.fel === 'utilaj' ? 'UTILAJ_NECONFIRMAT' : 'CAPACITATE_NECONFIRMATA', `nu e confirmat câte ${eticheta} sunt disponibile (folosite de ${coduri.length} activități)`, { tip: g.tip, executant: g.executant, activitati: coduri })
      continue
    }
    const pe = new Map()
    for (const a of g.activitati) { const x = r.get(a.cod); for (let i = x.es; i < x.ef; i++) pe.set(i, (pe.get(i) || 0) + a.numar) }
    let max = 0, ziMax = null
    for (const [i, k] of pe) if (k > max || (k === max && ziMax !== null && i < ziMax)) { max = k; ziMax = i }
    const rand = { fel: g.fel, tip: g.tip, executant: g.executant, capacitate: cap, maxim_simultan: max }
    ;(g.fel === 'utilaj' ? capacitate.utilaje : capacitate.echipe).push(rand)
    if (max > cap) {
      const simultan = g.activitati.filter(a => { const x = r.get(a.cod); return x.es <= ziMax && ziMax < x.ef }).map(a => a.cod)
      err(g.fel === 'utilaj' ? 'UTILAJ_DEPASIT' : 'CAPACITATE_DEPASITA', `${eticheta}: ${max} în paralel în ziua ${axa.zi(ziMax)}, disponibil ${cap} (${simultan.join(', ')})`, { tip: g.tip, executant: g.executant, zi: axa.zi(ziMax), activitati: simultan })
    }
  }

  return { probleme: p, termen: termenRez, jalonFinal: final?.cod || null, capacitate }
}
