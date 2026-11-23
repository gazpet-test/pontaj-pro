-- DRY 20270105a_executie_rest_decontat: se ruleaza DUPA aplicarea migrarii, intr-o singura tranzactie cu ROLLBACK la final (nimic ramane),
-- pe clona PG17 (psql -v ON_ERROR_STOP=1 -f) sau pe PGlite (scripts/pglite/test_executie_rest_decontat_local.mjs). Fiecare bloc scrie
-- NOTICE '<bloc> ok …'; orice abatere = exceptie. Valorile asteptate vin din plan / spec (bazele 100 m, 120, 125, 200 MC; decontat 120, rest -20),
-- nu din codul testat (L25). Identitatea: ambele surse JWT + SET LOCAL ROLE authenticated, verificate la fiecare bloc (auth.uid, current_user,
-- rol fara BYPASSRLS). Conturi SINTETICE (uuid-uri f0000000-…): a = owner, b = managerul proiectului P1 si P3, c = director financiar
-- (executie_rest_decontat viewer), d = editor pe sub-modul, e = sef de santier (executie viewer + santierul P1, NU are sub-modulul),
-- f = responsabilul de contracte al P1 (executie viewer), g = fara drepturi, h = editor pe sub-modul RESTRANS (20261209a) la P2 ca viewer,
-- i = editor pe sub-modul RESTRANS la P2 ca editor. Proiecte: P1 (cu oferta, dupa primul bloc), P2 (alt MP), P3 (fara oferta), P4 (al owner-ului:
-- coduri repetate, lista completa pe identitate canonica, ultimul act, note neaprobate), P5 (un rand confirmat scris de SERVER in fixturi, pentru
-- garda in sesiune proaspata).
-- SURSELE (r3, review #1158): t_surse_autorizate = accesul general Executie (e) nu aduce in baza un rand NR / NCS / AA scris direct (INSERT sau
-- schimbarea sursei), apoi, ca SERVER (auth.uid() NULL), CHECK-ul refuza randul orfan / neconfirmat independent de garda; t_rand_orfan (ultimul
-- bloc) = apararea in adancime: cu CHECK-ul scos intr-un sub-bloc anulat, randurile orfane / neconfirmate nu intra in calcul si apar in lipsuri.
-- STARILE OFERTEI, PE OBIECT (r4 → r5, review #1158: P1 r3 reimportul vechi dubla baza confirmata; P1 r4 regula pe proiect retragea obiectele neimportate
-- si lasa randurile retrase vizibile consumatorilor vechi): t_oferta_confirmata = pe P3 (toate obiectele „vechi”) calea veche (accesul general e)
-- scrie / modifica / sterge randuri contract_initial pe DOUA obiecte (0001 si 0002) si garda tine advisory-ul proiectului (pg_locks); pe P1 (obiectul
-- 0001 confirmat) INSERT-ul direct pe 0001 si reparentarea unui rand din P3 spre P1 / 0001 sunt refuzate (42501, mesaj „Rest de decontat”), iar un obiect
-- NOU al P1 ramane pe calea veche; MP-ul confirma prin RPC DOAR obiectul 0001 al P3 (import PARTIAL) → randurile vechi ale lui 0001 MUTATE in istoric
-- (inlocuite = 3), obiectul 0002 ramane in baza cu valoarea veche si apare in lipsuri ('oferta_neconfirmata'); CITITORII VECHI ai tabelului (pg_temp.rd_cititori:
-- ActivitatiProiectPanel / verificariProiect = sursa <> extras_materiale; 20261208a = sursa contract_initial pe obiect; 20270105b = contract_initial activ;
-- CatalogDevizPanel = tot, activ <> false; DevizVsExecutatTab = obiectele distincte) vad pe 0002 acelasi rezultat ca inainte si pe 0001 exact randurile
-- confirmate (fara randuri retrase); pe 0001 calea veche e inchisa (INSERT / UPDATE / DELETE / mutarea unui rand spre 0001 → 42501), pe 0002 merge;
-- re-importul lui 0001 fara „inlocuieste” = 23505, „inlocuieste” fara obiect confirmat = 22023, confirmarea tarzie a lui 0002 trece (fara 23505) si
-- „inlocuieste” pe 0001 muta randurile confirmate in istoric (inlocuite_confirmate = 2) — cu aceleasi linii, cititorii vechi vad EXACT acelasi rezultat ca
-- inainte; ca SERVER, un rand neconfirmat strecurat pe 0001 nu intra in calcul si apare in lipsuri ('oferta_veche_neconfirmata'); oferta confirmata RETRASA
-- (activ = false) sau SCOASA de server (ramasa doar in istoric) tine calea veche tot inchisa pe obiect.
-- r6 (review #1158: 2 x P1 + P2 pe r5): liniile RPC pentru 0001 vin cu obiect_cod „ 0001 ” (spatii) si B200 in „MC” x 200 (= 2 x „100 MC”, randul vechi):
-- randul confirmat se scrie in REPREZENTAREA EXISTENTA (obiect_cod '0001', um '100 MC', cantitate 2, pret 1000), deci cititorii vechi vad pe 0001 exact
-- 2 randuri / 102 / 12000 (ca si cand ar fi fost scrise la fel); fisierul A (b3) inlocuit de B (b4) ramane „deja confirmat” (A -> B -> A = 23505);
-- t_um_inlocuire (pe P1 / 0001 cu decontat): inlocuirea cu A100 in „100 MC” (cheie decontata in M) = 22023 um_decontat, si cu
-- accept_schimbare_um; cu A100 in „HM” x 1 (echivalent prin factor) trece si se scrie 'M' x 100; D400|#7 in BUC (fara decontat) = 22023 um_schimbat fara
-- accept, trece cu accept (um_schimbate); obiectul nou ' st-3 ' al P3 se scrie 'St-3' (unitatea din proiect_unitati); cantitatea nereprezentabila = refuz.
-- r7 (review #1158: 2 x P1 pe r6 — codul brut schimba tintele prefixelor; forma „majoritara pe obiect” scoate un rand din tinta unei unitati): regula e PE CHEIE,
-- PE FIECARE CAMP. t_ultimul_act: serverul rescrie AMBELE randuri ale cheii OB1|D1|X (oferta + NCS-9) cu ' ob1 ' — o singura forma pe cheie, forme amestecate
-- pe obiect —, iar randul AA-4 al cheii e scris ' ob1 ' (forma randului cu aceeasi cheie, nu a obiectului). t_um_inlocuire: liniile echivalente vin si cu
-- deviz ' d1 ', cod 'a100 ' / nr ' 1' (toate copiate din randul cheii). t_reprezentare_cheie (ultimele blocuri, P6, reproducerile Jakarinos r6): oferta veche
-- 'O1/D1/1/TSA01 M' + 'o1/D1/2a/Y 100 MC', unitatea legata la 'o1'; RPC-ul primeste ' o1 '/' d1 '/' 1'/' tsa01 ' HM x 1 si 'O1'/'D1'/'2A'/'y' MC x 200 →
-- randurile scrise sunt IDENTICE cu cele vechi (fiecare camp copiat din randul cheii), cititorii vechi (prefixul TSA, JOIN-ul unitatii pe 'o1', lista
-- obiectelor O1 / o1) neschimbati; a doua forma a aceleiasi chei (strecurata de server) = 22023 forme_multiple cu cheia si formele, nimic scris; o cheie NOUA
-- (' z  z ') se scrie normalizata ('z z', deviz 'd1', um 'buc') cu obiect_cod-ul unitatii ('o1': obiectul are forme amestecate).
-- r8 (review #1158: 2 x P1 + P2 pe r7). t_import_vechi_repetat (P7): accesul general (e) scrie oferta pe calea veche in mai multe cereri (ca loturile de 200 ale
-- catalogului), cu un cod repetat taiat de lot → toate randurile grupului primesc pozitia in cheie (si cele scrise in lotul anterior, re-cheiate), ca la
-- backfill-ul migrarii; doua repetari in aceeasi instructiune la fel; acelasi cod in alt deviz nu e repetat; baza tine pozitiile separate; functia de
-- re-cheiere apelata direct = 42501. t_pozitie (P6 / P7): pozitia nu participa la identitate, dar se copiaza exact — o confirmare cu ALTA pozitie pe o cheie
-- existenta = 22023 nr_schimbat, nimic scris; fara nr → copiata; doua pozitii stocate de server sub aceeasi cheie → 22023 forme_multiple la o linie insumata
-- (reproducerile Jakarinos r7). Cititorii cu plafonul API si importul vechi fata de backfill se probeaza in PGlite (§9), nu aici.
-- r9 (review #1158: 2 x P1 pe r8 — re-cheierea pe calea veche si RPC-ul schimbau identitatea unei chei cu decontat confirmat). t_cheie_referita (P8, MP b), TOATE
-- caile care pot schimba o cheie sau pot lasa o cheie referita fara baza: (1/4) calea veche — al doilea TSA01 dupa o situatie pe O1|D1|TSA01 = 23514 cheie_referita
-- (reproducerea 1), schimbarea directa a codului / a cheii randului referit = refuz, schimbarile care nu ating cheia si re-cheierea unui cod NEreferit trec,
-- stergerea randului referit (obiect vechi) trece dar lipsurile declara decontat_fara_articol si re-scrierea stinge lipsa; (2/4) RPC — linia fara pozitie peste
-- doua chei referite = refuz, inlocuirea care scoate pozitia 2 pastreaza #1 (reproducerea 2) si declara #2 (lipsuri + decontat_fara_baza), codul decontat
-- despartit in pozitii = refuz, re-atasarea stinge lipsa; (3/4) AA lista completa — linia fara pozitie ia unica cheie referita (#1), lista completa fara #2 il
-- declara, urmatoarea lista completa cu #1 / #2 il readuce; (4/4) dezactivarea actului (owner) readuce lipsa / reactivarea o stinge, SERVERUL nu schimba nici el
-- cheia referita, iar inlocuirea situatiei (fara linia pe cheie) dezgheata cheia (despartirea in pozitii trece apoi). Backfill-ul: tabelele situatiilor sunt
-- goale la aplicare (postconditia migrarii).
-- r10 (review #1158: P1 + P2 pe r9). t_um_decontat (P8): O SINGURA validare a UM-ului fata de decontatul cheii (fn_rest_decontat_um_decontat_diferit), pe TOATE
-- caile prin care o linie de baza noua ajunge pe o cheie cu decontat: (1/3) O1|D1|TSA01 (80 M decontati, situatia 1) ramane fara baza (randul vechi sters pe calea
-- veche) → calea veche cu MC = 23514 um_decontat (INSERT; si UPDATE-ul UM-ului pe randul ML scris legitim), devizul AA-11 / NCS-11 / NR-11 cu MC = 22023 um_decontat
-- (reproducerea P1: nimic scris, avertizarea decontat_fara_articol NU se stinge, decontatul ramane 80 M), serverul nu schimba UM-ul randului confirmat (23514);
-- UM-ul echivalent prin factor trece peste tot (ML pe calea veche, HM in AA-11, ML / M in note) si stinge lipsa (rest 100 / 80 / 20); (2/3) reproducerea P2: O5 cu
-- X #1 / #2, situatia 6 pe X|#1, inlocuirea cu Y il lasa fara baza; reintroducerea lui X FARA pozitie cu MC = 22023 um_decontat (oferta), cu M = acceptata,
-- randul poarta cheia referita O5|D1|X|#1 SI pozitia '1' (reconstruita din cheie), rest 100 / 80 / 20, lipsa stinsa; (3/3) apararea in adancime (server, garda
-- scoasa intr-un sub-bloc anulat): randul bazei trecut in MC peste decontatul in M → lipsurile declara decontat_um_diferit, calculul marcheaza um_incert.
-- SESIUNE PROASPATA: primul bloc dupa fixturi verifica garda cu marcajul RPC LIPSA (NULL): fisierul se ruleaza intr-o sesiune noua, inainte ca
-- vreun RPC sa fi pus marcajul (precondiția e verificata explicit).
-- FIXTURI: pe clona, daca profiles / employees cer alte coloane NOT NULL, se completeaza DOAR blocul FIXTURI (restul nu depinde de ele).
-- r-clona (proba chat-ului pe clona PG17, 22.11.2026): fixturile respecta constrangerile productiei — employees.department NOT NULL; profiles.role
-- explicit (valoarea implicita 'manager' nu trece profiles_role_chk); o fisa de angajat = un cont (uniq_profiles_employee_id); user_module_access.module
-- are FK spre app_modules(key), iar cheia 'executie_rest_decontat' NU exista in app_modules (nici pe productie) → fixtura o creeaza (anulata la ROLLBACK).
-- Probele PGlite ruleaza fisierul cu aceleasi constrangeri (scripts/pglite/fixturi/executie_constrangeri_productie.sql, doar in tranzactia lui).
BEGIN;
SET LOCAL search_path = public, pg_temp;
CREATE TEMP TABLE rd_fix (k text PRIMARY KEY, id bigint) ON COMMIT DROP;
GRANT SELECT, INSERT ON rd_fix TO authenticated, service_role;
-- rezultatele cititorilor vechi ai proiect_articole, inainte / dupa confirmare (t_oferta_confirmata)
CREATE TEMP TABLE rd_cons (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT SELECT, INSERT ON rd_cons TO authenticated, service_role;

-- ── FIXTURI (identitati sintetice; id-urile proiectelor / actelor / situatiilor vin din RETURNING) ──────────────────────────────
DO $fix$
DECLARE v bigint; v_s bigint;
BEGIN
  INSERT INTO public.employees (id, name, department) VALUES (9101, 'RD MP UNU', 'Executie'), (9102, 'RD MP DOI', 'Executie'), (9103, 'RD CONTRACTE', 'Executie'),
    (9104, 'RD SEF SANTIER', 'Executie');
  IF to_regclass('auth.users') IS NOT NULL THEN
    INSERT INTO auth.users (id) SELECT x::uuid FROM unnest(ARRAY['f0000000-0000-4000-8000-00000000000a', 'f0000000-0000-4000-8000-00000000000b', 'f0000000-0000-4000-8000-00000000000c',
      'f0000000-0000-4000-8000-00000000000d', 'f0000000-0000-4000-8000-00000000000e', 'f0000000-0000-4000-8000-00000000000f', 'f0000000-0000-4000-8000-000000000010',
      'f0000000-0000-4000-8000-000000000011', 'f0000000-0000-4000-8000-000000000012']) x
    ON CONFLICT (id) DO NOTHING;
  END IF;
  -- rolul e explicit ('teren' nu da niciun drept in Executie: dreptul vine din is_owner / user_module_access / fisa); fiecare fisa pe un singur cont
  INSERT INTO public.profiles (id, is_owner, employee_id, role) VALUES
    ('f0000000-0000-4000-8000-00000000000a', true, NULL, 'teren'), ('f0000000-0000-4000-8000-00000000000b', false, 9101, 'teren'), ('f0000000-0000-4000-8000-00000000000c', false, NULL, 'teren'),
    ('f0000000-0000-4000-8000-00000000000d', false, NULL, 'teren'), ('f0000000-0000-4000-8000-00000000000e', false, 9104, 'teren'), ('f0000000-0000-4000-8000-00000000000f', false, 9103, 'teren'),
    ('f0000000-0000-4000-8000-000000000010', false, NULL, 'teren'), ('f0000000-0000-4000-8000-000000000011', false, NULL, 'teren'), ('f0000000-0000-4000-8000-000000000012', false, NULL, 'teren')
  ON CONFLICT (id) DO UPDATE SET is_owner = EXCLUDED.is_owner, employee_id = EXCLUDED.employee_id, role = EXCLUDED.role;
  -- cheile de modul (FK user_module_access → app_modules): 'executie' exista pe productie; 'executie_rest_decontat' NU → create aici, anulate la ROLLBACK
  INSERT INTO public.app_modules (key, parent_key, name, is_active, show_on_homepage) VALUES ('executie', NULL, 'Executie', true, true) ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.app_modules (key, parent_key, name, is_active, show_on_homepage)
    VALUES ('executie_rest_decontat', 'executie', 'Rest de decontat (dry-run)', false, false) ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
    ('f0000000-0000-4000-8000-00000000000c', 'executie_rest_decontat', 'viewer'), ('f0000000-0000-4000-8000-00000000000d', 'executie_rest_decontat', 'editor'),
    ('f0000000-0000-4000-8000-00000000000e', 'executie', 'viewer'), ('f0000000-0000-4000-8000-00000000000f', 'executie', 'viewer'),
    ('f0000000-0000-4000-8000-000000000011', 'executie_rest_decontat', 'editor'), ('f0000000-0000-4000-8000-000000000012', 'executie_rest_decontat', 'editor');
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id, responsabil_contracte_externe_id, sef_santier_employee_id) VALUES ('RD-P1', 'Dry P1', 9101, 9103, 9104) RETURNING id INTO v;
  INSERT INTO rd_fix VALUES ('p1', v);
  INSERT INTO public.sites (name, proiect_id) VALUES ('Dry santier P1', v) RETURNING id INTO v_s;
  INSERT INTO public.profile_sites (profile_id, site_id) VALUES ('f0000000-0000-4000-8000-00000000000e', v_s);
  INSERT INTO public.executie_acte_aditionale (proiect_id, numar_act, data_semnare, activ) VALUES (v, 'AA-1', DATE '2026-06-01', true) RETURNING id INTO v_s;
  INSERT INTO rd_fix VALUES ('aa1', v_s);
  INSERT INTO public.executie_situatii_plata (proiect_id, nr_situatie, luna, an, valoare_baza_lei) VALUES (v, '1', 1, 2026, 8000) RETURNING id INTO v_s;
  INSERT INTO rd_fix VALUES ('sl1', v_s);
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('RD-P2', 'Dry P2', 9102) RETURNING id INTO v;
  INSERT INTO rd_fix VALUES ('p2', v);
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('RD-P3', 'Dry P3 fara oferta', 9101) RETURNING id INTO v;
  INSERT INTO rd_fix VALUES ('p3', v);
  -- r6: o unitate a P3 cu obiect_cod 'St-3' (20261208a), FARA randuri in proiect_articole: importul obiectului ' st-3 ' trebuie scris 'St-3' (t_um_inlocuire)
  INSERT INTO public.proiect_unitati (proiect_id, tip, nume, obiect_cod) VALUES (v, 'obiect', 'Statie robinete 3', 'St-3');
  -- h / i: conturi RESTRANSE pe proiect (20261209a) la P2 (viewer / editor); scrierea directa aici e fixtura (pe productie: fn_executie_acces_proiect_seteaza)
  INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES
    ('f0000000-0000-4000-8000-000000000011', (SELECT id FROM rd_fix WHERE k = 'p2'), 'viewer'), ('f0000000-0000-4000-8000-000000000012', (SELECT id FROM rd_fix WHERE k = 'p2'), 'editor');
  -- P4 (owner): AA-4 lista completa datata 2026-05-01, AA-5 „doar diferente” datata 2026-02-01 (mai VECHE, dar incarcata DUPA AA-4)
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('RD-P4', 'Dry P4 coduri repetate / ultimul act', 9102) RETURNING id INTO v;
  INSERT INTO rd_fix VALUES ('p4', v);
  INSERT INTO public.executie_acte_aditionale (proiect_id, numar_act, data_semnare, activ) VALUES (v, 'AA-4', DATE '2026-05-01', true) RETURNING id INTO v_s;
  INSERT INTO rd_fix VALUES ('aa4', v_s);
  INSERT INTO public.executie_acte_aditionale (proiect_id, numar_act, data_semnare, activ) VALUES (v, 'AA-5', DATE '2026-02-01', true) RETURNING id INTO v_s;
  INSERT INTO rd_fix VALUES ('aa5', v_s);
  -- P6 (r7, MP b): reprezentarea PE CHEIE cu forme brute amestecate pe obiect ('O1' / 'o1') si o unitate legata la 'o1' (reproducerile Jakarinos r6)
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('RD-P6', 'Dry P6 reprezentare pe cheie', 9101) RETURNING id INTO v;
  INSERT INTO rd_fix VALUES ('p6', v);
  INSERT INTO public.proiect_unitati (proiect_id, tip, nume, obiect_cod) VALUES (v, 'obiect', 'Tronson o1', 'o1');
  -- P7 (r8, MP b): importul vechi DUPA migrare cu coduri repetate, in loturi (t_import_vechi_repetat) si pozitii diferite sub aceeasi cheie (t_pozitie 2/2)
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('RD-P7', 'Dry P7 import vechi coduri repetate', 9101) RETURNING id INTO v;
  INSERT INTO rd_fix VALUES ('p7', v);
  -- P8 (r9, MP b): cheile REFERITE (t_cheie_referita): obiecte pe calea veche (O1) si prin RPC (O2, O3, O4); AA-8 / AA-9 liste complete pe O2 (datate
  -- 08 / 09.2026), AA-10 lista completa pe O4
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('RD-P8', 'Dry P8 chei referite', 9101) RETURNING id INTO v;
  INSERT INTO rd_fix VALUES ('p8', v);
  INSERT INTO public.executie_acte_aditionale (proiect_id, numar_act, data_semnare, activ) VALUES (v, 'AA-8', DATE '2026-08-01', true) RETURNING id INTO v_s;
  INSERT INTO rd_fix VALUES ('aa8', v_s);
  INSERT INTO public.executie_acte_aditionale (proiect_id, numar_act, data_semnare, activ) VALUES (v, 'AA-9', DATE '2026-09-01', true) RETURNING id INTO v_s;
  INSERT INTO rd_fix VALUES ('aa9', v_s);
  INSERT INTO public.executie_acte_aditionale (proiect_id, numar_act, data_semnare, activ) VALUES (v, 'AA-10', DATE '2026-08-01', true) RETURNING id INTO v_s;
  INSERT INTO rd_fix VALUES ('aa10', v_s);
  -- r10: AA-11 „doar diferente” pe O1 (t_um_decontat: reatasarea unei chei ramase fara baza, reproducerea P1 Jakarinos r9)
  INSERT INTO public.executie_acte_aditionale (proiect_id, numar_act, data_semnare, activ) VALUES (v, 'AA-11', DATE '2026-10-01', true) RETURNING id INTO v_s;
  INSERT INTO rd_fix VALUES ('aa11', v_s);
  -- P5: un rand CONFIRMAT scris de server (calea serverului: auth.uid() NULL + postgres), pentru garda in sesiune proaspata
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('RD-P5', 'Dry P5 garda proaspata', 9102) RETURNING id INTO v;
  INSERT INTO rd_fix VALUES ('p5', v);
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa, mod_import, fisier_amprenta, confirmat_de, confirmat_la)
  VALUES (v, '0001', 'D1', '1', 'A100', 'Conducta', 'M', 10, 1000, 'contract_initial', 'lista_completa', repeat('55', 32), 'f0000000-0000-4000-8000-00000000000a', now()) RETURNING id INTO v_s;
  INSERT INTO rd_fix VALUES ('p5r', v_s);
  RAISE NOTICE 'fixturi ok: P1 %, P2 %, P3 %, P4 %, P5 %', (SELECT id FROM rd_fix WHERE k = 'p1'), (SELECT id FROM rd_fix WHERE k = 'p2'), (SELECT id FROM rd_fix WHERE k = 'p3'),
    (SELECT id FROM rd_fix WHERE k = 'p4'), (SELECT id FROM rd_fix WHERE k = 'p5');
END $fix$;
CREATE FUNCTION pg_temp.rd_id(p text) RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT id FROM rd_fix WHERE k = p $f$;
-- CITITORII VECHI ai proiect_articole (r5, review #1158 P1 r4), pe un obiect al unui proiect, ca apelantul (RLS-ul general Executie), cu filtrele EXACTE
-- din cod: ActivitatiProiectPanel.jsx:53 / lib/verificariProiect.js:67 (sursa <> 'extras_materiale', count + suma cantitatilor), CatalogDevizPanel.jsx:37
-- (tot, apoi activ !== false, count + suma valorilor), 20261208a fn_executie_tinte_calcul (art.sursa = 'contract_initial' pe obiect, count + suma
-- cantitatilor), 20270105b fn_executie_proiect_configurare_completa (contract_initial AND activ, count), DevizVsExecutatTab.jsx:222 (obiectele distincte
-- cu obiect_cod nenul, pe proiect). Rezultatul e un text comparat inainte / dupa confirmare.
CREATE FUNCTION pg_temp.rd_cititori(p bigint, ob text) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT concat_ws('; ',
    'activitati:' || (SELECT count(*)::text || '/' || coalesce(sum(cantitate), 0)::text FROM public.proiect_articole WHERE proiect_id = p AND obiect_cod = ob AND sursa <> 'extras_materiale'),
    'catalog:' || (SELECT count(*)::text || '/' || coalesce(sum(valoare), 0)::text FROM public.proiect_articole WHERE proiect_id = p AND obiect_cod = ob AND activ IS DISTINCT FROM false),
    'tinte:' || (SELECT count(*)::text || '/' || coalesce(sum(art.cantitate), 0)::text FROM public.proiect_articole art WHERE art.proiect_id = p AND art.obiect_cod = ob AND art.sursa = 'contract_initial'),
    'configurare:' || (SELECT count(*)::text FROM public.proiect_articole a WHERE a.proiect_id = p AND a.obiect_cod = ob AND a.sursa = 'contract_initial' AND a.activ),
    'obiecte:' || (SELECT string_agg(DISTINCT obiect_cod, ',' ORDER BY obiect_cod) FROM public.proiect_articole WHERE proiect_id = p AND obiect_cod IS NOT NULL))
$f$;
-- identitatea din bloc: auth.uid() din ambele surse, rolul authenticated, fara BYPASSRLS
CREATE FUNCTION pg_temp.rd_identitate(p uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF auth.uid() IS DISTINCT FROM p OR current_user <> 'authenticated' OR (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'identitate gresita: uid % user %', auth.uid(), current_user;
  END IF;
END $f$;

-- ── t_garda_proaspata: SESIUNE NOUA, marcajul RPC LIPSESTE (NULL, nu ''): garzile refuza scrierile directe ale owner-ului (accesul general
--    Executie trece de politicile vechi ale proiect_articole) — rand confirmat modificat / sters, provenienta scrisa direct, situatie scrisa direct ──
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000a', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE n int;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000a');
  IF current_setting('gazpet.rest_decontat_scriitor', true) IS NOT NULL THEN
    RAISE EXCEPTION 't_garda_proaspata PRECONDITIE: marcajul RPC e deja definit in sesiune (%); dry-run-ul se ruleaza intr-o sesiune noua', current_setting('gazpet.rest_decontat_scriitor', true);
  END IF;
  IF (SELECT count(*) FROM public.proiect_articole WHERE id = pg_temp.rd_id('p5r') AND confirmat_la IS NOT NULL) <> 1 THEN RAISE EXCEPTION 't_garda_proaspata FAIL: randul confirmat al fixturii lipseste'; END IF;
  BEGIN UPDATE public.proiect_articole SET cantitate = 999 WHERE id = pg_temp.rd_id('p5r'); RAISE EXCEPTION 't_garda_proaspata FAIL: rand confirmat modificat direct (marcaj NULL)';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%nu se modifica direct%' THEN RAISE; END IF; END;
  BEGIN DELETE FROM public.proiect_articole WHERE id = pg_temp.rd_id('p5r'); RAISE EXCEPTION 't_garda_proaspata FAIL: rand confirmat sters direct (marcaj NULL)';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%nu se sterg%' THEN RAISE; END IF; END;
  BEGIN
    INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa, confirmat_de, confirmat_la)
    VALUES (pg_temp.rd_id('p5'), '0001', 'D1', 'B200', 'x', 'M', 1, 1, 'contract_initial', auth.uid(), now());
    RAISE EXCEPTION 't_garda_proaspata FAIL: provenienta scrisa direct (marcaj NULL)';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%confirma_baza%' THEN RAISE; END IF; END;
  BEGIN
    INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa, mod_import)
    VALUES (pg_temp.rd_id('p5'), '0001', 'D1', 'B200', 'x', 'M', 1, 1, 'contract_initial', 'diferente');
    RAISE EXCEPTION 't_garda_proaspata FAIL: mod_import scris direct (marcaj NULL)';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%confirma_baza%' THEN RAISE; END IF; END;
  -- situatiile: clientii n-au deloc INSERT (GRANT), deci refuzul vine inaintea gardei (garda cu marcaj NULL ramane plasa a doua, neobservabila de client)
  BEGIN INSERT INTO public.executie_sl_detaliu (proiect_id, nr_situatie, amprenta, confirmat_de) VALUES (pg_temp.rd_id('p5'), '1', repeat('56', 32), auth.uid()); RAISE EXCEPTION 't_garda_proaspata FAIL: situatie scrisa direct (marcaj NULL)';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT count(*) INTO n FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p5');
  IF n <> 1 OR (SELECT cantitate FROM public.proiect_articole WHERE id = pg_temp.rd_id('p5r')) <> 10 OR EXISTS (SELECT 1 FROM public.executie_sl_detaliu) THEN
    RAISE EXCEPTION 't_garda_proaspata FAIL: refuzurile au scris ceva';
  END IF;
  -- calea legitima a serverului ramane: nimic de testat aici ca authenticated; calea veche (rand fara provenienta) merge
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa) VALUES (pg_temp.rd_id('p5'), '0001', 'D1', 'Z9', 'extras', 'M', 1, 0, 'extras_materiale');
  DELETE FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p5') AND sursa = 'extras_materiale';
  RAISE NOTICE 't_garda_proaspata ok: cu marcajul RPC LIPSA (NULL) randul confirmat nu se modifica / sterge, provenienta si situatiile nu se scriu direct; calea veche merge';
END $t$;
RESET ROLE;

-- ── t_fara_baza: fara oferta confirmata nu se confirma nicio situatie (MP-ul pe P3 si pe P1 inainte de oferta) ───────────────────
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p3'), '1', NULL, 'x.xlsx', repeat('a0', 32),
           '[{"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact","um":"M","cantitate_perioada":1,"valoare":100}]'::jsonb, false);
    RAISE EXCEPTION 't_fara_baza FAIL: situatie confirmata pe un proiect fara oferta';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%fara_baza%' THEN RAISE; END IF; END;
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '1', NULL, 'x.xlsx', repeat('a0', 32),
           '[{"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact","um":"M","cantitate_perioada":1,"valoare":100}]'::jsonb, false);
    RAISE EXCEPTION 't_fara_baza FAIL: situatie confirmata pe P1 inainte de oferta';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%fara_baza%' THEN RAISE; END IF; END;
  IF NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p1') AND tip = 'fara_oferta')
     OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p3') AND tip = 'fara_oferta')
     OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p2')) THEN
    RAISE EXCEPTION 't_fara_baza FAIL: lipsurile fara_oferta (MP-ul vede P1 si P3, nu P2)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_sl_detaliu) THEN RAISE EXCEPTION 't_fara_baza FAIL: s-a scris ceva'; END IF;
  RAISE NOTICE 't_fara_baza ok: refuz fara_baza pe P3 si pe P1 neconfigurat; lipsuri fara_oferta doar pe proiectele MP-ului';
