// ════════════════════════════════════════════════════════════════════════════
// LIB SERVICE — helpers pentru calcule scadențe service (Pachet C)
// ════════════════════════════════════════════════════════════════════════════
// Folosit de:
//   - ServiceTab.jsx (coloana „Următor service" + KPI scadențe)
//   - Acasă (widget „Active cu service aproape/depășit")
//   - oriunde mai apare nevoia de a calcula scadența service
//
// Capcane spelling de care să ții cont când scrii queries:
//   logistica_alimentari.active_id  (cu E)
//   logistica_service_fise.activ_id (FĂRĂ E)
//   v_active_km_ore.activ_id        (FĂRĂ E)
// ════════════════════════════════════════════════════════════════════════════

import { PRAG_CITIRI, zi, zileIntre } from './citiriBord.js'
import { citesteCompletDupaId } from './logisticaTransporturi.js'

// TKT-2026-0380 (r3): lista fișelor din tabul Service (din ea se calculează KPI-ul și filtrul
// „Scadențe”) se citește COMPLET: serverul taie orice răspuns la 1.000 de rânduri fără eroare, iar o
// fișă veche cu scadența depășită, rămasă după tăietură, ar scoate utilajul din „depășite”. Aceeași
// citire ca la Transporturi (#1069): keyset pe id, numărare la început și la final, reîncercare de la
// zero la orice abatere, altfel EROARE (niciodată o listă parțială prezentată ca întreagă).
export const SELECT_FISE_SERVICE = '*, logistica_active(id, cod_intern, nr_inventar, nr_inmatriculare, marca, model, km_actuali, ore_functionare_actuale, categorie_id, logistica_categorii:categorie_id(tip, subcategorie)), logistica_service_intrari(id)'
export const NUME_FISE_SERVICE = { pl: 'fișe de service', plArt: 'fișele de service', unul: 'o fișă de service', art: 'fișa' }
// Ordinea listei de până acum: data_fisei descrescător (fără dată la final), apoi id descrescător.
export const ordineListaFise = (a, b) => {
  const da = a.data_fisei || null, db = b.data_fisei || null
  if (da !== db) { if (da == null) return 1; if (db == null) return -1; return da < db ? 1 : -1 }
  return b.id - a.id
}
// tabel = () => client.from('logistica_service_fise'). Aruncă la orice eroare / citire incompletă.
export async function incarcaFiseService(tabel, { pagina = 1000, incercari = 3 } = {}) {
  const rows = await citesteCompletDupaId(o => tabel().select(o.head ? 'id' : SELECT_FISE_SERVICE, o),
    { pagina, incercari, nume: NUME_FISE_SERVICE })
  return rows.sort(ordineListaFise)
}

// Praguri pentru a marca o scadență drept „aproape" (galben)
export const PRAG_ZILE = 30
export const PRAG_KM   = 1000
export const PRAG_ORE  = 100

// Ziua de azi 'AAAA-LL-ZZ' în Europe/Bucharest.
export const aziBucuresti = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

const numar = v => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null))
const are = v => v != null && v !== ''

// Citirea de pe fișă (cea mai mare dintre intrare / ieșire) pentru 'km' sau 'ore'; null dacă lipsește.
export function citireFisa(fisa, tip) {
  const [a, b] = tip === 'km' ? ['km_intrare', 'km_iesire'] : ['ore_intrare', 'ore_iesire']
  const v = [fisa?.[a], fisa?.[b]].map(numar).filter(x => x != null)
  return v.length ? Math.max(...v) : null
}

