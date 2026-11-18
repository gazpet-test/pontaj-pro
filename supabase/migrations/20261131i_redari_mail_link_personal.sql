-- Version 20261131190000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20261131i_redari_mail_link_personal.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al runnerului în
--   aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA).
-- L15 (docs/LIVRARE_L15_V2.md): manifestul .l15.tsv îl generează coordonatorul pe clonă (scripts/livrare_l15_manifest.sh); lista OBIECTELOR pe care
--   trebuie să le conțină e în supabase/tests/20261131i_redari_mail_link_personal.l15.obiecte.tsv (scrisă și verificată pe PGlite cu pașii reali ai
--   runnerului: scripts/pglite/test_redari_mail_link_local.mjs). Migrarea verifică pe amprentă (corp + proprietăți + drepturi, ÎNAINTE și DUPĂ) cele patru
--   funcții pe care le înlocuiește și pe cele pe care le cheamă.
-- 20261131i_redari_mail_link_personal — Redări e-mail: LINKUL PERSONAL de răspuns (și câmpurile sesiunii) completate automat PE FIECARE MESAJ
--   (docs/redari/PLAN_EMAIL_REDARI.md, blocul „Deciziile lui Răzvan (18.11.2026)”, punctul „câmpurile textului”; docs/redari/MAIL_PROBA_PASI.md §5a).
--   Primul lot de probă (18.11.2026) a arătat că lotul are UN text pentru toți destinatarii și că platforma nu completează nimic per destinatar; modelul de
--   mail aprobat are câmpurile {COMUNA}, {ZILE}, {PROGRAM}, {TEL} și {LINK_RASPUNS} — linkul personal către formularul de răspuns, ACELAȘI ca în codul QR din
--   convocator (src/redari/docx.js linkRaspuns → https://redari.gazpet.ro/redari/raspuns/<token>; tokenul în red_detinatori_token, 20261126a).
--   DE CE ÎN BAZĂ, NU ÎN FUNCȚIA EDGE: aprobarea owner-ului fixează hash-ul lotului peste snapshoturile mesajelor (fn_red_mail_f2_mesaj_hash), iar
--   compunerea MIME refuză orice text diferit de snapshot (snapshot_diferit). O completare la trimitere ar însemna un text neacoperit de hash-ul aprobat
--   (L03 / L16) — de aceea completarea se face AICI, în fn_red_mail_lot_creeaza, în snapshotul fiecărui mesaj, înaintea hash-ului: owner-ul vede și aprobă
--   EXACT textul fiecărui destinatar (în ecran, cu linkul mascat), iar funcția edge rămâne neschimbată.
--   Ce face:
--   * red_mail_jurnal_f2: codul `campuri` intră în CHECK (jurnalul append-only al fiecărui lot creat cu câmpuri = urma L14 a acestei migrări);
--   * fn_red_link_raspuns(text): O SINGURĂ definiție SQL a linkului personal (paritate cu linkRaspuns din JS: src/redari/mailLinkPersonal.test.js);
--   * fn_red_mail_f2_token(uuid): tokenul VALID al deținătorului (deținător și parcelă neșterse, 43 de caractere base64url, neexpirat — ACELAȘI predicat ca
--     fn_red_formular_public / fn_red_raspuns_public, 20261126a) sau NULL — o singură definiție (L19) pentru inventar, creare, rezervare, autorizare;
--   * fn_red_mail_f2_campuri(uuid,uuid) (owner, RPC): valorile câmpurilor lotului din ACEEAȘI sursă ca convocatorul (red_uat.nume / sesiune_zi1..3 /
--     program_zi1..3, red_proiecte.contact_telefon); NULL = nu se poate deduce sigur (ecranul le arată, crearea refuză dacă textul le folosește);
--   * fn_red_mail_f2_completeaza(text,jsonb): înlocuirea {NUME} → valoare; orice „{…}” necunoscut = camp_necunoscut (22023), valoare lipsă =
--     camp_necompletabil (22023); după înlocuire NICIO acoladă nu mai are voie să rămână (oricât de lung ar fi numele, forme greșite ca „{ X }”, „{}”,
--     acolade neînchise) — altfel camp_necunoscut (r2, Jakarinos #1138 P2: limita de 40 de caractere a parserului lăsa să treacă numele mai lungi);
--   * fn_red_mail_f2_link_strain(text,text): „textul conține un link personal care nu e al deținătorului dat” — orice șir de exact 43 de caractere base64url
--     care fie stă într-un link de răspuns (…/redari/raspuns/<token>, pe ORICE origine), fie e un token existent în red_detinatori_token; p_token NULL =
--     orice link personal e străin. O singură definiție (L19) pentru șablon și pentru mesajul final (r2, Jakarinos #1138 P1). r3 (P1, forma codificată):
--     căutarea se face pe FORMA DE CĂUTARE (NFKC, fără spații / invizibile, %XX și entități HTML decodate până la punct fix), orice apariție a căii
--     „redari/raspuns” în afara linkului exact al destinatarului = străin, iar tokenurile existente se caută în orice fereastră de 43 de caractere;
--   * fn_red_mail_destinatari: motivul nou `fara_token` (deținător fără link personal valid — exclus din lot, vizibil în inventar);
--   * fn_red_mail_lot_creeaza (aceeași semnătură): refuză destinatarii fără token valid (destinatari_neeligibili), REFUZĂ un link personal literal în subiect
--     sau în text (link_literal — un link copiat ar ajunge la toți destinatarii), completează subiectul cu câmpurile lotului și corpul FIECĂRUI mesaj cu
--     câmpurile lotului + {LINK_RASPUNS} al LUI, verifică pe mesajul FINAL că fiecare link personal e al destinatarului (link_strain), apoi hash-ul; limitele
--     snapshotului verificate după completare; jurnalul `campuri`;
--   * fn_red_mail_rezerva (corpul 20261131h + bucla peste anulările locale): un token devenit invalid între crearea lotului și trimitere (expirat / deținător
--     șters) = mesajul trece în `anulat` cu eroare_cod `token_expirat`, FĂRĂ apel și FĂRĂ retrimitere, iar rezervarea TRECE LA URMĂTORUL mesaj din coadă
--     (la fel după anularea pentru opt-out) — un mesaj anulat nu oprește destinatarii valizi rămași (r2, Jakarinos #1138 P2: handlerul se oprește la zero rânduri);
--     fn_red_mail_apel_incepe (corpul 20261131h + o condiție): token invalid la autorizare = false + mesajul anulat (token_expirat) — linkul mort nu pleacă niciodată.
--   Siguranța tokenului: apare DOAR în snapshotul mesajului deținătorului lui (red_mail_mesaje, SELECT doar owner — același care citește deja
--     red_detinatori_token ca admin, 20261126a: NICIO politică / drept nu se lărgește aici, postcondiția o verifică); jurnalul F2 și evenimentele nu au
--     conținut; mesajele de eroare nu conțin valori; ecranul îl arată mascat.
--   Ce NU face: nu atinge trimiterea (gărzile 20261131h: doar_proiecte_test, căsuța conectată, extern tot fals — fn_red_mail_f2_poate neschimbată), nu
--     schimbă tabele / RLS / drepturi de modul, nu scrie date de business, nu creează cron / secrete.
-- Identitatea: auth.uid() prin fn_red_mail_f2_owner în toate RPC-urile (L08); fără p_user, fără service_role.
-- Ordinea lock-urilor la rulare (L06, neschimbată): red_mail_setari FOR UPDATE → red_mail_loturi FOR UPDATE → red_proiecte FOR SHARE (rezerva / apel_incepe)
--   → red_mail_mesaje ORDER BY id → jurnal (INSERT). Funcțiile noi doar CITESC red_detinatori / red_parcele / red_detinatori_token / red_uat / red_proiecte,
--   fără lock-uri de rând. fn_red_mail_lot_creeaza: setări → lot → (citiri) → mesaje INSERT → jurnal, ca în 20261131a.
-- Lock-uri la aplicare (punct unic, NOWAIT): red_mail_jurnal_f2 ACCESS EXCLUSIVE (cerut de ALTER TABLE … CHECK; RPC-urile care scriu jurnalul așteaptă până
--   la COMMIT). Bugetul = 1 s cu ceasul pornit IMEDIAT ÎNAINTEA PRIMEI ÎNCERCĂRI, fiecare încercare = subtranzacție. CREATE OR REPLACE FUNCTION nu ia lock
--   pe tabele.
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), lock_timeout = 100 ms, bugetul lock-urilor de 1 s.
-- Revenire: supabase/revenire/20261131i_redari_mail_link_personal_ROLLBACK.sql (prin runner, plafon 2000; L14 textual: refuză la ORICE istoric produs după
--   aplicare — jurnal F2 `campuri`, evenimente `f2_campuri`, mesaje `token_expirat` — nimic șters; după primul lot creat cu câmpuri, întoarcerea = migrare nouă).
--   Probe: scripts/pglite/test_redari_mail_link_local.mjs (PGlite: 20261131h aplicată, apoi pașii reali L15 v2 ai runnerului, comportament pe 3 destinatari,
--   refuzuri, aplicare → revenire → reaplicare, mutanți).
DO $pre$
DECLARE v_plafon text; v_rau text; v_def text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261131i_redari_mail_link_personal:' || txid_current() THEN
    RAISE EXCEPTION '20261131i: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261131i: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261131i: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261131i: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20261131i: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tabelul lui temporar, cu tag aleator, CREAT de tranzacția curentă; tiparul 20261131h)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20261131i: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_red_link_raspuns', 'fn_red_mail_f2_token', 'fn_red_mail_f2_campuri', 'fn_red_mail_f2_completeaza', 'fn_red_mail_f2_link_strain')) THEN
    RAISE EXCEPTION '20261131i: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele citite / scrise (tipurile din 20261126a / 20261127a / 20261131a)
  SELECT string_agg(v.t || '.' || v.c, ', ') INTO v_rau FROM (VALUES
      ('profiles', 'id', 'uuid'), ('profiles', 'is_owner', 'boolean'),
      ('red_proiecte', 'id', 'uuid'), ('red_proiecte', 'cod', 'text'), ('red_proiecte', 'activ', 'boolean'), ('red_proiecte', 'contact_telefon', 'text'),
      ('red_uat', 'id', 'uuid'), ('red_uat', 'proiect_id', 'uuid'), ('red_uat', 'nume', 'text'),
      ('red_uat', 'sesiune_zi1', 'date'), ('red_uat', 'sesiune_zi2', 'date'), ('red_uat', 'sesiune_zi3', 'date'),
      ('red_uat', 'program_zi1', 'text'), ('red_uat', 'program_zi2', 'text'), ('red_uat', 'program_zi3', 'text'),
      ('red_parcele', 'id', 'uuid'), ('red_parcele', 'proiect_id', 'uuid'), ('red_parcele', 'uat_id', 'uuid'), ('red_parcele', 'sters_la', 'timestamp with time zone'),
      ('red_detinatori', 'id', 'uuid'), ('red_detinatori', 'parcela_id', 'uuid'), ('red_detinatori', 'nume', 'text'), ('red_detinatori', 'sters_la', 'timestamp with time zone'),
      ('red_detinatori_contact', 'detinator_id', 'uuid'), ('red_detinatori_contact', 'email', 'text'),
      ('red_detinatori_token', 'detinator_id', 'uuid'), ('red_detinatori_token', 'token_raspuns', 'text'), ('red_detinatori_token', 'token_expira_la', 'timestamp with time zone'),
      ('red_numere', 'cheie', 'text'), ('red_numere', 'ultimul', 'integer'),
      ('red_mail_setari', 'id', 'smallint'), ('red_mail_setari', 'extern_permis', 'boolean'), ('red_mail_setari', 'plafon_zi', 'integer'), ('red_mail_setari', 'plafon_luna', 'integer'), ('red_mail_setari', 'ultim_apel_la', 'timestamp with time zone'),
      ('red_mail_loturi', 'id', 'uuid'), ('red_mail_loturi', 'proiect_id', 'uuid'), ('red_mail_loturi', 'uat_id', 'uuid'), ('red_mail_loturi', 'cerere_sha256', 'text'), ('red_mail_loturi', 'stare', 'text'), ('red_mail_loturi', 'lot_sha256', 'text'), ('red_mail_loturi', 'creat_de', 'uuid'),
      ('red_mail_mesaje', 'id', 'uuid'), ('red_mail_mesaje', 'lot_id', 'uuid'), ('red_mail_mesaje', 'detinator_id', 'uuid'), ('red_mail_mesaje', 'nr_document', 'text'), ('red_mail_mesaje', 'catre', 'text'),
      ('red_mail_mesaje', 'message_id', 'text'), ('red_mail_mesaje', 'subiect_final', 'text'), ('red_mail_mesaje', 'corp_text_final', 'text'), ('red_mail_mesaje', 'antete_snapshot', 'jsonb'), ('red_mail_mesaje', 'mesaj_sha256', 'text'),
      ('red_mail_mesaje', 'stare', 'text'), ('red_mail_mesaje', 'eroare_cod', 'text'), ('red_mail_mesaje', 'lease_token', 'uuid'), ('red_mail_mesaje', 'lease_pana', 'timestamp with time zone'), ('red_mail_mesaje', 'rezervat_la', 'timestamp with time zone'),
      ('red_mail_optout', 'email', 'text'), ('red_mail_optout', 'activ', 'boolean'), ('red_convocari', 'detinator_id', 'uuid'), ('red_convocari', 'canal', 'text'),
      ('red_mail_jurnal_f2', 'cod', 'text'), ('red_mail_evenimente', 'tip', 'text'), ('red_mail_evenimente', 'cod', 'text')
    ) v(t, c, tip)
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns ic WHERE ic.table_schema = 'public' AND ic.table_name = v.t AND ic.column_name = v.c AND ic.data_type = v.tip);
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20261131i: coloane lipsa / alt tip: %', v_rau; END IF;
  -- CHECK-ul jurnalului F2 pe care îl înlocuiește: EXACT cel din 20261131a
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c WHERE c.conrelid = 'public.red_mail_jurnal_f2'::regclass AND c.conname = 'red_mail_jurnal_f2_cod_check';
  IF v_def IS DISTINCT FROM 'CHECK ((cod = ANY (ARRAY[''creat''::text, ''aprobat''::text, ''rezervat''::text, ''apel_inceput''::text, ''trimis''::text, ''esuat_sigur''::text, ''necunoscut''::text, ''esuat_confirmat''::text, ''anulat''::text, ''lot_integritate''::text, ''lot_incheiat''::text, ''golit''::text, ''lot_sters_final''::text, ''setari''::text, ''optout''::text])))' THEN
    RAISE EXCEPTION '20261131i: red_mail_jurnal_f2_cod_check nu e cel din 20261131a (%)', coalesce(v_def, 'lipsa');
  END IF;
  -- jurnalul F2 e append-only (20261131a) — altfel urma L14 n-ar fi de încredere
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.red_mail_jurnal_f2'::regclass AND t.tgname = 'trg_red_mail_f2_jurnal_imuabil' AND t.tgenabled = 'O') <> 1
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.red_mail_evenimente'::regclass AND t.tgname = 'trg_red_mail_evenimente_reguli' AND t.tgenabled = 'O') <> 1
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.red_mail_mesaje'::regclass AND t.tgname = 'trg_red_mail_f2_mesaj' AND t.tgenabled = 'O') <> 1
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.red_mail_loturi'::regclass AND t.tgname = 'trg_red_mail_f2_lot' AND t.tgenabled = 'O') <> 1 THEN
    RAISE EXCEPTION '20261131i: triggerele 20261130k / 20261131a pe jurnal_f2 / evenimente / mesaje / loturi lipsesc sau sunt oprite';
  END IF;
  -- funcțiile înlocuite și cele chemate: EXACT cele din 20261131a / 20261131h (corp fără CR + proprietăți + proprietar)
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      ('public.fn_red_mail_lot_creeaza(uuid,uuid,uuid,uuid[],text,text)', 'a43632708f4d31f44c50f614c0b5456c', 'plpgsql', true, 'v', 'uuid'),
      ('public.fn_red_mail_destinatari(uuid,uuid,uuid)', '4db265cc817f34726d109a8727058f65', 'plpgsql', true, 's', 'record'),
      ('public.fn_red_mail_rezerva(uuid)', 'd779e03d0644e437db412b0c3721e6c0', 'plpgsql', true, 'v', 'public.red_mail_mesaje'),
      ('public.fn_red_mail_apel_incepe(uuid,uuid)', '9e8dbac708ee9512cd402a960d1d446a', 'plpgsql', true, 'v', 'boolean'),
      ('public.fn_red_mail_f2_poate(public.red_mail_loturi)', '01d3390b765bedc9fd64801f113109c9', 'plpgsql', false, 's', 'text'),
      ('public.fn_red_mail_f2_owner()', '220cfdf1f3e97fde8cd597a5b24537ed', 'plpgsql', true, 's', 'void'),
      ('public.fn_red_mail_f2_audit(uuid,uuid,text)', '22f7267f17b19a625fc849ae217fc160', 'plpgsql', true, 'v', 'void'),
      ('public.fn_red_mail_f2_text(text)', '72c8fdc01d8f1a4e379bedad1d0deded', 'sql', false, 'i', 'text'),
      ('public.fn_red_mail_f2_hash(jsonb)', '7f3cad7c24c64e7f52b82378af4d4a27', 'sql', false, 'i', 'text'),
      ('public.fn_red_mail_f2_email(text)', '944b38951ee8fd7c63a955d410222d93', 'sql', false, 'i', 'boolean'),
      ('public.fn_red_mail_f2_mesaj_hash(public.red_mail_mesaje)', 'b5bf8b67b6355276d2e722a59133652b', 'sql', false, 'i', 'text'),
      ('public.fn_red_proiect_e_test(text)', 'b3a152708e032c698980981ab0eb3cf9', 'sql', false, 'i', 'boolean')
    ) a(semnatura, amprenta, limbaj, definer, volatil, intoarce)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
   WHERE p.oid IS NULL
      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = a.limbaj)
      OR p.prosecdef IS DISTINCT FROM a.definer
      OR p.provolatile IS DISTINCT FROM a.volatil
      OR p.prorettype IS DISTINCT FROM a.intoarce::regtype::oid
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres';
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20261131i: functiile F2 nu sunt cele din 20261131a / 20261131h: %', v_rau; END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_red_mail_lot_creeaza', 'fn_red_mail_destinatari', 'fn_red_mail_rezerva', 'fn_red_mail_apel_incepe')) <> 4
     OR (SELECT p.proretset FROM pg_proc p WHERE p.oid = 'public.fn_red_mail_rezerva(uuid)'::regprocedure) IS NOT TRUE
     OR (SELECT p.proretset FROM pg_proc p WHERE p.oid = 'public.fn_red_mail_destinatari(uuid,uuid,uuid)'::regprocedure) IS NOT TRUE THEN
    RAISE EXCEPTION '20261131i: variante neasteptate ale functiilor inlocuite';
  END IF;
  -- 20261131h aplicată (gărzile trimiterii pe care NU le atinge această migrare) și dependențele
  IF to_regprocedure('public.fn_red_mail_oauth_start(text,text)') IS NULL OR to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('public.fn_sms_e_owner()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.red_mail_setari'::regclass AND a.attname = 'doar_proiecte_test' AND NOT a.attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.red_proiecte'::regclass AND t.tgname = 'trg_red_proiect_cod_test' AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION '20261131i: cere 20261131h aplicata (fn_red_mail_oauth_start, doar_proiecte_test, trg_red_proiect_cod_test) si auth.uid / fn_sms_e_owner';
  END IF;
  -- tokenul rămâne izolat exact ca în 20261126a (o singură politică, SELECT, admin / editor; fără scriere pentru roluri): migrarea nu lărgește nimic
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'red_detinatori_token') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'red_detinatori_token' AND cmd = 'SELECT' AND policyname = 'red_token_sel')
     OR has_any_column_privilege('authenticated', 'public.red_detinatori_token', 'INSERT') OR has_any_column_privilege('authenticated', 'public.red_detinatori_token', 'UPDATE')
     OR has_table_privilege('anon', 'public.red_detinatori_token', 'SELECT')
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'red_mail_mesaje') <> 1
     OR has_table_privilege('authenticated', 'public.red_mail_mesaje', 'INSERT') OR has_table_privilege('authenticated', 'public.red_mail_mesaje', 'UPDATE') THEN
    RAISE EXCEPTION '20261131i: red_detinatori_token / red_mail_mesaje nu au RLS-ul si drepturile din 20261126a / 20261131a';
  END IF;
  -- istoricul pe care revenirea îl va trata ca „utilizare” (L14) nu există încă (CHECK-ul vechi refuza `campuri`; evenimentele sunt append-only)
  IF EXISTS (SELECT 1 FROM public.red_mail_jurnal_f2 j WHERE j.cod = 'campuri')
     OR EXISTS (SELECT 1 FROM public.red_mail_evenimente e WHERE e.tip = 'f2' AND e.cod = 'f2_campuri')
     OR EXISTS (SELECT 1 FROM public.red_mail_mesaje m WHERE m.eroare_cod = 'token_expirat') THEN
    RAISE EXCEPTION '20261131i: exista deja istoric al campurilor (jurnal campuri / eveniment f2_campuri / mesaje token_expirat) — revenirea L14 nu l-ar putea deosebi';
  END IF;
  IF has_schema_privilege('anon', 'public', 'CREATE') OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION '20261131i: anon/authenticated pot crea obiecte in public';
  END IF;