END $t$;

-- ── oferta P1 (MP-ul): 100 M pe A100, 2 × „100 MC” pe B200 (= 200 MC), C300 pe obiectul 0002, D400 repetat in deviz (nr intra in cheie) ──
DO $t$
DECLARE v jsonb; r record;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'contract_initial', NULL, NULL, NULL, 'oferta.xlsx', repeat('b1', 32), $j$[
    {"obiect_cod":"0001","obiect_nume":"TRONSON 1","deviz_cod":"D1","deviz_nume":"Montaj","nr":"1","cod":"A100","denumire":"Conducta","um":"M","cantitate":100,"pret_unitar":100,"valoare":10000},
    {"obiect_cod":"0001","obiect_nume":"TRONSON 1","deviz_cod":"D1","deviz_nume":"Montaj","nr":"2","cod":"B200","denumire":"Sapatura","um":"100 MC","cantitate":2,"pret_unitar":1000,"valoare":2000},
    {"obiect_cod":"0002","obiect_nume":"TRONSON 2","deviz_cod":"D2","deviz_nume":"Montaj","nr":"1","cod":"C300","denumire":"Alt articol","um":"BUC","cantitate":10,"pret_unitar":50,"valoare":500},
    {"obiect_cod":"0001","obiect_nume":"TRONSON 1","deviz_cod":"D1","deviz_nume":"Montaj","nr":"7","cod":"D400","denumire":"Dublu a","um":"M","cantitate":5,"pret_unitar":10,"valoare":50},
    {"obiect_cod":"0001","obiect_nume":"TRONSON 1","deviz_cod":"D1","deviz_nume":"Montaj","nr":"8","cod":"D400","denumire":"Dublu b","um":"M","cantitate":6,"pret_unitar":10,"valoare":60},
    {"obiect_cod":"0001","obiect_nume":"TRONSON 1","deviz_cod":"OS","deviz_nume":"Organizare","nr":"1","cod":"OS","denumire":"Organizare de santier","um":"LEI","cantitate":1,"pret_unitar":3000,"valoare":3000,"tip_rand":"os"}]$j$::jsonb);
  IF (v->>'inserate')::int <> 6 OR jsonb_array_length(v->'ids') <> 6 OR v->>'mod_import' <> 'lista_completa' THEN RAISE EXCEPTION 'oferta FAIL: %', v; END IF;
  SELECT string_agg(b.cheie || '=' || b.cantitate::text || ' ' || b.um, '; ' ORDER BY b.cheie) AS s INTO r FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p1');
  IF r.s IS DISTINCT FROM '0001|D1|A100=100 M; 0001|D1|B200=200 MC; 0001|D1|D400|#7=5 M; 0001|D1|D400|#8=6 M; 0001|OS|OS=1 LEI; 0002|D2|C300=10 BUC' THEN
    RAISE EXCEPTION 'oferta FAIL baza: %', r.s;
  END IF;
  -- (MP-ul fara modulul 'executie' nu citeste proiect_articole direct — politicile vechi; provenienta se verifica in blocul owner-ului)
  IF (SELECT sum(randuri) FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p1')) <> 6 THEN RAISE EXCEPTION 'oferta FAIL: 6 randuri in baza'; END IF;
  -- acelasi fisier inca o data / alta oferta pe obiectul 0001 deja confirmat, fara „inlocuieste” = refuz (r5: pe obiect)
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'contract_initial', NULL, NULL, NULL, 'oferta.xlsx', repeat('b1', 32), '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"Z","denumire":"z","um":"M","cantitate":1,"valoare":1}]'::jsonb);
    RAISE EXCEPTION 'oferta FAIL: aceeasi amprenta acceptata';
  EXCEPTION WHEN unique_violation THEN IF SQLERRM NOT LIKE '%acelasi fisier%' THEN RAISE; END IF; END;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'contract_initial', NULL, NULL, NULL, 'oferta2.xlsx', repeat('b2', 32), '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"Z","denumire":"z","um":"M","cantitate":1,"valoare":1}]'::jsonb);
    RAISE EXCEPTION 'oferta FAIL: a doua oferta pe obiectul confirmat 0001 acceptata fara inlocuieste';
  EXCEPTION WHEN unique_violation THEN IF SQLERRM NOT LIKE '%obiectele 0001||%inlocuieste%' THEN RAISE; END IF; END;
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p1') AND tip = 'fara_oferta')
     OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p1') AND tip = 'aa_fara_deviz' AND referinta = 'AA-1')
     OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p1') AND tip = 'sl_fara_detaliu' AND referinta = '1') THEN
    RAISE EXCEPTION 'oferta FAIL: lipsurile dupa oferta (AA-1 fara deviz, situatia 1 fara detaliu)';
  END IF;
  RAISE NOTICE 'oferta ok: 6 randuri, cheia cu nr doar pe codul repetat, 100 MC x 2 = 200 MC; aceeasi amprenta / a doua oferta refuzate; lipsuri AA-1 si SL 1';
END $t$;

-- ── t_negative_peste_oferta: SL1 +80, SL2 -10, SL3 +50 pe baza 100 → decontat 120, rest -20, peste_oferta ────────────────────
DO $t$
DECLARE v jsonb; r record;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), ' 1 ', pg_temp.rd_id('sl1'), 'sl1.xlsx', repeat('c1', 32),
         '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"A100","denumire":"Conducta","um":"M","cantitate_perioada":80,"pret_unitar":100,"valoare":8000,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]'::jsonb, false);
  IF (v->>'versiune')::int <> 1 OR (v->>'total_citit')::numeric <> 8000 OR (v->>'total_referinta')::numeric <> 8000 OR v->>'inlocuit_id' IS NOT NULL THEN RAISE EXCEPTION 't_negative FAIL SL1: %', v; END IF;
  INSERT INTO rd_fix VALUES ('d1', (v->>'detaliu_id')::bigint);
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '2', NULL, 'sl2.xlsx', repeat('c2', 32),
         '{"luna":2,"an":2026,"linii":[{"cod":"A100","um":"M","cantitate_perioada":-10,"valoare":-1000,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]}'::jsonb, false);
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '3', NULL, 'sl3.xlsx', repeat('c3', 32),
         '{"luna":3,"an":2026,"linii":[{"cod":"A100","um":"M","cantitate_perioada":50,"valoare":5000,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"cod"}]}'::jsonb, false);
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100';
  IF r.baza_cantitate <> 100 OR r.decontat_cantitate <> 120 OR r.rest_cantitate <> -20 OR r.decontat_valoare <> 12000 OR r.rest_valoare <> -2000
     OR r.peste_oferta IS NOT TRUE OR r.nedecontat IS NOT FALSE OR r.pct_decontat <> 120.0 OR r.situatii <> 3 OR r.ultima_situatie <> '3' THEN
    RAISE EXCEPTION 't_negative FAIL: %', row_to_json(r);
  END IF;
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0002|D2|C300';
  IF r.rest_cantitate <> 10 OR r.nedecontat IS NOT TRUE OR r.peste_oferta IS NOT FALSE OR r.pct_decontat <> 0 THEN RAISE EXCEPTION 't_negative FAIL C300 nedecontat: %', row_to_json(r); END IF;
  SELECT * INTO r FROM public.v_executie_rest_decontat_obiect WHERE proiect_id = pg_temp.rd_id('p1') AND nivel = 'proiect';
  IF r.baza_valoare <> 15610 OR r.decontat_valoare <> 12000 OR r.rest_valoare <> 3610 OR r.articole <> 6 OR r.articole_peste <> 1 OR r.articole_nedecontate <> 5 THEN
    RAISE EXCEPTION 't_negative FAIL total proiect: %', row_to_json(r);
  END IF;
  IF (SELECT rest_valoare FROM public.v_executie_rest_decontat_obiect WHERE proiect_id = pg_temp.rd_id('p1') AND nivel = 'obiect' AND obiect_cod = '0002') <> 500 THEN
    RAISE EXCEPTION 't_negative FAIL obiect 0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p1') AND tip = 'sl_fara_detaliu') THEN
    RAISE EXCEPTION 't_negative FAIL: situatia 1 inca „fara detaliu” dupa confirmare';
  END IF;
  RAISE NOTICE 't_negative_peste_oferta ok: decontat 120 (80 - 10 + 50), rest -20 semnalat peste_oferta; totaluri pe obiect / proiect';
END $t$;

-- ── t_um: baza „100 MC” x 2 = 200 MC; linie in MC 50 → rest 150; linie in ML → exceptie (nimic scris) ───────────────────────
DO $t$
DECLARE v jsonb; r record; n int;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '4', NULL, 'sl4.xlsx', repeat('c4', 32),
         '[{"cod":"B200","um":"MC","cantitate_perioada":50,"valoare":500,"cheie":"0001|D1|B200","tip_rand":"articol","potrivire":"exact"}]'::jsonb, false);
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|B200';
  IF r.baza_cantitate <> 200 OR r.um <> 'MC' OR r.decontat_cantitate <> 50 OR r.rest_cantitate <> 150 OR r.pct_decontat <> 25.0 THEN RAISE EXCEPTION 't_um FAIL MC: %', row_to_json(r); END IF;
  SELECT count(*) INTO n FROM public.executie_sl_detaliu;
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '5', NULL, 'sl5.xlsx', repeat('c5', 32),
           '[{"cod":"B200","um":"ML","cantitate_perioada":1,"valoare":10,"cheie":"0001|D1|B200","tip_rand":"articol","potrivire":"exact"}]'::jsonb, false);
    RAISE EXCEPTION 't_um FAIL: UM diferit (ML pe un articol in MC) acceptat';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%um_diferit%' THEN RAISE; END IF; END;
  -- „100 MC” in situatie pe articolul in MC = acelasi UM normalizat, cantitatea x 100
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '5', NULL, 'sl5.xlsx', repeat('c5', 32),
         '[{"cod":"B200","um":"100 MC","cantitate_perioada":0.5,"valoare":500,"cheie":"0001|D1|B200","tip_rand":"articol","potrivire":"exact"}]'::jsonb, false);
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|B200';
  IF r.decontat_cantitate <> 100 OR r.rest_cantitate <> 100 THEN RAISE EXCEPTION 't_um FAIL 100 MC: %', row_to_json(r); END IF;
  IF (SELECT count(*) FROM public.executie_sl_detaliu) <> n + 1 THEN RAISE EXCEPTION 't_um FAIL: refuzul a scris ceva'; END IF;
  -- o cheie care nu e in baza = refuz; un articol in afara ofertei = permis, apare cu baza 0
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '6', NULL, 'sl6.xlsx', repeat('c6', 32),
           '[{"cod":"X999","um":"M","cantitate_perioada":1,"valoare":10,"cheie":"0001|D1|X999","tip_rand":"articol","potrivire":"manual"}]'::jsonb, false);
    RAISE EXCEPTION 't_um FAIL: cheie inexistenta in baza acceptata';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%nu e in baza%' THEN RAISE; END IF; END;
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '6', NULL, 'sl6.xlsx', repeat('c6', 32),
         '[{"obiect_cod":"0001","cod":"X999","denumire":"Lucrare noua","um":"M","cantitate_perioada":3,"valoare":300,"tip_rand":"articol_nou"}]'::jsonb, false);
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND tip_rand = 'articol_nou';
  IF r.cheie IS NOT NULL OR r.baza_valoare <> 0 OR r.decontat_valoare <> 300 OR r.rest_valoare <> -300 OR r.peste_oferta IS NOT TRUE THEN RAISE EXCEPTION 't_um FAIL articol_nou: %', row_to_json(r); END IF;
  RAISE NOTICE 't_um ok: 100 MC x 2 = 200 MC, 50 MC → rest 150, 0.5 x 100 MC → rest 100; ML refuzat (um_diferit); cheie inexistenta refuzata; articol nou cu baza 0';
END $t$;

-- ── t_dublare_situatie: aceeasi amprenta → refuz; alt fisier, acelasi nr, fara inlocuieste → refuz; cu inlocuieste → vechea inactiva, decontat = noua ──
DO $t$
DECLARE v jsonb; r record; n int;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  SELECT count(*) INTO n FROM public.executie_sl_detaliu;
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '9', NULL, 'sl1.xlsx', repeat('c1', 32),
           '[{"cod":"A100","um":"M","cantitate_perioada":80,"valoare":8000,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]'::jsonb, false);
    RAISE EXCEPTION 't_dublare FAIL: aceeasi amprenta (alt nr) acceptata';
  EXCEPTION WHEN unique_violation THEN IF SQLERRM NOT LIKE '%amprenta_existenta%' THEN RAISE; END IF; END;
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '1', pg_temp.rd_id('sl1'), 'sl1b.xlsx', repeat('d1', 32),
           '[{"cod":"A100","um":"M","cantitate_perioada":70,"valoare":7000,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]'::jsonb, false);
    RAISE EXCEPTION 't_dublare FAIL: acelasi nr fara inlocuieste acceptat';
  EXCEPTION WHEN unique_violation THEN IF SQLERRM NOT LIKE '%situatie_existenta%' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM public.executie_sl_detaliu) <> n OR (SELECT decontat_cantitate FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100') <> 120 THEN
    RAISE EXCEPTION 't_dublare FAIL: refuzurile au scris ceva';
  END IF;
  -- inlocuirea: totalul 7000 difera de situatia de plata (8000) peste prag → cere accept_diferenta
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '1', pg_temp.rd_id('sl1'), 'sl1b.xlsx', repeat('d1', 32),
           '[{"cod":"A100","um":"M","cantitate_perioada":70,"valoare":7000,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]'::jsonb, true);
    RAISE EXCEPTION 't_dublare FAIL: diferenta fata de situatia de plata acceptata tacit';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%accept_diferenta%' THEN RAISE; END IF; END;
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '1', pg_temp.rd_id('sl1'), 'sl1b.xlsx', repeat('d1', 32),
         '{"accept_diferenta":true,"linii":[{"cod":"A100","um":"M","cantitate_perioada":70,"valoare":7000,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]}'::jsonb, true);
  IF (v->>'versiune')::int <> 2 OR (v->>'inlocuit_id')::bigint <> pg_temp.rd_id('d1') THEN RAISE EXCEPTION 't_dublare FAIL inlocuire: %', v; END IF;
  SELECT activ, versiune INTO r FROM public.executie_sl_detaliu WHERE id = pg_temp.rd_id('d1');
  IF r.activ IS NOT FALSE OR r.versiune <> 1 THEN RAISE EXCEPTION 't_dublare FAIL: versiunea veche nu e inactiva'; END IF;
  SELECT decontat_cantitate, decontat_valoare, situatii INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100';
  IF r.decontat_cantitate <> 110 OR r.decontat_valoare <> 11000 OR r.situatii <> 3 THEN RAISE EXCEPTION 't_dublare FAIL decontat dupa inlocuire: %', row_to_json(r); END IF;
  -- fara versiune activa de inlocuit, „inlocuieste” e refuzat; liniile vechi raman (istoric)
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '77', NULL, 'x.xlsx', repeat('d7', 32),
           '[{"cod":"A100","um":"M","cantitate_perioada":1,"valoare":100,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]'::jsonb, true);
    RAISE EXCEPTION 't_dublare FAIL: inlocuieste fara versiune activa acceptat';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF (SELECT count(*) FROM public.executie_sl_detaliu_linii l WHERE l.detaliu_id = pg_temp.rd_id('d1')) <> 1 THEN RAISE EXCEPTION 't_dublare FAIL: liniile vechi au disparut'; END IF;
  RAISE NOTICE 't_dublare_situatie ok: amprenta / nr existent refuzate (nimic scris); inlocuirea cere confirmare + accept_diferenta; vechea versiune inactiva, decontat = noua (110)';
END $t$;
RESET ROLE;

-- ── t_aa_leaga_note: NCS +20 → 120; AA legat de NCS (+20 si +5 pe alt articol) → 120 + 5 (nu 140); AA dezactivat → 120 ────────────
-- responsabilul de contracte (f): poate scrie nota si devizele ei / ale AA-ului, dar NU vede restul de decontat
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000f', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000f","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; v_nota bigint; r record;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000f');
  IF public.fn_rest_decontat_drept(pg_temp.rd_id('p1'), 'citire') OR NOT public.fn_rest_decontat_drept(pg_temp.rd_id('p1'), 'documente_baza')
     OR public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'documente_baza') OR public.fn_rest_decontat_drept(pg_temp.rd_id('p1'), 'confirmare') THEN
    RAISE EXCEPTION 't_aa FAIL: dreptul responsabilului de contracte (documente_baza doar pe P1, fara citire / confirmare)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat) OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_baza) THEN RAISE EXCEPTION 't_aa FAIL: responsabilul vede restul'; END IF;
  INSERT INTO public.executie_note_modificare (proiect_id, tip, numar, data_aprobare, descriere, creat_de) VALUES (pg_temp.rd_id('p1'), 'ncs', ' NCS-1 ', DATE '2026-03-01', 'suplimentare', 'f0000000-0000-4000-8000-00000000000a')
  RETURNING id INTO v_nota;
  INSERT INTO rd_fix VALUES ('ncs1', v_nota);
  SELECT tip, numar, creat_de INTO r FROM public.executie_note_modificare WHERE id = v_nota;
  IF r.tip <> 'NCS' OR r.numar <> 'NCS-1' OR r.creat_de <> auth.uid() THEN RAISE EXCEPTION 't_aa FAIL: normalizarea / autorul notei (%)', row_to_json(r); END IF;
  BEGIN
    INSERT INTO public.executie_note_modificare (proiect_id, tip, numar) VALUES (pg_temp.rd_id('p2'), 'NR', 'NR-9');
    RAISE EXCEPTION 't_aa FAIL: nota pe proiectul altuia acceptata';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.executie_note_modificare (proiect_id, tip, numar) VALUES (pg_temp.rd_id('p1'), 'NCS', 'NCS-1');
    RAISE EXCEPTION 't_aa FAIL: aceeasi nota de doua ori';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- devizul notei: +20 pe A100
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'nota_comanda_suplimentara', NULL, v_nota, NULL, 'ncs1.xlsx', repeat('e1', 32),
         '[{"obiect_cod":"0001","deviz_cod":"D1","nr":"1","cod":"A100","denumire":"Conducta","um":"M","cantitate":20,"pret_unitar":100,"valoare":2000}]'::jsonb);
  IF (v->>'inserate')::int <> 1 OR v->>'mod_import' <> 'diferente' THEN RAISE EXCEPTION 't_aa FAIL deviz nota: %', v; END IF;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'nota_comanda_suplimentara', NULL, v_nota, NULL, 'ncs1b.xlsx', repeat('e2', 32),
           '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"A100","denumire":"Conducta","um":"M","cantitate":1,"valoare":100}]'::jsonb);
    RAISE EXCEPTION 't_aa FAIL: al doilea deviz pe aceeasi nota acceptat';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- UM diferit de cheia din baza (A100 e in M) = refuz
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'act_aditional', pg_temp.rd_id('aa1'), NULL, 'diferente', 'aa1.xlsx', repeat('e3', 32),
           '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"A100","denumire":"Conducta","um":"BUC","cantitate":20,"valoare":2000}]'::jsonb);
    RAISE EXCEPTION 't_aa FAIL: UM diferit in deviz acceptat';
  -- r10: A100 are deja decontat (SL1–SL3, 120 M) → refuzul vine din validarea unica fata de decontat (um_decontat), pe orice sursa
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%0001|D1|A100%decontate in UM M%UM nou BUC%um_decontat%' THEN RAISE; END IF; END;
  RAISE NOTICE 't_aa_leaga_note (1/2) ok: nota scrisa de responsabilul de contracte (autor / normalizare din server; alt proiect refuzat), deviz NCS +20; al doilea deviz / UM diferit refuzate';
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000a', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; r record;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000a');
  IF (SELECT count(*) FROM public.proiect_articole a WHERE a.proiect_id = pg_temp.rd_id('p1') AND a.confirmat_de = 'f0000000-0000-4000-8000-00000000000b' AND a.fisier_amprenta = repeat('b1', 32)
        AND a.activ AND a.sursa = 'contract_initial' AND a.mod_import = 'lista_completa' AND a.confirmat_la IS NOT NULL) <> 6 THEN
    RAISE EXCEPTION 't_aa FAIL: provenienta ofertei (autor = MP-ul, amprenta, mod lista_completa)';
  END IF;
  IF (SELECT cantitate FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100') <> 120 THEN RAISE EXCEPTION 't_aa FAIL: baza dupa NCS <> 120'; END IF;
  -- legarea notei de AA-1 (AA fara deviz inca): nota ramane numarata (nimic nu o preia)
  UPDATE public.executie_note_modificare SET act_aditional_id = pg_temp.rd_id('aa1') WHERE id = pg_temp.rd_id('ncs1');
  IF (SELECT cantitate FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100') <> 120 THEN RAISE EXCEPTION 't_aa FAIL: nota legata de un AA fara deviz a disparut din baza'; END IF;
  -- devizul AA-1, „doar diferente”: +20 A100 (preia NCS) si +5 C300
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'act_aditional', pg_temp.rd_id('aa1'), NULL, 'diferente', 'aa1.xlsx', repeat('e3', 32),
         '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"A100","denumire":"Conducta","um":"M","cantitate":20,"pret_unitar":110,"valoare":2200},
           {"obiect_cod":"0002","deviz_cod":"D2","cod":"C300","denumire":"Alt articol","um":"BUC","cantitate":5,"pret_unitar":50,"valoare":250}]'::jsonb);
  SELECT cantitate, valoare, pret_unitar INTO r FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100';
  IF r.cantitate <> 120 OR r.valoare <> 12200 OR r.pret_unitar <> 110 THEN RAISE EXCEPTION 't_aa FAIL: AA legat de NCS → baza % (astept 120, pret 110)', row_to_json(r); END IF;
  IF (SELECT cantitate FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0002|D2|C300') <> 15 THEN RAISE EXCEPTION 't_aa FAIL: C300 <> 15'; END IF;
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p1') AND tip IN ('aa_fara_deviz', 'nota_fara_deviz')) THEN RAISE EXCEPTION 't_aa FAIL: lipsuri ramase dupa devize'; END IF;
  -- AA dezactivat: randurile lui ies, nota conteaza din nou
  UPDATE public.executie_acte_aditionale SET activ = false WHERE id = pg_temp.rd_id('aa1');
  SELECT cantitate, pret_unitar INTO r FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100';
  IF r.cantitate <> 120 OR r.pret_unitar <> 100 THEN RAISE EXCEPTION 't_aa FAIL: AA inactiv → baza % (astept 120, pret 100)', row_to_json(r); END IF;
  IF (SELECT cantitate FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0002|D2|C300') <> 10 THEN RAISE EXCEPTION 't_aa FAIL: C300 dupa AA inactiv <> 10'; END IF;
  -- nota dezactivata: iese si ea
  UPDATE public.executie_note_modificare SET activ = false WHERE id = pg_temp.rd_id('ncs1');
  IF (SELECT cantitate FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100') <> 100 THEN RAISE EXCEPTION 't_aa FAIL: nota inactiva inca numarata'; END IF;
  UPDATE public.executie_note_modificare SET activ = true WHERE id = pg_temp.rd_id('ncs1');
  UPDATE public.executie_acte_aditionale SET activ = true WHERE id = pg_temp.rd_id('aa1');
  -- nota: proiectul / autorul nu se schimba; actul altui proiect refuzat
  BEGIN UPDATE public.executie_note_modificare SET proiect_id = pg_temp.rd_id('p2') WHERE id = pg_temp.rd_id('ncs1'); RAISE EXCEPTION 't_aa FAIL: proiectul notei schimbat';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.executie_note_modificare SET creat_de = auth.uid() WHERE id = pg_temp.rd_id('ncs1'); RAISE EXCEPTION 't_aa FAIL: autorul notei schimbat';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN DELETE FROM public.executie_note_modificare WHERE id = pg_temp.rd_id('ncs1'); RAISE EXCEPTION 't_aa FAIL: nota stearsa';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- AA „lista completa” pe obiectul 0002 (datat DUPA oferta si AA-1): inlocuieste randurile datate inainte pe 0002 (C300 = 12), 0001 neatins
  INSERT INTO public.executie_acte_aditionale (proiect_id, numar_act, data_semnare, activ) VALUES (pg_temp.rd_id('p1'), 'AA-2', DATE '2026-07-01', true) RETURNING id INTO r;
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'act_aditional', r.id, NULL, 'lista_completa', 'aa2.xlsx', repeat('e4', 32),
         '[{"obiect_cod":"0002","deviz_cod":"D2","cod":"C300","denumire":"Alt articol revizuit","um":"BUC","cantitate":12,"pret_unitar":55,"valoare":660}]'::jsonb);
  IF (SELECT cantitate FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0002|D2|C300') <> 12
     OR (SELECT cantitate FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100') <> 120 THEN
    RAISE EXCEPTION 't_aa FAIL: lista completa pe 0002';
  END IF;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'act_aditional', r.id, NULL, 'lista_completa', 'aa2b.xlsx', repeat('e5', 32),
           '[{"obiect_cod":"0002","deviz_cod":"D2","cod":"C300","denumire":"x","um":"BUC","cantitate":-1,"valoare":-55}]'::jsonb);
    RAISE EXCEPTION 't_aa FAIL: lista completa cu cantitate negativa / al doilea deviz pe AA acceptat';
  EXCEPTION WHEN unique_violation OR invalid_parameter_value THEN NULL; END;
  RAISE NOTICE 't_aa_leaga_note ok: NCS +20 → 120; AA legat (+20, +5) → 120 si C300 15 (nu 140); AA inactiv → 120 / 10; nota inactiva → 100; lista completa pe 0002 → 12';
END $t$;
RESET ROLE;

-- ── t_surse_autorizate (r3, review #1158): accesul GENERAL Executie (e: executie viewer, trece de politicile vechi ale proiect_articole) nu poate
--    aduce in baza un rand NR / NCS / AA scris direct (fara nota / act, neconfirmat) — nici prin INSERT, nici schimband sursa unui rand existent
--    neconfirmat; calea veche (extras_materiale) merge; apoi, ca SERVER (auth.uid() NULL, trece de garda), CHECK-ul rd_legaturi_ck refuza randul
--    orfan SI pe cel cu legatura dar neconfirmat (apararea a doua, structurala); baza A100 ramane 120 ──
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v_id bigint; n int; s text;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  IF NOT EXISTS (SELECT 1 FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p1')) THEN RAISE EXCEPTION 't_surse_autorizate PRECONDITIE: accesul general nu citeste proiect_articole (politicile vechi)'; END IF;
  SELECT count(*) INTO n FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p1');
  FOREACH s IN ARRAY ARRAY['nota_comanda_suplimentara', 'nota_renuntare', 'act_aditional'] LOOP
    BEGIN
      INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa, act_nr)
      VALUES (pg_temp.rd_id('p1'), '0001', 'D1', 'A100', 'Conducta', 'M', 20, 2000, s, CASE WHEN s = 'act_aditional' THEN 'AA-X' END);
      RAISE EXCEPTION 't_surse_autorizate FAIL: rand % scris direct (fara nota / act, neconfirmat)', s;
    EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%confirma_baza%' THEN RAISE; END IF; END;
  END LOOP;
  -- schimbarea sursei unui rand existent neconfirmat (calea veche) catre NR / NCS / AA = refuz; randul ramane cum era
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa)
  VALUES (pg_temp.rd_id('p1'), '0001', 'D1', 'A100', 'extras', 'M', 20, 0, 'extras_materiale') RETURNING id INTO v_id;
  FOREACH s IN ARRAY ARRAY['nota_comanda_suplimentara', 'nota_renuntare', 'act_aditional'] LOOP
    BEGIN
      UPDATE public.proiect_articole SET sursa = s, valoare = 2000 WHERE id = v_id;
      RAISE EXCEPTION 't_surse_autorizate FAIL: sursa unui rand neconfirmat schimbata direct in %', s;
    EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%confirma_baza%' THEN RAISE; END IF; END;
  END LOOP;
  IF (SELECT sursa || '/' || valoare::text FROM public.proiect_articole WHERE id = v_id) <> 'extras_materiale/0' THEN RAISE EXCEPTION 't_surse_autorizate FAIL: randul extras s-a schimbat'; END IF;
  DELETE FROM public.proiect_articole WHERE id = v_id;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p1')) <> n THEN RAISE EXCEPTION 't_surse_autorizate FAIL: refuzurile au scris ceva'; END IF;
  RAISE NOTICE 't_surse_autorizate (1/2) ok: accesul general nu scrie direct NR / NCS / AA (INSERT si schimbarea sursei → 42501); calea veche (extras) merge';
END $t$;
RESET ROLE;
-- serverul (auth.uid() NULL, postgres): garda il lasa, CHECK-ul nu — randul orfan si randul cu legatura dar neconfirmat sunt refuzate structural
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
DO $t$
DECLARE n int; r record;
BEGIN
  IF auth.uid() IS NOT NULL OR public.fn_rest_decontat_server() IS NOT TRUE THEN
    RAISE EXCEPTION 't_surse_autorizate PRECONDITIE: blocul serverului cere auth.uid() NULL si rolul postgres (acum % / %)', auth.uid(), current_user;
  END IF;
  SELECT count(*) INTO n FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p1');
  FOR r IN SELECT * FROM (VALUES
      ('act_aditional', 'AA-X', NULL::bigint, NULL::bigint, 'AA fara act'),
      ('nota_renuntare', NULL, NULL, NULL, 'NR fara nota'),
      ('nota_comanda_suplimentara', NULL, NULL, NULL, 'NCS fara nota'),
      ('act_aditional', 'AA-1', pg_temp.rd_id('aa1'), NULL, 'AA cu act, neconfirmat'),
      ('nota_comanda_suplimentara', NULL, NULL, pg_temp.rd_id('ncs1'), 'NCS cu nota, neconfirmat')) v(sursa, act_nr, act_id, nota_id, ce) LOOP
    BEGIN
      INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa, act_nr, act_aditional_id, nota_id)
      VALUES (pg_temp.rd_id('p1'), '0001', 'D1', 'A100', r.ce, 'M', 1, 1, r.sursa, r.act_nr, r.act_id, r.nota_id);
      RAISE EXCEPTION 't_surse_autorizate FAIL: % scris de server (CHECK-ul nu a refuzat)', r.ce;
    EXCEPTION WHEN check_violation THEN IF SQLERRM NOT LIKE '%rd_legaturi_ck%' THEN RAISE; END IF; END;
  END LOOP;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p1')) <> n
     OR (SELECT b.cantitate FROM public.fn_rest_decontat_baza_proiect(pg_temp.rd_id('p1')) b WHERE b.cheie = '0001|D1|A100') <> 120 THEN
    RAISE EXCEPTION 't_surse_autorizate FAIL: refuzurile serverului au scris ceva / baza A100 <> 120';
  END IF;
  RAISE NOTICE 't_surse_autorizate (2/2) ok: CHECK-ul refuza si pe calea serverului randul AA / NR / NCS fara legatura sau neconfirmat; baza A100 = 120';
END $t$;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000a', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- ── t_coduri_repetate (owner, P4): TOATE grupurile de coduri repetate primesc pozitia (A#1, A#2, B#3, B#4 — nu B comasat 7); pozitii lipsa /
--    duplicate = refuz, nimic scris ──
DO $t$
DECLARE v jsonb; r record; n int;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000a');
  SELECT count(*) INTO n FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p4');
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p4'), 'contract_initial', NULL, NULL, NULL, 'o4.xlsx', repeat('a4', 32),
           '[{"obiect_cod":"OB1","deviz_cod":"D1","nr":"1","cod":"A","denumire":"a","um":"M","cantitate":1,"valoare":10},
             {"obiect_cod":"OB1","deviz_cod":"D1","nr":"1","cod":"A","denumire":"a bis","um":"M","cantitate":1,"valoare":10}]'::jsonb);
    RAISE EXCEPTION 't_coduri_repetate FAIL: acelasi cod cu aceeasi pozitie acceptat';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%pozitii duplicate%' THEN RAISE; END IF; END;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p4'), 'contract_initial', NULL, NULL, NULL, 'o4.xlsx', repeat('a4', 32),
           '[{"obiect_cod":"OB1","deviz_cod":"D1","cod":"A","denumire":"a","um":"M","cantitate":1,"valoare":10},
             {"obiect_cod":"OB1","deviz_cod":"D1","nr":"2","cod":"A","denumire":"a bis","um":"M","cantitate":1,"valoare":10}]'::jsonb);
    RAISE EXCEPTION 't_coduri_repetate FAIL: cod repetat cu o pozitie lipsa acceptat';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%pozitii lipsa%' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p4')) <> n THEN RAISE EXCEPTION 't_coduri_repetate FAIL: refuzurile au scris ceva'; END IF;
  -- doua grupuri repetate (A: #1 #2; B: #3 #4) + X singur, pret 10
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p4'), 'contract_initial', NULL, NULL, NULL, 'o4.xlsx', repeat('a4', 32),
         '[{"obiect_cod":"OB1","deviz_cod":"D1","nr":"1","cod":"A","denumire":"a1","um":"M","cantitate":1,"valoare":10},
           {"obiect_cod":"OB1","deviz_cod":"D1","nr":"2","cod":"A","denumire":"a2","um":"M","cantitate":2,"valoare":20},
           {"obiect_cod":"OB1","deviz_cod":"D1","nr":"3","cod":"B","denumire":"b3","um":"M","cantitate":3,"valoare":30},
           {"obiect_cod":"OB1","deviz_cod":"D1","nr":"4","cod":"B","denumire":"b4","um":"M","cantitate":4,"valoare":40},
           {"obiect_cod":"OB1","deviz_cod":"D1","nr":"5","cod":"X","denumire":"x","um":"M","cantitate":100,"pret_unitar":10,"valoare":1000}]'::jsonb);
  IF (v->>'inserate')::int <> 5 THEN RAISE EXCEPTION 't_coduri_repetate FAIL: %', v; END IF;
  SELECT string_agg(b.cheie || '=' || b.cantitate::text, '; ' ORDER BY b.cheie) AS s, count(*) AS c INTO r FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p4');
  IF r.c <> 5 OR r.s IS DISTINCT FROM 'OB1|D1|A|#1=1; OB1|D1|A|#2=2; OB1|D1|B|#3=3; OB1|D1|B|#4=4; OB1|D1|X=100' THEN RAISE EXCEPTION 't_coduri_repetate FAIL baza: %', r.s; END IF;
  RAISE NOTICE 't_coduri_repetate ok: A#1, A#2, B#3, B#4 separate (5 chei), pozitii duplicate / lipsa refuzate';
