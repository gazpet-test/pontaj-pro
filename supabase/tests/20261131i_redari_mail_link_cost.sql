-- Proba de COST a migrării 20261131i (Redări e-mail, linkul personal — runda 4, Jakarinos #1138 r3 P2): RPC-ul COMPLET fn_red_mail_lot_creeaza pe un lot
--   mare (implicit 300 de destinatari × 19.000 de caractere), cu un volum parametrizabil de tokenuri existente, ca apelantul real (rolul authenticated, JWT-ul
--   owner-ului, statement_timeout-ul lui PostgREST), și cât timp ține lock-urile: rândul global red_mail_setari și rândul de numerotare `M` din red_numere.
-- DOAR PE CLONĂ (PostgreSQL 17, 20261131h + 20261131i aplicate). NU pe producție: totul rulează într-O tranzacție terminată cu ROLLBACK (nimic nu rămâne),
--   dar cât rulează ține lock-urile reale (setări, numerotare) și două triggere de măsurare pe red_mail_loturi / red_mail_mesaje (DDL în aceeași tranzacție,
--   anulat la ROLLBACK). Fără date reale: proiectul, UAT-ul, deținătorii, e-mailurile și tokenurile sunt SINTETICE (cod TEST-COST-20261131I, @gazpet.ro);
--   singura citire a datelor clonei = id-ul unui profil owner (apelantul RPC-ului) și tokenurile existente (volumul real se adaugă la cele sintetice).
-- Rulare (clona; parametrii au valori implicite):
--   psql -X -v ON_ERROR_STOP=1 -v clona=da [-v destinatari=300] [-v caractere=19000] [-v tokenuri=20000] [-v timeout=8s] [-v prag_ms=2000] \
--        -f supabase/tests/20261131i_redari_mail_link_cost.sql
--   Rezultatul = un NOTICE „COST 20261131i: …”: rpc_ms = RPC-ul complet; lock_setari_rpc_ms = de la INSERT-ul lotului — imediat după lock-ul global — până
--   la sfârșitul RPC-ului; r5: lock_setari_tranzactie_ms / lock_numerotare_tranzactie_ms = de la INSERT-ul lotului / de la primul mesaj (imediat după prima
--   numerotare M) până la ULTIMA instrucțiune înaintea ROLLBACK-ului (RPC + verificarea mesajelor: lock-urile țin până la sfârșitul tranzacției; nemăsurat
--   rămâne doar drumul NOTICE-ului și al ROLLBACK-ului); verdict = OK doar dacă rpc_ms și ambele durate „tranzactie” sunt ≤ prag_ms, altfel DEPASIT
--   (GRESIT = mesaje lipsă / fără linkul lor). Statement_timeout-ul apelantului (timeout) se aplică RPC-ului: depășirea lui = eroare 57014 (RPC-ul nu ar
--   trece prin PostgREST).
--   Blocarea văzută de O ALTĂ sesiune (setări / numerotare): supabase/tests/20261131i_redari_mail_link_cost_concurenta.sh (rulează scriptul ăsta în sesiunea A).
-- Același corp (între marcajele COST-CORP) îl rulează proba PGlite (scripts/pglite/test_redari_mail_link_local.mjs, secțiunea 7: înainte / după, mutanți).
-- Textul sintetic: un antet cu toate câmpurile ({COMUNA}, {ZILE}, {PROGRAM}, {TEL}, {LINK_RASPUNS}), un „100%” și un URL străin codificat (trebuie să treacă),
--   apoi cuvinte pseudo-aleatoare (hex) despărțite de spații până la `caractere`: după scoaterea spațiilor = UN singur șir base64url cât tot textul, cu
--   ferestre de 43 de caractere toate diferite (cazul cel mai rău pentru căutarea tokenurilor).
\set ON_ERROR_STOP 1
\if :{?clona}
\else
  \set clona nu
\endif
\if :{?destinatari}
\else
  \set destinatari 300
\endif
\if :{?caractere}
\else
  \set caractere 19000
\endif
\if :{?tokenuri}
\else
  \set tokenuri 20000
\endif
\if :{?timeout}
\else
  \set timeout 8s
\endif
\if :{?prag_ms}
\else
  \set prag_ms 2000
\endif
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('cost.clona', :'clona', true), set_config('cost.destinatari', :'destinatari', true), set_config('cost.caractere', :'caractere', true),
       set_config('cost.tokenuri', :'tokenuri', true), set_config('cost.timeout', :'timeout', true), set_config('cost.prag_ms', :'prag_ms', true);
-- >>> COST-CORP 20261131i
DO $garda$
BEGIN
  IF current_setting('cost.clona', true) IS DISTINCT FROM 'da' THEN
    RAISE EXCEPTION 'COST 20261131i: doar pe clona (-v clona=da); nimic schimbat';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'COST 20261131i: ruleaza ca postgres (fixture-ul + triggerele de masurare)'; END IF;
  IF to_regprocedure('public.fn_red_mail_f2_link_strain(text,text)') IS NULL THEN RAISE EXCEPTION 'COST 20261131i: 20261131i nu e aplicata'; END IF;
  IF current_setting('cost.destinatari')::int NOT BETWEEN 1 AND 300 OR current_setting('cost.caractere')::int NOT BETWEEN 300 AND 19000
     OR current_setting('cost.tokenuri')::int NOT BETWEEN 0 AND 1000000 THEN
    RAISE EXCEPTION 'COST 20261131i: parametri in afara limitelor (destinatari 1..300, caractere 300..19000, tokenuri 0..1000000)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_proiecte WHERE cod = 'TEST-COST-20261131I') THEN RAISE EXCEPTION 'COST 20261131i: proiectul sintetic exista deja'; END IF;
END $garda$;

-- ── fixture SINTETIC: proiect de TEST, un UAT cu sesiune, `destinatari` deținători cu e-mail + token valid, `tokenuri` deținători doar cu token ──
DO $fixture$
DECLARE v_pr uuid := '0c057000-0000-4000-8000-000000000001'; v_uat uuid := '0c057000-0000-4000-8000-000000000002';
        v_par uuid := '0c057000-0000-4000-8000-000000000003'; v_par2 uuid := '0c057000-0000-4000-8000-000000000004';
        n_dst int := current_setting('cost.destinatari')::int; n_tok int := current_setting('cost.tokenuri')::int; n_car int := current_setting('cost.caractere')::int;
        v_antet text; v_umplutura text; v_text text;
BEGIN
  INSERT INTO public.red_proiecte (id, cod, denumire, contact_telefon) VALUES (v_pr, 'TEST-COST-20261131I', 'Proba de cost (sintetic)', '0700 000 000');
  INSERT INTO public.red_uat (id, proiect_id, nume, uat3, sesiune_zi1, sesiune_zi2, program_zi1, program_zi2)
    VALUES (v_uat, v_pr, 'Comuna Sintetica', 'CST', current_date + 7, current_date + 8, '09:00–16:00', '09:00–16:00');
  -- id_parcela = {uat3}-{nnnn} (triggerul de pe red_parcele, 20261129g)
  INSERT INTO public.red_parcele (id, proiect_id, uat_id, id_parcela) VALUES (v_par, v_pr, v_uat, 'CST-0001'), (v_par2, v_pr, v_uat, 'CST-0002');
  -- id-urile: 0c057001-… = destinatarii (cu e-mail), 0c057002-… = ceilalți deținători (doar token); tokenurile = sha256 sintetic în base64url (43)
  INSERT INTO public.red_detinatori (id, parcela_id, nume, nume_normalizat, calitate)
    SELECT ('0c057001-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid, v_par, 'DESTINATAR SINTETIC ' || i, 'DESTINATAR SINTETIC ' || i, 'proprietar' FROM generate_series(1, n_dst) i;
  INSERT INTO public.red_detinatori (id, parcela_id, nume, nume_normalizat, calitate)
    SELECT ('0c057002-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid, v_par2, 'DETINATOR SINTETIC ' || i, 'DETINATOR SINTETIC ' || i, 'proprietar' FROM generate_series(1, n_tok) i;
  INSERT INTO public.red_detinatori_contact (detinator_id, email)
    SELECT ('0c057001-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid, 'cost' || i || '@gazpet.ro' FROM generate_series(1, n_dst) i;
  INSERT INTO public.red_detinatori_token (detinator_id, token_raspuns, token_expira_la)
    SELECT ('0c057001-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
           rtrim(translate(encode(sha256(convert_to('cost20261131i-d-' || i, 'UTF8')), 'base64'), '+/', '-_'), '='), now() + interval '30 days'
      FROM generate_series(1, n_dst) i
    ON CONFLICT (detinator_id) DO NOTHING;  -- triggerul trg_red_detinatori_token creeaza deja tokenul (baza reala)
  INSERT INTO public.red_detinatori_token (detinator_id, token_raspuns, token_expira_la)
    SELECT ('0c057002-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
           rtrim(translate(encode(sha256(convert_to('cost20261131i-t-' || i, 'UTF8')), 'base64'), '+/', '-_'), '='), now() + interval '30 days'
      FROM generate_series(1, n_tok) i
    ON CONFLICT (detinator_id) DO NOTHING;
  v_antet := E'Bună ziua,\n\nLucrările din {COMUNA} s-au încheiat. Vă invităm în zilele {ZILE}, între orele {PROGRAM}; telefon {TEL}.\n'
          || E'Formularul dumneavoastră de răspuns: {LINK_RASPUNS}\nPlanul (100% finalizat): https://exemplu.invalid/docs/Plan%20lucrari.pdf?v=1%2C2\n\n';
  SELECT string_agg(substr(md5('cost20261131i-u-' || i), 1, 7), ' ' ORDER BY i) INTO v_umplutura FROM generate_series(1, n_car / 8 + 2) i;
  v_text := v_antet || left(v_umplutura, n_car - length(v_antet) - 1) || '.';
  PERFORM set_config('cost.proiect', v_pr::text, true), set_config('cost.uat', v_uat::text, true),
          set_config('cost.text', v_text, true), set_config('cost.subiect', 'Predarea terenului – {COMUNA}, {ZILE}', true),
          set_config('cost.dst', (SELECT array_agg(('0c057001-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid ORDER BY i)::text FROM generate_series(1, n_dst) i), true),
          set_config('cost.op', '0c057000-0000-4000-8000-0000000000ff', true),
          set_config('cost.owner', (SELECT p.id::text FROM public.profiles p WHERE p.is_owner ORDER BY p.id LIMIT 1), true),
          set_config('cost.lot_la', '', true), set_config('cost.mesaj_la', '', true);
  IF length(v_text) <> n_car OR current_setting('cost.owner') = '' THEN RAISE EXCEPTION 'COST 20261131i: fixture invalid (text % caractere, owner %)', length(v_text), current_setting('cost.owner'); END IF;
END $fixture$;

-- ── măsurarea lock-urilor: marcaje de timp (µs) la INSERT-ul lotului (imediat după lock-ul global red_mail_setari) și la PRIMUL mesaj (imediat după
--    prima numerotare M); funcții temporare, triggere anulate la ROLLBACK ──
CREATE FUNCTION pg_temp.cost_marcaj_lot() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN PERFORM set_config('cost.lot_la', (extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true); RETURN NEW; END $f$;
CREATE FUNCTION pg_temp.cost_marcaj_mesaj() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF coalesce(current_setting('cost.mesaj_la', true), '') = '' THEN PERFORM set_config('cost.mesaj_la', (extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true); END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER cost_20261131i_lot BEFORE INSERT ON public.red_mail_loturi FOR EACH ROW EXECUTE FUNCTION pg_temp.cost_marcaj_lot();
CREATE TRIGGER cost_20261131i_mesaj BEFORE INSERT ON public.red_mail_mesaje FOR EACH ROW EXECUTE FUNCTION pg_temp.cost_marcaj_mesaj();

-- ── apelul, ca PostgREST: rolul authenticated, JWT-ul owner-ului, statement_timeout-ul apelantului ──
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('cost.owner'), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('cost.owner'), true), set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('statement_timeout', current_setting('cost.timeout'), true);
SELECT set_config('cost.t0', (extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
SELECT public.fn_red_mail_lot_creeaza(current_setting('cost.op')::uuid, current_setting('cost.proiect')::uuid, current_setting('cost.uat')::uuid,
         current_setting('cost.dst')::uuid[], current_setting('cost.subiect'), current_setting('cost.text')) AS lot;
SELECT set_config('cost.t1', (extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
RESET ROLE;
SELECT set_config('statement_timeout', '0', true);

-- ── verificarea (fiecare mesaj are linkul LUI, numărul de mesaje = destinatari) — încă sub lock-urile RPC-ului (aceeași tranzacție) ──
DO $verificare$
DECLARE n int; n_bun int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE position(public.fn_red_link_raspuns(t.token_raspuns) IN m.corp_text_final) > 0 AND m.corp_text_final !~ '[{}]')
    INTO n, n_bun
    FROM public.red_mail_mesaje m JOIN public.red_detinatori_token t ON t.detinator_id = m.detinator_id
   WHERE m.lot_id = current_setting('cost.op')::uuid;
  PERFORM set_config('cost.n', n::text, true), set_config('cost.n_bun', n_bun::text, true), set_config('cost.tokenuri_total', (SELECT count(*) FROM public.red_detinatori_token)::text, true);
END $verificare$;

-- ── rezultatul (r5): marcajul t2 = ULTIMA instrucțiune înaintea ROLLBACK-ului; lock-urile luate de RPC (setări, numerotarea M) sunt ținute până la
--    ROLLBACK, deci durata lor în proba asta = de la marcajul lor până la t2 (RPC + verificarea de mai sus). Ce rămâne nemăsurat: trimiterea acestui NOTICE
--    și drumul ROLLBACK-ului până la server (o singură instrucțiune, fără calcul). În PostgREST lock-urile țin doar RPC-ul + COMMIT-ul (rpc_ms).
--    verdict = OK doar dacă rpc_ms ȘI cele două durate de lock până la t2 sunt ≤ prag_ms ──
DO $rezultat$
DECLARE t2 bigint := (extract(epoch FROM clock_timestamp()) * 1000000)::bigint;
        t0 bigint := current_setting('cost.t0')::bigint; t1 bigint := current_setting('cost.t1')::bigint;
        tl bigint := nullif(current_setting('cost.lot_la'), '')::bigint; tm bigint := nullif(current_setting('cost.mesaj_la'), '')::bigint;
        n int := current_setting('cost.n')::int; n_bun int := current_setting('cost.n_bun')::int; prag int := current_setting('cost.prag_ms')::int;
        rpc int; ls_rpc int; ls_tx int; lm_tx int;
BEGIN
  rpc := round((t1 - t0) / 1000.0); ls_rpc := round((t1 - tl) / 1000.0); ls_tx := round((t2 - tl) / 1000.0); lm_tx := round((t2 - tm) / 1000.0);
  RAISE NOTICE 'COST 20261131i: destinatari=% caractere=% tokenuri_sintetice=% tokenuri_total=% rpc_ms=% lock_setari_rpc_ms=% lock_setari_tranzactie_ms=% lock_numerotare_tranzactie_ms=% mesaje=% mesaje_cu_linkul_lor=% prag_ms=% verdict=%',
    current_setting('cost.destinatari'), current_setting('cost.caractere'), current_setting('cost.tokenuri'), current_setting('cost.tokenuri_total'),
    rpc, ls_rpc, ls_tx, lm_tx, n, n_bun, prag,
    CASE WHEN n <> current_setting('cost.destinatari')::int OR n_bun <> n OR tl IS NULL OR tm IS NULL THEN 'GRESIT'
         WHEN rpc <= prag AND ls_tx <= prag AND lm_tx <= prag THEN 'OK' ELSE 'DEPASIT' END;
END $rezultat$;
-- <<< COST-CORP 20261131i
ROLLBACK;
