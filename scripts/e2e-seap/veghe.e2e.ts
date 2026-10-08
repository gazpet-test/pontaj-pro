import { strict as assert } from 'node:assert'
import * as F from './fake_supabase.ts'
let handler: any
Object.defineProperty(Deno, 'serve', { value: (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown() {} } }, configurable: true, writable: true })
Deno.env.set('SUPABASE_URL', 'http://supa'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE'); Deno.env.set('SUPABASE_ANON_KEY', 'ANON'); Deno.env.set('RESEND_API_KEY', 'K')
// D2: treapta Vercel activă în harness (altfel „sarit: lipseste SEAP_IMPORT_SECRET”) — apelurile se văd în log
Deno.env.set('SEAP_IMPORT_SECRET', 'S')
const P = (n: number) => `CN1095546/${String(n).padStart(5, '0')}`
let liste: Record<number, any[]> = {}
let getAll: Record<number, any[]> = {}
let log: string[] = []
let raspunsImport: (body: any) => any = () => ({ continua: false })
// R1: importul REAL (handler-ul ofertare-seap-import, același fals de BD) în loc de răspunsul simulat; conținutul fișierelor SEAP
let importReal = false
let fis: Record<string, string> = {}
let hImport: any = null
// E2: statusul mailului (Resend); E6: corpurile apelurilor de import, lista care eșuează pentru import (apelul n >= esecListaDeLa
// din rulare; veghea face apelul 1), DownloadArchive vizibil în log; setTimeout scurtat (reîncercările SEAP nu așteaptă secunde)
let mailStatus = 200
let corpuriImport: any[] = []
let apeluriLista = 0, esecListaDeLa = Infinity
// Jakarinos r4: Resend cu Idempotency-Key — o cheie deja trimisă cu succes (24 h) întoarce același răspuns fără mail nou
let cheiMail: string[] = []
const cheiTrimise = new Set<string>()
let laMail: (() => void) | null = null
const stOrig = globalThis.setTimeout
globalThis.setTimeout = ((fn: any, _ms?: number, ...a: any[]) => stOrig(fn, 0, ...a)) as any
globalThis.fetch = (async (u: any, init?: any) => {
  const url = String(u)
  const notice = Number(/initNoticeId=(\d+)/.exec(url)?.[1] ?? JSON.parse(init?.body || '{}').initNoticeId)
  if (url.includes('GetDfNoticeSectionFiles')) {
    apeluriLista++
    if (apeluriLista >= esecListaDeLa) { log.push(`lista ${notice} 404`); return new Response('x', { status: 404 }) }
    log.push(`lista ${notice}`); return new Response(JSON.stringify({ dfNoticeDocs: liste[notice] || [] }))
  }
  if (url.includes('DownloadArchive')) { log.push('arhiva'); return new Response('no', { status: 500 }) }
  if (url.includes('GetSection4View')) return new Response(JSON.stringify({}))
  if (url.includes('NoticeDocument/GetAll')) { const it = getAll[notice] || []; return new Response(JSON.stringify({ items: it, total: it.length })) }
  if (url.includes('/f/')) return new Response(new TextEncoder().encode(fis[url.split('/f/')[1]] ?? 'RASPUNS'))
  if (url.includes('functions/v1/ofertare-seap-import')) {
    const b = JSON.parse(init.body); log.push(`import ${b.licitatie_id} de_la ${b.de_la_index}`); corpuriImport.push(b)
    if (importReal) return await hImport(new Request(url, init))
    return new Response(JSON.stringify(raspunsImport(b)))
  }
  if (url.includes('api.resend.com')) {
    const b = JSON.parse(init.body), k = init.headers?.['Idempotency-Key'] ?? ''
    cheiMail.push(k)
    if (k && cheiTrimise.has(k)) { log.push('resend-idem ' + b.subject); return new Response('{}', { status: 200 }) }
    log.push('mail ' + b.subject + ' to=' + b.to.join(','))
    laMail?.()
    if (mailStatus === 200 && k) cheiTrimise.add(k)
    return new Response('{}', { status: mailStatus })
  }
  if (url.includes('/api/seap-import')) { log.push('vercel ' + JSON.parse(init.body).licitatie_id); return new Response('{}') }
  return new Response('?', { status: 404 })
}) as any
// notificările se văd în ordine în jurnalul falsului
await import('../../supabase/functions/ofertare-seap-veghe/index.ts')
const hVeghe = handler
await import('../../supabase/functions/ofertare-seap-import/index.ts')
hImport = handler
handler = hVeghe
// ceasul veghei (BUGET_TACUT_MS): testele îl pot muta înainte
const dn = Date.now.bind(Date)
let deplasare = 0
Date.now = () => dn() + deplasare
function reset() {
  deplasare = 0
  for (const k of Object.keys(F.db)) F.db[k].length = 0
  F.storage.clear(); F.jurnal.length = 0; liste = {}; getAll = {}; log = []; raspunsImport = () => ({ continua: false }); importReal = false; fis = {}
  mailStatus = 200; corpuriImport = []; apeluriLista = 0; esecListaDeLa = Infinity; cheiMail = []; cheiTrimise.clear(); laMail = null; for (const k of Object.keys(F.esecInsert)) delete F.esecInsert[k]
  delete F.esecInsertProfil.id; delete F.laUpdate.fn; for (const k of Object.keys(F.esecMaybe)) delete F.esecMaybe[k]; for (const k of Object.keys(F.esecSelect)) delete F.esecSelect[k]
  F.db.profiles.push({ id: 'owner', is_owner: true, email: 'o@x' })
}
const lic = (id: number) => F.db.ofertare_licitatii.push({ id, nr_anunt: 'L' + id, obiect: 'o', c_notice_id: id, sys_notice_type_id: 2, termen_depunere: new Date(Date.now() + 864e6).toISOString(), created_by: null, responsabil_id: null })
let idR = 700
const rand = (licId: number, nume: string, cod: string | null, extra: any = {}) => { const id = idR++; F.db.ofertare_documente_atribuire.push({ id, licitatie_id: licId, nume_original: nume, fisier_path: `${licId}/atribuire/r${id}`, seap_cod: cod, size_bytes: 10, seap_meta: null, ...extra }); return id }
// rând cu conținut în Storage (importul real compară sha-ul — F5 / R2)
const randC = (licId: number, nume: string, cod: string | null, cont: string) => {
  const id = rand(licId, nume, cod, { size_bytes: new TextEncoder().encode(cont).length })
  F.storage.set(`${licId}/atribuire/r${id}`, new TextEncoder().encode(cont)); return id
}
const docV = (id: number) => F.db.ofertare_documente_atribuire.find((d) => d.id === id)
const run = async (h: Record<string, string> = { Authorization: 'Bearer SERVICE' }, body: any = {}) => {
  const r = await handler(new Request('http://x', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  return { status: r.status, j: await r.json() }
}

Deno.test('veghe: importul TĂCUT (adopție) rulează după anunțurile tuturor licitațiilor; rundele își trec de_la_index', async () => {
  reset()
  lic(1); lic(2)
  rand(1, 'Caiet.pdf', null)                                                // lic 1: doar adopție (tăcut)
  liste[1] = [{ noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(1), noticeDocumentUrl: 'u' }]
  getAll[2] = [{ noticeDocumentCode: P(58), noticeDocumentName: 'Raspuns clarificari.pdf', noticeDocumentUrl: 'https://e-licitatie.ro/f/r', sysNoticeDocumentTypeId: 31 }]
  let n = 0
  raspunsImport = (b) => (b.licitatie_id === 1 && n++ < 2 ? { continua: true, next_index: 7 * n, metoda: 'per-fisier' } : { continua: false, metoda: 'per-fisier' })
  const { j } = await run()
  const iImp = log.findIndex((l) => l.startsWith('import 1')), iMail = log.findIndex((l) => l.startsWith('mail'))
  assert.ok(iMail >= 0 && iImp > iMail, log.join(' | '))
  // F4: lanțul per fișier 0 → 7 → 14, apoi O rundă de la 0 (reîncercări, rezervă, „adusă”)
  assert.deepEqual(log.filter((l) => l.startsWith('import 1')), ['import 1 de_la 0', 'import 1 de_la 7', 'import 1 de_la 14', 'import 1 de_la 0'])
  const r1 = j.raport.find((r: any) => r.licitatie === 'L1')
  assert.equal(r1.coduri.de_rezolvat, 1); assert.equal(r1.coduri.import, '4 runde (ultima de la 0)')
  assert.deepEqual(j.tacute_amanate, [])
  assert.ok(F.db.notifications.some((x) => x.title.includes('RASPUNS') && x.title.includes('L2')))
})

Deno.test('veghe: o versiune adusă de ALT drum (seap_meta.de_anuntat) se anunță o dată, cu mail, apoi flag-ul se stinge', async () => {
  reset()
  lic(1)
  rand(1, 'Caiet.pdf', P(10))
  const v = rand(1, 'Caiet (CN1095546-00036).pdf', P(36), { aparut_ulterior: true, seap_meta: { cod_sursa: 'lista', inlocuieste: 'Caiet.pdf', de_anuntat: true } })
  liste[1] = [{ noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(36), noticeDocumentUrl: 'u' }]
  await run()
  assert.ok(log.some((l) => l.startsWith('mail')), log.join(' | '))
  const nt = F.db.notifications.find((x) => x.title.includes('RASPUNS'))
  assert.match(nt.message, /VERSIUNI NOI/)
  assert.equal(F.db.ofertare_documente_atribuire.find((d) => d.id === v).seap_meta.de_anuntat, false)
  assert.ok(!log.some((l) => l.startsWith('import')))   // codul e cunoscut: nimic de importat
  log = []; F.db.notifications.length = 0
  await run()
  assert.ok(!log.some((l) => l.startsWith('mail'))); assert.equal(F.db.notifications.length, 0)
})

Deno.test('veghe: verificare fără dovadă și fără mărime nu pornește importul degeaba', async () => {
  reset()
  lic(1)
  rand(1, 'Anexa 1.pdf', null, { size_bytes: null }); rand(1, 'Anexa (1).pdf', null, { size_bytes: null })
  liste[1] = [{ noticeDocumentName: 'Anexa 1.pdf', noticeDocumentCode: P(5), noticeDocumentUrl: 'u' }]
  const { j } = await run()
  assert.equal(j.raport[0].coduri.de_rezolvat, 0); assert.ok(!log.some((l) => l.startsWith('import')))
})

Deno.test('veghe: JWT de utilizator fără acces la Ofertare → refuzat; fără Authorization → 401', async () => {
  reset(); lic(1)
  assert.equal((await run({ Authorization: 'Bearer user-jwt' })).status, 401)   // falsul: getUser fără utilizator
  assert.equal((await run({})).status, 401)
})

Deno.test('veghe F2: next_index se trece DOAR de la o rundă per-fisier — pe rezerva arhivă runda următoare pornește de la 0', async () => {
  reset(); lic(1); rand(1, 'Caiet.pdf', null)
  liste[1] = [{ noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(1), noticeDocumentUrl: 'u' }]
  let n = 0
  raspunsImport = () => (n++ === 0 ? { continua: true, next_index: 9, metoda: 'arhiva' } : { continua: false, metoda: 'per-fisier' })
  const { j } = await run()
  assert.deepEqual(log.filter((l) => l.startsWith('import 1')), ['import 1 de_la 0', 'import 1 de_la 0'])
  assert.equal(j.raport[0].coduri.import, '2 runde')
})

Deno.test('veghe F4: după o rundă terminată de la de_la_index > 0 urmează O SINGURĂ rundă de la 0, apoi stop (oricum ar răspunde)', async () => {
  reset(); lic(1); rand(1, 'Caiet.pdf', null)
  liste[1] = [{ noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(1), noticeDocumentUrl: 'u' }]
  const rasp = [{ continua: true, next_index: 5, metoda: 'per-fisier' }, { continua: false, metoda: 'per-fisier' }, { continua: true, next_index: 3, metoda: 'per-fisier' }]
  let n = 0
  raspunsImport = () => rasp[n++] ?? { continua: false }
  const { j } = await run()
  assert.deepEqual(log.filter((l) => l.startsWith('import 1')), ['import 1 de_la 0', 'import 1 de_la 5', 'import 1 de_la 0'])
  assert.equal(j.raport[0].coduri.import, '3 runde (ultima de la 0, ramas de continuat)')
  // fără continuare (de rămâne 0): o singură rundă
  reset(); lic(1); rand(1, 'Caiet.pdf', null)
  liste[1] = [{ noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(1), noticeDocumentUrl: 'u' }]
  await run()
  assert.deepEqual(log.filter((l) => l.startsWith('import 1')), ['import 1 de_la 0'])
})

Deno.test('veghe F3/F6: „Verifică acum” (licitatie_id în body) NU rulează a doua trecere; rularea programată da, iar bugetul depășit apare în tacute_amanate', async () => {
  reset(); lic(1); rand(1, 'Caiet.pdf', null)
  liste[1] = [{ noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(1), noticeDocumentUrl: 'u' }]
  const { j } = await run({ Authorization: 'Bearer SERVICE' }, { licitatie_id: 1 })
  assert.ok(!log.some((l) => l.startsWith('import')), log.join(' | '))
  assert.match(j.raport[0].coduri.import, /^nepornit: verificare din UI/)
  assert.deepEqual(j.tacute_amanate, [])
  // programată, dar bucla principală a mâncat bugetul (ceasul mutat peste BUGET_TACUT_MS): amânată și raportată
  reset(); lic(1); lic(2); rand(1, 'Caiet.pdf', null); rand(2, 'Anexa.pdf', null)
  liste[1] = [{ noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(1), noticeDocumentUrl: 'u' }]
  liste[2] = [{ noticeDocumentName: 'Anexa.pdf', noticeDocumentCode: P(2), noticeDocumentUrl: 'u' }]
  getAll[2] = [{ noticeDocumentCode: P(58), noticeDocumentName: 'Raspuns clarificari.pdf', noticeDocumentUrl: 'https://e-licitatie.ro/f/r', sysNoticeDocumentTypeId: 31 }]
  const fetchVechi = globalThis.fetch
  globalThis.fetch = (async (u: any, init?: any) => { if (String(u).includes('api.resend.com')) deplasare = 200000; return await fetchVechi(u, init) }) as any
  try {
    const { j: j2 } = await run()
    assert.ok(!log.some((l) => l.startsWith('import')), log.join(' | '))
    assert.deepEqual(j2.tacute_amanate.sort(), ['L1', 'L2'])
    assert.match(j2.raport.find((r: any) => r.licitatie === 'L1').coduri.import, /^amanat \(bugetul de timp al veghei\), dupa 0 runde/)
  } finally { globalThis.fetch = fetchVechi }
})

Deno.test('veghe R1: versiunea decisă e treaba importului pe drumul principal — fără `noi`, fără placeholder, fără Vercel; importul a mutat codul (identică) → nimic de anunțat', async () => {
  reset(); lic(1)
  const v0 = rand(1, 'Caiet.pdf', P(10))
  liste[1] = [{ noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(36), noticeDocumentUrl: 'u' }]
  raspunsImport = () => { const r = F.db.ofertare_documente_atribuire.find((d) => d.id === v0); r.seap_cod = P(36); return { continua: false, metoda: 'per-fisier' } }
  const { j } = await run()
  assert.ok(log.includes('import 1 de_la 0'), log.join(' | '))
  assert.ok(!log.some((l) => l.startsWith('mail')), log.join(' | '))
  assert.ok(!log.some((l) => l.startsWith('vercel')), log.join(' | '))
  assert.equal(j.raport[0].vercel, null)
  assert.equal(F.db.notifications.length, 0)
  assert.equal(F.db.ofertare_documente_atribuire.length, 1, 'niciun placeholder N2')
  const r = j.raport[0]
  assert.deepEqual([r.noi, r.ramase, r.coduri.versiuni, 'identice' in r.coduri], [0, 0, ['Caiet (CN1095546-00036).pdf'], false])
  // importul a rulat în prima trecere: nu se mai pornește încă o dată în a doua
  assert.equal(log.filter((l) => l.startsWith('import')).length, 1)
  // versiunea pe care importul NU o aduce (ex. peste 20 MB): NU se anunță, fără placeholder, fără Vercel; rămâne în raport
  // (coduri.versiuni + erorile importului) și se reia la rularea următoare — gol acceptat (R1)
  reset(); lic(1)
  rand(1, 'Caiet.pdf', P(10))
  liste[1] = [{ noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(36), noticeDocumentUrl: 'u' }]
  const eroare = 'Caiet (CN1095546-00036).pdf: versiune/frate nouă peste 20 MB — /api/seap-import o sare după nume; o aduce workerul NAS (licitații GO) sau manual'
  raspunsImport = () => ({ continua: false, metoda: 'per-fisier', erori: [eroare] })
  const { j: j2 } = await run()
  assert.ok(!log.some((l) => l.startsWith('mail') || l.startsWith('vercel')), log.join(' | '))
  assert.equal(F.db.notifications.length, 0)
  assert.equal(F.db.ofertare_documente_atribuire.length, 1, 'niciun placeholder „nu a putut fi adus”')
  const r2 = j2.raport[0]
  assert.deepEqual([r2.noi, r2.coduri.versiuni, r2.coduri.import, r2.coduri.import_erori], [0, ['Caiet (CN1095546-00036).pdf'], '1 runde', [eroare]])
  log = []
  await run()
  assert.deepEqual(log.filter((l) => l.startsWith('import')), ['import 1 de_la 0'])   // reîncercată, tot neanunțată
  assert.ok(!log.some((l) => l.startsWith('mail'))); assert.equal(F.db.notifications.length, 0)
})

Deno.test('veghe R1: versiunea adusă de import în ACEEAȘI rulare se anunță (avertisment + mail) din rândul ei, o singură dată', async () => {
  reset(); lic(1)
  rand(1, 'Caiet.pdf', P(10))
  liste[1] = [{ noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(36), noticeDocumentUrl: 'u' }]
  raspunsImport = () => {
    F.db.ofertare_documente_atribuire.push({ id: 9999, licitatie_id: 1, nume_original: 'Caiet (CN1095546-00036).pdf', fisier_path: '1/atribuire/x_v36', seap_cod: P(36), aparut_ulterior: true, seap_meta: { cod_sursa: 'lista', inlocuieste: 'Caiet.pdf', de_anuntat: true } })
    return { continua: false, metoda: 'per-fisier' }
  }
  await run()
  const iImp = log.indexOf('import 1 de_la 0'), iMail = log.findIndex((l) => l.startsWith('mail'))
  assert.ok(iImp >= 0 && iMail > iImp, log.join(' | '))
  const nt = F.db.notifications.find((x) => x.title.includes('RASPUNS'))
  assert.match(nt.message, /VERSIUNI NOI/); assert.match(nt.message, /Caiet \(CN1095546-00036\)\.pdf/)
  assert.doesNotMatch(nt.message, /nu toate au putut fi aduse|EXACT/)
  assert.equal(docV(9999).seap_meta.de_anuntat, false)
  assert.ok(!log.some((l) => l.startsWith('vercel')), log.join(' | '))
  assert.equal(F.db.ofertare_documente_atribuire.filter((d) => String(d.fisier_path).includes('/neincarcat/')).length, 0)
  log = []; F.db.notifications.length = 0
  await run()
  assert.ok(!log.some((l) => l.startsWith('mail') || l.startsWith('import')), log.join(' | ')); assert.equal(F.db.notifications.length, 0)
})

Deno.test('veghe + import REAL (R1 + R2): versiunea se aduce și se anunță în aceeași rulare; republicarea identică (și a fraților) nu se anunță deloc', async () => {
  // versiune cu alt conținut → adusă de import sub „N (COD).ext”, anunțată o dată, cu mail
  reset(); importReal = true; lic(1)
  randC(1, 'Caiet.pdf', P(10), 'VECHI')
  liste[1] = [{ noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(36), noticeDocumentUrl: 'https://e-licitatie.ro/f/c36' }]
  fis = { c36: 'NOU, ALT CONTINUT' }
  const { j } = await run()
  const v = F.db.ofertare_documente_atribuire.find((d) => d.seap_cod === P(36))
  assert.ok(v, JSON.stringify(j))
  assert.deepEqual([v.nume_original, String(v.fisier_path).includes('/neincarcat/'), v.seap_meta.de_anuntat, typeof v.seap_meta.anuntat_la, v.aparut_ulterior], ['Caiet (CN1095546-00036).pdf', false, false, 'string', true])
  assert.equal(log.filter((l) => l.startsWith('mail')).length, 1, log.join(' | '))
  assert.match(F.db.notifications.find((x) => x.title.includes('RASPUNS')).message, /VERSIUNI NOI/)
  assert.ok(!log.some((l) => l.startsWith('vercel')), log.join(' | '))
  assert.equal(F.db.ofertare_documente_atribuire.length, 2)
  log = []; F.db.notifications.length = 0
  await run()
  assert.ok(!log.some((l) => l.startsWith('mail') || l.startsWith('import')), log.join(' | ')); assert.equal(F.db.notifications.length, 0)
  // republicare IDENTICĂ → importul mută codul pe rândul vechi: nimic urcat, nimic anunțat
  reset(); importReal = true; lic(1)
  const v0 = randC(1, 'Caiet.pdf', P(10), 'ACELASI')
  liste[1] = [{ noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(36), noticeDocumentUrl: 'https://e-licitatie.ro/f/c36' }]
  fis = { c36: 'ACELASI' }
  const { j: j2 } = await run()
  assert.deepEqual([docV(v0).seap_cod, F.db.ofertare_documente_atribuire.length], [P(36), 1])
  assert.ok(!log.some((l) => l.startsWith('mail') || l.startsWith('vercel')), log.join(' | '))
  assert.equal(F.db.notifications.length, 0)
  assert.deepEqual(j2.raport[0].coduri.versiuni, ['Caiet (CN1095546-00036).pdf'])
  // R2: frați cu același nume republicați integral identic, în ordinea care păcălea înlocuit[0] → fiecare cod pe rândul lui
  reset(); importReal = true; lic(1)
  const a = randC(1, 'Caiet.pdf', P(13), 'CONTINUT-A'), b = randC(1, 'Caiet.pdf', P(17), 'CONTINUT-B')
  liste[1] = [
    { noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(25), noticeDocumentUrl: 'https://e-licitatie.ro/f/a25' },
    { noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(26), noticeDocumentUrl: 'https://e-licitatie.ro/f/b26' },
  ]
  fis = { a25: 'CONTINUT-A', b26: 'CONTINUT-B' }
  const { j: j3 } = await run()
  assert.deepEqual([docV(a).seap_cod, docV(b).seap_cod, F.db.ofertare_documente_atribuire.length], [P(25), P(26), 2])
  assert.ok(!log.some((l) => l.startsWith('mail') || l.startsWith('vercel')), log.join(' | '))
  assert.equal(F.db.notifications.length, 0)
  assert.equal(j3.raport[0].coduri.versiuni.length, 2)
  log = []
  await run()
  assert.ok(!log.some((l) => l.startsWith('import') || l.startsWith('mail')), log.join(' | '))
})

Deno.test('veghe D3: un răspuns per-fisier cu rezerva_arhiva + continua → runda următoare de la 0 (next_index = capătul listei, continuarea e în ZIP)', async () => {
  reset(); lic(1); rand(1, 'Caiet.pdf', null)
  liste[1] = [{ noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(1), noticeDocumentUrl: 'u' }]
  let n = 0
  raspunsImport = () => (n++ === 0 ? { continua: true, next_index: 12, metoda: 'per-fisier', rezerva_arhiva: true } : { continua: false, metoda: 'per-fisier', rezerva_arhiva: false })
  const { j } = await run()
  assert.deepEqual(log.filter((l) => l.startsWith('import 1')), ['import 1 de_la 0', 'import 1 de_la 0'])
  assert.equal(j.raport[0].coduri.import, '2 runde')
})

Deno.test('veghe R4: pe drumul principal (documente noi) runda finală de la 0 NU pornește niciodată — nici în buget', async () => {
  for (const pesteBuget of [true, false]) {
    reset(); lic(1)
    liste[1] = [{ noticeDocumentName: 'Nou.pdf', noticeDocumentCode: P(1), noticeDocumentUrl: 'u' }]
    let n = 0
    raspunsImport = () => {
      n++
      if (n === 1) return { continua: true, next_index: 5, metoda: 'per-fisier' }
      if (n === 2 && pesteBuget) deplasare = 200000   // bucla principală a mâncat bugetul
      return { continua: false, metoda: 'per-fisier' }
    }
    const { j } = await run()
    const imp = log.filter((l) => l.startsWith('import 1'))
    const r = j.raport[0]
    // pe drumul principal: doar lanțul 0 → 5, fără runda de la 0
    assert.deepEqual(imp.slice(0, 2), ['import 1 de_la 0', 'import 1 de_la 5'], log.join(' | '))
    assert.equal(r.coduri.import, '2 runde (fara runda finala de la 0: drumul principal)')
    // E4 (r5): runda de la 0 vine pe a doua trecere, în buget; peste buget → amânată (vizibil)
    if (pesteBuget) { assert.equal(imp.length, 2); assert.match(r.coduri.import_de_la_0, /^amanat/); assert.deepEqual(j.tacute_amanate, ['L1']) }
    else { assert.deepEqual(imp.slice(2), ['import 1 de_la 0']); assert.equal(r.coduri.import_de_la_0, '1 runde') }
    // anunțul licitației se dă oricum (documentul nou, ne-adus)
    assert.equal(r.noi, 1)
  }
  // a doua trecere (doar treabă tăcută) păstrează runda finală de la 0 — vezi „veghe F4”
})

// rând versiune adus de alt drum, încă neanunțat (lista SEAP are deja codul lui: nimic de importat)
const versiuneNeanuntata = (meta: any = {}) => {
  lic(1)
  rand(1, 'Caiet.pdf', P(10))
  const v = rand(1, 'Caiet (CN1095546-00036).pdf', P(36), { aparut_ulterior: true, seap_meta: { cod_sursa: 'lista', inlocuieste: 'Caiet.pdf', de_anuntat: true, ...meta } })
  liste[1] = [{ noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(36), noticeDocumentUrl: 'u' }]
  return v
}
const notifVersiuni = () => F.db.notifications.filter((x) => /VERSIUNI NOI/.test(x.message))

Deno.test('veghe E2 (r5): mailul cade (HTTP 500) → rularea 2 trimite DOAR mailul (fără a doua notificare), apoi de_anuntat = false', async () => {
  reset()
  const v = versiuneNeanuntata()
  mailStatus = 500
  const { j } = await run()
  assert.equal(notifVersiuni().length, 1)
  assert.equal(log.filter((l) => l.startsWith('mail')).length, 1)
  const m1 = docV(v).seap_meta
  assert.deepEqual([m1.de_anuntat, typeof m1.notificat_la, m1.mail_la, m1.anuntat_la], [true, 'string', undefined, undefined])
  assert.deepEqual([j.raport[0].mail, j.raport[0].versiuni_anuntate], ['esuat HTTP 500', 1])
  // rularea 2: mailul merge — doar el, fără notificare nouă
  mailStatus = 200; log = []
  const { j: j2 } = await run()
  assert.equal(notifVersiuni().length, 1, 'fără a doua notificare')
  assert.equal(F.db.notifications.length, 1)
  assert.equal(log.filter((l) => l.startsWith('mail')).length, 1, log.join(' | '))
  const m2 = docV(v).seap_meta
  assert.deepEqual([m2.de_anuntat, m2.notificat_la, typeof m2.mail_la, typeof m2.anuntat_la], [false, m1.notificat_la, 'string', 'string'])
  assert.equal(j2.raport[0].versiuni_anuntate, 1)
  // rularea 3: nimic
  log = []
  await run()
  assert.ok(!log.some((l) => l.startsWith('mail')), log.join(' | ')); assert.equal(F.db.notifications.length, 1)
})

Deno.test('veghe E2 (r5): notificarea cade (insert eșuat) → rularea 2 notifică DOAR (fără al doilea mail), apoi de_anuntat = false', async () => {
  reset()
  const v = versiuneNeanuntata()
  F.esecInsert.notifications = 'insert refuzat'
  const { j } = await run()
  assert.equal(F.db.notifications.length, 0)
  assert.equal(log.filter((l) => l.startsWith('mail')).length, 1)
  assert.ok(j.raport.some((r: any) => r.notificare_esuata === 'insert refuzat'))
  const m1 = docV(v).seap_meta
  assert.deepEqual([m1.de_anuntat, m1.notificat_la, typeof m1.mail_la], [true, undefined, 'string'])
  delete F.esecInsert.notifications; log = []
  await run()
  assert.equal(notifVersiuni().length, 1)
  assert.ok(!log.some((l) => l.startsWith('mail')), 'fără al doilea mail: ' + log.join(' | '))
  const m2 = docV(v).seap_meta
  assert.deepEqual([m2.de_anuntat, typeof m2.notificat_la, m2.mail_la], [false, 'string', m1.mail_la])
  log = []
  await run()
  assert.ok(!log.some((l) => l.startsWith('mail'))); assert.equal(F.db.notifications.length, 1)
})

Deno.test('veghe E2 (r5): o versiune deja notificată + una nouă în aceeași rulare → clopoțelul o numește doar pe cea nouă, mailul pe amândouă', async () => {
  reset()
  versiuneNeanuntata({ notificat_la: '2026-10-08T10:00:00Z' })
  rand(1, 'Plan.pdf', P(11))
  const w = rand(1, 'Plan (CN1095546-00037).pdf', P(37), { aparut_ulterior: true, seap_meta: { cod_sursa: 'lista', inlocuieste: 'Plan.pdf', de_anuntat: true } })
  liste[1].push({ noticeDocumentName: 'Plan.pdf', noticeDocumentCode: P(37), noticeDocumentUrl: 'u' })
  let html = ''
  const fetchVechi = globalThis.fetch
  globalThis.fetch = (async (u: any, init?: any) => { if (String(u).includes('api.resend.com')) html = JSON.parse(init.body).html; return await fetchVechi(u, init) }) as any
  try { await run() } finally { globalThis.fetch = fetchVechi }
  const nt = notifVersiuni()
  assert.equal(nt.length, 1)
  assert.match(nt[0].message, /1 sunt VERSIUNI NOI[^:]*: Plan \(CN1095546-00037\)\.pdf\./)
  assert.doesNotMatch(nt[0].message, /Caiet \(CN1095546-00036\)/)
  assert.match(html, /Caiet \(CN1095546-00036\)\.pdf/); assert.match(html, /Plan \(CN1095546-00037\)\.pdf/)
  assert.ok(F.db.ofertare_documente_atribuire.filter((d) => d.seap_meta?.de_anuntat === true).length === 0)
  assert.equal(docV(w).seap_meta.de_anuntat, false)
})

Deno.test('veghe E4 (r5): lanțul drumului principal oprit de la de > 0 → O rundă de la 0 pe a doua trecere (după toate anunțurile), o singură rundă', async () => {
  reset(); lic(1); lic(2)
  liste[1] = [{ noticeDocumentName: 'Nou.pdf', noticeDocumentCode: P(1), noticeDocumentUrl: 'u' }]
  getAll[2] = [{ noticeDocumentCode: P(58), noticeDocumentName: 'Raspuns clarificari.pdf', noticeDocumentUrl: 'https://e-licitatie.ro/f/r', sysNoticeDocumentTypeId: 31 }]
  let n = 0
  raspunsImport = () => (++n === 1 ? { continua: true, next_index: 5, metoda: 'per-fisier' } : n === 2 ? { continua: false, metoda: 'per-fisier' } : { continua: true, next_index: 9, metoda: 'per-fisier' })
  const { j } = await run()
  assert.deepEqual(log.filter((l) => l.startsWith('import 1')), ['import 1 de_la 0', 'import 1 de_la 5', 'import 1 de_la 0'], log.join(' | '))
  const iMail = log.findIndex((l) => l.startsWith('mail')), iUltim = log.lastIndexOf('import 1 de_la 0')
  assert.ok(iMail >= 0 && iUltim > iMail, log.join(' | '))
  const r1 = j.raport.find((r: any) => r.licitatie === 'L1')
  assert.deepEqual([r1.coduri.import, r1.coduri.import_de_la_0], ['2 runde (fara runda finala de la 0: drumul principal)', '1 runde, ramas de continuat'])
  // „Verifică acum” (licitatie_id): fără a doua trecere — runda rămâne pentru rularea programată
  reset(); lic(1)
  liste[1] = [{ noticeDocumentName: 'Nou.pdf', noticeDocumentCode: P(1), noticeDocumentUrl: 'u' }]
  n = 0
  raspunsImport = () => (++n === 1 ? { continua: true, next_index: 5, metoda: 'per-fisier' } : { continua: false, metoda: 'per-fisier' })
  const { j: j2 } = await run({ Authorization: 'Bearer SERVICE' }, { licitatie_id: 1 })
  assert.deepEqual(log.filter((l) => l.startsWith('import 1')), ['import 1 de_la 0', 'import 1 de_la 5'])
  assert.match(j2.raport[0].coduri.import_de_la_0, /^nepornit: verificare din UI/)
  // lanțul terminat de la 0 (fără continuare) → nimic pe a doua trecere
  reset(); lic(1)
  liste[1] = [{ noticeDocumentName: 'Nou.pdf', noticeDocumentCode: P(1), noticeDocumentUrl: 'u' }]
  const { j: j3 } = await run()
  assert.deepEqual(log.filter((l) => l.startsWith('import 1')), ['import 1 de_la 0'])
  assert.equal('import_de_la_0' in j3.raport[0].coduri, false)
})

Deno.test('veghe E6 (r5): importul pornit DOAR de versiuni merge cu fara_rezerva_arhiva — fără DownloadArchive; cu documente noi, implicit', async () => {
  // versiune (alt conținut) + lista SEAP refuzată importului → importul real NU coboară pe arhivă și o spune
  reset(); importReal = true; lic(1)
  randC(1, 'Caiet.pdf', P(10), 'VECHI')
  liste[1] = [{ noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(36), noticeDocumentUrl: 'https://e-licitatie.ro/f/c36' }]
  fis = { c36: 'NOU' }
  esecListaDeLa = 2
  const { j } = await run()
  assert.deepEqual(corpuriImport.map((b) => b.fara_rezerva_arhiva), [true])
  assert.ok(!log.includes('arhiva'), log.join(' | '))
  assert.ok((j.raport[0].coduri.import_erori || []).some((e: string) => e.startsWith('rezerva arhiva SARITA')), JSON.stringify(j.raport[0].coduri))
  assert.equal(F.db.notifications.length, 0)   // versiunea neadusă nu se anunță (R1)
  // cu un document nou alături: implicit (fără flag) → rezerva pornește ca înainte
  reset(); importReal = true; lic(1)
  randC(1, 'Caiet.pdf', P(10), 'VECHI')
  liste[1] = [{ noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(36), noticeDocumentUrl: 'https://e-licitatie.ro/f/c36' }, { noticeDocumentName: 'Nou.pdf', noticeDocumentCode: P(40), noticeDocumentUrl: 'https://e-licitatie.ro/f/n40' }]
  fis = { c36: 'NOU', n40: 'N' }
  esecListaDeLa = 2
  await run()
  assert.equal(corpuriImport[0].fara_rezerva_arhiva, undefined)
  assert.ok(log.includes('arhiva'), log.join(' | '))
  // E4 + E6: runda de la 0 a unui lanț pornit doar de versiuni păstrează opțiunea
  reset(); lic(1)
  rand(1, 'Caiet.pdf', P(10))
  liste[1] = [{ noticeDocumentName: 'Caiet.pdf', noticeDocumentCode: P(36), noticeDocumentUrl: 'u' }]
  let n = 0
  raspunsImport = () => (++n === 1 ? { continua: true, next_index: 4, metoda: 'per-fisier' } : { continua: false, metoda: 'per-fisier' })
  await run()
  assert.deepEqual(corpuriImport.map((b) => [b.de_la_index, b.fara_rezerva_arhiva]), [[0, true], [4, true], [0, true]])
})

Deno.test('veghe E2 (r5): ambele canale deja confirmate, dar de_anuntat rămas true → flag-ul se stinge, fără al doilea anunț', async () => {
  reset()
  const v = versiuneNeanuntata({ notificat_la: '2026-10-08T10:00:00Z', mail_la: '2026-10-08T10:00:01Z' })
  const { j } = await run()
  assert.equal(F.db.notifications.length, 0); assert.ok(!log.some((l) => l.startsWith('mail')), log.join(' | '))
  assert.deepEqual([docV(v).seap_meta.de_anuntat, j.raport[0].versiuni_anuntate], [false, 0])
})

Deno.test('veghe Jakarinos r2 #1: un INSERT de notificare per mesaj (atomic) — eșec pentru un destinatar → nimeni nu o primește, rularea 2 o trimite O DATĂ fiecăruia', async () => {
  reset()
  const v = versiuneNeanuntata()
  F.db.profiles.push({ id: 'resp', is_owner: false, email: 'r@x' })
  F.db.ofertare_licitatii[0].responsabil_id = 'resp'
  F.esecInsertProfil.id = 'resp'
  await run()
  assert.equal(F.db.notifications.length, 0, 'lotul cade întreg')
  assert.equal(docV(v).seap_meta.notificat_la, undefined)
  delete F.esecInsertProfil.id; log = []
  await run()
  const pe = (pid: string) => notifVersiuni().filter((x) => x.profile_id === pid).length
  assert.deepEqual([pe('owner'), pe('resp')], [1, 1], 'fără dublură pentru owner')
  assert.equal(docV(v).seap_meta.de_anuntat, false)
})

Deno.test('veghe Jakarinos r2 #2: responsabilul necitit (eroare persistentă) → mailul pleacă la office, dar canalul versiunii rămâne restant; rularea 2 îl trimite și responsabilului', async () => {
  reset()
  const v = versiuneNeanuntata()
  F.db.profiles.push({ id: 'resp', is_owner: false, email: 'r@x' })
  F.db.ofertare_licitatii[0].responsabil_id = 'resp'
  F.esecMaybe.profiles = { mesaj: 'timeout', ori: 2 }
  const { j } = await run()
  const mail1 = log.filter((l) => l.startsWith('mail'))
  assert.equal(mail1.length, 1); assert.ok(!mail1[0].includes('r@x'), mail1[0])
  assert.ok(j.raport.some((r: any) => /responsabil: timeout/.test(r.destinatari_necunoscuti ?? '')))
  assert.equal(docV(v).seap_meta.mail_la, undefined, 'mailul versiunii nu e confirmat')
  log = []
  await run()
  const mail2 = log.filter((l) => l.startsWith('mail'))
  assert.equal(mail2.length, 1); assert.ok(mail2[0].includes('r@x'), mail2[0])
  assert.equal(docV(v).seap_meta.de_anuntat, false)
})

Deno.test('veghe Jakarinos r2 #2b: o eroare trecătoare la citirea responsabilului se reîncearcă imediat — mailul pleacă complet, canalul confirmat din prima', async () => {
  reset()
  const v = versiuneNeanuntata()
  F.db.profiles.push({ id: 'resp', is_owner: false, email: 'r@x' })
  F.db.ofertare_licitatii[0].responsabil_id = 'resp'
  F.esecMaybe.profiles = { mesaj: 'timeout', ori: 1 }
  await run()
  const mail1 = log.filter((l) => l.startsWith('mail'))
  assert.equal(mail1.length, 1); assert.ok(mail1[0].includes('r@x'), mail1[0])
  assert.equal(typeof docV(v).seap_meta.mail_la, 'string')
})

Deno.test('veghe Jakarinos r3: ownerii necitiți (2 eșecuri) → clopoțelul versiunii amânat întreg; rularea 2 îl trimite O DATĂ fiecăruia (owner, creator, responsabil)', async () => {
  reset()
  const v = versiuneNeanuntata()
  F.db.profiles.push({ id: 'creator', is_owner: false, email: 'c@x' }, { id: 'resp', is_owner: false, email: 'r@x' })
  Object.assign(F.db.ofertare_licitatii[0], { created_by: 'creator', responsabil_id: 'resp' })
  F.esecSelect.profiles = { mesaj: 'timeout', ori: 2 }   // ambele citiri ale ownerilor
  const { j } = await run()
  assert.equal(notifVersiuni().length, 0, 'nicio notificare parțială a versiunii')
  assert.equal(docV(v).seap_meta.notificat_la, undefined)
  assert.ok(j.raport.some((r: any) => /owneri: timeout/.test(r.destinatari_necunoscuti ?? '')))
  log = []
  await run()
  const pe = (pid: string) => notifVersiuni().filter((x) => x.profile_id === pid).length
  assert.deepEqual([pe('owner'), pe('creator'), pe('resp')], [1, 1, 1])
  assert.equal(docV(v).seap_meta.de_anuntat, false)
})

Deno.test('veghe Jakarinos r4: cronul și „Verifică acum” SIMULTAN pe aceeași versiune → o singură notificare per destinatar și un singur mail', async () => {
  reset()
  const v = versiuneNeanuntata()
  F.db.profiles.push({ id: 'resp', is_owner: false, email: 'r@x' })
  F.db.ofertare_licitatii[0].responsabil_id = 'resp'
  const [a, b] = await Promise.all([run(), run({ Authorization: 'Bearer SERVICE' }, { licitatie_id: 1 })])
  const pe = (pid: string) => notifVersiuni().filter((x) => x.profile_id === pid).length
  assert.deepEqual([pe('owner'), pe('resp')], [1, 1], 'o notificare per destinatar')
  assert.equal(log.filter((l) => l.startsWith('mail')).length, 1, log.join(' | '))
  const ra = a.j.raport[0], rb = b.j.raport[0]
  assert.deepEqual([ra.versiuni_anuntate + rb.versiuni_anuntate, ra.versiuni_in_lucru + rb.versiuni_in_lucru], [1, 1])
  const m = docV(v).seap_meta
  assert.deepEqual([m.de_anuntat, typeof m.notificat_la, typeof m.mail_la, m.revendicare, m.revendicat_pana], [false, 'string', 'string', undefined, undefined])
})

Deno.test('veghe Jakarinos r4: revendicare vie a altei rulări → versiunea nu se anunță aici; revendicare expirată (rulare oprită) → se reia', async () => {
  reset()
  const v = versiuneNeanuntata({ revendicare: 'alta', revendicat_pana: Date.now() + 60000 })
  const { j } = await run()
  assert.equal(notifVersiuni().length, 0); assert.ok(!log.some((l) => l.startsWith('mail')), log.join(' | '))
  assert.deepEqual([j.raport[0].versiuni_in_lucru, docV(v).seap_meta.revendicare, docV(v).seap_meta.de_anuntat], [1, 'alta', true])
  // rularea care o revendicase s-a oprit: după expirare, următoarea o anunță și eliberează revendicarea
  docV(v).seap_meta.revendicat_pana = Date.now() - 1
  log = []
  const { j: j2 } = await run()
  assert.equal(notifVersiuni().length, 1); assert.equal(log.filter((l) => l.startsWith('mail')).length, 1)
  assert.deepEqual([j2.raport[0].versiuni_anuntate, docV(v).seap_meta.de_anuntat, docV(v).seap_meta.revendicare], [1, false, undefined])
})

Deno.test('veghe Jakarinos r4: revendicarea pierdută între trimitere și confirmare (expirată, preluată de altă rulare) → confirmarea NU se scrie', async () => {
  reset()
  const v = versiuneNeanuntata()
  laMail = () => { docV(v).seap_meta = { ...docV(v).seap_meta, revendicare: 'alta', revendicat_pana: Date.now() + 60000 } }
  const { j } = await run()
  assert.ok(j.raport.some((r: any) => /^#\d+: revendicarea a expirat/.test(r.anunt_versiune_nemarcat ?? '')), JSON.stringify(j.raport))
  const m = docV(v).seap_meta
  assert.deepEqual([m.revendicare, m.de_anuntat, m.notificat_la, m.mail_la], ['alta', true, undefined, undefined])
})

Deno.test('veghe Jakarinos r4: rulare oprită după trimitere, înainte de confirmare → reluarea NU dublează clopoțelul (același conținut) și trimite mailul cu aceeași cheie (Resend nu-l retrimite)', async () => {
  reset()
  const v = versiuneNeanuntata()
  await run()
  assert.equal(notifVersiuni().length, 1); assert.equal(log.filter((l) => l.startsWith('mail')).length, 1)
  const cheie = cheiMail[0]
  assert.match(cheie, /^seap-veghe\/1\/[0-9a-f]{64}$/)
  // ca și cum confirmarea n-ar fi apucat să se scrie: versiunea restantă, revendicarea expirată
  docV(v).seap_meta = { cod_sursa: 'lista', inlocuieste: 'Caiet.pdf', de_anuntat: true, revendicare: 'oprita', revendicat_pana: Date.now() - 1 }
  log = []
  const { j } = await run()
  assert.equal(notifVersiuni().length, 1, 'fără a doua notificare')
  assert.ok(!log.some((l) => l.startsWith('mail')), log.join(' | '))
  assert.deepEqual([cheiMail.length, cheiMail[1]], [2, cheie])
  assert.ok(log.some((l) => l.startsWith('resend-idem')))
  assert.deepEqual([docV(v).seap_meta.de_anuntat, j.raport[0].versiuni_anuntate], [false, 1])
})

// două versiuni neanunțate (A = Caiet, B = Plan), aduse de alt drum; A (id mai mic) e ancora livrării
const douaVersiuni = () => {
  const a = versiuneNeanuntata()
  rand(1, 'Plan.pdf', P(11))
  const b = rand(1, 'Plan (CN1095546-00037).pdf', P(37), { aparut_ulterior: true, seap_meta: { cod_sursa: 'lista', inlocuieste: 'Plan.pdf', de_anuntat: true } })
  liste[1].push({ noticeDocumentName: 'Plan.pdf', noticeDocumentCode: P(37), noticeDocumentUrl: 'u' })
  return [a, b]
}
// confirmarea unei versiuni = UPDATE fără revendicare; scrierea grupului = UPDATE cu revendicare + grup
const eConfirmare = (patch: any) => patch?.seap_meta && !('revendicare' in patch.seap_meta)
const eScriereGrup = (patch: any) => !!(patch?.seap_meta?.revendicare && patch?.seap_meta?.grup)
const ruleazaOprit = async (h?: any, body?: any) => { try { await run(h, body) } catch (e) { assert.match(String(e), /proces oprit/) } }
const mailuri = () => log.filter((l) => l.startsWith('mail')).length
// „oprirea” la primul INSERT de notificare (după scrierea grupului, înainte de orice trimitere)
const opresteLaPrimaNotificare = async () => {
  let oprit = false
  const insertVechi = F.db.notifications.push.bind(F.db.notifications)
  F.db.notifications.push = ((...x: any[]) => { if (!oprit) { oprit = true; throw new Error('proces oprit (simulat)') } return insertVechi(...x) }) as any
  try { await ruleazaOprit() } finally { F.db.notifications.push = insertVechi }
}

Deno.test('veghe Jakarinos r5: A + B livrate, procesul oprit la confirmarea ancorei (B confirmată) → reluarea NU retrimite nimic (grupul spune ce a plecat), confirmă ancora', async () => {
  reset()
  const [a, b] = douaVersiuni()
  F.laUpdate.fn = (t, patch, ids) => (t === 'ofertare_documente_atribuire' && ids.includes(a) && eConfirmare(patch) ? 'crash' : null)
  await ruleazaOprit()
  assert.equal(notifVersiuni().length, 1); assert.equal(mailuri(), 1)
  assert.equal(docV(b).seap_meta.de_anuntat, false)
  const g = docV(a).seap_meta.grup
  assert.deepEqual([docV(a).seap_meta.de_anuntat, g?.membri?.length, g?.trimis], [true, 2, { notif: true, mail: true }])
  delete F.laUpdate.fn; deplasare = 11 * 60 * 1000; log = []
  const { j } = await run()
  assert.equal(notifVersiuni().length, 1, 'fără a doua notificare'); assert.deepEqual([mailuri(), cheiMail.length], [0, 1], 'nicio cerere nouă de mail')
  assert.deepEqual([docV(a).seap_meta.de_anuntat, docV(a).seap_meta.grup, docV(a).seap_meta.revendicare], [false, undefined, undefined])
  assert.deepEqual(j.raport[0].reluari?.map((r: any) => r.versiuni), [1])
  log = []
  await run()
  assert.ok(!log.some((l) => l.startsWith('mail') || l.startsWith('resend-idem')), log.join(' | ')); assert.equal(notifVersiuni().length, 1)
})

Deno.test('veghe Jakarinos r5: procesul oprit după scrierea grupului, înainte de orice trimitere → reluarea trimite grupul O SINGURĂ DATĂ', async () => {
  reset()
  const [a, b] = douaVersiuni()
  await opresteLaPrimaNotificare()
  assert.equal(F.db.notifications.length, 0); assert.equal(mailuri(), 0)
  assert.deepEqual([docV(a).seap_meta.grup?.membri, docV(a).seap_meta.grup?.trimis], [[a, b], { notif: false, mail: false }])
  assert.equal(docV(b).seap_meta.grup, undefined, 'grupul stă doar pe ancoră')
  deplasare = 11 * 60 * 1000; log = []
  const { j } = await run()
  assert.equal(notifVersiuni().filter((x) => x.profile_id === 'owner').length, 1)
  assert.match(notifVersiuni()[0].message, /2 sunt VERSIUNI NOI/)
  assert.equal(mailuri(), 1, log.join(' | '))
  assert.deepEqual([docV(a).seap_meta.de_anuntat, docV(b).seap_meta.de_anuntat, docV(a).seap_meta.grup], [false, false, undefined])
  assert.deepEqual(j.raport[0].reluari?.map((r: any) => [r.versiuni, r.clopotel, r.mail]), [[2, 'ok', 'trimis']])
})

Deno.test('veghe Jakarinos r6 #1: confirmarea membrului B întoarce EROARE (fără oprire) → grupul rămâne pe ancoră; reluarea confirmă B fără nicio retrimitere', async () => {
  reset()
  const [a, b] = douaVersiuni()
  F.laUpdate.fn = (t, patch, ids) => (t === 'ofertare_documente_atribuire' && ids.includes(b) && eConfirmare(patch) ? 'scriere refuzata' : null)
  const { j } = await run()
  assert.equal(notifVersiuni().length, 1); assert.equal(mailuri(), 1)
  assert.ok(j.raport.some((r: any) => /scriere refuzata/.test(r.anunt_versiune_nemarcat ?? '')), JSON.stringify(j.raport))
  const ma = docV(a).seap_meta
  assert.deepEqual([ma.de_anuntat, ma.grup?.trimis, ma.revendicare], [false, { notif: true, mail: true }, undefined], 'ancora confirmată, grupul păstrat')
  assert.equal(docV(b).seap_meta.de_anuntat, true)
  delete F.laUpdate.fn; deplasare = 11 * 60 * 1000; log = []
  await run()
  assert.equal(notifVersiuni().length, 1, 'fără a doua notificare'); assert.deepEqual([mailuri(), cheiMail.length], [0, 1])
  assert.deepEqual([docV(b).seap_meta.de_anuntat, docV(a).seap_meta.grup], [false, undefined])
})

Deno.test('veghe Jakarinos r6 #2: grup comun de reluat + cronul și „Verifică acum” SIMULTAN → doar cine revendică ancora reia; un singur clopoțel per destinatar, un singur mail', async () => {
  reset()
  const [a, b] = douaVersiuni()
  F.db.profiles.push({ id: 'resp', is_owner: false, email: 'r@x' })
  F.db.ofertare_licitatii[0].responsabil_id = 'resp'
  await opresteLaPrimaNotificare()
  assert.ok(docV(a).seap_meta.grup)
  deplasare = 11 * 60 * 1000; log = []
  const [r1, r2] = await Promise.all([run(), run({ Authorization: 'Bearer SERVICE' }, { licitatie_id: 1 })])
  const pe = (pid: string) => notifVersiuni().filter((x) => x.profile_id === pid).length
  assert.deepEqual([pe('owner'), pe('resp')], [1, 1])
  assert.equal(mailuri(), 1, log.join(' | '))
  const rl = [r1, r2].map((r) => r.j.raport[0])
  assert.deepEqual(rl.map((r) => r.reluari?.length ?? 0).sort(), [0, 1])
  assert.ok(rl.some((r) => r.versiuni_in_lucru >= 1))
  assert.deepEqual([docV(a).seap_meta.de_anuntat, docV(b).seap_meta.de_anuntat, docV(a).seap_meta.grup], [false, false, undefined])
})

Deno.test('veghe r6: grupul nu se poate scrie → versiunile NU pleacă acum (nicio dată de canal, revendicări eliberate); rularea următoare le anunță o dată', async () => {
  reset()
  const [a, b] = douaVersiuni()
  F.laUpdate.fn = (t, patch) => (t === 'ofertare_documente_atribuire' && eScriereGrup(patch) ? 'scriere refuzata' : null)
  const { j } = await run()
  assert.equal(notifVersiuni().length, 0); assert.equal(mailuri(), 0)
  assert.ok(j.raport.some((r: any) => /scriere refuzata/.test(r.grup_nescris ?? '')))
  for (const id of [a, b]) {
    const m = docV(id).seap_meta
    assert.deepEqual([m.de_anuntat, m.notificat_la, m.mail_la, m.revendicare, m.grup], [true, undefined, undefined, undefined, undefined])
  }
  delete F.laUpdate.fn; log = []
  await run()
  assert.equal(notifVersiuni().length, 1); assert.equal(mailuri(), 1)
  assert.deepEqual([docV(a).seap_meta.de_anuntat, docV(b).seap_meta.de_anuntat], [false, false])
})

Deno.test('veghe r6: un grup mai vechi de 20 h nu se mai reia — versiunea se anunță din nou, ca proaspătă (fereastra cheii Resend s-a închis)', async () => {
  reset()
  const v = versiuneNeanuntata({ revendicare: 'veche', revendicat_pana: Date.now() - 1, grup: { id: 'veche/1', la: Date.now() - 21 * 3600 * 1000, membri: [], notif: null, mail: null, trimis: { notif: false, mail: false } } })
  const { j } = await run()
  assert.equal(notifVersiuni().length, 1); assert.equal(mailuri(), 1)
  assert.deepEqual([docV(v).seap_meta.de_anuntat, docV(v).seap_meta.grup, j.raport[0].reluari], [false, undefined, undefined])
})

Deno.test('veghe r6: la reluare clopoțelul cade din nou → grupul rămâne (nimic refăcut cu alt conținut); reluarea următoare îl trimite identic, o dată', async () => {
  reset()
  const [a, b] = douaVersiuni()
  await opresteLaPrimaNotificare()
  deplasare = 11 * 60 * 1000; log = []
  F.esecInsert.notifications = 'insert refuzat'
  await run()
  assert.equal(F.db.notifications.length, 0); assert.equal(mailuri(), 1)
  assert.deepEqual([docV(a).seap_meta.grup?.trimis, docV(b).seap_meta.notificat_la], [{ notif: false, mail: true }, undefined])
  delete F.esecInsert.notifications; deplasare = 22 * 60 * 1000; log = []
  await run()
  assert.equal(notifVersiuni().length, 1); assert.match(notifVersiuni()[0].message, /2 sunt VERSIUNI NOI/)
  assert.deepEqual([mailuri(), cheiMail.length], [0, 1], 'mailul nu se mai cere')
  assert.deepEqual([docV(a).seap_meta.de_anuntat, docV(b).seap_meta.de_anuntat, docV(a).seap_meta.grup], [false, false, undefined])
})
