#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — recitirea valului 1 (scripts/recitire_val1/*.sql, procedura docs/ofertare/RECITIRE_VAL1_PROCEDURA.md v5).
# PostgreSQL 16 local dedicat (/tmp/pg_rv1, 127.0.0.1:5450). Nu atinge producția.
# Bază: scheletul loturi + 20261024b + schelet extra cantități + 20261031a + 20261031b + recitire_val1_schelet.sql.
# Acoperă: pas0 · aplica (gărzi: sha manifest, whitelist, dubluri, integritate, calitate, sha text, licitație / pagini, CAS text /
# identitate / metadate / Storage, derivate pe fiecare tabel, session_user, NOWAIT) — la eșec nimic scris · aplica pozitiv (arhivă,
# proveniență validă, ultima) · aplica_rezultat (egalitate; modificare după COMMIT → refuz) · read-only · verifica (OK / depășit /
# nedovedit) · revino (CAS meta, derivate în plus, pozitiv, ultima proveniență = sha vechi, text nevalid) · revino_rezultat.
# Utilizare: bash scripts/test_recitire_val1.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR=/tmp/pg_rv1; PORT=5450; BAZA=ofertare_loturi_test; LUCRU=/tmp/rv1_lucru
S="$RADACINA/scripts/recitire_val1"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG lipsă ($PG_BIN)"
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_rv1" ] || mediu "$DATE_DIR există și nu e fixture — nu îl șterg"
  [ -f "$DATE_DIR/postmaster.pid" ] && { ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1 || true; }
  rm -rf "$DATE_DIR"
fi
mkdir -p "$DATE_DIR"; [ "$(id -u)" = 0 ] && chown postgres "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
touch "$DATE_DIR/.fixture_rv1"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_rv1.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
rm -rf "$LUCRU"; mkdir -p "$LUCRU"; chmod 777 "$LUCRU"
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/ofertare_loturi_mvp_schelet.sql" >/dev/null || esec "schelet"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '20261024b_ofertare_loturi_mvp:' || txid_current(), true);" \
  -f "$RADACINA/supabase/migrations/20261024b_ofertare_loturi_mvp.sql" >/dev/null || esec "20261024b"
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/ofertare_cantitati_b_schelet_extra.sql" >/dev/null || esec "schelet extra"
for M in 20261031a_ofertare_cantitati_b 20261031b_ofertare_text_scrie_cas; do
  "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$M:' || txid_current(), true);" \
    -f "$RADACINA/supabase/migrations/$M.sql" >/dev/null || esec "migrarea $M"
done
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/recitire_val1_schelet.sql" >/dev/null || esec "schelet recitire"
ok "bază: schelet + 20261024b + 20261031a + 20261031b + schelet recitire"

q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
# ── date: lic. 15 (212 offset 0, 213 offset 104) + lic. 3 (137); texte vechi; Storage ──
q "INSERT INTO public.ofertare_licitatii(id, nr_anunt) VALUES (15, 'X15') ON CONFLICT DO NOTHING" >/dev/null
q "INSERT INTO public.ofertare_documente_atribuire (id, licitatie_id, nume_original, tip, status_procesare, text_extras, procesat_la, fisier_path,
     size_bytes, pagina_offset, pagini, pagini_procesate, pagini_felie, pagini_necitite) VALUES
   (212, 15, 'Liste — p01_pag1-104.pdf', 'lista_cantitati', 'procesat', E'⟦PAGINA 1⟧\n| A | 100 m |\n⟦PAGINA 2⟧\nvechi 212', '2026-09-08 08:00:00.123456+00', 'lic15/212.pdf', 1000, 0, 2, 2, 8, '{}'),
   (213, 15, 'Liste — p02_pag105-176.pdf', 'lista_cantitati', 'procesat', E'⟦PAGINA 105⟧\nvechi 213\n⟦PAGINA 106⟧\n—', '2026-09-08 07:56:26.5+00', 'lic15/213.pdf', 2000, 104, 2, 2, 8, '{}'),
   (137, 3, 'F1.pdf', 'lista_cantitati', 'procesat', E'⟦PAGINA 1⟧\nvechi 137', '2026-09-09 21:12:19+00', 'lic3/137.pdf', 3000, 0, 1, 1, 8, '{}')" >/dev/null
