// deno test --node-modules-dir=none supabase/functions/ofertare-plansa-citeste/concurenta_test.ts
// R4: scrieri concurente (CAS + fuziune pe zone), versiuni nemixate (409), regiunea în coordonate PDF, rezultatCitire.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { handler, rezultatCitire } from './handler.ts'
import { CALE_REV, CALE_REZ, REZERVARE_EXPIRA_MS, TOLERANTA_CEAS_MS, fuzioneazaZone, leaseTransferOcupat, rezActiva, rezervariNoi, rezervateDeAltii, transferDeReluat, regiuneZona, versiuneIncompatibila } from './concurenta.ts'

// ---- DB simulată cu update real + filtre pe cale JSON (analiza->citire_ai->>rev) ----
const cale = (row: any, c: string) => {
  const parti = c.split(/->>?/)
  let v = row
  for (const p of parti) v = v == null ? undefined : v[p]
  return c.includes('->>') ? (v == null ? null : String(v)) : v
}
type OptDb = { inainteDeUpdateDoc?: (rows: any[]) => void; intarziereSelectCantitati?: number; laSelectCantitati?: () => Promise<void> | void; inainteDeRpc?: () => Promise<void> | void }
function db(tabele: Record<string, any[]>, opt: OptDb = {}) {
  const n = { ai: 0, scrieriDoc: 0, conflicte: 0, rpc: 0, inserts: [] as string[] }
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
      then: (ok: any, ko: any) => (async () => {
        if (op.tip === 'upd' && t === 'ofertare_documente_atribuire' && opt.inainteDeUpdateDoc) opt.inainteDeUpdateDoc(tabele[t])
        if (op.tip === 'sel' && t === 'ofertare_cantitati' && opt.intarziereSelectCantitati) await new Promise((r) => setTimeout(r, opt.intarziereSelectCantitati))
        if (op.tip === 'sel' && t === 'ofertare_cantitati' && opt.laSelectCantitati) await opt.laSelectCantitati()
        return exec()
      })().then(ok, ko),
    }
    return b
  }
  // RPC atomic simulat (ofertare_transfer_plansa_cantitati): verificare lease + scrieri + transfer 'facut', fără await intern
  const rpc = async (nume: string, a: any): Promise<{ data: any; error: any }> => {
    if (nume !== 'ofertare_transfer_plansa_cantitati') return { data: null, error: null }
    if (opt.inainteDeRpc) await opt.inainteDeRpc()
    n.rpc++
    const doc = (tabele.ofertare_documente_atribuire || []).find((r) => String(r.id) === String(a.p_doc_id))
    const tr = doc?.analiza?.citire_ai?.transfer
    if (!doc || tr?.rulare !== a.p_rulare || tr?.stare !== 'in_curs') return { data: { eroare: 'lease_pierdut' }, error: null }
    let adaugate = 0, actualizate = 0, sarite_existente = 0
    const cant = (tabele.ofertare_cantitati ||= [])
    for (const o of a.p_randuri || []) {
      if (o.op === 'update') {
        const r = cant.find((x) => x.id === o.id && x.licitatie_id === doc.licitatie_id)
        if (r) { Object.assign(r, structuredClone(o.patch)); actualizate++ }
      } else if (o.op === 'insert') {
        if (cant.some((x) => x.licitatie_id === doc.licitatie_id && x.denumire === o.row.denumire && x.sursa === o.row.sursa)) { sarite_existente++; continue }
        n.inserts.push('ofertare_cantitati'); cant.push({ id: 9000 + cant.length, licitatie_id: doc.licitatie_id, ...structuredClone(o.row) }); adaugate++
      }
    }
    doc.analiza.citire_ai = { ...doc.analiza.citire_ai, rev: crypto.randomUUID(), transfer: { ...tr, stare: 'facut', la: new Date().toISOString() } }
    return { data: { ok: true, adaugate, actualizate, sarite_existente }, error: null }
  }
  return { from, n, rpc }
}

