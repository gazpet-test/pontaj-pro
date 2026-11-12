// Portal E1 r23 (varianta d): proba pe PostgreSQL in proces (PGlite, PG17) a retragerii EXECUTE de la PUBLIC pe cele
// 21 de functii, cu textul REAL din 18a (clasificarea, $public_d_pre$, GRANT / REVOKE statice, $public_d_post$, randul
// 'grant_d:' din baseline) si din revenirea 18a (bucla care reda drepturile). Nu se conecteaza la nimic.
//   npm install --no-save @electric-sql/pglite@0.3   apoi   node scripts/portal/public_d_pglite.mjs
// Cod 0 = toate verificarile trec; 1 = o verificare a picat; 2 = PGlite lipseste.
// Ce dovedeste (expected din regulile PostgreSQL, nu din codul testat):
//   - o functie de trigger fara EXECUTE pentru PUBLIC se declanseaza in continuare (ca authenticated) si nu se poate
//     apela direct de nimeni; functiile apelabile raman apelabile de authenticated / service_role, teren primeste 42501;
//   - un GRANT lipsa pentru un apelant legitim (mutant) face apelul / scrierea legitima sa pice cu 42501: testul de apel
//     il prinde; o functie public noua cu EXECUTE pentru PUBLIC = postconditia rosie;
//   - GRANT-urile deja existente nu se dubleaza si nu se retrag la revenire; revenirea reface EXACT setul de drepturi;
//   - clasificarea gresita (o functie de trigger trecuta ca apelabila, o semnatura lipsa) = refuz inainte de orice schimbare.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

let PGlite
try { ({ PGlite } = await import('@electric-sql/pglite')) } catch {
  console.log('PGLITE_LIPSA: npm install --no-save @electric-sql/pglite@0.3'); process.exit(2)
}
const aici = path.dirname(fileURLToPath(import.meta.url))
const radacina = path.resolve(aici, '..', '..')
const MIG = readFileSync(path.join(radacina, 'supabase/migrations/20261118a_portal_teren_identitate.sql'), 'utf8').replace(/\r\n/g, '\n')
const REV = readFileSync(path.join(radacina, 'supabase/revenire/20261118a_portal_teren_identitate_ROLLBACK.sql'), 'utf8').replace(/\r\n/g, '\n')

function bucata(text, de, pana, inclusiv = true) {
  const a = text.indexOf(de); const b = text.indexOf(pana, a)
  if (a < 0 || b < 0 || text.indexOf(de, a + 1) >= 0) throw new Error(`marcaj: ${de.slice(0, 50)}`)
  return text.slice(a, inclusiv ? b + pana.length : b)
}
const APROBAT = bucata(MIG, 'CREATE FUNCTION public.fn_portal_public_aprobat()', '$fn$;\n') +
  bucata(MIG, '\nREVOKE ALL ON FUNCTION public.fn_portal_public_aprobat()', ';\n')
const D = bucata(MIG, 'CREATE TEMP TABLE portal_public_clasificare ON COMMIT DROP AS', 'END $public_d_post$;\n')
const GRANT_D = bucata(MIG, "INSERT INTO public.portal_public_baseline\nSELECT 'grant_d:'", 'FROM pg_temp.portal_public_grant_d g;\n')
const REV_D = bucata(REV, '  FOR r IN SELECT x.e->>0 AS semnatura', '  DROP TABLE public.portal_public_baseline;', false)

const APELABILE = ['public.fn_claude_context_cleanup()', 'public.fn_notif_lipsa_fisa_service(bigint)', 'public.get_istoric_importuri_evogps()']
const TRIGGERE = ['auto_cost_from_tichet', 'auto_flag_agabaritic', 'check_alerta_consum', 'fn_contracte_linii_updated_at',
  'fn_executie_touch_updated_at', 'fn_trg_categorie_cantitate', 'gen_numar_transport', 'hr_recrutare_touch_updated_at',
  'notify_tichet_opener_on_resolve', 'set_updated_at', 'tg_active_lipsa_fisa', 'tg_hr_employees_private_touch',
  'tg_lsf_touch_updated', 'update_hr_semnaturi_modificat_la', 'update_modificat_la_hr_docp', 'update_modificat_la_ord_setari',
  'update_stoc_achizitie', 'update_stoc_rezervor']

