// F01–F06: PostgreSQL 16 real; același harness local ca probele R9b 2/3.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runTests, RESPONSABIL, FARA_ACCES, Session, draft, state, approved, sqlText } from './test_r9b_probe23.mjs'

let next = 5000
async function licitatie(observer) {
  const id = ++next
  await observer.command(`INSERT INTO ofertare_licitatii(id,responsabil_id) VALUES (${id},'${RESPONSABIL}');
    INSERT INTO seap_compl VALUES (${id},NULL);`)
  return id
}
async function cantitate(observer, lic, patch = {}) {
  const r = { licitatie_id: lic, denumire: 'Conductă DN110', categorie: 'Conducte', um: 'm', cantitate: 100,
    status: 'extras', tip_sursa: 'lista_f3', sursa: 'F3', obiect: 'Lot A', extras_de_ai: false, ...patch }
  return JSON.parse(await observer.command(`INSERT INTO ofertare_cantitati(${Object.keys(r).join(',')})
    VALUES (${Object.values(r).map(v => v == null ? 'NULL' : sqlText(v)).join(',')}) RETURNING to_jsonb(id);`))
}
async function refuza(session, sql, mesaj) {
  // Subtranzacția păstrează sesiunea utilizabilă după refuzul așteptat.
  await session.command(`DO $test$ BEGIN BEGIN
    EXECUTE ${sqlText(sql)};
    RAISE EXCEPTION 'TEST: comanda trebuia refuzată';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM !~ ${sqlText(mesaj)} THEN RAISE; END IF;
  END; END $test$;`)
}
const teste = []
const contoare = [
  ['lista_f3_nevalidate', {}, null],
  ['lista_f3_validate_fara_cant', { status: 'validat', cantitate: null }, null],
  ['invalidate_in_afara_retea', { status: 'validat' }, "um='buc'"],
  ['total_invalidate', { status: 'validat', denumire: 'TOTAL' }, 'cantitate=101'],
  ['unitate_schimbata_in_afara_retea', {}, "um='buc'"],
  ['um_de_normalizat_f3', { status: 'validat', um: 'M' }, null],
  ['retea_alte_unitati_lungimi_f3', { status: 'validat', um: 'sute m' }, null],
]
for (const [contor, patch, update] of contoare) teste.push([`F01 — ${contor} oprește aprobarea`, async ({ observer, a }) => {
  const lic = await licitatie(observer)
  const id = await cantitate(observer, lic, patch)
  if (update) await observer.command(`UPDATE ofertare_cantitati SET ${update} WHERE id=${id};`)
  const v = await observer.value(`(SELECT to_jsonb(v) FROM v_ofertare_cantitati_nevalidate v WHERE licitatie_id=${lic})`)
  assert.equal(v[contor], 1)
  assert.equal(v.transfer_conflicte_docs, 0)
  const blocaj = await observer.value(`to_jsonb(ofertare_r5_blocaj_sursa(${lic}))`)
  assert.ok(blocaj.includes(`${contor} = 1`), blocaj)
  await refuza(a, `INSERT INTO ofertare_pt_pachet(licitatie_id,stare) VALUES (${lic},'aprobat')`, 'Aprobare blocată')
  assert.equal(await observer.value(`(SELECT to_jsonb(count(*)) FROM ofertare_pt_pachet WHERE licitatie_id=${lic})`), 0)
}])

teste.push(['F02 — toate originile AI cer drept de decizie, fără condiție auto_planse', async ({ observer, a, b }) => {
  const lic = await licitatie(observer)
  const denied = new Session('F02_fara_decizie')
  const anon = new Session('F02_anon')
  try {
    await denied.init(FARA_ACCES)
    await anon.init()
    await anon.command("SET ROLE anon; SET request.jwt.claims='{}';")
    for (const origine of ['platforma', 'automat']) {
      const id = JSON.parse(await observer.command(`INSERT INTO ofertare_clarificari(licitatie_id,origine,cheie,status,intrebare)
        VALUES (${lic},'${origine}','test_${origine}','propunere','Text verificabil') RETURNING to_jsonb(id);`))
      for (const caller of [denied, anon]) {
        for (const status of ['de_trimis', 'trimisa']) await refuza(caller,
          `UPDATE ofertare_clarificari SET status='${status}' WHERE id=${id}`, 'drept de decizie')
        await refuza(caller, `INSERT INTO ofertare_clarificari(licitatie_id,origine,status) VALUES (${lic},'${origine}','de_trimis')`, 'drept de decizie')
      }
      // Tentativa de a ocoli prin schimbarea originii în aceeași comandă.
      await refuza(denied, `UPDATE ofertare_clarificari SET origine='manual',status='trimisa' WHERE id=${id}`, 'Proveniența')
      await b.command(`UPDATE ofertare_clarificari SET status='de_trimis' WHERE id=${id};`)
      await a.command(`UPDATE ofertare_clarificari SET status='trimisa' WHERE id=${id};`)
      assert.equal(await observer.value(`(SELECT to_jsonb(status) FROM ofertare_clarificari WHERE id=${id})`), 'trimisa')
    }
    const d = await draft(observer)
    await refuza(a, `UPDATE ofertare_clarificari SET status='de_trimis' WHERE id=${d.id}`, 'Reconfirmă')
  } finally { await denied.close(); await anon.close() }
}])

