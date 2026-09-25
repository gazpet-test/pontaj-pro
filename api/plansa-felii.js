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

// 25.09.2026: planșele VECTORIALE se randează cu pdf.js + @napi-rs/canvas (vezi _randare-pdf.js).
// MuPDF a fost scos în aceeași zi: licență AGPL, risc pe o platformă folosită prin internet.
import { randeazaVectorial, analizeazaSemnale } from './_randare-pdf.js'
import { scrieAnalizaCAS } from './_cas.js'
const DPI_VECTOR_FIN = 300 // „recitește fin" pe vectorial: randare mai densă, felii normale de 1600px

const LATURA = 1600        // latura unei felii trimise la AI
const SUPRAPUNERE = 0.12   // 12% ca sa nu taiem un rand de tabel exact pe margine
const MAX_FELII = 60      // 25.09.2026: 40 forța mărirea decupajelor + micșorare => rezoluția se pierdea (Jakarinos)
const MICSORARE_MAX_OK = 0.8 // sub atât, textul de 1.5mm devine nesigur — se marchează rezolutie_redusa
const LATURA_FIN = 1000    // 25.09.2026 „recitește fin": zone mai mici din original => rezolutie efectiva mai mare
const MAX_FELII_FIN = 80
const MIN_LATURA_SCAN = 2000 // sub atat, cea mai mare imagine din PDF nu e planșa (ex. sigla semnaturii EasySign)
const MAX_MB = 100   // 07.09.2026: planșele SF Potlogi au 73–92 MB

