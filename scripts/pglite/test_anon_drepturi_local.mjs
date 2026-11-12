// Proba LOCALĂ a treptelor 20261218a / b / c (drepturile rolului anon în public) pe PGlite (Postgres în WASM, în memorie) — NU atinge
// nicio bază reală. Tiparul: scripts/pglite/test_raport_linii_proiect_local.mjs.
// Baza: o schemă falsă tip Supabase (anon / authenticated / service_role, auth.uid() din request.jwt.claim.sub, drepturile implicite ale lui
//   postgres pe public ca în producție: anon arwdxt pe tabele, rwU pe secvențe) cu câte un obiect din fiecare caz al regulii: tabel fără
//   politici (serial), tabel IDENTITY, tabel cu politică pentru PUBLIC, tabel cu drepturi DOAR pe coloane, vedere security_invoker, tabel al
//   altui proprietar, formular public (politică INSERT pentru anon + vedere peste el), RPC SECURITY DEFINER apelat de o pagină publică,
//   funcție fără DEFINER apelabilă de anon, drept implicit al altui rol.
// 1. scripts/anon_drepturi_citire.sql (READ ONLY) -> rândurile BASELINE puse în migrări, ca după review; aplicare a -> b -> c ca runnerul
//    (plafon 2000 + marcaje); verificări INDEPENDENTE de regulă (L25): instantaneul drepturilor din catalog, cererile reale ca anon.
// 2. revenire c -> b -> a = EXACT starea de dinainte (instantaneul complet al lui anon + al celorlalte roluri); re-aplicare.
// 3. refuzuri + MUTANȚI (fiecare TREBUIE să pice la verificarea lui).
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_anon_drepturi_local.mjs
// Limită: PGlite = PostgreSQL 18, o singură conexiune: lock_timeout / concurența reală nu se probează aici (doar ce lock-uri ia REVOKE).
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const citeste = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const CITIRE = citeste('scripts/anon_drepturi_citire.sql')
const MIG = {
  a: citeste('supabase/migrations/20261218a_securitate_anon_drepturi.sql'),
  b: citeste('supabase/migrations/20261218b_securitate_anon_drepturi_tabele.sql'),
  c: citeste('supabase/migrations/20261218c_securitate_anon_drepturi_implicite.sql'),
}
const REV = {
  a: citeste('supabase/revenire/20261218a_securitate_anon_drepturi_ROLLBACK.sql'),
  b: citeste('supabase/revenire/20261218b_securitate_anon_drepturi_tabele_ROLLBACK.sql'),
  c: citeste('supabase/revenire/20261218c_securitate_anon_drepturi_implicite_ROLLBACK.sql'),
}
const NUME = { a: '20261218a_securitate_anon_drepturi', b: '20261218b_securitate_anon_drepturi_tabele', c: '20261218c_securitate_anon_drepturi_implicite' }
const TREAPTA = { a: 'T1', b: 'T2', c: 'T3' }
const PLASARE = (t) => `    ('${t}', NULL::integer, 'DE_COMPLETAT')`
const PASTRATE_GOL = 'SELECT x.obiect, x.motiv FROM (VALUES (NULL::text, NULL::text)) x(obiect, motiv) WHERE x.obiect IS NOT NULL'
const PASTRATE_FORMULAR = "SELECT x.obiect, x.motiv FROM (VALUES ('public.v_formular_public', 'pagina publica de test')) x(obiect, motiv) WHERE x.obiect IS NOT NULL"

function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 90))
    t = t.split(din).join(in_)
  }
  return t
}

const SCHEMA = `
CREATE ROLE anon NOLOGIN NOINHERIT; CREATE ROLE authenticated NOLOGIN NOINHERIT; CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE supabase_admin NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $f$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT CREATE ON SCHEMA public TO supabase_admin;
-- drepturile implicite ca în producție (anon fără TRUNCATE / MAINTAIN; authenticated și service_role complet)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
-- tabel fără politici (serial)
CREATE TABLE public.t_fara_politici (id serial PRIMARY KEY, x text);
ALTER TABLE public.t_fara_politici ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_fp_auth ON public.t_fara_politici TO authenticated USING (auth.uid() IS NOT NULL);
-- tabel IDENTITY fără politici
CREATE TABLE public.t_identity (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, x text);
ALTER TABLE public.t_identity ENABLE ROW LEVEL SECURITY;
-- tabel cu politică pentru PUBLIC (cere cont): rămâne în afara T2
CREATE TABLE public.t_cu_politica (id serial PRIMARY KEY, x text);
ALTER TABLE public.t_cu_politica ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_cp_all ON public.t_cu_politica USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
-- tabel cu drepturi DOAR pe coloane pentru anon (ca garantii)
CREATE TABLE public.t_coloane (id serial PRIMARY KEY, a text, secret text);
ALTER TABLE public.t_coloane ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.t_coloane FROM anon, authenticated;
GRANT SELECT (id, a) ON public.t_coloane TO anon, authenticated;
-- vedere security_invoker
CREATE VIEW public.v_simplu WITH (security_invoker = on) AS SELECT id, x FROM public.t_fara_politici;
-- tabel al altui proprietar
CREATE TABLE public.t_alt_proprietar (id integer);
ALTER TABLE public.t_alt_proprietar OWNER TO supabase_admin;
-- formular public: politică INSERT pentru anon, citit printr-o vedere
CREATE TABLE public.formular_public (id serial PRIMARY KEY, nume text);
ALTER TABLE public.formular_public ENABLE ROW LEVEL SECURITY;
CREATE POLICY fp_insert ON public.formular_public FOR INSERT TO anon WITH CHECK (true);
CREATE VIEW public.v_formular_public WITH (security_invoker = on) AS SELECT id, nume FROM public.formular_public;
-- RPC SECURITY DEFINER apelat de o pagină publică (scrie în t_fara_politici fără drepturi pentru anon pe tabel)
CREATE FUNCTION public.fn_pagina_publica(p_x text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v integer; BEGIN INSERT INTO public.t_fara_politici (x) VALUES (p_x) RETURNING id INTO v; RETURN v; END $f$;
REVOKE ALL ON FUNCTION public.fn_pagina_publica(text) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.fn_pagina_publica(text) TO anon;
-- funcție FĂRĂ DEFINER apelabilă de anon (FUNCTII_ANON)
CREATE FUNCTION public.fn_invoker_citeste() RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT count(*) FROM public.t_fara_politici $f$;
-- vedere-agregat (contoare): anon primește UN rând cu zero, fără date (SIMULARE: AGREGAT_FARA_DATE, nu DATE_CITIBILE)
CREATE VIEW public.v_contor WITH (security_invoker = on) AS SELECT count(*) AS n FROM public.t_cu_politica;
-- partiții (r2): părintele cu politică pentru PUBLIC + partiție fără politici; și invers
CREATE TABLE public.t_part (id integer, x text) PARTITION BY RANGE (id);
CREATE TABLE public.t_part_1 PARTITION OF public.t_part FOR VALUES FROM (0) TO (100);
ALTER TABLE public.t_part ENABLE ROW LEVEL SECURITY; ALTER TABLE public.t_part_1 ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_part_p ON public.t_part FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE TABLE public.t_part2 (id integer, x text) PARTITION BY RANGE (id);
CREATE TABLE public.t_part2_1 PARTITION OF public.t_part2 FOR VALUES FROM (0) TO (100);
ALTER TABLE public.t_part2 ENABLE ROW LEVEL SECURITY; ALTER TABLE public.t_part2_1 ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_part2_1_p ON public.t_part2_1 FOR SELECT USING (auth.uid() IS NOT NULL);
`

