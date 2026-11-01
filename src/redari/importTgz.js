// Redări teren — importul Excel-ului TGZ („Raport Informatii Generale Terenuri”) → preview → scriere în BD.
// Contract: docs/redari/CONTRACT_SCHEMA.md §7. Modul pur (fără React); scrierea primește clientul supabase ca parametru.
// Felia asta face DOAR inserare: parcelele care există deja pe (proiect, id_parcela) sunt sărite și raportate ca „existente”
// (upsert-ul pentru Anexa 7 vine separat).

import * as XLSX from 'xlsx-js-style'
import { faraDiacritice, idParcela, normalizeazaNume } from './idParcela.js'

export const LOT = 200          // mărimea unui lot la INSERT / SELECT
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
 * parseazaTgz(arrayBuffer, { uats, tronsonPeUat, idStart, versiune, sursa })
 *  - uats: [{ id, nume, uat3 }] — UAT-urile proiectului (potrivire pe nume normalizat sau pe uat3)
 *  - tronsonPeUat: { HUS: 3, ... } — tronsonul dat manual per UAT (obligatoriu pentru UAT-urile din fișier)
 *  - idStart: { HUS: 1, ... } — PRIMUL număr liber pe (proiect, uat); implicit 1
 * → { parcele, detinatori, contacte, dubluri, neidentificati, erori, statistici }
 * Parcelele sunt cheiate intern pe (uat3, Nr.Crt. x); deținătorii poartă `cheie_parcela`, contactele `cheie_detinator`.
 */
