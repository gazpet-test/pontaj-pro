-- Version 20261224120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 15000 --plafon-extins --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20261224a_executie_revendicari.l15.tsv (DOAR cu plafonul EXTINS — decizia proprietarului 22.11.2026, ca 20270105a /
--   20270106a: pe producție cele două fotografii L15 singure iau ~3 s, iar migrarea creează 9 tabele + 43 de funcții; --plafon-extins cere
--   fereastra orară 21:00–06:00, docs/LIVRARE_L15_V2.md §9 — ȘI cu amprenta globală L15 v2: fără pasul „înainte” al runnerului în aceeași
--   tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA; marcajul gazpet.livrare_migrare legat de txid).
-- L15 v2 (runda 3): lista OBIECTELOR din manifest e în supabase/tests/20261224a_executie_revendicari.l15.obiecte.tsv, generată pe PGlite cu
--   pașii reali ai runnerului (scripts/livrare_amprenta_gen.sh) și comparată la fiecare rulare a probei. Manifestul cu amprente
--   (supabase/migrations/20261224a_executie_revendicari.l15.tsv) NU e în acest PR: îl generează coordonatorul pe clona PG17
--   (docs/LIVRARE_L15_V2.md §7, pașii 3–4; rândurile = lista de mai sus), apoi proba cu ROLLBACK pe țintă (pasul 7). Pe lângă amprenta
--   globală, migrarea probează singură postcondițiile §9 pe DEFINIȚIA EXACTĂ a obiectelor ei (expresia normalizată a fiecărei politici,
--   amprenta md5 a corpului fiecărei funcții, funcția / evenimentul / condiția fiecărui trigger, un index pe fiecare cheie străină spre alt tabel).
-- Regula porților Izometrie (docs/izometrie/PORTI_REGULA.md, runda 3): tot DDL-ul e scris STATIC, cu numele obiectelor (fără format('%I')
--   în bucle), deci migrarea nu atinge perimetrul porților; singurul SQL dinamic rămas sunt cele trei CHECK-uri ale stărilor, pe tabele
--   numite, cu listele construite din funcțiile tranzițiilor (§3).
-- 20261224a_executie_revendicari — Execuție → dosarul de revendicare (pașii 1–2 din consultarea de arhitectură, 15.11.2026). Specificația:
--   docs/executie/REVENDICARI_SPEC.md (fluxul, matricea de acces, declanșatorii, cazurile de calcul, alegerile owner-ului presupuse).
--
-- Ce face (DOAR obiecte noi, nicio dată, niciun drept pe alte tabele; PRECIZARE: cheile străine noi spre 6 tabele existente adaugă pe
--   acestea trigger-ele referențiale interne ale PostgreSQL, iau la aplicare SHARE ROW EXCLUSIVE pe ele și schimbă un comportament: un rând
--   referit nu se mai poate șterge, vezi „Efect asupra altor module”):
--   * 9 tabele: executie_revendicari (dosarul), executie_revendicare_repere (legături dosar–reper din fișa contractului, cu confirmarea pe
--     versiune), _acte (notificare, detalieri, răspunsuri, dezacord, acord; stare separată de etapa dosarului), _comunicari (transmitere /
--     primire pe destinatar, cu dovada), _termene (regulă, declanșator, sursă, zile, dată propusă de server, dată confirmată de om), _dovezi
--     (exact o țintă: document / ordin de sistare / raport zilnic al proiectului dosarului), _jurnal (nemodificabil), _alerte (doar structura;
--     cronul vine la pasul 4), _chei (idempotența pe intenție, fără drepturi pentru aplicație).
--   * 2 vederi security_invoker: v_executie_revendicare_termene (starea calculată a termenului, „azi” în Europe/Bucharest) și
--     v_executie_revendicare_acte (datele comunicării, valabilitatea aprobării).
--   * Dreptul: O SINGURĂ funcție, fn_executie_revendicare_drept(proiect, nivel) (L19), folosită de RLS și de fiecare RPC. Niveluri:
--     citire / scriere = owner, administrator Execuție, MP-ul desemnat al proiectului (profiles.employee_id = executie_proiecte.mp_employee_id,
--     cu orice nivel pe modulul executie); administrare = owner, administrator Execuție; aprobare = owner. Pentru toți în afară de owner se
--     aplică și restricția pe proiect din 20261209a (fn_executie_proiect_permis; scrierea cere lista de scriere).
--   * Scrierea: DOAR prin 10 RPC-uri SECURITY DEFINER (identitatea din auth.uid(), NULL = refuz; cheie UUID per intenție; CAS pe versiune;
--     fiecare referință verificată pe proiectul / dosarul ei). Nicio scriere directă (fără INSERT / UPDATE / DELETE pentru anon /
--     authenticated / service_role).
--   * Trigger-e pe orice cale: proveniența (versiune, creat_*, modificat_*, proiectul copilului luat din dosar, dosar / proiect imuabile),
--     calculul termenului (data propusă o pune serverul; schimbarea intrărilor invalidează confirmările), jurnalul (AFTER, aceeași
--     tranzacție), jurnalul nemodificabil (UPDATE / DELETE / TRUNCATE = refuz).
--   * „Decăzut” nu se setează automat: singura scriere a riscului 'decadere_constatata' e RPC-ul fn_executie_revendicare_risc, la nivel
--     administrare, cu motiv (postcondiție: niciun alt corp nu conține valoarea). La depășire, termenul apare „depasit_risc_decadere”.
-- Ordinea lock-urilor (L06), aceeași în toate RPC-urile: (1) lock consultativ pe cheia intenției -> (2) dosarul FOR UPDATE (proiectul
--   citit și dreptul verificat ÎNAINTE de lock; DUPĂ lock, într-o instrucțiune nouă = instantaneu nou, se reverifică proiectul ȘI dreptul,
--   L01: o desemnare / permisiune retrasă cât apelul aștepta = refuz) -> (3) rândul-copil FOR UPDATE (actul, apoi comunicarea; termenul;
--   legătura; dovada) -> (4) rândurile ALTOR module (reper din fișa contractului, document, ordin, raport + șantier) FOR SHARE NOWAIT, la
--   final (ocupat = 55P03, nimic scris; proiectul lor comparat înainte de lock, ca un rând ocupat al altui proiect să dea același refuz)
--   -> (5) scrierea, jurnalul (trigger) și cheia. Trigger-ele nu iau alte lock-uri decât FK-urile implicite (KEY SHARE pe părinți).
--   Revenirea: aceleași tabele, aceeași ordine, ACCESS EXCLUSIVE NOWAIT.
-- Efect asupra altor module (de aprobat; ALEGERE DE ARHIVARE, spec §5): un document / ordin / raport legat O DATĂ ca dovadă (sau ca
--   exemplar semnat / dovadă a comunicării) nu se mai poate șterge NICIODATĂ din modulul lui (FK fără CASCADE). Blocarea e PERMANENTĂ:
--   „scoaterea” dovezii doar o dezactivează, anularea comunicării / actului și închiderea dosarului păstrează referința, iar dezlegarea
--   reală nu există (niciun RPC, nicio scriere directă). Varianta alternativă (decizia owner-ului): dezlegare reală de către administrare,
--   cu motiv, DOAR înainte să fie transmis vreun act care citează dovada. Fiecare cheie străină spre alt tabel are index (postcondiție),
--   ca verificarea ei la ștergerea sursei să nu scaneze tabelul.
-- Ce NU face: ecran, DOCX, cron, import, AI; nu atinge executie_contract_repere, executie_proiecte, inventarul din 20261209a (tabelele noi
--   au propriul predicat, care include restricția pe proiect — clasa „drept”; adăugarea în inventar e o migrare separată).
-- Revenire: supabase/revenire/20261224a_executie_revendicari_ROLLBACK.sql. Probe: scripts/pglite/test_executie_revendicari_local.mjs.
DO $pre$
DECLARE r record; v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261224a_executie_revendicari:' || txid_current() THEN
    RAISE EXCEPTION '20261224a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261224a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261224a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261224a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '15000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '15000:' || txid_current() THEN
    RAISE EXCEPTION '20261224a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 15000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 15000 --plafon-extins)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tabela lui temporară, creată de tranzacția curentă și blocată de ea)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20261224a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  -- lock-urile IMPLICITE de după setul blocului $lock$ (FK-urile la CREATE TABLE pe aceleași 6 tabele, deja ținute; citiri de catalog):
  -- fiecare așteptare limitată la 100 ms (apoi eroare, nimic comis), nu coadă în spatele aplicației
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND (c.relname ~ '^executie_revendicar' OR c.relname ~ '^v_executie_revendicar'))
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_revendicare\_%') THEN
    RAISE EXCEPTION '20261224a: obiectele exista deja (reaplicare)';
  END IF;
  -- dependențele: coloanele citite, cu tipurile acceptate (unele tabele sunt create direct în producție: se verifică, nu se presupun)
  FOR r IN SELECT * FROM (VALUES
      ('executie_proiecte', 'id', 'bigint'), ('executie_proiecte', 'mp_employee_id', 'integer|bigint'),
      ('profiles', 'id', 'uuid'), ('profiles', 'is_owner', 'boolean'), ('profiles', 'employee_id', 'integer|bigint'),
      ('user_module_access', 'profile_id', 'uuid'), ('user_module_access', 'module', 'text'), ('user_module_access', 'access_level', 'text'),
      ('executie_contract_repere', 'id', 'bigint'), ('executie_contract_repere', 'proiect_id', 'bigint'),
      ('executie_contract_repere', 'versiune', 'integer'), ('executie_contract_repere', 'activ', 'boolean'),
      ('executie_contract_repere', 'titlu', 'text'), ('executie_contract_repere', 'clauze', 'text'), ('executie_contract_repere', 'continut', 'text'),
      ('executie_contract_repere', 'citat', 'text'), ('executie_contract_repere', 'conditie', 'text'),
      ('executie_contract_repere', 'termen_text', 'text'), ('executie_contract_repere', 'efect', 'text'), ('executie_contract_repere', 'sursa', 'text'),
      ('documente_proiect', 'id', 'integer|bigint'), ('documente_proiect', 'proiect_id', 'integer|bigint'), ('documente_proiect', 'hash_sha256', 'text'),
      ('executie_ordine_sistare', 'id', 'integer|bigint'), ('executie_ordine_sistare', 'proiect_id', 'integer|bigint'),
      ('rapoarte_zilnice', 'id', 'integer|bigint'), ('rapoarte_zilnice', 'site_id', 'integer|bigint'),
      ('sites', 'id', 'integer|bigint'), ('sites', 'proiect_id', 'integer|bigint')) v(t, c, tip) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.' || r.t) AND a.attname = r.c AND NOT a.attisdropped
                    AND format_type(a.atttypid, a.atttypmod) = ANY (string_to_array(r.tip, '|'))) THEN
      RAISE EXCEPTION '20261224a: dependenta lipsa / alt tip: %.% (cerut %)', r.t, r.c, r.tip;
    END IF;
  END LOOP;
  -- cheile primare referite de FK-urile noi
  FOR r IN SELECT * FROM (VALUES ('executie_proiecte'), ('executie_contract_repere'), ('documente_proiect'), ('executie_ordine_sistare'),
                                 ('rapoarte_zilnice'), ('profiles')) v(t) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = to_regclass('public.' || r.t) AND k.contype = 'p'
                    AND k.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = to_regclass('public.' || r.t) AND attname = 'id')]) THEN
      RAISE EXCEPTION '20261224a: % nu are cheia primara pe id', r.t;
    END IF;
  END LOOP;
  IF to_regprocedure('auth.uid()') IS NULL THEN RAISE EXCEPTION '20261224a: auth.uid() lipsa'; END IF;
  -- restricția pe proiect (20261209a), cu corpul revizuit (amprentă md5 fără CR, DEFINER / search_path / proprietar ca acolo)
  IF EXISTS (SELECT 1 FROM (VALUES
          ('public.fn_executie_proiect_permis(bigint, boolean)', 'bd4320f76e9f36f492c7186c0a982155', true),
          ('public.fn_executie_acces_nerestrans()', 'b863c5324684dbf4eb9af81474fbc4e1', true),
          ('public.fn_executie_acces_lista(boolean)', 'd9e123a46b83530a7203d4a24da5cf9b', true),
          ('public.fn_executie_acces_nerestrans_cont(uuid)', '9a07e0089139e54ba5c6a0cfaaf093cc', false),
          ('public.fn_executie_acces_lista_cont(uuid, boolean)', 'e7cf9b852002a1c1cbe781772c33bf0c', false)) a(semnatura, amprenta, definer)
        LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
        WHERE p.oid IS NULL OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
           OR p.prosecdef IS DISTINCT FROM a.definer OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
           OR p.proowner IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname = current_user)) THEN
    RAISE EXCEPTION '20261224a: restrictia pe proiect (20261209a) difera de cea revizuita';
  END IF;
END $pre$;

-- ── punctul UNIC de blocare la aplicare (L06; docs/LIVRARE_L15_V2.md §9, „Bugetul de lock”), după verificările de catalog. Setul = tabelele
-- EXISTENTE referite de cheile străine noi, SHARE ROW EXCLUSIVE (modul pe care îl ia oricum CREATE TABLE … REFERENCES; oprește scrierile în
-- ele, nu citirile), ordinea FIXĂ: executie_proiecte -> executie_contract_repere -> documente_proiect -> executie_ordine_sistare ->
-- rapoarte_zilnice -> profiles. Bugetul = 1 s cu ceasul pornit IMEDIAT ÎNAINTEA PRIMEI ÎNCERCĂRI (v_t0), verificat ÎNAINTE de fiecare
-- încercare și DUPĂ obținerea setului complet; fiecare încercare = subtranzacție (eșecul unui lock eliberează lock-urile luate deja în ea,
-- înaintea pauzei). Inventarul lock-urilor IMPLICITE de după set: FK-urile la CREATE TABLE (aceleași 6 tabele, deja ținute la fel de tare),
-- trigger-ele / politicile / indexurile / vederile pe tabelele NOI (create în tranzacție) și citirile de catalog din postcondiții; funcțiile
-- create nu rulează la aplicare. Momentul obținerii (gazpet.lock_puternic_la, µs de la epoch) îl citește garda finală a runnerului (LOCK_TINUT).
-- profiles și documente_proiect sunt folosite de toată aplicația: aplicarea se face în fereastra plafonului extins (21:00–06:00).
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20261224a: BUGET_LOCK: % incercari, % ms de la prima incercare (bugetul lock-urilor e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000)
        USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.executie_proiecte IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.executie_contract_repere IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.documente_proiect IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.executie_ordine_sistare IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.rapoarte_zilnice IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20261224a: BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000)
      USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20261224a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ── 0. funcții fără tabele: ziua din România, numărul canonic, stările, tranzițiile ──────────────────────────────────────────────────────
