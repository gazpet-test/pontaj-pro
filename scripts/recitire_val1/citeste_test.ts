import { assert, assertEquals } from 'jsr:@std/assert@1'
import { type Deps, incarcaRegistru, type RandStaging, type RandUsage, reconciliaza, ruleaza, type Stare } from './citeste.ts'
import { poatePorni } from './lib.ts'

// laborator simulat: documente cu n pagini; fiecare apel scrie un rând de staging + un rând usage (cost fix), după scenariu
type Felie = { text?: string; eroare?: string | null; tokens?: boolean; usage?: Partial<RandUsage> | false; staging?: false | Partial<RandStaging>; primit?: boolean; ok?: boolean }
type Scenariu = {
  pagini: Record<number, number>
  felie?: (doc: number, deLa: number, panaLa: number, nrApel: number) => Felie
  straine?: (nrApel: number) => Partial<RandUsage>[]     // rânduri usage străine scrise în timpul apelului nr
  schimbaStorage?: (nrApel: number) => boolean
}
function mediu(sc: Scenariu) {
  const staging: RandStaging[] = []
  const usage: RandUsage[] = []
  let nrApel = 0, idSt = 100, idU = 500, storageVer = 1, ultimaSalvare: Stare | null = null, ceas = Date.parse('2026-10-16T20:00:00Z')
  const iso = () => new Date(ceas).toISOString()
  const text = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `⟦PAGINA ${a + i}⟧\nr`).join('\n')
  const d: Deps = {
    identitate: async (doc) => ({ fisier_path: `p/${doc}.pdf`, size_bytes: 10, pagina_offset: 0, pagini: sc.pagini[doc] }),
    storage: async () => ({ etag: 'e', size: 10, updated_at: `v${storageVer}` }),
    pdf: async (path) => ({ sha256: 'h', pagini: sc.pagini[Number(path.slice(2, -4))] }),
    lab: async (doc, de_la0, felie) => {
      nrApel++; ceas += 1000
      const deLa = de_la0 + 1, panaLa = Math.min(de_la0 + felie, sc.pagini[doc])
      const o = sc.felie?.(doc, deLa, panaLa, nrApel) ?? {}
      for (const x of sc.straine?.(nrApel) ?? []) usage.push({ id: ++idU, ref_id: 999, model: 'claude-haiku-5-5', tokens_in: 1, tokens_out: 1, cost_usd: 0.005, created_at: iso(), ...x })
      if (sc.schimbaStorage?.(nrApel)) storageVer++
      const faraTokeni = o.tokens === false
      if (o.staging !== false) staging.push({ id: ++idSt, doc_id: doc, model: 'claude-haiku-5-5', pagina_de_la: deLa, pagina_pana_la: panaLa,
        text: o.text ?? text(deLa, panaLa), tokens_in: faraTokeni ? null : 13219, tokens_out: faraTokeni ? null : 8440, cost_usd: faraTokeni ? null : 0.0055,
        eroare: o.eroare ?? null, created_at: iso(), ...(o.staging ?? {}) })
      if (o.usage !== false && !faraTokeni) usage.push({ id: ++idU, ref_id: doc, model: 'claude-haiku-5-5', tokens_in: 13219, tokens_out: 8440, cost_usd: 0.005542, created_at: iso(), ...(o.usage ?? {}) })
      ceas += 1000
      return { primit: o.primit ?? true, ok: o.ok ?? true }
    },
    staging: async (doc, a, b, dupa) => staging.filter((r) => r.doc_id === doc && r.pagina_de_la === a && r.pagina_pana_la === b && r.id > dupa),
    usage: async () => usage.map((u) => ({ ...u })),
    salveaza: async (s) => { ultimaSalvare = structuredClone(s) },
    acum: () => ceas,
  }
  return { d, apeluri: () => nrApel, ultima: () => ultimaSalvare }
}
const nou = (): Stare => ({ t0: '2026-10-16T19:50:00.000Z', plafon_usd: 1, apeluri: [], oprit: null, documente: [], ultim_staging_id: 0, usage_ids: [] })

