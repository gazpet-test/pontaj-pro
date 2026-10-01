#!/usr/bin/env node
// Test J02b (20261004a) pe Postgres LOCAL — nu atinge live. Rulare: node scripts/test_j02b_na_confirmare.mjs
//   (PGBIN=/usr/lib/postgresql/17/bin, PGPORT=5498). Model: scripts/test_rls_ofertare.mjs (branch rls-ofertare).
// Construiește schema minimă a producției pe care o atinge J02b (tabelele/coloanele citite de migrare), cu:
//   * fn_are_acces_ofertare() cu amprenta EXACTĂ de pe live (md5 429d28e2…, ACL authenticated/postgres/service_role);
//   * fn_gate_depunere() EXACTĂ de pe live (textul din revenire ⇒ md5 4bddf68c…, ACL postgres/service_role);
//   * default privileges ca Supabase (ALL pe tabele/funcții/secvențe noi pentru anon/authenticated/service_role),
//     ca să prindă un GRANT uitat;
//   * v_ofertare_pt_stare MINIMĂ (security_invoker) care conține exact fragmentele înlocuite de migrare. Singura
//     substituție din harness: md5-ul view-ului live (c77c49b8…) → md5-ul view-ului local, în migrare și în revenire.
// Rulează și supabase/tests/j02b_na_confirmare_test.sql (același fișier ca pe clonă) pe un fixture DETERMINIST (licitația 103).
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = process.env.PGBIN || '/usr/lib/postgresql/17/bin'
const PORT = process.env.PGPORT || '5498'
const NUME = '20261004a_ofertare_j02b_na_confirmare_umana'
const MIG_SRC = readFileSync(join(ROOT, 'supabase/migrations', NUME + '.sql'), 'utf8')
const RB_SRC = readFileSync(join(ROOT, 'supabase/revenire', NUME + '_ROLLBACK.sql'), 'utf8')
const TEST_SQL = readFileSync(join(ROOT, 'supabase/tests/j02b_na_confirmare_test.sql'), 'utf8')
const MD5_VIEW_LIVE = 'c77c49b87642c5c2f584d2ed008c7bf3'
const MD5_GATE_LIVE = '4bddf68cfe53107a622d210f4ef3ec51'
const MD5_GATE_NOU = '04102c5e44af4f5fc2062c1a58737bdd'
const MD5_HELPER = '429d28e2a61fb24c8009d67050c16c85'
const U = { fara: '00000000-0000-0000-0000-000000000001', modul: '00000000-0000-0000-0000-000000000002', owner: '00000000-0000-0000-0000-000000000003' }

// textul EXACT al fn_gate_depunere live, din revenire
const GATE_LIVE = RB_SRC.slice(RB_SRC.indexOf('CREATE OR REPLACE FUNCTION public.fn_gate_depunere()'), RB_SRC.indexOf('END $function$;') + 'END $function$;'.length)
const HELPER = `CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.user_module_access uma
               WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare')
  );
$function$;`

const dir = mkdtempSync(join(tmpdir(), 'pg_j02b_'))
const data = join(dir, 'data')
let ok = 0, fail = 0
const psql = (sql, { cwd } = {}) => {
  try {
    const out = execFileSync(join(BIN, 'psql'), ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', dir, '-p', PORT, '-U', 'postgres', '-d', 'postgres'],
      { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd })
    return { ok: true, out: out.trim() }
  } catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() } }
}
const q = sql => { const r = psql(sql); if (!r.ok) throw new Error(sql.slice(0, 120) + ' → ' + r.out); return r.out }
const check = (name, cond, info = '') => { if (cond) { ok++; console.log('  ✔', name) } else { fail++; console.log('  ✘', name, info) } }
let MIG = MIG_SRC, RB = RB_SRC
const livrare = (sql = MIG, nume = NUME) => psql(`BEGIN;\nSELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true) \\g /dev/null\n${sql}\nCOMMIT;`)
const revenire = (sql = RB, arm = 'REVINE_J02B:') => psql(`BEGIN;\nSELECT set_config('gazpet.revenire_20261004a', '${arm}' || txid_current(), true) \\g /dev/null\n${sql}\nCOMMIT;`)
// o „cerere REST”: rol + claims în tranzacție, ca PostgREST
const rest = (rol, uid, sql, fin = 'ROLLBACK') => psql(`BEGIN;\nSELECT set_config('request.jwt.claims', '${JSON.stringify(uid ? { sub: uid, role: rol } : { role: rol })}', true) \\g /dev/null\nSET LOCAL ROLE ${rol};\n${sql}\n${fin};`)
const aplicat = () => q(`SELECT to_regclass('public.ofertare_cerinte_na_confirmari') IS NOT NULL`) === 't'
const md5Gate = () => q(`SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_gate_depunere()'::regprocedure`)
const md5View = () => q(`SELECT md5(pg_get_viewdef('public.v_ofertare_pt_stare'::regclass))`)

