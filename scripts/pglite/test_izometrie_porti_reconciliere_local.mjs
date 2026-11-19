// Proba LOCALĂ a migrării 20261230a_izometrie_porti_reconciliere (TKT-2026-0393) pe PGlite (Postgres în WASM, în memorie) — NU atinge nicio
// bază reală.
// Baza: schema falsă supabase/tests/20261230a_izometrie_porti_reconciliere_schelet.sql + funcțiile porților REALE, extrase exact din migrări:
//   fn_izo_porti_lipsa (20261109b, corpul de pe producție), fn_izo_porti_definitii (20261102a), fn_izo_porti_e3_definitii (20261103b),
//   fn_izo_porti_e3b_definitii (20261106a), fn_izo_porti_e4_definitii (20261109a), fn_izo_porti_e4b_definitii (20261120a), fn_izo_porti_e4b_lipsa
//   (20261109b), handle_new_user (20260929c, apoi 20261119a) + trigger-ul on_auth_user_created, porțile portalului (20261118a / 20261119a).
//   Porțile E3 / E3b / E4 (fn_izo_porti_e3_lipsa / e3b / e4) sunt înlocuite în fixture cu verificarea ștampilei lor (restul lor cere toată
//   schema Izometrie); md5-ul corpurilor reale e verificat static în src/izoPortiReconciliere.test.js.
// 1. ISTORIA ca pe producție: starea de la 20261120a (ștampile puse, poarta E2 verde — dovada că fixture-ul e complet), apoi schimbările de
//    după: drepturile anon retrase de pe secvență (20261218a), garda de acces pe proiect (20261209a: trigger-e + politici RESTRICTIVE),
//    trigger-ul fibrei (20261211a), porțile portalului (20261118a / 19a) și corpul nou al handle_new_user (20261119a) ⇒ poarta roșie, cu
//    exact semnalele de pe producție (ștampilele + cele două semnale E2).
// 2. BASELINE: valorile de producție din migrare care depind de mediu (ștampilele, definițiile, corpurile porților E3 / E4 din fixture) se
//    înlocuiesc cu cele ale fixture-ului; cele care NU depind de mediu (corpul + ACL-ul porții E2, corpul fn_izo_porti_definitii, amprenta
//    trigger-ului, amprentele portalului) rămân cele de producție și trebuie să se potrivească (verificare independentă, L25).
// 3. APLICAREA ca runnerul (plafon 5000 + marcaje + tabelul temporar al amprentei globale) ⇒ toate porțile verzi; verificări (L25: valori
//    așteptate scrise de mână): corpul = vechiul + exact cele două schimbări, proprietăți / ACL neschimbate, ștampilele, E3 / E3b / E4 egale.
// 4. REFUZURI: fără marcaj / plafon / amprenta globală; fiecare gardă PRE cu o valoare diferită (mutanți pe date), nimic schimbat.
// 5. MUTANȚI pe migrare: fiecare trebuie să pice (altfel testul nu dovedește nimic): doar una dintre schimbări (cu md5 ajustat), o schimbare
//    în plus în corp, ștampilele înaintea corpului, o ștampilă lipsă, o altă funcție / alt comentariu atins.
// 6. REVENIREA: aplicare → revenire (starea de dinainte EXACT, aceleași semnale) → re-aplicare; refuz pe starea neaplicată / schimbată;
//    mutanți ai revenirii. Validatorul REAL al runnerului pe ambele fișiere (plafonul cerut = cel dat, altfel refuz).
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_izometrie_porti_reconciliere_local.mjs
// Limită: PGlite nu are timere și nici concurență reală (plafonul, lock-ul consultativ și pasul „după” al amprentei globale se probează pe
//   clonă, cu runnerul); costul real al porții se măsoară acolo.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'izo_rec_'))
const citeste = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const md5 = (s) => createHash('md5').update(Buffer.from(s, 'utf8')).digest('hex')
const NUME = '20261230a_izometrie_porti_reconciliere'
const MIG = citeste(`supabase/migrations/${NUME}.sql`)
const REV = citeste(`supabase/revenire/${NUME}_ROLLBACK.sql`)
const SCHELET = citeste('supabase/tests/20261230a_izometrie_porti_reconciliere_schelet.sql')

let esecuri = 0, trecute = 0
const ok = (cond, ce, detaliu = '') => {
  if (cond) { trecute++; console.log('  ok  ' + ce) } else { esecuri++; console.log('  ESEC ' + ce + (detaliu ? ' — ' + detaliu : '')) }
}

