// Generatorul migrării 20261230a_izometrie_porti_reconciliere (+ revenirea). Rulare din rădăcina repo-ului:
//   node scripts/izometrie/reconciliere/gen_20261230a.mjs          → rescrie cele două fișiere SQL
//   node scripts/izometrie/reconciliere/gen_20261230a.mjs --verifica → 0 dacă fișierele din repo = ieșirea generatorului
// Corpul porții E2 (fn_izo_porti_lipsa) se ia EXACT din ultima ei definiție din repo (20261109b, fără CR = md5 de pe producție) și i se
// aplică DOAR cele două schimbări de listă (TKT-2026-0393). Orice altă diferență = generatorul refuză. Testul
// src/izoPortiReconciliere.test.js reface totul independent și compară.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const NUME = '20261230a_izometrie_porti_reconciliere'
export const VERSIUNE = '20261230120000'
export const VERSIUNE_REVENIRE = '20261230120001'
export const MIGRARE_REL = `supabase/migrations/${NUME}.sql`
export const REVENIRE_REL = `supabase/revenire/${NUME}_ROLLBACK.sql`
export const SURSA_REL = 'supabase/migrations/20261109b_izometrie_e4b_teren.sql'

// Valorile de pe producție (citite de coordonator 19.11.2026, doar citire) — singurul loc în care apar
export const PROD = {
  stampile: [
    ['fn_izo_porti_definitii', 'porti', 'a79c07584550c02aa32f30b7b4b56646'],
    ['fn_izo_porti_e3_definitii', 'porti_e3', '785fed7197be69709988bada9e598bd4'],
    ['fn_izo_porti_e3b_definitii', 'porti_e3b', '869a529d41f6891a545a7541696f9df7'],
    ['fn_izo_porti_e4_definitii', 'porti_e4', 'be112fb7cdbb55aa8f2b530430a4d9fd'],
    ['fn_izo_porti_e4b_definitii', 'porti_e4b', '696f226046c3ae662ac889562edac863'],
  ],
  // definițiile ACUM (înaintea migrării), în aceeași ordine
  acum: {
    fn_izo_porti_definitii: '0839b958877f2c4b82d50905296c7b10',
    fn_izo_porti_e3_definitii: 'ee2e2689d3e35e820f221e93613e5a58',
    fn_izo_porti_e3b_definitii: '54d2b5e3f17bc8778589f7e18cc057cd',
    fn_izo_porti_e4_definitii: 'e9b5542202e21594b62997fbfd9ebd12',
    fn_izo_porti_e4b_definitii: '1aaa23cc057b6d698c74a29c38887cb9',
  },
  lipsa_md5: '3c136ab43387e8d7807efcadb0768dda',
  lipsa_acl: '{postgres=X/postgres,izo_registru_writer=X/postgres,izo_doc_editor=X/postgres,izo_receptie_writer=X/postgres,izo_cor_editor=X/postgres,izo_corectie_writer=X/postgres}',
  alte_md5: [
    ['fn_izo_porti_definitii', 'ad3b94b0eb39955db07e6ec1bd5b5e8f'],
    ['fn_izo_porti_e3_lipsa', 'f8510ff654386d504539ca4bbf2427c7'],
    ['fn_izo_porti_e4_lipsa', '6905733e1c2ccddce2a5757757f24b6b'],
  ],
  handle_vechi: '5f3f59717d56d1148ac3f4b7d3a2b199',
  handle_nou: 'b1858fddd590635b445127fd6c680d97',
  portal: [
    ['fn_portal_porti_lipsa()', '38488af5684b583108b6ca7fc00fcb36'],
    ['fn_portal_porti_lipsa_1b()', '4e5234fb19aab2a8cdf167c4621e6340'],
  ],
}
// proprietățile porții (neschimbate de migrare): owner | SECURITY DEFINER | proconfig | volatilitate | limbaj | tipul întors
export const LIPSA_PROPR = 'postgres|true|{"search_path=public, pg_temp"}|s|plpgsql|text[]'

const md5 = (s) => createHash('md5').update(Buffer.from(s, 'utf8')).digest('hex')
const unic = (t, s, ce) => {
  const n = t.split(s).length - 1
  if (n !== 1) throw new Error(`${ce}: apare de ${n} ori (trebuie exact o dată)`)
}

