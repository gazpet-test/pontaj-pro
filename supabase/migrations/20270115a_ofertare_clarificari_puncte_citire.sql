-- Version 20270115120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20270115a_ofertare_clarificari_puncte_citire.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte”
--   al runnerului în aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA). Manifestul .l15.tsv îl generează coordonatorul pe
--   clonă (scripts/livrare_l15_manifest.sh --iesire, docs/LIVRARE_L15_V2.md §5); lista OBIECTELOR revizuită (generată pe PGlite cu pașii reali
--   ai runnerului): supabase/tests/20270115a_ofertare_clarificari_puncte_citire.l15.obiecte.tsv. Dry-run pe clonă după aplicare (ROLLBACK):
--   supabase/tests/20270115a_ofertare_clarificari_puncte_citire_dryrun.sql.
-- Numerotare: 20270114a e DEJA APLICATĂ pe producție de altă lucrare (20270114a_izometrie_buletine_ndt — tabele / funcții izometrie și storage NDT,
--   niciun obiect comun cu aceasta); migrarea de aici a fost renumerotată 20270115a (decizia coordonatorului, 27.11.2026). Ordinea față de
--   producție: după 20270113a (ofertare_clarificari, APLICATĂ) și 20270114a (izometrie, APLICATĂ).
-- 20270115a_ofertare_clarificari_puncte_citire — Ofertare: punctele unei clarificări (public.ofertare_clarificari_puncte) se citesc și se scriu
--   DOAR de ownerul și de responsabilii licitației clarificării (decizia owner-ului, 27.11.2026, după review-ul PR #1204), iar ADRESA de
--   clarificări (RPC ofertare_clarificari_export) se exportă doar cu aceeași poartă și întoarce în același răspuns temeiurile de pe puncte
--   (varianta B, decizia owner-ului 27.11.2026 seara, după review-ul #1210 r3). Azi: clar_puncte_sel (SELECT) = USING (auth.uid() IS NOT NULL) —
--   ORICE cont logat citește punctele; clar_puncte_rw (ALL, deci și SELECT, politicile permisive se combină cu OR) = fn_are_acces_ofertare() —
--   oricine cu modulul Ofertare le scrie și le citește; exportul adresei cere modul + drept de decizie și întoarce DOAR întrebările, UI-ul citind
--   temeiurile separat (prin join cu punctele — după restrângerea punctelor, join-ul ar fi întors 0 rânduri pentru un cont fără poartă și adresa
--   ar fi ieșit FĂRĂ temeiurile de pe puncte, părând completă: review #1210 r3, cele două P1).
-- Ce face (patru funcții noi + o funcție existentă rescrisă + un trigger pe părinte + două politici schimbate, nimic altceva):
--   1. fn_ofertare_clar_are_puncte(p_clarificare_id) — sql VOLATILE SECURITY DEFINER: clarificarea are puncte (DEFINER ca să vadă punctele indiferent
--      de RLS-ul apelantului; întoarce doar un boolean; VOLATILE ca să citească cu un instantaneu PROASPĂT, după ce triggerul a așteptat lock-ul
--      rândului — vezi 4). Folosită de garda părintelui la ștergere.
--   2. fn_ofertare_lic_puncte_poarta(p_licitatie_id) — sql STABLE SECURITY DEFINER, cale sigură: UN SINGUR predicat (L19) pentru poarta punctelor
--      pe o licitație: utilizatorul CURENT (auth.uid(), L08: niciodată un parametru) are acces la modulul Ofertare (fn_are_acces_ofertare(), ca azi)
--      ȘI trece poarta pe cheltuială a licitației (fn_ofertare_poate_cheltui(p_licitatie_id, auth.uid()), 20261124a: owner; responsabil 1 / 2 numit
--      de owner / de un admin Ofertare — aceeași poartă ca la orice procesare plătită din Ofertare). DEFINER fiindcă fn_ofertare_poate_cheltui are
--      EXECUTE doar pentru service_role (întoarce DOAR un boolean). EXECUTE: authenticated + service_role; nimic pentru PUBLIC / anon. Folosită de
--      3 (pe licitația clarificării) și de exportul adresei (5).
--   3. fn_ofertare_clar_puncte_poarta(p_clarificare_id) — sql STABLE SECURITY DEFINER: poarta de la 2 pe licitația clarificării (licitația
--      clarificării se citește indiferent de RLS-ul apelantului; clarificare inexistentă = false). Predicatul politicilor RLS pe puncte și al gărzii
--      părintelui. EXECUTE: authenticated + service_role.
--   4. fn_ofertare_clar_parinte_puncte_garda() — plpgsql SECURITY INVOKER (ca să deosebească apelantul prin current_user; review Jakarinos r1 P1 #1 / #2):
--      pe PĂRINTE (ofertare_clarificari), BEFORE UPDATE OF licitatie_id OR DELETE, FOR EACH ROW. Doar pentru apelurile clientului (current_user
--      authenticated / anon): (a) mutarea unei clarificări pe altă licitație e refuzată ÎNTOTDEAUNA (cu sau fără puncte — review r2 P1: „fără puncte”
--      ar fi o cursă cu inserarea concurentă a primului punct, UPDATE-ul lui licitatie_id ia doar NO KEY UPDATE și nu așteaptă KEY SHARE-ul FK-ului;
--      mutarea nu e flux din aplicație; serverul o poate face); (b) ștergerea unei clarificări CU puncte (cascada ar șterge punctele) e permisă doar
--      cui trece poarta punctelor; fără puncte, ca azi. Serializarea ștergerii: PostgreSQL blochează rândul (GetTupleForTrigger) ÎNAINTE de a chema
--      triggerul BEFORE ROW, iar inserarea unui punct ține KEY SHARE pe părinte prin FK → DELETE-ul așteaptă inserarea necomisă, apoi are_puncte
--      (VOLATILE, instantaneu nou) vede punctul comis și refuză; invers, inserarea punctului așteaptă DELETE-ul necomis și pică pe FK (23503) — nu
--      rămâne niciun punct orfan și niciunul șters pe la spate. Proba cu două sesiuni: supabase/tests/20270115a_…_concurenta.sh (clonă dispensabilă).
--      service_role / postgres / RPC-urile DEFINER trec (nu sunt persoane; porțile lor sunt în edge / RPC).
--   5. ofertare_clarificari_export(p_licitatie_id) — RESCRISĂ (CREATE OR REPLACE, corpul de azi verificat pe amprentă în $pre$: cel din 20270112a,
--      aplicată 26.11.2026, citit din producție 27.11.2026): păstrează cele două gărzi de azi (modul Ofertare, drept de decizie
--      fn_ofertare_source_pack_poate_decide), adaugă poarta punctelor (2) — altfel 42501 cu mesaj clar — și întoarce în ACELAȘI răspuns
--      {"clarificari": [...întrebările „de_trimis”, ca azi...], "temeiuri": [...temeiurile bifate „include în adresă” și confirmate, de pe întrebările
--      exportate ȘI de pe punctele lor, cu decizia CNSC (id, nr_decizie, buletin_oficial, data, link_sursa, control_judiciar, verificat)...]}.
--      Devine SECURITY DEFINER (cale sigură, nume calificate): citirile din corp nu mai depind de RLS-ul apelantului, deci niciun rând de temei nu
--      poate lipsi dintr-un răspuns reușit (revocarea dreptului în timpul apelului = ori refuz la poartă, ori răspuns complet; review r3 P1 #2).
--      DEFINER nu lărgește nimic: fiecare tabel citit (clarificări, puncte, temeiuri, cnsc_decizii) are politica de SELECT implicată de porțile
--      verificate în corp (modul Ofertare; poarta punctelor; cont logat). Răspunsul NU mai e un tablou: UI-ul vechi (verifică Array.isArray) refuză
--      exportul cu „verificare indisponibilă” în loc să scoată o adresă fără temeiurile de pe puncte (review r3 P1 #1: fila veche deschisă peste
--      momentul migrării). Drepturile (EXECUTE authenticated + service_role + proprietar) rămân EXACT cele de azi (CREATE OR REPLACE le păstrează).
--   6. CREATE TRIGGER trg_ofertare_clar_parinte_puncte pe public.ofertare_clarificari.
--   7. ALTER POLICY clar_puncte_sel USING (public.fn_ofertare_clar_puncte_poarta(clarificare_id));
--   8. ALTER POLICY clar_puncte_rw USING (…aceeași…) WITH CHECK (…aceeași…) — rw e ALL și include SELECT: fără pasul 8 restrângerea de la 7 n-ar
--      avea efect (OR între politici). Un singur predicat pentru citire, scriere și export (L19).
--   Ce poate face, după migrare, un cont cu acces Ofertare care NU e owner / responsabil al licitației: NU citește punctele, NU scrie puncte
--   (INSERT = 42501, UPDATE / DELETE ating 0 rânduri), NU șterge o clarificare care are puncte (42501), NU exportă adresa (42501, chiar dacă e admin
--   Ofertare cu drept de decizie); clarificările fără puncte le editează / șterge ca azi. NIMENI din aplicație (nici owner-ul, nici responsabilul) nu
--   mai mută o clarificare pe altă licitație (42501; nu există flux UI pentru asta; serverul poate). Owner-ul vede, scrie și exportă tot (poarta e
--   adevărată pentru orice licitație). Responsabilul 2 trece poarta punctelor, dar NU are drept de decizie (fn_ofertare_source_pack_poate_decide
--   verifică doar responsabil_id) → nu exportă adresa, ca azi (neschimbat aici; punct deschis pentru owner).
-- Ce NU face: nu creează / nu șterge tabele, politici sau drepturi pe tabele, nu atinge triggerele existente, funcțiile existente în afara
--   exportului (fn_are_acces_ofertare, fn_ofertare_poate_cheltui, fn_ofertare_source_pack_poate_decide, fn_ofertare_ciorna_auto_stare,
--   fn_clar_punct_semneaza), politicile părintelui (20270113a), ale temeiurilor (20261014b) sau ale deciziilor CNSC (20261007a), nicio dată; nu dă
--   acces la Ofertare nimănui. Temeiurile de pe întrebări (fără puncte) rămân citibile cu modulul, ca azi.
-- Starea de pornire (L14, sub lock): politicile tabelului de puncte sunt EXACT cele 2 de azi (nume, comandă, PERMISSIVE, rolul authenticated, USING /
--   WITH CHECK deparsate — forma din 20260928l / brief-ul coordonatorului, 27.11.2026; altă formă = refuz, coordonatorul dă textul exact din pg_policies),
--   RLS activ și neforțat pe puncte, FK-ul clarificare_id → ofertare_clarificari(id) există, ofertare_clarificari.licitatie_id există, cele 4 funcții noi
--   și triggerul nou NU există (reaplicare = refuz, fără supraîncărcări), fn_are_acces_ofertare și fn_ofertare_poate_cheltui au corpul / DEFINER /
--   calea / proprietarul / drepturile din 20260912 respectiv 20261124a, ofertare_clarificari_export are corpul de azi (md5 328b25f3431c5fc51a016d5ef359e453,
--   plpgsql, SECURITY INVOKER, cale sigură, proprietar postgres, EXECUTE exact authenticated + service_role + proprietar, unică), funcțiile pe care le
--   cheamă (fn_ofertare_source_pack_poate_decide — DEFINER, EXECUTE authenticated; fn_ofertare_ciorna_auto_stare) există, tabelele citite de export
--   (ofertare_clarificari_temeiuri, cnsc_decizii) au coloanele folosite; altceva = refuz, nimic schimbat.
-- Lock-uri (L06), în ordinea: (1) ACCESS EXCLUSIVE NOWAIT pe public.ofertare_clarificari_puncte (ALTER POLICY), bugetul 1 s de la prima încercare
--   (blocul $lock$); (2) apoi SHARE ROW EXCLUSIVE NOWAIT pe public.ofertare_clarificari (CREATE TRIGGER; ocupat = 55P03 imediat, nimic schimbat),
--   ÎNAINTEA verificărilor de stare (L14). CREATE [OR REPLACE] FUNCTION nu blochează tabele (un apel al exportului în curs vede vechea definiție până la
--   COMMIT). Nimic altceva blocat.
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), bugetul de lock 1 s, lock_timeout 100 ms
--   (lock-urile implicite), garda finală a runnerului (PLAFON_TIMP + LOCK_TINUT). Sub lock nu se numără rânduri (nimic de scanat).
-- Ordinea livrării: ambele ordini sunt sigure (nicio adresă nu poate ieși fără temeiurile de pe puncte): UI-ul nou refuză exportul cât răspunsul
--   e tabloul vechi („migrarea 20270115a nu e aplicată”), UI-ul vechi refuză răspunsul nou („verificare indisponibilă”). Recomandat: UI-ul ÎNTÂI
--   (merge + Vercel), APOI migrarea, cât mai aproape de deploy (mesajul util e cel al UI-ului nou); Ctrl+Shift+R după deploy, regula casei.
--   Independentă de 20270114a (izometrie, APLICATĂ) și compatibilă cu 20270113a (APLICATĂ 27.11.2026 — proba PGlite rulează cu 20270113a aplicată și
--   fără ea).
-- Revenire: supabase/revenire/20270115a_ofertare_clarificari_puncte_citire_ROLLBACK.sql (readuce cele 2 politici EXACT, readuce exportul la corpul
--   de azi — SECURITY INVOKER, drepturi neschimbate —, apoi șterge triggerul și cele 4 funcții; refuză dacă starea nu e cea pusă aici sau dacă altceva
--   depinde de funcții). Revenirea REDESCHIDE citirea punctelor pentru orice cont logat și exportul fără poarta punctelor: doar la cererea explicită
--   a owner-ului.
-- Probe: scripts/pglite/test_ofertare_clarificari_puncte_citire_local.mjs (scheletul 20270112a + supabase/tests/20270115a_…_schelet.sql, pașii
--   L15 v2 reali; cazuri de acces pe owner / responsabil 1 / responsabil 2 / autonumit / editor / admin Ofertare / responsabil fără modul / sub-modul /
--   fără modul / anon, scrieri, mutarea / ștergerea părintelui, exportul (poartă, temeiuri de pe puncte, forma răspunsului), refuzuri, revenire,
--   mutanți).
DO $pre$
DECLARE v_plafon text; v_alt text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270115a_ofertare_clarificari_puncte_citire:' || txid_current() THEN
    RAISE EXCEPTION '20270115a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270115a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270115a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270115a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20270115a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tiparul 20270111a / 20270112a / 20270113a)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20270115a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.ofertare_clarificari_puncte') IS NULL OR (SELECT relkind FROM pg_class WHERE oid = 'public.ofertare_clarificari_puncte'::regclass) <> 'r' THEN
    RAISE EXCEPTION '20270115a: lipseste tabelul public.ofertare_clarificari_puncte';
  END IF;
  IF to_regclass('public.ofertare_clarificari') IS NULL OR (SELECT relkind FROM pg_class WHERE oid = 'public.ofertare_clarificari'::regclass) <> 'r'
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.ofertare_clarificari'::regclass AND a.attname = 'licitatie_id' AND NOT a.attisdropped AND a.atttypid = 'bigint'::regtype) THEN
    RAISE EXCEPTION '20270115a: lipseste public.ofertare_clarificari.licitatie_id (bigint) — poarta si garda parintelui o citesc';
  END IF;
  -- FK-ul clarificare_id → ofertare_clarificari(id): legatura pe care se da poarta
  IF NOT EXISTS (SELECT 1 FROM pg_constraint k
                  WHERE k.conrelid = 'public.ofertare_clarificari_puncte'::regclass AND k.contype = 'f' AND k.confrelid = 'public.ofertare_clarificari'::regclass
                    AND k.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = k.conrelid AND a.attname = 'clarificare_id' AND NOT a.attisdropped)]
                    AND k.confkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = k.confrelid AND a.attname = 'id' AND NOT a.attisdropped)]) THEN
    RAISE EXCEPTION '20270115a: lipseste FK-ul ofertare_clarificari_puncte.clarificare_id -> ofertare_clarificari(id)';
  END IF;
  -- tabelele citite de exportul rescris: temeiurile (20261014b) cu coloanele folosite si deciziile CNSC (20261007a) cu coloanele intoarse (nume + tip)
  IF to_regclass('public.ofertare_clarificari_temeiuri') IS NULL OR to_regclass('public.cnsc_decizii') IS NULL
     OR (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.ofertare_clarificari_temeiuri'::regclass AND NOT a.attisdropped
           AND (a.attname::text, a.atttypid) IN (('id', 'bigint'::regtype), ('clarificare_id', 'bigint'::regtype), ('punct_id', 'bigint'::regtype), ('cnsc_decizie_id', 'text'::regtype),
                                                 ('citat_idx', 'integer'::regtype), ('citat_text', 'text'::regtype), ('citat_loc', 'text'::regtype),
                                                 ('include_in_adresa', 'boolean'::regtype), ('confirmat', 'boolean'::regtype))) <> 9
     OR (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.cnsc_decizii'::regclass AND NOT a.attisdropped
           AND (a.attname::text, a.atttypid) IN (('id', 'text'::regtype), ('nr_decizie', 'text'::regtype), ('buletin_oficial', 'text'::regtype), ('data', 'date'::regtype),
                                                 ('link_sursa', 'text'::regtype), ('control_judiciar', 'jsonb'::regtype), ('verificat', 'boolean'::regtype))) <> 7 THEN
    RAISE EXCEPTION '20270115a: lipsesc public.ofertare_clarificari_temeiuri (id, clarificare_id, punct_id, cnsc_decizie_id, citat_idx, citat_text, citat_loc, include_in_adresa, confirmat) sau public.cnsc_decizii (id, nr_decizie, buletin_oficial, data, link_sursa, control_judiciar, verificat) — exportul le citeste';
  END IF;
  -- reaplicare / coliziune de nume: functiile noi si triggerul nou nu exista inca (nicio supraincarcare)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
               AND p.proname IN ('fn_ofertare_clar_puncte_poarta', 'fn_ofertare_lic_puncte_poarta', 'fn_ofertare_clar_are_puncte', 'fn_ofertare_clar_parinte_puncte_garda')) THEN
    RAISE EXCEPTION '20270115a: una din functiile fn_ofertare_clar_puncte_poarta / fn_ofertare_lic_puncte_poarta / fn_ofertare_clar_are_puncte / fn_ofertare_clar_parinte_puncte_garda exista deja (reaplicare sau coliziune de nume)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.ofertare_clarificari'::regclass AND t.tgname = 'trg_ofertare_clar_parinte_puncte') THEN
    RAISE EXCEPTION '20270115a: triggerul trg_ofertare_clar_parinte_puncte exista deja';
  END IF;
  -- dependenta 1: fn_are_acces_ofertare() din 20260912, neschimbata (corp fara CR, limbaj sql, DEFINER, STABLE, cale sigura, proprietar postgres,
  --   drepturi EXACTE: authenticated + service_role + proprietar, nimic pentru anon / PUBLIC) — aceleasi conditii ca in 20270113a
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_are_acces_ofertare()')
                   AND md5(replace(p.prosrc, chr(13), '')) = '429d28e2a61fb24c8009d67050c16c85' AND l.lanname = 'sql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'boolean'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_are_acces_ofertare') <> 1 THEN
    RAISE EXCEPTION '20270115a: fn_are_acces_ofertare() nu e cea din 20260912 (corp md5 429d28e2a61fb24c8009d67050c16c85, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari); coordonatorul da textul exact (pg_get_functiondef)';
  END IF;
  -- dependenta 2: fn_ofertare_poate_cheltui(bigint, uuid) din 20261124a, neschimbata (corp fara CR, sql, DEFINER, STABLE, cale sigura, proprietar
  --   postgres, drepturi EXACTE: doar service_role + proprietar — de aceea poarta trece prin functia noua DEFINER, nu o cheama direct)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_ofertare_poate_cheltui(bigint, uuid)')
                   AND md5(replace(p.prosrc, chr(13), '')) = '07fba9e2e4249481fa9184fc48abc58d' AND l.lanname = 'sql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'boolean'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_ofertare_poate_cheltui') <> 1 THEN
    RAISE EXCEPTION '20270115a: fn_ofertare_poate_cheltui(bigint, uuid) nu e cea din 20261124a (corp md5 07fba9e2e4249481fa9184fc48abc58d, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari); coordonatorul da textul exact (pg_get_functiondef)';
  END IF;
  -- dependenta 3: exportul de azi — corpul din 20270112a (aplicata 26.11.2026; citit din productie 27.11.2026), plpgsql, SECURITY INVOKER, VOLATILE,
  --   jsonb, cale sigura, proprietar postgres, drepturi EXACTE (authenticated + service_role + proprietar), unic. Alt corp = refuz: cineva l-a schimbat
  --   intre timp, iar revenirea trebuie sa readuca EXACT textul de azi; coordonatorul da textul exact (pg_get_functiondef).
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.ofertare_clarificari_export(bigint)')
                   AND md5(replace(p.prosrc, chr(13), '')) = '328b25f3431c5fc51a016d5ef359e453' AND l.lanname = 'plpgsql' AND p.prokind = 'f'
                   AND NOT p.prosecdef AND p.provolatile = 'v' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'jsonb'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ofertare_clarificari_export') <> 1 THEN
    RAISE EXCEPTION '20270115a: ofertare_clarificari_export(bigint) nu e cea de azi (corp md5 328b25f3431c5fc51a016d5ef359e453 din 20270112a, plpgsql VOLATILE INVOKER, cale, proprietar, drepturi exacte sau supraincarcari); coordonatorul da textul exact (pg_get_functiondef)';
  END IF;
  -- dependenta 4: functiile pe care exportul le cheama in corp (neschimbate aici; fotografiate in $stare$): dreptul de decizie (DEFINER, EXECUTE
  --   authenticated) si dispecerul ciornelor automate (20270112a)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ofertare_source_pack_poate_decide(bigint)') AND p.prosecdef
                   AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND pg_get_function_result(p.oid) = 'boolean')
     OR to_regprocedure('public.fn_ofertare_ciorna_auto_stare(public.ofertare_clarificari, text)') IS NULL THEN
    RAISE EXCEPTION '20270115a: lipsesc fn_ofertare_source_pack_poate_decide(bigint) (DEFINER, EXECUTE authenticated) sau fn_ofertare_ciorna_auto_stare(ofertare_clarificari, text) — exportul le cheama';
  END IF;
  -- informativ (nu refuz, in afara perimetrului): vederi peste tabelul de puncte FARA security_invoker ar citi ca proprietarul lor, ocolind politicile
  SELECT string_agg(DISTINCT v.oid::regclass::text, ', ' ORDER BY v.oid::regclass::text) INTO v_alt
    FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
    JOIN pg_class v ON v.oid = rw.ev_class AND v.relkind IN ('v', 'm')
   WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.ofertare_clarificari_puncte'::regclass
     AND v.oid <> 'public.ofertare_clarificari_puncte'::regclass
     AND NOT ('security_invoker=on' = ANY (coalesce(v.reloptions, ARRAY[]::text[])));
  IF v_alt IS NOT NULL THEN
    RAISE NOTICE '20270115a: ATENTIE, vederi peste ofertare_clarificari_puncte fara security_invoker (citesc ca proprietarul, in afara acestei migrari): %', v_alt;
  END IF;