// o instrucțiune CREATE … din fișierul unei migrări, de la marcaj până la închiderea dollar-quote-ului ei + „;”
function instructiune(rel, marcaj, nth = 0) {
  const t = citeste(rel)
  let i = -1
  for (let k = 0; k <= nth; k++) { i = t.indexOf(marcaj, i + 1); if (i < 0) throw new Error(`lipsește în ${rel}: ${marcaj}`) }
  const m = /AS\s+(\$[A-Za-z_]*\$)/.exec(t.slice(i))
  const a = i + m.index + m[0].length
  const b = t.indexOf(m[1], a)
  if (t[b + m[1].length] !== ';') throw new Error(`închidere neașteptată în ${rel}: ${marcaj}`)
  return t.slice(i, b + m[1].length + 1)
}
const FN = {
  lipsa: instructiune('supabase/migrations/20261109b_izometrie_e4b_teren.sql', 'CREATE OR REPLACE FUNCTION public.fn_izo_porti_lipsa() RETURNS text[]'),
  def: instructiune('supabase/migrations/20261102a_izometrie_e2a_registru.sql', 'CREATE FUNCTION public.fn_izo_porti_definitii() RETURNS text'),
  e3: instructiune('supabase/migrations/20261103b_izometrie_e3_documente.sql', 'CREATE FUNCTION public.fn_izo_porti_e3_definitii() RETURNS text'),
  e3b: instructiune('supabase/migrations/20261106a_izometrie_e3b_corectii.sql', 'CREATE FUNCTION public.fn_izo_porti_e3b_definitii() RETURNS text'),
  e4: instructiune('supabase/migrations/20261109a_izometrie_e4a_flux.sql', 'CREATE FUNCTION public.fn_izo_porti_e4_definitii() RETURNS text'),
  e4b: instructiune('supabase/migrations/20261120a_izometrie_aviz_iesire.sql', 'CREATE OR REPLACE FUNCTION public.fn_izo_porti_e4b_definitii() RETURNS text'),
  e4b_lipsa: instructiune('supabase/migrations/20261109b_izometrie_e4b_teren.sql', 'CREATE FUNCTION public.fn_izo_porti_e4b_lipsa() RETURNS text[]'),
  hnu_vechi: instructiune('supabase/migrations/20260929c_conturi_legare_automata.sql', 'CREATE OR REPLACE FUNCTION public.handle_new_user()'),
  hnu_nou: instructiune('supabase/migrations/20261119a_portal_teren_provisioning.sql', 'CREATE OR REPLACE FUNCTION public.handle_new_user()'),
  portal: instructiune('supabase/migrations/20261118a_portal_teren_identitate.sql', 'CREATE FUNCTION public.fn_portal_porti_lipsa() RETURNS text[]'),
  portal_snap: instructiune('supabase/migrations/20261119a_portal_teren_provisioning.sql', 'CREATE FUNCTION public.fn_portal_1b_snapshot() RETURNS jsonb'),
  portal_1b: instructiune('supabase/migrations/20261119a_portal_teren_provisioning.sql', 'CREATE FUNCTION public.fn_portal_porti_lipsa_1b() RETURNS text[]'),
}
// porțile E3 / E3b / E4 în fixture: doar verificarea ștampilei (forma lui fn_izo_porti_e4b_lipsa)
const stub = (n, pref) => `CREATE FUNCTION public.fn_izo_porti_${n}_lipsa() RETURNS text[]
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 BEGIN
  IF public.fn_izo_porti_${n}_definitii() IS DISTINCT FROM substring(obj_description('public.fn_izo_porti_${n}_definitii()'::regprocedure,'pg_proc') FROM '^${pref}=([0-9a-f]{32})$') THEN RETURN ARRAY['${n.toUpperCase()} definitii diferite (fixture)']; END IF;
  RETURN '{}'::text[];
 END $f$;`
const STAMPILE = [['fn_izo_porti_definitii', 'porti'], ['fn_izo_porti_e3_definitii', 'porti_e3'], ['fn_izo_porti_e3b_definitii', 'porti_e3b'],
  ['fn_izo_porti_e4_definitii', 'porti_e4'], ['fn_izo_porti_e4b_definitii', 'porti_e4b']]
