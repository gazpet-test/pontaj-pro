// Testele decisive Copilot (ADDENDUM 5, R9b + completarea: ordine, ciclul după transmitere, drepturi) pe PGlite — 37/37 la 26.09.2026. Rulat din scratchpad-ul sesiunii (fixture-urile reale și PGlite nu sunt în repo).
// R5 sarcina 2 (Copilot, închiderea R4/R5, 26.09.2026 — condiția nr. 2 + observațiile): test local PGlite (Postgres 18.3, WASM) pentru
// docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql (migrarea 2, versiunea sarcinii 2) peste migrarea 1 EXACT în forma aplicată în producție
// + docs/R5_MIGRARE_1b_prag_exact.sql. Date: rândurile REALE (SELECT 26.09.2026) — ofertare_cantitati lic. 3 + lic. 95 + eșantionul 1b
// (md5 jsonb rând cu rând = producția) și ofertare_documente_atribuire 130, 470–475, 1035 (subsetul analiza folosit, md5 = producția).
//   (a) conflicte FĂRĂ rând văzute de view / poartă chiar cu 0 rânduri nevalidate; închidere doar prin recitire curată sau confirmare umană
//   (b) „aprobat, folosit în grafic / PT, apoi modificat” — trigger + regula JS consecvente, consumatorii „de reverificat”, rândul rămâne
//   (c) view / istoric indisponibil => „nu putem verifica”, nu zero
//   (d) unitățile — *_pe_um, fără „X m” peste unități
//   (e) v6 — ciornele umane protejate, nicio transmitere automată
//   (f) coexistența cu codul publicat (main = edge v25) + rollback
// Rulare (din scratchpad/pglite): node --experimental-strip-types test_sarcina2_r1.mjs   (întâi: deno run … ../s2/paritate_js.ts)
// Control negativ: MIG2=<migrarea 2 de la a15a62a / 124b2ce / be63d25> — testele sarcinii / reparației trebuie să pice.
// REPARAȚIA RUNDEI 1 (26.09.2026, verificatorii + ADDENDUM 2 Copilot): varianta adaptată la migrarea 2 reparată + secțiunile R1-* noi
// (v6 cu amprenta textului generat și a evenimentului, jurnalele legacy = legacy_partial, parsare defensivă, cheile serverului păstrate la
// scrierea directă, confirmarea = rezolvare / excepție cu drept de decizie, aprobarea finală blocată server-side, acoperirea recitirii).
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const WT = process.env.WT || '/home/user/pontaj-pro/.claude/worktrees/wf_5dba6b86-2fa-2/'
const SP = '/tmp/claude-0/-home-user-pontaj-pro/73db5287-168c-547e-9934-1c38453024bc/scratchpad/'
const MIG1_DOC = readFileSync(WT + 'docs/R5_MIGRARE_PROPUSA_aprobare_istoric.sql', 'utf8')
const MIG1B = readFileSync(WT + 'docs/R5_MIGRARE_1b_prag_exact.sql', 'utf8')
const MIG2 = readFileSync(process.env.MIG2 || WT + 'docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql', 'utf8')
const RB2 = readFileSync(WT + 'docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate_ROLLBACK.sql', 'utf8')
const RPC_TRANSFER = readFileSync(WT + 'supabase/migrations/20260927_ofertare_transfer_plansa_cantitati_atomic.sql', 'utf8')
const JSWT = process.env.JSWT || WT   // control negativ: JSWT = copia codului de la 124b2ce (consumatorii vechi)
const { aplicaRegulaAprobare, referinteDinIstoric } = await import(JSWT + 'src/ofertareCantitatiInvalidare.js')
const A = await import(JSWT + 'src/ofertareCantitatiAprobare.js')
const { calculeazaPoartaGrafic } = await import(JSWT + 'src/graficPoartaCalcul.js')
const { controlCantitati } = await import(JSWT + 'src/ofertareControale.js')
const { evalueazaPoarta } = await import(JSWT + 'src/ofertarePoarta.js')
const TC = await import(WT + 'supabase/functions/ofertare-plansa-citeste/transfer_conflicte.ts')
const DATE = [...JSON.parse(readFileSync(SP + 'pg_r5/cantitati_lic3_lic95.json', 'utf8')), ...JSON.parse(readFileSync(SP + 'pg_r5/esantion_unitati_1b.json', 'utf8'))]
const DOCS = JSON.parse(readFileSync(SP + 'pg_r5/documente_sarcina2.json', 'utf8'))
const PAR = JSON.parse(readFileSync(SP + 's2/paritate_js_r1.json', 'utf8'))
const MIG2_VECHE = readFileSync(SP + 'r1/mig2_be63d25.sql', 'utf8')   // migrarea 2 de la be63d25 (sarcina 2) — pentru controalele negative
const MD5_BD = { // md5 jsonb rând cu rând, PRODUCȚIE (SELECT 26.09.2026) — ca în test_1b_prag_exact.mjs
  1: '9654573c5df6e42ad34afe745aff055a', 2: '13206872485537aca2e6d6d4f0fa5c40', 3: 'a52d7561d1f9cde458ce28d896528bc8', 4: '261ef96b4708ecf910d376bdfc99d11a',
  5: '196bfb0580b8e128ce075a4954b3d45a', 6: '90a3d3cb208bd68a83e27815a19b79ea', 7: '29197a74e6409052f59cff49bc17f23a', 8: '05797db5f90461c17220b84d22d2540c',
  9: '850f8b2546f1d5de7e44b6144f412aa0', 1751: '80d94b05773dab3e98d5a56523cc58e6', 1752: 'e7dd01dd0216ce224ed722e8b3f999af', 1753: '61aa7d469687b242c12716611473e469',
  1754: 'b307f31391562797610fe878c7686157', 1755: 'ac3a4fd80dfd07f327bca43f6223c068', 1756: 'd50a4a41fadced1eae2176dc2bb96db7',
  476: 'a385433f8e4fb2f55c2cf587401640f1', 488: '583a641b8371c079c53a9d89bdab2ee4', 529: '4baa3b613827bd5121cfb47d77504f25', 531: '474eeddc1fbdc5254e34148e404f246c',
  533: '926e045ec9cd3b2429ffe9e7f23cd19e', 559: '875289403f2e13ceea9a647a23ecb06e', 573: '3dc69ab9650e202ef69799561ec1a69f', 604: '41b2577680be5daab6ef874060e8aa40',
  799: '9c36775f72ff92ec517ecc3c21d4d8fc', 810: '3ce20371b6036f18c9414027720fc802', 979: 'dea6efd14045751f54cbb45a9129915d', 1176: '7209f609e278135aa3e78e0780730b0a',
  1299: 'c516ef2fbfb8e9ab1f8e503e87fb09fc', 1539: 'cbccc05ba1c74ac78afbe1bd56b64c5e', 1540: 'd4fa2c04df6aa8e77339f7c699b67dbc', 1541: '3291ba696fd782b5dcc25848b947bb03',
  1547: '486bd5d3e9dfe9ed26c08d5657978096', 1548: 'e5095431925308d4b06fd70f3380665e', 1564: 'e58055353fd189a3a8a161f50458b2b4', 1571: 'cf3b899a54b54f8b27220095a4ef5abc',
  1589: '50ffa9471873289d3b2229130fec9c00', 1591: 'cab2cc73f7fffc57aeaf73108a839b5a',
}
const MD5_MIG1_APLICATA = 'c2839216336369f1fcbc0fb3c7825b38', MD5_V6_LIVE = '0875c2200e072289cd5b972b49cabb0c'

