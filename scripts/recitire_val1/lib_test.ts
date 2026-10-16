import { assert, assertEquals } from 'jsr:@std/assert@1'
import { acoperire, asambleaza, consum, criterii, diferente, type Felie, normalizeazaFelie, ORDINE, PLAFON_USD, poatePorni, radacinaParte,
  raport, type Registru, REZERVARE_APEL_USD, sha256Hex, WHITELIST, cantitatiM } from './lib.ts'

const f = (id: number, de_la: number, pana_la: number, text?: string): Felie =>
  ({ id, de_la, pana_la, text: text ?? Array.from({ length: pana_la - de_la + 1 }, (_, i) => `⟦PAGINA ${de_la + i}⟧\nrând ${de_la + i}`).join('\n') })

Deno.test('whitelist: 20 de documente unice; ordinea începe cu 212, 213 și le conține pe toate', () => {
  assertEquals(new Set(WHITELIST).size, 20)
  assertEquals(ORDINE.slice(0, 2), [212, 213])
  assertEquals([...ORDINE].sort((a, b) => a - b), [...WHITELIST].sort((a, b) => a - b))
})

Deno.test('buget: rezervarea de 0,53 înaintea apelului; plafonul 1,00 lasă 0,47 utilizabili', () => {
  const r: Registru = { t0: 'x', plafon_usd: PLAFON_USD, apeluri: [], oprit: null }
  assert(poatePorni(r).ok)
  // 0,46 confirmați → 0,46 + 0,53 = 0,99 ≤ 1,00 → pornește; 0,48 → 1,01 → nu
  r.apeluri.push({ nr: 1, document_id: 212, de_la: 1, felie: 8, stare: 'confirmat', rezervat_usd: REZERVARE_APEL_USD, cost_usd: 0.46, staging_id: 1 })
  assert(poatePorni(r).ok)
  r.apeluri[0].cost_usd = 0.48
  assertEquals(poatePorni(r).ok, false)
})

Deno.test('r2: plafonul e constanta — un registru cu plafon 10 sau fără plafon nu poate porni apeluri', () => {
  const r: Registru = { t0: 'x', plafon_usd: 10, apeluri: [], oprit: null }
  assertEquals(poatePorni(r).ok, false)
  assertEquals(poatePorni({ ...r, plafon_usd: undefined as unknown as number }).ok, false)
  r.plafon_usd = PLAFON_USD
  r.apeluri.push({ nr: 1, document_id: 212, de_la: 1, felie: 8, stare: 'confirmat', rezervat_usd: REZERVARE_APEL_USD, cost_usd: 0.99, staging_id: 1 })
  assertEquals(poatePorni(r).ok, false)
})

Deno.test('buget: un apel neconfirmat rămâne socotit la 0,53 și oprește rularea', () => {
  const r: Registru = { t0: 'x', plafon_usd: PLAFON_USD, apeluri: [
    { nr: 1, document_id: 212, de_la: 1, felie: 8, stare: 'neconfirmat', rezervat_usd: REZERVARE_APEL_USD, cost_usd: null, staging_id: null }], oprit: null }
  assertEquals(consum(r), 0.53)
  assertEquals(poatePorni(r).ok, false)
  r.apeluri[0].stare = 'rezervat'
  assertEquals(poatePorni(r).ok, false)
  r.oprit = 'apel străin'
  assert(/oprită/.test(poatePorni(r).motiv!))
})

Deno.test('marcaje: felia trece doar cu exact de_la..pana_la, o dată fiecare, în ordine', () => {
  assert(normalizeazaFelie(f(1, 9, 16).text, 9, 16) !== null)
  assertEquals(normalizeazaFelie('⟦PAGINA 9⟧ a ⟦PAGINA 9⟧ b', 9, 10), null)          // „1,1” — nu se repară secvențial
  assertEquals(normalizeazaFelie('⟦PAGINA 9⟧ a', 9, 10), null)                       // lipsă
  assertEquals(normalizeazaFelie('⟦PAGINA 10⟧ a ⟦PAGINA 9⟧ b', 9, 10), null)         // ordine
  assertEquals(normalizeazaFelie('⟦PAGINA 9⟧ a ⟦PAGINA 11⟧ b', 9, 10), null)         // în afara intervalului
  // felia de 1 pagină: tot exact — numărul greșit NU se rescrie (999 / 3 pentru pagina 7 → refuz)
  assertEquals(normalizeazaFelie('⟦PAGINA 7⟧ text', 7, 7), '⟦PAGINA 7⟧ text')
  assertEquals(normalizeazaFelie('⟦PAGINA 999⟧ text', 7, 7), null)
  assertEquals(normalizeazaFelie('⟦PAGINA 3⟧ text', 7, 7), null)
  assertEquals(normalizeazaFelie('⟦PAGINA 7⟧ a ⟦PAGINA 7⟧ b', 7, 7), null)
})