Deno.test('pilot: citire completă, felii de 8, cost confirmat din BD (usage atribuit)', async () => {
  const m = mediu({ pagini: { 212: 20 } })
  const { cod, stare } = await ruleaza(m.d, nou(), [212])
  assertEquals(cod, 0)
  assertEquals(stare.documente[0].stare, 'citit')
  assertEquals(stare.documente[0].felii.map((f) => [f.de_la, f.pana_la]), [[1, 8], [9, 16], [17, 20]])
  assertEquals(stare.apeluri.every((a) => a.stare === 'confirmat' && a.cost_usd === 0.005542), true)
  assertEquals(stare.usage_ids.length, 3)
})

Deno.test('pilot: rezervarea e salvată ÎNAINTEA apelului', async () => {
  const m = mediu({ pagini: { 212: 8 } })
  let vazutRezervat = false
  const lab0 = m.d.lab
  m.d.lab = async (...a) => { vazutRezervat = m.ultima()?.apeluri.at(-1)?.stare === 'rezervat'; return await lab0(...a) }
  await ruleaza(m.d, nou(), [212])
  assert(vazutRezervat)
})

Deno.test('pilot: plafonul — se oprește înainte de un apel care ar trece de 1,00 cu rezervarea de 0,53', async () => {
  const s = nou()
  s.apeluri.push({ nr: 1, document_id: 1, de_la: 1, felie: 8, stare: 'confirmat', rezervat_usd: 0.53, cost_usd: 0.48, staging_id: 1 })
  const m = mediu({ pagini: { 212: 8 } })
  const { cod, stare } = await ruleaza(m.d, s, [212])
  assertEquals([cod, m.apeluri()], [3, 0])
  assert(/plafon/.test(stare.oprit!))
})

Deno.test('pilot: răspuns nerecepționat → rezervarea rămâne, oprire', async () => {
  const m = mediu({ pagini: { 212: 16 }, felie: (_d, a) => (a === 9 ? { primit: false } : {}) })
  const { cod, stare } = await ruleaza(m.d, nou(), [212])
  assertEquals(cod, 3)
  assertEquals(stare.apeluri.at(-1)!.stare, 'neconfirmat')
})

Deno.test('r1 Jakarinos #1: eroare de laborator fără staging și fără usage (poate fi după apelul AI) → NU cost 0, oprire', async () => {
  for (const ok of [false, true]) {
    const m = mediu({ pagini: { 212: 16 }, felie: () => ({ staging: false, usage: false, ok }) })
    const { cod, stare } = await ruleaza(m.d, nou(), [212])
    assertEquals([cod, m.apeluri(), stare.apeluri[0].stare], [3, 1, 'neconfirmat'])
  }
})

Deno.test('r1 Jakarinos #2: usage străin cu același cost nu substituie usage-ul propriu lipsă', async () => {
  const m = mediu({ pagini: { 212: 8 }, felie: () => ({ usage: false }), straine: () => [{ ref_id: 999 }] })
  const { cod, stare } = await ruleaza(m.d, nou(), [212])
  assertEquals([cod, stare.apeluri[0].stare], [3, 'neconfirmat'])
})

Deno.test('r1 Jakarinos #2: tokens_out null / staging datat în viitor / model sau tokeni diferiți → neconfirmat', async () => {
  const cazuri: Felie[] = [
    { staging: { tokens_out: null } },
    { staging: { created_at: '2099-01-01T00:00:00Z' } },
    { usage: { model: 'claude-haiku-4-5-20251001' } },
    { usage: { tokens_in: 999 } },
    { usage: { created_at: '2099-01-01T00:00:00Z' } },
  ]
  for (const c of cazuri) {
    const m = mediu({ pagini: { 212: 8 }, felie: () => c })
    const { cod, stare } = await ruleaza(m.d, nou(), [212])
    assertEquals([cod, stare.apeluri[0].stare], [3, 'neconfirmat'], JSON.stringify(c))
  }
})

Deno.test('pilot: apel respins de API (rând cu eroare, fără tokeni, fără usage) → confirmat 0; cu usage → oprire', async () => {
  const m = mediu({ pagini: { 212: 8 }, felie: (_d, _a, _b, n) => (n === 1 ? { tokens: false, eroare: '529 overloaded' } : {}) })
  const { cod, stare } = await ruleaza(m.d, nou(), [212])
  assertEquals([cod, stare.apeluri[0].cost_usd, stare.documente[0].stare], [0, 0, 'citit'])
  const m2 = mediu({ pagini: { 212: 8 }, felie: () => ({ tokens: false, eroare: 'x' }), straine: () => [{ ref_id: 212 }] })
  assertEquals((await ruleaza(m2.d, nou(), [212])).cod, 3)
})