END $t$;

-- ── t_ultimul_act (owner, P4): nota neaprobata nu intra (deviz refuzat, lipsa nota_neaprobata); dupa aprobare intra; AA „lista completa” pe
--    obiectul cu forme brute amestecate (randurile cheii X — oferta + NCS-9 — rescrise ' ob1 ' de server, celelalte chei 'OB1'; AA-ul vine cu ' ob1 ' si e
--    scris ' ob1 ', forma randului cu aceeasi cheie — r7) INLOCUIESTE pe identitatea canonica (150, nu 250: si randurile 'OB1' ale ofertei dispar din baza);
--    un act mai VECHI incarcat DUPA nu trece peste lista completa; pretul = ultimul act (dupa data) ──
DO $t$
DECLARE v jsonb; r record; v_nota bigint;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000a');
  INSERT INTO public.executie_note_modificare (proiect_id, tip, numar, descriere) VALUES (pg_temp.rd_id('p4'), 'NCS', 'NCS-9', 'fara aprobare inca') RETURNING id INTO v_nota;
  INSERT INTO rd_fix VALUES ('ncs9', v_nota);
  IF NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p4') AND tip = 'nota_neaprobata' AND referinta = 'NCS NCS-9') THEN
    RAISE EXCEPTION 't_ultimul_act FAIL: lipsa nota_neaprobata';
  END IF;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p4'), 'nota_comanda_suplimentara', NULL, v_nota, NULL, 'ncs9.xlsx', repeat('a9', 32),
           '[{"obiect_cod":"OB1","deviz_cod":"D1","cod":"X","denumire":"x","um":"M","cantitate":20,"pret_unitar":11,"valoare":220}]'::jsonb);
    RAISE EXCEPTION 't_ultimul_act FAIL: devizul unei note NEAPROBATE acceptat';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%nota_neaprobata%' THEN RAISE; END IF; END;
  IF (SELECT cantitate FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p4') AND cheie = 'OB1|D1|X') <> 100 THEN RAISE EXCEPTION 't_ultimul_act FAIL: refuzul a scris'; END IF;
  UPDATE public.executie_note_modificare SET data_aprobare = DATE '2026-04-01' WHERE id = v_nota;
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p4'), 'nota_comanda_suplimentara', NULL, v_nota, NULL, 'ncs9.xlsx', repeat('a9', 32),
         '[{"obiect_cod":"OB1","deviz_cod":"D1","cod":"X","denumire":"x","um":"M","cantitate":20,"pret_unitar":11,"valoare":220}]'::jsonb);
  SELECT cantitate, pret_unitar INTO r FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p4') AND cheie = 'OB1|D1|X';
  IF r.cantitate <> 120 OR r.pret_unitar <> 11 THEN RAISE EXCEPTION 't_ultimul_act FAIL: nota aprobata → % (astept 120, pret 11)', row_to_json(r); END IF;
  -- aprobarea retrasa (data_aprobare NULL): randurile notei ies din baza, lipsa reapare
  UPDATE public.executie_note_modificare SET data_aprobare = NULL WHERE id = v_nota;
  SELECT cantitate, pret_unitar INTO r FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p4') AND cheie = 'OB1|D1|X';
  IF r.cantitate <> 100 OR r.pret_unitar <> 10 OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p4') AND tip = 'nota_neaprobata') THEN
    RAISE EXCEPTION 't_ultimul_act FAIL: nota cu aprobarea retrasa inca in baza: %', row_to_json(r);
  END IF;
  UPDATE public.executie_note_modificare SET data_aprobare = DATE '2026-04-01' WHERE id = v_nota;
END $t$;
RESET ROLE;
-- (r6 → r7) SERVERUL scrie obiectul AMBELOR randuri ale cheii OB1|D1|X (oferta + NCS-9) in alta forma bruta (' ob1 '; identitatea canonica si cheia raman
--    OB1 / OB1|D1|X; o singura forma PE CHEIE, deci fara ambiguitate): un proiect cu forme brute amestecate ale aceluiasi obiect — lista completa de mai jos
--    trebuie sa inlocuiasca TOATE randurile obiectului (pe identitatea canonica, nu pe brut), inclusiv cele 'OB1' ale celorlalte chei
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
DO $t$
BEGIN
  IF auth.uid() IS NOT NULL OR public.fn_rest_decontat_server() IS NOT TRUE THEN RAISE EXCEPTION 't_ultimul_act PRECONDITIE: blocul serverului cere auth.uid() NULL si rolul postgres'; END IF;
  UPDATE public.proiect_articole SET obiect_cod = ' ob1 ' WHERE proiect_id = pg_temp.rd_id('p4') AND cheie = 'OB1|D1|X';
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p4') AND obiect_cod = ' ob1 ' AND cheie = 'OB1|D1|X' AND confirmat_la IS NOT NULL) <> 2
     OR (SELECT count(DISTINCT obiect_cod) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p4')) <> 2 THEN
    RAISE EXCEPTION 't_ultimul_act PRECONDITIE: cele 2 randuri ale cheii X (oferta + NCS-9) scrise de server cu obiectul '' ob1 '' (cheia neschimbata), celelalte ''OB1''';
  END IF;
END $t$;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000a', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; r record;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000a');
  SELECT cantitate, pret_unitar, randuri INTO r FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p4') AND cheie = 'OB1|D1|X';
  IF r.cantitate <> 120 OR r.pret_unitar <> 11 OR r.randuri <> 2 THEN RAISE EXCEPTION 't_ultimul_act PRECONDITIE: X = 120 @11 din 2 randuri (oferta '' ob1 '' + NCS-9) inaintea AA-4: %', row_to_json(r); END IF;
  -- AA-4 (2026-05-01) lista completa, obiectul venit 'OB1' (r7: scris ' ob1 ', forma randului cu aceeasi cheie): inlocuieste TOT ce e datat inainte pe OB1 —
  -- oferta (randurile 'OB1' ale cheilor A / B si randul X scris ' ob1 '), NCS-9 — pe identitatea canonica → doar X = 150, pret 12
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p4'), 'act_aditional', pg_temp.rd_id('aa4'), NULL, 'lista_completa', 'aa4.xlsx', repeat('a5', 32),
         '[{"obiect_cod":"OB1","deviz_cod":"D1","cod":"X","denumire":"x revizuit","um":"M","cantitate":150,"pret_unitar":12,"valoare":1800}]'::jsonb);
  SELECT string_agg(b.cheie || '=' || b.cantitate::text || ' @' || coalesce(b.pret_unitar::text, '-') || ' r' || b.randuri, '; ' ORDER BY b.cheie) AS s INTO r
    FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p4');
  IF r.s IS DISTINCT FROM 'OB1|D1|X=150 @12 r1' THEN RAISE EXCEPTION 't_ultimul_act FAIL lista completa pe identitate canonica (randurile ''OB1'' ale ofertei au ramas?): %', r.s; END IF;
  -- (r7) randul AA-4 e scris cu obiect_cod ' ob1 ' (forma randului cu aceeasi cheie OB1|D1|X), nu 'OB1' (forma majoritara a obiectului) si nu cum vine
  IF (SELECT obiect_cod FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p4') AND act_aditional_id = pg_temp.rd_id('aa4')) IS DISTINCT FROM ' ob1 ' THEN
    RAISE EXCEPTION 't_ultimul_act FAIL: randul AA-4 nu e scris in forma randului cu aceeasi cheie ('' ob1 ''): %', (SELECT obiect_cod FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p4') AND act_aditional_id = pg_temp.rd_id('aa4'));
  END IF;
  -- AA-5 (2026-02-01, mai vechi) incarcat DUPA AA-4, „doar diferente” +10 pret 9: e datat inaintea listei complete → ignorat; pretul ramane al AA-4
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p4'), 'act_aditional', pg_temp.rd_id('aa5'), NULL, 'diferente', 'aa5.xlsx', repeat('a6', 32),
         '[{"obiect_cod":"OB1","deviz_cod":"D1","cod":"X","denumire":"x","um":"M","cantitate":10,"pret_unitar":9,"valoare":90}]'::jsonb);
  SELECT cantitate, pret_unitar, randuri INTO r FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p4') AND cheie = 'OB1|D1|X';
  IF r.cantitate <> 150 OR r.pret_unitar <> 12 OR r.randuri <> 1 THEN RAISE EXCEPTION 't_ultimul_act FAIL: actul vechi incarcat tarziu a trecut peste lista completa: %', row_to_json(r); END IF;
  -- AA-4 dezactivat: lista completa dispare, raman oferta (100 @10), NCS-9 (+20 @11, 2026-04) si AA-5 (+10 @9, 2026-02) → 130, pretul = NCS-9 (data cea mai recenta)
  UPDATE public.executie_acte_aditionale SET activ = false WHERE id = pg_temp.rd_id('aa4');
  SELECT cantitate, pret_unitar, randuri INTO r FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p4') AND cheie = 'OB1|D1|X';
  IF r.cantitate <> 130 OR r.pret_unitar <> 11 OR r.randuri <> 3 THEN RAISE EXCEPTION 't_ultimul_act FAIL: fara AA-4 → % (astept 130 @11, 3 randuri)', row_to_json(r); END IF;
  UPDATE public.executie_acte_aditionale SET activ = true WHERE id = pg_temp.rd_id('aa4');
  RAISE NOTICE 't_ultimul_act ok: nota neaprobata refuzata / exclusa, aprobata → 120 @11; lista completa pe obiectul cu forme amestecate (X in " ob1 ") → 150 @12 (nu 250), randul AA-4 scris " ob1 " (forma cheii); actul vechi incarcat tarziu ignorat; fara AA-4 → 130 @11';
END $t$;
RESET ROLE;

-- ── t_drept_restrans: restrictia pe proiect (20261209a) se aplica inaintea dreptului de modul: h (editor pe sub-modul, viewer pe P2) citeste doar
--    P2 si nu confirma; i (editor pe sub-modul, editor pe P2) confirma doar pe P2; P1 e invizibil pentru amandoi ──
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000011', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-000000000011');
  IF public.fn_rest_decontat_drept(pg_temp.rd_id('p1'), 'citire') OR public.fn_rest_decontat_drept(pg_temp.rd_id('p3'), 'citire') OR public.fn_rest_decontat_drept(pg_temp.rd_id('p4'), 'citire')
     OR NOT public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'citire') OR public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'confirmare') OR public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'documente_baza') THEN
    RAISE EXCEPTION 't_drept_restrans FAIL: dreptul contului restrans viewer pe P2';
  END IF;
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat WHERE proiect_id <> pg_temp.rd_id('p2')) OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_baza WHERE proiect_id <> pg_temp.rd_id('p2'))
     OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_obiect WHERE proiect_id <> pg_temp.rd_id('p2')) OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id <> pg_temp.rd_id('p2'))
     OR EXISTS (SELECT 1 FROM public.executie_note_modificare) OR EXISTS (SELECT 1 FROM public.executie_sl_detaliu) OR EXISTS (SELECT 1 FROM public.executie_sl_detaliu_linii)
     OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p2') AND tip = 'fara_oferta') THEN
    RAISE EXCEPTION 't_drept_restrans FAIL: contul restrans vede alte proiecte decat P2 (functiile DEFINER)';
  END IF;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p2'), 'contract_initial', NULL, NULL, NULL, 'o2.xlsx', repeat('a2', 32), '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"A","denumire":"a","um":"M","cantitate":1,"valoare":10}]'::jsonb);
    RAISE EXCEPTION 't_drept_restrans FAIL: viewer-ul pe proiect a confirmat oferta';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'act_aditional', pg_temp.rd_id('aa1'), NULL, 'diferente', 'x.xlsx', repeat('a3', 32), '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"A100","denumire":"x","um":"M","cantitate":1,"valoare":100}]'::jsonb);
    RAISE EXCEPTION 't_drept_restrans FAIL: contul restrans a confirmat pe P1';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.executie_note_modificare (proiect_id, tip, numar) VALUES (pg_temp.rd_id('p1'), 'NR', 'NR-H'); RAISE EXCEPTION 't_drept_restrans FAIL: nota pe P1 scrisa de contul restrans';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 't_drept_restrans (1/2) ok: viewer pe P2 → citeste doar P2 in cele 4 vederi, nu confirma, P1 invizibil';
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000012', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-000000000012","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-000000000012');
  IF public.fn_rest_decontat_drept(pg_temp.rd_id('p1'), 'citire') OR public.fn_rest_decontat_drept(pg_temp.rd_id('p1'), 'documente_baza')
     OR NOT public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'confirmare') OR NOT public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'documente_baza') THEN
    RAISE EXCEPTION 't_drept_restrans FAIL: dreptul contului restrans editor pe P2';
  END IF;
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat WHERE proiect_id <> pg_temp.rd_id('p2')) THEN RAISE EXCEPTION 't_drept_restrans FAIL: editorul restrans vede P1'; END IF;
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p2'), 'contract_initial', NULL, NULL, NULL, 'o2.xlsx', repeat('a2', 32), '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"A","denumire":"a","um":"M","cantitate":1,"valoare":10}]'::jsonb);
  IF (v->>'inserate')::int <> 1 OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p2') AND cheie = '0001|D1|A') THEN RAISE EXCEPTION 't_drept_restrans FAIL: editorul pe P2 nu a confirmat oferta P2'; END IF;
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '8', NULL, 'x.xlsx', repeat('a7', 32), '[{"cod":"A100","um":"M","cantitate_perioada":1,"valoare":100,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]'::jsonb, false);
    RAISE EXCEPTION 't_drept_restrans FAIL: editorul restrans a confirmat o situatie pe P1';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 't_drept_restrans (2/2) ok: editor pe P2 → confirma pe P2, nimic pe P1';
END $t$;
RESET ROLE;

-- ── t_drept_sef_santier: executie viewer + sef de santier pe P1, fara sub-modul, nu e MP → 0 randuri peste tot, RPC-uri refuzate ──────
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; v_id bigint;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat) OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_baza)
     OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_obiect) OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri)
     OR EXISTS (SELECT 1 FROM public.executie_note_modificare) OR EXISTS (SELECT 1 FROM public.executie_sl_detaliu) OR EXISTS (SELECT 1 FROM public.executie_sl_detaliu_linii) THEN
    RAISE EXCEPTION 't_drept FAIL: seful de santier vede randuri';
  END IF;
  IF public.fn_rest_decontat_drept(pg_temp.rd_id('p1'), 'citire') OR public.fn_rest_decontat_drept(pg_temp.rd_id('p1'), 'confirmare') OR public.fn_rest_decontat_drept(pg_temp.rd_id('p1'), 'documente_baza')
     OR public.fn_rest_decontat_are_oferta(pg_temp.rd_id('p1')) THEN
    RAISE EXCEPTION 't_drept FAIL: dreptul sefului de santier';
  END IF;
  -- accesul general la Executie vede proiect_articole (politicile vechi), dar nu poate atinge randurile confirmate nici direct
  IF NOT EXISTS (SELECT 1 FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p1')) THEN RAISE EXCEPTION 't_drept FAIL: politicile vechi proiect_articole s-au schimbat'; END IF;
  BEGIN UPDATE public.proiect_articole SET cantitate = 999 WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100' AND sursa = 'contract_initial'; RAISE EXCEPTION 't_drept FAIL: rand confirmat modificat direct';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100'; RAISE EXCEPTION 't_drept FAIL: rand confirmat sters direct';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa, confirmat_de, confirmat_la)
    VALUES (pg_temp.rd_id('p1'), '0001', 'D1', 'A100', 'x', 'M', 1, 1, 'contract_initial', auth.uid(), now());
    RAISE EXCEPTION 't_drept FAIL: coloanele de confirmare scrise direct';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa, cheie)
    VALUES (pg_temp.rd_id('p1'), '0001', 'D1', 'A100', 'x', 'M', 1, 1, 'extras_materiale', 'ALTA|CHEIE');
    RAISE EXCEPTION 't_drept FAIL: cheie arbitrara acceptata';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- calea veche (CatalogDevizPanel) merge ca inainte: rand fara cheie → cheia calculata in BD; nu intra in baza (nu e oferta) si nu se vede restul
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa)
  VALUES (pg_temp.rd_id('p1'), '0001', 'D1', ' a100 ', 'extras', 'M', 7, 0, 'extras_materiale') RETURNING id INTO v_id;
  IF (SELECT cheie FROM public.proiect_articole WHERE id = v_id) <> '0001|D1|A100' THEN RAISE EXCEPTION 't_drept FAIL: cheia nu s-a calculat pe calea veche'; END IF;
  UPDATE public.proiect_articole SET cod = 'A101' WHERE id = v_id;
  IF (SELECT cheie FROM public.proiect_articole WHERE id = v_id) <> '0001|D1|A101' THEN RAISE EXCEPTION 't_drept FAIL: cheia nu s-a recalculat la schimbarea codului'; END IF;
  DELETE FROM public.proiect_articole WHERE id = v_id;
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '8', NULL, 'x.xlsx', repeat('f1', 32), '[{"cod":"A100","um":"M","cantitate_perioada":1,"valoare":100,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]'::jsonb, false);
    RAISE EXCEPTION 't_drept FAIL: seful de santier a confirmat o situatie';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'act_aditional', pg_temp.rd_id('aa1'), NULL, 'diferente', 'x.xlsx', repeat('f2', 32), '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"A100","denumire":"x","um":"M","cantitate":1,"valoare":100}]'::jsonb);
    RAISE EXCEPTION 't_drept FAIL: seful de santier a confirmat un deviz';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.executie_sl_detaliu (proiect_id, nr_situatie, amprenta, confirmat_de) VALUES (pg_temp.rd_id('p1'), '8', repeat('f3', 32), auth.uid()); RAISE EXCEPTION 't_drept FAIL: INSERT direct in executie_sl_detaliu';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.executie_note_modificare (proiect_id, tip, numar) VALUES (pg_temp.rd_id('p1'), 'NR', 'NR-1'); RAISE EXCEPTION 't_drept FAIL: nota scrisa de seful de santier';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 't_drept_sef_santier (1/3) ok: 0 randuri in 4 vederi + 3 tabele; RPC-uri / scrieri directe refuzate; calea veche a articolelor merge, cu cheia din BD';
END $t$;
RESET ROLE;
-- contul fara niciun drept (g) si directorul financiar (c, viewer pe sub-modul: citeste tot, nu confirma)
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000010', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-000000000010","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-000000000010');
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat) OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri) OR EXISTS (SELECT 1 FROM public.executie_sl_detaliu) THEN
    RAISE EXCEPTION 't_drept FAIL: contul fara drepturi vede randuri';
  END IF;
  RAISE NOTICE 't_drept_sef_santier (2/3) ok: contul fara drepturi nu vede nimic';
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000c', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000c');
  IF NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p3') AND tip = 'fara_oferta')
     OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p2') AND tip = 'fara_oferta')
     OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100')
     OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p2') AND cheie = '0001|D1|A')
     OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p4') AND cheie = 'OB1|D1|X')
     OR (SELECT count(*) FROM public.executie_sl_detaliu WHERE proiect_id = pg_temp.rd_id('p1')) <> 7 THEN
    RAISE EXCEPTION 't_drept FAIL: directorul financiar nu vede toate proiectele (P1, P2 cu oferta, P3 fara oferta, P4)';
  END IF;
  IF NOT public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'citire') OR public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'confirmare') THEN RAISE EXCEPTION 't_drept FAIL: viewer pe sub-modul'; END IF;
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '8', NULL, 'x.xlsx', repeat('f4', 32), '[{"cod":"A100","um":"M","cantitate_perioada":1,"valoare":100,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]'::jsonb, false);
    RAISE EXCEPTION 't_drept FAIL: viewer-ul a confirmat o situatie';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 't_drept_sef_santier (3/3) ok: directorul financiar (viewer) citeste toate proiectele, nu confirma; MP-ul vede doar proiectele lui (blocul t_fara_baza)';
END $t$;
RESET ROLE;
-- editorul pe sub-modul (d) confirma; nimeni nu trece de garda situatiilor cu rolul service_role (fara drepturi pe tabele)
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000d', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000d');
  IF NOT public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'confirmare') OR NOT public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'documente_baza') THEN RAISE EXCEPTION 't_drept FAIL: editorul pe sub-modul'; END IF;
END $t$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $t$
BEGIN
  BEGIN PERFORM 1 FROM public.executie_sl_detaliu; RAISE EXCEPTION 't_drept FAIL: service_role citeste situatiile detaliate direct';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.v_executie_rest_decontat; RAISE EXCEPTION 't_drept FAIL: service_role citeste vederea';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $t$;
RESET ROLE;

-- ── t_oferta_confirmata (r4 → r5, review #1158): starile ofertei, PE OBIECT. (1/7) accesul general (e): pe P3 (obiectele 0001 si 0002, toate „vechi”)
--    calea veche merge (INSERT, UPDATE, DELETE, cu cheia din BD) si garda tine advisory-ul proiectului (pg_locks: ACEEASI cheie ca RPC-ul); pe P1
--    (obiectul 0001 confirmat) INSERT-ul direct pe 0001 si reparentarea unui rand din P3 spre P1 sunt refuzate cu mesajul „Rest de decontat”, dar un
--    obiect NOU al P1 (0009) ramane pe calea veche (INSERT + DELETE merg, declarat in lipsuri cat exista); cititorii vechi inregistrati INAINTE ──
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v_id bigint; v_nou bigint; n int; k bigint; s text;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  IF public.fn_rest_decontat_obiect_confirmat(pg_temp.rd_id('p3'), '0001') OR public.fn_rest_decontat_obiect_confirmat(pg_temp.rd_id('p3'), '0002')
     OR NOT public.fn_rest_decontat_obiect_confirmat(pg_temp.rd_id('p1'), '0001') OR NOT public.fn_rest_decontat_obiect_confirmat(pg_temp.rd_id('p1'), ' 0002 ')
     OR public.fn_rest_decontat_obiect_confirmat(pg_temp.rd_id('p1'), '0009') THEN
    RAISE EXCEPTION 't_oferta_confirmata PRECONDITIE: P3 fara obiecte confirmate, P1 cu 0001 / 0002 confirmate (identitate canonica), 0009 neconfirmat';
  END IF;
  k := hashtextextended('gazpet.rest_decontat:' || pg_temp.rd_id('p3')::text, 0);
  IF EXISTS (SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted AND l.objsubid = 1
               AND l.classid = ((k >> 32) & 4294967295)::bigint::oid AND l.objid = (k & 4294967295)::bigint::oid) THEN
    RAISE EXCEPTION 't_oferta_confirmata PRECONDITIE: advisory-ul P3 e deja tinut in tranzactie';
  END IF;
  -- calea veche pe P3: obiectul 0001 cu 3 randuri (unul cu UM „100 MC” — RPC-ul va veni cu MC pe aceeasi cheie: randul vechi nu trebuie sa blocheze),
  -- obiectul 0002 cu 2 randuri (NU va fi importat in (2/7): trebuie sa ramana neatins)
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa) VALUES
    (pg_temp.rd_id('p3'), '0001', 'TRONSON 1', 'D1', '1', 'A100', 'Conducta veche', 'M', 90, 9000, 'contract_initial'),
    (pg_temp.rd_id('p3'), '0001', 'TRONSON 1', 'D1', '2', 'B200', 'Sapatura veche', '100 MC', 2, 2000, 'contract_initial'),
    (pg_temp.rd_id('p3'), '0001', 'TRONSON 1', 'D1', '3', 'C300', 'Articol vechi, dispare la confirmare', 'BUC', 10, 500, 'contract_initial'),
    (pg_temp.rd_id('p3'), '0002', 'TRONSON 2', 'D2', '1', 'E500', 'Conducta tronson 2 (neimportat)', 'M', 40, 4000, 'contract_initial'),
    (pg_temp.rd_id('p3'), '0002', 'TRONSON 2', 'D2', '2', 'F600', 'Robinet tronson 2 (neimportat)', 'BUC', 3, 300, 'contract_initial');
  -- garda a luat advisory-ul proiectului (acelasi ca RPC-ul) si il tine pana la COMMIT
  IF NOT EXISTS (SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted AND l.objsubid = 1
                   AND l.classid = ((k >> 32) & 4294967295)::bigint::oid AND l.objid = (k & 4294967295)::bigint::oid) THEN
    RAISE EXCEPTION 't_oferta_confirmata FAIL: garda nu tine advisory-ul proiectului dupa INSERT-ul pe calea veche (cursa cu RPC-ul)';
  END IF;
  SELECT id INTO v_id FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p3') AND cod = 'C300';
  UPDATE public.proiect_articole SET cantitate = 11, valoare = 550 WHERE id = v_id;
  IF (SELECT cantitate FROM public.proiect_articole WHERE id = v_id) <> 11 THEN RAISE EXCEPTION 't_oferta_confirmata FAIL: UPDATE pe calea veche (obiect vechi) nu a mers'; END IF;
  DELETE FROM public.proiect_articole WHERE id = v_id;
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa)
  VALUES (pg_temp.rd_id('p3'), '0001', 'TRONSON 1', 'D1', '3', 'C300', 'Articol vechi, dispare la confirmare', 'BUC', 10, 500, 'contract_initial') RETURNING id INTO v_id;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p3') AND sursa = 'contract_initial' AND activ AND confirmat_la IS NULL AND cheie LIKE '000_|D_|%') <> 5 THEN
    RAISE EXCEPTION 't_oferta_confirmata FAIL: calea veche pe P3 nu a lasat 5 randuri (3 + 2) cu cheia din BD';
  END IF;
  -- cititorii vechi INAINTE de confirmare (valorile asteptate scrise de mana din randurile de mai sus, L25)
  s := pg_temp.rd_cititori(pg_temp.rd_id('p3'), '0001');
  IF s IS DISTINCT FROM 'activitati:3/102; catalog:3/11500; tinte:3/102; configurare:3; obiecte:0001,0002' THEN RAISE EXCEPTION 't_oferta_confirmata PRECONDITIE cititori 0001 inainte: %', s; END IF;
  INSERT INTO rd_cons VALUES ('p3_0001_inainte', s);
  s := pg_temp.rd_cititori(pg_temp.rd_id('p3'), '0002');
  IF s IS DISTINCT FROM 'activitati:2/43; catalog:2/4300; tinte:2/43; configurare:2; obiecte:0001,0002' THEN RAISE EXCEPTION 't_oferta_confirmata PRECONDITIE cititori 0002 inainte: %', s; END IF;
  INSERT INTO rd_cons VALUES ('p3_0002_inainte', s);
  -- P1 (0001 confirmat): INSERT direct contract_initial pe 0001 = refuz cu mesajul clar; reparentarea randului din P3 / 0001 spre P1 = refuz; randul ramane pe P3
  SELECT count(*) INTO n FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p1');
  BEGIN
    INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa)
    VALUES (pg_temp.rd_id('p1'), ' 0001', 'D1', '1', 'A100', 'Conducta', 'M', 100, 10000, 'contract_initial');
    RAISE EXCEPTION 't_oferta_confirmata FAIL: oferta veche reimportata direct pe un obiect cu oferta confirmata (reproducerea P1 r3; identitatea canonica a obiectului)';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%obiectul % al proiectului % are oferta confirmata%Rest de decontat%' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.proiect_articole SET proiect_id = pg_temp.rd_id('p1') WHERE id = v_id;
    RAISE EXCEPTION 't_oferta_confirmata FAIL: rand contract_initial reparentat spre un obiect cu oferta confirmata';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%obiectul % al proiectului % are oferta confirmata%' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p1')) <> n OR (SELECT proiect_id FROM public.proiect_articole WHERE id = v_id) <> pg_temp.rd_id('p3') THEN
    RAISE EXCEPTION 't_oferta_confirmata FAIL: refuzurile au scris ceva';
  END IF;
  -- un obiect NOU al P1 (0009, fara oferta confirmata) ramane pe calea veche: INSERT-ul merge, obiectul intra in baza si e declarat in lipsuri; apoi se sterge
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa)
  VALUES (pg_temp.rd_id('p1'), '0009', 'OBIECT NOU', 'D9', '1', 'N900', 'Articol vechi pe obiect nou', 'M', 7, 700, 'contract_initial') RETURNING id INTO v_nou;
  IF (SELECT cheie FROM public.proiect_articole WHERE id = v_nou) <> '0009|D9|N900' THEN RAISE EXCEPTION 't_oferta_confirmata FAIL: cheia obiectului nou'; END IF;
  -- (baza / lipsurile P1 le vede MP-ul b, in (2/7)); stergerea pe calea veche a obiectului nou merge
  DELETE FROM public.proiect_articole WHERE id = v_nou;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p1')) <> n THEN RAISE EXCEPTION 't_oferta_confirmata FAIL: obiectul nou al P1 nu s-a sters pe calea veche'; END IF;
  RAISE NOTICE 't_oferta_confirmata (1/7) ok: calea veche merge pe P3 (0001 + 0002, toate vechi) si tine advisory-ul proiectului; pe P1 / 0001 (confirmat) INSERT-ul direct si reparentarea sunt refuzate (42501, mesaj Rest de decontat), obiectul nou 0009 al P1 ramane pe calea veche; cititorii vechi inregistrati';