END $pre$;

-- drepturile EXACTE ale celor patru funcții înlocuite, ÎNAINTE (postcondiția: aceleași după CREATE OR REPLACE)
CREATE TEMP TABLE red_acl_20261131i ON COMMIT DROP AS
  SELECT p.oid::regprocedure::text AS functie, coalesce(p.proacl, acldefault('f', p.proowner))::text AS acl
    FROM pg_proc p WHERE p.oid IN ('public.fn_red_mail_lot_creeaza(uuid,uuid,uuid,uuid[],text,text)'::regprocedure, 'public.fn_red_mail_destinatari(uuid,uuid,uuid)'::regprocedure,
                                   'public.fn_red_mail_rezerva(uuid)'::regprocedure, 'public.fn_red_mail_apel_incepe(uuid,uuid)'::regprocedure);

-- ── punctul UNIC de blocare (L06): red_mail_jurnal_f2 ACCESS EXCLUSIVE, NOWAIT; bugetul 1 s de la prima încercare ──
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20261131i: BUGET_LOCK: % incercari, % ms de la prima incercare (bugetul lock-urilor e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000)
        USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.red_mail_jurnal_f2 IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20261131i: BUGET_LOCK: lock-ul obtinut abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000)
      USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20261131i: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── 1. jurnalul F2: codul `campuri` (urma L14 a fiecărui lot creat cu câmpuri) ─────────────────────────────────────────────────────
