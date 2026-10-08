// Linux (worker): deno test --node-modules-dir=none --allow-net --allow-env
// --allow-read=/app,/deno-dir,/tmp,/packs,/seap-work --allow-write=/deno-dir,/tmp,/packs,/seap-work
// --allow-run=deno /app/worker/ofertare/verifica_manifest_test.ts
// Dreptul run=deno este numai pentru testul cu procese distincte, niciodată pentru worker.
// SEAP_TEST_ROOT=/seap-work; local: directorul curent sau SEAP_TEST_ROOT explicit.
import { ok as assert, deepStrictEqual as eq, rejects } from 'node:assert/strict'
import { verificaManifest } from './verifica_manifest_lib.ts'
import type { proceseazaSeap } from './seap.ts'

const enc = new TextEncoder()
const documente = [
  { id: 11, nume_original: 'A (1).pdf', fisier_path: '93/a', size_bytes: 5 },
  { id: 12, nume_original: 'b.pdf', fisier_path: '93/b', size_bytes: 4 },
  { id: 13, nume_original: 'c.pdf', fisier_path: '93/c', size_bytes: 5 },
  { id: 14, nume_original: 'manual.pdf', fisier_path: '93/manual', size_bytes: 5 },
  { id: 15, nume_original: 'lipsa.pdf', fisier_path: '93/neincarcat/lipsa', size_bytes: 0 },
]
const surse: Record<string, string> = { 'a1.pdf': 'alpha', 'b.pdf': 'beta', 'c.pdf': 'gamma', 'lipsa.pdf': 'delta' }
// audit #4 var. B (PR-2): „b.pdf” republicat sub cod nou → versiunea „b (CN1-00002).pdf” (id 16) e rândul de verificat, nu b.pdf vechi
const documenteCod = [...documente.map(d => d.id === 12 ? { ...d, seap_cod: 'CN1/00001' } : d),
  { id: 16, nume_original: 'b (CN1-00002).pdf', fisier_path: '93/b2', size_bytes: 5, seap_cod: 'CN1/00002' }]
const surseCod: Record<string, string> = { ...surse, 'b.pdf': 'beta2' }
const coduriSeap: Record<string, string> = { 'b.pdf': 'CN1/00002' }
type Opt = {
  ctl?: AbortController; stopDupaPrimul?: boolean; blocat?: 'lista' | 'document' | 'storage' | 'flux'
  arhiva?: boolean; blocatExtractor?: 'listare' | 'extragere'; uscat?: boolean; periodica?: boolean; cuCod?: boolean
  // lista SEAP explicită (același nume poate apărea de două ori, cu coduri diferite) + inventarul platformei
  seapLista?: { nume: string; cod?: string; text: string }[]; docsBd?: Record<string, unknown>[]
  storageUrl?: string; statusStorage?: number; caleStorage?: string
  dovezi?: { arhiva_cheie: string; cale: string; document_id: number | null; sha256: string; stare: string }[]; eroareDovezi?: boolean
  inainte?: (root: string, supa: Parameters<typeof verificaManifest>[0]) => Promise<void>
  laStorage?: (root: string, supa: Parameters<typeof verificaManifest>[0]) => Promise<void>
}

