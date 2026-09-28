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
    await observer.command(`DROP TABLE IF EXISTS ofertare_plansa_buget; DROP TABLE IF EXISTS ofertare_plansa_coada CASCADE;`)
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

const rezerva = (s, id, token, suma = 3, plafon = 40) => s.value(`ofertare_plansa_rezerva(${id},'${token}',${suma},${plafon})`)
const regularizeaza = (s, id, token, cost = 'NULL', cert = false) => s.value(`ofertare_plansa_regularizeaza(${id},'${token}',${cost},${cert})`)
const registru = (s, id) => s.value(`(SELECT to_jsonb(r) FROM ofertare_plansa_buget r WHERE id=${id})`)
const totalJob = (s, id) => s.value(`(SELECT to_jsonb(cost_usd) FROM ofertare_plansa_coada WHERE id=${id})`)
async function worker(nume) {
  const w = new Session(nume)
  await w.init(); await w.command('SET ROLE service_role;')
  return w
}
async function jobLucru(observer, b) {
  const { doc } = await plansa(observer)
  const j = await inscrie(b, doc)
  const token = await observer.value('to_jsonb(gen_random_uuid())')
  await observer.command(`UPDATE ofertare_plansa_coada SET stare='lucru', claim_token='${token}', lease_pana=now()+interval '10 min' WHERE id=${j.id};`)
  return { id: j.id, token }
}

teste.push(['claim: rezervarea workerului căzut rămâne în registru; token vechi refuzat; jobul însumează toate zilele', async ({ observer, b }) => {
  await pregatire(observer)
  const { doc } = await plansa(observer)
  const j = await inscrie(b, doc)
  await observer.command(`UPDATE ofertare_plansa_coada SET stare='anulat' WHERE id<>${j.id} AND stare IN ('asteapta','lucru');`)
  assert.equal(await observer.value(`(SELECT to_jsonb(plafon_usd) FROM ofertare_plansa_coada WHERE id=${j.id})`), 10)
  const w = new Session('worker')
  try {
    await w.init(); await w.command(`SET ROLE service_role;`)
    const t1 = await w.value(`(SELECT to_jsonb(claim_token) FROM ofertare_plansa_coada_ia('w1', 10))`)
    assert.ok(t1)
    const r = await rezerva(w, j.id, t1)
    assert.equal(r.ok, true)
    // Zi veche în fixture: re-claim nu reclasifică suma în ziua preluării.
    await observer.command(`UPDATE ofertare_plansa_buget SET zi=zi-1 WHERE id=${r.rezervare_id};
      UPDATE ofertare_plansa_coada SET lease_pana=now()-interval '1 min' WHERE id=${j.id};`)
    const vechi = await registru(observer, r.rezervare_id)
    const t2 = await w.value(`(SELECT to_jsonb(claim_token) FROM ofertare_plansa_coada_ia('w1', 10))`)
    assert.ok(t2 && t2 !== t1, 'token nou la re-claim')
    assert.equal(Number(await totalJob(observer, j.id)), 3)
    assert.deepEqual(await registru(observer, r.rezervare_id), vechi)
    assert.deepEqual(await rezerva(w, j.id, t1), { ok: false, motiv: 'lease' })
    assert.deepEqual(await rezerva(w, j.id, t2, 8), { ok: false, motiv: 'plafon job' })
    // execuția veche (t1) nu mai poate scrie
    await w.command(`UPDATE ofertare_plansa_coada SET stare='gata' WHERE id=${j.id} AND claim_token='${t1}' AND stare='lucru';`)
    assert.equal(await observer.value(`(SELECT to_jsonb(stare) FROM ofertare_plansa_coada WHERE id=${j.id})`), 'lucru')
    const nou = await rezerva(w, j.id, t2)
    assert.equal(nou.ok, true)
    // Răspunsul vechi poate contabiliza cheltuiala lui, fără să piardă rezervarea noului claim.
    assert.deepEqual(await regularizeaza(w, r.rezervare_id, t1, 2, true), { ok: true, cost_usd: 5 })
    assert.equal((await registru(observer, nou.rezervare_id)).stare, 'rezervat')
    assert.equal(await observer.value(`(SELECT to_jsonb(claim_token) FROM ofertare_plansa_coada WHERE id=${j.id})`), t2)
  } finally { await w.close() }
}])

