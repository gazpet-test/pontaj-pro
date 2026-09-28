// JAK-V2-01 (Audit Ofertare V2): matricea de tranziții pe ofertare_pt_pachet, PostgreSQL 16 real.
// Fără PGlite, fără dependențe npm. Demonstrează întâi bypass-ul pe schema PRE-fix (retrogradare
// aprobat→propus permisă de OR-ul celor două politici PERMISSIVE), apoi îl refuză după migrare.
// Rulare: PGURI=postgres://postgres@localhost:5432/r9b_test_jakv201 PGPASSWORD=postgres node scripts/pg/test_jakv201_tranzitie.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const RESP = '00000000-0000-4000-8000-000000000007'   // are modul ofertare (editor)
const ALT  = '00000000-0000-4000-8000-000000000008'   // alt utilizator cu modul
const env = { ...process.env, PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '5' }
const opt = ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1']

function psql(conn, sql) {
  try {
    return execFileSync('psql', [...opt, '--dbname', conn, '--file', '-'],
      { input: sql, encoding: 'utf8', env, timeout: 30000, maxBuffer: 8 * 1024 * 1024, stdio: ['pipe','pipe','pipe'] }).trim()
  } catch (e) {
    throw new Error(`psql: ${e.code === 'ENOENT' ? 'executabil indisponibil în PATH' : String(e.stderr || e.code || 'eșec').trim()}`)
  }
}

function setup() {
  assert.ok(process.env.PGURI, 'Setează PGURI către o bază PostgreSQL 16 locală de test')
  const t = new URL(process.env.PGURI)
  assert.ok(['postgres:', 'postgresql:'].includes(t.protocol), 'PGURI trebuie să fie URI PostgreSQL')
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(t.hostname), 'Doar baze locale de test')
  const name = decodeURIComponent(t.pathname.slice(1))
  assert.match(name, /^r9b(?:_test_[a-z0-9_]+)?$/, 'Baza trebuie numită r9b sau r9b_test_<sufix>')
  const admin = new URL(t.href); admin.pathname = '/postgres'
  const version = Number(psql(admin.href, 'SHOW server_version_num;'))
  assert.equal(Math.floor(version / 10000), 16, `Este necesar PostgreSQL 16 real; server_version_num=${version}`)
  psql(admin.href, `SET statement_timeout='10s'; DROP DATABASE IF EXISTS "${name}"; CREATE DATABASE "${name}";`)
  return t.href
}

// Schema minimală: exact politicile și triggerele LIVE relevante pentru pachet (fără matrice).
const schema = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid $$;
CREATE TABLE profiles (id uuid PRIMARY KEY, is_owner boolean DEFAULT false);
CREATE TABLE user_module_access (profile_id uuid, module text);
INSERT INTO profiles VALUES ('${RESP}',false),('${ALT}',false);
INSERT INTO user_module_access VALUES ('${RESP}','ofertare'),('${ALT}','ofertare');
CREATE FUNCTION fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS
  $$ SELECT auth.uid() IS NOT NULL AND (EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND is_owner)
       OR EXISTS (SELECT 1 FROM user_module_access WHERE profile_id=auth.uid() AND module='ofertare')) $$;

CREATE TABLE ofertare_pt_pachet (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, licitatie_id bigint NOT NULL, versiune int NOT NULL,
  stare text NOT NULL DEFAULT 'propus', aprobat_de uuid, aprobat_la timestamptz, depus_la timestamptz, nota text,
  CONSTRAINT ofertare_pt_pachet_stare_check CHECK (stare IN ('propus','aprobat','depus')),
  CONSTRAINT ofertare_pt_pachet_stare_chk CHECK (
    (stare='propus') OR (stare='aprobat' AND aprobat_de IS NOT NULL AND aprobat_la IS NOT NULL)
    OR (stare='depus' AND aprobat_de IS NOT NULL AND aprobat_la IS NOT NULL AND depus_la IS NOT NULL)),
  CONSTRAINT ofertare_pt_pachet_unic UNIQUE (licitatie_id, versiune));
ALTER TABLE ofertare_pt_pachet ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON ofertare_pt_pachet TO authenticated;
CREATE POLICY ofertare_pt_pachet_select ON ofertare_pt_pachet FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ofertare_pt_pachet_insert ON ofertare_pt_pachet FOR INSERT TO authenticated
  WITH CHECK (fn_are_acces_ofertare() AND stare='propus' AND aprobat_de IS NULL AND aprobat_la IS NULL);
