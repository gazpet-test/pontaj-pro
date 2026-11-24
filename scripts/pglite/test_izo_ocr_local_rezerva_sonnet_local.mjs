// Proba LOCALĂ a migrării 20270109a (Izometrie E3 / OCR local: rezerva apelului plătit 0,05 → 0,20 USD, fallback + arbitraj pe Sonnet 5.5)
// pe PGlite — NU atinge nicio bază reală.
// Baza: roluri tip Supabase + public.profiles minimal + migrările REALE 20261105a (plafonul AI), 20261108a + 20261108b (coada OCR local),
//   aplicate cu marcajul runnerului (gazpet.livrare_migrare). Migrarea și revenirea rulează ca runnerul: plafonul tranzacției (5000 / 2000,
//   sesiune) + marcajul prologului; pentru migrare și tabela temporară a pasului „înainte” L15 v2 (ag_ina_<16 hex>) — aici SIMULATĂ (manifestul
//   L15 v2 real și validatorul runnerului le rulează coordonatorul pe clonă).
// 1. Amprentele din migrare / revenire = calculate aici: corpul fn_ocr_local_rezerva_apel (din textul 20261108a ȘI din baza aplicată), ACL-ul,
//    lista CHECK-urilor (deparsate de server) = blocurile „CHECK-URI”.
// 2. Semantica: înainte, fn_ocr_local_rezerva_apel rezervă 0,05; după migrare 0,20 (= costul maxim Sonnet 0,196 rotunjit); după revenire 0,05;
//    reaplicarea după revenire merge.
// 3. Refuzurile (nimic schimbat): fără marcaj, fără plafon / alt plafon, fără pasul L15 v2, reaplicare, CHECK schimbat, RPC schimbat;
//    revenirea pe starea veche. MUTANȚI pe textul migrării / revenirii.
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_izo_ocr_local_rezerva_sonnet_local.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const F_MIG = 'supabase/migrations/20270109a_izo_ocr_local_rezerva_sonnet.sql'
const F_REV = 'supabase/revenire/20270109a_izo_ocr_local_rezerva_sonnet_ROLLBACK.sql'
const MIG = citeste(F_MIG), REV = citeste(F_REV)
const M05A = citeste('supabase/migrations/20261105a_ai_plafon_lunar.sql')
const M08A = citeste('supabase/migrations/20261108a_ocr_local_cereri.sql')
const M08B = citeste('supabase/migrations/20261108b_ocr_local_admite_fix.sql')
const NUME = '20270109a_izo_ocr_local_rezerva_sonnet', NUME_REV = NUME + '_ROLLBACK'

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }
function corp(text, cap) {
  const i = text.indexOf(cap)
  if (i < 0) throw new Error('nu găsesc ' + cap)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(text.slice(i))
  const start = i + a.index + a[0].length
  return text.slice(start, text.indexOf(a[1], start))
}

// Schema falsă minimă tip Supabase: rolurile (service_role cu BYPASSRLS), profiles (FK-ul cozii), auth.uid() din claim.
const SCHELET = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_owner boolean NOT NULL DEFAULT false);
INSERT INTO public.profiles(id) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc');`

