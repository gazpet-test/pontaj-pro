set -e
cd /tmp && rm -rf umbratest && cp -r /mnt/c/Users/Gazpet-Ai/ocrlab_tmp/umbra_test umbratest && cd umbratest && sed -i 's/\r$//' *.sql
pg_ctlcluster 16 main start 2>/dev/null || true; sleep 2
P="sudo -u postgres psql -X -q -v ON_ERROR_STOP=1"
$P -c "DROP DATABASE IF EXISTS umbra" -c "CREATE DATABASE umbra"
$P -d umbra <<'SQL'
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE public.ofertare_documente_atribuire (id bigint PRIMARY KEY);
CREATE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true';
INSERT INTO public.ofertare_documente_atribuire VALUES (212), (213);
SQL
echo "== fara garda"; $P -d umbra -f 20261031c_ofertare_citire_umbra.sql 2>&1 | grep -o "garda start invalida" || echo "!! LIPSA REFUZ"
echo "== aplicare"
$P -d umbra <<'SQL'
BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261031c_ofertare_citire_umbra:' || txid_current(), true) \gset
\i 20261031c_ofertare_citire_umbra.sql
COMMIT;
SQL
echo "== a doua aplicare"
$P -d umbra <<'SQL' 2>&1 | grep -o "deja aplicata" || echo "!! LIPSA REFUZ"
BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261031c_ofertare_citire_umbra:' || txid_current(), true) \gset
\i 20261031c_ofertare_citire_umbra.sql
COMMIT;
SQL
H=$(printf 'a%.0s' $(seq 64))
INS="INSERT INTO ofertare_citire_umbra (document_id, pagina, pagina_offset, banda, pdf_sha256, pagina_pdf, image_sha256, orientare, orientare_sursa, cititor, backend, model, prompt_versiune, ok, text, text_sha256, text_extras_sha256, cost, citit_de)"
$P -d umbra -c "$INS VALUES (212,58,0,'p0058_b0','$H',58,'$H',0,'laborator','cititor3','claude_cli','claude-opus-5-5','c3-v1',true,'x','$H','$H','abonament','laborator')" && echo "insert valid: ok"
$P -d umbra -c "$INS VALUES (212,58,0,'p0058_b0','$H',58,'$H',0,'laborator','cititor3','api','claude-opus-5-5','c3-v1',true,'x','$H','$H','api','laborator')" && echo "acelasi item pe backend api: ok (P1-2)"
echo "== refuzuri"
for bad in "banda='p58'" "orientare=45" "backend='alt'" "stare='promovat'" "ok=false" "cost='gratis'" "pagina_pdf=99" "cost='api'"; do
  $P -d umbra -c "UPDATE ofertare_citire_umbra SET $bad WHERE id=1" >/dev/null 2>&1 && echo "!! ACCEPTAT $bad" || echo "refuz ok: $bad"
