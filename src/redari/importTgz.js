// Redări teren — importul Excel-ului TGZ („Raport Informatii Generale Terenuri”) → preview → scriere în BD.
// Contract: docs/redari/CONTRACT_SCHEMA.md §7. Modul pur (fără React); scrierea primește clientul supabase ca parametru.
// Runda 2 (Jakarinos r1): cheie_sursa stabilă pe parcelă, id-uri provizorii + rezervare numere prin RPC, lot in_curs/finalizat/esuat, reluare.
// Runda 4 (Jakarinos r2):
//  - cheie_sursa VALIDĂ doar cu poz_hg SAU nr_cadastral (tarla singură nu ajunge → null);
//  - două Nr.Crt. diferite cu aceeași cheie_sursa validă = identitate AMBIGUĂ: nu se unesc, ambele marcate `ambigua`, eroare pe rând, sărite la commit;
//  - parcelele fără cheie_sursa NU se comit (reimportul le-ar dubla): sărite + raportate în `fara_cheie` (completare manuală din Fișă, ulterior);
//  - județul din adresă („jud. X”) prevalează; dacă diferă de coloana Județ → notă în observatii-le parcelei;
//  - contoarele lotului se actualizează la finalul fiecărei etape; eroarea de la marcarea „esuat” nu se înghite (e.lotNeinchis);
//  - citirile existente: max 100 de id-uri per .in() + .range() paginat până la epuizare.
// Upsert-ul de atribute (Anexa 7) NU e în felia asta: parcelele/deținătorii existenți nu se modifică.

import * as XLSX from 'xlsx-js-style'
import { faraDiacritice, normalizeazaNume } from './idParcela.js'

// Contract 8a: identitatea nu depinde de tronson; helperul legacy ramane in afara feliei.
export function idParcela(cod3, n) {
  if (!/^[A-Z]{3}$/.test(cod3)) throw new Error('idParcela: uat3 invalid')
  if (!Number.isInteger(n) || n < 1 || n > 9999) throw new Error('idParcela: numar invalid (1..9999)')
  return `${cod3}-${String(n).padStart(4, '0')}`
}
export function idParcelaProvizoriu(cod3) {
  if (!/^[A-Z]{3}$/.test(cod3)) throw new Error('idParcelaProvizoriu: uat3 invalid')
  return `${cod3}-????`
}
export function tronsonOptional(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^(?:[1-9]|10|11)$/.test(v) ? Number(v) : null
  return Number.isInteger(n) && n >= 1 && n <= 11 ? n : null
}
// Copilot f8b r1 P3-01: absent = NULL (se atribuie ulterior); dat explicit dar in afara 1..11 = eroare de validare, nu NULL tacut
export function tronsonDatInvalid(v) {
  return v !== undefined && v !== null && v !== '' && tronsonOptional(v) === null
}

export const LOT = 200          // mărimea unui lot la INSERT
export const LOT_CITIRE = 100   // max id-uri per .in() la citiri
export const PAGINA = 1000      // mărimea paginii la .range() (limita implicită PostgREST)
export const RPC_REZERVA_NUMERE = 'fn_red_rezerva_numere_parcele'
export const MOTIV_AMBIGUU = 'identitate ambiguă (aceeași poziție HG / cadastru pe rânduri diferite)'
export const MOTIV_CONTRADICTORIU = 'identitate contradictorie sub același Nr.Crt.'
export const MOTIV_CADASTRU_SUSPECT = 'cadastru suspect (posibilă valoare-umplutură) — de verificat'
export const MOTIV_NRCRT_PUNCT = 'Nr.Crt. „x.y” fără „/”: identitatea există deja în BD (regula veche citea x/y) — de verificat, nu se importă'
// câmpurile consolidate pe grupul Nr.Crt. x (P1-2 r7): [câmp, eticheta din detaliu]
const CAMPURI_GRUP = [['poz_hg', 'HG'], ['nr_cadastral', 'cadastru'], ['tarla', 'tarla'], ['suprafata_temporara_mp', 'suprafață'], ['categoria_folosinta', 'categorie'], ['regim', 'regim']]
export const MAX_NUMAR_PARCELA = 9999   // id_parcela are fix 4 cifre
const MAX_RAND_ANTET = 30       // căutăm antetul în primele 30 de rânduri

// Cheie de potrivire pentru antet: fără diacritice, litere mici, doar [a-z0-9].
export const cheie = s => faraDiacritice(s).toLowerCase().replace(/[^a-z0-9]/g, '')

// Coloanele din §7, în ordinea în care se încearcă potrivirea (prima regulă care se potrivește ia coloana).
const COLOANE = [
  { camp: 'nr_crt',       test: k => k === 'nrcrt' || k === 'nrcrt.' || k.startsWith('nrcrt') },
  { camp: 'poz_hg',       test: k => k.includes('pozhg') || k.includes('poz') },
  { camp: 'uat',          test: k => k === 'uat' || k.startsWith('uat') },
  { camp: 'judet',        test: k => k.includes('judet') },
  { camp: 'nume',         test: k => k.includes('nume') },
  { camp: 'adresa',       test: k => k.includes('adres') },
  { camp: 'suprafata',    test: k => k.includes('suprafat') },
  { camp: 'categorie',    test: k => k.includes('categor') },
  { camp: 'tarla',        test: k => k.includes('tarla') || k.includes('topo') },
  { camp: 'nr_cadastral', test: k => k.includes('cadastr') || k.includes('parcel') },
  { camp: 'regim',        test: k => k.includes('regim') },
]
const OBLIGATORII = ['nr_crt', 'uat', 'nume']

export const text = v => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())