const ZONE = ['1_1', '1_2', '1_3', '1_4', '1_5', '1_6']
function supaCu(doc: any, zone: string[] = ZONE, opt: OptDb = {}) {
  const d = db({ ofertare_documente_atribuire: [doc], ofertare_cantitati: [], ai_usage_log: [] }, opt)
  const supa = {
    from: d.from, rpc: d.rpc,
    storage: { from: () => ({
      list: () => Promise.resolve({ data: zone.map((z) => ({ name: `z${z}.jpg` })), error: null }),
      download: () => Promise.resolve({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null }),
    }) },
  }
  return { supa, n: d.n, tabele: d, raw: d }
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
  const v = await versiuneCurenta()   // aceeași tăiere/grilă/fișier; diferă doar cod/model/prompt
  for (const body of [{ mod: 'continua' }, { mod: 'reia_erori' }, { de_la: 4 }]) {
    const ca = { felii: [felie('1_1'), { eticheta: 'z1_2', eroare: 'x' }], versiune: { ...v, cod: '2026-09-01.1', model: 'claude-opus-5', prompt_sha: 'vechi' },
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

// ---- R4 (Copilot) pct. 2: epuizarea celor 3 reîncercări CAS -> 409 explicit, ce e salvat rămâne intact ----
Deno.test('R4: 3 conflicte CAS la rând -> 409 explicit, rezultatele salvate intacte', async () => {
  const v = await versiuneCurenta()
  const salvate = [felie('1_1'), felie('1_2')].map((f) => ({ ...f, _versiune: `${v.cod}|${v.model}|${v.prompt_sha}` }))
  const ca = { felii: salvate, versiune: v, taiat_la: 'T1', gata: false, rev: 'r0', rulare: 'R', sumar: {}, metrici: [] }
  let k = 0
  // înainte de FIECARE update al documentului, altă rulare schimbă jetonul (și adaugă o zonă a ei)
  const { supa, n, tabele } = supaCu({ id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', analiza: { plansa: PLANSA, citire_ai: ca } }, ZONE, {
    inainteDeUpdateDoc: (rows) => { const c = rows[0].analiza.citire_ai; rows[0].analiza.citire_ai = { ...c, rev: `alt-${++k}`, felii: [...c.felii.filter((f: any) => f.eticheta !== 'z1_6'), { ...felie('1_6'), _alt: k }] } } })
  const r = await handler(cerereSvc({ doc_id: 470, mod: 'continua' }), { SERVICE: 'svc', API_KEY: 'k', supa, getUser: () => Promise.resolve(null), fetch: aiFals(n, 0) })
  assertEquals(r.status, 409)
  assert((await r.json()).error.includes('3 încercări'))
  assertEquals(n.scrieriDoc, 0); assertEquals(n.conflicte, 3)
  const doc = (await tabele.from('ofertare_documente_atribuire').select().eq('id', 470).maybeSingle()).data
  assertEquals(doc.analiza.citire_ai.rev, 'alt-3')
  assertEquals(doc.analiza.citire_ai.felii.map((f: any) => f.eticheta), ['z1_1', 'z1_2', 'z1_6'], 'zonele salvate (ale noastre + ale celeilalte rulări) intacte')
  assertEquals(doc.analiza.plansa, PLANSA)
})

// ---- R4 (Copilot) pct. 3: mixare_permisa acoperă doar model/prompt/cod ----
Deno.test('R4: mixare_permisa NU trece peste taiat_la / cale_felii / geometrie / fișier diferite', () => {
  const baza = { cod: 'a', model: 'm', prompt_sha: 's', taiat_la: 'T1', cale_felii: '95/felii/470', geom_sha: 'g1', fisier: 'PL1.pdf', fisier_path: '95/PL1.pdf' }
  assertEquals(versiuneIncompatibila({ versiune: { ...baza, model: 'alt', prompt_sha: 'x', cod: 'b' } }, baza, true), null, 'model/prompt/cod: mixare permisă')
  assert(versiuneIncompatibila({ versiune: { ...baza, model: 'alt' } }, baza, false), 'fără mixare: refuz')
  for (const c of ['taiat_la', 'cale_felii', 'geom_sha', 'fisier', 'fisier_path']) {
    const m = versiuneIncompatibila({ versiune: { ...baza, [c]: 'ALTUL' } }, baza, true)
    assert(m && m.includes(c), c)
    assert(versiuneIncompatibila({ versiune: { ...baza, [c]: 'ALTUL' } }, baza, false), c + ' fără mixare')
  }
})
Deno.test('R4: mixare_permisa=true + geometrie/tăiere diferită -> 409 în handler, zero AI, zero scrieri', async () => {
  const v = await versiuneCurenta()
  for (const [camp, alt] of [['geom_sha', 'grila-veche'], ['taiat_la', 'T0'], ['cale_felii', '95/felii/999'], ['fisier', 'PL1-vechi.pdf']]) {
    const ca = { felii: [felie('1_1')], versiune: { ...v, model: 'alt-model', [camp]: alt }, taiat_la: 'T1', rev: 'r0' }
    const { supa, n } = supaCu({ id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', analiza: { plansa: PLANSA, citire_ai: ca } })
    const r = await handler(cerereSvc({ doc_id: 470, de_la: 4, mixare_permisa: true }), { SERVICE: 'svc', API_KEY: 'k', supa, getUser: () => Promise.resolve(null), fetch: aiFals(n, 0) })
    assertEquals(r.status, 409, camp)
    assert((await r.text()).includes(camp))
    assertEquals(n.ai, 0); assertEquals(n.scrieriDoc, 0)
  }
  // doar modelul diferă + mixare_permisa => trece
  const ca = { felii: [felie('1_1')], versiune: { ...v, model: 'alt-model' }, taiat_la: 'T1', rev: 'r0' }
  const { supa, n } = supaCu({ id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', analiza: { plansa: PLANSA, citire_ai: ca } })
  const r = await handler(cerereSvc({ doc_id: 470, de_la: 4, mixare_permisa: true }), { SERVICE: 'svc', API_KEY: 'k', supa, getUser: () => Promise.resolve(null), fetch: aiFals(n, 0) })
  assertEquals(r.status, 200)
})

// ---- R4 (Copilot) pct. 4: transfer serializat prin lease pe citire_ai.transfer ----
function aiDn(n: { ai: number }, ms: number) {
  return (async (_u: unknown, init?: RequestInit) => {
    n.ai++
    const txt = JSON.parse(String(init?.body || '{}')).messages?.[0]?.content?.find((c: any) => c.type === 'text')?.text || ''
    const et = /Bucata (\S+)/.exec(txt)?.[1] || '?'
    await new Promise((ok) => setTimeout(ok, ms))
    // 25.09.2026 (identitate de rând): rândul de tabel vine cu tabelul lui și cu Nr (unic pe zonă) — fără ele ar fi
    // „de verificat” (fără identitate sigură) și n-ar mai intra în transfer
    const rasp = { tronsoane: [{ de_la: `N-${et}`, la: 'X', lungime_m: 100, diametru_mm: 110, material: 'PE100 SDR11', sursa: 'tabel' }], cartus: {},
      tabele: [{ denumire: 'Dimensionare', coloane: ['Nr crt', 'De la', 'La', 'Dn', 'L (m)'], randuri: [{ 'Nr crt': et.replace(/\D/g, ''), 'De la': `N-${et}`, 'La': 'X', 'Dn': '110', 'L (m)': '100' }] }] }
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(rasp) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })
  }) as typeof fetch
}
// R4 runda 3 (rezervare pe zonă): testul vechi accepta că ambele taburi plătesc zonele (4+4 apeluri AI) și verifica doar
// transferul unic. Acum al doilea tab NU mai plătește: zonele sunt rezervate de primul => 409 „în lucru”, 4 apeluri AI în total.
Deno.test('R4: două rulări simultane „citește” -> al doilea tab nu plătește (zone rezervate), un singur transfer', async () => {
  const Z4 = ['1_1', '1_2', '2_1', '2_2']
  const pl = { ...PLANSA, zone_asteptate: Z4, acoperire_demonstrata: true }
  const { supa, n, tabele } = supaCu({ id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', analiza: { plansa: pl } }, Z4, { intarziereSelectCantitati: 60 })
  const deps = (ms: number) => ({ SERVICE: 'svc', API_KEY: 'k', supa, getUser: () => Promise.resolve(null), fetch: aiDn(n, ms) })
  const [ra, rb] = await Promise.all([handler(cerereSvc({ doc_id: 470, de_la: 0 }), deps(5)), handler(cerereSvc({ doc_id: 470, de_la: 0 }), deps(25))])
  // cine rezervă primul nu e determinist (digest-urile async se termină în orice ordine) — contează că e UNUL singur
  assertEquals([ra.status, rb.status].sort(), [200, 409])
  const jb = ra.status === 409 ? await ra.json() : await rb.json()
  assert(jb.error.includes('în lucru în alt tab'), jb.error)
  assertEquals(jb.in_lucru, Z4.map((z) => `z${z}`))
  assertEquals(jb.cost_usd, 0)
  assertEquals(n.ai, 4, 'fiecare zonă plătită o singură dată')
  assertEquals(n.rpc, 1)
  assertEquals(n.inserts.filter((t) => t === 'ofertare_cantitati').length, 1, 'o singură inserare pe Dn110 PE')
  const doc = (await tabele.from('ofertare_documente_atribuire').select().eq('id', 470).maybeSingle()).data
  assertEquals(doc.analiza.citire_ai.transfer.stare, 'facut')
  assertEquals(doc.analiza.rezervari_zone.zone, {}, 'rezervările lui A eliberate la scrierea rezultatului')
})
// Traseul lease-ului (păstrat din testul vechi): un „citește” NOU (altă rulare, plătește legitim — zonele erau libere)
// ajunge la transfer în timp ce transferul primei rulări e în zbor => îl sare; o singură inserare, un singur RPC.
Deno.test('R4: „citește” nou terminat în timpul transferului altei rulări -> transfer sărit (lease), o singură inserare', async () => {
  const Z4 = ['1_1', '1_2', '2_1', '2_2']
  const pl = { ...PLANSA, zone_asteptate: Z4, acoperire_demonstrata: true }
  let supa: any, n: any, tabele: any, rb: any = null, primul = true
  const deps = () => ({ SERVICE: 'svc', API_KEY: 'k', supa, getUser: () => Promise.resolve(null), fetch: aiDn(n, 1) })
  const laSelect = async () => { if (!primul) return; primul = false; rb = await handler(cerereSvc({ doc_id: 470, de_la: 0 }), deps()) }
  ;({ supa, n, tabele } = supaCu({ id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', analiza: { plansa: pl } }, Z4, { laSelectCantitati: laSelect }))
  const ra = await handler(cerereSvc({ doc_id: 470, de_la: 0 }), deps())
  assert(rb, 'B a rulat în timpul transferului lui A')
  assertEquals([ra.status, rb.status], [200, 200])
  const [ja, jb] = [await ra.json(), await rb.json()]
  assertEquals(jb.cantitati?.sarit, 'transfer în curs de altă rulare')
  assertEquals(ja.cantitati?.adaugate, 1)
  assertEquals(n.rpc, 1, 'doar deținătorul lease-ului a apelat RPC-ul de transfer')
  assertEquals(n.inserts.filter((t: string) => t === 'ofertare_cantitati').length, 1)
  const doc = (await tabele.from('ofertare_documente_atribuire').select().eq('id', 470).maybeSingle()).data
  assertEquals(doc.analiza.citire_ai.transfer.stare, 'facut')
})
Deno.test('leaseTransferOcupat: in_curs recent al altei rulări / făcut concurent -> ocupat; expirat, propriu sau vechi -> liber', () => {
  const acum = Date.parse('2026-09-25T12:00:00Z'), pornit = Date.parse('2026-09-25T11:59:00Z')
  assertEquals(leaseTransferOcupat(null, 'B', pornit, acum), null)
  assertEquals(leaseTransferOcupat({ stare: 'in_curs', de_la: '2026-09-25T11:59:30Z', rulare: 'A' }, 'B', pornit, acum), 'transfer în curs de altă rulare')
  assertEquals(leaseTransferOcupat({ stare: 'in_curs', de_la: '2026-09-25T11:59:30Z', rulare: 'B' }, 'B', pornit, acum), null)
  assertEquals(leaseTransferOcupat({ stare: 'in_curs', de_la: '2026-09-25T11:50:00Z', rulare: 'A' }, 'B', pornit, acum), null, 'expirat (worker mort)')
  assert(leaseTransferOcupat({ stare: 'facut', de_la: '2026-09-25T11:59:10Z', rulare: 'A' }, 'B', pornit, acum))
  assertEquals(leaseTransferOcupat({ stare: 'facut', de_la: '2026-09-25T10:00:00Z', rulare: 'A' }, 'B', pornit, acum), null, 'transfer vechi => citire nouă transferă')
  assertEquals(leaseTransferOcupat({ stare: 'eroare', de_la: '2026-09-25T11:59:10Z', rulare: 'A' }, 'B', pornit, acum), null)
})
Deno.test('R4: lease expirat în timpul transferului lui A -> B preia; A revine și NU mai scrie (fără rând dublu, cantitățile lui B intacte)', async () => {
  const Z4 = ['1_1', '1_2', '2_1', '2_2']
  const pl = { ...PLANSA, zone_asteptate: Z4, acoperire_demonstrata: true }
  let primul = true; let rb: any = null
  let n: any, tabele: any, supa: any
  const deps = () => ({ SERVICE: 'svc', API_KEY: 'k', supa, getUser: () => Promise.resolve(null), fetch: aiDn(n, 1) })
  // A intră în transfer (a citit ofertare_cantitati) și „adoarme”: lease-ul lui expiră (de_la împins cu 6 min în urmă),
  // B pornește, preia lease-ul expirat, transferă și îl eliberează ca „facut”; abia apoi A continuă.
  const laSelect = async () => {
    if (!primul) return
    primul = false
    const doc = (await tabele.from('ofertare_documente_atribuire').select().eq('id', 470).maybeSingle()).data
    const tr = doc.analiza.citire_ai.transfer
    assertEquals(tr.stare, 'in_curs')
    await tabele.from('ofertare_documente_atribuire').update({ analiza: { ...doc.analiza, citire_ai: { ...doc.analiza.citire_ai,
      transfer: { ...tr, de_la: new Date(Date.now() - 6 * 60 * 1000).toISOString() } } } }).eq('id', 470)
    rb = await handler(cerereSvc({ doc_id: 470, de_la: 0 }), deps())
  }
  ;({ supa, n, tabele } = supaCu({ id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', analiza: { plansa: pl } }, Z4, { laSelectCantitati: laSelect }))
  const ra = await handler(cerereSvc({ doc_id: 470, de_la: 0 }), deps())
  assert(rb, 'B a rulat în timp ce A dormea')
  assertEquals([ra.status, rb!.status], [200, 200])
  const [ja, jb] = [await ra.json(), await rb!.json()]
  assertEquals(jb.cantitati?.adaugate, 1, 'B a transferat')
  const rand = (await tabele.from('ofertare_cantitati').select()).data
  assertEquals(rand.length, 1, 'un singur rând pe Dn110 PE')
  assertEquals(n.inserts.filter((t: string) => t === 'ofertare_cantitati').length, 1)
  assertEquals(rand[0].cantitate, 400, 'cantitatea lui B intactă')
  assert(ja.cantitati?.sarit || ja.cantitati?.lease_pierdut, `A trebuie să raporteze lease pierdut: ${JSON.stringify(ja.cantitati)}`)
  const doc = (await tabele.from('ofertare_documente_atribuire').select().eq('id', 470).maybeSingle()).data
  assertEquals(doc.analiza.citire_ai.transfer.stare, 'facut')
  assertEquals(doc.analiza.citire_ai.sumar.cantitati.adaugate, 1, 'sumarul e al lui B, nu suprascris de A')
})

// ---- R4 (Copilot, atomic): lease + scrieri + „facut” într-un singur RPC ----
Deno.test('R4 atomic: lease pierdut înainte de RPC -> rpc întoarce lease_pierdut, 0 scrieri în ofertare_cantitati', async () => {
  const Z4 = ['1_1', '1_2', '2_1', '2_2']
  const pl = { ...PLANSA, zone_asteptate: Z4, acoperire_demonstrata: true }
  let tabele: any
  const furaLease = async () => {
    const doc = (await tabele.from('ofertare_documente_atribuire').select().eq('id', 470).maybeSingle()).data
    await tabele.from('ofertare_documente_atribuire').update({ analiza: { ...doc.analiza, citire_ai: { ...doc.analiza.citire_ai,
      transfer: { ...doc.analiza.citire_ai.transfer, rulare: 'ALTA', de_la: new Date().toISOString() } } } }).eq('id', 470)
  }
  const r = supaCu({ id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', analiza: { plansa: pl } }, Z4, { inainteDeRpc: furaLease })
  tabele = r.tabele
  const res = await handler(cerereSvc({ doc_id: 470, de_la: 0 }), { SERVICE: 'svc', API_KEY: 'k', supa: r.supa, getUser: () => Promise.resolve(null), fetch: aiDn(r.n, 1) })
  assertEquals(res.status, 200)
  const j = await res.json()
  assertEquals(r.n.rpc, 1)
  assert(j.cantitati?.lease_pierdut, JSON.stringify(j.cantitati))
  assertEquals((await tabele.from('ofertare_cantitati').select()).data.length, 0)
  assertEquals(r.n.inserts.filter((t: string) => t === 'ofertare_cantitati').length, 0)
  const doc = (await tabele.from('ofertare_documente_atribuire').select().eq('id', 470).maybeSingle()).data
  assertEquals(doc.analiza.citire_ai.transfer.rulare, 'ALTA', 'lease-ul altei rulări nu e atins')
  assertEquals(doc.analiza.citire_ai.transfer.stare, 'in_curs')
})
Deno.test('R4 atomic: două apeluri RPC cu aceeași cheie (licitație+denumire+sursă) -> un singur rând', async () => {
  const doc = { id: 470, licitatie_id: 95, analiza: { citire_ai: { transfer: { stare: 'in_curs', rulare: 'R1' } } } }
  const d = db({ ofertare_documente_atribuire: [doc], ofertare_cantitati: [] })
  const row = { denumire: 'Conductă distribuție gaze PE Dn110', sursa: 'Planșa 1 — tabel de dimensionare, citit automat din scanare', um: 'm', cantitate: 400, cantitate_plansa: 400 }
  const r1 = await d.rpc('ofertare_transfer_plansa_cantitati', { p_doc_id: 470, p_rulare: 'R1', p_randuri: [{ op: 'insert', row }] })
  assertEquals(r1.data.adaugate, 1)
  doc.analiza.citire_ai.transfer = { stare: 'in_curs', rulare: 'R2' } as any // reluare (ex. după eroare)
  const r2 = await d.rpc('ofertare_transfer_plansa_cantitati', { p_doc_id: 470, p_rulare: 'R2', p_randuri: [{ op: 'insert', row }] })
  assertEquals([r2.data.adaugate, r2.data.sarite_existente], [0, 1])
  assertEquals((await d.from('ofertare_cantitati').select()).data.length, 1)
  const r3 = await d.rpc('ofertare_transfer_plansa_cantitati', { p_doc_id: 470, p_rulare: 'R2', p_randuri: [{ op: 'insert', row }] })
  assertEquals(r3.data.eroare, 'lease_pierdut', 'după „facut” același lease nu mai scrie')
})

// ---- R4 (Copilot, runda 3): REZERVARE per (doc, zonă, tăiere) înainte de apelul AI ----
const cheieV = (v: any) => `${v.cod}|${v.model}|${v.prompt_sha}`
// AI simulat care ține minte CE zonă a citit (fiecare apel = o zonă plătită)
function aiEtichete(n: { ai: number }, ms: number, etichete: string[]) {
  return (async (_u: unknown, init?: RequestInit) => {
    n.ai++
    const txt = JSON.parse(String(init?.body || '{}')).messages?.[0]?.content?.find((c: any) => c.type === 'text')?.text || ''
    etichete.push(/Bucata (\S+)/.exec(txt)?.[1] || '?')
    await new Promise((ok) => setTimeout(ok, ms))
    const rasp = { tronsoane: [], cartus: { titlu: 'Plan' }, tabele: [] }
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(rasp) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })
  }) as typeof fetch
}
// citire salvată pe T1 cu zonele date citite (versiunea curentă) — restul din ZONE lipsesc
async function citireSalvata(zone: string[], extra: any = {}) {
  const v = await versiuneCurenta()
  return { felii: zone.map((z) => ({ ...felie(z), _versiune: cheieV(v) })), versiune: v, taiat_la: 'T1', gata: false, rev: 'r0', rulare: 'R', sumar: {}, metrici: [], ...extra }
}
const docCu = (ca: any, extraAnaliza: any = {}) => ({ id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', analiza: { plansa: PLANSA, citire_ai: ca, ...extraAnaliza } })
const svc = (n: any, f: typeof fetch, supa: any) => ({ SERVICE: 'svc', API_KEY: 'k', supa, getUser: () => Promise.resolve(null), fetch: f })
const citesteDoc = async (tabele: any) => (await tabele.from('ofertare_documente_atribuire').select().eq('id', 470).maybeSingle()).data
const citesteDoc130 = async (tabele: any) => (await tabele.from('ofertare_documente_atribuire').select().eq('id', 130).maybeSingle()).data
const rez = (rulare: string, taiat: string, deLaMin: number, panaMin: number) =>
  ({ rulare, taiat_la: taiat, de_la: new Date(Date.now() + deLaMin * 60000).toISOString(), pana_la: new Date(Date.now() + panaMin * 60000).toISOString() })

Deno.test('R4 rezervare: două „continuă” simultane pe aceleași zone -> UN singur apel AI pe zonă; al doilea tab: 409 „în lucru în alt tab”, zero AI', async () => {
  const ca = await citireSalvata(['1_1', '1_2', '1_3', '1_4'])
  const { supa, n, tabele } = supaCu(docCu(ca))
  const et: string[] = []
  const [ra, rb] = await Promise.all([
    handler(cerereSvc({ doc_id: 470, mod: 'continua' }), svc(n, aiEtichete(n, 20, et), supa)),
    handler(cerereSvc({ doc_id: 470, mod: 'continua' }), svc(n, aiEtichete(n, 20, et), supa)),
  ])
  const st = [ra.status, rb.status].sort()
  assertEquals(st, [200, 409])
  const perdant = ra.status === 409 ? await ra.json() : await rb.json()
  assert(perdant.error.includes('în lucru în alt tab'), perdant.error)
  assert(perdant.error.includes('nu s-a apelat AI'))
  assertEquals(perdant.in_lucru, ['z1_5', 'z1_6'])
  assertEquals(perdant.citite_acum, 0)
  assertEquals(n.ai, 2, 'z1_5 și z1_6 citite (plătite) o singură dată')
  assertEquals(et.sort(), ['z1_5', 'z1_6'])
  const doc = await citesteDoc(tabele)
  assertEquals(doc.analiza.citire_ai.felii.map((f: any) => f.eticheta), ZONE.map((z) => `z${z}`))
  assertEquals(doc.analiza.citire_ai.gata, true)
  assertEquals(doc.analiza.rezervari_zone.zone, {}, 'nicio rezervare rămasă agățată')
})

Deno.test('R4 rezervare: două taburi pe zone care se suprapun parțial -> fiecare zonă citită exact o dată (cooperare, fără 409)', async () => {
  const ca = await citireSalvata(['1_1'])                 // lipsesc 1_2..1_6 (5 zone); un lot = max 4
  const { supa, n, tabele } = supaCu(docCu(ca))
  const et: string[] = []
  const [ra, rb] = await Promise.all([
    handler(cerereSvc({ doc_id: 470, mod: 'continua' }), svc(n, aiEtichete(n, 20, et), supa)),
    handler(cerereSvc({ doc_id: 470, mod: 'continua' }), svc(n, aiEtichete(n, 5, et), supa)),
  ])
  assertEquals([ra.status, rb.status], [200, 200])
  assertEquals(n.ai, 5)
  assertEquals([...et].sort(), ['z1_2', 'z1_3', 'z1_4', 'z1_5', 'z1_6'], 'nicio zonă plătită de două ori')
  const [ja, jb] = [await ra.json(), await rb.json()]
  // cel care a primit restul vede zonele celuilalt ca „în lucru” și NU cere o rundă nouă pentru ele
  const alDoilea = ja.citite_acum === 1 ? ja : jb
  assertEquals(alDoilea.in_lucru_alt_tab, ['z1_2', 'z1_3', 'z1_4', 'z1_5'])
  const doc = await citesteDoc(tabele)
  assertEquals(doc.analiza.citire_ai.felii.length, 6)
  assertEquals(doc.analiza.citire_ai.gata, true)
  assertEquals(doc.analiza.rezervari_zone.zone, {})
})

Deno.test('R4 rezervare: rezervare ACTIVĂ a altei rulări pe aceleași zone -> 409, zero AI, zero scrieri', async () => {
  const ca = await citireSalvata(['1_1', '1_2', '1_3', '1_4'])
  const rz = { rev: 'rz0', zone: { z1_5: rez('VIU', 'T1', -1, 6), z1_6: rez('VIU', 'T1', -1, 6) } }
  const { supa, n, tabele } = supaCu(docCu(ca, { rezervari_zone: rz }))
  const r = await handler(cerereSvc({ doc_id: 470, mod: 'continua' }), svc(n, aiFals(n, 0), supa))
  assertEquals(r.status, 409)
  const j = await r.json()
  assert(j.error.includes('în lucru în alt tab') && j.error.includes('rezervate până la'), j.error)
  assertEquals(j.rezervat_pana_la, rz.zone.z1_6.pana_la)
  assertEquals(n.ai, 0); assertEquals(n.scrieriDoc, 0)
  assertEquals((await citesteDoc(tabele)).analiza.rezervari_zone, rz, 'rezervarea celuilalt tab neatinsă')
})

Deno.test('R4 rezervare: rezervare EXPIRATĂ (tab închis / funcție omorâtă) -> preluată: zona se citește, rezervarea veche curățată', async () => {
  const ca = await citireSalvata(['1_1', '1_2', '1_3', '1_4'])
  const rz = { rev: 'rz0', zone: { z1_5: rez('MORT', 'T1', -10, -1), z1_6: rez('MORT', 'T1', -10, -1) } }
  const { supa, n, tabele } = supaCu(docCu(ca, { rezervari_zone: rz }))
  const et: string[] = []
  const r = await handler(cerereSvc({ doc_id: 470, mod: 'continua' }), svc(n, aiEtichete(n, 0, et), supa))
  assertEquals(r.status, 200)
  assertEquals(et.sort(), ['z1_5', 'z1_6'])
  const doc = await citesteDoc(tabele)
  assertEquals(doc.analiza.citire_ai.gata, true)
  assertEquals(doc.analiza.rezervari_zone.zone, {}, 'rezervarea expirată a rulării moarte a fost curățată')
  assert(doc.analiza.rezervari_zone.rev !== 'rz0')
})

Deno.test('R4 rezervare: rezervare activă pe ALTĂ tăiere nu blochează (zonele nu mai corespund)', async () => {
  const ca = await citireSalvata(['1_1', '1_2', '1_3', '1_4'])
  const rz = { rev: 'rz0', zone: { z1_5: rez('VECHE', 'T0', -1, 6), z1_6: rez('VECHE', 'T0', -1, 6) } }
  const { supa, n } = supaCu(docCu(ca, { rezervari_zone: rz }))
  const r = await handler(cerereSvc({ doc_id: 470, mod: 'continua' }), svc(n, aiFals(n, 0), supa))
  assertEquals(r.status, 200); assertEquals(n.ai, 2)
})

Deno.test('R4 rezervare: rezervarea se ia ÎNAINTE de AI (vizibilă în timpul apelului) și se eliberează la scriere', async () => {
  const ca = await citireSalvata(['1_1', '1_2', '1_3', '1_4'])
  const { supa, n, tabele } = supaCu(docCu(ca))
  const vazute: any[] = []
  const f = (async (u: unknown, i?: RequestInit) => {
    vazute.push(structuredClone((await citesteDoc(tabele)).analiza.rezervari_zone))
    return aiFals(n, 0)(u as any, i)
  }) as typeof fetch
  const r = await handler(cerereSvc({ doc_id: 470, mod: 'continua' }), svc(n, f, supa))
  assertEquals(r.status, 200)
  const z = vazute[0].zone
  assertEquals(Object.keys(z).sort(), ['z1_5', 'z1_6'])
  assertEquals(z.z1_5.taiat_la, 'T1')
  const durata = Date.parse(z.z1_5.pana_la) - Date.parse(z.z1_5.de_la)
  assertEquals(durata, REZERVARE_EXPIRA_MS)
  assert(REZERVARE_EXPIRA_MS > 400_000, 'termenul > limita de ceas Edge (400 s pe planurile plătite)')
  assertEquals((await citesteDoc(tabele)).analiza.rezervari_zone.zone, {})
})

Deno.test('R4 rezervare: scrierea rezultatului epuizează CAS -> 409, dar rezervarea rulării e eliberată (zona nu rămâne blocată)', async () => {
  const ca = await citireSalvata(['1_1', '1_2', '1_3', '1_4'])
  let dupaAI = false, k = 0
  const { supa, n, tabele } = supaCu(docCu(ca), ZONE, {
    inainteDeUpdateDoc: (rows) => { if (!dupaAI || k >= 3) return; const c = rows[0].analiza.citire_ai; rows[0].analiza.citire_ai = { ...c, rev: `alt-${++k}` } } })
  const f = (async (u: unknown, i?: RequestInit) => { const r = await aiFals(n, 0)(u as any, i); dupaAI = true; return r }) as typeof fetch
  const r = await handler(cerereSvc({ doc_id: 470, mod: 'continua' }), svc(n, f, supa))
  assertEquals(r.status, 409)
  assert((await r.json()).error.includes('3 încercări'))
  assertEquals(n.ai, 2)
  const doc = await citesteDoc(tabele)
  assertEquals(doc.analiza.rezervari_zone.zone, {}, 'eliberată best-effort după eșec')
  assertEquals(doc.analiza.citire_ai.felii.length, 4, 'nimic suprascris')
})

Deno.test('R4 rezervare: „citește” pe runde (de_la) sare zonele rezervate de alt tab și avansează corect', async () => {
  const ca = await citireSalvata(['1_1', '1_2', '1_3', '1_4'], { rulare: 'R' })
  // alt tab („continuă”) are rezervată 1_5; runda de_la=4 citește doar 1_6 și nu cere reluarea pentru 1_5
  const rz = { rev: 'rz0', zone: { z1_5: rez('ALT', 'T1', -1, 6) } }
  const { supa, n } = supaCu(docCu(ca, { rezervari_zone: rz }))
  const et: string[] = []
  const r = await handler(cerereSvc({ doc_id: 470, de_la: 4 }), svc(n, aiEtichete(n, 0, et), supa))
  assertEquals(r.status, 200)
  const j = await r.json()
  assertEquals(et, ['z1_6'])
  assertEquals(j.in_lucru_alt_tab, ['z1_5'])
  assertEquals(j.continua, false)
  assertEquals(j.de_la_urmator, 6)
})

Deno.test('R4 rezervare: „note tăiate” din două taburi simultan -> perechea plătită o singură dată', async () => {
  const v = await versiuneCurenta()
  const ca = { felii: [{ eticheta: 'z1_1', alte_mentiuni: ['Lungimea totala a retelei este de ... (taiat)'] }, { eticheta: 'z1_2' }].map((f) => ({ ...f, _versiune: cheieV(v) })),
    versiune: v, taiat_la: 'T1', gata: true, rev: 'r0', rulare: 'R', sumar: {}, metrici: [] }
  const { supa, n, tabele } = supaCu(docCu(ca), ['1_1', '1_2'])
  const aiLipire = (async () => {
    n.ai++
    await new Promise((ok) => setTimeout(ok, 10))
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"randuri":[{"text":"Lungimea totala a retelei este de 1200 m"}]}' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })
  }) as typeof fetch
  const [ra, rb] = await Promise.all([
    handler(cerereSvc({ doc_id: 470, doar_lipire: true }), svc(n, aiLipire, supa)),
    handler(cerereSvc({ doc_id: 470, doar_lipire: true }), svc(n, aiLipire, supa)),
  ])
  assertEquals([ra.status, rb.status].sort(), [200, 409])
  assertEquals(n.ai, 1, 'perechea z1_1+z1_2 citită o singură dată')
  const perdant = ra.status === 409 ? await ra.json() : await rb.json()
  assertEquals(perdant.in_lucru, ['lipire:z1_1+z1_2'])
  const doc = await citesteDoc(tabele)
  assertEquals(doc.analiza.citire_ai.sumar.lungime_declarata_m, 1200)
  assertEquals(doc.analiza.rezervari_zone.zone, {})
})

Deno.test('rezervateDeAltii / rezervariNoi: active vs expirate vs altă tăiere vs proprii; jeton nou la fiecare scriere', () => {
  const acum = Date.parse('2026-09-25T12:00:00Z')
  const rz = { rev: 'x', zone: {
    a: { rulare: 'A', taiat_la: 'T1', pana_la: '2026-09-25T12:05:00Z' },   // activă, altă rulare
    b: { rulare: 'B', taiat_la: 'T1', pana_la: '2026-09-25T11:59:00Z' },   // expirată
    c: { rulare: 'C', taiat_la: 'T0', pana_la: '2026-09-25T12:05:00Z' },   // altă tăiere
    d: { rulare: 'EU', taiat_la: 'T1', pana_la: '2026-09-25T12:05:00Z' },  // a mea
  } }
  assertEquals([...rezervateDeAltii(rz, 'T1', 'EU', acum).keys()], ['a'])
  assertEquals([...rezervateDeAltii(null, 'T1', 'EU', acum).keys()], [])
  const el = rezervariNoi(rz, 'T1', acum, { scoateRulare: 'EU' })
  assertEquals(Object.keys(el.zone), ['a'], 'eliberare: rămân doar rezervările active ale altora')
  assert(el.rev !== 'x')
  const nou = rezervariNoi(rz, 'T1', acum, { adauga: { chei: ['e'], rulare: 'EU' } })
  assertEquals(Object.keys(nou.zone).sort(), ['a', 'd', 'e'])
  assertEquals(nou.zone.e.pana_la, new Date(acum + REZERVARE_EXPIRA_MS).toISOString())
  assertEquals(CALE_REZ, 'analiza->rezervari_zone->>rev')
})

// ---- R4 (verificator, runda 1): „citește” de la zero NU cooperează; plafon pe pana_la ----
// Bucla din UI (src/OfertareLicitatii.jsx, citestePlansa — fără /api/plansa-felii): de_la=0, apoi de_la_urmator cât timp continua.
async function buclaCiteste(deps: any, doc = 470) {
  const statusuri: number[] = []
  let deLa = 0, runde = 0, ult: any = null
  while (runde < 25) {
    const r = await handler(cerereSvc({ doc_id: doc, de_la: deLa }), deps)
    ult = { status: r.status, j: await r.json() }
    statusuri.push(r.status)
    if (r.status !== 200 || !ult.j.continua) break
    deLa = ult.j.de_la_urmator; runde++
  }
  return { ...ult, statusuri }
}
// AI simulat cu întârziere pe zonă (zonele „lente” țin rezervarea mai mult)
function aiPeZona(n: { ai: number }, ms: (et: string) => number, etichete: string[]) {
  return (async (_u: unknown, init?: RequestInit) => {
    n.ai++
    const txt = JSON.parse(String(init?.body || '{}')).messages?.[0]?.content?.find((c: any) => c.type === 'text')?.text || ''
    const et = /Bucata (\S+)/.exec(txt)?.[1] || '?'
    etichete.push(et)
    await new Promise((ok) => setTimeout(ok, ms(et)))
    const rasp = { tronsoane: [{ de_la: `N-${et}`, la: 'X', lungime_m: 10, sursa: 'tabel' }], cartus: { titlu: 'Plan' }, tabele: [] }
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(rasp) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })
  }) as typeof fetch
}

for (const [varianta, ms] of [
  ['aceeași viteză', (_: string) => 15],
  ['zonele 5–6 mai lente', (et: string) => (et === 'z1_5' || et === 'z1_6' ? 60 : 5)],
] as [string, (et: string) => number][]) {
  Deno.test(`R4 reset: două bucle „citește” de la zero pe 6 zone (${varianta}) -> 6 apeluri AI, 6 zone salvate, gata; al doilea tab 409 fără AI`, async () => {
    const { supa, n, tabele } = supaCu({ id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', analiza: { plansa: PLANSA } })
    const et: string[] = []
    const deps = svc(n, aiPeZona(n, ms, et), supa)
    const [a, b] = await Promise.all([buclaCiteste(deps), buclaCiteste(deps)])
    assertEquals([a.status, b.status].sort(), [200, 409])
    const perdant = a.status === 409 ? a : b, castigator = a.status === 409 ? b : a
    assert(perdant.j.error.includes('în lucru în alt tab'), perdant.j.error)
    assertEquals(perdant.j.cost_usd, 0); assertEquals(perdant.j.citite_acum, 0)
    assertEquals(perdant.statusuri, [409], 'al doilea tab se oprește din prima rundă, fără nicio plată')
    assertEquals(castigator.j.continua, false)
    assertEquals(n.ai, 6, 'fiecare zonă plătită o singură dată')
    assertEquals([...et].sort(), ZONE.map((z) => `z${z}`))
    const doc = await citesteDoc(tabele)
    const salvate = doc.analiza.citire_ai.felii.map((f: any) => f.eticheta)
    assertEquals(salvate, ZONE.map((z) => `z${z}`))
    assert(et.every((z) => salvate.includes(z)), 'niciun rezultat plătit pierdut')
    assertEquals(doc.analiza.citire_ai.gata, true)
    assertEquals(doc.analiza.rezervari_zone.zone, {})
  })
}

Deno.test('R4 reset: „citește” de la zero cu o rezervare activă a altei rulări (continuă / note) -> 409, zero AI, zero scrieri', async () => {
  for (const cheie of ['z1_5', 'lipire:z1_1+z1_2']) {
    const ca = await citireSalvata(['1_1', '1_2', '1_3', '1_4'])
    const rz = { rev: 'rz0', zone: { [cheie]: rez('ALT', 'T1', -1, 6) } }
    const { supa, n, tabele } = supaCu(docCu(ca, { rezervari_zone: rz }))
    const r = await handler(cerereSvc({ doc_id: 470, de_la: 0 }), svc(n, aiFals(n, 0), supa))
    assertEquals(r.status, 409, cheie)
    const j = await r.json()
    assert(j.error.includes('în lucru în alt tab') && j.error.includes('de la zero'), j.error)
    assertEquals(j.in_lucru, [cheie])
    assertEquals(n.ai, 0); assertEquals(n.scrieriDoc, 0)
    assertEquals((await citesteDoc(tabele)).analiza.rezervari_zone, rz)
  }
})

Deno.test('R4 reset: cât timp un „citește” de la zero al altei rulări e în zbor, continuă / reia / runda următoare / note -> 409, zero AI', async () => {
  const v = await versiuneCurenta()
  for (const body of [{ mod: 'continua' }, { mod: 'reia_erori' }, { de_la: 4 }, { doar_lipire: true }]) {
    const ca = { ...(await citireSalvata(['1_1', '1_2', '1_3', '1_4'])), gata: !!(body as any).doar_lipire }
    if ((body as any).mod === 'reia_erori') ca.felii[1] = { eticheta: 'z1_2', eroare: 'timeout', _versiune: cheieV(v) }
    if ((body as any).doar_lipire) ca.felii[0] = { ...ca.felii[0], alte_mentiuni: ['Lungimea totala a retelei este de ... (taiat)'] }
    const rz = { rev: 'rz0', zone: { z1_1: { ...rez('RESET', 'T1', -1, 6), resetare: true } } }
    const { supa, n, tabele } = supaCu(docCu(ca, { rezervari_zone: rz }))
    const r = await handler(cerereSvc({ doc_id: 470, ...body }), svc(n, aiFals(n, 0), supa))
    assertEquals(r.status, 409, JSON.stringify(body))
    const j = await r.json()
    assert(j.error.includes('de la zero') && j.error.includes('nu s-a apelat AI'), j.error)
    assertEquals(j.in_lucru, ['z1_1'])
    assertEquals(n.ai, 0, JSON.stringify(body)); assertEquals(n.scrieriDoc, 0)
    assertEquals((await citesteDoc(tabele)).analiza.rezervari_zone, rz)
  }
})

Deno.test('R4 reset: „continuă” pornit în timpul rundei 1 a unui „citește” de la zero -> 409; citirea de la zero termină singură, 6 AI, nimic pierdut', async () => {
  const ca = await citireSalvata(['1_1', '1_2'])          // citire veche, necompletă, pe aceeași tăiere
  const { supa, n, tabele } = supaCu(docCu(ca))
  const et: string[] = []
  let rc: any = null
  const aiB = aiPeZona(n, () => 10, et)
  const fB = (async (u: unknown, i?: RequestInit) => {
    // în timpul primului apel AI al lui B (rezervările de reset sunt deja scrise), alt tab apasă „⏯ continuă”
    if (!rc) { rc = 'pornit'; const r = await handler(cerereSvc({ doc_id: 470, mod: 'continua' }), svc(n, aiPeZona(n, () => 0, et), supa)); rc = { status: r.status, j: await r.json() } }
    return aiB(u as any, i)
  }) as typeof fetch
  const b = await buclaCiteste(svc(n, fB, supa))
  assertEquals(b.status, 200)
  assertEquals(rc.status, 409)
  assert(rc.j.error.includes('de la zero'), rc.j.error)
  assertEquals(n.ai, 6)
  assertEquals([...et].sort(), ZONE.map((z) => `z${z}`))
  const doc = await citesteDoc(tabele)
  assertEquals(doc.analiza.citire_ai.felii.map((f: any) => f.eticheta), ZONE.map((z) => `z${z}`))
  assertEquals(doc.analiza.citire_ai.gata, true)
  assertEquals(doc.analiza.rezervari_zone.zone, {})
})

Deno.test('R4 plafon pana_la: activă doar dacă now < pana_la <= now + termen + 60 s (rezervare forjată/coruptă = expirată)', () => {
  const acum = Date.parse('2026-09-25T12:00:00Z')
  const la = (ms: number) => new Date(acum + ms).toISOString()
  const rz = { rev: 'x', zone: {
    ok: { rulare: 'A', taiat_la: 'T1', pana_la: la(REZERVARE_EXPIRA_MS) },
    tol: { rulare: 'A', taiat_la: 'T1', pana_la: la(REZERVARE_EXPIRA_MS + TOLERANTA_CEAS_MS) },
    peste: { rulare: 'A', taiat_la: 'T1', pana_la: la(REZERVARE_EXPIRA_MS + TOLERANTA_CEAS_MS + 1000) },
    forjata: { rulare: 'A', taiat_la: 'T1', pana_la: '2099-01-01T00:00:00Z' },
    invalida: { rulare: 'A', taiat_la: 'T1', pana_la: 'mâine' },
  } }
  assertEquals([...rezervateDeAltii(rz, 'T1', 'EU', acum).keys()], ['ok', 'tol'])
  assertEquals(Object.keys(rezervariNoi(rz, 'T1', acum).zone), ['ok', 'tol'], 'cele peste plafon se curăță la următoarea scriere')
  assert(!rezActiva(rz.zone.forjata, 'T1', acum))
  assertEquals(TOLERANTA_CEAS_MS, 60_000)
})

Deno.test('R4 plafon pana_la: rezervare forjată pe 2099 nu blochează citirea; se curăță la scriere', async () => {
  const ca = await citireSalvata(['1_1', '1_2', '1_3', '1_4'])
  const forjata = { rulare: 'X', taiat_la: 'T1', de_la: '2026-09-25T00:00:00Z', pana_la: '2099-01-01T00:00:00Z' }
  const rz = { rev: 'rz0', zone: { z1_5: forjata, z1_6: { ...forjata, resetare: true } } }
  const { supa, n, tabele } = supaCu(docCu(ca, { rezervari_zone: rz }))
  const et: string[] = []
  const r = await handler(cerereSvc({ doc_id: 470, mod: 'continua' }), svc(n, aiEtichete(n, 0, et), supa))
  assertEquals(r.status, 200)
  assertEquals(et.sort(), ['z1_5', 'z1_6'])
  const doc = await citesteDoc(tabele)
  assertEquals(doc.analiza.citire_ai.gata, true)
  assertEquals(doc.analiza.rezervari_zone.zone, {}, 'rezervarea forjată a fost curățată')
})

// ---- 25.09.2026: identitatea rândului pe planșa 470 — efectul asupra transferului (treciInCantitati) ----
// Rândurile 1751–1756 (lic. 95) au fost INSERATE de transferul din 25.09 16:51 cu agregarea veche (SELECT 25.09: cantitate =
// cantitate_plansa, status 'extras', sursa „Planșa 1 — tabel de dimensionare…”). Ce ar face un retransfer cu identitatea de rând
// (AI simulat = feliile reale z?_6 cu Nr + z?_7 cu lungimi, fixture_470.ts):
Deno.test('identitate 470: retransfer peste 1751–1756 -> doar 1756 (Dn40) primește cantitate_plansa 13740 + status diferenta; cantitate neatinsă; Dn60 menționat', async () => {
  const { raspuns470, AZI_470 } = await import('./fixture_470.ts')
  const Z = ['1_6', '1_7', '2_6', '2_7', '3_6', '3_7', '4_6', '4_7']
  const pl = { ...PLANSA, zone_asteptate: Z, acoperire_demonstrata: true }
  const { supa, n, tabele } = supaCu({ id: 470, licitatie_id: 95, nume_original: 'Schema tehnologica Valcelele alimentare din Stefan Voda.pdf', analiza: { plansa: pl } }, Z)
  const ids: Record<string, number> = { Dn200: 1751, Dn125: 1752, Dn110: 1753, Dn90: 1754, Dn63: 1755, Dn40: 1756 }
  const nTr: Record<string, number> = { Dn200: 8, Dn125: 12, Dn110: 7, Dn90: 19, Dn63: 30, Dn40: 54 }
  for (const [dn, id] of Object.entries(ids)) await tabele.from('ofertare_cantitati').insert({ id, licitatie_id: 95, categorie: 'Conducte și montaj',
    denumire: `Conductă distribuție gaze ${dn}`, um: 'm', cantitate: AZI_470[dn], cantitate_plansa: AZI_470[dn], status: 'extras', extras_de_ai: true,
    sursa: 'Planșa 1 — tabel de dimensionare, citit automat din scanare', diferenta_nota: `Diametru care nu apare în cantitățile din memoriu. ${nTr[dn]} tronsoane citite din tabelul planșei.` })
  n.inserts.length = 0
  const ai = (async (_u: unknown, init?: RequestInit) => {
    n.ai++
    const txt = JSON.parse(String(init?.body || '{}')).messages?.[0]?.content?.find((c: any) => c.type === 'text')?.text || ''
    const et = /Bucata (\S+)/.exec(txt)?.[1] || '?'
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(raspuns470(et)) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })
  }) as typeof fetch
  // 8 zone / 4 pe rulare => 2 runde (ca bucla din UI)
  let j: any = null
  for (let runde = 0; runde < 4; runde++) {
    const r = await handler(cerereSvc(runde === 0 ? { doc_id: 470, de_la: 0 } : { doc_id: 470, mod: 'continua' }), svc(n, ai, supa))
    assertEquals(r.status, 200)
    j = await r.json()
    if (!j.continua) break
  }
  assertEquals(n.ai, 8)
  assertEquals([j.sumar.total_sigur_m, j.sumar.total_de_verificat_m, j.sumar.conflicte, j.sumar.randuri_fara_identitate_n], [48905, 0, [], 0])
  assertEquals(j.sumar.identitate_randuri, { lecturi_tabel: 152, randuri_sigure: 133, prin_nr: 133, prin_pozitie: 0, fara_identitate: 0, conflicte: 0 })
  assertEquals([j.sumar.lungime_totala_m, j.sumar.tronsoane_gasite], [48795, 132], '48.905 − Nr 57 (Dn60 nestandard, 110 m)')
  // runda 5: pe 470 curat toate perechile z?_6+z?_7 au același număr de rânduri => niciun semnal „în afara suprapunerii”
  assertEquals([j.sumar.perechi_neimperecheate, j.sumar.perechi_neimperecheate_n], [undefined, undefined])
  assert(!j.sumar.avertismente.some((a: string) => a.includes('în afara suprapunerii')), j.sumar.avertismente.join(' | '))
  assertEquals([j.sumar.diametre_nestandard, j.sumar.nestandard_m], [[60], 110])
  assertEquals(j.cantitati.pe_diametre, { Dn200: 17785, Dn125: 2275, Dn110: 780, Dn90: 4545, Dn63: 9670, Dn40: 13740 })
  assertEquals([j.cantitati.adaugate, j.cantitati.actualizate], [0, 6], 'niciun rând nou; cele 6 existente primesc patch')
  assertEquals(n.inserts.filter((t: string) => t === 'ofertare_cantitati').length, 0)
  const rows = (await tabele.from('ofertare_cantitati').select()).data
  const r1756 = rows.find((x: any) => x.id === 1756)
  assertEquals([r1756.cantitate, r1756.cantitate_plansa, r1756.status], [13140, 13740, 'diferenta'], 'cantitate NEatinsă; doar cantitate_plansa + status')
  // R5 (rebase peste R4): 1751–1756 sunt scrise de transferul ANTERIOR al aceleiași planșe => „recitire”, nu „Memoriu … vs planșa”
  assert(r1756.diferenta_nota.startsWith('Diametru care nu apare în cantitățile din memoriu. Planșa 1 (recitire) dă 13.740 m pe 56 tronsoane — rândul are 13.140 m din citirea anterioară (+600 m)'), r1756.diferenta_nota)
  assert(!/^Memoriu/.test(r1756.diferenta_nota), r1756.diferenta_nota)
  assert(r1756.diferenta_nota.endsWith('De verificat, NEincluse în cifra din planșă: pe planșă: Dn nestandard Dn60: 110 m.'), r1756.diferenta_nota)
  for (const [dn, id] of Object.entries(ids)) {
    if (dn === 'Dn40') continue
    const x = rows.find((y: any) => y.id === id)
    assertEquals([x.cantitate, x.cantitate_plansa, x.status], [AZI_470[dn], AZI_470[dn], 'extras'], dn)
    // înainte de R5: „Planșa 1 confirmă:” (planșa confirmată de ea însăși); acum: valoare din planșă, fără confirmare
    assert(!/confirmă/.test(x.diferenta_nota) && x.diferenta_nota.includes('(recitire)') && x.diferenta_nota.includes('nu confirmare din memoriu'), `${dn}: ${x.diferenta_nota}`)
  }
})
Deno.test('identitate: transfer cu rânduri „de verificat” -> doar cele sigure în cantitate_plansa; restul numit în diferenta_nota, nepromovat', async () => {
  const Z = ['1_1', '2_1']
  const pl = { ...PLANSA, zone_asteptate: Z, acoperire_demonstrata: true }
  const { supa, n, tabele } = supaCu({ id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', analiza: { plansa: pl } }, Z)
  const COL = ['Nr crt', 'De la', 'La', 'Dn', 'L (km)']
  const rd = (nr: string, dl: string, L: string) => ({ 'Nr crt': nr, 'De la': dl, 'La': 'CT', 'Dn': '40', 'L (km)': L })
  const tr = (dl: string, L: number) => ({ de_la: dl, la: 'CT', lungime_m: L, diametru_mm: 40, material: 'PE100', sursa: 'tabel' })
  // z1_1: Nr 1 (300), Nr 2 (320), rând cu Nr ilizibil (250); z2_1: Nr 2 citit 330 (conflict cu 320)
  const felii: Record<string, any> = {
    z1_1: { tronsoane: [tr('A', 300), tr('B', 320), tr('C', 250)], tabele: [{ denumire: 'Dimensionare', coloane: COL, randuri: [rd('1', 'A', '0,300'), rd('2', 'B', '0,320'), rd('?', 'C', '0,250')] }] },
    z2_1: { tronsoane: [tr('B', 330)], tabele: [{ denumire: 'Dimensionare', coloane: COL, randuri: [rd('2', 'B', '0,330')] }] },
  }
  const ai = (async (_u: unknown, init?: RequestInit) => {
    n.ai++
    const et = /Bucata (\S+)/.exec(JSON.parse(String(init?.body || '{}')).messages?.[0]?.content?.find((c: any) => c.type === 'text')?.text || '')?.[1] || '?'
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ cartus: {}, ...felii[et] }) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })
  }) as typeof fetch
  const r = await handler(cerereSvc({ doc_id: 470, de_la: 0 }), svc(n, ai, supa))
  assertEquals(r.status, 200)
  const j = await r.json()
  assertEquals([j.sumar.total_sigur_m, j.sumar.total_de_verificat_m, j.sumar.randuri_fara_identitate_n, j.sumar.conflicte.length], [300, 580, 1, 1])
  assertEquals(j.sumar.conflicte[0].variante.map((v: any) => v.lungime_m), [320, 330])
  assertEquals(j.sumar.lungime_totala_m, 300, 'în cantități intră DOAR totalul sigur')
  assertEquals(j.cantitati.pe_diametre, { 'Dn40 PE': 300 })
  const rows = (await tabele.from('ofertare_cantitati').select()).data
  assertEquals(rows.length, 1)
  assertEquals([rows[0].cantitate, rows[0].cantitate_plansa], [300, 300])
  // runda 4: pe un Dn cu rânduri de verificat, poziția nouă (doar partea sigură) intră „diferenta”, nu „extras”
  assertEquals(rows[0].status, 'diferenta')
  assertEquals(rows[0].diferenta_nota, 'Diametru care nu apare în cantitățile din memoriu. 1 tronsoane citite din tabelul planșei. De verificat, NEincluse în cifra din planșă: ' +
    '1 rând Dn40 PE fără identitate sigură (250 m); 1 conflict Dn40 PE (până la 330 m); pe planșă: 1 rând de tabel fără identitate sigură (250 m); 1 conflict (același rând citit diferit: Nr 2 320 m Dn40 / 330 m Dn40).')
  assert(rows[0].diferenta_nota.includes('1 conflict (același rând citit diferit: Nr 2 320 m Dn40 / 330 m Dn40)'), rows[0].diferenta_nota)
  assert(j.sumar.avertismente.includes('1 rând de tabel fără identitate sigură și 1 conflict (același rând citit cu valori diferite): 580 m de verificat — NU intră în cantități'), j.sumar.avertismente.join(' | '))
  assertEquals(j.sumar.randuri_fara_identitate, [{ zona: 'z1_1', de_la: 'C', la: 'CT', lungime_m: 250, diametru_mm: 40, debit_mch: null, motiv: 'Nr lipsă sau ilizibil pe rând' }])
})

// ---- 26.09.2026 — runda 4 (verificator runda 3, MAJOR): Dn cu TOATE rândurile „de verificat” la transfer ----
// Înainte (a800d38): `peDiametru` avea doar rândurile sigure => poziția Dn-ului nesigur păstra TĂCUT cantitate_plansa și nota
// unei citiri anterioare; fără niciun rând sigur, early-return => nimic scris. Acum: notă pe poziție (validată/diferenta) sau
// golire + „diferenta” (dacă e „extras”); TOTAL nu devine 0.
const aiFelii = (n: { ai: number }, felii: Record<string, any>) => (async (_u: unknown, init?: RequestInit) => {
  n.ai++
  const et = /Bucata (\S+)/.exec(JSON.parse(String(init?.body || '{}')).messages?.[0]?.content?.find((c: any) => c.type === 'text')?.text || '')?.[1] || '?'
  return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ cartus: {}, ...(felii[et] || { tronsoane: [], tabele: [] }) }) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })
}) as typeof fetch
const COLT = ['Nr crt', 'De la', 'La', 'Dn', 'L (km)']
const rdT = (nr: string, dl: string, dn: string, L: string) => ({ 'Nr crt': nr, 'De la': dl, 'La': 'CT', 'Dn': dn, 'L (km)': L })
const trT = (dl: string, dn: number, L: number) => ({ de_la: dl, la: 'CT', lungime_m: L, diametru_mm: dn, material: 'PE100', sursa: 'tabel' })
async function lic3(randuri: any[]) {
  const Z = ['1_1', '2_1']
  const pl = { ...PLANSA, zone_asteptate: Z, acoperire_demonstrata: true }
  const { supa, n, tabele } = supaCu({ id: 130, licitatie_id: 3, nume_original: 'PL1.1.pdf', analiza: { plansa: pl } }, Z)
  for (const r of randuri) await tabele.from('ofertare_cantitati').insert({ licitatie_id: 3, um: 'm', ...r })
  n.inserts.length = 0
  return { supa, n, tabele }
}
Deno.test('runda 4 transfer: Dn cu toate rândurile de verificat -> nota pe poziția validată/diferenta (cifra veche numită), golire pe „extras”; fără cifră veche tăcută', async () => {
  const { supa, n, tabele } = await lic3([
    { id: 1, denumire: 'Țeavă PE100 SDR11 Dn250 — magistrală', cantitate: 23630, cantitate_plansa: 34465, status: 'diferenta', diferenta_nota: 'NOTA VECHE Dn250' },
    { id: 2, denumire: 'Țeavă PE100 SDR11 Dn180', cantitate: 1100, cantitate_plansa: 2210, status: 'extras', diferenta_nota: 'NOTA VECHE Dn180' },
    { id: 3, denumire: 'Țeavă PE100 SDR11 Dn160 — Coconi', cantitate: 5250, cantitate_plansa: 5245, status: 'validat', diferenta_nota: 'NOTA VECHE Dn160' },
    { id: 4, denumire: 'TOTAL rețea distribuție', cantitate: 37320, cantitate_plansa: 41920, status: 'validat', diferenta_nota: 'NOTA VECHE TOTAL' },
  ])
  // Dn250: Nr ilizibil pe ambele rânduri; Dn180: Nr lipsă => de verificat; Dn160: Nr 3 sigur
  const ai = aiFelii(n, { z1_1: { tronsoane: [trT('A', 250, 4800), trT('B', 250, 5550), trT('C', 160, 1740), trT('D', 180, 600)],
    tabele: [{ denumire: 'Dimensionare', coloane: COLT, randuri: [rdT('?', 'A', '250', '4,8'), rdT('', 'B', '250', '5,55'), rdT('3', 'C', '160', '1,74'), rdT('', 'D', '180', '0,6')] }] } })
  const r = await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(n, ai, supa))
  assertEquals(r.status, 200)
  const j = await r.json()
  assertEquals([j.sumar.total_sigur_m, j.sumar.total_de_verificat_m, j.sumar.randuri_fara_identitate_n], [1740, 10950, 3])
  assertEquals(j.cantitati.pe_diametre, { 'Dn160 PE': 1740 })
  assertEquals(n.inserts.filter((t: string) => t === 'ofertare_cantitati').length, 0, 'rândurile nesigure nu creează poziții')
  const rows = (await tabele.from('ofertare_cantitati').select()).data
  const id = (k: number) => rows.find((x: any) => x.id === k)
  const pe = ' Pe planșă: 3 rânduri de tabel fără identitate sigură (10.950 m).'
  // id 1 (status „diferenta”, pus de o citire anterioară): cifra veche rămâne, dar nota o NUMEȘTE ca veche (a800d38: „NOTA VECHE Dn250”)
  assertEquals([id(1).cantitate, id(1).cantitate_plansa, id(1).status], [23630, 34465, 'diferenta'])
  assertEquals(id(1).diferenta_nota, 'De verificat: 2 rânduri Dn250 PE fără identitate sigură (10.350 m); cifra din planșă nu s-a actualizat (34.465 m e dintr-o citire anterioară).' + pe)
  // id 2 („extras”, nevalidată): cifra veche din planșă se golește, status „diferenta”
  assertEquals([id(2).cantitate, id(2).cantitate_plansa, id(2).status], [1100, null, 'diferenta'])
  assertEquals(id(2).diferenta_nota, 'De verificat: 1 rând Dn180 PE fără identitate sigură (600 m); cifra din planșă s-a golit (era 2.210 m, dintr-o citire anterioară).' + pe)
  // id 3 (sigur) și TOTAL: doar partea sigură, restul numit.
  // R5 runda 4 (verificator R3, MAJOR): ambele erau VALIDATE pe altă cifră din planșă (5.245 / 41.920) — citirea automată le
  // schimbă cantitate_plansa (1.740), deci ies din „validat” („diferenta”) și nota spune pe ce cifră fusese dată validarea.
  // Înainte: rămâneau „validat” cu o cifră pe care n-o verificase nimeni (cazul real lic. 3 din 15.09).
  assertEquals([id(3).cantitate_plansa, id(3).status], [1740, 'diferenta'])
  assert(id(3).diferenta_nota.startsWith('Rândul era VALIDAT cu cifra din planșă 5.245 m; planșa „pl1.1.pdf” dă acum 1.740 m — validarea se reface. '), id(3).diferenta_nota)
  assertEquals([id(4).cantitate_plansa, id(4).status], [1740, 'diferenta'])
  assert(id(4).diferenta_nota.startsWith('Rândul era VALIDAT cu cifra din planșă 41.920 m; planșa „pl1.1.pdf” dă acum 1.740 m — validarea se reface. '), id(4).diferenta_nota)
  assert(id(4).diferenta_nota.endsWith('De verificat, NEincluse în cifra din planșă: pe planșă: 3 rânduri de tabel fără identitate sigură (10.950 m).'), id(4).diferenta_nota)
  assertEquals(j.cantitati.doar_de_verificat, [{ dn: 250, material: 'PE', pozitie_id: 1, actiune: 'nota' }, { dn: 180, material: 'PE', pozitie_id: 2, actiune: 'golit' }])
})
Deno.test('runda 4 transfer: NICIUN rând sigur pe planșă -> fără early-return: pozițiile și TOTAL primesc nota / golirea, TOTAL nu devine 0', async () => {
  const { supa, n, tabele } = await lic3([
    { id: 1, denumire: 'Țeavă PE100 SDR11 Dn250', cantitate: 23630, cantitate_plansa: 34465, status: 'extras', diferenta_nota: 'NOTA VECHE Dn250' },
    { id: 4, denumire: 'TOTAL rețea distribuție', cantitate: 23630, cantitate_plansa: 34465, status: 'validat', diferenta_nota: 'NOTA VECHE TOTAL' },
  ])
  // același Nr 1 citit cu L diferit în două benzi (conflict) + un rând cu Nr ilizibil => nimic sigur
  const ai = aiFelii(n, {
    z1_1: { tronsoane: [trT('A', 250, 4800), trT('B', 250, 5550)], tabele: [{ denumire: 'Dimensionare', coloane: COLT, randuri: [rdT('1', 'A', '250', '4,8'), rdT('?', 'B', '250', '5,55')] }] },
    z2_1: { tronsoane: [trT('A', 250, 4900)], tabele: [{ denumire: 'Dimensionare', coloane: COLT, randuri: [rdT('1', 'A', '250', '4,9')] }] },
  })
  const r = await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(n, ai, supa))
  assertEquals(r.status, 200)
  const j = await r.json()
  assertEquals([j.sumar.total_sigur_m, j.sumar.total_de_verificat_m, j.sumar.conflicte.length, j.sumar.lungime_totala_m], [0, 10450, 1, 0])
  const rows = (await tabele.from('ofertare_cantitati').select()).data
  const id = (k: number) => rows.find((x: any) => x.id === k)
  const pe = ' Pe planșă: 1 rând de tabel fără identitate sigură (5.550 m); 1 conflict (același rând citit diferit: Nr 1 4.800 m Dn250 / 4.900 m Dn250).'
  assertEquals([id(1).cantitate, id(1).cantitate_plansa, id(1).status], [23630, null, 'diferenta'])
  assertEquals(id(1).diferenta_nota, 'De verificat: 1 rând Dn250 PE fără identitate sigură (5.550 m); 1 conflict Dn250 PE (până la 4.900 m); cifra din planșă s-a golit (era 34.465 m, dintr-o citire anterioară).' + pe)
  // TOTAL validat: nu primește 0 m; cifra veche e numită ca veche
  assertEquals([id(4).cantitate_plansa, id(4).status], [34465, 'validat'])
  assertEquals(id(4).diferenta_nota, 'De verificat: nicio lungime sigură cu Dn standard pe planșa „pl1.1.pdf”; cifra din planșă nu s-a actualizat (34.465 m e dintr-o citire anterioară).' + pe)
  assertEquals(j.cantitati.doar_de_verificat, [{ dn: 250, material: 'PE', pozitie_id: 1, actiune: 'golit' }])
  assertEquals(n.rpc, 1, 'transferul rulează (a800d38: early-return, 0 scrieri, nota veche rămânea)')
})

// ---- 26.09.2026 — runda 5 (verificator runda 4): regresie prin handler + RPC simulat. Fiecare pică pe a9fe186. ----
async function transfer470(mut: (et: string, r: any) => any) {
  const { raspuns470, AZI_470 } = await import('./fixture_470.ts')
  const Z = ['1_6', '1_7', '2_6', '2_7', '3_6', '3_7', '4_6', '4_7']
  const pl = { ...PLANSA, zone_asteptate: Z, acoperire_demonstrata: true }
  const { supa, n, tabele } = supaCu({ id: 470, licitatie_id: 95, nume_original: 'Schema.pdf', analiza: { plansa: pl } }, Z)
  const ids: Record<string, number> = { Dn200: 1751, Dn125: 1752, Dn110: 1753, Dn90: 1754, Dn63: 1755, Dn40: 1756 }
  for (const [dn, id] of Object.entries(ids)) await tabele.from('ofertare_cantitati').insert({ id, licitatie_id: 95, denumire: `Conductă distribuție gaze ${dn}`, um: 'm',
    cantitate: AZI_470[dn], cantitate_plansa: AZI_470[dn], status: 'extras', extras_de_ai: true, sursa: 'Planșa 1 — tabel', diferenta_nota: 'veche' })
  const ai = (async (_u: unknown, init?: RequestInit) => {
    n.ai++
    const et = /Bucata (\S+)/.exec(JSON.parse(String(init?.body || '{}')).messages?.[0]?.content?.find((c: any) => c.type === 'text')?.text || '')?.[1] || '?'
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(mut(et, structuredClone(raspuns470(et)))) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })
  }) as typeof fetch
  let j: any = null
  for (let runde = 0; runde < 4; runde++) {
    const r = await handler(cerereSvc(runde === 0 ? { doc_id: 470, de_la: 0 } : { doc_id: 470, mod: 'continua' }), svc(n, ai, supa))
    assertEquals(r.status, 200)
    j = await r.json(); if (!j.continua) break
  }
  const rows = (await tabele.from('ofertare_cantitati').select()).data
  return { j, id: (k: number) => rows.find((x: any) => x.id === k), doc: await citesteDoc(tabele) }
}
Deno.test('runda 5 BLOCANT E2E (470, V4): z1_7 cu antete transcrise altfel -> fără umflare tăcută în cantitate_plansa (a9fe186: Dn40 14.720, Dn110 1.000, „diferență” falsă)', async () => {
  const ren: Record<string, string> = { 'Strada': 'Denumire strada', 'Str. De la': 'De la strada', 'Str. Pana la': 'Pana la strada' }
  const { j, id } = await transfer470((et, r) => {
    if (et !== 'z1_7') return r
    r.tabele[0].coloane = r.tabele[0].coloane.map((c: string) => ren[c] || c)
    r.tabele[0].randuri = r.tabele[0].randuri.map((rw: any) => Object.fromEntries(Object.entries(rw).map(([k, v]) => [ren[k] || k, v])))
    return r
  })
  assertEquals([j.sumar.total_sigur_m, j.sumar.total_de_verificat_m, j.sumar.randuri_fara_identitate_n], [24235, 25870, 37], 'a9fe186: 50.105 / 0 / 0')
  assertEquals(j.sumar.identitate_randuri.prin_pozitie, 0)
  // Dn40: doar partea sigură (benzile 2–4), „diferenta”, iar nota numește rândurile de verificat — nu +1.580 m „față de memoriu”
  assertEquals([id(1756).cantitate, id(1756).cantitate_plansa, id(1756).status], [13140, 10440, 'diferenta'])
  assert(id(1756).diferenta_nota.includes('De verificat, NEincluse în cifra din planșă: 13 rânduri Dn40 fără identitate sigură'), id(1756).diferenta_nota)
  assertEquals(id(1753).cantitate_plansa, 450, 'a9fe186: 1.000 (Dn110 umflat cu 220 m)')
  // Dn200: toate cele 8 rânduri sunt în z1_7 => nicio cifră sigură: poziția „extras” se golește, cu notă
  assertEquals([id(1751).cantitate_plansa, id(1751).status], [null, 'diferenta'])
  assert(id(1751).diferenta_nota.startsWith('De verificat: 8 rânduri Dn200 fără identitate sigură (17.785 m); cifra din planșă s-a golit (era 17.785 m'), id(1751).diferenta_nota)
  assertEquals(j.cantitati.doar_de_verificat, [{ dn: 200, material: null, pozitie_id: 1751, actiune: 'golit' }])
})
Deno.test('runda 5 (minor): rânduri în afara suprapunerii -> sumar.perechi_neimperecheate + avertisment (a9fe186: doar în idr, invizibil)', async () => {
  // Nr 38 transcris în plus la baza lui z1_7 (z1_6 îl are tăiat): perechea z1_6+z1_7 are 37 / 38 de rânduri
  const { raspuns470 } = await import('./fixture_470.ts')
  const z26 = raspuns470('z2_6'), z27 = raspuns470('z2_7')
  const k = z26.tabele[0].randuri.findIndex((x: any) => x['Nr crt'] === '38')
  const { j } = await transfer470((et, r) => {
    if (et === 'z1_7') { r.tabele[0].randuri.push(structuredClone(z27.tabele[0].randuri[k])); r.tronsoane.push(structuredClone(z27.tronsoane[k])) }
    return r
  })
  assertEquals([j.sumar.total_sigur_m, j.sumar.randuri_fara_identitate_n], [48905, 1])
  assertEquals(j.sumar.perechi_neimperecheate, [{ a: 'z1_6', b: 'z1_7', delta: 0, prin: 'câmp comun + ordine', randuri: [37, 38], neimperecheate: [0, 1] }])
  assertEquals(j.sumar.perechi_neimperecheate_n, 1)
  assert(j.sumar.avertismente.includes('1 pereche de felii vecine cu rânduri în afara suprapunerii (z1_6+z1_7: 0/1) — rândurile acelea nu s-au legat între felii ' +
    '(margine tăiată sau rând omis la citire); vezi „de verificat” și „Nr fără lungime”'), j.sumar.avertismente.join(' | '))
})
Deno.test('runda 5 MAJOR transfer: Dn110 PE sigur + Dn110 OL doar de verificat, poziții separate PE / OL -> poziția OL golită cu notă (a9fe186: 900 m „extras”, „VECHE OL”)', async () => {
  const { supa, n, tabele } = await lic3([
    { id: 11, denumire: 'Țeavă PE100 Dn110', cantitate: 500, cantitate_plansa: 500, status: 'extras', diferenta_nota: 'VECHE PE' },
    { id: 12, denumire: 'Țeavă OL Dn110 subtraversare', cantitate: 80, cantitate_plansa: 900, status: 'extras', diferenta_nota: 'VECHE OL' },
  ])
  const COLM = ['Nr crt', 'De la', 'La', 'Dn', 'Material', 'L (km)']
  const rd = (nr: string, dl: string, mat: string, L: string) => ({ 'Nr crt': nr, 'De la': dl, 'La': 'CT', 'Dn': '110', 'Material': mat, 'L (km)': L })
  const tr = (dl: string, mat: string, L: number) => ({ de_la: dl, la: 'CT', lungime_m: L, diametru_mm: 110, material: mat, sursa: 'tabel' })
  const ai = aiFelii(n, { z1_1: { tronsoane: [tr('A', 'PE100', 500), tr('B', 'OL', 90)], tabele: [{ denumire: 'D', coloane: COLM, randuri: [rd('1', 'A', 'PE100', '0,5'), rd('?', 'B', 'OL', '0,09')] }] } })
  const r = await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(n, ai, supa))
  assertEquals(r.status, 200)
  const j = await r.json()
  assertEquals(j.cantitati.pe_diametre, { 'Dn110 PE': 500 })
  assertEquals(j.cantitati.doar_de_verificat, [{ dn: 110, material: 'OL', pozitie_id: 12, actiune: 'golit' }], 'a9fe186: lipsă (Dn110 „acoperit” de PE)')
  const rows = (await tabele.from('ofertare_cantitati').select()).data
  const id = (k: number) => rows.find((x: any) => x.id === k)
  const pe = ' Pe planșă: 1 rând de tabel fără identitate sigură (90 m).'
  assertEquals([id(12).cantitate, id(12).cantitate_plansa, id(12).status], [80, null, 'diferenta'])
  assertEquals(id(12).diferenta_nota, 'De verificat: 1 rând Dn110 OL fără identitate sigură (90 m); cifra din planșă s-a golit (era 900 m, dintr-o citire anterioară).' + pe)
  // poziția PE: cifra sigură, fără rândul OL în nota ei pe Dn (doar pe planșă)
  assertEquals([id(11).cantitate_plansa, id(11).status], [500, 'extras'])
  assertEquals(id(11).diferenta_nota, 'Planșa „PL1.1.pdf” confirmă: 500 m. De verificat, NEincluse în cifra din planșă: pe planșă: 1 rând de tabel fără identitate sigură (90 m).')
})
Deno.test('runda 5 MAJOR transfer: o singură poziție Dn110 (fără material) + Dn110 PE sigur + Dn110 OL de verificat -> cifra PE + nota OL + „diferenta”', async () => {
  // memoriul = 500 (egal cu partea sigură PE): „diferenta” vine DOAR din rândul OL de verificat de pe aceeași poziție
  const { supa, n, tabele } = await lic3([{ id: 21, denumire: 'Conductă Dn110', cantitate: 500, cantitate_plansa: 590, status: 'extras', diferenta_nota: 'VECHE' }])
  const COLM = ['Nr crt', 'De la', 'La', 'Dn', 'Material', 'L (km)']
  const rd = (nr: string, dl: string, mat: string, L: string) => ({ 'Nr crt': nr, 'De la': dl, 'La': 'CT', 'Dn': '110', 'Material': mat, 'L (km)': L })
  const tr = (dl: string, mat: string, L: number) => ({ de_la: dl, la: 'CT', lungime_m: L, diametru_mm: 110, material: mat, sursa: 'tabel' })
  const ai = aiFelii(n, { z1_1: { tronsoane: [tr('A', 'PE100', 500), tr('B', 'OL', 90)], tabele: [{ denumire: 'D', coloane: COLM, randuri: [rd('1', 'A', 'PE100', '0,5'), rd('?', 'B', 'OL', '0,09')] }] } })
  const j = await (await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(n, ai, supa))).json()
  assertEquals(j.cantitati.doar_de_verificat, [{ dn: 110, material: 'OL', pozitie_id: 21, actiune: 'nota' }])
  const x = (await tabele.from('ofertare_cantitati').select()).data.find((y: any) => y.id === 21)
  assertEquals([x.cantitate_plansa, x.status], [500, 'diferenta'])
  assertEquals(x.diferenta_nota, 'Planșa „PL1.1.pdf” confirmă: 500 m. De verificat, NEincluse în cifra din planșă: pe planșă: 1 rând de tabel fără identitate sigură (90 m).' +
    ' De verificat (Dn110 OL, fără nicio cifră sigură): 1 rând Dn110 OL fără identitate sigură (90 m).')
})
Deno.test('runda 5 (minor) transfer: TOTAL „extras” cu rest de verificat pe planșă -> „diferenta” (a9fe186: rămânea „extras” cu cifra parțială)', async () => {
  const { supa, n, tabele } = await lic3([
    { id: 3, denumire: 'Țeavă PE100 SDR11 Dn160', cantitate: 1740, cantitate_plansa: 1740, status: 'validat', diferenta_nota: 'VECHE Dn160' },
    { id: 4, denumire: 'TOTAL rețea distribuție', cantitate: 2340, cantitate_plansa: 2340, status: 'extras', diferenta_nota: 'VECHE TOTAL' },
  ])
  const ai = aiFelii(n, { z1_1: { tronsoane: [trT('C', 160, 1740), trT('D', 180, 600)],
    tabele: [{ denumire: 'Dimensionare', coloane: COLT, randuri: [rdT('3', 'C', '160', '1,74'), rdT('', 'D', '180', '0,6')] }] } })
  const j = await (await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(n, ai, supa))).json()
  assertEquals([j.sumar.total_sigur_m, j.sumar.total_de_verificat_m], [1740, 600])
  const rows = (await tabele.from('ofertare_cantitati').select()).data
  const t = rows.find((y: any) => y.id === 4)
  assertEquals([t.cantitate, t.cantitate_plansa, t.status], [2340, 1740, 'diferenta'], 'a9fe186: 1.740 „extras”')
  assertEquals(t.diferenta_nota, 'Memoriu 2.340 m vs planșa „pl1.1.pdf” 1.740 m. De verificat, NEincluse în cifra din planșă: pe planșă: 1 rând de tabel fără identitate sigură (600 m).')
  // Dn160 validat: cifra sigură, decizia omului rămâne
  assertEquals([rows.find((y: any) => y.id === 3).cantitate_plansa, rows.find((y: any) => y.id === 3).status], [1740, 'validat'])
})
Deno.test('runda 5 transfer: grup sigur ambiguu (două poziții Dn110 PE) -> nimic scris, iar `ambigue` numește și restul de verificat de pe (Dn, material)', async () => {
  const { supa, n, tabele } = await lic3([
    { id: 31, denumire: 'Țeavă PE100 Dn110 — sat A', cantitate: 300, cantitate_plansa: 300, status: 'extras', diferenta_nota: 'VECHE A' },
    { id: 32, denumire: 'Țeavă PE100 Dn110 — sat B', cantitate: 200, cantitate_plansa: 200, status: 'extras', diferenta_nota: 'VECHE B' },
  ])
  const ai = aiFelii(n, { z1_1: { tronsoane: [trT('A', 110, 500), trT('B', 110, 90)], tabele: [{ denumire: 'D', coloane: COLT, randuri: [rdT('1', 'A', '110', '0,5'), rdT('?', 'B', '110', '0,09')] }] } })
  const j = await (await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(n, ai, supa))).json()
  assertEquals(j.cantitati.ambigue, [{ dn: 110, material: 'PE', metri: 500, de_verificat: '1 rând Dn110 PE fără identitate sigură (90 m)',
    pozitii: [{ id: 31, denumire: 'Țeavă PE100 Dn110 — sat A' }, { id: 32, denumire: 'Țeavă PE100 Dn110 — sat B' }] }])
  const rows = (await tabele.from('ofertare_cantitati').select()).data
  assertEquals(rows.map((x: any) => [x.id, x.cantitate_plansa, x.status, x.diferenta_nota]), [[31, 300, 'extras', 'VECHE A'], [32, 200, 'extras', 'VECHE B']])
})