const ROOTU = process.getuid && process.getuid() === 0
const srv = (cmd, args) => ROOTU ? execFileSync('runuser', ['-u', 'postgres', '--', join(BIN, cmd), ...args], { stdio: 'ignore' }) : execFileSync(join(BIN, cmd), args, { stdio: 'ignore' })
function porneste() {
  if (ROOTU) chmodSync(dir, 0o777)
  srv('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-sync'])
  srv('pg_ctl', ['-D', data, '-o', `-p ${PORT} -k ${dir} -c listen_addresses=''`, '-w', 'start', '-l', join(dir, 'log')])
}
function schema() {
  q(`
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE altrol NOLOGIN;
GRANT anon, authenticated, service_role TO postgres;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- ca Supabase: obiectele noi primesc ALL pentru anon/authenticated/service_role
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_module_access (profile_id uuid, module text);
INSERT INTO public.profiles VALUES ('${U.fara}', false), ('${U.modul}', false), ('${U.owner}', true);
INSERT INTO public.user_module_access VALUES ('${U.modul}', 'ofertare'), ('${U.fara}', 'executie');
${HELPER}
REVOKE ALL ON FUNCTION public.fn_are_acces_ofertare() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO authenticated, service_role;
CREATE TABLE public.ofertare_licitatii (id bigint PRIMARY KEY, status text, derogare_depunere boolean DEFAULT false, derogare_motiv text, termen_depunere timestamptz, responsabil_id uuid REFERENCES public.profiles(id), contract_id bigint, documentatie_adusa_la timestamptz, updated_at timestamptz);
-- r6: copia EXACTĂ (read-only, 01.10.2026) a triggerului live a00_ofertare_licitatii_scriere — orice cont Ofertare poate scrie orice coloană
CREATE FUNCTION public.fn_ofertare_licitatii_scriere() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $a00$
DECLARE
  v_admin boolean := (session_user = 'postgres');
  v_ofertare boolean := (SELECT public.fn_are_acces_ofertare());
  v_service boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', current_setting('request.jwt.claim.role', true)) = 'service_role';
BEGIN
  IF v_admin OR v_ofertare THEN RETURN NEW; END IF;
  IF v_service THEN
    IF (to_jsonb(OLD) - 'termen_depunere' - 'documentatie_adusa_la' - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'termen_depunere' - 'documentatie_adusa_la' - 'updated_at') THEN
      RAISE EXCEPTION 'Contextul automat (service_role) poate modifica doar termen_depunere/documentatie_adusa_la' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = auth.uid() AND u.module = 'financiar') THEN
    RAISE EXCEPTION 'Contextul curent nu poate modifica o licitație' USING ERRCODE = 'P0001';
  END IF;
  IF (to_jsonb(OLD) - 'contract_id' - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'contract_id' - 'updated_at') THEN
    RAISE EXCEPTION 'Modulul financiar poate modifica doar contract_id pe o licitație' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$a00$;
REVOKE ALL ON FUNCTION public.fn_ofertare_licitatii_scriere() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER a00_ofertare_licitatii_scriere BEFORE INSERT OR UPDATE ON public.ofertare_licitatii FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_licitatii_scriere();
CREATE TABLE public.ofertare_documente_atribuire (id bigint PRIMARY KEY, fisier_path text, size_bytes bigint, revizie text, procesat_la timestamptz, text_extras text);
CREATE TABLE public.ofertare_cerinte (id bigint PRIMARY KEY, licitatie_id bigint REFERENCES public.ofertare_licitatii(id), tip text, text_cerinta text,
  versiune int, sursa_document_id bigint, sursa_pagina int, sursa_pasaj text, inlocuita_de bigint, duplicat_al bigint,
  confirmata_de uuid, confirmata_la timestamptz, stare text);
CREATE TABLE public.documente_firma (id bigint PRIMARY KEY, utilizabil boolean DEFAULT true, fara_expirare boolean DEFAULT true, data_valabilitate date, se_reemite boolean DEFAULT false);
CREATE TABLE public.ofertare_acoperire (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, cerinta_id bigint NOT NULL REFERENCES public.ofertare_cerinte(id), mod text NOT NULL,
  status text NOT NULL, verificat_pe_scan boolean NOT NULL DEFAULT false, reverificare_ceruta boolean, doc_firma_id bigint, motiv text);
CREATE TABLE public.ofertare_pt_pachet (licitatie_id bigint, versiune int, stare text);
CREATE TABLE public.ofertare_pt_legaturi (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cerinta_id bigint NOT NULL REFERENCES public.ofertare_cerinte(id) ON DELETE CASCADE, capitol_id bigint,
  fel text NOT NULL DEFAULT 'capitol' CHECK (fel IN ('capitol','exceptat')), motiv text,
  sursa text NOT NULL DEFAULT 'om' CHECK (sursa IN ('om','ai')), confirmat_de uuid, confirmat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ofertare_pt_legaturi_unic UNIQUE (cerinta_id, capitol_id));
CREATE TABLE public.ofertare_derogari_audit (id bigserial PRIMARY KEY, licitatie_id bigint, actiune text, actor uuid, session_user_name text, motiv text, status_vechi text, status_nou text);
CREATE FUNCTION public.fn_gate_depunere_derogare_owner() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE((SELECT is_owner FROM public.profiles WHERE id = auth.uid()), false) $$;
CREATE FUNCTION public.ofertare_r5_blocaj_sursa(bigint) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
${GATE_LIVE}
REVOKE ALL ON FUNCTION public.fn_gate_depunere() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_gate_depunere BEFORE INSERT OR UPDATE ON public.ofertare_licitatii FOR EACH ROW EXECUTE FUNCTION public.fn_gate_depunere();
CREATE VIEW public.v_ofertare_pt_stare WITH (security_invoker = on) AS
WITH cer AS (
  SELECT c.id, c.licitatie_id,
    (EXISTS (SELECT 1 FROM ofertare_pt_legaturi l_2 WHERE l_2.cerinta_id = c.id AND l_2.fel = 'capitol')) AS are_capitol,
    (EXISTS (SELECT 1 FROM ofertare_pt_legaturi l_1 WHERE l_1.cerinta_id = c.id AND l_1.fel = 'exceptat')) AS exceptata,
    (EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id AND a.status IN ('acoperit','acoperit_partener') AND a.verificat_pe_scan)) AS dovedita,
    (EXISTS (SELECT 1 FROM ofertare_acoperire a_1 WHERE a_1.cerinta_id = c.id AND a_1.status IN ('acoperit','acoperit_partener'))) AS propusa
  FROM ofertare_cerinte c
  WHERE c.tip IN ('propunere','forma') AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL)
SELECT l.id AS licitatie_id, count(cer.id) AS de_raspuns,
  count(*) FILTER (WHERE NOT cer.are_capitol AND NOT cer.exceptata AND NOT cer.dovedita AND NOT cer.propusa) AS fara_capitol,
  count(*) FILTER (WHERE cer.exceptata) AS exceptate,
  count(*) FILTER (WHERE cer.propusa AND NOT cer.dovedita AND NOT cer.are_capitol AND NOT cer.exceptata) AS dovada_de_verificat
FROM ofertare_licitatii l LEFT JOIN cer ON cer.licitatie_id = l.id GROUP BY l.id;
GRANT ALL ON public.v_ofertare_pt_stare TO anon, authenticated, service_role;
-- fixture determinist: licitația 103 (F1 AI-only ×2, F2 fără acoperire, F3 cerință PT liberă ×2) + 104 (poarta cap-coadă)
INSERT INTO public.ofertare_licitatii (id, status) VALUES (103, 'in_lucru'), (104, 'in_lucru');
-- r5: 105 (blocată de poartă: cerință neconfirmată cu „nu se aplică” AI) și 106 (responsabil = contul cu modul Ofertare)
INSERT INTO public.ofertare_licitatii (id, status, responsabil_id) VALUES (105, 'in_lucru', NULL), (106, 'in_lucru', '${U.modul}');
INSERT INTO public.ofertare_documente_atribuire VALUES (1, 'lic103/caiet.pdf', 1000, 'r1', '2026-09-20', 'text extras');
INSERT INTO public.ofertare_cerinte (id, licitatie_id, tip, text_cerinta, versiune, sursa_document_id, sursa_pagina, sursa_pasaj) VALUES
  (1001, 103, 'eliminatorie', 'Certificat ISO 9001', 1, 1, 3, 'pasaj 1'),
  (1002, 103, 'eliminatorie', 'Autorizare ANRE', 1, 1, 4, 'pasaj 2'),
  (1003, 103, 'eliminatorie', 'Experiență similară', 1, 1, 5, 'pasaj 3'),
  (1004, 103, 'propunere', 'Descrierea tehnologiei de execuție', 1, 1, 9, 'pasaj 4'),
  (1005, 103, 'forma', 'Grafic de execuție', 1, 1, 10, 'pasaj 5'),
  (2001, 104, 'eliminatorie', 'Cerință unică 104', 1, NULL, NULL, NULL);
INSERT INTO public.ofertare_acoperire (cerinta_id, mod, status) VALUES (1001, 'nu_se_aplica', 'nu_se_aplica'), (1002, 'nu_se_aplica', 'nu_se_aplica'), (2001, 'nu_se_aplica', 'nu_se_aplica');
INSERT INTO public.ofertare_pt_pachet VALUES (104, 1, 'depus'), (105, 1, 'depus');
INSERT INTO public.ofertare_cerinte (id, licitatie_id, tip, text_cerinta, versiune) VALUES (3001, 105, 'eliminatorie', 'Cerință 105', 1), (3002, 105, 'eliminatorie', 'Cerință 105 b', 1), (4001, 106, 'eliminatorie', 'Cerință 106', 1);
INSERT INTO public.ofertare_acoperire (cerinta_id, mod, status) VALUES (3001, 'nu_se_aplica', 'nu_se_aplica'), (4001, 'nu_se_aplica', 'nu_se_aplica');
UPDATE public.ofertare_cerinte SET confirmata_de = '${U.owner}' WHERE id = 3001;
UPDATE public.ofertare_cerinte SET confirmata_de = '${U.owner}', confirmata_la = now() WHERE licitatie_id = 104;
`)
}

