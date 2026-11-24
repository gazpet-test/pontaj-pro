#!/usr/bin/env bash
# Proba de CONCURENȚĂ a migrării 20270108a (Execuție: registrul DCC, PR1): sesiuni psql REALE, cu barieră explicită, pe un cluster PostgreSQL ≥ 17
# COMPLET DISPENSABIL. PGlite (o singură conexiune) nu poate proba asta. Același tipar ca supabase/tests/20270106a_executie_semnale_concurenta.sh;
# protocolul: planul docs/superpowers/plans/2026-11-24-registru-dcc-pr1.md, Task 8, „Concurența” + „Mutanții de concurență” + comanda 8.
#
# CE ATINGE (exact):
#   * BAZA: creează baza <nume_baza_noua> (refuză dacă există deja) și o ȘTERGE la final (DROP DATABASE … WITH (FORCE)), inclusiv la întrerupere
#     (trap EXIT / INT / TERM). Nu se conectează la nicio altă bază decât `postgres` (CREATE / DROP / roluri) și baza nouă.
#   * ROLURI la nivel de CLUSTER: anon, authenticated (NOLOGIN NOINHERIT), service_role (NOLOGIN NOINHERIT BYPASSRLS) și authenticator (NOINHERIT,
#     membru în cele trei), ca în scheletul supabase/tests/20270108a_executie_dcc_registru_schelet.sql, create DOAR dacă lipsesc (scheletul se aplică
#     FĂRĂ cele 4 rânduri CREATE ROLE) și ȘTERSE la final doar cele create aici; rolurile preexistente nu sunt atinse, dar trebuie să aibă atributele
#     scheletului (altfel refuz, ieșire 2). De aceea rulează DOAR cu DCC_CLUSTER_DISPENSABIL=da: NU pe clona de producție, NU pe un cluster folosit
#     la altceva.
#   * FIȘIERE: un folder temporar (mktemp -d) cu SQL-ul extras și jurnalele sesiunilor; șters la final (la eșec, cozile jurnalelor se afișează înainte).
#   * REȚEA: doar conexiunile psql la cluster (PGHOST / PGPORT / PGUSER, parola din pgpass sau trust).
#   * DATE: doar sintetice (beneficiar BEN, emitent AAA, conturi 00000000-0000-4000-8000-…).
# CE APLICĂ: scheletul (fără CREATE ROLE) + lanțul de drept pe proiect extras EXACT din 20261209a (cele 5 funcții + ACL-urile lor, amprentele md5 =
#   constantele din 20270108a, verificate; + politica RESTRICTIVĂ pe executie_proiecte, ca proba PGlite) + secțiunile migrării 20270108a de la
#   marcajul „-- ─── 1.” până la (fără) „-- ─── 7.” (cu 2a–2d, 5a–5b), extrase EXACT, FĂRĂ secțiunea 0 ($pre$ / lanțul pg_temp / $lock$), FĂRĂ 7
#   ($post$) și fără DROP FUNCTION pg_temp.lant_20270108a (gărzile runnerului). Aplicarea completă prin runner e pasul SEPARAT al coordonatorului.
#
# CUM SE RULEAZĂ (coordonatorul; cere bash ≥ 4 (coproc), psql ≥ 13 (\warn), python3, conectare ca superuser `postgres`):
#     DCC_CLUSTER_DISPENSABIL=da PGHOST=… PGPORT=… PGUSER=postgres bash supabase/tests/20270108a_executie_dcc_registru_concurenta.sh <nume_baza_noua>
#     DCC_MUTANT=<nume> … (același apel)  → rulează DOAR scenariul mutantului și cere rezultatul OPUS din tabel.
#   Numele bazei: ^[a-z][a-z0-9_]{2,62}$ (limita identificatorilor Postgres).
#   Ieșire: 0 = toate așteptările se țin și curățenia a reușit (cu mutant: rezultatul OPUS obținut); 1 = cel puțin o așteptare nu se ține, inclusiv
#   orice timeout al observatorului (cu mutant: „nediscriminant”), sau curățenia a eșuat; 2 = refuz / folosire greșită / mutant inaplicabil (textul
#   de înlocuit nu apare EXACT o dată în secțiunile extrase).
#
# BARIERA (fără sleep orb): sesiunea A e un psql ținut deschis (coproc): BEGIN; <RPC-ul ca om> (NECOMIS, ține rândul / intrarea din index / lock-ul
#   consultativ); marcajul `\warn <PAS> :SQLSTATE :r` pe stderr confirmă pasul și dă rezultatul. Sesiunea B pornește în FUNDAL (psql separat,
#   application_name = 'dcc_B_<scenariu>') și scrie la final în fișierul ei `B_GATA <SQLSTATE|00000> <rezultat>` (la eroare: codul DCC_ din mesaj).
#   OBSERVATORUL (a treia conexiune, o interogare nouă pe pg_stat_activity la fiecare sondare) are DOUĂ moduri, fixate pe scenariu + mutant (funcția
#   modObservator, constantă, nu dedusă la rulare):
#     asteapta_lock  — sondează până vede backend-ul lui B cu wait_event_type = 'Lock' (notează wait_event); dacă înainte apare B_GATA = eșec
#                      „B a terminat fără să aștepte”.
#     fara_asteptare — așteaptă B_GATA cât A e încă 'idle in transaction' cu ACELAȘI xact_start (A nu a primit COMMIT); dacă vreo sondare vede B în
#                      Lock = eșec „mutantul nu a eliminat așteptarea”.
#   În AMBELE moduri limita e 30 s și depășirea ei = EȘEC (ieșire 1), niciodată dovadă. Pauzele de 20 ms doar ritmează sondarea. Codul de ieșire al
#   fiecărui psql e păstrat (fără `|| true` pe psql-urile care contează); lock_timeout 10 s în B doar ca plasă. Rularea normală = asteapta_lock peste tot.
#
# SCENARII (conturi: OWNER …01, ED …03 editor, ED2 …04 editor, ADM …06 admin pe executie_dcc, ED3 …0a editor; fiecare scenariu are contractul lui,
#   BEN/30 … BEN/39, deci sunt independente; ghidurile GL1 (general 1–99999), GA (SR1 100–199), GB (SR2 150–249), G3 (SR1 100–150)):
#   C1_prima_alocare_simultana  BEN/30, seria TM1/COR/general cu pragul 44, fără alocări. A (ED) aloca, necomis; B (ED2) aloca → Lock (rândul
#        seriei); A COMMIT → A = 45, B = 46; 2 documente; ultimul_ocupat = 46.
#   C1b_doua_proiecte_simultan  BEN/31, A pe proiectul DCC P1, B pe P2 (același contract) → 45 / 46, nicio eroare de unicitate.
#   C2_retry_dupa_timeout  BEN/32 (ED în ambele sesiuni): (i) aceeași cheie + aceiași parametri → B în Lock (indexul unic al dcc_intentii); A COMMIT
#        → B: același document_id, reluat: true; 1 document. (ii) aceeași cheie, alt titlu → 22023 DCC_CHEIE_ALTI_PARAMETRI. (iii) A ROLLBACK → B
#        scrie documentul el, o singură dată.
#   C3_revizii_simultane  BEN/33: A (ED) revizie(doc, K1), B (ED2) revizie(doc, K2) → Lock pe document; A COMMIT → Rev1 / Rev2; reluarea secvențială
#        cu K1 → aceeași Rev1, reluat: true; runda 2 pe alt document, aceeași cheie în A și B → B = aceeași Rev1, reluat: true; niciodată două Rev1.
#   C4_anulare_vs_revizie  BEN/34: A (OWNER) anulează documentul, necomis; B (ED) revizie → Lock; A COMMIT → B: P0001 DCC_DOCUMENT_ANULAT, nicio
#        revizie nouă; alocarea următoare nu refolosește numărul.
#   C4b_anulare_vs_anexa  BEN/35: runda anexei (B = anexa nouă) și runda filei (document cu 2 file, B = fila 3) → DCC_DOCUMENT_ANULAT, 0 anexe / file noi.
#   C5_drept_retras_in_asteptare  BEN/36 (C5a) și BEN/37 (C5b), ordinea FIXATĂ: (1) A (ED) aloca, necomis; (2) B (EB) aloca în fundal; (3) observatorul:
#        B în Lock (altfel scenariul se OPREȘTE); (4) sesiunea C (postgres, în locul owner-ului) revocă și COMITE — C5a: șterge rândul executie_dcc al
#        lui EB (ED2); C5b: îl restrânge prin executie_acces_proiect pe proiectul Execuție 2 (EB = ED3) — observatorul vede revocarea și B ÎNCĂ în Lock;
#        (5) A COMMIT; (6) B → 42501 DCC_FARA_DREPT; 1 document; niciun rând dcc_intentii pentru cheia lui B.
#   C6_initializari_suprapuse  BEN/38: A (OWNER) inițializează SR1 100–199 pe P1 (ghid GA), necomis; B (ADM) SR2 150–249 pe P2 (ghid GB), aceeași cheie
#        → Lock (advisory-ul cheii fără interval); A COMMIT → B: 23P01 DCC_INTERVALE_SUPRAPUSE; o singură serie.
#   C6b_ghid_vs_initializare  BEN/39: A (OWNER) inițializează SR1 100–199 pe P1 (GA), necomis; B (OWNER) mută P2 pe G3 (SR1 100–150) → Lock (advisory
#        EXCLUSIV pe contract); A COMMIT → B: P0001 DCC_GHID_INCOMPATIBIL; P2 neschimbat.
#   C7_owner_retras_la_configurare  BEN/40 (review r1 implementare, P1): (1) A (OWNER) actualizează proiectul DCC pe Execuție 2, necomis (ține
#        advisory-ul EXCLUSIV pe contract); (2) B (OWNER2) actualizează proiectul pe Execuție 1 în fundal; (3) observatorul: B în Lock; (4) sesiunea C
#        (postgres) scoate is_owner al lui OWNER2 și COMITE, observatorul vede retragerea și B ÎNCĂ în Lock; (5) A COMMIT; (6) B → 42501
#        DCC_FARA_DREPT; proiectul pe Execuție 1 rămâne la versiunea 1; niciun rând dcc_intentii pentru cheia lui B.
#   C8_anulare_vs_scriere_directa  BEN/41 (review r1 implementare, P1): A (OWNER) anulează documentul prin RPC, necomis; B = postgres, INSERT DIRECT
#        (triggerele active, fără replica) — runda anexei (anexa 1), a filei (fila 3 pe un document cu 2 file), a reviziei (Rev1 copiată din Rev0)
#        → Lock (rândul documentului, luat FOR UPDATE de garda tabelului); A COMMIT → B: P0001 DCC_GARDA_DOCUMENT_ANULAT; nimic nou pe document.
#   C9_owner_retras_la_claim  (Jakarinos #1182 r1, P1, celelalte două RPC-uri de configurare): OWNER2 redevine owner înaintea fiecărei runde.
#        (1) A (OWNER2) creează contractul BEN/42 (runda contract) / ghidul GC9 (runda ghid) cu cheia K, necomis; (2) B (OWNER2) aceeași cheie,
#        aceiași parametri → Lock (indexul unic al dcc_intentii); (3) C retrage is_owner al lui OWNER2 și COMITE, observatorul vede retragerea
#        și B ÎNCĂ în Lock; (4) A ROLLBACK (clientul a căzut) → B deține cheia, scrie, reverificarea vede retragerea → 42501 DCC_FARA_DREPT;
#        niciun contract BEN/42 / ghid GC9, niciun rând dcc_intentii pentru K.
#   C9b_owner_retras_in_asteptare  (runda r5): ca C9, dar B are ALTĂ cheie și aceiași parametri (contractul BEN/43 / ghidul GC9B) → B deține
#        cheia lui și așteaptă pe indexul unic al obiectului (dcc_contracte_uq / dcc_ghiduri_cod_versiune_uq); A ROLLBACK → INSERT-ul lui B trece,
#        reverificarea de după scriere vede retragerea → 42501 DCC_FARA_DREPT; niciun obiect, niciun rând dcc_intentii pentru cheile lui A și B.
#   C10_owner_retras_in_asteptarea_cheii_straine  BEN/44 (runda r6, Jakarinos #1182 r5 P1): (1) A = postgres (alt modul) ține
#        executie_proiecte(id = 3) FOR UPDATE, necomis; (2) B (OWNER2) CREEAZĂ proiectul DCC pe Execuție 3: trece reverificarea de după lock, iar
#        INSERT-ul așteaptă cheia străină (FOR KEY SHARE pe rândul părinte) → Lock; (3) C retrage is_owner al lui OWNER2 și COMITE, observatorul
#        vede retragerea și B ÎNCĂ în Lock; (4) A COMMIT; (5) B → 42501 DCC_FARA_DREPT (reverificarea FINALĂ); niciun proiect DCC pe Execuție 3,
#        niciun rând dcc_intentii pentru cheia lui B.
#   C11_owner_retras_in_asteptarea_importului  BEN/45 (runda r6, Jakarinos #1182 r5 P1): (1) A (OWNER2) importă rândul C11-1 cu cheia K1, necomis;
#        (2) B (OWNER2) importă ACEEAȘI identitate cu cheia K2: FOR SHARE pe proiect e compatibil, reverificarea de după lock trece, ON CONFLICT
#        așteaptă pe dcc_istoric_sursa_uq → Lock; (3) C retrage is_owner și COMITE (B ÎNCĂ în Lock); (4) A ROLLBACK → B inserează rândul;
#        (5) B → 42501 DCC_FARA_DREPT (reverificarea FINALĂ, după bucla de import); nicio apariție pe BEN/45, niciun rând dcc_intentii pentru K1, K2.
#
# MUTANȚII (DCC_MUTANT; fiecare `din` verificat că apare EXACT o dată în secțiunile extrase, altfel ieșire 2):
#   | mutant                 | ce elimină                                                          | scenariu   | observator     | OPUSUL cerut                  |
#   | fara_lock_serie        | FOR UPDATE din citirea seriei în fn_dcc_aloca                        | C1         | asteapta_lock  | B: P0001 DCC_SERIE_IMUABILA; 1 document; ultimul_ocupat 45 |
#   | fara_reverificare      | reverificările fn_dcc_drept de după lock ȘI finală din fn_dcc_aloca  | C5a, C5b   | asteapta_lock  | B succes; 2 documente          |
#   | fara_claim             | revendica nu inserează (NULL); incheie = INSERT … ON CONFLICT DO NOTHING | C2 (i) | asteapta_lock  | B: reluat false, alt document_id; 2 documente |
#   | fara_lock_document     | FOR UPDATE din citirea documentului în fn_dcc_revizie_noua           | C3 (runda 1) | asteapta_lock | B: 23505; o singură Rev1    |
#   | fara_stare_dupa_lock   | verificarea stare = 'anulat' după lock în fn_dcc_anexa_noua + fila   | C4b (ambele) | asteapta_lock | B: P0001 DCC_GARDA_DOCUMENT_ANULAT; 0 anexe / file noi |
#   | fara_garzi_anexa       | (1) verificarea din fn_dcc_anexa_noua, (2) condiția din fn_dcc_anexe_garda, (3) condiția INSERT din fn_dcc_revizii_garda | C4b (anexa) | asteapta_lock | B succes; 1 anexă + Rev0 rezervata pe documentul anulat |
#   | advisory_cu_interval   | intervalul intră în cheia fn_dcc_lock_cheie_serie                    | C6         | fara_asteptare | B succes; 2 serii suprapuse   |
#   | fara_advisory_contract | fn_dcc_lock_contract nu mai ia niciun lock (NULL;)                   | C6b        | fara_asteptare | B succes; ghidul G3 incompatibil cu seria lui A |
#   | fara_reverificare_config | reverificările dreptului după lock-uri ȘI finală din fn_dcc_proiect_seteaza | C7  | asteapta_lock  | B succes; proiectul la versiunea 2 |
#   | garzi_fara_lock        | FOR UPDATE din citirea documentului în gărzile filei, anexei, reviziei | C8 (toate) | asteapta_lock | B succes (cheia străină așteaptă tot rândul, dar nu reverifică starea); rândul nou pe documentul anulat |
#   | fara_reverificare_contract | reverificarea dreptului după scrierea din fn_dcc_contract_creeaza | C9_contract, C9b_contract | asteapta_lock | B succes; contractul BEN/42 / BEN/43 scris de fostul owner |
#   | fara_reverificare_ghid | reverificarea dreptului după scrierile din fn_dcc_ghid_creeaza       | C9_ghid, C9b_ghid | asteapta_lock | B succes; ghidul GC9 / GC9B scris de fostul owner |
#   | fara_reverificare_finala_proiect | DOAR reverificarea finală din fn_dcc_proiect_seteaza       | C10        | asteapta_lock  | B succes; proiectul DCC pe Execuție 3 creat de fostul owner |
#   | fara_reverificare_finala_istoric | DOAR reverificarea finală din fn_dcc_istoric_importa       | C11        | asteapta_lock  | B succes (1 inserat); apariția C11-1 scrisă de fostul owner |
#   Reverificarea de după lock e PĂSTRATĂ în ambii mutanți noi: B o trece (retragerea vine după ea), deci doar cea finală poate refuza.
#   Mutantul fara_claim are nevoie de operație + hash la INSERT-ul din incheie: revendica le pune în setări LOCALE tranzacției (dcc_mutant.*).
set -u
set -o pipefail

