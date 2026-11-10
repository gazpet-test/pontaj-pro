-- Dialog TGZ (c): context AGREGAT pentru verificare. Interogare FIXA, doar SELECT, tranzactie READ ONLY.
-- FARA date personale: nu se selecteaza nume / nume_normalizat / cota (red_detinatori), nicio coloana de adresa,
-- telefon sau email ca valoare (red_detinatori_contact - doar numaratori), nici destinatar / subiect / expeditor /
-- documente / observatii (red_corespondenta), nici valoare_lei (doar admin), nici fisier_nume / eroare / diferente.
-- Identificatori pastrati: codul proiectului, codul UAT (uat3) si numele UAT-ului (localitate publica), codul
-- corespondentei (ex. A1), starile si datele.
-- Coloane verificate in supabase/migrations: 20261126a_redari_teren.sql, 20261129a_redari_pv_schema.sql,
-- 20261129g_redari_tronson_optional.sql, 20261129h_redari_corespondenta.sql.
-- r2: singurul SQL al sarcinii (nicio scriere in BD; cursorul e un fisier local). Garda de mai jos opreste exportul
-- (ON_ERROR_STOP) inainte de orice citire din red_* daca rolul conectat POATE scrie ceva.
\pset footer off
\pset null '-'
BEGIN READ ONLY;

-- Garda doar-citire: rolul conectat nu are voie sa poata scrie NIMIC (atribute, apartenente, drepturi de scriere pe
-- orice relatie / secventa / schema / baza). Fiecare drept se verifica separat, ca mesajul sa spuna exact ce e in plus.
-- Ce nu acopera (de ce e acceptabil): EXECUTE pe functii - tranzactia e READ ONLY si SQL-ul de mai jos e fix, nu
-- apeleaza functii scrise de altii; obiectele temporare ale propriei sesiuni - dispar la deconectare.
DO $garda$
DECLARE
  v_probleme text[] := ARRAY[]::text[];
  v_rol record;
BEGIN
  IF current_setting('transaction_read_only') IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'dialog_tgz: tranzactia nu este READ ONLY';
  END IF;
  SELECT r.oid, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication
    INTO v_rol FROM pg_catalog.pg_roles r WHERE r.rolname = current_user;
  IF v_rol.rolsuper IS NOT FALSE THEN v_probleme := v_probleme || 'atribut SUPERUSER'::text; END IF;
  IF v_rol.rolbypassrls IS NOT FALSE THEN v_probleme := v_probleme || 'atribut BYPASSRLS'::text; END IF;
  IF v_rol.rolcreaterole IS NOT FALSE THEN v_probleme := v_probleme || 'atribut CREATEROLE'::text; END IF;
  IF v_rol.rolcreatedb IS NOT FALSE THEN v_probleme := v_probleme || 'atribut CREATEDB'::text; END IF;
  IF v_rol.rolreplication IS NOT FALSE THEN v_probleme := v_probleme || 'atribut REPLICATION'::text; END IF;
  IF current_setting('default_transaction_read_only') IS DISTINCT FROM 'on' THEN
    v_probleme := v_probleme || 'rolul nu are default_transaction_read_only = on'::text;
  END IF;
  -- apartenenta la alt rol (mostenire de drepturi sau SET ROLE)
  v_probleme := v_probleme || ARRAY(
    SELECT 'membru in rolul ' || g.rolname
    FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles g ON g.oid = m.roleid
    WHERE m.member = v_rol.oid ORDER BY 1);
  -- tabele, vederi, vederi materializate, tabele externe, partitii (INSERT / UPDATE si pe coloane)
  v_probleme := v_probleme || ARRAY(
    SELECT DISTINCT format('%s pe %I.%I', p.drept, n.nspname, c.relname)
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('TRIGGER')) AS p(drept)
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_(toast|temp_)'
      AND CASE p.drept
            WHEN 'INSERT' THEN has_any_column_privilege(c.oid, 'INSERT')
            WHEN 'UPDATE' THEN has_any_column_privilege(c.oid, 'UPDATE')
            WHEN 'DELETE' THEN has_table_privilege(c.oid, 'DELETE')
            WHEN 'TRUNCATE' THEN has_table_privilege(c.oid, 'TRUNCATE')
            WHEN 'TRIGGER' THEN has_table_privilege(c.oid, 'TRIGGER')
          END
    ORDER BY 1);
  -- secvente (nextval / setval)
  v_probleme := v_probleme || ARRAY(
    SELECT DISTINCT format('%s pe secventa %I.%I', p.drept, n.nspname, c.relname)
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('USAGE'), ('UPDATE')) AS p(drept)
    WHERE c.relkind = 'S'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_(toast|temp_)'
      AND has_sequence_privilege(c.oid, p.drept)
    ORDER BY 1);
  -- crearea de obiecte
  v_probleme := v_probleme || ARRAY(
    SELECT format('CREATE pe schema %I', n.nspname)
    FROM pg_catalog.pg_namespace n
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_(toast|temp_)'
      AND has_schema_privilege(n.oid, 'CREATE')
    ORDER BY 1);
  IF has_database_privilege(current_database(), 'CREATE') THEN
    v_probleme := v_probleme || 'CREATE pe baza de date'::text;
  END IF;
  IF cardinality(v_probleme) > 0 THEN
    RAISE EXCEPTION 'dialog_tgz: rolul % poate scrie (% drepturi in plus): %', current_user, cardinality(v_probleme),
      array_to_string(v_probleme[1:20], '; ');
  END IF;