export function numar(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// „7/2” → { x: 7, sub: null, y: 2, grup: '7', punct_fara_slash: false }; „12” sau 12 → { x: 12, sub: null, y: null, grup: '12', … }; altfel null.
// Decizie Răzvan 04.11.2026: „166.1/1” = parcela 166.1, SEPARATĂ de 166 → { x: 166, sub: 1, y: 1, grup: '166.1' }; „166.1” simplu → grupul 166.1.
// Punctul NU mai e separator x/y (înainte „7.2” = 7/2); separatorii x/y rămân „/” și „-”. x și y acceptă zero-uri la început ca înainte
// („07/1” = 7/1); subnumărul NU (166.01 ar arăta ca 166.1 → invalid, nu ghicim). 0 → invalid.
// `punct_fara_slash` = forma „x.y” fără „/” — regula veche o citea x/y; la scriere, dacă identitatea ei există deja în BD, grupul se oprește „de tratat”.
// Numerele Excel neîntregi (166.1 ca număr) rămân invalide: fără String() + reparsare (L17) — se scriu ca text în Excel.
// Copilot r1 P2-04: fiecare componentă trebuie să fie întreg sigur (Number.isSafeInteger) — altfel două șiruri lungi ar da același grup.
export function parseazaNrCrt(v) {
  if (v == null || v === '') return null
  const ok = n => Number.isSafeInteger(n) && n > 0
  if (typeof v === 'number') return ok(v) ? { x: v, sub: null, y: null, grup: String(v), punct_fara_slash: false } : null
  const m = String(v).trim().match(/^(\d+)(?:\.([1-9]\d*))?(?:[ \t]*[\/\-][ \t]*(\d+))?$/)
  if (!m) return null
  const x = Number(m[1]); const sub = m[2] != null ? Number(m[2]) : null; const y = m[3] != null ? Number(m[3]) : null
  if (!ok(x) || (sub != null && !ok(sub)) || (y != null && !ok(y))) return null
  return { x, sub, y, grup: sub != null ? `${x}.${sub}` : String(x), punct_fara_slash: sub != null && y == null }
}

/**
 * Cadastrul TGZ vine compus cu „#” („<nr. cadastral>#<parcelă/topo>#<rest>”: „123##”, „#123#”, „50029#30#”, „##”).
 * Decizie r2 (04.11.2026, după NO-GO r1): forma cheii de identitate NU se schimbă — cadastrul intră în cheie EXACT ca în main
 * („123##” și „#123#” rămân identități diferite). Singura schimbare: un cadastru GOL (doar „#”-uri / spații, fără nicio cifră sau literă)
 * nu mai e identitate — fără poziție HG, rândul e „fără cheie”.
 */
export const cadastruGol = v => !/[\p{L}\p{N}]/u.test(text(v))

// Cadastru „umplutură” evidentă: toate subcâmpurile nevide sunt 0…, 999… sau nu au nicio cifră („DE”). DOAR marcaj în raport (pct. 4), nu schimbă cheia.
export function cadastruSuspect(v) {
  const sub = text(v).split('#').map(x => x.trim()).filter(Boolean)
  if (!sub.length) return false
  return sub.every(c => /^0+$/.test(c) || /^9{3,}$/.test(c) || !/\d/.test(c))
}

/**
 * cheieSursa(uat3, poz_hg, nr_cadastral, tarla) → 'HUS|HG 1|CF 1001|T12' (majuscule, fără diacritice, spații simple).
 * VALIDĂ doar dacă există poz_hg SAU nr_cadastral REAL (nu gol / doar „#”); tarla singură NU identifică un teren → null.
 * Pentru orice rând care avea identitate, cheia e identică cu cea de dinainte de 04.11.2026 (reimportul se potrivește pe cheile din BD).
 */
export function cheieSursa(uat3, poz_hg, nr_cadastral, tarla) {
  const p = normalizeazaNume(poz_hg); const c = normalizeazaNume(nr_cadastral); const t = normalizeazaNume(tarla)
  if (!p && (!c || cadastruGol(c))) return null
  return `${String(uat3 ?? '').toUpperCase()}|${p}|${c}|${t}`
}

/**
 * imparteAdresa(adresa, judetColoana) → { adresa_strada, adresa_sat, adresa_comuna, adresa_judet, judet_adresa } best-effort, fără să inventăm:
 * segmentele separate prin virgulă cu prefix recunoscut (sat/com./jud.) se pun la locul lor; restul rămâne în adresa_strada.
 * `judet_adresa` = județul scris explicit în adresă („jud. X” / „județul X”), null dacă lipsește; el PREVALEAZĂ în adresa_judet
 * față de coloana Județ (care rămâne doar rezervă).
 */
export function imparteAdresa(adresa, judetColoana) {
  const r = { adresa_strada: null, adresa_sat: null, adresa_comuna: null, adresa_judet: text(judetColoana) || null, judet_adresa: null }
  const a = text(adresa)
  if (!a) return r
  const rest = []
  for (const segBrut of a.split(/[,;]/)) {
    const seg = segBrut.trim()
    if (!seg) continue
    const k = faraDiacritice(seg).toLowerCase()
    let m
    if ((m = k.match(/^(?:sat(?:ul)?|loc(?:alitatea)?\.?)\s*\.?\s+(.+)$/))) { if (!r.adresa_sat) { r.adresa_sat = seg.slice(seg.length - m[1].length).trim(); continue } }
    else if ((m = k.match(/^(?:com(?:una)?\.?|mun(?:icipiul)?\.?|oras(?:ul)?)\s*\.?\s+(.+)$/))) { if (!r.adresa_comuna) { r.adresa_comuna = seg.slice(seg.length - m[1].length).trim(); continue } }
    else if ((m = k.match(/^(?:jud(?:etul)?\.?)\s*\.?\s+(.+)$/))) { if (!r.judet_adresa) r.judet_adresa = seg.slice(seg.length - m[1].length).trim(); continue }
    rest.push(seg)
  }
  if (r.judet_adresa) r.adresa_judet = r.judet_adresa
  r.adresa_strada = rest.length ? rest.join(', ') : null
  return r
}

function gasesteAntet(sheet, range) {
  const rMax = Math.min(range.e.r, range.s.r + MAX_RAND_ANTET)
  for (let r = range.s.r; r <= rMax; r++) {
    const chei = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cel = sheet[XLSX.utils.encode_cell({ r, c })]
      chei.push(cel ? cheie(cel.v) : '')
    }
    if (chei.some(k => k.includes('nume')) && chei.some(k => k === 'uat' || k.startsWith('uat'))) return { rand: r, chei }
  }
  return null
}

function mapeazaColoane(chei, cStart) {
  const col = {}
  const luate = new Set()
  for (const { camp, test } of COLOANE) {
    for (let i = 0; i < chei.length; i++) {
      const k = chei[i]
      if (!k || luate.has(i) || !test(k)) continue
      col[camp] = cStart + i; luate.add(i); break
    }
  }
  return col
}

/**
 * parseazaTgz(arrayBuffer, { uats, tronsonPeUat, versiune, sursa })
 *  - uats: [{ id, nume, uat3 }] — UAT-urile proiectului (potrivire pe nume normalizat sau pe uat3)
 *  - tronsonPeUat: { HUS: 3, ... } — tronson optional per UAT; nu participa la identitate
 *  - idStart: IGNORAT (compatibilitate) — numerele se rezervă server-side la commit
 * → { parcele, detinatori, contacte, dubluri, neidentificati, fara_cheie, ambigue, erori, statistici, antet }
 * Parcela e cheiată intern pe (uat3, Nr.Crt. x) = `cheie` ('HUS:7'); `cheie_sursa` (uat3|poz_hg|nr_cadastral|tarla, sau null) e identitatea
 * între importuri; `ambigua: true` când altă parcelă din fișier are aceeași cheie_sursa. `id_parcela` e PROVIZORIU ('HUS-????').
 * Deținătorii poartă `cheie_parcela`, contactele `cheie_detinator`. `fara_cheie` / `ambigue` = rândurile (deținătorii) care NU se vor comite.
 */
