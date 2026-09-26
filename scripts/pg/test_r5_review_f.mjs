// F01–F06: PostgreSQL 16 real; același harness local ca probele R9b 2/3.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runTests, RESPONSABIL, FARA_ACCES, Session, draft, state, approved, sqlText } from './test_r9b_probe23.mjs'
import { cazuriUnitatiF2 } from '../../src/ofertareInvalidareUnitati.cazuri.js'
import { aplicaRegulaAprobare } from '../../src/ofertareCantitatiInvalidare.js'

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
teste.push(['Runda 2 — migrare și rollback atomice până după ultimele granturi', async ({ observer }) => {
  const migrare = readFileSync(new URL('../../docs/R5_MIGRARE_3_review_copilot.sql', import.meta.url), 'utf8')
  const rollback = readFileSync(new URL('../../docs/R5_MIGRARE_3_review_copilot_ROLLBACK.sql', import.meta.url), 'utf8')
  // Toate funcțiile publice: definiție, identitate, proprietar, ACL și configurație.
  const snapshot = () => observer.value(`(SELECT jsonb_agg(jsonb_build_object(
    'oid',p.oid,'def',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl,'config',p.proconfig) ORDER BY p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f')`)
  for (const [nume, baza, script] of [['migrare',rollback,migrare], ['rollback',migrare,rollback]]) {
    await observer.command(baza)
    const inainte = await snapshot()
    assert.equal((script.match(/^COMMIT;\s*$/gm) || []).length, 1)
    assert.match(script, /COMMIT;\s*$/)
    const defect = script.replace(/COMMIT;\s*$/, "DO $eroare$ BEGIN RAISE EXCEPTION 'F2_EROARE_FINAL'; END $eroare$;\nCOMMIT;")
    const writer = new Session(`F2_atomic_${nume}`)
    try {
      await writer.init()
      await assert.rejects(writer.command(defect), /F2_EROARE_FINAL/)
    } finally { await writer.close() }
    assert.deepEqual(await snapshot(), inainte, `${nume}: o funcție sau un grant a rămas aplicat parțial`)
  }
  await observer.command(migrare)
}])

teste.push(['F02 runda 2 — editarea cere reaprobare; textul transmis este imuabil pentru toate originile generate', async ({ observer, a }) => {
  const lic = await licitatie(observer)
  const denied = new Session('F02_edit_fara_decizie')
  try {
    await denied.init(FARA_ACCES)
    for (const origine of ['platforma','automat']) {
      const id = JSON.parse(await observer.command(`INSERT INTO ofertare_clarificari(licitatie_id,origine,cheie,status,intrebare)
        VALUES (${lic},'${origine}','f2_${origine}','de_trimis','Text aprobat') RETURNING to_jsonb(id);`))
      await denied.command(`UPDATE ofertare_clarificari SET intrebare='Text editat' WHERE id=${id};`)
      assert.equal(await observer.value(`(SELECT to_jsonb(status) FROM ofertare_clarificari WHERE id=${id})`), 'propunere')
      await refuza(denied, `UPDATE ofertare_clarificari SET status='de_trimis' WHERE id=${id}`, 'drept de decizie')
      await a.command(`UPDATE ofertare_clarificari SET status='de_trimis' WHERE id=${id};`)
      // Editare + transmitere într-o singură comandă nu moștenește aprobarea veche.
      await a.command(`UPDATE ofertare_clarificari SET intrebare='Text final',status='trimisa' WHERE id=${id};`)
      assert.equal(await observer.value(`(SELECT to_jsonb(status) FROM ofertare_clarificari WHERE id=${id})`), 'propunere')
      await a.command(`UPDATE ofertare_clarificari SET status='de_trimis' WHERE id=${id};
        UPDATE ofertare_clarificari SET status='trimisa' WHERE id=${id};`)
      for (const status of ['trimisa','raspunsa']) {
        if (status === 'raspunsa') await a.command(`UPDATE ofertare_clarificari SET status='raspunsa',raspuns='Răspuns' WHERE id=${id};`)
        await refuza(a, `UPDATE ofertare_clarificari SET intrebare='Text înlocuit' WHERE id=${id}`, 'transmis este imuabil')
        await refuza(a, `UPDATE ofertare_clarificari SET status='propunere',intrebare='Text înlocuit' WHERE id=${id}`, 'transmis este imuabil')
        assert.deepEqual(await observer.value(`(SELECT jsonb_build_array(status,intrebare) FROM ofertare_clarificari WHERE id=${id})`), [status,'Text final'])
      }
    }
  } finally { await denied.close() }
}])

