#!/usr/bin/env bash
# Proba de CONCURENȚĂ a migrării 20270112a (Ofertare: cantități între documente, PR-BD): sesiuni psql REALE, cu barieră explicită, pe un cluster
# PostgreSQL ≥ 17 COMPLET DISPENSABIL. PGlite (o singură conexiune) nu poate proba asta: aici a doua operație vine cât prima e încă necomisă și ține
# lock-urile (advisory pe licitație, FOR SHARE / FOR UPDATE pe rânduri). Același tipar ca supabase/tests/20270110a_achizitii_retur_furnizor_concurenta.sh.
#
# CE ATINGE (exact):
#   * BAZA: creează <nume_baza_noua> (refuză dacă există) și o ȘTERGE la final (DROP DATABASE … WITH (FORCE)), inclusiv la întrerupere (trap).
#     Nu se conectează la altă bază decât `postgres` (CREATE / DROP / roluri) și baza creată.
#   * ROLURI la nivel de CLUSTER: anon, authenticated (NOLOGIN NOINHERIT), service_role (NOLOGIN NOINHERIT BYPASSRLS), authenticator (NOINHERIT),
#     create DOAR dacă lipsesc (scheletul se aplică FĂRĂ cele 4 rânduri CREATE ROLE) și ȘTERSE la final doar cele create aici. De aceea rulează DOAR cu
#     CM_CLUSTER_DISPENSABIL=da: NU pe clona de producție, NU pe un cluster folosit la altceva.
#   * FIȘIERE: un folder temporar (mktemp -d) cu SQL-ul extras și jurnalele sesiunilor; șters la final (la eșec, cozile jurnalelor se afișează înainte).
#   * REȚEA: doar conexiunile psql la cluster (PGHOST / PGPORT / PGUSER, parola din pgpass sau PGPASSWORD).
#   * DATE: doar sintetice (licitații 900101…, documente DOC_F3_T / DOC_ATR_T, conturi 00000000-0000-4000-8000-…).
# CE APLICĂ: scheletul (fără CREATE ROLE) + secțiunile 2–9 ale migrării („-- ─── 2.” până la (fără) „-- ─── 10.”), extrase EXACT, FĂRĂ $pre$ / $lock$ /
#   $stare$ / $post$ (gărzile runnerului); tabela temporară cm_view_acl pe care o cere secțiunea 9h se creează în aceeași tranzacție, cu aceeași
#   interogare ca $stare$. Aplicarea completă prin runner e pasul SEPARAT al coordonatorului, pe clonă (docs/LIVRARE_L15_V2.md §7).
#   ofertare_clarificare_planse_auto (generatorul planșelor) NU e în schelet: scenariul c_nr_generator_vs_publicare folosește EXACT alocarea lui
#   (SELECT coalesce(max(nr), 0) + 1 … INSERT cu cheie auto_planse_N, ca postgres) și, separat, INSERT-ul direct al UI-ului („+ întrebare”, authenticated).
#
# CUM SE RULEAZĂ (coordonatorul; cere bash ≥ 4 (coproc), psql ≥ 13 (\warn, :LAST_ERROR_MESSAGE), python3, conectare ca superuser `postgres`):
#     CM_CLUSTER_DISPENSABIL=da PGHOST=… PGPORT=… PGUSER=postgres bash supabase/tests/20270112a_ofertare_cantitati_masuratori_concurenta.sh <nume_baza_noua>
#   Ieșire: 0 = toate așteptările se țin (ultima linie TOTUL OK) și curățenia a reușit; 1 = cel puțin o așteptare nu se ține (inclusiv orice timeout al
#   observatorului); 2 = refuz / folosire greșită.
#
# BARIERA (fără sleep orb): sesiunea A e un psql ținut deschis (coproc): BEGIN; <operația> NECOMISĂ; marcajul `\warn <PAS> :SQLSTATE` confirmă pasul.
#   Sesiunea B pornește în fundal (PGAPPNAME = cm_B) și scrie la final `B_REZ <SQLSTATE>`, `B_MSG <mesaj>`, `B_R <rezultat>`. OBSERVATORUL (a treia
#   conexiune) așteaptă pe server până când B apare în pg_stat_activity cu wait_event_type = 'Lock' (pg_sleep(0.02) în buclă, plafon 30 s = EȘEC,
#   niciodată dovadă); abia atunci A comite. lock_timeout 20 s în B doar ca plasă. Codul de ieșire al fiecărui psql e păstrat.
#
# SCENARII (așteptările scrise de mână din plan, Task 5 „Concurența”):
#   c_doua_publicari            A: propune (service_role), NECOMIS (advisory + lock-uri). B: propune → așteaptă advisory-ul; A COMMIT → B trece, evaluarea A
#                               devine depasita. A-publică (sesiune nouă) → evaluare_necunoscuta; B-publică → publicata; o singură ciornă.
#   c_nr_generator_vs_publicare A: alocarea generatorului (max(nr)+1, cheie auto_planse_1, postgres), NECOMISĂ. B: publică → același nr → așteaptă pe
#                               UNIQUE; A COMMIT → B: 23505 (vizibil, reîncercabil); nr-urile rămân unice; reîncercarea publică cu nr = max+1.
#                               Apoi la fel cu INSERT-ul direct al UI-ului („+ întrebare”, authenticated) ca A.
#   c_publicare_vs_editare      A: omul editează textul ciornei (authenticated), NECOMIS. B: publică (B schimbată → ar regenera) → așteaptă ciorna (5);
#                               A COMMIT → B vede text_editat_de și nu atinge textul (neatinsa); textul omului rămâne.
#   c_sursa_dupa_verificare     A: publică, NECOMIS (după reverificarea fotografiei, ține cantitățile FOR SHARE). B: UPDATE cantitate → așteaptă; A COMMIT →
#                               B comite; după ambele: ofertare_semnal_baza_stare = schimbata, exportul blocat.
#   c_export_vs_publicare, c_notifica_vs_publicare, c_notifica_vs_export, c_reconfirmare_vs_publicare
#                               două ciorne auto_surse_* cu nr în ordine inversă față de id; A ține prima funcție NECOMISĂ, B o cheamă pe a doua → așteaptă,
#                               fără 40P01; A COMMIT → B termină (00000).
set -u
set -o pipefail

