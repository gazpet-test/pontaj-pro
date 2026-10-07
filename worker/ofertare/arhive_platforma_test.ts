// Teste pentru despachetarea arhivelor ajunse în platformă (seap.ts → despacheteazaArhiveDinPlatforma, 05.10.2026).
// Supabase simulat în memorie + un extractor simulat care respectă protocolul pe fișiere al extractorului izolat
// (listare „7z l -slt” → rasp/listare.*, extragere → out/ + rasp/rezultat), cu `unzip` în loc de 7zz.
// Rulare: deno test -A --node-modules-dir=none worker/ofertare/arhive_platforma_test.ts
const eq = (a: unknown, b: unknown, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n  primit:   ${JSON.stringify(a)}\n  așteptat: ${JSON.stringify(b)}`) }
const ok = (c: unknown, m: string) => { if (!c) throw new Error(m) }

type Rand = Record<string, any>
// mini-interpretor pentru filtrele PostgREST folosite de worker: or(...), and(...), col.ilike.pat, col.not.ilike.pat, col.is.null
// (NULL se comportă ca în SQL: „not ilike” pe NULL nu trece)
function imparte(expr: string): string[] {
  const out: string[] = []; let adanc = 0, cur = ''
  for (const ch of expr) { if (ch === '(') adanc++; if (ch === ')') adanc--; if (ch === ',' && adanc === 0) { out.push(cur); cur = '' } else cur += ch }
  if (cur) out.push(cur)
  return out
}
const reLike = (p: string) => new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'is')
function parseazaTermen(t: string): (r: Rand) => boolean {
  if (t.startsWith('and(')) { const fs = imparte(t.slice(4, -1)).map(parseazaTermen); return r => fs.every(f => f(r)) }
  if (t.startsWith('or(')) return parseazaOr(t.slice(3, -1))
  let m = t.match(/^([a-z_]+)\.is\.null$/); if (m) { const c = m[1]; return r => r[c] == null }
  m = t.match(/^([a-z_]+)\.not\.ilike\.(.*)$/s); if (m) { const c = m[1], re = reLike(m[2]); return r => r[c] != null && !re.test(r[c]) }
  m = t.match(/^([a-z_]+)\.ilike\.(.*)$/s); if (m) { const c = m[1], re = reLike(m[2]); return r => r[c] != null && re.test(r[c]) }
  throw new Error('filtru necunoscut în fake: ' + t)
}
function parseazaOr(expr: string): (r: Rand) => boolean { const fs = imparte(expr).map(parseazaTermen); return r => fs.some(f => f(r)) }
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
      is(c: string, v: unknown) { filtre.push(r => (v === null ? r[c] == null : r[c] === v)); return b },
      not(c: string, o: string, v: unknown) {   // semantica SQL: NULL nu trece niciun NOT
        if (o === 'is' && v === null) filtre.push(r => r[c] != null)
        else if (o === 'like') { const re = new RegExp('^' + String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'); filtre.push(r => r[c] != null && !re.test(r[c])) }
        else throw new Error(`fake: not ${o} neimplementat`)
        return b
      },
      ilike(c: string, p: string) { const re = new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i'); filtre.push(r => re.test(r[c] ?? '')); return b },
      or(expr: string) { const f = parseazaOr(expr); filtre.push(r => f(r)); return b },
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
        // indexul unic live ofertare_doc_seap_cod_unic: (licitatie_id, seap_cod) WHERE seap_cod IS NOT NULL
        if (tabel === 'ofertare_documente_atribuire' && op !== 'select') {
          const vazute = new Set<string>()
          for (const r of t) {
            if (r.seap_cod == null) continue
            const k = `${r.licitatie_id}|${r.seap_cod}`
            if (vazute.has(k)) {
              if (op === 'insert') t.splice(t.length - data.length, data.length)   // insertul e atomic: se anulează
              return Promise.resolve({ data: null, error: { message: 'duplicate key value violates unique constraint "ofertare_doc_seap_cod_unic"' } }).then(res, rej)
            }
            vazute.add(k)
          }
        }
        return Promise.resolve({ data: op === 'select' || sel ? data.map(r => ({ ...r })) : null, error: null }).then(res, rej)
      },
    }
    return b
  }
  return {
    from: builder,
    rpc: async (fn: string, args: Rand) => {   // monitorul de egress: poarta (niciodată blocat aici) + jurnalul
      if (fn === 'egress_log_descarcare') (tabele.egress_jurnal ??= []).push(args)
      return { data: false, error: null }
    },
    storage: { from: () => ({
      download: async (p: string) => fisiere.has(p) ? { data: new Blob([fisiere.get(p)! as unknown as BlobPart]), error: null } : { data: null, error: { message: 'Object not found' } },
      upload: async (p: string, buf: Uint8Array) => { if (p.includes('PICA')) return { error: { message: 'simulat: Storage 500' } }; fisiere.set(p, buf); return { error: null } },
      remove: async (ps: string[]) => { ps.forEach(p => fisiere.delete(p)); return { error: null } },
    }) },
  }
}

// extractorul simulat: listare în formatul 7z -slt (din `unzip -Z -l`), extragere cu `unzip`; `cale_rea` = listare otrăvită
function pornesteExtractor(root: string, opt: { cale_rea?: boolean } = {}) {
  let viu = true
  const bucla = (async () => {
    while (viu) {
      // workerul creează și șterge directoarele de job în paralel cu bucla: orice fișier/director dispărut sau
      // încă nescris (NotFound) = se reia la tura următoare, ca la extractorul real (nu e o eroare de test)
      try { for await (const job of Deno.readDir(root)) {
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
      } } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e }
      await new Promise(r => setTimeout(r, 100))
    }
  })()
  return async () => { viu = false; await bucla.catch(() => {}) }
}

async function zipCu(fisiere: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const d = await Deno.makeTempDir()
  for (const [n, c] of Object.entries(fisiere)) {
    await Deno.mkdir(`${d}/${n}`.replace(/\/[^/]+$/, ''), { recursive: true })
    if (typeof c === 'string') await Deno.writeTextFile(`${d}/${n}`, c); else await Deno.writeFile(`${d}/${n}`, c)   // Uint8Array = arhivă în arhivă
  }
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

Deno.test('arhive: selecție, spațiu de nume, volume', async () => {
  await cuMediu(async (_root, s) => {
    ok(s.eArhivaDeDespachetat({ nume_original: 'DOC_F1.rar', fisier_path: '3/x.rar', status_procesare: 'neprocesat', eroare: null }), 'rar neprocesat → da')
    ok(s.eArhivaDeDespachetat({ nume_original: 'A.zip.p7s', fisier_path: '3/x', status_procesare: 'neprocesat', eroare: null }), 'zip.p7s neprocesat → da')
    ok(!s.eArhivaDeDespachetat({ nume_original: 'PT.zip', fisier_path: '3/x', status_procesare: 'ignorat', eroare: 'non-PDF - ramane ca fisier' }), 'arhivă VECHE (ignorat, non-PDF) → nu se atinge automat')
    ok(!s.eArhivaDeDespachetat({ nume_original: 'PT-semnat.zip', fisier_path: '3/x', status_procesare: 'ignorat', eroare: 'Arhivă adusă pe Terra: 41 fișiere în platformă.' }), 'deja despachetată pe drumul SEAP → nu')
    ok(!s.eArhivaDeDespachetat({ nume_original: 'DOC.rar', fisier_path: '3/x', status_procesare: 'ignorat', eroare: '📦 Arhivă despachetată pe Terra: 3' }), 'deja despachetată → nu')
    ok(!s.eArhivaDeDespachetat({ nume_original: 'DOC.rar', fisier_path: '3/x', status_procesare: 'eroare', eroare: 'Despachetare parțială: 2 urcate, 1 NEURCATE' }), 'parțială → nu (doar reluare manuală)')
    ok(!s.eArhivaDeDespachetat({ nume_original: 'DOC.rar', fisier_path: '3/neincarcat/x', status_procesare: 'neprocesat', eroare: null }), 'placeholder → nu')
    ok(!s.eArhivaDeDespachetat({ nume_original: 'Plansa.pdf', fisier_path: '3/x', status_procesare: 'neprocesat', eroare: null }), 'pdf → nu')
    eq(s.spatiuArhiva({ id: 1305, nume_original: 'DOC_F1_F6_C1_C9.rar' }), 'DOC_F1_F6_C1_C9 (#1305)')
    eq(s.spatiuArhiva({ id: 7, nume_original: 'A/B.zip.p7s' }), 'A_B (#7)')
    ok(s.esteVolumRar('PT.part03.rar.p7s') && !s.esteVolumRar('PT.rar'), 'detectarea volumelor')
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
      const noi = docs.filter(d => String(d.nume_original).startsWith('DOC_F1_F6_C1_C9 (#1305)/')).sort((a, b) => a.nume_original.localeCompare(b.nume_original))
      eq(noi.map(d => d.nume_original), ['DOC_F1_F6_C1_C9 (#1305)/C5_lista_cantitati_1.pdf', 'DOC_F1_F6_C1_C9 (#1305)/F3_lista_1.pdf', 'DOC_F1_F6_C1_C9 (#1305)/sub/Anexa.docx'], 'fără junk, cu prefix — F3 NU e confundat cu originalul id 10')
      eq(noi.map(d => [d.tip, d.status_procesare, d.seap_cod, d.aparut_ulterior, d.sursa]), [
        ['lista_cantitati', 'neprocesat', undefined, true, 'seap'],
        ['lista_cantitati', 'neprocesat', undefined, true, 'seap'],
        ['alta', 'ignorat', undefined, true, 'seap'],
      ], 'tip după numele propriu (anexa → alta, NU raspuns_clarificare-ul arhivei — lic. 3, 07.10), PDF-urile de citit, docx rămâne fișier, seap_cod rămâne doar pe arhivă (index unic)')
      eq(arh.seap_cod, 'CN1095546/00058', 'arhiva își păstrează codul SEAP')
      ok(noi.every(d => fisiere.has(d.fisier_path)), 'fiecare document are fișierul în Storage')
      eq(tab.notifications.length, 1, 'responsabilul licitației e anunțat')
      eq(tab.egress_jurnal.map(j => [j.p_bucket, j.p_obiect, j.p_sursa, j.p_doc_id]), [['ofertare', '3/atribuire/raspunsuri/CN_00058_DOC.zip', 'nas:arhive', 1305]], 'descărcarea din Storage e în jurnalul de egress')
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

Deno.test('arhive: două arhive cu același nume nu se amestecă; volumele .partN.rar → manual', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    try {
      const fisiere = new Map<string, Uint8Array>([
        ['3/r1.zip', await zipCu({ 'F3.pdf': '%PDF-1.4 v1' })], ['3/r2.zip', await zipCu({ 'F3.pdf': '%PDF-1.4 v2 modificat' })],
        ['3/v1.rar', new Uint8Array([1, 2, 3])],
      ])
      const tab: Record<string, Rand[]> = { ofertare_documente_atribuire: [
        { id: 20, licitatie_id: 3, nume_original: 'Raspuns.zip', fisier_path: '3/r1.zip', status_procesare: 'neprocesat', eroare: null },
        { id: 21, licitatie_id: 3, nume_original: 'Raspuns.zip', fisier_path: '3/r2.zip', status_procesare: 'neprocesat', eroare: null },
        { id: 22, licitatie_id: 3, nume_original: 'PT.part1.rar', fisier_path: '3/v1.rar', status_procesare: 'neprocesat', eroare: null },
      ], ofertare_licitatii: [], notifications: [] }
      const supa = fakeSupa(tab, fisiere)
      for (let i = 0; i < 4; i++) await s.despacheteazaArhiveDinPlatforma(supa, () => {})
      const d = tab.ofertare_documente_atribuire
      eq(d.filter(x => /\/F3\.pdf$/.test(x.nume_original)).map(x => x.nume_original).sort(), ['Raspuns (#20)/F3.pdf', 'Raspuns (#21)/F3.pdf'], 'a doua arhivă NU e sărită ca „deja existentă”')
      const f3v2 = d.find(x => x.nume_original === 'Raspuns (#21)/F3.pdf')!
      eq(new TextDecoder().decode(fisiere.get(f3v2.fisier_path)), '%PDF-1.4 v2 modificat', 'conținutul celei de-a doua arhive')
      const vol = d.find(x => x.id === 22)!
      ok(/^Despachetare manuală necesară: arhivă în volume/.test(vol.eroare), vol.eroare)
      eq(vol.status_procesare, 'neprocesat', 'volumul nu e atins altfel')
      ok(!s.eArhivaDeDespachetat(vol), 'volumul nu mai e reselectat')
    } finally { await opreste() }
  })
})

Deno.test('arhive: arhivă în arhivă → despachetată pe tura următoare, cu tip propriu (nu raspuns_clarificare moștenit)', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    try {
      const nivel2 = await zipCu({ 'Z.pdf': '%PDF-1.4 z' })
      const nivel1 = await zipCu({ '7. Detaliu montaj.pdf': '%PDF-1.4 d', 'Ceva.pdf': '%PDF-1.4 c', 'adanc.zip': nivel2 })
      const fisiere = new Map<string, Uint8Array>([['3/o.zip', await zipCu({ 'F3_lista.pdf': '%PDF-1.4 f', 'interior.zip': nivel1 })]])
      const tab: Record<string, Rand[]> = { ofertare_documente_atribuire: [
        { id: 40, licitatie_id: 3, nume_original: 'Clarificari.zip', fisier_path: '3/o.zip', status_procesare: 'neprocesat', eroare: null, tip: 'raspuns_clarificare', aparut_ulterior: true },
      ], ofertare_licitatii: [], notifications: [] }
      const supa = fakeSupa(tab, fisiere)
      const d = tab.ofertare_documente_atribuire
      await s.despacheteazaArhiveDinPlatforma(supa, () => {})
      const interior = d.find(x => x.nume_original === 'Clarificari (#40)/interior.zip')!
      ok(interior, 'arhiva interioară e un document')
      eq([interior.status_procesare, interior.eroare, interior.tip], ['neprocesat', null, 'alta'], 'intră la despachetare, fără tipul „clarificare” al mamei')
      ok(s.eArhivaDeDespachetat(interior), 'selectată de bucla de arhive')
      eq(d.find(x => x.nume_original === 'Clarificari (#40)/F3_lista.pdf')!.tip, 'lista_cantitati')
      await s.despacheteazaArhiveDinPlatforma(supa, () => {})   // tura 2: nivelul 1
      ok(/^📦 Arhivă despachetată pe Terra: 3 fișiere noi/.test(interior.eroare), `nota arhivei interioare: ${interior.eroare}`)
      const sp1 = `Clarificari (#40)_interior (#${interior.id})`
      eq(d.filter(x => x.nume_original.startsWith(sp1 + '/')).map(x => [x.nume_original.slice(sp1.length + 1), x.tip, x.status_procesare]).sort(), [
        ['7. Detaliu montaj.pdf', 'plansa', 'neprocesat'], ['Ceva.pdf', 'alta', 'neprocesat'], ['adanc.zip', 'alta', 'neprocesat'],
      ], 'planșa după nume; fără regulă → tipul arhivei interioare (alta)')
      await s.despacheteazaArhiveDinPlatforma(supa, () => {})   // tura 3: nivelul 2
      const adanc = d.find(x => x.nume_original === `${sp1}/adanc.zip`)!
      ok(/^📦 Arhivă despachetată pe Terra: 1 fișiere noi/.test(adanc.eroare), `nota: ${adanc.eroare}`)
      ok(d.some(x => x.nume_original === `${sp1}_adanc (#${adanc.id})/Z.pdf`), 'Z.pdf extras pe nivelul 2')
      const n = d.length
      await s.despacheteazaArhiveDinPlatforma(supa, () => {})
      eq(d.length, n, 'nimic nou la o tură în plus')
    } finally { await opreste() }
  })
})