Deno.test('pilot: apel străin în laborator între apeluri → oprire', async () => {
  const m = mediu({ pagini: { 212: 16 }, straine: (n) => (n === 1 ? [{}] : []) })
  const { cod } = await ruleaza(m.d, nou(), [212])
  assertEquals(cod, 3)
})

Deno.test('pilot: felie trunchiată → înjumătățire 8 → 4 și continuă de la aceeași pagină', async () => {
  const m = mediu({ pagini: { 212: 8 }, felie: (_d, a, b) => (b - a + 1 === 8 ? { eroare: 'trunchiat la max_tokens' } : {}) })
  const { stare } = await ruleaza(m.d, nou(), [212])
  assertEquals(stare.documente[0].felii.map((f) => [f.de_la, f.pana_la]), [[1, 4], [5, 8]])
})

Deno.test('pilot: marcaje greșite până la felia 1 (inclusiv numărul tipărit la o pagină) → documentul eșuează, nu se repară', async () => {
  const m = mediu({ pagini: { 212: 2 }, felie: (_d, a, b) => (a <= 2 && b >= 2
    ? { text: a === b ? '⟦PAGINA 999⟧ x' : Array.from({ length: b - a + 1 }, (_, i) => `⟦PAGINA ${a + i}⟧ x`).join('\n') + '\n⟦PAGINA 2⟧ y' } : {}) })
  const { cod, stare } = await ruleaza(m.d, nou(), [212])
  assertEquals(cod, 0)
  assertEquals(stare.documente[0].stare, 'esuat')
  assertEquals(m.apeluri(), 3 + 1 + 3)   // 1-2 la feliile 8 / 4 / 2 (eșuează) → 1-1 (trece) → 2-2 (marcaj 999) de 3 ori
})

Deno.test('r1 (ambii): sursa schimbată → documentul aruncat ȘI rularea oprită (cod 3), următorul document necitit', async () => {
  const m = mediu({ pagini: { 212: 16, 213: 8 }, schimbaStorage: (n) => n === 1 })
  const { cod, stare } = await ruleaza(m.d, nou(), [212, 213])
  assertEquals(cod, 3)
  assert(/sursa_schimbata/.test(stare.oprit!))
  assertEquals(stare.documente.map((x) => [x.document_id, x.stare]), [[212, 'esuat']])
})

Deno.test('pilot: reluare — documentele terminate nu se recitesc; rulare oprită nu pornește', async () => {
  const m = mediu({ pagini: { 212: 8, 213: 8 } })
  const r1 = await ruleaza(m.d, nou(), [212])
  await ruleaza(m.d, r1.stare, [212, 213])
  assertEquals(m.apeluri(), 2)
  const s = nou(); s.oprit = 'x'
  const m2 = mediu({ pagini: { 212: 8 } })
  assertEquals((await ruleaza(m2.d, s, [212])).cod, 3)
  assertEquals(m2.apeluri(), 0)
})

Deno.test('r1 (ambii): registrul valului — lipsă → nou; corupt / formă invalidă → eroare (nu un registru nou)', async () => {
  const dir = await Deno.makeTempDir()
  const fis = `${dir}/rulare.json`
  const nouS = () => nou()
  assert('s' in await incarcaRegistru(fis, nouS))
  await Deno.writeTextFile(fis, '{ corupt')
  assert('eroare' in await incarcaRegistru(fis, nouS))
  await Deno.writeTextFile(fis, '{"t0": "x"}')
  assert('eroare' in await incarcaRegistru(fis, nouS))
  await Deno.writeTextFile(fis, JSON.stringify({ ...nou(), t0: '2026-10-16T19:50:00.000Z' }))
  const r = await incarcaRegistru(fis, nouS)
  assertEquals('s' in r && r.s.t0, '2026-10-16T19:50:00.000Z')
  // r2: registrul e contabilitate, nu autoritate — plafon schimbat / lipsă, rezervare sau cost invalid → eroare
  const ap = (x: object) => ({ nr: 1, document_id: 212, de_la: 1, felie: 8, stare: 'confirmat', rezervat_usd: 0.53, cost_usd: 0.01, staging_id: 1, ...x })
  for (const rau of [{ plafon_usd: 10 }, { plafon_usd: undefined }, { apeluri: [ap({ cost_usd: 0.99 })] }, { apeluri: [ap({ rezervat_usd: 0.01 })] },
      { apeluri: [ap({ cost_usd: Number.NaN })] }, { apeluri: [ap({ stare: 'rezervat', cost_usd: 0.01 })] }, { usage_ids: [1, 1] }, { t0: 'nu-e-data' }]) {
    await Deno.writeTextFile(fis, JSON.stringify({ ...nou(), t0: '2026-10-16T19:50:00.000Z', ...rau }))
    assert('eroare' in await incarcaRegistru(fis, nouS), JSON.stringify(rau))
  }
  await Deno.remove(dir, { recursive: true })
})