END $t$;
RESET ROLE;
-- (2/7) MP-ul (b) confirma prin RPC DOAR obiectul 0001 al P3 (import PARTIAL): randurile vechi ale lui 0001 sunt MUTATE in istoric (inlocuite = 3, niciunul
--    confirmat), baza 0001 = doar oferta confirmata (A100 = 100, nu 190; B200 = 200 MC venit ca „MC” x 200 pe randul vechi in „100 MC” x 2 — acelasi UM
--    normalizat, deci trece; C300 lipseste), obiectul 0002 ramane NEATINS in baza cu valoarea veche (E500 = 40 M, F600 = 3 BUC) si e declarat in lipsuri
--    ('oferta_neconfirmata'); istoricul e citibil de MP. r6: liniile vin cu obiect_cod „ 0001 ” — identitatea canonica e aceeasi, reprezentarea scrisa e cea existenta
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; r record; s text;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  IF NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p3') AND cheie = '0001|D1|A100' AND cantitate = 90)
     OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p3') AND cheie = '0002|D2|E500' AND cantitate = 40) THEN
    RAISE EXCEPTION 't_oferta_confirmata PRECONDITIE: baza veche P3 (A100 = 90, E500 = 40) nu e in calcul inaintea confirmarii';
  END IF;
  SELECT string_agg(l.referinta, '; ' ORDER BY l.referinta) INTO s FROM public.v_executie_rest_decontat_lipsuri l WHERE l.proiect_id = pg_temp.rd_id('p3') AND l.tip = 'oferta_neconfirmata';
  IF s IS DISTINCT FROM 'obiect 0001: contract_initial 3; obiect 0002: contract_initial 2' THEN RAISE EXCEPTION 't_oferta_confirmata PRECONDITIE: lipsurile oferta_neconfirmata pe P3 inainte: %', coalesce(s, 'nimic'); END IF;
  IF EXISTS (SELECT 1 FROM public.proiect_articole_istoric WHERE proiect_id = pg_temp.rd_id('p3')) THEN RAISE EXCEPTION 't_oferta_confirmata PRECONDITIE: istoricul P3 nu e gol'; END IF;
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p3'), 'contract_initial', NULL, NULL, NULL, 'oferta3_ob1.xlsx', repeat('b3', 32), $j$[
    {"obiect_cod":" 0001 ","obiect_nume":"TRONSON 1","deviz_cod":"D1","deviz_nume":"Montaj","nr":"1","cod":"A100","denumire":"Conducta","um":"M","cantitate":100,"pret_unitar":100,"valoare":10000},
    {"obiect_cod":" 0001 ","obiect_nume":"TRONSON 1","deviz_cod":"D1","deviz_nume":"Montaj","nr":"2","cod":"B200","denumire":"Sapatura","um":"MC","cantitate":200,"pret_unitar":10,"valoare":2000}]$j$::jsonb);
  IF (v->>'inserate')::int <> 2 OR (v->>'inlocuite')::int <> 3 OR (v->>'inlocuite_confirmate')::int <> 0 OR v->'obiecte' IS DISTINCT FROM '["0001||"]'::jsonb
     OR v->'um_schimbate' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 't_oferta_confirmata FAIL import partial 0001: % (astept inserate 2, inlocuite 3, inlocuite_confirmate 0, obiecte ["0001||"], um_schimbate [])', v;
  END IF;
  SELECT string_agg(b.cheie || '=' || b.cantitate::text || ' ' || b.um || ' r' || b.randuri, '; ' ORDER BY b.cheie) AS s, coalesce(sum(b.valoare), 0) AS val INTO r
    FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p3');
  IF r.s IS DISTINCT FROM '0001|D1|A100=100 M r1; 0001|D1|B200=200 MC r1; 0002|D2|E500=40 M r1; 0002|D2|F600=3 BUC r1' OR r.val <> 16300 THEN
    RAISE EXCEPTION 't_oferta_confirmata FAIL: baza P3 dupa importul partial (0001 confirmat, 0002 vechi neatins): % (val %)', r.s, r.val;
  END IF;
  IF NOT public.fn_rest_decontat_obiect_confirmat(pg_temp.rd_id('p3'), '0001') OR public.fn_rest_decontat_obiect_confirmat(pg_temp.rd_id('p3'), '0002') THEN
    RAISE EXCEPTION 't_oferta_confirmata FAIL: starile obiectelor P3 dupa import partial (0001 confirmat, 0002 vechi)';
  END IF;
  SELECT string_agg(l.tip || '=' || l.referinta, '; ' ORDER BY l.tip, l.referinta) INTO s FROM public.v_executie_rest_decontat_lipsuri l
   WHERE l.proiect_id = pg_temp.rd_id('p3') AND l.tip IN ('fara_oferta', 'oferta_neconfirmata', 'oferta_veche_neconfirmata');
  IF s IS DISTINCT FROM 'oferta_neconfirmata=obiect 0002: contract_initial 2' THEN RAISE EXCEPTION 't_oferta_confirmata FAIL: lipsurile P3 dupa import partial (astept doar obiectul 0002 neconfirmat): %', coalesce(s, 'nimic'); END IF;
  -- istoricul: cele 3 randuri vechi ale lui 0001, intregi, cu motivul si amprenta fisierului nou; MP-ul le citeste (dreptul de citire al P3)
  SELECT count(*)::int AS n, string_agg(h.rand->>'cod', ',' ORDER BY h.rand->>'cod') AS coduri, bool_and(h.obiect_k = '0001||' AND h.sursa = 'contract_initial' AND h.confirmat_la IS NULL
           AND h.motiv = 'confirmare_oferta' AND h.inlocuit_cu_amprenta = repeat('b3', 32) AND h.retras_de = auth.uid() AND (h.rand->>'proiect_id')::bigint = pg_temp.rd_id('p3')
           AND (h.rand->>'valoare')::numeric IN (9000, 2000, 500)) AS ok INTO r
    FROM public.proiect_articole_istoric h WHERE h.proiect_id = pg_temp.rd_id('p3');
  IF r.n <> 3 OR r.coduri <> 'A100,B200,C300' OR r.ok IS NOT TRUE THEN RAISE EXCEPTION 't_oferta_confirmata FAIL: istoricul randurilor vechi ale lui 0001: % % %', r.n, r.coduri, r.ok; END IF;
  -- in proiect_articole NU ramane niciun rand retras / vechi al lui 0001 (cititorii vechi nu-l vad)
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p3') AND cheie = '0001|D1|C300') THEN RAISE EXCEPTION 't_oferta_confirmata FAIL: C300 vechi a ramas in baza'; END IF;
  RAISE NOTICE 't_oferta_confirmata (2/7) ok: import partial — doar 0001 confirmat prin RPC (inserate 2, inlocuite 3 mutate in istoric; B200 venit ca MC x 200 pe randul vechi in 100 MC), 0002 neatins in baza (E500 40 M, F600 3 BUC) si declarat oferta_neconfirmata; baza 16300, fara cumulare';
END $t$;
RESET ROLE;
-- (3/7) accesul general (e) pe P3 dupa importul partial: CITITORII VECHI vad pe 0002 EXACT ce vedeau inainte si pe 0001 doar randurile confirmate (fara
--    rânduri retrase); pe 0001 calea veche e inchisa (INSERT, UPDATE / DELETE pe randul confirmat, DELETE pe toata oferta ca in CatalogDevizPanel, mutarea
--    unui rand din 0002 spre 0001, schimbarea sursei unui extras spre contract_initial pe 0001 = 42501), pe 0002 merge (INSERT + DELETE); nimic scris
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v_conf bigint; v_vechi2 bigint; v_id bigint; n int; s text;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  s := pg_temp.rd_cititori(pg_temp.rd_id('p3'), '0002');
  IF s IS DISTINCT FROM (SELECT v FROM rd_cons WHERE k = 'p3_0002_inainte') OR s IS DISTINCT FROM 'activitati:2/43; catalog:2/4300; tinte:2/43; configurare:2; obiecte:0001,0002' THEN
    RAISE EXCEPTION 't_oferta_confirmata FAIL: cititorii vechi vad altceva pe obiectul NEIMPORTAT 0002 dupa confirmarea lui 0001: % (inainte %)', s, (SELECT v FROM rd_cons WHERE k = 'p3_0002_inainte');
  END IF;
  s := pg_temp.rd_cititori(pg_temp.rd_id('p3'), '0001');
  IF s IS DISTINCT FROM 'activitati:2/102; catalog:2/12000; tinte:2/102; configurare:2; obiecte:0001,0002' THEN
    RAISE EXCEPTION 't_oferta_confirmata FAIL: cititorii vechi vad pe 0001 altceva decat randurile confirmate (randuri retrase ramase? cumulare? reprezentarea bruta „ 0001 ” / MC x 200?): %', s;
  END IF;
  INSERT INTO rd_cons VALUES ('p3_0001_confirmat', s);
  -- r6 (P1-2): randul confirmat B200 e scris in REPREZENTAREA EXISTENTA: obiect_cod '0001' (nu „ 0001 ”), um '100 MC' (nu 'MC'), cantitatea 2 (nu 200),
  -- pretul 1000 (nu 10), valoarea 2000; A100 pastreaza 'M' x 100 (acelasi UM brut); niciun rand cu obiect_cod brut diferit
  SELECT string_agg(obiect_cod || '/' || um || '/' || cantitate::text || '/' || coalesce(pret_unitar::text, '-') || '/' || valoare::text, '; ' ORDER BY cod) INTO s
    FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p3') AND sursa = 'contract_initial' AND confirmat_la IS NOT NULL;
  IF s IS DISTINCT FROM '0001/M/100/100/10000; 0001/100 MC/2/1000/2000' THEN
    RAISE EXCEPTION 't_oferta_confirmata FAIL: randurile confirmate nu sunt in reprezentarea existenta (obiect_cod brut / UM brut / cantitate si pret convertite): %', s;
  END IF;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p3') AND sursa = 'contract_initial' AND (NOT activ OR (confirmat_la IS NULL AND obiect_cod = '0001'))) <> 0 THEN
    RAISE EXCEPTION 't_oferta_confirmata FAIL: randuri retrase / vechi ale lui 0001 ramase in proiect_articole';
  END IF;
  SELECT id INTO v_conf FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p3') AND cod = 'A100' AND sursa = 'contract_initial';
  SELECT id INTO v_vechi2 FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p3') AND cod = 'F600' AND sursa = 'contract_initial';
  SELECT count(*) INTO n FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p3');
  BEGIN
    INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa)
    VALUES (pg_temp.rd_id('p3'), '0001', 'D1', '1', 'A100', 'Conducta', 'M', 100, 10000, 'contract_initial');
    RAISE EXCEPTION 't_oferta_confirmata FAIL: reimportul vechi pe obiectul confirmat 0001 acceptat';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%obiectul 0001 al proiectului % are oferta confirmata%Rest de decontat%' THEN RAISE; END IF; END;
  BEGIN UPDATE public.proiect_articole SET cantitate = 99 WHERE id = v_conf; RAISE EXCEPTION 't_oferta_confirmata FAIL: randul confirmat modificat direct';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%nu se modifica direct%' THEN RAISE; END IF; END;
  BEGIN DELETE FROM public.proiect_articole WHERE id = v_conf; RAISE EXCEPTION 't_oferta_confirmata FAIL: randul confirmat sters direct';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%nu se sterg%' THEN RAISE; END IF; END;
  -- ca in CatalogDevizPanel: DELETE pe toata oferta proiectului = refuz (atinge randurile confirmate ale lui 0001), nimic sters (nici pe 0002)
  BEGIN DELETE FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p3') AND sursa = 'contract_initial'; RAISE EXCEPTION 't_oferta_confirmata FAIL: oferta confirmata stearsa pe calea veche';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- mutarea unui rand vechi din 0002 spre obiectul confirmat 0001 = refuz (obiectul NOU al randului e confirmat)
  BEGIN UPDATE public.proiect_articole SET obiect_cod = '0001' WHERE id = v_vechi2; RAISE EXCEPTION 't_oferta_confirmata FAIL: rand vechi mutat spre obiectul confirmat 0001';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%obiectul 0001 al proiectului % are oferta confirmata%' THEN RAISE; END IF; END;
  -- extrasul de materiale (calea veche Magazie) merge; schimbarea sursei lui spre contract_initial pe 0001 = refuz
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa)
  VALUES (pg_temp.rd_id('p3'), '0001', 'D1', 'Z9', 'extras', 'M', 1, 0, 'extras_materiale') RETURNING id INTO v_id;
  BEGIN UPDATE public.proiect_articole SET sursa = 'contract_initial' WHERE id = v_id; RAISE EXCEPTION 't_oferta_confirmata FAIL: sursa unui rand extras schimbata in contract_initial pe un obiect confirmat';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%obiectul 0001 al proiectului % are oferta confirmata%' THEN RAISE; END IF; END;
  DELETE FROM public.proiect_articole WHERE id = v_id;
  -- pe obiectul VECHI 0002 calea veche merge in continuare (INSERT + DELETE); randul vechi al lui 0002 se modifica si se readuce
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa)
  VALUES (pg_temp.rd_id('p3'), '0002', 'D2', '3', 'G700', 'rand vechi nou pe 0002', 'M', 1, 10, 'contract_initial') RETURNING id INTO v_id;
  DELETE FROM public.proiect_articole WHERE id = v_id;
  UPDATE public.proiect_articole SET cantitate = 4 WHERE id = v_vechi2;
  UPDATE public.proiect_articole SET cantitate = 3 WHERE id = v_vechi2;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p3')) <> n OR (SELECT cantitate::text || '/' || obiect_cod FROM public.proiect_articole WHERE id = v_vechi2) <> '3/0002'
     OR pg_temp.rd_cititori(pg_temp.rd_id('p3'), '0002') IS DISTINCT FROM (SELECT v FROM rd_cons WHERE k = 'p3_0002_inainte') THEN
    RAISE EXCEPTION 't_oferta_confirmata FAIL: refuzurile au scris ceva pe P3';
  END IF;
  RAISE NOTICE 't_oferta_confirmata (3/7) ok: cititorii vechi — 0002 identic cu inainte, 0001 doar randurile confirmate (fara retrase), scrise in reprezentarea existenta (0001 / 100 MC x 2); pe 0001 calea veche e inchisa (INSERT / UPDATE / DELETE / mutare / schimbarea sursei → 42501), pe 0002 merge';
END $t$;
RESET ROLE;
-- (4/7) MP-ul (b): re-importul lui 0001 fara „inlocuieste” = 23505 (nimic scris); „inlocuieste” pe un document fara obiect confirmat (0002) = 22023;
--    confirmarea TARZIE a lui 0002 (aceleasi linii ca cele vechi) trece: inlocuite 2, fara lipsuri de oferta pe P3; apoi „inlocuieste” pe 0001 cu aceleasi
--    linii (alt fisier): inlocuite 2 / inlocuite_confirmate 2, randurile confirmate vechi in istoric (motiv inlocuire_oferta); acelasi fisier din nou = 23505
DO $t$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
END $t$;
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; r record; s text; n int;
  LINII_0001 constant jsonb := $j$[
    {"obiect_cod":" 0001 ","obiect_nume":"TRONSON 1","deviz_cod":"D1","deviz_nume":"Montaj","nr":"1","cod":"A100","denumire":"Conducta","um":"M","cantitate":100,"pret_unitar":100,"valoare":10000},
    {"obiect_cod":" 0001 ","obiect_nume":"TRONSON 1","deviz_cod":"D1","deviz_nume":"Montaj","nr":"2","cod":"B200","denumire":"Sapatura","um":"MC","cantitate":200,"pret_unitar":10,"valoare":2000}]$j$::jsonb;
  LINII_0002 constant jsonb := $j$[
    {"obiect_cod":"0002","obiect_nume":"TRONSON 2","deviz_cod":"D2","deviz_nume":"Montaj","nr":"1","cod":"E500","denumire":"Conducta tronson 2","um":"M","cantitate":40,"pret_unitar":100,"valoare":4000},
    {"obiect_cod":"0002","obiect_nume":"TRONSON 2","deviz_cod":"D2","deviz_nume":"Montaj","nr":"2","cod":"F600","denumire":"Robinet tronson 2","um":"BUC","cantitate":3,"pret_unitar":100,"valoare":300}]$j$::jsonb;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  SELECT count(*) INTO n FROM public.proiect_articole_istoric WHERE proiect_id = pg_temp.rd_id('p3');
  IF n <> 3 THEN RAISE EXCEPTION 't_oferta_confirmata PRECONDITIE: istoricul P3 are % randuri (astept 3)', n; END IF;
  -- re-importul obiectului confirmat 0001 fara inlocuieste (alt fisier) = 23505, mesaj cu obiectul; nimic scris
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p3'), 'contract_initial', NULL, NULL, NULL, 'oferta3_ob1_v2.xlsx', repeat('b4', 32), LINII_0001);
    RAISE EXCEPTION 't_oferta_confirmata FAIL: re-importul obiectului confirmat 0001 acceptat fara inlocuieste';
  EXCEPTION WHEN unique_violation THEN IF SQLERRM NOT LIKE '%obiectele 0001||%inlocuieste%' THEN RAISE; END IF; END;
  -- inlocuieste pe un document fara niciun obiect confirmat (0002 e vechi) = 22023
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p3'), 'contract_initial', NULL, NULL, NULL, 'oferta3_ob2.xlsx', repeat('b5', 32), LINII_0002, true);
    RAISE EXCEPTION 't_oferta_confirmata FAIL: inlocuieste acceptat fara obiect confirmat in document';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%inlocuieste%cel putin un obiect%' THEN RAISE; END IF; END;
  -- inlocuieste pe un deviz AA = 22023 (doar pentru oferta)
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'act_aditional', pg_temp.rd_id('aa1'), NULL, 'diferente', 'x.xlsx', repeat('b6', 32), '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"A100","denumire":"x","um":"M","cantitate":1,"valoare":100}]'::jsonb, true);
    RAISE EXCEPTION 't_oferta_confirmata FAIL: inlocuieste acceptat pe un deviz AA';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%doar pentru oferta%' THEN RAISE; END IF; END;
  -- (MP-ul b nu citeste proiect_articole direct — politicile vechi; baza o vede prin vedere)
  IF (SELECT count(*) FROM public.proiect_articole_istoric WHERE proiect_id = pg_temp.rd_id('p3')) <> 3
     OR (SELECT coalesce(sum(b.randuri), 0) FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p3')) <> 4 THEN
    RAISE EXCEPTION 't_oferta_confirmata FAIL: refuzurile RPC au scris ceva';
  END IF;
  -- confirmarea tarzie a obiectului vechi 0002 (aceleasi linii), FARA inlocuieste: trece (nu 23505), randurile vechi ale lui 0002 in istoric
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p3'), 'contract_initial', NULL, NULL, NULL, 'oferta3_ob2.xlsx', repeat('b5', 32), LINII_0002);
  IF (v->>'inserate')::int <> 2 OR (v->>'inlocuite')::int <> 2 OR (v->>'inlocuite_confirmate')::int <> 0 OR v->'obiecte' IS DISTINCT FROM '["0002||"]'::jsonb THEN
    RAISE EXCEPTION 't_oferta_confirmata FAIL confirmarea tarzie a lui 0002: %', v;
  END IF;
  IF NOT public.fn_rest_decontat_obiect_confirmat(pg_temp.rd_id('p3'), '0002')
     OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p3') AND tip IN ('fara_oferta', 'oferta_neconfirmata', 'oferta_veche_neconfirmata')) THEN
    RAISE EXCEPTION 't_oferta_confirmata FAIL: 0002 nu e confirmat / lipsuri de oferta ramase pe P3';
  END IF;
  -- inlocuieste pe 0001 cu aceleasi linii, alt fisier: randurile confirmate vechi merg in istoric (inlocuire_oferta), cele noi le iau locul
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p3'), 'contract_initial', NULL, NULL, NULL, 'oferta3_ob1_v2.xlsx', repeat('b4', 32), LINII_0001, true);
  IF (v->>'inserate')::int <> 2 OR (v->>'inlocuite')::int <> 2 OR (v->>'inlocuite_confirmate')::int <> 2 THEN RAISE EXCEPTION 't_oferta_confirmata FAIL inlocuieste 0001: %', v; END IF;
  SELECT count(*)::int AS n, count(*) FILTER (WHERE h.motiv = 'inlocuire_oferta' AND h.confirmat_la IS NOT NULL AND h.obiect_k = '0001||' AND h.inlocuit_cu_amprenta = repeat('b4', 32) AND (h.rand->>'fisier_amprenta') = repeat('b3', 32))::int AS inl,
         count(*) FILTER (WHERE h.motiv = 'confirmare_oferta' AND h.confirmat_la IS NULL)::int AS conf INTO r
    FROM public.proiect_articole_istoric h WHERE h.proiect_id = pg_temp.rd_id('p3');
  IF r.n <> 7 OR r.inl <> 2 OR r.conf <> 5 THEN RAISE EXCEPTION 't_oferta_confirmata FAIL: istoricul P3 dupa confirmarea tarzie + inlocuieste: % randuri, % inlocuire, % confirmare (astept 7 / 2 / 5)', r.n, r.inl, r.conf; END IF;
  -- acelasi fisier (b4) din nou, cu inlocuieste = 23505 (amprenta deja confirmata); baza neschimbata
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p3'), 'contract_initial', NULL, NULL, NULL, 'oferta3_ob1_v2.xlsx', repeat('b4', 32), LINII_0001, true);
    RAISE EXCEPTION 't_oferta_confirmata FAIL: acelasi fisier reconfirmat cu inlocuieste';
  EXCEPTION WHEN unique_violation THEN IF SQLERRM NOT LIKE '%acelasi fisier%' THEN RAISE; END IF; END;
  -- r6 (P2): fisierul A (b3), inlocuit de B (b4) — randurile lui sunt doar in istoric —, e tot „deja confirmat”: A -> B -> A = 23505, nimic scris
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p3'), 'contract_initial', NULL, NULL, NULL, 'oferta3_ob1.xlsx', repeat('b3', 32), LINII_0001, true);
    RAISE EXCEPTION 't_oferta_confirmata FAIL: fisierul A (b3), inlocuit de B si ramas doar in istoric, a fost reconfirmat (A -> B -> A)';
  EXCEPTION WHEN unique_violation THEN IF SQLERRM NOT LIKE '%acelasi fisier%' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM public.proiect_articole_istoric WHERE proiect_id = pg_temp.rd_id('p3')) <> 7 THEN RAISE EXCEPTION 't_oferta_confirmata FAIL: refuzul A -> B -> A a scris in istoric'; END IF;
  SELECT string_agg(b.cheie || '=' || b.cantitate::text || ' ' || b.um || ' r' || b.randuri, '; ' ORDER BY b.cheie) AS s, coalesce(sum(b.valoare), 0) AS val INTO r
    FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p3');
  IF r.s IS DISTINCT FROM '0001|D1|A100=100 M r1; 0001|D1|B200=200 MC r1; 0002|D2|E500=40 M r1; 0002|D2|F600=3 BUC r1' OR r.val <> 16300 THEN
    RAISE EXCEPTION 't_oferta_confirmata FAIL: baza P3 dupa confirmarea tarzie + inlocuieste: % (val %)', r.s, r.val;
  END IF;
  RAISE NOTICE 't_oferta_confirmata (4/7) ok: re-import 0001 fara inlocuieste = 23505; inlocuieste fara obiect confirmat / pe AA = 22023; confirmarea tarzie a lui 0002 trece (inlocuite 2); inlocuieste 0001 = inlocuite_confirmate 2, istoric 7 randuri; acelasi fisier si fisierul A inlocuit (doar in istoric) = 23505; baza 16300';
END $t$;
RESET ROLE;
-- (5/7) accesul general (e): dupa confirmarea tarzie a lui 0002 si „inlocuieste” pe 0001, AMBELE cu aceleasi linii, cititorii vechi vad EXACT ce vedeau
--    inainte (0002 ca la inceput, 0001 ca dupa prima confirmare); acum si pe 0002 calea veche e inchisa
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE s text;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  s := pg_temp.rd_cititori(pg_temp.rd_id('p3'), '0002');
  IF s IS DISTINCT FROM (SELECT v FROM rd_cons WHERE k = 'p3_0002_inainte') THEN RAISE EXCEPTION 't_oferta_confirmata FAIL: cititorii vechi vad altceva pe 0002 dupa confirmarea cu aceleasi linii: % (inainte %)', s, (SELECT v FROM rd_cons WHERE k = 'p3_0002_inainte'); END IF;
  s := pg_temp.rd_cititori(pg_temp.rd_id('p3'), '0001');
  IF s IS DISTINCT FROM (SELECT v FROM rd_cons WHERE k = 'p3_0001_confirmat') THEN RAISE EXCEPTION 't_oferta_confirmata FAIL: cititorii vechi vad altceva pe 0001 dupa inlocuieste cu aceleasi linii: % (inainte %)', s, (SELECT v FROM rd_cons WHERE k = 'p3_0001_confirmat'); END IF;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p3') AND sursa = 'contract_initial') <> 4
     OR (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p3') AND sursa = 'contract_initial' AND (NOT activ OR confirmat_la IS NULL)) <> 0 THEN
    RAISE EXCEPTION 't_oferta_confirmata FAIL: P3 nu are exact 4 randuri confirmate active (randuri retrase / vechi ramase)';
  END IF;
  BEGIN
    INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa)
    VALUES (pg_temp.rd_id('p3'), '0002', 'D2', '3', 'G700', 'vechi pe 0002 confirmat', 'M', 1, 10, 'contract_initial');
    RAISE EXCEPTION 't_oferta_confirmata FAIL: calea veche deschisa pe 0002 dupa confirmare';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%obiectul 0002 al proiectului % are oferta confirmata%' THEN RAISE; END IF; END;
  RAISE NOTICE 't_oferta_confirmata (5/7) ok: cu aceleasi linii, cititorii vechi vad dupa confirmare / inlocuire EXACT ce vedeau inainte (0001 si 0002); calea veche inchisa si pe 0002';
