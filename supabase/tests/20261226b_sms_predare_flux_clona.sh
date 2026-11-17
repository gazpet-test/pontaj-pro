#!/usr/bin/env bash
# Proba pe CLONĂ a fluxului complet al unui lot SMS Redări DUPĂ migrările 20261226a + 20261226b (condiția GO #1119: „dovada fluxului complet
# creare -> aprobare -> rezervare -> worker pe clonă”). DOAR pe CLONĂ, cu A și B DEJA APLICATE de coordonator (prin runner). NETESTAT de autor
# (serverul de cod nu are acces la nicio bază): îl rulează coordonatorul. Nu schimbă nicio migrare / funcție; nu cheamă niciun furnizor SMS,
# nicio funcție edge, niciun cron: pașii de bază de date ai workerului sms-trimite (fn_sms_rezerva -> fn_sms_rezultat) se fac din psql, ca
# rolul service_role al edge-ului, iar cei ai aplicației ca rolul authenticated cu JWT-ul contului (ca PostgREST).
# Rulare (Git Bash; parola din pgpass, niciodată pe linia de comandă; între 08:00 și 19:45 ora României — fereastra SMS-ului extern):
#   PSQL=<calea psql> EDITOR=<uuid profil ne-owner, FĂRĂ acces SMS> \
#   bash supabase/tests/20261226b_sms_predare_flux_clona.sh --sistem <system_identifier clonă> --host <H> --port <P> --user postgres --db postgres
#   (OWNER=<uuid>, implicit 00000000-0000-4000-8000-000000000001: profilul sintetic is_owner al clonei, ca la 20261226a / 20261225a)
# GĂRZI (înainte de orice scriere; codul de ieșire în paranteză):
#   (22) system_identifier = --sistem;
#   (23) A și B APLICATE: fn_red_optiune_retrasa(text) există (A); corpurile fn_sms_redari_sablon_model() / _versiune() = amprentele postcondiției
#        din 20261226b și versiunea = provizoriu-2026-11-17 (B); lanțul SMS al clonei = cel din repo: obiectele există, corpurile
#        fn_sms_loturi_reguli / fn_sms_mesaje_reguli / fn_sms_rezerva = amprentele postcondiției 20261130c, fn_sms_lot_aproba / fn_sms_rezultat =
#        amprentele din 20261130c / 20261130b, triggerele trg_sms_* active, fn_sms_rezerva / fn_sms_rezultat doar pentru service_role;
#   (24) OWNER is_owner; EDITOR ne-owner și FĂRĂ nivel SMS (fn_sms_nivel_cont = NULL; contul cu redari = editor din proba A e potrivit);
#   (25) niciun rest al unei rulări anterioare (id-urile b26b0000-… / codul TEST-SMSP-SINT / loturi pe proiect / mesaje către deținătorii probei);
#   (27) mediul: ora României 08:00–19:45 (altfel fn_sms_rezerva răspunde in_afara_orelor), fără pg_cron / pg_net pe clonă (nimic nu pornește
#        singur o trimitere cât comutatorul e pornit), un singur rând sms_setari, consumul zi / lună cu loc pentru 5 SMS sub plafoane.
# DATELE: SINTETICE, fără date personale. Proiectul de TEST „TEST-SMSP-SINT” (regula șablonului provizoriu: doar TEST-%, 1–5 destinatari),
#   contact 0700000999, e-mail de contact .invalid; 5 UAT-uri („Sinteticeni” ZSA + „Vechieni Unu…Patru” ZSB…ZSE), o parcelă pe UAT, 8 deținători
#   „Persoana Sintetica …” cu mobile SINTETICE valide ca format (0700000901…908), adrese „Strada Fictiva nr. N”, fără e-mail; câte o convocare
#   activă pe canalul telefon (fără plic / informare); sesiunea: azi + 10 zile, program 09:00-15:00. Inserate ca postgres cu triggerele REALE
#   active; convocările cu auth.uid() = OWNER (triggerul calității cere admin / editor), ca în fixture-ul FAN (20261212a).
#   Rândul sms_setari: copia INTEGRALĂ (to_jsonb) se ia înaintea oricărei schimbări și se pune la loc EXACT la curățenie (și versiune /
#   actualizat_la / actualizat_de), cu triggerul oprit DOAR în tranzacția de curățenie; în probă comutatoarele se schimbă DOAR pe calea reală
#   (fn_sms_setari_salveaza / fn_sms_redari_autorizare_seteaza, ca OWNER — doar owner-ul le poate schimba, 20261130a:640-680).
# DE CE comutatorul Redări e PORNIT la creare și aprobare: BD-ul refuză crearea (chiar și previzualizarea) și aprobarea unui lot Redări cât
#   redari_autorizat = false (20261130c:359-362, triggerul 20261130c:475-477 / 512-514). Starea producției (oprit) se probează la F1a (creare
#   refuzată) și la F4a (rezervare refuzată); pornirea e doar pe clonă, doar în interiorul probei.
# SCENARIILE și REZULTATELE AȘTEPTATE (scrise de mână; fiecare verificare tipărește OK / NU; orice NU = cod de ieșire nenul):
#   F1a comutatorul Redări OPRIT (ca în producție): previzualizarea lotului ca OWNER -> ERR 42501 „sms redari: blocat - asteapta autorizarea
#       scrisa Transgaz…”; nimic creat.
#   F1  comutatoarele pornite pe calea reală (kill-switch oprit dacă era pornit; Redări pornit cu nr. „PROBA-CLONA-SMSP” și data de azi).
#       Previzualizarea (OWNER, ca aplicația: fn_sms_lot_redari_sablon_creeaza(..., p_doar_preview = true)) pe UAT-ul Sinteticeni:
#       text_final = „Gazpet pt Transgaz: sesiune predare teren la Primaria Sinteticeni, <ZZ.LL> ora 09:00. Raspuns si online, cu QR-ul din
#       scrisoare. Tel 0700000999” (ZZ.LL = sesiunea, azi + 10), lungimea = numărul de caractere al acestui text (ASCII = GSM-7 de bază),
#       sablon_versiune = provizoriu-2026-11-17, sablon_aprobat = true, 3 destinatari, niciun lot activ / campanie pe UAT, set_hash md5.
#       Crearea (textul afișat + set_hash din previzualizare, ca RedariSmsButon.jsx:69) -> lot draft, 3 mesaje in_coada către +40700000901…903
#       (D1…D3), filtru.sablon_versiune = provizoriu-2026-11-17, zi = sesiunea, ora 09:00, creat_nivel owner; textul lotului = cel de mai sus,
#       conține „sesiune predare teren”, un singur segment (fn_sms_text_verifica), lungimea = cea scrisă de mână.
#   F2  „aplicația nepublicată”: un client care trimite textul cu „redare” (modelul VECHI) + set_hash-ul valid -> ERR 40001 „sms redari: textul
#       s-a schimbat fata de cel afisat…”; niciun lot creat. (Versiunea NU e un parametru al RPC-ului: o scrie BD-ul; UI-ul vechi blochează
#       oricum butonul înainte de apel — motivBlocareCreare, „Textul din BD diferă de cel afișat” —, deci 40001 e plasa BD-ului.)
#   F3  aprobarea (fn_sms_lot_aproba, versiunea afișată): anon -> ERR 42501 (permission denied for function); EDITOR (fără nivel SMS) -> ERR
#       42501 „sms: nu ai acces la modulul SMS”; OWNER cu versiunea greșită -> ERR 40001 „lotul s-a schimbat de la previzualizare”; lotul
#       rămâne draft v1; OWNER cu versiunea 1 -> aprobat v2, aprobat_nivel owner, aprobat_autorizare_nr PROBA-CLONA-SMSP.
#   F4a comutatorul Redări OPRIT pe calea reală: rezervarea (service_role, p_apelant = OWNER, ca butonul „Trimite”) -> motiv redari_neautorizat,
#       0 mesaje; lotul rămâne aprobat v2, 0 mesaje rezervate. authenticated (OWNER) pe fn_sms_rezerva -> ERR 42501 (doar service_role).
#   F4b comutatorul pornit din nou; DOUĂ rezervări CONCURENTE (sesiuni reale, p_max = 1): X rezervă și ține tranzacția deschisă până la
#       eliberarea explicită; Y pornește după și e BLOCATĂ de X (pg_blocking_pids(Y) conține PID-ul lui X, wait_event_type Lock); după
#       COMMIT-ul lui X: X și Y au câte UN mesaj, DIFERITE, motiv ok, textul = cel nou scris de mână; Y vede rezervarea lui X (ramase = 1);
#       în BD: 2 necunoscut + 1 in_coada, lotul in_trimitere, rezervat_la(Y) > rezervat_la(X) (L05: nicio dublare).
#   F5  pașii de BD ai workerului (fn_sms_rezultat, service_role): mesajul lui X -> trimis (id de furnizor sintetic), al lui Y -> necunoscut
#       (clasa necunoscut, cod timeout_proba). Rezervarea repetată -> DOAR al treilea mesaj (cel necunoscut NU se reia), ramase 0, lotul
#       coada_golita; al treilea -> trimis; încă o rezervare -> motiv lot_coada_golita, 0 mesaje; mesajul necunoscut are aceeași versiune și
#       același rezervat_la ca înainte (nicio retrimitere); un rezultat repetat pe mesajul trimis -> ignorat (id-ul de furnizor neschimbat).
#       Starea finală (fn_sms_lot_destinatari ca OWNER): 2 trimis + 1 necunoscut. Lotul coada_golita cu un necunoscut OCUPĂ UAT-ul:
#       previzualizarea arată lot_activ_uat = lotul, crearea -> ERR 23505 „UAT-ul are deja un lot activ”; anularea -> ERR 23514 „lotul e deja
#       inchis (coada_golita)” (documentul B §4).
#   F6  loturi create ÎNAINTE de B (versiunea provizoriu-2026-11-03, textul cu „redare”), câte unul pe UAT: V1 draft, V2 aprobat, V3 in_trimitere
#       (un mesaj necunoscut + unul in_coada), V4 coada_golita (un mesaj trimis). CUM se creează (după B nu există altă cale): lotul și mesajele
#       se INSEREAZĂ ca postgres cu auth.uid() = OWNER și triggerele REALE ACTIVE (triggerul de INSERT nu verifică versiunea: e exact rândul pe
#       care l-ar fi scris RPC-ul înainte de B — creat_de / creat_nivel / textul GSM-7 / UAT-ul le pune și verifică triggerul); ISTORICUL de
#       dinainte de B (aprobarea, rezervarea, rezultatul) nu mai poate fi parcurs după B (triggerul îl refuză: tocmai comportamentul probat),
#       deci trecerile de stare ale V2–V4 se scriu cu triggerele trg_sms_loturi_reguli / trg_sms_mesaje_reguli OPRITE DOAR în acea tranzacție,
#       exact coloanele pe care le-ar fi scris triggerul (aprobat_de / _la / _nivel / _autorizare_*, versiune, coada_golita_la; furnizor,
#       rezervat_la, trimis_la, furnizor_id), reactivate și verificate (tgenabled = O) ÎNAINTE de COMMIT. Tot ce se probează după (aprobare,
#       rezervare, anulare, recreare) rulează cu triggerele active, pe căile reale.
#       Așteptat: interogarea din documentul B §4 (verbatim) le clasifică V1–V3 „anulabil: anulare, apoi recreare”, V4 „inchis: UAT eliberat;
#       ziua lui ramane ocupata (campania)”, iar lotul nou (F1) nu apare; aprobarea V1 (OWNER) -> ERR 22023 „sms redari: sablon_neaprobat - …”;
#       rezervarea V2 și V3 -> motiv sablon_neaprobat, 0 mesaje, nimic schimbat (V2 aprobat, V3: in_coada + necunoscut neatinse);
#       anularea (OWNER) V1 / V2 / V3 -> anulat (mesaje_anulate 1; la V3 deja_rezervate_necunoscut 1, necunoscutul rămâne necunoscut);
#       V4 -> ERR 23514 „sms: lotul e deja inchis (coada_golita)”. Recrearea din șablon (§4): pe UAT-ul lui V3 (anulat) -> previzualizare fără
#       lot activ / campanie, creare reușită, versiunea nouă, 2 destinatari; pe UAT-ul lui V4 -> campanie_existenta = V4, crearea -> ERR 23505
#       „campania … exista deja”.
#   F7  curățenia (trap, și la eroare): sesiunile probei oprite; o tranzacție care șterge DOAR ce a creat proba (după identificatori: mesajele și
#       loturile proiectului sintetic, jurnalul rândurilor lui, convocările / contactele / tokenurile / deținătorii / parcelele / UAT-urile /
#       proiectul) cu triggerele USER ale tabelelor atinse oprite DOAR în ea (loturile / mesajele / jurnalul nu se pot șterge altfel), pune la
#       loc rândul sms_setari EXACT ca la început și VERIFICĂ înainte de COMMIT (nimic rămas, setările = copia, triggerele active); după COMMIT,
#       a doua verificare din ALTĂ sesiune (0 rânduri, setările = copia, 0 sesiuni ale probei). Abia apoi „PASS”.
#       Curățenia picată = cod 26, dosarul temporar PĂSTRAT (copia setărilor, jurnalele sesiunilor; doar date sintetice).
# CE NU DOVEDEȘTE: furnizorul real (SMSLink), funcția edge sms-trimite (poarta JWT, fereastra 08-20 verificată în edge înaintea fiecărui apel,
#   bucla de runde), cronul intern (calea p_lot_id = NULL nu se cheamă: pe clonă ar putea atinge alte loturi), nivelul „utilizator” SMS (nu
#   există un cont sintetic cu sms = editor; vezi raportul), concurența cu un worker care a rezervat ÎNAINTE de COMMIT-ul lui B (procedura
#   din documentul B §3).
# Ieșire: 0 = toate OK și curățenia verificată; 1 = o verificare a picat (sau o barieră a expirat); 2 = argumente; 22 = altă țintă; 23 = A / B
#   neaplicate sau lanțul SMS diferit; 24 = OWNER / EDITOR nepotrivite; 25 = resturi ale unei rulări anterioare; 26 = curățenia a picat sau n-a
#   putut fi verificată (prioritar față de 0 / 1); 27 = mediul (oră, pg_cron / pg_net, setări, plafon).
set -euo pipefail
PSQL="${PSQL:-psql}"
export PGCLIENTENCODING=UTF8
SISTEM="" H="" P="" U="" D=""
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || { echo "optiunea $1 fara valoare" >&2; exit 2; }
  case "$1" in
    --sistem) SISTEM="$2" ;; --host) H="$2" ;; --port) P="$2" ;; --user) U="$2" ;; --db) D="$2" ;;
    *) echo "argument necunoscut: $1" >&2; exit 2 ;;
  esac
  shift 2