-- ziua calendaristică a unui moment, în Europe/Bucharest (cu ora de vară / iarnă); NULL = NULL. L17: nu CURRENT_DATE (UTC pe server).
CREATE FUNCTION public.fn_executie_revendicare_zi(p_moment timestamptz) RETURNS date
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT (p_moment AT TIME ZONE 'Europe/Bucharest')::date
$f$;
CREATE FUNCTION public.fn_executie_revendicare_azi() RETURNS date
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT public.fn_executie_revendicare_zi(now())
$f$;
-- forma canonică a unui număr de înregistrare (L16): fără spații, litere mici. Aceeași în indexul unic și în verificarea din RPC.
CREATE FUNCTION public.fn_executie_revendicare_nr_canonic(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT nullif(lower(regexp_replace(p, '[[:space:]]+', '', 'g')), '')
$f$;
-- starea calculată a unui termen (L19: O SINGURĂ definiție, pentru vedere, cron și UI). „Decăzut” NU există: depășirea = risc.
-- Priorități: anulat; sursa de reverificat (ÎNAINTEA îndeplinirii, runda 2: o sursă invalidă face nesigură și data față de care se
-- judecă îndeplinirea); îndeplinit (tardiv / termen necunoscut / îndeplinire nevalabilă: p_indeplinit_la NULL = actul nu mai e compatibil,
-- transmis / primit și neanulat, vezi fn_executie_revendicare_indeplinire_la); fără dată confirmată (necunoscut / neconfirmat / neconfirmat
-- depășit); cu dată confirmată (în termen / scadent azi / depășit, risc de decădere).
CREATE FUNCTION public.fn_executie_revendicare_termen_stare(p_stare text, p_mod text, p_intrari_valide boolean, p_data_propusa date,
                                                            p_data_confirmata date, p_indeplinit_la date, p_azi date) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
BEGIN
  IF p_azi IS NULL OR p_stare IS NULL OR p_mod IS NULL THEN
    RAISE EXCEPTION 'revendicari: starea termenului cere ziua, starea si modul' USING ERRCODE = '22023';
  END IF;
  IF p_stare = 'anulat' THEN RETURN 'anulat'; END IF;
  IF p_stare NOT IN ('deschis', 'indeplinit') THEN RAISE EXCEPTION 'revendicari: stare de termen necunoscuta' USING ERRCODE = '22023'; END IF;
  IF p_intrari_valide IS NOT TRUE THEN RETURN 'sursa_de_reverificat'; END IF;
  IF p_stare = 'indeplinit' THEN
    IF p_indeplinit_la IS NULL THEN RETURN 'indeplinit_de_verificat'; END IF;
    IF p_data_confirmata IS NULL THEN RETURN 'indeplinit_termen_necunoscut'; END IF;
    RETURN CASE WHEN p_indeplinit_la > p_data_confirmata THEN 'indeplinit_tardiv' ELSE 'indeplinit' END;
  END IF;
  IF p_data_confirmata IS NULL THEN
    IF p_data_propusa IS NULL THEN RETURN 'necunoscut'; END IF;
    RETURN CASE WHEN p_azi > p_data_propusa THEN 'neconfirmat_depasit' ELSE 'neconfirmat' END;
  END IF;
  RETURN CASE WHEN p_azi > p_data_confirmata THEN 'depasit_risc_decadere' WHEN p_azi = p_data_confirmata THEN 'scadent_azi' ELSE 'in_termen' END;
END $f$;
-- tranzițiile etapei dosarului (L20: CHECK-ul coloanei etapa e generat din această listă). nivel = dreptul cerut; cere_tip / cere_sens =
-- actul care trebuie să existe TRANSMIS (ieșire) / PRIMIT (intrare) în dosar; cere_motiv = motiv obligatoriu.
CREATE FUNCTION public.fn_executie_revendicare_tranzitii()
RETURNS TABLE (din text, spre text, nivel text, cere_tip text, cere_sens text, cere_motiv boolean)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT * FROM (VALUES
    ('eveniment', 'notificat', 'scriere', 'notificare', 'iesire', false),
    ('eveniment', 'retras', 'scriere', NULL, NULL, true),
    ('notificat', 'retras', 'scriere', NULL, NULL, true),
    ('notificat', 'detaliere_initiala', 'scriere', 'detaliere_initiala', 'iesire', false),
    ('detaliere_initiala', 'detaliere_interimara', 'scriere', 'detaliere_interimara', 'iesire', false),
    ('detaliere_initiala', 'detaliere_finala', 'scriere', 'detaliere_finala', 'iesire', false),
    ('detaliere_interimara', 'detaliere_finala', 'scriere', 'detaliere_finala', 'iesire', false),
    ('detaliere_initiala', 'asteapta_raspuns', 'scriere', NULL, NULL, true),
    ('detaliere_finala', 'asteapta_raspuns', 'scriere', NULL, NULL, false),
    ('asteapta_raspuns', 'raspuns_primit', 'scriere', 'raspuns_beneficiar', 'intrare', false),
    ('asteapta_raspuns', 'dezacord', 'scriere', 'dezacord', 'iesire', false),
    ('raspuns_primit', 'dezacord', 'scriere', 'dezacord', 'iesire', false),
    ('raspuns_primit', 'acord', 'scriere', 'acord', NULL, false),
    ('dezacord', 'acord', 'scriere', 'acord', NULL, false),
    ('asteapta_raspuns', 'inchis', 'administrare', NULL, NULL, true),
    ('raspuns_primit', 'inchis', 'administrare', NULL, NULL, true),
    ('dezacord', 'inchis', 'administrare', NULL, NULL, true),
    ('acord', 'inchis', 'administrare', NULL, NULL, true),
    ('detaliere_initiala', 'retras', 'administrare', NULL, NULL, true),
    ('detaliere_interimara', 'retras', 'administrare', NULL, NULL, true),
    ('detaliere_finala', 'retras', 'administrare', NULL, NULL, true),
    ('asteapta_raspuns', 'retras', 'administrare', NULL, NULL, true),
    ('raspuns_primit', 'retras', 'administrare', NULL, NULL, true),
    ('dezacord', 'retras', 'administrare', NULL, NULL, true)
  ) t(din, spre, nivel, cere_tip, cere_sens, cere_motiv)
$f$;
-- tranzițiile stării unui act, pe sens. nivel 'comunicare' = DOAR prin fn_executie_revendicare_comunicare (înregistrarea transmiterii /
-- primirii reale, sau anularea ultimei comunicări): exportul, aprobarea sau semnarea NU duc la „transmis”.
CREATE FUNCTION public.fn_executie_revendicare_act_tranzitii()
RETURNS TABLE (sens text, din text, spre text, nivel text, cere_motiv boolean)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT * FROM (VALUES
    ('iesire', 'ciorna', 'de_aprobat', 'scriere', false),
    ('iesire', 'de_aprobat', 'ciorna', 'scriere', false),
    ('iesire', 'de_aprobat', 'aprobat', 'aprobare', false),
    ('iesire', 'aprobat', 'ciorna', 'scriere', false),
    ('iesire', 'aprobat', 'semnat', 'scriere', false),
    ('iesire', 'semnat', 'transmis', 'comunicare', false),
    ('iesire', 'transmis', 'transmis', 'comunicare', false),
    ('iesire', 'transmis', 'semnat', 'comunicare', false),
    ('iesire', 'ciorna', 'anulat', 'scriere', true),
    ('iesire', 'de_aprobat', 'anulat', 'scriere', true),
    ('iesire', 'aprobat', 'anulat', 'administrare', true),
    ('iesire', 'semnat', 'anulat', 'administrare', true),
    ('iesire', 'transmis', 'anulat', 'administrare', true),
    ('intrare', 'ciorna', 'primit', 'comunicare', false),
    ('intrare', 'primit', 'primit', 'comunicare', false),
    ('intrare', 'primit', 'ciorna', 'comunicare', false),
    ('intrare', 'ciorna', 'anulat', 'scriere', true),
    ('intrare', 'primit', 'anulat', 'administrare', true)
  ) t(sens, din, spre, nivel, cere_motiv)
$f$;
-- compatibilitatea obligație – act (runda 2, L19: O SINGURĂ listă, folosită de RPC-ul „îndeplinit” și de vedere prin
-- fn_executie_revendicare_indeplinire_la; CHECK-ul coloanei tip_obligatie e generat din ea, L20). Obligațiile noastre se îndeplinesc cu
-- actul de ieșire de ACELAȘI tip, transmis; termenele beneficiarului (răspunsuri) cu actul lui de intrare, primit. Nicio altă pereche:
-- o notificare nu închide termenul detalierii finale.
CREATE FUNCTION public.fn_executie_revendicare_obligatie_acte()
RETURNS TABLE (tip_obligatie text, tip_act text, sens text)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT * FROM (VALUES
    ('notificare', 'notificare', 'iesire'),
    ('detaliere_initiala', 'detaliere_initiala', 'iesire'),
    ('detaliere_interimara', 'detaliere_interimara', 'iesire'),
    ('detaliere_finala', 'detaliere_finala', 'iesire'),
    ('dezacord', 'dezacord', 'iesire'),
    ('raspuns_prelungire', 'raspuns_prelungire', 'intrare'),
    ('raspuns_principiu', 'raspuns_beneficiar', 'intrare'),
    ('raspuns_principiu', 'decizie', 'intrare'),
    ('alt', 'alt', 'iesire'),
    ('alt', 'alt', 'intrare')
  ) t(tip_obligatie, tip_act, sens)
$f$;

-- ── 1. dreptul: O SINGURĂ definiție (L19), boolean despre APELANT (inexistent = fără drept = fals) ────────────────────────────────────────
CREATE FUNCTION public.fn_executie_revendicare_drept(p_proiect bigint, p_nivel text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_nivel IN ('citire', 'scriere', 'administrare', 'aprobare')
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR (p_nivel <> 'aprobare'
             AND public.fn_executie_proiect_permis(p_proiect, p_nivel <> 'citire')
             AND (EXISTS (SELECT 1 FROM public.user_module_access u
                           WHERE u.profile_id = auth.uid() AND u.module = 'executie' AND u.access_level = 'admin')
                  OR (p_nivel IN ('citire', 'scriere')
                      AND EXISTS (SELECT 1 FROM public.user_module_access u
                                   WHERE u.profile_id = auth.uid() AND u.module = 'executie' AND u.access_level IN ('viewer', 'editor', 'admin'))
                      AND EXISTS (SELECT 1 FROM public.profiles p JOIN public.executie_proiecte e ON e.id = p_proiect
                                   WHERE p.id = auth.uid() AND p.employee_id IS NOT NULL AND e.mp_employee_id IS NOT NULL
                                     AND p.employee_id = e.mp_employee_id)))))
$f$;

-- ── 2. tabelele ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Textele: NULL sau nevide, cu plafon. Proveniența (versiune, creat_*, modificat_*) și proiectul copiilor le pune trigger-ul (L08).
CREATE TABLE public.executie_revendicari (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  titlu text NOT NULL CHECK (length(titlu) BETWEEN 1 AND 300 AND titlu ~ '[^[:space:]]'),
  descriere text CHECK (descriere IS NULL OR (length(descriere) <= 8000 AND descriere ~ '[^[:space:]]')),
  localizare text CHECK (localizare IS NULL OR (length(localizare) <= 1000 AND localizare ~ '[^[:space:]]')),
  contract_ref text CHECK (contract_ref IS NULL OR (length(contract_ref) <= 300 AND contract_ref ~ '[^[:space:]]')),
  data_eveniment date,
  data_constatare date,
  data_incetare date,
  caracter text NOT NULL DEFAULT 'necunoscut' CHECK (caracter IN ('punctual', 'continuu', 'necunoscut')),
  solicita_timp text NOT NULL DEFAULT 'de_stabilit' CHECK (solicita_timp IN ('da', 'nu', 'de_stabilit')),
  solicita_bani text NOT NULL DEFAULT 'de_stabilit' CHECK (solicita_bani IN ('da', 'nu', 'de_stabilit')),
  etapa text NOT NULL DEFAULT 'eveniment',
  etapa_motiv text CHECK (etapa_motiv IS NULL OR (length(etapa_motiv) <= 2000 AND etapa_motiv ~ '[^[:space:]]')),
  risc_juridic text NOT NULL DEFAULT 'neevaluat' CHECK (risc_juridic IN ('neevaluat', 'scazut', 'mediu', 'ridicat', 'decadere_constatata')),
  risc_motiv text CHECK (risc_motiv IS NULL OR (length(risc_motiv) <= 2000 AND risc_motiv ~ '[^[:space:]]')),
  versiune integer NOT NULL DEFAULT 1 CHECK (versiune > 0),
  creat_de uuid, creat_la timestamptz NOT NULL DEFAULT now(),
  modificat_de uuid, modificat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_revendicari_incetare CHECK (data_incetare IS NULL OR data_eveniment IS NULL OR data_incetare >= data_eveniment),
  CONSTRAINT executie_revendicari_risc_motiv CHECK (risc_juridic <> 'decadere_constatata' OR risc_motiv IS NOT NULL)
);
CREATE INDEX executie_revendicari_proiect_idx ON public.executie_revendicari (proiect_id, id);

-- legăturile dosar – reper din fișa contractului (executie_contract_repere). Copia textului se ia la legare și la confirmare; confirmarea
-- (administrare) fixează versiunea și amprenta reperului: orice schimbare ulterioară a reperului o invalidează (L03).
CREATE TABLE public.executie_revendicare_repere (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dosar_id bigint NOT NULL REFERENCES public.executie_revendicari(id),
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  reper_id bigint NOT NULL REFERENCES public.executie_contract_repere(id),
  rol text NOT NULL CHECK (rol IN ('temei', 'termen', 'cale', 'procedura', 'eveniment', 'sursa')),
  reper_versiune_legata integer NOT NULL CHECK (reper_versiune_legata > 0),
  titlu_copie text,
  citat_copie text,
  sursa_copie text,
  confirmat_de uuid, confirmat_la timestamptz,
  reper_versiune_confirmata integer CHECK (reper_versiune_confirmata > 0),
  reper_amprenta_confirmata text CHECK (reper_amprenta_confirmata ~ '^[0-9a-f]{32}$'),
  activ boolean NOT NULL DEFAULT true,
  motiv_scoatere text CHECK (motiv_scoatere IS NULL OR (length(motiv_scoatere) <= 2000 AND motiv_scoatere ~ '[^[:space:]]')),
  versiune integer NOT NULL DEFAULT 1 CHECK (versiune > 0),
  creat_de uuid, creat_la timestamptz NOT NULL DEFAULT now(),
  modificat_de uuid, modificat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_revendicare_repere_confirmare CHECK (
    (confirmat_la IS NULL AND confirmat_de IS NULL AND reper_versiune_confirmata IS NULL AND reper_amprenta_confirmata IS NULL)
    OR (confirmat_la IS NOT NULL AND reper_versiune_confirmata IS NOT NULL AND reper_amprenta_confirmata IS NOT NULL)),
  CONSTRAINT executie_revendicare_repere_scoatere CHECK (activ OR motiv_scoatere IS NOT NULL)
);
CREATE UNIQUE INDEX executie_revendicare_repere_uq ON public.executie_revendicare_repere (dosar_id, reper_id, rol) WHERE activ;
CREATE INDEX executie_revendicare_repere_reper_idx ON public.executie_revendicare_repere (reper_id);
CREATE INDEX executie_revendicare_repere_proiect_idx ON public.executie_revendicare_repere (proiect_id);

-- actele dosarului. Conținutul se editează DOAR în ciornă; aprobarea fixează revizia + amprenta conținutului; „transmis” / „primit” vin
-- DOAR din comunicări. Numerele (alegerea 3, varianta A): manuale; nr_iesire unic în toată firma, nr_beneficiar unic pe proiect și sens
-- (forma canonică, rândurile neanulate).
CREATE TABLE public.executie_revendicare_acte (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dosar_id bigint NOT NULL REFERENCES public.executie_revendicari(id),
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  tip text NOT NULL CHECK (tip IN ('notificare', 'detaliere_initiala', 'detaliere_interimara', 'detaliere_finala', 'cerere_prelungire_detaliere',
                                   'dezacord', 'raspuns_beneficiar', 'raspuns_prelungire', 'decizie', 'acord', 'alt')),
  sens text NOT NULL CHECK (sens IN ('iesire', 'intrare')),
  act_anterior_id bigint REFERENCES public.executie_revendicare_acte(id),
  revizie integer NOT NULL DEFAULT 1 CHECK (revizie > 0),
  stare text NOT NULL DEFAULT 'ciorna',
  titlu text NOT NULL CHECK (length(titlu) BETWEEN 1 AND 300 AND titlu ~ '[^[:space:]]'),
  rezumat text CHECK (rezumat IS NULL OR (length(rezumat) <= 8000 AND rezumat ~ '[^[:space:]]')),
  cronologie text CHECK (cronologie IS NULL OR (length(cronologie) <= 20000 AND cronologie ~ '[^[:space:]]')),
  temei text CHECK (temei IS NULL OR (length(temei) <= 8000 AND temei ~ '[^[:space:]]')),
  argumentare text CHECK (argumentare IS NULL OR (length(argumentare) <= 20000 AND argumentare ~ '[^[:space:]]')),
  nr_iesire text CHECK (nr_iesire IS NULL OR (length(nr_iesire) <= 100 AND nr_iesire ~ '[^[:space:]]')),
  nr_beneficiar text CHECK (nr_beneficiar IS NULL OR (length(nr_beneficiar) <= 100 AND nr_beneficiar ~ '[^[:space:]]')),
  data_document date,
  -- cuantificarea (alegerea 4, varianta A): NULL = necunoscut, NU zero; confirmarea se pierde la orice salvare fără bifă
  zile_solicitate integer CHECK (zile_solicitate BETWEEN 0 AND 3650),
  suma_a numeric(18,2) CHECK (suma_a >= 0),
  suma_b numeric(18,2) CHECK (suma_b >= 0),
  suma_c numeric(18,2) CHECK (suma_c >= 0),
  moneda text CHECK (moneda IN ('RON', 'EUR')),
  cuantificare_confirmata_de uuid, cuantificare_confirmata_la timestamptz,
  observatii text CHECK (observatii IS NULL OR (length(observatii) <= 4000 AND observatii ~ '[^[:space:]]')),
  aprobat_de uuid, aprobat_la timestamptz, aprobat_revizie integer, aprobat_amprenta text CHECK (aprobat_amprenta ~ '^[0-9a-f]{32}$'),
  -- runda 2: amprenta SURSELOR aprobate (legăturile „temei” active ale dosarului, cu versiunea și amprenta confirmate ale reperelor)
  aprobat_surse_amprenta text CHECK (aprobat_surse_amprenta ~ '^[0-9a-f]{32}$'),
  fisier_semnat_doc_id bigint REFERENCES public.documente_proiect(id),
  fisier_semnat_sha256 text CHECK (fisier_semnat_sha256 ~ '^[0-9a-f]{64}$'),
  semnat_inregistrat_de uuid, semnat_la timestamptz,
  stare_motiv text CHECK (stare_motiv IS NULL OR (length(stare_motiv) <= 2000 AND stare_motiv ~ '[^[:space:]]')),
  versiune integer NOT NULL DEFAULT 1 CHECK (versiune > 0),
  creat_de uuid, creat_la timestamptz NOT NULL DEFAULT now(),
  modificat_de uuid, modificat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_revendicare_acte_sens CHECK (
    (tip IN ('notificare', 'detaliere_initiala', 'detaliere_interimara', 'detaliere_finala', 'cerere_prelungire_detaliere', 'dezacord') AND sens = 'iesire')
    OR (tip IN ('raspuns_beneficiar', 'raspuns_prelungire', 'decizie') AND sens = 'intrare')
    OR tip IN ('acord', 'alt')),
  CONSTRAINT executie_revendicare_acte_nr_iesire CHECK (sens = 'iesire' OR nr_iesire IS NULL),
  CONSTRAINT executie_revendicare_acte_moneda CHECK ((suma_a IS NULL AND suma_b IS NULL AND suma_c IS NULL) OR moneda IS NOT NULL),
  CONSTRAINT executie_revendicare_acte_cuantificare CHECK ((cuantificare_confirmata_la IS NULL) = (cuantificare_confirmata_de IS NULL)),
  CONSTRAINT executie_revendicare_acte_aprobare CHECK (
    (aprobat_la IS NULL AND aprobat_de IS NULL AND aprobat_revizie IS NULL AND aprobat_amprenta IS NULL AND aprobat_surse_amprenta IS NULL)
    OR (aprobat_la IS NOT NULL AND aprobat_de IS NOT NULL AND aprobat_revizie IS NOT NULL AND aprobat_amprenta IS NOT NULL
        AND aprobat_surse_amprenta IS NOT NULL)),
  CONSTRAINT executie_revendicare_acte_semnat CHECK (
    stare NOT IN ('semnat', 'transmis') OR sens <> 'iesire' OR (fisier_semnat_doc_id IS NOT NULL AND fisier_semnat_sha256 IS NOT NULL AND aprobat_la IS NOT NULL)),
  CONSTRAINT executie_revendicare_acte_anulat CHECK (stare <> 'anulat' OR stare_motiv IS NOT NULL),
  CONSTRAINT executie_revendicare_acte_anterior CHECK (act_anterior_id IS DISTINCT FROM id)
);
CREATE INDEX executie_revendicare_acte_dosar_idx ON public.executie_revendicare_acte (dosar_id, id);
CREATE INDEX executie_revendicare_acte_proiect_idx ON public.executie_revendicare_acte (proiect_id);
CREATE INDEX executie_revendicare_acte_semnat_doc_idx ON public.executie_revendicare_acte (fisier_semnat_doc_id);
CREATE UNIQUE INDEX executie_revendicare_acte_nr_iesire_uq ON public.executie_revendicare_acte (public.fn_executie_revendicare_nr_canonic(nr_iesire))
  WHERE nr_iesire IS NOT NULL AND stare <> 'anulat';
CREATE UNIQUE INDEX executie_revendicare_acte_nr_benef_uq ON public.executie_revendicare_acte (proiect_id, sens, public.fn_executie_revendicare_nr_canonic(nr_beneficiar))
  WHERE nr_beneficiar IS NOT NULL AND stare <> 'anulat';

-- comunicările unui act, pe destinatar: emiterea (actul), transmiterea, primirea și dovada fiecăreia ținute separat
CREATE TABLE public.executie_revendicare_comunicari (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  act_id bigint NOT NULL REFERENCES public.executie_revendicare_acte(id),
  dosar_id bigint NOT NULL REFERENCES public.executie_revendicari(id),
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  destinatar text NOT NULL CHECK (length(destinatar) BETWEEN 1 AND 300 AND destinatar ~ '[^[:space:]]'),
  canal text NOT NULL CHECK (canal IN ('registratura', 'posta', 'curier', 'email', 'portal', 'alt')),
  data_transmitere date,
  data_primire date,
  nr_inregistrare text CHECK (nr_inregistrare IS NULL OR (length(nr_inregistrare) <= 100 AND nr_inregistrare ~ '[^[:space:]]')),
  dovada_doc_id bigint REFERENCES public.documente_proiect(id),
  dovada_sha256 text CHECK (dovada_sha256 ~ '^[0-9a-f]{64}$'),
  observatii text CHECK (observatii IS NULL OR (length(observatii) <= 2000 AND observatii ~ '[^[:space:]]')),
  anulat boolean NOT NULL DEFAULT false,
  anulat_motiv text CHECK (anulat_motiv IS NULL OR (length(anulat_motiv) <= 2000 AND anulat_motiv ~ '[^[:space:]]')),
  versiune integer NOT NULL DEFAULT 1 CHECK (versiune > 0),
  creat_de uuid, creat_la timestamptz NOT NULL DEFAULT now(),
  modificat_de uuid, modificat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_revendicare_comunicari_date CHECK (data_transmitere IS NOT NULL OR data_primire IS NOT NULL),
  CONSTRAINT executie_revendicare_comunicari_ordine CHECK (data_primire IS NULL OR data_transmitere IS NULL OR data_primire >= data_transmitere),
  CONSTRAINT executie_revendicare_comunicari_anulat CHECK (NOT anulat OR anulat_motiv IS NOT NULL)
);
CREATE INDEX executie_revendicare_comunicari_act_idx ON public.executie_revendicare_comunicari (act_id, id);
CREATE INDEX executie_revendicare_comunicari_proiect_idx ON public.executie_revendicare_comunicari (proiect_id);
CREATE INDEX executie_revendicare_comunicari_dovada_doc_idx ON public.executie_revendicare_comunicari (dovada_doc_id);

-- termenele. Regula (mod, obligație, declanșator, zile, legătura cu reperul) o confirmă administrarea; declanșatorul îl confirmă cine scrie
-- (MP-ul confirmă faptele); data propusă o pune DOAR trigger-ul; data confirmată: la regulă = data propusă, la manual = administrare +
-- justificare (rămâne etichetat manual). nr_zile NULL = necunoscut (NU zero).
CREATE TABLE public.executie_revendicare_termene (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dosar_id bigint NOT NULL REFERENCES public.executie_revendicari(id),
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  tip_obligatie text NOT NULL,   -- CHECK generat din fn_executie_revendicare_obligatie_acte() (blocul $chk$)
  mod text NOT NULL CHECK (mod IN ('regula', 'manual')),
  reper_legatura_id bigint REFERENCES public.executie_revendicare_repere(id),
  regula_reper_versiune integer,
  regula_confirmata_de uuid, regula_confirmata_la timestamptz,
  declansator_tip text NOT NULL CHECK (declansator_tip IN ('data_eveniment', 'data_constatare', 'data_incetare', 'transmitere_act', 'primire_act',
                                                           'expirare_termen', 'alt')),
  declansator_data date,
  declansator_act_id bigint REFERENCES public.executie_revendicare_acte(id),
  declansator_termen_id bigint REFERENCES public.executie_revendicare_termene(id),
  declansator_confirmat_de uuid, declansator_confirmat_la timestamptz,
  nr_zile integer CHECK (nr_zile BETWEEN 1 AND 3650),
  data_propusa date,
  data_confirmata date,
  confirmat_de uuid, confirmat_la timestamptz,
  justificare text CHECK (justificare IS NULL OR (length(justificare) <= 4000 AND justificare ~ '[^[:space:]]')),
  stare text NOT NULL DEFAULT 'deschis' CHECK (stare IN ('deschis', 'indeplinit', 'anulat')),
  indeplinit_act_id bigint REFERENCES public.executie_revendicare_acte(id),
  stare_motiv text CHECK (stare_motiv IS NULL OR (length(stare_motiv) <= 2000 AND stare_motiv ~ '[^[:space:]]')),
  stare_de uuid, stare_la timestamptz,
  observatii text CHECK (observatii IS NULL OR (length(observatii) <= 4000 AND observatii ~ '[^[:space:]]')),
  versiune integer NOT NULL DEFAULT 1 CHECK (versiune > 0),
  creat_de uuid, creat_la timestamptz NOT NULL DEFAULT now(),
  modificat_de uuid, modificat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_revendicare_termene_declansator CHECK (
    (declansator_tip IN ('transmitere_act', 'primire_act') AND declansator_act_id IS NOT NULL AND declansator_termen_id IS NULL)
    OR (declansator_tip = 'expirare_termen' AND declansator_termen_id IS NOT NULL AND declansator_act_id IS NULL)
    OR (declansator_tip NOT IN ('transmitere_act', 'primire_act', 'expirare_termen') AND declansator_act_id IS NULL AND declansator_termen_id IS NULL)),
  CONSTRAINT executie_revendicare_termene_sine CHECK (declansator_termen_id IS DISTINCT FROM id),
  CONSTRAINT executie_revendicare_termene_stare CHECK ((stare = 'indeplinit') = (indeplinit_act_id IS NOT NULL) AND (stare <> 'anulat' OR stare_motiv IS NOT NULL)),
  CONSTRAINT executie_revendicare_termene_manual CHECK (mod <> 'manual' OR data_confirmata IS NULL OR justificare IS NOT NULL)
);
CREATE INDEX executie_revendicare_termene_dosar_idx ON public.executie_revendicare_termene (dosar_id, id);
CREATE INDEX executie_revendicare_termene_proiect_idx ON public.executie_revendicare_termene (proiect_id);

-- dovezile: EXACT o țintă (document / ordin de sistare / raport zilnic), a proiectului dosarului; amprenta rândului-țintă la legare
CREATE TABLE public.executie_revendicare_dovezi (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dosar_id bigint NOT NULL REFERENCES public.executie_revendicari(id),
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  document_id bigint REFERENCES public.documente_proiect(id),
  ordin_id bigint REFERENCES public.executie_ordine_sistare(id),
  raport_id bigint REFERENCES public.rapoarte_zilnice(id),
  rol text NOT NULL CHECK (rol IN ('fapt', 'cauza', 'impact_timp', 'impact_cost', 'comunicare', 'alt')),
  descriere text CHECK (descriere IS NULL OR (length(descriere) <= 2000 AND descriere ~ '[^[:space:]]')),
  tinta_amprenta text NOT NULL CHECK (tinta_amprenta ~ '^[0-9a-f]{32}$'),
  activ boolean NOT NULL DEFAULT true,
  motiv_scoatere text CHECK (motiv_scoatere IS NULL OR (length(motiv_scoatere) <= 2000 AND motiv_scoatere ~ '[^[:space:]]')),
  versiune integer NOT NULL DEFAULT 1 CHECK (versiune > 0),
  creat_de uuid, creat_la timestamptz NOT NULL DEFAULT now(),
  modificat_de uuid, modificat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_revendicare_dovezi_o_tinta CHECK (num_nonnulls(document_id, ordin_id, raport_id) = 1),
  CONSTRAINT executie_revendicare_dovezi_scoatere CHECK (activ OR motiv_scoatere IS NOT NULL)
);
CREATE UNIQUE INDEX executie_revendicare_dovezi_doc_uq ON public.executie_revendicare_dovezi (dosar_id, document_id) WHERE activ AND document_id IS NOT NULL;
CREATE UNIQUE INDEX executie_revendicare_dovezi_ordin_uq ON public.executie_revendicare_dovezi (dosar_id, ordin_id) WHERE activ AND ordin_id IS NOT NULL;
CREATE UNIQUE INDEX executie_revendicare_dovezi_raport_uq ON public.executie_revendicare_dovezi (dosar_id, raport_id) WHERE activ AND raport_id IS NOT NULL;
-- runda 2 (P2): verificarea cheii străine la ștergerea sursei caută TOATE rândurile (și cele scoase), nu doar cele active: index complet
CREATE INDEX executie_revendicare_dovezi_document_idx ON public.executie_revendicare_dovezi (document_id);
CREATE INDEX executie_revendicare_dovezi_ordin_idx ON public.executie_revendicare_dovezi (ordin_id);
CREATE INDEX executie_revendicare_dovezi_raport_idx ON public.executie_revendicare_dovezi (raport_id);
CREATE INDEX executie_revendicare_dovezi_proiect_idx ON public.executie_revendicare_dovezi (proiect_id);

-- jurnalul: un rând pentru fiecare scriere pe tabelele dosarului (trigger AFTER, aceeași tranzacție, orice cale). Nemodificabil.
CREATE TABLE public.executie_revendicare_jurnal (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dosar_id bigint NOT NULL REFERENCES public.executie_revendicari(id),
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  tabel text NOT NULL,
  rand_id bigint NOT NULL,
  operatie text NOT NULL CHECK (operatie IN ('INSERT', 'UPDATE', 'DELETE')),
  inainte jsonb,
  dupa jsonb,
  autor uuid,
  tranzactie bigint NOT NULL,
  la timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX executie_revendicare_jurnal_dosar_idx ON public.executie_revendicare_jurnal (dosar_id, id);
CREATE INDEX executie_revendicare_jurnal_proiect_idx ON public.executie_revendicare_jurnal (proiect_id);

-- alertele interne (pasul 4 le scrie, cu cronul; aici doar structura și cheia de deduplicare)
CREATE TABLE public.executie_revendicare_alerte (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dosar_id bigint NOT NULL REFERENCES public.executie_revendicari(id),
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  termen_id bigint NOT NULL REFERENCES public.executie_revendicare_termene(id),
  termen_versiune integer NOT NULL CHECK (termen_versiune > 0),
  prag text NOT NULL CHECK (prag IN ('7z', '3z', '1z', 'scadent', 'depasit', 'neconfirmat')),
  destinatar uuid NOT NULL REFERENCES public.profiles(id),
  zi date NOT NULL,
  stare text NOT NULL DEFAULT 'noua' CHECK (stare IN ('noua', 'vazuta', 'inchisa')),
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_revendicare_alerte_uq UNIQUE (termen_id, termen_versiune, prag, destinatar, zi)
);
CREATE INDEX executie_revendicare_alerte_proiect_idx ON public.executie_revendicare_alerte (proiect_id);
CREATE INDEX executie_revendicare_alerte_destinatar_idx ON public.executie_revendicare_alerte (destinatar);

-- cheile de idempotență (L04): o cheie = o intenție; rezultatul (tabel + id) se reîntoarce la reluare. Fără niciun drept din aplicație.
CREATE TABLE public.executie_revendicare_chei (
  cheie uuid PRIMARY KEY,
  operatie text NOT NULL,
  amprenta text NOT NULL CHECK (amprenta ~ '^[0-9a-f]{32}$'),
  dosar_id bigint REFERENCES public.executie_revendicari(id),
  rezultat_tabel text NOT NULL,
  rezultat_id bigint NOT NULL,
  creat_de uuid NOT NULL,
  creat_la timestamptz NOT NULL DEFAULT now()
);

-- CHECK-urile stărilor, GENERATE din listele tranzițiilor (L20: o singură sursă)
DO $chk$
DECLARE v_etape text; v_stari text; v_oblig text;
BEGIN
  SELECT string_agg(DISTINCT quote_literal(o.tip_obligatie), ', ') INTO v_oblig FROM public.fn_executie_revendicare_obligatie_acte() o;
  EXECUTE format('ALTER TABLE public.executie_revendicare_termene ADD CONSTRAINT executie_revendicare_termene_obligatie CHECK (tip_obligatie IN (%s))', v_oblig);
  SELECT string_agg(quote_literal(s), ', ' ORDER BY s) INTO v_etape
    FROM (SELECT din AS s FROM public.fn_executie_revendicare_tranzitii() UNION SELECT spre FROM public.fn_executie_revendicare_tranzitii()) x;
  SELECT string_agg(quote_literal(s), ', ' ORDER BY s) INTO v_stari
    FROM (SELECT din AS s FROM public.fn_executie_revendicare_act_tranzitii() UNION SELECT spre FROM public.fn_executie_revendicare_act_tranzitii()) x;
  EXECUTE format('ALTER TABLE public.executie_revendicari ADD CONSTRAINT executie_revendicari_etapa CHECK (etapa IN (%s))', v_etape);
  EXECUTE format('ALTER TABLE public.executie_revendicare_acte ADD CONSTRAINT executie_revendicare_acte_stare CHECK (stare IN (%s) AND (sens = ''iesire'' AND stare <> ''primit'' OR sens = ''intrare'' AND stare IN (''ciorna'', ''primit'', ''anulat'')))', v_stari);
END $chk$;

-- ── 3. funcții care citesc tabelele (INVOKER: sub RLS-ul apelantului; dintr-un RPC DEFINER rulează ca proprietarul) ─────────────────────
-- amprenta conținutului unui act (aprobarea e valabilă doar pe aceeași revizie și același conținut)
CREATE FUNCTION public.fn_executie_revendicare_act_amprenta(a public.executie_revendicare_acte) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT md5(jsonb_build_array(a.tip, a.sens, a.act_anterior_id, a.revizie, a.titlu, a.rezumat, a.cronologie, a.temei, a.argumentare,
                               a.nr_iesire, a.nr_beneficiar, a.data_document, a.zile_solicitate, a.suma_a, a.suma_b, a.suma_c, a.moneda)::text)
$f$;
-- prima transmitere / primire NEANULATĂ a unui act NEANULAT (NULL = niciuna; runda 2: actul anulat nu mai dă nicio dată)
CREATE FUNCTION public.fn_executie_revendicare_act_transmis_la(p_act bigint) RETURNS date
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT min(c.data_transmitere) FROM public.executie_revendicare_comunicari c JOIN public.executie_revendicare_acte a ON a.id = c.act_id
   WHERE c.act_id = p_act AND NOT c.anulat AND a.stare <> 'anulat'
$f$;
CREATE FUNCTION public.fn_executie_revendicare_act_primit_la(p_act bigint) RETURNS date
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT min(c.data_primire) FROM public.executie_revendicare_comunicari c JOIN public.executie_revendicare_acte a ON a.id = c.act_id
   WHERE c.act_id = p_act AND NOT c.anulat AND a.stare <> 'anulat'
$f$;
-- îndeplinirea unei obligații de către un act (L19: O SINGURĂ definiție, în RPC-ul „îndeplinit” și în vedere): data comunicării actului
-- dacă actul e al ACELUIAȘI dosar, compatibil cu obligația (fn_executie_revendicare_obligatie_acte), neanulat și în starea comunicată
-- (ieșire: transmis, data primei transmiteri neanulate; intrare: primit, data primei primiri neanulate). Altfel NULL = îndeplinire
-- nevalabilă (refuz în RPC, „indeplinit_de_verificat” în vedere).
CREATE FUNCTION public.fn_executie_revendicare_indeplinire_la(p_tip_obligatie text, p_dosar bigint, p_act bigint) RETURNS date
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE a.sens WHEN 'iesire' THEN public.fn_executie_revendicare_act_transmis_la(a.id)
                     ELSE public.fn_executie_revendicare_act_primit_la(a.id) END
    FROM public.executie_revendicare_acte a
   WHERE a.id = p_act AND a.dosar_id = p_dosar
     AND a.stare = CASE a.sens WHEN 'iesire' THEN 'transmis' ELSE 'primit' END
     AND EXISTS (SELECT 1 FROM public.fn_executie_revendicare_obligatie_acte() o
                  WHERE o.tip_obligatie = p_tip_obligatie AND o.tip_act = a.tip AND o.sens = a.sens)
$f$;
-- amprenta conținutului unui reper din fișa contractului (aceeași la confirmare și la verificare, L19)
CREATE FUNCTION public.fn_executie_revendicare_reper_amprenta(p_reper bigint) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT md5(jsonb_build_array(r.proiect_id, r.titlu, r.clauze, r.continut, r.citat, r.conditie, r.termen_text, r.efect, r.sursa, r.activ, r.versiune)::text)
    FROM public.executie_contract_repere r WHERE r.id = p_reper
$f$;
-- legătura dosar–reper e confirmată și încă valabilă: reperul activ, al aceluiași proiect, la versiunea și amprenta confirmate
CREATE FUNCTION public.fn_executie_revendicare_legatura_valida(p_legatura bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT EXISTS (SELECT 1 FROM public.executie_revendicare_repere l JOIN public.executie_contract_repere r ON r.id = l.reper_id
                  WHERE l.id = p_legatura AND l.activ AND l.confirmat_la IS NOT NULL AND r.activ AND r.proiect_id = l.proiect_id
                    AND r.versiune = l.reper_versiune_confirmata
                    AND public.fn_executie_revendicare_reper_amprenta(r.id) = l.reper_amprenta_confirmata)
$f$;
-- runda 2 (P1): SURSELE contractuale ale actelor dosarului = legăturile „temei” ACTIVE. Amprenta lor (setul concret: legătura, reperul,
-- versiunea și amprenta confirmate) se fixează la aprobare; orice schimbare a setului sau a confirmării unui reper o schimbă.
CREATE FUNCTION public.fn_executie_revendicare_surse_amprenta(p_dosar bigint) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT md5(coalesce(jsonb_agg(jsonb_build_array(l.id, l.reper_id, l.reper_versiune_confirmata, l.reper_amprenta_confirmata) ORDER BY l.id),
                      '[]'::jsonb)::text)
    FROM public.executie_revendicare_repere l WHERE l.dosar_id = p_dosar AND l.rol = 'temei' AND l.activ
$f$;
-- sursele sunt utilizabile: cel puțin un temei activ și TOATE temeiurile active confirmate și încă valabile (nu „măcar unul”)
CREATE FUNCTION public.fn_executie_revendicare_surse_valide(p_dosar bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT EXISTS (SELECT 1 FROM public.executie_revendicare_repere l WHERE l.dosar_id = p_dosar AND l.rol = 'temei' AND l.activ)
     AND NOT EXISTS (SELECT 1 FROM public.executie_revendicare_repere l WHERE l.dosar_id = p_dosar AND l.rol = 'temei' AND l.activ
                      AND NOT public.fn_executie_revendicare_legatura_valida(l.id))
$f$;
-- aprobarea actului e încă valabilă (L19: aceeași funcție la semnare și în vedere): aceeași revizie, același conținut, ACELEAȘI surse
-- (amprenta setului de la aprobare) și sursele încă valabile
CREATE FUNCTION public.fn_executie_revendicare_act_aprobare_valida(a public.executie_revendicare_acte) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT a.aprobat_la IS NOT NULL AND a.aprobat_revizie IS NOT DISTINCT FROM a.revizie
     AND a.aprobat_amprenta IS NOT DISTINCT FROM public.fn_executie_revendicare_act_amprenta(a)
     AND a.aprobat_surse_amprenta IS NOT DISTINCT FROM public.fn_executie_revendicare_surse_amprenta(a.dosar_id)
     AND public.fn_executie_revendicare_surse_valide(a.dosar_id)
$f$;
-- data de ACUM a sursei declanșatorului unui termen (NULL = necunoscută)
CREATE FUNCTION public.fn_executie_revendicare_declansator_data(p_termen bigint) RETURNS date
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE t.declansator_tip
           WHEN 'data_eveniment' THEN d.data_eveniment
           WHEN 'data_constatare' THEN d.data_constatare
           WHEN 'data_incetare' THEN d.data_incetare
           WHEN 'transmitere_act' THEN public.fn_executie_revendicare_act_transmis_la(t.declansator_act_id)
           WHEN 'primire_act' THEN public.fn_executie_revendicare_act_primit_la(t.declansator_act_id)
           WHEN 'expirare_termen' THEN (SELECT u.data_confirmata FROM public.executie_revendicare_termene u
                                         WHERE u.id = t.declansator_termen_id AND u.dosar_id = t.dosar_id AND u.stare <> 'anulat')
           WHEN 'alt' THEN t.declansator_data
         END
    FROM public.executie_revendicare_termene t JOIN public.executie_revendicari d ON d.id = t.dosar_id
   WHERE t.id = p_termen
$f$;
-- LOCAL: ce s-a confirmat PE ACEST termen e încă adevărat: regula (legătura valabilă, aceeași versiune) și declanșatorul (aceeași dată ca
-- sursa). Un termen manual nu are regulă de reverificat. Termen invizibil / inexistent = NULL. Lanțul: fn_executie_revendicare_termen_lant_valid.
CREATE FUNCTION public.fn_executie_revendicare_termen_intrari_locale(p_termen bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT t.mod = 'manual'
         OR ((t.regula_confirmata_la IS NULL
              OR (t.reper_legatura_id IS NOT NULL AND public.fn_executie_revendicare_legatura_valida(t.reper_legatura_id)
                  AND t.regula_reper_versiune IS NOT DISTINCT FROM
                      (SELECT l.reper_versiune_confirmata FROM public.executie_revendicare_repere l WHERE l.id = t.reper_legatura_id)))
             AND (t.declansator_confirmat_la IS NULL
                  OR public.fn_executie_revendicare_declansator_data(t.id) IS NOT DISTINCT FROM t.declansator_data))
    FROM public.executie_revendicare_termene t WHERE t.id = p_termen
$f$;
-- runda 2 (P1): LANȚUL dependențelor. Un termen „regulă” cu declanșatorul expirare_termen ia data confirmată a termenului precedent: acesta
-- (și precedentul lui, recursiv) trebuie să existe în ACELAȘI dosar, să nu fie anulat și să aibă intrările locale valabile. Lanțul se
-- urmează doar prin termenele „regulă” (data unui termen manual e asumată de administrare, nu derivată). Un ciclu (refuzat la scriere de
-- trigger, pe orice cale; aici apărare în adâncime: calea e reținută, deci parcurgerea se termină) = invalid. Inexistent = NULL.
CREATE FUNCTION public.fn_executie_revendicare_termen_lant_valid(p_termen bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  WITH RECURSIVE lant(id, adancime, cale, ciclu) AS (
    SELECT t.id, 0, ARRAY[t.id], false FROM public.executie_revendicare_termene t WHERE t.id = p_termen
    UNION ALL
    SELECT u.id, l.adancime + 1, l.cale || u.id, u.id = ANY (l.cale)
      FROM lant l
      JOIN public.executie_revendicare_termene t ON t.id = l.id
      JOIN public.executie_revendicare_termene u ON u.id = t.declansator_termen_id AND u.dosar_id = t.dosar_id
     WHERE NOT l.ciclu AND t.mod = 'regula' AND t.declansator_tip = 'expirare_termen'
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM lant) THEN NULL ELSE
           NOT EXISTS (SELECT 1 FROM lant WHERE ciclu)
           -- fiecare verigă „regulă” cu expirare_termen are precedentul în același dosar
           AND NOT EXISTS (SELECT 1 FROM lant l JOIN public.executie_revendicare_termene t ON t.id = l.id
                            WHERE t.mod = 'regula' AND t.declansator_tip = 'expirare_termen'
                              AND NOT EXISTS (SELECT 1 FROM public.executie_revendicare_termene u
                                               WHERE u.id = t.declansator_termen_id AND u.dosar_id = t.dosar_id))
           -- fiecare precedent: neanulat, cu intrările locale valabile
           AND NOT EXISTS (SELECT 1 FROM lant l JOIN public.executie_revendicare_termene u ON u.id = l.id
                            WHERE l.adancime > 0
                              AND (u.stare = 'anulat' OR public.fn_executie_revendicare_termen_intrari_locale(u.id) IS NOT TRUE))
         END
$f$;
-- ce s-a confirmat e încă adevărat, pe termen ȘI pe tot lanțul lui (folosită de vedere, de confirmarea datei și de viitorul cron, L19)
CREATE FUNCTION public.fn_executie_revendicare_termen_intrari_valide(p_termen bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT public.fn_executie_revendicare_termen_intrari_locale(p_termen) AND public.fn_executie_revendicare_termen_lant_valid(p_termen)
$f$;

-- ── 4. auxiliare interne ale RPC-urilor (fără EXECUTE pentru clienți) ──────────────────────────────────────────────────────────────────────
-- lista albă a câmpurilor și tipurile lor. p_spec: {cheie: 'text:N' | 'data' | 'int:min:max' | 'id' | 'suma' | 'bool'}. Cheie lipsă / null =
-- NULL; cheie necunoscută / tip greșit = refuz. Sumele: număr JSON cu cel mult 2 zecimale (numeric(18,2) ar rotunji în tăcere).
CREATE FUNCTION public.fn_executie_revendicare_valideaza(p_date jsonb, p_spec jsonb) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
DECLARE k text; v jsonb; v_t text; v_p text[];
BEGIN
  IF p_date IS NULL OR jsonb_typeof(p_date) <> 'object' THEN
    RAISE EXCEPTION 'revendicari: datele trebuie sa fie un obiect' USING ERRCODE = '22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_date) LOOP
    IF NOT (p_spec ? k) THEN RAISE EXCEPTION 'revendicari: camp necunoscut: %', left(k, 40) USING ERRCODE = '22023'; END IF;
    v := p_date->k;
    IF jsonb_typeof(v) = 'null' THEN CONTINUE; END IF;
    v_p := string_to_array(p_spec->>k, ':');
    v_t := v #>> '{}';
    IF v_p[1] = 'text' THEN
      IF jsonb_typeof(v) <> 'string' THEN RAISE EXCEPTION 'revendicari: campul % trebuie sa fie text', k USING ERRCODE = '22023'; END IF;
      IF length(v_t) > v_p[2]::int THEN RAISE EXCEPTION 'revendicari: campul % depaseste % caractere', k, v_p[2] USING ERRCODE = '22023'; END IF;
    ELSIF v_p[1] = 'data' THEN
      IF jsonb_typeof(v) <> 'string' OR v_t !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'revendicari: campul % trebuie sa fie o data AAAA-LL-ZZ', k USING ERRCODE = '22023';
      END IF;
      PERFORM v_t::date;   -- o dată imposibilă (2026-02-30) = eroare 22008
    ELSIF v_p[1] = 'int' THEN
      IF jsonb_typeof(v) <> 'number' OR v_t !~ '^-?[0-9]{1,9}$' OR v_t::int NOT BETWEEN v_p[2]::int AND v_p[3]::int THEN
        RAISE EXCEPTION 'revendicari: campul % trebuie sa fie un intreg intre % si %', k, v_p[2], v_p[3] USING ERRCODE = '22023';
      END IF;
    ELSIF v_p[1] = 'id' THEN
      IF jsonb_typeof(v) <> 'number' OR v_t !~ '^[1-9][0-9]{0,17}$' THEN
        RAISE EXCEPTION 'revendicari: campul % trebuie sa fie un id', k USING ERRCODE = '22023';
      END IF;
    ELSIF v_p[1] = 'suma' THEN
      IF jsonb_typeof(v) <> 'number' OR v_t !~ '^[0-9]{1,16}([.][0-9]{1,2})?$' THEN
        RAISE EXCEPTION 'revendicari: campul % trebuie sa fie o suma >= 0 cu cel mult 2 zecimale', k USING ERRCODE = '22023';
      END IF;
    ELSIF v_p[1] = 'bool' THEN
      IF jsonb_typeof(v) <> 'boolean' THEN RAISE EXCEPTION 'revendicari: campul % trebuie sa fie true / false', k USING ERRCODE = '22023'; END IF;
    ELSE
      RAISE EXCEPTION 'revendicari: specificatie interna gresita pentru %', k USING ERRCODE = 'XX000';
    END IF;
  END LOOP;
END $f$;
-- textul unui câmp: trim, gol = NULL
CREATE FUNCTION public.fn_executie_revendicare_txt(p jsonb, k text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT nullif(btrim(coalesce(p->>k, '')), '')
$f$;
-- (1) lock-ul consultativ pe cheia intenției: primul lock al fiecărui RPC (L06)
CREATE FUNCTION public.fn_executie_revendicare_cheie_blocheaza(p_cheie uuid) RETURNS void
LANGUAGE sql VOLATILE SET search_path = public, pg_temp AS $f$
  SELECT pg_advisory_xact_lock(hashtextextended('executie_revendicare_cheie:' || p_cheie::text, 0))
$f$;
-- rândul curent al unui rezultat (pentru reluare)
CREATE FUNCTION public.fn_executie_revendicare_rand(p_tabel text, p_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE p_tabel
    WHEN 'executie_revendicari' THEN (SELECT to_jsonb(x) FROM public.executie_revendicari x WHERE x.id = p_id)
    WHEN 'executie_revendicare_repere' THEN (SELECT to_jsonb(x) FROM public.executie_revendicare_repere x WHERE x.id = p_id)
    WHEN 'executie_revendicare_acte' THEN (SELECT to_jsonb(x) FROM public.executie_revendicare_acte x WHERE x.id = p_id)
    WHEN 'executie_revendicare_comunicari' THEN (SELECT to_jsonb(x) FROM public.executie_revendicare_comunicari x WHERE x.id = p_id)
    WHEN 'executie_revendicare_termene' THEN (SELECT to_jsonb(x) FROM public.executie_revendicare_termene x WHERE x.id = p_id)
    WHEN 'executie_revendicare_dovezi' THEN (SELECT to_jsonb(x) FROM public.executie_revendicare_dovezi x WHERE x.id = p_id)
  END
$f$;
-- reluarea aceleiași intenții: aceeași operație + același conținut + același cont = rezultatul de data trecută (cu rândul de ACUM);
-- altfel refuz. Cheia nouă = NULL. Se cheamă DUPĂ lock-ul cheii și după verificarea dreptului.
CREATE FUNCTION public.fn_executie_revendicare_cheie_citeste(p_cheie uuid, p_operatie text, p_amprenta text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
DECLARE c public.executie_revendicare_chei;
BEGIN
  SELECT * INTO c FROM public.executie_revendicare_chei WHERE cheie = p_cheie;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF c.operatie = p_operatie AND c.amprenta = p_amprenta AND c.creat_de = auth.uid() THEN
    RETURN jsonb_build_object('ok', true, 'duplicat', true, 'rand', public.fn_executie_revendicare_rand(c.rezultat_tabel, c.rezultat_id));
  END IF;
  RAISE EXCEPTION 'revendicari: cheia intentiei a fost folosita pentru alta operatie' USING ERRCODE = '22023';
END $f$;
CREATE FUNCTION public.fn_executie_revendicare_cheie_scrie(p_cheie uuid, p_operatie text, p_amprenta text, p_dosar bigint, p_tabel text, p_id bigint)
RETURNS void LANGUAGE sql VOLATILE SET search_path = public, pg_temp AS $f$
  INSERT INTO public.executie_revendicare_chei (cheie, operatie, amprenta, dosar_id, rezultat_tabel, rezultat_id, creat_de)
  VALUES (p_cheie, p_operatie, p_amprenta, p_dosar, p_tabel, p_id, auth.uid())
$f$;
-- (2) dosarul: proiectul citit și dreptul verificat ÎNAINTE de lock (un dosar străin ocupat nu ține apelantul în așteptare), apoi
-- FOR UPDATE și reverificare: proiectul (imuabil) ȘI dreptul (runda 2, L01): instrucțiunea de după lock are instantaneu nou (READ
-- COMMITTED, funcție VOLATILE), deci vede o desemnare / permisiune retrasă cât apelul aștepta lock-ul. Inexistent = fără drept = același
-- refuz (42501).
CREATE FUNCTION public.fn_executie_revendicare_dosar_blocheaza(p_dosar bigint, p_nivel text) RETURNS public.executie_revendicari
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $f$
DECLARE v_proiect bigint; r public.executie_revendicari;
BEGIN
  SELECT d.proiect_id INTO v_proiect FROM public.executie_revendicari d WHERE d.id = p_dosar;
  IF v_proiect IS NULL OR NOT public.fn_executie_revendicare_drept(v_proiect, p_nivel) THEN
    RAISE EXCEPTION 'revendicari: dosarul nu exista sau nu ai drept' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.executie_revendicari d WHERE d.id = p_dosar FOR UPDATE;
  IF NOT FOUND OR r.proiect_id IS DISTINCT FROM v_proiect THEN
    RAISE EXCEPTION 'revendicari: dosarul nu exista sau nu ai drept' USING ERRCODE = '42501';
  END IF;
  IF NOT public.fn_executie_revendicare_drept(r.proiect_id, p_nivel) THEN
    RAISE EXCEPTION 'revendicari: dosarul nu exista sau nu ai drept' USING ERRCODE = '42501';
  END IF;
  RETURN r;
END $f$;
-- (4) o țintă din ALT modul (document / ordin / raport), a proiectului dosarului: proiectul comparat ÎNAINTE de lock (un rând ocupat al
-- altui proiect dă același refuz 42501, nu 55P03), apoi FOR SHARE NOWAIT și reverificare. Întoarce amprenta rândului și SHA-256 (document).
CREATE FUNCTION public.fn_executie_revendicare_tinta(p_tip text, p_id bigint, p_proiect bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $f$
DECLARE v_p bigint; v_amp text; v_sha text;
BEGIN
  IF p_tip = 'document' THEN
    SELECT t.proiect_id INTO v_p FROM public.documente_proiect t WHERE t.id = p_id;
    IF v_p IS DISTINCT FROM p_proiect THEN RAISE EXCEPTION 'revendicari: tinta nu exista sau nu e in proiectul dosarului' USING ERRCODE = '42501'; END IF;
    SELECT md5(to_jsonb(t)::text), t.hash_sha256 INTO v_amp, v_sha FROM public.documente_proiect t WHERE t.id = p_id AND t.proiect_id = p_proiect FOR SHARE NOWAIT;
  ELSIF p_tip = 'ordin' THEN
    SELECT t.proiect_id INTO v_p FROM public.executie_ordine_sistare t WHERE t.id = p_id;
    IF v_p IS DISTINCT FROM p_proiect THEN RAISE EXCEPTION 'revendicari: tinta nu exista sau nu e in proiectul dosarului' USING ERRCODE = '42501'; END IF;
    SELECT md5(to_jsonb(t)::text) INTO v_amp FROM public.executie_ordine_sistare t WHERE t.id = p_id AND t.proiect_id = p_proiect FOR SHARE NOWAIT;
  ELSIF p_tip = 'raport' THEN
    SELECT s.proiect_id INTO v_p FROM public.rapoarte_zilnice r JOIN public.sites s ON s.id = r.site_id WHERE r.id = p_id;
    IF v_p IS DISTINCT FROM p_proiect THEN RAISE EXCEPTION 'revendicari: tinta nu exista sau nu e in proiectul dosarului' USING ERRCODE = '42501'; END IF;
    SELECT md5(to_jsonb(r)::text) INTO v_amp FROM public.rapoarte_zilnice r JOIN public.sites s ON s.id = r.site_id
     WHERE r.id = p_id AND s.proiect_id = p_proiect FOR SHARE OF r, s NOWAIT;
  ELSE
    RAISE EXCEPTION 'revendicari: tipul tintei: document / ordin / raport' USING ERRCODE = '22023';
  END IF;
  IF v_amp IS NULL THEN RAISE EXCEPTION 'revendicari: tinta nu exista sau nu e in proiectul dosarului' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('amprenta', v_amp, 'sha256', v_sha);
END $f$;

-- ── 5. trigger-e ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- proveniența (L08), pe orice cale: versiune, creat_* / modificat_* puse de server; proiectul copilului = al dosarului; dosarul,
-- proiectul și crearea sunt imuabile.
CREATE FUNCTION public.fn_executie_revendicare_prov() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_n jsonb := to_jsonb(NEW); v_o jsonb; v_proiect bigint;
BEGIN
  IF TG_TABLE_NAME = 'executie_revendicari' THEN
    v_proiect := (v_n->>'proiect_id')::bigint;
  ELSE
    SELECT d.proiect_id INTO v_proiect FROM public.executie_revendicari d WHERE d.id = (v_n->>'dosar_id')::bigint;
    IF v_proiect IS NULL THEN RAISE EXCEPTION 'revendicari: dosarul nu exista' USING ERRCODE = '23503'; END IF;
  END IF;
  -- comunicarea e a unui act din ACELAȘI dosar (și pe calea server, nu doar prin RPC)
  IF TG_TABLE_NAME = 'executie_revendicare_comunicari' AND TG_OP = 'INSERT'
     AND NOT EXISTS (SELECT 1 FROM public.executie_revendicare_acte a WHERE a.id = (v_n->>'act_id')::bigint AND a.dosar_id = (v_n->>'dosar_id')::bigint) THEN
    RAISE EXCEPTION 'revendicari: comunicarea nu e a unui act din dosar' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    v_o := to_jsonb(OLD);
    IF (v_n->'proiect_id') IS DISTINCT FROM (v_o->'proiect_id') OR (v_n->'dosar_id') IS DISTINCT FROM (v_o->'dosar_id')
       OR (v_n->'act_id') IS DISTINCT FROM (v_o->'act_id') OR (v_n->'creat_de') IS DISTINCT FROM (v_o->'creat_de')
       OR (v_n->'creat_la') IS DISTINCT FROM (v_o->'creat_la') THEN
      RAISE EXCEPTION 'revendicari: dosarul, proiectul si crearea unui rand nu se schimba' USING ERRCODE = '23514';
    END IF;
    NEW := jsonb_populate_record(NEW, jsonb_build_object('versiune', (v_o->>'versiune')::int + 1, 'modificat_de', auth.uid(), 'modificat_la', now()));
  ELSE
    NEW := jsonb_populate_record(NEW, jsonb_build_object('versiune', 1, 'proiect_id', v_proiect, 'creat_de', auth.uid(), 'creat_la', now(),
                                                         'modificat_de', auth.uid(), 'modificat_la', now()));
  END IF;
  RETURN NEW;
END $f$;
-- calculul termenului (rulează DUPĂ proveniență: numele trigger-ului e după al ei). Data propusă o pune DOAR serverul; schimbarea
-- intrărilor invalidează confirmările; autorul și momentul confirmărilor = apelantul / acum (L08).
CREATE FUNCTION public.fn_executie_revendicare_termen_calc() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  -- runda 2 (P1), pe orice cale: termenul / actul declanșator sunt ai ACELUIAȘI dosar, iar lanțul termenelor precedente nu se închide
  -- în cerc (urmat din precedent, cu calea reținută: parcurgerea se termină și pe un ciclu deja existent). Fără lock-uri noi: rândurile
  -- dosarului sunt deja serializate de lock-ul dosarului din RPC.
  IF NEW.declansator_act_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.executie_revendicare_acte a
                                                         WHERE a.id = NEW.declansator_act_id AND a.dosar_id = NEW.dosar_id) THEN
    RAISE EXCEPTION 'revendicari: actul declansator nu e in dosar' USING ERRCODE = '23514';
  END IF;
  IF NEW.declansator_termen_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.executie_revendicare_termene u WHERE u.id = NEW.declansator_termen_id AND u.dosar_id = NEW.dosar_id) THEN
      RAISE EXCEPTION 'revendicari: termenul precedent nu e in dosar' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (WITH RECURSIVE lant(id, cale) AS (
                 SELECT u.id, ARRAY[u.id] FROM public.executie_revendicare_termene u WHERE u.id = NEW.declansator_termen_id
                 UNION ALL
                 SELECT u.declansator_termen_id, l.cale || u.declansator_termen_id
                   FROM lant l JOIN public.executie_revendicare_termene u ON u.id = l.id
                  WHERE u.declansator_termen_id IS NOT NULL AND l.id <> NEW.id AND NOT (u.declansator_termen_id = ANY (l.cale)))
               SELECT 1 FROM lant WHERE lant.id = NEW.id) THEN
      RAISE EXCEPTION 'revendicari: termenele precedente formeaza un ciclu' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- un termen nou nu vine confirmat (confirmările au RPC-ul lor) și nu vine îndeplinit / anulat
    NEW.regula_confirmata_la := NULL; NEW.regula_confirmata_de := NULL; NEW.regula_reper_versiune := NULL;
    NEW.declansator_confirmat_la := NULL; NEW.declansator_confirmat_de := NULL;
    NEW.data_confirmata := NULL; NEW.confirmat_de := NULL; NEW.confirmat_la := NULL;
    NEW.stare := 'deschis'; NEW.indeplinit_act_id := NULL; NEW.stare_motiv := NULL; NEW.stare_de := NULL; NEW.stare_la := NULL;
  ELSE
    IF (NEW.mod, NEW.tip_obligatie, NEW.declansator_tip, NEW.nr_zile, NEW.reper_legatura_id)
       IS DISTINCT FROM (OLD.mod, OLD.tip_obligatie, OLD.declansator_tip, OLD.nr_zile, OLD.reper_legatura_id) THEN
      NEW.regula_confirmata_la := NULL;
    END IF;
    IF (NEW.declansator_tip, NEW.declansator_data, NEW.declansator_act_id, NEW.declansator_termen_id)
       IS DISTINCT FROM (OLD.declansator_tip, OLD.declansator_data, OLD.declansator_act_id, OLD.declansator_termen_id) THEN
      NEW.declansator_confirmat_la := NULL;
    END IF;
    IF NEW.regula_confirmata_la IS DISTINCT FROM OLD.regula_confirmata_la THEN
      NEW.regula_confirmata_de := CASE WHEN NEW.regula_confirmata_la IS NULL THEN NULL ELSE auth.uid() END;
      NEW.regula_confirmata_la := CASE WHEN NEW.regula_confirmata_la IS NULL THEN NULL ELSE now() END;
    ELSE
      NEW.regula_confirmata_de := OLD.regula_confirmata_de;
    END IF;
    IF NEW.declansator_confirmat_la IS DISTINCT FROM OLD.declansator_confirmat_la THEN
      NEW.declansator_confirmat_de := CASE WHEN NEW.declansator_confirmat_la IS NULL THEN NULL ELSE auth.uid() END;
      NEW.declansator_confirmat_la := CASE WHEN NEW.declansator_confirmat_la IS NULL THEN NULL ELSE now() END;
    ELSE
      NEW.declansator_confirmat_de := OLD.declansator_confirmat_de;
    END IF;
  END IF;
  IF NEW.regula_confirmata_la IS NULL THEN NEW.regula_reper_versiune := NULL; END IF;
  -- zile calendaristice: D + N (ziua declanșatorului nu se numără). Necunoscut (NULL) rămâne necunoscut.
  NEW.data_propusa := CASE WHEN NEW.mod = 'regula' AND NEW.regula_confirmata_la IS NOT NULL AND NEW.declansator_confirmat_la IS NOT NULL
                                AND NEW.nr_zile IS NOT NULL AND NEW.declansator_data IS NOT NULL
                           THEN NEW.declansator_data + NEW.nr_zile END;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.mod IS DISTINCT FROM OLD.mod
       OR (NEW.mod = 'regula' AND NEW.data_propusa IS DISTINCT FROM OLD.data_propusa)
       OR (NEW.mod = 'manual' AND NEW.justificare IS DISTINCT FROM OLD.justificare AND NEW.data_confirmata IS NOT DISTINCT FROM OLD.data_confirmata) THEN
      NEW.data_confirmata := NULL;
    END IF;
    IF NEW.data_confirmata IS DISTINCT FROM OLD.data_confirmata THEN
      NEW.confirmat_de := CASE WHEN NEW.data_confirmata IS NULL THEN NULL ELSE auth.uid() END;
      NEW.confirmat_la := CASE WHEN NEW.data_confirmata IS NULL THEN NULL ELSE now() END;
    ELSE
      NEW.confirmat_de := OLD.confirmat_de; NEW.confirmat_la := OLD.confirmat_la;
    END IF;
    IF NEW.stare IS DISTINCT FROM OLD.stare OR NEW.indeplinit_act_id IS DISTINCT FROM OLD.indeplinit_act_id THEN
      NEW.stare_de := auth.uid(); NEW.stare_la := now();
    ELSE
      NEW.stare_de := OLD.stare_de; NEW.stare_la := OLD.stare_la;
    END IF;
  END IF;
  IF NEW.data_confirmata IS NOT NULL AND NEW.mod = 'regula' AND NEW.data_confirmata IS DISTINCT FROM NEW.data_propusa THEN
    RAISE EXCEPTION 'revendicari: data confirmata a unui termen calculat trebuie sa fie data propusa' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $f$;
-- jurnalul (AFTER, aceeași tranzacție, orice cale): rândul înainte / după, autorul, tranzacția
CREATE FUNCTION public.fn_executie_revendicare_jurnal_scrie() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_n jsonb; v_o jsonb; v_r jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_o := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_n := to_jsonb(NEW); END IF;
  v_r := coalesce(v_n, v_o);
  INSERT INTO public.executie_revendicare_jurnal (dosar_id, proiect_id, tabel, rand_id, operatie, inainte, dupa, autor, tranzactie)
  VALUES (CASE WHEN TG_TABLE_NAME = 'executie_revendicari' THEN (v_r->>'id')::bigint ELSE (v_r->>'dosar_id')::bigint END,
          (v_r->>'proiect_id')::bigint, TG_TABLE_NAME, (v_r->>'id')::bigint, TG_OP, v_o, v_n, auth.uid(), txid_current());
  RETURN NULL;
END $f$;
CREATE FUNCTION public.fn_executie_revendicare_jurnal_imuabil() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  RAISE EXCEPTION 'revendicari: jurnalul nu se modifica si nu se sterge' USING ERRCODE = '42501';
END $f$;

-- proveniența (BEFORE, „a” = primul) și jurnalul (AFTER, „z” = ultimul) pe cele 6 tabele scrise de RPC-uri; scrise STATIC, cu numele tabelului
-- (regula porților Izometrie: fără ținte dinamice). Lista exactă o verifică postcondiția trigger-elor (§9).
CREATE TRIGGER trg_a_executie_revendicare_prov BEFORE INSERT OR UPDATE ON public.executie_revendicari
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_revendicare_prov();
CREATE TRIGGER trg_z_executie_revendicare_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.executie_revendicari
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_revendicare_jurnal_scrie();
CREATE TRIGGER trg_a_executie_revendicare_prov BEFORE INSERT OR UPDATE ON public.executie_revendicare_repere
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_revendicare_prov();
CREATE TRIGGER trg_z_executie_revendicare_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.executie_revendicare_repere
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_revendicare_jurnal_scrie();
CREATE TRIGGER trg_a_executie_revendicare_prov BEFORE INSERT OR UPDATE ON public.executie_revendicare_acte
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_revendicare_prov();
CREATE TRIGGER trg_z_executie_revendicare_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.executie_revendicare_acte
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_revendicare_jurnal_scrie();
CREATE TRIGGER trg_a_executie_revendicare_prov BEFORE INSERT OR UPDATE ON public.executie_revendicare_comunicari
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_revendicare_prov();
CREATE TRIGGER trg_z_executie_revendicare_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.executie_revendicare_comunicari
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_revendicare_jurnal_scrie();
CREATE TRIGGER trg_a_executie_revendicare_prov BEFORE INSERT OR UPDATE ON public.executie_revendicare_termene
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_revendicare_prov();
CREATE TRIGGER trg_z_executie_revendicare_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.executie_revendicare_termene
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_revendicare_jurnal_scrie();
CREATE TRIGGER trg_a_executie_revendicare_prov BEFORE INSERT OR UPDATE ON public.executie_revendicare_dovezi
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_revendicare_prov();
CREATE TRIGGER trg_z_executie_revendicare_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.executie_revendicare_dovezi
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_revendicare_jurnal_scrie();
CREATE TRIGGER trg_b_executie_revendicare_termen_calc BEFORE INSERT OR UPDATE ON public.executie_revendicare_termene
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_revendicare_termen_calc();
CREATE TRIGGER trg_executie_revendicare_jurnal_imuabil BEFORE UPDATE OR DELETE ON public.executie_revendicare_jurnal
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_revendicare_jurnal_imuabil();
CREATE TRIGGER trg_executie_revendicare_jurnal_fara_truncate BEFORE TRUNCATE ON public.executie_revendicare_jurnal
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_executie_revendicare_jurnal_imuabil();

-- ── 6. RPC-urile (SECURITY DEFINER; ordinea lock-urilor: antetul migrării) ─────────────────────────────────────────────────────────────────
-- Rezultat comun: {ok:true, duplicat, rand} | {ok:false, motiv:'conflict', rand} (versiunea s-a schimbat: clientul reîncarcă; cheia NU
-- e consumată). Refuzurile: 42501 (fără drept / inexistent, același mesaj), 22023 (date / tranziție), 23505 (dublură), 55P03 (rând ocupat).

-- 6.1 dosarul: creare (p_id NULL) / modificare (p_id + p_versiune văzută). Etapa și riscul au RPC-urile lor.
CREATE FUNCTION public.fn_executie_revendicare_salveaza_dosar(p_proiect bigint, p_id bigint, p_versiune integer, p_date jsonb, p_cheie uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_d public.executie_revendicari; v_amp text; v_rez jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'revendicari: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_proiect IS NULL OR p_cheie IS NULL OR (p_id IS NULL) <> (p_versiune IS NULL) THEN
    RAISE EXCEPTION 'revendicari: parametri lipsa' USING ERRCODE = '22023';
  END IF;
  PERFORM public.fn_executie_revendicare_valideaza(p_date, '{"titlu":"text:300","descriere":"text:8000","localizare":"text:1000",
    "contract_ref":"text:300","data_eveniment":"data","data_constatare":"data","data_incetare":"data","caracter":"text:20",
    "solicita_timp":"text:20","solicita_bani":"text:20"}'::jsonb);
  PERFORM public.fn_executie_revendicare_cheie_blocheaza(p_cheie);                                   -- (1)
  IF p_id IS NOT NULL THEN
    v_d := public.fn_executie_revendicare_dosar_blocheaza(p_id, 'scriere');                          -- (2)
    IF v_d.proiect_id IS DISTINCT FROM p_proiect THEN RAISE EXCEPTION 'revendicari: dosarul nu exista sau nu ai drept' USING ERRCODE = '42501'; END IF;
  ELSIF NOT public.fn_executie_revendicare_drept(p_proiect, 'scriere') THEN
    RAISE EXCEPTION 'revendicari: dosarul nu exista sau nu ai drept' USING ERRCODE = '42501';
  END IF;
  v_amp := md5(jsonb_build_array('dosar', p_proiect, p_id, p_versiune, p_date)::text);
  v_rez := public.fn_executie_revendicare_cheie_citeste(p_cheie, 'dosar', v_amp);
  IF v_rez IS NOT NULL THEN RETURN v_rez; END IF;
  IF public.fn_executie_revendicare_txt(p_date, 'titlu') IS NULL THEN RAISE EXCEPTION 'revendicari: titlul e obligatoriu' USING ERRCODE = '22023'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.executie_revendicari (proiect_id, titlu, descriere, localizare, contract_ref, data_eveniment, data_constatare, data_incetare,
                                             caracter, solicita_timp, solicita_bani)
    VALUES (p_proiect, public.fn_executie_revendicare_txt(p_date, 'titlu'), public.fn_executie_revendicare_txt(p_date, 'descriere'),
            public.fn_executie_revendicare_txt(p_date, 'localizare'), public.fn_executie_revendicare_txt(p_date, 'contract_ref'),
            (p_date->>'data_eveniment')::date, (p_date->>'data_constatare')::date, (p_date->>'data_incetare')::date,
            coalesce(public.fn_executie_revendicare_txt(p_date, 'caracter'), 'necunoscut'),
            coalesce(public.fn_executie_revendicare_txt(p_date, 'solicita_timp'), 'de_stabilit'),
            coalesce(public.fn_executie_revendicare_txt(p_date, 'solicita_bani'), 'de_stabilit'))
    RETURNING * INTO v_d;
  ELSE
    IF v_d.versiune IS DISTINCT FROM p_versiune THEN RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'rand', to_jsonb(v_d)); END IF;
    IF v_d.etapa IN ('inchis', 'retras') THEN RAISE EXCEPTION 'revendicari: dosarul e inchis' USING ERRCODE = '22023'; END IF;
    UPDATE public.executie_revendicari SET
      titlu = public.fn_executie_revendicare_txt(p_date, 'titlu'), descriere = public.fn_executie_revendicare_txt(p_date, 'descriere'),
      localizare = public.fn_executie_revendicare_txt(p_date, 'localizare'), contract_ref = public.fn_executie_revendicare_txt(p_date, 'contract_ref'),
      data_eveniment = (p_date->>'data_eveniment')::date, data_constatare = (p_date->>'data_constatare')::date,
      data_incetare = (p_date->>'data_incetare')::date,
      caracter = coalesce(public.fn_executie_revendicare_txt(p_date, 'caracter'), 'necunoscut'),
      solicita_timp = coalesce(public.fn_executie_revendicare_txt(p_date, 'solicita_timp'), 'de_stabilit'),
      solicita_bani = coalesce(public.fn_executie_revendicare_txt(p_date, 'solicita_bani'), 'de_stabilit')
    WHERE id = p_id RETURNING * INTO v_d;
  END IF;
  PERFORM public.fn_executie_revendicare_cheie_scrie(p_cheie, 'dosar', v_amp, v_d.id, 'executie_revendicari', v_d.id);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'rand', to_jsonb(v_d));
END $f$;

-- 6.2 etapa procedurală: DOAR pe tranzițiile din fn_executie_revendicare_tranzitii(), cu nivelul, actul și motivul cerute acolo
CREATE FUNCTION public.fn_executie_revendicare_etapa(p_id bigint, p_versiune integer, p_etapa text, p_motiv text, p_cheie uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_d public.executie_revendicari; v_t record; v_amp text; v_rez jsonb; v_motiv text := nullif(btrim(coalesce(p_motiv, '')), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'revendicari: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_versiune IS NULL OR p_etapa IS NULL OR p_cheie IS NULL THEN RAISE EXCEPTION 'revendicari: parametri lipsa' USING ERRCODE = '22023'; END IF;
  IF length(coalesce(p_motiv, '')) > 2000 THEN RAISE EXCEPTION 'revendicari: motivul depaseste 2000 de caractere' USING ERRCODE = '22023'; END IF;
  PERFORM public.fn_executie_revendicare_cheie_blocheaza(p_cheie);                                   -- (1)
  v_d := public.fn_executie_revendicare_dosar_blocheaza(p_id, 'scriere');                            -- (2)
  v_amp := md5(jsonb_build_array('etapa', p_id, p_versiune, p_etapa, p_motiv)::text);
  v_rez := public.fn_executie_revendicare_cheie_citeste(p_cheie, 'etapa', v_amp);
  IF v_rez IS NOT NULL THEN RETURN v_rez; END IF;
  IF v_d.versiune IS DISTINCT FROM p_versiune THEN RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'rand', to_jsonb(v_d)); END IF;
  SELECT * INTO v_t FROM public.fn_executie_revendicare_tranzitii() x WHERE x.din = v_d.etapa AND x.spre = p_etapa;
  IF NOT FOUND THEN RAISE EXCEPTION 'revendicari: tranzitie nepermisa: % -> %', v_d.etapa, left(p_etapa, 40) USING ERRCODE = '22023'; END IF;
  IF NOT public.fn_executie_revendicare_drept(v_d.proiect_id, v_t.nivel) THEN
    RAISE EXCEPTION 'revendicari: tranzitia cere nivelul %', v_t.nivel USING ERRCODE = '42501';
  END IF;
  IF v_t.cere_motiv AND v_motiv IS NULL THEN RAISE EXCEPTION 'revendicari: tranzitia cere motiv' USING ERRCODE = '22023'; END IF;
  IF v_t.cere_tip IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.executie_revendicare_acte a
        WHERE a.dosar_id = v_d.id AND a.tip = v_t.cere_tip AND (v_t.cere_sens IS NULL OR a.sens = v_t.cere_sens)
          AND a.stare IN ('transmis', 'primit')) THEN
    RAISE EXCEPTION 'revendicari: tranzitia cere un act % transmis / primit in dosar', v_t.cere_tip USING ERRCODE = '22023';
  END IF;
  UPDATE public.executie_revendicari SET etapa = p_etapa, etapa_motiv = v_motiv WHERE id = v_d.id RETURNING * INTO v_d;
  PERFORM public.fn_executie_revendicare_cheie_scrie(p_cheie, 'etapa', v_amp, v_d.id, 'executie_revendicari', v_d.id);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'rand', to_jsonb(v_d));
END $f$;

-- 6.3 riscul juridic: evaluarea omului. 'decadere_constatata' (intrare SAU ieșire din ea) = administrare + motiv. Singura scriere a valorii.
CREATE FUNCTION public.fn_executie_revendicare_risc(p_id bigint, p_versiune integer, p_risc text, p_motiv text, p_cheie uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_d public.executie_revendicari; v_amp text; v_rez jsonb; v_motiv text := nullif(btrim(coalesce(p_motiv, '')), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'revendicari: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_versiune IS NULL OR p_risc IS NULL OR p_cheie IS NULL THEN RAISE EXCEPTION 'revendicari: parametri lipsa' USING ERRCODE = '22023'; END IF;
  IF p_risc NOT IN ('neevaluat', 'scazut', 'mediu', 'ridicat', 'decadere_constatata') THEN RAISE EXCEPTION 'revendicari: risc necunoscut' USING ERRCODE = '22023'; END IF;
  IF length(coalesce(p_motiv, '')) > 2000 THEN RAISE EXCEPTION 'revendicari: motivul depaseste 2000 de caractere' USING ERRCODE = '22023'; END IF;
  PERFORM public.fn_executie_revendicare_cheie_blocheaza(p_cheie);                                   -- (1)
  v_d := public.fn_executie_revendicare_dosar_blocheaza(p_id, 'scriere');                            -- (2)
  v_amp := md5(jsonb_build_array('risc', p_id, p_versiune, p_risc, p_motiv)::text);
  v_rez := public.fn_executie_revendicare_cheie_citeste(p_cheie, 'risc', v_amp);
  IF v_rez IS NOT NULL THEN RETURN v_rez; END IF;
  IF v_d.etapa IN ('inchis', 'retras') THEN RAISE EXCEPTION 'revendicari: dosarul e inchis' USING ERRCODE = '22023'; END IF;
  IF v_d.versiune IS DISTINCT FROM p_versiune THEN RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'rand', to_jsonb(v_d)); END IF;
  IF p_risc = v_d.risc_juridic THEN RAISE EXCEPTION 'revendicari: riscul e deja %', p_risc USING ERRCODE = '22023'; END IF;
  IF (p_risc = 'decadere_constatata' OR v_d.risc_juridic = 'decadere_constatata') THEN
    IF NOT public.fn_executie_revendicare_drept(v_d.proiect_id, 'administrare') THEN
      RAISE EXCEPTION 'revendicari: constatarea decaderii cere nivelul administrare' USING ERRCODE = '42501';
    END IF;
    IF v_motiv IS NULL THEN RAISE EXCEPTION 'revendicari: constatarea decaderii cere motiv' USING ERRCODE = '22023'; END IF;
  END IF;
  UPDATE public.executie_revendicari SET risc_juridic = p_risc, risc_motiv = v_motiv WHERE id = v_d.id RETURNING * INTO v_d;
  PERFORM public.fn_executie_revendicare_cheie_scrie(p_cheie, 'risc', v_amp, v_d.id, 'executie_revendicari', v_d.id);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'rand', to_jsonb(v_d));
END $f$;

-- 6.4 legăturile cu reperele din fișa contractului: 'leaga' (scriere), 'confirma' (administrare, pe versiunea reperului văzută),
-- 'scoate' (scriere, motiv). Reperul = rând al altui modul: comparat pe proiect înainte de lock, FOR SHARE NOWAIT la final.
CREATE FUNCTION public.fn_executie_revendicare_reper(p_dosar bigint, p_actiune text, p_legatura bigint, p_versiune integer, p_date jsonb, p_cheie uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_d public.executie_revendicari; v_l public.executie_revendicare_repere; v_r public.executie_contract_repere;
        v_amp text; v_rez jsonb; v_p bigint; v_reper bigint; v_rol text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'revendicari: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_dosar IS NULL OR p_cheie IS NULL OR p_actiune IS NULL OR p_actiune NOT IN ('leaga', 'confirma', 'scoate')
     OR (p_actiune = 'leaga') <> (p_legatura IS NULL) OR (p_legatura IS NULL) <> (p_versiune IS NULL) THEN
    RAISE EXCEPTION 'revendicari: parametri lipsa' USING ERRCODE = '22023';
  END IF;
  PERFORM public.fn_executie_revendicare_valideaza(p_date, '{"reper_id":"id","rol":"text:20","reper_versiune":"int:1:2000000000","motiv":"text:2000"}'::jsonb);
  PERFORM public.fn_executie_revendicare_cheie_blocheaza(p_cheie);                                   -- (1)
  v_d := public.fn_executie_revendicare_dosar_blocheaza(p_dosar, 'scriere');                         -- (2)
  IF p_legatura IS NOT NULL THEN
    SELECT * INTO v_l FROM public.executie_revendicare_repere WHERE id = p_legatura AND dosar_id = v_d.id FOR UPDATE;   -- (3)
    IF NOT FOUND THEN RAISE EXCEPTION 'revendicari: legatura nu exista in dosar' USING ERRCODE = '42501'; END IF;
  END IF;
  v_amp := md5(jsonb_build_array('reper', p_dosar, p_actiune, p_legatura, p_versiune, p_date)::text);
  v_rez := public.fn_executie_revendicare_cheie_citeste(p_cheie, 'reper', v_amp);
  IF v_rez IS NOT NULL THEN RETURN v_rez; END IF;
  IF v_d.etapa IN ('inchis', 'retras') THEN RAISE EXCEPTION 'revendicari: dosarul e inchis' USING ERRCODE = '22023'; END IF;
  IF p_legatura IS NOT NULL AND v_l.versiune IS DISTINCT FROM p_versiune THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'rand', to_jsonb(v_l));
  END IF;
  IF p_actiune = 'leaga' THEN
    v_reper := (p_date->>'reper_id')::bigint; v_rol := public.fn_executie_revendicare_txt(p_date, 'rol');
    IF v_reper IS NULL OR v_rol IS NULL THEN RAISE EXCEPTION 'revendicari: reperul si rolul sunt obligatorii' USING ERRCODE = '22023'; END IF;
    SELECT r.proiect_id INTO v_p FROM public.executie_contract_repere r WHERE r.id = v_reper;
    IF v_p IS DISTINCT FROM v_d.proiect_id THEN RAISE EXCEPTION 'revendicari: reperul nu exista sau nu e in proiectul dosarului' USING ERRCODE = '42501'; END IF;
    IF EXISTS (SELECT 1 FROM public.executie_revendicare_repere l WHERE l.dosar_id = v_d.id AND l.reper_id = v_reper AND l.rol = v_rol AND l.activ) THEN
      RAISE EXCEPTION 'revendicari: reperul e deja legat cu acest rol' USING ERRCODE = '23505';
    END IF;
    SELECT * INTO v_r FROM public.executie_contract_repere r WHERE r.id = v_reper AND r.proiect_id = v_d.proiect_id FOR SHARE NOWAIT;   -- (4)
    IF NOT FOUND THEN RAISE EXCEPTION 'revendicari: reperul nu exista sau nu e in proiectul dosarului' USING ERRCODE = '42501'; END IF;
    INSERT INTO public.executie_revendicare_repere (dosar_id, proiect_id, reper_id, rol, reper_versiune_legata, titlu_copie, citat_copie, sursa_copie)
    VALUES (v_d.id, v_d.proiect_id, v_r.id, v_rol, v_r.versiune, v_r.titlu, v_r.citat, v_r.sursa)
    RETURNING * INTO v_l;
  ELSIF p_actiune = 'confirma' THEN
    IF NOT public.fn_executie_revendicare_drept(v_d.proiect_id, 'administrare') THEN
      RAISE EXCEPTION 'revendicari: confirmarea sursei cere nivelul administrare' USING ERRCODE = '42501';
    END IF;
    IF NOT v_l.activ THEN RAISE EXCEPTION 'revendicari: legatura e scoasa' USING ERRCODE = '22023'; END IF;
    IF p_date->'reper_versiune' IS NULL OR jsonb_typeof(p_date->'reper_versiune') = 'null' THEN
      RAISE EXCEPTION 'revendicari: confirmarea cere versiunea reperului vazuta' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_r FROM public.executie_contract_repere r WHERE r.id = v_l.reper_id AND r.proiect_id = v_d.proiect_id FOR SHARE NOWAIT;   -- (4)
    IF NOT FOUND OR NOT v_r.activ THEN RAISE EXCEPTION 'revendicari: reperul nu mai e activ in fisa contractului' USING ERRCODE = '22023'; END IF;
    IF v_r.versiune IS DISTINCT FROM (p_date->>'reper_versiune')::int THEN
      RETURN jsonb_build_object('ok', false, 'motiv', 'reper_schimbat', 'rand', to_jsonb(v_l), 'reper_versiune', v_r.versiune);
    END IF;
    UPDATE public.executie_revendicare_repere SET confirmat_de = v_uid, confirmat_la = now(), reper_versiune_confirmata = v_r.versiune,
           reper_amprenta_confirmata = public.fn_executie_revendicare_reper_amprenta(v_r.id),
           titlu_copie = v_r.titlu, citat_copie = v_r.citat, sursa_copie = v_r.sursa
     WHERE id = v_l.id RETURNING * INTO v_l;
  ELSE
    IF NOT v_l.activ THEN RAISE EXCEPTION 'revendicari: legatura e deja scoasa' USING ERRCODE = '22023'; END IF;
    IF public.fn_executie_revendicare_txt(p_date, 'motiv') IS NULL THEN RAISE EXCEPTION 'revendicari: scoaterea cere motiv' USING ERRCODE = '22023'; END IF;
    UPDATE public.executie_revendicare_repere SET activ = false, motiv_scoatere = public.fn_executie_revendicare_txt(p_date, 'motiv')
     WHERE id = v_l.id RETURNING * INTO v_l;
  END IF;
  PERFORM public.fn_executie_revendicare_cheie_scrie(p_cheie, 'reper', v_amp, v_d.id, 'executie_revendicare_repere', v_l.id);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'rand', to_jsonb(v_l));
END $f$;

-- 6.5 actul: creare (p_id NULL) / modificare DOAR în ciornă. Tipul și sensul nu se schimbă. Numerele: verificarea dublurilor pe forma
-- canonică (aceeași ca indexul unic, care rămâne garanția finală).
CREATE FUNCTION public.fn_executie_revendicare_act(p_dosar bigint, p_id bigint, p_versiune integer, p_date jsonb, p_cheie uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_d public.executie_revendicari; v_a public.executie_revendicare_acte; v_amp text; v_rez jsonb;
        v_tip text; v_sens text; v_ant bigint; v_nri text; v_nrb text; v_conf boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'revendicari: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_dosar IS NULL OR p_cheie IS NULL OR (p_id IS NULL) <> (p_versiune IS NULL) THEN RAISE EXCEPTION 'revendicari: parametri lipsa' USING ERRCODE = '22023'; END IF;
  PERFORM public.fn_executie_revendicare_valideaza(p_date, '{"tip":"text:40","sens":"text:10","act_anterior_id":"id","titlu":"text:300",
    "rezumat":"text:8000","cronologie":"text:20000","temei":"text:8000","argumentare":"text:20000","nr_iesire":"text:100",
    "nr_beneficiar":"text:100","data_document":"data","zile_solicitate":"int:0:3650","suma_a":"suma","suma_b":"suma","suma_c":"suma",
    "moneda":"text:3","cuantificare_confirmata":"bool","observatii":"text:4000"}'::jsonb);
  PERFORM public.fn_executie_revendicare_cheie_blocheaza(p_cheie);                                   -- (1)
  v_d := public.fn_executie_revendicare_dosar_blocheaza(p_dosar, 'scriere');                         -- (2)
  IF p_id IS NOT NULL THEN
    SELECT * INTO v_a FROM public.executie_revendicare_acte WHERE id = p_id AND dosar_id = v_d.id FOR UPDATE;   -- (3)
    IF NOT FOUND THEN RAISE EXCEPTION 'revendicari: actul nu exista in dosar' USING ERRCODE = '42501'; END IF;
  END IF;
  v_amp := md5(jsonb_build_array('act', p_dosar, p_id, p_versiune, p_date)::text);
  v_rez := public.fn_executie_revendicare_cheie_citeste(p_cheie, 'act', v_amp);
  IF v_rez IS NOT NULL THEN RETURN v_rez; END IF;
  IF v_d.etapa IN ('inchis', 'retras') THEN RAISE EXCEPTION 'revendicari: dosarul e inchis' USING ERRCODE = '22023'; END IF;
  v_tip := public.fn_executie_revendicare_txt(p_date, 'tip'); v_sens := public.fn_executie_revendicare_txt(p_date, 'sens');
  v_ant := (p_date->>'act_anterior_id')::bigint;
  v_nri := public.fn_executie_revendicare_txt(p_date, 'nr_iesire'); v_nrb := public.fn_executie_revendicare_txt(p_date, 'nr_beneficiar');
  v_conf := coalesce((p_date->>'cuantificare_confirmata')::boolean, false);
  IF p_id IS NOT NULL THEN
    IF v_a.versiune IS DISTINCT FROM p_versiune THEN RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'rand', to_jsonb(v_a)); END IF;
    IF v_a.stare <> 'ciorna' THEN RAISE EXCEPTION 'revendicari: actul se modifica doar in ciorna (acum %)', v_a.stare USING ERRCODE = '22023'; END IF;
    IF (v_tip IS NOT NULL AND v_tip <> v_a.tip) OR (v_sens IS NOT NULL AND v_sens <> v_a.sens) THEN
      RAISE EXCEPTION 'revendicari: tipul si sensul actului nu se schimba' USING ERRCODE = '22023';
    END IF;
    v_tip := v_a.tip; v_sens := v_a.sens;
  ELSIF v_tip IS NULL OR v_sens IS NULL THEN
    RAISE EXCEPTION 'revendicari: tipul si sensul actului sunt obligatorii' USING ERRCODE = '22023';
  END IF;
  IF public.fn_executie_revendicare_txt(p_date, 'titlu') IS NULL THEN RAISE EXCEPTION 'revendicari: titlul e obligatoriu' USING ERRCODE = '22023'; END IF;
  IF v_ant IS NOT NULL AND (v_ant IS NOT DISTINCT FROM p_id OR NOT EXISTS (SELECT 1 FROM public.executie_revendicare_acte x WHERE x.id = v_ant AND x.dosar_id = v_d.id)) THEN
    RAISE EXCEPTION 'revendicari: actul anterior nu exista in dosar' USING ERRCODE = '42501';
  END IF;
  IF v_nri IS NOT NULL AND EXISTS (SELECT 1 FROM public.executie_revendicare_acte x
                                    WHERE public.fn_executie_revendicare_nr_canonic(x.nr_iesire) = public.fn_executie_revendicare_nr_canonic(v_nri)
                                      AND x.stare <> 'anulat' AND x.id IS DISTINCT FROM p_id) THEN
    RAISE EXCEPTION 'revendicari: numarul de iesire e deja folosit' USING ERRCODE = '23505';
  END IF;
  IF v_nrb IS NOT NULL AND EXISTS (SELECT 1 FROM public.executie_revendicare_acte x
                                    WHERE x.proiect_id = v_d.proiect_id AND x.sens = v_sens
                                      AND public.fn_executie_revendicare_nr_canonic(x.nr_beneficiar) = public.fn_executie_revendicare_nr_canonic(v_nrb)
                                      AND x.stare <> 'anulat' AND x.id IS DISTINCT FROM p_id) THEN
    RAISE EXCEPTION 'revendicari: numarul beneficiarului e deja folosit in proiect' USING ERRCODE = '23505';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.executie_revendicare_acte (dosar_id, proiect_id, tip, sens, act_anterior_id, titlu, rezumat, cronologie, temei, argumentare,
      nr_iesire, nr_beneficiar, data_document, zile_solicitate, suma_a, suma_b, suma_c, moneda, cuantificare_confirmata_de, cuantificare_confirmata_la, observatii)
    VALUES (v_d.id, v_d.proiect_id, v_tip, v_sens, v_ant, public.fn_executie_revendicare_txt(p_date, 'titlu'),
      public.fn_executie_revendicare_txt(p_date, 'rezumat'), public.fn_executie_revendicare_txt(p_date, 'cronologie'),
      public.fn_executie_revendicare_txt(p_date, 'temei'), public.fn_executie_revendicare_txt(p_date, 'argumentare'), v_nri, v_nrb,
      (p_date->>'data_document')::date, (p_date->>'zile_solicitate')::int, (p_date->>'suma_a')::numeric, (p_date->>'suma_b')::numeric,
      (p_date->>'suma_c')::numeric, public.fn_executie_revendicare_txt(p_date, 'moneda'),
      CASE WHEN v_conf THEN v_uid END, CASE WHEN v_conf THEN now() END, public.fn_executie_revendicare_txt(p_date, 'observatii'))
    RETURNING * INTO v_a;
  ELSE
    UPDATE public.executie_revendicare_acte SET act_anterior_id = v_ant, titlu = public.fn_executie_revendicare_txt(p_date, 'titlu'),
      rezumat = public.fn_executie_revendicare_txt(p_date, 'rezumat'), cronologie = public.fn_executie_revendicare_txt(p_date, 'cronologie'),
      temei = public.fn_executie_revendicare_txt(p_date, 'temei'), argumentare = public.fn_executie_revendicare_txt(p_date, 'argumentare'),
      nr_iesire = v_nri, nr_beneficiar = v_nrb, data_document = (p_date->>'data_document')::date,
      zile_solicitate = (p_date->>'zile_solicitate')::int, suma_a = (p_date->>'suma_a')::numeric, suma_b = (p_date->>'suma_b')::numeric,
      suma_c = (p_date->>'suma_c')::numeric, moneda = public.fn_executie_revendicare_txt(p_date, 'moneda'),
      cuantificare_confirmata_de = CASE WHEN v_conf THEN v_uid END, cuantificare_confirmata_la = CASE WHEN v_conf THEN now() END,
      observatii = public.fn_executie_revendicare_txt(p_date, 'observatii')
    WHERE id = v_a.id RETURNING * INTO v_a;
  END IF;
  PERFORM public.fn_executie_revendicare_cheie_scrie(p_cheie, 'act', v_amp, v_d.id, 'executie_revendicare_acte', v_a.id);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'rand', to_jsonb(v_a));
END $f$;

-- 6.6 starea actului, pe fn_executie_revendicare_act_tranzitii() (fără tranzițiile 'comunicare'). Aprobarea (owner) cere TOATE temeiurile
-- confirmate și valabile și fixează amprenta lor; semnarea cere exemplarul semnat (document al proiectului, cu SHA-256) și aprobarea încă
-- valabilă (fn_executie_revendicare_act_aprobare_valida: conținut + surse). Înregistrarea transmiterii (6.7) NU cere aprobarea valabilă:
-- e un fapt deja petrecut; vederea arată aprobare_valida = false.
CREATE FUNCTION public.fn_executie_revendicare_act_stare(p_act bigint, p_versiune integer, p_stare text, p_date jsonb, p_cheie uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_d public.executie_revendicari; v_a public.executie_revendicare_acte; v_t record; v_amp text; v_rez jsonb;
        v_dosar bigint; v_motiv text; v_doc bigint; v_tinta jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'revendicari: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_act IS NULL OR p_versiune IS NULL OR p_stare IS NULL OR p_cheie IS NULL THEN RAISE EXCEPTION 'revendicari: parametri lipsa' USING ERRCODE = '22023'; END IF;
  PERFORM public.fn_executie_revendicare_valideaza(coalesce(p_date, '{}'::jsonb), '{"motiv":"text:2000","fisier_semnat_doc_id":"id"}'::jsonb);
  SELECT a.dosar_id INTO v_dosar FROM public.executie_revendicare_acte a WHERE a.id = p_act;
  PERFORM public.fn_executie_revendicare_cheie_blocheaza(p_cheie);                                   -- (1)
  v_d := public.fn_executie_revendicare_dosar_blocheaza(v_dosar, 'scriere');                         -- (2)
  SELECT * INTO v_a FROM public.executie_revendicare_acte WHERE id = p_act AND dosar_id = v_d.id FOR UPDATE;   -- (3)
  IF NOT FOUND THEN RAISE EXCEPTION 'revendicari: dosarul nu exista sau nu ai drept' USING ERRCODE = '42501'; END IF;
  v_amp := md5(jsonb_build_array('act_stare', p_act, p_versiune, p_stare, p_date)::text);
  v_rez := public.fn_executie_revendicare_cheie_citeste(p_cheie, 'act_stare', v_amp);
  IF v_rez IS NOT NULL THEN RETURN v_rez; END IF;
  IF v_d.etapa IN ('inchis', 'retras') THEN RAISE EXCEPTION 'revendicari: dosarul e inchis' USING ERRCODE = '22023'; END IF;
  IF v_a.versiune IS DISTINCT FROM p_versiune THEN RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'rand', to_jsonb(v_a)); END IF;
  SELECT * INTO v_t FROM public.fn_executie_revendicare_act_tranzitii() x WHERE x.sens = v_a.sens AND x.din = v_a.stare AND x.spre = p_stare AND x.nivel <> 'comunicare';
  IF NOT FOUND THEN RAISE EXCEPTION 'revendicari: tranzitie nepermisa pentru act: % -> %', v_a.stare, left(p_stare, 40) USING ERRCODE = '22023'; END IF;
  IF NOT public.fn_executie_revendicare_drept(v_d.proiect_id, v_t.nivel) THEN
    RAISE EXCEPTION 'revendicari: tranzitia actului cere nivelul %', v_t.nivel USING ERRCODE = '42501';
  END IF;
  v_motiv := public.fn_executie_revendicare_txt(coalesce(p_date, '{}'::jsonb), 'motiv');
  IF v_t.cere_motiv AND v_motiv IS NULL THEN RAISE EXCEPTION 'revendicari: tranzitia cere motiv' USING ERRCODE = '22023'; END IF;
  IF p_stare IN ('aprobat', 'semnat') THEN
    -- alegerea 5 (varianta A): doar sursele confirmate alimentează un document; reperele „temei” se țin FOR SHARE NOWAIT (alt modul, la final).
    -- Legăturile „temei” se schimbă doar sub lock-ul dosarului (ținut aici), deci setul citit mai jos e cel aprobat / semnat.
    PERFORM 1 FROM public.executie_contract_repere r
     WHERE r.id IN (SELECT l.reper_id FROM public.executie_revendicare_repere l WHERE l.dosar_id = v_d.id AND l.rol = 'temei' AND l.activ)
     ORDER BY r.id FOR SHARE NOWAIT;                                                                  -- (4)
    -- runda 2 (P1): TOATE temeiurile active confirmate și valabile, nu „măcar unul”
    IF public.fn_executie_revendicare_surse_valide(v_d.id) IS NOT TRUE THEN
      RAISE EXCEPTION 'revendicari: temeiurile dosarului nu sunt toate confirmate si valabile in fisa contractului' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_stare = 'aprobat' THEN
    -- aprobarea fixează revizia, conținutul ȘI setul concret de surse (legături + versiunile / amprentele reperelor confirmate)
    UPDATE public.executie_revendicare_acte SET stare = 'aprobat', aprobat_de = v_uid, aprobat_la = now(), aprobat_revizie = v_a.revizie,
           aprobat_amprenta = public.fn_executie_revendicare_act_amprenta(v_a),
           aprobat_surse_amprenta = public.fn_executie_revendicare_surse_amprenta(v_d.id), stare_motiv = NULL
     WHERE id = v_a.id RETURNING * INTO v_a;
  ELSIF p_stare = 'semnat' THEN
    -- aceeași definiție ca vederea (L19): conținut, revizie, surse neschimbate și valabile; o sursă schimbată (chiar reconfirmată) cere
    -- reaprobarea: aprobat -> ciornă (revizia crește) -> de aprobat -> aprobat
    IF public.fn_executie_revendicare_act_aprobare_valida(v_a) IS NOT TRUE THEN
      RAISE EXCEPTION 'revendicari: aprobarea nu mai corespunde continutului sau surselor actului' USING ERRCODE = '22023';
    END IF;
    v_doc := (p_date->>'fisier_semnat_doc_id')::bigint;
    IF v_doc IS NULL THEN RAISE EXCEPTION 'revendicari: semnarea cere exemplarul semnat' USING ERRCODE = '22023'; END IF;
    v_tinta := public.fn_executie_revendicare_tinta('document', v_doc, v_d.proiect_id);              -- (4)
    IF coalesce(v_tinta->>'sha256', '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'revendicari: exemplarul semnat nu are amprenta SHA-256' USING ERRCODE = '22023';
    END IF;
    UPDATE public.executie_revendicare_acte SET stare = 'semnat', fisier_semnat_doc_id = v_doc, fisier_semnat_sha256 = v_tinta->>'sha256',
           semnat_inregistrat_de = v_uid, semnat_la = now()
     WHERE id = v_a.id RETURNING * INTO v_a;
  ELSIF p_stare = 'ciorna' THEN
    -- aprobarea nu se transferă pe o versiune nouă: ieșirea din „aprobat” crește revizia
    UPDATE public.executie_revendicare_acte SET stare = 'ciorna', aprobat_de = NULL, aprobat_la = NULL, aprobat_revizie = NULL, aprobat_amprenta = NULL,
           aprobat_surse_amprenta = NULL, revizie = CASE WHEN v_a.stare = 'aprobat' THEN v_a.revizie + 1 ELSE v_a.revizie END
     WHERE id = v_a.id RETURNING * INTO v_a;
  ELSE
    UPDATE public.executie_revendicare_acte SET stare = p_stare, stare_motiv = v_motiv WHERE id = v_a.id RETURNING * INTO v_a;
  END IF;
  PERFORM public.fn_executie_revendicare_cheie_scrie(p_cheie, 'act_stare', v_amp, v_d.id, 'executie_revendicare_acte', v_a.id);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'rand', to_jsonb(v_a));
END $f$;

-- 6.7 comunicarea: înregistrarea transmiterii (act de ieșire SEMNAT) / primirii (act de intrare), DUPĂ ce s-a întâmplat (data ≤ azi în
-- România). p_comunicare NULL = comunicare nouă (p_versiune = versiunea actului); altfel completarea câmpurilor goale (data primirii,
-- numărul, dovada) sau anularea (administrare, motiv; dacă nu mai rămâne nicio comunicare, actul revine la semnat / ciornă).
CREATE FUNCTION public.fn_executie_revendicare_comunicare(p_act bigint, p_comunicare bigint, p_versiune integer, p_date jsonb, p_cheie uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_d public.executie_revendicari; v_a public.executie_revendicare_acte; v_c public.executie_revendicare_comunicari;
        v_t record; v_amp text; v_rez jsonb; v_dosar bigint; v_azi date := public.fn_executie_revendicare_azi(); v_tinta jsonb; v_doc bigint;
        v_dt date; v_dp date; v_spre text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'revendicari: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_act IS NULL OR p_versiune IS NULL OR p_cheie IS NULL THEN RAISE EXCEPTION 'revendicari: parametri lipsa' USING ERRCODE = '22023'; END IF;
  PERFORM public.fn_executie_revendicare_valideaza(p_date, '{"destinatar":"text:300","canal":"text:20","data_transmitere":"data",
    "data_primire":"data","nr_inregistrare":"text:100","dovada_doc_id":"id","observatii":"text:2000","anulat":"bool","motiv":"text:2000"}'::jsonb);
  SELECT a.dosar_id INTO v_dosar FROM public.executie_revendicare_acte a WHERE a.id = p_act;
  PERFORM public.fn_executie_revendicare_cheie_blocheaza(p_cheie);                                   -- (1)
  v_d := public.fn_executie_revendicare_dosar_blocheaza(v_dosar, 'scriere');                         -- (2)
  SELECT * INTO v_a FROM public.executie_revendicare_acte WHERE id = p_act AND dosar_id = v_d.id FOR UPDATE;   -- (3) actul
  IF NOT FOUND THEN RAISE EXCEPTION 'revendicari: dosarul nu exista sau nu ai drept' USING ERRCODE = '42501'; END IF;
  IF p_comunicare IS NOT NULL THEN
    SELECT * INTO v_c FROM public.executie_revendicare_comunicari WHERE id = p_comunicare AND act_id = v_a.id FOR UPDATE;   -- (3) comunicarea
    IF NOT FOUND THEN RAISE EXCEPTION 'revendicari: comunicarea nu exista la act' USING ERRCODE = '42501'; END IF;
  END IF;
  v_amp := md5(jsonb_build_array('comunicare', p_act, p_comunicare, p_versiune, p_date)::text);
  v_rez := public.fn_executie_revendicare_cheie_citeste(p_cheie, 'comunicare', v_amp);
  IF v_rez IS NOT NULL THEN RETURN v_rez; END IF;
  IF v_d.etapa IN ('inchis', 'retras') THEN RAISE EXCEPTION 'revendicari: dosarul e inchis' USING ERRCODE = '22023'; END IF;
  v_dt := (p_date->>'data_transmitere')::date; v_dp := (p_date->>'data_primire')::date; v_doc := (p_date->>'dovada_doc_id')::bigint;
  IF v_dt > v_azi OR v_dp > v_azi THEN RAISE EXCEPTION 'revendicari: o comunicare se inregistreaza dupa ce s-a facut (data in viitor)' USING ERRCODE = '22023'; END IF;
  IF p_comunicare IS NULL THEN
    IF v_a.versiune IS DISTINCT FROM p_versiune THEN RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'rand', to_jsonb(v_a)); END IF;
    IF p_date ? 'anulat' OR p_date ? 'motiv' THEN RAISE EXCEPTION 'revendicari: anularea se face pe comunicarea existenta' USING ERRCODE = '22023'; END IF;
    v_spre := CASE v_a.sens WHEN 'iesire' THEN 'transmis' ELSE 'primit' END;
    SELECT * INTO v_t FROM public.fn_executie_revendicare_act_tranzitii() x WHERE x.sens = v_a.sens AND x.din = v_a.stare AND x.spre = v_spre AND x.nivel = 'comunicare';
    IF NOT FOUND THEN RAISE EXCEPTION 'revendicari: actul in starea % nu poate fi %', v_a.stare, v_spre USING ERRCODE = '22023'; END IF;
    IF v_a.sens = 'iesire' AND v_dt IS NULL THEN RAISE EXCEPTION 'revendicari: transmiterea cere data transmiterii' USING ERRCODE = '22023'; END IF;
    IF v_a.sens = 'intrare' AND v_dp IS NULL THEN RAISE EXCEPTION 'revendicari: primirea cere data primirii' USING ERRCODE = '22023'; END IF;
    IF public.fn_executie_revendicare_txt(p_date, 'destinatar') IS NULL OR public.fn_executie_revendicare_txt(p_date, 'canal') IS NULL THEN
      RAISE EXCEPTION 'revendicari: destinatarul si canalul sunt obligatorii' USING ERRCODE = '22023';
    END IF;
    IF v_doc IS NOT NULL THEN v_tinta := public.fn_executie_revendicare_tinta('document', v_doc, v_d.proiect_id); END IF;   -- (4)
    INSERT INTO public.executie_revendicare_comunicari (act_id, dosar_id, proiect_id, destinatar, canal, data_transmitere, data_primire,
                                                        nr_inregistrare, dovada_doc_id, dovada_sha256, observatii)
    VALUES (v_a.id, v_d.id, v_d.proiect_id, public.fn_executie_revendicare_txt(p_date, 'destinatar'), public.fn_executie_revendicare_txt(p_date, 'canal'),
            v_dt, v_dp, public.fn_executie_revendicare_txt(p_date, 'nr_inregistrare'), v_doc,
            CASE WHEN coalesce(v_tinta->>'sha256', '') ~ '^[0-9a-f]{64}$' THEN v_tinta->>'sha256' END,
            public.fn_executie_revendicare_txt(p_date, 'observatii'))
    RETURNING * INTO v_c;
    IF v_a.stare IS DISTINCT FROM v_spre THEN
      UPDATE public.executie_revendicare_acte SET stare = v_spre WHERE id = v_a.id;
    END IF;
  ELSE
    IF v_c.versiune IS DISTINCT FROM p_versiune THEN RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'rand', to_jsonb(v_c)); END IF;
    IF v_c.anulat THEN RAISE EXCEPTION 'revendicari: comunicarea e anulata' USING ERRCODE = '22023'; END IF;
    IF coalesce((p_date->>'anulat')::boolean, false) THEN
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_date) k WHERE k NOT IN ('anulat', 'motiv')) THEN
        RAISE EXCEPTION 'revendicari: anularea primeste doar motivul' USING ERRCODE = '22023';
      END IF;
      IF NOT public.fn_executie_revendicare_drept(v_d.proiect_id, 'administrare') THEN
        RAISE EXCEPTION 'revendicari: anularea unei comunicari cere nivelul administrare' USING ERRCODE = '42501';
      END IF;
      IF public.fn_executie_revendicare_txt(p_date, 'motiv') IS NULL THEN RAISE EXCEPTION 'revendicari: anularea cere motiv' USING ERRCODE = '22023'; END IF;
      UPDATE public.executie_revendicare_comunicari SET anulat = true, anulat_motiv = public.fn_executie_revendicare_txt(p_date, 'motiv')
       WHERE id = v_c.id RETURNING * INTO v_c;
      IF v_a.stare IN ('transmis', 'primit') AND NOT EXISTS (SELECT 1 FROM public.executie_revendicare_comunicari x WHERE x.act_id = v_a.id AND NOT x.anulat) THEN
        UPDATE public.executie_revendicare_acte SET stare = CASE v_a.sens WHEN 'iesire' THEN 'semnat' ELSE 'ciorna' END WHERE id = v_a.id;
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_date) k WHERE k NOT IN ('data_primire', 'nr_inregistrare', 'dovada_doc_id')) THEN
        RAISE EXCEPTION 'revendicari: se completeaza doar data primirii, numarul si dovada' USING ERRCODE = '22023';
      END IF;
      IF (v_dp IS NOT NULL AND v_c.data_primire IS NOT NULL) OR (v_doc IS NOT NULL AND v_c.dovada_doc_id IS NOT NULL)
         OR (public.fn_executie_revendicare_txt(p_date, 'nr_inregistrare') IS NOT NULL AND v_c.nr_inregistrare IS NOT NULL) THEN
        RAISE EXCEPTION 'revendicari: campul e deja completat (corectura = anulare + comunicare noua)' USING ERRCODE = '22023';
      END IF;
      IF v_doc IS NOT NULL THEN v_tinta := public.fn_executie_revendicare_tinta('document', v_doc, v_d.proiect_id); END IF;   -- (4)
      UPDATE public.executie_revendicare_comunicari SET
        data_primire = coalesce(v_dp, data_primire),
        nr_inregistrare = coalesce(public.fn_executie_revendicare_txt(p_date, 'nr_inregistrare'), nr_inregistrare),
        dovada_doc_id = coalesce(v_doc, dovada_doc_id),
        dovada_sha256 = CASE WHEN v_doc IS NOT NULL THEN (CASE WHEN coalesce(v_tinta->>'sha256', '') ~ '^[0-9a-f]{64}$' THEN v_tinta->>'sha256' END) ELSE dovada_sha256 END
       WHERE id = v_c.id RETURNING * INTO v_c;
    END IF;
  END IF;
  PERFORM public.fn_executie_revendicare_cheie_scrie(p_cheie, 'comunicare', v_amp, v_d.id, 'executie_revendicare_comunicari', v_c.id);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'rand', to_jsonb(v_c));