q "INSERT INTO storage.objects (bucket_id, name, metadata, updated_at) VALUES
   ('ofertare', 'lic15/212.pdf', '{\"eTag\": \"\\\"e212\\\"\", \"size\": 1000}', '2026-09-08 07:39:53.123456+00'),
   ('ofertare', 'lic15/213.pdf', '{\"eTag\": \"\\\"e213\\\"\", \"size\": 2000}', '2026-09-08 07:39:55+00'),
   ('ofertare', 'lic3/137.pdf', '{\"eTag\": \"\\\"e137\\\"\", \"size\": 3000}', '2026-09-09 21:00:00+00')" >/dev/null
# whitelist-ul complet trebuie să existe pentru pas0: celelalte 17 documente, minimale, „procesat”
q "INSERT INTO public.ofertare_licitatii(id, nr_anunt) VALUES (5,'X5'),(93,'X93'),(103,'X103') ON CONFLICT DO NOTHING" >/dev/null
for D in 138 139 165 166 167 168 169 170 171 434 1288 1289 1290 1291 1292 1293 1294; do
  L=3; case $D in 16*|17*) L=5;; 434) L=93;; 12*) L=103;; esac
  q "INSERT INTO public.ofertare_documente_atribuire (id, licitatie_id, nume_original, tip, status_procesare, text_extras, fisier_path, pagini, pagini_procesate)
     VALUES ($D, $L, 'd$D.pdf', 'lista_cantitati', 'procesat', 'x', 'p/$D.pdf', 1, 1)" >/dev/null
done
o="$("${PSQL[@]}" -d "$BAZA" -f "$S/pas0.sql" 2>&1)" || esec "pas0: $o"; grep -q 'pas 0 OK' <<<"$o" || esec "pas0: $o"; ok "pas0 (20 de documente, zero atașate)"

# ── fișierele procedurii (ca la asambleaza.ts): manifest + texte (base64) + sha256 al manifestului ──
python3 - "$LUCRU" <<'PY'
import base64, csv, hashlib, io, sys
d = sys.argv[1]
nou = {212: '⟦PAGINA 1⟧\n| A | 100 m |\n| B | 50 m |\n⟦PAGINA 2⟧\nnou 212', 213: '⟦PAGINA 105⟧\nnou 213\n⟦PAGINA 106⟧\n| C | 7 m |', 137: '⟦PAGINA 1⟧\nnou 137'}
vechi = {212: '⟦PAGINA 1⟧\n| A | 100 m |\n⟦PAGINA 2⟧\nvechi 212', 213: '⟦PAGINA 105⟧\nvechi 213\n⟦PAGINA 106⟧\n—', 137: '⟦PAGINA 1⟧\nvechi 137'}
meta = {212: (15, 2, 'lic15/212.pdf', 1000, 0, '"e212"', 1000, '2026-09-08T07:39:53.123Z', '2026-09-08T08:00:00.123456+00:00', 2, 8),
        213: (15, 2, 'lic15/213.pdf', 2000, 104, '"e213"', 2000, '2026-09-08T07:39:55.000Z', '2026-09-08T07:56:26.5+00:00', 2, 8),
        137: (3, 1, 'lic3/137.pdf', 3000, 0, '"e137"', 3000, '2026-09-09T21:00:00.000Z', '2026-09-09T21:12:19+00:00', 1, 8)}
sha = lambda s: hashlib.sha256(s.encode()).hexdigest()
H = ['document_id','licitatie_id','pagini','sha_vechi','sha_nou','fisier_path','size_bytes','pagina_offset','pdf_sha256','storage_etag','storage_size',
     'storage_updated_at','meta_status_procesare','meta_pagini_necitite','meta_procesat_la','meta_pagini_procesate','meta_pagini_felie','integritate_ok',
     'calitate_ok','calitate_acceptata_nominal','motiv_acceptare']
