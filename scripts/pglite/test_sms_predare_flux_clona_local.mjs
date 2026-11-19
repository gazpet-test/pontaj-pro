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
//      r3: cheia înaintea primei conexiuni, bariera pusă înaintea oricărei schimbări, verificată la fiecare poartă, scoasă doar după setări;
//   F. r3 (Jakarinos NO-GO r2, P2: garda 28 e un instantaneu): BARIERA de trimitere (29) pe lanțul SMS REAL 20261130a + 20261130b —
//      F1 scenariul din review (worker conectat după verificare, rezervă cu furnizorul lui, se deconectează): fără barieră se REPRODUCE
//      (mesajele probei rezervate, garda 28 goală înainte și după), cu barieră e refuzat; F2 lotul intern străin, cronul, cheia greșită, proba
//      pe un lot străin, replica, anularea legitimă, calea probei; F3 aceeași secvență a probei cu / fără barieră = aceleași rânduri;
//      F4 verificarea „în vigoare” (proba funcțională, triggerul exact, amprenta), bariera rămasă, scoaterea; F5 cheia (bash = Node = baza);
//   G. curățenia PICATĂ lasă bariera pe clonă (fail-closed);
//   MUTANȚI: fiecare TREBUIE să pice cel puțin o verificare (r2: grupurile A–E; r3: grupurile date pe mutant).
// Rulare (din rădăcina repo-ului; cere bash în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_sms_predare_flux_clona_local.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

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
// funcțiile sql_* ale unei variante a scriptului (originalul sau un mutant), cu MARCAJ / T0 / SNAP / CHEIE_SHA / BAR_MD5 date
let nVar = 0
function varianta(text) {
  const f = join(TMP, `flux_${nVar++}.sh`)
  writeFileSync(f, text)
  const sql = (fn, { MARCAJ = '', T0 = '', SNAP = '', CHEIE_SHA = '', BAR_MD5 = '' } = {}) => execFileSync('bash', ['-c',
    'SMSP_BIBLIOTECA=1; . "$1" || exit 9; MARCAJ="$2"; T0="$3"; SNAP="$4"; CHEIE_SHA="$5"; BAR_MD5="$6"; "$7"',
    '_', f, MARCAJ, T0, SNAP, CHEIE_SHA, BAR_MD5, fn], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  // cheie_noua din script: „CHEIE CHEIE_SHA” (doar în test se tipărește cheia: în probă ea nu iese din PGOPTIONS)
  sql.cheie = () => execFileSync('bash', ['-c', 'SMSP_BIBLIOTECA=1; . "$1" || exit 9; cheie_noua || exit 8; printf "%s %s" "$CHEIE" "$CHEIE_SHA"', '_', f],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split(' ')
  return sql
}
// SHA-ul de test (cheia „cheie-de-test”) pentru bazele fără sesiuni ale probei (B / C / G)
const CHEIE_TEST = 'cheie-de-test', SHA_TEST = createHash('sha256').update(CHEIE_TEST, 'utf8').digest('hex')
// rezultatul ULTIMEI instrucțiuni dintr-un text cu mai multe (DO + SELECT), prima coloană
async function ultimul(db, sql) {
  const r = await db.exec(faraMeta(sql))
  const u = r[r.length - 1]
  return u && u.rows.length ? Object.values(u.rows[0])[0] : undefined
}
async function eroare(p) { try { await p; return null } catch (e) { return e } }
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
  destinatar_tip text, destinatar_id uuid, stare text NOT NULL DEFAULT 'in_coada', rezervat_la timestamptz, trimis_la timestamptz, furnizor text, furnizor_id text);
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
  // r3: ca în script, bariera (29) e pusă înaintea lui S0; curățenia o scoate după setări
  const eB = await ruleaza(db, sql('sql_bariera_pune', { CHEIE_SHA: SHA_TEST }))
  if (eB) ab.push(`${ce}: bariera nu s-a pus: ${eB.slice(0, 120)}`)
  const eS0 = await ruleaza(db, sql('sql_s0', { MARCAJ }))
  if (!eS0) ab.push(`${ce}: S0 a trecut (fixture-ul trebuia să-l facă să pice)`)
  const eC = await ruleaza(db, sql('sql_curatenie', { MARCAJ, T0, SNAP }))
  if (eC) ab.push(`${ce}: curățenia a picat (${eC.slice(0, 140)})`)
  const d = diferite(inainte, await instantaneu(db))
  if (d.length) ab.push(`${ce}: rânduri preexistente schimbate / șterse în ${d.join(', ')}`)
  const abs = await unRand(db, sql('sql_bariera_absenta'))
  if (abs !== 'true') ab.push(`${ce}: bariera a rămas după curățenie [${abs}]`)
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
  const eB = await ruleaza(db, sql('sql_bariera_pune', { CHEIE_SHA: SHA_TEST }))
  if (eB) ab.push('bariera nu s-a pus: ' + eB.slice(0, 120))
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
  const abs = await unRand(db, sql('sql_bariera_absenta'))
  if (abs !== 'true') ab.push(`bariera a rămas după curățenie [${abs}]`)
  await db.close()
  return ab
}

