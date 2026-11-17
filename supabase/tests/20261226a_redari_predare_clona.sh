#!/usr/bin/env bash
# Proba pe CLONĂ pentru 20261226a (Redări: declarația „predare” + opțiunea retrasă), runda 3 a review-ului #1119 — DOAR pe CLONĂ, cu migrarea
# NEAPLICATĂ. NETESTAT de autor (serverul de cod nu are acces la nicio bază): îl rulează coordonatorul. Completează PGlite (o singură
# conexiune, schelet) cu: roluri și politici REALE, runnerul real, DOUĂ sesiuni în timpul aplicării, rândurile + jurnalul + revenirea pe date.
# Rulare (Git Bash; parola din pgpass, niciodată pe linia de comandă):
#   PSQL=<calea psql> EDITOR=<uuid profil cu redari = editor pe clonă> \
#   bash supabase/tests/20261226a_redari_predare_clona.sh --sistem <system_identifier clonă> --host <H> --port <P> --user postgres --db postgres \
#     --manifest <manifestul regenerat pe clonă>/20261226a_redari_predare_declaratie.l15.tsv --amprenta-globala <GLOBAL al clonei>
#   (OWNER=<uuid>, implicit 00000000-0000-4000-8000-000000000001: profilul sintetic is_owner al clonei, ca la 20261225a)
# GĂRZI (înainte de orice scriere): system_identifier = --sistem (22); migrarea neaplicată și fără istoric 20261226120000 / 20261226120001 (23);
#   OWNER is_owner și EDITOR cu redari = editor (24); niciun rest al unei rulări anterioare (id-urile sintetice / codurile TEST-PREDARE-SINT-%) (25).
# DATELE: SINTETICE, fără date personale („Persoana Sintetica …”, UAT „Sinteticeni” / ZZQ), comise (sesiunile trebuie să le vadă) și șterse
#   la final (trap), ca postgres, într-o tranzacție, cu triggerele USER ale tabelelor Redări atinse dezactivate DOAR în acea tranzacție (jurnalul
#   e append-only și pentru postgres). Tokenurile deținătorilor sintetici (generate de trigger) stau doar în dosarul temporar al scriptului.
#   Istoricul schema_migrations al celor două versiuni (aplicarea + revenirea scriptului) se șterge la final, ca în probele coordonatorului.
#   Contorul red_rate_limit 'ip:necunoscut' (comun, expiră singur) NU se șterge; cheile 't:…' ale tokenurilor sintetice da.
# PAȘII și REZULTATELE AȘTEPTATE (fiecare verificare tipărește OK / NU; codurile de ieșire ale sesiunilor se păstrează, wait PID — L25):
#   S0 pregătirea (postgres, fără JWT, comis): P1, P2 cu DEFAULT-ul (VECHI); PA creat cu VECHI și schimbat ÎNAINTE de migrare VECHI -> NOU
#      fără JWT (contraexemplul a); PC cu text personalizat; UAT + parcelă + 3 deținători pe P1; un răspuns ISTORIC cu opțiunea retrasă (D2).
#   S1–S3 (runda 3) aplicarea A prin runner cu DOUĂ sesiuni concurente, bariere de ELIBERARE explicite și un OBSERVATOR. Dovezile vin DIN
#      BAZĂ (pg_stat_activity, pg_locks, pg_blocking_pids, istoricul migrării, clock_timestamp() al serverului); niciun ceas local, nicio
#      pauză folosită ca dovadă (pauzele de 1-10 ms din bucle doar ritmează sondarea; fiecare buclă are o limită care pică VIZIBIL).
#      Sesiunile: B = proba_predare_b, C = proba_predare_c, runnerul = proba_predare_a (PGAPPNAME), observatorul = proba_predare_obs,
#      eliberarea = proba_predare_elib, interogările scriptului = proba_predare_ctl. Runnerul primește numele prin PGAPPNAME (nu e în
#      lista variabilelor pe care le respinge); sesiunile probei îl pun și cu SET. Conexiunea la clonă trebuie să păstreze
#      application_name (directă sau pooler în mod sesiune); altfel așteptarea lui C / observatorul nu găsesc runnerul și pică VIZIBIL.
#   S1 sesiunea B (anon, ca PostgREST): BEGIN; fn_red_raspuns_public(D1, 'nu_particip_cu_obiectii') → {ok: true} (regula VECHE: RPC-ul
#      rulează înainte de migrare); RESET ROLE; apoi B ȚINE tranzacția deschisă și AȘTEAPTĂ ELIBERAREA: o sesiune proba_predare_elib, pornită
#      de script DOAR după ce runnerul a ieșit și istoricul lui A e vizibil (A comisă). Limita lui B: 300 s → eroare, B iese ≠ 0 (NU).
#      Ultima instrucțiune a lui B înaintea COMMIT-ului: „B_VEDE_A_COMISA t” (rândul de istoric al lui A vizibil din tranzacția încă deschisă
#      a lui B = A a comis ÎNAINTEA lui B; ordinea e dovedită, nu presupusă); după COMMIT: „B_COMIS”.
#      LOCK-URILE LUI B (ipoteza, citită din cod; verificată la barieră din pg_locks și tipărită): RPC-ul și triggerele lui NU ating
#      red_proiecte. Citește red_detinatori_token / red_detinatori / red_parcele / red_uat (ACCESS SHARE); scrie red_rate_limit (contorul IP
#      'ip:necunoscut' + cheia tokenului), red_raspunsuri, red_raspunsuri_meta, red_jurnal (ROW EXCLUSIVE); cheile străine iau ROW SHARE pe
#      red_detinatori / red_raspunsuri. Triggerele: fn_red_legaturi (ramura red_raspunsuri / _meta citește doar red_detinatori /
#      red_raspunsuri — 20261129g), fn_red_raspunsuri_valideaza (deținător → parcelă → UAT — 20261126a), fn_red_jurnal (INSERT în
#      red_jurnal — 20261130j), cel de mail doar pe canalul email (20261130k). ACCESS EXCLUSIVE pe red_proiecte intră în conflict doar cu
#      lock-uri pe red_proiecte; INSERT-ul migrării în red_jurnal (ROW EXCLUSIVE) e compatibil cu ROW EXCLUSIVE al lui B; CREATE OR REPLACE
#      FUNCTION nu ia lock pe tabele → aplicarea trebuie să ia lock-ul la PRIMA încercare CU B DESCHIS. Dacă B ține ceva pe red_proiecte, un
#      mod mai tare decât ROW EXCLUSIVE sau un lock neacordat: NU („ipoteza infirmată”); proba continuă ca să arate rezultatul real (runnerul
#      ar pica atunci cu BUGET_LOCK, nimic schimbat).
#      Așteptat: la barieră B ține ROW EXCLUSIVE pe red_raspunsuri, nimic pe red_proiecte, nimic peste ROW EXCLUSIVE (lista tipărită);
#      B = ACEEAȘI tranzacție (pid | xact_start | backend_xid | stare, identice) (1) la barieră, înainte de pornirea runnerului, (2) la primul
#      eșantion al observatorului în care A ține ACCESS EXCLUSIVE pe red_proiecte și (3) după ieșirea runnerului, când istoricul lui A e deja
#      vizibil → B a fost deschisă pe toată durata aplicării, inclusiv la obținerea lock-ului și la COMMIT-ul lui A; eliberarea cod 0;
#      B cod 0, „B_RPC {"ok": true”, „B_VEDE_A_COMISA t”, „B_COMIS”; răspunsul lui B există (1 rând cu opțiunea veche, comis DUPĂ A).
#   S2 sesiunea C (anon): BEGIN; o buclă (ca postgres, marcaj C_ASTEAPTA_LOCK) așteaptă ACCESS EXCLUSIVE pe red_proiecte ACORDAT unei sesiuni
#      cu application_name proba_predare_a (runnerul → PID-ul lui, reținut); în ACEEAȘI instrucțiune trece pe rolul anon (claims anon);
#      instrucțiunea IMEDIAT următoare = citirea formularului (fn_red_formular_public, D3), nimic între ele. Prima citire din red_proiecte a
#      funcției (contactul) așteaptă COMMIT-ul lui A; declarația e citită de o instrucțiune ULTERIOARĂ (plpgsql VOLATILE, READ COMMITTED:
#      instantaneu nou pe instrucțiune) → C primește declarația NOUĂ. Apoi C mai așteaptă și după B (contorul 'ip:necunoscut' din
#      red_rate_limit, actualizat de B și ținut până la eliberare) — informativ, nu e verificare.
#      OBSERVATORUL (postgres, o singură sesiune, sondare la ~1 ms, pornit înaintea runnerului): la fiecare eșantion citește starea lui C,
#      PID-ul care ține ACCESS EXCLUSIVE pe red_proiecte cu application_name proba_predare_a și pg_blocking_pids(C); numără eșantioanele în
#      care C are wait_event_type = 'Lock', pg_blocking_pids(C) conține PID-ul lui A și instrucțiunea lui C e citirea formularului; durata =
#      de la primul la ultimul astfel de eșantion (ceasul serverului; limită inferioară a așteptării).
#      Așteptat: C cod 0; „C_VAZUT_A <pid>” = PID-ul lui A din observator; „C_FORMULAR NOU”; observatorul cod 0 și ≥ 1 eșantion „C blocat de
#      A în citirea formularului”. 0 eșantioane = „NU - nedovedit” (lock-ul e ținut ~350 ms pe clonă: se RERULEAZĂ, nu se declară trecut;
#      runnerul și migrarea nu se schimbă ca să lungească fereastra). Durata așteptării pe lock-ul lui A se tipărește separat.
#   S3 aplicarea A prin RUNNER (livrare_migrare.sh, plafon 5000, amprenta globală + manifestul), cât B ține tranzacția deschisă și C așteaptă:
#      cod 0; „20261226a: lock la … (1 incercari, …)”; „declaratia: 2 proiecte schimbate (… -1 v2; … -2 v2), 1 cu text personalizat
#      neatinse; marcajul executiei …: livrare:20261226a_redari_predare_declaratie:<txid>” (doar P1 și P2: PA are deja textul nou);
#      APLICAT + ÎNREGISTRAT.
#   S4 după aplicare (doar citire + scrieri pe rolurile reale, comise ca la PostgREST):
#      rândurile: P1 / P2 = NOU, versiunea 2; PA = NOU, versiunea 2 (neatins de migrare); PC = text personalizat, versiunea 1; DEFAULT = NOU;
#      jurnalul: exact 2 rânduri cu marcajul execuției (P1, P2), user_id NULL, același marcaj; niciunul pe PA / PC;
#      anon prin RPC: opțiunea retrasă → {ok:false, motiv:'optiune_invalida'}, nimic scris; o opțiune necunoscută → același răspuns;
#        constatare_teren cu text → {ok:true};
#      authenticated EDITOR: INSERT cu opțiunea retrasă → 23514; INSERT constatare_teren → OK; UPDATE pe răspunsul istoric (obiecțiile) → OK,
#        opțiunea rămâne nu_particip_cu_obiectii; UPDATE al răspunsului constatare CĂTRE opțiunea retrasă → 23514;
#      authenticated OWNER: INSERT cu opțiunea retrasă → 23514; service_role: INSERT cu opțiunea retrasă (canal email) → 23514;
#      anon / authenticated: SELECT fn_red_optiune_retrasa(...) → 42501.
#   S5 contraexemplul (b) + salvarea unui om: PB creat DUPĂ aplicare cu VECHI explicit și schimbat apoi fără JWT la NOU (postgres); OWNER
#      redenumește P2 (versiunea 3).
#   S6 revenirea prin RUNNER (plafon 2000, fără amprentă globală): cod 0; „revenire: executia livrare:20261226a_redari_predare_declaratie:<txid>:
#      1 proiecte readuse la declaratia veche (… -1 v3); 1 proiecte ale executiei salvate intre timp, neatinse; N proiecte raman cu textul nou”;
#      P1 = VECHI (rândul lui de jurnal poartă marcajul revenirii …_ROLLBACK:<txid>); P2 (salvat de om), PA (contraexemplul a), PB
#      (contraexemplul b) = NOU, neatinse; PC neschimbat; DEFAULT = VECHI; fn_red_optiune_retrasa absentă.
#   S7 curățenia (trap, și la eroare), runda 3: sesiunile probei oprite; o tranzacție care șterge datele sintetice, jurnalul lor, cheile de
#      token și istoricul celor două versiuni, reactivează triggerele și VERIFICĂ înainte de COMMIT că nu a rămas nimic (altfel ROLLBACK);
#      după COMMIT, a doua verificare din altă sesiune: 0 rânduri sintetice, 0 rânduri de istoric 20261226120000 / 20261226120001, 0 sesiuni
#      ale probei. Abia apoi „PASS” (tipărit DOAR de curățenie, după verificare) și ștergerea dosarului temporar.
#      Curățenia picată = cod 26, mesaj, dosarul temporar PĂSTRAT (jurnalele sesiunilor; conține tokenurile deținătorilor SINTETICI).
#      Migrarea rămasă aplicată (revenirea n-a reușit) = datele sintetice și dosarul rămân pentru analiză, cod ≠ 0 (cel puțin 1).
# Ieșire: 0 = toate OK și curățenia verificată; 1 = o verificare a picat (sau o barieră a expirat); 2 = argumente; 22 = altă țintă;
#   23 = migrarea aplicată / istoric existent; 24 = owner / editor lipsă; 25 = resturi ale unei rulări anterioare; 26 = curățenia a picat
#   sau n-a putut fi verificată (prioritar față de 0 / 1: rezultatele de mai sus rămân în jurnal).
set -euo pipefail
PSQL="${PSQL:-psql}"
export PGCLIENTENCODING=UTF8
SISTEM="" H="" P="" U="" D="" MAN="" AG=""
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || { echo "optiunea $1 fara valoare" >&2; exit 2; }
  case "$1" in
    --sistem) SISTEM="$2" ;; --host) H="$2" ;; --port) P="$2" ;; --user) U="$2" ;; --db) D="$2" ;;
    --manifest) MAN="$2" ;; --amprenta-globala) AG="$2" ;;
    *) echo "argument necunoscut: $1" >&2; exit 2 ;;
  esac
  shift 2
