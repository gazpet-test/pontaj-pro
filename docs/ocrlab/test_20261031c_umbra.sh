set -e
cd /tmp && rm -rf umbratest && cp -r /mnt/c/Users/Gazpet-Ai/ocrlab_tmp/umbra_test umbratest && cd umbratest && sed -i 's/\r$//' *.sql
pg_ctlcluster 16 main start 2>/dev/null || true; sleep 2
P="sudo -u postgres psql -X -q -v ON_ERROR_STOP=1"
$P -c "DROP DATABASE IF EXISTS umbra" -c "CREATE DATABASE umbra"
$P -d umbra <<'SQL'
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE public.ofertare_licitatii (id bigint PRIMARY KEY);
CREATE TABLE public.ofertare_documente_atribuire (id bigint PRIMARY KEY);
CREATE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true';
INSERT INTO public.ofertare_licitatii VALUES (15); INSERT INTO public.ofertare_documente_atribuire VALUES (212);
SQL
echo "== fara garda (trebuie refuz)"; $P -d umbra -f 20261031c_ofertare_citire_umbra.sql 2>&1 | grep -o "garda start invalida" || echo "!! LIPSA REFUZ"
echo "== aplicare cu garda"
$P -d umbra <<'SQL'
BEGIN;
SELECT set_config('gazpet.livrare_migrare', '20261031c_ofertare_citire_umbra:' || txid_current(), true) \gset
\i 20261031c_ofertare_citire_umbra.sql
COMMIT;
SQL
echo "== a doua aplicare (trebuie deja aplicata)"
$P -d umbra <<'SQL' 2>&1 | grep -o "deja aplicata" || echo "!! LIPSA REFUZ"
BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261031c_ofertare_citire_umbra:' || txid_current(), true) \gset
\i 20261031c_ofertare_citire_umbra.sql
COMMIT;
SQL
H=$(printf 'a%.0s' $(seq 64))
echo "== insert valid (postgres)"
$P -d umbra -c "INSERT INTO ofertare_citire_umbra (licitatie_id, document_id, pagina, banda, pdf_sha256, pagina_pdf, image_sha256, orientare, orientare_sursa, cititor, backend, model, prompt_versiune, ok, text, text_sha256, cost, citit_de) VALUES (15,212,58,'p0058_b0','$H',58,'$H',0,'laborator','cititor3','claude_cli','claude-opus-5-5','c3-v1',true,'x','$H','abonament','laborator') RETURNING id, stare"
echo "== constrangeri (fiecare trebuie refuzata)"
for bad in "banda='p58'" "orientare=45" "backend='alt'" "stare='promovat'" "ok=false" "cost='gratis'"; do
  $P -d umbra -c "UPDATE ofertare_citire_umbra SET $bad WHERE id=1" >/dev/null 2>&1 && echo "!! ACCEPTAT $bad" || echo "refuz ok: $bad"
done
$P -d umbra -c "UPDATE ofertare_citire_umbra SET stare='bun', stare_la=now() WHERE id=1" && echo "tranzitie stare cu stare_la: ok"
echo "== duplicat (UNIQUE)"; $P -d umbra -c "INSERT INTO ofertare_citire_umbra (licitatie_id, document_id, pagina, banda, pdf_sha256, pagina_pdf, image_sha256, orientare, orientare_sursa, cititor, backend, model, prompt_versiune, ok, text, text_sha256, cost, citit_de) VALUES (15,212,58,'p0058_b0','$H',58,'$H',0,'laborator','cititor3','claude_cli','claude-opus-5-5','c3-v1',true,'y','$H','abonament','laborator')" >/dev/null 2>&1 && echo "!! DUPLICAT ACCEPTAT" || echo "refuz ok: duplicat"
echo "== authenticated: select da, insert nu"
$P -d umbra -c "SET ROLE authenticated; SELECT count(*) FROM ofertare_citire_umbra;"
$P -d umbra -c "SET ROLE authenticated; INSERT INTO ofertare_citire_umbra (licitatie_id) VALUES (15)" >/dev/null 2>&1 && echo "!! INSERT ACCEPTAT" || echo "refuz ok: insert authenticated"
$P -d umbra -c "SET ROLE service_role; SELECT 1 FROM ofertare_citire_umbra" >/dev/null 2>&1 && echo "!! SELECT service_role" || echo "refuz ok: service_role fara select"
echo "== revenire refuzata cu promovat"
$P -d umbra -c "UPDATE ofertare_citire_umbra SET stare='promovat', stare_la=now() WHERE id=1"
$P -d umbra -f 20261031c_ofertare_citire_umbra_ROLLBACK.sql 2>&1 | grep -o "exista randuri promovate" || echo "!! LIPSA REFUZ"
$P -d umbra -c "UPDATE ofertare_citire_umbra SET stare='respins' WHERE id=1"
$P -d umbra -f 20261031c_ofertare_citire_umbra_ROLLBACK.sql && $P -d umbra -tAc "SELECT to_regclass('public.ofertare_citire_umbra') IS NULL" 
echo GATA
