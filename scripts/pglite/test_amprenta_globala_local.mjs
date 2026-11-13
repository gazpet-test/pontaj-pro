// L15 v2 (docs/LIVRARE_L15_V2.md): proba LOCALA a blocului AMPRENTA_GLOBALA v1 si a pasilor runnerului „inainte” / „dupa”
// pe PGlite (Postgres in WASM, in memorie) — NU atinge nicio baza reala.
// Textul SQL vine EXCLUSIV din fisierele livrate (L19): blocurile din scripts/amprenta_globala_v1.sql si pasii generati de
// scripts/livrare_amprenta.sh (prin scripts/livrare_amprenta_gen.sh) + sectiunile citirii generate de
// scripts/amprenta_globala_citire.sh --doar-genereaza. Testul doar le ruleaza.
// Ce dovedeste (expected scris aici, din cerere / catalogul PostgreSQL, nu din codul testat — L25):
//   1. garda: blocul in afara contextului canonic = eroare AG_V1_CONTEXT_NECANONIC;
//   2. paritate: GLOBAL din citirea coordonatorului = GLOBAL calculat de pasul runnerului (acelasi set);
//   3. independenta de sesiune: alt search_path / TimeZone / DateStyle / IntervalStyle / extra_float_digits /
//      quote_all_identifiers in afara => aceleasi md5 pe familiile de catalog (doar familia „sesiune” se schimba);
//   4. etichete unice; obiectele temporare, datele, nextval, ANALYZE NU schimba nimic;
//   5. pentru FIECARE familie: o schimbare minima schimba GLOBAL si md5-ul familiei ei; MUTANT (familia scoasa din bloc):
//      md5-ul familiei nu se mai schimba => testul familiei pica (si, unde schimbarea atinge doar familia ei, GLOBAL ramane
//      neschimbat: nimic altceva n-ar fi prins-o);
//   6. contraexemplul din #1084 r3: poarta citeste o VEDERE care cheama un auxiliar; auxiliarul schimbat dupa baseline
//      => pasul „inainte” refuza (familia functie);
//   7. manifestul: lista de obiecte (eticheta + operatie) a unei migrari mici scrisa DE MANA (inclusiv obiectele implicite:
//      tipul rand + tabloul, secventa identity, indexul PK, constrangerile, triggerele interne ale FK, si pe tabelul
//      referit) = diferenta generata; drumul bun trece si comite; manifest cu rand lipsa / in plus / alta amprenta / alta
//      operatie = refuz; DDL nedeclarat in tranzactie = refuz; schimbarile de sesiune si obiectele temporare ale migrarii
//      nu apar; o functie noua care cheama jsonb_build_object, cu extensions.jsonb_build_object existent, trece;
//   8. secretele (setari de rol / baza, optiuni FDW / mapari) nu apar in detaliu;
//   9. timpul pe un catalog sintetic (~1.500 functii, ~300 tabele, ~50 vederi): pasul „inainte” si „dupa”, rece si cald.
// Rulare (din radacina repo-ului; cere bash in PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_amprenta_globala_local.mjs
// Limite: PGlite = PostgreSQL 18 (productia e 17: in 18 NOT NULL sunt si in pg_constraint — testul le asteapta doar pe 18);
//   fara concurenta reala si fara timere (probele cu doua sesiuni si plafonul: scripts/test_livrare_l15_v2.sh pe PG17);
//   fara furnizor de etichete de securitate (familia eticheta_securitate nu se poate schimba aici).
import { PGlite } from '@electric-sql/pglite'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'ag_v1_'))
let esecuri = 0
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { esecuri++; console.log('  ESEC ' + m) } }
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const CAT = gen('bloc', 'AG_CATALOG v1')
const SES = gen('bloc', 'AG_SESIUNE v1')
const GUC = gen('guc_local')
const lit = (s) => "'" + String(s).split("'").join("''") + "'"

// citirea coordonatorului: textul generat de scripts/amprenta_globala_citire.sh (sectiunile dintre marcaje)
const DIR_CIT = join(TMP, 'citire')
const rc = spawnSync('bash', [join(ROOT, 'scripts/amprenta_globala_citire.sh'), '--tinta-host', 'localhost', '--tinta-port', '5432',
  '--tinta-db', 'postgres', '--tinta-sistem', '1', '--user', 'postgres', '--lista', '--radacina', 'public.poarta(bigint)',
  '--doar-genereaza', DIR_CIT], { encoding: 'utf8' })
