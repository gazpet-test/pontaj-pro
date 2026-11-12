// Proba LOCALĂ a amprentelor 20261131e (PR #1012 r4, review Jakarinos r3 P2 / L15) pe PGlite (Postgres în WASM, în memorie) — NU atinge
// nicio bază reală și NU înlocuiește dry-run-ul pe clonă (schema falsă de mai jos n-are rolurile, triggerele și politicile reale).
// Pași: schemă falsă tip Supabase → 20261105a întreagă → migrarea NECOMPLETATĂ refuză → amprentele baseline din interogarea
// scriptului coordonatorului → migrarea completată se aplică → T4 / T5 EXACT din dry-run (refuzul la o versiune ulterioară a unei
// funcții, în migrare și în revenire) → un mutant (md5 greșit în revenire) trebuie prins → revenire + re-aplicare.
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_intrebari_cercetare_local.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const R = new URL('../../', import.meta.url)
const citeste = f => readFileSync(new URL(f, R), 'utf8').replace(/\r\n/g, '\n')
const MIG = citeste('supabase/migrations/20261131e_intrebari_cercetare_surse.sql')
const RB = citeste('supabase/revenire/20261131e_intrebari_cercetare_surse_ROLLBACK.sql')
const BAZA = citeste('supabase/migrations/20261105a_intrebari_tehnice.sql')
const AMP = citeste('scripts/intrebari_cercetare_amprente.sql')
const DRY = citeste('supabase/tests/20261131e_intrebari_cercetare_surse_dryrun.sql')

const SCHELET = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid $$;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array(name, '/') $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_owner boolean);
CREATE TABLE public.app_modules (key text PRIMARY KEY, name text, icon text, color text, description text, is_active boolean, display_order int, show_on_homepage boolean);
CREATE TABLE public.user_module_access (profile_id uuid, module text);
CREATE TABLE public.notifications (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, profile_id uuid, type text,
  modul text CHECK (modul IN ('general', 'altul')), title text, message text, link_to text);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notif_sel ON public.notifications FOR SELECT TO authenticated USING (profile_id = auth.uid());
