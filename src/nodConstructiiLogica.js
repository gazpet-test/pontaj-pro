// ═══════════════════════════════════════════════════════════════════════════
// nodConstructiiLogica.js — logica pură pentru elementele de CONSTRUCȚII ale unui nod de cuplare (Execuție)
// Cererea lui Răzvan, 10.11.2026: fundațiile, împrejmuirea, poarta, suporturile, platformele nodului Prunișor (planșa 1413-PR-C-00),
// cu etapele bifate zilnic pe telefon, ca sudurile. Tabelul: executie_noduri_constructii (migrarea 20261207a). Fără React, fără Supabase:
// vocabularul etapelor (aceeași listă ca în SQL, test de paritate), progresul pe element / tip / grup, validarea bifării, payload-ul
// RPC-ului și parsarea CSV-ului de inventar pentru generatorul de import.
// ═══════════════════════════════════════════════════════════════════════════

import { norm } from './lib/diacritice.js'
import { parseNumar } from './izoDocumenteLogica.js'
import { scadeZile, ZILE_INAPOI } from './nodCuplareLogica.js'

// ── etapele: vocabular închis, în ordinea firească (aceeași listă ca fn_executie_constr_etape_valide; blocul ETAPE-START / ETAPE-END) ──
export const ETAPE = ['trasare', 'sapatura', 'egalizare', 'armare_cofrare', 'turnare', 'elevatie', 'decofrare', 'umplutura', 'strat_suport', 'finisaj', 'confectionare', 'montaj']
export const ETICHETE_ETAPE = {
  trasare: 'Trasare', sapatura: 'Săpătură', egalizare: 'Beton de egalizare', armare_cofrare: 'Armare + cofrare', turnare: 'Turnare beton',
  elevatie: 'Elevație', decofrare: 'Decofrare', umplutura: 'Umplutură compactată', strat_suport: 'Strat suport (balast / piatră)',
  finisaj: 'Finisaj', confectionare: 'Confecționare', montaj: 'Montaj',
}
export const eticheta = e => ETICHETE_ETAPE[e] || `etapă necunoscută (${e})`

// ── tipurile (lista albă din CHECK-ul tabelului), în ordinea de afișare ──
export const TIPURI = ['fundatie', 'camin', 'suport', 'imprejmuire', 'poarta', 'platforma', 'rigola', 'terasamente']
export const ETICHETE_TIP = {
  fundatie: 'Fundații', camin: 'Cămine', suport: 'Suporturi și confecții metalice', imprejmuire: 'Împrejmuire', poarta: 'Poartă',
  platforma: 'Platforme și drum', rigola: 'Rigole', terasamente: 'Terasamente',
}
export const UM = ['buc', 'm', 'mp', 'mc']

// ── grupurile (legătura cu instalația): filtrele de sus; „rezervoare” primul (termenul rezervoarelor) ──
export const GRUP_PRIORITAR = 'rezervoare'
export const ETICHETE_GRUP = {
  rezervoare: '🛢️ Fundații rezervoare', spc: '⚡ SPC', gara: 'Gara de lansare', masurare: 'Panou de măsurare', robinete: 'Robinete',
  cos: 'Coș refulare', haba: 'Habă', iluminat: 'Stâlpi iluminat', paratrasnet: 'Paratrăsnete', imprejmuire: 'Împrejmuire și poartă',
  platforme: 'Platforme și drum', psi: 'Pichet PSI', rigola: 'Rigolă', sistematizare: 'Sistematizare',
}
const ORDINE_GRUP = Object.keys(ETICHETE_GRUP)
export const etichetaGrup = g => ETICHETE_GRUP[g] || g

