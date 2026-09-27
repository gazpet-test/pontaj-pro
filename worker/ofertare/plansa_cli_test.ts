// deno test -A --node-modules-dir=none worker/ofertare/plansa_cli_test.ts
import { deepStrictEqual as eq, ok, rejects } from 'node:assert/strict'
import { handler, INSTRUCTIUNI, INSTRUCTIUNI_LIPIRE } from '../../supabase/functions/ofertare-plansa-citeste/handler.ts'
import { pregatestePlansa } from './plansa_cli_pregateste.ts'
import { fetchDinCli, importaPlansa } from './plansa_cli_importa.ts'
import { perechiPosibile, sha256, type Manifest, type RezultatCli } from './plansa_cli_comun.ts'

const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TAIAT = '2026-09-27T09:00:00.000Z'
const RASPUNS = JSON.stringify({ cartus: { titlu: 'Test' }, tabele: [], tronsoane: [], alte_mentiuni: [] })

// Simulare locală cu CAS real în memorie. Niciun client nu atinge rețeaua.
function fixture(nr = 2, owner = true) {
  const doc: any = { id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', fisier_path: '95/PL1.pdf',
    analiza: { plansa: { taiat_la: TAIAT, cale_felii: '95/470', acoperire_demonstrata: true,
      zone_asteptate: Array.from({ length: nr }, (_, i) => `1_${i + 1}`) } } }
  const tabele: Record<string, any[]> = { profiles: [{ id: OWNER, is_owner: owner }], ofertare_documente_atribuire: [doc] }
  const imagini = new Map(Array.from({ length: nr }, (_, i) => [`z1_${i + 1}.jpg`, new Uint8Array([255, 216, i + 1, 255, 217])]))
  const n = { scrieri: 0, storage: 0, rpc: [] as string[] }
  const supa: any = {
    from: (t: string) => {
      ok(!/ofertare_plansa_(coada|buget)/.test(t), 'D4 nu folosește coada sau bugetul')
      let rows = tabele[t] || [], insert: any
      const b: any = {
        select: () => b, order: () => b, range: () => b, limit: () => b,
        eq: (c: string, v: unknown) => { rows = rows.filter(x => x[c] === v); return b },
        in: (c: string, vs: unknown[]) => { rows = rows.filter(x => vs.includes(x[c])); return b },
        insert: (r: any) => { insert = r; return b },
        maybeSingle: async () => ({ data: structuredClone(rows[0] || null), error: null }),
        then: (resolve: any, reject: any) => {
          if (insert) { n.scrieri++; (tabele[t] ||= []).push(structuredClone(insert)) }
          return Promise.resolve({ data: structuredClone(rows), error: null }).then(resolve, reject)
        },
      }
      return b
    },
    rpc: async (name: string, a: any) => {
      n.rpc.push(name)
      if (name === 'ofertare_plansa_analiza_cas') {
        if (JSON.stringify(doc.analiza) !== JSON.stringify(a.p_analiza_veche)) return { data: false, error: null }
        n.scrieri++; Object.assign(doc, structuredClone(a.p_patch)); return { data: true, error: null }
      }
      eq(name, 'ofertare_clarificare_planse_auto')
      n.scrieri++; return { data: null, error: null }
    },
    storage: { from: (bucket: string) => {
      eq(bucket, 'ofertare')
      return {
        list: async () => { n.storage++; return { data: [...imagini.keys()].map(name => ({ name })), error: null } },
        download: async (cale: string) => {
          n.storage++; const bytes = imagini.get(cale.split('/').pop()!)
          return { data: bytes ? new Blob([bytes]) : null, error: bytes ? null : { message: 'Lipsește' } }
        },
      }
    } },
  }
  return { doc, tabele, imagini, n, d: { supa, SERVICE: 'service-test', cerutDe: OWNER } }
}

