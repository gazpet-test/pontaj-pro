-- Version 20261216120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000 (DOAR cu plafon, vezi „Livrare”; marcajul gazpet.livrare_migrare legat de txid).
-- 20261216a_executie_raport_rezumat — Raportul zilnic de șantier: REZUMATUL scurt salvat pe raport (etapa 1, determinist, fără AI).
--
-- Ce face:
--   * rapoarte_zilnice + rezumat_text, rezumat_sursa ('automat' / 'editat'), rezumat_la, rezumat_de (NULL la automat), rezumat_eroare
--     (r3: codul SQLSTATE al ultimei compuneri automate eșuate; NULL = ultima a reușit). Rândurile vechi rămân cu rezumatul gol (NULL)
--     până la prima lor salvare: migrarea NU scrie date.
--   * Textul automat îl scrie SERVERUL, în aceeași tranzacție cu salvarea raportului, pe ORICE cale de scriere a antetului (L02 / L07):
--     - trigger BEFORE INSERT / UPDATE pe rapoarte_zilnice (trg_raport_zilnic_zz_rezumat; după trg_raport_zilnic_versiune, ordinea numelui):
--       raport nou = rezumat automat; scriere fără rezumat (RPC-ul de salvare, telefonul cu versiunea veche, alte module) = rezumatul
--       automat se reface, DAR un text corectat de om ('editat') NU se suprascrie;
--     - trigger AFTER INSERT pe raport_zilnic_salvari (ultimul pas al fn_raport_zilnic_salveaza, după antet + linii + distribuție): rescrie
--       rândul raportului FĂRĂ să-i schimbe rezumatul (r3), deci trece pe ramura „scriere fără rezumat” de mai sus: rezumatul automat se
--       reface pe conținutul FINAL al salvării. Nimic de schimbat în telefon: și telefonul vechi primește rezumatul.
--   * r3 (Jakarinos P1): rezumatul e un DERIVAT și NU poate anula salvarea raportului. Pe o scriere a raportului (nu o cerere de rezumat),
--     orice excepție din citirea / compunerea lui (sub-tranzacție BEGIN … EXCEPTION) lasă raportul să se salveze, rezumatul rămâne cum era
--     (raport nou: fără rezumat) și codul erorii se scrie în rezumat_eroare (doar SQLSTATE: niciun text de eroare / valoare din sursă).
--     De ce o coloană pe rând (nu jurnalul raport_zilnic_salvari): e cea mai mică schimbare care acoperă TOATE căile (jurnalul îl scrie
--     doar RPC-ul; antetul scris direct nu are rând în jurnal), stă lângă textul pe care îl privește, are aceleași drepturi de citire și se
--     șterge singură la următoarea compunere reușită. Excepțiile: refuzurile de acces / validare ale omului (42501 / 22023) rămân refuzuri;
--     o CERERE explicită de rezumat („Revino la automat”, „Generează”) cu compunerea eșuată = eroare către om (n-are ce altceva să salveze);
--     anulările (query_canceled: statement_timeout, plafonul) nu sunt prinse de WHEN OTHERS și opresc tot, ca azi.
--   * Textul automat e derivat (o funcție de raport + liniile lui), deci o scriere care schimbă DOAR rezumatul automat nu mărește
--     versiune_salvare (CAS-ul salvării din 20261208a): altfel telefonul ar vedea un conflict fals după propria salvare.
--     r3 (P2): o tranziție DECISĂ DE OM mărește versiunea: corectura (automat → editat, text nou) și „Revino la automat” (editat → automat).
--     Două telefoane care citesc aceeași versiune: al doilea care scrie o corectură veche primește conflict (0 rânduri), oricare ar fi
--     ordinea (scripts/raport_rezumat_concurenta.sh, două sesiuni reale pe clonă). „Generează” pe un raport vechi (NULL → automat) nu
--     înlocuiește nicio decizie a omului: versiunea rămâne.
--   * Corectura omului: UPDATE pe rapoarte_zilnice cu rezumat_sursa = 'editat' + textul (dreptul de scriere de azi pe tabel, niciun drept nou),
--     cu CAS pe versiune_salvare din aplicație; trigger-ul cere IDENTITATEA (r3, L08: auth.uid() NULL = refuz, nicio cale de server nu
--     corectează în locul unui om) și dreptul pe șantier (fn_raport_santier_drept, aceeași regulă ca RPC-ul de salvare, L19), curăță
--     caracterele de control (r3: aceeași mulțime ca la textul automat — coduri 1–31 și 127 —, păstrând doar rândul nou, CR / CRLF -> LF),
--     apoi cere text nevid și cel mult 4000 de caractere (peste = refuz, nu tăiere); autorul și ora le pune serverul (L08), iar CHECK-ul
--     cere autorul (r3: o corectură cu autor NULL nu poate exista). „Revino la automat” = UPDATE cu rezumat_sursa = 'automat' (textul îl
--     scrie serverul, nu clientul: un text trimis de client ca „automat” e înlocuit); peste o corectură cere aceeași identitate + drept.
--     Singura cale fără UID acceptată pe ramurile explicite: NULL → automat (generarea unui raport vechi), recunoscută după TRANZIȚIE, nu
--     după identitate (nu scrie text de om, nu înlocuiește unul, nu mărește versiunea).
--   * Regula textului: fn_raport_rezumat_text(jsonb) — oglinda lui rezumatRaport() din src/raportRezumat.js (L19: dublare inevitabilă
--     SQL / JS = paritate pe același tabel de cazuri, src/raportRezumat.cazuri.json; testul: scripts/test_executie_raport_rezumat.sql).
--     r3: plafon total 3000 de caractere (rânduri întregi, apoi „… (rezumat scurtat; restul în raport)”).
--     Intrarea: fn_raport_rezumat_intrare(rând) — blocul INTRARE de mai jos e copiat identic în scripts/raport_rezumat_proba.sql.
--   * r3 (vizibilitate, „ce nu vedea altfel”): garda e DEFINER și citește sursele ca proprietar. PRIN CONSTRUCȚIE, intrarea citește doar
--     rândul raportului, numele șantierului lui, proiectul ȘANTIERULUI și liniile / activitățile / obiectele aceluiași proiect (o linie,
--     activitate sau obiect al ALTUI proiect nu intră în text) + numărul de rânduri de distribuție (politica lor: orice cont logat). Pe axa
--     proiectului (20261209a: raportul unui șantier cu proiect se vede doar cu proiectul permis), textul nu aduce nimic din afara proiectului
--     raportului. Axa modulului (politicile de azi ale tabelelor-sursă, pe care repo-ul nu le are) se probează pe date:
--     scripts/raport_rezumat_vizibilitate.sql (doar citire): pentru fiecare cont ne-owner, intrarea compusă CA EL (RLS-ul lui) = intrarea
--     compusă ca proprietar, pe fiecare raport pe care îl vede; o diferență = NO-GO la aplicare.
--   * r4 (Jakarinos r3 P1: textul SALVAT după mutarea șantierului în alt proiect). Varianta (a): INVALIDARE în aceeași tranzacție cu mutarea.
--     - rezumat_proiect_id (nou) = proiectul șantierului pentru care s-a compus / corectat textul, pus DOAR de server (L08);
--     - trigger AFTER UPDATE pe sites, doar când proiect_id se schimbă (trg_raport_rezumat_santier_mutat): rezumatele AUTOMATE ale rapoartelor
--       șantierului compuse pentru alt proiect devin 'de_recompus' (text NULL, rezumat_la = momentul invalidării, fără compunere: costul e un
--       UPDATE pe rând, prin indexul (site_id, data)); versiunea raportului NU crește (se schimbă doar derivatul). Următoarea salvare sau
--       „Generează” îl refac pe proiectul NOU;
--     - rezumatele CORECTATE de om (editat) pentru proiectul vechi OPRESC mutarea (55000, nimic schimbat), până la „Revino la automat” pe ele;
--       r5: mesajul spune câte rapoarte și din ce zile (primele 5, apoi „+N”).
--       De ce refuz și nu ascundere / mutare a textului: textul omului descrie lucrările proiectului vechi (pentru proiectul nou e greșit
--       oricum); ascunderea la citire nu se poate impune în BD fără drepturi pe coloane (rupe select('*') din aplicație), iar o copie „doar
--       pentru owner” = tabel nou + RLS nou pentru un caz rar. Refuzul nu pierde nimic în tăcere (L12) și lasă decizia omului, pe calea care
--       există deja (identitate + drept pe șantier + CAS);
--     - aceeași regulă pe rândul raportului (garda): o scriere fără rezumat pe un rând al cărui rezumat e pentru alt proiect decât cel de acum
--       al șantierului (raport mutat pe alt șantier) = automat -> 'de_recompus', editat -> refuz 55000;
--     - concurența (L06), r5 (Jakarinos r4 P1 + P2): UN protocol pe rândul ȘANTIERULUI, nu pe tabel.
--       * Orice scriere care atinge rezumatul (garda, pe toate ramurile: raport nou, salvare, corectură, „Generează”, „Revino la automat”)
--         citește proiectul cu FOR SHARE pe rândul șantierului, ÎNAINTEA compunerii, ținut până la COMMIT. În READ COMMITTED o mutare în
--         zbor e așteptată și se citește proiectul nou; în REPEATABLE READ / SERIALIZABLE, un șantier mutat după imaginea tranzacției dă
--         eroare de serializare (40001) — textul nu se mai poate compune pe proiectul din imagine (r4 P1: „Generează” pe un raport vechi,
--         cu rezumat NULL, pe care mutarea nu-l atinsese, deci fără conflict de versiune).
--       * Mutarea ține rândul șantierului (UPDATE-ul lui proiect_id, FOR NO KEY UPDATE): așteaptă salvările în zbor ale șantierului (o salvare
--         în curs, care a citit proiectul vechi, se termină înainte, iar invalidarea o vede — S4) și oprește salvările care încep după (ele
--         compun pe proiectul nou — S5). Apoi blochează doar rapoartele ȘANTIERULUI de schimbat, NOWAIT: un raport ținut de o salvare în
--         curs = refuz imediat al mutării (55P03, nimic schimbat, se reîncearcă), niciodată așteptare (altfel ciclu cu salvarea care ține
--         rândul raportului și cere rândul șantierului — S8). Salvările altor șantiere nu așteaptă deloc (S7).
--       * Mutarea cere READ COMMITTED (altfel invalidarea n-ar vedea rândurile comise între timp): refuz 0A000. Trigger-ul de acces pe
--         rapoarte (20261209a) verifică și aici dreptul celui care mută pe proiectul rapoartelor: un cont restrâns fără drept de scriere pe
--         proiectul nou nu poate muta un șantier cu rezumate (42501).
--       * Cât ține mutarea: doar salvările ȘANTIERULUI mutat așteaptă, cât durează invalidarea lui (un UPDATE pe rând, fără compunere);
--         durata la volum se măsoară pe clonă cu scripts/raport_rezumat_mutare_durata.sql (docs/RAPORT_REZUMAT_E1.md).
--     - Ce NU acoperă (date care nu se mută azi din aplicație): o activitate / un obiect / o linie mutată în alt proiect după compunere.
-- De ce NU se schimbă fn_raport_zilnic_salveaza: 20261209a (acces pe proiect, neaplicată la scriere) îi ține amprenta corpului în inventar,
--   iar 20261213a ține amprenta inventarului; o schimbare a RPC-ului le-ar opri pe amândouă. Funcțiile de aici nu sunt apelabile din API
--   (fără EXECUTE pentru anon / authenticated / service_role), deci nici detectorul de catalog al lui 20261209a nu le cere clasificare.
-- Ce NU face: nicio dată (niciun rezumat generat pentru rapoartele vechi; generarea lor e un pas separat, după proba pe 20 de rapoarte),
--   niciun drept nou, nicio politică, nicio atingere pe raport_lucrari / raport_distributie_linii / RPC-urile 20261208a.
-- Dependențe: 20261208a aplicată (fn_raport_zilnic_salveaza cu amprenta revizuită, fn_raport_zilnic_versiune, raport_zilnic_salvari) și 20261027a.
--
-- L15 (r3, același tipar ca PR #1071): amprenta COMPLETĂ a stării de acces, comparată cu BASELINE-ul din producție ÎNAINTE și DUPĂ schimbare.
--   Obiectele: tabelele rapoarte_zilnice și raport_zilnic_salvari; funcțiile: cele din politicile și triggerele lor (le găsește catalogul) +
--   cele din BASELINE (punctul de plecare — fn_raport_zilnic_salveaza, fn_raport_zilnic_versiune, fn_raport_santier_drept cu CORPUL ei,
--   auth.uid() — și callee-urile tranzitive revizuite). Pe tabele: drepturile pe tabel / coloane / secvențe, proprietarul, RLS + FORCE, TOATE
--   politicile, inventarul triggerelor; pe funcții: tip, limbaj, DEFINER, proprietar, configurația (search_path), drepturile, md5 pe corp.
--   Corpul de calcul AMPRENTA_L15 v1 e IDENTIC (L19) cu cel din scripts/tichete_lot2_amprente.sql (testul src/raportRezumatAmprente.test.js).
--   Valorile le scoate coordonatorul cu scripts/raport_rezumat_amprente.sql (tranzacție READ ONLY) și le copiază în blocul BASELINE;
--   necompletat = migrarea refuză. „După” = baseline-ul exact, cu DOUĂ excepții declarate: inventarul triggerelor celor TREI tabele are în
--   plus EXACT triggerul nou al fiecăruia (restul liniilor, octet cu octet, ca înainte), iar lista de funcții are în plus EXACT funcțiile
--   celor trei triggere noi (proprietățile lor: postcondițiile).
--   r4: tabelul sites intră în amprentă (trigger-ul nou de mutare stă pe el): etichetele „tabel sites | …” și funcțiile din politicile /
--   triggerele lui sunt NOI în baseline, marcate DE_COMPLETAT (= refuz) până le scoate coordonatorul cu același script. Cele 29 de etichete
--   deja lipite nu se schimbă (fiecare se calculează doar pe obiectul ei); scriptul rulat din nou trebuie să le dea identic.
--   r5: toate cele 37 de valori sunt lipite (#1075: 29 + 6 etichete sites + 2 funcții din politicile / triggerele lui) și NU se schimbă:
--   r5 nu adaugă obiecte în amprentă (garda și mutarea sunt funcțiile noi ale migrării, verificate de postcondiții, nu de baseline).
--   Decizie separată a owner-ului (r3 P2, fără cod aici): baseline-ul îngheață drepturile de AZI pe rapoarte_zilnice — rolul anon are
--   SELECT / INSERT / UPDATE / DELETE / REFERENCES / TRIGGER pe tabel (RLS fără politică pentru anon blochează rândurile) și SELECT / USAGE /
--   UPDATE pe secvența rapoarte_zilnice_id_seq (RLS nu protejează secvența). Migrarea nu le acceptă și nu le schimbă: o curățare ulterioară
--   (REVOKE) schimbă etichetele „tabel rapoarte_zilnice | acl” și „tabel rapoarte_zilnice | secvente” (și „… | politici” dacă se atinge
--   politica rapoarte_sel), deci baseline-ul se scoate din nou după ea (docs/RAPORT_REZUMAT_E1.md, „Decizii pentru owner”).
--
-- Livrare (r3, Jakarinos P1 la aplicare): DOAR cu plafon — scripts/livrare_migrare.sh … --plafon-tranzactie-ms 2000 (runnerul trimite toată
--   tranzacția într-UN singur mesaj, PR #1072). Fără plafon migrarea refuză ($pre$ cere 2000/session citit calificat din pg_catalog +
--   marcajul gazpet.plafon_tranzactie = '2000:<txid>' pus de prologul runnerului).
--   Lock-urile (L06, ordinea RPC-ului de salvare): rapoarte_zilnice ACCESS EXCLUSIVE (cerut de ADD COLUMN / CREATE TRIGGER), apoi
--   raport_zilnic_salvari SHARE ROW EXCLUSIVE (cerut de CREATE TRIGGER), apoi (r4, tabelul altui modul, ULTIMUL) sites SHARE ROW EXCLUSIVE
--   (cerut de CREATE TRIGGER: oprește scurt scrierile pe sites, nu și citirile), ținute până la COMMIT. Luate DUPĂ verificările care citesc doar
--   catalogul (garda, amprenta L15 „înainte”), cu NOWAIT, într-o sub-tranzacție reîncercată la 50 ms până la 1 s de la BEGIN; peste =
--   refuz 55P03, nimic schimbat (NOWAIT nu intră în coada lock-ului: citirile / salvările telefoanelor nu se așează în spatele migrării).
--   lock_timeout 100 ms pentru orice altă așteptare. La rulare: trigger-ul de pe jurnal actualizează rândul raportului deja blocat de RPC
--   (FOR UPDATE, pasul 1); r5: garda adaugă un singur lock, FOR SHARE pe rândul șantierului raportului (compatibil cu alte salvări și cu
--   FK-urile; în conflict doar cu UPDATE-ul / ștergerea rândului șantierului).
--   CE ȚINE LOCK-UL, după r3: DOAR catalog. Coloanele noi sunt nullable, fără valoare implicită (fără rescriere), iar CHECK-ul se adaugă
--   NOT VALID: nicio scanare a tabelului sub ACCESS EXCLUSIVE (în r2 CHECK-ul validat scana tot tabelul, iar postcondiția „nu scrie date”
--   îl mai citea o dată). NOT VALID nu slăbește nimic: CHECK-ul se aplică oricărui rând nou / modificat, iar rândurile existente au
--   coloanele noi NULL (dovedit din catalog: fără valoare implicită / „missing value”), deci îl respectă. Un VALIDATE CONSTRAINT în aceeași
--   tranzacție NU ar câștiga nimic (ACCESS EXCLUSIVE e deja ținut, scanarea ar fi tot sub el); dacă se dorește, VALIDATE se face separat,
--   oricând după (SHARE UPDATE EXCLUSIVE: nu blochează citirile și scrierile) — nu e cerut de nimic din aplicație.
--   Valoarea 2000 ms: după lock-uri rămân ~20 de instrucțiuni de catalog (ALTER fără scanare, 10 CREATE FUNCTION, 2 CREATE TRIGGER,
--   postcondițiile, amprenta „după”); bugetul de lock se oprește la 1 s. Se MĂSOARĂ pe clonă (cu volumul de producție) cu runnerul însuși
--   (--plafon-tranzactie-ms 2000): NOTICE-ul „20261216a: lock-uri la X ms … sfarsit la Y ms de la BEGIN” al migrării + LIVRARE_TIMP /
--   PLAFON_TIMP ale runnerului; țintă Y < 1000. Dacă Y ≥ 1500 pe clonă, NU se aplică: se cere altă valoare în review (nu se urcă singur).
--   Garanția (formularea runnerului): ~2 s de la BEGIN până la intrarea în COMMIT; COMMIT-ul propriu-zis nu e plafonat.
-- Revenire: supabase/revenire/20261216a_executie_raport_rezumat_ROLLBACK.sql (r4: tot prin runner, cu --plafon-tranzactie-ms 2000). Test: scripts/test_executie_raport_rezumat.sql (clonă) +
--   scripts/pglite/test_raport_rezumat_local.mjs (local, PGlite) + scripts/raport_rezumat_concurenta.sh (clonă, două sesiuni; r5: S6–S8
--   + --mutant) + scripts/raport_rezumat_mutare_durata.sql (clonă, durata mutării la N rapoarte, tranzacție anulată).
DO $pre$
DECLARE r record; v_tip text; v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261216a_executie_raport_rezumat:' || txid_current() THEN
    RAISE EXCEPTION '20261216a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261216a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261216a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  -- r3: plafonul total = ceasul de tranzacție PostgreSQL 17, pornit la BEGIN cu 2000 ms de runner (SET de sesiune înainte de BEGIN, sursa
  -- 'session'), citit CALIFICAT (pg_catalog: un tabel temporar omonim nu-l poate umbri) + marcajul pus de prologul runnerului
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261216a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261216a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- nicio așteptare de lock pe tăcute (lock-urile explicite sunt NOWAIT; orice altă așteptare = eroare la 100 ms, nu blocare)
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rapoarte_zilnice'
               AND column_name IN ('rezumat_text', 'rezumat_sursa', 'rezumat_la', 'rezumat_de', 'rezumat_eroare', 'rezumat_proiect_id'))
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_raport\_rezumat\_%')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_raport_zilnic_zz_rezumat', 'trg_raport_zilnic_salvari_rezumat', 'trg_raport_rezumat_santier_mutat'))
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rapoarte_zilnice_rezumat_ck') THEN
    RAISE EXCEPTION '20261216a: obiectele exista deja (reaplicare)';
  END IF;
  -- 20261208a aplicată, cu corpurile revizuite (L15): salvarea scrie jurnalul ULTIMA (după antet, linii, distribuție), versiunea crește la orice
  -- scriere. Sursa acestor amprente e repo-ul (independentă de BASELINE-ul de mai jos, care le prinde și proprietățile / drepturile).
  IF to_regprocedure('public.fn_raport_zilnic_salveaza(bigint, date, jsonb, jsonb, jsonb, integer, uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_raport_zilnic_salveaza(bigint, date, jsonb, jsonb, jsonb, integer, uuid)')
                     AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres'
                     AND md5(replace(p.prosrc, chr(13), '')) = 'c9c6b6b3d27f14fe29712196b7f23e2c')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_raport_zilnic_versiune()')
                     AND NOT p.prosecdef AND md5(replace(p.prosrc, chr(13), '')) = 'fc7ae4071bb57185e44eda647183192b')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.rapoarte_zilnice'::regclass AND tg.tgname = 'trg_raport_zilnic_versiune'
                     AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0
                     AND tg.tgfoid = to_regprocedure('public.fn_raport_zilnic_versiune()')
                     AND tg.tgtype = (1 | 2 | 4 | 16))   -- ROW, BEFORE, INSERT, UPDATE
     OR to_regclass('public.raport_zilnic_salvari') IS NULL THEN
    RAISE EXCEPTION '20261216a: 20261208a nu e aplicata sau RPC-ul de salvare / versiunea difera de amprenta revizuita';
  END IF;
  -- dreptul pe șantier (20261208a; 20261209a îi adaugă condiția de proiect): contractul aici, CORPUL în amprenta L15 (BASELINE)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_raport_santier_drept(bigint)')
                   AND p.prorettype = 'boolean'::regtype AND p.prosecdef) THEN
    RAISE EXCEPTION '20261216a: fn_raport_santier_drept(bigint) lipseste sau nu e DEFINER boolean';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL OR to_regclass('public.raport_distributie_linii') IS NULL THEN
    RAISE EXCEPTION '20261216a: auth.uid / raport_distributie_linii (20261027a) lipsesc';
  END IF;
  -- coloanele citite de rezumat, cu tipurile acceptate (din migrările 20261027a / 20261208a și din cod; ce diferă oprește migrarea)
  FOR r IN SELECT * FROM (VALUES
      ('rapoarte_zilnice', 'id', 'bigint'), ('rapoarte_zilnice', 'site_id', 'integer|bigint'), ('rapoarte_zilnice', 'data', 'date'),
      ('rapoarte_zilnice', 'lucrari_efectuate', 'text'), ('rapoarte_zilnice', 'probleme', 'text'), ('rapoarte_zilnice', 'masini', 'text'),
      ('rapoarte_zilnice', 'subcontractori', 'text'), ('rapoarte_zilnice', 'aprovizionare', 'text'), ('rapoarte_zilnice', 'plan_maine', 'text'),
      ('rapoarte_zilnice', 'personal_snapshot', 'jsonb'), ('rapoarte_zilnice', 'utilaje_snapshot', 'jsonb'), ('rapoarte_zilnice', 'meteo', 'jsonb'),
      ('rapoarte_zilnice', 'poze', 'ARRAY'), ('rapoarte_zilnice', 'versiune_salvare', 'integer'), ('rapoarte_zilnice', 'updated_at', 'timestamp with time zone'),
      ('sites', 'id', 'integer|bigint'), ('sites', 'name', 'text|character varying'), ('sites', 'proiect_id', 'integer|bigint'),
      ('executie_proiecte', 'id', 'bigint'), ('executie_proiecte', 'nume', 'text|character varying'),
      ('raport_lucrari', 'id', 'bigint'), ('raport_lucrari', 'raport_id', 'bigint'), ('raport_lucrari', 'activitate_id', 'integer|bigint'),
      ('raport_lucrari', 'unitate_id', 'bigint'), ('raport_lucrari', 'cantitate', 'numeric'), ('raport_lucrari', 'proiect_id', 'integer|bigint'),
      ('proiect_activitati', 'id', 'integer|bigint'), ('proiect_activitati', 'nume', 'text|character varying'), ('proiect_activitati', 'um', 'text|character varying'),
      ('proiect_activitati', 'tip_raportare', 'text|character varying'), ('proiect_activitati', 'ordine', 'integer|bigint|smallint|numeric'),
      ('proiect_activitati', 'proiect_id', 'integer|bigint'),
      ('proiect_unitati', 'id', 'bigint'), ('proiect_unitati', 'cod', 'text|character varying'), ('proiect_unitati', 'nume', 'text|character varying'),
      ('proiect_unitati', 'ordine', 'integer|bigint|smallint|numeric'), ('proiect_unitati', 'proiect_id', 'integer|bigint'),
      ('raport_distributie_linii', 'raport_id', 'bigint'), ('raport_distributie_linii', 'tabel', 'text|character varying')
    ) v(t, c, tipuri) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR NOT (v_tip = ANY (string_to_array(r.tipuri, '|'))) THEN
      RAISE EXCEPTION '20261216a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tipuri;
    END IF;
  END LOOP;
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.rapoarte_zilnice'::regclass AND attname = 'poze' AND NOT attisdropped) <> 'text[]' THEN
    RAISE EXCEPTION '20261216a: rapoarte_zilnice.poze nu e text[]';
  END IF;
  -- trigger-ul nostru compară rândul DUPĂ celelalte trigger-e BEFORE: niciun trigger BEFORE ROW necunoscut nu rulează după el
  -- (ordinea PostgreSQL = numele, colația C) și nu-i schimbă rândul după comparație
  SELECT string_agg(tg.tgname, ', ') INTO v_tip FROM pg_trigger tg
   WHERE tg.tgrelid = 'public.rapoarte_zilnice'::regclass AND NOT tg.tgisinternal AND (tg.tgtype & 2) = 2 AND (tg.tgtype & 1) = 1
     AND tg.tgname::text COLLATE "C" > 'trg_raport_zilnic_zz_rezumat' COLLATE "C";
  IF v_tip IS NOT NULL THEN
    RAISE EXCEPTION '20261216a: trigger-e BEFORE ROW necunoscute dupa garda rezumatului pe rapoarte_zilnice: %', v_tip;
  END IF;