teste.push(['36 + 3 + 3 în două sesiuni service_role: exact o rezervare trece, cealaltă așteaptă lock-ul zilei', async ({ observer, b }) => {
  await pregatire(observer)
  // Izolare doar în baza sintetică: costurile probelor precedente sunt mutate pe ziua anterioară.
  await observer.command(`UPDATE ofertare_plansa_buget SET zi=zi-1 WHERE zi=(clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date;`)
  const w1 = await worker('buget1'), w2 = await worker('buget2')
  let pending
  try {
    for (let i = 0; i < 4; i++) {
      const j = await jobLucru(observer, b)
      const r = await rezerva(w1, j.id, j.token, 9)
      assert.equal(r.ok, true)
      assert.equal((await regularizeaza(w1, r.rezervare_id, j.token, 9, true)).ok, true)
      await observer.command(`UPDATE ofertare_plansa_coada SET stare='gata' WHERE id=${j.id};`)
    }
    const j1 = await jobLucru(observer, b), j2 = await jobLucru(observer, b)
    await w1.command('BEGIN;')
    const r1 = await rezerva(w1, j1.id, j1.token)
    pending = rezerva(w2, j2.id, j2.token)
    // Dovadă a suprapunerii reale, nu sleep presupus suficient.
    let blocat = false
    for (let i = 0; i < 100; i++) {
      blocat = await observer.value(`to_jsonb(EXISTS(SELECT 1 FROM pg_locks WHERE pid=${w2.pid} AND locktype='advisory' AND NOT granted))`)
      if (blocat) break
    }
    assert.equal(blocat, true, 'a doua sesiune trebuie să aștepte lock-ul bugetului')
    await w1.command('COMMIT;')
    const r2 = await pending
    assert.equal([r1, r2].filter(r => r.ok).length, 1)
    assert.deepEqual(r2, { ok: false, motiv: 'plafon pe zi' })
    assert.equal(await observer.value(`to_jsonb((SELECT sum(coalesce(cost_usd,rezervat_usd)) FROM ofertare_plansa_buget WHERE zi=(clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date))`), 39)
    assert.equal(await observer.value(`to_jsonb((SELECT count(*) FROM ofertare_plansa_buget WHERE job_id IN (${j1.id},${j2.id})))`), 1)
  } finally {
    await w1.close()
    if (pending) await pending.catch(() => {})
    await w2.close()
  }
}])

teste.push(['incert = cel puțin rezervarea; regularizare idempotentă, tokenul altuia refuzat, zero cert eliberează', async ({ observer, b }) => {
  await pregatire(observer)
  await observer.command(`UPDATE ofertare_plansa_buget SET zi=zi-1 WHERE zi=(clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date;`)
  const j = await jobLucru(observer, b), w = await worker('incert')
  try {
    const r = await rezerva(w, j.id, j.token)
    assert.equal(r.ok, true)
    assert.deepEqual(await regularizeaza(w, r.rezervare_id, OWNER), { ok: false, motiv: 'lease' })
    assert.equal((await registru(observer, r.rezervare_id)).stare, 'rezervat')
    assert.deepEqual(await regularizeaza(w, r.rezervare_id, j.token), { ok: true, cost_usd: 3 })
    const incert = await registru(observer, r.rezervare_id)
    assert.equal(incert.stare, 'incert')
    assert.equal(incert.cost_usd, incert.rezervat_usd)
    assert.equal(await totalJob(observer, j.id), 3)
    // Retry / repetare RPC nu transformă un rezultat incert în zero.
    await regularizeaza(w, r.rezervare_id, j.token, 0, true)
    assert.deepEqual(await registru(observer, r.rezervare_id), incert)
    const r2 = await rezerva(w, j.id, j.token)
    await regularizeaza(w, r2.rezervare_id, j.token, 4, false)
    assert.equal((await registru(observer, r2.rezervare_id)).cost_usd, 4)
    assert.equal(await totalJob(observer, j.id), 7)
    const r3 = await rezerva(w, j.id, j.token)
    assert.equal(r3.ok, true, 'exact 10 USD este permis')
    await regularizeaza(w, r3.rezervare_id, j.token, 0, true)
    assert.equal(await totalJob(observer, j.id), 7)
  } finally { await w.close() }
}])