// TKT-2026-0380 (r2): e plauzibilă CITIREA curentă (km / ore live)? Nu se judecă după cât de mare e
// restanța (o revizie ratată de mult poate avea o restanță uriașă și reală), ci după ritmul de creștere
// față de citiri datate: de la o citire `val` din ziua `data` până azi, contorul poate crește cel mult
// (zile + 1) × maxPeZi (24 h/zi la ore, 1.000 km/zi la km — PRAG_CITIRI din citiriBord.js, aceleași
// plafoane ca la validarea fișelor și alimentărilor). Plus plafonul absolut.
// referinte = [{ val, data, sursa: 'fisa' | 'alimentare', id }]. Telemetria NU e referință (odometrul
// GPS poate porni de la altă valoare decât bordul), valoarea manuală nu are dată.
// Întoarce null (plauzibilă / nu se poate judeca) sau { motiv: 'plafon' | 'ritm', ref, zile, posibil, crestere }.
// Limită cunoscută (r3): nu există o reconciliere a înlocuirii contorului / bordului. Dacă un contor
// nou pornește de la altă valoare decât cel vechi, citirile de dinainte rămân referință și eticheta
// „citire de verificat” poate apărea pe nedrept până la primele citiri datate de după înlocuire.
// Eticheta doar cere verificarea; nivelul (depășit / aproape) nu se schimbă din cauza ei.
export function citireNeverosimila(tip, live, referinte, azi = aziBucuresti()) {
  const p = PRAG_CITIRI[tip], L = numar(live)
  if (!p || L == null) return null
  if (L > p.plafon) return { motiv: 'plafon', plafon: p.plafon }
  const d1 = zi(azi)
  if (!d1) return null
  let rau = null
  for (const r of referinte || []) {
    if (!r || (r.sursa !== 'fisa' && r.sursa !== 'alimentare')) continue
    const v = numar(r.val), d0 = zi(r.data)
    if (v == null || v <= 0 || v > p.plafon || !d0 || d0 > d1) continue
    const zile = zileIntre(d0, d1) + 1, posibil = zile * p.maxPeZi, exces = L - v - posibil
    if (exces > 0 && (!rau || exces > rau.exces)) rau = { motiv: 'ritm', ref: { sursa: r.sursa, id: r.id ?? null, val: v, data: d0 }, zile, posibil, crestere: L - v, exces }
  }
  return rau
}

// ─── Ce scadențe vechi sunt închise de o fișă ulterioară (TKT-2026-0380 r2) ─────────────────
// O scadență a fișei F (dată / km / ore) e ACOPERITĂ doar de o fișă G a aceluiași activ, ulterioară
// (data_fisei, apoi id), care: e FINALIZATĂ (statusurile: programat / in_lucru / finalizat), e de tip
// MENTENANȚĂ (tipurile: mentenanta / reparatie), are data_fisei ≤ azi și are ea însăși o scadență pe
// ACEEAȘI dimensiune (ore cu ore, km cu km, dată cu dată) — adică revizia acelei obligații s-a făcut și
// s-a stabilit următoarea. Orice alt caz (reparație, fișă programată / în lucru, altă dimensiune, fișă
// fără dată) NU acoperă: restanța rămâne afișată.
export const DIMENSIUNI = ['data', 'km', 'ore']
const CAMP_SCADENTA = { data: 'urmatoarea_data', km: 'urmatoarea_km', ore: 'urmatoarea_ore' }
const ordine = (a, b) => (a.data_fisei || '').localeCompare(b.data_fisei || '') || (Number(a.id) - Number(b.id))

export function poateAcoperi(g, dim, azi = aziBucuresti()) {
  const d = zi(g?.data_fisei), z = zi(azi)
  return !!g && g.status === 'finalizat' && g.tip === 'mentenanta' && !!d && !!z && d <= z && are(g[CAMP_SCADENTA[dim]])
}

// { [fisa.id]: { data?: G, km?: G, ore?: G } } — pentru fiecare dimensiune acoperită, prima fișă care o
// acoperă. Fișele fără nicio dimensiune acoperită lipsesc din rezultat.
export function acopeririScadente(fise, azi = aziBucuresti()) {
  const grupe = new Map()
  for (const f of fise || []) {
    if (!f || f.activ_id == null) continue
    if (!grupe.has(f.activ_id)) grupe.set(f.activ_id, [])
    grupe.get(f.activ_id).push(f)
  }
  const out = {}
  for (const lista of grupe.values()) {
    lista.sort(ordine)
    lista.forEach((f, i) => {
      for (const dim of DIMENSIUNI) {
        if (!are(f[CAMP_SCADENTA[dim]])) continue
        const g = lista.slice(i + 1).find(x => poateAcoperi(x, dim, azi))
        if (g) { if (!out[f.id]) out[f.id] = {}; out[f.id][dim] = g }
      }
    })
  }
  return out
}