teste.push(['F03 — propunere → raspunsa și text+status refuzate atomic', async ({ observer, a }) => {
  const lic = await licitatie(observer)
  for (const origine of ['platforma','automat']) {
    const id = JSON.parse(await observer.command(`INSERT INTO ofertare_clarificari(licitatie_id,origine,status,intrebare)
      VALUES (${lic},'${origine}','propunere','Text inițial') RETURNING to_jsonb(id);`))
    for (const set of ["status='raspunsa'", "status='raspunsa',intrebare='Alt text',raspuns='Răspuns'"]) {
      await refuza(a, `UPDATE ofertare_clarificari SET ${set} WHERE id=${id}`, 'cere o clarificare trimisă')
    }
    await refuza(a, `INSERT INTO ofertare_clarificari(licitatie_id,origine,status) VALUES (${lic},'${origine}','raspunsa')`, 'cere o clarificare trimisă')
    assert.deepEqual(await observer.value(`(SELECT jsonb_build_array(status,intrebare,raspuns) FROM ofertare_clarificari WHERE id=${id})`), ['propunere','Text inițial',null])
    await a.command(`UPDATE ofertare_clarificari SET status='de_trimis' WHERE id=${id};`)
    await refuza(a, `UPDATE ofertare_clarificari SET status='raspunsa' WHERE id=${id}`, 'cere o clarificare trimisă')
    await a.command(`UPDATE ofertare_clarificari SET status='trimisa' WHERE id=${id};
      UPDATE ofertare_clarificari SET status='raspunsa',raspuns='Răspuns real' WHERE id=${id};
      UPDATE ofertare_clarificari SET raspuns='Răspuns complet' WHERE id=${id};`)
  }
  const d = await draft(observer)
  await refuza(a, `UPDATE ofertare_clarificari SET status='raspunsa',intrebare='Alt text' WHERE id=${d.id}`, 'cere o clarificare trimisă')
}])

teste.push(['F04 — identitatea fișierului schimbă amprenta; lipsa hashului este explicită', async ({ observer, a }) => {
  const d = await draft(observer)
  const baza = () => observer.value(`ofertare_f3_baza(${d.lic})`)
  await observer.command(`UPDATE ofertare_documente_atribuire SET fisier_path='v1.pdf',size_bytes=100 WHERE id=${d.lic};`)
  let b = await baza()
  assert.equal(b.identitate_incompleta, true)
  assert.equal(b.documente[0].fisier_path, 'v1.pdf')
  for (const set of ["fisier_path='v2.pdf'", 'size_bytes=101', `analiza=analiza||'${JSON.stringify({ integritate: { sha256: 'a'.repeat(64) } })}'::jsonb`,
    `analiza=jsonb_set(analiza,'{integritate,sha256}','"${'b'.repeat(64)}"')`]) {
    await observer.command(`UPDATE ofertare_documente_atribuire SET ${set} WHERE id=${d.lic};`)
    const nou = await baza()
    assert.notEqual(nou.amprenta, b.amprenta)
    b = nou
  }
  assert.equal(b.identitate_incompleta, false)
  await approved(observer, a, d)
  await observer.command(`UPDATE ofertare_documente_atribuire SET analiza=jsonb_set(analiza,'{integritate,sha256}','"${'c'.repeat(64)}"') WHERE id=${d.lic};`)
  assert.equal((await state(observer,d)).stare, 'schimbata')
}])

teste.push(['F04 — aplicare/rollback fără date modificate; aprobarea veche cere reverificare', async ({ observer, a }) => {
  const rollback = readFileSync(new URL('../../docs/R5_MIGRARE_3_review_copilot_ROLLBACK.sql', import.meta.url), 'utf8')
  const migrare = readFileSync(new URL('../../docs/R5_MIGRARE_3_review_copilot.sql', import.meta.url), 'utf8')
  await observer.command(rollback)
  const d = await draft(observer)
  await approved(observer, a, d)
  const date = () => observer.value(`jsonb_build_array(
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM ofertare_clarificari c),
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM ofertare_cantitati c),
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM ofertare_cantitati_istoric c))`)
  const inainte = await date()
  await observer.command(migrare)
  assert.deepEqual(await date(), inainte)
  assert.equal((await state(observer, d)).stare, 'schimbata')
  await observer.command(rollback)
  assert.deepEqual(await date(), inainte)
  assert.equal((await state(observer, d)).stare, 'ok')
  await observer.command(migrare)
}])