async function scenariu(opt: Opt = {}) {
  const root = await Deno.makeTempDir({ dir: Deno.env.get('SEAP_TEST_ROOT') ?? (Deno.build.os === 'windows' ? Deno.cwd() : '/tmp'), prefix: '.verifica-manifest-test-' })
  const vechiLucru = Deno.env.get('SEAP_LUCRU'), fetchVechi = globalThis.fetch
  const envStorage = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].map(k => [k, Deno.env.get(k)] as const)
  Deno.env.set('SUPABASE_URL', 'https://storage.invalid')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'cheie-test-env')
  Deno.env.set('SEAP_LUCRU', root)
  const scrieri: any[] = [], descarcate: string[] = []
  let fluxAnulat = false, storage = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const blocheaza = (signal?: AbortSignal | null): Promise<never> => {
    assert(signal, 'cererea trebuie să primească AbortSignal')
    return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      opt.ctl!.abort()
    })
  }
  const raspuns = (data: unknown) => ({
    abortSignal(signal: AbortSignal) { assert(signal); return Promise.resolve({ data, error: null }) },
  })
  // pe pagini (toatePaginile): .order('id').range(de, la).abortSignal(...) — intervalul respectat ca la PostgREST
  const raspunsDovezi = () => ({ order: (c: string) => { eq(c, 'id'); return { range: (de: number, la: number) => ({
    abortSignal(signal: AbortSignal) { assert(signal); return Promise.resolve(opt.eroareDovezi ? { data: null, error: { message: 'simulat: manifest indisponibil' } } : { data: (opt.dovezi ?? []).slice(de, la + 1), error: null }) },
  }) } } })
  const supa = {
    from(t: string) {
      if (t === 'ofertare_seap_cereri' && opt.periodica) return {
        upsert: async () => ({ error: null }),
        select: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }),
      }
      if (t === 'ofertare_seap_manifest') return {
        select: () => ({ eq: () => ({
          order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          // dovezile existente: .eq('licitatie_id', 93).in('stare', ['urcat', 'deja_in_platforma']).not('document_id', 'is', null)
          in: (k: string, v: string[]) => {
            eq([k, v], ['stare', ['urcat', 'deja_in_platforma']])
            return { not: (c: string, o: string, val: unknown) => { eq([c, o, val], ['document_id', 'is', null]); return raspunsDovezi() } }
          },
        }) }),
        upsert(rows: any[], conf: unknown) {
        eq(conf, { onConflict: 'licitatie_id,arhiva_cheie,cale' })
        scrieri.push(...rows)
        return raspuns(null)
      } }
      assert(['ofertare_licitatii', 'ofertare_documente_atribuire'].includes(t), `tabel neașteptat: ${t}`)
      return { select: (cols: string) => cols === 'id' && opt.periodica
        ? { eq: () => ({ not: () => ({ gt: async () => ({ data: [{ id: 93 }] }) }) }) }
        : ({ eq(k: string, v: number) {
        eq([k, v], [t === 'ofertare_licitatii' ? 'id' : 'licitatie_id', 93])
        return t === 'ofertare_licitatii'
          ? { abortSignal: (signal: AbortSignal) => { assert(signal); return { single: async () => ({ data: { c_notice_id: 123, sys_notice_type_id: 2 }, error: null }) } } }
          : { order: (c: string) => { eq(c, 'id'); return { range: (de: number, la: number) =>
              raspuns(((opt.docsBd ?? (opt.cuCod ? documenteCod : documente)) as typeof documente).map(d => d.id === 11 && opt.caleStorage ? { ...d, fisier_path: opt.caleStorage } : d).slice(de, la + 1)) } } }
      } }) }
    },
    storage: { from() { throw new Error('SDK Storage interzis: descărcarea trebuie să fie anulabilă integral') } },
  } as unknown as Parameters<typeof verificaManifest>[0] & Parameters<typeof proceseazaSeap>[0]
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (opt.storageUrl && url.startsWith(`${opt.storageUrl}/storage/`)) return fetchVechi(input, init)
    if (url.startsWith('https://storage.invalid/')) {
      assert(init?.signal)
      const headers = new Headers(init.headers)
      eq(headers.get('Authorization'), 'Bearer cheie-test-env')
      eq(headers.get('apikey'), 'cheie-test-env')
      if (opt.blocat === 'storage') return await blocheaza(init.signal)
      storage++
      if (storage === 1) await opt.laStorage?.(root, supa)
      const path = new URL(url).pathname.replace('/storage/v1/object/authenticated/ofertare/', '')
      if (path === '93/503') return new Response('indisponibil', { status: 503 })   // candidat necitit (Jakarinos r17)
      const text = ({ '93/a': 'alpha', '93/b': 'beta', '93/c': 'ALTFEL', '93/b2': 'beta2' } as Record<string, string>)[path]
      assert(text !== undefined, `obiect Storage neașteptat: ${path}`)
      const raspuns = new Response(text, { status: opt.statusStorage ?? 200 })
      const arrayBuffer = raspuns.arrayBuffer.bind(raspuns)
      raspuns.arrayBuffer = () => {
        if (opt.stopDupaPrimul && storage === 1) opt.ctl!.abort()
        return arrayBuffer()
      }
      return raspuns
    }
    if (url.includes('/GetDfNoticeSectionFiles/')) {
      if (opt.blocat === 'lista') return await blocheaza(init?.signal)
      if (opt.seapLista) return Response.json({ dfNoticeDocs: opt.seapLista.map((d, i) => ({ noticeDocumentName: d.nume, noticeDocumentUrl: `https://seap.invalid/L${i}`, ...(d.cod ? { noticeDocumentCode: d.cod } : {}) })) })
      const nume = opt.arhiva ? ['set.zip'] : Object.keys(surse)
      return Response.json({ dfNoticeDocs: nume.map(n => ({ noticeDocumentName: n, noticeDocumentUrl: `https://seap.invalid/${n}`, ...(opt.cuCod && coduriSeap[n] ? { noticeDocumentCode: coduriSeap[n] } : {}) })) })
    }
    assert(url.startsWith('https://seap.invalid/'), `fetch neașteptat: ${url}`)
    const nume = url.split('/').pop()!
    descarcate.push(nume)
    assert(init?.signal)
    if (opt.blocat === 'document') return await blocheaza(init.signal)
    if (opt.blocat === 'flux') return new Response(new ReadableStream({
      start(c) { c.enqueue(enc.encode('fragment')); queueMicrotask(() => opt.ctl!.abort()) },
      cancel() { fluxAnulat = true },
    }))
    if (opt.arhiva && opt.blocatExtractor !== 'listare') {
      // Extractor simulat numai prin protocolul de fișiere; nu pornește niciun executabil.
      const directoare = (await copii(root)).filter(e => e.isDirectory && e.name.startsWith('verif_93_'))
      eq(directoare.length, 1)
      const dir = `${root}/${directoare[0].name}/0`
      const fisiere = { ...surse, '.DS_Store': 'junk' }
      await Deno.writeTextFile(`${dir}/rasp/listare.cod`, '0')
      await Deno.writeTextFile(`${dir}/rasp/listare.txt`, Object.entries(fisiere).map(([n, t]) => `Path = ${n}\nSize = ${t.length}\n`).join('\n'))
      await Deno.writeTextFile(`${dir}/rasp/listare.gata`, '')
      for (const [n, t] of Object.entries(fisiere)) await Deno.writeTextFile(`${dir}/out/${n}`, t)
      if (opt.blocatExtractor !== 'extragere') await Deno.writeTextFile(`${dir}/rasp/rezultat`, '0\n')
    }
    if (opt.blocatExtractor) timer = setTimeout(() => opt.ctl!.abort(), 100)
    if (opt.seapLista && /^L\d+$/.test(nume)) return new Response(opt.seapLista[Number(nume.slice(1))].text)
    return new Response(opt.arhiva ? 'zip simulat' : (opt.cuCod ? surseCod : surse)[nume])
  }
  try {
    await opt.inainte?.(root, supa)
    const raport = await verificaManifest(supa, 93, { uscat: opt.uscat, semnal: opt.ctl?.signal,
      ...(opt.storageUrl ? { storage: { url: `${opt.storageUrl}/`, cheie: 'cheie-test-explicita' } } : {}) })
    if (opt.periodica) {
      // Instanță separată: LUCRU și curățenia de la pornire văd exclusiv directorul simulat.
      const { proceseazaSeap } = await import(new URL('./seap.ts?verifica-manifest-test', import.meta.url).href)
      scrieri.length = 0; descarcate.length = 0
      const logs: string[] = [], logVechi = console.log
      console.log = (...args: unknown[]) => logs.push(args.join(' '))
      try { await proceseazaSeap(supa, () => false, () => {}) } finally { console.log = logVechi }
      assert(logs.some(l => l.includes('#93: verificare ok — identice 2, diferite 1, lipsă 1')), logs.join('\n'))
      eq(scrieri.length, 4, 'verificarea periodică trebuie să scrie manifestul în proces')
    }
    eq((await copii(root)).map(e => e.name), ['verif_93.lock'], 'rămâne numai fișierul permanent de lock')
    const lock = await Deno.open(`${root}/verif_93.lock`, { write: true })
    try { assert(await lock.tryLock(true), 'lock eliberat inclusiv după anulare'); await lock.unlock() } finally { lock.close() }
    return { raport, scrieri, descarcate, fluxAnulat }
  } finally {
    clearTimeout(timer)
    globalThis.fetch = fetchVechi
    if (vechiLucru === undefined) Deno.env.delete('SEAP_LUCRU'); else Deno.env.set('SEAP_LUCRU', vechiLucru)
    for (const [k, v] of envStorage) { if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v) }
    await Deno.remove(root, { recursive: true })
  }
}