if [ "${CM_CLUSTER_DISPENSABIL:-}" != "da" ]; then
  echo "refuz: scriptul creeaza / sterge o baza si poate crea roluri la nivel de CLUSTER; ruleaza-l DOAR pe un cluster complet dispensabil, cu CM_CLUSTER_DISPENSABIL=da" >&2
  exit 2
fi
if [ $# -ne 1 ] || ! [[ "$1" =~ ^[a-z][a-z0-9_]{2,40}$ ]]; then echo "folosire: CM_CLUSTER_DISPENSABIL=da $0 <nume_baza_noua (a-z0-9_)>" >&2; exit 2; fi
BAZA="$1"
RADACINA="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$RADACINA/supabase/migrations/20270112a_ofertare_cantitati_masuratori.sql"
SCHELET="$RADACINA/supabase/tests/20270112a_ofertare_cantitati_masuratori_schelet.sql"
[ -r "$MIG" ] && [ -r "$SCHELET" ] || { echo "lipsesc migrarea / scheletul" >&2; exit 2; }
command -v python3 > /dev/null || { echo "refuz: python3 lipseste (extragerea SQL-ului)" >&2; exit 2; }
export PGCLIENTENCODING=UTF8

PSM=(psql -X -q -w -v ON_ERROR_STOP=1 -d postgres)
VERS_CLIENT="$(psql --version 2>/dev/null | sed -n 's/^psql (PostgreSQL) \([0-9]*\).*/\1/p')"
if [ -z "$VERS_CLIENT" ] || [ "$VERS_CLIENT" -lt 13 ]; then echo "refuz: psql >= 13; gasit: $(psql --version 2>&1)" >&2; exit 2; fi
PRE="$("${PSM[@]}" -tAc "SELECT current_setting('server_version_num')::int >= 170000, current_user = 'postgres', (SELECT rolsuper FROM pg_roles WHERE rolname = current_user), EXISTS (SELECT 1 FROM pg_database WHERE datname = '$BAZA')")" || { echo "refuz: nu ma pot conecta la baza postgres" >&2; exit 2; }
case "$PRE" in
  t\|t\|t\|f) ;;
  t\|t\|t\|t) echo "refuz: baza $BAZA exista deja (aleg alt nume; nu sterg nimic existent)" >&2; exit 2;;
  *) echo "refuz: cere PostgreSQL >= 17, current_user = postgres, superuser (primit: $PRE)" >&2; exit 2;;
esac
ROL_ALTFEL="$("${PSM[@]}" -tAc "SELECT coalesce(string_agg(rolname, ' ' ORDER BY rolname), '') FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator') AND (rolsuper OR rolinherit OR rolbypassrls IS DISTINCT FROM (rolname = 'service_role'))")" || exit 2
if [ -n "$ROL_ALTFEL" ]; then echo "refuz: rolurile existente $ROL_ALTFEL au alte atribute decat scheletul (superuser / INHERIT / BYPASSRLS); nu le ating" >&2; exit 2; fi

D="$(mktemp -d -t cm_concurenta_XXXXXX)"
A_OUT="$D/A.stdout.log"; A_ERR="$D/A.stderr.log"; B_LOG="$D/B.log"; B_TOT="$D/B.toate.log"
: > "$A_ERR"; : > "$B_TOT"
BAZA_CREATA=0; A_DESCHIS=0; esec=0; B_PID=''
ROLURI_CREATE=()
curatenie() {
  local cod=$?
  trap - EXIT INT TERM
  if [ "$cod" != 0 ] || [ "$esec" != 0 ]; then
    echo "── sesiunea A (stderr, ultimele 40) ──"; tail -n 40 "$A_ERR" 2>/dev/null
    echo "── sesiunile B (ultimele 60) ──"; tail -n 60 "$B_TOT" 2>/dev/null
  fi
  if [ "$A_DESCHIS" = 1 ]; then { printf '%s\n' 'ROLLBACK;' '\q' >&"$A_IN"; } 2>/dev/null || true; wait "$A_PID_C" 2>/dev/null || true; fi
  if [ -n "$B_PID" ]; then kill "$B_PID" 2>/dev/null || true; wait "$B_PID" 2>/dev/null || true; fi
  if [ "$BAZA_CREATA" = 1 ]; then
    if "${PSM[@]}" -c "DROP DATABASE \"$BAZA\" WITH (FORCE)" > /dev/null; then echo "  OK  curatenie: DROP DATABASE $BAZA"; else echo "  NU  curatenie: DROP DATABASE $BAZA a esuat (de sters manual)"; cod=1; fi
  fi
  local r i
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
astept() { if [ "$2" = "$1" ]; then echo "      ok  $3 → $2"; else echo "      ABATERE  $3 → $2 (astepta $1)"; esec=$((esec + 1)); fi; }
potriveste() { case "$2" in $1) echo "      ok  $3 → $2";; *) echo "      ABATERE  $3 → $2 (astepta $1)"; esec=$((esec + 1));; esac; }
q() { psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -tAc "$1"; }
U_OWNER=00000000-0000-4000-8000-0000000000d1; U_RESP=00000000-0000-4000-8000-0000000000d3; U_OF=00000000-0000-4000-8000-0000000000d2
# JWT ca PostgREST: AMBELE surse (request.jwt.claim.sub și request.jwt.claims cu rolul) — triggerul de proveniență citește rolul din claims
ca() { printf "SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '%s', true); SELECT set_config('request.jwt.claims', '{\"sub\": \"%s\", \"role\": \"authenticated\"}', true);" "$1" "$1"; }
caService() { printf "SET LOCAL ROLE service_role;"; }
TOKEN_N=0
token() { TOKEN_N=$((TOKEN_N + 1)); printf '00000000-0000-4000-8000-%012d' "$TOKEN_N"; }

