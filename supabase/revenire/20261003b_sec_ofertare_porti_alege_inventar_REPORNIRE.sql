-- ════════════════════════════════════════════════════════════════════════════
-- 20261003b — REPORNIRE după oprirea controlată (ieșirea din oprire)
-- NU e migrare: stă în supabase/revenire/ și nu o parcurge niciun runner
-- (supabase/revenire/README.md). Se rulează doar cu acordul explicit al lui Răzvan.
-- ════════════════════════════════════════════════════════════════════════════
-- De ce există (runda 4): traseul comun de livrare (scripts/livrare_migrare.sh) refuză reluarea unei
-- migrări deja înregistrate (fără dublare în schema_migrations). Ieșirea din oprire nu mai e deci
-- „reaplicarea migrării”, ci fișierul ăsta, simetricul opririi:
--   • pornește DOAR din starea completă „oprire” (corpurile patch-ului, EXECUTE doar postgres);
--   • nu creează și nu înlocuiește nicio funcție: reface doar GRANT EXECUTE pentru authenticated și
--     service_role (fără PUBLIC/anon), adică exact ACL-ul patch-ului;
--   • postcondiție înainte de COMMIT: starea = EXACT patch-ul, altfel RAISE (se anulează tot).
-- Nu redeschide nimic: poarta, pragul și protecția verdictelor rămân cele ale patch-ului.
-- Runda 4: SINGURA cale oprire → patch (migrarea refuză starea „oprire”). E o schimbare de drepturi:
-- cere aprobarea lui Răzvan pentru execuția respectivă, motivată prin rezolvarea defectului care a
-- dus la oprire sau prin acceptarea explicită a condițiilor în care serviciul e reactivat.
--
-- GESTIONARUL TRANZACȚIEI E RUNNER-UL (operatorul): fișierul NU conține BEGIN/COMMIT.
-- Execuția documentată e UN SINGUR string, trimis ca un singur query (ex. execute_sql):
--   BEGIN;
--   SELECT set_config('gazpet.repornire_20261003b', 'REPORNESTE_ALEGE_SI_PERECHE:' || txid_current(), true);
--   <acest fișier, întreg>
--   COMMIT;
-- Armare proprie, legată de TRANZACȚIA CURENTĂ; armarea persistentă (pg_db_role_setting) e refuzată.
-- Tot fișierul e UN SINGUR bloc DO. La final dezarmează comutatorul.
-- ════════════════════════════════════════════════════════════════════════════
DO $repornire$
DECLARE
  v_q CONSTANT text := $stari$