done
[[ "$SISTEM" =~ ^[0-9]+$ ]] || { echo "lipseste --sistem <system_identifier al clonei>" >&2; exit 2; }
[ -n "$H" ] && [ -n "$P" ] && [ -n "$U" ] && [ -n "$D" ] || { echo "lipsesc --host / --port / --user / --db" >&2; exit 2; }
[ -f "$MAN" ] || { echo "lipseste --manifest <fisier .l15.tsv regenerat pe clona>" >&2; exit 2; }
[[ "$AG" =~ ^[0-9a-f]{32}$ ]] || { echo "lipseste --amprenta-globala <md5 al clonei>" >&2; exit 2; }
OWNER="${OWNER:-00000000-0000-4000-8000-000000000001}"
EDITOR="${EDITOR:-}"
[[ "$OWNER" =~ ^[0-9a-f-]{36}$ ]] || { echo "OWNER invalid" >&2; exit 2; }
[[ "$EDITOR" =~ ^[0-9a-f-]{36}$ ]] || { echo "EDITOR=<uuid> lipsa (profil sintetic cu redari = editor pe clona)" >&2; exit 2; }
MAN="$(cd "$(dirname "$MAN")" && pwd)/$(basename "$MAN")"
cd "$(dirname "$0")/../.."
MIG=supabase/migrations/20261226a_redari_predare_declaratie.sql
REV=supabase/revenire/20261226a_redari_predare_declaratie_ROLLBACK.sql
NUME_MIG=20261226a_redari_predare_declaratie; NUME_REV=20261226a_redari_predare_declaratie_ROLLBACK
VERS_MIG=20261226120000; VERS_REV=20261226120001
SHA_MIG="$(sha256sum "$MIG" | cut -d' ' -f1)"; SHA_REV="$(sha256sum "$REV" | cut -d' ' -f1)"
VECHI='Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, prin poștă / electronic.'
NOU='Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.'
CONN=(-h "$H" -p "$P" -U "$U" -d "$D")
TMP="$(mktemp -d ./.clona_20261226a.XXXXXX)"
APP_A=proba_predare_a; APP_B=proba_predare_b; APP_C=proba_predare_c; APP_OBS=proba_predare_obs; APP_ELIB=proba_predare_elib
APP_CTL=proba_predare_ctl
APPS="'$APP_A', '$APP_B', '$APP_C', '$APP_OBS', '$APP_ELIB', '$APP_CTL'"
# id-urile sintetice (fixe; garda 25 cere să nu existe)
PR1=5e5e0000-0000-4000-8000-000000000001; PR2=5e5e0000-0000-4000-8000-000000000002; PRA=5e5e0000-0000-4000-8000-00000000000a
PRB=5e5e0000-0000-4000-8000-00000000000b; PRC=5e5e0000-0000-4000-8000-00000000000c
UAT=5e5e0000-0000-4000-8000-000000000101; PARC=5e5e0000-0000-4000-8000-000000000201
D1=5e5e0000-0000-4000-8000-000000000301; D2=5e5e0000-0000-4000-8000-000000000302; D3=5e5e0000-0000-4000-8000-000000000303
R_OLD=5e5e0000-0000-4000-8000-000000000401
IDS="'$PR1','$PR2','$PRA','$PRB','$PRC','$UAT','$PARC','$D1','$D2','$D3','$R_OLD'"
PIDS=(); TINTA_OK=0; APLICAT=0; REVENIT=0; ESEC=0
# SQL-ul pleacă pe stdin, nu ca argument (-c): pe Windows (Git Bash -> psql.exe) argumentele cu diacritice sunt trecute prin pagina de cod a
# sistemului și ajung alterate, deci comparațiile cu textele VECHI / NOU dădeau „ALT” deși rândurile erau corecte (prima rulare pe clonă).
# Sesiunile scriptului au application_name propriu (PGAPPNAME), ca barierele / curățenia să nu depindă de mediul în care rulează.
q() { printf '%s\n' "$1" | PGAPPNAME="$APP_CTL" "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -f -; }
qf() { PGAPPNAME="$APP_CTL" "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$1"; }
# o sesiune în fundal: $1 = application_name, $2 = fișierul SQL, $3 = jurnalul; PID-ul procesului în PIDS (wait la final, L25)
fundal() { PGAPPNAME="$1" "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$2" >"$3" 2>&1 & PIDS+=("$!"); ULTIM_PID=$!; }
# jurnalul unei sesiuni fără CR (psql.exe pe Windows poate scrie CRLF în fișiere); prima linie „ETICHETA valoare” → valoarea (gol dacă lipsește)
jurnal() { tr -d '\r' < "$1" 2>/dev/null || true; }
linie() { local l; l="$(jurnal "$2" | grep -m 1 -- "^$1 " || true)"; printf '%s' "${l#"$1 "}"; }
ok() { if [ "$1" = "$2" ]; then echo "  OK  $3"; else echo "  NU  $3: obtinut [$1], asteptat [$2]"; ESEC=1; fi; }
# (here-string, nu pipe: cu pipefail, grep -q care iese la prima potrivire ar putea da SIGPIPE scriitorului = NU fals)
okre() { if grep -Eq -- "$2" <<<"$1"; then echo "  OK  $3"; else echo "  NU  $3: [$(printf '%s' "$1" | head -c 400)] nu se potriveste cu /$2/"; ESEC=1; fi; }
gata_pid() { local p r=(); for p in "${PIDS[@]+"${PIDS[@]}"}"; do [ "$p" = "$1" ] || r+=("$p"); done; PIDS=("${r[@]+"${r[@]}"}"); }
curatenie() {
  local rc=$? p v
  for p in "${PIDS[@]+"${PIDS[@]}"}"; do kill "$p" 2>/dev/null || true; done
  if [ "$TINTA_OK" != 1 ]; then
    # gărzile au refuzat înaintea oricărei scrieri: nimic de curățat pe clonă
    rm -rf "$TMP"
    [ "$rc" = 0 ] || echo "ESEC: proba pe clona 20261226a (cod $rc)" >&2
    exit "$rc"
  fi
  q "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE application_name IN ($APPS) AND pid <> pg_backend_pid()" >/dev/null 2>&1 || true
  for p in "${PIDS[@]+"${PIDS[@]}"}"; do wait "$p" 2>/dev/null || true; done
  if [ "$APLICAT" = 1 ] && [ "$REVENIT" = 0 ]; then
    echo "ATENTIE: migrarea a ramas APLICATA pe clona (revenirea n-a reusit): datele sintetice raman pentru analiza; revenirea + curatenia manual" >&2
    echo "ATENTIE: dosarul temporar al probei a ramas pentru diagnostic: $TMP" >&2
    [ "$rc" != 0 ] || rc=1
    echo "ESEC: proba pe clona 20261226a (cod $rc)" >&2
    exit "$rc"
  fi
  cat >"$TMP/curata.sql" <<SQL
\\set ON_ERROR_STOP 1
BEGIN;
ALTER TABLE public.red_jurnal DISABLE TRIGGER USER; ALTER TABLE public.red_raspunsuri_meta DISABLE TRIGGER USER;
ALTER TABLE public.red_raspunsuri DISABLE TRIGGER USER; ALTER TABLE public.red_detinatori_token DISABLE TRIGGER USER;
ALTER TABLE public.red_detinatori DISABLE TRIGGER USER; ALTER TABLE public.red_parcele DISABLE TRIGGER USER;
ALTER TABLE public.red_uat DISABLE TRIGGER USER; ALTER TABLE public.red_proiecte DISABLE TRIGGER USER;
CREATE TEMP TABLE z_rasp ON COMMIT DROP AS SELECT id FROM public.red_raspunsuri WHERE detinator_id IN ('$D1', '$D2', '$D3');
DELETE FROM public.red_rate_limit WHERE cheie IN (SELECT 't:' || encode(sha256(convert_to(t.token_raspuns, 'UTF8')), 'hex') FROM public.red_detinatori_token t
                                                   WHERE t.detinator_id IN ('$D1', '$D2', '$D3'));
DELETE FROM public.red_jurnal WHERE inregistrare_id IN ($IDS) OR inregistrare_id IN (SELECT id FROM z_rasp);
DELETE FROM public.red_raspunsuri_meta WHERE raspuns_id IN (SELECT id FROM z_rasp);
DELETE FROM public.red_raspunsuri WHERE id IN (SELECT id FROM z_rasp);
DELETE FROM public.red_detinatori_token WHERE detinator_id IN ('$D1', '$D2', '$D3');
DELETE FROM public.red_detinatori WHERE id IN ('$D1', '$D2', '$D3');
DELETE FROM public.red_parcele WHERE id = '$PARC';
DELETE FROM public.red_uat WHERE id = '$UAT';
DELETE FROM public.red_proiecte WHERE id IN ('$PR1', '$PR2', '$PRA', '$PRB', '$PRC');
ALTER TABLE public.red_proiecte ENABLE TRIGGER USER; ALTER TABLE public.red_uat ENABLE TRIGGER USER;
ALTER TABLE public.red_parcele ENABLE TRIGGER USER; ALTER TABLE public.red_detinatori ENABLE TRIGGER USER;
ALTER TABLE public.red_detinatori_token ENABLE TRIGGER USER; ALTER TABLE public.red_raspunsuri ENABLE TRIGGER USER;
ALTER TABLE public.red_raspunsuri_meta ENABLE TRIGGER USER; ALTER TABLE public.red_jurnal ENABLE TRIGGER USER;
-- garda 23 a cerut ca nici versiunile, nici numele să nu existe înainte: tot ce găsim acum e al acestei rulări
DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('$VERS_MIG', '$VERS_REV') OR name IN ('$NUME_MIG', '$NUME_REV');
-- verificarea ÎNAINTE de COMMIT: nimic sintetic rămas, triggerele USER reactivate; altfel ROLLBACK (nimic șters, datele rămân pentru analiză)
DO \$v\$ BEGIN
  IF EXISTS (SELECT 1 FROM public.red_raspunsuri_meta WHERE raspuns_id IN (SELECT id FROM z_rasp))
     OR EXISTS (SELECT 1 FROM public.red_raspunsuri WHERE id IN (SELECT id FROM z_rasp) OR detinator_id IN ('$D1', '$D2', '$D3'))
     OR EXISTS (SELECT 1 FROM public.red_jurnal WHERE inregistrare_id IN ($IDS) OR inregistrare_id IN (SELECT id FROM z_rasp))
     OR EXISTS (SELECT 1 FROM public.red_detinatori_token WHERE detinator_id IN ('$D1', '$D2', '$D3'))
     OR EXISTS (SELECT 1 FROM public.red_detinatori WHERE id IN ($IDS))
     OR EXISTS (SELECT 1 FROM public.red_parcele WHERE id IN ($IDS)) OR EXISTS (SELECT 1 FROM public.red_uat WHERE id IN ($IDS))
     OR EXISTS (SELECT 1 FROM public.red_proiecte WHERE id IN ($IDS) OR cod LIKE 'TEST-PREDARE-SINT-%')
     OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN ('$VERS_MIG', '$VERS_REV') OR name IN ('$NUME_MIG', '$NUME_REV')) THEN
    RAISE EXCEPTION 'curatenie: au ramas randuri sintetice / istoric dupa stergere';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled = 'D'
              AND t.tgrelid IN ('public.red_jurnal'::regclass, 'public.red_raspunsuri_meta'::regclass, 'public.red_raspunsuri'::regclass,
                                'public.red_detinatori_token'::regclass, 'public.red_detinatori'::regclass, 'public.red_parcele'::regclass,
                                'public.red_uat'::regclass, 'public.red_proiecte'::regclass)) THEN
    RAISE EXCEPTION 'curatenie: un trigger USER a ramas dezactivat';
  END IF;
