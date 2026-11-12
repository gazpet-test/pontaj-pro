# shellcheck shell=bash
# ============================================================================
# Runda 14 a runnerului (12.11.2026, portal r18): FORMA „UN MESAJ” a livrării cu plafon. Doar funcții (nimic nu rulează
# la `source`); folosite de scripts/livrare_migrare.sh (doar cu --plafon-tranzactie-ms) și de scripts/portal/dry_prod_e1.sh
# (proba pe producție cu ROLLBACK), ca proba să trimită EXACT textul livrării.
#
# DE CE: pe producție (pooler Supabase, de pe serverul din Ploiești) un drum client↔server = ~41 ms. Trimis instrucțiune
# cu instrucțiune (psql -f), 18a are ~59 de instrucțiuni de nivel superior + ~12 ale runnerului ⇒ doar așteptările de
# rețea depășesc plafonul de 2000 ms (proba din 12.11: sesiunea închisă de server pe la linia 373 din 627).
#
# CUM (sursa: documentația psql și a protocolului, PostgreSQL 17):
#   * psql `\gexec`: „Sends the current query buffer to the server, then treats each column of each row of the query's
#     output (if any) as an SQL statement to be executed … The generated queries are sent literally to the server for
#     processing, so they cannot be psql meta-commands nor contain psql variable references.” ⇒ celula = UN șir trimis
#     cu PQexec = UN mesaj Query (protocolul simplu).
#   * Protocolul, „Multiple Statements in a Simple Query”: un mesaj Query cu mai multe instrucțiuni le execută pe rând;
#     „If a failure occurs … the remaining statements are skipped”; BEGIN / COMMIT explicite din mesaj delimitează
#     tranzacția. Serverul citește mesajul ÎNTREG înainte să-l execute ⇒ între BEGIN și COMMIT nu există niciun drum
#     client↔server (încărcarea mesajului se face înaintea lui BEGIN și nu e numărată de ceas).
#   * Textul mesajului M ajunge la server ca literal $<tag>$…$<tag>$ (fără nicio prelucrare: psql nu interpretează nimic
#     într-un dollar-quote, serverul nu face escape-uri în el — același mecanism ca înregistrarea, 3_inreg), serverul îl
#     întoarce (SELECT), iar `\gexec` îl trimite înapoi ca mesaj.
#   * DOVADA, la fiecare livrare, în server: a doua instrucțiune după prolog (DO $mesaj_unic$) citește current_query()
#     (= textul ÎNTREGULUI mesaj în curs, „might contain more than one statement”) și cere: lungimea totală în octeți =
#     cea calculată de runner, sha256 al restului mesajului (de după verificare: 1_pre, copiile, înregistrările, garda,
#     COMMIT) = cel calculat de runner și sha256 al fiecărei copii, la poziția ei = sha256 APROBAT. Orice despărțire a
#     mesajului (alt psql, alt mecanism, instrucțiune cu instrucțiune) sau orice octet schimbat ⇒ MESAJ_UNIC, refuz
#     înaintea lock-urilor, nimic comis. Nu ne bazăm pe presupuneri despre psql: dacă un client ar trimite altfel,
#     livrarea se oprește.
# DE CE NU `psql -c "<fișier>"`: 18a are 48 KB, 19a 62 KB; linia de comandă Windows (CreateProcess) are 32.767 de
#   caractere ⇒ nu încape de pe serverul de livrare. DE CE NU „\;” între instrucțiunile artefactului: runnerul ar trebui
#   să re-împartă singur artefactul exact ca lexerul psql (citate, $tag$, comentarii, paranteze) și să-l RESCRIE; o
#   nepotrivire ar strica în tăcere un corp de funcție. Forma aleasă nu rescrie nimic: copia e trimisă octet cu octet.
#
# DIFERENȚE DE SEMANTICĂ față de forma instrucțiune-cu-instrucțiune (cunoscute, acceptate):
#   * serverul face analiza sintactică BRUTĂ a întregului mesaj la primire ⇒ standard_conforming_strings fixat de prolog
#     NU mai schimbă felul în care se citesc literalii din restul mesajului. Validatorul (runda 6) refuză orice backslash
#     în literalii '…' obișnuiți ⇒ artefactul se citește identic cu on / off; textul runnerului nu are backslash-uri în
#     literali. client_encoding: mesajul e convertit la primire cu codificarea conexiunii (PGCLIENTENCODING=UTF8);
#     sha256-urile din verificare (pe UTF8) prind orice conversie care ar schimba un octet.
#   * o eroare de sintaxă oriunde în mesaj îl oprește înainte de prima instrucțiune (oricum totul se anulează).
#   * statement_timestamp() e același pentru tot mesajul (= momentul primirii = transaction_timestamp()); now() și
#     clock_timestamp() — folosite de migrările portalului — nu se schimbă. statement_timeout se aplică fiecărei
#     instrucțiuni separat (PostgreSQL ≥ 13).
#   * meta-comenzile psql (\set, \i, \if …) și variabilele psql (:x) NU mai sunt interpretate (ajung la server ca text):
#     validatorul le refuză la nivel superior (cu și fără plafon), deci un artefact acceptat nu are niciuna.
#   * instrucțiunile care cer să ruleze în afara unei tranzacții (VACUUM, CREATE INDEX CONCURRENTLY …) erau refuzate
#     oricum (tranzacția runnerului).
# ============================================================================

