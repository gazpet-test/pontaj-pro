-- 20261103c — Storage ai-documente-inbox: închide gaura de confidențialitate a cozii «Citește orice» (PREGĂTIT, NEAPLICAT).
-- Azi (catalog live citit read-only 21.10.2026): politica ai_inbox_obj_all = FOR ALL TO authenticated cu USING / WITH CHECK
--   doar bucket_id = 'ai-documente-inbox' → ORICE cont logat poate lista, descărca, suprascrie (upsert / update / move) și șterge
--   fișierele din coadă ale TUTUROR modulelor, inclusiv actele de identitate urcate în HR prin «Citește orice» sau prin wizard-ul
--   „Angajat nou” (59 obiecte, 3 fără rând în coadă). Celelalte 109 politici pe storage.objects sunt legate de alte bucket-uri
--   (verificat aici, în precondiție). Bucket privat, fără versionare.
-- După:
--   1. ai_inbox_obj_insert (INSERT): doar în folderul propriu — primul segment al căii = auth.uid() (convenția panoului,
--      src/CitesteOricePanel.jsx: `${profile.id}/${Date.now()}_${rand}.${ext}`) — sau sub `wizard-angajare/…` (convenția
--      wizard-ului, src/HrAngajatNouWizard.jsx) DOAR pentru owner / can_access_personal_data (cine vede „➕ Angajat nou”).
--      Rădăcina bucket-ului și folderele altora: refuz. ȘI calea nu e deja a unui rând din coadă (r3, Copilot #832 r2 P1): fără
--      asta, cine a urcat își șterge fișierul (clauza 2a) și urcă ALT conținut pe aceeași cale, sub rândul deja clasificat
--      (payload_ai / previzualizarea / confirmarea ar lucra pe alt act decât cel citit). Panoul și wizard-ul urcă mereu pe căi
--      noi (`<ts>_<rand>`), deci niciun drum legitim nu reocupă o cale. NOT EXISTS rulează cu RLS-ul cozii al apelantului: pe
--      `<uid>/…` rândurile sunt ale lui (uploadat_de = el, legate la INSERT — 4a), deci le vede mereu; vezi limitarea c pentru
--      `wizard-angajare/…`.
--   2. ai_inbox_obj_select + ai_inbox_obj_delete (aceeași expresie). Vede / șterge un obiect:
--      (a) cine l-a urcat: owner_id = auth.uid() (îl pune storage-api din JWT; prin API nu se alege). Acoperă și pașii de dinaintea
--          rândului din coadă (panoul / wizard-ul șterg fișierul când INSERT-ul rândului pică) și căile wizard-ului;
--      (b) cine poate confirma rândul din coadă LEGAT de obiect: EXISTS rând cu fisier_path = name ȘI uploadat_de = owner_id-ul
--          obiectului ȘI fn_ai_inbox_poate_confirma(modul_tinta, entitate_id) — aceeași regulă ca vizibilitatea rândului
--          (ai_inbox_select), deci panoul și wizard-ul descarcă, previzualizează (URL semnat) și curăță exact ce văd în coadă;
--      (c) ownerul (profiles.is_owner) — inclusiv obiectele orfane, fără rând.
--      Toate trei cer auth.uid() ne-NULL (fn_ai_inbox_poate_confirma întoarce true pentru uid NULL — „service_role / migrări”).
--   3. FĂRĂ politică UPDATE (și fără ALL): nimeni în afară de service_role nu mai suprascrie, nu mai mută și nu mai redenumește
--      obiecte din coadă. Codul nu are nevoie: toate upload-urile în bucket sunt upsert:false, fără move / update (panou, wizard).
--   4. LEGĂTURA rând ↔ fișier, la INSERT și pe viață (fisier_path îl scrie clientul; ai_inbox_insert cere doar uploadat_de = uid):
--      4a. trg_ai_inbox_fisier_legat (BEFORE INSERT; funcție DEFINER, search_path fix, fără EXECUTE pentru roluri): un cont logat
--          (uid în JWT) creează rândul DOAR cu uploadat_de = el și DOAR pentru un fișier existent în bucket urcat de el
--          (owner_id = uid) — altfel 42501, același mesaj fie că fișierul lipsește, fie că e al altcuiva (fără oracol). Fără ea,
--          un rând falsificat („nedecis”, cu calea actului HR al altcuiva) ar fi exploatat prin service_role: edge-ul citeste-orice
--          descarcă row.fisier_path și scrie payload_ai (nume, CNP …) în rândul atacatorului, pe care acesta îl citește
--          (ai_inbox_select); cleanup-recycle-bin șterge fișierul rândurilor „respins” → atacatorul își respinge rândul fals și,
--          după retenție, fișierul VICTIMEI dispare. service_role / postgres (uid NULL) sar peste verificare: ocolesc oricum RLS-ul
--          și nu creează rânduri azi (verificat: nicio funcție din BD și niciun edge din repo nu inserează în coadă).
--      4b. trg_ai_inbox_fisier_imutabil (BEFORE UPDATE; funcție INVOKER, search_path fix, fără EXECUTE pentru roluri):
--          fisier_path, uploadat_de, fisier_nume, fisier_size_bytes, fisier_mime nu se mai schimbă după INSERT — orice UPDATE care
--          le schimbă = 23514, pentru oricine (și service_role / postgres). Fără el, legătura s-ar falsifica după INSERT
--          (ai_inbox_update are WITH CHECK doar auth.uid() IS NOT NULL). Niciun drum din cod nu le modifică (verificat: panou,
--          wizard, edge-urile citeste-orice și cleanup-recycle-bin, funcțiile din BD). Închide și limitarea d a 20261103a.
--      4c. idx_ai_inbox_fisier_path UNIC: un rând per fișier (azi 0 dubluri în 1330 de rânduri; panoul și wizard-ul generează căi
--          noi la fiecare upload) — căutarea rândului legat (2b) per obiect și „un fișier = un rând” pentru edge / curățenie.
--      Precondiția de date verifică TOATE rândurile existente (orice stare, nu doar cele deschise): niciun obiect cu alt owner_id
--      decât uploadat_de, nicio cale dublă, nicio cale în afara folderului celui care a urcat (sau wizard-angajare/). Azi: 0 / 0 / 0.
--      4d. (politica 1) o cale legată o dată de un rând nu se mai reocupă printr-un upload nou: după ștergerea fișierului rândul
--          rămâne fără obiect, nu cu alt conținut. Legătura e pe cale + cine a urcat, nu pe conținut (fără hash): service_role
--          (ocolește RLS-ul) ar putea în continuare rescrie un obiect — e de încredere, azi nu o face.
--      Împreună: orice rând din coadă (vechi sau nou) arată doar spre un fișier al celui care l-a creat → edge-urile service_role
--      descarcă / șterg doar fișierul acelui cont. Codul edge-urilor rămâne neschimbat (fără deploy).
-- NEATINSE: service_role (edge citeste-orice descarcă, cleanup-recycle-bin șterge — ocolesc RLS), celelalte bucket-uri și politicile
-- lor (amprenta lor e comparată pre ↔ post, aici), politicile tabelei ai_documente_inbox, fn_ai_inbox_poate_confirma. Fără date
-- modificate.
-- Expresiile noi se compară în postcondiție (și în revenire) cu constante EXACTE ale deparse-ului, cu spațiile albe comprimate
-- (fișierul e CRLF pe Windows — deparse-ul are LF și indentare proprie); search_path e fixat mai jos, deci deparse-ul e determinist.
-- Constantele sunt verificate pe PG17 local; pe ținta reală le confirmă chiar postcondiția (deparse diferit ⇒ migrarea cade, nimic
-- aplicat) — pasul 3 din planul cu branch Supabase (docs/HR/INBOX_STORAGE_RLS.md).
-- LIMITĂRI ACCEPTATE (de decis separat, nu aici):
--   a. fn_ai_inbox_poate_confirma(NULL, …) = true pentru orice cont cu profil: fișierul unui rând „nedecis” rămâne vizibil și
--      ștergibil de oricine, ca rândul însuși și payload_ai-ul lui (ai_inbox_select / ai_inbox_update). NU doar rânduri istorice:
--      orice upload fără modul pre-setat e „nedecis” cât îl clasifică AI-ul (secunde) și definitiv dacă ajunge în „eroare” fără
--      modul. Panoul pre-setează modulul pentru UPA, Execuție cu proiect și (din același PR) HR; wizard-ul „Angajat nou” pune
--      modul_tinta = 'hr' de la upload → actele HR urcate din HR nu mai trec prin „nedecis”. Rămân nedecise upload-urile din
--      Execuție fără proiect, Logistică și Financiar (rutate de AI). Restrângerea = migrare separată pe regula cozii.
--   b. cine poate edita un rând (ai_inbox_update) îi poate schimba modul_tinta, dar doar spre o stare pe care o vede în continuare
--      (PostgreSQL aplică ai_inbox_select și rândului nou — un cont fără drepturi nu mută „nedecisul” în HR, 42501). Un confirmator
--      poate însă muta un rând al lui în „nedecis” (ex. HR un act HR) → fișierul devine vizibil oricui (T6n–T6o). Actorul vedea
--      deja actul (insider, nu escaladare pentru el); politica UPDATE a cozii = migrare separată.
--   c. căile `wizard-angajare/…` nu poartă uid-ul: le apără owner_id-ul + dreptul HR cerut la INSERT. Garda 4d vede acolo doar rândurile
--      pe care contul HR le vede în coadă: calea eliberată a unui rând mutat într-un modul pe care HR nu-l vede s-ar putea reocupa de
--      alt cont HR (insider, calea `<ts>_<rand>` trebuie știută; obiectul nou are alt owner_id → nu se leagă de rând, clauza 2b
--      cade, edge-ul nu-l mai citește — rândul nu e în așteptare). Forward-fix recomandat: wizard-ul urcă în
--      `${uid}/wizard-angajare/…`, apoi excepția din (1) se scoate printr-o migrare nouă.
--   d. URL-urile semnate deja emise (panoul: 120 s) rămân valabile până expiră.
--   e. ștergerea unui rând din coadă de către wizard (scoateDoc / abandon) cere ai_inbox_delete = owner: pentru HR fără owner rândul
--      rămâne (preexistent, nu din 20261103c); fișierul lui se șterge corect (owner_id = cine l-a urcat).
-- Revenire: supabase/revenire/20261103c_ai_inbox_storage_politici_ROLLBACK.sql (REDESCHIDE gaura; doar la cererea lui Răzvan).
-- Test local: scripts/test_ai_inbox_storage_politici.sh. Plan de test cu Storage real (branch Supabase): docs/HR/INBOX_STORAGE_RLS.md.
-- ORDINE: DOAR DUPĂ E3 (20261103b, Izometrie — convenit cu sesiunea Izometrie): E3 are un baseline fix al politicilor storage
-- (inclusiv ai_inbox_obj_all) și ar refuza după 20261103c; precondiția de mai jos cere E3 aplicată (bucket-ul izo-documente +
-- stratul RESTRICTIV izo_doc_scan_r_toti) și nu atinge nimic din ce acoperă ștampila E3 (politicile izo_doc_*, RLS / FORCE /
-- owner / ACL pe storage.objects, storage.buckets). Politicile RESTRICTIVE ale E3 lasă bucket-ul cozii neatins
-- (bucket_id IS DISTINCT FROM 'izo-documente'); harness-ul local rulează pe un catalog cu ele.
-- LIVRARE: doar prin scripts/livrare_migrare.sh; fără BEGIN/COMMIT. LOCK-urile de mai jos se iau ÎNAINTEA precondițiilor și se țin
-- PÂNĂ LA COMMIT (toată migrarea, zeci de ms), în ordinea coadă → storage (r3, Copilot #832 r2 P2 — aceeași ordine ca drumul
-- INSERT rând → trigger 4a care citește storage, deci fără ciclu de deadlock cu el): ai_documente_inbox în SHARE ROW EXCLUSIVE —
-- citirile merg, scrierile așteaptă; storage.objects în ACCESS EXCLUSIVE — în acest timp TOATE operațiile storage, pe toate
-- bucket-urile, așteaptă. Așa nicio politică și niciun rând nu se schimbă între verificare și DDL. lock_timeout 5s: cu interogări
-- lungi în curs, migrarea cade curat (se reîncearcă), nimic schimbat. Nu cunoaștem alt drum care ține storage și cere coada; dacă
-- PostgreSQL ar detecta totuși un deadlock, anulează o tranzacție întreagă (migrarea sau operația concurentă — ex. un upload, pe
-- care panoul îl arată ca eroare), fără efect parțial.

DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261103c_ai_inbox_storage_politici:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261103c: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_temp;
LOCK TABLE public.ai_documente_inbox IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE storage.objects IN ACCESS EXCLUSIVE MODE;

DO $pre$
DECLARE
  c_vechi CONSTANT text := '(bucket_id = ''ai-documente-inbox''::text)';
  v_b jsonb; v_n bigint; v_lista text; v_col text; v_def oid;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'PRECONDIȚIE 20261103c: necesita postgres'; END IF;
  IF current_setting('search_path') IS DISTINCT FROM 'public, pg_temp' THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103c: search_path = „%” (aștept „public, pg_temp” — deparse-ul comparat depinde de el)', current_setting('search_path');
  END IF;
  -- ordinea convenită cu Izometrie: E3 (20261103b) întâi — E3 e atomică, deci bucket-ul ei + stratul RESTRICTIV = E3 aplicată
  IF NOT EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = 'izo-documente')
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'izo_doc_scan_r_toti' AND NOT p.polpermissive) THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103c: E3 (20261103b, Izometrie) nu e aplicată — ordinea convenită e E3 întâi, apoi 20261103c (E3 are un baseline cu ai_inbox_obj_all)';
  END IF;
  -- RLS activ pe ambele tabele (politicile nu înseamnă nimic altfel)
  IF (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'storage.objects'::regclass) IS NOT TRUE
     OR (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.ai_documente_inbox'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103c: RLS nu e activ pe storage.objects / ai_documente_inbox — politicile n-ar avea efect';
  END IF;
  -- bucket-ul: privat (un bucket public se citește pe URL public, fără RLS) și fără versionare (ștergerea ar crea marcaje)
  SELECT to_jsonb(b) INTO v_b FROM storage.buckets b WHERE b.id = 'ai-documente-inbox';
  IF v_b IS NULL THEN RAISE EXCEPTION 'PRECONDIȚIE 20261103c: bucket-ul ai-documente-inbox lipsește'; END IF;
  IF (v_b ->> 'public') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103c: bucket-ul ai-documente-inbox e public — politicile nu apără URL-urile publice; decizie separată întâi';
  END IF;
  IF coalesce(v_b ->> 'versioning_status', 'DISABLED') IS DISTINCT FROM 'DISABLED' THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103c: bucket-ul ai-documente-inbox are versionare (%) — politicile n-au fost gândite pentru marcaje de ștergere', v_b ->> 'versioning_status';
  END IF;
  -- politica veche: EXACT cea citită live; nicio politică ai_inbox_obj_* în plus (reaplicare / altă stare ⇒ refuz, nimic atins)
  IF (SELECT count(*) FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND starts_with(p.polname::text, 'ai_inbox_obj')) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'ai_inbox_obj_all'
                    AND p.polcmd = '*' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid]
                    AND pg_get_expr(p.polqual, p.polrelid) = c_vechi AND pg_get_expr(p.polwithcheck, p.polrelid) = c_vechi) THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103c: ai_inbox_obj_all nu e exact politica citită live (FOR ALL TO authenticated, doar bucket_id) sau există deja alte politici ai_inbox_obj_* — nu se aplică peste altă stare';
  END IF;
  -- nicio altă politică nu numește bucket-ul și fiecare altă politică PERMISSIVE e legată, la nivel superior, de ALT bucket:
  -- „(bucket_id = 'x'::text)” sau „((bucket_id = 'x'::text) AND …)” (forma de deparse: un OR la nivel superior începe cu „(((”).
  -- Altfel o politică veche ar da acces în continuare la coadă, peste cele noi (politicile PERMISSIVE se adună prin OR).
  -- O politică fără USING / WITH CHECK (polqual / polwithcheck NULL) nu dă acces deloc (PostgreSQL: fără expresie permisivă =
  -- refuz) — de aceea expresiile NULL nu se listează (testat în harness, pasul 1p).
  WITH e AS (
    SELECT p.polname::text AS n, p.polpermissive AS perm, x.expr
      FROM pg_policy p, LATERAL (VALUES (pg_get_expr(p.polqual, p.polrelid)), (pg_get_expr(p.polwithcheck, p.polrelid))) AS x(expr)
     WHERE p.polrelid = 'storage.objects'::regclass AND p.polname <> 'ai_inbox_obj_all' AND x.expr IS NOT NULL)
  SELECT string_agg(DISTINCT n, ', ') INTO v_lista FROM e
   WHERE position('ai-documente-inbox' IN expr) > 0
      OR (perm AND NOT (expr ~ '^[(]bucket_id = ''[^'']+''::text[)]$' OR expr ~ '^[(][(]bucket_id = ''[^'']+''::text[)] AND '));
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103c: alte politici pe storage.objects pot atinge bucket-ul ai-documente-inbox (numesc bucket-ul sau nu sunt legate de alt bucket): % — se analizează întâi', v_lista;
  END IF;
  -- amprenta celorlalte politici storage (comparată în postcondiție: migrarea nu atinge nimic în afară de ai_inbox_obj_*)
  PERFORM set_config('gazpet.c20261103c_alte_politici', (
    SELECT md5(coalesce(string_agg(p.polname::text || '|' || p.polcmd::text || '|' || p.polpermissive::text || '|' || p.polroles::text
                 || '|' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
                 ',' ORDER BY p.polname), ''))
      FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND NOT starts_with(p.polname::text, 'ai_inbox_obj')), true);
  -- dependențele expresiilor noi: funcția de drept (DEFINER, EXECUTE pentru authenticated), storage.foldername, auth.uid()
  IF to_regprocedure('public.fn_ai_inbox_poate_confirma(text,bigint)') IS NULL
     OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ai_inbox_poate_confirma(text,bigint)'))
     OR NOT has_function_privilege('authenticated', 'public.fn_ai_inbox_poate_confirma(text,bigint)', 'EXECUTE')
     OR to_regprocedure('storage.foldername(text)') IS NULL
     OR NOT has_function_privilege('authenticated', 'storage.foldername(text)', 'EXECUTE')
     OR to_regprocedure('auth.uid()') IS NULL OR NOT has_function_privilege('authenticated', 'auth.uid()', 'EXECUTE') THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103c: lipsește fn_ai_inbox_poate_confirma(text,bigint) (SECURITY DEFINER) / storage.foldername(text) / auth.uid() sau authenticated nu le poate apela';
  END IF;
  -- funcția DEFINER a legăturii (4a) citește storage.objects ca postgres: postgres trebuie să ocolească RLS-ul (live: BYPASSRLS),
  -- altfel n-ar vedea obiectele și ar refuza orice upload
  IF NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user)
     OR NOT has_table_privilege(current_user, 'storage.objects', 'SELECT')
     OR NOT has_function_privilege(current_user, 'auth.uid()', 'EXECUTE') THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103c: postgres nu ocolește RLS-ul / nu citește storage.objects / nu apelează auth.uid() — legătura de la INSERT ar refuza orice upload';
  END IF;
  -- coloanele citite de politici, cu tipurile și colațiile live (comparațiile text = text cer aceeași colație deterministă)
  SELECT c.oid INTO v_def FROM pg_collation c WHERE c.collname = 'default' AND c.collnamespace = 'pg_catalog'::regnamespace;
  IF (SELECT count(*) FROM pg_attribute a
       WHERE NOT a.attisdropped AND a.attnum > 0 AND (
             (a.attrelid = 'storage.objects'::regclass AND ((a.attname = 'bucket_id' AND a.atttypid = 'text'::regtype)
                OR (a.attname = 'name' AND a.atttypid = 'text'::regtype AND a.attcollation = v_def)
                OR (a.attname = 'owner_id' AND a.atttypid = 'text'::regtype AND a.attcollation = v_def)))
          OR (a.attrelid = 'public.ai_documente_inbox'::regclass AND ((a.attname = 'fisier_path' AND a.atttypid = 'text'::regtype AND a.attnotnull AND a.attcollation = v_def)
                OR (a.attname = 'uploadat_de' AND a.atttypid = 'uuid'::regtype AND a.attnotnull)
                OR (a.attname = 'modul_tinta' AND a.atttypid = 'text'::regtype) OR (a.attname = 'entitate_id' AND a.atttypid = 'bigint'::regtype)
                OR (a.attname = 'fisier_nume' AND a.atttypid = 'text'::regtype) OR (a.attname = 'fisier_size_bytes' AND a.atttypid = 'bigint'::regtype)
                OR (a.attname = 'fisier_mime' AND a.atttypid = 'text'::regtype)))
          OR (a.attrelid = 'public.profiles'::regclass AND ((a.attname = 'id' AND a.atttypid = 'uuid'::regtype)
                OR (a.attname = 'is_owner' AND a.atttypid = 'boolean'::regtype) OR (a.attname = 'can_access_personal_data' AND a.atttypid = 'boolean'::regtype))))) <> 13 THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103c: coloanele citite de politici (storage.objects bucket_id/name/owner_id, ai_documente_inbox fisier_*/uploadat_de/modul_tinta/entitate_id, profiles id/is_owner/can_access_personal_data) lipsesc sau au alt tip / altă colație';
  END IF;
  -- politicile rulează cu drepturile apelantului: fără SELECT pe coloanele citite, ORICE acces din panou ar cădea (42501)
  FOREACH v_col IN ARRAY ARRAY['fisier_path', 'uploadat_de', 'modul_tinta', 'entitate_id'] LOOP
    IF NOT has_column_privilege('authenticated', 'public.ai_documente_inbox', v_col, 'SELECT') THEN
      RAISE EXCEPTION 'PRECONDIȚIE 20261103c: authenticated nu are SELECT pe ai_documente_inbox.%', v_col;
    END IF;
  END LOOP;
  FOREACH v_col IN ARRAY ARRAY['id', 'is_owner', 'can_access_personal_data'] LOOP
    IF NOT has_column_privilege('authenticated', 'public.profiles', v_col, 'SELECT') THEN
      RAISE EXCEPTION 'PRECONDIȚIE 20261103c: authenticated nu are SELECT pe profiles.%', v_col;
    END IF;
  END LOOP;
  IF to_regclass('public.idx_ai_inbox_fisier_path') IS NOT NULL OR to_regprocedure('public.ai_inbox_fisier_imutabil()') IS NOT NULL
     OR to_regprocedure('public.ai_inbox_fisier_legat()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_ai_inbox_fisier_imutabil', 'trg_ai_inbox_fisier_legat')) THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103c: indexul / funcțiile / trigger-ele patch-ului există deja';
  END IF;
  -- date, pe TOATE rândurile (orice stare; sub lock — nu se schimbă până la COMMIT). Azi: 0 / 0 / 0 (1330 de rânduri, 56 cu obiect).
  -- (1) un rând al cărui obiect are alt owner_id decât uploadat_de = rând falsificat sau neconfirmabil; pentru „respins”, curățenia
  --     (service_role) i-ar șterge fișierul altcuiva → analiză întâi
  SELECT count(*) INTO v_n FROM public.ai_documente_inbox i
    JOIN storage.objects o ON o.bucket_id = 'ai-documente-inbox' AND o.name = i.fisier_path
   WHERE o.owner_id IS DISTINCT FROM i.uploadat_de::text;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103c: % rând(uri) din coadă (orice stare) au obiectul urcat de alt cont decât uploadat_de — falsificate sau neconfirmabile; se analizează întâi', v_n;
  END IF;
  -- (2) aceeași cale în mai multe rânduri ⇒ indexul unic n-ar trece
  SELECT count(*) - count(DISTINCT i.fisier_path) INTO v_n FROM public.ai_documente_inbox i;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103c: % rând(uri) din coadă repetă aceeași cale (fisier_path) — un fișier = un rând; se analizează întâi', v_n;
  END IF;
  -- (3) rânduri (și cele fără obiect) cu calea în afara folderului celui care a urcat: un obiect apărut acolo mai târziu ar fi al
  --     altcuiva. Excepție: wizard-angajare/ (limitarea c)
  SELECT count(*) INTO v_n FROM public.ai_documente_inbox i
   WHERE split_part(i.fisier_path, '/', 1) IS DISTINCT FROM i.uploadat_de::text AND NOT starts_with(i.fisier_path, 'wizard-angajare/');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103c: % rând(uri) din coadă au calea în afara folderului celui care a urcat (<uid>/… sau wizard-angajare/…); se analizează întâi', v_n;
  END IF;
END $pre$;

-- 4c. un rând per fișier + căutarea rândului legat (2b)
CREATE UNIQUE INDEX idx_ai_inbox_fisier_path ON public.ai_documente_inbox USING btree (fisier_path);

COMMENT ON INDEX public.idx_ai_inbox_fisier_path IS
  '20261103c: un rând per fișier; politicile storage ai_inbox_obj_select / _delete caută rândul din coadă legat de obiect (fisier_path = name) per obiect.';

-- 4a. rândul se leagă la INSERT doar de un fișier urcat chiar de cel care îl creează
CREATE FUNCTION public.ai_inbox_fisier_legat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $f$
DECLARE v_uid uuid := auth.uid();
BEGIN
  -- service_role / postgres (fără uid în JWT) ocolesc oricum RLS-ul; un cont logat leagă rândul DOAR de un fișier pe care l-a urcat
  -- el (owner_id pus de storage-api din JWT). Altfel edge-urile service_role (citeste-orice descarcă, cleanup-recycle-bin șterge)
  -- ar lucra pe fișierul altcuiva în numele unui rând falsificat. Același mesaj pentru „lipsește” și „e al altcuiva” (fără oracol).
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  IF NEW.uploadat_de IS DISTINCT FROM v_uid
     OR NOT EXISTS (SELECT 1 FROM storage.objects o
                     WHERE o.bucket_id = 'ai-documente-inbox' AND o.name = NEW.fisier_path AND o.owner_id = v_uid::text) THEN
    RAISE EXCEPTION 'ai_documente_inbox: fișierul rândului nu e în coadă sau nu l-ai urcat tu — rândul se leagă doar de un fișier urcat de același cont'
      USING ERRCODE = '42501', HINT = 'Urcă fișierul întâi (storage), apoi creează rândul cu aceeași cale și uploadat_de = contul tău.';
  END IF;
  RETURN NEW;
END $f$;

REVOKE EXECUTE ON FUNCTION public.ai_inbox_fisier_legat() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.ai_inbox_fisier_legat() IS
  '20261103c: BEFORE INSERT pe ai_documente_inbox — un cont logat creează rândul doar pentru un fișier din ai-documente-inbox urcat de el (owner_id = uid = uploadat_de); 42501 altfel. service_role / postgres neatinse.';

CREATE TRIGGER trg_ai_inbox_fisier_legat
  BEFORE INSERT ON public.ai_documente_inbox
  FOR EACH ROW EXECUTE FUNCTION public.ai_inbox_fisier_legat();

-- 4b. fișierul rândului (și cine l-a urcat) nu se mai schimbă după INSERT
CREATE FUNCTION public.ai_inbox_fisier_imutabil()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path = public, pg_temp
AS $f$
BEGIN
  -- legătura cu obiectul din storage (politicile ai_inbox_obj_select / _delete) se face pe fisier_path + uploadat_de: dacă s-ar
  -- putea edita, oricine ar lega un rând „nedecis” de actul altcuiva. Numele / mărimea / tipul descriu același fișier (20261103a).
  IF NEW.fisier_path IS DISTINCT FROM OLD.fisier_path OR NEW.uploadat_de IS DISTINCT FROM OLD.uploadat_de
     OR NEW.fisier_nume IS DISTINCT FROM OLD.fisier_nume OR NEW.fisier_size_bytes IS DISTINCT FROM OLD.fisier_size_bytes
     OR NEW.fisier_mime IS DISTINCT FROM OLD.fisier_mime THEN
    RAISE EXCEPTION 'ai_documente_inbox #%: fișierul rândului (fisier_path / fisier_nume / fisier_size_bytes / fisier_mime) și uploadat_de sunt nemodificabile — se pun doar la INSERT', OLD.id
      USING ERRCODE = '23514', HINT = 'Alt fișier = alt rând: respinge rândul și urcă fișierul din nou.';
  END IF;
  RETURN NEW;
END $f$;

REVOKE EXECUTE ON FUNCTION public.ai_inbox_fisier_imutabil() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.ai_inbox_fisier_imutabil() IS
  '20261103c: BEFORE UPDATE pe ai_documente_inbox — refuză (23514) schimbarea fisier_path / uploadat_de / fisier_nume / fisier_size_bytes / fisier_mime (legătura rând ↔ obiect din storage).';

CREATE TRIGGER trg_ai_inbox_fisier_imutabil
  BEFORE UPDATE ON public.ai_documente_inbox
  FOR EACH ROW EXECUTE FUNCTION public.ai_inbox_fisier_imutabil();

-- 1–3. politicile bucket-ului: INSERT în folderul propriu (pe o cale nelegată încă de un rând), SELECT / DELETE pentru cine a urcat /
-- poate confirma / owner, fără UPDATE
DROP POLICY ai_inbox_obj_all ON storage.objects;

CREATE POLICY ai_inbox_obj_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ai-documente-inbox'
    AND (SELECT auth.uid()) IS NOT NULL
    AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
         OR ((storage.foldername(name))[1] = 'wizard-angajare'
             AND EXISTS (SELECT 1 FROM public.profiles p
                          WHERE p.id = (SELECT auth.uid()) AND (p.is_owner = true OR p.can_access_personal_data = true))))
    -- 4d: o cale deja legată de un rând din coadă nu se reocupă (alt conținut sub un rând clasificat)
    AND NOT EXISTS (SELECT 1 FROM public.ai_documente_inbox i WHERE i.fisier_path = objects.name));