END
$garda$;

-- Gol != zero: un rol fara politica RLS de citire vede 0 randuri peste tot, iar cifrele "0" ar parea reale.
-- Daca nu vede niciun proiect (exista mereu cel putin TEST-RAZVAN), exportul se opreste.
DO $vizibil$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.red_proiecte) THEN
    RAISE EXCEPTION 'dialog_tgz: rolul % nu vede niciun rand in red_proiecte (lipseste politica RLS de citire?)', current_user;
  END IF;
END
$vizibil$;

\echo '## 1. Loturi de import (red_import_loturi)'
\echo '```'
SELECT p.cod AS proiect, l.versiune_lista_tgz, l.stare, to_char(l.created_at AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI') AS creat,
       l.randuri_total, l.parcele_noi, l.detinatori_noi, l.dubluri, l.neidentificati
FROM public.red_import_loturi l JOIN public.red_proiecte p ON p.id = l.proiect_id
ORDER BY p.cod, l.created_at DESC;
\echo '```'

\echo '## 2. Parcele active pe UAT (red_parcele, sters_la IS NULL)'
\echo '```'
SELECT p.cod AS proiect, u.uat3, u.nume AS uat,
       count(*) AS parcele,
       count(*) FILTER (WHERE x.nr_cadastral IS NULL OR btrim(x.nr_cadastral) = '') AS fara_nr_cadastral,
       count(*) FILTER (WHERE x.tarla IS NULL OR btrim(x.tarla) = '') AS fara_tarla,
       count(*) FILTER (WHERE x.tronson IS NULL) AS fara_tronson,
       count(*) FILTER (WHERE x.verificare_data IS NOT NULL) AS verificate,
       round(coalesce(sum(x.suprafata_temporara_mp), 0)::numeric, 2) AS suprafata_temporara_mp,
       (SELECT count(*) FROM public.red_parcele s WHERE s.uat_id = u.id AND s.sters_la IS NOT NULL) AS parcele_sterse
FROM public.red_parcele x
JOIN public.red_uat u ON u.id = x.uat_id
JOIN public.red_proiecte p ON p.id = x.proiect_id
WHERE x.sters_la IS NULL
GROUP BY p.cod, u.id, u.uat3, u.nume
ORDER BY p.cod, u.uat3;
\echo '```'

\echo '## 3. Detinatori activi pe UAT si calitate (red_detinatori, sters_la IS NULL; parcela activa)'
\echo '```'
SELECT p.cod AS proiect, u.uat3, d.calitate,
       count(*) AS detinatori,
       count(*) FILTER (WHERE d.decedat) AS decedati,
       count(*) FILTER (WHERE d.act_doveditor_cunoscut IS TRUE) AS act_doveditor_da,
       count(*) FILTER (WHERE d.act_doveditor_cunoscut IS FALSE) AS act_doveditor_nu,
       count(DISTINCT d.parcela_id) AS parcele_acoperite
FROM public.red_detinatori d
JOIN public.red_parcele x ON x.id = d.parcela_id AND x.sters_la IS NULL
JOIN public.red_uat u ON u.id = x.uat_id
JOIN public.red_proiecte p ON p.id = x.proiect_id
WHERE d.sters_la IS NULL
GROUP BY p.cod, u.uat3, d.calitate
ORDER BY p.cod, u.uat3, d.calitate;
\echo '```'

\echo '## 4. Parcele active fara niciun detinator activ, pe UAT'
\echo '```'
SELECT p.cod AS proiect, u.uat3, count(*) AS parcele_fara_detinator
FROM public.red_parcele x
JOIN public.red_uat u ON u.id = x.uat_id
JOIN public.red_proiecte p ON p.id = x.proiect_id
WHERE x.sters_la IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.red_detinatori d WHERE d.parcela_id = x.id AND d.sters_la IS NULL)
GROUP BY p.cod, u.uat3
ORDER BY p.cod, u.uat3;
\echo '```'

