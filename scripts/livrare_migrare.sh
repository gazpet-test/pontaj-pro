#!/usr/bin/env bash
# ============================================================================
# Traseul OFICIAL de livrare pentru migrările cu gardă de livrare — runda 6 (verdict Copilot R5,
# docs/LIVRARE_MIGRARE_VERDICT_COPILOT_R5.md; arhitectura rundei 5 păstrată). Domeniu: DOAR operațiile care participă
# la tranzacția PostgreSQL.
#
# UN SINGUR gestionar de tranzacție = psql --single-transaction, pe O COPIE locală protejată a artefactului APROBAT:
#   0. înainte de conexiune: argumente pe listă albă, copie unică (mktemp, dir 700, fișier 400), sha256(copie) ==
#      sha256 APROBAT (--sha256 sau --aprobare), validatorul (scripts/livrare_validator.py) pe ACEEAȘI copie
#   P. PRE-VERIFICARE read-only (aceeași interogare ca reconcilierea): ținta (db + system_identifier [+ proiect]) și
#      istoricul (relevante / exacte) ⇒ ținta greșită = 22, pereche exactă existentă = 11, altceva relevant = 21 —
#      în toate trei cazurile livrarea NU se trimite.
#   Tranzacția (fișiere generate de runner, niciunul din artefact):
#   0_prolog: SET TRANSACTION ISOLATION LEVEL READ COMMITTED (PRIMA), SET LOCAL standard_conforming_strings = on,
#             SET LOCAL client_encoding = 'UTF8' (+ PGCLIENTENCODING=UTF8 la conexiune) și verificarea lor
#   1_pre:    pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare')) — instrucțiune SEPARATĂ, înaintea istoricului;
#             ținta: current_database() == --tinta-db, system_identifier == --tinta-sistem (OBLIGATORIU)
#             [+ current_setting('gazpet.proiect_aprobat') == --tinta-proiect, opțional];
#             istoricul: nici numele, nici versiunea în supabase_migrations.schema_migrations (snapshot nou după lock);
#             marcajul set_config('gazpet.livrare_migrare', '<nume>:' || txid_current(), true)
#   COPIA (corpul migrării; gărzile ei de start/final)
#   3_inreg:  INSERT în schema_migrations (statements = COPIA) + verificare sha256(statements[1]) == sha256 aprobat
#   Orice eroare ⇒ ROLLBACK la tot.
#
# Rezultat (cod de ieșire), stabilit după o RECONCILIERE read-only pe o conexiune nouă (READ COMMITTED explicit,
# așteaptă întâi lock-ul consultativ ⇒ tranzacția livrării s-a terminat; aceeași verificare a țintei ca livrarea):
#   0  APLICAT + ÎNREGISTRAT     exact 1 rând relevant și el e perechea exactă (nume + versiune + sha256 aprobat)
#   10 NEAPLICAT confirmat       0 rânduri relevante (nume SAU versiune) pe ținta confirmată, iar psql a raportat eroare
#   11 DEJA ÎNREGISTRAT          (pre-verificare) perechea exactă exista deja: „nu s-a reaplicat”
#   12 NEPORNIT                  pre-verificarea n-a putut rula ⇒ livrarea nu s-a trimis
#   20 NECUNOSCUT                reconcilierea n-a putut stabili starea ⇒ NU se reia, NU se face rollback automat
#   21 CONFLICT                  rânduri relevante care nu sunt exact perechea aprobată (alt nume/versiune/sha, dubluri)
#                                ⇒ reconciliere manuală necesară, FĂRĂ retry automat
#   22 ȚINTĂ NECONFIRMATĂ        pre-verificarea sau reconcilierea a ajuns pe altă țintă (db/system_identifier/proiect)
#   30 GATE 0e: livrarea e COMISĂ și înregistrată, dar controlul permanent 0e (scripts/control_0e.sql, read-only) a găsit
#      ≥1 funcție expusă (public/graphql_public, EXECUTE pentru anon/authenticated) care poate scrie GUC-uri de identitate sau
#      interpretează SQL primit ca argument (interpretor SQL: query_to_xml, ts_stat, crosstab, dblink, …)
#      ⇒ livrarea NU e considerată încheiată. NU e rollback (migrarea rămâne comisă) — analiză înainte de a continua.
#   31 GATE 0e NERULAT: livrarea e comisă, dar controlul 0e n-a putut rula ⇒ la fel, NU e considerată încheiată.
#      Gate-ul 0e rulează DOAR după APLICAT + ÎNREGISTRAT confirmat, pe aceeași țintă/conexiune (-h/-p/-U/-d), într-o
#      tranzacție READ ONLY separată. Nu există opțiune de a-l sări (cerință Copilot PR #551 F2).
#   2  refuz la argumente, 3 refuz la artefact/validator — ambele ÎNAINTE de orice conexiune (neaplicat).
#   40 GENERAT (doar cu --genereaza-in): fișierele livrării scrise în dosarul cerut, NICIO conexiune, nimic trimis.
#
# Utilizare (parola NU pe linia de comandă și nici în chat: ~/.pgpass / PGPASSFILE):
#   bash scripts/livrare_migrare.sh --migrare supabase/migrations/<nume>.sql --sha256 <hex64> \
#        --versiune <AAAALLZZHHMMSS> --tinta-db <baza> --tinta-sistem <system_identifier> \
#        --tinta-host <H> --tinta-port <P> [--tinta-proiect <marcaj>] [--user U] [--plafon-tranzactie-ms N]
#        [--genereaza-in <dir_nou>]
#   Runda 7: aprobarea țintei = db + system_identifier + ENDPOINTUL DE SCRIERE (host:port) [+ proiect]. Pre-verificarea,
#   tranzacția principală și reconcilierea cer în plus pg_is_in_recovery() = false (o replică fizică are același
#   system_identifier) ⇒ altfel 22 / refuz. (Runda 9: servicii libpq refuzate, vezi mai jos.)
#   Runda 9: suportul --service e RETRAS (verificarea noastră nu reproducea selecția libpq a secțiunii) ⇒ --service = refuz 2;
#   PGSERVICE/PGSERVICEFILE/PGSYSCONFDIR din mediu ⇒ refuz; pre-verificarea cere drept de apel pe pg_control_system().
#   În loc de --sha256: --aprobare <fișier> cu un rând „<hex64>  <nume>.sql” (formatul sha256sum).
#   Runda 10 (11.11.2026, PR #892 r12): --plafon-tranzactie-ms <N> (opțional, 100..600000) = plafonul TOTAL al
#   tranzacției de livrare, armat de PostgreSQL 17 la BEGIN (ceasul transaction_timeout).
#   Runda 11 (11.11.2026, PR #892 r14 + Jakarinos r13 P2): pe producție conexiunea trece prin pooler-ul Supabase (session
#   mode), care NU transmite opțiunile de conectare (PGOPTIONS / options=…: serverul vede 0/default) ⇒ plafonul NU mai e
#   parametru de pornire. Cu opțiunea, livrarea rulează pe O conexiune, în ordinea (r11-r13; din runda 14 BEGIN … COMMIT
#   sunt UN singur mesaj, vezi „Runda 14” mai jos — conținutul pașilor e același):
#     00_sesiune: SET transaction_timeout = N (instrucțiune de SESIUNE, în afara tranzacției; trece prin pooler, sursa
#                 'session', prioritară față de ALTER ROLE/DATABASE … SET) apoi BEGIN ⇒ ceasul pornește la BEGIN cu N;
#     0_prolog:   (prima după BEGIN) cere N/session din pg_catalog.pg_settings (calificat: un pg_temp.pg_settings nu-l poate
#                 umbri) și pune marcajul plafonului gazpet.plafon_tranzactie = '<N>:<txid>' (pe care îl cere migrarea);
#     1_pre, COPIA, 3_inreg — ca până acum;
#     9_fin:      (runda 12) UN SINGUR mesaj către server, instrucțiunile legate cu „\;” în psql:
#                   SET CONSTRAINTS ALL IMMEDIATE  — triggerele amânate rulează ACUM, înaintea gărzii (timpul lor e numărat),
#                                                    nu în COMMIT, după gardă;
#                   SET LOCAL search_path = pg_catalog, pg_temp — funcțiile / operatorii gărzii nu pot fi umbriți;
#                   garda finală — (runda 13) niciun obiect amânabil creat / modificat în tranzacție (PLAFON_AMANABIL, vezi
#                                  mai jos); niciun cursor WITH HOLD deschis (s-ar materializa în COMMIT, după gardă); valoarea tot
#                                  N/session + marcajul; timpul de la BEGIN pe ceasul SERVERULUI
#                                  (clock_timestamp() − transaction_timestamp()) ≤ N ms; altfel refuz;
#                   COMMIT;
#                 apoi, mesaj separat, RESET transaction_timeout (backend-ul pooler-ului nu rămâne cu plafonul nostru).
#   psql FĂRĂ --single-transaction (BEGIN / COMMIT sunt în fișierele runnerului), cu ON_ERROR_STOP=1: la orice eroare psql
#   se oprește și închide conexiunea, iar serverul anulează tranzacția deschisă (nimic comis) ⇒ reconcilierea dă 10.
#   DE CE „N/session” văzut în prolog dovedește ceasul pornit la BEGIN cu N: valoarea unui GUC se schimbă într-un backend
#   doar prin instrucțiuni rulate în el; între BEGIN și prolog nu rulează nimic (prologul e primul fișier după BEGIN, generat
#   de runner), deci valoarea de la BEGIN = cea din prolog. SQL-ul singur NU poate deosebi „SET înainte de BEGIN” de
#   „SET LOCAL după BEGIN” (ambele au sursa 'session') ⇒ ordinea o garantează runnerul, iar migrarea cere în plus marcajul
#   plafonului (pus doar de prolog, după verificare).
#   Validatorul primește --plafon-tranzactie: refuză orice artefact care menționează transaction_timeout sau pg_settings în
#   afara citirii exacte „FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout'” (SET / SET LOCAL / set_config /
#   RESET / ALTER ROLE|FUNCTION … SET / CREATE FUNCTION … SET, oriunde: nivel superior, DO, corpuri de funcții) și orice
#   RESET ALL. Validatorul e o gardă de PROTOCOL (refuză formele vizibile static), NU o dovadă: SQL-ul dinamic construit
#   din bucăți și apelul unei funcții EXISTENTE cu SET transaction_timeout nu se văd static.
#   Runda 12 (Jakarinos r14 P2): în runda 11 garda și COMMIT-ul erau mesaje SEPARATE. Un artefact care oprește ceasul și
#   îl repornește (SQL dinamic; sau o funcție existentă cu SET transaction_timeout = 0, la ieșirea căreia valoarea
#   restaurată pornește un ceas NOU de N ms) trecea garda, iar o pauză a clientului / rețelei între gardă și COMMIT lăsa
#   tranzacția să comită după termen. Acum garda și COMMIT-ul sunt în ACELAȘI mesaj (simple query): serverul primește
#   mesajul întreg înainte să-l execute, deci între gardă și COMMIT nu există drum client↔server; la eroarea gărzii
#   serverul abandonează restul mesajului (COMMIT-ul nu se execută), psql (ON_ERROR_STOP) iese, conexiunea se închide și
#   tranzacția se anulează. Orice pauză a clientului sau a rețelei cade ÎNAINTEA gărzii și e numărată de ea.
#   Rearmarea ceasului din gardă (0, apoi timpul rămas) NU e folosită: în forma de un mesaj n-ar adăuga nimic și ar
#   schimba valoarea verificată (N/session).
#   Runda 13 (11.11.2026, Jakarinos r16 P2 pe #1054): SET CONSTRAINTS ALL IMMEDIATE NU golește coada de triggere amânate
#   pentru totdeauna: un trigger amânat A rulat de el poate executa SET CONSTRAINTS ALL DEFERRED și pune în coadă un
#   trigger amânat B; B rămâne pentru COMMIT (PG17 AfterTriggerSetState procesează doar evenimentele devenite imediate;
#   COMMIT-ul procesează și restul), deci rulează DUPĂ gardă. Repetarea SET CONSTRAINTS nu închide asta (B poate reamâna
#   la rândul lui). ÎNCHIDEREA PRIN CATALOG (PLAFON_AMANABIL, în gardă, după SET CONSTRAINTS ALL IMMEDIATE): garda
#   refuză (nimic comis) dacă în tranzacția curentă a fost creat sau modificat:
#     * orice trigger amânabil (pg_trigger.tgdeferrable; și cele interne, ale FK-urilor amânabile — mai strict decât
#       „ne-interne”, ca să prindă și FK-urile create / modificate);
#     * orice constrângere amânabilă (pg_constraint.condeferrable: FK-uri — verificările RI_FKey_check_* / noaction sunt
#       amânate, acțiunile CASCADE / SET NULL au triggere ne-amânabile, rulate imediat; UNIQUE / EXCLUDE; constraint
#       triggers), creată sau modificată (ex. ALTER CONSTRAINT … DEFERRABLE, ENABLE / DISABLE TRIGGER);
#     * funcția (pg_proc) a oricărui trigger amânabil, și a celor EXISTENTE (funcție înlocuită de artefact).
#   „Creat sau modificat în tranzacția curentă” = rândul de catalog vizibil are age(xmin) <= 0. De ce e exact (sursa PG17):
#   age(xid) = (int32)(GetStableLatestTransactionId() − xid), iar referința e xid-ul de VÂRF al tranzacției, dacă era deja
#   alocat la primul apel age() din tranzacție — prologul (primul fișier după BEGIN, fără niciun age()) îl alocă prin
#   txid_current(), înaintea oricărui cod al artefactului, iar garda verifică age(xid(pg_current_xact_id())) = 0.
#   Subtranzacțiile (blocuri EXCEPTION, SAVEPOINT) au xid PROPRIU, dar AssignTransactionId alocă întâi părintele („a
#   child always has an XID later than its parent”), deci xid-ul lor > vârful ⇒ age < 0, prinse. Un rând scris de o
#   subtranzacție ANULATĂ nu e vizibil (și evenimentele ei amânate sunt aruncate). Rândurile comise anterior au xid-uri
#   mai vechi ⇒ age > 0 (xid-urile permanente / înghețate: INT_MAX). Un pg_current_xact_id() din subtranzacție dă tot
#   vârful (comparația xmin = pg_current_xact_id() ar RATA subtranzacțiile — de aceea age, nu egalitatea). Fals pozitiv
#   posibil (fail-closed, refuz): o altă sesiune care a pornit DUPĂ BEGIN-ul nostru și a comis între timp un obiect
#   amânabil. Proba: test_livrare_plafon.sh 8f–8i (inclusiv FK creat într-o subtranzacție).
#   CONSECINȚĂ ACCEPTATĂ: o migrare legitimă care creează / modifică constrângeri sau triggere amânabile (sau funcția
#   unui trigger amânabil) NU se poate livra cu plafon ⇒ se livrează FĂRĂ opțiune, cu review. La fel migrările care se
#   bazează pe verificarea la COMMIT (ex. copil inserat înaintea părintelui într-un FK amânabil): SET CONSTRAINTS ALL
#   IMMEDIATE le poate schimba rezultatul (eroare FK înainte de gardă) — observația celui de-al doilea recenzent.
#   GARANȚIA (formulare exactă), cu opțiunea: pentru orice artefact care NU a creat și NU a modificat obiecte amânabile
#   (cele de mai sus), de la BEGIN până la intrarea în COMMIT trec cel mult ~N ms: garda finală (ultima instrucțiune
#   înaintea COMMIT-ului, în același mesaj) refuză dacă pe ceasul serverului au trecut > N ms de la BEGIN, oricum ar
#   opri / reporni artefactul ceasul transaction_timeout; fără ocolire, serverul închide oricum sesiunea la ~N ms (timeout
#   PostgreSQL, nu timp real strict). Artefactele care AU creat / modificat obiecte amânabile sunt refuzate (nimic comis).
#   CE NU GARANTEAZĂ (limite declarate): (1) COMMIT-ul propriu-zis NU e plafonat: scrierea WAL a commit-ului, acțiunile
#   ON COMMIT (ex. ON COMMIT DROP), procesarea internă, iar cu replicare sincronă și așteptarea standby-ului;
#   (2) codul PREEXISTENT din bază care rulează amânat: triggerele / constrângerile amânabile existente (neatinse de
#   artefact) rulează înaintea gărzii, dar dacă propriul lor cod reamână evenimente, acelea rămân pentru COMMIT; iar ce
#   cheamă ele INDIRECT nu e verificat — funcțiile apelate din funcția triggerului, triggerele ne-amânabile pornite de
#   scrierile lui, operatorii tipurilor din cheile verificate — chiar dacă artefactul le-a creat sau înlocuit pe acestea
#   din urmă; (3) un operator care ocolește deliberat runnerul (psql direct, set_config
#   manual); (4) o ocolire deliberată a ceasului într-un artefact aprobat poate ȚINE tranzacția (și lock-urile) deschisă
#   peste N până ajunge la gardă — nu comite, dar închiderea întârzie; (5) ceasul serverului e ceas de perete (un salt
#   NTP mută măsurătoarea). Validatorul și garda sunt GĂRZI DE PROTOCOL, nu autorizație.
#   Runda 14 (12.11.2026, portal r18, proba pe producție cu owner-ul): FORMA „UN MESAJ”. Pe traseul de producție (pooler
#   Supabase, session mode, de pe serverul din Ploiești) un drum client↔server = ~41 ms (60 × „SELECT 1;” cu psql -f
#   într-o tranzacție = 2476 ms). În forma r11-r13 psql trimitea artefactul instrucțiune cu instrucțiune și aștepta
#   răspunsul fiecăreia: 18a (59 de instrucțiuni) + runnerul (prolog 4, 1_pre 3, 3_inreg 3, mesajul final 1) = 70 de
#   mesaje după BEGIN ⇒ ~70 × 41 ≈ 2,9 s DOAR de rețea > 2000 ms; serverul a închis sesiunea („terminating connection due
#   to transaction timeout”) pe la linia 373 din 627, încă în verificări, înaintea lock-urilor; nimic schimbat.
#   CONCLUZIE (valabilă pentru ORICE livrare cu plafon de pe un traseu cu latență): plafonul măsoară și timpul rețelei,
#   deci o livrare instrucțiune cu instrucțiune consumă din el ~(nr. de mesaje după BEGIN) × RTT, înainte de orice lucru
#   al migrării. Acum, cu opțiunea, TOATĂ tranzacția (BEGIN … COMMIT) e UN SINGUR mesaj de interogare (scripts/
#   livrare_mesaj.sh — mecanismul, sursele și diferențele de semantică sunt în antetul lui):
#     00_sesiune.sql  SET transaction_timeout = N                    (mesaj de sesiune, în afara tranzacției)
#     5_mesaj.sql     SELECT $lm_<aleator>$<M>$lm_<aleator>$ \gexec  (serverul întoarce M, psql îl trimite ca UN mesaj)
#       M = BEGIN; 0_prolog; DO $mesaj_unic$ (verificarea, vezi mai jos); 1_pre; COPIA; „\n;\n”; 3_inreg;
#           NOTICE LIVRARE_TIMP; SET CONSTRAINTS ALL IMMEDIATE; SET LOCAL search_path; garda finală (+ NOTICE PLAFON_TIMP);
#           COMMIT;
#     9_reset.sql     RESET transaction_timeout                      (mesaj separat, după COMMIT)
#   DOVADA, în server, la fiecare livrare (DO $mesaj_unic$, a doua instrucțiune după BEGIN, înaintea lock-urilor):
#   current_query() = textul întregului mesaj în curs; se cer lungimea lui exactă (octeți), sha256 al restului mesajului
#   (1_pre … COMMIT) și sha256 al copiei la poziția ei = sha256 APROBAT. Mesaj despărțit sau octet schimbat ⇒ MESAJ_UNIC,
#   refuz, nimic comis (reconcilierea dă 10). Prologul rămâne PRIMA instrucțiune după BEGIN (raționamentul „N/session ⇒
#   ceas pornit la BEGIN cu N” e neschimbat: între BEGIN și prolog nu rulează nimic, iar SET-ul e mesajul dinainte).
#   DRUMURI client↔server rămase pe conexiunea livrării: conectare (TCP / TLS / autentificare), SET (1), SELECT-ul care
#   întoarce M (1 + transferul lui M, ~2 × mărimea artefactului: tranzacție implicită proprie, sub același N, fără
#   lock-uri), încărcarea lui M (înaintea lui BEGIN: serverul citește mesajul întreg înainte să-l execute), RESET (1).
#   ÎNTRE BEGIN ȘI COMMIT: 0 drumuri (în forma veche: ~70 pe 18a, ~58 pe 19a). BUGETUL la 41 ms / drum: 2000 − 0 × 41 =
#   2000 ms pentru server (prolog, lock-uri, verificări, migrare, înregistrare, gardă); în forma veche ar fi rămas
#   2000 − 70 × 41 < 0 pe 18a și 2000 − 58 × 41 ≈ −380 ms pe 19a. Rămâne un singur efect al rețelei în interiorul
#   ceasului: dacă clientul nu citește răspunsurile (NOTICE / rezultate), serverul se poate bloca la trimitere când i se
#   umple bufferul de socket — timpul e numărat de ceas și de gardă (fail-closed), nu e ocolire.
#   Proba cu latență (proxy TCP cu ~21 ms pe fiecare sens): scripts/test_portal_e1.sh, secțiunea LATENTA.
#   Proba pe producție cu ROLLBACK (coordonatorul, cu owner-ul): scripts/portal/dry_prod_e1.sh — același text (aceleași
#   fișiere generate de runner cu --genereaza-in, aceeași bibliotecă), cu ROLLBACK în loc de COMMIT.
#   --genereaza-in <dir_nou> (runda 14): runnerul face TOATE verificările locale (argumente, sha256, validator) și
#   generează fișierele, le copiază în <dir_nou> și iese cu 40 = GENERAT, FĂRĂ nicio conexiune (folosit de dry_prod_e1.sh).
#   Fără opțiune: comportamentul de dinainte, NESCHIMBAT (psql --single-transaction, aceleași fișiere, fără SET).
#   Cu opțiune, pre-verificarea, reconcilierea și gate-ul 0e rulează cu SET transaction_timeout = 0 înainte de BEGIN (fără
#   plafon; un backend refolosit de pooler nu le poate impune unul rămas).
#   Runda 15 (13.11.2026, L15 v2, docs/LIVRARE_L15_V2.md): --amprenta-globala <md5> + --diferente-globale <NUME.l15.tsv>
#   (ÎMPREUNĂ; una fără cealaltă = refuz 2). Pași generați de runner (scripts/livrare_amprenta.sh, blocul unic
#   scripts/amprenta_globala_v1.sql), în aceeași tranzacție:
#     2_ag_inainte.sql  după 1_pre (lock consultativ, țintă, istoric, marcaj), ÎNAINTEA copiei: setul AMPRENTA_GLOBALA v1
#                       calculat O DATĂ, materializat; GLOBAL ≠ cel aprobat ⇒ refuz (md5 pe familii în mesaj), nimic schimbat;
#     4_ag_dupa.sql     după 3_inreg, înaintea timpului și a gărzii finale: setul recalculat O DATĂ; diferența rând cu rând
#                       trebuie să fie EXACT manifestul (familie, etichetă, creat / schimbat / sters, amprenta finală) ⇒
#                       altfel refuz, nimic comis.
#   Cu --plafon-tranzactie-ms ambii pași sunt în mesajul unic (verificat prin current_query()); fără plafon, fișiere -f în
#   --single-transaction. Manifestul: copie protejată, format verificat local (refuz 3); cu --aprobare, fișierul de aprobare
#   trebuie să aibă și rândul „<hex64>  <NUME>.l15.tsv” (refuz 3 altfel); sha256-ul lui e tipărit. PGTZ / PGDATESTYLE din
#   mediu = refuz 2 (profilul sesiunii trebuie să fie al rolului, ca la citirea baseline-ului).
#   Fără aceste opțiuni: NIMIC schimbat (biblioteca nici nu se încarcă).
# Orice altă opțiune (-v, -f, -c, --set, -d URI, …) ⇒ refuz înainte de conexiune. Nu se acceptă URI-uri de conexiune.
# Variabile respinse (pot schimba execuția/ținta pe ascuns): PGPASSWORD, PGOPTIONS, PGDATABASE, PSQLRC, PGHOSTADDR,
# PGTARGETSESSIONATTRS, PGLOADBALANCEHOSTS, PGSERVICE, PGSERVICEFILE, PGSYSCONFDIR. PGHOST/PGPORT: eliminate explicit (unset)
# — endpointul vine DOAR din --tinta-host/--tinta-port.
# PSQL_BIN (implicit psql) — binarul clientului; doar operatorul local îl setează (teste).
#
# Limită de încredere declarată: marcajul și garda sunt o gardă de PROTOCOL, nu o autorizație. Un operator
# privilegiat care le ocolește deliberat (set_config manual, psql direct) nu e oprit de runner.
# ============================================================================
set -Eeuo pipefail
umask 077