// ── G. curățenia PICATĂ (r3): bariera RĂMÂNE (fail-closed), nimic șters, setările probei neatinse de ea ──
// fixture: după S0, un rând STRĂIN (parcelă din alt proiect) ține prin FK UAT-ul probei -> ștergerea UAT-ului pică -> ROLLBACK
async function curatenieG(sql) {
  const ab = []
  const db = await bazaNoua()
  const { T0, SNAP } = await pornire(db)
  const eB = await ruleaza(db, sql('sql_bariera_pune', { CHEIE_SHA: SHA_TEST }))
  const BAR_MD5 = await unRand(db, sql('sql_bariera_amprenta'))
  const eS0 = await ruleaza(db, sql('sql_s0', { MARCAJ }))
  if (eB || eS0) { ab.push(`pregătirea: ${eB || eS0}`); await db.close(); return ab }
  await db.exec(`UPDATE public.sms_setari SET kill_switch = false, redari_autorizat = true, versiune = versiune + 2;
    INSERT INTO public.red_parcele (id, proiect_id, uat_id, id_parcela) VALUES ('${X(22)}', '${PX}', '${UAT_N}', 'STR-0009');`)
  const inainte = await instantaneu(db)
  const eC = await ruleaza(db, sql('sql_curatenie', { MARCAJ, T0, SNAP }))
  if (!eC) ab.push('curățenia a trecut (fixture-ul trebuia s-o facă să pice)')
  const d = diferite(inainte, await instantaneu(db))
  if (d.length) ab.push('curățenia picată a schimbat totuși: ' + d.join(', '))
  if (await unRand(db, sql('sql_bariera_absenta')) !== 'false') ab.push('bariera a dispărut deși curățenia a picat')
  const v = await eroare(ultimul(db, sql('sql_bariera_verifica', { BAR_MD5 })))
  if (v) ab.push('bariera rămasă nu mai e în vigoare: ' + v.message.slice(0, 120))
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
  if (!/exit 28$/m.test(text.slice(idx('izolare_verifica() {'), idx('\nbariera_manual() {')))) ab.push('garda 28 nu iese cu 28')
  // ── r3: bariera (29) ── (iMain e indice de LINIE; aici indici de caracter)
  const cMain = text.indexOf('\nset -euo pipefail\n'), main = text.slice(cMain)
  const jm = s => main.indexOf(s)
  // cheia: generată și exportată în PGOPTIONS ÎNAINTEA primei conexiuni (toate sesiunile probei o moștenesc)
  const iCheie = jm('\ncheie_noua || {'), iExport = jm('\nexport PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c smsp.cheie=$CHEIE"\n'), iConex = jm('REAL="$(q ')
  if (!(iCheie > 0 && iCheie < iExport && iExport < iConex)) ab.push('cheia rulării: generată și exportată în PGOPTIONS înaintea primei conexiuni')
  if (/PGOPTIONS=/.test(main.slice(iExport + 10))) ab.push('PGOPTIONS e rescris după export')
  // punerea: verificarea cheii în sesiune -> punere -> BARIERA=1 -> amprenta -> garda 28 de la pornire (înaintea gărzii 25, a copiei, a lui S0)
  const iCs = jm('[ "$(q "$(sql_cheie_sesiune)")" = "$CHEIE_SHA" ]'), iPune = jm('if ! qf "$TMP/bariera.sql"'), iFlag = jm('\nBARIERA=1\n')
  const iMd5 = jm('BAR_MD5="$(q "$(sql_bariera_amprenta)")"'), iPorn = jm('\nizolare_verifica "la pornire"\n'), iR25 = jm('REST="$(q "$(sql_garda_resturi)")"')
  if (!(iCs > iConex && iCs < iPune && iPune < iFlag && iFlag < iMd5 && iMd5 < iPorn && iPorn < iR25)) ab.push('ordinea barierei: cheia în sesiune -> punere -> BARIERA=1 -> amprenta -> garda 28 la pornire -> garda 25')
  if ((main.match(/\nBARIERA=1\n/g) || []).length !== 1) ab.push('BARIERA=1 într-un singur loc')
  if (!/exit 29; }\n$|exit 29\nfi\n/.test(main.slice(iPune, iFlag + 1))) ab.push('punerea picată nu iese cu 29')
  // nicio schimbare de setări / date înaintea barierei
  const primaSchimbare = Math.min(...['$(kill_switch ', '$(comutator_redari ', '\nqf "$TMP/s0.sql"', '\nCURATA=1\n'].map(s => jm(s)).filter(i => i >= 0))
  if (!(iFlag < primaSchimbare)) ab.push('o schimbare (kill-switch / comutator / S0 / armarea curățeniei) înaintea barierei')
  // verificarea: în izolare_verifica, bariera ÎNAINTEA gărzii 28, ieșire 29
  const iv = text.slice(idx('izolare_verifica() {'), idx('\nbariera_manual() {'))
  const ivB = iv.indexOf('b="$(q "$(sql_bariera_verifica)")" || b="verificarea_barierei_a_picat"'), ivI = iv.indexOf('v="$(q "$(sql_izolare)")"')
  if (!(ivB > 0 && ivB < ivI && /ESEC=1; exit 29/.test(iv.slice(ivB, ivI)))) ab.push('izolare_verifica: bariera verificată înaintea gărzii 28, cu ieșire 29')
  // trap: cu CURATA != 1, scoate bariera DOAR dacă e a acestei rulări; cu CURATA = 1 n-o scoate separat (doar curățenia, după setări)
  const tr = text.slice(idx('\ncuratenie() {'), idx('\ntrap curatenie EXIT'))
  const trNe = tr.slice(tr.indexOf('if [ "$CURATA" != 1 ]; then'), tr.indexOf('\n  q "SELECT count(pg_terminate_backend'))
  if (!/if \[ "\$BARIERA" = 1 \]; then\n\s+if sql_bariera_scoate /.test(trNe)) ab.push('trap-ul nu scoate bariera rulării când proba s-a oprit înaintea schimbărilor')
  if (cMain < 0 || (main.match(/sql_bariera_scoate/g) || []).length !== 1) ab.push('sql_bariera_scoate apare și în afara ramurii CURATA != 1 (o fereastră fără barieră)')
  // curățenia: scoaterea după readucerea setărilor, înaintea verificării și a COMMIT-ului, în aceeași tranzacție
  const cSet = cur.indexOf("EXECUTE format('UPDATE public.sms_setari"), cDrop = cur.indexOf('\n$(sql_bariera_drop)\n'), cVer = cur.indexOf('-- (4) verificarea'), cCom = cur.lastIndexOf('\nCOMMIT;')
  const cBeg = cur.indexOf('\nBEGIN;\n')
  if (!(cBeg > 0 && cSet > cBeg && cSet < cDrop && cDrop < cVer && cVer < cCom) || (cur.match(/\nCOMMIT;/g) || []).length !== 1 || (cur.match(/\nBEGIN;/g) || []).length !== 1)
    ab.push('curățenia: o singură tranzacție; bariera scoasă după setări, înaintea verificării și a COMMIT-ului')
  if (!cur.includes("RAISE EXCEPTION 'curatenie: bariera de trimitere a ramas'")) ab.push('curățenia nu verifică scoaterea barierei')
  return ab
}