done
[[ "$SISTEM" =~ ^[0-9]+$ ]] || { echo "lipseste --sistem <system_identifier al clonei>" >&2; exit 2; }
[ -n "$H" ] && [ -n "$P" ] && [ -n "$U" ] && [ -n "$D" ] || { echo "lipsesc --host / --port / --user / --db" >&2; exit 2; }
OWNER="${OWNER:-00000000-0000-4000-8000-000000000001}"
EDITOR="${EDITOR:-}"
[[ "$OWNER" =~ ^[0-9a-f-]{36}$ ]] || { echo "OWNER invalid" >&2; exit 2; }
[[ "$EDITOR" =~ ^[0-9a-f-]{36}$ ]] || { echo "EDITOR=<uuid> lipsa (profil ne-owner, fara acces SMS, pe clona)" >&2; exit 2; }
cd "$(dirname "$0")/../.."
CONN=(-h "$H" -p "$P" -U "$U" -d "$D")
TMP="$(mktemp -d ./.clona_20261226b_flux.XXXXXX)"
APP_X=proba_smsp_x; APP_Y=proba_smsp_y; APP_ELIB=proba_smsp_elib; APP_CTL=proba_smsp_ctl
APPS="'$APP_X', '$APP_Y', '$APP_ELIB', '$APP_CTL'"
VERS_NOUA=provizoriu-2026-11-17; VERS_VECHE=provizoriu-2026-11-03
COD=TEST-SMSP-SINT; TEL_CONTACT=0700000999; AUT_NR=PROBA-CLONA-SMSP
RUN="$(date +%s)"
FID1="PROBA-SMSP-$RUN-1"; FID1B="PROBA-SMSP-$RUN-1b"; FID3="PROBA-SMSP-$RUN-3"; FID_V4="PROBA-SMSP-$RUN-V4"
# id-urile sintetice (fixe; garda 25 cere să nu existe)
PR=b26b0000-0000-4000-8000-000000000001
UAT_N=b26b0000-0000-4000-8000-000000000101; UAT_V1=b26b0000-0000-4000-8000-000000000102; UAT_V2=b26b0000-0000-4000-8000-000000000103
UAT_V3=b26b0000-0000-4000-8000-000000000104; UAT_V4=b26b0000-0000-4000-8000-000000000105
PA_N=b26b0000-0000-4000-8000-000000000201; PA_V1=b26b0000-0000-4000-8000-000000000202; PA_V2=b26b0000-0000-4000-8000-000000000203
PA_V3=b26b0000-0000-4000-8000-000000000204; PA_V4=b26b0000-0000-4000-8000-000000000205
D1=b26b0000-0000-4000-8000-000000000301; D2=b26b0000-0000-4000-8000-000000000302; D3=b26b0000-0000-4000-8000-000000000303
D4=b26b0000-0000-4000-8000-000000000304; D5=b26b0000-0000-4000-8000-000000000305; D6=b26b0000-0000-4000-8000-000000000306
D7=b26b0000-0000-4000-8000-000000000307; D8=b26b0000-0000-4000-8000-000000000308
CV="b26b0000-0000-4000-8000-0000000004"
LV1=b26b0000-0000-4000-8000-000000000501; LV2=b26b0000-0000-4000-8000-000000000502; LV3=b26b0000-0000-4000-8000-000000000503
LV4=b26b0000-0000-4000-8000-000000000504
MV1=b26b0000-0000-4000-8000-000000000601; MV2=b26b0000-0000-4000-8000-000000000602; MV3A=b26b0000-0000-4000-8000-000000000603
MV3B=b26b0000-0000-4000-8000-000000000604; MV4=b26b0000-0000-4000-8000-000000000605
DETS="'$D1','$D2','$D3','$D4','$D5','$D6','$D7','$D8'"
IDS="'$PR','$UAT_N','$UAT_V1','$UAT_V2','$UAT_V3','$UAT_V4','$PA_N','$PA_V1','$PA_V2','$PA_V3','$PA_V4',$DETS,'${CV}01','${CV}02','${CV}03','${CV}04','${CV}05','${CV}06','${CV}07','${CV}08'"
PIDS=(); TINTA_OK=0; SNAP=""; ESEC=0
# SQL-ul pleacă pe stdin / din fișiere, nu ca argument (-c): pe Windows argumentele cu diacritice ajung alterate (lecția 20261226a).
q() { printf '%s\n' "$1" | PGAPPNAME="$APP_CTL" "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -f - | tr -d '\r'; }
qf() { PGAPPNAME="$APP_CTL" "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$1" | tr -d '\r'; }
# o sesiune în fundal: $1 = application_name, $2 = fișierul SQL, $3 = jurnalul; PID-ul procesului în PIDS (wait la final, L25)
fundal() { PGAPPNAME="$1" "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$2" >"$3" 2>&1 & PIDS+=("$!"); ULTIM_PID=$!; }
# jurnalul unei sesiuni fără CR (psql.exe pe Windows poate scrie CRLF); prima linie „ETICHETA valoare” -> valoarea (gol dacă lipsește)
jurnal() { tr -d '\r' < "$1" 2>/dev/null || true; }
linie() { local l; l="$(jurnal "$2" | grep -m 1 -- "^$1 " || true)"; printf '%s' "${l#"$1 "}"; }
ok() { if [ "$1" = "$2" ]; then echo "  OK  $3"; else echo "  NU  $3: obtinut [$1], asteptat [$2]"; ESEC=1; fi; }
# (here-string, nu pipe: cu pipefail, grep -q care iese la prima potrivire ar putea da SIGPIPE scriitorului = NU fals)
okre() { if grep -Eq -- "$2" <<<"$1"; then echo "  OK  $3"; else echo "  NU  $3: [$(printf '%s' "$1" | head -c 400)] nu se potriveste cu /$2/"; ESEC=1; fi; }
gata_pid() { local p r=(); for p in "${PIDS[@]+"${PIDS[@]}"}"; do [ "$p" = "$1" ] || r+=("$p"); done; PIDS=("${r[@]+"${r[@]}"}"); }
# un apel ca rolul real (PostgREST / edge): ROLE + claims în ambele surse (auth.uid() citește întâi request.jwt.claim.sub);
# tipărește „OK <valoare>” sau „ERR <SQLSTATE> <mesaj>” (mesajul din prima linie ERROR, VERBOSITY verbose)
N_APEL=0
apel() {
  local rol="$1" uid="$2" sql="$3" claims sub f rc=0 out err
  N_APEL=$((N_APEL + 1)); f="$TMP/apel_$N_APEL.sql"
  if [ "$uid" = - ]; then claims="{\"role\":\"$rol\"}"; sub=""; else claims="{\"sub\":\"$uid\",\"role\":\"$rol\"}"; sub="$uid"; fi
  {
    printf '%s\n' '\set ON_ERROR_STOP 1' 'BEGIN;' "SET LOCAL ROLE $rol;"
    printf '%s\n' "SELECT set_config('request.jwt.claims', '$claims', true) AS _c, set_config('request.jwt.claim.sub', '$sub', true) AS _s \\gset"
    printf '%s\n' "$sql" 'COMMIT;'
  } >"$f"
  out="$(PGAPPNAME="$APP_CTL" "$PSQL" -X -q -At -v ON_ERROR_STOP=1 -v VERBOSITY=verbose "${CONN[@]}" -f "$f" 2>"$f.err" | tr -d '\r')" || rc=$?
  if [ "$rc" = 0 ]; then printf 'OK %s' "$out"; return 0; fi
  err="$(tr -d '\r' <"$f.err" | sed -nE '/ERROR:  [0-9A-Z]{5}: /{s/^.*ERROR:  ([0-9A-Z]{5}): (.*)$/\1 \2/p;q;}')"
  printf 'ERR %s' "${err:-psql_cod_$rc}"
}
# rezervarea ca workerul (service_role, p_apelant = OWNER = butonul „Trimite”): „motiv|id-uri (sortate, virgulă)|text|ramase”
rezerva() {
  apel service_role - "SELECT concat_ws('|', coalesce(r->>'motiv', '-'),
                         coalesce((SELECT string_agg(m->>'id', ',' ORDER BY m->>'id') FROM jsonb_array_elements(r->'mesaje') m), '-'),
                         coalesce(r->>'text', '-'), coalesce(r->>'ramase', '-'))
                         FROM (SELECT public.fn_sms_rezerva('$1', $2, 'simulator', '$OWNER') AS r) x;"
}
# previzualizarea ca aplicația (OWNER): „text|set_hash|versiune|sablon_aprobat|nr|lungime|lot_activ_uat|campanie_existenta”
previzualizeaza() {
  apel authenticated "$OWNER" "SELECT concat_ws('|', coalesce(j->>'text_final', '-'), coalesce(j->>'set_hash', '-'), coalesce(j->>'sablon_versiune', '-'),
                         coalesce(j->>'sablon_aprobat', '-'), coalesce(j->>'nr_destinatari', '-'), coalesce(j->>'lungime', '-'),
                         coalesce(j->>'lot_activ_uat', '-'), coalesce(j->>'campanie_existenta', '-'))
                         FROM (SELECT public.fn_sms_lot_redari_sablon_creeaza('$PR', '$1', NULL, NULL, true) AS j) x;"
}
creeaza() {
  apel authenticated "$OWNER" "SELECT public.fn_sms_lot_redari_sablon_creeaza('$PR', '$1', '$2', '$3', false) ->> 'lot_id';"
}
setari_versiune() { q "SELECT versiune FROM public.sms_setari WHERE id"; }
comutator_redari() {  # $1 = true / false; calea reală (owner), CAS pe versiunea curentă
  apel authenticated "$OWNER" "SELECT (r->>'redari_autorizat') FROM (SELECT public.fn_sms_redari_autorizare_seteaza($1, '$AUT_NR',
                                 (now() AT TIME ZONE 'Europe/Bucharest')::date, $(setari_versiune)) AS r) x;"
}