Deno.test('arhive: nivelul MAX_ADANCIME_ARHIVE → manual, cu motiv; nimic extras, nu se reia', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    try {
      const fisiere = new Map<string, Uint8Array>([['3/d.zip', await zipCu({ 'X.pdf': '%PDF-1.4 x' })], ['3/e.zip', await zipCu({ 'Y.pdf': '%PDF-1.4 y' })]])
      const tab: Record<string, Rand[]> = { ofertare_documente_atribuire: [
        { id: 50, licitatie_id: 3, nume_original: 'A (#1)_B (#2)_C (#3)/d.zip', fisier_path: '3/d.zip', status_procesare: 'neprocesat', eroare: null },
        { id: 51, licitatie_id: 3, nume_original: 'A (#1)_B (#2)/e.zip', fisier_path: '3/e.zip', status_procesare: 'neprocesat', eroare: null },
      ], ofertare_licitatii: [], notifications: [] }
      const supa = fakeSupa(tab, fisiere)
      await s.despacheteazaArhiveDinPlatforma(supa, () => {})
      await s.despacheteazaArhiveDinPlatforma(supa, () => {})
      const d = tab.ofertare_documente_atribuire
      const prea = d.find(x => x.id === 50)!
      ok(/^Despachetare manuală necesară: arhivă imbricată pe nivelul 3 \(limita automată e 3 niveluri\)/.test(prea.eroare), prea.eroare)
      eq(prea.status_procesare, 'neprocesat', 'statusul nu se schimbă — doar nota')
      ok(!s.eArhivaDeDespachetat(prea), 'nu mai e reselectată')
      eq(d.filter(x => x.nume_original.includes('(#50)')).length, 0, 'nimic extras din ea')
      ok(d.some(x => x.nume_original === 'A (#1)_B (#2)_e (#51)/Y.pdf'), 'nivelul 2 se despachetează în continuare')
    } finally { await opreste() }
  })
})

