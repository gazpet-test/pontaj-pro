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

const LATURA = 1600        // latura unei felii trimise la AI
const SUPRAPUNERE = 0.12   // 12% ca sa nu taiem un rand de tabel exact pe margine
const MAX_FELII = 40
const MAX_MB = 60

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
async function esteCitibila(img) {
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

  const imagini = /\.pdf$/i.test(doc.nume_original) ? jpegDinPdf(buf) : [buf]
  if (!imagini.length) {
    const mesaj = 'Nu am gasit nicio imagine scanata in document.'
    await supa.from('ofertare_documente_atribuire').update({ analiza: { ...doc.analiza, plansa: { citibila: false, motiv: mesaj } }, analiza_la: new Date().toISOString() }).eq('id', docId)
    return res.status(200).json({ citibila: false, motiv: mesaj })
  }

  const sursa = imagini[0]
  let meta
  try {
    meta = await sharp(sursa, { limitInputPixels: false, failOn: 'none' }).metadata()
  } catch (e) {
    return res.status(200).json({ citibila: false, motiv: 'imaginea nu poate fi deschisa: ' + String(e?.message || e).slice(0, 120) })
  }

  const verdict = await esteCitibila(sursa)
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

  // Taiem in felii care se suprapun, ca sa nu pierdem randuri de tabel pe margini.
  // Latura decupajului creste pana cand numarul de felii intra in buget: o plansa A0
  // taiata la 1600px ar iesi in ~90 de bucati, adica 90 de citiri AI pentru un singur
  // desen. Feliile mai mari se micsoreaza la salvare, deci raman citibile.
  let latura = LATURA, pas = 0, coloane = 0, randuri = 0
  for (let i = 0; i < 12; i++) {
    pas = Math.floor(latura * (1 - SUPRAPUNERE))
    coloane = Math.max(1, Math.ceil(meta.width / pas))
    randuri = Math.max(1, Math.ceil(meta.height / pas))
    if (coloane * randuri <= MAX_FELII) break
    latura = Math.floor(latura * 1.25)
  }
  if (coloane * randuri > MAX_FELII) {
    return res.status(400).json({ error: `plansa ar iesi in ${coloane * randuri} felii chiar si la ${latura}px` })
  }

  const bazaCale = `${doc.licitatie_id}/felii/${docId}`
  const felii = []
  for (let r = 0; r < randuri; r++) {
    for (let c = 0; c < coloane; c++) {
      const left = Math.min(c * pas, Math.max(0, meta.width - latura))
      const top = Math.min(r * pas, Math.max(0, meta.height - latura))
      const width = Math.min(latura, meta.width - left)
      const height = Math.min(latura, meta.height - top)
      if (width < 50 || height < 50) continue
      try {
        const iesire = await sharp(sursa, { limitInputPixels: false, failOn: 'none' })
          .extract({ left, top, width, height })
          .resize({ width: LATURA, height: LATURA, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82 }).toBuffer()
        const cale = `${bazaCale}/z${r + 1}_${c + 1}.jpg`
        const { error } = await supa.storage.from('ofertare').upload(cale, iesire, { contentType: 'image/jpeg', upsert: true })
        if (error) { felii.push({ zona: `${r + 1}_${c + 1}`, eroare: error.message }); continue }
        felii.push({ zona: `${r + 1}_${c + 1}`, cale, left, top, width, height, kb: Math.round(iesire.length / 1024) })
      } catch (e) {
        felii.push({ zona: `${r + 1}_${c + 1}`, eroare: String(e?.message || e).slice(0, 120) })
      }
    }
  }

  const reusite = felii.filter((f) => f.cale)
  // Coloana `analiza` tine mai multe lucruri despre acelasi document (tabelul de
  // dimensionare citit, rezultatul citirii AI). Scriem DOAR cheia `plansa`, altfel
  // sterge restul — asa s-a pierdut o data tabelul de 18 tronsoane de pe plansa 1.1.
  const analiza = {
    ...doc.analiza,
    plansa: {
      citibila: true, latime: meta.width, inaltime: meta.height,
      felii: reusite.length, randuri, coloane, latura,
      cale_felii: bazaCale, verificare: verdict,
    },
  }
  await supa.from('ofertare_documente_atribuire')
    .update({ analiza, analiza_la: new Date().toISOString() }).eq('id', docId)

  return res.status(200).json({ citibila: true, latime: meta.width, inaltime: meta.height, felii: reusite.length, esuate: felii.length - reusite.length, cale_felii: bazaCale, lista: reusite })
}
