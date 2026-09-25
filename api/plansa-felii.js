// Pregatirea unei planse mari pentru citit de catre AI.
//
// Problema: o plansa A0 scanata are ~140 milioane de pixeli si zeci de MB. Nu poate fi
// trimisa asa nicaieri, iar micsorata intreaga devine ilizibila exact unde conteaza
// (tabelul de dimensionare, cotele, adnotarile pe tronsoane). Solutia e taierea in
// felii care se suprapun putin, fiecare la o marime pe care AI-ul o poate citi.
//
// Al doilea rol, la fel de important: SPUNE cand plansa nu se poate citi. La Manastirea,
// fisierele publicate de autoritate au date deteriorate — se deschid doar in Acrobat,
// iar orice decodor liber vede un dreptunghi gri. Fara verificarea asta, cineva ar fi
// crezut ca AI-ul a citit plansa cand de fapt n-a vazut nimic, si ar fi ofertat pe ea.
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

// 25.09.2026: planșele VECTORIALE (text convertit în curbe, fără scanare) se randează cu MuPDF (WASM pur,
// fără dependențe native — merge pe Vercel Node). Import leneș: doar când e nevoie, ca să nu încărcăm ~10MB wasm degeaba.
const DPI_VECTOR = 200     // A0/A1 la 200 dpi => cotele (text de 1.5–2mm) au ~12–16px, lizibile pe felii de 1600px
const MAX_LATURA_RANDARE = 9000 // plafon pe latura randată (memorie wasm: 9000x9000x3 = 243MB)
const MAX_PAGINI_VECTOR = 6
export async function randeazaVectorial(buf) {
  const mupdf = await import('mupdf')
  const doc = mupdf.Document.openDocument(buf, 'application/pdf')
  const pagini = []
  try {
    const n = Math.min(doc.countPages(), MAX_PAGINI_VECTOR)
    for (let i = 0; i < n; i++) {
      const pag = doc.loadPage(i)
      const [x0, y0, x1, y1] = pag.getBounds()
      const zoom = Math.min(DPI_VECTOR / 72, MAX_LATURA_RANDARE / Math.max(x1 - x0, y1 - y0))
      const pix = pag.toPixmap(mupdf.Matrix.scale(zoom, zoom), mupdf.ColorSpace.DeviceRGB, false, true)
      const w = pix.getWidth(), h = pix.getHeight()
      // PNG din mupdf, apoi sharp face restul (decupaje, jpeg) exact ca la scanări
      const png = Buffer.from(pix.asPNG())
      pix.destroy(); pag.destroy()
      pagini.push({ img: png, latime: w, inaltime: h, dpi: Math.round(zoom * 72) })
    }
  } finally { doc.destroy() }
  return pagini
}

const LATURA = 1600        // latura unei felii trimise la AI
const SUPRAPUNERE = 0.12   // 12% ca sa nu taiem un rand de tabel exact pe margine
const MAX_FELII = 40
const LATURA_FIN = 1000    // 25.09.2026 „recitește fin": zone mai mici din original => rezolutie efectiva mai mare
const MAX_FELII_FIN = 80
const MIN_LATURA_SCAN = 2000 // sub atat, cea mai mare imagine din PDF nu e planșa (ex. sigla semnaturii EasySign)
const MAX_MB = 100   // 07.09.2026: planșele SF Potlogi au 73–92 MB

// Imaginea scanata sta in PDF ca stream JPEG (/DCTDecode). O scoatem direct, fara sa
// randam pagina: e mai rapid si pastreaza rezolutia originala a scanarii.
function jpegDinPdf(buf) {
  const iesiri = []
  let de = 0
  while (iesiri.length < 8) {
    const marca = buf.indexOf('/DCTDecode', de, 'latin1')
    if (marca < 0) break
    de = marca + 10
    const s = buf.indexOf('stream', marca, 'latin1')
    if (s < 0) break
    let start = s + 6
    if (buf[start] === 0x0d) start++
    if (buf[start] === 0x0a) start++
    const sfarsit = buf.indexOf('endstream', start, 'latin1')
    if (sfarsit < 0) break
    const felie = buf.subarray(start, sfarsit)
    if (felie.length > 10000 && felie[0] === 0xff && felie[1] === 0xd8) iesiri.push(felie)
    de = sfarsit
  }
  return iesiri.sort((a, b) => b.length - a.length)
}