if [ "${DCC_CLUSTER_DISPENSABIL:-}" != "da" ]; then
  echo "refuz: scriptul creeaza / sterge o baza si poate crea roluri la nivel de CLUSTER; ruleaza-l DOAR pe un cluster complet dispensabil, cu DCC_CLUSTER_DISPENSABIL=da" >&2
  exit 2
fi
MUTANTI_LISTA='fara_lock_serie fara_reverificare fara_claim fara_lock_document fara_stare_dupa_lock fara_garzi_anexa advisory_cu_interval fara_advisory_contract fara_reverificare_config garzi_fara_lock fara_reverificare_contract fara_reverificare_ghid fara_reverificare_finala_proiect fara_reverificare_finala_istoric'
if [ $# -ne 1 ] || ! [[ "$1" =~ ^[a-z][a-z0-9_]{2,62}$ ]]; then
  echo "folosire: DCC_CLUSTER_DISPENSABIL=da [DCC_MUTANT=<$MUTANTI_LISTA>] $0 <nume_baza_noua (^[a-z][a-z0-9_]{2,62}\$)>" >&2; exit 2
fi
BAZA="$1"
MUTANT="${DCC_MUTANT:-nu}"
case " nu $MUTANTI_LISTA " in *" $MUTANT "*) ;; *) echo "refuz: DCC_MUTANT necunoscut: $MUTANT (nu | ${MUTANTI_LISTA// / | })" >&2; exit 2;; esac
RADACINA="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$RADACINA/supabase/migrations/20270108a_executie_dcc_registru.sql"
M09="$RADACINA/supabase/migrations/20261209a_executie_acces_proiect.sql"
SCHELET="$RADACINA/supabase/tests/20270108a_executie_dcc_registru_schelet.sql"
CAZURI="$RADACINA/src/dcc/dccCodCazuri.json"
[ -r "$MIG" ] && [ -r "$M09" ] && [ -r "$SCHELET" ] && [ -r "$CAZURI" ] || { echo "lipsesc migrarile / scheletul / src/dcc/dccCodCazuri.json" >&2; exit 2; }
command -v python3 > /dev/null || { echo "refuz: python3 lipseste (extragerea SQL-ului)" >&2; exit 2; }
export PGCLIENTENCODING=UTF8

# scenariile rulate: toate fără mutant; altfel DOAR scenariul (scenariile) mutantului, din tabel
case "$MUTANT" in
  nu) RULEAZA=' C1 C1b C2i C2ii C2iii C3 C4 C4b_anexa C4b_fila C5a C5b C6 C6b C7 C8_anexa C8_fila C8_revizie C9_contract C9_ghid C9b_contract C9b_ghid C10 C11 ';;
  fara_reverificare_finala_proiect) RULEAZA=' C10 ';;
  fara_reverificare_finala_istoric) RULEAZA=' C11 ';;
  fara_reverificare_config) RULEAZA=' C7 ';;
  fara_reverificare_contract) RULEAZA=' C9_contract C9b_contract ';;
  fara_reverificare_ghid) RULEAZA=' C9_ghid C9b_ghid ';;
  garzi_fara_lock) RULEAZA=' C8_anexa C8_fila C8_revizie ';;
  fara_lock_serie) RULEAZA=' C1 ';;
  fara_reverificare) RULEAZA=' C5a C5b ';;
  fara_claim) RULEAZA=' C2i ';;
  fara_lock_document) RULEAZA=' C3 ';;
  fara_stare_dupa_lock) RULEAZA=' C4b_anexa C4b_fila ';;
  fara_garzi_anexa) RULEAZA=' C4b_anexa ';;
  advisory_cu_interval) RULEAZA=' C6 ';;
  fara_advisory_contract) RULEAZA=' C6b ';;
esac
ruleaza() { case "$RULEAZA" in *" $1 "*) return 0;; esac; return 1; }
# modul observatorului: CONSTANT pe (mutant, scenariu), ca în tabelul planului
modObservator() { case "$MUTANT:$1" in advisory_cu_interval:C6|fara_advisory_contract:C6b) echo fara_asteptare;; *) echo asteapta_lock;; esac; }

PSM=(psql -X -q -w -v ON_ERROR_STOP=1 -d postgres)
VERS_CLIENT="$(psql --version 2>/dev/null | sed -n 's/^psql (PostgreSQL) \([0-9]*\).*/\1/p')"
if [ -z "$VERS_CLIENT" ] || [ "$VERS_CLIENT" -lt 13 ]; then echo "refuz: psql >= 13 (\\warn exista din psql 13); gasit: $(psql --version 2>&1)" >&2; exit 2; fi
PRE="$("${PSM[@]}" -tAc "SELECT current_setting('server_version_num')::int >= 170000, current_user = 'postgres', (SELECT rolsuper FROM pg_roles WHERE rolname = current_user), EXISTS (SELECT 1 FROM pg_database WHERE datname = '$BAZA')")" || { echo "refuz: nu ma pot conecta la baza postgres" >&2; exit 2; }
case "$PRE" in
  t\|t\|t\|f) ;;
  t\|t\|t\|t) echo "refuz: baza $BAZA exista deja (aleg alt nume; nu sterg nimic existent)" >&2; exit 2;;
  *) echo "refuz: cere PostgreSQL >= 17, current_user = postgres, superuser (primit: $PRE)" >&2; exit 2;;
esac
# rolurile preexistente trebuie să fie ca în schelet (fără superuser, NOINHERIT, BYPASSRLS doar service_role; authenticator deja membru în cele trei)
ROL_ALTFEL="$("${PSM[@]}" -tAc "SELECT coalesce(string_agg(rolname, ' ' ORDER BY rolname), '') FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator') AND (rolsuper OR rolinherit OR rolbypassrls IS DISTINCT FROM (rolname = 'service_role') OR (rolname = 'authenticator' AND (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE m.member = pg_roles.oid AND r.rolname IN ('anon', 'authenticated', 'service_role')) <> 3))")" || exit 2
if [ -n "$ROL_ALTFEL" ]; then echo "refuz: rolurile existente $ROL_ALTFEL au alte atribute decat scheletul (superuser / INHERIT / BYPASSRLS / membri); nu le ating" >&2; exit 2; fi