END \$v\$;
COMMIT;
SQL
  local ok_cur=0
  if qf "$TMP/curata.sql" >"$TMP/curata.log" 2>&1; then
    # a doua verificare, după COMMIT, din altă sesiune: rândurile, istoricul, sesiunile probei (așteptat 0|0|0|0|0|0|0|0 și 0)
    v="$(q "SELECT (SELECT count(*) FROM public.red_proiecte WHERE id IN ($IDS) OR cod LIKE 'TEST-PREDARE-SINT-%') || '|' ||
                   (SELECT count(*) FROM public.red_uat WHERE id IN ($IDS)) || '|' || (SELECT count(*) FROM public.red_parcele WHERE id IN ($IDS)) || '|' ||
                   (SELECT count(*) FROM public.red_detinatori WHERE id IN ($IDS)) || '|' ||
                   (SELECT count(*) FROM public.red_detinatori_token WHERE detinator_id IN ('$D1', '$D2', '$D3')) || '|' ||
                   (SELECT count(*) FROM public.red_raspunsuri WHERE detinator_id IN ('$D1', '$D2', '$D3')) || '|' ||
                   (SELECT count(*) FROM public.red_jurnal WHERE inregistrare_id IN ($IDS)) || '|' ||
                   (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('$VERS_MIG', '$VERS_REV') OR name IN ('$NUME_MIG', '$NUME_REV'))")" || v="eroare"
    # sesiunile probei: terminate mai sus; serverul le scoate în câteva momente (cel mult 10 s, apoi se numără)
    p="$(q "DO \$s\$ DECLARE t0 timestamptz := clock_timestamp(); BEGIN
              LOOP PERFORM pg_stat_clear_snapshot();
                EXIT WHEN NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name IN ($APPS) AND pid <> pg_backend_pid())
                       OR clock_timestamp() > t0 + interval '10 seconds';
                PERFORM pg_sleep(0.05); END LOOP; END \$s\$;
            SELECT count(*) FROM pg_stat_activity WHERE application_name IN ($APPS) AND pid <> pg_backend_pid();")" || p="eroare"
    if [ "$v" = "0|0|0|0|0|0|0|0" ] && [ "$p" = 0 ]; then
      ok_cur=1
      echo "curatenie: datele sintetice, jurnalul lor si istoricul $VERS_MIG / $VERS_REV sterse; verificat dupa COMMIT (0 randuri, 0 sesiuni ale probei)"
    else
      echo "ATENTIE: curatenia nu s-a verificat: randuri/istoric ramase [$v] (asteptat 0|0|0|0|0|0|0|0), sesiuni ale probei [$p] (asteptat 0)" >&2
    fi
  else
    echo "ATENTIE: tranzactia de curatenie a picat (ROLLBACK: nimic sters):" >&2
    sed 's/^/     curata| /' "$TMP/curata.log" >&2
  fi
  if [ "$ok_cur" != 1 ]; then
    echo "ATENTIE: de curatat manual pe clona id-urile 5e5e0000-…, codurile TEST-PREDARE-SINT-% si istoricul $VERS_MIG / $VERS_REV" >&2
    echo "ATENTIE: dosarul temporar al probei a ramas pentru diagnostic: $TMP (jurnalele sesiunilor; tokenurile detinatorilor SINTETICI)" >&2
    echo "ESEC: curatenia probei a picat (cod 26; verificarile de mai sus raman valabile asa cum au fost tiparite)" >&2
    exit 26
  fi
  rm -rf "$TMP"
  if [ "$rc" = 0 ]; then echo "PASS: proba pe clona 20261226a (toate verificarile OK, curatenia verificata)"
  else echo "ESEC: proba pe clona 20261226a (cod $rc; vezi NU mai sus)" >&2; fi
  exit "$rc"
}
trap curatenie EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ── gărzile ──
REAL="$(q "SELECT system_identifier FROM pg_control_system()")"
[ "$REAL" = "$SISTEM" ] || { echo "REFUZ: system_identifier al bazei ($REAL) <> --sistem ($SISTEM)" >&2; exit 22; }
[ "$(q "SELECT to_regprocedure('public.fn_red_optiune_retrasa(text)') IS NULL
          AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN ('$VERS_MIG', '$VERS_REV') OR name IN ('$NUME_MIG', '$NUME_REV'))")" = t ] \
  || { echo "REFUZ: 20261226a pare aplicata sau are istoric pe clona (proba cere migrarea NEAPLICATA)" >&2; exit 23; }
