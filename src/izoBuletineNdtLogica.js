// ════════════════════════════════════════════════════════════════════════
// IZOMETRIE — ecranul „Buletine NDT”: logica de ecran (fără React, fără Supabase)
// ════════════════════════════════════════════════════════════════════════
// Contract: docs/izometrie/BULETINE_NDT_SPEC.md §6, §21–§24 și migrarea 20270114a (fn_sud_*).
// Logica de business (normalizarea codului, comparația a două citiri, starea pe sudură, comparația
// între metode) e în src/lib/izoNdt.js și se FOLOSEȘTE de aici, nu se copiază (L19).
// Aici: validările formularului, maparea erorilor RPC / edge → mesaje, pregătirea rândurilor pentru
// fn_sud_buletin_confirma și verificările automate de pe ecranul de confirmare (§23).
// Conținutul buletinului (citit cu AI sau lipit din Excel) e DATE: nimic de aici nu declanșează altă acțiune.

import { normalizeazaRandBuletin, normalizeazaRezultat, normalizeazaMetoda, dataIso, dataRo, starePeSudura, stareMetoda, comparaMetode } from './lib/izoNdt.js'
import { cheieSudura } from './lib/izoSudura.js'
import { parseNumar } from './izoDocumenteLogica.js'

export const BUCKET_NDT = 'izo-ndt'
export const MAX_PDF_OCTETI = 52428800            // = file_size_limit al bucket-ului izo-ndt (50 MB)
export const MAX_RANDURI = 2000                    // plafonul din fn_sud_buletin_confirma
export const METODE = ['PM', 'PA-UT', 'UT', 'PT', 'RT', 'VT', 'ALTA']   // CHECK-ul din sud_buletine
export const METODE_OBLIGABILE = ['PM', 'PA-UT', 'UT']                   // CHECK-ul din sud_metode_proiect
export const STARI_BULETIN = ['ciorna', 'confirmat', 'anulat']
export const ETICHETA_STARE = { ciorna: 'ciornă', confirmat: 'confirmat', anulat: 'anulat' }
export const CAMPURI_INDICATII = ['start_mm', 'end_mm', 'lungime_mm', 'inaltime_mm', 'adancime_mm']
// ordinea coloanelor la lipirea din Excel (aceeași ca tabelul editabil)
export const COLOANE_LIPIRE = ['cod_raw', 'rezultat', 'data_inspectie', ...CAMPURI_INDICATII, 'observatii']
// comparația între metode de pe ecranul de confirmare (§23 pct. 3: PA-UT ↔ PM)
const METODA_PERECHE = { PM: 'PA-UT', 'PA-UT': 'PM' }

const txt = v => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim()
const areText = v => /\S/.test(txt(v))
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// ── tronsonul ────────────────────────────────────────────────────────────
/**
 * Numărul tronsonului din codul lui: „T12”, „TR12”, „tr1 FOD”, „TR 1 FOD” → 12 / 1; altfel null.
 * Aceeași regulă ca fn_sud_tronson_nr din 20270114a (paritate în teste, pe cazurile din postcondițiile migrării):
 * serverul calculează cu ea cheia rândurilor la confirmare, deci ecranul verifică cu același tronson.
 */
export function tronsonNrDinCod(cod) {
  const m = (cod === null || cod === undefined ? '' : String(cod)).toUpperCase().match(/^\s*T(?:R)?\s*([0-9]{1,3})(?:\s|$)/)
  return m ? Number(m[1]) : null
}

/** Cheia ERP a serverului („T12S126”, coloana `cheie` din sud_*) → cheia din izoNdt („12|126|”); altceva → null. */
export function cheieDinServer(c) {
  const m = typeof c === 'string' ? c.match(/^T([1-9][0-9]{0,2})S([1-9][0-9]{0,4})([A-Z0-9/]*)$/) : null
  return m ? cheieSudura({ tronson: Number(m[1]), nr: Number(m[2]), sufix: m[3] }) : null
}
/** „12|126|A” → „T12S126A” (forma afișată pe LOT 1 și cheia serverului). */
export function codDinCheie(k) {
  const m = typeof k === 'string' ? k.match(/^(\d{1,3})\|(\d{1,5})\|([A-Z0-9/]*)$/) : null
  return m ? `T${m[1]}S${m[2]}${m[3]}` : String(k ?? '')
}

// ── timp (L17: Europe/Bucharest, fără offset fix) ───────────────────────
export function aziBucuresti(acum = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(acum)
}
export function fmtMoment(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', dateStyle: 'short', timeStyle: 'short' })
}
export const fmtData = iso => dataRo(iso) || '—'
const plusZile = (iso, z) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + z); return d.toISOString().slice(0, 10) }

// ── fișierul ─────────────────────────────────────────────────────────────
/**
 * PDF-ul ales: tip / extensie PDF, nevid, ≤ 50 MB, iar primii octeți „%PDF-” (antetul, dacă e dat).
 * @returns {string|null} mesajul de eroare sau null
 */
export function valideazaFisier(f, primiiOcteti = null) {
  if (!f) return 'Alege fișierul PDF al buletinului.'
  const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '')
  if (!pdf) return 'Fișierul trebuie să fie PDF.'
  if (!Number.isFinite(f.size) || f.size <= 0) return 'Fișierul e gol.'
  if (f.size > MAX_PDF_OCTETI) return `Fișierul are ${(f.size / 1048576).toFixed(1)} MB; limita e 50 MB.`
  if (primiiOcteti) {
    const b = primiiOcteti instanceof Uint8Array ? primiiOcteti : new Uint8Array(primiiOcteti)
    if (String.fromCharCode(...b.slice(0, 5)) !== '%PDF-') return 'Fișierul nu e un PDF valid (antetul lipsește).'
  }
  return null
}