teste.push(['F06 runda 2 — aprobare anterioară fără eveniment validat; unitate_schimbata nu e dovadă', async ({ observer, a }) => {
  const lic = await licitatie(observer)
  for (const [i, motiv] of ['invalidat','redeschis'].entries()) {
    const id = await cantitate(observer, lic, { status: 'validat' })
    assert.equal(await observer.value(`(SELECT to_jsonb(count(*)) FROM ofertare_cantitati_istoric WHERE cantitate_id=${id})`), 0)
    await a.command(`UPDATE ofertare_cantitati SET ${motiv === 'invalidat' ? 'cantitate=101' : "status='extras'"} WHERE id=${id};`)
    const ev = await observer.value(`(SELECT to_jsonb(h) FROM ofertare_cantitati_istoric h WHERE cantitate_id=${id} AND motiv='${motiv}')`)
    assert.equal(ev.aprobare_veche.status, 'validat')
    await a.command(`DELETE FROM ofertare_cantitati WHERE id=${id};`)
    const sters = await observer.value(`(SELECT to_jsonb(h) FROM ofertare_cantitati_istoric h WHERE cantitate_id=${id} AND motiv='sters')`)
    assert.equal(sters.aprobare_veche.cantitate, 100)
    assert.equal(sters.aprobare_veche.status, 'validat')
    assert.equal(sters.aprobare_veche.istoric_id, ev.id)
    assert.equal(await observer.value(`(SELECT to_jsonb(sterse_dupa_validare) FROM v_ofertare_cantitati_nevalidate WHERE licitatie_id=${lic})`), i + 1)
  }
  // Fiecare dintre cele două forme de dovadă este suficientă separat.
  for (const numaiStatusVechi of [true,false]) {
    const id = await cantitate(observer, lic)
    await observer.command(`INSERT INTO ofertare_cantitati_istoric(cantitate_id,licitatie_id,motiv,status_vechi,valori_vechi,aprobare_veche)
      VALUES (${id},${lic},'invalidat',${sqlText(numaiStatusVechi ? 'validat' : 'diferenta')},
        '{"cantitate":100,"um":"m"}',${sqlText(JSON.stringify(numaiStatusVechi ? {} : { status:'validat',cantitate:99,um:'m' }))}::jsonb);`)
    await a.command(`DELETE FROM ofertare_cantitati WHERE id=${id};`)
    assert.equal(await observer.value(`(SELECT aprobare_veche->'cantitate' FROM ofertare_cantitati_istoric WHERE cantitate_id=${id} AND motiv='sters')`), numaiStatusVechi ? 100 : 99)
  }
  const id = await cantitate(observer, lic)
  await a.command(`UPDATE ofertare_cantitati SET um='buc' WHERE id=${id}; DELETE FROM ofertare_cantitati WHERE id=${id};`)
  assert.equal(await observer.value(`(SELECT to_jsonb(count(*)) FROM ofertare_cantitati_istoric WHERE cantitate_id=${id} AND motiv='unitate_schimbata')`), 1)
  assert.equal(await observer.value(`(SELECT to_jsonb(count(*)) FROM ofertare_cantitati_istoric WHERE cantitate_id=${id} AND motiv='sters')`), 0)
  assert.equal(await observer.value(`(SELECT to_jsonb(sterse_dupa_validare) FROM v_ofertare_cantitati_nevalidate WHERE licitatie_id=${lic})`), 4)
}])

