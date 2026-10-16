import { assert, assertEquals } from 'jsr:@std/assert@1'
import { construieste, type DocBD, type Intrare, manifestCsv, texteCsv } from './asambleaza.ts'
import { sha256Hex } from './lib.ts'

const amp = (pagini: number, offset = 0, id = 0) => ({ identitate: { fisier_path: `p/${id}`, size_bytes: 1, pagina_offset: offset, pagini }, storage: { etag: '"e"', size: 1, updated_at: 'u' },
  pdf_sha256: 'h', pagini_pdf: pagini })
const doc = (id: number, nume: string, pagini: number, offset: number, text: string): DocBD => ({ id, licitatie_id: 15, nume_original: nume, text_extras: text,
  pagini, status_procesare: 'procesat', pagini_necitite: [], procesat_la: '2026-09-08T08:00:00+00', pagini_procesate: pagini, pagini_felie: 8,
  fisier_path: `p/${id}`, size_bytes: 1, pagina_offset: offset })
const pag = (a: number, b: number, corp: (p: number) => string) => Array.from({ length: b - a + 1 }, (_, i) => `⟦PAGINA ${a + i}⟧\n${corp(a + i)}`).join('\n')

Deno.test('asamblare: grupul 212 + 213 (offset 104), convenția din grup decide „3.995”; integritate + calitate; CSV + base64', async () => {
  // 212: o dovadă tare RO („1.234,50 m”); 213: „3.995 m”, ambiguu singur, dar RO în grup → 3995
  const nou212 = pag(1, 2, (p) => (p === 1 ? '| A | 1.234,50 m |' : '| B | 10 m |'))
  const nou213 = pag(1, 2, (p) => (p === 1 ? '| C | 3.995 m |' : '| D | 5 m |'))
  const vechi212 = '⟦PAGINA 1⟧\n| A | 1.234,50 m |\n⟦PAGINA 2⟧\n—'
  const vechi213 = '⟦PAGINA 105⟧\n| C | 3.995 m |\n⟦PAGINA 106⟧\n—'
  const intrari: Intrare[] = [
    { document_id: 212, doc: doc(212, 'Liste — p01_pag1-104.pdf', 2, 0, vechi212), amprenta: amp(2, 0, 212), felii: [{ id: 1, de_la: 1, pana_la: 2, text: nou212 }] },
    { document_id: 213, doc: doc(213, 'Liste — p02_pag105-176.pdf', 2, 104, vechi213), amprenta: amp(2, 104, 213), felii: [{ id: 2, de_la: 1, pana_la: 2, text: nou213 }] },
  ]
  const r = await construieste(intrari)
  const d213 = r.find((x) => x.document_id === 213)!
  assertEquals(d213.text_nou!.startsWith('⟦PAGINA 105⟧'), true)
  assertEquals(d213.raport_nou!.suma_m, 3995 + 5)
  assertEquals([d213.integritate_ok, d213.calitate_ok], [true, true])
  assertEquals(d213.sha_nou, await sha256Hex(d213.text_nou!))
  const csv = manifestCsv(r)
  assertEquals(csv.split('\n').length, 2 + 2)                       // antet + 2 rânduri + linie finală goală
  assert(csv.endsWith('\n') && !csv.includes('\r'))
  const t = texteCsv(r).split('\n')[2].split(',')
  assertEquals(new TextDecoder().decode(Uint8Array.from(atob(t[1]), (c) => c.charCodeAt(0))), d213.text_nou)
})

Deno.test('asamblare: o felie cu marcaje greșite sau acoperire incompletă → integritate NU, fără text, absent din manifest', async () => {
  const r = await construieste([
    { document_id: 212, doc: doc(212, 'X', 3, 0, '⟦PAGINA 1⟧ a'), amprenta: amp(3, 0, 212), felii: [{ id: 1, de_la: 1, pana_la: 2, text: pag(1, 2, () => 'x') }] },
    { document_id: 137, doc: doc(137, 'Y', 2, 0, '⟦PAGINA 1⟧ a'), amprenta: amp(2, 0, 137), felii: [{ id: 3, de_la: 1, pana_la: 2, text: '⟦PAGINA 1⟧ a ⟦PAGINA 1⟧ b' }] },
  ])
  assertEquals(r.map((x) => [x.document_id, x.integritate_ok, x.text_nou]), [[137, false, null], [212, false, null]])
  assertEquals(manifestCsv(r).split('\n').length, 2)
})

Deno.test('asamblare: un document în afara whitelist-ului → eroare', async () => {
  let err = ''
  try { await construieste([{ document_id: 999, doc: doc(999, 'Z', 1, 0, 'a'), amprenta: amp(1), felii: [] }]) } catch (e) { err = String(e) }
  assert(/whitelist/.test(err))
})

Deno.test('r1 Jakarinos #5: identitatea curentă ≠ cea citită (offset 104 → 999) → integritate NU, fără text', async () => {
  const a = amp(2, 104, 213)
  const r = await construieste([{ document_id: 213, doc: doc(213, 'L — p02_pag105-176.pdf', 2, 999, '⟦PAGINA 105⟧ a'), amprenta: a,
    felii: [{ id: 2, de_la: 1, pana_la: 2, text: pag(1, 2, () => 'x') }] }])
  assertEquals([r[0].integritate_ok, r[0].text_nou], [false, null])
  assert(/identitate_schimbata/.test(r[0].motive.join()))
})