WITH fn(ord, fn, nume, sig) AS (VALUES
  (1, 'acces',   'fn_are_acces_ofertare',       'public.fn_are_acces_ofertare()'),
  (2, 'alege',   'fn_ofertare_alege_acoperire', 'public.fn_ofertare_alege_acoperire(bigint)'),
  (3, 'pereche', 'ofertare_inventar_pereche',   'public.ofertare_inventar_pereche(bigint,text,integer,real)')
), fixe(fn, atribute) AS (VALUES
  -- atribute identice în toate stările: proprietar, SECURITY DEFINER, limbaj, volatilitate,
  -- STRICT/LEAKPROOF/PARALLEL/COST/ROWS, n = câte funcții cu numele ăsta există în public
  -- (fără supraîncărcări), semnătura cu nume și DEFAULT-uri, tipul întors
  ('acces',   'secdef=t lang=sql vol=s strict=f leakproof=f parallel=u cost=100 rows=0 owner=postgres n=1 args=() rez=boolean'),
  ('alege',   'secdef=t lang=plpgsql vol=v strict=f leakproof=f parallel=u cost=100 rows=1000 owner=postgres n=1 args=(p_acoperire_id bigint) rez=TABLE(cerinta_id bigint, pozitie_id bigint, ales_id bigint, inlocuit_id bigint)'),
  ('pereche', 'secdef=t lang=plpgsql vol=v strict=f leakproof=f parallel=u cost=100 rows=1000 owner=postgres n=1 args=(p_lic bigint, p_furnizor text DEFAULT NULL::text, p_versiune integer DEFAULT NULL::integer, p_prag real DEFAULT 0.45) rez=TABLE(imperecheate integer, ramase_fara_pereche integer)')
), cunoscut(stare, fn, md5_prosrc, config, acl, efectiv) AS (VALUES
  -- STĂRI COMPLETE: o stare e recunoscută doar dacă TOATE trei funcțiile au rândul ei.
  -- md5(prosrc) = md5 al textului literal al corpului; ACL sortat (COLLATE "C").
  -- efectiv (runda 4) = privilegiile EFECTIVE (has_function_privilege, cu moștenirea prin roluri) pentru
  -- anon, PUBLIC, authenticated, service_role: același proacl cu altă apartenență la roluri = stare necunoscută.
  ('live',   'acces',   '429d28e2a61fb24c8009d67050c16c85', '{"search_path=public, pg_temp"}',            '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}', 'anon=f public=f authenticated=t service_role=t'),
  ('live',   'alege',   '56a7c6ddd1e342c77e7b34f4e08ecab1', '{"search_path=public, pg_temp"}',            '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}', 'anon=f public=f authenticated=t service_role=t'),
  ('live',   'pereche', 'edd4819c81844baafc7eeade838cbcff', '{"search_path=public, extensions, pg_temp"}', '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}', 'anon=f public=f authenticated=t service_role=t'),
  ('patch',  'acces',   '429d28e2a61fb24c8009d67050c16c85', '{"search_path=public, pg_temp"}',            '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}', 'anon=f public=f authenticated=t service_role=t'),
  ('patch',  'alege',   '51865b69766f6baa53def9a6e6c6232b', '{"search_path=public, pg_temp"}',            '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}', 'anon=f public=f authenticated=t service_role=t'),
  ('patch',  'pereche', '4d90bf90b4bbfd6aea944e734f6c9ed9', '{"search_path=public, pg_temp"}',            '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}', 'anon=f public=f authenticated=t service_role=t'),
  ('oprire', 'acces',   '429d28e2a61fb24c8009d67050c16c85', '{"search_path=public, pg_temp"}',            '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}', 'anon=f public=f authenticated=t service_role=t'),
  ('oprire', 'alege',   '51865b69766f6baa53def9a6e6c6232b', '{"search_path=public, pg_temp"}',            '{postgres=X/postgres}', 'anon=f public=f authenticated=f service_role=f'),
  ('oprire', 'pereche', '4d90bf90b4bbfd6aea944e734f6c9ed9', '{"search_path=public, pg_temp"}',            '{postgres=X/postgres}', 'anon=f public=f authenticated=f service_role=f')
), observat AS (
  SELECT fn.ord, fn.fn, md5(p.prosrc) AS md5_prosrc, p.proconfig::text AS config,
         (SELECT array_agg(a::text ORDER BY a::text COLLATE "C")
            FROM unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a)::text AS acl,
         format('secdef=%s lang=%s vol=%s strict=%s leakproof=%s parallel=%s cost=%s rows=%s owner=%s n=%s args=(%s) rez=%s',
                p.prosecdef, l.lanname, p.provolatile, p.proisstrict, p.proleakproof, p.proparallel, p.procost, p.prorows,
                pg_get_userbyid(p.proowner),
                (SELECT count(*) FROM pg_catalog.pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = fn.nume),
                pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)) AS atribute,
         format('anon=%s public=%s authenticated=%s service_role=%s',
                has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('public', p.oid, 'EXECUTE'),
                has_function_privilege('authenticated', p.oid, 'EXECUTE'), has_function_privilege('service_role', p.oid, 'EXECUTE')) AS efectiv
    FROM fn
    LEFT JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(fn.sig)
    LEFT JOIN pg_catalog.pg_language l ON l.oid = p.prolang
), potrivit AS (
  SELECT o.ord, o.fn, o.md5_prosrc, o.config, o.acl, o.atribute, o.efectiv,
         array_agg(c.stare ORDER BY c.stare) FILTER (WHERE c.stare IS NOT NULL) AS stari
    FROM observat o
    JOIN fixe f ON f.fn = o.fn
    LEFT JOIN cunoscut c ON c.fn = o.fn AND c.md5_prosrc = o.md5_prosrc AND c.config IS NOT DISTINCT FROM o.config
                        AND c.acl = o.acl AND f.atribute = o.atribute AND c.efectiv = o.efectiv
   GROUP BY o.ord, o.fn, o.md5_prosrc, o.config, o.acl, o.atribute, o.efectiv
)
SELECT (SELECT s.stare FROM (SELECT unnest(p.stari) AS stare FROM potrivit p) s
         GROUP BY s.stare HAVING count(*) = 3) AS stare,
       string_agg(format('%s=%s', p.fn, coalesce(array_to_string(p.stari, '/'), 'NECUNOSCUTĂ')), ', ' ORDER BY p.ord) AS rezumat,
       string_agg(format('%s: md5(prosrc)=%s config=%s acl=%s efectiv=[%s] %s', p.fn, p.md5_prosrc, p.config, p.acl, p.efectiv, p.atribute),
                  E'\n' ORDER BY p.ord) AS detaliu
  FROM potrivit p