for (const c of cazuriUnitatiF2) teste.push([`U runda 2 — ${c.nume}`, async ({ observer, a }) => {
  const lic = await licitatie(observer)
  const id = await cantitate(observer, lic, c.vechi)
  const vechi = await observer.value(`(SELECT to_jsonb(q) FROM ofertare_cantitati q WHERE id=${id})`)
  const referinta = c.referinta ? { ...vechi, ...c.referinta } : null
  if (referinta) await observer.command(`INSERT INTO ofertare_cantitati_istoric(cantitate_id,licitatie_id,motiv,status_vechi,status_nou,valori_vechi,aprobare_veche,valori_noi)
    VALUES (${id},${lic},'validat','extras','validat',${sqlText(JSON.stringify(vechi))}::jsonb,'{"status":"extras"}'::jsonb,${sqlText(JSON.stringify(referinta))}::jsonb);`)
  const js = aplicaRegulaAprobare(vechi, c.patch, referinta)
  assert.equal(js.invalidat, c.invalidat)
  const set = Object.entries(c.patch).map(([k,v]) => `${k}=${v == null ? 'NULL' : sqlText(v)}`).join(',')
  await a.command(`UPDATE ofertare_cantitati SET ${set} WHERE id=${id};`)
  const nou = await observer.value(`(SELECT to_jsonb(q) FROM ofertare_cantitati q WHERE id=${id})`)
  assert.equal(nou.status, c.invalidat ? 'diferenta' : 'validat')
  assert.equal(nou.diferenta_nota, js.patch.diferenta_nota ?? vechi.diferenta_nota)
  assert.equal(await observer.value(`(SELECT to_jsonb(count(*)) FROM ofertare_cantitati_istoric WHERE cantitate_id=${id} AND motiv='invalidat')`), c.invalidat ? 1 : 0)
}])

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

const reconfirmaF04 = async (session, d) => {
  const st = await state(session, d)
  const r = await session.value(`ofertare_clarificare_reconfirma(${d.id},${sqlText(st.amprenta_curenta)},'revizuit','Text verificat pe baza curentă')`)
  assert.equal(r.ok, true, JSON.stringify(r))
}
const exceptieF04 = async (session, d, token, motiv = 'Documentul vechi a fost verificat manual') =>
  session.value(`ofertare_clarificare_exceptie_identitate(${d.id},${sqlText(token)},${sqlText(motiv)})`)
const limitaF04 = (observer, d) => observer.command(`DELETE FROM ofertare_seap_manifest WHERE document_id=${d.lic};`)

teste.push(['F04 B — fără excepție exportul/trimiterea sunt refuzate; reconfirmarea singură nu ajunge', async ({ observer, a }) => {
  const d = await draft(observer)
  await approved(observer, a, d)
  await a.command(`UPDATE ofertare_clarificari SET status='de_trimis' WHERE id=${d.id};`)
  await limitaF04(observer, d)
  await reconfirmaF04(a, d)
  const st = await state(a, d)
  assert.equal(st.stare, 'identitate_limitata')
  assert.match(st.text, /Identitate limitată:.*aceeași cale și aceeași mărime/)
  assert.ok(st.text.includes(`#${d.lic} Plansa test.pdf`))
  await refuza(a, `SELECT ofertare_clarificari_export(${d.lic})`, 'Export blocat: Identitate limitată')
  await refuza(a, `UPDATE ofertare_clarificari SET status='trimisa' WHERE id=${d.id}`, 'Identitate limitată')
  await a.command(`UPDATE ofertare_clarificari SET status='propunere' WHERE id=${d.id};`)
  await refuza(a, `UPDATE ofertare_clarificari SET status='de_trimis' WHERE id=${d.id}`, 'Identitate limitată')
}])

