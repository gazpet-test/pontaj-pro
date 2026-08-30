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
// Bucket-ul `documente-personal` refuza peste 10MB, deci verificam noi inainte sa
// descarcam degeaba. Masurat pe 282 de fisiere reale din arhiva: mediana 205 KB,
// cel mai mare 7,3 MB — niciunul nu atinge plafonul.
const MAX_FISIER = 10 * 1024 * 1024
// Arhivele nu se pot incadra pe un tip de document si nu se pot deschide din interfata.
// Se raporteaza, ca sa fie desfacute pe Drive de catre om.
const ARHIVE = /\.(zip|rar|7z|tar|gz)$/i
// Cine e anuntat cand intra documente noi. Deliberat scurt: 14 persoane au bifa HR,
// iar o notificare zilnica catre toti devine zgomot pe care nu-l mai citeste nimeni.
// Aici sunt cei care chiar lucreaza dosarele.
const ANUNTA = ['natalia.udrea@gazpet.ro', 'marilena.tudorache@gazpet.ro']
const INCREDERE_MINIMA = 60     // sub atat nu legam un dosar de un angajat

// Potriviri hotarate de om, acolo unde numele de pe Drive nu se poate lega automat.
// Cheia e numele dosarului cu litere mici; valoarea, id-ul din employees.
const ALIASE = {
  // Razvan, 30.08.2026: acelasi om, Natalia a scris numele prescurtat pe dosar.
  'singh subh kumar': 136,  // → SINGH SUBHKARAN
}

// Foldere care nu sunt oameni: cele organizatorice incep cu „!”
// (`!A - CIM - INCETATE`, `!B - COLABORATOR EXTERN`) sau cu numele firmei.
const NU_E_ANGAJAT = /^\s*!|^\s*gazpet|nu se printeaza/i

/**
 * Citeste un tabel intreg, pe pagini. PostgREST poate taia raspunsul la o limita de randuri,
 * iar aici lista „ce am adus deja" trece de 2.500 de linii — daca ar veni trunchiata, importul
 * ar crede ca fisierele lipsesc si le-ar aduce inca o data.
 */
