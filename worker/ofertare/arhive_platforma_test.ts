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
  m = t.match(/^([a-z_]+)\.like\.(.*)$/s); if (m) { const c = m[1], re = new RegExp('^' + m[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 's'); return r => r[c] != null && re.test(r[c]) }
  throw new Error('filtru necunoscut în fake: ' + t)
}
function parseazaOr(expr: string): (r: Rand) => boolean { const fs = imparte(expr).map(parseazaTermen); return r => fs.some(f => f(r)) }
function fakeSupa(tabele: Record<string, Rand[]>, fisiere: Map<string, Uint8Array>) {
  let nextId = 5000
  const potriveste = (r: Rand, f: ((r: Rand) => boolean)[]) => f.every(x => x(r))
  function builder(tabel: string) {
    const filtre: ((r: Rand) => boolean)[] = []
    let op: 'select' | 'update' | 'insert' | 'upsert' = 'select', patch: Rand | Rand[] = {}, limita = Infinity, inceput = 0, sel = false, conflict: string[] = []
    const b: any = {
      select() { sel = true; return b },
      update(p: Rand) { op = 'update'; patch = p; return b },
      insert(p: Rand | Rand[]) { op = 'insert'; patch = p; return b },
      upsert(p: Rand | Rand[], o?: { onConflict?: string }) { op = 'upsert'; patch = p; conflict = (o?.onConflict ?? '').split(',').filter(Boolean); return b },   // ca în BD: înlocuiește pe cheia unică
      eq(c: string, v: unknown) { filtre.push(r => r[c] === v); return b },
      neq(c: string, v: unknown) { filtre.push(r => r[c] !== v); return b },
      in(c: string, v: unknown[]) { filtre.push(r => v.includes(r[c])); return b },
      gt(c: string, v: any) { filtre.push(r => r[c] != null && r[c] > v); return b },
      is(c: string, v: unknown) { filtre.push(r => (v === null ? r[c] == null : r[c] === v)); return b },
      not(c: string, o: string, v: unknown) {   // semantica SQL: NULL nu trece niciun NOT
        if (o === 'is' && v === null) filtre.push(r => r[c] != null)
        else if (o === 'like') { const re = new RegExp('^' + String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'); filtre.push(r => r[c] != null && !re.test(r[c])) }
        else if (o === 'ilike') { const re = reLike(String(v)); filtre.push(r => r[c] != null && !re.test(r[c])) }
        else throw new Error(`fake: not ${o} neimplementat`)
        return b
      },
      ilike(c: string, p: string) { const re = new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i'); filtre.push(r => re.test(r[c] ?? '')); return b },
      or(expr: string) { const f = parseazaOr(expr); filtre.push(r => f(r)); return b },
      order() { return b },
      limit(n: number) { limita = n; return b },
      range(de: number, la: number) { inceput = de; limita = la - de + 1; return b },
      maybeSingle() { return b.then((x: any) => ({ data: x.data?.[0] ?? null, error: x.error })) },
      single() { return b.then((x: any) => ({ data: x.data?.[0] ?? null, error: x.data?.length ? null : { message: 'niciun rând' } })) },
      then(res: any, rej: any) {
        const t = tabele[tabel] ??= []
        let data: Rand[] = []
        if (op === 'select') data = t.filter(r => potriveste(r, filtre)).slice(inceput, inceput + limita)
        else if (op === 'update') { data = t.filter(r => potriveste(r, filtre)); data.forEach(r => Object.assign(r, patch)) }
        else if (op === 'upsert') {
          data = (Array.isArray(patch) ? patch : [patch]).map(p => {
            const vechi = conflict.length ? t.find(r => conflict.every(c => r[c] === p[c])) : undefined
            if (vechi) return Object.assign(vechi, p)
            const nou = { id: nextId++, ...p }; t.push(nou); return nou
          })
        }
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
      const pt = await zipCu({ 'PT/Memoriu.pdf': '%PDF-1.4 m' })
      const fisiere = new Map<string, Uint8Array>([
        ['3/pt.rar', pt],                                                                                   // drumul SEAP complet (evidență ok, același sha)
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
          // documentele dovedite de manifest există în platformă (fără ele, dovada nu mai sare nimic — Copilot r1 pe #646)
          { id: 900, licitatie_id: 3, nume_original: 'DOC/F3.pdf', fisier_path: '3/f3.pdf', status_procesare: 'procesat', eroare: null },
          { id: 901, licitatie_id: 3, nume_original: 'A.pdf', fisier_path: '3/a.pdf', status_procesare: 'procesat', eroare: null },
          { id: 902, licitatie_id: 3, nume_original: 'X.pdf', fisier_path: '3/x.pdf', status_procesare: 'procesat', eroare: null },
        ],
        ofertare_seap_fisiere: [{ licitatie_id: 3, cheie: 'pt.rar', stare: 'ok', fisiere_extrase: 1, sha256: await shaOcteti(pt) }, { licitatie_id: 3, cheie: 'ev.zip', stare: 'eroare', fisiere_extrase: 1 }],
        ofertare_seap_manifest: [   // dovezi 'urcat' (sha-ul fișierului chiar urcat sub document_id) — #5: doar ele sar un fișier
          { licitatie_id: 3, arhiva_cheie: 'doc.zip', cale: 'DOC/F3.pdf', document_id: 900, stare: 'urcat', sha256: await shaHex('%PDF-1.4 f') },
          { licitatie_id: 3, arhiva_cheie: 'par.zip', cale: 'A.pdf', document_id: 901, stare: 'urcat', sha256: await shaHex('%PDF-1.4 a') },
          { licitatie_id: 3, arhiva_cheie: 'par.zip', cale: 'B.pdf', document_id: null, stare: 'eroare_urcare', sha256: await shaHex('%PDF-1.4 b'), motiv: 'rand BD nescris' },   // copil eșuat
          { licitatie_id: 3, arhiva_cheie: 'ev.zip', cale: 'X.pdf', document_id: 902, stare: 'urcat', sha256: await shaHex('%PDF-1.4 x') },
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

// -- Drumul SEAP (aduLicitatie): identitatea fișierelor extrase = nume exact + conținut (07.10.2026, review PR #641) ------
function cuSeap(docs: Record<string, Uint8Array>) {   // SEAP simulat: lista GetDfNoticeSectionFiles + descărcarea per document
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: any) => {
    const u = String(input?.url ?? input)
    if (u.includes('GetDfNoticeSectionFiles')) {
      return new Response(JSON.stringify({ dfNoticeDocs: Object.keys(docs).map(n => ({ noticeDocumentName: n, noticeDocumentUrl: `https://e-licitatie.ro/f/${encodeURIComponent(n)}` })) }), { headers: { 'set-cookie': 'a=b' } })
    }
    const m = u.match(/\/f\/(.*)$/)
    if (m) return new Response(docs[decodeURIComponent(m[1])] as unknown as BodyInit)
    return new Response('nu', { status: 404 })
  }) as typeof fetch
  return () => { globalThis.fetch = orig }
}
const licSeap = (extra: Partial<Record<string, Rand[]>> = {}): Record<string, Rand[]> => ({
  ofertare_licitatii: [{ id: 3, c_notice_id: 1, sys_notice_type_id: 2, nr_anunt: 'CN1', responsabil_id: null }],
  ofertare_documente_atribuire: [], ofertare_seap_fisiere: [], ofertare_seap_manifest: [], notifications: [], ...extra,
} as Record<string, Rand[]>)

const shaHex = async (t: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map(x => x.toString(16).padStart(2, '0')).join('')
const shaOcteti = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>))].map(x => x.toString(16).padStart(2, '0')).join('')

Deno.test('drumul SEAP: două arhive cu „Caiet de sarcini.pdf” DIFERIT, de aceeași mărime → ambele urcate; 3 reluări nu dublează', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    // aceeași lungime (14 octeți): mărimea nu mai e dovadă de identitate (Copilot NO-GO r1 pe #643)
    const restore = cuSeap({ 'Lot1.zip': await zipCu({ 'Caiet de sarcini.pdf': '%PDF-1.4 LOT 1' }), 'Lot2.zip': await zipCu({ 'Caiet de sarcini.pdf': '%PDF-1.4 LOT 2' }) })
    try {
      const tab = licSeap()
      const supa = fakeSupa(tab, new Map())
      await s.aduLicitatie(supa, 3, () => {})
      const nume = tab.ofertare_documente_atribuire.map(d => d.nume_original).sort()
      eq(nume.length, 2, `urcate: ${nume}`)
      ok(nume.includes('Caiet de sarcini.pdf') && nume.some((n: string) => /^Lot[12]\/Caiet de sarcini\.pdf$/.test(n)), `nume: ${nume}`)
      ok(tab.ofertare_seap_manifest.every(m => m.document_id != null && m.stare === 'urcat'), 'niciun „deja_in_platforma” cu alt conținut')
      const n = tab.ofertare_documente_atribuire.length
      for (let k = 2; k <= 3; k++) {   // reluări complete (evidența ștearsă): același conținut dovedit → „deja”
        tab.ofertare_seap_fisiere.length = 0
        await s.aduLicitatie(supa, 3, () => {})
        eq(tab.ofertare_documente_atribuire.length, n, `reluarea ${k} nu dublează`)
        ok(tab.ofertare_seap_manifest.every(m => m.stare === 'urcat'), `reluarea ${k}: propriul rând „urcat” (dovada sha) nu e retrogradat`)
      }
    } finally { restore(); await opreste() }
  })
})

Deno.test('drumul SEAP: în aceeași arhivă „Anexa (1)” / „Anexa 1” și „X.PDF” / „x.pdf”, aceeași mărime, conținut diferit → toate 4 urcate', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    const restore = cuSeap({ 'DOC.zip': await zipCu({ 'Anexa (1).pdf': '%PDF-1.4 a', 'Anexa 1.pdf': '%PDF-1.4 b', 'X.PDF': '%PDF-1.4 c', 'x.pdf': '%PDF-1.4 d' }) })
    try {
      const tab = licSeap()
      await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      eq(tab.ofertare_documente_atribuire.map(d => d.nume_original).sort(), ['Anexa (1).pdf', 'Anexa 1.pdf', 'X.PDF', 'x.pdf'])
      eq(tab.ofertare_seap_fisiere.map(e => [e.stare, e.fisiere_extrase]), [['ok', 4]])
    } finally { restore(); await opreste() }
  })
})

Deno.test('drumul SEAP: fără sha dovedit NU e „deja” (urcat de mână cu aceeași mărime, size_bytes NULL); cu sha dovedit e „deja”', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    const restore = cuSeap({ 'DOC.zip': await zipCu({ 'Anexa 1.pdf': '%PDF-1.4 a', 'Memoriu.pdf': '%PDF-1.4 memoriu', 'Caiet.pdf': '%PDF-1.4 caiet' }) })
    try {
      const tab = licSeap({
        ofertare_documente_atribuire: [
          { id: 10, licitatie_id: 3, nume_original: 'Anexa 1.pdf', fisier_path: '3/x.pdf', size_bytes: 10, status_procesare: 'procesat' },   // de mână, aceeași mărime
          { id: 11, licitatie_id: 3, nume_original: 'Memoriu.pdf', fisier_path: '3/m.pdf', size_bytes: null, status_procesare: 'procesat' },  // rând vechi, fără mărime
          { id: 12, licitatie_id: 3, nume_original: 'Caiet.pdf', fisier_path: '3/c.pdf', size_bytes: 14, status_procesare: 'procesat' },
        ],
        ofertare_seap_manifest: [{ licitatie_id: 3, arhiva_cheie: 'vechi.zip', cale: 'Caiet.pdf', marime: 14, sha256: await shaHex('%PDF-1.4 caiet'), document_id: 12, stare: 'urcat', motiv: null }],
      })
      await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      const noi = tab.ofertare_documente_atribuire.filter(d => d.id >= 5000).map(d => d.nume_original).sort()
      eq(noi, ['DOC/Anexa 1.pdf', 'DOC/Memoriu.pdf'], 'nedovedite → urcate cu prefixul arhivei, nu „deja”')
      const caiet = tab.ofertare_seap_manifest.find(m => m.arhiva_cheie === 'doc.zip' && m.cale === 'Caiet.pdf')
      eq([caiet?.document_id, caiet?.stare], [12, 'deja_in_platforma'], 'Caiet are sha dovedit (manifest „urcat” din altă arhivă) → deja')
    } finally { restore(); await opreste() }
  })
})

