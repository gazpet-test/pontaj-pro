// PR A3 — escaladarea Haiku 5.5 → Sonnet 5.5: cel mult o dată pe felie, pe semnale deterministe, rezervare unică pentru ambele apeluri.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { cheamaA, MODEL_A, MODEL_S, TARIF_A, TARIF_S } from './extractorA.ts'
import { type DepsStructurat, EXTRACTOARE, extrageStructurat, MAX_IESIRE, type RezultatAI, sumaRezervata } from './structurat.ts'

const F3 = 'Formularul F3\nLista cu cantitatile de lucrari\nObiect 3 Str. Platanului\n= NR. SIMBOL ART. CANTITATE UM =\n002 GD11A1 [ 1] M.C. 174.000\nDRENAJ\n0.000 0 Total=\n003 SA11G1 [ 2] M 1160.000\nTEAVA PVC ... DISTRIBUTIE D= 90 MM\n0.000 0 Total=\n'
const R003 = { pagina: null, tabel: null, rand: '003', cod_articol: 'SA11G1', denumire: 'TEAVA PVC ... DISTRIBUTIE D= 90 MM', obiect: 'Str. Platanului',
  material: 'PVC', dn_text: 'D= 90 MM', sdr: null, um: 'M', cantitate: '1160.000', e_total: 0, e_subtotal: 0, tip_lucrare: 'conducta', masura: 'lungime',
  citat: '003 SA11G1 [ 2] M 1160.000' }
const R002 = { ...R003, rand: '002', cod_articol: 'GD11A1', denumire: 'DRENAJ', material: null, dn_text: null, um: 'M.C.', cantitate: '174.000',
  tip_lucrare: 'alt', masura: 'alt', citat: '002 GD11A1 [ 1] M.C. 174.000' }
const ok = (rows: unknown[], inF = 1000, outF = 200): RezultatAI => ({ txt: JSON.stringify({ r: rows }), inF, outF })

function fals(raspunsuri: Partial<Record<'principal' | 'escaladare', RezultatAI>>) {
  const rpcArgs: Record<string, any[]> = {}
  const apeluriAI: string[] = []
  const inchideri: string[] = []
  const deps: DepsStructurat = {
    rpc: async (fn, args) => {
      ;(rpcArgs[fn] ??= []).push(args)
      if (fn === 'fn_ofertare_cb_text_valid') return { data: { tip: 'prov', id: 1 }, error: null }
      if (fn === 'fn_ofertare_cb_felie_inchide') inchideri.push(String(args.p_stare))
      if (fn === 'fn_ofertare_cb_extragere_incepe_grup') return { data: { ok: true, cache: false, extragere_id: 7 }, error: null }
      if (fn === 'fn_ofertare_cb_felie_incepe') return { data: { ok: true, felie_id: 70 }, error: null }
      if (fn === 'fn_ofertare_cb_rezerva') return { data: { ok: true, rezervare_id: 900 }, error: null }
      return { data: { ok: true }, error: null }
    },
    cerere: async () => ({ id: 5, licitatie_id: 15, scop: 'cant_extragere', stare: 'activa', valabil_pana: new Date(Date.now() + 3600e3).toISOString(), lot_domeniu: 'toate', lot_nr: [] }),
    documente: async () => [{ id: 212, nume_original: 'Liste de cantitati.pdf', tip: 'lista_cantitati', text_extras: F3, seap_meta: null, lot_stare: 'comun' }],
    deciziiRol: async () => [], lotDocument: async (_l, ids) => new Map(ids.map((i) => [i, { domeniu: 'toate' as const, loturi: [] }])),
    extragereInLucru: async () => null, ultimaIncercare: async () => null,
    ai: async (_p, cine = 'principal') => { apeluriAI.push(cine); return raspunsuri[cine] ?? { txt: '', inF: 0, outF: 0, eroare: 'neasteptat' } },
    acum: () => 0,
  }
  return { deps, rpcArgs, apeluriAI, inchideri }
}
const RULEAZA = (f: ReturnType<typeof fals>, extractor: 'A' | 'B' = 'A') => extrageStructurat(f.deps, { licitatie_id: 15, cerere_id: 5, extractor })
const costH = (i: number, o: number) => i * TARIF_A.mic.in + o * TARIF_A.mic.out
const costS = (i: number, o: number) => i * TARIF_S.in + o * TARIF_S.out
const r4 = (x: number) => Math.round(x * 1e4) / 1e4

Deno.test('A3: fără semnal (toate ancorele B1 acoperite) → un singur apel Haiku, decontat ca Haiku', async () => {
  const f = fals({ principal: ok([R002, R003]) })
  const r = await RULEAZA(f)
  assertEquals([f.apeluriAI, r.body.felii_escaladate, f.inchideri], [['principal'], 0, ['gata']])
  const dc = f.rpcArgs['fn_ofertare_cb_deconteaza'][0]
  assertEquals([dc.p_model, dc.p_cost], [MODEL_A, r4(costH(1000, 200))])
})

Deno.test('A3: deficit B1 (Haiku a omis 002) → escaladare o dată la Sonnet; observațiile = rezultatul Sonnet; cost = ambele apeluri', async () => {
  const f = fals({ principal: ok([R003]), escaladare: ok([R002, R003], 1000, 300) })
  const r = await RULEAZA(f)
  assertEquals([f.apeluriAI, r.body.felii_escaladate, r.body.felii_cu_deficit_b1, f.inchideri], [['principal', 'escaladare'], 1, 0, ['gata']])
  const dc = f.rpcArgs['fn_ofertare_cb_deconteaza'][0]
  assertEquals([dc.p_model, dc.p_tokeni_in, dc.p_tokeni_out, dc.p_cost], [`${MODEL_A}+${MODEL_S}`, 2000, 500, r4(costH(1000, 200) + costS(1000, 300))])
  assertEquals(f.rpcArgs['fn_ofertare_cb_obs_scrie'][0].p_obs.length, 2)
  const fel = (r.body.raport as any[]).find((x) => x.felie === 0)
  assertEquals([fel.escaladare, fel.model, fel.poarta_b1.deficit], [['deficit_b1:1/2'], `${MODEL_A}+${MODEL_S}`, false])
})