async function copii(dir: string) { const out = []; for await (const e of Deno.readDir(dir)) out.push(e); return out }
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map(n => n.toString(16).padStart(2, '0')).join('')

Deno.test('manifest: 2 identice, 1 diferit, 1 lipsă; toate câmpurile și rândurile', async () => {
  const { raport, scrieri, descarcate } = await scenariu()
  eq(raport, { licitatie: 93, seap_documente: 4, fisiere: 4, identice: 2, diferite: 1, lipsa_in_platforma: 1,
    ignorate: 0, manifest_scrise: 4, uscat: false, platforma_fara_seap: ['manual.pdf'], erori: [] })
  eq(descarcate, Object.keys(surse))
  for (const [i, [nume, continut]] of Object.entries(surse).entries()) {
    const r = scrieri[i]
    const motiv = i === 2
      ? `DIFERIT de Storage: sha ${(await sha('ALTFEL')).slice(0, 12)}… / 6 B vs SEAP ${(await sha(continut)).slice(0, 12)}… / ${continut.length} B`
      : i === 3 ? 'LIPSĂ în platformă (verificare R6)' : null
    assert(Number.isFinite(Date.parse(r.verificat_la)))
    eq(r, { licitatie_id: 93, arhiva_cheie: nume, cale: nume, marime: continut.length, sha256: await sha(continut),
      document_id: i < 3 ? 11 + i : null, stare: i === 3 ? 'eroare_urcare' : 'deja_in_platforma', motiv, verificat_la: r.verificat_la })
  }
})

Deno.test('manifest (PR-2): documentul cu cod se verifică pe rândul care poartă codul (versiunea), cu cheia lui — fără „DIFERIT” fals pe rândul vechi', async () => {
  const dovada = { arhiva_cheie: 'b (cn1-00002).pdf', cale: 'b (CN1-00002).pdf', document_id: 16, sha256: await sha('beta2'), stare: 'urcat' }
  const { raport, scrieri } = await scenariu({ cuCod: true, dovezi: [dovada] })
  eq([raport.identice, raport.diferite, raport.lipsa_in_platforma], [2, 1, 1])   // c.pdf rămâne diferit, lipsa.pdf lipsă
  const r = scrieri.find(x => x.document_id === 16)
  eq([r?.arhiva_cheie, r?.cale, r?.stare, r?.motiv], ['b (cn1-00002).pdf', 'b (CN1-00002).pdf', 'urcat', null], 'dovada versiunii confirmată pe cheia ei')
  assert(!scrieri.some(x => x.document_id === 12), 'rândul vechi b.pdf nu e comparat cu versiunea nouă (nicio dovadă retrogradată)')
  eq(raport.platforma_fara_seap, ['b.pdf', 'manual.pdf'], 'originalul înlocuit nu mai e în SEAP')
})

Deno.test('manifest (PR-2, Jakarinos r2): un cod fără rând nu cade pe numele altui cod — dovada lui /1 rămâne, /2 e raportat lipsă pe cheia lui', async () => {
  const docsBd = [{ id: 21, nume_original: 'N.pdf', fisier_path: '93/a', size_bytes: 5, seap_cod: 'CN1/00001' }]
  const dovada = { arhiva_cheie: 'n.pdf', cale: 'N.pdf', document_id: 21, sha256: await sha('alpha'), stare: 'urcat' }
  const { raport, scrieri } = await scenariu({ docsBd, dovezi: [dovada],
    seapLista: [{ nume: 'N.pdf', cod: 'CN1/00001', text: 'alpha' }, { nume: 'N.pdf', cod: 'CN1/00002', text: 'omega' }] })
  const r1 = scrieri.find(x => x.document_id === 21)
  eq([r1?.arhiva_cheie, r1?.cale, r1?.stare, r1?.motiv], ['n.pdf', 'N.pdf', 'urcat', null], 'dovada lui /1 confirmată, nu retrogradată')
  const r2 = scrieri.find(x => x.cale === 'N (CN1-00002).pdf')
  eq([r2?.arhiva_cheie, r2?.stare, r2?.document_id], ['n (cn1-00002).pdf', 'eroare_urcare', null], '/2 raportat lipsă, pe cheia lui')
  eq([raport.identice, raport.diferite, raport.lipsa_in_platforma, scrieri.length], [1, 0, 1, 2])
})

Deno.test('manifest (PR-2, Jakarinos r3 #1): fratele cu conținut IDENTIC, deduplicat fără rând propriu, nu e „LIPSĂ” — legat de rândul existent pe cheia lui', async () => {
  const docsBd = [{ id: 21, nume_original: 'N.pdf', fisier_path: '93/a', size_bytes: 5, seap_cod: 'CN1/00001' }]
  const dovada = { arhiva_cheie: 'n.pdf', cale: 'N.pdf', document_id: 21, sha256: await sha('alpha'), stare: 'urcat' }
  const { raport, scrieri } = await scenariu({ docsBd, dovezi: [dovada],
    seapLista: [{ nume: 'N.pdf', cod: 'CN1/00001', text: 'alpha' }, { nume: 'N.pdf', cod: 'CN1/00002', text: 'alpha' }] })
  const r1 = scrieri.find(x => x.cale === 'N.pdf'), r2 = scrieri.find(x => x.cale === 'N (CN1-00002).pdf')
  eq([r1?.document_id, r1?.stare], [21, 'urcat'], 'dovada lui /1 neatinsă')
  eq([r2?.arhiva_cheie, r2?.document_id, r2?.stare], ['n (cn1-00002).pdf', 21, 'deja_in_platforma'], '/2 legat de #21 pe cheia lui')
  eq([raport.identice, raport.lipsa_in_platforma, raport.diferite], [2, 0, 0])
})