/** SHA-256 hex (minuscule, ca CHECK-ul ^[0-9a-f]{64}$) pe conținutul fișierului; `subtle` injectabil în teste. */
export async function sha256Hex(octeti, subtle = globalThis.crypto?.subtle) {
  if (!subtle?.digest) throw new Error('Browserul nu poate calcula amprenta fișierului (crypto.subtle lipsește).')
  const h = new Uint8Array(await subtle.digest('SHA-256', octeti))
  return Array.from(h, x => x.toString(16).padStart(2, '0')).join('')
}

/** Calea din bucket: <proiect>/<tronson>/<uuid>.pdf (forma cerută de politicile sud_ndt_* și de fn_sud_buletin_incarca). */
export function caleFisier(proiectId, tronsonId, uuid) {
  const ok = v => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) || (typeof v === 'string' && /^[1-9][0-9]{0,17}$/.test(v))
  if (!ok(proiectId) || !ok(tronsonId)) throw new Error('Proiectul sau tronsonul nu e cunoscut.')
  if (typeof uuid !== 'string' || !RE_UUID.test(uuid)) throw new Error('Identificatorul fișierului e invalid.')
  return `${proiectId}/${tronsonId}/${uuid}.pdf`
}

// ── formularul de încărcare ──────────────────────────────────────────────
/**
 * Câmpurile completate de om (număr, dată, metodă; motivul doar la forțare). Aceleași limite ca fn_sud_buletin_incarca.
 * @returns {{ok:boolean, erori:Object<string,string>, valori:{metoda, numar, data, firma, forteazaMotiv}}}
 */
export function valideazaIncarcare({ metoda, numar, data, firma, forteazaMotiv, cuForteaza = false } = {}, azi = aziBucuresti()) {
  const erori = {}
  const m = normalizeazaMetoda(metoda)
  const met = METODE.includes(m) ? m : null
  if (!met) erori.metoda = 'Alege metoda.'
  const nr = txt(numar)
  if (!nr) erori.numar = 'Numărul buletinului e obligatoriu.'
  else if (nr.length > 60) erori.numar = 'Numărul are peste 60 de caractere.'
  const d = dataIso(typeof data === 'string' ? data : data ?? null)
  if (d === null) erori.data = 'Data buletinului e obligatorie.'
  else if (typeof d !== 'string') erori.data = `Data „${d.invalid}” nu e validă (ZZ.LL.AAAA).`
  else if (d < '2000-01-01' || d > plusZile(azi, 1)) erori.data = 'Data buletinului e în afara intervalului permis.'
  const fi = txt(firma)
  if (fi.length > 200) erori.firma = 'Firma are peste 200 de caractere.'
  const mot = txt(forteazaMotiv)
  if (cuForteaza) {
    if (mot.length < 3) erori.forteazaMotiv = 'Motivul e obligatoriu (cel puțin 3 caractere).'
    else if (mot.length > 500) erori.forteazaMotiv = 'Motivul are peste 500 de caractere.'
  }
  return {
    ok: Object.keys(erori).length === 0, erori,
    valori: { metoda: met, numar: nr, data: typeof d === 'string' ? d : null, firma: fi || null, forteazaMotiv: cuForteaza ? mot : null },
  }
}

// ── erorile RPC → mesaje ─────────────────────────────────────────────────
const curat = m => txt(m).replace(/^sud:\s*/i, '')
/**
 * Eroarea unui apel `supabase.rpc('fn_sud_*')` → { tip, mesaj, id? }; fără eroare → null.
 * tip ∈ fisier_dublura | buletin_dublura | dublura | versiune | drept | stare | fisier_expirat | validare | lipsa_rpc | necunoscut | eroare
 * L05: rețea / timeout / 5xx / status 0 = „necunoscut” (scrierea poate să fi trecut): ecranul recitește din BD, nu repetă orbește.
 */
export function mapeazaEroareRpc(error, status = null) {
  if (!error) return null
  const cod = error.code ?? ''
  const msg = String(error.message ?? '')
  let m
  if (cod === '23505' && (m = msg.match(/fisier_deja_incarcat:(\d+)/))) {
    return { tip: 'fisier_dublura', id: Number(m[1]), mesaj: `Fișierul e deja încărcat (buletinul #${m[1]}).` }
  }
  if (cod === '23505' && (m = msg.match(/buletin_deja_incarcat:(\d+)/))) {
    return { tip: 'buletin_dublura', id: Number(m[1]), mesaj: `Un buletin cu aceeași metodă, același număr și aceeași dată e deja încărcat pe tronson (#${m[1]}).` }
  }
  if (cod === '23505') return { tip: 'dublura', mesaj: curat(msg) || 'Înregistrarea există deja.' }
  if (cod === '40001') return { tip: 'versiune', mesaj: 'Buletinul s-a schimbat între timp. Se reîncarcă; verifică din nou și confirmă.' }
  if (cod === '42501') return { tip: 'drept', mesaj: `Nu ai drept pentru această acțiune (doar managerul de proiect sau owner-ul). ${curat(msg)}`.trim() }
  if (cod === '55000') return { tip: 'stare', mesaj: `Buletinul nu mai e în starea așteptată: ${curat(msg)}. Se reîncarcă.` }
  if (cod === '22023' && /mai vechi de o ora/.test(msg)) {
    return { tip: 'fisier_expirat', mesaj: 'Fișierul încărcat a depășit ora în care se poate înregistra. Alege din nou fișierul (se încarcă o copie nouă).' }
  }
  if (cod === '22023') return { tip: 'validare', mesaj: curat(msg) || 'Date invalide.' }
  if (cod === 'PGRST202' || cod === '42883') return { tip: 'lipsa_rpc', mesaj: 'Funcția nu există încă pe server (migrarea buletinelor NDT nu e aplicată).' }
  const st = Number(status ?? error.status ?? 0)
  if (!cod || st === 0 || st >= 500 || /failed to fetch|network|timeout|aborted/i.test(msg)) {
    return { tip: 'necunoscut', mesaj: 'Răspunsul serverului nu a ajuns (rețea / timeout). Nu se știe dacă operația a trecut: lista se recitește din bază.' }
  }
  return { tip: 'eroare', mesaj: curat(msg) || `Eroare ${cod}` }
}