Deno.test('A3: maximum o escaladare — dacă și Sonnet are deficit, NU urmează un al treilea apel; felia gata cu deficitul raportat (B2 decide)', async () => {
  const f = fals({ principal: ok([R003]), escaladare: ok([R003]) })
  const r = await RULEAZA(f)
  assertEquals([f.apeluriAI, r.body.felii_escaladate, r.body.felii_cu_deficit_b1, f.inchideri], [['principal', 'escaladare'], 1, 1, ['gata']])
  const fel = (r.body.raport as any[]).find((x) => x.felie === 0)
  assertEquals([fel.poarta_b1.deficit, fel.poarta_b1.neacoperite], [true, ['002']])
})

Deno.test('A3: Haiku incert (tăiat / refuz) → escaladare; Sonnet bun → felia gata, costul Haiku-ului tăiat intră în decontare', async () => {
  const f = fals({ principal: { txt: '{"r":[', inF: 1000, outF: 16000, necunoscut: true }, escaladare: ok([R002, R003]) })
  const r = await RULEAZA(f)
  assertEquals([f.apeluriAI, f.inchideri], [['principal', 'escaladare'], ['gata']])
  assertEquals(f.rpcArgs['fn_ofertare_cb_deconteaza'][0].p_cost, r4(costH(1000, 16000) + costS(1000, 200)))
  assertEquals((r.body.raport as any[]).find((x) => x.felie === 0).escaladare, ['incert'])
})

Deno.test('A3: rânduri nenormalizabile la Haiku → escaladare', async () => {
  const f = fals({ principal: ok([R002, R003, { cheie_straina: 1 }]), escaladare: ok([R002, R003]) })
  const r = await RULEAZA(f)
  assertEquals([f.apeluriAI, f.inchideri], [['principal', 'escaladare'], ['gata']])
  assertEquals((r.body.raport as any[]).find((x) => x.felie === 0).escaladare, ['nenormalizabile:1'])
})

Deno.test('A3: și Sonnet incert → rezervarea „necunoscuta” (rămâne în consum la suma rezervată), felia „necunoscut”, fără decontare', async () => {
  const f = fals({ principal: ok([R003]), escaladare: { txt: '', inF: 1000, outF: 16000, necunoscut: true } })
  await RULEAZA(f)
  assertEquals([f.apeluriAI, f.inchideri], [['principal', 'escaladare'], ['necunoscut']])
  assertEquals([f.rpcArgs['fn_ofertare_cb_deconteaza'], f.rpcArgs['fn_ofertare_cb_rezervare_necunoscuta']?.length], [undefined, 1])
})

Deno.test('A3: eroare de rețea / HTTP la Haiku NU escaladează (nu e semnal al datelor) — calea veche: necunoscut', async () => {
  const f = fals({ principal: { txt: '', inF: 0, outF: 0, eroare: 'Claude: overloaded' } })
  await RULEAZA(f)
  assertEquals([f.apeluriAI, f.inchideri], [['principal'], ['necunoscut']])
})

Deno.test('A3: extractorul B nu escaladează niciodată (nu are model de escaladare), nici la deficit', async () => {
  const f = fals({ principal: ok([R003]) })
  const r = await RULEAZA(f, 'B')
  assertEquals([f.apeluriAI, r.body.felii_escaladate, r.body.felii_cu_deficit_b1], [['principal'], 0, 1])
})

Deno.test('A3: rezervarea A = limita Haiku + limita Sonnet pe același prompt (plafonul verificat înaintea oricărui apel); costul real ≤ rezervare', () => {
  for (const n of [1_000, 30_000, 99_000, 150_000]) {
    const p = 'ă'.repeat(n / 2) + 'x'.repeat(n / 2)
    const octeti = new TextEncoder().encode(p).length
    const s = sumaRezervata(p, EXTRACTOARE.A)
    const tH = octeti > 100_000 ? TARIF_A.mare : TARIF_A.mic
    assert(s + 1e-9 >= octeti * tH.in + MAX_IESIRE * tH.out + octeti * TARIF_S.in + MAX_IESIRE * TARIF_S.out)
    // cel mai rău caz real: tokeni = octeți, ambele ieșiri la plafon
    assert(r4(octeti * tH.in + MAX_IESIRE * tH.out + octeti * TARIF_S.in + MAX_IESIRE * TARIF_S.out) <= s)
  }
  assertEquals(sumaRezervata('x'.repeat(1000)), sumaRezervata('x'.repeat(1000), EXTRACTOARE.B))   // B neschimbat
})

Deno.test('A3: apelul Sonnet — gândirea oprită cu between_tools (disabled = 400 pe Sonnet 5.5), effort medium, aceeași schemă', async () => {
  let corp: any = null
  const f = (async (_u: string, o: any) => { corp = JSON.parse(o.body); return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"r":[]}' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } }), { status: 200 }) }) as unknown as typeof fetch
  await cheamaA(f, 'k', 'p', 100, MODEL_S)
  assertEquals([corp.model, corp.thinking, corp.output_config.effort, corp.output_config.format.type], [MODEL_S, { type: 'between_tools' }, 'medium', 'json_schema'])
  await cheamaA(f, 'k', 'p', 100)
  assertEquals([corp.model, corp.thinking, corp.output_config.effort], [MODEL_A, { type: 'disabled' }, undefined])
})