const STAMPEAZA = STAMPILE.map(([f, p]) => `DO $s$ BEGIN EXECUTE format('COMMENT ON FUNCTION public.${f}() IS %L', '${p}=' || public.${f}()); END $s$;`).join('\n')
const ACL_E2 = `REVOKE ALL ON FUNCTION public.fn_izo_porti_lipsa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_izo_porti_lipsa() TO izo_registru_writer;
GRANT EXECUTE ON FUNCTION public.fn_izo_porti_lipsa() TO izo_doc_editor;
GRANT EXECUTE ON FUNCTION public.fn_izo_porti_lipsa() TO izo_receptie_writer;
GRANT EXECUTE ON FUNCTION public.fn_izo_porti_lipsa() TO izo_cor_editor;
GRANT EXECUTE ON FUNCTION public.fn_izo_porti_lipsa() TO izo_corectie_writer;`
// starea de la 20261120a
const STAREA_20A = [SCHELET, 'SET check_function_bodies = off;', FN.def, FN.e3, FN.e3b, FN.e4, FN.e4b, stub('e3', 'porti_e3'), stub('e3b', 'porti_e3b'),
  stub('e4', 'porti_e4'), FN.e4b_lipsa, FN.lipsa, ACL_E2, FN.hnu_vechi,
  'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();',
  'RESET check_function_bodies;', STAMPEAZA].join('\n')
// schimbările de după 20261120a, ca pe producție
const ISTORIA = `SET check_function_bodies = off;
-- 20261218a (T1): anon retras de pe secvențe
REVOKE ALL ON SEQUENCE public.magazie_bucati_id_seq FROM anon;
-- 20261209a: garda de acces pe proiect
CREATE FUNCTION public.fn_executie_acces_garda() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;
CREATE TRIGGER trg_executie_acces_garda BEFORE INSERT OR UPDATE ON public.executie_tevi FOR EACH ROW EXECUTE FUNCTION public.fn_executie_acces_garda();
CREATE TRIGGER trg_executie_acces_garda BEFORE INSERT OR UPDATE ON public.executie_pachete_lansare FOR EACH ROW EXECUTE FUNCTION public.fn_executie_acces_garda();
CREATE TRIGGER trg_executie_acces_garda BEFORE INSERT OR UPDATE ON public.executie_pachete_documente FOR EACH ROW EXECUTE FUNCTION public.fn_executie_acces_garda();
CREATE TRIGGER trg_executie_acces_garda BEFORE INSERT OR UPDATE ON public.executie_tronsoane FOR EACH ROW EXECUTE FUNCTION public.fn_executie_acces_garda();
CREATE POLICY executie_acces_citire ON public.executie_proiecte AS RESTRICTIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY executie_acces_adauga ON public.executie_proiecte AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY executie_acces_citire ON public.executie_tronsoane AS RESTRICTIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY executie_acces_adauga ON public.executie_tronsoane AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (true);
-- 20261211a: trigger-ul fibrei
CREATE FUNCTION public.fn_executie_fibra_garda_tronson() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;
CREATE TRIGGER trg_executie_fibra_garda_tronson BEFORE UPDATE ON public.executie_tronsoane FOR EACH ROW EXECUTE FUNCTION public.fn_executie_fibra_garda_tronson();
-- 20261118a / 20261119a: porțile portalului (doar postgres le execută) + corpul nou al handle_new_user
${FN.portal}
REVOKE ALL ON FUNCTION public.fn_portal_porti_lipsa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_portal_porti_lipsa() TO postgres;
${FN.portal_snap}
REVOKE ALL ON FUNCTION public.fn_portal_1b_snapshot() FROM PUBLIC;
${FN.portal_1b}
REVOKE ALL ON FUNCTION public.fn_portal_porti_lipsa_1b() FROM PUBLIC;
${FN.hnu_nou}
RESET check_function_bodies;`

const q1 = async (db, sql) => (await db.query(sql)).rows[0]
const val = async (db, sql) => Object.values(await q1(db, sql))[0]
async function bazaNoua() {
  const db = new PGlite()
  await db.exec(STAREA_20A)
  return db
}
const lipsa = async (db) => (await val(db, 'SELECT public.fn_izo_porti_lipsa() AS v')) || []
const corpPoarta = async (db) => val(db, "SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_izo_porti_lipsa()'::regprocedure")
async function stare(db) {
  return (await db.query(`SELECT jsonb_build_object(
      'corp', (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_izo_porti_lipsa()'::regprocedure),
      'acl', (SELECT proacl::text FROM pg_proc WHERE oid = 'public.fn_izo_porti_lipsa()'::regprocedure),
      'stampile', (SELECT jsonb_agg(obj_description(to_regprocedure('public.' || f || '()'), 'pg_proc') ORDER BY o)
                     FROM unnest(ARRAY['fn_izo_porti_definitii','fn_izo_porti_e3_definitii','fn_izo_porti_e3b_definitii','fn_izo_porti_e4_definitii','fn_izo_porti_e4b_definitii'])
                          WITH ORDINALITY u(f, o)),
      'definitii', jsonb_build_array(public.fn_izo_porti_definitii(), public.fn_izo_porti_e3_definitii(), public.fn_izo_porti_e3b_definitii(),
                                     public.fn_izo_porti_e4_definitii(), public.fn_izo_porti_e4b_definitii()),
      'functii', (SELECT md5(string_agg(p.oid::text || md5(p.prosrc) || coalesce(p.proacl::text, '') || coalesce(p.proconfig::text, ''), ',' ORDER BY p.oid))
                    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public', 'auth', 'storage'))) AS s`)).rows[0].s
}