D="$(mktemp -d -t dcc_concurenta_XXXXXX)"
A_OUT="$D/A.stdout.log"; A_ERR="$D/A.stderr.log"; B_LOG="$D/B.log"
: > "$A_ERR"; : > "$B_LOG"
BAZA_CREATA=0; A_DESCHIS=0; esec=0; B_PID=''
ROLURI=(anon authenticated service_role authenticator)
ROLURI_CREATE=()
curatenie() {
  local cod=$?
  trap - EXIT INT TERM
  if [ "$cod" != 0 ] || [ "$esec" != 0 ]; then
    echo "── sesiunea A (stderr, ultimele 40) ──"; tail -n 40 "$A_ERR" 2>/dev/null
    echo "── sesiunile B (ultimele 60) ──"; tail -n 60 "$B_LOG" 2>/dev/null
  fi
  if [ -n "$B_PID" ]; then kill "$B_PID" 2>/dev/null || true; wait "$B_PID" 2>/dev/null || true; fi
  if [ "$A_DESCHIS" = 1 ]; then
    { printf '%s\n' 'ROLLBACK;' '\q' >&"$A_FD_IN"; } 2>/dev/null || true
    wait "$A_PID_C" 2>/dev/null || true
  fi
  if [ "$BAZA_CREATA" = 1 ]; then
    if "${PSM[@]}" -c "DROP DATABASE \"$BAZA\" WITH (FORCE)" > /dev/null; then echo "  OK  curatenie: DROP DATABASE $BAZA"; else echo "  NU  curatenie: DROP DATABASE $BAZA a esuat (de sters manual)"; cod=1; fi
  fi
  local r i
  # authenticator (membrul) întâi, apoi rolurile API
  for ((i = ${#ROLURI_CREATE[@]} - 1; i >= 0; i--)); do
    r="${ROLURI_CREATE[$i]}"
    if "${PSM[@]}" -c "DROP ROLE IF EXISTS \"$r\"" > /dev/null; then echo "  OK  curatenie: DROP ROLE IF EXISTS $r (lipsea inainte)"; else echo "  NU  curatenie: DROP ROLE $r a esuat (de sters manual)"; cod=1; fi
  done
  rm -rf "$D"
  if [ "$cod" = 0 ] && [ "$esec" != 0 ]; then cod=1; fi
  exit "$cod"
}
trap curatenie EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ok() { if [ "$1" = 0 ]; then echo "  OK  $2"; else echo "  NU  $2"; esec=$((esec + 1)); fi; }
astept() { if [ "$2" = "$1" ]; then echo "  OK  $3 → $2"; return 0; fi; echo "  NU  $3 → $2 (astepta $1)"; esec=$((esec + 1)); return 1; }
# potrivire pe tipar (glob: * = orice; „|” din variabilă e literal)
potriveste() { case "$2" in $1) echo "  OK  $3 → $2"; return 0;; esac; echo "  NU  $3 → $2 (astepta $1)"; esec=$((esec + 1)); return 1; }
q() { psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -tAc "$1"; }
k() { printf '00000000-0000-4000-8000-%012d' "$1"; }
U_OWNER=$(k 1); U_ED=$(k 3); U_ED2=$(k 4); U_ADM=$(k 6); U_ED3=$(k 10); U_OWNER2=$(k 11)
A_REZ=''
caOm() { printf "SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '%s', true);" "$1"; }

# ── RPC-urile ca SQL fără „;” (CTE MATERIALIZED = RPC-ul se cheamă O SINGURĂ dată); rezultatul r = câmpurile cerute, separate prin „|” ──
sqlAloca() {   # <proiect_dcc> <tematica> <tip> <titlu> <nr_file|NULL> <cheie>  → secventa|reluat|document_id
  printf "WITH s AS MATERIALIZED (SELECT public.fn_dcc_aloca(%s, 'AAA', '%s', '%s', 'general', '%s', NULL, %s, '%s') AS x) SELECT coalesce(x ->> 'secventa', '-') || '|' || coalesce(x ->> 'reluat', '-') || '|' || coalesce(x ->> 'document_id', '-') AS r FROM s" "$@"
}
sqlRevizie() {   # <document> <cheie>  → revizie|reluat|revizie_id
  printf "WITH s AS MATERIALIZED (SELECT public.fn_dcc_revizie_noua(%s, NULL, NULL, NULL, NULL, '%s') AS x) SELECT coalesce(x ->> 'revizie', '-') || '|' || coalesce(x ->> 'reluat', '-') || '|' || coalesce(x ->> 'revizie_id', '-') AS r FROM s" "$@"
}
sqlAnexa() {   # <document> <cheie>  → anexa|reluat|revizie_id
  printf "WITH s AS MATERIALIZED (SELECT public.fn_dcc_anexa_noua(%s, 'Anexa B', NULL, '%s') AS x) SELECT coalesce(x ->> 'anexa', '-') || '|' || coalesce(x ->> 'reluat', '-') || '|' || coalesce(x ->> 'revizie_id', '-') AS r FROM s" "$@"
}
sqlFila() {   # <document> <fila> <cheie>  → fila|reluat|revizie_id
  printf "WITH s AS MATERIALIZED (SELECT public.fn_dcc_fila_noua(%s, %s, NULL, NULL, '%s') AS x) SELECT coalesce(x ->> 'fila', '-') || '|' || coalesce(x ->> 'reluat', '-') || '|' || coalesce(x ->> 'revizie_id', '-') AS r FROM s" "$@"
}
sqlAnuleaza() {   # <document> <cheie>  → tinta|reluat
  printf "WITH s AS MATERIALIZED (SELECT public.fn_dcc_anuleaza(%s, NULL, 'anulat in proba', '%s') AS x) SELECT coalesce(x ->> 'tinta', '-') || '|' || coalesce(x ->> 'reluat', '-') AS r FROM s" "$@"
}
sqlInit() {   # <proiect_dcc> <interval> <prag> <cheie>  → interval|reluat  (emitent AAA, TM1 / COR)
  printf "WITH s AS MATERIALIZED (SELECT public.fn_dcc_initializeaza_serie(%s, 'AAA', 'TM1', 'COR', '%s', %s, 'prag confirmat', false, '%s') AS x) SELECT coalesce(x ->> 'interval', '-') || '|' || coalesce(x ->> 'reluat', '-') AS r FROM s" "$@"
}
sqlSeteaza() {   # <executie_proiect> <contract> <ghid> <versiune> <cheie>  → versiune|creat|reluat
  printf "WITH s AS MATERIALIZED (SELECT public.fn_dcc_proiect_seteaza(%s, %s, %s, 'AAA', 'RO', 'dcc@exemplu.invalid', '{}'::text[], '{}'::jsonb, NULL, 15, %s, '%s') AS x) SELECT coalesce(x ->> 'versiune', '-') || '|' || coalesce(x ->> 'creat', '-') || '|' || coalesce(x ->> 'reluat', '-') AS r FROM s" "$@"
}
sqlContract() {   # <cod_contract> <cheie>  → cod_contract|reluat
  printf "WITH s AS MATERIALIZED (SELECT public.fn_dcc_contract_creeaza('BEN', '%s', 'automat', NULL, '%s') AS x) SELECT coalesce(x ->> 'cod_contract', '-') || '|' || coalesce(x ->> 'reluat', '-') AS r FROM s" "$@"
}
sqlGhid() {   # <cheie> [<fișier: ghid_c9 | ghid_c9b>]  → cod|reluat  (ghidul GC9 / GC9B din $D, apostrofurile deja dublate de extragere)
  printf "WITH s AS MATERIALIZED (SELECT public.fn_dcc_ghid_creeaza('%s'::jsonb, '%s') AS x) SELECT coalesce(x ->> 'cod', '-') || '|' || coalesce(x ->> 'reluat', '-') AS r FROM s" "$(cat "$D/${2:-ghid_c9}.json")" "$1"
}
sqlIstoric() {   # <proiect_dcc> <cheie>  → inserate|identice|reluat  (un rând: excel_registru / C11-1, aceeași identitate pentru orice cheie)
  printf "WITH s AS MATERIALIZED (SELECT public.fn_dcc_istoric_importa(%s, 'lot_c11', '[{\"sursa\": \"excel_registru\", \"sursa_id\": \"C11-1\", \"valori_originale\": {\"cod\": \"x\"}}]'::jsonb, '%s') AS x) SELECT coalesce(x ->> 'inserate', '-') || '|' || coalesce(x ->> 'identice', '-') || '|' || coalesce(x ->> 'reluat', '-') AS r FROM s" "$@"
}
# citirile observatorului / ale verificărilor (ca postgres)
C() { q "SELECT id FROM public.dcc_contracte WHERE beneficiar = 'BEN' AND cod_contract = '$1'"; }
P() { q "SELECT d.id FROM public.dcc_proiecte d JOIN public.dcc_contracte c ON c.id = d.contract_id WHERE c.beneficiar = 'BEN' AND c.cod_contract = '$1' AND d.executie_proiect_id = $2"; }
G() { q "SELECT id FROM public.dcc_ghiduri WHERE cod = '$1' AND versiune = 1"; }
DOC() { q "SELECT id FROM public.dcc_documente WHERE titlu = '$1'"; }
ndoc() { q "SELECT count(*) FROM public.dcc_documente d JOIN public.dcc_contracte c ON c.id = d.contract_id WHERE c.beneficiar = 'BEN' AND c.cod_contract = '$1'"; }
ultim() { q "SELECT s.ultimul_ocupat FROM public.dcc_serii s JOIN public.dcc_contracte c ON c.id = s.contract_id WHERE c.beneficiar = 'BEN' AND c.cod_contract = '$1' AND s.tematica = '$2' AND s.tip = '$3' AND s.interval = 'general'"; }
nrev() { q "SELECT count(*) FROM public.dcc_revizii WHERE document_id = $1 ${2:-}"; }
nint() { q "SELECT count(*) FROM public.dcc_intentii WHERE cheie = '$1'"; }

# ── sesiunea A: un psql ținut deschis (coproc) ──
A_FD_IN=''; A_FD_OUT=''; A_PID_C=''; A_BPID=''
deschideA() {
  coproc A { PGAPPNAME=dcc_A psql -X -q -w -v ON_ERROR_STOP=0 -d "$BAZA" -f - 2>&1 1>"$A_OUT"; }
  A_FD_IN="${A[1]}"; A_FD_OUT="${A[0]}"; A_PID_C="$A_PID"; A_DESCHIS=1
}
asteaptaA() {
  local marcaj="$1" linie
  A_STARE=''
  while IFS= read -r -t 60 -u "$A_FD_OUT" linie; do
    printf '%s\n' "$linie" >> "$A_ERR"
    case "$linie" in "$marcaj "*) A_STARE="${linie#"$marcaj" }"; return 0;; esac
  done
  echo "  NU  sesiunea A nu a confirmat pasul $marcaj"; esec=$((esec + 1)); A_STARE='FARA_RASPUNS'; return 1
}
pasA() { local marcaj="$1"; shift; printf '%s\n' "$@" "\\warn $marcaj :SQLSTATE" >&"$A_FD_IN"; asteaptaA "$marcaj"; }
# pas cu rezultat: BEGIN + rolul + RPC-ul (NECOMIS); A_STARE = „<SQLSTATE> <rezultat>”
pasAr() {   # <marcaj> <prolog rol> <sql fara ;>
  printf '%s\n' "BEGIN;" "$2" '\set r -' "$3 \\gset" "\\warn $1 :SQLSTATE :r" >&"$A_FD_IN"; asteaptaA "$1"
}
inchideA() {
  local linie c=1
  { printf '%s\n' '\q' >&"$A_FD_IN"; } 2>/dev/null || true
  while IFS= read -r -t 60 -u "$A_FD_OUT" linie 2>/dev/null; do printf '%s\n' "$linie" >> "$A_ERR"; done
  wait "$A_PID_C" 2>/dev/null; c=$?
  [ "$c" = 127 ] && c=0
  A_DESCHIS=0
  return "$c"
}
xactA() { q "SELECT state || '|' || coalesce(xact_start::text, '-') FROM pg_stat_activity WHERE pid = $A_BPID"; }

# ── sesiunea B: psql în FUNDAL; la final `B_GATA <SQLSTATE|00000> <rezultat>` (la eroare, rezultatul = codul DCC_ din mesaj) ──
porniB() {   # <S> <prolog rol> <sql fara ;>
  B_FIS="$D/B_$1.out"; B_APP="dcc_B_$1"
  PGAPPNAME="$B_APP" psql -X -q -w -v ON_ERROR_STOP=0 -d "$BAZA" -f - > "$B_FIS" 2>&1 <<EOF &
SET lock_timeout = '10s';
BEGIN;
$2
\set r -
$3 \gset
\set st :SQLSTATE
COMMIT;
\set stc :SQLSTATE
SELECT coalesce(CASE WHEN :'st' <> '00000' THEN :'st' || ' ' || split_part(:'LAST_ERROR_MESSAGE', ':', 1) WHEN :'stc' <> '00000' THEN :'stc' || ' COMMIT' ELSE '00000 ' || :'r' END, 'NULL') AS gata \gset
\echo B_GATA :gata
EOF
  B_PID=$!
}
terminaB() {   # <S> → B_STARE
  local rc
  wait "$B_PID"; rc=$?; B_PID=''
  [ "$rc" = 0 ] || ok 1 "B ($1): psql a iesit cu codul $rc"
  printf '── B %s ──\n' "$1" >> "$B_LOG"; cat "$B_FIS" >> "$B_LOG"
  B_STARE="$(sed -n 's/^B_GATA //p' "$B_FIS" | tail -n 1)"; [ -n "$B_STARE" ] || B_STARE='FARA_MARCAJ'
}
ruleazaSincron() {   # <S> <uid> <sql fara ;> → B_STARE (fără concurent)
  porniB "$1" "$(caOm "$2")" "$3"; terminaB "$1"
}
esteInLock() { q "SELECT coalesce(string_agg(wait_event, ','), '') FROM pg_stat_activity WHERE application_name = '$B_APP' AND wait_event_type = 'Lock'"; }

# ── observatorul, cele două moduri (limita 30 s = EȘEC) ──
observaLock() {
  local lim=$((SECONDS + 30)) s
  while [ "$SECONDS" -lt "$lim" ]; do
    if grep -q '^B_GATA ' "$B_FIS" 2>/dev/null; then ok 1 "observator ($SCEN, asteapta_lock): B a terminat fara sa astepte un lock ($(sed -n 's/^B_GATA //p' "$B_FIS"))"; return 1; fi
    s="$(esteInLock)" || { ok 1 "observator ($SCEN): interogarea pg_stat_activity a esuat"; return 1; }
    if [ -n "$s" ]; then ok 0 "observator ($SCEN, asteapta_lock): B asteapta un lock (wait_event_type = Lock, wait_event = $s)"; return 0; fi
    if ! kill -0 "$B_PID" 2>/dev/null; then ok 1 "observator ($SCEN, asteapta_lock): B s-a oprit fara B_GATA si fara sa astepte"; return 1; fi
    sleep 0.02
  done
  ok 1 "observator ($SCEN, asteapta_lock): B nu a ajuns in Lock in 30 s (depasirea = esec, nu dovada)"; return 1
}
observaFaraLock() {   # <starea|xact_start a lui A, citita dupa pasul lui>
  local lim=$((SECONDS + 30)) s x
  while [ "$SECONDS" -lt "$lim" ]; do
    s="$(esteInLock)" || { ok 1 "observator ($SCEN): interogarea pg_stat_activity a esuat"; return 1; }
    if [ -n "$s" ]; then ok 1 "observator ($SCEN, fara_asteptare): mutantul nu a eliminat asteptarea (B in Lock: $s)"; return 1; fi
    if grep -q '^B_GATA ' "$B_FIS" 2>/dev/null; then
      x="$(xactA)"
      if [ "$x" = "$1" ]; then ok 0 "observator ($SCEN, fara_asteptare): B a terminat (B_GATA) cat A e inca idle in transaction, aceeasi tranzactie"; return 0; fi
      ok 1 "observator ($SCEN, fara_asteptare): B a terminat, dar A nu mai e in aceeasi tranzactie ($x, inainte $1)"; return 1
    fi
    # B poate scrie B_GATA și ieși între grep și kill -0: procesul oprit se judecă doar după o nouă citire a fișierului (bucla următoare)
    if ! kill -0 "$B_PID" 2>/dev/null && ! grep -q '^B_GATA ' "$B_FIS" 2>/dev/null; then ok 1 "observator ($SCEN, fara_asteptare): B s-a oprit fara B_GATA"; return 1; fi
    sleep 0.02
  done
  ok 1 "observator ($SCEN, fara_asteptare): B nu a terminat in 30 s (depasirea = esec, nu dovada)"; return 1
}

# un scenariu cu barieră: A ține scrierea necomisă, B pornește, observatorul, [pasul intermediar], A COMMIT / ROLLBACK, B termină.
# Orice abatere înainte de pasul final OPREȘTE scenariul (A ROLLBACK, B așteptat), cu return 1.
concurent() {   # <S> <uid A> <sql A> <tipar A> <uid B> <sql B> [<final A: COMMIT|ROLLBACK>] [<pas intermediar>]
  local S="$1" finA="${7:-COMMIT}" pas="${8:-}" mod xa obs
  mod="$(modObservator "$SCEN")"
  B_STARE='NERULAT'
  # A = postgres (C10): sesiunea altui modul, fără rol / JWT, ține un rând părinte
  if [ "$2" = postgres ]; then pasAr "${S}_A" "-- A ca postgres, fara rol" "$3"; else pasAr "${S}_A" "$(caOm "$2")" "$3"; fi
  if ! potriveste "$4" "$A_STARE" "A ($S): scrierea, NECOMISA"; then pasA "${S}_X" "ROLLBACK;"; return 1; fi
  A_REZ="$A_STARE"   # rezultatul scrierii lui A (A_STARE se suprascrie la COMMIT)
  xa="$(xactA)"
  case "$xa" in "idle in transaction|"*) ;; *) ok 1 "A ($S): backend-ul nu e idle in transaction ($xa)"; pasA "${S}_X" "ROLLBACK;"; return 1;; esac
  # B = postgres: scriere DIRECTĂ (fără rol / JWT), cu triggerele active
  if [ "$5" = postgres ]; then porniB "$S" "-- B ca postgres, scriere directa" "$6"; else porniB "$S" "$(caOm "$5")" "$6"; fi
  if [ "$mod" = asteapta_lock ]; then observaLock; else observaFaraLock "$xa"; fi
  obs=$?
  if [ "$obs" = 0 ] && [ -n "$pas" ]; then "$pas"; obs=$?; fi
  if [ "$obs" != 0 ]; then pasA "${S}_X" "ROLLBACK;"; terminaB "$S"; echo "     scenariul $S OPRIT (B: $B_STARE)"; return 1; fi
  pasA "${S}_C" "$finA;"; astept 00000 "$A_STARE" "A ($S): $finA"
  terminaB "$S"
}

