// PR A1 — extractorul A (Claude Haiku 5.5, structured outputs) în modul structurat: schema, apelul, tariful pe trepte, identitatea.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { CAMPURI_RAND, randDinTablou } from '../_shared/cantNormalizare.ts'
import { cheamaA, MODEL_A, SCHEMA_A, TARIF_A, tarifA } from './extractorA.ts'
import { type DepsStructurat, EXTRACTOARE, EXTRACTOR_ID, extrageStructurat, idExtractor, MAX_IESIRE, sumaRezervata } from './structurat.ts'

const TEXT_F3 = 'Formularul F3\nLista cu cantitatile de lucrari\nObiect 3 Str. Platanului\n= NR. SIMBOL ART. CANTITATE UM =\n002 GD11A1 [ 1] M.C. 174.000\nDRENAJ\n0.000 0 Total=\n003 SA11G1 [ 2] M 1160.000\nTEAVA PVC ... DISTRIBUTIE D= 90 MM\n0.000 0 Total=\n'
const OBIECT_RAND = { pagina: null, tabel: null, rand: '003', cod_articol: 'SA11G1', denumire: 'TEAVA PVC ... DISTRIBUTIE D= 90 MM', obiect: 'Str. Platanului',
  material: 'PVC', dn_text: 'D= 90 MM', sdr: null, um: 'M', cantitate: '1160.000', e_total: 0, e_subtotal: 0, tip_lucrare: 'conducta', masura: 'lungime',
  citat: '003 SA11G1 [ 2] M 1160.000' }
const RAND_002 = { ...OBIECT_RAND, rand: '002', cod_articol: 'GD11A1', denumire: 'DRENAJ', material: null, dn_text: null, um: 'M.C.', cantitate: '174.000',
  tip_lucrare: 'alt', masura: 'alt', citat: '002 GD11A1 [ 1] M.C. 174.000' }

Deno.test('A1: schema = exact câmpurile normalizării, toate obligatorii, fără chei străine; obiectul conform trece prin randDinTablou', () => {
  const it = ((SCHEMA_A as any).properties.r as any).items
  assertEquals(Object.keys(it.properties), [...CAMPURI_RAND])
  assertEquals(it.required, [...CAMPURI_RAND])
  assertEquals([it.additionalProperties, SCHEMA_A.additionalProperties], [false, false])
  // câmpurile de domeniu fără enum (fără „drop-on-doubt”): material / dn / sdr / um / cantitate sunt text sau null
  for (const c of ['material', 'dn_text', 'sdr', 'um', 'cantitate']) assertEquals(it.properties[c], { anyOf: [{ type: 'string' }, { type: 'null' }] })
  const r = randDinTablou(OBIECT_RAND)
  assertEquals([r?.cantitate, r?.citat], ['1160.000', '003 SA11G1 [ 2] M 1160.000'])
})

Deno.test('A1: apelul — model, structured outputs prin output_config.format, gândirea oprită, fără temperature / prefill', async () => {
  let corp: any = null, url = '', hdr: any = null
  const f = (async (u: string, o: any) => {
    url = u; hdr = o.headers; corp = JSON.parse(o.body)
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ r: [OBIECT_RAND] }) }], stop_reason: 'end_turn',
      usage: { input_tokens: 900, output_tokens: 150, cache_read_input_tokens: 100 } }), { status: 200 })
  }) as unknown as typeof fetch
  const r = await cheamaA(f, 'k', 'PROMPT', 16000)
  assertEquals(url, 'https://api.anthropic.com/v1/messages')
  assertEquals([hdr['x-api-key'], hdr['anthropic-version']], ['k', '2023-06-01'])
  assertEquals([corp.model, corp.max_tokens, corp.thinking, corp.output_config.format.type], [MODEL_A, 16000, { type: 'disabled' }, 'json_schema'])
  assertEquals(corp.output_config.format.schema, SCHEMA_A)
  assertEquals([corp.temperature, corp.messages.length, corp.messages[0].role], [undefined, 1, 'user'])
  assertEquals([r.inF, r.outF, r.necunoscut, r.eroare], [1000, 150, false, undefined])   // tokenii din cache intră la intrare (conservator)
  assertEquals(JSON.parse(r.txt).r.length, 1)
})