// ── citirea cu AI (funcția edge izo-ndt-citeste) ─────────────────────────
/**
 * Citirea întoarsă de edge → forma de lucru a ecranului. Semnalele de completitudine pot veni în antet
 * (contractul edge: antet.partial / antet.pagini_necitite / antet.nr_randuri_tiparit) sau la rădăcină
 * (contractul comparaCitiri): se ridică la rădăcină, fără să se piardă (L12). Formă greșită = eroare, nu „gol” (L18).
 * @returns {{ok:true, citire:object} | {ok:false, mesaj:string}}
 */
export function normalizeazaCitire(raw) {
  const c = raw && typeof raw === 'object' && raw.citire && typeof raw.citire === 'object' ? raw.citire : raw
  if (!c || typeof c !== 'object' || !Array.isArray(c.randuri)) return { ok: false, mesaj: 'Citirea nu are lista de rânduri.' }
  if (c.randuri.some(r => !r || typeof r !== 'object' || Array.isArray(r))) return { ok: false, mesaj: 'Citirea are rânduri de alt format.' }
  const antet = c.antet && typeof c.antet === 'object' ? c.antet : {}
  const partial = c.partial ?? antet.partial ?? null
  const pagini = c.pagini_necitite ?? antet.pagini_necitite ?? null
  const incerte = c.incerte ?? null
  if (partial !== null && typeof partial !== 'boolean') return { ok: false, mesaj: 'Citirea are semnalul „parțial” de alt tip.' }
  if (pagini !== null && (!Array.isArray(pagini) || !pagini.every(p => Number.isInteger(p) && p > 0))) return { ok: false, mesaj: 'Citirea are lista paginilor necitite de alt format.' }
  if (incerte !== null && !Array.isArray(incerte)) return { ok: false, mesaj: 'Citirea are lista valorilor incerte de alt format.' }
  const tip = antet.nr_randuri_tiparit ?? c.nr_randuri_tiparit ?? null
  return {
    ok: true,
    citire: {
      antet: { ...antet, nr_randuri_tiparit: Number.isInteger(tip) && tip > 0 ? tip : null },
      randuri: c.randuri, incerte: incerte || [], partial: partial === true, pagini_necitite: pagini || [],
      model: typeof raw?.model === 'string' ? raw.model : typeof c.model === 'string' ? c.model : null,
    },
  }
}

/**
 * Răspunsul `supabase.functions.invoke('izo-ndt-citeste')` → { tip:'ok', citire } sau { tip, mesaj }.
 * `corp` = corpul JSON citit din error.context la un răspuns non-2xx (dacă s-a putut citi).
 * tip ∈ ok | nepublicat | plafon | drept | stare | invalid | necunoscut | eroare. Introducerea manuală rămâne posibilă în toate.
 * L05/L22: rețea / 5xx = cost necunoscut → nu se reîncearcă automat.
 */
export function mapeazaRaspunsEdge({ data = null, error = null, status = null, corp = null } = {}) {
  const b = corp && typeof corp === 'object' ? corp : data && typeof data === 'object' && data.ok === false ? data : null
  const st = Number(status ?? error?.context?.status ?? 0)
  const codB = String(b?.cod ?? b?.code ?? b?.eroare ?? '')
  const msgB = txt(b?.mesaj ?? b?.message ?? b?.error ?? '')
  if (/plafon/i.test(codB) || /plafon/i.test(msgB)) {
    return { tip: 'plafon', mesaj: `Citirea cu AI nu e disponibilă acum (plafon AI atins sau neconfigurat). ${msgB}`.trim() + ' Introdu rândurile manual.' }
  }
  if (error || b) {
    const numeErr = String(error?.name ?? '')
    if (st === 404 || /not.?found/i.test(codB)) return { tip: 'nepublicat', mesaj: 'Funcția de citire cu AI nu e publicată încă. Introdu rândurile manual (sau lipește-le din Excel).' }
    if (st === 401 || st === 403 || /drept|forbidden|neautoriz/i.test(codB)) return { tip: 'drept', mesaj: 'Citirea cu AI o pornesc doar managerul de proiect sau owner-ul.' }
    if (/ciorna|stare/i.test(codB)) return { tip: 'stare', mesaj: msgB || 'Buletinul nu mai e ciornă.' }
    if (/invalid|json|schema/i.test(codB)) return { tip: 'invalid', mesaj: `Citirea AI nu a trecut validarea${msgB ? `: ${msgB}` : ''}. Încearcă „Citește din nou” sau introdu manual.` }
    if (numeErr === 'FunctionsFetchError' || numeErr === 'FunctionsRelayError' || st === 0 || st >= 500) {
      return { tip: 'necunoscut', mesaj: 'Funcția de citire nu a răspuns (nepublicată, rețea sau eroare de server). Dacă citirea a pornit, costul poate fi consumat: nu se reîncearcă automat. Poți introduce rândurile manual.' }
    }
    return { tip: 'eroare', mesaj: msgB || txt(error?.message) || 'Citirea a eșuat.' }
  }
  const n = normalizeazaCitire(data)
  return n.ok ? { tip: 'ok', citire: n.citire } : { tip: 'invalid', mesaj: n.mesaj }
}