END $f$;

-- 6.8 termenul: creare / modificare a intrărilor (doar cât e deschis). Confirmările au RPC-ul lor; trigger-ul le invalidează la schimbare.
CREATE FUNCTION public.fn_executie_revendicare_termen(p_dosar bigint, p_id bigint, p_versiune integer, p_date jsonb, p_cheie uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_d public.executie_revendicari; v_t public.executie_revendicare_termene; v_amp text; v_rez jsonb;
        v_act bigint; v_ter bigint; v_leg bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'revendicari: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_dosar IS NULL OR p_cheie IS NULL OR (p_id IS NULL) <> (p_versiune IS NULL) THEN RAISE EXCEPTION 'revendicari: parametri lipsa' USING ERRCODE = '22023'; END IF;
  PERFORM public.fn_executie_revendicare_valideaza(p_date, '{"tip_obligatie":"text:40","mod":"text:10","declansator_tip":"text:40",
    "declansator_data":"data","declansator_act_id":"id","declansator_termen_id":"id","nr_zile":"int:1:3650","reper_legatura_id":"id",
    "justificare":"text:4000","observatii":"text:4000"}'::jsonb);
  PERFORM public.fn_executie_revendicare_cheie_blocheaza(p_cheie);                                   -- (1)
  v_d := public.fn_executie_revendicare_dosar_blocheaza(p_dosar, 'scriere');                         -- (2)
  IF p_id IS NOT NULL THEN
    SELECT * INTO v_t FROM public.executie_revendicare_termene WHERE id = p_id AND dosar_id = v_d.id FOR UPDATE;   -- (3)
    IF NOT FOUND THEN RAISE EXCEPTION 'revendicari: termenul nu exista in dosar' USING ERRCODE = '42501'; END IF;
  END IF;
  v_amp := md5(jsonb_build_array('termen', p_dosar, p_id, p_versiune, p_date)::text);
  v_rez := public.fn_executie_revendicare_cheie_citeste(p_cheie, 'termen', v_amp);
  IF v_rez IS NOT NULL THEN RETURN v_rez; END IF;
  IF v_d.etapa IN ('inchis', 'retras') THEN RAISE EXCEPTION 'revendicari: dosarul e inchis' USING ERRCODE = '22023'; END IF;
  IF p_id IS NOT NULL THEN
    IF v_t.versiune IS DISTINCT FROM p_versiune THEN RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'rand', to_jsonb(v_t)); END IF;
    IF v_t.stare <> 'deschis' THEN RAISE EXCEPTION 'revendicari: termenul nu mai e deschis' USING ERRCODE = '22023'; END IF;
  END IF;
  IF public.fn_executie_revendicare_txt(p_date, 'tip_obligatie') IS NULL OR public.fn_executie_revendicare_txt(p_date, 'mod') IS NULL
     OR public.fn_executie_revendicare_txt(p_date, 'declansator_tip') IS NULL THEN
    RAISE EXCEPTION 'revendicari: obligatia, modul si declansatorul sunt obligatorii' USING ERRCODE = '22023';
  END IF;
  v_act := (p_date->>'declansator_act_id')::bigint; v_ter := (p_date->>'declansator_termen_id')::bigint; v_leg := (p_date->>'reper_legatura_id')::bigint;
  -- fiecare referință: a ACELUIAȘI dosar (L09)
  IF (v_act IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.executie_revendicare_acte x WHERE x.id = v_act AND x.dosar_id = v_d.id))
     OR (v_ter IS NOT NULL AND (v_ter IS NOT DISTINCT FROM p_id OR NOT EXISTS (SELECT 1 FROM public.executie_revendicare_termene x WHERE x.id = v_ter AND x.dosar_id = v_d.id)))
     OR (v_leg IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.executie_revendicare_repere x WHERE x.id = v_leg AND x.dosar_id = v_d.id)) THEN
    RAISE EXCEPTION 'revendicari: referinta nu exista in dosar' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.executie_revendicare_termene (dosar_id, proiect_id, tip_obligatie, mod, reper_legatura_id, declansator_tip, declansator_data,
                                                     declansator_act_id, declansator_termen_id, nr_zile, justificare, observatii)
    VALUES (v_d.id, v_d.proiect_id, public.fn_executie_revendicare_txt(p_date, 'tip_obligatie'), public.fn_executie_revendicare_txt(p_date, 'mod'), v_leg,
            public.fn_executie_revendicare_txt(p_date, 'declansator_tip'), (p_date->>'declansator_data')::date, v_act, v_ter,
            (p_date->>'nr_zile')::int, public.fn_executie_revendicare_txt(p_date, 'justificare'), public.fn_executie_revendicare_txt(p_date, 'observatii'))
    RETURNING * INTO v_t;
  ELSE
    UPDATE public.executie_revendicare_termene SET tip_obligatie = public.fn_executie_revendicare_txt(p_date, 'tip_obligatie'),
           mod = public.fn_executie_revendicare_txt(p_date, 'mod'), reper_legatura_id = v_leg,
           declansator_tip = public.fn_executie_revendicare_txt(p_date, 'declansator_tip'), declansator_data = (p_date->>'declansator_data')::date,
           declansator_act_id = v_act, declansator_termen_id = v_ter, nr_zile = (p_date->>'nr_zile')::int,
           justificare = public.fn_executie_revendicare_txt(p_date, 'justificare'), observatii = public.fn_executie_revendicare_txt(p_date, 'observatii')
     WHERE id = v_t.id RETURNING * INTO v_t;
  END IF;
  PERFORM public.fn_executie_revendicare_cheie_scrie(p_cheie, 'termen', v_amp, v_d.id, 'executie_revendicare_termene', v_t.id);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'rand', to_jsonb(v_t));