teste.push(['F04 B — excepția și reconfirmarea în ambele ordini permit ieșirea; audit și avertisment păstrate', async ({ observer, a }) => {
  for (const reconfirmaIntai of [false, true]) {
    const d = await draft(observer)
    await limitaF04(observer, d)
    if (reconfirmaIntai) await reconfirmaF04(a, d)
    const inainte = await state(a, d)
    assert.equal((await exceptieF04(a, d, inainte.amprenta_curenta)).ok, true)
    if (!reconfirmaIntai) {
      assert.equal((await state(a, d)).stare, 'identitate_limitata')
      await refuza(a, `UPDATE ofertare_clarificari SET status='de_trimis' WHERE id=${d.id}`, 'Identitate limitată')
      await reconfirmaF04(a, d)
    }
    const st = await state(a, d)
    assert.equal(st.stare, 'ok_identitate_limitata')
    assert.match(st.detalii.avertisment_identitate, /Identitate limitată:.*documente:/)
    const ex = st.baza_generare.exceptie_identitate
    assert.equal(ex.token, st.amprenta_curenta)
    assert.equal(st.baza_generare.reconfirmare.token, ex.token)
    assert.equal(ex.de, await a.value('to_jsonb(auth.uid())'))
    assert.ok(ex.la)
    assert.equal(ex.motiv, 'Documentul vechi a fost verificat manual')
    assert.deepEqual(ex.documente, [d.lic])
    assert.deepEqual(ex.metadate, { [d.lic]: { fisier_path: 'test/plansa.pdf', marime: 123 } })
    assert.deepEqual(st.baza_generare.istoric_decizii.find(x => x.decizie === 'exceptie_identitate'), ex)
    await a.command(`UPDATE ofertare_clarificari SET status='de_trimis' WHERE id=${d.id};`)
    assert.ok((await a.value(`ofertare_clarificari_export(${d.lic})`)).some(x => x.id === d.id))
    await a.command(`UPDATE ofertare_clarificari SET status='trimisa' WHERE id=${d.id};`)
    assert.match((await exceptieF04(a, d, ex.token)).error, /netransmisă/)
    // Excepția ciornei nu aprobă sursa cantităților sau pachetul final.
    await a.command(`UPDATE ofertare_cantitati SET cantitate=101 WHERE id=${d.quantity};`)
    assert.ok(await a.value(`to_jsonb(ofertare_r5_blocaj_sursa(${d.lic}))`))
    await refuza(a, `INSERT INTO ofertare_pt_pachet(licitatie_id,stare) VALUES (${d.lic},'aprobat')`, 'Aprobare blocată')
  }
}])

teste.push(['F04 B — textul sau baza schimbată invalidează excepția; istoricul rămâne, reconfirmarea nu o reînvie', async ({ observer, a }) => {
  for (const schimbare of ['text', 'baza']) {
    const d = await draft(observer)
    await limitaF04(observer, d)
    const vechi = await state(a, d)
    assert.equal((await exceptieF04(a, d, vechi.amprenta_curenta)).ok, true)
    await reconfirmaF04(a, d)
    await a.command(`UPDATE ofertare_clarificari SET status='de_trimis' WHERE id=${d.id};`)
    if (schimbare === 'text') {
      await a.command(`UPDATE ofertare_clarificari SET intrebare=intrebare||' Text schimbat.' WHERE id=${d.id};`)
    } else {
      await observer.command(`UPDATE ofertare_documente_atribuire SET size_bytes=124 WHERE id=${d.lic};`)
      await refuza(a, `SELECT ofertare_clarificari_export(${d.lic})`, 'Export blocat: Identitate limitată')
    }
    let st = await state(a, d)
    assert.equal(st.stare, 'identitate_limitata')
    assert.notEqual(st.amprenta_curenta, vechi.amprenta_curenta)
    assert.match((await exceptieF04(a, d, vechi.amprenta_curenta)).error, /baza s-a schimbat/)
    await reconfirmaF04(a, d)
    st = await state(a, d)
    assert.equal(st.stare, 'identitate_limitata')
    assert.equal(st.baza_generare.exceptie_identitate, undefined)
    assert.equal(st.baza_generare.istoric_decizii.filter(x => x.decizie === 'exceptie_identitate').length, 1)
    await refuza(a, `UPDATE ofertare_clarificari SET status='trimisa' WHERE id=${d.id}`, 'Identitate limitată')
    if (schimbare === 'text') {
      assert.equal(st.status, 'propunere')
      assert.deepEqual(await a.value(`ofertare_clarificari_export(${d.lic})`), [])
      await a.command(`UPDATE ofertare_clarificari SET intrebare=${sqlText(vechi.intrebare)} WHERE id=${d.id};`)
      await reconfirmaF04(a, d)
      assert.equal((await state(a, d)).stare, 'identitate_limitata')
      await refuza(a, `UPDATE ofertare_clarificari SET status='de_trimis' WHERE id=${d.id}`, 'Identitate limitată')
    }
  }
}])