END $t$;
RESET ROLE;
-- (6/7) SERVERUL (auth.uid() NULL, trece de garda) strecoara pe P3 / 0001 un rand contract_initial activ, neconfirmat: calculul NU il numara (baza P3
--    neschimbata), lipsurile il declara ('oferta_veche_neconfirmata' = 'contract_initial: 1 (obiect 0001)'); apoi randul e scos (server)
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
DO $t$
DECLARE v_id bigint; s text;
BEGIN
  IF auth.uid() IS NOT NULL OR public.fn_rest_decontat_server() IS NOT TRUE THEN
    RAISE EXCEPTION 't_oferta_confirmata PRECONDITIE: blocul serverului cere auth.uid() NULL si rolul postgres (acum % / %)', auth.uid(), current_user;
  END IF;
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa)
  VALUES (pg_temp.rd_id('p3'), '0001', 'D1', '1', 'A100', 'strecurat pe langa garda', 'M', 500, 50000, 'contract_initial') RETURNING id INTO v_id;
  IF (SELECT activ AND confirmat_la IS NULL FROM public.proiect_articole WHERE id = v_id) IS NOT TRUE THEN RAISE EXCEPTION 't_oferta_confirmata PRECONDITIE: randul strecurat nu e activ si neconfirmat'; END IF;
  SELECT string_agg(b.cheie || '=' || b.cantitate::text, '; ' ORDER BY b.cheie) INTO s FROM public.fn_rest_decontat_baza_proiect(pg_temp.rd_id('p3')) b;
  IF s IS DISTINCT FROM '0001|D1|A100=100; 0001|D1|B200=200; 0002|D2|E500=40; 0002|D2|F600=3' THEN RAISE EXCEPTION 't_oferta_confirmata FAIL: randul neconfirmat strecurat pe un obiect confirmat a intrat in baza: %', s; END IF;
  -- lipsurile (ca MP-ul b, care citeste P3; apoi inapoi la server)
  PERFORM set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true);
  SELECT string_agg(l.referinta, '; ' ORDER BY l.referinta) INTO s FROM public.fn_rest_decontat_lipsuri_calcul() l WHERE l.proiect_id = pg_temp.rd_id('p3') AND l.tip = 'oferta_veche_neconfirmata';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF s IS DISTINCT FROM 'contract_initial: 1 (obiect 0001)' THEN RAISE EXCEPTION 't_oferta_confirmata FAIL: lipsurile nu declara oferta veche neconfirmata pe obiect: %', coalesce(s, 'nimic'); END IF;
  INSERT INTO rd_fix VALUES ('p3_strecurat', v_id);
END $t$;
-- (6/7, urmare) accesul general (e) NU poate atinge nici randul vechi neconfirmat al unui obiect confirmat (singurul fel in care un astfel de rand poate
--    exista e scrierea de server): UPDATE / DELETE / mutarea lui spre un obiect nou = 42501 (ramurile OLD ale gardei); apoi serverul il scoate
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  IF (SELECT activ AND confirmat_la IS NULL AND obiect_cod = '0001' FROM public.proiect_articole WHERE id = pg_temp.rd_id('p3_strecurat')) IS NOT TRUE THEN RAISE EXCEPTION 't_oferta_confirmata PRECONDITIE: randul strecurat nu e vizibil / nu e vechi'; END IF;
  BEGIN UPDATE public.proiect_articole SET cantitate = 1 WHERE id = pg_temp.rd_id('p3_strecurat'); RAISE EXCEPTION 't_oferta_confirmata FAIL: randul vechi neconfirmat al obiectului confirmat 0001 modificat direct';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%obiectul 0001 al proiectului % are oferta confirmata%' THEN RAISE; END IF; END;
  BEGIN UPDATE public.proiect_articole SET obiect_cod = '0003' WHERE id = pg_temp.rd_id('p3_strecurat'); RAISE EXCEPTION 't_oferta_confirmata FAIL: randul vechi al obiectului confirmat 0001 mutat spre un obiect nou';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%obiectul 0001 al proiectului % are oferta confirmata%nu se mai modifica direct%' THEN RAISE; END IF; END;
  BEGIN DELETE FROM public.proiect_articole WHERE id = pg_temp.rd_id('p3_strecurat'); RAISE EXCEPTION 't_oferta_confirmata FAIL: randul vechi neconfirmat al obiectului confirmat 0001 sters direct';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%obiectul 0001 al proiectului % are oferta confirmata%nu se mai sterg direct%' THEN RAISE; END IF; END;
  IF (SELECT cantitate::text || '/' || obiect_cod FROM public.proiect_articole WHERE id = pg_temp.rd_id('p3_strecurat')) <> '500/0001' THEN RAISE EXCEPTION 't_oferta_confirmata FAIL: refuzurile au scris pe randul strecurat'; END IF;
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
DO $t$
BEGIN
  DELETE FROM public.proiect_articole WHERE id = pg_temp.rd_id('p3_strecurat');
  PERFORM set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true);
  IF EXISTS (SELECT 1 FROM public.fn_rest_decontat_lipsuri_calcul() l WHERE l.tip = 'oferta_veche_neconfirmata') THEN RAISE EXCEPTION 't_oferta_confirmata FAIL: lipsa ramasa dupa scoaterea randului'; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 't_oferta_confirmata (6/7) ok: randul contract_initial neconfirmat strecurat de server pe 0001 nu intra in calcul, e declarat in lipsuri (oferta_veche_neconfirmata, pe obiect) si nu poate fi modificat / mutat / sters pe calea veche';
END $t$;
-- (7/7) starea confirmata e DEFINITIVA pe obiect: (a) serverul RETRAGE (activ = false) randurile confirmate ale lui 0002 (obiect confirmat tarziu, FARA
--    rand confirmat in istoric — predicatul trebuie sa vada randul retras din tabel) → calea veche ramane inchisa; randurile sunt reactivate; (b) serverul
--    SCOATE de tot randurile confirmate ale lui 0001 (raman doar in istoric, cu confirmat_la) → tot inchisa. Ultimul bloc al t_oferta_confirmata: nimic de
--    dupa nu depinde de randurile lui 0001
DO $t$
BEGIN
  IF EXISTS (SELECT 1 FROM public.proiect_articole_istoric h WHERE h.proiect_id = pg_temp.rd_id('p3') AND h.obiect_k = '0002||' AND h.confirmat_la IS NOT NULL) THEN
    RAISE EXCEPTION 't_oferta_confirmata PRECONDITIE: 0002 nu trebuie sa aiba rand confirmat in istoric (proba retragerii din tabel)';
  END IF;
  UPDATE public.proiect_articole SET activ = false WHERE proiect_id = pg_temp.rd_id('p3') AND sursa = 'contract_initial' AND obiect_cod = '0002' AND confirmat_la IS NOT NULL;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p3') AND sursa = 'contract_initial' AND obiect_cod = '0002' AND activ) <> 0 THEN RAISE EXCEPTION 't_oferta_confirmata PRECONDITIE: retragerea ofertei confirmate 0002'; END IF;
END $t$;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  IF NOT public.fn_rest_decontat_obiect_confirmat(pg_temp.rd_id('p3'), '0002') THEN RAISE EXCEPTION 't_oferta_confirmata FAIL: oferta confirmata retrasa (activ = false) = obiectul 0002 nu mai e confirmat'; END IF;
  BEGIN
    INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa)
    VALUES (pg_temp.rd_id('p3'), '0002', 'D2', '1', 'E500', 'Conducta', 'M', 40, 4000, 'contract_initial');
    RAISE EXCEPTION 't_oferta_confirmata FAIL: calea veche redeschisa pe 0002 dupa retragerea ofertei confirmate';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%obiectul 0002 al proiectului % are oferta confirmata%' THEN RAISE; END IF; END;
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
DO $t$
BEGIN
  UPDATE public.proiect_articole SET activ = true WHERE proiect_id = pg_temp.rd_id('p3') AND sursa = 'contract_initial' AND obiect_cod = '0002' AND confirmat_la IS NOT NULL;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p3') AND sursa = 'contract_initial' AND obiect_cod = '0002' AND activ AND confirmat_la IS NOT NULL) <> 2 THEN RAISE EXCEPTION 't_oferta_confirmata FAIL: reactivarea ofertei 0002'; END IF;
  -- (b) serverul scoate de tot randurile confirmate ale lui 0001: starea ramane „confirmat” prin istoric (randurile inlocuite in (4/7) au confirmat_la)
  DELETE FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p3') AND sursa = 'contract_initial' AND obiect_cod = '0001';
  IF EXISTS (SELECT 1 FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p3') AND obiect_cod = '0001')
     OR (SELECT count(*) FROM public.proiect_articole_istoric h WHERE h.proiect_id = pg_temp.rd_id('p3') AND h.obiect_k = '0001||' AND h.confirmat_la IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 't_oferta_confirmata PRECONDITIE: scoaterea randurilor lui 0001 / istoricul confirmat al lui 0001';
  END IF;
END $t$;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  IF NOT public.fn_rest_decontat_obiect_confirmat(pg_temp.rd_id('p3'), '0001') OR NOT public.fn_rest_decontat_obiect_confirmat(pg_temp.rd_id('p3'), '0002') THEN
    RAISE EXCEPTION 't_oferta_confirmata FAIL: obiectul 0001 fara randuri in proiect_articole (ramas doar in istoric) nu mai e confirmat';
  END IF;
  BEGIN
    INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa)
    VALUES (pg_temp.rd_id('p3'), '0001', 'D1', '1', 'A100', 'Conducta', 'M', 100, 10000, 'contract_initial');
    RAISE EXCEPTION 't_oferta_confirmata FAIL: calea veche redeschisa pe un obiect ramas doar in istoric';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%obiectul 0001 al proiectului % are oferta confirmata%' THEN RAISE; END IF; END;
  IF EXISTS (SELECT 1 FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p3') AND obiect_cod = '0001') THEN RAISE EXCEPTION 't_oferta_confirmata FAIL: refuzul a scris'; END IF;
  RAISE NOTICE 't_oferta_confirmata (7/7) ok: oferta confirmata retrasa (activ = false, 0002) sau scoasa de server (doar in istoric, 0001) tine obiectul confirmat: calea veche ramane inchisa';
END $t$;
RESET ROLE;

-- ── t_rand_orfan (apararea in adancime, r3): daca un rand AA / NR / NCS fara legatura sau neconfirmat ar ajunge TOTUSI in tabel (CHECK-ul scos
--    temporar intr-un sub-bloc, scriere de server, P4 pe obiectul OB2), calculul NU il numara (baza P4 ramane OB1|D1|X=150), iar lipsurile il
--    declara pe sursa ('rand_neautorizat'); sub-blocul se ANULEAZA (constrangerea revine, randurile dispar). Ultimul bloc: nimic nu depinde de el ──
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
DO $t$
DECLARE s text;
BEGIN
  IF auth.uid() IS NOT NULL OR public.fn_rest_decontat_server() IS NOT TRUE THEN
    RAISE EXCEPTION 't_rand_orfan PRECONDITIE: blocul serverului cere auth.uid() NULL si rolul postgres (acum % / %)', auth.uid(), current_user;
  END IF;
  SELECT string_agg(b.cheie || '=' || b.cantitate::text, '; ' ORDER BY b.cheie) INTO s FROM public.fn_rest_decontat_baza_proiect(pg_temp.rd_id('p4')) b;
  IF s IS DISTINCT FROM 'OB1|D1|X=150' THEN RAISE EXCEPTION 't_rand_orfan PRECONDITIE: baza P4 = % (astept OB1|D1|X=150)', s; END IF;
  BEGIN
    ALTER TABLE public.proiect_articole DROP CONSTRAINT proiect_articole_rd_legaturi_ck;
    INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa, act_nr, act_aditional_id, nota_id) VALUES
      (pg_temp.rd_id('p4'), 'OB2', 'D1', 'Y', 'orfan: AA fara act', 'M', 7, 70, 'act_aditional', 'AA-X', NULL, NULL),
      (pg_temp.rd_id('p4'), 'OB2', 'D1', 'Y', 'AA cu act activ, neconfirmat', 'M', 7, 70, 'act_aditional', 'AA-4', pg_temp.rd_id('aa4'), NULL),
      (pg_temp.rd_id('p4'), 'OB2', 'D1', 'Y', 'orfan: NCS fara nota', 'M', 7, 70, 'nota_comanda_suplimentara', NULL, NULL, NULL),
      (pg_temp.rd_id('p4'), 'OB2', 'D1', 'Y', 'NCS cu nota aprobata, neconfirmat', 'M', 7, 70, 'nota_comanda_suplimentara', NULL, NULL, pg_temp.rd_id('ncs9')),
      (pg_temp.rd_id('p4'), 'OB2', 'D1', 'Y', 'orfan: NR fara nota', 'M', -7, -70, 'nota_renuntare', NULL, NULL, NULL);
    IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p4') AND obiect_cod = 'OB2' AND activ) <> 5 THEN
      RAISE EXCEPTION 't_rand_orfan PRECONDITIE: cele 5 randuri orfane / neconfirmate nu s-au scris';
    END IF;
    SELECT string_agg(b.cheie || '=' || b.cantitate::text, '; ' ORDER BY b.cheie) INTO s FROM public.fn_rest_decontat_baza_proiect(pg_temp.rd_id('p4')) b;
    IF s IS DISTINCT FROM 'OB1|D1|X=150' THEN RAISE EXCEPTION 't_rand_orfan FAIL: randurile orfane / neconfirmate au intrat in baza: %', s; END IF;
    -- lipsurile (ca owner-ul a, care citeste P4; apoi inapoi la server)
    PERFORM set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000a', true);
    SELECT string_agg(l.referinta, '; ' ORDER BY l.referinta) INTO s FROM public.fn_rest_decontat_lipsuri_calcul() l WHERE l.proiect_id = pg_temp.rd_id('p4') AND l.tip = 'rand_neautorizat';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    IF s IS DISTINCT FROM 'act_aditional: 2; nota_comanda_suplimentara: 2; nota_renuntare: 1' THEN
      RAISE EXCEPTION 't_rand_orfan FAIL: lipsurile nu declara randurile neautorizate pe sursa: %', coalesce(s, 'nimic');
    END IF;
    RAISE EXCEPTION 'ORFAN_GATA' USING ERRCODE = 'P0999';   -- anuleaza sub-blocul: constrangerea revine, randurile dispar
  EXCEPTION WHEN SQLSTATE 'P0999' THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000a', true);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.proiect_articole'::regclass AND k.conname = 'proiect_articole_rd_legaturi_ck')
     OR EXISTS (SELECT 1 FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p4') AND obiect_cod = 'OB2')
     OR EXISTS (SELECT 1 FROM public.fn_rest_decontat_lipsuri_calcul() l WHERE l.tip = 'rand_neautorizat') THEN
    RAISE EXCEPTION 't_rand_orfan FAIL: sub-blocul nu s-a anulat (constrangerea / randurile / lipsurile)';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 't_rand_orfan ok: 5 randuri AA / NR / NCS orfane sau neconfirmate (CHECK scos temporar) nu intra in calcul (P4 = OB1|D1|X=150) si apar in lipsuri pe sursa; sub-blocul anulat';
END $t$;

-- ── t_um_inlocuire (r6, review #1158: P1 r5 „UM schimbat dupa decontare” + „reprezentarea pentru cititorii existenti”). (1/2) MP-ul (b) pe P1 / 0001
--    (A100 in M cu decontat, D400|#7 in M fara decontat; randurile ofertei din blocul „oferta”): (a) inlocuirea cu A100 in „100 MC” = 22023 um_decontat
--    (cheia, UM vechi M, UM nou MC), si cu accept_schimbare_um; (b) D400|#7 in BUC fara accept = 22023 um_schimbat; nimic scris; (c) aceleasi 5 linii in
--    alta reprezentare (obiect „ 0001 ”, A100 in HM x 1, B200 in MC x 200, D400 in „m”) trec si NU schimba baza / decontatul / restul; (d) D400|#7 in BUC cu
--    accept_schimbare_um trece (um_schimbate), baza D400|#7 = 5 BUC; accept_schimbare_um pe un deviz AA = 22023; (e) pe P3 obiectul NOU „ st-3 ” (unitatea
--    'St-3' din proiect_unitati, fara randuri) in KM x 1 trece; inlocuirea lui cu M x 0.000001 (nereprezentabil exact in KM) = 22023 um_nereprezentabil ──
DO $t$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
END $t$;
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; r record; n int; s text; s2 text;
  -- aceleasi 5 linii ale lui 0001 ca in blocul „oferta”, in ALTA reprezentare (identitate canonica si UM normalizat identice; r7: si devizul / codul / nr
  -- vin cu spatii si litere mici — toate campurile se copiaza din randul cu aceeasi cheie)
  L_ECHIV constant jsonb := $j$[
    {"obiect_cod":" 0001 ","obiect_nume":"TRONSON 1","deviz_cod":" d1 ","deviz_nume":"Montaj","nr":" 1","cod":"a100 ","denumire":"Conducta","um":"HM","cantitate":1,"pret_unitar":10000,"valoare":10000},
    {"obiect_cod":" 0001 ","obiect_nume":"TRONSON 1","deviz_cod":"D1","deviz_nume":"Montaj","nr":"2","cod":"B200","denumire":"Sapatura","um":"MC","cantitate":200,"pret_unitar":10,"valoare":2000},
    {"obiect_cod":" 0001 ","obiect_nume":"TRONSON 1","deviz_cod":"D1","deviz_nume":"Montaj","nr":"7","cod":"D400","denumire":"Dublu a","um":"m","cantitate":5,"pret_unitar":10,"valoare":50},
    {"obiect_cod":" 0001 ","obiect_nume":"TRONSON 1","deviz_cod":"D1","deviz_nume":"Montaj","nr":"8","cod":"D400","denumire":"Dublu b","um":"m","cantitate":6,"pret_unitar":10,"valoare":60},
    {"obiect_cod":" 0001 ","obiect_nume":"TRONSON 1","deviz_cod":"OS","deviz_nume":"Organizare","nr":"1","cod":"OS","denumire":"Organizare de santier","um":"LEI","cantitate":1,"pret_unitar":3000,"valoare":3000,"tip_rand":"os"}]$j$::jsonb;
  L_A100_MC constant jsonb := $j${"obiect_cod":" 0001 ","obiect_nume":"TRONSON 1","deviz_cod":"D1","deviz_nume":"Montaj","nr":"1","cod":"A100","denumire":"Conducta","um":"100 MC","cantitate":1,"pret_unitar":10000,"valoare":10000}$j$::jsonb;
  L_D400_BUC constant jsonb := $j${"obiect_cod":" 0001 ","obiect_nume":"TRONSON 1","deviz_cod":"D1","deviz_nume":"Montaj","nr":"7","cod":"D400","denumire":"Dublu a","um":"BUC","cantitate":5,"pret_unitar":10,"valoare":50}$j$::jsonb;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100';
  IF r.um IS DISTINCT FROM 'M' OR r.decontat_cantitate <= 0 THEN RAISE EXCEPTION 't_um_inlocuire PRECONDITIE: A100 in M cu decontat (%)', row_to_json(r); END IF;
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|D400|#7';
  IF r.um IS DISTINCT FROM 'M' OR r.decontat_cantitate <> 0 OR r.baza_cantitate <> 5 THEN RAISE EXCEPTION 't_um_inlocuire PRECONDITIE: D400|#7 in M, 5, fara decontat (%)', row_to_json(r); END IF;
  IF NOT public.fn_rest_decontat_obiect_confirmat(pg_temp.rd_id('p1'), '0001') THEN RAISE EXCEPTION 't_um_inlocuire PRECONDITIE: 0001 al P1 confirmat'; END IF;
  SELECT string_agg(c.cheie || '=' || c.baza_cantitate::text || ' ' || c.um || ' d' || c.decontat_cantitate::text || ' r' || c.rest_cantitate::text, '; ' ORDER BY c.cheie) INTO s
    FROM public.v_executie_rest_decontat c WHERE c.proiect_id = pg_temp.rd_id('p1') AND c.cheie IS NOT NULL;
  SELECT count(*) INTO n FROM public.proiect_articole_istoric WHERE proiect_id = pg_temp.rd_id('p1');
  -- (a) cheie DECONTATA (A100, M): alt UM normalizat (100 MC) = 22023 um_decontat, cu cheia / UM vechi / UM nou; la fel cu accept_schimbare_um
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'contract_initial', NULL, NULL, NULL, 'oferta_mc.xlsx', repeat('d2', 32), jsonb_set(L_ECHIV, '{0}', L_A100_MC), true);
    RAISE EXCEPTION 't_um_inlocuire FAIL: A100 (decontat in M) inlocuit cu 100 MC (reproducerea P1 r5: 100 M -> situatie -> 100 MC)';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%0001|D1|A100%decontate in UM M%UM nou MC%um_decontat%' THEN RAISE; END IF; END;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'contract_initial', NULL, NULL, NULL, 'oferta_mc.xlsx', repeat('d2', 32),
           jsonb_build_object('accept_schimbare_um', true, 'linii', jsonb_set(L_ECHIV, '{0}', L_A100_MC)), true);
    RAISE EXCEPTION 't_um_inlocuire FAIL: A100 decontat inlocuit cu 100 MC desi accept_schimbare_um (acceptarea nu trece peste decontat)';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%um_decontat%' THEN RAISE; END IF; END;
  -- (b) cheie FARA decontat (D400|#7, M) in BUC, fara accept = 22023 um_schimbat
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'contract_initial', NULL, NULL, NULL, 'oferta_buc.xlsx', repeat('d4', 32), jsonb_set(L_ECHIV, '{2}', L_D400_BUC), true);
    RAISE EXCEPTION 't_um_inlocuire FAIL: D400|#7 (M, fara decontat) inlocuit cu BUC fara accept_schimbare_um';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%0001|D1|D400|#7%UM M%UM BUC%um_schimbat%' THEN RAISE; END IF; END;
  -- obiectul p_linii cu alta cheie / accept_schimbare_um ne-boolean = 22023; accept_schimbare_um pe un deviz AA = 22023
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'contract_initial', NULL, NULL, NULL, 'x.xlsx', repeat('d5', 32), jsonb_build_object('accept_schimbare_um', 'da', 'linii', L_ECHIV), true);
    RAISE EXCEPTION 't_um_inlocuire FAIL: accept_schimbare_um ne-boolean acceptat';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%doar linii / accept_schimbare_um%' THEN RAISE; END IF; END;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'act_aditional', pg_temp.rd_id('aa1'), NULL, 'diferente', 'x.xlsx', repeat('d5', 32),
           jsonb_build_object('accept_schimbare_um', true, 'linii', '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"A100","denumire":"x","um":"M","cantitate":1,"valoare":100}]'::jsonb));
    RAISE EXCEPTION 't_um_inlocuire FAIL: accept_schimbare_um acceptat pe un deviz AA';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%accept_schimbare_um e doar pentru oferta%' THEN RAISE; END IF; END;
  SELECT string_agg(c.cheie || '=' || c.baza_cantitate::text || ' ' || c.um || ' d' || c.decontat_cantitate::text || ' r' || c.rest_cantitate::text, '; ' ORDER BY c.cheie) INTO s2
    FROM public.v_executie_rest_decontat c WHERE c.proiect_id = pg_temp.rd_id('p1') AND c.cheie IS NOT NULL;
  IF s2 IS DISTINCT FROM s OR (SELECT count(*) FROM public.proiect_articole_istoric WHERE proiect_id = pg_temp.rd_id('p1')) <> n THEN
    RAISE EXCEPTION 't_um_inlocuire FAIL: refuzurile au scris ceva (rest % / istoric)', s2;
  END IF;
  -- (c) aceleasi linii in alta reprezentare, echivalenta prin factor: trece (5 inlocuite confirmate, fara um_schimbate); baza, decontatul si restul IDENTICE
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'contract_initial', NULL, NULL, NULL, 'oferta_hm.xlsx', repeat('d3', 32), L_ECHIV, true);
  IF (v->>'inserate')::int <> 5 OR (v->>'inlocuite')::int <> 5 OR (v->>'inlocuite_confirmate')::int <> 5 OR v->'um_schimbate' IS DISTINCT FROM '[]'::jsonb OR v->'obiecte' IS DISTINCT FROM '["0001||"]'::jsonb THEN
    RAISE EXCEPTION 't_um_inlocuire FAIL inlocuire echivalenta: %', v;
  END IF;
  SELECT string_agg(c.cheie || '=' || c.baza_cantitate::text || ' ' || c.um || ' d' || c.decontat_cantitate::text || ' r' || c.rest_cantitate::text, '; ' ORDER BY c.cheie) INTO s2
    FROM public.v_executie_rest_decontat c WHERE c.proiect_id = pg_temp.rd_id('p1') AND c.cheie IS NOT NULL;
  IF s2 IS DISTINCT FROM s THEN RAISE EXCEPTION 't_um_inlocuire FAIL: restul de decontat s-a schimbat dupa inlocuirea cu linii echivalente: % (inainte %)', s2, s; END IF;
  -- (d) D400|#7 in BUC cu accept_schimbare_um: trece, cheia e declarata in um_schimbate, baza D400|#7 = 5 BUC; restul celorlalte chei neschimbat
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'contract_initial', NULL, NULL, NULL, 'oferta_buc.xlsx', repeat('d4', 32),
         jsonb_build_object('accept_schimbare_um', true, 'linii', jsonb_set(L_ECHIV, '{2}', L_D400_BUC)), true);
  IF (v->>'inserate')::int <> 5 OR (v->>'inlocuite_confirmate')::int <> 5 OR v->'um_schimbate' IS DISTINCT FROM '["0001|D1|D400|#7"]'::jsonb THEN
    RAISE EXCEPTION 't_um_inlocuire FAIL inlocuire cu UM schimbat acceptat: %', v;
  END IF;
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|D400|#7';
  IF r.um IS DISTINCT FROM 'BUC' OR r.baza_cantitate <> 5 OR r.decontat_cantitate <> 0 THEN RAISE EXCEPTION 't_um_inlocuire FAIL: D400|#7 dupa schimbarea acceptata: %', row_to_json(r); END IF;
  SELECT string_agg(c.cheie || '=' || c.baza_cantitate::text || ' ' || c.um || ' d' || c.decontat_cantitate::text || ' r' || c.rest_cantitate::text, '; ' ORDER BY c.cheie) INTO s2
    FROM public.v_executie_rest_decontat c WHERE c.proiect_id = pg_temp.rd_id('p1') AND c.cheie IS NOT NULL AND c.cheie <> '0001|D1|D400|#7';
  IF s2 IS DISTINCT FROM (SELECT string_agg(x, '; ' ORDER BY x) FROM unnest(string_to_array(s, '; ')) x WHERE x NOT LIKE '0001|D1|D400|#7=%') THEN
    RAISE EXCEPTION 't_um_inlocuire FAIL: celelalte chei s-au schimbat: %', s2;
  END IF;
  -- (e) P3: obiect NOU „ st-3 ” (unitatea 'St-3' exista in proiect_unitati, fara randuri in proiect_articole), in KM; apoi M x 0.000001 = nereprezentabil in KM
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p3'), 'contract_initial', NULL, NULL, NULL, 'st3.xlsx', repeat('d6', 32),
         '[{"obiect_cod":" st-3 ","obiect_nume":"Statie","deviz_cod":"D3","nr":"1","cod":"K100","denumire":"Conducta in km","um":"KM","cantitate":1,"pret_unitar":100000,"valoare":100000}]'::jsonb);
  IF (v->>'inserate')::int <> 1 OR (v->>'inlocuite')::int <> 0 OR v->'obiecte' IS DISTINCT FROM '["ST-3||"]'::jsonb THEN RAISE EXCEPTION 't_um_inlocuire FAIL obiect nou St-3: %', v; END IF;
  IF (SELECT b.cantitate::text || ' ' || b.um FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p3') AND b.cheie = 'ST-3|D3|K100') IS DISTINCT FROM '1000 M' THEN
    RAISE EXCEPTION 't_um_inlocuire FAIL: baza St-3 (1 KM = 1000 M)';
  END IF;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p3'), 'contract_initial', NULL, NULL, NULL, 'st3b.xlsx', repeat('d7', 32),
           '[{"obiect_cod":"ST-3","obiect_nume":"Statie","deviz_cod":"D3","nr":"1","cod":"K100","denumire":"Conducta in km","um":"M","cantitate":0.000001,"pret_unitar":100,"valoare":0.0001}]'::jsonb, true);
    RAISE EXCEPTION 't_um_inlocuire FAIL: 0.000001 M scris in KM (rotunjire tacita la 0)';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%ST-3|D3|K100%UM-ul existent KM%um_nereprezentabil%' THEN RAISE; END IF; END;
  IF (SELECT b.cantitate::text || ' ' || b.um FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p3') AND b.cheie = 'ST-3|D3|K100') IS DISTINCT FROM '1000 M' THEN
    RAISE EXCEPTION 't_um_inlocuire FAIL: refuzul nereprezentabil a scris';
  END IF;
  RAISE NOTICE 't_um_inlocuire (1/2) ok: A100 decontat in M → 100 MC refuzat (um_decontat, si cu accept); D400|#7 → BUC fara accept refuzat (um_schimbat), cu accept trece (um_schimbate); liniile echivalente (HM x 1, MC x 200, m, obiect „ 0001 ”) nu schimba restul; St-3 nou in KM; 0.000001 M in KM refuzat (um_nereprezentabil)';
END $t$;
RESET ROLE;
-- (2/2) owner-ul (a, acces general Executie): randurile scrise sunt in REPREZENTAREA EXISTENTA — obiect_cod '0001' (nu „ 0001 ”), A100 'M' x 100 (venit HM x 1,
--    pret 100 din 10000), B200 '100 MC' x 2 (venit MC x 200, pret 1000 din 10), D400|#8 'M' (venit 'm'), D400|#7 'BUC' x 5 (UM schimbat acceptat: cum vine);
--    St-3 al P3 scris 'St-3' (unitatea din proiect_unitati, JOIN-ul 20261208a pe obiect_cod brut) cu UM 'KM' x 1
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000a', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE s text;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000a');
  SELECT string_agg(a.obiect_cod || '/' || a.deviz_cod || '/' || a.nr || '/' || a.cod || '/' || a.um || '/' || a.cantitate::text || '/' || coalesce(a.pret_unitar::text, '-') || '/' || a.valoare::text, '; ' ORDER BY a.cheie) INTO s
    FROM public.proiect_articole a WHERE a.proiect_id = pg_temp.rd_id('p1') AND a.sursa = 'contract_initial' AND a.activ AND a.confirmat_la IS NOT NULL
     AND public.fn_rest_decontat_cheie(a.obiect_cod, NULL, NULL, NULL) = '0001||';
  IF s IS DISTINCT FROM '0001/D1/1/A100/M/100/100/10000; 0001/D1/2/B200/100 MC/2/1000/2000; 0001/D1/7/D400/BUC/5/10/50; 0001/D1/8/D400/M/6/10/60; 0001/OS/1/OS/LEI/1/3000/3000' THEN
    RAISE EXCEPTION 't_um_inlocuire FAIL: randurile lui 0001 nu sunt in reprezentarea existenta (obiect / deviz / nr / cod / UM copiate din randul cheii): %', s;
  END IF;
  IF EXISTS (SELECT 1 FROM public.proiect_articole a WHERE a.proiect_id = pg_temp.rd_id('p1') AND a.obiect_cod <> btrim(a.obiect_cod)) THEN
    RAISE EXCEPTION 't_um_inlocuire FAIL: obiect_cod brut cu spatii scris in P1';
  END IF;
  SELECT string_agg(a.obiect_cod || '/' || a.um || '/' || a.cantitate::text, '; ') INTO s FROM public.proiect_articole a WHERE a.proiect_id = pg_temp.rd_id('p3') AND a.cod = 'K100';
  IF s IS DISTINCT FROM 'St-3/KM/1' THEN RAISE EXCEPTION 't_um_inlocuire FAIL: obiectul nou nu a luat obiect_cod-ul unitatii din proiect_unitati (St-3): %', s; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.proiect_unitati u JOIN public.proiect_articole a ON a.proiect_id = u.proiect_id AND a.obiect_cod = u.obiect_cod WHERE u.proiect_id = pg_temp.rd_id('p3') AND a.cod = 'K100') THEN
    RAISE EXCEPTION 't_um_inlocuire FAIL: JOIN-ul 20261208a (art.obiect_cod = u.obiect_cod) nu gaseste articolul K100 al unitatii St-3';
  END IF;
  RAISE NOTICE 't_um_inlocuire (2/2) ok: randurile confirmate sunt in reprezentarea existenta (0001 / D1 / 1 / A100 / M x 100; 100 MC x 2; BUC doar unde schimbarea a fost acceptata); St-3 scris ca unitatea din proiect_unitati';