export function parseazaTgz(arrayBuffer, { uats = [], tronsonPeUat = {}, idStart = {}, versiune = null, sursa = 'TGZ' } = {}) {
  const erori = []
  const gol = { parcele: [], detinatori: [], contacte: [], dubluri: [], neidentificati: [], erori }
  const statistici = { randuri_total: 0, randuri_goale: 0, parcele: 0, detinatori: 0, contacte: 0, dubluri: 0, neidentificati: 0, existente: 0, erori: 0, pe_uat: {} }

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
  const urmatorNr = {}
  for (const u of uats) if (u?.uat3) urmatorNr[u.uat3] = Number(idStart[u.uat3]) >= 1 ? Number(idStart[u.uat3]) : 1

  const parcele = []; const detinatori = []; const contacte = []; const dubluri = []; const neidentificati = []
  const parcelaDupaCheie = new Map()      // 'HUS:7' → parcela
  const detinatorDupaCheie = new Map()    // 'T3-HUS-0001|POPESCU ION' → detinator
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

    // parcela (prima apariție a lui x pe UAT îi dă atributele)
    const cheieParcela = `${uat.uat3}:${nrCrt.x}`
    let parcela = parcelaDupaCheie.get(cheieParcela)
    if (!parcela) {
      const regim = text(celula(r, col.regim))
      parcela = {
        cheie: cheieParcela,
        nr_crt: nrCrt.x,
        uat_id: uat.id ?? null,
        uat3: uat.uat3,
        id_parcela: idParcela(tronson, uat.uat3, urmatorNr[uat.uat3]++),
        tronson,
        poz_hg: text(celula(r, col.poz_hg)) || null,
        suprafata_temporara_mp: numar(celula(r, col.suprafata)),
        categoria_folosinta: text(celula(r, col.categorie)) || null,
        tarla: text(celula(r, col.tarla)) || null,
        nr_cadastral: text(celula(r, col.nr_cadastral)) || null,
        observatii: regim ? `Regim juridic: ${regim}` : null,
        rand: randExcel,
        nr_detinatori: 0,
      }
      parcelaDupaCheie.set(cheieParcela, parcela); parcele.push(parcela); s.parcele++
    }

    // deținătorul
    const numeNorm = normalizeazaNume(numeBrut)
    const esteNeidentificat = numeNorm.includes('NEIDENTIFICAT')
    const cheieDet = `${parcela.id_parcela}|${numeNorm}`
    if (detinatorDupaCheie.has(cheieDet)) {
      dubluri.push({ rand: randExcel, id_parcela: parcela.id_parcela, nume: numeBrut, nume_normalizat: numeNorm, rand_original: detinatorDupaCheie.get(cheieDet).rand })
      s.dubluri++; continue
    }
    const adresaBrut = text(celula(r, col.adresa))
    const det = {
      cheie: cheieDet,
      cheie_parcela: cheieParcela,
      id_parcela: parcela.id_parcela,
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
    if (esteNeidentificat) { neidentificati.push({ rand: randExcel, id_parcela: parcela.id_parcela, nume: numeBrut }); s.neidentificati++ }

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

  statistici.parcele = parcele.length; statistici.detinatori = detinatori.length; statistici.contacte = contacte.length
  statistici.dubluri = dubluri.length; statistici.neidentificati = neidentificati.length; statistici.erori = erori.length
  return { parcele, detinatori, contacte, dubluri, neidentificati, erori, statistici, antet: { rand: antet.rand + 1, coloane: col } }
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

/**
 * scrieImport(supabase, preview, { proiectId, versiune, sursa, fisierNume, onProgress })
 *  → { lotId, parceleNoi, detinatoriNoi, contacteNoi, existente }
 * Ordinea: select parcele existente → INSERT parcele (loturi de 200) → citește id-urile înapoi pe (proiect_id, id_parcela)
 * → INSERT detinatori → citește id-urile pe (parcela_id, nume_normalizat) → INSERT red_detinatori_contact → INSERT red_import_loturi.
 * Fără upsert: o parcelă deja existentă e sărită împreună cu deținătorii ei și raportată în `existente`.
 */
export async function scrieImport(supabase, preview, { proiectId, versiune, sursa = 'TGZ', fisierNume = null, onProgress } = {}) {
  if (!proiectId) throw new Error('scrieImport: proiectId lipsă')
  const progres = (etapa, facut, total) => { if (typeof onProgress === 'function') onProgress({ etapa, facut, total }) }
  const parcele = preview?.parcele ?? []
  const detinatoriToti = preview?.detinatori ?? []
  const contacteToate = preview?.contacte ?? []

  // 0. parcele existente pe (proiect, id_parcela)
  const existente = new Set()
  const idsParcele = parcele.map(p => p.id_parcela)
  for (const lot of loturi(idsParcele)) {
    const data = verifica(await supabase.from('red_parcele').select('id, id_parcela').eq('proiect_id', proiectId).in('id_parcela', lot), 'verificare parcele existente')
    for (const row of data || []) existente.add(row.id_parcela)
  }
  const parceleNoi = parcele.filter(p => !existente.has(p.id_parcela))
  const parceleSarite = new Set(parcele.filter(p => existente.has(p.id_parcela)).map(p => p.cheie))

  // 1. parcele
  const uuidParcela = new Map()   // id_parcela → uuid
  let facut = 0
  for (const lot of loturi(parceleNoi)) {
    const randuri = lot.map(p => ({
      proiect_id: proiectId, uat_id: p.uat_id, id_parcela: p.id_parcela, tronson: p.tronson,
      sat: p.sat ?? null, tarla: p.tarla ?? null, nr_cadastral: p.nr_cadastral ?? null, poz_hg: p.poz_hg ?? null,
      suprafata_temporara_mp: p.suprafata_temporara_mp ?? null, categoria_folosinta: p.categoria_folosinta ?? null,
      observatii: p.observatii ?? null,
    }))
    verifica(await supabase.from('red_parcele').insert(randuri), 'inserare parcele')
    const data = verifica(await supabase.from('red_parcele').select('id, id_parcela').eq('proiect_id', proiectId).in('id_parcela', lot.map(p => p.id_parcela)), 'citire id parcele')
    for (const row of data || []) uuidParcela.set(row.id_parcela, row.id)
    facut += lot.length; progres('parcele', facut, parceleNoi.length)
  }
  for (const p of parceleNoi) if (!uuidParcela.has(p.id_parcela)) throw new Error(`Parcela ${p.id_parcela} nu s-a regăsit după inserare`)

  // 2. detinatori
  const detinatori = detinatoriToti.filter(d => !parceleSarite.has(d.cheie_parcela) && uuidParcela.has(d.id_parcela))
  const uuidDetinator = new Map()  // cheie detinator → uuid
  facut = 0
  for (const lot of loturi(detinatori)) {
    const randuri = lot.map(d => ({
      parcela_id: uuidParcela.get(d.id_parcela), nume: d.nume, nume_normalizat: d.nume_normalizat, calitate: d.calitate,
      cota: d.cota ?? null, sursa_date: d.sursa_date ?? sursa, versiune_lista_tgz: d.versiune_lista_tgz ?? versiune ?? null,
    }))
    verifica(await supabase.from('red_detinatori').insert(randuri), 'inserare deținători')
    const idsP = [...new Set(randuri.map(r => r.parcela_id))]
    const data = verifica(await supabase.from('red_detinatori').select('id, parcela_id, nume_normalizat').in('parcela_id', idsP).is('sters_la', null), 'citire id deținători')
    const uuidPeParcela = new Map()
    for (const row of data || []) uuidPeParcela.set(`${row.parcela_id}|${row.nume_normalizat}`, row.id)
    for (const d of lot) {
      const id = uuidPeParcela.get(`${uuidParcela.get(d.id_parcela)}|${d.nume_normalizat}`)
      if (!id) throw new Error(`Deținătorul „${d.nume}” (${d.id_parcela}) nu s-a regăsit după inserare`)
      uuidDetinator.set(d.cheie, id)
    }
    facut += lot.length; progres('detinatori', facut, detinatori.length)
  }

  // 3. contact
  const contacte = contacteToate.filter(c => uuidDetinator.has(c.cheie_detinator))
  facut = 0
  for (const lot of loturi(contacte)) {
    const randuri = lot.map(c => ({
      detinator_id: uuidDetinator.get(c.cheie_detinator),
      adresa_strada: c.adresa_strada ?? null, adresa_sat: c.adresa_sat ?? null, adresa_comuna: c.adresa_comuna ?? null,
      adresa_judet: c.adresa_judet ?? null, cod_postal: c.cod_postal ?? null, adresa_cunoscuta: c.adresa_cunoscuta !== false,
      telefon: c.telefon ?? null, email: c.email ?? null,
    }))
    verifica(await supabase.from('red_detinatori_contact').insert(randuri), 'inserare contacte')
    facut += lot.length; progres('contacte', facut, contacte.length)
  }

  // 4. lotul de import
  const lot = verifica(await supabase.from('red_import_loturi').insert({
    proiect_id: proiectId, versiune_lista_tgz: versiune ?? preview?.detinatori?.[0]?.versiune_lista_tgz ?? 'necunoscuta', sursa, fisier_nume: fisierNume,
    randuri_total: preview?.statistici?.randuri_total ?? detinatoriToti.length,
    parcele_noi: parceleNoi.length, detinatori_noi: detinatori.length,
    dubluri: preview?.dubluri?.length ?? 0, neidentificati: preview?.neidentificati?.length ?? 0,
    diferente: { existente: [...existente], erori: preview?.erori ?? [] },
  }).select('id').single(), 'inserare lot import')
  progres('gata', 1, 1)

  return { lotId: lot?.id ?? null, parceleNoi: parceleNoi.length, detinatoriNoi: detinatori.length, contacteNoi: contacte.length, existente: [...existente] }
}