// cele DOUĂ schimbări de listă — nimic altceva
export const SCHIMBARI = [
  [`        'trigger on_auth_user_created on auth.users=${PROD.handle_vechi}',\n`,
   `        'trigger on_auth_user_created on auth.users=${PROD.handle_nou}',\n`],
  [`        'fn_conturi_inchideri_sweep()=402874ea5081b41801313e0def9e3226',\n`,
   `        'fn_conturi_inchideri_sweep()=402874ea5081b41801313e0def9e3226',\n` +
   PROD.portal.map(([f, a]) => `        '${f}=${a}',\n`).join('')],
]

export function corpVechi(root) {
  const t = readFileSync(join(root, SURSA_REL), 'utf8').replace(/\r/g, '')
  const marcaj = 'CREATE OR REPLACE FUNCTION public.fn_izo_porti_lipsa() RETURNS text[]'
  unic(t, marcaj, '20261109b: definiția porții')
  const i = t.indexOf(marcaj)
  const antet = '\n    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$'
  if (!t.startsWith(antet, i + marcaj.length)) throw new Error('20261109b: antetul porții s-a schimbat')
  const a = i + marcaj.length + antet.length
  const b = t.indexOf('$f$;', a)
  return t.slice(a, b)
}

export function corpNou(vechi) {
  let t = vechi
  for (const [din, in_] of SCHIMBARI) { unic(t, din, 'schimbarea de listă'); t = t.split(din).join(in_) }
  return t
}

const CREATE = (corp) => `CREATE OR REPLACE FUNCTION public.fn_izo_porti_lipsa() RETURNS text[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$${corp}$f$;`

// garda de start a runnerului, identică ca formă cu 20261221a (validatorul o verifică STRUCTURAL)
const gardaRunner = (eticheta, marcaj, plafon) => `  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '${marcaj}:' || txid_current() THEN
    RAISE EXCEPTION '${eticheta}: garda start invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '${eticheta}: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '${eticheta}: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  -- plafonul total = ceasul de tranzacție PostgreSQL 17, pus de runner înainte de BEGIN (sursa 'session'), citit calificat + marcajul prologului
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '${eticheta}: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '${plafon}/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '${plafon}:' || txid_current() THEN
    RAISE EXCEPTION '${eticheta}: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut ${plafon}/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms ${plafon})',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);`

// proprietățile porții, ca un singur text comparabil: md5(corp) | owner | DEFINER | proconfig | volatilitate | limbaj | tip | ACL
const PROPR_SQL = `(SELECT concat_ws('|', md5(p.prosrc), pg_get_userbyid(p.proowner), p.prosecdef::text, coalesce(p.proconfig::text, ''), p.provolatile::text,
                   l.lanname::text, p.prorettype::regtype::text, coalesce(p.proacl::text, ''), (p.prosqlbody IS NULL)::text, p.pronargs::text, p.prokind::text)
        FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_izo_porti_lipsa()'))`
const propr = (m) => `${m}|${LIPSA_PROPR}|${PROD.lipsa_acl}|true|0|f`

// instantaneul „restul catalogului de funcții + comentariile” (tot în afara porții și a celor 5 ștampile), pentru „nimic altceva atins”
const INSTANTANEU = (tabel) => `CREATE TEMP TABLE ${tabel} ON COMMIT DROP AS
    SELECT 'functie'::text AS tip, p.oid::text AS cheie,
           md5(concat_ws('|', p.proname, p.pronamespace::text, pg_get_userbyid(p.proowner), p.prosecdef::text, coalesce(p.proconfig::text, ''),
                         coalesce(p.proacl::text, ''), p.provolatile::text, p.prolang::text, md5(p.prosrc), coalesce(p.prosqlbody::text, ''),
                         p.proargtypes::text, p.prorettype::text, p.proisstrict::text, p.proleakproof::text, p.proparallel::text, p.prokind::text,
                         p.procost::text, p.prorows::text)) AS val
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
       AND p.oid IS DISTINCT FROM to_regprocedure('public.fn_izo_porti_lipsa()')
    UNION ALL
    SELECT 'comentariu', format('%s:%s:%s', d.classoid, d.objoid, d.objsubid), md5(d.description)
      FROM pg_description d
     WHERE NOT (d.classoid = 'pg_proc'::regclass AND d.objsubid = 0 AND d.objoid IN (
             SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.pronargs = 0
                AND p.proname IN ('fn_izo_porti_definitii', 'fn_izo_porti_e3_definitii', 'fn_izo_porti_e3b_definitii',
                                  'fn_izo_porti_e4_definitii', 'fn_izo_porti_e4b_definitii')))`