END $t$;
RESET ROLE;

-- ── t_reprezentare_cheie (r7, review #1158: 2 x P1 pe r6 — reproducerile Jakarinos). P6 (MP b; unitatea legata la 'o1'). (1/3) accesul general (e) scrie pe
--    calea veche oferta cu forme brute amestecate pe obiect: 'O1'/'D1'/'1'/'TSA01' M x 100 si 'o1'/'D1'/'2a'/'Y' „100 MC” x 2; cititorii vechi inregistrati:
--    rd_cititori pe 'O1' si 'o1', prefixul TSA (ActivitatiProiectPanel.jsx:69: upper(cod) incepe cu prefixul, suma cantitatilor brute), tinta unitatii 'o1'
--    (20261208a: JOIN pe obiect_cod brut, cantitatea convertita), lista obiectelor (DevizVsExecutatTab) ──
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
CREATE FUNCTION pg_temp.rd_cititori_p6() RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT concat_ws(' || ', 'O1: ' || pg_temp.rd_cititori(pg_temp.rd_id('p6'), 'O1'), 'o1: ' || pg_temp.rd_cititori(pg_temp.rd_id('p6'), 'o1'),
    'prefix TSA: ' || (SELECT count(*)::text || '/' || coalesce(sum(cantitate), 0)::text FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p6') AND sursa <> 'extras_materiale' AND left(upper(coalesce(cod, '')), 3) = 'TSA'),
    'tinta unitate: ' || (SELECT count(*)::text || '/' || coalesce(sum(art.cantitate * (SELECT x.factor FROM public.fn_rest_decontat_um(art.um) x)), 0)::text
                            FROM public.proiect_unitati u JOIN public.proiect_articole art ON art.proiect_id = u.proiect_id AND art.obiect_cod = u.obiect_cod AND art.sursa = 'contract_initial'
                           WHERE u.proiect_id = pg_temp.rd_id('p6') AND u.obiect_cod IS NOT NULL),
    'randuri: ' || (SELECT string_agg(concat_ws('/', obiect_cod, deviz_cod, nr, cod, um, cantitate::text, coalesce(pret_unitar::text, '-'), valoare::text), '; ' ORDER BY cheie)
                      FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p6') AND sursa = 'contract_initial'))
$f$;
DO $t$
DECLARE s text;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod, denumire, um, cantitate, pret_unitar, valoare, sursa) VALUES
    (pg_temp.rd_id('p6'), 'O1', 'TRONSON O1', 'D1', 'Terasamente', '1', 'TSA01', 'Sapatura', 'M', 100, 10, 1000, 'contract_initial'),
    (pg_temp.rd_id('p6'), 'o1', 'TRONSON O1', 'D1', 'Terasamente', '2a', 'Y', 'Umplutura', '100 MC', 2, 1000, 2000, 'contract_initial');
  s := pg_temp.rd_cititori_p6();
  -- (ordinea listei obiectelor O1 / o1 depinde de colatie: se construieste cu acelasi string_agg)
  IF s IS DISTINCT FROM 'O1: activitati:1/100; catalog:1/1000; tinte:1/100; configurare:1; obiecte:' || (SELECT string_agg(x, ',' ORDER BY x) FROM unnest(ARRAY['O1', 'o1']) x)
       || ' || o1: activitati:1/2; catalog:1/2000; tinte:1/2; configurare:1; obiecte:' || (SELECT string_agg(x, ',' ORDER BY x) FROM unnest(ARRAY['O1', 'o1']) x)
       || ' || prefix TSA: 1/100 || tinta unitate: 1/200 || randuri: O1/D1/1/TSA01/M/100/10/1000; o1/D1/2a/Y/100 MC/2/1000/2000' THEN
    RAISE EXCEPTION 't_reprezentare_cheie PRECONDITIE cititori P6 inainte: %', s;
  END IF;
  INSERT INTO rd_cons VALUES ('p6_inainte', s);
  RAISE NOTICE 't_reprezentare_cheie (1/3) ok: oferta veche P6 cu forme amestecate (O1 / o1), unitatea pe o1 vede Y (200 MC), prefixul TSA vede 100; cititorii inregistrati';
END $t$;
RESET ROLE;
-- (2/3) MP-ul (b) confirma EXACT aceleasi doua linii in alta reprezentare (obiect ' o1 ' / 'O1' inversate fata de randuri, deviz ' d1 ', nr ' 1' / '2A', cod ' tsa01 ' /
--    'y', UM HM x 1 / MC x 200): randurile scrise sunt IDENTICE cu cele vechi (fiecare camp copiat din randul cu aceeasi cheie), toti cititorii vechi neschimbati
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p6'), 'contract_initial', NULL, NULL, NULL, 'oferta6.xlsx', repeat('e1', 32), $j$[
    {"obiect_cod":" o1 ","obiect_nume":"TRONSON O1","deviz_cod":" d1 ","deviz_nume":"Terasamente","nr":" 1","cod":" tsa01 ","denumire":"Sapatura","um":"HM","cantitate":1,"pret_unitar":1000,"valoare":1000},
    {"obiect_cod":"O1","obiect_nume":"TRONSON O1","deviz_cod":"D1","deviz_nume":"Terasamente","nr":"2A","cod":"y","denumire":"Umplutura","um":"MC","cantitate":200,"pret_unitar":10,"valoare":2000}]$j$::jsonb);
  IF (v->>'inserate')::int <> 2 OR (v->>'inlocuite')::int <> 2 OR (v->>'inlocuite_confirmate')::int <> 0 OR v->'obiecte' IS DISTINCT FROM '["O1||"]'::jsonb OR v->'um_schimbate' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 't_reprezentare_cheie FAIL confirmare P6: %', v;
  END IF;
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE s text;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  s := pg_temp.rd_cititori_p6();
  IF s IS DISTINCT FROM (SELECT v FROM rd_cons WHERE k = 'p6_inainte') THEN
    RAISE EXCEPTION 't_reprezentare_cheie FAIL: cititorii vechi s-au schimbat dupa confirmarea unor date echivalente: % (inainte %)', s, (SELECT v FROM rd_cons WHERE k = 'p6_inainte');
  END IF;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p6') AND confirmat_la IS NOT NULL) <> 2 THEN RAISE EXCEPTION 't_reprezentare_cheie FAIL: 2 randuri confirmate'; END IF;
  RAISE NOTICE 't_reprezentare_cheie (2/3) ok: dupa confirmarea liniilor echivalente (obiect / deviz / nr / cod / UM in alta forma) randurile sunt identice cu cele vechi si toti cititorii vechi (prefix TSA, tinta unitatii o1, obiectele O1 / o1, catalogul) dau acelasi rezultat';
END $t$;
RESET ROLE;
-- (3/3) SERVERUL strecoara o a doua forma a cheii O1|D1|TSA01 (acelasi rand in HM): „inlocuieste” = 22023 forme_multiple cu cheia si cele doua forme, nimic
--    scris; serverul o scoate; apoi „inlocuieste” cu o cheie NOUA (' z  z ' pe ' o1 ', deviz ' d1 ', um ' buc ') → scrisa normalizata ('z z' / 'd1' / 'buc') cu
--    obiect_cod-ul unitatii ('o1': obiectul are forme amestecate), randurile vechi ale cheilor existente neschimbate
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
DO $t$
BEGIN
  IF auth.uid() IS NOT NULL OR public.fn_rest_decontat_server() IS NOT TRUE THEN RAISE EXCEPTION 't_reprezentare_cheie PRECONDITIE: blocul serverului cere auth.uid() NULL si rolul postgres'; END IF;
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, nr, cod, denumire, um, cantitate, pret_unitar, valoare, sursa)
  VALUES (pg_temp.rd_id('p6'), 'O1', 'TRONSON O1', 'D1', '1', 'TSA01', 'Sapatura (a doua forma, strecurata)', 'HM', 1, 1000, 1000, 'contract_initial');
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p6') AND cheie = 'O1|D1|TSA01') <> 2 THEN RAISE EXCEPTION 't_reprezentare_cheie PRECONDITIE: a doua forma a cheii TSA01'; END IF;
END $t$;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; n int;
  L6 constant jsonb := $j$[
    {"obiect_cod":" o1 ","obiect_nume":"TRONSON O1","deviz_cod":" d1 ","deviz_nume":"Terasamente","nr":" 1","cod":" tsa01 ","denumire":"Sapatura","um":"HM","cantitate":1,"pret_unitar":1000,"valoare":1000},
    {"obiect_cod":"O1","obiect_nume":"TRONSON O1","deviz_cod":"D1","deviz_nume":"Terasamente","nr":"2A","cod":"y","denumire":"Umplutura","um":"MC","cantitate":200,"pret_unitar":10,"valoare":2000}]$j$::jsonb;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  SELECT count(*) INTO n FROM public.proiect_articole_istoric WHERE proiect_id = pg_temp.rd_id('p6');
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p6'), 'contract_initial', NULL, NULL, NULL, 'oferta6b.xlsx', repeat('e2', 32), L6, true);
    RAISE EXCEPTION 't_reprezentare_cheie FAIL: cheia O1|D1|TSA01 cu doua forme brute acceptata (documentul a ales una)';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%O1|D1|TSA01%mai multe forme brute%O1/D1/TSA01/1/HM | O1/D1/TSA01/1/M;%forme_multiple%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.proiect_articole_istoric WHERE proiect_id = pg_temp.rd_id('p6')) <> n THEN RAISE EXCEPTION 't_reprezentare_cheie FAIL: refuzul forme_multiple a scris in istoric'; END IF;
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
DO $t$
BEGIN
  IF auth.uid() IS NOT NULL OR public.fn_rest_decontat_server() IS NOT TRUE THEN RAISE EXCEPTION 't_reprezentare_cheie PRECONDITIE: blocul serverului cere auth.uid() NULL si rolul postgres'; END IF;
  DELETE FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p6') AND cheie = 'O1|D1|TSA01' AND confirmat_la IS NULL;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p6') AND cheie = 'O1|D1|TSA01') <> 1 THEN RAISE EXCEPTION 't_reprezentare_cheie PRECONDITIE: a doua forma scoasa'; END IF;
END $t$;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p6'), 'contract_initial', NULL, NULL, NULL, 'oferta6c.xlsx', repeat('e3', 32), $j$[
    {"obiect_cod":" o1 ","obiect_nume":"TRONSON O1","deviz_cod":" d1 ","deviz_nume":"Terasamente","nr":" 1","cod":" tsa01 ","denumire":"Sapatura","um":"HM","cantitate":1,"pret_unitar":1000,"valoare":1000},
    {"obiect_cod":"O1","obiect_nume":"TRONSON O1","deviz_cod":"D1","deviz_nume":"Terasamente","nr":"2A","cod":"y","denumire":"Umplutura","um":"MC","cantitate":200,"pret_unitar":10,"valoare":2000},
    {"obiect_cod":" o1 ","obiect_nume":"TRONSON O1","deviz_cod":" d1 ","deviz_nume":"Terasamente","nr":"3","cod":" z  z ","denumire":"Articol nou","um":" buc ","cantitate":1,"pret_unitar":1,"valoare":1}]$j$::jsonb, true);
  IF (v->>'inserate')::int <> 3 OR (v->>'inlocuite')::int <> 2 OR (v->>'inlocuite_confirmate')::int <> 2 THEN RAISE EXCEPTION 't_reprezentare_cheie FAIL inlocuire cu cheie noua: %', v; END IF;
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE s text;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  SELECT string_agg(concat_ws('/', obiect_cod, deviz_cod, nr, cod, um, cantitate::text, coalesce(pret_unitar::text, '-'), valoare::text), '; ' ORDER BY cheie) INTO s
    FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p6') AND sursa = 'contract_initial';
  IF s IS DISTINCT FROM 'O1/D1/1/TSA01/M/100/10/1000; o1/D1/2a/Y/100 MC/2/1000/2000; o1/d1/3/z z/buc/1/1/1' THEN
    RAISE EXCEPTION 't_reprezentare_cheie FAIL: cheia noua nu e scrisa normalizata cu obiect_cod-ul unitatii, sau cheile existente s-au schimbat: %', s;
  END IF;
  RAISE NOTICE 't_reprezentare_cheie (3/3) ok: a doua forma a aceleiasi chei = refuz 22023 forme_multiple (cheia + formele), nimic scris; cheia noua " z  z " scrisa "z z" / "d1" / "buc" pe obiectul unitatii (o1), cheile existente neschimbate';
END $t$;
RESET ROLE;

-- ── t_import_vechi_repetat (r8, review #1158 P1 pe r7: importul vechi prin catalog DUPA migrare comasa pozitiile repetate — ambele randuri cu cheia fara nr).
--    P7 (MP b). Accesul general (e) scrie oferta pe calea veche in DOUA cereri, ca loturile catalogului: lotul 1 = TSA01 #1 (100 M) + Y #2; lotul 2 = TSA01 #3
--    (200 M) + Z #4 — grupul TSA01 e TAIAT de lot. Cheile: TSA01 primeste pozitia pe AMBELE randuri (cel din lotul 1 e re-cheiat), Y / Z raman fara; lotul 3
--    cu DOUA TSA01 in aceeasi instructiune (#5, #6) → toate patru cu pozitie, iar acelasi cod in ALT deviz (D2) nu e repetat; functia de re-cheiere apelata
--    direct = 42501; baza (MP b) tine pozitiile separate (100 / 200 / 300 / 400), nu comasate (300) ──
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
CREATE FUNCTION pg_temp.rd_chei_p7() RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT string_agg(nr || ':' || cheie, '; ' ORDER BY id) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p7') AND sursa = 'contract_initial'
$f$;
DO $t$
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  -- lotul 1
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, nr, cod, denumire, um, cantitate, pret_unitar, valoare, sursa) VALUES
    (pg_temp.rd_id('p7'), 'O1', 'TRONSON O1', 'D1', '1', 'TSA01', 'Sapatura strat 1', 'M', 100, 10, 1000, 'contract_initial'),
    (pg_temp.rd_id('p7'), 'O1', 'TRONSON O1', 'D1', '2', 'Y', 'Umplutura', 'MC', 1, 10, 10, 'contract_initial');
  IF pg_temp.rd_chei_p7() IS DISTINCT FROM '1:O1|D1|TSA01; 2:O1|D1|Y' THEN RAISE EXCEPTION 't_import_vechi_repetat PRECONDITIE lot 1: %', pg_temp.rd_chei_p7(); END IF;
END $t$;
DO $t$
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  -- lotul 2 (alta instructiune): TSA01 se repeta → pozitia intra in cheie si la randul din lotul 1
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, nr, cod, denumire, um, cantitate, pret_unitar, valoare, sursa) VALUES
    (pg_temp.rd_id('p7'), 'O1', 'TRONSON O1', 'D1', '3', 'TSA01', 'Sapatura strat 2', 'M', 200, 10, 2000, 'contract_initial'),
    (pg_temp.rd_id('p7'), 'O1', 'TRONSON O1', 'D1', '4', 'Z', 'Compactare', 'MC', 1, 10, 10, 'contract_initial');
  IF pg_temp.rd_chei_p7() IS DISTINCT FROM '1:O1|D1|TSA01|#1; 2:O1|D1|Y; 3:O1|D1|TSA01|#3; 4:O1|D1|Z' THEN
    RAISE EXCEPTION 't_import_vechi_repetat FAIL: grupul taiat de lot nu are pozitia pe ambele randuri: %', pg_temp.rd_chei_p7();
  END IF;
END $t$;
DO $t$
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  -- lotul 3: doua TSA01 in ACEEASI instructiune + TSA01 in alt deviz (D2: alt grup, nerepetat)
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, nr, cod, denumire, um, cantitate, pret_unitar, valoare, sursa) VALUES
    (pg_temp.rd_id('p7'), 'O1', 'TRONSON O1', 'D1', '5', 'TSA01', 'Sapatura strat 3', 'M', 300, 10, 3000, 'contract_initial'),
    (pg_temp.rd_id('p7'), 'O1', 'TRONSON O1', 'D1', '6', 'TSA01', 'Sapatura strat 4', 'M', 400, 10, 4000, 'contract_initial'),
    (pg_temp.rd_id('p7'), 'O1', 'TRONSON O1', 'D2', '1', 'TSA01', 'Sapatura in alt deviz', 'M', 7, 10, 70, 'contract_initial');
  IF pg_temp.rd_chei_p7() IS DISTINCT FROM '1:O1|D1|TSA01|#1; 2:O1|D1|Y; 3:O1|D1|TSA01|#3; 4:O1|D1|Z; 5:O1|D1|TSA01|#5; 6:O1|D1|TSA01|#6; 1:O1|D2|TSA01' THEN
    RAISE EXCEPTION 't_import_vechi_repetat FAIL lot 3: %', pg_temp.rd_chei_p7();
  END IF;
  -- cheile sunt exact cele ale backfill-ului (regula documentului, recalculata aici din randuri)
  IF EXISTS (SELECT 1 FROM public.proiect_articole a
              JOIN (SELECT x.proiect_id, x.sursa, coalesce(x.act_nr, '') AS act_nr, public.fn_rest_decontat_cheie(x.obiect_cod, x.deviz_cod, x.cod, NULL) AS k, count(*) AS n
                      FROM public.proiect_articole x WHERE x.proiect_id = pg_temp.rd_id('p7') GROUP BY 1, 2, 3, 4) d
                ON d.proiect_id = a.proiect_id AND d.sursa IS NOT DISTINCT FROM a.sursa AND d.act_nr = coalesce(a.act_nr, '') AND d.k = public.fn_rest_decontat_cheie(a.obiect_cod, a.deviz_cod, a.cod, NULL)
             WHERE a.proiect_id = pg_temp.rd_id('p7') AND a.cheie IS DISTINCT FROM public.fn_rest_decontat_cheie(a.obiect_cod, a.deviz_cod, a.cod, CASE WHEN d.n > 1 THEN a.nr END)) THEN
    RAISE EXCEPTION 't_import_vechi_repetat FAIL: cheile difera de regula backfill-ului';
  END IF;
  -- functia de re-cheiere nu se apeleaza direct
  BEGIN
    PERFORM public.fn_rest_decontat_cheie_document(pg_temp.rd_id('p7'), 'contract_initial', NULL, 'O1|D1|Y');
    RAISE EXCEPTION 't_import_vechi_repetat FAIL: fn_rest_decontat_cheie_document apelata direct';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%doar din garda%' THEN RAISE; END IF; END;
  IF pg_temp.rd_chei_p7() IS DISTINCT FROM '1:O1|D1|TSA01|#1; 2:O1|D1|Y; 3:O1|D1|TSA01|#3; 4:O1|D1|Z; 5:O1|D1|TSA01|#5; 6:O1|D1|TSA01|#6; 1:O1|D2|TSA01' THEN
    RAISE EXCEPTION 't_import_vechi_repetat FAIL: apelul direct refuzat a schimbat cheile';
  END IF;
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE s text;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  SELECT string_agg(b.cheie || '=' || b.cantitate::text, '; ' ORDER BY b.cheie COLLATE "C") INTO s FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p7');
  IF s IS DISTINCT FROM 'O1|D1|TSA01|#1=100; O1|D1|TSA01|#3=200; O1|D1|TSA01|#5=300; O1|D1|TSA01|#6=400; O1|D1|Y=1; O1|D1|Z=1; O1|D2|TSA01=7' THEN
    RAISE EXCEPTION 't_import_vechi_repetat FAIL baza (pozitii comasate?): %', s;
  END IF;
  RAISE NOTICE 't_import_vechi_repetat ok: codul repetat pe calea veche primeste pozitia pe toate randurile grupului, si peste loturi (re-cheiere), ca backfill-ul; baza tine 100 / 200 / 300 / 400 separate; apelul direct al re-cheierii = 42501';
END $t$;
RESET ROLE;

-- ── t_pozitie (r8, review #1158 P2 pe r7: pozitia nu participa la identitatea cheii, dar se copiaza EXACT si nu se schimba la confirmare). (1/2) P6 (MP b),
--    „inlocuieste” cu aceleasi 3 linii, dar TSA01 cu nr '2' (cheia unica O1|D1|TSA01 are pozitia '1') = 22023 nr_schimbat, nimic scris (reproducerea 1
--    Jakarinos r7: inainte, pozitia devenea 2); apoi TSA01 FARA nr → trece, randul e scris cu '1' (copiat), cititorii vechi identici ──
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  INSERT INTO rd_cons VALUES ('p6_pozitie_inainte', pg_temp.rd_cititori_p6());
  IF (SELECT v FROM rd_cons WHERE k = 'p6_pozitie_inainte') NOT LIKE '%randuri: O1/D1/1/TSA01/M/100/10/1000; o1/D1/2a/Y/100 MC/2/1000/2000; o1/d1/3/z z/buc/1/1/1' THEN
    RAISE EXCEPTION 't_pozitie PRECONDITIE P6: %', (SELECT v FROM rd_cons WHERE k = 'p6_pozitie_inainte');
  END IF;
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; n int; h int;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  SELECT count(*) INTO n FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p6');
  SELECT count(*) INTO h FROM public.proiect_articole_istoric WHERE proiect_id = pg_temp.rd_id('p6');
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p6'), 'contract_initial', NULL, NULL, NULL, 'oferta6d.xlsx', repeat('e4', 32), $j$[
      {"obiect_cod":"O1","obiect_nume":"TRONSON O1","deviz_cod":"D1","deviz_nume":"Terasamente","nr":"2","cod":"TSA01","denumire":"Sapatura","um":"M","cantitate":100,"pret_unitar":10,"valoare":1000},
      {"obiect_cod":"o1","obiect_nume":"TRONSON O1","deviz_cod":"D1","deviz_nume":"Terasamente","nr":"2a","cod":"Y","denumire":"Umplutura","um":"100 MC","cantitate":2,"pret_unitar":1000,"valoare":2000},
      {"obiect_cod":"o1","obiect_nume":"TRONSON O1","deviz_cod":"d1","deviz_nume":"Terasamente","nr":"3","cod":"z z","denumire":"Articol nou","um":"buc","cantitate":1,"pret_unitar":1,"valoare":1}]$j$::jsonb, true);
    RAISE EXCEPTION 't_pozitie FAIL: confirmarea cu alta pozitie (nr 2) pe cheia O1|D1|TSA01 (pozitia 1) acceptata';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%O1|D1|TSA01%pozitia (nr) 1%pozitia 2%nr_schimbat%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p6')) <> n OR (SELECT count(*) FROM public.proiect_articole_istoric WHERE proiect_id = pg_temp.rd_id('p6')) <> h THEN
    RAISE EXCEPTION 't_pozitie FAIL: refuzul nr_schimbat a scris ceva';
  END IF;
  -- fara nr pe TSA01: pozitia existenta ('1') e copiata
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p6'), 'contract_initial', NULL, NULL, NULL, 'oferta6d.xlsx', repeat('e4', 32), $j$[
    {"obiect_cod":"O1","obiect_nume":"TRONSON O1","deviz_cod":"D1","deviz_nume":"Terasamente","cod":"TSA01","denumire":"Sapatura","um":"M","cantitate":100,"pret_unitar":10,"valoare":1000},
    {"obiect_cod":"o1","obiect_nume":"TRONSON O1","deviz_cod":"D1","deviz_nume":"Terasamente","nr":"2a","cod":"Y","denumire":"Umplutura","um":"100 MC","cantitate":2,"pret_unitar":1000,"valoare":2000},
    {"obiect_cod":"o1","obiect_nume":"TRONSON O1","deviz_cod":"d1","deviz_nume":"Terasamente","nr":"3","cod":"z z","denumire":"Articol nou","um":"buc","cantitate":1,"pret_unitar":1,"valoare":1}]$j$::jsonb, true);
  IF (v->>'inserate')::int <> 3 OR (v->>'inlocuite')::int <> 3 OR (v->>'inlocuite_confirmate')::int <> 3 THEN RAISE EXCEPTION 't_pozitie FAIL inlocuire fara nr: %', v; END IF;
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  IF pg_temp.rd_cititori_p6() IS DISTINCT FROM (SELECT v FROM rd_cons WHERE k = 'p6_pozitie_inainte') THEN
    RAISE EXCEPTION 't_pozitie FAIL: linia fara nr n-a copiat pozitia existenta / cititorii s-au schimbat: %', pg_temp.rd_cititori_p6();
  END IF;
  RAISE NOTICE 't_pozitie (1/2) ok: alta pozitie pe o cheie existenta = 22023 nr_schimbat (cheia, pozitia veche, pozitia noua), nimic scris; linia fara nr copiaza pozitia (1), cititorii vechi identici';
END $t$;
RESET ROLE;
-- (2/2) P7: SERVERUL strecoara doua randuri ale aceluiasi cod W cu pozitii diferite (7, 8) sub ACEEASI cheie stocata O1|D2|W (duplicate mostenite cu pozitiile
--    necuprinse in cheie); MP-ul b confirma oferta P7 cu o linie W insumata (nr 7, 300) = 22023 forme_multiple cu ambele forme, nimic scris (reproducerea 2
--    Jakarinos r7: inainte, linia era acceptata si cele doua randuri retrase); la fel cu linia doar pe pozitia 7 (cheia e ambigua indiferent de linie) ──
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
DO $t$
BEGIN
  IF auth.uid() IS NOT NULL OR public.fn_rest_decontat_server() IS NOT TRUE THEN RAISE EXCEPTION 't_pozitie PRECONDITIE: blocul serverului cere auth.uid() NULL si rolul postgres'; END IF;
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, nr, cod, denumire, um, cantitate, pret_unitar, valoare, sursa, cheie) VALUES
    (pg_temp.rd_id('p7'), 'O1', 'TRONSON O1', 'D2', '7', 'W', 'Dublu a', 'M', 100, 10, 1000, 'contract_initial', 'O1|D2|W'),
    (pg_temp.rd_id('p7'), 'O1', 'TRONSON O1', 'D2', '8', 'W', 'Dublu b', 'M', 200, 10, 2000, 'contract_initial', 'O1|D2|W');
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p7') AND cheie = 'O1|D2|W') <> 2 THEN RAISE EXCEPTION 't_pozitie PRECONDITIE: doua pozitii sub aceeasi cheie'; END IF;
END $t$;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; n int; h int; L constant jsonb := $j$[
    {"obiect_cod":"O1","obiect_nume":"TRONSON O1","deviz_cod":"D2","deviz_nume":"Montaj","nr":"7","cod":"W","denumire":"Dublu insumat","um":"M","cantitate":300,"pret_unitar":10,"valoare":3000}]$j$::jsonb;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  SELECT count(*) INTO n FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p7');
  SELECT count(*) INTO h FROM public.proiect_articole_istoric WHERE proiect_id = pg_temp.rd_id('p7');
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p7'), 'contract_initial', NULL, NULL, NULL, 'oferta7.xlsx', repeat('e7', 32), L);
    RAISE EXCEPTION 't_pozitie FAIL: linia insumata pe cheia cu doua pozitii stocate acceptata (randurile ar fi fost retrase)';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%O1|D2|W%mai multe forme brute%O1/D2/W/7/M | O1/D2/W/8/M%forme_multiple%' THEN RAISE; END IF;
  END;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p7'), 'contract_initial', NULL, NULL, NULL, 'oferta7.xlsx', repeat('e7', 32), jsonb_set(L, '{0,cantitate}', '100'::jsonb));
    RAISE EXCEPTION 't_pozitie FAIL: linia doar pe pozitia 7 a cheii ambigue acceptata';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%O1|D2|W%forme_multiple%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p7')) <> n OR (SELECT count(*) FROM public.proiect_articole_istoric WHERE proiect_id = pg_temp.rd_id('p7')) <> h THEN
    RAISE EXCEPTION 't_pozitie FAIL: refuzul forme_multiple a scris ceva (retragere inaintea refuzului)';
  END IF;
  RAISE NOTICE 't_pozitie (2/2) ok: doua pozitii stocate sub aceeasi cheie = 22023 forme_multiple (ambele forme) la linia insumata si la linia pe o singura pozitie, nimic scris / retras';
