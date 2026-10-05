-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261014a_api_consum_extern_ROLLBACK (r2) — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- Scoate jobul api_consum_extern_zilnic, view-ul v_api_consum_curent și tabelul api_consum_extern.
-- Fără GO de execuție: doar la cererea explicită a lui Răzvan. Armarea nu e autorizare.
-- r2 (Copilot NO-GO r1, P1): pinuită pe starea EXACTĂ a patch-ului — recalculează amprenta structurii (coloane, constrângeri,
--   indecși, triggere, proprietari, ACL tabel/secvență/view, RLS, opțiuni + definiția view-ului, parametrii secvenței + OWNED BY,
--   politici, jobul cu md5 comandă)
--   și o compară cu cea scrisă de migrare la aplicare în comentariul tabelului; orice diferență → refuz, nimic șters.
--   Istoricul citirilor (rânduri) cere o a doua armare, separată (modelul 20261010a r2); garda de armare se reverifică la final.
--   Dacă vrei doar să oprești cronul și să păstrezi istoricul: SELECT cron.unschedule('api_consum_extern_zilnic') (tot la cererea lui Răzvan).
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261014a', 'SCOATE_API_CONSUM:' || txid_current(), true);
--   -- doar dacă tabelul are rânduri și Răzvan a decis explicit și ștergerea istoricului:
--   SELECT set_config('gazpet.revenire_20261014a_date', 'STERGE_ISTORIC_CONSUM:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $arm$
DECLARE
  v_sp text;
  v_amprenta text;
  v_scrisa text;
BEGIN
  IF current_setting('gazpet.revenire_20261014a', true) IS DISTINCT FROM 'SCOATE_API_CONSUM:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261014a: nearmată (gazpet.revenire_20261014a legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261014a%') THEN
    RAISE EXCEPTION 'Revenire 20261014a: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  IF to_regclass('public.api_consum_extern') IS NULL OR to_regclass('public.v_api_consum_curent') IS NULL
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'api_consum_extern_zilnic') <> 1 THEN
    RAISE EXCEPTION 'Revenire 20261014a: tabelul, view-ul sau jobul lipsește — starea nu e cea a patch-ului, refuz';
  END IF;
  -- tabelul nu se mai schimbă sub noi până la COMMIT. (cron.job NU se blochează: pe live postgres nu e superuser și n-are
  -- UPDATE pe cron.job, deci FOR UPDATE ar pica; jobul e oricum al lui postgres și e prins în amprentă.)
  LOCK TABLE public.api_consum_extern IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
              WHERE d.refobjid = 'public.api_consum_extern'::regclass AND r.ev_class <> 'public.v_api_consum_curent'::regclass) THEN
    RAISE EXCEPTION 'Revenire 20261014a: alte view-uri depind de api_consum_extern — refuz (fără CASCADE)';
  END IF;

  -- AMPRENTA 20261014a (identică în migrare și în revenire): structura exactă a patch-ului, fără date.
  -- Calculată cu search_path = pg_catalog, ca textul (pg_get_*def) să nu depindă de sesiune.
  v_sp := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT md5(concat_ws(E'\n',
    (SELECT string_agg(format('%s:%s:%s:%s:%s:%s', a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                              coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), a.attidentity, a.attgenerated), ';' ORDER BY a.attnum)
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'public.api_consum_extern'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
    (SELECT string_agg(c.conname || '=' || pg_get_constraintdef(c.oid), ';' ORDER BY c.conname)
       FROM pg_constraint c WHERE c.conrelid = 'public.api_consum_extern'::regclass),
    (SELECT string_agg(pg_get_indexdef(i.indexrelid), ';' ORDER BY pg_get_indexdef(i.indexrelid))
       FROM pg_index i WHERE i.indrelid = 'public.api_consum_extern'::regclass),
    (SELECT coalesce(string_agg(t.tgname, ';' ORDER BY t.tgname), '-')
       FROM pg_trigger t WHERE t.tgrelid = 'public.api_consum_extern'::regclass AND NOT t.tgisinternal),
    (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s', r.relname, r.relkind, pg_get_userbyid(r.relowner), r.relrowsecurity, r.relforcerowsecurity,
                              coalesce((SELECT string_agg(x::text, ' ' ORDER BY x::text) FROM unnest(r.relacl) x), '-'),
                              coalesce(array_to_string(r.reloptions, ' '), '-')), ';' ORDER BY r.relname)
       FROM pg_class r WHERE r.oid IN ('public.api_consum_extern'::regclass, 'public.api_consum_extern_id_seq'::regclass, 'public.v_api_consum_curent'::regclass)),
    pg_get_viewdef('public.v_api_consum_curent'::regclass),
    -- secvența: parametrii (pg_sequence) + legătura OWNED BY api_consum_extern.id (r3, Copilot P1)
    (SELECT format('%s:%s:%s:%s:%s:%s:%s:%s', format_type(q.seqtypid, NULL), q.seqstart, q.seqincrement, q.seqmax, q.seqmin, q.seqcache, q.seqcycle,
                   coalesce(pg_get_serial_sequence('public.api_consum_extern', 'id'), '-'))
       FROM pg_sequence q WHERE q.seqrelid = 'public.api_consum_extern_id_seq'::regclass),
    (SELECT string_agg(format('%s:%s:%s:%s:%s:%s', p.polname, p.polcmd, p.polpermissive,
                              (SELECT string_agg(n, ' ' ORDER BY n) FROM (SELECT CASE WHEN ro = 0 THEN 'public' ELSE pg_get_userbyid(ro) END AS n FROM unnest(p.polroles) ro) s),
                              coalesce(pg_get_expr(p.polqual, p.polrelid), '-'), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ';' ORDER BY p.polname)
       FROM pg_policy p WHERE p.polrelid = 'public.api_consum_extern'::regclass),
    (SELECT coalesce(string_agg(format('%s:%s:%s:%s:%s:%s:%s:%s', j.jobname, j.schedule, md5(j.command), j.active, j.username, j.database, j.nodename, j.nodeport), ';' ORDER BY j.jobid), '-')
       FROM cron.job j WHERE j.jobname = 'api_consum_extern_zilnic')
  )) INTO v_amprenta;
  PERFORM set_config('search_path', v_sp, true);
  v_scrisa := substring(obj_description('public.api_consum_extern'::regclass, 'pg_class') FROM 'amprenta_20261014a=([0-9a-f]{32})');
  IF v_scrisa IS NULL THEN
    RAISE EXCEPTION 'Revenire 20261014a: amprenta de la aplicare lipsește din comentariul tabelului — refuz';
  END IF;
  IF v_amprenta IS DISTINCT FROM v_scrisa THEN
    RAISE EXCEPTION 'Revenire 20261014a: structura s-a schimbat după aplicare (amprenta % ≠ %) — refuz, nimic șters', v_amprenta, v_scrisa;
  END IF;

  IF EXISTS (SELECT 1 FROM public.api_consum_extern)
     AND current_setting('gazpet.revenire_20261014a_date', true) IS DISTINCT FROM 'STERGE_ISTORIC_CONSUM:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261014a: tabelul are % rânduri de istoric — ștergerea lor cere armarea separată gazpet.revenire_20261014a_date',
      (SELECT count(*) FROM public.api_consum_extern);
  END IF;
END $arm$;

SELECT cron.unschedule('api_consum_extern_zilnic');
DROP VIEW public.v_api_consum_curent;
DROP TABLE public.api_consum_extern;

DO $post$
BEGIN
  IF to_regclass('public.api_consum_extern') IS NOT NULL OR to_regclass('public.v_api_consum_curent') IS NOT NULL
     OR to_regclass('public.api_consum_extern_id_seq') IS NOT NULL
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'api_consum_extern_zilnic') THEN
    RAISE EXCEPTION 'Revenire 20261014a: postcondiție — tabelul, secvența, view-ul sau jobul încă există';
  END IF;
END $post$;

DO $final$
BEGIN
  IF current_setting('gazpet.revenire_20261014a', true) IS DISTINCT FROM 'SCOATE_API_CONSUM:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261014a: garda finală — armarea nu mai e legată de această tranzacție';
  END IF;
END $final$;