try {
  porneste(); schema()
  const md5ViewLocal = md5View()
  MIG = MIG_SRC.split(MD5_VIEW_LIVE).join(md5ViewLocal)
  RB = RB_SRC.split(MD5_VIEW_LIVE).join(md5ViewLocal)
  console.log('1. Starea live reconstruită (amprente exacte)')
  check(`fn_are_acces_ofertare md5 = ${MD5_HELPER}`, q(`SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_are_acces_ofertare()'::regprocedure`) === MD5_HELPER)
  check(`fn_gate_depunere md5 = ${MD5_GATE_LIVE} (textul din revenire = live)`, md5Gate() === MD5_GATE_LIVE, md5Gate())
  check('fn_gate_depunere ACL = postgres + service_role', q(`SELECT string_agg(x.grantee::regrole::text, ',' ORDER BY 1) FROM pg_proc p, aclexplode(p.proacl) x WHERE p.oid = 'public.fn_gate_depunere()'::regprocedure`) === 'postgres,service_role')
  check('singura substituție: md5 view live → local (o apariție în migrare, două în revenire)',
    MIG_SRC.split(MD5_VIEW_LIVE).length - 1 === 2 && RB_SRC.split(MD5_VIEW_LIVE).length - 1 === 2, `${MIG_SRC.split(MD5_VIEW_LIVE).length - 1}/${RB_SRC.split(MD5_VIEW_LIVE).length - 1}`)

  // r5: verdictele porții ÎNAINTE de apply (comparate după apply cu J02b oprit)
  const incearca = id => psql(`BEGIN; UPDATE public.ofertare_licitatii SET status = 'depusa' WHERE id = ${id}; ROLLBACK;`)
  const pre104 = incearca(104), pre105 = incearca(105)
  check('pre-apply: 104 (doar „nu se aplică” AI) se depune pe regula live', pre104.ok, pre104.out.slice(0, 200))
  check('pre-apply: 105 blocată (1 neconfirmată, 1 neacoperită)', !pre105.ok && /BLOCAT LA DEPUNERE: 1 cerințe neconfirmate de om, 1 cerințe/.test(pre105.out), pre105.out.slice(0, 200))
  const viewPre = q(`SELECT string_agg(licitatie_id || ':' || de_raspuns || '/' || fara_capitol || '/' || exceptate || '/' || dovada_de_verificat, ',' ORDER BY licitatie_id) FROM public.v_ofertare_pt_stare`)

  console.log('2. Gărzi de livrare / revenire')
  check('fără runner (fără gardă) → refuz', !psql(MIG).ok && !aplicat())
  check('marcaj cu alt nume → refuz', !livrare(MIG, 'alt_nume').ok && !aplicat())
  check('migrarea nu conține BEGIN/COMMIT', !/^\s*(BEGIN|COMMIT)\s*;/mi.test(MIG_SRC))
  check('revenirea nu conține BEGIN/COMMIT', !/^\s*(BEGIN|COMMIT)\s*;/mi.test(RB_SRC))
  check('revenire neînarmată → refuz', !psql(RB).ok)
  check('revenire armată greșit → refuz', !revenire(RB, 'ALTCEVA:').ok)
  const rNe = revenire()
  check('revenire armată pe live (J02b neaplicat) → refuz', !rNe.ok && /nu pare aplicată/.test(rNe.out), rNe.out.slice(0, 200))
  check('revenirea nu mai stă în supabase/migrations/', !existsSync(join(ROOT, 'supabase/migrations', NUME + '_ROLLBACK.sql')))

  console.log('3. Precondiții fail-closed (amprente helper + poartă)')
  const refuz = (nume, prep, undo, re) => { q(prep); const r = livrare(); check(nume, !r.ok && re.test(r.out) && !aplicat(), r.out.slice(0, 220)); q(undo) }
  refuz('helper cu alt corp (md5) → refuz', HELPER.replace("= 'ofertare')", "= 'ofertare' )"), HELPER + `REVOKE ALL ON FUNCTION public.fn_are_acces_ofertare() FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO authenticated, service_role;`, /fn_are_acces_ofertare\(\) lipsește sau diferă/)
  refuz('helper cu EXECUTE pentru anon → refuz', `GRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO anon;`, `REVOKE EXECUTE ON FUNCTION public.fn_are_acces_ofertare() FROM anon;`, /fn_are_acces_ofertare\(\) lipsește sau diferă/)
  refuz('helper cu EXECUTE pentru PUBLIC → refuz', `GRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO PUBLIC;`, `REVOKE EXECUTE ON FUNCTION public.fn_are_acces_ofertare() FROM PUBLIC;`, /fn_are_acces_ofertare\(\) lipsește sau diferă/)
  refuz('helper VOLATILE → refuz', `ALTER FUNCTION public.fn_are_acces_ofertare() VOLATILE;`, `ALTER FUNCTION public.fn_are_acces_ofertare() STABLE;`, /fn_are_acces_ofertare\(\) lipsește sau diferă/)
  refuz('helper alt search_path → refuz', `ALTER FUNCTION public.fn_are_acces_ofertare() SET search_path = public;`, `ALTER FUNCTION public.fn_are_acces_ofertare() SET search_path = public, pg_temp;`, /fn_are_acces_ofertare\(\) lipsește sau diferă/)
  refuz('helper alt proprietar → refuz', `ALTER FUNCTION public.fn_are_acces_ofertare() OWNER TO altrol;`, `ALTER FUNCTION public.fn_are_acces_ofertare() OWNER TO postgres;`, /fn_are_acces_ofertare\(\) lipsește sau diferă/)
  refuz('overload fn_are_acces_ofertare în altă schemă → refuz', `CREATE SCHEMA x; CREATE FUNCTION x.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql AS 'SELECT true';`, `DROP SCHEMA x CASCADE;`, /alt overload fn_are_acces_ofertare/)
  refuz('poarta cu EXECUTE pentru authenticated → refuz', `GRANT EXECUTE ON FUNCTION public.fn_gate_depunere() TO authenticated;`, `REVOKE EXECUTE ON FUNCTION public.fn_gate_depunere() FROM authenticated;`, /fn_gate_depunere live diferă/)
  refuz('poarta fără EXECUTE service_role → refuz', `REVOKE EXECUTE ON FUNCTION public.fn_gate_depunere() FROM service_role;`, `GRANT EXECUTE ON FUNCTION public.fn_gate_depunere() TO service_role;`, /fn_gate_depunere live diferă/)
  refuz('poarta alt proprietar → refuz', `ALTER FUNCTION public.fn_gate_depunere() OWNER TO altrol;`, `ALTER FUNCTION public.fn_gate_depunere() OWNER TO postgres;`, /fn_gate_depunere live diferă/)
  refuz('poarta cu alt corp (md5) → refuz', GATE_LIVE.replace('RETURN NEW;', 'RETURN NEW; '), GATE_LIVE, /fn_gate_depunere live diferă/)
  // runda 3: amprenta exactă a triggerului (textul citit live read-only de coordonator)
  const TRIG_LIVE = 'CREATE TRIGGER trg_gate_depunere BEFORE INSERT OR UPDATE ON ofertare_licitatii FOR EACH ROW EXECUTE FUNCTION fn_gate_depunere()'
  const trigDef = () => q(`SET search_path = public, pg_temp; SELECT pg_get_triggerdef(t.oid, true) || '|' || md5(pg_get_triggerdef(t.oid, true)) || '|' || t.tgenabled::text FROM pg_trigger t WHERE t.tgname = 'trg_gate_depunere'`)
  check('trigger local = textul live exact, md5 35e7d6a7…, tgenabled=O', trigDef() === TRIG_LIVE + '|35e7d6a7f7d488556be1df754c26124f|O', trigDef())
  const TRIG_UNDO = `DROP TRIGGER IF EXISTS trg_gate_depunere ON public.ofertare_licitatii; CREATE TRIGGER trg_gate_depunere BEFORE INSERT OR UPDATE ON public.ofertare_licitatii FOR EACH ROW EXECUTE FUNCTION public.fn_gate_depunere();`
  refuz('trigger DISABLE → refuz', `ALTER TABLE public.ofertare_licitatii DISABLE TRIGGER trg_gate_depunere;`, TRIG_UNDO, /trg_gate_depunere diferă/)
  refuz('trigger recreat AFTER → refuz', `DROP TRIGGER trg_gate_depunere ON public.ofertare_licitatii; CREATE TRIGGER trg_gate_depunere AFTER INSERT OR UPDATE ON public.ofertare_licitatii FOR EACH ROW EXECUTE FUNCTION public.fn_gate_depunere();`, TRIG_UNDO, /trg_gate_depunere diferă/)
  refuz('trigger recreat cu WHEN (false) → refuz', `DROP TRIGGER trg_gate_depunere ON public.ofertare_licitatii; CREATE TRIGGER trg_gate_depunere BEFORE INSERT OR UPDATE ON public.ofertare_licitatii FOR EACH ROW WHEN (false) EXECUTE FUNCTION public.fn_gate_depunere();`, TRIG_UNDO, /trg_gate_depunere diferă/)
  refuz('trigger doar BEFORE UPDATE → refuz', `DROP TRIGGER trg_gate_depunere ON public.ofertare_licitatii; CREATE TRIGGER trg_gate_depunere BEFORE UPDATE ON public.ofertare_licitatii FOR EACH ROW EXECUTE FUNCTION public.fn_gate_depunere();`, TRIG_UNDO, /trg_gate_depunere diferă/)
  refuz('r5: coloana j02b_activ există deja → refuz', `ALTER TABLE public.ofertare_licitatii ADD COLUMN j02b_activ boolean;`, `ALTER TABLE public.ofertare_licitatii DROP COLUMN j02b_activ;`, /comutatorul j02b_activ/)
  refuz('r5: RPC fn_ofertare_j02b_activeaza există deja → refuz', `CREATE FUNCTION public.fn_ofertare_j02b_activeaza(bigint) RETURNS int LANGUAGE sql AS 'SELECT 0';`, `DROP FUNCTION public.fn_ofertare_j02b_activeaza(bigint);`, /comutatorul j02b_activ/)
  check('trigger restaurat identic', trigDef() === TRIG_LIVE + '|35e7d6a7f7d488556be1df754c26124f|O')
  // runda 3: EXECUTE efectiv prin membership ⇒ postcondiția pică
  refuz('mutant: GRANT authenticated TO service_role (EXECUTE efectiv prin membership) → postcondiția pică', `GRANT authenticated TO service_role;`, `REVOKE authenticated FROM service_role;`, /EXECUTE efectiv/)
  refuz('mutant: anon membru în authenticated → refuz (pre pe helper sau post EXECUTE efectiv)', `GRANT authenticated TO anon;`, `REVOKE authenticated FROM anon;`, /REFUZ J02b pre|EXECUTE efectiv/)
  refuz('mutant: EXECUTE către rol intermediar al cărui membru e service_role (default privileges) → postcondiția pică', `CREATE ROLE rpc_exec NOLOGIN; GRANT rpc_exec TO service_role; ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO rpc_exec;`, `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM rpc_exec; REVOKE rpc_exec FROM service_role; DROP ROLE rpc_exec;`, /J02b post/)
  // Copilot (neblocant): graful SET ROLE. ACL-ul brut e verificat exact, deci EXECUTE-ul unui rol străin poate veni doar prin
  // moștenire: rol intermediar NOINHERIT care moștenește explicit authenticated (⇒ are EXECUTE), iar service_role e membru în
  // el WITH INHERIT FALSE, SET TRUE ⇒ has_function_privilege('service_role', …) rămâne false (verificarea veche trece), dar
  // SET ROLE rpc_set dă EXECUTE → postcondiția nouă pică
  refuz('mutant: rol intermediar NOINHERIT cu EXECUTE (via authenticated), service_role membru WITH SET fără INHERIT → postcondiția pică (graful SET ROLE)', `CREATE ROLE rpc_set NOLOGIN NOINHERIT; GRANT authenticated TO rpc_set WITH INHERIT TRUE; GRANT rpc_set TO service_role WITH INHERIT FALSE, SET TRUE;`, `REVOKE rpc_set FROM service_role; REVOKE authenticated FROM rpc_set; DROP ROLE rpc_set;`, /J02b post: service_role poate face SET ROLE (rpc_set|authenticated) \(SET\)/)
  refuz('mutant: lanț anon → intermediar (doar SET) → rol cu EXECUTE (via authenticated) → postcondiția pică', `CREATE ROLE rpc_lant NOLOGIN NOINHERIT; GRANT authenticated TO rpc_lant WITH INHERIT TRUE; CREATE ROLE rpc_pas NOLOGIN NOINHERIT; GRANT rpc_lant TO rpc_pas WITH INHERIT FALSE, SET TRUE; GRANT rpc_pas TO anon WITH INHERIT FALSE, SET TRUE;`, `REVOKE rpc_pas FROM anon; REVOKE rpc_lant FROM rpc_pas; REVOKE authenticated FROM rpc_lant; DROP ROLE rpc_pas; DROP ROLE rpc_lant;`, /J02b post: anon poate face SET ROLE (rpc_pas|rpc_lant|authenticated) \(SET\)/)
  // control (fără fals pozitiv): rol cu EXECUTE în care service_role e membru dar FĂRĂ SET și fără INHERIT — rămâne la livrarea din secțiunea 5
  q(`CREATE ROLE rpc_fara_set NOLOGIN NOINHERIT; GRANT authenticated TO rpc_fara_set WITH INHERIT TRUE; GRANT rpc_fara_set TO service_role WITH INHERIT FALSE, SET FALSE;`)
  check('după drift-uri: amprentele sunt din nou cele live', md5Gate() === MD5_GATE_LIVE && q(`SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_are_acces_ofertare()'::regprocedure`) === MD5_HELPER)

  console.log('4. Testul SQL (același fișier ca pe clonă), fixture determinist 103 — BEGIN…ROLLBACK')
  const tdir = join(dir, 'repo'); mkdirSync(join(tdir, 'supabase/migrations'), { recursive: true }); mkdirSync(join(tdir, 'supabase/tests'), { recursive: true })
  writeFileSync(join(tdir, 'supabase/migrations', NUME + '.sql'), MIG)
  const rT = psql(TEST_SQL, { cwd: tdir })
  check('supabase/tests/j02b_na_confirmare_test.sql → J02b TEST PASS (T1–T8, fără SKIP)', rT.ok && /J02b TEST PASS/.test(rT.out) && !/SKIP/.test(rT.out), rT.out.slice(-600))
  check('testul SQL nu lasă nimic în urmă', !aplicat())
  check('testul SQL nu conține SKIP', !/SKIP/.test(TEST_SQL))
  // fixture lipsă ⇒ FAIL (nu SKIP)
  q(`CREATE TABLE _bk AS SELECT * FROM public.ofertare_cerinte WHERE id IN (1004, 1005); DELETE FROM public.ofertare_cerinte WHERE id IN (1004, 1005);`)
  const rF = psql(TEST_SQL, { cwd: tdir })
  check('fixture F3 lipsă ⇒ testul PICĂ (FIXTURE FAIL), nu sare', !rF.ok && /FIXTURE FAIL/.test(rF.out), rF.out.slice(-300))
  q(`INSERT INTO public.ofertare_cerinte SELECT * FROM _bk; DROP TABLE _bk;`)

  console.log('5. Livrare + ACL (postcondiția cerută de Copilot, verificată independent)')
  const r = livrare()
  check('livrarea prin gardă trece', r.ok, r.out.slice(0, 400))
  check('control graf SET ROLE: rol cu EXECUTE în care service_role NU poate intra cu SET → nu blochează livrarea', r.ok && q(`SELECT has_function_privilege('rpc_fara_set', 'public.ofertare_confirma_neaplicabil(bigint,text,text,text,bigint)', 'EXECUTE') AND NOT pg_has_role('service_role', 'rpc_fara_set', 'SET')`) === 't')
  check(`fn_gate_depunere nouă md5 = ${MD5_GATE_NOU}`, md5Gate() === MD5_GATE_NOU)
  check('după migrare: trigger identic cu live (md5 35e7d6a7…, O)', trigDef() === TRIG_LIVE + '|35e7d6a7f7d488556be1df754c26124f|O')
  const efectiv = rol => q(`SET ROLE ${rol}; SELECT has_function_privilege('public.ofertare_confirma_neaplicabil(bigint,text,text,text,bigint)', 'EXECUTE')::text || ',' || has_function_privilege('public.ofertare_revoca_neaplicabil(bigint,text)', 'EXECUTE')::text; RESET ROLE;`)
  check('SET ROLE service_role: has_function_privilege pe RPC-uri = false', efectiv('service_role') === 'false,false', efectiv('service_role'))
  check('SET ROLE anon: false; SET ROLE authenticated: true', efectiv('anon') === 'false,false' && efectiv('authenticated') === 'true,true')
  const priv = (rol, pr) => q(`SELECT has_table_privilege('${rol}', 'public.ofertare_cerinte_na_confirmari', '${pr}')`)
  for (const rol of ['service_role', 'authenticated']) {
    const bad = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'].filter(p => priv(rol, p) !== 'f')
    check(`${rol}: INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN = false`, bad.length === 0, bad.join(','))
    check(`${rol}: SELECT = true`, priv(rol, 'SELECT') === 't')
  }
  check('anon: niciun privilegiu (8 de tabel)', ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'].every(p => priv('anon', p) === 'f'))
  check('PUBLIC: nimic în ACL-ul brut (tabel, view, secvență, copia de revenire)', q(`SELECT count(*) FROM pg_class c, aclexplode(c.relacl) x WHERE c.relname IN ('ofertare_cerinte_na_confirmari','v_ofertare_cerinte_na_stare','ofertare_cerinte_na_confirmari_id_seq','ofertare_j02b_rollback_def') AND x.grantee = 0`) === '0')
  check('ACL brut tabel (fără proprietar) = authenticated:SELECT,service_role:SELECT', q(`SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY 1) FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid = 'public.ofertare_cerinte_na_confirmari'::regclass AND x.grantee <> c.relowner`) === 'authenticated:SELECT,service_role:SELECT')
  check('0 ACL pe coloane', q(`SELECT count(*) FROM pg_attribute WHERE attrelid IN ('public.ofertare_cerinte_na_confirmari'::regclass, 'public.v_ofertare_cerinte_na_stare'::regclass) AND attacl IS NOT NULL`) === '0')
  check('secvența identity: nimeni în afară de proprietar', q(`SELECT count(*) FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid = 'public.ofertare_cerinte_na_confirmari_id_seq'::regclass AND x.grantee <> c.relowner`) === '0')
  check('copia de revenire: nimeni în afară de proprietar', q(`SELECT count(*) FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid = 'public.ofertare_j02b_rollback_def'::regclass AND x.grantee <> c.relowner`) === '0')
  check('RPC-urile: service_role/anon fără EXECUTE', q(`SELECT bool_or(has_function_privilege(r, f, 'EXECUTE')) FROM unnest(ARRAY['service_role','anon']) r, unnest(ARRAY['public.ofertare_confirma_neaplicabil(bigint,text,text,text,bigint)','public.ofertare_revoca_neaplicabil(bigint,text)']) f`) === 'f')
  const sr = (sql) => rest('service_role', null, sql)
  check('service_role (REST): INSERT direct → permission denied', /permission denied/.test(sr(`INSERT INTO public.ofertare_cerinte_na_confirmari (cerinta_id, tip, actor, motiv, amprenta_sursa) VALUES (1001,'nu_se_aplica','${U.owner}','direct sr',md5('x'));`).out))
  check('service_role (REST): UPDATE/DELETE/TRUNCATE → permission denied', ['UPDATE public.ofertare_cerinte_na_confirmari SET motiv = motiv;', 'DELETE FROM public.ofertare_cerinte_na_confirmari;', 'TRUNCATE public.ofertare_cerinte_na_confirmari;'].every(s => /permission denied/.test(sr(s).out)))
  check('service_role (REST): SELECT permis', sr(`SELECT count(*) FROM public.ofertare_cerinte_na_confirmari;`).ok)
  check('authenticated (REST, owner): INSERT/TRUNCATE direct → permission denied', ['INSERT INTO public.ofertare_cerinte_na_confirmari (cerinta_id, tip, actor, motiv, amprenta_sursa) VALUES (1001,\'nu_se_aplica\',\'' + U.owner + '\',\'direct auth\',md5(\'x\'));', 'TRUNCATE public.ofertare_cerinte_na_confirmari;'].every(s => /permission denied/.test(rest('authenticated', U.owner, s).out)))
  check('anon (REST): SELECT → permission denied', /permission denied/.test(rest('anon', null, `SELECT 1 FROM public.ofertare_cerinte_na_confirmari;`).out))
  check('a doua livrare → refuz (obiecte există)', !livrare().ok)

  console.log('5b. Comutatorul J02b pe licitație (r5, varianta B)')
  check('toate licitațiile existente la apply: j02b_activ=false', q(`SELECT count(*) FILTER (WHERE NOT j02b_activ) || '/' || count(*) FROM public.ofertare_licitatii`) === '4/4')
  check('coloana: boolean NOT NULL DEFAULT true', q(`SELECT format_type(atttypid, atttypmod) || ',' || attnotnull || ',' || pg_get_expr(d.adbin, d.adrelid) FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.ofertare_licitatii'::regclass AND a.attname = 'j02b_activ'`) === 'boolean,true,true')
  const post104 = incearca(104), post105 = incearca(105)
  check('flag false: 104 se depune ca înainte (AI „nu se aplică” acoperă — regula veche)', post104.ok, post104.out.slice(0, 200))
  check('flag false: 105 — mesaj de blocare IDENTIC cu cel dinainte de apply', !post105.ok && post105.out.split('\n')[0] === pre105.out.split('\n')[0], post105.out.slice(0, 300))
  check('flag false: v_ofertare_pt_stare dă aceleași cifre ca înainte', q(`SELECT string_agg(licitatie_id || ':' || de_raspuns || '/' || fara_capitol || '/' || exceptate || '/' || dovada_de_verificat, ',' ORDER BY licitatie_id) FROM public.v_ofertare_pt_stare`) === viewPre)
  // exceptare AI pe cerința PT 1004 (licitația 103, J02b oprit): numără ca exceptată (regula veche)
  q(`INSERT INTO public.ofertare_pt_legaturi (cerinta_id, capitol_id, fel, motiv, sursa) VALUES (1004, NULL, 'exceptat', 'AI r5', 'ai')`)
  const st103 = () => q(`SELECT fara_capitol || '/' || exceptate || '/' || exceptate_propuse_ai FROM public.v_ofertare_pt_stare WHERE licitatie_id = 103`)
  check('flag false: exceptarea AI închide cerința PT (fara_capitol 1, exceptate 1, propuse_ai 0)', st103() === '1/1/0', st103())
  // licitație nouă
  check('licitație nouă (INSERT fără coloană) ⇒ j02b_activ=true', psql(`INSERT INTO public.ofertare_licitatii (id, status) VALUES (107, 'identificata');`).ok && q(`SELECT j02b_activ FROM public.ofertare_licitatii WHERE id = 107`) === 't')
  const insFals = psql(`INSERT INTO public.ofertare_licitatii (id, status, j02b_activ) VALUES (108, 'identificata', false);`)
  check('INSERT cu j02b_activ=false → refuz', !insFals.ok && /pornește cu J02b activ/.test(insFals.out), insFals.out.slice(0, 200))
  // false→true în afara RPC-ului
  check('false→true direct (postgres) → refuz', /doar prin fn_ofertare_j02b_activeaza/.test(psql(`UPDATE public.ofertare_licitatii SET j02b_activ = true WHERE id = 103;`).out))
  check('false→true direct (REST owner) → refuz', /doar prin fn_ofertare_j02b_activeaza/.test(rest('authenticated', U.owner, `UPDATE public.ofertare_licitatii SET j02b_activ = true WHERE id = 103;`).out))
  check('r6: false→true cu rând de activare pentru ALTĂ licitație (aceeași tranzacție) → refuz', /doar prin fn_ofertare_j02b_activeaza/.test(psql(`BEGIN; INSERT INTO public.ofertare_j02b_activari (licitatie_id, actor, rol_actor, n_redeschise, txid) VALUES (104, '${U.owner}', 'owner', 0, txid_current()); UPDATE public.ofertare_licitatii SET j02b_activ = true WHERE id = 103; ROLLBACK;`).out))
  check('r6: false→true cu rând de activare din ALTĂ tranzacție → refuz', /doar prin fn_ofertare_j02b_activeaza/.test(psql(`BEGIN; INSERT INTO public.ofertare_j02b_activari (licitatie_id, actor, rol_actor, n_redeschise, txid) VALUES (103, '${U.owner}', 'owner', 0, txid_current() - 1); UPDATE public.ofertare_licitatii SET j02b_activ = true WHERE id = 103; ROLLBACK;`).out))
  check('r6: GUC-ul vechi (gazpet.j02b_activeaza) nu mai armează nimic → refuz', /doar prin fn_ofertare_j02b_activeaza/.test(psql(`BEGIN; SELECT set_config('gazpet.j02b_activeaza', '103:' || txid_current(), true); UPDATE public.ofertare_licitatii SET j02b_activ = true WHERE id = 103; ROLLBACK;`).out))
  // r6: autoatribuire responsabil_id (calea live: a00 lasă orice cont Ofertare să scrie responsabil_id) → activarea refuzată
  const auto1 = rest('authenticated', U.modul, `UPDATE public.ofertare_licitatii SET responsabil_id = '${U.modul}', responsabil_setat_de = NULL WHERE id = 103; SELECT public.fn_ofertare_j02b_activeaza(103);`, 'COMMIT')
  check('r6: autoatribuire + activare în aceeași tranzacție → REFUZ', !auto1.ok && /doar ownerul sau responsabilul/.test(auto1.out), auto1.out.slice(0, 200))
  const auto2 = rest('authenticated', U.modul, `UPDATE public.ofertare_licitatii SET responsabil_id = '${U.modul}', responsabil_setat_de = '${U.owner}' WHERE id = 103;`, 'COMMIT')
  check('r6: autoatribuirea (commit separat) e posibilă pe live, dar responsabil_setat_de = cel care s-a numit (valoarea trimisă de client e ignorată)', auto2.ok && q(`SELECT responsabil_setat_de FROM public.ofertare_licitatii WHERE id = 103`) === U.modul, auto2.out.slice(0, 200))
  const auto3 = rest('authenticated', U.modul, `SELECT public.fn_ofertare_j02b_activeaza(103);`, 'COMMIT')
  check('r6: autoatribuire, apoi activare în altă tranzacție → REFUZ', !auto3.ok && /doar ownerul sau responsabilul/.test(auto3.out), auto3.out.slice(0, 200))
  check('r6: refuzurile n-au atins 103 și jurnalul', q(`SELECT j02b_activ FROM public.ofertare_licitatii WHERE id = 103`) === 'f' && q(`SELECT count(*) FROM public.ofertare_j02b_activari`) === '0')
  q(`UPDATE public.ofertare_licitatii SET responsabil_id = NULL WHERE id = 103;`)
  // RPC: porțile
  const act = (rol, uid, id) => rest(rol, uid, `SELECT public.fn_ofertare_j02b_activeaza(${id});`, 'COMMIT')
  const rAnon = act('anon', null, 106), rSr = act('service_role', null, 106)
  check('RPC: anon → permission denied', !rAnon.ok && /permission denied/.test(rAnon.out), rAnon.out.slice(0, 150))
  check('RPC: service_role → permission denied', !rSr.ok && /permission denied/.test(rSr.out), rSr.out.slice(0, 150))
  const rFaraMod = act('authenticated', U.fara, 106)
  check('RPC: cont fără modul Ofertare → refuz', !rFaraMod.ok && /fără acces la Ofertare/.test(rFaraMod.out), rFaraMod.out.slice(0, 150))
  const rNeresp = act('authenticated', U.modul, 103)
  check('RPC: modul Ofertare dar nici owner nici responsabil → refuz', !rNeresp.ok && /doar ownerul sau responsabilul/.test(rNeresp.out), rNeresp.out.slice(0, 150))
  check('RPC: refuzurile nu au schimbat nimic (103, 106 oprite; jurnal gol)', q(`SELECT count(*) FILTER (WHERE j02b_activ) FROM public.ofertare_licitatii WHERE id IN (103, 106)`) === '0' && q(`SELECT count(*) FROM public.ofertare_j02b_activari`) === '0')
  const impact = rest('authenticated', U.modul, `SELECT public.fn_ofertare_j02b_impact(106);`)
  check('impact pe 106 = 1 cerință de redeschis', impact.ok && impact.out === '1', impact.out)
  const rResp = act('authenticated', U.modul, 106)
  check('RPC: responsabilul licitației pornește J02b → întoarce 1, jurnal cu rol responsabil', rResp.ok && rResp.out === '1' && q(`SELECT j02b_activ || ',' || (SELECT rol_actor || ':' || n_redeschise FROM public.ofertare_j02b_activari WHERE licitatie_id = 106) FROM public.ofertare_licitatii WHERE id = 106`) === 'true,responsabil:1', rResp.out.slice(0, 200))
  const rDin = act('authenticated', U.modul, 106)
  check('RPC: a doua pornire → „deja pornit”', !rDin.ok && /deja pornit/.test(rDin.out))
  const rOwn103 = act('authenticated', U.owner, 103), rOwn104 = act('authenticated', U.owner, 104)
  check('RPC: owner pornește 103 și 104', rOwn103.ok && rOwn104.ok, rOwn103.out + rOwn104.out)
  check('flag true: exceptarea AI NU mai închide (fara_capitol 2, exceptate 0, propuse_ai 1)', st103() === '2/0/1', st103())
  // true→false: toate căile
  check('true→false direct (postgres) → refuz', /nu se mai poate opri/.test(psql(`UPDATE public.ofertare_licitatii SET j02b_activ = false WHERE id = 104;`).out))
  check('true→false REST owner → refuz', /nu se mai poate opri/.test(rest('authenticated', U.owner, `UPDATE public.ofertare_licitatii SET j02b_activ = false WHERE id = 104;`).out))
  check('true→false REST service_role → refuz', /nu se mai poate opri|permission denied/.test(rest('service_role', null, `UPDATE public.ofertare_licitatii SET j02b_activ = false WHERE id = 104;`).out))
  check('true→false cu rând de activare în tranzacția curentă → tot refuz', /nu se mai poate opri/.test(psql(`BEGIN; INSERT INTO public.ofertare_j02b_activari (licitatie_id, actor, rol_actor, n_redeschise, txid) VALUES (999, '${U.owner}', 'owner', 0, txid_current()); UPDATE public.ofertare_licitatii SET j02b_activ = false WHERE id = 104; ROLLBACK;`).out))
  check('r6: jurnalul are txid-ul tranzacției de pornire pe fiecare rând', q(`SELECT count(*) FILTER (WHERE txid IS NULL) || '/' || count(*) FROM public.ofertare_j02b_activari`) === '0/3')
  // r6: responsabil numit de owner (nu autoatribuit) → poate porni
  q(`INSERT INTO public.ofertare_licitatii (id, status) VALUES (109, 'identificata');`)
  check('r6: owner numește responsabilul (REST) → responsabil_setat_de = owner', rest('authenticated', U.owner, `UPDATE public.ofertare_licitatii SET responsabil_id = '${U.modul}' WHERE id = 109;`, 'COMMIT').ok && q(`SELECT responsabil_setat_de FROM public.ofertare_licitatii WHERE id = 109`) === U.owner)
  // control 0e (gate-ul permanent din runner) pe baza după apply
  const c0e = psql(readFileSync(join(ROOT, 'scripts/control_0e.sql'), 'utf8'))
  check('r6: scripts/control_0e.sql după apply → 0 rânduri', c0e.ok && c0e.out === '', c0e.out.slice(0, 400))
  check('true→false odată cu depunerea → refuz (și poarta evaluează regula nouă)', !psql(`UPDATE public.ofertare_licitatii SET j02b_activ = false, status = 'depusa' WHERE id = 104;`).ok)
  check('flag true: 104 rămâne pornită', q(`SELECT j02b_activ FROM public.ofertare_licitatii WHERE id = 104`) === 't')
  check('RPC fn_ofertare_j02b_activeaza: ACL brut exact authenticated + postgres', q(`SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text) FROM pg_proc p, aclexplode(p.proacl) x WHERE p.oid = 'public.fn_ofertare_j02b_activeaza(bigint)'::regprocedure`) === 'authenticated:EXECUTE,postgres:EXECUTE')
  check('jurnalul pornirilor: INSERT direct (REST owner) → permission denied', /permission denied/.test(rest('authenticated', U.owner, `INSERT INTO public.ofertare_j02b_activari (licitatie_id, actor, rol_actor, n_redeschise) VALUES (105, '${U.owner}', 'owner', 0);`).out))

  console.log('6. Comportament cap-coadă (REST simulat)')
  const conf = (uid, cid, tip, extra = '') => rest('authenticated', uid, `SELECT public.ofertare_confirma_neaplicabil(${cid}, '${tip}', 'motiv de test J02b', public.fn_ofertare_cerinta_amprenta(${cid}), (SELECT propunere_id FROM public.fn_ofertare_na_propunere_curenta(${cid}, '${tip}')));${extra}`, 'COMMIT')
  const rFara = conf(U.fara, 2001, 'nu_se_aplica')
  check('cont fără modul Ofertare: confirmarea refuzată', !rFara.ok && /fără acces la Ofertare/.test(rFara.out), rFara.out.slice(0, 200))
  check('cont fără modul: amprenta = NULL (fail-closed)', rest('authenticated', U.fara, `SELECT public.fn_ofertare_cerinta_amprenta(2001) IS NULL;`).out === 't')
  const blocat = psql(`UPDATE public.ofertare_licitatii SET status = 'depusa' WHERE id = 104;`)
  check('poarta: 104 cu „nu se aplică” doar AI → BLOCAT', !blocat.ok && /BLOCAT LA DEPUNERE: 0 cerințe neconfirmate de om, 1 cerințe .*din ele 1 au doar/.test(blocat.out), blocat.out.slice(0, 300))
  const rMod = conf(U.modul, 2001, 'nu_se_aplica')
  check('cont cu modul Ofertare: confirmarea trece (legată de rândul AI)', rMod.ok, rMod.out.slice(0, 200))
  const trece = psql(`UPDATE public.ofertare_licitatii SET status = 'depusa' WHERE id = 104;`)
  check('poarta: după confirmarea umană, 104 se depune', trece.ok, trece.out.slice(0, 300))
  q(`UPDATE public.ofertare_licitatii SET status = 'in_lucru' WHERE id = 104;`)
  const idConf = q(`SELECT id FROM public.ofertare_cerinte_na_confirmari WHERE cerinta_id = 2001 AND revocata_la IS NULL`)
  check('revocare de către altcineva decât autorul (fără owner) → refuz', !rest('authenticated', U.fara, `SELECT public.ofertare_revoca_neaplicabil(${idConf}, 'revoc eu');`).ok)
  check('revocare de owner → trece; poarta blochează din nou', rest('authenticated', U.owner, `SELECT public.ofertare_revoca_neaplicabil(${idConf}, 'revocat de owner test');`, 'COMMIT').ok
    && !psql(`UPDATE public.ofertare_licitatii SET status = 'depusa' WHERE id = 104;`).ok)
  check('reconfirmare după revocare → trece', conf(U.modul, 2001, 'nu_se_aplica').ok && q(`SELECT count(*) FROM public.ofertare_cerinte_na_confirmari WHERE cerinta_id = 2001`) === '2')

  console.log('7. Revenirea (supabase/revenire/, armare proprie)')
  const rb = revenire()
  check('revenirea armată trece', rb.ok, rb.out.slice(0, 300))
  check(`poarta revenită exact (md5 ${MD5_GATE_LIVE}, ACL postgres/service_role)`, md5Gate() === MD5_GATE_LIVE && q(`SELECT string_agg(x.grantee::regrole::text, ',' ORDER BY 1) FROM pg_proc p, aclexplode(p.proacl) x WHERE p.oid = 'public.fn_gate_depunere()'::regprocedure`) === 'postgres,service_role')
  check('view revenit exact (md5 local de dinainte)', md5View() === md5ViewLocal)
  check('confirmările umane păstrate în arhivă, fără acces pentru anon/authenticated/service_role',
    q(`SELECT count(*) FROM public.ofertare_cerinte_na_confirmari_arhiva_j02b`) === '2'
    && q(`SELECT bool_or(has_table_privilege(r, 'public.ofertare_cerinte_na_confirmari_arhiva_j02b', 'SELECT')) FROM unnest(ARRAY['anon','authenticated','service_role']) r`) === 'f')
  check('obiectele J02b au dispărut', q(`SELECT count(*) FROM pg_proc WHERE proname IN ('fn_ofertare_cerinta_amprenta','fn_ofertare_na_propunere_curenta','fn_ofertare_na_confirmare_valida','fn_ofertare_cerinta_na_confirmata','ofertare_confirma_neaplicabil','ofertare_revoca_neaplicabil')`) === '0')
  check('re-livrare cu arhiva prezentă → refuz', !livrare().ok)
  check('r5 revenit: coloana j02b_activ, triggerul și RPC-ul au dispărut; pornirile în arhivă (3), fără acces',
    q(`SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.ofertare_licitatii'::regclass AND attname = 'j02b_activ' AND NOT attisdropped`) === '0'
    && q(`SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_ofertare_j02b_sens_unic'`) === '0'
    && q(`SELECT count(*) FROM pg_proc WHERE proname IN ('fn_ofertare_j02b_activeaza','fn_ofertare_j02b_sens_unic','fn_ofertare_j02b_impact')`) === '0'
    && q(`SELECT count(*) FROM public.ofertare_j02b_activari_arhiva`) === '3'
    && q(`SELECT bool_or(has_table_privilege(r, 'public.ofertare_j02b_activari_arhiva', 'SELECT')) FROM unnest(ARRAY['anon','authenticated','service_role']) r`) === 'f')
  check('re-livrare cu arhiva pornirilor prezentă → refuz', (() => { q(`DROP TABLE public.ofertare_cerinte_na_confirmari_arhiva_j02b;`); return !livrare().ok })())
  q(`DROP TABLE public.ofertare_j02b_activari_arhiva;`)
  check('re-livrare după curățarea arhivei → trece', livrare().ok)
  check('re-livrare: TOATE licitațiile existente (inclusiv 107 și 109 create cu J02b pornit) revin la j02b_activ=false', q(`SELECT count(*) FILTER (WHERE NOT j02b_activ) || '/' || count(*) FROM public.ofertare_licitatii`) === '6/6')
  check('revenire pe tabel gol → trece și șterge tabelul', revenire().ok && q(`SELECT to_regclass('public.ofertare_cerinte_na_confirmari') IS NULL AND to_regclass('public.ofertare_cerinte_na_confirmari_arhiva_j02b') IS NULL AND to_regclass('public.ofertare_j02b_activari') IS NULL AND to_regclass('public.ofertare_j02b_activari_arhiva') IS NULL`) === 't')

  console.log('8. Nicio scriere directă în tabel din aplicație (src/, supabase/functions/, worker/)')
  const fisiere = []
  const umbla = d => { if (!existsSync(d)) return; for (const f of readdirSync(d)) { const p = join(d, f); if (f === 'node_modules') continue; const s = statSync(p); if (s.isDirectory()) umbla(p); else if (/\.(m?[jt]sx?|sql)$/.test(f)) fisiere.push(p) } }
  for (const d of ['src', 'supabase/functions', 'worker']) umbla(join(ROOT, d))
  const scrieri = fisiere.filter(f => {
    const t = readFileSync(f, 'utf8')
    return /ofertare_cerinte_na_confirmari['"`]\s*\)\s*\.\s*(insert|update|upsert|delete)/.test(t) || /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(public\.)?ofertare_cerinte_na_confirmari\b/i.test(t)
  })
  check(`nicio scriere directă în ofertare_cerinte_na_confirmari (${fisiere.length} fișiere)`, scrieri.length === 0, scrieri.join(', '))
} catch (e) {
  fail++; console.log('  ✘ EROARE', e.message)
} finally {
  try { srv('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']) } catch {}
  rmSync(dir, { recursive: true, force: true })
}
console.log(`\n${ok} OK, ${fail} FAIL`)
process.exit(fail ? 1 : 0)
