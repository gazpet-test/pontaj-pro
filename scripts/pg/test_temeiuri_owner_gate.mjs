// Pasul B juridic (PR #615): poarta „doar owner” din trigger-ul fn_temei_citat_verifica, pe PostgreSQL 16 real, psql, fără npm.
// Rulare: PGURI=postgresql://postgres@127.0.0.1:5432/temeiuri_test_<sufix> (bază goală, de aruncat — fixture-ul și migrarea se COMIT,
// fiindcă proba de concurență are nevoie de două sesiuni care văd aceeași stare comisă).
// Fixture minimal (auth.uid, roluri, profiles, corpus, clarificări) + migrarea 20261014b aplicată cu garda runner-ului armată pe txid.
// Probele: Copilot r2 (3 cazuri minime), Jakarinos r2 N1/N2, Jakarinos r3 R3-1 (retragerile trec) + înlocuirea citatului,
// uid NULL fail-closed, citat înghețat verificat, INSERT multi-rând în ambele ordini, apoi Copilot r3: două tranzacții
// concurente pe aceeași țintă — a doua așteaptă lock-ul și e refuzată după commit-ul primei (în ambele ordini).
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const sqlText = v => "'" + String(v).replaceAll("'", "''") + "'"
const migration = readFileSync(new URL('../../supabase/migrations/20261014b_ofertare_clarificari_temeiuri.sql', import.meta.url), 'utf8')
const ids = {
  user: '00000000-0000-4000-8000-000000000007',    // acces Ofertare, NU owner
  user2: '00000000-0000-4000-8000-000000000008',   // al doilea non-owner (concurență)
  owner: '00000000-0000-4000-8000-000000000121',
}
const actor = 'temeiuri_actor_' + process.pid
const asUser = who => `RESET ROLE; RESET SESSION AUTHORIZATION;
  SET SESSION AUTHORIZATION "${actor}"; SET ROLE authenticated;
  SET request.jwt.claims = ${sqlText(JSON.stringify({ sub: ids[who], role: 'authenticated' }))};`
const asPostgres = `RESET ROLE; RESET SESSION AUTHORIZATION; SET request.jwt.claims = '';`
const ok = (sql, label) => `DO $t$ BEGIN ${sql}; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'TEST (trebuia să treacă): % — % [%]', ${sqlText(label)}, SQLERRM, SQLSTATE; END $t$;`
const refuz = (sql, label, state = '42501') => `DO $t$ DECLARE r boolean := false; BEGIN
  BEGIN ${sql}; EXCEPTION WHEN SQLSTATE '${state}' THEN r := true; END;
  IF NOT r THEN RAISE EXCEPTION 'TEST (trebuia refuzat cu ${state}): %', ${sqlText(label)}; END IF; END $t$;`
const assertSql = (cond, label) => `DO $t$ BEGIN IF NOT (${cond}) THEN RAISE EXCEPTION 'TEST: %', ${sqlText(label)}; END IF; END $t$;`
const T = 'public.ofertare_clarificari_temeiuri'
const CIT = 'Autoritatea contractantă nu poate impune cerințe disproporționate'

