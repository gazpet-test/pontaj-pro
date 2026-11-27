// ════════════════════════════════════════════════════════════════════════
// IZOMETRIE — „Export IZO înainte de lansare”: citirea fotografiei + exportul (ZIP, Storage, înregistrare)
// ════════════════════════════════════════════════════════════════════════
// Contractul BD: supabase/migrations/20270114a_izometrie_buletine_ndt.sql (fn_sud_drept, fn_sud_export_deblocheaza,
// fn_sud_export_inregistreaza). Clientul nu scrie nimic în arhiva de buletine; doar citește (RLS) și cheamă cele două funcții.
// Logica pură: src/lib/izoExportIzo.js + src/lib/izoNdt.js.

import JSZip from 'jszip'
import { paginareKeyset } from './hrDeciziiUtil.js'
import { TIP_EXPORT_IZO, numeExportIzo, planBuletineZip, amprentaPachet, amprentaRanduri, diferentePachet } from './lib/izoExportIzo.js'

const BUCKET_NDT = 'izo-ndt'
const BUCKET_PACHETE = 'executie-pachete-pdf'
const BUCATA_IN = 100   // id-uri pe bucăți în .in() (URL scurt)
// Bucket-ul executie-pachete-pdf (producție, 27.11.2026): file_size_limit 50 MB; tipurile permise NU includ application/zip
// (doar pdf, xlsx, xls, dwg/dxf, application/octet-stream, jpeg, png) → ZIP-ul urcă drept octet-stream, cu numele .zip.
export const LIMITA_FISIER_STORAGE = 50 * 1024 * 1024   // 52.428.800 octeți
export const MIME_ZIP_STORAGE = 'application/octet-stream'
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MIME_PDF = 'application/pdf'
const mb = n => (n / 1024 / 1024).toFixed(1).replace('.', ',')

const mesaj = e => (e && (e.message || e.error_description)) || String(e)
const bucati = (l, n) => { const o = []; for (let i = 0; i < l.length; i += n) o.push(l.slice(i, i + n)); return o }

/** fn_sud_drept(proiect, nivel) → true / false; eroare → null (necunoscut ≠ fals, L18). */
async function drept(sb, proiectId, nivel) {
  try {
    const { data, error } = await sb.rpc('fn_sud_drept', { p_proiect: proiectId, p_nivel: nivel })
    if (error) return null
    return data === true ? true : data === false ? false : null
  } catch { return null }
}

/**
 * Fotografia surselor exportului, citită O DATĂ (R6): buletinele confirmate ale tronsonului, rândurile lor, sudurile
 * eliminate active, metodele obligatorii ale proiectului, dreptul, pachetul anterior de pe tronson și ultimul export izo.
 * Toate listele = keyset până la pagina goală (plafonul de 1000 rânduri, L23). O eroare pe o sursă obligatorie = ok:false.
 * @returns {Promise<{ok:boolean, eroare?:string, buletine, randuri, eliminate, metode:string[]|null, drept, pachetAnterior,
 *   eroareAnterior?:string, ultimExport:object|null, eroareUltimExport?:string}>}
 */