async function cuPachet(fn: (f: ReturnType<typeof fixture>, dir: string, m: Manifest, r: RezultatCli, fisier: string) => Promise<void>, nr = 2) {
  const dir = await Deno.makeTempDir({ prefix: 'jak-d4-' })
  try {
    const f = fixture(nr), m = await pregatestePlansa(470, dir, f.d)
    const r: RezultatCli = { doc_id: m.doc_id, taiat_la: m.taiat_la,
      felii: Object.fromEntries(m.felii.map(x => [x.eticheta, { sha256: x.sha256, text: RASPUNS }])),
      lipiri: Object.fromEntries(m.perechi_lipire.map(p => [p.join('+'), { text: '{"randuri":[]}' }])) }
    const fisier = `${dir}/rezultat.json`
    await Deno.writeTextFile(fisier, JSON.stringify(r))
    f.n.storage = 0
    await fn(f, dir, m, r, fisier)
  } finally { await Deno.remove(dir, { recursive: true }) }
}
const cerere = (images: Uint8Array[], text = '') => ({ method: 'POST', body: JSON.stringify({
  messages: [{ role: 'user', content: [...images.map(bytes => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: btoa(String.fromCharCode(...bytes)) } })), { type: 'text', text }] }],
}) })
const API = 'https://api.anthropic.com/v1/messages'

Deno.test('D4: pregătirea exportă prompturile exacte, hashurile și perechile orizontale', () => cuPachet(async (f, dir, m) => {
  eq(await Deno.readTextFile(`${dir}/INSTRUCTIUNI.md`), INSTRUCTIUNI + '\n')
  eq(await Deno.readTextFile(`${dir}/INSTRUCTIUNI_LIPIRE.md`), INSTRUCTIUNI_LIPIRE + '\n')
  eq(m.perechi_lipire, [['z1_1', 'z1_2']])
  eq(perechiPosibile(['r1c1', 'r1c2', 'r2c2']), [['r1c1', 'r1c2']])
  for (const x of m.felii) eq(x.sha256, await sha256(await Deno.readFile(`${dir}/${x.fisier}`)))
  eq(f.n.scrieri, 0)
}))

Deno.test('D4: fetchDinCli nu face rețea; imagini/perechi după hash, URL necunoscut refuzat', () => cuPachet(async (f, _dir, m, r) => {
  const real = globalThis.fetch
  globalThis.fetch = () => { throw new Error('REȚEA INTERZISĂ ÎN TEST') }
  try {
    const adapt = fetchDinCli(m, r), [a, b] = [...f.imagini.values()]
    const one = await adapt(API, cerere([a])); eq(one.status, 200)
    eq(await one.json(), { content: [{ type: 'text', text: RASPUNS }], usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: 'end_turn' })
    const pair = await adapt(new Request(API, cerere([a, b]))); eq(pair.status, 200)
    eq((await pair.json()).content[0].text, '{"randuri":[]}')
    eq((await adapt(API, cerere([b, a]))).status, 422)
    eq((await adapt(API, cerere([new Uint8Array([0])]))).status, 422)
    for (const url of ['https://example.com', 'https://api.anthropic.com.evil/v1/messages', 'http://api.anthropic.com/v1/messages', 'https://api.anthropic.com/v1/messages?x=1'])
      await rejects(() => adapt(url, cerere([a])), /URL nepermis/)
  } finally { globalThis.fetch = real }
}))

for (const defect of ['sha_cli', 'sha_local', 'sha_storage', 'taiat_bd', 'taiat_cli', 'doc_id', 'fisier_path', 'cale_felii', 'lista', 'prompt']) {
  Deno.test(`D4: ${defect} diferit → import oprit, zero scrieri`, () => cuPachet(async (f, dir, _m, r, fisier) => {
    if (defect === 'sha_cli') r.felii.z1_1.sha256 = '0'.repeat(64)
    if (defect === 'sha_local') await Deno.writeFile(`${dir}/felii/z1_1.jpg`, new Uint8Array([0]))
    if (defect === 'sha_storage') f.imagini.set('z1_1.jpg', new Uint8Array([0]))
    if (defect === 'taiat_bd') f.doc.analiza.plansa.taiat_la = 'alta-taiere'
    if (defect === 'taiat_cli') r.taiat_la = 'alta-taiere'
    if (defect === 'doc_id') r.doc_id = 471
    if (defect === 'fisier_path') f.doc.fisier_path = 'alt.pdf'
    if (defect === 'cale_felii') f.doc.analiza.plansa.cale_felii = 'alta/cale'
    if (defect === 'lista') f.imagini.delete('z1_2.jpg')
    if (defect === 'prompt') await Deno.writeTextFile(`${dir}/INSTRUCTIUNI.md`, 'alt prompt')
    await Deno.writeTextFile(fisier, JSON.stringify(r))
    await rejects(() => importaPlansa(fisier, dir, f.d))
    eq(f.n.scrieri, 0)
  }))
}