# ── 0. rolurile (doar cele care lipsesc), baza, scheletul, secțiunile 2–9 ale migrării ──
echo "0. baza de unica folosinta: scheletul + sectiunile 2-9 ale migrarii 20270112a"
EXISTENTE=" $("${PSM[@]}" -tAc "SELECT coalesce(string_agg(rolname, ' '), '') FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator')") "
for r in anon authenticated service_role authenticator; do
  case "$EXISTENTE" in *" $r "*) continue;; esac
  case "$r" in service_role) atr='NOLOGIN NOINHERIT BYPASSRLS';; authenticator) atr='NOINHERIT';; *) atr='NOLOGIN NOINHERIT';; esac
  if "${PSM[@]}" -c "CREATE ROLE \"$r\" $atr" > /dev/null; then ROLURI_CREATE+=("$r"); else echo "refuz: CREATE ROLE $r a esuat" >&2; exit 2; fi
done
echo "     roluri de cluster create (si sterse la final): ${ROLURI_CREATE[*]:-niciunul}"
if "${PSM[@]}" -c "CREATE DATABASE \"$BAZA\"" > /dev/null; then BAZA_CREATA=1; ok 0 "CREATE DATABASE $BAZA"; else echo "refuz: CREATE DATABASE $BAZA a esuat" >&2; exit 2; fi
python3 - "$SCHELET" "$MIG" "$D" <<'PY'
import re, sys
schelet_p, mig_p, d = sys.argv[1:4]
citeste = lambda p: open(p, encoding='utf-8').read().replace('\r', '')
SCH, MIG = citeste(schelet_p), citeste(mig_p)
roluri = re.compile(r'^CREATE ROLE (anon|authenticated|service_role|authenticator)\b[^;\n]*;\n', re.M)
sch2, n = roluri.subn('', SCH)
if n != 4 or 'CREATE ROLE' in sch2: sys.exit('scheletul: astept exact 4 randuri CREATE ROLE, gasit %d' % n)
sch2 = sch2.replace('GRANT anon, authenticated, service_role TO authenticator;\n', '')
open(d + '/schelet.sql', 'w', encoding='utf-8').write(sch2)
marcaje = re.findall(r'^-- ─── ([0-9]+)\. ', MIG, re.M)
if marcaje != ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']: sys.exit('migrarea: marcajele sectiunilor nu sunt 0..10 (o data fiecare): %r' % marcaje)
inc, sf = '\n-- ─── 2. ', '\n-- ─── 10. '
ddl = MIG[MIG.index(inc) + 1:MIG.index(sf) + 1]
for interzis in ('$pre$', '$lock$', '$post$', '$stare$', 'gazpet.livrare_migrare', 'gazpet.plafon_tranzactie', 'gazpet.lock_puternic_la'):
    if interzis in ddl: sys.exit('sectiunile extrase contin o garda a runnerului: ' + interzis)
pre = ("CREATE TEMP TABLE cm_view_acl ON COMMIT DROP AS\n  SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END AS rol, e.privilege_type AS drept\n"
       "    FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.v_ofertare_clarificari_baza'::regclass;\n")
open(d + '/ddl.sql', 'w', encoding='utf-8').write(pre + ddl)
print('     extras: schelet (-4 CREATE ROLE), sectiunile 2-9: %d caractere' % len(ddl))
PY
ok $? "SQL-ul extras (schelet, sectiunile 2-9 ale migrarii)"
[ "$esec" = 0 ] || exit 1
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 -f "$D/schelet.sql" > /dev/null; ok $? "scheletul"
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 -f "$D/ddl.sql" > /dev/null; ok $? "sectiunile 2-9 ale migrarii 20270112a (o tranzactie)"
astept '6|30|1' "$(q "SELECT (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname IN ('ofertare_elemente_masura', 'ofertare_tipare_cantitate', 'ofertare_cantitati_setari', 'ofertare_cantitati_evaluari', 'ofertare_cantitati_semnale', 'ofertare_cantitati_masuratori')) || '|' || (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND (proname LIKE 'fn\\_ofertare\\_masura\\_%' OR proname LIKE 'fn\\_ofertare\\_semnal%' OR proname LIKE 'fn\\_ofertare\\_masuratori\\_%' OR proname IN ('fn_ofertare_numar_ro', 'fn_ofertare_um_canonica', 'fn_ofertare_ciorna_auto_stare', 'ofertare_semnal_baza_stare', 'fn_trg_ofertare_masuratori_licitatie', 'fn_trg_ofertare_masuratori_imuabil'))) || '|' || (SELECT count(*) FROM pg_constraint WHERE conname = 'ofertare_clarificari_licitatie_nr_uq')")" "obiectele: tabele | functii noi | UNIQUE nr"
[ "$esec" = 0 ] || exit 1

