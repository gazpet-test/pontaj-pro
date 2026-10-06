// J04 × J07 — integrare pe PG16 REAL, bază LOCALĂ goală jakv0407_test_*. Tot fixture-ul e într-o tranzacție + ROLLBACK.
// PGURI=postgres://postgres@127.0.0.1:5440/jakv0407_test_local node scripts/pg/test_j04_j07_integrare.mjs
//
// Ordinea migrărilor (definită, verificată aici): 20260930a J04 (hash pe server) → 20261003a J07 (poarta pe server).
// Prefixele nu se ciocnesc; nicio migrare nu atinge funcția celeilalte:
//   J04 → fn_pt_pachet_depus_verifica (trg_pt_pachet_depus_verifica) + trg_pt_fisier_path_obligatoriu
//   J07 → bloc „-- J07 BEGIN/END” în fn_ofertare_pt_pachet_poarta_documentatie și fn_gate_depunere
// Tranziția aprobat→depus pe ofertare_pt_pachet trece prin AMBELE triggere (matrice → poarta_documentatie/J07 →
// depus_verifica/J04): fiecare refuză singur. UI-ul doar cere verificările și afișează verdictul.
//
// Edge-urile sunt simulate cu MODULELE REALE (verificare.mjs pentru J04, evalueaza.mjs pentru J07), ca service_role,
// peste funcțiile SQL reale (ofertare_pt_fisier_snapshot, ofertare_poarta_text_sursa) — exact pașii din index.ts / handler.ts
// de după poarta de rol (poarta de rol are testele ei Deno). Bytes-ii din Storage sunt ținuți în memorie.
//
// Scenariile acoperă cerințele Copilot (COPILOT_REVIEW_PLAN_A_2026-09-29 §2): traseu pozitiv; hash PASS + poartă BLOCK;
// poartă indisponibilă / eroare internă; hash invalid/lipsă/stale + poartă permisivă; fiecare din cele 12 controale
// provocat separat cu celelalte OK; modificare de sursă/manifest/rezultat/obiect între verificare și tranziție;
// parser_version schimbat cu sursa neschimbată; A→B cu reverify refuzat până la un pachet nou; scriere directă prin API;
// la refuz, starea și dovezile anterioare nu se suprascriu; rollback în ordine inversă + reaplicare.
import assert from 'node:assert/strict'
import { cuGarda } from './fixtures/livrare_garda.mjs'
import { transplantJ02bJ05 } from './fixtures/j04xj07_schema.mjs'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { verificaFisier, ROLURI_DOVEDIT } from '../../supabase/functions/ofertare-pachet-verifica/verificare.mjs'
import { evalueazaTexte, PARSER_VERSION } from '../../supabase/functions/ofertare-poarta-text/evalueaza.mjs'

const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const migration = n => read('supabase/migrations/' + n)
const transactionBody = s => s.replace(/^(BEGIN|COMMIT);\s*$/gm, '')
const OWNER = '00000000-0000-4000-8000-000000000121', EDITOR = '00000000-0000-4000-8000-000000000007'
const DENIED = '00000000-0000-4000-8000-000000000099'
const actor = 'jakv0407_actor_' + process.pid
const q = s => "'" + String(s).replaceAll("'", "''") + "'"
const sha = b => createHash('sha256').update(b).digest('hex')
const md5 = b => createHash('md5').update(b).digest('hex')
const check = (expr, label) => `SELECT jakv0407_assert((${expr}),${q(label)});\n`
const reject = (sql, code, fragment = '') => `DO $test$ DECLARE refused boolean:=false; BEGIN
  BEGIN EXECUTE ${q(sql)}; EXCEPTION WHEN SQLSTATE '${code}' THEN
    IF position(${q(fragment)} in SQLERRM)=0 THEN RAISE; END IF; refused:=true;
  END; PERFORM jakv0407_assert(refused,${q('Refuz obligatoriu: ' + sql)}); END $test$;\n`
// Refuz acceptat cu oricare din coduri (ex. INSERT direct 'depus': triggerul BEFORE sau RLS WITH CHECK, oricare prinde primul).
const rejectOri = (sql, codes) => `DO $test$ DECLARE refused boolean:=false; BEGIN
  BEGIN EXECUTE ${q(sql)}; EXCEPTION WHEN OTHERS THEN
    IF NOT (SQLSTATE = ANY(${q('{' + codes.join(',') + '}')}::text[])) THEN RAISE; END IF; refused:=true;
  END; PERFORM jakv0407_assert(refused,${q('Refuz obligatoriu: ' + sql)}); END $test$;\n`
const admin = `RESET ROLE; RESET SESSION AUTHORIZATION; SET request.jwt.claims='{}';`
const user = (id = EDITOR, role = 'authenticated') => `${admin} SET SESSION AUTHORIZATION "${actor}";
  SET ROLE ${role}; SET request.jwt.claims=${q(JSON.stringify({ sub: id, role }))};`
const service = user(null, 'service_role')
const DEPUS = "UPDATE ofertare_pt_pachet SET stare='depus' WHERE id=1"

// ── ordinea migrărilor ─────────────────────────────────────────────────────────────────────────────
const J04 = '20260930a_ofertare_pachet_hash_server_jakv202.sql'
const J07 = '20261003a_ofertare_poarta_server_jakv2p3.sql'
assert.ok([J04, J07].sort()[0] === J04, 'Ordinea lexicografică trebuie să fie J04 → J07')
const j04 = cuGarda(J04, migration(J04)), j04Rollback = migration(J04.replace('.sql', '_ROLLBACK.sql'))
const j07 = cuGarda(J07, transactionBody(migration(J07))), j07Rollback = transactionBody(migration(J07.replace('.sql', '_ROLLBACK.sql')))
assert.ok(!/(CREATE|ALTER|DROP)(\s+OR\s+REPLACE)?\s+FUNCTION\s+public\.fn_pt_pachet_depus_verifica/.test(j07), 'J07 nu atinge funcția J04 (doar o citește în precondiție)')
assert.ok(!/fn_ofertare_pt_pachet_poarta_documentatie|fn_gate_depunere/.test(j04), 'J04 nu atinge funcțiile patch-uite de J07')