// Schema falsa: cele 21 de functii in forma productiei (proprietar postgres, ACL implicit = EXECUTE pentru PUBLIC),
// rolurile Supabase + teren, functiile portalului, un tabel cu trigger set_updated_at si unul cu un trigger INVOKER care
// apeleaza fn_notif_lipsa_fisa_service (forma tg_active_lipsa_fisa: apelantul are nevoie de EXECUTE pe ea).
const BAZA = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE teren NOLOGIN NOINHERIT;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, teren;
CREATE TABLE public.notificari (id serial PRIMARY KEY, activ bigint);
CREATE TABLE public.logistica_active (id bigserial PRIMARY KEY, nume text, updated_at timestamptz);
GRANT SELECT, INSERT, UPDATE ON public.logistica_active TO authenticated, service_role;
GRANT USAGE ON SEQUENCE public.logistica_active_id_seq TO authenticated, service_role;
${TRIGGERE.map(n => `CREATE FUNCTION public.${n}() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
  AS $f$ BEGIN ${n === 'set_updated_at' ? "NEW.updated_at := '2026-11-12 10:00:00+00';" : ''}
  ${n === 'tg_active_lipsa_fisa' ? 'PERFORM public.fn_notif_lipsa_fisa_service(NEW.id);' : ''} RETURN NEW; END $f$;`).join('\n')}
CREATE FUNCTION public.fn_claude_context_cleanup() RETURNS integer LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
  AS $f$ BEGIN RETURN 0; END $f$;
CREATE FUNCTION public.fn_notif_lipsa_fisa_service(p bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
  AS $f$ BEGIN INSERT INTO public.notificari (activ) VALUES (p); END $f$;
CREATE FUNCTION public.get_istoric_importuri_evogps() RETURNS integer LANGUAGE sql SET search_path TO 'public', 'pg_temp'
  AS $f$ SELECT 7 $f$;
CREATE TRIGGER active_updated BEFORE UPDATE ON public.logistica_active FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER active_lipsa_fisa AFTER INSERT ON public.logistica_active FOR EACH ROW EXECUTE FUNCTION public.tg_active_lipsa_fisa();
CREATE FUNCTION public.fn_teren_eligibil(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $f$ SELECT false $f$;
REVOKE ALL ON FUNCTION public.fn_teren_eligibil(uuid) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.fn_teren_eligibil(uuid) TO teren;
CREATE FUNCTION public.fn_portal_uid() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $f$ SELECT NULL::uuid $f$;
REVOKE ALL ON FUNCTION public.fn_portal_uid() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.fn_portal_uid() TO teren;
CREATE TABLE public.portal_public_baseline (semnatura text PRIMARY KEY, amprenta jsonb NOT NULL);
`
const ACL = `SELECT coalesce(jsonb_object_agg(x.f, x.acl), '{}'::jsonb) AS acl FROM (
  SELECT p.oid::regprocedure::text AS f, (SELECT jsonb_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
            || ':' || a.privilege_type) FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a) AS acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') x`

let esecuri = 0
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'PICA ') + msg); if (!cond) esecuri++ }
async function baza(extra = '') {
  const db = await PGlite.create()
  await db.exec(BAZA + APROBAT + extra)
  return db
}
async function aplica(db, d = D) {
  const notice = []
  try {
    await db.exec('BEGIN;' + d + GRANT_D + 'COMMIT;', { onNotice: n => { if (/^PORTAL_/.test(n.message)) notice.push(n.message) } })
    return { ok: true, notice }
  } catch (e) { await db.exec('ROLLBACK;').catch(() => {}); return { ok: false, eroare: e.message, notice } }
}
async function ca(db, rol, sql) {
  try { await db.exec(`SET ROLE ${rol}; ${sql}; RESET ROLE;`); return 'ok' } catch (e) {
    await db.exec('RESET ROLE;').catch(() => {}); return `${e.code || ''} ${e.message}`
  }
}
const are = async (db, rol, f) => (await db.query(`SELECT has_function_privilege('${rol}', '${f}', 'EXECUTE') AS d`)).rows[0].d