// ── rândurile editabile ──────────────────────────────────────────────────
let _nrLocal = 0
const idLocal = () => `r${++_nrLocal}`
/** Un rând gol de tabel. */
export function randGol() {
  return { _id: idLocal(), cod_raw: '', rezultat: '', data_inspectie: '', start_mm: '', end_mm: '', lungime_mm: '', inaltime_mm: '', adancime_mm: '', observatii: '' }
}
const valCamp = v => (v === null || v === undefined ? '' : v)
/** Rândurile unei citiri → rânduri editabile (valorile rămân cum au venit; validarea e la confirmare). */
export function randuriDinCitire(citire) {
  return (citire?.randuri || []).map(r => {
    const o = randGol()
    for (const k of COLOANE_LIPIRE) o[k] = valCamp(r?.[k])
    return o
  })
}

// Antetul recunoscut EXPLICIT (L12, Jakarinos #1218 r1): prima celulă = una dintre etichetele coloanei de cod,
// iar a doua (dacă există) = o etichetă a coloanei de rezultat. Forma comparată: minuscule, fără diacritice,
// orice alt semn → un spațiu. Orice altceva (ex. „ILIZIBIL<TAB>respins”) rămâne RÂND, marcat pentru verificare.
const ANTET_COD = new Set(['cod', 'cod sudura', 'cod suduri', 'codul sudurii', 'sudura', 'suduri', 'nr sudura', 'numar sudura',
  'nr suduri', 'identificare sudura', 'marca sudura', 'simbol sudura', 'weld', 'weld no', 'weld nr', 'weld number', 'weld id', 'joint', 'joint no', 'joint number'])
const ANTET_REZULTAT = new Set(['rezultat', 'rezultatul', 'rezultat examinare', 'rezultatul examinarii', 'apreciere', 'evaluare', 'calificativ',
  'concluzie', 'admis respins', 'acceptat respins', 'result', 'evaluation', 'acc rej'])
const formaAntet = v => txt(v).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
/** Linia lipită e antetul tabelului? Doar după etichetele cunoscute (fără ghicit din „nu are cifre”). */
export function esteAntetLipire(celule) {
  if (!Array.isArray(celule) || !ANTET_COD.has(formaAntet(celule[0]))) return false
  return celule.length < 2 || !areText(celule[1]) || ANTET_REZULTAT.has(formaAntet(celule[1]))
}
export const MOTIV_VERIFICA_LIPIRE = 'Rând lipit cu codul fără nicio cifră (poate un antet nerecunoscut sau un cod ilizibil): verifică-l pe PDF; dacă e antet, șterge-l.'

/**
 * Text lipit din Excel (TAB între coloane, rând nou între rânduri), în ordinea COLOANE_LIPIRE.
 * Liniile goale se sar (Excel pune una la final). Se sare DOAR un antet recunoscut explicit (esteAntetLipire),
 * pe prima linie cu date, și se spune. Orice alt rând rămâne în tabel (nimic pierdut, L12); cele cu codul fără
 * nicio cifră primesc `_verifica` (avertisment pe rând până la corectarea codului). Mai multe coloane decât
 * tabelul = eroare pe linie, nu tăiere (L12/L21).
 * @returns {{randuri:Array, erori:string[], antetSarit:boolean, deVerificat:number}}
 */
export function parseazaLipire(text) {
  const out = { randuri: [], erori: [], antetSarit: false, deVerificat: 0 }
  const linii = String(text ?? '').split(/\r?\n/)
  linii.forEach((linie, i) => {
    if (!/\S/.test(linie)) return
    const celule = linie.split('\t').map(c => c.trim())
    while (celule.length && celule[celule.length - 1] === '') celule.pop()
    if (celule.length > COLOANE_LIPIRE.length) {
      out.erori.push(`Linia ${i + 1} are ${celule.length} coloane; tabelul are ${COLOANE_LIPIRE.length} (cod, rezultat, dată, start, end, lungime, înălțime, adâncime, observații).`)
      return
    }
    if (!out.randuri.length && !out.erori.length && !out.antetSarit && esteAntetLipire(celule)) {
      out.antetSarit = true
      return
    }
    const r = randGol()
    COLOANE_LIPIRE.forEach((k, j) => { r[k] = celule[j] ?? '' })
    if (areText(r.cod_raw) && !/\d/.test(r.cod_raw)) { r._verifica = MOTIV_VERIFICA_LIPIRE; out.deVerificat++ }
    out.randuri.push(r)
  })
  return out
}

// ── pregătirea pentru fn_sud_buletin_confirma ────────────────────────────
// un număr de forma „1.500” / „2,000” poate fi o mie cinci sute sau unu virgulă cinci: nu se ghicește (L17)
const RE_AMBIGUU_MII = /^-?\d{1,3}[.,]\d{3}$/
function numarIndicatie(v) {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return { v: null }
  if (typeof v === 'number') return Number.isFinite(v) ? { v } : { eroare: 'nu e număr' }
  const s = String(v).trim()
  if (RE_AMBIGUU_MII.test(s)) return { eroare: `„${s}” e ambiguu (mii sau zecimale?); scrie-l fără separator de mii` }
  const x = parseNumar(s)
  return Number.isFinite(x) ? { v: x } : { eroare: `„${s}” nu e număr` }
}