END $t$;
RESET ROLE;

-- ── t_cheie_referita (r9, review #1158, 2 x P1 pe r8: o cheie REFERITA de o situatie confirmata e INGHETATA; fara decontat orfan tacut). P8 (MP b).
--    (1/4) CALEA VECHE (reproducerea 1 Jakarinos): (e) scrie oferta O1 pe calea veche (TSA01 #1 = 100 M / 1000 lei, Y #2); (b) confirma situatia 1 pe
--    O1|D1|TSA01 (80 M / 800 lei); (e) scrie TSA01 #3 (200 M) → grupul s-ar repeta si randul #1 ar deveni O1|D1|TSA01|#1 → 23514 cheie_referita (cheia,
--    situatia 1, ce ar fi devenit), nimic scris, cheile neschimbate; schimbarea directa a codului sau a cheii randului referit = acelasi refuz; schimbarile
--    care NU ating cheia (denumire, obiectul in forma canonic egala) trec, iar un cod NEreferit (Y) se re-cheiaza in continuare (Y#2 / Y#4 — calea legitima);
--    restul O1|D1|TSA01 = 100 / 80 / 20, fara lipsa; stergerea randului referit pe calea veche (obiect vechi) TRECE, dar lipsurile declara decontat_fara_articol
--    (800 lei, situatia 1) si calculul tine decontatul (baza 0 / decontat 80); re-scrierea codului readuce baza si stinge lipsa ──
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
CREATE FUNCTION pg_temp.rd_chei_p8(ob text) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT string_agg(nr || ':' || cheie, '; ' ORDER BY id) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p8') AND obiect_cod = ob AND sursa = 'contract_initial'
$f$;
DO $t$
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, nr, cod, denumire, um, cantitate, pret_unitar, valoare, sursa) VALUES
    (pg_temp.rd_id('p8'), 'O1', 'TRONSON O1', 'D1', '1', 'TSA01', 'Sapatura', 'M', 100, 10, 1000, 'contract_initial'),
    (pg_temp.rd_id('p8'), 'O1', 'TRONSON O1', 'D1', '2', 'Y', 'Umplutura', 'MC', 1, 10, 10, 'contract_initial');
  IF pg_temp.rd_chei_p8('O1') IS DISTINCT FROM '1:O1|D1|TSA01; 2:O1|D1|Y' THEN RAISE EXCEPTION 't_cheie_referita PRECONDITIE O1: %', pg_temp.rd_chei_p8('O1'); END IF;
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; r record;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p8'), '1', NULL, 'p8_sl1.xlsx', repeat('91', 32),
         '{"luna":1,"an":2026,"linii":[{"obiect_cod":"O1","deviz_cod":"D1","cod":"TSA01","um":"M","cantitate_perioada":80,"pret_unitar":10,"valoare":800,"cheie":"O1|D1|TSA01","tip_rand":"articol","potrivire":"exact"}]}'::jsonb, false);
  IF (v->>'inserate')::int <> 1 THEN RAISE EXCEPTION 't_cheie_referita FAIL situatia 1: %', v; END IF;
  IF public.fn_rest_decontat_cheie_situatii(pg_temp.rd_id('p8'), 'O1|D1|TSA01') IS DISTINCT FROM ARRAY['1']::text[]
     OR public.fn_rest_decontat_cheie_situatii(pg_temp.rd_id('p8'), 'O1|D1|Y') IS DISTINCT FROM ARRAY[]::text[]
     OR public.fn_rest_decontat_cheie_situatii(NULL, 'O1|D1|TSA01') IS DISTINCT FROM ARRAY[]::text[] THEN
    RAISE EXCEPTION 't_cheie_referita FAIL: fn_rest_decontat_cheie_situatii (TSA01 referita de 1, Y nereferita, NULL = gol)';
  END IF;
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O1|D1|TSA01';
  IF r.baza_cantitate <> 100 OR r.decontat_cantitate <> 80 OR r.rest_cantitate <> 20 OR r.obiect_cod IS DISTINCT FROM 'O1' THEN RAISE EXCEPTION 't_cheie_referita FAIL rest inainte: %', row_to_json(r); END IF;
  -- functia MULTIMII (cu valorile decontate) nu e apelabila de client
  BEGIN
    PERFORM x.cheie FROM public.fn_rest_decontat_chei_referite(pg_temp.rd_id('p8')) x;
    RAISE EXCEPTION 't_cheie_referita FAIL: fn_rest_decontat_chei_referite apelabila de client';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE n int;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  SELECT count(*) INTO n FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p8');
  IF n <> 2 THEN RAISE EXCEPTION 't_cheie_referita PRECONDITIE: (e) vede cele 2 randuri ale P8 (%)', n; END IF;
  -- reproducerea 1: al doilea TSA01 pe calea veche ar re-cheia randul referit → refuz, nimic scris
  BEGIN
    INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, nr, cod, denumire, um, cantitate, pret_unitar, valoare, sursa) VALUES
      (pg_temp.rd_id('p8'), 'O1', 'TRONSON O1', 'D1', '3', 'TSA01', 'Sapatura strat 2', 'M', 200, 10, 2000, 'contract_initial');
    RAISE EXCEPTION 't_cheie_referita FAIL: al doilea TSA01 pe calea veche acceptat (randul referit ar fi fost re-cheiat O1|D1|TSA01|#1)';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%cheia O1|D1|TSA01 (codul TSA01) e referita de situatiile confirmate 1%ar fi devenit O1|D1|TSA01|#1%cheie_referita%' THEN RAISE; END IF;
  END;
  -- schimbarea directa a codului / a cheii randului referit
  BEGIN
    UPDATE public.proiect_articole SET cod = 'TSA02' WHERE proiect_id = pg_temp.rd_id('p8') AND obiect_cod = 'O1' AND cod = 'TSA01';
    RAISE EXCEPTION 't_cheie_referita FAIL: codul randului referit schimbat direct';
  EXCEPTION WHEN check_violation THEN IF SQLERRM NOT LIKE '%cheia O1|D1|TSA01%situatiile confirmate 1%ar fi devenit O1|D1|TSA02%cheie_referita%' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.proiect_articole SET cheie = 'O1|D1|TSA01|#1' WHERE proiect_id = pg_temp.rd_id('p8') AND obiect_cod = 'O1' AND cod = 'TSA01';
    RAISE EXCEPTION 't_cheie_referita FAIL: cheia randului referit schimbata explicit';
  EXCEPTION WHEN check_violation THEN IF SQLERRM NOT LIKE '%ar fi devenit O1|D1|TSA01|#1%cheie_referita%' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p8')) <> n OR pg_temp.rd_chei_p8('O1') IS DISTINCT FROM '1:O1|D1|TSA01; 2:O1|D1|Y'
     OR (SELECT cantitate FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p8') AND cod = 'TSA01') <> 100 THEN
    RAISE EXCEPTION 't_cheie_referita FAIL: refuzurile au scris ceva: %', pg_temp.rd_chei_p8('O1');
  END IF;
  -- caile legitime (L20): denumirea / forma canonic egala a obiectului nu ating cheia; un cod NEreferit se re-cheiaza ca pana acum
  UPDATE public.proiect_articole SET denumire = 'Sapatura (rev)', obiect_cod = ' o1 ' WHERE proiect_id = pg_temp.rd_id('p8') AND cod = 'TSA01';
  UPDATE public.proiect_articole SET obiect_cod = 'O1' WHERE proiect_id = pg_temp.rd_id('p8') AND cod = 'TSA01';
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, nr, cod, denumire, um, cantitate, pret_unitar, valoare, sursa) VALUES
    (pg_temp.rd_id('p8'), 'O1', 'TRONSON O1', 'D1', '4', 'Y', 'Umplutura 2', 'MC', 2, 10, 20, 'contract_initial');
  IF pg_temp.rd_chei_p8('O1') IS DISTINCT FROM '1:O1|D1|TSA01; 2:O1|D1|Y|#2; 4:O1|D1|Y|#4' THEN
    RAISE EXCEPTION 't_cheie_referita FAIL calea legitima (denumire / obiect canonic egal / re-cheierea codului nereferit): %', pg_temp.rd_chei_p8('O1');
  END IF;
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE r record;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O1|D1|TSA01';
  IF r.baza_cantitate <> 100 OR r.decontat_cantitate <> 80 OR r.rest_cantitate <> 20 THEN RAISE EXCEPTION 't_cheie_referita FAIL rest dupa refuzuri: %', row_to_json(r); END IF;
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip = 'decontat_fara_articol') THEN RAISE EXCEPTION 't_cheie_referita FAIL: lipsa decontat_fara_articol fara motiv'; END IF;
END $t$;
RESET ROLE;
-- stergerea randului referit pe calea veche (obiectul O1 e „vechi”): trece (dispartia bazei nu e identitate schimbata), dar nu tacut
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  DELETE FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p8') AND cod = 'TSA01';
  IF pg_temp.rd_chei_p8('O1') IS DISTINCT FROM '2:O1|D1|Y|#2; 4:O1|D1|Y|#4' THEN RAISE EXCEPTION 't_cheie_referita FAIL: stergerea randului referit pe calea veche: %', pg_temp.rd_chei_p8('O1'); END IF;
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE r record;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  IF NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip = 'decontat_fara_articol' AND referinta = 'O1|D1|TSA01: 800 lei, 1 linii (situatiile 1)') THEN
    RAISE EXCEPTION 't_cheie_referita FAIL: decontatul ramas fara articol nu e declarat: %', (SELECT string_agg(tip || '=' || referinta, '; ') FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8'));
  END IF;
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O1|D1|TSA01';
  IF r.baza_cantitate <> 0 OR r.decontat_cantitate <> 80 OR r.decontat_valoare <> 800 THEN RAISE EXCEPTION 't_cheie_referita FAIL: decontatul fara articol nu mai e in calcul: %', row_to_json(r); END IF;
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, nr, cod, denumire, um, cantitate, pret_unitar, valoare, sursa) VALUES
    (pg_temp.rd_id('p8'), 'O1', 'TRONSON O1', 'D1', '1', 'TSA01', 'Sapatura', 'M', 100, 10, 1000, 'contract_initial');
  IF pg_temp.rd_chei_p8('O1') IS DISTINCT FROM '2:O1|D1|Y|#2; 4:O1|D1|Y|#4; 1:O1|D1|TSA01' THEN RAISE EXCEPTION 't_cheie_referita FAIL re-scriere: %', pg_temp.rd_chei_p8('O1'); END IF;
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE r record;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O1|D1|TSA01';
  IF r.baza_cantitate <> 100 OR r.decontat_cantitate <> 80 OR r.rest_cantitate <> 20 OR r.obiect_cod IS DISTINCT FROM 'O1'
     OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip = 'decontat_fara_articol') THEN
    RAISE EXCEPTION 't_cheie_referita FAIL: re-scrierea codului n-a readus baza / n-a stins lipsa: %', row_to_json(r);
  END IF;
  RAISE NOTICE 't_cheie_referita (1/4) ok: calea veche — al doilea TSA01 (re-cheierea randului decontat) = 23514 cheie_referita, codul / cheia randului referit nu se schimba direct, nimic scris; denumirea / obiectul canonic egal / re-cheierea unui cod nereferit trec; stergerea randului referit trece, dar e declarata (decontat_fara_articol 800 lei, situatia 1) si decontatul ramane in calcul; re-scrierea stinge lipsa';
END $t$;
RESET ROLE;

-- ── (2/4) RPC (MP b): O2 confirmat prin RPC cu TSA01 #1 (100 M) / #2 (200 M) + Z; situatiile 2 (#1: 80 M / 800) si 3 (#2: 50 M / 500). (a) inlocuirea cu o
--    singura linie TSA01 FARA pozitie = 22023 cheie_referita (ambigua intre #1 si #2), nimic scris; (b) reproducerea 2 Jakarinos: inlocuirea pastreaza doar
--    linia nr 1 si scoate pozitia 2 → linia ramane O2|D1|TSA01|#1 (nu „fara pozitie”), rest 100 / 80 / 20; #2 ramane decontat fara baza: intors in
--    decontat_fara_baza, declarat in lipsuri, tinut in calcul (baza 0 / decontat 50); (c) reproducerea 1 pe RPC: O3 confirmat cu X (cheia fara pozitie), situatia
--    4 pe O3|D1|X, inlocuirea cu X #1 + X #2 = 22023 cheie_referita (cheia, situatia 4, ce ar fi devenit), nimic scris; (d) re-atasarea: inlocuirea O2 cu #1 si
--    #2 → #2 are iar baza, lipsa dispare, rest #2 = 200 / 50 / 150 ──
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; r record; h int; s text;
  L1 constant jsonb := $j$[
    {"obiect_cod":"O2","obiect_nume":"TRONSON O2","deviz_cod":"D1","deviz_nume":"Terasamente","nr":"1","cod":"TSA01","denumire":"Sapatura 1","um":"M","cantitate":100,"pret_unitar":10,"valoare":1000},
    {"obiect_cod":"O2","obiect_nume":"TRONSON O2","deviz_cod":"D1","deviz_nume":"Terasamente","nr":"3","cod":"Z","denumire":"Altceva","um":"BUC","cantitate":1,"pret_unitar":5,"valoare":5}]$j$::jsonb;
  L2 constant jsonb := $j${"obiect_cod":"O2","obiect_nume":"TRONSON O2","deviz_cod":"D1","deviz_nume":"Terasamente","nr":"2","cod":"TSA01","denumire":"Sapatura 2","um":"M","cantitate":200,"pret_unitar":10,"valoare":2000}$j$::jsonb;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'contract_initial', NULL, NULL, NULL, 'p8_o2.xlsx', repeat('92', 32), L1 || L2);
  IF (v->>'inserate')::int <> 3 OR v->'decontat_fara_baza' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 't_cheie_referita FAIL oferta O2: %', v; END IF;
  SELECT string_agg(b.cheie || '=' || b.cantitate::text, '; ' ORDER BY b.cheie COLLATE "C") INTO s FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p8') AND b.cheie LIKE 'O2|%';
  IF s IS DISTINCT FROM 'O2|D1|TSA01|#1=100; O2|D1|TSA01|#2=200; O2|D1|Z=1' THEN RAISE EXCEPTION 't_cheie_referita FAIL baza O2: %', s; END IF;
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p8'), '2', NULL, 'p8_sl2.xlsx', repeat('93', 32),
         '{"luna":2,"an":2026,"linii":[{"cod":"TSA01","nr":"1","um":"M","cantitate_perioada":80,"valoare":800,"cheie":"O2|D1|TSA01|#1","tip_rand":"articol","potrivire":"exact"}]}'::jsonb, false);
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p8'), '3', NULL, 'p8_sl3.xlsx', repeat('94', 32),
         '{"luna":3,"an":2026,"linii":[{"cod":"TSA01","nr":"2","um":"M","cantitate_perioada":50,"valoare":500,"cheie":"O2|D1|TSA01|#2","tip_rand":"articol","potrivire":"exact"}]}'::jsonb, false);
  SELECT count(*) INTO h FROM public.proiect_articole_istoric WHERE proiect_id = pg_temp.rd_id('p8');
  -- (a) linia fara pozitie peste doua chei referite = ambigua
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'contract_initial', NULL, NULL, NULL, 'p8_o2b.xlsx', repeat('95', 32),
           jsonb_build_array((L1->0) - 'nr' || '{"cantitate":300,"valoare":3000}'::jsonb, L1->1), true);
    RAISE EXCEPTION 't_cheie_referita FAIL: linia fara pozitie peste doua chei referite acceptata';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%linia TSA01 fara pozitie%ambigua%O2|D1|TSA01|#1 (situatiile 2), O2|D1|TSA01|#2 (situatiile 3)%ar fi devenit O2|D1|TSA01;%cheie_referita%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.proiect_articole_istoric WHERE proiect_id = pg_temp.rd_id('p8')) <> h
     OR (SELECT string_agg(b.cheie || '=' || b.cantitate::text, '; ' ORDER BY b.cheie COLLATE "C") FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p8') AND b.cheie LIKE 'O2|%') IS DISTINCT FROM s THEN
    RAISE EXCEPTION 't_cheie_referita FAIL: refuzul (a) a scris / retras ceva';
  END IF;
  -- (b) reproducerea 2: doar linia nr 1 → pastreaza #1; #2 fara baza, declarat
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'contract_initial', NULL, NULL, NULL, 'p8_o2c.xlsx', repeat('96', 32), L1, true);
  IF (v->>'inserate')::int <> 2 OR (v->>'inlocuite_confirmate')::int <> 3 OR v->'decontat_fara_baza' IS DISTINCT FROM '["O2|D1|TSA01|#2"]'::jsonb THEN
    RAISE EXCEPTION 't_cheie_referita FAIL inlocuirea fara pozitia 2: % (astept inserate 2, inlocuite_confirmate 3, decontat_fara_baza ["O2|D1|TSA01|#2"])', v;
  END IF;
  SELECT string_agg(b.cheie || '=' || b.cantitate::text, '; ' ORDER BY b.cheie COLLATE "C") INTO s FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p8') AND b.cheie LIKE 'O2|%';
  IF s IS DISTINCT FROM 'O2|D1|TSA01|#1=100; O2|D1|Z=1' THEN RAISE EXCEPTION 't_cheie_referita FAIL: linia nr 1 n-a pastrat cheia referita #1 (baza O2: %)', s; END IF;
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O2|D1|TSA01|#1';
  IF r.baza_cantitate <> 100 OR r.decontat_cantitate <> 80 OR r.rest_cantitate <> 20 OR r.obiect_cod IS DISTINCT FROM 'O2' THEN RAISE EXCEPTION 't_cheie_referita FAIL rest #1: %', row_to_json(r); END IF;
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O2|D1|TSA01|#2';
  IF r.baza_cantitate <> 0 OR r.decontat_cantitate <> 50 OR r.decontat_valoare <> 500 THEN RAISE EXCEPTION 't_cheie_referita FAIL: decontatul #2 nu mai e in calcul: %', row_to_json(r); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip = 'decontat_fara_articol' AND referinta = 'O2|D1|TSA01|#2: 500 lei, 1 linii (situatiile 3)') THEN
    RAISE EXCEPTION 't_cheie_referita FAIL: #2 fara baza nedeclarat: %', (SELECT string_agg(tip || '=' || referinta, '; ') FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8'));
  END IF;
  -- (c) reproducerea 1 pe RPC: codul decontat (cheia fara pozitie) despartit in pozitii
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'contract_initial', NULL, NULL, NULL, 'p8_o3.xlsx', repeat('97', 32),
         '[{"obiect_cod":"O3","obiect_nume":"TRONSON O3","deviz_cod":"D1","nr":"1","cod":"X","denumire":"x","um":"M","cantitate":10,"pret_unitar":10,"valoare":100}]'::jsonb);
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p8'), '4', NULL, 'p8_sl4.xlsx', repeat('98', 32),
         '{"luna":4,"an":2026,"linii":[{"cod":"X","um":"M","cantitate_perioada":5,"valoare":50,"cheie":"O3|D1|X","tip_rand":"articol","potrivire":"exact"}]}'::jsonb, false);
  SELECT count(*) INTO h FROM public.proiect_articole_istoric WHERE proiect_id = pg_temp.rd_id('p8');
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'contract_initial', NULL, NULL, NULL, 'p8_o3b.xlsx', repeat('99', 32), $j$[
      {"obiect_cod":"O3","obiect_nume":"TRONSON O3","deviz_cod":"D1","nr":"1","cod":"X","denumire":"x a","um":"M","cantitate":5,"pret_unitar":10,"valoare":50},
      {"obiect_cod":"O3","obiect_nume":"TRONSON O3","deviz_cod":"D1","nr":"2","cod":"X","denumire":"x b","um":"M","cantitate":5,"pret_unitar":10,"valoare":50}]$j$::jsonb, true);
    RAISE EXCEPTION 't_cheie_referita FAIL: codul decontat despartit in pozitii acceptat (#1 / #2 in loc de cheia referita)';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%cheia O3|D1|X e referita de situatiile confirmate (4) si codul X se repeta acum in document (ar fi devenit O3|D1|X|#1, O3|D1|X|#2)%cheie_referita%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.proiect_articole_istoric WHERE proiect_id = pg_temp.rd_id('p8')) <> h
     OR (SELECT string_agg(b.cheie || '=' || b.cantitate::text, '; ') FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p8') AND b.cheie LIKE 'O3|%') IS DISTINCT FROM 'O3|D1|X=10' THEN
    RAISE EXCEPTION 't_cheie_referita FAIL: refuzul (c) a scris / retras ceva';
  END IF;
  -- (d) re-atasarea lui #2
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'contract_initial', NULL, NULL, NULL, 'p8_o2d.xlsx', repeat('9a', 32), L1 || L2, true);
  IF (v->>'inserate')::int <> 3 OR v->'decontat_fara_baza' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 't_cheie_referita FAIL re-atasare: %', v; END IF;
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O2|D1|TSA01|#2';
  IF r.baza_cantitate <> 200 OR r.decontat_cantitate <> 50 OR r.rest_cantitate <> 150 OR r.obiect_cod IS DISTINCT FROM 'O2'
     OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip = 'decontat_fara_articol') THEN
    RAISE EXCEPTION 't_cheie_referita FAIL: #2 re-atasat: %', row_to_json(r);
  END IF;
  RAISE NOTICE 't_cheie_referita (2/4) ok: RPC — linia fara pozitie peste #1 / #2 referite = 22023 cheie_referita (ambigua); inlocuirea fara pozitia 2 pastreaza #1 (rest 100 / 80 / 20) si declara #2 (decontat_fara_baza + lipsuri, decontatul ramane in calcul); codul decontat despartit in pozitii = 22023 cheie_referita, nimic scris; re-atasarea stinge lipsa';
END $t$;
RESET ROLE;

-- ── (3/4) AA LISTA COMPLETA peste o cheie referita (MP b, documente_baza): O4 confirmat cu Z #1 (10 BUC) / #2 (20 BUC), situatia 5 pe O4|D1|Z|#1 (4 BUC / 40);
--    AA-10 lista completa cu Z FARA pozitie (15 BUC) → linia ia unica cheie referita a identitatii (O4|D1|Z|#1), baza O4 = #1 15 (AA-10), #2 nereferit iese
--    fara lipsa, rest #1 = 15 / 4 / 11; AA-8 lista completa pe O2 DOAR cu TSA01 nr 1 (150 M) → #1 pastrat, #2 (situatia 3) ramane fara baza → intors +
--    declarat; AA-9 (datat dupa AA-8) cu #1 si #2 → #2 readus, lipsa stinsa ──
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; r record; s text;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'contract_initial', NULL, NULL, NULL, 'p8_o4.xlsx', repeat('9b', 32), $j$[
    {"obiect_cod":"O4","obiect_nume":"TRONSON O4","deviz_cod":"D1","nr":"1","cod":"Z","denumire":"z a","um":"BUC","cantitate":10,"pret_unitar":10,"valoare":100},
    {"obiect_cod":"O4","obiect_nume":"TRONSON O4","deviz_cod":"D1","nr":"2","cod":"Z","denumire":"z b","um":"BUC","cantitate":20,"pret_unitar":10,"valoare":200}]$j$::jsonb);
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p8'), '5', NULL, 'p8_sl5.xlsx', repeat('9c', 32),
         '{"luna":5,"an":2026,"linii":[{"cod":"Z","um":"BUC","cantitate_perioada":4,"valoare":40,"cheie":"O4|D1|Z|#1","tip_rand":"articol","potrivire":"exact"}]}'::jsonb, false);
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'act_aditional', pg_temp.rd_id('aa10'), NULL, 'lista_completa', 'p8_aa10.xlsx', repeat('9d', 32),
         '[{"obiect_cod":"O4","deviz_cod":"D1","cod":"Z","denumire":"z rev","um":"BUC","cantitate":15,"pret_unitar":12,"valoare":180}]'::jsonb);
  IF (v->>'inserate')::int <> 1 OR v->'decontat_fara_baza' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 't_cheie_referita FAIL AA-10: %', v; END IF;
  SELECT string_agg(b.cheie || '=' || b.cantitate::text || ' @' || b.pret_unitar::text, '; ' ORDER BY b.cheie COLLATE "C") INTO s FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p8') AND b.cheie LIKE 'O4|%';
  IF s IS DISTINCT FROM 'O4|D1|Z|#1=15 @12' THEN RAISE EXCEPTION 't_cheie_referita FAIL: linia AA fara pozitie n-a luat cheia referita #1 / lista completa: %', s; END IF;
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O4|D1|Z|#1';
  IF r.baza_cantitate <> 15 OR r.decontat_cantitate <> 4 OR r.rest_cantitate <> 11 OR r.obiect_cod IS DISTINCT FROM 'O4' THEN RAISE EXCEPTION 't_cheie_referita FAIL rest O4 #1: %', row_to_json(r); END IF;
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip = 'decontat_fara_articol') THEN RAISE EXCEPTION 't_cheie_referita FAIL: lipsa dupa AA-10 (#2 nu e referit)'; END IF;
  -- AA-8 lista completa pe O2 fara pozitia 2
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'act_aditional', pg_temp.rd_id('aa8'), NULL, 'lista_completa', 'p8_aa8.xlsx', repeat('9e', 32),
         '[{"obiect_cod":"O2","deviz_cod":"D1","nr":"1","cod":"TSA01","denumire":"Sapatura rev","um":"M","cantitate":150,"pret_unitar":11,"valoare":1650}]'::jsonb);
  IF (v->>'inserate')::int <> 1 OR v->'decontat_fara_baza' IS DISTINCT FROM '["O2|D1|TSA01|#2"]'::jsonb THEN RAISE EXCEPTION 't_cheie_referita FAIL AA-8: %', v; END IF;
  SELECT string_agg(b.cheie || '=' || b.cantitate::text, '; ' ORDER BY b.cheie COLLATE "C") INTO s FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p8') AND b.cheie LIKE 'O2|%';
  IF s IS DISTINCT FROM 'O2|D1|TSA01|#1=150' THEN RAISE EXCEPTION 't_cheie_referita FAIL baza O2 dupa AA-8: %', s; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip = 'decontat_fara_articol' AND referinta = 'O2|D1|TSA01|#2: 500 lei, 1 linii (situatiile 3)') THEN
    RAISE EXCEPTION 't_cheie_referita FAIL: #2 scos de lista completa AA-8 nedeclarat';
  END IF;
  -- AA-9 (mai nou) cu ambele pozitii
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'act_aditional', pg_temp.rd_id('aa9'), NULL, 'lista_completa', 'p8_aa9.xlsx', repeat('9f', 32), $j$[
    {"obiect_cod":"O2","deviz_cod":"D1","nr":"1","cod":"TSA01","denumire":"Sapatura 1","um":"M","cantitate":150,"pret_unitar":11,"valoare":1650},
    {"obiect_cod":"O2","deviz_cod":"D1","nr":"2","cod":"TSA01","denumire":"Sapatura 2","um":"M","cantitate":210,"pret_unitar":11,"valoare":2310}]$j$::jsonb);
  IF (v->>'inserate')::int <> 2 OR v->'decontat_fara_baza' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 't_cheie_referita FAIL AA-9: %', v; END IF;
  SELECT string_agg(b.cheie || '=' || b.cantitate::text, '; ' ORDER BY b.cheie COLLATE "C") INTO s FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p8') AND b.cheie LIKE 'O2|%';
  IF s IS DISTINCT FROM 'O2|D1|TSA01|#1=150; O2|D1|TSA01|#2=210'
     OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip = 'decontat_fara_articol') THEN
    RAISE EXCEPTION 't_cheie_referita FAIL dupa AA-9: %', s;
  END IF;
  RAISE NOTICE 't_cheie_referita (3/4) ok: AA lista completa — linia fara pozitie ia unica cheie referita (O4|D1|Z|#1 = 15, rest 11); lista completa fara #2 il lasa fara baza: intors (decontat_fara_baza) si declarat (lipsuri); lista completa urmatoare cu #1 / #2 il readuce';
END $t$;
RESET ROLE;