Deno.test('arhive: nume care diferă doar prin paranteze / majuscule NU se confundă în aceeași arhivă', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    try {
      const fisiere = new Map<string, Uint8Array>([['3/m.zip', await zipCu({ 'Anexa (1).pdf': '%PDF-1.4 a', 'Anexa 1.pdf': '%PDF-1.4 b', 'X.PDF': '%PDF-1.4 c', 'x.pdf': '%PDF-1.4 d' })]])
      const tab: Record<string, Rand[]> = { ofertare_documente_atribuire: [{ id: 60, licitatie_id: 3, nume_original: 'Mama.zip', fisier_path: '3/m.zip', status_procesare: 'neprocesat', eroare: null }], ofertare_licitatii: [], notifications: [] }
      const supa = fakeSupa(tab, fisiere)
      await s.despacheteazaArhiveDinPlatforma(supa, () => {})
      const d = tab.ofertare_documente_atribuire
      eq(d.filter(x => x.nume_original.startsWith('Mama (#60)/')).map(x => x.nume_original).sort(),
        ['Mama (#60)/Anexa (1).pdf', 'Mama (#60)/Anexa 1.pdf', 'Mama (#60)/X.PDF', 'Mama (#60)/x.pdf'], 'toate patru urcate')
      ok(/^📦 Arhivă despachetată pe Terra: 4 fișiere noi/.test(d.find(x => x.id === 60)!.eroare) && !/existau/.test(d.find(x => x.id === 60)!.eroare), d.find(x => x.id === 60)!.eroare)
      Object.assign(d.find(x => x.id === 60)!, { status_procesare: 'neprocesat', eroare: null })   // reluarea manuală: tot fără dubluri
      await s.despacheteazaArhiveDinPlatforma(supa, () => {})
      eq(d.length, 5, 'reluarea nu dublează')
    } finally { await opreste() }
  })
})

