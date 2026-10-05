// Teste pentru despachetarea arhivelor ajunse în platformă (seap.ts → despacheteazaArhiveDinPlatforma, 05.10.2026).
// Supabase simulat în memorie + un extractor simulat care respectă protocolul pe fișiere al extractorului izolat
// (listare „7z l -slt” → rasp/listare.*, extragere → out/ + rasp/rezultat), cu `unzip` în loc de 7zz.
// Rulare: deno test -A --node-modules-dir=none worker/ofertare/arhive_platforma_test.ts
const eq = (a: unknown, b: unknown, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n  primit:   ${JSON.stringify(a)}\n  așteptat: ${JSON.stringify(b)}`) }
const ok = (c: unknown, m: string) => { if (!c) throw new Error(m) }

type Rand = Record<string, any>
function fakeSupa(tabele: Record<string, Rand[]>, fisiere: Map<string, Uint8Array>) {
  let nextId = 5000
  const potriveste = (r: Rand, f: ((r: Rand) => boolean)[]) => f.every(x => x(r))
  function builder(tabel: string) {
    const filtre: ((r: Rand) => boolean)[] = []
    let op: 'select' | 'update' | 'insert' = 'select', patch: Rand | Rand[] = {}, limita = Infinity, sel = false
    const b: any = {
      select() { sel = true; return b },
      update(p: Rand) { op = 'update'; patch = p; return b },
      insert(p: Rand | Rand[]) { op = 'insert'; patch = p; return b },
      eq(c: string, v: unknown) { filtre.push(r => r[c] === v); return b },
      in(c: string, v: unknown[]) { filtre.push(r => v.includes(r[c])); return b },
      ilike(c: string, p: string) { const re = new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i'); filtre.push(r => re.test(r[c] ?? '')); return b },
      or(expr: string) {
        const alt = expr.split(',').map(t => { const [c, , p] = t.split('.ilike.').length === 2 ? [t.split('.ilike.')[0], 'ilike', t.split('.ilike.')[1]] : ['', '', '']; return { c, re: new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i') } })
        filtre.push(r => alt.some(a => a.re.test(r[a.c] ?? ''))); return b
      },
      order() { return b },
      limit(n: number) { limita = n; return b },
      maybeSingle() { return b.then((x: any) => ({ data: x.data?.[0] ?? null, error: x.error })) },
      single() { return b.then((x: any) => ({ data: x.data?.[0] ?? null, error: x.data?.length ? null : { message: 'niciun rând' } })) },
      then(res: any, rej: any) {
        const t = tabele[tabel] ??= []
        let data: Rand[] = []
        if (op === 'select') data = t.filter(r => potriveste(r, filtre)).slice(0, limita)
        else if (op === 'update') { data = t.filter(r => potriveste(r, filtre)); data.forEach(r => Object.assign(r, patch)) }
        else { const noi = (Array.isArray(patch) ? patch : [patch]).map(p => ({ id: nextId++, ...p })); t.push(...noi); data = noi }
        return Promise.resolve({ data: op === 'select' || sel ? data.map(r => ({ ...r })) : null, error: null }).then(res, rej)
      },
    }
    return b
  }
  return {
    from: builder,
    storage: { from: () => ({
      download: async (p: string) => fisiere.has(p) ? { data: new Blob([fisiere.get(p)! as unknown as BlobPart]), error: null } : { data: null, error: { message: 'Object not found' } },
      upload: async (p: string, buf: Uint8Array) => { fisiere.set(p, buf); return { error: null } },
      remove: async (ps: string[]) => { ps.forEach(p => fisiere.delete(p)); return { error: null } },
    }) },
  }
}

// extractorul simulat: listare în formatul 7z -slt (din `unzip -Z -l`), extragere cu `unzip`; `cale_rea` = listare otrăvită
function pornesteExtractor(root: string, opt: { cale_rea?: boolean } = {}) {
  let viu = true
  const bucla = (async () => {
    while (viu) {
      for await (const job of Deno.readDir(root)) {
        if (!job.isDirectory) continue
        for await (const sub of Deno.readDir(`${root}/${job.name}`)) {
          const dir = `${root}/${job.name}/${sub.name}`
          let cerere = ''
          try { cerere = (await Deno.readTextFile(`${dir}/cerere`)).trim() } catch { continue }
          const prima = (await Deno.readTextFile(`${dir}/prima`)).trim()
          if (cerere === 'l' && !(await Deno.stat(`${dir}/rasp/listare.gata`).catch(() => null))) {
            const o = await new Deno.Command('unzip', { args: ['-Z', '-l', `${dir}/in/${prima}`], stdout: 'piped' }).output()
            const linii = new TextDecoder().decode(o.stdout).split('\n').filter(l => /^[-d]r/.test(l))
            const blocuri = linii.filter(l => l.startsWith('-')).map(l => { const p = l.trim().split(/\s+/); return `Path = ${p.slice(9).join(' ')}\nSize = ${p[3]}\nAttributes = A -rw-r--r--` })
            if (opt.cale_rea) blocuri.push('Path = ../../etc/evil\nSize = 1\nAttributes = A -rw-r--r--')
            await Deno.writeTextFile(`${dir}/rasp/listare.txt`, `Path = ${prima}\nType = zip\n\n` + blocuri.join('\n\n') + '\n')
            await Deno.writeTextFile(`${dir}/rasp/listare.cod`, '0')
            await Deno.writeTextFile(`${dir}/rasp/listare.gata`, '')
          }
          if (cerere === 'x' && !(await Deno.stat(`${dir}/rasp/rezultat`).catch(() => null))) {
            const o = await new Deno.Command('unzip', { args: ['-q', '-o', `${dir}/in/${prima}`, '-d', `${dir}/out`] }).output()
            await Deno.writeTextFile(`${dir}/rasp/rezultat`, `${o.code}\n`)
          }
        }
      }
      await new Promise(r => setTimeout(r, 100))
    }
  })()
  return async () => { viu = false; await bucla.catch(() => {}) }
}

async function zipCu(fisiere: Record<string, string>): Promise<Uint8Array> {
  const d = await Deno.makeTempDir()
  for (const [n, c] of Object.entries(fisiere)) { await Deno.mkdir(`${d}/${n}`.replace(/\/[^/]+$/, ''), { recursive: true }); await Deno.writeTextFile(`${d}/${n}`, c) }
  const o = await new Deno.Command('zip', { args: ['-q', '-r', `${d}/a.zip`, ...Object.keys(fisiere)], cwd: d }).output()
  ok(o.code === 0, 'zip a eșuat')
  const buf = await Deno.readFile(`${d}/a.zip`)
  await Deno.remove(d, { recursive: true })
  return buf
}

async function cuMediu(fn: (root: string, seap: any) => Promise<void>) {
  const root = await Deno.makeTempDir()
  const vechi = Deno.env.get('SEAP_LUCRU')
  Deno.env.set('SEAP_LUCRU', root)
  try {
    const seap = await import(new URL(`./seap.ts?arhive=${crypto.randomUUID()}`, import.meta.url).href)
    await fn(root, seap)
  } finally {
    if (vechi === undefined) Deno.env.delete('SEAP_LUCRU'); else Deno.env.set('SEAP_LUCRU', vechi)
    await Deno.remove(root, { recursive: true }).catch(() => {})
  }
}

Deno.test('arhive: selecție, prefix și grupare', async () => {
  await cuMediu(async (_root, s) => {
    ok(s.eArhivaDeDespachetat({ nume_original: 'DOC_F1.rar', fisier_path: '3/x.rar', status_procesare: 'neprocesat', eroare: null }), 'rar neprocesat → da')
    ok(s.eArhivaDeDespachetat({ nume_original: 'A.zip.p7s', fisier_path: '3/x', status_procesare: 'ignorat', eroare: 'doar PDF se proceseaza in M1' }), 'zip.p7s ignorat de ingest → da')
    ok(!s.eArhivaDeDespachetat({ nume_original: 'DOC.rar', fisier_path: '3/x', status_procesare: 'ignorat', eroare: '📦 Arhivă despachetată pe Terra: 3' }), 'deja despachetată → nu')
    ok(!s.eArhivaDeDespachetat({ nume_original: 'DOC.rar', fisier_path: '3/x', status_procesare: 'eroare', eroare: 'Despachetare RESPINSĂ de controale' }), 'respinsă → nu (fără buclă)')
    ok(!s.eArhivaDeDespachetat({ nume_original: 'DOC.rar', fisier_path: '3/neincarcat/x', status_procesare: 'neprocesat', eroare: null }), 'placeholder → nu')
    ok(!s.eArhivaDeDespachetat({ nume_original: 'Plansa.pdf', fisier_path: '3/x', status_procesare: 'neprocesat', eroare: null }), 'pdf → nu')
    eq(s.prefixArhiva('DOC_F1_F6_C1_C9.rar'), 'DOC_F1_F6_C1_C9')
    eq(s.prefixArhiva('PT Botosani.part03.rar.p7s'), 'PT Botosani')
    const g = s.grupeazaArhive([
      { id: 1, licitatie_id: 3, nume_original: 'X.part1.rar' }, { id: 2, licitatie_id: 3, nume_original: 'X.part2.rar' },
      { id: 3, licitatie_id: 3, nume_original: 'Y.zip' }, { id: 4, licitatie_id: 9, nume_original: 'X.part1.rar' },
    ])
    eq(g.map((x: any[]) => x.map(d => d.id)), [[1, 2], [3], [4]], 'volumele aceleiași licitații împreună')
  })
})

Deno.test('arhive: zip din veghe → documente separate cu prefix, arhiva marcată, fără dubluri la reluare', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    try {
      const fisiere = new Map<string, Uint8Array>()
      fisiere.set('3/atribuire/raspunsuri/CN_00058_DOC.zip', await zipCu({ 'F3_lista_1.pdf': '%PDF-1.4 a', 'C5_lista_cantitati_1.pdf': '%PDF-1.4 b', 'sub/Anexa.docx': 'x', '__MACOSX/._F3_lista_1.pdf': 'junk' }))
      const tab: Record<string, Rand[]> = {
        ofertare_documente_atribuire: [
          { id: 1305, licitatie_id: 3, nume_original: 'DOC_F1_F6_C1_C9.zip', fisier_path: '3/atribuire/raspunsuri/CN_00058_DOC.zip', status_procesare: 'neprocesat', eroare: null, tip: 'raspuns_clarificare', seap_cod: 'CN1095546/00058', aparut_ulterior: true },
          { id: 10, licitatie_id: 3, nume_original: 'F3_lista_1.pdf', fisier_path: '3/atribuire/vechi.pdf', status_procesare: 'procesat', eroare: null },
        ],
        ofertare_licitatii: [{ id: 3, responsabil_id: 'u-1', nr_anunt: 'DF1278266' }],
        notifications: [],
      }
      const supa = fakeSupa(tab, fisiere)
      await s.despacheteazaArhiveDinPlatforma(supa, () => {})
      const docs = tab.ofertare_documente_atribuire
      const arh = docs.find(d => d.id === 1305)!
      eq(arh.status_procesare, 'ignorat', 'arhiva rămâne ca fișier, ignorată la citire')
      ok(arh.eroare.startsWith('📦 Arhivă despachetată pe Terra: 3 fișiere noi'), `nota arhivei: ${arh.eroare}`)
      const noi = docs.filter(d => String(d.nume_original).startsWith('DOC_F1_F6_C1_C9/')).sort((a, b) => a.nume_original.localeCompare(b.nume_original))
      eq(noi.map(d => d.nume_original), ['DOC_F1_F6_C1_C9/C5_lista_cantitati_1.pdf', 'DOC_F1_F6_C1_C9/F3_lista_1.pdf', 'DOC_F1_F6_C1_C9/sub/Anexa.docx'], 'fără junk, cu prefix — F3 NU e confundat cu originalul id 10')
      eq(noi.map(d => [d.tip, d.status_procesare, d.seap_cod, d.aparut_ulterior, d.sursa]), [
        ['lista_cantitati', 'neprocesat', 'CN1095546/00058', true, 'seap'],
        ['lista_cantitati', 'neprocesat', 'CN1095546/00058', true, 'seap'],
        ['raspuns_clarificare', 'ignorat', 'CN1095546/00058', true, 'seap'],
      ], 'tip după numele propriu (altfel al arhivei), PDF-urile de citit, docx rămâne fișier')
      ok(noi.every(d => fisiere.has(d.fisier_path)), 'fiecare document are fișierul în Storage')
      eq(tab.notifications.length, 1, 'responsabilul licitației e anunțat')
      eq(docs.find(d => d.id === 10)!.status_procesare, 'procesat', 'originalul neatins')
      // reluarea: arhiva nu mai e selectată, nimic nou
      const inainte = docs.length
      await s.despacheteazaArhiveDinPlatforma(supa, () => {})
      eq(docs.length, inainte, 'fără dubluri la a doua tură')
      // un om resetează arhiva (neprocesat, fără notă) → reluarea nu dublează documentele deja extrase
      Object.assign(arh, { status_procesare: 'neprocesat', eroare: null })
      await s.despacheteazaArhiveDinPlatforma(supa, () => {})
      eq(docs.length, inainte, 'reluare manuală: tot fără dubluri')
      ok(arh.eroare.includes('3 existau deja'), `nota la reluare: ${arh.eroare}`)
    } finally { await opreste() }
  })
})

Deno.test('arhive: listare cu cale nesigură → RESPINSĂ, nimic urcat, nu se reia', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root, { cale_rea: true })
    try {
      const fisiere = new Map<string, Uint8Array>([['3/a.zip', await zipCu({ 'a.pdf': '%PDF-1.4' })]])
      const tab: Record<string, Rand[]> = { ofertare_documente_atribuire: [{ id: 1, licitatie_id: 3, nume_original: 'a.zip', fisier_path: '3/a.zip', status_procesare: 'neprocesat', eroare: null }], ofertare_licitatii: [], notifications: [] }
      await s.despacheteazaArhiveDinPlatforma(fakeSupa(tab, fisiere), () => {})
      const d = tab.ofertare_documente_atribuire
      eq(d.length, 1, 'nimic urcat')
      eq(d[0].status_procesare, 'eroare')
      ok(/^Despachetare RESPINSĂ de controalele de siguranță: cale nesigură/.test(d[0].eroare), d[0].eroare)
      ok(!s.eArhivaDeDespachetat(d[0]), 'nu mai e selectată (fără buclă)')
    } finally { await opreste() }
  })
})

Deno.test('arhive: fișier lipsă în Storage → eroare vizibilă, nu se reia singur', async () => {
  await cuMediu(async (_root, s) => {
    const tab: Record<string, Rand[]> = { ofertare_documente_atribuire: [{ id: 1, licitatie_id: 3, nume_original: 'a.zip', fisier_path: '3/lipsa.zip', status_procesare: 'neprocesat', eroare: null }], ofertare_licitatii: [], notifications: [] }
    await s.despacheteazaArhiveDinPlatforma(fakeSupa(tab, new Map()), () => {})
    eq(tab.ofertare_documente_atribuire[0].status_procesare, 'eroare')
    ok(/^Despachetare eșuată \(descărcare din Storage/.test(tab.ofertare_documente_atribuire[0].eroare), tab.ofertare_documente_atribuire[0].eroare)
  })
})