END $f$;

-- 6.9 confirmările termenului: 'regula' (administrare; legătura cu reperul confirmată și valabilă, zile cunoscute), 'declansator'
-- (scriere; data = sursa ei de acum și lanțul precedentelor valabil), 'data' (regulă: scriere, DOAR data propusă, intrări + lanț
-- valabile; manual: administrare + justificare), 'indeplinit' (scriere; fn_executie_revendicare_indeplinire_la: actul compatibil al
-- dosarului, transmis / primit, neanulat), 'anulat' / 'redeschide' (administrare + motiv).
CREATE FUNCTION public.fn_executie_revendicare_termen_confirma(p_termen bigint, p_versiune integer, p_ce text, p_date jsonb, p_cheie uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_d public.executie_revendicari; v_t public.executie_revendicare_termene; v_amp text; v_rez jsonb;
        v_dosar bigint; v_l public.executie_revendicare_repere; v_data date; v_just text; v_motiv text; v_act bigint; v_sursa date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'revendicari: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_termen IS NULL OR p_versiune IS NULL OR p_ce IS NULL OR p_cheie IS NULL
     OR p_ce NOT IN ('regula', 'declansator', 'data', 'indeplinit', 'anulat', 'redeschide') THEN
    RAISE EXCEPTION 'revendicari: parametri lipsa' USING ERRCODE = '22023';
  END IF;
  PERFORM public.fn_executie_revendicare_valideaza(coalesce(p_date, '{}'::jsonb), '{"data":"data","justificare":"text:4000","act_id":"id","motiv":"text:2000"}'::jsonb);
  SELECT t.dosar_id INTO v_dosar FROM public.executie_revendicare_termene t WHERE t.id = p_termen;
  PERFORM public.fn_executie_revendicare_cheie_blocheaza(p_cheie);                                   -- (1)
  v_d := public.fn_executie_revendicare_dosar_blocheaza(v_dosar, 'scriere');                         -- (2)
  SELECT * INTO v_t FROM public.executie_revendicare_termene WHERE id = p_termen AND dosar_id = v_d.id FOR UPDATE;   -- (3)
  IF NOT FOUND THEN RAISE EXCEPTION 'revendicari: dosarul nu exista sau nu ai drept' USING ERRCODE = '42501'; END IF;
  v_amp := md5(jsonb_build_array('termen_confirma', p_termen, p_versiune, p_ce, p_date)::text);
  v_rez := public.fn_executie_revendicare_cheie_citeste(p_cheie, 'termen_confirma', v_amp);
  IF v_rez IS NOT NULL THEN RETURN v_rez; END IF;
  IF v_d.etapa IN ('inchis', 'retras') THEN RAISE EXCEPTION 'revendicari: dosarul e inchis' USING ERRCODE = '22023'; END IF;
  IF v_t.versiune IS DISTINCT FROM p_versiune THEN RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'rand', to_jsonb(v_t)); END IF;
  v_motiv := public.fn_executie_revendicare_txt(coalesce(p_date, '{}'::jsonb), 'motiv');
  IF p_ce IN ('anulat', 'redeschide') THEN
    IF NOT public.fn_executie_revendicare_drept(v_d.proiect_id, 'administrare') THEN
      RAISE EXCEPTION 'revendicari: operatia cere nivelul administrare' USING ERRCODE = '42501';
    END IF;
    IF v_motiv IS NULL THEN RAISE EXCEPTION 'revendicari: operatia cere motiv' USING ERRCODE = '22023'; END IF;
    IF p_ce = 'anulat' THEN
      IF v_t.stare <> 'deschis' THEN RAISE EXCEPTION 'revendicari: doar un termen deschis se anuleaza' USING ERRCODE = '22023'; END IF;
      UPDATE public.executie_revendicare_termene SET stare = 'anulat', stare_motiv = v_motiv WHERE id = v_t.id RETURNING * INTO v_t;
    ELSE
      IF v_t.stare = 'deschis' THEN RAISE EXCEPTION 'revendicari: termenul e deja deschis' USING ERRCODE = '22023'; END IF;
      UPDATE public.executie_revendicare_termene SET stare = 'deschis', indeplinit_act_id = NULL, stare_motiv = v_motiv WHERE id = v_t.id RETURNING * INTO v_t;
    END IF;
  ELSE
    IF v_t.stare <> 'deschis' THEN RAISE EXCEPTION 'revendicari: termenul nu mai e deschis' USING ERRCODE = '22023'; END IF;
    IF p_ce = 'regula' THEN
      IF NOT public.fn_executie_revendicare_drept(v_d.proiect_id, 'administrare') THEN
        RAISE EXCEPTION 'revendicari: confirmarea regulii cere nivelul administrare' USING ERRCODE = '42501';
      END IF;
      IF v_t.mod <> 'regula' OR v_t.reper_legatura_id IS NULL OR v_t.nr_zile IS NULL THEN
        RAISE EXCEPTION 'revendicari: regula cere legatura cu reperul si numarul de zile' USING ERRCODE = '22023';
      END IF;
      SELECT * INTO v_l FROM public.executie_revendicare_repere WHERE id = v_t.reper_legatura_id AND dosar_id = v_d.id;
      PERFORM 1 FROM public.executie_contract_repere r WHERE r.id = v_l.reper_id FOR SHARE NOWAIT;    -- (4)
      IF NOT public.fn_executie_revendicare_legatura_valida(v_l.id) THEN
        RAISE EXCEPTION 'revendicari: sursa regulii nu e confirmata sau s-a schimbat' USING ERRCODE = '22023';
      END IF;
      UPDATE public.executie_revendicare_termene SET regula_confirmata_la = now(), regula_reper_versiune = v_l.reper_versiune_confirmata
       WHERE id = v_t.id RETURNING * INTO v_t;
    ELSIF p_ce = 'declansator' THEN
      IF v_t.declansator_data IS NULL THEN RAISE EXCEPTION 'revendicari: data declansatorului e necunoscuta' USING ERRCODE = '22023'; END IF;
      v_sursa := public.fn_executie_revendicare_declansator_data(v_t.id);
      IF v_sursa IS DISTINCT FROM v_t.declansator_data THEN
        RAISE EXCEPTION 'revendicari: data declansatorului difera de sursa ei (%)', coalesce(v_sursa::text, 'necunoscuta') USING ERRCODE = '22023';
      END IF;
      -- runda 2 (P1): data unui termen precedent e sursă doar dacă tot lanțul lui e valabil (nu doar „data păstrată”)
      IF public.fn_executie_revendicare_termen_lant_valid(v_t.id) IS NOT TRUE THEN
        RAISE EXCEPTION 'revendicari: termenul precedent e anulat sau sursa lui trebuie reverificata' USING ERRCODE = '22023';
      END IF;
      UPDATE public.executie_revendicare_termene SET declansator_confirmat_la = now() WHERE id = v_t.id RETURNING * INTO v_t;
    ELSIF p_ce = 'data' THEN
      v_data := (p_date->>'data')::date; v_just := public.fn_executie_revendicare_txt(coalesce(p_date, '{}'::jsonb), 'justificare');
      IF v_data IS NULL THEN RAISE EXCEPTION 'revendicari: confirmarea cere data' USING ERRCODE = '22023'; END IF;
      IF v_t.mod = 'regula' THEN
        IF v_t.data_propusa IS NULL THEN
          RAISE EXCEPTION 'revendicari: termenul nu are data propusa (regula / declansatorul neconfirmate sau necunoscute)' USING ERRCODE = '22023';
        END IF;
        IF public.fn_executie_revendicare_termen_intrari_valide(v_t.id) IS NOT TRUE THEN
          RAISE EXCEPTION 'revendicari: sursa termenului trebuie reverificata' USING ERRCODE = '22023';
        END IF;
        IF v_data IS DISTINCT FROM v_t.data_propusa THEN
          RAISE EXCEPTION 'revendicari: data confirmata difera de cea propusa (%); o alta data = termen manual cu justificare', v_t.data_propusa USING ERRCODE = '22023';
        END IF;
        UPDATE public.executie_revendicare_termene SET data_confirmata = v_data WHERE id = v_t.id RETURNING * INTO v_t;
      ELSE
        IF NOT public.fn_executie_revendicare_drept(v_d.proiect_id, 'administrare') THEN
          RAISE EXCEPTION 'revendicari: termenul manual se confirma la nivelul administrare' USING ERRCODE = '42501';
        END IF;
        IF v_just IS NULL THEN RAISE EXCEPTION 'revendicari: termenul manual cere justificare' USING ERRCODE = '22023'; END IF;
        UPDATE public.executie_revendicare_termene SET data_confirmata = v_data, justificare = v_just WHERE id = v_t.id RETURNING * INTO v_t;
      END IF;
    ELSE   -- indeplinit
      -- runda 2 (P1): predicatul comun cu vederea (L19): actul dosarului, compatibil cu obligația, neanulat, transmis / primit
      v_act := (p_date->>'act_id')::bigint;
      IF v_act IS NULL OR public.fn_executie_revendicare_indeplinire_la(v_t.tip_obligatie, v_d.id, v_act) IS NULL THEN
        RAISE EXCEPTION 'revendicari: termenul se indeplineste doar cu actul compatibil al dosarului, transmis / primit si neanulat' USING ERRCODE = '22023';
      END IF;
      UPDATE public.executie_revendicare_termene SET stare = 'indeplinit', indeplinit_act_id = v_act, stare_motiv = NULL WHERE id = v_t.id RETURNING * INTO v_t;
    END IF;
  END IF;
  PERFORM public.fn_executie_revendicare_cheie_scrie(p_cheie, 'termen_confirma', v_amp, v_d.id, 'executie_revendicare_termene', v_t.id);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'rand', to_jsonb(v_t));