Deno.test('D4: felie lipsă → eroare reluabilă; restul persistă cu cli:opus și cost zero', () => cuPachet(async (f, dir, _m, r, fisier) => {
  delete r.felii.z1_2
  await Deno.writeTextFile(fisier, JSON.stringify(r))
  const result = await importaPlansa(fisier, dir, f.d)
  const ca = f.doc.analiza.citire_ai
  eq(ca.model, 'cli:opus'); eq(ca.versiune.model, 'cli:opus'); eq(ca.felii.length, 2)
  ok(!ca.felii[0].eroare); ok(ca.felii[1].eroare.includes('CLI negăsit')); eq(ca.felii[1]._coduri, [422])
  eq(f.doc.status_procesare, 'partial'); eq(ca.sumar.erori, 1); eq(result.cost_usd, 0)
  for (const row of f.tabele.ai_usage_log) eq([row.tokens_in, row.tokens_out, row.cost_usd], [0, 0, 0])
}))

Deno.test('D4: importul parcurge mai mult de 4 felii, fără cheie AI sau rețea din adaptor', () => cuPachet(async (f, dir, _m, _r, fisier) => {
  const real = globalThis.fetch
  globalThis.fetch = () => { throw new Error('REȚEA INTERZISĂ ÎN TEST') }
  try {
    const result = await importaPlansa(fisier, dir, f.d)
    eq(result.runde.map(x => x.citite_acum), [4, 2]); eq(f.doc.analiza.citire_ai.felii.length, 6)
    eq(f.doc.analiza.citire_ai.gata, true); eq(f.doc.analiza.citire_ai.model, 'cli:opus')
  } finally { globalThis.fetch = real }
}, 6))

Deno.test('D4: o comandă nouă reia numai eroarea CLI completată între timp', () => cuPachet(async (f, dir, _m, r, fisier) => {
  const salvat = r.felii.z1_2
  delete r.felii.z1_2; await Deno.writeTextFile(fisier, JSON.stringify(r))
  await importaPlansa(fisier, dir, f.d)
  r.felii.z1_2 = salvat; await Deno.writeTextFile(fisier, JSON.stringify(r))
  const result = await importaPlansa(fisier, dir, f.d)
  eq(result.runde.map(x => x.citite_acum), [0, 1]); eq(f.doc.analiza.citire_ai.sumar.erori, 0)
}))

Deno.test('D4: lipirile sunt importate prin același handler, după citirea feliilor', () => cuPachet(async (f, dir, _m, r, fisier) => {
  r.felii.z1_1.text = JSON.stringify({ alte_mentiuni: ['Lungimea totală este ...'] })
  r.lipiri['z1_1+z1_2'].text = JSON.stringify({ randuri: [{ text: 'Lungimea totală este de 123 m', lungime_m: 123 }] })
  await Deno.writeTextFile(fisier, JSON.stringify(r))
  const result = await importaPlansa(fisier, dir, f.d)
  eq(result.runde.at(-1).perechi, 1); eq(f.doc.analiza.citire_ai.sumar.lungime_declarata_m, 123)
  eq(f.doc.analiza.citire_ai.note_lipite_perechi, ['z1_1+z1_2'])
}))

Deno.test('D4: modelEticheta absent păstrează modelul API; importul peste API → 409, zero scrieri noi', () => cuPachet(async (f, dir, _m, _r, fisier) => {
  const req = new Request('http://local', { method: 'POST', headers: { Authorization: 'Bearer service-test' }, body: JSON.stringify({ doc_id: 470 }) })
  const res = await handler(req, { ...f.d, supa: f.d.supa, API_KEY: 'test-api', getUser: async () => null,
    fetch: async () => Response.json({ content: [{ type: 'text', text: RASPUNS }], usage: { input_tokens: 0, output_tokens: 0 } }) })
  eq(res.status, 200); eq(f.doc.analiza.citire_ai.model, 'claude-opus-5'); eq(f.doc.analiza.citire_ai.versiune.model, 'claude-opus-5')
  const before = structuredClone(f.doc), writes = f.n.scrieri
  await rejects(() => importaPlansa(fisier, dir, f.d), /HTTP 409.*altă versiune/)
  eq(f.n.scrieri, writes); eq(f.doc, before)
}))

