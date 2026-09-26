// deno test --node-modules-dir=none --no-lock -A supabase/functions/ofertare-clarificari-propune/core_test.ts
// R5 (Copilot 25.09.2026): cantitățile nevalidate nu pleacă spre model ca valori „din listă" / aprobate.
// Fixture = rândul REAL 1751 al lic. 95 (SELECT pe ofertare_cantitati, 25.09.2026).
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1'
import { propuneClarificari, randCantitatePentruAI } from './core.ts'

const R1751 = { id: 1751, licitatie_id: 95, obiect: null, categorie: 'Conducte și montaj', denumire: 'Conductă distribuție gaze Dn200', um: 'm',
  cantitate: 17785, cantitate_plansa: 17785, status: 'extras', tip_sursa: null,
  sursa: 'Planșa 1 — tabel de dimensionare, citit automat din scanare',
  diferenta_nota: 'Diametru care nu apare în cantitățile din memoriu. 8 tronsoane citite din tabelul planșei.' }

Deno.test('R5: rândul 1751 (extras din planșă) nu mai pleacă drept „lista", ci cu proveniența și status_validat=false', () => {
  const x = randCantitatePentruAI(R1751)
  assertEquals(x.cantitate, 17785)
  assertEquals(x.sursa_cantitate, 'planșă (citire automată; cifra planșei copiată în cantitate)')
  assertEquals(x.status_validat, false)
  assertFalse('validat_de_om' in x, 'runda 4: numele vechi (înșelător — „validat” n-are autor) nu mai pleacă')
  assertEquals(x.status, 'extras')
  assertFalse('lista' in x, 'cheia „lista" dispare: cifra nu vine din F3')
})

Deno.test('R5: un rând F3 marcat validat în platformă e etichetat ca atare (status_validat, nu „validat de om”)', () => {
  const x = randCantitatePentruAI({ ...R1751, id: 1, tip_sursa: 'lista_f3', status: 'validat', sursa: 'F3 obiect 1' })
  assertEquals(x.sursa_cantitate, 'lista de cantități F3')
  assertEquals(x.status_validat, true)
})

Deno.test('R5: diferenta / revizuit_clarificare / status lipsă = NU marcat validat', () => {
  for (const s of ['diferenta', 'revizuit_clarificare', undefined]) assertEquals(randCantitatePentruAI({ ...R1751, status: s }).status_validat, false)
  assertEquals(randCantitatePentruAI({ ...R1751, sursa: 'memoriu, pag. 3' }).sursa_cantitate, 'nedeclarată')
})

// capăt-la-capăt, fără rețea: supabase simulat + fetch simulat care prinde promptul trimis la model (dry_run: nu scrie nimic)
function supaFals(tabele: Record<string, any[]>) {
  const selecturi: Record<string, string> = {}
  return {
    selecturi,
    from(t: string) {
      let lim = Infinity, cuCount = false
      const b: any = {
        select: (s: string, o?: any) => { selecturi[t] = s; cuCount = !!o?.count; return b },
        eq: () => b, neq: () => b, is: () => b, not: () => b, in: () => b, order: () => b, limit: (n: number) => { lim = n; return b },
        single: () => Promise.resolve({ data: (tabele[t] || [])[0] ?? null, error: null }),
        maybeSingle: () => Promise.resolve({ data: (tabele[t] || [])[0] ?? null, error: null }),
        insert: () => Promise.resolve({ data: null, error: null }),
        upsert: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
        then: (ok: any, ko: any) => Promise.resolve({ data: (tabele[t] || []).slice(0, lim), error: null, ...(cuCount ? { count: (tabele[t] || []).length } : {}) }).then(ok, ko),
      }
      return b
    },
  }
}