END $f$;

-- 6.10 dovezile: adăugare (p_dovada NULL; tip document / ordin / raport, ținta a proiectului dosarului) / scoatere (motiv)
CREATE FUNCTION public.fn_executie_revendicare_dovada(p_dosar bigint, p_dovada bigint, p_versiune integer, p_date jsonb, p_cheie uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_d public.executie_revendicari; v_v public.executie_revendicare_dovezi; v_amp text; v_rez jsonb;
        v_tip text; v_id bigint; v_tinta jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'revendicari: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_dosar IS NULL OR p_cheie IS NULL OR (p_dovada IS NULL) <> (p_versiune IS NULL) THEN RAISE EXCEPTION 'revendicari: parametri lipsa' USING ERRCODE = '22023'; END IF;
  PERFORM public.fn_executie_revendicare_valideaza(p_date, '{"tip":"text:20","tinta_id":"id","rol":"text:20","descriere":"text:2000","motiv":"text:2000"}'::jsonb);
  PERFORM public.fn_executie_revendicare_cheie_blocheaza(p_cheie);                                   -- (1)
  v_d := public.fn_executie_revendicare_dosar_blocheaza(p_dosar, 'scriere');                         -- (2)
  IF p_dovada IS NOT NULL THEN
    SELECT * INTO v_v FROM public.executie_revendicare_dovezi WHERE id = p_dovada AND dosar_id = v_d.id FOR UPDATE;   -- (3)
    IF NOT FOUND THEN RAISE EXCEPTION 'revendicari: dovada nu exista in dosar' USING ERRCODE = '42501'; END IF;
  END IF;
  v_amp := md5(jsonb_build_array('dovada', p_dosar, p_dovada, p_versiune, p_date)::text);
  v_rez := public.fn_executie_revendicare_cheie_citeste(p_cheie, 'dovada', v_amp);
  IF v_rez IS NOT NULL THEN RETURN v_rez; END IF;
  IF v_d.etapa IN ('inchis', 'retras') THEN RAISE EXCEPTION 'revendicari: dosarul e inchis' USING ERRCODE = '22023'; END IF;
  IF p_dovada IS NULL THEN
    v_tip := public.fn_executie_revendicare_txt(p_date, 'tip'); v_id := (p_date->>'tinta_id')::bigint;
    IF v_tip IS NULL OR v_id IS NULL OR public.fn_executie_revendicare_txt(p_date, 'rol') IS NULL THEN
      RAISE EXCEPTION 'revendicari: tipul, tinta si rolul sunt obligatorii' USING ERRCODE = '22023';
    END IF;
    IF p_date ? 'motiv' THEN RAISE EXCEPTION 'revendicari: motivul e doar pentru scoatere' USING ERRCODE = '22023'; END IF;
    v_tinta := public.fn_executie_revendicare_tinta(v_tip, v_id, v_d.proiect_id);                   -- (4)
    IF EXISTS (SELECT 1 FROM public.executie_revendicare_dovezi x WHERE x.dosar_id = v_d.id AND x.activ
                AND ((v_tip = 'document' AND x.document_id = v_id) OR (v_tip = 'ordin' AND x.ordin_id = v_id) OR (v_tip = 'raport' AND x.raport_id = v_id))) THEN
      RAISE EXCEPTION 'revendicari: tinta e deja dovada in dosar' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.executie_revendicare_dovezi (dosar_id, proiect_id, document_id, ordin_id, raport_id, rol, descriere, tinta_amprenta)
    VALUES (v_d.id, v_d.proiect_id, CASE WHEN v_tip = 'document' THEN v_id END, CASE WHEN v_tip = 'ordin' THEN v_id END,
            CASE WHEN v_tip = 'raport' THEN v_id END, public.fn_executie_revendicare_txt(p_date, 'rol'),
            public.fn_executie_revendicare_txt(p_date, 'descriere'), v_tinta->>'amprenta')
    RETURNING * INTO v_v;
  ELSE
    IF v_v.versiune IS DISTINCT FROM p_versiune THEN RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'rand', to_jsonb(v_v)); END IF;
    IF NOT v_v.activ THEN RAISE EXCEPTION 'revendicari: dovada e deja scoasa' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_date) k WHERE k <> 'motiv') THEN RAISE EXCEPTION 'revendicari: scoaterea primeste doar motivul' USING ERRCODE = '22023'; END IF;
    IF public.fn_executie_revendicare_txt(p_date, 'motiv') IS NULL THEN RAISE EXCEPTION 'revendicari: scoaterea cere motiv' USING ERRCODE = '22023'; END IF;
    UPDATE public.executie_revendicare_dovezi SET activ = false, motiv_scoatere = public.fn_executie_revendicare_txt(p_date, 'motiv')
     WHERE id = v_v.id RETURNING * INTO v_v;
  END IF;
  PERFORM public.fn_executie_revendicare_cheie_scrie(p_cheie, 'dovada', v_amp, v_d.id, 'executie_revendicare_dovezi', v_v.id);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'rand', to_jsonb(v_v));