for (const ordine of ['/2,/1', '/1,/2']) Deno.test(`manifest (PR-2, Jakarinos r3 #2): două rânduri „N.pdf” (/1, /2) nu-și suprascriu dovezile — ordinea ${ordine}`, async () => {
  const docsBd = [{ id: 21, nume_original: 'N.pdf', fisier_path: '93/a', size_bytes: 5, seap_cod: 'CN1/00001' },
    { id: 22, nume_original: 'N.pdf', fisier_path: '93/b', size_bytes: 4, seap_cod: 'CN1/00002' }]
  const dovada = { arhiva_cheie: 'n.pdf', cale: 'N.pdf', document_id: 22, sha256: await sha('beta'), stare: 'urcat' }
  const d1 = { nume: 'N.pdf', cod: 'CN1/00001', text: 'alpha' }, d2 = { nume: 'N.pdf', cod: 'CN1/00002', text: 'beta' }
  const { raport, scrieri } = await scenariu({ docsBd, dovezi: [dovada], seapLista: ordine === '/2,/1' ? [d2, d1] : [d1, d2] })
  const pe = Object.fromEntries(scrieri.map(x => [x.document_id, [x.arhiva_cheie, x.cale, x.stare]]))
  eq(pe, { 21: ['n (cn1-00001).pdf', 'N (CN1-00001).pdf', 'deja_in_platforma'], 22: ['n.pdf', 'N.pdf', 'urcat'] }, JSON.stringify(scrieri))
  eq([raport.identice, raport.diferite, raport.lipsa_in_platforma, scrieri.length], [2, 0, 0, 2])
})

Deno.test('manifest (PR-2, Jakarinos r4): fratele deduplicat pe „N (/2).pdf” rămâne legat după ce /2 iese din listă (înlocuit de /4) — nu redevine „LIPSĂ”', async () => {
  // N.pdf /1 (alpha) pe #21; frate /2 urcat ca „N (CN1-00002).pdf” (beta) pe #22; /3 (beta) deduplicat pe #22; acum SEAP: /1, /3, /4 (gamma)
  const docsBd = [{ id: 21, nume_original: 'N.pdf', fisier_path: '93/a', size_bytes: 5, seap_cod: 'CN1/00001' },
    { id: 22, nume_original: 'N (CN1-00002).pdf', fisier_path: '93/b', size_bytes: 4, seap_cod: 'CN1/00002' }]
  const dovezi = [{ arhiva_cheie: 'n (cn1-00003).pdf', cale: 'N (CN1-00003).pdf', document_id: 22, sha256: await sha('beta'), stare: 'deja_in_platforma' }]
  const { raport, scrieri } = await scenariu({ docsBd, dovezi, seapLista: [{ nume: 'N.pdf', cod: 'CN1/00001', text: 'alpha' },
    { nume: 'N.pdf', cod: 'CN1/00003', text: 'beta' }, { nume: 'N.pdf', cod: 'CN1/00004', text: 'gamma' }] })
  const r3 = scrieri.find(x => x.cale === 'N (CN1-00003).pdf'), r4 = scrieri.find(x => x.cale === 'N (CN1-00004).pdf')
  eq([r3?.document_id, r3?.stare], [22, 'deja_in_platforma'], '/3 rămâne legat de #22')
  eq([r4?.document_id, r4?.stare], [null, 'eroare_urcare'], '/4 (alt conținut, neadus) e lipsă')
  eq([raport.identice, raport.lipsa_in_platforma], [2, 1])
})

Deno.test('manifest (PR-2, Jakarinos r5): /3 rămas SINGUR în listă, deduplicat pe „N (/2).pdf”, fără „N.pdf” și fără rival → legat, nu „LIPSĂ”', async () => {
  const docsBd = [{ id: 22, nume_original: 'N (CN1-00002).pdf', fisier_path: '93/b', size_bytes: 4, seap_cod: 'CN1/00002' }]
  const dovezi = [{ arhiva_cheie: 'n (cn1-00003).pdf', cale: 'N (CN1-00003).pdf', document_id: 22, sha256: await sha('beta'), stare: 'deja_in_platforma' }]
  const { raport, scrieri } = await scenariu({ docsBd, dovezi, seapLista: [{ nume: 'N.pdf', cod: 'CN1/00003', text: 'beta' }] })
  eq(scrieri.map(x => [x.cale, x.document_id, x.stare]), [['N (CN1-00003).pdf', 22, 'deja_in_platforma']])
  eq([raport.identice, raport.lipsa_in_platforma], [1, 0])
})

Deno.test('manifest (PR-2): cod fără rând, fără rival, rândul vechi „N.pdf” fără cod are alt conținut → pe nume, ca înainte (DIFERIT)', async () => {
  const docsBd = [{ id: 21, nume_original: 'N.pdf', fisier_path: '93/a', size_bytes: 5, seap_cod: null }]
  const { raport, scrieri } = await scenariu({ docsBd, seapLista: [{ nume: 'N.pdf', cod: 'CN1/00001', text: 'omega' }] })
  eq(scrieri.map(x => [x.cale, x.document_id, x.stare]), [['N.pdf', 21, 'deja_in_platforma']])
  eq([raport.identice, raport.diferite, raport.lipsa_in_platforma], [0, 1, 0])
})

Deno.test('manifest (PR-2, Jakarinos r6): identic cu rândul vechi fără cod, alt rând cu același nume are dovadă → legat pe cheia codului, dovada celuilalt neatinsă', async () => {
  const docsBd = [{ id: 21, nume_original: 'N.pdf', fisier_path: '93/a', size_bytes: 5, seap_cod: 'CN1/00001' },
    { id: 22, nume_original: 'N.pdf', fisier_path: '93/b', size_bytes: 4, seap_cod: null }]
  const dovada = { arhiva_cheie: 'n.pdf', cale: 'N.pdf', document_id: 21, sha256: await sha('alpha'), stare: 'urcat' }
  const { raport, scrieri } = await scenariu({ docsBd, dovezi: [dovada], seapLista: [{ nume: 'N.pdf', cod: 'CN1/00003', text: 'beta' }] })
  eq(scrieri.map(x => [x.cale, x.document_id, x.stare]), [['N (CN1-00003).pdf', 22, 'deja_in_platforma']], 'nicio scriere pe cheia lui #21')
  eq([raport.identice, raport.diferite, raport.lipsa_in_platforma], [1, 0, 0])
})

