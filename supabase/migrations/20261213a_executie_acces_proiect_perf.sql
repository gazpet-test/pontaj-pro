-- Version 20261213120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261213a_executie_acces_proiect_perf — Execuție / acces pe proiect: PERFORMANȚA politicilor pentru contul RESTRÂNS, fără nicio schimbare
-- de drepturi. Depinde de 20261209a (aplicată pe producție 11.11.2026; amprentele ei sunt verificate mai jos).
--
-- Problema (DRY pe producție, chat, 11.11.2026; cont restrâns de probă pe 2 proiecte): pentru un cont restrâns, politicile RESTRICTIVE din
-- 20261209a cheamă un predicat PE FIECARE RÂND (fn_executie_proiect_permis / fn_executie_acces_parinte_permis /
-- fn_executie_acces_obiect_permis; funcții SQL ne-inline-abile, care cheamă alte funcții, iar la copii și la Storage caută rândul părinte /
-- documentul sub RLS pentru fiecare rând): 0,3–1,5 ms pe rând (documente_proiect 586 ms, executie_tevi ~1 s, storage.objects pe
-- documente-proiect 2,3 s). Contul nerestrâns nu e afectat (iese din prima condiție, o singură evaluare pe interogare).
--
-- Ce face: ALTER POLICY pe aceleași politici (nume, comandă, RESTRICTIVE, rolul authenticated: neschimbate), cu o expresie ECHIVALENTĂ în
-- care tot ce ține de cont se evaluează O DATĂ pe interogare:
--   * lista proiectelor apelantului = (SELECT fn_executie_acces_proprii_citire()) / (SELECT fn_executie_acces_proprii_scriere()) — InitPlan;
--     funcții NOI fără argumente, SECURITY DEFINER, care întorc exact fn_executie_acces_lista_cont(auth.uid(), …) (aceeași regulă, L19), adică
--     rândurile PROPRII din executie_acces_proiect pe care apelantul le poate citi oricum (politica executie_acces_proiect_citire). Fără
--     argument, nu pot deosebi „inexistent” de „invizibil”: nu primesc nimic despre altă entitate (T9d în harness: = SELECT-ul propriu,
--     pentru fiecare cont; anon = 42501);
--   * 'proiect' / 'proiect_optional': coloana de proiect = ANY (lista) — fără nicio funcție pe rând;
--   * 'copil': cheia spre părinte IN (SELECT id FROM <părinte> WHERE proiect = ANY (lista)) — subinterogare NECORELATĂ (hash pe setul
--     părinților, o singură execuție), sub RLS-ul APELANTULUI pe părinte, exact ca predicatul INVOKER din r9: un părinte invizibil și unul
--     inexistent nu intră în set (același caz). 'site': șantierul fără proiect intră în set (ca azi); 'raport': raportul al cărui șantier e
--     în setul de mai sus (lanțul de două niveluri din r9);
--   * Storage: aceleași ramuri ca fn_executie_acces_obiect_permis (cale cu `..` = fals; executie-contracte / executie-borderouri: proiectul
--     din cale ∈ lista; executie-pachete-pdf: pachetul din cale ∈ setul pachetelor VIZIBILE ale proiectelor din listă — forma `<proiect>/
--     <pachet>/aprobare/…` cere perechea exactă; documente-proiect: citire = calea ∈ setul căilor VIZIBILE din documente_proiect pe proiectele
--     din listă, scriere = fals; ai-documente-inbox: fals; alt bucket: neatins).
--   Inboxul AI (clasa 'inbox', politicile cozii) are deja forma „o evaluare pe interogare” (r13): NEATINS.
-- Ce NU face: nicio funcție existentă nu se schimbă (corpuri, drepturi, owner — verificate înainte și după): predicatele publice rămân
--   pentru RPC-uri, trigger-ele de gardă, funcțiile de drept și UI; nicio dată, niciun drept pe modul; nicio altă politică.
--   Tabelele 'drept' (sudurile pe nod, probele, graficul, țintele, fibra) au politicile migrărilor lor (funcția de drept pe rând): în afara
--   acestei migrări (raport: propunere separată).
-- Echivalența (L25): harness-ul (scripts/test_executie_acces_perf.sql, inclus în scripts/test_executie_acces_proiect.sql) compară, rând cu
--   rând (ctid-urile vizibile pe fiecare tabel acoperit și obiectele Storage), plus amprenta completă r13 (citire, scriere REST / DEFINER,
--   INSERT-uri, încărcări, Inbox), pentru A0 / A / B / B0 / C / owner, ÎNAINTE și DUPĂ: identic. Apoi toate testele r13 (T3–T6, inclusiv
--   anti-oracolul T3e) rulează peste politicile noi. Proba de PLAN (prag care pică testul): pentru contul restrâns, niciun predicat de acces
--   în filtrele planului, fiecare InitPlan cu funcția de acces executat cel mult o dată, nicio subinterogare corelată în plus față de înainte.
-- Preflight (L15): amprentele (corp, SECURITY DEFINER / INVOKER, proconfig, owner, drepturi) funcțiilor 20261209a a căror semantică o
--   reproduc politicile noi + inventarul; clasele / părinții din inventar; bucket-urile acoperite = exact cele 5 din predicatul Storage;
--   tabelele cu RLS; dreptul de citire al lui authenticated pe FIECARE coloană căutată (pe rând, nu cu o listă de drepturi); SUB LOCK-URI,
--   fiecare politică = EXACT expresia generată de 20261209a (deparsată de același server: o politică de probă construită din textul vechi,
--   comparată cu pg_get_expr, apoi ștearsă).
-- Ordinea lock-urilor (L06): tabelele acoperite în ordinea numelui (o singură instrucțiune LOCK), apoi storage.objects; ACCESS EXCLUSIVE (îl
--   cere oricum ALTER POLICY), lock_timeout 5 s. Doar catalog după lock-uri: fereastra e scurtă (fără scanări de date).
-- DEPENDENȚĂ / ORDINE: după 20261209a. Revenirea 20261209a REFUZĂ cât timp aceasta e aplicată (numără exact 16 funcții fn_executie_acces_*;
--   aici se adaugă 4) → întâi revenirea ACESTEIA (supabase/revenire/20261213a_executie_acces_proiect_perf_ROLLBACK.sql), care redă exact
--   politicile 20261209a (contul restrâns rămâne restrâns, doar mai lent).
-- Un SINGUR bloc DO (ca revenirea): un refuz e singura instrucțiune care eșuează, nimic nu rulează după el (și harness-ul îi verifică mesajul).
DO $m$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261213a_executie_acces_proiect_perf:' || txid_current() THEN
    RAISE EXCEPTION '20261213a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261213a: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF to_regprocedure('public.fn_executie_acces_proprii_citire()') IS NOT NULL OR to_regprocedure('public.fn_executie_acces_proprii_scriere()') IS NOT NULL
     OR to_regprocedure('public.fn_executie_acces_politici()') IS NOT NULL OR to_regprocedure('public.fn_executie_acces_politici_verifica(text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'zz_executie_acces_proba_forma') THEN
    RAISE EXCEPTION '20261213a: obiectele exista deja (reaplicare)';
  END IF;
  -- 20261209a: exact cele 16 funcții, iar cele a căror semantică o reproduc politicile noi au corpul / securitatea / setările / drepturile
  -- revizuite (amprenta = md5(corp fără CR), ca în 20261209a)
  IF to_regclass('public.executie_acces_proiect') IS NULL
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND (p.proname LIKE 'fn\_executie\_acces\_%' OR p.proname = 'fn_executie_proiect_permis')) <> 16
     OR EXISTS (SELECT 1 FROM (VALUES
          ('public.fn_executie_acces_inventar()', 'f778d649059b169235d262ae3121de9f', false, false),
          ('public.fn_executie_acces_nerestrans()', 'b863c5324684dbf4eb9af81474fbc4e1', true, true),
          ('public.fn_executie_acces_nerestrans_cont(uuid)', '9a07e0089139e54ba5c6a0cfaaf093cc', false, false),
          ('public.fn_executie_acces_lista(boolean)', 'd9e123a46b83530a7203d4a24da5cf9b', true, false),
          ('public.fn_executie_acces_lista_cont(uuid, boolean)', 'e7cf9b852002a1c1cbe781772c33bf0c', false, false),
          ('public.fn_executie_proiect_permis(bigint, boolean)', 'bd4320f76e9f36f492c7186c0a982155', true, true),
          ('public.fn_executie_acces_parinte_permis(text, bigint, boolean)', '112454c743c8116ef76003b2f92e7e00', false, true),
          ('public.fn_executie_acces_obiect_permis(text, text, boolean)', 'c16a677f24f5b583627eb868e0aa8202', false, true)) a(semnatura, amprenta, definer, cu_auth)
        LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
        WHERE p.oid IS NULL OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
           OR p.prosecdef IS DISTINCT FROM a.definer OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
           OR p.proowner IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname = current_user)
           OR has_function_privilege('anon', p.oid, 'EXECUTE')
           OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.cu_auth) THEN
    RAISE EXCEPTION '20261213a: functiile 20261209a difera de cele revizuite (amprenta / securitate / drepturi)';
  END IF;