[ "$(q "SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = '$OWNER' AND is_owner IS TRUE)
          AND EXISTS (SELECT 1 FROM public.user_module_access WHERE profile_id = '$EDITOR' AND module = 'redari' AND access_level = 'editor')
          AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '$EDITOR' AND is_owner IS TRUE)")" = t ] \
  || { echo "REFUZ: OWNER ($OWNER, is_owner) sau EDITOR ($EDITOR, redari = editor, ne-owner) lipsesc de pe clona" >&2; exit 24; }
TINTA_OK=1
[ "$(q "SELECT NOT EXISTS (SELECT 1 FROM public.red_proiecte WHERE id IN ($IDS) OR cod LIKE 'TEST-PREDARE-SINT-%')
          AND NOT EXISTS (SELECT 1 FROM public.red_detinatori WHERE id IN ($IDS))")" = t ] \
  || { TINTA_OK=0; echo "REFUZ: resturi ale unei rulari anterioare (id-uri 5e5e0000-… / TEST-PREDARE-SINT-%): curatati intai" >&2; exit 25; }
OID_PR="$(q "SELECT 'public.red_proiecte'::regclass::oid")"

# ── S0 pregătirea (postgres, fără JWT, comis) ──
echo "S0 pregatirea datelor sintetice"
cat >"$TMP/s0.sql" <<SQL
\\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO public.red_proiecte (id, cod, denumire) VALUES ('$PR1', 'TEST-PREDARE-SINT-1', 'Proba sintetica 1'),
  ('$PR2', 'TEST-PREDARE-SINT-2', 'Proba sintetica 2'), ('$PRA', 'TEST-PREDARE-SINT-A', 'Contraexemplul a');
