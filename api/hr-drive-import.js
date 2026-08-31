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
import JSZip from 'jszip'
import { tokenGoogle, listeazaFolder, fisiereRecursiv, descarcaFisier, E_FOLDER } from './_google.js'
import { detectDocumentType, potrivesteAngajat, numeDinDosar, esteSablon, detectDate } from './_hr_clasificare.js'

const DOSARE_ANGAJATI = '1PFtUo5zV--1W5dam4fZrnyXoxWHjQ4CK'  // „A - DOSARELE ANGAJATILOR"
const BUCKET = 'documente-personal'
const BUGET_MS = 240_000        // functia are 300s; ne oprim cu marja de siguranta
// Bucket-ul `documente-personal` refuza peste 10MB, deci verificam noi inainte sa
// descarcam degeaba. Masurat pe 282 de fisiere reale din arhiva: mediana 205 KB,
// cel mai mare 7,3 MB — niciunul nu atinge plafonul.
const MAX_FISIER = 10 * 1024 * 1024
// Arhivele .zip se desfac din zbor si fiecare fisier dinauntru intra ca document normal —
// pe server erau 26, toate dosare IGI, si asteptau luni de zile sa le desfaca cineva.
// Restul formatelor (.rar, .7z) raman de desfacut manual: nu avem cu ce le citi aici.
const ARHIVE = /\.(zip|rar|7z|tar|gz)$/i
const MAX_ARHIVA = 200 * 1024 * 1024
// Ce accepta bucket-ul (allowed_mime_types) — restul intrarilor din arhive se raporteaza.
const MIME_EXT = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
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

  // Detectia fisierelor ratacite: autorizatia lui NICOLAE MARIAN a stat luni de zile in dosarul
  // lui KODITHUWAKKU, fiindca importul leaga documentul de om dupa numele FOLDERULUI, nu al
  // fisierului. De acum, un fisier al carui nume contine numele complet al ALTUI angajat se
  // importa normal, dar se strange intr-o lista de banuieli si HR-ul primeste o notificare.
  const faraDiac = (x) => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  // Doar angajatii ACTIVI intra in detectie: Dumitrescu exista de doua ori in baza (pensionare
  // + CIM nou in aceeasi zi), iar numele randului vechi, inactiv, i-ar alarma propriile acte.
  const numeDetectie = employees
    .filter((e) => e.active !== false)
    .map((e) => ({ id: e.id, nume: String(e.name || '').trim(), norm: faraDiac(String(e.name || '').trim()) }))
    .filter((e) => e.norm.split(/\s+/).length >= 2)
  const banuieli = []
  // Un nume care sta in dosarele a 3+ oameni e al unui imputernicit, nu un fisier ratacit.
  // Harta se umple din TOATA baza (mai jos) si abia apoi din lotul curent: prima rulare live
  // a alarmat actele Nataliei (imputernicita IGI) fiindca in lotul acela aparea in doar 2 dosare.
  const dosarePeNume = new Map()
  const noteazaDosar = (nume, employeeId) => {
    if (!dosarePeNume.has(nume)) dosarePeNume.set(nume, new Set())
    dosarePeNume.get(nume).add(employeeId)
  }
  const numeStrain = (numeFisier, employeeId) => {
    const n = faraDiac(numeFisier)
    return numeDetectie.find((x) => x.id !== employeeId && n.includes(x.norm)) || null
  }

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
    const strainIstoric = numeStrain(r.fisier_nume, r.employee_id)
    if (strainIstoric) noteazaDosar(strainIstoric.nume, r.employee_id)
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

  // Drumul comun al unui document spre platforma, fie ca vine ca fisier de pe Drive, fie ca
  // intrare dintr-o arhiva. NU arunca: erorile se aduna in raport, ca un fisier stricat sa nu
  // opreasca restul dosarului.
  async function salveazaDocument({ employee, dosar, rand, nume, buf, mime, extensie, idDrive, nota }) {
    try {
      const { tip } = detectDocumentType(nume, tipuri)
      const tipFinal = tip || tipNeclasificat
      if (!tipFinal) { rand.erori.push(`${nume}: nu exista tipul „neclasificat"`); erori++; return }

      const cale = `${employee.id}/drive/${String(idDrive).replace(/[^A-Za-z0-9_.-]/g, '_')}.${extensie}`
      const { error: eUp } = await supa.storage.from(BUCKET)
        .upload(cale, buf, { contentType: mime, upsert: true })
      if (eUp) throw new Error(`storage: ${eUp.message}`)

      const { data: ins, error: eIns } = await supa.from('hr_documente_personale').insert({
        employee_id: employee.id,
        tip_id: tipFinal.id,
        fisier_path: cale,
        fisier_nume: nume,
        fisier_mime: mime,
        fisier_size_bytes: buf.length,
        data_emitere: detectDate(nume),
        activ: true,
        drive_file_id: idDrive,
        observatii: nota + (tip ? '' : ' Tipul NU s-a putut deduce din numele fisierului — de incadrat.'),
      }).select('id').single()
      // 23505 = fisierul era deja adus (cursa intre doua rulari) — nu e eroare
      if (eIns && eIns.code !== '23505') throw new Error(`insert: ${eIns.message}`)
      if (eIns) { rand.sarite++; sarite++; return }

      if (!tip) { rand.neclasificate++; neclasificate++ }
      aduseDeja.add(idDrive)
      dupaContinut.set(cheieDoc(employee.id, nume, buf.length),
        { id: ins?.id ?? null, employee_id: employee.id, drive_file_id: idDrive })

      const strain = numeStrain(nume, employee.id)
      if (strain) {
        banuieli.push({ doc_id: ins?.id ?? null, dosar: dosar.name, fisier: nume, seamana_cu: strain.nume })
        noteazaDosar(strain.nume, employee.id)
      }

      rand.adaugate++; adaugate++
    } catch (e) {
      rand.erori.push(`${nume}: ${String(e.message || e).slice(0, 120)}`)
      erori++
    }
  }

  const raport = []
  const nepotrivite = []
  let erori_notificare = null
  let adaugate = 0, sarite = 0, sabloane = 0, neclasificate = 0, erori = 0, deja_aveam = 0, arhive_desfacute = 0
  let i = deLa

  for (; i < dosare.length; i++) {
    if (Date.now() - inceput > BUGET_MS) break
    const dosar = dosare[i]

    if (NU_E_ANGAJAT.test(dosar.name)) { nepotrivite.push({ dosar: dosar.name, motiv: 'nu e dosar de angajat' }); continue }

    // DOAR angajati activi. Dosarul lui Dumitrescu se lega de randul ei vechi, inactiv
    // (pensionare + CIM nou in aceeasi zi), si 16 documente au curs pe angajatul mort.
    // Fostii angajati stau oricum sub `!A - CIM - INCETATE`, care e sarit; un dosar orfan
    // ajunge vizibil la `nepotrivite`, nu umple in tacere un rand inactiv.
    const aliasId = ALIASE[numeDinDosar(dosar.name).trim().toLowerCase()]
    const potrivire = aliasId
      ? { employee: employees.find((e) => e.id === aliasId), confidence: 100, marja: 100 }
      : potrivesteAngajat(numeDinDosar(dosar.name), employees)
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
      if (ARHIVE.test(f.name)) {
        if (!/\.zip$/i.test(f.name)) { rand.erori.push(`${f.name}: arhiva ne-zip — de desfacut pe Drive`); erori++; continue }
        if (Number(f.size || 0) > MAX_ARHIVA) { rand.erori.push(`${f.name}: arhiva peste 200MB — de desfacut pe Drive`); erori++; continue }
        if (doarProba) { rand.arhive = (rand.arhive || 0) + 1; arhive_desfacute++; continue }
        try {
          const { buf: bufZip } = await descarcaFisier(token, f)
          const zip = await JSZip.loadAsync(bufZip)
          const intrari = Object.values(zip.files)
            .filter((e) => !e.dir)
            .filter((e) => !/^__MACOSX\//i.test(e.name) && !/(^|\/)(\.|Thumbs\.db$|desktop\.ini$)/i.test(e.name))
            .sort((a, b) => a.name.localeCompare(b.name))
          for (const intrare of intrari) {
            if (Date.now() - inceput > BUGET_MS) break
            const numeIntrare = intrare.name.split('/').pop()
            // Id stabil per intrare: la reluare, indexul unic (employee_id, drive_file_id) o sare.
            const idIntrare = `${f.id}#${intrare.name}`
            if (aduseDeja.has(idIntrare)) { rand.sarite++; sarite++; continue }
            if (esteSablon(numeIntrare)) { rand.sabloane++; sabloane++; continue }
            const continut = await intrare.async('nodebuffer')
            if (continut.length > MAX_FISIER) { rand.erori.push(`${f.name} → ${numeIntrare}: peste 10MB, cat accepta bucket-ul`); erori++; continue }
            if (dupaContinut.get(cheieDoc(employee.id, numeIntrare, continut.length))) { rand.deja_aveam++; deja_aveam++; continue }
            const ext = numeIntrare.includes('.') ? numeIntrare.split('.').pop().toLowerCase() : ''
            const mimeIntrare = MIME_EXT[ext]
            if (!mimeIntrare) { rand.erori.push(`${f.name} → ${numeIntrare}: tipul .${ext || '?'} nu e acceptat de bucket`); erori++; continue }
            await salveazaDocument({
              employee, dosar, rand, nume: numeIntrare, buf: continut, mime: mimeIntrare,
              extensie: ext, idDrive: idIntrare,
              nota: `Adus automat din arhiva „${f.name}" (dosarul „${dosar.name}").`,
            })
          }
          arhive_desfacute++
        } catch (e) {
          rand.erori.push(`${f.name}: arhiva nu s-a putut desface — ${String(e.message || e).slice(0, 100)}`)
          erori++
        }
        continue
      }
      if (Number(f.size || 0) > MAX_FISIER) {
        rand.erori.push(`${f.name}: peste 10MB, cat accepta bucket-ul`); erori++; continue
      }

      if (doarProba) {
        const { tip } = detectDocumentType(f.name, tipuri)
        if (!tip) { rand.neclasificate++; neclasificate++ }
        rand.adaugate++; adaugate++
        continue
      }

      try {
        const { buf, mime, extensie } = await descarcaFisier(token, f)
        await salveazaDocument({
          employee, dosar, rand, nume: f.name, buf, mime, extensie, idDrive: f.id,
          nota: `Adus automat din Google Drive (dosarul „${dosar.name}").`,
        })
      } catch (e) {
        rand.erori.push(`${f.name}: ${String(e.message || e).slice(0, 120)}`)
        erori++
      }
    }

    raport.push(rand)
  }

  const gata = i >= dosare.length

  // Banuielile de fisiere ratacite, filtrate prin istoricul intreg (harta umpluta mai sus):
  // la scanarea manuala a serverului, filtrul a taiat ~40 de fals-pozitive si a lasat 7 reale.
  const posibil_ratacite = banuieli.filter((b) => (dosarePeNume.get(b.seamana_cu)?.size ?? 0) < 3)

  if (!doarProba && posibil_ratacite.length) {
    const ids = posibil_ratacite.map((b) => b.doc_id).filter(Boolean)
    if (ids.length) {
      const { data: docsSusp } = await supa.from('hr_documente_personale').select('id, observatii').in('id', ids)
      for (const d of docsSusp || []) {
        const b = posibil_ratacite.find((x) => x.doc_id === d.id)
        await supa.from('hr_documente_personale').update({
          observatii: `${d.observatii || ''} ATENTIE: numele fisierului contine numele altui angajat (${b.seamana_cu}) — verifica daca nu cumva e in dosarul gresit.`.trim(),
        }).eq('id', d.id)
      }
    }
    try {
      const { data: destinatari } = await supa.from('profiles').select('id').in('email', ANUNTA)
      const exemple = posibil_ratacite.slice(0, 3)
        .map((b) => `„${b.fisier}" în dosarul ${b.dosar}`).join('; ')
      await supa.from('notifications').insert((destinatari || []).map((d) => ({
        profile_id: d.id,
        type: 'warning',
        modul: 'HR',
        title: `⚠ ${posibil_ratacite.length} ${posibil_ratacite.length === 1 ? 'fișier pare rătăcit' : 'fișiere par rătăcite'} în alt dosar`,
        message: `${exemple}${posibil_ratacite.length > 3 ? ' …' : ''} Verifică și mută-le pe server, în folderul omului potrivit.`,
        link_to: '/hr',
      })))
    } catch (_) { /* notificarea ratata nu strica importul */ }
  }

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
    adaugate, sarite, deja_aveam, arhive_desfacute, sabloane_ignorate: sabloane, neclasificate, erori,
    posibil_ratacite: posibil_ratacite.map(({ doc_id, ...rest }) => rest),
    nepotrivite,
    raport,
    secunde: Math.round((Date.now() - inceput) / 1000),
    continua: !gata,
    de_la_urmator: gata ? null : i,
  })
}
