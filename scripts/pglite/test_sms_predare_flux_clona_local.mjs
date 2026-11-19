// Proba LOCALĂ (PGlite, fără nicio bază reală) a gărzilor și a curățeniei din supabase/tests/20261226b_sms_predare_flux_clona.sh
// (PR #1121 r2, Jakarinos NO-GO pe 6da8108d: P1 curățenia putea șterge date preexistente, P2 izolarea SMS nedovedită).
// SQL-ul se ia DIN SCRIPT (SMSP_BIBLIOTECA=1: scriptul doar definește funcțiile sql_* și iese înaintea oricărei conexiuni) și rulează pe o
// schemă falsă cu cheile / FK-urile / CHECK-urile reale ale tabelelor atinse (20261126a, 20261129g, 20261130a) și cu un jurnal ca
// fn_red_jurnal (AFTER INSERT pe red_*, fără token; DELETE refuzat de trigger, ca jurnalul append-only).
//   A. garda 25 (sql_garda_resturi): refuză un identificator al probei pe ORICE coloană-cheie (contraexemplul Jakarinos: UAT fără copii, din
//      alt proiect, cu id-ul UAT_N), trece pe o bază fără ele;
//   B. curățenia după un S0 picat (PK pe UAT_N): NU șterge nimic (lanțul rulării e gol), nici resturile unei rulări anterioare cu alt marcaj;
//   C. curățenia după o rulare completă: șterge EXACT lanțul rulării (inclusiv jurnalul și tokenurile), lasă intacte rândurile străine scrise
//      în timpul probei, pune la loc setările; garda 25 trece din nou;
//   D. garda 28 (sql_izolare): sesiuni străine, extensii, loturi trimisibile, rezervări / trimiteri străine din fereastră (catalogul
//      pg_stat_activity / pg_extension e umbrit DOAR în test, prin search_path, ca să se poată simula o sesiune străină);
//   E. ordinea în script: garda 28 înaintea fiecărei porniri a trimiterii și la final; curățenia armată după gărzi; scenariul F4c;
//   MUTANȚI: fiecare TREBUIE să pice cel puțin o verificare.
// Rulare (din rădăcina repo-ului; cere bash în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_sms_predare_flux_clona_local.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'smspflux_'))
const F_FL = join(ROOT, 'supabase/tests/20261226b_sms_predare_flux_clona.sh')
const SCRIPT = readFileSync(F_FL, 'utf8').replace(/\r/g, '')
const M30C = readFileSync(join(ROOT, 'supabase/migrations/20261130c_sms_redari_sablon.sql'), 'utf8').replace(/\r/g, '')

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }
function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (t.split(din).length !== 2) throw new Error('mutantul nu găsește textul o singură dată: ' + din.slice(0, 90))
    t = t.split(din).join(in_)
  }
  return t
}
// funcțiile sql_* ale unei variante a scriptului (originalul sau un mutant), cu MARCAJ / T0 / SNAP date
let nVar = 0
function varianta(text) {
  const f = join(TMP, `flux_${nVar++}.sh`)
  writeFileSync(f, text)
  return (fn, { MARCAJ = '', T0 = '', SNAP = '' } = {}) => execFileSync('bash', ['-c', 'SMSP_BIBLIOTECA=1; . "$1" || exit 9; MARCAJ="$2"; T0="$3"; SNAP="$4"; "$5"',
    '_', f, MARCAJ, T0, SNAP, fn], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}
// psql cu ON_ERROR_STOP: metacomenzile scriptului (\set, \gset) -> SQL simplu; eroarea = ROLLBACK + mesajul
const faraMeta = sql => sql.replace(/^\\set ON_ERROR_STOP 1\n/m, '').replace(/ \\gset$/gm, ';')
async function ruleaza(db, sql) {
  try { await db.exec(faraMeta(sql)); return null } catch (e) { try { await db.exec('ROLLBACK') } catch { /* fără tranzacție */ } return e.message }
}
const unRand = async (db, sql) => { const r = await db.query(sql); return r.rows.length ? Object.values(r.rows[0])[0] : undefined }

// ── identificatorii probei (aceiași ca în script) și ai datelor „străine” ──
const id = n => `b26b0000-0000-4000-8000-${String(n).padStart(12, '0')}`
const PR = id(1), UAT_N = id(101), UAT_V2 = id(103), PA_N = id(201), D1 = id(301), D5 = id(305), CV01 = id(401), LV1 = id(501), MV1 = id(601)
const X = n => `00000000-0000-4000-8000-00000000c${String(n).padStart(3, '0')}`   // spațiul datelor străine
const PX = X(1), UX = X(11), PAX = X(21), DX = X(31), LX = X(41), MX = X(51)

const SCHEMA = `
CREATE TABLE public.red_proiecte (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cod text NOT NULL UNIQUE CHECK (btrim(cod) <> ''), denumire text,
  contact_telefon text, contact_email text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.red_uat (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id), nume text NOT NULL,
  uat3 text NOT NULL CHECK (uat3 ~ '^[A-Z]{3}$'), sesiune_zi1 date, program_zi1 text, UNIQUE (proiect_id, uat3));
CREATE TABLE public.red_parcele (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  uat_id uuid NOT NULL REFERENCES public.red_uat(id), id_parcela text NOT NULL CHECK (id_parcela ~ '^[A-Z]{3}-[0-9]{4}$'), tronson int, UNIQUE (proiect_id, id_parcela));
CREATE TABLE public.red_detinatori (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parcela_id uuid NOT NULL REFERENCES public.red_parcele(id),
  nume text NOT NULL, nume_normalizat text NOT NULL, calitate text NOT NULL, sters_la timestamptz);
CREATE TABLE public.red_detinatori_token (detinator_id uuid PRIMARY KEY REFERENCES public.red_detinatori(id), token_raspuns text NOT NULL UNIQUE);
CREATE TABLE public.red_detinatori_contact (detinator_id uuid PRIMARY KEY REFERENCES public.red_detinatori(id), telefon text, adresa_strada text,
  adresa_sat text, adresa_comuna text, adresa_judet text, cod_postal text, adresa_cunoscuta boolean NOT NULL DEFAULT true);
CREATE TABLE public.red_convocari (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), detinator_id uuid NOT NULL REFERENCES public.red_detinatori(id),
  canal text NOT NULL, nr_document text UNIQUE, calitate_document text, stare text NOT NULL DEFAULT 'activ', sters_la timestamptz);
CREATE TABLE public.red_jurnal (id bigserial PRIMARY KEY, tabela text NOT NULL, inregistrare_id uuid, actiune text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.sms_setari (id boolean PRIMARY KEY DEFAULT true CHECK (id), kill_switch boolean NOT NULL, redari_autorizat boolean NOT NULL,
  plafon_zi int NOT NULL, plafon_luna int NOT NULL, versiune int NOT NULL, actualizat_la timestamptz);
CREATE TABLE public.sms_loturi (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), categorie text NOT NULL, stare text NOT NULL,
  proiect_id uuid REFERENCES public.red_proiecte(id), uat_id uuid REFERENCES public.red_uat(id), text text);
CREATE TABLE public.sms_mesaje (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lot_id uuid NOT NULL REFERENCES public.sms_loturi(id), telefon text,
  destinatar_tip text, destinatar_id uuid, stare text NOT NULL DEFAULT 'in_coada', rezervat_la timestamptz, trimis_la timestamptz);
-- jurnalul ca fn_red_jurnal (id, altfel detinator_id; fără token) + append-only (DELETE refuzat de trigger); loturile / mesajele: DELETE refuzat
CREATE FUNCTION public.fn_jurnal_fals() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune) VALUES (TG_TABLE_NAME, coalesce(to_jsonb(NEW) ->> 'id', to_jsonb(NEW) ->> 'detinator_id')::uuid, lower(TG_OP));
  RETURN NULL; END $f$;
CREATE FUNCTION public.fn_fara_delete() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'DELETE refuzat pe % (trigger)', TG_TABLE_NAME; END $f$;
CREATE TRIGGER trg_j AFTER INSERT ON public.red_proiecte FOR EACH ROW EXECUTE FUNCTION public.fn_jurnal_fals();
CREATE TRIGGER trg_j AFTER INSERT ON public.red_uat FOR EACH ROW EXECUTE FUNCTION public.fn_jurnal_fals();
CREATE TRIGGER trg_j AFTER INSERT ON public.red_parcele FOR EACH ROW EXECUTE FUNCTION public.fn_jurnal_fals();
CREATE TRIGGER trg_j AFTER INSERT ON public.red_detinatori FOR EACH ROW EXECUTE FUNCTION public.fn_jurnal_fals();
CREATE TRIGGER trg_j AFTER INSERT ON public.red_detinatori_contact FOR EACH ROW EXECUTE FUNCTION public.fn_jurnal_fals();
CREATE TRIGGER trg_j AFTER INSERT ON public.red_convocari FOR EACH ROW EXECUTE FUNCTION public.fn_jurnal_fals();
CREATE TRIGGER trg_imuabil BEFORE DELETE ON public.red_jurnal FOR EACH ROW EXECUTE FUNCTION public.fn_fara_delete();
CREATE TRIGGER trg_sms_loturi_reguli BEFORE DELETE ON public.sms_loturi FOR EACH ROW EXECUTE FUNCTION public.fn_fara_delete();
CREATE TRIGGER trg_sms_mesaje_reguli BEFORE DELETE ON public.sms_mesaje FOR EACH ROW EXECUTE FUNCTION public.fn_fara_delete();
-- umbrele catalogului DOAR pentru D (search_path = fals, pg_catalog, public)
CREATE SCHEMA fals;
CREATE TABLE fals.pg_stat_activity (pid int, usename name, application_name text, backend_type text);
CREATE TABLE fals.pg_extension (extname name);
INSERT INTO public.sms_setari (kill_switch, redari_autorizat, plafon_zi, plafon_luna, versiune, actualizat_la) VALUES (true, false, 200, 3000, 7, '2026-11-01 10:00+02');`
// datele străine: un proiect real-ish cu UAT, parcelă, deținător (contact, token, convocare), un lot închis cu un mesaj trimis demult
const STRAINE = `
INSERT INTO public.red_proiecte (id, cod, denumire) VALUES ('${PX}', 'LOT-STRAIN', 'proiect strain');
INSERT INTO public.red_uat (id, proiect_id, nume, uat3) VALUES ('${UX}', '${PX}', 'Strainesti', 'STR');
INSERT INTO public.red_parcele (id, proiect_id, uat_id, id_parcela) VALUES ('${PAX}', '${PX}', '${UX}', 'STR-0001');
INSERT INTO public.red_detinatori (id, parcela_id, nume, nume_normalizat, calitate) VALUES ('${DX}', '${PAX}', 'Strain', 'STRAIN', 'proprietar');
INSERT INTO public.red_detinatori_contact (detinator_id, telefon) VALUES ('${DX}', '0700000111');
INSERT INTO public.red_detinatori_token (detinator_id, token_raspuns) VALUES ('${DX}', repeat('s', 40));
INSERT INTO public.red_convocari (id, detinator_id, canal, nr_document) VALUES ('${X(61)}', '${DX}', 'posta', 'C-STRAIN-1');
INSERT INTO public.sms_loturi (id, categorie, stare, proiect_id, uat_id) VALUES ('${LX}', 'redari', 'coada_golita', '${PX}', '${UX}');
INSERT INTO public.sms_mesaje (id, lot_id, destinatar_tip, destinatar_id, stare, rezervat_la, trimis_la) VALUES ('${MX}', '${LX}', 'detinator', '${DX}', 'trimis', now() - interval '3 days', now() - interval '3 days');`
const TABELE = ['red_proiecte', 'red_uat', 'red_parcele', 'red_detinatori', 'red_detinatori_contact', 'red_detinatori_token', 'red_convocari', 'red_jurnal', 'sms_loturi', 'sms_mesaje', 'sms_setari']
async function instantaneu(db) {
  const o = {}
  for (const t of TABELE) o[t] = (await db.query(`SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text), '[]'::jsonb)::text AS j FROM public.${t} x`)).rows[0].j
  return o
}
const diferite = (a, b) => TABELE.filter(t => a[t] !== b[t])
async function bazaNoua(extra = '') {
  const db = new PGlite()
  await db.exec(SCHEMA)
  await db.exec(STRAINE)
  if (extra) await db.exec(extra)
  return db
}
const pornire = async db => ({ T0: await unRand(db, 'SELECT clock_timestamp()::text'), SNAP: await unRand(db, 'SELECT to_jsonb(s)::text FROM public.sms_setari s') })
const MARCAJ = 'a1b2c3d4-0000-4000-8000-00000000aaaa', MARCAJ_VECHI = 'a1b2c3d4-0000-4000-8000-00000000bbbb'

// ── A. garda 25 ──
// fiecare intrus = un rând STRĂIN care poartă un identificator al probei; garda trebuie să-l vadă (eticheta tabelului)
const INTRUSI = [
  ['UAT fără copii din alt proiect, cu id-ul UAT_N (contraexemplul Jakarinos)', `INSERT INTO public.red_uat (id, proiect_id, nume, uat3) VALUES ('${UAT_N}', '${PX}', 'Intrus', 'INT');`, 'red_uat'],
  ['parcelă din alt proiect cu id-ul PA_N', `INSERT INTO public.red_parcele (id, proiect_id, uat_id, id_parcela) VALUES ('${PA_N}', '${PX}', '${UX}', 'STR-0002');`, 'red_parcele'],
  ['deținător cu id-ul D1 (+ contactul lui)', `INSERT INTO public.red_detinatori (id, parcela_id, nume, nume_normalizat, calitate) VALUES ('${D1}', '${PAX}', 'Intrus', 'INTRUS', 'proprietar');
     INSERT INTO public.red_detinatori_contact (detinator_id) VALUES ('${D1}');`, 'red_detinatori'],
  ['convocare cu id-ul CV01 la un deținător străin', `INSERT INTO public.red_convocari (id, detinator_id, canal) VALUES ('${CV01}', '${DX}', 'posta');`, 'red_convocari'],
  ['convocare străină cu numărul de document al probei', `INSERT INTO public.red_convocari (detinator_id, canal, nr_document) VALUES ('${DX}', 'posta', 'TEST-SMSP-SINT-1');`, 'red_convocari'],
  ['rând de jurnal rămas cu id-ul UAT_V2', `INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune) VALUES ('red_uat', '${UAT_V2}', 'delete');`, 'red_jurnal'],
  ['lot din alt proiect cu id-ul LV1', `INSERT INTO public.sms_loturi (id, categorie, stare, proiect_id) VALUES ('${LV1}', 'redari', 'anulat', '${PX}');`, 'sms_loturi'],
  ['mesaj cu id-ul MV1 într-un lot străin', `INSERT INTO public.sms_mesaje (id, lot_id, destinatar_tip, destinatar_id, stare) VALUES ('${MV1}', '${LX}', 'detinator', '${DX}', 'anulat');`, 'sms_mesaje'],
  ['mesaj străin către deținătorul D5', `INSERT INTO public.sms_mesaje (lot_id, destinatar_tip, destinatar_id, stare) VALUES ('${LX}', 'detinator', '${D5}', 'anulat');`, 'sms_mesaje'],
  ['alt proiect cu codul TEST-SMSP-SINT', `INSERT INTO public.red_proiecte (cod, denumire) VALUES ('TEST-SMSP-SINT', 'alt proiect');`, 'red_proiecte'],
]
async function garda25(sql) {
  const ab = []
  { const db = await bazaNoua(); const r = await unRand(db, sql('sql_garda_resturi')); if (r !== '') ab.push(`baza fără identificatori ai probei: [${r}] (aștepta gol)`); await db.close() }
  for (const [nume, ins, eticheta] of INTRUSI) {
    const db = await bazaNoua(ins)
    const r = await unRand(db, sql('sql_garda_resturi'))
    if (!(r || '').split(',').includes(eticheta)) ab.push(`${nume}: [${r}] (aștepta ${eticheta})`)
    await db.close()
  }
  return ab
}

// ── B. curățenia după un S0 picat / cu resturile altei rulări ──
async function curatenieFaraRulare(sql, extra, ce) {
  const ab = []
  const db = await bazaNoua(extra)
  const { T0, SNAP } = await pornire(db)
  const inainte = await instantaneu(db)
  const eS0 = await ruleaza(db, sql('sql_s0', { MARCAJ }))
  if (!eS0) ab.push(`${ce}: S0 a trecut (fixture-ul trebuia să-l facă să pice)`)
  const eC = await ruleaza(db, sql('sql_curatenie', { MARCAJ, T0, SNAP }))
  if (eC) ab.push(`${ce}: curățenia a picat (${eC.slice(0, 140)})`)
  const d = diferite(inainte, await instantaneu(db))
  if (d.length) ab.push(`${ce}: rânduri preexistente schimbate / șterse în ${d.join(', ')}`)
  await db.close()
  return ab
}
async function curatenieB(sql) {
  return [
    ...await curatenieFaraRulare(sql, INTRUSI[0][1], 'S0 picat pe PK (UAT străin cu id-ul UAT_N)'),
    ...await curatenieFaraRulare(sql, `INSERT INTO public.red_proiecte (id, cod, denumire) VALUES ('${PR}', 'TEST-SMSP-SINT', 'Proba SMS predare (sintetic) ${MARCAJ_VECHI}');
       INSERT INTO public.red_uat (id, proiect_id, nume, uat3) VALUES ('${UAT_N}', '${PR}', 'Sinteticeni', 'ZSA');
       INSERT INTO public.sms_loturi (categorie, stare, proiect_id, uat_id) VALUES ('redari', 'anulat', '${PR}', '${UAT_N}');`, 'resturile unei rulări ANTERIOARE (alt marcaj) + S0 picat'),
  ]
}

// ── C. curățenia după o rulare completă ──
async function curatenieC(sql) {
  const ab = []
  const db = await bazaNoua()
  const { T0, SNAP } = await pornire(db)
  const inainte = await instantaneu(db)
  const eS0 = await ruleaza(db, sql('sql_s0', { MARCAJ }))
  if (eS0) { ab.push('S0 a picat: ' + eS0.slice(0, 140)); await db.close(); return ab }
  // ce ar mai fi scris proba (loturi pe proiect, mesaje, tokenuri, setările schimbate) + scrieri STRĂINE în timpul probei (trebuie să rămână)
  await db.exec(`
    INSERT INTO public.sms_loturi (id, categorie, stare, proiect_id, uat_id) VALUES ('${LV1}', 'redari', 'anulat', '${PR}', '${id(102)}');
    INSERT INTO public.sms_loturi (categorie, stare, proiect_id, uat_id) VALUES ('redari', 'coada_golita', '${PR}', '${UAT_N}');
    INSERT INTO public.sms_mesaje (lot_id, destinatar_tip, destinatar_id, stare, rezervat_la) SELECT l.id, 'detinator', '${D1}', 'necunoscut', now() FROM public.sms_loturi l WHERE l.proiect_id = '${PR}' AND l.stare = 'coada_golita';
    INSERT INTO public.sms_mesaje (id, lot_id, destinatar_tip, destinatar_id, stare) VALUES ('${MV1}', '${LV1}', 'detinator', '${id(304)}', 'anulat');
    INSERT INTO public.red_detinatori_token (detinator_id, token_raspuns) VALUES ('${D1}', repeat('a', 40)), ('${id(302)}', repeat('b', 40));
    UPDATE public.sms_setari SET kill_switch = false, redari_autorizat = true, versiune = versiune + 3, actualizat_la = now();
    INSERT INTO public.red_uat (id, proiect_id, nume, uat3) VALUES ('${X(12)}', '${PX}', 'Strain Doi', 'STD');`)
  const strainInTimp = await instantaneu(db)
  const eC = await ruleaza(db, sql('sql_curatenie', { MARCAJ, T0, SNAP }))
  if (eC) ab.push('curățenia a picat: ' + eC.slice(0, 160))
  const dupa = await instantaneu(db)
  // așteptat: tot ce exista înainte + UAT-ul străin scris în timpul probei (și rândul lui de jurnal), nimic din lanțul rulării
  const asteptat = { ...inainte, red_uat: null, red_jurnal: null }
  const d = TABELE.filter(t => asteptat[t] !== null && asteptat[t] !== dupa[t])
  if (d.length) ab.push('după curățenie diferă de starea de dinainte în: ' + d.join(', '))
  const uatStrain = await unRand(db, `SELECT count(*)::int FROM public.red_uat WHERE id = '${X(12)}'`)
  const jStrain = await unRand(db, `SELECT count(*)::int FROM public.red_jurnal WHERE inregistrare_id = '${X(12)}'`)
  if (uatStrain !== 1 || jStrain !== 1) ab.push(`rândurile străine scrise în timpul probei: UAT ${uatStrain}, jurnal ${jStrain} (aștepta 1, 1)`)
  if (strainInTimp.red_jurnal === dupa.red_jurnal) ab.push('jurnalul rulării nu s-a șters')
  const rest = await unRand(db, sql('sql_garda_resturi'))
  if (rest !== '') ab.push(`garda 25 după curățenie: [${rest}] (aștepta gol)`)
  await db.close()
  return ab
}

// ── D. garda 28 (T0 = ceasul bazei la verificare; momentele din fixture-uri sunt relative la el) ──
const IZOLARE = [
  ['clona izolată', '', ''],
  ['o sesiune PostgREST (authenticator)', `INSERT INTO fals.pg_stat_activity VALUES (4242, 'authenticator', 'postgrest', 'client backend');`, 'sesiuni_straine=1'],
  ['o consolă fără nume de aplicație', `INSERT INTO fals.pg_stat_activity VALUES (4243, 'postgres', '', 'client backend');`, 'sesiuni_straine=1'],
  ['o sesiune a probei (proba_smsp_x) nu e străină', `INSERT INTO fals.pg_stat_activity VALUES (4244, 'postgres', 'proba_smsp_x', 'client backend');`, ''],
  ['un proces de fundal al serverului nu e sesiune client', `INSERT INTO fals.pg_stat_activity VALUES (4245, NULL, '', 'autovacuum launcher');`, ''],
  ['extensia pg_net', `INSERT INTO fals.pg_extension VALUES ('pg_net');`, 'extensii=pg_net'],
  ['extensia http', `INSERT INTO fals.pg_extension VALUES ('http');`, 'extensii=http'],
  ['un lot intern aprobat (fără proiect)', `INSERT INTO public.sms_loturi (categorie, stare) VALUES ('intern', 'aprobat');`, 'loturi_trimisibile_in_afara_probei=1'],
  ['un lot Redări în trimitere pe alt proiect', `INSERT INTO public.sms_loturi (categorie, stare, proiect_id) VALUES ('redari', 'in_trimitere', '${PX}');`, 'loturi_trimisibile_in_afara_probei=1'],
  ['un lot aprobat al probei nu contează', `INSERT INTO public.red_proiecte (id, cod) VALUES ('${PR}', 'TEST-SMSP-SINT'); INSERT INTO public.sms_loturi (categorie, stare, proiect_id) VALUES ('redari', 'aprobat', '${PR}');`, ''],
  ['o rundă străină rezervată cu 5 minute înainte de pornire', `INSERT INTO public.sms_mesaje (lot_id, stare, rezervat_la) VALUES ('${LX}', 'necunoscut', now() - interval '5 minutes');`, 'rezervari_in_afara_probei=1'],
  ['o trimitere străină în timpul probei', `INSERT INTO public.sms_mesaje (lot_id, stare, rezervat_la, trimis_la) VALUES ('${LX}', 'trimis', now() - interval '1 hour', now() + interval '1 minute');`, 'rezervari_in_afara_probei=1'],
  ['o rundă străină veche (20 de minute înainte) nu contează', `INSERT INTO public.sms_mesaje (lot_id, stare, rezervat_la) VALUES ('${LX}', 'necunoscut', now() - interval '20 minutes');`, ''],
]
async function garda28(sql) {
  const ab = []
  for (const [nume, ins, astept] of IZOLARE) {
    const db = await bazaNoua(ins)
    await db.exec('SET search_path = fals, pg_catalog, public')
    const r = await unRand(db, sql('sql_izolare', { T0: await unRand(db, 'SELECT now()::text') }))
    if (astept === '' ? r !== '' : !(r || '').startsWith(astept) && !(r || '').includes(',' + astept)) ab.push(`${nume}: [${r}] (aștepta ${astept || 'gol'})`)
    await db.close()
  }
  return ab
}

// ── E. ordinea în script ──
function ordine(text) {
  const ab = []
  const linii = text.split('\n')
  const iMain = linii.findIndex(l => l.startsWith('set -euo pipefail'))
  // fiecare pornire a trimiterii (kill-switch oprit / comutatorul Redări pornit) are o verificare de izolare după pornirea precedentă
  let armat = false, porniri = 0
  linii.slice(iMain).forEach((l, k) => {
    if (/^\s*izolare_verifica "/.test(l)) armat = true
    if (/\$\((kill_switch false|comutator_redari true)\)/.test(l)) { porniri++; if (!armat) ab.push(`pornirea trimiterii fără garda 28 înainte (linia ${iMain + k + 1}): ${l.trim().slice(0, 90)}`); armat = false }
  })
  if (porniri < 4) ab.push(`porniri ale trimiterii găsite: ${porniri} (aștepta cel puțin 4: F1 x2, F4c, F4b)`)
  const idx = s => text.indexOf(s)
  const iPornire = idx('izolare_verifica "la pornire"'), iRest = idx('REST="$(q "$(sql_garda_resturi)")"'), iArm = idx('\nCURATA=1\n'), iS0 = idx('\nqf "$TMP/s0.sql"')
  const iSnap = idx('SNAP="$(q "SELECT to_jsonb(s)::text'), iFinal = idx('izolare_verifica "la final'), iF6 = idx('# ── F6 '), iExit = text.lastIndexOf('\nexit "$ESEC"')
  if (!(iPornire > iMain && iPornire < iRest && iRest < iSnap && iSnap < iArm && iArm < iS0)) ab.push('ordinea la pornire: izolare -> garda 25 -> copia setărilor -> curățenia armată -> S0')
  if (!(iFinal > iF6 && iFinal < iExit)) ab.push('garda 28 la final (după F6, înainte de ieșire) lipsește')
  if ((text.match(/\nCURATA=1\n/g) || []).length !== 1) ab.push('curățenia se armează într-un singur loc')
  // curățenia nu șterge după liste de id-uri, doar din mulțimile lanțului (_p_*)
  const cur = text.slice(idx('sql_curatenie() {'), idx('\n# testul local'))
  const del = cur.match(/^DELETE FROM [^\n]*$/gm) || []
  const rele = del.filter(d => !/^DELETE FROM public\.\w+ WHERE (id|detinator_id) IN \(SELECT id FROM _p_\w+\);$/.test(d))
  if (del.length !== 10 || rele.length) ab.push(`ștergerile curățeniei (${del.length}, aștepta 10) doar din mulțimile lanțului; altfel: ${rele.join(' | ').slice(0, 200)}`)
  // F4c: antet + verificare cu motivul real din fn_sms_rezerva
  if (!/^#   F4c /m.test(text) || !text.includes('ok "$(rezerva "$LOT_N" 5)" "OK kill_switch|-|-|-" "F4c ') || !M30C.includes("jsonb_build_object('motiv', 'kill_switch', 'mesaje', '[]'::jsonb)"))
    ab.push('F4c (rezervarea refuzată cu kill-switch-ul pornit, motivul kill_switch din 20261130c) lipsește')
  if (!/exit 28$/m.test(text.slice(idx('izolare_verifica() {'), idx('\ncuratenie() {')))) ab.push('garda 28 nu iese cu 28')
  return ab
}

async function totul(text) {
  const sql = varianta(text)
  return [...await garda25(sql), ...await curatenieB(sql), ...await curatenieC(sql), ...await garda28(sql), ...ordine(text)]
}

console.log('0. sintaxa bash + modul bibliotecă (nicio conexiune)')
{
  let sn = null; try { execFileSync('bash', ['-n', F_FL], { stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { sn = String(e.stderr || e.message) }
  ok(sn === null, 'bash -n ' + (sn || 'OK'))
  const sql = varianta(SCRIPT)
  const s0 = sql('sql_s0', { MARCAJ })
  ok(s0.includes(`'Proba SMS predare (sintetic) ${MARCAJ}'`) && /^BEGIN;$/m.test(s0) && /^COMMIT;$/m.test(s0), 'sql_s0: proiectul poartă marcajul rulării, o tranzacție')
  // cheile fixe (PR, 5 UAT, 5 parcele, 8 deținători, 4 loturi, 5 mesaje = 28; + SPATIU) și prefixul convocărilor: toate în spațiul gărzii 25
  const toate = [...SCRIPT.matchAll(/\b([A-Z][A-Z0-9_]*)="?(b26b0000-[0-9a-f-]+)/g)]
  ok(toate.length === 30 && toate.every(m => m[2].startsWith('b26b0000-0000-4000-8000-')) && toate.some(m => m[1] === 'CV'),
    `toate cele ${toate.length} chei fixe / prefixe ale probei sunt în spațiul gărzii 25`)
}
console.log('A. garda 25 (identificatorii probei pe orice coloană-cheie)')
{ const ab = await garda25(varianta(SCRIPT)); ab.forEach(a => console.log('     ' + a)); ok(ab.length === 0, `baza curată trece, ${INTRUSI.length} intruși refuzați (${ab.length} abateri)`) }
console.log('B. curățenia când rularea n-a creat nimic (S0 picat), cu rânduri străine purtând id-uri ale probei')
{ const ab = await curatenieB(varianta(SCRIPT)); ab.forEach(a => console.log('     ' + a)); ok(ab.length === 0, `nimic preexistent atins, nici resturile altei rulări (${ab.length} abateri)`) }
console.log('C. curățenia după o rulare completă (lanțul rulării + scrieri străine în timpul probei)')
{ const ab = await curatenieC(varianta(SCRIPT)); ab.forEach(a => console.log('     ' + a)); ok(ab.length === 0, `șterge exact lanțul rulării, setările puse la loc, garda 25 trece din nou (${ab.length} abateri)`) }
console.log('D. garda 28 (izolarea SMS)')
{ const ab = await garda28(varianta(SCRIPT)); ab.forEach(a => console.log('     ' + a)); ok(ab.length === 0, `${IZOLARE.length} cazuri (${ab.length} abateri)`) }
console.log('E. ordinea în script')
{ const ab = ordine(SCRIPT); ab.forEach(a => console.log('     ' + a)); ok(ab.length === 0, `garda 28 înaintea fiecărei porniri și la final, curățenia armată după gărzi, F4c (${ab.length} abateri)`) }

console.log('M. MUTANȚI (fiecare TREBUIE să pice cel puțin o verificare)')
const L_UAT_G = "  CASE WHEN EXISTS (SELECT 1 FROM public.red_uat x WHERE x.id::text LIKE $s OR x.proiect_id::text LIKE $s) THEN 'red_uat' END,\n"
const L_JUR_G = "  CASE WHEN EXISTS (SELECT 1 FROM public.red_jurnal x WHERE x.inregistrare_id::text LIKE $s) THEN 'red_jurnal' END,\n"
const DEL_UAT = 'DELETE FROM public.red_uat WHERE id IN (SELECT id FROM _p_uat);'
const VERIF_NUMAR = "    IF v_acum IS DISTINCT FROM v_n.inainte - v_n.ale_rularii THEN\n"
const MUTANTI = [
  ['garda 25 fără red_uat (contraexemplul Jakarinos)', [[L_UAT_G, '']]],
  ['garda 25 fără red_jurnal', [[L_JUR_G, '']]],
  ['garda 25 fără numărul de document', [[" OR x.nr_document LIKE '$COD-%'", '']]],
  ['garda 25 fără destinatarul mesajelor', [[' OR x.destinatar_id::text LIKE $s', '']]],
  ['curățenia șterge UAT-urile după id (ca în r1)', [[DEL_UAT, "DELETE FROM public.red_uat WHERE id::text LIKE '${SPATIU}%' OR id IN (SELECT id FROM _p_uat);"]]],
  ['curățenia după id + fără verificarea pe numere', [[DEL_UAT, "DELETE FROM public.red_uat WHERE id::text LIKE '${SPATIU}%' OR id IN (SELECT id FROM _p_uat);"], [VERIF_NUMAR, '    IF false THEN\n']]],
  ['proiectul rulării fără marcaj (doar id + cod)', [[" AND x.denumire = '$(denumire)'", '']]],
  ['curățenia fără ștergerea tokenurilor', [['DELETE FROM public.red_detinatori_token WHERE detinator_id IN (SELECT id FROM _p_det);\n', '']]],
  ['curățenia fără jurnalul rulării', [['DELETE FROM public.red_jurnal WHERE id IN (SELECT id FROM _p_jurnal);\n', '']]],
  ['curățenia fără readucerea setărilor', [["  EXECUTE format('UPDATE public.sms_setari s SET", "  PERFORM format('UPDATE public.sms_setari s SET"], [' USING v_snap;', ';']]],
  ['garda 28 fără sesiunile străine', [["   HAVING count(*) > 0),\n  (SELECT 'extensii='", "   HAVING count(*) < 0),\n  (SELECT 'extensii='"]]],
  ['garda 28 fără pg_net / http', [["e.extname IN ('pg_cron', 'pg_net', 'http')", "e.extname IN ('pg_cron')"]]],
  ['garda 28 fără loturile trimisibile', [["WHERE l.stare IN ('aprobat', 'in_trimitere') AND l.proiect_id IS DISTINCT FROM", "WHERE l.stare IN ('aprobat_x') AND l.proiect_id IS DISTINCT FROM"]]],
  ['garda 28 doar rezervările, nu și trimiterile', [[" OR m.trimis_la >= '$T0'::timestamptz - interval '15 minutes'", '']]],
  ['garda 28 fără fereastra de dinaintea pornirii', [["WHERE (m.rezervat_la >= '$T0'::timestamptz - interval '15 minutes'", "WHERE (m.rezervat_la >= '$T0'::timestamptz"]]],
  ['F4b pornește trimiterea fără garda 28', [['izolare_verifica "F4b, inainte de oprirea kill-switch-ului"\n', '']]],
  ['fără garda 28 la final', [['izolare_verifica "la final, dupa F1-F6"\n', '']]],
  ['curățenia armată înaintea gărzii 25', [['\nCURATA=1\n', '\n'], ['izolare_verifica "la pornire"\n', 'CURATA=1\nizolare_verifica "la pornire"\n']]],
  ['fără scenariul F4c (kill-switch)', [['ok "$(rezerva "$LOT_N" 5)" "OK kill_switch|-|-|-" "F4c ', 'ok "$(rezerva "$LOT_N" 5)" "OK kill_switch|-|-|-" "F4x ']]],
]
for (const [nume, lista] of MUTANTI) {
  let t
  try { t = aplica(SCRIPT, lista) } catch (e) { ok(false, `MUTANT ${nume}: nu se aplică (${e.message})`); continue }
  const ab = await totul(t)
  ok(ab.length > 0, `MUTANT ${nume} — prins: ${(ab[0] || '').slice(0, 150)}`)
}

console.log(esec ? `\nESEC: ${esec} verificări au picat` : '\nPASS: toate verificările au trecut')
process.exit(esec ? 1 : 0)