# ── fixturile (ca postgres): conturi; câte o licitație pe scenariu, cu DOC_F3_T (6.400) + DOC_ATR_T (3.995), observații pe ambele, poziția F3 ──
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 <<'SQL' > /dev/null
INSERT INTO public.profiles (id, name, is_owner) VALUES ('00000000-0000-4000-8000-0000000000d1', 'OWNER', true), ('00000000-0000-4000-8000-0000000000d2', 'OF', false), ('00000000-0000-4000-8000-0000000000d3', 'RESP', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('00000000-0000-4000-8000-0000000000d2', 'ofertare', 'editor'), ('00000000-0000-4000-8000-0000000000d3', 'ofertare', 'editor');
CREATE FUNCTION public.t_doc(lic bigint, tip text, nume text, txt text) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE v bigint; BEGIN
  INSERT INTO public.ofertare_documente_atribuire (licitatie_id, nume_original, tip, text_extras, revizie, status_procesare) VALUES (lic, nume, tip, txt, 'A', 'procesat') RETURNING id INTO v; RETURN v;
END $f$;
CREATE FUNCTION public.t_extragere(doc bigint, extractor text, obs jsonb) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE d record; v_sha text; v_prov bigint; v_cerere bigint; v_ex bigint; o jsonb; BEGIN
  SELECT * INTO d FROM public.ofertare_documente_atribuire WHERE id = doc;
  v_sha := encode(sha256(convert_to(coalesce(d.text_extras, ''), 'UTF8')), 'hex');
  INSERT INTO public.ofertare_doc_texte (licitatie_id, sha256, text) VALUES (d.licitatie_id, v_sha, coalesce(d.text_extras, '')) ON CONFLICT DO NOTHING;
  INSERT INTO public.ofertare_doc_texte_prov (licitatie_id, document_id, sha256, origine, producator, completitudine) VALUES (d.licitatie_id, doc, v_sha, 'transcriere', 'proba', 'integral') RETURNING id INTO v_prov;
  SELECT id INTO v_cerere FROM public.ofertare_ai_cereri WHERE licitatie_id = d.licitatie_id ORDER BY id LIMIT 1;
  INSERT INTO public.ofertare_cant_extrageri (licitatie_id, document_id, doc_sha256, prov_id, familie_id, extractor_id, felii_total, stare, obs_relevante, cerere_id, terminat_la)
    VALUES (d.licitatie_id, doc, v_sha, v_prov, 'fam', extractor, 1, 'gata', 0, v_cerere, now()) RETURNING id INTO v_ex;
  INSERT INTO public.ofertare_cant_felii (munca_id, incercare, extragere_id, felie_nr, de_la, pana_la, sha_felie, stare, inchisa_la)
    VALUES (doc || ':' || v_sha || ':' || extractor || ':0:' || v_sha, 1, v_ex, 0, 0, length(coalesce(d.text_extras, '')), v_sha, 'gata', now());
  FOR o IN SELECT * FROM jsonb_array_elements(obs) LOOP
    INSERT INTO public.ofertare_cant_obs (licitatie_id, document_id, doc_sha256, familie_id, extragere_id, felie_nr, lot_domeniu, lot_nr, rol_sursa, rol_decis_de, pagina, cod_articol, denumire,
        rand_interval, citat_interval, cantitate_offset, pozitie_dovedita, tip_lucrare, masura, material, dn_mm, um_norm, cantitate, citat, extractor_id, hash_rand)
    VALUES (d.licitatie_id, doc, v_sha, 'fam', v_ex, 0, 'toate', '{}', o ->> 'rol', 'model', 1, o ->> 'cod', o ->> 'denumire', '[0,10)', '[0,10)', 0, true, 'conducta', o ->> 'masura', 'PE100',
        ARRAY[160]::numeric[], 'm', (o ->> 'cantitate')::numeric, o ->> 'citat', extractor, encode(sha256(convert_to(o ->> 'citat', 'UTF8')), 'hex'));
  END LOOP;
  RETURN v_ex;
END $f$;
-- o licitație completă a cazului din tichet: întoarce id-ul ei; ATR cu valoarea dată (3995 implicit)
CREATE FUNCTION public.t_licitatie(lic bigint, atr_val text DEFAULT '3.995') RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE v_f3 bigint; v_atr bigint; BEGIN
  INSERT INTO public.ofertare_licitatii (id, nr_anunt, obiect, responsabil_id, stare_loturi) VALUES (lic, 'T-' || lic, 'licitatie de proba', '00000000-0000-4000-8000-0000000000d3', 'fara_loturi');
  INSERT INTO public.ofertare_ai_buget (licitatie_id, scop, plafon_usd) VALUES (lic, 'cant_extragere', 10);
  INSERT INTO public.ofertare_ai_cereri (licitatie_id, lot_domeniu, scop, aprobat_de, valabil_pana) VALUES (lic, 'toate', 'cant_extragere', '00000000-0000-4000-8000-0000000000d1', now() + interval '1 day');
  v_f3 := public.t_doc(lic, 'formular', 'DOC_F3_T', E'⟦PAGINA 1⟧\nFormularul F3\nNr. Cod Denumire UM Cantitate\n003 SA11G1 TEAVA PE100 DN160 M 6.400\n');
  v_atr := public.t_doc(lic, 'alta', 'DOC_ATR_T', E'⟦PAGINA 1⟧\nAVIZ TEHNIC DE RACORDARE\nRețeaua este în lungime totală de ' || atr_val || ' m.\n');
  PERFORM public.t_extragere(v_f3, 'extr-A', jsonb_build_array(jsonb_build_object('rol', 'f3', 'denumire', 'TEAVA PE100 DN160', 'cantitate', 6400, 'citat', '003 SA11G1 TEAVA PE100 DN160 M 6.400', 'cod', 'SA11G1', 'masura', 'material')));
  PERFORM public.t_extragere(v_atr, 'extr-A', jsonb_build_array(jsonb_build_object('rol', 'atr', 'denumire', 'conducta PE100 Dn 160', 'cantitate', replace(atr_val, '.', '')::numeric, 'citat', 'în lungime totală de ' || atr_val || ' m', 'masura', 'lungime')));
  INSERT INTO public.ofertare_cantitati (licitatie_id, denumire, um, cantitate, cod_articol, surse_document_ids, status, tip_sursa, extras_de_ai)
    VALUES (lic, 'Furnizare teava PE100 DN160', 'M', 6400, 'SA11G1', ARRAY[v_f3], 'validat', 'lista_f3', false);
  RETURN lic;
END $f$;
-- o evaluare completă (propune + publică) ca service_role, în aceeași sesiune: întoarce publicarea
CREATE FUNCTION public.t_evalueaza(lic bigint, tok uuid) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE p jsonb; BEGIN
  p := public.fn_ofertare_masuratori_propune(lic, tok, public.fn_ofertare_semnale_fotografie(lic), '{"plafon": 200, "plafon_atins": false, "pagini_necitite": [], "documente_necitite": [], "felii_incomplete": []}'::jsonb);
  IF p ? 'refuz' THEN RETURN p; END IF;
  RETURN public.fn_ofertare_semnale_publica(lic, (p ->> 'evaluare_id')::bigint, tok);
END $f$;
GRANT EXECUTE ON FUNCTION public.t_evalueaza(bigint, uuid) TO service_role;
SQL
ok $? "fixturile (functii de proba t_*)"
for L in 900101 900102 900103 900104 900105 900106 900107 900108; do q "SELECT public.t_licitatie($L)" > /dev/null || ok 1 "licitatia $L"; done
[ "$esec" = 0 ] || exit 1

# ── sesiunea A (coproc), sesiunea B (fundal), observatorul ──
A_IN=''; A_FD_OUT=''; A_PID_C=''
deschideA() { coproc A { PGAPPNAME=cm_A psql -X -q -w -v ON_ERROR_STOP=0 -d "$BAZA" -f - 2>&1 1>"$A_OUT"; }; A_IN="${A[1]}"; A_FD_OUT="${A[0]}"; A_PID_C="$A_PID"; A_DESCHIS=1; }
asteaptaA() {
  local marcaj="$1" linie; A_STARE=''
  while IFS= read -r -t 60 -u "$A_FD_OUT" linie; do printf '%s\n' "$linie" >> "$A_ERR"; case "$linie" in "$marcaj "*) A_STARE="${linie#"$marcaj" }"; return 0;; esac; done
  A_STARE='FARA_RASPUNS'; return 1
}
pasA() { local marcaj="$1"; shift; printf '%s\n' "$@" "\\warn $marcaj :SQLSTATE" >&"$A_IN"; asteaptaA "$marcaj"; }
inchideA() { local linie; { printf '%s\n' '\q' >&"$A_IN"; } 2>/dev/null || true; while IFS= read -r -t 60 -u "$A_FD_OUT" linie 2>/dev/null; do printf '%s\n' "$linie" >> "$A_ERR"; done; wait "$A_PID_C" 2>/dev/null; A_DESCHIS=0; }
pornesteB() {   # <prolog rol> <SELECT … AS r>
  printf '%s\n' "SET lock_timeout = '20s';" "BEGIN;" "$1" "\\set r -" "$2 \\gset" "\\echo B_REZ :SQLSTATE" "\\echo B_MSG :LAST_ERROR_MESSAGE" "\\echo B_R :r" "COMMIT;" "\\echo B_COMMIT :SQLSTATE" > "$D/B.sql"
  PGAPPNAME=cm_B psql -X -q -w -v ON_ERROR_STOP=0 -d "$BAZA" -f "$D/B.sql" > "$B_LOG" 2>&1 &
  B_PID=$!
}
asteaptaB() {
  wait "$B_PID" 2>/dev/null; B_PID=''
  { echo "── B ──"; cat "$B_LOG"; } >> "$B_TOT"
  B_STARE="$(sed -n 's/^B_REZ //p' "$B_LOG" | tail -n 1)"; [ -n "$B_STARE" ] || B_STARE='FARA_MARCAJ'
  B_MSG="$(sed -n 's/^B_MSG //p' "$B_LOG" | tail -n 1)"
  B_R="$(sed -n 's/^B_R //p' "$B_LOG" | tail -n 1)"
}
bariera() {
  local r
  r="$(psql -X -q -w -d "$BAZA" -tAc "DO \$o\$ DECLARE i int := 0; BEGIN LOOP EXIT WHEN EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'cm_B' AND wait_event_type = 'Lock'); i := i + 1; IF i > 1500 THEN RAISE EXCEPTION 'cm_B nu asteapta pe niciun lock (30 s)'; END IF; PERFORM pg_sleep(0.02); END LOOP; END \$o\$; SELECT 'BARIERA_OK';" 2>&1)"
  astept BARIERA_OK "$r" "observatorul: B asteapta pe un lock (wait_event_type = Lock)"
}
semnal_id() { q "SELECT id FROM public.ofertare_cantitati_semnale WHERE licitatie_id = $1 AND element = 'teava_pe_dn160'"; }
ciorna() { q "SELECT id FROM public.ofertare_clarificari WHERE licitatie_id = $1 AND cheie LIKE 'auto_surse_%' ORDER BY nr LIMIT 1"; }
evalueaza() { psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -tAc "BEGIN; SET LOCAL ROLE service_role; SELECT public.t_evalueaza($1, '$(token)'); COMMIT;" | head -n 1; }
# reconfirmă + de_trimis ca RESP (prin view-ul real)
aproba() {   # <ciorna id>
  psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -tAc "BEGIN; $(ca $U_RESP) SELECT (public.ofertare_clarificare_reconfirma($1, (SELECT amprenta_curenta FROM public.v_ofertare_clarificari_baza WHERE id = $1), 'revizuit', 'verificat de om in proba')) ->> 'ok'; UPDATE public.ofertare_clarificari SET status = 'de_trimis' WHERE id = $1; COMMIT;" | head -n 1
}
# cele două ciorne ale unei licitații cu nr inversat față de id (a doua măsură = robinet): întoarce „id1 id2 nr1 nr2”
doua_ciorne() {   # <lic>
  local lic="$1"
  q "SELECT public.t_doc($lic, 'alta', 'DOC_ATR_T2', E'\\u27e6PAGINA 1\\u27e7\\nrobineti: numar de bucati 12 buc\\n')" > /dev/null
  q "SELECT public.t_extragere((SELECT id FROM public.ofertare_documente_atribuire WHERE licitatie_id = $lic AND nume_original = 'DOC_ATR_T2'), 'extr-A', jsonb_build_array(jsonb_build_object('rol', 'atr', 'denumire', 'robinet sertar Dn 160', 'cantitate', 12, 'citat', 'numar de bucati 12 buc', 'masura', 'alt')))" > /dev/null
  q "UPDATE public.ofertare_cant_obs SET dn_mm = ARRAY[160]::numeric[], tip_lucrare = 'alt', um_norm = 'buc' WHERE licitatie_id = $lic AND denumire = 'robinet sertar Dn 160'" > /dev/null 2>&1 || true
  q "INSERT INTO public.ofertare_cantitati (licitatie_id, denumire, um, cantitate, cod_articol, surse_document_ids, status, tip_sursa, extras_de_ai) VALUES ($lic, 'Furnizare robinet sertar DN160', 'buc', 20, 'RB1', (SELECT ARRAY[id] FROM public.ofertare_documente_atribuire WHERE licitatie_id = $lic AND nume_original = 'DOC_F3_T'), 'validat', 'lista_f3', false)" > /dev/null
  evalueaza "$lic" > /dev/null
  # nr inversat: ciorna cu id-ul mai mare primește nr-ul mai mic
  q "WITH c AS (SELECT id, nr, row_number() OVER (ORDER BY id DESC) AS rn FROM public.ofertare_clarificari WHERE licitatie_id = $lic AND cheie LIKE 'auto_surse_%'), m AS (UPDATE public.ofertare_clarificari k SET nr = -c.rn FROM c WHERE k.id = c.id RETURNING 1) SELECT count(*) FROM m" > /dev/null
  q "UPDATE public.ofertare_clarificari SET nr = -nr WHERE licitatie_id = $lic AND nr < 0" > /dev/null
  q "SELECT string_agg(id::text, ' ' ORDER BY id) || ' ' || string_agg(nr::text, ' ' ORDER BY id) FROM public.ofertare_clarificari WHERE licitatie_id = $lic AND cheie LIKE 'auto_surse_%'"
}