async function bazaNoua() {
  const db = await PGlite.create()
  await db.exec(SCHELET)
  for (const [nume, text] of [['20261105a_ai_plafon_lunar', M05A], ['20261108a_ocr_local_cereri', M08A], ['20261108b_ocr_local_admite_fix', M08B]]) {
    await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);\n${text}\nCOMMIT;`)
  }
  return db
}
// Livrarea ca runnerul: plafonul de sesiune ÎNAINTE de BEGIN, marcajele prologului, (migrare) pasul „înainte” L15 v2 simulat.
async function livreaza(db, text, { nume = NUME, plafon = 5000, marcajPlafon = plafon, ag = true, marcaj = true } = {}) {
  await db.exec(plafon === null ? 'RESET transaction_timeout' : `SET transaction_timeout = ${plafon}`)
  const prolog = [
    marcaj ? `SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);` : '',
    marcajPlafon === null ? '' : `SELECT set_config('gazpet.plafon_tranzactie', '${marcajPlafon}:' || txid_current(), true);`,
    ag ? 'CREATE TEMP TABLE ag_ina_0123456789abcdef (x int);' : '',
  ].join('\n')
  const note = []
  try {
    await db.exec(`BEGIN;\n${prolog}\n${text}\nCOMMIT;`, { onNotice: n => note.push(n.message) })
    return { ok: true, note }
  } catch (e) {
    try { await db.exec('ROLLBACK') } catch { /* deja închisă */ }
    return { ok: false, eroare: String(e.message), note }
  } finally {
    await db.exec('RESET transaction_timeout; DROP TABLE IF EXISTS pg_temp.ag_ina_0123456789abcdef')
  }
}
const stare = async db => {
  const r = await db.query(`SELECT c.rezerva_usd::text AS rezerva, (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute t
      ON t.attrelid = d.adrelid AND t.attnum = d.adnum WHERE d.adrelid = 'public.ocr_local_config'::regclass AND t.attname = 'rezerva_usd') AS implicit,
    (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ocr_local_config_rezerva_usd_check') AS check_def
    FROM public.ocr_local_config c`)
  return r.rows[0]
}
// O cerere în fallback cu dreptul acordat (ca după fn_ocr_local_drept_platit) → fn_ocr_local_rezerva_apel → suma rezervată.
let nrCerere = 0
async function rezerva(db) {
  const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(++nrCerere).padStart(12, '0')}`
  await db.exec(`INSERT INTO public.ocr_local_cereri (id, proiect_id, depozit_id, sablon, creat_de, pdf_bytes, stare, ramura, termen_upload, termen_preluare,
      termen_local, termen_fallback, drept_platit_de, drept_platit_la, apel_faza, sterge_dupa)
    VALUES ('${id}', 1, 2, 'aviz_teava', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 1000, 'fallback', 'haiku', now(), now(), now() + interval '1 hour',
      now() + interval '1 hour', 'fallback', now(), 'acordat', now() + interval '7 days')`)
  const r = await db.query(`SELECT * FROM public.fn_ocr_local_rezerva_apel('${id}')`)
  const s = await db.query(`SELECT suma_rezervata::text AS suma FROM public.ai_plafon_rezervari WHERE id = $1`, [r.rows[0].rezervare_id])
  return { acordat: r.rows[0].acordat, suma: s.rows[0]?.suma }
}