refuz() { echo "REFUZ (neaplicat, fără conexiune): $2" >&2; exit "$1"; }

MIG="" SHA="" APROBARE="" VERSIUNE="" TINTA_DB="" TINTA_SIS="" TINTA_PROI="" C_HOST="" C_PORT="" C_USER="" PLAFON_MS="" GENEREAZA=""
AG_MD5="" AG_MAN=""
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || refuz 2 "opțiunea $1 fără valoare"
  case "$1" in
    --migrare) MIG="$2" ;;          --sha256) SHA="$2" ;;          --aprobare) APROBARE="$2" ;;
    --versiune) VERSIUNE="$2" ;;    --tinta-db) TINTA_DB="$2" ;;   --tinta-sistem) TINTA_SIS="$2" ;;
    --tinta-proiect) TINTA_PROI="$2" ;;
    --tinta-host) C_HOST="$2" ;;    --tinta-port) C_PORT="$2" ;;   --user) C_USER="$2" ;;
    --plafon-tranzactie-ms) PLAFON_MS="$2" ;;
    --genereaza-in) GENEREAZA="$2" ;;
    --amprenta-globala) AG_MD5="$2" ;; --diferente-globale) AG_MAN="$2" ;;
    --service) refuz 2 "--service nu mai e acceptat (Runda 9: suport retras — endpoint explicit --tinta-host/--tinta-port + ~/.pgpass/PGPASSFILE)" ;;
    *) refuz 2 "opțiune nepermisă: $1 (doar --migrare --sha256|--aprobare --versiune --tinta-db --tinta-sistem --tinta-host --tinta-port [--tinta-proiect --user --plafon-tranzactie-ms --genereaza-in --amprenta-globala --diferente-globale])" ;;
  esac
  shift 2