INSERT INTO public.red_proiecte (id, cod, denumire, text_declaratie) VALUES ('$PRC', 'TEST-PREDARE-SINT-C', 'Text propriu', 'Text personalizat (proba sintetica).');
-- contraexemplul (a): VECHI -> NOU fără JWT, ÎNAINTE de migrare
UPDATE public.red_proiecte SET text_declaratie = '$NOU' WHERE id = '$PRA';
INSERT INTO public.red_uat (id, proiect_id, nume, uat3, sesiune_zi1, program_zi1) VALUES ('$UAT', '$PR1', 'Sinteticeni', 'ZZQ', current_date + 10, '09:00-15:00');
INSERT INTO public.red_parcele (id, proiect_id, uat_id, id_parcela) VALUES ('$PARC', '$PR1', '$UAT', 'ZZQ-0001');
INSERT INTO public.red_detinatori (id, parcela_id, nume, nume_normalizat, calitate) VALUES
  ('$D1', '$PARC', 'Persoana Sintetica Unu', 'PERSOANA SINTETICA UNU', 'proprietar'),
  ('$D2', '$PARC', 'Persoana Sintetica Doi', 'PERSOANA SINTETICA DOI', 'proprietar'),
  ('$D3', '$PARC', 'Persoana Sintetica Trei', 'PERSOANA SINTETICA TREI', 'proprietar');
-- răspunsul ISTORIC cu opțiunea retrasă (regula veche), pe D2
INSERT INTO public.red_raspunsuri (id, detinator_id, canal, optiune, obiectii_text) VALUES ('$R_OLD', '$D2', 'telefon', 'nu_particip_cu_obiectii', 'Obiectie sintetica veche');
COMMIT;
SQL
qf "$TMP/s0.sql" >/dev/null
tok() { q "SELECT token_raspuns FROM public.red_detinatori_token WHERE detinator_id = '$1'"; }
TOK1="$(tok "$D1")"; TOK3="$(tok "$D3")"
[[ "$TOK1" =~ ^[A-Za-z0-9_-]{43}$ ]] && [[ "$TOK3" =~ ^[A-Za-z0-9_-]{43}$ ]] || { echo "tokenurile sintetice lipsesc" >&2; exit 1; }
ok "$(q "SELECT string_agg(cod || '=' || CASE text_declaratie WHEN '$VECHI' THEN 'VECHI' WHEN '$NOU' THEN 'NOU' ELSE 'ALT' END || '/v' || versiune, ' ' ORDER BY cod)
           FROM public.red_proiecte WHERE id IN ($IDS)")" \
   "TEST-PREDARE-SINT-1=VECHI/v1 TEST-PREDARE-SINT-2=VECHI/v1 TEST-PREDARE-SINT-A=NOU/v2 TEST-PREDARE-SINT-C=ALT/v1" "S0 starea de pornire"

# ── S1 / S2 / S3: B (răspuns public în curs), C (formularul cât e ținut lock-ul), A (aplicarea prin runner), observatorul ──
echo "S1-S3 aplicarea prin runner cu doua sesiuni concurente (bariere de eliberare + observator)"
# bariera: așteaptă PE SERVER o condiție (limită 60 s); expirată = NU + jurnalele sesiunilor + ieșire 1 (curățenia oprește sesiunile)
asteapta() {
  if ! q "DO \$w\$ DECLARE t0 timestamptz := clock_timestamp(); BEGIN
            LOOP
              PERFORM pg_stat_clear_snapshot();
              EXIT WHEN ($2);
              IF clock_timestamp() > t0 + interval '60 seconds' THEN RAISE EXCEPTION 'bariera expirata (60 s)'; END IF;
              PERFORM pg_sleep(0.01);
            END LOOP; END \$w\$;" >/dev/null; then
    echo "  NU  bariera: $1 (60 s)"; ESEC=1
    for f in b c obs elib; do if [ -f "$TMP/$f.log" ]; then sed "s/^/     $f| /" "$TMP/$f.log"; fi; done
    exit 1
  fi
}
# „aceeași tranzacție” = pid | xact_start | backend_xid | stare, în aceeași formă în script și în observator
STARE_B="pid || '|' || xact_start || '|' || coalesce(backend_xid::text, '-') || '|' || state"
cat >"$TMP/b.sql" <<SQL
\\set ON_ERROR_STOP 1
SET application_name = '$APP_B';
SET statement_timeout = '330s';
BEGIN;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true) AS _c \\gset
SELECT 'B_RPC ' || public.fn_red_raspuns_public('$TOK1', 'nu_particip_cu_obiectii', NULL, 'Obiectie sintetica in curs', NULL, 'proba-clona')::text;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true) AS _c \\gset
-- tranzacția rămâne DESCHISĂ: B așteaptă eliberarea explicită (sesiunea $APP_ELIB, pornită de script după COMMIT-ul lui A)
DO \$b\$ /* B_ASTEAPTA_ELIBERAREA */ DECLARE t0 timestamptz := clock_timestamp(); BEGIN
  LOOP
    PERFORM pg_stat_clear_snapshot();
    EXIT WHEN EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = '$APP_ELIB' AND pid <> pg_backend_pid());
    IF clock_timestamp() > t0 + interval '300 seconds' THEN RAISE EXCEPTION 'B_ASTEAPTA_ELIBERAREA: eliberarea nu a venit in 300 s'; END IF;
    PERFORM pg_sleep(0.005);
  END LOOP; END \$b\$;
-- ultima instrucțiune înaintea COMMIT-ului lui B (instantaneu nou, READ COMMITTED): istoricul lui A vizibil = A a comis înaintea lui B
SELECT 'B_VEDE_A_COMISA ' || EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '$VERS_MIG' AND name = '$NUME_MIG');
COMMIT;
SELECT 'B_COMIS';
SQL
cat >"$TMP/c.sql" <<SQL
\\set ON_ERROR_STOP 1
SET application_name = '$APP_C';
SET statement_timeout = '330s';
BEGIN;
-- așteptarea (ca postgres): ACCESS EXCLUSIVE pe red_proiecte ACORDAT sesiunii runnerului ($APP_A); la ieșire, în ACEEAȘI instrucțiune,
-- PID-ul văzut se reține și sesiunea trece pe rolul anon; instrucțiunea IMEDIAT următoare e citirea formularului
DO \$c\$ /* C_ASTEAPTA_LOCK */ DECLARE t0 timestamptz := clock_timestamp(); v_db oid := (SELECT oid FROM pg_database WHERE datname = current_database()); v_pid integer;
BEGIN
  LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT l.pid INTO v_pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
     WHERE l.locktype = 'relation' AND l.database = v_db AND l.relation = $OID_PR AND l.mode = 'AccessExclusiveLock' AND l.granted
       AND a.application_name = '$APP_A'
     LIMIT 1;
    EXIT WHEN v_pid IS NOT NULL;
    IF clock_timestamp() > t0 + interval '300 seconds' THEN RAISE EXCEPTION 'C_ASTEAPTA_LOCK: lock-ul runnerului pe red_proiecte nu a aparut in 300 s'; END IF;
    PERFORM pg_sleep(0.001);
  END LOOP;
  PERFORM set_config('proba.c_vazut_a', v_pid::text, false);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
END \$c\$;
SELECT 'C_FORMULAR ' || CASE public.fn_red_formular_public('$TOK3') ->> 'text_declaratie' WHEN '$NOU' THEN 'NOU' WHEN '$VECHI' THEN 'VECHI' ELSE 'ALT' END;
COMMIT;
SELECT 'C_VAZUT_A ' || current_setting('proba.c_vazut_a');
SQL
fundal "$APP_C" "$TMP/c.sql" "$TMP/c.log"; PID_C=$ULTIM_PID
fundal "$APP_B" "$TMP/b.sql" "$TMP/b.log"; PID_B=$ULTIM_PID
# bariera 1: B a terminat RPC-ul și așteaptă eliberarea (tranzacția deschisă); C e în bucla de așteptare a lock-ului
asteapta "B (RPC facut, tranzactie deschisa, asteapta eliberarea) si C (asteapta lock-ul runnerului)" \
  "EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = '$APP_B' AND state = 'active' AND position('B_ASTEAPTA_ELIBERAREA' IN query) > 0)
   AND EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = '$APP_C' AND state = 'active' AND position('C_ASTEAPTA_LOCK' IN query) > 0)"