teste.push(['F04 B — RPC refuză fără decizie/auth, motiv scurt, token vechi și scriere directă', async ({ observer, a }) => {
  const d = await draft(observer)
  await limitaF04(observer, d)
  const st = await state(a, d)
  const before = st.baza_generare
  const denied = new Session('F04_fara_decizie')
  const anonymous = new Session('F04_fara_uid')
  try {
    await denied.init(FARA_ACCES)
    assert.match((await exceptieF04(denied, d, st.amprenta_curenta)).error, /drept de decizie/)
    await anonymous.init()
    await anonymous.command("SET ROLE authenticated; SET request.jwt.claims='{}';")
    assert.match((await exceptieF04(anonymous, d, st.amprenta_curenta)).error, /autentificare/)
    assert.match((await exceptieF04(a, d, st.amprenta_curenta, '  scurt  ')).error, /minimum 10/)
    assert.match((await exceptieF04(a, d, 'vechi')).error, /baza s-a schimbat/)
    const nullToken = await a.value(`ofertare_clarificare_exceptie_identitate(${d.id},NULL,'Motiv suficient de lung')`)
    assert.match(nullToken.error, /baza s-a schimbat/)
    await refuza(a, `UPDATE ofertare_clarificari SET baza_generare=baza_generare||'{"exceptie_identitate":{"token":"fals"}}'::jsonb WHERE id=${d.id}`, 'doar prin reconfirmare')
    assert.deepEqual((await state(a, d)).baza_generare, before)
    assert.equal(await observer.value("to_jsonb(has_function_privilege('anon','public.ofertare_clarificare_exceptie_identitate(bigint,text,text)','EXECUTE'))"), false)
    const fn = await observer.value(`(SELECT jsonb_build_object('definer',p.prosecdef,'config',p.proconfig)
      FROM pg_proc p WHERE p.oid='public.ofertare_clarificare_exceptie_identitate(bigint,text,text)'::regprocedure)`)
    assert.equal(fn.definer, true)
    assert.ok(fn.config.includes('search_path=public, pg_temp'))
  } finally { await denied.close(); await anonymous.close() }
}])