if (rc.status !== 40) { console.error('citirea nu s-a generat:', rc.status, rc.stderr); process.exit(1) }
const CIT = readFileSync(join(DIR_CIT, 'citire.sql'), 'utf8').split('\r').join('')
const sectiune = (n) => {
  const a = `-- >>> AG_CITIRE ${n}\n`, b = `\n-- <<< AG_CITIRE ${n}`
  const i = CIT.indexOf(a), j = CIT.indexOf(b)
  if (i < 0 || j < 0 || CIT.indexOf(a, i + 1) >= 0) throw new Error('sectiunea citirii lipseste: ' + n)
  return CIT.slice(i + a.length, j)
}

// --- calcule ----------------------------------------------------------------------------------------------------------
// citirea (ca psql: sesiunea, SET LOCAL canonic, interogarea globala cu :'ag_ses' substituit) => { global, n, fam, rand }
async function citeste(db) {
  await db.exec('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    const s = (await db.query(sectiune('sesiune'))).rows[0]
    await db.exec(GUC)
    const rows = (await db.query(sectiune('global').split(":'ag_ses'").join(lit(s.ag_ses)))).rows
    const r = { fam: {}, rand: new Map(), validare: null }
    for (const x of rows) {
      if (x.tip === 'GLOBAL') { r.global = x.valoare; r.n = Number(x.n) }
      else if (x.tip === 'FAMILIE') r.fam[x.familie] = x.valoare
      else if (x.tip === 'VALIDARE') r.validare = x.valoare
      else if (x.tip === 'RAND') r.rand.set(x.familie + '\t' + x.eticheta, x.amprenta)
    }
    return r
  } finally { await db.exec('ROLLBACK') }
}
// setul de catalog dupa o schimbare (in tranzactie, apoi ROLLBACK): { fam: md5 pe familie, global (fara sesiune), detalii }
async function catalogIn(db, schimbare = '', cat = CAT) {
  await db.exec('BEGIN')
  try {
    if (schimbare) await db.exec(schimbare)
    await db.exec(GUC)
    await db.exec(`CREATE TEMP TABLE ag_t AS ${cat}`)
    const g = (await db.query(`SELECT * FROM (${gen('global', 'pg_temp.ag_t')}) g`)).rows[0]
    const f = (await db.query(gen('familii', 'pg_temp.ag_t'))).rows
    const d = (await db.query('SELECT familie, eticheta, detaliu FROM pg_temp.ag_t')).rows
    return { global: g.global_md5, n: Number(g.randuri), fam: Object.fromEntries(f.map(x => [x.familie, x.md5])), d }
  } finally { await db.exec('ROLLBACK') }
}
const familiiSchimbate = (a, b) => [...new Set([...Object.keys(a.fam), ...Object.keys(b.fam)])].filter(k => a.fam[k] !== b.fam[k]).sort()
const faraFamilie = (fam) => {
  const k = CAT.lastIndexOf(' WHERE g.ok = 1')
  if (k < 0) throw new Error('coada blocului nerecunoscuta')
  return CAT.slice(0, k) + ` WHERE g.ok = 1 AND r.familie <> ${lit(fam)}` + CAT.slice(k + ' WHERE g.ok = 1'.length)
}
// pasii runnerului: BEGIN; 2_ag_inainte; migrarea; 4_ag_dupa; final — exact textul generat
async function livrare(db, { aprobat, manifest = null, migrare = '', final = 'ROLLBACK' }) {
  const T = randomBytes(8).toString('hex')
  let man = '-'
  if (manifest !== null) { man = join(TMP, `m_${T}.l15.tsv`); writeFileSync(man, manifest) }
  const sql = gen('inainte', T, aprobat) + '\n' + migrare + '\n;\n' + gen('dupa', T, aprobat, man)
  const notices = []
  await db.exec('BEGIN')
  try {
    await db.exec(sql, { onNotice: (n) => notices.push(n.message) })
    await db.exec(final)
    return { ok: true, notices }
  } catch (e) {
    await db.exec('ROLLBACK')
    return { ok: false, err: String(e.message), notices }
  }
}
const manifestDin = (notices) => notices.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
const globalCitit = (notices) => (notices.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]

