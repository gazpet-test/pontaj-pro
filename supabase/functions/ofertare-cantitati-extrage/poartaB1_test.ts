// PR A2 — poarta B1 pe felie: inventarul determinist vs observațiile dovedite.
import { assertEquals } from 'jsr:@std/assert@1'
import { poartaFelie } from './poartaB1.ts'
import { type DepsStructurat, extrageStructurat } from './structurat.ts'

const F3 = 'Formularul F3\nLista cu cantitatile de lucrari\nObiect 3 Str. Platanului\n= NR. SIMBOL ART. CANTITATE UM =\n002 GD11A1 [ 1] M.C. 174.000\nDRENAJ\n0.000 0 Total=\n003 SA11G1 [ 2] M 1160.000\nTEAVA PVC ... DISTRIBUTIE D= 90 MM\n0.000 0 Total=\n'
const C6 = 'C6 Lista consumurilor\n| 1 | 6701152 | m | 120.00 |\n| 2 | 7330400 | buc | 4.00 |\n| 3 | 6701640 | m | 30.00 |\n'
const off = (t: string, s: string, deLa = 0) => deLa + t.indexOf(s)

Deno.test('A2: F3 — ambele ancore acoperite de observații dovedite → fără deficit', () => {
  const p = poartaFelie(F3, 0, 'f3', [{ cantitate_offset: off(F3, '174.000'), pozitie_dovedita: true }, { cantitate_offset: off(F3, '1160.000'), pozitie_dovedita: true }])
  assertEquals([p.aplicabil, p.ancore, p.acoperite, p.deficit, p.neacoperite], [true, 2, 2, false, []])
})

Deno.test('A2: rândul omis de model = deficit, cu nr. crt. și offsetul absolut (felia începe la 5000)', () => {
  const p = poartaFelie(F3, 5000, 'f3', [{ cantitate_offset: off(F3, '1160.000', 5000), pozitie_dovedita: true }])
  assertEquals([p.ancore, p.acoperite, p.deficit], [2, 1, true])
  assertEquals(p.neacoperite, [{ nr_id: '002', linie: 5, offset: 5000 + F3.indexOf('002 GD11A1') }])
})

Deno.test('A2: o observație NEDOVEDITĂ sau fără offset nu acoperă rândul (fail-closed)', () => {
  const p = poartaFelie(F3, 0, 'f3', [{ cantitate_offset: off(F3, '174.000'), pozitie_dovedita: false }, { cantitate_offset: null, pozitie_dovedita: true },
    { cantitate_offset: off(F3, '1160.000'), pozitie_dovedita: true }])
  assertEquals([p.acoperite, p.deficit, p.neacoperite.map((x) => x.nr_id)], [1, true, ['002']])
})

Deno.test('A2: cantitatea din blocul ALTUI rând nu acoperă (un rând dublat nu poate ascunde unul omis)', () => {
  const p = poartaFelie(F3, 0, 'f3', [{ cantitate_offset: off(F3, '1160.000'), pozitie_dovedita: true }, { cantitate_offset: off(F3, '1160.000'), pozitie_dovedita: true }])
  assertEquals([p.acoperite, p.deficit], [1, true])
})

Deno.test('A2: C6 — doar ancorele de lungime se cer (promptul extrage în C6 doar m / km)', () => {
  const p = poartaFelie(C6, 0, 'c6', [{ cantitate_offset: off(C6, '120.00'), pozitie_dovedita: true }])
  assertEquals([p.ancore, p.acoperite, p.deficit, p.neacoperite.map((x) => x.nr_id)], [2, 1, true, ['3']])
})

Deno.test('A2: rolurile fără tabel numerotat (cs, memoriu, …) nu sunt supuse porții', () => {
  for (const rol of ['cs', 'memoriu', 'fisa_date', 'lista_alt', null]) assertEquals(poartaFelie(F3, 0, rol, []).aplicabil, false)
})

