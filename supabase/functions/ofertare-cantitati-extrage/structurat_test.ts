import { assert, assertEquals } from 'jsr:@std/assert@1'
import { aplicaDecizii, type DepsStructurat, EXTRACTOR_ID, extractorCuContext, extrageStructurat, radacinaParte, sumaRezervata } from './structurat.ts'
import { feliiCuPozitie, FELIE, SUPRAPUNERE } from './sectiuni.ts'

const TEXT_F3 = 'Formularul F3\nLista cu cantitatile de lucrari\nObiect 3 Str. Platanului\n003 SA11G1 [ 2] M 1160.000\nTEAVA PVC ... DISTRIBUTIE D= 90 MM\n'
const RAND = [null, null, null, 'SA11G1', 'TEAVA PVC ... DISTRIBUTIE D= 90 MM', 'Str. Platanului', 'PVC', 'D= 90 MM', null, 'M', '1160.000', 0, 0,
  'conducta', 'lungime', '003 SA11G1 [ 2] M 1160.000']
const ACUM = new Date(Date.now() + 3600e3).toISOString()
const DOC = { id: 212, nume_original: 'Liste de cantitati — p01_pag1-104.pdf', tip: 'lista_cantitati', text_extras: TEXT_F3, seap_meta: null, lot_stare: 'comun' }

type Opt = { cerere?: any; refuzRezerva?: string; aiEroare?: boolean; aiAruncă?: boolean; cache?: boolean; pesteRezervare?: boolean
  inLucru?: number | null; inLucruCerere?: number; docsDupa?: any[]; grupSchimbat?: boolean; refuzGrup?: string; decizii?: any[]; ultima?: any; feliiExistente?: boolean; raspuns?: string; docs?: any[]; nevalide?: number[] }
function fals(opt: Opt = {}) {
  const apeluri: string[] = []
  let obsScrise: any[] = []
  const toateObs: any[][] = []
  let aiApeluri = 0
  const argsGrup: any[] = []
  let nDoc = 0
  const extractori: string[] = []
  const deps: DepsStructurat = {
    rpc: async (fn, args) => {
      if (fn === 'fn_ofertare_cb_text_valid') return { data: (opt.nevalide || []).includes(Number(args.p_document_id)) ? {} : { tip: 'prov', id: 1 }, error: null }
      apeluri.push(fn.replace('fn_ofertare_cb_', '') + (fn.endsWith('inchide') ? ':' + args.p_stare : ''))
      switch (fn) {
        case 'fn_ofertare_cb_extragere_incepe_grup':
          argsGrup.push(args)
          if (opt.grupSchimbat) return { data: { refuz: 'grup_schimbat' }, error: null }
          if (opt.refuzGrup) return { data: { refuz: opt.refuzGrup }, error: null }
          extractori.push(String(args.p_extractor_id))
          if (opt.cache) return { data: { ok: true, cache: true, extragere_id: 7 }, error: null }
          if (opt.inLucru !== undefined) return { data: { refuz: 'extragere_in_lucru' }, error: null }
          return { data: { ok: true, cache: false, extragere_id: 7 }, error: null }
        case 'fn_ofertare_cb_felie_incepe':
          return opt.feliiExistente ? { data: { refuz: 'munca_existenta', munca_id: 'm' + args.p_felie_nr }, error: null }
            : { data: { ok: true, felie_id: 70 + Number(args.p_felie_nr) }, error: null }
        case 'fn_ofertare_cb_rezerva': return { data: opt.refuzRezerva ? { refuz: opt.refuzRezerva } : { ok: true, rezervare_id: 900 }, error: null }
        case 'fn_ofertare_cb_deconteaza': return { data: { ok: true, peste_rezervare: !!opt.pesteRezervare }, error: null }
        case 'fn_ofertare_cb_obs_scrie': obsScrise = args.p_obs as any[]; toateObs.push(obsScrise); return { data: { ok: true }, error: null }
        default: return { data: { ok: true }, error: null }
      }
    },
    cerere: async () => opt.cerere === undefined
      ? { id: 5, licitatie_id: 15, scop: 'cant_extragere', stare: 'activa', valabil_pana: ACUM, lot_domeniu: 'toate', lot_nr: [] } : opt.cerere,
    documente: async () => { nDoc++; return nDoc > 1 && opt.docsDupa ? opt.docsDupa : (opt.docs ?? [DOC]) },
    deciziiRol: async () => opt.decizii ?? [],
    lotDocument: async (_l, ids) => new Map(ids.map((i) => [i, { domeniu: 'toate' as const, loturi: [] }])),
    extragereInLucru: async () => (opt.inLucru ? { id: opt.inLucru, cerere_id: opt.inLucruCerere ?? 5 } : null),
    ultimaIncercare: async () => opt.ultima ?? null,
    ai: async () => {
      aiApeluri++
      if (opt.aiAruncă) throw new TypeError('fetch failed')
      return opt.aiEroare ? { txt: '', inF: 0, outF: 0, eroare: 'timeout' } : { txt: opt.raspuns ?? JSON.stringify({ r: [RAND] }), inF: 1000, outF: 200 }
    },
    acum: () => 0,
  }
  return { deps, apeluri, obs: () => obsScrise, prima: () => toateObs[0] || [], ai: () => aiApeluri, extractori, argsGrup }
}
const RULEAZA = (f: ReturnType<typeof fals>) => extrageStructurat(f.deps, { licitatie_id: 15, cerere_id: 5 })