// ---- 26.09.2026 — runda 6 (verificator runda 5): regresie prin handler + RPC simulat. Fiecare pică pe f1274a1. ----
// MAJOR 1 (GEOM-E2E): coloana fixată a tăietorului (W = 7.140: z1_5 = z1_6 = [5.540, 7.140]) acoperă și z1_4 (|Δc| = 2). Tabelul cu
// Nr e în z1_4, z1_5 nu transcrie nimic, z1_6 vede fâșia Dn + L. Pe f1274a1 fâșia primea „poz z1_6…” și se număra a doua oară.
Deno.test('runda 6 MAJOR E2E (GEOM): fâșia din coloana fixată NU mai ajunge a doua oară în cantitate_plansa (f1274a1: Dn63 1.100, Dn40 400, „diferență” falsă)', async () => {
  const Rg = [['1', 'Florilor', '63', 300], ['2', 'Salcamilor', '63', 250], ['3', 'Viilor', '40', 200]] as const
  const CX = ['Nr crt', 'Strada', 'Dn (mm)', 'Lungime (m)']
  const felii: Record<string, any> = {
    z1_4: { cartus: { plansa_nr: '7' }, tabele: [{ denumire: 'Dimensionare', coloane: CX, randuri: Rg.map(([nr, st, dn, L]) => ({ 'Nr crt': nr, 'Strada': st, 'Dn (mm)': dn, 'Lungime (m)': String(L) })) }],
      tronsoane: Rg.map(([, st, dn, L]) => ({ de_la: st, lungime_m: L, diametru_mm: Number(dn), sursa: 'tabel' })) },
    z1_6: { tabele: [{ denumire: 'fragment', coloane: ['Dn (mm)', 'Lungime (m)'], randuri: Rg.map(([, , dn, L]) => ({ 'Dn (mm)': dn, 'Lungime (m)': String(L) })) }],
      tronsoane: Rg.map(([, , dn, L]) => ({ lungime_m: L, diametru_mm: Number(dn), sursa: 'tabel' })) },
  }
  const Z = ['1_4', '1_5', '1_6']
  const pl = { ...PLANSA, zone_asteptate: Z, acoperire_demonstrata: true,
    zone_geom: { '1_4': [4224, 0, 1600, 1600, 0], '1_5': [5540, 0, 1600, 1600, 0], '1_6': [5540, 0, 1600, 1600, 0] }, surse_geom: [{ pagina: 1 }] }
  const { supa, n, tabele } = supaCu({ id: 777, licitatie_id: 50, nume_original: 'PL7.pdf', analiza: { plansa: pl } }, Z)
  await tabele.from('ofertare_cantitati').insert({ id: 63, licitatie_id: 50, um: 'm', denumire: 'Conductă PE100 Dn63', cantitate: 550, cantitate_plansa: null, status: 'extras' })
  await tabele.from('ofertare_cantitati').insert({ id: 40, licitatie_id: 50, um: 'm', denumire: 'Conductă PE100 Dn40', cantitate: 200, cantitate_plansa: null, status: 'extras' })
  const j = await (await handler(cerereSvc({ doc_id: 777, de_la: 0 }), svc(n, aiFelii(n, felii), supa))).json()
  assertEquals([j.sumar.total_sigur_m, j.sumar.total_de_verificat_m, j.sumar.identitate_randuri.prin_nr, j.sumar.identitate_randuri.prin_pozitie], [750, 0, 3, 0],
    'f1274a1: 1.500 m sigur, 3 prin poziție, 0 de verificat')
  assertEquals(j.cantitati.pe_diametre, { Dn63: 550, Dn40: 200 })
  const rows = (await tabele.from('ofertare_cantitati').select()).data
  assertEquals(rows.map((x: any) => [x.id, x.cantitate_plansa, x.status, x.diferenta_nota]),
    [[63, 550, 'extras', 'Planșa 7 confirmă: 550 m.'], [40, 200, 'extras', 'Planșa 7 confirmă: 200 m.']], 'f1274a1: 1.100 / 400, „Memoriu 550 m vs planșa 7 1.100 m (+550 m…)”')
})