// aplicarea ca runnerul: SET de sesiune înainte de BEGIN, marcajele (livrare + plafon) în tranzacție, tabelul temporar al pasului „înainte”
// al amprentei globale; COMMIT. Întoarce null la succes sau mesajul erorii (tranzacția anulată)
async function caRunner(db, nume, text, { plafon = 5000, marcaj = true, marcajPlafon = true, ag = true, inainte = '' } = {}) {
  await db.exec(`SET transaction_timeout = ${plafon};`)
  await db.exec('BEGIN')
  try {
    if (inainte) await db.exec(inainte)
    if (marcajPlafon) await db.query(`SELECT set_config('gazpet.plafon_tranzactie', '${plafon}:' || txid_current(), true)`)
    if (marcaj) await db.query(`SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true)`)
    if (ag) await db.exec('CREATE TEMP TABLE ag_ina_0123456789abcdef (familie text) ON COMMIT DROP;')
    await db.exec(text)
    await db.exec('COMMIT')
    return null
  } catch (e) {
    await db.exec('ROLLBACK')
    return String(e.message || e)
  } finally {
    await db.exec('RESET transaction_timeout;')
  }
}
// harta prod → fixture, DOAR pentru valorile dependente de mediu (ștampilele, definițiile, corpurile stub E3 / E4), calculată pe fiecare bază
const PROD_STAMPILE = ['a79c07584550c02aa32f30b7b4b56646', '785fed7197be69709988bada9e598bd4', '869a529d41f6891a545a7541696f9df7',
  'be112fb7cdbb55aa8f2b530430a4d9fd', '696f226046c3ae662ac889562edac863']
const PROD_ACUM = ['0839b958877f2c4b82d50905296c7b10', 'ee2e2689d3e35e820f221e93613e5a58', '54d2b5e3f17bc8778589f7e18cc057cd',
  'e9b5542202e21594b62997fbfd9ebd12', '1aaa23cc057b6d698c74a29c38887cb9']
async function textePentru(baza, st) {
  const harta = []
  st.stampile.forEach((s, i) => harta.push([PROD_STAMPILE[i], s.split('=')[1]]))
  st.definitii.forEach((d, i) => harta.push([PROD_ACUM[i], d]))
  harta.push(['f8510ff654386d504539ca4bbf2427c7', await val(baza, "SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_izo_porti_e3_lipsa()'::regprocedure")])
  harta.push(['6905733e1c2ccddce2a5757757f24b6b', await val(baza, "SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_izo_porti_e4_lipsa()'::regprocedure")])
  return { harta, M: aplica(MIG, harta.filter(([a]) => MIG.includes(a))), R: aplica(REV, harta.filter(([a]) => REV.includes(a))) }
}
// o bază nouă adusă la starea de pe producție, cu textele ei
async function instanta() {
  const b = await bazaNoua(); await b.exec(ISTORIA)
  const st = await stare(b)
  return { db: b, st, ...(await textePentru(b, st)) }
}
function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista) {
    const n = t.split(din).length - 1
    if (n < 1) throw new Error('mutantul / harta nu găsește textul: ' + din.slice(0, 100))
    t = t.split(din).join(in_)
  }
  return t
}

console.log('1. istoria ca pe producție')
const db = await bazaNoua()
ok(JSON.stringify(await lipsa(db)) === '[]', 'starea de la 20261120a: poarta E2 verde (fixture complet)', JSON.stringify(await lipsa(db)))
const ACUM_20A = await stare(db)
await db.exec(ISTORIA)
const ROSU = await lipsa(db)
console.log('     semnale:', JSON.stringify(ROSU))
const are = (re) => ROSU.some((s) => re.test(s))
ok(are(/^invocare implicită neanalizată: trigger on_auth_user_created on table auth\.users → handle_new_user\(\) \(obiect din catalog care cheamă un mutator de cale\)/),
  'semnalul E2 (1): trigger-ul on_auth_user_created (corp rescris)')
