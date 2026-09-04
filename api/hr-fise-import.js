// Aduce fisele de aptitudini (medicina muncii) si avizele psihologice de pe server in platforma.
//
// Natalia le scaneaza intr-un singur folder de pe NAS, oglindit pe Drive:
// „1 - ANGAJATI - NATALIA / CONDICA PREZENTA ... / FISE APTITUDINI / FISE APTITUDINI - ANGAJATI".
// Sunt pdf-uri si jpeg-uri, cu numele omului si data de expirare in numele fisierului
// („11.01.2027 - NICOLAE VASILE.jpeg"). In platforma, fisa e un rand in hr_autorizatii
// (tip 18 = fisa, 19 = aviz psihologic) — de multe ori randul exista deja, cu data, dar
// fara scan. Aici legam scanul de randul lui; cand nu exista rand, il facem.
//
// Reguli (TKT-2026-0181):
//  - numele fisierului → om + data (api/_hr_fise.js); ce nu se leaga sigur se raporteaza, nu se ghiceste
//  - rand cu aceeasi data, fara fisier → primeste fisierul
//  - rand cu aceeasi data, cu fisier → se sare (pagina 2 a scanului intra ca rand separat, „pag. 2")
//  - fara rand la data aia: daca omul are deja o fisa MAI NOUA, scanul e istoric si se sare
//    (altfel ar umple alertele de expirare cu fise vechi); daca nu, se face rand nou
//  - fara data in nume: se leaga de singurul rand fara fisier al omului, daca exista unul singur
//  - idempotent: fiecare fisier adus poarta „[drive:ID]" in observatii si nu mai intra a doua oara
import { createClient } from '@supabase/supabase-js'
import { tokenGoogle, listeazaFolder, descarcaFisier, E_FOLDER } from './_google.js'
import { citesteNumeFisa, leagaAngajat, TIP_FISA, TIP_AVIZ } from './_hr_fise.js'