Deno.test('arhive: arhivă de prim nivel urcată întreagă de edge / api — desfăcută COMPLET pe drumul SEAP → închisă; parțial → se recuperează doar lipsurile', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    try {
      const fisiere = new Map<string, Uint8Array>([
        ['3/pt.rar', await zipCu({ 'PT/Memoriu.pdf': '%PDF-1.4 m' })],                                    // drumul SEAP complet (evidență ok)
        ['3/doc.zip', await zipCu({ 'DOC/F3.pdf': '%PDF-1.4 f' })],                                       // ZIP inline edge, complet (manifest ok)
        ['3/par.zip', await zipCu({ 'A.pdf': '%PDF-1.4 a', 'B.pdf': '%PDF-1.4 b', 'C.pdf': '%PDF-1.4 c' })],   // ZIP inline edge PARȚIAL
        ['3/ev.zip', await zipCu({ 'X.pdf': '%PDF-1.4 x', 'Y.pdf': '%PDF-1.4 y' })],                      // drumul SEAP cu eroare (evidență eroare)
      ])
      const tab: Record<string, Rand[]> = {
        ofertare_documente_atribuire: [
          { id: 70, licitatie_id: 3, nume_original: 'PT.rar', fisier_path: '3/pt.rar', status_procesare: 'neprocesat', eroare: null },
          { id: 71, licitatie_id: 3, nume_original: 'DOC.zip', fisier_path: '3/doc.zip', status_procesare: 'neprocesat', eroare: null },
          { id: 72, licitatie_id: 3, nume_original: 'Par.zip', fisier_path: '3/par.zip', status_procesare: 'neprocesat', eroare: null },
          { id: 74, licitatie_id: 3, nume_original: 'Ev.zip', fisier_path: '3/ev.zip', status_procesare: 'neprocesat', eroare: null },
          { id: 73, licitatie_id: 3, nume_original: 'PT/Memoriu.pdf', fisier_path: '3/m.pdf', status_procesare: 'procesat', eroare: null },
        ],
        ofertare_seap_fisiere: [{ licitatie_id: 3, cheie: 'pt.rar', stare: 'ok', fisiere_extrase: 1 }, { licitatie_id: 3, cheie: 'ev.zip', stare: 'eroare', fisiere_extrase: 1 }],
        ofertare_seap_manifest: [
          { licitatie_id: 3, arhiva_cheie: 'doc.zip', cale: 'DOC/F3.pdf', document_id: 900 },
          { licitatie_id: 3, arhiva_cheie: 'par.zip', cale: 'A.pdf', document_id: 901 },
          { licitatie_id: 3, arhiva_cheie: 'par.zip', cale: 'B.pdf', document_id: null, motiv: 'rand BD nescris' },   // copil eșuat
          { licitatie_id: 3, arhiva_cheie: 'ev.zip', cale: 'X.pdf', document_id: 902 },
        ],
        ofertare_licitatii: [], notifications: [],
      }
      const supa = fakeSupa(tab, fisiere)
      for (let i = 0; i < 6; i++) await s.despacheteazaArhiveDinPlatforma(supa, () => {})
      const d = tab.ofertare_documente_atribuire
      const a = (id: number) => d.find(x => x.id === id)!
      const copii = (id: number) => d.filter(x => x.nume_original.includes(`(#${id})/`)).map(x => x.nume_original.split('/').slice(1).join('/')).sort()
      eq(a(70).status_procesare, 'ignorat', 'drumul SEAP complet → închisă')
      ok(/^📦 Arhivă deja despachetată pe drumul SEAP \(1 fișiere/.test(a(70).eroare), a(70).eroare)
      eq(copii(70), [], 'PT.rar: nimic a doua oară')
      eq(copii(71), [], 'DOC.zip: fișierul urcat de edge nu se dublează')
      ok(/^📦 Arhivă despachetată pe Terra: 0 fișiere noi.*1 existau deja/.test(a(71).eroare), a(71).eroare)
      eq(copii(72), ['B.pdf', 'C.pdf'], 'Par.zip: doar lipsurile (B eșuat la edge, C neajuns), A nu se dublează')
      eq(copii(74), ['Y.pdf'], 'Ev.zip: evidența cu eroare NU închide arhiva; X (urcat) se sare, Y se recuperează')
      eq(await s.dejaDesfacutaPeSeap(supa, { licitatie_id: 3, nume_original: 'PT (#9)/PT.rar' }), null, 'garda e doar pentru prim nivel')
      eq((await s.fisiereDejaImportate(supa, { licitatie_id: 3, nume_original: 'Par (#9)/Par.zip' })).size, 0, 'manifestul doar pentru prim nivel')
    } finally { await opreste() }
  })
})