const NEATINS = (eticheta, tabel) => `  -- nimic altceva atins: restul funcțiilor (corp, drepturi, proprietăți) și comentariile, identice cu instantaneul de la început
  -- (EXCEPT și UNION ALL au aceeași precedență: partea din dreapta stă între paranteze)
  IF EXISTS (SELECT tip, cheie, val FROM ${tabel} EXCEPT
            (SELECT 'functie'::text, p.oid::text,
                    md5(concat_ws('|', p.proname, p.pronamespace::text, pg_get_userbyid(p.proowner), p.prosecdef::text, coalesce(p.proconfig::text, ''),
                                  coalesce(p.proacl::text, ''), p.provolatile::text, p.prolang::text, md5(p.prosrc), coalesce(p.prosqlbody::text, ''),
                                  p.proargtypes::text, p.prorettype::text, p.proisstrict::text, p.proleakproof::text, p.proparallel::text, p.prokind::text,
                                  p.procost::text, p.prorows::text))
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
                AND p.oid IS DISTINCT FROM to_regprocedure('public.fn_izo_porti_lipsa()')
             UNION ALL
             SELECT 'comentariu', format('%s:%s:%s', d.classoid, d.objoid, d.objsubid), md5(d.description)
               FROM pg_description d
              WHERE NOT (d.classoid = 'pg_proc'::regclass AND d.objsubid = 0 AND d.objoid IN (
                      SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.pronargs = 0
                         AND p.proname IN ('fn_izo_porti_definitii', 'fn_izo_porti_e3_definitii', 'fn_izo_porti_e3b_definitii',
                                           'fn_izo_porti_e4_definitii', 'fn_izo_porti_e4b_definitii')))))
     OR (SELECT count(*) FROM ${tabel}) IS DISTINCT FROM
        ((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
             AND p.oid IS DISTINCT FROM to_regprocedure('public.fn_izo_porti_lipsa()'))
         + (SELECT count(*) FROM pg_description d
             WHERE NOT (d.classoid = 'pg_proc'::regclass AND d.objsubid = 0 AND d.objoid IN (
                     SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.pronargs = 0
                        AND p.proname IN ('fn_izo_porti_definitii', 'fn_izo_porti_e3_definitii', 'fn_izo_porti_e3b_definitii',
                                          'fn_izo_porti_e4_definitii', 'fn_izo_porti_e4b_definitii'))))) THEN
    RAISE EXCEPTION '${eticheta}: alta functie sau alt comentariu s-a schimbat in tranzactie (in afara portii E2 si a celor 5 stampile) - refuz';
  END IF;`

// definițiile ACUM, chemate static (fiecare cu valoarea ei)
const definitiiAcum = (eticheta, cand) => Object.entries(PROD.acum).map(([f, v]) =>
  `  v_x := public.${f}();
  IF v_x IS DISTINCT FROM '${v}' THEN RAISE EXCEPTION '${eticheta}: definitia ${f}() ${cand} = % (asteptat ${v})', coalesce(v_x, 'NULL'); END IF;`).join('\n')