done
# Runda 9: niciun serviciu libpq (nici --service, nici din mediu) și nicio variabilă care redirecționează/schimbă conexiunea.
for v in PGPASSWORD PGOPTIONS PGDATABASE PSQLRC PGHOSTADDR PGTARGETSESSIONATTRS PGLOADBALANCEHOSTS PGSERVICE PGSERVICEFILE PGSYSCONFDIR; do
  [ -z "${!v+x}" ] || refuz 2 "variabila $v e setată (parola: ~/.pgpass / PGPASSFILE; fără servicii libpq; nimic care schimbă execuția/ținta)"
done
unset PGHOST PGPORT   # suprascrise oricum de -h/-p explicite; eliminate ca endpointul să nu depindă de mediu
[ -n "$MIG" ] && [ -f "$MIG" ] || refuz 2 "--migrare lipsă sau fișier inexistent: $MIG"
NUME="$(basename "$MIG" .sql)"
[[ "$NUME" =~ ^[0-9]{8}[a-z]?_[A-Za-z0-9_]+$ ]] || refuz 2 "nume de migrare invalid: $NUME"
[[ "$VERSIUNE" =~ ^[0-9]{14}$ ]] || refuz 2 "--versiune obligatorie, 14 cifre (AAAALLZZHHMMSS): '$VERSIUNE'"
[[ "$TINTA_DB" =~ ^[A-Za-z0-9_]{1,63}$ ]] || refuz 2 "--tinta-db obligatorie ([A-Za-z0-9_]): '$TINTA_DB'"
[[ "$TINTA_SIS" =~ ^[0-9]{1,20}$ ]] || refuz 2 "--tinta-sistem OBLIGATORIU (system_identifier din pg_control_system(), cifre): '$TINTA_SIS'"
[ -z "$TINTA_PROI" ] || [[ "$TINTA_PROI" =~ ^[A-Za-z0-9_.-]{1,63}$ ]] || refuz 2 "--tinta-proiect invalid"
# Runda 7: endpointul de SCRIERE aprobat (host + port) face parte din aprobare, ca --tinta-db/--tinta-sistem — obligatoriu.
[[ "$C_HOST" =~ ^[A-Za-z0-9._/-]{1,253}$ ]] || refuz 2 "--tinta-host OBLIGATORIU (endpointul de scriere aprobat): '$C_HOST'"
[[ "$C_PORT" =~ ^[0-9]{1,5}$ ]] || refuz 2 "--tinta-port OBLIGATORIU (portul endpointului de scriere aprobat): '$C_PORT'"
[ -z "$C_USER" ] || [[ "$C_USER" =~ ^[A-Za-z0-9_.-]{1,63}$ ]] || refuz 2 "--user invalid"
# Runda 10: plafonul total, în milisecunde, ca număr întreg simplu (fără unități, fără zerouri în față): 100..600000.
if [ -n "$PLAFON_MS" ]; then
  [[ "$PLAFON_MS" =~ ^[1-9][0-9]{2,5}$ ]] && [ "$PLAFON_MS" -le 600000 ] \
    || refuz 2 "--plafon-tranzactie-ms invalid (milisecunde, 100..600000): '$PLAFON_MS'"