// 1. Aplicarea pe forma productiei (ACL implicit), apoi apelurile legitime / nelegitime
{
  const db = await baza()
  const acl0 = (await db.query(ACL)).rows[0].acl
  const r = await aplica(db)
  ok(r.ok, `aplicarea (d) pe forma productiei: ${r.eroare || r.notice.join(' | ')}`)
  ok(r.notice.some(n => n === 'PORTAL_PUBLIC_D: 21 functii fara PUBLIC (18 de trigger, 3 apelabile); GRANT-uri adaugate: 6'),
    `NOTICE: 18 + 3, 6 GRANT-uri adaugate (ACL implicit: niciun drept explicit): ${r.notice.join(' | ')}`)
  let faraPublic = 0
  for (const s of [...TRIGGERE.map(n => `public.${n}()`), ...APELABILE]) if (!(await are(db, 'public', s))) faraPublic++
  ok(faraPublic === 21, `PUBLIC nu mai executa niciuna din 21 (${faraPublic})`)
  let apelabile = 0
  for (const s of APELABILE) for (const rol of ['authenticated', 'service_role']) if (await are(db, rol, s)) apelabile++
  ok(apelabile === 6, `cele 3 apelabile: EXECUTE pentru authenticated si service_role (${apelabile} / 6)`)
  ok(!(await are(db, 'authenticated', 'public.set_updated_at()')), 'functiile de trigger: niciun GRANT (authenticated fara EXECUTE)')
  const teren = (await db.query(`SELECT array_agg(p.oid::regprocedure::text ORDER BY 1) AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND has_function_privilege('teren', p.oid, 'EXECUTE')`)).rows[0].f
  ok(JSON.stringify([...(teren || [])].sort()) === JSON.stringify(['fn_portal_uid()', 'fn_teren_eligibil(uuid)']),
    `teren executa in public DOAR cele doua functii ale portalului: ${JSON.stringify(teren)}`)
  ok((await ca(db, 'authenticated', 'SELECT public.get_istoric_importuri_evogps()')) === 'ok', 'authenticated apeleaza get_istoric_importuri_evogps (RPC din UI)')
  ok((await ca(db, 'service_role', 'SELECT public.fn_claude_context_cleanup()')) === 'ok', 'service_role apeleaza fn_claude_context_cleanup')
  const t = await ca(db, 'teren', 'SELECT public.get_istoric_importuri_evogps()')
  ok(/^42501 /.test(t), `teren: 42501 permission denied: ${t}`)
  const ins = await ca(db, 'authenticated', "INSERT INTO public.logistica_active (nume) VALUES ('a')")
  ok(ins === 'ok', `authenticated scrie in logistica_active: triggerul (fara EXECUTE) se declanseaza si apeleaza fn_notif (GRANT): ${ins}`)
  const upd = await ca(db, 'authenticated', "UPDATE public.logistica_active SET nume = 'b'")
  const ts = (await db.query('SELECT updated_at::text AS t FROM public.logistica_active')).rows[0]?.t
  ok(upd === 'ok' && /^2026-11-12 10:00:00/.test(ts || ''), `set_updated_at (fara EXECUTE pentru nimeni) a rulat la UPDATE: ${upd} ${ts}`)
  ok((await db.query('SELECT count(*)::int AS n FROM public.notificari')).rows[0].n === 1, 'notificarea scrisa de triggerul de pe INSERT')
  const direct = await ca(db, 'postgres', 'SELECT public.set_updated_at()')
  ok(/trigger functions can only be called as triggers/.test(direct), `apel direct al unei functii de trigger (chiar ca proprietar): ${direct}`)
  const gd = (await db.query("SELECT amprenta FROM public.portal_public_baseline WHERE semnatura = 'grant_d:'")).rows[0]?.amprenta
  ok(Array.isArray(gd) && gd.length === 6, `randul grant_d: are cele 6 GRANT-uri adaugate: ${JSON.stringify(gd)}`)
  // revenirea: bucla reala din fisierul de revenire, apoi setul de drepturi = cel dinainte (comparat ca multime)
  await db.exec('DO $rev$ DECLARE r record; BEGIN\n' + REV_D + '\nEND $rev$;')
  const acl1 = (await db.query(ACL)).rows[0].acl
  const norm = a => JSON.stringify(Object.keys(a).sort().map(k => [k, [...a[k]].sort()]))
  ok(norm(acl0) === norm(acl1), 'revenirea reface EXACT drepturile de dinainte (multimea pe fiecare functie)')
  // re-aplicarea dupa revenire (apply -> rollback -> re-apply, L14)
  await db.exec("DELETE FROM public.portal_public_baseline")
  const r2 = await aplica(db)
  ok(r2.ok, `re-aplicarea dupa revenire: ${r2.eroare || 'ok'}`)
  await db.close()
}

