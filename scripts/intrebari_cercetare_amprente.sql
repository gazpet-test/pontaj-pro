-- Amprentele baseline pentru migrarea 20261131e_intrebari_cercetare_surse (PR #1012 r4, review Jakarinos r3 P2 / L15). DOAR CITIRE.
-- Același tipar ca scripts/ofertare_inchidere_garda_amprente.sql (PR #1029 r2).
-- Rulat de COORDONATOR (sesiunea de cod nu are acces la BD), din rădăcina repo-ului, pe producție și apoi pe clonă:
--   psql -X -v ON_ERROR_STOP=1 -f scripts/intrebari_cercetare_amprente.sql -o <ieșire.txt>
-- Tranzacție READ ONLY (deschisă și închisă aici, cu ROLLBACK): scriptul nu scrie nimic, nu ia lock-uri explicite și nu creează obiecte.
-- Tipărește:
--   1. pentru FIECARE etichetă: amprenta (md5) și MATERIALUL din care s-a calculat (definiția funcției, a triggerului, a politicii,
--      ACL-urile, RLS / FORCE, constrângerile, tipurile coloanelor; runda 5: valorile implicite ale coloanelor și secvențele, cu ACL)
--      — se revizuiește față de migrările din repo, nu se copiază orbește. Runda 5: cele 21 de etichete de pe 12.11.2026 au aceeași
--      interogare (valorile lor trebuie să iasă identice); se adaugă 4 etichete noi (implicite:… și secvente:… pe cele două tabele);
--   2. blocul gata de lipit: înlocuiește INTEGRAL conținutul dintre marcajele „>>> AMPRENTE BASELINE” și „<<< AMPRENTE BASELINE” din
--      supabase/migrations/20261131e_intrebari_cercetare_surse.sql (apoi sha256 pe fișier, review, dry-run — pașii din antetul migrării).
-- Valorile pentru REVENIRE nu vin de aici: revenirea verifică obiectele create de migrare (md5 pe corpurile funcțiilor, fără CR,
-- calculate din migrarea din repo și verificate de scripts/intrebari_cercetare_amprente.test.js) — dry-run-ul le probează (T4–T5).
-- Interogarea dintre marcajele „AMPRENTE: interogarea” e IDENTICĂ cu cea din migrare (pg_temp.fn_20261131e_amprente); testul vitest
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
-- >>> AMPRENTE: interogarea (text IDENTIC în migrarea 20261131e și în scripts/intrebari_cercetare_amprente.sql; testul vitest compară)
WITH tabele(rel) AS (VALUES ('public.intrebari_tehnice'), ('public.notifications')
), tab AS (
  SELECT c.oid, t.rel, c.relowner, c.relrowsecurity, c.relforcerowsecurity, c.relacl
    FROM tabele t JOIN pg_catalog.pg_class c ON c.oid = to_regclass(t.rel)
), fn_lista(eticheta, sig) AS (VALUES
  ('fn:auth.uid()', 'auth.uid()'),
  ('fn:public.fn_are_acces_intrebari()', 'public.fn_are_acces_intrebari()'),
  ('fn:public.fn_intrebari_amana(bigint,uuid)', 'public.fn_intrebari_amana(bigint,uuid)'),
  ('fn:public.fn_intrebari_inainte_insert()', 'public.fn_intrebari_inainte_insert()'),
  ('fn:public.fn_intrebari_preia()', 'public.fn_intrebari_preia()'),
  ('fn:public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)', 'public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)')
), trg AS (
  SELECT t.*, tb.rel FROM pg_catalog.pg_trigger t JOIN tab tb ON t.tgrelid = tb.oid WHERE NOT t.tgisinternal
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
  SELECT 'trg:' || t.rel || '.' || t.tgname,
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
  SELECT 'pol:' || tb.rel || '.' || pol.polname,
         'comanda: ' || pol.polcmd::text || ', permisiva: ' || pol.polpermissive::text
      || E'\nroluri: ' || coalesce((SELECT string_agg(r.nume, ',' ORDER BY r.nume COLLATE "C")
                                      FROM (SELECT CASE WHEN x.rol = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.rol)::text END AS nume
                                              FROM unnest(pol.polroles) AS x(rol)) AS r), '<NULL>')
      || E'\nUSING: ' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '<NULL = true>')
      || E'\nWITH CHECK: ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '<NULL>')
    FROM pg_catalog.pg_policy pol JOIN tab tb ON pol.polrelid = tb.oid
  UNION ALL
  SELECT 'tabel:' || t.rel,
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
                    FROM tab tb WHERE tb.rel = t.rel), '<LIPSA: ' || t.rel || '>')
    FROM tabele t
  UNION ALL
  SELECT 'constrangeri:public.intrebari_tehnice',
         coalesce((SELECT string_agg(co.conname::text || ' [' || co.contype::text || ', validata: ' || co.convalidated::text || ']: '
                                     || pg_get_constraintdef(co.oid), E'\n' ORDER BY co.conname::text COLLATE "C")
                     FROM pg_catalog.pg_constraint co WHERE co.conrelid = to_regclass('public.intrebari_tehnice')), '<niciuna>')
  UNION ALL
  SELECT 'implicite:' || t.rel,
         CASE WHEN NOT EXISTS (SELECT 1 FROM tab tb WHERE tb.rel = t.rel) THEN '<LIPSA: ' || t.rel || '>'
              ELSE coalesce((SELECT string_agg(a.attname::text || ': ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '<fara valoare implicita>')
                                               || CASE a.attidentity WHEN 'a' THEN ' [identity ALWAYS]' WHEN 'd' THEN ' [identity BY DEFAULT]' ELSE '' END
                                               || CASE WHEN a.attgenerated IN ('s', 'v') THEN ' [generata ' || a.attgenerated::text || ']' ELSE '' END,
                                               E'\n' ORDER BY a.attname::text COLLATE "C")
                               FROM tab tb
                               JOIN pg_catalog.pg_attribute a ON a.attrelid = tb.oid AND a.attnum > 0 AND NOT a.attisdropped
                               LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                              WHERE tb.rel = t.rel
                                AND NOT (t.rel = 'public.intrebari_tehnice' AND a.attname IN ('surse', 'de_verificat_la', 'interogari_web'))),
                            '<nicio coloana>') END
    FROM tabele t
  UNION ALL
  SELECT 'secvente:' || t.rel,
         CASE WHEN NOT EXISTS (SELECT 1 FROM tab tb WHERE tb.rel = t.rel) THEN '<LIPSA: ' || t.rel || '>'
              ELSE coalesce((SELECT string_agg('secventa: ' || s.oid::regclass::text
                                               || E'\n  atasata de: ' || coalesce((SELECT string_agg(ac.attname::text || ' (' || dp.deptype::text || ')', ','
                                                                                                     ORDER BY ac.attname::text COLLATE "C")
                                                                                     FROM pg_catalog.pg_depend dp
                                                                                     JOIN pg_catalog.pg_attribute ac ON ac.attrelid = dp.refobjid AND ac.attnum = dp.refobjsubid
                                                                                    WHERE dp.classid = 'pg_catalog.pg_class'::regclass AND dp.objid = s.oid
                                                                                      AND dp.refclassid = 'pg_catalog.pg_class'::regclass
                                                                                      AND dp.deptype IN ('a', 'i')), '<neatasata>')
                                               || E'\n  proprietar: ' || pg_get_userbyid(s.relowner)
                                               || E'\n  acl: ' || coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text COLLATE "C") FROM unnest(s.relacl) AS x),
                                                                           '<NULL = drepturile implicite ale proprietarului>')
                                               || E'\n  tip: ' || format_type(sq.seqtypid, NULL) || ', start: ' || sq.seqstart::text
                                               || ', pas: ' || sq.seqincrement::text || ', min: ' || sq.seqmin::text || ', max: ' || sq.seqmax::text
                                               || ', cache: ' || sq.seqcache::text || ', ciclic: ' || sq.seqcycle::text
                                               || ', persistenta: ' || s.relpersistence::text,
                                               E'\n' ORDER BY s.oid::regclass::text COLLATE "C")
                               FROM tab tb
                               JOIN pg_catalog.pg_class s ON s.relkind = 'S' AND s.oid IN (
                                      SELECT dp.objid FROM pg_catalog.pg_depend dp
                                       WHERE dp.classid = 'pg_catalog.pg_class'::regclass AND dp.refclassid = 'pg_catalog.pg_class'::regclass
                                         AND dp.refobjid = tb.oid AND dp.deptype IN ('a', 'i')
                                      UNION
                                      SELECT dp.refobjid FROM pg_catalog.pg_attrdef ad
                                        JOIN pg_catalog.pg_depend dp ON dp.classid = 'pg_catalog.pg_attrdef'::regclass AND dp.objid = ad.oid
                                                                    AND dp.refclassid = 'pg_catalog.pg_class'::regclass
                                       WHERE ad.adrelid = tb.oid)
                               JOIN pg_catalog.pg_sequence sq ON sq.seqrelid = s.oid
                              WHERE tb.rel = t.rel), '<niciuna>') END
    FROM tabele t
  UNION ALL
  SELECT 'coloane:' || c.tabel,
         string_agg(c.col || ': ' || coalesce((SELECT format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
                                                 FROM pg_catalog.pg_attribute a
                                                WHERE a.attrelid = to_regclass(c.tabel) AND a.attname = c.col AND NOT a.attisdropped),
                                              '<LIPSA>'),
                    E'\n' ORDER BY c.col COLLATE "C")
    FROM (VALUES ('public.intrebari_tehnice', 'id'), ('public.intrebari_tehnice', 'autor'), ('public.intrebari_tehnice', 'titlu'),
                 ('public.intrebari_tehnice', 'intrebare'), ('public.intrebari_tehnice', 'context'), ('public.intrebari_tehnice', 'atasamente'),
                 ('public.intrebari_tehnice', 'stare'), ('public.intrebari_tehnice', 'raspuns_md'), ('public.intrebari_tehnice', 'model'),
                 ('public.intrebari_tehnice', 'tokeni'), ('public.intrebari_tehnice', 'eroare'), ('public.intrebari_tehnice', 'incercari'),
                 ('public.intrebari_tehnice', 'incercare_id'), ('public.intrebari_tehnice', 'creat_la'), ('public.intrebari_tehnice', 'preluat_la'),
                 ('public.intrebari_tehnice', 'raspuns_la'),
                 ('public.profiles', 'id'), ('public.profiles', 'is_owner'),
                 ('public.notifications', 'profile_id'), ('public.notifications', 'type'), ('public.notifications', 'modul'),
                 ('public.notifications', 'title'), ('public.notifications', 'message'), ('public.notifications', 'link_to'),
                 ('storage.objects', 'bucket_id'), ('storage.objects', 'name')) AS c(tabel, col)
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
      || E'  -- >>> AMPRENTE BASELINE (singurul loc de completat: îl înlocuiește INTEGRAL blocul tipărit de scripts/intrebari_cercetare_amprente.sql)\n'
      || E'  SELECT ''{\n'
      || string_agg('    ' || to_jsonb(q.eticheta)::text || ': ' || to_jsonb(q.amprenta)::text, E',\n' ORDER BY q.eticheta COLLATE "C")
      || E'\n  }''::jsonb\n'
      || E'  -- <<< AMPRENTE BASELINE\n'
      || '-- etichete: ' || count(*)::text
    FROM q
) AS r
ORDER BY r.ord, r.cheie COLLATE "C";
ROLLBACK;