/**
 * Calculează cea mai apropiată scadență de service.
 *
 * @param {Object} fisa - ultima fișă service (poate fi null)
 *                       cu urmatoarea_data / urmatoarea_km / urmatoarea_ore
 * @param {number|null} kmLive  - km curenți (din v_active_km_ore.km_live)
 * @param {number|null} oreLive - ore curente (din v_active_km_ore.ore_live)
 * @param {Object} [opt] - TKT-2026-0380: { azi: 'AAAA-LL-ZZ', acoperite: { data?, km?, ore? } (din
 *                         acopeririScadente — dimensiunile închise de o fișă ulterioară nu se mai
 *                         compară), referinte: { km: [...], ore: [...] } (citiri datate din alte surse) }
 * @returns {{tip:'data'|'km'|'ore', ramas:number, label:string, deVerificat?:true, verificare?:Object} | null}
 */
export function calcUrmService(fisa, kmLive, oreLive, opt = {}) {
  if (!fisa) return null
  const { azi = aziBucuresti(), acoperite = null, referinte = null } = opt || {}
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const items = []

  if (fisa.urmatoarea_data && !acoperite?.data) {
    const d = new Date(fisa.urmatoarea_data)
    const diffDays = Math.floor((d - today) / 86400000)
    items.push({
      tip: 'data',
      ramas: diffDays,
      urgenta: diffDays / PRAG_ZILE,
      label: diffDays < 0 ? `${Math.abs(diffDays)} zile depășite` : `${diffDays} zile`,
    })
  }
  // TKT-2026-0380 (r2): o depășire rămâne DEPĂȘIRE (nivel, urgență, etichetă — deci KPI și filtrul
  // „Scadențe” o văd), oricât de mare. Dacă citirea curentă e neverosimilă (citireNeverosimila: ritm
  // imposibil față de citirea de pe fișă sau de citirile din alte surse, ori peste plafon), scadența
  // primește ÎN PLUS deVerificat + verificare (motivul și citirea de referință), fără să-și piardă nivelul.
  const marcheaza = (item, tip, live) => {
    if (item.ramas >= 0) return item
    const refs = [{ val: citireFisa(fisa, tip), data: fisa.data_fisei, sursa: 'fisa', id: fisa.id ?? null }, ...(referinte?.[tip] || [])]
    const v = citireNeverosimila(tip, live, refs, azi)
    return v ? { ...item, deVerificat: true, verificare: v, live: Number(live), depasire: Math.abs(item.ramas) } : item
  }
  if (fisa.urmatoarea_km != null && kmLive != null && !acoperite?.km) {
    const diff = fisa.urmatoarea_km - kmLive
    items.push(marcheaza({
      tip: 'km',
      ramas: diff,
      urgenta: diff / PRAG_KM,
      label: diff < 0
        ? `${Math.abs(diff).toLocaleString('ro-RO')} km depășiți`
        : `${diff.toLocaleString('ro-RO')} km`,
    }, 'km', kmLive))
  }
  if (fisa.urmatoarea_ore != null && oreLive != null && !acoperite?.ore) {
    const diff = fisa.urmatoarea_ore - oreLive
    items.push(marcheaza({
      tip: 'ore',
      ramas: diff,
      urgenta: diff / PRAG_ORE,
      label: diff < 0 ? `${Math.abs(diff)} h depășite` : `${diff} h`,
    }, 'ore', oreLive))
  }

  if (!items.length) return null
  // TKT-0152 (Daniel Oancea): înainte sortam după `ramas` brut, adică comparam
  // ZILE cu KM cu ORE — numere din unități diferite. „30 zile" ieșea mereu
  // înaintea „5000 km", așa că din clipa în care cineva punea data următoarei
  // revizii, coloana „URMĂTOR" arăta zile și ascundea kilometrii, deși mașina
  // ajungea la km cu mult înainte de dată.
  // Acum comparăm cât de aproape e fiecare scadență de PROPRIUL ei prag
  // (urgenta = rămas / prag), deci se compară lucruri comparabile.
  items.sort((x, y) => x.urgenta - y.urgenta)
  // `toate` = toate scadențele definite, cea mai urgentă prima — badge-ul le
  // arată pe toate, ca omul să vadă și km și data, nu doar una.
  return { ...items[0], toate: items }
}