curatenie() {
  local rc=$? p v
  for p in "${PIDS[@]+"${PIDS[@]}"}"; do kill "$p" 2>/dev/null || true; done
  if [ "$TINTA_OK" != 1 ]; then
    # gărzile au refuzat înaintea oricărei scrieri: nimic de curățat pe clonă
    rm -rf "$TMP"
    [ "$rc" = 0 ] || echo "ESEC: proba fluxului SMS pe clona 20261226b (cod $rc)" >&2
    exit "$rc"
  fi
  q "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE application_name IN ($APPS) AND pid <> pg_backend_pid()" >/dev/null 2>&1 || true
  for p in "${PIDS[@]+"${PIDS[@]}"}"; do wait "$p" 2>/dev/null || true; done
  cat >"$TMP/curata.sql" <<SQL
\\set ON_ERROR_STOP 1
BEGIN;
ALTER TABLE public.sms_mesaje DISABLE TRIGGER USER; ALTER TABLE public.sms_loturi DISABLE TRIGGER USER; ALTER TABLE public.sms_setari DISABLE TRIGGER USER;
ALTER TABLE public.red_jurnal DISABLE TRIGGER USER; ALTER TABLE public.red_convocari DISABLE TRIGGER USER;
ALTER TABLE public.red_detinatori_contact DISABLE TRIGGER USER; ALTER TABLE public.red_detinatori_token DISABLE TRIGGER USER;
ALTER TABLE public.red_detinatori DISABLE TRIGGER USER; ALTER TABLE public.red_parcele DISABLE TRIGGER USER;
ALTER TABLE public.red_uat DISABLE TRIGGER USER; ALTER TABLE public.red_proiecte DISABLE TRIGGER USER;
-- loturile probei = toate loturile proiectului sintetic (FK: niciun alt lot nu îl poate referi); mesajele lor, apoi loturile
DELETE FROM public.sms_mesaje WHERE lot_id IN (SELECT id FROM public.sms_loturi WHERE proiect_id = '$PR');
DELETE FROM public.sms_loturi WHERE proiect_id = '$PR';
-- rândul de setări EXACT ca la început (toate coloanele, din copia to_jsonb luată înaintea oricărei schimbări)
DO \$r\$
DECLARE v_snap jsonb := \$snap\$$SNAP\$snap\$::jsonb; v_cols text;
BEGIN
  IF v_snap IS NULL OR jsonb_typeof(v_snap) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'curatenie: copia setarilor lipseste'; END IF;
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols FROM pg_attribute a
   WHERE a.attrelid = 'public.sms_setari'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'id';
  EXECUTE format('UPDATE public.sms_setari s SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.sms_setari, \$1) r) WHERE s.id',
                 v_cols, (SELECT string_agg('r.' || x, ', ') FROM unnest(string_to_array(v_cols, ', ')) x)) USING v_snap;
END \$r\$;
DELETE FROM public.red_jurnal WHERE inregistrare_id IN ($IDS);
DELETE FROM public.red_convocari WHERE detinator_id IN ($DETS);
DELETE FROM public.red_detinatori_contact WHERE detinator_id IN ($DETS);
DELETE FROM public.red_detinatori_token WHERE detinator_id IN ($DETS);
DELETE FROM public.red_detinatori WHERE id IN ($DETS);
DELETE FROM public.red_parcele WHERE id IN ($IDS) OR proiect_id = '$PR';
DELETE FROM public.red_uat WHERE id IN ($IDS) OR proiect_id = '$PR';
DELETE FROM public.red_proiecte WHERE id = '$PR';
ALTER TABLE public.red_proiecte ENABLE TRIGGER USER; ALTER TABLE public.red_uat ENABLE TRIGGER USER; ALTER TABLE public.red_parcele ENABLE TRIGGER USER;
ALTER TABLE public.red_detinatori ENABLE TRIGGER USER; ALTER TABLE public.red_detinatori_token ENABLE TRIGGER USER;
ALTER TABLE public.red_detinatori_contact ENABLE TRIGGER USER; ALTER TABLE public.red_convocari ENABLE TRIGGER USER;
ALTER TABLE public.red_jurnal ENABLE TRIGGER USER; ALTER TABLE public.sms_setari ENABLE TRIGGER USER;
ALTER TABLE public.sms_loturi ENABLE TRIGGER USER; ALTER TABLE public.sms_mesaje ENABLE TRIGGER USER;
-- verificarea ÎNAINTE de COMMIT: nimic sintetic rămas, setările = copia, triggerele USER reactivate; altfel ROLLBACK (nimic șters)
DO \$v\$ BEGIN
  IF EXISTS (SELECT 1 FROM public.sms_loturi WHERE proiect_id = '$PR')
     OR EXISTS (SELECT 1 FROM public.sms_mesaje WHERE destinatar_tip = 'detinator' AND destinatar_id IN ($DETS))
     OR EXISTS (SELECT 1 FROM public.red_jurnal WHERE inregistrare_id IN ($IDS))
     OR EXISTS (SELECT 1 FROM public.red_convocari WHERE id IN ($IDS) OR detinator_id IN ($DETS))
     OR EXISTS (SELECT 1 FROM public.red_detinatori_contact WHERE detinator_id IN ($DETS))
     OR EXISTS (SELECT 1 FROM public.red_detinatori_token WHERE detinator_id IN ($DETS))
     OR EXISTS (SELECT 1 FROM public.red_detinatori WHERE id IN ($IDS))
     OR EXISTS (SELECT 1 FROM public.red_parcele WHERE id IN ($IDS) OR proiect_id = '$PR')
     OR EXISTS (SELECT 1 FROM public.red_uat WHERE id IN ($IDS) OR proiect_id = '$PR')
     OR EXISTS (SELECT 1 FROM public.red_proiecte WHERE id = '$PR' OR cod = '$COD') THEN
    RAISE EXCEPTION 'curatenie: au ramas randuri sintetice dupa stergere';
  END IF;
  IF (SELECT to_jsonb(s) FROM public.sms_setari s WHERE s.id)
     IS DISTINCT FROM (SELECT to_jsonb(r) FROM jsonb_populate_record(NULL::public.sms_setari, \$snap\$$SNAP\$snap\$::jsonb) r) THEN
    RAISE EXCEPTION 'curatenie: randul sms_setari nu e cel de la inceput';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled = 'D'
              AND t.tgrelid IN ('public.sms_mesaje'::regclass, 'public.sms_loturi'::regclass, 'public.sms_setari'::regclass,
                                'public.red_jurnal'::regclass, 'public.red_convocari'::regclass, 'public.red_detinatori_contact'::regclass,
                                'public.red_detinatori_token'::regclass, 'public.red_detinatori'::regclass, 'public.red_parcele'::regclass,
                                'public.red_uat'::regclass, 'public.red_proiecte'::regclass)) THEN
    RAISE EXCEPTION 'curatenie: un trigger USER a ramas dezactivat';
  END IF;