echo "0. baza de unica folosinta: scheletul + lantul de drept (20261209a) + sectiunile 1-6 ale migrarii 20270108a, mutant=$MUTANT"
EXISTENTE=" $("${PSM[@]}" -tAc "SELECT string_agg(rolname, ' ') FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator')") "
for r in "${ROLURI[@]}"; do
  case "$EXISTENTE" in *" $r "*) continue;; esac
  case "$r" in service_role) atr='NOLOGIN NOINHERIT BYPASSRLS';; authenticator) atr='NOINHERIT';; *) atr='NOLOGIN NOINHERIT';; esac
  if "${PSM[@]}" -c "CREATE ROLE \"$r\" $atr" > /dev/null; then ROLURI_CREATE+=("$r"); else echo "refuz: CREATE ROLE $r a esuat" >&2; exit 2; fi
done
echo "     roluri de cluster create (si sterse la final): ${ROLURI_CREATE[*]:-niciunul}"
if "${PSM[@]}" -c "CREATE DATABASE \"$BAZA\"" > /dev/null; then BAZA_CREATA=1; ok 0 "CREATE DATABASE $BAZA"; else echo "refuz: CREATE DATABASE $BAZA a esuat" >&2; exit 2; fi

# extragerea (python3, fără CR): scheletul fără CREATE ROLE, lanțul de drept din 20261209a (amprente verificate), secțiunile 1–6 (+ mutantul),
# ghidurile sintetice (formatele din src/dcc/dccCodCazuri.json). Ieșirea 3 = mutant inaplicabil.
python3 - "$SCHELET" "$M09" "$MIG" "$CAZURI" "$D" "$MUTANT" "$U_OWNER" <<'PY'
import hashlib, json, re, sys
schelet_p, m09_p, mig_p, caz_p, d, mutant, owner = sys.argv[1:8]
citeste = lambda p: open(p, encoding='utf-8').read().replace('\r', '')
SCH, M09, MIG = citeste(schelet_p), citeste(m09_p), citeste(mig_p)
def scrie(nume, text):
    open(d + '/' + nume, 'w', encoding='utf-8').write(text)
# 1. scheletul fără cele 4 CREATE ROLE (rolurile le-a creat scriptul, doar dacă lipseau)
roluri = re.compile(r'^CREATE ROLE (anon|authenticated|service_role|authenticator)\b[^;\n]*;\n', re.M)
sch2, n = roluri.subn('', SCH)
if n != 4 or 'CREATE ROLE' in sch2: sys.exit('scheletul: astept exact 4 randuri CREATE ROLE, gasit %d' % n)
scrie('schelet.sql', sch2)
# 2. lanțul de drept, EXACT ca în 20261209a (același algoritm ca scripts/pglite/dcc_registru/baza.mjs)
LANT = [
    ('fn_executie_acces_nerestrans_cont', 'CREATE FUNCTION public.fn_executie_acces_nerestrans_cont(', '9a07e0089139e54ba5c6a0cfaaf093cc'),
    ('fn_executie_acces_lista_cont', 'CREATE FUNCTION public.fn_executie_acces_lista_cont(', 'e7cf9b852002a1c1cbe781772c33bf0c'),
    ('fn_executie_acces_nerestrans', 'CREATE FUNCTION public.fn_executie_acces_nerestrans()', 'b863c5324684dbf4eb9af81474fbc4e1'),
    ('fn_executie_acces_lista', 'CREATE FUNCTION public.fn_executie_acces_lista(', 'd9e123a46b83530a7203d4a24da5cf9b'),
    ('fn_executie_proiect_permis', 'CREATE FUNCTION public.fn_executie_proiect_permis(', 'bd4320f76e9f36f492c7186c0a982155'),
]
lant = ''
for nume, cap, amp in LANT:
    if M09.count(cap) != 1: sys.exit('20261209a: %s apare de %d ori' % (cap, M09.count(cap)))
    i = M09.index(cap)
    a = re.search(r'\bAS\s+(\$[A-Za-z_]*\$)', M09[i:])
    tag = a.group(1); start = i + a.end()
    f = M09[i:M09.index(';', M09.index(tag, start) + len(tag)) + 1]
    corp = f[f.index('$f$') + 3:f.rindex('$f$')]
    if hashlib.md5(corp.encode('utf-8')).hexdigest() != amp or ("'%s'" % amp) not in MIG:
        sys.exit('lantul de drept: %s are alta amprenta decat cea revizuita in 20270108a' % nume)
    acl = [l for l in M09.split('\n') if re.match(r'^(REVOKE|GRANT) ', l) and ('ON FUNCTION public.' + nume + '(') in l]
    lant += f + '\n' + '\n'.join(acl) + '\n'
lant += ('CREATE POLICY executie_acces_proiect_citire ON public.executie_proiecte AS RESTRICTIVE FOR SELECT TO authenticated\n'
         '  USING ((SELECT public.fn_executie_acces_nerestrans()) OR public.fn_executie_proiect_permis(id::bigint, false));\n')
scrie('lant.sql', lant)
# 3. secțiunile 1–6: fiecare marcaj o dată, în ordine; textul de la „-- ─── 1.” până la (fără) „-- ─── 7.”
marcaje = re.findall(r'^-- ─── ([0-9][a-z]?)\. ', MIG, re.M)
if marcaje != ['0', '1', '2', '2a', '2b', '2c', '2d', '3', '4', '5', '5a', '5b', '6', '7']:
    sys.exit('migrarea: marcajele sectiunilor nu sunt exact 0,1,2,2a-2d,3,4,5,5a,5b,6,7 (o data fiecare): %r' % marcaje)
inc, sf = '\n-- ─── 1. ', '\n-- ─── 7. '
ddl = MIG[MIG.index(inc) + 1:MIG.index(sf) + 1]
for interzis in ('$pre$', '$lock$', '$post$', '$l15_inainte$', 'pg_temp.lant_', 'gazpet.livrare_migrare', 'gazpet.plafon_tranzactie', 'gazpet.lock_puternic_la'):
    if interzis in ddl: sys.exit('sectiunile extrase contin o garda a runnerului: ' + interzis)
nr = (len(re.findall(r'^CREATE TABLE public\.dcc_', ddl, re.M)), len(re.findall(r'^CREATE FUNCTION public\.fn_dcc_', ddl, re.M)),
      len(re.findall(r'^CREATE TRIGGER trg_dcc_', ddl, re.M)))
scrie('numere.txt', '%d|%d|%d' % nr)
# 4. mutantul: fiecare `din` EXACT o dată în textul curent (altfel ieșire 3 = inaplicabil)
# verificările de după lock au mesaje UNICE (revizie noua / fila noua / anexa noua): înlocuiri pe o singură linie
ANEXA_STARE = ("  IF d.stare = 'anulat' THEN RAISE EXCEPTION 'DCC_DOCUMENT_ANULAT: documentul e anulat (anexa noua)' USING ERRCODE = 'P0001'; END IF;\n",
               "  -- MUTANT: fara verificarea starii dupa lock (anexa noua)\n")