// ── F. bariera (29) pe lanțul SMS REAL: 20261130a + 20261130b întregi (fn_sms_rezerva, fn_sms_rezultat, fn_sms_lot_*, triggerele reale ale
// mesajelor / loturilor), pe scheletele lor (roluri Supabase, profiles, user_module_access, employees fictivi 0700…, red_* minime) ──
// Limită: 20261130c (șablonul) cere schema Redări completă; bariera e un trigger de RÂND pe sms_mesaje, deci ce contează e UPDATE-ul rezervării
// (in_coada -> necunoscut + furnizor [+ rezervat_la în 30c]), identic în 30b și 30c. Rezervarea unui lot Redări prin fn_sms_rezerva depinde
// de ora României (08–19 în 30b): acolo testul verifică ramura orei curente; aceeași rezervare a RÂNDULUI se probează mereu direct (UPDATE-ul
// lui fn_sms_rezerva, ca o conexiune privilegiată), iar fn_sms_rezerva mereu pe un lot INTERN (fără oră).
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const OWNER_R = '00000000-0000-0000-0000-0000000000a1', UTIL_R = '00000000-0000-0000-0000-0000000000a2'
const DR1 = id(301), DR2 = id(302)
let BAZA_REALA = null   // imaginea bazei (dumpDataDir), construită o dată
async function bazaReala() {
  if (!BAZA_REALA) {
    const db = new PGlite()
    const run = (n, t) => db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED; SELECT set_config('gazpet.livrare_migrare', '${n}:' || txid_current(), true);\n${t}\nCOMMIT;`)
    await db.exec(citeste('supabase/tests/20261130a_sms_mvp_schelet.sql'))
    await run('20261130a_sms_mvp', citeste('supabase/migrations/20261130a_sms_mvp.sql'))
    await db.exec(citeste('supabase/tests/20261130b_sms_acces_modul_schelet.sql'))
    await run('20261130b_sms_acces_modul', citeste('supabase/migrations/20261130b_sms_acces_modul.sql'))
    await db.exec(`INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${UTIL_R}', 'sms', 'editor');
      INSERT INTO public.red_proiecte (id, cod, denumire) VALUES ('${PR}', 'TEST-SMSP-SINT', 'Proba SMS predare (sintetic) ${MARCAJ}');
      INSERT INTO public.red_uat (id, proiect_id, nume, uat3) VALUES ('${UAT_N}', '${PR}', 'Sinteticeni', 'ZSA');
      INSERT INTO public.red_parcele (id, proiect_id, uat_id, id_parcela) VALUES ('${PA_N}', '${PR}', '${UAT_N}', 'ZSA-0001');
      INSERT INTO public.red_detinatori (id, parcela_id, nume, nume_normalizat, calitate) VALUES
        ('${DR1}', '${PA_N}', 'Persoana Sintetica Unu', 'PERSOANA SINTETICA UNU', 'proprietar'), ('${DR2}', '${PA_N}', 'Persoana Sintetica Doi', 'PERSOANA SINTETICA DOI', 'proprietar');
      INSERT INTO public.red_detinatori_contact (detinator_id, telefon) VALUES ('${DR1}', '0700000901'), ('${DR2}', '0700000902');
      INSERT INTO public.red_convocari (detinator_id, canal) VALUES ('${DR1}', 'telefon'), ('${DR2}', 'telefon');
      CREATE SCHEMA fals; CREATE TABLE fals.pg_stat_activity (pid int, usename name, application_name text, backend_type text);
      CREATE TABLE fals.pg_extension (extname name);`)
    // starea probei între F1 și F6, pe căile reale (owner): Redări autorizat, kill-switch oprit = trimiterea PORNITĂ
    const v1 = await unRand(db, 'SELECT versiune FROM public.sms_setari')
    await caR(db, OWNER_R, `SELECT public.fn_sms_redari_autorizare_seteaza(true, 'PROBA-CLONA-SMSP', (now() AT TIME ZONE 'Europe/Bucharest')::date, ${v1})`)
    const v2 = await unRand(db, 'SELECT versiune FROM public.sms_setari')
    await caR(db, OWNER_R, `SELECT public.fn_sms_setari_salveaza(false, 200, 1500, ${v2})`)
    // lotul probei (Redări, proiectul TEST-SMSP-SINT, 2 mesaje sintetice), creat și aprobat de owner, apoi în trimitere (ca după F4b)
    const lot = (await caR(db, OWNER_R, `SELECT public.fn_sms_lot_redari_creeaza('Proba sintetica predare teren', '${PR}', '${UAT_N}', false) ->> 'lot_id' AS x`))[0].x
    await caR(db, OWNER_R, `SELECT public.fn_sms_lot_aproba('${lot}', (SELECT versiune FROM public.sms_loturi WHERE id = '${lot}'))`)
    await db.exec(`ALTER TABLE public.sms_loturi DISABLE TRIGGER trg_sms_loturi_reguli; UPDATE public.sms_loturi SET stare = 'in_trimitere' WHERE id = '${lot}';
      ALTER TABLE public.sms_loturi ENABLE TRIGGER trg_sms_loturi_reguli;`)
    BAZA_REALA = await db.dumpDataDir('none')
    await db.close()
  }
  const db = new PGlite({ loadDataDir: BAZA_REALA })
  const lot = await unRand(db, `SELECT id::text FROM public.sms_loturi WHERE proiect_id = '${PR}'`)
  const msg = (await db.query(`SELECT id::text AS id FROM public.sms_mesaje WHERE lot_id = '${lot}' ORDER BY telefon`)).rows.map(r => r.id)
  return { db, lot, msg }
}
// apel ca PostgREST / edge (ca în test_sms_numere_serviciu_local.mjs): tranzacție, JWT în ambele surse, SET LOCAL ROLE
async function caR(db, cine, q) {
  const rol = cine === 'anon' || cine === 'service_role' ? cine : 'authenticated'
  const uid = rol === 'authenticated' ? cine : ''
  await db.exec('BEGIN')
  try {
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`, [uid, JSON.stringify({ sub: uid || null, role: rol })])
    await db.exec(`SET LOCAL ROLE ${rol}`)
    const r = await db.query(q)
    await db.exec('COMMIT')
    return r.rows
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* */ } throw e }
}
// lotul STRĂIN: intern (angajații fictivi, numere „reale” ca format), creat și aprobat de un utilizator SMS ÎN TIMPUL probei
async function lotStrain(db) {
  const l = (await caR(db, UTIL_R, `SELECT public.fn_sms_lot_intern_creeaza(p_text => 'Mesaj intern', p_angajati => ARRAY[1, 2], p_doar_preview => false) ->> 'lot_id' AS x`))[0].x
  const v = await unRand(db, `SELECT versiune FROM public.sms_loturi WHERE id = '${l}'`)   // citită ca postgres (RLS-ul ascunde rândul de utilizator)
  await caR(db, UTIL_R, `SELECT public.fn_sms_lot_aproba('${l}', ${v})`)
  return l
}
const rezervaR = (db, lot, furnizor, apelant) => caR(db, 'service_role',
  `SELECT public.fn_sms_rezerva(${lot ? `'${lot}'` : 'NULL'}, 5, '${furnizor}', ${apelant ? `'${apelant}'` : 'NULL'}) AS r`).then(x => x[0].r)
