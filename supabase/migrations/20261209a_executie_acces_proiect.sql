-- Version 20261209120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261209a_executie_acces_proiect — Execuție: acces pe PROIECT (decizia lui Răzvan, 10.11.2026). Un șef de șantier vede și scrie în Execuție
-- doar proiectele lui (ex. Lot 1 + Lot 2), lista se extinde ulterior. r2: inventarul complet (review r1 NO-GO). r3: clasificarea întregului
-- catalog al clonei schemei de producție (tabele, vederi, funcții SECURITY DEFINER) + poarta pe proiect în fn_executie_swap_tevi_pozitie.
--
-- Regula (o singură definiție, L19):
--   * cont FĂRĂ niciun rând în executie_acces_proiect = ca azi (vede / scrie ce îi dă modulul);
--   * cont CU cel puțin un rând = doar proiectele listate; nivel 'viewer' = doar citire pe acel proiect, 'editor' = citire + scriere
--     (în limita dreptului pe modul: un 'editor' pe proiect cu modulul 'viewer' tot nu scrie);
--   * owner (profiles.is_owner) = tot, indiferent de rânduri.
--   „Restrâns” e decis într-un singur loc, fn_executie_acces_nerestrans() (varianta B — bifă explicită „restrâns” pe cont — schimbă doar
--   această funcție și RPC-ul de setare). fn_executie_acces_lista(scriere) = proiectele permise; fn_executie_proiect_permis(proiect, scriere)
--   = nerestrans OR proiect în listă. Politicile le folosesc în forma „(SELECT …)” (o evaluare pe interogare, nu pe rând).
--
-- INVENTARUL (r2): o SINGURĂ listă, fn_executie_acces_inventar(), din care se trag preflight-ul, politicile, postcondițiile și revenirea.
--   Fiecare obiect care ajunge la un proiect de Execuție are o clasă:
--     tabel  'proiect' — coloana `cheie` e proiectul: 4 politici RESTRICTIVE + trigger BEFORE INSERT/UPDATE/DELETE pe OLD și NEW;
--     tabel  'copil'   — proiectul vine din părinte (`parinte`: sl | bon | pachet | raport | cumulat | activitate): la fel, politicile cu
--                        setul părinților permiși (o evaluare pe interogare, nu pe rând — review r1 P2 N+1);
--     tabel  'drept'   — are deja funcția lui de drept (20261201a–20261211a), căreia i se adaugă condiția de proiect (direct sau prin
--                        funcția la care delegă); poate lipsi (migrarea lui încă neaplicată), dar dacă există, funcția lui trebuie să existe;
--     tabel  'exclus' / 'prefix_tabel' — alt modul, cu dreptul lui; motivul și riscul sunt scrise (decizie pentru Răzvan, nu omisiune);
--     tabel  'comun'   — dimensiune comună (cont, angajat, alocare pe șantier…): NU ajunge la date de proiect; afirmația se VERIFICĂ
--                        (refuz dacă tabelul are o coloană întreagă proiect_id sau o cheie străină spre executie_proiecte / un tabel acoperit);
--     functie 'drept' | 'verifica' | 'garda' | 'delega' | 'poarta' | 'exclus' — SECURITY DEFINER apelabile din API care ating tabelele de
--                        mai sus, fiecare cu amprenta corpului revizuit (L15): drept = funcția de drept (înlocuită aici); verifica = cheamă
--                        o funcție de drept pe proiectul fiecărui id; garda = doar scrie în tabele acoperite (trigger-ul de gardă o oprește)
--                        și nu întoarce date ale altor proiecte; delega = funcție de drept care doar cheamă una înlocuită aici (poate
--                        lipsi); poarta = funcție creată direct în BD, fără condiția de proiect: migrarea îi pune poarta (vezi 6b);
--                        exclus = alt modul (motivul: ce citește / întoarce, cu ce drept); bucket 'cale' | 'tabel' | 'drept' | 'exclus'.
--   Nu mai există excluderi de funcții pe prefix (r3): fiecare funcție găsită are numele și amprenta ei în listă.
--   Preflight-ul derivă din CATALOG (nu din listă) ce ajunge la un proiect și REFUZĂ orice obiect neclasificat, cu numele lui:
--     tabelele legate prin FK (tranzitiv) de executie_proiecte sau cu o coloană întreagă proiect_id; vederile (și vederile peste vederi)
--     peste tabelele acoperite care nu sunt security_invoker (sau sunt materializate) și pe care le poate citi API-ul; funcțiile SECURITY
--     DEFINER din public, apelabile de anon / authenticated, al căror corp numește un tabel / o vedere acoperită (sau au alt corp decât
--     cel revizuit). Ce nu e în listă oprește migrarea; lista din catalog se poate scoate și fără migrare: scripts/executie_acces_catalog.sql.
--   Detectorul e îngust intenționat (r3): din tabelele 'exclus' / 'comun' nu se coboară (altfel prin sites → employees → profiles se ajunge
--   la toată baza: 378 de tabele și 220 de funcții pe clonă), iar la funcții caută doar numele tabelelor ACOPERITE și ale vederilor peste ele
--   (nu profiles sau alte tabele comune). Cazurile din r1 (documente_proiect, pachetele, raportul zilnic, vederile) rămân prinse (P5–P12).
--
-- Ce face, pe scurt:
--   1. Tabel nou executie_acces_proiect (profile_id, proiect_id, nivel, acordat_de, acordat_la), PK (profile_id, proiect_id). Scrierea DOAR
--      prin fn_executie_acces_proiect_seteaza (owner, lista completă a unui cont, CAS pe lista văzută, lock pe cont). FK pe proiect = RESTRICT.
--   2. Tabelele 'proiect' / 'copil': politici RESTRICTIVE (se adună cu AND peste ce există) + trigger de gardă pe ORICE cale de scriere
--      (REST, RPC SECURITY DEFINER vechi, CASCADE, reparentare).
--   3. Funcțiile de drept: fn_executie_nod_drept / contract / grafic / tinte + fn_raport_santier_drept (raportul zilnic, 20261208a):
--      CREATE OR REPLACE cu aceeași semnătură / owner / ACL, amprenta veche verificată înainte (L15).
--      Raportul zilnic: un cont restrâns nu citește și nu salvează raportul unui șantier al unui proiect din afara listei (RPC-urile
--      fn_raport_zilnic_citeste / _salveaza trec prin fn_raport_santier_drept); liniile (raport_lucrari, raport_distributie_linii) au gardă
--      și pe căile directe. Șantier fără proiect = ca înainte.
--   4. Storage: politici RESTRICTIVE pe storage.objects, doar pentru bucket-urile 'cale' / 'tabel' din inventar (proiectul obiectului din
--      cale sau din tabelul care îl referă); alt bucket nu e atins.
--   5. fn_executie_swap_tevi_pozitie (creată direct în BD, fără condiția de proiect): originalul, cu amprenta verificată, se mută NESCHIMBAT
--      (corp, owner, drepturi) în schema internă executie_acces_intern (fără USAGE pentru clienți), iar în public rămâne, cu același nume și
--      aceiași parametri, o poartă care verifică proiectul pachetului FIECĂREI țevi pentru contul restrâns și apoi cheamă originalul.
--      Contul nerestrâns: exact ca azi (aceleași mesaje). Revenirea mută originalul înapoi.
-- Ce NU face: nicio dată (niciun cont nu e restrâns după migrare: comportamentul rămâne exact cel de azi până când owner-ul bifează),
--   niciun drept pe modul, nicio schimbare a corpurilor RPC-urilor vechi (în afara funcțiilor de drept de la 3 și a porții de la 5).
-- Calea server fără JWT (cron, chat-ul prin psql, edge cu service_role): restricția e pe CONT; fără auth.uid() trigger-ul nu se amestecă
--   (comportamentul de azi), iar service_role are BYPASSRLS ca și până acum.
-- Ordinea lock-urilor (L06): RPC-ul de setare ia (1) lock consultativ pe cont, (2) FOR KEY SHARE NOWAIT pe rândul profilului, (3) rândurile
--   contului din executie_acces_proiect (DELETE apoi INSERT … ON CONFLICT, ORDER BY proiect_id). Trigger-ele de gardă și funcțiile de regulă
--   doar citesc (fără lock-uri de rând).
-- DEPENDENȚĂ: se aplică DUPĂ 20261201a, 20261203a, 20261204a, 20261208a (verificat mai jos). Revenirile acelor migrări (sau preflight-urile
--   20261202a / 20261207a / 20261211a, dacă nu sunt încă aplicate) verifică amprenta veche a lui fn_executie_nod_drept: întâi revenirea
--   ACESTEIA. Fibra optică (20261211a) poate fi aplicată sau nu: dacă e, tabelele ei sunt 'drept' (fn_executie_fibra_drept delegă la
--   fn_executie_nod_drept, deci primește condiția de proiect de aici), iar RPC-urile ei sunt verificate pe amprentă.
-- Revenire: supabase/revenire/20261209a_executie_acces_proiect_ROLLBACK.sql. Test pe clonă: scripts/test_executie_acces_proiect.sql.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261209a_executie_acces_proiect:' || txid_current() THEN
    RAISE EXCEPTION '20261209a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261209a: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF to_regclass('public.executie_acces_proiect') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND (p.proname LIKE 'fn\_executie\_acces\_%' OR p.proname = 'fn_executie_proiect_permis'))
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polname LIKE 'executie\_acces\_%')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_executie_acces_garda')
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'executie_acces_intern') THEN
    RAISE EXCEPTION '20261209a: obiectele exista deja (reaplicare)';
  END IF;
  -- dependențele de bază
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_proiecte'::regclass AND attname = 'id' AND NOT attisdropped) IS DISTINCT FROM 'bigint'
     OR (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attname = 'id' AND NOT attisdropped) IS DISTINCT FROM 'uuid'
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND contype IN ('p', 'u')
                     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attname = 'id')]::int2[])
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_owner' AND data_type = 'boolean')
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_module_access'
          AND column_name IN ('profile_id', 'module', 'access_level')) <> 3
     OR to_regprocedure('auth.uid()') IS NULL
     OR (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('auth.uid()')) IS DISTINCT FROM 'uuid'::regtype::oid
     OR to_regclass('storage.objects') IS NULL
     OR (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION '20261209a: dependentele (executie_proiecte.id bigint, profiles.id uuid unic, profiles.is_owner, user_module_access, auth.uid, storage.objects cu RLS) difera';
  END IF;
END $pre$;

-- ── 0. inventarul: O SINGURĂ listă (L19). Owner-ul migrării îl citește; clienții nu au EXECUTE. ──────────────────────────────────────────
-- tip:    tabel | prefix_tabel | functie | bucket
-- clasa:  tabel: proiect | copil | drept | exclus | comun; prefix_tabel: exclus | comun;
--         functie: drept | verifica | garda | delega | poarta | exclus; bucket: cale | tabel | drept | exclus
-- cheie:  tabel proiect/copil = coloana; tabel drept = funcția de drept; functie = md5(corp fără CR) revizuit
-- parinte: copil = sl | bon | pachet | raport | cumulat | activitate
-- r3: lista acoperă TOT catalogul clonei schemei de producție (10.11.2026): 378 de tabele (ce nu e aici pe nume intră pe un prefix),
--   147 de vederi (toate security_invoker: niciuna nu oprește migrarea) și cele 34 de funcții care numesc un tabel acoperit sau o vedere
--   (orice vedere, nu doar cele peste tabele acoperite: dependențele vederilor nu sunt în ieșirea clonei, deci lista e mai largă decât
--   detectorul), plus fn_executie_fibra_drept (delegată; nu numește niciun tabel, deci detectorul n-o vede, dar o verificăm pe amprentă).
CREATE FUNCTION public.fn_executie_acces_inventar()
RETURNS TABLE (tip text, obiect text, clasa text, cheie text, parinte text, motiv text)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT * FROM (VALUES
  -- tabelele Execuției cu proiectul pe rând
  ('tabel', 'executie_proiecte', 'proiect', 'id', NULL::text, 'proiectul însuși'),
  ('tabel', 'executie_tronsoane', 'proiect', 'proiect_id', NULL, 'tronsoane'),
  ('tabel', 'executie_documente_contract', 'proiect', 'proiect_id', NULL, 'documentele contractului'),
  ('tabel', 'executie_acte_aditionale', 'proiect', 'proiect_id', NULL, 'acte adiționale'),
  ('tabel', 'executie_ordine_sistare', 'proiect', 'proiect_id', NULL, 'ordine de sistare'),
  ('tabel', 'executie_ordine_detectate', 'proiect', 'proiect_id', NULL, 'ordine detectate din corespondență'),
  ('tabel', 'executie_completari_propuse', 'proiect', 'proiect_id', NULL, 'completări propuse'),
  ('tabel', 'executie_faze_determinante', 'proiect', 'proiect_id', NULL, 'faze determinante'),
  ('tabel', 'executie_probe_presiune', 'proiect', 'proiect_id', NULL, 'probe de presiune (vechi)'),
  ('tabel', 'executie_situatii_plata', 'proiect', 'proiect_id', NULL, 'situații de plată'),
  ('tabel', 'executie_bonuri_consum', 'proiect', 'proiect_id', NULL, 'bonuri de consum'),
  ('tabel', 'executie_alocari_personal', 'proiect', 'proiect_id', NULL, 'alocări de personal'),
  ('tabel', 'executie_ture', 'proiect', 'proiect_id', NULL, 'ture'),
  ('tabel', 'executie_tura_subcontractori', 'proiect', 'proiect_id', NULL, 'ture subcontractori'),
  ('tabel', 'executie_tura_activitati', 'proiect', 'proiect_id', NULL, 'ture activități'),
  ('tabel', 'executie_tura_naveta', 'proiect', 'proiect_id', NULL, 'ture navetă'),
  ('tabel', 'proiect_unitati', 'proiect', 'proiect_id', NULL, 'unitățile proiectului (obiecte / tronsoane din deviz)'),
  ('tabel', 'proiect_activitati', 'proiect', 'proiect_id', NULL, 'activitățile proiectului'),
  ('tabel', 'proiect_articole', 'proiect', 'proiect_id', NULL, 'articolele de deviz'),
  ('tabel', 'executie_pachete_lansare', 'proiect', 'proiect_id', NULL, 'pachetele de izometrii (citire executie / ctc, scriere executie: 20261029a)'),
  ('tabel', 'documente_proiect', 'proiect', 'proiect_id', NULL, 'corespondența proiectului (tab Documente)'),
  ('tabel', 'documente_de_repartizat', 'proiect', 'repartizat_in_proiect_id', NULL,
     'coada comună de repartizat: rândurile încă nerepartizate n-au proiect, deci un cont restrâns NU vede coada și NU repartizează / ignoră (decizie de confirmat de Răzvan; varianta: rândurile cu candidat pe proiectele lui)'),
  ('tabel', 'raport_lucrari', 'proiect', 'proiect_id', NULL, 'liniile raportului zilnic (cantități pe activitate / obiect)'),
  -- r3: tabelele Execuției create direct în BD (găsite în catalogul clonei)
  ('tabel', 'executie_alerte_ai', 'proiect', 'proiect_id', NULL, 'alertele AI ale proiectului'),
  ('tabel', 'executie_documente_referinta', 'proiect', 'proiect_id', NULL, 'documentele de referință ale proiectului'),
  ('tabel', 'executie_pachete_cumulat_final', 'proiect', 'proiect_id', NULL, 'cumulatul final al pachetelor de izometrii'),
  ('tabel', 'executie_pachete_sudura_sant', 'proiect', 'proiect_id', NULL, 'sudurile de șanț ale pachetelor'),
  -- copiii fără proiect pe rând
  ('tabel', 'executie_situatii_plata_linii', 'copil', 'sl_id', 'sl', 'liniile situațiilor de plată'),
  ('tabel', 'executie_sl_ajustari', 'copil', 'sl_id', 'sl', 'ajustările situațiilor de plată'),
  ('tabel', 'executie_bonuri_consum_linii', 'copil', 'bon_id', 'bon', 'liniile bonurilor de consum'),
  ('tabel', 'executie_pachete_documente', 'copil', 'pachet_id', 'pachet', 'documentele pachetelor (centralizator, PDF aprobat)'),
  ('tabel', 'executie_tevi', 'copil', 'pachet_id', 'pachet', 'țevile pachetelor de izometrii'),
  ('tabel', 'raport_distributie_linii', 'copil', 'raport_id', 'raport', 'liniile „Raport lucrări executate” (distribuție gaze)'),
  ('tabel', 'executie_pachete_cumulat_tevi', 'copil', 'cumulat_id', 'cumulat', 'țevile cumulatului final (r3)'),
  ('tabel', 'executie_pachete_exports', 'copil', 'pachet_cumulat_id', 'cumulat', 'exporturile cumulatului final (r3)'),
  ('tabel', 'proiect_activitate_coduri', 'copil', 'activitate_id', 'activitate', 'codurile de deviz ale activităților proiectului (r3)'),
  -- tabelele noi cu funcția lor de drept (condiția de proiect intră în funcție)
  ('tabel', 'executie_noduri_suduri', 'drept', 'fn_executie_nod_drept', NULL, '20261201a'),
  ('tabel', 'executie_noduri_constructii', 'drept', 'fn_executie_nod_drept', NULL, '20261207a'),
  ('tabel', 'executie_probe_tronsoane', 'drept', 'fn_executie_nod_drept', NULL, '20261202a'),
  ('tabel', 'executie_probe_etape', 'drept', 'fn_executie_nod_drept', NULL, '20261202a'),
  ('tabel', 'executie_probe_jurnal', 'drept', 'fn_executie_nod_drept', NULL, '20261202a'),
  ('tabel', 'executie_contract_repere', 'drept', 'fn_executie_contract_drept', NULL, '20261203a'),
  ('tabel', 'executie_contract_repere_chei', 'drept', 'fn_executie_contract_drept', NULL, '20261203a (cheile RPC-ului; fără drepturi pentru clienți)'),
  ('tabel', 'executie_grafic_revizii', 'drept', 'fn_executie_grafic_drept', NULL, '20261204a'),
  ('tabel', 'executie_grafic_activitati', 'drept', 'fn_executie_grafic_drept', NULL, '20261204a'),
  ('tabel', 'executie_tinte_setari', 'drept', 'fn_executie_tinte_drept', NULL, '20261208a'),
  ('tabel', 'executie_acces_proiect', 'drept', 'fn_executie_acces_e_owner', NULL, 'tabelul acestei migrări'),
  ('tabel', 'executie_fibra_camerete', 'drept', 'fn_executie_fibra_drept', NULL, '20261211a (fibra optică; politicile ei cer fn_executie_fibra_drept)'),
  ('tabel', 'executie_fibra_intervale', 'drept', 'fn_executie_fibra_drept', NULL, '20261211a (fibra optică)'),
  ('tabel', 'executie_fibra_jurnal', 'drept', 'fn_executie_fibra_drept', NULL, '20261211a (fibra optică; jurnalul, doar citire)'),
  -- excluse, cu motiv și risc (decizie pentru Răzvan)
  ('tabel', 'sites', 'exclus', NULL, NULL,
     'șantierele (pontaj): cheia rapoartelor zilnice; restricția pe proiect se aplică raportului prin fn_raport_santier_drept și liniilor, nu listei de șantiere (lista de șantiere rămâne cea de azi)'),
  ('tabel', 'rapoarte_zilnice', 'exclus', NULL, NULL,
     'antetul raportului zilnic e pe șantier (profile_sites); RPC-urile raportului verifică proiectul șantierului; regulile antetului pe căile directe rămân cele de azi (de decis separat)'),
  ('tabel', 'raport_zilnic_salvari', 'exclus', NULL, NULL, 'jurnalul salvărilor (20261208a): fără niciun drept pentru clienți'),
  ('prefix_tabel', 'izo_', 'exclus', NULL, NULL,
     'Izometrie: are atribuirea ei pe proiect (izo_atribuiri / fn_izo_acces), care decide în RPC-urile ei; scrierile în tabelele Execuției (pachete, țevi, tronsoane) trec totuși prin gardă'),
  ('prefix_tabel', 'magazie_', 'exclus', NULL, NULL, 'Magazie: modul separat (gestiune), cu dreptul lui pe modul'),
  ('prefix_tabel', 'stocuri_', 'exclus', NULL, NULL, 'Magazie (mișcări de stoc): modul separat'),
  ('prefix_tabel', 'logistica_', 'exclus', NULL, NULL, 'Logistica: modul separat (utilaje, alocări, transporturi)'),
  ('prefix_tabel', 'comenzi', 'exclus', NULL, NULL, 'Achiziții (comenzi / comenzi furnizor): modul separat, cu dreptul lui pe modul'),
  ('prefix_tabel', 'comanda_', 'exclus', NULL, NULL, 'Achiziții: liniile comenzilor'),
  ('prefix_tabel', 'upa_', 'exclus', NULL, NULL, 'Achiziții UPA'),
  ('prefix_tabel', 'contracte_', 'exclus', NULL, NULL, 'Contracte cu terți (linii, acte adiționale, polițe, facturi de subcontract): modul separat (Financiar)'),
  ('prefix_tabel', 'facturi_', 'exclus', NULL, NULL, 'Facturi: modul Financiar'),
  ('prefix_tabel', 'garantii', 'exclus', NULL, NULL, 'Garanții / GBE: modul Financiar'),
  ('prefix_tabel', 'gbe_', 'exclus', NULL, NULL, 'GBE: modul Financiar'),
  ('prefix_tabel', 'polite', 'exclus', NULL, NULL, 'Polițe: modul separat'),
  ('prefix_tabel', 'hr_', 'exclus', NULL, NULL, 'HR (decizii, autorizații): modul separat'),
  ('prefix_tabel', 'ctc_', 'exclus', NULL, NULL, 'CTC: modul separat'),
  ('prefix_tabel', 'probe_', 'exclus', NULL, NULL, 'modulul Probe: dreptul lui (probe_teren_drept)'),
  ('prefix_tabel', 'red_', 'exclus', NULL, NULL, 'Redări: proiectele Redări au poarta lor (red_*)'),
  ('prefix_tabel', 'sms_', 'exclus', NULL, NULL, 'SMS Redări'),
  ('prefix_tabel', 'ofertare_', 'exclus', NULL, NULL, 'Ofertare: modul separat'),
  ('prefix_tabel', 'nas_', 'exclus', NULL, NULL, 'Documente NAS (index de fișiere): modul separat'),
  ('prefix_tabel', 'ocr_', 'exclus', NULL, NULL, 'OCR local: cale server, fără drepturi de citire pe proiect pentru utilizatori'),
  ('prefix_tabel', 'meteo_', 'exclus', NULL, NULL, 'Meteo: pe șantier, fără date de proiect'),
  ('prefix_tabel', 'sedinte', 'exclus', NULL, NULL, 'Ședințe: modul separat'),
  ('prefix_tabel', 'ai_', 'exclus', NULL, NULL, 'AI (inbox, costuri): cale server / owner'),
  -- r3: restul catalogului clonei, alte module (cu dreptul lor pe modul; un cont restrâns în Execuție care are SEPARAT modulul vede acolo
  -- toate proiectele — decizie pentru Răzvan, scrisă)
  ('tabel', 'magazii', 'exclus', NULL, NULL, 'Magazie: gestiunile (magaziile) proiectelor, cu dreptul modulului Magazie'),
  ('prefix_tabel', 'transferuri_', 'exclus', NULL, NULL, 'Magazie: transferurile între gestiuni'),
  ('prefix_tabel', 'eip_', 'exclus', NULL, NULL, 'Magazie: echipamentele individuale de protecție'),
  ('prefix_tabel', 'necesar_', 'exclus', NULL, NULL, 'Necesar de materiale / Achiziții'),
  ('prefix_tabel', 'productie_', 'exclus', NULL, NULL, 'Producție'),
  ('prefix_tabel', 'contab_', 'exclus', NULL, NULL, 'Contabilitate (importul expertului contabil, maparea șantierelor): Financiar'),
  ('prefix_tabel', 'trezorerie_', 'exclus', NULL, NULL, 'Trezorerie (conturi, extrase): Financiar'),
  ('prefix_tabel', 'grafic_', 'exclus', NULL, NULL,
     'graficul intern editabil (Gantt) al licitațiilor și lucrărilor: scriere cu dreptul Ofertare; citirea rămâne cea de azi (orice cont autentificat) — decizie pentru Răzvan'),
  ('tabel', 'proiecte_ofertare', 'exclus', NULL, NULL, 'Ofertare'),
  ('tabel', 'oferta_materiale', 'exclus', NULL, NULL, 'Ofertare'),
  ('prefix_tabel', 'pontaj_', 'exclus', NULL, NULL, 'Pontaj (pe angajat și șantier)'),
  ('prefix_tabel', 'salarii_', 'exclus', NULL, NULL, 'Salarii'),
  ('tabel', 'employee_salaries', 'exclus', NULL, NULL, 'Salarii (pe angajat)'),
  ('tabel', 'diurna_payment_details', 'exclus', NULL, NULL, 'HR / diurne (pe angajat)'),
  ('tabel', 'ordine_deplasare_arhiva', 'exclus', NULL, NULL, 'HR / ordine de deplasare (pe angajat)'),
  ('tabel', 'organigrama_propuneri', 'exclus', NULL, NULL, 'HR / organigramă'),
  ('tabel', 'supliment_hrana_istoric', 'exclus', NULL, NULL, 'HR / supliment de hrană (pe angajat)'),
  ('tabel', 'olx_mesaje_procesate', 'exclus', NULL, NULL, 'HR / recrutare'),
  ('tabel', 'evogps_alias', 'exclus', NULL, NULL, 'Logistica / GPS (pe utilaj)'),
  ('tabel', 'registru_imobilizari', 'exclus', NULL, NULL, 'Logistica / imobilizări (pe utilaj)'),
  ('prefix_tabel', 'service_import_', 'exclus', NULL, NULL, 'Logistica / service (pe utilaj)'),
  ('tabel', 'talon_extract_staging', 'exclus', NULL, NULL, 'Logistica / talon (pe utilaj)'),
  ('tabel', 'whatsapp_messages_processed', 'exclus', NULL, NULL, 'Logistica / alimentări (pe utilaj)'),
  ('tabel', 'avize_cjp', 'exclus', NULL, NULL, 'Logistica / depozite (avize)'),
  ('prefix_tabel', 'iot_', 'exclus', NULL, NULL, 'IoT pe șantier (dispozitive, lumini)'),
  ('prefix_tabel', 'locatii_', 'exclus', NULL, NULL, 'Cazări închiriate (Administrativ)'),
  ('prefix_tabel', 'marketing_', 'exclus', NULL, NULL, 'Marketing'),
  ('prefix_tabel', 'tichete', 'exclus', NULL, NULL, 'Tichete (raportări interne)'),
  ('tabel', 'intrebari_tehnice', 'exclus', NULL, NULL, 'Întrebări tehnice'),
  -- r3: dimensiuni comune — NU ajung la date de proiect (verificat în preflight: fără proiect_id, fără FK spre proiecte / tabele acoperite)
  ('tabel', 'employees', 'comun', NULL, NULL, 'angajații: legați de un șantier, nu de datele unui proiect'),
  ('tabel', 'profiles', 'comun', NULL, NULL, 'conturile'),
  ('tabel', 'profile_sites', 'comun', NULL, NULL, 'alocarea conturilor pe șantiere (raportul zilnic o folosește ca drept, nu e dată de proiect)'),
  ('tabel', 'user_module_access', 'comun', NULL, NULL, 'drepturile pe module'),
  ('tabel', 'notifications', 'comun', NULL, NULL, 'notificările unui cont'),
  ('tabel', 'setari_recycle_bin', 'comun', NULL, NULL, 'setări'),
  ('tabel', 'rag_ingest_queue', 'comun', NULL, NULL, 'coada de indexare a documentelor'),
  ('prefix_tabel', 'claude_', 'comun', NULL, NULL, 'infrastructura asistentului (context, silențieri)'),
  -- funcțiile SECURITY DEFINER care ating tabelele de mai sus (amprenta corpului revizuit)
  ('functie', 'fn_executie_nod_drept', 'drept', '144649bae9a218b41b7e6df90cba5d9e', NULL, '20261201a; înlocuită aici'),
  ('functie', 'fn_executie_contract_drept', 'drept', '85a131c3aa59813b1a8cb8535c53e703', NULL, '20261203a; înlocuită aici'),
  ('functie', 'fn_executie_grafic_drept', 'drept', '1dbaedfd117f7234a6e30fdaf856ac7b', NULL, '20261204a; înlocuită aici'),
  ('functie', 'fn_executie_tinte_drept', 'drept', 'bda0b6c3e01a5a039732b2713df8ebab', NULL, '20261208a; înlocuită aici'),
  ('functie', 'fn_raport_santier_drept', 'drept', '2c8833d76db7145ab0bd2fc5103e55e9', NULL, '20261208a (raportul zilnic); înlocuită aici'),
  ('functie', 'fn_executie_nod_sudura_stare', 'verifica', 'e915c6d52f3d00635eec4a2cc38ae392', NULL, 'fn_executie_nod_drept pe proiectul sudurii'),
  ('functie', 'fn_executie_nod_obiect_citire', 'verifica', '9cb603a372aff84fb64dbd6861de1929', NULL, 'fn_executie_nod_drept pe proiectul din cale'),
  ('functie', 'fn_executie_constr_etapa', 'verifica', '65e10dce50bfe8c8a46d8075aef96648', NULL, 'fn_executie_nod_drept pe proiectul rândului'),
  ('functie', 'fn_executie_proba_salveaza', 'verifica', '19dfba358fabf4e5eb545f0c5a327cde', NULL, 'fn_executie_nod_drept pe proiect'),
  ('functie', 'fn_executie_proba_anuleaza', 'verifica', '8aab99218411beb5e60d90826889b821', NULL, 'fn_executie_nod_drept pe proiectul rândului'),
  ('functie', 'fn_executie_proba_etapa', 'verifica', '32bb3199a080744439c3de3bd2d54d61', NULL, 'fn_executie_nod_drept pe proiectul etapei'),
  ('functie', 'fn_executie_contract_salveaza', 'verifica', '5eef3d74ee3dee18954da889fad7cd28', NULL, 'fn_executie_contract_drept pe proiect'),
  ('functie', 'fn_executie_tinte_nod', 'verifica', '5747275c7d136b9ecc41027e5a7612f6', NULL, 'fn_executie_tinte_drept pe proiect'),
  ('functie', 'fn_executie_tinte_calcul', 'verifica', 'e66e41c404bf7711763f1f2b1513d0d6', NULL, 'fn_executie_tinte_drept pe fiecare proiect (v_executie_tinte)'),
  ('functie', 'fn_raport_zilnic_citeste', 'verifica', '6083e8f7379c781a1151d73a46631c5c', NULL, 'fn_raport_santier_drept pe șantier'),
  ('functie', 'fn_raport_zilnic_salveaza', 'verifica', 'c9c6b6b3d27f14fe29712196b7f23e2c', NULL, 'fn_raport_santier_drept pe șantier; liniile trec și prin gardă'),
  ('functie', 'fn_bon_salveaza', 'garda', 'd3373fddfbe539bb6c9fefc8c72212b2', NULL, 'scrie bonul și liniile (gardă); întoarce doar id / versiune'),
  ('functie', 'fn_bon_preia', 'garda', 'f63b5b3b8d66da5e228104ecf982a2ae', NULL, 'scrie bonul și liniile (gardă); întoarce doar id / versiune'),
  ('functie', 'fn_doc_repartizeaza', 'garda', '6fab78a4a83a71a8fb6b1f34e57c3b92', NULL, 'scrie documente_proiect + coada (gardă pe ambele)'),
  ('functie', 'fn_doc_ignora', 'garda', '61e4c8f8e8a858509500b5f2a6f7d70b', NULL, 'scrie coada (gardă)'),
  ('functie', 'fn_doc_muta_in_coada', 'garda', 'ac04bbd85d144983b5491117c5fab4b9', NULL, 'doar owner'),
  ('functie', 'fn_completare_aplica', 'garda', 'dc82ba4fea0071de3417f60a5c26e6cb', NULL, 'scrie completarea + proiectul (gardă)'),
  ('functie', '_completare_scrie_camp', 'garda', 'cc54cb28a6ee513323e22df607c51724', NULL, 'scrie proiectul (gardă)'),
  ('functie', '_completare_goleste_camp', 'garda', '62a817c812d0c932aa1d629aba13b541', NULL, 'scrie proiectul (gardă)'),
  -- r3: fibra optică (20261211a, creată pe clonă; identică cu branch-ul ei): RPC-urile cheamă fn_executie_fibra_drept pe proiectul
  -- tronsonului / rândului înaintea oricărei citiri întoarse; fn_executie_fibra_drept doar delegă la fn_executie_nod_drept (înlocuită aici)
  ('functie', 'fn_executie_fibra_drept', 'delega', '0fa635d3638845faa6b1f940328fb138', NULL, '20261211a: = fn_executie_nod_drept(proiect, scriere)'),
  ('functie', 'fn_executie_fibra_raporteaza', 'verifica', '580771adb9b680ede692684c9d6dcc32', NULL, 'fn_executie_fibra_drept pe proiectul tronsonului'),
  ('functie', 'fn_executie_fibra_anuleaza', 'verifica', '7393cca2ea848d5a5ff8ccdc1b7d2b9c', NULL, 'fn_executie_fibra_drept pe proiectul rândului (blocat)'),
  ('functie', 'fn_executie_fibra_camereta_adauga', 'verifica', '80ad984b472e96ab8c9b914640615dbf', NULL, 'fn_executie_fibra_drept pe proiectul tronsonului'),
  ('functie', 'fn_executie_fibra_camereta_stare', 'verifica', '2eed50fc739c8a6fd09efd8a94db134a', NULL, 'fn_executie_fibra_drept pe proiectul cameretei (blocată), înaintea răspunsului „conflict”'),
  -- r3: creată direct în BD, fără condiția de proiect: poarta se pune aici (pasul 6b)
  ('functie', 'fn_executie_swap_tevi_pozitie', 'poarta', '551affa41371b0ff3367b0ddebe9b603', NULL,
     'schimbă pozițiile a două țevi din același pachet; scrierea trecea deja prin gardă, poarta oprește și citirile / mesajele despre țevile altor proiecte'),
  -- r3: alte module, cu corpul revizuit (ce citesc / întorc și cu ce drept)
  ('functie', 'fn_ai_inbox_poate_confirma', 'exclus', '1fcdef410eebff3c7ccdbb87acf8e08b', NULL,
     'Inbox AI: predicat (adevărat / fals); la Execuție decide după alocarea pe șantierul proiectului (profile_sites), nu după lista nouă — decizie pentru Răzvan'),
  ('functie', 'fn_next_numar_comanda_furnizor', 'exclus', 'b3161bc54a9f57c42b2b75b1c6896b44', NULL, 'Achiziții: numărul comenzii (citește doar codul proiectului)'),
  ('functie', 'fn_hr_decizie_ataseaza_scan', 'exclus', 'ce4a148541e12f97bc800cff7e9c7077', NULL,
     'HR (fn_hr_decizii_poate): completările propuse pe proiect le scrie prin gardă; întoarce starea deciziei'),
  ('functie', 'fn_hr_decizie_inlocuieste_scan', 'exclus', '30b3655428515632a16e8cebe759bbb4', NULL, 'HR, doar owner'),
  ('functie', 'fn_izo_flux_pdf_blocat', 'exclus', '222e14159a498d399bc0757b06743425', NULL, 'Izometrie: predicat pentru Storage (adevărat / fals)'),
  ('functie', 'fn_izo_iesire_cu_aviz', 'exclus', '559542328c6b41803cb7b6499ac50ce2', NULL, 'Izometrie: fn_izo_citire pe proiectul tronsonului'),
  ('functie', 'fn_izo_proiecte_protejate', 'exclus', 'ac8c3df60135585879bc3e8d5ded67a8', NULL, 'Izometrie: lista proiectelor cu Izometrie pornită (id, șantier, nivel), fără alte date'),
  ('functie', 'fn_probe_creeaza_teren', 'exclus', 'a1989193d5136e7751106d63dead7aa1', NULL, 'Probe: probe_teren_drept; citește doar tronsoanele proiectului ales'),
  ('functie', 'fn_red_pv_c_creeaza', 'exclus', 'a4ddfd572dc9c22e4889fd6309d9a3ba', NULL, 'Redări (red_v_tronson)'),
  ('functie', 'fn_red_pv_c_neacoperite', 'exclus', 'ad42b1c7c1e4be49a2ea99a5eca9e3dd', NULL, 'Redări (red_v_tronson)'),
  ('functie', 'fn_ofertare_source_pack_import', 'exclus', 'be897d73e8fb826b4e7a85a518b9b908', NULL, 'Ofertare (v_ofertare_source_pack_decizie_curenta)'),
  ('functie', 'fn_ai_cost_lunar', 'exclus', '762830388fc554a9a81c679555a02572', NULL, 'raportul Cost AI (v_ai_cost_lunar): doar owner'),
  -- Storage
  ('bucket', 'executie-contracte', 'cale', NULL, NULL, '<proiect>/…, ordin-incepere|pccvi|probe-presiune/<proiect>/…; altă formă (ex. _nou/) = refuz pentru contul restrâns'),
  ('bucket', 'executie-borderouri', 'cale', NULL, NULL, 'sl_<proiect>/…'),
  ('bucket', 'executie-pachete-pdf', 'cale', NULL, NULL, '<pachet>/… (proiectul pachetului) sau <proiect>/<pachet>/aprobare/… (pachetul trebuie să fie al proiectului)'),
  ('bucket', 'documente-proiect', 'tabel', NULL, NULL, 'proiectele rândurilor din documente_proiect cu acest storage_path; fără rând (ex. coada _de_repartizat/) = refuz pentru contul restrâns'),
  ('bucket', 'noduri-scheme', 'drept', NULL, NULL, 'fn_executie_nod_obiect_citire (20261201a)'),
  ('bucket', 'comenzi-furnizor', 'exclus', NULL, NULL, 'Achiziții'),
  ('bucket', 'probe-citiri', 'exclus', NULL, NULL, 'modulul Probe'),
  ('bucket', 'izo-documente', 'exclus', NULL, NULL, 'Izometrie'),
  ('bucket', 'izo-avize', 'exclus', NULL, NULL, 'Izometrie'),
  ('bucket', 'hr-semnaturi', 'exclus', NULL, NULL, 'HR'),
  ('bucket', 'hr-decizii', 'exclus', NULL, NULL, 'HR'),
  ('bucket', 'redari', 'exclus', NULL, NULL, 'Redări'),
  ('bucket', 'ctc-documente', 'exclus', NULL, NULL, 'CTC')
  ) v(tip, obiect, clasa, cheie, parinte, motiv)
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_acces_inventar() FROM PUBLIC, anon, authenticated, service_role;

-- ── preflight pe inventar + CATALOG ───────────────────────────────────────────────────────────────────────────────────────────────
DO $pre2$
DECLARE r record; v_tip text; v_lista text; v_regex text;
BEGIN
  -- inventarul însuși: fără dubluri, clase și părinți din lista albă
  IF EXISTS (SELECT 1 FROM public.fn_executie_acces_inventar() GROUP BY tip, obiect HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM public.fn_executie_acces_inventar() i
                 WHERE NOT ((i.tip = 'tabel' AND i.clasa IN ('proiect', 'copil', 'drept', 'exclus', 'comun'))
                         OR (i.tip = 'prefix_tabel' AND i.clasa IN ('exclus', 'comun'))
                         OR (i.tip = 'functie' AND i.clasa IN ('drept', 'verifica', 'garda', 'delega', 'poarta', 'exclus') AND i.cheie ~ '^[0-9a-f]{32}$')
                         OR (i.tip = 'bucket' AND i.clasa IN ('cale', 'tabel', 'drept', 'exclus')))
                    OR (i.clasa = 'copil') IS DISTINCT FROM (i.parinte IS NOT NULL)
                    OR (i.clasa = 'copil' AND i.parinte NOT IN ('sl', 'bon', 'pachet', 'raport', 'cumulat', 'activitate'))
                    OR (i.clasa IN ('proiect', 'copil') AND i.cheie IS NULL)
                    OR (i.tip = 'tabel' AND i.clasa = 'drept' AND i.cheie !~ '^fn_[a-z_]+$')
                    -- poarta e cod scris pentru fiecare funcție în parte (pasul 6b): doar cele de acolo
                    OR (i.clasa = 'poarta' AND i.obiect NOT IN ('fn_executie_swap_tevi_pozitie'))
                    OR i.motiv IS NULL OR i.motiv !~ '[^[:space:]]') THEN
    RAISE EXCEPTION '20261209a: inventarul are dubluri sau clase invalide';
  END IF;
  -- prefixele nu se suprapun (clasa unui tabel nu depinde de ordinea lor)
  IF EXISTS (SELECT 1 FROM public.fn_executie_acces_inventar() a JOIN public.fn_executie_acces_inventar() b
              ON a.tip = 'prefix_tabel' AND b.tip = 'prefix_tabel' AND a.obiect <> b.obiect AND starts_with(b.obiect, a.obiect)) THEN
    RAISE EXCEPTION '20261209a: prefixe de tabel suprapuse in inventar';
  END IF;
  -- tabelele acoperite: există, tabel obișnuit, cheia întreagă, RLS PORNIT (o politică RESTRICTIVE pe un tabel fără RLS nu face nimic, L07)
  FOR r IN SELECT * FROM public.fn_executie_acces_inventar() WHERE tip = 'tabel' AND clasa IN ('proiect', 'copil') ORDER BY obiect LOOP
    IF to_regclass('public.' || r.obiect) IS NULL
       OR (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.' || r.obiect)) IS DISTINCT FROM 'r' THEN
      RAISE EXCEPTION '20261209a: tabelul % lipseste sau nu e tabel obisnuit', r.obiect;
    END IF;
    SELECT format_type(atttypid, atttypmod) INTO v_tip FROM pg_attribute
     WHERE attrelid = to_regclass('public.' || r.obiect) AND attname = r.cheie AND attnum > 0 AND NOT attisdropped;
    IF v_tip IS NULL OR v_tip NOT IN ('bigint', 'integer') THEN
      RAISE EXCEPTION '20261209a: %.% lipseste sau nu e intreg (%)', r.obiect, r.cheie, coalesce(v_tip, 'lipsa');
    END IF;
    IF (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || r.obiect)) IS NOT TRUE THEN
      RAISE EXCEPTION '20261209a: % nu are RLS pornit (restrictia ar fi falsa)', r.obiect;
    END IF;
  END LOOP;
  -- părinții copiilor (id + legătura spre proiect, întregi)
  FOR r IN SELECT * FROM (VALUES ('executie_situatii_plata', 'id'), ('executie_situatii_plata', 'proiect_id'),
                                 ('executie_bonuri_consum', 'id'), ('executie_bonuri_consum', 'proiect_id'),
                                 ('executie_pachete_lansare', 'id'), ('executie_pachete_lansare', 'proiect_id'),
                                 ('rapoarte_zilnice', 'id'), ('rapoarte_zilnice', 'site_id'), ('sites', 'id'), ('sites', 'proiect_id'),
                                 ('executie_pachete_cumulat_final', 'id'), ('executie_pachete_cumulat_final', 'proiect_id'),
                                 ('proiect_activitati', 'id'), ('proiect_activitati', 'proiect_id'),
                                 ('executie_tevi', 'id'), ('executie_tevi', 'pachet_id'),
                                 ('documente_proiect', 'storage_path')) x(t, c) LOOP
    SELECT format_type(atttypid, atttypmod) INTO v_tip FROM pg_attribute
     WHERE attrelid = to_regclass('public.' || r.t) AND attname = r.c AND attnum > 0 AND NOT attisdropped;
    IF v_tip IS NULL OR v_tip NOT IN (CASE WHEN r.c = 'storage_path' THEN 'text' ELSE 'bigint' END, CASE WHEN r.c = 'storage_path' THEN 'text' ELSE 'integer' END) THEN
      RAISE EXCEPTION '20261209a: %.% lipseste sau are alt tip (%)', r.t, r.c, coalesce(v_tip, 'lipsa');
    END IF;
  END LOOP;
  -- L15: funcțiile de drept, exact cum le-au lăsat migrările lor (corp fără CR, DEFINER, search_path, owner, EXECUTE)
  IF EXISTS (SELECT 1 FROM (VALUES
               ('public.fn_executie_nod_drept(bigint, boolean)', 'fn_executie_nod_drept', true, true),
               ('public.fn_executie_contract_drept(bigint, boolean)', 'fn_executie_contract_drept', true, true),
               ('public.fn_executie_grafic_drept(bigint)', 'fn_executie_grafic_drept', true, true),
               ('public.fn_executie_tinte_drept(bigint, text)', 'fn_executie_tinte_drept', false, true),
               ('public.fn_raport_santier_drept(bigint)', 'fn_raport_santier_drept', false, false)) a(semnatura, nume, cu_service, cu_auth)
              JOIN public.fn_executie_acces_inventar() i ON i.tip = 'functie' AND i.obiect = a.nume AND i.clasa = 'drept'
              LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
              WHERE p.oid IS NULL
                 OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM i.cheie
                 OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = 'sql')
                 OR p.prosecdef IS NOT TRUE
                 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                 OR p.prorettype IS DISTINCT FROM 'boolean'::regtype::oid
                 OR p.provolatile IS DISTINCT FROM 's'
                 OR pg_get_userbyid(p.proowner) IS DISTINCT FROM current_user
                 OR has_function_privilege('anon', p.oid, 'EXECUTE')
                 OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.cu_auth
                 OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM a.cu_service)
     OR (SELECT count(*) FROM public.fn_executie_acces_inventar() WHERE tip = 'functie' AND clasa = 'drept') <> 5 THEN
    RAISE EXCEPTION '20261209a: functiile de drept (20261201a / 20261203a / 20261204a / 20261208a) lipsesc sau difera de amprenta revizuita: aplica-le intai / verifica';
  END IF;
  -- funcțiile de drept DELEGATE (migrarea lor poate să nu fie aplicată): dacă există, exact corpul revizuit, DEFINER, search_path fix,
  -- owner-ul migrării (altfel condiția de proiect n-ar ajunge la tabelele lor)
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_lista
    FROM public.fn_executie_acces_inventar() i JOIN pg_proc p ON p.proname = i.obiect AND p.pronamespace = 'public'::regnamespace
   WHERE i.tip = 'functie' AND i.clasa = 'delega'
     AND (md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM i.cheie OR p.prosecdef IS NOT TRUE
          OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] OR pg_get_userbyid(p.proowner) IS DISTINCT FROM current_user
          OR p.prorettype IS DISTINCT FROM 'boolean'::regtype::oid);
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION '20261209a: functii de drept delegate cu alt corp / alte proprietati decat cele revizuite: %', v_lista;
  END IF;
  -- un tabel 'drept' care există cere funcția lui de drept (înlocuită aici sau delegată, din inventar); executie_acces_proiect (al acestei
  -- migrări) nu există încă aici
  SELECT string_agg(i.obiect, ', ' ORDER BY i.obiect) INTO v_lista
    FROM public.fn_executie_acces_inventar() i
   WHERE i.tip = 'tabel' AND i.clasa = 'drept' AND to_regclass('public.' || i.obiect) IS NOT NULL
     AND (NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname = i.cheie AND p.pronamespace = 'public'::regnamespace)
          OR NOT EXISTS (SELECT 1 FROM public.fn_executie_acces_inventar() f
                          WHERE f.tip = 'functie' AND f.obiect = i.cheie AND f.clasa IN ('drept', 'delega')));
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION '20261209a: tabele cu functie de drept lipsa sau necunoscuta: %', v_lista;
  END IF;
  -- poarta (pasul 6b): originalul, exact cel revizuit (L15), apelabil azi de authenticated
  IF NOT EXISTS (SELECT 1 FROM public.fn_executie_acces_inventar() i JOIN pg_proc p ON p.oid = to_regprocedure('public.fn_executie_swap_tevi_pozitie(bigint, bigint)')
                  WHERE i.tip = 'functie' AND i.obiect = 'fn_executie_swap_tevi_pozitie' AND i.clasa = 'poarta'
                    AND md5(replace(p.prosrc, chr(13), '')) = i.cheie
                    AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
                    AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp']
                    AND p.prorettype = 'void'::regtype::oid AND pg_get_userbyid(p.proowner) = current_user
                    AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     OR (SELECT count(*) FROM pg_proc WHERE proname = 'fn_executie_swap_tevi_pozitie') <> 1 THEN
    RAISE EXCEPTION '20261209a: fn_executie_swap_tevi_pozitie lipseste, are alt corp decat cel revizuit sau alte proprietati (nu se inlocuieste)';
  END IF;

  -- CATALOG 1: tabelele care ajung la un proiect (FK tranzitiv din executie_proiecte + coloane întregi proiect_id). Din cele 'exclus' /
  -- 'comun' nu se mai coboară (modulul lor își are dreptul / nu sunt date de proiect). Orice tabel găsit și neclasificat = refuz, cu lista.
  CREATE TEMP TABLE executie_acces_pre_tabele ON COMMIT DROP AS
  WITH RECURSIVE inv AS (SELECT * FROM public.fn_executie_acces_inventar()),
  noduri(rel) AS (
    SELECT 'public.executie_proiecte'::regclass::oid
    UNION
    SELECT a.attrelid FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
     WHERE a.attname = 'proiect_id' AND a.attnum > 0 AND NOT a.attisdropped AND a.atttypid IN ('int4'::regtype, 'int8'::regtype)
       AND c.relkind IN ('r', 'p') AND c.relnamespace = 'public'::regnamespace
    UNION
    -- copiii unui nod care nu e 'exclus' / 'comun' (pe nume sau pe prefix; numele are întâietate)
    SELECT k.conrelid FROM noduri n JOIN pg_constraint k ON k.confrelid = n.rel AND k.contype = 'f' AND k.conrelid <> n.rel
      JOIN pg_class c2 ON c2.oid = n.rel
     WHERE coalesce((SELECT i.clasa FROM inv i WHERE i.tip = 'tabel' AND i.obiect = c2.relname AND c2.relnamespace = 'public'::regnamespace),
                    (SELECT i.clasa FROM inv i WHERE i.tip = 'prefix_tabel' AND starts_with(c2.relname, i.obiect)
                       AND c2.relnamespace = 'public'::regnamespace), '-') NOT IN ('exclus', 'comun'))
  SELECT n.rel, c.relname::text AS nume, c.relnamespace = 'public'::regnamespace AS e_public,
         coalesce((SELECT i.clasa FROM inv i WHERE i.tip = 'tabel' AND i.obiect = c.relname AND c.relnamespace = 'public'::regnamespace),
                  (SELECT i.clasa FROM inv i WHERE i.tip = 'prefix_tabel' AND starts_with(c.relname, i.obiect)
                     AND c.relnamespace = 'public'::regnamespace)) AS clasa
    FROM noduri n JOIN pg_class c ON c.oid = n.rel;
  SELECT string_agg(n.nspname || '.' || c.relname, ', ' ORDER BY n.nspname, c.relname) INTO v_lista
    FROM executie_acces_pre_tabele t JOIN pg_class c ON c.oid = t.rel JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE t.clasa IS NULL;
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION '20261209a: tabele legate de proiecte si neclasificate in inventar (adauga-le cu clasa si motivul): %', v_lista;
  END IF;
  -- 'comun' = NU ajunge la date de proiect: afirmația se verifică pe TOATE tabelele clasei (pe nume sau pe prefix), nu doar pe cele găsite:
  -- fără coloană întreagă proiect_id și fără cheie străină spre executie_proiecte sau spre un tabel acoperit (proiect / copil / drept)
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_lista
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND coalesce((SELECT i.clasa FROM public.fn_executie_acces_inventar() i WHERE i.tip = 'tabel' AND i.obiect = c.relname),
                  (SELECT i.clasa FROM public.fn_executie_acces_inventar() i WHERE i.tip = 'prefix_tabel' AND starts_with(c.relname, i.obiect))) = 'comun'
     AND (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'proiect_id' AND a.attnum > 0 AND NOT a.attisdropped
                   AND a.atttypid IN ('int4'::regtype, 'int8'::regtype))
          OR EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f'
                      AND (k.confrelid = 'public.executie_proiecte'::regclass
                           OR k.confrelid IN (SELECT to_regclass('public.' || i.obiect) FROM public.fn_executie_acces_inventar() i
                                               WHERE i.tip = 'tabel' AND i.clasa IN ('proiect', 'copil', 'drept')))));
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION '20261209a: tabele clasificate „comun” care ajung totusi la date de proiect (proiect_id sau cheie straina spre un tabel acoperit): %', v_lista;
  END IF;
  -- CATALOG 2: vederile (și vederile peste vederi, tranzitiv) peste tabelele acoperite; refuz la cele citibile din API care NU citesc
  -- drept utilizatorul (fără security_invoker) sau sunt materializate
  CREATE TEMP TABLE executie_acces_pre_vederi ON COMMIT DROP AS
  WITH RECURSIVE baza AS (
    SELECT t.rel FROM executie_acces_pre_tabele t WHERE t.clasa IN ('proiect', 'copil', 'drept')
    UNION
    SELECT to_regclass('public.' || i.obiect)::oid FROM public.fn_executie_acces_inventar() i
     WHERE i.tip = 'tabel' AND i.clasa IN ('proiect', 'copil', 'drept') AND to_regclass('public.' || i.obiect) IS NOT NULL),
  dep(rel) AS (
    SELECT rw.ev_class FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid
     WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass AND d.refobjid IN (SELECT rel FROM baza) AND rw.ev_class <> d.refobjid
    UNION
    SELECT rw.ev_class FROM dep JOIN pg_depend d ON d.refobjid = dep.rel AND d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
      JOIN pg_rewrite rw ON rw.oid = d.objid WHERE rw.ev_class <> dep.rel)
  SELECT DISTINCT dep.rel, c.relname::text AS nume FROM dep JOIN pg_class c ON c.oid = dep.rel WHERE c.relkind IN ('v', 'm');
  SELECT string_agg(n.nspname || '.' || c.relname || CASE c.relkind WHEN 'm' THEN ' (materializata)' ELSE '' END, ', ' ORDER BY n.nspname, c.relname) INTO v_lista
    FROM executie_acces_pre_vederi v JOIN pg_class c ON c.oid = v.rel JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE (c.relkind = 'm' OR NOT EXISTS (SELECT 1 FROM unnest(coalesce(c.reloptions, '{}'::text[])) o
                                          WHERE lower(o) IN ('security_invoker=on', 'security_invoker=true', 'security_invoker=1', 'security_invoker=yes')))
     AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT'));
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION '20261209a: vederi fara security_invoker peste tabele acoperite, citibile din API (ar arata tuturor toate proiectele): %', v_lista;
  END IF;
  -- CATALOG 3: funcțiile SECURITY DEFINER din public, apelabile de anon / authenticated, care numesc un tabel / o vedere acoperită.
  -- Căutarea pe nume e doar DETECȚIE (refuz la neclasificat sau la alt corp decât cel revizuit); o funcție care construiește numele
  -- dinamic nu e găsită: limită scrisă în PR. r3: fără excluderi pe prefix — fiecare funcție găsită are numele și amprenta ei în listă.
  SELECT '\m(' || string_agg(DISTINCT x.nume, '|') || ')\M' INTO v_regex
    FROM (SELECT nume FROM executie_acces_pre_tabele WHERE clasa IN ('proiect', 'copil', 'drept') AND e_public
          UNION SELECT obiect FROM public.fn_executie_acces_inventar() WHERE tip = 'tabel' AND clasa IN ('proiect', 'copil', 'drept')
          UNION SELECT nume FROM executie_acces_pre_vederi) x;
  SELECT string_agg(format('%s [%s]', p.oid::regprocedure, md5(replace(p.prosrc, chr(13), ''))), ', ' ORDER BY p.proname) INTO v_lista
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     AND p.prosrc ~* v_regex
     AND NOT EXISTS (SELECT 1 FROM public.fn_executie_acces_inventar() i
                      WHERE i.tip = 'functie' AND i.obiect = p.proname AND i.cheie = md5(replace(p.prosrc, chr(13), '')));
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION '20261209a: functii SECURITY DEFINER care ating tabele acoperite, neclasificate sau cu alt corp decat cel revizuit: %', v_lista;
  END IF;
  DROP TABLE executie_acces_pre_vederi;
  DROP TABLE executie_acces_pre_tabele;
