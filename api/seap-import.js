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
// - tip are CHECK in BD ('duae' nu e valoare valida), iar erorile de scriere se
//   raporteaza — altfel fisierul ajunge in storage si documentul lipseste din lista.
import { createClient } from '@supabase/supabase-js'
import { inflateRawSync } from 'node:zlib'

const SEAP = 'https://e-licitatie.ro/api-pub'
const SEAP_HDR = {
  'Referer': 'https://e-licitatie.ro/pub',
  'Origin': 'https://e-licitatie.ro',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}
const PRAG_RELUABIL = 45e6      // peste asta uploadul se face in felii
const FELIE = 6 * 1024 * 1024   // Storage cere felii de 6MB, ultima poate fi mai mica
const JUNK_RE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/i
const estePlaceholder = (d) => !d.fisier_path || String(d.fisier_path).includes('/neincarcat/')

// aceleasi reguli ca ghicesteTip din OfertareLicitatii.jsx — valorile trebuie sa
// existe in CHECK-ul coloanei tip
function ghicesteTip(nume) {
  const n = nume.toLowerCase()
  if (/fisa[_ -]?date|instructiuni_ofertanti/.test(n)) return 'fisa_date'
  if (/formular|duae/.test(n)) return 'formular'
  if (/contract/.test(n)) return 'model_contract'
  if (/cantitat|antemasur|^f[1-3][_ .-]|centralizator/.test(n)) return 'lista_cantitati'
  if (/desene|plans|plansa|schema tehnologica|\.dwg|izometri|topo/.test(n)) return 'plansa'
  if (/volum|caiet|memoriu|\bcs\b|sectiunea/.test(n)) return 'cs_volum'
  if (/raspuns|clarificar/.test(n)) return 'raspuns_clarificare'
  return 'alta'
}

// Fisierele SEAP sunt semnate: continutul real e in interiorul containerului CMS.
function desfaP7s(buf, nume) {
  if (!/\.p7s$/i.test(nume)) return { buf, nume }
  const numeReal = nume.replace(/\.p7s$/i, '')
  const start = buf.indexOf('%PDF')
  if (start >= 0) {
    const eof = buf.lastIndexOf('%%EOF')
    return { buf: buf.subarray(start, eof >= 0 ? eof + 5 : buf.length), nume: numeReal }
  }
  for (const s of ['PK', '<?xml']) {
    const p = buf.indexOf(s)
    if (p >= 0) return { buf: buf.subarray(p), nume: numeReal }
  }
  return { buf, nume: numeReal }
}