END $f$;

-- ── 7. vederile (security_invoker: RLS-ul apelantului) ────────────────────────────────────────────────────────────────────────────────────
CREATE VIEW public.v_executie_revendicare_termene WITH (security_invoker = on) AS
SELECT t.*, x.azi, x.intrari_valide, x.indeplinit_la,
       public.fn_executie_revendicare_termen_stare(t.stare, t.mod, x.intrari_valide, t.data_propusa, t.data_confirmata, x.indeplinit_la, x.azi) AS stare_calcul,
       CASE WHEN t.data_confirmata IS NOT NULL THEN t.data_confirmata - x.azi END AS zile_ramase
  FROM public.executie_revendicare_termene t
 CROSS JOIN LATERAL (SELECT public.fn_executie_revendicare_azi() AS azi,
                            public.fn_executie_revendicare_termen_intrari_valide(t.id) AS intrari_valide,
                            public.fn_executie_revendicare_indeplinire_la(t.tip_obligatie, t.dosar_id, t.indeplinit_act_id) AS indeplinit_la) x;
CREATE VIEW public.v_executie_revendicare_acte WITH (security_invoker = on) AS
SELECT a.*, public.fn_executie_revendicare_act_transmis_la(a.id) AS transmis_la, public.fn_executie_revendicare_act_primit_la(a.id) AS primit_la,
       public.fn_executie_revendicare_act_aprobare_valida(a) AS aprobare_valida
  FROM public.executie_revendicare_acte a;