// --- schema falsa tip Supabase ----------------------------------------------------------------------------------------
const FIXTURE = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA extensions;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
CREATE FUNCTION extensions.jsonb_build_object(text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$ SELECT '{}'::jsonb $f$;
CREATE TYPE public.stare AS ENUM ('activ', 'inchis');
CREATE DOMAIN public.cod AS text CHECK (VALUE ~ '^[A-Z]+$');
CREATE TYPE public.interval_zile AS RANGE (subtype = date);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_owner boolean NOT NULL DEFAULT false, nume text);
CREATE TABLE public.sites (id bigint PRIMARY KEY, activ boolean DEFAULT true, stare public.stare, cod public.cod);
CREATE TABLE public.copil (id int PRIMARY KEY, site_id bigint REFERENCES public.sites(id));
CREATE TABLE public.jurnal (id bigserial PRIMARY KEY, t timestamptz DEFAULT '2026-01-01 00:00+02', x text);
CREATE RULE r_jurnal AS ON UPDATE TO public.jurnal DO ALSO NOTIFY jurnal;
CREATE TABLE public.mama (id int); CREATE TABLE public.fiica () INHERITS (public.mama);
CREATE TABLE public.part (id int, d date) PARTITION BY RANGE (d);
CREATE TABLE public.part_2026 PARTITION OF public.part FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE FUNCTION public.aux_drept() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;
CREATE VIEW public.v_drept WITH (security_invoker = on) AS SELECT p.id, public.aux_drept() AS permis FROM public.profiles p;
CREATE FUNCTION public.poarta(p_site bigint) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$ BEGIN RETURN EXISTS (SELECT 1 FROM public.v_drept v WHERE v.id = auth.uid() AND v.permis); END $f$;
REVOKE ALL ON FUNCTION public.poarta(bigint) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.poarta(bigint) TO authenticated;
CREATE FUNCTION public.trg_fn() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;
CREATE TRIGGER trg_sites BEFORE UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.trg_fn();
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_sites ON public.sites FOR SELECT TO authenticated USING (public.poarta(id));
GRANT SELECT ON public.sites TO authenticated;
CREATE VIEW public.v_ts AS SELECT '2026-01-01 10:00+02'::timestamptz AS t, 1.1::float8 AS f, interval '1 day 2 hours' AS i, 12.5::numeric::money AS bani;
CREATE MATERIALIZED VIEW public.mv AS SELECT 1 AS x;
CREATE SEQUENCE public.seq_ag;
CREATE FUNCTION public.fn_et() RETURNS event_trigger LANGUAGE plpgsql AS $f$ BEGIN END $f$;
CREATE OPERATOR FAMILY public.fam_ag USING btree;
CREATE OPERATOR CLASS public.cls_ag FOR TYPE int4 USING btree FAMILY public.fam_ag AS OPERATOR 1 <, OPERATOR 3 =, FUNCTION 1 btint4cmp(int4, int4);
CREATE FOREIGN DATA WRAPPER fdw_baza;
CREATE SERVER srv_ag FOREIGN DATA WRAPPER fdw_baza;
CREATE FOREIGN TABLE public.ext_ag (id int) SERVER srv_ag OPTIONS (tabel 'x');
CREATE PUBLICATION pub_ag;
`

async function main() {
  const db = new PGlite()
  const ver = Number((await db.query('SHOW server_version_num')).rows[0].server_version_num)
  console.log(`PGlite: server_version_num ${ver}`)
  await db.exec(FIXTURE)

  console.log('1. garda contextului canonic')
  let err = ''
  try { await db.query(CAT) } catch (e) { err = String(e.message) }
  ok(err.includes('AG_V1_CONTEXT_NECANONIC'), `blocul fara SET-urile canonice => eroare AG_V1_CONTEXT_NECANONIC (${err.slice(0, 80)})`)

  console.log('2. paritate citire <-> pasul runnerului; validare; etichete unice')
  const c0 = await citeste(db)
  ok(/^[0-9a-f]{32}$/.test(c0.global || '') && c0.n > 200, `citirea: GLOBAL ${c0.global}, ${c0.n} randuri`)
  ok(c0.validare === 'ok', `citirea: validare ${c0.validare}`)
  ok(c0.rand.size === c0.n, `etichete unice: ${c0.rand.size} perechi familie + eticheta distincte = ${c0.n} randuri`)
  const r0 = await livrare(db, { aprobat: '-', manifest: null })
  ok(r0.ok && globalCitit(r0.notices) === c0.global, `pasul „inainte” (citire) da acelasi GLOBAL: ${globalCitit(r0.notices)}`)
  const r1 = await livrare(db, { aprobat: c0.global, manifest: '' })
  ok(r1.ok && r1.notices.some(m => m.startsWith(`AMPRENTA_GLOBALA inainte: ${c0.global} = aprobat`)) && r1.notices.some(m => m.startsWith('AMPRENTA_GLOBALA dupa: 0 diferente')),
    'livrare goala cu GLOBAL aprobat si manifest gol => trece (obiectele temporare ale pasilor nu apar in diferenta)')
  const ramase = (await db.query("SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname LIKE 'pg_temp%' AND p.proname LIKE 'ag%'")).rows[0].n
  ok(ramase === 0, 'dupa livrare nu raman functii temporare ale pasilor')
  const fam = Object.keys(c0.fam).sort()
  console.log('     familii prezente: ' + fam.join(' '))

  console.log('3. independenta de sesiune (search_path, TimeZone, DateStyle, IntervalStyle, extra_float_digits, quote_all_identifiers, lc_monetary)')
  const baza = await catalogIn(db)
  const ostil = await catalogIn(db, "SET LOCAL search_path = extensions, public; SET LOCAL TimeZone = 'America/New_York'; SET LOCAL DateStyle = 'German, DMY'; SET LOCAL IntervalStyle = 'sql_standard'; SET LOCAL extra_float_digits = 3; SET LOCAL quote_all_identifiers = on;")
  ok(baza.global === ostil.global, `catalogul (fara sesiune) identic sub sesiune ostila: ${baza.global} / ${ostil.global}`)
  const rOstil = await livrare(db, { aprobat: '-', manifest: null, migrare: '' })
  ok(rOstil.ok, 'pasul runnerului ruleaza si cand sesiunea are alt search_path')
  {
    // pasul runnerului sub sesiune ostila: catalogul identic, doar familia sesiune difera
    await db.exec('BEGIN')
    const T = randomBytes(8).toString('hex'); const n = []
    await db.exec("SET LOCAL quote_all_identifiers = on; SET LOCAL search_path = extensions, public; SET LOCAL TimeZone = 'Asia/Tokyo'; SET LOCAL DateStyle = 'SQL, DMY'; SET LOCAL extra_float_digits = 0;")
    await db.exec(gen('inainte', T, '-'), { onNotice: (x) => n.push(x.message) })
    const fOst = (await db.query(gen('familii', `pg_temp.ag_ina_${T}`))).rows
    await db.exec('ROLLBACK')
    const dif = fOst.filter(x => c0.fam[x.familie] !== x.md5).map(x => x.familie)
    ok(dif.length === 1 && dif[0] === 'sesiune', `pasul runnerului sub sesiune ostila: difera doar familiile [${dif}] (asteptat: sesiune)`)
  }

  console.log('4. ce NU schimba amprenta: obiecte temporare, date, nextval, ANALYZE')
  for (const [nume, sql] of [
    ['obiecte temporare', 'CREATE TEMP TABLE tt (id int PRIMARY KEY); CREATE TEMP VIEW tv AS SELECT 1 AS x; CREATE FUNCTION pg_temp.tf() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$; CREATE TEMP SEQUENCE ts;'],
    ['date + nextval', "INSERT INTO public.sites (id) VALUES (1); INSERT INTO public.jurnal (x) VALUES ('a'); SELECT nextval('public.seq_ag');"],
    ['ANALYZE', 'ANALYZE public.sites;'],
  ]) {
    const x = await catalogIn(db, sql)
    ok(x.global === baza.global, `${nume}: GLOBAL neschimbat`)
  }

  console.log('5. fiecare familie: schimbarea minima e prinsa; mutantul (familia scoasa) n-o mai prinde')
  const MUT = [
    ['schema', 'GRANT USAGE ON SCHEMA extensions TO anon'],
    ['relatie', 'ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY'],
    ['coloana', 'GRANT SELECT (nume) ON public.profiles TO anon'],
    ['coloana', 'ALTER TABLE public.sites ALTER COLUMN activ SET DEFAULT false'],
    ['constrangere', 'ALTER TABLE public.sites ADD CONSTRAINT ck_id CHECK (id > 0)'],
    ['trigger', 'ALTER TABLE public.sites DISABLE TRIGGER trg_sites'],
    ['trigger', 'ALTER TABLE public.copil DISABLE TRIGGER ALL'],
    ['regula', 'ALTER TABLE public.jurnal DISABLE RULE r_jurnal'],
    ['politica', 'ALTER POLICY p_sites ON public.sites USING (true)'],
    ['functie', 'CREATE OR REPLACE FUNCTION public.aux_drept() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$'],
    ['functie', 'ALTER FUNCTION public.poarta(bigint) RESET search_path'],
    ['tip', "ALTER TYPE public.stare ADD VALUE 'nou'"],
    ['operator', 'CREATE OPERATOR public.=== (LEFTARG = int4, RIGHTARG = int4, FUNCTION = int4eq)'],
    ['familie_operatori', 'CREATE OPERATOR FAMILY public.fam_nou USING hash'],
    ['clasa_operatori', 'ALTER OPERATOR CLASS public.cls_ag USING btree OWNER TO service_role'],
    ['amop', 'ALTER OPERATOR FAMILY public.fam_ag USING btree ADD OPERATOR 2 <= (int4, int4)'],
    ['amproc', 'ALTER OPERATOR FAMILY public.fam_ag USING btree ADD FUNCTION 2 (int4, int4) btint4sortsupport(internal)'],
    ['metoda_acces', 'CREATE ACCESS METHOD heap_ag TYPE TABLE HANDLER heap_tableam_handler'],
    ['cast', 'CREATE CAST (public.stare AS int4) WITH INOUT'],
    ['limbaj', 'REVOKE USAGE ON LANGUAGE sql FROM PUBLIC'],
    ['transformare', 'CREATE TRANSFORM FOR int4 LANGUAGE sql (FROM SQL WITH FUNCTION gtsvector_compress(internal), TO SQL WITH FUNCTION int4recv(internal))'],
    ['conversie', "CREATE CONVERSION public.conv_ag FOR 'UTF8' TO 'LATIN1' FROM utf8_to_iso8859_1"],
    ['colatie', "CREATE COLLATION public.col_ag (provider = libc, locale = 'C')"],
    ['ts_parser', 'CREATE TEXT SEARCH PARSER public.prs_ag (START = prsd_start, GETTOKEN = prsd_nexttoken, END = prsd_end, LEXTYPES = prsd_lextype)'],
    ['ts_sablon', 'CREATE TEXT SEARCH TEMPLATE public.tmpl_ag (LEXIZE = dsimple_lexize)'],
    ['ts_dictionar', 'CREATE TEXT SEARCH DICTIONARY public.dict_ag (TEMPLATE = pg_catalog.simple)'],
    ['ts_config', 'CREATE TEXT SEARCH CONFIGURATION public.cfg_ag (COPY = pg_catalog.simple)'],
    ['extensie', "UPDATE pg_extension SET extversion = '9.9' WHERE extname = 'plpgsql'"],
    ['trigger_eveniment', 'CREATE EVENT TRIGGER et_ag ON ddl_command_start EXECUTE FUNCTION public.fn_et()'],
    ['mostenire', 'ALTER TABLE public.fiica NO INHERIT public.mama'],
    ['acl_implicit', 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon'],
    ['baza', 'REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC'],
    ['parametru_acl', 'GRANT SET ON PARAMETER work_mem TO anon'],
    ['tablespace', 'GRANT CREATE ON TABLESPACE pg_default TO anon'],
    ['rol', 'ALTER ROLE anon BYPASSRLS'],
    ['membru', 'GRANT anon TO authenticated'],
    ['setare_rol', "ALTER ROLE authenticated SET statement_timeout = '9s'"],
    ['fdw', 'CREATE FOREIGN DATA WRAPPER fdw_nou'],
    ['server_extern', "ALTER SERVER srv_ag OPTIONS (ADD host 'gazda-secreta')"],
    ['mapare_utilizator', "CREATE USER MAPPING FOR anon SERVER srv_ag OPTIONS (parola 'secret-mapare')"],
    ['publicatie', 'ALTER PUBLICATION pub_ag SET (publish = insert)'],
    ['publicatie_tabel', 'ALTER PUBLICATION pub_ag ADD TABLE public.sites'],
    ['publicatie_schema', 'ALTER PUBLICATION pub_ag ADD TABLES IN SCHEMA extensions'],
    ['obiect_mare', 'SELECT lo_create(0)'],
  ]
  const acoperite = new Set(), sarite = []
  for (const [f, sql] of MUT) {
    let dupa
    try { dupa = await catalogIn(db, sql) } catch (e) { sarite.push(`${f} (${String(e.message).slice(0, 70)})`); continue }
    const sch = familiiSchimbate(baza, dupa)
    const prins = dupa.global !== baza.global && sch.includes(f)
    let mutantText = ''
    if (prins) {
      const mb = await catalogIn(db, '', faraFamilie(f)), md = await catalogIn(db, sql, faraFamilie(f))
      const famM = familiiSchimbate(mb, md)
      const mutantPica = !famM.includes(f)
      const singura = sch.length === 1
      mutantText = `; mutant fara ${f}: familia nu se mai schimba${singura ? (md.global === mb.global ? ', GLOBAL neschimbat (doar ea o prindea)' : ', DAR GLOBAL tot schimbat') : ` (schimbarea atinge si [${sch.filter(x => x !== f)}])`}`
      ok(mutantPica && (!singura || md.global === mb.global), `${f}: ${sql.slice(0, 70)} => schimbate [${sch}]${mutantText}`)
      acoperite.add(f)
    } else ok(false, `${f}: ${sql.slice(0, 70)} => NEPRINS (schimbate [${sch}])`)
  }
  {
    // familia sesiune: profilul se schimba odata cu sesiunea (calculat in contextul apelantului)
    const q = `SELECT string_agg(eticheta || '=' || amprenta, ',' ORDER BY eticheta) AS s FROM (${SES}) x`
    await db.exec('BEGIN'); const a = (await db.query(q)).rows[0].s
    await db.exec('SET LOCAL row_security = off'); const b = (await db.query(q)).rows[0].s; await db.exec('ROLLBACK')
    ok(a !== b, 'sesiune: SET row_security = off schimba profilul sesiunii')
    acoperite.add('sesiune')
  }
  const toate = CAT.match(/SELECT '([a-z_]+)', '\1 /g).map(s => s.split("'")[1]).concat(['sesiune'])
  const neacoperite = [...new Set(toate)].filter(f => !acoperite.has(f))
  ok(neacoperite.every(f => f === 'eticheta_securitate' || sarite.some(s => s.startsWith(f + ' '))),
    `familii fara proba: [${neacoperite}] (permis doar eticheta_securitate = fara furnizor in PGlite, si ce PGlite nu suporta: [${sarite}])`)

  console.log('6. secretele nu apar in detaliu')
  {
    const x = await catalogIn(db, "ALTER DATABASE postgres SET app.cheie = 'secret-baza'; ALTER ROLE authenticated SET app.cheie2 = 'secret-rol'; ALTER SERVER srv_ag OPTIONS (ADD parola 'secret-server'); CREATE USER MAPPING FOR anon SERVER srv_ag OPTIONS (parola 'secret-mapare');")
    const scurgere = x.d.filter(r => /secret-/.test(r.detaliu))
    ok(scurgere.length === 0, `niciun detaliu nu contine valorile secrete (${scurgere.map(r => r.eticheta)})`)
  }

  console.log('7. contraexemplul #1084 r3: auxiliarul unei vederi citite de poarta, schimbat dupa baseline')
  {
    const G0 = (await citeste(db)).global
    await db.exec('CREATE OR REPLACE FUNCTION public.aux_drept() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT now() IS NOT NULL $f$')
    const r = await livrare(db, { aprobat: G0, manifest: '' })
    const c1 = await citeste(db)
    const difFam = Object.keys(c1.fam).filter(k => c1.fam[k] !== (c0.fam[k]))
    ok(!r.ok && /AMPRENTA_GLOBALA_INAINTE/.test(r.err) && difFam.length === 1 && difFam[0] === 'functie',
      `refuz la „inainte” (${(r.err || '').slice(0, 60)}...); familia care difera: [${difFam}]`)
    ok(r.err && r.err.includes('functie=' + c1.fam.functie), 'mesajul refuzului arata md5-ul familiei functie (diagnostic)')
    await db.exec('CREATE OR REPLACE FUNCTION public.aux_drept() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$')
    ok((await citeste(db)).global === G0, 'auxiliarul readus => GLOBAL revine la baseline')
  }

  console.log('8. manifestul unei migrari mici: lista scrisa de mana = diferenta reala; drumul bun; mutantii manifestului')
  const MIG = `