END \$v\$;
COMMIT;
SQL
  local ok_cur=0
  if [ -z "$SNAP" ]; then
    echo "ATENTIE: copia setarilor SMS lipseste: curatenia nu porneste" >&2
  elif qf "$TMP/curata.sql" >"$TMP/curata.log" 2>&1; then
    # a doua verificare, după COMMIT, din altă sesiune (așteptat 0|0|0|0|0|0|0|0|0|t și 0 sesiuni)
    v="$(q "SELECT concat_ws('|', (SELECT count(*) FROM public.sms_loturi WHERE proiect_id = '$PR'),
                   (SELECT count(*) FROM public.sms_mesaje WHERE destinatar_tip = 'detinator' AND destinatar_id IN ($DETS)),
                   (SELECT count(*) FROM public.red_jurnal WHERE inregistrare_id IN ($IDS)),
                   (SELECT count(*) FROM public.red_convocari WHERE id IN ($IDS) OR detinator_id IN ($DETS)),
                   (SELECT count(*) FROM public.red_detinatori_contact WHERE detinator_id IN ($DETS)),
                   (SELECT count(*) FROM public.red_detinatori WHERE id IN ($IDS)),
                   (SELECT count(*) FROM public.red_parcele WHERE id IN ($IDS) OR proiect_id = '$PR'),
                   (SELECT count(*) FROM public.red_uat WHERE id IN ($IDS) OR proiect_id = '$PR'),
                   (SELECT count(*) FROM public.red_proiecte WHERE id = '$PR' OR cod = '$COD'),
                   ((SELECT to_jsonb(s) FROM public.sms_setari s WHERE s.id)
                      = (SELECT to_jsonb(r) FROM jsonb_populate_record(NULL::public.sms_setari, \$snap\$$SNAP\$snap\$::jsonb) r))::text)")" || v="eroare"
    # sesiunile probei: terminate mai sus; serverul le scoate în câteva momente (cel mult 10 s, apoi se numără)
    p="$(q "DO \$s\$ DECLARE t0 timestamptz := clock_timestamp(); BEGIN
              LOOP PERFORM pg_stat_clear_snapshot();
                EXIT WHEN NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name IN ($APPS) AND pid <> pg_backend_pid())
                       OR clock_timestamp() > t0 + interval '10 seconds';
                PERFORM pg_sleep(0.05); END LOOP; END \$s\$;
            SELECT count(*) FROM pg_stat_activity WHERE application_name IN ($APPS) AND pid <> pg_backend_pid();")" || p="eroare"
    if [ "$v" = "0|0|0|0|0|0|0|0|0|true" ] && [ "$p" = 0 ]; then
      ok_cur=1
      echo "curatenie: datele sintetice si loturile probei sterse, sms_setari readus exact; verificat dupa COMMIT din alta sesiune (0 randuri, 0 sesiuni)"
    else
      echo "ATENTIE: curatenia nu s-a verificat: [$v] (asteptat 0|0|0|0|0|0|0|0|0|true), sesiuni ale probei [$p] (asteptat 0)" >&2
    fi
  else
    echo "ATENTIE: tranzactia de curatenie a picat (ROLLBACK: nimic sters, setarile neatinse de ea):" >&2
    sed 's/^/     curata| /' "$TMP/curata.log" >&2
  fi
  if [ "$ok_cur" != 1 ]; then
    echo "ATENTIE: de curatat manual pe clona: proiectul $PR ($COD) cu loturile lui SMS, id-urile b26b0000-..., si randul sms_setari (copia: $TMP/setari_initial.json)" >&2
    echo "ATENTIE: dosarul temporar al probei a ramas pentru diagnostic: $TMP (doar date sintetice)" >&2
    echo "ESEC: curatenia probei a picat (cod 26; verificarile de mai sus raman valabile asa cum au fost tiparite)" >&2
    exit 26
  fi
  rm -rf "$TMP"
  if [ "$rc" = 0 ]; then echo "PASS: proba fluxului SMS pe clona 20261226b (F1-F7 OK, curatenia verificata)"
  else echo "ESEC: proba fluxului SMS pe clona 20261226b (cod $rc; vezi NU mai sus)" >&2; fi
  exit "$rc"
}
trap curatenie EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ── gărzile ──
REAL="$(q "SELECT system_identifier FROM pg_control_system()")"
[ "$REAL" = "$SISTEM" ] || { echo "REFUZ: system_identifier al bazei ($REAL) <> --sistem ($SISTEM)" >&2; exit 22; }
G23="$(q "SELECT concat_ws(',',
    CASE WHEN to_regprocedure('public.fn_red_optiune_retrasa(text)') IS NULL THEN 'A_neaplicata' END,
    CASE WHEN (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.fn_sms_redari_sablon_model()'))
              IS DISTINCT FROM '13e27c6f3e4202c36259948a92ee19ac' THEN 'B_model' END,
    CASE WHEN (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.fn_sms_redari_sablon_versiune()'))
              IS DISTINCT FROM '46f62d7d8964fed49465a4e96edc9c4a' THEN 'B_versiune' END,
    CASE WHEN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.fn_sms_redari_sablon_versiune()')) NOT LIKE '%''$VERS_NOUA''%'
         THEN 'B_valoare' END,
    (SELECT string_agg(a.s, ',') FROM (VALUES
       ('public.fn_sms_loturi_reguli()', '88991164518c47220941896f7d53deb6'), ('public.fn_sms_mesaje_reguli()', '380000981deb53acfa21dbf26569066c'),
       ('public.fn_sms_rezerva(uuid,integer,text,uuid)', 'b565d0c4c1ff62320c14ae384ed6bb94'),
       ('public.fn_sms_lot_aproba(uuid,integer)', '1f14c19429a94c1146557e41db01e190'),
       ('public.fn_sms_rezultat(uuid,boolean,text,text,text)', 'b641f8c12d851541be4e0fc300f44dc3')) a(s, m)
      WHERE (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p WHERE p.oid = to_regprocedure(a.s)) IS DISTINCT FROM a.m),
    (SELECT string_agg(a.s, ',') FROM unnest(ARRAY['public.fn_sms_lot_redari_sablon_creeaza(uuid,uuid,text,text,boolean)',
       'public.fn_sms_lot_anuleaza(uuid,text)', 'public.fn_sms_lot_destinatari(uuid)', 'public.fn_sms_redari_autorizare_seteaza(boolean,text,date,integer)',
       'public.fn_sms_setari_salveaza(boolean,integer,integer,integer)', 'public.fn_sms_redari_persoane(uuid,uuid)',
       'public.fn_sms_consum_la(timestamptz)', 'public.fn_sms_nivel_cont(uuid)']) a(s) WHERE to_regprocedure(a.s) IS NULL),
    (SELECT string_agg(t.n, ',') FROM unnest(ARRAY['sms_setari', 'sms_loturi', 'sms_mesaje', 'sms_optout', 'red_proiecte', 'red_uat', 'red_parcele',
       'red_detinatori', 'red_detinatori_contact', 'red_detinatori_token', 'red_convocari', 'red_jurnal']) t(n) WHERE to_regclass('public.' || t.n) IS NULL),
    (SELECT string_agg(t.n, ',') FROM unnest(ARRAY['trg_sms_setari_reguli', 'trg_sms_loturi_reguli', 'trg_sms_mesaje_reguli']) t(n)
      WHERE NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgname = t.n AND NOT g.tgisinternal AND g.tgenabled = 'O'
                          AND g.tgrelid = to_regclass('public.' || replace(replace(t.n, 'trg_', ''), '_reguli', '')))),
    -- drepturile workerului pe oid (o funcție lipsă = NULL -> refuz, fără eroare de parsare)
    (SELECT string_agg(a.s, ',') FROM unnest(ARRAY['public.fn_sms_rezerva(uuid,integer,text,uuid)', 'public.fn_sms_rezultat(uuid,boolean,text,text,text)']) a(s)
      WHERE coalesce(has_function_privilege('service_role', to_regprocedure(a.s), 'EXECUTE')
                     AND NOT has_function_privilege('authenticated', to_regprocedure(a.s), 'EXECUTE')
                     AND NOT has_function_privilege('anon', to_regprocedure(a.s), 'EXECUTE'), false) IS NOT TRUE))")"
[ -z "$G23" ] || { echo "REFUZ: clona nu e in starea ceruta (A + B aplicate, lantul SMS din repo): $G23" >&2; exit 23; }
echo "istoricul migrarilor pe clona (informativ): $(q "SELECT coalesce(string_agg(version || ' ' || name, '; ' ORDER BY version), '-') FROM supabase_migrations.schema_migrations
                                                        WHERE version IN ('20261226120000', '20261226120001', '20261226120100', '20261226120101')")"
[ "$(q "SELECT (EXISTS (SELECT 1 FROM public.profiles WHERE id = '$OWNER' AND is_owner IS TRUE)
          AND EXISTS (SELECT 1 FROM public.profiles WHERE id = '$EDITOR' AND is_owner IS NOT TRUE)
          AND public.fn_sms_nivel_cont('$EDITOR') IS NULL AND public.fn_sms_nivel_cont('$OWNER') = 'owner')::text")" = true ] \
  || { echo "REFUZ: OWNER ($OWNER, is_owner) sau EDITOR ($EDITOR, ne-owner, FARA nivel SMS: fara user_module_access module = sms) nepotrivite pe clona" >&2; exit 24; }
G27="$(q "SELECT concat_ws(',',
    CASE WHEN (now() AT TIME ZONE 'Europe/Bucharest')::time NOT BETWEEN '08:00' AND '19:45' THEN 'ora_' || to_char(now() AT TIME ZONE 'Europe/Bucharest', 'HH24:MI') END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net')) THEN 'pg_cron_sau_pg_net' END,
    CASE WHEN (SELECT count(*) FROM public.sms_setari) <> 1 THEN 'sms_setari' END,
    CASE WHEN (SELECT c.zi + 5 > s.plafon_zi OR c.luna + 5 > s.plafon_luna FROM public.fn_sms_consum_la(clock_timestamp()) c, public.sms_setari s WHERE s.id)
         THEN 'plafon' END)")"
[ -z "$G27" ] || { echo "REFUZ: mediul probei: $G27 (rulati intre 08:00 si 19:45 ora Romaniei; clona fara pg_cron / pg_net; un rand sms_setari; loc de 5 SMS sub plafoane)" >&2; exit 27; }
# copia INTEGRALĂ a setărilor, ÎNAINTEA oricărei schimbări (curățenia o pune la loc exact)
SNAP="$(q "SELECT to_jsonb(s)::text FROM public.sms_setari s WHERE s.id")"
[[ "$SNAP" == \{* ]] && [[ "$SNAP" != *'$snap$'* ]] || { echo "copia setarilor SMS nu s-a putut lua" >&2; SNAP=""; exit 27; }
printf '%s\n' "$SNAP" >"$TMP/setari_initial.json"
TINTA_OK=1
[ "$(q "SELECT (NOT EXISTS (SELECT 1 FROM public.red_proiecte WHERE id = '$PR' OR cod = '$COD')
          AND NOT EXISTS (SELECT 1 FROM public.red_detinatori WHERE id IN ($DETS))
          AND NOT EXISTS (SELECT 1 FROM public.sms_loturi WHERE proiect_id = '$PR')
          AND NOT EXISTS (SELECT 1 FROM public.sms_mesaje WHERE destinatar_tip = 'detinator' AND destinatar_id IN ($DETS)))::text")" = true ] \
  || { TINTA_OK=0; echo "REFUZ: resturi ale unei rulari anterioare (id-uri b26b0000-... / $COD): curatati intai" >&2; exit 25; }
echo "setarile SMS la pornire (copia completa in dosarul temporar): $(q "SELECT 'redari_autorizat=' || redari_autorizat::text || ' kill_switch=' || kill_switch::text || ' plafon_zi=' || plafon_zi || ' versiune=' || versiune FROM public.sms_setari WHERE id")"

# ── S0 datele sintetice (postgres, triggerele REALE active, comise) ──
echo "S0 datele sintetice"
cat >"$TMP/s0.sql" <<SQL
\\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO public.red_proiecte (id, cod, denumire, contact_telefon, contact_email)
VALUES ('$PR', '$COD', 'Proba SMS predare (sintetic)', '$TEL_CONTACT', 'proba-sms-predare@exemplu.invalid');
INSERT INTO public.red_uat (id, proiect_id, nume, uat3, sesiune_zi1, program_zi1)
SELECT u.id, '$PR', u.nume, u.uat3, (now() AT TIME ZONE 'Europe/Bucharest')::date + 10, '09:00-15:00'
  FROM (VALUES ('$UAT_N'::uuid, 'Sinteticeni', 'ZSA'), ('$UAT_V1'::uuid, 'Vechieni Unu', 'ZSB'), ('$UAT_V2'::uuid, 'Vechieni Doi', 'ZSC'),
               ('$UAT_V3'::uuid, 'Vechieni Trei', 'ZSD'), ('$UAT_V4'::uuid, 'Vechieni Patru', 'ZSE')) u(id, nume, uat3);
INSERT INTO public.red_parcele (id, proiect_id, uat_id, id_parcela) VALUES
  ('$PA_N', '$PR', '$UAT_N', 'ZSA-0001'), ('$PA_V1', '$PR', '$UAT_V1', 'ZSB-0001'), ('$PA_V2', '$PR', '$UAT_V2', 'ZSC-0001'),
  ('$PA_V3', '$PR', '$UAT_V3', 'ZSD-0001'), ('$PA_V4', '$PR', '$UAT_V4', 'ZSE-0001');
INSERT INTO public.red_detinatori (id, parcela_id, nume, nume_normalizat, calitate)
SELECT d.id, d.pa, 'Persoana Sintetica ' || d.n, 'PERSOANA SINTETICA ' || upper(d.n), 'proprietar'
  FROM (VALUES ('$D1'::uuid, '$PA_N'::uuid, 'Unu'), ('$D2'::uuid, '$PA_N'::uuid, 'Doi'), ('$D3'::uuid, '$PA_N'::uuid, 'Trei'),
               ('$D4'::uuid, '$PA_V1'::uuid, 'Patru'), ('$D5'::uuid, '$PA_V2'::uuid, 'Cinci'), ('$D6'::uuid, '$PA_V3'::uuid, 'Sase'),
               ('$D7'::uuid, '$PA_V3'::uuid, 'Sapte'), ('$D8'::uuid, '$PA_V4'::uuid, 'Opt')) d(id, pa, n);
INSERT INTO public.red_detinatori_contact (detinator_id, telefon, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal, adresa_cunoscuta)
SELECT d.id, '07000009' || lpad(d.k::text, 2, '0'), 'Strada Fictiva nr. ' || d.k, 'Sat Fictiv', 'Comuna Fictiva', 'Prahova', '1000' || lpad(d.k::text, 2, '0'), true
  FROM (VALUES ('$D1'::uuid, 1), ('$D2'::uuid, 2), ('$D3'::uuid, 3), ('$D4'::uuid, 4), ('$D5'::uuid, 5), ('$D6'::uuid, 6), ('$D7'::uuid, 7), ('$D8'::uuid, 8)) d(id, k);
-- convocările active (canal telefon): auth.uid() = OWNER DOAR pentru această instrucțiune (claim.sub, fără claims), ca fixture-ul FAN
SELECT set_config('request.jwt.claim.sub', '$OWNER', true) IS NOT NULL AS _ok \\gset
INSERT INTO public.red_convocari (id, detinator_id, canal, nr_document, calitate_document)
SELECT ('${CV}' || lpad(c.k::text, 2, '0'))::uuid, c.d, 'telefon', 'TEST-SMSP-SINT-' || c.k, 'proprietar'
  FROM (VALUES ('$D1'::uuid, 1), ('$D2'::uuid, 2), ('$D3'::uuid, 3), ('$D4'::uuid, 4), ('$D5'::uuid, 5), ('$D6'::uuid, 6), ('$D7'::uuid, 7), ('$D8'::uuid, 8)) c(d, k);
SELECT set_config('request.jwt.claim.sub', '', true) IS NOT NULL AS _ok \\gset
COMMIT;
SQL
qf "$TMP/s0.sql" >/dev/null
ZI_ISO="$(q "SELECT to_char(sesiune_zi1, 'YYYY-MM-DD') FROM public.red_uat WHERE id = '$UAT_N'")"
[[ "$ZI_ISO" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "  NU  S0 ziua sesiunii [$ZI_ISO]"; ESEC=1; exit 1; }
ZI_TXT="${ZI_ISO:8:2}.${ZI_ISO:5:2}"
# textele scrise de mână (modelul din documentul B; ASCII = GSM-7 de bază, deci lungimea GSM-7 = numărul de caractere)
text_sms() { printf 'Gazpet pt Transgaz: sesiune %s teren la Primaria %s, %s ora 09:00. Raspuns si online, cu QR-ul din scrisoare. Tel %s' "$1" "$2" "$ZI_TXT" "$TEL_CONTACT"; }
TXT_NOU="$(text_sms predare Sinteticeni)"; TXT_VECHI_N="$(text_sms redare Sinteticeni)"
ok "$(q "SELECT count(*) || '/' || count(*) FILTER (WHERE public.fn_sms_tel_normalizat(k.telefon) IS NOT NULL)
           FROM public.red_detinatori_contact k WHERE k.detinator_id IN ($DETS)")|$(q "SELECT count(*) FROM public.red_convocari WHERE detinator_id IN ($DETS) AND stare = 'activ' AND sters_la IS NULL")" \
   "8/8|8" "S0 8 detinatori cu mobil sintetic valid si convocare activa"

# ── F1a comutatorul Redări OPRIT (starea producției): crearea refuzată ──
echo "F1a comutatorul Redari oprit: crearea refuzata"
if [ "$(q "SELECT redari_autorizat::text FROM public.sms_setari WHERE id")" = true ]; then
  ok "$(comutator_redari false)" "OK false" "F1a comutatorul era pornit pe clona: oprit pe calea reala (owner)"
fi
okre "$(previzualizeaza "$UAT_N")" '^ERR 42501 sms redari: blocat - asteapta autorizarea scrisa Transgaz' "F1a previzualizarea cu comutatorul oprit -> 42501 (blocat)"
ok "$(q "SELECT count(*) FROM public.sms_loturi WHERE proiect_id = '$PR'")" 0 "F1a niciun lot creat"

# ── F1 comutatoarele pornite pe calea reală; previzualizarea + crearea cu textul / versiunea NOI ──
echo "F1 crearea lotului din sablon (OWNER, calea aplicatiei)"
if [ "$(q "SELECT kill_switch::text FROM public.sms_setari WHERE id")" = true ]; then
  ok "$(apel authenticated "$OWNER" "SELECT (r->>'kill_switch') FROM (SELECT public.fn_sms_setari_salveaza(false, s.plafon_zi, s.plafon_luna, s.versiune) AS r
                                       FROM public.sms_setari s WHERE s.id) x;")" "OK false" "F1 kill-switch-ul oprit pe calea reala (owner)"
fi
ok "$(comutator_redari true)" "OK true" "F1 comutatorul Redari pornit pe calea reala (owner, nr. $AUT_NR, data de azi) - doar pe clona"
PV="$(previzualizeaza "$UAT_N")"
IFS='|' read -r PV_TEXT PV_HASH PV_VERS PV_APROBAT PV_NR PV_LUNG PV_ACTIV PV_CAMP <<<"${PV#OK }"
okre "$PV" '^OK ' "F1 previzualizarea reuseste"
ok "$PV_TEXT" "$TXT_NOU" "F1 previzualizarea: textul nou (scris de mana)"
ok "$PV_VERS|$PV_APROBAT|$PV_NR|$PV_LUNG|$PV_ACTIV|$PV_CAMP" "$VERS_NOUA|true|3|${#TXT_NOU}|-|-" "F1 previzualizarea: versiunea, sablon_aprobat, 3 destinatari, lungimea GSM-7, UAT liber"
okre "$PV_HASH" '^[0-9a-f]{32}$' "F1 previzualizarea fixeaza lista (set_hash md5)"

# ── F2 „aplicația nepublicată”: textul cu „redare” ──
echo "F2 crearea cu modelul VECHI (textul cu redare)"
okre "$(creeaza "$UAT_N" "$TXT_VECHI_N" "$PV_HASH")" '^ERR 40001 sms redari: textul s-a schimbat fata de cel afisat' "F2 textul vechi + set_hash valid -> 40001 (textul afisat difera de cel recalculat)"
ok "$(q "SELECT count(*) FROM public.sms_loturi WHERE proiect_id = '$PR'")" 0 "F2 niciun lot creat"

CR="$(creeaza "$UAT_N" "$PV_TEXT" "$PV_HASH")"
okre "$CR" '^OK [0-9a-f-]{36}$' "F1 crearea cu textul afisat + set_hash -> lot nou"
LOT_N="${CR#OK }"
[[ "$LOT_N" =~ ^[0-9a-f-]{36}$ ]] || { echo "crearea lotului a picat: restul pasilor nu au sens" >&2; ESEC=1; exit 1; }
echo "$LOT_N lotul nou (F1)" >>"$TMP/loturi.txt"
ok "$(q "SELECT concat_ws('|', l.stare, l.versiune, l.nr_destinatari, l.filtru->>'sablon', l.filtru->>'sablon_versiune', l.filtru->>'zi', l.filtru->>'ora',
                         coalesce(l.creat_nivel, '-'), (l.creat_de = '$OWNER')::text, (position('sesiune predare teren' IN l.text) > 0)::text, v.segmente, v.lungime)
           FROM public.sms_loturi l CROSS JOIN LATERAL public.fn_sms_text_verifica(l.text) v WHERE l.id = '$LOT_N'")" \
   "draft|1|3|redari_v1|$VERS_NOUA|$ZI_ISO|09:00|owner|true|true|1|${#TXT_NOU}" "F1 lotul: draft v1, 3 destinatari, versiunea noua, sesiunea, creat de OWNER, predare, 1 segment"
ok "$(q "SELECT text FROM public.sms_loturi WHERE id = '$LOT_N'")" "$TXT_NOU" "F1 textul lotului = textul nou scris de mana"
ok "$(q "SELECT string_agg(telefon || '>' || CASE destinatar_id WHEN '$D1' THEN 'D1' WHEN '$D2' THEN 'D2' WHEN '$D3' THEN 'D3' ELSE 'ALT' END || ':' || stare, ' ' ORDER BY telefon)
           FROM public.sms_mesaje WHERE lot_id = '$LOT_N'")" \
   "+40700000901>D1:in_coada +40700000902>D2:in_coada +40700000903>D3:in_coada" "F1 mesajele: cate unul pe persoana, in_coada"

# ── F3 aprobarea ──
echo "F3 aprobarea"
okre "$(apel anon - "SELECT public.fn_sms_lot_aproba('$LOT_N', 1) ->> 'stare';")" '^ERR 42501 permission denied for function fn_sms_lot_aproba' "F3 anon -> 42501 (fara drept de apel)"
okre "$(apel authenticated "$EDITOR" "SELECT public.fn_sms_lot_aproba('$LOT_N', 1) ->> 'stare';")" '^ERR 42501 sms: nu ai acces la modulul SMS' "F3 EDITOR fara nivel SMS -> 42501"
okre "$(apel authenticated "$OWNER" "SELECT public.fn_sms_lot_aproba('$LOT_N', 7) ->> 'stare';")" '^ERR 40001 sms: lotul s-a schimbat de la previzualizare' "F3 OWNER cu versiunea gresita -> 40001"
ok "$(q "SELECT stare || '|' || versiune FROM public.sms_loturi WHERE id = '$LOT_N'")" "draft|1" "F3 dupa refuzuri lotul ramane draft v1"
ok "$(apel authenticated "$OWNER" "SELECT concat_ws('|', r->>'stare', r->>'versiune', r->>'aprobat_nivel', r->>'aprobat_autorizare_nr') FROM (SELECT public.fn_sms_lot_aproba('$LOT_N', 1) AS r) x;")" \
   "OK aprobat|2|owner|$AUT_NR" "F3 OWNER cu versiunea afisata -> aprobat v2 (nivel owner, autorizarea comutatorului)"

# ── F4a comutatorul OPRIT: rezervarea refuzată ──
echo "F4a rezervarea cu comutatorul Redari oprit"
ok "$(comutator_redari false)" "OK false" "F4a comutatorul Redari oprit pe calea reala (owner)"
ok "$(rezerva "$LOT_N" 5)" "OK redari_neautorizat|-|-|-" "F4a rezervarea (service_role, apelant OWNER) -> redari_neautorizat, 0 mesaje"
ok "$(q "SELECT l.stare || '|' || l.versiune || '|' || (SELECT count(*) FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.rezervat_la IS NOT NULL) FROM public.sms_loturi l WHERE l.id = '$LOT_N'")" \
   "aprobat|2|0" "F4a nimic rezervat, lotul neschimbat"
okre "$(apel authenticated "$OWNER" "SELECT public.fn_sms_rezerva('$LOT_N', 5, 'simulator', '$OWNER') ->> 'motiv';")" '^ERR 42501 permission denied for function fn_sms_rezerva' "F4a authenticated (OWNER) pe fn_sms_rezerva -> 42501 (doar service_role)"

# ── F4b comutatorul pornit; două rezervări CONCURENTE ──
echo "F4b doua rezervari concurente (X tine tranzactia, Y blocata de X)"
ok "$(comutator_redari true)" "OK true" "F4b comutatorul Redari pornit din nou pe calea reala (owner)"
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
    for f in x y elib; do if [ -f "$TMP/$f.log" ]; then sed "s/^/     $f| /" "$TMP/$f.log"; fi; done
    exit 1
  fi
}
# sesiunea de rezervare (ca workerul: service_role, apelant OWNER, p_max = 1); $1 = eticheta, $2 = application_name, $3 = 1 dacă așteaptă eliberarea
sesiune_rezerva() {
  cat <<SQL
\\set ON_ERROR_STOP 1
SET application_name = '$2';
SET statement_timeout = '330s';
BEGIN;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) AS _c, set_config('request.jwt.claim.sub', '', true) AS _s \\gset
SELECT public.fn_sms_rezerva('$LOT_N', 1, 'simulator', '$OWNER')::text AS r \\gset
SELECT '$1_MOTIV ' || coalesce(:'r'::jsonb->>'motiv', '-');
SELECT '$1_IDS ' || coalesce((SELECT string_agg(m->>'id', ',' ORDER BY m->>'id') FROM jsonb_array_elements(:'r'::jsonb->'mesaje') m), '-');
SELECT '$1_TEXT ' || coalesce(:'r'::jsonb->>'text', '-');
SELECT '$1_RAMASE ' || coalesce(:'r'::jsonb->>'ramase', '-');
RESET ROLE;
SQL
  if [ "$3" = 1 ]; then
    cat <<SQL
-- tranzacția rămâne DESCHISĂ (rândul de setări, lotul și mesajul rezervat blocate) până la eliberarea explicită ($APP_ELIB)
DO \$x\$ /* X_ASTEAPTA_ELIBERAREA */ DECLARE t0 timestamptz := clock_timestamp(); BEGIN
  LOOP
    PERFORM pg_stat_clear_snapshot();
    EXIT WHEN EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = '$APP_ELIB' AND pid <> pg_backend_pid());
    IF clock_timestamp() > t0 + interval '300 seconds' THEN RAISE EXCEPTION 'X_ASTEAPTA_ELIBERAREA: eliberarea nu a venit in 300 s'; END IF;
    PERFORM pg_sleep(0.005);
  END LOOP; END \$x\$;
SQL
  fi
  printf '%s\n' 'COMMIT;' "SELECT '$1_COMIS';"
}
sesiune_rezerva X "$APP_X" 1 >"$TMP/x.sql"
sesiune_rezerva Y "$APP_Y" 0 >"$TMP/y.sql"
fundal "$APP_X" "$TMP/x.sql" "$TMP/x.log"; PID_X=$ULTIM_PID
asteapta "X (rezervarea facuta, tranzactia deschisa, asteapta eliberarea)" \
  "EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = '$APP_X' AND state = 'active' AND position('X_ASTEAPTA_ELIBERAREA' IN query) > 0)"
