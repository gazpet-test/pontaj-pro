// R4 #142 — coada de citire a planșelor pe NAS: migrarea propusă pe PostgreSQL 16 real (același harness ca R9b).
// PGURI=... node scripts/pg/test_r4_coada_plansa.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runTests, OWNER, RESPONSABIL, FARA_ACCES, Session } from './test_r9b_probe23.mjs'

const MIGRARE = readFileSync(new URL('../../docs/R4_MIGRARE_PROPUSA_ofertare_plansa_coada.sql', import.meta.url), 'utf8')
let next = 100_000 + (Date.now() % 50_000) * 20, migrat = false
async function pregatire(observer) {
  await observer.command(`CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${OWNER}'),('${RESPONSABIL}'),('${FARA_ACCES}') ON CONFLICT DO NOTHING;
    INSERT INTO profiles(id,is_owner) VALUES ('${OWNER}',true) ON CONFLICT (id) DO UPDATE SET is_owner=true;`)
  if (!migrat) {   // o dată pe rulare: coadă curată, migrarea aplicată exact din fișier
    await observer.command(`DROP TABLE IF EXISTS ofertare_plansa_coada CASCADE;`)
    await observer.command(MIGRARE)
    migrat = true
  }
}
async function plansa(observer, patch = {}) {
  const lic = ++next, doc = ++next
  const p = { taiat_la: 't1', cale_felii: `${lic}/felii/${doc}`, ...patch }
  await observer.command(`INSERT INTO ofertare_licitatii(id,responsabil_id) VALUES (${lic},'${RESPONSABIL}');
    INSERT INTO ofertare_documente_atribuire(id,licitatie_id,nume_original,tip,fisier_path,analiza)
    VALUES (${doc},${lic},'plansa.pdf','plansa','${lic}/p.pdf','${JSON.stringify({ plansa: p })}'::jsonb);`)
  return { lic, doc }
}
async function refuza(session, sql, mesaj) {
  await session.command(`DO $t$ BEGIN BEGIN EXECUTE $q$${sql}$q$; RAISE EXCEPTION 'TEST: trebuia refuzat';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM !~ '${mesaj}' THEN RAISE; END IF; END; END $t$;`)
}
const inscrie = (s, doc, mod = 'citeste') => s.value(`ofertare_plansa_coada_inscrie(${doc}, '${mod}')`)

const teste = []
teste.push(['poarta pe cheltuială în SQL: owner și responsabil înscriu; fără drept = refuz cu același mesaj și pe doc inexistent', async ({ observer, a, b }) => {
  await pregatire(observer)
  const { doc } = await plansa(observer)
  const x = new Session('fara_drept')
  try {
    await x.init(FARA_ACCES)
    await refuza(x, `SELECT ofertare_plansa_coada_inscrie(${doc})`, 'Fără drept pe acest document')
    await refuza(x, `SELECT ofertare_plansa_coada_inscrie(999999999)`, 'Fără drept pe acest document')
  } finally { await x.close() }
  assert.equal((await inscrie(b, doc)).existent, false)
  assert.equal((await inscrie(a, doc)).existent, true)
}])

teste.push(['idempotență: dublu-click / al doilea tab = același job activ; mod-ul jobului existent nu se schimbă', async ({ observer, b }) => {
  await pregatire(observer)
  const { doc } = await plansa(observer)
  const j1 = await inscrie(b, doc), j2 = await inscrie(b, doc, 'continua')
  assert.equal(j1.id, j2.id)
  assert.equal(j2.mod, 'citeste', 'răspunsul întoarce modul jobului existent, nu pe cel cerut')
  assert.equal(await observer.value(`to_jsonb((SELECT count(*) FROM ofertare_plansa_coada WHERE doc_id=${doc})::int)`), 1)
  assert.equal(await observer.value(`(SELECT to_jsonb(mod) FROM ofertare_plansa_coada WHERE id=${j1.id})`), 'citeste')
}])

teste.push(['doar planșe tăiate și citibile intră în coadă', async ({ observer, b }) => {
  await pregatire(observer)
  const { doc: netaiat } = await plansa(observer, { cale_felii: null })
  assert.match((await inscrie(b, netaiat)).eroare, /nu e tăiată/)
  const { doc: necitibil } = await plansa(observer, { citibila: false })
  assert.match((await inscrie(b, necitibil)).eroare, /necitibilă/)
  const { lic } = await plansa(observer)
  const alt = ++next
  await observer.command(`INSERT INTO ofertare_documente_atribuire(id,licitatie_id,tip,analiza) VALUES (${alt},${lic},'caiet_sarcini','{}');`)
  assert.match((await inscrie(b, alt)).eroare, /nu e planșă/)
}])