// TKT-2026-0380: are vreo scadență a fișei o citire de verificat (oricare dimensiune, nu doar prima)?
export const areCitireDeVerificat = u => (u?.toate || []).some(r => r.deVerificat)

// TKT-2026-0380 (r2): cea mai urgentă scadență DESCHISĂ a fiecărui activ, din TOATE fișele lui (nu doar
// din ultima): o fișă ulterioară care nu acoperă obligația (reparație, programare, altă dimensiune) nu
// mai poate ascunde o restanță. Folosit de KPI-ul „Scadențe” și de filtrul lui, ca să numere la fel.
// kmOre = { [activ_id]: { km_live, ore_live } }; exclude(activ_id) = true pentru activele fără service.
// Întoarce { [activ_id]: { fisa, u } }.
export function scadenteDeschisePeActiv(fise, kmOre, { azi = aziBucuresti(), acoperiri = null, exclude = null } = {}) {
  const acop = acoperiri || acopeririScadente(fise, azi)
  const out = {}
  for (const f of fise || []) {
    if (!f || f.activ_id == null || (exclude && exclude(f.activ_id))) continue
    const km = kmOre?.[f.activ_id]
    const u = calcUrmService(f, km?.km_live, km?.ore_live, { azi, acoperite: acop[f.id] })
    if (!u) continue
    const cur = out[f.activ_id]
    if (!cur || u.urgenta < cur.u.urgenta || (u.urgenta === cur.u.urgenta && ordine(f, cur.fisa) > 0)) out[f.activ_id] = { fisa: f, u }
  }
  return out
}

/**
 * Returnează level-ul scadenței.
 * 'depasit' (roșu) | 'aproape' (galben) | 'ok' (verde) | null
 * TKT-2026-0380 (r2): o „citire de verificat” NU schimbă nivelul — depășitul rămâne depășit.
 */
export function urmServiceLevel(u) {
  if (!u) return null
  if (u.ramas < 0) return 'depasit'
  if (u.tip === 'data' && u.ramas <= PRAG_ZILE) return 'aproape'
  if (u.tip === 'km'   && u.ramas <= PRAG_KM)   return 'aproape'
  if (u.tip === 'ore'  && u.ramas <= PRAG_ORE)  return 'aproape'
  return 'ok'
}

/**
 * Returnează culoarea hex corespunzătoare level-ului.
 * Folosește paleta G din Logistica.jsx — schimbă dacă tema diferă.
 */
export function urmServiceColor(u) {
  const lvl = urmServiceLevel(u)
  if (lvl === 'depasit') return '#F85149'  // G.red
  if (lvl === 'aproape') return '#D29922'  // G.yellow
  if (lvl === 'ok')      return '#3FB950'  // G.green
  return '#6E7681'                          // G.dim
}

/**
 * Helper de UI: textul scurt pentru badge.
 * Ex: „📅 12 zile" / „🛣️ 450 km depășiți" / „⏱️ 80 h"
 */
export function urmServiceBadgeText(u) {
  if (!u) return '—'
  const icon = u.tip === 'data' ? '📅' : u.tip === 'km' ? '🛣️' : '⏱️'
  return `${icon} ${u.label}${areCitireDeVerificat(u) ? ' · 🔎 citire de verificat' : ''}`
}