$stari$;
  v_stare text; v_rezumat text; v_detaliu text;
BEGIN
  -- 1. Armare persistentă = refuz. Numele GUC-urilor nu țin cont de majuscule, deci nici căutarea.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s, unnest(s.setconfig) AS c(cfg)
              WHERE lower(split_part(c.cfg, '=', 1)) = 'gazpet.repornire_20261003b') THEN
    RAISE EXCEPTION 'REPORNIRE 20261003b blocată: comutatorul e armat PERSISTENT (ALTER DATABASE/ROLE … SET gazpet.repornire_20261003b, în pg_db_role_setting). Șterge întâi setarea cu ALTER DATABASE/ROLE … RESET; armarea se face doar în tranzacția repornirii.'
      USING ERRCODE = '42501';
  END IF;
  -- 2. Armare legată de tranzacția curentă (txid).
  IF current_setting('gazpet.repornire_20261003b', true) IS DISTINCT FROM ('REPORNESTE_ALEGE_SI_PERECHE:' || txid_current()::text) THEN
    RAISE EXCEPTION 'REPORNIRE 20261003b blocată: nearmată în tranzacția curentă. Doar cu acordul lui Răzvan, în același string: BEGIN; SELECT set_config(''gazpet.repornire_20261003b'', ''REPORNESTE_ALEGE_SI_PERECHE:'' || txid_current(), true); <fișierul>; COMMIT;'
      USING ERRCODE = '42501';
  END IF;
  -- 3. Precondiție: doar din starea COMPLETĂ „oprire”.
  EXECUTE v_q INTO v_stare, v_rezumat, v_detaliu;
  IF v_stare IS DISTINCT FROM 'oprire' THEN
    RAISE EXCEPTION 'REPORNIRE 20261003b blocată: se aplică doar din starea completă „oprire” (acum: %). Compară întâi.', v_rezumat
      USING ERRCODE = '42501', DETAIL = v_detaliu;
  END IF;

  -- 4. Repornirea: ACL-ul patch-ului, nimic altceva.
  REVOKE ALL ON FUNCTION public.fn_ofertare_alege_acoperire(bigint) FROM PUBLIC, anon;
  REVOKE ALL ON FUNCTION public.ofertare_inventar_pereche(bigint, text, integer, real) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.fn_ofertare_alege_acoperire(bigint) TO authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.ofertare_inventar_pereche(bigint, text, integer, real) TO authenticated, service_role;

  -- 5. Postcondiție, înainte de COMMIT: exact starea patch-ului (altfel se anulează tot).
  EXECUTE v_q INTO v_stare, v_rezumat, v_detaliu;
  IF v_stare IS DISTINCT FROM 'patch' THEN
    RAISE EXCEPTION 'Postcondiție REPORNIRE 20261003b: starea rezultată nu e exact starea patch-ului (%). Nimic nu se comite.', v_rezumat
      USING DETAIL = v_detaliu;
  END IF;

  -- 6. Dezarmăm comutatorul (și o eventuală variantă de sesiune), apoi anunțăm.
  PERFORM set_config('gazpet.repornire_20261003b', '', false);
  -- Mesajul NU e dovadă de COMMIT: starea se verifică separat, după COMMIT (docs §12.3).
  RAISE NOTICE 'REPORNIRE 20261003b: postcondiție trecută în tranzacție (ACL și privilegii efective = patch). Efectivă doar după COMMIT reușit și verificarea separată.';
END $repornire$;
