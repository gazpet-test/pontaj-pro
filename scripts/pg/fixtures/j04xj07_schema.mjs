// Schema pentru suita extinsă J04×J07 (scripts/pg/test_j04xj07.mjs): ACELAȘI lanț ca harness-ul de integrare
// (scripts/pg/test_j04_j07_integrare.mjs) — fixture R5 + R08 + R12 + R11 + J02 + J05 + matrice + Storage R12 —
// apoi migrările reale J04 → J07, reaplicate o dată (idempotență). Nu conține BEGIN/COMMIT: runner-ul decide.
// Tot SQL-ul de business vine din repo (supabase/migrations + docs/R5_*); aici doar îl ordonăm.
import assert from 'node:assert/strict'
import { cuGarda } from './livrare_garda.mjs'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const migration = n => read('supabase/migrations/' + n)
const transactionBody = s => s.replace(/^(BEGIN|COMMIT);\s*$/gm, '')

export const J04 = '20260930a_ofertare_pachet_hash_server_jakv202.sql'
export const J07 = '20261003a_ofertare_poarta_server_jakv2p3.sql'
export const OWNER = '00000000-0000-4000-8000-000000000121'
export const EDITOR = '00000000-0000-4000-8000-000000000007'
export const DENIED = '00000000-0000-4000-8000-000000000099'
// Funcțiile pe care J04/J07 le ating sau lângă care stau (paritate înainte/după, idempotență).
export const FUNCTII = ['fn_gate_depunere', 'fn_ofertare_pt_pachet_poarta_documentatie', 'fn_pt_pachet_depus_verifica',
  'fn_ofertare_pt_pachet_matrice', 'fn_gate_depunere_derogare_owner', 'ofertare_r5_blocaj_sursa']

// Amprentele LIVE (read-only, producție, 06.10.2026): md5(prosrc)|SECDEF|volatilitate|proconfig|ACL. Fixture-ul de mai jos
// (R5 + lanț + transplantul J02b/J05 + j04xj07_live_0610.sql) trebuie să le reproducă EXACT; altfel setup-ul refuză.
export const LIVE_0610 = {
  fn_are_acces_ofertare: '429d28e2a61fb24c8009d67050c16c85|true|s|search_path=public, pg_temp|authenticated=X/postgres postgres=X/postgres service_role=X/postgres',
  fn_gate_depunere: '04102c5e44af4f5fc2062c1a58737bdd|true|v|search_path=public, pg_temp|postgres=X/postgres service_role=X/postgres',
  fn_gate_depunere_derogare_owner: 'e97f091143d6b492b6fdedf03dd283ea|true|s|search_path=public, pg_temp|postgres=X/postgres service_role=X/postgres',
  fn_ofertare_obiect_in_pachet_inghetat: '7e5642bf7088820ac5c3410e6baac374|true|s|search_path=public, pg_temp|authenticated=X/postgres postgres=X/postgres service_role=X/postgres',
  fn_ofertare_pt_pachet_matrice: '8e3f652c8bd2a918325713b22e1230cf|true|v|search_path=public, pg_temp|postgres=X/postgres service_role=X/postgres',
  fn_ofertare_pt_pachet_poarta_documentatie: '68620a64bc87b3d9cbb80df629df8e93|true|v|search_path=public, pg_temp|postgres=X/postgres service_role=X/postgres',
  fn_pt_pachet_depus_verifica: '2fdd91f228fd49410aa4c7f971037f1f|true|v|search_path=public, pg_temp|postgres=X/postgres service_role=X/postgres',
  ofertare_derogare_depunere: '50656c3c958e3a822c9ea1c3f70ae7d9|true|v|search_path=public, pg_temp|authenticated=X/postgres postgres=X/postgres',
  ofertare_r5_blocaj_sursa: '7db256eeeddd24916bdb1cc80c7b2e61|false|s|search_path=public, pg_temp|postgres=X/postgres service_role=X/postgres',
}