// UPDATE-ul rezervării din fn_sms_rezerva (30b), pe un rând anume, ca o conexiune privilegiată (postgres)
const rezervaRand = (db, m, furnizor) => db.query(`UPDATE public.sms_mesaje SET stare = 'necunoscut', furnizor = '${furnizor}' WHERE id = '${m}'`)
const deBariera = e => e && e.code === '42501' && /^smsp_bariera: /.test(e.message)
const inOre = async db => (await unRand(db, `SELECT extract(hour FROM now() AT TIME ZONE 'Europe/Bucharest')::int BETWEEN 8 AND 19`)) === true
const plecate = async db => (await db.query(`SELECT m.telefon, m.stare, m.furnizor FROM public.sms_mesaje m WHERE m.stare <> 'in_coada' AND m.stare <> 'anulat' ORDER BY m.telefon`)).rows

// F1. scenariul din review (Jakarinos r2), pe calea reală: garda 28 trece; după aprobarea lotului probei un worker se conectează, rezervă cu
//     furnizorul lui REAL, se deconectează înaintea verificării următoare. Cu bariera: fiecare rezervare a lui e refuzată (nimic de trimis),
//     iar garda 28 e goală înainte și după (deci ea singură nu dovedea nimic). cuBariera = false = starea r2 (proba fără barieră).
async function scenariuReview(sql, cuBariera = true) {
  const ab = [], jurnal = []
  const { db, lot, msg } = await bazaReala()
  const [CHEIE, SHA] = sql.cheie()
  if (cuBariera) { const e = await ruleaza(db, sql('sql_bariera_pune', { CHEIE_SHA: SHA })); if (e) ab.push('bariera nu s-a pus: ' + e.slice(0, 120)) }
  await db.exec(`SET smsp.cheie = '${CHEIE}'; SET search_path = fals, pg_catalog, public`)
  const T0 = await unRand(db, `SELECT (now() - interval '1 second')::text`)
  const g0 = await unRand(db, sql('sql_izolare', { T0 }))
  if (g0 !== '') ab.push(`garda 28 la pornire: [${g0}] (aștepta gol)`)
  // workerul: altă sesiune, FĂRĂ cheia rulării
  await db.exec(`INSERT INTO fals.pg_stat_activity VALUES (4242, 'authenticator', 'postgrest', 'client backend'); RESET smsp.cheie`)
  const gW = await unRand(db, sql('sql_izolare', { T0 }))
  if (!(gW || '').startsWith('sesiuni_straine=1')) ab.push(`garda 28 cât workerul e conectat: [${gW}] (aștepta sesiuni_straine=1)`)
  for (const m of msg) {
    const e = await eroare(rezervaRand(db, m, 'smslink'))
    jurnal.push(`rândul ${m.slice(-3)}: ${e ? e.message.slice(0, 60) : 'REZERVAT (smslink)'}`)
    if (cuBariera && !deBariera(e)) ab.push(`worker: rezervarea rândului ${m.slice(-3)} nu e refuzată de barieră (${e ? e.code + ' ' + e.message.slice(0, 80) : 'a trecut'})`)
  }
  const ore = await inOre(db)
  for (const [ce, lotW, apel] of [['butonul „Trimite” (apelant owner)', lot, OWNER_R], ['cronul (fără lot)', null, null]]) {
    const e = await eroare(rezervaR(db, lotW, 'smslink', apel))
    if (!cuBariera) continue
    if (ore && !deBariera(e)) ab.push(`worker prin fn_sms_rezerva, ${ce}: nu e refuzat de barieră (${e ? e.message.slice(0, 80) : 'a trecut'})`)
    if (!ore && e) ab.push(`worker prin fn_sms_rezerva în afara orelor, ${ce}: eroare neașteptată ${e.message.slice(0, 80)}`)
  }
  // se deconectează; proba își reia sesiunea (cu cheia)
  await db.exec(`DELETE FROM fals.pg_stat_activity; SET smsp.cheie = '${CHEIE}'`)
  const g1 = await unRand(db, sql('sql_izolare', { T0 }))
  if (g1 !== '') ab.push(`garda 28 după deconectare: [${g1}] (aștepta gol: lotul probei e exclus, deci instantaneul nu vede nimic)`)
  const p = await plecate(db)
  if (p.length) ab.push(`mesaje scoase din coadă de worker (ar fi plecat prin furnizorul lui): ${p.map(x => x.telefon + ':' + x.furnizor).join(' ')}`)
  await db.close()
  return { ab, jurnal, g0, gW, g1, ore }
}