FILA_STARE = ("  IF d.stare = 'anulat' THEN RAISE EXCEPTION 'DCC_DOCUMENT_ANULAT: documentul e anulat (fila noua)' USING ERRCODE = 'P0001'; END IF;\n",
              "  -- MUTANT: fara verificarea starii dupa lock (fila noua)\n")
MUTANTI = {
    'nu': [],
    'fara_lock_serie': [("     AND x.interval = v_int FOR UPDATE;\n", "     AND x.interval = v_int;\n")],
    'fara_reverificare': [(
        "  -- reverificarea după lock (dreptul cu un instantaneu nou: o retragere comisă cât am așteptat se vede aici)\n"
        "  IF NOT public.fn_dcc_drept(p_proiect_dcc, 'scriere') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF;\n",
        "  -- MUTANT fara_reverificare: fara a doua chemare fn_dcc_drept\n"),
        ("  IF NOT public.fn_dcc_drept(p_proiect_dcc, 'scriere') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF; -- reverificarea finala (aloca)\n",
         "  -- MUTANT fara_reverificare: fara reverificarea finala\n")],
    'fara_claim': [
        ("  INSERT INTO public.dcc_intentii (cheie, operatie, parametri_hash, autor, actor)\n"
         "  VALUES (p_cheie, p_operatie, p_hash, v_uid, CASE WHEN v_uid IS NULL THEN 'server' ELSE 'om' END)\n"
         "  ON CONFLICT (cheie) DO NOTHING\n"
         "  RETURNING cheie INTO v;\n"
         "  IF v IS NULL THEN RETURN public.fn_dcc_intentie_reia(p_cheie, p_operatie, p_hash); END IF;\n"
         "  RETURN NULL;\n",
         "  -- MUTANT fara_claim: nicio revendicare; operatia si hash-ul trec la incheie prin setari LOCALE tranzactiei\n"
         "  PERFORM set_config('dcc_mutant.operatie', p_operatie, true), set_config('dcc_mutant.hash', p_hash, true);\n"
         "  RETURN NULL;\n"),
        ("  UPDATE public.dcc_intentii i SET rezultat = p_rezultat WHERE i.cheie = p_cheie AND i.rezultat IS NULL;\n"
         "  IF NOT FOUND THEN RAISE EXCEPTION 'DCC_INTENTIE_NEINCHEIATA: cheia de intentie nu e a apelului curent' USING ERRCODE = 'P0001'; END IF;\n",
         "  -- MUTANT fara_claim: cheia se scrie abia aici, fara asteptare pe index\n"
         "  INSERT INTO public.dcc_intentii (cheie, operatie, parametri_hash, autor, actor, rezultat)\n"
         "  VALUES (p_cheie, current_setting('dcc_mutant.operatie'), current_setting('dcc_mutant.hash'), auth.uid(),\n"
         "          CASE WHEN auth.uid() IS NULL THEN 'server' ELSE 'om' END, p_rezultat)\n"
         "  ON CONFLICT (cheie) DO NOTHING;\n"),
    ],
    'fara_lock_document': [(
        "  -- lock-urile: 3 (proiectul) -> 6 (documentul)\n"
        "  SELECT * INTO p FROM public.dcc_proiecte x WHERE x.id = v_proiect FOR SHARE;\n"
        "  SELECT * INTO d FROM public.dcc_documente x WHERE x.id = p_document FOR UPDATE;\n",
        "  -- lock-urile: 3 (proiectul) -> 6 (documentul)\n"
        "  SELECT * INTO p FROM public.dcc_proiecte x WHERE x.id = v_proiect FOR SHARE;\n"
        "  SELECT * INTO d FROM public.dcc_documente x WHERE x.id = p_document;\n")],
    'fara_stare_dupa_lock': [FILA_STARE, ANEXA_STARE],
    # (1) RPC-ul anexei, (2) triggerul dcc_anexe, (3) ramura INSERT a triggerului dcc_revizii: IF-ul rămâne, RAISE-ul devine NULL;
    'fara_garzi_anexa': [
        ANEXA_STARE,
        ("    RAISE EXCEPTION 'DCC_GARDA_DOCUMENT_ANULAT: documentul e anulat (anexa)' USING ERRCODE = 'P0001';\n", "    NULL;\n"),
        ("      RAISE EXCEPTION 'DCC_GARDA_DOCUMENT_ANULAT: documentul e anulat (revizie)' USING ERRCODE = 'P0001';\n", "      NULL;\n"),
    ],
    'advisory_cu_interval': [("|| '|' || p_tip, 0);", "|| '|' || p_tip || '|' || coalesce(p_interval, '-'), 0);")],
    'fara_advisory_contract': [("IF p_exclusiv THEN PERFORM pg_advisory_xact_lock(v_k); ELSE PERFORM pg_advisory_xact_lock_shared(v_k); END IF;", "NULL;")],
    'fara_reverificare_config': [("  PERFORM public.fn_dcc_config_permisa_intern(); -- reverificarea proiectului dupa lock\n",
                                  "  -- MUTANT fara_reverificare_config: fara reverificarea dupa lock-uri\n"),
                                 ("  PERFORM public.fn_dcc_config_permisa_intern(); -- reverificarea finala (proiect)\n",
                                  "  -- MUTANT fara_reverificare_config: fara reverificarea finala\n")],
    # runda r6: DOAR reverificarea finală (cea de după lock rămâne și B o trece)
    'fara_reverificare_finala_proiect': [("  PERFORM public.fn_dcc_config_permisa_intern(); -- reverificarea finala (proiect)\n",
                                          "  -- MUTANT fara_reverificare_finala_proiect\n")],
    'fara_reverificare_finala_istoric': [("  IF NOT v_srv AND NOT public.fn_dcc_drept(p_proiect_dcc, 'admin') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF; -- reverificarea finala (import istoric)\n",
                                          "  -- MUTANT fara_reverificare_finala_istoric\n")],
    'garzi_fara_lock': [
        ("  SELECT * INTO d FROM public.dcc_documente x WHERE x.id = NEW.document_id FOR UPDATE; -- garda filei\n",
         "  SELECT * INTO d FROM public.dcc_documente x WHERE x.id = NEW.document_id; -- MUTANT garzi_fara_lock (fila)\n"),
        ("  SELECT * INTO d FROM public.dcc_documente x WHERE x.id = NEW.document_id FOR UPDATE; -- garda anexei\n",
         "  SELECT * INTO d FROM public.dcc_documente x WHERE x.id = NEW.document_id; -- MUTANT garzi_fara_lock (anexa)\n"),
        ("  SELECT * INTO d FROM public.dcc_documente x WHERE x.id = NEW.document_id FOR UPDATE; -- garda reviziei\n",
         "  SELECT * INTO d FROM public.dcc_documente x WHERE x.id = NEW.document_id; -- MUTANT garzi_fara_lock (revizie)\n"),
    ],
    'fara_reverificare_contract': [("  PERFORM public.fn_dcc_config_permisa_intern(); -- reverificarea dupa scrierea contractului (asteptarea pe indexul unic)\n",
                                    "  -- MUTANT fara_reverificare_contract\n")],
    'fara_reverificare_ghid': [("  PERFORM public.fn_dcc_config_permisa_intern(); -- reverificarea dupa scrierile ghidului (asteptarile pe indexuri / randul ghidului)\n",
                                "  -- MUTANT fara_reverificare_ghid\n")],
}
for din, in_ in MUTANTI[mutant]:
    c = ddl.count(din)
    if c != 1:
        print('mutant inaplicabil %s: textul apare de %d ori: %r' % (mutant, c, din[:100]), file=sys.stderr)
        sys.exit(3)
    ddl = ddl.replace(din, in_)
scrie('ddl.sql', ddl)
# 5. ghidurile sintetice, create PRIN RPC ca owner (aceleași valori ca scripts/pglite/dcc_registru/rpc.mjs)
F = json.load(open(caz_p, encoding='utf-8'))['formate']
VALORI = [('emitent', 'AAA', False), ('emitent', 'SUB', False), ('tematica', 'TM1', False), ('tematica', 'TM2', False), ('tematica', 'TS', False),
          ('tip', 'COR', False), ('tip', 'RAP', False), ('tip', 'DES', False), ('tip', 'MOM', True), ('limba', 'RO', False), ('limba', 'EN', False),
          ('limba', 'BI', False)]
def ghid(cod, fmt, intervale):
    return {'cod': cod, 'versiune': 1, 'sursa': 'ghid sintetic', 'format_cod': F[fmt], 'format_fisier': F[fmt],
            'valori': [dict({'categorie': c, 'cod': v, 'descriere': None}, **({'fara_tematica': True} if ft else {})) for c, v, ft in VALORI],
            'intervale': [{'interval': i, 'limita_inf': a, 'limita_sup': b} for i, a, b in intervale]}
GH = [('GL1', 'lot1', [('general', 1, 99999)]), ('GA', 'dde', [('SR1', 100, 199)]), ('GB', 'dde', [('SR2', 150, 249)]), ('G3', 'dde', [('SR1', 100, 150)])]
linii = ['BEGIN;', "SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '%s', true);" % owner]
for i, (cod, fmt, iv) in enumerate(GH):
    js = json.dumps(ghid(cod, fmt, iv)).replace("'", "''")
    linii.append("SELECT public.fn_dcc_ghid_creeaza('%s'::jsonb, '00000000-0000-4000-8000-%012d'::uuid);" % (js, 1001 + i))
linii.append('COMMIT;')
scrie('ghiduri.sql', '\n'.join(linii) + '\n')
# ghidul rundei C9_ghid (scris de B în probă, nu în fixtură): JSON-ul ca literal SQL (apostrofurile dublate)
scrie('ghid_c9.json', json.dumps(ghid('GC9', 'lot1', [('general', 1, 99999)])).replace("'", "''"))
# ghidul rundei C9b_ghid (alt cod: în rularea mutantului, GC9 există deja după C9_ghid)
scrie('ghid_c9b.json', json.dumps(ghid('GC9B', 'lot1', [('general', 1, 99999)])).replace("'", "''"))
print('     extras: schelet (-4 CREATE ROLE), lant (5 functii, amprente verificate), sectiunile 1-6: %d caractere (%d tabele, %d functii, %d triggere), mutant %s (%d inlocuiri)'
      % ((len(ddl),) + nr + (mutant, len(MUTANTI[mutant]))))
