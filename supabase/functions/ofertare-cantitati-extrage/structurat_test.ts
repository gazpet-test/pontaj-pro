import { assert, assertEquals } from 'jsr:@std/assert@1'
import { aplicaDecizii, type DepsStructurat, EXTRACTOR_ID, extrageStructurat, radacinaParte, sumaRezervata } from './structurat.ts'

const TEXT_F3 = 'Formularul F3\nLista cu cantitatile de lucrari\nObiect 3 Str. Platanului\n003 SA11G1 [ 2] M 1160.000\nTEAVA PVC ... DISTRIBUTIE D= 90 MM\n'
const RAND = [null, null, null, 'SA11G1', 'TEAVA PVC ... DISTRIBUTIE D= 90 MM', 'Str. Platanului', 'PVC', 'D= 90 MM', null, 'M', '1160.000', 0, 0,
  'conducta', 'lungime', '003 SA11G1 [ 2] M 1160.000']
const ACUM = new Date(Date.now() + 3600e3).toISOString()

function fals(opt: { cerere?: any; refuzRezerva?: string; aiEroare?: boolean; cache?: boolean; pesteRezervare?: boolean } = {}) {
  const apeluri: string[] = []
  let obsScrise: any[] = []
  let aiApeluri = 0
  const deps: DepsStructurat = {
    rpc: async (fn, args) => {
      apeluri.push(fn.replace('fn_ofertare_cb_', '') + (fn.endsWith('inchide') ? ':' + args.p_stare : ''))
      switch (fn) {
        case 'fn_ofertare_cb_extragere_incepe':
          return { data: opt.cache ? { ok: true, cache: true, extragere_id: 7 } : { ok: true, cache: false, extragere_id: 7 }, error: null }
        case 'fn_ofertare_cb_felie_incepe': return { data: { ok: true, felie_id: 70 + Number(args.p_felie_nr) }, error: null }
        case 'fn_ofertare_cb_rezerva': return { data: opt.refuzRezerva ? { refuz: opt.refuzRezerva } : { ok: true, rezervare_id: 900 }, error: null }
        case 'fn_ofertare_cb_deconteaza': return { data: { ok: true, peste_rezervare: !!opt.pesteRezervare }, error: null }
        case 'fn_ofertare_cb_obs_scrie': obsScrise = args.p_obs as any[]; return { data: { ok: true }, error: null }
        default: return { data: { ok: true }, error: null }
      }
    },
    cerere: async () => opt.cerere === undefined
      ? { id: 5, licitatie_id: 15, scop: 'cant_extragere', stare: 'activa', valabil_pana: ACUM, lot_domeniu: 'toate', lot_nr: [] } : opt.cerere,
    documente: async () => [{ id: 212, nume_original: 'Liste de cantitati — p01_pag1-104.pdf', tip: 'lista_cantitati', text_extras: TEXT_F3, seap_meta: null, lot_stare: 'comun' }],
    deciziiRol: async () => [],
    lotDocument: async () => new Map([[212, { domeniu: 'toate' as const, loturi: [] }]]),
    ai: async () => { aiApeluri++; return opt.aiEroare ? { txt: '', inF: 0, outF: 0, eroare: 'timeout' } : { txt: JSON.stringify({ r: [RAND] }), inF: 1000, outF: 200 } },
    acum: () => 0,
  }
  return { deps, apeluri, obs: () => obsScrise, ai: () => aiApeluri }
}

Deno.test('fără cerere activă → 402, niciun RPC de muncă și niciun apel AI', async () => {
  for (const cerere of [null, { id: 5, licitatie_id: 15, scop: 'cant_extragere', stare: 'anulata', valabil_pana: ACUM, lot_domeniu: 'toate', lot_nr: [] },
    { id: 5, licitatie_id: 99, scop: 'cant_extragere', stare: 'activa', valabil_pana: ACUM, lot_domeniu: 'toate', lot_nr: [] },
    { id: 5, licitatie_id: 15, scop: 'audit_raspunsuri', stare: 'activa', valabil_pana: ACUM, lot_domeniu: 'toate', lot_nr: [] }]) {
    const f = fals({ cerere })
    const r = await extrageStructurat(f.deps, { licitatie_id: 15, cerere_id: 5 })
    assertEquals([r.status, f.apeluri.length, f.ai()], [402, 0, 0])
  }
})

Deno.test('drumul normal: extragere → felie → rezervare → apel → decontare → observații → felie gata → extragere gata', async () => {
  const f = fals()
  const r = await extrageStructurat(f.deps, { licitatie_id: 15, cerere_id: 5 })
  assertEquals(r.status, 200)
  assertEquals(f.apeluri, ['extragere_incepe', 'felie_incepe', 'rezerva', 'deconteaza', 'obs_scrie', 'felie_inchide:gata', 'extragere_inchide:gata'])
  const o = f.obs()[0]
  assertEquals([o.rol_sursa, o.rol_decis_de, o.cantitate, o.pozitie_dovedita, o.dn_mm, o.um_norm], ['f3', 'antet', 1160, true, [90], 'm'])
  assertEquals(o.cantitate_offset, TEXT_F3.indexOf('1160.000'))
  assertEquals(r.body.extractor_id, EXTRACTOR_ID)
})

Deno.test('cache: a doua extragere pe aceeași versiune = 0 apeluri AI', async () => {
  const f = fals({ cache: true })
  await extrageStructurat(f.deps, { licitatie_id: 15, cerere_id: 5 })
  assertEquals([f.ai(), f.apeluri], [0, ['extragere_incepe']])
})

Deno.test('plafonul refuză ÎNAINTEA apelului: felia „esuat”, oprire, 0 apeluri AI', async () => {
  const f = fals({ refuzRezerva: 'plafon' })
  const r = await extrageStructurat(f.deps, { licitatie_id: 15, cerere_id: 5 })
  assertEquals(f.ai(), 0)
  assertEquals(f.apeluri, ['extragere_incepe', 'felie_incepe', 'rezerva', 'felie_inchide:esuat'])
  assertEquals(r.body.oprit, 'rezervare:plafon')
})

Deno.test('eroare la apel → rezervarea „necunoscuta” + felia „necunoscut”; extragerea nu e „gata”', async () => {
  const f = fals({ aiEroare: true })
  await extrageStructurat(f.deps, { licitatie_id: 15, cerere_id: 5 })
  assertEquals(f.apeluri, ['extragere_incepe', 'felie_incepe', 'rezerva', 'rezervare_necunoscuta', 'felie_inchide:necunoscut', 'extragere_inchide:esuat'])
})

Deno.test('cost peste rezervare (buget blocat la decontare) → oprire după felie, extragerea rămâne în lucru', async () => {
  const f = fals({ pesteRezervare: true })
  const r = await extrageStructurat(f.deps, { licitatie_id: 15, cerere_id: 5 })
  assertEquals(r.body.oprit, 'cost_peste_rezervare (buget blocat)')
  assert(!f.apeluri.some((x) => x.startsWith('extragere_inchide')))
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