// ── fixture: același lanț ca harness-ul J07 (R5 + R08 + R12 + R11 + J02 + J05 + matrice) + Storage R12 ──
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

const FUNCTII = ['fn_gate_depunere', 'fn_ofertare_pt_pachet_poarta_documentatie', 'fn_pt_pachet_depus_verifica',
  'fn_ofertare_pt_pachet_matrice', 'fn_gate_depunere_derogare_owner', 'ofertare_r5_blocaj_sursa']
const setup = `BEGIN;
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
 IF current_setting('server_version_num')::int/10000<>16 OR session_user<>'postgres'
    OR current_database() !~ '^jakv0407_test_[a-z0-9_]+$' THEN RAISE EXCEPTION 'Doar PG16 local dedicat (jakv0407_test_*), login postgres'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace)
    OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace)
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN ('auth','storage')) THEN RAISE EXCEPTION 'Baza trebuie să fie goală'; END IF;
END $guard$;
${base}
CREATE ROLE "${actor}" NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT authenticated,anon,service_role TO "${actor}";
CREATE FUNCTION jakv0407_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAIL: %',msg; END IF; END $$;
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
-- Starea LIVE din 06.10 pentru ce ating J04/J07 (J02b + garda J05, același transplant ca suita extinsă): precondițiile pinuite
-- ale migrărilor (md5 pe funcțiile live) trebuie să treacă și aici.
${transplantJ02bJ05()}
CREATE TEMP TABLE before_functions AS SELECT oid,proname,pg_get_functiondef(oid) def,proacl FROM pg_proc
 WHERE pronamespace='public'::regnamespace AND proname = ANY(${q('{' + FUNCTII.join(',') + '}')}::text[]);
CREATE TEMP TABLE before_policies AS SELECT oid,to_jsonb(p) def FROM pg_policy p;
-- Ordinea definită: J04, apoi J07; apoi reaplicare în aceeași ordine (idempotență).
${j04}
${j07}
CREATE TEMP TABLE dupa_prima_aplicare AS SELECT proname,pg_get_functiondef(oid) def FROM pg_proc
 WHERE pronamespace='public'::regnamespace AND proname = ANY(${q('{' + FUNCTII.join(',') + '}')}::text[]);
${j04}
${j07}
${check(`NOT EXISTS(SELECT 1 FROM dupa_prima_aplicare a JOIN pg_proc p ON p.proname=a.proname AND p.pronamespace='public'::regnamespace
  WHERE pg_get_functiondef(p.oid)<>a.def)`, 'Reaplicarea J04→J07 este idempotentă')}
${check(`(SELECT array_agg(tgname::text ORDER BY tgname)=ARRAY['trg_ofertare_pt_pachet_matrice','trg_ofertare_pt_pachet_poarta_documentatie','trg_pt_pachet_depus_verifica']
  AND bool_and(tgenabled='O') FROM pg_trigger WHERE tgrelid='ofertare_pt_pachet'::regclass AND NOT tgisinternal AND (tgtype & 16) <> 0)`, 'Pachet: exact 3 triggere BEFORE UPDATE active, în ordinea matrice → J07 → J04')}
${check(`EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='ofertare_pt_pachet'::regclass AND tgname='trg_pt_pachet_delete_garda' AND tgenabled='O' AND (tgtype & 8) <> 0)`, 'Pachet: garda de DELETE (C3) activă')}
${check(`position('-- J07 BEGIN' in pg_get_functiondef('fn_ofertare_pt_pachet_poarta_documentatie()'::regprocedure))>0
  AND position('ofertare_r5_blocaj_sursa' in pg_get_functiondef('fn_ofertare_pt_pachet_poarta_documentatie()'::regprocedure))>0`, 'Tranziția cere J07 + R5 (trigger documentație)')}
${check(`position('ofertare_pt_pachet_verificari' in pg_get_functiondef('fn_pt_pachet_depus_verifica()'::regprocedure))>0
  AND position('dovada_seap' in pg_get_functiondef('fn_pt_pachet_depus_verifica()'::regprocedure))>0`, 'Tranziția cere J04 + R11 (trigger depus)')}
${check(`position('-- J07 BEGIN' in pg_get_functiondef('fn_gate_depunere()'::regprocedure))>0
  AND position('ofertare_derogari_audit' in pg_get_functiondef('fn_gate_depunere()'::regprocedure))>0`, 'Licitație depusă: J07 + J05 în gate')}
${check(`EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='ofertare_pt_pachet_fisiere'::regclass AND tgname='trg_pt_fisier_path_obligatoriu' AND tgenabled='O')`, 'Manifest: cale obligatorie (J04)')}
${check(`NOT EXISTS(SELECT 1 FROM before_functions b JOIN pg_proc p USING(oid) WHERE p.proname NOT IN
  ('fn_gate_depunere','fn_ofertare_pt_pachet_poarta_documentatie','fn_pt_pachet_depus_verifica') AND pg_get_functiondef(p.oid)<>b.def)`, 'Matrice/R5/J05 nemodificate de J04+J07')}
${check(`NOT EXISTS(SELECT 1 FROM before_policies b LEFT JOIN pg_policy p USING(oid) WHERE p.oid IS NULL OR to_jsonb(p)<>b.def)`, 'Politicile existente (R12 inclusiv Storage) nemodificate')}
`