-- ── 8. RLS + privilegii (L07): doar citire pentru aplicație, prin predicatul unic; scrierea DOAR prin RPC-uri ──────────────────────────────
-- Scris STATIC, cu numele fiecărui obiect (regula porților Izometrie: fără ținte dinamice). Postcondițiile §9 verifică exact rezultatul.
ALTER TABLE public.executie_revendicari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_revendicare_repere ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_revendicare_acte ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_revendicare_comunicari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_revendicare_termene ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_revendicare_dovezi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_revendicare_jurnal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_revendicare_alerte ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_revendicare_chei ENABLE ROW LEVEL SECURITY;
-- totul revocat (Supabase dă implicit drepturi depline rolurilor aplicației), apoi DOAR citirea; cheile: nimic pentru nimeni
REVOKE ALL ON TABLE public.executie_revendicari, public.executie_revendicare_repere, public.executie_revendicare_acte,
  public.executie_revendicare_comunicari, public.executie_revendicare_termene, public.executie_revendicare_dovezi, public.executie_revendicare_jurnal,
  public.executie_revendicare_alerte, public.executie_revendicare_chei FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.executie_revendicari, public.executie_revendicare_repere, public.executie_revendicare_acte,
  public.executie_revendicare_comunicari, public.executie_revendicare_termene, public.executie_revendicare_dovezi, public.executie_revendicare_jurnal,
  public.executie_revendicare_alerte TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.executie_revendicari_id_seq, public.executie_revendicare_repere_id_seq, public.executie_revendicare_acte_id_seq,
  public.executie_revendicare_comunicari_id_seq, public.executie_revendicare_termene_id_seq, public.executie_revendicare_dovezi_id_seq,
  public.executie_revendicare_jurnal_id_seq, public.executie_revendicare_alerte_id_seq FROM PUBLIC, anon, authenticated, service_role;
-- citirea: predicatul unic (L19), pe 7 tabele; cheile fără politică (fără drepturi), alertele cu politica lor (mai jos)
CREATE POLICY executie_revendicari_citire ON public.executie_revendicari FOR SELECT TO authenticated
  USING (public.fn_executie_revendicare_drept(proiect_id, 'citire'));
CREATE POLICY executie_revendicare_repere_citire ON public.executie_revendicare_repere FOR SELECT TO authenticated
  USING (public.fn_executie_revendicare_drept(proiect_id, 'citire'));
CREATE POLICY executie_revendicare_acte_citire ON public.executie_revendicare_acte FOR SELECT TO authenticated
  USING (public.fn_executie_revendicare_drept(proiect_id, 'citire'));
CREATE POLICY executie_revendicare_comunicari_citire ON public.executie_revendicare_comunicari FOR SELECT TO authenticated
  USING (public.fn_executie_revendicare_drept(proiect_id, 'citire'));
CREATE POLICY executie_revendicare_termene_citire ON public.executie_revendicare_termene FOR SELECT TO authenticated
  USING (public.fn_executie_revendicare_drept(proiect_id, 'citire'));
CREATE POLICY executie_revendicare_dovezi_citire ON public.executie_revendicare_dovezi FOR SELECT TO authenticated
  USING (public.fn_executie_revendicare_drept(proiect_id, 'citire'));
CREATE POLICY executie_revendicare_jurnal_citire ON public.executie_revendicare_jurnal FOR SELECT TO authenticated
  USING (public.fn_executie_revendicare_drept(proiect_id, 'citire'));
-- alertele: doar destinatarul (cât mai are acces la proiect) sau administrarea proiectului
CREATE POLICY executie_revendicare_alerte_citire ON public.executie_revendicare_alerte FOR SELECT TO authenticated
  USING (public.fn_executie_revendicare_drept(proiect_id, 'citire')
         AND (destinatar = auth.uid() OR public.fn_executie_revendicare_drept(proiect_id, 'administrare')));