async function toatePaginile(construieste, pas = 1000) {
  const out = []
  for (let de = 0; ; de += pas) {
    const { data, error } = await construieste(de, de + pas - 1)
    if (error) throw new Error(`citire pe pagini: ${error.message}`)
    out.push(...(data || []))
    if (!data || data.length < pas) return out
  }
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
  const existente = await toatePaginile((de, la) => supa
    .from('hr_documente_personale')
    .select('drive_file_id')
    .not('drive_file_id', 'is', null)
    .order('id')
    .range(de, la))
  const aduseDeja = new Set(existente.map((r) => r.drive_file_id))

  // Acelasi document poate exista deja in platforma, pus de om inainte sa avem Drive-ul:
  // atunci nu are `drive_file_id`, deci verificarea de mai sus nu-l vede si l-am aduce a doua
  // oara. Prima rulare a facut exact asta — 1.151 de copii, pe 117 oameni. Asa ca ne uitam si
  // la perechea nume+marime, care s-a dovedit de incredere: la toate cele 993 de grupuri
  // gasite, fisierele erau identice bit cu bit (acelasi MD5 in storage).
  const dejaInPlatforma = await toatePaginile((de, la) => supa
    .from('hr_documente_personale')
    .select('id, employee_id, fisier_nume, fisier_size_bytes, drive_file_id')
    .eq('activ', true)
    .order('id')
    .range(de, la))
  const cheieDoc = (employeeId, nume, marime) =>
    `${employeeId}|${String(nume || '').trim().toLowerCase()}|${marime}`
  const dupaContinut = new Map()
  for (const r of dejaInPlatforma) {
    dupaContinut.set(cheieDoc(r.employee_id, r.fisier_nume, r.fisier_size_bytes), r)
  }

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
  let erori_notificare = null
  let adaugate = 0, sarite = 0, sabloane = 0, neclasificate = 0, erori = 0, deja_aveam = 0
  let i = deLa

  for (; i < dosare.length; i++) {
    if (Date.now() - inceput > BUGET_MS) break
    const dosar = dosare[i]

    if (NU_E_ANGAJAT.test(dosar.name)) { nepotrivite.push({ dosar: dosar.name, motiv: 'nu e dosar de angajat' }); continue }

    // Fostii angajati au si ei dosar pe Drive, iar documentele lor tot ale lor sunt.
    const aliasId = ALIASE[numeDinDosar(dosar.name).trim().toLowerCase()]
    const potrivire = aliasId
      ? { employee: employees.find((e) => e.id === aliasId), confidence: 100, marja: 100 }
      : potrivesteAngajat(numeDinDosar(dosar.name), employees, { includeInactivi: true })
    const { employee, confidence, marja, ambiguu } = potrivire
    if (ambiguu) {
      nepotrivite.push({ dosar: dosar.name, motiv: 'doi angajati la fel de probabili — nu ghicesc' })
      continue
    }
    if (!employee || confidence < INCREDERE_MINIMA) {
      nepotrivite.push({ dosar: dosar.name, motiv: 'niciun angajat potrivit', potrivire: confidence })
      continue
    }

    let fisiere
    try {
      fisiere = await fisiereRecursiv(token, dosar.id)
    } catch (e) {
      erori++; raport.push({ dosar: dosar.name, eroare: String(e.message || e).slice(0, 150) }); continue
    }

    const rand = { dosar: dosar.name, angajat: employee.name, employee_id: employee.id, potrivire: confidence, fisiere: fisiere.length, adaugate: 0, sarite: 0, deja_aveam: 0, sabloane: 0, neclasificate: 0, erori: [] }

    for (const f of fisiere) {
      if (Date.now() - inceput > BUGET_MS) break
      if (aduseDeja.has(f.id)) { rand.sarite++; sarite++; continue }
      if (esteSablon(f.name)) { rand.sabloane++; sabloane++; continue }

      // Documentul e deja in platforma, pus de om inainte de Drive. Nu-l aducem a doua oara;
      // ii lipim doar id-ul de Drive pe randul existent, ca sa fie sarit si la rularile viitoare.
      // (Fisierele Google native n-au `size` in listare — pentru ele verificarea se sare de la sine.)
      const gemene = f.size ? dupaContinut.get(cheieDoc(employee.id, f.name, Number(f.size))) : null
      if (gemene) {
        if (!gemene.drive_file_id && !doarProba) {
          const { error: eLeg } = await supa.from('hr_documente_personale')
            .update({ drive_file_id: f.id }).eq('id', gemene.id)
          if (!eLeg) { gemene.drive_file_id = f.id; aduseDeja.add(f.id) }
        }
        rand.deja_aveam++; deja_aveam++
        continue
      }
      if (ARHIVE.test(f.name)) { rand.erori.push(`${f.name}: arhiva — de desfacut pe Drive`); erori++; continue }
      if (Number(f.size || 0) > MAX_FISIER) {
        rand.erori.push(`${f.name}: peste 10MB, cat accepta bucket-ul`); erori++; continue
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
        dupaContinut.set(cheieDoc(employee.id, f.name, buf.length),
          { id: null, employee_id: employee.id, drive_file_id: f.id })
        rand.adaugate++; adaugate++
      } catch (e) {
        rand.erori.push(`${f.name}: ${String(e.message || e).slice(0, 120)}`)
        erori++
      }
    }

    raport.push(rand)
  }

  const gata = i >= dosare.length

  // Cand a intrat ceva nou, HR-ul afla singur — altfel automatizarea ar fi doar
  // pe jumatate: fisierele intra, dar nu stie nimeni ca au intrat.
  if (!doarProba && adaugate > 0) {
    try {
      const { data: destinatari } = await supa.from('profiles').select('id').in('email', ANUNTA)
      if (destinatari?.length) {
        const oameni = raport.filter((r) => r.adaugate > 0).length
        await supa.from('notifications').insert(destinatari.map((d) => ({
          profile_id: d.id,
          type: 'info',
          modul: 'HR',
          title: `${adaugate} documente noi din Drive`,
          message: `Aduse pentru ${oameni} ${oameni === 1 ? 'angajat' : 'angajați'}.` +
            (neclasificate ? ` ${neclasificate} au nevoie de încadrare pe tip.` : '') +
            (erori ? ` ${erori} fișiere nu au putut fi aduse.` : ''),
          link_to: '/hr',
        })))
      }
    } catch (e) {
      // o notificare ratata nu are voie sa strice importul
      erori_notificare = String(e?.message || e).slice(0, 120)
    }
  }

  return res.status(200).json({
    erori_notificare,
    dry_run: doarProba,
    dosare_total: dosare.length,
    dosare_procesate: i - deLa,
    adaugate, sarite, deja_aveam, sabloane_ignorate: sabloane, neclasificate, erori,
    nepotrivite,
    raport,
    secunde: Math.round((Date.now() - inceput) / 1000),
    continua: !gata,
    de_la_urmator: gata ? null : i,
  })
}