Deno.test('arhive: urcare parțială → eroare vizibilă; reluarea manuală reîncearcă doar lipsurile', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    try {
      const fisiere = new Map<string, Uint8Array>([['3/p.zip', await zipCu({ 'A.pdf': '%PDF a', 'B.pdf': '%PDF b', 'PICA.pdf': '%PDF c' })]])
      const tab: Record<string, Rand[]> = { ofertare_documente_atribuire: [{ id: 30, licitatie_id: 3, nume_original: 'P.zip', fisier_path: '3/p.zip', status_procesare: 'neprocesat', eroare: null }], ofertare_licitatii: [{ id: 3, responsabil_id: 'u-1', nr_anunt: 'X' }], notifications: [] }
      const supa = fakeSupa(tab, fisiere)
      await s.despacheteazaArhiveDinPlatforma(supa, () => {})
      const arh = tab.ofertare_documente_atribuire.find(x => x.id === 30)!
      eq(arh.status_procesare, 'eroare', 'parțial ≠ despachetat')
      ok(/^Despachetare parțială: 2 fișiere noi urcate, 1 NEURCATE: PICA\.pdf/.test(arh.eroare), arh.eroare)
      eq(tab.ofertare_documente_atribuire.length, 3, 'cele 2 reușite rămân')
      eq(tab.notifications[0].type, 'warning', 'notificarea spune că lipsesc fișiere')
      await s.despacheteazaArhiveDinPlatforma(supa, () => {})
      eq(tab.ofertare_documente_atribuire.length, 3, 'fără reluare automată')
      Object.assign(arh, { status_procesare: 'neprocesat', eroare: null })   // reluarea manuală
      await s.despacheteazaArhiveDinPlatforma(supa, () => {})
      eq(tab.ofertare_documente_atribuire.length, 3, 'A și B nu se dublează (PICA pică din nou)')
      ok(/2 existau, 1 NEURCATE/.test(arh.eroare), arh.eroare)
    } finally { await opreste() }
  })
})