// Împarte un fișier SQL în instrucțiuni de nivel superior (respectă comentarii, '…', $tag$…$tag$).
export function instructiuniSql(s) {
  const out = []
  let i = 0, start = 0
  while (i < s.length) {
    if (s.startsWith('--', i)) { const j = s.indexOf('\n', i); i = j < 0 ? s.length : j + 1; continue }
    if (s.startsWith('/*', i)) { i = s.indexOf('*/', i + 2) + 2; continue }
    const c = s[i]
    if (c === "'") { let j = i + 1; for (;;) { const k = s.indexOf("'", j); if (s[k + 1] === "'") { j = k + 2; continue } i = k + 1; break } continue }
    if (c === '$') { const m = /^\$[A-Za-z_0-9]*\$/.exec(s.slice(i)); if (m) { i = s.indexOf(m[0], i + m[0].length) + m[0].length; continue } }
    if (c === ';') { out.push(s.slice(start, i + 1)); start = i + 1 }
    i++
  }
  if (s.slice(start).trim()) out.push(s.slice(start))
  return out
}
const corp = x => x.replace(/^(\s*--[^\n]*\n|\s+)+/, '')
// Transplantul J02b (20261004a) + garda J05 (20261001a), aplicate pe live: aceleași instrucțiuni de schemă, fără gărzile de
// livrare, fără blocurile DO de pre/post/verdict/view (pinuite pe starea live din 30.09) și fără tabelul de revenire J02b.
export function transplantJ02bJ05() {
  const scoate = [/^DO \$/, /^CREATE TEMP TABLE/, /^DROP TABLE pg_temp/, /ofertare_j02b_rollback_def/, /^SET LOCAL/]
  const filtreaza = n => instructiuniSql(migration(n)).filter(x => !scoate.some(p => p.test(corp(x))))
  const j02b = filtreaza('20261004a_ofertare_j02b_na_confirmare_umana.sql')
  const j05 = filtreaza('20261001a_ofertare_derogare_garda_j05.sql')
  assert.ok(j02b.some(x => /CREATE OR REPLACE FUNCTION public\.fn_gate_depunere\(\)/.test(x)), 'Transplant J02b: poarta lipsește')
  assert.ok(j05.some(x => /fn_ofertare_derogare_garda_j05/.test(x)), 'Transplant J05: garda lipsește')
  return [...j02b, ...j05].join('\n')
}