// ── progresul unui element: câte etape sunt bifate din câte; o formă invalidă NU devine 0 (L18): valid = false ──
export function progres(el) {
  const etape = Array.isArray(el?.etape) ? el.etape : null
  const data = Array.isArray(el?.etape_data) ? el.etape_data : null
  const valid = !!etape && !!data && etape.length > 0 && data.length <= etape.length
  if (!valid) return { valid: false, total: etape?.length ?? null, facute: data?.length ?? null, pct: null, gata: false, urmatoare: null, ultima: null, ultimaData: null }
  const total = etape.length, facute = data.length
  return {
    valid: true, total, facute, pct: Math.round((facute * 100) / total), gata: facute === total,
    urmatoare: facute < total ? etape[facute] : null, ultima: facute > 0 ? etape[facute - 1] : null, ultimaData: facute > 0 ? data[facute - 1] : null,
  }
}

const statGol = () => ({ n: 0, gata: 0, inLucru: 0, neincepute: 0, facute: 0, total: 0, invalide: 0 })
function adauga(st, p) {
  st.n += 1
  if (!p.valid) { st.invalide += 1; return }
  st.facute += p.facute; st.total += p.total
  if (p.gata) st.gata += 1
  else if (p.facute > 0) st.inLucru += 1
  else st.neincepute += 1
}
const fin = st => ({ ...st, pct: st.total > 0 ? Math.round((st.facute * 100) / st.total) : null })

/**
 * Contorul de sus, doar pe elementele ACTIVE: n, gata, în lucru, neîncepute, pct = etape bifate / etape totale (rotunjit), azi = câte etape au
 * ziua execuției = azi. Elementele cu formă invalidă intră în n și în `invalide`, nu în pct (necunoscut ≠ 0). peTip / peGrup în ordinea de afișare.
 */
export function contorConstructii(elemente, azi) {
  const tot = statGol(), tip = new Map(), grup = new Map()
  let aziN = 0, anulate = 0
  for (const el of elemente || []) {
    if (el?.stare === 'anulat') { anulate += 1; continue }
    const p = progres(el)
    for (const [m, k] of [[tip, el?.tip], [grup, el?.grup]]) { if (!m.has(k)) m.set(k, statGol()); adauga(m.get(k), p) }
    adauga(tot, p)
    if (p.valid) aziN += el.etape_data.filter(d => d === azi).length
  }
  const ordonat = (m, ordine, et) => [...m.entries()]
    .sort(([a], [b]) => { const ia = ordine.indexOf(a), ib = ordine.indexOf(b); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || String(a).localeCompare(String(b)) })
    .map(([k, st]) => ({ cheie: k, eticheta: et(k), ...fin(st) }))
  return { ...fin(tot), azi: aziN, anulate, peTip: ordonat(tip, TIPURI, k => ETICHETE_TIP[k] || `tip necunoscut (${k})`), peGrup: ordonat(grup, ORDINE_GRUP, etichetaGrup) }
}

/** Filtrul: grupul ('' = toate), doar neterminate, anulatele ascunse implicit. */
export function filtreaza(elemente, { grup = '', doarNeterminate = false, cuAnulate = false } = {}) {
  return (elemente || []).filter(el => (cuAnulate || el.stare !== 'anulat') && (!grup || el.grup === grup) && (!doarNeterminate || !progres(el).gata))
}

/** Lista grupată pe tip (ordinea TIPURI, tipurile necunoscute la final), în fiecare grup după cod natural (F6-2 înainte de F6-10). */
export function grupeazaPeTip(elemente) {
  const m = new Map()
  for (const el of elemente || []) { if (!m.has(el.tip)) m.set(el.tip, []); m.get(el.tip).push(el) }
  return [...m.entries()]
    .sort(([a], [b]) => { const ia = TIPURI.indexOf(a), ib = TIPURI.indexOf(b); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) })
    .map(([tip, lista]) => {
      const st = statGol(); lista.forEach(el => { if (el.stare !== 'anulat') adauga(st, progres(el)) })
      return { tip, eticheta: ETICHETE_TIP[tip] || `tip necunoscut (${tip})`, elemente: [...lista].sort((a, b) => String(a.cod).localeCompare(String(b.cod), 'ro', { numeric: true })), ...fin(st) }
    })
}