ALTER TABLE public.red_mail_jurnal_f2 DROP CONSTRAINT red_mail_jurnal_f2_cod_check;
ALTER TABLE public.red_mail_jurnal_f2 ADD CONSTRAINT red_mail_jurnal_f2_cod_check CHECK (cod IN ('creat','aprobat','rezervat','apel_inceput','trimis','esuat_sigur','necunoscut','esuat_confirmat','anulat','lot_integritate','lot_incheiat','golit','lot_sters_final','setari','optout','campuri'));

-- ─── 2. linkul personal: O SINGURĂ definiție SQL (paritate cu linkRaspuns din src/redari/docx.js) ─────────────────────────────────
CREATE FUNCTION public.fn_red_link_raspuns(p_token text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $fn$
 SELECT CASE WHEN p_token ~ '^[A-Za-z0-9_-]{43}$' THEN 'https://redari.gazpet.ro/redari/raspuns/'||p_token END
$fn$;
COMMENT ON FUNCTION public.fn_red_link_raspuns(text) IS 'Redări: linkul personal de răspuns al deținătorului (https://redari.gazpet.ro/redari/raspuns/<token>, același ca în codul QR din convocator — src/redari/docx.js linkRaspuns); NULL dacă tokenul nu are forma de 43 de caractere base64url. Secret al deținătorului: nu intră în jurnale / erori. 20261131i.';

-- ─── 3. tokenul VALID al deținătorului: același predicat ca RPC-urile publice (20261126a) — o singură definiție (L19) ──────────────
CREATE FUNCTION public.fn_red_mail_f2_token(p_detinator uuid) RETURNS text
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $fn$
 SELECT t.token_raspuns FROM public.red_detinatori_token t
  JOIN public.red_detinatori d ON d.id=t.detinator_id AND d.sters_la IS NULL
  JOIN public.red_parcele p ON p.id=d.parcela_id AND p.sters_la IS NULL
  WHERE t.detinator_id=p_detinator AND t.token_raspuns ~ '^[A-Za-z0-9_-]{43}$' AND (t.token_expira_la IS NULL OR now()<=t.token_expira_la)
$fn$;
COMMENT ON FUNCTION public.fn_red_mail_f2_token(uuid) IS 'Redări e-mail (intern, chemată din RPC-urile DEFINER): tokenul de răspuns VALID al deținătorului — deținător și parcelă neșterse, 43 de caractere base64url, neexpirat (același predicat ca fn_red_formular_public / fn_red_raspuns_public) — sau NULL. Folosit de inventar (fara_token), creare (refuz), rezervare și autorizare (token_expirat). 20261131i.';

-- ─── 4. câmpurile lotului, din ACEEAȘI sursă ca convocatorul (red_uat / red_proiecte); NULL = nu se poate deduce sigur ────────────
CREATE FUNCTION public.fn_red_mail_f2_campuri(p_proiect uuid,p_uat uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE u public.red_uat; pr public.red_proiecte; zile text[]; programe text[]; v_zile text; v_program text;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 IF p_proiect IS NULL OR p_uat IS NULL THEN RAISE EXCEPTION 'cerere_invalida' USING ERRCODE='22023'; END IF;
 SELECT * INTO u FROM public.red_uat WHERE id=p_uat AND proiect_id=p_proiect;
 IF NOT FOUND THEN RAISE EXCEPTION 'tinta_invalida'; END IF;
 SELECT * INTO pr FROM public.red_proiecte WHERE id=p_proiect;
 -- zilele de sesiune (zi1 < zi2 < zi3, CHECK 20261127a) ca ZZ.LL.AAAA, legate cu „, ” și „ și ”; programul doar dacă fiecare zi îl are și toate sunt identice
 SELECT array_agg(to_char(s.z,'DD.MM.YYYY') ORDER BY s.z), array_agg(coalesce(btrim(s.pz),'') ORDER BY s.z) INTO zile, programe
  FROM (VALUES (u.sesiune_zi1,u.program_zi1),(u.sesiune_zi2,u.program_zi2),(u.sesiune_zi3,u.program_zi3)) s(z,pz) WHERE s.z IS NOT NULL;
 IF zile IS NOT NULL THEN
  v_zile:=CASE WHEN cardinality(zile)=1 THEN zile[1] ELSE array_to_string(zile[1:cardinality(zile)-1],', ')||' și '||zile[cardinality(zile)] END;
  v_program:=CASE WHEN programe[1]<>'' AND (SELECT count(DISTINCT x) FROM unnest(programe) x)=1 THEN programe[1] END;
 END IF;
 RETURN jsonb_build_object('COMUNA',nullif(btrim(u.nume),''),'ZILE',v_zile,'PROGRAM',v_program,'TEL',nullif(btrim(pr.contact_telefon),''));
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_f2_campuri(uuid,uuid) IS 'Redări e-mail (owner): valorile câmpurilor lotului pentru UAT-ul proiectului — COMUNA (red_uat.nume), ZILE (sesiune_zi1..3 ca ZZ.LL.AAAA, „, ” și „ și ”), PROGRAM (program_zi* doar dacă identic în toate zilele), TEL (red_proiecte.contact_telefon); NULL = nu se poate deduce sigur. Aceeași sursă ca convocatorul. Folosită de ecran și de fn_red_mail_lot_creeaza. 20261131i.';

-- ─── 5. completarea {NUME} → valoare; orice „{…}” necunoscut sau fără valoare = refuz; NICIO acoladă rămasă în snapshot ─────────────
-- Ce e un câmp (o singură definiție, aceeași în JS — campuriDinText / acoladeInvalide din redariMailF2.mjs, paritate pe src/redari/__tests__/campuri_mail_cazuri.json):
--   „{” + nume fără acolade, de ORICE lungime + „}”; după înlocuirea câmpurilor cunoscute, orice acoladă rămasă („{}”, „{ X }”, „{{COMUNA}}”, o acoladă
--   neînchisă, un nume de 41+ caractere) = refuz. Numele din mesajul de eroare e tăiat la 40 de caractere (nicio valoare în erori).
CREATE FUNCTION public.fn_red_mail_f2_completeaza(p_text text,p_campuri jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $fn$
DECLARE nume text; rez text:=p_text; v text;
BEGIN
 IF p_text IS NULL OR p_campuri IS NULL OR jsonb_typeof(p_campuri)<>'object' THEN RAISE EXCEPTION 'cerere_invalida' USING ERRCODE='22023'; END IF;
 FOR nume IN SELECT DISTINCT m[1] FROM regexp_matches(p_text,'[{]([^{}]+)[}]','g') m LOOP
  IF NOT (p_campuri ? nume) THEN RAISE EXCEPTION 'camp_necunoscut: %',left(nume,40) USING ERRCODE='22023'; END IF;
  v:=p_campuri->>nume;
  IF v IS NULL OR btrim(v)='' THEN RAISE EXCEPTION 'camp_necompletabil: %',nume USING ERRCODE='22023'; END IF;
  rez:=replace(rez,'{'||nume||'}',v);
 END LOOP;
 IF rez ~ '[{}]' THEN RAISE EXCEPTION 'camp_necunoscut: acolade ramase' USING ERRCODE='22023'; END IF;
 RETURN rez;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_f2_completeaza(text,jsonb) IS 'Redări e-mail (intern): înlocuiește fiecare {NUME} din text cu valoarea din p_campuri; un câmp necunoscut (scris greșit) = camp_necunoscut, un câmp fără valoare = camp_necompletabil (ambele 22023); textul rezultat nu mai conține NICIO acoladă (orice formă rămasă, oricât de lungă, = camp_necunoscut). Mesajele de eroare nu conțin valori. 20261131i.';

-- ─── 5b. linkul personal STRĂIN: o singură definiție pentru șablon (p_token NULL) și pentru mesajul final (p_token = al destinatarului) ─────────
-- r3 (Jakarinos #1138 P1: un token procent-codificat — „%54…” — trecea de căutarea literală, iar routerul îl decodează): căutarea se face pe FORMA DE
-- CĂUTARE a textului, cu o singură definiție (aceeași în JS: formaCautareLink / linkStrain din redariMailF2.mjs; paritate pe tabelul comun
-- src/redari/__tests__/link_strain_cazuri.json; tabelele de caractere de mai jos sunt citite de testul JS din acest text):
--   0. linkul destinatarului însuși, în forma EXACTĂ din fn_red_link_raspuns, se înlocuiește cu „#” (nu e străin); orice altă formă a lui rămâne de verificat;
--   1. NFKC (literele „late” / compatibile devin ASCII);
--   2. până la punct fix (cel mult 12 treceri; nestabil = străin): se elimină spațiile, rupturile de linie, controalele, caracterele invizibile / de formatare,
--      semnele combinante (INVIZIBILE), liniuțele Unicode devin „-”, se decodează %XX (un pas de la stânga la dreapta, ca routerul; octet ASCII tipăribil =
--      caracterul, altfel eliminat) și entitățile HTML (numerice; cele cu nume din ENTITATI, restul eliminate);
--   3. străin = (a) calea formularului „redari/raspuns” apare oriunde (litere ASCII mici, „\” = „/”, „//” și segmentele „.” / „..” rezolvate, ca un browser):
--      singura formă permisă e {LINK_RASPUNS} al destinatarului (pasul 0); SAU (b) un token EXISTENT în red_detinatori_token, diferit de p_token, apare
--      oriunde în forma de căutare (orice fereastră de 43 de caractere dintr-un șir base64url — și lipit de alte litere); sensibil la majuscule.
-- Nimic nu se scrie; nicio valoare în rezultat.
CREATE FUNCTION public.fn_red_mail_f2_link_strain(p_text text,p_token text) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $fn$
DECLARE
 -- >>> TABEL-LINK 20261131i (aceleași valori în JS: INVIZIBILE_LINK / LINIUTE_LINK / ENTITATI_LINK din redariMailF2.mjs)
 inviz constant jsonb:='[[1,32],[127,160],[173,173],[768,879],[1564,1564],[4447,4448],[5760,5760],[6155,6158],[8192,8207],[8232,8239],[8287,8303],[10240,10240],[12288,12288],[12644,12644],[65024,65039],[65279,65279],[65440,65440],[65529,65531],[119155,119162],[917504,917631],[917760,917999]]';
 liniute constant jsonb:='[[8208,8213],[8722,8722],[11834,11835]]';
 entitati constant jsonb:='{"amp":"&","AMP":"&","lowbar":"_","UnderBar":"_","sol":"/","bsol":"\\","hyphen":"-","dash":"-","minus":"-","period":".","colon":":","num":"#","percnt":"%","quest":"?"}';
 -- <<< TABEL-LINK 20261131i
 c_inviz text; c_lin text; v text; ant text; cale text; parti text[]; potr text[]; k int; c int; x text; stabil boolean:=false;
BEGIN
 IF p_text IS NULL THEN RETURN false; END IF;
 SELECT '['||string_agg(chr((e->>0)::int)||'-'||chr((e->>1)::int),'')||']' INTO c_inviz FROM jsonb_array_elements(inviz) e;
 SELECT '['||string_agg(chr((e->>0)::int)||'-'||chr((e->>1)::int),'')||']' INTO c_lin FROM jsonb_array_elements(liniute) e;
 v:=p_text;
 IF p_token IS NOT NULL AND public.fn_red_link_raspuns(p_token) IS NOT NULL THEN v:=replace(v,public.fn_red_link_raspuns(p_token),'#'); END IF;
 v:=normalize(v,NFKC);
 FOR k IN 1..12 LOOP
  ant:=v;
  v:=regexp_replace(regexp_replace(v,c_inviz,'','g'),c_lin,'-','g');
  -- %XX: un singur pas de la stânga la dreapta (bucățile dintre potriviri + potrivirile, în ordine)
  parti:=regexp_split_to_array(v,'%[0-9A-Fa-f]{2}');
  SELECT array_agg(r.m[1] ORDER BY r.o) INTO potr FROM regexp_matches(v,'%[0-9A-Fa-f]{2}','g') WITH ORDINALITY r(m,o);
  v:=parti[1];
  FOR n IN 1..coalesce(cardinality(potr),0) LOOP
   c:=get_byte(decode(substr(potr[n],2),'hex'),0);
   v:=v||CASE WHEN c BETWEEN 33 AND 126 THEN chr(c) ELSE '' END||parti[n+1];
  END LOOP;
  -- entitățile HTML: &#zecimal; &#xhex; (ASCII tipăribil = caracterul, altfel eliminat) și &nume; (din ENTITATI, altfel eliminat)
  parti:=regexp_split_to_array(v,'&#[0-9]{1,7};?|&#[xX][0-9A-Fa-f]{1,6};?|&[A-Za-z][A-Za-z0-9]{1,31};');
  SELECT array_agg(r.m[1] ORDER BY r.o) INTO potr FROM regexp_matches(v,'&#[0-9]{1,7};?|&#[xX][0-9A-Fa-f]{1,6};?|&[A-Za-z][A-Za-z0-9]{1,31};','g') WITH ORDINALITY r(m,o);
  v:=parti[1];
  FOR n IN 1..coalesce(cardinality(potr),0) LOOP
   x:=potr[n];
   IF x ~ '^&#' THEN
    c:=CASE WHEN x ~ '^&#[xX]' THEN ('x'||lpad(substring(x FROM '^&#[xX]([0-9A-Fa-f]+)'),8,'0'))::bit(32)::int ELSE substring(x FROM '^&#([0-9]+)')::int END;
    x:=CASE WHEN c BETWEEN 33 AND 126 THEN chr(c) ELSE '' END;
   ELSE x:=coalesce(entitati->>substring(x FROM 2 FOR length(x)-2),'');
   END IF;
   v:=v||x||parti[n+1];
  END LOOP;
  IF v=ant THEN stabil:=true; EXIT; END IF;
 END LOOP;
 IF NOT stabil THEN RETURN true; END IF;
 -- (a) calea formularului, oricum ar fi scrisă (doar literele ASCII devin mici, ca în JS)
 cale:=replace(translate(v,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'\','/');
 stabil:=false;
 FOR k IN 1..12 LOOP
  ant:=cale;
  cale:=regexp_replace(regexp_replace(regexp_replace(cale,'/+','/','g'),'/\.(?=/|$)','','g'),'/[^/]+/\.\.(?=/|$)','','g');
  IF cale=ant THEN stabil:=true; EXIT; END IF;
 END LOOP;
 IF NOT stabil OR position('redari/raspuns' IN cale)>0 THEN RETURN true; END IF;
 -- (b) un token existent al altcuiva, oriunde în forma de căutare (ferestre de 43 de caractere; indexul UNIQUE pe token_raspuns)
 RETURN EXISTS(SELECT 1 FROM regexp_matches(v,'[A-Za-z0-9_-]{43,}','g') r, generate_series(1,length(r[1])-42) i, public.red_detinatori_token t
  WHERE t.token_raspuns=substr(r[1],i,43) AND t.token_raspuns IS DISTINCT FROM p_token);
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_f2_link_strain(text,text) IS 'Redări e-mail (intern): true dacă textul conține — după forma de căutare (NFKC, fără spații / invizibile, %XX și entități HTML decodate până la punct fix) — calea formularului de răspuns (redari/raspuns, oricum scrisă) în afara linkului exact al destinatarului p_token, sau un token existent al altui deținător (sensibil la majuscule). p_token NULL = orice link personal e străin. Folosită de fn_red_mail_lot_creeaza pe șablon (refuz link_literal) și pe fiecare mesaj final (refuz link_strain). 20261131i (r3: forma codificată).';

-- ─── 6. inventarul destinatarilor: motivul `fara_token` (corpul 20261131a + o condiție) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_red_mail_destinatari(p_proiect uuid,p_uat uuid,p_dupa uuid DEFAULT NULL)
RETURNS TABLE(id uuid,nume text,email text,motive text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 RETURN QUERY SELECT d.id,d.nume,lower(c.email),array_remove(ARRAY[
 CASE WHEN public.fn_red_mail_f2_email(c.email) IS NOT TRUE THEN 'fara_email' END,
 CASE WHEN EXISTS(SELECT 1 FROM public.red_mail_optout o WHERE o.email=lower(c.email) AND o.activ) THEN 'opt_out' END,
 -- Canalul poștal NU exclude e-mailul suplimentar. Este inventariat separat.
 CASE WHEN public.fn_red_mail_f2_email(c.email) IS NOT TRUE AND EXISTS(SELECT 1 FROM public.red_convocari cv WHERE cv.detinator_id=d.id AND cv.canal='posta' AND cv.stare='activ' AND cv.sters_la IS NULL) THEN 'canal_postal' END,
 CASE WHEN EXISTS(SELECT 1 FROM public.red_mail_mesaje m JOIN public.red_mail_loturi l ON l.id=m.lot_id WHERE m.detinator_id=d.id AND l.proiect_id=p_proiect AND m.stare IN ('in_coada','rezervat','in_apel','necunoscut','trimis')) THEN 'deja_rezervat_trimis' END,
 -- 20261131i: fără link personal valid (token lipsă / expirat) = exclus din lot
 CASE WHEN public.fn_red_mail_f2_token(d.id) IS NULL THEN 'fara_token' END
 ]::text[],NULL)
 FROM public.red_detinatori d JOIN public.red_parcele p ON p.id=d.parcela_id
 LEFT JOIN public.red_detinatori_contact c ON c.detinator_id=d.id
 WHERE p.proiect_id=p_proiect AND p.uat_id=p_uat AND p.sters_la IS NULL AND d.sters_la IS NULL
 AND (p_dupa IS NULL OR d.id>p_dupa) ORDER BY d.id LIMIT 300;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_destinatari(uuid,uuid,uuid) IS 'Redări e-mail F2 (owner): inventarul destinatarilor unui UAT cu motivele de excludere (fara_email, opt_out, canal_postal, deja_rezervat_trimis; 20261131i: fara_token = fără link personal de răspuns valid).';

-- ─── 7. crearea lotului: câmpurile completate PE FIECARE MESAJ în snapshot, înaintea hash-ului (corpul 20261131a + completarea) ────────
CREATE OR REPLACE FUNCTION public.fn_red_mail_lot_creeaza(p_operatie uuid,p_proiect uuid,p_uat uuid,p_destinatari uuid[],p_subiect text,p_text text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE h text; existent public.red_mail_loturi; dst record; msg public.red_mail_mesaje; n bigint; pr public.red_proiecte; nou boolean; campuri jsonb; subiect text; tok text;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 IF p_operatie IS NULL OR p_proiect IS NULL OR p_uat IS NULL OR cardinality(p_destinatari) IS NULL OR cardinality(p_destinatari) NOT BETWEEN 1 AND 300 OR array_position(p_destinatari,NULL) IS NOT NULL THEN RAISE EXCEPTION 'cerere_invalida' USING ERRCODE='22023'; END IF;
 IF p_subiect IS NULL OR length(btrim(p_subiect)) NOT BETWEEN 1 AND 400 OR p_subiect ~ '[[:cntrl:]]' OR p_text IS NULL OR length(btrim(p_text)) NOT BETWEEN 1 AND 19000 THEN RAISE EXCEPTION 'continut_invalid' USING ERRCODE='22023'; END IF;
 -- 20261131i: un link personal LITERAL în șablon (subiect sau text) ar ajunge la TOȚI destinatarii — refuz înainte de orice scriere; linkul intră doar prin {LINK_RASPUNS}
 IF public.fn_red_mail_f2_link_strain(p_subiect,NULL) OR public.fn_red_mail_f2_link_strain(p_text,NULL) THEN RAISE EXCEPTION 'link_literal' USING ERRCODE='22023'; END IF;
 h:=public.fn_red_mail_f2_hash(jsonb_build_object('proiect',p_proiect,'uat',p_uat,'destinatari',(SELECT jsonb_agg(x ORDER BY x) FROM unnest(p_destinatari)x),'subiect',p_subiect,'text',p_text));
 PERFORM 1 FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;
 INSERT INTO public.red_mail_loturi(id,proiect_id,uat_id,cerere_sha256,lot_sha256,creat_de) VALUES(p_operatie,p_proiect,p_uat,h,public.fn_red_mail_f2_hash('[]'::jsonb),auth.uid()) ON CONFLICT(id) DO NOTHING RETURNING * INTO existent;
 nou:=FOUND;
 SELECT * INTO existent FROM public.red_mail_loturi WHERE id=p_operatie FOR UPDATE;
 IF NOT nou THEN IF existent.cerere_sha256<>h THEN RAISE EXCEPTION 'operatie_reutilizata'; END IF; RETURN existent.id; END IF;
 SELECT * INTO pr FROM public.red_proiecte WHERE id=p_proiect;
 IF NOT FOUND OR pr.activ IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM public.red_uat WHERE id=p_uat AND proiect_id=p_proiect) THEN RAISE EXCEPTION 'tinta_invalida'; END IF;
 IF cardinality(p_destinatari)<>(SELECT count(DISTINCT x) FROM unnest(p_destinatari)x) OR cardinality(p_destinatari)<>(SELECT count(*) FROM public.red_detinatori d JOIN public.red_parcele p ON p.id=d.parcela_id JOIN public.red_detinatori_contact c ON c.detinator_id=d.id WHERE d.id=ANY(p_destinatari) AND d.sters_la IS NULL AND p.sters_la IS NULL AND p.proiect_id=p_proiect AND p.uat_id=p_uat AND public.fn_red_mail_f2_email(c.email)) THEN RAISE EXCEPTION 'destinatari_invalizi'; END IF;
 IF EXISTS(SELECT 1 FROM public.red_detinatori_contact c WHERE c.detinator_id=ANY(p_destinatari)
 AND EXISTS(SELECT 1 FROM public.red_mail_optout o WHERE o.email=lower(c.email) AND o.activ))
 OR EXISTS(SELECT 1 FROM public.red_mail_mesaje m JOIN public.red_mail_loturi l ON l.id=m.lot_id
 WHERE m.detinator_id=ANY(p_destinatari) AND l.proiect_id=p_proiect
 AND m.stare IN ('in_coada','rezervat','in_apel','necunoscut','trimis')) THEN RAISE EXCEPTION 'destinatari_neeligibili'; END IF;
 -- 20261131i: fără link personal valid (token lipsă / expirat / deținător șters) nu intră în lot (inventarul îl arată ca fara_token)
 IF EXISTS(SELECT 1 FROM unnest(p_destinatari) x WHERE public.fn_red_mail_f2_token(x) IS NULL) THEN RAISE EXCEPTION 'destinatari_neeligibili'; END IF;
 -- 20261131i: câmpurile lotului (aceeași sursă ca convocatorul); subiectul se completează o dată, fără link; corpul pe fiecare mesaj, cu linkul LUI
 campuri:=public.fn_red_mail_f2_campuri(p_proiect,p_uat);
 subiect:=public.fn_red_mail_f2_text(public.fn_red_mail_f2_completeaza(p_subiect,campuri));
 IF length(btrim(subiect)) NOT BETWEEN 1 AND 500 OR subiect ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'continut_invalid' USING ERRCODE='22023'; END IF;
 -- subiectul final nu are voie să conțină NICIUN link personal (nici din valorile câmpurilor)
 IF public.fn_red_mail_f2_link_strain(subiect,NULL) THEN RAISE EXCEPTION 'link_strain' USING ERRCODE='22023'; END IF;
 FOR dst IN SELECT d.id,c.email FROM public.red_detinatori d JOIN public.red_detinatori_contact c ON c.detinator_id=d.id WHERE d.id=ANY(p_destinatari) ORDER BY d.id LOOP
  tok:=public.fn_red_mail_f2_token(dst.id);
  IF tok IS NULL OR public.fn_red_link_raspuns(tok) IS NULL THEN RAISE EXCEPTION 'destinatari_neeligibili'; END IF;
  -- Numerotare M atomică, fără modificarea RPC-ului existent de numerotare.
  INSERT INTO public.red_numere(cheie,ultimul) VALUES('M',1) ON CONFLICT(cheie) DO UPDATE SET ultimul=red_numere.ultimul+1 RETURNING ultimul INTO n;
  msg.id:=gen_random_uuid(); msg.lot_id:=p_operatie; msg.detinator_id:=dst.id; msg.tip:='convocare'; msg.nr_document:='M-'||lpad(n::text,6,'0');
  msg.catre:=lower(dst.email); msg.message_id:='<'||msg.id::text||'@gazpet.ro>';
  msg.subiect_final:=subiect; msg.corp_text_final:=public.fn_red_mail_f2_text(public.fn_red_mail_f2_completeaza(p_text,campuri||jsonb_build_object('LINK_RASPUNS',public.fn_red_link_raspuns(tok)))); msg.corp_html_final:=NULL;
  IF length(btrim(msg.corp_text_final)) NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION 'continut_invalid' USING ERRCODE='22023'; END IF;
  -- 20261131i: pe mesajul FINAL, orice link personal trebuie să fie al ACESTUI destinatar (apărare în adâncime față de refuzul șablonului)
  IF public.fn_red_mail_f2_link_strain(msg.corp_text_final,tok) THEN RAISE EXCEPTION 'link_strain' USING ERRCODE='22023'; END IF;
  msg.antete_snapshot:=jsonb_build_object('From','redari@gazpet.ro','To',msg.catre,'Message-ID',msg.message_id,'List-Unsubscribe','<mailto:redari@gazpet.ro?subject=dezabonare>');
  msg.mesaj_sha256:=public.fn_red_mail_f2_mesaj_hash(msg);
  INSERT INTO public.red_mail_mesaje(id,lot_id,detinator_id,nr_document,catre,message_id,subiect_final,corp_text_final,antete_snapshot,mesaj_sha256) VALUES(msg.id,msg.lot_id,msg.detinator_id,msg.nr_document,msg.catre,msg.message_id,msg.subiect_final,msg.corp_text_final,msg.antete_snapshot,msg.mesaj_sha256);
 END LOOP;
 UPDATE public.red_mail_loturi SET lot_sha256=public.fn_red_mail_f2_lot_hash(p_operatie) WHERE id=p_operatie;
 PERFORM public.fn_red_mail_f2_audit(p_operatie,NULL,'creat'); PERFORM public.fn_red_mail_f2_audit(p_operatie,NULL,'campuri'); RETURN p_operatie;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_lot_creeaza(uuid,uuid,uuid,uuid[],text,text) IS 'Redări e-mail F2 (owner): creează lotul ciornă (idempotent pe p_operatie + hash-ul cererii). 20261131i: destinatarii fără token valid sunt refuzați (destinatari_neeligibili); un link personal literal în subiect / text = link_literal; subiectul primește câmpurile lotului, corpul fiecărui mesaj câmpurile lotului + {LINK_RASPUNS} al destinatarului, ÎN SNAPSHOT, înaintea hash-ului; un câmp necunoscut sau o acoladă rămasă = camp_necunoscut, fără valoare = camp_necompletabil; un link personal străin în mesajul final = link_strain; jurnalul F2 primește și `campuri`.';

-- ─── 8. rezervarea: anulările locale (opt-out, token devenit invalid = token_expirat) NU opresc coada — se trece la următorul mesaj (corpul 20261131h + bucla) ──
CREATE OR REPLACE FUNCTION public.fn_red_mail_rezerva(p_lot uuid) RETURNS SETOF public.red_mail_mesaje
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE l public.red_mail_loturi; m public.red_mail_mesaje; s public.red_mail_setari; cod text;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 -- Ordine: setări -> lot -> proiect (FOR SHARE, 20261131h) -> mesaje ORDER BY id. Setările serializează și cotele globale.
 SELECT * INTO s FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;  -- r3 (Gem r2 P2-02)
 SELECT * INTO l FROM public.red_mail_loturi WHERE id=p_lot FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'lot_inexistent'; END IF;
 -- 20261131h: decizia „doar TEST” a lui fn_red_mail_f2_poate e serializată cu orice UPDATE al proiectului (redenumire); trg_red_proiect_cod_test refuză
 -- schimbarea categoriei cât lotul nu e încheiat sau are mesaje rezervate / în apel, deci și între COMMIT-ul de aici și apelul HTTP.
 PERFORM 1 FROM public.red_proiecte WHERE id=l.proiect_id FOR SHARE;
 -- Reconcilierea locală a lease-urilor nu reia un send ambiguu.
 PERFORM 1 FROM public.red_mail_mesaje WHERE lot_id=l.id ORDER BY id FOR UPDATE;
 UPDATE public.red_mail_mesaje SET stare='necunoscut',eroare_cod='lease_expirat' WHERE lot_id=l.id AND stare='in_apel' AND lease_pana<=now();
 UPDATE public.red_mail_mesaje SET stare=CASE WHEN l.stare IN ('incheiat','blocat_integritate') THEN 'anulat' ELSE 'in_coada' END,rezervat_la=NULL,lease_token=NULL,lease_pana=NULL WHERE lot_id=l.id AND stare='rezervat' AND lease_pana<=now();
 cod:=public.fn_red_mail_f2_poate(l);
 IF cod='lot_integritate' THEN UPDATE public.red_mail_loturi SET stare='blocat_integritate',versiune=versiune+1 WHERE id=l.id; PERFORM public.fn_red_mail_f2_audit(l.id,NULL,cod); END IF;
 IF cod='aprobare_expirata' THEN UPDATE public.red_mail_mesaje SET stare='anulat',eroare_cod=cod WHERE lot_id=l.id AND stare='in_coada'; END IF;
 IF cod IS NOT NULL THEN RETURN; END IF;
 IF (SELECT count(*) FROM public.red_mail_mesaje WHERE stare IN ('rezervat','in_apel','necunoscut'))>=50 THEN RETURN; END IF;
 IF (SELECT count(*) FROM public.red_mail_mesaje WHERE rezervat_la IS NOT NULL AND (rezervat_la AT TIME ZONE 'Europe/Bucharest')::date=(now() AT TIME ZONE 'Europe/Bucharest')::date)>=s.plafon_zi OR (SELECT count(*) FROM public.red_mail_mesaje WHERE rezervat_la IS NOT NULL AND date_trunc('month',rezervat_la AT TIME ZONE 'Europe/Bucharest')=date_trunc('month',now() AT TIME ZONE 'Europe/Bucharest'))>=s.plafon_luna THEN RETURN; END IF;
 -- 20261131i: mesajele în coadă, în ordinea id-ului (toate blocate FOR UPDATE mai sus); o anulare LOCALĂ (opt-out, token expirat) nu oprește coada —
 -- se trece la următorul; se întoarce cel mult UN mesaj rezervat; zero rânduri = chiar nu mai e nimic de rezervat (coadă goală / plafon / extern oprit)
 FOR m IN SELECT * FROM public.red_mail_mesaje WHERE lot_id=l.id AND stare='in_coada' ORDER BY id LOOP
  IF EXISTS(SELECT 1 FROM public.red_mail_optout WHERE email=m.catre AND activ) THEN UPDATE public.red_mail_mesaje SET stare='anulat',eroare_cod='optout' WHERE id=m.id; CONTINUE; END IF;
  -- linkul personal din snapshot ar fi mort (token expirat / deținător șters între crearea lotului și trimitere): anulat, fără apel, fără retrimitere
  IF public.fn_red_mail_f2_token(m.detinator_id) IS NULL THEN UPDATE public.red_mail_mesaje SET stare='anulat',eroare_cod='token_expirat' WHERE id=m.id; PERFORM public.fn_red_mail_f2_audit(l.id,m.id,'anulat'); CONTINUE; END IF;
  IF NOT s.extern_permis AND split_part(m.catre,'@',2)<>'gazpet.ro' THEN RETURN; END IF;
  IF l.stare='aprobat' THEN UPDATE public.red_mail_loturi SET stare='in_trimitere',versiune=versiune+1 WHERE id=l.id; END IF;
  UPDATE public.red_mail_mesaje SET stare='rezervat',lease_token=gen_random_uuid(),lease_pana=now()+interval '2 minutes',rezervat_la=now(),rezervare_nr=rezervare_nr+1 WHERE id=m.id RETURNING * INTO m;
  PERFORM public.fn_red_mail_f2_audit(l.id,m.id,'rezervat'); RETURN NEXT m; RETURN;
 END LOOP;
 RETURN;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_rezerva(uuid) IS 'Redări e-mail F2 (owner): rezervă următorul mesaj al lotului sub lock (setări → lot → proiect FOR SHARE → mesaje). 20261131h: proiectul FOR SHARE. 20261131i: un mesaj al cărui deținător nu mai are token valid trece în anulat (token_expirat) și rezervarea trece la următorul mesaj din coadă (la fel după opt-out); zero rânduri = nimic de rezervat.';

-- ─── 9. autorizarea apelului: token devenit invalid = false + mesaj anulat (token_expirat), niciun apel (corpul 20261131h + o condiție) ──
CREATE OR REPLACE FUNCTION public.fn_red_mail_apel_incepe(p_mesaj uuid,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE l public.red_mail_loturi; m public.red_mail_mesaje; cod text; s public.red_mail_setari;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 -- Ordine: setări -> lot -> proiect (FOR SHARE, 20261131h) -> mesaj; primul SELECT al id-ului nu blochează.
 SELECT * INTO s FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;  -- r3 (Gem r2 P2-02)
 SELECT * INTO l FROM public.red_mail_loturi WHERE id=(SELECT lot_id FROM public.red_mail_mesaje WHERE id=p_mesaj) FOR UPDATE;
 -- 20261131h: proiectul FOR SHARE (vezi fn_red_mail_rezerva); autorizarea apelului HTTP nu poate fi dată cu un cod de proiect care se schimbă în paralel
 PERFORM 1 FROM public.red_proiecte WHERE id=l.proiect_id FOR SHARE;
 SELECT * INTO m FROM public.red_mail_mesaje WHERE id=p_mesaj FOR UPDATE;
 IF NOT FOUND OR m.stare<>'rezervat' OR m.lease_token IS DISTINCT FROM p_token OR m.lease_pana<=now() THEN RETURN false; END IF;
 cod:=public.fn_red_mail_f2_poate(l);
 IF cod='lot_integritate' THEN UPDATE public.red_mail_loturi SET stare='blocat_integritate',versiune=versiune+1 WHERE id=l.id; PERFORM public.fn_red_mail_f2_audit(l.id,m.id,cod); END IF;
 IF cod IS NOT NULL OR (NOT s.extern_permis AND split_part(m.catre,'@',2)<>'gazpet.ro') OR EXISTS(SELECT 1 FROM public.red_mail_optout WHERE email=m.catre AND activ) OR s.ultim_apel_la>now()-interval '2 seconds' THEN RETURN false; END IF;
 -- 20261131i: tokenul a devenit invalid între rezervare și autorizare: mesajul se anulează (token_expirat), niciun apel Gmail
 IF public.fn_red_mail_f2_token(m.detinator_id) IS NULL THEN UPDATE public.red_mail_mesaje SET stare='anulat',eroare_cod='token_expirat' WHERE id=m.id; PERFORM public.fn_red_mail_f2_audit(l.id,m.id,'anulat'); RETURN false; END IF;
 UPDATE public.red_mail_mesaje SET stare='in_apel',apel_inceput_la=now() WHERE id=m.id;
 UPDATE public.red_mail_setari SET ultim_apel_la=now() WHERE id=1;
 PERFORM public.fn_red_mail_f2_audit(l.id,m.id,'apel_inceput'); RETURN true;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_apel_incepe(uuid,uuid) IS 'Redări e-mail F2 (owner): autorizează UN apel Gmail pentru mesajul rezervat (CAS pe lease). 20261131h: proiectul FOR SHARE. 20261131i: fără token valid al deținătorului = false, mesajul anulat (token_expirat), niciun apel.';

-- ─── 10. Drepturi: funcțiile interne doar proprietarul; fn_red_mail_f2_campuri = owner (authenticated, verificat în corp); nimic pentru PUBLIC / anon ──
REVOKE ALL ON FUNCTION public.fn_red_link_raspuns(text), public.fn_red_mail_f2_token(uuid), public.fn_red_mail_f2_campuri(uuid,uuid), public.fn_red_mail_f2_completeaza(text,jsonb),
  public.fn_red_mail_f2_link_strain(text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_mail_f2_campuri(uuid,uuid) TO authenticated;

-- ─── 11. Postcondiții ───────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE v_rau text; v_def text; v_link text;
BEGIN
  -- corpurile noi (amprentele: AMPRENTE-NOI 20261131i — aceleași constante în revenire) + proprietățile
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      -- >>> AMPRENTE-NOI 20261131i
      ('public.fn_red_link_raspuns(text)', '6732f7c215cac70f630f08c572a24d65', 'sql', false, 'i', 'text'),
      ('public.fn_red_mail_f2_token(uuid)', '604a8adddf23112c5c0f70c89cff0244', 'sql', false, 's', 'text'),
      ('public.fn_red_mail_f2_campuri(uuid,uuid)', '503dc3c94d4e255ac5e827658b38a0ff', 'plpgsql', true, 's', 'jsonb'),
      ('public.fn_red_mail_f2_completeaza(text,jsonb)', '61331ec6fc15d05e02517825877084d6', 'plpgsql', false, 'i', 'text'),
      ('public.fn_red_mail_f2_link_strain(text,text)', 'fee77863c42c77d1d363eae4145ebf2d', 'plpgsql', false, 's', 'boolean'),
      ('public.fn_red_mail_destinatari(uuid,uuid,uuid)', 'b1fbfaf746f1e05fd88f9204bfbbea68', 'plpgsql', true, 's', 'record'),
      ('public.fn_red_mail_lot_creeaza(uuid,uuid,uuid,uuid[],text,text)', 'bff52e712db5084b48eefd3824ca7283', 'plpgsql', true, 'v', 'uuid'),
      ('public.fn_red_mail_rezerva(uuid)', 'dbd0cbf99e8e2e0715441333ad17664c', 'plpgsql', true, 'v', 'public.red_mail_mesaje'),
      ('public.fn_red_mail_apel_incepe(uuid,uuid)', '9dc0d38f7ad39238618463e0fa7892b6', 'plpgsql', true, 'v', 'boolean')
      -- <<< AMPRENTE-NOI 20261131i
    ) a(semnatura, amprenta, limbaj, definer, volatil, intoarce)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
   WHERE p.oid IS NULL
      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = a.limbaj)
      OR p.prosecdef IS DISTINCT FROM a.definer
      OR p.provolatile IS DISTINCT FROM a.volatil
      OR p.prorettype IS DISTINCT FROM a.intoarce::regtype::oid
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres';
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20261131i: postconditie: functiile (corp / proprietati) difera: %', v_rau; END IF;
  IF (SELECT p.proretset FROM pg_proc p WHERE p.oid = 'public.fn_red_mail_rezerva(uuid)'::regprocedure) IS NOT TRUE
     OR (SELECT p.proretset FROM pg_proc p WHERE p.oid = 'public.fn_red_mail_destinatari(uuid,uuid,uuid)'::regprocedure) IS NOT TRUE THEN
    RAISE EXCEPTION '20261131i: postconditie: fn_red_mail_rezerva / fn_red_mail_destinatari nu mai sunt SETOF';
  END IF;
  -- fn_red_mail_f2_poate (gărzile trimiterii din 20261131h) NEATINSĂ
  IF (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p WHERE p.oid = 'public.fn_red_mail_f2_poate(public.red_mail_loturi)'::regprocedure) IS DISTINCT FROM '01d3390b765bedc9fd64801f113109c9' THEN
    RAISE EXCEPTION '20261131i: postconditie: fn_red_mail_f2_poate s-a schimbat';
  END IF;
  -- drepturile: funcțiile înlocuite = EXACT ACL-ul de dinainte; cele noi: campuri = owner (authenticated), restul doar postgres
  IF EXISTS (SELECT 1 FROM red_acl_20261131i a JOIN pg_proc p ON p.oid = to_regprocedure(a.functie)
              WHERE coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM a.acl)
     OR (SELECT count(*) FROM red_acl_20261131i) <> 4
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.fn_red_mail_f2_campuri(uuid,uuid)'::regprocedure
                 AND coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}')
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN ('public.fn_red_link_raspuns(text)'::regprocedure, 'public.fn_red_mail_f2_token(uuid)'::regprocedure, 'public.fn_red_mail_f2_completeaza(text,jsonb)'::regprocedure,
                                                        'public.fn_red_mail_f2_link_strain(text,text)'::regprocedure)
                 AND coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM '{postgres=X/postgres}') THEN
    RAISE EXCEPTION '20261131i: postconditie: drepturile functiilor difera';
  END IF;
  -- CHECK-ul jurnalului: exact lista veche + `campuri`
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c WHERE c.conrelid = 'public.red_mail_jurnal_f2'::regclass AND c.conname = 'red_mail_jurnal_f2_cod_check';
  IF v_def IS DISTINCT FROM 'CHECK ((cod = ANY (ARRAY[''creat''::text, ''aprobat''::text, ''rezervat''::text, ''apel_inceput''::text, ''trimis''::text, ''esuat_sigur''::text, ''necunoscut''::text, ''esuat_confirmat''::text, ''anulat''::text, ''lot_integritate''::text, ''lot_incheiat''::text, ''golit''::text, ''lot_sters_final''::text, ''setari''::text, ''optout''::text, ''campuri''::text])))' THEN
    RAISE EXCEPTION '20261131i: postconditie: red_mail_jurnal_f2_cod_check (%)', coalesce(v_def, 'lipsa');
  END IF;
  -- linkul: forma exactă a convocatorului; un token cu altă formă nu produce link
  SELECT public.fn_red_link_raspuns(repeat('a', 43)) INTO v_link;
  IF v_link IS DISTINCT FROM 'https://redari.gazpet.ro/redari/raspuns/' || repeat('a', 43) OR public.fn_red_link_raspuns(repeat('a', 42)) IS NOT NULL OR public.fn_red_link_raspuns(NULL) IS NOT NULL THEN
    RAISE EXCEPTION '20261131i: postconditie: fn_red_link_raspuns';
  END IF;
  -- completarea: câmp necunoscut / necompletabil refuzate, nimic cu acolade (verificat pe valori fictive, fără date)
  IF public.fn_red_mail_f2_completeaza('a {X} b {Y}', '{"X":"1","Y":"2"}'::jsonb) IS DISTINCT FROM 'a 1 b 2' THEN RAISE EXCEPTION '20261131i: postconditie: completarea'; END IF;
  BEGIN PERFORM public.fn_red_mail_f2_completeaza('a {Z}', '{"X":"1"}'::jsonb); RAISE EXCEPTION '20261131i: postconditie: campul necunoscut a trecut';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.fn_red_mail_f2_completeaza('a {X}', '{"X":null}'::jsonb); RAISE EXCEPTION '20261131i: postconditie: campul necompletabil a trecut';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  -- r2: nicio acoladă rămasă, oricât de lung ar fi numele (41 de caractere), „{}” gol, acoladă neînchisă, „{ X }” cu spații
  BEGIN PERFORM public.fn_red_mail_f2_completeaza('a {' || repeat('Y', 41) || '}', '{"X":"1"}'::jsonb); RAISE EXCEPTION '20261131i: postconditie: campul de 41 de caractere a trecut';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.fn_red_mail_f2_completeaza('a {} b', '{"X":"1"}'::jsonb); RAISE EXCEPTION '20261131i: postconditie: acoladele goale au trecut';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.fn_red_mail_f2_completeaza('a {X b', '{"X":"1"}'::jsonb); RAISE EXCEPTION '20261131i: postconditie: acolada neinchisa a trecut';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.fn_red_mail_f2_completeaza('a { X }', '{"X":"1"}'::jsonb); RAISE EXCEPTION '20261131i: postconditie: campul cu spatii a trecut';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  -- r2 + r3: linkul străin (valori fictive): calea formularului pe orice origine, oricum scrisă (codificată %XX / dublu, entitate HTML, majuscule, spații)
  --   = străină față de NULL și față de alt token; linkul EXACT al destinatarului = nu; „20%” și un URL străin codificat = nu
  IF public.fn_red_mail_f2_link_strain('x https://oricare.invalid/redari/raspuns/' || repeat('a', 43) || ' y', NULL) IS NOT TRUE
     OR public.fn_red_mail_f2_link_strain('x /redari/raspuns/' || repeat('a', 43), repeat('b', 43)) IS NOT TRUE
     OR public.fn_red_mail_f2_link_strain('x ' || public.fn_red_link_raspuns(repeat('a', 43)) || ' y', repeat('a', 43)) IS NOT FALSE
     OR public.fn_red_mail_f2_link_strain('x ' || public.fn_red_link_raspuns(repeat('a', 43)) || ' y', NULL) IS NOT TRUE
     OR public.fn_red_mail_f2_link_strain('x /redari/raspuns/' || repeat('a', 44), NULL) IS NOT TRUE
     OR public.fn_red_mail_f2_link_strain('x https://redari.gazpet.ro/%72edari%2Fraspuns%2F' || repeat('a', 43), NULL) IS NOT TRUE
     OR public.fn_red_mail_f2_link_strain('x https://redari.gazpet.ro/%2572edari/raspuns/', NULL) IS NOT TRUE
     OR public.fn_red_mail_f2_link_strain('x /REDARI/Raspuns/ y', NULL) IS NOT TRUE
     OR public.fn_red_mail_f2_link_strain('x /redari/ ras&#112;uns/ y', NULL) IS NOT TRUE
     OR public.fn_red_mail_f2_link_strain('Reducere 20% la https://exemplu.invalid/plan%20lucrari.pdf', NULL) IS NOT FALSE
     OR public.fn_red_mail_f2_link_strain('fara link ' || repeat('a', 43), NULL) IS NOT FALSE
     OR public.fn_red_mail_f2_link_strain(NULL, NULL) IS NOT FALSE THEN
    RAISE EXCEPTION '20261131i: postconditie: fn_red_mail_f2_link_strain';
  END IF;
  -- tokenul rămâne izolat exact ca înainte (nimic lărgit); mesajele tot doar owner, fără scriere pentru roluri; nicio urmă L14 încă
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'red_detinatori_token') <> 1
     OR has_any_column_privilege('authenticated', 'public.red_detinatori_token', 'INSERT') OR has_any_column_privilege('authenticated', 'public.red_detinatori_token', 'UPDATE')
     OR has_table_privilege('anon', 'public.red_detinatori_token', 'SELECT') OR has_table_privilege('anon', 'public.red_mail_mesaje', 'SELECT')
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'red_mail_mesaje') <> 1
     OR has_table_privilege('authenticated', 'public.red_mail_mesaje', 'INSERT') OR has_table_privilege('authenticated', 'public.red_mail_mesaje', 'UPDATE') OR has_table_privilege('authenticated', 'public.red_mail_mesaje', 'DELETE')
     OR has_table_privilege('service_role', 'public.red_mail_mesaje', 'UPDATE')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.red_mail_mesaje'::regclass) OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.red_detinatori_token'::regclass) THEN
    RAISE EXCEPTION '20261131i: postconditie: RLS / drepturile pe red_detinatori_token / red_mail_mesaje';
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_mail_jurnal_f2 j WHERE j.cod = 'campuri') OR EXISTS (SELECT 1 FROM public.red_mail_mesaje m WHERE m.eroare_cod = 'token_expirat') THEN
    RAISE EXCEPTION '20261131i: postconditie: istoric al campurilor aparut in timpul migrarii';
  END IF;
  RAISE NOTICE '20261131i: sfarsit la % ms de la BEGIN; lock-ul puternic tinut % ms', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::bigint / 1000.0);
END $post$;