# ── c_doua_publicari ──
echo "c_doua_publicari (licitatia 900101)"
{
  L=900101; TA="$(token)"; TB="$(token)"
  deschideA
  pasA C1a "BEGIN;" "$(caService)" "\\set r -" "SELECT (public.fn_ofertare_masuratori_propune($L, '$TA', public.fn_ofertare_semnale_fotografie($L), '{\"plafon\": 200, \"plafon_atins\": false, \"pagini_necitite\": [], \"documente_necitite\": [], \"felii_incomplete\": []}'::jsonb)) ->> 'evaluare_id' AS r \\gset" "\\warn C1a_r :r"
  astept 00000 "$A_STARE" "A: propune (necomis)"; asteaptaA C1a_r; EVA="$A_STARE"
  pornesteB "$(caService)" "SELECT (public.fn_ofertare_masuratori_propune($L, '$TB', public.fn_ofertare_semnale_fotografie($L), '{\"plafon\": 200, \"plafon_atins\": false, \"pagini_necitite\": [], \"documente_necitite\": [], \"felii_incomplete\": []}'::jsonb)) ->> 'evaluare_id' AS r"
  bariera
  pasA C1b "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
  asteaptaB; astept 00000 "$B_STARE" "B: propune dupa A"; EVB="$B_R"
  inchideA
  astept depasita "$(q "SELECT stare FROM public.ofertare_cantitati_evaluari WHERE id = $EVA")" "evaluarea A → depasita"
  astept "0" "$(q "SELECT count(*) FROM public.ofertare_cantitati_masuratori WHERE evaluare_id = $EVA")" "masuratorile lui A sterse"
  PA="$(psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -tAc "BEGIN; SET LOCAL ROLE service_role; SELECT (public.fn_ofertare_semnale_publica($L, $EVA, '$TA')) ->> 'refuz'; COMMIT;" | head -n 1)"
  astept evaluare_necunoscuta "$PA" "A-publica → evaluare_necunoscuta"
  PB="$(psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -tAc "BEGIN; SET LOCAL ROLE service_role; SELECT (public.fn_ofertare_semnale_publica($L, $EVB, '$TB')) -> 'semnale' -> 0 ->> 'verdict'; COMMIT;" | head -n 1)"
  astept diferenta "$PB" "B-publica → publicata, diferenta"
  astept "1|1" "$(q "SELECT (SELECT count(*) FROM public.ofertare_cantitati_evaluari WHERE licitatie_id = $L AND stare = 'publicata') || '|' || (SELECT count(*) FROM public.ofertare_clarificari WHERE licitatie_id = $L AND cheie LIKE 'auto_surse_%')")" "o singura evaluare publicata | o singura ciorna"
}