def manifest(rows, nume):
    b = io.StringIO(); w = csv.writer(b, lineterminator='\n'); w.writerow(H)
    for r in rows: w.writerow(r)
    t = b.getvalue(); open(f'{d}/{nume}', 'w', newline='').write(t); open(f'{d}/{nume}.sha', 'w').write(hashlib.sha256(t.encode()).hexdigest())
def rand(i, **x):
    l, p, path, sz, off, et, ssz, sup, pl, pp, pf = meta[i]
    r = dict(zip(H, [i, l, p, sha(vechi[i]), sha(nou[i]), path, sz, off, 'pdfsha', et, ssz, sup, 'procesat', '{}', pl, pp, pf, 'true', 'true', 'false', '']))
    r.update({k: v for k, v in x.items()}); return [r[h] for h in H]
def texte(nume, ids, alt=None):
    b = io.StringIO(); w = csv.writer(b, lineterminator='\n'); w.writerow(['document_id', 'text_b64'])
    for i in ids: w.writerow([i, base64.b64encode(((alt or {}).get(i, nou[i])).encode()).decode()])
    open(f'{d}/{nume}', 'w', newline='').write(b.getvalue())
ok = [rand(213), rand(212), rand(137)]
manifest(ok, 'manifest_aprobat.csv'); texte('texte.csv', [212, 213, 137])
manifest(ok + [rand(212)], 'm_dublat.csv')
manifest([rand(212, document_id=999)], 'm_whitelist.csv')
manifest([rand(212, integritate_ok='false')], 'm_integritate.csv')
manifest([rand(212, calitate_ok='false')], 'm_calitate.csv')
manifest([rand(212, calitate_ok='false', calitate_acceptata_nominal='true', motiv_acceptare='verificat de Razvan in PDF')], 'm_nominal.csv')
manifest([rand(212, licitatie_id=3)], 'm_licitatie.csv')
manifest([rand(212)], 'm_212.csv'); texte('t_212.csv', [212]); texte('t_212_alt.csv', [212], {212: 'alt text'})
PY
sha() { cat "$LUCRU/$1.sha"; }
CK="SELECT md5(concat((SELECT string_agg(id || ':' || md5(coalesce(text_extras,'')) || status_procesare || coalesce(procesat_la::text,'') || pagini_procesate, ',' ORDER BY id) FROM public.ofertare_documente_atribuire),
   (SELECT count(*) FROM public.ofertare_doc_texte_prov), (SELECT count(*) FROM public.ofertare_doc_texte)))"
ck() { q "$CK"; }
aplica() {  # $1 manifest, $2 texte, $3 sha, $4 rol (implicit postgres)
  "$PG_BIN/psql" -X -q -1 -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U "${4:-postgres}" -d "$BAZA" -v manifest="$LUCRU/$1" -v texte="$LUCRU/$2" \
    -v manifest_sha256="$3" -v provizoriu="$LUCRU/aplicare_provizoriu.csv" -f "$S/aplica.sql" 2>&1
}
refuz_aplica() { local o c0; c0="$(ck)"; o="$(aplica "$2" "$3" "$4" "${6:-postgres}" || true)"; grep -q "$5" <<<"$o" || esec "$1 trebuia refuzat ($5): $o"
  [ "$(ck)" = "$c0" ] || esec "$1: s-a scris ceva la refuz"; ok "refuz fără scriere: $1"; }