// F2. ce mai poate încerca o componentă străină + căile legitime (L20), cu bariera pusă
async function barieraCazuri(sql) {
  const ab = []
  const { db, lot, msg } = await bazaReala()
  const [CHEIE, SHA] = sql.cheie()
  const eB = await ruleaza(db, sql('sql_bariera_pune', { CHEIE_SHA: SHA }))
  if (eB) { ab.push('bariera nu s-a pus: ' + eB.slice(0, 120)); await db.close(); return ab }
  const strain = await lotStrain(db)
  const refuz = async (ce, p) => { const e = await eroare(p); if (!deBariera(e)) ab.push(`${ce}: nu e refuzat de barieră (${e ? e.code + ' ' + e.message.slice(0, 90) : 'a trecut'})`) }
  await db.exec('RESET smsp.cheie')
  await refuz('worker fără cheie, lotul intern străin, butonul (apelant utilizator)', rezervaR(db, strain, 'smslink', UTIL_R))
  await refuz('worker fără cheie, cronul (fără lot: alege cel mai vechi lot aprobat)', rezervaR(db, null, 'smslink', null))
  await db.exec(`SET smsp.cheie = '${'0'.repeat(32)}'`)
  await refuz('o cheie GREȘITĂ, lotul străin', rezervaR(db, strain, 'smslink', UTIL_R))
  await refuz('o cheie GREȘITĂ, rândul lotului probei', rezervaRand(db, msg[0], 'smslink'))
  await db.exec(`SET smsp.cheie = '${CHEIE}'`)
  await refuz('CHIAR proba (cheia corectă) pe un lot STRĂIN', rezervaR(db, strain, 'simulator', UTIL_R))
  await db.exec(`RESET smsp.cheie; SET session_replication_role = replica`)
  await refuz('fără cheie, cu session_replication_role = replica (triggerele obișnuite nu trag)', rezervaR(db, strain, 'smslink', UTIL_R))
  await refuz('fără cheie, replica, rândul lotului probei', rezervaRand(db, msg[0], 'smslink'))
  await db.exec('RESET session_replication_role')
  // nimic plecat din lotul străin / al probei
  const p = await plecate(db)
  if (p.length) ab.push('mesaje scoase din coadă: ' + p.map(x => x.telefon + ':' + x.stare).join(' '))
  // căile legitime, fără cheie: anularea lotului străin (in_coada -> anulat) trece
  const an = await eroare(caR(db, UTIL_R, `SELECT public.fn_sms_lot_anuleaza('${strain}', 'proba: anulare legitima') ->> 'stare' AS s`))
  if (an) ab.push('anularea legitimă (fără cheie) e refuzată: ' + an.message.slice(0, 100))
  const st = await unRand(db, `SELECT string_agg(stare, ',' ORDER BY telefon) FROM public.sms_mesaje WHERE lot_id = '${strain}'`)
  if (st !== 'anulat,anulat') ab.push(`mesajele lotului străin după anulare: [${st}] (aștepta anulat,anulat)`)
  // proba (cu cheia) pe lotul ei: rezervarea rândului + rezultatul trec; fn_sms_rezerva în orele Redări
  await db.exec(`SET smsp.cheie = '${CHEIE}'`)
  const eP = await eroare(rezervaRand(db, msg[0], 'simulator'))
  if (eP) ab.push('proba nu-și poate rezerva rândul: ' + eP.message.slice(0, 100))
  const rz = await eroare(caR(db, 'service_role', `SELECT public.fn_sms_rezultat('${msg[0]}', true, 'SIM-PROBA-1', NULL, NULL) AS r`))
  if (rz) ab.push('proba nu-și poate scrie rezultatul: ' + rz.message.slice(0, 100))
  const ore = await inOre(db)
  const rp = await eroare(rezervaR(db, lot, 'simulator', OWNER_R).then(x => {
    const ast = ore ? 'ok' : 'in_afara_orelor'
    if (x.motiv !== ast || x.mesaje.length !== (ore ? 1 : 0)) throw new Error(`motiv ${x.motiv}, ${x.mesaje.length} mesaje (aștepta ${ast})`)
  }))
  if (rp) ab.push(`proba (cheia, lotul ei) prin fn_sms_rezerva, ${ore ? 'în' : 'în afara'} orelor Redări: ${rp.message.slice(0, 100)}`)
  await db.close()
  return ab
}

// F3. bariera NU schimbă nimic pentru probă: aceeași secvență (rezervare, rezultat trimis, rezervare, rezultat necunoscut, anulare) pe
//     o bază cu barieră (sesiunea cu cheia) și pe una fără = aceleași rânduri (fără id-uri / momente)
async function treceIdentic(sql) {
  const stare = async cuBariera => {
    const { db, lot, msg } = await bazaReala()
    const [CHEIE, SHA] = sql.cheie()
    if (cuBariera) await ruleaza(db, sql('sql_bariera_pune', { CHEIE_SHA: SHA }))
    await db.exec(`SET smsp.cheie = '${CHEIE}'`)
    const pas = []
    for (const [m, ok] of [[msg[0], true], [msg[1], false]]) {
      pas.push(await eroare(rezervaRand(db, m, 'simulator')).then(e => e ? 'ERR ' + e.code : 'ok'))
      pas.push(await eroare(caR(db, 'service_role', ok ? `SELECT public.fn_sms_rezultat('${m}', true, 'SIM-${m.slice(-3)}', NULL, NULL) AS r`
        : `SELECT public.fn_sms_rezultat('${m}', false, NULL, 'timeout_proba', 'necunoscut') AS r`)).then(e => e ? 'ERR ' + e.code : 'ok'))
    }
    pas.push(await eroare(caR(db, OWNER_R, `SELECT public.fn_sms_lot_anuleaza('${lot}', 'proba') AS r`)).then(e => e ? 'ERR ' + e.code : 'ok'))
    const r = (await db.query(`SELECT telefon, stare, furnizor, furnizor_id, cod_eroare, rezervat_la IS NOT NULL AS rez, trimis_la IS NOT NULL AS trim, versiune
                                 FROM public.sms_mesaje ORDER BY telefon`)).rows
    const l = (await db.query(`SELECT stare, versiune FROM public.sms_loturi ORDER BY creat_la`)).rows
    await db.close()
    return JSON.stringify({ pas, r, l })
  }
  const a = await stare(true), b = await stare(false)
  return a === b ? [] : [`cu barieră ≠ fără barieră: ${a.slice(0, 160)} | ${b.slice(0, 160)}`]
}

