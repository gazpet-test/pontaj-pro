// Aduce dosarele de personal din Google Drive in platforma.
//
// Pe Drive, arhiva HR are un folder per angajat („NUME PRENUME - FUNCTIE") sub
// `A - DOSARELE ANGAJATILOR`, cu ~1.700 de fisiere in total. In platforma erau 917
// documente si doi oameni fara absolut nimic, desi aveau dosar complet pe Drive.
//
// De ce server si nu din chat: un scan de 250 KB devine ~340 KB cand e trecut prin
// text, iar la 1.700 de fisiere nu incape nicaieri. Iar varianta „le facem publice pe
// link ca sa le traga cineva" nu exista: sunt carti de identitate, caziere, pasapoarte.
// Deci fisierele merg direct Drive → storage, fara sa treaca prin ochii nimanui.
//
// Rularea e pe loturi: se opreste inainte sa expire functia si spune de unde sa reia.
// Sigur la reluare: fiecare document retine `drive_file_id`, iar un index unic
// impiedica acelasi fisier sa intre de doua ori la acelasi om.
import { createClient } from '@supabase/supabase-js'
import { tokenGoogle, listeazaFolder, fisiereRecursiv, descarcaFisier, E_FOLDER } from './_google.js'
import { detectDocumentType, potrivesteAngajat, numeDinDosar, esteSablon, detectDate } from './_hr_clasificare.js'

const DOSARE_ANGAJATI = '1PFtUo5zV--1W5dam4fZrnyXoxWHjQ4CK'  // „A - DOSARELE ANGAJATILOR"
const BUCKET = 'documente-personal'
const BUGET_MS = 240_000        // functia are 300s; ne oprim cu marja de siguranta
const MAX_FISIER = 40 * 1024 * 1024
const INCREDERE_MINIMA = 60     // sub atat nu legam un dosar de un angajat