let esecuri = 0, n = 0
const ok = (c, m) => { n++; if (!c) { esecuri++; console.log('EȘEC:', m) } else console.log('ok  ', m) }
const db = new PGlite()
const q = async (s, p) => (await db.query(s, p)).rows
const COLS = 'id, licitatie_id, obiect, categorie, denumire, um, cantitate, specificatii, sursa, cantitate_plansa, diferenta_nota, status, extras_de_ai, created_at, updated_at, tip_sursa, cod_articol, ordine'
const U_OWNER = '00000000-0000-4000-8000-000000000121', U_OF = '00000000-0000-4000-8000-000000000007', U_ALT = '00000000-0000-4000-8000-000000000099'
// reparația rundei 1: U_ED = Ofertare „editor” fără drept de decizie (nu e responsabil); U_ADM = admin Ofertare
const U_ED = '00000000-0000-4000-8000-000000000008', U_ADM = '00000000-0000-4000-8000-000000000009'

// ── 0. schema minimă: coloanele / constrângerile / politicile reale (information_schema + pg_policy, 26.09.2026) ──
await db.exec(`
SET TimeZone = 'UTC';
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;   -- ca în Supabase: service_role ocolește RLS
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE profiles (id uuid PRIMARY KEY, is_owner boolean DEFAULT false);
CREATE TABLE user_module_access (profile_id uuid, module text, access_level text);
INSERT INTO profiles VALUES ('${U_OWNER}', true), ('${U_OF}', false), ('${U_ALT}', false), ('${U_ED}', false), ('${U_ADM}', false);
INSERT INTO user_module_access VALUES ('${U_OF}', 'ofertare', 'editor'), ('${U_ALT}', 'logistica', 'admin'), ('${U_ED}', 'ofertare', 'editor'), ('${U_ADM}', 'ofertare', 'admin');
CREATE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT auth.uid() IS NOT NULL AND (EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.user_module_access uma WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare')) $$;
CREATE TABLE ofertare_licitatii (id bigint PRIMARY KEY, responsabil_id uuid);
CREATE TABLE ofertare_documente_atribuire (id bigint PRIMARY KEY, licitatie_id bigint, nume_original text, tip text, status_procesare text, eroare text, analiza jsonb, analiza_la timestamptz);
ALTER TABLE ofertare_documente_atribuire ENABLE ROW LEVEL SECURITY;
CREATE POLICY ofertare_documente_select ON ofertare_documente_atribuire FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ofertare_documente_update ON ofertare_documente_atribuire FOR UPDATE TO authenticated USING ((SELECT fn_are_acces_ofertare())) WITH CHECK ((SELECT fn_are_acces_ofertare()));
CREATE POLICY ofertare_documente_insert ON ofertare_documente_atribuire FOR INSERT TO authenticated WITH CHECK ((SELECT fn_are_acces_ofertare()));
CREATE POLICY ofertare_documente_delete ON ofertare_documente_atribuire FOR DELETE TO authenticated USING ((SELECT fn_are_acces_ofertare()));
CREATE TABLE ofertare_clarificari (id bigserial PRIMARY KEY, licitatie_id bigint, nr int, intrebare text, sursa text, cantitate_id bigint,
  status text CHECK (status IN ('propunere','de_trimis','trimisa','raspunsa','retrasa')), raspuns text, raspuns_la timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  origine text, cheie text, UNIQUE (licitatie_id, cheie));
CREATE TABLE notifications (id bigserial PRIMARY KEY, profile_id uuid, type text, modul text, title text, message text, link_to text, created_at timestamptz DEFAULT now());
CREATE TABLE grafic_versiuni (id bigserial PRIMARY KEY, licitatie_id bigint, versiune int, snapshot jsonb, poarta jsonb, generat_la timestamptz DEFAULT now());
CREATE TABLE ofertare_pt_poarta (id bigserial PRIMARY KEY, licitatie_id bigint, pt_versiune int, verdict text, semnat_la timestamptz DEFAULT now(), nota text);
CREATE TABLE ofertare_cantitati (id bigserial PRIMARY KEY, licitatie_id bigint NOT NULL, obiect text, categorie text, denumire text NOT NULL, um text,
  cantitate numeric, specificatii text, sursa text, cantitate_plansa numeric, diferenta_nota text, status text NOT NULL DEFAULT 'extras',
  extras_de_ai boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), tip_sursa text, cod_articol text, ordine int,
  CONSTRAINT ofertare_cantitati_status_check CHECK (status = ANY (ARRAY['extras','validat','diferenta','revizuit_clarificare'])),
  CONSTRAINT ofertare_cantitati_tip_sursa_check CHECK (tip_sursa = ANY (ARRAY['lista_f3','lista_c6','lista_alt','memoriu','plansa','caiet','alt'])));
ALTER TABLE ofertare_cantitati ENABLE ROW LEVEL SECURITY;
CREATE POLICY cant_all ON ofertare_cantitati TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE FUNCTION fn_categorie_cantitate(d text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN d ~* 'conduct|țeav|teav|tub' THEN 'Conducte și montaj' END $$;
CREATE FUNCTION fn_trg_categorie_cantitate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF coalesce(NEW.extras_de_ai, false) THEN NEW.categorie := fn_categorie_cantitate(NEW.denumire); END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_categorie_cantitate BEFORE INSERT OR UPDATE OF denumire ON ofertare_cantitati FOR EACH ROW EXECUTE FUNCTION fn_trg_categorie_cantitate();
INSERT INTO ofertare_licitatii VALUES (3, NULL), (95, '${U_OF}'), (102, NULL), (900, '${U_OF}'), (97, '${U_OF}'), (98, '${U_OF}'), (99, NULL);
-- reparația rundei 1: obiectele LIVE refolosite (SELECT 26.09.2026, definițiile exacte): dreptul de decizie și poarta aprobării pachetului
CREATE FUNCTION public.fn_ofertare_source_pack_poate_decide(p_licitatie_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.ofertare_licitatii l WHERE l.id = p_licitatie_id AND l.responsabil_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_module_access uma WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare' AND uma.access_level = 'admin')
  );
$function$;
CREATE TABLE ofertare_pt_pachet (id bigserial PRIMARY KEY, licitatie_id bigint, versiune int, pt_poarta_id bigint, grafic_versiune int, stare text NOT NULL DEFAULT 'propus',
  aprobat_de uuid, aprobat_la timestamptz, depus_la timestamptz, nota text, creat_de uuid, created_at timestamptz DEFAULT now(), UNIQUE (licitatie_id, versiune));
ALTER TABLE ofertare_pt_pachet ENABLE ROW LEVEL SECURITY;
CREATE POLICY ofertare_pt_pachet_select ON ofertare_pt_pachet FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ofertare_pt_pachet_insert ON ofertare_pt_pachet FOR INSERT TO authenticated WITH CHECK ((SELECT fn_are_acces_ofertare()));
CREATE POLICY ofertare_pt_pachet_update ON ofertare_pt_pachet FOR UPDATE TO authenticated USING ((SELECT fn_are_acces_ofertare()) AND stare = 'propus') WITH CHECK ((SELECT fn_are_acces_ofertare()));
CREATE TABLE seap_compl (licitatie_id bigint PRIMARY KEY, blocaj text);
CREATE VIEW v_ofertare_seap_completitudine AS SELECT licitatie_id, blocaj FROM seap_compl;
INSERT INTO seap_compl VALUES (3, NULL), (95, NULL), (900, NULL), (901, NULL);
`)
await db.exec(RB2.slice(RB2.indexOf('CREATE OR REPLACE FUNCTION public.fn_ofertare_pt_pachet_poarta_documentatie()'), RB2.indexOf('DROP VIEW IF EXISTS public.v_ofertare_cantitati_nevalidate')))
await db.exec(`REVOKE ALL ON FUNCTION public.fn_ofertare_pt_pachet_poarta_documentatie() FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.fn_ofertare_pt_pachet_poarta_documentatie() TO service_role;
  CREATE TRIGGER trg_ofertare_pt_pachet_poarta_documentatie BEFORE INSERT OR UPDATE OF stare ON public.ofertare_pt_pachet FOR EACH ROW EXECUTE FUNCTION fn_ofertare_pt_pachet_poarta_documentatie();`)