# ── aplica: gărzile de intrare ──
refuz_aplica "sha manifest diferit de „da”" manifest_aprobat.csv texte.csv 0000 'nu e cel aprobat'
refuz_aplica "whitelist" m_whitelist.csv t_212.csv "$(sha m_whitelist.csv)" 'whitelist'
refuz_aplica "document dublat" m_dublat.csv texte.csv "$(sha m_dublat.csv)" 'dublat'
refuz_aplica "integritate excepție" m_integritate.csv t_212.csv "$(sha m_integritate.csv)" 'integritatea nu se poate excepta'
refuz_aplica "calitate fără acceptare" m_calitate.csv t_212.csv "$(sha m_calitate.csv)" 'calitate neacceptată'
refuz_aplica "text ≠ sha_nou" m_212.csv t_212_alt.csv "$(sha m_212.csv)" 'nu are sha_nou'
refuz_aplica "licitație diferită" m_licitatie.csv t_212.csv "$(sha m_licitatie.csv)" 'licitație / pagini'
refuz_aplica "rol ≠ postgres" m_212.csv t_212.csv "$(sha m_212.csv)" 'garda: session_user' rv1_test
# ── aplica: CAS (se strică, se refuză, se repune) ──
cas() { q "$2" >/dev/null; refuz_aplica "CAS $1" m_212.csv t_212.csv "$(sha m_212.csv)" "$3"; q "$4" >/dev/null; }
cas "text" "UPDATE public.ofertare_documente_atribuire SET text_extras = text_extras || ' ' WHERE id = 212" 'textul s-a schimbat' \
    "UPDATE public.ofertare_documente_atribuire SET text_extras = rtrim(text_extras, ' ') WHERE id = 212"
cas "identitate" "UPDATE public.ofertare_documente_atribuire SET fisier_path = 'x' WHERE id = 212" 'identitatea' \
    "UPDATE public.ofertare_documente_atribuire SET fisier_path = 'lic15/212.pdf' WHERE id = 212"
cas "metadate" "UPDATE public.ofertare_documente_atribuire SET procesat_la = procesat_la + interval '1 microsecond' WHERE id = 212" 'metadatele' \
    "UPDATE public.ofertare_documente_atribuire SET procesat_la = procesat_la - interval '1 microsecond' WHERE id = 212"
cas "Storage" "UPDATE storage.objects SET updated_at = updated_at + interval '1 second' WHERE name = 'lic15/212.pdf'" 'Storage' \
    "UPDATE storage.objects SET updated_at = updated_at - interval '1 second' WHERE name = 'lic15/212.pdf'"
# ── aplica: derivate, câte unul pe fiecare tabel din §2.1 ──
der() { q "$2" >/dev/null; refuz_aplica "derivat $1" m_212.csv t_212.csv "$(sha m_212.csv)" 'are derivate'; q "$3" >/dev/null; }
der cerinte "INSERT INTO public.ofertare_cerinte (id, licitatie_id, surse_document_ids) VALUES (900, 15, '{212}')" "DELETE FROM public.ofertare_cerinte WHERE id = 900"
der cantitati "INSERT INTO public.ofertare_cantitati (licitatie_id, denumire, surse_document_ids) VALUES (15, 'x', '{212}')" "DELETE FROM public.ofertare_cantitati WHERE 212 = ANY (surse_document_ids)"
der clauze "INSERT INTO public.ofertare_clauze_contract (licitatie_id, document_id) VALUES (15, 212)" "DELETE FROM public.ofertare_clauze_contract"
der formulare "INSERT INTO public.ofertare_formulare_registru (licitatie_id, document_sursa_id) VALUES (15, 212)" "DELETE FROM public.ofertare_formulare_registru"
der triere "INSERT INTO public.ofertare_triere (licitatie_id, doc_id) VALUES (15, 212)" "DELETE FROM public.ofertare_triere"
der raspunsuri "INSERT INTO public.ofertare_raspuns_set_doc (set_id, document_id) VALUES (1, 212)" "DELETE FROM public.ofertare_raspuns_set_doc"
der analiza "UPDATE public.ofertare_documente_atribuire SET analiza = '{\"citire_noi\": {}}' WHERE id = 212" "UPDATE public.ofertare_documente_atribuire SET analiza = NULL WHERE id = 212"
der garda "INSERT INTO public.ofertare_ingest_garda (doc_id) VALUES (212)" "DELETE FROM public.ofertare_ingest_garda"
der provenienta "SELECT public.fn_ofertare_cb_text_scrie(212, (SELECT text_extras FROM public.ofertare_documente_atribuire WHERE id = 212), 'transcriere', 'test', 'integral', '{}')" \
    "ALTER TABLE public.ofertare_doc_texte_prov DISABLE TRIGGER USER; DELETE FROM public.ofertare_doc_texte_prov WHERE document_id = 212; ALTER TABLE public.ofertare_doc_texte_prov ENABLE TRIGGER USER"