/**
 * Rândurile tabelului → p_randuri pentru fn_sud_buletin_confirma, cu aceleași reguli ca serverul
 * (cod_raw text ≤ 80, rezultat acceptat/respins, data AAAA-LL-ZZ sau null, indicații numere, observații ≤ 500, 1..2000 rânduri).
 * Nimic nu se taie și nimic nu se sare: orice abatere e o eroare pe rândul ei și blochează confirmarea.
 * @returns {{ok:boolean, randuri:Array, erori:Array<{index:number|null, camp:string|null, mesaj:string}>}}
 */
export function pregatesteRanduriConfirmare(randuri) {
  const erori = [], out = []
  const lista = Array.isArray(randuri) ? randuri : []
  if (!lista.length) erori.push({ index: null, camp: null, mesaj: 'Buletinul nu are niciun rând.' })
  if (lista.length > MAX_RANDURI) erori.push({ index: null, camp: null, mesaj: `Buletinul are ${lista.length} rânduri; limita e ${MAX_RANDURI}.` })
  lista.forEach((r, i) => {
    const e = (camp, mesaj) => erori.push({ index: i, camp, mesaj })
    const gol = COLOANE_LIPIRE.every(k => !areText(r?.[k]) && typeof r?.[k] !== 'number')
    if (gol) { e(null, 'Rând gol: șterge-l sau completează-l.'); return }
    const cod = typeof r.cod_raw === 'string' ? r.cod_raw.trim() : txt(r.cod_raw)
    if (!cod) e('cod_raw', 'Codul sudurii lipsește.')
    else if (cod.length > 80) e('cod_raw', 'Codul are peste 80 de caractere.')
    const rez = normalizeazaRezultat(r.rezultat)
    if (rez === null) e('rezultat', 'Rezultatul lipsește (acceptat / respins).')
    else if (rez === 'necunoscut') e('rezultat', `Rezultatul „${txt(r.rezultat)}” nu e acceptat / respins.`)
    let data = null
    const d = dataIso(typeof r.data_inspectie === 'string' ? r.data_inspectie : r.data_inspectie ?? null)
    if (d !== null && typeof d !== 'string') e('data_inspectie', `Data „${d.invalid}” nu e validă (ZZ.LL.AAAA).`)
    else data = d
    const ind = {}
    for (const k of CAMPURI_INDICATII) {
      const n = numarIndicatie(r[k])
      if (n.eroare) e(k, n.eroare)
      else ind[k] = n.v
    }
    const obs = txt(r.observatii)
    if (obs.length > 500) e('observatii', 'Observațiile au peste 500 de caractere.')
    out.push({ cod_raw: cod, rezultat: rez, data_inspectie: data, ...ind, observatii: obs || null })
  })
  return { ok: erori.length === 0, randuri: erori.length ? [] : out, erori }
}

// ── a doua citire: alegerea omului pe rândurile diferite ────────────────
/** Stările din comparaCitiri care cer alegerea omului și variantele lor. */
export const VARIANTE_ALEGERE = {
  diferit: ['a', 'b'], incert: ['a', 'b'], dublat: ['a', 'b'],
  doar_in_A: ['pastreaza', 'scoate'], doar_in_B: ['pastreaza', 'scoate'],
}
/**
 * Rezultatul comparaCitiri + alegerile omului → rândurile tabelului. „potrivit” = varianta A;
 * celelalte cer o alegere explicită (fără implicit: nealese = confirmarea rămâne blocată).
 * @param {object} comparatie   ieșirea comparaCitiri(primaCitire, aDouaCitire)
 * @param {Object<string,string>} alegeri  cheie → 'a' | 'b' | 'pastreaza' | 'scoate'
 * @returns {{randuri:Array, nealese:string[]}}
 */
export function combinaCitiri(comparatie, alegeri = {}) {
  const randuri = [], nealese = []
  const curata = r => { const o = randGol(); for (const k of COLOANE_LIPIRE) o[k] = valCamp(r?.[k]); return o }
  for (const x of comparatie?.randuri || []) {
    const v = VARIANTE_ALEGERE[x.stare]
    const ales = alegeri[x.cheie]
    if (!v) { randuri.push(curata(x.a)); continue }
    if (!v.includes(ales)) { nealese.push(x.cheie); continue }
    if (x.stare === 'dublat') (ales === 'a' ? x.a : x.b).forEach(r => randuri.push(curata(r)))
    else if (x.stare === 'doar_in_A') { if (ales === 'pastreaza') randuri.push(curata(x.a)) }
    else if (x.stare === 'doar_in_B') { if (ales === 'pastreaza') randuri.push(curata(x.b)) }
    else randuri.push(curata(ales === 'a' ? x.a : x.b))
  }
  return { randuri, nealese }
}

/**
 * Semnalele de completitudine ale AMBELOR citiri, păstrate după „Aplică alegerile” până la confirmare (L12, Jakarinos #1218 r1):
 * partial = oricare; pagini necitite = reuniunea; incerte = toate, cu citirea din care vin; totalul tipărit = cel comun
 * (două valori diferite → null + `tiparit_diferit`, nu se alege una). Antetul primei citiri rămâne `antet`, al celei
 * de-a doua merge în `antet_b` (verificat și el față de buletinul înregistrat). Rândurile NU sunt aici (le dă tabelul).
 */