-- ── 1. lista PROPRIE a apelantului, o evaluare pe interogare (InitPlan) ──────────────────────────────────────────────────────────────────
-- Aceeași regulă ca fn_executie_acces_lista (L19: fn_executie_acces_lista_cont pe auth.uid()), fără argument: citire = proiectele listate,
-- scriere = doar cele 'editor'; fără auth.uid() / cont fără rânduri / owner = '{}' (NU „toate”: „toate” e doar fn_executie_acces_nerestrans(),
-- care stă ÎNAINTEA listei în fiecare politică). Răspunsul = rândurile proprii din executie_acces_proiect, pe care apelantul le citește oricum.
CREATE FUNCTION public.fn_executie_acces_proprii_citire() RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT public.fn_executie_acces_lista_cont(auth.uid(), false)
$f$;
CREATE FUNCTION public.fn_executie_acces_proprii_scriere() RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT public.fn_executie_acces_lista_cont(auth.uid(), true)
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_acces_proprii_citire() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_acces_proprii_scriere() FROM PUBLIC, anon, authenticated, service_role;
-- politicile se evaluează în numele apelantului: authenticated are nevoie de EXECUTE (ca pe fn_executie_acces_nerestrans)
GRANT EXECUTE ON FUNCTION public.fn_executie_acces_proprii_citire() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_acces_proprii_scriere() TO authenticated;

