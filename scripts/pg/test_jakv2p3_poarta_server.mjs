// PG16 real, bază LOCALĂ goală jakv2p3_test_*. Tot fixture-ul este tranzacțional; fără DROP DATABASE.
// PGURI=postgres://postgres@localhost:5432/jakv2p3_test_local node scripts/pg/test_jakv2p3_poarta_server.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { evalueazaTexte, PARSER_VERSION } from '../../supabase/functions/ofertare-poarta-text/evalueaza.mjs'
import { evalueazaPoarta } from '../../src/ofertarePoarta.js'
import { TEXT_OK } from '../../test-fixtures/jakv2p3/poarta.mjs'

const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const migration = n => read('supabase/migrations/' + n)
const transactionBody = s => s.replace(/^(BEGIN|COMMIT);\s*$/gm, '')
const OWNER = '00000000-0000-4000-8000-000000000121', EDITOR = '00000000-0000-4000-8000-000000000007'
const DENIED = '00000000-0000-4000-8000-000000000099'
const actor = 'jakv2p3_actor_' + process.pid
const q = s => "'" + String(s).replaceAll("'", "''") + "'"
const check = (expr, label) => `SELECT jakv2p3_assert((${expr}),${q(label)});\n`
const reject = (sql, code, fragment) => `DO $test$ DECLARE refused boolean:=false; BEGIN
  BEGIN EXECUTE ${q(sql)}; EXCEPTION WHEN SQLSTATE '${code}' THEN
    IF position(${q(fragment)} in SQLERRM)=0 THEN RAISE; END IF; refused:=true;
  END; PERFORM jakv2p3_assert(refused,${q('Refuz obligatoriu: ' + sql)}); END $test$;\n`
const admin = `RESET ROLE; RESET SESSION AUTHORIZATION; SET request.jwt.claims='{}';`
const user = (id = EDITOR, role = 'authenticated') => `${admin} SET SESSION AUTHORIZATION "${actor}";
  SET ROLE ${role}; SET request.jwt.claims=${q(JSON.stringify({ sub: id, role }))};`
const ctl = (name, state) => check(`ofertare_ctl_${name}(1)->>'stare'=${q(state)}`, `${name}: ${state}`)
const persist = (patch = {}, version = PARSER_VERSION, hash = null) => {
  const rows = evalueazaTexte({ ...TEXT_OK, ...patch })
  return `${admin} SET ROLE service_role;
    INSERT INTO ofertare_poarta_rezultate_text(control_code,licitatie_id,parser_version,sursa_hash,stare,detalii)
    SELECT x->>'control_code',1,${q(version)},${hash ? q(hash) : "ofertare_poarta_text_sursa(1)->>'sursa_hash'"},x->>'stare',x->'detalii'
    FROM jsonb_array_elements(${q(JSON.stringify(rows))}::jsonb) x; ${admin}\n`
}
const parity = label => `SELECT 'PARITY '||jsonb_build_object('label',${q(label)},'date',to_jsonb(v),
  'server',ofertare_poarta_server(1),'text',ofertare_poarta_text_sursa(1)->'date',
  'cantitati',(SELECT to_jsonb(n) FROM v_ofertare_cantitati_nevalidate n WHERE n.licitatie_id=1))::text
  FROM v_ofertare_pt_stare v WHERE licitatie_id=1;\n`