export function combinaSemnaleCitiri(a, b) {
  if (!a) return b || null
  if (!b) return a
  const tA = a.antet?.nr_randuri_tiparit ?? null, tB = b.antet?.nr_randuri_tiparit ?? null
  const diferit = Number.isInteger(tA) && Number.isInteger(tB) && tA !== tB
  const pagini = [...new Set([...(a.pagini_necitite || []), ...(b.pagini_necitite || [])])].sort((x, y) => x - y)
  return {
    antet: { ...(a.antet || {}), nr_randuri_tiparit: diferit ? null : (tA ?? tB) },
    antet_b: b.antet || null,
    tiparit_diferit: diferit ? [tA, tB] : null,
    randuri: [],
    incerte: [...(a.incerte || []).map(x => ({ citire: 'prima', valoare: x })), ...(b.incerte || []).map(x => ({ citire: 'a doua', valoare: x }))],
    partial: a.partial === true || b.partial === true,
    partial_din: [a.partial === true && 'prima', b.partial === true && 'a doua'].filter(Boolean),
    pagini_necitite: pagini,
    model: [a.model, b.model].filter(Boolean).join(' + ') || null,
  }
}

// ── rândurile din arhivă (sud_buletin_randuri) → intrarea lui starePeSudura ─
/**
 * Un rând confirmat din BD + antetul buletinului lui → forma cerută de starePeSudura.
 * Cheia se dă prin tronson + nr + sufix (cheia text a serverului, „T12S126”, are alt format); rândurile
 * „nepotrivit” (fără tronson / nr) ajung în `ignorate` ale lui starePeSudura, nu dispar.
 */
export function randArhivaPentruStare(rand, buletin) {
  return {
    tronson: rand.tronson_nr ?? null, nr: rand.nr ?? null, sufix: rand.sufix || '', refacuta: rand.refacuta === true,
    rezultat: rand.rezultat, data_inspectie: rand.data_inspectie ?? null,
    metoda: buletin.metoda, numar: buletin.numar, data_buletin: buletin.data_buletin, buletin_id: buletin.id,
    buletin_stare: buletin.stare, are_pdf: !!buletin.fisier_path,
  }
}

// ── verificările automate (§23) ──────────────────────────────────────────
const P = (cod, nivel, mesaj, index = null) => ({ cod, nivel, mesaj, index })
const listaCoduri = (chei, max = 20) => chei.slice(0, max).map(codDinCheie).join(', ') + (chei.length > max ? ` și încă ${chei.length - max}` : '')
const canonNr = v => txt(v).toUpperCase().replace(/\s+/g, '')

/**
 * Verificările de pe ecranul de confirmare. Nu blochează confirmarea (le decide omul), cu excepția
 * erorilor de format din pregatesteRanduriConfirmare. Necunoscut ≠ concordant (L12/L18): o sursă necitită
 * (pachete, arhivă, eliminate) dă un avertisment explicit, nu „nicio problemă”.
 * @param {object} p
 * @param {Array} p.randuri          rândurile tabelului (editabile)
 * @param {object|null} p.citire     citirea AI normalizată (null la introducere manuală)
 * @param {{id, metoda, numar, data_buletin}} p.buletin  ciorna confirmată
 * @param {string} p.tronsonCod      codul tronsonului încărcării (D6)
 * @param {Set<string>|null} p.coduriPachete   cheile izoNdt ale sudurilor din pachetele tronsonului; null = necitite
 * @param {string[]|null} p.eliminate          cheile serverului („T12S126”) ale sudurilor eliminate active; null = necitite
 * @param {Array|null} p.arhiva                rândurile buletinelor CONFIRMATE ale tronsonului (randArhivaPentruStare); null = necitite
 * @returns {{probleme:Array<{cod, nivel:'eroare'|'atentie'|'info', mesaj, index}>, peRand:Object<number,Array>, rezumat:{eroare,atentie,info}}}
 */
