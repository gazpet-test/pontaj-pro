// Redări teren — importul Excel-ului TGZ („Raport Informatii Generale Terenuri”) → preview → scriere în BD.
// Contract: docs/redari/CONTRACT_SCHEMA.md §7. Modul pur (fără React); scrierea primește clientul supabase ca parametru.
// Runda 2 (după review Jakarinos r1):
//  - identitatea stabilă a parcelei = `cheie_sursa` = {uat3}|{poz_hg}|{nr_cadastral}|{tarla} normalizată (null dacă toate trei lipsesc);
//    reimportul aceluiași fișier NU duplică parcelele — cele existente pe (proiect_id, cheie_sursa) se refolosesc;
//  - id-urile din preview sunt PROVIZORII (`T3-HUS-????`); numerele se rezervă la commit prin RPC `fn_red_rezerva_numere_parcele`;
//  - lotul red_import_loturi se creează ÎNTÂI cu stare 'in_curs', apoi 'finalizat' sau 'esuat' + eroare; reluarea după o eroare
//    la mijloc completează doar ce lipsește (parcele, deținători, contacte) și ajunge la aceeași stare finală.
// Upsert-ul de atribute (Anexa 7) NU e în felia asta: parcelele/deținătorii existenți nu se modifică.

import * as XLSX from 'xlsx-js-style'
import { faraDiacritice, idParcela, idParcelaProvizoriu, normalizeazaNume } from './idParcela.js'

export const LOT = 200          // mărimea unui lot la INSERT / SELECT
export const RPC_REZERVA_NUMERE = 'fn_red_rezerva_numere_parcele'
const MAX_RAND_ANTET = 30       // căutăm antetul în primele 30 de rânduri

// Cheie de potrivire pentru antet: fără diacritice, litere mici, doar [a-z0-9].
const cheie = s => faraDiacritice(s).toLowerCase().replace(/[^a-z0-9]/g, '')

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

const text = v => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())

