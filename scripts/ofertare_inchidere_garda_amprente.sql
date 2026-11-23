-- Amprentele baseline pentru migrarea 20261132a_ofertare_inchidere_garda (PR #1029 r2, review Jakarinos 11.11 P1). DOAR CITIRE.
-- Rulat de COORDONATOR (sesiunea de cod nu are acces la BD), din rădăcina repo-ului, pe producție și apoi pe clonă:
--   psql -X -v ON_ERROR_STOP=1 -f scripts/ofertare_inchidere_garda_amprente.sql -o <ieșire.txt>
-- Tranzacție READ ONLY (deschisă și închisă aici, cu ROLLBACK): scriptul nu scrie nimic, nu ia lock-uri explicite și nu creează obiecte.
-- Tipărește:
--   1. pentru FIECARE etichetă: amprenta (md5) și MATERIALUL din care s-a calculat (definiția funcției, a trigger-ului, a politicii,
--      ACL-urile, RLS / FORCE, tipurile coloanelor) — se revizuiește față de migrările din repo, nu se copiază orbește;
--   2. blocul gata de lipit: înlocuiește INTEGRAL conținutul dintre marcajele „>>> AMPRENTE BASELINE” și „<<< AMPRENTE BASELINE” din
--      supabase/migrations/20261132a_ofertare_inchidere_garda.sql (apoi sha256 pe fișier, review, dry-run — pașii din antetul migrării).
-- Valorile pentru REVENIRE nu vin de aici: revenirea verifică obiectele create de migrare (corpul gărzii, md5 fără CR, calculat din
-- migrarea din repo și verificat de scripts/ofertare_inchidere_garda_amprente.test.js; trigger-ul pe câmpuri) — dry-run-ul le probează.
-- Interogarea dintre marcajele „AMPRENTE: interogarea” e IDENTICĂ cu cea din migrare (pg_temp.fn_20261132a_amprente); testul vitest
-- compară textul. Aici rulează cu același search_path (pg_catalog, pg_temp), ca deparsarea să fie aceeași.
\set ON_ERROR_STOP on
\encoding UTF8
\pset format unaligned
\pset tuples_only on
\pset pager off
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog, pg_temp;
SELECT CASE WHEN current_setting('transaction_read_only') = 'on' THEN '-- tranzactie READ ONLY: da'
            ELSE 'EROARE: tranzactia nu e READ ONLY' END
    || E'\n-- baza: ' || current_database() || ', server ' || current_setting('server_version') || ', utilizator ' || session_user
    || E'\n-- moment: ' || to_char(statement_timestamp(), 'YYYY-MM-DD HH24:MI:SS TZ');
WITH q AS (
-- >>> AMPRENTE: interogarea
WITH tabel AS (
  SELECT c.oid, c.relowner, c.relrowsecurity, c.relforcerowsecurity, c.relacl
    FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('public.ofertare_licitatii')
), fn_lista(eticheta, sig) AS (VALUES
  ('fn:auth.uid()', 'auth.uid()'),
  ('fn:public.fn_are_acces_ofertare()', 'public.fn_are_acces_ofertare()'),
  ('fn:public.fn_ofertare_licitatii_scriere()', 'public.fn_ofertare_licitatii_scriere()'),
  ('fn:public.fn_ofertare_poate_cheltui(bigint,uuid)', 'public.fn_ofertare_poate_cheltui(bigint,uuid)'),
  ('fn:public.fn_ofertare_responsabil_setat_de()', 'public.fn_ofertare_responsabil_setat_de()')
), trg AS (
  SELECT t.* FROM pg_catalog.pg_trigger t JOIN tabel ON t.tgrelid = tabel.oid WHERE NOT t.tgisinternal
), fn_mat AS (
  SELECT p.oid,
         'semnatura: ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      || E'\nproprietar: ' || pg_get_userbyid(p.proowner)
      || E'\nsecurity_definer: ' || p.prosecdef::text
      || E'\nproconfig: ' || coalesce(p.proconfig::text, '<NULL>')
      || E'\nacl: ' || coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text COLLATE "C") FROM unnest(p.proacl) AS a),
                               '<NULL = drepturile implicite, inclusiv EXECUTE pentru PUBLIC>')
      || E'\nlimbaj: ' || l.lanname || ', volatil: ' || p.provolatile::text || ', strict: ' || p.proisstrict::text
      || ', leakproof: ' || p.proleakproof::text || ', paralel: ' || p.proparallel::text
      || E'\nsupraincarcari cu acelasi nume: ' || (SELECT count(*) FROM pg_catalog.pg_proc q
                                                     WHERE q.pronamespace = p.pronamespace AND q.proname = p.proname)::text
      || E'\ndefinitia (pg_get_functiondef, fara CR):\n' || replace(pg_get_functiondef(p.oid), chr(13), '') AS material
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
   WHERE p.oid IN (SELECT to_regprocedure(f.sig)::oid FROM fn_lista f UNION SELECT trg.tgfoid FROM trg)
), amprente(eticheta, material) AS (
  SELECT f.eticheta, coalesce(m.material, '<LIPSA: ' || f.sig || '>')
    FROM fn_lista f LEFT JOIN fn_mat m ON m.oid = to_regprocedure(f.sig)::oid
  UNION ALL
  SELECT 'trg:' || t.tgname,
         'definitia: ' || pg_get_triggerdef(t.oid)
      || E'\ntgtype: ' || t.tgtype::text || ', activ: ' || t.tgenabled::text || ', amanabil: ' || t.tgdeferrable::text
      || ', amanat_initial: ' || t.tginitdeferred::text || ', constrangere: ' || (t.tgconstraint <> 0)::text
      || E'\nWHEN: ' || coalesce(pg_get_expr(t.tgqual, t.tgrelid), '<NULL = fara conditie>')
      || E'\nUPDATE OF: ' || coalesce((SELECT string_agg(a.attname::text, ',' ORDER BY k.ord)
                                         FROM unnest(t.tgattr::int2[]) WITH ORDINALITY AS k(attnum, ord)
                                         JOIN pg_catalog.pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = k.attnum),
                                      '<toate coloanele>')
      || E'\nargumente: ' || t.tgnargs::text || ' ' || encode(t.tgargs, 'hex')
      || E'\ntabele de tranzitie: ' || coalesce(t.tgoldtable::text, '<NULL>') || ' / ' || coalesce(t.tgnewtable::text, '<NULL>')
      || E'\n--- functia triggerului ---\n' || coalesce(m.material, '<LIPSA>')
    FROM trg t LEFT JOIN fn_mat m ON m.oid = t.tgfoid
  UNION ALL
  SELECT 'pol:' || pol.polname,
         'comanda: ' || pol.polcmd::text || ', permisiva: ' || pol.polpermissive::text
      || E'\nroluri: ' || coalesce((SELECT string_agg(r.nume, ',' ORDER BY r.nume COLLATE "C")
                                      FROM (SELECT CASE WHEN x.rol = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.rol)::text END AS nume
                                              FROM unnest(pol.polroles) AS x(rol)) AS r), '<NULL>')
      || E'\nUSING: ' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '<NULL = true>')
      || E'\nWITH CHECK: ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '<NULL>')
    FROM pg_catalog.pg_policy pol JOIN tabel ON pol.polrelid = tabel.oid
  UNION ALL
  SELECT 'tabel:public.ofertare_licitatii',
         coalesce((SELECT 'proprietar: ' || pg_get_userbyid(tb.relowner)
                       || E'\nrls: ' || tb.relrowsecurity::text
                       || E'\nforce_rls: ' || tb.relforcerowsecurity::text
                       || E'\nacl: ' || coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text COLLATE "C") FROM unnest(tb.relacl) AS a),
                                                 '<NULL = drepturile implicite ale proprietarului>')
                       || E'\nacl pe coloane: ' || coalesce((SELECT string_agg(at.attname::text || '=' || (SELECT string_agg(a::text, ',' ORDER BY a::text COLLATE "C")
                                                                                                          FROM unnest(at.attacl) AS a),
                                                                               '; ' ORDER BY at.attname::text COLLATE "C")
                                                            FROM pg_catalog.pg_attribute at
                                                           WHERE at.attrelid = tb.oid AND at.attacl IS NOT NULL AND NOT at.attisdropped),
                                                          '<niciunul>')
                    FROM tabel tb), '<LIPSA: public.ofertare_licitatii>')
  UNION ALL
  SELECT 'coloane:' || c.tabel,
         string_agg(c.col || ': ' || coalesce((SELECT format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
                                                 FROM pg_catalog.pg_attribute a
                                                WHERE a.attrelid = to_regclass(c.tabel) AND a.attname = c.col AND NOT a.attisdropped),
                                              '<LIPSA>'),
                    E'\n' ORDER BY c.col COLLATE "C")
    FROM (VALUES ('public.ofertare_licitatii', 'id'), ('public.ofertare_licitatii', 'status'),
                 ('public.ofertare_licitatii', 'termen_depunere'), ('public.ofertare_licitatii', 'responsabil_id'),
                 ('public.ofertare_licitatii', 'responsabil2_id'), ('public.ofertare_licitatii', 'responsabil_setat_de'),
                 ('public.ofertare_licitatii', 'responsabil2_setat_de'), ('public.ofertare_licitatii', 'responsabil_numitor_autorizat'),
                 ('public.ofertare_licitatii', 'responsabil2_numitor_autorizat'),
                 ('public.profiles', 'id'), ('public.profiles', 'is_owner')) AS c(tabel, col)
   GROUP BY c.tabel
)
SELECT eticheta, md5(material) AS amprenta, material FROM amprente ORDER BY eticheta COLLATE "C"
-- <<< AMPRENTE: interogarea
)
SELECT r.text FROM (
  SELECT 1 AS ord, q.eticheta AS cheie,
         E'\n==================== ' || q.eticheta || E' ====================\namprenta: ' || q.amprenta || E'\n' || q.material AS text
    FROM q
  UNION ALL
  SELECT 2, NULL,
         E'\n==================== BLOC DE LIPIT (între marcajele AMPRENTE BASELINE din migrare) ====================\n'
      || E'  -- >>> AMPRENTE BASELINE (singurul loc de completat: îl înlocuiește INTEGRAL blocul tipărit de scripts/ofertare_inchidere_garda_amprente.sql)\n'
      || E'  SELECT ''{\n'
      || string_agg('    ' || to_jsonb(q.eticheta)::text || ': ' || to_jsonb(q.amprenta)::text, E',\n' ORDER BY q.eticheta COLLATE "C")
      || E'\n  }''::jsonb\n'
      || E'  -- <<< AMPRENTE BASELINE\n'
      || '-- etichete: ' || count(*)::text
    FROM q
) AS r
ORDER BY r.ord, r.cheie COLLATE "C";
ROLLBACK;