const MD5_PACHET_LIVE = 'a45ccdb853da8d7a6cabead04d9a95af'
const md5pachet = async () => (await q(`SELECT md5(prosrc) h FROM pg_proc WHERE proname = 'fn_ofertare_pt_pachet_poarta_documentatie'`))[0].h
ok(await md5pachet() === MD5_PACHET_LIVE, 'poarta aprobării pachetului: corpul LIVE reconstruit din rollback = producția (md5(prosrc) a45ccdb8…)')
await db.exec('ALTER TABLE ofertare_cantitati DISABLE TRIGGER trg_categorie_cantitate')
for (const r of DATE) await db.query(`INSERT INTO ofertare_cantitati (${COLS}) SELECT ${COLS} FROM json_populate_record(null::ofertare_cantitati, $1::json)`, [JSON.stringify(r)])
await db.exec('ALTER TABLE ofertare_cantitati ENABLE TRIGGER trg_categorie_cantitate')
await db.exec(`SELECT setval('ofertare_cantitati_id_seq', 100000)`)
for (const d of DOCS) await db.query('INSERT INTO ofertare_documente_atribuire (id, licitatie_id, nume_original, tip, status_procesare, eroare, analiza) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)',
  [d.id, d.licitatie_id, d.nume_original, d.tip, d.status_procesare, d.eroare, JSON.stringify(d.analiza)])
{
  const h = await q(`SELECT c.id::int id, md5((SELECT jsonb_object_agg(k, v) FROM jsonb_each(to_jsonb(c)) e(k, v) WHERE k = ANY ($1::text[]))::text) h FROM ofertare_cantitati c ORDER BY id`, [COLS.split(', ')])
  const dif = h.filter(r => MD5_BD[r.id] !== r.h)
  ok(h.length === 37 && !dif.length, `fixture: cele ${h.length} rânduri reale de cantități = producția (md5 jsonb rând cu rând)`)
  const hd = await q('SELECT id::int id, md5(analiza::text) h FROM ofertare_documente_atribuire ORDER BY id')
  const difd = hd.filter(r => DOCS.find(d => d.id === r.id).h !== r.h)
  ok(hd.length === 8 && !difd.length, `fixture: cele 8 documente reale (130, 470–475, 1035), subsetul analiza = producția (md5)` + (difd.length ? ' dif: ' + JSON.stringify(difd) : ''))
}

