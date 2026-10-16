import { assert, assertEquals } from 'jsr:@std/assert@1'
import { type Deps, type RandStaging, ruleaza, type Stare } from './citeste.ts'

// laborator simulat: documente cu n pagini; fiecare apel scrie un rând de staging + un rând usage (cost fix), după scenariu
type Scenariu = {
  pagini: Record<number, number>
  felie?: (doc: number, deLa: number, panaLa: number, nrApel: number) => { text?: string; eroare?: string | null; tokens?: boolean; usage?: boolean; staging?: boolean; primit?: boolean; ok?: boolean }
  straine?: (nrApel: number) => number      // apeluri străine înregistrate înaintea apelului nr
  schimbaStorage?: (nrApel: number) => boolean
}
function mediu(sc: Scenariu) {
  const staging: RandStaging[] = []
  const usage: { cost: number }[] = []
  let nrApel = 0, idSt = 100, storageVer = 1, salvari = 0, ultimaSalvare: Stare | null = null
  const text = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `⟦PAGINA ${a + i}⟧\nr`).join('\n')
  const d: Deps = {
    identitate: async (doc) => ({ fisier_path: `p/${doc}.pdf`, size_bytes: 10, pagina_offset: 0, pagini: sc.pagini[doc] }),
    storage: async () => ({ etag: 'e', size: 10, updated_at: `v${storageVer}` }),
    pdf: async (path) => ({ sha256: 'h', pagini: sc.pagini[Number(path.slice(2, -4))] }),
    lab: async (doc, de_la0, felie) => {
      nrApel++
      for (let i = 0; i < (sc.straine?.(nrApel) ?? 0); i++) usage.push({ cost: 0.01 })
      const deLa = de_la0 + 1, panaLa = Math.min(de_la0 + felie, sc.pagini[doc])
      const o = sc.felie?.(doc, deLa, panaLa, nrApel) ?? {}
      if (sc.schimbaStorage?.(nrApel)) storageVer++
      if (o.staging !== false) staging.push({ id: ++idSt, doc_id: doc, model: 'claude-haiku-5-5', pagina_de_la: deLa, pagina_pana_la: panaLa,
        text: o.text ?? text(deLa, panaLa), tokens_in: o.tokens === false ? null : 1000, tokens_out: 100, cost_usd: o.tokens === false ? null : 0.005,
        eroare: o.eroare ?? null, created_at: 't' })
      if (o.usage !== false && o.tokens !== false) usage.push({ cost: 0.005 })
      return { primit: o.primit ?? true, ok: o.ok ?? true }
    },
    staging: async (doc, a, b, dupa) => staging.filter((r) => r.doc_id === doc && r.pagina_de_la === a && r.pagina_pana_la === b && r.id > dupa),
    usage: async () => ({ n: usage.length, cost: usage.reduce((x, u) => x + u.cost, 0) }),
    salveaza: async (s) => { salvari++; ultimaSalvare = structuredClone(s) },
    acum: () => 't',
  }
  return { d, apeluri: () => nrApel, salvari: () => salvari, ultima: () => ultimaSalvare }
}
const nou = (): Stare => ({ t0: 't0', plafon_usd: 1, apeluri: [], oprit: null, documente: [], ultim_staging_id: 0, usage_n: 0 })

Deno.test('pilot: citire completă, felii de 8, cost confirmat din BD', async () => {
  const m = mediu({ pagini: { 212: 20 } })
  const { cod, stare } = await ruleaza(m.d, nou(), [212])
  assertEquals(cod, 0)
  assertEquals(stare.documente[0].stare, 'citit')
  assertEquals(stare.documente[0].felii.map((f) => [f.de_la, f.pana_la]), [[1, 8], [9, 16], [17, 20]])
  assertEquals(stare.apeluri.every((a) => a.stare === 'confirmat' && a.cost_usd === 0.005), true)
})

Deno.test('pilot: rezervarea e salvată ÎNAINTEA apelului (registrul pe disc are „rezervat” înainte de răspuns)', async () => {
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
  assert(/nerecepționat/.test(stare.oprit!))
})

Deno.test('pilot: ok fără rând de staging (scriere pierdută) → oprire, nu cost 0', async () => {
  const m = mediu({ pagini: { 212: 8 }, felie: () => ({ staging: false, usage: false }) })
  const { cod, stare } = await ruleaza(m.d, nou(), [212])
  assertEquals(cod, 3)
  assertEquals(stare.apeluri[0].stare, 'neconfirmat')
})

Deno.test('pilot: cost în staging fără rând usage → neconfirmat, oprire', async () => {
  const m = mediu({ pagini: { 212: 8 }, felie: () => ({ usage: false }) })
  const { cod } = await ruleaza(m.d, nou(), [212])
  assertEquals(cod, 3)
})

Deno.test('pilot: apel străin în laborator între apeluri → oprire', async () => {
  const m = mediu({ pagini: { 212: 16 }, straine: (n) => (n === 1 ? 1 : 0) })
  const { cod, stare } = await ruleaza(m.d, nou(), [212])
  assertEquals(cod, 3)
  assert(/străin|neconfirmat/.test(stare.oprit!))
})

Deno.test('pilot: felie trunchiată → înjumătățire 8 → 4 și continuă de la aceeași pagină', async () => {
  const m = mediu({ pagini: { 212: 8 }, felie: (_d, a, b) => (b - a + 1 === 8 ? { eroare: 'trunchiat la max_tokens' } : {}) })
  const { stare } = await ruleaza(m.d, nou(), [212])
  assertEquals(stare.documente[0].felii.map((f) => [f.de_la, f.pana_la]), [[1, 4], [5, 8]])
})

Deno.test('pilot: marcaje greșite până la felia 1 → documentul eșuează, nu se repară', async () => {
  // orice felie care conține pagina 2 vine cu marcajul 2 dublat
  const m = mediu({ pagini: { 212: 2 }, felie: (_d, a, b) => (a <= 2 && b >= 2
    ? { text: Array.from({ length: b - a + 1 }, (_, i) => `⟦PAGINA ${a + i}⟧ x`).join('\n') + '\n⟦PAGINA 2⟧ y' } : {}) })
  const { cod, stare } = await ruleaza(m.d, nou(), [212])
  assertEquals(cod, 0)
  assertEquals(stare.documente[0].stare, 'esuat')
  assert(/pagina 2: marcaje după 3 încercări/.test(stare.documente[0].motiv!))
  assertEquals(m.apeluri(), 3 + 1 + 3)   // 1-2 la feliile 8 / 4 / 2 (eșuează) → 1-1 (felia 1, trece) → 2-2 de 3 ori
})

Deno.test('pilot: Storage schimbat în timpul citirii → documentul e aruncat (sursa_schimbata)', async () => {
  const m = mediu({ pagini: { 212: 16 }, schimbaStorage: (n) => n === 1 })
  const { stare } = await ruleaza(m.d, nou(), [212])
  assertEquals(stare.documente[0].stare, 'esuat')
  assert(/sursa_schimbata/.test(stare.documente[0].motiv!))
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