// MAJOR 2 (pre-existent din 8a6fbbb): două grupuri SIGURE pe același Dn, materiale diferite, care nimeresc aceeași poziție unică.
// Pe f1274a1: două update-uri pe același id, RPC-ul le aplică în ordine => ultimul câștigă (PE 500 + OL 90 => 90, nota „-500 m”).
// Acum: ambiguu — cantitate_plansa neatinsă, nota numește toate grupurile, „extras” => „diferenta”; același rezultat în orice ordine.
async function coliziune(pozitii: any[], randuriT: [string, string, string, string][], invers: boolean) {
  const { supa, n, tabele } = await lic3(pozitii)
  const COLM = ['Nr crt', 'De la', 'La', 'Dn', 'Material', 'L (km)']
  let xs = randuriT.map(([nr, dl, mat, L]) => ({ rd: { 'Nr crt': nr, 'De la': dl, 'La': 'CT', 'Dn': '110', 'Material': mat, 'L (km)': L },
    tr: { de_la: dl, la: 'CT', lungime_m: Math.round(numarKm(L) * 1000), diametru_mm: 110, ...(mat ? { material: mat } : {}), sursa: 'tabel' } }))
  if (invers) xs = xs.reverse()
  const ai = aiFelii(n, { z1_1: { tronsoane: xs.map((x) => x.tr), tabele: [{ denumire: 'D', coloane: COLM, randuri: xs.map((x) => x.rd) }] } })
  const r = await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(n, ai, supa))
  assertEquals(r.status, 200)
  const j = await r.json()
  return { j, rows: (await tabele.from('ofertare_cantitati').select()).data.map((x: any) => ({ ...x })), n }
}
const numarKm = (s: string) => Number(s.replace(',', '.'))
Deno.test('runda 6 MAJOR transfer: Dn110 PE 500 + Dn110 OL 90 SIGURE pe o singură poziție => ambiguu, nimic suprascris (f1274a1: 90, „-500 m”); ordine normală = inversată', async () => {
  // cifra veche din planșă (700 m) ≠ suma grupurilor (590 m): nu se atinge, e numită veche
  const poz = [{ id: 21, denumire: 'Conductă distribuție gaze Dn110', cantitate: 590, cantitate_plansa: 700, status: 'extras', diferenta_nota: 'VECHE' }]
  const rd: [string, string, string, string][] = [['1', 'A', 'PE100', '0,5'], ['2', 'B', 'OL', '0,09']]
  const a = await coliziune(poz, rd, false), b = await coliziune(poz, rd, true)
  const nota = 'De verificat: Planșa „PL1.1.pdf” dă 2 grupuri sigure pe aceeași poziție — Dn110 OL 90 m (1 rând); Dn110 PE 500 m (1 rând); ' +
    'împreună 590 m, dar nu se adună și nu se suprascriu automat (denumirea poziției nu le deosebește); cifra din planșă nu s-a actualizat (700 m e dintr-o citire anterioară).'
  for (const x of [a, b]) {
    assertEquals(x.rows.map((y: any) => [y.id, y.cantitate, y.cantitate_plansa, y.status, y.diferenta_nota]), [[21, 590, 700, 'diferenta', nota]])
    assertEquals(x.j.cantitati.ambigue, [{ dn: 110, material: null, metri: 590, motiv: 'mai multe grupuri sigure (Dn, material) pe aceeași poziție — cantitate_plansa neatinsă',
      grupuri: [{ dn: 110, material: 'OL', metri: 90, randuri: 1 }, { dn: 110, material: 'PE', metri: 500, randuri: 1 }], pozitii: [{ id: 21, denumire: 'Conductă distribuție gaze Dn110' }] }])
    assertEquals(x.j.cantitati.pe_diametre, { 'Dn110 PE': 500, 'Dn110 OL': 90 })
    assertEquals(x.n.inserts.filter((t: string) => t === 'ofertare_cantitati').length, 0)
  }
  assertEquals(a.rows, b.rows, 'aceeași stare în BD indiferent de ordinea rândurilor')
})
Deno.test('runda 6 MAJOR transfer: Dn110 PE 500 + Dn110 fără material 300 SIGURE pe „Țeavă PE100 Dn110” => ambiguu (f1274a1: 300, cei 500 m PE dispar); validat rămâne validat', async () => {
  const rd: [string, string, string, string][] = [['1', 'A', 'PE100', '0,5'], ['2', 'B', '', '0,3'], ['?', 'C', 'PE100', '0,04']]
  const nota = (cp: string) => 'De verificat: Planșa „PL1.1.pdf” dă 2 grupuri sigure pe aceeași poziție — Dn110 PE 500 m (1 rând); Dn110 fără material 300 m (1 rând); ' +
    `împreună 800 m, dar nu se adună și nu se suprascriu automat (denumirea poziției nu le deosebește); cifra din planșă nu s-a actualizat (${cp} m e dintr-o citire anterioară).` +
    ' De verificat, NEincluse în cifra din planșă: 1 rând Dn110 PE fără identitate sigură (40 m); pe planșă: 1 rând de tabel fără identitate sigură (40 m).'
  // „extras” => „diferenta”, cifra veche rămâne (numită veche); ordine normală și inversată
  const poz = [{ id: 21, denumire: 'Țeavă PE100 Dn110', cantitate: 800, cantitate_plansa: 800, status: 'extras', diferenta_nota: 'VECHE' }]
  const a = await coliziune(poz, rd, false), b = await coliziune(poz, rd, true)
  for (const x of [a, b]) {
    assertEquals(x.rows.map((y: any) => [y.id, y.cantitate_plansa, y.status, y.diferenta_nota]), [[21, 800, 'diferenta', nota('800')]])
    assertEquals(x.j.cantitati.ambigue[0].grupuri, [{ dn: 110, material: 'PE', metri: 500, randuri: 1 }, { dn: 110, material: null, metri: 300, randuri: 1 }])
    assertEquals(x.j.cantitati.ambigue[0].de_verificat, '1 rând Dn110 PE fără identitate sigură (40 m)')
  }
  assertEquals(a.rows, b.rows)
  // poziție validată: decizia omului rămâne (status, cifră), doar nota
  const v = await coliziune([{ ...poz[0], cantitate_plansa: 780, status: 'validat' }], rd, true)
  assertEquals(v.rows.map((y: any) => [y.id, y.cantitate_plansa, y.status, y.diferenta_nota]), [[21, 780, 'validat', nota('780')]])
})
Deno.test('runda 6 transfer (control, trece și pe f1274a1): grupuri pe materiale diferite cu poziții SEPARATE => fiecare își primește cifra, nimic ambiguu', async () => {
  const poz = [{ id: 11, denumire: 'Țeavă PE100 Dn110', cantitate: 500, cantitate_plansa: null, status: 'extras' }, { id: 12, denumire: 'Țeavă OL Dn110', cantitate: 90, cantitate_plansa: null, status: 'extras' }]
  const x = await coliziune(poz, [['1', 'A', 'PE100', '0,5'], ['2', 'B', 'OL', '0,09']], false)
  assertEquals(x.rows.map((y: any) => [y.id, y.cantitate_plansa, y.status]), [[11, 500, 'extras'], [12, 90, 'extras']])
  assertEquals(x.j.cantitati.ambigue, [])
})