END $pre2$;

-- ── 1. tabelul ───────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.executie_acces_proiect (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id) ON DELETE RESTRICT,
  nivel text NOT NULL DEFAULT 'editor',
  acordat_de uuid,
  acordat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_acces_proiect_pk PRIMARY KEY (profile_id, proiect_id),
  CONSTRAINT executie_acces_proiect_nivel_ck CHECK (nivel IN ('viewer', 'editor'))
);
CREATE INDEX executie_acces_proiect_proiect_idx ON public.executie_acces_proiect (proiect_id);
COMMENT ON TABLE public.executie_acces_proiect IS
  'Execuție: proiectele unui cont restrâns. Cont fără rânduri = vede tot ce îi dă modulul; cu rânduri = doar acestea; owner = tot. '
  'Se scrie DOAR prin fn_executie_acces_proiect_seteaza (owner). 20261209a.';
COMMENT ON COLUMN public.executie_acces_proiect.nivel IS 'viewer = doar citire pe proiect; editor = citire + scriere (în limita dreptului pe modulul executie).';

-- proveniența (L08): acordat_de / acordat_la le pune serverul; identitatea rândului e imuabilă
CREATE FUNCTION public.fn_executie_acces_proiect_prov() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.profile_id, NEW.proiect_id) IS DISTINCT FROM (OLD.profile_id, OLD.proiect_id) THEN
    RAISE EXCEPTION 'acces proiect: contul și proiectul rândului nu se schimbă' USING ERRCODE = '23514';
  END IF;
  NEW.acordat_de := auth.uid();
  NEW.acordat_la := now();
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_acces_proiect_prov() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_acces_proiect_prov BEFORE INSERT OR UPDATE ON public.executie_acces_proiect
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_acces_proiect_prov();