Deno.test('A1: rezultat incert (max_tokens / refuz) = necunoscut; eroare HTTP = eroare', async () => {
  for (const stop of ['max_tokens', 'refusal', 'pause_turn']) {
    const f = (async () => new Response(JSON.stringify({ content: [{ type: 'text', text: '{"r":[' }], stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 })) as unknown as typeof fetch
    assertEquals((await cheamaA(f, 'k', 'p', 100)).necunoscut, true)
  }
  const e = (async () => new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 529 })) as unknown as typeof fetch
  const r = await cheamaA(e, 'k', 'p', 100)
  assertEquals([r.eroare, r.inF, r.outF], ['Claude: overloaded', 0, 0])
})

Deno.test('A1: tariful pe trepte — ≤ 100k tokeni intrare $0,10 / $0,50, peste $0,50 / $2,50; rezervarea pe octeți nu subestimează treapta', () => {
  assertEquals(tarifA(100_000), TARIF_A.mic)
  assertEquals(tarifA(100_001), TARIF_A.mare)
  const mic = 'x'.repeat(50_000), mare = 'x'.repeat(120_000)
  const EPS = 1e-9   // rotunjirea în sus la 1e-4 USD
  assert(sumaRezervata(mic, EXTRACTOARE.A) + EPS >= 50_000 * 0.10e-6 + MAX_IESIRE * 0.50e-6)
  assert(sumaRezervata(mare, EXTRACTOARE.A) + EPS >= 120_000 * 0.50e-6 + MAX_IESIRE * 2.50e-6)
  assert(tarifA(120_000).in > tarifA(100_000).in * 4)   // treapta mare chiar se aplică (rezervarea cu Sonnet: extractorA3_test.ts)
  // B rămâne neschimbat (implicit)
  assertEquals(sumaRezervata(mic), sumaRezervata(mic, EXTRACTOARE.B))
})

function fals() {
  const rpcArgs: Record<string, any[]> = {}
  const extractori: string[] = []
  const prompturi: string[] = []
  const deps: DepsStructurat = {
    rpc: async (fn, args) => {
      ;(rpcArgs[fn] ??= []).push(args)
      if (fn === 'fn_ofertare_cb_text_valid') return { data: { tip: 'prov', id: 1 }, error: null }
      if (fn === 'fn_ofertare_cb_extragere_incepe_grup') { extractori.push(String(args.p_extractor_id)); return { data: { ok: true, cache: false, extragere_id: 7 }, error: null } }
      if (fn === 'fn_ofertare_cb_felie_incepe') return { data: { ok: true, felie_id: 70 }, error: null }
      if (fn === 'fn_ofertare_cb_rezerva') return { data: { ok: true, rezervare_id: 900 }, error: null }
      if (fn === 'fn_ofertare_cb_deconteaza') return { data: { ok: true }, error: null }
      return { data: { ok: true }, error: null }
    },
    cerere: async () => ({ id: 5, licitatie_id: 15, scop: 'cant_extragere', stare: 'activa', valabil_pana: new Date(Date.now() + 3600e3).toISOString(), lot_domeniu: 'toate', lot_nr: [] }),
    documente: async () => [{ id: 212, nume_original: 'Liste de cantitati.pdf', tip: 'lista_cantitati', text_extras: TEXT_F3, seap_meta: null, lot_stare: 'comun' }],
    deciziiRol: async () => [],
    lotDocument: async (_l, ids) => new Map(ids.map((i) => [i, { domeniu: 'toate' as const, loturi: [] }])),
    extragereInLucru: async () => null,
    ultimaIncercare: async () => null, feliiGata: async () => null,
    ai: async (p) => { prompturi.push(p); return { txt: JSON.stringify({ r: [RAND_002, OBIECT_RAND] }), inF: 1000, outF: 200 } },
    acum: () => 0,
  }
  return { deps, rpcArgs, extractori, prompturi }
}