Deno.test('manifest: uscat nu scrie manifestul', async () => {
  const { raport, scrieri } = await scenariu({ uscat: true })
  eq(scrieri, [])
  eq([raport.uscat, raport.manifest_scrise, raport.identice, raport.diferite, raport.lipsa_in_platforma], [true, 0, 2, 1, 1])
})

Deno.test('manifest: plafon înainte de al doilea document, raport parțial și curățenie', async () => {
  const { raport, descarcate, scrieri } = await scenariu({ ctl: new AbortController(), stopDupaPrimul: true })
  eq(descarcate, ['a1.pdf'])
  eq([raport.fisiere, raport.identice, raport.diferite, raport.manifest_scrise], [1, 1, 0, 0])
  eq(raport.erori, ['oprit la plafon'])
  eq(scrieri, [])
})

for (const blocat of ['lista', 'document', 'storage', 'flux'] as const) Deno.test(`manifest: anulează ${blocat} blocat și curăță`, async () => {
  const { raport, descarcate, fluxAnulat } = await scenariu({ ctl: new AbortController(), blocat })
  eq(raport.erori, ['oprit la plafon'])
  eq(descarcate, blocat === 'lista' ? [] : ['a1.pdf'])
  eq(raport.manifest_scrise, 0)
  if (blocat === 'flux') assert(fluxAnulat)
})

for (const blocatExtractor of ['listare', 'extragere'] as const) Deno.test(`manifest: plafon în așteptarea ${blocatExtractor}, fără extractor`, async () => {
  const { raport } = await scenariu({ ctl: new AbortController(), arhiva: true, blocatExtractor })
  eq(raport.erori, ['oprit la plafon'])
  eq(raport.manifest_scrise, 0)
})

Deno.test({ name: 'manifest: permisiuni worker, fără run deno/docker inclusiv arhivă', permissions: { run: false, env: 'inherit', read: 'inherit', write: 'inherit', net: 'inherit' }, fn: async () => {
  assert((await Deno.permissions.query({ name: 'run', command: 'deno' })).state !== 'granted')  // fără TTY „prompt” = refuzat
  const { raport, scrieri } = await scenariu({ arhiva: true })
  eq([raport.seap_documente, raport.fisiere, raport.identice, raport.diferite, raport.lipsa_in_platforma, raport.ignorate, raport.manifest_scrise], [1, 5, 2, 1, 1, 1, 5])
  eq(raport.erori, [])
  assert(scrieri.every(r => r.arhiva_cheie === 'set.zip'))
  eq(scrieri.find(r => r.cale === '.DS_Store')?.stare, 'ignorat')
} })

Deno.test({ name: 'manifest: bucla periodică verifică în proces, fără drept de subprocess', permissions: { run: false, env: 'inherit', read: 'inherit', write: 'inherit', net: 'inherit' }, fn: async () => {
  await scenariu({ periodica: true })
} })

Deno.test('manifest r2: două verificări simultane, a doua refuzată fără să atingă prima', async () => {
  let verificat = false
  const { raport } = await scenariu({ laStorage: async (root, supa) => {
    const inainte = await copii(root)
    const directoare = inainte.filter(e => e.isDirectory)
    eq(directoare.length, 1)
    assert(/^verif_93_[0-9a-f-]{36}$/.test(directoare[0].name))
    const fisier = `${root}/${directoare[0].name}/0/in/a1.pdf`
    eq(await Deno.readTextFile(fisier), 'alpha')
    const lock = await Deno.stat(`${root}/verif_93.lock`)
    await rejects(() => verificaManifest(supa, 93), /verificare deja în curs pentru 93/)
    eq(await copii(root), inainte)
    eq((await Deno.stat(`${root}/verif_93.lock`)).mtime, lock.mtime)
    eq(await Deno.readTextFile(fisier), 'alpha')
    verificat = true
  } })
  assert(verificat)
  eq([raport.identice, raport.diferite, raport.lipsa_in_platforma, raport.manifest_scrise], [2, 1, 1, 4])
  eq(raport.erori, [])
})

for (const minute of [0, 121]) Deno.test(`manifest r3: fișier lock neblocat de ${minute} minute reutilizat fără ștergere`, async () => {
  await scenariu({ inainte: async (root, supa) => {
    const path = `${root}/verif_93.lock`
    await Deno.writeTextFile(path, 'fișier permanent')
    const vechi = new Date(Date.now() - minute * 60_000)
    await Deno.utime(path, vechi, vechi)
    const info = await Deno.stat(path)
    const raport = await verificaManifest(supa, 93, { uscat: true })
    eq(raport.erori, [])
    eq(await Deno.readTextFile(path), 'fișier permanent')
    eq((await Deno.stat(path)).mtime, info.mtime)
    eq((await copii(root)).map(e => e.name), ['verif_93.lock'])
  } })
})

Deno.test('manifest r2: eroarea eliberează lock-ul și directorul propriu, păstrează directoarele străine', async () => {
  await scenariu({ inainte: async (root, supa) => {
    const strain = `${root}/verif_93_rulare_veche`
    await Deno.mkdir(strain)
    await Deno.writeTextFile(`${strain}/dovada`, 'păstrează')
    const defect = { from() { throw new Error('eroare simulată înainte de SEAP') } } as unknown as typeof supa
    await rejects(() => verificaManifest(defect, 93), /eroare simulată înainte de SEAP/)
    eq((await copii(root)).map(e => e.name).sort(), ['verif_93.lock', 'verif_93_rulare_veche'])
    eq(await Deno.readTextFile(`${strain}/dovada`), 'păstrează')
    await Deno.remove(strain, { recursive: true })
  } }) // O nouă verificare reușită dovedește și eliberarea protecției din proces.
})

Deno.test('manifest r3: eroare Storage HTTP explicită', async () => {
  const { raport, scrieri } = await scenariu({ statusStorage: 503 })
  eq([raport.identice, raport.diferite, raport.erori.length], [0, 0, 3])
  assert(raport.erori.every(e => e.includes('Storage indisponibil: HTTP 503')))
  assert(scrieri.filter(r => r.document_id !== null).every(r => r.motiv.startsWith('Storage indisponibil:')))
})