fi
# Runda 14: dosarul de generare trebuie să NU existe (nimic suprascris); părintele lui trebuie să existe.
if [ -n "$GENEREAZA" ]; then
  [ ! -e "$GENEREAZA" ] && [ -d "$(dirname "$GENEREAZA")" ] || refuz 2 "--genereaza-in: dosarul trebuie să fie NOU, într-un părinte existent: '$GENEREAZA'"
fi
# Runda 15 (L15 v2): amprenta globală aprobată + manifestul diferențelor, DOAR împreună.
if [ -n "$AG_MD5$AG_MAN" ]; then
  [ -n "$AG_MD5" ] && [ -n "$AG_MAN" ] || refuz 2 "--amprenta-globala și --diferente-globale se folosesc ÎMPREUNĂ (L15 v2)"
  [[ "$AG_MD5" =~ ^[0-9a-f]{32}$ ]] || refuz 2 "--amprenta-globala: md5 (32 hex, litere mici): '$AG_MD5'"
  [ -f "$AG_MAN" ] || refuz 2 "--diferente-globale: fișier inexistent: $AG_MAN"
  [ "$(basename "$AG_MAN")" = "$NUME.l15.tsv" ] || refuz 2 "--diferente-globale: manifestul migrării $NUME se numește $NUME.l15.tsv (dat: $(basename "$AG_MAN"))"
  for v in PGTZ PGDATESTYLE; do
    [ -z "${!v+x}" ] || refuz 2 "variabila $v e setată (L15 v2: profilul sesiunii de livrare trebuie să fie al rolului, ca la citirea baseline-ului)"
  done