export function parseazaTgz(arrayBuffer, { uats = [], tronsonPeUat = {}, versiune = null, sursa = 'TGZ' } = {}) {
  const erori = []
  const gol = { parcele: [], detinatori: [], contacte: [], dubluri: [], neidentificati: [], fara_cheie: [], ambigue: [], cadastru_suspect: [], erori }
  const statistici = { randuri_total: 0, randuri_goale: 0, parcele: 0, parcele_fara_cheie: 0, parcele_ambigue: 0, detinatori: 0, contacte: 0, dubluri: 0, neidentificati: 0, fara_cheie: 0, ambigue: 0, judet_diferit: 0, erori: 0, cadastru_suspect: 0, randuri_de_tratat: 0, pe_uat: {} }

  let wb
  try {
    const date = arrayBuffer instanceof ArrayBuffer ? new Uint8Array(arrayBuffer) : arrayBuffer
    wb = XLSX.read(date, { type: 'array', cellDates: false })
  } catch (e) {
    erori.push({ rand: null, motiv: `Fișierul nu poate fi citit ca Excel: ${e.message}` })
    statistici.erori = erori.length
    return { ...gol, statistici }
  }
  const numeFoaie = wb.SheetNames[0]
  const sheet = numeFoaie ? wb.Sheets[numeFoaie] : null
  if (!sheet || !sheet['!ref']) {
    erori.push({ rand: null, motiv: 'Fișierul nu are nicio foaie cu date' })
    statistici.erori = erori.length
    return { ...gol, statistici }
  }
  const range = XLSX.utils.decode_range(sheet['!ref'])
  const antet = gasesteAntet(sheet, range)
  if (!antet) {
    erori.push({ rand: null, motiv: 'Nu găsesc rândul de antet (trebuie să conțină „Nume” și „UAT”)' })
    statistici.erori = erori.length
    return { ...gol, statistici }
  }
  const col = mapeazaColoane(antet.chei, range.s.c)
  const lipsa = OBLIGATORII.filter(c => col[c] == null)
  if (lipsa.length) {
    erori.push({ rand: antet.rand + 1, motiv: `Lipsesc coloanele obligatorii: ${lipsa.join(', ')}` })
    statistici.erori = erori.length
    return { ...gol, statistici }
  }

  // UAT-uri: după nume normalizat și după uat3
  const uatDupa = new Map()
  for (const u of uats) {
    if (!u) continue
    if (u.nume) uatDupa.set(normalizeazaNume(u.nume), u)
    if (u.uat3) uatDupa.set(String(u.uat3).toUpperCase(), u)
  }
  const nrProvizoriu = {}

  const parcele = []; const detinatori = []; const contacte = []; const dubluri = []; const neidentificati = []; const cadastru_suspect = []; const suspecte = []
  const parcelaDupaCheie = new Map()       // 'HUS:7' → parcela
  const parcelaDupaCheieSursa = new Map()  // cheie_sursa validă → prima parcelă cu ea (pentru detectarea ambiguității)
  const detinatorDupaCheie = new Map()     // 'HUS:7|POPESCU ION' → detinator
  const statUat = uat3 => (statistici.pe_uat[uat3] ??= { parcele: 0, detinatori: 0, dubluri: 0, neidentificati: 0, fara_cheie: 0, ambigue: 0, erori: 0 })
  const noteazaObs = (p, nota) => { if (!p.note.includes(nota)) p.note.push(nota) }   // notele intră în observatii după consolidare

  const celula = (r, c) => { if (c == null) return null; const cel = sheet[XLSX.utils.encode_cell({ r, c })]; return cel ? cel.v : null }

  for (let r = antet.rand + 1; r <= range.e.r; r++) {
    const randExcel = r + 1
    const nrCrtBrut = celula(r, col.nr_crt)
    const numeBrut = text(celula(r, col.nume))
    const uatBrut = text(celula(r, col.uat))
    if (text(nrCrtBrut) === '' && numeBrut === '' && uatBrut === '') { statistici.randuri_goale++; continue }
    statistici.randuri_total++

    const nrCrt = parseazaNrCrt(nrCrtBrut)
    if (!nrCrt) { erori.push({ rand: randExcel, motiv: `Nr.Crt. invalid „${text(nrCrtBrut)}”`, uat: uatBrut, nume: numeBrut }); continue }
    if (!numeBrut) { erori.push({ rand: randExcel, motiv: 'Nume deținător gol', uat: uatBrut, nr_crt: text(nrCrtBrut) }); continue }

    const uat = uatDupa.get(normalizeazaNume(uatBrut)) || uatDupa.get(uatBrut.toUpperCase())
    if (!uat) { erori.push({ rand: randExcel, motiv: `UAT necunoscut „${uatBrut}”`, uat: uatBrut, nume: numeBrut }); continue }
    const s = statUat(uat.uat3)
    if (tronsonDatInvalid(tronsonPeUat?.[uat.uat3])) { erori.push({ rand: randExcel, motiv: `Tronson invalid pentru UAT ${uat.uat3} (1..11 sau gol)`, uat: uatBrut, nume: numeBrut }); s.erori++; continue }
    const tronson = tronsonOptional(tronsonPeUat?.[uat.uat3])

    // parcela: cheiată pe (uat3, Nr.Crt. x). Atributele și cheie_sursa se CONSOLIDEAZĂ pe tot grupul după buclă (P1-2 r7):
    // valoarea unui câmp = unica valoare nevidă din grup; mai multe valori distincte ⇒ parcelă ambiguă.
    // 04.11.2026: grupul e „166” sau „166.1” (parcelă separată de 166) — cheia internă 'HUS:166' / 'HUS:166.1'
    const cheieP = `${uat.uat3}:${nrCrt.grup}`
    let parcela = parcelaDupaCheie.get(cheieP)
    if (!parcela) {
      nrProvizoriu[uat.uat3] = (nrProvizoriu[uat.uat3] ?? 0) + 1
      parcela = {
        cheie: cheieP,
        cheie_sursa: null,
        ambigua: false,
        motiv_ambiguitate: null,
        nr_crt: nrCrt.sub != null ? nrCrt.grup : nrCrt.x,
        uat_id: uat.id ?? null,
        uat3: uat.uat3,
        id_parcela: idParcelaProvizoriu(uat.uat3),
        nr_provizoriu: nrProvizoriu[uat.uat3],
        tronson,
        poz_hg: null, suprafata_temporara_mp: null, categoria_folosinta: null, tarla: null, nr_cadastral: null, observatii: null,
        rand: randExcel,
        nr_detinatori: 0,
        uat_text: uatBrut,
        note: [],                                                                      // note (ex. județ diferit) → observatii
        valori: Object.fromEntries(CAMPURI_GRUP.map(([camp]) => [camp, new Map()])),   // camp → Map(normalizat → prima valoare originală) din tot grupul
        punct_fara_slash: false,                                                       // grupul are rânduri „x.y” fără „/” (vezi parseazaNrCrt)
        randuri: [],                                                                   // TOATE rândurile grupului, inclusiv dublurile de nume (P2-2)
      }
      parcelaDupaCheie.set(cheieP, parcela); parcele.push(parcela); s.parcele++
    }
    if (nrCrt.punct_fara_slash) parcela.punct_fara_slash = true
    // valorile NEVIDE ale grupului, per câmp (goale = moștenire de la x/1, nu contează)
    const brute = {
      poz_hg: text(celula(r, col.poz_hg)), nr_cadastral: text(celula(r, col.nr_cadastral)), tarla: text(celula(r, col.tarla)),
      suprafata_temporara_mp: numar(celula(r, col.suprafata)), categoria_folosinta: text(celula(r, col.categorie)), regim: text(celula(r, col.regim)),
    }
    // cadastrul intră în consolidare EXACT ca în main (r2: „##” rămâne valoare la contradicții; doar cheieSursa îl tratează ca gol)
    if (cadastruSuspect(brute.nr_cadastral)) suspecte.push({ rand: randExcel, cheie_parcela: cheieP, nr_crt: text(nrCrtBrut), valoare: brute.nr_cadastral })   // Copilot r1 P2-03: rândul care CONȚINE valoarea
    for (const [camp] of CAMPURI_GRUP) {
      const v = brute[camp]
      if (v == null || v === '') continue
      const k = typeof v === 'number' ? String(v) : normalizeazaNume(v)
      if (!parcela.valori[camp].has(k)) parcela.valori[camp].set(k, v)
    }
    parcela.randuri.push({ rand: randExcel, nr_crt: text(nrCrtBrut), nume: numeBrut })

    // deținătorul
    const numeNorm = normalizeazaNume(numeBrut)
    const esteNeidentificat = numeNorm.includes('NEIDENTIFICAT')
    const cheieDet = `${cheieP}|${numeNorm}`
    if (detinatorDupaCheie.has(cheieDet)) {
      dubluri.push({ rand: randExcel, cheie_parcela: cheieP, nr_crt: parcela.nr_crt, nume: numeBrut, nume_normalizat: numeNorm, rand_original: detinatorDupaCheie.get(cheieDet).rand })
      s.dubluri++; continue
    }
    const adresaBrut = text(celula(r, col.adresa))
    const det = {
      cheie: cheieDet,
      cheie_parcela: cheieP,
      id_parcela: parcela.id_parcela,   // provizoriu — la commit se folosește cheie_parcela
      nr_crt: text(nrCrtBrut),
      nume: numeBrut,
      nume_normalizat: numeNorm,
      calitate: esteNeidentificat ? 'neidentificat' : (nrCrt.y != null && nrCrt.y > 1 ? 'coproprietar' : 'proprietar'),
      cota: null,
      sursa_date: sursa,
      versiune_lista_tgz: versiune,
      rand: randExcel,
    }
    detinatorDupaCheie.set(cheieDet, det); detinatori.push(det); parcela.nr_detinatori++; s.detinatori++
    if (esteNeidentificat) { neidentificati.push({ rand: randExcel, cheie_parcela: cheieP, nr_crt: parcela.nr_crt, nume: numeBrut }); s.neidentificati++ }

    // P1-3: județul din adresă prevalează; dacă diferă de coloana Județ → notă pe parcelă
    const judetColoana = text(celula(r, col.judet)) || null
    const adresa = imparteAdresa(adresaBrut, judetColoana)
    if (adresa.judet_adresa && judetColoana && normalizeazaNume(adresa.judet_adresa) !== normalizeazaNume(judetColoana)) {
      noteazaObs(parcela, `județ adresă ≠ județ teren (adresă: ${adresa.judet_adresa}; teren: ${judetColoana}; rând ${randExcel})`)
      statistici.judet_diferit++
    }
    contacte.push({
      cheie_detinator: cheieDet,
      ...adresa,
      cod_postal: null,
      adresa_cunoscuta: !esteNeidentificat && adresaBrut !== '',
    })
  }

  // mai mulți deținători pe aceeași parcelă → toți coproprietari (neidentificații rămân neidentificați)
  for (const d of detinatori) {
    const p = parcelaDupaCheie.get(d.cheie_parcela)
    if (p.nr_detinatori > 1 && d.calitate === 'proprietar') d.calitate = 'coproprietar'
  }
  // P1-2 (r7): consolidarea pe grup — câmpul ia unica valoare nevidă (prima apariție ca formă originală); >1 valori distincte ⇒ contradicție
  for (const p of parcele) {
    const contradictorii = []
    for (const [camp, eticheta] of CAMPURI_GRUP) {
      const m = p.valori[camp]
      const valoare = m.size ? m.values().next().value : null
      if (camp === 'regim') p.observatii = [valoare ? `Regim juridic: ${valoare}` : null, ...p.note].filter(Boolean).join('; ') || null
      else p[camp] = valoare
      if (m.size > 1) contradictorii.push(`${eticheta}: ${[...m.keys()].map(v => `„${v}”`).join(' / ')}`)
    }
    p.cheie_sursa = cheieSursa(p.uat3, p.poz_hg, p.nr_cadastral, p.tarla)   // DUPĂ consolidare — independent de ordinea rândurilor
    if (!p.cheie_sursa) statistici.parcele_fara_cheie++
    if (!contradictorii.length) continue
    const detaliu = contradictorii.join('; ')
    // pct. 1 (04.11.2026): rândurile ambigue NU se mai pun și în erori — apar o singură dată, în `ambigue`
    p.ambigua = true; p.motiv_ambiguitate = MOTIV_CONTRADICTORIU; p.detaliu_ambiguitate = detaliu; statistici.parcele_ambigue++
  }
  // P1-1: coliziune între grupuri — același cheie_sursa consolidat pe Nr.Crt. diferite ⇒ ambele grupuri ambigue (nu se unesc, nu se comit)
  const grupuriDupaSursa = new Map()
  for (const p of parcele) if (p.cheie_sursa) { if (!grupuriDupaSursa.has(p.cheie_sursa)) grupuriDupaSursa.set(p.cheie_sursa, []); grupuriDupaSursa.get(p.cheie_sursa).push(p) }
  for (const [cheieS, grup] of grupuriDupaSursa) {
    if (grup.length < 2) continue
    for (const p of grup) {
      if (!p.ambigua) { p.ambigua = true; p.motiv_ambiguitate = MOTIV_AMBIGUU; statistici.parcele_ambigue++ }
      // deja contradictorie: motivul rămâne primul, coliziunea se adaugă la detaliu (un singur rând în ambigue, nu două)
      else if (p.motiv_ambiguitate !== MOTIV_AMBIGUU) p.detaliu_ambiguitate = `${p.detaliu_ambiguitate ? p.detaliu_ambiguitate + '; ' : ''}și ${MOTIV_AMBIGUU}`
    }
  }
  erori.sort((a, b) => (a.rand ?? -1) - (b.rand ?? -1))

  // rândurile care NU se vor comite: pe parcelă ambiguă (TOATE rândurile grupului, și dublurile de nume — P2-2) sau fără cheie_sursa
  const fara_cheie = []; const ambigue = []
  for (const p of parcele) {
    if (!p.ambigua) continue
    for (const rnd of p.randuri) ambigue.push({ ...rnd, uat: p.uat3, cheie_parcela: p.cheie, cheie_sursa: p.cheie_sursa, motiv: p.motiv_ambiguitate, ...(p.detaliu_ambiguitate ? { detaliu: p.detaliu_ambiguitate } : {}) })
    statUat(p.uat3).ambigue += p.randuri.length
  }
  // Jakarinos r1 P2-4: fără cheie = TOATE rândurile grupului (și dublurile de nume), ca la ambigue — nu doar deținătorii deduplicați
  for (const p of parcele) {
    if (p.ambigua || p.cheie_sursa) continue
    for (const rnd of p.randuri) fara_cheie.push({ ...rnd, uat: p.uat3, cheie_parcela: p.cheie })
    statUat(p.uat3).fara_cheie += p.randuri.length
  }
  // pct. 4 + Copilot r1 P2-03: cadastru suspect = marcaj pe rândul care conține valoarea, cu starea REALĂ a parcelei (nu „se importă” orbește)
  for (const c of suspecte) {
    const p = parcelaDupaCheie.get(c.cheie_parcela)
    const stare = p.ambigua ? 'parcela NU se importă (ambiguă)' : (!p.cheie_sursa ? 'parcela NU se importă (fără cheie)' : 'parcela se importă')
    cadastru_suspect.push({ rand: c.rand, uat: p.uat3, nr_crt: c.nr_crt, cheie_sursa: p.cheie_sursa, motiv: MOTIV_CADASTRU_SUSPECT, detaliu: `cadastru: „${c.valoare}”; ${stare}` })
  }
  for (const p of parcele) { delete p.valori; delete p.uat_text; delete p.note }   // structuri de lucru, nu fac parte din preview

  // P2-1 (r7): ce se va importa efectiv — eligibile = cu cheie_sursa, neambigue; deținătorii deduplicați ai lor; câte un contact per deținător
  const eligibile = new Set(parcele.filter(p => p.cheie_sursa && !p.ambigua).map(p => p.cheie))
  const detinatoriEligibili = detinatori.filter(d => eligibile.has(d.cheie_parcela))
  const cheiEligibile = new Set(detinatoriEligibili.map(d => d.cheie))
  statistici.parcele_de_importat = eligibile.size
  statistici.detinatori_de_importat = detinatoriEligibili.length
  statistici.contacte_de_importat = contacte.filter(c => cheiEligibile.has(c.cheie_detinator)).length

  statistici.parcele = parcele.length; statistici.detinatori = detinatori.length; statistici.contacte = contacte.length
  statistici.dubluri = dubluri.length; statistici.neidentificati = neidentificati.length; statistici.erori = erori.length
  statistici.fara_cheie = fara_cheie.length; statistici.ambigue = ambigue.length; statistici.cadastru_suspect = cadastru_suspect.length
  // rândurile DISTINCTE puse deoparte (erori + ambigue + fără cheie), fiecare numărat o singură dată (pct. 1)
  statistici.randuri_de_tratat = numarRanduriPuseDeoparte(randuriDeTratat({ erori, ambigue, fara_cheie }))   // L19: aceeași definiție ca în CSV / UI
  return { parcele, detinatori, contacte, dubluri, neidentificati, fara_cheie, ambigue, cadastru_suspect, erori, statistici, antet: { rand: antet.rand + 1, coloane: col } }
}