PY
rc=$?
if [ "$rc" = 3 ]; then echo "refuz: mutant inaplicabil ($MUTANT)" >&2; exit 2; fi
ok "$rc" "SQL-ul extras (schelet, lantul de drept cu amprentele revizuite, sectiunile 1-6; mutant: $MUTANT)"
[ "$rc" = 0 ] || exit 1
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 -f "$D/schelet.sql" > /dev/null; ok $? "scheletul"
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 -f "$D/lant.sql" > /dev/null; ok $? "lantul de drept pe proiect (20261209a)"
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 -f "$D/ddl.sql" > /dev/null; ok $? "sectiunile 1-6 ale migrarii 20270108a"
astept "$(cat "$D/numere.txt")" "$(q "SELECT (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname LIKE 'dcc\\_%'),
  (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\\_dcc\\_%'),
  (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'trg\\_dcc\\_%')")" "obiectele din baza = cele din textul extras: tabele | functii | triggere"
[ "$esec" = 0 ] || exit 1

# fixturile: identitățile sintetice (ca postgres), apoi ghidurile / contractele / proiectele / seriile ca OWNER și documentele ca ED, PRIN RPC
{
  cat <<EOF
INSERT INTO public.executie_proiecte (id, cod_intern, nume) VALUES (1, 'E1', 'Proiect unu'), (2, 'E2', 'Proiect doi'), (3, 'E3', 'Proiect trei');
INSERT INTO public.profiles (id, name, is_owner) VALUES ('$U_OWNER', 'OWNER', true), ('$U_ED', 'ED', false), ('$U_ED2', 'ED2', false), ('$U_ADM', 'ADM', false),
  ('$U_ED3', 'ED3', false), ('$U_OWNER2', 'OWNER2', true);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('$U_ED', 'executie_dcc', 'editor'), ('$U_ED2', 'executie_dcc', 'editor'),
  ('$U_ED3', 'executie_dcc', 'editor'), ('$U_ADM', 'executie_dcc', 'admin');
\ir ghiduri.sql
BEGIN;
$(caOm "$U_OWNER")
EOF
  for c in 30 31 32 33 34 35 36 37 38 39 40 41 44 45; do printf "SELECT public.fn_dcc_contract_creeaza('BEN', '%s', 'automat', NULL, '%s');\n" "$c" "$(k $((1100 + c)))"; done
  echo 'COMMIT;'
  # `\gset` trece ca ARGUMENT (%s), nu în formatul printf (unde `\g` ar fi o secvență de escape)
  # alias-ul CITAT („g_GL1”): necitat, Postgres îl coboară la litere mici și :g_GL1 n-ar mai exista
  for g in GL1 GA GB G3; do printf "SELECT id AS \"g_%s\" FROM public.dcc_ghiduri WHERE cod = '%s' AND versiune = 1 %s\n" "$g" "$g" '\gset'; done
  for c in 30 31 32 33 34 35 36 37 38 39 40 41 44 45; do printf "SELECT id AS c%s FROM public.dcc_contracte WHERE beneficiar = 'BEN' AND cod_contract = '%s' %s\n" "$c" "$c" '\gset'; done
  echo 'BEGIN;'; caOm "$U_OWNER"; echo
  # proiectele DCC: <contract> <proiect Execuție> <ghid>
  n=1200
  for t in '30 1 GL1' '31 1 GL1' '31 2 GL1' '32 1 GL1' '33 1 GL1' '34 1 GL1' '35 1 GL1' '36 1 GL1' '37 1 GL1' '38 1 GA' '38 2 GB' '39 1 GA' '39 2 GA' '40 1 GL1' '40 2 GL1' '41 1 GL1' '45 1 GL1'; do
    set -- $t; n=$((n + 1))
    printf "SELECT public.fn_dcc_proiect_seteaza(%s, :c%s, :g_%s, 'AAA', 'RO', 'dcc@exemplu.invalid', '{}'::text[], '{}'::jsonb, NULL, 15, NULL, '%s');\n" "$2" "$1" "$3" "$(k $n)"
  done
  echo 'COMMIT;'
  for c in 30 31 32 33 34 35 36 37 41; do printf "SELECT id AS p%s FROM public.dcc_proiecte WHERE contract_id = :c%s AND executie_proiect_id = 1 %s\n" "$c" "$c" '\gset'; done
  echo 'BEGIN;'; caOm "$U_OWNER"; echo
  # seriile: <proiect> <tip> <prag>
  n=1300
  for t in '30 COR 44' '31 COR 44' '32 COR 44' '33 COR 0' '34 COR 0' '35 COR 0' '35 DES 0' '36 COR 0' '37 COR 0' '41 COR 0' '41 DES 0'; do
    set -- $t; n=$((n + 1))
    printf "SELECT public.fn_dcc_initializeaza_serie(:p%s, 'AAA', 'TM1', '%s', 'general', %s, 'prag confirmat', false, '%s');\n" "$1" "$2" "$3" "$(k $n)"
  done
  echo 'COMMIT;'
  echo 'BEGIN;'; caOm "$U_ED"; echo
  # documentele de pornire ale scenariilor C3 / C4 / C4b (ED, secvențial)
  printf "SELECT public.fn_dcc_aloca(:p33, 'AAA', 'TM1', 'COR', 'general', 'C3 doc unu', NULL, NULL, '%s');\n" "$(k 1401)"
  printf "SELECT public.fn_dcc_aloca(:p33, 'AAA', 'TM1', 'COR', 'general', 'C3 doc doi', NULL, NULL, '%s');\n" "$(k 1402)"
  printf "SELECT public.fn_dcc_aloca(:p34, 'AAA', 'TM1', 'COR', 'general', 'C4 doc', NULL, NULL, '%s');\n" "$(k 1403)"
  printf "SELECT public.fn_dcc_aloca(:p35, 'AAA', 'TM1', 'COR', 'general', 'C4b anexa', NULL, NULL, '%s');\n" "$(k 1404)"
  printf "SELECT public.fn_dcc_aloca(:p35, 'AAA', 'TM1', 'DES', 'general', 'C4b file', NULL, 2, '%s');\n" "$(k 1405)"
  # documentele scenariului C8 (anulare vs scriere directă)
  printf "SELECT public.fn_dcc_aloca(:p41, 'AAA', 'TM1', 'COR', 'general', 'C8 anexa', NULL, NULL, '%s');\n" "$(k 1406)"
  printf "SELECT public.fn_dcc_aloca(:p41, 'AAA', 'TM1', 'DES', 'general', 'C8 file', NULL, 2, '%s');\n" "$(k 1407)"
  printf "SELECT public.fn_dcc_aloca(:p41, 'AAA', 'TM1', 'COR', 'general', 'C8 revizie', NULL, NULL, '%s');\n" "$(k 1408)"
  echo 'COMMIT;'
} > "$D/fixtura.sql"
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -f "$D/fixtura.sql" > "$D/fixtura.out" 2>&1; rc=$?
ok "$rc" "fixturile prin RPC (4 ghiduri, 14 contracte, 17 proiecte DCC, 11 serii, 8 documente)"
[ "$rc" = 0 ] || { tail -n 20 "$D/fixtura.out"; exit 1; }
astept '4|14|17|11|8|10' "$(q "SELECT (SELECT count(*) FROM public.dcc_ghiduri), (SELECT count(*) FROM public.dcc_contracte), (SELECT count(*) FROM public.dcc_proiecte),
  (SELECT count(*) FROM public.dcc_serii), (SELECT count(*) FROM public.dcc_documente), (SELECT count(*) FROM public.dcc_revizii)")" \
  "fixturile: ghiduri | contracte | proiecte | serii | documente | revizii"
[ "$esec" = 0 ] || exit 1

deschideA
printf '%s\n' "SET lock_timeout = '5s';" 'SELECT pg_backend_pid() AS apid \gset' '\warn A0 :SQLSTATE :apid' >&"$A_FD_IN"; asteaptaA A0
A_BPID="${A_STARE#* }"
case "$A_STARE" in "00000 "[0-9]*) ok 0 "A: sesiunea deschisa (backend $A_BPID)";; *) ok 1 "A: sesiunea nu s-a deschis ($A_STARE)"; exit 1;; esac

# ── C1 ──
if ruleaza C1; then
  SCEN=C1; p="$(P 30 1)"
  echo "C1_prima_alocare_simultana: BEN/30, seria TM1/COR/general cu pragul 44, fara alocari (mutant: $MUTANT, observator: $(modObservator C1))"
  if concurent C1 "$U_ED" "$(sqlAloca "$p" TM1 COR 'C1 A' NULL "$(k 2101)")" '00000 45|false|*' "$U_ED2" "$(sqlAloca "$p" TM1 COR 'C1 B' NULL "$(k 2102)")"; then
    if [ "$MUTANT" = fara_lock_serie ]; then
      astept 'P0001 DCC_SERIE_IMUABILA' "$B_STARE" "B (OPUS): fara FOR UPDATE pe serie, B a citit 44, UPDATE-ul re-evaluat scrie tot 45 -> triggerul strict"
      astept 1 "$(ndoc 30)" "dcc_documente pe BEN/30"; astept 45 "$(ultim 30 TM1 COR)" "ultimul_ocupat"
    else
      potriveste '00000 46|false|*' "$B_STARE" "B: 46, dupa COMMIT-ul lui A"
      astept 2 "$(ndoc 30)" "dcc_documente pe BEN/30"; astept 46 "$(ultim 30 TM1 COR)" "ultimul_ocupat"
    fi
  fi
fi

# ── C1b ──
if ruleaza C1b; then
  SCEN=C1b
  echo "C1b_doua_proiecte_simultan: BEN/31, A pe P1, B pe P2, acelasi contract si aceeasi serie"
  if concurent C1b "$U_ED" "$(sqlAloca "$(P 31 1)" TM1 COR 'C1b A' NULL "$(k 2111)")" '00000 45|false|*' "$U_ED2" "$(sqlAloca "$(P 31 2)" TM1 COR 'C1b B' NULL "$(k 2112)")"; then
    potriveste '00000 46|false|*' "$B_STARE" "B (P2): 46, nicio eroare de unicitate"
    astept 2 "$(ndoc 31)" "dcc_documente pe BEN/31"; astept 46 "$(ultim 31 TM1 COR)" "ultimul_ocupat"
    astept '1|1' "$(q "SELECT count(*) FILTER (WHERE d.executie_proiect_id = 1), count(*) FILTER (WHERE d.executie_proiect_id = 2) FROM public.dcc_documente x JOIN public.dcc_proiecte d ON d.id = x.proiect_dcc_id JOIN public.dcc_contracte c ON c.id = d.contract_id WHERE c.cod_contract = '31'")" "cate un document pe P1 | P2"
  fi
fi

# ── C2 ──
p32="$(P 32 1)"
if ruleaza C2i; then
  SCEN=C2i
  echo "C2_retry_dupa_timeout (i): acelasi utilizator, aceeasi cheie, aceiasi parametri (mutant: $MUTANT)"
  if concurent C2i "$U_ED" "$(sqlAloca "$p32" TM1 COR 'C2i' NULL "$(k 2201)")" '00000 45|false|*' "$U_ED" "$(sqlAloca "$p32" TM1 COR 'C2i' NULL "$(k 2201)")"; then
    ida="${A_REZ##*|}"
    if [ "$MUTANT" = fara_claim ]; then
      potriveste '00000 46|false|*' "$B_STARE" "B (OPUS): fara claim, B asteapta pe serie si scrie un AL DOILEA document (reluat: false)"
      [ "${B_STARE##*|}" != "$ida" ]; ok $? "B: alt document_id decat A (${B_STARE##*|} vs $ida)"
      astept 2 "$(ndoc 32)" "dcc_documente pe BEN/32"
    else
      astept "00000 45|true|$ida" "$B_STARE" "B: acelasi document_id, reluat: true"
      astept 1 "$(ndoc 32)" "dcc_documente pe BEN/32"
    fi
  fi
fi
if ruleaza C2ii; then
  SCEN=C2ii
  echo "C2_retry_dupa_timeout (ii): aceeasi cheie, alt titlu"
  if concurent C2ii "$U_ED" "$(sqlAloca "$p32" TM1 COR 'C2ii A' NULL "$(k 2202)")" '00000 46|false|*' "$U_ED" "$(sqlAloca "$p32" TM1 COR 'C2ii B' NULL "$(k 2202)")"; then
    astept '22023 DCC_CHEIE_ALTI_PARAMETRI' "$B_STARE" "B: cheia folosita pentru alta cerere"
    astept 2 "$(ndoc 32)" "dcc_documente pe BEN/32"
  fi
fi
if ruleaza C2iii; then
  SCEN=C2iii
  echo "C2_retry_dupa_timeout (iii): A ROLLBACK (clientul a cazut inainte de commit), B reia cu aceeasi cheie"
  if concurent C2iii "$U_ED" "$(sqlAloca "$p32" TM1 COR 'C2iii' NULL "$(k 2203)")" '00000 47|false|*' "$U_ED" "$(sqlAloca "$p32" TM1 COR 'C2iii' NULL "$(k 2203)")" ROLLBACK; then
    potriveste '00000 47|false|*' "$B_STARE" "B: scrie el documentul (reluat: false)"
    astept 3 "$(ndoc 32)" "dcc_documente pe BEN/32"
    astept 1 "$(q "SELECT count(*) FROM public.dcc_documente WHERE titlu = 'C2iii'")" "documentul C2iii scris o singura data"
    astept "${B_STARE##*|}" "$(q "SELECT rezultat ->> 'document_id' FROM public.dcc_intentii WHERE cheie = '$(k 2203)'")" "intentia cheii = documentul lui B"
  fi
fi