X_PID="$(q "SELECT pid FROM pg_stat_activity WHERE application_name = '$APP_X'")"
[[ "$X_PID" =~ ^[0-9]+$ ]] || { echo "  NU  PID-ul lui X nu e unic: [$X_PID]"; ESEC=1; exit 1; }
fundal "$APP_Y" "$TMP/y.sql" "$TMP/y.log"; PID_Y=$ULTIM_PID
asteapta "Y blocata de X in fn_sms_rezerva" \
  "EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.application_name = '$APP_Y' AND a.wait_event_type = 'Lock'
             AND position('fn_sms_rezerva' IN a.query) > 0 AND $X_PID = ANY (pg_blocking_pids(a.pid)))"
echo "  OK  F4b Y asteapta in fn_sms_rezerva, blocata de X (pg_blocking_pids(Y) contine $X_PID; lock: $(q "SELECT coalesce(string_agg(l.locktype || coalesce(':' || l.relation::regclass::text, '') || ':' || l.mode, ', '), '-')
                                                    FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = '$APP_Y' AND NOT l.granted"))"
ok "$(linie Y_MOTIV "$TMP/y.log")" "" "F4b Y nu a primit nimic cat X tine tranzactia"
cat >"$TMP/elib.sql" <<SQL
\\set ON_ERROR_STOP 1
SET application_name = '$APP_ELIB';
SET statement_timeout = '90s';
DO \$e\$ DECLARE t0 timestamptz := clock_timestamp(); BEGIN
  LOOP
    PERFORM pg_stat_clear_snapshot();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = $X_PID AND application_name = '$APP_X');
    IF clock_timestamp() > t0 + interval '60 seconds' THEN RAISE EXCEPTION 'eliberarea: X (pid %) nu s-a incheiat in 60 s', $X_PID; END IF;
    PERFORM pg_sleep(0.005);
  END LOOP; END \$e\$;