fi
if [ -n "$APROBARE" ]; then
  [ -z "$SHA" ] || refuz 2 "--sha256 și --aprobare se exclud"
  [ -f "$APROBARE" ] || refuz 2 "fișier de aprobare lipsă: $APROBARE"
  SHA="$(awk -v f="$NUME.sql" '$2 == f || $2 == "*" f {print $1}' "$APROBARE")"
  [ "$(printf '%s\n' "$SHA" | grep -c .)" = 1 ] || refuz 2 "fișierul de aprobare nu are exact un rând pentru $NUME.sql"
fi
[[ "$SHA" =~ ^[0-9a-f]{64}$ ]] || refuz 2 "sha256 aprobat lipsă/invalid (--sha256 <hex64> sau --aprobare)"


# --- copia unică, protejată; TOT ce urmează folosește DOAR copia -------------
DIR="$(mktemp -d)"; trap 'chmod -R u+w "$DIR" 2>/dev/null; rm -rf "$DIR"' EXIT
chmod 700 "$DIR"
COPIE="$DIR/$NUME.sql"
cp -- "$MIG" "$COPIE"; chmod 400 "$COPIE"
SHA_COPIE="$(sha256sum "$COPIE" | cut -d' ' -f1)"
[ "$SHA_COPIE" = "$SHA" ] || refuz 3 "sha256 al artefactului ($SHA_COPIE) ≠ sha256 aprobat ($SHA)"
TAG="reg_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
CONTROL_0E="$(dirname "${BASH_SOURCE[0]}")/control_0e.sql"
[ -f "$CONTROL_0E" ] || refuz 3 "gate-ul permanent 0e lipsește: $CONTROL_0E"
# Runda 11: cu plafon, validatorul refuză în plus orice atingere a ceasului tranzacției (vezi antetul).
VAL_PLAFON=(); [ -z "$PLAFON_MS" ] || VAL_PLAFON=(--plafon-tranzactie)
VAL_OUT="$(python3 "$(dirname "${BASH_SOURCE[0]}")/livrare_validator.py" "$COPIE" "$TAG" ${VAL_PLAFON[@]+"${VAL_PLAFON[@]}"})" || refuz 3 "validatorul a refuzat $NUME (vezi mai sus)"
echo "→ $NUME: sha256 $SHA_COPIE = aprobat; validator: $VAL_OUT"
# Runda 15 (L15 v2): copia protejată a manifestului, formatul verificat local; cu --aprobare, și sha256-ul lui e aprobat.
if [ -n "$AG_MD5" ]; then
  LIB_AG="$(dirname "${BASH_SOURCE[0]}")/livrare_amprenta.sh"
  [ -f "$LIB_AG" ] || refuz 3 "biblioteca L15 v2 lipsește: $LIB_AG"
  # shellcheck source=livrare_amprenta.sh
  . "$LIB_AG"
  AG_COPIE="$DIR/$NUME.l15.tsv"
  cp -- "$AG_MAN" "$AG_COPIE"; chmod 400 "$AG_COPIE"
  AG_SHA="$(sha256sum "$AG_COPIE" | cut -d' ' -f1)"
  ag_manifest_valid "$AG_COPIE" || refuz 3 "manifestul $NUME.l15.tsv are format invalid (vezi mai sus)"
  if [ -n "$APROBARE" ]; then
    AG_SHA_AP="$(awk -v f="$NUME.l15.tsv" '$2 == f || $2 == "*" f {print $1}' "$APROBARE")"
    [ "$(printf '%s\n' "$AG_SHA_AP" | grep -c .)" = 1 ] && [ "$AG_SHA_AP" = "$AG_SHA" ] \
      || refuz 3 "fișierul de aprobare nu are exact un rând pentru $NUME.l15.tsv cu sha256 $AG_SHA"
  fi
  echo "→ L15 v2: GLOBAL aprobat $AG_MD5; manifest $NUME.l15.tsv sha256 $AG_SHA ($(tr -d '\r' <"$AG_COPIE" | grep -cv '^#\|^$' || true) obiecte)$([ -n "$APROBARE" ] && echo ' = aprobat')"
fi