der decizii_b "INSERT INTO public.ofertare_cant_doc_decizii (licitatie_id, document_id, doc_sha256, decizie, motiv, decis_de) VALUES (15, 212, repeat('b', 64), 'text_confirmat', 'test', '00000000-0000-4000-8000-000000000121')"     "ALTER TABLE public.ofertare_cant_doc_decizii DISABLE TRIGGER USER; DELETE FROM public.ofertare_cant_doc_decizii WHERE document_id = 212; ALTER TABLE public.ofertare_cant_doc_decizii ENABLE TRIGGER USER"
der snapshot "ALTER TABLE public.ofertare_analiza_versiuni DISABLE TRIGGER USER; INSERT INTO public.ofertare_analiza_versiuni (licitatie_id, lot_domeniu, tip, declansator, moment_referinta, inghetat_tardiv, eligibilitate, doc_manifest, clarificari, amprenta) VALUES (15, 'toate', 'initiala', 'manual', now(), false, 'exacta', '[{\"document_id\": 212}]', '[]', repeat('a', 64)); ALTER TABLE public.ofertare_analiza_versiuni ENABLE TRIGGER USER"     "ALTER TABLE public.ofertare_analiza_versiuni DISABLE TRIGGER USER; DELETE FROM public.ofertare_analiza_versiuni; ALTER TABLE public.ofertare_analiza_versiuni ENABLE TRIGGER USER"
# ── NOWAIT: documentul ținut de altă sesiune → refuz imediat, nu așteptare ──
( "${PSQL[@]}" -d "$BAZA" -c "BEGIN; SELECT 1 FROM public.ofertare_documente_atribuire WHERE id = 212 FOR UPDATE; SELECT pg_sleep(6); COMMIT;" >/dev/null 2>&1 & )
sleep 1
t0=$(date +%s); refuz_aplica "document ocupat (NOWAIT)" m_212.csv t_212.csv "$(sha m_212.csv)" 'could not obtain lock'; t1=$(date +%s)
[ $((t1 - t0)) -lt 4 ] || esec "NOWAIT a așteptat $((t1 - t0)) s"; sleep 6