SQL
fundal "$APP_ELIB" "$TMP/elib.sql" "$TMP/elib.log"; PID_E=$ULTIM_PID
RC_X=0; wait "$PID_X" || RC_X=$?; gata_pid "$PID_X"
RC_E=0; wait "$PID_E" || RC_E=$?; gata_pid "$PID_E"
RC_Y=0; wait "$PID_Y" || RC_Y=$?; gata_pid "$PID_Y"
ok "$RC_X|$RC_E|$RC_Y" "0|0|0" "F4b sesiunile X, eliberarea, Y: cod 0"
[ "$RC_X" = 0 ] || sed 's/^/     x| /' "$TMP/x.log"
[ "$RC_Y" = 0 ] || sed 's/^/     y| /' "$TMP/y.log"
okre "$(jurnal "$TMP/x.log")" '^X_COMIS$' "F4b X comisa"
M_X="$(linie X_IDS "$TMP/x.log")"; M_Y="$(linie Y_IDS "$TMP/y.log")"
okre "$M_X" '^[0-9a-f-]{36}$' "F4b X a rezervat exact un mesaj"
okre "$M_Y" '^[0-9a-f-]{36}$' "F4b Y a rezervat exact un mesaj"
[ "$M_X" != "$M_Y" ] && echo "  OK  F4b X si Y au mesaje DIFERITE (nicio dublare)" || { echo "  NU  F4b X si Y au acelasi mesaj [$M_X]"; ESEC=1; }
ok "$(linie X_MOTIV "$TMP/x.log")|$(linie Y_MOTIV "$TMP/y.log")" "ok|ok" "F4b motivul ambelor rezervari: ok"
ok "$(linie X_TEXT "$TMP/x.log")" "$TXT_NOU" "F4b X: textul trimis = textul nou (sesiune predare teren)"
ok "$(linie Y_TEXT "$TMP/y.log")" "$TXT_NOU" "F4b Y: textul trimis = textul nou"
ok "$(linie X_RAMASE "$TMP/x.log")|$(linie Y_RAMASE "$TMP/y.log")" "2|1" "F4b ramase: X 2, Y 1 (Y a vazut rezervarea comisa a lui X)"
ok "$(q "SELECT l.stare || '|' || count(*) FILTER (WHERE m.stare = 'necunoscut') || '|' || count(*) FILTER (WHERE m.stare = 'in_coada') || '|'
                || count(*) FILTER (WHERE m.rezervat_la IS NOT NULL) || '|'
                || ((SELECT rezervat_la FROM public.sms_mesaje WHERE id = '$M_Y') > (SELECT rezervat_la FROM public.sms_mesaje WHERE id = '$M_X'))::text
           FROM public.sms_loturi l JOIN public.sms_mesaje m ON m.lot_id = l.id WHERE l.id = '$LOT_N' GROUP BY l.stare")" \
   "in_trimitere|2|1|2|true" "F4b in BD: lotul in_trimitere, 2 necunoscut + 1 in_coada, Y rezervat dupa X"