// ── migrarea 1 EXACT în forma aplicată + 1b ──
const MIG1_APLICATA = (() => {
  const t = MIG1_DOC.split('\n').filter(l => !/^\s*--/.test(l)).map(l => l.replace(/\s+--.*$/, '')).filter(l => l.trim() !== '').join('\n')
  return t.slice(0, t.indexOf('COMMENT ON FUNCTION public.fn_trg_ofertare_cantitati_aprobare()')).replace(/\n+$/, '')
})()
ok(createHash('md5').update(MIG1_APLICATA).digest('hex') === MD5_MIG1_APLICATA, 'migrarea 1 reconstruită = textul aplicat în producție (md5)')
await db.exec(MIG1_APLICATA); await db.exec(MIG1B)
// v5 LIVE (= rollback-ul migrării 2) — funcția din producție azi
await db.exec(RB2.slice(RB2.indexOf('CREATE OR REPLACE FUNCTION public.ofertare_clarificare_planse_auto')))
const md5v6 = async () => (await q(`SELECT md5(regexp_replace(regexp_replace(prosrc, '--[^\\n]*', '', 'g'), '\\s+', '', 'g')) h FROM pg_proc WHERE proname='ofertare_clarificare_planse_auto'`))[0].h
ok(await md5v6() === MD5_V6_LIVE, 'v5 live (din rollback) = funcția din producție (md5 0875c220…)')

