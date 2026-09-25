// deno test --node-modules-dir=none supabase/functions/ofertare-plansa-citeste/concurenta_test.ts
// R4: scrieri concurente (CAS + fuziune pe zone), versiuni nemixate (409), regiunea în coordonate PDF, rezultatCitire.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { handler, rezultatCitire } from './handler.ts'
import { CALE_REV, fuzioneazaZone, transferDeReluat, regiuneZona, versiuneIncompatibila } from './concurenta.ts'

// ---- DB simulată cu update real + filtre pe cale JSON (analiza->citire_ai->>rev) ----
const cale = (row: any, c: string) => {
  const parti = c.split(/->>?/)
  let v = row
  for (const p of parti) v = v == null ? undefined : v[p]
  return c.includes('->>') ? (v == null ? null : String(v)) : v
}
function db(tabele: Record<string, any[]>) {
  const n = { ai: 0, scrieriDoc: 0, conflicte: 0, inserts: [] as string[] }
  const from = (t: string) => {
    tabele[t] ||= []
    let filtre: ((r: any) => boolean)[] = []
    let op: { tip: 'sel' | 'upd' | 'ins'; patch?: any } = { tip: 'sel' }
    const potrivite = () => tabele[t].filter((r) => filtre.every((f) => f(r)))
    const exec = () => {
      if (op.tip === 'ins') { n.inserts.push(t); tabele[t].push(structuredClone(op.patch)); return { data: [], error: null } }
      const rows = potrivite()
      if (op.tip === 'upd') {
        for (const r of rows) Object.assign(r, structuredClone(op.patch))
        if (t === 'ofertare_documente_atribuire') { if (rows.length) n.scrieriDoc++; else n.conflicte++ }
      }
      return { data: structuredClone(rows), error: null }
    }
    const b: any = {
      select: () => b, order: () => b, limit: () => b,
      eq: (c: string, v: unknown) => { filtre.push((r) => String(cale(r, c)) === String(v)); return b },
      is: (c: string, v: unknown) => { filtre.push((r) => (cale(r, c) ?? null) === v); return b },
      update: (p: any) => { op = { tip: 'upd', patch: p }; return b },
      insert: (p: any) => { op = { tip: 'ins', patch: p }; return b },
      maybeSingle: () => Promise.resolve({ data: structuredClone(potrivite()[0] ?? null), error: null }),
      single: () => Promise.resolve({ data: structuredClone(potrivite()[0] ?? null), error: null }),
      then: (ok: any, ko: any) => Promise.resolve(exec()).then(ok, ko),
    }
    return b
  }
  return { from, n, rpc: () => Promise.resolve({ data: null, error: null }) }
}

const ZONE = ['1_1', '1_2', '1_3', '1_4', '1_5', '1_6']
function supaCu(doc: any) {
  const d = db({ ofertare_documente_atribuire: [doc], ofertare_cantitati: [], ai_usage_log: [] })
  const supa = {
    from: d.from, rpc: d.rpc,
    storage: { from: () => ({
      list: () => Promise.resolve({ data: ZONE.map((z) => ({ name: `z${z}.jpg` })), error: null }),
      download: () => Promise.resolve({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null }),
    }) },
  }
  return { supa, n: d.n, tabele: d }
}
// AI simulat: răspunde după eticheta din prompt, cu întârziere (ca rulările să se întrepătrundă)
function aiFals(n: { ai: number }, intarziere: number) {
  return (async (_u: unknown, init?: RequestInit) => {
    n.ai++
    const corp = JSON.parse(String(init?.body || '{}'))
    const txt = corp.messages?.[0]?.content?.find((c: any) => c.type === 'text')?.text || ''
    const et = /Bucata (\S+)/.exec(txt)?.[1] || '?'
    await new Promise((ok) => setTimeout(ok, intarziere))
    const rasp = { tronsoane: [{ de_la: `N-${et}`, la: 'X', lungime_m: 10, sursa: 'tabel' }], cartus: {}, tabele: [] }
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(rasp) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })
  }) as typeof fetch
}
const cerereSvc = (body: unknown) => new Request('http://x/', { method: 'POST', headers: { Authorization: 'Bearer svc' }, body: JSON.stringify(body) })
const PLANSA = { cale_felii: '95/felii/470', taiat_la: 'T1', latime: 6000, inaltime: 4000, zone_asteptate: ZONE }
const felie = (z: string, extra: any = {}) => ({ eticheta: `z${z}`, tronsoane: [{ de_la: `N-z${z}`, la: 'X', lungime_m: 10, sursa: 'tabel' }], ...extra })