# ── C3 ──
if ruleaza C3; then
  SCEN=C3; d3="$(DOC 'C3 doc unu')"; d3b="$(DOC 'C3 doc doi')"
  echo "C3_revizii_simultane: runda 1, doua chei pe acelasi document (mutant: $MUTANT)"
  if concurent C3r1 "$U_ED" "$(sqlRevizie "$d3" "$(k 2301)")" '00000 1|false|*' "$U_ED2" "$(sqlRevizie "$d3" "$(k 2302)")"; then
    ira="${A_REZ##*|}"
    if [ "$MUTANT" = fara_lock_document ]; then
      potriveste '23505 *' "$B_STARE" "B (OPUS): fara lock pe document, B calculeaza tot Rev1 si se loveste de unicitate"
      astept 2 "$(nrev "$d3")" "revizii pe document (Rev0 + o Rev1)"
    else
      potriveste '00000 2|false|*' "$B_STARE" "B: Rev2, dupa COMMIT-ul lui A"
      astept 3 "$(nrev "$d3")" "revizii pe document (Rev0, Rev1, Rev2)"
      ruleazaSincron C3k1 "$U_ED" "$(sqlRevizie "$d3" "$(k 2301)")"; astept "00000 1|true|$ira" "$B_STARE" "reluarea cu cheia lui A: aceeasi Rev1, reluat: true"
    fi
    astept 1 "$(nrev "$d3" 'AND revizie = 1')" "o singura Rev1"
  fi
  if [ "$MUTANT" = nu ]; then
    echo "C3_revizii_simultane: runda 2, aceeasi cheie in A si B (alt document)"
    if concurent C3r2 "$U_ED" "$(sqlRevizie "$d3b" "$(k 2303)")" '00000 1|false|*' "$U_ED" "$(sqlRevizie "$d3b" "$(k 2303)")"; then
      astept "00000 1|true|${A_REZ##*|}" "$B_STARE" "B: aceeasi Rev1, reluat: true"
      astept '2|1' "$(q "SELECT count(*), count(*) FILTER (WHERE revizie = 1) FROM public.dcc_revizii WHERE document_id = $d3b")" "revizii | Rev1 pe documentul doi"
    fi
  fi
fi

# ── C4 ──
if ruleaza C4; then
  SCEN=C4; d4="$(DOC 'C4 doc')"
  echo "C4_anulare_vs_revizie: A (owner) anuleaza documentul, B (ED) cere o revizie"
  if concurent C4 "$U_OWNER" "$(sqlAnuleaza "$d4" "$(k 2401)")" '00000 document|false' "$U_ED" "$(sqlRevizie "$d4" "$(k 2402)")"; then
    astept 'P0001 DCC_DOCUMENT_ANULAT' "$B_STARE" "B: documentul e anulat (codul RPC-ului)"
    astept '1|anulat|anulata' "$(q "SELECT (SELECT count(*) FROM public.dcc_revizii WHERE document_id = $d4) || '|' || x.stare || '|' || (SELECT string_agg(stare_transport, ',') FROM public.dcc_revizii WHERE document_id = $d4) FROM public.dcc_documente x WHERE x.id = $d4")" "nicio revizie noua | documentul | Rev0"
    ruleazaSincron C4urm "$U_ED" "$(sqlAloca "$(P 34 1)" TM1 COR 'C4 urmatorul' NULL "$(k 2403)")"
    potriveste '00000 2|false|*' "$B_STARE" "alocarea urmatoare nu refoloseste numarul documentului anulat (1)"
  fi
fi

# ── C4b ──
if ruleaza C4b_anexa; then
  SCEN=C4b; d4a="$(DOC 'C4b anexa')"
  echo "C4b_anulare_vs_anexa: runda anexei (mutant: $MUTANT)"
  if concurent C4ba "$U_OWNER" "$(sqlAnuleaza "$d4a" "$(k 2411)")" '00000 document|false' "$U_ED" "$(sqlAnexa "$d4a" "$(k 2412)")"; then
    case "$MUTANT" in
      fara_garzi_anexa)
        potriveste '00000 1|false|*' "$B_STARE" "B (OPUS): fara cele trei garzi, anexa se scrie pe documentul anulat"
        astept 1 "$(q "SELECT count(*) FROM public.dcc_anexe WHERE document_id = $d4a")" "anexe pe documentul anulat"
        astept 1 "$(nrev "$d4a" "AND anexa_id IS NOT NULL AND revizie = 0 AND stare_transport = 'rezervata'")" "Rev0 rezervata a anexei";;
      fara_stare_dupa_lock)
        astept 'P0001 DCC_GARDA_DOCUMENT_ANULAT' "$B_STARE" "B (OPUS): refuzul vine din trigger (plasa), nu din RPC"
        astept 0 "$(q "SELECT count(*) FROM public.dcc_anexe WHERE document_id = $d4a")" "anexe pe documentul anulat"
        astept 1 "$(nrev "$d4a")" "revizii pe document (doar Rev0)";;
      *)
        astept 'P0001 DCC_DOCUMENT_ANULAT' "$B_STARE" "B: documentul e anulat (codul RPC-ului)"
        astept 0 "$(q "SELECT count(*) FROM public.dcc_anexe WHERE document_id = $d4a")" "anexe pe documentul anulat"
        astept 1 "$(nrev "$d4a")" "revizii pe document (doar Rev0)";;
    esac
  fi
fi
if ruleaza C4b_fila; then
  SCEN=C4b; d4f="$(DOC 'C4b file')"
  echo "C4b_anulare_vs_anexa: runda filei (document cu 2 file; mutant: $MUTANT)"
  if concurent C4bf "$U_OWNER" "$(sqlAnuleaza "$d4f" "$(k 2421)")" '00000 document|false' "$U_ED" "$(sqlFila "$d4f" 3 "$(k 2422)")"; then
    if [ "$MUTANT" = fara_stare_dupa_lock ]; then
      astept 'P0001 DCC_GARDA_DOCUMENT_ANULAT' "$B_STARE" "B (OPUS): refuzul vine din trigger (plasa), nu din RPC"
    else
      astept 'P0001 DCC_DOCUMENT_ANULAT' "$B_STARE" "B: documentul e anulat (codul RPC-ului)"
    fi
    astept '2|2' "$(q "SELECT (SELECT count(*) FROM public.dcc_file WHERE document_id = $d4f), (SELECT count(*) FROM public.dcc_revizii WHERE document_id = $d4f)")" "file | revizii (nimic nou)"
  fi
fi

# ── C5 ──
# pasul 4: sesiunea C (postgres, în locul owner-ului: dreptul pe module nu se scrie prin API) revocă și COMITE; observatorul vede revocarea ȘI B încă în Lock
c5_dupa() {   # <ce> <citire care trebuie sa dea 0 inainte / 1 dupa> → verifica B inca in Lock
  local s
  s="$(esteInLock)"
  if [ -z "$s" ]; then ok 1 "observator ($SCEN): dupa revocare B nu mai e in Lock"; return 1; fi
  ok 0 "observator ($SCEN): revocarea comisa e vizibila si B e INCA in Lock ($s)"
}
revoca_C5a() {
  local n
  n="$(psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -tA -c "WITH x AS (DELETE FROM public.user_module_access WHERE profile_id = '$U_ED2' AND module = 'executie_dcc' RETURNING 1) SELECT count(*) FROM x")"
  ok $? "C: DELETE executie_dcc al lui EB (ED2), COMIS"; astept 1 "$n" "randuri sterse"
  astept 0 "$(q "SELECT count(*) FROM public.user_module_access WHERE profile_id = '$U_ED2' AND module = 'executie_dcc'")" "observator: o citire noua vede retragerea" || return 1
  c5_dupa
}
restrange_C5b() {
  local n
  n="$(psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -tA -c "WITH x AS (INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES ('$U_ED3', 2, 'editor') RETURNING 1) SELECT count(*) FROM x")"
  ok $? "C: restrange EB (ED3) pe proiectul Executie 2 (executie_acces_proiect), COMIS"; astept 1 "$n" "randuri inserate"
  astept 1 "$(q "SELECT count(*) FROM public.executie_acces_proiect WHERE profile_id = '$U_ED3'")" "observator: o citire noua vede restrangerea" || return 1
  c5_dupa
}
c5() {   # <varianta a|b> <contract> <EB> <pas>
  SCEN="C5$1"
  echo "C5_drept_retras_in_asteptare, varianta C5$1 (BEN/$2; mutant: $MUTANT)"
  local p; p="$(P "$2" 1)"
  if concurent "C5$1" "$U_ED" "$(sqlAloca "$p" TM1 COR "C5$1 A" NULL "$(k $((2500 + $2)))")" '00000 1|false|*' "$3" "$(sqlAloca "$p" TM1 COR "C5$1 B" NULL "$(k $((2600 + $2)))")" COMMIT "$4"; then
    if [ "$MUTANT" = fara_reverificare ]; then
      potriveste '00000 2|false|*' "$B_STARE" "B (OPUS): fara reverificare dupa lock, B scrie al doilea document"
      astept 2 "$(ndoc "$2")" "dcc_documente pe BEN/$2"
    else
      astept '42501 DCC_FARA_DREPT' "$B_STARE" "B: reverificarea dupa lock vede revocarea"
      astept 1 "$(ndoc "$2")" "dcc_documente pe BEN/$2 (doar al lui A)"
      astept 0 "$(nint "$(k $((2600 + $2)))")" "niciun rand dcc_intentii pentru cheia lui B"
    fi
  fi
}
ruleaza C5a && c5 a 36 "$U_ED2" revoca_C5a
ruleaza C5b && c5 b 37 "$U_ED3" restrange_C5b

# ── C6 ──
if ruleaza C6; then
  SCEN=C6
  echo "C6_initializari_suprapuse: BEN/38, A: SR1 100-199 pe P1 (GA), B: SR2 150-249 pe P2 (GB), aceeasi cheie (mutant: $MUTANT, observator: $(modObservator C6))"
  if concurent C6 "$U_OWNER" "$(sqlInit "$(P 38 1)" SR1 99 "$(k 2701)")" '00000 SR1|false' "$U_ADM" "$(sqlInit "$(P 38 2)" SR2 149 "$(k 2702)")"; then
    sup="SELECT count(*) FROM public.dcc_serii a JOIN public.dcc_serii b ON a.id < b.id AND a.contract_id = b.contract_id AND a.emitent = b.emitent AND a.tematica IS NOT DISTINCT FROM b.tematica AND a.tip = b.tip AND a.limita_inf <= b.limita_sup AND b.limita_inf <= a.limita_sup JOIN public.dcc_contracte c ON c.id = a.contract_id WHERE c.cod_contract = '38'"
    nser="SELECT count(*) FROM public.dcc_serii s JOIN public.dcc_contracte c ON c.id = s.contract_id WHERE c.cod_contract = '38'"
    if [ "$MUTANT" = advisory_cu_interval ]; then
      astept '00000 SR2|false' "$B_STARE" "B (OPUS): cheia advisory cu interval nu serializeaza, B nu vede seria necomisa a lui A"
      astept 2 "$(q "$nser")" "serii pe BEN/38"; astept 1 "$(q "$sup")" "perechi de serii suprapuse pe aceeasi cheie"
    else
      astept '23P01 DCC_INTERVALE_SUPRAPUSE' "$B_STARE" "B: codul RPC-ului (recitire dupa lock)"
      astept 1 "$(q "$nser")" "serii pe BEN/38"; astept 0 "$(q "$sup")" "perechi de serii suprapuse"
    fi
  fi
fi

# ── C6b ──
if ruleaza C6b; then
  SCEN=C6b; c39="$(C 39)"; g3="$(G G3)"; ga="$(G GA)"
  echo "C6b_ghid_vs_initializare: BEN/39, A: SR1 100-199 pe P1 (GA), B: P2 -> G3 (SR1 100-150) (mutant: $MUTANT, observator: $(modObservator C6b))"
  if concurent C6b "$U_OWNER" "$(sqlInit "$(P 39 1)" SR1 99 "$(k 2711)")" '00000 SR1|false' "$U_OWNER" "$(sqlSeteaza 2 "$c39" "$g3" 1 "$(k 2712)")"; then
    p2="SELECT ghid_id || '|' || versiune FROM public.dcc_proiecte WHERE contract_id = $c39 AND executie_proiect_id = 2"
    if [ "$MUTANT" = fara_advisory_contract ]; then
      astept '00000 2|false|false' "$B_STARE" "B (OPUS): fara advisory pe contract, P2 trece pe G3"
      astept "$g3|2" "$(q "$p2")" "P2: ghidul G3, versiunea 2"
      astept SR1 "$(q "SELECT coalesce(public.fn_dcc_ghid_compatibil_intern($c39, $g3), 'compatibil')")" "dupa COMMIT-ul lui A: G3 incompatibil cu seria contractului"
    else
      astept 'P0001 DCC_GHID_INCOMPATIBIL' "$B_STARE" "B: ghidul G3 incompatibil cu seria comisa de A"
      astept "$ga|1" "$(q "$p2")" "P2 neschimbat (ghidul GA, versiunea 1)"
    fi
  fi