CREATE POLICY ofertare_pt_pachet_update ON ofertare_pt_pachet FOR UPDATE TO authenticated
  USING (fn_are_acces_ofertare() AND stare='propus')
  WITH CHECK (fn_are_acces_ofertare() AND (stare='propus' OR (stare='aprobat' AND aprobat_de=auth.uid())));
CREATE POLICY ofertare_pt_pachet_depune ON ofertare_pt_pachet FOR UPDATE TO authenticated
  USING (fn_are_acces_ofertare() AND stare='aprobat')
  WITH CHECK (fn_are_acces_ofertare() AND stare='depus');

CREATE TABLE ofertare_pt_pachet_fisiere (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, pachet_id bigint NOT NULL REFERENCES ofertare_pt_pachet(id) ON DELETE CASCADE,
  rol text NOT NULL, nume text NOT NULL, sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  fisier_path text, size_bytes bigint, CONSTRAINT ofertare_pt_pachet_fisiere_unic UNIQUE (pachet_id, rol, nume));
ALTER TABLE ofertare_pt_pachet_fisiere ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON ofertare_pt_pachet_fisiere TO authenticated;
CREATE POLICY ofertare_pt_pachet_fisiere_select ON ofertare_pt_pachet_fisiere FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ofertare_pt_pachet_fisiere_insert ON ofertare_pt_pachet_fisiere FOR INSERT TO authenticated
  WITH CHECK (fn_are_acces_ofertare() AND EXISTS (SELECT 1 FROM ofertare_pt_pachet p WHERE p.id=ofertare_pt_pachet_fisiere.pachet_id
    AND (p.stare='propus' OR (p.stare='aprobat' AND ofertare_pt_pachet_fisiere.rol IN ('depus_final','dovada_seap')))));

CREATE FUNCTION fn_pt_pachet_depus_verifica() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
BEGIN
  IF NEW.stare='depus' AND OLD.stare IS DISTINCT FROM 'depus' THEN
    IF NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet_fisiere f WHERE f.pachet_id=NEW.id AND f.rol='depus_final') THEN
      RAISE EXCEPTION 'Pachetul nu poate fi marcat depus fără fișierele efectiv depuse în SEAP (rol depus_final).' USING ERRCODE='P0001'; END IF;
    IF NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet_fisiere f WHERE f.pachet_id=NEW.id AND f.rol='dovada_seap') THEN
      RAISE EXCEPTION 'Pachetul nu poate fi marcat depus fără dovada depunerii din SEAP (rol dovada_seap).' USING ERRCODE='P0001'; END IF;
    NEW.depus_la := now();
  END IF; RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_pt_pachet_depus_verifica ON ofertare_pt_pachet;
CREATE TRIGGER trg_pt_pachet_depus_verifica BEFORE UPDATE OF stare ON ofertare_pt_pachet
  FOR EACH ROW EXECUTE FUNCTION fn_pt_pachet_depus_verifica();
`

// helper SQL: rulează `sql` ca authenticated cu jwt=uid; refuza() cere ca `sql` să pice cu `mesaj`.
const asUser = uid => `SET ROLE authenticated; SET request.jwt.claims = '{"sub":"${uid}","role":"authenticated"}';`
const admin = `RESET ROLE; RESET request.jwt.claims;`
const refuza = (sql, mesaj) => `DO $t$ BEGIN BEGIN
  ${sql.includes(';') ? sql : sql + ';'}
  RAISE EXCEPTION 'TEST FAIL: comanda trebuia refuzată';
EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST FAIL%' THEN RAISE;
  ELSIF SQLERRM NOT LIKE '%${mesaj}%' THEN RAISE EXCEPTION 'TEST FAIL: alt mesaj: %', SQLERRM; END IF; END; END $t$;`
const cere = (expr, msg) => `DO $t$ BEGIN IF NOT (${expr}) THEN RAISE EXCEPTION 'TEST FAIL: ${msg}'; END IF; END $t$;`

const uri = setup()
psql(uri, schema)
const sha = "'" + 'a'.repeat(64) + "'"

// ── FAZA A: schema PRE-fix (fără matrice) — bypass-ul JAK-V2-01 e permis ────────────────────────
const outA = psql(uri, `${asUser(RESP)}
BEGIN;
  INSERT INTO ofertare_pt_pachet(licitatie_id,versiune,stare) VALUES (9001,1,'propus');
  UPDATE ofertare_pt_pachet SET stare='aprobat', aprobat_de='${RESP}', aprobat_la=now() WHERE licitatie_id=9001;
  ${cere("(SELECT stare FROM ofertare_pt_pachet WHERE licitatie_id=9001)='aprobat'", 'aprobarea nu a reușit în setup')}
  -- BUG: retrogradarea aprobat→propus TREBUIE să reușească pe schema pre-fix
  UPDATE ofertare_pt_pachet SET stare='propus' WHERE licitatie_id=9001;
  ${cere("(SELECT stare FROM ofertare_pt_pachet WHERE licitatie_id=9001)='propus'", 'PRE-fix: retrogradarea aprobat→propus ar fi trebuit permisă (bypass neconfirmat)')}