// versiunea curentă, citită dintr-o rulare „de la zero" (resetare)
async function versiuneCurenta() {
  const { supa, n, tabele } = supaCu({ id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', analiza: { plansa: PLANSA } })
  const r = await handler(cerereSvc({ doc_id: 470, de_la: 0 }), { SERVICE: 'svc', API_KEY: 'k', supa, getUser: () => Promise.resolve(null), fetch: aiFals(n, 0) })
  assertEquals(r.status, 200)
  const doc = (await tabele.from('ofertare_documente_atribuire').select().eq('id', 470).maybeSingle()).data
  return doc.analiza.citire_ai.versiune
}

Deno.test('R4: două rulări concurente pe zone diferite -> ambele rezultate păstrate (CAS + fuziune)', async () => {
  const v = await versiuneCurenta()
  const cheie = `${v.cod}|${v.model}|${v.prompt_sha}`
  // salvat: 1_1..1_4 citite, 1_2 căzută; 1_5, 1_6 necitite
  const ca = { felii: [felie('1_1'), { eticheta: 'z1_2', eroare: 'timeout' }, felie('1_3'), felie('1_4')].map((f) => ({ ...f, _versiune: cheie })),
    versiune: v, taiat_la: 'T1', gata: false, rev: 'r0', rulare: 'R', sumar: {}, metrici: [] }
  const { supa, n, tabele } = supaCu({ id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', analiza: { plansa: PLANSA, citire_ai: ca } })
  const deps = (ms: number) => ({ SERVICE: 'svc', API_KEY: 'k', supa, getUser: () => Promise.resolve(null), fetch: aiFals(n, ms) })
  // A (tab 1): continuă zonele necitite (1_5, 1_6), mai rapid; B (tab 2): reia zona căzută 1_2, mai lent
  const [ra, rb] = await Promise.all([
    handler(cerereSvc({ doc_id: 470, mod: 'continua' }), deps(5)),
    handler(cerereSvc({ doc_id: 470, mod: 'reia_erori' }), deps(30)),
  ])
  assertEquals([ra.status, rb.status], [200, 200])
  const jb = await rb.json()
  assertEquals(jb.scriere_concurenta?.incercari, 2, 'B a avut conflict și a reîncercat')
  const doc = (await tabele.from('ofertare_documente_atribuire').select().eq('id', 470).maybeSingle()).data
  const felii = doc.analiza.citire_ai.felii
  assertEquals(felii.map((f: any) => f.eticheta), ZONE.map((z) => `z${z}`))
  assert(felii.every((f: any) => !f.eroare), 'nicio zonă pierdută sau rămasă căzută')
  assertEquals(doc.analiza.citire_ai.gata, true)
  assert(n.conflicte >= 1)
  // transferul în cantități s-a făcut o singură dată (fără diametre => nimic inserat, dar marcat final, nu „în curs")
  assert(!doc.analiza.citire_ai.sumar.cantitati?.in_curs)
})

Deno.test('R4: rezultat bun salvat nu e înlocuit de o eroare nouă (fuziune pe zone)', () => {
  const r = fuzioneazaZone([felie('1_1'), felie('1_2')], [{ eticheta: 'z1_2', eroare: 'x' }, felie('1_3')])
  assertEquals(r.map((f) => [f.eticheta, !!f.eroare]), [['z1_1', false], ['z1_2', false], ['z1_3', false]])
  const r2 = fuzioneazaZone([{ eticheta: 'z1_1', eroare: 'x' }], [felie('1_1')])
  assertEquals(r2[0].eroare, undefined)
})

Deno.test('R4: versiune diferită la continua / reia_erori / de_la>0 -> 409, zero AI, zero scrieri', async () => {
  for (const body of [{ mod: 'continua' }, { mod: 'reia_erori' }, { de_la: 4 }]) {
    const ca = { felii: [felie('1_1'), { eticheta: 'z1_2', eroare: 'x' }], versiune: { cod: '2026-09-01.1', model: 'claude-opus-5', prompt_sha: 'vechi' },
      taiat_la: 'T1', rev: 'r0' }
    const { supa, n } = supaCu({ id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', analiza: { plansa: PLANSA, citire_ai: ca } })
    const r = await handler(cerereSvc({ doc_id: 470, ...body }), { SERVICE: 'svc', API_KEY: 'k', supa, getUser: () => Promise.resolve(null), fetch: aiFals(n, 0) })
    assertEquals(r.status, 409, JSON.stringify(body))
    assert((await r.text()).includes('altă versiune'))
    assertEquals(n.ai, 0); assertEquals(n.scrieriDoc, 0)
  }
})

Deno.test('R4: versiuneIncompatibila — lipsă versiune = incompatibil; mixare_permisa explicit trece', () => {
  const cur = { cod: 'a', model: 'm', prompt_sha: 's' }
  assertEquals(versiuneIncompatibila({ versiune: cur }, cur), null)
  assert(versiuneIncompatibila({ felii: [] }, cur))
  assert(versiuneIncompatibila({ versiune: { ...cur, model: 'alt' } }, cur))
  assertEquals(versiuneIncompatibila({ versiune: { ...cur, prompt_sha: 'x' } }, cur, true), null)
  assertEquals(versiuneIncompatibila(null, cur), null)
})

Deno.test('R4: zonele citite poartă _versiune, tronsoanele _zona și _regiune (pt PDF)', async () => {
  const plansa = { ...PLANSA, zone_geom: { '1_1': [0, 0, 1600, 1600, 0] },
    surse_geom: [{ pagina: 1, latime: 6000, inaltime: 4000, dpi: 150, latime_pt: 2880, inaltime_pt: 1920 }] }
  const { supa, n, tabele } = supaCu({ id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', analiza: { plansa } })
  const r = await handler(cerereSvc({ doc_id: 470, de_la: 0 }), { SERVICE: 'svc', API_KEY: 'k', supa, getUser: () => Promise.resolve(null), fetch: aiFals(n, 0) })
  assertEquals(r.status, 200)
  const ca = (await tabele.from('ofertare_documente_atribuire').select().eq('id', 470).maybeSingle()).data.analiza.citire_ai
  const z = ca.felii.find((f: any) => f.eticheta === 'z1_1')
  assert(z._versiune && z._versiune.includes(ca.versiune.prompt_sha))
  assertEquals(z.tronsoane[0]._zona, 'z1_1')
  assertEquals(z.tronsoane[0]._regiune, { pagina: 1, unitate: 'pt', x0: 0, y0: 1152, x1: 768, y1: 1920 })
  assert(typeof ca.rev === 'string' && ca.rev.length > 8)
})

Deno.test('R4: regiuneZona — caz simplu, fallback dpi, fallback px, zonă necunoscută', () => {
  // pagină 1000x500 pt randată la 2 px/pt (144 dpi): 2000x1000 px; zona (100,200) 400x300 px
  const p = { zone_geom: { '2_3': [100, 200, 400, 300, 0] }, surse_geom: [{ pagina: 1, latime: 2000, inaltime: 1000, latime_pt: 1000, inaltime_pt: 500, dpi: 144 }] }
  assertEquals(regiuneZona(p, 'z2_3'), { pagina: 1, unitate: 'pt', x0: 50, y0: 250, x1: 250, y1: 400 })
  const pd = { zone_geom: p.zone_geom, surse_geom: [{ pagina: 2, latime: 2000, inaltime: 1000, dpi: 144 }] }
  assertEquals(regiuneZona(pd, '2_3'), { pagina: 2, unitate: 'pt', x0: 50, y0: 250, x1: 250, y1: 400 })
  const px = { zone_geom: p.zone_geom, surse_geom: [{ pagina: 1, latime: 2000, inaltime: 1000 }] }
  assertEquals(regiuneZona(px, 'z2_3')?.unitate, 'px')
  assertEquals(regiuneZona(p, 'z9_9'), null)
  assertEquals(regiuneZona({}, 'z1_1'), null)
})

Deno.test('R4: retăiere în timpul rundei -> 409 la scriere, citirea nouă nu e suprascrisă', async () => {
  const v = await versiuneCurenta()
  const ca = { felii: [felie('1_1')], versiune: v, taiat_la: 'T1', rev: 'r0', rulare: 'R' }
  const { supa, n, tabele } = supaCu({ id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', analiza: { plansa: PLANSA, citire_ai: ca } })
  const fetchRetaie = (async (u: unknown, i?: RequestInit) => {
    // în timpul citirii, /api/plansa-felii retaie: plansa.taiat_la nou + rev nou
    const row = (await tabele.from('ofertare_documente_atribuire').select().eq('id', 470).maybeSingle()).data
    await tabele.from('ofertare_documente_atribuire').update({ analiza: { ...row.analiza, plansa: { ...PLANSA, taiat_la: 'T2' },
      citire_ai: { ...row.analiza.citire_ai, rev: 'taiere-2' } } }).eq('id', 470)
    return aiFals(n, 0)(u as any, i)
  }) as typeof fetch
  const r = await handler(cerereSvc({ doc_id: 470, mod: 'continua' }), { SERVICE: 'svc', API_KEY: 'k', supa, getUser: () => Promise.resolve(null), fetch: fetchRetaie })
  assertEquals(r.status, 409)
  const doc = (await tabele.from('ofertare_documente_atribuire').select().eq('id', 470).maybeSingle()).data
  assertEquals(doc.analiza.plansa.taiat_la, 'T2'); assertEquals(doc.analiza.citire_ai.rev, 'taiere-2')
})

Deno.test('R4: retăiere în timpul PRIMEI citiri (fără citire_ai, rev null) -> 409, plansa nouă nu e suprascrisă', async () => {
  const { supa, n, tabele } = supaCu({ id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', analiza: { plansa: PLANSA } })
  let retaiat = false
  const fetchRetaie = (async (u: unknown, i?: RequestInit) => {
    if (!retaiat) {
      retaiat = true
      const row = (await tabele.from('ofertare_documente_atribuire').select().eq('id', 470).maybeSingle()).data
      // /api/plansa-felii nu pune rev când nu există citire_ai => doar taiat_la se schimbă
      await tabele.from('ofertare_documente_atribuire').update({ analiza: { ...row.analiza, plansa: { ...PLANSA, taiat_la: 'T2' } } }).eq('id', 470)
    }
    return aiFals(n, 0)(u as any, i)
  }) as typeof fetch
  const r = await handler(cerereSvc({ doc_id: 470, de_la: 0 }), { SERVICE: 'svc', API_KEY: 'k', supa, getUser: () => Promise.resolve(null), fetch: fetchRetaie })
  assertEquals(r.status, 409)
  const doc = (await tabele.from('ofertare_documente_atribuire').select().eq('id', 470).maybeSingle()).data
  assertEquals(doc.analiza.plansa.taiat_la, 'T2'); assertEquals(doc.analiza.citire_ai, undefined)
})

Deno.test('R4: CAS filtrează pe calea JSON a jetonului', () => { assertEquals(CALE_REV, 'analiza->citire_ai->>rev') })

// ---- R4 pct. 5: rezultatCitire ----
const T = (o: any = {}) => ({ eticheta: 'z1_1', ...o })
const P = (o: any = {}) => ({ acoperire_demonstrata: true, ...o })  // tăiere nouă, pagină acoperită demonstrat
Deno.test('rezultatCitire: ok (doar cu acoperire demonstrată)', () => {
  assertEquals(rezultatCitire({ plansa: P(), toate: [T()], sumar: { erori: 0, tronsoane_gasite: 3 }, zoneLipsa: [], prea_mica: false }).rezultat, 'ok')
  assertEquals(rezultatCitire({ plansa: P(), toate: [T()], sumar: { erori: 0, tabele: ['Calcul'] }, zoneLipsa: [] }).rezultat, 'ok')
})
Deno.test('rezultatCitire: partial (zone căzute / lipsă / sursă mică fără dovadă)', () => {
  assertEquals(rezultatCitire({ plansa: P(), toate: [T(), T({ eroare: 'x' })], sumar: { erori: 1, tronsoane_gasite: 2 }, zoneLipsa: [] }).rezultat, 'partial')
  assertEquals(rezultatCitire({ plansa: P(), toate: [T()], sumar: { erori: 0, tronsoane_gasite: 2 }, zoneLipsa: ['z1_2'] }).rezultat, 'partial')
  const r = rezultatCitire({ plansa: P(), toate: [T()], sumar: { erori: 0 }, zoneLipsa: [], prea_mica: true })
  assertEquals(r.rezultat, 'partial'); assert(r.motiv.includes('2000px')); assert(r.motiv.includes('de reverificat'))
})
Deno.test('rezultatCitire: o zonă căzută cu zero tronsoane -> partial (nu citita_fara_date, nu ilizibil)', () => {
  const r = rezultatCitire({ plansa: P(), toate: [T({ cartus: { titlu: 'Plan' } }), T({ eticheta: 'z1_2', eroare: 'timeout' })], sumar: { erori: 1, tronsoane_gasite: 0, tabele: [] }, zoneLipsa: [] })
  assertEquals(r.rezultat, 'partial')
})
Deno.test('rezultatCitire: ilizibil DOAR pe lectură completă fără text; toate căzute = eșec tehnic -> partial', () => {
  const r = rezultatCitire({ plansa: P(), toate: [T({ eroare: 'a' }), T({ eroare: 'b' })], sumar: { erori: 2 }, zoneLipsa: [] })
  assertEquals(r.rezultat, 'partial'); assert(r.motiv.includes('eșec tehnic'))
  assertEquals(rezultatCitire({ plansa: P(), toate: [T({ cartus: { titlu: null } })], sumar: { erori: 0 }, zoneLipsa: [] }).rezultat, 'ilizibil')
})
Deno.test('rezultatCitire: toate zonele citite, zero parametri -> citita_fara_date_cantitative', () => {
  assertEquals(rezultatCitire({ plansa: P(), toate: [T({ cartus: { titlu: 'Plan situatie' } }), T({ eticheta: 'z1_2', noduri: ['N1'] })], sumar: { erori: 0, tronsoane_gasite: 0, lungime_totala_m: 0, tabele: [] }, zoneLipsa: [] }).rezultat, 'citita_fara_date_cantitative')
  assertEquals(rezultatCitire({ plansa: P(), toate: [T({ alte_mentiuni: ['nota'] })], sumar: { erori: 0 }, zoneLipsa: [] }).rezultat, 'citita_fara_date_cantitative')
})
Deno.test('rezultatCitire: randare eșuată / acoperire nedemonstrată -> partial, niciodată ilizibil sau succes', () => {
  for (const plansa of [{ randare_esuata: true }, P({ randare_esuata: true }), { acoperire_demonstrata: false, acoperire_motiv: 'randare eșuată — fallback pe imagine' },
    { acoperire_demonstrata: false, semnale_sigla: { analiza_sarita: 'PDF >40MB' } }]) {
    for (const [toate, sumar] of [[[T()], { erori: 0, tronsoane_gasite: 4 }], [[T({ cartus: { titlu: 'x' } })], { erori: 0 }], [[T()], { erori: 0 }]] as any[]) {
      const r = rezultatCitire({ plansa, toate, sumar, zoneLipsa: [] })
      assertEquals(r.rezultat, 'partial', JSON.stringify({ plansa, sumar }))
      assert(r.motiv.startsWith('de verificat'))
    }
  }
})
Deno.test('rezultatCitire: imagine mică legitimă + cartuș exterior (fără identificare pozitivă) -> nu siglă', () => {
  const plansa = { sursa_sigla_dovedita: false, latime: 800, inaltime: 600, acoperire_demonstrata: false,
    semnale_sigla: { imagine_sub_10_la_suta: true, declansator_randare: true, identificare: { raport_2_1: false, text_semnatura_pe_imagine: false, dovedita: false } } }
  const r = rezultatCitire({ plansa, toate: [T({ cartus: { titlu: 'Plan' } })], sumar: { erori: 0, tronsoane_gasite: 2 }, zoneLipsa: [], prea_mica: true })
  assert(r.rezultat !== 'sursa_gresita_sigla'); assertEquals(r.rezultat, 'partial')
})
Deno.test('rezultatCitire: istoric fără semnale (tăiere veche) -> incertitudinea păstrată (partial)', () => {
  const r = rezultatCitire({ plansa: { citibila: true, latime: 9000, inaltime: 6000 }, toate: [T()], sumar: { erori: 0, tronsoane_gasite: 5 }, zoneLipsa: [] })
  assertEquals(r.rezultat, 'partial'); assert(r.motiv.includes('istoric'))
  const g = rezultatCitire({ plansa: { citibila: true }, toate: [T({ cartus: { titlu: 'x' } })], sumar: { erori: 0 }, zoneLipsa: [] })
  assertEquals(g.rezultat, 'partial')
})
Deno.test('rezultatCitire: sursa_gresita_sigla doar cu identificare pozitivă și nu pe randare vectorială', () => {
  assertEquals(rezultatCitire({ plansa: { sursa_sigla_dovedita: true, semnale_sigla: { identificare: { dovedita: true } } }, toate: [], sumar: {}, zoneLipsa: [] }).rezultat, 'sursa_gresita_sigla')
  // tăiere veche: sursa_sigla_dovedita din euristica veche (fără identificare pozitivă) => NU siglă
  assert(rezultatCitire({ plansa: { sursa_sigla_dovedita: true }, toate: [], sumar: {}, zoneLipsa: [] }).rezultat !== 'sursa_gresita_sigla')
  assert(rezultatCitire({ plansa: P({ sursa_sigla_dovedita: true, vectorial: true }), toate: [T()], sumar: { tronsoane_gasite: 1 }, zoneLipsa: [] }).rezultat !== 'sursa_gresita_sigla')
  assert(rezultatCitire({ plansa: P({ sursa_sigla_dovedita: false }), toate: [T()], sumar: { tronsoane_gasite: 1 }, zoneLipsa: [] }).rezultat !== 'sursa_gresita_sigla')
})

// ---- R4 risc 1: transferul în cantități nu rămâne blocat ----
Deno.test('transferDeReluat: {eroare} și in_curs >5 min se reiau; in_curs recent și făcut nu', () => {
  const acum = Date.parse('2026-09-25T12:00:00Z')
  assert(transferDeReluat(null, acum))
  assert(transferDeReluat({ eroare: 'timeout' }, acum))
  assert(transferDeReluat({ amanat: 'x' }, acum))
  assert(transferDeReluat({ in_curs: true, la: '2026-09-25T11:54:00Z' }, acum))
  assert(transferDeReluat({ in_curs: true }, acum))
  assert(!transferDeReluat({ in_curs: true, la: '2026-09-25T11:58:00Z' }, acum))
  assert(!transferDeReluat({ inserate: 3, actualizate: 1 }, acum))
})