-- ── (4/4) dezactivarea actului (owner a): AA-9 inactiv → baza O2 revine la AA-8, #2 iar fara baza (declarat); reactivat → stins. SERVERUL (auth.uid() NULL,
--    postgres) nu schimba nici el cheia unui rand referit. Inlocuirea situatiei 4 (fara linia pe O3|D1|X) DEZGHEATA cheia: despartirea in pozitii trece apoi ──
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000a', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000a');
  UPDATE public.executie_acte_aditionale SET activ = false WHERE id = pg_temp.rd_id('aa9');
  IF NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip = 'decontat_fara_articol' AND referinta LIKE 'O2|D1|TSA01|#2: 500 lei%') THEN
    RAISE EXCEPTION 't_cheie_referita FAIL: AA-9 dezactivat → #2 fara baza nedeclarat';
  END IF;
  UPDATE public.executie_acte_aditionale SET activ = true WHERE id = pg_temp.rd_id('aa9');
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip = 'decontat_fara_articol') THEN
    RAISE EXCEPTION 't_cheie_referita FAIL: AA-9 reactivat → lipsa ramasa';
  END IF;
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
DO $t$
BEGIN
  IF auth.uid() IS NOT NULL OR public.fn_rest_decontat_server() IS NOT TRUE THEN RAISE EXCEPTION 't_cheie_referita PRECONDITIE: blocul serverului cere auth.uid() NULL si rolul postgres'; END IF;
  BEGIN
    UPDATE public.proiect_articole SET cod = 'TSA09' WHERE proiect_id = pg_temp.rd_id('p8') AND obiect_cod = 'O1' AND cod = 'TSA01';
    RAISE EXCEPTION 't_cheie_referita FAIL: serverul a schimbat codul unui rand referit';
  EXCEPTION WHEN check_violation THEN IF SQLERRM NOT LIKE '%cheia O1|D1|TSA01%ar fi devenit O1|D1|TSA09%cheie_referita%' THEN RAISE; END IF; END;
  IF (SELECT cheie FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p8') AND obiect_cod = 'O1' AND cod = 'TSA01') IS DISTINCT FROM 'O1|D1|TSA01' THEN
    RAISE EXCEPTION 't_cheie_referita FAIL: refuzul serverului a scris ceva';
  END IF;
END $t$;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; s text;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  -- situatia 4 inlocuita cu o versiune FARA linia pe O3|D1|X (articol nou) → cheia nu mai e referita
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p8'), '4', NULL, 'p8_sl4b.xlsx', repeat('a1', 32),
         '{"luna":4,"an":2026,"linii":[{"obiect_cod":"O3","cod":"X9","denumire":"Lucrare noua","um":"M","cantitate_perioada":5,"valoare":50,"tip_rand":"articol_nou"}]}'::jsonb, true);
  IF (v->>'versiune')::int <> 2 OR public.fn_rest_decontat_cheie_situatii(pg_temp.rd_id('p8'), 'O3|D1|X') IS DISTINCT FROM ARRAY[]::text[] THEN RAISE EXCEPTION 't_cheie_referita FAIL: situatia 4 v2 / cheia inca referita: %', v; END IF;
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'contract_initial', NULL, NULL, NULL, 'p8_o3b.xlsx', repeat('99', 32), $j$[
    {"obiect_cod":"O3","obiect_nume":"TRONSON O3","deviz_cod":"D1","nr":"1","cod":"X","denumire":"x a","um":"M","cantitate":5,"pret_unitar":10,"valoare":50},
    {"obiect_cod":"O3","obiect_nume":"TRONSON O3","deviz_cod":"D1","nr":"2","cod":"X","denumire":"x b","um":"M","cantitate":5,"pret_unitar":10,"valoare":50}]$j$::jsonb, true);
  IF (v->>'inserate')::int <> 2 OR v->'decontat_fara_baza' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 't_cheie_referita FAIL: despartirea in pozitii dupa dezghetare: %', v; END IF;
  SELECT string_agg(b.cheie || '=' || b.cantitate::text, '; ' ORDER BY b.cheie COLLATE "C") INTO s FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p8') AND b.cheie LIKE 'O3|%';
  IF s IS DISTINCT FROM 'O3|D1|X|#1=5; O3|D1|X|#2=5' THEN RAISE EXCEPTION 't_cheie_referita FAIL baza O3 dupa dezghetare: %', s; END IF;
  RAISE NOTICE 't_cheie_referita (4/4) ok: AA dezactivat → #2 fara baza declarat, reactivat → stins; serverul nu schimba cheia referita (23514, nimic scris); situatia inlocuita fara linia pe cheie dezgheata cheia (despartirea in pozitii trece)';
END $t$;
RESET ROLE;

-- ── t_um_decontat (r10, review #1158, P1 + P2 pe r9: reatasarea unei chei ramase fara baza amesteca unitatile si stinge avertizarea; reatasarea fara nr a
--    cheii referite #1 e refuzata dupa ce articolul a ajuns in istoric). P8 (MP b). O SINGURA validare (fn_rest_decontat_um_decontat_diferit) pe TOATE caile.
--    (1/3) CALEA VECHE + RPC (toate sursele) + SERVER pe O1|D1|TSA01 (80 M decontati, situatia 1): (e) sterge randul TSA01 (permis, declarat); (e) il rescrie cu
--    MC = 23514 um_decontat, nimic scris; cu ML (echivalent) trece, UPDATE um → MC = 23514, um → m trece, cantitatea trece; sters la loc. (b) vede
--    decontat_fara_articol (800 lei) si baza 0 / decontat 80; devizul AA-11 cu TSA01 100 MC = 22023 um_decontat (reproducerea P1 Jakarinos: inainte RPC-ul
--    accepta si intorcea decontat_fara_baza = []), nimic scris, avertizarea NU se stinge; la fel devizul NCS-11 si NR-11 cu MC; AA-11 cu HM x 1 (= 100 M) trece,
--    stinge lipsa, rest 100 / 80 / 20 (um_incert fals); NCS-11 in ML (+10) si NR-11 in M (-10) trec (rest 110 → 100); serverul nu trece randul AA-11 in MC
--    (23514, nimic scris), schimbarile care nu ating UM-ul / cheia trec ──
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE n int; v_id bigint;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  IF pg_temp.rd_chei_p8('O1') IS DISTINCT FROM '2:O1|D1|Y|#2; 4:O1|D1|Y|#4; 1:O1|D1|TSA01' THEN RAISE EXCEPTION 't_um_decontat PRECONDITIE O1: %', pg_temp.rd_chei_p8('O1'); END IF;
  SELECT count(*) INTO n FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p8');
  -- randul referit dispare pe calea veche (permis; declarat de lipsuri — t_cheie_referita 1/4)
  DELETE FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p8') AND obiect_cod = 'O1' AND cod = 'TSA01';
  -- reproducerea P1 pe CALEA VECHE: baza refacuta in MC peste 80 M decontati = refuz, nimic scris
  BEGIN
    INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, nr, cod, denumire, um, cantitate, pret_unitar, valoare, sursa) VALUES
      (pg_temp.rd_id('p8'), 'O1', 'TRONSON O1', 'D1', '1', 'TSA01', 'Sapatura (MC)', 'MC', 100, 10, 1000, 'contract_initial');
    RAISE EXCEPTION 't_um_decontat FAIL: TSA01 rescris in MC pe calea veche peste decontatul in M';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%cheia O1|D1|TSA01 (codul TSA01) are cantitati decontate in UM M si nu primeste o baza in UM MC%um_decontat%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p8')) <> n - 1 THEN RAISE EXCEPTION 't_um_decontat FAIL: refuzul MC a scris ceva'; END IF;
  -- UM echivalent prin factor (ML = M) trece; UPDATE-ul UM-ului spre MC = refuz; spre „m” trece; cantitatea trece
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, nr, cod, denumire, um, cantitate, pret_unitar, valoare, sursa) VALUES
    (pg_temp.rd_id('p8'), 'O1', 'TRONSON O1', 'D1', '1', 'TSA01', 'Sapatura (ML)', 'ML', 50, 10, 500, 'contract_initial') RETURNING id INTO v_id;
  IF (SELECT cheie FROM public.proiect_articole WHERE id = v_id) IS DISTINCT FROM 'O1|D1|TSA01' THEN RAISE EXCEPTION 't_um_decontat FAIL: cheia randului ML'; END IF;
  BEGIN
    UPDATE public.proiect_articole SET um = 'MC' WHERE id = v_id;
    RAISE EXCEPTION 't_um_decontat FAIL: UM-ul randului referit schimbat in MC pe calea veche';
  EXCEPTION WHEN check_violation THEN IF SQLERRM NOT LIKE '%cheia O1|D1|TSA01%decontate in UM M%baza in UM MC%um_decontat%' THEN RAISE; END IF; END;
  UPDATE public.proiect_articole SET um = 'm' WHERE id = v_id;
  UPDATE public.proiect_articole SET cantitate = 60, valoare = 600 WHERE id = v_id;
  IF (SELECT um || '/' || cantitate::text FROM public.proiect_articole WHERE id = v_id) IS DISTINCT FROM 'm/60' THEN RAISE EXCEPTION 't_um_decontat FAIL: schimbarile legitime (um echivalent, cantitate) n-au trecut'; END IF;
  DELETE FROM public.proiect_articole WHERE id = v_id;
  IF pg_temp.rd_chei_p8('O1') IS DISTINCT FROM '2:O1|D1|Y|#2; 4:O1|D1|Y|#4' THEN RAISE EXCEPTION 't_um_decontat FAIL: O1 dupa calea veche: %', pg_temp.rd_chei_p8('O1'); END IF;
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; r record; v_nota bigint; s text;
  L_MC constant jsonb := $j$[{"obiect_cod":"O1","deviz_cod":"D1","cod":"TSA01","denumire":"Sapatura rev","um":"MC","cantitate":100,"pret_unitar":10,"valoare":1000}]$j$::jsonb;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  -- precondiția reproducerii: cheia referita fara baza, declarata
  IF NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip = 'decontat_fara_articol' AND referinta = 'O1|D1|TSA01: 800 lei, 1 linii (situatiile 1)')
     OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip = 'aa_fara_deviz' AND referinta = 'AA-11') THEN
    RAISE EXCEPTION 't_um_decontat PRECONDITIE: decontat_fara_articol O1|D1|TSA01 + aa_fara_deviz AA-11: %', (SELECT string_agg(tip || '=' || referinta, '; ') FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8'));
  END IF;
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O1|D1|TSA01';
  IF r.baza_cantitate <> 0 OR r.decontat_cantitate <> 80 OR r.decontat_valoare <> 800 THEN RAISE EXCEPTION 't_um_decontat PRECONDITIE rest: %', row_to_json(r); END IF;
  -- reproducerea P1 (Jakarinos r9): devizul AA pe cheia ramasa fara baza, in MC = refuz (inainte: acceptat, decontat_fara_baza = [], 80 M prezentati ca 80 MC)
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'act_aditional', pg_temp.rd_id('aa11'), NULL, 'diferente', 'p8_aa11.xlsx', repeat('a2', 32), L_MC);
    RAISE EXCEPTION 't_um_decontat FAIL: devizul AA-11 in MC acceptat pe cheia O1|D1|TSA01 cu 80 M decontati (reproducerea P1 r9): %', v;
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%cheia O1|D1|TSA01 are cantitati decontate in UM M si nu-si poate schimba UM-ul (UM nou MC)%um_decontat%' THEN RAISE; END IF;
  END;
  -- NCS-11 / NR-11 (notele MP-ului, aprobate): devizele lor in MC = acelasi refuz
  INSERT INTO public.executie_note_modificare (proiect_id, tip, numar, data_aprobare) VALUES (pg_temp.rd_id('p8'), 'NCS', 'NCS-11', DATE '2026-10-05') RETURNING id INTO v_nota;
  INSERT INTO rd_fix VALUES ('ncs11', v_nota);
  INSERT INTO public.executie_note_modificare (proiect_id, tip, numar, data_aprobare) VALUES (pg_temp.rd_id('p8'), 'NR', 'NR-11', DATE '2026-10-07') RETURNING id INTO v_nota;
  INSERT INTO rd_fix VALUES ('nr11', v_nota);
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'nota_comanda_suplimentara', NULL, pg_temp.rd_id('ncs11'), NULL, 'p8_ncs11.xlsx', repeat('a3', 32),
           jsonb_set(L_MC, '{0,cantitate}', '10') );
    RAISE EXCEPTION 't_um_decontat FAIL: devizul NCS-11 in MC acceptat pe cheia decontata in M';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%O1|D1|TSA01%decontate in UM M%UM nou MC%um_decontat%' THEN RAISE; END IF; END;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'nota_renuntare', NULL, pg_temp.rd_id('nr11'), NULL, 'p8_nr11.xlsx', repeat('a4', 32),
           jsonb_set(jsonb_set(L_MC, '{0,cantitate}', '-10'), '{0,valoare}', '-100'));
    RAISE EXCEPTION 't_um_decontat FAIL: devizul NR-11 in MC acceptat pe cheia decontata in M';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%O1|D1|TSA01%decontate in UM M%UM nou MC%um_decontat%' THEN RAISE; END IF; END;
  -- nimic scris; avertizarea NU s-a stins; decontatul ramane 80 M cu baza 0
  IF NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip = 'decontat_fara_articol' AND referinta = 'O1|D1|TSA01: 800 lei, 1 linii (situatiile 1)')
     OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip = 'aa_fara_deviz' AND referinta = 'AA-11')
     OR (SELECT count(*) FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip = 'nota_fara_deviz' AND referinta IN ('NCS NCS-11', 'NR NR-11')) <> 2
     OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O1|D1|TSA01') THEN
    RAISE EXCEPTION 't_um_decontat FAIL: refuzurile RPC au scris ceva sau au stins avertizarea: %', (SELECT string_agg(tip || '=' || referinta, '; ') FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8'));
  END IF;
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O1|D1|TSA01';
  IF r.baza_cantitate <> 0 OR r.decontat_cantitate <> 80 OR r.decontat_valoare <> 800 THEN RAISE EXCEPTION 't_um_decontat FAIL: decontatul dupa refuzuri: %', row_to_json(r); END IF;
  -- UM echivalent prin factor: AA-11 cu HM x 1 (= 100 M) trece si stinge lipsa; rest 100 / 80 / 20, UM sigur
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'act_aditional', pg_temp.rd_id('aa11'), NULL, 'diferente', 'p8_aa11b.xlsx', repeat('a5', 32),
         '[{"obiect_cod":"O1","deviz_cod":"D1","cod":"TSA01","denumire":"Sapatura rev","um":"HM","cantitate":1,"pret_unitar":1000,"valoare":1000}]'::jsonb);
  IF (v->>'inserate')::int <> 1 OR v->'decontat_fara_baza' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 't_um_decontat FAIL AA-11 HM: %', v; END IF;
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O1|D1|TSA01';
  IF r.baza_cantitate <> 100 OR r.decontat_cantitate <> 80 OR r.rest_cantitate <> 20 OR r.um IS DISTINCT FROM 'M' OR r.um_incert IS NOT FALSE OR r.obiect_cod IS DISTINCT FROM 'O1'
     OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip IN ('decontat_fara_articol', 'decontat_um_diferit')) THEN
    RAISE EXCEPTION 't_um_decontat FAIL: re-atasarea echivalenta (HM) n-a readus baza / n-a stins lipsa: %', row_to_json(r);
  END IF;
  -- notele cu UM echivalent trec (ML +10, M -10): rest 110 → 100
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'nota_comanda_suplimentara', NULL, pg_temp.rd_id('ncs11'), NULL, 'p8_ncs11b.xlsx', repeat('a6', 32),
         '[{"obiect_cod":"O1","deviz_cod":"D1","cod":"TSA01","denumire":"Sapatura supl","um":"ML","cantitate":10,"pret_unitar":10,"valoare":100}]'::jsonb);
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O1|D1|TSA01';
  IF r.baza_cantitate <> 110 OR r.rest_cantitate <> 30 OR r.um_incert IS NOT FALSE THEN RAISE EXCEPTION 't_um_decontat FAIL NCS-11 ML: %', row_to_json(r); END IF;
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'nota_renuntare', NULL, pg_temp.rd_id('nr11'), NULL, 'p8_nr11b.xlsx', repeat('a7', 32),
         '[{"obiect_cod":"O1","deviz_cod":"D1","cod":"TSA01","denumire":"Sapatura renuntare","um":"M","cantitate":-10,"pret_unitar":10,"valoare":-100}]'::jsonb);
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O1|D1|TSA01';
  IF r.baza_cantitate <> 100 OR r.rest_cantitate <> 20 OR r.um_incert IS NOT FALSE
     OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip IN ('decontat_fara_articol', 'decontat_um_diferit', 'nota_fara_deviz', 'aa_fara_deviz') AND referinta ~ '(TSA01|AA-11|NCS-11|NR-11)') THEN
    RAISE EXCEPTION 't_um_decontat FAIL NR-11 M: % / %', row_to_json(r), (SELECT string_agg(tip || '=' || referinta, '; ') FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8'));
  END IF;
END $t$;
RESET ROLE;
-- SERVERUL (auth.uid() NULL, postgres): nici el nu trece un rand al bazei in alt UM decat cel decontat; schimbarile care nu ating UM-ul / cheia trec
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
DO $t$
BEGIN
  IF auth.uid() IS NOT NULL OR public.fn_rest_decontat_server() IS NOT TRUE THEN RAISE EXCEPTION 't_um_decontat PRECONDITIE: blocul serverului cere auth.uid() NULL si rolul postgres'; END IF;
  IF (SELECT um FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p8') AND act_aditional_id = pg_temp.rd_id('aa11')) IS DISTINCT FROM 'HM' THEN RAISE EXCEPTION 't_um_decontat PRECONDITIE: randul AA-11 in HM'; END IF;
  BEGIN
    UPDATE public.proiect_articole SET um = 'MC' WHERE proiect_id = pg_temp.rd_id('p8') AND act_aditional_id = pg_temp.rd_id('aa11');
    RAISE EXCEPTION 't_um_decontat FAIL: serverul a trecut randul AA-11 in MC peste decontatul in M';
  EXCEPTION WHEN check_violation THEN IF SQLERRM NOT LIKE '%cheia O1|D1|TSA01%decontate in UM M%baza in UM MC%um_decontat%' THEN RAISE; END IF; END;
  UPDATE public.proiect_articole SET denumire = 'Sapatura rev (server)' WHERE proiect_id = pg_temp.rd_id('p8') AND act_aditional_id = pg_temp.rd_id('aa11');
  IF (SELECT um || '/' || denumire FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p8') AND act_aditional_id = pg_temp.rd_id('aa11')) IS DISTINCT FROM 'HM/Sapatura rev (server)' THEN
    RAISE EXCEPTION 't_um_decontat FAIL: refuzul serverului a scris / schimbarea legitima n-a trecut';
  END IF;
  RAISE NOTICE 't_um_decontat (1/3) ok: cheia O1|D1|TSA01 (80 M decontati) ramasa fara baza — calea veche cu MC = 23514 um_decontat (INSERT si UPDATE), ML / m trec; devizul AA-11 / NCS-11 / NR-11 cu MC = 22023 um_decontat (reproducerea P1 r9), nimic scris, avertizarea decontat_fara_articol ramane; AA-11 in HM (= 100 M) stinge lipsa (rest 100 / 80 / 20, UM sigur), notele in ML / M trec (110 → 100); serverul nu trece randul in MC (23514)';
END $t$;

-- ── (2/3) reproducerea P2 (MP b, O5): oferta X #1 (100 M) / #2 (200 M); situatia 6 pe O5|D1|X|#1 (80 M / 800); inlocuirea cu Y il lasa fara baza (X in istoric,
--    declarat); reintroducerea lui X FARA pozitie cu MC = 22023 um_decontat (oferta pe cheia fara baza), nimic scris; cu M = acceptata: randul poarta cheia
--    referita O5|D1|X|#1 si pozitia '1' (reconstruita din cheie; inainte: nr NULL → 23514 „cheia nu corespunde”), rest 100 / 80 / 20, lipsa stinsa ──
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; r record; h int; s text;
  L_Y constant jsonb := $j${"obiect_cod":"O5","obiect_nume":"TRONSON O5","deviz_cod":"D1","deviz_nume":"Terasamente","nr":"1","cod":"Y","denumire":"Umplutura","um":"BUC","cantitate":10,"pret_unitar":10,"valoare":100}$j$::jsonb;
  L_X constant jsonb := $j${"obiect_cod":"O5","obiect_nume":"TRONSON O5","deviz_cod":"D1","deviz_nume":"Terasamente","cod":"X","denumire":"Sapatura","um":"M","cantitate":100,"pret_unitar":10,"valoare":1000}$j$::jsonb;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'contract_initial', NULL, NULL, NULL, 'p8_o5.xlsx', repeat('a8', 32),
         jsonb_build_array(L_X || '{"nr":"1","denumire":"Sapatura 1"}'::jsonb, L_X || '{"nr":"2","denumire":"Sapatura 2","cantitate":200,"valoare":2000}'::jsonb));
  IF (v->>'inserate')::int <> 2 THEN RAISE EXCEPTION 't_um_decontat FAIL oferta O5: %', v; END IF;
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p8'), '6', NULL, 'p8_sl6.xlsx', repeat('a9', 32),
         '{"luna":6,"an":2026,"linii":[{"cod":"X","nr":"1","um":"M","cantitate_perioada":80,"valoare":800,"cheie":"O5|D1|X|#1","tip_rand":"articol","potrivire":"exact"}]}'::jsonb, false);
  -- inlocuirea cu articolul Y: X ajunge in istoric, #1 ramane decontat fara baza (declarat)
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'contract_initial', NULL, NULL, NULL, 'p8_o5b.xlsx', repeat('aa', 32), jsonb_build_array(L_Y), true);
  IF (v->>'inserate')::int <> 1 OR (v->>'inlocuite_confirmate')::int <> 2 OR v->'decontat_fara_baza' IS DISTINCT FROM '["O5|D1|X|#1"]'::jsonb THEN RAISE EXCEPTION 't_um_decontat FAIL inlocuirea cu Y: %', v; END IF;
  SELECT count(*) INTO h FROM public.proiect_articole_istoric WHERE proiect_id = pg_temp.rd_id('p8') AND obiect_k = 'O5||';
  IF h <> 2 OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip = 'decontat_fara_articol' AND referinta = 'O5|D1|X|#1: 800 lei, 1 linii (situatiile 6)') THEN
    RAISE EXCEPTION 't_um_decontat FAIL: X nu e in istoric (%) / #1 fara baza nedeclarat', h;
  END IF;
  -- reintroducerea lui X fara pozitie, in MC (oferta pe cheia ramasa fara baza) = refuz, nimic scris
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'contract_initial', NULL, NULL, NULL, 'p8_o5c.xlsx', repeat('ab', 32),
           jsonb_build_array(L_Y, L_X || '{"um":"MC"}'::jsonb), true);
    RAISE EXCEPTION 't_um_decontat FAIL: X reintrodus in MC pe cheia O5|D1|X|#1 cu 80 M decontati';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%cheia O5|D1|X|#1 are cantitati decontate in UM M%UM nou MC%um_decontat%' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM public.proiect_articole_istoric WHERE proiect_id = pg_temp.rd_id('p8') AND obiect_k = 'O5||') <> h
     OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip = 'decontat_fara_articol' AND referinta LIKE 'O5|D1|X|#1: 800 lei%') THEN
    RAISE EXCEPTION 't_um_decontat FAIL: refuzul MC pe O5 a scris / retras ceva sau a stins avertizarea';
  END IF;
  -- reproducerea P2: X fara pozitie, UM corect → cheia referita #1 SI pozitia '1' reconstruita din cheie
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'contract_initial', NULL, NULL, NULL, 'p8_o5d.xlsx', repeat('ac', 32), jsonb_build_array(L_Y, L_X), true);
  IF (v->>'inserate')::int <> 2 OR (v->>'inlocuite_confirmate')::int <> 1 OR v->'decontat_fara_baza' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 't_um_decontat FAIL: reintroducerea lui X fara pozitie (reproducerea P2 r9): %', v;
  END IF;
  SELECT string_agg(b.cheie || '=' || b.cantitate::text || ' ' || b.um || ' nr=' || coalesce(b.nr, '-'), '; ' ORDER BY b.cheie COLLATE "C") INTO s
    FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p8') AND b.cheie LIKE 'O5|%';
  IF s IS DISTINCT FROM 'O5|D1|X|#1=100 M nr=1; O5|D1|Y=10 BUC nr=1' THEN RAISE EXCEPTION 't_um_decontat FAIL baza O5 dupa reintroducere (astept X|#1 cu nr 1): %', s; END IF;
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O5|D1|X|#1';
  IF r.baza_cantitate <> 100 OR r.decontat_cantitate <> 80 OR r.rest_cantitate <> 20 OR r.um_incert IS NOT FALSE OR r.nr IS DISTINCT FROM '1'
     OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p8') AND tip IN ('decontat_fara_articol', 'decontat_um_diferit')) THEN
    RAISE EXCEPTION 't_um_decontat FAIL rest O5|D1|X|#1 dupa reintroducere: %', row_to_json(r);
  END IF;
  -- L20: o situatie INLOCUITA (inactiva) nu tine cheia prizoniera in UM-ul ei vechi — situatia 4 v1 (inactiva, t_cheie_referita 4/4) avea X in M pe O3|D1|X;
  -- cheia nu mai e referita, deci devizul NCS-12 cu X (fara pozitie, cheia O3|D1|X) in MC trece (doar situatiile ACTIVE conteaza)
  INSERT INTO public.executie_note_modificare (proiect_id, tip, numar, data_aprobare) VALUES (pg_temp.rd_id('p8'), 'NCS', 'NCS-12', DATE '2026-10-09') RETURNING id INTO h;
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p8'), 'nota_comanda_suplimentara', NULL, h, NULL, 'p8_ncs12.xlsx', repeat('ad', 32),
         '[{"obiect_cod":"O3","deviz_cod":"D1","cod":"X","denumire":"x in mc","um":"MC","cantitate":5,"pret_unitar":10,"valoare":50}]'::jsonb);
  IF (v->>'inserate')::int <> 1 OR v->'decontat_fara_baza' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 't_um_decontat FAIL NCS-12 pe cheia dezghetata: %', v; END IF;
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O3|D1|X';
  IF r.baza_cantitate <> 5 OR r.um IS DISTINCT FROM 'MC' OR r.decontat_cantitate <> 0 OR r.um_incert IS NOT FALSE THEN RAISE EXCEPTION 't_um_decontat FAIL O3|D1|X in MC dupa dezghetare: %', row_to_json(r); END IF;
  RAISE NOTICE 't_um_decontat (2/3) ok: X fara pozitie pe cheia referita O5|D1|X|#1 ramasa fara baza — in MC = 22023 um_decontat (nimic scris, lipsa ramane), in M = acceptat cu cheia referita si pozitia 1 reconstruita din cheie (rest 100 / 80 / 20, lipsa stinsa); situatia inlocuita (inactiva) nu tine O3|D1|X in M: NCS-12 in MC trece';
END $t$;
RESET ROLE;

-- ── (3/3) apararea in adancime (SERVER, garda scoasa intr-un sub-bloc ANULAT): daca un rand al bazei ar ajunge totusi in alt UM decat cel decontat (O5|D1|X|#1
--    trecut in MC peste 80 M), lipsurile il declara (decontat_um_diferit: baza MC, decontat M) si calculul il marcheaza um_incert — nu se prezinta ca „rest 20 MC”;
--    sub-blocul se anuleaza (garda revine, randul e iar in M) ──
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
DO $t$
DECLARE r record; s text;
BEGIN
  IF auth.uid() IS NOT NULL OR public.fn_rest_decontat_server() IS NOT TRUE THEN RAISE EXCEPTION 't_um_decontat PRECONDITIE: blocul serverului cere auth.uid() NULL si rolul postgres'; END IF;
  PERFORM set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000a', true);
  SELECT * INTO r FROM public.fn_rest_decontat_calcul() c WHERE c.proiect_id = pg_temp.rd_id('p8') AND c.cheie = 'O5|D1|X|#1';
  IF r.um IS DISTINCT FROM 'M' OR r.um_incert IS NOT FALSE OR r.baza_cantitate <> 100 OR EXISTS (SELECT 1 FROM public.fn_rest_decontat_lipsuri_calcul() l WHERE l.tip = 'decontat_um_diferit') THEN
    RAISE EXCEPTION 't_um_decontat PRECONDITIE (3/3): O5|D1|X|#1 = 100 M sigur, fara decontat_um_diferit (%)', row_to_json(r);
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    ALTER TABLE public.proiect_articole DISABLE TRIGGER trg_rest_decontat_articole_garda;
    UPDATE public.proiect_articole SET um = 'MC' WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O5|D1|X|#1' AND activ;
    IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O5|D1|X|#1' AND um = 'MC') <> 1 THEN RAISE EXCEPTION 't_um_decontat PRECONDITIE (3/3): randul strecurat in MC'; END IF;
    PERFORM set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000a', true);
    SELECT string_agg(l.referinta, '; ' ORDER BY l.referinta) INTO s FROM public.fn_rest_decontat_lipsuri_calcul() l WHERE l.proiect_id = pg_temp.rd_id('p8') AND l.tip = 'decontat_um_diferit';
    IF s IS DISTINCT FROM 'O5|D1|X|#1: baza MC, decontat M' THEN RAISE EXCEPTION 't_um_decontat FAIL: lipsurile nu declara UM-ul bazei diferit de cel decontat: %', coalesce(s, 'nimic'); END IF;
    SELECT * INTO r FROM public.fn_rest_decontat_calcul() c WHERE c.proiect_id = pg_temp.rd_id('p8') AND c.cheie = 'O5|D1|X|#1';
    IF r.um IS DISTINCT FROM 'MC' OR r.baza_cantitate <> 100 OR r.decontat_cantitate <> 80 OR r.um_incert IS NOT TRUE THEN
      RAISE EXCEPTION 't_um_decontat FAIL: calculul prezinta 80 M decontati ca rest in MC fara um_incert: %', row_to_json(r);
    END IF;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RAISE EXCEPTION 'UM_GATA' USING ERRCODE = 'P0999';   -- anuleaza sub-blocul: garda revine, randul e iar in M
  EXCEPTION WHEN SQLSTATE 'P0999' THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000a', true);
  IF (SELECT t.tgenabled FROM pg_trigger t WHERE t.tgrelid = 'public.proiect_articole'::regclass AND t.tgname = 'trg_rest_decontat_articole_garda') IS DISTINCT FROM 'O'
     OR (SELECT um FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p8') AND cheie = 'O5|D1|X|#1' AND activ) IS DISTINCT FROM 'M'
     OR EXISTS (SELECT 1 FROM public.fn_rest_decontat_lipsuri_calcul() l WHERE l.tip = 'decontat_um_diferit')
     OR (SELECT c.um_incert FROM public.fn_rest_decontat_calcul() c WHERE c.proiect_id = pg_temp.rd_id('p8') AND c.cheie = 'O5|D1|X|#1') IS NOT FALSE THEN
    RAISE EXCEPTION 't_um_decontat FAIL: sub-blocul nu s-a anulat (garda / randul / lipsurile / um_incert)';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 't_um_decontat (3/3) ok: randul bazei strecurat in MC (garda scoasa) peste 80 M decontati e declarat (decontat_um_diferit: baza MC, decontat M) si marcat um_incert in calcul; sub-blocul anulat';
END $t$;

SELECT 'DRY_COMPLET' AS rezultat;
ROLLBACK;