// O plansa citibila are fond alb si linii inchise, deci variatie locala. Una stricata
// iese uniforma: decodorul umple cu gri ce nu a putut reface.
//
// Verificarea se face pe imaginea REDUSA, dintr-o singura decodare. Varianta care taia
// noua zone direct din originalul de 140 de milioane de pixeli cerea o decodare completa
// pentru fiecare zona si cadea in productie (toate sondele esuau, iar o plansa buna era
// declarata necitibila). Asa dureaza sub o secunda.
export async function esteCitibila(img) {
  const { data, info } = await sharp(img, { limitInputPixels: false, failOn: 'none' })
    .resize({ width: 1600, fit: 'inside' }).greyscale().raw().toBuffer({ resolveWithObject: true })
  const pas = 4, raza = 60
  let sonde = 0, cuContinut = 0
  for (let r = 1; r < pas; r++) {
    for (let c = 1; c < pas; c++) {
      sonde++
      const cx = Math.floor((c * info.width) / pas), cy = Math.floor((r * info.height) / pas)
      let n = 0, s = 0, s2 = 0
      for (let y = Math.max(0, cy - raza); y < Math.min(info.height, cy + raza); y++) {
        for (let x = Math.max(0, cx - raza); x < Math.min(info.width, cx + raza); x++) {
          const v = data[y * info.width + x]; n++; s += v; s2 += v * v
        }
      }
      if (!n) continue
      const medie = s / n
      const abatere = Math.sqrt(Math.max(0, s2 / n - medie * medie))
      // masurat pe documentatia Manastirea: plansa buna da 3–30 pe fiecare zona,
      // cea alterata da exact 0 peste tot
      if (abatere > 2) cuContinut++
    }
  }
  return { sonde, cu_continut: cuContinut, citibila: cuContinut >= Math.ceil(sonde * 0.25) }
}

