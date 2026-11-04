-- Version 20261130128000. Runner supplies one transaction.
-- 20261130i_redari_sms_stare — Redări: starea SMS pe deținător (cine a primit, cine nu, de câte ori), citită din modulul Redări.
-- Cerința (Răzvan 04.11.2026): „Trebuie să avem lista clară cu cine a primit, cine nu și de câte ori am trimis.”
-- Problema: sms_loturi / sms_mesaje au RLS pe nivelul SMS (fn_sms_e_owner) — un utilizator Redări (admin / editor / viewer) nu le poate citi.
-- Ce face: O SINGURĂ funcție nouă, fn_red_sms_stare(p_proiect_id uuid), SECURITY DEFINER, STABLE, search_path fix, care întoarce DOAR agregate
-- pe deținător — fără textul SMS, fără telefon, fără cod_eroare, fără furnizor / id furnizor. Fără tabele, vederi sau politici noi.
--   • Acces: refuz 42501 dacă fn_red_nivel() IS NULL (fără nivel pe modulul redari; anon / fără JWT = NULL). Nivelul Redări e pe modul, nu pe proiect
--     (ca restul vederilor red_*), deci orice nivel vede orice proiect al modulului. EXECUTE: doar authenticated (REVOKE de la PUBLIC, anon).
--   • Domeniu: mesajele cu destinatar_tip = 'detinator' din loturile categorie = 'redari' ale proiectului (sms_loturi.proiect_id = p_proiect_id),
--     legate de un red_detinatori al cărui parcelă e în ACELAȘI proiect (destinatar_id = red_detinatori.id::text; verificat read-only 04.11.2026:
--     singurul lot redari live are 1 mesaj 'detinator' cu destinatar_id = id-ul unui red_detinatori). Deținătorii șterși logic rămân în rezultat (istoric).
--   • Ce se numără (pe mesaj, starea curentă din sms_mesaje; tranzițiile din 20261130a: in_coada -> necunoscut -> trimis -> livrat | esuat,
--     necunoscut -> esuat, in_coada -> anulat):
--       nr_trimise  = mesaje cu trimis_la nenul = acceptate de operator („de câte ori am trimis”); include și cele livrate / eșuate după acceptare;
--       nr_livrate  = stare 'livrat' (confirmare de livrare de la operator = „a primit”);
--       nr_esuate   = stare 'esuat' (respins la trimitere SAU eșuat după acceptare);
--       nr_in_curs  = stare 'necunoscut' (rezervat / plecat, rezultat încă necunoscut) + stare 'in_coada' într-un lot 'aprobat' / 'in_trimitere';
--       ignorate    = stare 'anulat' (n-a plecat) și 'in_coada' în lot 'draft' / 'anulat' (neaprobat sau oprit înainte de plecare).
--     ultima_stare = starea (livrat / trimis / esuat / in_curs) a celei mai recente încercări, după coalesce(trimis_la, rezervat_la, creat_la),
--       apoi creat_la, apoi id; ultima_trimitere = max(trimis_la); ultima_livrare = max(livrat_la); loturi = loturi distincte cu mesaje numărate.
--     categorie (o singură definiție, L19; filtrul UI o folosește ca atare): 'livrat' dacă există o livrare; altfel 'trimis' dacă există un mesaj
--       acceptat fără confirmare încă; altfel 'in_curs' dacă există unul în curs; altfel 'esuat' (toate încercările au eșuat).
--     Un deținător fără niciun mesaj numărat NU apare în rezultat (UI: „fără SMS”).
-- Revenire: supabase/revenire/20261130i_redari_sms_stare_ROLLBACK.sql.
-- DRY productie (r2): supabase/tests/20261130i_redari_sms_stare_dryrun.sql — doar citiri + revenire, fara fixture SMS si fara ALTER TABLE pe sms_*.
-- DRY local (PG17 de test): supabase/tests/20261130i_redari_sms_stare_dryrun_local.sql + _schelet.sql — cazurile pe stari, cu fixture.
-- r2 (Jakarinos NO-GO 04.11.2026): preflight cu text EXACT al CHECK-urilor de stare + amprenta fn_red_nivel(); DRY de productie fara blocari.
-- Codul (src/redari/smsStare.js + Registru / Fișa parcelei) cere funcția: se livrează DUPĂ aplicarea acestei migrări.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130i_redari_sms_stare:' || txid_current() THEN
    RAISE EXCEPTION '20261130i: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.sms_loturi') IS NULL OR to_regclass('public.sms_mesaje') IS NULL OR to_regclass('public.red_detinatori') IS NULL
     OR to_regclass('public.red_parcele') IS NULL OR to_regprocedure('public.fn_red_nivel()') IS NULL THEN
    RAISE EXCEPTION '20261130i: lipseste schema SMS / Redari (sms_loturi, sms_mesaje, red_detinatori, red_parcele, fn_red_nivel)';
  END IF;
  IF to_regprocedure('public.fn_red_sms_stare(uuid)') IS NOT NULL THEN RAISE EXCEPTION '20261130i: functia exista deja'; END IF;
  -- coloanele citite (forma din 20261130a)
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sms_mesaje'
        AND column_name IN ('id', 'lot_id', 'destinatar_tip', 'destinatar_id', 'stare', 'trimis_la', 'livrat_la', 'rezervat_la', 'creat_la')) <> 9
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sms_loturi'
        AND column_name IN ('id', 'categorie', 'stare', 'proiect_id')) <> 4
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_parcele' AND column_name IN ('id', 'proiect_id')) <> 2
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_detinatori' AND column_name IN ('id', 'parcela_id')) <> 2 THEN
    RAISE EXCEPTION '20261130i: coloanele SMS / Redari au alta forma';
  END IF;
  -- r2 (Jakarinos NO-GO P2-4): starile pe care le clasifica functia trebuie sa fie EXACT cele din CHECK-urile 20261130a — comparatie de text integral
  -- cu baseline-ul citit read-only pe live 04.11.2026 (o stare noua = CHECK schimbat = refuz aici + review, nu clasificare tacita in NULL / „fara SMS”).
  -- Un CHECK suplimentar poate doar restrange starile, nu le poate extinde; extinderea cere schimbarea acestor doua constrangeri.
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.sms_mesaje'::regclass AND contype = 'c' AND conname = 'sms_mesaje_stare_check')
       IS DISTINCT FROM 'CHECK ((stare = ANY (ARRAY[''in_coada''::text, ''trimis''::text, ''livrat''::text, ''esuat''::text, ''necunoscut''::text, ''anulat''::text])))'
     OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.sms_loturi'::regclass AND contype = 'c' AND conname = 'sms_loturi_stare_check')
       IS DISTINCT FROM 'CHECK ((stare = ANY (ARRAY[''draft''::text, ''aprobat''::text, ''in_trimitere''::text, ''coada_golita''::text, ''anulat''::text])))'
     OR (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sms_mesaje' AND column_name = 'stare') IS DISTINCT FROM 'text'
     OR (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sms_loturi' AND column_name = 'stare') IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION '20261130i: CHECK-urile de stare SMS nu mai sunt exact cele din 20261130a';
  END IF;
  -- r2 (P2-4, L15): amprenta lui fn_red_nivel() — singura poarta de acces a functiei noi: SQL, SECURITY DEFINER, STABLE, fara argumente, RETURNS text,
  -- search_path fix, owner postgres si corpul exact (md5(prosrc) citit read-only pe live 04.11.2026). Orice schimbare = refuz + review.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language g ON g.oid = p.prolang
                  WHERE p.oid = 'public.fn_red_nivel()'::regprocedure AND g.lanname = 'sql' AND p.prosecdef AND p.provolatile = 's' AND p.pronargs = 0
                    AND p.prorettype = 'text'::regtype AND NOT p.proretset AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
                    AND pg_get_userbyid(p.proowner) = 'postgres' AND md5(p.prosrc) = '21db8e5d4b69b7f19e571a7087c361ae') THEN
    RAISE EXCEPTION '20261130i: fn_red_nivel() nu mai are amprenta revizuita (SQL / DEFINER / STABLE / () -> text / search_path / owner / corp)';
  END IF;
  -- functia citeste ca owner (postgres) peste RLS: owner-ul tabelelor trebuie sa fie postgres, fara FORCE RLS
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.sms_loturi'::regclass, 'public.sms_mesaje'::regclass, 'public.red_detinatori'::regclass, 'public.red_parcele'::regclass)
              AND (relforcerowsecurity OR pg_get_userbyid(relowner) <> 'postgres')) THEN
    RAISE EXCEPTION '20261130i: owner / FORCE RLS neasteptat pe tabelele citite';
  END IF;