Deno.test('drumul SEAP: manifest istoric corupt (B scris „deja_in_platforma” cu id-ul lui A) nu e dovadă — B se urcă, în orice ordine', async () => {
  for (const ordine of ['A,B', 'B,A']) {
    await cuMediu(async (root, s) => {
      const opreste = pornesteExtractor(root)
      const restore = cuSeap({ 'Lot2.zip': await zipCu({ 'Caiet de sarcini.pdf': '%PDF-1.4 LOT 2' }) })
      try {
        const rA = { licitatie_id: 3, arhiva_cheie: 'lot1.zip', cale: 'Caiet de sarcini.pdf', marime: 14, sha256: await shaHex('%PDF-1.4 LOT 1'), document_id: 10, stare: 'urcat', motiv: null }
        const rB = { licitatie_id: 3, arhiva_cheie: 'lot2.zip', cale: 'Caiet de sarcini.pdf', marime: 14, sha256: await shaHex('%PDF-1.4 LOT 2'), document_id: 10, stare: 'deja_in_platforma', motiv: null }
        const tab = licSeap({
          ofertare_documente_atribuire: [{ id: 10, licitatie_id: 3, nume_original: 'Caiet de sarcini.pdf', fisier_path: '3/a.pdf', size_bytes: 14, status_procesare: 'procesat' }],
          ofertare_seap_manifest: ordine === 'A,B' ? [rA, rB] : [rB, rA],
        })
        await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
        eq(tab.ofertare_documente_atribuire.filter(d => d.id >= 5000).map(d => d.nume_original), ['Lot2/Caiet de sarcini.pdf'], `ordinea ${ordine}`)
        const m = tab.ofertare_seap_manifest.find(r => r.arhiva_cheie === 'lot2.zip')
        ok(m?.stare === 'urcat' && m?.document_id !== 10, `ordinea ${ordine}: rândul lui B indică acum documentul lui B (${JSON.stringify(m)})`)
      } finally { restore(); await opreste() }
    })
  }
})

Deno.test('drumul SEAP: fișierele din arhivă primesc tipul cu indiciul arhivei (ca bucla de platformă și ZIP-ul inline din edge)', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    const restore = cuSeap({ 'LISTE CANTITATI.zip': await zipCu({ '01. Obiect 1.pdf': '%PDF-1.4 o1', 'Plan de situatie.pdf': '%PDF-1.4 ps' }) })
    try {
      const tab = licSeap()
      await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      const tip = Object.fromEntries(tab.ofertare_documente_atribuire.map(d => [d.nume_original, d.tip]).sort())
      eq(tip, { '01. Obiect 1.pdf': 'lista_cantitati', 'Plan de situatie.pdf': 'plansa' }, 'fără nume grăitor → indiciul arhivei; regula proprie bate indiciul')
    } finally { restore(); await opreste() }
  })
})

// -- audit #4 var. B, PR-2: workerul NAS decide pe codul SEAP (_shared/codSeap.mjs), ca edge-ul de import ----------------------
// SEAP simulat CU coduri: lista poate avea ACELAȘI nume de două ori (lic. 100), deci URL-ul e pe poziție; `descarcate` = ce s-a cerut
function cuSeapCod(lista: { nume: string; cod?: string; buf: string | Uint8Array | null }[]) {
  const orig = globalThis.fetch
  const descarcate: string[] = []
  globalThis.fetch = (async (input: any) => {
    const u = String(input?.url ?? input)
    if (u.includes('GetDfNoticeSectionFiles')) {
      return new Response(JSON.stringify({ dfNoticeDocs: lista.map((d, i) => ({ noticeDocumentName: d.nume, noticeDocumentCode: d.cod, noticeDocumentUrl: `https://e-licitatie.ro/f/${i}` })) }), { headers: { 'set-cookie': 'a=b' } })
    }
    const m = u.match(/\/f\/(\d+)$/)
    if (m) { const d = lista[Number(m[1])]; descarcate.push(d.nume); if (d.buf == null) return new Response('căzut', { status: 500 }); return new Response((typeof d.buf === 'string' ? new TextEncoder().encode(d.buf) : d.buf) as unknown as BodyInit) }
    return new Response('nu', { status: 404 })
  }) as typeof fetch
  return { descarcate, restore: () => { globalThis.fetch = orig } }
}
const octetiText = (t: string) => new TextEncoder().encode(t)