// ---- 26.09.2026 — runda 7: regresie prin handler + RPC simulat (raportul salvat și transferul, nu doar funcția pură) ----
Deno.test('COPILOT-REG-2 (E2E): rândul văzut în două benzi e UNUL în citire_ai.tronsoane_unice, cu observațiile-sursă păstrate (_observatii + _surse)', async () => {
  const { j, doc } = await transfer470((_et, r) => r)
  assertEquals([j.sumar.total_sigur_m, j.sumar.identitate_randuri.randuri_sigure], [48905, 133])
  const t37 = doc.analiza.citire_ai.tronsoane_unice.filter((t: any) => t._nr === '37')
  assertEquals(t37.length, 1)
  assertEquals(t37[0]._observatii, ['z1_7', 'z2_7'])
  assertEquals(t37[0]._surse.map((x: any) => [x.zona, x.rand, x.lungime_m, x.nr_din]), [['z1_7', 37, 300, ['z1_6']], ['z2_7', 6, 300, ['z2_6']]])
  assert(doc.text_extras.includes('(Nr 37; văzut în z1_7, z2_7)'), 'text_extras arată și el sursele')
})
Deno.test('runda 7 B3 (E2E): 470 fără Nr 50 în ambele felii => sumar nr_lipsa + total_sigur_incomplet + avertisment; nota FIECĂREI poziții numește golul, „extras” => „diferenta”; text_extras ⚠ (ab5c449: 48.685 m tăcut, 5 poziții „confirmă”)', async () => {
  const { raspuns470 } = await import('./fixture_470.ts')
  const k = raspuns470('z2_6').tabele[0].randuri.findIndex((x: any) => x['Nr crt'] === '50')
  const { j, id, doc } = await transfer470((et, r) => {
    if (et === 'z2_6' || et === 'z2_7') { r.tabele[0].randuri.splice(k, 1); if (et === 'z2_7') r.tronsoane.splice(k, 1) }
    return r
  })
  assertEquals([j.sumar.total_sigur_m, j.sumar.total_de_verificat_m, j.sumar.total_sigur_incomplet, j.sumar.nr_lipsa_n], [48685, 0, true, 1])
  assertEquals(j.sumar.nr_lipsa.map((x: any) => [x.lipsesc, x.interval]), [['50', [1, 133]]])
  assert(j.sumar.avertismente.some((a: string) => a.startsWith('secvență Nr incompletă: lipsesc Nr 50 (p1, tabel cu Nr 1–133;')), j.sumar.avertismente.join(' | '))
  const gol = 'pe planșă: Dn nestandard Dn60: 110 m; secvență Nr incompletă: lipsesc Nr 50 (p1, tabel cu Nr 1–133; 1 rând fără nicio lectură, metri necunoscuți).'
  for (const k2 of [1751, 1752, 1753, 1754, 1755, 1756]) {
    assert(id(k2).diferenta_nota.endsWith(gol), `${k2}: ${id(k2).diferenta_nota}`)
    assertEquals(id(k2).status, 'diferenta', `${k2}: cifra din planșă e doar partea citită`)
  }
  assert(doc.text_extras.includes('⚠ SECVENȚĂ Nr INCOMPLETĂ: lipsesc Nr 50'), doc.text_extras.slice(-600))
})
Deno.test('runda 7 MY-T4: Dn110 PE sigur + Dn110 fără material „de verificat”, poziții PE și OL => nota și pe poziția OL, „extras” => „diferenta”, cifra ei nu se golește (ab5c449: OL 900 „extras”, nota veche)', async () => {
  const { supa, n, tabele } = await lic3([
    { id: 11, denumire: 'Țeavă PE100 Dn110', cantitate: 500, cantitate_plansa: 500, status: 'extras', diferenta_nota: 'VECHE PE' },
    { id: 12, denumire: 'Țeavă OL Dn110 subtraversare', cantitate: 80, cantitate_plansa: 900, status: 'extras', diferenta_nota: 'VECHE OL' },
  ])
  const COLM = ['Nr crt', 'De la', 'La', 'Dn', 'Material', 'L (km)']
  const rd = (nr: string, dl: string, mat: string, L: string) => ({ 'Nr crt': nr, 'De la': dl, 'La': 'CT', 'Dn': '110', 'Material': mat, 'L (km)': L })
  const tr = (dl: string, mat: string | undefined, L: number) => ({ de_la: dl, la: 'CT', lungime_m: L, diametru_mm: 110, ...(mat ? { material: mat } : {}), sursa: 'tabel' })
  const ai = aiFelii(n, { z1_1: { tronsoane: [tr('A', 'PE100', 500), tr('B', undefined, 90)], tabele: [{ denumire: 'D', coloane: COLM, randuri: [rd('1', 'A', 'PE100', '0,5'), rd('?', 'B', '', '0,09')] }] } })
  const j = await (await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(n, ai, supa))).json()
  assertEquals(j.cantitati.pe_diametre, { 'Dn110 PE': 500 })
  assertEquals(j.cantitati.doar_de_verificat, [{ dn: 110, material: null, pozitie_id: 12, actiune: 'nota_fara_material' }])
  const rows = (await tabele.from('ofertare_cantitati').select()).data
  const id = (k: number) => rows.find((x: any) => x.id === k)
  const pe = ' Pe planșă: 1 rând de tabel fără identitate sigură (90 m).'
  assertEquals([id(12).cantitate, id(12).cantitate_plansa, id(12).status], [80, 900, 'diferenta'])
  // runda 8: nota spune unde a ajuns grupul sigur (nu mai presupune „alt material” — vezi testul cu grupul sigur ambiguu)
  assertEquals(id(12).diferenta_nota, 'De verificat: 1 rând Dn110 fără identitate sigură (90 m) — fără material, pot fi ale acestei poziții (grupul sigur de pe Dn110 nu i-a fost ' +
    'atribuit: Dn110 PE 500 m e pe poziția „Țeavă PE100 Dn110”); cifra din planșă nu s-a actualizat (900 m e dintr-o citire anterioară).' + pe)
  // poziția PE: cifra sigură + restul fără material numit (ca înainte), „diferenta”
  assertEquals([id(11).cantitate_plansa, id(11).status], [500, 'diferenta'])
  assert(id(11).diferenta_nota.includes('1 rând Dn110 fără identitate sigură (90 m)'), id(11).diferenta_nota)
  // poziția OL deja validată: decizia rămâne, doar nota
  const v = await lic3([{ id: 11, denumire: 'Țeavă PE100 Dn110', cantitate: 500, cantitate_plansa: 500, status: 'extras' },
    { id: 12, denumire: 'Țeavă OL Dn110 subtraversare', cantitate: 80, cantitate_plansa: 900, status: 'validat', diferenta_nota: 'VECHE OL' }])
  await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(v.n, aiFelii(v.n, { z1_1: { tronsoane: [tr('A', 'PE100', 500), tr('B', undefined, 90)], tabele: [{ denumire: 'D', coloane: COLM, randuri: [rd('1', 'A', 'PE100', '0,5'), rd('?', 'B', '', '0,09')] }] } }), v.supa))
  const x12 = (await v.tabele.from('ofertare_cantitati').select()).data.find((x: any) => x.id === 12)
  assertEquals([x12.cantitate_plansa, x12.status], [900, 'validat'])
  assert(x12.diferenta_nota.startsWith('De verificat: 1 rând Dn110 fără identitate sigură (90 m) — fără material'), x12.diferenta_nota)
})
Deno.test('runda 7→8: rândul TOTAL = „total” FĂRĂ Dn în denumire; „total” cu Dn = candidat pe Dn-ul lui (subtotal sau poziție „… lungime totală”); un singur update pe id, independent de ordine', async () => {
  const COLM = ['Nr crt', 'De la', 'La', 'Dn', 'Material', 'L (km)']
  const felii = { z1_1: { tronsoane: [{ de_la: 'A', la: 'CT', lungime_m: 500, diametru_mm: 110, material: 'PE100', sursa: 'tabel' }],
    tabele: [{ denumire: 'D', coloane: COLM, randuri: [{ 'Nr crt': '1', 'De la': 'A', 'La': 'CT', 'Dn': '110', 'Material': 'PE100', 'L (km)': '0,5' }] }] } }
  const ruleaza = async (pozitii: any[]) => {
    const x = await lic3(pozitii)
    const opsVazute: any[] = [], rpc0 = x.supa.rpc
    x.supa.rpc = (nume: string, a: any) => { if (nume === 'ofertare_transfer_plansa_cantitati') opsVazute.push(...a.p_randuri); return rpc0(nume, a) }
    const j = await (await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(x.n, aiFelii(x.n, felii), x.supa))).json()
    const upd = opsVazute.filter((o) => o.op === 'update').map((o) => o.id)
    assertEquals(upd.length, new Set(upd).size, `un singur update pe id: ${JSON.stringify(upd)}`)
    const rows = (await x.tabele.from('ofertare_cantitati').select()).data
    return { j, ops: opsVazute.map((o) => [o.op, o.id ?? o.row?.denumire, o.patch?.cantitate_plansa ?? o.row?.cantitate_plansa]).sort((a, b) => String(a[1]).localeCompare(String(b[1]))), id: (k: number) => rows.find((r: any) => r.id === k) }
  }
  // (a) singurul rând cu Dn110 e „Total conducte De 110” (subtotal pe Dn): primește cifra Dn110; nicio poziție nouă, niciun TOTAL
  //     (e8489a6: TOTAL + Dn110 inserat ca poziție nouă => oferta avea subtotalul ȘI o poziție nouă cu aceiași 500 m)
  const a = await ruleaza([{ id: 4, denumire: 'Total conducte De 110', cantitate: 500, cantitate_plansa: null, status: 'extras' }])
  assertEquals([a.id(4).cantitate_plansa, a.id(4).diferenta_nota, a.j.cantitati.adaugate], [500, 'Planșa „PL1.1.pdf” confirmă: 500 m.', 0])
  // (b) poziția reală „Conductă PE Dn110” + subtotalul „Total conducte De 110”: grupul PE merge (filtrul pe material) la poziția PE;
  //     subtotalul NU rămâne tăcut cu cifra veche — notă cu unde a ajuns grupul, „extras” => „diferenta”, cifra neatinsă
  const b = await ruleaza([{ id: 3, denumire: 'Conductă PE Dn110', cantitate: 500, cantitate_plansa: null, status: 'extras' },
    { id: 4, denumire: 'Total conducte De 110', cantitate: 500, cantitate_plansa: 700, status: 'extras' }])
  assertEquals([b.id(3).cantitate_plansa, b.id(4).cantitate_plansa, b.id(4).status, b.j.cantitati.ambigue], [500, 700, 'diferenta', []])
  assertEquals(b.id(4).diferenta_nota, 'De verificat: rând de total cu Dn în denumire (subtotal pe Dn sau poziție), neatribuit — grupurile sigure de pe Dn-ul lui ' +
    '(Planșa „PL1.1.pdf”): Dn110 PE 500 m e pe poziția „Conductă PE Dn110”; nu se completează automat aici; cifra din planșă nu s-a actualizat (700 m e dintr-o citire anterioară).')
  assertEquals(b.j.cantitati.doar_de_verificat, [{ dn: 110, material: null, pozitie_id: 4, actiune: 'nota_total_dn' }])
  // (c) poziția de conductă numită „… lungime totală” + TOTAL-ul real: poziția ia Dn110, TOTAL ia totalul, nimic inserat
  //     (e8489a6: poziția era luată drept TOTAL, iar Dn110 intra ca poziție nouă — dublură în ofertă)
  for (const ordine of [0, 1]) {
    const poz = [{ id: 1, denumire: 'Conductă PE Dn110 — lungime totală', cantitate: 500, cantitate_plansa: null, status: 'extras' },
      { id: 9, denumire: 'TOTAL rețea distribuție', cantitate: 500, cantitate_plansa: null, status: 'extras' }]
    const c = await ruleaza(ordine ? [...poz].reverse() : poz)
    assertEquals([c.id(1).cantitate_plansa, c.id(1).diferenta_nota, c.id(9).cantitate_plansa, c.j.cantitati.adaugate], [500, 'Planșa „PL1.1.pdf” confirmă: 500 m.', 500, 0], `ordine ${ordine}`)
    assert(c.id(9).diferenta_nota.includes('confirmă totalul: 500 m'), c.id(9).diferenta_nota)
  }
  // (d) două rânduri „total” (proba V8E2E-TOTAL): „Total rețea PE” (fără Dn) = TOTAL, „Total conducte De 110” = Dn110; aceleași
  //     scrieri în ambele ordini (e8489a6, ordinea inversă: „Total conducte De 110” devenea TOTAL, iar Dn110 se insera nou)
  const poz = [{ id: 3, denumire: 'Total rețea PE', cantitate: 500, cantitate_plansa: null, status: 'extras' },
    { id: 4, denumire: 'Total conducte De 110', cantitate: 500, cantitate_plansa: null, status: 'extras' }]
  const d1 = await ruleaza(poz), d2 = await ruleaza([...poz].reverse())
  assertEquals(d1.ops, [['update', 3, 500], ['update', 4, 500]])
  assertEquals(d2.ops, d1.ops, 'independent de ordinea din BD')
  assert(d1.id(3).diferenta_nota.includes('confirmă totalul'), d1.id(3).diferenta_nota)
  assertEquals(d1.id(4).diferenta_nota, 'Planșa „PL1.1.pdf” confirmă: 500 m.')
})