// ── utilitare: rulare ca utilizator autentificat (RLS) ──
const caUser = async (uid, fn) => {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid || ''}', false)`)
  try { return await fn() } finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false)`) }
}
const citeste = async (sql, p) => { try { return { data: await q(sql, p), error: null } } catch (e) { return { data: null, error: { message: e.message } } } }
const tot = async () => createHash('md5').update(JSON.stringify(await q(`SELECT (SELECT json_agg(c ORDER BY id) FROM ofertare_cantitati c) a, (SELECT json_agg(d ORDER BY id) FROM ofertare_documente_atribuire d) b,
  (SELECT json_agg(h ORDER BY id) FROM ofertare_cantitati_istoric h) c`))).digest('hex')

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// VERIFICATOR ADVERSARIAL — lentila consumatori-UI (runda de închidere R4/R5, 26.09.2026). Scenarii NOI, pe o copie (PGlite), fără BD.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
globalThis.Deno = globalThis.Deno || { env: { get: () => '' } }
const CORE = await import(WT + 'supabase/functions/ofertare-clarificari-propune/core.ts')
// [REPARAȚIA RUNDEI 2 — copie a suitei verificatorului UI, rulată pe codul + migrarea reparate] poarta de depunere LIVE instalată înainte de migrarea 2
await db.exec(`ALTER TABLE ofertare_licitatii ADD COLUMN status text DEFAULT 'in_lucru', ADD COLUMN derogare_depunere boolean DEFAULT false, ADD COLUMN termen_depunere timestamptz;
CREATE TABLE ofertare_cerinte (id bigserial PRIMARY KEY, licitatie_id bigint, inlocuita_de bigint, confirmata_de uuid);
CREATE TABLE ofertare_acoperire (id bigserial PRIMARY KEY, cerinta_id bigint, status text, doc_firma_id bigint);
CREATE TABLE documente_firma (id bigserial PRIMARY KEY, utilizabil boolean, fara_expirare boolean, data_valabilitate date, se_reemite boolean);`)
await db.exec(RB2.slice(RB2.indexOf('CREATE OR REPLACE FUNCTION public.fn_gate_depunere()'), RB2.indexOf('CREATE OR REPLACE FUNCTION public.fn_ofertare_pt_pachet_poarta_documentatie()')))
await db.exec(`CREATE TRIGGER trg_gate_depunere BEFORE UPDATE ON public.ofertare_licitatii FOR EACH ROW EXECUTE FUNCTION fn_gate_depunere();`)
// ─── R9b: testele decisive Copilot (ADDENDUM 5) pe migrarea 2 a lui Jakarinos ───
const md5 = async t => (await q(`SELECT md5(coalesce(string_agg(to_jsonb(x)::text, ',' ORDER BY x.id), '')) h FROM ${t} x`))[0].h
await db.exec(`ALTER TABLE ofertare_clarificari ADD COLUMN IF NOT EXISTS raspuns text, ADD COLUMN IF NOT EXISTS raspuns_la date, ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(), ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(), ADD COLUMN IF NOT EXISTS fisier_path text, ADD COLUMN IF NOT EXISTS origine text, ADD COLUMN IF NOT EXISTS creat_de uuid, ADD COLUMN IF NOT EXISTS citita_la timestamptz, ADD COLUMN IF NOT EXISTS citita_rezumat text, ADD COLUMN IF NOT EXISTS raspuns_document_id bigint, ADD COLUMN IF NOT EXISTS cheie text`)
const h0 = { c: await md5('ofertare_cantitati'), k: await md5('ofertare_clarificari') }
await db.exec(MIG2)
ok(h0.c === await md5('ofertare_cantitati') && h0.k === await md5('ofertare_clarificari'), 'M: aplicarea migrării 2 nu schimbă cantități sau clarificări')
// U: contractul unităților (zero rânduri)
const U = await q(`WITH cazuri AS (
  SELECT unnest(ARRAY['m',' M' || chr(160),'m.','metri','metru','ml','ml.','m.l.','m.l','metri liniari','metru liniar']) um, '{"tip":"lungime","factor":1}'::jsonb asteptat
  UNION ALL SELECT 'km','{"tip":"lungime","factor":1000}'::jsonb UNION ALL SELECT 'hm','{"tip":"lungime","factor":100}'::jsonb
  UNION ALL SELECT unnest(ARRAY['mc','m cub','m3','m³','mp','m2','m²','ha','l','litri','buc','bucata','bucati','bucăți','buc.','bc','kg','t','to','h','ore','set','cpl']), '{"tip":"alta"}'::jsonb
  UNION ALL SELECT unnest(ARRAY[NULL::text,'',' ','100 m','sute m','xyz']), '{"tip":"de_verificat"}'::jsonb)
  SELECT um, public.ofertare_clasa_unitate(um) efectiv FROM cazuri WHERE public.ofertare_clasa_unitate(um) IS DISTINCT FROM asteptat`)
ok(U.length === 0, `U: clasa unităților SQL = contract (${JSON.stringify(U)})`)
const { clasaUnitate } = await import(WT + 'src/ofertareUnitati.js')
const setU = ['m','m.','metri','ml','m.l','metri liniari','km','hm','mc','mp','buc','kg','','100 m','xyz','M']
const par = []
for (const u of setU) { const s = (await q(`SELECT public.ofertare_clasa_unitate($1) x`, [u]))[0].x; const j = clasaUnitate(u); if (JSON.stringify(s) !== JSON.stringify(j)) par.push({ u, s, j }) }
ok(par.length === 0, `U: paritate JS↔SQL (${JSON.stringify(par)})`)
// Test 1 (A1): generatorul nu pune cantități / contoare în textul extern
for (const lic of [3, 95]) await q(`SELECT public.ofertare_clarificare_planse_auto($1)`, [lic])
const dr = await q(`SELECT id::int id, licitatie_id::int lic, status, intrebare FROM ofertare_clarificari WHERE cheie LIKE 'auto_planse_%' ORDER BY id`)
console.log('ciorne automate:', dr.length, dr.map(d => `${d.id}/${d.lic}/${d.status}`).join(' '))
const cifre = /\b\d[\d.]*(,\d+)?\s*(m|ml|km|hm|mc|mp|metri)\b|\btotal\b|\bpozi[țt]ii\b|\bsubtotal\b/i
for (const d of dr) ok(!cifre.test(d.intrebare || ''), `1: ciorna ${d.id} (lic ${d.lic}) fără cantități/total/contoare în text: ${(d.intrebare || '').match(cifre)?.[0] || '—'}`)
ok(dr.length > 0, '1: generatorul a creat cel puțin o ciornă de verificat')
// Test 2 (A3): reconfirmare + de_trimis; cantitatea schimbată ⇒ „schimbata”, trimiterea refuzată
const D = dr[0]
const st = async id => (await caUser(U_OF, () => q(`SELECT stare, amprenta_curenta FROM v_ofertare_clarificari_baza WHERE id = $1`, [id])))[0]
let s0 = await st(D.id); console.log('stare inițială', s0?.stare)
const rc = await caUser(U_OF, () => q(`SELECT public.ofertare_clarificare_reconfirma($1, $2, 'revizuit', 'verificat de om în test') r`, [D.id, s0?.amprenta_curenta]))
console.log('reconfirmare', JSON.stringify(rc[0]?.r))
const upd = async (id, set, par2 = []) => caUser(U_OF, async () => { try { await q(`UPDATE ofertare_clarificari SET ${set} WHERE id = $1`, [id, ...par2]); return 'ok' } catch (e) { return 'ERR ' + e.message } })
const r1 = await upd(D.id, `status = 'de_trimis'`)
ok(r1 === 'ok', `2: după reconfirmare pe baza curentă, „de trimis” e permis (${r1})`)
const rr = (await q(`SELECT id::int id, cantitate FROM ofertare_cantitati WHERE licitatie_id = $1 ORDER BY id LIMIT 1`, [D.lic]))[0]
await q(`UPDATE ofertare_cantitati SET cantitate = coalesce(cantitate,0) + 1 WHERE id = $1`, [rr.id])
const s1 = await st(D.id)
ok(s1?.stare === 'schimbata', `2: cantitate schimbată ⇒ baza „schimbata” (${s1?.stare})`)
const r2 = await upd(D.id, `status = 'trimisa'`)
ok(r2 !== 'ok', `2: trimiterea pe baza schimbată e refuzată (${r2.slice(0, 120)})`)
// Test 3 (A7): omul modifică cifra din text ⇒ aprobarea nu se transferă
const s2 = await st(D.id)
await caUser(U_OF, () => q(`SELECT public.ofertare_clarificare_reconfirma($1, $2, 'revizuit', 'reverificat după schimbare') r`, [D.id, s2?.amprenta_curenta]))
await upd(D.id, `status = 'de_trimis'`)
const r3 = await upd(D.id, `intrebare = intrebare || ' (123 m)'`)
const dupa = (await q(`SELECT status FROM ofertare_clarificari WHERE id = $1`, [D.id]))[0]
ok(r3 === 'ok' && dupa.status === 'propunere', `3: textul editat se salvează și pierde aprobarea (status ${dupa.status}, ${r3})`)
// Test 4 (C1–C3): TOTAL vs detalii
await db.exec(`INSERT INTO seap_compl VALUES (701, NULL) ON CONFLICT DO NOTHING; INSERT INTO ofertare_licitatii VALUES (701, '${U_OF}') ON CONFLICT DO NOTHING`)
const baseR = { licitatie_id: 701, obiect: 'Ob1', categorie: 'Conducte și montaj', tip_sursa: 'lista_f3', sursa: 'F3', status: 'validat' }
const ins = async (id, o) => q(`INSERT INTO ofertare_cantitati (${COLS}) SELECT ${COLS} FROM json_populate_record(null::ofertare_cantitati, $1::json)`, [JSON.stringify({ ...DATE.find(x => x.id === 2), ...baseR, id, ...o })])
await ins(701001, { denumire: 'TOTAL conducte', um: 'm', cantitate: 1200 })
await ins(701002, { denumire: 'Conductă PE Dn110', um: 'km', cantitate: 1 })
await ins(701003, { denumire: 'Conductă PE Dn90', um: 'hm', cantitate: 2 })
const tc = async () => JSON.stringify((await q(`SELECT public.ofertare_totaluri_control(701, 'cantitate') x`))[0].x)
const c1 = await tc(); ok(/"stare":"ok"/.test(c1), `4: TOTAL 1.200 m = 1 km + 2 hm ⇒ ok (${c1.slice(0, 160)})`)
await q(`UPDATE ofertare_cantitati SET cantitate = 1200.1 WHERE id = 701001`)
const stT = (await q(`SELECT status FROM ofertare_cantitati WHERE id = 701001`))[0].status
ok(stT !== 'validat', `4: TOTAL validat modificat ⇒ iese din validat (1b) (${stT})`)
const cInv = await tc(); ok(/"stare":"necomparabil"/.test(cInv), '4: TOTAL invalidat ⇒ necomparabil')
await caUser(U_OF, () => q(`UPDATE ofertare_cantitati SET status = 'validat' WHERE id = 701001`))
const c2 = await tc(); ok(/"stare":"diferit"/.test(c2) && /1200\.1/.test(c2), `4: TOTAL 1.200,1 ⇒ diferit, ambele valori păstrate (${c2.slice(0, 200)})`)
await q(`UPDATE ofertare_cantitati SET um = '100 m' WHERE id = 701003`)
const c3 = await tc(); ok(/"stare":"necomparabil"/.test(c3), `4: detaliu „100 m” ⇒ necomparabil (${c3.slice(0, 160)})`)
const cant701 = (await q(`SELECT cantitate FROM ofertare_cantitati WHERE id = 701001`))[0].cantitate
ok(Number(cant701) === 1200.1, '4: nicio valoare aleasă automat (TOTAL neschimbat)')
// Test 5 (D): scrierea F3 nu depinde de controlul clarificărilor; controlul indisponibil blochează finalizarea
const trg = await q(`SELECT tgname FROM pg_trigger WHERE tgname = 'trg_zzz_ofertare_cantitati_clar_baza'`)
ok(trg.length === 0, '5: triggerul de notificare pe scrierea F3 nu mai există')
const s5 = await st(D.id)
await caUser(U_OF, () => q(`SELECT public.ofertare_clarificare_reconfirma($1, $2, 'revizuit', 'aprobat pentru testul de export') r`, [D.id, s5?.amprenta_curenta]))
const a5 = await upd(D.id, `status = 'de_trimis'`); ok(a5 === 'ok', `5: ciorna aprobată înainte de test (${a5})`)
const ex0 = await caUser(U_OF, () => q(`SELECT public.ofertare_clarificari_export($1) x`, [D.lic])); console.log('export cu control disponibil:', JSON.stringify(ex0[0].x).slice(0, 140))
await db.exec(`ALTER FUNCTION public.ofertare_f3_baza(bigint) RENAME TO ofertare_f3_baza_off`)
const w5 = await caUser(U_OF, async () => { try { await q(`UPDATE ofertare_cantitati SET cantitate = coalesce(cantitate,0) + 1 WHERE id = $1`, [rr.id]); return 'ok' } catch (e) { return 'ERR ' + e.message } })
ok(w5 === 'ok', `5: cu controlul indisponibil, editarea cantității se salvează (${w5})`)
const hist = await q(`SELECT count(*)::int n FROM ofertare_cantitati_istoric WHERE cantitate_id = $1`, [rr.id])
console.log('istoric pe rând', hist[0].n)
const r5 = await upd(D.id, `status = 'trimisa'`)
ok(r5 !== 'ok', `5: controlul indisponibil ⇒ trecerea la „trimisă” refuzată (${r5.slice(0, 120)})`)
const ex5 = await caUser(U_OF, async () => { try { const r = await q(`SELECT public.ofertare_clarificari_export($1) x`, [D.lic]); return JSON.stringify(r[0].x).slice(0, 160) } catch (e) { return 'ERR ' + e.message } })
ok(/ERR|error|indisponibil|nu putem/i.test(ex5) || !ex5.includes(`"id":${D.id}`), `5: exportul cu controlul indisponibil nu include ciorna (${ex5})`)
await db.exec(`ALTER FUNCTION public.ofertare_f3_baza_off(bigint) RENAME TO ofertare_f3_baza`)
// Test 6 (E1): proveniența nu se poate reseta
const e1 = await upd(D.id, `cheie = NULL`); ok(e1 !== 'ok', `6: cheie = NULL refuzat (${e1.slice(0, 100)})`)
const e2 = await upd(D.id, `baza_generare = NULL`); ok(e2 !== 'ok', `6: baza_generare = NULL refuzat (${e2.slice(0, 100)})`)
const e3 = await upd(D.id, `intrebare = 'x', cheie = 'manual_x', status = 'trimisa'`); ok(e3 !== 'ok', `6: text + cheie + status în aceeași comandă refuzat (${e3.slice(0, 100)})`)

// ─── ADDENDUM Copilot (după 30/30): ordine, ciclul după transmitere, drepturi ───
await db.exec(`ALTER FUNCTION public.ofertare_f3_baza_off(bigint) RENAME TO ofertare_f3_baza`).catch(() => {})
const bz = async () => JSON.stringify((await q(`SELECT (public.ofertare_f3_baza($1)) - 'randuri' x`, [D.lic]))[0].x)
const b1 = await bz()
await q(`UPDATE ofertare_cantitati SET updated_at = now() + interval '1 day' WHERE licitatie_id = $1`, [D.lic])
ok(b1 === await bz(), 'O: doar timestamp-urile/ordinea schimbate ⇒ baza neschimbată')
// conflict deschis pe sursă + ciornă reconfirmată ⇒ aprobabilă (testul 2 a mers pe lic 95, care are conflicte deschise după migrare?)
const tcl = await caUser(U_OF, () => q('SELECT document_id::int document_id, stare, n FROM v_ofertare_transfer_conflicte WHERE licitatie_id = $1', [D.lic])); console.log('conflicte lic', D.lic, JSON.stringify(tcl.map(t => [t.document_id, t.stare, t.n])))
// drepturi: fără acces / editor fără drept de decizie
const sX = await st(D.id)
const txt0 = (await q(`SELECT intrebare, status, baza_generare::text b FROM ofertare_clarificari WHERE id = $1`, [D.id]))[0]
for (const [u, nume] of [[U_ALT, 'fără acces Ofertare'], [U_ED, 'editor fără drept de decizie']]) {
  const r = await caUser(u, async () => { try { return JSON.stringify((await q(`SELECT public.ofertare_clarificare_reconfirma($1, $2, 'revizuit', 'incercare fara drept') r`, [D.id, sX?.amprenta_curenta]))[0].r) } catch (e) { return 'ERR ' + e.message } })
  const ex = await caUser(u, async () => { try { return JSON.stringify((await q(`SELECT public.ofertare_clarificari_export($1) x`, [D.lic]))[0].x).slice(0, 80) } catch (e) { return 'ERR ' + e.message } })
  const tr = await caUser(u, async () => { try { await q(`UPDATE ofertare_clarificari SET status = 'de_trimis' WHERE id = $1`, [D.id]); return 'ok' } catch (e) { return 'ERR ' + e.message } })
  const dupa = (await q(`SELECT intrebare, status, baza_generare::text b FROM ofertare_clarificari WHERE id = $1`, [D.id]))[0]
  ok(!/"ok":true/.test(r) && JSON.stringify(dupa) === JSON.stringify(txt0), `D: ${nume} nu poate reconfirma; text/bază/status neschimbate (${r.slice(0, 90)} | status: ${tr.slice(0, 60)} | export: ${ex.slice(0, 60)})`)
}
// ciclul după transmitere: trimisa ⇒ text imuabil, datele schimbate nu o retrogradează
const s7 = await st(D.id)
await caUser(U_OF, () => q(`SELECT public.ofertare_clarificare_reconfirma($1, $2, 'revizuit', 'aprobat pentru transmitere') r`, [D.id, s7?.amprenta_curenta]))
const t1 = await upd(D.id, `status = 'de_trimis'`); const t2 = await upd(D.id, `status = 'trimisa'`)
ok(t2 === 'ok', `T: trimiterea pe baza curentă reconfirmată e permisă, cu conflictele sursei încă deschise (${t1} / ${t2})`)
const tE = await upd(D.id, `intrebare = intrebare || ' modificat'`)
ok(tE !== 'ok', `T: textul unei clarificări transmise nu se poate edita (${tE.slice(0, 90)})`)
await q(`UPDATE ofertare_cantitati SET cantitate = coalesce(cantitate,0) + 2 WHERE id = $1`, [rr.id])
const tS = (await q(`SELECT status FROM ofertare_clarificari WHERE id = $1`, [D.id]))[0].status
ok(tS === 'trimisa', `T: date-sursă schimbate după transmitere ⇒ clarificarea rămâne „trimisă” (${tS})`)
const tB = await upd(D.id, `status = 'propunere'`); ok(tB !== 'ok', `T: revenirea la propunere e refuzată (${tB.slice(0, 80)})`)

// R2: rollback păstrează deciziile umane
await db.exec(RB2)
const col = await q(`SELECT 1 FROM information_schema.columns WHERE table_name = 'ofertare_clarificari' AND column_name = 'baza_generare'`)
ok(col.length === 1, 'R2: după rollback coloana baza_generare (cu deciziile umane) rămâne')
await db.exec(MIG2); ok(true, 'R2: reaplicarea migrării 2 după rollback reușește')
console.log('eșecuri', esecuri, 'din', n)