# ── c_nr_generator_vs_publicare ──
echo "c_nr_generator_vs_publicare (licitatia 900102): alocarea generatorului planselor (postgres), apoi INSERT-ul direct al UI-ului"
{
  L=900102
  for VAR in generator ui; do
    if [ "$VAR" = generator ]; then
      PRO="-- generatorul planselor: max(nr)+1, cheie auto_planse_N, ca postgres"
      INS="INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, sursa, status, origine, cheie, baza_generare) SELECT $L, coalesce(max(nr), 0) + 1, 'planse (proba)', 'planse_auto:1,gen_x,ev_x', 'propunere', 'automat', 'auto_planse_' || (SELECT count(*) + 1 FROM public.ofertare_clarificari WHERE licitatie_id = $L AND cheie LIKE 'auto_planse_%'), public.ofertare_f3_baza($L) FROM public.ofertare_clarificari WHERE licitatie_id = $L;"
    else
      PRO="$(ca $U_RESP)"
      INS="INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status) SELECT $L, coalesce(max(nr), 0) + 1, 'intrebare manuala (proba)', 'propunere' FROM public.ofertare_clarificari WHERE licitatie_id = $L;"
    fi
    T="$(token)"
    deschideA
    pasA "C2a_$VAR" "BEGIN;" "$PRO" "$INS"; astept 00000 "$A_STARE" "A ($VAR): alocarea nr = max+1, NECOMISA"
    pornesteB "$(caService)" "SELECT public.t_evalueaza($L, '$T') AS r"
    bariera
    pasA "C2b_$VAR" "COMMIT;"; astept 00000 "$A_STARE" "A ($VAR): COMMIT"
    asteaptaB; astept 23505 "$B_STARE" "B ($VAR): publicarea cu acelasi nr → 23505 (vizibil, reincercabil)"
    inchideA
    astept "0" "$(q "SELECT count(*) FROM (SELECT nr FROM public.ofertare_clarificari WHERE licitatie_id = $L GROUP BY nr HAVING count(*) > 1) d")" "nr-urile raman unice"
    astept "0" "$(q "SELECT count(*) FROM public.ofertare_cantitati_evaluari WHERE licitatie_id = $L AND stare = 'publicata'")" "nimic publicat (tranzactia lui B anulata)"
    R2="$(evalueaza "$L")"
    astept "1" "$(q "SELECT count(*) FROM public.ofertare_clarificari WHERE licitatie_id = $L AND cheie LIKE 'auto_surse_%'")" "reincercarea publica ciorna (nr = max+1)"
    q "UPDATE public.ofertare_clarificari SET status = 'retrasa' WHERE licitatie_id = $L AND cheie LIKE 'auto_surse_%'" > /dev/null
    q "SET session_replication_role = replica; DELETE FROM public.ofertare_clarificari WHERE licitatie_id = $L AND cheie LIKE 'auto_surse_%'; SET session_replication_role = origin;" > /dev/null
    q "UPDATE public.ofertare_cantitati_semnale SET clarificare_id = NULL WHERE licitatie_id = $L" > /dev/null
  done
}