Deno.test('fără cerere activă → 402, niciun RPC de muncă și niciun apel AI', async () => {
  for (const cerere of [null, { id: 5, licitatie_id: 15, scop: 'cant_extragere', stare: 'anulata', valabil_pana: ACUM, lot_domeniu: 'toate', lot_nr: [] },
    { id: 5, licitatie_id: 99, scop: 'cant_extragere', stare: 'activa', valabil_pana: ACUM, lot_domeniu: 'toate', lot_nr: [] },
    { id: 5, licitatie_id: 15, scop: 'audit_raspunsuri', stare: 'activa', valabil_pana: ACUM, lot_domeniu: 'toate', lot_nr: [] }]) {
    const f = fals({ cerere })
    const r = await RULEAZA(f)
    assertEquals([r.status, f.apeluri.length, f.ai()], [402, 0, 0])
  }
})

Deno.test('drumul normal: extragere → felie → rezervare → apel → decontare → observații → felie gata → extragere gata', async () => {
  const f = fals()
  const r = await RULEAZA(f)
  assertEquals(r.status, 200)
  assertEquals(f.apeluri, ['extragere_incepe_grup', 'felie_incepe', 'rezerva', 'deconteaza', 'obs_scrie', 'felie_inchide:gata', 'extragere_inchide:gata'])
  const o = f.obs()[0]
  assertEquals([o.rol_sursa, o.rol_decis_de, o.cantitate, o.pozitie_dovedita, o.dn_mm, o.um_norm], ['f3', 'antet', 1160, true, [90], 'm'])
  assertEquals(o.cantitate_offset, TEXT_F3.indexOf('1160.000'))
  assert(f.extractori[0].startsWith(EXTRACTOR_ID + '@c-'))
})

Deno.test('cache: a doua extragere pe aceeași versiune = 0 apeluri AI', async () => {
  const f = fals({ cache: true })
  await RULEAZA(f)
  assertEquals([f.ai(), f.apeluri], [0, ['extragere_incepe_grup']])
})

Deno.test('plafonul refuză ÎNAINTEA apelului: felia „esuat”, oprire, extragerea închisă controlat (esuat)', async () => {
  const f = fals({ refuzRezerva: 'plafon' })
  const r = await RULEAZA(f)
  assertEquals(f.ai(), 0)
  assertEquals(f.apeluri, ['extragere_incepe_grup', 'felie_incepe', 'rezerva', 'felie_inchide:esuat', 'extragere_inchide:esuat'])
  assertEquals(r.body.oprit, 'rezervare:plafon')
})

Deno.test('eroare SAU excepție la apel → rezervarea „necunoscuta” + felia „necunoscut”', async () => {
  for (const o of [{ aiEroare: true }, { aiAruncă: true }]) {
    const f = fals(o)
    await RULEAZA(f)
    assertEquals(f.apeluri, ['extragere_incepe_grup', 'felie_incepe', 'rezerva', 'rezervare_necunoscuta', 'felie_inchide:necunoscut', 'extragere_inchide:esuat'])
  }
})