END $pre$;

CREATE FUNCTION public.fn_red_sms_stare(p_proiect_id uuid)
RETURNS TABLE (detinator_id uuid, nr_trimise integer, nr_livrate integer, nr_esuate integer, nr_in_curs integer, ultima_stare text,
               ultima_trimitere timestamptz, ultima_livrare timestamptz, loturi integer, categorie text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF public.fn_red_nivel() IS NULL THEN
    RAISE EXCEPTION 'redari: acces refuzat (fara nivel pe modulul redari)' USING ERRCODE = '42501';
  END IF;
  IF p_proiect_id IS NULL THEN RAISE EXCEPTION 'redari: proiect lipsa' USING ERRCODE = '22023'; END IF;
  -- doar citire; nicio blocare (L06 n/a). Coloanele iesirii au nume distincte de aliasurile interioare (fara conflict plpgsql).
  RETURN QUERY
  WITH m AS (
    SELECT d.id AS det, x.id AS mid, x.lot_id AS lid, x.trimis_la AS t_la, x.livrat_la AS l_la, x.rezervat_la AS r_la, x.creat_la AS c_la,
           CASE WHEN x.stare = 'livrat' THEN 'livrat'
                WHEN x.stare = 'trimis' THEN 'trimis'
                WHEN x.stare = 'esuat' THEN 'esuat'
                WHEN x.stare = 'necunoscut' THEN 'in_curs'
                WHEN x.stare = 'in_coada' AND l.stare IN ('aprobat', 'in_trimitere') THEN 'in_curs'
           END AS s
      FROM public.sms_mesaje x
      JOIN public.sms_loturi l ON l.id = x.lot_id
      JOIN public.red_detinatori d ON d.id::text = x.destinatar_id
      JOIN public.red_parcele p ON p.id = d.parcela_id
     WHERE l.categorie = 'redari' AND l.proiect_id = p_proiect_id AND p.proiect_id = p_proiect_id AND x.destinatar_tip = 'detinator'
  )
  SELECT m.det,
         (count(*) FILTER (WHERE m.t_la IS NOT NULL))::integer,
         (count(*) FILTER (WHERE m.s = 'livrat'))::integer,
         (count(*) FILTER (WHERE m.s = 'esuat'))::integer,
         (count(*) FILTER (WHERE m.s = 'in_curs'))::integer,
         (array_agg(m.s ORDER BY coalesce(m.t_la, m.r_la, m.c_la) DESC, m.c_la DESC, m.mid DESC))[1],
         max(m.t_la), max(m.l_la),
         (count(DISTINCT m.lid))::integer,
         CASE WHEN bool_or(m.s = 'livrat') THEN 'livrat' WHEN bool_or(m.s = 'trimis') THEN 'trimis' WHEN bool_or(m.s = 'in_curs') THEN 'in_curs' ELSE 'esuat' END
    FROM m
   WHERE m.s IS NOT NULL
   GROUP BY m.det;
END $fn$;
COMMENT ON FUNCTION public.fn_red_sms_stare(uuid) IS 'Redări: agregatele SMS pe deținător pentru un proiect (trimise = acceptate de operator, livrate, eșuate, în curs, ultima stare / trimitere / livrare, loturi, categorie). '
  'Fără text, telefon, cod de eroare sau furnizor. Refuz 42501 fără nivel Redări (fn_red_nivel). Definițiile: antetul migrării 20261130i.';
REVOKE ALL ON FUNCTION public.fn_red_sms_stare(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_sms_stare(uuid) TO authenticated;

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_sms_stare(uuid)'::regprocedure AND prosecdef AND provolatile = 's'
                  AND 'search_path=public, pg_temp' = ANY(proconfig) AND pg_get_userbyid(proowner) = 'postgres') THEN
    RAISE EXCEPTION '20261130i: functia are setari gresite (DEFINER / STABLE / search_path / owner)';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.fn_red_sms_stare(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_red_sms_stare(uuid)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 WHERE p.oid = 'public.fn_red_sms_stare(uuid)'::regprocedure AND a.grantee = 0) THEN
    RAISE EXCEPTION '20261130i: privilegii gresite pe fn_red_sms_stare (doar authenticated)';
  END IF;
  -- iesirea: exact coloanele agregate, fara telefon / text / cod_eroare / furnizor
  IF (SELECT array_agg(n ORDER BY o) FROM pg_proc p, unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS a(n, md, o)
       WHERE p.oid = 'public.fn_red_sms_stare(uuid)'::regprocedure AND a.md = 't')
     IS DISTINCT FROM ARRAY['detinator_id', 'nr_trimise', 'nr_livrate', 'nr_esuate', 'nr_in_curs', 'ultima_stare', 'ultima_trimitere', 'ultima_livrare', 'loturi', 'categorie']::text[] THEN
    RAISE EXCEPTION '20261130i: coloanele de iesire nu sunt cele asteptate';
  END IF;
END $post$;
