// Linux (worker): deno test --node-modules-dir=none --allow-net --allow-env
// --allow-read=/app,/deno-dir,/tmp,/packs,/seap-work --allow-write=/deno-dir,/tmp,/packs,/seap-work
// --allow-run=git,pdftotext,pdfinfo /app/worker/ofertare/verifica_manifest_test.ts
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
type Opt = {
  ctl?: AbortController; stopDupaPrimul?: boolean; blocat?: 'lista' | 'document' | 'storage' | 'flux'
  arhiva?: boolean; blocatExtractor?: 'listare' | 'extragere'; uscat?: boolean; periodica?: boolean
  signedUrl?: string; eroareSemnare?: boolean; statusStorage?: number
  inainte?: (root: string, supa: Parameters<typeof verificaManifest>[0]) => Promise<void>
  laStorage?: (root: string, supa: Parameters<typeof verificaManifest>[0]) => Promise<void>
}

async function scenariu(opt: Opt = {}) {
  const root = await Deno.makeTempDir({ dir: Deno.env.get('SEAP_TEST_ROOT') ?? (Deno.build.os === 'windows' ? Deno.cwd() : '/tmp'), prefix: '.verifica-manifest-test-' })
  const vechiLucru = Deno.env.get('SEAP_LUCRU'), fetchVechi = globalThis.fetch
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
  const supa = {
    from(t: string) {
      if (t === 'ofertare_seap_cereri' && opt.periodica) return {
        upsert: async () => ({ error: null }),
        select: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }),
      }
      if (t === 'ofertare_seap_manifest') return {
        select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
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
          : raspuns(documente)
      } }) }
    },
    storage: { from(bucket: string) {
      eq(bucket, 'ofertare')
      return { async createSignedUrl(path: string, expires: number) {
        eq(expires, 300)
        if (opt.eroareSemnare) return { data: null, error: { message: 'semnare refuzată' } }
        return { data: { signedUrl: opt.signedUrl ?? `https://storage.invalid/${path}` }, error: null }
      } }
    } },
  } as unknown as Parameters<typeof verificaManifest>[0] & Parameters<typeof proceseazaSeap>[0]
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url === opt.signedUrl) return fetchVechi(input, init) // integrare: fetch HTTP real, inclusiv AbortSignal
    if (url.startsWith('https://storage.invalid/')) {
      assert(init?.signal)
      if (opt.blocat === 'storage') return await blocheaza(init.signal)
      storage++
      if (storage === 1) await opt.laStorage?.(root, supa)
      const path = new URL(url).pathname.slice(1)
      const text = ({ '93/a': 'alpha', '93/b': 'beta', '93/c': 'ALTFEL' } as Record<string, string>)[path]
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
      const nume = opt.arhiva ? ['set.zip'] : Object.keys(surse)
      return Response.json({ dfNoticeDocs: nume.map(n => ({ noticeDocumentName: n, noticeDocumentUrl: `https://seap.invalid/${n}` })) })
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
    return new Response(opt.arhiva ? 'zip simulat' : surse[nume])
  }
  try {
    await opt.inainte?.(root, supa)
    const raport = await verificaManifest(supa, 93, { uscat: opt.uscat, semnal: opt.ctl?.signal })
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
    eq(await copii(root), [], 'joburile temporare trebuie curățate')
    return { raport, scrieri, descarcate, fluxAnulat }
  } finally {
    clearTimeout(timer)
    globalThis.fetch = fetchVechi
    if (vechiLucru === undefined) Deno.env.delete('SEAP_LUCRU'); else Deno.env.set('SEAP_LUCRU', vechiLucru)
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

Deno.test('manifest r2: lock recent refuzat și păstrat; după eliberare se poate relua', async () => {
  await scenariu({ inainte: async (root, supa) => {
    const path = `${root}/verif_93.lock`
    await Deno.writeTextFile(path, 'altă rulare')
    await rejects(() => verificaManifest(supa, 93), /verificare deja în curs pentru 93/)
    eq(await Deno.readTextFile(path), 'altă rulare')
    eq((await copii(root)).map(e => e.name), ['verif_93.lock'])
    await Deno.remove(path)
  } })
})

Deno.test('manifest r2: lock mai vechi de 2 h preluat cu log explicit', async () => {
  const logs: string[] = [], logVechi = console.log
  console.log = (...args: unknown[]) => logs.push(args.join(' '))
  try {
    const { raport } = await scenariu({ inainte: async root => {
      const path = `${root}/verif_93.lock`, vechi = new Date(Date.now() - 121 * 60_000)
      await Deno.writeTextFile(path, '')
      await Deno.utime(path, vechi, vechi)
    } })
    eq(raport.erori, [])
    eq(raport.manifest_scrise, 4)
    assert(logs.some(l => l.includes('#93') && l.includes('preiau lock') && l.includes('2 h')))
  } finally { console.log = logVechi }
})

Deno.test('manifest r2: eroarea eliberează lock-ul și directorul propriu, păstrează directoarele străine', async () => {
  await scenariu({ inainte: async (root, supa) => {
    const strain = `${root}/verif_93_rulare_veche`
    await Deno.mkdir(strain)
    await Deno.writeTextFile(`${strain}/dovada`, 'păstrează')
    const defect = { from() { throw new Error('eroare simulată înainte de SEAP') } } as unknown as typeof supa
    await rejects(() => verificaManifest(defect, 93), /eroare simulată înainte de SEAP/)
    eq((await copii(root)).map(e => e.name), ['verif_93_rulare_veche'])
    eq(await Deno.readTextFile(`${strain}/dovada`), 'păstrează')
    await Deno.remove(strain, { recursive: true })
  } }) // O nouă verificare reușită dovedește și eliberarea protecției din proces.
})

for (const tip of ['semnare', 'HTTP'] as const) Deno.test(`manifest r2: eroare Storage ${tip} explicită`, async () => {
  const { raport, scrieri } = await scenariu(tip === 'semnare' ? { eroareSemnare: true } : { statusStorage: 503 })
  eq([raport.identice, raport.diferite, raport.erori.length], [0, 0, 3])
  assert(raport.erori.every(e => e.includes(tip === 'semnare' ? 'semnare refuzată' : 'HTTP 503')))
  assert(scrieri.filter(r => r.document_id !== null).every(r => r.motiv.startsWith('Storage indisponibil:')))
})

Deno.test('manifest r2: fetch Storage real blocat, plafon 300 ms, revine în sub 2 s', async () => {
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
    const { raport, scrieri } = await scenariu({ ctl, signedUrl: `http://127.0.0.1:${server.addr.port}/blocat` })
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