// ── date: licitația 1 din harness-ul J07 + pachetul v1 cu fișierele reale ale fluxului UI ─────────────
const bytes = new Map()   // name → Uint8Array (Storage simulat)
let nrObiect = 0
const obiect = (path, continut, cine = user()) => {
  const b = new TextEncoder().encode(continut); bytes.set(path, b); nrObiect++
  const id = '00000000-0000-4000-9000-' + String(nrObiect).padStart(12, '0')
  return `${cine} INSERT INTO storage.objects(id,bucket_id,name,updated_at,metadata) VALUES
    ('${id}','ofertare',${q(path)},'2026-10-02 10:00:00.${String(nrObiect).padStart(6, '0')}+00',
     ${q(JSON.stringify({ size: b.length, eTag: md5(b) }))});\n`
}
const fisier = (pachet, rol, nume, path, continut) => {
  const b = new TextEncoder().encode(continut)
  return `INSERT INTO ofertare_pt_pachet_fisiere(pachet_id,rol,nume,sha256,fisier_path,size_bytes)
    VALUES(${pachet},${q(rol)},${q(nume)},'${sha(b)}',${q(path)},${b.length});\n`
}
// Suprascriere în Storage (ocolind R12, ca un admin/cheie de serviciu): obiect nou la aceeași cale.
const inlocuieste = (path, continut) => {
  const b = new TextEncoder().encode(continut); bytes.set(path, b)
  return `${admin} UPDATE storage.objects SET updated_at=updated_at+interval '1 second',
    metadata=${q(JSON.stringify({ size: b.length, eTag: md5(b) }))} WHERE bucket_id='ofertare' AND name=${q(path)};\n`
}
const P = { prop: 'pt/1/v1/Propunere.docx', bord: 'pt/1/v1/Borderou.docx',
  fin: 'pt/1/v1/depus/depus_final_Final.pdf', dov: 'pt/1/v1/depus/dovada_seap_Dovada.pdf' }
const date = `${user()}
INSERT INTO ofertare_licitatii(id,responsabil_id) VALUES(1,'${EDITOR}');
INSERT INTO ofertare_cantitati(id,licitatie_id,denumire,categorie,um,cantitate,status,tip_sursa,sursa,extras_de_ai)
 VALUES(1,1,'Conductă','Conducte','m',1000,'validat','lista_f3','F3',false);
INSERT INTO ofertare_cerinte(id,licitatie_id,confirmata_de,text_cerinta) VALUES(1,1,'${EDITOR}','garanție 36 luni, 372 branșamente');
INSERT INTO ofertare_acoperire(id,cerinta_id,status,verificat_pe_scan) VALUES(1,1,'acoperit',true);
INSERT INTO ofertare_pt_capitole(id,licitatie_id,nr,titlu,eticheta,continut)
 VALUES(1,1,1,'Metodologie','Anexa 1','Anexa 1; garanție 36 luni; 372 branșamente');
INSERT INTO ofertare_pt_legaturi(id,cerinta_id,capitol_id) VALUES(1,1,1);
INSERT INTO grafic_parametri VALUES(1,'{"fronturi":[{"lungime_m":1000}]}');
INSERT INTO grafic_versiuni(licitatie_id,versiune,activitati) VALUES(1,1,'[{"id":1,"durata_zile":5,"predecesori":[]}]');
INSERT INTO ofertare_pt_garantie VALUES(1,36,36,'pif','pif','${EDITOR}',NULL);
INSERT INTO seap_compl VALUES(1,NULL);
INSERT INTO ofertare_pt_pachet(id,licitatie_id,versiune) VALUES(1,1,1);
INSERT INTO ofertare_pt_pachet_fisiere(pachet_id,rol,nume,sha256,anexa_ref,semnat)
 VALUES(1,'anexa','Anexa 1.pdf',repeat('a',64),'Anexa 1',true);
${obiect(P.prop, 'propunere tehnica v1')}${obiect(P.bord, 'borderou v1')}
${user()}
${fisier(1, 'propunere_docx', 'Propunere.docx', P.prop, 'propunere tehnica v1')}
${fisier(1, 'borderou_docx', 'Borderou.docx', P.bord, 'borderou v1')}
`

// ── psql ca proces-pereche: SQL-ul și edge-urile simulate rulează în ACEEAȘI tranzacție ───────────────
function sesiune(uri) {
  const p = spawn('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '--dbname', uri], {
    env: { ...process.env, PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '5' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let out = '', err = '', iesit = null, asteapta = null, n = 0
  p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8')
  p.stdout.on('data', d => { out += d; asteapta?.() })
  p.stderr.on('data', d => { err += d })
  p.on('exit', cod => { iesit = cod; asteapta?.() })
  p.stdin.on('error', () => {})
  return {
    sql(text) {
      const tag = `__J0407_${++n}__`
      if (iesit === null) p.stdin.write(text + `\nSELECT '${tag}';\n`)
      return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout psql')), 90000)
        asteapta = () => {
          const i = out.indexOf(tag + '\n')
          if (i >= 0) { clearTimeout(t); asteapta = null; const r = out.slice(0, i); out = out.slice(i + tag.length + 1); res(r.split('\n').filter(Boolean)) }
          else if (iesit !== null) { clearTimeout(t); asteapta = null; rej(new Error((err.split('\n').filter(l => /ERROR|FAIL|CONTEXT/.test(l)).join('\n')) || `psql a ieșit (${iesit})`)) }
        }
        asteapta()
      })
    },
    async inchide() { p.stdin.end(); if (iesit === null) await new Promise(r => p.on('exit', r)) },
  }
}

let db
const val = async expr => (await db.sql(`${admin} SELECT (${expr})::text;`))[0]
// Starea care NU are voie să se schimbe la un refuz: pachete, manifest, dovezi J04, rezultate J07, licitația, auditul J05.
const FOTO = `jsonb_build_object('pachete',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM ofertare_pt_pachet p),
  'manifest',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM ofertare_pt_pachet_fisiere f),
  'verificari',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM ofertare_pt_pachet_verificari v),
  'text',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM ofertare_poarta_rezultate_text t),
  'licitatie',(SELECT to_jsonb(l) FROM ofertare_licitatii l WHERE id=1),
  'j05',(SELECT count(*) FROM ofertare_derogari_audit),
  'storage',(SELECT jsonb_agg(to_jsonb(o) ORDER BY name) FROM storage.objects o))`