export async function citesteArhivaNdt(sb, { proiectId, tronsonId, pachetId, kmStart }) {
  const dr = { citire: await drept(sb, proiectId, 'citire'), scriere: await drept(sb, proiectId, 'scriere'), export: await drept(sb, proiectId, 'export') }
  const baza = { drept: dr, buletine: [], randuri: [], eliminate: [], metode: null, pachetAnterior: null, ultimExport: null }
  if (dr.citire === false) return { ...baza, ok: false, eroare: 'nu ai drept de citire pe arhiva de buletine a proiectului' }
  if (dr.citire !== true) return { ...baza, ok: false, eroare: 'dreptul de citire pe arhiva de buletine nu s-a putut verifica' }
  try {
    const buletine = await paginareKeyset((ultim, pas) => {
      let q = sb.from('sud_buletine')
        .select('id, versiune, proiect_id, tronson_id, metoda, numar, data_buletin, fisier_path, fisier_nume, fisier_sha256, stare')
        .eq('tronson_id', tronsonId).eq('stare', 'confirmat')
      if (ultim != null) q = q.gt('id', ultim)
      return q.order('id').limit(pas)
    })
    for (const b of buletine) {
      if (String(b.tronson_id) !== String(tronsonId) || b.stare !== 'confirmat') throw new Error(`buletinul ${b.id} nu e confirmat pe acest tronson`)
    }
    const randuri = []
    for (const ids of bucati(buletine.map(b => b.id), BUCATA_IN)) {
      randuri.push(...await paginareKeyset((ultim, pas) => {
        let q = sb.from('sud_buletin_randuri')
          .select('id, buletin_id, ordine, cod_raw, stare_cod, tronson_nr, nr, sufix, refacuta, rezultat, data_inspectie')
          .in('buletin_id', ids)
        if (ultim != null) q = q.gt('id', ultim)
        return q.order('id').limit(pas)
      }))
    }
    const eliminate = await paginareKeyset((ultim, pas) => {
      let q = sb.from('sud_suduri_eliminate').select('id, cheie').eq('tronson_id', tronsonId).eq('activ', true)
      if (ultim != null) q = q.gt('id', ultim)
      return q.order('id').limit(pas)
    })
    const m = await sb.from('sud_metode_proiect').select('metode').eq('proiect_id', proiectId).maybeSingle()
    if (m.error) throw m.error
    const metode = m.data ? (Array.isArray(m.data.metode) ? m.data.metode : (() => { throw new Error('metodele proiectului au alt format') })()) : null

    const out = { ...baza, ok: true, buletine, randuri, eliminate, metode }
    // pachetul anterior: cel mai apropiat km start mai mic, pe același tronson (filtrat pe server înainte de limit, L23)
    if (kmStart !== null && kmStart !== undefined && Number.isFinite(Number(kmStart))) {
      const a = await sb.from('executie_pachete_lansare').select('id, km_start_m, total_lungime_m, cod_document_full')
        .eq('tronson_id', tronsonId).neq('id', pachetId).lt('km_start_m', kmStart)
        .order('km_start_m', { ascending: false }).order('id', { ascending: false }).limit(1)
      if (a.error) out.eroareAnterior = mesaj(a.error)
      else out.pachetAnterior = a.data?.[0] || null
    }
    const u = await citesteUltimExport(sb, pachetId)
    if (u.eroare) out.eroareUltimExport = u.eroare
    else out.ultimExport = u.data
    return out
  } catch (e) {
    return { ...baza, ok: false, eroare: mesaj(e) }
  }
}

/** Ultimul export izo înregistrat pe pachet (sud_exporturi), sau null. */
export async function citesteUltimExport(sb, pachetId) {
  const { data, error } = await sb.from('sud_exporturi').select('id, fotografie, incomplet, creat_la')
    .eq('pachet_id', pachetId).eq('tip', TIP_EXPORT_IZO)
    .order('creat_la', { ascending: false }).order('id', { ascending: false }).limit(1)
  if (error) return { eroare: mesaj(error) }
  return { data: data?.[0] || null }
}

/**
 * Recitește pachetul + TOATE rândurile lui din BD și le compară cu amprenta din fotografie (Jakarinos #1219 r1 P1).
 * Serverul nu verifică pachetul la înregistrare, deci verificarea e aici, chemată imediat înainte de generare și din nou
 * înainte de fn_sud_export_inregistreaza. Citire eșuată = eroare (necunoscut), nu „neschimbat” (L18).
 * @returns {Promise<{ok:true} | {ok:false, eroare:string, surseSchimbate?:true, pachetSchimbat?:true, dif?:string[]}>}
 */