done
$P -d umbra -c "$INS VALUES (213,1,0,'p0001_b0','$H',1,'$H',0,'laborator','cititor3','claude_cli','m','c3-v1',true,'x','$H',NULL,'abonament','laborator')" >/dev/null
$P -d umbra -c "BEGIN; SELECT set_config('gazpet.promovare_umbra', 'UMBRA_PROMOVARE:' || txid_current(), true); UPDATE ofertare_citire_umbra SET stare='promovat', stare_la=now() WHERE id=3; COMMIT;" >/dev/null 2>&1 && echo "!! promovat fara CAS acceptat" || echo "refuz ok: promovat fara text_extras_sha256"
$P -d umbra -c "UPDATE ofertare_citire_umbra SET stare='promovat', stare_la=now() WHERE id=1" >/dev/null 2>&1 && echo "!! promovat fara armare" || echo "refuz ok: promovare fara armarea CAS"
$P -d umbra -c "BEGIN; SELECT set_config('gazpet.promovare_umbra', 'UMBRA_PROMOVARE:' || txid_current(), true); UPDATE ofertare_citire_umbra SET stare='promovat', stare_la=now() WHERE id=1; COMMIT;" && echo "promovat armat, cu CAS: ok"
$P -d umbra -c "$INS VALUES (213,2,0,'p0002_b0','$H',2,'$H',0,'laborator','cititor3','claude_cli','m','c3-v1',true,'x','$H','$H','abonament','laborator')" >/dev/null && $P -d umbra -tAc "SELECT text_sha256 = encode(sha256(convert_to('x','UTF8')),'hex') FROM ofertare_citire_umbra WHERE pagina=2"
$P -d umbra -c "INSERT INTO ofertare_citire_umbra (document_id, pagina, pagina_offset, banda, pdf_sha256, pagina_pdf, image_sha256, orientare, orientare_sursa, cititor, backend, model, prompt_versiune, ok, text, text_sha256, cost, citit_de, stare, stare_la) VALUES (213,3,0,'p0003_b0','$H',3,'$H',0,'laborator','cititor3','claude_cli','m','c3-v1',true,'x','$H','abonament','laborator','bun',now())" >/dev/null 2>&1 && echo "!! insert direct ne-neevaluat" || echo "refuz ok: insert doar neevaluat"
$P -d umbra -c "UPDATE ofertare_citire_umbra SET text='y' WHERE id=1" >/dev/null 2>&1 && echo "!! modificare promovat" || echo "refuz ok: promovat nemodificabil"
$P -d umbra -c "DELETE FROM ofertare_citire_umbra WHERE id=1" >/dev/null 2>&1 && echo "!! stergere promovat" || echo "refuz ok: promovat nesters"
$P -d umbra -c "DELETE FROM ofertare_documente_atribuire WHERE id=212" >/dev/null 2>&1 && echo "!! cascada a sters promovat" || echo "refuz ok: cascada blocata de promovat"
$P -d umbra -c "DELETE FROM ofertare_documente_atribuire WHERE id=213" && echo "cascada fara promovat: ok"
echo "== drepturi"
$P -d umbra -c "SET ROLE authenticated; SELECT count(*) FROM ofertare_citire_umbra;" -tA
$P -d umbra -c "SET ROLE authenticated; DELETE FROM ofertare_citire_umbra" >/dev/null 2>&1 && echo "!! DELETE authenticated" || echo "refuz ok: delete authenticated"
$P -d umbra -c "SET ROLE service_role; SELECT 1 FROM ofertare_citire_umbra" >/dev/null 2>&1 && echo "!! SELECT service_role" || echo "refuz ok: service_role"
echo "== revenire"
$P -d umbra -f 20261031c_ofertare_citire_umbra_ROLLBACK.sql 2>&1 | grep -o "garda start invalida" || echo "!! revenire fara garda"
$P -d umbra <<'SQL' 2>&1 | grep -o "exista randuri promovate" || echo "!! LIPSA REFUZ promovat"
BEGIN; SELECT set_config('gazpet.revenire_20261031c', 'UMBRA_C3_REVENIRE:' || txid_current(), true) \gset
\i 20261031c_ofertare_citire_umbra_ROLLBACK.sql
COMMIT;
SQL
$P -d umbra -c "ALTER TABLE ofertare_citire_umbra DISABLE TRIGGER ofertare_citire_umbra_pazeste" -c "UPDATE ofertare_citire_umbra SET stare='respins', stare_la=now()" -c "ALTER TABLE ofertare_citire_umbra ENABLE TRIGGER ofertare_citire_umbra_pazeste" >/dev/null
$P -d umbra <<'SQL'
BEGIN; SELECT set_config('gazpet.revenire_20261031c', 'UMBRA_C3_REVENIRE:' || txid_current(), true) \gset
\i 20261031c_ofertare_citire_umbra_ROLLBACK.sql
COMMIT;
SQL
$P -d umbra -tAc "SELECT to_regclass('public.ofertare_citire_umbra') IS NULL AND to_regprocedure('public.fn_ofertare_citire_umbra_pazeste()') IS NULL"
echo GATA