Deno.test('un rând nenormalizabil → felia „esuat”, fără observații (nu „gata” cu un candidat pierdut)', async () => {
  const f = fals({ raspuns: JSON.stringify({ r: [RAND, ['trunchiat']] }) })
  await RULEAZA(f)
  assertEquals(f.apeluri, ['extragere_incepe_grup', 'felie_incepe', 'rezerva', 'deconteaza', 'felie_inchide:esuat', 'extragere_inchide:esuat'])
  assertEquals(f.obs(), [])
})

Deno.test('cost peste rezervare → oprire după felie; extragerea închisă controlat', async () => {
  const f = fals({ pesteRezervare: true })
  const r = await RULEAZA(f)
  assertEquals(r.body.oprit, 'cost_peste_rezervare (buget blocat)')
  assertEquals(f.apeluri.at(-1), 'extragere_inchide:gata')
})

Deno.test('preluarea unei extrageri rămase în lucru: felie gata = numărată; reluare autorizată (în zbor fără rezervare) = continuată', async () => {
  const a = fals({ inLucru: 41, feliiExistente: true, ultima: { id: 99, stare: 'gata', rezervare_id: 1 } })
  await RULEAZA(a)
  assertEquals([a.ai(), a.apeluri], [0, ['extragere_incepe_grup', 'felie_incepe', 'extragere_inchide:gata']])
  const b = fals({ inLucru: 41, feliiExistente: true, ultima: { id: 98, stare: 'in_zbor', rezervare_id: null } })
  await RULEAZA(b)
  assertEquals(b.apeluri, ['extragere_incepe_grup', 'felie_incepe', 'rezerva', 'deconteaza', 'obs_scrie', 'felie_inchide:gata', 'extragere_inchide:gata'])
  const c = fals({ inLucru: 41, feliiExistente: true, ultima: { id: 97, stare: 'necunoscut', rezervare_id: 3 } })
  const rc = await RULEAZA(c)
  assertEquals(c.ai(), 0)
  assert(JSON.stringify(rc.body.raport).includes('asteapta_om'))
  // r4: o felie care așteaptă omul lasă extragerea în lucru (fără închidere din contorul local)
  assert(!c.apeluri.some((x) => x.startsWith('extragere_inchide')))
})

Deno.test('convenția doar din părțile cu text VALID: o parte nevalidă nu dovedește convenția celeilalte', async () => {
  const p1 = { ...DOC, id: 1, nume_original: 'Lista — p01_pag1-10.pdf', text_extras: 'Formularul F3\nLista cu cantitatile de lucrari\n003 SA11G1 [ 2] M 570.000\n' }
  const p2 = { ...DOC, id: 2, nume_original: 'Lista — p02_pag11-20.pdf', text_extras: 'Formularul F3\nLista cu cantitatile de lucrari\n003 X M 1160.000\n' }
  const rand = [null, null, null, null, 'TEAVA', null, null, null, null, 'M', '570.000', 0, 0, 'conducta', 'lungime', '003 SA11G1 [ 2] M 570.000']
  const f = fals({ docs: [p1, p2], nevalide: [2], raspuns: JSON.stringify({ r: [rand] }) })
  await RULEAZA(f)
  assertEquals([f.prima()[0].pozitie_dovedita, f.prima()[0].valoare_ambigua], [false, true])
  assert(f.extractori[0].includes('@c-nedeterminata-'))
  const g = fals({ docs: [p1, p2], raspuns: JSON.stringify({ r: [rand] }) })
  await RULEAZA(g)
  assertEquals(g.prima()[0].pozitie_dovedita, true)
  assert(g.extractori[0].includes('@c-en-'))
})

Deno.test('identitatea extractorului depinde de context (convenție, manifestul grupului, decizii)', async () => {
  const a = await extractorCuContext('en', ['1:a', '2:b'], [])
  assertEquals(a, await extractorCuContext('en', ['2:b', '1:a'], []))
  assert(a !== await extractorCuContext('ro', ['1:a', '2:b'], []))
  assert(a !== await extractorCuContext('en', ['1:a', '2:c'], []))
  assert(a !== await extractorCuContext('en', ['1:a', '2:b'], [{ document_id: 1, doc_sha256: 'a', rol: 'atr', sectiune: '2-3', decizie: 'rol_confirmat' }]))
})