// ---- 26.09.2026 — runda 8 (verificatorul rundei 7): prin handler + RPC simulat. Pică pe e8489a6. ----
Deno.test('runda 8 NFL (E2E, compact): Nr 2 citit fără lungime => raport + notă + „diferenta” + ⚠ (e8489a6: „confirmă: 900 m”, „extras”, nimic despre rândul 2)', async () => {
  const { supa, n, tabele } = await lic3([{ id: 11, denumire: 'Țeavă PE100 Dn110', cantitate: 900, cantitate_plansa: null, status: 'extras' }])
  const ai = aiFelii(n, { z1_1: { tronsoane: [trT('A', 110, 500), { ...trT('B', 110, 0), lungime_m: null }, trT('C', 110, 400)],
    tabele: [{ denumire: 'Dimensionare', coloane: COLT, randuri: [rdT('1', 'A', '110', '0,5'), rdT('2', 'B', '110', ''), rdT('3', 'C', '110', '0,4')] }] } })
  const j = await (await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(n, ai, supa))).json()
  assertEquals([j.sumar.total_sigur_m, j.sumar.total_de_verificat_m, j.sumar.total_sigur_incomplet, j.sumar.nr_fara_lungime], [900, 0, true, [{ nr: '2', zona: 'z1_1', dn: 110 }]])
  const t = '1 rând cu Nr citit, dar fără nicio lungime citită: Nr 2 (Dn110) — rândul există pe planșă, metrii lui nu sunt în total'
  assert(j.sumar.avertismente.includes(`${t}; totalul sigur (900 m) e INCOMPLET — de verificat pe planșă`), j.sumar.avertismente.join(' | '))
  const p = (await tabele.from('ofertare_cantitati').select()).data.find((x: any) => x.id === 11)
  assertEquals([p.cantitate_plansa, p.status], [900, 'diferenta'])
  // runda 9 (NFL-DN): rândul fără lungime are Dn110 citit => numit și pe Dn-ul poziției, nu doar „pe planșă”
  assertEquals(p.diferenta_nota, `Planșa „PL1.1.pdf” confirmă: 900 m. De verificat, NEincluse în cifra din planșă: 1 rând Dn110 cu Nr citit, fără lungime (Nr 2; metri necunoscuți); pe planșă: ${t}.`)
  assert((await citesteDoc130(tabele)).text_extras.includes(`⚠ Nr FĂRĂ LUNGIME: ${t}`))
})
Deno.test('runda 8 NFL (E2E, 470): Nr 50 în z2_6 și z2_7, lungimea necitită => nota FIECĂREI poziții, „extras” => „diferenta”, ⚠ (e8489a6: 1751–1755 „confirmă” / „extras”, 1756 fără mențiune, niciun ⚠)', async () => {
  const { raspuns470 } = await import('./fixture_470.ts')
  const k = raspuns470('z2_6').tabele[0].randuri.findIndex((x: any) => x['Nr crt'] === '50')
  const { j, id, doc } = await transfer470((et, r) => {
    if (et === 'z2_7') { r.tabele[0].randuri[k]['Lungime Km'] = ''; r.tronsoane[k] = { ...r.tronsoane[k], lungime_m: null } }
    return r
  })
  assertEquals([j.sumar.total_sigur_m, j.sumar.total_de_verificat_m, j.sumar.total_sigur_incomplet, j.sumar.nr_fara_lungime], [48685, 0, true, [{ nr: '50', zona: 'z2_6', dn: 40 }]])
  const t = '1 rând cu Nr citit, dar fără nicio lungime citită: Nr 50 (Dn40) — rândul există pe planșă, metrii lui nu sunt în total'
  for (const k2 of [1751, 1752, 1753, 1754, 1755, 1756]) {
    assert(id(k2).diferenta_nota.endsWith(`pe planșă: Dn nestandard Dn60: 110 m; ${t}.`), `${k2}: ${id(k2).diferenta_nota}`)
    assertEquals(id(k2).status, 'diferenta', `${k2}: cifra din planșă e doar partea citită`)
  }
  assert(doc.text_extras.includes(`⚠ Nr FĂRĂ LUNGIME: ${t}; totalul sigur e incomplet`), doc.text_extras.slice(-600))
})
Deno.test('runda 8 (mutant neprins): poziție NOUĂ (Dn absent din ofertă) de pe o planșă cu secvența Nr incompletă / cu Nr fără lungime => inserată cu „diferenta”, nu „extras”', async () => {
  for (const caz of ['gol', 'fara_lungime'] as const) {
    const { supa, n, tabele } = await lic3([{ id: 3, denumire: 'Țeavă PE100 Dn160', cantitate: 100, cantitate_plansa: null, status: 'validat' }])
    const ai = aiFelii(n, { z1_1: caz === 'gol'
      ? { tronsoane: [trT('A', 110, 500), trT('C', 110, 400)], tabele: [{ denumire: 'D', coloane: COLT, randuri: [rdT('1', 'A', '110', '0,5'), rdT('3', 'C', '110', '0,4')] }] }
      : { tronsoane: [trT('A', 110, 500), { ...trT('B', 110, 0), lungime_m: null }, trT('C', 110, 400)],
        tabele: [{ denumire: 'D', coloane: COLT, randuri: [rdT('1', 'A', '110', '0,5'), rdT('2', 'B', '110', ''), rdT('3', 'C', '110', '0,4')] }] } })
    const j = await (await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(n, ai, supa))).json()
    assertEquals([j.sumar.total_sigur_m, j.sumar.total_sigur_incomplet, j.cantitati.adaugate], [900, true, 1], caz)
    const nou = (await tabele.from('ofertare_cantitati').select()).data.find((x: any) => x.denumire === 'Conductă distribuție gaze PE Dn110')
    assertEquals([nou.cantitate_plansa, nou.status], [900, 'diferenta'], caz)
    assert(nou.diferenta_nota.includes(caz === 'gol' ? 'secvență Nr incompletă: lipsesc Nr 2' : 'fără nicio lungime citită: Nr 2 (Dn110)'), nou.diferenta_nota)
  }
})
Deno.test('runda 8 MY-T4: grup sigur Dn110 PE AMBIGUU (două poziții PE) + rest Dn110 fără material => nota spune „ambiguu”, nu „alt material” (e8489a6: text fals)', async () => {
  const { supa, n, tabele } = await lic3([
    { id: 11, denumire: 'Țeavă PE100 Dn110 Lot 1', cantitate: 500, cantitate_plansa: 500, status: 'extras', diferenta_nota: 'VECHE 1' },
    { id: 12, denumire: 'Țeavă PE100 Dn110 Lot 2', cantitate: 300, cantitate_plansa: 300, status: 'validat', diferenta_nota: 'VECHE 2' },
  ])
  const COLM = ['Nr crt', 'De la', 'La', 'Dn', 'Material', 'L (km)']
  const rd = (nr: string, dl: string, mat: string, L: string) => ({ 'Nr crt': nr, 'De la': dl, 'La': 'CT', 'Dn': '110', 'Material': mat, 'L (km)': L })
  const tr = (dl: string, mat: string | undefined, L: number) => ({ de_la: dl, la: 'CT', lungime_m: L, diametru_mm: 110, ...(mat ? { material: mat } : {}), sursa: 'tabel' })
  const ai = aiFelii(n, { z1_1: { tronsoane: [tr('A', 'PE100', 500), tr('B', undefined, 90)], tabele: [{ denumire: 'D', coloane: COLM, randuri: [rd('1', 'A', 'PE100', '0,5'), rd('?', 'B', '', '0,09')] }] } })
  const j = await (await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(n, ai, supa))).json()
  assertEquals(j.cantitati.ambigue.map((a: any) => [a.dn, a.material, a.pozitii.map((p: any) => p.id)]), [[110, 'PE', [11, 12]]])
  const rows = (await tabele.from('ofertare_cantitati').select()).data
  const id = (k: number) => rows.find((x: any) => x.id === k)
  for (const [k, cp, st] of [[11, 500, 'diferenta'], [12, 300, 'validat']] as const) {
    assertEquals([id(k).cantitate_plansa, id(k).status], [cp, st])
    assertEquals(id(k).diferenta_nota, 'De verificat: 1 rând Dn110 fără identitate sigură (90 m) — fără material, pot fi ale acestei poziții (grupul sigur de pe Dn110 nu i-a fost ' +
      `atribuit: Dn110 PE 500 m e ambiguu între 2 poziții (nescris)); cifra din planșă nu s-a actualizat (${cp} m e dintr-o citire anterioară). Pe planșă: 1 rând de tabel fără identitate sigură (90 m).`)
  }
})

// ---- 26.09.2026 — runda 9 (verificatorul rundei 8: 3 majore, 3 minore): prin handler + RPC simulat. Pică pe b5e7ecd. ----
const spionOps = (supa: any) => { const ops: any[] = [], rpc0 = supa.rpc; supa.rpc = (nume: string, a: any) => { if (nume === 'ofertare_transfer_plansa_cantitati') ops.push(...a.p_randuri); return rpc0(nume, a) }; return ops }
Deno.test('runda 9 DN0 (V9R-DN0): rând SIGUR fără Dn citit => nu mai dispare tăcut la transfer: avertisment, sumar, notă pe poziții și TOTAL, „extras” => „diferenta”, ⚠ (b5e7ecd: TOTAL „confirmă totalul: 900 m” pe 1.200 m sigur, niciun semnal)', async () => {
  const { supa, n, tabele } = await lic3([
    { id: 11, denumire: 'Țeavă PE100 Dn110', cantitate: 900, cantitate_plansa: null, status: 'extras' },
    { id: 4, denumire: 'TOTAL rețea distribuție', cantitate: 900, cantitate_plansa: null, status: 'extras' },
  ])
  const ai = aiFelii(n, { z1_1: { tronsoane: [trT('A', 110, 500), { ...trT('B', 110, 300), diametru_mm: null }, trT('C', 110, 400)],
    tabele: [{ denumire: 'Dimensionare', coloane: COLT, randuri: [rdT('1', 'A', '110', '0,5'), rdT('2', 'B', '', '0,3'), rdT('3', 'C', '110', '0,4')] }] } })
  const j = await (await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(n, ai, supa))).json()
  assertEquals([j.sumar.total_sigur_m, j.sumar.lungime_totala_m, j.sumar.tronsoane_fara_dn_n, j.sumar.tronsoane_fara_dn_m], [1200, 1200, 1, 300], 'totalul sigur nu se schimbă (fără metri inventați / scoși)')
  assertEquals(j.sumar.tronsoane_fara_dn.map((t: any) => [t.nr, t.lungime_m]), [['2', 300]])
  const t = '1 tronson sigur fără Dn citit (300 m) — în lungimea planșei, dar în nicio poziție de cantități (Dn necunoscut)'
  assert(j.sumar.avertismente.some((a: string) => a.startsWith(t)), j.sumar.avertismente.join(' | '))
  assertEquals(j.cantitati.total_m, 900)
  assertEquals(j.cantitati.doar_de_verificat, [{ dn: null, material: 'PE', pozitie_id: null, actiune: 'fara_dn' }])
  const rows = (await tabele.from('ofertare_cantitati').select()).data
  const id = (k: number) => rows.find((x: any) => x.id === k)
  assertEquals([id(11).cantitate_plansa, id(11).status], [900, 'diferenta'], 'Dn110: rândul fără Dn poate fi al ei => cifra poate fi incompletă')
  assertEquals(id(11).diferenta_nota, `Planșa „PL1.1.pdf” confirmă: 900 m. De verificat, NEincluse în cifra din planșă: pe planșă: ${t}.`)
  assertEquals([id(4).cantitate_plansa, id(4).status], [900, 'diferenta'])
  assertEquals(id(4).diferenta_nota, `Planșa „PL1.1.pdf” confirmă totalul: 900 m. De verificat, NEincluse în cifra din planșă: pe planșă: ${t}.`)
  assert((await citesteDoc130(tabele)).text_extras.includes(`⚠ FĂRĂ Dn: ${t}`))
})
Deno.test('runda 9 NFL-DN (V9R-NFL-DN): Nr citit fără lungime, cu Dn cunoscut => poziția Dn-ului lui nu mai păstrează tăcut cifra veche („extras” golită, „validat” doar notă); pe Dn cu grup sigur, și nota grupului (b5e7ecd: Dn90 250 „extras” „VECHE 12”, Dn63 „VECHE 13”)', async () => {
  const { supa, n, tabele } = await lic3([
    { id: 11, denumire: 'Țeavă PE100 Dn110', cantitate: 900, cantitate_plansa: 900, status: 'extras', diferenta_nota: 'VECHE 11' },
    { id: 12, denumire: 'Țeavă PE100 Dn90', cantitate: 250, cantitate_plansa: 250, status: 'extras', diferenta_nota: 'VECHE 12' },
    { id: 13, denumire: 'Țeavă PE100 Dn63', cantitate: 120, cantitate_plansa: 120, status: 'validat', diferenta_nota: 'VECHE 13' },
  ])
  const ai = aiFelii(n, { z1_1: { tronsoane: [trT('A', 110, 500), { ...trT('B', 90, 0), lungime_m: null }, trT('C', 110, 400), { ...trT('D', 63, 0), lungime_m: null }],
    tabele: [{ denumire: 'Dimensionare', coloane: COLT, randuri: [rdT('1', 'A', '110', '0,5'), rdT('2', 'B', '90', ''), rdT('3', 'C', '110', '0,4'), rdT('4', 'D', '63', '')] }] } })
  const j = await (await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(n, ai, supa))).json()
  assertEquals(j.sumar.nr_fara_lungime, [{ nr: '2', zona: 'z1_1', dn: 90 }, { nr: '4', zona: 'z1_1', dn: 63 }])
  assertEquals(j.cantitati.doar_de_verificat, [{ dn: 90, material: null, pozitie_id: 12, actiune: 'golit' }, { dn: 63, material: null, pozitie_id: 13, actiune: 'nota' }])
  const rows = (await tabele.from('ofertare_cantitati').select()).data
  const id = (k: number) => rows.find((x: any) => x.id === k)
  const pe = ' Pe planșă: 2 rânduri cu Nr citit, dar fără nicio lungime citită: Nr 2 (Dn90), 4 (Dn63) — rândurile există pe planșă, metrii lor nu sunt în total.'
  assertEquals([id(12).cantitate_plansa, id(12).status], [null, 'diferenta'])
  assertEquals(id(12).diferenta_nota, 'De verificat: 1 rând Dn90 cu Nr citit, fără lungime (Nr 2; metri necunoscuți); cifra din planșă s-a golit (era 250 m, dintr-o citire anterioară).' + pe)
  assertEquals([id(13).cantitate_plansa, id(13).status], [120, 'validat'])
  assertEquals(id(13).diferenta_nota, 'De verificat: 1 rând Dn63 cu Nr citit, fără lungime (Nr 4; metri necunoscuți); cifra din planșă nu s-a actualizat (120 m e dintr-o citire anterioară).' + pe)
  assertEquals([id(11).cantitate_plansa, id(11).status], [900, 'diferenta'])
  // Dn cu grup sigur: rândul NFL al Dn-ului e numit în nota grupului, înainte de „pe planșă”
  const s = await lic3([{ id: 11, denumire: 'Țeavă PE100 Dn110', cantitate: 900, cantitate_plansa: null, status: 'extras' },
    { id: 14, denumire: 'Țeavă OL Dn110', cantitate: 50, cantitate_plansa: 60, status: 'extras', diferenta_nota: 'VECHE 14' }])
  await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(s.n, aiFelii(s.n, { z1_1: { tronsoane: [trT('A', 110, 500), { ...trT('B', 110, 0), lungime_m: null }, trT('C', 110, 400)],
    tabele: [{ denumire: 'D', coloane: COLT, randuri: [rdT('1', 'A', '110', '0,5'), rdT('2', 'B', '110', ''), rdT('3', 'C', '110', '0,4')] }] } }), s.supa))
  const r2 = (await s.tabele.from('ofertare_cantitati').select()).data
  assert(r2.find((x: any) => x.id === 11).diferenta_nota.includes('NEincluse în cifra din planșă: 1 rând Dn110 cu Nr citit, fără lungime (Nr 2; metri necunoscuți); pe planșă:'))
  // a doua poziție de pe Dn110 (OL, neatinsă de grupul PE): MY-T4 — nota, „diferenta”, cifra neatinsă
  const ol = r2.find((x: any) => x.id === 14)
  assertEquals([ol.cantitate_plansa, ol.status], [60, 'diferenta'])
  assert(ol.diferenta_nota.startsWith('De verificat: 1 rând Dn110 cu Nr citit, fără lungime (Nr 2; metri necunoscuți) — fără material, pot fi ale acestei poziții'), ol.diferenta_nota)
})
Deno.test('runda 9 TOTAL-a (V9R-TOTAL-a): „Total conducte De 110” + poziția reală „Conductă distribuție gaze Dn110” (fără material) => poziția primește cifra, subtotalul doar notă (b5e7ecd: AMBIGUU, poziția validată păstra tăcut 480)', async () => {
  const COLM = ['Nr crt', 'De la', 'La', 'Dn', 'Material', 'L (km)']
  const felii = { z1_1: { tronsoane: [{ de_la: 'A', la: 'CT', lungime_m: 500, diametru_mm: 110, material: 'PE100', sursa: 'tabel' }],
    tabele: [{ denumire: 'D', coloane: COLM, randuri: [{ 'Nr crt': '1', 'De la': 'A', 'La': 'CT', 'Dn': '110', 'Material': 'PE100', 'L (km)': '0,5' }] }] } }
  for (const ordine of [0, 1]) {
    const poz = [{ id: 3, denumire: 'Conductă distribuție gaze Dn110', cantitate: 500, cantitate_plansa: 480, status: 'validat', diferenta_nota: 'VECHE 3' },
      { id: 4, denumire: 'Total conducte De 110', cantitate: 500, cantitate_plansa: 480, status: 'extras', diferenta_nota: 'VECHE 4' }]
    const x = await lic3(ordine ? [...poz].reverse() : poz)
    const ops = spionOps(x.supa)
    const j = await (await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(x.n, aiFelii(x.n, felii), x.supa))).json()
    const rows = (await x.tabele.from('ofertare_cantitati').select()).data
    const id = (k: number) => rows.find((q: any) => q.id === k)
    assertEquals(j.cantitati.ambigue, [], `ordine ${ordine}`)
    // rebase R5 peste R4 runda 9: poziția primește cifra (intenția R4); cifra din planșă se schimbă 480 → 500 pe un rând VALIDAT =>
    // regula R5 (cifraSchimbata): iese din „validat”, cu aprobarea veche numită în notă
    assertEquals([id(3).cantitate_plansa, id(3).status, id(3).diferenta_nota], [500, 'diferenta',
      'Rândul era VALIDAT cu cifra din planșă 480 m; planșa „pl1.1.pdf” dă acum 500 m — validarea se reface. Planșa „PL1.1.pdf” confirmă: 500 m.'])
    assertEquals([id(4).cantitate_plansa, id(4).status], [480, 'diferenta'])
    assertEquals(id(4).diferenta_nota, 'De verificat: rând de total cu Dn în denumire (subtotal pe Dn sau poziție), neatribuit — grupurile sigure de pe Dn-ul lui ' +
      '(Planșa „PL1.1.pdf”): Dn110 PE 500 m e pe poziția „Conductă distribuție gaze Dn110”; nu se completează automat aici; cifra din planșă nu s-a actualizat (480 m e dintr-o citire anterioară).')
    const upd = ops.filter((o) => o.op === 'update').map((o) => o.id)
    assertEquals(upd.length, new Set(upd).size, 'un singur update pe id')
  }
})
Deno.test('runda 9 TOTAL-b (V9R-TOTAL-b): TOTAL global cu INTERVAL de Dn („Total rețea De 63–110”) = TOTAL, nu candidat Dn63; Dn63 intră ca poziție (b5e7ecd: 200 m în TOTAL validat, „-900 m” fals, Dn63 dispărea)', async () => {
  const COLM = ['Nr crt', 'De la', 'La', 'Dn', 'Material', 'L (km)']
  const rd = (nr: string, dl: string, dn: string, L: string) => ({ 'Nr crt': nr, 'De la': dl, 'La': 'CT', 'Dn': dn, 'Material': 'PE100', 'L (km)': L })
  const tr = (dl: string, dn: number, L: number) => ({ de_la: dl, la: 'CT', lungime_m: L, diametru_mm: dn, material: 'PE100', sursa: 'tabel' })
  const felii = { z1_1: { tronsoane: [tr('A', 110, 900), tr('B', 63, 200)], tabele: [{ denumire: 'D', coloane: COLM, randuri: [rd('1', 'A', '110', '0,9'), rd('2', 'B', '63', '0,2')] }] } }
  // (ultimul: interval cu un capăt nestandard — un singur Dn standard, dar tot interval => TOTAL, nu candidat pe Dn110)
  for (const den of ['Total rețea De 63–110', 'Total rețea Dn 63-110', 'Total conducte Dn63 … Dn110', 'TOTAL rețea Ø63 – Ø110', 'Total rețea De 60–110']) {
    const x = await lic3([{ id: 3, denumire: 'Țeavă PE100 Dn110', cantitate: 900, cantitate_plansa: null, status: 'extras' },
      { id: 4, denumire: den, cantitate: 1100, cantitate_plansa: 1100, status: 'validat', diferenta_nota: 'VECHE 4' }])
    const j = await (await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(x.n, aiFelii(x.n, felii), x.supa))).json()
    const rows = (await x.tabele.from('ofertare_cantitati').select()).data
    const t = rows.find((q: any) => q.id === 4)
    assertEquals([t.cantitate_plansa, t.status, t.diferenta_nota], [1100, 'validat', 'Planșa „PL1.1.pdf” confirmă totalul: 1.100 m.'], den)
    const d63 = rows.find((q: any) => q.denumire === 'Conductă distribuție gaze PE Dn63')
    assertEquals([d63?.cantitate_plansa, j.cantitati.adaugate, j.cantitati.total_m], [200, 1, 1100], den)
    assertEquals(rows.find((q: any) => q.id === 3).cantitate_plansa, 900)
  }
  // două rânduri TOTAL: primul („TOTAL rețea distribuție”) primește totalul; al doilea, cu interval, NU devine candidat pe Dn63
  // (nu primește subtotalul Dn63; Dn63 intră ca poziție); cifra lui rămâne neatinsă (limită documentată, §5.7)
  const x = await lic3([{ id: 3, denumire: 'Țeavă PE100 Dn110', cantitate: 900, cantitate_plansa: null, status: 'extras' },
    { id: 4, denumire: 'TOTAL rețea distribuție', cantitate: 1100, cantitate_plansa: null, status: 'extras' },
    { id: 5, denumire: 'Total rețea De 63–110', cantitate: 1100, cantitate_plansa: 1050, status: 'validat', diferenta_nota: 'VECHE 5' }])
  const j = await (await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(x.n, aiFelii(x.n, felii), x.supa))).json()
  const rows = (await x.tabele.from('ofertare_cantitati').select()).data
  const id = (k: number) => rows.find((q: any) => q.id === k)
  assertEquals([id(4).cantitate_plansa, id(5).cantitate_plansa, id(5).diferenta_nota, j.cantitati.adaugate], [1100, 1050, 'VECHE 5', 1])
})
Deno.test('runda 9 TOTAL: subtotal „Total conducte De 90” pe un Dn doar cu rânduri de verificat + poziția reală Dn90 => poziția primește nota „doar de verificat”, subtotalul nota lui (nu mai e ambiguu, nimic tăcut)', async () => {
  const x = await lic3([{ id: 5, denumire: 'Conductă distribuție gaze Dn90', cantitate: 300, cantitate_plansa: 280, status: 'extras', diferenta_nota: 'VECHE 5' },
    { id: 6, denumire: 'Total conducte De 90', cantitate: 300, cantitate_plansa: 280, status: 'validat', diferenta_nota: 'VECHE 6' }])
  const ai = aiFelii(x.n, { z1_1: { tronsoane: [trT('A', 110, 500), trT('B', 90, 300)], tabele: [{ denumire: 'D', coloane: COLT, randuri: [rdT('1', 'A', '110', '0,5'), rdT('?', 'B', '90', '0,3')] }] } })
  const j = await (await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(x.n, ai, x.supa))).json()
  const rows = (await x.tabele.from('ofertare_cantitati').select()).data
  const id = (k: number) => rows.find((q: any) => q.id === k)
  assertEquals(j.cantitati.ambigue.filter((a: any) => a.dn === 90), [])
  assertEquals([id(5).cantitate_plansa, id(5).status], [null, 'diferenta'])
  assertEquals([id(6).cantitate_plansa, id(6).status], [280, 'validat'])
  assertEquals(id(6).diferenta_nota, 'De verificat: rând de total cu Dn în denumire (subtotal pe Dn sau poziție), neatribuit — pe Dn-ul lui doar rânduri de verificat, fără nicio cifră sigură: ' +
    '1 rând Dn90 PE fără identitate sigură (300 m); nu se completează automat aici; cifra din planșă nu s-a actualizat (280 m e dintr-o citire anterioară). Pe planșă: 1 rând de tabel fără identitate sigură (300 m).')
  assertEquals(j.cantitati.doar_de_verificat.map((d: any) => [d.dn, d.pozitie_id, d.actiune]), [[90, 5, 'golit'], [90, 6, 'nota_total_dn']])
})
Deno.test('runda 9 NFL-FP (E2E): același tabel văzut întreg în două felii alăturate, antetul Nr transcris diferit („Nr crt” / „Nr”) => niciun „Nr fără lungime”, totalul complet, poziția „confirmă” / „extras” (b5e7ecd: fals NFL, „diferenta”)', async () => {
  const Z = ['1_1', '1_2']
  const x = supaCu({ id: 130, licitatie_id: 3, nume_original: 'PL1.1.pdf', analiza: { plansa: { ...PLANSA, zone_asteptate: Z, acoperire_demonstrata: true } } }, Z)
  await x.tabele.from('ofertare_cantitati').insert({ licitatie_id: 3, um: 'm', id: 11, denumire: 'Țeavă PE100 Dn110', cantitate: 900, cantitate_plansa: null, status: 'extras' })
  const COL2 = ['Nr', 'De la', 'La', 'Dn', 'L (km)']
  const rd2 = (nr: string, dl: string, dn: string, L: string) => ({ 'Nr': nr, 'De la': dl, 'La': 'CT', 'Dn': dn, 'L (km)': L })
  const ai = aiFelii(x.n, {
    z1_1: { tronsoane: [trT('A', 110, 500), trT('C', 110, 400)], tabele: [{ denumire: 'D', coloane: COLT, randuri: [rdT('1', 'A', '110', '0,5'), rdT('2', 'C', '110', '0,4')] }] },
    z1_2: { tronsoane: [trT('A', 110, 500), trT('C', 110, 400)], tabele: [{ denumire: 'D', coloane: COL2, randuri: [rd2('1', 'A', '110', '0,5'), rd2('2', 'C', '110', '0,4')] }] },
  })
  const j = await (await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(x.n, ai, x.supa))).json()
  assertEquals([j.sumar.total_sigur_m, j.sumar.nr_fara_lungime, j.sumar.total_sigur_incomplet], [900, undefined, undefined])
  const p = (await x.tabele.from('ofertare_cantitati').select()).data.find((q: any) => q.id === 11)
  assertEquals([p.cantitate_plansa, p.status], [900, 'extras'])
  assert(!/fără nicio lungime/.test(p.diferenta_nota), p.diferenta_nota)
})