// 2. Drepturi explicite deja existente (forma Supabase: ALTER DEFAULT PRIVILEGES catre anon / authenticated /
//    service_role): niciun GRANT nou inregistrat, revenirea nu le retrage
{
  const db = await baza(`GRANT EXECUTE ON FUNCTION ${APELABILE.join(', ')} TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.set_updated_at() TO anon, authenticated, service_role;`)
  const acl0 = (await db.query(ACL)).rows[0].acl
  const r = await aplica(db)
  ok(r.ok && r.notice.some(n => /GRANT-uri adaugate: 0$/.test(n)), `drepturi explicite existente: 0 GRANT-uri adaugate: ${r.eroare || r.notice.join(' | ')}`)
  await db.exec('DO $rev$ DECLARE r record; BEGIN\n' + REV_D + '\nEND $rev$;')
  const acl1 = (await db.query(ACL)).rows[0].acl
  const norm = a => JSON.stringify(Object.keys(a).sort().map(k => [k, [...a[k]].sort()]))
  ok(norm(acl0) === norm(acl1), 'revenirea: drepturile explicite ale lui anon / authenticated / service_role raman, PUBLIC revine')
  await db.close()
}

// 3. Mutantii: fiecare trebuie respins cu motivul exact (sau, pentru GRANT-ul lipsa, apelul legitim trebuie sa pice)
const MUTANTI = [
  ['o functie de trigger trecuta ca apelabila', D.replace("('public.set_updated_at()','{}')", "('public.set_updated_at()','{authenticated}')"),
    /PORTAL_PUBLIC_CLASIFICARE_SCHIMBATA: public\.set_updated_at\(\)/],
  ['o apelabila trecuta ca functie de trigger', D.replace("('public.fn_claude_context_cleanup()','{authenticated,service_role}')", "('public.fn_claude_context_cleanup()','{}')"),
    /PORTAL_PUBLIC_CLASIFICARE_SCHIMBATA: public\.fn_claude_context_cleanup\(\)/],
  ['o semnatura lipsa din clasificare', D.replace(" ('public.update_stoc_rezervor()','{}')", " ('public.update_stoc_rezervor_x()','{}')"),
    /PORTAL_PUBLIC_CLASIFICARE_INVALIDA/],
  ['rol in afara listei (anon)', D.replace("('public.get_istoric_importuri_evogps()','{authenticated,service_role}')", "('public.get_istoric_importuri_evogps()','{anon}')"),
    /PORTAL_PUBLIC_CLASIFICARE_INVALIDA/],
  ['REVOKE static fara o functie', D.replace('public.update_stoc_achizitie(), public.update_stoc_rezervor() FROM PUBLIC;', 'public.update_stoc_achizitie() FROM PUBLIC;'),
    /PORTAL_PUBLIC_D_POSTCONDITIE: public\.update_stoc_rezervor\(\)/],
  ['GRANT static fara o functie apelabila', D.replace('public.fn_notif_lipsa_fisa_service(bigint),\n  public.get_istoric', '\n  public.get_istoric'),
    /PORTAL_PUBLIC_D_POSTCONDITIE: public\.fn_notif_lipsa_fisa_service\(bigint\)/],
]
for (const [desc, d, asteptat] of MUTANTI) {
  if (d === D) { ok(false, `mutant „${desc}”: textul de inlocuit nu s-a gasit in 18a`); continue }
  const db = await baza()
  const r = await aplica(db, d)
  const acl = r.ok ? null : await are(db, 'public', 'public.set_updated_at()')
  ok(!r.ok && asteptat.test(r.eroare) && acl === true, `mutant „${desc}” RESPINS, nimic schimbat (PUBLIC pastreaza EXECUTE): ${r.eroare || 'APLICAT'}`)
  await db.close()
}
// o functie public NOUA cu EXECUTE pentru PUBLIC (ACL implicit) => teren o poate executa => postconditia rosie
{
  const db = await baza('CREATE FUNCTION public.mutant_nou() RETURNS integer LANGUAGE sql AS $f$ SELECT 1 $f$;')
  const r = await aplica(db)
  ok(!r.ok && /PORTAL_PUBLIC_D_POSTCONDITIE: teren executa: mutant_nou\(\)/.test(r.eroare || ''), `functie public noua cu PUBLIC: ${r.eroare || 'APLICAT'}`)
  await db.close()
}
// un GRANT lipsa pentru un apelant legitim (dupa aplicare) => scrierea / apelul legitim pica: testul de apel il prinde
{
  const db = await baza()
  const r = await aplica(db)
  await db.exec('REVOKE EXECUTE ON FUNCTION public.fn_notif_lipsa_fisa_service(bigint) FROM authenticated;')
  const ins = await ca(db, 'authenticated', "INSERT INTO public.logistica_active (nume) VALUES ('c')")
  ok(r.ok && /^42501 permission denied for function fn_notif_lipsa_fisa_service/.test(ins), `GRANT lipsa (mutant): scrierea legitima pica cu 42501: ${ins}`)
  await db.exec('REVOKE EXECUTE ON FUNCTION public.get_istoric_importuri_evogps() FROM authenticated;')
  const rpc = await ca(db, 'authenticated', 'SELECT public.get_istoric_importuri_evogps()')
  ok(/^42501 /.test(rpc), `GRANT lipsa (mutant): RPC-ul din UI pica cu 42501: ${rpc}`)
  await db.close()
}
// 4. scripts/portal/public21_apelanti.sql (citirea pentru coordonator, inainte de apply) pe aceeasi schema falsa: cine
//    apeleaza cele 3 apelabile si ce rol ar pierde dreptul; dupa (d): niciun rol nu mai pierde o functie apelabila.
{
  const APEL = readFileSync(path.join(aici, 'public21_apelanti.sql'), 'utf8').replace(/\r\n/g, '\n')
  const db = await baza(`CREATE SCHEMA cron; CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, command text NOT NULL,
    username text NOT NULL DEFAULT current_user, active boolean NOT NULL DEFAULT true, jobname text);
    INSERT INTO cron.job (command, jobname) VALUES ('SELECT public.fn_claude_context_cleanup()', 'curatenie'), ('SELECT 1', 'altul');`)
  const randuri = async () => {
    const rez = await db.exec(APEL); const r = {}
    for (const set of rez) for (const row of set.rows || []) if (row && row.sectiune) (r[row.sectiune] ||= []).push(row)
    return r
  }
  let r = await randuri()
  ok((r.P_clasificare || []).length === 21 && r.P_clasificare.filter(x => x.trigger_fn).length === 18 && r.P_clasificare.every(x => x.exista && x.exec_public),
    `public21_apelanti P_clasificare: 21 (18 de trigger), toate cu PUBLIC: ${(r.P_clasificare || []).length}`)
  ok((r.P_clasificare || []).find(x => x.semnatura === 'public.set_updated_at()')?.tabele_triggere === 'public.logistica_active', 'P_clasificare: set_updated_at e pe public.logistica_active')
  ok((r.P_apelanti_corp || []).some(x => x.tinta === 'public.fn_notif_lipsa_fisa_service(bigint)' && x.apelant === 'public.tg_active_lipsa_fisa()'
      && x.apelant_trigger === true && x.apelant_tabele_triggere === 'public.logistica_active'),
    `P_apelanti_corp: tg_active_lipsa_fisa (trigger pe logistica_active) apeleaza fn_notif: ${JSON.stringify(r.P_apelanti_corp)}`)
  ok((r.P_cron || []).length === 1 && r.P_cron[0].job === 'curatenie' && r.P_cron[0].fn_claude_context_cleanup === true,
    `P_cron: doar jobul care o numeste, fara comanda: ${JSON.stringify(r.P_cron)}`)
  const pierde0 = (r.P_pierde || []).filter(x => !x.trigger_fn && x.rol === 'authenticated').map(x => x.functie).sort()
  ok(JSON.stringify(pierde0) === JSON.stringify(['public.fn_claude_context_cleanup()', 'public.fn_notif_lipsa_fisa_service(bigint)', 'public.get_istoric_importuri_evogps()']),
    `P_pierde inainte de (d): authenticated ar pierde cele 3 apelabile (drept doar prin PUBLIC): ${JSON.stringify(pierde0)}`)
  ok((await aplica(db)).ok, 'aplicarea (d) pe aceeasi schema')
  r = await randuri()
  ok(!(r.P_pierde || []).some(x => !x.trigger_fn), `P_pierde dupa (d): niciun rol nu mai depinde de PUBLIC pe o functie apelabila: ${JSON.stringify(r.P_pierde || [])}`)
  ok((r.P_clasificare || []).filter(x => x.explicit_authenticated && x.explicit_service_role).length === 3, 'P_clasificare dupa (d): 3 functii cu drept explicit')
  await db.close()
}
console.log(esecuri ? `PUBLIC_D_PGLITE: ${esecuri} verificari picate` : 'PUBLIC_D_PGLITE: OK')
process.exit(esecuri ? 1 : 0)
