// deno test -A --node-modules-dir=none worker/ofertare/plansa_cli_lot_test.ts
// P1 #5: poarta pe loturi la pregătirea pachetului CLI și reverificarea dinaintea lansării (atestare pentru launcher).
import { deepStrictEqual as eq, ok, rejects } from 'node:assert/strict'
import { pregatestePlansa } from './plansa_cli_pregateste.ts'
import { FISIER_VERIFICARE, verificaPachet } from './plansa_cli_verifica.ts'
import { cuPoartaLot } from '../../supabase/functions/_test/poarta_lot.ts'

const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TAIAT = '2026-09-27T09:00:00.000Z'

function fixture(opt: { motive?: Record<number, string>; cade?: boolean } = {}) {
  const doc: any = { id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', fisier_path: '95/PL1.pdf',
    analiza: { plansa: { taiat_la: TAIAT, cale_felii: '95/470' } } }
  const tabele: Record<string, any[]> = { profiles: [{ id: OWNER, is_owner: true }], ofertare_documente_atribuire: [doc] }
  const n = { storage: 0 }
  const baza: any = {
    from: (t: string) => {
      let rows = tabele[t] || []
      const b: any = { select: () => b, eq: (c: string, v: unknown) => { rows = rows.filter((x) => x[c] === v); return b },
        maybeSingle: async () => ({ data: structuredClone(rows[0] || null), error: null }) }
      return b
    },
    rpc: async (name: string) => { throw new Error('RPC neașteptat: ' + name) },
    storage: { from: () => ({
      list: async () => { n.storage++; return { data: [{ name: 'z1_1.jpg' }, { name: 'z1_2.jpg' }], error: null } },
      download: async () => { n.storage++; return { data: new Blob([new Uint8Array([255, 216, 1, 255, 217])]), error: null } },
    }) },
  }
  const p = cuPoartaLot(baza, [470], { ...opt, motive: opt.motive ?? { 470: 'fara_loturi' } })   // CLI: doar fara_loturi (r2 P1 #6)
  return { doc, n, apeluri: p.apeluri, d: { supa: p.supa, SERVICE: 'service-test', operatorDeclarat: OWNER } }
}

const goala = async (dir: string) => { for await (const _ of Deno.readDir(dir)) return false; return true }

for (const motiv of ['de_triat', 'in_afara_loturilor', 'nicio_participare', 'loturi_neinitializate']) {
  Deno.test(`P1 #5 pregătire: document ${motiv} → refuz, zero storage, nimic exportat`, async () => {
    const dir = await Deno.makeTempDir({ prefix: 'lot-p15-' })
    try {
      const f = fixture({ motive: { 470: motiv } })
      await rejects(() => pregatestePlansa(470, dir, f.d), /Blocat pe loturi/)
      eq(f.n.storage, 0)
      ok(await goala(dir))
    } finally { await Deno.remove(dir, { recursive: true }) }
  })
}

Deno.test('P1 #5 pregătire: poarta cade → fail-closed, zero storage', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'lot-p15-' })
  try {
    const f = fixture({ cade: true })
    await rejects(() => pregatestePlansa(470, dir, f.d), /nu a răspuns/)
    eq(f.n.storage, 0); ok(await goala(dir))
  } finally { await Deno.remove(dir, { recursive: true }) }
})

Deno.test('P1 #5 pregătire: triajul se schimbă în timpul descărcării → nimic scris pe disc', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'lot-p15-' })
  try {
    const motive: Record<number, string> = { 470: 'fara_loturi' }
    const f = fixture({ motive })
    const { list, download } = f.d.supa.storage.from('ofertare')
    f.d.supa.storage = { from: () => ({ list,
      download: async (c: string) => { motive[470] = 'in_afara_loturilor'; return download(c) } }) }
    await rejects(() => pregatestePlansa(470, dir, f.d), /Blocat pe loturi: documentul e doar pe loturi/)
    ok(await goala(dir))
    eq(f.apeluri.length, 2) // înainte de descărcare + înainte de scriere
  } finally { await Deno.remove(dir, { recursive: true }) }
})

Deno.test('P1 #5 verificare: eligibil → atestare legată de pachet_id; apoi neeligibil → atestarea dispare, cod de eroare', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'lot-p15-' })
  try {
    const motive: Record<number, string> = { 470: 'fara_loturi' }
    const f = fixture({ motive })
    const m = await pregatestePlansa(470, `${dir}/pachet`, f.d)
    const v = await verificaPachet(`${dir}/pachet`, f.d, () => new Date('2026-10-12T10:00:00.000Z'))
    const scris = JSON.parse(await Deno.readTextFile(`${dir}/pachet/${FISIER_VERIFICARE}`))
    eq(scris, v)
    eq(scris, { doc_id: 470, licitatie_id: 95, pachet_id: m.pachet_id, eligibil: true, motiv: 'fara_loturi', verificat_la: '2026-10-12T10:00:00.000Z' })
    motive[470] = 'de_triat'
    await rejects(() => verificaPachet(`${dir}/pachet`, f.d), /Blocat pe loturi/)
    await rejects(() => Deno.stat(`${dir}/pachet/${FISIER_VERIFICARE}`), Deno.errors.NotFound)
  } finally { await Deno.remove(dir, { recursive: true }) }
})

Deno.test('P1 #5 verificare: poarta cade / document retăiat → fără atestare', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'lot-p15-' })
  try {
    const f = fixture()
    await pregatestePlansa(470, `${dir}/pachet`, f.d)
    await verificaPachet(`${dir}/pachet`, f.d)
    const cazut = fixture({ cade: true })
    await rejects(() => verificaPachet(`${dir}/pachet`, cazut.d), /nu a răspuns/)
    await rejects(() => Deno.stat(`${dir}/pachet/${FISIER_VERIFICARE}`), Deno.errors.NotFound)
    const retaiat = fixture(); retaiat.doc.analiza.plansa.taiat_la = '2026-10-01T00:00:00.000Z'
    await rejects(() => verificaPachet(`${dir}/pachet`, retaiat.d), /diferă de manifest/)
    await rejects(() => Deno.stat(`${dir}/pachet/${FISIER_VERIFICARE}`), Deno.errors.NotFound)
    eq(retaiat.apeluri.length, 0) // identitatea se verifică înaintea porții
  } finally { await Deno.remove(dir, { recursive: true }) }
})

// review Jakarinos r2 P1 #6 (provizoriu): pe licitațiile cu loturi calea CLI e închisă — debifarea unui lot în fereastra
// atestării n-ar fi prinsă; acolo planșa se citește pe calea API / NAS (reverificare la fiecare rundă)
for (const motiv of ['comun', 'lot_participam']) {
  Deno.test(`r2 P1 #6: document eligibil pe licitație cu loturi (${motiv}) → CLI refuzat, zero storage`, async () => {
    const dir = await Deno.makeTempDir({ prefix: 'lot-p16-' })
    try {
      const f = fixture({ motive: { 470: motiv } })
      await rejects(() => pregatestePlansa(470, dir, f.d), /doar pentru licitații fără loturi/)
      eq(f.n.storage, 0); ok(await goala(dir))
    } finally { await Deno.remove(dir, { recursive: true }) }
  })
}