ok(are(/^o funcție DEFINER din afara registrului poate citi registrul/), 'semnalul E2 (2): porțile portalului ca „SQL dinamic”')
ok(are(/^definițiile porților diferă de amprenta de la migrare/), 'ștampila E2a roșie (ACL-ul secvenței)')
ok(are(/^E3 definitii diferite/) && are(/^E4 definitii diferite/) && are(/^E4b definitii diferite/), 'ștampilele E3 / E4 / E4b roșii')
ok(ROSU.length >= 5 && ROSU.every((s) => /on_auth_user_created|DEFINER din afara|definițiile porților|^E3B? definitii|^E4B? definitii|^E4b definitii/.test(s)),
  'nicio altă cauză de roșu în afara celor analizate')
const INAINTE = await stare(db)

console.log('2. BASELINE: valorile independente de mediu = cele de producție; celelalte din fixture')
ok(INAINTE.corp === '3c136ab43387e8d7807efcadb0768dda', 'corpul porții E2 = md5 de pe producție (corpul din 20261109b)')
ok(INAINTE.acl === '{postgres=X/postgres,izo_registru_writer=X/postgres,izo_doc_editor=X/postgres,izo_receptie_writer=X/postgres,izo_cor_editor=X/postgres,izo_corectie_writer=X/postgres}',
  'ACL-ul porții E2 = cel de pe producție', INAINTE.acl)
ok(await val(db, "SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_izo_porti_definitii()'::regprocedure") === 'ad3b94b0eb39955db07e6ec1bd5b5e8f',
  'corpul fn_izo_porti_definitii = md5 de pe producție')
const { harta, M, R } = await textePentru(db, INAINTE)
ok(new Set(harta.map((h) => h[1])).size === harta.length && harta.every(([a, b]) => /^[0-9a-f]{32}$/.test(b) && a !== b), 'harta prod → fixture: valori distincte')
ok(harta.every(([a]) => MIG.includes(a) || REV.includes(a)), 'fiecare valoare de producție apare în migrare / revenire')
ok(!harta.some(([a]) => M.includes(a) || R.includes(a)), 'nicio valoare de producție dependentă de mediu nu rămâne după înlocuire')