teste.push(['F05 — SEAP devenit incomplet după aprobare blochează depunerea', async ({ observer, a }) => {
  const lic = await licitatie(observer)
  await cantitate(observer, lic, { status: 'validat' })
  const id = JSON.parse(await a.command(`INSERT INTO ofertare_pt_pachet(licitatie_id,stare) VALUES (${lic},'aprobat') RETURNING to_jsonb(id);`))
  await observer.command(`UPDATE seap_compl SET blocaj='Fișier esențial lipsă' WHERE licitatie_id=${lic};`)
  await refuza(a, `UPDATE ofertare_pt_pachet SET stare='depus' WHERE id=${id}`, 'documentația nu e completă')
  assert.equal(await observer.value(`(SELECT to_jsonb(stare) FROM ofertare_pt_pachet WHERE id=${id})`), 'aprobat')
  await observer.command(`UPDATE seap_compl SET blocaj=NULL WHERE licitatie_id=${lic};`)
  await a.command(`UPDATE ofertare_pt_pachet SET stare='depus' WHERE id=${id};`)
}])

teste.push(['F06 — ștergerea păstrează ultima validare, inclusiv după diferenta', async ({ observer, a }) => {
  const lic = await licitatie(observer)
  const ids = []
  for (const invalidat of [false,true]) {
    const id = await cantitate(observer, lic)
    ids.push(id)
    await a.command(`UPDATE ofertare_cantitati SET status='validat' WHERE id=${id};`)
    if (invalidat) await a.command(`UPDATE ofertare_cantitati SET cantitate=101 WHERE id=${id};`)
    await a.command(`DELETE FROM ofertare_cantitati WHERE id=${id};`)
    const h = await observer.value(`(SELECT to_jsonb(h) FROM ofertare_cantitati_istoric h WHERE cantitate_id=${id} AND motiv='sters')`)
    assert.equal(h.status_vechi, invalidat ? 'diferenta' : 'validat')
    assert.equal(h.aprobare_veche.cantitate, 100)
    assert.equal(h.aprobare_veche.istoric_id, await observer.value(`(SELECT to_jsonb(id) FROM ofertare_cantitati_istoric WHERE cantitate_id=${id} AND motiv='validat' ORDER BY id DESC LIMIT 1)`))
  }
  const v = await observer.value(`(SELECT to_jsonb(v) FROM v_ofertare_cantitati_nevalidate v WHERE licitatie_id=${lic})`)
  assert.equal(v.sterse_dupa_validare, 2)
  assert.deepEqual(v.sterse_dupa_validare_lista.map(x => x.cantitate_id).sort(), ids.sort())
  const nevalidat = await cantitate(observer, lic)
  await a.command(`DELETE FROM ofertare_cantitati WHERE id=${nevalidat};`)
  assert.equal(await observer.value(`(SELECT to_jsonb(count(*)) FROM ofertare_cantitati_istoric WHERE cantitate_id=${nevalidat} AND motiv='sters')`), 0)
}])

teste.push(['F08 SQL — CAS pierde cursa, recitirea păstrează modificările ambilor writeri', async ({ observer, a }) => {
  const lic = await licitatie(observer)
  await observer.command(`INSERT INTO ofertare_documente_atribuire(id,licitatie_id,analiza)
    VALUES (${lic},${lic},'{"integritate":{"sha256":"vechi"},"citire_ai":{"rev":"r0"}}');`)
  const initial = await observer.value(`(SELECT analiza FROM ofertare_documente_atribuire WHERE id=${lic})`)
  await a.command(`UPDATE ofertare_documente_atribuire SET analiza=jsonb_set(analiza,'{integritate,sha256}','"B"') WHERE id=${lic};`)
  const worker = new Session('F08_worker')
  try {
    await worker.init()
    await worker.command('SET ROLE service_role;')
    const cas = (baza, patch) => worker.value(`to_jsonb(ofertare_plansa_analiza_cas(${lic},${sqlText(JSON.stringify(baza))}::jsonb,${sqlText(JSON.stringify(patch))}::jsonb))`)
    assert.equal(await cas(initial, { analiza: { ...initial, rezervari_zone: { rev: 'A' } } }), false)
    const curent = await observer.value(`(SELECT analiza FROM ofertare_documente_atribuire WHERE id=${lic})`)
    assert.equal(await cas(curent, { analiza: { ...curent, rezervari_zone: { rev: 'A' } } }), true)
    assert.deepEqual(await observer.value(`(SELECT analiza FROM ofertare_documente_atribuire WHERE id=${lic})`),
      { integritate: { sha256: 'B' }, citire_ai: { rev: 'r0' }, rezervari_zone: { rev: 'A' } })
    assert.equal(await observer.value("to_jsonb(has_function_privilege('authenticated','public.ofertare_plansa_analiza_cas(bigint,jsonb,jsonb)','EXECUTE'))"), false)
  } finally { await worker.close() }
}])

await runTests(teste, { reviewF: true })
