#!/usr/bin/env node
// Test RLS Ofertare (20261004b) pe Postgres LOCAL — simulează calea REST (PostgREST):
// SET LOCAL ROLE anon|authenticated + request.jwt.claims, exact cum face PostgREST pe fiecare cerere.
// Nu atinge live. Rulare: node scripts/test_rls_ofertare.mjs   (PGBIN=/usr/lib/postgresql/17/bin, PGPORT=5497)
// Dovedește: anon refuzat; cont logat fără modul refuzat (grupul A citire+scriere, grupul B scriere);
// cont cu modulul „ofertare” permis; owner permis; md5 stare live reconstruită = cel citit pe 30.09;
// migrarea refuză fără gardă / pe live schimbat / a doua oară; rollback-ul reface exact starea live.
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
const A = ['oferta_materiale','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']
const B = ['ofertare_brokeri','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_parteneri','ofertare_radar']
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

  console.log('3. Migrarea (runner simulat)')
  const r2 = livrare(MIG)
  check('migrarea trece', r2.ok, r2.out)
  check(`md5 politici = starea patch (${MD5_PATCH})`, stare() === MD5_PATCH, stare())
  check('a doua livrare → refuz (deja aplicat)', !livrare(MIG).ok && stare() === MD5_PATCH)

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
} catch (e) { fail++; console.error(e.message) }
finally {
  try { srv('pg_ctl', ['-D', data, '-m', 'fast', 'stop']) } catch {}
  if (!process.env.KEEP) rmSync(dir, { recursive: true, force: true })
}
console.log(`\n${ok} trecute, ${fail} picate`)
process.exit(fail ? 1 : 0)