# --- fișierele runnerului (generate, nu provin din artefact) -----------------
CHEIE="hashtext('gazpet.livrare_migrare')"
PROI_EXPR="coalesce(current_setting('gazpet.proiect_aprobat', true), '')"
# Runda 11: cu --plafon-tranzactie-ms, prologul (primul după BEGIN) cere exact valoarea aprobată, cu sursa 'session'
# (SET-ul runnerului dinaintea lui BEGIN), din pg_catalog.pg_settings (calificat: fără umbrire prin pg_temp), apoi pune
# marcajul plafonului. Aceeași citire în garda finală (9_fin).
PLAFON_CITIRE="(SELECT setting || '/' || source FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout')"
PLAFON_CHECK=""
[ -z "$PLAFON_MS" ] || PLAFON_CHECK="  IF $PLAFON_CITIRE IS DISTINCT FROM '$PLAFON_MS/session' THEN
    RAISE EXCEPTION 'Livrare $NUME: plafonul tranzactiei nu e $PLAFON_MS ms pus de runner inainte de BEGIN (%)', coalesce($PLAFON_CITIRE, 'lipsa'); END IF;
  PERFORM set_config('gazpet.plafon_tranzactie', '$PLAFON_MS:' || txid_current(), true);"
cat > "$DIR/0_prolog.sql" <<SQL
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL standard_conforming_strings = on;
SET LOCAL client_encoding = 'UTF8';
DO \$prolog\$ BEGIN
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RAISE EXCEPTION 'Livrare $NUME: izolarea nu e READ COMMITTED'; END IF;
  IF current_setting('standard_conforming_strings') IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'Livrare $NUME: standard_conforming_strings nu e on'; END IF;
  IF current_setting('client_encoding') IS DISTINCT FROM 'UTF8' THEN RAISE EXCEPTION 'Livrare $NUME: client_encoding nu e UTF8'; END IF;
$PLAFON_CHECK
END \$prolog\$;
SQL
PROI_CHECK=""
[ -n "$TINTA_PROI" ] && PROI_CHECK="  IF $PROI_EXPR IS DISTINCT FROM '$TINTA_PROI' THEN
    RAISE EXCEPTION 'Livrare $NUME: marcajul de proiect ≠ ținta aprobată $TINTA_PROI'; END IF;"
cat > "$DIR/1_pre.sql" <<SQL
SELECT pg_advisory_xact_lock($CHEIE);
DO \$pre\$ BEGIN
  IF current_database() IS DISTINCT FROM '$TINTA_DB' THEN
    RAISE EXCEPTION 'Livrare $NUME: baza conectată (%) ≠ ținta aprobată $TINTA_DB', current_database(); END IF;
  IF (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '$TINTA_SIS' THEN
    RAISE EXCEPTION 'Livrare $NUME: system_identifier ≠ ținta aprobată $TINTA_SIS'; END IF;
  IF pg_is_in_recovery() IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Livrare $NUME: instanța e în recovery (replică) — nu e endpointul de scriere aprobat'; END IF;
$PROI_CHECK
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '$NUME') THEN
    RAISE EXCEPTION 'Livrare $NUME: migrarea e deja înregistrată — refuz (fără dublare)'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '$VERSIUNE') THEN
    RAISE EXCEPTION 'Livrare $NUME: versiunea $VERSIUNE e deja folosită — refuz'; END IF;
END \$pre\$;
SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);
SQL
{
  printf 'DO $inreg$ BEGIN\n'
  printf "  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '%s:' || txid_current() THEN\n" "$NUME"
  printf "    RAISE EXCEPTION 'Înregistrare %s: marcajul de livrare lipsește — nu sunt în tranzacția runnerului'; END IF;\n" "$NUME"
  printf 'END $inreg$;\n'
  printf "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('%s', '%s', ARRAY[\$%s\$" "$VERSIUNE" "$NUME" "$TAG"
  cat "$COPIE"
  printf "\$%s\$]);\n" "$TAG"
  printf 'DO $verif$ BEGIN\n'
  printf "  IF (SELECT encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') FROM supabase_migrations.schema_migrations WHERE version = '%s' AND name = '%s') IS DISTINCT FROM '%s' THEN\n" "$VERSIUNE" "$NUME" "$SHA"
  printf "    RAISE EXCEPTION 'Înregistrare %s: statements ≠ artefactul aprobat'; END IF;\n" "$NUME"
  printf 'END $verif$;\n'
} > "$DIR/3_inreg.sql"
# Runda 15 (L15 v2): pașii „înainte” / „după” (tag aleator: artefactul, fixat înainte, nu le poate numi obiectele).
if [ -n "$AG_MD5" ]; then
  TAG_AG="$(ag_tag)"
  ag_inainte "$TAG_AG" "$AG_MD5" > "$DIR/2_ag_inainte.sql" || refuz 3 "L15 v2: generarea pasului înainte a eșuat"
  ag_dupa "$TAG_AG" "$AG_MD5" "$AG_COPIE" > "$DIR/4_ag_dupa.sql" || refuz 3 "L15 v2: generarea pasului după a eșuat"
fi
# Runda 11: cu plafon, începutul și sfârșitul tranzacției sunt fișiere ale runnerului (psql fără --single-transaction).
# SESIUNE_0 = prefixul conexiunilor fără plafon (pre-verificare, reconciliere, gate 0e), doar cu opțiunea.
SESIUNE_0=""
if [ -n "$PLAFON_MS" ]; then
  SESIUNE_0="SET transaction_timeout = 0;"
  # Runda 14: forma „un mesaj” (scripts/livrare_mesaj.sh; doar aici se încarcă biblioteca — fără opțiune nimic nu se
  # schimbă). Garda finală (runda 12-13: SET CONSTRAINTS ALL IMMEDIATE, search_path pe pg_catalog, PLAFON_AMANABIL /
  # CURSOR / SCHIMBAT / DEPASIT) e aceeași, acum în același mesaj cu TOATĂ tranzacția, nu doar cu COMMIT-ul.
  LIB_MESAJ="$(dirname "${BASH_SOURCE[0]}")/livrare_mesaj.sh"
  [ -f "$LIB_MESAJ" ] || refuz 3 "biblioteca formei un mesaj lipsește: $LIB_MESAJ"
  # shellcheck source=livrare_mesaj.sh
  . "$LIB_MESAJ"
  printf 'SET transaction_timeout = %s;\n' "$PLAFON_MS" > "$DIR/00_sesiune.sql"
  # restul mesajului (după verificarea „un mesaj”): 1_pre, COPIA (poziția ei, pentru verificare), despărțitorul,
  # 3_inreg, timpul, garda finală + COMMIT
  cp -- "$DIR/1_pre.sql" "$DIR/m_rest.sql"
  [ -z "$AG_MD5" ] || cat "$DIR/2_ag_inainte.sql" >> "$DIR/m_rest.sql"   # runda 15: înaintea copiei
  POZ_COPIE="$(lm_octeti "$DIR/m_rest.sql")"
  { cat "$COPIE"; lm_sep; cat "$DIR/3_inreg.sql"; [ -z "$AG_MD5" ] || cat "$DIR/4_ag_dupa.sql"; lm_timp "$NUME"; lm_fin "$NUME" "$PLAFON_MS" COMMIT; } >> "$DIR/m_rest.sql" \
    || refuz 3 "forma un mesaj: generarea restului a eșuat"
  lm_mesaj "$DIR/0_prolog.sql" "$DIR/m_rest.sql" "$DIR/m_mesaj.sql" "$NUME" "$POZ_COPIE:$(lm_octeti "$COPIE"):$SHA" \
    || refuz 3 "forma un mesaj: construirea mesajului a eșuat"
  TAG_M="lm_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
  lm_trimite "$DIR/m_mesaj.sql" "$TAG_M" "$DIR/5_mesaj.sql" || refuz 3 "forma un mesaj: fișierul de trimitere a eșuat"
  printf 'RESET transaction_timeout;\n' > "$DIR/9_reset.sql"
