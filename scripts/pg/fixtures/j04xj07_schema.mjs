// Schema pentru suita extinsă J04×J07 (scripts/pg/test_j04xj07.mjs): ACELAȘI lanț ca harness-ul de integrare
// (scripts/pg/test_j04_j07_integrare.mjs) — fixture R5 + R08 + R12 + R11 + J02 + J05 + matrice + Storage R12 —
// apoi migrările reale J04 → J07, reaplicate o dată (idempotență). Nu conține BEGIN/COMMIT: runner-ul decide.
// Tot SQL-ul de business vine din repo (supabase/migrations + docs/R5_*); aici doar îl ordonăm.
import assert from 'node:assert/strict'
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

export function schemaJ04J07() {
  assert.ok([J04, J07].sort()[0] === J04, 'Ordinea lexicografică trebuie să fie J04 → J07')
  const j04 = migration(J04)
  const j07 = transactionBody(migration(J07))
  assert.ok(!/fn_pt_pachet_depus_verifica/.test(j07), 'J07 nu atinge funcția J04')
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