const foto = () => val(FOTO)
const blocaje = async () => JSON.parse(await val(`ofertare_poarta_server(1)->'blocaje'`))

// Edge J04 (index.ts după poarta de rol): pachet aprobat, manifest pe ROLURI_DOVEDIT ordonat după id,
// verificaFisier real cu snapshot prin RPC-ul service_role și download din Storage; INSERT PASS/REFUZ per fișier.
async function edgeJ04(pachet = 1, { download, snapshot } = {}) {
  const st = (await db.sql(`${service} SELECT stare FROM ofertare_pt_pachet WHERE id=${pachet};`))[0]
  if (st !== 'aprobat') return { status: 409 }
  const fisiere = (await db.sql(`${service} SELECT to_jsonb(f)::text FROM (SELECT id,rol,nume,fisier_path,sha256
    FROM ofertare_pt_pachet_fisiere WHERE pachet_id=${pachet} AND rol = ANY(${q('{' + ROLURI_DOVEDIT.join(',') + '}')}::text[]) ORDER BY id) f;`)).map(JSON.parse)
  const deps = {
    snapshot: snapshot ?? (async id => JSON.parse((await db.sql(`${service} SELECT coalesce(ofertare_pt_fisier_snapshot(${id})::text,'null');`))[0])),
    download: download ?? (async path => bytes.has(path) ? new Response(bytes.get(path)) : new Response(null, { status: 404 })),
  }
  const verificari = []
  for (const f of fisiere) {
    const row = await verificaFisier(f, EDITOR, deps)
    await db.sql(`${service} INSERT INTO ofertare_pt_pachet_verificari(pachet_fisier_id,bucket,fisier_path,obj_id,obj_updated_at,
      obj_etag,obj_size,sha256_calculat,sha256_declarat,rezultat,motiv,verificat_de)
      SELECT pachet_fisier_id,bucket,fisier_path,obj_id,obj_updated_at,obj_etag,obj_size,sha256_calculat,sha256_declarat,rezultat,motiv,verificat_de
      FROM jsonb_populate_record(NULL::ofertare_pt_pachet_verificari, ${q(JSON.stringify(row))}::jsonb);`)
    verificari.push({ nume: f.nume, rezultat: row.rezultat, motiv: row.motiv })
  }
  const lipsa = ['depus_final', 'dovada_seap'].filter(rol => !fisiere.some(f => f.rol === rol))
  return { status: 200, ok: !lipsa.length && verificari.every(v => v.rezultat === 'PASS'), verificari }
}
// Edge J07 (handler.ts după poarta de rol): sursa și hash-ul DOAR din BD, evaluatorul real, 4 rânduri inserate.
async function edgeJ07(lic = 1) {
  const sursa = JSON.parse((await db.sql(`${service} SELECT ofertare_poarta_text_sursa(${lic})::text;`))[0])
  if (!/^[0-9a-f]{64}$/.test(sursa?.sursa_hash || '')) return { status: 409 }
  if (sursa.parser_version !== PARSER_VERSION) return { status: 409 }
  const rezultate = evalueazaTexte(sursa.date)
  await db.sql(`${service} INSERT INTO ofertare_poarta_rezultate_text(control_code,licitatie_id,parser_version,sursa_hash,stare,detalii)
    SELECT x->>'control_code',${lic},${q(PARSER_VERSION)},${q(sursa.sursa_hash)},x->>'stare',x->'detalii'
    FROM jsonb_array_elements(${q(JSON.stringify(rezultate))}::jsonb) x;`)
  return { status: 200, rezultate }
}
// Refuz la tranziție + dovada că nimic nu s-a suprascris.
async function refuzDepus(fragment, code = 'P0001', cine = user(), sql = DEPUS) {
  const inainte = await foto()
  await db.sql(`${cine} ${reject(sql, code, fragment)}`)
  assert.equal(await foto(), inainte, 'Refuzul nu are voie să schimbe starea sau dovezile: ' + fragment)
}
async function ambeleOk() {
  const r4 = await edgeJ04(1); assert.equal(r4.ok, true, 'J04 PASS: ' + JSON.stringify(r4.verificari))
  const r7 = await edgeJ07(1); assert.ok(r7.rezultate.every(r => r.stare === 'ok'), 'J07 text OK: ' + JSON.stringify(r7.rezultate))
  assert.deepEqual(await blocaje(), [])
}
async function depusOk(pachet = 1) {
  await db.sql(`${user()} UPDATE ofertare_pt_pachet SET stare='depus' WHERE id=${pachet};
    ${admin} ${check(`(SELECT stare='depus' AND depus_la IS NOT NULL FROM ofertare_pt_pachet WHERE id=${pachet})`, 'Pachet depus cu timp server')}`)
}
const reverificaLegatura = `${admin} UPDATE ofertare_pt_legaturi SET verificat_la_versiunea=(SELECT versiune FROM ofertare_pt_capitole WHERE id=1) WHERE id=1;\n`

const CODURI = ['cuprins', 'neverificate', 'capcane', 'goale', 'nescrise', 'cantitati_f3_grafic',
  'garantie', 'anexe', 'numere', 'pachet', 'grafic_relatii', 'grafic_sursa']
const scenarii = []
const scenariu = (nume, fn) => scenarii.push([nume, fn])