fi
# Reconcilierea (și pre-verificarea): read-only, READ COMMITTED explicit PRIMUL, lock-ul într-o instrucțiune separată
# ÎNAINTEA SELECT-ului pe istoric ⇒ SELECT-ul primește un snapshot luat după eliberarea lock-ului.
# Rezultat: db|system_identifier|proiect|in_recovery|relevante (nume SAU versiune)|exacte (nume+versiune+sha)
{ [ -z "$SESIUNE_0" ] || echo "$SESIUNE_0"; cat <<SQL
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED, READ ONLY;
SET LOCAL lock_timeout = '120s';
DO \$drept\$ BEGIN
  IF NOT has_function_privilege('pg_catalog.pg_control_system()', 'EXECUTE') THEN
    RAISE EXCEPTION 'LIVRARE_FARA_DREPT_PG_CONTROL_SYSTEM: rolul % nu poate apela pg_control_system() — ținta (system_identifier) nu se poate verifica', current_user; END IF;
END \$drept\$;
SELECT pg_advisory_xact_lock($CHEIE);
SELECT current_database() || '|' || (SELECT system_identifier::text FROM pg_control_system()) || '|' || $PROI_EXPR || '|' ||
       pg_is_in_recovery()::text || '|' ||
       count(*) || '|' ||
       count(*) FILTER (WHERE version = '$VERSIUNE' AND name = '$NUME' AND encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') = '$SHA')
  FROM supabase_migrations.schema_migrations WHERE version = '$VERSIUNE' OR name = '$NUME';
COMMIT;
SQL
} > "$DIR/reconc.sql"
# Gate-ul permanent 0e (după livrare): copie protejată a scripts/control_0e.sql, într-o tranzacție READ ONLY.
# Același prolog lexical ca livrarea (standard_conforming_strings/client_encoding pot veni ostile din ALTER DATABASE … SET):
# fără el, regex-urile cu „\” din control_0e.sql se parsează greșit ⇒ GATE 0e NERULAT (prins de 6.12).
{ [ -z "$SESIUNE_0" ] || echo "$SESIUNE_0"; cat <<'P0E'
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED, READ ONLY;
SET LOCAL standard_conforming_strings = on;
SET LOCAL client_encoding = 'UTF8';
DO $p0e$ BEGIN
  IF current_setting('standard_conforming_strings') IS DISTINCT FROM 'on' OR current_setting('client_encoding') IS DISTINCT FROM 'UTF8'
    THEN RAISE EXCEPTION 'Gate 0e: prolog lexical neaplicat'; END IF;
END $p0e$;
P0E
  cat "$CONTROL_0E"; printf '\nCOMMIT;\n'; } > "$DIR/control_0e.sql"
chmod 400 "$DIR/0_prolog.sql" "$DIR/1_pre.sql" "$DIR/3_inreg.sql" "$DIR/reconc.sql" "$DIR/control_0e.sql"
[ -z "$PLAFON_MS" ] || chmod 400 "$DIR/00_sesiune.sql" "$DIR/m_rest.sql" "$DIR/m_mesaj.sql" "$DIR/5_mesaj.sql" "$DIR/9_reset.sql"
[ -z "$AG_MD5" ] || chmod 400 "$DIR/2_ag_inainte.sql" "$DIR/4_ag_dupa.sql"
# Runda 14: --genereaza-in = doar fișierele (copia + cele generate), fără nicio conexiune; cod 40.
if [ -n "$GENEREAZA" ]; then
  mkdir -- "$GENEREAZA" && cp -p -- "$DIR"/*.sql "$GENEREAZA"/ || refuz 3 "--genereaza-in: copierea în $GENEREAZA a eșuat"
  [ -z "$AG_MD5" ] || cp -p -- "$AG_COPIE" "$GENEREAZA"/ || refuz 3 "--genereaza-in: copierea manifestului a eșuat"
  echo "✓ GENERAT (fără conexiune, nimic trimis): $NUME → $GENEREAZA ($(cd "$GENEREAZA" && ls | tr '\n' ' '))"
  exit 40
fi

CONN=(-h "$C_HOST" -p "$C_PORT"); [ -n "$C_USER" ] && CONN+=(-U "$C_USER")   # explicite ⇒ au prioritate față de mediu
CONN+=(-d "$TINTA_DB")   # validat [A-Za-z0-9_] ⇒ nu poate fi conninfo/URI
export PGCLIENTENCODING=UTF8   # parametru de pornire al conexiunii: are prioritate față de setările rolului/bazei
PSQL="${PSQL_BIN:-psql}"

# reconciliaza ⇒ RC_R, R, R_DB, R_SIS, R_PROI, R_REL, R_EX; întoarce 0 doar dacă rezultatul e complet și bine format
reconciliaza() {
  set +e
  "$PSQL" -X -q -At -v ON_ERROR_STOP=1 -f "$DIR/reconc.sql" "${CONN[@]}" >"$DIR/reconc.out" 2>&1
  RC_R=$?
  set -e
  R="$(tail -n 1 "$DIR/reconc.out")"
  IFS='|' read -r R_DB R_SIS R_PROI R_REC R_REL R_EX <<<"$R" || true
  [ "$RC_R" = 0 ] && [[ "${R_REL:-}" =~ ^[0-9]+$ ]] && [[ "${R_EX:-}" =~ ^[0-9]+$ ]] && [[ "${R_SIS:-}" =~ ^[0-9]+$ ]]
}
# Runda 7: instanța AUTORITATIVĂ — o replică fizică are același db + system_identifier, deci se cere și in_recovery = false.
tinta_ok() { [ "$R_DB" = "$TINTA_DB" ] && [ "$R_SIS" = "$TINTA_SIS" ] && [ "$R_REC" = false ] && { [ -z "$TINTA_PROI" ] || [ "$R_PROI" = "$TINTA_PROI" ]; }; }
manual() {
  echo "  Reconciliere manuală read-only (pe ținta aprobată; câmpuri: db|system_identifier|proiect|in_recovery|relevante|exacte):" >&2
  sed 's/^/    /' "$DIR/reconc.sql" >&2
  echo "  + starea obiectelor migrării (docs/SECURITATE_PATCH_RSVTI.md, Runda 5/6)." >&2
}

# Gate permanent 0e (cerință Copilot PR #551 F2): rulează DUPĂ COMMIT ⇒ nu face rollback; un eșec înseamnă „comis, dar
# livrarea NU e considerată încheiată” (cod 30/31), cu analiză manuală înainte de orice pas următor.
gate_0e() {
  set +e
  "$PSQL" -X -q -At -F ' | ' -v ON_ERROR_STOP=1 -f "$DIR/control_0e.sql" "${CONN[@]}" >"$DIR/0e.out" 2>&1
  local rc=$?
  set -e
  if [ "$rc" != 0 ]; then
    echo "✗ GATE 0e NERULAT (cod psql $rc): $NUME v$VERSIUNE e COMISĂ, dar controlul 0e n-a putut rula — livrarea NU e considerată încheiată; analizează înainte de a continua." >&2
    sed 's/^/    /' "$DIR/0e.out" >&2; exit 31
  fi
  if [ -s "$DIR/0e.out" ]; then
    echo "✗ GATE 0e: gadget(uri) expus(e): $(paste -sd ';' "$DIR/0e.out") — $NUME v$VERSIUNE e COMISĂ (fără rollback), dar livrarea NU e considerată încheiată; analizează înainte de a continua." >&2
    exit 30
  fi
  echo "✓ GATE 0e: 0 funcții expuse care pot scrie GUC-uri de identitate sau interpreta SQL (interpretor SQL) — livrare încheiată."
}

# --- P. pre-verificare (nimic trimis dacă nu trece) ----------------------------
if ! reconciliaza; then
  grep -qF LIVRARE_FARA_DREPT_PG_CONTROL_SYSTEM "$DIR/reconc.out" && \
    echo "✗ NEPORNIT: rolul de livrare nu are drept de apel pe pg_control_system() — verificarea țintei e obligatorie, nu se relaxează." >&2
  echo "✗ NEPORNIT: pre-verificarea n-a putut rula (cod $RC_R, rezultat '$R') — livrarea NU s-a trimis." >&2; exit 12
fi
if ! tinta_ok; then
  echo "✗ ȚINTĂ NECONFIRMATĂ la pre-verificare: conectat la db=$R_DB system_identifier=$R_SIS in_recovery=$R_REC proiect='$R_PROI', aprobat db=$TINTA_DB system_identifier=$TINTA_SIS proiect='$TINTA_PROI' — livrarea NU s-a trimis." >&2
  exit 22
fi
if [ "$R_REL" = 1 ] && [ "$R_EX" = 1 ]; then
  echo "✓ DEJA ÎNREGISTRATĂ: $NUME v$VERSIUNE e deja înregistrată cu artefactul aprobat (sha256 $SHA); nu s-a reaplicat." >&2; exit 11
fi
if [ "$R_REL" != 0 ]; then
  echo "✗ CONFLICT: istoricul are $R_REL rând(uri) cu numele $NUME sau versiunea $VERSIUNE, din care $R_EX perechea exactă aprobată — reconciliere manuală necesară, fără retry automat. Livrarea NU s-a trimis." >&2
  manual; exit 21
fi

set +e
if [ -z "$PLAFON_MS" ] && [ -z "$AG_MD5" ]; then
  echo "→ livrare $NUME (versiune $VERSIUNE) pe ținta $TINTA_DB/$TINTA_SIS @ $C_HOST:$C_PORT: psql --single-transaction [prolog + lock + țintă + istoric + marcaj + copie + înregistrare]"
  "$PSQL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$DIR/0_prolog.sql" -f "$DIR/1_pre.sql" -f "$COPIE" -f "$DIR/3_inreg.sql" "${CONN[@]}"
  RC_PSQL=$?
elif [ -z "$PLAFON_MS" ]; then
  # Runda 15 (L15 v2) fără plafon: aceleași fișiere + amprenta globală înainte / după, în --single-transaction.
  echo "→ livrare $NUME (versiune $VERSIUNE) pe ținta $TINTA_DB/$TINTA_SIS @ $C_HOST:$C_PORT: psql --single-transaction [prolog + lock + țintă + istoric + marcaj + AMPRENTA_GLOBALA înainte + copie + înregistrare + AMPRENTA_GLOBALA după = manifest]"
  "$PSQL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$DIR/0_prolog.sql" -f "$DIR/1_pre.sql" -f "$DIR/2_ag_inainte.sql" -f "$COPIE" -f "$DIR/3_inreg.sql" -f "$DIR/4_ag_dupa.sql" "${CONN[@]}"
  RC_PSQL=$?
else
  # Runda 14: o singură conexiune; SET de sesiune, apoi TOATĂ tranzacția într-un singur mesaj (\gexec), apoi RESET.
  echo "→ livrare $NUME (versiune $VERSIUNE) pe ținta $TINTA_DB/$TINTA_SIS @ $C_HOST:$C_PORT: psql [SET transaction_timeout = $PLAFON_MS] + UN SINGUR mesaj [BEGIN + prolog + verificare mesaj unic + lock + țintă + istoric + marcaj$([ -z "$AG_MD5" ] || echo ' + AMPRENTA_GLOBALA înainte') + copie + înregistrare$([ -z "$AG_MD5" ] || echo ' + AMPRENTA_GLOBALA după = manifest') + gardă finală + COMMIT] + [RESET]; plafon ~$PLAFON_MS ms de la BEGIN până la intrarea în COMMIT, 0 drumuri client-server între ele (SET de sesiune înainte de BEGIN; COMMIT-ul propriu-zis neplafonat)"
  "$PSQL" -X -q -v ON_ERROR_STOP=1 -f "$DIR/00_sesiune.sql" -f "$DIR/5_mesaj.sql" -f "$DIR/9_reset.sql" "${CONN[@]}"
  RC_PSQL=$?
fi
set -e

# --- reconciliere read-only (conexiune nouă; așteaptă lock-ul ⇒ tranzacția livrării s-a terminat) ------------
if ! reconciliaza; then
  echo "✗ NECUNOSCUT: $NUME v$VERSIUNE (psql $RC_PSQL, reconciliere: cod $RC_R, rezultat '$R'). NU reluați, NU faceți rollback." >&2
  manual; exit 20
fi
if ! tinta_ok; then
  echo "✗ ȚINTĂ NECONFIRMATĂ la reconciliere: conectat la db=$R_DB system_identifier=$R_SIS in_recovery=$R_REC proiect='$R_PROI' ≠ ținta aprobată — starea pe ținta aprobată e NECUNOSCUTĂ (psql $RC_PSQL). NU reluați." >&2
  manual; exit 22
fi
if [ "$R_REL" = 1 ] && [ "$R_EX" = 1 ]; then
  [ "$RC_PSQL" = 0 ] || echo "⚠ psql a raportat $RC_PSQL, dar înregistrarea exactă există acum (nu exista la pre-verificare): aplicat de această execuție (confirmare pierdută) sau de o livrare concurentă a aceluiași artefact." >&2
  echo "✓ APLICAT + ÎNREGISTRAT confirmat: $NUME v$VERSIUNE (sha256 $SHA)"
  gate_0e; exit 0
fi
if [ "$R_REL" = 0 ]; then
  [ "$RC_PSQL" != 0 ] || { echo "✗ NECUNOSCUT: psql a raportat succes, dar nu există nicio înregistrare relevantă — reconciliere manuală" >&2; manual; exit 20; }
  echo "✗ NEAPLICAT confirmat: $NUME v$VERSIUNE (psql $RC_PSQL; 0 rânduri relevante pe ținta confirmată ⇒ nimic comis)" >&2; exit 10
fi
echo "✗ CONFLICT: după livrare istoricul are $R_REL rând(uri) cu numele $NUME sau versiunea $VERSIUNE, din care $R_EX perechea exactă aprobată (psql $RC_PSQL) — reconciliere manuală necesară, fără retry automat." >&2
manual; exit 21