# ── aplica: pozitiv (3 documente) ──
# pozitiv, cu pauza de test de 3 s după LOCK TABLE: un INSERT concurent în ofertare_cerinte AȘTEAPTĂ și intră DUPĂ COMMIT
"$PG_BIN/psql" -X -q -1 -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" -v manifest="$LUCRU/manifest_aprobat.csv" -v texte="$LUCRU/texte.csv"   -v manifest_sha256="$(sha manifest_aprobat.csv)" -v provizoriu="$LUCRU/aplicare_provizoriu.csv" -v pauza=3 -f "$S/aplica.sql" > "$LUCRU/aplica.log" 2>&1 &
PID=$!; sleep 1.5
t0=$(date +%s%N); q "INSERT INTO public.ofertare_cerinte (id, licitatie_id, sursa_document_id) VALUES (902, 3, 137)" >/dev/null; t1=$(date +%s%N)
wait $PID || esec "aplica pozitiv: $(cat "$LUCRU/aplica.log")"
[ $(( (t1 - t0) / 1000000 )) -ge 1000 ] || esec "INSERT-ul concurent n-a așteptat lock-ul ($(( (t1 - t0) / 1000000 )) ms)"
[ "$(q "SELECT count(*) FROM public.ofertare_cerinte WHERE id = 902")" = 1 ] || esec "INSERT-ul concurent lipsă"
ok "LOCK TABLE SHARE: INSERT concurent în derivate a așteptat $(( (t1 - t0) / 1000000 )) ms și a intrat după COMMIT"
q "DELETE FROM public.ofertare_cerinte WHERE id = 902" >/dev/null
[ -s "$LUCRU/aplicare_provizoriu.csv" ] || esec "provizoriu lipsă"
[ "$(q "SELECT count(*) FROM public.ofertare_documente_atribuire WHERE id IN (212,213,137) AND text_extras LIKE '%nou%'")" = 3 ] || esec "texte neaplicate"
[ "$(q "SELECT count(*) FROM public.ofertare_doc_texte WHERE licitatie_id IN (3,15)")" = 6 ] || esec "arhiva (vechi + nou)"
[ "$(q "SELECT public.fn_ofertare_cb_text_valid(15, 213, encode(sha256(convert_to(text_extras,'UTF8')),'hex'))->>'tip' FROM public.ofertare_documente_atribuire WHERE id = 213")" = prov ] || esec "text valid prin proveniență"
ok "aplica: 3 documente, arhivă vechi + nou, proveniență validă"
# ── aplica_rezultat: egalitate + read-only; modificare după COMMIT → refuz ──
rez() { "$PG_BIN/psql" -X -q -1 -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" -v provizoriu="$LUCRU/aplicare_provizoriu.csv" -v rezultat="$LUCRU/aplicare_rezultat.csv" -f "$S/aplica_rezultat.sql" 2>&1; }
q "UPDATE public.ofertare_documente_atribuire SET pagini_felie = 4 WHERE id = 137" >/dev/null
o="$(rez || true)"; grep -q 'diferă de RETURNING' <<<"$o" || esec "aplica_rezultat după modificare: $o"; [ ! -e "$LUCRU/aplicare_rezultat.csv" ] || esec "rezultat scris la refuz"
ok "refuz: aplica_rezultat după o modificare post-COMMIT (nu devine referință)"
q "UPDATE public.ofertare_documente_atribuire SET pagini_felie = 8 WHERE id = 137" >/dev/null
C1="$(ck)"; rez >/dev/null || esec "aplica_rezultat: $(rez)"; [ "$(ck)" = "$C1" ] || esec "aplica_rezultat a scris în BD"
[ "$(wc -l < "$LUCRU/aplicare_rezultat.csv")" = 4 ] || esec "rezultat: număr de rânduri"; ok "aplica_rezultat: egal, read-only, rezultat scris"
# ── verifica ──
ver() { "$PG_BIN/psql" -X -q -1 -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" -v rezultat="$LUCRU/aplicare_rezultat.csv" -f "$S/verifica.sql" 2>&1; }
o="$(ver)" || esec "verifica: $o"; grep -q 'verificare OK' <<<"$o" || esec "verifica: $o"; [ "$(ck)" = "$C1" ] || esec "verifica a scris"; ok "verifica: OK, read-only"
q "INSERT INTO public.ofertare_cerinte (id, licitatie_id, sursa_document_id) VALUES (901, 15, 212)" >/dev/null
o="$(ver)" || esec "verifica cu nedovedit: $o"; grep -q 'cerinte:1' <<<"$o" || esec "nedovedit nelistat: $o"; ok "verifica: derivat fără versiune → „nedovedit” listat"
q "INSERT INTO public.ofertare_cant_doc_decizii (licitatie_id, document_id, doc_sha256, decizie, motiv, decis_de)
   SELECT 15, 212, sha_vechi, 'text_confirmat', 'test', '00000000-0000-4000-8000-000000000121' FROM (SELECT '$(python3 -c "import hashlib;print(hashlib.sha256('⟦PAGINA 1⟧\n| A | 100 m |\n⟦PAGINA 2⟧\nvechi 212'.encode()).hexdigest())")'::text AS sha_vechi) s" >/dev/null 2>&1 \
  || q "ALTER TABLE public.ofertare_cant_doc_decizii DISABLE TRIGGER USER; INSERT INTO public.ofertare_cant_doc_decizii (licitatie_id, document_id, doc_sha256, decizie, motiv, decis_de) VALUES (15, 212, repeat('a', 64), 'text_confirmat', 'test', '00000000-0000-4000-8000-000000000121'); ALTER TABLE public.ofertare_cant_doc_decizii ENABLE TRIGGER USER" >/dev/null
o="$(ver || true)"; grep -q 'verificare EȘUATĂ' <<<"$o" || esec "derivat pe text depășit neprins: $o"; ok "verifica: derivat pe text depășit → EȘUATĂ"
# ── revino ──
rev() { "$PG_BIN/psql" -X -q -1 -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" -v manifest="$LUCRU/manifest_aprobat.csv" \
  -v manifest_sha256="$(sha manifest_aprobat.csv)" -v rezultat="$LUCRU/aplicare_rezultat.csv" -v documente="$1" -v provizoriu="$LUCRU/revenire_provizoriu.csv" -f "$S/revino.sql" 2>&1; }
C2="$(ck)"; o="$(rev 212 || true)"; grep -q 'în plus' <<<"$o" || esec "revino cu derivate: $o"; [ "$(ck)" = "$C2" ] || esec "revino a scris la refuz"; ok "refuz fără scriere: revino cu derivate / decizii în plus"
q "DELETE FROM public.ofertare_cerinte WHERE id = 901; ALTER TABLE public.ofertare_cant_doc_decizii DISABLE TRIGGER USER; DELETE FROM public.ofertare_cant_doc_decizii WHERE document_id = 212; ALTER TABLE public.ofertare_cant_doc_decizii ENABLE TRIGGER USER" >/dev/null
q "UPDATE public.ofertare_documente_atribuire SET pagini_felie = 2 WHERE id = 212" >/dev/null
o="$(rev 212 || true)"; grep -q 'starea de după aplicare' <<<"$o" || esec "revino CAS meta: $o"; ok "refuz: revino cu metadate schimbate după aplicare (CAS pe meta_aplicat)"
q "UPDATE public.ofertare_documente_atribuire SET pagini_felie = 8 WHERE id = 212" >/dev/null
o="$(rev 212)" || esec "revino pozitiv: $o"
[ "$(q "SELECT text_extras LIKE '%vechi 212%' AND procesat_la = '2026-09-08 08:00:00.123456+00' FROM public.ofertare_documente_atribuire WHERE id = 212")" = t ] || esec "revino: text / meta_vechi"
[ "$(q "SELECT origine || '/' || producator FROM public.ofertare_doc_texte_prov WHERE document_id = 212 ORDER BY constatat_la DESC, id DESC LIMIT 1")" = sinteza_ai/revenire-recitire ] || esec "revino: ultima proveniență"
[ "$(q "SELECT public.fn_ofertare_cb_text_valid(15, 212, encode(sha256(convert_to(text_extras,'UTF8')),'hex')) FROM public.ofertare_documente_atribuire WHERE id = 212")" = '{}' ] || esec "revino: textul vechi a devenit valid"
[ "$(q "SELECT text_extras LIKE '%nou 213%' FROM public.ofertare_documente_atribuire WHERE id = 213")" = t ] || esec "revino a atins 213"
"$PG_BIN/psql" -X -q -1 -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" -v provizoriu="$LUCRU/revenire_provizoriu.csv" \
  -v rezultat="$LUCRU/revenire_rezultat.csv" -f "$S/revino_rezultat.sql" >/dev/null 2>&1 || esec "revino_rezultat"
ok "revino 212: text + metadate vechi, ultima proveniență sinteza_ai, text nevalid pentru B; 213 neatins; revino_rezultat"
o="$(rev 212 || true)"; grep -q 'nu mai e cel recitit' <<<"$o" || esec "revino dublu: $o"; ok "refuz: a doua revenire (CAS)"
echo "PASS"