Deno.test('A2: în extragerea structurată, poarta apare în raportul feliei și în felii_cu_deficit_b1 (doar măsurare, fără altă schimbare)', async () => {
  // modelul întoarce doar rândul 003 — 002 (174 mc) lipsește
  const rand003 = { pagina: null, tabel: null, rand: '003', cod_articol: 'SA11G1', denumire: 'TEAVA PVC ... DISTRIBUTIE D= 90 MM', obiect: 'Str. Platanului',
    material: 'PVC', dn_text: 'D= 90 MM', sdr: null, um: 'M', cantitate: '1160.000', e_total: 0, e_subtotal: 0, tip_lucrare: 'conducta', masura: 'lungime',
    citat: '003 SA11G1 [ 2] M 1160.000' }
  const apeluri: string[] = []
  const deps: DepsStructurat = {
    rpc: async (fn, args) => {
      if (fn === 'fn_ofertare_cb_text_valid') return { data: { tip: 'prov', id: 1 }, error: null }
      apeluri.push(fn.replace('fn_ofertare_cb_', '') + (fn.endsWith('inchide') ? ':' + args.p_stare : ''))
      if (fn === 'fn_ofertare_cb_extragere_incepe_grup') return { data: { ok: true, cache: false, extragere_id: 7 }, error: null }
      if (fn === 'fn_ofertare_cb_felie_incepe') return { data: { ok: true, felie_id: 70 }, error: null }
      if (fn === 'fn_ofertare_cb_rezerva') return { data: { ok: true, rezervare_id: 900 }, error: null }
      return { data: { ok: true }, error: null }
    },
    cerere: async () => ({ id: 5, licitatie_id: 15, scop: 'cant_extragere', stare: 'activa', valabil_pana: new Date(Date.now() + 3600e3).toISOString(), lot_domeniu: 'toate', lot_nr: [] }),
    documente: async () => [{ id: 212, nume_original: 'Liste de cantitati.pdf', tip: 'lista_cantitati', text_extras: F3, seap_meta: null, lot_stare: 'comun' }],
    deciziiRol: async () => [], lotDocument: async (_l, ids) => new Map(ids.map((i) => [i, { domeniu: 'toate' as const, loturi: [] }])),
    extragereInLucru: async () => null, ultimaIncercare: async () => null,
    ai: async () => ({ txt: JSON.stringify({ r: [rand003] }), inF: 1000, outF: 200 }), acum: () => 0,
  }
  const r = await extrageStructurat(deps, { licitatie_id: 15, cerere_id: 5, extractor: 'A' })
  assertEquals(r.body.felii_cu_deficit_b1, 1)
  const fel = (r.body.raport as any[]).find((x) => x.felie === 0)
  assertEquals(fel.poarta_b1, { ancore: 2, acoperite: 1, incerte: 0, tabele_nedeterminate: 0, deficit: true, complet: false, neacoperite: ['002'] })
  // A2 nu schimbă fluxul: felia e tot „gata” (escaladarea vine în A3)
  assertEquals(apeluri, ['extragere_incepe_grup', 'felie_incepe', 'rezerva', 'deconteaza', 'obs_scrie', 'felie_inchide:gata', 'extragere_inchide:gata'])
})

// ── review Copilot / Gemini A2+A3 r1 ──
Deno.test('A2 r2 (Copilot P1): o altă cantitate din blocul ancorei NU acoperă rândul omis — doar tokenul cantității ei', () => {
  const t = '1 Conducta m 100\nNota consum m 20\n2 Teava m 30\n'
  const p = poartaFelie(t, 0, 'f3', [{ cantitate_offset: t.indexOf('20'), pozitie_dovedita: true }, { cantitate_offset: t.indexOf('30'), pozitie_dovedita: true }])
  assertEquals([p.ancore, p.acoperite, p.deficit, p.neacoperite.map((x) => x.nr_id)], [2, 1, true, ['1']])
  // tokenul exact al cantității acoperă
  const q = poartaFelie(t, 0, 'f3', [{ cantitate_offset: t.indexOf('100'), pozitie_dovedita: true }, { cantitate_offset: t.indexOf('30'), pozitie_dovedita: true }])
  assertEquals([q.acoperite, q.deficit, q.complet], [2, false, true])
})

Deno.test('A2 r2 (Gemini / Copilot P1): incertul cu cantitate nerecunoscută (separator de mii) se CERE; omis → deficit (escaladare)', () => {
  const t = '1 RPC01 Conducta m 1 234,50\n2 SA11G1 Conducta m 500.00\n'
  const omis = poartaFelie(t, 0, 'f3', [{ cantitate_offset: t.indexOf('500.00'), pozitie_dovedita: true }])
  assertEquals([omis.ancore, omis.acoperite, omis.deficit], [2, 1, true])
  const extras = poartaFelie(t, 0, 'f3', [{ cantitate_offset: t.indexOf('1 234,50'), pozitie_dovedita: true }, { cantitate_offset: t.indexOf('500.00'), pozitie_dovedita: true }])
  assertEquals([extras.acoperite, extras.deficit], [2, false])
})

Deno.test('A2 r2: doar incerte (fără ancore) + model gol → deficit, nu „complet”', () => {
  const t = '1 RPC01 Conducta m 1 234,50\n2 RPC02 Teava m 2 450,00\n'
  const p = poartaFelie(t, 0, 'f3', [])
  assertEquals([p.ancore, p.acoperite, p.deficit, p.complet], [2, 0, true, false])
})

Deno.test('A2 r2 (Copilot P1): incertele doar semnalate și tabelele nedeterminate fac felia „incompletă”, fără deficit', () => {
  const t = '| 1 | A | m | 1 |\n| 2m adancime | m | 10 |\n| 3 | C | m | 1 |\n'
  const p = poartaFelie(t, 0, 'f3', [{ cantitate_offset: t.indexOf('| 1 |') + t.slice(t.indexOf('| 1 |')).indexOf(' 1 |', 3) + 1, pozitie_dovedita: true }])
  assertEquals([p.incerte >= 1, p.tabele_nedeterminate >= 1, p.complet], [true, true, false])
})