fi

# ── C7 ──
retrage_owner_C7() {
  local n
  n="$(psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -tA -c "WITH x AS (UPDATE public.profiles SET is_owner = false WHERE id = '$U_OWNER2' AND is_owner RETURNING 1) SELECT count(*) FROM x")"
  ok $? "C: is_owner = false pentru OWNER2, COMIS"; astept 1 "$n" "randuri schimbate"
  astept f "$(q "SELECT is_owner FROM public.profiles WHERE id = '$U_OWNER2'")" "observator: o citire noua vede retragerea" || return 1
  c5_dupa
}
if ruleaza C7; then
  SCEN=C7; c40="$(C 40)"; gl1="$(G GL1)"
  echo "C7_owner_retras_la_configurare: BEN/40, A (OWNER) actualizeaza proiectul pe Executie 2, B (OWNER2) pe Executie 1 (mutant: $MUTANT)"
  if concurent C7 "$U_OWNER" "$(sqlSeteaza 2 "$c40" "$gl1" 1 "$(k 2801)")" '00000 2|false|false' "$U_OWNER2" "$(sqlSeteaza 1 "$c40" "$gl1" 1 "$(k 2802)")" COMMIT retrage_owner_C7; then
    p1v="SELECT versiune FROM public.dcc_proiecte WHERE contract_id = $c40 AND executie_proiect_id = 1"
    if [ "$MUTANT" = fara_reverificare_config ]; then
      astept '00000 2|false|false' "$B_STARE" "B (OPUS): fara reverificare dupa lock-uri, fostul proprietar actualizeaza proiectul"
      astept 2 "$(q "$p1v")" "proiectul pe Executie 1: versiunea 2"
    else
      astept '42501 DCC_FARA_DREPT' "$B_STARE" "B: reverificarea dupa lock-uri vede retragerea calitatii de proprietar"
      astept 1 "$(q "$p1v")" "proiectul pe Executie 1 neschimbat (versiunea 1)"
      astept 0 "$(nint "$(k 2802)")" "niciun rand dcc_intentii pentru cheia lui B"
    fi
  fi
fi

# ── C8 ──
c8() {   # <runda> <titlul documentului> <tabel numarat> <sql B (postgres, direct)> <numar asteptat cu fix>
  SCEN=C8; local d; d="$(DOC "$2")"
  echo "C8_anulare_vs_scriere_directa: runda $1 (mutant: $MUTANT)"
  local sqlB="${4//@D@/$d}" n="SELECT count(*) FROM public.$3 WHERE document_id = $d"
  if concurent "C8$1" "$U_OWNER" "$(sqlAnuleaza "$d" "$(k $((2900 + ${#1})))")" '00000 document|false' postgres "$sqlB"; then
    if [ "$MUTANT" = garzi_fara_lock ]; then
      potriveste '00000 *' "$B_STARE" "B (OPUS): garda citeste starea fara lock, cheia straina asteapta randul dar nu reverifica starea"
      astept $(($5 + 1)) "$(q "$n")" "$3 pe documentul anulat (randul nou a intrat)"
    else
      astept 'P0001 DCC_GARDA_DOCUMENT_ANULAT' "$B_STARE" "B: garda asteapta anularea si refuza"
      astept "$5" "$(q "$n")" "$3 pe document (nimic nou)"
    fi
    astept anulat "$(q "SELECT stare FROM public.dcc_documente WHERE id = $d")" "documentul e anulat"
  fi
}
ruleaza C8_anexa && c8 anexa 'C8 anexa' dcc_anexe "WITH x AS (INSERT INTO public.dcc_anexe (document_id, numar, titlu) VALUES (@D@, 1, 'Anexa directa') RETURNING id) SELECT id::text AS r FROM x" 0
ruleaza C8_fila && c8 fila 'C8 file' dcc_file "WITH x AS (INSERT INTO public.dcc_file (document_id, fila) VALUES (@D@, 3) RETURNING id) SELECT id::text AS r FROM x" 2
ruleaza C8_revizie && c8 revizie 'C8 revizie' dcc_revizii "WITH x AS (INSERT INTO public.dcc_revizii (contract_id, document_id, revizie, limba, ghid_id, cod_text, nume_fisier_baza, creat_de) SELECT contract_id, document_id, 1, limba, ghid_id, cod_text || '-D', nume_fisier_baza || '-D', creat_de FROM public.dcc_revizii WHERE document_id = @D@ AND revizie = 0 RETURNING id) SELECT id::text AS r FROM x" 1

# ── C9 ──
c9() {   # <runda contract|ghid> <sql A> <tipar A> <numararea obiectului> <eticheta> <cheia A> [<sql B> <cheia B>]
  # fără <sql B>: B = aceeași cheie (C9, așteptarea pe claim); cu <sql B>: B = altă cheie, aceiași parametri (C9b, așteptarea pe indexul unic
  # al obiectului: dcc_contracte_uq / dcc_ghiduri_cod_versiune_uq)
  local v='' sqlB="$2" kB="$6" titlu='aceeasi cheie'
  if [ -n "${7:-}" ]; then v=b; sqlB="$7"; kB="$8"; titlu='alta cheie, acelasi obiect (indexul unic)'; fi
  SCEN="C9${v}_$1"
  q "UPDATE public.profiles SET is_owner = true WHERE id = '$U_OWNER2'" > /dev/null; ok $? "OWNER2 owner din nou (pregatirea $SCEN)"
  astept t "$(q "SELECT is_owner FROM public.profiles WHERE id = '$U_OWNER2'")" "OWNER2 owner inainte de $SCEN"
  echo "C9${v}_owner_retras_in_asteptare: runda $1, $titlu, A ROLLBACK (mutant: $MUTANT)"
  if concurent "$SCEN" "$U_OWNER2" "$2" "$3" "$U_OWNER2" "$sqlB" ROLLBACK retrage_owner_C7; then
    if [ "$MUTANT" = "fara_reverificare_$1" ]; then
      astept "00000 ${3#00000 }" "$B_STARE" "B (OPUS): fara reverificare, fostul owner scrie $5"
      astept 1 "$(q "$4")" "$5"
    else
      astept '42501 DCC_FARA_DREPT' "$B_STARE" "B: reverificarea dupa claim / scrieri vede retragerea"
      astept 0 "$(q "$4")" "$5"
      astept 0 "$(nint "$kB")" "niciun rand dcc_intentii pentru cheia lui B"
    fi
    [ -n "$v" ] && astept 0 "$(nint "$6")" "niciun rand dcc_intentii pentru cheia lui A (ROLLBACK)"
  fi
}
ruleaza C9_contract && c9 contract "$(sqlContract 42 "$(k 2951)")" '00000 42|false' "SELECT count(*) FROM public.dcc_contracte WHERE beneficiar = 'BEN' AND cod_contract = '42'" "contractul BEN/42" "$(k 2951)"
ruleaza C9_ghid && c9 ghid "$(sqlGhid "$(k 2952)")" '00000 GC9|false' "SELECT count(*) FROM public.dcc_ghiduri WHERE cod = 'GC9'" "ghidul GC9" "$(k 2952)"
ruleaza C9b_contract && c9 contract "$(sqlContract 43 "$(k 2953)")" '00000 43|false' "SELECT count(*) FROM public.dcc_contracte WHERE beneficiar = 'BEN' AND cod_contract = '43'" "contractul BEN/43" "$(k 2953)" "$(sqlContract 43 "$(k 2954)")" "$(k 2954)"
ruleaza C9b_ghid && c9 ghid "$(sqlGhid "$(k 2955)" ghid_c9b)" '00000 GC9B|false' "SELECT count(*) FROM public.dcc_ghiduri WHERE cod = 'GC9B'" "ghidul GC9B" "$(k 2955)" "$(sqlGhid "$(k 2956)" ghid_c9b)" "$(k 2956)"

# ── C10 / C11 (runda r6): retragerea comisă cât o SCRIERE așteaptă, DUPĂ reverificarea de după lock → doar reverificarea finală refuză ──
owner2_din_nou() {   # <scenariu>
  q "UPDATE public.profiles SET is_owner = true WHERE id = '$U_OWNER2'" > /dev/null; ok $? "OWNER2 owner din nou (pregatirea $1)"
  astept t "$(q "SELECT is_owner FROM public.profiles WHERE id = '$U_OWNER2'")" "OWNER2 owner inainte de $1"
}
if ruleaza C10; then
  SCEN=C10; c44="$(C 44)"; gl1="$(G GL1)"
  owner2_din_nou C10
  echo "C10_owner_retras_in_asteptarea_cheii_straine: BEN/44, A (postgres) tine executie_proiecte(3) FOR UPDATE, B (OWNER2) creeaza proiectul DCC pe Executie 3 (mutant: $MUTANT)"
  np="SELECT count(*) FROM public.dcc_proiecte WHERE contract_id = $c44 AND executie_proiect_id = 3"
  astept 0 "$(q "$np")" "niciun proiect DCC pe Executie 3 inainte de C10"
  if concurent C10 postgres "SELECT id::text AS r FROM public.executie_proiecte WHERE id = 3 FOR UPDATE" '00000 3' "$U_OWNER2" "$(sqlSeteaza 3 "$c44" "$gl1" NULL "$(k 3001)")" COMMIT retrage_owner_C7; then
    if [ "$MUTANT" = fara_reverificare_finala_proiect ]; then
      astept '00000 1|true|false' "$B_STARE" "B (OPUS): fara reverificarea finala, fostul proprietar creeaza proiectul dupa asteptarea pe cheia straina"
      astept 1 "$(q "$np")" "proiectul DCC pe Executie 3 (BEN/44) creat"
    else
      astept '42501 DCC_FARA_DREPT' "$B_STARE" "B: reverificarea finala vede retragerea comisa cat INSERT-ul astepta cheia straina"
      astept 0 "$(q "$np")" "niciun proiect DCC pe Executie 3 (BEN/44)"
      astept 0 "$(nint "$(k 3001)")" "niciun rand dcc_intentii pentru cheia lui B"
    fi
  fi
fi
if ruleaza C11; then
  SCEN=C11; p45="$(P 45 1)"
  owner2_din_nou C11
  echo "C11_owner_retras_in_asteptarea_importului: BEN/45, A (OWNER2) importa C11-1 cu K1, B (OWNER2) aceeasi identitate cu K2, A ROLLBACK (mutant: $MUTANT)"
  ni="SELECT count(*) FROM public.dcc_istoric_aparitii WHERE proiect_dcc_id = $p45"
  astept 0 "$(q "$ni")" "nicio aparitie istorica pe BEN/45 inainte de C11"
  if concurent C11 "$U_OWNER2" "$(sqlIstoric "$p45" "$(k 3101)")" '00000 1|0|false' "$U_OWNER2" "$(sqlIstoric "$p45" "$(k 3102)")" ROLLBACK retrage_owner_C7; then
    if [ "$MUTANT" = fara_reverificare_finala_istoric ]; then
      astept '00000 1|0|false' "$B_STARE" "B (OPUS): fara reverificarea finala, fostul proprietar scrie aparitia dupa asteptarea pe dcc_istoric_sursa_uq"
      astept 1 "$(q "$ni")" "aparitia C11-1 scrisa pe BEN/45"
    else
      astept '42501 DCC_FARA_DREPT' "$B_STARE" "B: reverificarea finala, dupa bucla de import, vede retragerea comisa cat ON CONFLICT astepta"
      astept 0 "$(q "$ni")" "nicio aparitie istorica pe BEN/45"
      astept 0 "$(nint "$(k 3102)")" "niciun rand dcc_intentii pentru cheia lui B"
    fi
    astept 0 "$(nint "$(k 3101)")" "niciun rand dcc_intentii pentru cheia lui A (ROLLBACK)"
  fi
fi

inchideA; ok $? "sesiunea A inchisa curat"
if [ "$MUTANT" = nu ]; then
  [ "$esec" = 0 ] && echo "TOTUL OK" || echo "ESEC: $esec"
else
  [ "$esec" = 0 ] && echo "MUTANT $MUTANT: PRINS (rezultatul OPUS obtinut)" || echo "MUTANT $MUTANT: NEDISCRIMINANT ($esec abateri)"
fi