Deno.test('D4: lipire lipsă nu este marcată făcută; pachetul completat poate fi reluat', () => cuPachet(async (f, dir, _m, r, fisier) => {
  r.felii.z1_1.text = JSON.stringify({ alte_mentiuni: ['Lungimea totală este ...'] })
  delete r.lipiri['z1_1+z1_2']
  await Deno.writeTextFile(fisier, JSON.stringify(r))
  await rejects(() => importaPlansa(fisier, dir, f.d), /lipsesc 1 răspunsuri de lipire/)
  eq(f.doc.analiza.citire_ai.felii.length, 2)
  eq(f.doc.analiza.citire_ai.note_lipite_perechi, undefined)
  r.lipiri['z1_1+z1_2'] = { text: '{"randuri":[]}' }
  await Deno.writeTextFile(fisier, JSON.stringify(r))
  await importaPlansa(fisier, dir, f.d)
  eq(f.doc.analiza.citire_ai.note_lipite_perechi, ['z1_1+z1_2'])
}))

Deno.test('D4: lipire cu JSON invalid → refuz înainte de orice scriere', () => cuPachet(async (f, dir, _m, r, fisier) => {
  r.lipiri['z1_1+z1_2'].text = 'răspuns trunchiat'
  await Deno.writeTextFile(fisier, JSON.stringify(r))
  await rejects(() => importaPlansa(fisier, dir, f.d), /Lipire CLI cu JSON invalid/)
  eq(f.n.scrieri, 0)
}))

Deno.test('D4: citirea API apărută la CAS înainte de lipire nu primește note CLI', () => cuPachet(async (f, dir, _m, r, fisier) => {
  r.felii.z1_1.text = JSON.stringify({ alte_mentiuni: ['Lungimea totală este ...'] })
  await Deno.writeTextFile(fisier, JSON.stringify(r))
  const rpc = f.d.supa.rpc
  let conflict = false
  f.d.supa.rpc = (name: string, args: any) => {
    const zone = Object.keys(args?.p_patch?.analiza?.rezervari_zone?.zone || {})
    if (!conflict && zone.some(z => z.startsWith('lipire:'))) {
      conflict = true
      f.doc.analiza.citire_ai.model = 'claude-opus-5'
      f.doc.analiza.citire_ai.versiune.model = 'claude-opus-5'
      return Promise.resolve({ data: false, error: null })
    }
    return rpc(name, args)
  }
  await rejects(() => importaPlansa(fisier, dir, f.d), /Versiune incompatibilă/)
  eq(conflict, true)
  eq(f.doc.analiza.citire_ai.note_lipite_perechi, undefined)
  eq(f.doc.analiza.citire_ai.model, 'claude-opus-5')
}))

Deno.test('D4: non-owner / CERUT_DE invalid → refuz la pregătire și import, fără storage sau scrieri', async () => {
  const f = fixture(2, false)
  for (const cerutDe of [OWNER, '', 'u-owner']) {
    const d = { ...f.d, cerutDe }
    await rejects(() => pregatestePlansa(470, 'nu-trebuie-creat', d), /owner|UUID/)
    await rejects(() => importaPlansa('nu-exista', 'nu-exista', d), /owner|UUID/)
  }
  eq(f.n.storage, 0); eq(f.n.scrieri, 0)
})

Deno.test('D4: SHA identic în două zone nu ascunde rezultatul absent al uneia', () => cuPachet(async (f, _dir, m, r) => {
  m.felii[1].sha256 = m.felii[0].sha256; delete r.felii.z1_2
  const adapt = fetchDinCli(m, r), image = f.imagini.get('z1_1.jpg')!
  eq((await adapt(API, cerere([image], 'Bucata z1_2 din plansa. Extrage ce se vede.'))).status, 422)
  eq((await adapt(API, cerere([image], 'Bucata z1_1 din plansa. Extrage ce se vede.'))).status, 200)
}))
