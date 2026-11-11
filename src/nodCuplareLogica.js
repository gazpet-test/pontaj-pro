// ═══════════════════════════════════════════════════════════════════════════
// nodCuplareLogica.js — logica pură pentru sudurile unui nod de cuplare (Execuție)
// Decizia lui Răzvan, 09.11.2026: nodul de cuplare Prunișor (Lot 1) se urmărește SEPARAT de fir, pe suduri,
// pe schema de montaj. Tabelul: executie_noduri_suduri (migrarea 20261201a). Fără React, fără Supabase:
// stări și culori, tranziții (aceeași listă ca în SQL, test de paritate), contorul azi / cumulat / rest pe DN,
// geometria zoom / pan, manifestul vederilor și parsarea CSV-urilor pentru generatorul de import.
// ═══════════════════════════════════════════════════════════════════════════

import { parseNumar } from './izoDocumenteLogica.js'
import { norm } from './lib/diacritice.js'

// ── stări (lista albă din CHECK-ul tabelului) ──
export const STARI = ['de_executat', 'insailat', 'sudat', 'ndt', 'acceptat', 'reparat', 'anulat']
export const ETICHETE = {
  de_executat: 'De executat', insailat: 'Însăilat', sudat: 'Sudat', ndt: 'NDT (fără rezultat)',
  acceptat: 'Acceptat', reparat: 'De reparat', anulat: 'Anulat',
}
// Culorile cerute de Răzvan: gri / galben / albastru / verde / roșu. „ndt” fără rezultat = violet (distinct de toate),
// „anulat” = gri închis. O stare necunoscută NU primește gri (s-ar confunda cu „de executat”): alb, marcată separat.
export const CULORI = {
  de_executat: '#8B949E', insailat: '#E3B341', sudat: '#58A6FF', ndt: '#BC8CFF',
  acceptat: '#3FB950', reparat: '#F85149', anulat: '#3D444D',
}
export const CULOARE_NECUNOSCUTA = '#FFFFFF'
export const esteStare = s => STARI.includes(s)
export const culoareStare = s => (esteStare(s) ? CULORI[s] : CULOARE_NECUNOSCUTA)

// Tranzițiile permise — ACEEAȘI listă ca fn_executie_nod_tranzitie din migrare (testul de paritate citește blocul
// TRANZITII-START / TRANZITII-END din fișierul SQL). „reparat” = NDT / vizual respins, de reparat; după reparație → sudat.
export const TRANZITII = [
  ['de_executat', 'insailat'], ['de_executat', 'sudat'], ['de_executat', 'anulat'],
  ['insailat', 'sudat'], ['insailat', 'anulat'],
  ['sudat', 'ndt'], ['sudat', 'reparat'],
  ['ndt', 'acceptat'], ['ndt', 'reparat'],
  ['reparat', 'sudat'],
]
export const tranzitiePermisa = (veche, noua) => TRANZITII.some(([v, n]) => v === veche && n === noua)
export const stariUrmatoare = veche => TRANZITII.filter(([v]) => v === veche).map(([, n]) => n)

// Ce cere fiecare stare nouă (aceleași reguli ca în RPC): sudor la sudat, buletin la NDT, motiv la reparat / anulat
export const cereSudor = s => s === 'sudat'
export const cereBuletin = s => s === 'ndt'
export const cereMotiv = s => s === 'reparat' || s === 'anulat'
export const ZILE_INAPOI = 7

