#!/usr/bin/env node
// Test RLS Ofertare (20261004b) pe Postgres LOCAL — simulează calea REST (PostgREST):
// SET LOCAL ROLE anon|authenticated + request.jwt.claims, exact cum face PostgREST pe fiecare cerere.
// Nu atinge live. Rulare: node scripts/test_rls_ofertare.mjs   (PGBIN=/usr/lib/postgresql/17/bin, PGPORT=5497)
// Dovedește: anon refuzat; cont logat fără modul refuzat (grupul A citire+scriere, grupul B scriere);
// cont cu modulul „ofertare” permis; owner permis; md5 stare live reconstruită = cel citit pe 30.09;
// migrarea refuză fără gardă / pe live schimbat / a doua oară; rollback-ul reface exact starea live.
// Runda 2: amprenta exactă a helper-ului + overload-uri, ACL pe coloane, anon 8 privilegii, authenticated neatins,
// compunerea cu SEC F1 (#551) în ambele ordini; rollback-ul nu reintroduce TRUNCATE peste F1.
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = process.env.PGBIN || '/usr/lib/postgresql/17/bin'
const PORT = process.env.PGPORT || '5497'
const NUME = '20261004b_rls_ofertare_preturi_oferte'
const MIG = readFileSync(join(ROOT, 'supabase/migrations', NUME + '.sql'), 'utf8')
const RB = readFileSync(join(ROOT, 'supabase/revenire', NUME + '_ROLLBACK.sql'), 'utf8')
const LIVE = readFileSync(join(ROOT, 'supabase/tests/rls_ofertare_live_state.sql'), 'utf8')
const md5 = (re, s) => s.match(re)[1]
const MD5_LIVE = md5(/≠ ([0-9a-f]{32})\). Se reface/, MIG)
const MD5_PATCH = md5(/≠ starea patch-ului (\w+)'/, MIG)
// Runda 2: grupul B redus la parteneri + norme (extinderea lui B = decizie de business a lui Răzvan)
const A = ['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']
const B = ['ofertare_norme_productivitate','ofertare_parteneri']
// SEC F1 (PR #551, 20260930i): doar în harness, pentru testul de compunere. Din migrations/ dacă e deja pe branch, altfel din branch-ul F1.
const F1_NUME = '20260930i_sec_f1_truncate_revoke'
let F1 = null
try { F1 = readFileSync(join(ROOT, 'supabase/migrations', F1_NUME + '.sql'), 'utf8') } catch {
  try { F1 = execFileSync('git', ['-C', ROOT, 'show', `${process.env.F1_REF || 'origin/claude/erp-continuare-x4p5a7-sec-f1f2'}:supabase/migrations/${F1_NUME}.sql`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch {}
}
const T = [...A, ...B]
const U = { fara: '00000000-0000-0000-0000-000000000001', modul: '00000000-0000-0000-0000-000000000002', owner: '00000000-0000-0000-0000-000000000003', subm: '00000000-0000-0000-0000-000000000004' }

const dir = mkdtempSync(join(tmpdir(), 'pg_rls_'))
const data = join(dir, 'data')
let ok = 0, fail = 0
const psql = (sql, { user = 'postgres', expectErr = false } = {}) => {
  try {
    const out = execFileSync(join(BIN, 'psql'), ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', dir, '-p', PORT, '-U', user, '-d', 'postgres'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    return { ok: true, out: out.trim() }
  } catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() } }
}
const check = (name, cond, info = '') => { if (cond) { ok++; console.log('  ✔', name) } else { fail++; console.log('  ✘', name, info) } }
const stare = () => psql(`SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, roles::text, cmd, coalesce(qual,''), coalesce(with_check,'')), E'\\n' ORDER BY tablename, policyname),'')) FROM pg_policies WHERE schemaname='public' AND tablename = ANY(ARRAY[${T.map(t => `'${t}'`).join(',')}]);`).out
const livrare = (sql, nume = NUME) => psql(`BEGIN;\nSELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true) \\g /dev/null\n${sql}\nCOMMIT;`)
const revenire = sql => psql(`BEGIN;\nSELECT set_config('gazpet.revenire_20261004b', 'REVINE_RLS_OFERTARE:' || txid_current(), true) \\g /dev/null\n${sql}\nCOMMIT;`)
// o „cerere REST”: rol + claims în tranzacție, ca PostgREST
const rest = (rol, uid, sql) => psql(`BEGIN;\nSET LOCAL ROLE ${rol};\nSELECT set_config('request.jwt.claims', '${JSON.stringify(uid ? { sub: uid, role: rol } : { role: rol })}', true) \\g /dev/null\n${sql}\nROLLBACK;`)

// initdb/pg_ctl refuză root: ca root rulăm serverul ca utilizatorul „postgres” (runuser)
const ROOTU = process.getuid && process.getuid() === 0
const srv = (cmd, args) => ROOTU ? execFileSync('runuser', ['-u', 'postgres', '--', join(BIN, cmd), ...args], { stdio: 'ignore' }) : execFileSync(join(BIN, cmd), args, { stdio: 'ignore' })
function porneste() {
  if (ROOTU) chmodSync(dir, 0o777)
  srv('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-sync'])
  srv('pg_ctl', ['-D', data, '-o', `-p ${PORT} -k ${dir} -c listen_addresses=''`, '-w', 'start', '-l', join(dir, 'log')])
}
function schema() {
  const r = psql(`
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT anon, authenticated, service_role TO postgres;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_module_access (profile_id uuid, module text);
INSERT INTO public.profiles VALUES ('${U.fara}', false), ('${U.modul}', false), ('${U.owner}', true), ('${U.subm}', false);
INSERT INTO public.user_module_access VALUES ('${U.modul}', 'ofertare'), ('${U.fara}', 'executie'), ('${U.subm}', 'ofertare.rfq');
CREATE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.user_module_access uma
               WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare')
  );
$function$;
REVOKE ALL ON FUNCTION public.fn_are_acces_ofertare() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO authenticated, service_role;
${T.map(t => `CREATE TABLE public.${t} (id bigserial PRIMARY KEY, v text); ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY; GRANT ALL ON public.${t} TO authenticated, service_role; GRANT ALL ON SEQUENCE public.${t}_id_seq TO anon, authenticated; INSERT INTO public.${t}(v) VALUES ('seed');`).join('\n')}
${LIVE}`)
  if (!r.ok) throw new Error('schema: ' + r.out)
}
// matricea de acces pe un tabel, pentru un utilizator
function acces(t, rol, uid) {
  const sel = rest(rol, uid, `SELECT count(*) FROM public.${t};`)
  const ins = rest(rol, uid, `INSERT INTO public.${t}(v) VALUES ('x');`)
  const upd = rest(rol, uid, `WITH u AS (UPDATE public.${t} SET v='y' RETURNING 1) SELECT count(*) FROM u;`)
  const del = rest(rol, uid, `WITH d AS (DELETE FROM public.${t} RETURNING 1) SELECT count(*) FROM d;`)
  return {
    sel: sel.ok && sel.out === '1', ins: ins.ok, upd: upd.ok && upd.out === '1', del: del.ok && del.out === '1',
    anonDenied: [sel, ins, upd, del].every(x => !x.ok && /permission denied/.test(x.out)),
  }
}
try {
  porneste(); schema()
  console.log('1. Starea live reconstruită')
  check(`md5 politici local = md5 citit pe live 30.09 (${MD5_LIVE})`, stare() === MD5_LIVE, stare())
  const liveAfara = acces('ofertare_preturi_materiale', 'authenticated', U.fara)
  check('azi (live): cont fără modul citește ȘI scrie prețuri (expunerea confirmată)', liveAfara.sel && liveAfara.ins && liveAfara.upd && liveAfara.del)
  check('azi (live): anon are GRANT (RLS îl oprește doar prin politici)', psql(`SELECT has_table_privilege('anon','public.ofertare_preturi_materiale','SELECT,TRUNCATE')`).out === 't')

  console.log('2. Gărzi ale migrării')
  check('fără runner (fără gardă) → refuz', !psql(MIG).ok && stare() === MD5_LIVE)
  check('marcaj cu alt nume → refuz', !livrare(MIG, 'alt_nume').ok && stare() === MD5_LIVE)
  check('rollback pe live (nu pornește din patch) → refuz', !revenire(RB).ok && stare() === MD5_LIVE)
  psql(`CREATE POLICY drift_x ON public.ofertare_rfq FOR SELECT TO authenticated USING (true);`)
  const r1 = livrare(MIG)
  check('live schimbat (politică în plus) → refuz, nimic schimbat', !r1.ok && /s-au schimbat/.test(r1.out), r1.out.slice(0, 200))
  psql(`DROP POLICY drift_x ON public.ofertare_rfq;`)
  psql(`REVOKE TRUNCATE ON public.ofertare_rfq FROM anon;`)
  const r1b = livrare(MIG)
  check('ACL anon schimbat → refuz', !r1b.ok && /privilegiile anon/.test(r1b.out), r1b.out.slice(0, 200))
  psql(`GRANT ALL ON public.ofertare_rfq TO anon;`)
  check('înapoi pe starea live', stare() === MD5_LIVE)

  console.log('2b. Amprenta helper-ului, overload-uri, ACL pe coloane, stări anon (runda 2)')
  const refuz = (nume, prep, undo, re) => { psql(prep); const r = livrare(MIG); check(nume, !r.ok && re.test(r.out) && stare() === MD5_LIVE, r.out.slice(0, 200)); psql(undo) }
  const FN = 'public.fn_are_acces_ofertare()'
  refuz('helper: doar search_path schimbat → refuz', `ALTER FUNCTION ${FN} SET search_path = public;`, `ALTER FUNCTION ${FN} SET search_path TO 'public', 'pg_temp';`, /amprenta/)
  refuz('helper: doar proprietarul schimbat → refuz', `CREATE ROLE altul NOLOGIN; ALTER FUNCTION ${FN} OWNER TO altul;`, `ALTER FUNCTION ${FN} OWNER TO postgres; DROP ROLE altul;`, /amprenta/)
  refuz('helper: EXECUTE dat lui anon → refuz', `GRANT EXECUTE ON FUNCTION ${FN} TO anon;`, `REVOKE EXECUTE ON FUNCTION ${FN} FROM anon;`, /amprenta/)
  refuz('helper: EXECUTE dat lui PUBLIC → refuz', `GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC;`, `REVOKE EXECUTE ON FUNCTION ${FN} FROM PUBLIC;`, /amprenta/)
  refuz('helper: VOLATILE în loc de STABLE → refuz', `ALTER FUNCTION ${FN} VOLATILE;`, `ALTER FUNCTION ${FN} STABLE;`, /amprenta/)
  refuz('overload cu argument implicit în public → refuz', `CREATE FUNCTION public.fn_are_acces_ofertare(x int DEFAULT 0) RETURNS boolean LANGUAGE sql AS 'SELECT true';`, `DROP FUNCTION public.fn_are_acces_ofertare(int);`, /overload/)
  refuz('overload în altă schemă → refuz', `CREATE SCHEMA altschema; CREATE FUNCTION altschema.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql AS 'SELECT true';`, `DROP SCHEMA altschema CASCADE;`, /overload/)
  refuz('ACL pe coloană pentru anon → refuz (inventar coloane)', `GRANT SELECT (v) ON public.ofertare_rfq TO anon;`, `REVOKE SELECT (v) ON public.ofertare_rfq FROM anon;`, /pe coloane/)
  refuz('ACL pe coloană pentru authenticated → refuz', `GRANT UPDATE (v) ON public.ofertare_parteneri TO authenticated;`, `REVOKE UPDATE (v) ON public.ofertare_parteneri FROM authenticated;`, /pe coloane/)
  refuz('privilegiu pentru PUBLIC pe un tabel → refuz', `GRANT SELECT ON public.probe_oferte TO PUBLIC;`, `REVOKE SELECT ON public.probe_oferte FROM PUBLIC;`, /PUBLIC/)
  refuz('anon cu GRANT OPTION → refuz', `GRANT SELECT ON public.ofertare_radar TO anon WITH GRANT OPTION;`, `REVOKE GRANT OPTION FOR SELECT ON public.ofertare_radar FROM anon;`, /privilegiile anon/)
  refuz('anon fără TRUNCATE dar authenticated cu TRUNCATE (stare mixtă) → refuz', `REVOKE TRUNCATE ON ${T.map(t => 'public.' + t).join(', ')} FROM anon;`, `GRANT TRUNCATE ON ${T.map(t => 'public.' + t).join(', ')} TO anon;`, /privilegiile anon/)
  refuz('anon fără MAINTAIN → refuz', `REVOKE MAINTAIN ON public.oferta_materiale FROM anon;`, `GRANT MAINTAIN ON public.oferta_materiale TO anon;`, /privilegiile anon/)
  check('înapoi pe starea live (după toate refuzurile)', stare() === MD5_LIVE)
  const authSnap = () => psql(`SELECT string_agg(t||':'||pr||'='||has_table_privilege('authenticated','public.'||t,pr), ';' ORDER BY t, pr) || '#' || coalesce((SELECT string_agg(c.relname||':'||x.privilege_type||':'||x.is_grantable, ';' ORDER BY c.relname, x.privilege_type) FROM pg_class c, aclexplode(c.relacl) x WHERE c.relnamespace='public'::regnamespace AND c.relname = ANY(ARRAY[${T.map(t => `'${t}'`).join(',')}]) AND x.grantee='authenticated'::regrole),'') FROM unnest(ARRAY[${T.map(t => `'${t}'`).join(',')}]) t, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr`).out
  const authInainte = authSnap()

  console.log('3. Migrarea (runner simulat)')
  const r2 = livrare(MIG)
  check('migrarea trece', r2.ok, r2.out)
  check(`md5 politici = starea patch (${MD5_PATCH})`, stare() === MD5_PATCH, stare())
  check('a doua livrare → refuz (deja aplicat)', !livrare(MIG).ok && stare() === MD5_PATCH)
  const ANON8 = `SELECT count(*) FROM unnest(ARRAY[${T.map(t => `'${t}'`).join(',')}]) t, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr WHERE has_table_privilege('anon','public.'||t,pr)`
  check('anon: toate cele 8 privilegii de tabel (incl. REFERENCES/TRIGGER/MAINTAIN) = false pe toate 20', psql(ANON8).out === '0')
  check('anon: niciun privilegiu pe coloane (column_privileges + has_any_column_privilege)', psql(`SELECT (SELECT count(*) FROM information_schema.column_privileges WHERE grantee IN ('anon','PUBLIC') AND table_schema='public' AND table_name = ANY(ARRAY[${T.map(t => `'${t}'`).join(',')}])) + (SELECT count(*) FROM unnest(ARRAY[${T.map(t => `'${t}'`).join(',')}]) t WHERE has_any_column_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,REFERENCES'))`).out === '0')
  check('authenticated: privilegii de tabel + ACL identice înainte/după', authSnap() === authInainte)

  console.log('4. Matricea REST după patch')
  for (const t of T) {
    const an = acces(t, 'anon', null)
    const fa = acces(t, 'authenticated', U.fara)
    const sm = acces(t, 'authenticated', U.subm)
    const mo = acces(t, 'authenticated', U.modul)
    const ow = acces(t, 'authenticated', U.owner)
    const grA = A.includes(t)
    check(`${t} [${grA ? 'A' : 'B'}]: anon refuzat (permission denied la S/I/U/D)`, an.anonDenied)
    check(`${t}: fără modul → scriere refuzată${grA ? ', citire 0 rânduri' : ', citire permisă (grup B)'}`, !fa.ins && !fa.upd && !fa.del && fa.sel === !grA, JSON.stringify(fa))
    check(`${t}: doar sub-modul „ofertare.rfq” → tratat ca fără modul`, !sm.ins && !sm.upd && !sm.del && sm.sel === !grA, JSON.stringify(sm))
    check(`${t}: cu modulul „ofertare” → S/I/U/D permise`, mo.sel && mo.ins && mo.upd && mo.del, JSON.stringify(mo))
    check(`${t}: owner → S/I/U/D permise`, ow.sel && ow.ins && ow.upd && ow.del, JSON.stringify(ow))
  }
  const noJwt = rest('authenticated', null, `SELECT count(*) FROM public.ofertare_preturi_materiale;`)
  check('authenticated fără sub (claims goale) → 0 rânduri', noJwt.ok && noJwt.out === '0')
  check('service_role (edge) neafectat: citește', rest('service_role', null, `SELECT count(*) FROM public.ofertare_rfq;`).out === '1')

  console.log('5. Rollback')
  check('rollback nearmat → refuz', !psql(RB).ok && stare() === MD5_PATCH)
  const r3 = revenire(RB)
  check('rollback armat trece', r3.ok, r3.out)
  check('md5 politici = exact starea live 30.09', stare() === MD5_LIVE, stare())
  check('anon are din nou ALL', psql(`SELECT bool_and(has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) FROM unnest(ARRAY[${T.map(t => `'${t}'`).join(',')}]) t`).out === 't')
  check('re-livrare după rollback trece', livrare(MIG).ok && stare() === MD5_PATCH)

  console.log('6. Compunere cu SEC F1 (#551, TRUNCATE retras) — F1 copiat doar în harness')
  check('F1 disponibil (migrations/ sau branch-ul F1)', !!F1)
  if (F1) {
    const anonSet = `SELECT string_agg(DISTINCT (SELECT string_agg(x.privilege_type, ',' ORDER BY x.privilege_type) FROM aclexplode(c.relacl) x WHERE x.grantee='anon'::regrole), ' | ') FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname = ANY(ARRAY[${T.map(t => `'${t}'`).join(',')}])`
    const anonTrunc = () => psql(`SELECT count(*) FROM unnest(ARRAY[${T.map(t => `'${t}'`).join(',')}]) t WHERE has_table_privilege('anon','public.'||t,'TRUNCATE')`).out
    psql(`GRANT TRUNCATE ON public.ofertare_rfq TO authenticated; REVOKE TRUNCATE ON public.probe_oferte FROM authenticated;`)
    const amb = revenire(RB)
    check('rollback cu stare F1 ambiguă (authenticated TRUNCATE pe 19/20) → refuz', !amb.ok && /ambiguă/.test(amb.out) && stare() === MD5_PATCH, amb.out.slice(0, 200))
    psql(`GRANT TRUNCATE ON public.probe_oferte TO authenticated;`)
    const f1 = livrare(F1, F1_NUME)
    check('#552 → F1: F1 trece peste patch', f1.ok && stare() === MD5_PATCH, f1.out.slice(0, 300))
    const rb2 = revenire(RB)
    check('rollback #552 după F1 trece', rb2.ok, rb2.out.slice(0, 300))
    check('DISCRIMINATOR: după rollback anon NU are TRUNCATE pe niciunul din 20', anonTrunc() === '0')
    check('după rollback anon are exact cele 7 fără TRUNCATE, md5 live', psql(anonSet).out === 'DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,UPDATE' && stare() === MD5_LIVE, psql(anonSet).out)
    check('F1 → #552: migrarea acceptă starea post-F1 (anon fără TRUNCATE)', livrare(MIG).ok && stare() === MD5_PATCH && psql(ANON8).out === '0')
    psql(`GRANT TRUNCATE ON public.ofertare_rfq TO anon;`)
    check('rollback din patch cu anon TRUNCATE pe un tabel → refuz (anon are privilegii)', !revenire(RB).ok)
    psql(`REVOKE TRUNCATE ON public.ofertare_rfq FROM anon;`)
    check('rollback din nou (post-F1) → tot fără TRUNCATE pentru anon', revenire(RB).ok && anonTrunc() === '0' && stare() === MD5_LIVE)
    psql(`GRANT TRUNCATE ON public.ofertare_rfq TO anon;`)
    const mx = livrare(MIG)
    check('post-F1 cu TRUNCATE anon pe un singur tabel (stare mixtă) → migrarea refuză', !mx.ok && /privilegiile anon/.test(mx.out), mx.out.slice(0, 200))
    psql(`REVOKE TRUNCATE ON public.ofertare_rfq FROM anon;`)
    check('authenticated fără TRUNCATE după F1, neatins de #552', psql(`SELECT count(*) FROM unnest(ARRAY[${T.map(t => `'${t}'`).join(',')}]) t WHERE has_table_privilege('authenticated','public.'||t,'TRUNCATE')`).out === '0')
  }
} catch (e) { fail++; console.error(e.message) }
finally {
  try { srv('pg_ctl', ['-D', data, '-m', 'fast', 'stop']) } catch {}
  if (!process.env.KEEP) rmSync(dir, { recursive: true, force: true })
}
console.log(`\n${ok} trecute, ${fail} picate`)
process.exit(fail ? 1 : 0)