B_PID="$(q "SELECT pid FROM pg_stat_activity WHERE application_name = '$APP_B'")"
C_PID="$(q "SELECT pid FROM pg_stat_activity WHERE application_name = '$APP_C'")"
[[ "$B_PID" =~ ^[0-9]+$ ]] && [[ "$C_PID" =~ ^[0-9]+$ ]] || { echo "  NU  PID-urile lui B / C nu sunt unice: [$B_PID] [$C_PID]"; ESEC=1; exit 1; }
cat >"$TMP/obs.sql" <<SQL
\\set ON_ERROR_STOP 1
SET application_name = '$APP_OBS';
SET statement_timeout = '330s';
DO \$o\$ /* OBS_ESANTIONARE */ DECLARE
  t0 timestamptz := clock_timestamp(); v_db oid := (SELECT oid FROM pg_database WHERE datname = current_database());
  v_we text; v_q text; v_a integer; v_bl integer[]; v_pid_a integer; v_b_la_a text; prima timestamptz; ultima timestamptz;
  n integer := 0; n_a integer := 0; n_ac integer := 0; n_b integer := 0;
BEGIN
  LOOP
    PERFORM pg_stat_clear_snapshot();
    -- OBS_ESANTIONARE: până când sesiunea C se încheie
    SELECT a.wait_event_type, a.query INTO v_we, v_q FROM pg_stat_activity a WHERE a.pid = $C_PID;
    EXIT WHEN NOT FOUND;
    n := n + 1;
    v_a := NULL;
    SELECT l.pid INTO v_a FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
     WHERE l.locktype = 'relation' AND l.database = v_db AND l.relation = $OID_PR AND l.mode = 'AccessExclusiveLock' AND l.granted
       AND a.application_name = '$APP_A'
     LIMIT 1;
    IF v_a IS NOT NULL AND v_b_la_a IS NULL THEN
      SELECT $STARE_B INTO v_b_la_a FROM pg_stat_activity WHERE pid = $B_PID;
      v_b_la_a := coalesce(v_b_la_a, 'B absenta');
    END IF;
    v_bl := pg_blocking_pids($C_PID);
    IF v_a IS NOT NULL AND v_we = 'Lock' AND v_a = ANY (v_bl) THEN
      n_a := n_a + 1; v_pid_a := v_a; prima := coalesce(prima, clock_timestamp()); ultima := clock_timestamp();
      IF position('C_FORMULAR' IN v_q) > 0 THEN n_ac := n_ac + 1; END IF;
    ELSIF v_we = 'Lock' AND $B_PID = ANY (v_bl) THEN
      n_b := n_b + 1;
    END IF;
    IF clock_timestamp() > t0 + interval '300 seconds' THEN RAISE EXCEPTION 'observatorul: C nu s-a incheiat in 300 s'; END IF;
    PERFORM pg_sleep(0.001);
  END LOOP;
  PERFORM set_config('proba.obs_a_pid', coalesce(v_pid_a::text, '-'), false);
  PERFORM set_config('proba.obs_b_la_a', coalesce(v_b_la_a, 'lock-ul lui A nevazut'), false);
  PERFORM set_config('proba.obs_c_de_a', n_a || ' ' || n_ac || ' ' || coalesce(round(extract(epoch FROM ultima - prima) * 1000)::text, '-'), false);
  PERFORM set_config('proba.obs_c_de_b', n_b::text, false);
  PERFORM set_config('proba.obs_n', n || ' ' || round(extract(epoch FROM clock_timestamp() - t0) * 1000), false);
END \$o\$;
SELECT 'OBS_A_PID ' || current_setting('proba.obs_a_pid');
SELECT 'OBS_B_LA_LOCK_A ' || current_setting('proba.obs_b_la_a');
SELECT 'OBS_C_BLOCAT_DE_A ' || current_setting('proba.obs_c_de_a');
SELECT 'OBS_C_BLOCAT_DE_B ' || current_setting('proba.obs_c_de_b');
SELECT 'OBS_ESANTIOANE ' || current_setting('proba.obs_n');
SQL
fundal "$APP_OBS" "$TMP/obs.sql" "$TMP/obs.log"; PID_O=$ULTIM_PID
# bariera 2: observatorul eșantionează (înaintea pornirii runnerului)
asteapta "observatorul (esantionarea pornita)" \
  "EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = '$APP_OBS' AND state = 'active' AND position('OBS_ESANTIONARE' IN query) > 0)"
# dovezile lui B la barieră, ÎNAINTE de pornirea runnerului: tranzacția, lock-urile (ipoteza din antet)
B_INAINTE="$(q "SELECT $STARE_B FROM pg_stat_activity WHERE pid = $B_PID")"
B_LOCURI="$(q "SELECT coalesce(string_agg(c.relname || ':' || l.mode || CASE WHEN l.granted THEN '' ELSE '(neacordat)' END, ', ' ORDER BY c.relname, l.mode), '-')
                 FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
                WHERE l.pid = $B_PID AND l.locktype = 'relation' AND c.relkind IN ('r', 'p') AND c.relnamespace = 'public'::regnamespace")"
B_IPOTEZA="$(q "SELECT NOT EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = $B_PID AND l.locktype = 'relation' AND l.relation = $OID_PR)
                   AND NOT EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = $B_PID AND l.locktype = 'relation'
                                     AND (NOT l.granted OR l.mode NOT IN ('AccessShareLock', 'RowShareLock', 'RowExclusiveLock')))
                   AND EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = $B_PID AND l.locktype = 'relation' AND l.granted
                                 AND l.relation = 'public.red_raspunsuri'::regclass AND l.mode = 'RowExclusiveLock')")"
echo "     B (pid $B_PID) tine, pe tabelele public: $B_LOCURI"
ok "$B_IPOTEZA" t "S1 ipoteza din antet: B tine ROW EXCLUSIVE pe red_raspunsuri, nimic pe red_proiecte, nimic peste ROW EXCLUSIVE, nimic neacordat"
okre "$B_INAINTE" "^$B_PID\\|[^|]+\\|[0-9]+\\|active\$" "S1 B la bariera: tranzactie cu xid (a scris), activa in asteptarea eliberarii [$B_INAINTE]"
RC_A=0
PGAPPNAME="$APP_A" PSQL_BIN="$PSQL" bash scripts/livrare_migrare.sh --migrare "$MIG" --sha256 "$SHA_MIG" --versiune "$VERS_MIG" \
  --tinta-db "$D" --tinta-sistem "$SISTEM" --tinta-host "$H" --tinta-port "$P" --user "$U" --plafon-tranzactie-ms 5000 \
  --amprenta-globala "$AG" --diferente-globale "$MAN" >"$TMP/a.log" 2>&1 || RC_A=$?
[ "$RC_A" = 0 ] && APLICAT=1
# după ieșirea runnerului, ÎNAINTEA eliberării: A comisă (istoricul vizibil din altă sesiune) și B tot în ACEEAȘI tranzacție
A_COMISA="$(q "SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '$VERS_MIG' AND name = '$NUME_MIG')")"
B_DUPA="$(q "SELECT $STARE_B FROM pg_stat_activity WHERE pid = $B_PID")"
# eliberarea explicită a lui B (sesiunea $APP_ELIB rămâne până se încheie B; limită 60 s)
cat >"$TMP/elib.sql" <<SQL
\\set ON_ERROR_STOP 1
SET application_name = '$APP_ELIB';
SET statement_timeout = '90s';
DO \$e\$ DECLARE t0 timestamptz := clock_timestamp(); BEGIN
  LOOP
    PERFORM pg_stat_clear_snapshot();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = $B_PID AND application_name = '$APP_B');
    IF clock_timestamp() > t0 + interval '60 seconds' THEN RAISE EXCEPTION 'eliberarea: B (pid %) nu s-a incheiat in 60 s', $B_PID; END IF;
    PERFORM pg_sleep(0.005);
  END LOOP; END \$e\$;