scenariu('traseu pozitiv: J04 PASS + J07 OK → pachet depus → licitație depusă', async () => {
  await ambeleOk(); await depusOk()
  await db.sql(`${user()} UPDATE ofertare_licitatii SET status='depusa' WHERE id=1;
    ${admin} ${check(`(SELECT status='depusa' FROM ofertare_licitatii WHERE id=1)`, 'Licitație depusă')}`)
})
scenariu('verificările sunt ortogonale: J07 înainte de J04 → tot depus (dovezile J04 nu fac J07 stale)', async () => {
  const r7 = await edgeJ07(1); assert.ok(r7.rezultate.every(r => r.stare === 'ok'))
  assert.equal((await edgeJ04(1)).ok, true); assert.deepEqual(await blocaje(), [])
  await depusOk()
})
scenariu('J07 indisponibil (edge nedeployat / fără rezultat text) + J04 PASS → REFUZ', async () => {
  assert.equal((await edgeJ04(1)).ok, true)
  assert.deepEqual(await blocaje(), ['garantie', 'anexe', 'numere', 'pachet'])
  await refuzDepus('J07: controale blocante')
})
scenariu('J04 indisponibil (edge nedeployat / fără PASS) + J07 OK → REFUZ', async () => {
  await edgeJ07(1); assert.deepEqual(await blocaje(), [])
  await refuzDepus('verificare PASS lipsă')
})
scenariu('eroare internă J07 (sursă ilizibilă) → undetermined → REFUZ, cu J04 PASS', async () => {
  await ambeleOk()
  await db.sql(`${admin} ALTER TABLE grafic_versiuni RENAME TO grafic_versiuni_indisponibil;`)
  assert.deepEqual(await blocaje(), ['garantie', 'anexe', 'numere', 'pachet'])
  await refuzDepus('J07: controale blocante')
})
scenariu('eroare internă în agregatorul J07 (excepție) → tranziția cade, nimic scris', async () => {
  await ambeleOk()
  await db.sql(`${admin} CREATE OR REPLACE FUNCTION public.ofertare_poarta_server(p_licitatie_id bigint) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $f$
    BEGIN RAISE EXCEPTION 'poarta J07 căzută (simulat)' USING ERRCODE='XX000'; END $f$;`)
  await refuzDepus('poarta J07 căzută', 'XX000')
})
scenariu('eroare internă J04 (snapshot indisponibil în edge) → REFUZ persistat → tranziție REFUZ, J07 OK', async () => {
  const r4 = await edgeJ04(1, { snapshot: async () => { throw new Error('RPC indisponibil') } })
  assert.equal(r4.ok, false); assert.ok(r4.verificari.every(v => v.rezultat === 'REFUZ' && /indisponibil/.test(v.motiv)))
  await edgeJ07(1); assert.deepEqual(await blocaje(), [])
  await refuzDepus('verificare PASS lipsă')
})
scenariu('eroare internă J04 în trigger (Storage ilizibil) → tranziția cade', async () => {
  await ambeleOk()
  const inainte = await foto()
  await db.sql(`${admin} ALTER TABLE storage.objects RENAME TO objects_indisponibil;
    ${user()} ${reject(DEPUS, '42P01', 'storage.objects')}
    ${admin} ALTER TABLE storage.objects_indisponibil RENAME TO objects;`)
  assert.equal(await foto(), inainte)
})
for (const [eticheta, pregatire, fragment] of [
  ['bytes-ii din bucket diferă de manifest (SHA diferit)', async () => {
    const r4 = await edgeJ04(1, { download: async path => new Response(path === P.fin ? new TextEncoder().encode('ALT CONTINUT') : bytes.get(path)) })
    assert.equal(r4.ok, false) }, 'verificare PASS lipsă, SHA diferit'],
  ['obiect schimbat după PASS (updated_at/eTag/size)', async () => {
    assert.equal((await edgeJ04(1)).ok, true); await db.sql(inlocuieste(P.fin, 'final v1')) }, 'verificare veche'],
  ['obiect cu alt id după PASS (șters + reurcat)', async () => {
    assert.equal((await edgeJ04(1)).ok, true)
    await db.sql(`${admin} UPDATE storage.objects SET id='00000000-0000-4000-9000-00000000ffff' WHERE name=${q(P.dov)};`) }, 'verificare veche'],
  ['obiect șters după PASS', async () => {
    assert.equal((await edgeJ04(1)).ok, true); await db.sql(`${admin} DELETE FROM storage.objects WHERE name=${q(P.prop)};`) }, 'obiect inexistent'],
  ['obiect golit după PASS', async () => {
    assert.equal((await edgeJ04(1)).ok, true)
    await db.sql(`${admin} UPDATE storage.objects SET metadata='{"size":0}' WHERE name=${q(P.bord)};`) }, 'obiect gol'],
]) {
  scenariu(`simetric: hash invalid/stale + poartă J07 permisivă → REFUZ J04 — ${eticheta}`, async () => {
    await pregatire()
    await edgeJ07(1); assert.deepEqual(await blocaje(), [], 'Poarta J07 trebuie să fie permisivă aici')
    await refuzDepus(fragment)
  })
}
// Independență: fiecare control provocat SINGUR (restul OK, J04 PASS). Controalele SQL se înlocuiesc punctual
// cu un verdict block; cele text primesc un rezultat nou block pe hash-ul curent (ultimul rând câștigă).
const TEXT = ['garantie', 'anexe', 'numere', 'pachet']
for (const cod of CODURI) {
  scenariu(`controlul ${cod} provocat singur (celelalte 11 OK, J04 PASS) → REFUZ cu blocaje=[${cod}]`, async () => {
    await ambeleOk()
    if (cod === 'garantie' || !TEXT.includes(cod)) {
      await db.sql(`${admin} CREATE OR REPLACE FUNCTION public.ofertare_ctl_${cod}(p_licitatie_id bigint) RETURNS jsonb
        LANGUAGE sql STABLE SET search_path TO 'public','pg_temp' AS $f$ SELECT public.ofertare_poarta_rezultat(${q(cod)},'block','provocat în test') $f$;`)
    } else {
      await db.sql(`${service} INSERT INTO ofertare_poarta_rezultate_text(control_code,licitatie_id,parser_version,sursa_hash,stare,detalii)
        VALUES(${q(cod)},1,${q(PARSER_VERSION)},ofertare_poarta_text_sursa(1)->>'sursa_hash','block','{"test":"provocat"}');`)
    }
    assert.deepEqual(await blocaje(), [cod])
    await refuzDepus(`"${cod}"`)
  })
}
scenariu('controalele text provocate prin DATE, cu evaluatorul real al edge-ului', async () => {
  await ambeleOk()
  const cazuri = [
    ['garantie', `${user()} UPDATE ofertare_pt_capitole SET continut='Anexa 1; garanție 48 luni; 372 branșamente' WHERE id=1; ${reverificaLegatura}`],
    ['anexe', `${user()} UPDATE ofertare_pt_capitole SET continut='Anexa 2; garanție 36 luni; 372 branșamente' WHERE id=1; ${reverificaLegatura}`],
    ['numere', `${user()} UPDATE ofertare_pt_capitole SET continut='Anexa 1; garanție 36 luni; 371 branșamente' WHERE id=1; ${reverificaLegatura}`],
    ['pachet', `${admin} INSERT INTO ofertare_pt_anexe_asteptate VALUES(1,1,'Anexa 2');`],
  ]
  for (const [cod, schimbare] of cazuri) {
    await db.sql(`${admin} SAVEPOINT text_date; ${schimbare}`)
    assert.ok((await blocaje()).includes(cod), `${cod}: sursa schimbată ⇒ rezultat vechi invalid`)
    const r7 = await edgeJ07(1)
    assert.deepEqual(r7.rezultate.filter(r => r.stare !== 'ok').map(r => r.control_code), [cod])
    assert.deepEqual(await blocaje(), [cod])
    await refuzDepus(`"${cod}"`)
    await db.sql(`${admin} ROLLBACK TO SAVEPOINT text_date; RELEASE SAVEPOINT text_date;`)
  }
})
scenariu('A→B: obiect înlocuit după PASS; reverify B refuzat cât manifestul e A; PASS doar pe un pachet nou', async () => {
  await ambeleOk()
  await db.sql(inlocuieste(P.fin, 'FINAL B'))
  await refuzDepus('verificare veche')
  const r4 = await edgeJ04(1)
  assert.equal(r4.ok, false); assert.match(r4.verificari.find(v => v.nume === 'Final.pdf').motiv, /SHA-256 diferit de manifest/)
  await refuzDepus('verificare PASS lipsă, SHA diferit')
  // O „dovadă” PASS pentru B (chiar scrisă de service_role) nu acoperă manifestul A; PASS cu calculat≠declarat e imposibil.
  const shaB = sha(new TextEncoder().encode('FINAL B')), shaA = sha(new TextEncoder().encode('final v1'))
  const pas = (calc, decl) => `INSERT INTO ofertare_pt_pachet_verificari(pachet_fisier_id,bucket,fisier_path,obj_id,obj_updated_at,obj_etag,obj_size,
      sha256_calculat,sha256_declarat,rezultat,verificat_de)
    SELECT f.id,'ofertare',o.name,o.id,o.updated_at,o.metadata->>'eTag',(o.metadata->>'size')::bigint,'${calc}','${decl}','PASS','${EDITOR}'
    FROM ofertare_pt_pachet_fisiere f JOIN storage.objects o ON o.bucket_id='ofertare' AND o.name=f.fisier_path WHERE f.fisier_path=${q(P.fin)}`
  await db.sql(`${service} ${pas(shaB, shaB)}; ${reject(pas(shaB, shaA), '23514', 'ofertare_pt_verificari_pass_chk')}`)
  await refuzDepus('verificare PASS lipsă, SHA diferit')
  // Manifestul nu se rescrie din API (append-only): hash-ul A rămâne.
  await db.sql(`${user()} DO $u$ BEGIN UPDATE ofertare_pt_pachet_fisiere SET sha256='${shaB}' WHERE fisier_path=${q(P.fin)};
    EXCEPTION WHEN insufficient_privilege THEN NULL; END $u$;`)
  assert.equal(await val(`(SELECT sha256 FROM ofertare_pt_pachet_fisiere WHERE fisier_path=${q(P.fin)})`), shaA)
  // Calea permisă: pachet nou v2 (propus → aprobat cu J07 → depunere cu B, J04 + J07) ; v1 nu mai poate fi depus.
  const V2 = { prop: 'pt/1/v2/Propunere.docx', bord: 'pt/1/v2/Borderou.docx', fin: 'pt/1/v2/depus/depus_final_Final.pdf', dov: 'pt/1/v2/depus/dovada_seap_Dovada.pdf' }
  await db.sql(`${user()} INSERT INTO ofertare_pt_pachet(id,licitatie_id,versiune) VALUES(2,1,2);
    INSERT INTO ofertare_pt_pachet_fisiere(pachet_id,rol,nume,sha256,anexa_ref,semnat) VALUES(2,'anexa','Anexa 1.pdf',repeat('a',64),'Anexa 1',true);
    ${obiect(V2.prop, 'propunere tehnica v2')}${obiect(V2.bord, 'borderou v2')}${user()}
    ${fisier(2, 'propunere_docx', 'Propunere.docx', V2.prop, 'propunere tehnica v2')}${fisier(2, 'borderou_docx', 'Borderou.docx', V2.bord, 'borderou v2')}`)
  await edgeJ07(1)
  await db.sql(`${user()} UPDATE ofertare_pt_pachet SET stare='aprobat',aprobat_de='${EDITOR}' WHERE id=2;
    ${obiect(V2.fin, 'FINAL B')}${obiect(V2.dov, 'dovada v2')}${user()}
    ${fisier(2, 'depus_final', 'Final.pdf', V2.fin, 'FINAL B')}${fisier(2, 'dovada_seap', 'Dovada.pdf', V2.dov, 'dovada v2')}`)
  await edgeJ07(1)
  await refuzDepus('pachet_versiune')          // v1 nu se mai depune: versiunea curentă e v2
  assert.equal((await edgeJ04(2)).ok, true); assert.deepEqual(await blocaje(), [])
  await depusOk(2)
})
scenariu('între verificare și tranziție: sursa editată → REFUZ J07; recalcul + reverificare umană → depus', async () => {
  await ambeleOk()
  await db.sql(`${user()} UPDATE ofertare_pt_capitole SET continut=continut||' (editat după verificare)' WHERE id=1;`)
  await refuzDepus('J07: controale blocante')
  await db.sql(reverificaLegatura); await edgeJ07(1); assert.deepEqual(await blocaje(), [])
  await depusOk()           // PASS-urile J04 rămân valabile: obiectele n-au fost atinse
})
scenariu('între verificare și tranziție: rând nou în manifest → REFUZ J07 (hash), apoi REFUZ J04 (fără PASS) până la reverify', async () => {
  await ambeleOk()
  const extra = 'pt/1/v1/depus/depus_final_Anexa_extra.pdf'
  await db.sql(`${obiect(extra, 'anexa extra')}${user()} ${fisier(1, 'depus_final', 'Anexa_extra.pdf', extra, 'anexa extra')}`)
  await refuzDepus('J07: controale blocante')
  await edgeJ07(1); assert.deepEqual(await blocaje(), [])
  await refuzDepus('Anexa_extra.pdf: verificare PASS lipsă')
  assert.equal((await edgeJ04(1)).ok, true)
  await depusOk()
})
scenariu('între verificare și tranziție: rezultat J07 nou (block) pe același hash → REFUZ (ultimul rând câștigă)', async () => {
  await ambeleOk()
  await db.sql(`${service} INSERT INTO ofertare_poarta_rezultate_text(control_code,licitatie_id,parser_version,sursa_hash,stare,detalii)
    VALUES('numere',1,${q(PARSER_VERSION)},ofertare_poarta_text_sursa(1)->>'sursa_hash','undetermined','{"eroare":"parser"}');`)
  assert.deepEqual(await blocaje(), ['numere'])
  await refuzDepus('"numere"')
})
scenariu('parser_version schimbat, sursa neschimbată → toate rezultatele text invalide; edge vechi refuzat (409) → REFUZ', async () => {
  await ambeleOk()
  const h0 = await val(`ofertare_poarta_text_sursa(1)->>'sursa_hash'`)
  await db.sql(`${admin} CREATE OR REPLACE FUNCTION public.ofertare_poarta_parser_version() RETURNS text
    LANGUAGE sql IMMUTABLE SET search_path TO 'public','pg_temp' AS $f$ SELECT 'j07-text-v2'::text $f$;`)
  assert.equal(await val(`ofertare_poarta_text_sursa(1)->>'sursa_hash'`), h0, 'Sursa (hash) neschimbată')
  assert.deepEqual(await blocaje(), TEXT)
  assert.equal((await edgeJ07(1)).status, 409)
  await refuzDepus('J07: controale blocante')
})
scenariu('stale se decide prin hash, nu prin timp: sursa schimbată și readusă → rezultatul vechi redevine valabil', async () => {
  await ambeleOk()
  await db.sql(`${admin} UPDATE grafic_versiuni SET poarta='[{"test":1}]' WHERE licitatie_id=1 AND versiune=1;`)
  assert.deepEqual(await blocaje(), TEXT)
  await refuzDepus('J07: controale blocante')
  await db.sql(`${admin} UPDATE grafic_versiuni SET poarta='[]' WHERE licitatie_id=1 AND versiune=1;`)
  assert.deepEqual(await blocaje(), [], 'Același hash ⇒ același rezultat, indiferent de ora calculului')
  await depusOk()
})
scenariu('scriere directă prin API: ocolirile sunt refuzate, starea și dovezile rămân neatinse', async () => {
  const inainte = await foto()
  await db.sql(`${user()}
    ${reject(DEPUS, 'P0001', 'J07:')}
    ${rejectOri(`INSERT INTO ofertare_pt_pachet(licitatie_id,versiune,stare,aprobat_de,aprobat_la,depus_la) VALUES(1,9,'depus','${EDITOR}',now(),now())`, ['42501', 'P0001'])}
    ${reject("UPDATE ofertare_pt_pachet SET depus_la=now() WHERE id=1", 'P0001', 'depus_la se scrie doar')}
    ${reject(`INSERT INTO ofertare_pt_pachet_verificari(pachet_fisier_id,bucket,fisier_path,obj_id,obj_updated_at,obj_size,sha256_calculat,sha256_declarat,rezultat)
      VALUES(2,'ofertare','x','00000000-0000-4000-9000-000000000001',now(),1,repeat('a',64),repeat('a',64),'PASS')`, '42501', 'permission denied')}
    ${reject("INSERT INTO ofertare_poarta_rezultate_text(control_code,licitatie_id,parser_version,sursa_hash,stare,detalii) VALUES('anexe',1,'j07-text-v1',repeat('a',64),'ok','{}')", '42501', 'permission denied')}
    ${reject('SELECT ofertare_poarta_impune(1,1)', '42501', 'permission denied')}
    ${reject('SELECT ofertare_pt_fisier_snapshot(2)', '42501', 'permission denied')}
    ${reject('SELECT ofertare_poarta_text_sursa(1)', '42501', 'permission denied')}
    ${reject("UPDATE ofertare_licitatii SET status='depusa' WHERE id=1", 'P0001', 'lipseste pachetul')}
    UPDATE storage.objects SET metadata='{"size":1,"eTag":"x"}' WHERE name=${q(P.prop)};
    DELETE FROM storage.objects WHERE name=${q(P.prop)};
    ${user(DENIED)} UPDATE ofertare_pt_pachet SET stare='depus' WHERE id=1;
    ${user(null, 'anon')} DO $a$ BEGIN UPDATE ofertare_pt_pachet SET stare='depus' WHERE id=1; EXCEPTION WHEN insufficient_privilege THEN NULL; END $a$;`)
  assert.equal(await foto(), inainte, 'Nicio scriere directă nu a schimbat starea/dovezile (inclusiv R12 Storage)')
})
scenariu('J05: derogarea owner ocolește J02 (deci și cerința de pachet depus/J04), NU și J07', async () => {
  await db.sql(`${user()} UPDATE ofertare_pt_capitole SET continut=continut||' (editat)' WHERE id=1; ${reverificaLegatura}`)
  const inainte = await foto()
  await db.sql(`${user(OWNER)} ${reject("UPDATE ofertare_licitatii SET status='depusa',derogare_depunere=true,derogare_motiv='test' WHERE id=1", 'P0001', 'J07:')}`)
  assert.equal(await foto(), inainte, 'Refuzul J07 anulează atomic și auditul J05')
  await edgeJ07(1)
  await db.sql(`${user(OWNER)} UPDATE ofertare_licitatii SET status='depusa',derogare_depunere=true,derogare_motiv='test' WHERE id=1;
    ${admin} ${check(`(SELECT status='depusa' FROM ofertare_licitatii WHERE id=1) AND (SELECT count(*)=2 FROM ofertare_derogari_audit)
      AND (SELECT stare='aprobat' FROM ofertare_pt_pachet WHERE id=1)`, 'Derogare auditată; pachetul rămâne aprobat (J04 neinvocat)')}`)
})
scenariu('rollback invers (J07, apoi J04): funcții restaurate exact, dovezile păstrate, append-only activ; reaplicare J04→J07 → flux OK', async () => {
  assert.equal((await edgeJ04(1)).ok, true); await edgeJ07(1)
  const nV = await val('(SELECT count(*) FROM ofertare_pt_pachet_verificari)'), nT = await val('(SELECT count(*) FROM ofertare_poarta_rezultate_text)')
  await db.sql(`${admin} ${j07Rollback} ${j04Rollback}
    ${check(`NOT EXISTS(SELECT 1 FROM before_functions b JOIN pg_proc p USING(oid) WHERE pg_get_functiondef(p.oid)<>b.def)`, 'Funcțiile de tranziție = exact starea dinainte de J04+J07')}
    ${check(`(SELECT count(*) FROM ofertare_pt_pachet_verificari)=${nV} AND (SELECT count(*) FROM ofertare_poarta_rezultate_text)=${nT}`, 'Dovezile J04 și J07 păstrate')}
    ${reject('TRUNCATE ofertare_pt_pachet_verificari', '42501', 'append-only')}
    ${reject('DELETE FROM ofertare_poarta_rezultate_text', '42501', 'append-only')}`)
  // Copilot conv. 3 (NO-GO r1): după revenirea J04 (tabelul de dovezi rămâne), J07 NU se mai poate livra — cere J04 ACTIV.
  await db.sql(`${admin} ${reject(j07, 'P0001', 'Precondiție 0b')}`)
  // CONSTATARE (nu cerință): după ambele rollback-uri, tranziția revine la R11/R5 — poarta hash/J07 e redeschisă.
  // Vezi COPILOT_REVIEW «Rollback-ul nu poate redeschide poarta»: decizia rămâne la Copilot + Răzvan.
  await db.sql(`${admin} SAVEPOINT redeschis; ${user()} ${DEPUS}; ${admin} ROLLBACK TO SAVEPOINT redeschis; RELEASE SAVEPOINT redeschis;`)
  await db.sql(`${admin} ${j04} ${j07}`)
  await ambeleOk(); await depusOk()
})