ROLLBACK;
${admin}
SELECT 'FAZA_A_BYPASS_CONFIRMAT';`)

// ── aplică migrarea (adaugă matricea) ───────────────────────────────────────────────────────────
psql(uri, admin + '\n' + readFileSync(new URL('../../supabase/migrations/20260928o_ofertare_pachet_tranzitie_jakv201.sql', import.meta.url), 'utf8'))

// ── FAZA B: post-fix — tranzițiile invalide sunt refuzate, cele valide merg ─────────────────────
const out = psql(uri, `${asUser(RESP)}
-- flux valid: propus → aprobat
INSERT INTO ofertare_pt_pachet(licitatie_id,versiune,stare) VALUES (9002,1,'propus');
UPDATE ofertare_pt_pachet SET stare='aprobat', aprobat_de='${RESP}', aprobat_la=now() WHERE licitatie_id=9002;
${cere("(SELECT stare FROM ofertare_pt_pachet WHERE licitatie_id=9002)='aprobat'", 'propus→aprobat ar fi trebuit permis')}
-- INVALID: retrogradare aprobat → propus (JAK-V2-01)
${refuza(`UPDATE ofertare_pt_pachet SET stare='propus' WHERE licitatie_id=9002`, 'Tranziție de pachet interzisă')}
-- INVALID: rescrierea semnăturii de aprobare (backdate / alt autor)
${refuza(`UPDATE ofertare_pt_pachet SET aprobat_de='${ALT}' WHERE licitatie_id=9002`, 'nu se pot modifica după aprobare')}
-- flux valid: aprobat → depus (cu ambele roluri de fișier)
INSERT INTO ofertare_pt_pachet_fisiere(pachet_id,rol,nume,sha256) SELECT id,'depus_final','oferta.pdf',${sha} FROM ofertare_pt_pachet WHERE licitatie_id=9002;
INSERT INTO ofertare_pt_pachet_fisiere(pachet_id,rol,nume,sha256) SELECT id,'dovada_seap','dovada.pdf',${sha} FROM ofertare_pt_pachet WHERE licitatie_id=9002;
UPDATE ofertare_pt_pachet SET stare='depus' WHERE licitatie_id=9002;
${cere("(SELECT stare FROM ofertare_pt_pachet WHERE licitatie_id=9002)='depus' AND (SELECT depus_la FROM ofertare_pt_pachet WHERE licitatie_id=9002) IS NOT NULL", 'aprobat→depus ar fi trebuit permis, cu depus_la de server')}
-- INVALID: pachet depus imuabil pentru authenticated — nicio politică UPDATE nu acoperă starea 'depus',
-- deci RLS ascunde rândul (0 rânduri afectate, fără excepție). Verificăm că rămâne neschimbat.
UPDATE ofertare_pt_pachet SET nota='x', stare='propus' WHERE licitatie_id=9002;
${cere("(SELECT stare FROM ofertare_pt_pachet WHERE licitatie_id=9002)='depus' AND (SELECT nota FROM ofertare_pt_pachet WHERE licitatie_id=9002) IS NULL", 'RLS ar fi trebuit să lase pachetul depus neschimbat')}
${admin}
-- Apărare în adâncime: chiar dacă o politică viitoare ar expune rândul depus, triggerul îl refuză (ca postgres, RLS ocolit).
${refuza(`UPDATE ofertare_pt_pachet SET nota='x' WHERE licitatie_id=9002`, 'depus este imuabil')}
${asUser(RESP)}
-- INVALID: propus → depus direct (sare peste aprobare)
INSERT INTO ofertare_pt_pachet(licitatie_id,versiune,stare) VALUES (9003,1,'propus');
INSERT INTO ofertare_pt_pachet_fisiere(pachet_id,rol,nume,sha256) SELECT id,'depus_final','o.pdf',${sha} FROM ofertare_pt_pachet WHERE licitatie_id=9003;
INSERT INTO ofertare_pt_pachet_fisiere(pachet_id,rol,nume,sha256) SELECT id,'dovada_seap','d.pdf',${sha} FROM ofertare_pt_pachet WHERE licitatie_id=9003;
${refuza(`UPDATE ofertare_pt_pachet SET stare='depus' WHERE licitatie_id=9003`, 'Tranziție de pachet interzisă')}
-- INVALID: aprobare semnată în numele altcuiva
INSERT INTO ofertare_pt_pachet(licitatie_id,versiune,stare) VALUES (9004,1,'propus');
${refuza(`UPDATE ofertare_pt_pachet SET stare='aprobat', aprobat_de='${ALT}', aprobat_la=now() WHERE licitatie_id=9004`, 'semnată de utilizatorul curent')}
-- INVALID (NO-GO 1 Copilot): pre-setarea semnăturii / timpului pe propus, înainte de aprobare
${refuza(`UPDATE ofertare_pt_pachet SET aprobat_de='${RESP}', aprobat_la='2000-01-01' WHERE licitatie_id=9004`, 'se scriu doar la aprobare')}
${refuza(`UPDATE ofertare_pt_pachet SET depus_la='2000-01-01' WHERE licitatie_id=9004`, 'se scrie doar la depunere')}
-- aprobare cu aprobat_la antedatat: trece, dar serverul pune now() (timpul clientului e ignorat)
UPDATE ofertare_pt_pachet SET stare='aprobat', aprobat_de='${RESP}', aprobat_la='2000-01-01' WHERE licitatie_id=9004;
${cere("(SELECT aprobat_la FROM ofertare_pt_pachet WHERE licitatie_id=9004) > now() - interval '1 minute'", 'aprobat_la trebuia pus de server (now), nu antedatat')}
-- depus_la fals pe un pachet aprobat, fără tranziție: refuzat
${refuza(`UPDATE ofertare_pt_pachet SET depus_la='2000-01-01' WHERE licitatie_id=9004`, 'se scrie doar la depunere')}
-- depunere cu depus_la antedatat: serverul pune now()
INSERT INTO ofertare_pt_pachet_fisiere(pachet_id,rol,nume,sha256) SELECT id,'depus_final','o.pdf',${sha} FROM ofertare_pt_pachet WHERE licitatie_id=9004;
INSERT INTO ofertare_pt_pachet_fisiere(pachet_id,rol,nume,sha256) SELECT id,'dovada_seap','d.pdf',${sha} FROM ofertare_pt_pachet WHERE licitatie_id=9004;
UPDATE ofertare_pt_pachet SET stare='depus', depus_la='2000-01-01' WHERE licitatie_id=9004;
${cere("(SELECT depus_la FROM ofertare_pt_pachet WHERE licitatie_id=9004) > now() - interval '1 minute'", 'depus_la trebuia pus de server (now), nu antedatat')}
-- INVALID: schimbarea versiunii pe un pachet existent
INSERT INTO ofertare_pt_pachet(licitatie_id,versiune,stare) VALUES (9005,1,'propus');
${refuza(`UPDATE ofertare_pt_pachet SET versiune=2 WHERE licitatie_id=9005`, 'imuabile pe un pachet existent')}
${admin}
SELECT 'JAKV201_OK';`)

assert.match(outA, /FAZA_A_BYPASS_CONFIRMAT/, 'Faza A trebuia să confirme bypass-ul pe schema pre-fix')
assert.match(out, /JAKV201_OK/, 'Faza B trebuia să treacă toate aserțiunile post-fix')
console.log('JAK-V2-01: bypass reprodus pe schema pre-fix, refuzat după migrare. Toate aserțiunile au trecut.')