SQL
fundal "$APP_ELIB" "$TMP/elib.sql" "$TMP/elib.log"; PID_E=$ULTIM_PID
RC_B=0; wait "$PID_B" || RC_B=$?; gata_pid "$PID_B"
RC_E=0; wait "$PID_E" || RC_E=$?; gata_pid "$PID_E"
RC_C=0; wait "$PID_C" || RC_C=$?; gata_pid "$PID_C"
RC_O=0; wait "$PID_O" || RC_O=$?; gata_pid "$PID_O"
ok "$RC_A" 0 "S3 aplicarea prin runner: cod 0"
[ "$RC_A" = 0 ] || sed 's/^/     a| /' "$TMP/a.log"
okre "$(cat "$TMP/a.log")" '20261226a: lock la [0-9]+ ms de la BEGIN \(1 incercari' "S3 lock-ul obtinut la prima incercare, cu B deschisa (vezi S1: aceeasi tranzactie inainte, la lock si dupa)"
okre "$(cat "$TMP/a.log")" 'declaratia: 2 proiecte schimbate \(id cod versiune: [^)]*TEST-PREDARE-SINT-1 v2; [^)]*TEST-PREDARE-SINT-2 v2\), [0-9]+ cu text personalizat neatinse; marcajul executiei in red_jurnal\.user_email: livrare:20261226a_redari_predare_declaratie:[0-9]+' "S3 NOTICE-ul evidentei (doar P1, P2; marcajul)"
okre "$(cat "$TMP/a.log")" 'APLICAT \+ ÎNREGISTRAT' "S3 aplicat + inregistrat"
# S1: B deschisă pe toată durata aplicării (aceeași tranzacție înainte de runner, la lock-ul lui A, după COMMIT-ul lui A) și comisă DUPĂ A
ok "$A_COMISA|$B_DUPA" "t|$B_INAINTE" "S1 dupa iesirea runnerului: A comisa (istoricul vizibil) si B = aceeasi tranzactie, inca deschisa"
ok "$(linie OBS_B_LA_LOCK_A "$TMP/obs.log")" "$B_INAINTE" "S1 la primul esantion cu ACCESS EXCLUSIVE al lui A pe red_proiecte, B = aceeasi tranzactie deschisa (observatorul)"
ok "$RC_E" 0 "S1 eliberarea lui B (dupa COMMIT-ul lui A): cod 0"
ok "$RC_B" 0 "S1 sesiunea B: cod 0"
[ "$RC_B" = 0 ] || sed 's/^/     b| /' "$TMP/b.log"
okre "$(jurnal "$TMP/b.log")" 'B_RPC \{"ok": true' "S1 B: RPC-ul inceput inainte de migrare a primit {ok: true} (regula veche)"
ok "$(linie B_VEDE_A_COMISA "$TMP/b.log")" t "S1 ordinea: ultima instructiune a lui B inaintea COMMIT-ului vede A comisa (A a comis inaintea lui B)"
okre "$(jurnal "$TMP/b.log")" '^B_COMIS$' "S1 B comisa"
ok "$(q "SELECT count(*) FROM public.red_raspunsuri WHERE detinator_id = '$D1' AND optiune = 'nu_particip_cu_obiectii'")" 1 "S1 raspunsul lui B (regula veche) exista, comis dupa A"
# S2: C a citit formularul IMEDIAT după ce a văzut lock-ul sesiunii runnerului și a fost BLOCATĂ de A (observatorul)
ok "$RC_O" 0 "S2 observatorul: cod 0"
[ "$RC_O" = 0 ] || sed 's/^/     obs| /' "$TMP/obs.log"
OBS_A_PID="$(linie OBS_A_PID "$TMP/obs.log")"
ok "$RC_C" 0 "S2 sesiunea C: cod 0 (a asteptat, fara eroare)"
[ "$RC_C" = 0 ] || sed 's/^/     c| /' "$TMP/c.log"
okre "$OBS_A_PID" '^[0-9]+$' "S2 observatorul a identificat sesiunea runnerului (application_name $APP_A) care tine ACCESS EXCLUSIVE pe red_proiecte"
ok "$(linie C_VAZUT_A "$TMP/c.log")" "$OBS_A_PID" "S2 C a observat lock-ul sesiunii runnerului (acelasi PID ca observatorul)"
okre "$(jurnal "$TMP/c.log")" '^C_FORMULAR NOU$' "S2 C: formularul citit dupa COMMIT-ul lui A arata declaratia NOUA"
OBS_C="$(linie OBS_C_BLOCAT_DE_A "$TMP/obs.log")"
read -r N_A N_AC DUR_A <<<"${OBS_C:-0 0 -}"
if [[ "${N_AC:-0}" =~ ^[1-9][0-9]*$ ]]; then
  echo "  OK  S2 observatorul: C BLOCATA de A (wait_event_type Lock, pg_blocking_pids(C) contine PID-ul lui A) in citirea formularului: $N_AC esantioane"
else
  echo "  NU  S2 blocarea lui C de catre A NEDOVEDITA (0 esantioane in citirea formularului; [$OBS_C]): se reruleaza, nu se declara trecut"; ESEC=1
fi
echo "     asteptarea lui C pe lock-ul lui A (observator, ceasul serverului): ${DUR_A:-?} ms intre primul si ultimul esantion blocat ($N_A esantioane; limita inferioara)"
echo "     apoi C a asteptat dupa B (contorul comun 'ip:necunoscut', informativ): $(linie OBS_C_BLOCAT_DE_B "$TMP/obs.log") esantioane; observatorul: $(linie OBS_ESANTIOANE "$TMP/obs.log") (esantioane, ms)"
[ "$APLICAT" = 1 ] || { echo "aplicarea a picat: restul pasilor nu au sens" >&2; exit 1; }

# ── S4 după aplicare ──
echo "S4 dupa aplicare: randurile, jurnalul, rolurile reale"
ok "$(q "SELECT string_agg(cod || '=' || CASE text_declaratie WHEN '$VECHI' THEN 'VECHI' WHEN '$NOU' THEN 'NOU' ELSE 'ALT' END || '/v' || versiune, ' ' ORDER BY cod)
           FROM public.red_proiecte WHERE id IN ($IDS)")" \
   "TEST-PREDARE-SINT-1=NOU/v2 TEST-PREDARE-SINT-2=NOU/v2 TEST-PREDARE-SINT-A=NOU/v2 TEST-PREDARE-SINT-C=ALT/v1" "S4 randurile"
ok "$(q "SELECT pg_get_expr(d.adbin, d.adrelid) = quote_literal('$NOU') || '::text' FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
          WHERE d.adrelid = 'public.red_proiecte'::regclass AND a.attname = 'text_declaratie'")" t "S4 DEFAULT-ul = NOU"
ok "$(q "SELECT count(*) || '/' || count(DISTINCT user_email) || '/' || count(*) FILTER (WHERE user_id IS NULL) || '/' || string_agg(CASE inregistrare_id WHEN '$PR1' THEN 'P1' WHEN '$PR2' THEN 'P2' ELSE 'ALT' END, ',' ORDER BY inregistrare_id)
           FROM public.red_jurnal WHERE tabela = 'red_proiecte' AND inregistrare_id IN ($IDS) AND user_email ~ '^livrare:20261226a_redari_predare_declaratie:[0-9]+\$'")" \
   "2/1/2/P1,P2" "S4 jurnalul: 2 randuri cu acelasi marcaj al executiei, fara utilizator, doar P1 si P2"