Deno.test('A1: extractor A în modul structurat — identitate proprie (alt cache), prompt p4, rezervare și decontare pe tariful Haiku 5.5', async () => {
  const f = fals()
  const r = await extrageStructurat(f.deps, { licitatie_id: 15, cerere_id: 5, extractor: 'A' })
  assertEquals(r.status, 200)
  assertEquals(r.body.extractor, `${MODEL_A}/claude-sonnet-5-5:q1@p4@n7@f2`)   // A3: identitatea include modelul de escaladare
  assert(f.extractori[0].startsWith(idExtractor(EXTRACTOARE.A) + '@c-'))
  assert(!f.extractori[0].startsWith(EXTRACTOR_ID))
  assert(f.prompturi[0].includes('schema e impusă'))
  assertEquals(f.rpcArgs['fn_ofertare_cb_rezerva'][0].p_suma, sumaRezervata(f.prompturi[0], EXTRACTOARE.A))
  const dc = f.rpcArgs['fn_ofertare_cb_deconteaza'][0]
  assertEquals([dc.p_model, dc.p_cost, dc.p_tokeni_in, dc.p_tokeni_out], [MODEL_A, Math.round((1000 * 0.10e-6 + 200 * 0.50e-6) * 1e4) / 1e4, 1000, 200])
  // rândul-obiect din schema A se normalizează și se dovedește în sursă
  const obs = f.rpcArgs['fn_ofertare_cb_obs_scrie'][0].p_obs
  assertEquals([obs.length, obs[1].cantitate, obs[1].pozitie_dovedita, obs[1].dn_mm], [2, 1160, true, [90]])
  assertEquals(r.body.felii_escaladate, 0)   // ambele rânduri acoperite → fără escaladare
})

Deno.test('A1: fără `extractor` (sau orice altă valoare) rămâne B, neschimbat', async () => {
  for (const extractor of [undefined, 'B' as const, 'X' as any]) {
    const f = fals()
    const r = await extrageStructurat(f.deps, { licitatie_id: 15, cerere_id: 5, extractor })
    assertEquals(r.body.extractor, EXTRACTOR_ID)
    assert(f.extractori[0].startsWith(EXTRACTOR_ID + '@c-'))
    assertEquals(f.rpcArgs['fn_ofertare_cb_deconteaza'][0].p_model, 'gpt-5-mini')
  }
})

// ── review Copilot / Gemini #792 r1 ──
Deno.test('A1 r2 (P1): rezervarea include overhead-ul schemei (intrare facturată care nu e în prompt) — în sumă și în alegerea treptei', async () => {
  const { OVERHEAD_A } = await import('./extractorA.ts')
  assert(OVERHEAD_A >= new TextEncoder().encode(JSON.stringify(SCHEMA_A)).length + 4000)
  // un prompt de 99.000 octeți + schema trece de 100k → treapta MARE la rezervare (nu poate fi decontat peste)
  const p = 'x'.repeat(99_000)
  const s = sumaRezervata(p, EXTRACTOARE.A)
  assert(s + 1e-9 >= (99_000 + OVERHEAD_A) * TARIF_A.mare.in + MAX_IESIRE * TARIF_A.mare.out)
  // cel mai rău caz real: intrare = prompt + overhead (tokeni ≤ octeți), ieșire la plafon → cost ≤ rezervare
  const inF = 99_000 + OVERHEAD_A
  const t = tarifA(inF)
  assert(Math.round((inF * t.in + MAX_IESIRE * t.out) * 1e4) / 1e4 <= s)
  // B neschimbat (overhead 0)
  assertEquals(EXTRACTOARE.B.overheadOcteti, 0)
})

Deno.test('A1 r2 (P3): excepția de rețea se întoarce ca eroare, nu se aruncă', async () => {
  const f = (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
  const r = await cheamaA(f, 'k', 'p', 100)
  assertEquals([r.eroare, r.inF, r.outF], ['Claude: fetch failed', 0, 0])
})

Deno.test('A1 r2 (P2): promptul nu cere omiterea rândurilor de articol care se termină cu „| 0.000 | 0 Total=”', async () => {
  const { PROMPT_A } = await import('./extractorA.ts')
  const t = PROMPT_A('x', 'f3')
  assert(t.includes('DOAR „0.000 0 Total=”') && t.includes('SE EXTRAGE'))
})