async function bazaNoua() {
  const db = new PGlite()
  await db.exec(SCHEMA)
  await db.exec(`SET ROLE supabase_admin; GRANT SELECT, INSERT ON public.t_alt_proprietar TO anon; RESET ROLE;`)
  return db
}
// aplicarea ca runnerul cu --plafon-tranzactie-ms 2000: SET de sesiune înainte de BEGIN, marcajele (livrare + plafon) în tranzacție
async function caRunner(db, nume, text, { plafon = 2000, marcajPlafon = true, marcaj = true, inainteDeCommit = null } = {}) {
  const pre = plafon ? `SET transaction_timeout = ${plafon};` : 'SET transaction_timeout = 0;'
  const mp = marcajPlafon ? `SELECT set_config('gazpet.plafon_tranzactie', '${plafon}:' || txid_current(), true);` : ''
  const mk = marcaj ? `SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);` : ''
  const jurnal = []
  let rez
  try {
    rez = await db.exec(`${pre} BEGIN ISOLATION LEVEL READ COMMITTED; ${mk} ${mp}\n${text}\n${inainteDeCommit ? inainteDeCommit + '\nROLLBACK;' : 'COMMIT;'}`,
      { onNotice: (n) => jurnal.push(n.message) })
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } e.jurnal = jurnal; throw e } finally { await db.exec('SET transaction_timeout = 0;') }
  return { jurnal, rez }
}
async function citire(db, text = CITIRE) {
  const jurnal = []
  const rez = await db.exec(text, { onNotice: (n) => jurnal.push(n.message) })
  const randuri = rez.flatMap(r => r.rows || [])
  return { randuri, jurnal }
}
const sectiune = (c, s) => c.randuri.filter(r => r.sectiune === s)
async function migrariCuBaseline(db, { citireText = CITIRE, mig = MIG } = {}) {
  const c = await citire(db, citireText)
  const out = {}
  for (const k of ['a', 'b', 'c']) {
    const b = sectiune(c, 'BASELINE').find(r => r.treapta === TREAPTA[k])
    out[k] = aplica(mig[k], [[PLASARE(TREAPTA[k]), b.detaliu]])
  }
  return { mig: out, citire: c }
}
// instantaneul INDEPENDENT de regulă (L25): toate aclitem-urile din public (relații, coloane) și toate drepturile implicite, ca text
async function instantaneu(db) {
  const r = await db.query(`
    SELECT 'rel ' || c.oid::regclass::text || ' ' || x::text AS l FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, unnest(c.relacl) x WHERE n.nspname = 'public'
    UNION ALL SELECT 'col ' || c.oid::regclass::text || '.' || a.attname || ' ' || x::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0, unnest(a.attacl) x WHERE n.nspname = 'public'
    UNION ALL SELECT 'def ' || d.defaclrole::regrole::text || ' ' || coalesce(d.defaclnamespace::regnamespace::text, '-') || ' ' || d.defaclobjtype::text || ' ' || x::text
      FROM pg_default_acl d, unnest(d.defaclacl) x
    ORDER BY 1`)
  return r.rows.map(x => x.l)
}
const anonDin = (inst) => inst.filter(l => / anon=/.test(l))
const altiiDin = (inst) => inst.filter(l => !/ anon=/.test(l))
async function caAnon(db, sql) {
  try {
    const r = await db.exec(`BEGIN; SET LOCAL ROLE anon; SELECT set_config('request.jwt.claims', '{"role":"anon"}', true); ${sql}; COMMIT;`)
    return { ok: true, rows: r[r.length - 2]?.rows }
  } catch (e) { await db.exec('ROLLBACK'); return { ok: false, code: e.code, mesaj: e.message } }
}

let esecuri = 0, treceri = 0
const verifica = (cond, mesaj) => { if (cond) { treceri++; console.log('  ok   ' + mesaj) } else { esecuri++; console.error('  PICA ' + mesaj) } }
async function trebuieSaRefuze(promisiune, fragment, mesaj) {
  try { await promisiune; verifica(false, `${mesaj} (a trecut, trebuia refuz „${fragment}”)`) } catch (e) {
    verifica(e.message.includes(fragment), `${mesaj} -> refuz: ${e.message.slice(0, 150)}`)
    return e
  }
}

// ── 1. aplicare reală a -> b -> c ──
console.log('1. citire + aplicare a -> b -> c')
const db = await bazaNoua()
const inst0 = await instantaneu(db)
const { mig: M, citire: C0 } = await migrariCuBaseline(db)
const ob = sectiune(C0, 'OBIECT')
const tr = (t) => ob.filter(r => r.treapta === t).map(r => r.eticheta).sort()
console.log('   T1:', tr('T1').join(', '))
console.log('   T2:', tr('T2').join(', '))
console.log('   T3:', tr('T3').join(', '))
console.log('   RAMANE:', ob.filter(r => r.treapta === 'RAMANE').map(r => r.eticheta + ' (' + r.motiv + ')').join('; '))
verifica(JSON.stringify(tr('T1')) === JSON.stringify(['secventa public.t_coloane_id_seq', 'secventa public.t_fara_politici_id_seq',
  'secventa public.t_identity_id_seq']), 'T1 = secvențele lui postgres, fără cele din DEFAULT-ul tabelelor cu politică INSERT / ALL pentru anon / PUBLIC')