// Ciornă AUTOMATĂ de clarificare (niciodată trimisă) când planșe rămân necitibile — logica e în BD
// (ofertare_clarificare_planse_auto, doar service_role): idempotentă, o ciornă per licitație pe lot.
async function clarificareAuto(supa, licitatieId) {
  try {
    const { data, error } = await supa.rpc('ofertare_clarificare_planse_auto', { p_licitatie_id: licitatieId })
    return error ? { eroare: error.message } : data
  } catch (e) { return { eroare: String(e?.message || e).slice(0, 120) } }
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
  if (!docId) return res.status(400).json({ error: 'doc_id lipsa' })

  const supa = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } })
  const { data: doc } = await supa.from('ofertare_documente_atribuire')
    .select('id, licitatie_id, nume_original, fisier_path, size_bytes, analiza').eq('id', docId).single()
  if (!doc) return res.status(404).json({ error: 'document inexistent' })
  if (doc.size_bytes && doc.size_bytes > MAX_MB * 1e6) return res.status(400).json({ error: `document peste ${MAX_MB}MB` })

  const { data: fisier, error: eDl } = await supa.storage.from('ofertare').download(doc.fisier_path)
  if (eDl || !fisier) return res.status(502).json({ error: eDl?.message || 'descarcare esuata' })
  const buf = Buffer.from(await fisier.arrayBuffer())

  const ePdf = /\.pdf$/i.test(doc.nume_original)
  const imagini = ePdf ? jpegDinPdf(buf) : [buf]
  let meta = null
  if (imagini.length) {
    try {
      meta = await sharp(imagini[0], { limitInputPixels: false, failOn: 'none' }).metadata()
    } catch (e) {
      if (!ePdf) return res.status(200).json({ citibila: false, motiv: 'imaginea nu poate fi deschisa: ' + String(e?.message || e).slice(0, 120) })
    }
  }

  // Surse de tăiat: scanarea (JPEG-ul cel mai mare) SAU paginile randate ale unui PDF vectorial.
  // 25.09.2026 (lic. 95, PL1–PL5 Vilcelele): singurul JPEG era sigla semnăturii (900x450). Acum PDF-ul
  // vectorial se RANDEAZĂ; „nu plătim siglă" rămâne pt cazul în care nici randarea nu dă desen.
  let surse = []
  let vectorial = false
  if (ePdf && (!meta || Math.max(meta.width || 0, meta.height || 0) < MIN_LATURA_SCAN)) {
    vectorial = true
    let pagini = [], eroareRandare = null
    try { pagini = await randeazaVectorial(buf) } catch (e) { eroareRandare = String(e?.message || e).slice(0, 160) }
    for (const [i, p] of pagini.entries()) {
      const v = await esteCitibila(p.img)
      if (v.citibila) surse.push({ img: p.img, meta: { width: p.latime, height: p.inaltime }, verdict: v, prefix: pagini.length > 1 ? `p${i + 1}_` : '', dpi: p.dpi })
    }
    if (!surse.length) {
      const motiv = eroareRandare
        ? `PDF vectorial — randarea a eșuat (${eroareRandare}). Consultă planșa manual sau cere-o în format editabil (clarificarea s-a pregătit automat).`
        : `PDF-ul nu conține o scanare a planșei${meta ? ` (cea mai mare imagine are ${meta.width}x${meta.height}px — probabil sigla semnăturii)` : ''}, iar randarea vectorială nu a produs desen citibil. ` +
          'Nu tăiem și nu plătim citirea unei sigle. Consultă planșa manual; clarificarea către autoritate s-a pregătit automat (ciornă).'
      await supa.from('ofertare_documente_atribuire').update({
        analiza: { ...doc.analiza, plansa: { citibila: false, vectorial: true, motiv, latime: meta?.width || null, inaltime: meta?.height || null, randare_esuata: !!eroareRandare } },
        analiza_la: new Date().toISOString(),
      }).eq('id', docId)
      const clarificare = await clarificareAuto(supa, doc.licitatie_id)
      return res.status(200).json({ citibila: false, vectorial: true, motiv, clarificare })
    }
  } else {
    if (!imagini.length || !meta) {
      const mesaj = 'Nu am gasit nicio imagine scanata in document.'
      await supa.from('ofertare_documente_atribuire').update({ analiza: { ...doc.analiza, plansa: { citibila: false, motiv: mesaj } }, analiza_la: new Date().toISOString() }).eq('id', docId)
      return res.status(200).json({ citibila: false, motiv: mesaj })
    }
    const verdict = await esteCitibila(imagini[0])
    if (!verdict.citibila) {
      const motiv = `Imaginea se deschide, dar continutul nu se poate reface: ${verdict.cu_continut} din ${verdict.sonde} zone verificate au desen. ` +
        'Fisierul publicat are date deteriorate — se vede doar in Acrobat. Deschide-l acolo si salveaza-l din nou (Export ca imagine sau tiparire in PDF nou), apoi urca varianta curata.'
      await supa.from('ofertare_documente_atribuire').update({
        analiza: { ...doc.analiza, plansa: { citibila: false, motiv, verificare: verdict, latime: meta.width, inaltime: meta.height } },
        analiza_la: new Date().toISOString(),
        eroare: 'Plansa nu poate fi citita automat — necesita conversie (vezi detalii).',
      }).eq('id', docId)
      return res.status(200).json({ citibila: false, motiv, verificare: verdict, latime: meta.width, inaltime: meta.height, imagini_gasite: imagini.length })
    }
    surse = [{ img: imagini[0], meta, verdict, prefix: '' }]
  }

  // Taiem in felii care se suprapun, ca sa nu pierdem randuri de tabel pe margini.
  // Latura decupajului creste pana cand numarul de felii intra in buget: o plansa A0
  // taiata la 1600px ar iesi in ~90 de bucati, adica 90 de citiri AI pentru un singur
  // desen. Feliile mai mari se micsoreaza la salvare, deci raman citibile.
  // `fin: true` (butonul „recitește fin"): grilă mai deasă — decupaje de 1000px din original, până la 80 de zone.
  const fin = corp.fin === true
  const maxFelii = Math.floor((fin ? MAX_FELII_FIN : MAX_FELII) / surse.length) || 1
  const grila = (meta) => {
    let latura = fin ? LATURA_FIN : LATURA, pas = 0, coloane = 0, randuri = 0
    for (let i = 0; i < 12; i++) {
      pas = Math.floor(latura * (1 - SUPRAPUNERE))
      coloane = Math.max(1, Math.ceil(meta.width / pas))
      randuri = Math.max(1, Math.ceil(meta.height / pas))
      if (coloane * randuri <= maxFelii) break
      latura = Math.floor(latura * 1.25)
    }
    return { latura, pas, coloane, randuri }
  }
  for (const s of surse) {
    s.g = grila(s.meta)
    if (s.g.coloane * s.g.randuri > maxFelii) return res.status(400).json({ error: `plansa ar iesi in ${s.g.coloane * s.g.randuri} felii chiar si la ${s.g.latura}px` })
  }

  const bazaCale = `${doc.licitatie_id}/felii/${docId}`
  // feliile vechi (altă grilă) s-ar citi și ele — le ștergem întâi
  const { data: vechi } = await supa.storage.from('ofertare').list(bazaCale, { limit: 200 })
  if (vechi?.length) await supa.storage.from('ofertare').remove(vechi.map((f) => `${bazaCale}/${f.name}`))
  const felii = []
  for (const { img: sursa, meta, prefix, g: { latura, pas, coloane, randuri } } of surse) {
  for (let r = 0; r < randuri; r++) {
    for (let c = 0; c < coloane; c++) {
      const left = Math.min(c * pas, Math.max(0, meta.width - latura))
      const top = Math.min(r * pas, Math.max(0, meta.height - latura))
      const width = Math.min(latura, meta.width - left)
      const height = Math.min(latura, meta.height - top)
      if (width < 50 || height < 50) continue
      const zona = `${prefix}${r + 1}_${c + 1}`
      try {
        const iesire = await sharp(sursa, { limitInputPixels: false, failOn: 'none' })
          .extract({ left, top, width, height })
          .resize({ width: LATURA, height: LATURA, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82 }).toBuffer()
        const cale = `${bazaCale}/z${zona}.jpg`
        const { error } = await supa.storage.from('ofertare').upload(cale, iesire, { contentType: 'image/jpeg', upsert: true })
        if (error) { felii.push({ zona, eroare: error.message }); continue }
        felii.push({ zona, cale, left, top, width, height, kb: Math.round(iesire.length / 1024) })
      } catch (e) {
        felii.push({ zona, eroare: String(e?.message || e).slice(0, 120) })
      }
    }
  }
  }
  const { meta: m0, verdict, g: { latura, coloane, randuri } } = surse[0]

  const reusite = felii.filter((f) => f.cale)
  // Coloana `analiza` tine mai multe lucruri despre acelasi document (tabelul de
  // dimensionare citit, rezultatul citirii AI). Scriem DOAR cheia `plansa`, altfel
  // sterge restul — asa s-a pierdut o data tabelul de 18 tronsoane de pe plansa 1.1.
  const analiza = {
    ...doc.analiza,
    plansa: {
      citibila: true, latime: m0.width, inaltime: m0.height,
      felii: reusite.length, randuri, coloane, latura, fin,
      ...(vectorial ? { vectorial: true, randat: true, dpi: surse[0].dpi, pagini: surse.length } : {}),
      cale_felii: bazaCale, verificare: verdict,
    },
  }
  await supa.from('ofertare_documente_atribuire')
    .update({ analiza, analiza_la: new Date().toISOString() }).eq('id', docId)
  // planșa a devenit citibilă prin randare => lista din ciorna automată (dacă există) se reîmprospătează
  const clarificare = vectorial ? await clarificareAuto(supa, doc.licitatie_id) : null

  return res.status(200).json({ citibila: true, vectorial, clarificare, pagini: surse.length, latime: m0.width, inaltime: m0.height, felii: reusite.length, esuate: felii.length - reusite.length, cale_felii: bazaCale, lista: reusite })
}
