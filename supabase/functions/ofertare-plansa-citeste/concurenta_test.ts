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
  assertEquals([j.sumar.diametre_nestandard, j.sumar.nestandard_m], [[60], 110])
  assertEquals(j.cantitati.pe_diametre, { Dn200: 17785, Dn125: 2275, Dn110: 780, Dn90: 4545, Dn63: 9670, Dn40: 13740 })
  assertEquals([j.cantitati.adaugate, j.cantitati.actualizate], [0, 6], 'niciun rând nou; cele 6 existente primesc patch')
  assertEquals(n.inserts.filter((t: string) => t === 'ofertare_cantitati').length, 0)
  const rows = (await tabele.from('ofertare_cantitati').select()).data
  const r1756 = rows.find((x: any) => x.id === 1756)
  assertEquals([r1756.cantitate, r1756.cantitate_plansa, r1756.status], [13140, 13740, 'diferenta'], 'cantitate NEatinsă; doar cantitate_plansa + status')
  assert(r1756.diferenta_nota.startsWith('Memoriu 13.140 m vs planșa 1 13.740 m (+600 m, pe 56 tronsoane'), r1756.diferenta_nota)
  assert(r1756.diferenta_nota.endsWith('De verificat, NEincluse în cifra din planșă: pe planșă: Dn nestandard Dn60: 110 m.'), r1756.diferenta_nota)
  for (const [dn, id] of Object.entries(ids)) {
    if (dn === 'Dn40') continue
    const x = rows.find((y: any) => y.id === id)
    assertEquals([x.cantitate, x.cantitate_plansa, x.status], [AZI_470[dn], AZI_470[dn], 'extras'], dn)
    assert(x.diferenta_nota.startsWith('Planșa 1 confirmă:'), `${dn}: ${x.diferenta_nota}`)   // nota se rescrie (auto-„confirmare”)
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
    '1 rând Dn40 fără identitate sigură (250 m); 1 conflict Dn40 (până la 330 m); pe planșă: 1 rând de tabel fără identitate sigură (250 m); 1 conflict (același rând citit diferit: Nr 2 320 m Dn40 / 330 m Dn40).')
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
  assertEquals(id(1).diferenta_nota, 'De verificat: 2 rânduri Dn250 fără identitate sigură (10.350 m); cifra din planșă nu s-a actualizat (34.465 m e dintr-o citire anterioară).' + pe)
  // id 2 („extras”, nevalidată): cifra veche din planșă se golește, status „diferenta”
  assertEquals([id(2).cantitate, id(2).cantitate_plansa, id(2).status], [1100, null, 'diferenta'])
  assertEquals(id(2).diferenta_nota, 'De verificat: 1 rând Dn180 fără identitate sigură (600 m); cifra din planșă s-a golit (era 2.210 m, dintr-o citire anterioară).' + pe)
  // id 3 (sigur) și TOTAL: doar partea sigură, restul numit
  assertEquals([id(3).cantitate_plansa, id(3).status], [1740, 'validat'])
  assertEquals([id(4).cantitate_plansa, id(4).status], [1740, 'validat'])
  assert(id(4).diferenta_nota.endsWith('De verificat, NEincluse în cifra din planșă: pe planșă: 3 rânduri de tabel fără identitate sigură (10.950 m).'), id(4).diferenta_nota)
  assertEquals(j.cantitati.doar_de_verificat, [{ dn: 250, pozitie_id: 1, actiune: 'nota' }, { dn: 180, pozitie_id: 2, actiune: 'golit' }])
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
  assertEquals(id(1).diferenta_nota, 'De verificat: 1 rând Dn250 fără identitate sigură (5.550 m); 1 conflict Dn250 (până la 4.900 m); cifra din planșă s-a golit (era 34.465 m, dintr-o citire anterioară).' + pe)
  // TOTAL validat: nu primește 0 m; cifra veche e numită ca veche
  assertEquals([id(4).cantitate_plansa, id(4).status], [34465, 'validat'])
  assertEquals(id(4).diferenta_nota, 'De verificat: nicio lungime sigură cu Dn standard pe planșa „pl1.1.pdf”; cifra din planșă nu s-a actualizat (34.465 m e dintr-o citire anterioară).' + pe)
  assertEquals(j.cantitati.doar_de_verificat, [{ dn: 250, pozitie_id: 1, actiune: 'golit' }])
  assertEquals(n.rpc, 1, 'transferul rulează (a800d38: early-return, 0 scrieri, nota veche rămânea)')
})