Deno.test('manifest r3: fetch Storage real blocat, plafon 300 ms, revine în sub 2 s', async () => {
  const ctl = new AbortController(), serverCtl = new AbortController()
  let acceptata = false
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, signal: serverCtl.signal, onListen() {} }, () => {
    acceptata = true
    // Niciun răspuns cât timp verificarea rulează. Eliberăm handlerul numai la curățenia serverului.
    return new Promise<Response>(resolve => serverCtl.signal.addEventListener('abort', () => resolve(new Response(null)), { once: true }))
  })
  const inceput = performance.now()
  const timer = setTimeout(() => ctl.abort(), 300)
  // Dacă anularea fetch-ului regresează, închidem serverul și eșuăm, fără a bloca suita.
  const watchdog = setTimeout(() => serverCtl.abort(), 1800)
  try {
    const { raport, scrieri } = await scenariu({ ctl, storageUrl: `http://127.0.0.1:${server.addr.port}` })
    assert(acceptata, 'cererea trebuie să ajungă la serverul HTTP real')
    assert(!serverCtl.signal.aborted, 'verificarea trebuie să revină prin AbortSignal, fără închiderea serverului')
    assert(performance.now() - inceput < 2000, 'fetch-ul real trebuie să se anuleze în sub 2 s')
    eq(raport.erori, ['oprit la plafon'])
    eq(raport.manifest_scrise, 0)
    eq(scrieri, [])
  } finally {
    clearTimeout(timer)
    clearTimeout(watchdog)
    serverCtl.abort()
    await server.finished
  }
})

for (const status of [200, 404]) Deno.test(`manifest r3: Storage HTTP real ${status}, autentificare și cale encodată`, async () => {
  const cereri: { url: string; method: string; headers: Headers }[] = []
  const cale = '93/dosar cu spații/șantier #1%?.pdf'
  const serverCtl = new AbortController()
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, signal: serverCtl.signal, onListen() {} }, req => {
    cereri.push({ url: req.url, method: req.method, headers: new Headers(req.headers) })
    const path = new URL(req.url).pathname
    const text = path.endsWith('/b') ? 'beta' : path.endsWith('/c') ? 'gamma' : 'alpha'
    return new Response(text, { status })
  })
  try {
    const { raport, scrieri } = await scenariu({ storageUrl: `http://127.0.0.1:${server.addr.port}`, caleStorage: cale })
    eq(cereri.length, 3)
    eq(new URL(cereri[0].url).pathname, `/storage/v1/object/authenticated/ofertare/${cale.split('/').map(encodeURIComponent).join('/')}`)
    for (const req of cereri) {
      eq(req.method, 'GET')
      eq(req.headers.get('Authorization'), 'Bearer cheie-test-explicita')
      eq(req.headers.get('apikey'), 'cheie-test-explicita')
    }
    if (status === 200) {
      eq([raport.identice, raport.diferite], [3, 0])
      eq(raport.erori, [])
    } else {
      eq([raport.identice, raport.diferite, raport.erori.length], [0, 0, 3])
      assert(raport.erori.every(e => e.endsWith('Storage indisponibil: HTTP 404')))
      assert(scrieri.filter(r => r.document_id !== null).every(r => r.motiv === 'Storage indisponibil: HTTP 404'))
    }
  } finally { serverCtl.abort(); await server.finished }
})

for (const oprire of ['normal', 'kill'] as const) Deno.test({
  name: `manifest r3: procese Deno distincte, refuz concurent și reluare după ${oprire}`,
  permissions: { run: [Deno.execPath()], env: 'inherit', read: 'inherit', write: 'inherit', net: false },
  fn: async () => {
    const root = await Deno.makeTempDir({ dir: Deno.env.get('SEAP_TEST_ROOT') ?? Deno.cwd(), prefix: '.verifica-lock-test-' })
    const helper = new URL('./verifica_manifest_lock_helper.ts', import.meta.url)
    const porneste = (mod: string) => new Deno.Command(Deno.execPath(), {
      args: ['run', '--no-check', '--no-lock', '--node-modules-dir=none', '--allow-env=SEAP_LUCRU,SEAP_EXTRACTOR_UID',
        `--allow-read=${root}`, `--allow-write=${root}`, helper.href, mod],
      env: { SEAP_LUCRU: root }, stdin: 'piped', stdout: 'piped', stderr: 'piped',
    }).spawn()
    const procese: Deno.ChildProcess[] = []
    const omoara = (p: Deno.ChildProcess) => { try { p.kill('SIGKILL') } catch { /* deja terminat */ } }
    // Watchdog: un lock blocant sau un helper defect trebuie să eșueze, nu să blocheze suita.
    const watchdog = setTimeout(() => procese.forEach(omoara), 10_000)
    let cititor: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const lockPath = `${root}/verif_93.lock`, vechi = new Date(Date.now() - 121 * 60_000)
      await Deno.writeTextFile(lockPath, 'fișier permanent')
      await Deno.utime(lockPath, vechi, vechi)
      const primul = porneste('tine'); procese.push(primul)
      cititor = primul.stdout.getReader()
      let primaLinie = ''
      while (!primaLinie.includes('\n')) {
        const { value, done } = await cititor.read()
        if (done) break
        primaLinie += new TextDecoder().decode(value)
      }
      eq(primaLinie.trim(), 'obtinut')
      const info = await Deno.stat(`${root}/verif_93.lock`)
      const directoare = (await copii(root)).map(e => e.name).sort()
      const probeaza = async (asteptat: string) => {
        const p = porneste('probeaza'); procese.push(p)
        await p.stdin.close()
        const rezultat = await p.output()
        eq(rezultat.code, 0, new TextDecoder().decode(rezultat.stderr))
        eq(new TextDecoder().decode(rezultat.stdout).trim().replace(/\r/g, ''), asteptat)
      }
      await probeaza('refuzat')
      eq((await copii(root)).map(e => e.name).sort(), directoare)
      eq((await Deno.stat(`${root}/verif_93.lock`)).mtime, info.mtime)
      if (oprire === 'kill') omoara(primul)
      else { const w = primul.stdin.getWriter(); await w.write(new Uint8Array([1])); w.releaseLock() }
      await primul.stdin.close()
      const rezultat = await primul.status
      eq(rezultat.success, oprire === 'normal')
      await cititor.cancel(); cititor.releaseLock(); cititor = undefined
      await primul.stderr.cancel()
      // Kernelul eliberează lock-ul și la kill; fișierul rămâne același, fără preluare după mtime.
      await probeaza('obtinut\neliberat')
      eq((await Deno.stat(`${root}/verif_93.lock`)).mtime, info.mtime)
      eq(await Deno.readTextFile(lockPath), 'fișier permanent')
    } finally {
      clearTimeout(watchdog)
      procese.forEach(omoara)
      await Promise.all(procese.map(p => p.status))
      if (cititor) { await cititor.cancel(); cititor.releaseLock() }
      for (const p of procese) {
        await p.stdin.close().catch(() => {})
        await p.stdout.cancel().catch(() => {})
        await p.stderr.cancel().catch(() => {})
      }
      await Deno.remove(root, { recursive: true })
    }
  },
})