END $pre$;

-- ── L15 (r3): amprenta COMPLETĂ a stării de acces, verificată ÎNAINTE și DUPĂ schimbare (tiparul PR #1071) ──
-- Funcțiile pg_temp de mai jos trăiesc doar în sesiunea migrării și se șterg la final. Orice diferență față de BASELINE (un drept în plus,
--   o politică în plus, alt corp / altă configurație a unei funcții din lanț, un trigger oprit, RLS / FORCE schimbat) = refuz, nimic scris.
-- >>> BASELINE 20261216a — SINGURUL loc cu valori din producție: coloana linie_baseline din scripts/raport_rezumat_amprente.sql, copiată
--     ÎNTREAGĂ, în ordinea afișată; coloana „detaliu” de acolo intră în review. Necompletat = migrarea refuză.
CREATE FUNCTION pg_temp.amp_baseline_20261216a() RETURNS TABLE (eticheta text, amprenta text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $bl$
  SELECT v.eticheta, v.amprenta FROM (VALUES
    ('functie auth.jwt()', '0a339ea1d249a021248f635d6afb9687')
    , ('functie auth.uid()', '547eb1864858f1efce909a735a04d521')
    , ('functie fn_auto_create_executie_proiect()', '65ba246342e6d1594eed6152298e5c3d')
    , ('functie fn_executie_acces_garda_copil()', '4344ff23cd4110f4c7f02e10d9e65704')
    , ('functie fn_executie_acces_lista(boolean)', '8dae19e2f5e53aeaec7d4a7d360f046b')
    , ('functie fn_executie_acces_lista_cont(uuid,boolean)', '4f382e2182a748dd9790e9f65f9cd9a5')
    , ('functie fn_executie_acces_nerestrans()', '53dbf0d75d3f7f5d17747fef20b674a7')
    , ('functie fn_executie_acces_nerestrans_cont(uuid)', 'bba2d110bb9df2b16d9239156f3b3607')
    , ('functie fn_executie_acces_parinte_permis(text,bigint,boolean)', 'eb20270866ad8d939d1f1078bacd0997')
    , ('functie fn_executie_acces_proprii_citire()', '0b22d050c5991fcf163f5149b768760e')
    , ('functie fn_executie_acces_proprii_scriere()', '3936848939fd2aede49be5d992171f06')
    , ('functie fn_executie_proiect_permis(bigint,boolean)', 'bb8d39285aee035d640af6f7371e5476')
    , ('functie fn_raport_distributie_salveaza(bigint,jsonb)', 'a20c8c6c286b39cb234ece5348ed4346')
    , ('functie fn_raport_lucrari_amprenta_linii(jsonb)', '1e02fe0a2cc17f19618ad252df1d1508')
    , ('functie fn_raport_lucrari_json(bigint)', '43c3306824a4c7e6ac3fde5ca84f704e')
    , ('functie fn_raport_santier_drept(bigint)', '0d759c83376de45804392f28353a370d')
    , ('functie fn_raport_zilnic_salveaza(bigint,date,jsonb,jsonb,jsonb,integer,uuid)', 'e3ab72f918a8c8a99bd655a4dd3c1386')
    , ('functie fn_raport_zilnic_versiune()', 'e86174ecabbbea46f897842626089602')
    , ('functie fn_site_name_to_cod_intern(text)', '90576f5e637d8bdf9bd5873d50bcbf9a')
    , ('tabel rapoarte_zilnice | acl', '565553b4fd23bff3761a45bfba76d27c')
    , ('tabel rapoarte_zilnice | acl coloane', 'a0e240c36ade38bbb43163c61b36e86b')
    , ('tabel rapoarte_zilnice | politici', '0b44f3ed9a1b5b3b92e65027716ac55e')
    , ('tabel rapoarte_zilnice | rls', '0a318f8ff8d8cc0bbd7b4b61a975f7b3')
    , ('tabel rapoarte_zilnice | secvente', 'a16ae5a66e83dcdefa56f139b4521258')
    , ('tabel rapoarte_zilnice | triggere', '7630ab73681e1477d8646917c5b989c7')
    , ('tabel raport_zilnic_salvari | acl', 'a5ae5ea9e997cab4f2ee000e33fc0eec')
    , ('tabel raport_zilnic_salvari | acl coloane', 'a0e240c36ade38bbb43163c61b36e86b')
    , ('tabel raport_zilnic_salvari | politici', '475967fd717c9ea67c64223c2e37458d')
    , ('tabel raport_zilnic_salvari | rls', '0a318f8ff8d8cc0bbd7b4b61a975f7b3')
    , ('tabel raport_zilnic_salvari | secvente', 'c682593c295df7f5bac08453a7869d18')
    , ('tabel raport_zilnic_salvari | triggere', '7fd4342f774415f814a99973b428be52')
    , ('tabel sites | acl', '565553b4fd23bff3761a45bfba76d27c')
    , ('tabel sites | acl coloane', 'a0e240c36ade38bbb43163c61b36e86b')
    , ('tabel sites | politici', '40efb11aeae2999fe40956b624c430e0')
    , ('tabel sites | rls', '0a318f8ff8d8cc0bbd7b4b61a975f7b3')
    , ('tabel sites | secvente', 'fdda94678348628259941ebf2c046662')
    , ('tabel sites | triggere', '9bad825768e3d868bc4b95c82c0218dc')
  ) v(eticheta, amprenta)
$bl$;
-- <<< BASELINE 20261216a
CREATE FUNCTION pg_temp.amp_calc_20261216a() RETURNS TABLE (eticheta text, amprenta text, detaliu text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $amp$
WITH
amp_tabele(oid) AS (VALUES ('public.rapoarte_zilnice'::regclass::oid), ('public.raport_zilnic_salvari'::regclass::oid), ('public.sites'::regclass::oid)),
amp_functii_explicite(oid) AS (SELECT to_regprocedure(substr(b.eticheta, 9))::oid FROM pg_temp.amp_baseline_20261216a() b WHERE b.eticheta LIKE 'functie %'),
-- >>> AMPRENTA_L15 v1
amp_functii(oid) AS (
  SELECT f.oid FROM amp_functii_explicite f WHERE f.oid IS NOT NULL
  UNION
  SELECT d.refobjid FROM pg_depend d JOIN pg_policy pol ON pol.oid = d.objid
   WHERE d.classid = 'pg_policy'::regclass AND d.refclassid = 'pg_proc'::regclass AND pol.polrelid IN (SELECT t.oid FROM amp_tabele t)
  UNION
  SELECT tg.tgfoid FROM pg_trigger tg WHERE tg.tgrelid IN (SELECT t.oid FROM amp_tabele t) AND NOT tg.tgisinternal
),
amp_calc(eticheta, amprenta, detaliu) AS (
  SELECT x.eticheta, md5(x.detaliu), x.detaliu FROM (
    -- drepturile pe tabel (relacl NULL = implicitul proprietarului); rolul 0 = PUBLIC; * = cu GRANT OPTION
    SELECT 'tabel ' || c.oid::regclass::text || ' | acl' AS eticheta,
           coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
             SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                    || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
               FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e) a), '(niciun drept)') AS detaliu
      FROM pg_class c WHERE c.oid IN (SELECT t.oid FROM amp_tabele t)
    UNION ALL
    -- drepturile pe coloane (doar coloanele cu drepturi proprii)
    SELECT 'tabel ' || c.oid::regclass::text || ' | acl coloane',
           coalesce((SELECT string_agg(a.d, '; ' ORDER BY a.d COLLATE "C") FROM (
             SELECT att.attname::text || ' ' || CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                    || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
               FROM pg_attribute att CROSS JOIN LATERAL aclexplode(att.attacl) e
              WHERE att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped AND att.attacl IS NOT NULL) a), '(fara drepturi pe coloane)')
      FROM pg_class c WHERE c.oid IN (SELECT t.oid FROM amp_tabele t)
    UNION ALL
    -- proprietarul, tipul, RLS și FORCE RLS
    SELECT 'tabel ' || c.oid::regclass::text || ' | rls',
           'proprietar=' || pg_get_userbyid(c.relowner) || ', tip=' || c.relkind::text || ', rls=' || c.relrowsecurity::text
           || ', force=' || c.relforcerowsecurity::text
      FROM pg_class c WHERE c.oid IN (SELECT t.oid FROM amp_tabele t)
    UNION ALL
    -- secvențele tabelului (serial / identity) și drepturile lor
    SELECT 'tabel ' || c.oid::regclass::text || ' | secvente',
           coalesce((SELECT string_agg(a.d, '; ' ORDER BY a.d COLLATE "C") FROM (
             SELECT s.oid::regclass::text || ' ' || CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                    || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
               FROM pg_depend dp JOIN pg_class s ON s.oid = dp.objid AND s.relkind = 'S'
               CROSS JOIN LATERAL aclexplode(coalesce(s.relacl, acldefault('s', s.relowner))) e
              WHERE dp.classid = 'pg_class'::regclass AND dp.refclassid = 'pg_class'::regclass AND dp.refobjid = c.oid
                AND dp.deptype IN ('a', 'i')) a), '(fara secvente)')
      FROM pg_class c WHERE c.oid IN (SELECT t.oid FROM amp_tabele t)
    UNION ALL
    -- TOATE politicile: comanda, PERMISSIVE / RESTRICTIVE, rolurile, USING (NULL = true), WITH CHECK (NULL = același USING)
    SELECT 'tabel ' || c.oid::regclass::text || ' | politici',
           coalesce((SELECT string_agg(a.d, chr(10) ORDER BY a.d COLLATE "C") FROM (
             SELECT pol.polname::text || ' | ' || pol.polcmd::text || ' | ' || CASE WHEN pol.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END
                    || ' | roluri=' || coalesce((SELECT string_agg(r.n, ',' ORDER BY r.n COLLATE "C") FROM (
                         SELECT CASE ro WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(ro) END AS n FROM unnest(pol.polroles) ro) r), '-')
                    || ' | USING ' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), 'true')
                    || ' | CHECK ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '(= USING)') AS d
               FROM pg_policy pol WHERE pol.polrelid = c.oid) a), '(fara politici)')
      FROM pg_class c WHERE c.oid IN (SELECT t.oid FROM amp_tabele t)
    UNION ALL
    -- triggerele (fără cele interne de FK): funcția, starea (O / D / R / A), definiția întreagă (moment, evenimente, WHEN)
    SELECT 'tabel ' || c.oid::regclass::text || ' | triggere',
           coalesce((SELECT string_agg(a.d, chr(10) ORDER BY a.d COLLATE "C") FROM (
             SELECT tg.tgname::text || ' | ' || tg.tgfoid::regprocedure::text || ' | stare=' || tg.tgenabled::text || ' | ' || pg_get_triggerdef(tg.oid) AS d
               FROM pg_trigger tg WHERE tg.tgrelid = c.oid AND NOT tg.tgisinternal) a), '(fara triggere)')
      FROM pg_class c WHERE c.oid IN (SELECT t.oid FROM amp_tabele t)
    UNION ALL
    -- funcțiile (pornire + politici + triggere + callee-urile din BASELINE): proprietăți, drepturi, md5 pe corp (fără CR)
    SELECT 'functie ' || p.oid::regprocedure::text,
           'tip=' || p.prokind::text || ', limbaj=' || l.lanname::text || ', definer=' || p.prosecdef::text || ', volatil=' || p.provolatile::text
           || ', strict=' || p.proisstrict::text || ', leakproof=' || p.proleakproof::text || ', proprietar=' || pg_get_userbyid(p.proowner)
           || ', config=' || coalesce(array_to_string(p.proconfig, '; '), '(mostenit)') || ', intoarce=' || coalesce(pg_get_function_result(p.oid), '-')
           || ', acl=' || coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                  FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '(niciun drept)')
           || ', corp_md5=' || md5(replace(p.prosrc, chr(13), ''))
           || ', sqlbody_md5=' || coalesce(md5(replace(pg_get_function_sqlbody(p.oid), chr(13), '')), '-')
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid IN (SELECT f.oid FROM amp_functii f)
  ) x
)
-- <<< AMPRENTA_L15 v1
SELECT c.eticheta, c.amprenta, c.detaliu FROM amp_calc c
$amp$;
-- „înainte”: exact baseline-ul. „după”: exact baseline-ul, cu cele două excepții declarate în antet (triggerele noi + funcțiile lor).
CREATE FUNCTION pg_temp.amp_verifica_20261216a(p_moment text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $vf$
DECLARE v_dif text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261216a())
     OR EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261216a() b
                 WHERE b.eticheta IS NULL OR b.amprenta IS NULL OR b.amprenta !~ '^[0-9a-f]{32}$'
                    OR (b.eticheta NOT LIKE 'tabel %' AND b.eticheta NOT LIKE 'functie %')) THEN
    RAISE EXCEPTION '20261216a: baseline L15 necompletat sau invalid (scripts/raport_rezumat_amprente.sql, sectiunea 20261216a)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261216a() b GROUP BY b.eticheta HAVING count(*) > 1) THEN
    RAISE EXCEPTION '20261216a: baseline L15 cu etichete duble';
  END IF;
  WITH calc AS (
    SELECT c.eticheta,
           CASE
             -- inventarul triggerelor DUPĂ: fără linia triggerului nou al tabelului (exact una, activă), restul în ordinea lor = cel de dinainte
             -- (r4: și sites, cu triggerul de mutare; fiecare tabel are EXACT triggerul lui, nu al altuia)
             WHEN p_moment = 'dupa' AND c.eticheta IN ('tabel rapoarte_zilnice | triggere', 'tabel raport_zilnic_salvari | triggere', 'tabel sites | triggere') THEN
               CASE WHEN (SELECT count(*) FROM unnest(string_to_array(c.detaliu, chr(10))) l
                           WHERE l LIKE 'trg\_raport\_zilnic\_zz\_rezumat | %' OR l LIKE 'trg\_raport\_zilnic\_salvari\_rezumat | %'
                              OR l LIKE 'trg\_raport\_rezumat\_santier\_mutat | %') = 1
                         AND (SELECT count(*) FROM unnest(string_to_array(c.detaliu, chr(10))) l
                               WHERE l LIKE CASE c.eticheta
                                 WHEN 'tabel rapoarte_zilnice | triggere' THEN 'trg\_raport\_zilnic\_zz\_rezumat | fn\_raport\_rezumat\_garda() | stare=O | %'
                                 WHEN 'tabel raport_zilnic_salvari | triggere' THEN 'trg\_raport\_zilnic\_salvari\_rezumat | fn\_raport\_rezumat\_dupa\_salvare() | stare=O | %'
                                 ELSE 'trg\_raport\_rezumat\_santier\_mutat | fn\_raport\_rezumat\_santier\_mutat() | stare=O | %' END) = 1
                    THEN md5(coalesce(nullif((SELECT string_agg(u.l, chr(10) ORDER BY u.o)
                                                FROM unnest(string_to_array(c.detaliu, chr(10))) WITH ORDINALITY u(l, o)
                                               WHERE u.l NOT LIKE 'trg\_raport\_zilnic\_zz\_rezumat | %'
                                                 AND u.l NOT LIKE 'trg\_raport\_zilnic\_salvari\_rezumat | %'
                                                 AND u.l NOT LIKE 'trg\_raport\_rezumat\_santier\_mutat | %'), ''), '(fara triggere)'))
                    ELSE 'triggerul nou lipseste / e dublat / oprit' END
             ELSE c.amprenta END AS amprenta
      FROM pg_temp.amp_calc_20261216a() c
     -- funcțiile celor trei triggere noi există doar DUPĂ (proprietățile lor: postcondițiile)
     WHERE NOT (p_moment = 'dupa' AND c.eticheta IN ('functie fn_raport_rezumat_garda()', 'functie fn_raport_rezumat_dupa_salvare()',
                                                     'functie fn_raport_rezumat_santier_mutat()'))
  )
  SELECT string_agg(coalesce(c.eticheta, b.eticheta) || ' = ' || coalesce(c.amprenta, 'LIPSESTE') || ' (baseline ' || coalesce(b.amprenta, 'NU ARE') || ')',
                    '; ' ORDER BY coalesce(c.eticheta, b.eticheta) COLLATE "C")
    INTO v_dif
    FROM calc c FULL JOIN pg_temp.amp_baseline_20261216a() b ON b.eticheta = c.eticheta
   WHERE c.amprenta IS DISTINCT FROM b.amprenta;
  IF v_dif IS NOT NULL THEN
    RAISE EXCEPTION '20261216a: starea de acces (%) difera de baseline-ul L15 revizuit: %', p_moment, v_dif;
  END IF;
  -- independent de baseline: o funcție SECURITY DEFINER din lanț fără search_path propriu = refuz (L15)
  IF EXISTS (SELECT 1 FROM pg_temp.amp_calc_20261216a() c
              WHERE c.eticheta LIKE 'functie %' AND c.detaliu LIKE '%definer=true%' AND c.detaliu LIKE '%config=(mostenit)%') THEN
    RAISE EXCEPTION '20261216a: o functie SECURITY DEFINER din lantul de acces nu are search_path propriu';
  END IF;