console.log('1. amprentele din migrare / revenire = calculate (din textul 20261108a și din baza aplicată)')
const db = await bazaNoua()
{
  const amp = md5(corp(M08A, 'CREATE FUNCTION public.fn_ocr_local_rezerva_apel('))
  const dinBaza = (await db.query(`SELECT md5(replace(prosrc, chr(13), '')) AS m, coalesce(proacl, acldefault('f', proowner))::text AS acl,
      prosecdef, proconfig, pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid = to_regprocedure('public.fn_ocr_local_rezerva_apel(uuid)')`)).rows[0]
  ok(dinBaza.m === amp, `corpul fn_ocr_local_rezerva_apel: text 20261108a = baza (${amp})`)
  const aparitii = s => (s.match(new RegExp(`'${amp}'`, 'g')) || []).length
  ok(aparitii(MIG) === 2 && aparitii(REV) === 1, 'amprenta RPC-ului: în migrare (înainte + după) și în revenire')
  ok(dinBaza.acl === '{postgres=X/postgres,service_role=X/postgres}' && dinBaza.prosecdef && dinBaza.owner === 'postgres'
    && JSON.stringify(dinBaza.proconfig) === '["search_path=public, pg_temp"]', 'ACL / DEFINER / search_path / proprietar = cele verificate: ' + dinBaza.acl)
  ok(!/fn_ocr_local_rezerva_apel/.test(M08B), '20261108b nu înlocuiește fn_ocr_local_rezerva_apel')
  const checkuri = (await db.query(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'public.ocr_local_config'::regclass AND contype = 'c' ORDER BY conname`)).rows
  const bloc = (t, et) => [...t.slice(t.indexOf(`-- >>> CHECK-URI ${et}`), t.indexOf(`-- <<< CHECK-URI ${et}`)).matchAll(/\('([a-z_]+)', '((?:[^']|'')*)'\)/g)]
    .map(m => [m[1], m[2].replace(/''/g, "'")])
  const asteptat08 = checkuri.map(c => [c.conname, c.def])
  const asteptat09 = asteptat08.map(([n, d]) => [n, n === 'ocr_local_config_rezerva_usd_check' ? 'CHECK ((rezerva_usd = 0.20))' : d])
  ok(asteptat08.length === 10 && JSON.stringify(bloc(MIG, '20261108a')) === JSON.stringify(asteptat08), 'migrarea, starea de dinainte = CHECK-urile deparsate după 20261108a')
  ok(JSON.stringify(bloc(REV, '20261108a')) === JSON.stringify(asteptat08), 'revenirea, postcondiția = aceleași CHECK-uri')
  ok(JSON.stringify(bloc(MIG, '20270109a')) === JSON.stringify(asteptat09) && JSON.stringify(bloc(REV, '20270109a')) === JSON.stringify(asteptat09),
    'migrarea (postcondiția) + revenirea (starea de dinainte) = aceleași CHECK-uri, doar rezerva 0.20')
  ok(MIG.indexOf('LOCK TABLE public.ocr_local_config IN ACCESS EXCLUSIVE MODE;') > MIG.indexOf('END $pre$;')
    && MIG.indexOf('LOCK TABLE public.ocr_local_config') < MIG.indexOf('DO $stare$')
    && REV.indexOf('LOCK TABLE public.ocr_local_config') < REV.indexOf('DO $stare$'), 'lock-ul vine ÎNAINTEA verificărilor de stare (L14), în migrare și revenire')
  ok(!/\bBEGIN\s*;|\bCOMMIT\s*;|\bROLLBACK\s*;/i.test(MIG.replace(/\$[a-z]*\$[\s\S]*?\$[a-z]*\$/g, '')) && !/\bBEGIN\s*;|\bCOMMIT\s*;/i.test(REV.replace(/\$[a-z]*\$[\s\S]*?\$[a-z]*\$/g, '')),
    'fără control de tranzacție în fișiere (runnerul o deschide)')
}

console.log('2. semantica: 0,05 înainte → 0,20 după migrare → 0,05 după revenire → 0,20 după reaplicare')
{
  let s = await stare(db), r = await rezerva(db)
  ok(s.rezerva === '0.05' && s.implicit === '0.05' && s.check_def === 'CHECK ((rezerva_usd = 0.05))' && r.acordat && r.suma === '0.050000', 'înainte: config 0.05, rezervarea = 0.050000')
  const a = await livreaza(db, MIG)
  s = await stare(db); r = await rezerva(db)
  ok(a.ok, 'migrarea se aplică' + (a.ok ? '' : ': ' + a.eroare))
  ok(s.rezerva === '0.20' && s.implicit === '0.20' && s.check_def === 'CHECK ((rezerva_usd = 0.20))', `după: config ${s.rezerva}, implicit ${s.implicit}, ${s.check_def}`)
  ok(r.acordat && r.suma === '0.200000', 'după: fn_ocr_local_rezerva_apel rezervă 0.200000 = ' + r.suma)
  const costMaximSonnet = 46000 * 2 / 1e6 + 10400 * 10 / 1e6
  ok(Number(r.suma) >= costMaximSonnet && Number(r.suma) - costMaximSonnet < 0.01, `rezerva acoperă costul maxim Sonnet ${costMaximSonnet.toFixed(3)} (minimul justificat, rotunjit la 0,20)`)
  ok(a.note.some(n => /apeluri platite E3 in curs .*: 1$/.test(n)), 'NOTICE: apelurile plătite în curs numărate (1 rezervare deschisă la aplicare): ' + a.note.join(' | '))
  const re = await livreaza(db, MIG)
  ok(!re.ok && /deja 0\.20 \(reaplicare\)/.test(re.eroare), 'reaplicarea = refuz: ' + (re.eroare || ''))
  // revenirea: refuzată fără marcaj / cu plafonul migrării; apoi aplicată
  ok(!(await livreaza(db, REV, { nume: NUME_REV, plafon: 5000, ag: false })).ok, 'revenirea cu plafonul 5000 = refuz (cere 2000)')
  ok(!(await livreaza(db, REV, { nume: NUME, plafon: 2000, ag: false })).ok, 'revenirea cu marcajul migrării = refuz')
  const v = await livreaza(db, REV, { nume: NUME_REV, plafon: 2000, ag: false })
  s = await stare(db); r = await rezerva(db)
  ok(v.ok && s.rezerva === '0.05' && s.implicit === '0.05' && s.check_def === 'CHECK ((rezerva_usd = 0.05))' && r.suma === '0.050000',
    'revenirea: config / implicit / CHECK / rezervarea înapoi la 0.05' + (v.ok ? '' : ': ' + v.eroare))
  const v2 = await livreaza(db, REV, { nume: NUME_REV, plafon: 2000, ag: false })
  ok(!v2.ok && /nu e in starea din 20270109a/.test(v2.eroare), 'revenirea pe starea veche = refuz: ' + (v2.eroare || ''))
  const a2 = await livreaza(db, MIG)
  s = await stare(db); r = await rezerva(db)
  ok(a2.ok && s.rezerva === '0.20' && r.suma === '0.200000', 'reaplicarea după revenire: 0.20' + (a2.ok ? '' : ': ' + a2.eroare))
  // rezervările vechi își păstrează suma
  const vechi = (await db.query(`SELECT array_agg(suma_rezervata::text ORDER BY id) AS s FROM public.ai_plafon_rezervari`)).rows[0].s
  ok(JSON.stringify(vechi) === JSON.stringify(['0.050000', '0.200000', '0.050000', '0.200000']), 'rezervările deschise înainte își păstrează suma: ' + vechi.join(', '))
}
await db.close()

console.log('3. refuzurile migrării (pe bază nouă, nimic schimbat)')
for (const [eticheta, opt, motiv, pregatire] of [
  ['fără marcajul runnerului', { marcaj: false }, /garda start invalida/],
  ['fără plafonul tranzacției', { plafon: null, marcajPlafon: null }, /PLAFON_TRANZACTIE lipsa/],
  ['cu plafonul 2000', { plafon: 2000, marcajPlafon: 2000 }, /PLAFON_TRANZACTIE lipsa/],
  ['plafon fără marcajul prologului', { marcajPlafon: null }, /PLAFON_TRANZACTIE lipsa/],
  ['fără pasul „înainte” L15 v2', { ag: false }, /AMPRENTA_GLOBALA_LIPSA/],
  ['CHECK-ul plafonului schimbat', {}, /CHECK-urile ocr_local_config difera de 20261108a: ocr_local_config_plafon_usd_check/,
    'ALTER TABLE public.ocr_local_config DROP CONSTRAINT ocr_local_config_plafon_usd_check, ADD CONSTRAINT ocr_local_config_plafon_usd_check CHECK (plafon_usd >= 10)'],
  ['un CHECK în plus', {}, /\+ocr_local_config_alt/, 'ALTER TABLE public.ocr_local_config ADD CONSTRAINT ocr_local_config_alt CHECK (rezerva_usd > 0)'],
  ['valoarea implicită schimbată', {}, /valoarea implicita a rezerva_usd nu e 0.05/, 'ALTER TABLE public.ocr_local_config ALTER COLUMN rezerva_usd SET DEFAULT 0.050'],
  ['RPC-ul schimbat (corp)', {}, /fn_ocr_local_rezerva_apel nu e cea din 20261108a/,
    `DO $x$ BEGIN EXECUTE replace(pg_get_functiondef('public.fn_ocr_local_rezerva_apel(uuid)'::regprocedure), 'c.rezerva_usd', 'c.rezerva_usd * 2'); END $x$`],
  ['RPC-ul cu drept în plus', {}, /fn_ocr_local_rezerva_apel nu e cea din 20261108a/, 'GRANT EXECUTE ON FUNCTION public.fn_ocr_local_rezerva_apel(uuid) TO authenticated'],
]) {
  const b = await bazaNoua()
  if (pregatire) await b.exec(pregatire)
  const inainte = await stare(b)
  const r = await livreaza(b, MIG, opt)
  const dupa = await stare(b)
  ok(!r.ok && motiv.test(r.eroare) && JSON.stringify(inainte) === JSON.stringify(dupa), `${eticheta}: refuz, nimic schimbat (${(r.eroare || 'APLICAT').slice(0, 110)})`)
  await b.close()
}

console.log('4. mutanți pe textul migrării / revenirii (fiecare trebuie prins)')
const mutanti = [
  ['migrare: fără garda AMPRENTA_GLOBALA', F_MIG, /  IF NOT EXISTS \(SELECT 1 FROM pg_class c WHERE c\.relnamespace = pg_my_temp_schema\(\)[\s\S]*?nimic schimbat';\n  END IF;\n/, ''],
  ['migrare: fără refuzul reaplicării', F_MIG, /  IF EXISTS \(SELECT 1 FROM public\.ocr_local_config WHERE id AND rezerva_usd = 0\.20\) THEN\n    RAISE EXCEPTION '20270109a: rezerva e deja 0\.20 \(reaplicare\)';\n  END IF;\n/, ''],
  ['migrare: fără verificarea CHECK-urilor de dinainte', F_MIG, /  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270109a: CHECK-urile ocr_local_config difera de 20261108a: %', v_rau; END IF;\n/, ''],
  ['migrare: fără verificarea RPC-ului', F_MIG, /md5\(replace\(p\.prosrc, chr\(13\), ''\)\) = 'e24930150252c190a33a9c0b58665525'\n                   AND p\.prosecdef AND p\.proconfig = ARRAY\['search_path=public, pg_temp'\] AND pg_get_userbyid\(p\.proowner\) = 'postgres'\n                   AND coalesce\(p\.proacl, acldefault\('f', p\.proowner\)\)::text = '\{postgres=X\/postgres,service_role=X\/postgres\}'\) THEN\n    RAISE EXCEPTION '20270109a: fn_ocr_local_rezerva_apel nu e cea din 20261108a/, "true) THEN\n    RAISE EXCEPTION '20270109a: fn_ocr_local_rezerva_apel nu e cea din 20261108a"],
  ['migrare: rezerva 0,10 (sub costul maxim Sonnet)', F_MIG, /rezerva_usd = 0\.20 WHERE id AND rezerva_usd = 0\.05;\nALTER TABLE public\.ocr_local_config\n  ADD CONSTRAINT ocr_local_config_rezerva_usd_check CHECK \(rezerva_usd = 0\.20\),\n  ALTER COLUMN rezerva_usd SET DEFAULT 0\.20;/,
    'rezerva_usd = 0.10 WHERE id AND rezerva_usd = 0.05;\nALTER TABLE public.ocr_local_config\n  ADD CONSTRAINT ocr_local_config_rezerva_usd_check CHECK (rezerva_usd = 0.10),\n  ALTER COLUMN rezerva_usd SET DEFAULT 0.10;'],
  ['migrare: fără valoarea implicită nouă', F_MIG, /,\n  ALTER COLUMN rezerva_usd SET DEFAULT 0\.20;/, ';'],
  ['revenire: rezerva rămâne 0,20 în rând', F_REV, /UPDATE public\.ocr_local_config SET rezerva_usd = 0\.05 WHERE id AND rezerva_usd = 0\.20;\n/, ''],
  ['revenire: fără verificarea stării de dinainte', F_REV, /  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270109a revenire: CHECK-urile ocr_local_config difera de 20270109a: %', v_rau; END IF;\n/, ''],
]
// Scenariul fiecărui mutant = cel din secțiunile 2–3 care îl vizează; rezultatul (aplicat / mesajul refuzului + starea finală) pe textul
// ORIGINAL e cel verificat mai sus. Mutantul e PRINS dacă același scenariu dă alt rezultat (o verificare de mai sus ar pica).
const CHECK_STRAIN = 'ALTER TABLE public.ocr_local_config ADD CONSTRAINT ocr_local_config_alt CHECK (rezerva_usd > 0)'
const scenarii = {
  faraL15: async (b, m) => livreaza(b, m, { ag: false }),
  reaplicare: async (b, m) => { await livreaza(b, m); return livreaza(b, m) },
  checkStrain: async (b, m) => { await b.exec(CHECK_STRAIN); return livreaza(b, m) },
  rpcSchimbat: async (b, m) => { await b.exec('GRANT EXECUTE ON FUNCTION public.fn_ocr_local_rezerva_apel(uuid) TO authenticated'); return livreaza(b, m) },
  aplicare: async (b, m) => livreaza(b, m),
  revenire: async (b, m) => { await livreaza(b, MIG); return livreaza(b, m, { nume: NUME_REV, plafon: 2000, ag: false }) },
  revenireStrain: async (b, m) => { await livreaza(b, MIG); await b.exec(CHECK_STRAIN); return livreaza(b, m, { nume: NUME_REV, plafon: 2000, ag: false }) },
}
const rezultat = async (scenariu, text) => {
  const b = await bazaNoua()
  const r = await scenarii[scenariu](b, text)
  const s = await stare(b); await b.close()
  return `${r.ok ? 'APLICAT' : 'REFUZ ' + r.eroare} | ${JSON.stringify(s)}`
}
for (const [eticheta, fisier, din, in_, scenariu] of mutanti.map((m, i) => [...m, ['faraL15', 'reaplicare', 'checkStrain', 'rpcSchimbat', 'aplicare', 'aplicare', 'revenire', 'revenireStrain'][i]])) {
  const original = fisier === F_MIG ? MIG : REV
  ok(din.test(original), `${eticheta}: textul mutat există`)
  const mutat = original.replace(din, in_)
  const [ro, rm] = [await rezultat(scenariu, fisier === F_MIG ? MIG : REV), await rezultat(scenariu, mutat)]
  ok(ro !== rm, `mutant prins — ${eticheta}: original «${ro.slice(0, 90)}» ≠ mutant «${rm.slice(0, 90)}»`)
}

console.log(esec ? `\nESEC: ${esec} verificări picate` : '\nTOATE VERIFICĂRILE AU TRECUT')
process.exit(esec ? 1 : 0)