// Reutilizăm schema sintetică R5 fără să executăm setup-ul ei (care recreează baza).
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
const j07 = transactionBody(migration('20261003a_ofertare_poarta_server_jakv2p3.sql'))
const rollback = transactionBody(migration('20261003a_ofertare_poarta_server_jakv2p3_ROLLBACK.sql'))
const setup = `BEGIN;
SET LOCAL statement_timeout='20s';
DO $guard$ BEGIN
 IF current_setting('server_version_num')::int/10000<>16 OR session_user<>'postgres'
    OR current_database() !~ '^jakv2p3_test_[a-z0-9_]+$' THEN RAISE EXCEPTION 'Doar PG16 local dedicat, login postgres'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace)
    OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace)
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth') THEN RAISE EXCEPTION 'Baza trebuie să fie goală'; END IF;
END $guard$;
${base}
CREATE ROLE "${actor}" NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT authenticated,anon,service_role TO "${actor}";
CREATE FUNCTION jakv2p3_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAIL: %',msg; END IF; END $$;
-- fixture R5 nu are coloanele reale folosite de r08/J07 (live: ofertare_cerinte.text_cerinta există)
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
${copilot.slice(helperStart,helperEnd)}
${migration('20260928n_gate_depunere_r06.sql')}
${migration('20260929a_gate_depunere_pachet_jakv203.sql')}
${migration('20260929b_ofertare_derogare_audit.sql')}
${migration('20260928h_ofertare_pachet_poarta_r12.sql')}
${migration('20260928k_ofertare_pachet_depus_r11.sql')}
${migration('20260928o_ofertare_pachet_tranzitie_jakv201.sql')}
CREATE TEMP TABLE before_functions AS SELECT oid,pg_get_functiondef(oid) def,proacl,prosecdef,proconfig FROM pg_proc
 WHERE pronamespace='public'::regnamespace AND proname IN ('fn_gate_depunere','fn_ofertare_pt_pachet_poarta_documentatie',
 'fn_ofertare_pt_pachet_matrice','fn_gate_depunere_derogare_owner','ofertare_r5_blocaj_sursa','ofertare_derogare_depunere');
CREATE TEMP TABLE before_triggers AS SELECT oid,pg_get_triggerdef(oid) def FROM pg_trigger WHERE NOT tgisinternal;
CREATE TEMP TABLE before_policies AS SELECT oid,to_jsonb(p) def FROM pg_policy p;
${j07}
${j07}
${check(`NOT EXISTS(SELECT 1 FROM before_triggers b LEFT JOIN pg_trigger t USING(oid) WHERE t.oid IS NULL OR pg_get_triggerdef(t.oid)<>b.def OR t.tgenabled<>'O')`, 'Toate triggerele existente păstrate și active')}
${check(`NOT EXISTS(SELECT 1 FROM before_policies b LEFT JOIN pg_policy p USING(oid) WHERE p.oid IS NULL OR to_jsonb(p)<>b.def)`, 'R12: politicile existente nemodificate')}
${check(`NOT EXISTS(SELECT 1 FROM before_functions b JOIN pg_proc p USING(oid) WHERE p.proacl IS DISTINCT FROM b.proacl OR p.prosecdef IS DISTINCT FROM b.prosecdef OR p.proconfig IS DISTINCT FROM b.proconfig)`, 'ACL și securitate funcții existente intacte')}
${check(`NOT EXISTS(SELECT 1 FROM before_functions b JOIN pg_proc p USING(oid) WHERE p.proname NOT IN ('fn_gate_depunere','fn_ofertare_pt_pachet_poarta_documentatie') AND pg_get_functiondef(p.oid)<>b.def)`, 'R5/J02/J05 helpers nemodificați')}
${user()}
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
${admin}
${check(`ofertare_ctl_text(1,'anexe')->>'stare'='undetermined'`, 'Rezultat lipsă')}
${persist({}, 'parser-vechi')}
${check(`ofertare_ctl_text(1,'anexe')->>'stare'='undetermined'`, 'Parser vechi')}
${persist({}, PARSER_VERSION, 'b'.repeat(64))}
${check(`ofertare_ctl_text(1,'anexe')->>'stare'='undetermined'`, 'Hash stale')}
${check(`ofertare_poarta_server(1)->>'stare'='block'`, 'Lipsă/stale => agregare block')}
${user()}
${reject(`UPDATE ofertare_pt_pachet SET stare='aprobat',aprobat_de='${EDITOR}' WHERE id=1`, 'P0001', 'J07:')}
${persist()}
${check(`ofertare_poarta_server(1)->>'stare'='ok'`, 'Agregare ok')}
${check(`ofertare_poarta_server(1)->'identitate'->>'stare'='BUSINESS_DECISION_REQUIRED'
 AND (ofertare_poarta_server(1)->'identitate'->>'contribuie_la_verde')::boolean=false`, 'H1 nu contribuie la verde')}
${parity('baza')}
`