END $vf$;
DO $l15_inainte$ BEGIN PERFORM pg_temp.amp_verifica_20261216a('inainte'); END $l15_inainte$;

-- ── punctul UNIC de blocare (L06, ordinea RPC-ului de salvare), după verificările de catalog; NOWAIT + reîncercare până la 1 s de la BEGIN ──
DO $lock$
DECLARE v_incercari integer := 0;
BEGIN
  LOOP
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.rapoarte_zilnice IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.raport_zilnic_salvari IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.sites IN SHARE ROW EXCLUSIVE MODE NOWAIT;   -- r4: tabelul altui modul, ultimul (CREATE TRIGGER pe el)
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION '20261216a: BUGET_LOCK: rapoarte_zilnice / raport_zilnic_salvari / sites ocupate; % incercari, % ms de la BEGIN; nimic schimbat',
          v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
      END IF;
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  RAISE NOTICE '20261216a: lock-uri la % ms de la BEGIN (% incercari)', round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari;
END $lock$;

-- ── coloanele (constrângere cu nume explicit, diferit de cele automate de coloană); CHECK NOT VALID = fără scanare sub lock (vezi antetul) ──
ALTER TABLE public.rapoarte_zilnice
  ADD COLUMN rezumat_text text,
  ADD COLUMN rezumat_sursa text,
  ADD COLUMN rezumat_la timestamptz,
  ADD COLUMN rezumat_de uuid,
  ADD COLUMN rezumat_eroare text,
  ADD COLUMN rezumat_proiect_id bigint,
  ADD CONSTRAINT rapoarte_zilnice_rezumat_ck CHECK (
    ((rezumat_sursa IS NULL AND rezumat_text IS NULL AND rezumat_la IS NULL AND rezumat_de IS NULL AND rezumat_proiect_id IS NULL)
     OR (rezumat_sursa = 'automat' AND rezumat_text IS NOT NULL AND rezumat_la IS NOT NULL AND rezumat_de IS NULL)
     OR (rezumat_sursa = 'editat' AND rezumat_text ~ '[^[:space:]]' AND char_length(rezumat_text) <= 4000 AND rezumat_la IS NOT NULL AND rezumat_de IS NOT NULL)
     OR (rezumat_sursa = 'de_recompus' AND rezumat_text IS NULL AND rezumat_la IS NOT NULL AND rezumat_de IS NULL AND rezumat_proiect_id IS NULL))
    AND (rezumat_eroare IS NULL OR rezumat_eroare ~ '^[0-9A-Z]{5}$')) NOT VALID;