Deno.test('arhive: 60 de arhive vechi/tratate (id mici) nu blochează o arhivă nouă și nu sunt atinse', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    try {
      const fisiere = new Map<string, Uint8Array>([['3/nou.zip', await zipCu({ 'N.pdf': '%PDF n' })]])
      const vechi: Rand[] = []
      for (let i = 1; i <= 60; i++) vechi.push({ id: i, licitatie_id: 3, nume_original: `v${i}.${i % 3 ? 'zip' : 'rar'}`, fisier_path: `3/v${i}`,
        status_procesare: ['ignorat', 'eroare', 'neprocesat', 'ignorat'][i % 4], eroare: ['📦 Arhivă despachetată pe Terra: 1', 'Despachetare RESPINSĂ de controale', 'Despachetare manuală necesară: volume', 'non-PDF - ramane ca fisier (legacy)'][i % 4] })
      const tab: Record<string, Rand[]> = { ofertare_documente_atribuire: [...vechi, { id: 2000, licitatie_id: 3, nume_original: 'Nou.zip', fisier_path: '3/nou.zip', status_procesare: 'neprocesat', eroare: null }], ofertare_licitatii: [], notifications: [] }
      await s.despacheteazaArhiveDinPlatforma(fakeSupa(tab, fisiere), () => {})
      const nou = tab.ofertare_documente_atribuire.find(x => x.id === 2000)!
      ok(nou.eroare?.startsWith('📦 Arhivă despachetată pe Terra: 1 fișiere noi'), `arhiva nouă trebuia despachetată: ${nou.eroare}`)
      ok(tab.ofertare_documente_atribuire.some(x => x.nume_original === 'Nou (#2000)/N.pdf'), 'fișierul extras există')
      eq(tab.ofertare_documente_atribuire.filter(x => x.id <= 60 && /\(#/.test(x.nume_original)).length, 0, 'nimic extras din arhivele vechi')
      for (const v of vechi) {
        const r = tab.ofertare_documente_atribuire.find(x => x.id === v.id)!
        ok(r.status_procesare === v.status_procesare && r.eroare === v.eroare, `arhiva veche #${v.id} schimbată: ${r.status_procesare} / ${r.eroare}`)
      }
    } finally { await opreste() }
  })
})

