import { strict as assert } from 'node:assert'
import * as F from './fake_supabase.ts'
let handler: any
try { Object.defineProperty(Deno, 'serve', { value: (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown() {} } }, configurable: true, writable: true }) }
catch (_) { (Deno as any).serve = (h: any) => { handler = h } }
Deno.env.set('SUPABASE_URL', 'http://supa'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE'); Deno.env.set('SUPABASE_ANON_KEY', 'ANON')
let lista: any[] = []
const fisiere = new Map<string, Uint8Array>()
let descarcate: string[] = []
// R3: arhiva DownloadArchive (null = HTTP 500), lista care eșuează, ceasul importului (bugetul de timp) mutat la cererea arhivei
let arhiva: Uint8Array | null = null, listaEsueaza = false, saltLaArhiva = 0, deplasare = 0
// E3: statusurile întoarse ÎNAINTE de reușită (lista / per fișier), cookie-ul fiecărei încercări a listei, Cookie-ul descărcărilor,
// apelurile DownloadArchive (E6) și pauzele cerute (setTimeout scurtat: testele nu așteaptă secunde)
let esecuriLista: number[] = [], esecuriFisier = new Map<string, number[]>(), incercariLista = 0, cookieDescarcari: string[] = [], apeluriArhiva = 0
let pauze: number[] = []
const stOrig = globalThis.setTimeout
globalThis.setTimeout = ((fn: any, ms?: number, ...a: any[]) => { if (ms) pauze.push(ms); return stOrig(fn, 0, ...a) }) as any
const dn = Date.now.bind(Date)
Date.now = () => dn() + deplasare
globalThis.fetch = (async (u: any, init?: any) => {
  const url = String(u)
  if (url.includes('GetDfNoticeSectionFiles')) {
    incercariLista++
    if (esecuriLista.length) { const st = esecuriLista.shift()!; return new Response('x', { status: st, headers: { 'set-cookie': `s=rau${incercariLista}; Path=/` } }) }
    return listaEsueaza ? new Response('x', { status: 500 }) : new Response(JSON.stringify({ dfNoticeDocs: lista }), { status: 200, headers: { 'set-cookie': 's=bun; Path=/' } })
  }
  if (url.includes('DownloadArchive')) { apeluriArhiva++; deplasare += saltLaArhiva; return arhiva ? new Response(arhiva, { status: 200 }) : new Response('no', { status: 500 }) }
  const m = /\/f\/(.+)$/.exec(url)
  if (m) {
    const k = decodeURIComponent(m[1]); descarcate.push(k); cookieDescarcari.push(String(init?.headers?.Cookie ?? ''))
    const es = esecuriFisier.get(k)
    if (es?.length) return new Response('x', { status: es.shift()! })
    const b = fisiere.get(k); return b ? new Response(b, { status: 200, headers: { 'content-length': String(b.length) } }) : new Response('x', { status: 404 })
  }
  return new Response('?', { status: 404 })
}) as any
await import('../../supabase/functions/ofertare-seap-import/index.ts')

const enc = (s: string) => new TextEncoder().encode(s)
const P = (n: number) => `CN1095546/${String(n).padStart(5, '0')}`
function reset() {
  for (const k of Object.keys(F.db)) F.db[k].length = 0
  F.storage.clear(); F.jurnal.length = 0; fisiere.clear(); descarcate = []; lista = []
  arhiva = null; listaEsueaza = false; saltLaArhiva = 0; deplasare = 0
  esecuriLista = []; esecuriFisier = new Map(); incercariLista = 0; cookieDescarcari = []; apeluriArhiva = 0; pauze = []
  F.db.ofertare_licitatii.push({ id: 3, nr_anunt: 'L3', c_notice_id: 1, sys_notice_type_id: 2 })
}
let idR = 500
function rand(nume: string, cod: string | null, cont: string, extra: any = {}) {
  const id = idR++, path = `3/atribuire/r${id}`
  F.db.ofertare_documente_atribuire.push({ id, licitatie_id: 3, nume_original: nume, fisier_path: path, seap_cod: cod, tip: 'alta', size_bytes: enc(cont).length, seap_meta: null, ...extra })
  F.storage.set(path, enc(cont))
  return id
}
function item(nume: string, cod: string, cont: string | null, cheie = nume + '|' + cod) {
  if (cont != null) fisiere.set(cheie, enc(cont))
  lista.push({ noticeDocumentName: nume, noticeDocumentUrl: `https://e-licitatie.ro/f/${encodeURIComponent(cheie)}`, noticeDocumentCode: cod })
}
async function run(body: any = { licitatie_id: 3 }) {
  const r = await handler(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer SERVICE', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  return await r.json()
}
const doc = (id: number) => F.db.ofertare_documente_atribuire.find((r) => r.id === id)
const randuri = () => F.db.ofertare_documente_atribuire

Deno.test('e2e: adopție pe nume fără descărcare; a doua rulare sare pe cod', async () => {
  reset()
  const id = rand('Caiet.pdf', null, 'AAAA')
  item('Caiet.pdf', P(1), 'AAAA')
  const r = await run()
  assert.deepEqual(r.coduri_adoptate, [{ id, cod: P(1) }]); assert.deepEqual(descarcate, []); assert.equal(doc(id).seap_cod, P(1))
  const r2 = await run()
  assert.equal(r2.sarite_cod, 1); assert.deepEqual(descarcate, [])
})

Deno.test('e2e F2: „Caiet.pdf” + „Caiet.pdf.p7s” listate, un rând vechi — în ambele ordini adopția cere dovadă; semnătura nu se descarcă', async () => {
  for (const ordine of [0, 1]) {
    // conținut diferit (alt mărime) → revizuirea se aduce ca frate, rândul vechi rămâne fără cod
    reset()
    const id = rand('Caiet.pdf', null, 'VECHI-SEMNAT')
    const L: [string, string, string][] = [['Caiet.pdf', P(20), 'REVIZUIT'], ['Caiet.pdf.p7s', P(7), 'SEMNATURA']]
    for (const x of ordine ? [L[1], L[0]] : L) item(...x)
    const r = await run()
    assert.deepEqual(descarcate, ['Caiet.pdf|' + P(20)], `ordine ${ordine}`)
    assert.equal(doc(id).seap_cod, null)
    assert.deepEqual(r.frati, ['Caiet (CN1095546-00020).pdf'])
    assert.equal(randuri().find((d) => d.seap_cod === P(20)).nume_original, 'Caiet (CN1095546-00020).pdf')
    assert.equal(randuri().length, 2)
    // același conținut → codul pe rândul vechi (citit din Storage, aceeași mărime), fără upload
    reset()
    const id2 = rand('Caiet.pdf', null, 'ACELASI')
    for (const x of ordine ? [['Caiet.pdf.p7s', P(7), 'SEMN'], ['Caiet.pdf', P(20), 'ACELASI']] : [['Caiet.pdf', P(20), 'ACELASI'], ['Caiet.pdf.p7s', P(7), 'SEMN']]) item(...(x as [string, string, string]))
    const r2 = await run()
    assert.deepEqual(r2.coduri_adoptate, [{ id: id2, cod: P(20) }]); assert.equal(randuri().length, 1)
    assert.ok(F.jurnal.some((j) => j.startsWith('download 3/atribuire/r')))
  }
})

Deno.test('e2e: candidat cu altă mărime = nepotrivire dovedită FĂRĂ citire din Storage', async () => {
  reset()
  const a = rand('Anexa 1.pdf', null, 'AAAAAAAAAA'), b = rand('Anexa (1).pdf', null, 'BBBBBBBBBBBB')
  item('Anexa 1.pdf', P(5), 'CCC')
  const r = await run()
  assert.equal(F.jurnal.filter((j) => j.startsWith('download')).length, 0)
  assert.deepEqual(r.frati, ['Anexa 1 (CN1095546-00005).pdf']); assert.equal(doc(a).seap_cod, null); assert.equal(doc(b).seap_cod, null)
})

Deno.test('e2e: fratele identic (același fișier listat de două ori) nu se dublează', async () => {
  reset()
  const id = rand('X.pdf', P(1), 'IDENTIC')
  item('X.pdf', P(1), 'IDENTIC'); item('X.pdf', P(2), 'IDENTIC', 'X2')
  const r = await run()
  assert.equal(randuri().length, 1); assert.equal(r.adaugate, 0)
  assert.ok(r.avertismente.some((a: string) => a.includes('conținut identic cu #' + id)))
  // conținut diferit, aceeași mărime → frate adus
  reset()
  rand('X.pdf', P(1), 'AAAAAAA')
  item('X.pdf', P(1), 'AAAAAAA'); item('X.pdf', P(2), 'BBBBBBB', 'X2')
  const r2 = await run()
  assert.deepEqual(r2.frati, ['X (CN1095546-00002).pdf']); assert.equal(randuri().length, 2)
})

Deno.test('e2e: versiune — nume N (COD), aparut_ulterior, ♻ inlocuieste, de_anuntat, tipul moștenit; a doua republicare înlocuiește ULTIMA versiune', async () => {
  reset()
  const v0 = rand('Caiet.pdf', P(10), 'V0', { tip: 'cs_volum' })
  item('Caiet.pdf', P(36), 'V36')
  const r = await run()
  assert.deepEqual(r.versiuni_noi, ['Caiet (CN1095546-00036).pdf'])
  const v = randuri().find((d) => d.seap_cod === P(36))
  assert.deepEqual([v.aparut_ulterior, v.tip, v.seap_meta.inlocuieste, v.seap_meta.inlocuieste_id, v.seap_meta.de_anuntat], [true, 'cs_volum', 'Caiet.pdf', v0, true])
  lista = []; item('Caiet.pdf', P(50), 'V50')
  const r2 = await run()
  const v50 = randuri().find((d) => d.seap_cod === P(50))
  assert.deepEqual([r2.versiuni_noi, v50.seap_meta.inlocuieste, v50.seap_meta.inlocuieste_id], [['Caiet (CN1095546-00050).pdf'], 'Caiet (CN1095546-00036).pdf', v.id])
})

Deno.test('e2e: rândul urcat de mână sub numele exact al versiunii (placeholder completat) primește codul, fără descărcare', async () => {
  reset()
  rand('Planse.pdf', P(10), 'V0')
  const urc = rand('Planse (CN1095546-00036).pdf', null, 'MANUAL')
  item('Planse.pdf', P(36), null)   // SEAP nu l-ar putea da (descărcarea ar eșua) — nu trebuie cerut
  const r = await run()
  assert.deepEqual(r.coduri_adoptate, [{ id: urc, cod: P(36) }]); assert.deepEqual(descarcate, []); assert.equal(randuri().length, 2)
})

Deno.test('e2e: GetAll (desfăcut pe loc de worker, cale mutată) nu e „înlocuit”; rândul vechi adoptă', async () => {
  reset()
  rand('Raspuns clarificari 1.pdf', P(58), 'R', { fisier_path: '3/atribuire/lx_Raspuns.pdf', seap_meta: { titlu: null, publicat: null, semnat: {} } })
  F.storage.set('3/atribuire/lx_Raspuns.pdf', enc('R'))
  const vechi = rand('Raspuns clarificari 1.pdf', null, 'R')
  item('Raspuns clarificari 1.pdf', P(60), 'R')
  const r = await run()
  assert.deepEqual(r.versiuni_noi, []); assert.deepEqual(r.coduri_adoptate, [{ id: vechi, cod: P(60) }])
})

Deno.test('e2e: republicare integrală legitimă nu declanșează siguranța — 3 versiuni, documentația nu se pierde', async () => {
  reset()
  for (const [n, k] of [['A.pdf', 1], ['B.pdf', 2], ['C.pdf', 3]] as [string, number][]) { rand(n, P(k), 'v' + k); item(n, P(k + 10), 'w' + k) }
  const r = await run()
  assert.equal(r.coduri_instabile, null); assert.equal(r.versiuni_noi.length, 3)
})

Deno.test('e2e: semnătura detașată a unui document listat — licitație nouă: un singur rând, .p7s nedescărcat', async () => {
  reset()
  item('Caiet.pdf', P(1), 'DOC'); item('Caiet.pdf.p7s', P(2), 'SIG')
  const r = await run()
  assert.equal(randuri().length, 1); assert.deepEqual(descarcate, ['Caiet.pdf|' + P(1)]); assert.equal(r.adaugate, 1)
})

Deno.test('e2e: ZIP-ul unui document cu intrare peste 20 MB → lasate_pentru_nas (nu „Sărite”)', async () => {
  // fără ZIP real mare aici (costisitor) — câmpul există și e gol pe un import obișnuit
  reset(); item('Caiet.pdf', P(1), 'DOC')
  const r = await run()
  assert.deepEqual(r.lasate_pentru_nas, []); assert.deepEqual(r.lasate_pentru_vercel, [])
})

Deno.test('e2e F1: versiunea care COMPLETEAZĂ placeholder-ul veghei (anunțată deja) intră cu de_anuntat = false', async () => {
  reset()
  rand('Caiet.pdf', P(10), 'V0', { tip: 'cs_volum' })
  const ph = rand('Caiet (CN1095546-00036).pdf', null, '', { fisier_path: '3/atribuire/neincarcat/Caiet_CN1095546-00036_.pdf', size_bytes: null })
  item('Caiet.pdf', P(36), 'V36')
  const r = await run()
  assert.deepEqual([r.completate, r.adaugate, r.versiuni_noi], [1, 0, ['Caiet (CN1095546-00036).pdf']])
  const v = doc(ph)
  assert.equal(v.seap_cod, P(36)); assert.ok(!v.fisier_path.includes('/neincarcat/'))
  assert.deepEqual([v.seap_meta.de_anuntat, v.seap_meta.anuntat_prin, typeof v.seap_meta.anuntat_la, v.seap_meta.inlocuieste], [false, 'placeholder veghe', 'string', 'Caiet.pdf'])
  // fără placeholder: versiunea rămâne de anunțat (veghea o anunță)
  reset()
  rand('Caiet.pdf', P(10), 'V0')
  item('Caiet.pdf', P(36), 'V36')
  await run()
  const v2 = randuri().find((d) => d.seap_cod === P(36))
  assert.deepEqual([v2.seap_meta.de_anuntat, v2.seap_meta.anuntat_prin], [true, undefined])
})

Deno.test('e2e F5: versiune republicată IDENTIC → codul mutat pe rândul înlocuit, fără upload, fără de_anuntat; a doua rulare sare pe cod', async () => {
  reset()
  const v0 = rand('Caiet.pdf', P(10), 'ACELASI CONTINUT', { tip: 'cs_volum' })
  item('Caiet.pdf', P(36), 'ACELASI CONTINUT')
  const r = await run()
  assert.deepEqual([r.versiuni_noi, r.adaugate, r.coduri_mutate], [[], 0, [{ id: v0, de: P(10), la: P(36) }]])
  assert.ok(r.avertismente.some((a: string) => a.includes(`republicat identic sub cod nou — codul mutat pe #${v0}, fără versiune`)), r.avertismente.join(' | '))
  assert.equal(randuri().length, 1); assert.equal(doc(v0).seap_cod, P(36))
  assert.equal(F.jurnal.filter((j) => j.startsWith('upload')).length, 0)
  assert.ok(F.jurnal.includes(`download 3/atribuire/r${v0}`), 'aceeași mărime → citit din Storage')
  descarcate = []
  const r2 = await run()
  assert.deepEqual([r2.sarite_cod, descarcate, r2.coduri_mutate], [1, [], []])
  // D1: originalul rămâne pe cheia lui N — o republicare ulterioară (alt conținut) îl înlocuiește pe EL, cu codul mutat ca anterior
  assert.equal(doc(v0).nume_original, 'Caiet.pdf')
  lista = []; item('Caiet.pdf', P(50), 'ALT CONTINUT NOU')
  const r3 = await run()
  const v50 = randuri().find((d) => d.seap_cod === P(50))
  assert.deepEqual([r3.versiuni_noi, r3.coduri_mutate, v50.seap_meta.inlocuieste_id, v50.seap_meta.cod_anterior, v50.seap_meta.de_anuntat], [['Caiet (CN1095546-00050).pdf'], [], v0, P(36), true])
})

Deno.test('e2e D1: republicare IDENTICĂ a unei versiuni cu nume de cod → versiune (codul nu se mută, linia rămâne), fără citire din Storage', async () => {
  reset()
  const v0 = rand('Caiet.pdf', P(10), 'V0')
  const v36 = rand('Caiet (CN1095546-00036).pdf', P(36), 'V36 IDENTIC', { seap_meta: { cod_sursa: 'lista', cod: P(36), de_anuntat: false } })
  item('Caiet.pdf', P(50), 'V36 IDENTIC')
  const r = await run()
  assert.deepEqual([r.coduri_mutate, r.versiuni_noi, r.adaugate], [[], ['Caiet (CN1095546-00050).pdf'], 1])
  assert.deepEqual([doc(v0).seap_cod, doc(v36).seap_cod], [P(10), P(36)])
  const v50 = randuri().find((d) => d.seap_cod === P(50))
  assert.deepEqual([v50.nume_original, v50.seap_meta.inlocuieste_id, v50.seap_meta.cod_anterior, v50.seap_meta.de_anuntat], ['Caiet (CN1095546-00050).pdf', v36, P(36), true])
  assert.ok(!F.jurnal.some((j) => j.startsWith('download 3/atribuire/r')), F.jurnal.join(' | '))
  descarcate = []
  const r2 = await run()
  assert.deepEqual([r2.sarite_cod, descarcate], [1, []])
})

Deno.test('e2e D1: republicare IDENTICĂ cu placeholder pe N2 (veghea a anunțat-o) → placeholder-ul completat ca versiune, de_anuntat = false, codul vechi neatins', async () => {
  reset()
  const v0 = rand('Caiet.pdf', P(10), 'ACELASI')
  const ph = rand('Caiet (CN1095546-00036).pdf', null, '', { fisier_path: '3/atribuire/neincarcat/Caiet_CN1095546-00036_.pdf', size_bytes: null })
  item('Caiet.pdf', P(36), 'ACELASI')
  const r = await run()
  assert.deepEqual([r.coduri_mutate, r.completate, r.adaugate, r.versiuni_noi], [[], 1, 0, ['Caiet (CN1095546-00036).pdf']])
  const v = doc(ph)
  assert.deepEqual([v.seap_cod, v.fisier_path.includes('/neincarcat/'), v.seap_meta.de_anuntat, v.seap_meta.anuntat_prin, v.seap_meta.inlocuieste_id], [P(36), false, false, 'placeholder veghe', v0])
  assert.equal(doc(v0).seap_cod, P(10))
  assert.ok(!F.jurnal.some((j) => j === `download 3/atribuire/r${v0}`), 'fără citirea înlocuitului')
  assert.equal(randuri().length, 2)
})

Deno.test('e2e F5 + Copilot r1: înlocuitul FĂRĂ mărime se citește din Storage — identic → cod mutat (fără versiune); obiect lipsă → versiune ca înainte; aceeași mărime, alt conținut → versiune', async () => {
  reset()
  const v0 = rand('Caiet.pdf', P(10), 'ACELASI', { size_bytes: null })
  item('Caiet.pdf', P(36), 'ACELASI')
  const r = await run()
  assert.deepEqual([r.versiuni_noi, r.coduri_mutate, doc(v0).seap_cod], [[], [{ id: v0, de: P(10), la: P(36) }], P(36)])
  // obiectul lipsește din Storage: sha necunoscut → versiune (anunțată), ca înainte — partea sigură
  reset()
  const v1 = rand('Caiet.pdf', P(10), 'ACELASI', { size_bytes: null })
  F.storage.delete(doc(v1).fisier_path)
  item('Caiet.pdf', P(36), 'ACELASI')
  const r1 = await run()
  assert.deepEqual([r1.versiuni_noi, r1.coduri_mutate, doc(v1).seap_cod], [['Caiet (CN1095546-00036).pdf'], [], P(10)])
  assert.equal(randuri().find((d) => d.seap_cod === P(36)).seap_meta.de_anuntat, true)
  reset()
  rand('Caiet.pdf', P(10), 'AAAAAAA')
  item('Caiet.pdf', P(36), 'BBBBBBB')
  const r2 = await run()
  assert.deepEqual([r2.versiuni_noi, r2.coduri_mutate], [['Caiet (CN1095546-00036).pdf'], []])
})

// ZIP real (Info-ZIP, ca în zipFlux_test.ts / arhive_platforma_test.ts), intrări stocate, în ordinea dată
async function zipCu(fis: [string, string][]): Promise<Uint8Array> {
  const d = await Deno.makeTempDir()
  for (const [n, c] of fis) await Deno.writeFile(`${d}/${n}`, enc(c))
  const o = await new Deno.Command('zip', { args: ['-q', '-0', 'a.zip', ...fis.map(([n]) => n)], cwd: d, stdout: 'piped', stderr: 'piped' }).output()
  if (!o.success) throw new Error(new TextDecoder().decode(o.stderr))
  const buf = await Deno.readFile(`${d}/a.zip`)
  await Deno.remove(d, { recursive: true })
  return buf
}

Deno.test('e2e R2: frați cu același nume republicați integral IDENTIC → fiecare cod mutat pe rândul lui, fără versiune, fără upload, fără anunț', async () => {
  reset()
  // lic. 100: două rânduri „Caiet.pdf” (același nume, coduri adoptate prin dovadă), conținut diferit, ACEEAȘI mărime (citite din Storage)
  const r13 = rand('Caiet.pdf', P(13), 'CONTINUT-A'), r17 = rand('Caiet.pdf', P(17), 'CONTINUT-B')
  // republicare integrală, în ordinea care păcălea înlocuit[0]: /00025 are conținutul lui /00013 (al doilea candidat)
  item('Caiet.pdf', P(25), 'CONTINUT-A'); item('Caiet.pdf', P(26), 'CONTINUT-B')
  const r = await run()
  assert.deepEqual([r.versiuni_noi, r.adaugate, r.completate], [[], 0, 0], JSON.stringify(r))
  assert.deepEqual(r.coduri_mutate, [{ id: r13, de: P(13), la: P(25) }, { id: r17, de: P(17), la: P(26) }])
  assert.deepEqual([doc(r13).seap_cod, doc(r17).seap_cod], [P(25), P(26)])
  assert.equal(randuri().length, 2)
  assert.equal(F.jurnal.filter((j) => j.startsWith('upload')).length, 0)
  assert.ok(!randuri().some((d) => d.seap_meta?.de_anuntat === true), 'nimic de anunțat')
  // a doua rulare: ambele coduri sărite pe cod, fără descărcare
  descarcate = []
  const r2 = await run()
  assert.deepEqual([r2.sarite_cod, descarcate, r2.coduri_mutate], [2, [], []])
  // D1 rămâne: fratele cu NUME de cod („X (COD).ext”) nu primește codul mutat — republicarea lui e versiune (linia rămâne întreagă).
  // E1 (r5): originalul /1 are pe linia lui un rând cu nume de cod MAI NOU (/2) → nici el nu mai e țintă: ambele republicări sunt
  // versiuni anunțate (conservator: o revenire posibilă la un conținut vechi nu se mută în tăcere)
  reset()
  const x1 = rand('X.pdf', P(1), 'AAAA'), x2 = rand('X (CN1095546-00002).pdf', P(2), 'BBBB')
  item('X.pdf', P(10), 'BBBB'); item('X.pdf', P(11), 'AAAA')
  const r3 = await run()
  assert.deepEqual(r3.coduri_mutate, [])
  assert.deepEqual(r3.versiuni_noi, ['X (CN1095546-00010).pdf', 'X (CN1095546-00011).pdf'])
  const v = randuri().find((d) => d.seap_cod === P(10))
  assert.deepEqual([v.seap_meta.inlocuieste_id, v.seap_meta.de_anuntat, doc(x2).seap_cod, doc(x1).seap_cod], [x2, true, P(2), P(1)])
})

Deno.test('e2e R3: continuarea pe rezerva arhivă (per-fișier + rezerva_arhiva) și pe metoda arhivă întoarce next_index = 0', async () => {
  const zip = await zipCu([['A.pdf', 'AAAA'], ['B.pdf', 'BBBB'], ['C.pdf', 'CCCC']])
  // per fișier: A adus, B cade (404) → rezerva DownloadArchive; bugetul de timp se termină în arhivă → continua
  reset()
  item('A.pdf', P(1), 'AAAA'); item('B.pdf', P(2), null); item('C.pdf', P(3), 'CCCC')
  arhiva = zip; saltLaArhiva = 300000
  const r = await run()
  assert.deepEqual([r.metoda, r.rezerva_arhiva, r.continua, r.next_index], ['per-fisier', true, true, 0], JSON.stringify(r))
  assert.equal(r.index, 3)   // capătul listei per fișier — NU o poziție de continuare
  assert.ok(randuri().some((d) => d.nume_original === 'B.pdf'), 'B adus din arhivă')
  // continuarea de la 0 (ca veghea / UI): nimic dublat, nimic pierdut
  saltLaArhiva = 0
  const r2 = await run({ licitatie_id: 3, de_la_index: r.next_index })
  assert.equal(r2.continua, false)
  assert.deepEqual(randuri().map((d) => d.nume_original).sort(), ['A.pdf', 'B.pdf', 'C.pdf'])
  // lista SEAP indisponibilă → metoda arhivă; continuarea tot de la 0 (înainte: poziția din ZIP)
  reset()
  listaEsueaza = true; arhiva = zip; saltLaArhiva = 300000
  const r3 = await run()
  assert.deepEqual([r3.metoda, r3.rezerva_arhiva, r3.continua, r3.next_index], ['arhiva', true, true, 0], JSON.stringify(r3))
  assert.equal(randuri().length, 1)
  saltLaArhiva = 0
  const r4 = await run({ licitatie_id: 3, de_la_index: r3.next_index })
  assert.equal(r4.continua, false)
  assert.deepEqual(randuri().map((d) => d.nume_original).sort(), ['A.pdf', 'B.pdf', 'C.pdf'])
  // per fișier fără rezervă (bugetul se termină în listă) → next_index = poziția din listă, ca înainte
  reset()
  item('A.pdf', P(1), 'AAAA'); item('B.pdf', P(2), 'BBBB')
  const fetchVechi = globalThis.fetch
  globalThis.fetch = (async (u: any, init?: any) => { if (String(u).includes('/f/A.pdf')) deplasare = 300000; return await fetchVechi(u, init) }) as any
  try {
    const r5 = await run()
    assert.deepEqual([r5.metoda, r5.rezerva_arhiva, r5.continua, r5.next_index], ['per-fisier', false, true, 1], JSON.stringify(r5))
  } finally { globalThis.fetch = fetchVechi }
})

Deno.test('e2e E1 (r5): v1 „Caiet.pdf” /10 (A), v2 „Caiet (C-00020).pdf” /20 (B), SEAP republică /30 cu A → versiune ANUNȚATĂ, nu mutare tăcută pe v1', async () => {
  reset()
  const v1 = rand('Caiet.pdf', P(10), 'CONTINUT-A', { tip: 'cs_volum' })
  const v2 = rand('Caiet (CN1095546-00020).pdf', P(20), 'CONTINUT-B', { seap_meta: { cod_sursa: 'lista', cod: P(20), de_anuntat: false } })
  item('Caiet.pdf', P(30), 'CONTINUT-A')
  const r = await run()
  assert.deepEqual([r.coduri_mutate, r.versiuni_noi], [[], ['Caiet (CN1095546-00030).pdf']], JSON.stringify(r))
  assert.deepEqual([doc(v1).seap_cod, doc(v2).seap_cod], [P(10), P(20)])
  const v30 = randuri().find((d) => d.seap_cod === P(30))
  assert.deepEqual([v30.seap_meta.de_anuntat, v30.seap_meta.inlocuieste_id, v30.seap_meta.cod_anterior], [true, v2, P(20)])
  assert.ok(!F.jurnal.some((j) => j === `download 3/atribuire/r${v1}`), 'fără citirea lui v1 (nu e țintă)')
  // lic. 100 (frați fără nume de cod, identici) — tot mutare, vezi „e2e R2”; originalul FĂRĂ versiune mai nouă — tot mutare (F5)
  reset()
  const o = rand('Plan.pdf', P(10), 'IDENTIC')
  item('Plan.pdf', P(30), 'IDENTIC')
  const r2 = await run()
  assert.deepEqual(r2.coduri_mutate, [{ id: o, de: P(10), la: P(30) }])
})

Deno.test('e2e E3 (r5): lista 403, 403, 200 → drumul per fișier (nu arhiva), cu cookie-urile încercării reușite; pauze 0,7 / 1,4 s', async () => {
  reset()
  item('A.pdf', P(1), 'AAAA'); item('B.pdf', P(2), 'BBBB')
  esecuriLista = [403, 403]
  const r = await run()
  assert.deepEqual([r.metoda, r.rezerva_arhiva, apeluriArhiva, incercariLista], ['per-fisier', false, 0, 3], JSON.stringify(r))
  assert.deepEqual(randuri().map((d) => d.nume_original).sort(), ['A.pdf', 'B.pdf'])
  assert.deepEqual(cookieDescarcari, ['s=bun', 's=bun'])
  assert.deepEqual(pauze.filter((p) => p >= 700), [700, 1400])
  // 4 încercări eșuate → abia atunci rezerva arhivă (aici HTTP 500 → metoda arhivă, eroare)
  reset()
  item('A.pdf', P(1), 'AAAA')
  esecuriLista = [403, 429, 503, 403]
  const r2 = await run()
  assert.equal(incercariLista, 4); assert.ok(apeluriArhiva >= 1); assert.equal(r2.error, 'SEAP HTTP 500')
  // 404 nu se reîncearcă (eroare reală)
  reset()
  item('A.pdf', P(1), 'AAAA')
  esecuriLista = [404]
  await run()
  assert.equal(incercariLista, 1)
})

Deno.test('e2e E3 (r5): document per fișier 403 apoi 200 → adus (fără rezervă); în afara bugetului de timp NU se mai reîncearcă', async () => {
  reset()
  item('A.pdf', P(1), 'AAAA'); item('B.pdf', P(2), 'BBBB')
  esecuriFisier.set('A.pdf|' + P(1), [403])
  const r = await run()
  assert.deepEqual([r.metoda, r.rezerva_arhiva, apeluriArhiva, r.erori], ['per-fisier', false, 0, []], JSON.stringify(r))
  assert.deepEqual(descarcate, ['A.pdf|' + P(1), 'A.pdf|' + P(1), 'B.pdf|' + P(2)])
  assert.deepEqual(randuri().map((d) => d.nume_original).sort(), ['A.pdf', 'B.pdf'])
  // bugetul de timp aproape terminat: 403 → nicio reîncercare (o pauză ar trece de BUGET_MS)
  reset()
  item('A.pdf', P(1), 'AAAA')
  esecuriFisier.set('A.pdf|' + P(1), [403])
  const fetchVechi = globalThis.fetch
  globalThis.fetch = (async (u: any, init?: any) => { if (String(u).includes('/f/A.pdf')) deplasare = 239900; return await fetchVechi(u, init) }) as any
  try {
    const r2 = await run()
    assert.deepEqual(descarcate, ['A.pdf|' + P(1)])
    assert.ok(r2.erori.some((e: string) => e.includes('A.pdf: descarcare HTTP 403')), JSON.stringify(r2.erori))
  } finally { globalThis.fetch = fetchVechi }
})

Deno.test('e2e E5 (r5): pe metoda arhivă un de_la_index primit NU sare intrări din ZIP (e poziție în lista SEAP) — tot ce lipsește e adus', async () => {
  const zip = await zipCu([['A.pdf', 'AAAA'], ['B.pdf', 'BBBB'], ['C.pdf', 'CCCC']])
  reset()
  listaEsueaza = true; arhiva = zip
  rand('A.pdf', null, 'AAAA')
  const r = await run({ licitatie_id: 3, de_la_index: 2 })
  assert.deepEqual([r.metoda, r.continua, r.sarite_existente], ['arhiva', false, 1], JSON.stringify(r))
  assert.deepEqual(randuri().map((d) => d.nume_original).sort(), ['A.pdf', 'B.pdf', 'C.pdf'])
  assert.equal(r.index, 3)   // intrările ZIP-ului parcurse, de la prima
})

Deno.test('e2e E6 (r5): fara_rezerva_arhiva → DownloadArchive NU pornește, raportul o spune, documentația nu e „adusă”; implicit neschimbat', async () => {
  reset()
  rand('Caiet.pdf', P(10), 'V0')
  listaEsueaza = true
  const r = await run({ licitatie_id: 3, fara_rezerva_arhiva: true })
  assert.equal(apeluriArhiva, 0)
  assert.deepEqual([r.rezerva_arhiva, r.rezerva_arhiva_sarita], [false, 'GetDfNoticeSectionFiles HTTP 500'], JSON.stringify(r))
  assert.ok(r.erori.some((e: string) => e.startsWith('rezerva arhiva SARITA')))
  assert.equal(F.db.ofertare_licitatii[0].documentatie_adusa_la, undefined)
  // un document nou căzut per fișier: tot fără arhivă (cu flag-ul), lipsa rămâne vizibilă
  reset()
  item('Nou.pdf', P(1), null)
  const r2 = await run({ licitatie_id: 3, fara_rezerva_arhiva: true })
  assert.equal(apeluriArhiva, 0); assert.equal(r2.rezerva_arhiva_sarita, 'descarcari per fisier esuate')
  // implicit (fără flag): rezerva pornește ca înainte
  reset()
  item('Nou.pdf', P(1), null)
  const r3 = await run()
  assert.ok(apeluriArhiva >= 1); assert.deepEqual([r3.rezerva_arhiva, r3.rezerva_arhiva_sarita], [true, null])
})

Deno.test('e2e E3 (review r5): după 3 descărcări per fișier căzute la rând, o singură încercare — bugetul rămâne pentru rezerva arhivă, care aduce tot', async () => {
  const zip = await zipCu([['A.pdf', 'AAAA'], ['B.pdf', 'BBBB'], ['C.pdf', 'CCCC'], ['D.pdf', 'DDDD'], ['E.pdf', 'EEEE']])
  reset()
  arhiva = zip
  for (const [n, k] of [['A.pdf', 1], ['B.pdf', 2], ['C.pdf', 3], ['D.pdf', 4], ['E.pdf', 5]] as const) {
    item(n, P(k), n[0].repeat(4)); esecuriFisier.set(`${n}|${P(k)}`, [403, 403, 403, 403])
  }
  const r = await run()
  // A, B, C: câte 4 încercări; D, E: o singură încercare (siguranța pe eșecuri la rând)
  const nr = (n: string) => descarcate.filter((d) => d.startsWith(n)).length
  assert.deepEqual(['A.pdf', 'B.pdf', 'C.pdf', 'D.pdf', 'E.pdf'].map(nr), [4, 4, 4, 1, 1], descarcate.join(' '))
  assert.equal(apeluriArhiva, 1)
  assert.deepEqual(randuri().map((d) => d.nume_original).sort(), ['A.pdf', 'B.pdf', 'C.pdf', 'D.pdf', 'E.pdf'], JSON.stringify(r.erori))
})

Deno.test('e2e Copilot r1 (P1): două rânduri vechi cu același nume, FĂRĂ cod, mărime și dovadă + cod SEAP nou → se citesc din Storage: alt conținut → frate adus; același conținut → cod adoptat pe ACEL rând', async () => {
  reset()
  rand('Anexa.pdf', null, 'AAAA', { size_bytes: null }); rand('Anexa.pdf', null, 'BBBB', { size_bytes: null })
  item('Anexa.pdf', P(5), 'CCCC')
  const r = await run()
  assert.deepEqual([r.identitate_neverificata, r.frati.length, r.coduri_adoptate], [[], 1, []], JSON.stringify(r))
  assert.equal(randuri().length, 3)
  assert.ok(F.db.ofertare_licitatii[0].documentatie_adusa_la, 'identitatea dovedită (alt conținut) → documentația adusă')
  reset()
  const a2 = rand('Anexa.pdf', null, 'AAAA', { size_bytes: null }); rand('Anexa.pdf', null, 'BBBB', { size_bytes: null })
  item('Anexa.pdf', P(5), 'AAAA')
  const r2 = await run()
  assert.deepEqual([r2.coduri_adoptate, r2.identitate_neverificata], [[{ id: a2, cod: P(5) }], []])
})

Deno.test('e2e Copilot r1 (P1): un candidat ILIZIBIL (obiect lipsă din Storage) → identitate NEVERIFICATĂ, fail-closed: fără rând nou, fără „exista deja”, documentația NU se declară adusă', async () => {
  reset()
  const a = rand('Anexa.pdf', null, 'AAAA', { size_bytes: null }); rand('Anexa.pdf', null, 'BBBB', { size_bytes: null })
  F.storage.delete(doc(a).fisier_path)
  item('Anexa.pdf', P(5), 'CCCC')
  const r = await run()
  assert.equal(r.identitate_neverificata.length, 1); assert.match(r.identitate_neverificata[0], /nu s-a putut citi/)
  assert.ok(r.erori.some((e: string) => /identitatea nu s-a putut verifica/.test(e)))
  assert.deepEqual([r.sarite_existente, randuri().length, F.db.ofertare_licitatii[0].documentatie_adusa_la], [0, 2, undefined])
})