// Foldere care nu sunt oameni.
const NU_E_ANGAJAT = /gazpet\s*-?\s*invest|nu se printeaza|^gazpet hr/i

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
  const radacina = corp.folder_id || DOSARE_ANGAJATI
  const deLa = Number(corp.de_la) || 0
  const doarProba = corp.dry_run === true
  const doarDosarul = corp.doar_dosar ? String(corp.doar_dosar).toLowerCase() : null

  const inceput = Date.now()
  const supa = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } })

  let token
  try {
    token = await tokenGoogle()
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) })
  }

  // Angajatii si tipurile de document, o singura data pentru toata rularea
  const [{ data: employees }, { data: tipuri }] = await Promise.all([
    supa.from('employees').select('id, name, active'),
    supa.from('hr_documente_personale_tipuri').select('id, cod, denumire').eq('activ', true),
  ])
  if (!employees?.length) return res.status(500).json({ error: 'nu am putut citi angajatii' })
  const tipNeclasificat = tipuri.find((t) => t.cod === 'neclasificat')

  // Ce s-a adus deja din Drive — ca reluarea sa nu refaca munca
  const { data: existente } = await supa
    .from('hr_documente_personale')
    .select('drive_file_id')
    .not('drive_file_id', 'is', null)
  const aduseDeja = new Set((existente || []).map((r) => r.drive_file_id))

  // Dosarele de pe Drive, in ordine stabila (ca `de_la` sa insemne acelasi lucru la reluare)
  let dosare
  try {
    dosare = (await listeazaFolder(token, radacina)).filter(E_FOLDER)
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) })
  }
  dosare.sort((a, b) => a.name.localeCompare(b.name, 'ro'))
  if (doarDosarul) dosare = dosare.filter((d) => d.name.toLowerCase().includes(doarDosarul))

  const raport = []
  const nepotrivite = []
  let adaugate = 0, sarite = 0, sabloane = 0, neclasificate = 0, erori = 0
  let i = deLa

  for (; i < dosare.length; i++) {
    if (Date.now() - inceput > BUGET_MS) break
    const dosar = dosare[i]

    if (NU_E_ANGAJAT.test(dosar.name)) { nepotrivite.push({ dosar: dosar.name, motiv: 'nu e dosar de angajat' }); continue }

    const { employee, confidence, marja } = potrivesteAngajat(numeDinDosar(dosar.name), employees)
    if (!employee || confidence < INCREDERE_MINIMA) {
      nepotrivite.push({ dosar: dosar.name, motiv: 'niciun angajat potrivit', potrivire: confidence })
      continue
    }
    if (marja === 0 && confidence < 100) {
      nepotrivite.push({ dosar: dosar.name, motiv: 'doi angajati la fel de probabili — nu ghicesc', potrivire: confidence })
      continue
    }

    let fisiere
    try {
      fisiere = await fisiereRecursiv(token, dosar.id)
    } catch (e) {
      erori++; raport.push({ dosar: dosar.name, eroare: String(e.message || e).slice(0, 150) }); continue
    }

    const rand = { dosar: dosar.name, angajat: employee.name, employee_id: employee.id, potrivire: confidence, fisiere: fisiere.length, adaugate: 0, sarite: 0, sabloane: 0, neclasificate: 0, erori: [] }

    for (const f of fisiere) {
      if (Date.now() - inceput > BUGET_MS) break
      if (aduseDeja.has(f.id)) { rand.sarite++; sarite++; continue }
      if (esteSablon(f.name)) { rand.sabloane++; sabloane++; continue }
      if (Number(f.size || 0) > MAX_FISIER) {
        rand.erori.push(`${f.name}: peste 40MB`); erori++; continue
      }

      const { tip } = detectDocumentType(f.name, tipuri)
      const tipFinal = tip || tipNeclasificat
      if (!tipFinal) { rand.erori.push(`${f.name}: nu exista tipul „neclasificat"`); erori++; continue }
      if (!tip) { rand.neclasificate++; neclasificate++ }

      if (doarProba) { rand.adaugate++; adaugate++; continue }

      try {
        const { buf, mime, extensie } = await descarcaFisier(token, f)
        const cale = `${employee.id}/drive/${f.id}.${extensie}`
        const { error: eUp } = await supa.storage.from(BUCKET)
          .upload(cale, buf, { contentType: mime, upsert: true })
        if (eUp) throw new Error(`storage: ${eUp.message}`)

        const { error: eIns } = await supa.from('hr_documente_personale').insert({
          employee_id: employee.id,
          tip_id: tipFinal.id,
          fisier_path: cale,
          fisier_nume: f.name,
          fisier_mime: mime,
          fisier_size_bytes: buf.length,
          data_emitere: detectDate(f.name),
          activ: true,
          drive_file_id: f.id,
          observatii: tip
            ? `Adus automat din Google Drive (dosarul „${dosar.name}").`
            : `Adus automat din Google Drive (dosarul „${dosar.name}"). Tipul NU s-a putut deduce din numele fisierului — de incadrat.`,
        })
        // 23505 = fisierul era deja adus (cursa intre doua rulari) — nu e eroare
        if (eIns && eIns.code !== '23505') throw new Error(`insert: ${eIns.message}`)
        if (eIns) { rand.sarite++; sarite++; continue }

        aduseDeja.add(f.id)
        rand.adaugate++; adaugate++
      } catch (e) {
        rand.erori.push(`${f.name}: ${String(e.message || e).slice(0, 120)}`)
        erori++
      }
    }

    raport.push(rand)
  }

  const gata = i >= dosare.length
  return res.status(200).json({
    dry_run: doarProba,
    dosare_total: dosare.length,
    dosare_procesate: i - deLa,
    adaugate, sarite, sabloane_ignorate: sabloane, neclasificate, erori,
    nepotrivite,
    raport,
    secunde: Math.round((Date.now() - inceput) / 1000),
    continua: !gata,
    de_la_urmator: gata ? null : i,
  })
}