CREATE FUNCTION public.fn_notif_trg() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER notif_trg BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.fn_notif_trg();
CREATE FUNCTION public.fn_verifica_secret(text, text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
INSERT INTO public.profiles VALUES ('00000000-0000-0000-0000-000000000001', true);
`
const intre = (t, a, b) => { const l = t.split('\n'); const i = l.findIndex(x => x.startsWith(a)), j = l.findIndex(x => x.startsWith(b)); return l.slice(i + 1, j).join('\n') }
let esec = 0
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) esec++ }
async function incearca(db, sql) { try { await db.exec(sql); return 'ok' } catch (e) { try { await db.exec('ROLLBACK') } catch {} return e.message } }

const db = new PGlite()
console.log('server:', (await db.query('SHOW server_version')).rows[0].server_version)
await db.exec(SCHELET)
ok(await incearca(db, `BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261105a_intrebari_tehnice:' || txid_current(), true);\n${BAZA}\nCOMMIT;`) === 'ok', '20261105a aplicată pe schema falsă')

// 1) migrarea necompletată refuză (fail-closed)
const necompletat = await incearca(db, `BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261131e_intrebari_cercetare_surse:' || txid_current(), true);\n${MIG}\nCOMMIT;`)
ok(/amprentele baseline nu sunt completate/.test(necompletat), 'migrarea cu blocul necompletat refuză: ' + necompletat.slice(0, 90))

// 2) amprentele baseline cu interogarea din scriptul coordonatorului (același search_path)
const q = intre(AMP, '-- >>> AMPRENTE: interogarea', '-- <<< AMPRENTE: interogarea')
await db.exec('BEGIN; SET LOCAL search_path = pg_catalog, pg_temp;')
const rez = (await db.query(`SELECT eticheta, amprenta FROM (\n${q}\n) x ORDER BY eticheta COLLATE "C"`)).rows
await db.exec('ROLLBACK')
console.log('etichete baseline:', rez.map(r => r.eticheta).join(' | '))
ok(rez.some(r => r.eticheta === 'trg:public.notifications.notif_trg') && rez.some(r => r.eticheta === 'pol:public.notifications.notif_sel'),
  'triggerele / politicile de pe notifications intră în amprente')
const json = '{\n' + rez.map(r => `    ${JSON.stringify(r.eticheta)}: ${JSON.stringify(r.amprenta)}`).join(',\n') + '\n  }'
const bloc = intre(MIG, '  -- >>> AMPRENTE BASELINE', '  -- <<< AMPRENTE BASELINE')
const MIGC = MIG.replace(bloc, () => `  SELECT '${json}'::jsonb`)

// 3) migrarea completată trece (postcondițiile incluse) și lasă tot ce verifică $final$
const aplicare = await incearca(db, `BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261131e_intrebari_cercetare_surse:' || txid_current(), true);\n${MIGC}\nCOMMIT;`)
ok(aplicare === 'ok', 'migrarea completată se aplică: ' + aplicare.slice(0, 200))

// 4) T4 / T5 exact din dry-run (fișierele puse în r31e_src cum le-ar pune \copy), într-o tranzacție anulată
const seg = DRY.slice(DRY.indexOf('-- aplică migrarea (\'mig\''), DRY.indexOf("DO $t$ BEGIN RAISE NOTICE 'DRY 20261131e r4"))
const linii = (f, t) => t.split('\n').map(l => `('${f}', ${l === '' ? 'NULL' : `'${l.replace(/'/g, "''")}'`})`).join(',\n')
const pregatire = `CREATE TEMP TABLE r31e_src (fisier text, nr bigint GENERATED ALWAYS AS IDENTITY, linie text);
INSERT INTO r31e_src (fisier, linie) VALUES ${linii('mig', MIGC)};
INSERT INTO r31e_src (fisier, linie) VALUES ${linii('rb', RB)};`
const notite = []
const r45 = await (async () => { try { await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED;\n${pregatire}\n${seg}\nROLLBACK;`); return 'ok' } catch (e) { try { await db.exec('ROLLBACK') } catch {} return e.message } })()
ok(r45 === 'ok', 'T4 (migrarea refuză: corp / setare / trigger nou; martorul trece) și T5 (revenirea refuză: corp / SECURITY INVOKER; martorul trece): ' + r45.slice(0, 300))

// 5) mutant de control: dacă revenirea ar avea md5-ul greșit pentru o funcție, T5m (martorul) trebuie să pice
const RBm = RB.replace('"public.fn_intrebari_reia(bigint)": "', '"public.fn_intrebari_reia(bigint)": "0')
const pregatireM = pregatire.replace(linii('rb', RB), () => linii('rb', RBm))
const rm = await (async () => { try { await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED;\n${pregatireM}\n${seg}\nROLLBACK;`); return 'ok' } catch (e) { try { await db.exec('ROLLBACK') } catch {} return e.message } })()
ok(/T[45][a-z]? FAIL.*fn_intrebari_reia\(bigint\) are alt corp/.test(rm), 'mutant (md5 greșit în revenire) e prins de dry-run: ' + rm.slice(0, 160))

// 6) revenirea reală + re-aplicarea (apply → rollback → re-apply), ca T1
const rev = await incearca(db, `BEGIN ISOLATION LEVEL READ COMMITTED; SELECT set_config('gazpet.revenire_20261131e', 'SCOATE_CERCETARE:' || txid_current(), true);\n${RB}\nCOMMIT;`)
ok(rev === 'ok', 'revenirea standard: ' + rev.slice(0, 200))
const reap = await incearca(db, `BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261131e_intrebari_cercetare_surse:' || txid_current(), true);\n${MIGC}\nCOMMIT;`)
ok(reap === 'ok', 're-aplicarea după revenire (amprentele de după revenire = baseline-ul): ' + reap.slice(0, 200))

console.log(esec ? `\n${esec} EȘEC(URI)` : '\nTOATE OK')
process.exit(esec ? 1 : 0)