# ── F5 pașii de BD ai workerului: rezultatul, rezervarea repetată ──
echo "F5 rezultatul trimiterii (fn_sms_rezultat, service_role) si rezervarea repetata"
ok "$(apel service_role - "SELECT public.fn_sms_rezultat('$M_X', true, '$FID1', NULL, NULL);")" "OK trimis" "F5 mesajul lui X -> trimis (id de furnizor sintetic)"
ok "$(apel service_role - "SELECT public.fn_sms_rezultat('$M_Y', false, NULL, 'timeout_proba', 'necunoscut');")" "OK necunoscut" "F5 mesajul lui Y -> necunoscut (clasa necunoscut)"
okre "$(apel authenticated "$OWNER" "SELECT public.fn_sms_rezultat('$M_Y', false, NULL, 'x', 'permanent');")" '^ERR 42501 permission denied for function fn_sms_rezultat' "F5 authenticated pe fn_sms_rezultat -> 42501 (doar service_role)"
Y_INAINTE="$(q "SELECT stare || '|' || versiune || '|' || rezervat_la::text || '|' || coalesce(cod_eroare, '-') FROM public.sms_mesaje WHERE id = '$M_Y'")"
M_3="$(q "SELECT id FROM public.sms_mesaje WHERE lot_id = '$LOT_N' AND id NOT IN ('$M_X', '$M_Y')")"
okre "$M_3" '^[0-9a-f-]{36}$' "F5 al treilea mesaj (cel inca in coada)"
ok "$(rezerva "$LOT_N" 5)" "OK ok|$M_3|$TXT_NOU|0" "F5 rezervarea repetata -> DOAR al treilea mesaj (necunoscutul NU se reia), textul nou, ramase 0"
ok "$(apel service_role - "SELECT public.fn_sms_rezultat('$M_3', true, '$FID3', NULL, NULL);")" "OK trimis" "F5 al treilea -> trimis"
ok "$(rezerva "$LOT_N" 5)" "OK lot_coada_golita|-|-|-" "F5 inca o rezervare -> lot_coada_golita, 0 mesaje"
ok "$(q "SELECT stare || '|' || versiune || '|' || rezervat_la::text || '|' || coalesce(cod_eroare, '-') FROM public.sms_mesaje WHERE id = '$M_Y'")" "$Y_INAINTE" \
   "F5 mesajul necunoscut: aceeasi stare / versiune / rezervat_la (nu s-a retrimis) [$Y_INAINTE]"
ok "$(apel service_role - "SELECT public.fn_sms_rezultat('$M_X', true, '$FID1B', NULL, NULL);")" "OK ignorat" "F5 rezultat repetat pe mesajul deja trimis -> ignorat"
ok "$(q "SELECT furnizor_id FROM public.sms_mesaje WHERE id = '$M_X'")" "$FID1" "F5 id-ul de furnizor al mesajului trimis neschimbat"
ok "$(apel authenticated "$OWNER" "SELECT concat_ws('|', r->>'stare', (SELECT string_agg(d->>'stare', ',' ORDER BY d->>'stare') FROM jsonb_array_elements(r->'destinatari') d))
                                 FROM (SELECT public.fn_sms_lot_destinatari('$LOT_N') AS r) x;")" \
   "OK coada_golita|necunoscut,trimis,trimis" "F5 starea finala vazuta de aplicatie: lotul coada_golita, 2 trimis + 1 necunoscut"