// -- #13 (audit Jakarinos 07.10): verificarea nu mai distruge dovada sha a importului ('urcat') -------------------------
Deno.test('manifest #13: dovada „urcat” confirmată de Storage rămâne „urcat”; contrazisă → invalidată cu motiv; fără dovadă → ca înainte', async () => {
  const dovezi = [
    { arhiva_cheie: 'a1.pdf', cale: 'a1.pdf', document_id: 11, sha256: await sha('alpha'), stare: 'urcat' },   // Storage 93/a = alpha → confirmată
    { arhiva_cheie: 'c.pdf', cale: 'c.pdf', document_id: 13, sha256: await sha('gamma'), stare: 'urcat' },     // Storage 93/c = ALTFEL → contrazisă
  ]
  const { raport, scrieri } = await scenariu({ dovezi })
  eq([raport.identice, raport.diferite, raport.lipsa_in_platforma, raport.erori], [2, 1, 1, []])
  const pe = Object.fromEntries(scrieri.map(r => [r.cale, [r.stare, r.document_id, r.motiv ? r.motiv.slice(0, 18) : null]]))
  eq(pe['a1.pdf'], ['urcat', 11, null], 'dovada confirmată se păstrează')
  eq(pe['b.pdf'], ['deja_in_platforma', 12, null], 'fără dovadă: comportamentul de dinainte')
  eq(pe['c.pdf'], ['deja_in_platforma', 13, 'DIFERIT de Storage'], 'dovada contrazisă se invalidează explicit')
})

Deno.test('manifest #13: Storage indisponibil → rândul „urcat” rămâne neatins (nu se scrie peste el)', async () => {
  const dovezi = [{ arhiva_cheie: 'a1.pdf', cale: 'a1.pdf', document_id: 11, sha256: await sha('alpha'), stare: 'urcat' }]
  const { scrieri, raport } = await scenariu({ dovezi, statusStorage: 503 })
  eq(scrieri.map(r => r.cale).sort(), ['b.pdf', 'c.pdf', 'lipsa.pdf'], 'a1.pdf (cu dovadă) nu e rescris')
  assert(raport.erori.some(e => /a1\.pdf: Storage indisponibil: HTTP 503/.test(e)), raport.erori.join(' | '))
})

Deno.test('manifest (Jakarinos r2 pe #651): legătura „deja_in_platforma” a importului alege documentul verificat, dar nu devine „urcat”', async () => {
  const dovezi = [
    { arhiva_cheie: 'b.pdf', cale: 'b.pdf', document_id: 12, sha256: await sha('beta'), stare: 'deja_in_platforma' },   // confirmată de Storage
    { arhiva_cheie: 'c.pdf', cale: 'c.pdf', document_id: 11, sha256: await sha('gamma'), stare: 'deja_in_platforma' },  // legată de 11, nu de „c.pdf” (13)
  ]
  const { scrieri } = await scenariu({ dovezi })
  const pe = Object.fromEntries(scrieri.map(r => [r.cale, [r.stare, r.document_id, r.motiv ? r.motiv.slice(0, 18) : null]]))
  eq(pe['b.pdf'], ['deja_in_platforma', 12, null], 'legătura confirmată rămâne „deja”, nu se promovează la „urcat”')
  eq(pe['c.pdf'], ['deja_in_platforma', 11, 'DIFERIT de Storage'], 'documentul verificat e cel din legătură (11), nu cel găsit după nume (13)')
})

Deno.test('manifest (Copilot NO-GO r1 pe #651): dovada „urcat” de după primul plafon de rânduri (pagina a doua) rămâne „urcat”', async () => {
  const umplutura = Array.from({ length: 1000 }, (_, i) => ({ arhiva_cheie: 'alta.zip', cale: `f${i}.pdf`, document_id: 14, sha256: 'x'.repeat(64), stare: 'deja_in_platforma' }))
  const dovezi = [...umplutura, { arhiva_cheie: 'a1.pdf', cale: 'a1.pdf', document_id: 11, sha256: await sha('alpha'), stare: 'urcat' }]
  const { scrieri } = await scenariu({ dovezi })
  const pe = Object.fromEntries(scrieri.map(r => [r.cale, [r.stare, r.document_id]]))
  eq(pe['a1.pdf'], ['urcat', 11], 'citită de pe pagina a doua, dovada confirmată se păstrează (nu se degradează la „deja”)')
})

Deno.test('manifest #13: dovezile existente necitibile → nu se scrie nimic, eroare în raport', async () => {
  const { scrieri, raport } = await scenariu({ eroareDovezi: true })
  eq(scrieri, [])
  eq(raport.manifest_scrise, 0)
  assert(raport.erori.some(e => /dovezile existente nu s-au putut citi/.test(e)), raport.erori.join(' | '))
})