# ── c_publicare_vs_editare ──
echo "c_publicare_vs_editare (licitatia 900103)"
{
  L=900103; evalueaza "$L" > /dev/null; C="$(ciorna $L)"
  # B schimbată (3990 în loc de 3995) → publicarea ar regenera textul unei propuneri libere
  q "UPDATE public.ofertare_documente_atribuire SET text_extras = replace(text_extras, '3.995', '3.990') WHERE licitatie_id = $L AND nume_original = 'DOC_ATR_T'" > /dev/null
  q "SELECT public.t_extragere((SELECT id FROM public.ofertare_documente_atribuire WHERE licitatie_id = $L AND nume_original = 'DOC_ATR_T'), 'extr-A', jsonb_build_array(jsonb_build_object('rol', 'atr', 'denumire', 'conducta PE100 Dn 160', 'cantitate', 3990, 'citat', 'în lungime totală de 3.990 m', 'masura', 'lungime')))" > /dev/null
  T="$(token)"
  deschideA
  pasA C3a "BEGIN;" "$(ca $U_RESP)" "UPDATE public.ofertare_clarificari SET intrebare = intrebare || ' (editat de om)' WHERE id = $C;"; astept 00000 "$A_STARE" "A: omul editeaza textul, NECOMIS"
  pornesteB "$(caService)" "SELECT (public.t_evalueaza($L, '$T')) -> 'semnale' -> 0 ->> 'clarificare' AS r"
  bariera
  pasA C3b "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
  asteaptaB; astept 00000 "$B_STARE" "B: publicarea termina"; astept neatinsa "$B_R" "B: ciorna editata → neatinsa"
  inchideA
  astept "1|propunere" "$(q "SELECT (CASE WHEN intrebare LIKE '%(editat de om)' THEN 1 ELSE 0 END) || '|' || status FROM public.ofertare_clarificari WHERE id = $C")" "textul omului ramane, status propunere"
  astept "t" "$(q "SELECT (baza_generare ? 'text_editat_de') FROM public.ofertare_clarificari WHERE id = $C")" "text_editat_de pus de trigger"
}