# un apel ca rolul real (PostgREST): ROLE + claims în ambele surse; tipărește „OK <valoare>” sau „ERR <SQLSTATE>”
N_APEL=0
ca() {
  local rol="$1" uid="$2" sql="$3" claims f rc=0 out
  N_APEL=$((N_APEL + 1)); f="$TMP/apel_$N_APEL.sql"
  if [ "$uid" = - ]; then claims="{\"role\":\"$rol\"}"; else claims="{\"sub\":\"$uid\",\"role\":\"$rol\"}"; fi
  {
    printf '%s\n' '\set ON_ERROR_STOP 1' 'BEGIN;' "SET LOCAL ROLE $rol;"
    printf '%s\n' "SELECT set_config('request.jwt.claims', '$claims', true) AS _c, set_config('request.jwt.claim.sub', '$([ "$uid" = - ] || printf '%s' "$uid")', true) AS _s \\gset"
    printf '%s\n' "$sql" 'COMMIT;'
  } >"$f"
  out="$(PGAPPNAME="$APP_CTL" "$PSQL" -X -q -At -v ON_ERROR_STOP=1 -v VERBOSITY=verbose "${CONN[@]}" -f "$f" 2>"$f.err")" || rc=$?
  if [ "$rc" = 0 ]; then printf 'OK %s' "$out"; else printf 'ERR %s' "$(grep -oE 'ERROR:  [0-9A-Z]{5}' "$f.err" | head -n 1 | cut -c9-)"; fi
}
N3="$(q "SELECT count(*) FROM public.red_raspunsuri WHERE detinator_id = '$D3'")"
ok "$(ca anon - "SELECT public.fn_red_raspuns_public('$TOK3', 'nu_particip_cu_obiectii', NULL, 'x', NULL, 'proba') ->> 'motiv';")" "OK optiune_invalida" "S4 anon RPC: optiunea retrasa -> optiune_invalida"
ok "$(ca anon - "SELECT public.fn_red_raspuns_public('$TOK3', 'xyz', NULL, 'x', NULL, 'proba') ->> 'motiv';")" "OK optiune_invalida" "S4 anon RPC: optiune necunoscuta -> acelasi refuz (fara oracol)"
ok "$(q "SELECT count(*) FROM public.red_raspunsuri WHERE detinator_id = '$D3'")" "$N3" "S4 anon RPC: nimic scris la refuz"
ok "$(ca anon - "SELECT public.fn_red_raspuns_public('$TOK3', 'constatare_teren', NULL, 'Cer constatare (sintetic)', NULL, 'proba') ->> 'ok';")" "OK true" "S4 anon RPC: constatare_teren -> ok (calea legitima)"
ok "$(ca authenticated "$EDITOR" "INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, obiectii_text) VALUES ('$D3', 'telefon', 'nu_particip_cu_obiectii', 'x') RETURNING optiune;")" "ERR 23514" "S4 editor: INSERT cu optiunea retrasa -> 23514"
ok "$(ca authenticated "$EDITOR" "INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, obiectii_text) VALUES ('$D3', 'telefon', 'constatare_teren', 'Constatare sintetica') RETURNING optiune;")" "OK constatare_teren" "S4 editor: INSERT constatare_teren -> OK"
ok "$(ca authenticated "$EDITOR" "UPDATE public.red_raspunsuri SET obiectii_text = 'Obiectie sintetica corectata' WHERE id = '$R_OLD' RETURNING optiune;")" "OK nu_particip_cu_obiectii" "S4 editor: corectarea raspunsului istoric -> OK, optiunea ramane"
ok "$(ca authenticated "$EDITOR" "UPDATE public.red_raspunsuri SET optiune = 'nu_particip_cu_obiectii' WHERE id = (SELECT id FROM public.red_raspunsuri WHERE detinator_id = '$D3' AND canal = 'telefon' ORDER BY seq DESC LIMIT 1) RETURNING optiune;")" "ERR 23514" "S4 editor: UPDATE catre optiunea retrasa -> 23514"
ok "$(ca authenticated "$OWNER" "INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, obiectii_text) VALUES ('$D3', 'scris', 'nu_particip_cu_obiectii', 'x') RETURNING optiune;")" "ERR 23514" "S4 owner: INSERT cu optiunea retrasa -> 23514"
ok "$(ca service_role - "INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, obiectii_text) VALUES ('$D3', 'email', 'nu_particip_cu_obiectii', 'x') RETURNING optiune;")" "ERR 23514" "S4 service_role: INSERT cu optiunea retrasa (canal email) -> 23514"
ok "$(ca anon - "SELECT public.fn_red_optiune_retrasa('particip');")" "ERR 42501" "S4 anon: fn_red_optiune_retrasa -> 42501"
ok "$(ca authenticated "$OWNER" "SELECT public.fn_red_optiune_retrasa('particip');")" "ERR 42501" "S4 authenticated: fn_red_optiune_retrasa -> 42501"

# ── S5 contraexemplul (b) + salvarea unui om ──
echo "S5 contraexemplul (b) si salvarea unui om"
cat >"$TMP/s5.sql" <<SQL
\\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO public.red_proiecte (id, cod, denumire, text_declaratie) VALUES ('$PRB', 'TEST-PREDARE-SINT-B', 'Contraexemplul b', '$VECHI');
UPDATE public.red_proiecte SET text_declaratie = '$NOU' WHERE id = '$PRB';
COMMIT;
SQL
qf "$TMP/s5.sql" >/dev/null
ok "$(ca authenticated "$OWNER" "UPDATE public.red_proiecte SET denumire = 'Redenumit de om (sintetic)' WHERE id = '$PR2' RETURNING versiune;")" "OK 3" "S5 owner redenumeste P2 (versiunea 3)"

# ── S6 revenirea prin runner ──
echo "S6 revenirea prin runner"
RC_R=0
PGAPPNAME="$APP_A" PSQL_BIN="$PSQL" bash scripts/livrare_migrare.sh --migrare "$REV" --sha256 "$SHA_REV" --versiune "$VERS_REV" \
  --tinta-db "$D" --tinta-sistem "$SISTEM" --tinta-host "$H" --tinta-port "$P" --user "$U" --plafon-tranzactie-ms 2000 >"$TMP/r.log" 2>&1 || RC_R=$?
[ "$RC_R" = 0 ] && REVENIT=1
ok "$RC_R" 0 "S6 revenirea prin runner: cod 0"
[ "$RC_R" = 0 ] || sed 's/^/     r| /' "$TMP/r.log"
okre "$(cat "$TMP/r.log")" 'revenire: executia livrare:20261226a_redari_predare_declaratie:[0-9]+: 1 proiecte readuse la declaratia veche \(id cod versiune: [^)]*TEST-PREDARE-SINT-1 v3\); 1 proiecte ale executiei salvate intre timp, neatinse; [0-9]+ proiecte raman cu textul nou' "S6 NOTICE-ul revenirii"
ok "$(q "SELECT string_agg(cod || '=' || CASE text_declaratie WHEN '$VECHI' THEN 'VECHI' WHEN '$NOU' THEN 'NOU' ELSE 'ALT' END, ' ' ORDER BY cod)
           FROM public.red_proiecte WHERE id IN ($IDS)")" \
   "TEST-PREDARE-SINT-1=VECHI TEST-PREDARE-SINT-2=NOU TEST-PREDARE-SINT-A=NOU TEST-PREDARE-SINT-B=NOU TEST-PREDARE-SINT-C=ALT" \
   "S6 P1 readus; P2 (salvat de om), A si B (contraexemplele) neatinse; C neschimbat"
ok "$(q "SELECT user_id IS NULL AND user_email ~ '^livrare:20261226a_redari_predare_declaratie_ROLLBACK:[0-9]+\$' FROM public.red_jurnal
          WHERE tabela = 'red_proiecte' AND inregistrare_id = '$PR1' ORDER BY id DESC LIMIT 1")" t "S6 randul de jurnal al revenirii pe P1 poarta marcajul ei"
ok "$(q "SELECT to_regprocedure('public.fn_red_optiune_retrasa(text)') IS NULL AND (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
          WHERE d.adrelid = 'public.red_proiecte'::regclass AND a.attname = 'text_declaratie') = quote_literal('$VECHI') || '::text'")" t "S6 functia noua scoasa, DEFAULT-ul = VECHI"
ok "$(q "SELECT count(*) FROM pg_stat_activity WHERE application_name IN ($APPS) AND pid <> pg_backend_pid()")" 0 "S7 nicio sesiune a probei ramasa (inainte de curatenie)"

# verdictul final („PASS” / „ESEC”) îl tipărește curățenia (trap EXIT), DOAR după ce a șters și a verificat datele, istoricul și sesiunile
exit "$ESEC"
