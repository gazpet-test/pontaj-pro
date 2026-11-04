-- Revenire 20261130k_redari_mail_f1_reguli. Runner: o tranzacție, GUC gazpet.revenire_20261130k = 'REDARI_MAIL_F1_REGULI_SCOS:' || txid_current().
-- Scoate DOAR regulile (triggerele + funcțiile din k); tabelele lui j rămân. NU șterge date.
-- REFUZĂ dacă regulile protejează deja date reale: răspunsuri canal = email, rânduri de sursă, mesaje / adrese / evenimente / tombstone-uri /
-- state OAuth, sau dacă rândurile inițiale au fost schimbate. Ordinea: întâi această revenire, apoi revenirea lui j.
DO $rev$
DECLARE f text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130k', true) IS DISTINCT FROM 'REDARI_MAIL_F1_REGULI_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261130k revenire: garda invalida';
  END IF;
  -- Jak #987 r3 / r4: lock_timeout 500ms (per achiziție de lock) reduce riscul ca o tranzacție a aplicației să fie anulată; NU îl elimină —
  -- un scriitor care așteaptă deja poate fi ales de detectorul de deadlock (presupune deadlock_timeout implicit și în sesiunea lui).
  -- Risc rezidual acceptat doar prin aplicare noaptea, cu reluare la eșec. Preflight: deadlock_timeout strict peste lock_timeout, altfel refuz.
  PERFORM set_config('lock_timeout', '500ms', true);
  IF current_setting('deadlock_timeout')::interval <= current_setting('lock_timeout')::interval THEN
    RAISE EXCEPTION '%: deadlock_timeout (%) trebuie sa fie strict peste lock_timeout (%)', '20261130k revenire', current_setting('deadlock_timeout'), current_setting('lock_timeout');
  END IF;
  IF to_regprocedure('public.fn_red_mail_are_legatura_juridica(uuid)') IS NULL THEN RAISE EXCEPTION '20261130k revenire: migrarea lipseste'; END IF;
  -- Jak #987 P1-3 (L01 / L06): blocările ÎNAINTEA verificărilor „fără date”, ținute până la commit (ACCESS EXCLUSIVE = modul cerut de DROP TRIGGER).
  -- Ordinea unică red_mail F1 (antetul preflight-ului 20261130j): red_raspunsuri → red_proiecte → (storage.objects, red_jurnal: neatinse)
  -- → red_mail_* (alfabetic).
  LOCK TABLE public.red_raspunsuri IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.red_proiecte IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.red_mail_adrese_propuse, public.red_mail_dedup, public.red_mail_evenimente, public.red_mail_flux, public.red_mail_oauth_state,
             public.red_mail_obiecte, public.red_mail_primite, public.red_mail_raspuns_sursa, public.red_mail_setari IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.red_raspunsuri WHERE canal = 'email') OR EXISTS (SELECT 1 FROM public.red_mail_raspuns_sursa)
     OR EXISTS (SELECT 1 FROM public.red_mail_primite) OR EXISTS (SELECT 1 FROM public.red_mail_obiecte) OR EXISTS (SELECT 1 FROM public.red_mail_dedup)
     OR EXISTS (SELECT 1 FROM public.red_mail_evenimente) OR EXISTS (SELECT 1 FROM public.red_mail_adrese_propuse) OR EXISTS (SELECT 1 FROM public.red_mail_oauth_state)
     OR (SELECT count(*) FROM public.red_mail_flux) <> 2 OR EXISTS (SELECT 1 FROM public.red_mail_flux WHERE activ OR mod_cursor <> 'neinitializat' OR data_start IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.red_mail_setari WHERE citire_activa OR retentie_activa OR golire_gmail_activa) THEN
    RAISE EXCEPTION '20261130k revenire REFUZATA: regulile protejeaza deja date (raspunsuri email / sursa / mesaje / adrese / fluxuri pornite)' USING ERRCODE = '55000';
  END IF;
  DROP TRIGGER trg_red_raspunsuri_mail_sursa ON public.red_raspunsuri;
  DROP TRIGGER trg_red_raspunsuri_zz_mail ON public.red_raspunsuri;
  DROP TRIGGER trg_red_proiecte_retentie_mail ON public.red_proiecte;
  DROP TRIGGER trg_red_mail_sursa_reguli ON public.red_mail_raspuns_sursa;
  DROP TRIGGER trg_red_mail_primite_reguli ON public.red_mail_primite;
  DROP TRIGGER trg_red_mail_obiecte_reguli ON public.red_mail_obiecte;
  DROP TRIGGER trg_red_mail_dedup_reguli ON public.red_mail_dedup;
  DROP TRIGGER trg_red_mail_flux_reguli ON public.red_mail_flux;
  DROP TRIGGER trg_red_mail_evenimente_reguli ON public.red_mail_evenimente;
  DROP TRIGGER trg_red_mail_evenimente_fara_truncate ON public.red_mail_evenimente;
  DROP TRIGGER trg_red_mail_adrese_reguli ON public.red_mail_adrese_propuse;
  DROP TRIGGER trg_red_mail_oauth_state_reguli ON public.red_mail_oauth_state;
  DROP TRIGGER trg_red_mail_setari_reguli ON public.red_mail_setari;
  DROP TRIGGER trg_red_mail_fara_truncate ON public.red_mail_setari;
  DROP TRIGGER trg_red_versiune ON public.red_mail_setari;
  DROP TRIGGER trg_red_versiune ON public.red_mail_flux;
  DROP TRIGGER trg_red_versiune ON public.red_mail_primite;
  DROP TRIGGER trg_red_versiune ON public.red_mail_adrese_propuse;
  -- funcțiile (fără CASCADE: o dependență neașteptată = eroare, deci tranzacția se anulează)
  FOREACH f IN ARRAY ARRAY['public.fn_red_mail_raspuns_sursa_ceruta()', 'public.fn_red_mail_raspuns_protejat()', 'public.fn_red_mail_sursa_reguli()',
      'public.fn_red_mail_primite_reguli()', 'public.fn_red_mail_obiecte_reguli()', 'public.fn_red_mail_dedup_reguli()', 'public.fn_red_mail_flux_reguli()',
      'public.fn_red_mail_evenimente_reguli()', 'public.fn_red_mail_adrese_reguli()', 'public.fn_red_mail_oauth_state_reguli()', 'public.fn_red_mail_setari_reguli()',
      'public.fn_red_mail_proiect_retentie()', 'public.fn_red_mail_numaratori(uuid)', 'public.fn_red_mail_gmail_tranzitie_ok(text,text)',
      'public.fn_red_mail_referinta_obiectii(text,uuid)', 'public.fn_red_mail_are_legatura_juridica(uuid)'] LOOP
    EXECUTE 'DROP FUNCTION ' || f;
  END LOOP;
  -- starea finală = exact starea după j
  PERFORM public.fn_red_mail_verifica_baza('dupa_j');
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_raspunsuri'::regclass AND NOT tgisinternal) <> 3
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_proiecte'::regclass AND NOT tgisinternal) <> 2
     OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = 'public'::regnamespace AND c.relname ~ '^red_mail_' AND NOT t.tgisinternal) <> 7
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname ~ '^fn_red_mail_' AND proname <> 'fn_red_mail_verifica_baza') THEN
    RAISE EXCEPTION '20261130k revenire: stare finala gresita';
  END IF;
  RAISE NOTICE '20261130k revenire: regulile red_mail_* / proveniența red_raspunsuri scoase (tabelele 20261130j raman)';
END $rev$;