verifica(['secventa public.formular_public_id_seq', 'secventa public.t_cu_politica_id_seq'].every(e => ob.some(r => r.eticheta === e && r.treapta === 'RAMANE' && /poate insera/.test(r.motiv))),
  'RAMANE: secvențele tabelelor în care anon poate insera după politici (INSERT / ALL)')
verifica(JSON.stringify(tr('T2')) === JSON.stringify(['tabel public.t_coloane', 'tabel public.t_fara_politici',
  'tabel public.t_identity', 'tabel public.t_part_1', 'tabel_partitionat public.t_part2', 'vedere public.v_contor', 'vedere public.v_formular_public',
  'vedere public.v_simplu']), 'T2 = tabelele fără politici pentru anon/PUBLIC + vederile; partițiile judecate separat de părinte')
verifica(['tabel_partitionat public.t_part', 'tabel public.t_part2_1'].every(e => ob.some(r => r.eticheta === e && r.treapta === 'RAMANE')),
  'partiții: părintele cu politică și partiția cu politică rămân, fiecare pe rândul ei')
const det = (e) => ob.find(r => r.eticheta === e)?.detaliu || ''
verifica(/; oid=\d+;/.test(det('tabel public.t_identity')) && /; rls=true\/false;/.test(det('tabel public.t_identity'))
  && /; reguli=[0-9a-f]{32};/.test(det('vedere public.v_simplu')) && /; politici=[0-9a-f]{32};/.test(det('tabel public.t_fara_politici'))
  && /; implicite=[0-9a-f]{32}$/.test(det('secventa public.t_fara_politici_id_seq')) && /; parinti=\d+;/.test(det('tabel public.t_part_1')),
  'amprenta v2: oid, RLS / FORCE, corpul vederii, politicile, DEFAULT-urile (și la secvență), părintele partiției')
verifica(sectiune(C0, 'CONTROL').length === 1 && /^\d+ obiecte$/.test(sectiune(C0, 'CONTROL')[0].detaliu) && sectiune(C0, 'BASELINE').length === 3,
  'citirea: 3 rânduri BASELINE (T1 / T2 / T3) + 1 rând CONTROL (RAMANE)')
verifica(ob.some(r => r.treapta === 'RAMANE' && r.eticheta === 'tabel public.formular_public'), 'RAMANE: tabelul cu politică INSERT pentru anon')
verifica(JSON.stringify(tr('T3')) === JSON.stringify(['implicit postgres public S', 'implicit postgres public r']), 'T3 = implicitele lui postgres pe public (tabele + secvențe)')
verifica(ob.some(r => r.treapta === 'RAMANE' && r.eticheta === 'tabel public.t_cu_politica' && /politici/.test(r.motiv)), 'RAMANE: tabelul cu politică pentru PUBLIC')
verifica(ob.some(r => r.treapta === 'RAMANE' && r.eticheta === 'tabel public.t_alt_proprietar' && /proprietar supabase_admin/.test(r.motiv)), 'RAMANE: tabelul altui proprietar')
verifica(ob.some(r => r.treapta === 'RAMANE' && r.eticheta === 'implicit supabase_admin public r'), 'RAMANE: implicitul lui supabase_admin')
verifica(ob.find(r => r.eticheta === 'tabel public.t_coloane')?.detaliu.includes('coloane=1:23:-1 id anon=r/postgres;2:25:-1 a anon=r/postgres'),
  'drepturile pe coloane în detaliu, cu attnum:tip:typmod')
verifica(sectiune(C0, 'FUNCTII_ANON').some(r => r.functie === 'public.fn_invoker_citeste()') && !sectiune(C0, 'FUNCTII_ANON').some(r => /fn_pagina_publica/.test(r.functie)),
  'FUNCTII_ANON: funcția fără DEFINER apelabilă de anon (nu și RPC-ul DEFINER)')
verifica(sectiune(C0, 'RAMANE').some(r => r.treapta === 'dupa T1+T2+T3' && r.eticheta === 'tabel'), 'RAMANE după toate treptele: tabelele cu politici / alt proprietar')
verifica(C0.jurnal.some(m => /SIMULARE rezumat: rolul curent anon, 0 relatii cu date citibile, 1 agregate fara date, \d+ goale, \d+ erori/.test(m)),
  'SIMULARE: rulează ca anon, 0 relații cu date citibile, vederea-contor = agregat fără date')