// Imaginea scanata sta in PDF ca stream JPEG (/DCTDecode). O scoatem direct, fara sa
// randam pagina: e mai rapid si pastreaza rezolutia originala a scanarii.
export function jpegDinPdf(buf) {
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

// R3: alege sursa. Semnalele declanșează randarea paginii complete; o scanare mare care acoperă pagina rămâne imagine.
// Semnale de IMAGINE (raport 2:1 sub 1500px, imagine <10% din pagina afișată) => randare. Semnale de DOCUMENT
// (>500 path-uri, text de semnătură, /ByteRange) => randare doar dacă imaginea selectată nu domină pagina (<50%).
// Pragul MIN_LATURA_SCAN rămâne fallback (randare), nu verdict de siglă.
export function decideRuta(meta, a) {
  if (!meta) return { randeaza: true, motiv: 'nicio imagine' }
  const s = a?.semnale || {}, fr = a?.imagine_selectata?.fractie_pagina
  if (s.raport_2_1_sub_1500 || s.imagine_sub_10_la_suta) return { randeaza: true, motiv: 'semnal imagine' }
  // 25.09.2026: conținut vectorial/text desenat PESTE imagine (în bbox) => randare completă, imaginea singură pierde cotele
  const ap = a?.acoperire_pdf
  if (ap && ((ap.paths_peste || 0) + (ap.text_peste || 0)) > 0) return { randeaza: true, motiv: 'suprapunere vectorială peste imagine' }
  if ((s.paths_peste_500 || s.text_semnatura || s.byte_range) && (fr == null || fr < 0.5)) return { randeaza: true, motiv: 'semnal document' }
  if (Math.max(meta.width || 0, meta.height || 0) < MIN_LATURA_SCAN) return { randeaza: true, motiv: 'sub prag rezoluție (fallback)' }
  return { randeaza: false, motiv: 'scanare' }
}

// R4 (Copilot): scrierea `analiza` e compare-and-set (api/_cas.js — testat în scripts/test-cas-felii.mjs).
export { scrieAnalizaCAS }

// R4 (Copilot) pct. 1: acoperirea paginii la o SCANARE din PDF. Procentul (fractie_pagina ≥50%) rămâne DOAR pentru
// rutare (decideRuta). Acoperirea e demonstrată doar dacă imaginea acoperă practic toată pagina (≥95% din aria
// paginii în coordonate PDF) ȘI pe pagină nu există path-uri / text / alte imagini în afara bbox-ului ei
// (operatorList, _randare-pdf.js → acoperire_pdf). Randarea completă e tratată separat în handler.
export const PRAG_ACOPERIRE_PAGINA = 0.95
export function acoperireScanPdf(a, scanMare = false) {
  if (scanMare) return { demonstrata: false, tip: null, motiv: 'PDF >40MB — analiză sărită' }
  if (!a || a.eroare) return { demonstrata: false, tip: null, motiv: 'analiza structurală a eșuat' }
  const fr = a.imagine_selectata?.fractie_pagina
  if (fr == null) return { demonstrata: false, tip: null, motiv: 'imaginea nu a fost localizată pe pagină' }
  const ap = a.acoperire_pdf || {}
  if (fr < PRAG_ACOPERIRE_PAGINA) return { demonstrata: false, tip: null, motiv: `scanarea acoperă ${Math.round(fr * 100)}% din pagină (<${PRAG_ACOPERIRE_PAGINA * 100}%) — restul paginii necitit` }
  if (ap.paths_in_afara == null) return { demonstrata: false, tip: null, motiv: 'conținutul din afara imaginii nu a putut fi verificat' }
  const afara = (ap.paths_in_afara || 0) + (ap.text_in_afara || 0) + (ap.imagini_in_afara || 0)
  if (afara) return { demonstrata: false, tip: null, motiv: `pagina are conținut în afara scanării (${ap.paths_in_afara} path-uri, ${ap.text_in_afara} texte, ${ap.imagini_in_afara || 0} imagini) — necitit` }
  if (ap.paths_peste == null) return { demonstrata: false, tip: null, motiv: 'conținutul desenat peste scanare nu a putut fi verificat' }
  if ((ap.paths_peste || 0) + (ap.text_peste || 0)) return { demonstrata: false, tip: null, motiv: `pagina are conținut desenat peste scanare (${ap.paths_peste} path-uri, ${ap.text_peste} texte) — necesită randare completă` }
  return { demonstrata: true, tip: 'imagine_pagina_intreaga', motiv: `scanarea acoperă ${Math.round(fr * 100)}% din pagină, fără conținut în afara ei` }
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
  // R3: semnale structurale (NU verdict) => randare pagină completă; sigla doar cu dovadă (vezi decideRuta).
  let semnaleSigla = null
  // PDF-uri mari cu scanare ≥2000px: analiza încarcă tot PDF-ul în pdf.js (timeout Vercel) — rămâne regula veche
  const scanMare = meta && Math.max(meta.width, meta.height) >= 2000 && buf.length > 40 * 1024 * 1024
  if (ePdf && !scanMare) {
    try { semnaleSigla = await analizeazaSemnale(buf, meta ? { width: meta.width, height: meta.height } : null, imagini[0] || null) }
    catch (e) { semnaleSigla = { eroare: String(e?.message || e).slice(0, 160) } }
  }
  const ruta = decideRuta(meta, semnaleSigla)
  // R3 (Copilot): sursa_sigla_dovedita = IDENTIFICARE POZITIVĂ (raport 2:1, <1000px, conținut simplu, text de
  // semnătură suprapus pe imagine). Imagine mică + conținut în afara bbox-ului = doar declanșator de randare.
  const siglaDovedita = semnaleSigla?.sursa_sigla_dovedita === true
  const plansaSemnale = ePdf ? { semnale_sigla: { ...(semnaleSigla?.semnale || {}), paths: semnaleSigla?.paths ?? null,
    imagine_selectata: semnaleSigla?.imagine_selectata || null, dovada: semnaleSigla?.dovada || null,
    identificare: semnaleSigla?.identificare || null, declansator_randare: !!semnaleSigla?.declansator_randare, ruta: ruta.motiv,
    ...(scanMare ? { analiza_sarita: 'PDF >40MB — analiza structurală sărită; acoperirea paginii nedemonstrată' } : {}),
    ...(semnaleSigla?.eroare ? { eroare: semnaleSigla.eroare } : {}) }, sursa_sigla_dovedita: siglaDovedita } : {}
  // R3 pct. 2: acoperirea paginii trebuie DEMONSTRATĂ, altfel citirea iese partial/„de verificat” (niciodată ok).
  // Imagine încărcată direct (JPG/PNG, nu PDF) = documentul însuși: acoperirea imaginii ORIGINALE (nu a unei pagini)
  let acoperireDemonstrata = !ePdf
  let motivAcoperire = ePdf ? null : 'imagine directă'
  let acoperireTip = ePdf ? null : 'imagine_originala'
  if (ePdf && ruta.randeaza) {
    vectorial = true
    let pagini = [], eroareRandare = null
    try { pagini = await randeazaVectorial(buf, corp.fin === true ? DPI_VECTOR_FIN : undefined) } catch (e) { eroareRandare = String(e?.message || e).slice(0, 160) }
    const totalPagini = pagini[0]?.total_pagini || pagini.length
    for (const [i, p] of pagini.entries()) {
      const v = await esteCitibila(p.img)
      if (v.citibila) surse.push({ img: p.img, meta: { width: p.latime, height: p.inaltime }, verdict: v, prefix: pagini.length > 1 ? `p${i + 1}_` : '', dpi: p.dpi, pagina: i + 1, latime_pt: p.latime_pt, inaltime_pt: p.inaltime_pt })
    }
    // R3: randarea nu a dat desen, dar există o imagine NEdovedită drept siglă și citibilă => rămâne imaginea
    if (surse.length) {
      acoperireDemonstrata = !eroareRandare && pagini.length >= totalPagini
      acoperireTip = acoperireDemonstrata ? 'randare_completa' : null
      motivAcoperire = acoperireDemonstrata ? 'randare pagină completă' : `randate ${pagini.length} din ${totalPagini} pagini`
    }
    if (!surse.length && meta && imagini.length && !siglaDovedita) {
      const v = await esteCitibila(imagini[0])
      // fallback pe imagine: randarea n-a reușit => acoperirea paginii NU e demonstrată (rezultat de verificat)
      if (v.citibila) { vectorial = false; surse.push({ img: imagini[0], meta, verdict: v, prefix: '' })
        acoperireDemonstrata = false; acoperireTip = null; motivAcoperire = eroareRandare ? 'randare eșuată — fallback pe imagine' : 'randarea n-a dat desen — fallback pe imagine' }
    }
    if (!surse.length) {
      const motiv = eroareRandare
        ? `PDF vectorial — randarea a eșuat (${eroareRandare}). Consultă planșa manual sau cere-o în format editabil (clarificarea s-a pregătit automat).`
        : siglaDovedita
          ? `Imaginea din PDF (${meta.width}x${meta.height}px) e identificată pozitiv drept sigla semnăturii, iar randarea vectorială nu a produs desen citibil. ` +
            'Nu tăiem și nu plătim citirea unei sigle. Consultă planșa manual; clarificarea către autoritate s-a pregătit automat (ciornă).'
          : `Sursă de reverificat/de randat: randarea vectorială nu a produs desen citibil${meta ? ` (cea mai mare imagine, ${meta.width}x${meta.height}px, nu e identificată drept siglă și nici citibilă)` : ''}. ` +
            'Consultă planșa manual; clarificarea către autoritate s-a pregătit automat (ciornă).'
      const w0 = await scrieAnalizaCAS(supa, docId, doc, (a) => ({ ...a, plansa: { citibila: false, vectorial: true, motiv, latime: meta?.width || null, inaltime: meta?.height || null,
        randare_esuata: !!eroareRandare, acoperire_demonstrata: false, rezultat: 'partial', rezultat_motiv: 'de verificat: ' + (eroareRandare ? 'randare eșuată (eșec tehnic, nu ilizibil)' : 'randare fără desen citibil'), ...plansaSemnale } }))
      if (!w0.ok) return res.status(w0.status || 409).json({ error: w0.error })
      const clarificare = await clarificareAuto(supa, doc.licitatie_id)
      return res.status(200).json({ citibila: false, vectorial: true, motiv, clarificare })
    }
  } else {
    if (!imagini.length || !meta) {
      const mesaj = 'Nu am gasit nicio imagine scanata in document.'
      const w0 = await scrieAnalizaCAS(supa, docId, doc, (a) => ({ ...a, plansa: { citibila: false, motiv: mesaj, acoperire_demonstrata: false, ...plansaSemnale } }))
      if (!w0.ok) return res.status(w0.status || 409).json({ error: w0.error })
      return res.status(200).json({ citibila: false, motiv: mesaj })
    }
    const verdict = await esteCitibila(imagini[0])
    if (!verdict.citibila) {
      const motiv = `Imaginea se deschide, dar continutul nu se poate reface: ${verdict.cu_continut} din ${verdict.sonde} zone verificate au desen. ` +
        'Fisierul publicat are date deteriorate — se vede doar in Acrobat. Deschide-l acolo si salveaza-l din nou (Export ca imagine sau tiparire in PDF nou), apoi urca varianta curata.'
      const w0 = await scrieAnalizaCAS(supa, docId, doc, (a) => ({ ...a, plansa: { citibila: false, motiv, verificare: verdict, latime: meta.width, inaltime: meta.height, acoperire_demonstrata: false, ...plansaSemnale } }),
        { eroare: 'Plansa nu poate fi citita automat — necesita conversie (vezi detalii).' })
      if (!w0.ok) return res.status(w0.status || 409).json({ error: w0.error })
      return res.status(200).json({ citibila: false, motiv, verificare: verdict, latime: meta.width, inaltime: meta.height, imagini_gasite: imagini.length })
    }
    surse = [{ img: imagini[0], meta, verdict, prefix: '' }]
    // scanare din PDF: ≥50% decide doar ruta; acoperirea cere ≥95% din pagină + nimic în afara bbox-ului
    if (ePdf) {
      const ac = acoperireScanPdf(semnaleSigla, scanMare)
      acoperireDemonstrata = ac.demonstrata; acoperireTip = ac.tip; motivAcoperire = ac.motiv
    }
  }

  // Taiem in felii care se suprapun, ca sa nu pierdem randuri de tabel pe margini.
  // Latura decupajului creste pana cand numarul de felii intra in buget: o plansa A0
  // taiata la 1600px ar iesi in ~90 de bucati, adica 90 de citiri AI pentru un singur
  // desen. Feliile mai mari se micsoreaza la salvare, deci raman citibile.
  // `fin: true` (butonul „recitește fin"): grilă mai deasă — decupaje de 1000px din original, până la 80 de zone.
  const fin = corp.fin === true
  const maxFelii = Math.floor((fin ? MAX_FELII_FIN : MAX_FELII) / surse.length) || 1
  const grila = (meta) => {
    let latura = fin && !vectorial ? LATURA_FIN : LATURA, pas = 0, coloane = 0, randuri = 0
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
  for (const [iSursa, { img: sursa, meta, prefix, g: { latura, pas, coloane, randuri } }] of surse.entries()) {
  for (let r = 0; r < randuri; r++) {
    for (let c = 0; c < coloane; c++) {
      const left = Math.min(c * pas, Math.max(0, meta.width - latura))
      const top = Math.min(r * pas, Math.max(0, meta.height - latura))
      const width = Math.min(latura, meta.width - left)
      const height = Math.min(latura, meta.height - top)
      if (width < 50 || height < 50) continue
      const zona = `${prefix}${r + 1}_${c + 1}`
      try {
        const decupaj = sharp(sursa, { limitInputPixels: false, failOn: 'none' })
          .extract({ left, top, width, height })
          .resize({ width: LATURA, height: LATURA, fit: 'inside', withoutEnlargement: true })
        const iesire = await decupaj.clone().jpeg({ quality: 82 }).toBuffer()
        // felie albă (margine, spațiu gol) — se păstrează în manifest, dar se știe că n-are ce da
        const st = await sharp(iesire).greyscale().stats()
        const goala = (st.channels[0]?.stdev ?? 99) < 1.5
        const cale = `${bazaCale}/z${zona}.jpg`
        const { error } = await supa.storage.from('ofertare').upload(cale, iesire, { contentType: 'image/jpeg', upsert: true })
        if (error) { felii.push({ zona, eroare: error.message }); continue }
        felii.push({ zona, cale, left, top, width, height, sursa: iSursa, kb: Math.round(iesire.length / 1024), ...(goala ? { goala: true } : {}) })
      } catch (e) {
        felii.push({ zona, eroare: String(e?.message || e).slice(0, 120) })
      }
    }
  }
  }
  const { meta: m0, verdict, g: { latura, coloane, randuri } } = surse[0]

  const reusite = felii.filter((f) => f.cale)
  // Manifest: zonele AȘTEPTATE (toate, inclusiv cele căzute la upload) — citirea compară cu ce găsește în
  // storage și nu declară planșa completă dacă lipsește vreuna (Jakarinos, 25.09.2026).
  const zoneAsteptate = felii.map((f) => f.zona)
  // Micșorarea efectivă: decupaj > LATURA => felia salvată e redusă. Sub 0.8 cotele mici devin nesigure.
  const micsorare = Math.min(...surse.map((s) => Math.min(1, LATURA / s.g.latura)))
  const rezolutieRedusa = micsorare < MICSORARE_MAX_OK
    ? `felii micșorate la ${Math.round(micsorare * 100)}% (planșă foarte mare) — cotele mici pot fi ratate; folosește „recitește fin"`
    : null
  // Coloana `analiza` tine mai multe lucruri despre acelasi document (tabelul de
  // dimensionare citit, rezultatul citirii AI). Scriem DOAR cheia `plansa`, altfel
  // sterge restul — asa s-a pierdut o data tabelul de 18 tronsoane de pe plansa 1.1.
  const plansaNoua = {
      citibila: true, latime: m0.width, inaltime: m0.height,
      felii: reusite.length, randuri, coloane, latura, fin,
      ...(vectorial ? { vectorial: true, randat: true, dpi: surse[0].dpi, pagini: surse.length } : {}),
      cale_felii: bazaCale, verificare: verdict,
      zone_asteptate: zoneAsteptate,
      // R4 (T11): geometria fiecărei zone în pixelii sursei [left, top, width, height, index sursă] + sursele
      // (pagina PDF, dimensiuni px și, la randare vectorială, în puncte PDF) => _regiune pe tronson (x0..y1 în pt).
      zone_geom: Object.fromEntries(felii.filter((f) => f.width).map((f) => [f.zona, [f.left, f.top, f.width, f.height, f.sursa]])),
      surse_geom: surse.map((s) => ({ pagina: s.pagina || 1, latime: s.meta.width, inaltime: s.meta.height, dpi: s.dpi || null,
        latime_pt: s.latime_pt || null, inaltime_pt: s.inaltime_pt || null })),
      suprapunere: SUPRAPUNERE, felii_goale: reusite.filter((f) => f.goala).length,
      micsorare: +micsorare.toFixed(2), rezolutie_redusa: rezolutieRedusa,
      // 25.09.2026 (audit T4/T11): amprenta tăierii — o citire se poate relua pe zone doar pe ACEEAȘI tăiere
      taiat_la: new Date().toISOString(),
      ...plansaSemnale,
      acoperire_demonstrata: acoperireDemonstrata, acoperire_motiv: motivAcoperire, acoperire_tip: acoperireTip,
      ...(!vectorial && meta && Math.max(meta.width || 0, meta.height || 0) < MIN_LATURA_SCAN ? { avertisment_rezolutie: `sursa are ${meta.width}x${meta.height}px (<${MIN_LATURA_SCAN}) — avertisment, nu dovadă de siglă` } : {}),
  }
  // R4: retăierea schimbă jetonul citirii (citire_ai.rev) => o rundă de citire în zbor pe tăierea veche
  // nu mai poate scrie peste (compare-and-set în ofertare-plansa-citeste; la recitire vede alt taiat_la => 409).
  // Scrierea însăși e compare-and-set pe rev-ul citit la început (o rundă care a scris între timp => recitim o dată).
  const w = await scrieAnalizaCAS(supa, docId, doc, (a) => ({ ...a, plansa: plansaNoua,
    ...(a.citire_ai ? { citire_ai: { ...a.citire_ai, rev: `taiere-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } } : {}) }))
  if (!w.ok) return res.status(w.status || 409).json({ error: w.error, incercari: w.incercari })
  // planșa a devenit citibilă prin randare => lista din ciorna automată (dacă există) se reîmprospătează
  const clarificare = vectorial ? await clarificareAuto(supa, doc.licitatie_id) : null

  return res.status(200).json({ citibila: true, vectorial, clarificare, pagini: surse.length, latime: m0.width, inaltime: m0.height, felii: reusite.length, esuate: felii.length - reusite.length, rezolutie_redusa: rezolutieRedusa, cale_felii: bazaCale })
}