/** Validarea formularului din fișă, înainte de RPC (serverul o refă). Întoarce lista de erori (gol = ok). */
export function valideazaMarcare({ stareVeche, stareNoua, data, azi, dataStare, sudor, buletin, motiv }) {
  const e = []
  if (!tranzitiePermisa(stareVeche, stareNoua)) e.push(`Tranziție nepermisă: ${stareVeche} → ${stareNoua}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) e.push('Data lipsește')
  else {
    if (data > azi) e.push('Data e în viitor')
    if (data < scadeZile(azi, ZILE_INAPOI)) e.push(`Data poate fi cel mult ${ZILE_INAPOI} zile în urmă`)
    if (dataStare && data < dataStare) e.push('Data e înaintea ultimei schimbări a sudurii')
  }
  if (cereSudor(stareNoua) && !txt(sudor)) e.push('Alege sudorul')
  if (cereBuletin(stareNoua) && !txt(buletin)) e.push('Scrie codul buletinului NDT')
  if (cereMotiv(stareNoua) && !txt(motiv)) e.push('Scrie motivul')
  return e
}

/** 'YYYY-MM-DD' − n zile, calculat pe date calendaristice (UTC la prânz, fără efect de oră de vară). */
export function scadeZile(zi, n) {
  const [a, l, z] = zi.split('-').map(Number)
  const d = new Date(Date.UTC(a, l - 1, z, 12))
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

const txt = v => (v == null ? '' : String(v).trim())

// ── contorul: azi / cumulat / rest, pe diametre ──
export const EXECUTATE = ['sudat', 'ndt', 'acceptat', 'reparat']
export const RAMASE = ['de_executat', 'insailat']

/**
 * Contorul de sus. total = fără anulate; cumulat = sudate cel puțin o dată (sudat / ndt / acceptat / de reparat);
 * rest = de executat + însăilate; azi = cu data_sudare = azi. O stare necunoscută intră în total, dar nici în cumulat,
 * nici în rest: e numărată în `necunoscute`, ca diferența să se vadă (necunoscut ≠ 0).
 * peDn: ordonat descrescător după DN; sudurile fără DN la final, ca „DN ?”.
 */
export function contor(suduri, azi) {
  const gol = () => ({ total: 0, cumulat: 0, rest: 0, azi: 0, insailate: 0, necunoscute: 0 })
  const tot = gol()
  const pe = new Map()
  for (const s of suduri || []) {
    if (s.stare === 'anulat') continue
    const k = Number.isInteger(s.dn) ? s.dn : null
    if (!pe.has(k)) pe.set(k, gol())
    for (const c of [tot, pe.get(k)]) {
      c.total += 1
      if (EXECUTATE.includes(s.stare)) c.cumulat += 1
      else if (RAMASE.includes(s.stare)) c.rest += 1
      else c.necunoscute += 1
      if (s.stare === 'insailat') c.insailate += 1
      if (s.data_sudare === azi && EXECUTATE.includes(s.stare)) c.azi += 1
    }
  }
  const peDn = [...pe.entries()]
    .sort(([a], [b]) => (a == null ? 1 : b == null ? -1 : b - a))
    .map(([dn, c]) => ({ dn, eticheta: dn == null ? 'DN ?' : `DN${dn}`, ...c }))
  return { ...tot, peDn }
}

/** Filtrul de pe vedere: stările bifate (gol = toate) și DN-ul ales ('' = toate). */
export function filtreaza(suduri, { stari = [], dn = '' } = {}) {
  return (suduri || []).filter(s => (!stari.length || stari.includes(s.stare)) && (dn === '' || String(s.dn) === String(dn)))
}

// ── geometria vederii: imaginea are mărimea naturală {w, h}; vederea = {scale, tx, ty} (ecran = imagine × scale + t) ──
export function incadreaza({ w, h }, { cw, ch }, margine = 0.96) {
  if (!(w > 0 && h > 0 && cw > 0 && ch > 0)) return { scale: 1, tx: 0, ty: 0 }
  const scale = Math.min(cw / w, ch / h) * margine
  return { scale, tx: (cw - w * scale) / 2, ty: (ch - h * scale) / 2 }
}
/** Limitele de zoom față de încadrare: de la jumătate din încadrare la 16× (dar cel puțin pixel 1:1 × 3). */
export const limiteScala = fit => ({ min: fit.scale * 0.5, max: Math.max(fit.scale * 16, 3) })
/** Zoom cu factorul dat, păstrând nemișcat punctul de ecran (px, py) — degetele / cursorul. */
export function zoomLa(v, factor, px, py, lim) {
  const s = Math.min(lim.max, Math.max(lim.min, v.scale * factor))
  const k = s / v.scale
  return { scale: s, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k }
}
export const ecranDinPct = (xPct, yPct, { w, h }, v) => ({ x: (xPct / 100) * w * v.scale + v.tx, y: (yPct / 100) * h * v.scale + v.ty })
export const pctDinEcran = (x, y, { w, h }, v) => ({ xPct: ((x - v.tx) / (v.scale * w)) * 100, yPct: ((y - v.ty) / (v.scale * h)) * 100 })
export const distanta = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
export const mijloc = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

// ── manifestul vederilor (vederi.json din bucket-ul noduri-scheme, urcat de chat) ──
export const RE_VEDERE = /^[A-Z0-9][A-Z0-9_-]{0,19}$/
export const RE_FISIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/
/**
 * Manifestul: listă [{vedere, fisier, latime_px, inaltime_px, titlu}] (sau {vederi: [...]}).
 * Intrările invalide nu dispar: apar în `erori` (și nu se afișează). Vederile duplicate = eroare pe a doua.
 */
export function parseManifest(json) {
  const lista = Array.isArray(json) ? json : Array.isArray(json?.vederi) ? json.vederi : null
  if (!lista) return { vederi: [], erori: ['Manifestul nu e o listă de vederi'] }
  const vederi = [], erori = [], vazute = new Set()
  lista.forEach((r, i) => {
    const vedere = txt(r?.vedere), fisier = txt(r?.fisier)
    const w = Number(r?.latime_px), h = Number(r?.inaltime_px)
    const pb = []
    if (!RE_VEDERE.test(vedere)) pb.push('cod de vedere invalid')
    if (!RE_FISIER.test(fisier) || fisier.includes('..')) pb.push('nume de fișier invalid')
    if (!(Number.isInteger(w) && w > 0 && w <= 20000 && Number.isInteger(h) && h > 0 && h <= 20000)) pb.push('dimensiuni invalide')
    if (vazute.has(vedere)) pb.push('vedere duplicată')
    if (pb.length) { erori.push(`Vederea ${i + 1} (${vedere || '?'}): ${pb.join(', ')}`); return }
    vazute.add(vedere)
    vederi.push({ vedere, fisier, w, h, titlu: txt(r?.titlu) || vedere })
  })
  return { vederi, erori }
}

// ── CSV (`;`, UTF-8 cu BOM, ghilimele) — pentru generatorul de import ──
export function parseCsv(text, sep = ';') {
  const s = String(text || '').replace(new RegExp('^' + String.fromCharCode(0xFEFF)), '')
  const randuri = []
  let rand = [], camp = '', ghil = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (ghil) {
      if (c === '"') { if (s[i + 1] === '"') { camp += '"'; i++ } else ghil = false }
      else camp += c
    } else if (c === '"' && camp === '') ghil = true
    else if (c === sep) { rand.push(camp); camp = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      rand.push(camp); camp = ''
      if (rand.some(x => x !== '')) randuri.push(rand)
      rand = []
    } else camp += c
  }
  if (ghil) throw new Error('CSV: ghilimele neînchise')
  rand.push(camp)
  if (rand.some(x => x !== '')) randuri.push(rand)
  return randuri
}
/** Rânduri → obiecte după antet (antetul normalizat: fără diacritice, litere mici). Rândurile cu alt număr de câmpuri = eroare. */
export function obiecteCsv(text, sep = ';') {
  const [antet, ...rest] = parseCsv(text, sep)
  if (!antet) return { antet: [], obiecte: [], erori: ['CSV gol'] }
  const chei = antet.map(a => norm(a).trim())
  const obiecte = [], erori = []
  rest.forEach((r, i) => {
    if (r.length !== chei.length) { erori.push(`Rândul ${i + 2}: ${r.length} câmpuri, antetul are ${chei.length}`); return }
    obiecte.push({ _rand: i + 2, ...Object.fromEntries(chei.map((k, j) => [k, r[j]])) })
  })
  return { antet: chei, obiecte, erori }
}

export const RE_COD = /^[A-Z]{1,6}-[0-9]{1,5}$/
/** „DN600” / „600” → 600; gol → null; altceva → NaN (eroare vizibilă). */
export function dnDinText(v) {
  const s = txt(v).toUpperCase().replace(/\s+/g, '')
  if (!s) return null
  const m = s.match(/^(?:DN)?(\d{2,4})$/)
  return m ? Number(m[1]) : NaN
}
/** Certitudinea din textul listei → sigur / posibil / de_confirmat. Necunoscut → de_confirmat + avertisment (incert, nu „sigur”). */
export function certitudineDinText(v) {
  const n = norm(v).trim()
  if (/^sigur/.test(n)) return { valoare: 'sigur', recunoscut: true }
  if (/^(posibil|probabil)/.test(n)) return { valoare: 'posibil', recunoscut: true }
  if (/^(estimare|de confirmat)/.test(n)) return { valoare: 'de_confirmat', recunoscut: true }
  return { valoare: 'de_confirmat', recunoscut: false }
}

const LIMITE = { subansamblu: 300, diametru: 120, poz1: 200, poz2: 200 }
/**
 * Lista sudurilor (CSV-ul listei rev 2: ID;…;Subansamblu;…;DN;Diametru×grosime capăt 1;… capăt 2;Poziția 1;Poziția 2;…;Certitudine;…)
 * → rânduri pentru tabel. Peste limită = eroare (nu se taie); cod duplicat = eroare; nimic nu dispare tacit.
 */
export function mapeazaLista(obiecte) {
  const suduri = [], erori = [], avertismente = [], coduri = new Set(), furnizor = []
  const col = (o, ...chei) => { for (const k of chei) { const g = Object.keys(o).find(x => x === k || x.startsWith(k)); if (g != null) return txt(o[g]) } return '' }
  for (const o of obiecte || []) {
    const r = o._rand
    const cod = col(o, 'id').toUpperCase()
    // sudurile făcute de furnizorul rezervorului, la atelier: informative, NU intră în „rest de executat” (se sar, raportate)
    const f = esteFurnizor({ bloc: col(o, 'bloc'), certitudine: col(o, 'certitudine') })
    if (f === null) { erori.push(`Rândul ${r} (${cod}): „furnizor” doar într-una din coloanele Bloc / Certitudine — de lămurit`); continue }
    if (f) { if (coduri.has(cod) || furnizor.includes(cod)) erori.push(`Rândul ${r}: cod duplicat ${cod}`); else furnizor.push(cod); continue }
    const dn = dnDinText(col(o, 'dn'))
    const c1 = col(o, 'diametru×grosime capat 1', 'diametru x grosime capat 1'), c2 = col(o, 'diametru×grosime capat 2', 'diametru x grosime capat 2')
    const rand = {
      cod, subansamblu: col(o, 'subansamblu'), dn,
      diametru: [c1, c2].filter(Boolean).join(' / ') || null,
      poz1: col(o, 'pozitia 1') || null, poz2: col(o, 'pozitia 2') || null,
    }
    const cert = certitudineDinText(col(o, 'certitudine'))
    rand.certitudine = cert.valoare
    const pb = []
    if (!RE_COD.test(cod)) pb.push(`cod invalid „${cod}”`)
    else if (coduri.has(cod) || furnizor.includes(cod)) pb.push(`cod duplicat ${cod}`)
    if (Number.isNaN(dn) || (dn != null && (dn < 10 || dn > 2000))) pb.push('DN invalid')
    for (const [k, max] of Object.entries(LIMITE)) if ((rand[k] || '').length > max) pb.push(`${k} peste ${max} caractere`)
    if (pb.length) { erori.push(`Rândul ${r}: ${pb.join(', ')}`); continue }
    if (dn == null) avertismente.push(`Rândul ${r} (${cod}): fără DN`)
    if (!cert.recunoscut) avertismente.push(`Rândul ${r} (${cod}): certitudine nerecunoscută → de_confirmat`)
    coduri.add(cod)
    suduri.push(rand)
  }
  return { suduri, erori, avertismente, furnizor }
}

// Regula „făcută de furnizor” (ancorată, pe textul fără diacritice): Certitudinea ÎNCEPE cu „făcută de furnizor” și Bloc ÎNCEPE cu
// „Rezervoare – furnizorul rezervorului”. Ambele = sudură a furnizorului (true); niciuna = a noastră (false); doar una = null (de lămurit).
const RE_CERT_FURNIZOR = /^facuta de furnizor(?![a-z0-9])/
const RE_BLOC_FURNIZOR = /^rezervoare[ \t]*[-–][ \t]*furnizorul rezervorului(?![a-z0-9])/
export function esteFurnizor({ bloc, certitudine }) {
  const c = RE_CERT_FURNIZOR.test(norm(certitudine).trim()), b = RE_BLOC_FURNIZOR.test(norm(bloc).trim())
  return c === b ? c : null
}

/**
 * Punctele propuse (cod_sudura;vedere;x_pct;y_pct;certitudine_pozitie;observatii). Primul rând al unei suduri = vederea PRINCIPALĂ
 * (coloanele vedere / x_pct / y_pct), următoarele = punctele de pe alte vederi (pozitii_secundare, cel mult 20). Aceeași vedere de
 * două ori pe o sudură: a doua apare în `ignorate` (raportată, nu pierdută tacit). Cod necunoscut / vedere necunoscută / coordonată
 * în afara 0–100 = eroare. Observațiile nu se importă.
 */
export function mapeazaPuncte(obiecte, { coduri, vederi, coduriFurnizor = new Set() }) {
  const erori = [], ignorate = [], pe = new Map()
  for (const o of obiecte || []) {
    const r = o._rand
    const cod = txt(o.cod_sudura).toUpperCase(), vedere = txt(o.vedere).toUpperCase()
    // punctul unei suduri a furnizorului (sărită din listă): raportat ca ignorat, nu eroare și nu pierdut tacit
    if (coduriFurnizor.has(cod)) { ignorate.push(`Rândul ${r}: ${cod} e a furnizorului (sărită din listă), punct ignorat`); continue }
    const x = parseNumar(o.x_pct), y = parseNumar(o.y_pct)
    const cert = txt(o.certitudine_pozitie)
    const pb = []
    if (!RE_COD.test(cod) || (coduri && !coduri.has(cod))) pb.push(`sudură necunoscută „${cod}”`)
    if (!RE_VEDERE.test(vedere) || (vederi && !vederi.has(vedere))) pb.push(`vedere necunoscută „${vedere}”`)
    for (const [n, val] of [['x', x], ['y', y]]) if (!(typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 100)) pb.push(`${n}_pct invalid`)
    if (cert.length > 60) pb.push('certitudine_pozitie peste 60 de caractere')
    if (pb.length) { erori.push(`Rândul ${r}: ${pb.join(', ')}`); continue }
    const rx = Math.round(x * 1000) / 1000, ry = Math.round(y * 1000) / 1000
    const p = pe.get(cod)
    if (!p) { pe.set(cod, { cod, vedere, x: rx, y: ry, certitudine: cert || null, secundare: [] }); continue }
    if (p.vedere === vedere || p.secundare.some(s => s.vedere === vedere)) { ignorate.push(`Rândul ${r}: ${cod} are deja un punct pe vederea ${vedere} (păstrat primul)`); continue }
    if (p.secundare.length >= 20) { erori.push(`Rândul ${r}: ${cod} are peste 20 de vederi secundare`); continue }
    p.secundare.push({ vedere, x_pct: rx, y_pct: ry, ...(cert ? { certitudine: cert } : {}) })
  }
  return { puncte: [...pe.values()], erori, ignorate }
}

// ── punctele unei vederi: principala sau o poziție secundară; grupate pe coordonate identice (ex. „fără poziție pe planșă”) ──
/** Pentru vederea dată: [{ sudura, x_pct, y_pct, principal, certitudine }]. Coordonatele invalide se sar (CHECK-ul din BD le refuză oricum). */
export function puncteVedere(suduri, vedere) {
  const out = []
  for (const s of suduri || []) {
    if (s.vedere === vedere && s.x_pct != null && s.y_pct != null) out.push({ sudura: s, x_pct: Number(s.x_pct), y_pct: Number(s.y_pct), principal: true, certitudine: s.pozitie_certitudine || null })
    else for (const p of Array.isArray(s.pozitii_secundare) ? s.pozitii_secundare : []) {
      if (p?.vedere === vedere) out.push({ sudura: s, x_pct: Number(p.x_pct), y_pct: Number(p.y_pct), principal: false, certitudine: p.certitudine || null })
    }
  }
  return out.filter(p => Number.isFinite(p.x_pct) && Number.isFinite(p.y_pct))
}
/** Grupuri pe coordonate identice (la 0,001%): un singur punct pe schemă, cu numărul sudurilor; ordinea: prima apariție. */
export function grupeazaPuncte(puncte) {
  const m = new Map()
  for (const p of puncte || []) {
    const k = `${Math.round(p.x_pct * 1000)}|${Math.round(p.y_pct * 1000)}`
    if (!m.has(k)) m.set(k, { cheie: k, x_pct: p.x_pct, y_pct: p.y_pct, puncte: [] })
    m.get(k).puncte.push(p)
  }
  return [...m.values()]
}
/** Câte suduri din grup sunt în fiecare stare, în ordinea STARI (pentru cercul împărțit pe culori). */
export function stariGrup(grup) {
  const n = {}
  for (const p of grup.puncte) n[p.sudura.stare] = (n[p.sudura.stare] || 0) + 1
  return [...STARI, ...Object.keys(n).filter(s => !esteStare(s))].filter(s => n[s]).map(s => ({ stare: s, n: n[s] }))
}
/** Fundalul unui grup: o singură stare = culoarea ei; mai multe = cerc împărțit proporțional (conic-gradient). */
export function fundalGrup(grup) {
  const st = stariGrup(grup), tot = grup.puncte.length
  if (st.length === 1) return culoareStare(st[0].stare)
  let a = 0
  return `conic-gradient(${st.map(({ stare, n }) => { const b = a + (n / tot) * 360, seg = `${culoareStare(stare)} ${a}deg ${b}deg`; a = b; return seg }).join(', ')})`
}

/** Sudurile care NU au punct pe vederea dată (inclusiv cele fără niciun punct), ca să poată fi deschise dintr-o listă. */
export function faraPunctPeVedere(suduri, vedere) {
  const pe = new Set(puncteVedere(suduri, vedere).map(p => p.sudura.id))
  return (suduri || []).filter(s => !pe.has(s.id))
}

// ── atingerea: ținta e mai mare decât cercul (~46 px) și, la suprapunere, câștigă punctul cel mai apropiat de deget ──
export const RAZA_ATINGERE = 23
/** Grupul cel mai apropiat de (x, y) pe ecran, în raza dată; egalitate = primul din listă. puncteEcran: [{ cheie, x, y }]. */
export function celMaiAproape(puncteEcran, x, y, raza = RAZA_ATINGERE) {
  let best = null, dBest = Infinity
  for (const p of puncteEcran || []) {
    const d = Math.hypot(p.x - x, p.y - y)
    if (d <= raza && d < dBest) { best = p; dBest = d }
  }
  return best
}

/** Identitatea completă a imaginii unei vederi: un rezultat (signed URL) se aplică doar pentru exact aceeași identitate. */
export const cheieImagine = ({ proiectId, nod, vedere, fisier }) => (proiectId != null && nod && vedere && fisier ? `${proiectId}/${nod}/${vedere}/${fisier}` : null)

/**
 * O SINGURĂ regulă pentru două copii ale aceleiași suduri (L19): rămâne cea cu versiunea mai mare; la egalitate, cea venită acum.
 * Folosită și la răspunsul unei salvări (aplicaRand), și la rezultatul unei reîncărcări (imbinaLista).
 */
export const esteMaiVeche = (venit, local) => !!local && Number(venit.versiune) < Number(local.versiune)

/** Rândul întors de server peste lista locală: doar pe aceeași sudură și doar dacă NU e mai vechi decât ce avem. */
export function aplicaRand(lista, rand) {
  if (!rand || rand.id == null) return lista
  return (lista || []).map(x => (x.id === rand.id && !esteMaiVeche(rand, x) ? { ...x, ...rand } : x))
}

/**
 * Rezultatul unei reîncărcări peste lista curentă: setul de suduri vine din citire, dar pe fiecare id rămâne versiunea maximă
 * (o citire începută înainte de o salvare și terminată după ea nu readuce starea veche). Contorul derivă din listă.
 */
export function imbinaLista(citite, curente) {
  const local = new Map((curente || []).map(x => [x.id, x]))
  return (citite || []).map(r => { const l = local.get(r.id); return esteMaiVeche(r, l) ? l : r })
}

// ── cererile cu rezultat NECUNOSCUT, separat pe sudură: Map id -> { cheie, payload, seq } (seq = ordinea intențiilor) ──
/** Pune intrarea, dar nu peste o intenție ulterioară (seq mai mare) a aceleiași suduri. Întoarce o hartă nouă (sau aceeași). */
export function incertPune(harta, id, intrare) {
  const v = harta.get(id)
  if (v && v.seq > intrare.seq) return harta
  const n = new Map(harta); n.set(id, intrare); return n
}
/** Șterge intrarea sudurii DOAR dacă e a aceleiași cereri (aceeași cheie) — o confirmare / reconciliere întârziată nu șterge alta. */
export function incertSterge(harta, id, cheie) {
  if (harta.get(id)?.cheie !== cheie) return harta
  const n = new Map(harta); n.delete(id); return n
}

/**
 * Reîncercarea după un rezultat NECUNOSCUT (eroare de rețea / server): aceeași cerere (payload identic) = aceeași cheie;
 * altă cerere pe aceeași sudură = întâi reconciliere cu serverul (reîncarcă sudura), abia apoi o intenție nouă, cu cheie nouă.
 * incert: { payload, cheie } | null. Întoarce 'noua' | 'aceeasi' | 'reconciliere'.
 */
export function decideReincercare(incert, payload) {
  if (!incert || incert.payload?.p_id !== payload?.p_id) return 'noua'   // altă sudură: CAS-ul pe versiune o apără oricum
  return JSON.stringify(incert.payload) === JSON.stringify(payload) ? 'aceeasi' : 'reconciliere'
}

/** Payload-ul RPC-ului de stare, înghețat (aceleași chei, în aceeași ordine — comparabil la reîncercare). */
export function payloadStare(s, { stareNoua, data, sudor, buletin, motiv }) {
  const t = v => (v == null || String(v).trim() === '' ? null : String(v).trim())
  return Object.freeze({
    p_id: s.id, p_stare_veche: s.stare, p_versiune: s.versiune, p_stare_noua: stareNoua, p_data: data,
    p_sudor: t(sudor), p_buletin_ndt: t(buletin), p_motiv: t(motiv),
  })
}
