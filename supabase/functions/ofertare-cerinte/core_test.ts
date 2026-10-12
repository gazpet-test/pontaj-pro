import { deepStrictEqual as assertEquals } from 'node:assert/strict'
import { extrageCerinte, mapaPozitii, verificaPasaj } from './core.ts'

const autentic = 'Ofertantul va prezenta personal autorizat pentru toate categoriile de lucrări cerute în documentația de atribuire.'
const document = `⟦PAGINA 2⟧\n${'Context fără citat. '.repeat(20)}\n⟦PAGINA 7⟧\n${autentic}`
function verifica(text: string, pasaj: string) {
  const { n, mapa } = mapaPozitii(text)
  return verificaPasaj(text, n, mapa, pasaj)
}

Deno.test('R15: început autentic + final inventat = parțial, neverificat, pagina păstrată', () => {
  const r = verifica(document, autentic + ' Sunt obligatorii exact nouă ingineri.')
  assertEquals(r.verificat, false)
  assertEquals(r.pasaj_partial, true)
  assertEquals(r.pagina, 7)
})

Deno.test('R15: pasaj integral normalizat = verificat, fără marcaj parțial', () => {
  const r = verifica(document, autentic.toUpperCase().replaceAll(' ', '\n  '))
  assertEquals(r.verificat, true)
  assertEquals(r.pasaj_partial, false)
  assertEquals(r.pagina, 7)
})

Deno.test('R15: finalul inventat după caracterul 300 nu dispare înainte de verificare', () => {
  const lung = autentic.repeat(4)
  const pasaj = lung + ' Final inventat.'
  const r = verifica(`⟦PAGINA 9⟧\n${lung}`, pasaj)
  assertEquals(r.verificat, false)
  assertEquals(r.pasaj_partial, true)
  assertEquals(r.pagina, 9)
  assertEquals(r.pasaj, pasaj)
})

Deno.test('R15: lipsă potrivire sau normalizare goală nu verifică și nu inventează pagina', () => {
  for (const pasaj of ['', 'inventat '.repeat(20), '„” '.repeat(20)]) {
    const r = verifica(document, pasaj)
    assertEquals([r.verificat, r.pasaj_partial, r.pagina], [false, false, null])
  }
})

// Calea reală extrageCerinte, cu transport și BD simulate; nicio rețea/scriere reală.
// Poarta pe loturi (fn_ofertare_document_eligibil) simulată: implicit eligibil; `eligibil` = motivul de neeligibilitate,
// `rpcEroare` = RPC-ul pică (fail-closed). `lot` = valoarea dată de model; `nume` = numele documentului.
type Opt = { stop?: string; brut?: string; pasaj?: string; nume?: string; lot?: unknown; eligibil?: string; rpcEroare?: boolean;
  corp?: Record<string, unknown> }