PV2="$(previzualizeaza "$UAT_N")"
ok "$(cut -d'|' -f7 <<<"${PV2#OK }")" "$LOT_N" "F5 lotul coada_golita cu un necunoscut ocupa UAT-ul (previzualizarea: lot_activ_uat)"
okre "$(creeaza "$UAT_N" "$PV_TEXT" "$PV_HASH")" '^ERR 23505 sms redari: UAT-ul are deja un lot activ' "F5 crearea altui lot pe UAT -> 23505 (lot activ)"
okre "$(apel authenticated "$OWNER" "SELECT public.fn_sms_lot_anuleaza('$LOT_N', 'proba') ->> 'stare';")" '^ERR 23514 sms: lotul e deja inchis \(coada_golita\)' "F5 anularea lotului coada_golita -> 23514 (documentul B 4)"

# ── F6 loturi create ÎNAINTE de B ──
echo "F6 loturi cu versiunea veche ($VERS_VECHE, textul cu redare)"
TXT_V1="$(text_sms redare 'Vechieni Unu')"; TXT_V2="$(text_sms redare 'Vechieni Doi')"
TXT_V3="$(text_sms redare 'Vechieni Trei')"; TXT_V4="$(text_sms redare 'Vechieni Patru')"
cat >"$TMP/f6.sql" <<SQL
\\set ON_ERROR_STOP 1
BEGIN;
-- (1) loturile + mesajele, ca le-ar fi scris RPC-ul înainte de B: INSERT cu triggerele REALE active, auth.uid() = OWNER (creat_de / creat_nivel)
SELECT set_config('request.jwt.claim.sub', '$OWNER', true) IS NOT NULL AS _ok \\gset
INSERT INTO public.sms_loturi (id, categorie, text, proiect_id, uat_id, filtru, nr_destinatari, segmente, cost_estimat_eur, excluse_optout, excluse_fara_mobil)
SELECT v.id, 'redari', v.txt, '$PR', v.uat,
       jsonb_build_object('uat_id', v.uat, 'sablon', 'redari_v1', 'sablon_versiune', '$VERS_VECHE', 'zi', '$ZI_ISO', 'zi_nr', 1, 'ora', '09:00',
                          'candidati', v.n, 'excluse_pv_semnat', 0, 'excluse_a_raspuns', 0, 'excluse_duplicat', 0, 'set_hash', 'fixture-inainte-de-20261226b'),
       v.n, 1, round(v.n * 0.049, 3), 0, 0
  FROM (VALUES ('$LV1'::uuid, '$UAT_V1'::uuid, '$TXT_V1', 1), ('$LV2'::uuid, '$UAT_V2'::uuid, '$TXT_V2', 1),
               ('$LV3'::uuid, '$UAT_V3'::uuid, '$TXT_V3', 2), ('$LV4'::uuid, '$UAT_V4'::uuid, '$TXT_V4', 1)) v(id, uat, txt, n);
INSERT INTO public.sms_mesaje (id, lot_id, telefon, destinatar_tip, destinatar_id) VALUES
  ('$MV1', '$LV1', '+40700000904', 'detinator', '$D4'), ('$MV2', '$LV2', '+40700000905', 'detinator', '$D5'),
  ('$MV3A', '$LV3', '+40700000906', 'detinator', '$D6'), ('$MV3B', '$LV3', '+40700000907', 'detinator', '$D7'),
  ('$MV4', '$LV4', '+40700000908', 'detinator', '$D8');
-- (2) ISTORICUL de dinainte de B (după B triggerul îl refuză: comportamentul probat mai jos) — DOAR aici triggerele lotului / mesajului oprite;
--     exact coloanele pe care le-ar fi scris triggerul (20261130c fn_sms_loturi_reguli / fn_sms_mesaje_reguli)
ALTER TABLE public.sms_loturi DISABLE TRIGGER trg_sms_loturi_reguli;
ALTER TABLE public.sms_mesaje DISABLE TRIGGER trg_sms_mesaje_reguli;
UPDATE public.sms_loturi l
   SET stare = x.stare, aprobat_de = '$OWNER', aprobat_la = now(), aprobat_nivel = 'owner',
       aprobat_autorizare_nr = s.redari_autorizare_nr, aprobat_autorizare_data = s.redari_autorizare_data,
       coada_golita_la = CASE WHEN x.stare = 'coada_golita' THEN now() END, versiune = x.versiune
  FROM (VALUES ('$LV2'::uuid, 'aprobat', 2), ('$LV3'::uuid, 'in_trimitere', 3), ('$LV4'::uuid, 'coada_golita', 4)) x(id, stare, versiune),
       public.sms_setari s
 WHERE l.id = x.id AND s.id;
UPDATE public.sms_mesaje SET stare = 'necunoscut', furnizor = 'simulator', rezervat_la = now(), actualizat_la = now(), versiune = 2 WHERE id = '$MV3A';
UPDATE public.sms_mesaje SET stare = 'trimis', furnizor = 'simulator', furnizor_id = '$FID_V4', rezervat_la = now(), trimis_la = now(),
                             actualizat_la = now(), versiune = 3 WHERE id = '$MV4';
ALTER TABLE public.sms_loturi ENABLE TRIGGER trg_sms_loturi_reguli;
ALTER TABLE public.sms_mesaje ENABLE TRIGGER trg_sms_mesaje_reguli;
SELECT set_config('request.jwt.claim.sub', '', true) IS NOT NULL AS _ok \\gset
DO \$f6\$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_sms_loturi_reguli', 'trg_sms_mesaje_reguli') AND NOT tgisinternal AND tgenabled <> 'O') THEN
    RAISE EXCEPTION 'F6: triggerele SMS nu sunt reactivate';
  END IF;
  IF (SELECT string_agg(l.stare || ':' || l.versiune || ':' || l.creat_nivel, ' ' ORDER BY l.id) FROM public.sms_loturi l WHERE l.id IN ('$LV1', '$LV2', '$LV3', '$LV4'))
     IS DISTINCT FROM 'draft:1:owner aprobat:2:owner in_trimitere:3:owner coada_golita:4:owner' THEN
    RAISE EXCEPTION 'F6: starea loturilor vechi nu e cea ceruta';
  END IF;
END \$f6\$;
COMMIT;
SQL
qf "$TMP/f6.sql" >/dev/null
printf '%s\n' "$LV1 V1 draft" "$LV2 V2 aprobat" "$LV3 V3 in_trimitere" "$LV4 V4 coada_golita" >>"$TMP/loturi.txt"
ok "$(q "SELECT string_agg(CASE m.id WHEN '$MV1' THEN 'V1' WHEN '$MV2' THEN 'V2' WHEN '$MV3A' THEN 'V3a' WHEN '$MV3B' THEN 'V3b' WHEN '$MV4' THEN 'V4' END || ':' || m.stare, ' ' ORDER BY m.id)
           FROM public.sms_mesaje m WHERE m.lot_id IN ('$LV1', '$LV2', '$LV3', '$LV4')")" \
   "V1:in_coada V2:in_coada V3a:necunoscut V3b:in_coada V4:trimis" "F6 fixture: mesajele loturilor vechi"
# interogarea din documentul B §4 (VERBATIM), restrânsă la loturile proiectului sintetic
CLASIFICARE="$(q "SELECT string_agg(CASE x.id WHEN '$LV1' THEN 'V1' WHEN '$LV2' THEN 'V2' WHEN '$LV3' THEN 'V3' WHEN '$LV4' THEN 'V4' ELSE 'ALT' END || '=' || x.ce_se_face, ' / ' ORDER BY x.id)
  FROM (
  SELECT l.id, l.stare, l.uat_id, l.filtru->>'zi' AS zi, l.filtru->>'sablon_versiune' AS versiune,
         count(m.id) FILTER (WHERE m.stare = 'in_coada') AS in_coada, count(m.id) FILTER (WHERE m.stare = 'necunoscut') AS necunoscut,
         CASE WHEN l.stare IN ('draft', 'aprobat', 'in_trimitere') THEN 'anulabil: anulare, apoi recreare'
              WHEN l.stare = 'coada_golita' AND count(m.id) FILTER (WHERE m.stare = 'necunoscut') > 0 THEN 'inchis: ocupa UAT-ul, de reconciliat'
              WHEN l.stare = 'coada_golita' THEN 'inchis: UAT eliberat; ziua lui ramane ocupata (campania)'
              WHEN count(m.id) FILTER (WHERE m.stare = 'necunoscut') > 0 THEN 'anulat: nu ocupa UAT-ul; necunoscut de reconciliat'
              ELSE 'anulat: nimic de facut' END AS ce_se_face
    FROM public.sms_loturi l LEFT JOIN public.sms_mesaje m ON m.lot_id = l.id
   WHERE l.categorie = 'redari' AND (l.filtru->>'sablon_versiune') IS DISTINCT FROM public.fn_sms_redari_sablon_versiune()
   GROUP BY l.id ORDER BY l.creat_la
  ) x WHERE x.id IN (SELECT id FROM public.sms_loturi WHERE proiect_id = '$PR')")"
ok "$CLASIFICARE" \
   "V1=anulabil: anulare, apoi recreare / V2=anulabil: anulare, apoi recreare / V3=anulabil: anulare, apoi recreare / V4=inchis: UAT eliberat; ziua lui ramane ocupata (campania)" \
   "F6 interogarea documentului B 4: V1-V3 anulabile, V4 inchis; lotul nou (versiunea curenta) nu apare"
okre "$(apel authenticated "$OWNER" "SELECT public.fn_sms_lot_aproba('$LV1', 1) ->> 'stare';")" '^ERR 22023 sms redari: sablon_neaprobat - ' "F6 aprobarea V1 (draft, versiunea veche) -> 22023 sablon_neaprobat"
ok "$(rezerva "$LV2" 5)" "OK sablon_neaprobat|-|-|-" "F6 rezervarea V2 (aprobat) -> sablon_neaprobat, 0 mesaje"
ok "$(rezerva "$LV3" 5)" "OK sablon_neaprobat|-|-|-" "F6 rezervarea V3 (in_trimitere) -> sablon_neaprobat, 0 mesaje"
ok "$(q "SELECT string_agg(l.stare || ':' || l.versiune, ' ' ORDER BY l.id) FROM public.sms_loturi l WHERE l.id IN ('$LV1', '$LV2', '$LV3')")|$(q "SELECT string_agg(stare || ':' || versiune, ' ' ORDER BY id) FROM public.sms_mesaje WHERE lot_id IN ('$LV1', '$LV2', '$LV3')")" \
   "draft:1 aprobat:2 in_trimitere:3|in_coada:1 in_coada:1 necunoscut:2 in_coada:1" "F6 dupa refuzuri: loturile si mesajele vechi neschimbate"
ANUL="concat_ws('|', r->>'stare', r->>'mesaje_anulate', r->>'deja_rezervate_necunoscut')"
ok "$(apel authenticated "$OWNER" "SELECT $ANUL FROM (SELECT public.fn_sms_lot_anuleaza('$LV1', 'proba: versiunea veche') AS r) x;")" "OK anulat|1|0" "F6 anularea V1 (draft) -> anulat"
ok "$(apel authenticated "$OWNER" "SELECT $ANUL FROM (SELECT public.fn_sms_lot_anuleaza('$LV2', 'proba: versiunea veche') AS r) x;")" "OK anulat|1|0" "F6 anularea V2 (aprobat) -> anulat"
ok "$(apel authenticated "$OWNER" "SELECT $ANUL FROM (SELECT public.fn_sms_lot_anuleaza('$LV3', 'proba: versiunea veche') AS r) x;")" "OK anulat|1|1" "F6 anularea V3 (in_trimitere) -> anulat; necunoscutul ramane (deja_rezervate_necunoscut 1)"
ok "$(q "SELECT stare || ':' || coalesce(cod_eroare, '-') FROM public.sms_mesaje WHERE id IN ('$MV3A', '$MV3B') ORDER BY id")" "$(printf '%s\n%s' 'necunoscut:-' 'anulat:lot_anulat')" \
   "F6 V3: mesajul rezervat isi pastreaza rezultatul (necunoscut), cel din coada -> anulat"
okre "$(apel authenticated "$OWNER" "SELECT public.fn_sms_lot_anuleaza('$LV4', 'proba') ->> 'stare';")" '^ERR 23514 sms: lotul e deja inchis \(coada_golita\)' "F6 anularea V4 (coada_golita) -> 23514 (lotul e deja inchis)"
# recrearea din șablon (documentul B §4): UAT-ul lui V3 (anulat) e liber; UAT-ul lui V4 (coada_golita, neanulat) ține campania zilei
PV3="$(previzualizeaza "$UAT_V3")"
IFS='|' read -r P3_TEXT P3_HASH P3_VERS P3_APROBAT P3_NR P3_LUNG P3_ACTIV P3_CAMP <<<"${PV3#OK }"
ok "$P3_TEXT|$P3_VERS|$P3_APROBAT|$P3_NR|$P3_ACTIV|$P3_CAMP" "$(text_sms predare 'Vechieni Trei')|$VERS_NOUA|true|2|-|-" "F6 UAT-ul lui V3 dupa anulare: previzualizarea cu textul nou, fara lot activ / campanie"
CR3="$(creeaza "$UAT_V3" "$P3_TEXT" "$P3_HASH")"
okre "$CR3" '^OK [0-9a-f-]{36}$' "F6 recrearea pe UAT-ul lui V3 -> lot nou"
[[ "${CR3#OK }" =~ ^[0-9a-f-]{36}$ ]] && echo "${CR3#OK } recreat pe UAT-ul lui V3" >>"$TMP/loturi.txt"
ok "$(q "SELECT coalesce((SELECT filtru->>'sablon_versiune' || '|' || nr_destinatari FROM public.sms_loturi WHERE id::text = '${CR3#OK }'), '-')")" "$VERS_NOUA|2" "F6 lotul recreat: versiunea noua, 2 destinatari"
PV4="$(previzualizeaza "$UAT_V4")"
ok "$(cut -d'|' -f7,8 <<<"${PV4#OK }")" "-|$LV4" "F6 UAT-ul lui V4: niciun lot activ, dar campania zilei = V4"
okre "$(creeaza "$UAT_V4" "$(cut -d'|' -f1 <<<"${PV4#OK }")" "$(cut -d'|' -f2 <<<"${PV4#OK }")")" '^ERR 23505 sms redari: campania pentru acest UAT si ziua de sesiune [0-9-]+ exista deja' \
   "F6 recrearea pe UAT-ul lui V4 pentru aceeasi zi -> 23505 (campania)"
ok "$(q "SELECT count(*) FROM pg_stat_activity WHERE application_name IN ($APPS) AND pid <> pg_backend_pid()")" 0 "F7 nicio sesiune a probei ramasa (inainte de curatenie)"

# verdictul final („PASS” / „ESEC”) îl tipărește curățenia (trap EXIT), DOAR după ce a șters, a pus la loc setările și a verificat
exit "$ESEC"