-- ── 2. expresiile politicilor: O SINGURĂ sursă (L19) pentru migrare, revenire și harness ─────────────────────────────────────────────────
-- Pe fiecare tabel acoperit din inventar (proiect / proiect_optional / copil / inbox) și pe storage.objects: expresia VECHE (textul exact pe
-- care 20261209a îl dă lui format(), pasul 5 de acolo) și cea NOUĂ, pentru citire (USING al politicii de citire) și scriere (adaugă /
-- modifică / șterge). Internă: fără EXECUTE pentru clienți.
CREATE FUNCTION public.fn_executie_acces_politici()
RETURNS TABLE (tabel text, clasa text, vechi_cit text, vechi_scr text, nou_cit text, nou_scr text)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
DECLARE
  r record; v_set text; v_bk text; v_doc text;
  ner constant text := '(SELECT public.fn_executie_acces_nerestrans())';
  -- (cast-ul face din subinterogarea scalară un tablou pentru = ANY (…); fără el, „ANY ((SELECT …))” ar fi o subinterogare ANY pe rânduri)
  l_c constant text := '(SELECT public.fn_executie_acces_proprii_citire())::bigint[]';
  l_s constant text := '(SELECT public.fn_executie_acces_proprii_scriere())::bigint[]';
BEGIN
  FOR r IN SELECT i.* FROM public.fn_executie_acces_inventar() i
            WHERE i.tip = 'tabel' AND i.clasa IN ('proiect', 'proiect_optional', 'copil', 'inbox') ORDER BY i.obiect LOOP
    tabel := r.obiect; clasa := r.clasa;
    IF r.clasa = 'proiect' THEN
      vechi_cit := format('(SELECT public.fn_executie_acces_nerestrans()) OR public.fn_executie_proiect_permis(%I::bigint, false)', r.cheie);
      vechi_scr := format('(SELECT public.fn_executie_acces_nerestrans()) OR public.fn_executie_proiect_permis(%I::bigint, true)', r.cheie);
      nou_cit := format('%s OR %I::bigint = ANY (%s)', ner, r.cheie, l_c);
      nou_scr := format('%s OR %I::bigint = ANY (%s)', ner, r.cheie, l_s);
    ELSIF r.clasa = 'proiect_optional' THEN
      vechi_cit := format('(SELECT public.fn_executie_acces_nerestrans()) OR %I IS NULL OR public.fn_executie_proiect_permis(%I::bigint, false)', r.cheie, r.cheie);
      vechi_scr := format('(SELECT public.fn_executie_acces_nerestrans()) OR %I IS NULL OR public.fn_executie_proiect_permis(%I::bigint, true)', r.cheie, r.cheie);
      nou_cit := format('%s OR %I IS NULL OR %I::bigint = ANY (%s)', ner, r.cheie, r.cheie, l_c);
      nou_scr := format('%s OR %I IS NULL OR %I::bigint = ANY (%s)', ner, r.cheie, r.cheie, l_s);
    ELSIF r.clasa = 'inbox' THEN
      -- r13: deja o singură evaluare pe interogare, fără coloane ale rândului: neschimbată
      vechi_cit := '(SELECT public.fn_executie_acces_nerestrans())'; vechi_scr := vechi_cit; nou_cit := vechi_cit; nou_scr := vechi_cit;
    ELSE
      vechi_cit := format('(SELECT public.fn_executie_acces_nerestrans()) OR public.fn_executie_acces_parinte_permis(%L, %I::bigint, false)', r.parinte, r.cheie);
      vechi_scr := format('(SELECT public.fn_executie_acces_nerestrans()) OR public.fn_executie_acces_parinte_permis(%L, %I::bigint, true)', r.parinte, r.cheie);
      -- setul părinților permiși (= ramurile lui fn_executie_acces_parinte_permis), sub RLS-ul apelantului; %1$s = lista (InitPlan)
      v_set := CASE r.parinte
        WHEN 'sl' THEN 'SELECT x.id::bigint FROM public.executie_situatii_plata x WHERE x.proiect_id::bigint = ANY (%1$s)'
        WHEN 'bon' THEN 'SELECT x.id::bigint FROM public.executie_bonuri_consum x WHERE x.proiect_id::bigint = ANY (%1$s)'
        WHEN 'pachet' THEN 'SELECT x.id::bigint FROM public.executie_pachete_lansare x WHERE x.proiect_id::bigint = ANY (%1$s)'
        WHEN 'cumulat' THEN 'SELECT x.id::bigint FROM public.executie_pachete_cumulat_final x WHERE x.proiect_id::bigint = ANY (%1$s)'
        WHEN 'activitate' THEN 'SELECT x.id::bigint FROM public.proiect_activitati x WHERE x.proiect_id::bigint = ANY (%1$s)'
        WHEN 'site' THEN 'SELECT x.id::bigint FROM public.sites x WHERE x.proiect_id IS NULL OR x.proiect_id::bigint = ANY (%1$s)'
        WHEN 'raport' THEN 'SELECT z.id::bigint FROM public.rapoarte_zilnice z WHERE z.site_id::bigint IN '
                           '(SELECT x.id::bigint FROM public.sites x WHERE x.proiect_id IS NULL OR x.proiect_id::bigint = ANY (%1$s))'
      END;
      IF v_set IS NULL THEN RAISE EXCEPTION '20261213a: parinte necunoscut % pe %', r.parinte, r.obiect; END IF;
      nou_cit := format('%s OR %I::bigint IN (%s)', ner, r.cheie, format(v_set, l_c));
      nou_scr := format('%s OR %I::bigint IN (%s)', ner, r.cheie, format(v_set, l_s));
    END IF;
    RETURN NEXT;
  END LOOP;
  -- Storage: bucket-urile acoperite din inventar = EXACT cele 5 din fn_executie_acces_obiect_permis (altfel ramurile de mai jos ar minți)
  SELECT string_agg(quote_literal(i.obiect), ', ' ORDER BY i.obiect) INTO v_bk
    FROM public.fn_executie_acces_inventar() i WHERE i.tip = 'bucket' AND i.clasa IN ('cale', 'tabel', 'inbox');
  IF v_bk IS DISTINCT FROM '''ai-documente-inbox'', ''documente-proiect'', ''executie-borderouri'', ''executie-contracte'', ''executie-pachete-pdf''' THEN
    RAISE EXCEPTION '20261213a: bucket-urile acoperite din inventar difera de cele din predicatul Storage (%)', v_bk;
  END IF;
  tabel := 'storage.objects'; clasa := 'storage';
  vechi_cit := format('bucket_id <> ALL (ARRAY[%s]::text[]) OR (SELECT public.fn_executie_acces_nerestrans()) '
                      'OR public.fn_executie_acces_obiect_permis(bucket_id, name, false)', v_bk);
  vechi_scr := format('bucket_id <> ALL (ARRAY[%s]::text[]) OR (SELECT public.fn_executie_acces_nerestrans()) '
                      'OR public.fn_executie_acces_obiect_permis(bucket_id, name, true)', v_bk);
  -- ramurile lui fn_executie_acces_obiect_permis, pentru contul restrâns; %1$s = lista (InitPlan), %2$s = ramura documente-proiect
  v_set := 'bucket_id <> ALL (ARRAY[' || v_bk || ']::text[]) OR ' || ner || ' OR (name IS NOT NULL AND position(''..'' IN name) = 0 AND CASE bucket_id'
    || ' WHEN ''executie-contracte'' THEN coalesce(substring(name FROM ''^([1-9][0-9]{0,17})/''),'
    ||                                          ' substring(name FROM ''^(?:ordin-incepere|pccvi|probe-presiune)/([1-9][0-9]{0,17})/''))::bigint = ANY (%1$s)'
    || ' WHEN ''executie-borderouri'' THEN substring(name FROM ''^sl_([1-9][0-9]{0,17})/'')::bigint = ANY (%1$s)'
    || ' WHEN ''executie-pachete-pdf'' THEN CASE WHEN name ~ ''^[1-9][0-9]{0,17}/[1-9][0-9]{0,17}/aprobare/'''
    ||   ' THEN (split_part(name, ''/'', 1)::bigint, split_part(name, ''/'', 2)::bigint) IN'
    ||        ' (SELECT k.proiect_id::bigint, k.id::bigint FROM public.executie_pachete_lansare k WHERE k.proiect_id::bigint = ANY (%1$s))'
    ||   ' ELSE substring(name FROM ''^([1-9][0-9]{0,17})/'')::bigint IN'
    ||        ' (SELECT k.id::bigint FROM public.executie_pachete_lansare k WHERE k.proiect_id::bigint = ANY (%1$s)) END'
    || ' WHEN ''documente-proiect'' THEN %2$s'
    || ' ELSE false END)';
  -- documente-proiect: citire = calea ∈ căile vizibile pe proiectele din lista de CITIRE (ca predicatul, indiferent de nivel); scriere = fals.
  -- Comparația pe octeți (COLLATE "C" pe ambele părți; colațiile deterministe dau aceeași egalitate ca înainte)
  v_doc := '(name COLLATE "C") IN (SELECT d.storage_path COLLATE "C" FROM public.documente_proiect d WHERE d.proiect_id::bigint = ANY (' || l_c || '))';
  nou_cit := format(v_set, l_c, v_doc);
  nou_scr := format(v_set, l_s, 'false');
  RETURN NEXT;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_acces_politici() FROM PUBLIC, anon, authenticated, service_role;

