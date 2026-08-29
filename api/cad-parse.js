// Citirea desenelor CAD din documentatia de atribuire, direct in platforma.
//
// De ce aici si nu intr-un serviciu separat: conversia DWG cere un binar nativ, iar
// edge functions (Deno) nu pot rula asa ceva. Un container separat ar fi insemnat
// inca o piesa de intretinut — asa ca binarul sta langa functia asta, compilat static,
// si nu depinde de nimic din afara.
//
// Ce face:
//   DXF -> citit direct (parser propriu, _dxf.js)
//   DWG -> convertit cu dwg2dxf (LibreDWG), apoi la fel
// Rezultatul se scrie langa document (coloana analiza) si, daca gaseste un traseu
// clar, intra ca pozitie in lista de cantitati a licitatiei.
//
// LibreDWG e GPL-3.0: se ruleaza ca PROCES SEPARAT (invocam binarul), nu se leaga in
// codul nostru — asa codul platformei ramane al nostru.
import { createClient } from '@supabase/supabase-js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { citesteDxf } from './_dxf.js'

const rulează = promisify(execFile)
const BIN_DWG2DXF = path.join(process.cwd(), 'bin', 'dwg2dxf')
const MAX_MB = 60

const esteDwg = (buf) => buf.subarray(0, 4).toString('latin1') === 'AC10'
const esteDxf = (buf) => {
  const cap = buf.subarray(0, 2048).toString('latin1')
  return cap.includes('SECTION') || cap.includes('HEADER') || cap.trimStart().startsWith('0')
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'doar POST' })

  const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
  const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  const SECRET = process.env.SEAP_IMPORT_SECRET
  if (!SUPA_URL || !SERVICE) return res.status(500).json({ error: 'lipsesc variabilele Supabase din Vercel' })

  if (!SECRET || req.headers['x-import-secret'] !== SECRET) {
    const jwt = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!jwt || !ANON) return res.status(401).json({ error: 'unauthorized' })
    const { data: u } = await createClient(SUPA_URL, ANON).auth.getUser(jwt)
    if (!u?.user) return res.status(401).json({ error: 'unauthorized' })
  }

  const corp = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const docId = Number(corp.doc_id)
  const licitatieId = Number(corp.licitatie_id)
  if (!docId && !licitatieId) return res.status(400).json({ error: 'doc_id sau licitatie_id lipsa' })

  const supa = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } })

  // documentele de analizat: cel cerut, sau toate desenele CAD ale licitatiei
  let q = supa.from('ofertare_documente_atribuire')
    .select('id, licitatie_id, nume_original, fisier_path, size_bytes')
    .not('fisier_path', 'like', '%/neincarcat/%')
  q = docId ? q.eq('id', docId) : q.eq('licitatie_id', licitatieId).or('nume_original.ilike.%.dwg,nume_original.ilike.%.dxf')
  const { data: docs, error: eDocs } = await q
  if (eDocs) return res.status(500).json({ error: eDocs.message })
  if (!docs?.length) return res.status(404).json({ error: 'niciun desen CAD de analizat' })

  const raport = []
  for (const doc of docs) {
    const nume = doc.nume_original
    try {
      if (doc.size_bytes && doc.size_bytes > MAX_MB * 1e6) {
        raport.push({ document: nume, sarit: `peste ${MAX_MB}MB` })
        continue
      }
      const { data: fisier, error: eDl } = await supa.storage.from('ofertare').download(doc.fisier_path)
      if (eDl || !fisier) { raport.push({ document: nume, eroare: eDl?.message || 'descarcare esuata' }); continue }
      const buf = Buffer.from(await fisier.arrayBuffer())

      let textDxf = null
      let convertit = false
      if (esteDwg(buf)) {
        if (!existsSync(BIN_DWG2DXF)) {
          raport.push({ document: nume, eroare: 'fisier DWG, dar convertorul nu e disponibil in acest deploy' })
          continue
        }
        const dir = await mkdtemp(path.join(tmpdir(), 'cad-'))
        try {
          const inDwg = path.join(dir, 'desen.dwg')
          const outDxf = path.join(dir, 'desen.dxf')
          await writeFile(inDwg, buf)
          // dwg2dxf scrie avertismente pe stderr si tot reuseste — conteaza doar iesirea
          await rulează(BIN_DWG2DXF, ['-o', outDxf, inDwg], { timeout: 120000, maxBuffer: 32 << 20 }).catch(() => {})
          if (!existsSync(outDxf)) { raport.push({ document: nume, eroare: 'conversia DWG nu a produs niciun rezultat' }); continue }
          textDxf = await readFile(outDxf, 'latin1')
          convertit = true
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => {})
        }
      } else if (esteDxf(buf)) {
        textDxf = buf.toString('latin1')
      } else {
        raport.push({ document: nume, sarit: 'nu e desen CAD' })
        continue
      }

      const analiza = citesteDxf(textDxf)
      analiza.din_dwg = convertit
      analiza.fisier = nume
      await supa.from('ofertare_documente_atribuire')
        .update({ analiza, analiza_la: new Date().toISOString() }).eq('id', doc.id)

      // Traseul cu cote e candidatul de conducta — intra ca pozitie de cantitate,
      // marcata ca provenind din desen, ca sa poata fi comparata cu memoriul.
      const c = analiza.sumar.cu_cote
      let pozitie = null
      if (c.numar > 0 && c.lungime_3d_m > 0) {
        const denumire = `Traseu măsurat din desenul proiectantului (${nume})`
        const { data: existent } = await supa.from('ofertare_cantitati')
          .select('id').eq('licitatie_id', doc.licitatie_id).eq('denumire', denumire).maybeSingle()
        const rand = {
          licitatie_id: doc.licitatie_id, denumire,
          cantitate: c.lungime_3d_m, um: 'm', cantitate_plansa: c.lungime_3d_m, status: 'validat',
          diferenta_nota: `Măsurat din desen: ${c.lungime_3d_m.toLocaleString('ro-RO')} m în spațiu, ${c.lungime_2d_m.toLocaleString('ro-RO')} m în plan` +
            `${c.numar > 1 ? `, pe ${c.numar} trasee` : ''}. ${analiza.nota}`,
        }
        if (existent) await supa.from('ofertare_cantitati').update(rand).eq('id', existent.id)
        else await supa.from('ofertare_cantitati').insert(rand)
        pozitie = rand.cantitate
      }

      raport.push({
        document: nume, din_dwg: convertit,
        straturi: analiza.straturi, sumar: analiza.sumar, pozitie_cantitate_m: pozitie,
      })
    } catch (e) {
      raport.push({ document: nume, eroare: String(e?.message || e).slice(0, 200) })
    }
  }

  return res.status(200).json({ analizate: raport.length, raport })
}