async function extrage(n: number, opt: Opt = {}) {
  const scrise: any[] = []
  const apeluri = { ai: 0, rpc: [] as unknown[] }
  const db = { rpc(nume: string, args: Record<string, unknown>) {
    apeluri.rpc.push({ nume, args })
    if (opt.rpcEroare) return Promise.resolve({ data: null, error: { message: 'cădere' } })
    return Promise.resolve({ data: opt.eligibil ? { eligibil: false, motiv: opt.eligibil, licitatie_id: 1 }
      : { eligibil: true, motiv: 'comun', licitatie_id: 1 }, error: null })
  }, from(tabel: string) {
    const fisa = [{ id: 3, nume_original: 'Fisa de date.pdf', text_extras: 'Secțiunea II ' + document.repeat(3) }]
    const rezultat = { data: tabel === 'ofertare_licitatii' ? { id: 1, autoritate: 'Test', nr_anunt: 'Test' }
      : tabel === 'ofertare_documente_atribuire' ? (opt.corp && !opt.corp.doc_id ? fisa
        : { id: 2, tip: 'cs_volum', text_extras: document, nume_original: opt.nume ?? 'Test' }) : [], error: null }
    const q: any = {
      select: () => q, eq: () => q, order: () => q, limit: () => q, in: () => q, is: () => q, delete: () => q,
      single: () => Promise.resolve(rezultat),
      then: (resolve: any) => Promise.resolve(rezultat).then(resolve),
      insert: (rows: any) => {
        if (tabel === 'ofertare_cerinte') scrise.push(...rows)
        return Promise.resolve({ error: null })
      },
    }
    return q
  } }
  const fetchVechi = globalThis.fetch
  globalThis.fetch = (() => { apeluri.ai++; return Promise.resolve(new Response(JSON.stringify({
    stop_reason: opt.stop || 'end_turn', usage: {}, content: [{ type: 'text', text: opt.brut ?? JSON.stringify({
      cerinte: Array.from({ length: n }, (_, i) => ({ text_cerinta: `Cerință ${i}`, pasaj: opt.pasaj ?? autentic, pagina: 2,
        ...('lot' in opt ? { lot: opt.lot } : {}) })),
    }) }],
  }))) }) as typeof fetch
  try {
    return { rezultat: await extrageCerinte(db, opt.corp ?? { licitatie_id: 1, doc_id: 2 }), scrise, apeluri }
  } finally { globalThis.fetch = fetchVechi }
}

for (const n of [149, 150, 151]) Deno.test(`R15: ${n} cerințe — plafonul semnalează trunchierea`, async () => {
  const { rezultat, scrise } = await extrage(n)
  assertEquals(rezultat.ok, true)
  assertEquals(rezultat.trunchiat, n >= 150)
  assertEquals(rezultat.cerinte, Math.min(n, 150))
  assertEquals(scrise.length, Math.min(n, 150))
})

Deno.test('R15: max_tokens semnalează trunchierea chiar dacă JSON-ul este valid', async () => {
  assertEquals((await extrage(1, { stop: 'max_tokens' })).rezultat.trunchiat, true)
})

Deno.test('R15: recuperarea JSON incomplet păstrează cerința și semnalul de trunchiere', async () => {
  const { rezultat, scrise } = await extrage(0, { brut: '{"cerinte":[{"text_cerinta":"Cerință recuperată"},{"text_cerinta":' })
  assertEquals(rezultat.trunchiat, true)
  assertEquals(scrise.length, 1)
})

Deno.test('R15: răspuns trunchiat fără obiect complet nu devine succes gol', async () => {
  const { rezultat, scrise } = await extrage(0, { brut: '{"cerinte":[', stop: 'max_tokens' })
  assertEquals(typeof rezultat.error, 'string')
  assertEquals(rezultat.trunchiat, true)
  assertEquals(scrise.length, 0)
})

Deno.test('R15: INSERT păstrează neverificat + pagina găsită; rezultatul identifică pasajul parțial', async () => {
  const { rezultat, scrise } = await extrage(1, { pasaj: autentic + ' Final inventat.' })
  assertEquals(scrise[0].pasaj_verificat, false)
  assertEquals(scrise[0].sursa_pagina, 7)
  assertEquals('pasaj_partial' in scrise[0], false) // nu există această coloană
  assertEquals(rezultat.pasaje_verificate, 0)
  assertEquals(rezultat.pasaje_partiale, [{ index: 0, pagina: 7 }])
})

// ── loturi (20261024b) ──────────────────────────────────────────────────────────────────────────────
const lotCol = (r: any) => [r.lot, r.lot_domeniu, r.lot_nr, r.lot_sursa, r.lot_brut]