-- Verificarea unei forme ('vechi' / 'nou') pe TOATE politicile executie_acces_* acoperite: pe fiecare tabel, o politică de probă construită
-- din textul formei (USING = citire, WITH CHECK = scriere) e deparsată de ACELAȘI server și comparată cu cele 4 politici reale (nume, comandă,
-- RESTRICTIVE, rolul authenticated, USING / WITH CHECK), apoi ștearsă. Întoarce NULL = identic, altfel diferențele. Doar proprietarul
-- tabelelor (migrarea, revenirea, harness-ul ca postgres); fără EXECUTE pentru clienți.
CREATE FUNCTION public.fn_executie_acces_politici_verifica(p_forma text) RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $f$
DECLARE r record; p record; v_rel regclass; v_q text; v_w text; v_pfx text; v_dif text[] := ARRAY[]::text[];
BEGIN
  IF p_forma IS NULL OR p_forma NOT IN ('vechi', 'nou') THEN RAISE EXCEPTION 'politici_verifica: forma vechi / nou'; END IF;
  FOR r IN SELECT * FROM public.fn_executie_acces_politici() ORDER BY tabel LOOP
    v_rel := CASE WHEN r.tabel = 'storage.objects' THEN 'storage.objects'::regclass ELSE to_regclass('public.' || quote_ident(r.tabel)) END;
    IF v_rel IS NULL THEN v_dif := v_dif || ('lipsa ' || r.tabel); CONTINUE; END IF;
    EXECUTE format('CREATE POLICY zz_executie_acces_proba_forma ON %s AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', v_rel,
                   CASE p_forma WHEN 'vechi' THEN r.vechi_cit ELSE r.nou_cit END, CASE p_forma WHEN 'vechi' THEN r.vechi_scr ELSE r.nou_scr END);
    SELECT pg_get_expr(x.polqual, x.polrelid), pg_get_expr(x.polwithcheck, x.polrelid) INTO v_q, v_w
      FROM pg_policy x WHERE x.polrelid = v_rel AND x.polname = 'zz_executie_acces_proba_forma';
    EXECUTE format('DROP POLICY zz_executie_acces_proba_forma ON %s', v_rel);
    v_pfx := CASE WHEN r.tabel = 'storage.objects' THEN 'executie_acces_obiect_' ELSE 'executie_acces_' END;
    IF (SELECT count(*) FROM pg_policy x WHERE x.polrelid = v_rel AND x.polname LIKE 'executie\_acces\_%') <> 4 THEN
      v_dif := v_dif || (r.tabel || ': nu are exact 4 politici executie_acces_*');
    END IF;
    FOR p IN SELECT s.suf, s.cmd, s.q, s.w, x.polname, x.polcmd, x.polpermissive, x.polroles,
                    pg_get_expr(x.polqual, x.polrelid) AS lq, pg_get_expr(x.polwithcheck, x.polrelid) AS lw
               FROM (VALUES ('citire', 'r', v_q, NULL::text), ('adauga', 'a', NULL::text, v_w), ('modifica', 'w', v_w, v_w), ('sterge', 'd', v_w, NULL::text)) s(suf, cmd, q, w)
               LEFT JOIN pg_policy x ON x.polrelid = v_rel AND x.polname = v_pfx || s.suf LOOP
      IF p.polname IS NULL OR p.polcmd::text IS DISTINCT FROM p.cmd OR p.polpermissive IS DISTINCT FROM false
         OR p.polroles IS DISTINCT FROM ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         OR p.lq IS DISTINCT FROM p.q OR p.lw IS DISTINCT FROM p.w THEN
        v_dif := v_dif || (r.tabel || '.' || v_pfx || p.suf);
      END IF;
    END LOOP;
  END LOOP;
  IF cardinality(v_dif) = 0 THEN RETURN NULL; END IF;
  RETURN left(array_to_string(v_dif, '; '), 1500);
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_acces_politici_verifica(text) FROM PUBLIC, anon, authenticated, service_role;