Deno.test('R5 capăt-la-capăt: select-ul citește status, iar promptul nu mai conține „lista":17785', async () => {
  const supa = supaFals({
    ofertare_licitatii: [{ id: 95, nr_anunt: 'CN1096479', autoritate: 'Comuna Vâlcelele', obiect: 'rețea gaze' }],
    ofertare_cerinte: [{ id: 1, tip: 'propunere', text_cerinta: 'Lungimea rețelei conform planșelor' }],
    ofertare_acoperire: [], ofertare_cantitati: [R1751], ofertare_verificari: [], ofertare_documente_atribuire: [], ofertare_clarificari: [],
  })
  let corp = ''
  const fetchVechi = globalThis.fetch
  globalThis.fetch = ((_u: unknown, init?: RequestInit) => {
    corp = String(init?.body || '')
    return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: '{"clarificari":[]}' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }))
  }) as typeof fetch
  try {
    const r = await propuneClarificari(supa, { licitatie_id: 95, dry_run: true })
    assert(r.ok, JSON.stringify(r))
  } finally { globalThis.fetch = fetchVechi }
  assert(/\bstatus\b/.test(supa.selecturi.ofertare_cantitati), 'select-ul pe ofertare_cantitati include status')
  const mesaj = JSON.parse(corp).messages[0].content as string
  assert(mesaj.includes('"status_validat":false'), 'modelul vede că 1751 e nevalidat')
  assertFalse(mesaj.includes('validat_de_om'), 'runda 4: niciun „validat_de_om” în payload')
  assert(mesaj.includes('"sursa_cantitate":"planșă (citire automată'), 'modelul vede proveniența din planșă')
  assertFalse(mesaj.includes('"lista":17785'), 'nicio cifră din planșă etichetată „lista"')
  const sistem = JSON.parse(corp).system[0].text as string
  assert(sistem.includes('status_validat: false'), 'promptul explică regula')
  assert(sistem.includes('MARCAT VALIDAT ÎN PLATFORMĂ') && sistem.includes('nu dovedește singur că un om a verificat'), 'runda 4: „validat” = marcaj în platformă, nu dovadă de om')
  assertFalse(sistem.includes('validat_de_om'))
})

// R5 condiția 2 (26.09.2026): limita de 40 de rânduri nu mai taie TACIT
Deno.test('R5 condiția 2: 45 de rânduri cu diferențe => promptul spune „40 din 45 — LISTA E TRUNCHIATĂ”; sub limită, nimic în plus', async () => {
  const rulare = async (n: number) => {
    const supa = supaFals({
      ofertare_licitatii: [{ id: 95, nr_anunt: 'CN1096479', autoritate: 'Comuna Vâlcelele', obiect: 'rețea gaze' }],
      ofertare_cerinte: [{ id: 1, tip: 'propunere', text_cerinta: 'Lungimea rețelei conform planșelor' }],
      ofertare_acoperire: [], ofertare_cantitati: Array.from({ length: n }, (_, i) => ({ ...R1751, id: 1751 + i })), ofertare_verificari: [], ofertare_documente_atribuire: [], ofertare_clarificari: [],
    })
    let corp = ''
    const fetchVechi = globalThis.fetch
    globalThis.fetch = ((_u: unknown, init?: RequestInit) => {
      corp = String(init?.body || '')
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: '{"clarificari":[]}' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }))
    }) as typeof fetch
    try { await propuneClarificari(supa, { licitatie_id: 95, dry_run: true }) } finally { globalThis.fetch = fetchVechi }
    return JSON.parse(corp).messages[0].content as string
  }
  const m45 = await rulare(45)
  assert(m45.includes('DIFERENȚE CANTITĂȚI / PLANȘE / DEVIZE (40 din 45 — LISTA E TRUNCHIATĂ: 5 rânduri cu diferențe NU sunt aici'), m45.slice(m45.indexOf('DIFERENȚE'), m45.indexOf('DIFERENȚE') + 160))
  const m3 = await rulare(3)
  assert(m3.includes('DIFERENȚE CANTITĂȚI / PLANȘE / DEVIZE (3; status_validat'), 'sub limită: fără mențiune')
})