// F4. verificarea „bariera în vigoare” (sql_bariera_verifica) și punerea / scoaterea ei
async function barieraVerificare(sql) {
  const ab = []
  const { db } = await bazaReala()
  const [, SHA] = sql.cheie()
  const verif = async (BAR_MD5, ce, astept) => {
    let r, e
    try { r = await ultimul(db, sql('sql_bariera_verifica', { BAR_MD5 })) } catch (x) { e = x }
    try { await db.exec('ROLLBACK') } catch { /* fără tranzacție */ }
    const obt = e ? 'ERR ' + e.message.slice(0, 60) : r
    if (astept instanceof RegExp ? !astept.test(obt || '') : obt !== astept) ab.push(`${ce}: [${obt}] (aștepta ${astept})`)
  }
  await verif('0'.repeat(32), 'fără barieră', /^ERR smsp_proba_bariera: /)
  const eB = await ruleaza(db, sql('sql_bariera_pune', { CHEIE_SHA: SHA }))
  if (eB) { ab.push('bariera nu s-a pus: ' + eB.slice(0, 120)); await db.close(); return ab }
  const MD5 = await unRand(db, sql('sql_bariera_amprenta'))
  await db.exec(`SET smsp.cheie = 'cheia-sesiunii-de-control'`)   // sesiunea probei are cheia; verificarea o golește local
  await verif(MD5, 'bariera pusă', '')
  const caz = async (ce, alterare, astept, md5 = MD5) => { await db.exec('BEGIN; ' + alterare); await verif(md5, ce, astept) }
  await caz('triggerul ENABLE (origin), nu ALWAYS', 'ALTER TABLE public.sms_mesaje ENABLE TRIGGER smsp_bariera;', 'trigger_lipsa_sau_schimbat')
  await caz('triggerul dezactivat', 'ALTER TABLE public.sms_mesaje DISABLE TRIGGER smsp_bariera;', /^ERR smsp_proba_bariera: /)
  await caz('triggerul scos', 'DROP TRIGGER smsp_bariera ON public.sms_mesaje;', /^ERR smsp_proba_bariera: /)
  await caz('funcția înlocuită cu una care lasă tot', `CREATE OR REPLACE FUNCTION smsp_bariera.fn_refuza_rezervarea() RETURNS trigger LANGUAGE plpgsql AS $x$ BEGIN RETURN NEW; END $x$;`, /^ERR smsp_proba_bariera: /)
  await caz('o regulă DO INSTEAD NOTHING (triggerul nu mai trage)', 'CREATE RULE smsp_r AS ON UPDATE TO public.sms_mesaje DO INSTEAD NOTHING;', /^ERR smsp_proba_bariera: /)
  await caz('triggerul cu WHEN (condiție)', `DROP TRIGGER smsp_bariera ON public.sms_mesaje; CREATE TRIGGER smsp_bariera BEFORE UPDATE ON public.sms_mesaje FOR EACH ROW WHEN (false) EXECUTE FUNCTION smsp_bariera.fn_refuza_rezervarea(); ALTER TABLE public.sms_mesaje ENABLE ALWAYS TRIGGER smsp_bariera;`, /^ERR smsp_proba_bariera: /)
  await verif('f'.repeat(32), 'amprenta funcției diferită de cea de la punere', 'functia_barierei_schimbata')
  await verif(MD5, 'după alterările anulate: din nou în vigoare', '')
  // o barieră rămasă (altă rulare) = punerea pică
  const e2 = await ruleaza(db, sql('sql_bariera_pune', { CHEIE_SHA: SHA }))
  if (!e2 || !/already exists|exist/.test(e2)) ab.push(`a doua punere (barieră rămasă) nu e refuzată: ${e2}`)
  // scoaterea
  const eS = await ruleaza(db, sql('sql_bariera_scoate'))
  if (eS) ab.push('scoaterea barierei a picat: ' + eS.slice(0, 100))
  if (await unRand(db, sql('sql_bariera_absenta')) !== 'true') ab.push('bariera nu e absentă după scoatere')
  await verif(MD5, 'după scoatere', /^ERR smsp_proba_bariera: /)
  await db.close()
  return ab
}

// F5. cheia: generată de script (cheie_noua), sha256-ul din bash = cel din Node = cel calculat de bază pe cheia din sesiune; două chei diferă
async function cheia(sql) {
  const ab = []
  const [c1, s1] = sql.cheie(), [c2] = sql.cheie()
  if (!/^[0-9a-f]{32}$/.test(c1) || !/^[0-9a-f]{64}$/.test(s1)) ab.push(`cheia / sha-ul nu au forma cerută: ${c1} ${s1}`)
  if (createHash('sha256').update(c1, 'utf8').digest('hex') !== s1) ab.push('sha256 din bash ≠ sha256 din Node')
  if (c1 === c2) ab.push('două chei consecutive sunt egale')
  const db = new PGlite()
  await db.exec(`SET smsp.cheie = '${c1}'`)
  if (await unRand(db, sql('sql_cheie_sesiune')) !== s1) ab.push('sha256 calculat de bază pe cheia din sesiune ≠ CHEIE_SHA')
  await db.exec('RESET smsp.cheie')
  if (await unRand(db, sql('sql_cheie_sesiune')) === s1) ab.push('o sesiune fără cheie dă același sha')
  await db.close()
  return ab
}