function numar(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// „7/2” → { x: 7, y: 2 }; „12” sau 12 → { x: 12, y: null }; altfel null.
export function parseazaNrCrt(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? { x: v, y: null } : null
  const m = String(v).trim().match(/^(\d+)\s*(?:[\/\-.]\s*(\d+))?$/)
  if (!m) return null
  const x = Number(m[1]); const y = m[2] != null ? Number(m[2]) : null
  if (x <= 0 || (y != null && y <= 0)) return null
  return { x, y }
}

/**
 * cheieSursa(uat3, poz_hg, nr_cadastral, tarla) → 'HUS|HG 1|CF 1001|T12' (majuscule, fără diacritice, spații simple)
 * sau null dacă poz_hg, nr_cadastral și tarla lipsesc toate. Identitatea stabilă a parcelei între importuri.
 */
export function cheieSursa(uat3, poz_hg, nr_cadastral, tarla) {
  const p = normalizeazaNume(poz_hg); const c = normalizeazaNume(nr_cadastral); const t = normalizeazaNume(tarla)
  if (!p && !c && !t) return null
  return `${String(uat3 ?? '').toUpperCase()}|${p}|${c}|${t}`
}

// Adresa liberă → { adresa_strada, adresa_sat, adresa_comuna, adresa_judet } best-effort, fără să inventăm:
// segmentele separate prin virgulă cu prefix recunoscut (sat/com./jud./str.) se pun la locul lor; restul rămâne în adresa_strada.
export function imparteAdresa(adresa, judetColoana) {
  const r = { adresa_strada: null, adresa_sat: null, adresa_comuna: null, adresa_judet: text(judetColoana) || null }
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
    else if ((m = k.match(/^(?:jud(?:etul)?\.?)\s*\.?\s+(.+)$/))) { if (!r.adresa_judet) r.adresa_judet = seg.slice(seg.length - m[1].length).trim(); continue }
    rest.push(seg)
  }
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
 *  - tronsonPeUat: { HUS: 3, ... } — tronsonul dat manual per UAT (obligatoriu pentru UAT-urile din fișier)
 *  - idStart: IGNORAT (compatibilitate) — numerele se rezervă server-side la commit
 * → { parcele, detinatori, contacte, dubluri, neidentificati, unite, erori, statistici, antet }
 * Parcela e identificată prin `cheie_sursa` (uat3|poz_hg|nr_cadastral|tarla); fără cheie_sursa cade pe (uat3, Nr.Crt. x).
 * `id_parcela` din preview e PROVIZORIU ('T3-HUS-????'); `nr_provizoriu` = ordinea în UAT. Deținătorii poartă `cheie_parcela`,
 * contactele `cheie_detinator`.
 */
export function parseazaTgz(arrayBuffer, { uats = [], tronsonPeUat = {}, versiune = null, sursa = 'TGZ' } = {}) {
  const erori = []
  const gol = { parcele: [], detinatori: [], contacte: [], dubluri: [], neidentificati: [], unite: [], erori }
  const statistici = { randuri_total: 0, randuri_goale: 0, parcele: 0, parcele_fara_cheie: 0, unite: 0, detinatori: 0, contacte: 0, dubluri: 0, neidentificati: 0, erori: 0, pe_uat: {} }

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

  const parcele = []; const detinatori = []; const contacte = []; const dubluri = []; const neidentificati = []; const unite = []
  const parcelaDupaCheie = new Map()      // cheie_sursa sau 'HUS:7' → parcela
  const parcelaDupaNrCrt = new Map()      // 'HUS:7' → parcela (rândurile x/2 ajung la parcela lui x/1 chiar dacă au cheia diferită)
  const detinatorDupaCheie = new Map()    // '<cheie_parcela>|POPESCU ION' → detinator
  const statUat = uat3 => (statistici.pe_uat[uat3] ??= { parcele: 0, detinatori: 0, dubluri: 0, neidentificati: 0, erori: 0 })

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
    const tronson = Number(tronsonPeUat[uat.uat3])
    if (!Number.isInteger(tronson) || tronson < 1 || tronson > 11) {
      erori.push({ rand: randExcel, motiv: `Tronson lipsă sau invalid pentru UAT ${uat.uat3}`, uat: uatBrut, nume: numeBrut }); s.erori++; continue
    }

    // parcela: întâi după Nr.Crt. x (rândurile x/y), apoi după cheie_sursa (același teren sub alt Nr.Crt. → se unește)
    const cheieNrCrt = `${uat.uat3}:${nrCrt.x}`
    const pozHg = text(celula(r, col.poz_hg)) || null
    const nrCad = text(celula(r, col.nr_cadastral)) || null
    const tarla = text(celula(r, col.tarla)) || null
    const cheieS = cheieSursa(uat.uat3, pozHg, nrCad, tarla)
    let parcela = parcelaDupaNrCrt.get(cheieNrCrt)
    if (!parcela && cheieS && parcelaDupaCheie.has(cheieS)) {
      parcela = parcelaDupaCheie.get(cheieS)
      unite.push({ rand: randExcel, nr_crt: nrCrt.x, cu_nr_crt: parcela.nr_crt, cheie_sursa: cheieS })
      parcelaDupaNrCrt.set(cheieNrCrt, parcela)
    }
    if (!parcela) {
      const regim = text(celula(r, col.regim))
      nrProvizoriu[uat.uat3] = (nrProvizoriu[uat.uat3] ?? 0) + 1
      parcela = {
        cheie: cheieS ?? cheieNrCrt,
        cheie_sursa: cheieS,
        nr_crt: nrCrt.x,
        uat_id: uat.id ?? null,
        uat3: uat.uat3,
        id_parcela: idParcelaProvizoriu(tronson, uat.uat3),
        nr_provizoriu: nrProvizoriu[uat.uat3],
        tronson,
        poz_hg: pozHg,
        suprafata_temporara_mp: numar(celula(r, col.suprafata)),
        categoria_folosinta: text(celula(r, col.categorie)) || null,
        tarla,
        nr_cadastral: nrCad,
        observatii: regim ? `Regim juridic: ${regim}` : null,
        rand: randExcel,
        nr_detinatori: 0,
      }
      parcelaDupaCheie.set(parcela.cheie, parcela); parcelaDupaNrCrt.set(cheieNrCrt, parcela); parcele.push(parcela); s.parcele++
      if (!cheieS) statistici.parcele_fara_cheie++
    }

    // deținătorul
    const numeNorm = normalizeazaNume(numeBrut)
    const esteNeidentificat = numeNorm.includes('NEIDENTIFICAT')
    const cheieDet = `${parcela.cheie}|${numeNorm}`
    if (detinatorDupaCheie.has(cheieDet)) {
      dubluri.push({ rand: randExcel, cheie_parcela: parcela.cheie, nr_crt: parcela.nr_crt, nume: numeBrut, nume_normalizat: numeNorm, rand_original: detinatorDupaCheie.get(cheieDet).rand })
      s.dubluri++; continue
    }
    const adresaBrut = text(celula(r, col.adresa))
    const det = {
      cheie: cheieDet,
      cheie_parcela: parcela.cheie,
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
    if (esteNeidentificat) { neidentificati.push({ rand: randExcel, cheie_parcela: parcela.cheie, nr_crt: parcela.nr_crt, nume: numeBrut }); s.neidentificati++ }

    const adresa = imparteAdresa(adresaBrut, celula(r, col.judet))
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

  statistici.parcele = parcele.length; statistici.unite = unite.length; statistici.detinatori = detinatori.length; statistici.contacte = contacte.length
  statistici.dubluri = dubluri.length; statistici.neidentificati = neidentificati.length; statistici.erori = erori.length
  return { parcele, detinatori, contacte, dubluri, neidentificati, unite, erori, statistici, antet: { rand: antet.rand + 1, coloane: col } }
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

// RPC-ul poate întoarce numărul direct, { start }, { primul } sau un rând într-un array.
function primulNumar(data) {
  let v = Array.isArray(data) ? data[0] : data
  if (v && typeof v === 'object') v = v.start ?? v.primul ?? v.p_start ?? Object.values(v)[0]
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw new Error(`${RPC_REZERVA_NUMERE} a întors un început invalid: ${JSON.stringify(data)}`)
  return n
}

/**
 * scrieImport(supabase, preview, { proiectId, versiune, sursa, fisierNume, onProgress })
 *  → { lotId, parceleNoi, parceleRefolosite, detinatoriNoi, detinatoriExistenti, contacteNoi, existente }
 * Ordinea: INSERT red_import_loturi (stare 'in_curs') → select parcele existente pe (proiect_id, cheie_sursa) → rezervare numere prin
 * RPC per (uat3, tronson) → INSERT parcele noi (loturi de 200) → id-uri înapoi pe (proiect_id, id_parcela) → deținătorii lipsă
 * (select pe parcela_id + nume_normalizat, sters_la null) → INSERT → id-uri înapoi → contactele lipsă (select pe detinator_id) → INSERT
 * → UPDATE lot 'finalizat' + cifre. La eroare: UPDATE lot 'esuat' + eroare, apoi re-throw. Reluarea aceluiași fișier completează doar ce lipsește.
 * `existente` = id_parcela ale parcelelor refolosite. Parcelele fără cheie_sursa nu pot fi recunoscute → mereu noi (`fara_cheie` în diferente).
 */
export async function scrieImport(supabase, preview, { proiectId, versiune, sursa = 'TGZ', fisierNume = null, onProgress } = {}) {
  if (!proiectId) throw new Error('scrieImport: proiectId lipsă')
  const progres = (etapa, facut, total) => { if (typeof onProgress === 'function') onProgress({ etapa, facut, total }) }
  const parcele = preview?.parcele ?? []
  const detinatoriToti = preview?.detinatori ?? []
  const contacteToate = preview?.contacte ?? []
  const versiuneLot = versiune ?? detinatoriToti[0]?.versiune_lista_tgz ?? 'necunoscuta'

  // 0. lotul, întâi, cu stare 'in_curs'
  const lot = verifica(await supabase.from('red_import_loturi').insert({
    proiect_id: proiectId, versiune_lista_tgz: versiuneLot, sursa, fisier_nume: fisierNume, stare: 'in_curs',
    randuri_total: preview?.statistici?.randuri_total ?? detinatoriToti.length,
    parcele_noi: 0, detinatori_noi: 0,
    dubluri: preview?.dubluri?.length ?? 0, neidentificati: preview?.neidentificati?.length ?? 0,
    diferente: { erori: preview?.erori ?? [], unite: preview?.unite ?? [] },
  }).select('id').single(), 'creare lot import')
  const lotId = lot?.id ?? null
  if (!lotId) throw new Error('creare lot import: nu am primit id-ul lotului')

  try {
    // 1. parcele existente pe (proiect_id, cheie_sursa)
    const parcelaDupaCheie = new Map()   // cheie (preview) → { id, id_parcela, existenta }
    const cuCheie = parcele.filter(p => p.cheie_sursa)
    for (const lotC of loturi([...new Set(cuCheie.map(p => p.cheie_sursa))])) {
      const data = verifica(await supabase.from('red_parcele').select('id, id_parcela, cheie_sursa').eq('proiect_id', proiectId).in('cheie_sursa', lotC), 'verificare parcele existente')
      for (const row of data || []) parcelaDupaCheie.set(row.cheie_sursa, { id: row.id, id_parcela: row.id_parcela, existenta: true })
    }
    const parceleNoi = parcele.filter(p => !parcelaDupaCheie.has(p.cheie))
    const parceleRefolosite = parcele.filter(p => parcelaDupaCheie.has(p.cheie))

    // 2. rezervare numere per (uat3, tronson) + id_parcela final
    const grupuri = new Map()
    for (const p of parceleNoi) { const g = `${p.uat3}|${p.tronson}`; if (!grupuri.has(g)) grupuri.set(g, []); grupuri.get(g).push(p) }
    const randuriParcele = []
    for (const [, grup] of grupuri) {
      const { uat3, tronson } = grup[0]
      const start = primulNumar(verifica(await supabase.rpc(RPC_REZERVA_NUMERE, { p_uat3: uat3, p_tronson: tronson, p_n: grup.length }), 'rezervare numere parcele'))
      grup.forEach((p, i) => randuriParcele.push({ p, id_parcela: idParcela(tronson, uat3, start + i) }))
    }

    // 3. INSERT parcele noi + id-uri înapoi
    let facut = 0
    for (const lotP of loturi(randuriParcele)) {
      const randuri = lotP.map(({ p, id_parcela }) => ({
        proiect_id: proiectId, uat_id: p.uat_id, id_parcela, cheie_sursa: p.cheie_sursa, tronson: p.tronson,
        sat: p.sat ?? null, tarla: p.tarla ?? null, nr_cadastral: p.nr_cadastral ?? null, poz_hg: p.poz_hg ?? null,
        suprafata_temporara_mp: p.suprafata_temporara_mp ?? null, categoria_folosinta: p.categoria_folosinta ?? null,
        observatii: p.observatii ?? null,
      }))
      verifica(await supabase.from('red_parcele').insert(randuri), 'inserare parcele')
      const data = verifica(await supabase.from('red_parcele').select('id, id_parcela').eq('proiect_id', proiectId).in('id_parcela', randuri.map(r => r.id_parcela)), 'citire id parcele')
      const idDupaIdParcela = new Map((data || []).map(row => [row.id_parcela, row.id]))
      for (const { p, id_parcela } of lotP) {
        const id = idDupaIdParcela.get(id_parcela)
        if (!id) throw new Error(`Parcela ${id_parcela} nu s-a regăsit după inserare`)
        parcelaDupaCheie.set(p.cheie, { id, id_parcela, existenta: false })
      }
      facut += lotP.length; progres('parcele', facut, randuriParcele.length)
    }

    // 4. deținătorii: pe parcelele existente verificăm ce e deja scris, restul se inserează
    const uuidDetinator = new Map()      // cheie detinator (preview) → { id, existent }
    const idsParceleExistente = parceleRefolosite.map(p => parcelaDupaCheie.get(p.cheie).id)
    const existentiPeParcela = new Map()  // '<uuid parcela>|NUME' → uuid detinator
    for (const lotI of loturi(idsParceleExistente)) {
      const data = verifica(await supabase.from('red_detinatori').select('id, parcela_id, nume_normalizat').in('parcela_id', lotI).is('sters_la', null), 'citire deținători existenți')
      for (const row of data || []) existentiPeParcela.set(`${row.parcela_id}|${row.nume_normalizat}`, row.id)
    }
    const deInserat = []
    for (const d of detinatoriToti) {
      const p = parcelaDupaCheie.get(d.cheie_parcela)
      if (!p) continue   // parcela n-a trecut (nu ar trebui să se întâmple: preview-ul nu are deținători fără parcelă)
      const idExistent = existentiPeParcela.get(`${p.id}|${d.nume_normalizat}`)
      if (idExistent) uuidDetinator.set(d.cheie, { id: idExistent, existent: true })
      else deInserat.push(d)
    }
    facut = 0
    for (const lotD of loturi(deInserat)) {
      const randuri = lotD.map(d => ({
        parcela_id: parcelaDupaCheie.get(d.cheie_parcela).id, nume: d.nume, nume_normalizat: d.nume_normalizat, calitate: d.calitate,
        cota: d.cota ?? null, sursa_date: d.sursa_date ?? sursa, versiune_lista_tgz: d.versiune_lista_tgz ?? versiuneLot,
      }))
      verifica(await supabase.from('red_detinatori').insert(randuri), 'inserare deținători')
      const idsP = [...new Set(randuri.map(r => r.parcela_id))]
      const data = verifica(await supabase.from('red_detinatori').select('id, parcela_id, nume_normalizat').in('parcela_id', idsP).is('sters_la', null), 'citire id deținători')
      const idDupaCheie = new Map((data || []).map(row => [`${row.parcela_id}|${row.nume_normalizat}`, row.id]))
      for (const d of lotD) {
        const id = idDupaCheie.get(`${parcelaDupaCheie.get(d.cheie_parcela).id}|${d.nume_normalizat}`)
        if (!id) throw new Error(`Deținătorul „${d.nume}” (${d.cheie_parcela}) nu s-a regăsit după inserare`)
        uuidDetinator.set(d.cheie, { id, existent: false })
      }
      facut += lotD.length; progres('detinatori', facut, deInserat.length)
    }

    // 5. contactele: pentru deținătorii deja existenți verificăm dacă au contact; cei noi nu pot avea
    const idsDetExistenti = [...uuidDetinator.values()].filter(v => v.existent).map(v => v.id)
    const auContact = new Set()
    for (const lotI of loturi(idsDetExistenti)) {
      const data = verifica(await supabase.from('red_detinatori_contact').select('detinator_id').in('detinator_id', lotI), 'citire contacte existente')
      for (const row of data || []) auContact.add(row.detinator_id)
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
      facut += lotC.length; progres('contacte', facut, contacteDeInserat.length)
    }

    // 6. lotul: finalizat + cifre
    const existente = parceleRefolosite.map(p => parcelaDupaCheie.get(p.cheie).id_parcela)
    const detinatoriExistenti = [...uuidDetinator.values()].filter(v => v.existent).length
    verifica(await supabase.from('red_import_loturi').update({
      stare: 'finalizat', eroare: null,
      parcele_noi: randuriParcele.length, detinatori_noi: deInserat.length,
      diferente: {
        erori: preview?.erori ?? [], unite: preview?.unite ?? [], existente,
        parcele_refolosite: parceleRefolosite.length, detinatori_existenti: detinatoriExistenti,
        contacte_noi: contacteDeInserat.length, fara_cheie: parcele.filter(p => !p.cheie_sursa).length,
      },
    }).eq('id', lotId), 'finalizare lot import')
    progres('gata', 1, 1)

    return {
      lotId, parceleNoi: randuriParcele.length, parceleRefolosite: parceleRefolosite.length,
      detinatoriNoi: deInserat.length, detinatoriExistenti, contacteNoi: contacteDeInserat.length, existente,
    }
  } catch (e) {
    const mesaj = e?.message || String(e)
    try { await supabase.from('red_import_loturi').update({ stare: 'esuat', eroare: mesaj }).eq('id', lotId) } catch { /* eroarea originală e cea raportată */ }
    e.lotId = lotId
    throw e
  }
}