// ---- 26.09.2026 — runda 10 (verificatorul rundei 9, ADV10): prin handler + RPC simulat. Pică pe 3197aa3 / 7a7bf86. ----
const COLM10 = ['Nr crt', 'De la', 'La', 'Dn', 'Material', 'L (km)']
const feliiDn110 = (mat: string | null) => ({ z1_1: { tronsoane: [{ de_la: 'A', la: 'CT', lungime_m: 500, diametru_mm: 110, material: mat, sursa: 'tabel' }],
  tabele: [{ denumire: 'D', coloane: COLM10, randuri: [{ 'Nr crt': '1', 'De la': 'A', 'La': 'CT', 'Dn': '110', 'Material': mat || '', 'L (km)': '0,5' }] }] } })
const ruleaza10 = async (poz: any[], felii: any) => {
  const x = await lic3(poz)
  const ops = spionOps(x.supa)
  const j = await (await handler(cerereSvc({ doc_id: 130, de_la: 0 }), svc(x.n, aiFelii(x.n, felii), x.supa))).json()
  const rows = (await x.tabele.from('ofertare_cantitati').select()).data
  const upd = ops.filter((o) => o.op === 'update').map((o) => o.id)
  assertEquals(upd.length, new Set(upd).size, `un singur update pe id: ${JSON.stringify(upd)}`)
  return { j, rows, ops, id: (k: number) => rows.find((q: any) => q.id === k) }
}
Deno.test('runda 10 TOTAL-a (ADV10-1): subtotalul cu MATERIALUL grupului („Total conducte PE De 110”) + poziția reală fără material => poziția primește cifra, subtotalul notă; validat și extras, ambele ordini (7a7bf86: subtotalul lua 500, poziția păstra TĂCUT 480 „VECHE 3”)', async () => {
  for (const st of ['validat', 'extras']) for (const ordine of [0, 1]) {
    const poz = [{ id: 3, denumire: 'Conductă distribuție gaze Dn110', cantitate: 500, cantitate_plansa: 480, status: st, diferenta_nota: 'VECHE 3' },
      { id: 4, denumire: 'Total conducte PE De 110', cantitate: 500, cantitate_plansa: 480, status: 'extras', diferenta_nota: 'VECHE 4' }]
    const r = await ruleaza10(ordine ? [...poz].reverse() : poz, feliiDn110('PE100'))
    const cum = `${st}, ordine ${ordine}`
    assertEquals(r.j.cantitati.ambigue, [], cum)
    assertEquals([r.id(3).cantitate_plansa, r.id(3).status, r.id(3).diferenta_nota], [500, st, 'Planșa „PL1.1.pdf” confirmă: 500 m.'], cum)
    assertEquals([r.id(4).cantitate_plansa, r.id(4).status], [480, 'diferenta'], cum)
    assertEquals(r.id(4).diferenta_nota, 'De verificat: rând de total cu Dn în denumire (subtotal pe Dn sau poziție), neatribuit — grupurile sigure de pe Dn-ul lui ' +
      '(Planșa „PL1.1.pdf”): Dn110 PE 500 m e pe poziția „Conductă distribuție gaze Dn110”; nu se completează automat aici; cifra din planșă nu s-a actualizat (480 m e dintr-o citire anterioară).', cum)
    assertEquals(r.ops.map((o: any) => [o.op, o.id, o.patch?.cantitate_plansa]).sort((a: any, b: any) => a[1] - b[1]), [['update', 3, 500], ['update', 4, undefined]], cum)
    assertEquals(r.j.cantitati.doar_de_verificat, [{ dn: 110, material: null, pozitie_id: 4, actiune: 'nota_total_dn' }], cum)
  }
})
Deno.test('runda 10 TOTAL-a (ADV10-8), calea „doar de verificat”: rândul Dn90 PE de verificat + „Conductă distribuție gaze Dn90” (extras) + „Total conducte PE De 90” => poziția „extras” golită, subtotalul notă; ambele ordini (7a7bf86: poziția păstra 280 „VECHE 5”, nota doar pe subtotal)', async () => {
  for (const ordine of [0, 1]) {
    const poz = [{ id: 5, denumire: 'Conductă distribuție gaze Dn90', cantitate: 300, cantitate_plansa: 280, status: 'extras', diferenta_nota: 'VECHE 5' },
      { id: 6, denumire: 'Total conducte PE De 90', cantitate: 300, cantitate_plansa: 280, status: 'validat', diferenta_nota: 'VECHE 6' }]
    const r = await ruleaza10(ordine ? [...poz].reverse() : poz,
      { z1_1: { tronsoane: [trT('A', 110, 500), trT('B', 90, 300)], tabele: [{ denumire: 'D', coloane: COLT, randuri: [rdT('1', 'A', '110', '0,5'), rdT('?', 'B', '90', '0,3')] }] } })
    const cum = `ordine ${ordine}`
    assertEquals(r.j.cantitati.ambigue.filter((a: any) => a.dn === 90), [], cum)
    assertEquals([r.id(5).cantitate_plansa, r.id(5).status], [null, 'diferenta'], cum)
    assertEquals(r.id(5).diferenta_nota, 'De verificat: 1 rând Dn90 PE fără identitate sigură (300 m); cifra din planșă s-a golit (era 280 m, dintr-o citire anterioară). ' +
      'Pe planșă: 1 rând de tabel fără identitate sigură (300 m).', cum)
    assertEquals([r.id(6).cantitate_plansa, r.id(6).status], [280, 'validat'], cum)
    assert(r.id(6).diferenta_nota.startsWith('De verificat: rând de total cu Dn în denumire (subtotal pe Dn sau poziție), neatribuit — pe Dn-ul lui doar rânduri de verificat'), r.id(6).diferenta_nota)
    assertEquals(r.j.cantitati.doar_de_verificat.map((d: any) => [d.dn, d.pozitie_id, d.actiune]), [[90, 5, 'golit'], [90, 6, 'nota_total_dn']], cum)
  }
})
Deno.test('runda 10 TOTAL-b (ADV10-7): TOTAL cu interval românesc („÷”, „/”, „la”, „până la”) sau cu LISTĂ de Dn = TOTAL global, nu subtotal Dn63; Dn63 intră ca poziție (7a7bf86: TOTAL validat 200 m, „-900 m” fals, Dn63 dispărea)', async () => {
  const COLM = COLM10
  const rd = (nr: string, dl: string, dn: string, L: string) => ({ 'Nr crt': nr, 'De la': dl, 'La': 'CT', 'Dn': dn, 'Material': 'PE100', 'L (km)': L })
  const tr = (dl: string, dn: number, L: number) => ({ de_la: dl, la: 'CT', lungime_m: L, diametru_mm: dn, material: 'PE100', sursa: 'tabel' })
  const felii = { z1_1: { tronsoane: [tr('A', 110, 900), tr('B', 63, 200)], tabele: [{ denumire: 'D', coloane: COLM, randuri: [rd('1', 'A', '110', '0,9'), rd('2', 'B', '63', '0,2')] }] } }
  // ultimele două: ≥ 2 Dn FĂRĂ interval (ramura „dn.length !== 1” din esteTotal — mutația care o scoate pică aici)
  for (const den of ['Total rețea Dn 63÷110', 'Total rețea De 63 ÷ 110', 'Total rețea De 63/110', 'Total rețea Dn 63 la 110', 'Total conducte De 63 până la De 110',
    'Total rețea Dn63 și Dn110', 'Total conducte Dn 63, 90 și 110']) {
    const r = await ruleaza10([{ id: 3, denumire: 'Țeavă PE100 Dn110', cantitate: 900, cantitate_plansa: null, status: 'extras' },
      { id: 4, denumire: den, cantitate: 1100, cantitate_plansa: 1100, status: 'validat', diferenta_nota: 'VECHE 4' }], felii)
    assertEquals([r.id(4).cantitate_plansa, r.id(4).status, r.id(4).diferenta_nota], [1100, 'validat', 'Planșa „PL1.1.pdf” confirmă totalul: 1.100 m.'], den)
    const d63 = r.rows.find((q: any) => q.denumire === 'Conductă distribuție gaze PE Dn63')
    assertEquals([d63?.cantitate_plansa, r.j.cantitati.adaugate, r.j.cantitati.total_m, r.id(3).cantitate_plansa], [200, 1, 1100, 900], den)
  }
  // control: un singur Dn (De 63 și Ø 63 = același Dn) rămâne subtotal Dn63 — candidat, fără poziție nouă
  const c = await ruleaza10([{ id: 3, denumire: 'Țeavă PE100 Dn110', cantitate: 900, cantitate_plansa: null, status: 'extras' },
    { id: 4, denumire: 'Total conducte PE 100 SDR11 De 63 (Ø 63 mm)', cantitate: 200, cantitate_plansa: null, status: 'extras' }], felii)
  assertEquals([c.id(4).cantitate_plansa, c.id(4).diferenta_nota, c.j.cantitati.adaugate], [200, 'Planșa „PL1.1.pdf” confirmă: 200 m.', 0])
})
Deno.test('runda 10 (minor ADV10-2): subtotal = denumirea care ÎNCEPE cu „total”; „Conductă PE Dn110 — lungime totală” e poziție reală => lângă „Conductă OL Dn110”, grupul fără material e AMBIGUU vizibil, nimic scris (7a7bf86: 500 „confirmă” pe OL)', async () => {
  for (const ordine of [0, 1]) {
    const poz = [{ id: 3, denumire: 'Conductă PE Dn110 — lungime totală', cantitate: 500, cantitate_plansa: 480, status: 'extras', diferenta_nota: 'VECHE 3' },
      { id: 4, denumire: 'Conductă OL Dn110', cantitate: 500, cantitate_plansa: 20, status: 'extras', diferenta_nota: 'VECHE 4' }]
    const r = await ruleaza10(ordine ? [...poz].reverse() : poz, feliiDn110(null))
    const cum = `ordine ${ordine}`
    assertEquals(r.j.cantitati.ambigue.map((a: any) => [a.dn, a.material, a.metri, a.pozitii.map((p: any) => p.id).sort()]), [[110, null, 500, [3, 4]]], cum)
    assertEquals(r.ops.filter((o: any) => o.op === 'update').length, 0, cum)
    assertEquals([r.id(3).cantitate_plansa, r.id(3).diferenta_nota, r.id(4).cantitate_plansa, r.id(4).diferenta_nota], [480, 'VECHE 3', 20, 'VECHE 4'], cum)
  }
  // subtotal numerotat („3. Total …”) și „Subtotal …” rămân subtotal: poziția reală ia cifra, subtotalul primește nota
  for (const den of ['3. Total conducte De 110', 'Subtotal conducte De 110']) {
    const r = await ruleaza10([{ id: 3, denumire: 'Conductă distribuție gaze Dn110', cantitate: 500, cantitate_plansa: null, status: 'extras' },
      { id: 4, denumire: den, cantitate: 500, cantitate_plansa: 480, status: 'extras', diferenta_nota: 'VECHE 4' }], feliiDn110(null))
    assertEquals([r.id(3).cantitate_plansa, r.id(4).cantitate_plansa, r.id(4).status, r.j.cantitati.ambigue], [500, 480, 'diferenta', []], den)
    assert(r.id(4).diferenta_nota.startsWith('De verificat: rând de total cu Dn în denumire'), r.id(4).diferenta_nota)
  }
})
Deno.test('runda 10: pe calea „doar de verificat”, un rest AMBIGUU între o poziție cu „total” în denumire („… lungime totală”) și alta pe același (Dn, material) => doar în `ambigue`, nimic scris pe niciuna (nu notă doar pe una)', async () => {
  for (const ordine of [0, 1]) {
    const poz = [{ id: 5, denumire: 'Conductă PE Dn90 — lungime totală', cantitate: 300, cantitate_plansa: 280, status: 'extras', diferenta_nota: 'VECHE 5' },
      { id: 6, denumire: 'Conductă PE Dn90 lot 2', cantitate: 100, cantitate_plansa: 90, status: 'extras', diferenta_nota: 'VECHE 6' }]
    const r = await ruleaza10(ordine ? [...poz].reverse() : poz,
      { z1_1: { tronsoane: [trT('A', 110, 500), trT('B', 90, 300)], tabele: [{ denumire: 'D', coloane: COLT, randuri: [rdT('1', 'A', '110', '0,5'), rdT('?', 'B', '90', '0,3')] }] } })
    const cum = `ordine ${ordine}`
    assertEquals(r.j.cantitati.ambigue.filter((a: any) => a.dn === 90).map((a: any) => [a.material, a.pozitii.map((p: any) => p.id).sort()]), [['PE', [5, 6]]], cum)
    assertEquals(r.ops.filter((o: any) => o.op === 'update' && (o.id === 5 || o.id === 6)), [], cum)
    assertEquals([r.id(5).diferenta_nota, r.id(6).diferenta_nota], ['VECHE 5', 'VECHE 6'], cum)
    assertEquals(r.j.cantitati.doar_de_verificat.map((d: any) => [d.dn, d.pozitie_id, d.actiune]), [[90, null, 'ambiguu']], cum)
  }
})