// ── bifarea / retragerea: aceleași reguli ca RPC-ul (serverul le refă) ──
export const ACTIUNI = ['bifeaza', 'retrage']
const txt = v => (v == null ? '' : String(v).trim())

/** Validarea formularului din fișă, înainte de RPC. Întoarce lista de erori (gol = ok). */
export function valideazaEtapa({ actiune, element, data, azi, motiv }) {
  const e = []
  const p = progres(element)
  if (!element || element.stare !== 'activ') e.push('Elementul nu e activ')
  if (!p.valid) { e.push('Lista de etape a elementului e invalidă'); return e }
  if (actiune === 'bifeaza') {
    if (p.gata) e.push('Toate etapele sunt deja bifate')
    if (txt(motiv)) e.push('Motivul se dă doar la retragere')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) e.push('Data lipsește')
    else {
      if (data > azi) e.push('Data e în viitor')
      if (data < scadeZile(azi, ZILE_INAPOI)) e.push(`Data poate fi cel mult ${ZILE_INAPOI} zile în urmă`)
      if (p.ultimaData && data < p.ultimaData) e.push('Data e înaintea etapei anterioare')
    }
  } else if (actiune === 'retrage') {
    if (p.facute === 0) e.push('Nicio etapă bifată')
    if (!txt(motiv)) e.push('Scrie motivul retragerii')
    else if (txt(motiv).length > 500) e.push('Motivul are peste 500 de caractere')
  } else e.push('Acțiune necunoscută')
  return e
}

/** Payload-ul RPC-ului, înghețat (aceleași chei, în aceeași ordine — comparabil la reîncercare). p_id e primul (decideReincercare). */
export function payloadEtapa(el, { actiune, data, motiv }) {
  const p = progres(el)
  const t = v => (v == null || String(v).trim() === '' ? null : String(v).trim())
  return Object.freeze({
    p_id: el.id, p_versiune: el.versiune, p_actiune: actiune,
    p_etapa: actiune === 'retrage' ? p.ultima : p.urmatoare,
    p_data: actiune === 'retrage' ? null : data, p_motiv: actiune === 'retrage' ? t(motiv) : null,
  })
}

// ── CSV-ul de inventar (`;`) → rânduri pentru import (generatorul scripts/noduri_constructii_import_sql.mjs) ──
export const RE_COD_CONSTR = /^[A-Z][A-Z0-9]{0,11}-[0-9]{1,3}$/
export const RE_PLANSA = /^[0-9A-Za-z][0-9A-Za-z-]{0,39}$/
export const RE_GRUP = /^[a-z][a-z0-9_]{0,29}$/
const RE_CANTITATE = /^[0-9]{1,8}([.,][0-9]{1,2})?$/
const RE_STADIU = /^([a-z_]+)@(\d{4}-\d{2}-\d{2})$/
const LIMITE = { denumire: 200, echipament: 200, pozitie: 300, observatii: 1000 }

/** 'AAAA-LL-ZZ' calendaristic valid (fără reparsare în fus orar: comparăm componentele). */
export function dataValida(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '')
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

/** Lista etapelor din text („sapatura>egalizare>…”). Întoarce { etape } sau { eroare }. */
export function etapeDinText(v) {
  const s = txt(v)
  if (!s) return { eroare: 'fără etape' }
  const etape = s.split('>').map(x => x.trim())
  if (etape.length > 12) return { eroare: 'peste 12 etape' }
  const necunoscute = etape.filter(x => !ETAPE.includes(x))
  if (necunoscute.length) return { eroare: `etape necunoscute: ${necunoscute.map(x => `„${x}”`).join(', ')}` }
  if (new Set(etape).size !== etape.length) return { eroare: 'etapă repetată' }
  return { etape }
}