REVOKE ALL ON public.v_executie_revendicare_termene, public.v_executie_revendicare_acte FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_executie_revendicare_termene, public.v_executie_revendicare_acte TO authenticated, service_role;
-- funcțiile: totul revocat (Supabase dă implicit EXECUTE la anon / authenticated / service_role), apoi DOAR ce cheamă clientul / RLS / vederile.
-- Lista STATICĂ a celor 43 de funcții (regula porților Izometrie); o funcție omisă de aici păstrează EXECUTE implicit și e refuzată de
-- postcondiția funcțiilor (§9: nimic pentru anon / service_role, authenticated doar pe clasele definer / client).
REVOKE ALL ON FUNCTION
  public.fn_executie_revendicare_zi(timestamptz), public.fn_executie_revendicare_azi(), public.fn_executie_revendicare_nr_canonic(text),
  public.fn_executie_revendicare_termen_stare(text, text, boolean, date, date, date, date),
  public.fn_executie_revendicare_tranzitii(), public.fn_executie_revendicare_act_tranzitii(), public.fn_executie_revendicare_obligatie_acte(),
  public.fn_executie_revendicare_drept(bigint, text),
  public.fn_executie_revendicare_act_amprenta(public.executie_revendicare_acte),
  public.fn_executie_revendicare_act_transmis_la(bigint), public.fn_executie_revendicare_act_primit_la(bigint),
  public.fn_executie_revendicare_indeplinire_la(text, bigint, bigint), public.fn_executie_revendicare_reper_amprenta(bigint),
  public.fn_executie_revendicare_legatura_valida(bigint), public.fn_executie_revendicare_surse_amprenta(bigint),
  public.fn_executie_revendicare_surse_valide(bigint), public.fn_executie_revendicare_act_aprobare_valida(public.executie_revendicare_acte),
  public.fn_executie_revendicare_declansator_data(bigint), public.fn_executie_revendicare_termen_intrari_locale(bigint),
  public.fn_executie_revendicare_termen_lant_valid(bigint), public.fn_executie_revendicare_termen_intrari_valide(bigint),
  public.fn_executie_revendicare_valideaza(jsonb, jsonb), public.fn_executie_revendicare_txt(jsonb, text),
  public.fn_executie_revendicare_cheie_blocheaza(uuid), public.fn_executie_revendicare_rand(text, bigint),
  public.fn_executie_revendicare_cheie_citeste(uuid, text, text), public.fn_executie_revendicare_cheie_scrie(uuid, text, text, bigint, text, bigint),
  public.fn_executie_revendicare_dosar_blocheaza(bigint, text), public.fn_executie_revendicare_tinta(text, bigint, bigint),
  public.fn_executie_revendicare_prov(), public.fn_executie_revendicare_termen_calc(), public.fn_executie_revendicare_jurnal_scrie(),
  public.fn_executie_revendicare_jurnal_imuabil(),
  public.fn_executie_revendicare_salveaza_dosar(bigint, bigint, integer, jsonb, uuid), public.fn_executie_revendicare_etapa(bigint, integer, text, text, uuid),
  public.fn_executie_revendicare_risc(bigint, integer, text, text, uuid), public.fn_executie_revendicare_reper(bigint, text, bigint, integer, jsonb, uuid),
  public.fn_executie_revendicare_act(bigint, bigint, integer, jsonb, uuid), public.fn_executie_revendicare_act_stare(bigint, integer, text, jsonb, uuid),
  public.fn_executie_revendicare_comunicare(bigint, bigint, integer, jsonb, uuid), public.fn_executie_revendicare_termen(bigint, bigint, integer, jsonb, uuid),
  public.fn_executie_revendicare_termen_confirma(bigint, integer, text, jsonb, uuid), public.fn_executie_revendicare_dovada(bigint, bigint, integer, jsonb, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
-- DEFINER, chemate de client / de RLS
GRANT EXECUTE ON FUNCTION public.fn_executie_revendicare_drept(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_revendicare_salveaza_dosar(bigint, bigint, integer, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_revendicare_etapa(bigint, integer, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_revendicare_risc(bigint, integer, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_revendicare_reper(bigint, text, bigint, integer, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_revendicare_act(bigint, bigint, integer, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_revendicare_act_stare(bigint, integer, text, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_revendicare_comunicare(bigint, bigint, integer, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_revendicare_termen(bigint, bigint, integer, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_revendicare_termen_confirma(bigint, integer, text, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_revendicare_dovada(bigint, bigint, integer, jsonb, uuid) TO authenticated;
-- INVOKER, chemate de vederi / UI (citesc doar sub RLS-ul apelantului sau nu citesc nimic)
GRANT EXECUTE ON FUNCTION public.fn_executie_revendicare_zi(timestamptz), public.fn_executie_revendicare_azi(),
  public.fn_executie_revendicare_nr_canonic(text),
  public.fn_executie_revendicare_termen_stare(text, text, boolean, date, date, date, date),
  public.fn_executie_revendicare_tranzitii(), public.fn_executie_revendicare_act_tranzitii(),
  public.fn_executie_revendicare_act_amprenta(public.executie_revendicare_acte),
  public.fn_executie_revendicare_act_transmis_la(bigint), public.fn_executie_revendicare_act_primit_la(bigint),
  public.fn_executie_revendicare_reper_amprenta(bigint), public.fn_executie_revendicare_legatura_valida(bigint),
  public.fn_executie_revendicare_declansator_data(bigint), public.fn_executie_revendicare_termen_intrari_valide(bigint),
  public.fn_executie_revendicare_obligatie_acte(), public.fn_executie_revendicare_indeplinire_la(text, bigint, bigint),
  public.fn_executie_revendicare_surse_amprenta(bigint), public.fn_executie_revendicare_surse_valide(bigint),
  public.fn_executie_revendicare_act_aprobare_valida(public.executie_revendicare_acte),
  public.fn_executie_revendicare_termen_intrari_locale(bigint), public.fn_executie_revendicare_termen_lant_valid(bigint) TO authenticated;

-- ── 9. postcondiții (runda 2, L15: pe DEFINIȚIA EXACTĂ a fiecărui obiect, nu pe potrivire de text sau pe numărătoare) ────────────────────
-- Politici: expresia normalizată din catalog (search_path-ul fixat în preflight) comparată exact; o politică „predicat OR true” nu trece.
-- Funcții: semnătura, rezultatul, limbajul, volatilitatea, clasa (DEFINER / client / internă) și amprenta md5 a corpului (fără CR), pe
--   lista EXACTĂ (FULL JOIN: nimic în plus, nimic lipsă). Amprentele = corpurile din acest fișier; proba PGlite le recalculează din text.
-- Trigger-e: tabel, nume, funcție, eveniment / moment / nivel (tgtype), fără condiție, fără argumente, fără coloane, neamânabile, active.
-- Chei străine spre ALT tabel: fiecare cu index complet (nu parțial) care începe cu coloana ei.
DO $post$
DECLARE
  v_tab constant text[] := ARRAY['executie_revendicari', 'executie_revendicare_repere', 'executie_revendicare_acte', 'executie_revendicare_comunicari',
                                 'executie_revendicare_termene', 'executie_revendicare_dovezi', 'executie_revendicare_jurnal', 'executie_revendicare_alerte',
                                 'executie_revendicare_chei'];
  t text; v_rel oid; v_lista text;
BEGIN
  -- exact 9 tabele + 2 vederi noi, fără alte obiecte cu prefixul
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname ~ '^executie_revendicar') <> 9
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname ~ '^v_executie_revendicar') <> 2 THEN
    RAISE EXCEPTION '20261224a post: numarul de tabele / vederi';
  END IF;
  FOREACH t IN ARRAY v_tab LOOP
    v_rel := ('public.' || t)::regclass;
    IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) IS NOT TRUE THEN RAISE EXCEPTION '20261224a post: RLS pe %', t; END IF;
    -- zero drepturi de scriere pentru rolurile aplicației; SELECT doar authenticated / service_role (cheile: nimic); nimic pe coloane
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
                WHERE has_table_privilege(r, v_rel, p))
       OR has_table_privilege('anon', v_rel, 'SELECT')
       OR has_table_privilege('authenticated', v_rel, 'SELECT') IS DISTINCT FROM (t <> 'executie_revendicare_chei')
       OR has_table_privilege('service_role', v_rel, 'SELECT') IS DISTINCT FROM (t <> 'executie_revendicare_chei')
       OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND attacl IS NOT NULL) THEN
      RAISE EXCEPTION '20261224a post: privilegii pe %', t;
    END IF;
    IF t <> 'executie_revendicare_chei' AND EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) p
                                                     WHERE has_sequence_privilege(r, pg_get_serial_sequence('public.' || t, 'id'), p)) THEN
      RAISE EXCEPTION '20261224a post: secventa lui %', t;
    END IF;
  END LOOP;
  -- politicile: EXACT setul așteptat; cheile: niciuna (lipsesc din listă, deci orice politică pe ele = în plus)
  SELECT string_agg(coalesce(a.tabel, p.tablename) || '.' || coalesce(a.nume, p.policyname), ', ' ORDER BY coalesce(a.tabel, p.tablename)) INTO v_lista
    FROM (VALUES
      ('executie_revendicari', 'executie_revendicari_citire', 'fn_executie_revendicare_drept(proiect_id, ''citire''::text)'),
      ('executie_revendicare_repere', 'executie_revendicare_repere_citire', 'fn_executie_revendicare_drept(proiect_id, ''citire''::text)'),
      ('executie_revendicare_acte', 'executie_revendicare_acte_citire', 'fn_executie_revendicare_drept(proiect_id, ''citire''::text)'),
      ('executie_revendicare_comunicari', 'executie_revendicare_comunicari_citire', 'fn_executie_revendicare_drept(proiect_id, ''citire''::text)'),
      ('executie_revendicare_termene', 'executie_revendicare_termene_citire', 'fn_executie_revendicare_drept(proiect_id, ''citire''::text)'),
      ('executie_revendicare_dovezi', 'executie_revendicare_dovezi_citire', 'fn_executie_revendicare_drept(proiect_id, ''citire''::text)'),
      ('executie_revendicare_jurnal', 'executie_revendicare_jurnal_citire', 'fn_executie_revendicare_drept(proiect_id, ''citire''::text)'),
      ('executie_revendicare_alerte', 'executie_revendicare_alerte_citire',
       '(fn_executie_revendicare_drept(proiect_id, ''citire''::text) AND ((destinatar = auth.uid()) OR fn_executie_revendicare_drept(proiect_id, ''administrare''::text)))')
    ) a(tabel, nume, qual)
    FULL JOIN (SELECT * FROM pg_policies WHERE schemaname = 'public' AND tablename ~ '^executie_revendicar') p ON p.tablename = a.tabel AND p.policyname = a.nume
   WHERE a.tabel IS NULL OR p.tablename IS NULL OR p.cmd IS DISTINCT FROM 'SELECT' OR p.roles IS DISTINCT FROM '{authenticated}'::name[]
      OR p.permissive IS DISTINCT FROM 'PERMISSIVE' OR p.qual IS DISTINCT FROM a.qual OR p.with_check IS NOT NULL;
  IF v_lista IS NOT NULL THEN RAISE EXCEPTION '20261224a post: politicile (definitia exacta): %', v_lista; END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['public.v_executie_revendicare_termene', 'public.v_executie_revendicare_acte']) v
              WHERE NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = v::regclass AND c.reloptions @> ARRAY['security_invoker=on'])
                 OR has_table_privilege('anon', v::regclass, 'SELECT')
                 OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) p
                             WHERE has_table_privilege(r, v::regclass, p))) THEN
    RAISE EXCEPTION '20261224a post: vederile (security_invoker / privilegii)';
  END IF;
  -- „decăzut” nu se scrie automat: valoarea apare DOAR în RPC-ul riscului (și în CHECK-ul coloanei)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.prosrc LIKE '%decadere\_constatata%' AND p.proname <> 'fn_executie_revendicare_risc') THEN
    RAISE EXCEPTION '20261224a post: alta functie scrie decaderea';
  END IF;
  -- funcțiile: lista EXACTĂ, cu definiția (clasa: definer = SECURITY DEFINER + EXECUTE authenticated; client = INVOKER + EXECUTE
  -- authenticated; intern = INVOKER, fără EXECUTE pentru clienți); search_path fix; proprietarul = cel care aplică; nimic pentru anon /
  -- service_role
  SELECT string_agg(coalesce(a.semnatura, p.sem), ', ' ORDER BY coalesce(a.semnatura, p.sem)) INTO v_lista
    FROM (VALUES
      ('fn_executie_revendicare_zi(timestamp with time zone)', 'date', 'sql', 's', 'client', 'fabee26f16ccb0b2d9cbda3cc8b600c4'),
      ('fn_executie_revendicare_azi()', 'date', 'sql', 's', 'client', '1460a20a194179c79d6230166519c441'),
      ('fn_executie_revendicare_nr_canonic(text)', 'text', 'sql', 'i', 'client', '366c4d9b48d8a8c993c90f47c961bd6a'),
      ('fn_executie_revendicare_termen_stare(text,text,boolean,date,date,date,date)', 'text', 'plpgsql', 'i', 'client', '33b6da18dc61655ef1a231d8110269c0'),
      ('fn_executie_revendicare_tranzitii()', 'TABLE(din text, spre text, nivel text, cere_tip text, cere_sens text, cere_motiv boolean)', 'sql', 'i', 'client', '883e05c3ca72dd2bc9bdb6fe4f13780c'),
      ('fn_executie_revendicare_act_tranzitii()', 'TABLE(sens text, din text, spre text, nivel text, cere_motiv boolean)', 'sql', 'i', 'client', '73851e76f18ac7806992f678f7d1f461'),
      ('fn_executie_revendicare_obligatie_acte()', 'TABLE(tip_obligatie text, tip_act text, sens text)', 'sql', 'i', 'client', 'db5019980da93ab4147825941ebcaee5'),
      ('fn_executie_revendicare_drept(bigint,text)', 'boolean', 'sql', 's', 'definer', 'cad86a78d103866d6996b243abe8f4fb'),
      ('fn_executie_revendicare_act_amprenta(executie_revendicare_acte)', 'text', 'sql', 's', 'client', 'f2ae02bac1fa20dc25503e3bb294bb64'),
      ('fn_executie_revendicare_act_transmis_la(bigint)', 'date', 'sql', 's', 'client', 'd14a645deb56e1f7b007546cfc0b7294'),
      ('fn_executie_revendicare_act_primit_la(bigint)', 'date', 'sql', 's', 'client', '993bdba27d2993d57f02ec4a94cbf708'),
      ('fn_executie_revendicare_indeplinire_la(text,bigint,bigint)', 'date', 'sql', 's', 'client', '7455751a07e108fea5ccc13bd87162d2'),
      ('fn_executie_revendicare_reper_amprenta(bigint)', 'text', 'sql', 's', 'client', 'ffa268ef15479da60b4d5bcb46b37ca0'),
      ('fn_executie_revendicare_legatura_valida(bigint)', 'boolean', 'sql', 's', 'client', '7549aef9283210b225a7bb9a0f260937'),
      ('fn_executie_revendicare_surse_amprenta(bigint)', 'text', 'sql', 's', 'client', 'de060c21f1810c7d068839f55f427c8e'),
      ('fn_executie_revendicare_surse_valide(bigint)', 'boolean', 'sql', 's', 'client', '3d28dc082ba843eb8a743df38c7948f9'),
      ('fn_executie_revendicare_act_aprobare_valida(executie_revendicare_acte)', 'boolean', 'sql', 's', 'client', 'fce796efea33637f00e709c62a386ae7'),
      ('fn_executie_revendicare_declansator_data(bigint)', 'date', 'sql', 's', 'client', '457945b0a7b3474cb2006c9cd1361eb0'),
      ('fn_executie_revendicare_termen_intrari_locale(bigint)', 'boolean', 'sql', 's', 'client', '7ffad7c2b95bfefb4b29e8c86f5cec7f'),
      ('fn_executie_revendicare_termen_lant_valid(bigint)', 'boolean', 'sql', 's', 'client', 'f71091bc629e03e9bd9a6de4a43193d2'),
      ('fn_executie_revendicare_termen_intrari_valide(bigint)', 'boolean', 'sql', 's', 'client', '627489516892c1facefb6eebffaab96b'),
      ('fn_executie_revendicare_valideaza(jsonb,jsonb)', 'void', 'plpgsql', 's', 'intern', '1e3be5c18cbd20a5f708e0dddd3ad40a'),
      ('fn_executie_revendicare_txt(jsonb,text)', 'text', 'sql', 'i', 'intern', 'b091c3c84fc7f10e97237da95b6eead5'),
      ('fn_executie_revendicare_cheie_blocheaza(uuid)', 'void', 'sql', 'v', 'intern', '3ba36428893ebd0cbdbb02311978adca'),
      ('fn_executie_revendicare_rand(text,bigint)', 'jsonb', 'sql', 's', 'intern', '96f2b51c9335eeb8a919ca2519a342ac'),
      ('fn_executie_revendicare_cheie_citeste(uuid,text,text)', 'jsonb', 'plpgsql', 's', 'intern', '11f57deb3b5bc88cb73cfd5ae3a41ad5'),
      ('fn_executie_revendicare_cheie_scrie(uuid,text,text,bigint,text,bigint)', 'void', 'sql', 'v', 'intern', '5bae70caa26b1f80d616385747f91fdd'),
      ('fn_executie_revendicare_dosar_blocheaza(bigint,text)', 'executie_revendicari', 'plpgsql', 'v', 'intern', '246c4feb9b37e8a6485c0183cfbf01fe'),
      ('fn_executie_revendicare_tinta(text,bigint,bigint)', 'jsonb', 'plpgsql', 'v', 'intern', '28df543d00b191cfd2b9844356b9facc'),
      ('fn_executie_revendicare_prov()', 'trigger', 'plpgsql', 'v', 'intern', '56be2ba108821abede0f7bb15c2b8502'),
      ('fn_executie_revendicare_termen_calc()', 'trigger', 'plpgsql', 'v', 'intern', 'fa70cb3af7f2f8b2dc68ec496f90e429'),
      ('fn_executie_revendicare_jurnal_scrie()', 'trigger', 'plpgsql', 'v', 'intern', '9f0491fc3a1675796ce1a95e01d5c0e5'),
      ('fn_executie_revendicare_jurnal_imuabil()', 'trigger', 'plpgsql', 'v', 'intern', '69bf91f3de76b1992a35130a3fe631a2'),
      ('fn_executie_revendicare_salveaza_dosar(bigint,bigint,integer,jsonb,uuid)', 'jsonb', 'plpgsql', 'v', 'definer', 'c9c5c39339d1447404b744dd42193b2e'),
      ('fn_executie_revendicare_etapa(bigint,integer,text,text,uuid)', 'jsonb', 'plpgsql', 'v', 'definer', '9beb15876cd09e2547a73df547fa772a'),
      ('fn_executie_revendicare_risc(bigint,integer,text,text,uuid)', 'jsonb', 'plpgsql', 'v', 'definer', 'ebe3995c3f1f383d7d6db826acc0b9e1'),
      ('fn_executie_revendicare_reper(bigint,text,bigint,integer,jsonb,uuid)', 'jsonb', 'plpgsql', 'v', 'definer', 'fab8c10c02cfa0357244be4f9f6e45f9'),
      ('fn_executie_revendicare_act(bigint,bigint,integer,jsonb,uuid)', 'jsonb', 'plpgsql', 'v', 'definer', '4612b1c84dec099dcc3241738bea09fe'),
      ('fn_executie_revendicare_act_stare(bigint,integer,text,jsonb,uuid)', 'jsonb', 'plpgsql', 'v', 'definer', '70281889352c40e96fcd8ffbb1cefdce'),
      ('fn_executie_revendicare_comunicare(bigint,bigint,integer,jsonb,uuid)', 'jsonb', 'plpgsql', 'v', 'definer', '323634276ef6cf00c3f893cbe10081a8'),
      ('fn_executie_revendicare_termen(bigint,bigint,integer,jsonb,uuid)', 'jsonb', 'plpgsql', 'v', 'definer', 'a7432d2bb3240a06b6fbbf3dd0514d56'),
      ('fn_executie_revendicare_termen_confirma(bigint,integer,text,jsonb,uuid)', 'jsonb', 'plpgsql', 'v', 'definer', '63511c2dc5c944c07dabf92b72bd27b8'),
      ('fn_executie_revendicare_dovada(bigint,bigint,integer,jsonb,uuid)', 'jsonb', 'plpgsql', 'v', 'definer', 'e847d569e1a972b3a137fccb9c8b58f6')
    ) a(semnatura, rezultat, limbaj, vol, clasa, corp_md5)
    FULL JOIN (SELECT p.oid, p.oid::regprocedure::text AS sem, pg_get_function_result(p.oid) AS rez, l.lanname, p.provolatile::text AS vol,
                      p.prosecdef, p.proconfig, p.proowner, md5(replace(p.prosrc, chr(13), '')) AS corp_md5
                 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
                WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_revendicare\_%') p ON p.sem = a.semnatura
   WHERE a.semnatura IS NULL OR p.sem IS NULL OR p.rez IS DISTINCT FROM a.rezultat OR p.lanname IS DISTINCT FROM a.limbaj
      OR p.vol IS DISTINCT FROM a.vol OR p.corp_md5 IS DISTINCT FROM a.corp_md5
      OR p.prosecdef IS DISTINCT FROM (a.clasa = 'definer') OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR p.proowner IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname = current_user)
      OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM (a.clasa IN ('definer', 'client'));
  IF v_lista IS NOT NULL THEN RAISE EXCEPTION '20261224a post: functii (definitia exacta / drepturi): %', v_lista; END IF;
  -- trigger-ele: EXACT setul (pe tabelele noi ȘI oriunde e folosită o funcție a migrării). tgtype: 1 rând, 2 BEFORE, 4 INSERT, 8 DELETE,
  -- 16 UPDATE, 32 TRUNCATE -> 23 = BEFORE INSERT OR UPDATE pe rând; 29 = AFTER INSERT OR UPDATE OR DELETE pe rând; 27 = BEFORE UPDATE OR
  -- DELETE pe rând; 34 = BEFORE TRUNCATE pe instrucțiune
  SELECT string_agg(coalesce(a.tabel || '.' || a.nume, x.relname || '.' || x.tgname), ', ' ORDER BY coalesce(a.tabel, x.relname)) INTO v_lista
    FROM (VALUES
      ('executie_revendicari', 'trg_a_executie_revendicare_prov', 'fn_executie_revendicare_prov()', 23),
      ('executie_revendicari', 'trg_z_executie_revendicare_jurnal', 'fn_executie_revendicare_jurnal_scrie()', 29),
      ('executie_revendicare_repere', 'trg_a_executie_revendicare_prov', 'fn_executie_revendicare_prov()', 23),
      ('executie_revendicare_repere', 'trg_z_executie_revendicare_jurnal', 'fn_executie_revendicare_jurnal_scrie()', 29),
      ('executie_revendicare_acte', 'trg_a_executie_revendicare_prov', 'fn_executie_revendicare_prov()', 23),
      ('executie_revendicare_acte', 'trg_z_executie_revendicare_jurnal', 'fn_executie_revendicare_jurnal_scrie()', 29),
      ('executie_revendicare_comunicari', 'trg_a_executie_revendicare_prov', 'fn_executie_revendicare_prov()', 23),
      ('executie_revendicare_comunicari', 'trg_z_executie_revendicare_jurnal', 'fn_executie_revendicare_jurnal_scrie()', 29),
      ('executie_revendicare_termene', 'trg_a_executie_revendicare_prov', 'fn_executie_revendicare_prov()', 23),
      ('executie_revendicare_termene', 'trg_b_executie_revendicare_termen_calc', 'fn_executie_revendicare_termen_calc()', 23),
      ('executie_revendicare_termene', 'trg_z_executie_revendicare_jurnal', 'fn_executie_revendicare_jurnal_scrie()', 29),
      ('executie_revendicare_dovezi', 'trg_a_executie_revendicare_prov', 'fn_executie_revendicare_prov()', 23),
      ('executie_revendicare_dovezi', 'trg_z_executie_revendicare_jurnal', 'fn_executie_revendicare_jurnal_scrie()', 29),
      ('executie_revendicare_jurnal', 'trg_executie_revendicare_jurnal_imuabil', 'fn_executie_revendicare_jurnal_imuabil()', 27),
      ('executie_revendicare_jurnal', 'trg_executie_revendicare_jurnal_fara_truncate', 'fn_executie_revendicare_jurnal_imuabil()', 34)
    ) a(tabel, nume, functie, tip)
    FULL JOIN (SELECT c.relname, g.tgname, g.tgfoid, g.tgtype, g.tgenabled, g.tgqual, g.tgnargs, g.tgdeferrable, g.tginitdeferred, g.tgattr, g.tgconstraint
                 FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE NOT g.tgisinternal
                  AND ((n.nspname = 'public' AND c.relname ~ '^executie_revendicar')
                       OR g.tgfoid IN (SELECT p.oid FROM pg_proc p WHERE p.proname LIKE 'fn\_executie\_revendicare\_%'))) x
      ON x.relname = a.tabel AND x.tgname = a.nume
   WHERE a.tabel IS NULL OR x.relname IS NULL OR x.tgfoid::regprocedure::text IS DISTINCT FROM a.functie OR x.tgtype IS DISTINCT FROM a.tip::int2
      OR x.tgenabled IS DISTINCT FROM 'O' OR x.tgqual IS NOT NULL OR x.tgnargs <> 0 OR x.tgdeferrable OR x.tginitdeferred
      OR cardinality(x.tgattr::int2[]) <> 0 OR x.tgconstraint <> 0;
  IF v_lista IS NOT NULL THEN RAISE EXCEPTION '20261224a post: trigger-e (definitia exacta): %', v_lista; END IF;
  -- cheile străine spre ALT tabel: fiecare cu index complet care începe cu coloana ei (verificarea la ștergerea sursei nu scanează)
  SELECT string_agg(k.conrelid::regclass::text || '.' || a.attname, ', ' ORDER BY 1) INTO v_lista
    FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
   WHERE k.contype = 'f' AND k.conrelid IN (SELECT ('public.' || x)::regclass::oid FROM unnest(v_tab) x)
     AND k.confrelid NOT IN (SELECT ('public.' || x)::regclass::oid FROM unnest(v_tab) x)
     AND (cardinality(k.conkey) <> 1
          OR NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = k.conrelid AND i.indkey[0] = k.conkey[1] AND i.indpred IS NULL AND i.indisvalid));
  IF v_lista IS NOT NULL THEN RAISE EXCEPTION '20261224a post: chei straine fara index: %', v_lista; END IF;
  -- CHECK-urile stărilor = listele (L20)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executie_revendicari_etapa' AND conrelid = 'public.executie_revendicari'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executie_revendicare_acte_stare' AND conrelid = 'public.executie_revendicare_acte'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executie_revendicare_termene_obligatie' AND conrelid = 'public.executie_revendicare_termene'::regclass) THEN
    RAISE EXCEPTION '20261224a post: CHECK-urile starilor';
  END IF;
  -- nicio dată
  IF EXISTS (SELECT 1 FROM public.executie_revendicari) OR EXISTS (SELECT 1 FROM public.executie_revendicare_jurnal)
     OR EXISTS (SELECT 1 FROM public.executie_revendicare_chei) THEN
    RAISE EXCEPTION '20261224a post: migrarea nu scrie date';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261224a_executie_revendicari:' || txid_current() THEN
    RAISE EXCEPTION '20261224a: garda final invalida';
  END IF;
  RAISE NOTICE '20261224a: sfarsit la % ms de la BEGIN; lock-uri puternice tinute de % ms (pana la COMMIT se adauga pasul dupa al runnerului si garda: LOCK_TINUT)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;
