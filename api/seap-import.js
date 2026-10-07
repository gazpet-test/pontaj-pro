// Aducerea documentatiei de atribuire din SEAP — varianta "grea", pe Vercel.
//
// De ce exista pe langa edge function-ul din Supabase: acolo bugetul unei rulari
// se consuma proportional cu octetii de arhiva parcursi, iar la o arhiva de ~232MB
// nici macar parcurgerea fara upload nu incape (vezi ofertare-seap-import). Aici nu
// exista plafonul acela, asa ca arhiva se parcurge pana la capat intr-o singura
// trecere, oricat de departe ar fi documentul cautat.
//
// Ce ramane valabil din lectiile platite in productie:
// - endpoint-ul per document (api-pub/files/noticedoc/<hash>) da 500 din exterior,
//   inclusiv cu cookie de sesiune; arhiva NU suporta Range. Deci: tot arhiva.
// - ZIP-ul SEAP tine dimensiunile in local file header (fara data descriptor), deci
//   se poate parcurge streaming, sarind peste ce avem deja.
// - cheile noi (sb_...) nu sunt JWT: uploadul reluabil le vrea prin apikey.
// - fisierele .p7s / .p7m au continutul FRAGMENTAT in ASN.1; se desface cu _semnaturaCms.js (copia byte cu byte a
//   supabase/functions/_shared/semnaturaCms.mjs — aceeasi regula ca workerul, edge-ul si veghea), nu prin decupare
//   intre %PDF si %%EOF. Var. B (07.10.2026): „X.pdf.p7m” → „X (semnat).pdf”; desfacere esuata = numele ramane (#20).
// - tip are CHECK in BD ('duae' nu e valoare valida), iar erorile de scriere se
//   raporteaza — altfel fisierul ajunge in storage si documentul lipseste din lista.
import { createClient } from '@supabase/supabase-js'
import { poartaOfertare } from './_poartaOfertare.js'
import { Flux, parcurgeZip } from './_zipFlux.js'
import { toatePaginile } from './_paginat.js'
// arhiva .p7m („X.rar.p7m”) ramane intreaga, cu numele SEAP: o desface workerul NAS (#644; Jakarinos #7 pe #649)
import { desfaceFaraArhiveP7m as desface, cheieRand as cheieRandCu, cheiSeap as cheiSeapCu } from './_semnaturaCms.js'
import { randManifest, sha256Hex, dedupManifest, MANIFEST_CONFLICT, ARHIVA_SEAP } from './_manifest.js'
import { ghicesteTip, esteArhiva } from './_tipDocument.js'

const SEAP = 'https://e-licitatie.ro/api-pub'
const SEAP_HDR = {
  'Referer': 'https://e-licitatie.ro/pub',
  'Origin': 'https://e-licitatie.ro',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}
const PRAG_RELUABIL = 45e6      // reper pentru mesaje; uploadul in felii e rezerva
const FELIE = 6 * 1024 * 1024   // Storage cere felii de 6MB, ultima poate fi mai mica
// segment ÎNTREG (ca în worker și edge): „__MACOSX_documentatie.pdf” nu e gunoi (audit Jakarinos 07.10, #18)
const JUNK_RE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i
const estePlaceholder = (d) => !d.fisier_path || String(d.fisier_path).includes('/neincarcat/')
// audit Jakarinos #16: ACEEASI cheie de nume ca edge-ul, veghea si workerul (COPIE a cheieNume de acolo). Inainte api-ul
// compara numele exact: „Doc 1.pdf” (placeholder-ul veghei) si „Doc (1).pdf” (DownloadArchive) dadeau doua randuri, iar
// placeholder-ul ramanea „neincarcat” desi fisierul era in platforma. Cheia e doar pentru comparatie; in BD merge numele real.
const cheieNume = (n) => String(n ?? '').replace(/\.p7s$/i, '').toLowerCase()
  .replace(/[,()]/g, '').replace(/\s+/g, '')