const scenarios = [
  ['cuprins', 'DELETE FROM ofertare_pt_legaturi WHERE id=1; DELETE FROM ofertare_pt_capitole WHERE id=1;'],
  ['neverificate', "UPDATE ofertare_pt_legaturi SET stare='atribuita' WHERE id=1;"],
  ['capcane', "DELETE FROM ofertare_pt_legaturi WHERE id=1; UPDATE ofertare_cerinte SET text_cerinta='Oferta este respinsa' WHERE id=1;"],
  ['goale', "UPDATE ofertare_pt_capitole SET continut='' WHERE id=1;"],
  ['nescrise', "UPDATE ofertare_pt_capitole SET sursa='ai' WHERE id=1;"],
  ['cantitati_f3_grafic', `UPDATE grafic_parametri SET parametri='{"fronturi":[{"lungime_m":1002}]}' WHERE licitatie_id=1;`],
  ['garantie', 'UPDATE ofertare_pt_garantie SET oferit_luni=24 WHERE licitatie_id=1;'],
  ['grafic_relatii', `UPDATE grafic_versiuni SET activitati='[{"cod":"A","es":1,"ef":5,"durata":5},{"cod":"B","es":5,"ef":6,"durata":2,"predecesori":[{"cod":"A","relatie":"FS"}]}]' WHERE licitatie_id=1;`],
  ['grafic_sursa', `INSERT INTO ofertare_pt_pachet_fisiere(pachet_id,rol,nume,sha256,sursa_versiune) VALUES(1,'grafic','Grafic.pdf',repeat('c',64),'grafic@v2');`],
]
let matrix = ''
for (const [control, change] of scenarios) {
  matrix += `SAVEPOINT scenario; ${ctl(control,'ok')} ${change} ${ctl(control,'block')}
    ${check(`ofertare_poarta_server(1)->>'stare'='block'`, 'Agregare: '+control)}
    ${parity(control)} ${user()}
    ${reject(`UPDATE ofertare_pt_pachet SET stare='aprobat',aprobat_de='${EDITOR}' WHERE id=1`, 'P0001', 'J07:')}
    ${admin} ROLLBACK TO scenario;\n`
}
const textChanges = [
  ['garantie', "UPDATE ofertare_pt_capitole SET continut='Anexa 1; garanție 48 luni; 372 branșamente' WHERE id=1;", { garantie_luni_in_capitole: [48] }],
  ['anexe', "UPDATE ofertare_pt_capitole SET continut='Anexa 2; garanție 36 luni; 372 branșamente' WHERE id=1;", { anexe_referite: ['Anexa 2'] }],
  ['numere', "UPDATE ofertare_pt_capitole SET continut='Anexa 1; garanție 36 luni; 371 branșamente' WHERE id=1;", { bransamente_in_capitole: [371] }],
  ['pachet', "INSERT INTO ofertare_pt_anexe_asteptate VALUES(1,1,'Anexa 2');", { anexe_declarate: [{ ref: 'Anexa 2' }] }],
]
for (const [control, change, patch] of textChanges) {
  matrix += `SAVEPOINT text_case; ${change}
    ${check(`ofertare_ctl_text(1,${q(control)})->>'stare'='undetermined'`, control+' editat => stale')}
    ${persist(patch)}
    ${check(`ofertare_ctl_text(1,${q(control)})->>'stare'='block'`, control+' text block')}
    ${parity('text '+control)}
    ${admin} ROLLBACK TO text_case;\n`
}
matrix += `
SAVEPOINT invalidare;
UPDATE ofertare_pt_capitole SET continut=continut||' editat' WHERE id=1;
${check(`(SELECT versiune=2 FROM ofertare_pt_capitole WHERE id=1)`, 'Trigger real: versiunea capitolului crește')}
${ctl('neverificate','block')}
${check(`ofertare_ctl_text(1,'anexe')->>'stare'='undetermined'`, 'Editarea invalidează fără ștergere')}
ROLLBACK TO invalidare;
SAVEPOINT grafic;
INSERT INTO ofertare_pt_pachet_fisiere(pachet_id,rol,nume,sha256,sursa_versiune) VALUES(1,'grafic','Grafic.pdf',repeat('c',64),'grafic@v1');
${ctl('grafic_sursa','ok')}
${persist()}
INSERT INTO grafic_versiuni(licitatie_id,versiune,activitati) VALUES(1,2,'[{"id":1}]');
${ctl('grafic_sursa','block')}
${check(`ofertare_ctl_text(1,'anexe')->>'stare'='undetermined'`, 'Versiune nouă grafic => stale')}
${persist()}
UPDATE grafic_versiuni SET activitati='[{"id":2}]' WHERE licitatie_id=1 AND versiune=1;
${check(`ofertare_ctl_text(1,'anexe')->>'stare'='undetermined'`, 'UPDATE pe versiune veche grafic => stale')}
ROLLBACK TO grafic;
SAVEPOINT eroare_parser;
INSERT INTO ofertare_poarta_rezultate_text(control_code,licitatie_id,parser_version,sursa_hash,stare,detalii)
 VALUES('anexe',1,ofertare_poarta_parser_version(),ofertare_poarta_text_sursa(1)->>'sursa_hash','undetermined','{"eroare":"parser"}');
${check(`ofertare_poarta_server(1)->'blocaje' ? 'anexe'`, 'Eroare parser persistată => block')}
ROLLBACK TO eroare_parser;
${user()}
${reject("INSERT INTO ofertare_poarta_rezultate_text(control_code,licitatie_id,parser_version,sursa_hash,stare,detalii) VALUES('anexe',1,'x',repeat('a',64),'ok','{}')", '42501', 'permission denied')}
${reject('SELECT ofertare_poarta_text_sursa(1)', '42501', 'permission denied')}
${check(`ofertare_poarta_server(1)->>'stare'='ok'`, 'RPC authenticated autorizat')}
${user(DENIED)}
${reject('SELECT ofertare_poarta_server(1)', '42501', 'Nu ai acces')}
${check(`(SELECT count(*)=0 FROM ofertare_poarta_rezultate_text)`, 'RLS fără acces => nicio expunere')}
${user(null, 'anon')}
${reject('SELECT ofertare_poarta_server(1)', '42501', 'permission denied')}
${user(null, 'service_role')}
${reject("UPDATE ofertare_poarta_rezultate_text SET stare='ok' WHERE id=1", '42501', 'permission denied')}
${reject('DELETE FROM ofertare_poarta_rezultate_text WHERE id=1', '42501', 'permission denied')}
${reject('TRUNCATE ofertare_poarta_rezultate_text', '42501', 'permission denied')}
${admin}
${reject("UPDATE ofertare_poarta_rezultate_text SET stare='ok' WHERE id=1", '42501', 'append-only')}
${reject('DELETE FROM ofertare_poarta_rezultate_text WHERE id=1', '42501', 'append-only')}
${reject('TRUNCATE ofertare_poarta_rezultate_text', '42501', 'append-only')}
-- R12 și J02 încă resping ocolirea fluxului.
${user()}
${reject(`INSERT INTO ofertare_pt_pachet(id,licitatie_id,versiune,stare,aprobat_de,aprobat_la) VALUES(2,1,2,'aprobat','${EDITOR}',now())`, 'P0001', 'J07:')}
${reject("UPDATE ofertare_pt_pachet SET stare='depus' WHERE id=1", 'P0001', 'Tranziție')}
${reject("UPDATE ofertare_licitatii SET status='depusa' WHERE id=1", 'P0001', 'lipseste pachetul')}
-- R5 sursă nevalidată, inclusiv derogare owner.
${admin} SAVEPOINT r5;
${user()}
UPDATE ofertare_cantitati SET cantitate=1001 WHERE id=1;
${reject(`UPDATE ofertare_pt_pachet SET stare='aprobat',aprobat_de='${EDITOR}' WHERE id=1`, 'P0001', 'cantități de verificat')}
${user(OWNER)}
${reject("UPDATE ofertare_licitatii SET status='depusa',derogare_depunere=true WHERE id=1", 'P0001', 'cantități de verificat')}
${admin} ROLLBACK TO r5;
SAVEPOINT documentatie;
UPDATE seap_compl SET blocaj='documentație incompletă' WHERE licitatie_id=1;
${user()}
${reject(`UPDATE ofertare_pt_pachet SET stare='aprobat',aprobat_de='${EDITOR}' WHERE id=1`, 'P0001', 'documentație incompletă')}
${admin} ROLLBACK TO documentatie;
-- Calea reală propus → aprobat → depus → licitație depusă, cu toate triggerele active.
SAVEPOINT flux;
${user()}
UPDATE ofertare_pt_pachet SET stare='aprobat',aprobat_de='${EDITOR}' WHERE id=1;
${reject("UPDATE ofertare_pt_pachet SET stare='propus' WHERE id=1", 'P0001', 'Tranziție')}
INSERT INTO ofertare_pt_pachet_fisiere(pachet_id,rol,nume,sha256) VALUES
 (1,'depus_final','Final.pdf',repeat('d',64)),(1,'dovada_seap','Dovada.pdf',repeat('e',64));
${reject("UPDATE ofertare_pt_pachet SET stare='depus' WHERE id=1", 'P0001', 'J07:')}
${persist()}
${user()}
UPDATE ofertare_pt_pachet SET stare='depus' WHERE id=1;
${admin}
${check(`ofertare_poarta_server(1)->>'stare'='ok'`, 'Tranziția de stare nu invalidează artificial rezultatul text')}
SAVEPOINT depus_vechi;
${user()}
INSERT INTO ofertare_pt_pachet(id,licitatie_id,versiune) VALUES(2,1,2);
${persist()}
${user()}
${reject("UPDATE ofertare_licitatii SET status='depusa' WHERE id=1", 'P0001', 'pachet_versiune')}
${admin} ROLLBACK TO depus_vechi;
SAVEPOINT dupa_aprobare;
UPDATE ofertare_pt_capitole SET continut=continut||' editat după aprobare' WHERE id=1;
${user(OWNER)}
${reject("UPDATE ofertare_licitatii SET status='depusa',derogare_depunere=true WHERE id=1", 'P0001', 'J07:')}
${admin}
${check(`(SELECT count(*)=0 FROM ofertare_derogari_audit WHERE licitatie_id=1)`, 'Refuzul J07 anulează atomic auditul J05')}
ROLLBACK TO dupa_aprobare;
SAVEPOINT fara_active;
UPDATE ofertare_cerinte SET duplicat_al=id WHERE id=1;
${user()}
${reject("UPDATE ofertare_licitatii SET status='depusa' WHERE id=1", 'P0001', '0 cerinte extrase active')}
${admin} ROLLBACK TO fara_active;
${user()}
UPDATE ofertare_licitatii SET status='depusa' WHERE id=1;
${admin}
${check(`(SELECT status='depusa' FROM ofertare_licitatii WHERE id=1)`, 'Depunere validă')}
ROLLBACK TO flux;
-- Derogarea J05 funcționează pe controalele ei istorice, nu ocolește J07.
SAVEPOINT derogare;
${user(OWNER)}
UPDATE ofertare_licitatii SET derogare_depunere=true,derogare_motiv='Decizie de test',status='depusa' WHERE id=1;
${admin}
${check(`(SELECT count(*)=2 FROM ofertare_derogari_audit WHERE licitatie_id=1)`, 'J05: acordare și depunere auditate')}
ROLLBACK TO derogare;
-- Pachetul vechi nu se aprobă pe rezultatele versiunii noi.
SAVEPOINT vechi;
${user()}
INSERT INTO ofertare_pt_pachet(id,licitatie_id,versiune) VALUES(2,1,2);
${reject(`UPDATE ofertare_pt_pachet SET stare='aprobat',aprobat_de='${EDITOR}' WHERE id=1`, 'P0001', 'pachet_versiune')}
${admin} ROLLBACK TO vechi;
CREATE TEMP TABLE count_before AS SELECT count(*) n FROM ofertare_poarta_rezultate_text;
${rollback}
${rollback}
${check(`NOT EXISTS(SELECT 1 FROM before_functions b JOIN pg_proc p USING(oid) WHERE pg_get_functiondef(p.oid)<>b.def)`, 'Rollback exact al funcțiilor')}
${check(`(SELECT count(*) FROM ofertare_poarta_rezultate_text)=(SELECT n FROM count_before)`, 'Rollback păstrează auditul')}
${j07}
${check(`ofertare_poarta_server(1)->>'stare'='ok'`, 'Reaplicare cu istoric existent')}
ROLLBACK;
SELECT 'PASS JAKV2P3';
`