Deno.test('cod SEAP (PR-2): republicare sub ACELAȘI nume, cod nou → versiune „N (COD).ext” anunțabilă; evidența „ok” pe numele vechi nu o mai ascunde', async () => {
  await cuMediu(async (_root, s) => {
    const { descarcate, restore } = cuSeapCod([{ nume: 'Caiet de sarcini.pdf', cod: 'CN1/00020', buf: '%PDF-1.4 revizuit' }])
    try {
      const tab = licSeap({
        ofertare_documente_atribuire: [{ id: 10, licitatie_id: 3, nume_original: 'Caiet de sarcini.pdf', fisier_path: '3/c.pdf', size_bytes: 14, seap_cod: 'CN1/00010', tip: 'cs_volum', status_procesare: 'procesat' }],
        // înainte de PR-2 evidența „ok” pe numele SEAP (sau rândul cu același nume) sărea republicarea în tăcere
        ofertare_seap_fisiere: [{ id: 900, licitatie_id: 3, nume_seap: 'Caiet de sarcini.pdf', cheie: s.cheieEvidenta('Caiet de sarcini.pdf'), stare: 'ok', incercari: 1 }],
      })
      const supa = fakeSupa(tab, new Map())
      const rap = await s.aduLicitatie(supa, 3, () => {})
      const v = tab.ofertare_documente_atribuire.find(d => d.id >= 5000)
      eq(v?.nume_original, 'Caiet de sarcini (CN1-00020).pdf', JSON.stringify(rap))
      eq([v?.seap_cod, v?.aparut_ulterior, v?.tip, v?.seap_meta?.de_anuntat, v?.seap_meta?.inlocuieste_id, v?.seap_meta?.cod_anterior, v?.sursa], ['CN1/00020', true, 'cs_volum', true, 10, 'CN1/00010', 'seap'])
      eq(rap.versiuni_noi, ['Caiet de sarcini (CN1-00020).pdf'])
      eq(tab.ofertare_seap_fisiere.find(e => e.cheie === s.cheieCod('CN1/00020'))?.nume_seap, 'Caiet de sarcini (CN1-00020).pdf')
      eq(tab.ofertare_seap_fisiere.find(e => e.cheie === s.cheieCod('CN1/00020'))?.stare, 'ok', 'evidența versiunii stă pe cheia codului ei')
      descarcate.length = 0
      const r2 = await s.aduLicitatie(supa, 3, () => {})
      eq([descarcate, tab.ofertare_documente_atribuire.length, r2.deja], [[], 2, 1], 'a doua rulare: codul e pe rând → sărit, fără descărcare')
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, F5): republicat IDENTIC sub cod nou → codul se mută pe rândul vechi, fără document nou și fără anunț', async () => {
  await cuMediu(async (_root, s) => {
    const c = '%PDF-1.4 caiet'
    const { restore } = cuSeapCod([{ nume: 'Caiet de sarcini.pdf', cod: 'CN1/00020', buf: c }])
    try {
      const tab = licSeap({
        ofertare_documente_atribuire: [{ id: 10, licitatie_id: 3, nume_original: 'Caiet de sarcini.pdf', fisier_path: '3/c.pdf', size_bytes: c.length, seap_cod: 'CN1/00010', status_procesare: 'procesat' }],
        ofertare_seap_manifest: [{ licitatie_id: 3, arhiva_cheie: 'caiet de sarcini.pdf', cale: 'Caiet de sarcini.pdf', marime: c.length, sha256: await shaHex(c), document_id: 10, stare: 'urcat', motiv: null }],
      })
      const rap = await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      eq([tab.ofertare_documente_atribuire.length, tab.ofertare_documente_atribuire[0].seap_cod, rap.coduri_mutate, rap.versiuni_noi], [1, 'CN1/00020', 1, []], JSON.stringify(rap))
      eq(tab.ofertare_seap_fisiere.map(e => [e.stare, e.etapa]), [['ok', 'cod']])
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, lic. 100): două documente cu ACELAȘI nume și un singur rând vechi → codul pe rândul cu același conținut, celălalt urcat ca frate', async () => {
  await cuMediu(async (_root, s) => {
    const a = '%PDF-1.4 anexa A', b = '%PDF-1.4 anexa B'   // aceeași mărime: se citește obiectul din Storage
    const { descarcate, restore } = cuSeapCod([{ nume: 'Anexa 1.pdf', cod: 'CN1/00001', buf: a }, { nume: 'Anexa 1.pdf', cod: 'CN1/00002', buf: b }])
    try {
      const tab = licSeap({ ofertare_documente_atribuire: [{ id: 10, licitatie_id: 3, nume_original: 'Anexa 1.pdf', fisier_path: '3/a.pdf', size_bytes: a.length, status_procesare: 'procesat' }] })
      const supa = fakeSupa(tab, new Map([['3/a.pdf', octetiText(a)]]))
      const rap = await s.aduLicitatie(supa, 3, () => {})
      const docs = tab.ofertare_documente_atribuire.map(d => [d.id >= 5000 ? 'nou' : d.id, d.nume_original, d.seap_cod])
      eq(docs, [[10, 'Anexa 1.pdf', 'CN1/00001'], ['nou', 'Anexa 1 (CN1-00002).pdf', 'CN1/00002']], JSON.stringify(rap))
      eq(tab.ofertare_documente_atribuire[1].seap_meta?.frate_cu, [10])
      eq([rap.coduri_adoptate, rap.frati, rap.identitate_neverificata], [1, ['Anexa 1 (CN1-00002).pdf'], []])
      ok((tab.egress_jurnal || []).some((j: Rand) => j.p_obiect === '3/a.pdf'), 'citirea candidatului din Storage trece prin monitorul de egress')
      ok(tab.ofertare_seap_fisiere.every(e => e.stare === 'ok'), `evidența: ${JSON.stringify(tab.ofertare_seap_fisiere)}`)
      descarcate.length = 0
      await s.aduLicitatie(supa, 3, () => {})
      eq([descarcate, tab.ofertare_documente_atribuire.length], [[], 2], 'reluarea nu descarcă și nu dublează')
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2): identitate fără nicio cale de dovadă → „eroare” vizibilă (poarta), fără descărcare și fără reîncercări consumate; cu mărimea cunoscută se rezolvă', async () => {
  await cuMediu(async (_root, s) => {
    const a = '%PDF-1.4 anexa A', b = '%PDF-1.4 anexa B'
    const { descarcate, restore } = cuSeapCod([{ nume: 'Anexa 1.pdf', cod: 'CN1/00001', buf: a }, { nume: 'Anexa 1.pdf', cod: 'CN1/00002', buf: b }])
    try {
      const tab = licSeap({ ofertare_documente_atribuire: [{ id: 10, licitatie_id: 3, nume_original: 'Anexa 1.pdf', fisier_path: '3/a.pdf', size_bytes: null, status_procesare: 'procesat' }] })
      const supa = fakeSupa(tab, new Map([['3/a.pdf', octetiText(a)]]))
      for (let k = 1; k <= 4; k++) {   // de mai multe ori: rămâne „eroare”, nu ajunge „sărită” peste MAX_INCERCARI
        const rap = await s.aduLicitatie(supa, 3, () => {})
        eq([descarcate, rap.identitate_neverificata.length, tab.ofertare_documente_atribuire.length], [[], 2, 1], `rularea ${k}`)
        eq(tab.ofertare_seap_fisiere.map(e => [e.stare, e.etapa, e.incercari]), [['eroare', 'identitate', 0], ['eroare', 'identitate', 0]], `rularea ${k}`)
      }
      tab.ofertare_documente_atribuire[0].size_bytes = a.length   // ex. urcat din nou din platformă
      const rap = await s.aduLicitatie(supa, 3, () => {})
      eq(tab.ofertare_documente_atribuire.map(d => d.seap_cod), ['CN1/00001', 'CN1/00002'], JSON.stringify(rap))
      ok(tab.ofertare_seap_fisiere.every(e => e.stare === 'ok'), `evidența închisă: ${JSON.stringify(tab.ofertare_seap_fisiere)}`)
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, L1 = A): rând vechi fără cod, unic pe nume → codul adoptat fără descărcare; evidența veche „eroare” se închide', async () => {
  await cuMediu(async (_root, s) => {
    const { descarcate, restore } = cuSeapCod([{ nume: 'Fisa de date.pdf', cod: 'CN1/00003', buf: '%PDF-1.4 fisa' }])
    try {
      const tab = licSeap({
        ofertare_documente_atribuire: [{ id: 10, licitatie_id: 3, nume_original: 'Fisa de date.pdf', fisier_path: '3/f.pdf', size_bytes: 13, status_procesare: 'procesat' }],
        ofertare_seap_fisiere: [{ id: 900, licitatie_id: 3, nume_seap: 'Fisa de date.pdf', cheie: s.cheieEvidenta('Fisa de date.pdf'), stare: 'eroare', etapa: 'descarcare', incercari: 3 }],
      })
      const rap = await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      eq([descarcate, tab.ofertare_documente_atribuire[0].seap_cod, rap.coduri_adoptate, tab.ofertare_seap_fisiere[0].stare], [[], 'CN1/00003', 1, 'ok'])
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, F1): placeholder-ul veghei pe numele versiunii se completează, fără al doilea anunț (de_anuntat = false)', async () => {
  await cuMediu(async (_root, s) => {
    const { restore } = cuSeapCod([{ nume: 'Caiet de sarcini.pdf', cod: 'CN1/00020', buf: '%PDF-1.4 revizuit' }])
    try {
      const tab = licSeap({ ofertare_documente_atribuire: [
        { id: 10, licitatie_id: 3, nume_original: 'Caiet de sarcini.pdf', fisier_path: '3/c.pdf', size_bytes: 14, seap_cod: 'CN1/00010', status_procesare: 'procesat' },
        { id: 11, licitatie_id: 3, nume_original: 'Caiet de sarcini (CN1-00020).pdf', fisier_path: '3/neincarcat/x', status_procesare: 'eroare' },
      ] })
      await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      const ph = tab.ofertare_documente_atribuire.find(d => d.id === 11)
      eq([tab.ofertare_documente_atribuire.length, ph?.seap_cod, ph?.seap_meta?.de_anuntat, ph?.seap_meta?.anuntat_prin], [2, 'CN1/00020', false, 'placeholder veghe'])
      ok(!String(ph?.fisier_path).includes('/neincarcat/'), 'placeholder completat cu fișierul')
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2): evidența „eroare” a unei versiuni al cărei cod a IEȘIT din listă (republicat iar) se închide; altele rămân', async () => {
  await cuMediu(async (_root, s) => {
    const { restore } = cuSeapCod([{ nume: 'Caiet de sarcini.pdf', cod: 'CN1/00030', buf: '%PDF-1.4 a treia' }])
    try {
      let idEv = 900
      const ev = (nume: string, cheie = s.cheieEvidenta(nume)) => ({ id: idEv++, licitatie_id: 3, nume_seap: nume, cheie, stare: 'eroare', etapa: 'descarcare', incercari: 3 })
      const tab = licSeap({
        ofertare_documente_atribuire: [{ id: 10, licitatie_id: 3, nume_original: 'Caiet de sarcini.pdf', fisier_path: '3/c.pdf', size_bytes: 14, seap_cod: 'CN1/00010', status_procesare: 'procesat' }],
        // /20 n-a putut fi adusă, apoi autoritatea a republicat /30; „Anexa 2.pdf” (alt nume, nelistat) nu e treaba regulii
        // evidența pe cod a lui /20 stă pe cheia codului; o evidență BRUTĂ cu același nume afișat (document numit literal așa, pe
        // regula după nume) nu e a codului și rămâne (Copilot r8 + Jakarinos r14)
        ofertare_seap_fisiere: [ev('Caiet de sarcini (CN1-00020).pdf', s.cheieCod('CN1/00020')), ev('Anexa 2.pdf'), ev('Anexa (1).pdf'), ev('Caiet de sarcini (CN1-00021).pdf')],
      })
      await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      const st = Object.fromEntries(tab.ofertare_seap_fisiere.map(e => [e.nume_seap, e.stare]))
      eq(st, { 'Caiet de sarcini (CN1-00020).pdf': 'sarit', 'Anexa 2.pdf': 'eroare', 'Anexa (1).pdf': 'eroare', 'Caiet de sarcini (CN1-00021).pdf': 'eroare', 'Caiet de sarcini (CN1-00030).pdf': 'ok' })
      eq(tab.ofertare_documente_atribuire.find(d => d.id >= 5000)?.seap_cod, 'CN1/00030')
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, Jakarinos r1 #1): doi frați cu același nume și conținut IDENTIC, inventar gol → un singur document (ca în edge)', async () => {
  await cuMediu(async (_root, s) => {
    const c = '%PDF-1.4 anexa'
    const { restore } = cuSeapCod([{ nume: 'N.pdf', cod: 'CN1/00001', buf: c }, { nume: 'N.pdf', cod: 'CN1/00002', buf: c }])
    try {
      const tab = licSeap()
      const rap = await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      eq(tab.ofertare_documente_atribuire.map(d => [d.nume_original, d.seap_cod]), [['N.pdf', 'CN1/00001']], JSON.stringify(rap))
      // evidența fiecărui cod pe „N (COD).ext” (Jakarinos r10), chiar dacă primul s-a urcat ca „N.pdf”
      eq(tab.ofertare_seap_fisiere.map(e => [e.nume_seap, e.stare]), [['N (CN1-00001).pdf', 'ok'], ['N (CN1-00002).pdf', 'ok']])
      ok(rap.avertismente.some((a: string) => a.includes('conținut identic')), JSON.stringify(rap.avertismente))
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, Jakarinos r1 #2): „N.pdf” căzut la descărcare, recuperat apoi ca frate → eroarea veche de pe numele comun se închide când ambele sunt în platformă', async () => {
  await cuMediu(async (_root, s) => {
    const lista: { nume: string; cod?: string; buf: string | null }[] = [{ nume: 'N.pdf', cod: 'CN1/00001', buf: null }, { nume: 'N.pdf', cod: 'CN1/00002', buf: '%PDF-1.4 doi' }]
    const { restore } = cuSeapCod(lista)
    try {
      // eroarea de pe „N.pdf” e din evidența pe nume de dinainte de PR-2 (drumul pe cod scrie acum doar pe „N (COD).ext”)
      const tab = licSeap({ ofertare_seap_fisiere: [{ id: 900, licitatie_id: 3, nume_seap: 'N.pdf', cheie: s.cheieEvidenta('N.pdf'), stare: 'eroare', etapa: 'descarcare', incercari: 1 }] })
      const supa = fakeSupa(tab, new Map())
      const stari = () => Object.fromEntries(tab.ofertare_seap_fisiere.map(e => [e.nume_seap, e.stare]))
      await s.aduLicitatie(supa, 3, () => {})
      eq(stari(), { 'N.pdf': 'eroare', 'N (CN1-00001).pdf': 'eroare', 'N (CN1-00002).pdf': 'ok' }, 'rularea 1: primul căzut')
      lista[0].buf = '%PDF-1.4 unu'
      await s.aduLicitatie(supa, 3, () => {})   // primul revine ca frate „N (CN1-00001).pdf”; ambele prezente → „N.pdf” închis
      eq(tab.ofertare_documente_atribuire.map(d => d.seap_cod).sort(), ['CN1/00001', 'CN1/00002'])
      eq(stari(), { 'N.pdf': 'ok', 'N (CN1-00001).pdf': 'ok', 'N (CN1-00002).pdf': 'ok' }, 'rularea 2')
      ok(!tab.ofertare_seap_fisiere.some(e => e.stare === 'eroare' || e.stare === 'identificat'), 'poarta nu mai are nimic de blocat')
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, Jakarinos r2 #1): două rânduri „N.pdf” (/10, /11) republicate IDENTIC (/20, /21) → ambele coduri mutate, nicio versiune, niciun anunț', async () => {
  await cuMediu(async (_root, s) => {
    const a = '%PDF-1.4 cont A', b = '%PDF-1.4 cont B'   // aceeași mărime: dovada se citește din Storage
    const { restore } = cuSeapCod([{ nume: 'N.pdf', cod: 'CN1/00020', buf: a }, { nume: 'N.pdf', cod: 'CN1/00021', buf: b }])
    try {
      const tab = licSeap({ ofertare_documente_atribuire: [
        { id: 10, licitatie_id: 3, nume_original: 'N.pdf', fisier_path: '3/a.pdf', size_bytes: a.length, seap_cod: 'CN1/00010', status_procesare: 'procesat' },
        { id: 11, licitatie_id: 3, nume_original: 'N.pdf', fisier_path: '3/b.pdf', size_bytes: b.length, seap_cod: 'CN1/00011', status_procesare: 'procesat' },
      ] })
      const rap = await s.aduLicitatie(fakeSupa(tab, new Map([['3/a.pdf', octetiText(a)], ['3/b.pdf', octetiText(b)]])), 3, () => {})
      eq(tab.ofertare_documente_atribuire.map(d => [d.id, d.seap_cod]), [[10, 'CN1/00020'], [11, 'CN1/00021']], JSON.stringify(rap))
      eq([rap.coduri_mutate, rap.versiuni_noi], [2, []])
      ok(!tab.ofertare_documente_atribuire.some(d => d.seap_meta?.de_anuntat), 'niciun anunț de versiune')
      ok(tab.ofertare_seap_fisiere.every(e => e.stare === 'ok'), JSON.stringify(tab.ofertare_seap_fisiere))
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, Copilot r1 #1): ABA — C10 căzut, ieșit din listă („sarit”), apoi reapărut → se aduce, nu e „deja”', async () => {
  await cuMediu(async (_root, s) => {
    const lista: { nume: string; cod?: string; buf: string | null }[] = [{ nume: 'N.pdf', cod: 'CN1/00010', buf: null }]
    const { restore } = cuSeapCod(lista)
    try {
      const tab = licSeap({ ofertare_documente_atribuire: [{ id: 10, licitatie_id: 3, nume_original: 'N.pdf', fisier_path: '3/n.pdf', size_bytes: 14, seap_cod: 'CN1/00005', status_procesare: 'procesat' }] })
      const supa = fakeSupa(tab, new Map())
      const st = () => tab.ofertare_seap_fisiere.find(e => e.nume_seap === 'N (CN1-00010).pdf')?.stare
      await s.aduLicitatie(supa, 3, () => {})
      eq(st(), 'eroare', 'rularea 1: C10 căzut')
      lista[0] = { nume: 'N.pdf', cod: 'CN1/00020', buf: null }
      await s.aduLicitatie(supa, 3, () => {})
      eq(st(), 'sarit', 'rularea 2: C10 ieșit din listă')
      lista[0] = { nume: 'N.pdf', cod: 'CN1/00010', buf: '%PDF-1.4 C10 revine' }
      await s.aduLicitatie(supa, 3, () => {})
      ok(tab.ofertare_documente_atribuire.some(d => d.seap_cod === 'CN1/00010'), `rularea 3: C10 adus (${JSON.stringify(tab.ofertare_documente_atribuire.map(d => [d.nume_original, d.seap_cod]))})`)
      eq(st(), 'ok')
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, Copilot r1 #2): identitate dovedită pe sha, dar adopția codului cade → evidența „eroare” (nu „ok” definitiv), apoi se rezolvă', async () => {
  await cuMediu(async (_root, s) => {
    const a = '%PDF-1.4 anexa A', b = '%PDF-1.4 anexa B'
    const { restore } = cuSeapCod([{ nume: 'Anexa 1.pdf', cod: 'CN1/00001', buf: a }, { nume: 'Anexa 1.pdf', cod: 'CN1/00002', buf: b }])
    try {
      const tab = licSeap({ ofertare_documente_atribuire: [{ id: 10, licitatie_id: 3, nume_original: 'Anexa 1.pdf', fisier_path: '3/a.pdf', size_bytes: a.length, status_procesare: 'procesat' }] })
      const baza = fakeSupa(tab, new Map([['3/a.pdf', octetiText(a)]]))
      let cadeAdoptia = true
      // UPDATE-ul de adopție (doar seap_cod) cade o dată, ca o eroare tranzitorie de BD
      const supa = { ...baza, from: (t: string) => {
        const b0 = baza.from(t)
        if (t !== 'ofertare_documente_atribuire') return b0
        const upd = b0.update.bind(b0)
        b0.update = (p: Rand) => {
          if (cadeAdoptia && p && Object.keys(p).length === 1 && 'seap_cod' in p) {
            const err: any = { eq: () => err, is: () => err, select: () => err, then: (res: any, rej: any) => Promise.resolve({ data: null, error: { message: 'simulat: BD indisponibilă' } }).then(res, rej) }
            return err
          }
          return upd(p)
        }
        return b0
      } }
      await s.aduLicitatie(supa, 3, () => {})
      const ev1 = tab.ofertare_seap_fisiere.find(e => e.nume_seap === 'Anexa 1 (CN1-00001).pdf')
      eq([ev1?.stare, ev1?.etapa, tab.ofertare_documente_atribuire[0].seap_cod], ['eroare', 'cod', undefined], JSON.stringify(tab.ofertare_seap_fisiere))
      cadeAdoptia = false
      await s.aduLicitatie(supa, 3, () => {})
      eq(tab.ofertare_documente_atribuire.find(d => d.id === 10)?.seap_cod, 'CN1/00001', 'reluarea adoptă codul')
      ok(!tab.ofertare_seap_fisiere.some(e => e.stare === 'eroare' || e.stare === 'identificat'), JSON.stringify(tab.ofertare_seap_fisiere))
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, Copilot r2): evidența „ok” a lui N (C10) cu sha egal pe un document FĂRĂ legătură (M.pdf) nu ține deoparte C10', async () => {
  await cuMediu(async (_root, s) => {
    const S = '%PDF-1.4 octeti S'
    const { restore } = cuSeapCod([{ nume: 'N.pdf', cod: 'CN1/00010', buf: S }])
    try {
      const tab = licSeap({
        ofertare_documente_atribuire: [
          { id: 10, licitatie_id: 3, nume_original: 'N.pdf', fisier_path: '3/n.pdf', size_bytes: 3, seap_cod: 'CN1/00005', status_procesare: 'procesat' },
          { id: 11, licitatie_id: 3, nume_original: 'M.pdf', fisier_path: '3/m.pdf', size_bytes: S.length, status_procesare: 'procesat' },
        ],
        ofertare_seap_manifest: [{ licitatie_id: 3, arhiva_cheie: 'm.pdf', cale: 'M.pdf', marime: S.length, sha256: await shaHex(S), document_id: 11, stare: 'urcat', motiv: null }],
        ofertare_seap_fisiere: [{ id: 900, licitatie_id: 3, nume_seap: 'N (CN1-00010).pdf', cheie: s.cheieEvidenta('N (CN1-00010).pdf'), stare: 'ok', sha256: await shaHex(S), incercari: 1 }],
      })
      await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      ok(tab.ofertare_documente_atribuire.some(d => d.seap_cod === 'CN1/00010'), JSON.stringify(tab.ofertare_documente_atribuire.map(d => [d.nume_original, d.seap_cod])))
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, Jakarinos r8): evidența „ok” de pe numele simplu „N.pdf” (documentul vechi redenumit M.pdf) nu ascunde codul nou /20', async () => {
  await cuMediu(async (_root, s) => {
    const A = '%PDF-1.4 vechi A', B = '%PDF-1.4 nou B'
    const { restore } = cuSeapCod([{ nume: 'N.pdf', cod: 'CN1/00020', buf: B }])
    try {
      const tab = licSeap({
        ofertare_documente_atribuire: [{ id: 11, licitatie_id: 3, nume_original: 'M.pdf', fisier_path: '3/m.pdf', size_bytes: A.length, seap_cod: 'CN1/00010', status_procesare: 'procesat' }],
        ofertare_seap_manifest: [{ licitatie_id: 3, arhiva_cheie: 'n.pdf', cale: 'N.pdf', marime: A.length, sha256: await shaHex(A), document_id: 11, stare: 'urcat', motiv: null }],
        ofertare_seap_fisiere: [{ id: 900, licitatie_id: 3, nume_seap: 'N.pdf', cheie: s.cheieEvidenta('N.pdf'), stare: 'ok', sha256: await shaHex(A), incercari: 1 }],
      })
      await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      const n = tab.ofertare_documente_atribuire.find(d => d.seap_cod === 'CN1/00020')
      eq(n?.nume_original, 'N.pdf', JSON.stringify(tab.ofertare_documente_atribuire.map(d => [d.nume_original, d.seap_cod])))
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, Copilot r3): eroare istorică cu reîncercări epuizate pe numele simplu „N.pdf” nu blochează codul nou decis „nou”', async () => {
  await cuMediu(async (_root, s) => {
    const { restore } = cuSeapCod([{ nume: 'N.pdf', cod: 'CN1/00020', buf: '%PDF-1.4 C20' }])
    try {
      const tab = licSeap({ ofertare_seap_fisiere: [{ id: 900, licitatie_id: 3, nume_seap: 'N.pdf', cheie: s.cheieEvidenta('N.pdf'), stare: 'eroare', etapa: 'descarcare', incercari: 3 }] })
      const rap = await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      eq([tab.ofertare_documente_atribuire.map(d => [d.nume_original, d.seap_cod]), rap.sarite], [[['N.pdf', 'CN1/00020']], 0])
      eq([tab.ofertare_seap_fisiere[0].stare, tab.ofertare_seap_fisiere[0].incercari], ['ok', 0])
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, Jakarinos r9): fratele identic reverificat — 500 → ok → 500 → ok → 500 nu epuizează reîncercările; la revenire se închide „ok”, fără upload', async () => {
  await cuMediu(async (_root, s) => {
    const X = '%PDF-1.4 continut X'
    const lista: { nume: string; cod?: string; buf: string | null }[] = [{ nume: 'N.pdf', cod: 'CN1/00010', buf: X }, { nume: 'N.pdf', cod: 'CN1/00020', buf: null }]
    const { restore } = cuSeapCod(lista)
    try {
      const tab = licSeap({
        ofertare_documente_atribuire: [{ id: 10, licitatie_id: 3, nume_original: 'N.pdf', fisier_path: '3/n.pdf', size_bytes: X.length, seap_cod: 'CN1/00010', status_procesare: 'procesat' }],
        ofertare_seap_manifest: [{ licitatie_id: 3, arhiva_cheie: 'n.pdf', cale: 'N.pdf', marime: X.length, sha256: await shaHex(X), document_id: 10, stare: 'urcat', motiv: null }],
      })
      const supa = fakeSupa(tab, new Map())
      const ev = () => tab.ofertare_seap_fisiere.find(e => e.nume_seap === 'N (CN1-00020).pdf')
      for (const [k, cade] of [true, false, true, false, true, false].entries()) {
        lista[1].buf = cade ? null : X
        await s.aduLicitatie(supa, 3, () => {})
        eq(ev()?.stare, cade ? 'eroare' : 'ok', `rularea ${k + 1}`)
      }
      eq(tab.ofertare_documente_atribuire.length, 1, 'fratele identic nu se urcă niciodată')
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, Jakarinos r10): un cod nou („nou” pe N.pdf) care cade mereu se oprește la plafon; un ALT cod pe același nume se reia', async () => {
  await cuMediu(async (_root, s) => {
    const lista: { nume: string; cod?: string; buf: string | null }[] = [{ nume: 'N.pdf', cod: 'CN1/00020', buf: null }]
    const { descarcate, restore } = cuSeapCod(lista)
    try {
      const tab = licSeap()
      const supa = fakeSupa(tab, new Map())
      for (let k = 1; k <= 3; k++) await s.aduLicitatie(supa, 3, () => {})
      eq(descarcate.length, 3, 'trei încercări')
      const r4 = await s.aduLicitatie(supa, 3, () => {})
      eq([descarcate.length, r4.sarite], [3, 1], 'a patra rulare: plafon atins, fără descărcare')
      eq(tab.ofertare_seap_fisiere.map(e => [e.nume_seap, e.stare, e.incercari]), [['N (CN1-00020).pdf', 'eroare', 3]])
      lista[0] = { nume: 'N.pdf', cod: 'CN1/00030', buf: '%PDF-1.4 C30' }   // alt cod pe același nume: altă identitate, alt istoric
      await s.aduLicitatie(supa, 3, () => {})
      eq(tab.ofertare_documente_atribuire.map(d => [d.nume_original, d.seap_cod]), [['N.pdf', 'CN1/00030']])
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, Jakarinos r11): semnătura „X.pdf.p7s” căzută cât era singură, apoi listată lângă „X.pdf” → evidența ei pe cod se închide „sarit”', async () => {
  await cuMediu(async (_root, s) => {
    const lista: { nume: string; cod?: string; buf: string | null }[] = [{ nume: 'X.pdf.p7s', cod: 'CN1/00001', buf: null }]
    const { restore } = cuSeapCod(lista)
    try {
      const tab = licSeap()
      const supa = fakeSupa(tab, new Map())
      await s.aduLicitatie(supa, 3, () => {})
      eq(tab.ofertare_seap_fisiere.map(e => [e.nume_seap, e.stare]), [['X (CN1-00001).pdf.p7s', 'eroare']], 'singură: decisă „nou”, căzută')
      lista.push({ nume: 'X.pdf', cod: 'CN1/00002', buf: '%PDF-1.4 X' })
      const r2 = await s.aduLicitatie(supa, 3, () => {})
      eq(tab.ofertare_documente_atribuire.map(d => [d.nume_original, d.seap_cod]), [['X.pdf', 'CN1/00002']], JSON.stringify(r2.erori))
      eq(tab.ofertare_seap_fisiere.map(e => [e.nume_seap, e.stare]).sort(), [['X (CN1-00001).pdf.p7s', 'sarit'], ['X (CN1-00002).pdf', 'ok']])
      // și din „în curs” (job mort după etapa 1)
      const tab2 = licSeap({ ofertare_seap_fisiere: [{ id: 901, licitatie_id: 3, nume_seap: 'Y (CN1-00003).pdf.p7s', cheie: s.cheieCod('CN1/00003'), stare: 'identificat', incercari: 0 }] })
      lista.length = 0
      lista.push({ nume: 'Y.pdf.p7s', cod: 'CN1/00003', buf: null }, { nume: 'Y.pdf', cod: 'CN1/00004', buf: '%PDF-1.4 Y' })
      await s.aduLicitatie(fakeSupa(tab2, new Map()), 3, () => {})
      eq(tab2.ofertare_seap_fisiere.find(e => e.id === 901)?.stare, 'sarit')
      ok(!tab2.ofertare_seap_fisiere.some(e => e.stare === 'eroare' || e.stare === 'identificat'), JSON.stringify(tab2.ofertare_seap_fisiere))
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, Jakarinos r12–r14, Copilot r7–r8): evidența codului stă pe cheia CODULUI — se închide când codul e prezent sub orice nume; evidențele brute cu „(COD)” în nume nu sunt atinse', async () => {
  await cuMediu(async (_root, s) => {
    const M = { nume: 'M.pdf', cod: 'CN1/00001', buf: '%PDF-1.4 M' }
    const cazuri: [{ nume: string; cod?: string; buf: string | null }[], string[]][] = [
      // N „sari / dublu” lângă M (Jakarinos r12); evidența BRUTĂ „N (CN1-00001).pdf” (document fără cod, numit literal așa — Copilot r8
      // ABA) nu e a codului → rămâne
      [[M, { nume: 'N.pdf', cod: 'CN1/00001', buf: '%PDF-1.4 M' }], ['ok', 'eroare', 'eroare', 'eroare']],
      // N nu mai e listat, codul e listat doar ca M (redenumit): cheia e a codului → se închide (Jakarinos r12, primul scenariu)
      [[M], ['ok', 'eroare', 'eroare', 'eroare']],
      // Jakarinos r13: document listat al cărui NUME conține „(CN1-00001)”, cu alt cod (/00002), căzut la plafon; Copilot r7: arhivă
      // numită literal „Plan (CN1-00001).zip”, căzută — niciuna nu e evidența codului /00001
      [[M, { nume: 'N (CN1-00001).pdf', cod: 'CN1/00002', buf: null }, { nume: 'Plan (CN1-00001).zip', buf: null }], ['ok', 'eroare', 'eroare', 'eroare']],
    ]
    for (const [lista, asteptat] of cazuri) {
      const { descarcate, restore } = cuSeapCod(lista)
      try {
        const ev = (id: number, nume: string, cheie: string) => ({ id, licitatie_id: 3, nume_seap: nume, cheie, stare: 'eroare', incercari: 3, etapa: 'descarcare' })
        const tab = licSeap({
          ofertare_documente_atribuire: [{ id: 7, licitatie_id: 3, nume_original: 'M.pdf', fisier_path: '3/m.pdf', size_bytes: 10, seap_cod: 'CN1/00001', status_procesare: 'procesat' }],
          ofertare_seap_fisiere: [ev(900, 'N (CN1-00001).pdf', s.cheieCod('CN1/00001')), ev(901, 'N (CN1-00001).pdf', s.cheieEvidenta('N (CN1-00001).pdf')),
            ev(902, 'N (CN1-00001) (CN1-00002).pdf', s.cheieCod('CN1/00002')), ev(903, 'Plan (CN1-00001).zip', s.cheieEvidenta('Plan (CN1-00001).zip'))],
        })
        const rap = await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
        eq([descarcate, tab.ofertare_documente_atribuire.length], [[], 1], JSON.stringify(rap))
        eq(tab.ofertare_seap_fisiere.filter(e => e.id >= 900 && e.id <= 903).map(e => e.stare), asteptat, lista.map(d => d.nume).join(' + '))
      } finally { restore() }
    }
  })
})

Deno.test('cod SEAP (PR-2, Jakarinos r14): „N.pdf”/C1 deja în platformă și un document FĂRĂ cod numit literal „N (CN1-00001).pdf”, lipsă → al doilea se aduce (evidența lui brută nu e închisă de cod)', async () => {
  await cuMediu(async (_root, s) => {
    const { descarcate, restore } = cuSeapCod([{ nume: 'N.pdf', cod: 'CN1/00001', buf: '%PDF-1.4 N' }, { nume: 'N (CN1-00001).pdf', buf: '%PDF-1.4 alt document' }])
    try {
      const tab = licSeap({
        ofertare_documente_atribuire: [{ id: 7, licitatie_id: 3, nume_original: 'N.pdf', fisier_path: '3/n.pdf', size_bytes: 10, seap_cod: 'CN1/00001', status_procesare: 'procesat' }],
        ofertare_seap_fisiere: [{ id: 901, licitatie_id: 3, nume_seap: 'N (CN1-00001).pdf', cheie: s.cheieEvidenta('N (CN1-00001).pdf'), stare: 'eroare', incercari: 1, etapa: 'descarcare' }],
      })
      const rap = await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      eq(descarcate, ['N (CN1-00001).pdf'], JSON.stringify(rap))
      eq(tab.ofertare_documente_atribuire.map(d => [d.nume_original, d.seap_cod ?? null]), [['N.pdf', 'CN1/00001'], ['N (CN1-00001).pdf', null]])
      eq(tab.ofertare_seap_fisiere.find(e => e.id === 901)?.stare, 'ok', 'închisă de urcarea documentului ei, nu de cod')
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, Copilot r9): C10 căzut de 3 ori, ieșit din listă („sarit”), reapărut → seria de eșecuri pornește de la 0 (un 500 după reapariție nu-l plafonează)', async () => {
  await cuMediu(async (_root, s) => {
    const lista: { nume: string; cod?: string; buf: string | null }[] = [{ nume: 'N.pdf', cod: 'CN1/00010', buf: null }]
    const { descarcate, restore } = cuSeapCod(lista)
    try {
      const tab = licSeap()
      const supa = fakeSupa(tab, new Map())
      const ev = () => tab.ofertare_seap_fisiere.find(e => e.cheie === s.cheieCod('CN1/00010'))
      for (let k = 1; k <= 3; k++) await s.aduLicitatie(supa, 3, () => {})
      eq([ev()?.stare, ev()?.incercari], ['eroare', 3], 'trei eșecuri')
      lista[0] = { nume: 'N.pdf', cod: 'CN1/00020', buf: '%PDF-1.4 C20' }
      await s.aduLicitatie(supa, 3, () => {})
      eq([ev()?.stare, ev()?.incercari], ['sarit', 0], 'C10 ieșit din listă: seria se rupe')
      lista[0] = { nume: 'N.pdf', cod: 'CN1/00010', buf: null }   // reapare, prima încercare cade
      await s.aduLicitatie(supa, 3, () => {})
      eq([ev()?.stare, ev()?.incercari], ['eroare', 1])
      lista[0] = { nume: 'N.pdf', cod: 'CN1/00010', buf: '%PDF-1.4 C10 revine' }
      descarcate.length = 0
      await s.aduLicitatie(supa, 3, () => {})
      eq(descarcate, ['N.pdf'], 'încă eligibil (1 < 3)')
      ok(tab.ofertare_documente_atribuire.some(d => d.seap_cod === 'CN1/00010'), JSON.stringify(tab.ofertare_documente_atribuire.map(d => [d.nume_original, d.seap_cod])))
      eq(ev()?.stare, 'ok')
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, Jakarinos r15): fratele „N (CN1-00002).pdf” al lui N.pdf/C2 și un document FĂRĂ cod numit literal așa → fără amestec de octeți; fratele rămâne eroare vizibilă (ambele ordini, și la rerulare)', async () => {
  await cuMediu(async (_root, s) => {
    const N1 = { nume: 'N.pdf', cod: 'CN1/00001', buf: '%PDF-1.4 alpha' }, N2 = { nume: 'N.pdf', cod: 'CN1/00002', buf: '%PDF-1.4 charlie' }
    const L = { nume: 'N (CN1-00002).pdf', buf: '%PDF-1.4 BRAVO' }
    for (const lista of [[N1, N2, L], [N1, L, N2]]) {
      const { descarcate, restore } = cuSeapCod(lista)
      try {
        const tab = licSeap(), fisiere = new Map<string, Uint8Array>()
        const supa = fakeSupa(tab, fisiere)
        const text = (d: any) => new TextDecoder().decode(fisiere.get(d.fisier_path))
        const stareRanduri = () => tab.ofertare_documente_atribuire.map(d => [d.nume_original, d.seap_cod ?? null, text(d)]).sort()
        const rap = await s.aduLicitatie(supa, 3, () => {})
        const asteptat = [['N (CN1-00002).pdf', null, '%PDF-1.4 BRAVO'], ['N.pdf', 'CN1/00001', '%PDF-1.4 alpha']]
        eq(stareRanduri(), asteptat, lista.map(d => d.nume).join(' + '))
        ok(!descarcate.includes('N.pdf') || descarcate.filter(n => n === 'N.pdf').length === 1, `C2 nu se descarcă: ${JSON.stringify(descarcate)}`)
        const ev2 = () => tab.ofertare_seap_fisiere.find(e => e.cheie === s.cheieCod('CN1/00002'))
        eq([ev2()?.stare, ev2()?.etapa, ev2()?.incercari ?? 0], ['eroare', 'identitate', 0])
        ok(rap.erori.some((e: string) => /CN1\/00002.*numele țintă „N \(CN1-00002\)\.pdf”/.test(e)), JSON.stringify(rap.erori))
        // manifestul nu leagă numele comun de octeții altui document
        for (const m of tab.ofertare_seap_manifest ?? []) {
          const d = tab.ofertare_documente_atribuire.find(x => x.id === m.document_id)
          if (d) eq(m.sha256, await shaHex(text(d)), `manifest ${m.cale}`)
        }
        descarcate.length = 0
        await s.aduLicitatie(supa, 3, () => {})
        eq([stareRanduri(), descarcate, ev2()?.stare], [asteptat, [], 'eroare'], 'rerulare: nimic nou, fratele tot eroare')
      } finally { restore() }
    }
  })
})

Deno.test('cod SEAP (PR-2, Jakarinos r16): .p7m — fratele „N (CN1-00002).pdf.p7m” se urcă „N (CN1-00002) (semnat).pdf”, nume al unui document FĂRĂ cod listat → conflict pe numele DESFĂCUT, fără suprascrierea dovezii (ambele ordini)', async () => {
  await cuMediu(async (_root, s) => {
    const enc = (t: string) => new TextEncoder().encode(t)
    const A = { nume: 'N.pdf.p7m', cod: 'CN1/00001', buf: await semneazaCms(enc('%PDF-1.4 alpha')) }
    const C = { nume: 'N.pdf.p7m', cod: 'CN1/00002', buf: await semneazaCms(enc('%PDF-1.4 charlie')) }
    const B = { nume: 'N (CN1-00002) (semnat).pdf', buf: enc('%PDF-1.4 BRAVO') }
    for (const lista of [[A, C, B], [A, B, C]]) {
      const { restore } = cuSeapCod(lista)
      try {
        const tab = licSeap(), fisiere = new Map<string, Uint8Array>()
        const text = (d: any) => new TextDecoder().decode(fisiere.get(d.fisier_path))
        const rap = await s.aduLicitatie(fakeSupa(tab, fisiere), 3, () => {})
        eq(tab.ofertare_documente_atribuire.map(d => [d.nume_original, d.seap_cod ?? null, text(d)]).sort(),
          [['N (CN1-00002) (semnat).pdf', null, '%PDF-1.4 BRAVO'], ['N (semnat).pdf', 'CN1/00001', '%PDF-1.4 alpha']], lista.map(d => d.nume).join(' + '))
        const ev2 = tab.ofertare_seap_fisiere.find(e => e.cheie === s.cheieCod('CN1/00002'))
        eq([ev2?.stare, ev2?.etapa], ['eroare', 'identitate'], JSON.stringify(rap.erori))
        for (const m of tab.ofertare_seap_manifest ?? []) {
          const d = tab.ofertare_documente_atribuire.find(x => x.id === m.document_id)
          if (d) eq(m.sha256, await shaHex(text(d)), `manifest ${m.cale}`)
        }
      } finally { restore() }
    }
  })
})

Deno.test('cod SEAP (PR-2, Jakarinos r17): aceeași pereche „N.pdf.p7m”/C1 listată de două ori + rândul desfăcut „N (semnat).pdf” fără cod → adoptat, nu conflict', async () => {
  await cuMediu(async (_root, s) => {
    const buf = await semneazaCms(new TextEncoder().encode('%PDF-1.4 alpha'))
    const { descarcate, restore } = cuSeapCod([{ nume: 'N.pdf.p7m', cod: 'CN1/00001', buf }, { nume: 'N.pdf.p7m', cod: 'CN1/00001', buf }])
    try {
      const tab = licSeap({ ofertare_documente_atribuire: [{ id: 7, licitatie_id: 3, nume_original: 'N (semnat).pdf', fisier_path: '3/n.pdf', size_bytes: 14, status_procesare: 'procesat' }] })
      const rap = await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      eq([tab.ofertare_documente_atribuire.map(d => [d.nume_original, d.seap_cod]), descarcate, rap.erori], [[['N (semnat).pdf', 'CN1/00001']], [], []])
      ok(!tab.ofertare_seap_fisiere.some(e => e.stare === 'eroare'), JSON.stringify(tab.ofertare_seap_fisiere))
    } finally { restore() }
  })
})

Deno.test('cod SEAP (PR-2, varianta A): o arhivă rămâne pe regula după nume — evidența „ok” a despachetării o ține deoparte, oricare ar fi codul', async () => {
  await cuMediu(async (_root, s) => {
    const { descarcate, restore } = cuSeapCod([{ nume: 'PT.zip', cod: 'CN1/00030', buf: '%PDF-1.4 nu se cere' }])
    try {
      const tab = licSeap({ ofertare_seap_fisiere: [{ id: 900, licitatie_id: 3, nume_seap: 'PT.zip', cheie: s.cheieEvidenta('PT.zip'), stare: 'ok', fisiere_extrase: 4, incercari: 1 }] })
      const rap = await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      eq([descarcate, rap.deja, tab.ofertare_documente_atribuire.length], [[], 1, 0])
    } finally { restore() }
  })
})

// -- .p7m (07.10.2026): același CMS atașat ca .p7s — lic. 92 avea răspunsuri „….rar.p7m” care stăteau „neprocesat” la nesfârșit
async function semneazaCms(continut: Uint8Array, detasat = false): Promise<Uint8Array> {   // semnătură CMS (implicit ATAȘATĂ: conținutul în interior), cert de test
  const d = await Deno.makeTempDir()
  const run = async (args: string[]) => { const o = await new Deno.Command('openssl', { args, cwd: d, stdout: 'null', stderr: 'piped' }).output(); ok(o.code === 0, `openssl ${args[0]}: ${new TextDecoder().decode(o.stderr)}`) }
  await Deno.writeFile(`${d}/in.bin`, continut)
  await run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'k.pem', '-out', 'c.pem', '-days', '1', '-subj', '/CN=test'])
  await run(['cms', '-sign', '-binary', ...(detasat ? [] : ['-nodetach']), '-in', 'in.bin', '-signer', 'c.pem', '-inkey', 'k.pem', '-outform', 'DER', '-out', 'out.p7m'])
  const buf = await Deno.readFile(`${d}/out.p7m`)
  await Deno.remove(d, { recursive: true })
  return buf
}

Deno.test('arhive: „….zip.p7m” (semnătură CMS atașată) e selectată, desfăcută din semnătură și despachetată', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    try {
      ok(s.eArhivaDeDespachetat({ nume_original: 'Raspuns consolidat.zip.p7m', fisier_path: '92/x', status_procesare: 'neprocesat', eroare: null }), '.zip.p7m e arhivă de despachetat')
      ok(s.FILTRU_NUME_ARHIVA.includes('.rar.p7m'), 'filtrul de pe server include .rar.p7m')
      ok(s.semnaturaDeDesfacut('X.rar.p7m') && s.semnaturaDeDesfacut('X.part1.rar.P7M') && s.semnaturaDeDesfacut('Caiet.pdf.p7s'), '.p7s oricând, .p7m pe arhive')
      ok(s.semnaturaDeDesfacut('Caiet.pdf.p7m') && s.semnaturaDeDesfacut('Formulare.docx.p7m'), 'și documentele .p7m se desfac (var. B, 07.10.2026 seara)')
      ok(s.cheieNume('X.rar.p7m') !== s.cheieNume('X.rar'), 'cheia păstrează .p7m: „X.rar.p7m” nu se confundă cu „X.rar”')
      const fisiere = new Map<string, Uint8Array>([['92/r.p7m', await semneazaCms(await zipCu({ 'Raspuns.pdf': '%PDF-1.4 r', 'Anexa.docx': 'x' }))]])
      const tab: Record<string, Rand[]> = { ofertare_documente_atribuire: [
        { id: 520, licitatie_id: 92, nume_original: 'Raspuns consolidat.zip.p7m', fisier_path: '92/r.p7m', status_procesare: 'neprocesat', eroare: null, tip: 'raspuns_clarificare', aparut_ulterior: true },
      ], ofertare_licitatii: [], notifications: [] }
      await s.despacheteazaArhiveDinPlatforma(fakeSupa(tab, fisiere), () => {})
      const d = tab.ofertare_documente_atribuire
      ok(/^📦 Arhivă despachetată pe Terra: 2 fișiere noi/.test(d.find(x => x.id === 520)!.eroare), d.find(x => x.id === 520)!.eroare)
      eq(d.filter(x => x.id !== 520).map(x => x.nume_original).sort(), ['Raspuns consolidat (#520)/Anexa.docx', 'Raspuns consolidat (#520)/Raspuns.pdf'])
    } finally { await opreste() }
  })
})

Deno.test('arhive: „….zip.p7m” cu semnătură DETAȘATĂ (fără conținut) → eroare vizibilă, nimic extras, nu se reia singur', async () => {
  await cuMediu(async (_root, s) => {
    const fisiere = new Map<string, Uint8Array>([['92/d.p7m', await semneazaCms(await zipCu({ 'Raspuns.pdf': '%PDF-1.4 r' }), true)]])
    const tab: Record<string, Rand[]> = { ofertare_documente_atribuire: [
      { id: 521, licitatie_id: 92, nume_original: 'Raspuns.zip.p7m', fisier_path: '92/d.p7m', status_procesare: 'neprocesat', eroare: null, tip: 'raspuns_clarificare', aparut_ulterior: true },
    ], ofertare_licitatii: [], notifications: [] }
    await s.despacheteazaArhiveDinPlatforma(fakeSupa(tab, fisiere), () => {})
    const d = tab.ofertare_documente_atribuire
    eq(d.length, 1, 'nimic extras')
    ok(/^Despachetare eșuată \(semnătura CMS/.test(d[0].eroare), d[0].eroare)
    ok(!s.eArhivaDeDespachetat(d[0]), 'are notă → nu se reia singur')
  })
})

// -- drumul SEAP, var. B (decizia Răzvan 07.10.2026 seara): documentul .p7m se desface sub „X (semnat).ext” ----------------
Deno.test('drumul SEAP: „Caiet.pdf.p7m” lângă „Caiet.pdf” → ambele rămân: .p7m desfăcut ca „Caiet (semnat).pdf”, nu ia locul PDF-ului', async () => {
  const real = '%PDF-1.4 caietul real'
  for (const ordine of ['p7m,pdf', 'pdf,p7m']) {
    await cuMediu(async (root, s) => {
      const opreste = pornesteExtractor(root)
      const p7m = await semneazaCms(new TextEncoder().encode(real))
      const docs: Record<string, Uint8Array> = ordine === 'p7m,pdf'
        ? { 'Caiet.pdf.p7m': p7m, 'Caiet.pdf': new TextEncoder().encode(real) }
        : { 'Caiet.pdf': new TextEncoder().encode(real), 'Caiet.pdf.p7m': p7m }
      const restore = cuSeap(docs)
      try {
        const tab = licSeap()
        const rap = await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
        eq(tab.ofertare_documente_atribuire.map(d => [d.nume_original, d.size_bytes, d.status_procesare]).sort(), [['Caiet (semnat).pdf', real.length, 'neprocesat'], ['Caiet.pdf', real.length, 'neprocesat']], `ordinea ${ordine}`)
        ok(p7m.length > real.length, 'conținutul desfăcut, nu containerul')
        eq(rap.erori, [], `ordinea ${ordine}`)
      } finally { restore(); await opreste() }
    })
  }
})

Deno.test('drumul SEAP: „Raspuns.zip” deja în platformă + „Raspuns.zip.p7m” pe SEAP cu ALT conținut → descărcat, desfăcut, fișierele urcate (nu sărit pe nume)', async () => {
  // Copilot conv. 3, NO-GO r2 pe #644: dedup-ul pe nume dinaintea descărcării nu are voie să sară arhiva semnată
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    const restore = cuSeap({ 'Raspuns.zip.p7m': await semneazaCms(await zipCu({ 'Raspuns nou.pdf': '%PDF-1.4 nou', 'Anexa.pdf': '%PDF-1.4 anexa' })) })
    try {
      const tab = licSeap({ ofertare_documente_atribuire: [
        { id: 10, licitatie_id: 3, nume_original: 'Raspuns.zip', fisier_path: '3/r.zip', size_bytes: 99, status_procesare: 'ignorat', tip: 'alta' },
      ] })
      const supa = fakeSupa(tab, new Map())
      const rap = await s.aduLicitatie(supa, 3, () => {})
      eq(rap.erori, [])
      eq(tab.ofertare_documente_atribuire.filter(d => d.id >= 5000).map(d => d.nume_original).sort(), ['Anexa.pdf', 'Raspuns nou.pdf'])
      eq(tab.ofertare_seap_fisiere.map(e => [e.cheie, e.stare, e.fisiere_extrase]), [[s.cheieNume('Raspuns.zip.p7m'), 'ok', 2]])
      ok(tab.ofertare_seap_manifest.every(m => m.arhiva_cheie === s.cheieNume('Raspuns.zip.p7m') && m.stare === 'urcat'), JSON.stringify(tab.ofertare_seap_manifest))
      const n = tab.ofertare_documente_atribuire.length
      tab.ofertare_seap_fisiere.length = 0   // reluare completă: același conținut dovedit (sha) → nimic dublat
      await s.aduLicitatie(supa, 3, () => {})
      eq(tab.ofertare_documente_atribuire.length, n, 'reluarea nu dublează')
    } finally { restore(); await opreste() }
  })
})

Deno.test('drumul SEAP: placeholder de veghe „Raspuns.zip.p7m” (documentația inițială, fără fișier) → arhiva adusă, desfăcută, placeholder-ul primește nota', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    const restore = cuSeap({ 'Raspuns.zip.p7m': await semneazaCms(await zipCu({ 'R1.pdf': '%PDF-1.4 r1', 'R2.pdf': '%PDF-1.4 r2' })) })
    try {
      const tab = licSeap({ ofertare_documente_atribuire: [   // exact ce scrie veghea pentru un document nou din documentația inițială
        { id: 30, licitatie_id: 3, nume_original: 'Raspuns.zip.p7m', fisier_path: '3/atribuire/neincarcat/Raspuns.zip.p7m', tip: 'alta', status_procesare: 'ignorat', sursa: 'seap', aparut_ulterior: true,
          eroare: 'Aparut nou in SEAP, dar nu a putut fi adus automat - urca-l din "Urca fisiere".' },
      ] })
      const rap = await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      eq(rap.erori, [])
      eq(tab.ofertare_documente_atribuire.filter(d => d.id >= 5000).map(d => d.nume_original).sort(), ['R1.pdf', 'R2.pdf'])
      ok(/^Arhivă adusă pe Terra: 2 fișiere în platformă\.$/.test(tab.ofertare_documente_atribuire.find(d => d.id === 30)!.eroare), tab.ofertare_documente_atribuire.find(d => d.id === 30)!.eroare)
    } finally { restore(); await opreste() }
  })
})

Deno.test('drumul SEAP: „….zip.p7m” cu semnătură DETAȘATĂ → eroare la semnătură, nimic urcat', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    const restore = cuSeap({ 'Raspuns.zip.p7m': await semneazaCms(await zipCu({ 'R.pdf': '%PDF-1.4 r' }), true) })
    try {
      const tab = licSeap()
      const rap = await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      eq(tab.ofertare_documente_atribuire.length, 0)
      eq(tab.ofertare_seap_fisiere.map(e => [e.stare, e.etapa]), [['eroare', 'semnatura']], JSON.stringify(rap.erori))
    } finally { restore(); await opreste() }
  })
})

// -- audit Jakarinos 07.10: #3 garda pe sha-ul arhivei, #5 dovada sha pentru fișierele importate anterior, #2 placeholder, #6, #7 --
Deno.test('arhive #3: republicare cu ALT conținut sub același nume (evidență „ok” veche) → despachetată, nu închisă cu notă falsă', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    try {
      const vechi = await zipCu({ 'Caiet.pdf': '%PDF-1.4 v1' }), nou = await zipCu({ 'Caiet.pdf': '%PDF-1.4 v2 revizuit' })
      const tab: Record<string, Rand[]> = {
        ofertare_documente_atribuire: [{ id: 80, licitatie_id: 3, nume_original: 'Documentatie.zip', fisier_path: '3/nou.zip', status_procesare: 'neprocesat', eroare: null, tip: 'raspuns_clarificare', seap_cod: 'SCN1/00021' }],
        ofertare_seap_fisiere: [{ licitatie_id: 3, cheie: 'documentatie.zip', stare: 'ok', fisiere_extrase: 1, sha256: await shaOcteti(vechi) }],
        ofertare_seap_manifest: [], ofertare_licitatii: [], notifications: [],
      }
      await s.despacheteazaArhiveDinPlatforma(fakeSupa(tab, new Map([['3/nou.zip', nou]])), () => {})
      const d = tab.ofertare_documente_atribuire
      ok(/^📦 Arhivă despachetată pe Terra: 1 fișiere noi/.test(d.find(x => x.id === 80)!.eroare), d.find(x => x.id === 80)!.eroare)
      eq(d.filter(x => x.id !== 80).map(x => x.nume_original), ['Documentatie (#80)/Caiet.pdf'])
      eq(await s.dejaDesfacutaPeSeap(fakeSupa(tab, new Map()), { licitatie_id: 3, nume_original: 'Documentatie.zip' }, await shaOcteti(vechi)), '1 fișiere, evidența drumului SEAP', 'același conținut → închisă')
      tab.ofertare_seap_fisiere[0].sha256 = null
      eq(await s.dejaDesfacutaPeSeap(fakeSupa(tab, new Map()), { licitatie_id: 3, nume_original: 'Documentatie.zip' }, await shaOcteti(vechi)), null, 'evidență fără sha = nedovedit')
    } finally { await opreste() }
  })
})

Deno.test('arhive #5: un rând de manifest fără dovadă (deja_in_platforma vechi) sau cu alt sha NU sare fișierul; dovada „urcat” cu același sha îl sare', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    try {
      const fisiere = new Map<string, Uint8Array>([['3/m.zip', await zipCu({ 'A.pdf': '%PDF-1.4 a', 'B.pdf': '%PDF-1.4 b nou', 'C.pdf': '%PDF-1.4 c' })]])
      const tab: Record<string, Rand[]> = {
        ofertare_documente_atribuire: [
          { id: 81, licitatie_id: 3, nume_original: 'M.zip', fisier_path: '3/m.zip', status_procesare: 'neprocesat', eroare: null },
          { id: 910, licitatie_id: 3, nume_original: 'A.pdf', fisier_path: '3/a910.pdf', status_procesare: 'procesat', eroare: null },
        ],
        ofertare_seap_manifest: [
          { licitatie_id: 3, arhiva_cheie: 'm.zip', cale: 'A.pdf', document_id: 910, stare: 'urcat', sha256: await shaHex('%PDF-1.4 a') },              // dovedit, același → sărit
          { licitatie_id: 3, arhiva_cheie: 'm.zip', cale: 'B.pdf', document_id: 911, stare: 'urcat', sha256: await shaHex('%PDF-1.4 b vechi') },        // dovedit, ALT conținut → urcat
          { licitatie_id: 3, arhiva_cheie: 'm.zip', cale: 'C.pdf', document_id: 912, stare: 'deja_in_platforma', sha256: await shaHex('%PDF-1.4 c') }, // scris de bugul vechi, 912 nedovedit → urcat
        ],
        ofertare_seap_fisiere: [], ofertare_licitatii: [], notifications: [],
      }
      await s.despacheteazaArhiveDinPlatforma(fakeSupa(tab, fisiere), () => {})
      const d = tab.ofertare_documente_atribuire
      eq(d.filter(x => x.id > 1000).map(x => x.nume_original).sort(), ['M (#81)/B.pdf', 'M (#81)/C.pdf'])
      ok(/2 fișiere noi.*1 existau deja/.test(d.find(x => x.id === 81)!.eroare), d.find(x => x.id === 81)!.eroare)
    } finally { await opreste() }
  })
})

Deno.test('drumul SEAP #2: placeholder „Anexa 1.pdf” + în arhivă „Anexa (1).pdf” și „Anexa 1.pdf” (aceeași cheie, alt conținut) → două rânduri, placeholder-ul completat o singură dată', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    const restore = cuSeap({ 'DOC.zip': await zipCu({ 'Anexa (1).pdf': '%PDF-1.4 unu', 'Anexa 1.pdf': '%PDF-1.4 doi' }) })
    try {
      const tab = licSeap({ ofertare_documente_atribuire: [
        { id: 40, licitatie_id: 3, nume_original: 'Anexa 1.pdf', fisier_path: '3/atribuire/neincarcat/Anexa_1.pdf', tip: 'alta', status_procesare: 'ignorat', eroare: 'Aparut nou in SEAP' },
      ] })
      const fis = new Map<string, Uint8Array>()
      const rap = await s.aduLicitatie(fakeSupa(tab, fis), 3, () => {})
      eq(rap.erori, [])
      const d = tab.ofertare_documente_atribuire
      eq(d.length, 2, JSON.stringify(d.map(x => [x.id, x.nume_original])))
      eq(d.filter(x => !String(x.fisier_path).includes('/neincarcat/')).length, 2, 'ambele fișiere au obiect propriu')
      eq(new Set(d.map(x => x.fisier_path)).size, 2, 'niciun rând nu a fost suprascris')
      ok(d.some(x => x.id === 40), 'placeholder-ul a fost completat (nu dublat)')
      for (const x of d) ok(fis.has(x.fisier_path), `obiectul ${x.fisier_path} există în Storage`)
    } finally { restore(); await opreste() }
  })
})

Deno.test('coada #6: 25 de cereri terminate mai vechi nu blochează o cerere nouă; cererea reînnoită în timpul procesării rămâne restantă', async () => {
  await cuMediu(async (_root, s) => {
    const vechi = Array.from({ length: 25 }, (_, i) => ({ licitatie_id: 100 + i, cerut_la: `2026-09-01T00:00:${String(i).padStart(2, '0')}Z`, terminat_la: '2026-09-02T00:00:00Z', sursa: 'reconciliere' }))
    const tab: Record<string, Rand[]> = {
      ofertare_seap_cereri: [...vechi, { licitatie_id: 7, cerut_la: '2026-10-07T10:00:00Z', terminat_la: null, sursa: 'om', cerut_de: null }],
      ofertare_licitatii: [{ id: 7, c_notice_id: null, sys_notice_type_id: null }],   // fără anunț legat: aduLicitatie se oprește repede, cu eroare în raport
      ofertare_documente_atribuire: [], notifications: [],
    }
    const supa = fakeSupa(tab, new Map())
    await s.proceseazaSeap(supa, () => false, () => {})
    const c7 = tab.ofertare_seap_cereri.find(c => c.licitatie_id === 7)!
    ok(c7.terminat_la && c7.preluat_la, `cererea nouă a fost preluată și închisă: ${JSON.stringify(c7)}`)
    ok(c7.raport?.erori?.[0]?.includes('anunț SEAP'), JSON.stringify(c7.raport))
    // cerere reînnoită în timp ce se procesa (cerut_la schimbat) → terminat_la nu se scrie, rămâne restantă
    Object.assign(c7, { terminat_la: null, cerut_la: '2026-10-07T11:00:00Z' })
    const supa2 = fakeSupa(tab, new Map())
    const fromVechi = supa2.from
    supa2.from = (t: string) => {
      const b = fromVechi(t)
      if (t === 'ofertare_seap_cereri') { const upd = b.update; b.update = (p: Rand) => { if ('preluat_la' in p) c7.cerut_la = '2026-10-07T12:00:00Z'; return upd(p) } }
      return b
    }
    await s.proceseazaSeap(supa2, () => false, () => {})
    eq(c7.terminat_la, null, 'cererea venită în timpul procesării nu e acoperită de terminat_la')
    ok(c7.raport, 'raportul rulării se păstrează')
  })
})

Deno.test('arhive #7: excepție după revendicare → arhiva închisă „eroare” cu motiv, nu rămâne „in_lucru”', async () => {
  await cuMediu(async (_root, s) => {
    const tab: Record<string, Rand[]> = {
      ofertare_documente_atribuire: [{ id: 82, licitatie_id: 3, nume_original: 'E.zip', fisier_path: '3/e.zip', status_procesare: 'neprocesat', eroare: null }],
      ofertare_seap_manifest: [], ofertare_seap_fisiere: [], ofertare_licitatii: [], notifications: [],
    }
    const supa = fakeSupa(tab, new Map())
    supa.storage.from = () => ({ download: async () => ({ data: { arrayBuffer: async () => { throw new Error('simulat: conexiune ruptă') } }, error: null }) }) as any
    await s.despacheteazaArhiveDinPlatforma(supa, () => {})
    const d = tab.ofertare_documente_atribuire[0]
    eq(d.status_procesare, 'eroare')
    ok(/^Despachetare eșuată \(excepție\): simulat: conexiune ruptă/.test(d.eroare), d.eroare)
  })
})

Deno.test('arhive #5 (Copilot r1 pe #646): dovada sha a unui document ȘTERS sau rămas placeholder nu sare fișierul — se urcă', async () => {
  for (const caz of ['sters', 'placeholder'] as const) {
    await cuMediu(async (root, s) => {
      const opreste = pornesteExtractor(root)
      try {
        const fisiere = new Map<string, Uint8Array>([['3/m.zip', await zipCu({ 'A.pdf': '%PDF-1.4 a' })]])
        const tab: Record<string, Rand[]> = {
          ofertare_documente_atribuire: [
            { id: 81, licitatie_id: 3, nume_original: 'M.zip', fisier_path: '3/m.zip', status_procesare: 'neprocesat', eroare: null },
            ...(caz === 'placeholder' ? [{ id: 910, licitatie_id: 3, nume_original: 'A.pdf', fisier_path: '3/atribuire/neincarcat/A.pdf', status_procesare: 'ignorat', eroare: 'Aparut nou in SEAP' }] : []),
          ],
          ofertare_seap_manifest: [{ licitatie_id: 3, arhiva_cheie: 'm.zip', cale: 'A.pdf', document_id: 910, stare: 'urcat', sha256: await shaHex('%PDF-1.4 a') }],
          ofertare_seap_fisiere: [], ofertare_licitatii: [], notifications: [],
        }
        await s.despacheteazaArhiveDinPlatforma(fakeSupa(tab, fisiere), () => {})
        const d = tab.ofertare_documente_atribuire
        eq(d.filter(x => x.id > 1000).map(x => x.nume_original), ['M (#81)/A.pdf'], `caz ${caz}`)
        ok(/^📦 Arhivă despachetată pe Terra: 1 fișiere noi/.test(d.find(x => x.id === 81)!.eroare), d.find(x => x.id === 81)!.eroare)
      } finally { await opreste() }
    })
  }
})

// -- var. B + audit Jakarinos #8 / #15 / #20 (07.10.2026 seara) ----------------------------------------------------------
async function cmsStricat(): Promise<Uint8Array> { return new TextEncoder().encode('nu e CMS si nici PDF') }

Deno.test('#8 drumul SEAP: copiii semnați din arhivă („Anexa.pdf.p7s”, „Caiet.pdf.p7m”) se desfac înainte de sha / nume / urcare', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    const anexa = '%PDF-1.4 anexa semnata', caiet = '%PDF-1.4 caiet semnat'
    const restore = cuSeap({ 'Doc.zip': await zipCu({
      'Anexa.pdf.p7s': await semneazaCms(new TextEncoder().encode(anexa)),
      'Caiet.pdf.p7m': await semneazaCms(new TextEncoder().encode(caiet)),
      'Stricat.pdf.p7s': await cmsStricat(),
    }) })
    try {
      const tab = licSeap()
      const rap = await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      eq(rap.erori, [])
      const d = tab.ofertare_documente_atribuire
      eq(d.map(x => [x.nume_original, x.size_bytes, x.status_procesare]).sort(), [
        ['Anexa.pdf', anexa.length, 'neprocesat'], ['Caiet (semnat).pdf', caiet.length, 'neprocesat'], ['Stricat.pdf.p7s', 20, 'ignorat'],
      ])
      ok(/^Semnătura electronică nu s-a putut desface/.test(d.find(x => x.nume_original === 'Stricat.pdf.p7s')!.eroare), 'nota #20, nu PDF fals')
      const m = tab.ofertare_seap_manifest.find(x => x.cale === 'Anexa.pdf.p7s')!
      eq([m.sha256, m.stare], [await shaHex(anexa), 'urcat'], 'manifestul: calea din arhivă, sha-ul conținutului desfăcut')
    } finally { restore(); await opreste() }
  })
})

Deno.test('#8 bucla de platformă: copilul semnat se desface; reluarea recunoaște și numele vechi, brut', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    try {
      const anexa = '%PDF-1.4 anexa'
      const fisiere = new Map<string, Uint8Array>([['3/a.zip', await zipCu({ 'Anexa.pdf.p7s': await semneazaCms(new TextEncoder().encode(anexa)), 'B.pdf': '%PDF-1.4 b' })]])
      const tab: Record<string, Rand[]> = { ofertare_documente_atribuire: [
        { id: 90, licitatie_id: 3, nume_original: 'Raspuns.zip', fisier_path: '3/a.zip', status_procesare: 'neprocesat', eroare: null, tip: 'raspuns_clarificare' },
        { id: 91, licitatie_id: 3, nume_original: 'Raspuns (#90)/B.pdf', fisier_path: '3/b', status_procesare: 'neprocesat', eroare: null, tip: 'alta' },
      ], ofertare_seap_fisiere: [], ofertare_seap_manifest: [], ofertare_licitatii: [], notifications: [] }
      await s.despacheteazaArhiveDinPlatforma(fakeSupa(tab, fisiere), () => {})
      const d = tab.ofertare_documente_atribuire
      ok(/^📦 Arhivă despachetată pe Terra: 1 fișiere noi.*1 existau deja/.test(d.find(x => x.id === 90)!.eroare), d.find(x => x.id === 90)!.eroare)
      const nou = d.find(x => x.nume_original === 'Raspuns (#90)/Anexa.pdf')!
      ok(nou && nou.size_bytes === anexa.length, JSON.stringify(d.map(x => x.nume_original)))
      // #15: dovada sha și pentru copiii buclei de platformă
      eq(tab.ofertare_seap_manifest.map(m => [m.arhiva_cheie, m.cale, m.document_id, m.stare]), [['raspuns (#90)', 'Anexa.pdf.p7s', nou.id, 'urcat']])
    } finally { await opreste() }
  })
})

Deno.test('documente semnate din platformă: „X.pdf.p7m” neprocesat → desfăcut PE LOC (același id), originalul semnat păstrat și legat', async () => {
  await cuMediu(async (_root, s) => {
    const real = '%PDF-1.4 caietul semnat'
    const fisiere = new Map<string, Uint8Array>([
      ['92/atribuire/c.p7m', await semneazaCms(new TextEncoder().encode(real))],
      ['92/atribuire/d.p7m', await semneazaCms(new TextEncoder().encode('%PDF-1.4 d'), true)],
      ['92/atribuire/f.p7m', await semneazaCms(new TextEncoder().encode('PK\u0003\u0004 docx'))],
    ])
    const tab: Record<string, Rand[]> = { ofertare_documente_atribuire: [
      { id: 327, licitatie_id: 92, nume_original: 'Caiet de sarcini.pdf.p7m', fisier_path: '92/atribuire/c.p7m', status_procesare: 'neprocesat', eroare: null, tip: 'cs_volum', seap_meta: null },
      { id: 328, licitatie_id: 92, nume_original: 'Detasat.pdf.p7m', fisier_path: '92/atribuire/d.p7m', status_procesare: 'neprocesat', eroare: null, tip: 'alta', seap_meta: null },
      { id: 323, licitatie_id: 92, nume_original: 'Formular.docx.p7m', fisier_path: '92/atribuire/f.p7m', status_procesare: 'neprocesat', eroare: null, tip: 'formular', seap_meta: { x: 1 } },
      { id: 324, licitatie_id: 92, nume_original: 'Formulare.doc.p7m', fisier_path: '92/atribuire/g.p7m', status_procesare: 'ignorat', eroare: 'non-PDF - ramane ca fisier', tip: 'formular' },
      { id: 400, licitatie_id: 92, nume_original: 'Arhiva.rar.p7m', fisier_path: '92/atribuire/r.p7m', status_procesare: 'neprocesat', eroare: null, tip: 'alta' },
    ], egress_jurnal: [] }
    ok(!s.eSemnatDeDesfacut(tab.ofertare_documente_atribuire[4]), 'arhivele semnate le ia bucla de arhive')
    await s.desfaSemnateDinPlatforma(fakeSupa(tab, fisiere), () => {})
    const d = (id: number) => tab.ofertare_documente_atribuire.find(x => x.id === id)!
    eq([d(327).nume_original, d(327).status_procesare, d(327).eroare, d(327).size_bytes, d(327).tip], ['Caiet de sarcini (semnat).pdf', 'neprocesat', null, real.length, 'cs_volum'])
    eq(d(327).seap_meta.semnat.path, '92/atribuire/c.p7m')
    ok(fisiere.has('92/atribuire/c.p7m'), 'originalul semnat rămâne în Storage')
    eq(new TextDecoder().decode(fisiere.get(d(327).fisier_path)), real)
    eq([d(328).nume_original, d(328).status_procesare], ['Detasat.pdf.p7m', 'ignorat'])
    ok(/^Doar semnătura electronică/.test(d(328).eroare), d(328).eroare)
    eq([d(323).nume_original, d(323).status_procesare, d(323).seap_meta.x], ['Formular (semnat).docx', 'ignorat', 1])
    eq([d(324).nume_original, d(324).status_procesare], ['Formulare.doc.p7m', 'ignorat'], 'cu notă → neatins (repararea cere OK-ul omului)')
    eq(d(400).status_procesare, 'neprocesat')
    eq(tab.egress_jurnal.map(j => j.p_sursa), ['nas:semnate', 'nas:semnate', 'nas:semnate'])
  })
})

Deno.test('documente semnate: numele desfăcut ocupat de alt rând → „(#id)”, fără suprascriere', async () => {
  await cuMediu(async (_root, s) => {
    const fisiere = new Map<string, Uint8Array>([['3/c.p7m', await semneazaCms(new TextEncoder().encode('%PDF-1.4 a'))]])
    const tab: Record<string, Rand[]> = { ofertare_documente_atribuire: [
      { id: 50, licitatie_id: 3, nume_original: 'Caiet (semnat).pdf', fisier_path: '3/vechi.pdf', status_procesare: 'procesat', eroare: null },
      { id: 51, licitatie_id: 3, nume_original: 'Caiet.pdf.p7m', fisier_path: '3/c.p7m', status_procesare: 'neprocesat', eroare: null, seap_meta: null },
    ] }
    await s.desfaSemnateDinPlatforma(fakeSupa(tab, fisiere), () => {})
    eq(tab.ofertare_documente_atribuire.map(x => x.nume_original), ['Caiet (semnat).pdf', 'Caiet (semnat) (#51).pdf'])
  })
})

Deno.test('var. B drumul SEAP: placeholder-ul veghei „X.pdf.p7m” se completează cu „X (semnat).pdf”; un „X.pdf.p7m” brut sau desfăcut nu se re-aduce', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    const restore = cuSeap({
      'Plansa.pdf.p7m': await semneazaCms(new TextEncoder().encode('%PDF-1.4 plansa')),
      'Brut.pdf.p7m': await semneazaCms(new TextEncoder().encode('%PDF-1.4 brut')),
      'Desfacut.pdf.p7m': await semneazaCms(new TextEncoder().encode('%PDF-1.4 desfacut')),
    })
    try {
      const tab = licSeap({ ofertare_documente_atribuire: [
        { id: 359, licitatie_id: 3, nume_original: 'Plansa.pdf.p7m', fisier_path: '3/atribuire/neincarcat/Plansa.pdf.p7m', tip: 'alta', status_procesare: 'ignorat', sursa: 'seap', aparut_ulterior: true, eroare: 'Aparut nou in SEAP...' },
        { id: 319, licitatie_id: 3, nume_original: 'Brut.pdf.p7m', fisier_path: '3/b.p7m', status_procesare: 'ignorat', tip: 'alta' },
        { id: 320, licitatie_id: 3, nume_original: 'Desfacut (semnat).pdf', fisier_path: '3/d.pdf', status_procesare: 'procesat', tip: 'alta' },
      ] })
      const rap = await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      eq([rap.erori, rap.deja, rap.fisiere_urcate], [[], 2, 1])
      eq(tab.ofertare_documente_atribuire.map(x => [x.id, x.nume_original]), [[359, 'Plansa (semnat).pdf'], [319, 'Brut.pdf.p7m'], [320, 'Desfacut (semnat).pdf']])
      // #15: fișierul simplu lasă dovada sha
      eq(tab.ofertare_seap_manifest.map(m => [m.cale, m.document_id, m.stare, m.sha256]), [['Plansa (semnat).pdf', 359, 'urcat', await shaHex('%PDF-1.4 plansa')]])
    } finally { restore(); await opreste() }
  })
})

Deno.test('#20 drumul SEAP: document semnat care nu se desface → urcat brut, sub numele lui, „ignorat” cu nota (nu PDF fals, nu eroare ciclică)', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    const restore = cuSeap({ 'Caiet.pdf.p7s': await cmsStricat(), 'Doar semnatura.pdf.p7m': await semneazaCms(new TextEncoder().encode('%PDF-1.4 x'), true) })
    try {
      const tab = licSeap()
      const rap = await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      eq(rap.erori, [])
      const d = tab.ofertare_documente_atribuire
      eq(d.map(x => [x.nume_original, x.status_procesare]).sort(), [['Caiet.pdf.p7s', 'ignorat'], ['Doar semnatura.pdf.p7m', 'ignorat']])
      ok(/^Semnătura electronică nu s-a putut desface/.test(d.find(x => x.nume_original === 'Caiet.pdf.p7s')!.eroare), 'nota eșec')
      ok(/^Doar semnătura electronică/.test(d.find(x => x.nume_original === 'Doar semnatura.pdf.p7m')!.eroare), 'nota detașat')
      eq(tab.ofertare_seap_fisiere.map(e => e.stare), ['ok', 'ok'], 'evidența: adus, nu eroare de reîncercat la nesfârșit')
    } finally { restore(); await opreste() }
  })
})

Deno.test('Copilot NO-GO r1 pe #649: un rând brut „Caiet.pdf.p7s” (semnătură detașată) NU ține pe loc documentul real „Caiet.pdf”', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    const real = '%PDF-1.4 caietul real'
    const restore = cuSeap({ 'Caiet.pdf': new TextEncoder().encode(real) })
    try {
      const tab = licSeap({ ofertare_documente_atribuire: [
        { id: 70, licitatie_id: 3, nume_original: 'Caiet.pdf.p7s', fisier_path: '3/c.p7s', status_procesare: 'ignorat', tip: 'alta', eroare: 'Doar semnătura electronică (detașată, fără conținut): documentul semnat e alt fișier. Rămâne ca fișier.' },
        { id: 71, licitatie_id: 3, nume_original: 'Caiet.pdf', fisier_path: '3/atribuire/neincarcat/Caiet.pdf', status_procesare: 'ignorat', tip: 'alta', eroare: 'Aparut nou in SEAP...' },
      ] })
      const rap = await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
      eq([rap.erori, rap.deja, rap.fisiere_urcate], [[], 0, 1])
      const d = tab.ofertare_documente_atribuire.find(x => x.id === 71)!
      eq([d.nume_original, d.size_bytes, d.status_procesare], ['Caiet.pdf', real.length, 'neprocesat'], 'placeholder-ul documentului real completat')
    } finally { restore(); await opreste() }
  })
})

Deno.test('Copilot NO-GO r1 pe #649: în aceeași rulare „X.pdf.p7s” detașat + „X.pdf” real → ambele urcate; semnătura nu ia placeholder-ul documentului', async () => {
  for (const ordine of ['p7s,pdf', 'pdf,p7s']) {
    await cuMediu(async (root, s) => {
      const opreste = pornesteExtractor(root)
      const real = '%PDF-1.4 real'
      const det = await semneazaCms(new TextEncoder().encode(real), true)
      const docs: Record<string, Uint8Array> = ordine === 'p7s,pdf' ? { 'X.pdf.p7s': det, 'X.pdf': new TextEncoder().encode(real) } : { 'X.pdf': new TextEncoder().encode(real), 'X.pdf.p7s': det }
      const restore = cuSeap(docs)
      try {
        const tab = licSeap({ ofertare_documente_atribuire: [
          { id: 80, licitatie_id: 3, nume_original: 'X.pdf', fisier_path: '3/atribuire/neincarcat/X.pdf', status_procesare: 'ignorat', tip: 'alta', eroare: 'Aparut nou in SEAP...' },
        ] })
        const rap = await s.aduLicitatie(fakeSupa(tab, new Map()), 3, () => {})
        eq(rap.erori, [], ordine)
        eq(tab.ofertare_documente_atribuire.map(x => [x.id === 80 ? 'ph' : 'nou', x.nume_original, x.status_procesare]).sort(),
          [['nou', 'X.pdf.p7s', 'ignorat'], ['ph', 'X.pdf', 'neprocesat']], ordine)
        ok(s.cheiSeap('X.pdf').every((k: string) => k !== s.cheieRand('X.pdf.p7s')), 'cheile nu se ating')
      } finally { restore(); await opreste() }
    })
  }
})

Deno.test('Jakarinos #2 pe #649: bucla de platformă — „Anexa.pdf” și „Anexa.pdf.p7s” cu conținut diferit în aceeași arhivă → ambele urcate', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    try {
      const fisiere = new Map<string, Uint8Array>([['3/a.zip', await zipCu({ 'Anexa.pdf': '%PDF-1.4 nesemnata', 'Anexa.pdf.p7s': await semneazaCms(new TextEncoder().encode('%PDF-1.4 semnata, alt continut')) })]])
      const tab: Record<string, Rand[]> = { ofertare_documente_atribuire: [
        { id: 95, licitatie_id: 3, nume_original: 'R.zip', fisier_path: '3/a.zip', status_procesare: 'neprocesat', eroare: null, tip: 'alta' },
      ], ofertare_seap_fisiere: [], ofertare_seap_manifest: [], ofertare_licitatii: [], notifications: [] }
      await s.despacheteazaArhiveDinPlatforma(fakeSupa(tab, fisiere), () => {})
      const d = tab.ofertare_documente_atribuire
      ok(/^📦 Arhivă despachetată pe Terra: 2 fișiere noi/.test(d.find(x => x.id === 95)!.eroare), d.find(x => x.id === 95)!.eroare)
      const copii = d.filter(x => x.id !== 95).map(x => x.nume_original).sort()
      eq(copii.length, 2, JSON.stringify(copii))
      ok(copii.includes('R (#95)/Anexa.pdf') && copii.some(n => /^R \(#95\)\/[0-9a-f]{8}_Anexa\.pdf$/.test(n)), JSON.stringify(copii))
    } finally { await opreste() }
  })
})

Deno.test('Jakarinos #5 pe #649: bucla de documente semnate nu e ținută pe loc de arhive .p7m sau de „X.p7m” fără extensie', async () => {
  await cuMediu(async (_root, s) => {
    const fisiere = new Map<string, Uint8Array>([['3/c.p7m', await semneazaCms(new TextEncoder().encode('%PDF-1.4 c'))]])
    const arhive = Array.from({ length: 25 }, (_, i) => ({ id: 100 + i, licitatie_id: 3, nume_original: `A${i}.rar.p7m`, fisier_path: `3/a${i}`, status_procesare: 'neprocesat', eroare: null }))
    const tab: Record<string, Rand[]> = { ofertare_documente_atribuire: [
      ...arhive,
      { id: 200, licitatie_id: 3, nume_original: 'Fara extensie.p7m', fisier_path: '3/x', status_procesare: 'neprocesat', eroare: null },
      { id: 201, licitatie_id: 3, nume_original: 'Caiet.pdf.p7m', fisier_path: '3/c.p7m', status_procesare: 'neprocesat', eroare: null, seap_meta: null },
    ] }
    await s.desfaSemnateDinPlatforma(fakeSupa(tab, fisiere), () => {})
    const d = (id: number) => tab.ofertare_documente_atribuire.find(x => x.id === id)!
    eq(d(201).nume_original, 'Caiet (semnat).pdf')
    eq([d(200).status_procesare, d(200).eroare], ['ignorat', s.NOTA_FARA_EXTENSIE])
    ok(arhive.every(a => d(a.id).status_procesare === 'neprocesat' && d(a.id).eroare === null), 'arhivele rămân buclei de arhive')
  })
})

Deno.test('Copilot NO-GO r2 pe #649: T1 doar „Caiet.pdf.p7s” detașat, T2 doar „Caiet.pdf” real → la T2 documentul real e adus (evidența nu-l ascunde)', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    try {
      const tab = licSeap()
      const supa = fakeSupa(tab, new Map())
      let restore = cuSeap({ 'Caiet.pdf.p7s': await semneazaCms(new TextEncoder().encode('%PDF-1.4 x'), true) })
      const r1 = await s.aduLicitatie(supa, 3, () => {})
      restore()
      eq([r1.erori, r1.fisiere_urcate], [[], 1])
      eq(tab.ofertare_seap_fisiere.map(e => [e.cheie, e.stare]), [['caiet.pdf.p7s', 'ok']], 'evidența semnăturii brute are cheie proprie')
      restore = cuSeap({ 'Caiet.pdf': new TextEncoder().encode('%PDF-1.4 caietul real') })
      const r2 = await s.aduLicitatie(supa, 3, () => {})
      restore()
      eq([r2.erori, r2.fisiere_urcate, r2.deja], [[], 1, 0])
      eq(tab.ofertare_documente_atribuire.map(d => d.nume_original).sort(), ['Caiet.pdf', 'Caiet.pdf.p7s'])
      // T3: ambele pe SEAP, nimic nou de adus (idempotent)
      restore = cuSeap({ 'Caiet.pdf.p7s': await semneazaCms(new TextEncoder().encode('%PDF-1.4 x'), true), 'Caiet.pdf': new TextEncoder().encode('%PDF-1.4 caietul real') })
      const r3 = await s.aduLicitatie(supa, 3, () => {})
      restore()
      eq([r3.fisiere_urcate, r3.deja], [0, 2])
      // arhivele .p7s rămân pe cheia veche (dejaDesfacutaPeSeap, poarta 20261020a)
      eq([s.cheieEvidenta('PT.zip.p7s'), s.cheieEvidenta('Caiet.pdf.p7s'), s.cheieEvidenta('Caiet.pdf')], ['pt.zip', 'caiet.pdf.p7s', 'caiet.pdf'])
    } finally { await opreste() }
  })
})

Deno.test('audit #21: inventarul documentelor se citește pe pagini (1500 de rânduri) și o eroare de citire oprește importul', async () => {
  await cuMediu(async (root, s) => {
    const opreste = pornesteExtractor(root)
    const restore = cuSeap({ 'Doc 1499.pdf': new TextEncoder().encode('%PDF-1.4 x'), 'Nou.pdf': new TextEncoder().encode('%PDF-1.4 nou') })
    try {
      const multe = Array.from({ length: 1500 }, (_, i) => ({ id: i + 1, licitatie_id: 3, nume_original: `Doc ${i}.pdf`, fisier_path: `3/d${i}`, status_procesare: 'procesat' }))
      const tab = licSeap({ ofertare_documente_atribuire: multe })
      const supa = fakeSupa(tab, new Map())
      const rap = await s.aduLicitatie(supa, 3, () => {})
      eq([rap.erori, rap.deja, rap.fisiere_urcate], [[], 1, 1], 'Doc 1499 e pe pagina a doua — găsit, nu re-adus')
      const rau = { ...supa, from: (t: string) => { const b = supa.from(t); if (t === 'ofertare_documente_atribuire') b.range = () => Promise.resolve({ data: null, error: { message: 'timeout' } }); return b } }
      const r2 = await s.aduLicitatie(rau, 3, () => {})
      eq([r2.fisiere_urcate, r2.erori.length], [0, 1])
      ok(/inventarul documentelor nu s-a putut citi: timeout/.test(r2.erori[0]), r2.erori[0])
    } finally { restore(); await opreste() }
  })
})