CREATE POLICY ai_inbox_obj_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    bucket_id = 'ai-documente-inbox'
    AND (SELECT auth.uid()) IS NOT NULL
    AND (owner_id = (SELECT auth.uid())::text
         OR EXISTS (SELECT 1 FROM public.ai_documente_inbox i
                     WHERE i.fisier_path = objects.name AND i.uploadat_de::text = objects.owner_id
                       AND public.fn_ai_inbox_poate_confirma(i.modul_tinta, i.entitate_id))
         OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.is_owner = true)));

CREATE POLICY ai_inbox_obj_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    bucket_id = 'ai-documente-inbox'
    AND (SELECT auth.uid()) IS NOT NULL
    AND (owner_id = (SELECT auth.uid())::text
         OR EXISTS (SELECT 1 FROM public.ai_documente_inbox i
                     WHERE i.fisier_path = objects.name AND i.uploadat_de::text = objects.owner_id
                       AND public.fn_ai_inbox_poate_confirma(i.modul_tinta, i.entitate_id))
         OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.is_owner = true)));

DO $post$
DECLARE
  -- deparse-ul exact (search_path = public, pg_temp), cu spațiile albe comprimate la un singur spațiu
  c_ins CONSTANT text := '((bucket_id = ''ai-documente-inbox''::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND (((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) OR (((storage.foldername(name))[1] = ''wizard-angajare''::text) AND (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_owner = true) OR (p.can_access_personal_data = true))))))) AND (NOT (EXISTS ( SELECT 1 FROM ai_documente_inbox i WHERE (i.fisier_path = objects.name)))))';
  c_sel CONSTANT text := '((bucket_id = ''ai-documente-inbox''::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND ((owner_id = (( SELECT auth.uid() AS uid))::text) OR (EXISTS ( SELECT 1 FROM ai_documente_inbox i WHERE ((i.fisier_path = objects.name) AND ((i.uploadat_de)::text = objects.owner_id) AND fn_ai_inbox_poate_confirma(i.modul_tinta, i.entitate_id)))) OR (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.is_owner = true))))))';
  v_fn oid := to_regprocedure('public.ai_inbox_fisier_imutabil()');
  v_fl oid := to_regprocedure('public.ai_inbox_fisier_legat()');