const fixture = `
BEGIN;
SET LOCAL statement_timeout = '20s';
DO $s$ BEGIN
  IF current_setting('server_version_num')::int / 10000 <> 16 THEN RAISE EXCEPTION 'Este necesar PostgreSQL 16 real'; END IF;
  IF session_user <> 'postgres' THEN RAISE EXCEPTION 'Fixture-ul cere login postgres pe instanța locală de test'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='auth') THEN
    RAISE EXCEPTION 'Baza de test trebuie să fie goală (de aruncat); niciun obiect existent nu va fi șters';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $s$;
CREATE ROLE "${actor}" NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT authenticated TO "${actor}";
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth, public TO authenticated, anon, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $f$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_module_access (profile_id uuid REFERENCES public.profiles(id), module text NOT NULL, PRIMARY KEY (profile_id, module));
INSERT INTO public.profiles VALUES ('${ids.user}', false), ('${ids.user2}', false), ('${ids.owner}', true);
INSERT INTO public.user_module_access VALUES ('${ids.user}', 'ofertare'), ('${ids.user2}', 'ofertare');
-- aceleași definiții ca live (fn_is_app_owner: SECURITY DEFINER, false pe NULL)
CREATE FUNCTION public.fn_is_app_owner(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp
  AS $f$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND is_owner = true) $f$;
CREATE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_owner)
    OR EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id=auth.uid() AND u.module='ofertare')) $f$;
GRANT EXECUTE ON FUNCTION public.fn_is_app_owner(uuid), public.fn_are_acces_ofertare() TO authenticated;
-- corpusul (doar coloanele pe care le atinge migrarea / trigger-ul)
CREATE TABLE public.cnsc_decizii (id text PRIMARY KEY, citate_cheie jsonb, verificat boolean);
CREATE TABLE public.norme_cerinte (requirement_id text PRIMARY KEY, cerinta text);
CREATE TABLE public.clarificari_tipare (pattern_id text PRIMARY KEY, requires_human_legal_review boolean);
CREATE TABLE public.ofertare_clarificari (id bigint PRIMARY KEY);
CREATE TABLE public.ofertare_clarificari_puncte (id bigint PRIMARY KEY, clarificare_id bigint REFERENCES public.ofertare_clarificari(id));
INSERT INTO public.cnsc_decizii VALUES
  ('D1', ${sqlText(JSON.stringify([{ loc: 'pag. 12', text: CIT }, { loc: 'pag. 14', text: 'al doilea citat' }]))}, true),
  ('D2', '[{"loc":"p. 3","text":"citat din a doua decizie"}]', true);
INSERT INTO public.norme_cerinte VALUES ('REQ-1', 'cerință');
INSERT INTO public.clarificari_tipare VALUES ('P-REVIEW', true), ('P-LIBER', false);
INSERT INTO public.ofertare_clarificari SELECT generate_series(1, 20);
INSERT INTO public.ofertare_clarificari_puncte VALUES (101, 1);
ALTER TABLE public.cnsc_decizii ENABLE ROW LEVEL SECURITY; ALTER TABLE public.norme_cerinte ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clarificari_tipare ENABLE ROW LEVEL SECURITY; ALTER TABLE public.ofertare_clarificari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertare_clarificari_puncte ENABLE ROW LEVEL SECURITY;
CREATE POLICY f1 ON public.cnsc_decizii FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY f2 ON public.norme_cerinte FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY f3 ON public.clarificari_tipare FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY f4 ON public.ofertare_clarificari FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY f5 ON public.ofertare_clarificari_puncte FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
GRANT SELECT ON public.cnsc_decizii, public.norme_cerinte, public.clarificari_tipare, public.ofertare_clarificari, public.ofertare_clarificari_puncte TO authenticated;
-- migrarea, prin garda runner-ului legată de txid (ca în scripts/livrare_migrare.sh)
SELECT set_config('gazpet.livrare_migrare', '20261014b_ofertare_clarificari_temeiuri:' || txid_current(), true);
${migration}
COMMIT;
SELECT 'FIXTURE+MIGRARE OK';
`

const ins = (tinta, campuri) => `INSERT INTO ${T} (${Object.keys({ ...tinta, ...campuri }).join(', ')}) VALUES (${Object.values({ ...tinta, ...campuri }).map(v => v === null ? 'NULL' : typeof v === 'boolean' ? String(v) : typeof v === 'number' ? String(v) : sqlText(v)).join(', ')})`
const Q = n => ({ clarificare_id: n })
const citatD1 = { cnsc_decizie_id: 'D1', citat_idx: 0, citat_text: CIT }