teste.push(['F04 B — manifest eligibil după document_id, ultimul verificat; mărime diferită și lot mixt blochează', async ({ observer, a }) => {
  const d = await draft(observer)
  const baza = () => a.value(`ofertare_f3_baza(${d.lic})`)
  let b = await baza()
  assert.equal(b.documente[0].identitate, 'verificata')
  assert.equal(b.documente[0].sha256, 'a'.repeat(64))
  await approved(observer, a, d)
  await a.command(`UPDATE ofertare_clarificari SET status='de_trimis' WHERE id=${d.id};`)
  assert.equal((await a.value(`ofertare_clarificari_export(${d.lic})`)).length, 1)
  await observer.command(`UPDATE ofertare_seap_manifest SET verificat_la='2020-01-01' WHERE document_id=${d.lic};
    INSERT INTO ofertare_seap_manifest(licitatie_id,document_id,arhiva_cheie,cale,marime,sha256,stare,verificat_la)
      VALUES (${d.lic},${d.lic},'nou','plansa.pdf',123,repeat('b',64),'urcat','2021-01-01'),
             (${d.lic},${d.lic},'neeligibil','plansa.pdf',999,repeat('c',64),'urcat','2022-01-01');`)
  const nou = await baza()
  assert.equal(nou.documente[0].sha256, 'b'.repeat(64))
  assert.notEqual(nou.amprenta, b.amprenta)
  await refuza(a, `SELECT ofertare_clarificari_export(${d.lic})`, 'Export blocat:.*baza s-a schimbat')
  await reconfirmaF04(a, d)
  assert.equal((await state(a, d)).stare, 'ok')
  // Același nume, alt id: nu moștenește hashul. Documentul nerelevant nu blochează.
  const id = ++next
  await observer.command(`INSERT INTO ofertare_documente_atribuire(id,licitatie_id,nume_original,tip,size_bytes)
    VALUES (${id},${d.lic},'Plansa test.pdf','alt',123);`)
  assert.equal((await state(a, d)).stare, 'ok')
  await observer.command(`UPDATE ofertare_documente_atribuire SET tip='lista_cantitati',analiza='{"integritate":{"sha256":"invalid"}}' WHERE id=${id};`)
  b = await baza()
  assert.equal(b.documente.find(x => x.id === id).identitate, 'limitata')
  assert.equal((await state(a, d)).stare, 'identitate_limitata')
  await refuza(a, `SELECT ofertare_clarificari_export(${d.lic})`, 'Identitate limitată')
  await observer.command(`UPDATE ofertare_documente_atribuire SET size_bytes=124 WHERE id=${d.lic};`)
  assert.ok((await baza()).documente.every(x => x.identitate === 'limitata'))
}])

teste.push(['F04 B — regenerarea înainte de reconfirmare păstrează auditul; excepția rămâne per ciornă', async ({ observer, a }) => {
  const d = await draft(observer)
  await limitaF04(observer, d)
  const inainte = await state(a, d)
  assert.equal((await exceptieF04(a, d, inainte.amprenta_curenta)).ok, true)
  const ex = (await state(a, d)).baza_generare.exceptie_identitate
  // Altă ciornă, aceeași licitație și același text: acceptarea primei nu se transferă.
  const id = JSON.parse(await observer.command(`INSERT INTO ofertare_clarificari(licitatie_id,cheie,origine,status,intrebare,baza_generare)
    VALUES (${d.lic},'auto_planse_alta','automat','propunere',${sqlText(inainte.intrebare)},ofertare_f3_baza(${d.lic})) RETURNING to_jsonb(id);`))
  const alta = { ...d, id }
  await reconfirmaF04(a, alta)
  assert.equal((await state(a, alta)).stare, 'identitate_limitata')
  await a.command(`UPDATE ofertare_clarificari SET status='retrasa' WHERE id=${id};`)
  // Un motiv nou în planșă schimbă textul generat; propunerea originală nu este încă reconfirmată.
  await observer.command(`UPDATE ofertare_documente_atribuire
    SET analiza='{"plansa":{"rezultat":"citita_fara_date_cantitative","citibila":false}}' WHERE id=${d.lic};`)
  await observer.value(`ofertare_clarificare_planse_auto(${d.lic})`)
  const dupa = await state(a, d)
  assert.notEqual(dupa.intrebare, inainte.intrebare)
  assert.equal(dupa.baza_generare.exceptie_identitate, undefined)
  assert.deepEqual(dupa.baza_generare.istoric_decizii.find(x => x.decizie === 'exceptie_identitate'), ex)
  assert.equal(dupa.stare, 'identitate_limitata')
}])

teste.push(['F04 B — luat_act nu înlătură identitatea limitată după transmitere', async ({ observer, a }) => {
  const d = await draft(observer)
  await approved(observer, a, d)
  await a.command(`UPDATE ofertare_clarificari SET status='trimisa' WHERE id=${d.id};`)
  await limitaF04(observer, d)
  const st = await state(a, d)
  const r = await a.value(`ofertare_clarificare_reconfirma(${d.id},${sqlText(st.amprenta_curenta)},'luat_act','Am luat act de documentele fără identitate')`)
  assert.equal(r.ok, true)
  assert.equal((await state(a, d)).stare, 'identitate_limitata')
}])

await runTests(teste, { reviewF: true })