-- ── 3. preflight pe inventar + lock-uri + verificarea formei vechi + ALTER POLICY + postcondiții ──────────────────────────────────────────
  DECLARE r record; v_tip text; v_lista text; v_alte0 text; v_alte1 text; v_dif text; v_n integer := 0;
  BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261213a_executie_acces_proiect_perf:' || txid_current() THEN
    RAISE EXCEPTION '20261213a: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- inventarul: clasele și părinții pe care generatorul le știe (ce nu e aici = refuz, nu ghicit)
  IF EXISTS (SELECT 1 FROM public.fn_executie_acces_inventar() i
              WHERE i.tip = 'tabel' AND i.clasa = 'copil' AND (i.parinte IS NULL OR i.parinte NOT IN ('sl', 'bon', 'pachet', 'cumulat', 'activitate', 'site', 'raport')))
     OR (SELECT count(*) FROM public.fn_executie_acces_inventar() i WHERE i.tip = 'tabel' AND i.clasa = 'inbox') <> 1 THEN
    RAISE EXCEPTION '20261213a: inventarul are clase / parinti pe care politicile noi nu le cunosc';
  END IF;
  -- tabelele acoperite: tabel obișnuit, RLS pornit, cheia întreagă
  FOR r IN SELECT * FROM public.fn_executie_acces_inventar() WHERE tip = 'tabel' AND clasa IN ('proiect', 'proiect_optional', 'copil', 'inbox') ORDER BY obiect LOOP
    IF to_regclass('public.' || quote_ident(r.obiect)) IS NULL
       OR (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.' || quote_ident(r.obiect))) IS DISTINCT FROM 'r'
       OR (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || quote_ident(r.obiect))) IS NOT TRUE THEN
      RAISE EXCEPTION '20261213a: % lipseste / nu e tabel / nu are RLS', r.obiect;
    END IF;
    IF r.clasa <> 'inbox' THEN
      SELECT format_type(atttypid, atttypmod) INTO v_tip FROM pg_attribute
       WHERE attrelid = to_regclass('public.' || quote_ident(r.obiect)) AND attname = r.cheie AND attnum > 0 AND NOT attisdropped;
      IF v_tip IS NULL OR v_tip NOT IN ('bigint', 'integer') THEN RAISE EXCEPTION '20261213a: %.% nu e intreg (%)', r.obiect, r.cheie, coalesce(v_tip, 'lipsa'); END IF;
    END IF;
  END LOOP;
  -- coloanele căutate de seturile părinților și de Storage: există, întregi (text la căi), iar authenticated le poate CITI (pe rând: fără
  -- drept, politica ar da 42501 în loc de rânduri)
  FOR r IN SELECT * FROM (VALUES ('executie_situatii_plata', 'id'), ('executie_situatii_plata', 'proiect_id'), ('executie_bonuri_consum', 'id'),
                                 ('executie_bonuri_consum', 'proiect_id'), ('executie_pachete_lansare', 'id'), ('executie_pachete_lansare', 'proiect_id'),
                                 ('executie_pachete_cumulat_final', 'id'), ('executie_pachete_cumulat_final', 'proiect_id'), ('proiect_activitati', 'id'),
                                 ('proiect_activitati', 'proiect_id'), ('sites', 'id'), ('sites', 'proiect_id'), ('rapoarte_zilnice', 'id'),
                                 ('rapoarte_zilnice', 'site_id'), ('documente_proiect', 'storage_path'), ('documente_proiect', 'proiect_id')) x(t, c) LOOP
    SELECT format_type(atttypid, atttypmod) INTO v_tip FROM pg_attribute
     WHERE attrelid = to_regclass('public.' || r.t) AND attname = r.c AND attnum > 0 AND NOT attisdropped;
    IF v_tip IS NULL OR v_tip NOT IN (CASE WHEN r.c = 'storage_path' THEN 'text' ELSE 'bigint' END, CASE WHEN r.c = 'storage_path' THEN 'text' ELSE 'integer' END)
       OR NOT has_column_privilege('authenticated', to_regclass('public.' || r.t), r.c, 'SELECT') THEN
      RAISE EXCEPTION '20261213a: %.% lipseste / alt tip (%) / fara drept de citire pentru authenticated', r.t, r.c, coalesce(v_tip, 'lipsa');
    END IF;
  END LOOP;
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'storage.objects'::regclass AND attname = 'name' AND NOT attisdropped) IS DISTINCT FROM 'text'
     OR (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'storage.objects'::regclass AND attname = 'bucket_id' AND NOT attisdropped) IS DISTINCT FROM 'text'
     OR (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION '20261213a: storage.objects (name / bucket_id text, RLS) difera';
  END IF;
  -- recursivitate: politicile noi pun tabelul părinte (și sites / documente_proiect / pachetele, la Storage) ÎN expresie, deci RLS-ul lor
  -- se extinde la planificarea ORICĂREI interogări pe copil (și pentru contul nerestrâns). Dacă o politică a părintelui ar citi copilul,
  -- planificarea ar da „infinite recursion” tuturor: refuz (pg_depend, înaintea lock-urilor; reverificat de harness pe fiecare tabel)
  SELECT string_agg(DISTINCT m.parinte_tabel || ' -> ' || m.copil, ', ') INTO v_dif
    FROM (SELECT i.obiect AS copil, p.t AS parinte_tabel
            FROM public.fn_executie_acces_inventar() i
            JOIN (VALUES ('sl', 'executie_situatii_plata'), ('bon', 'executie_bonuri_consum'), ('pachet', 'executie_pachete_lansare'),
                         ('cumulat', 'executie_pachete_cumulat_final'), ('activitate', 'proiect_activitati'), ('site', 'sites'),
                         ('raport', 'rapoarte_zilnice'), ('raport', 'sites')) p(parinte, t) ON p.parinte = i.parinte
           WHERE i.tip = 'tabel' AND i.clasa = 'copil'
          UNION ALL
          SELECT 'storage.objects', t FROM (VALUES ('documente_proiect'), ('executie_pachete_lansare')) s(t)) m
    JOIN pg_policy x ON x.polrelid = to_regclass('public.' || m.parinte_tabel)
    JOIN pg_depend d ON d.classid = 'pg_policy'::regclass AND d.objid = x.oid AND d.refclassid = 'pg_class'::regclass
                    AND d.refobjid = CASE WHEN m.copil = 'storage.objects' THEN 'storage.objects'::regclass ELSE to_regclass('public.' || quote_ident(m.copil)) END;
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261213a: politica parintelui citeste copilul (recursivitate): %', v_dif; END IF;

  -- LOCK-urile (L06): tabelele acoperite în ordinea numelui, o singură instrucțiune, apoi storage.objects
  SELECT string_agg(format('public.%I', obiect), ', ' ORDER BY obiect) INTO v_lista
    FROM public.fn_executie_acces_inventar() WHERE tip = 'tabel' AND clasa IN ('proiect', 'proiect_optional', 'copil', 'inbox');
  EXECUTE 'LOCK TABLE ' || v_lista || ' IN ACCESS EXCLUSIVE MODE';
  LOCK TABLE storage.objects IN ACCESS EXCLUSIVE MODE;

  -- sub lock-uri (autoritar, L01): fiecare politică = EXACT forma 20261209a
  v_dif := public.fn_executie_acces_politici_verifica('vechi');
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261213a: politicile nu sunt cele din 20261209a: %', v_dif; END IF;
  -- celelalte politici ale tabelelor acoperite și ale Storage-ului: amprenta, ca să dovedim că nu se ating
  SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', x.polrelid::regclass, x.polname, x.polcmd, x.polpermissive, x.polroles,
                                        coalesce(pg_get_expr(x.polqual, x.polrelid), ''), coalesce(pg_get_expr(x.polwithcheck, x.polrelid), '')), ';'
                                 ORDER BY x.polrelid::regclass::text, x.polname), ''))
    INTO v_alte0 FROM pg_policy x
   WHERE x.polname NOT LIKE 'executie\_acces\_%'
     AND (x.polrelid = 'storage.objects'::regclass
          OR x.polrelid IN (SELECT to_regclass('public.' || quote_ident(i.obiect)) FROM public.fn_executie_acces_inventar() i
                             WHERE i.tip = 'tabel' AND i.clasa IN ('proiect', 'proiect_optional', 'copil', 'inbox')));

  -- ALTER POLICY: aceleași nume / comenzi / roluri, doar expresia (citire: USING; adaugă: WITH CHECK; modifică: USING + WITH CHECK; șterge: USING)
  FOR r IN SELECT * FROM public.fn_executie_acces_politici() WHERE nou_cit IS DISTINCT FROM vechi_cit OR nou_scr IS DISTINCT FROM vechi_scr ORDER BY tabel LOOP
    IF r.tabel = 'storage.objects' THEN
      EXECUTE format('ALTER POLICY executie_acces_obiect_citire ON storage.objects USING (%s)', r.nou_cit);
      EXECUTE format('ALTER POLICY executie_acces_obiect_adauga ON storage.objects WITH CHECK (%s)', r.nou_scr);
      EXECUTE format('ALTER POLICY executie_acces_obiect_modifica ON storage.objects USING (%s) WITH CHECK (%s)', r.nou_scr, r.nou_scr);
      EXECUTE format('ALTER POLICY executie_acces_obiect_sterge ON storage.objects USING (%s)', r.nou_scr);
    ELSE
      EXECUTE format('ALTER POLICY executie_acces_citire ON public.%I USING (%s)', r.tabel, r.nou_cit);
      EXECUTE format('ALTER POLICY executie_acces_adauga ON public.%I WITH CHECK (%s)', r.tabel, r.nou_scr);
      EXECUTE format('ALTER POLICY executie_acces_modifica ON public.%I USING (%s) WITH CHECK (%s)', r.tabel, r.nou_scr, r.nou_scr);
      EXECUTE format('ALTER POLICY executie_acces_sterge ON public.%I USING (%s)', r.tabel, r.nou_scr);
    END IF;
    v_n := v_n + 1;
  END LOOP;

  -- ── postcondiții ──
  v_dif := public.fn_executie_acces_politici_verifica('nou');
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261213a post: politicile noi difera de forma generata: %', v_dif; END IF;
  IF v_n <> (SELECT count(*) FROM public.fn_executie_acces_politici() WHERE clasa <> 'inbox') THEN
    RAISE EXCEPTION '20261213a post: % tabele schimbate (asteptat toate in afara cozii Inboxului)', v_n;
  END IF;
  -- nicio politică executie_acces_* nu mai cheamă predicatele pe rând (dependențele înregistrate de ALTER POLICY)
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_policy x ON d.classid = 'pg_policy'::regclass AND d.objid = x.oid
              WHERE x.polname LIKE 'executie\_acces\_%' AND d.refclassid = 'pg_proc'::regclass
                AND d.refobjid IN (to_regprocedure('public.fn_executie_proiect_permis(bigint, boolean)'),
                                   to_regprocedure('public.fn_executie_acces_parinte_permis(text, bigint, boolean)'),
                                   to_regprocedure('public.fn_executie_acces_obiect_permis(text, text, boolean)'))) THEN
    RAISE EXCEPTION '20261213a post: o politica executie_acces_* inca depinde de un predicat pe rand';
  END IF;
  SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', x.polrelid::regclass, x.polname, x.polcmd, x.polpermissive, x.polroles,
                                        coalesce(pg_get_expr(x.polqual, x.polrelid), ''), coalesce(pg_get_expr(x.polwithcheck, x.polrelid), '')), ';'
                                 ORDER BY x.polrelid::regclass::text, x.polname), ''))
    INTO v_alte1 FROM pg_policy x
   WHERE x.polname NOT LIKE 'executie\_acces\_%'
     AND (x.polrelid = 'storage.objects'::regclass
          OR x.polrelid IN (SELECT to_regclass('public.' || quote_ident(i.obiect)) FROM public.fn_executie_acces_inventar() i
                             WHERE i.tip = 'tabel' AND i.clasa IN ('proiect', 'proiect_optional', 'copil', 'inbox')));
  IF v_alte1 IS DISTINCT FROM v_alte0 OR EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'zz_executie_acces_proba_forma') THEN
    RAISE EXCEPTION '20261213a post: s-au schimbat alte politici decat executie_acces_*';
  END IF;
  -- funcțiile noi: DEFINER doar cele două liste (EXECUTE doar authenticated), generatorul și verificarea interne; owner = migrarea
  IF EXISTS (SELECT 1 FROM (VALUES ('public.fn_executie_acces_proprii_citire()', true, true), ('public.fn_executie_acces_proprii_scriere()', true, true),
                                   ('public.fn_executie_acces_politici()', false, false), ('public.fn_executie_acces_politici_verifica(text)', false, false)) a(semnatura, definer, cu_auth)
              LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
              WHERE p.oid IS NULL OR p.prosecdef IS DISTINCT FROM a.definer OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                 OR p.proowner IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname = current_user)
                 OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')
                 OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.cu_auth)
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND (p.proname LIKE 'fn\_executie\_acces\_%' OR p.proname = 'fn_executie_proiect_permis')) <> 20 THEN
    RAISE EXCEPTION '20261213a post: functiile noi (securitate / drepturi / numar) difera';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261213a_executie_acces_proiect_perf:' || txid_current() THEN
    RAISE EXCEPTION '20261213a: garda final invalida';
  END IF;
  END;
END $m$;