END $pre$;

-- ─── 0. Lock-urile, ÎNAINTEA verificărilor de stare (L14): (1) punctele, NOWAIT, bugetul 1 s de la PRIMA încercare (șablonul 20270111a);
--     (2) părintele, SHARE ROW EXCLUSIVE NOWAIT (CREATE TRIGGER); ocupat = 55P03, nimic schimbat. Momentul în gazpet.lock_puternic_la (LOCK_TINUT). ─
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20270115a: BUGET_LOCK: ofertare_clarificari_puncte ocupat; % incercari, % ms de la prima incercare (bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.ofertare_clarificari_puncte IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20270115a: BUGET_LOCK: lock-ul pe ofertare_clarificari_puncte obtinut abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  -- parintele, ULTIMUL si NOWAIT (ocupat = 55P03 imediat; tranzactia cade, nimic scris)
  BEGIN
    LOCK TABLE public.ofertare_clarificari IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION '20270115a: BUGET_LOCK: ofertare_clarificari (parintele) ocupat la % ms de la BEGIN; nimic schimbat', round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
  END;
  RAISE NOTICE '20270115a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── 1. Starea EXACTĂ de azi (sub lock): cele 2 politici (forma din 20260928l / brief 27.11.2026), RLS activ neforțat; fotografia a tot ce NU
--     se schimbă (drepturile tabelelor atinse / citite, triggerele punctelor și ale părintelui, funcțiile existente neatinse, politicile părintelui,
--     ale temeiurilor și ale deciziilor CNSC, RLS) ───────────────────────────────────────────────────────────────────────────────────────────
DO $stare$
DECLARE v_rau text;
BEGIN
  SELECT string_agg(coalesce(a.nume, '+' || c.nume) || coalesce(': ' || c.detaliu, ''), '; ' ORDER BY coalesce(a.nume, c.nume)) INTO v_rau
    FROM (VALUES
      -- >>> POLITICI PUNCTE 27.11.2026
      ('clar_puncte_sel', 'r|permisiva|{authenticated}|(auth.uid() IS NOT NULL)|-'),
      ('clar_puncte_rw', '*|permisiva|{authenticated}|( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)|( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)')
      -- <<< POLITICI PUNCTE 27.11.2026
    ) a(nume, detaliu)
    FULL JOIN (SELECT p.polname::text AS nume,
                      p.polcmd::text || '|' || CASE WHEN p.polpermissive THEN 'permisiva' ELSE 'restrictiva' END || '|'
                        || coalesce((SELECT '{' || string_agg(CASE WHEN ro = 0 THEN 'PUBLIC' ELSE ro::regrole::text END, ',' ORDER BY ro::regrole::text) || '}' FROM unnest(p.polroles) ro), '{}')
                        || '|' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-') AS detaliu
                 FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass) c ON c.nume = a.nume
   WHERE a.nume IS NULL OR c.nume IS NULL OR a.detaliu IS DISTINCT FROM c.detaliu;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270115a: politicile ofertare_clarificari_puncte difera de cele de azi (27.11.2026): %', v_rau; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity) THEN
    RAISE EXCEPTION '20270115a: RLS pe ofertare_clarificari_puncte nu e activ (sau e fortat)';
  END IF;
  CREATE TEMP TABLE cp_foto ON COMMIT DROP AS
    -- >>> FOTOGRAFIE 20270115a
    SELECT 'acl_tabel' AS ce, coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass) a), '(nimic)') AS val
    UNION ALL
    SELECT 'acl_parinte', coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari'::regclass) a), '(nimic)')
    UNION ALL
    SELECT 'acl_temeiuri', coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari_temeiuri'::regclass) a), '(nimic)')
    UNION ALL
    SELECT 'acl_cnsc', coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.cnsc_decizii'::regclass) a), '(nimic)')
    UNION ALL
    SELECT 'triggere', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                   FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari_puncte'::regclass AND NOT tg.tgisinternal), '(niciunul)')
    UNION ALL
    -- triggerele parintelui de azi (fara cel nou): dupa migrare, lista fara trg_ofertare_clar_parinte_puncte trebuie sa fie identica
    SELECT 'triggere_parinte', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                           FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari'::regclass AND NOT tg.tgisinternal AND tg.tgname <> 'trg_ofertare_clar_parinte_puncte'), '(niciunul)')
    UNION ALL
    SELECT 'politici_parinte', coalesce((SELECT string_agg(p.polname::text || '=' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ', ' ORDER BY p.polname::text)
                                           FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass), '(niciuna)')
    UNION ALL
    SELECT 'politici_temeiuri', coalesce((SELECT string_agg(p.polname::text || '=' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ', ' ORDER BY p.polname::text)
                                            FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_temeiuri'::regclass), '(niciuna)')
    UNION ALL
    SELECT 'politici_cnsc', coalesce((SELECT string_agg(p.polname::text || '=' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ', ' ORDER BY p.polname::text)
                                        FROM pg_policy p WHERE p.polrelid = 'public.cnsc_decizii'::regclass), '(niciuna)')
    UNION ALL
    SELECT 'functie_acces', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                               FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_are_acces_ofertare()'))
    UNION ALL
    SELECT 'functie_cheltuiala', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                                    FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ofertare_poate_cheltui(bigint, uuid)'))
    UNION ALL
    SELECT 'functie_decide', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ';'), '-')
                                FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ofertare_source_pack_poate_decide(bigint)'))
    UNION ALL
    SELECT 'functie_auto_stare', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ';'), '-')
                                    FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ofertare_ciorna_auto_stare(public.ofertare_clarificari, text)'))
    UNION ALL
    SELECT 'functie_trigger', coalesce((SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                                          FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_clar_punct_semneaza()')), '(lipsa)')
    UNION ALL
    SELECT 'rls', (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass)
      || '|' || (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari'::regclass)
      || '|' || (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari_temeiuri'::regclass)
      || '|' || (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.cnsc_decizii'::regclass)
    UNION ALL
    SELECT 'politici_nr', (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass)
      || '|' || (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass)
      || '|' || (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_temeiuri'::regclass)
      || '|' || (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.cnsc_decizii'::regclass);
    -- <<< FOTOGRAFIE 20270115a
  RAISE NOTICE '20270115a: stare verificata (2 politici pe puncte, RLS activ, exportul de azi, parintele / temeiurile / deciziile fotografiate)';
END $stare$;

-- ─── 2. Schimbarea: trei functii DEFINER (are puncte / poarta pe licitatie / poarta pe clarificare), garda INVOKER pe parinte + triggerul ei,
--     exportul rescris (DEFINER, poarta, temeiurile in raspuns), cele 2 politici pe poarta ─────────────────────────────────────────────────
CREATE FUNCTION public.fn_ofertare_clar_are_puncte(p_clarificare_id bigint)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.ofertare_clarificari_puncte p WHERE p.clarificare_id = p_clarificare_id);
$fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_clar_are_puncte(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_clar_are_puncte(bigint) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_ofertare_clar_are_puncte(bigint) IS
  '20270115a: clarificarea are puncte (indiferent de RLS-ul apelantului; doar un boolean). Folosita de garda parintelui fn_ofertare_clar_parinte_puncte_garda.';

CREATE FUNCTION public.fn_ofertare_lic_puncte_poarta(p_licitatie_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT auth.uid() IS NOT NULL
     AND public.fn_are_acces_ofertare()
     AND public.fn_ofertare_poate_cheltui(p_licitatie_id, auth.uid());
$fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_lic_puncte_poarta(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_lic_puncte_poarta(bigint) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_ofertare_lic_puncte_poarta(bigint) IS
  '20270115a: poarta punctelor pe o licitatie (un singur predicat: RLS pe ofertare_clarificari_puncte prin fn_ofertare_clar_puncte_poarta; exportul adresei ofertare_clarificari_export) — utilizatorul curent are acces la modulul Ofertare SI e owner / responsabil 1-2 al licitatiei numit de owner / de un admin Ofertare (fn_ofertare_poate_cheltui, 20261124a).';

CREATE FUNCTION public.fn_ofertare_clar_puncte_poarta(p_clarificare_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT coalesce((SELECT public.fn_ofertare_lic_puncte_poarta(c.licitatie_id) FROM public.ofertare_clarificari c WHERE c.id = p_clarificare_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_clar_puncte_poarta(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_clar_puncte_poarta(bigint) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_ofertare_clar_puncte_poarta(bigint) IS
  '20270115a: poarta punctelor unei clarificari (RLS pe ofertare_clarificari_puncte, citire si scriere; garda parintelui) = fn_ofertare_lic_puncte_poarta pe licitatia clarificarii. Clarificare inexistenta = false.';

-- INVOKER: current_user deosebeste apelul clientului (authenticated / anon) de service_role / postgres / RPC-urile DEFINER (acolo current_user e
-- proprietarul); existenta punctelor si poarta vin din cele doua functii DEFINER (boolean, indiferent de RLS). Fara parametri de identitate.
CREATE FUNCTION public.fn_ofertare_clar_parinte_puncte_garda()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.licitatie_id IS DISTINCT FROM OLD.licitatie_id THEN
      RAISE EXCEPTION 'O clarificare nu se muta pe alta licitatie din aplicatie (punctele ei si-ar schimba poarta).' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT public.fn_ofertare_clar_are_puncte(OLD.id) THEN RETURN OLD; END IF;
  IF NOT coalesce(public.fn_ofertare_clar_puncte_poarta(OLD.id), false) THEN
    RAISE EXCEPTION 'Clarificarea are puncte: o sterge doar ownerul sau un responsabil al licitatiei (stergerea ar sterge si punctele).' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END
$fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_clar_parinte_puncte_garda() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.fn_ofertare_clar_parinte_puncte_garda() IS
  '20270115a: garda parintelui (BEFORE UPDATE OF licitatie_id OR DELETE pe ofertare_clarificari): pentru apelurile clientului, o clarificare cu puncte nu se muta pe alta licitatie si se sterge doar de cine trece poarta punctelor (cascada ar sterge punctele). service_role / postgres / RPC-urile DEFINER trec.';
CREATE TRIGGER trg_ofertare_clar_parinte_puncte BEFORE UPDATE OF licitatie_id OR DELETE ON public.ofertare_clarificari
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_clar_parinte_puncte_garda();

-- Exportul adresei: textul de azi (20270112a 9e) + poarta punctelor (42501) + temeiurile in acelasi raspuns. SECURITY DEFINER (cale sigura, nume
-- calificate; identitatea DOAR din auth.uid()): citirile nu depind de RLS-ul apelantului, deci raspunsul e ori refuzat la poarta, ori COMPLET. Nu
-- largeste nimic: fiecare tabel citit are politica de SELECT implicata de portile verificate aici (modul Ofertare → clarificari, temeiuri; poarta
-- punctelor → puncte; cont logat → cnsc_decizii). Drepturile EXECUTE raman cele de azi (CREATE OR REPLACE le pastreaza). Fara COMMENT (exportul nu
-- are comentariu azi; revenirea readuce definitia exact).
CREATE OR REPLACE FUNCTION public.ofertare_clarificari_export(p_licitatie_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE c public.ofertare_clarificari; v_st jsonb; v_out jsonb := '[]'::jsonb; v_tem jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RAISE EXCEPTION 'fără acces'; END IF;
  IF NOT coalesce(public.fn_ofertare_source_pack_poate_decide(p_licitatie_id),false) THEN RAISE EXCEPTION 'Export blocat: fără drept de decizie pe licitație'; END IF;
  -- 20270115a: poarta punctelor (owner / responsabil al licitatiei numit de owner / de un admin Ofertare): temeiurile de pe puncte ies doar cu ea
  IF NOT coalesce(public.fn_ofertare_lic_puncte_poarta(p_licitatie_id), false) THEN
    RAISE EXCEPTION 'Export blocat: adresa o genereaza doar ownerul sau un responsabil al licitatiei (temeiurile de pe punctele intrebarilor sunt vizibile doar lor)' USING ERRCODE = '42501';
  END IF;
  FOR c IN SELECT * FROM public.ofertare_clarificari WHERE licitatie_id=p_licitatie_id AND status='de_trimis' ORDER BY nr FOR SHARE LOOP
    IF coalesce(c.sursa,'') ~ '(^|,)revizie_' THEN RAISE EXCEPTION 'Clarificarea #% necesită revizie',c.nr; END IF;
    IF coalesce(c.cheie,'') ~ '^auto_(planse|surse)_' THEN
      v_st := public.fn_ofertare_ciorna_auto_stare(c,'tranzitie');
      IF coalesce(v_st->>'stare','') NOT IN ('ok','ok_identitate_limitata') THEN RAISE EXCEPTION 'Export blocat: %',v_st->>'text'; END IF;
    END IF;
    v_out := v_out || jsonb_build_array(to_jsonb(c));
  END LOOP;
  -- temeiurile bifate „include in adresa” si confirmate, de pe intrebarile exportate si de pe PUNCTELE lor, in ordinea id; fara filtru pe tipul
  -- temeiului (un tipar / o cerinta bifata trebuie sa BLOCHEZE exportul in UI — motivNeexportabil —, nu sa dispara); decizia CNSC cu campurile citarii
  SELECT coalesce(jsonb_agg(s.x ORDER BY s.id), '[]'::jsonb) INTO v_tem
    FROM (SELECT t.id,
                 jsonb_build_object('id', t.id, 'nr', q.nr, 'tinta', CASE WHEN t.punct_id IS NULL THEN 'intrebare' ELSE 'punct' END, 'punct_nr', p.nr,
                                    'citat_idx', t.citat_idx, 'citat_text', t.citat_text, 'citat_loc', t.citat_loc,
                                    'decizie', CASE WHEN d.id IS NULL THEN NULL
                                                    ELSE jsonb_build_object('id', d.id, 'nr_decizie', d.nr_decizie, 'buletin_oficial', d.buletin_oficial, 'data', d.data,
                                                                            'link_sursa', d.link_sursa, 'control_judiciar', d.control_judiciar, 'verificat', d.verificat) END) AS x
            FROM public.ofertare_clarificari_temeiuri t
            LEFT JOIN public.ofertare_clarificari_puncte p ON p.id = t.punct_id
            JOIN public.ofertare_clarificari q ON q.id = coalesce(t.clarificare_id, p.clarificare_id)
            LEFT JOIN public.cnsc_decizii d ON d.id = t.cnsc_decizie_id
           WHERE q.licitatie_id = p_licitatie_id AND q.status = 'de_trimis' AND t.include_in_adresa AND t.confirmat) s;
  RETURN jsonb_build_object('clarificari', v_out, 'temeiuri', v_tem);
END $function$;

ALTER POLICY clar_puncte_sel ON public.ofertare_clarificari_puncte USING (public.fn_ofertare_clar_puncte_poarta(clarificare_id));
ALTER POLICY clar_puncte_rw ON public.ofertare_clarificari_puncte USING (public.fn_ofertare_clar_puncte_poarta(clarificare_id)) WITH CHECK (public.fn_ofertare_clar_puncte_poarta(clarificare_id));

-- ─── 3. Postcondiții (exacte): cele 2 politici pe poarta noua, cele 4 functii noi + exportul rescris (corp, forma, drepturi), triggerul (forma exacta),
--     fotografia identica ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE v_rau text; v_attnum smallint;
BEGIN
  SELECT string_agg(coalesce(a.nume, '+' || c.nume) || coalesce(': ' || c.detaliu, ''), '; ' ORDER BY coalesce(a.nume, c.nume)) INTO v_rau
    FROM (VALUES
      -- >>> POLITICI PUNCTE 20270115a
      ('clar_puncte_sel', 'r|permisiva|{authenticated}|fn_ofertare_clar_puncte_poarta(clarificare_id)|-'),
      ('clar_puncte_rw', '*|permisiva|{authenticated}|fn_ofertare_clar_puncte_poarta(clarificare_id)|fn_ofertare_clar_puncte_poarta(clarificare_id)')
      -- <<< POLITICI PUNCTE 20270115a
    ) a(nume, detaliu)
    FULL JOIN (SELECT p.polname::text AS nume,
                      p.polcmd::text || '|' || CASE WHEN p.polpermissive THEN 'permisiva' ELSE 'restrictiva' END || '|'
                        || coalesce((SELECT '{' || string_agg(CASE WHEN ro = 0 THEN 'PUBLIC' ELSE ro::regrole::text END, ',' ORDER BY ro::regrole::text) || '}' FROM unnest(p.polroles) ro), '{}')
                        || '|' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-') AS detaliu
                 FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass) c ON c.nume = a.nume
   WHERE a.nume IS NULL OR c.nume IS NULL OR a.detaliu IS DISTINCT FROM c.detaliu;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270115a: postconditie: politicile ofertare_clarificari_puncte: %', v_rau; END IF;
  -- cele 4 functii noi + exportul rescris: corp EXACT (md5 fara CR), limbaj, DEFINER / INVOKER, volatilitate, cale sigura, proprietar postgres, drepturi EXACTE, unice
  -- >>> FUNCTII 20270115a
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_ofertare_clar_are_puncte(bigint)')
                   AND md5(replace(p.prosrc, chr(13), '')) = '2245a58f811059df647d9d7032595637' AND l.lanname = 'sql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'boolean'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_ofertare_clar_are_puncte') <> 1 THEN
    RAISE EXCEPTION '20270115a: postconditie: fn_ofertare_clar_are_puncte(bigint) nu are forma asteptata (corp md5 2245a58f811059df647d9d7032595637, sql VOLATILE DEFINER, cale, proprietar, drepturi exacte, unica)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_ofertare_lic_puncte_poarta(bigint)')
                   AND md5(replace(p.prosrc, chr(13), '')) = 'b9a6713cabd7a57f74184538ec92d2b2' AND l.lanname = 'sql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'boolean'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_ofertare_lic_puncte_poarta') <> 1 THEN
    RAISE EXCEPTION '20270115a: postconditie: fn_ofertare_lic_puncte_poarta(bigint) nu are forma asteptata (corp md5 b9a6713cabd7a57f74184538ec92d2b2, sql STABLE DEFINER, cale, proprietar, drepturi exacte, unica)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_ofertare_clar_puncte_poarta(bigint)')
                   AND md5(replace(p.prosrc, chr(13), '')) = '238e79d06ebded0cbe2def1577239459' AND l.lanname = 'sql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'boolean'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_ofertare_clar_puncte_poarta') <> 1 THEN
    RAISE EXCEPTION '20270115a: postconditie: fn_ofertare_clar_puncte_poarta(bigint) nu are forma asteptata (corp md5 238e79d06ebded0cbe2def1577239459, sql STABLE DEFINER, cale, proprietar, drepturi exacte, unica)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_ofertare_clar_parinte_puncte_garda()')
                   AND md5(replace(p.prosrc, chr(13), '')) = 'af05fe431f584442cea2351f4257427f' AND l.lanname = 'plpgsql' AND p.prokind = 'f'
                   AND NOT p.prosecdef AND p.provolatile = 'v' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'trigger'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'postgres:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_ofertare_clar_parinte_puncte_garda') <> 1 THEN
    RAISE EXCEPTION '20270115a: postconditie: fn_ofertare_clar_parinte_puncte_garda() nu are forma asteptata (corp md5 af05fe431f584442cea2351f4257427f, plpgsql VOLATILE INVOKER, cale, proprietar, doar proprietarul executa, unica)';
  END IF;
  -- exportul rescris: corpul nou, plpgsql, SECURITY DEFINER, VOLATILE, jsonb, cale sigura, proprietar postgres, drepturile EXACT cele de azi, unic
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.ofertare_clarificari_export(bigint)')
                   AND md5(replace(p.prosrc, chr(13), '')) = '590e69dbf14e0c6092fed04914069527' AND l.lanname = 'plpgsql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'jsonb'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ofertare_clarificari_export') <> 1 THEN
    RAISE EXCEPTION '20270115a: postconditie: ofertare_clarificari_export(bigint) nu are forma asteptata (corp md5 590e69dbf14e0c6092fed04914069527, plpgsql VOLATILE DEFINER, cale, proprietar, drepturile de azi exacte, unica)';
  END IF;
  -- <<< FUNCTII 20270115a
  -- triggerul: BEFORE (2) + ROW (1) + DELETE (8) + UPDATE (16) = 27, pe coloana licitatie_id, functia garda, fara conditie WHEN, fara argumente, activ (O)
  SELECT a.attnum INTO v_attnum FROM pg_attribute a WHERE a.attrelid = 'public.ofertare_clarificari'::regclass AND a.attname = 'licitatie_id' AND NOT a.attisdropped;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.ofertare_clarificari'::regclass AND t.tgname = 'trg_ofertare_clar_parinte_puncte'
                   AND t.tgfoid = to_regprocedure('public.fn_ofertare_clar_parinte_puncte_garda()') AND t.tgtype = 27 AND t.tgattr = v_attnum::text::int2vector
                   AND t.tgqual IS NULL AND t.tgnargs = 0 AND t.tgenabled = 'O' AND NOT t.tgisinternal)
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.ofertare_clarificari'::regclass AND t.tgname = 'trg_ofertare_clar_parinte_puncte') <> 1 THEN
    RAISE EXCEPTION '20270115a: postconditie: triggerul trg_ofertare_clar_parinte_puncte nu are forma asteptata (BEFORE UPDATE OF licitatie_id OR DELETE, FOR EACH ROW, garda, fara WHEN / argumente, activ)';
  END IF;
  -- fotografia: nimic altceva schimbat (drepturile tabelelor atinse / citite, triggerele punctelor, triggerele parintelui fara cel nou, politicile
  -- parintelui / temeiurilor / deciziilor, functiile existente neatinse, RLS, numarul politicilor)
  SELECT string_agg(f.ce || ' (era ' || f.val || ', acum ' || coalesce(n.val, 'LIPSA') || ')', '; ' ORDER BY f.ce) INTO v_rau
    FROM cp_foto f
    LEFT JOIN (
    -- >>> FOTOGRAFIE 20270115a
    SELECT 'acl_tabel' AS ce, coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass) a), '(nimic)') AS val
    UNION ALL
    SELECT 'acl_parinte', coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari'::regclass) a), '(nimic)')
    UNION ALL
    SELECT 'acl_temeiuri', coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari_temeiuri'::regclass) a), '(nimic)')
    UNION ALL
    SELECT 'acl_cnsc', coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.cnsc_decizii'::regclass) a), '(nimic)')
    UNION ALL
    SELECT 'triggere', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                   FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari_puncte'::regclass AND NOT tg.tgisinternal), '(niciunul)')
    UNION ALL
    -- triggerele parintelui de azi (fara cel nou): dupa migrare, lista fara trg_ofertare_clar_parinte_puncte trebuie sa fie identica
    SELECT 'triggere_parinte', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                           FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari'::regclass AND NOT tg.tgisinternal AND tg.tgname <> 'trg_ofertare_clar_parinte_puncte'), '(niciunul)')
    UNION ALL
    SELECT 'politici_parinte', coalesce((SELECT string_agg(p.polname::text || '=' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ', ' ORDER BY p.polname::text)
                                           FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass), '(niciuna)')
    UNION ALL
    SELECT 'politici_temeiuri', coalesce((SELECT string_agg(p.polname::text || '=' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ', ' ORDER BY p.polname::text)
                                            FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_temeiuri'::regclass), '(niciuna)')
    UNION ALL
    SELECT 'politici_cnsc', coalesce((SELECT string_agg(p.polname::text || '=' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ', ' ORDER BY p.polname::text)
                                        FROM pg_policy p WHERE p.polrelid = 'public.cnsc_decizii'::regclass), '(niciuna)')
    UNION ALL
    SELECT 'functie_acces', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                               FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_are_acces_ofertare()'))
    UNION ALL
    SELECT 'functie_cheltuiala', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                                    FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ofertare_poate_cheltui(bigint, uuid)'))
    UNION ALL
    SELECT 'functie_decide', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ';'), '-')
                                FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ofertare_source_pack_poate_decide(bigint)'))
    UNION ALL
    SELECT 'functie_auto_stare', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ';'), '-')
                                    FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ofertare_ciorna_auto_stare(public.ofertare_clarificari, text)'))
    UNION ALL
    SELECT 'functie_trigger', coalesce((SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                                          FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_clar_punct_semneaza()')), '(lipsa)')
    UNION ALL
    SELECT 'rls', (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass)
      || '|' || (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari'::regclass)
      || '|' || (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari_temeiuri'::regclass)
      || '|' || (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.cnsc_decizii'::regclass)
    UNION ALL
    SELECT 'politici_nr', (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass)
      || '|' || (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass)
      || '|' || (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_temeiuri'::regclass)
      || '|' || (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.cnsc_decizii'::regclass)
    -- <<< FOTOGRAFIE 20270115a
    ) n ON n.ce = f.ce
   WHERE n.val IS DISTINCT FROM f.val;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270115a: postconditie: s-a schimbat altceva decat cele 2 politici + functiile noi + exportul + triggerul: %', v_rau; END IF;
  IF (SELECT count(*) FROM cp_foto) <> 16 THEN RAISE EXCEPTION '20270115a: postconditie: fotografia incompleta'; END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270115a_ofertare_clarificari_puncte_citire:' || txid_current() THEN
    RAISE EXCEPTION '20270115a: garda final invalida';
  END IF;
  RAISE NOTICE '20270115a: sfarsit la % ms de la BEGIN, lock-uri puternice tinute de % ms', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;