# Citirea plafonului (aceeași ca în prolog și în validator).
LM_PLAFON_CITIRE="(SELECT setting || '/' || source FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout')"

# lm_octeti <fișier> — lungimea în octeți
lm_octeti() { wc -c <"$1" | tr -d ' \r\n'; }
# lm_sha <fișier> — sha256 hex
lm_sha() { sha256sum "$1" | cut -d' ' -f1; }

# lm_sep — despărțitorul de după fiecare copie: linie nouă (închide un eventual comentariu „--” final fără LF), apoi „;”
# (închide o eventuală ultimă instrucțiune fără „;”; dacă exista, rezultă o instrucțiune goală, ignorată de server).
lm_sep() { printf '\n;\n'; }

# lm_timp <nume> — NOTICE cu timpul de la BEGIN, după corpul + înregistrarea unei migrări (informativ, în jurnalul livrării).
lm_timp() {
  printf 'DO $lm_timp$ BEGIN RAISE NOTICE %s, pg_catalog.round(EXTRACT(epoch FROM pg_catalog.clock_timestamp() - pg_catalog.transaction_timestamp()) * 1000); END $lm_timp$;\n' \
    "'LIVRARE_TIMP $1: corp + inregistrare terminate la % ms de la BEGIN'"
}

# lm_fin <nume> <plafon_ms> <COMMIT|ROLLBACK> — garda finală (runda 12-13, neschimbată în conținut) urmată de instrucțiunea
# finală, în același mesaj (forma un mesaj: separatorul e „;”, nu „\;”). Garda raportează și timpul (PLAFON_TIMP).
lm_fin() {
  local NUME="$1" PLAFON_MS="$2" FINAL="$3"
  case "$FINAL" in COMMIT|ROLLBACK) ;; *) echo "lm_fin: final invalid $FINAL" >&2; return 2 ;; esac
  cat <<SQL
SET CONSTRAINTS ALL IMMEDIATE;
SET LOCAL search_path = pg_catalog, pg_temp;
DO \$plafon_fin\$ DECLARE v_amanabile text; BEGIN
  IF pg_catalog.age(pg_catalog.xid(pg_catalog.pg_current_xact_id())) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Livrare $NUME: PLAFON_AMANABIL: referinta tranzactiei curente (age = 0 pentru xid-ul de varf) nu se confirma - refuz, nimic comis'; END IF;
  SELECT pg_catalog.string_agg(o, ', ' ORDER BY o) INTO v_amanabile FROM (
    SELECT 'trigger ' || t.tgrelid::pg_catalog.regclass::pg_catalog.text || '.' || t.tgname AS o
      FROM pg_catalog.pg_trigger t WHERE t.tgdeferrable AND pg_catalog.age(t.xmin) <= 0
    UNION ALL
    SELECT 'constrangere ' || c.conname::pg_catalog.text
      FROM pg_catalog.pg_constraint c WHERE c.condeferrable AND pg_catalog.age(c.xmin) <= 0
    UNION ALL
    SELECT 'functia ' || p.oid::pg_catalog.regprocedure::pg_catalog.text || ' a triggerului ' || t.tgname::pg_catalog.text
      FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
     WHERE t.tgdeferrable AND pg_catalog.age(p.xmin) <= 0) s;
  IF v_amanabile IS NOT NULL THEN
    RAISE EXCEPTION 'Livrare $NUME: PLAFON_AMANABIL: obiecte amanabile create / modificate in tranzactie (%) - cod al artefactului ar putea rula in COMMIT, dupa garda; cu plafon se refuza (livrare fara optiune, cu review) - nimic comis', v_amanabile; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_cursors WHERE is_holdable) THEN
    RAISE EXCEPTION 'Livrare $NUME: PLAFON_CURSOR: cursor WITH HOLD deschis (s-ar executa in COMMIT, dupa garda) - refuz, nimic comis'; END IF;
  IF $LM_PLAFON_CITIRE IS DISTINCT FROM '$PLAFON_MS/session'
     OR pg_catalog.current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '$PLAFON_MS:' || pg_catalog.txid_current() THEN
    RAISE EXCEPTION 'Livrare $NUME: PLAFON_SCHIMBAT in tranzactie (% / marcaj %) - refuz, nimic comis',
      coalesce($LM_PLAFON_CITIRE, 'lipsa'), coalesce(pg_catalog.current_setting('gazpet.plafon_tranzactie', true), 'lipsa'); END IF;
  IF pg_catalog.clock_timestamp() - pg_catalog.transaction_timestamp() > interval '$PLAFON_MS milliseconds' THEN
    RAISE EXCEPTION 'Livrare $NUME: PLAFON_DEPASIT: % ms de la BEGIN > $PLAFON_MS ms fara inchiderea sesiunii (ceas oprit / repornit in tranzactie sau pauza inainte de garda) - refuz, nimic comis',
      round(extract(epoch FROM pg_catalog.clock_timestamp() - pg_catalog.transaction_timestamp()) * 1000); END IF;
  RAISE NOTICE 'PLAFON_TIMP $NUME: garda trecuta la % ms de la BEGIN (plafon $PLAFON_MS ms) - urmeaza $FINAL in acelasi mesaj',
    round(extract(epoch FROM pg_catalog.clock_timestamp() - pg_catalog.transaction_timestamp()) * 1000);
