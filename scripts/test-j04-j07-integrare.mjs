// J04 × J07 — paritatea UI ↔ server după merge (fără dependențe; node --test scripts/test-j04-j07-integrare.mjs).
// Serverul impune ambele verificări la tranziție (vezi scripts/pg/test_j04_j07_integrare.mjs); aici verificăm că UI-ul
// le CERE pe amândouă înainte de stare='depus', că nu are fallback permisiv și că ordinea migrărilor e cea din plan.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { citestePoartaServer, randPoartaServer } from '../src/ofertarePoartaServer.js'

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const ui = read('src/OfertarePropunere.jsx')
const felie = (start, end) => {
  const a = ui.indexOf(start), b = ui.indexOf(end, a)
  assert.ok(a > 0 && b > a, `nu găsesc ${start}`)
  return ui.slice(a, b)
}
const ordine = (text, ...ace) => {
  let last = -1
  for (const ac of ace) {
    const i = text.indexOf(ac, last + 1)
    assert.ok(i > last, `ordinea: „${ac}” trebuie să apară după pasul anterior`)
    last = i
  }
}

test('Marchează depus: manifest → J04 (hash server) → J07 (text recalculat + poartă) → gărzi → abia apoi stare=depus', () => {
  const d = felie('const inregistreazaDepunere =', 'const atribuie =')
  ordine(d,
    "from('ofertare_pt_pachet_fisiere').insert(row)",
    "invoke('ofertare-pachet-verifica'",
    'citestePoartaServer(supabase, licId, { recalculeazaText: true })',
    'verificare?.ok !== true',
    "poarta.poarta_server?.stare !== 'ok'",
    'if (motive.length) throw',
    "update({ stare: 'depus' })")
  assert.equal(d.split("update({ stare: 'depus' })").length, 2, 'o singură tranziție depus')
  assert.equal(d.split("invoke('ofertare-pachet-verifica'").length, 2)
  // Fără fallback permisiv: nicio ramură nu ajunge la update dacă una dintre verificări lipsește.
  assert.doesNotMatch(d, /poarta_server\?\.stare\s*===\s*'block'/)
  assert.doesNotMatch(d, /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/)
})

test('Aprobă pachet: manifest → J07 (text recalculat + poartă) → abia apoi stare=aprobat', () => {
  const a = felie('const aprobaPachet =', 'const inregistreazaDepunere =')
  ordine(a,
    "from('ofertare_pt_pachet_fisiere').insert(manifest",
    'citestePoartaServer(supabase, licId, { recalculeazaText: true })',
    "verificare.poarta_server?.stare !== 'ok'",
    "update({ stare: 'aprobat'")
})

test('citestePoartaServer: orice eroare ⇒ fără verdict ⇒ rândul serverului BLOCK (fail-closed)', async () => {
  const ok = { stare: 'ok', blocaje: [], controale: ['cuprins', 'neverificate', 'capcane', 'goale', 'nescrise', 'cantitati_f3_grafic',
    'garantie', 'anexe', 'numere', 'pachet', 'grafic_relatii', 'grafic_sursa'].map(control_code => ({ control_code, stare: 'ok' })) }
  const client = ({ invoke = async () => ({ data: { rezultate: [] } }), rpc = async () => ({ data: ok }) } = {}) =>
    ({ functions: { invoke }, rpc })
  const cazuri = [
    ['edge text indisponibil', client({ invoke: async () => ({ error: { message: 'FunctionsHttpError' } }) })],
    ['edge text 409 (sursă / parser)', client({ invoke: async () => ({ data: { error: 'Sursa indisponibilă' } }) })],
    ['RPC poartă eroare', client({ rpc: async () => ({ error: { message: 'permission denied' } }) })],
    ['RPC aruncă', client({ rpc: async () => { throw new Error('rețea') } })],
    ['verdict incomplet (11 controale)', client({ rpc: async () => ({ data: { ...ok, controale: ok.controale.slice(1) } }) })],
  ]
  for (const [eticheta, c] of cazuri) {
    const r = await citestePoartaServer(c, 1, { recalculeazaText: true })
    assert.equal(randPoartaServer(r).stare, 'block', eticheta)
    if (eticheta !== 'verdict incomplet (11 controale)') assert.notEqual(r.poarta_server?.stare, 'ok', eticheta)
  }
  const bun = await citestePoartaServer(client(), 1, { recalculeazaText: true })
  assert.equal(bun.poarta_server.stare, 'ok'); assert.equal(randPoartaServer(bun).stare, 'ok')
})

test('ordinea migrărilor: J04 (20260930a) înaintea J07 (20261003a); fără coliziune de prefix; funcții disjuncte', () => {
  const toate = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()
  const i04 = toate.indexOf('20260930a_ofertare_pachet_hash_server_jakv202.sql')
  const i07 = toate.indexOf('20261003a_ofertare_poarta_server_jakv2p3.sql')
  assert.ok(i04 >= 0 && i07 > i04)
  // Excepții cunoscute (03.10.2026): migrări care au luat același prefix DUPĂ J04/J07 și sunt deja APLICATE în producție
  // prin runner, cu versiune explicită (supabase_migrations.schema_migrations) — nu se mai pot redenumi. Runner-ul
  // ordonează după versiunea de 14 cifre, nu după prefixul fișierului, deci nu concurează cu J04/J07 la livrare.
  // Orice coliziune NOUĂ pe aceste prefixe pică în continuare testul.
  const aplicateCuAcelasiPrefix = new Map([
    ['20260930a_profiles_campuri_owner_only_extins.sql', '20261001178000'],
    ['20260930a_profiles_campuri_owner_only_extins_ROLLBACK.sql', null],
    ['20261003a_garantii_bilete_ordin.sql', '20261002191500'],
  ])
  for (const prefix of ['20260930a_', '20261003a_']) {
    const alte = toate.filter(f => f.startsWith(prefix) && !/jakv202|jakv2p3/.test(f) && !aplicateCuAcelasiPrefix.has(f))
    assert.deepEqual(alte, [], `prefixul ${prefix} e folosit și de alte migrări`)
  }
  for (const f of aplicateCuAcelasiPrefix.keys()) {
    if (!toate.includes(f)) continue
    assert.doesNotMatch(read(`supabase/migrations/${f}`), /fn_pt_pachet_depus_verifica|fn_ofertare_pt_pachet_poarta_documentatie|fn_gate_depunere/, `${f} atinge funcțiile J04/J07`)
  }
  const j04 = read('supabase/migrations/20260930a_ofertare_pachet_hash_server_jakv202.sql')
  const j07 = read('supabase/migrations/20261003a_ofertare_poarta_server_jakv2p3.sql')
  assert.match(j04, /CREATE OR REPLACE FUNCTION public\.fn_pt_pachet_depus_verifica\(\)/)
  // J07 doar CITEȘTE funcția J04 în precondiția „J04 activ” (Copilot conv. 3, NO-GO r1 pe d8cc2da); n-o creează / modifică / șterge
  assert.doesNotMatch(j07, /(CREATE|ALTER|DROP)(\s+OR\s+REPLACE)?\s+FUNCTION\s+public\.fn_pt_pachet_depus_verifica/)
  assert.doesNotMatch(j04, /fn_ofertare_pt_pachet_poarta_documentatie|fn_gate_depunere/)
  assert.match(j07, /fn_ofertare_pt_pachet_poarta_documentatie\(\)/)
})