BEGIN
  IF current_setting('search_path') IS DISTINCT FROM 'public, pg_temp' THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261103c: search_path schimbat în timpul migrării';
  END IF;
  IF (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'storage.objects'::regclass) IS NOT TRUE
     OR (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.ai_documente_inbox'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261103c: RLS nu mai e activ pe storage.objects / ai_documente_inbox';
  END IF;
  -- exact trei politici ale patch-ului, cu comenzile / rolurile / expresiile așteptate; ai_inbox_obj_all nu mai există
  IF (SELECT count(*) FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND starts_with(p.polname::text, 'ai_inbox_obj')) <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'ai_inbox_obj_insert'
                    AND p.polcmd = 'a' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid] AND p.polqual IS NULL
                    AND regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '[[:space:]]+', ' ', 'g') = c_ins)
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'ai_inbox_obj_select'
                    AND p.polcmd = 'r' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid] AND p.polwithcheck IS NULL
                    AND regexp_replace(pg_get_expr(p.polqual, p.polrelid), '[[:space:]]+', ' ', 'g') = c_sel)
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'ai_inbox_obj_delete'
                    AND p.polcmd = 'd' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid] AND p.polwithcheck IS NULL
                    AND regexp_replace(pg_get_expr(p.polqual, p.polrelid), '[[:space:]]+', ' ', 'g') = c_sel) THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261103c: politicile ai_inbox_obj_insert / _select / _delete lipsesc sau au altă definiție (sau a rămas ai_inbox_obj_all)';
  END IF;
  -- nicio politică UPDATE / ALL nu mai atinge bucket-ul
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polcmd IN ('w', '*') AND p.polpermissive
               AND position('ai-documente-inbox' IN coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) > 0) THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261103c: a rămas o politică UPDATE / ALL pe bucket-ul ai-documente-inbox';
  END IF;
  -- celelalte politici storage: EXACT cele de la precondiție (comparate integral, nu doar ca număr)
  IF (SELECT md5(coalesce(string_agg(p.polname::text || '|' || p.polcmd::text || '|' || p.polpermissive::text || '|' || p.polroles::text
                 || '|' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
                 ',' ORDER BY p.polname), ''))
        FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND NOT starts_with(p.polname::text, 'ai_inbox_obj'))
     IS DISTINCT FROM nullif(current_setting('gazpet.c20261103c_alte_politici', true), '') THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261103c: celelalte politici de pe storage.objects s-au schimbat în timpul migrării';
  END IF;
  IF (SELECT pg_get_indexdef(to_regclass('public.idx_ai_inbox_fisier_path'))) IS DISTINCT FROM
       'CREATE UNIQUE INDEX idx_ai_inbox_fisier_path ON public.ai_documente_inbox USING btree (fisier_path)' THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261103c: indexul unic idx_ai_inbox_fisier_path lipsește sau are altă definiție';
  END IF;
  IF v_fn IS NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn
                AND (p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] OR p.proacl IS NULL))
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_fn AND a.grantee <> p.proowner) THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261103c: funcția ai_inbox_fisier_imutabil nu e INVOKER / search_path fix / fără EXECUTE pentru roluri';
  END IF;
  IF v_fl IS NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fl
                AND (NOT p.prosecdef OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
                     OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] OR p.proacl IS NULL))
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_fl AND a.grantee <> p.proowner) THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261103c: funcția ai_inbox_fisier_legat nu e DEFINER (postgres) / search_path fix / fără EXECUTE pentru roluri';
  END IF;
  -- tgtype 19 = ROW (1) + BEFORE (2) + UPDATE (16); 7 = ROW (1) + BEFORE (2) + INSERT (4); fără UPDATE OF col, fără WHEN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_ai_inbox_fisier_imutabil'
                 AND t.tgrelid = 'public.ai_documente_inbox'::regclass AND t.tgfoid = v_fn AND NOT t.tgisinternal
                 AND t.tgtype = 19 AND t.tgenabled <> 'D' AND t.tgqual IS NULL AND cardinality(t.tgattr::int2[]) = 0)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_ai_inbox_fisier_legat'
                 AND t.tgrelid = 'public.ai_documente_inbox'::regclass AND t.tgfoid = v_fl AND NOT t.tgisinternal
                 AND t.tgtype = 7 AND t.tgenabled <> 'D' AND t.tgqual IS NULL AND cardinality(t.tgattr::int2[]) = 0) THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261103c: trigger-ele trg_ai_inbox_fisier_imutabil / trg_ai_inbox_fisier_legat lipsesc / dezactivate / altă definiție';
  END IF;
  IF (SELECT b.public FROM storage.buckets b WHERE b.id = 'ai-documente-inbox') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261103c: bucket-ul ai-documente-inbox nu mai e privat';
  END IF;
  PERFORM set_config('gazpet.c20261103c_alte_politici', '', true);
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261103c_ai_inbox_storage_politici:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261103c: garda de livrare (final) — marcajul s-a pierdut în timpul migrării; se anulează tot';
  END IF;
END $livrare_final$;