// ── 16.10, fereastra_2: staging numeric(10,4) față de ai_usage_log numeric(10,6) ──
Deno.test('cost: staging 0.0055 (4 zecimale) și usage 0.005542 (6 zecimale), aceiași tokeni → confirmat la costul exact 0.005542', async () => {
  const m = mediu({ pagini: { 212: 8 } })
  const { cod, stare } = await ruleaza(m.d, nou(), [212])
  assertEquals([cod, stare.apeluri[0].stare, stare.apeluri[0].cost_usd], [0, 'confirmat', 0.005542])
})
Deno.test('cost: un cost care nu rezultă din tokeni (în oricare tabel) → neconfirmat', async () => {
  for (const c of [{ usage: { cost_usd: 0.006 } }, { staging: { cost_usd: 0.0099 } }, { usage: { cost_usd: 0.0055 } }] as Felie[]) {
    const m = mediu({ pagini: { 212: 8 }, felie: () => c })
    assertEquals((await ruleaza(m.d, nou(), [212])).cod, 3, JSON.stringify(c))
  }
})

Deno.test('reconciliaza: apelul oprit pe „cost neconfirmat” (cazul real) → confirmat din BD, oprirea ridicată, plafonul eliberat', async () => {
  const s = nou()
  s.oprit = 'apel 1: cost neconfirmat'
  s.apeluri.push({ nr: 1, document_id: 212, de_la: 1, felie: 8, stare: 'neconfirmat', rezervat_usd: 0.53, cost_usd: null, staging_id: 78 })
  const st: RandStaging = { id: 78, doc_id: 212, model: 'claude-haiku-5-5', pagina_de_la: 1, pagina_pana_la: 8, text: 'x', tokens_in: 13219, tokens_out: 8440,
    cost_usd: 0.0055, eroare: null, created_at: '2026-10-16T12:10:47.202Z' }
  const us: RandUsage = { id: 5354, ref_id: 212, model: 'claude-haiku-5-5', tokens_in: 13219, tokens_out: 8440, cost_usd: 0.005542, created_at: '2026-10-16T12:10:47.298Z' }
  let salvat: Stare | null = null
  const d = { usage: async () => [us], staging: async () => [], salveaza: async (x: Stare) => { salvat = structuredClone(x) } }
  const r = await reconciliaza(d, s, async (id) => (id === 78 ? st : null))
  assert(r.ok, r.motiv)
  assertEquals([salvat!.oprit, salvat!.apeluri[0].stare, salvat!.apeluri[0].cost_usd, salvat!.usage_ids], [null, 'confirmat', 0.005542, [5354]])
  assert(poatePorni(salvat!).ok)
})
Deno.test('reconciliaza: usage străin în plus / lipsă / cost nepotrivit / fără staging → nimic confirmat, registrul neschimbat', async () => {
  const baza = () => { const s = nou(); s.oprit = 'x'; s.apeluri.push({ nr: 1, document_id: 212, de_la: 1, felie: 8, stare: 'neconfirmat', rezervat_usd: 0.53, cost_usd: null, staging_id: 78 }); return s }
  const st: RandStaging = { id: 78, doc_id: 212, model: 'claude-haiku-5-5', pagina_de_la: 1, pagina_pana_la: 8, text: 'x', tokens_in: 13219, tokens_out: 8440,
    cost_usd: 0.0055, eroare: null, created_at: '2026-10-16T12:10:47.202Z' }
  const us = (x: Partial<RandUsage> = {}): RandUsage => ({ id: 5354, ref_id: 212, model: 'claude-haiku-5-5', tokens_in: 13219, tokens_out: 8440, cost_usd: 0.005542,
    created_at: '2026-10-16T12:10:47.298Z', ...x })
  for (const [nume, u, sid] of [['străin în plus', [us(), us({ id: 9, ref_id: 999 })], 78], ['lipsă', [], 78], ['cost', [us({ cost_usd: 0.01 })], 78],
      ['moment', [us({ created_at: '2026-10-16T13:10:47Z' })], 78], ['fără staging', [us()], null]] as const) {
    const s = baza(); if (sid === null) s.apeluri[0].staging_id = null
    let salvari = 0
    const r = await reconciliaza({ usage: async () => [...u], staging: async () => [], salveaza: async () => { salvari++ } }, s, async () => st)
    assertEquals([r.ok, salvari, s.oprit, s.apeluri[0].stare], [false, 0, 'x', 'neconfirmat'], nume)
  }
})