export function schemaJ04J07() {
  assert.ok([J04, J07].sort()[0] === J04, 'Ordinea lexicografică trebuie să fie J04 → J07')
  const j04 = cuGarda(J04, migration(J04))
  const j07 = cuGarda(J07, transactionBody(migration(J07)))
  assert.ok(!/(CREATE|ALTER|DROP)(\s+OR\s+REPLACE)?\s+FUNCTION\s+public\.fn_pt_pachet_depus_verifica/.test(j07), 'J07 nu atinge funcția J04 (doar o citește în precondiție)')
  assert.ok(!/fn_ofertare_pt_pachet_poarta_documentatie|fn_gate_depunere/.test(j04), 'J04 nu atinge funcțiile patch-uite de J07')

  const r5Harness = read('scripts/pg/test_r9b_probe23.mjs')
  let base = r5Harness.split('const fixtureSql = `')[1]?.split('`\n\nfunction setup')[0]
  assert.ok(base, 'Fixture-ul R5 trebuie să fie identificabil')
  base = base.replaceAll('${OWNER}', OWNER).replaceAll('${RESPONSABIL}', EDITOR).replaceAll('${FARA_ACCES}', DENIED)
  assert.ok(!base.includes('${'), 'Fixture R5: interpolare necunoscută')
  const r5 = ['R5_MIGRARE_PROPUSA_aprobare_istoric.sql', 'R5_MIGRARE_1b_prag_exact.sql',
    'R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql', 'R5_MIGRARE_3_review_copilot.sql']
    .map(n => transactionBody(read('docs/' + n))).join('\n')
  const copilot = migration('20260928m_r07_r12_copilot.sql')
  const helperStart = copilot.indexOf('CREATE OR REPLACE FUNCTION public.fn_gate_depunere_derogare_owner()')
  const helperEnd = copilot.indexOf('END $mig$;', helperStart) + 'END $mig$;'.length
  const storageGate = copilot.slice(copilot.indexOf('CREATE OR REPLACE FUNCTION public.fn_ofertare_obiect_in_pachet_inghetat'))
  assert.ok(helperStart > 0 && helperEnd > helperStart && storageGate.includes('ofertare_storage_upd'))
  const lista = `ARRAY[${FUNCTII.map(f => `'${f}'`).join(',')}]`

  const inainte = `${base}
ALTER TABLE public.ofertare_cerinte ADD COLUMN IF NOT EXISTS text_cerinta text;
${migration('20260928i_ofertare_r08_versiuni.sql')}
${read('scripts/pg/fixtures/jakv2p3.sql')}
${migration('20260913_ofertare_pt_pachet_manifest.sql')}
ALTER TABLE ofertare_pt_pachet_fisiere ADD COLUMN anexa_ref text, ADD COLUMN semnat boolean DEFAULT false,
 ADD COLUMN sursa_participant text, ADD COLUMN unit_in text;
${r5}
${migration('20260913_ofertare_pt_stare_h2_cantitati.sql')}
${migration('20260928g_ofertare_pt_stare_r06_r09.sql')}
${read('scripts/pg/fixtures/jakv2p3_view.sql')}
${migration('20260928f_gate_depunere_r07.sql')}
${copilot.slice(helperStart, helperEnd)}
${migration('20260928n_gate_depunere_r06.sql')}
${migration('20260929a_gate_depunere_pachet_jakv203.sql')}
${migration('20260929b_ofertare_derogare_audit.sql')}
${migration('20260928h_ofertare_pachet_poarta_r12.sql')}
${migration('20260928k_ofertare_pachet_depus_r11.sql')}
${migration('20260928o_ofertare_pachet_tranzitie_jakv201.sql')}
-- Storage minimal (schema Supabase: id, bucket_id, name, updated_at, metadata{size,eTag}) + politicile R12 reale.
CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO authenticated, anon, service_role;
CREATE TABLE storage.objects(id uuid PRIMARY KEY, bucket_id text NOT NULL, name text NOT NULL,
  updated_at timestamptz NOT NULL, metadata jsonb, UNIQUE(bucket_id,name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated, service_role;
${storageGate}
-- Starea LIVE din 06.10 pentru ce ating J04/J07: J02b + garda J05 (din repo), apoi textele/ACL-urile exacte din producție.
${transplantJ02bJ05()}
${read('scripts/pg/fixtures/j04xj07_live_0610.sql')}
DO $live0610$ DECLARE r record; v text; asteptat jsonb := ${"'" + JSON.stringify(LIVE_0610) + "'"}::jsonb; BEGIN
  FOR r IN SELECT key, value #>> '{}' AS amprenta FROM jsonb_each(asteptat) LOOP
    SELECT md5(p.prosrc)||'|'||p.prosecdef||'|'||p.provolatile::text||'|'||coalesce(array_to_string(p.proconfig,','),'')||'|'||
      coalesce((SELECT string_agg(a::text,' ' ORDER BY a::text) FROM unnest(p.proacl) a),'-') INTO v
      FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = r.key;
    IF v IS DISTINCT FROM r.amprenta THEN
      RAISE EXCEPTION 'Fixture J04×J07 ≠ live 06.10 la %: % (live: %)', r.key, v, r.amprenta;
    END IF;
  END LOOP;
END $live0610$;
CREATE TABLE jx.functii_inainte AS SELECT oid,proname,pg_get_functiondef(oid) def FROM pg_proc
 WHERE pronamespace='public'::regnamespace AND proname = ANY(${lista});
CREATE TABLE jx.politici_inainte AS SELECT oid,to_jsonb(p) def FROM pg_policy p;
`
  // Ordinea definită: J04, apoi J07; apoi reaplicare în aceeași ordine (a doua aplicare nu schimbă nimic).
  const migrari = `${j04}
${j07}
CREATE TABLE jx.dupa_prima_aplicare AS SELECT proname,pg_get_functiondef(oid) def FROM pg_proc
 WHERE pronamespace='public'::regnamespace AND proname = ANY(${lista});
${j04}
${j07}
`
  return { inainte, migrari }
}