Deno.test('acoperire: exact 1..pagini, fără goluri / suprapuneri', () => {
  assertEquals(acoperire([f(1, 1, 8), f(2, 9, 12)], 12), null)
  assert(/gol/.test(acoperire([f(1, 1, 8), f(2, 10, 12)], 12)!))
  assert(/suprapunere/.test(acoperire([f(1, 1, 8), f(2, 8, 12)], 12)!))
  assert(/gol/.test(acoperire([f(1, 1, 8)], 12)!))
  assert(/peste/.test(acoperire([f(1, 1, 8), f(2, 9, 13)], 12)!))
})

Deno.test('asamblare: 213 (offset 104, 72 de pagini) → marcaje exact 105..176; lipire ca în ingest', async () => {
  const felii: Felie[] = []
  for (let s = 1; s <= 72; s += 8) felii.push(f(s, s, Math.min(s + 7, 72)))
  const t = asambleaza(felii.reverse(), 104)
  const m = [...t.matchAll(/⟦PAGINA (\d+)⟧/g)].map((x) => Number(x[1]))
  assertEquals(m, Array.from({ length: 72 }, (_, i) => 105 + i))
  assert(!t.endsWith('\n') && t.startsWith('⟦PAGINA 105⟧'))
  assertEquals(await sha256Hex(t), await sha256Hex(asambleaza(felii, 104)))
  const r = raport(t, 104, 72, 'ro')
  assertEquals([r.pagini_asteptate, r.pagini_inventate, r.pagini_lipsa, r.pagini_marcate], [[105, 176], [], [], 72])
})

Deno.test('raport: pagini inventate (în afara intervalului / duplicate) și lipsă', () => {
  const r = raport('⟦PAGINA 1⟧ a ⟦PAGINA 2⟧ b ⟦PAGINA 2⟧ c ⟦PAGINA 9⟧ d', 0, 4, 'ro')
  assertEquals(r.pagini_inventate, [2, 9])
  assertEquals(r.pagini_lipsa, [3, 4])
})

Deno.test('cantități în m: convenția grupului decide „3.995”; diametrul nu e cantitate; criterii', () => {
  const t = '⟦PAGINA 1⟧\n| Strada | Lungime (m) |\n|---|---|\n| A | 3.995 |\n| B | 1.200,50 |\nConducta Dn 90 m\n'
  const ro = cantitatiM(t, 'ro').map((x) => x.valoare)
  assertEquals(ro, [3995, 1200.5])
  assertEquals(cantitatiM(t, 'nedeterminata').map((x) => x.valoare), [1200.5])   // 3.995 ambiguu → nu se numără
  const rv = raport('⟦PAGINA 1⟧\n| A | 3.995 m |', 0, 1, 'ro'), rn = raport(t, 0, 1, 'ro')
  assertEquals(criterii(rn, rv, null), { integritate_ok: true, calitate_ok: true, motive: [] })
  const slab = criterii(rv, rn, null)
  assertEquals([slab.integritate_ok, slab.calitate_ok], [true, false])
  // integritatea NU poate fi compensată de calitate
  assertEquals(criterii(rn, rv, 'felie eșuată 9-16').integritate_ok, false)
  assertEquals(diferente('⟦PAGINA 1⟧ | A | 3.995 m |', t, 'ro')[0].nou, [3995, 1200.5])
})

Deno.test('rădăcina părții: 212 / 213 (p01 / p02) → același grup', () => {
  assertEquals(radacinaParte('Liste cantitati — p01_pag1-104.pdf'), radacinaParte('Liste cantitati — p02_pag105-176.pdf'))
})