const FOLDER_FISE = '1OZjGR6ncKKC_HAydHTmXvUbHKsinjPOf'  // „FISE APTITUDINI - ANGAJATI"
const BUCKET = 'autorizatii'
const BUGET_MS = 240_000
const MAX_FISIER = 10 * 1024 * 1024
const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
const ANUNTA = ['natalia.udrea@gazpet.ro', 'marilena.tudorache@gazpet.ro']
const MARCAJ = (id) => `[drive:${id}]`

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'doar POST' })

  const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
  const SECRET = process.env.SEAP_IMPORT_SECRET
  if (!SUPA_URL || !SERVICE) return res.status(500).json({ error: 'lipsesc variabilele Supabase din Vercel' })
  if (!SECRET || req.headers['x-import-secret'] !== SECRET) return res.status(401).json({ error: 'neautorizat' })

  const inceput = Date.now()
  const corp = typeof req.body === 'object' && req.body ? req.body : {}
  const doarProba = corp.dry_run === true
  const doar = corp.doar ? String(corp.doar).toLowerCase() : null   // filtru pe numele fisierului

  const supa = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } })

  let token
  try { token = await tokenGoogle() } catch (e) { return res.status(500).json({ error: String(e.message || e) }) }

  let fisiere
  try {
    fisiere = (await listeazaFolder(token, FOLDER_FISE)).filter((f) => !E_FOLDER(f))
  } catch (e) { return res.status(502).json({ error: String(e.message || e) }) }
  fisiere.sort((a, b) => a.name.localeCompare(b.name, 'ro'))
  if (doar) fisiere = fisiere.filter((f) => f.name.toLowerCase().includes(doar))

  const [{ data: employees, error: eEmp }, { data: randuri, error: eR }] = await Promise.all([
    supa.from('employees').select('id, name, active'),
    supa.from('hr_autorizatii')
      .select('id, employee_id, tip_id, data_expirare, fisier_path, fisier_nume, observatii')
      .in('tip_id', [TIP_FISA, TIP_AVIZ]).is('deleted_at', null),
  ])
  if (eEmp || !employees?.length) return res.status(500).json({ error: `angajati: ${eEmp?.message || 'lista goala'}` })
  if (eR) return res.status(500).json({ error: `hr_autorizatii: ${eR.message}` })

  // ce am adus deja (marcajul din observatii) + datele cunoscute per om (departajeaza omonimii)
  const aduse = new Set()
  const dateCunoscute = new Map()
  for (const r of randuri) {
    const m = String(r.observatii || '').match(/\[drive:([^\]]+)\]/g) || []
    for (const x of m) aduse.add(x.slice(7, -1))
    if (r.data_expirare) {
      if (!dateCunoscute.has(r.employee_id)) dateCunoscute.set(r.employee_id, new Set())
      dateCunoscute.get(r.employee_id).add(r.data_expirare)
    }
  }
  const randuriOm = (empId, tip) => randuri.filter((r) => r.employee_id === empId && r.tip_id === tip)

  const raport = []           // o linie per fisier: { fisier, ce, ... }
  const nepotrivite = []      // fisiere pe care nu le-am putut lega de un om
  let legate = 0, noi = 0, sarite = 0, erori = 0, deja = 0, istoric = 0
  let procesate = 0, oprit = false

  for (const f of fisiere) {
    if (Date.now() - inceput > BUGET_MS) { oprit = true; break }
    if (aduse.has(f.id)) { deja++; continue }
    procesate++

    const citit = citesteNumeFisa(f.name)
    if (!MIME[citit.ext]) { raport.push({ fisier: f.name, ce: 'sarit', motiv: `format .${citit.ext} — bucket-ul accepta pdf/jpg/png` }); sarite++; continue }
    if (Number(f.size || 0) > MAX_FISIER) { raport.push({ fisier: f.name, ce: 'sarit', motiv: 'peste 10MB' }); sarite++; continue }

    const { employee, motiv } = leagaAngajat(citit, employees, dateCunoscute)
    if (!employee) { nepotrivite.push({ fisier: f.name, motiv, data: citit.data_expirare }); continue }

    const ale = randuriOm(employee.id, citit.tip_id)
    const tipNume = citit.tip_id === TIP_AVIZ ? 'aviz psihologic' : 'fisa de aptitudini'
    let tinta = null       // randul care primeste fisierul
    let nou = null         // randul de creat
    let nota = `Adus automat de pe server (Drive) din „${f.name}". ${MARCAJ(f.id)}`

    if (citit.data_expirare) {
      const laData = ale.filter((r) => r.data_expirare === citit.data_expirare)
      const maxData = ale.map((r) => r.data_expirare).filter(Boolean).sort().pop() || null
      if (citit.pagina > 1) {
        // pagina a doua a aceluiasi scan: rand separat, ca sa nu ramana pe server
        nou = { data_expirare: citit.data_expirare, observatii: `Pagina ${citit.pagina} a scanului. ${nota}` }
      } else if (laData.some((r) => !r.fisier_path)) {
        tinta = laData.find((r) => !r.fisier_path)
      } else if (laData.length) {
        raport.push({ fisier: f.name, ce: 'sarit', angajat: employee.name, motiv: `are deja fisier la ${citit.data_expirare}: „${laData[0].fisier_nume}"` })
        sarite++; continue
      } else if (maxData && citit.data_expirare < maxData) {
        raport.push({ fisier: f.name, ce: 'istoric', angajat: employee.name, motiv: `in platforma e una mai noua (${maxData})` })
        istoric++; continue
      } else {
        nou = { data_expirare: citit.data_expirare, observatii: nota }
      }
    } else {
      const faraFisier = ale.filter((r) => !r.fisier_path)
      if (citit.pagina > 1) {
        nou = { data_expirare: null, observatii: `Pagina ${citit.pagina} a scanului. Data de expirare lipseste din numele fisierului — de completat. ${nota}` }
      } else if (faraFisier.length === 1) {
        tinta = faraFisier[0]
        nota += ' Data de expirare nu era in numele fisierului — verifica ca scanul e cel de la data randului.'
      } else if (!ale.length) {
        nou = { data_expirare: null, observatii: `Data de expirare lipseste din numele fisierului — de completat. ${nota}` }
      } else {
        raport.push({ fisier: f.name, ce: 'sarit', angajat: employee.name, motiv: `fara data in nume si omul are ${ale.length} randuri de ${tipNume} — nu stiu la care e` })
        sarite++; continue
      }
    }

    if (doarProba) {
      raport.push({ fisier: f.name, ce: tinta ? 'ar lega' : 'ar crea', angajat: employee.name, rand: tinta?.id ?? null, data: citit.data_expirare, tip: tipNume })
      if (tinta) legate++; else noi++
      continue
    }

    try {
      const { buf, mime } = await descarcaFisier(token, f)
      const cale = `${employee.id}/drive_${String(f.id).replace(/[^A-Za-z0-9_-]/g, '_')}.${citit.ext}`
      const { error: eUp } = await supa.storage.from(BUCKET).upload(cale, buf, { contentType: MIME[citit.ext] || mime, upsert: true })
      if (eUp) throw new Error(`storage: ${eUp.message}`)
      const fisier = { fisier_path: cale, fisier_nume: f.name, fisier_mime: MIME[citit.ext] || mime, fisier_size_bytes: buf.length, modificat_la: new Date().toISOString() }

      if (tinta) {
        const obs = [tinta.observatii, nota].filter(Boolean).join(' ')
        const { error } = await supa.from('hr_autorizatii').update({ ...fisier, observatii: obs }).eq('id', tinta.id)
        if (error) throw new Error(`update: ${error.message}`)
        tinta.fisier_path = cale; tinta.fisier_nume = f.name; tinta.observatii = obs
        legate++
        raport.push({ fisier: f.name, ce: 'legat', angajat: employee.name, rand: tinta.id, data: tinta.data_expirare, tip: tipNume })
      } else {
        const { data: ins, error } = await supa.from('hr_autorizatii').insert({
          employee_id: employee.id, tip_id: citit.tip_id, emitent: 'Medicina muncii',
          data_expirare: nou.data_expirare,
          data_emitere: nou.data_expirare ? anulAnterior(nou.data_expirare) : null,
          fara_expirare: false, observatii: nou.observatii, ...fisier,
        }).select('id').single()
        if (error) throw new Error(`insert: ${error.message}`)
        randuri.push({ id: ins.id, employee_id: employee.id, tip_id: citit.tip_id, data_expirare: nou.data_expirare, fisier_path: cale, fisier_nume: f.name, observatii: nou.observatii })
        noi++
        raport.push({ fisier: f.name, ce: 'creat', angajat: employee.name, rand: ins.id, data: nou.data_expirare, tip: tipNume })
      }
      aduse.add(f.id)
    } catch (e) {
      erori++
      raport.push({ fisier: f.name, ce: 'eroare', angajat: employee.name, motiv: String(e.message || e).slice(0, 140) })
    }
  }

  // HR-ul afla singur ce a intrat si ce a ramas de lamurit
  if (!doarProba && (legate + noi > 0 || nepotrivite.length)) {
    try {
      const { data: destinatari } = await supa.from('profiles').select('id').in('email', ANUNTA)
      if (destinatari?.length) {
        const ex = nepotrivite.slice(0, 3).map((n) => `„${n.fisier}"`).join(', ')
        await supa.from('notifications').insert(destinatari.map((d) => ({
          profile_id: d.id, type: nepotrivite.length ? 'warning' : 'info', modul: 'HR',
          title: `🩺 ${legate + noi} fișe medicale aduse de pe server`,
          message: `${legate} legate de rânduri existente, ${noi} rânduri noi.` +
            (nepotrivite.length ? ` ${nepotrivite.length} fișiere nu au putut fi legate de un angajat (${ex}${nepotrivite.length > 3 ? ' …' : ''}) — redenumește-le pe server cu numele exact din platformă.` : ''),
          link_to: '/hr',
        })))
      }
    } catch (_) { /* notificarea ratata nu strica importul */ }
  }

  return res.status(200).json({
    dry_run: doarProba, fisiere_total: fisiere.length, procesate, deja_aduse: deja,
    legate, noi, sarite, istoric, erori, nepotrivite, raport,
    secunde: Math.round((Date.now() - inceput) / 1000), continua: oprit,
  })
}

function anulAnterior(iso) {
  const [a, l, z] = iso.split('-').map(Number)
  return `${a - 1}-${String(l).padStart(2, '0')}-${String(z).padStart(2, '0')}`
}