export function genereaza(root) {
  const vechi = corpVechi(root)
  const nou = corpNou(vechi)
  const mV = md5(vechi), mN = md5(nou)
  if (mV !== PROD.lipsa_md5) throw new Error(`corpul din 20261109b are md5 ${mV}, nu ${PROD.lipsa_md5} (producția): opresc`)
  if (vechi.includes('\r') || nou.includes('$f$')) throw new Error('corp invalid')
  const E = '20261230a'
  const stampileVechi = PROD.stampile.map(([f, p, v]) => `     ('${f}', '${p}=${v}')`).join(',\n')

  const migrare = `-- Version ${VERSIUNE}. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 + --amprenta-globala / --diferente-globale (DOAR asa; marcajul gazpet.livrare_migrare legat de txid).
-- ${NUME} — TKT-2026-0393: salvarea în Izometrie e refuzată pentru că porțile E2 / E3 / E3b / E4 / E4b sunt roșii pe producție.
-- FIȘIER GENERAT de scripts/izometrie/reconciliere/gen_20261230a.mjs (nu se editează de mână; testul src/izoPortiReconciliere.test.js
--   verifică generator = fișier).
--
-- Cauza (analiza coordonatorului pe producție, doar citire, 19.11.2026): ștampilele porților (COMMENT-urile porti*=md5) au fost puse de
--   20261120a. După ea s-au aplicat trei migrări legitime din repo care au schimbat obiecte amprentate de porți fără să refacă ștampilele:
--   20261209a (garda de acces pe proiect: trigger-ul trg_executie_acces_garda pe 4 tabele executie_* + 4 politici RESTRICTIVE executie_acces_*
--   pe executie_proiecte și executie_tronsoane), 20261211a (trigger-ul trg_executie_fibra_garda_tronson) și 20261218a (drepturile anon retrase
--   de pe secvențe, inclusiv magazie_bucati_id_seq). Fiecare ștampilă se reconstruiește EXACT din starea de azi cu aceste schimbări scoase.
--   Plus două semnale ale porții E2 care nu sunt ștampile, ambele cazuri cunoscute ale euristicii (fals-pozitive acceptate, fail-closed):
--   (1) excepția revizuită a trigger-ului on_auth_user_created (auth.users → handle_new_user) a căzut pentru că 20261119a a rescris corpul
--       funcției; amprenta nouă (calculată și din corpul din repo) = ${PROD.handle_nou};
--   (2) porțile portalului fn_portal_porti_lipsa() / fn_portal_porti_lipsa_1b() (20261118a / 20261119a) intră ca „SQL dinamic” din cauza
--       literalului 'EXECUTE' din has_function_privilege; ca fn_conturi_inchideri_sweep, trec pe lista revizuită c_dinamice_revizuite, cu
--       amprenta md5(prosrc | proconfig | owner | proacl | prosecdef) (orice schimbare de corp / cale / owner / drepturi redeschide excepția).
--       fn_portal_1b_snapshot() iese apoi singură din închidere (singurii ei „părinți” erau cele două).
-- Ce face (o tranzacție, prin runner):
--   1. gărzi PRE (refuz cu mesaj, nimic schimbat): cele 5 ștampile stocate, cele 5 definiții de acum, corpul + proprietățile + ACL-ul porții E2,
--      corpurile fn_izo_porti_definitii / fn_izo_porti_e3_lipsa / fn_izo_porti_e4_lipsa, amprenta trigger-ului on_auth_user_created și
--      amprentele celor două porți ale portalului — toate = valorile citite pe producție (blocul BASELINE de mai jos);
--   2. CREATE OR REPLACE public.fn_izo_porti_lipsa(): corpul de pe producție (= 20261109b) cu EXACT cele două schimbări de listă; același
--      owner / SECURITY DEFINER / search_path; ACL-ul se păstrează (CREATE OR REPLACE nu-l atinge) și e verificat textual înainte și după;
--   3. refacerea celor 5 ștampile (ca 20261120a), DUPĂ schimbarea corpului (E2a și E4b includ corpurile fn_izo_*);
--   4. gărzi POST: corpul nou (md5 ${mN}) cu aceleași proprietăți și același ACL; fiecare ștampilă = definiția ei curentă; E3 / E3b / E4 =
--      exact definițiile de dinainte (corpul porții nu intră în ele); restul funcțiilor și toate celelalte comentarii neschimbate;
--      fn_izo_porti_lipsa() = '{}' (toate porțile verzi).
-- De ce DOAR cu amprenta globală (L15 v2): refacerea ștampilelor „binecuvântează” catalogul din momentul ei. Gărzile PRE fixează starea
--   analizată; pasul „după” al runnerului (diferența = exact manifestul ${NUME}.l15.tsv, generat pe clonă: o singură linie, funcția
--   fn_izo_porti_lipsa() „schimbat”) refuză orice altă schimbare de catalog apărută între timp în aceeași tranzacție. Fără pasul
--   „înainte” al runnerului (tabelul temporar ag_ina_<T> creat și ținut în ACEASTĂ tranzacție) migrarea refuză (AMPRENTA_GLOBALA_LIPSA; gardă de
--   protocol, nu autorizație; aceeași formă ca 20261225a / 20261226a / 20261131j).
-- Lock-uri (L06): niciun lock pe tabele. Lock-ul consultativ al runnerului (gazpet.livrare_migrare, exclusiv) ține pe loc intrările API
--   Izometrie (îl iau partajat) până la COMMIT; CREATE OR REPLACE / COMMENT iau doar lock-urile de obiect ale funcțiilor atinse.
-- Timpul: fn_izo_porti_lipsa() rulează o singură dată (POST); costul ei + cele două calcule ale amprentei globale se măsoară pe clonă.
-- Revenire: ${REVENIRE_REL} (corpul vechi și ștampilele vechi EXACT; porțile redevin roșii, ca înainte).
-- Probe: scripts/pglite/test_izometrie_porti_reconciliere_local.mjs (PGlite) + src/izoPortiReconciliere.test.js (vitest).
DO $pre$
DECLARE v_plafon text; v_x text; v_n integer; r record;
BEGIN
${gardaRunner(E, NUME, 5000)}
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tiparul 20261225a / 20261226a / 20261131j, identic)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '${E}: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  -- >>> BASELINE ${E} (producție, 19.11.2026; sursa: citirea coordonatorului; amprentele independente de mediu se refac și din repo în teste)
  -- 1. ștampilele stocate, exact
  FOR r IN SELECT * FROM (VALUES
${stampileVechi}
    ) v(f, s) LOOP
    v_x := obj_description(to_regprocedure('public.' || r.f || '()'), 'pg_proc');
    IF v_x IS DISTINCT FROM r.s THEN RAISE EXCEPTION '${E}: stampila %() = % (asteptat %)', r.f, coalesce(v_x, 'lipsa'), r.s; END IF;
  END LOOP;
  -- 2. definițiile de acum (starea analizată)
${definitiiAcum(E, 'inainte')}
  -- 3. poarta E2: corpul de pe producție (= 20261109b), proprietățile și ACL-ul exact
  v_x := ${PROPR_SQL};
  IF v_x IS DISTINCT FROM '${propr(PROD.lipsa_md5)}' THEN
    RAISE EXCEPTION '${E}: poarta fn_izo_porti_lipsa() nu e cea analizata: %', coalesce(v_x, 'lipsa');
  END IF;
  -- 4. corpurile funcțiilor porților pe care se sprijină analiza
  FOR r IN SELECT * FROM (VALUES
${PROD.alte_md5.map(([f, m]) => `     ('${f}', '${m}')`).join(',\n')}
    ) v(f, m) LOOP
    SELECT md5(p.prosrc) INTO v_x FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || r.f || '()');
    IF v_x IS DISTINCT FROM r.m THEN RAISE EXCEPTION '${E}: corpul %() = % (asteptat %)', r.f, coalesce(v_x, 'lipsa'), r.m; END IF;
  END LOOP;
  -- 5. amprenta trigger-ului on_auth_user_created, cu expresia porții (c_implicite_revizuite): corpul rescris de 20261119a
  SELECT count(*), max(md5(concat_ws('|', o.type, o.identity, f.identity, pg_get_userbyid(q.proowner), q.prosecdef::text, coalesce(q.proconfig::text, ''),
                                     l.lanname, md5(q.prosrc || '|' || coalesce(q.prosqlbody::text, '')))))
    INTO v_n, v_x
    FROM pg_trigger t JOIN pg_proc q ON q.oid = t.tgfoid JOIN pg_language l ON l.oid = q.prolang
         CROSS JOIN LATERAL pg_identify_object('pg_trigger'::regclass, t.oid, 0) o
         CROSS JOIN LATERAL pg_identify_object('pg_proc'::regclass, q.oid, 0) f
   WHERE t.tgrelid = to_regclass('auth.users') AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal;
  IF v_n IS DISTINCT FROM 1 OR v_x IS DISTINCT FROM '${PROD.handle_nou}' THEN
    RAISE EXCEPTION '${E}: trigger on_auth_user_created: % rand(uri), amprenta % (asteptat ${PROD.handle_nou})', v_n, coalesce(v_x, 'lipsa');
  END IF;
  -- 6. amprentele porților portalului, cu expresia porții (c_dinamice_revizuite)
  FOR r IN SELECT * FROM (VALUES
${PROD.portal.map(([f, a]) => `     ('${f}', '${f}=${a}')`).join(',\n')}
    ) v(f, e) LOOP
    SELECT format('%s=%s', p.oid::regprocedure::text, md5(p.prosrc || '|' || coalesce(p.proconfig::text, '') || '|' || pg_get_userbyid(p.proowner)
                                                        || '|' || coalesce(p.proacl::text, '') || '|' || p.prosecdef::text))
      INTO v_x FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || r.f);
    IF v_x IS DISTINCT FROM r.e THEN RAISE EXCEPTION '${E}: poarta portalului % = % (asteptat %)', r.f, coalesce(v_x, 'lipsa'), r.e; END IF;
  END LOOP;
  -- <<< BASELINE ${E}
  ${INSTANTANEU('rec_20261230a_inainte')};
END $pre$;

-- poarta E2: corpul de pe producție cu EXACT cele două schimbări de listă (c_dinamice_revizuite: + porțile portalului;
-- c_implicite_revizuite: amprenta nouă a trigger-ului on_auth_user_created)
${CREATE(nou)}

-- ștampilele, DUPĂ corpul nou (ca 20261120a)
DO $stampile$
BEGIN
${PROD.stampile.map(([f, p]) => `  EXECUTE format('COMMENT ON FUNCTION public.${f}() IS %L', '${p}=' || public.${f}());`).join('\n')}
END $stampile$;

DO $post$
DECLARE v_x text; v_lipsa text[]; r record;
BEGIN
  -- 1. poarta: corpul nou, aceleași proprietăți, același ACL
  v_x := ${PROPR_SQL};
  IF v_x IS DISTINCT FROM '${propr(mN)}' THEN
    RAISE EXCEPTION '${E}: postconditie poarta E2: %', coalesce(v_x, 'lipsa');
  END IF;
  -- 2. ștampilele = definiția curentă; E3 / E3b / E4 = exact definițiile de dinainte; E2a / E4b s-au schimbat (includ corpul porții)
  FOR r IN SELECT * FROM (VALUES
${PROD.stampile.map(([f, p]) => `     ('${f}', '${p}', '${PROD.acum[f]}', ${f === 'fn_izo_porti_definitii' || f === 'fn_izo_porti_e4b_definitii' ? 'false' : 'true'})`).join(',\n')}
    ) v(f, pref, acum, egal) LOOP
    EXECUTE format('SELECT public.%I()', r.f) INTO v_x;
    IF v_x IS NULL OR v_x !~ '^[0-9a-f]{32}$' OR obj_description(to_regprocedure('public.' || r.f || '()'), 'pg_proc') IS DISTINCT FROM r.pref || '=' || v_x
       OR (v_x = r.acum) IS DISTINCT FROM r.egal THEN
      RAISE EXCEPTION '${E}: postconditie stampila %(): definitia %, stampila %, inainte %', r.f, coalesce(v_x, 'NULL'),
        coalesce(obj_description(to_regprocedure('public.' || r.f || '()'), 'pg_proc'), 'lipsa'), r.acum;
    END IF;
  END LOOP;
${NEATINS(E, 'rec_20261230a_inainte')}
  -- 3. toate porțile verzi
  v_lipsa := public.fn_izo_porti_lipsa();
  IF v_lipsa IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION '${E}: postconditie porti: %', v_lipsa; END IF;
END $post$;
`

  const revenire = `-- Revenire ${NUME}. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- FIȘIER GENERAT de scripts/izometrie/reconciliere/gen_20261230a.mjs (nu se editează de mână).
-- Pune la loc EXACT starea de dinainte de migrare: corpul vechi al porții E2 (md5 ${mV}, = 20261109b) și cele 5 ștampile vechi (literale).
-- Porțile redevin roșii, ca înainte de migrare (salvarea în Izometrie e din nou refuzată) — revenirea e doar pentru o problemă a migrării.
-- Refuză dacă starea nu e cea lăsată de migrare: corpul nou + proprietăți + ACL, fiecare ștampilă = definiția ei, E3 / E3b / E4 = valorile
--   analizate (altfel catalogul s-a schimbat după migrare și revenirea n-ar mai reface starea analizată). Postcondiții: corpul vechi, ACL-ul,
--   ștampilele vechi, iar cele 5 definiții = exact cele de dinainte de migrare (0839b958… etc.); restul funcțiilor și comentariile neschimbate.
-- LIVRAREA = prin runner, DOAR cu plafon (comanda exactă):
--   bash scripts/livrare_migrare.sh --migrare ${REVENIRE_REL} --sha256 <sha256 al fișierului>
--        --versiune ${VERSIUNE_REVENIRE} --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
--   Runnerul pune marcajul de livrare (gazpet.livrare_migrare = '${NUME}_ROLLBACK:<txid>') și plafonul; fără ele fișierul refuză.
-- Ordinea față de alte reveniri: o revenire mai veche care fixează corpul porții (ex. 20261120a) se rulează DOAR după aceasta.
DO $revenire_pre$
DECLARE v_plafon text; v_x text; r record;
BEGIN
${gardaRunner(`${E} revenire`, `${NUME}_ROLLBACK`, 2000)}
  -- starea lăsată de migrare: corpul nou, proprietățile, ACL-ul
  v_x := ${PROPR_SQL};
  IF v_x IS DISTINCT FROM '${propr(mN)}' THEN
    RAISE EXCEPTION '${E} revenire: poarta E2 nu e cea pusa de migrare (migrare neaplicata sau schimbata): %', coalesce(v_x, 'lipsa');
  END IF;
  -- fiecare ștampilă = definiția ei curentă; E3 / E3b / E4 = valorile analizate
  FOR r IN SELECT * FROM (VALUES
${PROD.stampile.map(([f, p]) => `     ('${f}', '${p}', ${f === 'fn_izo_porti_definitii' || f === 'fn_izo_porti_e4b_definitii' ? 'NULL' : `'${PROD.acum[f]}'`})`).join(',\n')}
    ) v(f, pref, acum) LOOP
    EXECUTE format('SELECT public.%I()', r.f) INTO v_x;
    IF obj_description(to_regprocedure('public.' || r.f || '()'), 'pg_proc') IS DISTINCT FROM r.pref || '=' || v_x
       OR (r.acum IS NOT NULL AND v_x IS DISTINCT FROM r.acum) THEN
      RAISE EXCEPTION '${E} revenire: stampila %() nu mai corespunde starii lasate de migrare (definitia %)', r.f, coalesce(v_x, 'NULL');
    END IF;
  END LOOP;
  ${INSTANTANEU('rec_20261230a_revenire')};
END $revenire_pre$;

-- corpul vechi, exact (= 20261109b, md5 ${mV})
${CREATE(vechi)}

-- ștampilele vechi, exact
${PROD.stampile.map(([f, p, v]) => `COMMENT ON FUNCTION public.${f}() IS '${p}=${v}';`).join('\n')}

DO $revenire_post$
DECLARE v_x text; r record;
BEGIN
  v_x := ${PROPR_SQL};
  IF v_x IS DISTINCT FROM '${propr(mV)}' THEN
    RAISE EXCEPTION '${E} revenire: postconditie poarta E2: %', coalesce(v_x, 'lipsa');
  END IF;
  FOR r IN SELECT * FROM (VALUES
${stampileVechi}
    ) v(f, s) LOOP
    IF obj_description(to_regprocedure('public.' || r.f || '()'), 'pg_proc') IS DISTINCT FROM r.s THEN
      RAISE EXCEPTION '${E} revenire: postconditie stampila %()', r.f;
    END IF;
  END LOOP;
  -- definițiile = exact cele de dinainte de migrare (starea analizată, refăcută)
${definitiiAcum(`${E} revenire`, 'dupa revenire')}
${NEATINS(`${E} revenire`, 'rec_20261230a_revenire')}
END $revenire_post$;
`
  return { migrare, revenire, vechi, nou, md5Vechi: mV, md5Nou: mN }
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const g = genereaza(ROOT)
  if (process.argv.includes('--verifica')) {
    const eq = (rel, t) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '') === t
    const ok = eq(MIGRARE_REL, g.migrare) && eq(REVENIRE_REL, g.revenire)
    console.log(ok ? 'IDENTIC' : 'DIFERIT'); process.exit(ok ? 0 : 1)
  }
  writeFileSync(join(ROOT, MIGRARE_REL), g.migrare)
  writeFileSync(join(ROOT, REVENIRE_REL), g.revenire)
  console.log(`scris ${MIGRARE_REL} + ${REVENIRE_REL}; md5 vechi ${g.md5Vechi}, nou ${g.md5Nou}`)
}
