// ════════════════════════════════════════════════════════════════════════
// IZOMETRIE — „Export IZO înainte de lansare”: citirea fotografiei + exportul (ZIP, Storage, înregistrare)
// ════════════════════════════════════════════════════════════════════════
// Contractul BD: supabase/migrations/20270114a_izometrie_buletine_ndt.sql (fn_sud_drept, fn_sud_export_deblocheaza,
// fn_sud_export_inregistreaza). Clientul nu scrie nimic în arhiva de buletine; doar citește (RLS) și cheamă cele două funcții.
// Logica pură: src/lib/izoExportIzo.js + src/lib/izoNdt.js.

import JSZip from 'jszip'
import { paginareKeyset } from './hrDeciziiUtil.js'
import { TIP_EXPORT_IZO, numeExportIzo, planBuletineZip } from './lib/izoExportIzo.js'

const BUCKET_NDT = 'izo-ndt'
const BUCKET_PACHETE = 'executie-pachete-pdf'
const BUCATA_IN = 100   // id-uri pe bucăți în .in() (URL scurt)

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
 * Exportul: PDF-uri → (deblocare) → Excel → ZIP → Storage → fn_sud_export_inregistreaza → rândul în istoric.
 * Generarea folosește EXACT evaluarea (fotografia) din fereastră. Nu se descarcă local nimic neînregistrat.
 * @param {object} p
 * @param {Function} p.genereazaXlsx  generateCentralizatorXlsx
 * @returns {Promise<{ok:true, bytes, nume, storagePath, exportId, avertisment?:string} | {ok:false, eroare:string, surseSchimbate?:boolean}>}
 */
export async function executaExportIzo(sb, { pachet, tronson, proiect, tevi, evaluare, arhiva, incomplet, motiv, genereazaXlsx, fetchImpl, acum = new Date(), uniq }) {
  const fotografie = evaluare?.fotografie
  if (!fotografie) return { ok: false, eroare: 'Fotografia surselor lipsește: redeschide fereastra.' }
  if (evaluare.verificare.blocaje.length) return { ok: false, eroare: 'Exportul are blocaje fără deblocare.' }
  if (!incomplet && fotografie.lipsuri_blocante.length) return { ok: false, eroare: 'Exportul are lipsuri: e nevoie de deblocarea managerului de proiect.' }
  if (incomplet && !fotografie.lipsuri_blocante.length) return { ok: false, eroare: 'Nu există lipsuri de deblocat.' }

  // 1. buletinele folosite + PDF-urile lor (înainte de orice scriere: o descărcare eșuată nu lasă nimic în urmă)
  let plan
  try {
    plan = planBuletineZip({ stare: evaluare.stare, tevi, tronsonCtx: tronson?.cod, buletine: arhiva.buletine, eliminate: arhiva.eliminate })
  } catch (e) { return { ok: false, eroare: 'Planul buletinelor: ' + mesaj(e) } }
  const pdfuri = []
  try {
    for (const p of plan) pdfuri.push({ fisierZip: p.fisierZip, bytes: await descarcaPdfBuletin(sb, p.buletin, fetchImpl) })
  } catch (e) { return { ok: false, eroare: mesaj(e) } }

  // 2. Excel + ZIP
  const numeXlsx = numeExportIzo(pachet, { incomplet, ext: 'xlsx' })
  const nume = numeExportIzo(pachet, { incomplet, ext: 'zip' })
  let bytes
  try {
    const xlsx = await genereazaXlsx({
      pachet, tronson, proiect, tevi,
      ndt: { stare: evaluare.stare, tronsonCtx: tronson?.cod, buletine: plan, incomplet, lipsuri: incomplet ? fotografie.lipsuri_blocante : [] },
    })
    bytes = await construiesteZip({ numeXlsx, xlsx, pdfuri })
  } catch (e) { return { ok: false, eroare: 'Generarea exportului: ' + mesaj(e) } }

  // 3. deblocarea MP-ului (doar la incomplet), pentru EXACT lipsurile din fotografie
  let deblocareId = null
  if (incomplet) {
    const d = await sb.rpc('fn_sud_export_deblocheaza', { p_pachet: pachet.id, p_tip: TIP_EXPORT_IZO, p_motiv: String(motiv || '').trim(), p_lipsuri: fotografie.lipsuri_blocante })
    if (d.error) return { ok: false, eroare: 'Deblocarea a fost refuzată: ' + mesaj(d.error) }
    deblocareId = d.data
  }

  // 4. Storage
  const ts = acum.toISOString().slice(0, 10)
  const cheie = uniq || Math.random().toString(36).slice(2, 10)
  const storagePath = `${pachet.id}/${ts}_${cheie}_${nume}`
  const up = await sb.storage.from(BUCKET_PACHETE).upload(storagePath, new Blob([bytes], { type: 'application/zip' }), { contentType: 'application/zip', upsert: false })
  if (up.error) return { ok: false, eroare: 'Încărcarea arhivei a eșuat (' + mesaj(up.error) + '); nu s-a înregistrat nimic, reîncearcă.' }

  // 5. înregistrarea cu fotografia folosită (serverul o compară cu starea curentă: 40001 = sursele s-au schimbat)
  const reg = await sb.rpc('fn_sud_export_inregistreaza', { p_pachet: pachet.id, p_tip: TIP_EXPORT_IZO, p_fotografie: fotografie, p_deblocare_id: deblocareId, p_fisier_path: storagePath })
  let exportId = reg.data
  if (reg.error) {
    if (definitiva(reg.error)) {
      // refuz cert: nimic înregistrat → fișierul încărcat e orfan și se poate scoate (L02: doar după rezultat dovedit)
      await sb.storage.from(BUCKET_PACHETE).remove([storagePath]).catch(() => {})
      if (String(reg.error.code) === '40001') return { ok: false, surseSchimbate: true, eroare: 'Sursele s-au schimbat între timp — redeschide fereastra de export.' }
      return { ok: false, eroare: 'Exportul a fost refuzat: ' + mesaj(reg.error) }
    }
    // rețea / 5xx = necunoscut (L05): nu șterg fișierul; recitesc dacă exportul a ajuns totuși în BD (calea e unică)
    const u = await sb.from('sud_exporturi').select('id').eq('pachet_id', pachet.id).eq('fisier_path', storagePath).limit(1)
    if (!u.error && u.data?.length) exportId = u.data[0].id
    else return { ok: false, eroare: 'Înregistrarea exportului nu s-a putut confirma (' + mesaj(reg.error) + '). Verifică istoricul înainte de a reîncerca.' }
  }

  // 6. istoricul documentelor pachetului (ca până acum)
  let avertisment
  const { data: auth } = await sb.auth.getUser()
  const ins = await sb.from('executie_pachete_documente').insert({
    pachet_id: pachet.id, tip_document: 'centralizator', fisier_path: storagePath, fisier_nume: nume,
    fisier_size_bytes: bytes.length, mime_type: 'application/zip',
    observatii: `Export IZO înainte de lansare${incomplet ? ' — INCOMPLET (deblocat)' : ''}: Excel + ${plan.length} buletine NDT`,
    uploadat_de: auth?.user?.id || null,
  })
  if (ins.error) avertisment = 'Exportul e înregistrat, dar rândul din istoric n-a fost scris (' + mesaj(ins.error) + ')'
  return { ok: true, bytes, nume, storagePath, exportId, plan, avertisment }
}
