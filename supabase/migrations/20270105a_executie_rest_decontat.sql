-- Version 20270105120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 15000 --plafon-extins --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20270105a_executie_rest_decontat.l15.tsv (DOAR cu plafonul EXTINS — decizia proprietarului 22.11.2026: pe producție pasul
--   „înainte” singur a durat ~1,5 s și plafonul 5000 n-a încăput; opțiunea --plafon-extins cere fereastra orară, docs/LIVRARE_L15_V2.md §9 —
--   ȘI cu amprenta globală L15 v2, ca 20261231a; manifestul se
--   generează pe clonă cu scripts/livrare_l15_manifest.sh). Lista OBIECTELOR revizuită (familie, etichetă, operație; verificată pe PGlite cu
--   pașii reali ai runnerului): supabase/tests/20270105a_executie_rest_decontat.l15.obiecte.tsv.
-- 20270105a_executie_rest_decontat — Execuție: „Rest de decontat” (bani și cantități) pe proiect / obiect / articol. Spec:
--   docs/superpowers/specs/2026-11-21-rest-de-decontat-design.md; plan: docs/superpowers/plans/2026-11-21-rest-de-decontat.md (Task 1).
--   Formula: rest = (ofertă + NR/NCS nelegate + acte adiționale) − situațiile de lucrări confirmate.
-- Ce face:
--   * executie_note_modificare: notele de renunțare (NR) / comandă suplimentară (NCS), cu legătura opțională la actul adițional care le preia.
--   * proiect_articole + coloanele: cheie (identitatea articolului: obiect | deviz | cod [| nr], calculată în BD), nota_id, act_aditional_id,
--     mod_import ('diferente' / 'lista_completa'), activ, fisier_amprenta (sha256 al fișierului confirmat), confirmat_de / confirmat_la, tip_rand
--     ('articol' / 'os' / 'diverse'). Rândurile existente rămân activ = true și primesc cheia (nr intră în cheie doar când codul se repetă în
--     același document: proiect + sursă + act_nr + obiect + deviz). Politicile existente ale tabelului NU se schimbă (CatalogDevizPanel / Magazie).
--     r8 (review #1158, P1 pe r7: importul vechi prin catalog DUPĂ migrare comasa pozițiile repetate — cheia fără nr pe ambele rânduri): ACEEAȘI regulă a
--     documentului se impune și pe calea veche, în gardă: un rând scris fără cheie al cărui cod canonic există deja în același document primește poziția
--     (|#nr) și re-cheiază rândurile deja scrise ale grupului (fn_rest_decontat_cheie_document, DEFINER, apelabilă doar din gardă), inclusiv când loturile
--     catalogului (200 de rânduri, cereri separate) taie un grup — rezultatul e identic cu importul de dinaintea migrării + backfill.
--   * executie_sl_detaliu + executie_sl_detaliu_linii: situațiile de lucrări DETALIATE (pe articol), o versiune activă pe (proiect, nr. situație),
--     fiecare cu amprenta fișierului; scrise DOAR prin RPC (clienții au doar SELECT).
--   * executie_proiecte + configurare_completa_la / configurare_exceptie_motiv (folosite de 20270105b: poarta „în configurare”).
--   * fn_rest_decontat_drept (O SINGURĂ definiție a dreptului, L19): citire = owner, managerul proiectului (executie_proiecte.mp_employee_id =
--     profiles.employee_id) sau sub-modulul 'executie_rest_decontat' (orice nivel); confirmare = owner, MP, sub-modul editor / admin;
--     documente_baza = confirmare + responsabilul de contracte al proiectului (responsabil_contracte_externe_id). Accesul general 'executie'
--     NU dă citire. Niciun drept nu e acordat de migrare. r2 (review #1158): dreptul respectă și RESTRICȚIA PE PROIECT existentă
--     (20261209a, aplicată pe producție 11.11.2026): fn_executie_proiect_permis(proiect, scriere) — citire = lista de citire, confirmare /
--     documente_baza = lista de SCRIERE; un cont restrâns (rânduri în executie_acces_proiect) vede / scrie doar proiectele lui, și prin
--     funcțiile SECURITY DEFINER de aici (calcul, vederi, RPC-uri), fiindcă toate trec prin fn_rest_decontat_drept.
--   * fn_rest_decontat_confirma_baza (ofertă / deviz AA / deviz NR-NCS, o tranzacție, cheia calculată în BD, refuz la amprentă deja confirmată,
--     la re-importul unui obiect confirmat fără p_inlocuieste și la al doilea deviz al aceluiași act) și fn_rest_decontat_confirma_situatie (refuz fără ofertă, la nr. existent fără
--     „înlocuiește”, la aceeași amprentă, la UM diferit de UM-ul cheii, la diferență față de situația de plată peste prag fără acceptare explicită).
--   * Calculul: fn_rest_decontat_baza_calcul / fn_rest_decontat_calcul / fn_rest_decontat_obiect_calcul / fn_rest_decontat_lipsuri_calcul
--     (SECURITY DEFINER, filtrate pe fn_rest_decontat_drept(…, 'citire')) + vederile v_executie_rest_decontat_baza / v_executie_rest_decontat /
--     v_executie_rest_decontat_obiect / v_executie_rest_decontat_lipsuri (security_invoker peste funcții, ca v_executie_tinte din 20261208a:
--     proiect_articole / executie_situatii_plata au RLS-ul general al Execuției, pe care MP-ul / directorul financiar pot să nu-l aibă).
--     Regula fără dublare (deciziile chat-ului, 21.11.2026, r2): contract_initial + NR/NCS APROBATE (data_aprobare completată) și NELEGATE
--     de un AA activ CU deviz confirmat (un AA fără deviz nu preia încă nimic — altfel baza ar scădea tăcut între legare și încărcarea
--     devizului) + rândurile AA-urilor active. „Ultimul act” = actul cu DATA DOCUMENTULUI cea mai recentă (data_semnare la AA, data_aprobare
--     la note; oferta și rândurile fără dată = cele mai vechi), la egalitate momentul confirmării, apoi id — NU momentul încărcării: așa
--     prețul unitar vine din ultimul act, iar un AA „listă completă” ignoră, pe obiectele atinse, rândurile celorlalte documente DATATE
--     înaintea lui (o încărcare târzie a unui act vechi nu „câștigă”). Obiectul se compară pe identitatea canonică a cheii (trim, majuscule,
--     spații reduse), nu pe obiect_cod brut. Cantitățile se adună doar pe articol (UM normalizat prin fn_rest_decontat_um: „100 MC” = 100 ×
--     MC, „HM” = 100 × M); pe obiect / proiect doar bani. Restul negativ („peste ofertă”) rămâne negativ și e semnalat, nu tăiat la zero.
--     Sursa 'extras_materiale' nu e ofertă: nu intră în bază.
--   * CE INTRĂ ÎN BAZĂ, PE SURSĂ (r3, review #1158 — O SINGURĂ definiție: fn_rest_decontat_sursa_autorizata, folosită de CHECK, gardă, calcul, lipsuri):
--     - contract_initial: rândurile active, confirmate prin RPC SAU încărcate pe calea veche (CatalogDevizPanel, accesul general Execuție, politicile
--       existente ale tabelului) — decizia chat-ului: calea veche a ofertei rămâne pe proiectele FĂRĂ ofertă confirmată; coloanele de proveniență
--       le scrie doar RPC-ul. STĂRILE OFERTEI, PE OBIECT (r4 → r5, review #1158: P1 r3 reimportul vechi dubla baza confirmată; P1 r4 regula pe
--       proiect retrăgea obiectele neimportate și lăsa rândurile retrase vizibile consumatorilor vechi — decizia chat-ului 21.11.2026: starea e pe
--       OBIECT = proiect + identitatea canonică a obiectului, fn_rest_decontat_cheie(obiect_cod, NULL, NULL, NULL); O SINGURĂ definiție,
--       fn_rest_decontat_obiect_confirmat(proiect, obiect), folosită de gardă, RPC, calcul, lipsuri): un obiect e FIE (a) „vechi” (rânduri
--       contract_initial fără confirmat_la, ex. cele 4 obiecte ale proiectului 4 cu 284 de rânduri — CatalogDevizPanel le gestionează ca azi), FIE
--       (b) „confirmat” prin RPC (există cel puțin un rând contract_initial confirmat al obiectului, activ sau nu, în proiect_articole SAU în istoric:
--       starea e definitivă). Calculul ia, pe fiecare obiect, rândurile confirmate dacă există, altfel cele vechi. Garda refuză scrierea veche
--       (INSERT / UPDATE / DELETE / reparentare directă a rândurilor contract_initial) DOAR pe obiectele confirmate (42501, mesaj clar); obiectele vechi
--       ale aceluiași proiect rămân pe calea veche. Calculul ignoră oricum rândurile contract_initial neconfirmate ale unui obiect confirmat (apărare
--       dublă), lipsurile le declară ('oferta_veche_neconfirmata'); obiectele încă vechi apar în lipsuri ('oferta_neconfirmata', L12).
--       Trecerea (a) -> (b) se face DOAR prin fn_rest_decontat_confirma_baza, care înlocuiește DOAR obiectele din documentul importat: rândurile lor
--       contract_initial (vechi; și cele confirmate, doar cu p_inlocuieste = true — re-importul unui obiect confirmat fără „înlocuiește” = 23505) sunt
--       MUTATE în proiect_articole_istoric (rândul întreg ca jsonb + cine / când / de ce), în aceeași tranzacție, sub advisory-ul proiectului — fără
--       cumulare și FĂRĂ rânduri retrase rămase în proiect_articole: cititorii vechi ai tabelului (ActivitatiProiectPanel, verificariProiect,
--       fn_executie_tinte_calcul din 20261208a, CatalogDevizPanel, DevizVsExecutatTab, 20270105b) văd după confirmare EXACT același număr de rânduri
--       și aceleași valori ca înainte (284 → 284), nu 568. Un obiect neimportat rămâne neatins (în bază cu valoarea veche, declarat în lipsuri) și se
--       poate confirma mai târziu. Garda ia același advisory (try, NOWAIT) înaintea verificării stării, ca un import vechi concurent cu RPC-ul să nu
--       strecoare rânduri (ocupat = 55P03, nimic scris);
--     - act_aditional: DOAR rândurile cu act_aditional_id (actul proiectului, activ) ȘI confirmat_la (scrise de fn_rest_decontat_confirma_baza);
--       calea veche „Act adițional” din CatalogDevizPanel (act_nr fără legătură) este REFUZATĂ de gardă + CHECK (devizul AA se confirmă prin RPC);
--     - nota_renuntare / nota_comanda_suplimentara: DOAR rândurile cu nota_id (nota proiectului, activă, APROBATĂ, nepreluată de un AA activ cu
--       deviz) ȘI confirmat_la; scrierea directă (INSERT sau schimbarea sursei unui rând existent către ele) = refuz;
--     - extras_materiale / orice altă sursă / sursă NULL: niciodată în bază (nu sunt ofertă); calea veche (Magazie / extras) neschimbată.
--     Un rând al surselor cu flux (AA / NR / NCS) fără legătură sau neconfirmat nu poate exista (CHECK proiect_articole_rd_legaturi_ck + gardă);
--     dacă ar ajunge totuși în tabel, calculul NU îl numără și lipsurile îl declară ('rand_neautorizat') — apărare în adâncime, L12 / L18.
--   * proiect_articole_istoric (r5): rândurile ofertei înlocuite de RPC (vechi la prima confirmare a obiectului, confirmate la „înlocuiește”),
--     rândul întreg ca jsonb + obiectul canonic, sursa, confirmat_la, retras_de / retras_la / motiv / amprenta fișierului care le-a înlocuit;
--     scris DOAR de RPC (gardă cu marcaj), citit cu dreptul de citire al proiectului; serverul îl poate goli (decizie separată).
--   * r6 (review #1158: 2 × P1 + P2 pe r5; deciziile chat-ului, 21.11.2026), în fn_rest_decontat_confirma_baza:
--     (1) UM-ul se validează ÎNAINTE de retragerea rândurilor vechi, față de baza ANTERIOARĂ (cu rândurile obiectelor care se înlocuiesc) ȘI față de
--         DECONTATUL existent (liniile situațiilor active pe cheie). Pe o cheie cu cantități decontate UM-ul normalizat NU se poate schimba (22023, mesaj cu
--         cheia, UM-ul vechi, UM-ul nou — „um_decontat”: 100 M → situație 80 M → înlocuire 100 MC = refuz). Pe o cheie fără decontat schimbarea e permisă
--         doar echivalentă prin factor (același UM normalizat: 100 M ↔ 1 HM) sau cu accept_schimbare_um = true explicit în obiectul p_linii (altfel 22023,
--         „um_schimbat”); cheile schimbate cu acceptare se întorc în rezultat (um_schimbate).
--     (2) REPREZENTAREA EXISTENTĂ pentru cititorii vechi — r7 (review #1158, 2 × P1 pe r6: codul brut putea schimba țintele prefixelor, forma „majoritară pe
--         obiect” putea scoate un rând din ținta unei unități; decizia chat-ului 21.11.2026: regula e PE CHEIE, PE FIECARE CÂMP, nu pe obiect): pentru fiecare
--         linie a cărei cheie canonică există deja în rândurile proiectului (toate sursele bazei, active sau nu — tot ce văd cititorii —, inclusiv rândurile
--         care se vor înlocui), rândul confirmat copiază EXACT forma brută a tuturor câmpurilor citite de cititorii existenți din rândul cu aceeași cheie:
--         obiect_cod, deviz_cod, cod (identitatea: o singură formă pe cheie), nr (r8: forma unică a rândurilor cheii, orice poziție — vezi (4); în r7 era
--         luată doar de la rândurile cu aceeași poziție), um (din rândul cu același UM normalizat) — cu cantitatea și prețul unitar convertite în acel UM prin factor (1 HM → 100 M;
--         2 MC pe o cheie în „100 MC” → 0.02; nereprezentabil exact în 6 zecimale = refuz, „um_nereprezentabil”, nu rotunjire tăcută). Dacă aceeași cheie
--         are în rândurile existente MAI MULTE forme brute diferite într-unul din cele trei grupuri (ambiguitate), RPC-ul REFUZĂ înaintea oricărei retrageri
--         (22023 „forme_multiple”, cu cheia și formele găsite); la fel dacă forma scrisă ar muta o legătură existentă din proiect_unitati (20261208a: JOIN pe art.obiect_cod =
--         u.obiect_cod brut; 22023 „legatura_unitate”). O cheie NOUĂ (fără rând existent) se scrie cum vine, normalizată (trim, spațiile multiple reduse la
--         unul, literele neschimbate); obiect_cod-ul ei = forma existentă a obiectului când rândurile lui au o singură formă, altfel a unității din
--         proiect_unitati, altfel cum vine (normalizat). Doar UM-ul schimbat ACCEPTAT se scrie cum vine. Astfel ActivitatiProiectPanel, verificariProiect,
--         20261208a / v_executie_tinte, DevizVsExecutatTab, CatalogDevizPanel dau EXACT același rezultat înainte / după confirmarea unor date echivalente
--         (testul de proprietate: scripts/pglite/test_executie_rest_decontat_local.mjs §8, pe transformări echivalente generate).
--     (3) Amprenta fișierului se caută și în istoric (rândurile retrase, rand->>'fisier_amprenta'), sub același advisory: A → B → A = 23505.
--     (4) r8 (review #1158, P2 pe r7: nr era luat doar de la rândurile cu aceeași poziție, iar o poziție nouă se scria): regula r7 se aplică INTEGRAL și
--         poziției, deși ea nu participă la identitatea cheii — formele nr ale TUTUROR rândurilor cheii (orice poziție): mai multe = 22023 forme_multiple
--         (inclusiv poziții diferite stocate sub aceeași cheie), înaintea oricărei retrageri; exact una = copiată exact, iar o linie care vine cu ALTĂ
--         poziție (canonic diferită) = 22023 nr_schimbat (poziția unei chei existente nu se schimbă la confirmare; linia fără nr o copiază pe cea existentă).
--   * r9 (review #1158, 2 × P1 pe r8: re-cheierea pe calea veche și RPC-ul schimbau identitatea unei chei cu decontat confirmat — decontatul rămânea pe cheia
--     veche, fără obiect / UM, articolul arăta 0 decontat). Decizia chat-ului (21.11.2026), regula GENERALĂ: (1) O CHEIE REFERITĂ E ÎNGHEȚATĂ — din momentul
--     în care o cheie are cel puțin o linie într-o situație detaliată ACTIVĂ (definiția unică fn_rest_decontat_chei_referite / fn_rest_decontat_cheie_situatii),
--     nicio operație nu-i mai schimbă identitatea: garda proiect_articole refuză (23514 cheie_referita, cu cheia, situațiile și ce ar fi devenit) orice UPDATE
--     care schimbă cheia unui rând referit — re-cheierea grupului repetat pe calea veche (fn_rest_decontat_cheie_document, INSERT-ul rândului nou pică întreg),
--     schimbarea directă a codului / obiectului / devizului, cheia dată explicit, și serverul; RPC-ul fn_rest_decontat_confirma_baza păstrează identitatea
--     referită ÎNAINTEA regulii poziției: linia cu poziția #n a unei chei referite primește #n chiar dacă codul nu se mai repetă, linia fără poziție primește
--     unica cheie referită a identității ei, iar tranzițiile ambigue (codul se repetă acum dar situațiile stau pe cheia fără poziție; linia fără poziție cu mai
--     multe chei referite) sunt refuzate (22023 cheie_referita) înaintea oricărei scrieri. (2) FĂRĂ DECONTAT ORFAN TĂCUT: dispariția BAZEI unei chei referite
--     (înlocuire fără linia ei, listă completă AA care n-o mai conține, AA / notă dezactivate, rândul vechi șters / retras / mutat pe calea veche) nu e
--     identitate schimbată și nu se refuză, dar lipsurile o declară pe cheie (decontat_fara_articol: valoarea, liniile, situațiile) și RPC-ul o întoarce
--     (decontat_fara_baza); calculul ține decontatul în totaluri. (3) Backfill-ul migrării nu poate atinge o cheie referită: tabelele situațiilor sunt goale
--     (postcondiție). Căile, gărzile și testele fiecăreia: supabase/tests/20270105a_executie_rest_decontat_dryrun.sql, blocurile t_cheie_referita (1/4)–(4/4).
--   * r10 (review #1158, P1 + P2 pe r9). (1) P1: validarea UM-ului față de DECONTAT era doar la ofertă (contract_initial); pentru AA / NR / NCS se compara doar
--     cu UM-ul bazei / rândurilor existente, deci după dispariția bazei (articolul șters pe calea veche, înlocuit, scos de o listă completă) un deviz AA refăcea
--     baza în MC peste 80 M decontați, fără semnal (um_incert fals, decontat_fara_articol stins). Acum O SINGURĂ validare (L19), fn_rest_decontat_um_decontat_diferit
--     (proiect, cheie, UM) — UM-urile normalizate ale liniilor situațiilor ACTIVE pe cheie care diferă de UM-ul liniei; gol = compatibil —, folosită de TOATE căile
--     prin care o linie de bază nouă ajunge pe o cheie cu decontat: RPC-ul fn_rest_decontat_confirma_baza pentru ORICE sursă (ofertă, deviz AA, NR, NCS, inclusiv
--     când baza a dispărut: 22023 um_decontat), garda proiect_articole la INSERT și la UPDATE-ul care schimbă cheia / UM-ul / activ / sursa / proiectul unui rând al
--     bazei (calea veche a catalogului, serverul, și rândurile RPC-ului — apărare în adâncime; 23514 um_decontat), lipsurile (decontat_um_diferit: o cheie a bazei al
--     cărei UM diferă de cel decontat, dacă un rând ar trece totuși) și calculul (um_incert adevărat pe o astfel de cheie). UM-ul echivalent prin factor (M ↔ ML ↔ HM)
--     trece pe toate căile. Avertizarea decontat_fara_articol nu se stinge prin reatașare cu alt UM: reatașarea e refuzată, nimic scris.
--     (2) P2: linia FĂRĂ poziție care primește unica cheie referită CU poziție (#n) a identității ei, când cheia nu mai are rânduri (articolul e în istoric), se
--     scria cu nr NULL și garda o refuza (cheia nu corespundea câmpurilor): poziția se reconstruiește din cheia referită (forma canonică a poziției, după „|#”),
--     ca rândul scris să poarte identitatea referită; rândurile existente ale cheii (când sunt) își copiază în continuare forma exactă (r7 / r8).
--     Căile → validarea → testele: supabase/tests/20270105a_executie_rest_decontat_dryrun.sql, blocurile t_um_decontat (1/3)–(3/3).
--   * Gărzi BEFORE pe ORICE cale (L07 / L08): rândurile confirmate din proiect_articole nu se modifică / șterg direct, coloanele de
--     confirmare le scrie doar RPC-ul (marcajul static al tranzacției, precedent 20261130l; marcaj LIPSĂ = NULL într-o sesiune nouă = REFUZ,
--     ca și marcajul gol), un rând cu sursă AA / NR / NCS se scrie doar prin RPC, rândurile contract_initial ale unui OBIECT cu oferta confirmată
--     nu se mai ating direct (r4 / r5), cheia e verificată; executie_sl_detaliu* și proiect_articole_istoric se scriu doar prin RPC; notele:
--     autorul / momentul le pune serverul, proiectul nu se schimbă, actul legat e al aceluiași proiect.
--   * RPC-urile reverifică dreptul DUPĂ lock-ul pe proiect (L01: MP-ul schimbat cât apelul aștepta lock-ul e refuzat).
-- Ce NU face: nicio dată (încărcarea Lot 1 e separată, cu „da”-ul owner-ului), niciun drept acordat, nu atinge executie_situatii_plata* /
--   TabSituatiiPlata, nici politicile proiect_articole; poarta proiectului nou (RPC + jurnal) e 20270105b.
-- Dependențe: porțile Izometrie (20261230a: fn_izo_porti_lipsa + cele 5 definiții) — migrarea adaugă coloane pe executie_proiecte (perimetrul
--   E4b), deci face ritualul PRE / ștampile / POST (docs/izometrie/PORTI_REGULA.md); executie_acte_aditionale și executie_situatii_plata există;
--   proiect_unitati.obiect_cod (20261208a; r6: reprezentarea existentă a obiectului o citește și de acolo);
--   20261209a (executie_acces_proiect + fn_executie_proiect_permis / fn_executie_acces_nerestrans, corpurile verificate prin md5 — aceleași
--   constante ca preflight-ul 20261213a —, DEFINER, owner postgres, EXECUTE pentru authenticated).
-- Ordinea lock-urilor (L06): migrarea: executie_proiecte (ACCESS EXCLUSIVE) -> proiect_articole (ACCESS EXCLUSIVE) -> executie_acte_aditionale
--   (SHARE ROW EXCLUSIVE, FK) -> executie_situatii_plata (SHARE ROW EXCLUSIVE, FK). RPC-urile: advisory (proiect) -> executie_proiecte FOR SHARE
--   -> executie_acte_aditionale / executie_situatii_plata FOR SHARE -> executie_note_modificare FOR SHARE -> executie_sl_detaliu FOR UPDATE
--   -> DELETE proiect_articole (rândurile ofertei pe obiectele importate, la trecerea (a) -> (b) / „înlocuiește”) -> INSERT proiect_articole_istoric
--   -> INSERT (proiect_articole | executie_sl_detaliu, executie_sl_detaliu_linii). Trigger-ele nu blochează alte rânduri; garda proiect_articole ia advisory-ul proiectului doar cu
--   pg_try_advisory_xact_lock (BEFORE UPDATE / DELETE au deja rândul blocat: o așteptare acolo ar fi deadlock cu RPC-ul, care ține advisory-ul
--   și apoi ia rândurile vechi) — ocupat = 55P03, nimic scris.
-- Lock la aplicare (punct unic, NOWAIT, bugetul 1 s de la prima încercare, docs/LIVRARE_L15_V2.md §9).
-- GĂRZILE DE TIMP: plafonul tranzacției = 15000 ms (plafonul EXTINS, --plafon-extins, doar în fereastra 21:00–06:00 Europe/Bucharest) pus de
--   runner înainte de BEGIN (verificat în $pre$), lock_timeout = 100 ms, bugetul lock-urilor de 1 s (neschimbat), garda finală.
-- Revenire: supabase/revenire/20270105a_executie_rest_decontat_ROLLBACK.sql. Probe: scripts/pglite/test_executie_rest_decontat_local.mjs,
--   supabase/tests/20270105a_executie_rest_decontat_dryrun.sql (pe clonă: după aplicare, în tranzacție cu ROLLBACK).
DO $pre$
DECLARE v_plafon text; v_tip text; r record; v_n bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270105a_executie_rest_decontat:' || txid_current() THEN
    RAISE EXCEPTION '20270105a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270105a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270105a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270105a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '15000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '15000:' || txid_current() THEN
    RAISE EXCEPTION '20270105a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 15000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 15000 --plafon-extins)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tiparul 20261229b / 20261231a)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20270105a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- dependențele
  IF to_regclass('public.executie_proiecte') IS NULL OR to_regclass('public.proiect_articole') IS NULL OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.user_module_access') IS NULL OR to_regclass('public.executie_acte_aditionale') IS NULL
     OR to_regclass('public.executie_situatii_plata') IS NULL OR to_regclass('public.proiect_unitati') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION '20270105a: tabelele existente (executie_proiecte, proiect_articole, profiles, user_module_access, executie_acte_aditionale, executie_situatii_plata, proiect_unitati) sau auth.uid lipsesc';
  END IF;
  IF to_regprocedure('public.fn_izo_porti_lipsa()') IS NULL OR to_regprocedure('public.fn_izo_porti_definitii()') IS NULL
     OR to_regprocedure('public.fn_izo_porti_e3_definitii()') IS NULL OR to_regprocedure('public.fn_izo_porti_e3b_definitii()') IS NULL
     OR to_regprocedure('public.fn_izo_porti_e4_definitii()') IS NULL OR to_regprocedure('public.fn_izo_porti_e4b_definitii()') IS NULL THEN
    RAISE EXCEPTION '20270105a: portile Izometrie (20261230a: fn_izo_porti_lipsa + cele 5 definitii) lipsesc';
  END IF;
  -- 20261209a (restricția pe proiect): tabelul + predicatele chemate de fn_rest_decontat_drept, cu corpurile revizuite (md5 pe prosrc fără CR,
  -- aceleași constante ca în preflight-ul 20261213a), DEFINER, owner postgres, EXECUTE pentru authenticated (politicile le evaluează ca apelant)
  IF to_regclass('public.executie_acces_proiect') IS NULL
     OR EXISTS (SELECT 1 FROM (VALUES
          ('public.fn_executie_proiect_permis(bigint, boolean)', 'bd4320f76e9f36f492c7186c0a982155'),
          ('public.fn_executie_acces_nerestrans()', 'b863c5324684dbf4eb9af81474fbc4e1')) a(semnatura, amprenta)
        LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
        WHERE p.oid IS NULL OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta OR p.prosecdef IS NOT TRUE
           OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] OR pg_get_userbyid(p.proowner) <> 'postgres'
           OR has_function_privilege('anon', p.oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION '20270105a: 20261209a (executie_acces_proiect, fn_executie_proiect_permis, fn_executie_acces_nerestrans) lipseste sau are alt corp / securitate / drepturi decat cele revizuite';
  END IF;
  -- IZO PRE: porțile verzi înaintea primei schimbări (executie_proiecte e în perimetrul E4b)
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '20270105a: portile Izometrie nu sunt verzi inainte: %', public.fn_izo_porti_lipsa();
  END IF;
  -- reaplicare = refuz (orice urmă a obiectelor migrării)
  IF to_regclass('public.executie_note_modificare') IS NOT NULL OR to_regclass('public.executie_sl_detaliu') IS NOT NULL
     OR to_regclass('public.executie_sl_detaliu_linii') IS NOT NULL OR to_regclass('public.proiect_articole_istoric') IS NOT NULL
     OR to_regclass('public.v_executie_rest_decontat_baza') IS NOT NULL OR to_regclass('public.v_executie_rest_decontat') IS NOT NULL
     OR to_regclass('public.v_executie_rest_decontat_obiect') IS NOT NULL OR to_regclass('public.v_executie_rest_decontat_lipsuri') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_rest\_decontat\_%')
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.proiect_articole'::regclass AND NOT a.attisdropped
                 AND a.attname IN ('cheie', 'nota_id', 'act_aditional_id', 'mod_import', 'activ', 'fisier_amprenta', 'confirmat_de', 'confirmat_la', 'tip_rand'))
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.executie_proiecte'::regclass AND NOT a.attisdropped
                 AND a.attname IN ('configurare_completa_la', 'configurare_exceptie_motiv'))
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname LIKE 'trg\_rest\_decontat\_%') THEN
    RAISE EXCEPTION '20270105a: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele citite / scrise, cu tipurile acceptate (din catalog, nu ghicite)
  FOR r IN SELECT * FROM (VALUES
      ('executie_proiecte', 'id', 'bigint'), ('executie_proiecte', 'mp_employee_id', 'integer|bigint'),
      ('executie_proiecte', 'responsabil_contracte_externe_id', 'integer|bigint'), ('executie_proiecte', 'activ', 'boolean'),
      ('profiles', 'id', 'uuid'), ('profiles', 'is_owner', 'boolean'), ('profiles', 'employee_id', 'integer|bigint'),
      ('user_module_access', 'profile_id', 'uuid'), ('user_module_access', 'module', 'text|character varying'), ('user_module_access', 'access_level', 'text|character varying'),
      ('proiect_articole', 'id', 'bigint|integer'), ('proiect_articole', 'proiect_id', 'integer|bigint'),
      ('proiect_articole', 'obiect_cod', 'text|character varying'), ('proiect_articole', 'obiect_nume', 'text|character varying'),
      ('proiect_articole', 'deviz_cod', 'text|character varying'), ('proiect_articole', 'deviz_nume', 'text|character varying'),
      ('proiect_articole', 'nr', 'text|character varying|integer'), ('proiect_articole', 'cod', 'text|character varying'),
      ('proiect_articole', 'denumire', 'text|character varying'), ('proiect_articole', 'um', 'text|character varying'),
      ('proiect_articole', 'cantitate', 'numeric|double precision'), ('proiect_articole', 'valoare', 'numeric|double precision'),
      ('proiect_articole', 'pret_unitar', 'numeric|double precision'), ('proiect_articole', 'sursa', 'text|character varying'),
      ('proiect_articole', 'act_nr', 'text|character varying|integer'), ('proiect_articole', 'created_at', 'timestamp with time zone|timestamp without time zone'),
      ('executie_acte_aditionale', 'id', 'bigint|integer'), ('executie_acte_aditionale', 'proiect_id', 'integer|bigint'),
      ('executie_acte_aditionale', 'numar_act', 'text|character varying|integer'), ('executie_acte_aditionale', 'activ', 'boolean'),
      ('executie_situatii_plata', 'id', 'bigint|integer'), ('executie_situatii_plata', 'proiect_id', 'integer|bigint'),
      ('executie_situatii_plata', 'nr_situatie', 'text|character varying'), ('executie_situatii_plata', 'luna', 'integer|smallint'),
      ('executie_situatii_plata', 'an', 'integer|smallint'), ('executie_situatii_plata', 'valoare_baza_lei', 'numeric|double precision'),
      ('proiect_unitati', 'id', 'integer|bigint'), ('proiect_unitati', 'proiect_id', 'integer|bigint'), ('proiect_unitati', 'obiect_cod', 'text|character varying')
    ) v(t, c, tipuri) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR NOT (v_tip = ANY (string_to_array(r.tipuri, '|'))) THEN
      RAISE EXCEPTION '20270105a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tipuri;
    END IF;
  END LOOP;
  -- cheile primare referite de FK-urile noi
  IF NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.executie_acte_aditionale'::regclass AND k.contype = 'p' AND k.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = k.conrelid AND attname = 'id')]::int2[])
     OR NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.executie_situatii_plata'::regclass AND k.contype = 'p' AND k.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = k.conrelid AND attname = 'id')]::int2[])
     OR NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.executie_proiecte'::regclass AND k.contype = 'p' AND k.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = k.conrelid AND attname = 'id')]::int2[]) THEN
    RAISE EXCEPTION '20270105a: cheile primare (id) ale tabelelor referite lipsesc';
  END IF;
  -- RPC-urile (owner postgres) scriu proiect_articole; drepturile verificate pe rând (has_table_privilege cu lista = ORICARE)
  IF NOT has_table_privilege('postgres', 'public.proiect_articole', 'INSERT') OR NOT has_table_privilege('postgres', 'public.proiect_articole', 'UPDATE')
     OR NOT has_table_privilege('postgres', 'public.proiect_articole', 'SELECT') THEN
    RAISE EXCEPTION '20270105a: postgres nu poate scrie / citi proiect_articole';
  END IF;
  -- date live (L14): sursele existente, informativ (toate primesc cheie și rămân active; cele în afara listei de ofertă nu intră în bază)
  FOR r IN SELECT coalesce(a.sursa::text, '-') AS s, count(*) AS n FROM public.proiect_articole a GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE '20270105a: proiect_articole sursa % = % randuri (primesc cheie, raman activ)', r.s, r.n;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.proiect_articole a WHERE a.proiect_id IS NULL;
  IF v_n > 0 THEN RAISE EXCEPTION '20270105a: % randuri proiect_articole fara proiect_id (cheia nu se poate calcula pe document)', v_n; END IF;
  -- L14 înaintea CHECK-ului (r3, review #1158): din această migrare devizele AA / NR / NCS intră în proiect_articole DOAR prin
  -- fn_rest_decontat_confirma_baza (legătură + confirmare, CHECK proiect_articole_rd_legaturi_ck). Rândurile EXISTENTE cu aceste surse (încărcate
  -- pe calea veche, fără legătură) ar pica CHECK-ul → refuz explicit, cu decizie separată (ștergere sau reîncărcare prin RPC după aplicare).
  -- Pe producție (21.11.2026, citit de chat): doar contract_initial (proiectul 4) și extras_materiale (proiectul 25) → trece.
  SELECT count(*) INTO v_n FROM public.proiect_articole a WHERE a.sursa IN ('act_aditional', 'nota_renuntare', 'nota_comanda_suplimentara');
  IF v_n > 0 THEN
    RAISE EXCEPTION '20270105a: % randuri proiect_articole cu sursa act_aditional / nota_renuntare / nota_comanda_suplimentara incarcate pe calea veche (fara legatura si confirmare): din 20270105a aceste surse intra doar prin fn_rest_decontat_confirma_baza — decizie separata inainte (stergere sau reincarcare prin RPC dupa aplicare); nimic schimbat', v_n;
  END IF;
END $pre$;

-- ── lock-urile (punct unic, NOWAIT, bugetul 1 s de la PRIMA încercare; ordinea L06 din antet) ──
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20270105a: BUGET_LOCK: tabelele ocupate; % incercari, % ms de la prima incercare (bugetul e 1 s; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.executie_proiecte IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.proiect_articole IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.executie_acte_aditionale IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.executie_situatii_plata IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20270105a: BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare (% incercari; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20270105a: lock la % ms de la BEGIN (% incercari)', round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari;
END $lock$;

-- ─── 1. executie_proiecte: coloanele poartei „în configurare” (folosite de 20270105b); perimetrul E4b → ritualul porților ────────
ALTER TABLE public.executie_proiecte
  ADD COLUMN configurare_completa_la timestamptz,
  ADD COLUMN configurare_exceptie_motiv text,
  ADD CONSTRAINT executie_proiecte_configurare_motiv_ck CHECK (configurare_exceptie_motiv IS NULL
    OR (configurare_completa_la IS NOT NULL AND configurare_exceptie_motiv ~ '[^[:space:]]' AND length(configurare_exceptie_motiv) <= 2000));
COMMENT ON COLUMN public.executie_proiecte.configurare_completa_la IS 'Rest de decontat (20270105a): NULL = proiect „în configurare” (fără oferta financiară încărcată); pus de fn_executie_proiect_configurare_completa (20270105b).';
COMMENT ON COLUMN public.executie_proiecte.configurare_exceptie_motiv IS 'Rest de decontat (20270105a): motivul scris de owner când configurarea e declarată completă FĂRĂ ofertă (excepție jurnalizată, 20270105b).';

-- ─── 2. funcțiile pure: cheia articolului și normalizarea UM (L19: o singură definiție; ecranul doar le oglindește) ─────────────
-- cheia = obiect | deviz | cod [| #nr], fiecare parte trim + majuscule + spațiile multiple reduse la unul; nr intră doar când apelantul îl dă
CREATE FUNCTION public.fn_rest_decontat_cheie(p_obiect text, p_deviz text, p_cod text, p_nr text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT upper(btrim(regexp_replace(coalesce(p_obiect, ''), '[[:space:]]+', ' ', 'g'))) || '|'
      || upper(btrim(regexp_replace(coalesce(p_deviz, ''), '[[:space:]]+', ' ', 'g'))) || '|'
      || upper(btrim(regexp_replace(coalesce(p_cod, ''), '[[:space:]]+', ' ', 'g')))
      || CASE WHEN p_nr IS NULL THEN '' ELSE '|#' || upper(btrim(regexp_replace(p_nr, '[[:space:]]+', ' ', 'g'))) END
$f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_cheie(text, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_cheie(text, text, text, text) TO authenticated;

-- UM-ul normalizat + factorul spre unitatea de bază (aceeași listă ca fn_executie_tinte_conversie din 20261208a, blocul UM-START / UM-END;
-- testul PGlite verifică paritatea textuală). UM necunoscut = el însuși (majuscule, fără spații / puncte), factor 1.
CREATE FUNCTION public.fn_rest_decontat_um(p_um text) RETURNS TABLE (um text, factor numeric)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  WITH n AS (SELECT upper(regexp_replace(coalesce(p_um, ''), '[[:space:].]', '', 'g')) AS u),
  l AS (SELECT * FROM (VALUES
    -- UM-START
    ('M', 1, 'M'), ('ML', 1, 'M'), ('HM', 100, 'M'), ('KM', 1000, 'M'), ('100M', 100, 'M'),
    ('MC', 1, 'MC'), ('M3', 1, 'MC'), ('100MC', 100, 'MC'), ('1000MC', 1000, 'MC'),
    ('MP', 1, 'MP'), ('M2', 1, 'MP'), ('100MP', 100, 'MP'), ('HA', 10000, 'MP'),
    ('BUC', 1, 'BUC'), ('100BUC', 100, 'BUC'), ('KG', 1, 'KG'), ('T', 1000, 'KG'), ('TO', 1000, 'KG'), ('100KG', 100, 'KG')
    -- UM-END
  ) v(u, m, b))
  SELECT coalesce(l.b, n.u), coalesce(l.m, 1)::numeric FROM n LEFT JOIN l ON l.u = n.u
$f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_um(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_um(text) TO authenticated;

-- rândul unei surse e „autorizat” să intre în bază? (r3, review #1158; L19: O SINGURĂ definiție, chemată de CHECK-ul tabelului, de gardă, de
-- calcul și de lipsuri): devizul unui AA cere actul ȘI confirmarea RPC-ului; devizul unei NR / NCS cere nota ȘI confirmarea; oferta
-- (contract_initial), extras_materiale și orice altă sursă nu au o condiție aici (oferta intră în bază și pe calea veche — decizia chat-ului —,
-- celelalte nu intră deloc). Pură, IMMUTABLE; EXECUTE pentru authenticated fiindcă CHECK-ul și trigger-ul rulează ca apelantul.
CREATE FUNCTION public.fn_rest_decontat_sursa_autorizata(p_sursa text, p_nota_id bigint, p_act_aditional_id bigint, p_confirmat_la timestamptz) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE
    WHEN p_sursa = 'act_aditional' THEN p_act_aditional_id IS NOT NULL AND p_confirmat_la IS NOT NULL
    WHEN p_sursa IN ('nota_renuntare', 'nota_comanda_suplimentara') THEN p_nota_id IS NOT NULL AND p_confirmat_la IS NOT NULL
    ELSE true END
$f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_sursa_autorizata(text, bigint, bigint, timestamptz) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_sursa_autorizata(text, bigint, bigint, timestamptz) TO authenticated;

-- ─── 3. dreptul: O SINGURĂ definiție (RLS, RPC-uri, calcul, ecran). Răspunde doar despre apelant; „nu există” = „nu ai voie” = fals ─────
-- Restricția pe proiect (20261209a) se aplică ÎNAINTEA dreptului de modul: citire = lista de citire a contului, confirmare / documente_baza =
-- lista de SCRIERE (nivel 'editor' pe proiect); contul nerestrâns și owner-ul trec (fn_executie_proiect_permis răspunde adevărat).
CREATE FUNCTION public.fn_rest_decontat_drept(p_proiect bigint, p_nivel text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_nivel IN ('citire', 'confirmare', 'documente_baza')
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND public.fn_executie_proiect_permis(p_proiect, p_nivel <> 'citire') IS TRUE
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.profiles p JOIN public.executie_proiecte e ON e.id = p_proiect
                     WHERE p.id = auth.uid() AND p.employee_id IS NOT NULL
                       AND (p.employee_id::bigint = e.mp_employee_id::bigint
                            OR (p_nivel = 'documente_baza' AND p.employee_id::bigint = e.responsabil_contracte_externe_id::bigint)))
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie_rest_decontat'
                       AND (p_nivel = 'citire' OR u.access_level IN ('editor', 'admin'))))
$f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_drept(bigint, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_drept(bigint, text) TO authenticated;

-- calea serverului (psql / runner ca postgres, fără JWT): o funcție DEFINER chemată prin API fără JWT are session_user = authenticator
CREATE FUNCTION public.fn_rest_decontat_server() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NULL AND session_user = 'postgres' AND current_user = 'postgres'
$f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_server() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_server() TO authenticated;

-- actul adițional e al proiectului (verificare din trigger, ca DEFINER: responsabilul de contracte poate să nu citească executie_acte_aditionale);
-- răspunde adevărat doar unui apelant cu drept pe documentele de bază ale proiectului (fără oracol pe alte proiecte)
CREATE FUNCTION public.fn_rest_decontat_aa_al_proiectului(p_act bigint, p_proiect bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT public.fn_rest_decontat_drept(p_proiect, 'documente_baza')
    AND EXISTS (SELECT 1 FROM public.executie_acte_aditionale a WHERE a.id::bigint = p_act AND a.proiect_id::bigint = p_proiect)
$f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_aa_al_proiectului(bigint, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_aa_al_proiectului(bigint, bigint) TO authenticated;

-- ─── 4. notele NR / NCS ──────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.executie_note_modificare (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  tip text NOT NULL,
  numar text NOT NULL,
  data_aprobare date,
  act_aditional_id bigint REFERENCES public.executie_acte_aditionale(id),
  descriere text,
  fisier_path text,
  activ boolean NOT NULL DEFAULT true,
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_note_modificare_tip_ck CHECK (tip IN ('NR', 'NCS')),
  CONSTRAINT executie_note_modificare_numar_ck CHECK (numar ~ '[^[:space:]]' AND length(numar) <= 80),
  CONSTRAINT executie_note_modificare_data_ck CHECK (data_aprobare IS NULL OR data_aprobare BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  CONSTRAINT executie_note_modificare_fisier_ck CHECK (fisier_path IS NULL OR length(fisier_path) BETWEEN 1 AND 1000)
);
CREATE UNIQUE INDEX executie_note_modificare_numar_uq ON public.executie_note_modificare (proiect_id, tip, numar) WHERE activ;
CREATE INDEX executie_note_modificare_aa_ix ON public.executie_note_modificare (act_aditional_id) WHERE act_aditional_id IS NOT NULL;
COMMENT ON TABLE public.executie_note_modificare IS
  'Rest de decontat (20270105a): notele de renunțare (NR) / comandă suplimentară (NCS) ale unui proiect; act_aditional_id = actul care le preia (baza le numără o singură dată). Devizul lor: proiect_articole.nota_id.';

-- ─── 5. proiect_articole: coloanele bazei (identitate, proveniență, legături) ──────────────────────────────────────────────────
ALTER TABLE public.proiect_articole
  ADD COLUMN cheie text,
  ADD COLUMN nota_id bigint REFERENCES public.executie_note_modificare(id),
  ADD COLUMN act_aditional_id bigint REFERENCES public.executie_acte_aditionale(id),
  ADD COLUMN mod_import text,
  ADD COLUMN activ boolean NOT NULL DEFAULT true,
  ADD COLUMN fisier_amprenta text,
  ADD COLUMN confirmat_de uuid,
  ADD COLUMN confirmat_la timestamptz,
  ADD COLUMN tip_rand text NOT NULL DEFAULT 'articol',
  ADD CONSTRAINT proiect_articole_rd_mod_import_ck CHECK (mod_import IS NULL OR mod_import IN ('diferente', 'lista_completa')),
  ADD CONSTRAINT proiect_articole_rd_tip_rand_ck CHECK (tip_rand IN ('articol', 'os', 'diverse')),
  ADD CONSTRAINT proiect_articole_rd_amprenta_ck CHECK (fisier_amprenta IS NULL OR fisier_amprenta ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT proiect_articole_rd_confirmat_ck CHECK ((confirmat_de IS NULL) = (confirmat_la IS NULL) AND (fisier_amprenta IS NULL OR confirmat_la IS NOT NULL)),
  -- legăturile: o notă doar la sursele NR / NCS, un act doar la act_aditional, nu amândouă; ȘI (r3) un rând AA / NR / NCS există DOAR cu
  -- legătura și confirmarea (fn_rest_decontat_sursa_autorizata): rândul orfan / neconfirmat al acestor surse e refuzat structural, pe orice cale
  ADD CONSTRAINT proiect_articole_rd_legaturi_ck CHECK ((nota_id IS NULL OR sursa IN ('nota_renuntare', 'nota_comanda_suplimentara'))
    AND (act_aditional_id IS NULL OR sursa = 'act_aditional') AND (nota_id IS NULL OR act_aditional_id IS NULL)
    AND public.fn_rest_decontat_sursa_autorizata(sursa, nota_id, act_aditional_id, confirmat_la));
-- rândurile existente: cheia pe document (nr intră doar când codul normalizat se repetă în același document); activ = true (implicit)
UPDATE public.proiect_articole a
   SET cheie = public.fn_rest_decontat_cheie(a.obiect_cod::text, a.deviz_cod::text, a.cod::text, CASE WHEN d.n > 1 THEN a.nr::text END)
  FROM (SELECT x.proiect_id, x.sursa, coalesce(x.act_nr::text, '') AS act_nr,
               public.fn_rest_decontat_cheie(x.obiect_cod::text, x.deviz_cod::text, x.cod::text, NULL) AS k, count(*) AS n
          FROM public.proiect_articole x GROUP BY 1, 2, 3, 4) d
 WHERE d.proiect_id = a.proiect_id AND d.sursa IS NOT DISTINCT FROM a.sursa AND d.act_nr = coalesce(a.act_nr::text, '')
   AND d.k = public.fn_rest_decontat_cheie(a.obiect_cod::text, a.deviz_cod::text, a.cod::text, NULL);
ALTER TABLE public.proiect_articole ALTER COLUMN cheie SET NOT NULL;
CREATE INDEX proiect_articole_rd_cheie_ix ON public.proiect_articole (proiect_id, cheie) WHERE activ;
CREATE INDEX proiect_articole_rd_aa_ix ON public.proiect_articole (act_aditional_id) WHERE act_aditional_id IS NOT NULL;
CREATE INDEX proiect_articole_rd_nota_ix ON public.proiect_articole (nota_id) WHERE nota_id IS NOT NULL;
COMMENT ON COLUMN public.proiect_articole.cheie IS 'Identitatea articolului în bază / decontat: fn_rest_decontat_cheie(obiect, deviz, cod[, nr]); calculată în BD (trigger / RPC). 20270105a.';
COMMENT ON COLUMN public.proiect_articole.mod_import IS 'Deviz AA: diferente (se adună cu semn) / lista_completa (înlocuiește, pe obiectele atinse, rândurile confirmate înainte). 20270105a.';
COMMENT ON COLUMN public.proiect_articole.activ IS 'Rândul intră în bază (false = retras, rămâne istoric). 20270105a.';
COMMENT ON COLUMN public.proiect_articole.fisier_amprenta IS 'sha256 al fișierului confirmat prin fn_rest_decontat_confirma_baza (o reconfirmare a aceluiași fișier = refuz). 20270105a.';
COMMENT ON COLUMN public.proiect_articole.tip_rand IS 'articol / os (organizare de șantier) / diverse (diverse și neprevăzute): rândurile speciale ale centralizatorului. 20270105a.';

-- proiectul are oferta financiară (rânduri contract_initial active, confirmate prin RPC sau încărcate înainte): aceeași definiție pentru RPC-uri,
-- lipsuri și poarta din 20270105b; răspunde doar cui poate citi proiectul sau îi poate încărca documentele
CREATE FUNCTION public.fn_rest_decontat_are_oferta(p_proiect bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT (public.fn_rest_decontat_drept(p_proiect, 'citire') OR public.fn_rest_decontat_drept(p_proiect, 'documente_baza'))
    AND EXISTS (SELECT 1 FROM public.proiect_articole a WHERE a.proiect_id::bigint = p_proiect AND a.sursa = 'contract_initial' AND a.activ)
$f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_are_oferta(bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_are_oferta(bigint) TO authenticated;

-- ─── 5b. istoricul rândurilor ofertei înlocuite de RPC (r5, review #1158 P1 r4: rândurile retrase NU mai rămân în proiect_articole, ca cititorii
-- vechi ai tabelului să nu-și schimbe rezultatul la confirmare). Rândul întreg (to_jsonb) + identitatea canonică a obiectului, sursa și confirmat_la
-- (pentru starea definitivă a obiectului), cine / când / de ce l-a înlocuit și amprenta fișierului nou. Scris DOAR de fn_rest_decontat_confirma_baza
-- (gardă cu marcaj); UPDATE niciodată; DELETE doar serverul (decizie separată); clienții citesc cu dreptul de citire al proiectului. ────────────
CREATE TABLE public.proiect_articole_istoric (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  rand_id bigint NOT NULL,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  obiect_k text NOT NULL,
  sursa text,
  confirmat_la timestamptz,
  rand jsonb NOT NULL,
  retras_de uuid NOT NULL,
  retras_la timestamptz NOT NULL DEFAULT now(),
  motiv text NOT NULL,
  inlocuit_cu_amprenta text,
  CONSTRAINT proiect_articole_istoric_motiv_ck CHECK (motiv IN ('confirmare_oferta', 'inlocuire_oferta')),
  CONSTRAINT proiect_articole_istoric_amprenta_ck CHECK (inlocuit_cu_amprenta IS NULL OR inlocuit_cu_amprenta ~ '^[0-9a-f]{64}$'),
  CONSTRAINT proiect_articole_istoric_rand_ck CHECK (jsonb_typeof(rand) = 'object')
);
CREATE INDEX proiect_articole_istoric_obiect_ix ON public.proiect_articole_istoric (proiect_id, obiect_k);
-- r6 (P2): amprenta fișierului unui rând retras se caută la fiecare confirmare (A → B → A = refuz)
CREATE INDEX proiect_articole_istoric_amprenta_ix ON public.proiect_articole_istoric (proiect_id, (rand->>'fisier_amprenta'));
COMMENT ON TABLE public.proiect_articole_istoric IS
  'Rest de decontat (20270105a): rândurile proiect_articole ale ofertei înlocuite de fn_rest_decontat_confirma_baza (rândul întreg în rand); obiect_k = fn_rest_decontat_cheie(obiect_cod, NULL, NULL, NULL). Un rând confirmat aici ține obiectul în starea „confirmat”.';

-- STAREA OFERTEI, PE OBIECT (r4 → r5, review #1158): obiectul (proiect + identitatea canonică a obiectului) are oferta CONFIRMATĂ prin RPC? = există
-- cel puțin un rând contract_initial cu confirmat_la al obiectului, activ sau nu, în proiect_articole SAU în proiect_articole_istoric (starea e
-- definitivă: nici retragerea, nici înlocuirea, nici scoaterea rândurilor de către server nu redeschid calea veche pe obiect). (a) fals = obiect
-- „vechi” — CatalogDevizPanel îl gestionează ca azi; (b) adevărat = calea veche e ÎNCHISĂ pe obiect: garda refuză scrierile directe ale rândurilor
-- contract_initial ale lui, RPC-ul cere „înlocuiește” pentru re-import, calculul ignoră rândurile lui neconfirmate, lipsurile le declară. O SINGURĂ
-- definiție (L19); p_obiect e obiect_cod BRUT, canonizat aici (nu de apelant). SECURITY DEFINER fiindcă garda rulează ca apelantul, ale cărui politici
-- ar putea ascunde rândurile confirmate, și NU poate fi fail-open (L18): răspunde adevărul oricui e autentificat (un singur bit, fără date).
CREATE FUNCTION public.fn_rest_decontat_obiect_confirmat(p_proiect bigint, p_obiect text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT p_proiect IS NOT NULL
    AND (EXISTS (SELECT 1 FROM public.proiect_articole a
                  WHERE a.proiect_id::bigint = p_proiect AND a.sursa = 'contract_initial' AND a.confirmat_la IS NOT NULL
                    AND public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL) = public.fn_rest_decontat_cheie(p_obiect, NULL, NULL, NULL))
         OR EXISTS (SELECT 1 FROM public.proiect_articole_istoric h
                  WHERE h.proiect_id = p_proiect AND h.sursa = 'contract_initial' AND h.confirmat_la IS NOT NULL
                    AND h.obiect_k = public.fn_rest_decontat_cheie(p_obiect, NULL, NULL, NULL)))
$f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_obiect_confirmat(bigint, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_obiect_confirmat(bigint, text) TO authenticated;

-- ─── 6. situațiile de lucrări detaliate ───────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.executie_sl_detaliu (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  sl_id bigint REFERENCES public.executie_situatii_plata(id),
  nr_situatie text NOT NULL,
  luna integer,
  an integer,
  fisier_path text,
  amprenta text NOT NULL,
  versiune integer NOT NULL DEFAULT 1,
  activ boolean NOT NULL DEFAULT true,
  inlocuieste_id bigint REFERENCES public.executie_sl_detaliu(id),
  total_citit numeric,
  total_referinta numeric,
  confirmat_de uuid NOT NULL,
  confirmat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_sl_detaliu_nr_ck CHECK (nr_situatie ~ '[^[:space:]]' AND length(nr_situatie) <= 80),
  CONSTRAINT executie_sl_detaliu_luna_ck CHECK (luna IS NULL OR luna BETWEEN 1 AND 12),
  CONSTRAINT executie_sl_detaliu_an_ck CHECK (an IS NULL OR an BETWEEN 2000 AND 2100),
  CONSTRAINT executie_sl_detaliu_amprenta_ck CHECK (amprenta ~ '^[0-9a-f]{64}$'),
  CONSTRAINT executie_sl_detaliu_versiune_ck CHECK (versiune > 0 AND (versiune = 1) = (inlocuieste_id IS NULL)),
  CONSTRAINT executie_sl_detaliu_fisier_ck CHECK (fisier_path IS NULL OR length(fisier_path) BETWEEN 1 AND 1000),
  CONSTRAINT executie_sl_detaliu_amprenta_uq UNIQUE (proiect_id, amprenta),
  CONSTRAINT executie_sl_detaliu_versiune_uq UNIQUE (proiect_id, nr_situatie, versiune)
);
CREATE UNIQUE INDEX executie_sl_detaliu_activ_uq ON public.executie_sl_detaliu (proiect_id, nr_situatie) WHERE activ;
CREATE INDEX executie_sl_detaliu_sl_ix ON public.executie_sl_detaliu (sl_id) WHERE sl_id IS NOT NULL;
COMMENT ON TABLE public.executie_sl_detaliu IS
  'Rest de decontat (20270105a): o situație de lucrări DETALIATĂ (pe articol) confirmată; o singură versiune activă pe (proiect, nr. situație); înlocuirea păstrează versiunea veche inactivă. Scrisă doar prin fn_rest_decontat_confirma_situatie.';

CREATE TABLE public.executie_sl_detaliu_linii (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  detaliu_id bigint NOT NULL REFERENCES public.executie_sl_detaliu(id) ON DELETE CASCADE,
  obiect_cod text,
  deviz_cod text,
  nr text,
  cod text,
  denumire text,
  um text,
  cantitate_perioada numeric NOT NULL,
  cantitate_cumulat_doc numeric,
  pret_unitar numeric,
  valoare numeric NOT NULL,
  cheie text,
  tip_rand text NOT NULL,
  potrivire text,
  CONSTRAINT executie_sl_detaliu_linii_tip_ck CHECK (tip_rand IN ('articol', 'articol_nou', 'os', 'diverse', 'fara_detaliu')),
  CONSTRAINT executie_sl_detaliu_linii_potrivire_ck CHECK (potrivire IS NULL OR potrivire IN ('exact', 'cod', 'descriere_confirmata', 'manual')),
  CONSTRAINT executie_sl_detaliu_linii_cheie_ck CHECK ((cheie IS NOT NULL AND potrivire IS NOT NULL) = (tip_rand IN ('articol', 'os', 'diverse'))),
  CONSTRAINT executie_sl_detaliu_linii_nou_ck CHECK (tip_rand <> 'articol_nou' OR denumire ~ '[^[:space:]]')
);
CREATE INDEX executie_sl_detaliu_linii_detaliu_ix ON public.executie_sl_detaliu_linii (detaliu_id, cheie);
COMMENT ON TABLE public.executie_sl_detaliu_linii IS
  'Rest de decontat (20270105a): liniile unei situații detaliate; cheie = articolul din bază (NULL la articol_nou / fara_detaliu); cantitatea perioadei se adună cu semn. Scrise doar prin RPC.';

-- ─── 6b. cheile REFERITE (r9, review #1158, 2 × P1 pe r8: re-cheierea pe calea veche și RPC-ul schimbau identitatea unei chei cu decontat confirmat) ──────
-- O cheie e „referită” când cel puțin o linie a unei situații detaliate ACTIVE o folosește. Din acel moment identitatea ei e ÎNGHEȚATĂ: nicio operație nu
-- mai poate schimba cheia rândurilor ei (garda proiect_articole), iar RPC-ul de confirmare / înlocuire păstrează cheia referită în locul celei recalculate
-- din poziție. O SINGURĂ definiție a mulțimii (L19), folosită de gardă (prin fn_rest_decontat_cheie_situatii), de RPC și de lipsuri (decontat_fara_articol).
-- Funcția mulțimii e INTERNĂ (fără EXECUTE pentru clienți: dă valorile decontate pe cheie); garda, care rulează ca apelantul (politicile lui pot ascunde
-- situațiile — accesul general Execuție fără sub-modul), folosește învelișul DEFINER pe o cheie EXACTĂ, care răspunde doar cu numerele situațiilor
-- (fail-open interzis, L18; dezvăluie doar numerele situațiilor unei chei date a unui proiect dat).
CREATE FUNCTION public.fn_rest_decontat_chei_referite(p_proiect bigint)
RETURNS TABLE (cheie text, situatii text[], valoare numeric, linii integer)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT l.cheie, array_agg(DISTINCT d.nr_situatie ORDER BY d.nr_situatie), coalesce(sum(l.valoare), 0), count(*)::integer
    FROM public.executie_sl_detaliu d JOIN public.executie_sl_detaliu_linii l ON l.detaliu_id = d.id
   WHERE d.proiect_id = p_proiect AND d.activ AND l.cheie IS NOT NULL
   GROUP BY l.cheie
$f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_chei_referite(bigint) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.fn_rest_decontat_cheie_situatii(p_proiect bigint, p_cheie text) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN p_proiect IS NULL OR p_cheie IS NULL THEN ARRAY[]::text[]
              ELSE coalesce((SELECT r.situatii FROM public.fn_rest_decontat_chei_referite(p_proiect) r WHERE r.cheie = p_cheie), ARRAY[]::text[]) END
$f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_cheie_situatii(bigint, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_cheie_situatii(bigint, text) TO authenticated;

-- r10 (review #1158, P1 pe r9): O SINGURĂ validare a compatibilității UM a unei linii de BAZĂ cu DECONTATUL cheii (L19), pentru orice cale prin care o linie
-- de bază nouă ajunge pe o cheie cu decontat (RPC-ul de confirmare pentru orice sursă, garda proiect_articole pe calea veche / server / RPC, lipsurile, calculul).
-- Răspunde cu UM-urile normalizate ale liniilor situațiilor ACTIVE pe cheie care DIFERĂ de UM-ul normalizat al liniei (fn_rest_decontat_um: M ↔ ML ↔ HM sunt
-- același UM); gol = compatibil (nicio cantitate decontată pe cheie, sau toate în același UM). UM lipsă ('' normalizat) e un UM ca oricare altul: o linie fără
-- UM pe o cheie decontată în M = incompatibilă (L18, fără fail-open). DEFINER: garda rulează ca apelantul, ale cărui politici pot ascunde situațiile; dezvăluie
-- doar UM-urile decontate ale unei chei date a unui proiect dat (fără valori).
CREATE FUNCTION public.fn_rest_decontat_um_decontat_diferit(p_proiect bigint, p_cheie text, p_um text) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN p_proiect IS NULL OR p_cheie IS NULL THEN ARRAY[]::text[]
              ELSE coalesce((SELECT array_agg(DISTINCT x.um ORDER BY x.um)
                               FROM public.executie_sl_detaliu d JOIN public.executie_sl_detaliu_linii l ON l.detaliu_id = d.id
                               CROSS JOIN LATERAL public.fn_rest_decontat_um(l.um) x
                              WHERE d.proiect_id = p_proiect AND d.activ AND l.cheie = p_cheie
                                AND x.um IS DISTINCT FROM (SELECT y.um FROM public.fn_rest_decontat_um(p_um) y)), ARRAY[]::text[]) END
$f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_um_decontat_diferit(bigint, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_um_decontat_diferit(bigint, text, text) TO authenticated;

-- ─── 7. gărzile BEFORE (toate căile, L07 / L08) ───────────────────────────────────────────────────────────────────────────────
-- notele: autorul / momentul le pune serverul; proiectul, tipul, autorul nu se schimbă; dreptul = documente_baza; actul legat e al proiectului
CREATE FUNCTION public.fn_rest_decontat_nota_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_server boolean := public.fn_rest_decontat_server() IS TRUE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT v_server THEN RAISE EXCEPTION 'rest_decontat: notele nu se sterg (activ = false)' USING ERRCODE = '42501'; END IF;
    RETURN OLD;
  END IF;
  IF NOT v_server AND NOT public.fn_rest_decontat_drept(NEW.proiect_id, 'documente_baza') THEN
    RAISE EXCEPTION 'rest_decontat: proiectul nu exista sau nu ai drept pe documentele lui de baza' USING ERRCODE = '42501';
  END IF;
  NEW.tip := upper(btrim(NEW.tip));
  NEW.numar := btrim(regexp_replace(coalesce(NEW.numar, ''), '[[:space:]]+', ' ', 'g'));
  IF TG_OP = 'INSERT' THEN
    NEW.creat_de := auth.uid();
    NEW.creat_la := now();
  ELSE
    IF (NEW.proiect_id, NEW.tip, NEW.creat_de, NEW.creat_la) IS DISTINCT FROM (OLD.proiect_id, OLD.tip, OLD.creat_de, OLD.creat_la) THEN
      RAISE EXCEPTION 'rest_decontat: proiectul, tipul si autorul notei nu se schimba' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.act_aditional_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.act_aditional_id IS DISTINCT FROM OLD.act_aditional_id) THEN
    IF v_server THEN
      PERFORM 1 FROM public.executie_acte_aditionale a WHERE a.id::bigint = NEW.act_aditional_id AND a.proiect_id::bigint = NEW.proiect_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'rest_decontat: actul aditional nu e al proiectului notei' USING ERRCODE = '23514'; END IF;
    ELSIF NOT public.fn_rest_decontat_aa_al_proiectului(NEW.act_aditional_id, NEW.proiect_id) THEN
      RAISE EXCEPTION 'rest_decontat: actul aditional nu e al proiectului notei' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_nota_garda() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_rest_decontat_nota_garda BEFORE INSERT OR UPDATE OR DELETE ON public.executie_note_modificare
  FOR EACH ROW EXECUTE FUNCTION public.fn_rest_decontat_nota_garda();

-- r8 (review #1158, P1 pe r7): cheia rândurilor scrise pe CALEA VECHE (fără cheie dată — catalogul, Magazie, fixturile serverului) urmează ACEEAȘI regulă
-- ca backfill-ul migrării și ca RPC-ul: în același DOCUMENT (proiect + sursă + act_nr) codul canonic (obiect | deviz | cod) care se repetă primește poziția
-- (|#nr) pe TOATE rândurile lui — și pe cele deja scrise, din alte loturi / instrucțiuni (catalogul inserează câte 200 de rânduri, pe cereri separate; un
-- grup poate fi tăiat de lot). Garda (BEFORE INSERT, ca apelantul) cheamă funcția de aici pentru rândul care se scrie: dacă documentul are deja rânduri cu
-- același cod canonic, le re-cheiază cu poziția (DEFINER: politicile vechi ale apelantului pot să nu-i dea UPDATE / SELECT) și răspunde adevărat (rândul nou
-- ia și el poziția). Scrie DOAR coloana derivată cheie, DOAR pe rândurile neconfirmate ale documentului, DOAR cu valoarea calculată din propriile câmpuri
-- (regula backfill-ului: nr::text, NULL = fără poziție) și DOAR din gardă (pg_trigger_depth() = 0 → refuz: apelată direct n-ar putea decât să pună poziția
-- pe un cod nerepetat). UPDATE-ul re-cheierii trece prin aceeași gardă (rândul neconfirmat, cheia din mulțimea permisă, advisory-ul deja ținut de sesiune) —
-- r9: inclusiv prin refuzul „cheie_referita”: dacă un rând al grupului poartă o cheie REFERITĂ de o situație confirmată, garda refuză re-cheierea lui și
-- întreaga instrucțiune (INSERT-ul rândului nou) pică — nimic scris (reproducerea 1 Jakarinos r8: TSA01 confirmat, situație pe cheia fără poziție, al doilea
-- TSA01 pe calea veche = refuz, nu decontat desprins de articol).
CREATE FUNCTION public.fn_rest_decontat_cheie_document(p_proiect bigint, p_sursa text, p_act_nr text, p_k text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_exista boolean;
BEGIN
  IF pg_trigger_depth() = 0 THEN
    RAISE EXCEPTION 'rest_decontat: fn_rest_decontat_cheie_document se apeleaza doar din garda proiect_articole' USING ERRCODE = '42501';
  END IF;
  IF p_proiect IS NULL OR p_k IS NULL THEN RETURN false; END IF;
  -- documentul căii vechi = rândurile NECONFIRMATE ale (proiect, sursă, act_nr): cele confirmate sunt documentul RPC-ului (poziția lor a decis-o RPC-ul)
  SELECT EXISTS (SELECT 1 FROM public.proiect_articole a
                  WHERE a.proiect_id::bigint = p_proiect AND a.sursa IS NOT DISTINCT FROM p_sursa AND coalesce(a.act_nr::text, '') = coalesce(p_act_nr, '')
                    AND a.confirmat_la IS NULL
                    AND public.fn_rest_decontat_cheie(a.obiect_cod::text, a.deviz_cod::text, a.cod::text, NULL) = p_k) INTO v_exista;
  IF NOT v_exista THEN RETURN false; END IF;
  -- grupul e repetat (rândurile existente + cel care se scrie): toate rândurile lui scrise pe calea veche primesc poziția
  UPDATE public.proiect_articole a
     SET cheie = public.fn_rest_decontat_cheie(a.obiect_cod::text, a.deviz_cod::text, a.cod::text, a.nr::text)
   WHERE a.proiect_id::bigint = p_proiect AND a.sursa IS NOT DISTINCT FROM p_sursa AND coalesce(a.act_nr::text, '') = coalesce(p_act_nr, '')
     AND a.confirmat_la IS NULL
     AND public.fn_rest_decontat_cheie(a.obiect_cod::text, a.deviz_cod::text, a.cod::text, NULL) = p_k
     AND a.cheie IS DISTINCT FROM public.fn_rest_decontat_cheie(a.obiect_cod::text, a.deviz_cod::text, a.cod::text, a.nr::text);
  RETURN true;
END $f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_cheie_document(bigint, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_cheie_document(bigint, text, text, text) TO authenticated;

-- proiect_articole: coloanele de confirmare le scrie doar RPC-ul (marcajul tranzacției) sau serverul; rândurile confirmate nu se modifică /
-- șterg direct; un rând cu sursă AA / NR / NCS (flux autorizat: act / notă aprobată + confirmare) se scrie DOAR prin RPC — nici INSERT direct, nici
-- schimbarea sursei unui rând existent către ele (r3); pe un OBIECT cu oferta CONFIRMATĂ (starea (b), fn_rest_decontat_obiect_confirmat)
-- rândurile contract_initial nu se mai scriu / modifică / șterg / reparentează direct (r4 / r5: calea veche e închisă pe acel obiect, deschisă pe
-- obiectele vechi ale aceluiași proiect); cheia e mereu cea calculată în BD (fără nr, sau cu nr când apelantul o cere; r8: un rând NOU fără cheie
-- primește poziția când codul lui canonic există deja în același document — regula backfill-ului, prin fn_rest_decontat_cheie_document). Marcajul
-- LIPSĂ (NULL, sesiune nouă) = refuz (L18). r9: o cheie REFERITĂ de o situație confirmată e înghețată — niciun UPDATE (al nimănui: client, re-cheiere,
-- server) nu-i schimbă cheia unui rând (fn_rest_decontat_cheie_situatii).
CREATE FUNCTION public.fn_rest_decontat_articole_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE
  v_rpc boolean := coalesce(current_setting('gazpet.rest_decontat_scriitor', true), '') = 'fn_rest_decontat_confirma_baza';
  v_server boolean := public.fn_rest_decontat_server() IS TRUE;
  v_fara text; v_cu text; v_p bigint; v_sit text[]; v_um_dif text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.confirmat_la IS NOT NULL AND (v_rpc OR v_server) IS NOT TRUE THEN
      RAISE EXCEPTION 'rest_decontat: randurile confirmate ale bazei nu se sterg' USING ERRCODE = '42501';
    END IF;
    -- r4 / r5: pe un OBIECT cu oferta confirmată nici rândurile vechi (neconfirmate) ale ofertei lui nu se șterg direct
    IF OLD.sursa = 'contract_initial' AND (v_rpc OR v_server) IS NOT TRUE AND public.fn_rest_decontat_obiect_confirmat(OLD.proiect_id::bigint, OLD.obiect_cod::text) THEN
      RAISE EXCEPTION 'rest_decontat: obiectul % al proiectului % are oferta confirmata; randurile ofertei lui nu se mai sterg direct (importul ofertei se face din Rest de decontat)', coalesce(OLD.obiect_cod::text, '-'), OLD.proiect_id USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF (v_rpc OR v_server) IS NOT TRUE THEN
    IF TG_OP = 'UPDATE' AND OLD.confirmat_la IS NOT NULL THEN
      RAISE EXCEPTION 'rest_decontat: randurile confirmate ale bazei nu se modifica direct' USING ERRCODE = '42501';
    END IF;
    -- r3 (review #1158): sursele cu flux autorizat (devizul unei NR / NCS aprobate, devizul unui AA) intră DOAR prin RPC, cu legătura și confirmarea;
    -- apelantul direct nu poate da legătura (coloanele de proveniență sunt ale RPC-ului), deci un rând cu astfel de sursă = refuz, la INSERT și la
    -- schimbarea sursei unui rând existent (predicatul unic, cu legăturile NULL = „sursa cere fluxul”)
    IF NOT public.fn_rest_decontat_sursa_autorizata(NEW.sursa::text, NULL, NULL, NULL) THEN
      RAISE EXCEPTION 'rest_decontat: randurile cu sursa % (deviz NR / NCS / act aditional) se scriu doar prin fn_rest_decontat_confirma_baza', NEW.sursa USING ERRCODE = '42501';
    END IF;
    -- r4 / r5 (review #1158): STĂRILE OFERTEI, PE OBIECT. Un rând contract_initial scris / modificat / reparentat direct (calea veche) e primit DOAR
    -- cât OBIECTUL lui (cel nou ȘI, la UPDATE, cel vechi: reparentare sau mutare între obiecte) e în starea (a): fără niciun rând contract_initial
    -- confirmat al obiectului. L01: ÎNTÂI lock-ul proiectului (al celui nou și, la reparentare, al celui vechi) — ACELAȘI advisory ca RPC-ul
    -- fn_rest_decontat_confirma_baza —, apoi verificarea stării (instrucțiune nouă = snapshot nou: o confirmare comisă cât se aștepta e văzută).
    -- Doar try (NOWAIT, L06): BEFORE UPDATE / DELETE au deja rândul blocat, iar RPC-ul ține advisory-ul și apoi ia rândurile obiectelor — o
    -- așteptare aici ar fi deadlock; „ocupat” = 55P03, nimic scris, apelantul reîncearcă. Lock-ul rămâne până la COMMIT, deci RPC-ul pornit între
    -- timp așteaptă și vede apoi rândurile acestui import (pe obiectele importate le mută în istoric, fără cumulare).
    IF NEW.sursa = 'contract_initial' OR (TG_OP = 'UPDATE' AND OLD.sursa = 'contract_initial') THEN
      FOREACH v_p IN ARRAY array_remove(ARRAY[NEW.proiect_id::bigint, CASE WHEN TG_OP = 'UPDATE' AND OLD.proiect_id::bigint IS DISTINCT FROM NEW.proiect_id::bigint THEN OLD.proiect_id::bigint END], NULL) LOOP
        IF NOT pg_try_advisory_xact_lock(hashtextextended('gazpet.rest_decontat:' || v_p::text, 0)) THEN
          RAISE EXCEPTION 'rest_decontat: oferta proiectului % se confirma chiar acum (Rest de decontat); reincearca' , v_p USING ERRCODE = '55P03';
        END IF;
      END LOOP;
      IF NEW.sursa = 'contract_initial' AND public.fn_rest_decontat_obiect_confirmat(NEW.proiect_id::bigint, NEW.obiect_cod::text) THEN
        RAISE EXCEPTION 'rest_decontat: obiectul % al proiectului % are oferta confirmata; importul ofertei se face din Rest de decontat (fn_rest_decontat_confirma_baza), nu din catalogul vechi', coalesce(NEW.obiect_cod::text, '-'), NEW.proiect_id USING ERRCODE = '42501';
      END IF;
      IF TG_OP = 'UPDATE' AND OLD.sursa = 'contract_initial' AND public.fn_rest_decontat_obiect_confirmat(OLD.proiect_id::bigint, OLD.obiect_cod::text) THEN
        RAISE EXCEPTION 'rest_decontat: obiectul % al proiectului % are oferta confirmata; randurile ofertei lui nu se mai modifica direct (importul ofertei se face din Rest de decontat)', coalesce(OLD.obiect_cod::text, '-'), OLD.proiect_id USING ERRCODE = '42501';
      END IF;
    END IF;
    IF (TG_OP = 'INSERT' AND (NEW.confirmat_de, NEW.confirmat_la, NEW.fisier_amprenta, NEW.nota_id, NEW.act_aditional_id, NEW.mod_import)
                             IS DISTINCT FROM (NULL::uuid, NULL::timestamptz, NULL::text, NULL::bigint, NULL::bigint, NULL::text))
       OR (TG_OP = 'UPDATE' AND (NEW.confirmat_de, NEW.confirmat_la, NEW.fisier_amprenta, NEW.nota_id, NEW.act_aditional_id, NEW.mod_import)
                             IS DISTINCT FROM (OLD.confirmat_de, OLD.confirmat_la, OLD.fisier_amprenta, OLD.nota_id, OLD.act_aditional_id, OLD.mod_import)) THEN
      RAISE EXCEPTION 'rest_decontat: coloanele de confirmare le scrie doar fn_rest_decontat_confirma_baza' USING ERRCODE = '42501';
    END IF;
  END IF;
  v_fara := public.fn_rest_decontat_cheie(NEW.obiect_cod::text, NEW.deviz_cod::text, NEW.cod::text, NULL);
  v_cu := public.fn_rest_decontat_cheie(NEW.obiect_cod::text, NEW.deviz_cod::text, NEW.cod::text, NEW.nr::text);
  IF TG_OP = 'UPDATE' AND NEW.cheie IS NOT DISTINCT FROM OLD.cheie
     AND (NEW.obiect_cod, NEW.deviz_cod, NEW.cod, NEW.nr) IS DISTINCT FROM (OLD.obiect_cod, OLD.deviz_cod, OLD.cod, OLD.nr) THEN
    -- identitatea s-a schimbat, cheia nu: se recalculează, păstrând forma (cu / fără nr)
    NEW.cheie := CASE WHEN OLD.cheie = public.fn_rest_decontat_cheie(OLD.obiect_cod::text, OLD.deviz_cod::text, OLD.cod::text, OLD.nr::text)
                        AND OLD.cheie <> public.fn_rest_decontat_cheie(OLD.obiect_cod::text, OLD.deviz_cod::text, OLD.cod::text, NULL) THEN v_cu ELSE v_fara END;
  END IF;
  IF NEW.cheie IS NULL THEN
    -- r8 (review #1158, P1 pe r7): rândul NOU scris fără cheie (calea veche) urmează regula documentului — codul canonic deja prezent în același document
    -- (proiect + sursă + act_nr) = repetat → poziția intră în cheie, și la rândurile deja scrise ale grupului (alte loturi / instrucțiuni), ca la backfill
    IF TG_OP = 'INSERT' AND public.fn_rest_decontat_cheie_document(NEW.proiect_id::bigint, NEW.sursa::text, NEW.act_nr::text, v_fara) THEN
      NEW.cheie := v_cu;
    ELSE
      NEW.cheie := v_fara;
    END IF;
  ELSIF NEW.cheie NOT IN (v_fara, v_cu) THEN
    RAISE EXCEPTION 'rest_decontat: cheia articolului nu corespunde obiectului / devizului / codului (se calculeaza in BD)' USING ERRCODE = '23514';
  END IF;
  -- r9 (review #1158, 2 × P1 pe r8): o cheie REFERITĂ de o situație confirmată (activă) e ÎNGHEȚATĂ — identitatea ei nu se schimbă pe NICIO cale (re-cheierea
  -- grupului repetat pe calea veche, schimbarea directă a codului / obiectului / devizului, o cheie dată explicit, serverul): refuz înaintea oricărei scrieri,
  -- cu cheia, situațiile și ce ar fi devenit. Dispariția BAZEI unei chei referite (ștergere / retragere pe calea veche, înlocuire fără linia ei, listă completă
  -- AA care n-o mai conține, AA / notă dezactivate) NU e identitate schimbată: calculul ține decontatul, lipsurile o declară (decontat_fara_articol).
  -- Doar rândurile surselor care intră în BAZĂ poartă identitatea decontată (aceeași listă ca r0 din fn_rest_decontat_baza_proiect); un rând extras_materiale
  -- cu aceeași cheie e al Magaziei, nu al bazei, și se re-cheiază liber.
  IF TG_OP = 'UPDATE' AND NEW.cheie IS DISTINCT FROM OLD.cheie AND OLD.sursa IN ('contract_initial', 'act_aditional', 'nota_renuntare', 'nota_comanda_suplimentara') THEN
    v_sit := public.fn_rest_decontat_cheie_situatii(OLD.proiect_id::bigint, OLD.cheie);
    IF cardinality(v_sit) > 0 THEN
      RAISE EXCEPTION 'rest_decontat: cheia % (codul %) e referita de situatiile confirmate % si nu-si poate schimba identitatea (ar fi devenit %); un articol decontat nu se re-cheiaza si nu-si schimba codul / obiectul / devizul — inlocuieste intai situatiile care il folosesc (cheie_referita)',
        OLD.cheie, coalesce(OLD.cod::text, '-'), array_to_string(v_sit, ', '), NEW.cheie USING ERRCODE = '23514';
    END IF;
  END IF;
  -- r10 (review #1158, P1 pe r9): UM-ul unui rând al BAZEI față de DECONTATUL cheii — ACEEAȘI validare ca RPC-ul (fn_rest_decontat_um_decontat_diferit), pe
  -- toate căile (catalogul vechi, serverul, și rândurile RPC-ului — apărare în adâncime): la INSERT și la UPDATE-ul care schimbă cheia / UM-ul / activ / sursa /
  -- proiectul rândului. Un articol cu 80 M decontați nu primește o bază în MC (nici după ce rândul vechi a fost șters pe calea veche); UM-ul echivalent prin
  -- factor (M → ML) trece. Refuz înaintea oricărei scrieri, cu cheia, UM-urile decontate și UM-ul nou.
  IF NEW.sursa IN ('contract_initial', 'act_aditional', 'nota_renuntare', 'nota_comanda_suplimentara') AND NEW.activ
     AND (TG_OP = 'INSERT' OR (NEW.cheie, NEW.um::text, NEW.activ, NEW.sursa::text, NEW.proiect_id::bigint)
                              IS DISTINCT FROM (OLD.cheie, OLD.um::text, OLD.activ, OLD.sursa::text, OLD.proiect_id::bigint)) THEN
    v_um_dif := public.fn_rest_decontat_um_decontat_diferit(NEW.proiect_id::bigint, NEW.cheie, NEW.um::text);
    IF cardinality(v_um_dif) > 0 THEN
      RAISE EXCEPTION 'rest_decontat: cheia % (codul %) are cantitati decontate in UM % si nu primeste o baza in UM %; UM-ul unui articol decontat nu se schimba (nici dupa stergerea randului vechi) — scrie randul in UM-ul decontat sau echivalent prin factor (um_decontat)',
        NEW.cheie, coalesce(NEW.cod::text, '-'), array_to_string(v_um_dif, ' / '), coalesce(NEW.um::text, '-') USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_articole_garda() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_rest_decontat_articole_garda BEFORE INSERT OR UPDATE OR DELETE ON public.proiect_articole
  FOR EACH ROW EXECUTE FUNCTION public.fn_rest_decontat_articole_garda();

-- situațiile detaliate: scrise doar de RPC (marcaj) sau de server; antetul e imuabil în afara coloanei activ; liniile nu se modifică.
-- Marcajul LIPSĂ (NULL, sesiune nouă) = refuz (L18).
CREATE FUNCTION public.fn_rest_decontat_sl_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE
  v_rpc boolean := coalesce(current_setting('gazpet.rest_decontat_scriitor', true), '') = 'fn_rest_decontat_confirma_situatie';
  v_server boolean := public.fn_rest_decontat_server() IS TRUE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT v_server THEN RAISE EXCEPTION 'rest_decontat: situatiile detaliate nu se sterg (versiunea veche ramane inactiva)' USING ERRCODE = '42501'; END IF;
    RETURN OLD;
  END IF;
  IF (v_rpc OR v_server) IS NOT TRUE THEN
    RAISE EXCEPTION 'rest_decontat: situatiile detaliate se scriu doar prin fn_rest_decontat_confirma_situatie' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'executie_sl_detaliu_linii' THEN
      RAISE EXCEPTION 'rest_decontat: liniile unei situatii confirmate nu se modifica' USING ERRCODE = '23514';
    END IF;
    IF (to_jsonb(NEW) - 'activ') IS DISTINCT FROM (to_jsonb(OLD) - 'activ') OR (OLD.activ IS FALSE AND NEW.activ IS TRUE) THEN
      RAISE EXCEPTION 'rest_decontat: antetul unei situatii confirmate se poate doar dezactiva' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_sl_garda() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_rest_decontat_sl_garda BEFORE INSERT OR UPDATE OR DELETE ON public.executie_sl_detaliu
  FOR EACH ROW EXECUTE FUNCTION public.fn_rest_decontat_sl_garda();
CREATE TRIGGER trg_rest_decontat_sl_linii_garda BEFORE INSERT OR UPDATE OR DELETE ON public.executie_sl_detaliu_linii
  FOR EACH ROW EXECUTE FUNCTION public.fn_rest_decontat_sl_garda();

-- istoricul ofertei (r5): scris doar de fn_rest_decontat_confirma_baza (marcaj) sau de server; niciodată modificat; șters doar de server.
-- Marcajul LIPSĂ (NULL, sesiune nouă) = refuz (L18). Autorul / momentul retragerii le pune serverul.
CREATE FUNCTION public.fn_rest_decontat_istoric_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE
  v_rpc boolean := coalesce(current_setting('gazpet.rest_decontat_scriitor', true), '') = 'fn_rest_decontat_confirma_baza';
  v_server boolean := public.fn_rest_decontat_server() IS TRUE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT v_server THEN RAISE EXCEPTION 'rest_decontat: istoricul ofertei nu se sterge (decizie separata, server)' USING ERRCODE = '42501'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'rest_decontat: istoricul ofertei nu se modifica' USING ERRCODE = '42501'; END IF;
  IF (v_rpc OR v_server) IS NOT TRUE THEN
    RAISE EXCEPTION 'rest_decontat: istoricul ofertei se scrie doar prin fn_rest_decontat_confirma_baza' USING ERRCODE = '42501';
  END IF;
  IF v_rpc THEN NEW.retras_de := coalesce(auth.uid(), NEW.retras_de); NEW.retras_la := now(); END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_istoric_garda() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_rest_decontat_istoric_garda BEFORE INSERT OR UPDATE OR DELETE ON public.proiect_articole_istoric
  FOR EACH ROW EXECUTE FUNCTION public.fn_rest_decontat_istoric_garda();

-- ─── 8. RLS + drepturi pe tabelele noi (anon / service_role nimic; clienții doar ce trece prin drept) ─────────────────────────
ALTER TABLE public.executie_note_modificare ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_note_modificare FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.executie_note_modificare TO authenticated;
CREATE POLICY executie_note_modificare_citire ON public.executie_note_modificare FOR SELECT TO authenticated
  USING (public.fn_rest_decontat_drept(proiect_id, 'citire') OR public.fn_rest_decontat_drept(proiect_id, 'documente_baza'));
CREATE POLICY executie_note_modificare_adauga ON public.executie_note_modificare FOR INSERT TO authenticated
  WITH CHECK (public.fn_rest_decontat_drept(proiect_id, 'documente_baza'));
CREATE POLICY executie_note_modificare_modifica ON public.executie_note_modificare FOR UPDATE TO authenticated
  USING (public.fn_rest_decontat_drept(proiect_id, 'documente_baza')) WITH CHECK (public.fn_rest_decontat_drept(proiect_id, 'documente_baza'));
ALTER TABLE public.executie_sl_detaliu ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_sl_detaliu FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.executie_sl_detaliu TO authenticated;
CREATE POLICY executie_sl_detaliu_citire ON public.executie_sl_detaliu FOR SELECT TO authenticated
  USING (public.fn_rest_decontat_drept(proiect_id, 'citire'));
ALTER TABLE public.executie_sl_detaliu_linii ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_sl_detaliu_linii FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.executie_sl_detaliu_linii TO authenticated;
CREATE POLICY executie_sl_detaliu_linii_citire ON public.executie_sl_detaliu_linii FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.executie_sl_detaliu d WHERE d.id = detaliu_id AND public.fn_rest_decontat_drept(d.proiect_id, 'citire')));
ALTER TABLE public.proiect_articole_istoric ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.proiect_articole_istoric FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.proiect_articole_istoric TO authenticated;
CREATE POLICY proiect_articole_istoric_citire ON public.proiect_articole_istoric FOR SELECT TO authenticated
  USING (public.fn_rest_decontat_drept(proiect_id, 'citire'));
REVOKE ALL ON SEQUENCE public.executie_note_modificare_id_seq, public.executie_sl_detaliu_id_seq, public.executie_sl_detaliu_linii_id_seq, public.proiect_articole_istoric_id_seq FROM PUBLIC, anon, service_role;
GRANT USAGE ON SEQUENCE public.executie_note_modificare_id_seq TO authenticated;
REVOKE ALL ON SEQUENCE public.executie_sl_detaliu_id_seq, public.executie_sl_detaliu_linii_id_seq, public.proiect_articole_istoric_id_seq FROM authenticated;

-- ─── 9. calculul: UN singur loc (L19). Fiecare funcție dă doar proiectele pe care apelantul le poate citi ────────────────────────
-- baza unui proiect pe cheie (INTERNĂ, fără drept: o cheamă calculul filtrat și RPC-urile; clienții n-au EXECUTE): regula fără dublare din
-- antet; cantitatea în UM-ul normalizat; prețul = ULTIMUL ACT care l-a dat.
-- Ordinea actelor (decizia chat-ului, 21.11.2026): (data documentului, momentul confirmării, id) — data documentului = data_semnare la AA,
-- data_aprobare la note; oferta și rândurile fără dată (AA vechi doar cu act_nr, AA fără data_semnare) = '-infinity' (cele mai vechi), între
-- ele decide momentul confirmării (created_at la rândurile moștenite). Aceeași ordine decide și ce ignoră un AA „listă completă”.
-- Notele: intră în bază DOAR aprobate (data_aprobare completată) și active; cele legate de un AA ies din bază doar când AA-ul e activ ȘI are
-- devizul confirmat. Obiectul unui AA „listă completă” se potrivește pe identitatea canonică (prima parte a cheii: fn_rest_decontat_cheie pe
-- obiect singur), nu pe obiect_cod brut (L19). Fiecare sursă intră pe calea ei (r3, fn_rest_decontat_sursa_autorizata): oferta (RPC sau calea
-- veche), devizul unui AA / al unei note DOAR cu legătura ȘI confirmarea RPC-ului; un rând orfan sau neconfirmat al acestor surse nu se numără,
-- chiar dacă ar trece de CHECK și de gardă (apărare în adâncime; condițiile de mai jos sunt per sursă, fără „legătura NULL = trece”).
CREATE FUNCTION public.fn_rest_decontat_baza_proiect(p_proiect bigint)
RETURNS TABLE (proiect_id bigint, cheie text, tip_rand text, obiect_cod text, obiect_nume text, deviz_cod text, deviz_nume text, nr text, cod text,
               denumire text, um text, um_incert boolean, pret_unitar numeric, cantitate numeric, valoare numeric, randuri integer, surse text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  WITH r0 AS (
    SELECT a.id::bigint AS id, a.proiect_id::bigint AS proiect_id, a.cheie, a.tip_rand, a.obiect_cod::text AS obiect_cod, a.obiect_nume::text AS obiect_nume,
           a.deviz_cod::text AS deviz_cod, a.deviz_nume::text AS deviz_nume, a.nr::text AS nr, a.cod::text AS cod, a.denumire::text AS denumire, a.um::text AS um,
           a.cantitate::numeric AS cantitate, a.valoare::numeric AS valoare, a.pret_unitar::numeric AS pret_unitar, a.sursa::text AS sursa,
           a.nota_id, a.act_aditional_id, a.mod_import,
           public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL) AS obiect_k,
           coalesce(a.confirmat_la, a.created_at::timestamptz, '-infinity'::timestamptz) AS moment
      FROM public.proiect_articole a
     WHERE a.proiect_id::bigint = p_proiect AND a.activ AND a.sursa IN ('contract_initial', 'act_aditional', 'nota_renuntare', 'nota_comanda_suplimentara')
       AND public.fn_rest_decontat_sursa_autorizata(a.sursa::text, a.nota_id, a.act_aditional_id, a.confirmat_la)
       -- r4 / r5: pe un OBIECT cu oferta confirmată (starea (b)) rândurile contract_initial neconfirmate (calea veche, dacă ar mai exista) NU intră
       -- în bază — pe fiecare obiect: rândurile confirmate dacă există, altfel cele vechi; apărare dublă față de gardă (lipsurile le declară:
       -- 'oferta_veche_neconfirmata')
       AND (a.sursa <> 'contract_initial' OR a.confirmat_la IS NOT NULL OR NOT public.fn_rest_decontat_obiect_confirmat(p_proiect, a.obiect_cod::text))),
  -- actele: active și cu deviz confirmat (un AA fără deviz nu preia încă nimic); data documentului = data_semnare
  aa AS (SELECT x.id::bigint AS id, coalesce(x.activ, true) AS activ, x.data_semnare::date AS data_doc,
                EXISTS (SELECT 1 FROM r0 WHERE r0.act_aditional_id = x.id::bigint) AS are_deviz
           FROM public.executie_acte_aditionale x),
  -- notele: active și APROBATE (data_aprobare = data documentului)
  nt AS (SELECT n.id, n.activ, n.data_aprobare, n.act_aditional_id FROM public.executie_note_modificare n),
  r1 AS (
    SELECT r0.*, coalesce(aa.data_doc, nt.data_aprobare, DATE '-infinity') AS data_doc FROM r0
      LEFT JOIN aa ON aa.id = r0.act_aditional_id
      LEFT JOIN nt ON nt.id = r0.nota_id
      LEFT JOIN aa aan ON aan.id = nt.act_aditional_id
     WHERE (r0.sursa = 'contract_initial')
        OR (r0.sursa = 'act_aditional' AND coalesce(aa.activ, false))
        OR (r0.sursa IN ('nota_renuntare', 'nota_comanda_suplimentara') AND coalesce(nt.activ, false) AND nt.data_aprobare IS NOT NULL
            AND NOT (coalesce(aan.activ, false) AND coalesce(aan.are_deviz, false)))),
  -- AA „listă completă”: pe obiectele lui (identitatea canonică), rândurile celorlalte documente DATATE înaintea lui se ignoră
  lc AS (SELECT r1.proiect_id, r1.obiect_k, r1.act_aditional_id AS aa_id, min(r1.data_doc) AS data_doc, min(r1.moment) AS moment, min(r1.id) AS id
           FROM r1 WHERE r1.sursa = 'act_aditional' AND r1.mod_import = 'lista_completa' AND r1.act_aditional_id IS NOT NULL
          GROUP BY 1, 2, 3),
  -- „înainte” = (data documentului, momentul confirmării, id): rândurile aceluiași document au aceeași dată și același now(), id-ul le ordonează
  r2 AS (
    SELECT r1.* FROM r1
     WHERE NOT EXISTS (SELECT 1 FROM lc WHERE lc.proiect_id = r1.proiect_id AND lc.obiect_k = r1.obiect_k
                         AND lc.aa_id IS DISTINCT FROM r1.act_aditional_id AND (r1.data_doc, r1.moment, r1.id) < (lc.data_doc, lc.moment, lc.id))),
  u AS (SELECT r2.*, (SELECT x.um FROM public.fn_rest_decontat_um(r2.um) x) AS um_n, (SELECT x.factor FROM public.fn_rest_decontat_um(r2.um) x) AS factor FROM r2)
  SELECT u.proiect_id, u.cheie,
         (array_agg(u.tip_rand ORDER BY u.data_doc, u.moment, u.id))[1],
         (array_agg(u.obiect_cod ORDER BY u.data_doc, u.moment, u.id))[1],
         (array_agg(u.obiect_nume ORDER BY u.data_doc, u.moment, u.id) FILTER (WHERE u.obiect_nume IS NOT NULL))[1],
         (array_agg(u.deviz_cod ORDER BY u.data_doc, u.moment, u.id))[1],
         (array_agg(u.deviz_nume ORDER BY u.data_doc, u.moment, u.id) FILTER (WHERE u.deviz_nume IS NOT NULL))[1],
         (array_agg(u.nr ORDER BY u.data_doc, u.moment, u.id))[1],
         (array_agg(u.cod ORDER BY u.data_doc, u.moment, u.id))[1],
         (array_agg(u.denumire ORDER BY u.data_doc, u.moment, u.id) FILTER (WHERE u.denumire IS NOT NULL))[1],
         (array_agg(u.um_n ORDER BY u.data_doc, u.moment, u.id))[1],
         count(DISTINCT u.um_n) > 1,
         (array_agg(u.pret_unitar ORDER BY u.data_doc DESC, u.moment DESC, u.id DESC) FILTER (WHERE u.pret_unitar IS NOT NULL))[1],
         coalesce(sum(u.cantitate * u.factor), 0), coalesce(sum(u.valoare), 0), count(*)::integer,
         array_agg(DISTINCT u.sursa)
    FROM u GROUP BY u.proiect_id, u.cheie
$f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_baza_proiect(bigint) FROM PUBLIC, anon, authenticated, service_role;

-- baza pentru proiectele pe care apelantul le poate citi (vederea v_executie_rest_decontat_baza)
CREATE FUNCTION public.fn_rest_decontat_baza_calcul()
RETURNS TABLE (proiect_id bigint, cheie text, tip_rand text, obiect_cod text, obiect_nume text, deviz_cod text, deviz_nume text, nr text, cod text,
               denumire text, um text, um_incert boolean, pret_unitar numeric, cantitate numeric, valoare numeric, randuri integer, surse text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT b.* FROM public.executie_proiecte e CROSS JOIN LATERAL public.fn_rest_decontat_baza_proiect(e.id) b
   WHERE public.fn_rest_decontat_drept(e.id, 'citire')
$f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_baza_calcul() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_baza_calcul() TO authenticated;

-- restul pe articol: baza − decontat (situațiile active); plus articolele noi (în afara ofertei) și situațiile fără detaliu, cu bază 0
CREATE FUNCTION public.fn_rest_decontat_calcul()
RETURNS TABLE (proiect_id bigint, rand_id text, cheie text, tip_rand text, obiect_cod text, obiect_nume text, deviz_cod text, deviz_nume text, nr text, cod text,
               denumire text, um text, um_incert boolean, pret_unitar numeric, baza_cantitate numeric, baza_valoare numeric,
               decontat_cantitate numeric, decontat_valoare numeric, rest_cantitate numeric, rest_valoare numeric, pct_decontat numeric,
               peste_oferta boolean, nedecontat boolean, situatii integer, ultima_situatie text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  WITH b AS (SELECT * FROM public.fn_rest_decontat_baza_calcul()),
  pr AS (SELECT e.id FROM public.executie_proiecte e WHERE public.fn_rest_decontat_drept(e.id, 'citire')),
  ln AS (
    SELECT d.proiect_id, d.nr_situatie, d.an, d.luna, l.*,
           (SELECT x.um FROM public.fn_rest_decontat_um(l.um) x) AS um_n, (SELECT x.factor FROM public.fn_rest_decontat_um(l.um) x) AS factor
      FROM public.executie_sl_detaliu d JOIN pr ON pr.id = d.proiect_id
      JOIN public.executie_sl_detaliu_linii l ON l.detaliu_id = d.id
     WHERE d.activ),
  dec AS (
    SELECT ln.proiect_id, ln.cheie, sum(ln.cantitate_perioada * ln.factor) AS cant, sum(ln.valoare) AS val, count(DISTINCT ln.detaliu_id)::integer AS situatii,
           (array_agg(ln.nr_situatie ORDER BY ln.an DESC NULLS LAST, ln.luna DESC NULLS LAST, ln.detaliu_id DESC))[1] AS ultima
      FROM ln WHERE ln.cheie IS NOT NULL GROUP BY 1, 2),
  art AS (
    SELECT coalesce(b.proiect_id, dec.proiect_id) AS proiect_id, coalesce(b.cheie, dec.cheie) AS cheie, coalesce(b.tip_rand, 'articol') AS tip_rand,
           b.obiect_cod, b.obiect_nume, b.deviz_cod, b.deviz_nume, b.nr, b.cod, b.denumire, b.um,
           -- r10: UM-ul bazei ambiguu SAU diferit de UM-ul decontat pe cheie (aceeași validare unică ca RPC-ul / garda; un rând strecurat nu e prezentat ca sigur)
           (coalesce(b.um_incert, false) OR (b.cheie IS NOT NULL AND cardinality(public.fn_rest_decontat_um_decontat_diferit(b.proiect_id, b.cheie, b.um)) > 0)) AS um_incert, b.pret_unitar,
           coalesce(b.cantitate, 0) AS bc, coalesce(b.valoare, 0) AS bv, coalesce(dec.cant, 0) AS dc, coalesce(dec.val, 0) AS dv,
           coalesce(dec.situatii, 0) AS situatii, dec.ultima
      FROM b FULL JOIN dec ON dec.proiect_id = b.proiect_id AND dec.cheie = b.cheie),
  noi AS (
    SELECT ln.proiect_id, ln.tip_rand, ln.obiect_cod, ln.deviz_cod, ln.cod, ln.denumire, ln.um_n AS um,
           sum(ln.cantitate_perioada * ln.factor) AS dc, sum(ln.valoare) AS dv, count(DISTINCT ln.detaliu_id)::integer AS situatii,
           (array_agg(ln.nr_situatie ORDER BY ln.an DESC NULLS LAST, ln.luna DESC NULLS LAST, ln.detaliu_id DESC))[1] AS ultima
      FROM ln WHERE ln.cheie IS NULL GROUP BY 1, 2, 3, 4, 5, 6, 7)
  SELECT art.proiect_id, art.proiect_id::text || ':' || art.cheie, art.cheie, art.tip_rand, art.obiect_cod, art.obiect_nume, art.deviz_cod, art.deviz_nume,
         art.nr, art.cod, art.denumire, art.um, art.um_incert, art.pret_unitar, art.bc, art.bv, art.dc, art.dv, art.bc - art.dc, art.bv - art.dv,
         CASE WHEN art.bv <> 0 THEN round(art.dv / art.bv * 100, 1) END,
         (art.bv - art.dv < 0 OR art.bc - art.dc < 0), (art.dv = 0 AND art.dc = 0), art.situatii, art.ultima
    FROM art
  UNION ALL
  SELECT noi.proiect_id, noi.proiect_id::text || ':' || noi.tip_rand || ':' || md5(concat_ws('|', noi.obiect_cod, noi.deviz_cod, noi.cod, noi.denumire, noi.um)),
         NULL, noi.tip_rand, noi.obiect_cod, NULL, noi.deviz_cod, NULL, NULL, noi.cod, noi.denumire, noi.um, false, NULL,
         0, 0, noi.dc, noi.dv, -noi.dc, -noi.dv, NULL, (noi.dv > 0 OR noi.dc > 0), false, noi.situatii, noi.ultima
    FROM noi
$f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_calcul() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_calcul() TO authenticated;

-- sumele în bani pe obiect (nivel 'obiect') și pe proiect (nivel 'proiect'; obiect_cod NULL)
CREATE FUNCTION public.fn_rest_decontat_obiect_calcul()
RETURNS TABLE (proiect_id bigint, nivel text, obiect_cod text, obiect_nume text, baza_valoare numeric, decontat_valoare numeric, rest_valoare numeric,
               pct_decontat numeric, articole integer, articole_nedecontate integer, articole_peste integer, articole_noi integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT c.proiect_id, CASE WHEN grouping(c.obiect_cod) = 1 THEN 'proiect' ELSE 'obiect' END, CASE WHEN grouping(c.obiect_cod) = 1 THEN NULL ELSE c.obiect_cod END,
         CASE WHEN grouping(c.obiect_cod) = 1 THEN NULL ELSE min(c.obiect_nume) END,
         sum(c.baza_valoare), sum(c.decontat_valoare), sum(c.baza_valoare) - sum(c.decontat_valoare),
         CASE WHEN sum(c.baza_valoare) <> 0 THEN round(sum(c.decontat_valoare) / sum(c.baza_valoare) * 100, 1) END,
         (count(*) FILTER (WHERE c.cheie IS NOT NULL))::integer, (count(*) FILTER (WHERE c.cheie IS NOT NULL AND c.nedecontat))::integer,
         (count(*) FILTER (WHERE c.peste_oferta))::integer, (count(*) FILTER (WHERE c.cheie IS NULL))::integer
    FROM public.fn_rest_decontat_calcul() c
   GROUP BY GROUPING SETS ((c.proiect_id, c.obiect_cod), (c.proiect_id))
$f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_obiect_calcul() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_obiect_calcul() TO authenticated;

-- lipsurile: proiect fără ofertă, situație de plată fără detaliu, act adițional / notă fără deviz, rânduri neautorizate / vechi, decontat fără articol (r9),
-- UM-ul bazei diferit de cel decontat (r10)
CREATE FUNCTION public.fn_rest_decontat_lipsuri_calcul()
RETURNS TABLE (proiect_id bigint, tip text, referinta text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  WITH pr AS (SELECT e.id FROM public.executie_proiecte e WHERE public.fn_rest_decontat_drept(e.id, 'citire'))
  SELECT pr.id, 'fara_oferta', 'proiect ' || pr.id::text FROM pr
   WHERE NOT EXISTS (SELECT 1 FROM public.proiect_articole a WHERE a.proiect_id::bigint = pr.id AND a.sursa = 'contract_initial' AND a.activ)
  UNION ALL
  SELECT pr.id, 'sl_fara_detaliu', s.nr_situatie::text
    FROM pr JOIN public.executie_situatii_plata s ON s.proiect_id::bigint = pr.id
   WHERE NOT EXISTS (SELECT 1 FROM public.executie_sl_detaliu d WHERE d.proiect_id = pr.id AND d.activ
                       AND (d.sl_id = s.id::bigint OR d.nr_situatie = upper(btrim(regexp_replace(coalesce(s.nr_situatie::text, ''), '[[:space:]]+', ' ', 'g')))))
  UNION ALL
  SELECT pr.id, 'aa_fara_deviz', x.numar_act::text
    FROM pr JOIN public.executie_acte_aditionale x ON x.proiect_id::bigint = pr.id AND coalesce(x.activ, true)
   WHERE NOT EXISTS (SELECT 1 FROM public.proiect_articole a WHERE a.act_aditional_id = x.id::bigint AND a.activ)
  UNION ALL
  SELECT pr.id, 'nota_fara_deviz', n.tip || ' ' || n.numar
    FROM pr JOIN public.executie_note_modificare n ON n.proiect_id = pr.id AND n.activ
   WHERE NOT EXISTS (SELECT 1 FROM public.proiect_articole a WHERE a.nota_id = n.id AND a.activ)
  UNION ALL
  -- nota activă fără data aprobării: nu intră în bază până la aprobarea beneficiarului (și devizul ei nu se poate confirma)
  SELECT pr.id, 'nota_neaprobata', n.tip || ' ' || n.numar
    FROM pr JOIN public.executie_note_modificare n ON n.proiect_id = pr.id AND n.activ
   WHERE n.data_aprobare IS NULL
  UNION ALL
  -- rânduri active ale surselor cu flux (AA / NR / NCS) fără legătură sau neconfirmate: nu intră în bază și se declară (L12); pe căile normale nu
  -- pot apărea (CHECK + gardă) — apărare în adâncime, pe sursă, cu numărul de rânduri
  SELECT pr.id, 'rand_neautorizat', a.sursa::text || ': ' || count(*)::text
    FROM pr JOIN public.proiect_articole a ON a.proiect_id::bigint = pr.id AND a.activ
   WHERE NOT public.fn_rest_decontat_sursa_autorizata(a.sursa::text, a.nota_id, a.act_aditional_id, a.confirmat_la)
   GROUP BY pr.id, a.sursa
  UNION ALL
  -- r4 / r5: rânduri contract_initial ACTIVE și neconfirmate pe un OBIECT cu oferta CONFIRMATĂ (calea veche, strecurate pe lângă gardă): nu intră
  -- în bază (calculul le ignoră) și se declară, pe obiect, cu numărul lor (L12)
  SELECT pr.id, 'oferta_veche_neconfirmata', 'contract_initial: ' || count(*)::text || ' (obiect ' || coalesce(min(a.obiect_cod::text), '-') || ')'
    FROM pr JOIN public.proiect_articole a ON a.proiect_id::bigint = pr.id AND a.activ AND a.sursa = 'contract_initial' AND a.confirmat_la IS NULL
   WHERE public.fn_rest_decontat_obiect_confirmat(pr.id, a.obiect_cod::text)
   GROUP BY pr.id, public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL)
  UNION ALL
  -- r5 (decizia chat-ului): obiectele încă „vechi” (rânduri contract_initial active, neconfirmate, pe un obiect fără ofertă confirmată) intră în
  -- bază pe calea veche, dar se declară: oferta lor nu e confirmată în Rest de decontat (L12), pe obiect, cu numărul rândurilor
  SELECT pr.id, 'oferta_neconfirmata', 'obiect ' || coalesce(min(a.obiect_cod::text), '-') || ': contract_initial ' || count(*)::text
    FROM pr JOIN public.proiect_articole a ON a.proiect_id::bigint = pr.id AND a.activ AND a.sursa = 'contract_initial' AND a.confirmat_la IS NULL
   WHERE NOT public.fn_rest_decontat_obiect_confirmat(pr.id, a.obiect_cod::text)
   GROUP BY pr.id, public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL)
  UNION ALL
  -- r9 (review #1158, 2 × P1 pe r8): decontat ACTIV a cărui cheie nu mai are BAZĂ (oferta înlocuită fără linia lui, listă completă AA care n-o mai conține,
  -- AA / notă dezactivate, rândul vechi șters / retras / mutat pe calea veche): calculul îl ține în totaluri (rândul cu bază 0), dar NU rămâne ascuns acolo —
  -- se declară pe cheie, cu valoarea, numărul liniilor și situațiile (L12); baza = aceeași definiție ca restul (fn_rest_decontat_baza_proiect), o dată pe proiect
  SELECT pr.id, 'decontat_fara_articol', r.cheie || ': ' || r.valoare::text || ' lei, ' || r.linii::text || ' linii (situatiile ' || array_to_string(r.situatii, ', ') || ')'
    FROM pr CROSS JOIN LATERAL (SELECT coalesce(array_agg(b.cheie), ARRAY[]::text[]) AS chei FROM public.fn_rest_decontat_baza_proiect(pr.id) b) bz
            CROSS JOIN LATERAL public.fn_rest_decontat_chei_referite(pr.id) r
   WHERE NOT (r.cheie = ANY (bz.chei))
  UNION ALL
  -- r10 (review #1158, P1 pe r9): o cheie a BAZEI al cărei UM diferă de UM-ul DECONTAT pe ea (un rând strecurat pe lângă RPC / gardă): decontatul în M nu se
  -- prezintă ca rest în MC — se declară pe cheie, cu UM-ul bazei și cel decontat (L12); aceeași validare unică (fn_rest_decontat_um_decontat_diferit)
  SELECT pr.id, 'decontat_um_diferit', b.cheie || ': baza ' || coalesce(nullif(b.um, ''), '-') || ', decontat ' || array_to_string(d.u, ' / ')
    FROM pr CROSS JOIN LATERAL public.fn_rest_decontat_baza_proiect(pr.id) b
            CROSS JOIN LATERAL (SELECT public.fn_rest_decontat_um_decontat_diferit(pr.id, b.cheie, b.um) AS u) d
   WHERE cardinality(d.u) > 0
$f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_lipsuri_calcul() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_lipsuri_calcul() TO authenticated;

CREATE VIEW public.v_executie_rest_decontat_baza WITH (security_invoker = on) AS SELECT b.* FROM public.fn_rest_decontat_baza_calcul() b;
CREATE VIEW public.v_executie_rest_decontat WITH (security_invoker = on) AS SELECT c.* FROM public.fn_rest_decontat_calcul() c;
CREATE VIEW public.v_executie_rest_decontat_obiect WITH (security_invoker = on) AS SELECT o.* FROM public.fn_rest_decontat_obiect_calcul() o;
CREATE VIEW public.v_executie_rest_decontat_lipsuri WITH (security_invoker = on) AS SELECT l.* FROM public.fn_rest_decontat_lipsuri_calcul() l;
COMMENT ON VIEW public.v_executie_rest_decontat IS 'Rest de decontat pe (proiect, articol): bază, decontat, rest, %, peste_oferta, nedecontat; doar proiectele pe care apelantul le poate citi (fn_rest_decontat_drept). 20270105a.';
REVOKE ALL ON public.v_executie_rest_decontat_baza, public.v_executie_rest_decontat, public.v_executie_rest_decontat_obiect, public.v_executie_rest_decontat_lipsuri
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_executie_rest_decontat_baza, public.v_executie_rest_decontat, public.v_executie_rest_decontat_obiect, public.v_executie_rest_decontat_lipsuri TO authenticated;

-- ─── 10. confirmarea bazei: oferta / devizul unui AA / devizul unei NR-NCS, într-o tranzacție ─────────────────────────────────
-- p_linii = FIE tabloul liniilor [{obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod, denumire, um, cantitate, pret_unitar, valoare, tip_rand}]
-- (numere JSON), FIE obiectul {linii: [...tabloul...], accept_schimbare_um: boolean} (r6; singurele chei acceptate; accept_schimbare_um doar la ofertă).
-- Cheia se calculează aici (nr intră doar când obiect + deviz + cod se repetă în document). p_inlocuieste (r5, doar la ofertă): re-importul unui
-- OBIECT deja confirmat cere adevărat explicit (altfel 23505); adevărat fără niciun obiect confirmat în document = 22023.
-- ORDINEA (r6): validări (formă, chei, formele brute ale cheii — r7 —, UM față de baza ANTERIOARĂ și de decontat, reprezentarea pe cheie, legăturile
-- unităților) → mutarea rândurilor vechi în istoric → INSERT; orice refuz vine înaintea oricărei scrieri.
-- Rezultat: {inserate, ids, sursa, mod_import, inlocuite, inlocuite_confirmate, obiecte, um_schimbate} — inlocuite = rândurile contract_initial ale
-- obiectelor din document mutate în istoric (din care inlocuite_confirmate fuseseră confirmate), obiecte = identitățile canonice ale obiectelor importate,
-- um_schimbate = cheile scrise cu alt UM normalizat decât în baza anterioară (doar cu accept_schimbare_um).
CREATE FUNCTION public.fn_rest_decontat_confirma_baza(p_proiect bigint, p_sursa text, p_act_aditional_id bigint, p_nota_id bigint, p_mod text,
                                                      p_fisier text, p_amprenta text, p_linii jsonb, p_inlocuieste boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid(); v_mod text := p_mod; v_nivel text; v_act_nr text; v_n integer; v_ids bigint[]; v_data_nota date; v_inlocuite integer := 0;
  v_inlocuite_conf integer := 0; v_obiecte text[] := ARRAY[]::text[]; v_conf text[] := ARRAY[]::text[];
  v_linii jsonb; v_accept_um boolean := false; v_baza jsonb; v_rep_ob jsonb; v_scrie jsonb := '[]'::jsonb; v_um_schimbate text[] := ARRAY[]::text[];
  e jsonb; v_k text; v_tip text; v_cant numeric; v_val numeric; v_pret numeric; v_um text; v_um_n text; v_factor numeric; v_um_dec text[];
  v_um_rep text; v_factor_rep numeric; v_c numeric; v_p numeric;
  v_forme jsonb; v_f_id jsonb; v_f jsonb; v_nr_forme text[]; v_um_forme text[]; v_ob text; v_dz text; v_cod text; v_nr text;
  v_chei text[] := ARRAY[]::text[]; v_dub text[]; v_finale text[] := ARRAY[]::text[]; v_acum timestamptz := now();
  v_kb text; v_kn text; v_repetat boolean; v_ref text[]; v_ref_id text[]; v_orfane text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'rest_decontat: autentificare necesara' USING ERRCODE = '42501'; END IF;
  -- r6: p_linii = tabloul liniilor SAU obiectul {linii, accept_schimbare_um} (ca la fn_rest_decontat_confirma_situatie)
  IF jsonb_typeof(p_linii) = 'object' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_linii) k WHERE k NOT IN ('linii', 'accept_schimbare_um'))
       OR jsonb_typeof(p_linii->'accept_schimbare_um') NOT IN ('boolean', 'null') THEN
      RAISE EXCEPTION 'rest_decontat: obiectul p_linii are doar linii / accept_schimbare_um' USING ERRCODE = '22023';
    END IF;
    v_linii := p_linii->'linii'; v_accept_um := coalesce((p_linii->>'accept_schimbare_um')::boolean, false);
  ELSE
    v_linii := p_linii;
  END IF;
  IF p_proiect IS NULL OR p_sursa IS NULL OR p_amprenta IS NULL OR p_amprenta !~ '^[0-9a-f]{64}$' OR p_inlocuieste IS NULL
     OR v_linii IS NULL OR jsonb_typeof(v_linii) IS DISTINCT FROM 'array' OR jsonb_array_length(v_linii) NOT BETWEEN 1 AND 5000
     OR (p_fisier IS NOT NULL AND length(p_fisier) NOT BETWEEN 1 AND 1000) THEN
    RAISE EXCEPTION 'rest_decontat: parametri invalizi (proiect, sursa, amprenta sha256, linii 1..5000, inlocuieste)' USING ERRCODE = '22023';
  END IF;
  IF v_accept_um AND p_sursa IS DISTINCT FROM 'contract_initial' THEN
    RAISE EXCEPTION 'rest_decontat: accept_schimbare_um e doar pentru oferta (contract_initial); UM-ul devizului unui act / al unei note e cel al bazei' USING ERRCODE = '22023';
  END IF;
  IF p_sursa = 'contract_initial' THEN
    IF p_act_aditional_id IS NOT NULL OR p_nota_id IS NOT NULL OR coalesce(v_mod, 'lista_completa') <> 'lista_completa' THEN
      RAISE EXCEPTION 'rest_decontat: oferta nu are act / nota si e lista completa' USING ERRCODE = '22023';
    END IF;
    v_mod := 'lista_completa'; v_nivel := 'confirmare';
  ELSIF p_inlocuieste THEN
    RAISE EXCEPTION 'rest_decontat: „inlocuieste” e doar pentru oferta (contract_initial); devizul unui act / al unei note se inlocuieste printr-o decizie separata' USING ERRCODE = '22023';
  ELSIF p_sursa = 'act_aditional' THEN
    IF p_act_aditional_id IS NULL OR p_nota_id IS NOT NULL OR v_mod IS NULL OR v_mod NOT IN ('diferente', 'lista_completa') THEN
      RAISE EXCEPTION 'rest_decontat: devizul unui act aditional cere actul si modul de import (diferente / lista_completa)' USING ERRCODE = '22023';
    END IF;
    v_nivel := 'documente_baza';
  ELSIF p_sursa IN ('nota_renuntare', 'nota_comanda_suplimentara') THEN
    IF p_nota_id IS NULL OR p_act_aditional_id IS NOT NULL OR coalesce(v_mod, 'diferente') <> 'diferente' THEN
      RAISE EXCEPTION 'rest_decontat: devizul unei note cere nota si e „doar diferente”' USING ERRCODE = '22023';
    END IF;
    v_mod := 'diferente'; v_nivel := 'documente_baza';
  ELSE
    RAISE EXCEPTION 'rest_decontat: sursa necunoscuta' USING ERRCODE = '22023';
  END IF;
  IF NOT public.fn_rest_decontat_drept(p_proiect, v_nivel) THEN
    RAISE EXCEPTION 'rest_decontat: proiectul nu exista sau nu ai drept sa confirmi acest document' USING ERRCODE = '42501';
  END IF;
  -- lock-uri (L06): advisory pe proiect -> proiectul FOR SHARE -> actul / nota FOR SHARE -> INSERT
  PERFORM pg_advisory_xact_lock(hashtextextended('gazpet.rest_decontat:' || p_proiect::text, 0));
  PERFORM 1 FROM public.executie_proiecte x WHERE x.id = p_proiect FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rest_decontat: proiectul nu exista sau nu ai drept sa confirmi acest document' USING ERRCODE = '42501'; END IF;
  -- L01: dreptul se REVERIFICĂ după lock (instrucțiune nouă = snapshot nou: MP-ul / lista schimbate cât apelul aștepta lock-ul = refuz)
  IF NOT public.fn_rest_decontat_drept(p_proiect, v_nivel) THEN
    RAISE EXCEPTION 'rest_decontat: proiectul nu exista sau nu ai drept sa confirmi acest document' USING ERRCODE = '42501';
  END IF;
  IF p_act_aditional_id IS NOT NULL THEN
    SELECT a.numar_act::text INTO v_act_nr FROM public.executie_acte_aditionale a
     WHERE a.id::bigint = p_act_aditional_id AND a.proiect_id::bigint = p_proiect AND coalesce(a.activ, true) FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'rest_decontat: actul aditional nu e al proiectului sau e inactiv' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.proiect_articole a WHERE a.act_aditional_id = p_act_aditional_id AND a.activ) THEN
      RAISE EXCEPTION 'rest_decontat: actul aditional are deja un deviz confirmat (inlocuirea e o decizie separata)' USING ERRCODE = '23505';
    END IF;
  END IF;
  IF p_nota_id IS NOT NULL THEN
    SELECT n.data_aprobare INTO v_data_nota FROM public.executie_note_modificare n
     WHERE n.id = p_nota_id AND n.proiect_id = p_proiect AND n.activ AND n.tip = CASE p_sursa WHEN 'nota_renuntare' THEN 'NR' ELSE 'NCS' END FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'rest_decontat: nota nu e a proiectului, e inactiva sau are alt tip decat sursa' USING ERRCODE = '22023'; END IF;
    -- decizia (r2): devizul unei note se confirmă DOAR după aprobarea beneficiarului (data_aprobare); până atunci nota e „nota_neaprobata” în lipsuri
    IF v_data_nota IS NULL THEN
      RAISE EXCEPTION 'rest_decontat: nota nu are data aprobarii (nota_neaprobata); devizul ei intra in baza doar dupa aprobare' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.proiect_articole a WHERE a.nota_id = p_nota_id AND a.activ) THEN
      RAISE EXCEPTION 'rest_decontat: nota are deja un deviz confirmat (inlocuirea e o decizie separata)' USING ERRCODE = '23505';
    END IF;
  END IF;
  -- amprenta fișierului: în rândurile curente ȘI în istoric (r6, P2: un fișier înlocuit — rândurile lui retrase — rămâne „deja confirmat”; A → B → A = refuz)
  IF EXISTS (SELECT 1 FROM public.proiect_articole a WHERE a.proiect_id::bigint = p_proiect AND a.fisier_amprenta = p_amprenta)
     OR EXISTS (SELECT 1 FROM public.proiect_articole_istoric h WHERE h.proiect_id = p_proiect AND h.rand->>'fisier_amprenta' = p_amprenta) THEN
    RAISE EXCEPTION 'rest_decontat: acelasi fisier a fost deja confirmat pe acest proiect' USING ERRCODE = '23505';
  END IF;
  -- r4 / r5 (review #1158): STĂRILE OFERTEI, PE OBIECT. Obiectele documentului (identitatea canonică a obiectului, din liniile trimise; forma liniilor
  -- e verificată mai jos, orice refuz anulează totul). Un obiect deja CONFIRMAT (în proiect_articole sau în istoric) se re-importă DOAR cu
  -- p_inlocuieste = true (altfel 23505: înlocuirea e o decizie explicită); p_inlocuieste fără niciun obiect confirmat = 22023. Rândurile
  -- contract_initial ale obiectelor importate (vechi, neconfirmate — calea veche CatalogDevizPanel, ex. proiectul 4 — și, la „înlocuiește”, cele
  -- confirmate) sunt MUTATE în proiect_articole_istoric, sub advisory-ul proiectului, în aceeași tranzacție — DUPĂ validarea liniilor (r6: UM-ul se
  -- compară cu baza ANTERIOARĂ, cu rândurile înlocuite încă prezente, și cu decontatul). Obiectele NEIMPORTATE nu sunt atinse (rămân în bază cu
  -- valoarea veche, declarate în lipsuri, confirmabile mai târziu). Fără cumulare și fără rânduri retrase rămase în tabel.
  IF p_sursa = 'contract_initial' THEN
    SELECT coalesce(array_agg(z.k ORDER BY z.k), ARRAY[]::text[]),
           coalesce(array_agg(z.k ORDER BY z.k) FILTER (WHERE public.fn_rest_decontat_obiect_confirmat(p_proiect, z.o)), ARRAY[]::text[])
      INTO STRICT v_obiecte, v_conf
      FROM (SELECT public.fn_rest_decontat_cheie(x->>'obiect_cod', NULL, NULL, NULL) AS k, min(x->>'obiect_cod') AS o
              FROM jsonb_array_elements(v_linii) x GROUP BY 1) z;
    IF cardinality(v_conf) > 0 AND NOT p_inlocuieste THEN
      RAISE EXCEPTION 'rest_decontat: obiectele % au deja oferta confirmata; re-importul lor cere „inlocuieste” explicit (inlocuirea e o decizie separata)', array_to_string(v_conf, ', ') USING ERRCODE = '23505';
    END IF;
    IF p_inlocuieste AND cardinality(v_conf) = 0 THEN
      RAISE EXCEPTION 'rest_decontat: „inlocuieste” cere cel putin un obiect cu oferta confirmata in document; obiectele % nu au oferta confirmata (importa fara inlocuieste)', array_to_string(v_obiecte, ', ') USING ERRCODE = '22023';
    END IF;
  END IF;
  -- r7 (2): obiect_cod-ul unei chei NOI într-un obiect existent (toate sursele bazei): forma brută a rândurilor obiectului DOAR când e una singură
  -- (DevizVsExecutatTab nu primește un obiect „nou” pentru un articol nou), altfel a unității din proiect_unitati (20261208a: fn_executie_tinte_calcul face
  -- JOIN pe art.obiect_cod = u.obiect_cod brut — articolul nou intră în ținta unității), altfel lipsă (= se scrie cum vine, normalizat). Cheile EXISTENTE
  -- nu trec pe aici: ele copiază forma rândului cu aceeași cheie (mai jos).
  SELECT coalesce(jsonb_object_agg(z.k, z.ob), '{}'::jsonb) INTO v_rep_ob FROM (
    SELECT d.k, CASE WHEN f.n = 1 THEN f.ob ELSE u.ob END AS ob
      FROM (SELECT DISTINCT public.fn_rest_decontat_cheie(x->>'obiect_cod', NULL, NULL, NULL) AS k FROM jsonb_array_elements(v_linii) x) d
      LEFT JOIN LATERAL (SELECT count(DISTINCT a.obiect_cod::text) AS n, min(a.obiect_cod::text) AS ob FROM public.proiect_articole a
                          WHERE a.proiect_id::bigint = p_proiect AND a.obiect_cod IS NOT NULL
                            AND a.sursa IN ('contract_initial', 'act_aditional', 'nota_renuntare', 'nota_comanda_suplimentara')
                            AND public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL) = d.k) f ON true
      LEFT JOIN LATERAL (SELECT pu.obiect_cod::text AS ob FROM public.proiect_unitati pu WHERE pu.proiect_id::bigint = p_proiect AND pu.obiect_cod IS NOT NULL
                            AND public.fn_rest_decontat_cheie(pu.obiect_cod::text, NULL, NULL, NULL) = d.k
                          ORDER BY pu.id LIMIT 1) u ON true) z
   WHERE z.ob IS NOT NULL;
  -- r6 (1): baza ANTERIOARĂ, o singură evaluare (cu rândurile obiectelor care se vor înlocui): UM-ul normalizat al fiecărei chei + ambiguitatea lui
  SELECT coalesce(jsonb_object_agg(b.cheie, jsonb_build_object('um', b.um, 'incert', b.um_incert)), '{}'::jsonb) INTO v_baza
    FROM public.fn_rest_decontat_baza_proiect(p_proiect) b;
  -- forma liniilor: exact cheile cunoscute, numere JSON (L17), fără dubluri
  FOR e IN SELECT x FROM jsonb_array_elements(v_linii) x LOOP
    IF jsonb_typeof(e) IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('obiect_cod', 'obiect_nume', 'deviz_cod', 'deviz_nume', 'nr', 'cod', 'denumire', 'um',
                                                                       'cantitate', 'pret_unitar', 'valoare', 'tip_rand')) THEN
      RAISE EXCEPTION 'rest_decontat: linie cu alte campuri decat cele cunoscute' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(e->'cantitate') IS DISTINCT FROM 'number' OR jsonb_typeof(e->'valoare') IS DISTINCT FROM 'number'
       OR jsonb_typeof(e->'pret_unitar') NOT IN ('number', 'null') THEN
      RAISE EXCEPTION 'rest_decontat: cantitatea, valoarea si pretul sunt numere' USING ERRCODE = '22023';
    END IF;
    v_cant := (e->>'cantitate')::numeric; v_val := (e->>'valoare')::numeric; v_pret := (e->>'pret_unitar')::numeric;
    IF abs(v_cant) > 1000000000 OR v_cant <> round(v_cant, 6) OR abs(v_val) > 1000000000000 OR v_val <> round(v_val, 6)
       OR (v_pret IS NOT NULL AND (v_pret < 0 OR v_pret > 1000000000000 OR v_pret <> round(v_pret, 6))) THEN
      RAISE EXCEPTION 'rest_decontat: cantitate / valoare / pret in afara plajei sau cu prea multe zecimale' USING ERRCODE = '22023';
    END IF;
    IF v_mod = 'lista_completa' AND v_cant < 0 THEN
      RAISE EXCEPTION 'rest_decontat: o lista completa nu are cantitati negative' USING ERRCODE = '22023';
    END IF;
    v_tip := coalesce(e->>'tip_rand', 'articol');
    IF v_tip NOT IN ('articol', 'os', 'diverse') THEN RAISE EXCEPTION 'rest_decontat: tip_rand necunoscut' USING ERRCODE = '22023'; END IF;
    IF coalesce(e->>'um', '') !~ '[^[:space:]]' AND v_tip = 'articol' THEN RAISE EXCEPTION 'rest_decontat: articol fara UM' USING ERRCODE = '22023'; END IF;
    v_chei := v_chei || public.fn_rest_decontat_cheie(e->>'obiect_cod', e->>'deviz_cod', e->>'cod', NULL);
  END LOOP;
  -- TOATE cheile care se repetă în document (toate grupurile, nu doar primul: agregare pe grupuri, apoi un singur tablou) primesc și poziția (nr);
  -- într-un grup repetat fiecare linie trebuie să aibă nr (altfel cheile finale ar coincide), iar cheile finale trebuie să fie distincte
  SELECT coalesce(array_agg(z.k ORDER BY z.k), ARRAY[]::text[]) INTO STRICT v_dub
    FROM (SELECT k FROM unnest(v_chei) AS k GROUP BY k HAVING count(*) > 1) z;
  -- r9 (review #1158, 2 × P1 pe r8): cheile REFERITE ale proiectului (liniile situațiilor active; definiția unică fn_rest_decontat_chei_referite), citite o
  -- dată, sub advisory-ul proiectului (RPC-ul situațiilor ia același advisory, deci mulțimea nu se schimbă cât scriem)
  SELECT coalesce(array_agg(r.cheie ORDER BY r.cheie), ARRAY[]::text[]) INTO v_ref FROM public.fn_rest_decontat_chei_referite(p_proiect) r;
  FOR e IN SELECT x FROM jsonb_array_elements(v_linii) x LOOP
    v_kb := public.fn_rest_decontat_cheie(e->>'obiect_cod', e->>'deviz_cod', e->>'cod', NULL);
    v_repetat := v_kb = ANY (v_dub);
    IF v_repetat AND coalesce(e->>'nr', '') !~ '[^[:space:]]' THEN
      RAISE EXCEPTION 'rest_decontat: codul % se repeta in document si o linie nu are pozitie (nr) — pozitii lipsa', e->>'cod' USING ERRCODE = '22023';
    END IF;
    v_kn := CASE WHEN coalesce(e->>'nr', '') ~ '[^[:space:]]' THEN public.fn_rest_decontat_cheie(e->>'obiect_cod', e->>'deviz_cod', e->>'cod', e->>'nr') END;
    -- regula poziției (r2): nr intră în cheie doar când codul se repetă în document
    v_k := CASE WHEN v_repetat THEN v_kn ELSE v_kb END;
    -- r9: IDENTITATEA REFERITĂ ARE PRIORITATE față de regula poziției. Cheile referite ale identității liniei (obiect | deviz | cod): cheia fără poziție sau
    -- cu orice poziție. Dacă linia ar primi altă cheie decât una referită a identității ei: (a) codul se repetă acum, dar situațiile stau pe cheia FĂRĂ poziție
    -- → nicio linie n-ar mai purta cheia referită → REFUZ (ambiguu, reproducerea 1 pe RPC); (b) linia are poziția unei chei referite (#n) deși codul nu se mai
    -- repetă → păstrează #n (reproducerea 2 Jakarinos r8: „#1 → fără poziție” nu se mai întâmplă); (c) linia FĂRĂ poziție (devizele AA / NR / NCS) și o singură
    -- cheie referită a identității → o primește pe ea; (d) linia fără poziție și mai multe chei referite → REFUZ (ambiguu); (e) linia are o poziție pe care
    -- nicio situație n-o folosește → cheie nouă pentru poziția ei (cheile referite rămase fără linie nu dispar tăcut: lipsurile le declară, decontat_fara_articol,
    -- iar rezultatul le întoarce în decontat_fara_baza). Refuzul vine înaintea oricărei scrieri, cu cheia, situațiile și ce ar fi devenit.
    SELECT coalesce(array_agg(r ORDER BY r), ARRAY[]::text[]) INTO v_ref_id FROM unnest(v_ref) r WHERE r = v_kb OR left(r, length(v_kb) + 2) = v_kb || '|#';
    IF cardinality(v_ref_id) > 0 AND NOT (v_k = ANY (v_ref_id)) THEN
      IF v_repetat AND v_kb = ANY (v_ref_id) THEN
        RAISE EXCEPTION 'rest_decontat: cheia % e referita de situatiile confirmate (%) si codul % se repeta acum in document (ar fi devenit %): nicio linie n-ar mai purta cheia decontata; un articol decontat nu se desparte in pozitii — trimite o singura linie pe acest cod sau inlocuieste intai situatiile (cheie_referita)',
          v_kb, (SELECT array_to_string(r.situatii, ', ') FROM public.fn_rest_decontat_chei_referite(p_proiect) r WHERE r.cheie = v_kb), e->>'cod',
          (SELECT string_agg(public.fn_rest_decontat_cheie(x->>'obiect_cod', x->>'deviz_cod', x->>'cod', x->>'nr'), ', ') FROM jsonb_array_elements(v_linii) x
             WHERE public.fn_rest_decontat_cheie(x->>'obiect_cod', x->>'deviz_cod', x->>'cod', NULL) = v_kb) USING ERRCODE = '22023';
      ELSIF v_kn IS NOT NULL AND v_kn = ANY (v_ref_id) THEN
        v_k := v_kn;
      ELSIF v_kn IS NULL AND cardinality(v_ref_id) = 1 THEN
        v_k := v_ref_id[1];
      ELSIF v_kn IS NULL THEN
        RAISE EXCEPTION 'rest_decontat: linia % fara pozitie (nr) e ambigua: identitatea ei are mai multe chei referite de situatii confirmate (%) si ar fi devenit %; trimite linia cu pozitia cheii decontate (cheie_referita)',
          e->>'cod', (SELECT string_agg(r.cheie || ' (situatiile ' || array_to_string(r.situatii, ', ') || ')', ', ' ORDER BY r.cheie) FROM public.fn_rest_decontat_chei_referite(p_proiect) r WHERE r.cheie = ANY (v_ref_id)),
          v_k USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v_k = ANY (v_finale) THEN
      RAISE EXCEPTION 'rest_decontat: cheia % apare de doua ori in document (acelasi cod cu aceeasi pozitie) — pozitii duplicate', v_k USING ERRCODE = '22023';
    END IF;
    v_finale := v_finale || v_k;
    SELECT x.um, x.factor INTO v_um_n, v_factor FROM public.fn_rest_decontat_um(e->>'um') x;
    -- r7 (2): FORMELE BRUTE ale cheii în rândurile existente ale proiectului (toate sursele bazei, active sau nu — tot ce văd cititorii vechi —, inclusiv
    -- rândurile care se vor înlocui), pe trei grupuri de câmpuri: (a) identitatea obiect / deviz / cod — exact UNA pe cheie (rândurile aceleiași chei din
    -- documente diferite o poartă identic, copiată de aici); (b) nr — r8 (review #1158, P2 pe r7): formele TUTUROR rândurilor cheii, orice poziție (poziția
    -- nu participă la identitate, dar e citită: catalogul ordonează pe nr) — poziții diferite stocate sub aceeași cheie = forme multiple; o linie care vine
    -- cu altă poziție decât cea unică existentă e refuzată mai jos (nr_schimbat), linia fără nr (devizele AA „doar diferențe”) copiază poziția existentă;
    -- (c) UM — formele rândurilor cu ACELAȘI UM normalizat ca linia.
    -- Într-un grup, exact una = copiată mai jos; MAI MULTE = ambiguitate → refuz înaintea oricărei retrageri (documentul nu poate alege ce văd cititorii
    -- existenți); niciuna = cheie nouă (sau UM nou), scrisă cum vine, normalizată
    SELECT coalesce(jsonb_agg(z.f ORDER BY z.f::text), '[]'::jsonb) INTO v_forme FROM (
      SELECT DISTINCT jsonb_build_object('obiect_cod', a.obiect_cod::text, 'deviz_cod', a.deviz_cod::text, 'cod', a.cod::text, 'nr', a.nr::text, 'um', a.um::text) AS f
        FROM public.proiect_articole a
       WHERE a.proiect_id::bigint = p_proiect AND a.cheie = v_k
         AND a.sursa IN ('contract_initial', 'act_aditional', 'nota_renuntare', 'nota_comanda_suplimentara')) z;
    SELECT coalesce(jsonb_agg(DISTINCT (f - 'nr' - 'um')), '[]'::jsonb) INTO v_f_id FROM jsonb_array_elements(v_forme) f;
    SELECT coalesce(array_agg(DISTINCT f->>'nr'), ARRAY[]::text[]) INTO v_nr_forme FROM jsonb_array_elements(v_forme) f;
    SELECT coalesce(array_agg(DISTINCT f->>'um'), ARRAY[]::text[]) INTO v_um_forme FROM jsonb_array_elements(v_forme) f
     WHERE f->>'um' IS NOT NULL AND (SELECT x.um FROM public.fn_rest_decontat_um(f->>'um') x) = v_um_n;
    IF jsonb_array_length(v_f_id) > 1 OR cardinality(v_nr_forme) > 1 OR cardinality(v_um_forme) > 1 THEN
      RAISE EXCEPTION 'rest_decontat: cheia % exista in randurile proiectului in mai multe forme brute (obiect / deviz / cod / nr / UM): %; documentul nu poate alege reprezentarea cititorilor existenti — randurile existente se aduc intai la o singura forma (forme_multiple)',
        v_k, (SELECT string_agg(concat_ws('/', coalesce(f->>'obiect_cod', '-'), coalesce(f->>'deviz_cod', '-'), coalesce(f->>'cod', '-'), coalesce(f->>'nr', '-'), coalesce(f->>'um', '-')), ' | ') FROM jsonb_array_elements(v_forme) f)
        USING ERRCODE = '22023';
    END IF;
    -- r8 (P2): poziția unei chei EXISTENTE nu se schimbă la confirmare — linia cu o poziție canonic diferită de cea unică a rândurilor cheii = refuz,
    -- înaintea oricărei scrieri; linia fără poziție o copiază pe cea existentă (mai jos)
    IF cardinality(v_nr_forme) = 1 AND coalesce(e->>'nr', '') ~ '[^[:space:]]'
       AND public.fn_rest_decontat_cheie(e->>'nr', NULL, NULL, NULL) IS DISTINCT FROM public.fn_rest_decontat_cheie(v_nr_forme[1], NULL, NULL, NULL) THEN
      RAISE EXCEPTION 'rest_decontat: cheia % are in randurile proiectului pozitia (nr) % si documentul o trimite cu pozitia %; pozitia unei chei existente nu se schimba la confirmare — trimite linia cu pozitia existenta sau fara pozitie (nr_schimbat)',
        v_k, coalesce(v_nr_forme[1], '-'), e->>'nr' USING ERRCODE = '22023';
    END IF;
    v_f := CASE WHEN jsonb_array_length(v_f_id) = 1 THEN v_f_id->0 END;
    -- r6 (1): UM-ul liniei față de baza ANTERIOARĂ (v_baza, cu rândurile care se vor înlocui) și față de DECONTATUL existent al cheii (liniile situațiilor
    -- active), ÎNAINTE de orice scriere; o cheie cu rânduri existente în afara bazei (inactive) are UM-ul lor, când e unul singur (r7)
    v_um := coalesce(v_baza->v_k->>'um', (SELECT x.um FROM jsonb_array_elements(v_forme) f CROSS JOIN LATERAL public.fn_rest_decontat_um(f->>'um') x
                                            WHERE f->>'um' IS NOT NULL GROUP BY x.um
                                           HAVING count(*) = (SELECT count(*) FROM jsonb_array_elements(v_forme) g WHERE g->>'um' IS NOT NULL)));
    -- r10 (review #1158, P1 pe r9): cheia cu cantități DECONTATE nu-și schimbă UM-ul normalizat pe NICIO sursă (ofertă, deviz AA, NR, NCS) — nici cu acceptare,
    -- nici după ce baza ei a dispărut (v_um NULL: articolul șters pe calea veche / înlocuit / scos de o listă completă): ACEEAȘI validare unică ca garda și
    -- lipsurile (fn_rest_decontat_um_decontat_diferit = UM-urile decontate diferite de cel al liniei); la ofertă, și UM-ul bazei anterioare al unei chei
    -- referite trebuie să fie cel al liniei (o bază ambiguă nu se „repară” pe o cheie decontată)
    v_um_dec := public.fn_rest_decontat_um_decontat_diferit(p_proiect, v_k, e->>'um');
    IF cardinality(v_um_dec) > 0 OR (v_k = ANY (v_ref) AND v_um IS NOT NULL AND v_um IS DISTINCT FROM v_um_n) THEN
      RAISE EXCEPTION 'rest_decontat: cheia % are cantitati decontate in UM % si nu-si poate schimba UM-ul (UM nou %); documentul se confirma cu acelasi UM sau cu unul echivalent prin factor, pe orice sursa (um_decontat)',
        v_k, CASE WHEN cardinality(v_um_dec) > 0 THEN array_to_string(v_um_dec, ' / ') ELSE v_um END || CASE WHEN cardinality(v_um_dec) > 0 AND v_um IS NOT NULL AND v_um <> ALL (v_um_dec) THEN ' (baza ' || v_um || ')' ELSE '' END,
        v_um_n USING ERRCODE = '22023';
    END IF;
    IF p_sursa = 'contract_initial' THEN
      -- cheie fără decontat, cu alt UM normalizat (sau UM ambiguu) în baza anterioară: doar cu acceptare explicită
      IF v_um IS NOT NULL AND (v_um IS DISTINCT FROM v_um_n OR (v_baza->v_k->>'incert')::boolean) THEN
        IF NOT v_accept_um THEN
          RAISE EXCEPTION 'rest_decontat: cheia % are in baza UM % si vine cu UM %; schimbarea UM-ului cere accept_schimbare_um explicit in p_linii (um_schimbat)',
            v_k, v_um || CASE WHEN (v_baza->v_k->>'incert')::boolean THEN ' (ambiguu)' ELSE '' END, v_um_n USING ERRCODE = '22023';
        END IF;
        v_um_schimbate := v_um_schimbate || v_k;
      END IF;
    ELSIF v_um IS NOT NULL AND v_um IS DISTINCT FROM v_um_n THEN
      -- devizul unui act / al unei note: UM-ul unei chei existente în bază trebuie să fie același
      RAISE EXCEPTION 'rest_decontat: UM diferit de UM-ul articolului din baza (cheia %)', v_k USING ERRCODE = '22023';
    END IF;
    -- r7 (2): REPREZENTAREA CHEII, PE FIECARE CÂMP citit de cititorii existenți (ActivitatiProiectPanel / verificariProiect: cod + cantitate; 20261208a:
    -- obiect_cod + cod + um + cantitate; CatalogDevizPanel: tot, ordonat pe obiect_cod / deviz_cod / nr; DevizVsExecutatTab: obiect_cod): cheie EXISTENTĂ →
    -- obiect_cod, deviz_cod, cod copiate EXACT din rândurile cu aceeași cheie; nr copiat EXACT din rândurile cheii (r8: forma unică a cheii, orice poziție — o
    -- poziție diferită a fost refuzată mai sus; doar o cheie fără rânduri existente ia poziția liniei, normalizată);
    -- UM-ul BRUT al rândului cu același UM normalizat, cu cantitatea și prețul convertite prin factor (1 HM pe o cheie în M → 100 M; 2 MC pe o cheie în
    -- „100 MC” → 0.02; nereprezentabil exact în 6 zecimale = refuz, L17); cheie NOUĂ → câmpurile cum vin, normalizate (trim, spațiile multiple → unul,
    -- literele neschimbate), obiect_cod-ul din v_rep_ob când obiectul există. UM-ul schimbat ACCEPTAT se scrie cum vine (normalizat).
    v_c := (e->>'cantitate')::numeric; v_p := (e->>'pret_unitar')::numeric; v_um_rep := NULL; v_factor_rep := NULL;
    IF v_f IS NOT NULL THEN
      v_ob := v_f->>'obiect_cod'; v_dz := v_f->>'deviz_cod'; v_cod := v_f->>'cod';
    ELSE
      v_ob := coalesce(v_rep_ob->>public.fn_rest_decontat_cheie(e->>'obiect_cod', NULL, NULL, NULL), btrim(regexp_replace(e->>'obiect_cod', '[[:space:]]+', ' ', 'g')));
      v_dz := btrim(regexp_replace(e->>'deviz_cod', '[[:space:]]+', ' ', 'g')); v_cod := btrim(regexp_replace(e->>'cod', '[[:space:]]+', ' ', 'g'));
    END IF;
    -- r10 (review #1158, P2 pe r9): linia FĂRĂ poziție care a primit unica cheie referită CU poziție a identității ei (#n), iar cheia nu mai are rânduri
    -- (articolul e în istoric): poziția se reconstruiește din cheia referită (forma canonică de după „|#”), altfel rândul ar purta o cheie care nu-i corespunde
    v_nr := CASE WHEN cardinality(v_nr_forme) = 1 THEN v_nr_forme[1]
                 WHEN v_kn IS NULL AND v_k <> v_kb THEN substr(v_k, length(v_kb) + 3)
                 ELSE btrim(regexp_replace(e->>'nr', '[[:space:]]+', ' ', 'g')) END;
    IF NOT (v_k = ANY (v_um_schimbate)) AND cardinality(v_um_forme) = 1 THEN
      v_um_rep := v_um_forme[1];
      SELECT x.factor INTO v_factor_rep FROM public.fn_rest_decontat_um(v_um_rep) x;
    END IF;
    IF v_um_rep IS NOT NULL AND v_factor_rep <> v_factor THEN
      v_c := v_c * v_factor / v_factor_rep; v_p := v_p * v_factor_rep / v_factor;
      IF v_c <> round(v_c, 6) OR (v_p IS NOT NULL AND v_p <> round(v_p, 6)) THEN
        RAISE EXCEPTION 'rest_decontat: cantitatea / pretul liniei % nu se pot reprezenta exact in UM-ul existent % (linia vine in %); trimite linia in UM-ul existent (um_nereprezentabil)',
          v_k, v_um_rep, e->>'um' USING ERRCODE = '22023';
      END IF;
      v_c := trim_scale(round(v_c, 6)); v_p := trim_scale(round(v_p, 6));
    END IF;
    v_scrie := v_scrie || jsonb_build_object(
      'obiect_cod', v_ob, 'obiect_nume', e->'obiect_nume', 'deviz_cod', v_dz, 'deviz_nume', e->'deviz_nume', 'nr', v_nr, 'cod', v_cod, 'denumire', e->'denumire',
      'um', coalesce(v_um_rep, btrim(regexp_replace(e->>'um', '[[:space:]]+', ' ', 'g'))), 'cantitate', v_c, 'pret_unitar', v_p, 'valoare', (e->>'valoare')::numeric,
      'tip_rand', coalesce(e->>'tip_rand', 'articol'), 'cheie', v_k, 'forma_veche', v_f);
  END LOOP;
  IF cardinality(v_finale) <> jsonb_array_length(v_linii) OR (SELECT count(DISTINCT f) FROM unnest(v_finale) f) <> jsonb_array_length(v_linii) THEN
    RAISE EXCEPTION 'rest_decontat: cheile finale nu sunt distincte' USING ERRCODE = '22023';
  END IF;
  -- r7 (2): nicio legătură EXISTENTĂ din proiect_unitati nu se mută (20261208a: JOIN pe art.obiect_cod = u.obiect_cod brut): pentru fiecare linie cu rând
  -- existent, rândul scris e în ținta fiecărei unități exact când era și rândul vechi — apărare în adâncime peste copierea de mai sus, înaintea oricărei scrieri
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_scrie) s
              JOIN public.proiect_unitati pu ON pu.proiect_id::bigint = p_proiect AND pu.obiect_cod IS NOT NULL
             WHERE jsonb_typeof(s->'forma_veche') = 'object'
               AND ((s->'forma_veche'->>'obiect_cod') IS NOT DISTINCT FROM pu.obiect_cod::text) IS DISTINCT FROM ((s->>'obiect_cod') IS NOT DISTINCT FROM pu.obiect_cod::text)) THEN
    RAISE EXCEPTION 'rest_decontat: reprezentarea scrisa ar muta legatura unei unitati din proiect_unitati (obiect_cod brut, JOIN-ul 20261208a); nimic scris (legatura_unitate)' USING ERRCODE = '22023';
  END IF;
  -- r5: rândurile contract_initial ale obiectelor importate sunt MUTATE în istoric (vechi = confirmare_oferta, confirmate = inlocuire_oferta), după
  -- validări, sub advisory-ul proiectului; nimic vechi nu rămâne în tabel pe obiectele importate
  IF p_sursa = 'contract_initial' THEN
    SET LOCAL gazpet.rest_decontat_scriitor = 'fn_rest_decontat_confirma_baza';
    WITH mut AS (
      DELETE FROM public.proiect_articole a
       WHERE a.proiect_id::bigint = p_proiect AND a.sursa = 'contract_initial'
         AND public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL) = ANY (v_obiecte)
       RETURNING a.*),
    ist AS (
      INSERT INTO public.proiect_articole_istoric (rand_id, proiect_id, obiect_k, sursa, confirmat_la, rand, retras_de, retras_la, motiv, inlocuit_cu_amprenta)
      SELECT m.id::bigint, p_proiect, public.fn_rest_decontat_cheie(m.obiect_cod::text, NULL, NULL, NULL), m.sursa::text, m.confirmat_la, to_jsonb(m), v_uid, v_acum,
             CASE WHEN m.confirmat_la IS NULL THEN 'confirmare_oferta' ELSE 'inlocuire_oferta' END, p_amprenta
        FROM mut m
      RETURNING confirmat_la)
    SELECT count(*)::integer, (count(*) FILTER (WHERE ist.confirmat_la IS NOT NULL))::integer INTO v_inlocuite, v_inlocuite_conf FROM ist;
    SET LOCAL gazpet.rest_decontat_scriitor = '';
    IF EXISTS (SELECT 1 FROM public.proiect_articole a WHERE a.proiect_id::bigint = p_proiect AND a.sursa = 'contract_initial'
                 AND public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL) = ANY (v_obiecte)) THEN
      RAISE EXCEPTION 'rest_decontat: randurile vechi ale obiectelor importate nu s-au putut muta in istoric' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- scrierea (marcajul static al tranzacției: garda proiect_articole lasă doar RPC-ul să pună coloanele de confirmare): liniile deja validate și aduse la
  -- reprezentarea existentă (v_scrie)
  SET LOCAL gazpet.rest_decontat_scriitor = 'fn_rest_decontat_confirma_baza';
  WITH ins AS (
    INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod, denumire, um, cantitate, valoare, pret_unitar,
                                         sursa, act_nr, cheie, nota_id, act_aditional_id, mod_import, activ, fisier_amprenta, confirmat_de, confirmat_la, tip_rand)
    SELECT p_proiect, x.obiect_cod, x.obiect_nume, x.deviz_cod, x.deviz_nume, x.nr, x.cod, x.denumire, x.um, x.cantitate, x.valoare, x.pret_unitar,
           p_sursa, v_act_nr, x.cheie, p_nota_id, p_act_aditional_id, v_mod, true, p_amprenta, v_uid, v_acum, x.tip_rand
      FROM jsonb_to_recordset(v_scrie) AS x(obiect_cod text, obiect_nume text, deviz_cod text, deviz_nume text, nr text, cod text, denumire text, um text,
                                            cantitate numeric, valoare numeric, pret_unitar numeric, tip_rand text, cheie text)
    RETURNING id)
  SELECT count(*)::integer, array_agg(ins.id::bigint ORDER BY ins.id) INTO v_n, v_ids FROM ins;
  SET LOCAL gazpet.rest_decontat_scriitor = '';
  IF v_n <> jsonb_array_length(v_linii) THEN RAISE EXCEPTION 'rest_decontat: randurile scrise nu corespund liniilor trimise' USING ERRCODE = 'P0001'; END IF;
  -- r9: cheile referite de situații care, DUPĂ această scriere, nu mai au bază (linia lor lipsește din oferta înlocuită / din lista completă a actului):
  -- nu dispar tăcut — se întorc apelantului (și lipsurile le declară, decontat_fara_articol)
  SELECT coalesce(array_agg(r.cheie ORDER BY r.cheie), ARRAY[]::text[]) INTO v_orfane
    FROM public.fn_rest_decontat_chei_referite(p_proiect) r
    LEFT JOIN LATERAL (SELECT array_agg(b.cheie) AS chei FROM public.fn_rest_decontat_baza_proiect(p_proiect) b) bz ON true
   WHERE NOT (r.cheie = ANY (coalesce(bz.chei, ARRAY[]::text[])));
  -- inlocuite = rândurile contract_initial ale obiectelor din document mutate în istoric (vechi la prima confirmare; inlocuite_confirmate dintre ele
  -- fuseseră confirmate — doar cu „înlocuiește”); 0 la devize AA / NR / NCS și la obiecte noi
  RETURN jsonb_build_object('inserate', v_n, 'ids', to_jsonb(v_ids), 'sursa', p_sursa, 'mod_import', v_mod, 'inlocuite', v_inlocuite,
                            'inlocuite_confirmate', v_inlocuite_conf, 'obiecte', to_jsonb(v_obiecte), 'um_schimbate', to_jsonb(v_um_schimbate),
                            'decontat_fara_baza', to_jsonb(v_orfane));
END $f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_confirma_baza(bigint, text, bigint, bigint, text, text, text, jsonb, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_confirma_baza(bigint, text, bigint, bigint, text, text, text, jsonb, boolean) TO authenticated;

-- ─── 11. confirmarea unei situații de lucrări detaliate (antet + linii într-o tranzacție) ───────────────────────────────────────
-- p_linii (CONTRACTUL pentru Task 4 / ecran, decizia chat-ului 21.11.2026): FIE tabloul liniilor [{obiect_cod, deviz_cod, nr, cod, denumire, um,
--   cantitate_perioada, cantitate_cumulat_doc, pret_unitar, valoare, cheie, tip_rand, potrivire}], FIE obiectul
--   {linii: [...tabloul de mai sus...], accept_diferenta: boolean, luna: number, an: number} — singurele chei acceptate; accept_diferenta = true
--   e singurul fel de a accepta o diferență peste prag față de situația de plată (planul: „cheia accept_diferenta în p_linii”); luna / an
--   (opționale) completează antetul când situația de plată nu le dă. Linie cu cheie = articol din bază (UM-ul normalizat egal);
--   articol_nou / fara_detaliu = fără cheie. total_referinta = valoarea de bază a situației de plată (p_sl_id); diferență > prag fără
--   accept_diferenta = refuz. Rezultat: {detaliu_id, versiune, inserate, total_citit, total_referinta, inlocuit_id}.
CREATE FUNCTION public.fn_rest_decontat_confirma_situatie(p_proiect bigint, p_nr_situatie text, p_sl_id bigint, p_fisier text, p_amprenta text,
                                                          p_linii jsonb, p_inlocuieste boolean, p_prag_diferenta numeric DEFAULT 1.00)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid(); v_nr text; v_linii jsonb; v_accept boolean := false; v_luna integer; v_an integer;
  v_ref numeric; v_total numeric := 0; v_vechi public.executie_sl_detaliu; v_id bigint; v_ver integer := 1; v_n integer;
  e jsonb; v_tip text; v_k text; v_um text; v_incert boolean; v_chei text[] := ARRAY[]::text[]; v_q numeric; v_v numeric; v_p numeric; v_c numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'rest_decontat: autentificare necesara' USING ERRCODE = '42501'; END IF;
  v_nr := upper(btrim(regexp_replace(coalesce(p_nr_situatie, ''), '[[:space:]]+', ' ', 'g')));
  IF p_proiect IS NULL OR v_nr = '' OR length(v_nr) > 80 OR p_amprenta IS NULL OR p_amprenta !~ '^[0-9a-f]{64}$' OR p_inlocuieste IS NULL
     OR p_prag_diferenta IS NULL OR p_prag_diferenta < 0 OR p_linii IS NULL OR (p_fisier IS NOT NULL AND length(p_fisier) NOT BETWEEN 1 AND 1000) THEN
    RAISE EXCEPTION 'rest_decontat: parametri invalizi (proiect, nr. situatie, amprenta sha256, inlocuieste, prag)' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_linii) = 'object' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_linii) k WHERE k NOT IN ('linii', 'accept_diferenta', 'luna', 'an'))
       OR jsonb_typeof(p_linii->'accept_diferenta') NOT IN ('boolean', 'null') OR jsonb_typeof(p_linii->'luna') NOT IN ('number', 'null')
       OR jsonb_typeof(p_linii->'an') NOT IN ('number', 'null') THEN
      RAISE EXCEPTION 'rest_decontat: obiectul p_linii are doar linii / accept_diferenta / luna / an' USING ERRCODE = '22023';
    END IF;
    v_linii := p_linii->'linii'; v_accept := coalesce((p_linii->>'accept_diferenta')::boolean, false);
    v_luna := (p_linii->>'luna')::integer; v_an := (p_linii->>'an')::integer;
  ELSE
    v_linii := p_linii;
  END IF;
  IF v_linii IS NULL OR jsonb_typeof(v_linii) IS DISTINCT FROM 'array' OR jsonb_array_length(v_linii) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'rest_decontat: liniile sunt un tablou de 1..5000 elemente' USING ERRCODE = '22023';
  END IF;
  IF NOT public.fn_rest_decontat_drept(p_proiect, 'confirmare') THEN
    RAISE EXCEPTION 'rest_decontat: proiectul nu exista sau nu ai drept sa confirmi situatii' USING ERRCODE = '42501';
  END IF;
  -- lock-uri (L06): advisory pe proiect -> proiectul FOR SHARE -> situatia de plata FOR SHARE -> versiunea activa FOR UPDATE -> INSERT
  PERFORM pg_advisory_xact_lock(hashtextextended('gazpet.rest_decontat:' || p_proiect::text, 0));
  PERFORM 1 FROM public.executie_proiecte x WHERE x.id = p_proiect FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rest_decontat: proiectul nu exista sau nu ai drept sa confirmi situatii' USING ERRCODE = '42501'; END IF;
  -- L01: dreptul se REVERIFICĂ după lock (MP-ul / lista schimbate cât apelul aștepta lock-ul = refuz)
  IF NOT public.fn_rest_decontat_drept(p_proiect, 'confirmare') THEN
    RAISE EXCEPTION 'rest_decontat: proiectul nu exista sau nu ai drept sa confirmi situatii' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.proiect_articole a WHERE a.proiect_id::bigint = p_proiect AND a.sursa = 'contract_initial' AND a.activ) THEN
    RAISE EXCEPTION 'rest_decontat: proiectul nu are oferta financiara confirmata (fara_baza)' USING ERRCODE = 'P0001';
  END IF;
  IF p_sl_id IS NOT NULL THEN
    SELECT s.valoare_baza_lei::numeric, coalesce(v_luna, s.luna::integer), coalesce(v_an, s.an::integer) INTO v_ref, v_luna, v_an
      FROM public.executie_situatii_plata s WHERE s.id::bigint = p_sl_id AND s.proiect_id::bigint = p_proiect FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'rest_decontat: situatia de plata nu e a proiectului' USING ERRCODE = '22023'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_sl_detaliu d WHERE d.proiect_id = p_proiect AND d.amprenta = p_amprenta) THEN
    RAISE EXCEPTION 'rest_decontat: acelasi fisier a fost deja confirmat pe acest proiect (amprenta_existenta)' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_vechi FROM public.executie_sl_detaliu d WHERE d.proiect_id = p_proiect AND d.nr_situatie = v_nr AND d.activ FOR UPDATE;
  IF FOUND THEN
    IF NOT p_inlocuieste THEN
      RAISE EXCEPTION 'rest_decontat: situatia % exista deja (versiunea %); inlocuirea cere confirmare explicita (situatie_existenta)', v_nr, v_vechi.versiune USING ERRCODE = '23505';
    END IF;
    v_ver := v_vechi.versiune + 1;
  ELSIF p_inlocuieste THEN
    RAISE EXCEPTION 'rest_decontat: nu exista o situatie activa de inlocuit pentru nr. %', v_nr USING ERRCODE = '22023';
  END IF;
  -- liniile: forma, numerele, cheia din bază cu același UM, fără dubluri
  FOR e IN SELECT x FROM jsonb_array_elements(v_linii) x LOOP
    IF jsonb_typeof(e) IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('obiect_cod', 'deviz_cod', 'nr', 'cod', 'denumire', 'um', 'cantitate_perioada',
                                                                       'cantitate_cumulat_doc', 'pret_unitar', 'valoare', 'cheie', 'tip_rand', 'potrivire')) THEN
      RAISE EXCEPTION 'rest_decontat: linie cu alte campuri decat cele cunoscute' USING ERRCODE = '22023';
    END IF;
    v_tip := coalesce(e->>'tip_rand', 'articol');
    IF v_tip NOT IN ('articol', 'articol_nou', 'os', 'diverse', 'fara_detaliu') THEN RAISE EXCEPTION 'rest_decontat: tip_rand necunoscut' USING ERRCODE = '22023'; END IF;
    IF jsonb_typeof(e->'valoare') IS DISTINCT FROM 'number' OR jsonb_typeof(e->'cantitate_perioada') NOT IN ('number', 'null')
       OR jsonb_typeof(e->'cantitate_cumulat_doc') NOT IN ('number', 'null') OR jsonb_typeof(e->'pret_unitar') NOT IN ('number', 'null') THEN
      RAISE EXCEPTION 'rest_decontat: valoarea, cantitatile si pretul sunt numere' USING ERRCODE = '22023';
    END IF;
    v_q := coalesce((e->>'cantitate_perioada')::numeric, CASE WHEN v_tip = 'fara_detaliu' THEN 0 END); v_v := (e->>'valoare')::numeric;
    v_p := (e->>'pret_unitar')::numeric; v_c := (e->>'cantitate_cumulat_doc')::numeric;
    IF v_q IS NULL OR abs(v_q) > 1000000000 OR v_q <> round(v_q, 6) OR abs(v_v) > 1000000000000 OR v_v <> round(v_v, 6)
       OR (v_p IS NOT NULL AND (v_p < 0 OR v_p > 1000000000000 OR v_p <> round(v_p, 6)))
       OR (v_c IS NOT NULL AND (abs(v_c) > 1000000000 OR v_c <> round(v_c, 6))) THEN
      RAISE EXCEPTION 'rest_decontat: cantitate / valoare / pret lipsa, in afara plajei sau cu prea multe zecimale' USING ERRCODE = '22023';
    END IF;
    IF v_tip IN ('articol', 'os', 'diverse') THEN
      v_k := e->>'cheie';
      IF v_k IS NULL OR coalesce(e->>'potrivire', '') NOT IN ('exact', 'cod', 'descriere_confirmata', 'manual') THEN
        RAISE EXCEPTION 'rest_decontat: linia legata de un articol cere cheia si felul potrivirii' USING ERRCODE = '22023';
      END IF;
      IF v_k = ANY (v_chei) THEN RAISE EXCEPTION 'rest_decontat: articolul % apare de doua ori in situatie', v_k USING ERRCODE = '22023'; END IF;
      v_chei := v_chei || v_k;
      SELECT b.um, b.um_incert INTO v_um, v_incert FROM public.fn_rest_decontat_baza_proiect(p_proiect) b WHERE b.cheie = v_k;
      IF NOT FOUND THEN RAISE EXCEPTION 'rest_decontat: articolul % nu e in baza proiectului (marcheaza-l „articol nou” sau alege articolul)', v_k USING ERRCODE = '22023'; END IF;
      IF v_incert OR v_um IS DISTINCT FROM (SELECT x.um FROM public.fn_rest_decontat_um(e->>'um') x) THEN
        RAISE EXCEPTION 'rest_decontat: UM diferit de UM-ul articolului din baza (cheia %, baza %, situatie %) — de verificat (um_diferit)', v_k, v_um, e->>'um' USING ERRCODE = '22023';
      END IF;
    ELSE
      IF e->>'cheie' IS NOT NULL OR e->>'potrivire' IS NOT NULL THEN
        RAISE EXCEPTION 'rest_decontat: un articol nou / o situatie fara detaliu nu are cheie' USING ERRCODE = '22023';
      END IF;
      IF v_tip = 'articol_nou' AND coalesce(e->>'denumire', '') !~ '[^[:space:]]' THEN
        RAISE EXCEPTION 'rest_decontat: articolul nou cere denumire' USING ERRCODE = '22023';
      END IF;
    END IF;
    v_total := v_total + v_v;
  END LOOP;
  IF v_ref IS NOT NULL AND abs(v_total - v_ref) > p_prag_diferenta AND NOT v_accept THEN
    RAISE EXCEPTION 'rest_decontat: totalul citit % difera de valoarea situatiei de plata % cu peste % (accept_diferenta lipseste)', v_total, v_ref, p_prag_diferenta USING ERRCODE = '22023';
  END IF;
  -- scrierea (marcajul static al tranzacției)
  SET LOCAL gazpet.rest_decontat_scriitor = 'fn_rest_decontat_confirma_situatie';
  IF v_vechi.id IS NOT NULL THEN
    UPDATE public.executie_sl_detaliu SET activ = false WHERE id = v_vechi.id AND activ;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'rest_decontat: versiunea veche nu s-a putut dezactiva' USING ERRCODE = 'P0001'; END IF;
  END IF;
  INSERT INTO public.executie_sl_detaliu (proiect_id, sl_id, nr_situatie, luna, an, fisier_path, amprenta, versiune, activ, inlocuieste_id, total_citit, total_referinta, confirmat_de, confirmat_la)
  VALUES (p_proiect, p_sl_id, v_nr, v_luna, v_an, p_fisier, p_amprenta, v_ver, true, v_vechi.id, v_total, v_ref, v_uid, now())
  RETURNING id INTO v_id;
  INSERT INTO public.executie_sl_detaliu_linii (detaliu_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate_perioada, cantitate_cumulat_doc, pret_unitar, valoare, cheie, tip_rand, potrivire)
  SELECT v_id, x.obiect_cod, x.deviz_cod, x.nr, x.cod, x.denumire, btrim(x.um), coalesce(x.cantitate_perioada, 0), x.cantitate_cumulat_doc, x.pret_unitar, x.valoare,
         x.cheie, coalesce(x.tip_rand, 'articol'), x.potrivire
    FROM jsonb_to_recordset(v_linii) AS x(obiect_cod text, deviz_cod text, nr text, cod text, denumire text, um text, cantitate_perioada numeric,
                                          cantitate_cumulat_doc numeric, pret_unitar numeric, valoare numeric, cheie text, tip_rand text, potrivire text);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  SET LOCAL gazpet.rest_decontat_scriitor = '';
  IF v_n <> jsonb_array_length(v_linii) THEN RAISE EXCEPTION 'rest_decontat: liniile scrise nu corespund celor trimise' USING ERRCODE = 'P0001'; END IF;
  RETURN jsonb_build_object('detaliu_id', v_id, 'versiune', v_ver, 'inserate', v_n, 'total_citit', v_total, 'total_referinta', v_ref, 'inlocuit_id', v_vechi.id);
END $f$;
REVOKE ALL ON FUNCTION public.fn_rest_decontat_confirma_situatie(bigint, text, bigint, text, text, jsonb, boolean, numeric) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_confirma_situatie(bigint, text, bigint, text, text, jsonb, boolean, numeric) TO authenticated;

-- ─── 12. Postcondiții + ștampilele porților Izometrie + POST ─────────────────────────────────────────────────────────────────
DO $post$
DECLARE v_amp text; v_n bigint;
  v_fn name[] := ARRAY['fn_rest_decontat_cheie', 'fn_rest_decontat_um', 'fn_rest_decontat_sursa_autorizata', 'fn_rest_decontat_drept', 'fn_rest_decontat_server', 'fn_rest_decontat_aa_al_proiectului',
    'fn_rest_decontat_are_oferta', 'fn_rest_decontat_obiect_confirmat', 'fn_rest_decontat_nota_garda', 'fn_rest_decontat_articole_garda', 'fn_rest_decontat_sl_garda', 'fn_rest_decontat_istoric_garda',
    'fn_rest_decontat_baza_proiect', 'fn_rest_decontat_baza_calcul', 'fn_rest_decontat_calcul', 'fn_rest_decontat_obiect_calcul', 'fn_rest_decontat_lipsuri_calcul', 'fn_rest_decontat_confirma_baza',
    'fn_rest_decontat_confirma_situatie', 'fn_rest_decontat_cheie_document', 'fn_rest_decontat_chei_referite', 'fn_rest_decontat_cheie_situatii',
    'fn_rest_decontat_um_decontat_diferit']::name[];
BEGIN
  -- RLS + politicile pe cele patru tabele noi
  IF (SELECT count(*) FROM pg_class c WHERE c.oid IN ('public.executie_note_modificare'::regclass, 'public.executie_sl_detaliu'::regclass, 'public.executie_sl_detaliu_linii'::regclass, 'public.proiect_articole_istoric'::regclass) AND c.relrowsecurity) <> 4
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_note_modificare' AND roles = '{authenticated}' AND permissive = 'PERMISSIVE'
           AND policyname IN ('executie_note_modificare_citire', 'executie_note_modificare_adauga', 'executie_note_modificare_modifica')) <> 3
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('executie_note_modificare', 'executie_sl_detaliu', 'executie_sl_detaliu_linii', 'proiect_articole_istoric')) <> 6
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_sl_detaliu' AND policyname = 'executie_sl_detaliu_citire' AND cmd = 'SELECT') <> 1
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_sl_detaliu_linii' AND policyname = 'executie_sl_detaliu_linii_citire' AND cmd = 'SELECT') <> 1
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'proiect_articole_istoric' AND policyname = 'proiect_articole_istoric_citire' AND cmd = 'SELECT' AND roles = '{authenticated}') <> 1 THEN
    RAISE EXCEPTION '20270105a post: RLS / politicile tabelelor noi';
  END IF;
  -- drepturile, pe rând: anon / service_role nimic; authenticated SELECT (+ INSERT / UPDATE doar pe note), niciun DELETE / TRUNCATE
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'service_role']) r(n), unnest(ARRAY['executie_note_modificare', 'executie_sl_detaliu', 'executie_sl_detaliu_linii', 'proiect_articole_istoric']) t(n),
                       unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(n)
              WHERE has_table_privilege(r.n, 'public.' || t.n, p.n))
     OR NOT has_table_privilege('authenticated', 'public.executie_note_modificare', 'SELECT') OR NOT has_table_privilege('authenticated', 'public.executie_note_modificare', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.executie_note_modificare', 'UPDATE') OR has_table_privilege('authenticated', 'public.executie_note_modificare', 'DELETE')
     OR NOT has_table_privilege('authenticated', 'public.executie_sl_detaliu', 'SELECT') OR has_table_privilege('authenticated', 'public.executie_sl_detaliu', 'INSERT')
     OR has_table_privilege('authenticated', 'public.executie_sl_detaliu', 'UPDATE') OR has_table_privilege('authenticated', 'public.executie_sl_detaliu', 'DELETE')
     OR NOT has_table_privilege('authenticated', 'public.executie_sl_detaliu_linii', 'SELECT') OR has_table_privilege('authenticated', 'public.executie_sl_detaliu_linii', 'INSERT')
     OR has_table_privilege('authenticated', 'public.executie_sl_detaliu_linii', 'UPDATE') OR has_table_privilege('authenticated', 'public.executie_sl_detaliu_linii', 'DELETE')
     OR NOT has_table_privilege('authenticated', 'public.proiect_articole_istoric', 'SELECT') OR has_table_privilege('authenticated', 'public.proiect_articole_istoric', 'INSERT')
     OR has_table_privilege('authenticated', 'public.proiect_articole_istoric', 'UPDATE') OR has_table_privilege('authenticated', 'public.proiect_articole_istoric', 'DELETE')
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['executie_note_modificare', 'executie_sl_detaliu', 'executie_sl_detaliu_linii', 'proiect_articole_istoric']) t(n)
                 WHERE has_table_privilege('authenticated', 'public.' || t.n, 'TRUNCATE'))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['v_executie_rest_decontat_baza', 'v_executie_rest_decontat', 'v_executie_rest_decontat_obiect', 'v_executie_rest_decontat_lipsuri']) v(n)
                 WHERE has_table_privilege('anon', 'public.' || v.n, 'SELECT') OR has_table_privilege('service_role', 'public.' || v.n, 'SELECT')
                    OR NOT has_table_privilege('authenticated', 'public.' || v.n, 'SELECT')
                    OR NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.' || v.n) AND 'security_invoker=on' = ANY (c.reloptions)))
     OR has_sequence_privilege('anon', 'public.executie_note_modificare_id_seq', 'USAGE') OR has_sequence_privilege('authenticated', 'public.executie_sl_detaliu_id_seq', 'USAGE')
     OR has_sequence_privilege('authenticated', 'public.executie_sl_detaliu_linii_id_seq', 'USAGE') OR NOT has_sequence_privilege('authenticated', 'public.executie_note_modificare_id_seq', 'USAGE')
     OR has_sequence_privilege('authenticated', 'public.proiect_articole_istoric_id_seq', 'USAGE') OR has_sequence_privilege('anon', 'public.proiect_articole_istoric_id_seq', 'USAGE') THEN
    RAISE EXCEPTION '20270105a post: privilegii pe tabele / vederi / secvente';
  END IF;
  -- funcțiile: toate cu search_path fix, owner postgres; DEFINER doar unde trebuie; EXECUTE doar pentru authenticated, nu pe funcțiile trigger
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_rest\_decontat\_%') <> 23
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_fn)
                 AND (p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] OR pg_get_userbyid(p.proowner) <> 'postgres'
                      OR p.prosecdef IS DISTINCT FROM (p.proname IN ('fn_rest_decontat_drept', 'fn_rest_decontat_aa_al_proiectului', 'fn_rest_decontat_are_oferta', 'fn_rest_decontat_obiect_confirmat',
                                                                     'fn_rest_decontat_baza_proiect', 'fn_rest_decontat_baza_calcul', 'fn_rest_decontat_calcul',
                                                                     'fn_rest_decontat_obiect_calcul', 'fn_rest_decontat_lipsuri_calcul', 'fn_rest_decontat_confirma_baza',
                                                                     'fn_rest_decontat_confirma_situatie', 'fn_rest_decontat_cheie_document', 'fn_rest_decontat_cheie_situatii',
                                                                     'fn_rest_decontat_um_decontat_diferit'))
                      OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')
                      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                         IS DISTINCT FROM (p.proname NOT IN ('fn_rest_decontat_nota_garda', 'fn_rest_decontat_articole_garda', 'fn_rest_decontat_sl_garda', 'fn_rest_decontat_istoric_garda', 'fn_rest_decontat_baza_proiect', 'fn_rest_decontat_chei_referite'))
                      OR (p.proname IN ('fn_rest_decontat_cheie', 'fn_rest_decontat_um', 'fn_rest_decontat_sursa_autorizata') AND p.provolatile <> 'i')
                      OR (p.proname IN ('fn_rest_decontat_confirma_baza', 'fn_rest_decontat_confirma_situatie', 'fn_rest_decontat_cheie_document') AND p.provolatile <> 'v')
                      OR (p.proname NOT IN ('fn_rest_decontat_cheie', 'fn_rest_decontat_um', 'fn_rest_decontat_sursa_autorizata', 'fn_rest_decontat_confirma_baza', 'fn_rest_decontat_confirma_situatie',
                                            'fn_rest_decontat_cheie_document', 'fn_rest_decontat_nota_garda', 'fn_rest_decontat_articole_garda', 'fn_rest_decontat_sl_garda', 'fn_rest_decontat_istoric_garda') AND p.provolatile <> 's'))) THEN
    RAISE EXCEPTION '20270105a post: functii (numar / definer / search_path / owner / EXECUTE / volatilitate)';
  END IF;
  -- trigger-ele exacte: BEFORE INSERT OR UPDATE OR DELETE, pe rând, active (tgtype 31 = ROW + BEFORE + INSERT + DELETE + UPDATE), fără WHEN / argumente
  IF (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgtype = 31 AND t.tgqual IS NULL AND t.tgnargs = 0 AND (t.tgrelid, t.tgname, t.tgfoid) IN (
        ('public.executie_note_modificare'::regclass, 'trg_rest_decontat_nota_garda', 'public.fn_rest_decontat_nota_garda()'::regprocedure),
        ('public.proiect_articole'::regclass, 'trg_rest_decontat_articole_garda', 'public.fn_rest_decontat_articole_garda()'::regprocedure),
        ('public.executie_sl_detaliu'::regclass, 'trg_rest_decontat_sl_garda', 'public.fn_rest_decontat_sl_garda()'::regprocedure),
        ('public.executie_sl_detaliu_linii'::regclass, 'trg_rest_decontat_sl_linii_garda', 'public.fn_rest_decontat_sl_garda()'::regprocedure),
        ('public.proiect_articole_istoric'::regclass, 'trg_rest_decontat_istoric_garda', 'public.fn_rest_decontat_istoric_garda()'::regprocedure))) <> 5
     OR (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname LIKE 'trg\_rest\_decontat\_%') <> 5 THEN
    RAISE EXCEPTION '20270105a post: trigger-ele';
  END IF;
  -- datele: toate rândurile existente au cheia (fără / cu nr, calculată aici), activ = true, nimic confirmat; tabelele noi goale; niciun proiect configurat
  SELECT count(*) INTO v_n FROM public.proiect_articole a
   WHERE a.cheie IS NULL OR a.activ IS NOT TRUE OR a.confirmat_la IS NOT NULL OR a.confirmat_de IS NOT NULL OR a.fisier_amprenta IS NOT NULL
      OR a.nota_id IS NOT NULL OR a.act_aditional_id IS NOT NULL OR a.mod_import IS NOT NULL OR a.tip_rand <> 'articol'
      OR a.cheie NOT IN (public.fn_rest_decontat_cheie(a.obiect_cod::text, a.deviz_cod::text, a.cod::text, NULL), public.fn_rest_decontat_cheie(a.obiect_cod::text, a.deviz_cod::text, a.cod::text, a.nr::text));
  IF v_n <> 0 OR EXISTS (SELECT 1 FROM public.executie_note_modificare) OR EXISTS (SELECT 1 FROM public.executie_sl_detaliu) OR EXISTS (SELECT 1 FROM public.executie_sl_detaliu_linii)
     OR EXISTS (SELECT 1 FROM public.proiect_articole_istoric)
     OR EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.configurare_completa_la IS NOT NULL OR e.configurare_exceptie_motiv IS NOT NULL) THEN
    RAISE EXCEPTION '20270105a post: datele (cheia pe randurile existente / tabele noi goale / proiecte neconfigurate): % randuri cu abateri', v_n;
  END IF;
  RAISE NOTICE '20270105a: randuri proiect_articole cu cheie = %, din care cu nr in cheie = %', (SELECT count(*) FROM public.proiect_articole),
    (SELECT count(*) FROM public.proiect_articole a WHERE a.cheie LIKE '%|#%');
  -- informativ (L12): rândurile MOȘTENITE a căror cheie finală se repetă în același document (poziție lipsă / dublată în fișierul vechi) se adună
  -- pe aceeași cheie în bază; nu se refuză (datele existente), dar se declară
  SELECT count(*) INTO v_n FROM (SELECT 1 FROM public.proiect_articole a GROUP BY a.proiect_id, a.sursa, coalesce(a.act_nr::text, ''), a.cheie HAVING count(*) > 1) d;
  RAISE NOTICE '20270105a: documente mostenite cu chei finale repetate (pozitii lipsa / duplicate in fisierul vechi) = %', v_n;
  -- AMPRENTA_20270105a_INCEPUT (blocul e IDENTIC în migrare și în revenire; proba PGlite compară textul)
  SELECT string_agg(x.l, chr(10) ORDER BY x.l COLLATE "C") INTO v_amp FROM (
    SELECT 'col ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull || ' def=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
           || ' id=' || a.attidentity::text || ' gen=' || a.attgenerated::text || ' acl=' || coalesce(a.attacl::text, '-') AS l
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE NOT a.attisdropped AND a.attnum > 0
       AND ((c.oid IN ('public.executie_note_modificare'::regclass, 'public.executie_sl_detaliu'::regclass, 'public.executie_sl_detaliu_linii'::regclass, 'public.proiect_articole_istoric'::regclass))
            OR (c.oid = 'public.proiect_articole'::regclass AND a.attname IN ('cheie', 'nota_id', 'act_aditional_id', 'mod_import', 'activ', 'fisier_amprenta', 'confirmat_de', 'confirmat_la', 'tip_rand'))
            OR (c.oid = 'public.executie_proiecte'::regclass AND a.attname IN ('configurare_completa_la', 'configurare_exceptie_motiv')))
    UNION ALL
    SELECT 'tab ' || c.relname || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity || ' acl=' || coalesce(c.relacl::text, '-') || ' own=' || pg_get_userbyid(c.relowner)
      FROM pg_class c WHERE c.oid IN ('public.executie_note_modificare'::regclass, 'public.executie_sl_detaliu'::regclass, 'public.executie_sl_detaliu_linii'::regclass, 'public.proiect_articole_istoric'::regclass)
    UNION ALL
    SELECT 'con ' || c.relname || '.' || k.conname || ' ' || k.contype::text || ' val=' || k.convalidated || ' defer=' || k.condeferrable || ' ' || pg_get_constraintdef(k.oid)
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
     WHERE k.contype <> 'n' AND (c.oid IN ('public.executie_note_modificare'::regclass, 'public.executie_sl_detaliu'::regclass, 'public.executie_sl_detaliu_linii'::regclass, 'public.proiect_articole_istoric'::regclass)
            OR k.conname IN ('proiect_articole_rd_mod_import_ck', 'proiect_articole_rd_tip_rand_ck', 'proiect_articole_rd_amprenta_ck', 'proiect_articole_rd_confirmat_ck',
                             'proiect_articole_rd_legaturi_ck', 'proiect_articole_nota_id_fkey', 'proiect_articole_act_aditional_id_fkey', 'executie_proiecte_configurare_motiv_ck'))
    UNION ALL
    SELECT 'idx ' || pg_get_indexdef(i.indexrelid) || ' nnd=' || i.indnullsnotdistinct || ' valid=' || i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
     WHERE c.oid IN ('public.executie_note_modificare'::regclass, 'public.executie_sl_detaliu'::regclass, 'public.executie_sl_detaliu_linii'::regclass, 'public.proiect_articole_istoric'::regclass)
        OR i.indexrelid::regclass::text IN ('proiect_articole_rd_cheie_ix', 'proiect_articole_rd_aa_ix', 'proiect_articole_rd_nota_ix')
    UNION ALL
    SELECT 'trg ' || pg_get_triggerdef(t.oid) || ' en=' || t.tgenabled::text
      FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname LIKE 'trg\_rest\_decontat\_%'
    UNION ALL
    SELECT 'pol ' || c.relname || '.' || p.polname || ' ' || p.polcmd::text || ' perm=' || p.polpermissive
           || ' roles=' || coalesce((SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) r), 'PUBLIC')
           || ' using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.oid IN ('public.executie_note_modificare'::regclass, 'public.executie_sl_detaliu'::regclass, 'public.executie_sl_detaliu_linii'::regclass, 'public.proiect_articole_istoric'::regclass)
    UNION ALL
    SELECT 'view ' || c.relname || ' opt=' || coalesce(array_to_string(c.reloptions, ';'), '-') || ' acl=' || coalesce(c.relacl::text, '-') || ' def=' || md5(pg_get_viewdef(c.oid))
      FROM pg_class c WHERE c.relkind = 'v' AND c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'v\_executie\_rest\_decontat%'
    UNION ALL
    SELECT 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid) || ' ' || l.lanname
           || ' kind=' || p.prokind::text || ' def=' || p.prosecdef || ' vol=' || p.provolatile::text || ' strict=' || p.proisstrict || ' leak=' || p.proleakproof
           || ' par=' || p.proparallel::text || ' cfg=' || coalesce(array_to_string(p.proconfig, ';'), '-') || ' own=' || pg_get_userbyid(p.proowner)
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '-')
           || ' src=' || md5(replace(p.prosrc, chr(13), ''))
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_rest\_decontat\_%'
  ) x;
  -- AMPRENTA_20270105a_SFARSIT
  IF md5(coalesce(v_amp, '')) IS DISTINCT FROM '0e486e7f35c6d77d8c7bba75f00204a6' THEN
    RAISE NOTICE 'AMPRENTA_20270105a_TEXT %', v_amp;
    RAISE EXCEPTION '20270105a post: AMPRENTA obiectelor % (asteptat 0e486e7f35c6d77d8c7bba75f00204a6)', md5(coalesce(v_amp, ''));
  END IF;
  -- ștampilele porților Izometrie, CALCULATE după ultima schimbare (coloanele noi pe executie_proiecte intră în E4b)
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L', 'porti_e3=' || public.fn_izo_porti_e3_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3b_definitii() IS %L', 'porti_e3b=' || public.fn_izo_porti_e3b_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4_definitii() IS %L', 'porti_e4=' || public.fn_izo_porti_e4_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS %L', 'porti_e4b=' || public.fn_izo_porti_e4b_definitii());
  -- IZO POST
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '20270105a post: portile Izometrie nu sunt verzi dupa: %', public.fn_izo_porti_lipsa();
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270105a_executie_rest_decontat:' || txid_current() THEN
    RAISE EXCEPTION '20270105a: garda final invalida';
  END IF;
  RAISE NOTICE '20270105a: sfarsit la % ms de la BEGIN; lock-urile tinute de % ms (pana la COMMIT se adauga pasul dupa al runnerului si garda: LOCK_TINUT)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;