# ── c_sursa_dupa_verificare ──
echo "c_sursa_dupa_verificare (licitatia 900104)"
{
  L=900104; evalueaza "$L" > /dev/null; C="$(ciorna $L)"; aproba "$C" > /dev/null
  T="$(token)"; CANT="$(q "SELECT id FROM public.ofertare_cantitati WHERE licitatie_id = $L")"
  deschideA
  pasA C4a "BEGIN;" "$(caService)" "\\set r -" "SELECT (public.fn_ofertare_masuratori_propune($L, '$T', public.fn_ofertare_semnale_fotografie($L), '{\"plafon\": 200, \"plafon_atins\": false, \"pagini_necitite\": [], \"documente_necitite\": [], \"felii_incomplete\": []}'::jsonb)) ->> 'evaluare_id' AS r \\gset" "\\warn C4a_r :r"
  astept 00000 "$A_STARE" "A: propune (necomis)"; asteaptaA C4a_r; EV="$A_STARE"
  pasA C4b "SELECT (public.fn_ofertare_semnale_publica($L, $EV, '$T')) -> 'semnale' -> 0 ->> 'verdict';"; astept 00000 "$A_STARE" "A: publica dupa reverificarea fotografiei, NECOMISA (cantitatile FOR SHARE)"
  pornesteB "-- postgres: schimbarea sursei" "WITH x AS (UPDATE public.ofertare_cantitati SET cantitate = 6401 WHERE id = $CANT RETURNING 1) SELECT count(*)::text AS r FROM x"
  bariera
  pasA C4c "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
  asteaptaB; astept 00000 "$B_STARE" "B: UPDATE cantitate comis dupa A"
  inchideA
  ST="$(psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -tAc "BEGIN; $(ca $U_RESP) SELECT stare FROM public.v_ofertare_clarificari_baza WHERE id = $C; COMMIT;" | head -n 1)"
  astept schimbata "$ST" "dupa ambele commit-uri: starea bazei = schimbata"
  EX="$(psql -X -q -w -d "$BAZA" -tAc "BEGIN; $(ca $U_RESP) SELECT public.ofertare_clarificari_export($L); COMMIT;" 2>&1 | grep -o 'Export blocat: baza s-a schimbat — de reverificat' | head -n 1)"
  astept 'Export blocat: baza s-a schimbat — de reverificat' "$EX" "exportul blocat"
}

# ── perechile fără deadlock pe două ciorne cu nr inversat ──
pereche() {   # <scenariu> <lic> <prolog A> <sql A> <prolog B> <sql B (SELECT … AS r)>
  local S="$1" L="$2"
  echo "$S (licitatia $L): doua ciorne auto_surse_* cu nr in ordine inversa fata de id"
  local IDS; IDS="$(doua_ciorne "$L")"; echo "      ciorne (id1 id2 nr1 nr2): $IDS"
  set -- $IDS
  [ "$3" -gt "$4" ]; ok $? "nr-urile sunt inversate fata de id ($3 > $4)"
  local C1="$1" C2="$2"
  aproba "$C1" > /dev/null; aproba "$C2" > /dev/null
  astept "2" "$(q "SELECT count(*) FROM public.ofertare_clarificari WHERE licitatie_id = $L AND status = 'de_trimis'")" "ambele ciorne aprobate (de_trimis)"
  local PA="$5" SA="$6" PB="$7" SB="$8"
  deschideA
  pasA "${S}_a" "BEGIN;" "$PA" "$SA"; astept 00000 "$A_STARE" "A: prima functie, NECOMISA"
  pornesteB "$PB" "$SB"
  bariera
  pasA "${S}_b" "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
  asteaptaB; astept 00000 "$B_STARE" "B: a doua functie termina dupa A, fara 40P01 (mesaj: ${B_MSG:--})"
  inchideA
  astept "0" "$(q "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND application_name IN ('cm_A', 'cm_B') AND state <> 'idle'")" "nicio sesiune ramasa"
}
pereche c_export_vs_publicare 900105 "$(ca $U_RESP)" "SELECT jsonb_array_length(public.ofertare_clarificari_export(900105));" "$(caService)" "SELECT (public.t_evalueaza(900105, '$(token)')) ->> 'n' AS r"
pereche c_notifica_vs_publicare 900106 "$(ca $U_RESP)" "SELECT public.ofertare_clarificari_notifica(900106);" "$(caService)" "SELECT (public.t_evalueaza(900106, '$(token)')) ->> 'n' AS r"
pereche c_notifica_vs_export 900107 "$(ca $U_RESP)" "SELECT public.ofertare_clarificari_notifica(900107);" "$(ca $U_RESP)" "SELECT jsonb_array_length(public.ofertare_clarificari_export(900107))::text AS r"
# reconfirmarea (ține ciorna FOR UPDATE) vs publicarea (advisory + semnal, apoi ciornele): publicarea așteaptă și termină
{
  L=900108; evalueaza "$L" > /dev/null; C="$(ciorna $L)"
  echo "c_reconfirmare_vs_publicare (licitatia $L)"
  AMP="$(psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -tAc "BEGIN; $(ca $U_RESP) SELECT amprenta_curenta FROM public.v_ofertare_clarificari_baza WHERE id = $C; COMMIT;" | head -n 1)"
  deschideA
  pasA C8a "BEGIN;" "$(ca $U_RESP)" "SELECT public.ofertare_clarificare_reconfirma($C, '$AMP', 'revizuit', 'verificat de om in proba');"; astept 00000 "$A_STARE" "A: reconfirmarea tine ciorna FOR UPDATE, NECOMISA"
  pornesteB "$(caService)" "SELECT (public.t_evalueaza($L, '$(token)')) -> 'semnale' -> 0 ->> 'clarificare' AS r"
  bariera
  pasA C8b "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
  asteaptaB; astept 00000 "$B_STARE" "B: publicarea termina dupa commit, fara 40P01"; astept neatinsa "$B_R" "B: ciorna aprobata → neatinsa"
  inchideA
  astept "t" "$(q "SELECT (baza_generare ? 'reconfirmare') FROM public.ofertare_clarificari WHERE id = $C")" "reconfirmarea comisa ramane"
}

[ "$esec" = 0 ] && echo "TOTUL OK" || echo "ESEC: $esec"