export function calculeazaVerificari({ randuri, citire = null, buletin, tronsonCod, coduriPachete = null, eliminate = null, arhiva = null } = {}) {
  const probleme = []
  const lista = Array.isArray(randuri) ? randuri : []
  const tNr = tronsonNrDinCod(tronsonCod)
  const metoda = normalizeazaMetoda(buletin?.metoda)
  if (tNr === null) probleme.push(P('tronson_necunoscut', 'atentie', `Numărul tronsonului nu se poate citi din codul „${txt(tronsonCod)}”: toate codurile vor ieși „nepotrivit”.`))

  // 1. numărul de rânduri față de totalul tipărit
  const tiparit = citire?.antet?.nr_randuri_tiparit ?? null
  if (Number.isInteger(tiparit) && tiparit > 0) {
    if (lista.length !== tiparit) probleme.push(P('numar_randuri', 'atentie', `Buletinul arată ${tiparit} rânduri (ultimul nr. crt. / total tipărit); în tabel sunt ${lista.length}.`))
  } else if (Array.isArray(citire?.tiparit_diferit)) {
    probleme.push(P('numar_randuri_diferit', 'atentie', `Cele două citiri dau totaluri tipărite diferite (${citire.tiparit_diferit.join(' / ')}): numără rândurile pe PDF (ultimul nr. crt.).`))
  } else {
    probleme.push(P('numar_randuri_necunoscut', 'info', 'Totalul tipărit al buletinului nu e cunoscut: numără rândurile pe PDF (ultimul nr. crt.).'))
  }

  // 5. citire parțială / pagini necitite / valori incerte (după a doua citire: din AMBELE, combinaSemnaleCitiri)
  const dinCitiri = citire?.partial_din?.length ? ` (${citire.partial_din.join(', ')} citire)` : ''
  if (citire?.partial === true) probleme.push(P('citire_partiala', 'atentie', `Citirea AI spune că e parțială${dinCitiri}: verifică pe PDF rândurile lipsă.`))
  if (citire?.pagini_necitite?.length) probleme.push(P('pagini_necitite', 'atentie', `Pagini necitite: ${citire.pagini_necitite.join(', ')}.`))
  if (citire?.incerte?.length) probleme.push(P('valori_incerte', 'atentie', `Citirea AI are ${citire.incerte.length} valori incerte: verifică-le pe PDF.`))

  // rândurile lipite cu codul fără cifre (posibil antet nerecunoscut): rămân în tabel, marcate (parseazaLipire)
  lista.forEach((r, i) => { if (r?._verifica) probleme.push(P('rand_de_verificat', 'atentie', r._verifica, i)) })

  // antetul citit față de ce s-a înregistrat (corectura = anulare + reîncărcare, R5); după a doua citire, ambele antete
  for (const [a, din] of [[citire?.antet, ''], [citire?.antet_b, ' (a doua citire)']]) {
    if (!a) continue
    if (areText(a.numar) && canonNr(a.numar) !== canonNr(buletin?.numar)) probleme.push(P('antet_numar', 'atentie', `Numărul citit${din} („${txt(a.numar)}”) diferă de cel înregistrat („${txt(buletin?.numar)}”). Dacă e greșit înregistrat: anulează și reîncarcă.`))
    const dA = dataIso(typeof a.data === 'string' ? a.data : null)
    if (typeof dA === 'string' && dA !== buletin?.data_buletin) probleme.push(P('antet_data', 'atentie', `Data citită${din} (${fmtData(dA)}) diferă de cea înregistrată (${fmtData(buletin?.data_buletin)}).`))
    const mA = normalizeazaMetoda(a.metoda)
    if (mA && metoda && mA !== metoda) probleme.push(P('antet_metoda', 'atentie', `Metoda citită${din} (${mA}) diferă de cea aleasă (${metoda}).`))
    const tA = tronsonNrDinCod(a.tronson) ?? (/^\s*\d{1,3}\s*$/.test(txt(a.tronson)) ? Number(txt(a.tronson)) : null)
    if (areText(a.tronson) && tNr !== null && tA !== tNr) probleme.push(P('antet_tronson', 'atentie', `Tronsonul citit${din} („${txt(a.tronson)}”) diferă de tronsonul încărcării (${txt(tronsonCod)}).`))
  }

  // 4. codurile: normalizare, existență în pachete, dubluri, eliminate
  if (coduriPachete === null) probleme.push(P('pachete_necitite', 'atentie', 'Sudurile din pachetele tronsonului nu s-au putut citi: existența codurilor nu e verificată.'))
  if (eliminate === null) probleme.push(P('eliminate_necitite', 'atentie', 'Lista sudurilor eliminate nu s-a putut citi.'))
  const elim = new Set((eliminate || []).map(cheieDinServer).filter(Boolean))
  const vazut = new Map()
  const normale = lista.map((r, i) => {
    const n = normalizeazaRandBuletin(r?.cod_raw, tNr)
    if (!areText(r?.cod_raw)) return n
    if (n.stare !== 'ok') {
      probleme.push(P('cod_nepotrivit', 'atentie', `Codul „${txt(r.cod_raw)}” nu se poate lega de o sudură a tronsonului (${n.motiv}); rămâne în buletin ca „nepotrivit”.`, i))
      return n
    }
    const k = `${n.cheie}|${n.refacuta ? 'R' : ''}`
    if (vazut.has(k)) probleme.push(P('cod_dublat', 'atentie', `Sudura ${n.cod}${n.refacuta ? ' (refăcută)' : ''} apare de două ori (și la rândul ${vazut.get(k) + 1}).`, i))
    else vazut.set(k, i)
    if (coduriPachete && !coduriPachete.has(n.cheie)) probleme.push(P('cod_lipsa_pachet', 'atentie', `Sudura ${n.cod} nu există în pachetele tronsonului.`, i))
    if (elim.has(n.cheie)) probleme.push(P('sudura_eliminata', 'info', `Sudura ${n.cod} e marcată eliminată prin tăiere.`, i))
    if (dataSauNull(r.data_inspectie) === null) probleme.push(P('data_inspectie_lipsa', 'atentie', `Sudura ${n.cod} n-are dată de inspecție validă: rezultatul nu se poate ordona față de alte buletine.`, i))
    return n
  })

  // 2. respinse fără pereche R acceptată (în buletin + arhiva aceleiași metode) și 3. comparația cu cealaltă metodă
  if (arhiva === null) probleme.push(P('arhiva_necitita', 'atentie', 'Buletinele confirmate ale tronsonului nu s-au putut citi: refacerile și comparația cu cealaltă metodă nu sunt verificate.'))
  if (metoda) {
    const curente = lista.map((r, i) => normale[i].stare !== 'ok' ? null : {
      tronson: normale[i].tronson, nr: normale[i].nr, sufix: normale[i].sufix, refacuta: normale[i].refacuta,
      rezultat: r.rezultat, data_inspectie: dataSauNull(r.data_inspectie),
      metoda, numar: buletin?.numar, data_buletin: buletin?.data_buletin, buletin_id: buletin?.id, _index: i,
    }).filter(Boolean)
    const alta = METODA_PERECHE[metoda] || null
    const arh = (arhiva || []).filter(x => x.buletin_id !== buletin?.id && (normalizeazaMetoda(x.metoda) === metoda || (alta && normalizeazaMetoda(x.metoda) === alta)))
    const stare = starePeSudura([...arh, ...curente], { metode: alta ? [metoda, alta] : [metoda] })
    const semnalat = new Set()
    for (const c of curente) {
      const k = `${c.tronson}|${c.nr}|${c.sufix}`
      if (semnalat.has(k)) continue
      const s = stareMetoda(stare, k, metoda)
      if (s.stare === 'respins_fara_refacere') {
        semnalat.add(k)
        probleme.push(P('respins_fara_refacere', 'atentie', `Sudura ${codDinCheie(k)}: ultimul rezultat ${metoda} e „respins”, fără refacere „R” acceptată.`, c._index))
      } else if (s.stare === 'conflict') {
        semnalat.add(k)
        probleme.push(P('conflict_rezultate', 'atentie', `Sudura ${codDinCheie(k)}: rezultatele ${metoda} nu se pot ordona (${s.motiv}); verifică datele.`, c._index))
      }
    }
    if (!alta) {
      probleme.push(P('comparatie_na', 'info', `Pentru metoda ${metoda} nu există comparație cu altă metodă (doar PA-UT ↔ PM).`))
    } else if (arhiva !== null) {
      const cuAlta = Object.values(stare.suduri).filter(s => s.metode[alta]?.stare !== 'lipsa').length
      if (!cuAlta) {
        probleme.push(P('comparatie_fara_alta', 'info', `Pe tronson nu există încă buletine ${alta} confirmate: comparația ${metoda} ↔ ${alta} se face când apar.`))
      } else {
        const cm = comparaMetode(stare, metoda, alta)
        const inBuletin = new Map(curente.map(c => [`${c.tronson}|${c.nr}|${c.sufix}`, c._index]))
        const doarAici = cm.doar_in_A.filter(k => inBuletin.has(k))
        for (const k of doarAici) probleme.push(P('fara_alta_metoda', 'info', `Sudura ${codDinCheie(k)} n-are încă buletin ${alta}.`, inBuletin.get(k)))
        if (cm.doar_in_B.length) probleme.push(P('alta_metoda_fara_aceasta', 'info', `${cm.doar_in_B.length} suduri au buletin ${alta}, dar nu ${metoda}: ${listaCoduri(cm.doar_in_B)}.`))
      }
    }
  }

  const peRand = {}
  for (const p of probleme) if (p.index !== null) (peRand[p.index] ||= []).push(p)
  const rezumat = { eroare: 0, atentie: 0, info: 0 }
  for (const p of probleme) rezumat[p.nivel]++
  return { probleme, peRand, rezumat }
}
// data de inspecție în forma ISO (acceptă și ZZ.LL.AAAA din introducerea manuală); invalid / lipsă → null
const dataSauNull = v => { const d = typeof v === 'string' ? dataIso(v) : null; return typeof d === 'string' ? d : null }