Deno.test('arhive: 60 de placeholder-e de arhivă (id mici) nu blochează o arhivă reală nouă (filtrate înainte de limit)', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    try {
      const fisiere = new Map<string, Uint8Array>([['3/real.zip', await zipCu({ 'R.pdf': '%PDF r' })]])
      const ph: Rand[] = []
      for (let i = 1; i <= 60; i++) ph.push({ id: i, licitatie_id: 3, nume_original: `DOC${i}.rar`, fisier_path: i % 2 ? `3/neincarcat/DOC${i}.rar` : null,
        status_procesare: 'neprocesat', eroare: null })
      const tab: Record<string, Rand[]> = { ofertare_documente_atribuire: [...ph.map(x => ({ ...x })), { id: 2000, licitatie_id: 3, nume_original: 'Real.zip', fisier_path: '3/real.zip', status_procesare: 'neprocesat', eroare: null }], ofertare_licitatii: [], notifications: [] }
      await s.despacheteazaArhiveDinPlatforma(fakeSupa(tab, fisiere), () => {})
      const real = tab.ofertare_documente_atribuire.find(x => x.id === 2000)!
      ok(real.eroare?.startsWith('📦 Arhivă despachetată pe Terra: 1 fișiere noi'), `arhiva reală trebuia despachetată: ${real.eroare}`)
      ok(tab.ofertare_documente_atribuire.some(x => x.nume_original === 'Real (#2000)/R.pdf'), 'fișierul extras există')
      for (const p of ph) {
        const r = tab.ofertare_documente_atribuire.find(x => x.id === p.id)!
        ok(r.status_procesare === 'neprocesat' && r.eroare === null, `placeholder #${p.id} atins: ${r.status_procesare} / ${r.eroare}`)
      }
    } finally { await opreste() }
  })
})