async function totul(text, grupuri = 'ABCDEFG') {
  const sql = varianta(text), ab = []
  if (grupuri.includes('A')) ab.push(...await garda25(sql))
  if (grupuri.includes('B')) ab.push(...await curatenieB(sql))
  if (grupuri.includes('C')) ab.push(...await curatenieC(sql))
  if (grupuri.includes('D')) ab.push(...await garda28(sql))
  if (grupuri.includes('E')) ab.push(...ordine(text))
  if (grupuri.includes('F')) {
    ab.push(...(await scenariuReview(sql)).ab, ...await barieraCazuri(sql), ...await treceIdentic(sql), ...await barieraVerificare(sql), ...await cheia(sql))
  }
  if (grupuri.includes('G')) ab.push(...await curatenieG(sql))
  return ab
}

// secțiunile de rulat (argumentul 1, doar pentru depanare; implicit TOATE, inclusiv mutanții M) — dovada se face cu rularea completă
const SECT = process.argv[2] || '0ABCDEFGM', S = x => SECT.includes(x)
if (SECT !== '0ABCDEFGM') console.log(`ATENȚIE: rulare PARȚIALĂ (${SECT}), nu e dovada completă`)
if (S('0')) console.log('0. sintaxa bash + modul bibliotecă (nicio conexiune)')
if (S('0')) {
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
if (S('A')) console.log('A. garda 25 (identificatorii probei pe orice coloană-cheie)')
if (S('A')) { const ab = await garda25(varianta(SCRIPT)); ab.forEach(a => console.log('     ' + a)); ok(ab.length === 0, `baza curată trece, ${INTRUSI.length} intruși refuzați (${ab.length} abateri)`) }
if (S('B')) console.log('B. curățenia când rularea n-a creat nimic (S0 picat), cu rânduri străine purtând id-uri ale probei')
if (S('B')) { const ab = await curatenieB(varianta(SCRIPT)); ab.forEach(a => console.log('     ' + a)); ok(ab.length === 0, `nimic preexistent atins, nici resturile altei rulări (${ab.length} abateri)`) }
if (S('C')) console.log('C. curățenia după o rulare completă (lanțul rulării + scrieri străine în timpul probei)')
if (S('C')) { const ab = await curatenieC(varianta(SCRIPT)); ab.forEach(a => console.log('     ' + a)); ok(ab.length === 0, `șterge exact lanțul rulării, setările puse la loc, garda 25 trece din nou (${ab.length} abateri)`) }
if (S('D')) console.log('D. garda 28 (izolarea SMS)')
if (S('D')) { const ab = await garda28(varianta(SCRIPT)); ab.forEach(a => console.log('     ' + a)); ok(ab.length === 0, `${IZOLARE.length} cazuri (${ab.length} abateri)`) }
if (S('E')) console.log('E. ordinea în script')
if (S('E')) { const ab = ordine(SCRIPT); ab.forEach(a => console.log('     ' + a)); ok(ab.length === 0, `garda 28 înaintea fiecărei porniri și la final, curățenia armată după gărzi, F4c; bariera: cheia înaintea primei conexiuni, pusă înaintea oricărei schimbări, verificată la fiecare poartă, scoasă doar după setări (${ab.length} abateri)`) }
if (S('F')) console.log('F. bariera de trimitere (29) pe lanțul SMS REAL (20261130a + 20261130b)')
if (S('F')) {
  const sql = varianta(SCRIPT)
  // F1: scenariul din review, întâi FĂRĂ barieră (starea r2): defectul se reproduce; apoi cu bariera: închis
  const r2 = await scenariuReview(sql, false)
  r2.jurnal.forEach(j => console.log('     r2 (fără barieră) worker: ' + j))
  ok(r2.g0 === '' && r2.gW.startsWith('sesiuni_straine=1') && r2.g1 === '' && r2.ab.some(a => a.startsWith('mesaje scoase din coadă de worker')),
    'F1 REPRODUCEREA defectului r2: garda 28 goală înainte, refuz doar cât workerul e conectat, goală după; între timp workerul a rezervat mesajele probei cu furnizorul lui')
  const r3 = await scenariuReview(sql, true)
  r3.jurnal.forEach(j => console.log('     r3 (cu barieră) worker: ' + j))
  r3.ab.forEach(a => console.log('     ' + a))
  ok(r3.ab.length === 0, `F1 același scenariu cu bariera: fiecare rezervare a workerului refuzată de ea (42501 smsp_bariera), nimic scos din coadă; fn_sms_rezerva pe lotul Redări ${r3.ore ? 'în orele Redări: refuzat de barieră' : 'în afara orelor Redări: in_afara_orelor (ramura orei verificată la rularea din ore)'} (${r3.ab.length} abateri)`)
  for (const [n, f] of [['F2 componentele străine (lot intern, cron, cheie greșită, proba pe lot străin, replica) refuzate; anularea și calea probei trec', barieraCazuri],
    ['F3 aceeași secvență a probei cu și fără barieră = aceleași rânduri', treceIdentic],
    ['F4 verificarea „în vigoare” (proba funcțională + triggerul exact + amprenta), barieră rămasă refuzată, scoaterea', barieraVerificare],
    ['F5 cheia: bash = Node = baza, două chei diferite', cheia]]) {
    const ab = await f(sql); ab.forEach(a => console.log('     ' + a)); ok(ab.length === 0, `${n} (${ab.length} abateri)`)
  }
}
if (S('G')) console.log('G. curățenia PICATĂ lasă bariera (fail-closed)')
if (S('G')) { const ab = await curatenieG(varianta(SCRIPT)); ab.forEach(a => console.log('     ' + a)); ok(ab.length === 0, `ROLLBACK: nimic șters, bariera rămasă și în vigoare (${ab.length} abateri)`) }

if (S('M')) console.log('M. MUTANȚI (fiecare TREBUIE să pice cel puțin o verificare)')
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
].map(m => [...m, 'ABCDE'])
// r3: mutanții barierei (29); grupurile rulate: F = lanțul real, G = curățenia picată, B / C = curățenia, E = ordinea
const COND_CHEIE = "    IF encode(sha256(convert_to(coalesce(current_setting('smsp.cheie', true), ''), 'UTF8')), 'hex') IS DISTINCT FROM '$CHEIE_SHA'\n       OR NOT EXISTS"
const COND_LOT = "\n       OR NOT EXISTS (SELECT 1 FROM public.sms_loturi l WHERE l.id = NEW.lot_id AND l.proiect_id = '$PR'::uuid) THEN"
MUTANTI.push(
  ['bariera fără cheie (refuză doar loturile străine)', [[COND_CHEIE, '    IF NOT EXISTS']], 'F'],
  ['bariera fără restricția pe loturile probei', [[COND_LOT, ' THEN']], 'F'],
  ['bariera fără ENABLE ALWAYS (replica o ocolește)', [['ALTER TABLE public.sms_mesaje ENABLE ALWAYS TRIGGER smsp_bariera;\n', '']], 'F'],
  ['bariera refuză și anularea (calea legitimă, L20)', [["AND NEW.stare IS DISTINCT FROM 'anulat')", ')']], 'F'],
  ['bariera doar pe momente (fără starea și furnizorul: UPDATE-ul din 30b nu le atinge)', [['     OR NEW.furnizor IS DISTINCT FROM OLD.furnizor OR NEW.furnizor_id IS DISTINCT FROM OLD.furnizor_id\n', ''],
    ["  IF (OLD.stare = 'in_coada' AND NEW.stare IS DISTINCT FROM 'in_coada' AND NEW.stare IS DISTINCT FROM 'anulat')\n", "  IF false\n"]], 'F'],
  ['verificarea fără proba funcțională', [['  IF NOT v_refuz THEN RAISE EXCEPTION', '  IF false THEN RAISE EXCEPTION']], 'F'],
  ['verificarea fără triggerul exact (ALWAYS / tip)', [["AND t.tgenabled = 'A'\n                           AND t.tgtype = 19 AND", 'AND']], 'F'],
  ['verificarea fără amprenta funcției', [["       THEN 'functia_barierei_schimbata' END)", "       AND false THEN 'functia_barierei_schimbata' END)"]], 'F'],
  ['cheia din bash fără sha256 (sha-ul altui text)', [['CHEIE_SHA="$(printf \'%s\' "$CHEIE" | sha256sum', 'CHEIE_SHA="$(printf \'%s\\n\' "$CHEIE" | sha256sum']], 'F'],
  ['curățenia fără scoaterea barierei', [['\n$(sql_bariera_drop)\n', '\n']], 'CE'],
  ['curățenia nu verifică scoaterea barierei', [["    RAISE EXCEPTION 'curatenie: bariera de trimitere a ramas';", '    NULL;']], 'E'],
  ['curățenia picată scoate totuși bariera (în afara tranzacției)', [['  elif sql_curatenie >"$TMP/curata.sql"', '  elif sql_bariera_scoate >"$TMP/bs.sql" && qf "$TMP/bs.sql" && sql_curatenie >"$TMP/curata.sql"']], 'E'],
  ['trap-ul nu scoate bariera când proba s-a oprit înaintea schimbărilor', [['    if [ "$BARIERA" = 1 ]; then\n      if sql_bariera_scoate', '    if false; then\n      if sql_bariera_scoate']], 'E'],
  ['BARIERA=1 lipsă (trap-ul n-ar ști că e a rulării)', [['\nBARIERA=1\n', '\n']], 'E'],
  ['bariera pusă DUPĂ garda 28 de la pornire', [['\nizolare_verifica "la pornire"\n', '\n'], ['\n[ "$(q "$(sql_cheie_sesiune)")" = "$CHEIE_SHA" ]', '\nizolare_verifica "la pornire"\n[ "$(q "$(sql_cheie_sesiune)")" = "$CHEIE_SHA" ]']], 'E'],
  ['izolare_verifica nu mai verifică bariera', [['  b="$(q "$(sql_bariera_verifica)")" || b="verificarea_barierei_a_picat"\n', '  b=""\n']], 'E'],
  ['cheia neexportată (sesiunile probei fără ea)', [['\nexport PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c smsp.cheie=$CHEIE"\n', '\nPGOPTIONS_X="-c smsp.cheie=$CHEIE"\n']], 'E'],
  ['fără verificarea cheii în sesiune (pooler)', [['[ "$(q "$(sql_cheie_sesiune)")" = "$CHEIE_SHA" ]', '[ "$CHEIE_SHA" = "$CHEIE_SHA" ]']], 'E'],
  ['curățenia picată: bariera scoasă în tranzacție separată, înaintea ștergerilor', [['\n$(sql_bariera_drop)\n', '\n'], ["\\\\set ON_ERROR_STOP 1\nBEGIN;\n-- (1) ce a creat rularea", "\\\\set ON_ERROR_STOP 1\nBEGIN;\n$(sql_bariera_drop)\nCOMMIT;\nBEGIN;\n-- (1) ce a creat rularea"]], 'GE'],
)
// argumentul 2 (depanare): r2 = doar mutanții r2, r3 = doar ai barierei; implicit toți
const DOAR = process.argv[3] || ''
for (const [nume, lista, grupuri] of (S('M') ? MUTANTI : []).filter(m => !DOAR || (DOAR === 'r2') === (m[2] === 'ABCDE'))) {
  let t
  try { t = aplica(SCRIPT, lista) } catch (e) { ok(false, `MUTANT ${nume}: nu se aplică (${e.message})`); continue }
  const ab = await totul(t, grupuri)
  ok(ab.length > 0, `MUTANT ${nume} [${grupuri}] — prins: ${(ab[0] || '').slice(0, 150)}`)
}

console.log(esec ? `\nESEC: ${esec} verificări au picat` : '\nPASS: toate verificările au trecut')
process.exit(esec ? 1 : 0)