// ---- 26.09.2026 — runda 11 (verificatorul rundei 10, ADV11): prin handler + RPC simulat. Pică pe 85c53f1 / 7065789. ----
const nota11 = 'De verificat: rând de total cu Dn în denumire (subtotal pe Dn sau poziție), neatribuit'
Deno.test('runda 11 (MAJOR, ADV11-1): subtotal numerotat cu literă / cifre romane / „Cap.” („a) Total conducte PE De 110”) + poziția reală fără material => poziția primește cifra, subtotalul notă; ambele ordini (85c53f1: subtotalul lua 500, poziția păstra TĂCUT 480 „VECHE 3”)', async () => {
  for (const den of ['a) Total conducte PE De 110', 'II. Total conducte PE De 110', 'Cap. 3 Total conducte PE De 110', 'Art. 2 - Total conducte PE De 110', 'B. Subtotal conducte PE De 110'])
    for (const ordine of [0, 1]) {
      const poz = [{ id: 3, denumire: 'Conductă distribuție gaze Dn110', cantitate: 500, cantitate_plansa: 480, status: 'validat', diferenta_nota: 'VECHE 3' },
        { id: 4, denumire: den, cantitate: 500, cantitate_plansa: 480, status: 'extras', diferenta_nota: 'VECHE 4' }]
      const r = await ruleaza10(ordine ? [...poz].reverse() : poz, feliiDn110('PE100'))
      const cum = `${den}, ordine ${ordine}`
      assertEquals(r.j.cantitati.ambigue, [], cum)
      assertEquals([r.id(3).cantitate_plansa, r.id(3).status, r.id(3).diferenta_nota], [500, 'validat', 'Planșa „PL1.1.pdf” confirmă: 500 m.'], cum)
      assertEquals([r.id(4).cantitate_plansa, r.id(4).status], [480, 'diferenta'], cum)
      assert(r.id(4).diferenta_nota.startsWith(nota11), cum + ': ' + r.id(4).diferenta_nota)
    }
  // runda 11 o fixa ca limită (§5.7: „Lungime totală …” lua cifra, poziția fără material rămânea TĂCUT pe 480 „VECHE 3”); runda 12
  // (fail-safe structural): rândul cu „total” nerecunoscut ca subtotal lângă o poziție compatibilă => AMBIGUU vizibil, nimic scris
  const r = await ruleaza10([{ id: 3, denumire: 'Conductă distribuție gaze Dn110', cantitate: 500, cantitate_plansa: 480, status: 'validat', diferenta_nota: 'VECHE 3' },
    { id: 4, denumire: 'Lungime totală conducte PE De 110', cantitate: 500, cantitate_plansa: 480, status: 'extras', diferenta_nota: 'VECHE 4' }], feliiDn110('PE100'))
  assertEquals(r.j.cantitati.ambigue.map((a: any) => [a.dn, a.material, a.metri, a.pozitii.map((p: any) => p.id).sort()]), [[110, 'PE', 500, [3, 4]]])
  assertEquals([r.id(4).cantitate_plansa, r.id(4).diferenta_nota, r.id(3).cantitate_plansa, r.id(3).diferenta_nota, r.ops.filter((o: any) => o.op === 'update').length], [480, 'VECHE 4', 480, 'VECHE 3', 0])
})
Deno.test('runda 11 (minor, ADV11-2 / 2b): subtotalul OL cedează doar pozițiilor COMPATIBILE ca material — „Total conducte OL De 110” + „Conductă PE Dn110”: grupul OL merge pe subtotalul OL, PE pe poziția PE (85c53f1: OL 40 scris peste poziția PE 500 / coliziune)', async () => {
  const mk = (dl: string, mat: string, L: number) => ({ de_la: dl, la: 'CT', lungime_m: L, diametru_mm: 110, material: mat, sursa: 'tabel' })
  const rr = (nr: string, dl: string, mat: string, L: string) => ({ 'Nr crt': nr, 'De la': dl, 'La': 'CT', 'Dn': '110', 'Material': mat, 'L (km)': L })
  for (const ordine of [0, 1]) {
    const poz = [{ id: 3, denumire: 'Conductă PE Dn110', cantitate: 500, cantitate_plansa: 500, status: 'extras', diferenta_nota: 'VECHE 3' },
      { id: 4, denumire: 'Total conducte OL De 110', cantitate: 40, cantitate_plansa: null, status: 'extras', diferenta_nota: 'VECHE 4' }]
    const r = await ruleaza10(ordine ? [...poz].reverse() : poz, { z1_1: { tronsoane: [mk('A', 'OL', 40)], tabele: [{ denumire: 'D', coloane: COLM10, randuri: [rr('1', 'A', 'OL', '0,04')] }] } })
    const cum = `ADV11-2, ordine ${ordine}`
    assertEquals(r.j.cantitati.ambigue, [], cum)
    assertEquals([r.id(4).cantitate_plansa, r.id(4).diferenta_nota], [40, 'Planșa „PL1.1.pdf” confirmă: 40 m.'], cum)
    assertEquals([r.id(3).cantitate_plansa, r.id(3).status, r.id(3).diferenta_nota], [500, 'extras', 'VECHE 3'], cum)
    const poz2 = [{ id: 3, denumire: 'Conductă PE Dn110', cantitate: 500, cantitate_plansa: 480, status: 'extras', diferenta_nota: 'VECHE 3' },
      { id: 4, denumire: 'Total conducte OL De 110', cantitate: 40, cantitate_plansa: 30, status: 'extras', diferenta_nota: 'VECHE 4' }]
    const r2 = await ruleaza10(ordine ? [...poz2].reverse() : poz2, { z1_1: { tronsoane: [mk('A', 'PE100', 500), mk('B', 'OL', 40)],
      tabele: [{ denumire: 'D', coloane: COLM10, randuri: [rr('1', 'A', 'PE100', '0,5'), rr('2', 'B', 'OL', '0,04')] }] } })
    const cum2 = `ADV11-2b, ordine ${ordine}`
    assertEquals(r2.j.cantitati.ambigue, [], cum2)
    assertEquals([r2.id(3).cantitate_plansa, r2.id(3).diferenta_nota, r2.id(4).cantitate_plansa, r2.id(4).diferenta_nota],
      [500, 'Planșa „PL1.1.pdf” confirmă: 500 m.', 40, 'Planșa „PL1.1.pdf” confirmă: 40 m.'], cum2)
    // grupul FĂRĂ material: orice poziție e compatibilă => subtotalul „Total conducte De 110” cedează poziției PE (ca în runda 9)
    const poz3 = [{ id: 3, denumire: 'Conductă PE Dn110', cantitate: 500, cantitate_plansa: 480, status: 'extras', diferenta_nota: 'VECHE 3' },
      { id: 4, denumire: 'Total conducte De 110', cantitate: 500, cantitate_plansa: 480, status: 'extras', diferenta_nota: 'VECHE 4' }]
    const r3 = await ruleaza10(ordine ? [...poz3].reverse() : poz3, feliiDn110(null))
    assertEquals([r3.id(3).cantitate_plansa, r3.id(4).cantitate_plansa, r3.id(4).status, r3.j.cantitati.ambigue], [500, 480, 'diferenta', []], `fără material, ordine ${ordine}`)
    assert(r3.id(4).diferenta_nota.startsWith(nota11), r3.id(4).diferenta_nota)
  }
})
Deno.test('runda 11 (MAJOR, ADV11-3 / 3r): subtotal Dn110 urmat de un număr care nu e Dn („, 20 tronsoane”, „și 32 branșamente”, „la 32 case”, „/ 16 bar”) rămâne subtotal: TOTAL-ul real confirmă 1.100, subtotalul primește nota; ambele ordini (85c53f1: subtotalul lua 1.100 sau ieșea din rețea, TOTAL-ul real TĂCUT la 1.000 „VECHE 6”)', async () => {
  const rd = (nr: string, dl: string, dn: string, L: string) => ({ 'Nr crt': nr, 'De la': dl, 'La': 'CT', 'Dn': dn, 'Material': 'PE100', 'L (km)': L })
  const tr = (dl: string, dn: number, L: number) => ({ de_la: dl, la: 'CT', lungime_m: L, diametru_mm: dn, material: 'PE100', sursa: 'tabel' })
  const felii = { z1_1: { tronsoane: [tr('A', 110, 900), tr('B', 63, 200)], tabele: [{ denumire: 'D', coloane: COLM10, randuri: [rd('1', 'A', '110', '0,9'), rd('2', 'B', '63', '0,2')] }] } }
  for (const den of ['Total conducte De 110, 20 tronsoane', 'Total conducte De 110 și 32 branșamente', 'Total conducte Dn110 la 32 case', 'Total conducte De 110 / 16 bar',
    'Total conducte De 110 la 20 bar', 'Total conducte De 110, 16 bar'])
    for (const ordine of [0, 1]) {
      const sub = { id: 4, denumire: den, cantitate: 900, cantitate_plansa: 850, status: ordine ? 'validat' : 'extras', diferenta_nota: 'VECHE 4' }
      const tot = { id: 6, denumire: 'TOTAL rețea distribuție', cantitate: 1100, cantitate_plansa: 1000, status: 'extras', diferenta_nota: 'VECHE 6' }
      const d110 = { id: 3, denumire: 'Țeavă PE100 Dn110', cantitate: 900, cantitate_plansa: null, status: 'extras' }
      const d63 = { id: 5, denumire: 'Țeavă PE100 Dn63', cantitate: 200, cantitate_plansa: null, status: 'extras' }
      const r = await ruleaza10(ordine ? [tot, d110, sub, d63] : [d110, sub, tot, d63], felii)
      const cum = `${den}, ordine ${ordine}`
      assertEquals([r.id(6).cantitate_plansa, r.id(6).diferenta_nota], [1100, 'Planșa „PL1.1.pdf” confirmă totalul: 1.100 m.'], cum)
      assertEquals([r.id(3).cantitate_plansa, r.id(5).cantitate_plansa, r.j.cantitati.adaugate, r.j.cantitati.ambigue], [900, 200, 0, []], cum)
      assertEquals([r.id(4).cantitate_plansa, r.id(4).status], [850, ordine ? 'validat' : 'diferenta'], cum)
      assert(r.id(4).diferenta_nota.startsWith(nota11), cum + ': ' + r.id(4).diferenta_nota)
    }
})
Deno.test('runda 11: subtotal = „total” ca PRIM cuvânt (după numerotare / „Cap.”, „Art.”, „Poz.”, „Pct.” ca prefix întreg) — „Conductă PE Dn110 (total)”, „Poziție total conductă PE Dn110” sunt poziții reale: lângă „Conductă OL Dn110”, grupul fără material e AMBIGUU vizibil, nimic scris', async () => {
  for (const den of ['Conductă PE Dn110 (total)', 'Poziție total conductă PE Dn110', 'Capac total conductă PE Dn110'])
    for (const ordine of [0, 1]) {
      const poz = [{ id: 3, denumire: den, cantitate: 500, cantitate_plansa: 480, status: 'extras', diferenta_nota: 'VECHE 3' },
        { id: 4, denumire: 'Conductă OL Dn110', cantitate: 500, cantitate_plansa: 20, status: 'extras', diferenta_nota: 'VECHE 4' }]
      const r = await ruleaza10(ordine ? [...poz].reverse() : poz, feliiDn110(null))
      const cum = `${den}, ordine ${ordine}`
      assertEquals(r.j.cantitati.ambigue.map((a: any) => [a.dn, a.material, a.metri, a.pozitii.map((p: any) => p.id).sort()]), [[110, null, 500, [3, 4]]], cum)
      assertEquals(r.ops.filter((o: any) => o.op === 'update').length, 0, cum)
      assertEquals([r.id(3).cantitate_plansa, r.id(4).cantitate_plansa, r.id(4).diferenta_nota], [480, 20, 'VECHE 4'], cum)
    }
})

// ---- 26.09.2026 — runda 12 (verificatorul rundei 11, ADV12): prin handler + RPC simulat. Pică pe 4c50dd2 (runda 11). ----
const felii12 = () => {
  const rd = (nr: string, dl: string, dn: string, L: string) => ({ 'Nr crt': nr, 'De la': dl, 'La': 'CT', 'Dn': dn, 'Material': 'PE100', 'L (km)': L })
  const tr = (dl: string, dn: number, L: number) => ({ de_la: dl, la: 'CT', lungime_m: L, diametru_mm: dn, material: 'PE100', sursa: 'tabel' })
  return { z1_1: { tronsoane: [tr('A', 110, 900), tr('B', 63, 200)], tabele: [{ denumire: 'D', coloane: COLM10, randuri: [rd('1', 'A', '110', '0,9'), rd('2', 'B', '63', '0,2')] }] } }
}
Deno.test('runda 12 (MAJOR, ADV12-1): TOTAL cu interval CRESCĂTOR urmat de alt cuvânt („PEHD”, „(PE)”, „pozate”, „conducte”) = TOTAL global: confirmă 1.100, Dn63 pe poziția lui sau inserat; extras / validat (4c50dd2: TOTAL rămânea 1.000 „neatribuit” sau primea 200 m „-900 m”, Dn63 neinserat)', async () => {
  for (const den of ['Total rețea De 63 - 110 PEHD', 'Total rețea De 63-110 (PE)', 'Total rețea De 63 ÷ 110 pozate subteran', 'Total conducte De 63 - 110 conducte PE'])
    for (const st of ['extras', 'validat']) {
      const tot = { id: 6, denumire: den, cantitate: 1100, cantitate_plansa: 1000, status: st, diferenta_nota: 'VECHE 6' }
      const d110 = { id: 3, denumire: 'Țeavă PE100 Dn110', cantitate: 900, cantitate_plansa: null, status: 'extras' }
      const d63 = { id: 5, denumire: 'Țeavă PE100 Dn63', cantitate: 200, cantitate_plansa: null, status: 'extras' }
      const cum = `${den}, ${st}`
      // (a) cu poziția Dn63
      const r = await ruleaza10([d110, tot, d63], felii12())
      assertEquals([r.id(6).cantitate_plansa, r.id(6).status, r.id(6).diferenta_nota], [1100, st, 'Planșa „PL1.1.pdf” confirmă totalul: 1.100 m.'], cum + ' (a)')
      assertEquals([r.id(3).cantitate_plansa, r.id(5).cantitate_plansa, r.j.cantitati.adaugate, r.j.cantitati.ambigue], [900, 200, 0, []], cum + ' (a)')
      // (b) fără poziția Dn63: se inserează, TOTAL-ul nu primește 200 m
      const r2 = await ruleaza10([d110, tot], felii12())
      assertEquals([r2.id(6).cantitate_plansa, r2.id(6).status, r2.id(6).diferenta_nota], [1100, st, 'Planșa „PL1.1.pdf” confirmă totalul: 1.100 m.'], cum + ' (b)')
      const n63 = r2.rows.find((q: any) => q.denumire === 'Conductă distribuție gaze PE Dn63')
      assertEquals([n63?.cantitate_plansa, r2.j.cantitati.adaugate, r2.j.cantitati.total_m], [200, 1, 1100], cum + ' (b)')
    }
})
Deno.test('runda 12 (MAJOR, ADV12-2): „total” NErecunoscut ca subtotal („A.1 Total …”, „Lot 1 - Total …”, „Tronson A: Total …”, „Lungime totală …”) lângă poziția reală fără material => AMBIGUU vizibil, nimic scris; niciodată poziția pe 480 „VECHE 3” fără notă; ambele ordini (4c50dd2: subtotalul lua 500 „confirmă”, poziția validată TĂCUT pe 480)', async () => {
  for (const den of ['A.1 Total conducte PE De 110', 'A.1. Total conducte PE De 110', 'Nr. 3 Total conducte PE De 110', 'Capitolul 2 - Total conducte PE De 110',
    'Lot 1 - Total conducte PE De 110', 'Obiect 2 Total conducte PE De 110', 'Tronson A: Total conducte PE De 110', 'Lungime totală conducte PE De 110'])
    for (const ordine of [0, 1]) {
      const poz = [{ id: 3, denumire: 'Conductă distribuție gaze Dn110', cantitate: 500, cantitate_plansa: 480, status: 'validat', diferenta_nota: 'VECHE 3' },
        { id: 4, denumire: den, cantitate: 500, cantitate_plansa: 480, status: 'extras', diferenta_nota: 'VECHE 4' }]
      const r = await ruleaza10(ordine ? [...poz].reverse() : poz, feliiDn110('PE100'))
      const cum = `${den}, ordine ${ordine}`
      const inAmbigue = r.j.cantitati.ambigue.some((a: any) => a.pozitii.some((p: any) => p.id === 3))
      assert(r.id(3).cantitate_plansa === 500 || inAmbigue, cum + ': poziția 3 tăcută')
      assertEquals(r.j.cantitati.ambigue.map((a: any) => [a.dn, a.material, a.metri, a.pozitii.map((p: any) => p.id).sort()]), [[110, 'PE', 500, [3, 4]]], cum)
      assertEquals([r.id(3).cantitate_plansa, r.id(4).cantitate_plansa, r.id(4).diferenta_nota, r.ops.filter((o: any) => o.op === 'update').length], [480, 480, 'VECHE 4', 0], cum)
    }
  // recunoscute ca subtotal (cifre romane de 3 litere, „Pct.”, „Poz.”, „Totaluri”): poziția reală ia cifra, subtotalul primește nota
  for (const den of ['III. Total conducte PE De 110', 'VIII) Total conducte PE De 110', 'aa) Total conducte PE De 110', 'Pct. 4 Total conducte PE De 110', 'Poz. 12 Total conducte PE De 110',
    'Totaluri conducte PE De 110'])
    for (const ordine of [0, 1]) {
      const poz = [{ id: 3, denumire: 'Conductă distribuție gaze Dn110', cantitate: 500, cantitate_plansa: 480, status: 'validat', diferenta_nota: 'VECHE 3' },
        { id: 4, denumire: den, cantitate: 500, cantitate_plansa: 480, status: 'extras', diferenta_nota: 'VECHE 4' }]
      const r = await ruleaza10(ordine ? [...poz].reverse() : poz, feliiDn110('PE100'))
      const cum = `${den}, ordine ${ordine}`
      assertEquals(r.j.cantitati.ambigue, [], cum)
      assertEquals([r.id(3).cantitate_plansa, r.id(3).status, r.id(3).diferenta_nota], [500, 'validat', 'Planșa „PL1.1.pdf” confirmă: 500 m.'], cum)
      assertEquals([r.id(4).cantitate_plansa, r.id(4).status], [480, 'diferenta'], cum)
      assert(r.id(4).diferenta_nota.startsWith(nota11), cum + ': ' + r.id(4).diferenta_nota)
    }
})
Deno.test('runda 12 (MAJOR, ADV12-2), calea „doar de verificat”: rândul Dn90 PE de verificat + „Conductă distribuție gaze Dn90” + „A.1 Total conducte PE De 90” => AMBIGUU, nimic scris pe niciuna; ambele ordini (4c50dd2: subtotalul golit / notat, poziția păstra 280 „VECHE 5”)', async () => {
  for (const ordine of [0, 1]) {
    const poz = [{ id: 5, denumire: 'Conductă distribuție gaze Dn90', cantitate: 300, cantitate_plansa: 280, status: 'extras', diferenta_nota: 'VECHE 5' },
      { id: 6, denumire: 'A.1 Total conducte PE De 90', cantitate: 300, cantitate_plansa: 280, status: 'extras', diferenta_nota: 'VECHE 6' }]
    const r = await ruleaza10(ordine ? [...poz].reverse() : poz,
      { z1_1: { tronsoane: [trT('A', 110, 500), trT('B', 90, 300)], tabele: [{ denumire: 'D', coloane: COLT, randuri: [rdT('1', 'A', '110', '0,5'), rdT('?', 'B', '90', '0,3')] }] } })
    const cum = `ordine ${ordine}`
    assertEquals(r.j.cantitati.ambigue.filter((a: any) => a.dn === 90).map((a: any) => [a.material, a.pozitii.map((p: any) => p.id).sort()]), [['PE', [5, 6]]], cum)
    assertEquals(r.ops.filter((o: any) => o.op === 'update' && (o.id === 5 || o.id === 6)), [], cum)
    assertEquals(r.j.cantitati.doar_de_verificat.map((d: any) => [d.dn, d.pozitie_id, d.actiune]), [[90, null, 'ambiguu']], cum)
  }
})
Deno.test('runda 12 (minor, ADV12-3): după „Poz.” / „Art.” / „Cap.” doar un token de numerotare — „Poz. conductă total PE Dn110” e poziție reală: lângă „Conductă OL Dn110”, grupul fără material e AMBIGUU, nimic scris (4c50dd2: 500 „confirmă” pe OL)', async () => {
  for (const den of ['Poz. conductă total PE Dn110', 'Art. racord total PE Dn110', 'Cap. conductă total OL Dn110'])
    for (const ordine of [0, 1]) {
      const poz = [{ id: 3, denumire: den, cantitate: 500, cantitate_plansa: 480, status: 'extras', diferenta_nota: 'VECHE 3' },
        { id: 4, denumire: 'Conductă OL Dn110', cantitate: 500, cantitate_plansa: 20, status: 'extras', diferenta_nota: 'VECHE 4' }]
      const r = await ruleaza10(ordine ? [...poz].reverse() : poz, feliiDn110(null))
      const cum = `${den}, ordine ${ordine}`
      assertEquals(r.j.cantitati.ambigue.map((a: any) => [a.dn, a.material, a.pozitii.map((p: any) => p.id).sort()]), [[110, null, [3, 4]]], cum)
      assertEquals([r.id(3).cantitate_plansa, r.id(4).cantitate_plansa, r.ops.filter((o: any) => o.op === 'update').length], [480, 20, 0], cum)
    }
})
Deno.test('runda 12 (minor, ADV12-4): compatibilitatea de material — grupul PE cu „Total conducte PE De 110” + „Conductă OL Dn110” + poziția fără material: cifra pe poziția fără material, subtotalul notă, OL neatins; grupul OL cu „Total conducte OL De 110” + PE + fără material: la fel (4c50dd2: AMBIGUU între poziția de alt material și cea fără material; mutația some→every: subtotalul lua cifra, poziția validată TĂCUT pe 30)', async () => {
  const mk = (dl: string, mat: string, L: number) => ({ de_la: dl, la: 'CT', lungime_m: L, diametru_mm: 110, material: mat, sursa: 'tabel' })
  const rr = (nr: string, dl: string, mat: string, L: string) => ({ 'Nr crt': nr, 'De la': dl, 'La': 'CT', 'Dn': '110', 'Material': mat, 'L (km)': L })
  const fOL = { z1_1: { tronsoane: [mk('A', 'OL', 40)], tabele: [{ denumire: 'D', coloane: COLM10, randuri: [rr('1', 'A', 'OL', '0,04')] }] } }
  const cazuri: [string, string, number, any][] = [['PE', 'Conductă OL Dn110', 500, feliiDn110('PE100')], ['OL', 'Conductă PE Dn110', 40, fOL]]
  for (const [mat, alta, m, f] of cazuri) for (const ordine of [0, 1]) {
    const poz = [{ id: 4, denumire: `Total conducte ${mat} De 110`, cantitate: m, cantitate_plansa: 30, status: 'extras', diferenta_nota: 'VECHE 4' },
      { id: 3, denumire: alta, cantitate: 70, cantitate_plansa: 70, status: 'extras', diferenta_nota: 'VECHE 3' },
      { id: 5, denumire: 'Conductă distribuție gaze Dn110', cantitate: m, cantitate_plansa: 30, status: 'validat', diferenta_nota: 'VECHE 5' }]
    const r = await ruleaza10(ordine ? [...poz].reverse() : poz, f)
    const cum = `grup ${mat}, ordine ${ordine}`
    assertEquals(r.j.cantitati.ambigue, [], cum)
    assertEquals([r.id(5).cantitate_plansa, r.id(5).status, r.id(5).diferenta_nota], [m, 'validat', `Planșa „PL1.1.pdf” confirmă: ${m} m.`], cum)
    assertEquals([r.id(3).cantitate_plansa, r.id(3).status, r.id(3).diferenta_nota], [70, 'extras', 'VECHE 3'], cum)
    assertEquals([r.id(4).cantitate_plansa, r.id(4).status], [30, 'diferenta'], cum)
    assert(r.id(4).diferenta_nota.startsWith(nota11), cum + ': ' + r.id(4).diferenta_nota)
  }
})
Deno.test('runda 12: fail-safe-ul privește doar rândurile cu „total” NErecunoscute ca subtotal — două subtotaluri recunoscute (PE și fără material), fără poziție reală: filtrul pe material departajează, subtotalul PE ia cifra, celălalt notă; ambele ordini', async () => {
  for (const ordine of [0, 1]) {
    const poz = [{ id: 4, denumire: 'Total conducte PE De 110', cantitate: 500, cantitate_plansa: 480, status: 'extras', diferenta_nota: 'VECHE 4' },
      { id: 5, denumire: 'Subtotal conducte De 110', cantitate: 500, cantitate_plansa: 480, status: 'extras', diferenta_nota: 'VECHE 5' }]
    const r = await ruleaza10(ordine ? [...poz].reverse() : poz, feliiDn110('PE100'))
    const cum = `ordine ${ordine}`
    assertEquals(r.j.cantitati.ambigue, [], cum)
    assertEquals([r.id(4).cantitate_plansa, r.id(4).diferenta_nota, r.id(5).cantitate_plansa, r.id(5).status], [500, 'Planșa „PL1.1.pdf” confirmă: 500 m.', 480, 'diferenta'], cum)
    assert(r.id(5).diferenta_nota.startsWith(nota11), cum + ': ' + r.id(5).diferenta_nota)
  }
})