function loturi(arr, n = LOT) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

function verifica(rezultat, ce) {
  if (rezultat?.error) throw new Error(`${ce}: ${rezultat.error.message || JSON.stringify(rezultat.error)}`)
  return rezultat?.data ?? null
}

// Citire completă: `construieste()` întoarce query-ul (fără .range); se paginează cu .range(de_la, pana_la) până la o pagină incompletă.
async function citesteTot(construieste, ce, pagina) {
  const tot = []
  for (let de_la = 0; ; de_la += pagina) {
    const data = verifica(await construieste().range(de_la, de_la + pagina - 1), ce) || []
    tot.push(...data)
    if (data.length < pagina) break
  }
  return tot
}

// RPC-ul poate întoarce numărul direct, { start }, { primul } sau un rând într-un array.
function primulNumar(data) {
  let v = Array.isArray(data) ? data[0] : data
  if (v && typeof v === 'object') v = v.start ?? v.primul ?? v.p_start ?? Object.values(v)[0]
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw new Error(`${RPC_REZERVA_NUMERE} a întors un început invalid: ${JSON.stringify(data)}`)
  return n
}

/**
 * scrieImport(supabase, preview, { proiectId, versiune, sursa, fisierNume, onProgress, pagina, lotCitire })
 *  → { lotId, parceleNoi, parceleRefolosite, detinatoriNoi, detinatoriExistenti, contacteNoi, existente, fara_cheie, ambigue }
 * Ordinea: INSERT red_import_loturi (stare 'in_curs') → select parcele existente pe (proiect_id, cheie_sursa) [≤100 chei per .in(), .range() paginat]
 * → rezervare numere prin RPC per uat3 [dacă blocul ar depăși 9999 → eroare ÎNAINTE de orice INSERT] → INSERT parcele noi
 * (loturi de 200; după FIECARE lot UPDATE lot parcele_noi) → id-uri înapoi → deținătorii lipsă (select pe parcela_id + nume_normalizat,
 * sters_la null) → INSERT (după fiecare lot UPDATE detinatori_noi) → contactele lipsă (select pe detinator_id) → INSERT (după fiecare lot
 * UPDATE diferente.contacte_noi — tabela n-are coloana) → UPDATE lot 'finalizat'.
 * La eroare: UPDATE lot 'esuat' + eroare + contoarele scrise până atunci, apoi re-throw (e.lotId; dacă nici marcarea nu reușește:
 * e.lotNeinchis = true + mesaj extins).
 * NU se comit: parcelele fără cheie_sursa (`fara_cheie`) și cele ambigue (`ambigue`) — cu deținătorii lor; sunt raportate.
 * `existente` = id_parcela ale parcelelor refolosite. Reluarea aceluiași fișier completează doar ce lipsește.
 */