const probe = `
BEGIN;
SET LOCAL statement_timeout = '20s';
-- S0 citatul înghețat: text diferit → refuz; citat_loc rescris din corpus; idx inexistent → refuz
${asUser('user')}
${refuz(ins(Q(10), { cnsc_decizie_id: 'D1', citat_idx: 0, citat_text: 'alt text' }), 'citat_text diferit de corpus', '23514')}
${refuz(ins(Q(10), { cnsc_decizie_id: 'D1', citat_idx: 7, citat_text: 'x' }), 'citat_idx inexistent', '23514')}
${ok(ins(Q(10), { ...citatD1, citat_loc: 'falsificat' }), 'citat identic cu corpusul')}
${assertSql(`(SELECT citat_loc FROM ${T} WHERE clarificare_id = 10) = 'pag. 12'`, 'citat_loc rescris din corpus, nu cel trimis')}

-- S1 (Copilot r2 caz 1 / Jakarinos N1): origine-review pe A + include pe B de non-owner → refuz; owner → permis
${ok(ins(Q(1), { ...citatD1, pattern_id_origine: 'P-REVIEW', sursa: 'propus_tipar', confirmat: false }), 'A: decizie propusă din tiparul cu review (neinclusă)')}
${refuz(ins(Q(1), { cnsc_decizie_id: 'D2', citat_idx: 0, citat_text: 'citat din a doua decizie', include_in_adresa: true }), 'B inclus de non-owner lângă proveniența cu review')}
${asUser('owner')}
${ok(ins(Q(1), { cnsc_decizie_id: 'D2', citat_idx: 0, citat_text: 'citat din a doua decizie', include_in_adresa: true }), 'B inclus de owner')}

-- S2 (Copilot r2 caz 2): B inclus deja (fără review) + non-owner adaugă tipar cu review → refuz; tipar fără review → permis; owner → permis
${asUser('user')}
${ok(ins(Q(2), { ...citatD1, include_in_adresa: true }), 'citat inclus pe o țintă fără review')}
${refuz(ins(Q(2), { pattern_id: 'P-REVIEW' }), 'tipar cu review atașat de non-owner lângă un rând inclus')}
${ok(ins(Q(2), { pattern_id: 'P-LIBER' }), 'tipar fără review lângă un rând inclus')}
${asUser('owner')}
${ok(ins(Q(2), { pattern_id: 'P-REVIEW' }), 'tipar cu review atașat de owner')}

-- S3 INSERT multi-rând de non-owner, ambele ordini → refuz integral
${asUser('user')}
${refuz(`INSERT INTO ${T} (clarificare_id, pattern_id, cnsc_decizie_id, citat_idx, citat_text, include_in_adresa) VALUES
  (3, 'P-REVIEW', NULL, NULL, NULL, false), (3, NULL, 'D1', 0, ${sqlText(CIT)}, true)`, 'multi-rând: tipar apoi citat inclus')}
${refuz(`INSERT INTO ${T} (clarificare_id, pattern_id, cnsc_decizie_id, citat_idx, citat_text, include_in_adresa) VALUES
  (4, NULL, 'D1', 0, ${sqlText(CIT)}, true), (4, 'P-REVIEW', NULL, NULL, NULL, false)`, 'multi-rând: citat inclus apoi tipar')}
${assertSql(`NOT EXISTS (SELECT 1 FROM ${T} WHERE clarificare_id IN (3, 4))`, 'refuzul anulează toată instrucțiunea multi-rând')}

-- S4 (Jakarinos R3-1): retragerile trec pentru non-owner pe Q1 (A cu origine-review, B inclus de owner)
${ok(`UPDATE ${T} SET include_in_adresa = false WHERE clarificare_id = 1 AND cnsc_decizie_id = 'D2'`, 'non-owner debifează B')}
${asUser('owner')}
${ok(`UPDATE ${T} SET include_in_adresa = true WHERE clarificare_id = 1 AND cnsc_decizie_id = 'D2'`, 'owner reinclude B')}
${asUser('user')}
${ok(`UPDATE ${T} SET pattern_id_origine = NULL WHERE clarificare_id = 1 AND cnsc_decizie_id = 'D1'`, 'non-owner scoate proveniența de pe A (retragere) cât timp B e inclus')}
${refuz(`UPDATE ${T} SET pattern_id_origine = 'P-REVIEW' WHERE clarificare_id = 1 AND cnsc_decizie_id = 'D1'`, 'non-owner pune la loc proveniența cu review lângă B inclus')}
${asUser('owner')}
${ok(`UPDATE ${T} SET pattern_id_origine = 'P-REVIEW' WHERE clarificare_id = 1 AND cnsc_decizie_id = 'D1'`, 'owner pune proveniența')}
${asUser('user')}
${ok(`UPDATE ${T} SET nota = 'notă internă' WHERE clarificare_id = 1 AND cnsc_decizie_id = 'D2'`, 'non-owner schimbă doar nota pe rândul inclus')}
${ok(`UPDATE ${T} SET confirmat = true WHERE clarificare_id = 1 AND cnsc_decizie_id = 'D1'`, 'non-owner confirmă propunerea A (neinclusă)')}
${ok(`DELETE FROM ${T} WHERE clarificare_id = 2 AND pattern_id = 'P-LIBER'`, 'non-owner șterge un chip')}

-- S5 (Jakarinos N2 restanță): conținut nou pe un rând inclus pe o țintă cu review → refuz pentru non-owner
${ok(ins(Q(5), { ...citatD1, include_in_adresa: true }), 'Q5: citat inclus fără review (non-owner)')}
${ok(`UPDATE ${T} SET citat_idx = 1, citat_text = 'al doilea citat' WHERE clarificare_id = 5`, 'Q5 fără review: non-owner schimbă citatul inclus')}
${assertSql(`(SELECT citat_loc FROM ${T} WHERE clarificare_id = 5) = 'pag. 14'`, 'citat_loc rescris la schimbarea citatului')}
${refuz(`UPDATE ${T} SET cnsc_decizie_id = 'D1', citat_idx = 1, citat_text = 'al doilea citat' WHERE clarificare_id = 1 AND cnsc_decizie_id = 'D2'`, 'Q1 cu review: non-owner înlocuiește decizia/citatul rândului inclus')}
${asUser('owner')}
${ok(`UPDATE ${T} SET cnsc_decizie_id = 'D1', citat_idx = 1, citat_text = 'al doilea citat' WHERE clarificare_id = 1 AND cnsc_decizie_id = 'D2'`, 'owner înlocuiește citatul')}

-- S6 mutarea unui rând inclus pe o țintă cu review → refuz pentru non-owner
${asUser('user')}
${refuz(`UPDATE ${T} SET clarificare_id = 1 WHERE clarificare_id = 5`, 'non-owner mută rândul inclus din Q5 pe Q1 (review)')}
${ok(`UPDATE ${T} SET clarificare_id = 6 WHERE clarificare_id = 5`, 'non-owner mută rândul inclus pe Q6 (fără review)')}

-- S7 fără identitate (auth.uid() NULL, postgres sare peste RLS dar nu peste trigger) → fail-closed
${asPostgres}
${refuz(ins(Q(1), { cnsc_decizie_id: 'D2', citat_idx: 0, citat_text: 'citat din a doua decizie', include_in_adresa: true }), 'uid NULL include pe o țintă cu review')}

-- S8 punct (cheia alternativă): aceeași poartă
${asUser('user')}
${ok(ins({ punct_id: 101 }, { pattern_id: 'P-REVIEW' }), 'tipar cu review pe punct, fără includere')}
${refuz(ins({ punct_id: 101 }, { ...citatD1, include_in_adresa: true }), 'include pe punct cu tipar-review (non-owner)')}
${refuz(ins(Q(7), { ...citatD1, include_in_adresa: true, confirmat: false }), 'include fără confirmare', '23514')}
ROLLBACK;
SELECT 'PROBE SECVENȚIALE OK';
`