try {
  assert.ok(process.env.PGURI, 'Setează PGURI către PG16 local gol, jakv2p3_test_<sufix>')
  const target = new URL(process.env.PGURI)
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol))
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Doar localhost')
  assert.equal(target.search, ''); assert.equal(target.hash, '')
  assert.equal(decodeURIComponent(target.username), 'postgres')
  assert.match(decodeURIComponent(target.pathname.slice(1)), /^jakv2p3_test_[a-z0-9_]+$/)
  const result = spawnSync('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '--dbname', target.href, '--file', '-'], {
    input: setup + matrix, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '5' },
  })
  if (result.error) throw Error('psql indisponibil: ' + result.error.code)
  if (result.status !== 0) throw Error(result.stderr || 'psql eșuat')
  assert.match(result.stdout, /PASS JAKV2P3/)
  const fixtures = result.stdout.split('\n').filter(s => s.startsWith('PARITY ')).map(s => JSON.parse(s.slice(7)))
  assert.equal(fixtures.length, 14)
  for (const f of fixtures) {
    const ui = evalueazaPoarta({ ...f.date, ...f.cantitati, poarta_server: f.server })
    for (const c of f.server.controale.filter(c => c.stare !== 'undetermined')) {
      const r = ui.randuri.find(r => r.k === (c.control_code === 'cantitati_f3_grafic' ? 'cantitati' : c.control_code))
      assert.equal(c.stare === 'block', r.stare === 'block', `${f.label}: ${c.control_code}`)
    }
    for (const text of evalueazaTexte(f.text)) {
      const server = f.server.controale.find(c => c.control_code === text.control_code)
      if (server.stare !== 'undetermined') assert.equal(server.stare, text.stare, `${f.label}: text ${text.control_code}`)
    }
  }
  console.log('PASS JAKV2P3: controale, hash/parser/invalidare, ACL, triggere active, R5/R12/J02/J05, rollback și paritate UI/Edge/SQL.')
} catch (error) {
  console.error('FAIL JAKV2P3: ' + String(error.message).replaceAll(process.env.PGURI || '\0', '[PGURI]'))
  process.exitCode = 1
}