Deno.test('manifest (PR-2, Jakarinos r16): un document FĂRĂ cod numit literal „N (CN1-00002).pdf” nu e fratele lui /2 — /2 lipsă raportat, dovada lui neatinsă', async () => {
  const docsBd = [{ id: 21, nume_original: 'N.pdf', fisier_path: '93/a', size_bytes: 5, seap_cod: 'CN1/00001' },
    { id: 23, nume_original: 'N (CN1-00002).pdf', fisier_path: '93/b', size_bytes: 4, seap_cod: null }]
  const dovezi = [{ arhiva_cheie: 'n.pdf', cale: 'N.pdf', document_id: 21, sha256: await sha('alpha'), stare: 'urcat' },
    { arhiva_cheie: 'n (cn1-00002).pdf', cale: 'N (CN1-00002).pdf', document_id: 23, sha256: await sha('beta'), stare: 'urcat' }]
  const { raport, scrieri } = await scenariu({ docsBd, dovezi, seapLista: [{ nume: 'N.pdf', cod: 'CN1/00001', text: 'alpha' },
    { nume: 'N.pdf', cod: 'CN1/00002', text: 'omega' }, { nume: 'N (CN1-00002).pdf', text: 'beta' }] })
  for (const w of scrieri.filter(x => x.arhiva_cheie === 'n (cn1-00002).pdf'))
    eq([w.document_id, w.sha256, w.stare], [23, await sha('beta'), 'urcat'], 'dovada documentului fără cod neatinsă')
  eq(raport.lipsa_in_platforma, 1, '/2 lipsă raportat')
  assert(raport.erori.some((e: string) => /CN1\/00002.*e a altui document/.test(e)), JSON.stringify(raport.erori))
})

Deno.test('manifest (PR-2, Copilot r11): un rând ISTORIC fără cod „N (CN1-00002).pdf” (document nelistat azi) nu e /2 doar după nume — /2 lipsă, dovada rândului neatinsă', async () => {
  const docsBd = [{ id: 21, nume_original: 'N.pdf', fisier_path: '93/a', size_bytes: 5, seap_cod: 'CN1/00001' },
    { id: 23, nume_original: 'N (CN1-00002).pdf', fisier_path: '93/b', size_bytes: 4, seap_cod: null }]
  const dovezi = [{ arhiva_cheie: 'n.pdf', cale: 'N.pdf', document_id: 21, sha256: await sha('alpha'), stare: 'urcat' },
    { arhiva_cheie: 'n (cn1-00002).pdf', cale: 'N (CN1-00002).pdf', document_id: 23, sha256: await sha('beta'), stare: 'urcat' }]
  const { raport, scrieri } = await scenariu({ docsBd, dovezi, seapLista: [{ nume: 'N.pdf', cod: 'CN1/00001', text: 'alpha' }, { nume: 'N.pdf', cod: 'CN1/00002', text: 'omega' }] })
  eq(scrieri.filter(x => x.arhiva_cheie === 'n (cn1-00002).pdf'), [], 'nimic scris peste dovada rândului istoric')
  eq(raport.lipsa_in_platforma, 1, '/2 lipsă raportat')
})

Deno.test('manifest (PR-2, Jakarinos r17): cheie ocupată — un candidat necitit urmat de unul identic NU scrie peste dovada ocupantului', async () => {
  const docsBd = [{ id: 25, nume_original: 'N.pdf', fisier_path: '93/503', size_bytes: 5, seap_cod: null },
    { id: 23, nume_original: 'N (CN1-00002).pdf', fisier_path: '93/b', size_bytes: 4, seap_cod: null },
    { id: 24, nume_original: 'N (CN1-00007).pdf', fisier_path: '93/a', size_bytes: 5, seap_cod: null }]
  const dovezi = [{ arhiva_cheie: 'n (cn1-00002).pdf', cale: 'N (CN1-00002).pdf', document_id: 23, sha256: await sha('beta'), stare: 'urcat' }]
  const { raport, scrieri } = await scenariu({ docsBd, dovezi, seapLista: [{ nume: 'N.pdf', cod: 'CN1/00002', text: 'alpha' }, { nume: 'N (CN1-00002).pdf', text: 'beta' }] })
  for (const w of scrieri.filter(x => x.arhiva_cheie === 'n (cn1-00002).pdf'))
    eq([w.document_id, w.sha256, w.stare], [23, await sha('beta'), 'urcat'], 'dovada ocupantului neatinsă')
  assert(raport.erori.some((e: string) => /CN1\/00002.*e a altui document/.test(e)), JSON.stringify(raport.erori))
})

for (const ordine of ['/1,/2', '/2,/1']) Deno.test(`manifest (PR-2, Jakarinos r18): rândul cu cod /2 nu ia cheia alternativă „N (CN1-00002).pdf” când e a unui rând istoric fără cod (${ordine})`, async () => {
  const docsBd = [{ id: 21, nume_original: 'N.pdf', fisier_path: '93/a', size_bytes: 5, seap_cod: 'CN1/00001' },
    { id: 22, nume_original: 'N.pdf', fisier_path: '93/b', size_bytes: 4, seap_cod: 'CN1/00002' },
    { id: 23, nume_original: 'N (CN1-00002).pdf', fisier_path: '93/c', size_bytes: 6, seap_cod: null }]
  const dovezi = [{ arhiva_cheie: 'n.pdf', cale: 'N.pdf', document_id: 21, sha256: await sha('alpha'), stare: 'urcat' },
    { arhiva_cheie: 'n (cn1-00002).pdf', cale: 'N (CN1-00002).pdf', document_id: 23, sha256: await sha('ALTFEL'), stare: 'urcat' }]
  const d1 = { nume: 'N.pdf', cod: 'CN1/00001', text: 'alpha' }, d2 = { nume: 'N.pdf', cod: 'CN1/00002', text: 'beta' }
  const { raport, scrieri } = await scenariu({ docsBd, dovezi, seapLista: ordine === '/2,/1' ? [d2, d1] : [d1, d2] })
  eq(scrieri.filter(x => x.arhiva_cheie === 'n (cn1-00002).pdf'), [], 'dovada rândului istoric neatinsă')
  const r1 = scrieri.find(x => x.document_id === 21)
  eq([r1?.arhiva_cheie, r1?.stare], ['n.pdf', 'urcat'], 'dovada lui /1 confirmată')
  assert(raport.erori.some((e: string) => /CN1\/00002.*e a altui document/.test(e)), JSON.stringify(raport.erori))
})