// ── lista de buletine ────────────────────────────────────────────────────
/** Filtrele de pe ecran (metodă / stare; '' = toate) + ordinea: data buletinului desc, apoi id desc. */
export function filtreazaBuletine(lista, { metoda = '', stare = '' } = {}) {
  return (Array.isArray(lista) ? lista : [])
    .filter(b => (!metoda || b.metoda === metoda) && (!stare || b.stare === stare))
    .sort((x, y) => (x.data_buletin === y.data_buletin ? 0 : x.data_buletin > y.data_buletin ? -1 : 1) || Number(y.id) - Number(x.id))
}

/** Sudurile din pachete (executie_tevi.sudura_cod) → mulțimea cheilor izoNdt, pe tronsonul dat; codurile nerecunoscute se numără. */
export function coduriDinPachete(tevi, tronsonCod) {
  const tNr = tronsonNrDinCod(tronsonCod)
  const chei = new Set()
  let nerecunoscute = 0
  for (const t of Array.isArray(tevi) ? tevi : []) {
    if (!t || t.tip_rand === 'separator' || !areText(t.sudura_cod)) continue
    const n = normalizeazaRandBuletin(t.sudura_cod, tNr)
    if (n.stare === 'ok') chei.add(n.cheie)
    else nerecunoscute++
  }
  return { chei, nerecunoscute }
}

/** Formularul „Marchează eliminată” (aceleași reguli ca fn_sud_sudura_elimina, verificate și pe server). */
export function valideazaEliminare({ cod, motiv, inlocuitaDe }, tronsonCod) {
  const erori = {}
  const tNr = tronsonNrDinCod(tronsonCod)
  const n = normalizeazaRandBuletin(cod, tNr)
  if (!areText(cod)) erori.cod = 'Codul sudurii e obligatoriu.'
  else if (n.stare !== 'ok') erori.cod = `Codul nu e o sudură a tronsonului (${n.motiv}).`
  else if (n.refacuta) erori.cod = 'Codul sudurii eliminate se scrie fără „R” (refacerea e aceeași sudură).'
  if (txt(motiv).length < 3) erori.motiv = 'Motivul e obligatoriu (cel puțin 3 caractere).'
  const noi = String(inlocuitaDe ?? '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
  const rele = noi.filter(x => normalizeazaRandBuletin(x, tNr).stare !== 'ok')
  if (rele.length) erori.inlocuitaDe = `Coduri invalide: ${rele.join(', ')}.`
  return { ok: !Object.keys(erori).length, erori, valori: { cod: n.cod, motiv: txt(motiv), inlocuitaDe: noi } }
}