// randul ramas cu semnatura bruta („X.pdf.p7s” detasata / nedesfacuta) nu e „X.pdf” (Copilot NO-GO r1 pe #649)
const cheieRand = (n) => cheieRandCu(String(n ?? ''), cheieNume)

// Tipul după nume și detectarea arhivelor: api/_tipDocument.js = copia byte cu byte a
// supabase/functions/_shared/tipDocument.mjs (src/tipDocument.test.js le ține identice).

// Parcurgerea ZIP-ului in flux: api/_zipFlux.js = copia byte cu byte a supabase/functions/_shared/zipFlux.mjs (audit Jakarinos
// #9 / #10): sfarsit valid doar la directorul central, refuz pentru data descriptor fara marimi / ZIP64 / antet necunoscut,
// plafon de iesire anti-bomba (marimea din antet, cel mult 200 MB = limita bucket-ului).
const MAX_INTRARE = 200 * 1024 * 1024

// Upload in felii pentru fisierele mari (cheia merge prin apikey, nu Authorization).
async function urcaInFelii(supaUrl, key, bucket, obiect, contentType, buf) {
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')
  const meta = [`bucketName ${b64(bucket)}`, `objectName ${b64(obiect)}`, `contentType ${b64(contentType)}`].join(',')
  const cre = await fetch(`${supaUrl}/storage/v1/upload/resumable`, {
    method: 'POST',
    headers: { apikey: key, 'Tus-Resumable': '1.0.0', 'Upload-Length': String(buf.length), 'Upload-Metadata': meta },
  })
  if (cre.status !== 201) return `creare upload: HTTP ${cre.status} ${(await cre.text()).slice(0, 200)}`
  const loc = cre.headers.get('Location')
  if (!loc) return 'creare upload: fara Location'
  const tinta = new URL(loc, supaUrl).toString()
  for (let offset = 0; offset < buf.length;) {
    const felie = buf.subarray(offset, Math.min(offset + FELIE, buf.length))
    const r = await fetch(tinta, {
      method: 'PATCH',
      headers: { apikey: key, 'Tus-Resumable': '1.0.0', 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' },
      body: felie,
    })
    if (r.status !== 204) {
      const t = (await r.text()).slice(0, 200)
      await fetch(tinta, { method: 'DELETE', headers: { apikey: key, 'Tus-Resumable': '1.0.0' } }).catch(() => {})
      return `felie la ${offset}: HTTP ${r.status} ${t}`
    }
    offset = Number(r.headers.get('Upload-Offset') ?? (offset + felie.length))
  }
  return null
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'doar POST' })

  // Exceptia interna a veghei: secret configurat si egal; JWT-ul cere acces Ofertare.
  const SECRET = process.env.SEAP_IMPORT_SECRET
  if (!SECRET || req.headers['x-import-secret'] !== SECRET) {
    const refuzAcces = await poartaOfertare(req)
    if (refuzAcces) return res.status(refuzAcces.status).json(refuzAcces.body)
  }

  const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPA_URL || !SERVICE) {
    return res.status(500).json({ error: 'lipsesc SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY din variabilele de mediu Vercel' })
  }

  const corp = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const licitatieId = Number(corp.licitatie_id)
  if (!licitatieId) return res.status(400).json({ error: 'licitatie_id lipsa' })

  const supa = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } })
  const { data: lic } = await supa.from('ofertare_licitatii')
    .select('id, nr_anunt, c_notice_id, sys_notice_type_id').eq('id', licitatieId).single()
  if (!lic) return res.status(404).json({ error: 'licitatie inexistenta' })
  if (!lic.c_notice_id || !lic.sys_notice_type_id) {
    return res.status(400).json({ error: 'licitatia nu are c_notice_id / sys_notice_type_id (se completeaza la promovarea din radar)' })
  }

  const raport = { adaugate: 0, completate: 0, sarite_existente: 0, erori: [], intrari: 0, manifest_randuri: 0, avertismente: [] }
  // inventarul pe pagini, fail-closed (audit Jakarinos #21): o listă trunchiată / o eroare NU e „nimic în platformă”
  const { data: dejaAre, error: eInv } = await toatePaginile((de, la) => supa.from('ofertare_documente_atribuire')
    .select('id, nume_original, fisier_path').eq('licitatie_id', licitatieId).order('id').range(de, la))
  if (eInv) return res.status(500).json({ error: `inventarul documentelor nu s-a putut citi: ${eInv.message}` })
  const urcate = new Set((dejaAre || []).filter((d) => !estePlaceholder(d)).map((d) => cheieRand(d.nume_original)))
  const placeholders = new Map((dejaAre || []).filter(estePlaceholder).map((d) => [cheieRand(d.nume_original), d.id]))
  // var. B: „X.pdf.p7m” poate fi in platforma brut (inainte de B) sau desfacut ca „X (semnat).pdf” — niciunul nu se re-urca
  const dejaUrcat = (numeSeap) => cheiSeapCu(numeSeap, cheieNume).some((k) => urcate.has(k))

  // placeholder-ul se completeaza O SINGURA DATA, doar daca e inca placeholder (ca ofertare-seap-import/placeholder.ts, audit #2);
  // „X (semnat).pdf” completeaza placeholder-ul pus pe numele SEAP („X.pdf.p7m”)
  const scrie = async (rand, nume, numeSeap = null) => {
    const k = placeholders.has(cheieRand(nume)) || !numeSeap ? cheieRand(nume) : cheieRand(numeSeap)
    const idPh = placeholders.get(k)
    if (idPh) {
      placeholders.delete(k)
      const { data: compl, error: eC } = await supa.from('ofertare_documente_atribuire').update(rand).eq('id', idPh)
        .or('fisier_path.is.null,fisier_path.like.%/neincarcat/%').select('id')
      if (eC) { raport.erori.push(`${nume}: scriere rand - ${eC.message}`); return null }
      if ((compl || []).length === 1) { raport.completate++; return compl[0].id }
      // completat intre timp de alt drum → rand nou, nu suprascriere
    }
    const { data, error } = await supa.from('ofertare_documente_atribuire').insert(rand).select('id').maybeSingle()
    if (error) { raport.erori.push(`${nume}: scriere rand - ${error.message}`); return null }
    raport.adaugate++
    return data?.id ?? null
  }

  // R6: manifest de integritate (SHA-256 pe byte-ii urcati, dupa continutSemnat) — ca in edge.
  // O eroare de manifest NU opreste importul: devine avertisment (raport + seap_meta pe document).
  const manifest = []
  const noteazaManifest = (cale, buf, documentId, motiv) => {
    try {
      manifest.push(randManifest({ licitatieId, arhivaCheie: ARHIVA_SEAP, cale, marime: buf.length, sha256: sha256Hex(buf), documentId, motiv }))
    } catch (e) { raport.avertismente.push(`manifest ${cale}: ${String(e?.message || e)}`) }
  }
  const scrieManifest = async () => {
    if (!manifest.length) return
    const unice = dedupManifest(manifest)
    const esuate = []
    for (let k = 0; k < unice.length; k += 200) {
      const felie = unice.slice(k, k + 200)
      const { error } = await supa.from('ofertare_seap_manifest').upsert(felie, { onConflict: MANIFEST_CONFLICT })
      if (error) { raport.avertismente.push(`manifest: ${error.message}`); esuate.push(...felie) }
      else raport.manifest_randuri += felie.length
    }
    const ids = esuate.map((r) => r.document_id).filter(Boolean)
    if (!ids.length) return
    try {
      const { data: meta } = await supa.from('ofertare_documente_atribuire').select('id, seap_meta').in('id', ids)
      for (const d of meta || []) {
        await supa.from('ofertare_documente_atribuire')
          .update({ seap_meta: { ...(d.seap_meta || {}), manifest_avertisment: `manifest nescris (${new Date().toISOString()})` } }).eq('id', d.id)
      }
    } catch (_) { /* avertismentul e deja in raport */ }
  }

  const url = `${SEAP}/NoticeCommon/DownloadArchive/?initNoticeId=${lic.c_notice_id}&sysNoticeTypeId=${lic.sys_notice_type_id}`
  const arh = await fetch(url, { headers: SEAP_HDR })
  if (!arh.ok || !arh.body) return res.status(502).json({ error: `SEAP HTTP ${arh.status}` })

  const flux = new Flux(arh.body.getReader())
  let arhivaIncompleta = false
  try {
    const rz = await parcurgeZip(
      flux,
      (h) => {
        raport.intrari++
        if (dejaUrcat(h.nume) || JUNK_RE.test(h.nume)) { if (dejaUrcat(h.nume)) raport.sarite_existente++; return false }
        if (h.usize > MAX_INTRARE) { raport.erori.push(`${h.nume.replace(/\.p7s$/i, '')}: peste limita de stocare (200 MB)`); return false }
        return true
      },
      async (h, brut) => {
        const nume = h.nume
        try {
          const ds = desface(brut, nume)
          const { buf, nume: numeFinal } = ds
          const nota = ds.nota && !esteArhiva(numeFinal) ? ds.nota : null   // arhiva nedesfacuta: o incearca workerul NAS
          const estePdf = /\.pdf$/i.test(numeFinal)
          const ctype = estePdf ? 'application/pdf' : 'application/octet-stream'
          const safe = numeFinal.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180)
          const path = `${licitatieId}/atribuire/${Date.now().toString(36)}_${safe}`

          // Uploadul obisnuit duce si fisiere mari (bucket-ul permite 200MB) si e o
          // singura cerere; uploadul in felii ramane rezerva, pentru cand acela refuza.
          const { error: eUp } = await supa.storage.from('ofertare').upload(path, buf, { contentType: ctype })
          if (eUp) {
            const eroare = await urcaInFelii(SUPA_URL, SERVICE, 'ofertare', path, ctype, buf)
            if (eroare) { raport.erori.push(`${numeFinal}: ${eUp.message} | in felii: ${eroare}`); noteazaManifest(numeFinal, buf, null, eroare); return 'continua' }
          }

          const docId = await scrie({
            licitatie_id: licitatieId, fisier_path: path, nume_original: numeFinal,
            tip: ghicesteTip(numeFinal), size_bytes: buf.length,
            // 07.10.2026: o arhivă intră „neprocesat”, fără notă — o despachetează bucla workerului NAS. Dacă drumul SEAP al
            // workerului a desfăcut-o deja (evidență „ok” / manifest), bucla o închide cu notă, fără dublură (review #641 r2).
            status_procesare: !nota && (estePdf || esteArhiva(numeFinal)) ? 'neprocesat' : 'ignorat',
            eroare: !nota && (estePdf || esteArhiva(numeFinal)) ? null : (nota || 'non-PDF - ramane ca fisier (docx/xls/dwg se parseaza in M2)'),
            sursa: 'seap',
          }, numeFinal, nume)
          noteazaManifest(numeFinal, buf, docId, docId ? null : 'rand BD nescris')
          urcate.add(cheieRand(numeFinal))
        } catch (e) {
          raport.erori.push(`${nume.replace(/\.p7s$/i, '')}: ${String(e?.message || e)}`)
        }
        return 'continua'
      },
      (n, m) => raport.erori.push(`${n.replace(/\.p7s$/i, '')}: ${m}`),
      { maxIesire: MAX_INTRARE },
    )
    // audit Jakarinos #9: arhiva necitita pana la directorul central NU e „adusa” — documentele de dupa s-ar pierde tacut
    if (!rz.complet) { arhivaIncompleta = true; raport.erori.push(`arhiva: ${rz.motiv}`) }
  } catch (e) {
    arhivaIncompleta = true
    raport.erori.push('flux: ' + String(e?.message || e))
  }

  raport.arhiva_completa = !arhivaIncompleta
  try { await scrieManifest() } catch (e) { raport.avertismente.push('manifest: ' + String(e?.message || e)) }

  if (!raport.erori.length) {
    await supa.from('ofertare_licitatii').update({ documentatie_adusa_la: new Date().toISOString() }).eq('id', licitatieId)
  }
  return res.status(200).json(raport)
}