Deno.test('feliile cu offsetul din feliere (text repetat: a doua felie NU e plasată la prima apariție)', () => {
  const t = 'Formular F3\n' + 'aceeasi linie de text repetata\n'.repeat(5000)
  const f = feliiCuPozitie(t)
  assert(f.length > 1)
  assertEquals(f[1].de, FELIE - SUPRAPUNERE)
  for (const x of f) assertEquals(t.slice(x.de, x.de + x.text.length), x.text)
})

Deno.test('rezervarea = limită superioară: octeți × tarif intrare + ieșirea maximă', () => {
  assert(sumaRezervata('x'.repeat(55000)) >= 55000 * 0.25e-6 + 16000 * 2e-6)
  assert(sumaRezervata('ă'.repeat(1000)) > sumaRezervata('a'.repeat(1000)))   // diacriticele = 2 octeți
})

Deno.test('părțile aceluiași PDF au aceeași rădăcină; deciziile umane pe secțiune', () => {
  assertEquals(radacinaParte('Liste de cantitati fara valori _X — p02_pag105-176.pdf'), radacinaParte('Liste de cantitati fara valori _X — p01_pag1-104.pdf'))
  const s = [{ de: 0, pana: 10, pagini: [1, 1] as [number, number], rol: 'memoriu' as const, decis_de: 'titlu' as const },
    { de: 10, pana: 20, pagini: [2, 3] as [number, number], rol: 'alt' as const, decis_de: 'titlu' as const }]
  const r = aplicaDecizii(s, [{ rol: 'atr', sectiune: '2-3', decizie: 'rol_confirmat' }, { rol: 'memoriu', sectiune: '1-1', decizie: 'nu_e_sursa_cantitativa' }])
  assertEquals(r.map((x) => [x.rol, x.decis_de]), [[null, 'titlu'], ['atr', 'om']])
})

Deno.test('r2: preluarea doar pe ACEEAȘI cerere; pe altă cerere = refuz, fără apeluri', async () => {
  const f = fals({ inLucru: 41, inLucruCerere: 4, feliiExistente: true, ultima: { id: 98, stare: 'in_zbor', rezervare_id: null } })
  const r = await RULEAZA(f)
  assertEquals([f.ai(), f.apeluri], [0, ['extragere_incepe_grup']])
  assert(JSON.stringify(r.body.raport).includes('in_lucru_pe_alta_cerere'))
})
Deno.test('r2: rezervarea refuzată „felie” (alt worker a rezervat-o între timp) NU închide felia', async () => {
  const f = fals({ refuzRezerva: 'felie' })
  await RULEAZA(f)
  assertEquals(f.ai(), 0)
  assert(!f.apeluri.includes('felie_inchide:esuat'))
  // r3: conflict de muncă → extragerea NU se închide din contorul local (alt worker poate termina felia)
  assert(!f.apeluri.some((x) => x.startsWith('extragere_inchide')))
})
Deno.test('r3: grupul schimbat (verificat atomic în RPC-ul de grup) → tot grupul sărit, fără apeluri de muncă', async () => {
  const f = fals({ grupSchimbat: true })
  const r = await RULEAZA(f)
  assertEquals([f.ai(), f.apeluri], [0, ['extragere_incepe_grup']])
  assert(JSON.stringify(r.body.raport).includes('grup_schimbat'))
})
Deno.test('r6: deciziile de rol folosite trec în RPC-ul de grup; context_schimbat / grup_ocupat = sărit, fără apeluri de muncă', async () => {
  const sha = await (await import('../_shared/cantNormalizare.ts')).sha256Hex(TEXT_F3)
  const f = fals({ decizii: [{ id: 77, document_id: 212, doc_sha256: sha, rol: 'f3', sectiune: '*', decizie: 'rol_confirmat' },
    { id: 78, document_id: 999, doc_sha256: sha, rol: 'atr', sectiune: '*', decizie: 'rol_confirmat' }] })
  await RULEAZA(f)
  assertEquals(f.argsGrup[0].p_decizii, [77])
  for (const refuzGrup of ['context_schimbat', 'grup_ocupat']) {
    const g = fals({ refuzGrup })
    const r = await RULEAZA(g)
    assertEquals([g.ai(), g.apeluri], [0, ['extragere_incepe_grup']])
    assert(JSON.stringify(r.body.raport).includes(refuzGrup))
  }
})