END \$plafon_fin\$;
$FINAL;
SQL
}

# lm_verif <eticheta> <total> <rest_poz> <rest_lung> <rest_sha> [<poz>:<lung>:<sha> …] — verificarea „un mesaj” (vezi antetul).
# Pozițiile sunt 1-based, în octeți, în mesajul întreg. Numerele au lățime FIXĂ (10 cifre, zerouri în față: literal întreg
# zecimal valid în SQL), deci lungimea textului nu depinde de valori ⇒ prefixul se poate măsura înainte de a le ști.
lm_verif() {
  local et="$1" total="$2" rpoz="$3" rlung="$4" rsha="$5" s poz lung sha
  shift 5
  local q="pg_catalog.convert_to(pg_catalog.current_query(), 'UTF8')"
  printf 'DO $mesaj_unic$ BEGIN\n'
  printf '  IF pg_catalog.octet_length(pg_catalog.current_query()) IS DISTINCT FROM %010d\n' "$total"
  printf "     OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.substring(%s, %010d, %010d)), 'hex') IS DISTINCT FROM '%s'\n" "$q" "$rpoz" "$rlung" "$rsha"
  for s in "$@"; do
    IFS=: read -r poz lung sha <<<"$s"
    printf "     OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.substring(%s, %010d, %010d)), 'hex') IS DISTINCT FROM '%s'\n" "$q" "$poz" "$lung" "$sha"
  done
  printf '  THEN\n'
  printf "    RAISE EXCEPTION 'Livrare %s: MESAJ_UNIC: tranzactia nu a ajuns la server intr-un singur mesaj sau nu e textul aprobat (%% octeti in mesajul curent, asteptat %010d) - refuz inaintea lock-urilor, nimic comis', pg_catalog.octet_length(pg_catalog.current_query()); END IF;\n" "$et" "$total"
  printf 'END $mesaj_unic$;\n'
}

# lm_mesaj <prolog> <rest> <ieșire M> <eticheta> [<poz_în_rest>:<lung>:<sha> …]
# M = „BEGIN;” + prolog (runnerul, 0_prolog.sql) + verificarea + rest. <poz_în_rest> = poziția 0-based a copiei în <rest>.
lm_mesaj() {
  local prolog="$1" rest="$2" out="$3" et="$4" s poz lung sha p lrest srest
  shift 4
  lrest="$(lm_octeti "$rest")"; srest="$(lm_sha "$rest")"
  local fals=()
  for s in "$@"; do IFS=: read -r poz lung sha <<<"$s"; fals+=("0:$lung:$sha"); done
  p="$( { printf 'BEGIN;\n'; cat "$prolog"; lm_verif "$et" 0 0 0 "$srest" ${fals[@]+"${fals[@]}"}; } | wc -c | tr -d ' \r\n')"
  local abs=()
  for s in "$@"; do IFS=: read -r poz lung sha <<<"$s"; abs+=("$((p + poz + 1)):$lung:$sha"); done
  { printf 'BEGIN;\n'; cat "$prolog"; lm_verif "$et" "$((p + lrest))" "$((p + 1))" "$lrest" "$srest" ${abs[@]+"${abs[@]}"}; cat "$rest"; } >"$out"
  [ "$(lm_octeti "$out")" = "$((p + lrest))" ] || { echo "lm_mesaj: lungimea prefixului depinde de valori (eroare interna)" >&2; return 3; }
}

# lm_trimite <M> <tag> <ieșire> — fișierul psql care trimite M ca un singur mesaj: SELECT $tag$<M>$tag$ \gexec.
# Refuz dacă tag-ul apare în M (literalul s-ar închide mai devreme).
lm_trimite() {
  local m="$1" tag="$2" out="$3"
  [[ "$tag" =~ ^lm_[0-9a-f]{16}$ ]] || { echo "lm_trimite: tag invalid" >&2; return 2; }
  if grep -qF "\$$tag\$" "$m"; then echo "lm_trimite: tag-ul \$$tag\$ apare in mesaj" >&2; return 3; fi
  { printf 'SELECT $%s$' "$tag"; cat "$m"; printf '$%s$ AS livrare_mesaj_unic \\gexec\n' "$tag"; } >"$out"
}