function psqlOnce(sql, label) {
  const output = execFileSync('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '--dbname', target.href, '--file', '-'], {
    input: sql, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '5' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  })
  assert.match(output, new RegExp(label), label)
  return output
}

// Sesiune psql interactivă (stdin deschis): trimitem comenzi și așteptăm markeri în stdout — pentru proba de concurență.
function sesiune() {
  const p = spawn('psql', ['-X', '--no-password', '-qAt', '--dbname', target.href, '--file', '-'], {
    env: { ...process.env, PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '5' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  })
  let out = '', err = ''
  p.stdout.on('data', d => { out += d })
  p.stderr.on('data', d => { err += d })
  const trimite = sql => p.stdin.write(sql + '\n')
  const asteapta = (marker, ms) => new Promise((res, rej) => {
    const t0 = Date.now()
    const tick = () => { if (out.includes(marker)) return res(Date.now() - t0); if (Date.now() - t0 > ms) return rej(new Error('timeout ' + marker)); setTimeout(tick, 25) }
    tick()
  })
  const are = marker => out.includes(marker)
  const inchide = () => new Promise(res => { p.on('close', res); p.stdin.end() })
  return { trimite, asteapta, are, inchide, err: () => err, out: () => out }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Proba de concurență (Copilot r3): A și B non-owneri, aceeași țintă. A deschide tranzacția și pune piesa 1 (ține lock-ul),
// B pune piesa 2 → trebuie să AȘTEPTE (nu să treacă pe snapshot-ul vechi) și, după COMMIT-ul lui A, să fie REFUZAT.
async function concurenta(tinta, piesaA, piesaB, eticheta) {
  const A = sesiune(), B = sesiune()
  try {
    A.trimite(asUser('user') + ' BEGIN; ' + piesaA + "; \\echo A_INSERAT")
    await A.asteapta('A_INSERAT', 10000)
    B.trimite(asUser('user2') + ' BEGIN; ' + piesaB + "; \\echo B_GATA")
    await sleep(1500)
    assert.ok(!B.are('B_GATA') && !/ERROR/.test(B.err()), eticheta + ': B trebuia să aștepte lock-ul cât A ține tranzacția deschisă')
    A.trimite("COMMIT; \\echo A_COMIS")
    await A.asteapta('A_COMIS', 10000)
    await sleep(1500)
    assert.ok(/insufficient_privilege|doar un owner/.test(B.err()), eticheta + ': B trebuia refuzat după commit-ul lui A, stderr=' + B.err().slice(0, 300))
    B.trimite("ROLLBACK; \\echo B_GATA")
    await B.asteapta('B_GATA', 10000)
  } finally { await A.inchide(); await B.inchide() }
  // starea finală: doar piesa lui A pe țintă
  psqlOnce(`${assertSql(`(SELECT count(*) FROM ${T} WHERE clarificare_id = ${tinta}) = 1`, eticheta + ': după cursă rămâne doar rândul lui A')} SELECT 'CURSA OK';`, 'CURSA OK')
}

let target
try {
  assert.ok(process.env.PGURI, 'Setează PGURI către o bază PostgreSQL 16 locală, goală, de aruncat')
  try { target = new URL(process.env.PGURI) } catch { throw new Error('PGURI invalid (valoarea nu este afișată)') }
  assert.ok(/^postgres(ql)?:$/.test(target.protocol), 'PGURI trebuie să fie postgres://')
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(target.hostname), 'PGURI doar către instanța locală')
  assert.ok(/(^|\/)temeiuri_test_/.test(target.pathname), 'Baza trebuie să se numească temeiuri_test_<sufix>')
  psqlOnce(fixture, 'FIXTURE\\+MIGRARE OK')
  psqlOnce(probe, 'PROBE SECVENȚIALE OK')
  await concurenta(11, ins(Q(11), { pattern_id: 'P-REVIEW' }), ins(Q(11), { ...citatD1, include_in_adresa: true }), 'A tipar-review, B include')
  await concurenta(12, ins(Q(12), { ...citatD1, include_in_adresa: true }), ins(Q(12), { pattern_id: 'P-REVIEW' }), 'A include, B tipar-review')
  // fără lock-ul din trigger, B ar fi trecut pe snapshot-ul de dinaintea lui A — exact scenariul din Copilot r3
  console.log('PASS temeiuri owner gate: citat înghețat, 3 cazuri Copilot, N1/N2, R3-1 retrageri, uid NULL, multi-rând, punct, 2 curse concurente')
} catch (error) {
  const detail = error.code === 'ENOENT' ? 'psql indisponibil în PATH'
    : error.stderr ? String(error.stderr).trim() : error.code === 'ERR_ASSERTION' ? error.message : error.code ? String(error.code) + ' ' + error.message : error.message
  console.error('FAIL temeiuri owner gate: ' + detail.replaceAll(process.env.PGURI || '\0', '[PGURI]'))
  process.exitCode = 1
}