teste.push(['23:59 → regularizare după miezul nopții păstrează ziua rezervării; costurile vechi intră doar în plafonul jobului', async ({ observer, b }) => {
  await pregatire(observer)
  await observer.command(`UPDATE ofertare_plansa_buget SET zi=zi-1 WHERE zi=(clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date;`)
  const j = await jobLucru(observer, b), w = await worker('miezul_noptii')
  try {
    const r = await rezerva(w, j.id, j.token)
    const azi = await observer.value(`to_jsonb((clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date)`)
    assert.equal((await registru(observer, r.rezervare_id)).zi, azi)
    // Ceasul serverului nu e modificat: fixture-ul reprezintă rezervarea de ieri, ora 23:59 București.
    await observer.command(`UPDATE ofertare_plansa_buget
      SET zi=zi-1, creat_la=((zi-1)+time '23:59') AT TIME ZONE 'Europe/Bucharest' WHERE id=${r.rezervare_id};`)
    const ieri = (await registru(observer, r.rezervare_id)).zi
    await regularizeaza(w, r.rezervare_id, j.token, 2, true)
    const dupa = await registru(observer, r.rezervare_id)
    assert.equal(dupa.zi, ieri)
    assert.notEqual(dupa.zi, azi)
    assert.equal(await observer.value(`(SELECT to_jsonb((regularizat_la AT TIME ZONE 'Europe/Bucharest')::date > zi) FROM ofertare_plansa_buget WHERE id=${r.rezervare_id})`), true)
    assert.equal(dupa.cost_usd, 2)
    assert.equal((await rezerva(w, j.id, j.token, 3, 3)).ok, true, 'costul de ieri nu consumă plafonul zilei curente')
    assert.deepEqual(await rezerva(w, j.id, j.token, 6), { ok: false, motiv: 'plafon job' })
  } finally { await w.close() }
}])

teste.push(['authenticated/anon: ambele RPC-uri refuzate; registru doar SELECT autenticat cu auth.uid()', async ({ observer, b }) => {
  await pregatire(observer)
  const x = new Session('anon_buget')
  try {
    await x.init(); await x.command('SET ROLE anon;')
    for (const s of [b, x]) {
      await refuza(s, `SELECT ofertare_plansa_rezerva(1,'${OWNER}',3,40)`, 'permission denied')
      await refuza(s, `SELECT ofertare_plansa_regularizeaza(1,'${OWNER}',0,true)`, 'permission denied')
      await refuza(s, `UPDATE ofertare_plansa_buget SET cost_usd=0 WHERE id=1`, 'permission denied')
      await refuza(s, `INSERT INTO ofertare_plansa_buget(job_id,claim_token,rezervat_usd) VALUES (1,'${OWNER}',3)`, 'permission denied')
    }
    await refuza(x, 'SELECT * FROM ofertare_plansa_buget', 'permission denied')
    assert.ok(await b.value('to_jsonb((SELECT count(*) FROM ofertare_plansa_buget))') > 0)
    await x.command('RESET ROLE; SET ROLE authenticated;')
    assert.equal(await x.value('to_jsonb((SELECT count(*) FROM ofertare_plansa_buget))'), 0, 'fără uid, RLS nu permite citirea')
  } finally { await x.close() }
}])

teste.push(['rollback oprește cererile noi și păstrează registrul și regularizarea apelurilor în zbor', async ({ observer, b }) => {
  await pregatire(observer)
  const j = await jobLucru(observer, b), w = await worker('rollback')
  try {
    const r = await rezerva(w, j.id, j.token)
    assert.equal(r.ok, true)
    const inainte = await registru(observer, r.rezervare_id)
    const rollback = readFileSync(new URL('../../docs/R4_MIGRARE_PROPUSA_ofertare_plansa_coada_ROLLBACK.sql', import.meta.url), 'utf8')
    await observer.command(rollback)
    assert.deepEqual(await registru(observer, r.rezervare_id), inainte)
    assert.deepEqual(await rezerva(w, j.id, j.token), { ok: false, motiv: 'coada dezactivată' })
    assert.deepEqual(await w.value(`(SELECT coalesce(jsonb_agg(id),'[]') FROM ofertare_plansa_coada_ia('w',10))`), [])
    const { doc } = await plansa(observer)
    assert.match((await inscrie(b, doc)).eroare, /dezactivată/)
    assert.deepEqual(await regularizeaza(w, r.rezervare_id, j.token), { ok: true, cost_usd: 3 })
  } finally { await w.close() }
}])

await runTests(teste)