-- ── 2. regula: O SINGURĂ definiție (L19) ──────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_executie_acces_e_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
$f$;
-- adevărat = apelantul NU e restrâns pe proiect (owner sau cont fără niciun rând). Fără auth.uid() = fals (L08).
-- Varianta B (bifă explicită „restrâns”) se schimbă DOAR aici: „cont fără bifă” în loc de „cont fără rânduri”.
CREATE FUNCTION public.fn_executie_acces_nerestrans() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR NOT EXISTS (SELECT 1 FROM public.executie_acces_proiect a WHERE a.profile_id = auth.uid()))
$f$;
-- proiectele listate pentru apelant (scriere = doar cele 'editor'); gol = niciunul (NU „toate”: „toate” e doar nerestrans())
CREATE FUNCTION public.fn_executie_acces_lista(p_scriere boolean) RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT coalesce(array_agg(a.proiect_id ORDER BY a.proiect_id), '{}'::bigint[])
    FROM public.executie_acces_proiect a
   WHERE auth.uid() IS NOT NULL AND p_scriere IS NOT NULL AND a.profile_id = auth.uid()
     AND (p_scriere IS FALSE OR a.nivel = 'editor')
$f$;
-- regula pe un proiect: pentru RPC-uri, trigger-e, funcțiile de drept și UI
CREATE FUNCTION public.fn_executie_proiect_permis(p_proiect bigint, p_scriere boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT p_scriere IS NOT NULL
    AND (public.fn_executie_acces_nerestrans()
         OR (p_proiect IS NOT NULL AND p_proiect = ANY (public.fn_executie_acces_lista(p_scriere))))
$f$;
-- un rând-copil: proiectul vine din părinte (citit ca proprietar, ca să nu depindă de politicile părintelui). Părinte inexistent = fals
-- pentru contul restrâns. 'raport': șantierul raportului; șantier fără proiect = permis (nu sunt date de proiect).
CREATE FUNCTION public.fn_executie_acces_parinte_permis(p_tip text, p_id bigint, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT p_tip IS NOT NULL AND p_scriere IS NOT NULL AND CASE p_tip
    WHEN 'sl' THEN public.fn_executie_proiect_permis((SELECT s.proiect_id::bigint FROM public.executie_situatii_plata s WHERE s.id = p_id), p_scriere)
    WHEN 'bon' THEN public.fn_executie_proiect_permis((SELECT b.proiect_id::bigint FROM public.executie_bonuri_consum b WHERE b.id = p_id), p_scriere)
    WHEN 'pachet' THEN public.fn_executie_proiect_permis((SELECT k.proiect_id::bigint FROM public.executie_pachete_lansare k WHERE k.id = p_id), p_scriere)
    WHEN 'cumulat' THEN public.fn_executie_proiect_permis((SELECT k.proiect_id::bigint FROM public.executie_pachete_cumulat_final k WHERE k.id = p_id), p_scriere)
    WHEN 'activitate' THEN public.fn_executie_proiect_permis((SELECT a.proiect_id::bigint FROM public.proiect_activitati a WHERE a.id = p_id), p_scriere)
    WHEN 'raport' THEN public.fn_executie_acces_nerestrans()
      OR EXISTS (SELECT 1 FROM public.rapoarte_zilnice r JOIN public.sites si ON si.id = r.site_id
                  WHERE r.id = p_id AND (si.proiect_id IS NULL OR public.fn_executie_proiect_permis(si.proiect_id::bigint, p_scriere)))
    ELSE false END
$f$;
-- setul părinților permiși unui cont restrâns: politicile copiilor îl folosesc ca „col IN (SELECT …)” necorelat = o evaluare pe
-- interogare (subplan cu hash), nu o căutare a părintelui pe fiecare rând (review r1 P2)
CREATE FUNCTION public.fn_executie_acces_parinti(p_tip text, p_scriere boolean) RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  WITH l AS (SELECT public.fn_executie_acces_lista(p_scriere) AS ids)
  SELECT s.id::bigint FROM public.executie_situatii_plata s, l WHERE p_tip = 'sl' AND s.proiect_id::bigint = ANY (l.ids)
  UNION ALL
  SELECT b.id::bigint FROM public.executie_bonuri_consum b, l WHERE p_tip = 'bon' AND b.proiect_id::bigint = ANY (l.ids)
  UNION ALL
  SELECT k.id::bigint FROM public.executie_pachete_lansare k, l WHERE p_tip = 'pachet' AND k.proiect_id::bigint = ANY (l.ids)
  UNION ALL
  SELECT k.id::bigint FROM public.executie_pachete_cumulat_final k, l WHERE p_tip = 'cumulat' AND k.proiect_id::bigint = ANY (l.ids)
  UNION ALL
  SELECT a.id::bigint FROM public.proiect_activitati a, l WHERE p_tip = 'activitate' AND a.proiect_id::bigint = ANY (l.ids)
  UNION ALL
  SELECT r.id::bigint FROM public.rapoarte_zilnice r JOIN public.sites si ON si.id = r.site_id CROSS JOIN l
   WHERE p_tip = 'raport' AND (si.proiect_id IS NULL OR si.proiect_id::bigint = ANY (l.ids))
$f$;
-- Storage: proiectele unui obiect, din cale (formele din inventar, ancorate) sau din tabelul care îl referă; formă necunoscută = {} (L13, L18)
CREATE FUNCTION public.fn_executie_acces_obiect_proiecte(p_bucket text, p_name text) RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT CASE
    WHEN p_bucket IS NULL OR p_name IS NULL OR position('..' IN p_name) > 0 THEN '{}'::bigint[]
    WHEN p_bucket = 'executie-contracte' THEN
      array_remove(ARRAY[coalesce(substring(p_name FROM '^([1-9][0-9]{0,17})/'),
                                  substring(p_name FROM '^(?:ordin-incepere|pccvi|probe-presiune)/([1-9][0-9]{0,17})/'))::bigint], NULL)
    WHEN p_bucket = 'executie-borderouri' THEN
      array_remove(ARRAY[substring(p_name FROM '^sl_([1-9][0-9]{0,17})/')::bigint], NULL)
    WHEN p_bucket = 'executie-pachete-pdf' AND p_name ~ '^[1-9][0-9]{0,17}/[1-9][0-9]{0,17}/aprobare/' THEN
      array_remove(ARRAY[(SELECT k.proiect_id::bigint FROM public.executie_pachete_lansare k
                           WHERE k.id = split_part(p_name, '/', 2)::bigint AND k.proiect_id::bigint = split_part(p_name, '/', 1)::bigint)], NULL)
    WHEN p_bucket = 'executie-pachete-pdf' THEN
      array_remove(ARRAY[(SELECT k.proiect_id::bigint FROM public.executie_pachete_lansare k
                           WHERE k.id = substring(p_name FROM '^([1-9][0-9]{0,17})/')::bigint)], NULL)
    WHEN p_bucket = 'documente-proiect' THEN
      coalesce((SELECT array_agg(DISTINCT d.proiect_id::bigint) FROM public.documente_proiect d
                 WHERE d.storage_path = p_name AND d.proiect_id IS NOT NULL), '{}'::bigint[])
    ELSE '{}'::bigint[] END
$f$;
-- EXECUTE: authenticated (politicile se evaluează în numele apelantului; UI-ul întreabă permis()); nimic pentru anon
REVOKE ALL ON FUNCTION public.fn_executie_acces_e_owner() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_acces_nerestrans() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_acces_lista(boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_proiect_permis(bigint, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_acces_parinte_permis(text, bigint, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_acces_parinti(text, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_acces_obiect_proiecte(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_acces_e_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_acces_nerestrans() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_acces_lista(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_proiect_permis(bigint, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_acces_parinte_permis(text, bigint, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_acces_parinti(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_acces_obiect_proiecte(text, text) TO authenticated;

-- RLS pe tabelul nou: owner vede tot, ceilalți doar rândurile proprii (ca UI-ul să știe ce i s-a dat); fără scriere directă (L07)
ALTER TABLE public.executie_acces_proiect ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_acces_proiect FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.executie_acces_proiect TO authenticated, service_role;
CREATE POLICY executie_acces_proiect_citire ON public.executie_acces_proiect FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (profile_id = (SELECT auth.uid()) OR (SELECT public.fn_executie_acces_e_owner())));

-- ── 3. setarea (owner): lista COMPLETĂ a unui cont, într-un singur pas (L01, L02, L03, L04, L08, L18) ─────────────
-- p_lista = [{"proiect_id": <id>, "nivel": "viewer"|"editor"}, …]: validată strict, fără dubluri, 1..500 elemente.
-- Canonicul: aceeași formă, sortată după proiect_id. Folosit pentru CAS (lista văzută de owner) și pentru idempotență.
CREATE FUNCTION public.fn_executie_acces_canon(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE e jsonb; v_ids bigint[] := ARRAY[]::bigint[]; v_out jsonb := '[]'::jsonb; v_id bigint;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'array' THEN
    RAISE EXCEPTION 'acces proiect: lista trebuie să fie un tablou' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p) > 500 THEN RAISE EXCEPTION 'acces proiect: cel mult 500 de proiecte' USING ERRCODE = '22023'; END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p) x LOOP
    -- pași separați: tipul, cheile, apoi valorile (fără să ne bazăm pe ordinea de evaluare a unui OR)
    IF jsonb_typeof(e) <> 'object' THEN RAISE EXCEPTION 'acces proiect: element invalid' USING ERRCODE = '22023'; END IF;
    IF NOT (e ?& ARRAY['proiect_id', 'nivel']) OR EXISTS (SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('proiect_id', 'nivel')) THEN
      RAISE EXCEPTION 'acces proiect: elementul cere exact proiect_id și nivel' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(e->'proiect_id') <> 'number' OR (e->>'proiect_id') !~ '^[1-9][0-9]{0,17}$'
       OR jsonb_typeof(e->'nivel') <> 'string' OR (e->>'nivel') NOT IN ('viewer', 'editor') THEN
      RAISE EXCEPTION 'acces proiect: proiect_id întreg pozitiv și nivel viewer / editor' USING ERRCODE = '22023';
    END IF;
    v_id := (e->>'proiect_id')::bigint;
    IF v_id = ANY (v_ids) THEN RAISE EXCEPTION 'acces proiect: proiectul % apare de două ori', v_id USING ERRCODE = '22023'; END IF;
    v_ids := v_ids || v_id;
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('proiect_id', (x->>'proiect_id')::bigint, 'nivel', x->>'nivel') ORDER BY (x->>'proiect_id')::bigint), '[]'::jsonb)
    INTO v_out FROM jsonb_array_elements(p) x;
  RETURN v_out;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_acces_canon(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Rezultat: {ok:true, duplicat, lista} sau {ok:false, motiv:'conflict', lista} (lista s-a schimbat între timp: UI-ul reîncarcă).
-- p_restrans = false scoate restricția (șterge toate rândurile contului = „vede tot”): doar explicit, cu p_lista = [].
-- p_restrans = true cu listă goală = REFUZ (ar însemna „vede tot” pe tăcute, L18).
CREATE FUNCTION public.fn_executie_acces_proiect_seteaza(p_profile uuid, p_restrans boolean, p_lista jsonb, p_lista_veche jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_owner boolean;
  v_tinta jsonb; v_veche jsonb; v_curent jsonb;
  v_lipsa bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'acces proiect: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF NOT public.fn_executie_acces_e_owner() THEN
    RAISE EXCEPTION 'acces proiect: doar owner-ul stabilește proiectele unui cont' USING ERRCODE = '42501';
  END IF;
  IF p_profile IS NULL OR p_restrans IS NULL THEN RAISE EXCEPTION 'acces proiect: parametri lipsă' USING ERRCODE = '22023'; END IF;
  -- validarea înaintea lock-urilor (nu ține nimic blocat pe o cerere greșită)
  v_tinta := public.fn_executie_acces_canon(p_lista);
  v_veche := public.fn_executie_acces_canon(p_lista_veche);
  IF p_restrans AND jsonb_array_length(v_tinta) = 0 THEN
    RAISE EXCEPTION 'acces proiect: lista goală ar da acces la TOATE proiectele; pentru asta folosește „scoate restricția”' USING ERRCODE = '22023';
  END IF;
  IF NOT p_restrans AND jsonb_array_length(v_tinta) <> 0 THEN
    RAISE EXCEPTION 'acces proiect: „scoate restricția” nu primește proiecte' USING ERRCODE = '22023';
  END IF;
  -- (1) lock pe cont, (2) rândul profilului (nu dispare în timpul scrierii), (3) rândurile contului
  PERFORM pg_advisory_xact_lock(hashtextextended('executie_acces_proiect:' || p_profile::text, 0));
  -- rândul altui modul (profiles): KEY SHARE (același lock pe care l-ar lua FK-ul la INSERT), NOWAIT: ocupat = 55P03, nimic scris
  SELECT p.is_owner INTO v_owner FROM public.profiles p WHERE p.id = p_profile FOR KEY SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'acces proiect: contul nu există' USING ERRCODE = '22023'; END IF;
  IF v_owner IS TRUE AND p_restrans THEN
    RAISE EXCEPTION 'acces proiect: un owner vede oricum toate proiectele' USING ERRCODE = '22023';
  END IF;
  SELECT x INTO v_lipsa FROM (SELECT (e->>'proiect_id')::bigint AS x FROM jsonb_array_elements(v_tinta) e) t
   WHERE NOT EXISTS (SELECT 1 FROM public.executie_proiecte ep WHERE ep.id = t.x) LIMIT 1;
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'acces proiect: proiectul % nu există', v_lipsa USING ERRCODE = '22023'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('proiect_id', a.proiect_id, 'nivel', a.nivel) ORDER BY a.proiect_id), '[]'::jsonb)
    INTO v_curent FROM public.executie_acces_proiect a WHERE a.profile_id = p_profile;
  -- idempotență (L04): starea cerută există deja = succesul de data trecută (și la reluarea aceleiași cereri)
  IF v_curent = v_tinta THEN
    RETURN jsonb_build_object('ok', true, 'duplicat', true, 'lista', v_curent);
  END IF;
  -- CAS (L01/L03): owner-ul a pornit de la altă listă decât cea de acum = conflict, nu suprascriere
  IF v_curent IS DISTINCT FROM v_veche THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'lista', v_curent);
  END IF;

  DELETE FROM public.executie_acces_proiect a
   WHERE a.profile_id = p_profile
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_tinta) e WHERE (e->>'proiect_id')::bigint = a.proiect_id);
  INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel)
  SELECT p_profile, (e->>'proiect_id')::bigint, e->>'nivel' FROM jsonb_array_elements(v_tinta) e ORDER BY (e->>'proiect_id')::bigint
  ON CONFLICT (profile_id, proiect_id) DO UPDATE SET nivel = EXCLUDED.nivel
   WHERE public.executie_acces_proiect.nivel IS DISTINCT FROM EXCLUDED.nivel;

  SELECT coalesce(jsonb_agg(jsonb_build_object('proiect_id', a.proiect_id, 'nivel', a.nivel) ORDER BY a.proiect_id), '[]'::jsonb)
    INTO v_curent FROM public.executie_acces_proiect a WHERE a.profile_id = p_profile;
  IF v_curent IS DISTINCT FROM v_tinta THEN
    RAISE EXCEPTION 'acces proiect: scrierea nu a dat lista cerută' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'lista', v_curent);
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_acces_proiect_seteaza(uuid, boolean, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_acces_proiect_seteaza(uuid, boolean, jsonb, jsonb) TO authenticated;

-- ── 4. garda de scriere: trigger BEFORE pe OLD / NEW (L07) ──────────────────────────────────
-- 'proiect': argumentul = coloana de proiect. UPDATE verifică ȘI proiectul vechi, ȘI pe cel nou (mutarea pe alt proiect).
CREATE FUNCTION public.fn_executie_acces_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_vechi bigint; v_nou bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    -- calea server (fără JWT): comportamentul de azi; restricția e pe cont
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_NARGS <> 1 THEN RAISE EXCEPTION 'acces proiect: trigger configurat greșit pe %', TG_TABLE_NAME; END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_vechi := (to_jsonb(OLD) ->> TG_ARGV[0])::bigint;
    IF NOT public.fn_executie_proiect_permis(v_vechi, true) THEN
      RAISE EXCEPTION 'Execuție: nu ai drept de scriere pe acest proiect' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN
    v_nou := (to_jsonb(NEW) ->> TG_ARGV[0])::bigint;
    IF NOT public.fn_executie_proiect_permis(v_nou, true) THEN
      RAISE EXCEPTION 'Execuție: nu ai drept de scriere pe acest proiect' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $f$;
-- 'copil': argumentele = tipul părintelui + coloana spre părinte; părintele se citește prin fn_executie_acces_parinte_permis (DEFINER).
-- Scrierea e pe rând (o căutare pe PK a părintelui pe fiecare rând scris); citirea folosește setul, nu căutarea pe rând.
CREATE FUNCTION public.fn_executie_acces_garda_copil() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_NARGS <> 2 OR TG_ARGV[0] NOT IN ('sl', 'bon', 'pachet', 'raport', 'cumulat', 'activitate') THEN
    RAISE EXCEPTION 'acces proiect: trigger configurat greșit pe %', TG_TABLE_NAME;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND public.fn_executie_acces_parinte_permis(TG_ARGV[0], (to_jsonb(OLD) ->> TG_ARGV[1])::bigint, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'Execuție: nu ai drept de scriere pe acest proiect' USING ERRCODE = '42501';
  END IF;
  IF TG_OP IN ('UPDATE', 'INSERT')
     AND public.fn_executie_acces_parinte_permis(TG_ARGV[0], (to_jsonb(NEW) ->> TG_ARGV[1])::bigint, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'Execuție: nu ai drept de scriere pe acest proiect' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_acces_garda() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_acces_garda_copil() FROM PUBLIC, anon, authenticated, service_role;

-- ── 5. politicile RESTRICTIVE + trigger-ele, din inventar; Storage pe bucket-urile 'cale' / 'tabel' ──────────────
-- Forma „(SELECT …)” = o singură evaluare pe interogare (initplan), nu pe rând; la copii „col IN (SELECT setul părinților)” necorelat.
DO $pol$
DECLARE r record; v_cit text; v_scr text; v_bk text;
BEGIN
  FOR r IN SELECT * FROM public.fn_executie_acces_inventar() WHERE tip = 'tabel' AND clasa IN ('proiect', 'copil') ORDER BY obiect LOOP
    IF r.clasa = 'proiect' THEN
      v_cit := format('(SELECT public.fn_executie_acces_nerestrans()) OR %I = ANY ((SELECT public.fn_executie_acces_lista(false))::bigint[])', r.cheie);
      v_scr := format('(SELECT public.fn_executie_acces_nerestrans()) OR %I = ANY ((SELECT public.fn_executie_acces_lista(true))::bigint[])', r.cheie);
    ELSE
      v_cit := format('(SELECT public.fn_executie_acces_nerestrans()) OR %I IN (SELECT public.fn_executie_acces_parinti(%L, false))', r.cheie, r.parinte);
      v_scr := format('(SELECT public.fn_executie_acces_nerestrans()) OR %I IN (SELECT public.fn_executie_acces_parinti(%L, true))', r.cheie, r.parinte);
    END IF;
    EXECUTE format('CREATE POLICY executie_acces_citire ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (%s)', r.obiect, v_cit);
    EXECUTE format('CREATE POLICY executie_acces_adauga ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s)', r.obiect, v_scr);
    EXECUTE format('CREATE POLICY executie_acces_modifica ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', r.obiect, v_scr, v_scr);
    EXECUTE format('CREATE POLICY executie_acces_sterge ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (%s)', r.obiect, v_scr);
    IF r.clasa = 'proiect' THEN
      EXECUTE format('CREATE TRIGGER trg_executie_acces_garda BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_executie_acces_garda(%L)',
                     r.obiect, r.cheie);
    ELSE
      EXECUTE format('CREATE TRIGGER trg_executie_acces_garda BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_executie_acces_garda_copil(%L, %L)',
                     r.obiect, r.parinte, r.cheie);
    END IF;
  END LOOP;
  -- Storage: doar bucket-urile 'cale' / 'tabel'; alt bucket trece neatins (prima condiție)
  SELECT string_agg(quote_literal(obiect), ', ' ORDER BY obiect) INTO v_bk FROM public.fn_executie_acces_inventar() WHERE tip = 'bucket' AND clasa IN ('cale', 'tabel');
  v_cit := format('bucket_id <> ALL (ARRAY[%s]::text[]) OR (SELECT public.fn_executie_acces_nerestrans()) '
                  'OR public.fn_executie_acces_obiect_proiecte(bucket_id, name) && (SELECT public.fn_executie_acces_lista(false))', v_bk);
  v_scr := format('bucket_id <> ALL (ARRAY[%s]::text[]) OR (SELECT public.fn_executie_acces_nerestrans()) '
                  'OR (cardinality(public.fn_executie_acces_obiect_proiecte(bucket_id, name)) > 0 '
                  'AND public.fn_executie_acces_obiect_proiecte(bucket_id, name) <@ (SELECT public.fn_executie_acces_lista(true)))', v_bk);
  EXECUTE format('CREATE POLICY executie_acces_obiect_citire ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING (%s)', v_cit);
  EXECUTE format('CREATE POLICY executie_acces_obiect_adauga ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s)', v_scr);
  EXECUTE format('CREATE POLICY executie_acces_obiect_modifica ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', v_scr, v_scr);
  EXECUTE format('CREATE POLICY executie_acces_obiect_sterge ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING (%s)', v_scr);
END $pol$;

-- ── 6. funcțiile de drept: aceeași regulă de modul + condiția de proiect (CREATE OR REPLACE păstrează owner / ACL) ──
CREATE OR REPLACE FUNCTION public.fn_executie_nod_drept(p_proiect bigint, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_scriere IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie'
                       AND (u.access_level IN ('editor', 'admin') OR (p_scriere IS FALSE AND u.access_level = 'viewer'))))
    AND public.fn_executie_proiect_permis(p_proiect, p_scriere)
$f$;
CREATE OR REPLACE FUNCTION public.fn_executie_contract_drept(p_proiect bigint, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_scriere IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie'
                       AND (u.access_level = 'admin' OR (p_scriere IS FALSE AND u.access_level IN ('viewer', 'editor')))))
    AND public.fn_executie_proiect_permis(p_proiect, p_scriere)
$f$;
CREATE OR REPLACE FUNCTION public.fn_executie_grafic_drept(p_proiect bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie' AND u.access_level IN ('viewer', 'editor', 'admin')))
    AND public.fn_executie_proiect_permis(p_proiect, false)
$f$;
CREATE OR REPLACE FUNCTION public.fn_executie_tinte_drept(p_proiect bigint, p_nivel text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_nivel IN ('citire', 'configurare')
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie'
                       AND (u.access_level IN ('editor', 'admin') OR (p_nivel = 'citire' AND u.access_level = 'viewer')))
         OR (p_nivel = 'citire' AND EXISTS (
               SELECT 1 FROM public.profile_sites ps JOIN public.sites s ON s.id = ps.site_id
                WHERE ps.profile_id = auth.uid() AND s.proiect_id = p_proiect
                  AND (ps.valid_until IS NULL OR ps.valid_until >= (now() AT TIME ZONE 'Europe/Bucharest')::date))))
    AND public.fn_executie_proiect_permis(p_proiect, p_nivel = 'configurare')
$f$;
-- raportul zilnic (20261208a): șantierul unui proiect din afara listei = fără raport (citire și salvare); șantier fără proiect = ca înainte
CREATE OR REPLACE FUNCTION public.fn_raport_santier_drept(p_site bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_site IS NOT NULL
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.profile_sites ps WHERE ps.profile_id = auth.uid() AND ps.site_id = p_site
                      AND (ps.valid_until IS NULL OR ps.valid_until >= (now() AT TIME ZONE 'Europe/Bucharest')::date)))
    AND (public.fn_executie_acces_nerestrans()
         OR EXISTS (SELECT 1 FROM public.sites s WHERE s.id = p_site
                     AND (s.proiect_id IS NULL OR public.fn_executie_proiect_permis(s.proiect_id::bigint, false))))
$f$;

-- ── 6b. poarta pe proiect pentru fn_executie_swap_tevi_pozitie (creată direct în BD; amprenta verificată în preflight) ──
-- Originalul NU se rescrie și nu se copiază: se mută neschimbat (corp, owner, drepturi, OID) în schema internă executie_acces_intern, la
-- care clienții n-au USAGE (deci nu-l mai pot apela direct), iar în public rămâne poarta, cu același nume, aceiași parametri și același
-- tip întors (apelurile din UI nu se schimbă). Revenirea îl mută înapoi.
-- Ordinea (L06): poarta doar CITEȘTE țevile și pachetele (fără lock-uri), apoi originalul blochează cele două țevi FOR UPDATE și le scrie;
-- scrierea trece prin trigger-ul de gardă al lui executie_tevi ('copil' pe pachet), care reverifică proiectul pe rândul curent (garanția
-- finală, și la o mutare concurentă a țevii pe alt pachet).
CREATE SCHEMA executie_acces_intern;
COMMENT ON SCHEMA executie_acces_intern IS 'Execuție / acces pe proiect (20261209a): originalele funcțiilor cu poartă în public; fără USAGE pentru clienți.';
REVOKE ALL ON SCHEMA executie_acces_intern FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.fn_executie_swap_tevi_pozitie(bigint, bigint) SET SCHEMA executie_acces_intern;
CREATE FUNCTION public.fn_executie_swap_tevi_pozitie(p_id_a bigint, p_id_b bigint) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  -- cont restrâns: proiectul pachetului FIECĂREI țevi trebuie să fie pe lista lui, cu scriere; țeavă sau pachet inexistent = același
  -- refuz (nu spune ce există la alt proiect, L09). Fără JWT sau cont nerestrâns: exact originalul (aceleași mesaje ca azi).
  IF auth.uid() IS NOT NULL AND NOT public.fn_executie_acces_nerestrans()
     AND EXISTS (SELECT 1 FROM unnest(ARRAY[p_id_a, p_id_b]) x(id)
                  WHERE public.fn_executie_proiect_permis(
                          (SELECT k.proiect_id::bigint FROM public.executie_tevi t JOIN public.executie_pachete_lansare k ON k.id = t.pachet_id
                            WHERE t.id = x.id), true) IS NOT TRUE) THEN
    RAISE EXCEPTION 'Execuție: nu ai drept de scriere pe acest proiect' USING ERRCODE = '42501';
  END IF;
  PERFORM executie_acces_intern.fn_executie_swap_tevi_pozitie(p_id_a, p_id_b);
END $f$;
-- drepturile porții: authenticated (ca originalul, cerut în preflight) + service_role dacă originalul îl avea; niciodată anon / PUBLIC
REVOKE ALL ON FUNCTION public.fn_executie_swap_tevi_pozitie(bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_swap_tevi_pozitie(bigint, bigint) TO authenticated;
DO $poarta$
BEGIN
  IF has_function_privilege('service_role', 'executie_acces_intern.fn_executie_swap_tevi_pozitie(bigint, bigint)', 'EXECUTE') THEN
    GRANT EXECUTE ON FUNCTION public.fn_executie_swap_tevi_pozitie(bigint, bigint) TO service_role;
  END IF;
END $poarta$;

-- ── postcondiții ──
DO $post$
DECLARE v_rel oid := 'public.executie_acces_proiect'::regclass; r record; v_n integer;
BEGIN
  -- tabelul nou: RLS, o politică de citire, doar SELECT pentru authenticated / service_role
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) IS NOT TRUE
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_acces_proiect') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_acces_proiect'
                     AND policyname = 'executie_acces_proiect_citire' AND cmd = 'SELECT' AND roles = '{authenticated}' AND permissive = 'PERMISSIVE') THEN
    RAISE EXCEPTION '20261209a post: RLS / politica tabelului nou';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) rl, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pv
              WHERE has_table_privilege(rl, v_rel, pv))
     OR has_table_privilege('anon', v_rel, 'SELECT')
     OR NOT has_table_privilege('authenticated', v_rel, 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION '20261209a post: privilegii pe tabelul nou';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = v_rel AND tgname = 'trg_executie_acces_proiect_prov' AND tgenabled = 'O') THEN
    RAISE EXCEPTION '20261209a post: trigger-ul de proveniență';
  END IF;
  -- funcțiile noi: exact 13, DEFINER doar unde trebuie, search_path fix, EXECUTE doar unde trebuie
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND (p.proname LIKE 'fn\_executie\_acces\_%' OR p.proname = 'fn_executie_proiect_permis')) <> 13
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND (p.proname LIKE 'fn\_executie\_acces\_%' OR p.proname = 'fn_executie_proiect_permis')
                   AND (p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                        OR p.prosecdef IS DISTINCT FROM (p.proname IN ('fn_executie_acces_e_owner', 'fn_executie_acces_nerestrans', 'fn_executie_acces_lista',
                                                                       'fn_executie_proiect_permis', 'fn_executie_acces_parinte_permis', 'fn_executie_acces_parinti',
                                                                       'fn_executie_acces_obiect_proiecte', 'fn_executie_acces_proiect_seteaza'))
                        OR pg_get_userbyid(p.proowner) IS DISTINCT FROM current_user
                        OR has_function_privilege('anon', p.oid, 'EXECUTE')
                        OR has_function_privilege('service_role', p.oid, 'EXECUTE')
                        OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM
                           (p.proname NOT IN ('fn_executie_acces_proiect_prov', 'fn_executie_acces_canon', 'fn_executie_acces_garda',
                                              'fn_executie_acces_garda_copil', 'fn_executie_acces_inventar')))) THEN
    RAISE EXCEPTION '20261209a post: functii noi (definer / search_path / EXECUTE)';
  END IF;
  -- tabelele acoperite: 4 politici RESTRICTIVE pentru authenticated, fiecare legată (pg_depend, nu text) de funcțiile regulii;
  -- trigger-ul activ, cu argumentele lui
  FOR r IN SELECT i.*, CASE WHEN i.clasa = 'proiect' THEN encode(convert_to(i.cheie, 'UTF8'), 'hex') || '00'
                            ELSE encode(convert_to(i.parinte, 'UTF8'), 'hex') || '00' || encode(convert_to(i.cheie, 'UTF8'), 'hex') || '00' END AS args_hex
             FROM public.fn_executie_acces_inventar() i WHERE i.tip = 'tabel' AND i.clasa IN ('proiect', 'copil') LOOP
    SELECT count(*) INTO v_n FROM pg_policy pol
     WHERE pol.polrelid = to_regclass('public.' || r.obiect) AND pol.polname LIKE 'executie\_acces\_%'
       AND NOT pol.polpermissive AND pol.polroles = ARRAY['authenticated'::regrole]::oid[]
       AND ((pol.polname = 'executie_acces_citire' AND pol.polcmd = 'r' AND pol.polqual IS NOT NULL AND pol.polwithcheck IS NULL)
         OR (pol.polname = 'executie_acces_adauga' AND pol.polcmd = 'a' AND pol.polqual IS NULL AND pol.polwithcheck IS NOT NULL)
         OR (pol.polname = 'executie_acces_modifica' AND pol.polcmd = 'w' AND pol.polqual IS NOT NULL AND pol.polwithcheck IS NOT NULL)
         OR (pol.polname = 'executie_acces_sterge' AND pol.polcmd = 'd' AND pol.polqual IS NOT NULL AND pol.polwithcheck IS NULL))
       AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_policy'::regclass AND d.objid = pol.oid AND d.refclassid = 'pg_proc'::regclass
                    AND d.refobjid = 'public.fn_executie_acces_nerestrans()'::regprocedure)
       AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_policy'::regclass AND d.objid = pol.oid AND d.refclassid = 'pg_proc'::regclass
                    AND d.refobjid = CASE r.clasa WHEN 'proiect' THEN 'public.fn_executie_acces_lista(boolean)'::regprocedure
                                                  ELSE 'public.fn_executie_acces_parinti(text, boolean)'::regprocedure END);
    IF v_n <> 4
       OR (SELECT count(*) FROM pg_policy WHERE polrelid = to_regclass('public.' || r.obiect) AND polname LIKE 'executie\_acces\_%') <> 4
       OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = to_regclass('public.' || r.obiect) AND tg.tgname = 'trg_executie_acces_garda'
                       AND tg.tgenabled = 'O' AND tg.tgnargs = CASE r.clasa WHEN 'proiect' THEN 1 ELSE 2 END AND tg.tgqual IS NULL
                       AND tg.tgfoid = CASE r.clasa WHEN 'proiect' THEN 'public.fn_executie_acces_garda()'::regprocedure
                                                    ELSE 'public.fn_executie_acces_garda_copil()'::regprocedure END
                       AND tg.tgtype = (1 | 2 | 4 | 8 | 16)   -- ROW, BEFORE, INSERT, DELETE, UPDATE
                       AND encode(tg.tgargs, 'hex') = r.args_hex) THEN
      RAISE EXCEPTION '20261209a post: politicile / trigger-ul pe %', r.obiect;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_executie_acces_garda')
     <> (SELECT count(*) FROM public.fn_executie_acces_inventar() WHERE tip = 'tabel' AND clasa IN ('proiect', 'copil')) THEN
    RAISE EXCEPTION '20261209a post: numarul trigger-elor de garda';
  END IF;
  -- Storage: exact 4 politici RESTRICTIVE, legate de regula și de rezolvarea obiectului
  IF (SELECT count(*) FROM pg_policy pol WHERE pol.polrelid = 'storage.objects'::regclass AND pol.polname LIKE 'executie\_acces\_%') <> 4
     OR (SELECT count(*) FROM pg_policy pol WHERE pol.polrelid = 'storage.objects'::regclass AND NOT pol.polpermissive
           AND pol.polroles = ARRAY['authenticated'::regrole]::oid[]
           AND pol.polname IN ('executie_acces_obiect_citire', 'executie_acces_obiect_adauga', 'executie_acces_obiect_modifica', 'executie_acces_obiect_sterge')
           AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_policy'::regclass AND d.objid = pol.oid
                        AND d.refobjid = 'public.fn_executie_acces_obiect_proiecte(text, text)'::regprocedure)
           AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_policy'::regclass AND d.objid = pol.oid
                        AND d.refobjid = 'public.fn_executie_acces_nerestrans()'::regprocedure)) <> 4 THEN
    RAISE EXCEPTION '20261209a post: politicile Storage';
  END IF;
  -- funcțiile de drept: corpul nou revizuit (amprentă fără CR) + aceleași proprietăți și ACL ca înainte
  IF EXISTS (SELECT 1 FROM (VALUES
               ('public.fn_executie_nod_drept(bigint, boolean)', '1f0faa030d0459412aafb6e1a024beff', true, true),
               ('public.fn_executie_contract_drept(bigint, boolean)', 'f3c3dc6add32d563682494e804864e99', true, true),
               ('public.fn_executie_grafic_drept(bigint)', '5df5d4ecce38a81472fc4f17cf410b97', true, true),
               ('public.fn_executie_tinte_drept(bigint, text)', '9bc9c10212d8f0a7ca5ad94e0220c7c2', false, true),
               ('public.fn_raport_santier_drept(bigint)', '640bdc86e81468fc7c5025f6eb54a23f', false, false)) a(semnatura, amprenta, cu_service, cu_auth)
              LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
              WHERE p.oid IS NULL
                 OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
                 OR p.prosecdef IS NOT TRUE
                 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                 OR p.provolatile IS DISTINCT FROM 's'
                 OR pg_get_userbyid(p.proowner) IS DISTINCT FROM current_user
                 OR has_function_privilege('anon', p.oid, 'EXECUTE')
                 OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.cu_auth
                 OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM a.cu_service) THEN
    RAISE EXCEPTION '20261209a post: functiile de drept (corp / proprietati / EXECUTE)';
  END IF;
  -- poarta (6b): originalul neschimbat în schema internă, poarta revizuită în public, schema fără USAGE pentru clienți
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN public.fn_executie_acces_inventar() i ON i.tip = 'functie' AND i.obiect = 'fn_executie_swap_tevi_pozitie'
                  WHERE p.oid = to_regprocedure('executie_acces_intern.fn_executie_swap_tevi_pozitie(bigint, bigint)')
                    AND md5(replace(p.prosrc, chr(13), '')) = i.cheie AND p.prosecdef AND pg_get_userbyid(p.proowner) = current_user)
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_executie_swap_tevi_pozitie(bigint, bigint)')
                     AND md5(replace(p.prosrc, chr(13), '')) = '747c0be4a0fe0b29d16d470233d072e5'
                     AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = current_user
                     AND p.prorettype = 'void'::regtype::oid
                     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                         = has_function_privilege('service_role', 'executie_acces_intern.fn_executie_swap_tevi_pozitie(bigint, bigint)', 'EXECUTE'))
     OR (SELECT count(*) FROM pg_proc WHERE proname = 'fn_executie_swap_tevi_pozitie') <> 2
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'executie_acces_intern')) <> 1
     OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'executie_acces_intern'))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) rl
                 WHERE has_schema_privilege(rl, 'executie_acces_intern', 'USAGE') OR has_schema_privilege(rl, 'executie_acces_intern', 'CREATE'))
     OR pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname = 'executie_acces_intern')) IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION '20261209a post: poarta fn_executie_swap_tevi_pozitie (original / poarta / schema interna)';
  END IF;
  -- nicio dată: niciun cont nu e restrâns după migrare
  IF EXISTS (SELECT 1 FROM public.executie_acces_proiect) THEN
    RAISE EXCEPTION '20261209a post: migrarea nu scrie date';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261209a_executie_acces_proiect:' || txid_current() THEN
    RAISE EXCEPTION '20261209a: garda final invalida';
  END IF;
END $post$;
