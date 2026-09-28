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
async function extrage(n: number, opt: { stop?: string; brut?: string; pasaj?: string } = {}) {
  const scrise: any[] = []
  const db = { from(tabel: string) {
    const rezultat = { data: tabel === 'ofertare_licitatii' ? { id: 1, autoritate: 'Test', nr_anunt: 'Test' }
      : tabel === 'ofertare_documente_atribuire' ? { id: 2, tip: 'cs_volum', text_extras: document, nume_original: 'Test' } : [], error: null }
    const q: any = {
      select: () => q, eq: () => q, order: () => q, limit: () => q,
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
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({
    stop_reason: opt.stop || 'end_turn', usage: {}, content: [{ type: 'text', text: opt.brut ?? JSON.stringify({
      cerinte: Array.from({ length: n }, (_, i) => ({ text_cerinta: `Cerință ${i}`, pasaj: opt.pasaj ?? autentic, pagina: 2 })),
    }) }],
  })))) as typeof fetch
  try {
    return { rezultat: await extrageCerinte(db, { licitatie_id: 1, doc_id: 2 }), scrise }
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