teste.push(['drepturi: authenticated nu scrie direct în coadă și nu poate prelua joburi; service_role preia cu SKIP LOCKED', async ({ observer, b }) => {
  await pregatire(observer)
  const { doc, lic } = await plansa(observer)
  await refuza(b, `INSERT INTO ofertare_plansa_coada(doc_id,licitatie_id,cale_felii,cerut_de) VALUES (${doc},${lic},'x','${RESPONSABIL}')`, 'permission denied')
  await refuza(b, `SELECT * FROM ofertare_plansa_coada_ia('w', 10)`, 'permission denied')
  const j = await inscrie(b, doc)
  await refuza(b, `UPDATE ofertare_plansa_coada SET stare='gata' WHERE id=${j.id}`, 'permission denied')
  const w1 = new Session('worker1'), w2 = new Session('worker2')
  try {
    await w1.init(); await w2.init()
    await w1.command(`SET ROLE service_role;`); await w2.command(`SET ROLE service_role;`)
    // doar jobul nostru e de luat: celelalte (din testele anterioare) se închid întâi
    await observer.command(`UPDATE ofertare_plansa_coada SET stare='anulat' WHERE id<>${j.id} AND stare IN ('asteapta','lucru');`)
    await w1.command(`BEGIN;`)
    const luat1 = await w1.value(`(SELECT coalesce(jsonb_agg(id),'[]') FROM ofertare_plansa_coada_ia('w1', 10))`)
    const luat2 = await w2.value(`(SELECT coalesce(jsonb_agg(id),'[]') FROM ofertare_plansa_coada_ia('w2', 10))`)
    await w1.command(`COMMIT;`)
    assert.deepEqual(luat1, [j.id])
    assert.deepEqual(luat2, [], 'al doilea worker nu ia același job (SKIP LOCKED)')
    // lease expirat = worker căzut: jobul se reia de alt worker
    await observer.command(`UPDATE ofertare_plansa_coada SET lease_pana=now()-interval '1 min' WHERE id=${j.id};`)
    assert.deepEqual(await w2.value(`(SELECT coalesce(jsonb_agg(id),'[]') FROM ofertare_plansa_coada_ia('w2', 10))`), [j.id])
    assert.equal(await observer.value(`(SELECT to_jsonb(luat_de) FROM ofertare_plansa_coada WHERE id=${j.id})`), 'w2')
  } finally { await w1.close(); await w2.close() }
}])

teste.push(['lease expirat de max_incercari ori: eroare vizibilă, nu se mai reia', async ({ observer, b }) => {
  await pregatire(observer)
  const { doc } = await plansa(observer)
  const j = await inscrie(b, doc)
  await observer.command(`UPDATE ofertare_plansa_coada SET stare='lucru', incercari=3, luat_de='mort', lease_pana=now()-interval '1 min' WHERE id=${j.id};
    UPDATE ofertare_plansa_coada SET stare='anulat' WHERE id<>${j.id} AND stare IN ('asteapta','lucru');`)
  const w = new Session('worker')
  try {
    await w.init(); await w.command(`SET ROLE service_role;`)
    assert.deepEqual(await w.value(`(SELECT coalesce(jsonb_agg(id),'[]') FROM ofertare_plansa_coada_ia('w', 10))`), [])
  } finally { await w.close() }
  assert.equal(await observer.value(`(SELECT to_jsonb(stare) FROM ofertare_plansa_coada WHERE id=${j.id})`), 'eroare')
}])

teste.push(['anon nu vede nimic; authenticated vede starea jobului', async ({ observer, b }) => {
  await pregatire(observer)
  assert.equal(await observer.value(`to_jsonb(has_table_privilege('anon','public.ofertare_plansa_coada','SELECT'))`), false)
  assert.equal(await observer.value(`to_jsonb(has_function_privilege('anon','public.ofertare_plansa_coada_inscrie(bigint,text)','EXECUTE'))`), false)
  assert.ok(await b.value(`to_jsonb((SELECT count(*) FROM ofertare_plansa_coada)::int)`) >= 1)
}])

teste.push(['claim: token unic per preluare; rezervarea unui worker căzut se socotește cheltuită; plafonul pe zi = cost + rezervări, doar service_role', async ({ observer, b }) => {
  await pregatire(observer)
  const { doc } = await plansa(observer)
  const j = await inscrie(b, doc)
  await observer.command(`UPDATE ofertare_plansa_coada SET stare='anulat' WHERE id<>${j.id} AND stare IN ('asteapta','lucru');`)
  await refuza(b, `SELECT ofertare_plansa_cost_zi(NULL)`, 'permission denied')
  assert.equal(await observer.value(`(SELECT to_jsonb(plafon_usd) FROM ofertare_plansa_coada WHERE id=${j.id})`), 10)
  const w = new Session('worker')
  try {
    await w.init(); await w.command(`SET ROLE service_role;`)
    const t1 = await w.value(`(SELECT to_jsonb(claim_token) FROM ofertare_plansa_coada_ia('w1', 10))`)
    assert.ok(t1)
    // workerul rezervă 3 USD și cade; alt claim (același nume!) primește alt token și socotește rezervarea cheltuită
    await observer.command(`UPDATE ofertare_plansa_coada SET cost_usd=2, rezervat_usd=3, lease_pana=now()-interval '1 min' WHERE id=${j.id};`)
    const zi = await w.value(`to_jsonb(ofertare_plansa_cost_zi(NULL))`)
    assert.ok(Number(zi) >= 5, 'suma zilei include rezervarea în zbor')
    assert.equal(Number(await w.value(`to_jsonb(ofertare_plansa_cost_zi(${j.id}))`)) + 5, Number(zi))
    const t2 = await w.value(`(SELECT to_jsonb(claim_token) FROM ofertare_plansa_coada_ia('w1', 10))`)
    assert.ok(t2 && t2 !== t1, 'token nou la re-claim')
    assert.equal(Number(await observer.value(`(SELECT to_jsonb(cost_usd) FROM ofertare_plansa_coada WHERE id=${j.id})`)), 5)
    assert.equal(Number(await observer.value(`(SELECT to_jsonb(rezervat_usd) FROM ofertare_plansa_coada WHERE id=${j.id})`)), 0)
    // execuția veche (t1) nu mai poate scrie
    await w.command(`UPDATE ofertare_plansa_coada SET stare='gata' WHERE id=${j.id} AND claim_token='${t1}' AND stare='lucru';`)
    assert.equal(await observer.value(`(SELECT to_jsonb(stare) FROM ofertare_plansa_coada WHERE id=${j.id})`), 'lucru')
  } finally { await w.close() }
}])

await runTests(teste)