// ── Jakarinos #747 r1 ──
Deno.test('cost: paritate cu Postgres — rotunjirea ZECIMALĂ a șirului JS (13000/8091 → 0.005345, nu 0.005346)', async () => {
  const { costHaiku55, numericPostgres } = await import('./lib.ts')
  const c = costHaiku55(13000, 8091)
  assertEquals(String(c), '0.0053454999999999996')
  assertEquals([numericPostgres(c, 6), numericPostgres(c, 4)], ['0.005345', '0.0053'])
  assertEquals([numericPostgres(costHaiku55(13219, 8440), 6), numericPostgres(costHaiku55(13219, 8440), 4)], ['0.005542', '0.0055'])
  assertEquals([numericPostgres(5e-7, 6), numericPostgres(5e-7, 4), numericPostgres(0.00004999, 4), numericPostgres(0.00005, 4), numericPostgres(1.5, 0)], ['0.000001', '0.0000', '0.0000', '0.0001', '2'])
  // treapta de sus: > 100 000 tokeni de intrare
  assertEquals(costHaiku55(100_001, 0), 100_001 * (0.50 / 1e6))
  assertEquals(costHaiku55(100_000, 0), 100_000 * (0.10 / 1e6))
  // perechea reală a cazului 13000/8091, ca în BD, e CONFIRMATĂ
  const { costPotrivit } = await import('./citeste.ts')
  const r: RandStaging = { id: 1, doc_id: 212, model: 'claude-haiku-5-5', pagina_de_la: 1, pagina_pana_la: 8, text: 'x', tokens_in: 13000, tokens_out: 8091, cost_usd: 0.0053, eroare: null, created_at: 't' }
  const u: RandUsage = { id: 2, ref_id: 212, model: 'claude-haiku-5-5', tokens_in: 13000, tokens_out: 8091, cost_usd: 0.005345, created_at: 't' }
  assertEquals(costPotrivit(r, u, 212), 0.005345)
  assertEquals(costPotrivit(r, { ...u, cost_usd: 0.005346 }, 212), null)
})

Deno.test('usage: citire completă paginată — un apel străin dincolo de prima pagină NU scapă; trunchierea / totalul schimbat → eroare', async () => {
  const { citesteComplet, PAGINA_USAGE } = await import('./citeste.ts')
  const toate = Array.from({ length: 2 * PAGINA_USAGE + 1 }, (_, i) => ({ id: i + 1 }))
  const r = await citesteComplet(async (de, pana) => ({ randuri: toate.slice(de, pana + 1), total: toate.length }))
  assertEquals(r.length, toate.length)
  assertEquals(r.at(-1)!.id, toate.length)                                     // ultimul rând (străinul) e văzut
  let e1 = ''; try { await citesteComplet(async (de, pana) => ({ randuri: toate.slice(de, Math.min(pana + 1, 1000)), total: toate.length })) } catch (e) { e1 = String(e) }
  assert(/incompletă/.test(e1), e1)
  let n = 0, e2 = ''; try { await citesteComplet(async (de, pana) => ({ randuri: toate.slice(de, pana + 1), total: toate.length + (n++ > 0 ? 1 : 0) })) } catch (e) { e2 = String(e) }
  assert(/schimbat/.test(e2), e2)
  let e3 = ''; try { await citesteComplet(async () => ({ randuri: [], total: null })) } catch (e) { e3 = String(e) }
  assert(/total/.test(e3))
})