Deno.test('Loturi: „Lot 12” în numele documentului → [12] (nu 1), sursa nume_fisier când modelul nu spune nimic', async () => {
  const { scrise } = await extrage(1, { nume: 'Caiet de sarcini LOT 12.pdf' })
  assertEquals(lotCol(scrise[0]), ['12', 'lista', [12], 'nume_fisier', null])
})
Deno.test('Loturi: modelul dă „Lot 12” → [12] cu sursa model și lot_brut păstrat', async () => {
  const { scrise } = await extrage(1, { lot: 'Lot 12' })
  assertEquals(lotCol(scrise[0]), ['Lot 12', 'lista', [12], 'model', 'Lot 12'])
})
Deno.test('Loturi: conflict nume/model → câștigă modelul (text explicit), conflictul se numără', async () => {
  const { rezultat, scrise } = await extrage(2, { nume: 'CS Lot 12.pdf', lot: 'lotul 3' })
  assertEquals(lotCol(scrise[0]), ['lotul 3', 'lista', [3], 'model', 'lotul 3'])
  assertEquals(rezultat.lot_conflict_nume, 2)
})
Deno.test('Loturi: model neinterpretabil + lot în nume → lista din nume, lot_brut = textul modelului', async () => {
  const { scrise } = await extrage(1, { nume: 'CS_Lot2_vol1.pdf', lot: 'vezi anexa' })
  assertEquals(lotCol(scrise[0]), ['vezi anexa', 'lista', [2], 'nume_fisier', 'vezi anexa'])
})
Deno.test('Loturi: necunoscut ≠ toate — coloanele noi rămân necunoscut, coloana veche „toate” (compatibilitate UI)', async () => {
  const { rezultat, scrise } = await extrage(1, {})
  assertEquals(lotCol(scrise[0]), ['toate', 'necunoscut', null, 'model', null])
  assertEquals(rezultat.lot_necunoscut, 1)
  const gol = await extrage(1, { lot: '' })
  assertEquals(lotCol(gol.scrise[0]), ['toate', 'necunoscut', null, 'model', null])
  const toate = await extrage(1, { lot: 'toate' })                    // „toate” doar explicit
  assertEquals(lotCol(toate.scrise[0]), ['toate', 'toate', null, 'model', 'toate'])
  const numar = await extrage(1, { lot: 2 })                          // număr JSON, nu text: coloana veche ca înainte
  assertEquals(lotCol(numar.scrise[0]), ['toate', 'lista', [2], 'model', '2'])
})
Deno.test('Poarta loturi (corpus): document neeligibil → zero apeluri AI, zero scrieri, răspuns de business', async () => {
  const { rezultat, scrise, apeluri } = await extrage(3, { eligibil: 'in_afara_loturilor' })
  assertEquals([apeluri.ai, scrise.length], [0, 0])
  assertEquals([rezultat.ok, rezultat.blocat_lot, rezultat.motiv, rezultat.continua, 'error' in rezultat], [false, true, 'in_afara_loturilor', false, false])
  assertEquals(apeluri.rpc, [{ nume: 'fn_ofertare_document_eligibil', args: { p_document_id: 2 } }])
})
Deno.test('Poarta loturi: RPC căzut = neeligibil (fail-closed), zero AI', async () => {
  const { rezultat, apeluri } = await extrage(3, { rpcEroare: true })
  assertEquals([apeluri.ai, rezultat.blocat_lot, rezultat.motiv], [0, true, 'eroare_poarta'])
})
Deno.test('Poarta loturi (fișa de date): fără excepție în cod — fișa neeligibilă nu ajunge la AI', async () => {
  const blocat = await extrage(3, { eligibil: 'loturi_neinitializate', corp: { licitatie_id: 1, sectiune: 'II' } })
  assertEquals([blocat.apeluri.ai, blocat.scrise.length, blocat.rezultat.blocat_lot, blocat.rezultat.doc_id], [0, 0, true, 3])
  assertEquals(blocat.apeluri.rpc, [{ nume: 'fn_ofertare_document_eligibil', args: { p_document_id: 3 } }])
  const ok = await extrage(1, { corp: { licitatie_id: 1, sectiune: 'II' } })
  assertEquals([ok.apeluri.ai, ok.scrise.length, ok.scrise[0].lot_domeniu], [1, 1, 'necunoscut'])
})