export async function scrieImport(supabase, preview, { proiectId, versiune, sursa = 'TGZ', fisierNume = null, onProgress, pagina = PAGINA, lotCitire = LOT_CITIRE } = {}) {
  if (!proiectId) throw new Error('scrieImport: proiectId lipsă')
  const progres = (etapa, facut, total) => { if (typeof onProgress === 'function') onProgress({ etapa, facut, total }) }
  const parceleToate = preview?.parcele ?? []
  const detinatoriToti = preview?.detinatori ?? []
  const contacteToate = preview?.contacte ?? []
  const versiuneLot = versiune ?? detinatoriToti[0]?.versiune_lista_tgz ?? 'necunoscuta'

  // P1-1 / P1-2: ce nu se comite
  const parceleSarite = new Set(parceleToate.filter(p => p.ambigua || !p.cheie_sursa).map(p => p.cheie))
  const parcele = parceleToate.filter(p => !parceleSarite.has(p.cheie))
  const parcelaPreview = d => parceleToate.find(p => p.cheie === d.cheie_parcela)
  const intrare = d => ({ rand: d.rand ?? null, nr_crt: d.nr_crt ?? null, nume: d.nume })
  // ambigue = TOATE rândurile grupurilor ambigue (din preview, inclusiv dublurile de nume — P2-2); fallback pe deținători pentru preview-uri vechi
  const ambigue = Array.isArray(preview?.ambigue)
    ? preview.ambigue.map(a => ({ rand: a.rand ?? null, nr_crt: a.nr_crt ?? null, nume: a.nume, ...(a.uat ? { uat: a.uat } : {}), ...(a.cheie_sursa ? { cheie_sursa: a.cheie_sursa } : {}), motiv: a.motiv ?? MOTIV_AMBIGUU, ...(a.detaliu ? { detaliu: a.detaliu } : {}) }))
    : detinatoriToti.filter(d => parcelaPreview(d)?.ambigua).map(d => ({ ...intrare(d), motiv: parcelaPreview(d).motiv_ambiguitate ?? MOTIV_AMBIGUU }))
  // Jakarinos r1 P2-4: din preview (TOATE rândurile grupului, ca la ambigue); fallback pe deținători pentru preview-uri vechi
  const fara_cheie = Array.isArray(preview?.fara_cheie)
    ? preview.fara_cheie.map(f => ({ rand: f.rand ?? null, nr_crt: f.nr_crt ?? null, nume: f.nume, ...(f.uat ? { uat: f.uat } : {}) }))
    : detinatoriToti.filter(d => { const p = parcelaPreview(d); return p && !p.ambigua && !p.cheie_sursa }).map(intrare)
  const nr_crt_punct = []   // Copilot r1 P2-01 — completat după citirea parcelelor existente
  const diferenteBaza = { erori: preview?.erori ?? [], fara_cheie, ambigue, ...(Array.isArray(preview?.cadastru_suspect) ? { cadastru_suspect: preview.cadastru_suspect } : {}) }
  // P2-1: contoarele scrise până acum — actualizate după FIECARE lot și păstrate la 'esuat'
  const scrise = { parcele_noi: 0, detinatori_noi: 0, contacte_noi: 0 }
  const valoriLot = () => ({ parcele_noi: scrise.parcele_noi, detinatori_noi: scrise.detinatori_noi, diferente: { ...diferenteBaza, contacte_noi: scrise.contacte_noi } })

  // 0. lotul, întâi, cu stare 'in_curs'
  const lot = verifica(await supabase.from('red_import_loturi').insert({
    proiect_id: proiectId, versiune_lista_tgz: versiuneLot, sursa, fisier_nume: fisierNume, stare: 'in_curs',
    randuri_total: preview?.statistici?.randuri_total ?? detinatoriToti.length,
    parcele_noi: 0, detinatori_noi: 0,
    dubluri: preview?.dubluri?.length ?? 0, neidentificati: preview?.neidentificati?.length ?? 0,
    diferente: { ...diferenteBaza, contacte_noi: 0 },   // red_import_loturi nu are coloana contacte_noi → stă în diferente (jsonb)
  }).select('id').single(), 'creare lot import')
  const lotId = lot?.id ?? null
  if (!lotId) throw new Error('creare lot import: nu am primit id-ul lotului')
  const actualizeazaLot = async (valori, ce) => verifica(await supabase.from('red_import_loturi').update(valori).eq('id', lotId), ce)

  try {
    // 1. parcele existente pe (proiect_id, cheie_sursa)
    const parcelaDupaCheie = new Map()   // cheie (preview) → { id, id_parcela, existenta }
    const existentaDupaSursa = new Map()
    for (const lotC of loturi([...new Set(parcele.map(p => p.cheie_sursa))], lotCitire)) {
      const data = await citesteTot(() => supabase.from('red_parcele').select('id, id_parcela, cheie_sursa').eq('proiect_id', proiectId).in('cheie_sursa', lotC), 'verificare parcele existente', pagina)
      for (const row of data) existentaDupaSursa.set(row.cheie_sursa, row)
    }
    // Copilot r1 P2-01: un grup cu Nr.Crt. „x.y” fără „/” a cărui identitate EXISTĂ deja în BD poate fi fost importat de regula veche ca x/y
    // (alt grup). Nu se refolosește tacit și nu se inserează: se oprește „de tratat” (cu deținătorii lui). Fals pozitiv posibil la reimportul
    // unui fișier importat deja cu regula nouă — sigur (nu scrie nimic), dar cere verificare manuală.
    const opritePunct = new Set()
    for (const p of parcele) {
      const row = existentaDupaSursa.get(p.cheie_sursa)
      if (!row) continue
      if (p.punct_fara_slash) {
        opritePunct.add(p.cheie)
        for (const r of (p.randuri || [{ rand: p.rand ?? null, nr_crt: String(p.nr_crt ?? '') }])) nr_crt_punct.push({ rand: r.rand ?? null, nr_crt: r.nr_crt ?? null, uat: p.uat3, cheie_sursa: p.cheie_sursa, motiv: MOTIV_NRCRT_PUNCT, detaliu: `parcela existentă ${row.id_parcela}` })
        continue
      }
      parcelaDupaCheie.set(p.cheie, { id: row.id, id_parcela: row.id_parcela, existenta: true })
    }
    if (nr_crt_punct.length) diferenteBaza.nr_crt_punct = nr_crt_punct
    const parceleNoi = parcele.filter(p => !parcelaDupaCheie.has(p.cheie) && !opritePunct.has(p.cheie))
    const parceleRefolosite = parcele.filter(p => parcelaDupaCheie.has(p.cheie))

    // 2. rezervare numere per uat3 + id_parcela final
    const grupuri = new Map()
    for (const p of parceleNoi) { const g = p.uat3; if (!grupuri.has(g)) grupuri.set(g, []); grupuri.get(g).push(p) }
    const randuriParcele = []
    for (const [, grup] of grupuri) {
      const { uat3 } = grup[0]
      const start = primulNumar(verifica(await supabase.rpc(RPC_REZERVA_NUMERE, { p_uat3: uat3, p_n: grup.length }), 'rezervare numere parcele'))
      // P2-8: formatul are fix 4 cifre — dacă blocul ar depăși 9999 ne oprim AICI, înainte de orice INSERT (lotul rămâne cu 0 scrieri)
      const ultim = start + grup.length - 1
      if (ultim > MAX_NUMAR_PARCELA) throw new Error(`Numerotarea parcelelor: UAT ${uat3} ar depăși ${MAX_NUMAR_PARCELA} (${grup.length} parcele noi de la ${start} → ${ultim}); nimic nu a fost scris`)
      grup.forEach((p, i) => randuriParcele.push({ p, id_parcela: idParcela(uat3, start + i) }))
    }

    // 3. INSERT parcele noi + id-uri înapoi
    let facut = 0
    for (const lotP of loturi(randuriParcele)) {
      const randuri = lotP.map(({ p, id_parcela }) => ({
        proiect_id: proiectId, uat_id: p.uat_id, id_parcela, cheie_sursa: p.cheie_sursa, tronson: p.tronson ?? null,
        sat: p.sat ?? null, tarla: p.tarla ?? null, nr_cadastral: p.nr_cadastral ?? null, poz_hg: p.poz_hg ?? null,
        suprafata_temporara_mp: p.suprafata_temporara_mp ?? null, categoria_folosinta: p.categoria_folosinta ?? null,
        observatii: p.observatii ?? null,
      }))
      verifica(await supabase.from('red_parcele').insert(randuri), 'inserare parcele')
      // P2-1: contorul crește imediat după INSERT-ul reușit, înainte de recitirea id-urilor (dacă recitirea pică, lotul esuat arată cifrele inserate)
      facut += lotP.length; scrise.parcele_noi = facut
      await actualizeazaLot({ parcele_noi: facut }, 'actualizare lot (parcele)')
      const idDupaIdParcela = new Map()
      for (const lotI of loturi(randuri.map(r => r.id_parcela), lotCitire)) {
        const data = await citesteTot(() => supabase.from('red_parcele').select('id, id_parcela').eq('proiect_id', proiectId).in('id_parcela', lotI), 'citire id parcele', pagina)
        for (const row of data) idDupaIdParcela.set(row.id_parcela, row.id)
      }
      for (const { p, id_parcela } of lotP) {
        const id = idDupaIdParcela.get(id_parcela)
        if (!id) throw new Error(`Parcela ${id_parcela} nu s-a regăsit după inserare`)
        parcelaDupaCheie.set(p.cheie, { id, id_parcela, existenta: false })
      }
      progres('parcele', facut, randuriParcele.length)
    }

    // 4. deținătorii: pe parcelele existente verificăm ce e deja scris, restul se inserează
    const uuidDetinator = new Map()      // cheie detinator (preview) → { id, existent }
    const idsParceleExistente = parceleRefolosite.map(p => parcelaDupaCheie.get(p.cheie).id)
    const existentiPeParcela = new Map()  // '<uuid parcela>|NUME' → uuid detinator
    for (const lotI of loturi(idsParceleExistente, lotCitire)) {
      const data = await citesteTot(() => supabase.from('red_detinatori').select('id, parcela_id, nume_normalizat').in('parcela_id', lotI).is('sters_la', null), 'citire deținători existenți', pagina)
      for (const row of data) existentiPeParcela.set(`${row.parcela_id}|${row.nume_normalizat}`, row.id)
    }
    const deInserat = []
    for (const d of detinatoriToti) {
      const p = parcelaDupaCheie.get(d.cheie_parcela)
      if (!p) continue   // parcelă sărită (fără cheie / ambiguă)
      const idExistent = existentiPeParcela.get(`${p.id}|${d.nume_normalizat}`)
      if (idExistent) uuidDetinator.set(d.cheie, { id: idExistent, existent: true })
      else deInserat.push(d)
    }
    facut = 0
    for (const lotD of loturi(deInserat)) {
      const randuri = lotD.map(d => ({
        parcela_id: parcelaDupaCheie.get(d.cheie_parcela).id, nume: d.nume, nume_normalizat: d.nume_normalizat, calitate: d.calitate,
        cota: d.cota ?? null, sursa_date: d.sursa_date ?? sursa, versiune_lista_tgz: d.versiune_lista_tgz ?? versiuneLot,
        decedat: d.decedat === true, act_doveditor_cunoscut: d.act_doveditor_cunoscut ?? null,
      }))
      verifica(await supabase.from('red_detinatori').insert(randuri), 'inserare deținători')
      facut += lotD.length; scrise.detinatori_noi = facut
      await actualizeazaLot({ detinatori_noi: facut }, 'actualizare lot (deținători)')
      const idDupaCheie = new Map()
      for (const lotI of loturi([...new Set(randuri.map(r => r.parcela_id))], lotCitire)) {
        const data = await citesteTot(() => supabase.from('red_detinatori').select('id, parcela_id, nume_normalizat').in('parcela_id', lotI).is('sters_la', null), 'citire id deținători', pagina)
        for (const row of data) idDupaCheie.set(`${row.parcela_id}|${row.nume_normalizat}`, row.id)
      }
      for (const d of lotD) {
        const id = idDupaCheie.get(`${parcelaDupaCheie.get(d.cheie_parcela).id}|${d.nume_normalizat}`)
        if (!id) throw new Error(`Deținătorul „${d.nume}” (${d.cheie_parcela}) nu s-a regăsit după inserare`)
        uuidDetinator.set(d.cheie, { id, existent: false })
      }
      progres('detinatori', facut, deInserat.length)
    }

    // 5. contactele: pentru deținătorii deja existenți verificăm dacă au contact; cei noi nu pot avea
    const idsDetExistenti = [...uuidDetinator.values()].filter(v => v.existent).map(v => v.id)
    const auContact = new Set()
    for (const lotI of loturi(idsDetExistenti, lotCitire)) {
      const data = await citesteTot(() => supabase.from('red_detinatori_contact').select('detinator_id').in('detinator_id', lotI), 'citire contacte existente', pagina)
      for (const row of data) auContact.add(row.detinator_id)
    }
    const contacteDeInserat = contacteToate.filter(c => { const v = uuidDetinator.get(c.cheie_detinator); return v && !auContact.has(v.id) })
    facut = 0
    for (const lotC of loturi(contacteDeInserat)) {
      const randuri = lotC.map(c => ({
        detinator_id: uuidDetinator.get(c.cheie_detinator).id,
        adresa_strada: c.adresa_strada ?? null, adresa_sat: c.adresa_sat ?? null, adresa_comuna: c.adresa_comuna ?? null,
        adresa_judet: c.adresa_judet ?? null, cod_postal: c.cod_postal ?? null, adresa_cunoscuta: c.adresa_cunoscuta !== false,
        telefon: c.telefon ?? null, email: c.email ?? null,
      }))
      verifica(await supabase.from('red_detinatori_contact').insert(randuri), 'inserare contacte')
      facut += lotC.length; scrise.contacte_noi = facut
      await actualizeazaLot({ diferente: { ...diferenteBaza, contacte_noi: facut } }, 'actualizare lot (contacte)')
      progres('contacte', facut, contacteDeInserat.length)
    }

    // 6. lotul: finalizat + cifre
    const existente = parceleRefolosite.map(p => parcelaDupaCheie.get(p.cheie).id_parcela)
    const detinatoriExistenti = [...uuidDetinator.values()].filter(v => v.existent).length
    await actualizeazaLot({
      stare: 'finalizat', eroare: null,
      parcele_noi: randuriParcele.length, detinatori_noi: deInserat.length,
      diferente: { ...diferenteBaza, contacte_noi: contacteDeInserat.length, existente, parcele_refolosite: parceleRefolosite.length, detinatori_existenti: detinatoriExistenti },
    }, 'finalizare lot import')
    progres('gata', 1, 1)

    return {
      lotId, parceleNoi: randuriParcele.length, parceleRefolosite: parceleRefolosite.length,
      detinatoriNoi: deInserat.length, detinatoriExistenti, contacteNoi: contacteDeInserat.length, existente, fara_cheie, ambigue, nr_crt_punct,
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    err.lotId = lotId
    try {
      await actualizeazaLot({ ...valoriLot(), stare: 'esuat', eroare: err.message }, 'marcare lot esuat')
    } catch (e2) {
      err.lotNeinchis = true
      err.message = `${err.message} — lotul ${lotId} a rămas „in_curs” (${e2?.message || e2})`
    }
    throw err
  }
}

// Rândurile care NU intră în import (erori + ambigue + fără cheie + Nr.Crt. „x.y” oprit), plus marcajul „cadastru suspect”, pentru tratarea manuală
// în Excel — FĂRĂ nume / adrese / contacte: doar rândul din fișier, UAT, Nr.Crt., cheia sursă (UAT|HG|cadastru|tarla), motivul și detaliul.
// Merge pe un preview SAU pe `diferente` dintr-un lot finalizat (aceleași chei: erori / ambigue / fara_cheie / nr_crt_punct / cadastru_suspect).
// pct. 1 + Copilot r1 P2-02/P2-03/P3-01: UN rând de CSV per rând Excel, cu TOATE diagnosticele lui reunite (contradicție + coliziune, eroare +
// cadastru suspect); loturile vechi aveau rândurile ambigue și în erori — acelea intră în categoria „ambiguă”, nu se dublează.
// Intrările fără număr de rând rămân separate (nu se contopesc după motiv). `informativ` = doar „cadastru suspect” (nu e pus deoparte).
const MOTIVE_AMBIGUE = new Set([MOTIV_AMBIGUU, MOTIV_CONTRADICTORIU])
const ORDINE_CATEGORII = ['ambiguă', 'fără cheie', 'Nr.Crt. „x.y”', 'eroare', 'cadastru suspect']
export function randuriDeTratat(preview) {
  const grupuri = new Map()
  let fara = 0
  const adauga = (categorie, r) => {
    const k = r.rand != null ? `r:${r.rand}` : `u:${fara++}`
    if (!grupuri.has(k)) grupuri.set(k, { rand: r.rand ?? null, categorii: new Set(), uat: '', nr_crt: '', cheie_sursa: '', motive: [], detalii: [] })
    const g = grupuri.get(k)
    g.categorii.add(categorie)
    if (!g.uat) g.uat = r.uat ?? (r.cheie_sursa ? String(r.cheie_sursa).split('|')[0] : '')
    if (!g.nr_crt && r.nr_crt != null) g.nr_crt = String(r.nr_crt)
    if (!g.cheie_sursa && r.cheie_sursa) g.cheie_sursa = r.cheie_sursa
    if (r.motiv && !g.motive.includes(r.motiv)) g.motive.push(r.motiv)
    if (r.detaliu && !g.detalii.includes(r.detaliu)) g.detalii.push(r.detaliu)
  }
  for (const e of preview?.erori || []) adauga(MOTIVE_AMBIGUE.has(e.motiv) ? 'ambiguă' : 'eroare', e)
  for (const a of preview?.ambigue || []) adauga('ambiguă', a)
  for (const f of preview?.fara_cheie || []) adauga('fără cheie', { ...f, motiv: 'fără poziție HG și fără nr. cadastral real' })
  for (const n of preview?.nr_crt_punct || []) adauga('Nr.Crt. „x.y”', n)
  for (const c of preview?.cadastru_suspect || []) adauga('cadastru suspect', c)
  const out = [...grupuri.values()].map(g => {
    const cat = ORDINE_CATEGORII.filter(c => g.categorii.has(c))
    return { rand: g.rand, categorie: cat.join(' + '), uat: g.uat || '', nr_crt: g.nr_crt, cheie_sursa: g.cheie_sursa, motiv: g.motive.join(' + '), detaliu: g.detalii.join(' | '), informativ: cat.length === 1 && cat[0] === 'cadastru suspect' }
  })
  return out.sort((a, b) => (a.rand ?? Infinity) - (b.rand ?? Infinity))
}

// Câte rânduri DISTINCTE NU au intrat în import („cadastru suspect” singur nu se numără — e doar marcaj). Fiecare intrare fără rând = una.
export function numarRanduriPuseDeoparte(randuri) {
  return randuri.filter(r => !r.informativ).length
}

export function csvRanduriDeTratat(randuri) {
  // Copilot r1 P2-01: valorile vin dintr-un fișier extern și CSV-ul se deschide în Excel → = + - @ (și tab/CR) la început se neutralizează cu apostrof
  // r2: și după spații / linii noi la început
  const q = v => { let t = String(v ?? ''); if (/^\s*[=+\-@]/.test(t) || /^[\t\r\n]/.test(t)) t = `'${t}`; return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
  const cap = ['Rând Excel', 'Categorie', 'UAT', 'Nr.Crt.', 'Cheie (UAT|HG|cadastru|tarla)', 'Motiv', 'Detaliu']
  return '\uFEFF' + [cap, ...randuri.map(r => [r.rand ?? '', r.categorie, r.uat, r.nr_crt, r.cheie_sursa, r.motiv, r.detaliu])].map(l => l.map(q).join(';')).join('\r\n')
}