// Citeste fluxul arhivei pe bucati, cu o coada — fara concatenari repetate
// (concatenarea la fiecare bucata a fost cauza unui "CPU Time exceeded" in Supabase).
class Flux {
  constructor(reader) { this.rdr = reader; this.coada = []; this.disponibil = 0; this.gata = false }
  async umple(n) {
    while (this.disponibil < n && !this.gata) {
      const { value, done } = await this.rdr.read()
      if (done || !value) { this.gata = true; break }
      this.coada.push(Buffer.from(value))
      this.disponibil += value.length
    }
  }
  scoate(n) {
    const cat = Math.min(n, this.disponibil)
    const out = Buffer.allocUnsafe(cat)
    let pus = 0
    while (pus < cat) {
      const b = this.coada[0]
      const iau = Math.min(b.length, cat - pus)
      b.copy(out, pus, 0, iau)
      pus += iau
      if (iau === b.length) this.coada.shift(); else this.coada[0] = b.subarray(iau)
    }
    this.disponibil -= cat
    return out
  }
  async exact(n) { await this.umple(n); return this.disponibil >= n ? this.scoate(n) : null }
  async sari(n) {
    let ramas = n
    while (ramas > 0) {
      await this.umple(Math.min(ramas, 1 << 20))
      if (this.disponibil === 0) return false
      ramas -= this.scoate(Math.min(ramas, this.disponibil)).length
    }
    return true
  }
}

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

  const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
  const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  const SECRET = process.env.SEAP_IMPORT_SECRET
  if (!SUPA_URL || !SERVICE) {
    return res.status(500).json({ error: 'lipsesc SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY din variabilele de mediu Vercel' })
  }

  // acces: secretul serverului (veghea) SAU un utilizator logat (butonul din platforma)
  if (!SECRET || req.headers['x-import-secret'] !== SECRET) {
    const jwt = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!jwt || !ANON) return res.status(401).json({ error: 'unauthorized' })
    const { data: u } = await createClient(SUPA_URL, ANON).auth.getUser(jwt)
    if (!u?.user) return res.status(401).json({ error: 'unauthorized' })
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

  const raport = { adaugate: 0, completate: 0, sarite_existente: 0, erori: [], intrari: 0 }
  const { data: dejaAre } = await supa.from('ofertare_documente_atribuire')
    .select('id, nume_original, fisier_path').eq('licitatie_id', licitatieId)
  const urcate = new Set((dejaAre || []).filter((d) => !estePlaceholder(d)).map((d) => d.nume_original))
  const placeholders = new Map((dejaAre || []).filter(estePlaceholder).map((d) => [d.nume_original, d.id]))

  const scrie = async (rand, nume) => {
    const idPh = placeholders.get(nume)
    const { error } = idPh
      ? await supa.from('ofertare_documente_atribuire').update(rand).eq('id', idPh)
      : await supa.from('ofertare_documente_atribuire').insert(rand)
    if (error) { raport.erori.push(`${nume}: scriere rand - ${error.message}`); return }
    if (idPh) raport.completate++; else raport.adaugate++
  }

  const url = `${SEAP}/NoticeCommon/DownloadArchive/?initNoticeId=${lic.c_notice_id}&sysNoticeTypeId=${lic.sys_notice_type_id}`
  const arh = await fetch(url, { headers: SEAP_HDR })
  if (!arh.ok || !arh.body) return res.status(502).json({ error: `SEAP HTTP ${arh.status}` })

  const flux = new Flux(arh.body.getReader())
  try {
    while (true) {
      const head = await flux.exact(30)
      if (!head || head.readUInt32LE(0) !== 0x04034b50) break
      const metoda = head.readUInt16LE(8)
      const csize = head.readUInt32LE(18)
      const nl = head.readUInt16LE(26), el = head.readUInt16LE(28)
      const numeBuf = await flux.exact(nl); if (!numeBuf) break
      const nume = numeBuf.toString('utf8')
      if (el && !(await flux.sari(el))) break
      raport.intrari++

      const numeCurat = nume.replace(/\.p7s$/i, '')
      if (urcate.has(numeCurat) || JUNK_RE.test(nume)) {
        if (urcate.has(numeCurat)) raport.sarite_existente++
        if (!(await flux.sari(csize))) break
        continue
      }

      const comprimat = await flux.exact(csize)
      if (!comprimat) { raport.erori.push(`${numeCurat}: flux intrerupt`); break }
      try {
        const brut = metoda === 0 ? comprimat : inflateRawSync(comprimat)
        const { buf, nume: numeFinal } = desfaP7s(brut, nume)
        const estePdf = /\.pdf$/i.test(numeFinal)
        const ctype = estePdf ? 'application/pdf' : 'application/octet-stream'
        const safe = numeFinal.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180)
        const path = `${licitatieId}/atribuire/${Date.now().toString(36)}_${safe}`

        if (buf.length > PRAG_RELUABIL) {
          const eroare = await urcaInFelii(SUPA_URL, SERVICE, 'ofertare', path, ctype, buf)
          if (eroare) { raport.erori.push(`${numeFinal}: ${eroare}`); continue }
        } else {
          const { error } = await supa.storage.from('ofertare').upload(path, buf, { contentType: ctype })
          if (error) { raport.erori.push(`${numeFinal}: ${error.message}`); continue }
        }

        await scrie({
          licitatie_id: licitatieId, fisier_path: path, nume_original: numeFinal,
          tip: ghicesteTip(numeFinal), size_bytes: buf.length,
          status_procesare: estePdf ? 'neprocesat' : 'ignorat',
          eroare: estePdf ? null : 'non-PDF - ramane ca fisier (docx/xls/dwg se parseaza in M2)',
          sursa: 'seap',
        }, numeFinal)
        urcate.add(numeFinal)
      } catch (e) {
        raport.erori.push(`${numeCurat}: ${String(e?.message || e)}`)
      }
    }
  } catch (e) {
    raport.erori.push('flux: ' + String(e?.message || e))
  }

  if (!raport.erori.length) {
    await supa.from('ofertare_licitatii').update({ documentatie_adusa_la: new Date().toISOString() }).eq('id', licitatieId)
  }
  return res.status(200).json(raport)
}