export async function verificaPachetNeschimbat(sb, fotografie) {
  const id = fotografie?.pachet?.id
  if (!fotografie?.pachet || !fotografie?.randuri) return { ok: false, eroare: 'Fotografia nu are amprenta pachetului: redeschide fereastra.' }
  try {
    const p = await sb.from('executie_pachete_lansare').select('*').eq('id', id).maybeSingle()
    if (p.error) throw p.error
    if (!p.data) return { ok: false, surseSchimbate: true, pachetSchimbat: true, eroare: 'Pachetul nu mai există — închide fereastra.' }
    const tevi = await paginareKeyset((ultim, pas) => {
      let q = sb.from('executie_tevi').select('*').eq('pachet_id', id)
      if (ultim != null) q = q.gt('id', ultim)
      return q.order('id').limit(pas)
    })
    for (const r of tevi) if (String(r.pachet_id) !== String(id)) throw new Error(`rândul ${r.id} nu e din pachetul ${id}`)
    const dif = diferentePachet(fotografie, { pachet: amprentaPachet(p.data), randuri: amprentaRanduri(tevi) }, 'de la deschiderea ferestrei')
    if (dif.length) return { ok: false, surseSchimbate: true, pachetSchimbat: true, dif, eroare: `Pachetul s-a schimbat — redeschide fereastra. ${dif.join(' ')}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, eroare: `Pachetul nu s-a putut reciti (${mesaj(e)}): exportul s-a oprit, reîncearcă.` }
  }
}

async function sha256Hex(bytes) {
  const h = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('')
}

/** PDF-ul unui buletin, prin signed URL din izo-ndt; amprenta trebuie să fie cea din arhivă (identitatea = SHA-256, L16). */
export async function descarcaPdfBuletin(sb, b, fetchImpl = globalThis.fetch) {
  const { data, error } = await sb.storage.from(BUCKET_NDT).createSignedUrl(b.fisier_path, 120)
  if (error || !data?.signedUrl) throw new Error(`PDF-ul buletinului ${b.metoda} ${b.numar}: ${error ? mesaj(error) : 'fără link'}`)
  const r = await fetchImpl(data.signedUrl)
  if (!r.ok) throw new Error(`PDF-ul buletinului ${b.metoda} ${b.numar}: descărcare eșuată (${r.status})`)
  const bytes = new Uint8Array(await r.arrayBuffer())
  if (await sha256Hex(bytes) !== b.fisier_sha256) throw new Error(`PDF-ul buletinului ${b.metoda} ${b.numar} nu mai e cel din arhivă (amprentă diferită)`)
  return bytes
}

/** Arhiva ZIP: Excel-ul la rădăcină + câte un PDF pe buletin distinct (planul are deja numele unice). */
export async function construiesteZip({ numeXlsx, xlsx, pdfuri }) {
  const zip = new JSZip()
  zip.file(numeXlsx, xlsx)
  const vazute = new Set()
  for (const { fisierZip, bytes } of pdfuri) {
    if (vazute.has(fisierZip.toLowerCase())) throw new Error(`fișier dublat în ZIP: ${fisierZip}`)
    vazute.add(fisierZip.toLowerCase())
    zip.file(fisierZip, bytes)
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

// eroare definitivă (refuz de reguli, nu rețea): 4xx PostgREST / SQLSTATE din funcție
const definitiva = e => !!e && (/^(?:22|23|40|42|55|P0|PGRST)/.test(String(e.code || '')) || (Number(e.status) >= 400 && Number(e.status) < 500))

/**
 * Exportul: PDF-uri → pachetul recitit → Excel → ZIP → (deblocare) → Storage → pachetul recitit → fn_sud_export_inregistreaza
 * → rândul în istoric. Generarea folosește EXACT evaluarea (fotografia) din fereastră. Nu se descarcă local nimic neînregistrat.
 * ZIP peste limita bucket-ului: pe server Excel-ul + fiecare PDF separat (același dosar), înregistrate cu lista fișierelor;
 * ZIP-ul întreg se descarcă local (separat: true).
 * @param {object} p
 * @param {Function} p.genereazaXlsx  generateCentralizatorXlsx
 * @param {number} [p.limita]  limita de mărime a unui fișier în Storage (implicit 50 MB; testele o micșorează)
 * @returns {Promise<{ok:true, bytes, nume, storagePath, fisiere:string[], separat:boolean, exportId, avertisment?:string}
 *   | {ok:false, eroare:string, surseSchimbate?:boolean, pachetSchimbat?:boolean}>}
 */
export async function executaExportIzo(sb, { pachet, tronson, proiect, tevi, evaluare, arhiva, incomplet, motiv, genereazaXlsx, fetchImpl, acum = new Date(), uniq, limita = LIMITA_FISIER_STORAGE }) {
  const fotografie = evaluare?.fotografie
  if (!fotografie) return { ok: false, eroare: 'Fotografia surselor lipsește: redeschide fereastra.' }
  if (evaluare.verificare.blocaje.length) return { ok: false, eroare: 'Exportul are blocaje fără deblocare.' }
  if (!incomplet && fotografie.lipsuri_blocante.length) return { ok: false, eroare: 'Exportul are lipsuri: e nevoie de deblocarea managerului de proiect.' }
  if (incomplet && !fotografie.lipsuri_blocante.length) return { ok: false, eroare: 'Nu există lipsuri de deblocat.' }
  // copia trimisă la generare = cea din care s-a făcut fotografia (altfel Excel-ul n-ar corespunde verificării)
  if (diferentePachet(fotografie, { pachet: amprentaPachet(pachet), randuri: amprentaRanduri(tevi) }).length) {
    return { ok: false, surseSchimbate: true, eroare: 'Copia pachetului nu corespunde verificării: redeschide fereastra.' }
  }

  // 1. buletinele folosite + PDF-urile lor (înainte de orice scriere: o descărcare eșuată nu lasă nimic în urmă)
  let plan
  try {
    plan = planBuletineZip({ stare: evaluare.stare, tevi, tronsonCtx: tronson?.cod, buletine: arhiva.buletine, eliminate: arhiva.eliminate })
  } catch (e) { return { ok: false, eroare: 'Planul buletinelor: ' + mesaj(e) } }
  const pdfuri = []
  try {
    for (const p of plan) pdfuri.push({ fisierZip: p.fisierZip, bytes: await descarcaPdfBuletin(sb, p.buletin, fetchImpl) })
  } catch (e) { return { ok: false, eroare: mesaj(e) } }

  // 1b. pachetul + rândurile din BD = cele din fotografie, IMEDIAT înainte de generare (serverul nu le verifică)
  const r1 = await verificaPachetNeschimbat(sb, fotografie)
  if (!r1.ok) return r1

  // 2. Excel + ZIP
  const numeXlsx = numeExportIzo(pachet, { incomplet, ext: 'xlsx' })
  const nume = numeExportIzo(pachet, { incomplet, ext: 'zip' })
  let bytes, xlsx
  try {
    xlsx = await genereazaXlsx({
      pachet, tronson, proiect, tevi,
      ndt: { stare: evaluare.stare, tronsonCtx: tronson?.cod, buletine: plan, incomplet, lipsuri: incomplet ? fotografie.lipsuri_blocante : [] },
    })
    bytes = await construiesteZip({ numeXlsx, xlsx, pdfuri })
  } catch (e) { return { ok: false, eroare: 'Generarea exportului: ' + mesaj(e) } }

  // 2b. mărimea (bucket 50 MB): ZIP-ul încape → un fișier; altfel Excel-ul + fiecare PDF separat, în dosarul exportului.
  // Un fișier care singur trece de limită = refuz ÎNAINTE de orice scriere (nu se poate livra pe server).
  const ts = acum.toISOString().slice(0, 10)
  const cheie = uniq || Math.random().toString(36).slice(2, 10)
  const separat = bytes.length > limita
  let fisiere
  if (!separat) {
    fisiere = [{ cale: `${pachet.id}/${ts}_${cheie}_${nume}`, bytes, mime: MIME_ZIP_STORAGE }]
  } else {
    const dosar = `${pachet.id}/${ts}_${cheie}_${nume.replace(/\.zip$/i, '')}`
    fisiere = [{ cale: `${dosar}/${numeXlsx}`, bytes: xlsx, mime: MIME_XLSX, nume: numeXlsx },
      ...pdfuri.map(p => ({ cale: `${dosar}/${p.fisierZip}`, bytes: p.bytes, mime: MIME_PDF, nume: p.fisierZip }))]
    const mare = fisiere.filter(f => f.bytes.length > limita)
    if (mare.length) {
      return { ok: false, eroare: `Arhiva are ${mb(bytes.length)} MB, iar ${mare.map(f => `${f.nume} (${mb(f.bytes.length)} MB)`).join(', ')} `
        + `trec singure de limita de ${mb(limita)} MB a serverului: exportul nu se poate încărca. Nu s-a scris nimic.` }
    }
  }
  const storagePath = fisiere[0].cale   // calea principală: ZIP-ul, respectiv Excel-ul la livrarea separată
  const urcate = []   // căile încărcate de ACEST export (doar ele se pot scoate, și doar fără înregistrare)
  const scoate = async () => { await sb.storage.from(BUCKET_PACHETE).remove(urcate).catch(() => {}) }

  // 3. deblocarea MP-ului (doar la incomplet), pentru EXACT lipsurile din fotografie
  let deblocareId = null
  if (incomplet) {
    const d = await sb.rpc('fn_sud_export_deblocheaza', { p_pachet: pachet.id, p_tip: TIP_EXPORT_IZO, p_motiv: String(motiv || '').trim(), p_lipsuri: fotografie.lipsuri_blocante })
    if (d.error) return { ok: false, eroare: 'Deblocarea a fost refuzată: ' + mesaj(d.error) }
    deblocareId = d.data
  }

  // 4. Storage. ZIP-ul urcă drept application/octet-stream (application/zip nu e permis în bucket), cu numele .zip.
  for (const f of fisiere) {
    const up = await sb.storage.from(BUCKET_PACHETE).upload(f.cale, new Blob([f.bytes], { type: f.mime }), { contentType: f.mime, upsert: false })
    if (up.error) {
      // nimic înregistrat: fișierele deja urcate ale ACESTUI export nu sunt referite nicăieri → se scot
      if (urcate.length) await scoate()
      return { ok: false, eroare: `Încărcarea ${separat ? f.nume : 'arhivei'} a eșuat (${mesaj(up.error)}); nu s-a înregistrat nimic, reîncearcă.` }
    }
    urcate.push(f.cale)
  }

  // 4b. din nou, chiar înainte de înregistrare: pachetul nu s-a schimbat cât s-a generat / încărcat
  const r2 = await verificaPachetNeschimbat(sb, fotografie)
  if (!r2.ok) { await scoate(); return r2 }   // înregistrarea nu s-a cerut → fișierele sunt orfane sigur

  // 5. înregistrarea cu fotografia folosită (serverul o compară cu starea curentă: 40001 = sursele s-au schimbat)
  //    + lista fișierelor (serverul păstrează fotografia întreagă; o ignoră la comparare)
  const fotografieReg = { ...fotografie, livrare: separat ? 'separat' : 'zip', fisiere: fisiere.map(f => f.cale) }
  const reg = await sb.rpc('fn_sud_export_inregistreaza', { p_pachet: pachet.id, p_tip: TIP_EXPORT_IZO, p_fotografie: fotografieReg, p_deblocare_id: deblocareId, p_fisier_path: storagePath })
  let exportId = reg.data
  if (reg.error) {
    if (definitiva(reg.error)) {
      // refuz cert: nimic înregistrat → fișierele încărcate sunt orfane și se pot scoate (L02: doar după rezultat dovedit)
      await scoate()
      if (String(reg.error.code) === '40001') return { ok: false, surseSchimbate: true, eroare: 'Sursele s-au schimbat între timp — redeschide fereastra de export.' }
      return { ok: false, eroare: 'Exportul a fost refuzat: ' + mesaj(reg.error) }
    }
    // rețea / 5xx = necunoscut (L05): nu șterg fișierele; recitesc dacă exportul a ajuns totuși în BD (calea e unică)
    const u = await sb.from('sud_exporturi').select('id').eq('pachet_id', pachet.id).eq('fisier_path', storagePath).limit(1)
    if (!u.error && u.data?.length) exportId = u.data[0].id
    else return { ok: false, eroare: 'Înregistrarea exportului nu s-a putut confirma (' + mesaj(reg.error) + '). Verifică istoricul înainte de a reîncerca.' }
  }

  // 6. istoricul documentelor pachetului (ca până acum; la livrarea separată rândul e Excel-ul, PDF-urile stau în același dosar)
  let avertisment
  const { data: auth } = await sb.auth.getUser()
  const titlu = `Export IZO înainte de lansare${incomplet ? ' — INCOMPLET (deblocat)' : ''}`
  const ins = await sb.from('executie_pachete_documente').insert(separat ? {
    pachet_id: pachet.id, tip_document: 'centralizator', fisier_path: storagePath, fisier_nume: numeXlsx,
    fisier_size_bytes: xlsx.length, mime_type: MIME_XLSX,
    observatii: `${titlu}: arhiva avea ${mb(bytes.length)} MB (peste ${mb(limita)} MB) → pe server Excel-ul + ${plan.length} PDF-uri separate, în același dosar`,
    uploadat_de: auth?.user?.id || null,
  } : {
    pachet_id: pachet.id, tip_document: 'centralizator', fisier_path: storagePath, fisier_nume: nume,
    fisier_size_bytes: bytes.length, mime_type: 'application/zip',
    observatii: `${titlu}: Excel + ${plan.length} buletine NDT`,
    uploadat_de: auth?.user?.id || null,
  })
  if (ins.error) avertisment = 'Exportul e înregistrat, dar rândul din istoric n-a fost scris (' + mesaj(ins.error) + ')'
  return { ok: true, bytes, nume, storagePath, fisiere: fisiere.map(f => f.cale), separat, exportId, plan, avertisment }
}

// ════════════════════════════════════════════════════════════════════════
// Istoricul exporturilor: descărcarea / ștergerea TUTUROR fișierelor unui export (Jakarinos #1219 r2 P2)
// ════════════════════════════════════════════════════════════════════════
// La livrarea separată (> 50 MB) rândul din istoric e Excel-ul, iar PDF-urile stau în ACELAȘI dosar al exportului.
// Lista completă e cea înregistrată de server în sud_exporturi.fotografie.fisiere (nu se ghicește din Storage).

const segmentOk = s => s !== '' && s !== '.' && s !== '..' && !s.includes('\\')
const caleValida = p => typeof p === 'string' && p.length > 0 && p.length <= 500 && !p.startsWith('/') && p.split('/').every(segmentOk)

/** Rândul din istoric e Excel-ul unei livrări separate (calea e în dosarul exportului: pachet/dosar/fișier). */
export const esteLivrareSeparata = doc => caleValida(doc?.fisier_path) && doc.fisier_path.split('/').length > 2

/**
 * Fișierele din Storage ale unui rând din istoric.
 * Cale cu 2 niveluri (pachet/fișier: ZIP-ul, Excel-ul vechi, PDF-ul aprobat) = un singur fișier, ca până acum.
 * Cale în dosarul exportului = livrare separată → lista din sud_exporturi.fotografie.fisiere, validată: toate în dosarul
 * exportului (sub pachetul rândului), fără dubluri, Excel-ul rândului primul. Citire eșuată / listă invizibilă / altă formă
 * = refuz (necunoscut ≠ „un singur fișier”, L18): nu se descarcă și nu se șterge doar o parte.
 * @returns {Promise<{ok:true, separat:boolean, dosar?:string, fisiere:string[]} | {ok:false, eroare:string}>}
 */
export async function fisiereExportIstoric(sb, doc) {
  const cale = doc?.fisier_path
  if (!caleValida(cale)) return { ok: false, eroare: 'Rândul din istoric nu are o cale de fișier validă.' }
  if (!esteLivrareSeparata(doc)) return { ok: true, separat: false, fisiere: [cale] }
  const dosar = cale.slice(0, cale.lastIndexOf('/'))
  const nimic = 'nu s-a descărcat și nu s-a șters nimic.'
  if (!dosar.startsWith(`${doc.pachet_id}/`)) return { ok: false, eroare: `Dosarul exportului nu e al pachetului: ${nimic}` }
  const { data, error } = await sb.from('sud_exporturi').select('id, fotografie')
    .eq('pachet_id', doc.pachet_id).eq('fisier_path', cale).order('id').limit(2)
  if (error) return { ok: false, eroare: `Lista fișierelor exportului nu s-a putut citi (${mesaj(error)}): ${nimic}` }
  if (!data?.length) return { ok: false, eroare: `Exportul are mai multe fișiere, dar lista lor nu e vizibilă (e nevoie de dreptul de citire pe arhiva de buletine NDT): ${nimic}` }
  if (data.length > 1) return { ok: false, eroare: `Două exporturi au aceeași cale în istoric: ${nimic}` }
  const f = data[0].fotografie
  const lista = f?.fisiere
  if (f?.livrare !== 'separat' || !Array.isArray(lista) || !lista.length || lista[0] !== cale
    || new Set(lista).size !== lista.length || !lista.every(p => caleValida(p) && p.startsWith(`${dosar}/`))) {
    return { ok: false, eroare: `Lista fișierelor exportului are altă formă decât cea așteptată: ${nimic}` }
  }
  return { ok: true, separat: true, dosar, fisiere: lista }
}

/**
 * „Descarcă” din istoric. Un fișier → link semnat (ca până acum). Livrare separată → TOATE fișierele exportului, puse
 * în ZIP local cu structura arhivei originale (Excel-ul la rădăcină + buletine/…). Un fișier lipsă = eroare, nu ZIP parțial.
 * @returns {Promise<{ok:true, url:string} | {ok:true, bytes:Uint8Array, nume:string, numar:number} | {ok:false, eroare:string}>}
 */
export async function descarcaExportIstoric(sb, doc, fetchImpl = globalThis.fetch) {
  const l = await fisiereExportIstoric(sb, doc)
  if (!l.ok) return l
  const st = sb.storage.from(BUCKET_PACHETE)
  if (!l.separat) {
    const { data, error } = await st.createSignedUrl(l.fisiere[0], 60)
    if (error || !data?.signedUrl) return { ok: false, eroare: 'Eroare signed URL: ' + (error ? mesaj(error) : 'fără link') }
    return { ok: true, url: data.signedUrl }
  }
  const zip = new JSZip()
  for (const p of l.fisiere) {
    const rel = p.slice(l.dosar.length + 1)
    const { data, error } = await st.createSignedUrl(p, 120)
    if (error || !data?.signedUrl) return { ok: false, eroare: `${rel}: ${error ? mesaj(error) : 'fără link'} — nu s-a descărcat nimic.` }
    let r
    try { r = await fetchImpl(data.signedUrl) } catch (e) { return { ok: false, eroare: `${rel}: ${mesaj(e)} — nu s-a descărcat nimic.` } }
    if (!r.ok) return { ok: false, eroare: `${rel}: descărcare eșuată (${r.status}) — nu s-a descărcat nimic.` }
    zip.file(rel, new Uint8Array(await r.arrayBuffer()))
  }
  const nume = String(doc.fisier_nume || l.fisiere[0].slice(l.dosar.length + 1)).replace(/\.xlsx$/i, '') + '.zip'
  return { ok: true, bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), nume, numar: l.fisiere.length }
}

/** Fișierul există încă în Storage? Căutare exactă pe nume în dosarul lui. true / false; eroare → null (necunoscut). */
async function existaInStorage(st, p) {
  const i = p.lastIndexOf('/')
  const dir = i < 0 ? '' : p.slice(0, i), baza = p.slice(i + 1)
  try {
    const { data, error } = await st.list(dir, { search: baza, limit: 100 })
    if (error || !Array.isArray(data)) return null
    return data.some(o => o?.name === baza)
  } catch { return null }
}

/**
 * „Șterge” din istoric: scoate din Storage EXACT fișierele exportului (lista validată mai sus), verifică după ștergere
 * că nu mai există niciunul, și abia apoi șterge rândul din istoric (confirmat prin RETURNING). Ce nu s-a putut șterge /
 * verifica = mesaj cu numele fișierelor, iar rândul RĂMÂNE (ștergerea se poate relua; fișierele deja scoase nu mai apar).
 * @returns {Promise<{ok:true, numar:number} | {ok:false, eroare:string, ramase?:string[]}>}
 */
export async function stergeExportIstoric(sb, doc) {
  const l = await fisiereExportIstoric(sb, doc)
  if (!l.ok) return l
  const st = sb.storage.from(BUCKET_PACHETE)
  const nume = p => (l.separat ? p.slice(l.dosar.length + 1) : p.slice(p.lastIndexOf('/') + 1))
  let errRemove = null
  try { const r = await st.remove(l.fisiere); errRemove = r?.error || null } catch (e) { errRemove = e }
  const ramase = [], neverificate = []
  for (const p of l.fisiere) {
    const e = await existaInStorage(st, p)
    if (e === true) ramase.push(p)
    else if (e !== false) neverificate.push(p)
  }
  if (ramase.length || neverificate.length) {
    const parti = []
    if (ramase.length) parti.push(`${ramase.length} din ${l.fisiere.length} fișiere nu s-au putut șterge din Storage: ${ramase.map(nume).join(', ')}`)
    if (neverificate.length) parti.push(`pentru ${neverificate.length} fișiere ștergerea nu s-a putut verifica: ${neverificate.map(nume).join(', ')}`)
    return { ok: false, ramase: [...ramase, ...neverificate],
      eroare: `${parti.join('; ')}${errRemove ? ` (${mesaj(errRemove)})` : ''}. Rândul rămâne în istoric — reîncearcă ștergerea.` }
  }
  const d = await sb.from('executie_pachete_documente').delete().eq('id', doc.id).select('id')
  if (d.error) return { ok: false, eroare: `Fișierele s-au șters din Storage, dar rândul din istoric nu (${mesaj(d.error)}) — reîncearcă ștergerea.` }
  if (!d.data?.length) return { ok: false, eroare: 'Fișierele s-au șters din Storage, dar rândul din istoric nu s-a șters (nu mai există sau nu ai drept).' }
  return { ok: true, numar: l.fisiere.length }
}