SET LOCAL search_path = public;
CREATE TEMP TABLE tmp_migrare (x int);
CREATE TABLE public.meteo_nou (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, site_id bigint NOT NULL REFERENCES public.sites(id), t numeric);
ALTER TABLE public.meteo_nou ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_meteo ON public.meteo_nou FOR SELECT TO authenticated USING (public.poarta(site_id));
CREATE FUNCTION public.fn_meteo_vede(p bigint) RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $f$ SELECT public.poarta(p) AND jsonb_build_object('a', 1) IS NOT NULL $f$;
REVOKE ALL ON FUNCTION public.fn_meteo_vede(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_meteo_vede(bigint) TO authenticated;
GRANT SELECT ON public.meteo_nou TO authenticated;
DROP TABLE tmp_migrare;`
  // ASTEPTAT (de mana, din semantica PostgreSQL): tot ce creeaza migrarea, inclusiv obiectele implicite
  const asteptat = [
    'creat relatie public.meteo_nou', 'creat relatie public.meteo_nou_pkey', 'creat relatie public.meteo_nou_id_seq',
    'creat coloana public.meteo_nou.id', 'creat coloana public.meteo_nou.site_id', 'creat coloana public.meteo_nou.t',
    'creat tip public.meteo_nou', 'creat tip public.meteo_nou[]',
    'creat constrangere tabel public.meteo_nou.meteo_nou_pkey', 'creat constrangere tabel public.meteo_nou.meteo_nou_site_id_fkey',
    'creat trigger public.meteo_nou intern meteo_nou_site_id_fkey "RI_FKey_check_ins"() 5',
    'creat trigger public.meteo_nou intern meteo_nou_site_id_fkey "RI_FKey_check_upd"() 17',
    'creat trigger public.sites intern meteo_nou_site_id_fkey "RI_FKey_noaction_del"() 9',
    'creat trigger public.sites intern meteo_nou_site_id_fkey "RI_FKey_noaction_upd"() 17',
    'creat politica public.meteo_nou.p_meteo', 'creat functie public.fn_meteo_vede(bigint)',
  ].concat(ver >= 180000 ? ['creat constrangere tabel public.meteo_nou.meteo_nou_id_not_null', 'creat constrangere tabel public.meteo_nou.meteo_nou_site_id_not_null'] : [])
  const G = (await citeste(db)).global
  const g = await livrare(db, { aprobat: '-', manifest: null, migrare: MIG })
  const manifest = manifestDin(g.notices)
  const real = manifest.trim().split('\n').map(l => { const p = l.split('\t'); return `${p[2]} ${p.slice(1, -2).join('\t')}` }).sort()
  const lipsa = asteptat.filter(x => !real.includes(x)), plus = real.filter(x => !asteptat.includes(x))
  ok(g.ok && lipsa.length === 0 && plus.length === 0, `diferenta generata = lista de mana (${real.length} obiecte); lipsa [${lipsa}] in plus [${plus}]`)
  const total = g.notices.find(m => m.startsWith('L15_DIF_TOTAL'))
  ok(total && Number(total.split(' ')[1]) === real.length, `L15_DIF_TOTAL anunta ${total && total.split(' ')[1]} = ${real.length} linii (completitudine)`)
  const bun = await livrare(db, { aprobat: G, manifest, migrare: MIG, final: 'ROLLBACK' })
  ok(bun.ok && bun.notices.some(m => m.startsWith(`AMPRENTA_GLOBALA dupa: ${real.length} diferente = manifestul`)), `drumul bun: diferenta = manifestul (${(bun.err || '').slice(0, 80)})`)
  const linii = manifest.trim().split('\n')
  const fals = 'f'.repeat(32)
  for (const [nume, m, cod] of [
    ['rand lipsa', linii.slice(1).join('\n') + '\n', 'NEDECLARAT'],
    ['rand in plus', manifest + 'functie\tfunctie public.inexistenta()\tcreat\t' + fals + '\n', 'ABSENT'],
    ['alta amprenta finala', [linii[0].replace(/[0-9a-f]{32}$/, fals)].concat(linii.slice(1)).join('\n') + '\n', 'ALTFEL'],
    ['alta operatie', [linii[0].replace('\tcreat\t', '\tschimbat\t')].concat(linii.slice(1)).join('\n') + '\n', 'ALTFEL'],
  ]) {
    const r = await livrare(db, { aprobat: G, manifest: m, migrare: MIG })
    ok(!r.ok && /AMPRENTA_GLOBALA_DUPA: \d+ diferente fata de manifest/.test(r.err) && r.err.includes(cod), `manifest cu ${nume} => refuz ${cod}`)
  }
  {
    const r = await livrare(db, { aprobat: G, manifest, migrare: MIG + '\nCREATE OR REPLACE FUNCTION public.aux_drept() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT 1 = 1 $f$;' })
    ok(!r.ok && r.err.includes('NEDECLARAT schimbat functie public.aux_drept()'), 'DDL nedeclarat in tranzactie (ca o sesiune care comite intre „inainte” si „dupa”) => refuz NEDECLARAT')
    let loc = ''
    try { gen('dupa', '0123456789abcdef', G, (writeFileSync(join(TMP, 'rau.l15.tsv'), 'functie\tx\tcreat\tnu-e-md5\n'), join(TMP, 'rau.l15.tsv'))) } catch (e) { loc = String(e.stderr) }
    ok(/manifest: linia 1/.test(loc), 'manifest cu format gresit => refuz local, inainte de orice conexiune')
  }
  {
    const r = await livrare(db, { aprobat: G, manifest, migrare: MIG, final: 'COMMIT' })
    const exista = (await db.query("SELECT to_regclass('public.meteo_nou') IS NOT NULL AS e")).rows[0].e
    ok(r.ok && exista, 'drumul bun cu COMMIT: obiectele exista dupa livrare')
    const c2 = await citeste(db)
    ok(c2.global !== G && [...c2.rand.keys()].filter(k => !c0.rand.has(k) && !k.startsWith('sesiune')).length >= real.length, 'GLOBAL de dupa livrare = baseline-ul urmatoarei migrari (s-a schimbat)')
  }
  {
    await db.exec('CREATE TABLE public."rand' + String.fromCharCode(10) + 'nou" (x int)')
    const G2 = (await citeste(db)).global
    const r = await livrare(db, { aprobat: '-', manifest: null, migrare: 'ALTER TABLE public."rand' + String.fromCharCode(10) + 'nou" ADD COLUMN y int' })
    ok(!r.ok && r.err.includes('CR / LF'), 'generatorul refuza o eticheta cu LF (nu se poate scrie in manifest)')
    await db.exec('DROP TABLE public."rand' + String.fromCharCode(10) + 'nou"')
    ok(/^[0-9a-f]{32}$/.test(G2), 'eticheta cu LF in catalog nu strica citirea')
  }

  console.log('9. semnalele citirii (lantul portii prin vedere)')
  {
    await db.exec('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await db.exec(GUC)
    const rows = (await db.query(sectiune('semnale'), [], { rowMode: 'array' })).rows
    await db.exec('ROLLBACK')
    const lant = rows.filter(r => r[0] === 'LANT').map(r => r[2])
    const sem = rows.find(r => r[0] === 'SEMNALE')
    ok(lant.includes('functie public.poarta(bigint)') && lant.includes('relatie public.v_drept') && lant.includes('functie public.aux_drept()') && lant.includes('functie auth.uid()'),
      `lantul vede poarta -> vederea -> auxiliarul + auth.uid(): [${lant}]`)
    ok(sem && sem[2] === '1' && sem[4] === '0', `SEMNALE: vederi citite = ${sem && sem[2]} (asteptat 1), DEFINER fara search_path = ${sem && sem[4]} (asteptat 0)`)
  }

  console.log('10. timpul pe un catalog sintetic (~1.500 functii, ~300 tabele, ~50 vederi)')
  {
    const mare = new PGlite()
    await mare.exec(FIXTURE)
    let s = ''
    for (let i = 0; i < 300; i++) {
      s += `CREATE TABLE public.t${i} (id bigint PRIMARY KEY, a text, b int, c numeric, d timestamptz DEFAULT now(), e boolean DEFAULT false, f jsonb, g uuid);
CREATE INDEX t${i}_b ON public.t${i} (b); ALTER TABLE public.t${i} ENABLE ROW LEVEL SECURITY;
CREATE POLICY p${i} ON public.t${i} FOR SELECT TO authenticated USING (public.poarta(id)); GRANT SELECT ON public.t${i} TO authenticated;\n`
      if (i % 3 === 0) s += `CREATE TRIGGER tg${i} BEFORE UPDATE ON public.t${i} FOR EACH ROW EXECUTE FUNCTION public.trg_fn();\n`
      if (i % 6 === 0) s += `CREATE VIEW public.v${i} WITH (security_invoker = on) AS SELECT id, a, b FROM public.t${i} WHERE b > 0;\n`
    }
    for (let i = 0; i < 1500; i++) {
      s += `CREATE FUNCTION public.f${i}(p bigint) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v int; BEGIN SELECT count(*) INTO v FROM public.t${i % 300} WHERE id = p; IF v > 0 THEN RETURN public.poarta(p); END IF; RETURN false; END $f$;
REVOKE ALL ON FUNCTION public.f${i}(bigint) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.f${i}(bigint) TO authenticated;\n`
    }
    await mare.exec(s)
    const cm = await citeste(mare)
    const timp = []
    for (const eticheta of ['rece', 'cald']) {
      const t0 = Date.now()
      const r = await livrare(mare, { aprobat: cm.global, manifest: '' })
      const ms = (re) => { const m = r.notices.map(x => x.match(re)).find(Boolean); return m ? Number(m[1]) : NaN }
      timp.push(`${eticheta}: inainte ${ms(/^AMPRENTA_GLOBALA inainte: .* calcul (\d+) ms/)} ms, dupa ${ms(/^AMPRENTA_GLOBALA dupa: .* calcul (\d+) ms/)} ms, total pasi ${Date.now() - t0} ms`)
      ok(r.ok, `catalog sintetic (${cm.n} randuri), ${timp[timp.length - 1]}`)
    }
    await mare.close()
  }

  await db.close()
  rmSync(TMP, { recursive: true, force: true })
  if (esecuri) { console.log(`\nESEC: ${esecuri} verificari au picat`); process.exit(1) }
  console.log('\nPASS test_amprenta_globala_local')
}
main().catch((e) => { console.error(e); rmSync(TMP, { recursive: true, force: true }); process.exit(1) })