verifica(C0.jurnal.some(m => /SIMULARE anon AGREGAT_FARA_DATE in public\.v_contor/.test(m)), 'SIMULARE: vederea-contor clasată AGREGAT_FARA_DATE')
// SIMULARE deosebește datele citibile: o politică temporară care lasă anon să vadă un rând => DATE_CITIBILE (anulată la final)
{
  await db.exec(`BEGIN; INSERT INTO public.t_cu_politica (x) VALUES ('vizibil'); CREATE POLICY p_tmp ON public.t_cu_politica FOR SELECT TO anon USING (true);`)
  const cs = await citire(db, CITIRE.replace('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;', 'SAVEPOINT s_citire;').replace(/ROLLBACK;\s*$/, 'ROLLBACK TO SAVEPOINT s_citire;'))
  await db.exec('ROLLBACK')
  console.log('   ' + cs.jurnal.filter(m => /SIMULARE (anon DATE|anon AGREGAT|anon EROARE|rezumat)/.test(m)).join(' | '))
  verifica(cs.jurnal.some(m => /SIMULARE anon DATE_CITIBILE in public\.t_cu_politica \(1 randuri/.test(m))
    && cs.jurnal.some(m => /SIMULARE anon DATE_CITIBILE in public\.v_contor/.test(m))
    && cs.jurnal.some(m => /SIMULARE rezumat: rolul curent anon, 2 relatii cu date citibile/.test(m)),
    'SIMULARE: un rând vizibil = DATE_CITIBILE (tabelul și contorul cu valoare nenulă), fără valori în NOTICE')
  verifica(!cs.jurnal.some(m => m.includes('vizibil')), 'SIMULARE: valorile citite nu apar în NOTICE')
}
verifica(C0.jurnal.some(m => /STATISTICI: extensia pg_stat_statements nu e instalata/.test(m)), 'STATISTICI: lipsa extensiei raportată, fără eroare')

// lock-urile ținute de tranzacția T2 la final (OBSERVAȚIE pe PG18, nu garanție pentru PG17.6): pe relațiile din public cel mult ACCESS SHARE
// (nu oprește citiri / scrieri); serializarea cu alte sesiuni vine din rândurile de catalog rescrise (xmin, verificat mai jos), nu din lock-uri
await caRunner(db, NUME.a, M.a)
const lk = await caRunner(db, NUME.b, M.b, { inainteDeCommit: `SELECT l.mode, c.relname, n.nspname FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
  JOIN pg_namespace n ON n.oid = c.relnamespace WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname IN ('public', 'pg_catalog');` })
const lkr = lk.rez[lk.rez.length - 2].rows
const moduri = [...new Set(lkr.filter(r => r.nspname === 'public').map(r => r.mode))]
console.log('   lock-uri observate (PG18): public = ' + moduri.join(', ') + '; catalog = ' + [...new Set(lkr.filter(r => r.nspname === 'pg_catalog' && /^pg_(class|attribute)$/.test(r.relname)).map(r => r.relname + ' ' + r.mode))].join(', '))
verifica(moduri.every(m => m === 'AccessShareLock'), `T2: pe relațiile din public nu ține nimic peste ACCESS SHARE (observat: ${moduri.join(', ') || 'nimic'})`)
const xm = (await caRunner(db, NUME.b, M.b, { inainteDeCommit: `SELECT count(*) FILTER (WHERE c.xmin::text <> (txid_current() % 4294967296)::text)::int AS straine, count(*)::int AS n
  FROM securitate_intern.anon_revocari j JOIN pg_class c ON c.oid = j.obiect_oid WHERE j.migrare = '20261218b';` })).rez
verifica(xm[xm.length - 2].rows[0].straine === 0 && xm[xm.length - 2].rows[0].n === 8, 'T2: la final, rândul din pg_class al fiecărui obiect din jurnal e al tranzacției (blocat până la COMMIT)')
const jb = await caRunner(db, NUME.b, M.b)
console.log('   ' + jb.jurnal.filter(m => /sfarsit/.test(m)).join(' | '))
const jc = await caRunner(db, NUME.c, M.c)
console.log('   ' + jc.jurnal.filter(m => /sfarsit/.test(m)).join(' | '))
const inst1 = await instantaneu(db)
console.log('   anon după a+b+c:', anonDin(inst1).join(' | '))
verifica(JSON.stringify(altiiDin(inst1)) === JSON.stringify(altiiDin(inst0)), 'celelalte roluri: exact ca înainte (instantaneu independent)')
verifica(JSON.stringify(anonDin(inst1).map(l => l.split(' ').slice(0, 2).join(' '))) === JSON.stringify(['def supabase_admin', 'rel formular_public',
  'rel formular_public_id_seq', 'rel t_alt_proprietar', 'rel t_cu_politica', 'rel t_cu_politica_id_seq', 'rel t_part', 'rel t_part2_1']),
  'anon păstrează DOAR: tabelele cu politici (+ secvențele lor, + părintele / partiția cu politică), tabelul altui proprietar, implicitul supabase_admin')
// partițiile (r2): retragerea nu se propagă; cererea pe părinte cere doar dreptul pe părinte, cea directă doar pe partiție
let rp = await caAnon(db, 'SELECT * FROM public.t_part')
verifica(rp.ok && rp.rows.length === 0, 'partiții: părintele păstrat (politică) se citește ca anon (0 rânduri), deși partiția lui e retrasă' + (rp.ok ? '' : ' — ' + rp.mesaj))
rp = await caAnon(db, 'SELECT * FROM public.t_part_1')
verifica(!rp.ok && rp.code === '42501', 'partiții: partiția fără politici, retrasă: 42501 direct')
rp = await caAnon(db, 'SELECT * FROM public.t_part2')
verifica(!rp.ok && rp.code === '42501', 'partiții: părintele fără politici, retras: 42501 (partiția păstrată nu-l deschide)')
rp = await caAnon(db, 'SELECT * FROM public.t_part2_1')
verifica(rp.ok && rp.rows.length === 0, 'partiții: partiția cu politică, păstrată: 0 rânduri direct (retragerea pe părinte n-a atins-o)' + (rp.ok ? '' : ' — ' + rp.mesaj))
// căile reale (L20): RPC-ul paginii publice merge; citirea directă a unui obiect retras = 42501; obiectul rămas = 0 rânduri, fără eroare
let r = await caAnon(db, `SELECT public.fn_pagina_publica('din pagina')`)
verifica(r.ok, 'RPC SECURITY DEFINER al paginii publice: merge după T1+T2+T3' + (r.ok ? '' : ' — ' + r.mesaj))
r = await caAnon(db, 'SELECT * FROM public.t_fara_politici')
verifica(!r.ok && r.code === '42501', 'citire directă ca anon pe un tabel retras: 42501 (înainte: 0 rânduri)')
r = await caAnon(db, 'SELECT * FROM public.t_cu_politica')
verifica(r.ok && r.rows.length === 0, 'citire directă ca anon pe tabelul rămas (politică cu cont): 0 rânduri, fără eroare')
r = await caAnon(db, `INSERT INTO public.formular_public (nume) VALUES ('fara cont')`)
verifica(r.ok, 'INSERT-ul ca anon permis de o politică (serial) merge după T1+T2+T3' + (r.ok ? '' : ' — ' + r.mesaj))
r = await caAnon(db, 'SELECT * FROM public.v_formular_public')
verifica(!r.ok && r.code === '42501', 'vederea nedeclarată la pct. 1: 42501 după T2 (de aceea lista pct. 1)')
r = await caAnon(db, 'SELECT public.fn_invoker_citeste()')
verifica(!r.ok && r.code === '42501', 'funcția fără DEFINER apelabilă de anon: 42501 după T2 (de aceea FUNCTII_ANON în citire)')
await db.exec('CREATE TABLE public.t_dupa (id serial PRIMARY KEY); CREATE VIEW public.v_dupa AS SELECT id FROM public.t_dupa;')
const nou = (await instantaneu(db)).filter(l => /t_dupa|v_dupa/.test(l) && / anon=/.test(l))
verifica(nou.length === 0, 'după T3: un tabel / o secvență / o vedere NOI nu dau nimic lui anon')
await db.exec('DROP VIEW public.v_dupa; DROP TABLE public.t_dupa;')
const C1 = await citire(db)
verifica(sectiune(C1, 'OBIECT').filter(x => ['T1', 'T2', 'T3'].includes(x.treapta)).length === 0, 'citirea după: nimic de retras în T1 / T2 / T3')
const jr = (await db.query(`SELECT migrare, count(*)::int n FROM securitate_intern.anon_revocari GROUP BY 1 ORDER BY 1`)).rows
verifica(JSON.stringify(jr) === JSON.stringify([{ migrare: '20261218a', n: 3 }, { migrare: '20261218b', n: 8 }, { migrare: '20261218c', n: 2 }]), 'jurnalul = listele: ' + JSON.stringify(jr))
// controlul periodic pe RAMANE (r2): un obiect creat de platformă (supabase_admin, cu drepturile lui implicite pentru anon) după aplicare
{
  const k0 = sectiune(C1, 'CONTROL')[0]
  await db.exec('SET ROLE supabase_admin; CREATE TABLE public.t_platforma (id integer); RESET ROLE;')
  const C2 = await citire(db)
  const k1 = sectiune(C2, 'CONTROL')[0]
  verifica(k1.amprenta !== k0.amprenta && Number(k1.detaliu.split(' ')[0]) === Number(k0.detaliu.split(' ')[0]) + 1
    && sectiune(C2, 'OBIECT').some(x => x.eticheta === 'tabel public.t_platforma' && x.treapta === 'RAMANE' && /proprietar supabase_admin/.test(x.motiv))
    && sectiune(C2, 'BASELINE').every(x => x.detaliu.includes(", 0, '")),
    'control periodic: obiectul nou al lui supabase_admin schimbă CONTROL RAMANE (+1, amprentă nouă) și apare în OBIECT; T1 / T2 / T3 rămân 0')
  await db.exec('DROP TABLE public.t_platforma;')
}
const acl = (await db.query(`SELECT has_table_privilege('anon', 'securitate_intern.anon_revocari', 'SELECT') a, has_schema_privilege('anon', 'securitate_intern', 'USAGE') s,
  has_table_privilege('authenticated', 'securitate_intern.anon_revocari', 'SELECT') b, has_table_privilege('service_role', 'securitate_intern.anon_revocari', 'SELECT') c`)).rows[0]
verifica(!acl.a && !acl.s && !acl.b && !acl.c, 'jurnalul: niciun drept pentru anon / authenticated / service_role')

// ── 2. reveniri + re-aplicare ──
console.log('2. revenire c -> b -> a, re-aplicare')
await trebuieSaRefuze(caRunner(db, NUME.a + '_ROLLBACK', REV.a), 'randuri 20261218b / 20261218c', 'revenirea a înaintea lui b / c')
await caRunner(db, NUME.c + '_ROLLBACK', REV.c)
await caRunner(db, NUME.b + '_ROLLBACK', REV.b)
await caRunner(db, NUME.a + '_ROLLBACK', REV.a)
const inst2 = await instantaneu(db)
verifica(JSON.stringify(inst2) === JSON.stringify(inst0), 'după revenirile c -> b -> a: TOATE drepturile exact ca la început (anon + ceilalți, pe obiecte, coloane, implicite)')
verifica((await db.query(`SELECT to_regnamespace('securitate_intern') s`)).rows[0].s === null, 'jurnalul și schema lui au dispărut')
await caRunner(db, NUME.a, M.a); await caRunner(db, NUME.b, M.b); await caRunner(db, NUME.c, M.c)
verifica(JSON.stringify(altiiDin(await instantaneu(db))) === JSON.stringify(altiiDin(inst0)) && JSON.stringify(anonDin(await instantaneu(db))) === JSON.stringify(anonDin(inst1)), 're-aplicarea a -> b -> c: aceeași stare ca prima dată')
await trebuieSaRefuze(caRunner(db, NUME.b, M.b), 'reaplicare', 'b de două ori')
await trebuieSaRefuze(caRunner(db, NUME.a, M.a), 'exista deja', 'a de două ori')
// revenirea refuză când starea s-a schimbat după livrare
await db.exec('GRANT SELECT ON public.t_identity TO anon;')
await trebuieSaRefuze(caRunner(db, NUME.b + '_ROLLBACK', REV.b), 'drepturi noi pentru anon', 'revenirea b după un drept nou pentru anon pe un obiect retras')
await db.exec('REVOKE SELECT ON public.t_identity FROM anon;')
// coloana recreată (contraexemplul review-ului #1081 P1): „a” redenumită, alta nouă cu numele „a” => refuz, iar coloana nouă nu primește nimic
await db.exec('ALTER TABLE public.t_coloane RENAME COLUMN a TO a_vechi; ALTER TABLE public.t_coloane ADD COLUMN a text;')
await trebuieSaRefuze(caRunner(db, NUME.b + '_ROLLBACK', REV.b), 'coloane schimbate', 'revenirea b după redenumirea coloanei a + o coloană nouă „a”')
verifica(!(await db.query(`SELECT has_column_privilege('anon', 'public.t_coloane', 'a', 'SELECT') x`)).rows[0].x
  && !(await db.query(`SELECT has_column_privilege('anon', 'public.t_coloane', 'a_vechi', 'SELECT') x`)).rows[0].x, 'coloana nouă „a” (și cea veche) NU au primit dreptul')
await db.exec('ALTER TABLE public.t_coloane DROP COLUMN a; ALTER TABLE public.t_coloane RENAME COLUMN a_vechi TO a;')
await db.exec('ALTER TABLE public.t_coloane ALTER COLUMN a TYPE varchar(50);')
await trebuieSaRefuze(caRunner(db, NUME.b + '_ROLLBACK', REV.b), 'coloane schimbate', 'revenirea b după schimbarea tipului coloanei a')
await db.exec('ALTER TABLE public.t_coloane ALTER COLUMN a TYPE text;')
await db.exec('ALTER TABLE public.t_coloane DROP COLUMN a; ALTER TABLE public.t_coloane ADD COLUMN a text;')
await trebuieSaRefuze(caRunner(db, NUME.b + '_ROLLBACK', REV.b), 'coloane schimbate', 'revenirea b după scoaterea coloanei a și adăugarea alteia cu același nume')
await db.exec('DROP VIEW public.v_simplu;')
await trebuieSaRefuze(caRunner(db, NUME.b + '_ROLLBACK', REV.b), 'disparute', 'revenirea b după ștergerea unui obiect retras')
await db.exec('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO anon;')
await trebuieSaRefuze(caRunner(db, NUME.c + '_ROLLBACK', REV.c), 'date dupa livrare', 'revenirea c după un drept implicit nou pentru anon')
await db.close()

// ── 3. refuzuri și mutanți ──
console.log('3. refuzuri și mutanți')
async function cuBaza(fn) { const d = await bazaNoua(); try { return await fn(d) } finally { await d.close() } }
for (const k of ['a', 'b', 'c']) {
  await cuBaza(async (d) => {
    const { mig } = await migrariCuBaseline(d)
    if (k !== 'a') await caRunner(d, NUME.a, mig.a)
    await trebuieSaRefuze(caRunner(d, NUME[k], MIG[k]), 'BASELINE necompletat', `${k}: BASELINE necompletat`)
    await trebuieSaRefuze(caRunner(d, NUME[k], mig[k], { plafon: 0, marcajPlafon: false }), 'PLAFON_TRANZACTIE lipsa', `${k}: fără plafon`)
    await trebuieSaRefuze(caRunner(d, NUME[k], mig[k], { marcaj: false }), 'garda start invalida', `${k}: fără marcajul runnerului`)
  })
}
await cuBaza(async (d) => {
  const { mig } = await migrariCuBaseline(d)
  await trebuieSaRefuze(caRunner(d, NUME.b, mig.b), 'se aplica intai 20261218a', 'b înaintea lui a')
  await trebuieSaRefuze(caRunner(d, NUME.c, mig.c), 'se aplica intai 20261218a', 'c înaintea lui a')
})
// un obiect NOU apărut între citire (baseline) și aplicare = refuz, cu lista de acum în NOTICE
await cuBaza(async (d) => {
  const { mig } = await migrariCuBaseline(d)
  await d.exec('CREATE TABLE public.t_aparut (id serial PRIMARY KEY);')
  const e = await trebuieSaRefuze(caRunner(d, NUME.a, mig.a), 'difera de BASELINE', 'a: o secvență nouă după citire')
  verifica(e?.jurnal?.some(m => m.includes('secventa public.t_aparut_id_seq')), 'a: NOTICE-ul refuzului arată obiectul nou')
  await d.exec('DROP TABLE public.t_aparut;')
  await caRunner(d, NUME.a, mig.a)
  await d.exec('CREATE VIEW public.v_aparuta AS SELECT 1 AS x;')
  await trebuieSaRefuze(caRunner(d, NUME.b, mig.b), 'difera de BASELINE', 'b: o vedere nouă după citire')
  await d.exec('DROP VIEW public.v_aparuta; CREATE POLICY p_noua ON public.t_identity TO anon USING (true);')
  await trebuieSaRefuze(caRunner(d, NUME.b, mig.b), 'difera de BASELINE', 'b: o politică nouă pentru anon după citire (obiectul iese din T2)')
  await d.exec('DROP POLICY p_noua ON public.t_identity; GRANT SELECT (a) ON public.t_fara_politici TO anon;'.replace('(a)', '(x)'))
  await trebuieSaRefuze(caRunner(d, NUME.b, mig.b), 'difera de BASELINE', 'b: alte drepturi (o coloană) după citire')
  await d.exec('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE USAGE ON SEQUENCES FROM anon;')
  await trebuieSaRefuze(caRunner(d, NUME.c, mig.c), 'difera de BASELINE', 'c: implicitele schimbate după citire')
})
// r2 (review #1081 P1): un obiect RECREAT cu același nume / aceleași drepturi, sau schimbat în ce nu ține de drepturile lui anon, după citire
const RECREARI = [
  ['a', 'secvența IDENTITY recreată (tabelul șters și recreat identic)', `DROP TABLE public.t_identity;
    CREATE TABLE public.t_identity (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, x text); ALTER TABLE public.t_identity ENABLE ROW LEVEL SECURITY;`],
  ['a', 'secvența scoasă din DEFAULT-ul tabelului ei', 'ALTER TABLE public.t_coloane ALTER COLUMN id SET DEFAULT 0;'],
  ['b', 'vederea ștearsă și recreată IDENTIC (alt oid)', `DROP VIEW public.v_simplu;
    CREATE VIEW public.v_simplu WITH (security_invoker = on) AS SELECT id, x FROM public.t_fara_politici;`],
  ['b', 'corpul vederii rescris (același oid)', 'CREATE OR REPLACE VIEW public.v_simplu WITH (security_invoker = on) AS SELECT id, x, 1 AS y FROM public.t_fara_politici;'],
  ['b', 'FORCE ROW LEVEL SECURITY pornit', 'ALTER TABLE public.t_identity FORCE ROW LEVEL SECURITY;'],
  ['b', 'RLS oprit', 'ALTER TABLE public.t_identity DISABLE ROW LEVEL SECURITY;'],
  ['b', 'expresia unei politici (pentru authenticated) schimbată', 'ALTER POLICY t_fp_auth ON public.t_fara_politici USING (true);'],
  ['b', 'un DEFAULT schimbat', `ALTER TABLE public.t_fara_politici ALTER COLUMN x SET DEFAULT 'z';`],
  ['b', 'partiția desprinsă de părinte', 'ALTER TABLE public.t_part DETACH PARTITION public.t_part_1;'],
]
for (const [k, nume, sql] of RECREARI) {
  await cuBaza(async (d) => {
    const { mig } = await migrariCuBaseline(d)
    if (k !== 'a') await caRunner(d, NUME.a, mig.a)
    await d.exec(sql)
    await trebuieSaRefuze(caRunner(d, NUME[k], mig[k]), 'difera de BASELINE', `${k}: ${nume} după citire`)
  })
}
// r2: CURSA dintre calculul listei și REVOKE (review #1081 P1). PGlite are o singură conexiune: „cealaltă sesiune” e simulată determinist,
// cu instrucțiunea ei injectată EXACT în fereastră (proba cu două sesiuni reale: scripts/anon_drepturi_concurenta.mjs, pe clona PG17).
const INJ_A = '-- ── jurnalul comun al treptelor (neexpus în API, doar postgres) ──'
const INJ_B = '-- ── jurnal, blocarea rândurilor + recitirea, apoi UN SINGUR REVOKE pe lista din jurnal + verificarea coloanelor ──'
const INJ_C = '-- blocarea: retragere fără efect de la PUBLIC => cele două rânduri din pg_default_acl sunt rescrise de noi și rămân ale noastre până la COMMIT'
const REV_B_IN = "  EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM anon';"
const GRANT_SEQ = 'GRANT SELECT ON SEQUENCE public.t_identity_id_seq TO anon WITH GRANT OPTION;'
const jurnalT = async (d, m, e) => (await d.query(`SELECT drepturi, coloane FROM securitate_intern.anon_revocari WHERE migrare = '${m}' AND eticheta = '${e}'`)).rows[0]
await cuBaza(async (d) => {
  const { mig } = await migrariCuBaseline(d)
  await trebuieSaRefuze(caRunner(d, NUME.a, aplica(mig.a, [[INJ_A, GRANT_SEQ + '\n' + INJ_A]])), 'schimbare concurenta',
    'cursa a: un drept nou (opțiune de acordare) pe o secvență din listă, între calcul și blocare')
  await trebuieSaRefuze(caRunner(d, NUME.a, aplica(mig.a, [["  EXECUTE 'REVOKE ALL ON SEQUENCE ' || v_lista || ' FROM PUBLIC';", '  NULL;']])),
    'blocarea randurilor din catalog nu s-a facut', 'mutant a fără blocare: dovada pe xmin refuză')
  // mutantul fără recitire: aceeași cursă TRECE și dreptul injectat dispare fără jurnal (defectul din review, reprodus)
  await caRunner(d, NUME.a, aplica(mig.a, [[INJ_A, GRANT_SEQ + '\n' + INJ_A],
    ["  IF v_dif IS NOT NULL THEN\n    RAISE EXCEPTION '20261218a: schimbare concurenta", "  IF false THEN\n    RAISE EXCEPTION '20261218a: schimbare concurenta"]]))
  const j = await jurnalT(d, '20261218a', 'secventa public.t_identity_id_seq')
  const acum = (await d.query(`SELECT has_sequence_privilege('anon', 'public.t_identity_id_seq', 'SELECT WITH GRANT OPTION') x`)).rows[0].x
  verifica(j && !j.drepturi.some(x => x.includes('*')) && !acum, 'mutant a fără recitire: dreptul dat în fereastră e retras și LIPSEȘTE din jurnal (recitirea e cea care îl prinde)')
})
await cuBaza(async (d) => {
  const { mig } = await migrariCuBaseline(d)
  await caRunner(d, NUME.a, mig.a)
  await trebuieSaRefuze(caRunner(d, NUME.b, aplica(mig.b, [[INJ_B, 'GRANT SELECT ON public.t_identity TO anon WITH GRANT OPTION;\n' + INJ_B]])), 'schimbare concurenta',
    'cursa b: un drept nou pe un tabel din listă, între calcul și blocare')
  const COL = `  EXECUTE 'GRANT SELECT (x) ON public.t_identity TO anon';\n` + REV_B_IN
  await trebuieSaRefuze(caRunner(d, NUME.b, aplica(mig.b, [[REV_B_IN, COL]])), 'drepturi pe coloane schimbate concurent',
    'cursa b: un drept pe o coloană FĂRĂ drepturi (rând neblocat), între recitire și REVOKE')
  await caRunner(d, NUME.b, aplica(mig.b, [[REV_B_IN, COL], ['  IF v_col_dupa IS DISTINCT FROM v_col THEN', '  IF false THEN']]))
  const j = await jurnalT(d, '20261218b', 'tabel public.t_identity')
  verifica(j && !j.coloane.some(x => / x anon=/.test(x)), 'mutant b fără verificarea coloanelor: dreptul pe coloană dat în fereastră e retras și LIPSEȘTE din jurnal')
})
await cuBaza(async (d) => {
  const { mig } = await migrariCuBaseline(d)
  await caRunner(d, NUME.a, mig.a)
  await trebuieSaRefuze(caRunner(d, NUME.c, aplica(mig.c, [[INJ_C, 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE ON TABLES TO anon;\n' + INJ_C]])),
    'schimbare concurenta', 'cursa c: un drept implicit nou pentru anon, între calcul și blocare')
})
await cuBaza(async (d) => {
  const { mig } = await migrariCuBaseline(d)
  await caRunner(d, NUME.a, mig.a)
  await d.exec('ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT SELECT ON TABLES TO anon;')
  await trebuieSaRefuze(caRunner(d, NUME.c, mig.c), 'implicite GLOBALE', 'c: un drept implicit GLOBAL al lui postgres pentru anon')
})
// pct. 1: un obiect FOLOSIT de o pagină publică (declarat în regulă, aceeași schimbare în citire și migrare) NU se retrage, cu tot ce citește
await cuBaza(async (d) => {
  const P = [[PASTRATE_GOL, PASTRATE_FORMULAR]]
  const { mig, citire: c } = await migrariCuBaseline(d, { citireText: aplica(CITIRE, P), mig: { a: aplica(MIG.a, P), b: aplica(MIG.b, P), c: aplica(MIG.c, P) } })
  const o = sectiune(c, 'OBIECT')
  verifica(['vedere public.v_formular_public', 'tabel public.formular_public', 'secventa public.formular_public_id_seq']
    .every(e => o.some(x => x.eticheta === e && x.treapta === 'RAMANE')), 'pct. 1: vederea folosită, tabelul citit de ea și secvența lui (DEFAULT nextval) rămân')
  await caRunner(d, NUME.a, mig.a); await caRunner(d, NUME.b, mig.b); await caRunner(d, NUME.c, mig.c)
  let x = await caAnon(d, `INSERT INTO public.formular_public (nume) VALUES ('din pagina')`)
  verifica(x.ok, 'pct. 1: INSERT-ul paginii publice ca anon merge după T1+T2+T3' + (x.ok ? '' : ' — ' + x.mesaj))
  x = await caAnon(d, 'SELECT * FROM public.v_formular_public')
  verifica(x.ok, 'pct. 1: citirea vederii publice ca anon merge după T1+T2+T3' + (x.ok ? '' : ' — ' + x.mesaj))
})
// mutant: obiectul păstrat doar în citire (baseline), nu și în migrare -> listele diferă -> refuz
await cuBaza(async (d) => {
  const { mig: normal } = await migrariCuBaseline(d)
  const { mig } = await migrariCuBaseline(d, { citireText: aplica(CITIRE, [[PASTRATE_GOL, PASTRATE_FORMULAR]]) })
  await caRunner(d, NUME.a, normal.a)
  await trebuieSaRefuze(caRunner(d, NUME.b, mig.b), 'difera de BASELINE', 'mutant: regula din migrare diferă de cea din citire (pct. 1 doar într-una)')
})
// mutant pe REGULĂ: fără prudența secvențelor tabelelor cu politică INSERT -> INSERT-ul permis de politică pică (verificarea principală l-ar prinde)
await cuBaza(async (d) => {
  const R = [['SELECT d.refobjid FROM (SELECT i.oid FROM anon_pastrate_inchise i UNION SELECT p.oid FROM anon_insert_politici p) i',
              'SELECT d.refobjid FROM (SELECT i.oid FROM anon_pastrate_inchise i) i']]
  const { mig } = await migrariCuBaseline(d, { citireText: aplica(CITIRE, R), mig: { a: aplica(MIG.a, R), b: aplica(MIG.b, R), c: aplica(MIG.c, R) } })
  await caRunner(d, NUME.a, mig.a)
  const x = await caAnon(d, `INSERT INTO public.formular_public (nume) VALUES ('fara cont')`)
  verifica(!x.ok && x.code === '42501', 'mutant regulă fără secvențele tabelelor cu politică INSERT: INSERT-ul anon chiar pică (verificarea principală l-ar prinde)')
})
// mutanți pe migrare / revenire: fiecare TREBUIE să pice la verificarea lui
const MUTANTI = [
  ['a fără REVOKE', 'a', [["EXECUTE 'REVOKE ALL ON SEQUENCE ' || v_lista || ' FROM anon';", 'NULL;']], 'anon mai are drepturi'],
  ['b retrage și de la authenticated', 'b', [["EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM anon';", "EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM anon, authenticated';"]], 'drepturile altor roluri'],
  ['b retrage doar SELECT (coloanele rămân)', 'b', [["EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM anon';", "EXECUTE 'REVOKE SELECT ON TABLE ' || v_lista || ' FROM anon';"]], 'anon mai are drepturi'],
  ['c fără secvențe', 'c', [['ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;', '']], 'obiecte-sonda'],
]
for (const [nume, k, inl, fragment] of MUTANTI) {
  await cuBaza(async (d) => {
    const { mig } = await migrariCuBaseline(d)
    if (k !== 'a') await caRunner(d, NUME.a, mig.a)
    await trebuieSaRefuze(caRunner(d, NUME[k], aplica(mig[k], inl)), fragment, 'mutant ' + nume)
  })
}
const MUTANTI_REV = [
  ['revenirea b fără coloane', 'b', [["EXECUTE format('GRANT %s (%s) ON TABLE %s TO anon', g.drept, g.coloane, g.tabel) || CASE WHEN g.optiune THEN ' WITH GRANT OPTION' ELSE '' END;", 'NULL;']], 'nu sunt exact cele din jurnal'],
  ['revenirea b dă și TRUNCATE', 'b', [["EXECUTE format('GRANT %s ON TABLE %s TO anon', g.simple, g.lista);", "EXECUTE format('GRANT %s, TRUNCATE ON TABLE %s TO anon', g.simple, g.lista);"]], 'nu sunt exact cele din jurnal'],
  ['revenirea a dă și lui authenticated', 'a', [["EXECUTE format('GRANT %s ON SEQUENCE %s TO anon', g.simple, g.lista);", "EXECUTE format('GRANT %s ON SEQUENCE %s TO anon', g.simple, g.lista); EXECUTE format('REVOKE UPDATE ON SEQUENCE %s FROM authenticated', g.lista);"]], 'drepturile altor roluri'],
  ['revenirea c fără secvențe', 'c', [["      FROM securitate_intern.anon_revocari j WHERE j.migrare = '20261218c'\n  LOOP",
    "      FROM securitate_intern.anon_revocari j WHERE j.migrare = '20261218c' AND j.eticheta = 'implicit postgres public r'\n  LOOP"]], 'nu sunt exact cele din jurnal'],
]
for (const [nume, k, inl, fragment] of MUTANTI_REV) {
  await cuBaza(async (d) => {
    const { mig } = await migrariCuBaseline(d)
    await caRunner(d, NUME.a, mig.a); await caRunner(d, NUME.b, mig.b); await caRunner(d, NUME.c, mig.c)
    if (k === 'a') { await caRunner(d, NUME.c + '_ROLLBACK', REV.c); await caRunner(d, NUME.b + '_ROLLBACK', REV.b) }
    await trebuieSaRefuze(caRunner(d, NUME[k] + '_ROLLBACK', aplica(REV[k], inl)), fragment, 'mutant ' + nume)
  })
}
// mutant pe REGULĂ (aceeași schimbare peste tot, deci baseline-ul o acceptă): tabelele cu politici intră în T2 -> verificarea independentă pică
await cuBaza(async (d) => {
  const R = [["                  WHEN r.politici_anon > 0 THEN 'RAMANE'\n", '']]
  const { mig } = await migrariCuBaseline(d, { citireText: aplica(CITIRE, R), mig: { a: aplica(MIG.a, R), b: aplica(MIG.b, R), c: aplica(MIG.c, R) } })
  await caRunner(d, NUME.a, mig.a); await caRunner(d, NUME.b, mig.b)
  const a = anonDin(await instantaneu(d))
  verifica(!a.some(l => l.startsWith('rel t_cu_politica ')), 'mutant regulă fără excepția politicilor: tabelul cu politică chiar pierde dreptul (verificarea principală l-ar prinde)')
})

console.log(`\n${treceri} verificări trecute, ${esecuri} picate`)
process.exit(esecuri ? 1 : 0)