COMMENT ON COLUMN public.rapoarte_zilnice.rezumat_text IS
  'Rezumatul scurt al raportului (WhatsApp / director). Automat = fn_raport_rezumat_text, refăcut de server la fiecare salvare; editat = corectat de om, nu se suprascrie. 20261216a.';
COMMENT ON COLUMN public.rapoarte_zilnice.rezumat_sursa IS
  'automat / editat / de_recompus (r4: șantierul s-a mutat în alt proiect, textul vechi a fost scos; se reface la următoarea salvare sau la „Generează”). NULL = raport salvat înainte de 20261216a, încă fără rezumat. 20261216a.';
COMMENT ON COLUMN public.rapoarte_zilnice.rezumat_proiect_id IS
  'Proiectul șantierului pentru care s-a compus / corectat rezumatul (pus de server). Altul decât proiectul de acum al șantierului = rezumat de refăcut. 20261216a r4.';
COMMENT ON COLUMN public.rapoarte_zilnice.rezumat_la IS 'Când s-a schimbat ultima dată textul rezumatului (pus de server). 20261216a.';
COMMENT ON COLUMN public.rapoarte_zilnice.rezumat_de IS 'Cine a corectat rezumatul (auth.uid(), pus de server); NULL la automat. 20261216a.';
COMMENT ON COLUMN public.rapoarte_zilnice.rezumat_eroare IS
  'SQLSTATE-ul ultimei compuneri automate eșuate (raportul s-a salvat, rezumatul a rămas cel de dinainte); NULL = ultima a reușit. Pus de server. 20261216a.';