// ── rulare ─────────────────────────────────────────────────────────────────────────────────────────
try {
  assert.ok(process.env.PGURI, 'Setează PGURI către PG16 local gol, jakv0407_test_<sufix>')
  let target
  try { target = new URL(process.env.PGURI) } catch { throw new Error('PGURI invalid (valoarea nu se afișează)') }
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol))
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Doar localhost')
  assert.equal(target.search, ''); assert.equal(target.hash, '')
  assert.equal(decodeURIComponent(target.username), 'postgres')
  assert.match(decodeURIComponent(target.pathname.slice(1)), /^jakv0407_test_[a-z0-9_]+$/)
  db = sesiune(target.href)
  await db.sql(setup + date)
  // Aprobarea v1 ca în UI: manifest → recalcul J07 → aprobat (J07 impus de trigger).
  await db.sql(`${user()} ${reject(`UPDATE ofertare_pt_pachet SET stare='aprobat',aprobat_de='${EDITOR}' WHERE id=1`, 'P0001', 'J07:')}`)
  const r7 = await edgeJ07(1)
  assert.ok(r7.rezultate.every(r => r.stare === 'ok'), 'Fixture: evaluatorul real dă OK: ' + JSON.stringify(r7.rezultate))
  assert.equal((await edgeJ04(1)).status, 409, 'J04 cere pachet aprobat')
  await db.sql(`${user()} UPDATE ofertare_pt_pachet SET stare='aprobat',aprobat_de='${EDITOR}' WHERE id=1;
    ${obiect(P.fin, 'final v1')}${obiect(P.dov, 'dovada seap v1')}${user()}
    ${fisier(1, 'depus_final', 'Final.pdf', P.fin, 'final v1')}${fisier(1, 'dovada_seap', 'Dovada.pdf', P.dov, 'dovada seap v1')}`)
  let trecute = 0
  for (const [nume, fn] of scenarii) {
    const copie = new Map(bytes)
    await db.sql(`${admin} SAVEPOINT scenariu;`)
    await fn()
    await db.sql(`${admin} ROLLBACK TO SAVEPOINT scenariu; RELEASE SAVEPOINT scenariu;`)
    bytes.clear(); for (const [k, v] of copie) bytes.set(k, v)
    console.log('PASS ' + nume); trecute++
  }
  await db.sql(`${admin} ROLLBACK;`)
  await db.inchide()
  assert.equal(trecute, scenarii.length)
  console.log(`PASS J04×J07: ${trecute} scenarii PG16 (migrări J04→J07, ambele triggere active, edge-uri reale simulate); rollback tranzacțional.`)
} catch (error) {
  console.error('FAIL J04×J07: ' + String(error?.message || error).replaceAll(process.env.PGURI || '\0', '[PGURI]'))
  await db?.inchide().catch(() => {})
  process.exitCode = 1
}