\echo '## 5. Completitudinea contactelor (red_detinatori_contact) - DOAR numaratori, fara valori'
\echo '```'
SELECT p.cod AS proiect, u.uat3,
       count(DISTINCT d.id) AS detinatori_activi,
       count(c.detinator_id) AS cu_fisa_contact,
       count(*) FILTER (WHERE c.detinator_id IS NOT NULL AND c.adresa_cunoscuta IS FALSE) AS adresa_necunoscuta,
       count(*) FILTER (WHERE c.adresa_strada IS NOT NULL AND btrim(c.adresa_strada) <> '') AS cu_strada,
       count(*) FILTER (WHERE c.adresa_comuna IS NOT NULL AND btrim(c.adresa_comuna) <> '') AS cu_comuna,
       count(*) FILTER (WHERE c.cod_postal IS NOT NULL AND btrim(c.cod_postal) <> '') AS cu_cod_postal,
       count(*) FILTER (WHERE c.telefon IS NOT NULL AND btrim(c.telefon) <> '') AS cu_telefon,
       count(*) FILTER (WHERE c.email IS NOT NULL AND btrim(c.email) <> '') AS cu_email
FROM public.red_detinatori d
JOIN public.red_parcele x ON x.id = d.parcela_id AND x.sters_la IS NULL
JOIN public.red_uat u ON u.id = x.uat_id
JOIN public.red_proiecte p ON p.id = x.proiect_id
LEFT JOIN public.red_detinatori_contact c ON c.detinator_id = d.id
WHERE d.sters_la IS NULL
GROUP BY p.cod, u.uat3
ORDER BY p.cod, u.uat3;
\echo '```'

\echo '## 6. Corespondenta (red_corespondenta) - pe stare'
\echo '```'
SELECT p.cod AS proiect, c.stare, count(*) AS bucati
FROM public.red_corespondenta c JOIN public.red_proiecte p ON p.id = c.proiect_id
GROUP BY p.cod, c.stare
ORDER BY p.cod, c.stare;
\echo '```'

\echo '## 7. Corespondenta - lista fara text (cod, ordine, stare, date)'
\echo '```'
SELECT p.cod AS proiect, c.cod, c.ordine, c.stare, c.versiune,
       to_char(c.aprobat_la AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD') AS aprobat_la,
       c.trimis_la,
       (c.nr_inregistrare IS NOT NULL AND btrim(c.nr_inregistrare) <> '') AS are_nr_inregistrare,
       to_char(c.updated_at AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI') AS modificat
FROM public.red_corespondenta c JOIN public.red_proiecte p ON p.id = c.proiect_id
ORDER BY p.cod, c.ordine, c.cod;
\echo '```'

COMMIT;