-- ── unelte de text: O SINGURĂ regulă (aceeași în src/raportRezumat.js: curata / trunchiaza / fmtNr / curataEditat) ──
-- un singur rând: caracterele de control (1–31, 127) -> spațiu, spațiile repetate -> unul, fără spații la capete
CREATE FUNCTION public.fn_raport_rezumat_curata(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN p IS NULL THEN '' ELSE
    btrim(regexp_replace(regexp_replace(p, '[' || chr(1) || '-' || chr(31) || chr(127) || ']+', ' ', 'g'), ' {2,}', ' ', 'g'), ' ') END
$f$;
REVOKE ALL ON FUNCTION public.fn_raport_rezumat_curata(text) FROM PUBLIC, anon, authenticated, service_role;

-- textul corectat de om (r3): aceleași caractere de control ca mai sus -> spațiu, DAR rândul nou rămâne (CR / CRLF -> LF); nimic altceva
CREATE FUNCTION public.fn_raport_rezumat_curata_editat(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN p IS NULL THEN NULL ELSE
    regexp_replace(replace(replace(p, chr(13) || chr(10), chr(10)), chr(13), chr(10)),
                   '[' || chr(1) || '-' || chr(9) || chr(11) || '-' || chr(31) || chr(127) || ']', ' ', 'g') END
$f$;
REVOKE ALL ON FUNCTION public.fn_raport_rezumat_curata_editat(text) FROM PUBLIC, anon, authenticated, service_role;

-- cel mult n caractere, tăiat la ultimul spațiu (cuvânt unic mai lung = tăiat la n), cu „…”
CREATE FUNCTION public.fn_raport_rezumat_taie(p text, n integer) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE t text := public.fn_raport_rezumat_curata(p); c text; i integer;
BEGIN
  IF length(t) <= n THEN RETURN t; END IF;
  c := left(t, n + 1);
  i := CASE WHEN strpos(c, ' ') = 0 THEN 0 ELSE length(c) - strpos(reverse(c), ' ') + 1 END;
  RETURN CASE WHEN i > 1 THEN left(c, i - 1) ELSE left(t, n) END || '…';
END $f$;
REVOKE ALL ON FUNCTION public.fn_raport_rezumat_taie(text, integer) FROM PUBLIC, anon, authenticated, service_role;

-- un șir JSON (alt tip = NULL: nu se interpretează); un număr JSON exact cum e, cu virgulă zecimală (alt tip = NULL)
CREATE FUNCTION public.fn_raport_rezumat_sir(j jsonb, k text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN jsonb_typeof(j -> k) = 'string' THEN j ->> k END
$f$;
REVOKE ALL ON FUNCTION public.fn_raport_rezumat_sir(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.fn_raport_rezumat_nr(j jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN jsonb_typeof(j) = 'number' THEN replace(trim_scale((j #>> '{}')::numeric)::text, '.', ',') END
$f$;
REVOKE ALL ON FUNCTION public.fn_raport_rezumat_nr(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ── textul rezumatului (oglinda lui rezumatRaport din src/raportRezumat.js; cifrele copiate, câmp lipsă = bucata lipsește) ──
CREATE FUNCTION public.fn_raport_rezumat_text(p jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE
  x jsonb := CASE WHEN jsonb_typeof(p) = 'object' THEN p ELSE '{}'::jsonb END;
  v_out text[] := ARRAY[]::text[];
  s text; pr text; d text; m jsonb; mp text[] := ARRAY[]::text[]; al text;
  ps jsonb; cat text[]; v_oam text := ''; u jsonb; nef text[]; v_ut text := ''; v_pz text := ''; ech text[];
  l jsonb; cod text; nume text; et text; act text; buc text; c text; um text; k integer;
  grp_et text[] := ARRAY[]::text[]; grp_b text[] := ARRAY[]::text[];
  di jsonb; dp text[] := ARRAY[]::text[]; t text; pb text[];
  -- comparația numelor fără diacritice / majuscule: DOAR literele românești + A–Z (aceeași hartă în JS, ca rezultatul să nu depindă de colație)
  c_din constant text := 'ĂÂÎȘŞȚŢăâîșşțţABCDEFGHIJKLMNOPQRSTUVWXYZ';
  c_in constant text := 'aaissttaaissttabcdefghijklmnopqrstuvwxyz';
  -- r3: plafonul total al textului automat (aceeași valoare și același sufix în JS: MAX_AUTOMAT / SUFIX_SCURTAT)
  c_max constant integer := 3000;
  c_sufix constant text := chr(10) || '… (rezumat scurtat; restul în raport)';
BEGIN
  -- 1. un singur nume: șantierul (sites.name, scurtat la 80); proiectul doar dacă numele lui NU e deja în numele șantierului
  --    (fără diacritice / majuscule), scurtat la 60; data; vremea (temperatura la grad întreg)
  s := public.fn_raport_rezumat_curata(public.fn_raport_rezumat_sir(x, 'santier'));
  pr := public.fn_raport_rezumat_curata(public.fn_raport_rezumat_sir(x, 'proiect'));
  pr := CASE WHEN pr = '' OR strpos(translate(s, c_din, c_in), translate(pr, c_din, c_in)) > 0 THEN ''
             ELSE public.fn_raport_rezumat_taie(pr, 60) END;
  s := public.fn_raport_rezumat_taie(s, 80);
  d := CASE WHEN jsonb_typeof(x -> 'data') = 'string' AND (x ->> 'data') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            THEN substr(x ->> 'data', 9, 2) || '.' || substr(x ->> 'data', 6, 2) || '.' || substr(x ->> 'data', 1, 4) ELSE '' END;
  m := x -> 'meteo';
  IF jsonb_typeof(m) = 'object' THEN
    -- round(numeric) = jumătatea departe de zero (8,5 -> 9; -2,5 -> -3), ca în JS
    IF jsonb_typeof(m -> 'temp') = 'number' THEN mp := mp || (round((m ->> 'temp')::numeric)::text || ' °C'); END IF;
    IF jsonb_typeof(m -> 'precip_mm') = 'number' AND (m ->> 'precip_mm')::numeric > 0 THEN
      mp := mp || ('precipitații ' || public.fn_raport_rezumat_nr(m -> 'precip_mm') || ' mm');
    END IF;
    IF jsonb_typeof(m -> 'alerte') = 'array' THEN
      SELECT string_agg(w.z, ', ' ORDER BY w.o) INTO al
        FROM (SELECT public.fn_raport_rezumat_curata(CASE WHEN jsonb_typeof(q.a) = 'string' THEN q.a #>> '{}' END) AS z, q.o
                FROM jsonb_array_elements(m -> 'alerte') WITH ORDINALITY q(a, o)) w
       WHERE w.z <> '';
      IF al IS NOT NULL THEN mp := mp || ('alerte: ' || al); END IF;
    END IF;
  END IF;
  v_out := v_out || (coalesce(nullif(s, ''), 'Raport zilnic')
                     || CASE WHEN pr <> '' THEN ' (proiect ' || pr || ')' ELSE '' END
                     || CASE WHEN d <> '' THEN ' · ' || d ELSE '' END
                     || CASE WHEN cardinality(mp) > 0 THEN ' · ' || array_to_string(mp, ', ') ELSE '' END);
  -- 2. oameni · utilaje · poze
  ps := x -> 'personal';
  IF jsonb_typeof(ps) = 'object' THEN
    SELECT array_agg(ct.l || ' ' || public.fn_raport_rezumat_nr(ps -> ct.k) ORDER BY ct.o) INTO cat
      FROM (VALUES (1, 'sudori', 'sudori'), (2, 'lacatusi', 'lăcătuși'), (3, 'operatori', 'operatori utilaje'), (4, 'soferi', 'șoferi'),
                   (5, 'necalificati', 'necalificați'), (6, 'tesa', 'TESA'), (7, 'altii', 'alții')) ct(o, k, l)
     WHERE jsonb_typeof(ps -> ct.k) = 'number' AND (ps ->> ct.k)::numeric > 0;
    IF jsonb_typeof(ps -> 'total') = 'number' THEN
      v_oam := 'Oameni: ' || public.fn_raport_rezumat_nr(ps -> 'total') || CASE WHEN cat IS NOT NULL THEN ' (' || array_to_string(cat, ', ') || ')' ELSE '' END;
    ELSIF cat IS NOT NULL THEN
      v_oam := 'Oameni: ' || array_to_string(cat, ', ');
    END IF;
  END IF;
  u := x -> 'utilaje';
  IF jsonb_typeof(u) = 'array' AND jsonb_array_length(u) > 0 THEN
    SELECT array_agg(CASE WHEN w.mo <> '' THEN w.den || ' – ' || w.mo ELSE w.den END ORDER BY w.o) INTO nef
      FROM (SELECT q.o,
                   coalesce(nullif(public.fn_raport_rezumat_curata(public.fn_raport_rezumat_sir(q.e, 'nume')), ''),
                            nullif(public.fn_raport_rezumat_curata(public.fn_raport_rezumat_sir(q.e, 'cod')), ''), 'fără denumire') AS den,
                   public.fn_raport_rezumat_taie(public.fn_raport_rezumat_sir(q.e, 'motiv'), 80) AS mo
              FROM jsonb_array_elements(u) WITH ORDINALITY q(e, o)
             WHERE jsonb_typeof(q.e) = 'object' AND public.fn_raport_rezumat_sir(q.e, 'stare') = 'nefunctional') w;
    -- nefuncționale: numărul lor + cel mult primele 3 (în ordinea din raport), apoi „+N”
    v_ut := 'Utilaje: ' || jsonb_array_length(u)
            || CASE WHEN nef IS NOT NULL THEN ' (nefuncționale ' || cardinality(nef) || ': ' || array_to_string(nef[1:3], '; ')
                    || CASE WHEN cardinality(nef) > 3 THEN '; +' || (cardinality(nef) - 3) ELSE '' END || ')' ELSE '' END;
  END IF;
  IF jsonb_typeof(x -> 'poze') = 'number' AND (x ->> 'poze')::numeric > 0 THEN v_pz := 'Poze: ' || public.fn_raport_rezumat_nr(x -> 'poze'); END IF;
  ech := array_remove(ARRAY[v_oam, v_ut, v_pz], '');
  IF cardinality(ech) > 0 THEN v_out := v_out || array_to_string(ech, ' · '); END IF;
  -- 3. lucrările cu cantități, pe obiecte, în ordinea primei apariții; distribuția
  IF jsonb_typeof(x -> 'linii') = 'array' THEN
    FOR l IN SELECT q.e FROM jsonb_array_elements(x -> 'linii') WITH ORDINALITY q(e, o) ORDER BY q.o LOOP
      CONTINUE WHEN jsonb_typeof(l) IS DISTINCT FROM 'object';
      cod := public.fn_raport_rezumat_curata(public.fn_raport_rezumat_sir(l, 'obiect_cod'));
      nume := public.fn_raport_rezumat_curata(public.fn_raport_rezumat_sir(l, 'obiect_nume'));
      et := CASE WHEN cod <> '' AND nume <> '' THEN cod || ' · ' || nume ELSE coalesce(nullif(cod, ''), nume) END;
      act := coalesce(nullif(public.fn_raport_rezumat_curata(public.fn_raport_rezumat_sir(l, 'activitate')), ''), 'activitate');
      IF l -> 'bifa' = 'true'::jsonb THEN
        buc := act || ' (efectuat)';
      ELSE
        c := public.fn_raport_rezumat_nr(l -> 'cantitate');
        um := public.fn_raport_rezumat_curata(public.fn_raport_rezumat_sir(l, 'um'));
        buc := CASE WHEN c IS NULL THEN act || ' (fără cantitate)' ELSE act || ' ' || c || CASE WHEN um <> '' THEN ' ' || um ELSE '' END END;
      END IF;
      k := array_position(grp_et, et);
      IF k IS NULL THEN grp_et := grp_et || et; grp_b := grp_b || buc; ELSE grp_b[k] := grp_b[k] || '; ' || buc; END IF;
    END LOOP;
  END IF;
  FOR k IN 1 .. coalesce(cardinality(grp_et), 0) LOOP
    v_out := v_out || (CASE WHEN grp_et[k] <> '' THEN 'Lucrări ' || grp_et[k] ELSE 'Lucrări' END || ': ' || grp_b[k]);
  END LOOP;
  di := x -> 'distributie';
  IF jsonb_typeof(di) = 'object' THEN
    IF jsonb_typeof(di -> 'conducte') = 'number' AND (di ->> 'conducte')::numeric > 0 THEN dp := dp || ('conducte ' || public.fn_raport_rezumat_nr(di -> 'conducte')); END IF;
    IF jsonb_typeof(di -> 'bransamente') = 'number' AND (di ->> 'bransamente')::numeric > 0 THEN dp := dp || ('branșamente ' || public.fn_raport_rezumat_nr(di -> 'bransamente')); END IF;
    IF cardinality(dp) > 0 THEN v_out := v_out || ('Distribuție gaze (rânduri): ' || array_to_string(dp, ', ')); END IF;
  END IF;
  -- 4. textul liber al lucrărilor (detalii, dacă există și cantități)
  t := public.fn_raport_rezumat_taie(public.fn_raport_rezumat_sir(x, 'lucrari'), 240);
  IF t <> '' THEN v_out := v_out || (CASE WHEN cardinality(grp_et) > 0 THEN 'Detalii' ELSE 'Lucrări' END || ': ' || t); END IF;
  -- 4b. subcontractorii (ce au lucrat azi), dacă rubrica e completată
  t := public.fn_raport_rezumat_taie(public.fn_raport_rezumat_sir(x, 'subcontractori'), 200);
  IF t <> '' THEN v_out := v_out || ('Subcontractori: ' || t); END IF;
  -- 5. probleme · mașini
  pb := array_remove(ARRAY[
          CASE WHEN public.fn_raport_rezumat_taie(public.fn_raport_rezumat_sir(x, 'probleme'), 240) <> ''
               THEN 'Probleme: ' || public.fn_raport_rezumat_taie(public.fn_raport_rezumat_sir(x, 'probleme'), 240) END,
          CASE WHEN public.fn_raport_rezumat_taie(public.fn_raport_rezumat_sir(x, 'masini'), 160) <> ''
               THEN 'Mașini: ' || public.fn_raport_rezumat_taie(public.fn_raport_rezumat_sir(x, 'masini'), 160) END], NULL);
  IF cardinality(pb) > 0 THEN v_out := v_out || array_to_string(pb, ' · '); END IF;
  -- 6. aprovizionarea cerută și planul pentru mâine, fiecare doar dacă e completat (textul omului, nimic dedus)
  t := public.fn_raport_rezumat_taie(public.fn_raport_rezumat_sir(x, 'aprovizionare'), 160);
  IF t <> '' THEN v_out := v_out || ('Aprovizionare: ' || t); END IF;
  t := public.fn_raport_rezumat_taie(public.fn_raport_rezumat_sir(x, 'plan_maine'), 200);
  IF t <> '' THEN v_out := v_out || ('Plan pentru mâine: ' || t); END IF;
  -- 7. r3: plafonul total — peste c_max: rândurile întregi care încap înaintea sufixului (un prim rând mai lung = tăiat), apoi sufixul
  t := array_to_string(v_out, chr(10));
  IF length(t) > c_max THEN
    c := left(t, c_max - length(c_sufix));
    k := strpos(reverse(c), chr(10));
    IF k > 0 AND length(c) - k > 0 THEN c := left(c, length(c) - k); END IF;
    t := c || c_sufix;
  END IF;
  RETURN t;
END $f$;
REVOKE ALL ON FUNCTION public.fn_raport_rezumat_text(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ── intrarea rezumatului, din rândul raportului (NEW în trigger) + liniile / distribuția lui de acum ──
-- r3: DOAR ce ține de raport, de șantierul lui și de proiectul ȘANTIERULUI (o linie / activitate / obiect al altui proiect nu intră).
-- Blocul INTRARE e copiat IDENTIC în scripts/raport_rezumat_proba.sql și scripts/raport_rezumat_vizibilitate.sql (testul src/raportRezumat.test.js verifică).
CREATE FUNCTION public.fn_raport_rezumat_intrare(z public.rapoarte_zilnice) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT
    -- INTRARE-START
    jsonb_build_object(
      'santier', (SELECT s.name FROM public.sites s WHERE s.id = z.site_id),
      'proiect', (SELECT p.nume FROM public.sites s JOIN public.executie_proiecte p ON p.id = s.proiect_id WHERE s.id = z.site_id),
      'data', to_char(z.data, 'YYYY-MM-DD'),
      'meteo', z.meteo,
      'personal', z.personal_snapshot,
      'utilaje', z.utilaje_snapshot,
      'linii', (SELECT coalesce(jsonb_agg(jsonb_build_object('obiect_cod', pu.cod, 'obiect_nume', pu.nume, 'activitate', pa.nume, 'um', pa.um,
                                                             'cantitate', rl.cantitate, 'bifa', coalesce(pa.tip_raportare, 'cantitate') = 'bifa')
                                          ORDER BY (rl.unitate_id IS NOT NULL), pu.ordine, pu.id, pa.ordine, pa.id, rl.id), '[]'::jsonb)
                  FROM public.raport_lucrari rl
                  JOIN public.sites sp ON sp.id = z.site_id
                  LEFT JOIN public.proiect_activitati pa ON pa.id = rl.activitate_id
                  LEFT JOIN public.proiect_unitati pu ON pu.id = rl.unitate_id
                 WHERE rl.raport_id = z.id
                   AND (rl.proiect_id IS NULL OR rl.proiect_id = sp.proiect_id)
                   AND (pa.id IS NULL OR pa.proiect_id = sp.proiect_id)
                   AND (pu.id IS NULL OR pu.proiect_id = sp.proiect_id)),
      'distributie', (SELECT CASE WHEN count(*) = 0 THEN NULL
                                  ELSE jsonb_build_object('conducte', count(*) FILTER (WHERE d.tabel = 'conducta'),
                                                          'bransamente', count(*) FILTER (WHERE d.tabel = 'bransament')) END
                        FROM public.raport_distributie_linii d WHERE d.raport_id = z.id),
      'lucrari', z.lucrari_efectuate,
      'probleme', z.probleme,
      'masini', z.masini,
      'subcontractori', z.subcontractori,
      'aprovizionare', z.aprovizionare,
      'plan_maine', z.plan_maine,
      'poze', cardinality(z.poze))
    -- INTRARE-END
$f$;
REVOKE ALL ON FUNCTION public.fn_raport_rezumat_intrare(public.rapoarte_zilnice) FROM PUBLIC, anon, authenticated, service_role;

-- ── garda + generarea, pe ORICE scriere a antetului (L07). DEFINER: citește liniile / numele ca proprietar (aceeași imagine pentru oricine)
--    și cheamă fn_raport_santier_drept (fără EXECUTE pentru clienți). Nu e apelabilă din API (trigger, fără EXECUTE). ──
-- Ramurile: (1) INSERT = automat; (2) scriere FĂRĂ schimbarea rezumatului = refacere automată (editat rămâne); (3) cerere 'editat' = corectura
-- omului (identitate + drept); (4) cerere 'automat' = (re)generare (peste o corectură: identitate + drept). Compunerea (1)(2)(4) e izolată:
-- pe (1)(2) eroarea ei NU anulează scrierea raportului (rezumat_eroare = SQLSTATE), pe (4) e eroare către om.
-- r4: (2') pe o scriere fără rezumat, un rezumat compus / corectat pentru ALT proiect decât cel de acum al șantierului (șantier mutat — calea
-- trigger-ului de pe sites —, raport mutat pe alt șantier) = automat -> 'de_recompus' fără compunere; editat -> refuz 55000.
-- r5 (Jakarinos r4 P1): proiectul șantierului se citește cu FOR SHARE pe rândul lui, ÎNAINTEA oricărei ramuri (compunere, corectură,
-- invalidare), și lock-ul ține până la COMMIT. Nu depinde de imaginea tranzacției:
--   * READ COMMITTED: o mutare în zbor (UPDATE pe rândul șantierului, FOR NO KEY UPDATE) e așteptată, apoi se citește proiectul NOU; o mutare
--     care începe după nu poate trece până nu se termină scrierea de aici (FOR SHARE intră în conflict cu UPDATE-ul lui proiect_id);
--   * REPEATABLE READ / SERIALIZABLE: dacă rândul șantierului s-a schimbat după imaginea tranzacției, FOR SHARE dă eroare de serializare
--     (40001), deci nimic nu se compune pe proiectul din imagine; dacă nu s-a schimbat, proiectul din imagine = cel curent și rămâne așa.
--   Intrarea (fn_raport_rezumat_intrare) citește apoi același rând, deja blocat: același proiect.
-- Ordinea lock-urilor (L06), pe toate căile: rândul raportului (RPC-ul de salvare îl ia primul, FOR UPDATE) -> rândul șantierului (aici, FOR
--   SHARE). Mutarea ia rândul șantierului și NU așteaptă niciun rând de raport cât îl ține (NOWAIT, vezi fn_raport_rezumat_santier_mutat),
--   deci nu se poate închide un ciclu. FK-ul raportului (FOR KEY SHARE) și FOR SHARE-urile mai multor salvări sunt compatibile între ele:
--   salvările nu se așteaptă una pe alta, nici pe alte șantiere.
CREATE FUNCTION public.fn_raport_rezumat_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_text text; v_cerere boolean := false; v_om boolean := false; v_stare text; v_proiect bigint;
  v_cols text[] := ARRAY['versiune_salvare', 'rezumat_text', 'rezumat_sursa', 'rezumat_la', 'rezumat_de', 'rezumat_eroare', 'rezumat_proiect_id'];
BEGIN
  -- codul erorii derivatului și proiectul rezumatului le scrie DOAR serverul (L08): ce trimite clientul nu contează
  NEW.rezumat_eroare := CASE WHEN TG_OP = 'UPDATE' THEN OLD.rezumat_eroare END;
  NEW.rezumat_proiect_id := CASE WHEN TG_OP = 'UPDATE' THEN OLD.rezumat_proiect_id END;
  -- proiectul ȘANTIERULUI de acum (NULL = șantier fără proiect sau inexistent), cu rândul șantierului blocat până la COMMIT (r5, vezi sus)
  SELECT s.proiect_id INTO v_proiect FROM public.sites s WHERE s.id = NEW.site_id FOR SHARE OF s;
  IF TG_OP = 'INSERT' THEN
    -- raport nou: rezumatul automat (o corectură se face doar pe un raport existent); ce a trimis clientul nu contează (L08)
    NEW.rezumat_sursa := 'automat';
  ELSIF (NEW.rezumat_text, NEW.rezumat_sursa, NEW.rezumat_la, NEW.rezumat_de)
        IS NOT DISTINCT FROM (OLD.rezumat_text, OLD.rezumat_sursa, OLD.rezumat_la, OLD.rezumat_de) THEN
    -- r4: rezumatul e pentru alt proiect decât cel de acum al șantierului: textul vechi nu mai rămâne pe raport
    IF OLD.rezumat_sursa IN ('automat', 'editat') AND OLD.rezumat_proiect_id IS DISTINCT FROM v_proiect THEN
      IF OLD.rezumat_sursa = 'editat' THEN
        RAISE EXCEPTION 'rezumat: raportul are rezumatul corectat de om pentru alt proiect; „Revino la automat” pe el înainte de mutare'
          USING ERRCODE = '55000';
      END IF;
      NEW.rezumat_text := NULL; NEW.rezumat_sursa := 'de_recompus'; NEW.rezumat_la := now(); NEW.rezumat_de := NULL;
      NEW.rezumat_proiect_id := NULL; NEW.rezumat_eroare := NULL;
      -- doar derivatul s-a schimbat: versiunea rămâne (ca la refacerea automată)
      IF (to_jsonb(NEW) - v_cols) = (to_jsonb(OLD) - v_cols) THEN NEW.versiune_salvare := OLD.versiune_salvare; END IF;
      RETURN NEW;
    END IF;
    -- scriere fără rezumat (RPC-ul de salvare, telefonul vechi, alte module): textul corectat de om rămâne; altfel se reface
    IF OLD.rezumat_sursa = 'editat' THEN RETURN NEW; END IF;
    NEW.rezumat_sursa := 'automat';
  ELSIF NEW.rezumat_sursa = 'editat' THEN
    -- corectura omului: identitatea e obligatorie (r3, L08: fără UID = refuz, nicio cale de server nu corectează în locul unui om)
    -- și dreptul pe șantier (aceeași regulă ca salvarea, L19)
    IF v_uid IS NULL OR public.fn_raport_santier_drept(NEW.site_id::bigint) IS NOT TRUE THEN
      RAISE EXCEPTION 'rezumat: nu ai drept de scriere pe raportul acestui șantier' USING ERRCODE = '42501';
    END IF;
    -- r3: aceleași caractere de control ca la textul automat (rândul nou rămâne), APOI validarea
    NEW.rezumat_text := public.fn_raport_rezumat_curata_editat(NEW.rezumat_text);
    IF NEW.rezumat_text IS NULL OR NEW.rezumat_text !~ '[^[:space:]]' THEN
      RAISE EXCEPTION 'rezumat: textul corectat nu poate fi gol (pentru textul automat: rezumat_sursa = automat)' USING ERRCODE = '22023';
    END IF;
    IF char_length(NEW.rezumat_text) > 4000 THEN
      RAISE EXCEPTION 'rezumat: textul corectat are % caractere (maximum 4000)', char_length(NEW.rezumat_text) USING ERRCODE = '22023';
    END IF;
    NEW.rezumat_la := now();
    NEW.rezumat_de := v_uid;
    NEW.rezumat_eroare := NULL;
    NEW.rezumat_proiect_id := v_proiect;   -- r4: corectura e scrisă pentru proiectul de acum al șantierului
    RETURN NEW;   -- versiunea crește (trigger-ul de versiune): corectura e o decizie a omului
  ELSIF NEW.rezumat_sursa = 'automat' THEN
    -- cerere de (re)generare; textul îl scrie serverul (mai jos). r4: din 'de_recompus' = ca din NULL (generare, fără identitate)
    v_cerere := true;
    IF OLD.rezumat_sursa = 'editat' THEN
      -- „Revino la automat”: peste un text corectat de om, aceeași identitate + drept; e o decizie a omului => versiunea crește (r3)
      IF v_uid IS NULL OR public.fn_raport_santier_drept(NEW.site_id::bigint) IS NOT TRUE THEN
        RAISE EXCEPTION 'rezumat: nu ai drept de scriere pe raportul acestui șantier' USING ERRCODE = '42501';
      END IF;
      v_om := true;
    END IF;
  ELSE
    -- (r4: și 'de_recompus' cerut de client: starea o pune doar serverul, la mutare)
    RAISE EXCEPTION 'rezumat: sursa rezumatului trebuie să fie automat sau editat' USING ERRCODE = '22023';
  END IF;
  -- textul automat: din câmpurile raportului (NEW) și liniile / distribuția lui de acum. Sub-tranzacție (r3): eroarea derivatului nu
  -- ajunge la scrierea raportului (WHEN OTHERS nu prinde anulările: statement_timeout / plafonul opresc tot, ca azi)
  BEGIN
    v_text := public.fn_raport_rezumat_text(public.fn_raport_rezumat_intrare(NEW));
    IF v_text IS NULL THEN RAISE EXCEPTION 'rezumat: textul automat a iesit NULL' USING ERRCODE = '22004'; END IF;
  EXCEPTION WHEN OTHERS THEN
    IF v_cerere THEN RAISE; END IF;   -- cererea explicită de rezumat: omul vede eroarea (nu are altceva de salvat)
    GET STACKED DIAGNOSTICS v_stare = RETURNED_SQLSTATE;
    v_text := NULL;
  END;
  IF v_text IS NULL THEN
    -- scrierea RAPORTULUI trece; rezumatul rămâne cum era (raport nou: fără rezumat); doar codul erorii (fără text / valori din surse)
    -- (r4: OLD e aici pentru proiectul de acum sau fără text — rezumatul pentru alt proiect a ieșit mai sus, fără compunere)
    IF TG_OP = 'INSERT' THEN
      NEW.rezumat_text := NULL; NEW.rezumat_sursa := NULL; NEW.rezumat_la := NULL; NEW.rezumat_de := NULL; NEW.rezumat_proiect_id := NULL;
    ELSE
      NEW.rezumat_text := OLD.rezumat_text; NEW.rezumat_sursa := OLD.rezumat_sursa; NEW.rezumat_la := OLD.rezumat_la; NEW.rezumat_de := OLD.rezumat_de;
      NEW.rezumat_proiect_id := OLD.rezumat_proiect_id;
    END IF;
    NEW.rezumat_eroare := v_stare;
  ELSE
    NEW.rezumat_la := CASE WHEN TG_OP = 'UPDATE' AND OLD.rezumat_sursa = 'automat' AND OLD.rezumat_text IS NOT DISTINCT FROM v_text
                           THEN OLD.rezumat_la ELSE now() END;
    NEW.rezumat_text := v_text;
    NEW.rezumat_de := NULL;
    NEW.rezumat_eroare := NULL;
    NEW.rezumat_proiect_id := v_proiect;   -- r4: proiectul pentru care s-a compus textul
  END IF;
  -- scriere care schimbă DOAR derivatul (rezumatul automat / codul erorii): versiunea rămâne (CAS-ul salvării, 20261208a);
  -- „Revino la automat” (v_om) e o decizie a omului: versiunea crește
  IF TG_OP = 'UPDATE' AND NOT v_om AND (to_jsonb(NEW) - v_cols) = (to_jsonb(OLD) - v_cols) THEN
    NEW.versiune_salvare := OLD.versiune_salvare;
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_raport_rezumat_garda() FROM PUBLIC, anon, authenticated, service_role;
-- „zz”: după trg_raport_zilnic_versiune (PostgreSQL rulează trigger-ele în ordinea numelui)
CREATE TRIGGER trg_raport_zilnic_zz_rezumat BEFORE INSERT OR UPDATE ON public.rapoarte_zilnice
  FOR EACH ROW EXECUTE FUNCTION public.fn_raport_rezumat_garda();

-- ── după salvarea prin RPC (jurnalul e scris ULTIMUL): rescrie rândul raportului FĂRĂ să-i schimbe rezumatul (r3), deci garda îl reface
--    pe ramura „scriere fără rezumat” (izolată: o eroare a derivatului nu anulează salvarea). Rulează ca apelantul inserției în jurnal
--    (doar RPC-ul DEFINER scrie acolo; clienții nu au niciun drept pe tabel). ──
CREATE FUNCTION public.fn_raport_rezumat_dupa_salvare() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  UPDATE public.rapoarte_zilnice SET rezumat_sursa = rezumat_sursa WHERE id = NEW.raport_id AND rezumat_sursa IS DISTINCT FROM 'editat';
  RETURN NULL;
END $f$;
REVOKE ALL ON FUNCTION public.fn_raport_rezumat_dupa_salvare() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_raport_zilnic_salvari_rezumat AFTER INSERT ON public.raport_zilnic_salvari
  FOR EACH ROW EXECUTE FUNCTION public.fn_raport_rezumat_dupa_salvare();

-- ── r4 (Jakarinos r3 P1): șantierul trece în alt proiect => în ACEEAȘI tranzacție, rezumatele compuse pentru proiectul vechi ies de pe
--    rapoartele lui (automat -> 'de_recompus', prin garda de mai sus; editat -> refuz, mutarea nu trece). DEFINER: vede și scrie toate
--    rapoartele șantierului, oricare ar fi RLS-ul celui care mută (trigger-ul de acces pe rapoarte îi verifică totuși dreptul pe proiect).
--    r5 (Jakarinos r4 P2): blocarea e DOAR pe șantierul mutat, nu pe tot tabelul — salvările celorlalte șantiere nu așteaptă mutarea.
--    Ordinea lock-urilor (L06): rândul șantierului (UPDATE-ul care a pornit trigger-ul; a așteptat, dacă era cazul, salvările în zbor pe
--    șantier, care țin FOR SHARE pe el din gardă) -> rândurile rapoartelor șantierului care trebuie schimbate, FOR NO KEY UPDATE NOWAIT,
--    în ordinea id-ului. NOWAIT: o salvare care a luat deja rândul raportului (FOR UPDATE, pasul 1 al RPC-ului) și urmează să ceară rândul
--    șantierului în gardă ar închide un ciclu dacă mutarea ar aștepta-o (lecția din PR #1045); așa, mutarea refuză imediat (55P03, nimic
--    schimbat, se reîncearcă), iar salvarea trece. Salvarea nu e oprită niciodată de regula asta.
--    Cât ține rândul șantierului, nicio scriere nouă de raport pe el nu trece de gardă, deci starea rezumatelor șantierului e înghețată: ce
--    blochează aici rămâne exact mulțimea de schimbat până la COMMIT. NO KEY: compatibil cu FOR KEY SHARE (FK-ul liniilor raportului).
--    READ COMMITTED obligatoriu: invalidarea trebuie să vadă și rapoartele comise după începutul tranzacției celui care mută. ──
CREATE FUNCTION public.fn_raport_rezumat_santier_mutat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_n integer; v_zile text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'rezumat: mutarea unui șantier în alt proiect cere READ COMMITTED (acum %)', current_setting('transaction_isolation')
      USING ERRCODE = '0A000';
  END IF;
  -- rândurile de schimbat / de verificat, blocate fără așteptare (vezi sus); citirile văd tot ce s-a comis (READ COMMITTED, instrucțiune nouă)
  BEGIN
    PERFORM 1 FROM public.rapoarte_zilnice r
     WHERE r.site_id = NEW.id AND r.rezumat_sursa IN ('automat', 'editat') AND r.rezumat_proiect_id IS DISTINCT FROM NEW.proiect_id
     ORDER BY r.id FOR NO KEY UPDATE OF r NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'rezumat: un raport al acestui șantier se salvează chiar acum; reîncearcă mutarea peste câteva secunde (nimic schimbat)'
      USING ERRCODE = '55P03';
  END;
  -- r5: refuzul spune câte rapoarte și din ce zile (primele 5, apoi „+N”), ca omul să știe unde apasă „Revino la automat”
  SELECT count(*)::integer, string_agg(to_char(x.data, 'DD.MM.YYYY'), ', ' ORDER BY x.data, x.id) FILTER (WHERE x.nr <= 5)
    INTO v_n, v_zile
    FROM (SELECT r.id, r.data, row_number() OVER (ORDER BY r.data, r.id) AS nr FROM public.rapoarte_zilnice r
           WHERE r.site_id = NEW.id AND r.rezumat_sursa = 'editat' AND r.rezumat_proiect_id IS DISTINCT FROM NEW.proiect_id) x;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'rezumat: șantierul are % cu rezumatul corectat de om pentru proiectul vechi (%); „Revino la automat” pe ele înainte de mutare',
      CASE WHEN v_n = 1 THEN 'un raport' WHEN v_n % 100 BETWEEN 1 AND 19 THEN v_n || ' rapoarte' ELSE v_n || ' de rapoarte' END,
      CASE WHEN v_n = 1 THEN 'ziua ' ELSE 'zilele ' END || v_zile || CASE WHEN v_n > 5 THEN ' +' || (v_n - 5) ELSE '' END
      USING ERRCODE = '55000';
  END IF;
  -- scriere „fără rezumat” pe rândurile vizate (deja blocate): garda le trece în 'de_recompus' (ramura 2'), fără compunere, fără să
  -- mărească versiunea
  UPDATE public.rapoarte_zilnice r SET rezumat_sursa = r.rezumat_sursa
   WHERE r.site_id = NEW.id AND r.rezumat_sursa = 'automat' AND r.rezumat_proiect_id IS DISTINCT FROM NEW.proiect_id;
  RETURN NULL;
END $f$;
REVOKE ALL ON FUNCTION public.fn_raport_rezumat_santier_mutat() FROM PUBLIC, anon, authenticated, service_role;
-- AFTER UPDATE (orice coloană) + WHEN pe rândul FINAL: prinde și un proiect_id schimbat de un trigger BEFORE al altui modul
CREATE TRIGGER trg_raport_rezumat_santier_mutat AFTER UPDATE ON public.sites
  FOR EACH ROW WHEN (OLD.proiect_id IS DISTINCT FROM NEW.proiect_id) EXECUTE FUNCTION public.fn_raport_rezumat_santier_mutat();

-- ── postcondiții ──
DO $post$
DECLARE v_fn name[] := ARRAY['fn_raport_rezumat_curata', 'fn_raport_rezumat_curata_editat', 'fn_raport_rezumat_taie', 'fn_raport_rezumat_sir',
                             'fn_raport_rezumat_nr', 'fn_raport_rezumat_text', 'fn_raport_rezumat_intrare', 'fn_raport_rezumat_garda',
                             'fn_raport_rezumat_dupa_salvare', 'fn_raport_rezumat_santier_mutat']::name[];
BEGIN
  -- coloanele: tipul, nullable, FĂRĂ valoare implicită și fără „missing value” => toate rândurile existente au NULL (migrarea nu scrie
  -- date — dovedit din catalog, fără să citească tabelul sub lock), fără drepturi proprii pe coloană
  IF (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.rapoarte_zilnice'::regclass AND NOT a.attisdropped
        AND NOT a.attnotnull AND NOT a.atthasdef AND NOT a.atthasmissing AND a.attacl IS NULL
        AND ((a.attname IN ('rezumat_text', 'rezumat_sursa', 'rezumat_eroare') AND a.atttypid = 'text'::regtype)
             OR (a.attname = 'rezumat_la' AND a.atttypid = 'timestamptz'::regtype)
             OR (a.attname = 'rezumat_de' AND a.atttypid = 'uuid'::regtype)
             OR (a.attname = 'rezumat_proiect_id' AND a.atttypid = 'bigint'::regtype))) <> 6
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.rapoarte_zilnice'::regclass AND conname = 'rapoarte_zilnice_rezumat_ck'
                     AND contype = 'c' AND NOT convalidated) THEN
    RAISE EXCEPTION '20261216a post: coloanele / constrangerea';
  END IF;
  -- funcțiile: search_path fix; DEFINER doar garda și (r4) mutarea șantierului; NICIUN EXECUTE pentru clienți (nu sunt apelabile din API)
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = ANY (v_fn)) <> 10
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_raport\_rezumat\_%') <> 10
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = ANY (v_fn)
                   AND (p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                        OR p.prosecdef IS DISTINCT FROM (p.proname IN ('fn_raport_rezumat_garda', 'fn_raport_rezumat_santier_mutat'))
                        OR pg_get_userbyid(p.proowner) <> 'postgres'
                        OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                        OR has_function_privilege('service_role', p.oid, 'EXECUTE')
                        OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0))) THEN
    RAISE EXCEPTION '20261216a post: functii (definer / search_path / owner / EXECUTE)';
  END IF;
  -- trigger-ele: exact forma (L15) și ordinea (garda rezumatului DUPĂ versiune)
  IF NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.rapoarte_zilnice'::regclass AND tg.tgname = 'trg_raport_zilnic_zz_rezumat'
                   AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = 'public.fn_raport_rezumat_garda()'::regprocedure
                   AND tg.tgtype = (1 | 2 | 4 | 16))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.raport_zilnic_salvari'::regclass AND tg.tgname = 'trg_raport_zilnic_salvari_rezumat'
                   AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = 'public.fn_raport_rezumat_dupa_salvare()'::regprocedure
                   AND tg.tgtype = (1 | 4))   -- ROW, AFTER, INSERT
     -- r4: pe sites, AFTER UPDATE pe rând, toate coloanele, cu condiția exactă pe proiect_id
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.sites'::regclass AND tg.tgname = 'trg_raport_rezumat_santier_mutat'
                   AND tg.tgenabled = 'O' AND tg.tgnargs = 0 AND tg.tgfoid = 'public.fn_raport_rezumat_santier_mutat()'::regprocedure
                   AND tg.tgtype = (1 | 16) AND tg.tgattr = ''::int2vector AND tg.tgqual IS NOT NULL
                   AND pg_get_triggerdef(tg.oid) = 'CREATE TRIGGER trg_raport_rezumat_santier_mutat AFTER UPDATE ON public.sites FOR EACH ROW '
                       || 'WHEN ((old.proiect_id IS DISTINCT FROM new.proiect_id)) EXECUTE FUNCTION fn_raport_rezumat_santier_mutat()')
     OR (SELECT count(*) FROM pg_trigger tg WHERE tg.tgfoid = 'public.fn_raport_rezumat_santier_mutat()'::regprocedure) <> 1
     OR NOT ('trg_raport_zilnic_versiune' COLLATE "C" < 'trg_raport_zilnic_zz_rezumat' COLLATE "C") THEN
    RAISE EXCEPTION '20261216a post: trigger-ele';
  END IF;
  -- textul: un caz cu diacritice, amprenta UTF-8 a rezultatului (prinde și o codare greșită a fișierului la aplicare)
  -- (proiectul „ș” e ascuns doar dacă harta diacriticelor s-a citit corect: altfel textul are „(proiect …)” și amprenta diferă)
  IF md5(convert_to(public.fn_raport_rezumat_text(jsonb_build_object('santier', 'Ș', 'proiect', 'ș', 'data', '2026-01-02',
           'personal', jsonb_build_object('lacatusi', 2, 'total', 2), 'probleme', 'a' || chr(9) || 'b')), 'UTF8')) <> 'eb4f44e7d61bfc57dd33cc2b7e2d37d0'
     OR public.fn_raport_rezumat_text('{}'::jsonb) <> 'Raport zilnic'
     OR public.fn_raport_rezumat_curata_editat('a' || chr(13) || chr(10) || 'b' || chr(9) || 'c' || chr(127)) <> 'a' || chr(10) || 'b c ' THEN
    RAISE EXCEPTION '20261216a post: textul rezumatului difera de cel asteptat (codarea fisierului?)';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261216a_executie_raport_rezumat:' || txid_current() THEN
    RAISE EXCEPTION '20261216a: garda final invalida';
  END IF;
END $post$;

-- L15 (r3): aceeași amprentă DUPĂ schimbare (cu excepțiile declarate), timpul, apoi funcțiile pg_temp se șterg
DO $l15_dupa$ BEGIN
  PERFORM pg_temp.amp_verifica_20261216a('dupa');
  RAISE NOTICE '20261216a: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $l15_dupa$;
DROP FUNCTION pg_temp.amp_verifica_20261216a(text), pg_temp.amp_calc_20261216a(), pg_temp.amp_baseline_20261216a();