/**
 * Obiectele CSV (antet normalizat de obiecteCsv) → { elemente, erori, avertismente }. Câmp obligatoriu gol, peste limită, cod / tip / grup /
 * UM / etape invalide, cantitate cu peste 2 zecimale = EROARE (nimic nu se taie sau se rotunjește tacit); cod duplicat = eroare.
 * Certitudinea necunoscută → de_confirmat + avertisment. Coloana opțională „stadiu” = „etapa@AAAA-LL-ZZ”: etapele până la ea inclusiv sunt
 * considerate făcute la acea dată (stadiul inițial, scris de import doar pe elementele fără nicio bifare).
 */
export function mapeazaElemente(obiecte) {
  const elemente = [], erori = [], avertismente = [], coduri = new Set()
  for (const o of obiecte || []) {
    const r = o._rand
    const v = k => txt(o[k])
    const cod = v('cod').toUpperCase()
    const pb = []
    if (!RE_COD_CONSTR.test(cod)) pb.push(`cod invalid „${cod}”`)
    else if (coduri.has(cod)) pb.push(`cod duplicat ${cod}`)
    const el = {
      cod, cod_detaliu: v('cod_detaliu'), plansa_sursa: v('plansa_sursa'), denumire: v('denumire'), tip: v('tip'), grup: v('grup'),
      echipament: v('echipament') || null, um: v('um') || 'buc', pozitie: v('pozitie') || null, observatii: v('observatii') || null,
    }
    if (!RE_PLANSA.test(el.cod_detaliu)) pb.push(`cod_detaliu invalid „${el.cod_detaliu}”`)
    if (!RE_PLANSA.test(el.plansa_sursa)) pb.push(`plansa_sursa invalidă „${el.plansa_sursa}”`)
    if (!el.denumire) pb.push('denumire lipsă')
    if (!TIPURI.includes(el.tip)) pb.push(`tip necunoscut „${el.tip}”`)
    if (!RE_GRUP.test(el.grup)) pb.push(`grup invalid „${el.grup}”`)
    if (!UM.includes(el.um)) pb.push(`UM necunoscută „${el.um}”`)
    for (const [k, max] of Object.entries(LIMITE)) if ((el[k] || '').length > max) pb.push(`${k} peste ${max} de caractere`)
    const c = v('cantitate') || '1'
    if (!RE_CANTITATE.test(c)) pb.push(`cantitate invalidă „${c}” (număr pozitiv, cel mult 2 zecimale)`)
    else { el.cantitate = parseNumar(c); if (!(el.cantitate > 0)) pb.push('cantitatea trebuie să fie pozitivă') }
    const et = etapeDinText(o.etape)
    if (et.eroare) pb.push(et.eroare)
    else el.etape = et.etape
    const cert = norm(v('certitudine')).trim()
    el.certitudine = cert === 'sigur' ? 'sigur' : 'de_confirmat'
    const certNecunoscuta = cert !== 'sigur' && !/^de[ _]confirmat$/.test(cert)
    const st = v('stadiu')
    el.stadiu = null
    if (st) {
      const m = RE_STADIU.exec(st)
      if (!m) pb.push(`stadiu invalid „${st}” (formă: etapa@AAAA-LL-ZZ)`)
      else if (!dataValida(m[2])) pb.push(`stadiu: dată invalidă „${m[2]}”`)
      else if (!el.etape || !el.etape.includes(m[1])) pb.push(`stadiu: etapa „${m[1]}” nu e în lista elementului`)
      else el.stadiu = { etapa: m[1], k: el.etape.indexOf(m[1]) + 1, data: m[2] }
    }
    if (pb.length) { erori.push(`Rândul ${r}${cod ? ` (${cod})` : ''}: ${pb.join(', ')}`); continue }
    if (certNecunoscuta) avertismente.push(`Rândul ${r} (${cod}): certitudine nerecunoscută „${v('certitudine')}” → de_confirmat`)
    coduri.add(cod)
    elemente.push(el)
  }
  return { elemente, erori, avertismente }
}