console.log('3. refuzuri de protocol (nimic schimbat)')
const refuz = async (ce, err, re) => {
  ok(err !== null && re.test(err), ce, err || 'a trecut')
  ok(JSON.stringify(await stare(db)) === JSON.stringify(INAINTE), ce + ': starea neschimbată')
}
await refuz('fără marcajul runnerului', await caRunner(db, NUME, M, { marcaj: false }), /garda start invalida/)
await refuz('marcajul altei migrări', await caRunner(db, '20261230b_alta', M), /garda start invalida/)
await refuz('fără plafon (0)', await caRunner(db, NUME, M, { plafon: 0, marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/)
await refuz('plafon 2000 în loc de 5000', await caRunner(db, NUME, M, { plafon: 2000 }), /PLAFON_TRANZACTIE lipsa/)
await refuz('fără pasul „înainte” al amprentei globale', await caRunner(db, NUME, M, { ag: false }), /AMPRENTA_GLOBALA_LIPSA/)
// tabelul pasului „înainte” rămas dintr-o tranzacție anterioară (sesiunea refolosită) nu ține loc de pasul de acum
await db.exec('CREATE TEMP TABLE ag_ina_fedcba9876543210 (familie text);')
await refuz('tabelul amprentei globale dintr-o tranzacție veche', await caRunner(db, NUME, M, { ag: false }), /AMPRENTA_GLOBALA_LIPSA/)
await db.exec('DROP TABLE ag_ina_fedcba9876543210;')

console.log('4. gărzile PRE: fiecare valoare diferită = refuz (mutanți pe date, în aceeași tranzacție)')
const PRE = [
  ['ștampila E2a stocată altfel', "COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS 'porti=00000000000000000000000000000000';", /stampila fn_izo_porti_definitii\(\)/],
  ['ștampila E4b lipsă', 'COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS NULL;', /stampila fn_izo_porti_e4b_definitii\(\)/],
  ['definiția E4 schimbată (un trigger nou pe executie_tevi)', 'CREATE TRIGGER trg_x_nou BEFORE DELETE ON public.executie_tevi FOR EACH ROW EXECUTE FUNCTION public.fn_executie_acces_garda();', /definitia fn_izo_porti_e4_definitii\(\) inainte/],
  ['definiția E2a schimbată (alt drept pe o secvență)', 'GRANT USAGE ON SEQUENCE public.izo_atribuiri_id_seq TO authenticated;', /definitia fn_izo_porti_definitii\(\) inainte/],
  ['corpul porții E2 altfel', `${FN.lipsa.replace("DECLARE v text[] := '{}'; r record;", "DECLARE v text[] := '{}'; r record; x int;")}`, /poarta fn_izo_porti_lipsa\(\) nu e cea analizata|definitia/],
  ['ACL-ul porții E2 altfel (EXECUTE pentru authenticated)', 'GRANT EXECUTE ON FUNCTION public.fn_izo_porti_lipsa() TO authenticated;', /poarta fn_izo_porti_lipsa\(\) nu e cea analizata|definitia/],
  ['corpul fn_izo_porti_e3_lipsa altfel', stub('e3', 'porti_e3').replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION').replace('(fixture)', '(fixture 2)'), /corpul fn_izo_porti_e3_lipsa\(\)|definitia/],
  ['trigger-ul on_auth_user_created pe corpul vechi', `SET check_function_bodies = off; ${FN.hnu_vechi} RESET check_function_bodies;`, /trigger on_auth_user_created: 1 rand\(uri\), amprenta 5f3f59717d56d1148ac3f4b7d3a2b199/],
  ['trigger-ul on_auth_user_created lipsă', 'DROP TRIGGER on_auth_user_created ON auth.users;', /trigger on_auth_user_created: 0 rand/],
  ['poarta portalului cu alt corp', `SET check_function_bodies = off; ${FN.portal.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION').replace("DECLARE v text[] := '{}';", "DECLARE v text[] := '{}'::text[];")} RESET check_function_bodies;`, /poarta portalului fn_portal_porti_lipsa\(\)/],
  ['poarta portalului 1b executabilă de authenticated', 'GRANT EXECUTE ON FUNCTION public.fn_portal_porti_lipsa_1b() TO authenticated;', /poarta portalului fn_portal_porti_lipsa_1b\(\)/],
]
for (const [ce, sql, re] of PRE) await refuz(ce, await caRunner(db, NUME, M, { inainte: sql }), re)

console.log('5. aplicarea')
const err = await caRunner(db, NUME, M)
ok(err === null, 'migrarea se aplică', err)
const DUPA = await stare(db)
const corpV = FN.lipsa.slice(FN.lipsa.indexOf('AS $f$') + 6, FN.lipsa.lastIndexOf('$f$;'))
const corpN = await corpPoarta(db)
// valorile așteptate scrise de mână (cerere / analiză), nu din generator
const ASTEPTAT = corpV
  .replace("        'trigger on_auth_user_created on auth.users=5f3f59717d56d1148ac3f4b7d3a2b199',\n",
           "        'trigger on_auth_user_created on auth.users=b1858fddd590635b445127fd6c680d97',\n")
  .replace("        'fn_conturi_inchideri_sweep()=402874ea5081b41801313e0def9e3226',\n",
           "        'fn_conturi_inchideri_sweep()=402874ea5081b41801313e0def9e3226',\n" +
           "        'fn_portal_porti_lipsa()=38488af5684b583108b6ca7fc00fcb36',\n" +
           "        'fn_portal_porti_lipsa_1b()=4e5234fb19aab2a8cdf167c4621e6340',\n")
ok(corpN === ASTEPTAT && corpN !== corpV, 'corpul nou = vechiul + EXACT cele două schimbări de listă')
ok(DUPA.acl === INAINTE.acl, 'ACL-ul porții neschimbat')
ok(JSON.stringify(await lipsa(db)) === '[]', 'toate porțile verzi după migrare', JSON.stringify(await lipsa(db)))
ok(DUPA.stampile.every((s, i) => s === `${STAMPILE[i][1]}=${DUPA.definitii[i]}`), 'fiecare ștampilă = definiția ei curentă')
ok([1, 2, 3].every((i) => DUPA.definitii[i] === INAINTE.definitii[i]) && DUPA.definitii[0] !== INAINTE.definitii[0] && DUPA.definitii[4] !== INAINTE.definitii[4],
  'E3 / E3b / E4 neschimbate; E2a / E4b schimbate (includ corpul porții)')
ok(DUPA.functii !== INAINTE.functii, 'instantaneul funcțiilor reflectă doar schimbarea porții (control)')
ok(await val(db, "SELECT count(*)::int FROM pg_class WHERE relname LIKE 'rec\\_20261230a\\_%'") === 0, 'instantaneul temporar nu rămâne după COMMIT')
const reaplicare = await caRunner(db, NUME, M)
ok(reaplicare !== null && /poarta fn_izo_porti_lipsa\(\) nu e cea analizata|stampila/.test(reaplicare), 'reaplicarea e refuzată', reaplicare)

console.log('6. revenirea')
const refuzR = async (ce, e, re, baza, asteptat = DUPA) => {
  ok(e !== null && re.test(e), ce, e || 'a trecut')
  ok(JSON.stringify(await stare(baza)) === JSON.stringify(asteptat), ce + ': starea neschimbată')
}
await refuzR('revenirea fără marcaj', await caRunner(db, `${NUME}_ROLLBACK`, R, { plafon: 2000, marcaj: false }), /garda start invalida/, db)
await refuzR('revenirea cu plafon 5000 în loc de 2000', await caRunner(db, `${NUME}_ROLLBACK`, R), /PLAFON_TRANZACTIE lipsa/, db)
await refuzR('revenirea după o schimbare a catalogului (ștampilă E3 alterată)', await caRunner(db, `${NUME}_ROLLBACK`, R,
  { plafon: 2000, inainte: "COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS 'porti_e3=00000000000000000000000000000000';" }), /stampila fn_izo_porti_e3_definitii\(\) nu mai corespunde/, db)
await refuzR('revenirea după o schimbare acoperită de E3 (definiție nouă)', await caRunner(db, `${NUME}_ROLLBACK`, R,
  { plafon: 2000, inainte: 'GRANT SELECT ON public.izo_documente_intrare TO anon;' }), /nu mai corespunde/, db)
const i2 = await instanta()
await refuzR('revenirea pe starea neaplicată', await caRunner(i2.db, `${NUME}_ROLLBACK`, i2.R, { plafon: 2000 }), /poarta E2 nu e cea pusa de migrare/, i2.db, i2.st)
const errR = await caRunner(db, `${NUME}_ROLLBACK`, R, { plafon: 2000 })
ok(errR === null, 'revenirea se aplică', errR)
const DUPA_R = await stare(db)
ok(JSON.stringify(DUPA_R) === JSON.stringify(INAINTE), 'revenirea reface EXACT starea de dinainte (corp, ACL, ștampile, definiții, restul funcțiilor)',
  JSON.stringify(DUPA_R))
ok(JSON.stringify(await lipsa(db)) === JSON.stringify(ROSU), 'după revenire: aceleași semnale ca înainte de migrare')
ok(await caRunner(db, NUME, M) === null && JSON.stringify(await lipsa(db)) === '[]', 're-aplicarea după revenire: porțile verzi')
ok(JSON.stringify(await stare(db)) === JSON.stringify(DUPA), 're-aplicarea dă aceeași stare ca prima aplicare')

console.log('7. mutanți pe migrare (fiecare TREBUIE să pice)')
const md5Nou = md5(ASTEPTAT)
const doarUna = (k) => {
  // corpul cu doar una dintre schimbări + md5-ul POST ajustat la el: pică doar dacă poarta rămâne roșie
  const sch = [["        'trigger on_auth_user_created on auth.users=b1858fddd590635b445127fd6c680d97',\n",
                "        'trigger on_auth_user_created on auth.users=5f3f59717d56d1148ac3f4b7d3a2b199',\n"],
               ["        'fn_portal_porti_lipsa()=38488af5684b583108b6ca7fc00fcb36',\n        'fn_portal_porti_lipsa_1b()=4e5234fb19aab2a8cdf167c4621e6340',\n", '']][k]
  const corp = ASTEPTAT.split(sch[0]).join(sch[1])
  return [[sch[0], sch[1]], [md5Nou, md5(corp)]]
}
const MUTANTI = [
  ['doar schimbarea portalului (trigger-ul rămâne pe amprenta veche)', doarUna(0), /postconditie porti: .*on_auth_user_created/],
  ['doar schimbarea trigger-ului (portalul rămâne în afara listei)', doarUna(1), /postconditie porti: .*DEFINER din afara/],
  ['o schimbare în plus în corp', [["      IF v_iter >= 100 THEN v := array_append(v, 'propagarea", "      IF v_iter >= 101 THEN v := array_append(v, 'propagarea"]], /postconditie poarta E2/],
  ['ștampilele înaintea corpului', null, /postconditie stampila fn_izo_porti_definitii\(\)/],
  ['ștampila E4b nerefăcută', [["  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS %L', 'porti_e4b=' || public.fn_izo_porti_e4b_definitii());\n", '']], /postconditie stampila fn_izo_porti_e4b_definitii\(\)/],
  ['ștampila E3 nerefăcută', [["  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L', 'porti_e3=' || public.fn_izo_porti_e3_definitii());\n", '']], /postconditie stampila fn_izo_porti_e3_definitii\(\)/],
  ['alt drept schimbat pe o funcție (în afara porții)', [['DO $post$\n', 'GRANT EXECUTE ON FUNCTION public.fn_cont_leaga_la_creare(uuid) TO service_role;\nDO $post$\n']], /alta functie sau alt comentariu/],
  ['alt comentariu schimbat', [['DO $post$\n', "COMMENT ON FUNCTION public.fn_izo_porti_lipsa() IS 'x';\nCOMMENT ON FUNCTION public.handle_new_user() IS 'x';\nDO $post$\n"]], /alta functie sau alt comentariu/],
  ['ACL-ul porții schimbat în migrare', [['DO $post$\n', 'GRANT EXECUTE ON FUNCTION public.fn_izo_porti_lipsa() TO anon;\nDO $post$\n']], /postconditie poarta E2/],
]
for (const [ce, lista, re] of MUTANTI) {
  const im = await instanta()
  let text
  if (lista === null) {
    // blocul ștampilelor mutat înaintea corpului
    const i = im.M.indexOf('-- ștampilele, DUPĂ corpul nou'), j = im.M.indexOf('DO $post$')
    const k = im.M.indexOf('-- poarta E2: corpul de pe producție cu EXACT')
    if (i < 0 || j < 0 || k < 0 || !(k < i && i < j)) throw new Error('mutantul ordinii nu găsește blocurile')
    text = im.M.slice(0, k) + im.M.slice(i, j) + im.M.slice(k, i) + im.M.slice(j)
  } else text = aplica(im.M, lista)
  const e = await caRunner(im.db, NUME, text)
  ok(e !== null && re.test(e), 'mutant: ' + ce, e || 'a trecut')
  ok(JSON.stringify(await stare(im.db)) === JSON.stringify(im.st), 'mutant: ' + ce + ': nimic comis')
}

console.log('8. mutanți pe revenire')
const MUT_R = [
  ['revenirea fără ștampila E4b', [["COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS 'porti_e4b=", "-- COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS 'porti_e4b="]], /postconditie stampila fn_izo_porti_e4b_definitii\(\)/],
  ['revenirea cu corpul nou (fără înlocuire)', [["        'trigger on_auth_user_created on auth.users=5f3f59717d56d1148ac3f4b7d3a2b199',\n", "        'trigger on_auth_user_created on auth.users=b1858fddd590635b445127fd6c680d97',\n"]], /postconditie poarta E2/],
  ['revenirea care atinge alt comentariu', [['DO $revenire_post$\n', "COMMENT ON FUNCTION public.handle_new_user() IS 'x';\nDO $revenire_post$\n"]], /alta functie sau alt comentariu/],
]
for (const [ce, lista, re] of MUT_R) {
  const im = await instanta()
  ok(await caRunner(im.db, NUME, im.M) === null, 'pregătire: migrarea aplicată (' + ce + ')')
  const aplicat = await stare(im.db)
  const e = await caRunner(im.db, `${NUME}_ROLLBACK`, aplica(im.R, lista), { plafon: 2000 })
  ok(e !== null && re.test(e), 'mutant: ' + ce, e || 'a trecut')
  ok(JSON.stringify(await stare(im.db)) === JSON.stringify(aplicat), 'mutant: ' + ce + ': nimic comis')
}

console.log('9. validatorul real al runnerului')
const validator = (rel, plafon) => {
  try {
    // prin bash, ca în celelalte probe (pe Windows „python3” direct poate fi aliasul magazinului)
    const o = execFileSync('bash', ['-c', 'exec python3 "$@"', '_', join(ROOT, 'scripts/livrare_validator.py'), join(ROOT, rel), 'reg_0123456789abcdef',
      '--plafon-tranzactie-ms', String(plafon)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, out: o.trim() }
  } catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() } }
}
const v1 = validator(`supabase/migrations/${NUME}.sql`, 5000), v2 = validator(`supabase/revenire/${NUME}_ROLLBACK.sql`, 2000)
ok(v1.ok, 'migrarea acceptată cu plafonul 5000', v1.out)
ok(v2.ok, 'revenirea acceptată cu plafonul 2000', v2.out)
ok(!validator(`supabase/migrations/${NUME}.sql`, 2000).ok, 'migrarea refuzată cu alt plafon (2000)')
ok(!validator(`supabase/revenire/${NUME}_ROLLBACK.sql`, 5000).ok, 'revenirea refuzată cu alt plafon (5000)')

writeFileSync(join(TMP, 'rezumat.txt'), `trecute ${trecute}, esecuri ${esecuri}\n`)
console.log(`\nREZULTAT: ${trecute} trecute, ${esecuri} esecuri`)
process.exit(esecuri ? 1 : 0)
