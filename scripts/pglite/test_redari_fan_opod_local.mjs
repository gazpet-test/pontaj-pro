// Proba LOCALĂ a migrării 20261227a (Redări FAN: oPOD ca alegere a owner-ului pe lot, implicit oprită) pe PGlite — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261212a_redari_fan_awb_schelet.sql + fn_red_nivel() EXACT din 20261126a + migrarea 20261212a aplicată ca
//   runnerul (tiparul test_redari_fan_awb_local.mjs), apoi 20261227a în forma livrării L15 v2 (manifestul generat cu ROLLBACK → livrarea aprobată
//   cu garda finală reală). Lista obiectelor din manifest = supabase/tests/20261227a_redari_fan_opod.l15.obiecte.tsv (`--scrie-obiecte` o regenerează).
// 0. Amprentele (corpul vechi al gărzii din 20261212a, corpul nou, RPC-ul nou) = constantele din migrare / revenire; revenirea repune corpul EXACT;
//    validatorul real al runnerului (5000 acceptat, 2000 / fără plafon refuzate; revenirea cu 2000).
// 1. Comportamentul, ca rolul authenticated cu JWT-ul fiecărui cont (valorile așteptate scrise de mână, L25): coloana implicit false pe rândurile
//    existente FĂRĂ aprobare, true pe lotul aprobat + generat ÎNAINTE de migrare (istoric: codul trimitea mereu B — Jakarinos #1135 r1 P2) +
//    marcajul de instalare în red_jurnal (lista loturilor deduse); doar owner-ul alege (editor / viewer / anonim refuzați); doar pe lot marcat;
//    NULL refuzat; repetarea = no-op fără jurnal; fiecare schimbare = un rând în red_jurnal (vechi → nou, autorul, momentul); după PRIMA aprobare
//    refuz prin RPC (și după re-propunere) ȘI prin trigger pe calea directă (proprietarul tabelului); UPDATE direct ca authenticated refuzat;
//    marcajul TEST / real păzit la fel ca înainte. CURSA „schimbare înaintea unei aprobări întârziate cu hash-ul vechi” (verdictul r1): starea BD
//    după ea + recuperarea prin re-propunere (excluderea de la generare e în funcția edge: fanCourier.test.js).
// 2. Refuzurile migrării (marcaj, plafon, amprenta globală lipsă, baza fără 20261212a, garda schimbată înainte, reaplicare, istoric existent,
//    marcaj de instalare dezechilibrat, funcție în plus, lock ocupat) — nimic schimbat.
// 3. Revenirea (L14): trece pe aplicarea NEFOLOSITĂ chiar cu lotul dedus true (date preexistente) → re-aplicare; refuză la ORICE folosire de după
//    aplicare: lot nou aprobat cu implicitul false, rând nou aprobat pe lotul vechi, oPOD ales de owner / istoric opod_schimbat, true fără jurnal,
//    marcaj de instalare lipsă; plus fără migrare / funcție în plus / fără marcajul runnerului / plafon greșit. Mutanți ai REVENIRII: fiecare
//    verificare scoasă lasă scenariul ei să treacă (dovada că scenariul testează exact acea verificare).
// 4. MUTANȚI ai migrării (cu amprentele proprii recalculate, ca autoverificarea să nu-i prindă singură): fiecare TREBUIE să pice în verificări.
// Runda 3 (verdictul Jakarinos pe f4d1fd46, P2): trigger-ul de jurnal al aprobărilor (fn_red_fan_awb_opod_jurnal: eveniment 'opod_aprobare' la
//    fiecare trecere în 'aprobat', pe RPC, UPDATE direct și INSERT direct; nimic la propunere / re-propunere / claim), verificat în `verificari`;
//    revenirea refuză scenariul recenzentului (lot dedus true → aprobare nouă pe alt plic → RE-PROPUNERE → revenire) DOAR prin jurnal (nici (3), nici
//    (4) nu-l văd); mutanții revenirii au scenarii prinse de EXACT o verificare. OPOD_SQL_DIN=<sha>: migrarea + revenirea se citesc din acel commit
//    (git show) — dovada că scenariile noi PICĂ pe forma de dinainte (f4d1fd46).
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_redari_fan_opod_local.mjs
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LOCAL_PGLITE = join(ROOT, '.tmp', 'pglite', 'node_modules', '@electric-sql', 'pglite')
const { PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(join(resolve(process.env.PGLITE_DIR), 'dist', 'index.js')).href
  : existsSync(LOCAL_PGLITE) ? pathToFileURL(join(LOCAL_PGLITE, 'dist', 'index.js')).href : '@electric-sql/pglite')
const TMP = mkdtempSync(join(tmpdir(), 'fan_opod_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const F_MIG = 'supabase/migrations/20261227a_redari_fan_opod.sql', F_REV = 'supabase/revenire/20261227a_redari_fan_opod_ROLLBACK.sql'
const F_OBIECTE = 'supabase/tests/20261227a_redari_fan_opod.l15.obiecte.tsv'
const SCHELET = citeste('supabase/tests/20261212a_redari_fan_awb_schelet.sql')
const M12 = citeste('supabase/migrations/20261212a_redari_fan_awb.sql')
// OPOD_SQL_DIN=<sha>: fișierele SQL ale migrării / revenirii din alt commit (proba „scenariile noi pică pe forma veche”); altfel arborele de lucru
const dinGit = rel => execFileSync('git', ['show', `${process.env.OPOD_SQL_DIN}:${rel}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\r/g, '')
const MIG = process.env.OPOD_SQL_DIN ? dinGit(F_MIG) : citeste(F_MIG)
const REV = process.env.OPOD_SQL_DIN ? dinGit(F_REV) : citeste(F_REV)
if (process.env.OPOD_SQL_DIN) console.log(`ATENȚIE: migrarea și revenirea se citesc din commitul ${process.env.OPOD_SQL_DIN} (OPOD_SQL_DIN), nu din arborele de lucru`)
const OBIECTE = existsSync(join(ROOT, F_OBIECTE)) ? citeste(F_OBIECTE) : ''
const M26 = citeste('supabase/migrations/20261126a_redari_teren.sql')
const NIVEL = (() => {
  const i = M26.indexOf('CREATE FUNCTION public.fn_red_nivel() RETURNS text')
  const j = M26.indexOf('$fn$;', M26.indexOf('$fn$', i) + 4) + 5
  if (i < 0 || j < 5) throw new Error('nu găsesc fn_red_nivel în 20261126a')
  return M26.slice(i, j) + '\nREVOKE EXECUTE ON FUNCTION public.fn_red_nivel() FROM PUBLIC, anon, authenticated, service_role;\n'
    + 'GRANT EXECUTE ON FUNCTION public.fn_red_nivel() TO authenticated, service_role;\n'
})()
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const PLAFON_LIVRARE = Number(execFileSync('bash', ['-c', '. "$1"; printf %s "$AG_PLAFON_MS"', '_', join(ROOT, 'scripts/livrare_amprenta.sh')], { encoding: 'utf8' }))
const PLAFON_REVENIRE = 2000
const garda = (nume, plafon, final) => execFileSync('bash', ['-c', '. "$1"; lm_fin "$2" "$3" "$4" lock', '_', join(ROOT, 'scripts/livrare_mesaj.sh'), nume, String(plafon), final], { encoding: 'utf8' })
const validator = (fisier, ...opt) => {
  try {
    return { ok: true, out: execFileSync('bash', ['-c', 'exec python3 "$@"', '_', join(ROOT, 'scripts/livrare_validator.py'), fisier, 'reg_0123456789abcdef', ...opt],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  } catch (e) { return { ok: false, out: String(e.stdout || '') + String(e.stderr || e.message) } }
}
/** corpul (prosrc) unei funcții din textul unei migrări: ce e între $tag$ … $tag$ după `cap` */
function corp(text, cap) {
  const i = text.indexOf(cap)
  if (i < 0) throw new Error('nu găsesc ' + cap)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(text.slice(i))
  const start = i + a.index + a[0].length
  return text.slice(start, text.indexOf(a[1], start))
}
const corpSauNul = (text, cap) => { try { return corp(text, cap) } catch { return null } }

let esec = 0
const ok = (c, m) => { if (c) console.log('  OK  ' + m); else { esec++; console.log('  NU  ' + m) } }

console.log('0. amprentele + validatorul runnerului pe fișierele exacte')
const GARDA_VECHE = md5(corp(M12, 'CREATE FUNCTION public.fn_red_fan_loturi_garda()'))
const GARDA_NOUA = md5(corp(MIG, 'CREATE OR REPLACE FUNCTION public.fn_red_fan_loturi_garda()'))
const OPOD_RPC = md5(corp(MIG, 'CREATE FUNCTION public.fn_red_fan_lot_opod('))
const JURNAL_CORP = corpSauNul(MIG, 'CREATE FUNCTION public.fn_red_fan_awb_opod_jurnal()')
const JURNAL_FN = JURNAL_CORP === null ? null : md5(JURNAL_CORP)
const blocGarda = t => t.slice(t.indexOf('-- >>> GARDA 20261227a'), t.indexOf('-- <<< GARDA 20261227a'))
ok(GARDA_VECHE === '1931e70c3b15a07a6ee485537f27ce93' && blocGarda(MIG).includes(`'${GARDA_VECHE}'`) && REV.includes(`'${GARDA_VECHE}'`), `garda din 20261212a: ${GARDA_VECHE} (în migrare, „inainte”, și în postcondiția revenirii)`)
ok(blocGarda(MIG).includes(`'${GARDA_NOUA}'`) && blocGarda(REV).includes(`'${GARDA_NOUA}'`), `garda nouă: ${GARDA_NOUA} (migrare „dupa” + revenire)`)
ok(REV.includes(`'${OPOD_RPC}'`), `fn_red_fan_lot_opod: ${OPOD_RPC} (revenirea cere exact corpul livrat)`)
// runda 3: trigger-ul de jurnal al aprobărilor — corpul livrat e cel cerut de revenire; SECURITY DEFINER (scrie în red_jurnal din orice context)
ok(JURNAL_FN !== null && REV.includes(`'${JURNAL_FN}'`), `fn_red_fan_awb_opod_jurnal: ${JURNAL_FN || 'LIPSĂ din migrare'} (revenirea cere exact corpul livrat)`)
ok(/CREATE FUNCTION public\.fn_red_fan_awb_opod_jurnal\(\) RETURNS trigger\nLANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp/.test(MIG)
  && /CREATE TRIGGER trg_red_fan_awb_opod_jurnal AFTER INSERT OR UPDATE OF stare ON public\.red_fan_awb FOR EACH ROW EXECUTE FUNCTION public\.fn_red_fan_awb_opod_jurnal\(\);/.test(MIG)
  && /DROP TRIGGER trg_red_fan_awb_opod_jurnal ON public\.red_fan_awb;\n  DROP FUNCTION public\.fn_red_fan_awb_opod_jurnal\(\);/.test(REV), 'trigger-ul de jurnal: AFTER INSERT OR UPDATE OF stare, FOR EACH ROW, funcție DEFINER; revenirea îl scoate cu funcția lui')
ok(corp(REV, 'CREATE OR REPLACE FUNCTION public.fn_red_fan_loturi_garda()') === corp(M12, 'CREATE FUNCTION public.fn_red_fan_loturi_garda()'), 'revenirea repune corpul EXACT al gărzii din 20261212a')
for (const dep of [['fn_red_fan_e_owner()', '941c20690f2ae0cda77869a1d865ea69'], ['fn_red_fan_lot_marcheaza(', '7ea87499188a0c7d6a7189b017fa4805'], ['fn_red_fan_aproba(', 'e584116e292d5a307041225b2ff27fbc'],
  ['fn_red_fan_claim_lot(', '2e10d8103f144fee46ceae430eff8f6f'], ['fn_red_fan_propune(', 'fa0e624dfc9d6a354914ce1da1784b64']]) {
  const m = md5(corp(M12, 'CREATE FUNCTION public.' + dep[0]))
  ok(m === dep[1] && MIG.includes(`'${m}'`), `dependența ${dep[0]} din 20261212a: ${m} = constanta din migrare`)
}
{
  const fm = join(ROOT, F_MIG), fr = join(ROOT, F_REV)
  ok(PLAFON_LIVRARE === 5000 && MIG.includes(`IS DISTINCT FROM '${PLAFON_LIVRARE}/session'`), `migrarea cere exact plafonul runnerului L15 v2 (${PLAFON_LIVRARE})`)
  const a = validator(fm, '--plafon-tranzactie-ms', '5000'), b = validator(fm, '--plafon-tranzactie-ms', '2000'), c = validator(fm, '--fara-plafon')
  ok(a.ok && /^OK \d+ /.test(a.out), 'migrarea trece validatorul cu 5000: ' + a.out)
  ok(!b.ok && /PLAFON_DIFERIT: fișierul cere 5000 ms/.test(b.out), 'migrarea cu runnerul la 2000 = refuz: ' + b.out.slice(0, 110))
  ok(!c.ok && /PLAFON_LIPSA/.test(c.out), 'migrarea fără plafon = refuz local: ' + c.out.slice(0, 110))
  const d = validator(fr, '--plafon-tranzactie-ms', '2000'), e = validator(fr, '--plafon-tranzactie-ms', '5000')
  ok(d.ok && /^OK \d+ /.test(d.out), 'revenirea trece validatorul cu plafonul ei (2000): ' + d.out)
  ok(!e.ok && /PLAFON_DIFERIT: fișierul cere 2000 ms/.test(e.out), 'revenirea cu 5000 = refuz: ' + e.out.slice(0, 110))
}

const ID = {
  owner: '00000000-0000-4000-8000-000000000001', editor: '00000000-0000-4000-8000-000000000002',
  viewer: '00000000-0000-4000-8000-000000000003', strain: '00000000-0000-4000-8000-000000000004', admin: '00000000-0000-4000-8000-000000000005',
  proiect: '10000000-0000-4000-8000-000000000001', lot1: '20000000-0000-4000-8000-000000000001', lot2: '20000000-0000-4000-8000-000000000002',
  lot3: '20000000-0000-4000-8000-000000000003', lot4: '20000000-0000-4000-8000-000000000004', lot5: '20000000-0000-4000-8000-000000000005',
}
const plicId = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const detId = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const H = c => c.repeat(64)
const DATE = `
  INSERT INTO public.profiles (id, name, is_owner) VALUES ('${ID.owner}', 'O', true), ('${ID.editor}', 'E', false), ('${ID.viewer}', 'V', false), ('${ID.strain}', 'X', false),
    ('${ID.admin}', 'A', false);
  INSERT INTO public.user_module_access VALUES ('${ID.editor}', 'redari', 'editor'), ('${ID.viewer}', 'redari', 'viewer'), ('${ID.admin}', 'redari', 'admin');
  INSERT INTO public.red_proiecte (id, cod) VALUES ('${ID.proiect}', 'TEST-PROIECT');
  INSERT INTO public.red_loturi_plicuire (id, proiect_id, nr_lot) VALUES ('${ID.lot1}', '${ID.proiect}', 'PP-0001'), ('${ID.lot2}', '${ID.proiect}', 'PP-0002'), ('${ID.lot3}', '${ID.proiect}', 'PP-0003'),
    ('${ID.lot4}', '${ID.proiect}', 'PP-0004'), ('${ID.lot5}', '${ID.proiect}', 'PP-0005');
  INSERT INTO public.red_plicuri (id, proiect_id, lot_id, nr_plic, destinatar_nume, stare) VALUES
    ('${plicId(1)}', '${ID.proiect}', '${ID.lot1}', 'PL-TST-0001', 'PERSOANA UNU', 'activ'), ('${plicId(2)}', '${ID.proiect}', '${ID.lot1}', 'PL-TST-0002', 'PERSOANA DOI', 'activ'),
    ('${plicId(4)}', '${ID.proiect}', '${ID.lot2}', 'PL-TST-0004', 'PERSOANA PATRU', 'activ'),
    ('${plicId(5)}', '${ID.proiect}', '${ID.lot4}', 'PL-TST-0005', 'PERSOANA CINCI', 'activ'), ('${plicId(6)}', '${ID.proiect}', '${ID.lot4}', 'PL-TST-0006', 'PERSOANA SASE', 'activ');
  INSERT INTO public.red_detinatori (id, nume) VALUES ('${detId(1)}', 'D1'), ('${detId(2)}', 'D2'), ('${detId(4)}', 'D4'), ('${detId(5)}', 'D5'), ('${detId(6)}', 'D6');
  INSERT INTO public.red_detinatori_contact (detinator_id, telefon, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal) VALUES
    ('${detId(1)}', '0700000001', 'Str. Fictivă nr. 1', 'Sat', 'Comuna', 'Prahova', '100000'), ('${detId(2)}', '0700000002', 'Str. Doi', NULL, 'Comuna Doi', 'Prahova', NULL),
    ('${detId(4)}', '0700000004', 'Str. Patru', 'Sat Patru', NULL, 'Dâmbovița', ''), ('${detId(5)}', '0700000005', 'Str. Cinci', NULL, 'Comuna Cinci', 'Prahova', '100005'),
    ('${detId(6)}', '0700000006', 'Str. Sase', NULL, 'Comuna Sase', 'Prahova', '100006');
  INSERT INTO public.red_convocari (detinator_id, plic_id, stare, sters_la) VALUES ('${detId(1)}', '${plicId(1)}', 'activ', NULL), ('${detId(2)}', '${plicId(2)}', 'activ', NULL), ('${detId(4)}', '${plicId(4)}', 'activ', NULL),
    ('${detId(5)}', '${plicId(5)}', 'activ', NULL), ('${detId(6)}', '${plicId(6)}', 'activ', NULL);`
// ISTORICUL de dinaintea lui 20261227a (codul trimitea MEREU B): lotul 4 (real) marcat, plicul 5 propus de editor (hash-ul „cu B”), aprobat de owner,
// apoi generat (claim + rezultat simulate pe calea proprietarului tabelului: in_curs → generat cu AWB, tarif 27,16 — exact AWB-ul real al Testului 1)
const LEGACY = `
  SELECT set_config('request.jwt.claim.sub', '${ID.owner}', false); SELECT public.fn_red_fan_lot_marcheaza('${ID.lot4}', false);
  SELECT set_config('request.jwt.claim.sub', '${ID.editor}', false); SELECT public.fn_red_fan_propune('${plicId(5)}', '${H('b')}', NULL);
  SELECT set_config('request.jwt.claim.sub', '${ID.owner}', false);
  SELECT public.fn_red_fan_aproba('${ID.lot4}', ARRAY[(SELECT id FROM public.red_fan_awb WHERE plic_id = '${plicId(5)}')], ARRAY['${H('b')}']);
  UPDATE public.red_fan_awb SET stare = 'generat', awb = '2000000005', cerere_id = gen_random_uuid(), generat_la = now(), tarif = 27.16, tva = 5.16, updated_at = now()
   WHERE plic_id = '${plicId(5)}';
  SELECT set_config('request.jwt.claim.sub', '', false);`
// varianta cu încă un rând APROBAT (nu generat) înainte de migrare, pe lotul 4: plicul 6, propus de editor și aprobat de owner cu hash-ul „cu B”
const LEGACY6 = `
  SELECT set_config('request.jwt.claim.sub', '${ID.editor}', false); SELECT public.fn_red_fan_propune('${plicId(6)}', '${H('b')}', NULL);
  SELECT set_config('request.jwt.claim.sub', '${ID.owner}', false);
  SELECT public.fn_red_fan_aproba('${ID.lot4}', ARRAY[(SELECT id FROM public.red_fan_awb WHERE plic_id = '${plicId(6)}')], ARRAY['${H('b')}']);
  SELECT set_config('request.jwt.claim.sub', '', false);`

// ca runnerul: plafon + marcaje + (opțional) pașii L15 v2 generați. l15: 'livrare' (înainte + după cu manifest), 'inainte', 'nimic'.
async function caRunner(db, nume, text, { plafon = PLAFON_LIVRARE, marcajPlafon = true, marcaj = true, l15 = 'inainte', aprobat = '-', manifest = '-', final = 'COMMIT' } = {}) {
  const pre = plafon ? `SET transaction_timeout = ${plafon};` : 'SET transaction_timeout = 0;'
  const mp = marcajPlafon ? `SELECT set_config('gazpet.plafon_tranzactie', '${plafon}:' || txid_current(), true);` : ''
  const mk = marcaj ? `SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);` : ''
  const T = randomBytes(8).toString('hex')
  const ina = l15 === 'nimic' ? '' : gen('inainte', T, aprobat)
  const dupa = l15 === 'livrare' ? gen('dupa', T, aprobat, manifest) : ''
  const jurnal = []
  try {
    await db.exec(pre)
    await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED; ${mk} ${mp}`)
    await db.exec(ina + '\n' + text + '\n;\n' + dupa, { onNotice: n => jurnal.push(n.message) })
    await db.exec(final, { onNotice: n => jurnal.push(n.message) })
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } e.jurnal = jurnal; throw e } finally { await db.exec('SET transaction_timeout = 0;') }
  return jurnal
}
const aplica12 = db => caRunner(db, '20261212a_redari_fan_awb', M12)
const aplicaMig = (db, text = MIG, o) => caRunner(db, '20261227a_redari_fan_opod', text, o)
const revino = (db, text = REV, o) => caRunner(db, '20261227a_redari_fan_opod_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 90))
    if (t.split(din).length !== 2) throw new Error('mutantul găsește textul de mai multe ori: ' + din.slice(0, 90))
    t = t.split(din).join(in_)
  }
  return t
}
// amprenta proprie a gărzii din migrare recalculată pe textul (mutat) — ca un mutant al gărzii să nu fie prins doar de autoverificarea „dupa”
const recalculeaza = t => {
  const m = md5(corp(t, 'CREATE OR REPLACE FUNCTION public.fn_red_fan_loturi_garda()'))
  const a = t.indexOf('-- >>> GARDA 20261227a'), b = t.indexOf('-- <<< GARDA 20261227a')
  return t.slice(0, a) + t.slice(a, b).replace(GARDA_NOUA, m) + t.slice(b)
}
// baza: schelet + fn_red_nivel + date + 20261212a aplicată; ÎNAINTE de 20261227a: lotul 2 marcat TEST, lotul 1 marcat real (fără aprobări → opod
// implicit false), lotul 4 marcat real + aprobat + generat (istoric cu B → opod dedus true)
async function bazaNoua({ cu12 = true, marcaj = true, legacy = true, plic6Aprobat = false } = {}) {
  const db = new PGlite()
  await db.exec(SCHELET)
  await db.exec(NIVEL)
  await db.exec(DATE)
  if (cu12) await aplica12(db)
  if (cu12 && marcaj) await db.exec(`SELECT set_config('request.jwt.claim.sub', '${ID.owner}', false); SELECT public.fn_red_fan_lot_marcheaza('${ID.lot2}', true); SELECT public.fn_red_fan_lot_marcheaza('${ID.lot1}', false);`)
  if (cu12 && marcaj && legacy) await db.exec(LEGACY)
  if (cu12 && marcaj && legacy && plic6Aprobat) await db.exec(LEGACY6)
  return db
}
const marcaje = async db => (await db.query(`SELECT id, actiune, inregistrare_id, date_vechi, date_noi FROM public.red_jurnal WHERE tabela = 'red_fan_loturi' AND date_noi ->> 'eveniment' IN ('opod_instalat', 'opod_dezinstalat') ORDER BY id`)).rows
// runda 3: evenimentele 'opod_aprobare' scrise de trigger-ul de jurnal (tabela red_fan_awb), în ordinea scrierii
const jurnalAprobari = async db => (await db.query(`SELECT id, actiune, inregistrare_id, date_vechi, date_noi, user_id FROM public.red_jurnal WHERE tabela = 'red_fan_awb' AND date_noi ->> 'eveniment' = 'opod_aprobare' ORDER BY id`)).rows
// apel ca rolul authenticated cu JWT-ul contului (uid null = anonim → rolul anon)
async function ca(db, uid, sql, params = []) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid || ''}', false);`)
  await db.exec(uid ? 'SET ROLE authenticated' : 'SET ROLE anon')
  try { return await db.query(sql, params) } finally { await db.exec('RESET ROLE') }
}
const cod = async p => { try { await p; return 'OK' } catch (e) { return e.code || String(e.message).slice(0, 60) } }
const val = async (db, sql, params = []) => (await db.query(sql, params)).rows[0]
const eroare = async p => { try { await p; return null } catch (e) { return e.message } }
const jurnalOpod = async db => (await db.query(`SELECT inregistrare_id, date_vechi, date_noi, user_id, actiune FROM public.red_jurnal WHERE tabela = 'red_fan_loturi' AND date_noi ->> 'eveniment' = 'opod_schimbat' ORDER BY id`)).rows

// fail: lista verificărilor picate (dată din afară, ca un mutant oprit de o excepție să-și păstreze verificările picate dinaintea ei)
async function verificari(db, log, fail = [], { nLoturi = 3 } = {}) {
  const ok = (c, m) => { if (!c) fail.push(m); if (log) console.log((c ? '  OK  ' : '  NU  ') + m) }
  const opod = (uid, lot, v) => ca(db, uid, 'SELECT public.fn_red_fan_lot_opod($1, $2) AS o', [lot, v])
  const rand = async lot => val(db, 'SELECT opod, test, prima_aprobare_la FROM public.red_fan_loturi WHERE lot_id = $1', [lot])
  // ── coloana: implicit false pe rândurile existente FĂRĂ aprobare (marcate înainte de migrare); ISTORICUL: lotul 4 (aprobat + generat înainte, cu B) = true ──
  ok((await rand(ID.lot2)).opod === false && (await rand(ID.lot1)).opod === false, 'loturile marcate ÎNAINTE de migrare, fără aprobare, au opod = false (fără oPOD = decizia din 09.11)')
  const l4 = await rand(ID.lot4)
  ok(l4.opod === true && l4.prima_aprobare_la !== null, 'lotul aprobat + generat ÎNAINTE de migrare (AWB-ul a plecat cu B) are opod = true (istoricul nu se falsifică)')
  ok((await val(db, 'SELECT count(*)::int AS n FROM public.red_fan_loturi WHERE opod')).n === 1, 'după aplicare DOAR lotul dedus din istoric are opod = true')
  ok((await val(db, `SELECT stare, awb, hash_date FROM public.red_fan_awb WHERE plic_id = $1`, [plicId(5)])).hash_date === H('b'), 'rândul generat înainte păstrează hash-ul aprobat (cu B); nimic rescris pe red_fan_awb')
  const mk = await marcaje(db)
  const ultim = mk.at(-1)
  ok(ultim?.date_noi?.eveniment === 'opod_instalat' && ultim.actiune === 'insert' && ultim.inregistrare_id === null && typeof ultim.date_noi.la === 'string'
    && JSON.stringify(ultim.date_noi.loturi_opod) === JSON.stringify([ID.lot4]) && ultim.date_noi.n_loturi === nLoturi && ultim.date_noi.n_opod === 1,
    `marcajul de instalare în red_jurnal: momentul aplicării + lista loturilor deduse true ([lot4]), ${nLoturi} loturi marcate, 1 cu oPOD: ` + JSON.stringify(ultim?.date_noi))
  // lotul dedus true e deja aprobat → alegerea lui nu se mai schimbă (nici spre false): istoricul rămâne
  ok(await cod(opod(ID.owner, ID.lot4, false)) === 'P0001' && (await rand(ID.lot4)).opod === true, 'lotul dedus true (aprobat înainte) nu se mai poate trece pe „fără oPOD” (P0001): istoricul rămâne')
  ok(await cod(db.query(`UPDATE public.red_fan_loturi SET opod = false WHERE lot_id = $1`, [ID.lot4])) === '42501', '… nici pe calea directă (trigger)')
  // ── poarta de rol + parametri ──
  ok(await cod(opod(ID.editor, ID.lot2, true)) === '42501', 'editor: alegerea oPOD refuzată (doar owner)')
  ok(await cod(opod(ID.admin, ID.lot2, true)) === '42501', 'admin Redări (ne-owner): refuzat')
  ok(await cod(opod(ID.viewer, ID.lot2, true)) === '42501' && await cod(opod(ID.strain, ID.lot2, true)) === '42501', 'viewer / cont fără drept: refuzați')
  // anonimul e refuzat ÎNAINTE de corp (fără EXECUTE: „permission denied for function”), nu de poarta owner din corp (discriminatorul mutantului cu GRANT anon)
  const anon = await eroare(opod(null, ID.lot2, true))
  ok(/permission denied for function fn_red_fan_lot_opod/.test(anon || ''), 'anonim: refuzat fără EXECUTE (înaintea corpului): ' + (anon || 'A TRECUT'))
  ok(await cod(opod(ID.owner, ID.lot2, null)) === '22023' && await cod(opod(ID.owner, null, true)) === '22023', 'NULL → 22023 (nu „fără oPOD”)')
  ok(await cod(opod(ID.owner, '20000000-0000-4000-8000-000000000099', true)) === 'P0002', 'lot inexistent → P0002')
  ok(await cod(opod(ID.owner, ID.lot3, true)) === 'P0001', 'lot NEmarcat (fără rând FAN) → P0001: marcajul TEST / real vine întâi')
  ok((await jurnalOpod(db)).length === 0 && (await rand(ID.lot2)).opod === false, 'după refuzuri: nimic schimbat, nimic în jurnal')
  // ── calea legitimă (owner, înainte de aprobare): true, no-op, false, true; jurnalul ──
  ok((await opod(ID.owner, ID.lot2, true)).rows[0].o === true && (await rand(ID.lot2)).opod === true, 'owner: oPOD cerut pe lotul 2 (TEST, neaprobat)')
  ok((await opod(ID.owner, ID.lot2, true)).rows[0].o === true && (await jurnalOpod(db)).length === 1, 'repetarea aceleiași valori = no-op, fără rând nou în jurnal')
  ok((await opod(ID.owner, ID.lot2, false)).rows[0].o === false && (await rand(ID.lot2)).opod === false, 'owner: renunțare la oPOD')
  ok((await opod(ID.owner, ID.lot2, true)).rows[0].o === true, 'owner: oPOD cerut din nou')
  const j = await jurnalOpod(db)
  ok(j.length === 3 && j.every(x => x.inregistrare_id === ID.lot2 && x.user_id === ID.owner && x.actiune === 'update' && typeof x.date_noi.la === 'string')
    && JSON.stringify(j.map(x => [x.date_vechi.opod, x.date_noi.opod])) === '[[false,true],[true,false],[false,true]]',
    'red_jurnal: fiecare schimbare (vechi → nou), lotul, autorul = auth.uid(), momentul; no-op-urile și refuzurile fără rânduri: ' + JSON.stringify(j.map(x => [x.date_vechi.opod, x.date_noi.opod])))
  ok((await rand(ID.lot2)).test === true && (await rand(ID.lot2)).prima_aprobare_la === null, 'marcajul și prima aprobare neatinse de alegerea oPOD')
  // ── calea directă: fără drept pentru authenticated; marcajul TEST / real păzit ca înainte ──
  ok(await cod(ca(db, ID.owner, `UPDATE public.red_fan_loturi SET opod = false WHERE lot_id = '${ID.lot2}'`)) === '42501', 'owner, UPDATE direct ca authenticated: refuzat (doar prin RPC)')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_lot_marcheaza($1, $2)', [ID.lot2, false])) === 'OK' && await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_lot_marcheaza($1, $2)', [ID.lot2, true])) === 'OK',
    'marcajul TEST / real se schimbă încă (înainte de aprobare), independent de oPOD')
  // ── după PRIMA aprobare: imuabil prin RPC și prin trigger (orice cale), și după re-propunere ──
  const propune = (uid, n, h) => ca(db, uid, 'SELECT public.fn_red_fan_propune($1, $2, NULL) AS id', [plicId(n), h])
  const r4 = (await propune(ID.editor, 4, H('a'))).rows[0].id
  ok(await cod(opod(ID.owner, ID.lot2, false)) === 'OK' && (await rand(ID.lot2)).opod === false, 'cu un plic DOAR propus (neaprobat) alegerea încă se schimbă (false)')
  ok(await cod(opod(ID.owner, ID.lot2, true)) === 'OK', '… și înapoi (true) — hash-urile propuse cu altă alegere se re-propun în ecran')
  // runda 3: până la prima aprobare de după aplicare, niciun eveniment 'opod_aprobare' (aprobarea legacy a lotului 4 a fost înaintea trigger-ului)
  ok((await jurnalAprobari(db)).length === 0, 'înainte de prima aprobare de după aplicare: niciun eveniment opod_aprobare (propunerea nu scrie; aprobarea legacy a fost înaintea trigger-ului)')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_aproba($1, $2, $3)', [ID.lot2, [r4], [H('a')]])) === 'OK' && (await rand(ID.lot2)).prima_aprobare_la !== null, 'owner: lotul 2 aprobat (prima aprobare consemnată)')
  // runda 3: aprobarea prin RPC = EXACT un eveniment 'opod_aprobare' cu rândul, lotul, alegerea oPOD a lotului în acel moment (true), hash-ul aprobat, autorul
  const ja = await jurnalAprobari(db)
  ok(ja.length === 1 && ja[0].inregistrare_id === r4 && ja[0].actiune === 'update' && ja[0].user_id === ID.owner && JSON.stringify(ja[0].date_vechi) === '{"stare":"propus"}'
    && ja[0].date_noi.lot_id === ID.lot2 && ja[0].date_noi.opod === true && ja[0].date_noi.hash_date === H('a') && typeof ja[0].date_noi.la === 'string',
    'aprobarea prin RPC scrie în red_jurnal evenimentul opod_aprobare (rândul, lotul, opod = true la aprobare, hash-ul, autorul = auth.uid()): ' + JSON.stringify(ja[0]?.date_noi))
  const nJ = (await jurnalOpod(db)).length
  ok(await cod(opod(ID.owner, ID.lot2, false)) === 'P0001' && (await rand(ID.lot2)).opod === true, 'DUPĂ prima aprobare: schimbarea oPOD refuzată prin RPC (P0001), valoarea rămâne cea aprobată')
  ok(await cod(opod(ID.owner, ID.lot2, true)) === 'OK' && (await jurnalOpod(db)).length === nJ, 'aceeași valoare după aprobare = no-op (nimic în jurnal)')
  ok(await cod(db.query(`UPDATE public.red_fan_loturi SET opod = false WHERE lot_id = $1`, [ID.lot2])) === '42501', 'calea directă (proprietarul tabelului): trigger-ul refuză schimbarea oPOD după prima aprobare')
  ok(await cod(db.query(`UPDATE public.red_fan_loturi SET test = false WHERE lot_id = $1`, [ID.lot2])) === '42501', 'trigger-ul păzește încă marcajul TEST / real')
  ok(await cod(db.query(`UPDATE public.red_fan_loturi SET marcat_la = now() WHERE lot_id = $1`, [ID.lot1])) === 'OK', 'lotul 1 (neaprobat): rândul se mai poate scrie (calea legitimă a gărzii, L20)')
  ok(await cod(db.query(`DELETE FROM public.red_fan_loturi WHERE lot_id = $1`, [ID.lot2])) === '42501', 'marcajul nu se șterge (trigger, neschimbat)')
  // re-propunerea readuce rândul la „propus”, dar prima aprobare e istorică → tot refuz
  ok(await cod(propune(ID.editor, 4, H('a'))) === 'OK' && (await val(db, 'SELECT stare FROM public.red_fan_awb WHERE id = $1', [r4])).stare === 'propus', 're-propunere: rândul redevine propus')
  // runda 3: re-propunerea șterge aprobat_la, dar evenimentul rămâne (jurnal append-only) — dovada durabilă pe care o citește revenirea
  ok((await val(db, 'SELECT aprobat_la FROM public.red_fan_awb WHERE id = $1', [r4])).aprobat_la === null && (await jurnalAprobari(db)).length === 1,
    're-propunerea șterge aprobat_la de pe rând, dar NU scrie și nu șterge evenimente: opod_aprobare rămâne 1 (dovada durabilă a aprobării)')
  ok(await cod(opod(ID.owner, ID.lot2, false)) === 'P0001', 'după re-propunere: alegerea oPOD rămâne blocată (prima aprobare e istorică)')
  // lotul 1 (REAL, neaprobat): oPOD se poate cere și pe un lot real
  ok(await cod(opod(ID.owner, ID.lot1, true)) === 'OK' && (await rand(ID.lot1)).opod === true, 'lot real neaprobat: oPOD cerut (alegerea e a owner-ului, nu a marcajului)')
  ok(await cod(opod(ID.owner, ID.lot1, false)) === 'OK', 'lot real: renunțare (înapoi la implicit)')
  // tirajul și restul coloanelor nu sunt în gardă (ca înainte): un UPDATE pe tiraj_* după aprobare trece prin CHECK-urile lui, nu prin gardă
  ok(await cod(db.query(`UPDATE public.red_fan_loturi SET tiraj_cheie = $2, tiraj_nr = 1, tiraj_la = now(), tiraj_de = $3 WHERE lot_id = $1`, [ID.lot2, H('1'), ID.owner])) === 'OK', 'tirajul nu e acoperit de gardă (neschimbat față de 20261212a)')
  // ── runda 3: jurnalul aprobărilor pe ORICE cale (L07): UPDATE direct ca postgres (fără JWT → autor NULL) și INSERT direct al unui rând deja aprobat;
  //    claim-ul (aprobat → in_curs) nu scrie; nimic la re-propunere (mai sus) ──
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`)
  ok(await cod(db.query(`UPDATE public.red_fan_awb SET stare = 'aprobat', aprobat_de = $2, aprobat_la = now(), updated_at = now() WHERE id = $1`, [r4, ID.owner])) === 'OK'
    && (await jurnalAprobari(db)).length === 2 && (await jurnalAprobari(db))[1].user_id === null && (await jurnalAprobari(db))[1].date_noi.lot_id === ID.lot2,
    'UPDATE direct ca postgres (mentenanță, fără JWT) → eveniment opod_aprobare cu autor NULL (orice cale, L07)')
  const surse4 = (await val(db, 'SELECT public.fn_red_fan_surse($1) AS s', [plicId(4)])).s
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_claim_lot($1, $2, $3, $4)', [ID.lot2, [r4], [H('a')], [surse4]])) === 'OK' && (await jurnalAprobari(db)).length === 2,
    'claim-ul (aprobat → in_curs) nu scrie eveniment: doar trecerile ÎN aprobat')
  ok(await cod(db.query(`INSERT INTO public.red_fan_awb (proiect_id, lot_id, plic_id, nr_plic, hash_date, stare, propus_de, aprobat_de, aprobat_la)
      VALUES ($1, $2, $3, 'PL-TST-0002', $4, 'aprobat', $5, $5, now())`, [ID.proiect, ID.lot1, plicId(2), H('d'), ID.owner])) === 'OK'
    && (await jurnalAprobari(db)).length === 3 && (await jurnalAprobari(db))[2].actiune === 'insert' && (await jurnalAprobari(db))[2].date_vechi === null
    && (await jurnalAprobari(db))[2].date_noi.lot_id === ID.lot1 && (await jurnalAprobari(db))[2].date_noi.opod === false && (await jurnalAprobari(db))[2].date_noi.hash_date === H('d'),
    'INSERT direct al unui rând deja aprobat (lotul 1, opod false) → eveniment opod_aprobare (actiune insert, fără date_vechi, opod = false)')
  ok(await cod(db.query(`UPDATE public.red_jurnal SET date_noi = '{}'::jsonb WHERE tabela = 'red_fan_awb'`)) === '42501' && await cod(db.query(`DELETE FROM public.red_jurnal WHERE tabela = 'red_fan_awb'`)) === '42501',
    'evenimentele nu se pot rescrie / șterge (red_jurnal append-only, trigger-ul din 20261126a)')
  return fail
}

// ── manifestul L15: lista obiectelor (familie, etichetă, operație) din fișierul revizuit = diferența generată de pașii runnerului ──
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
const faraPg18 = l => !/^constrangere\tconstrangere tabel [^\t]*_not_null\tcreat$/.test(l)

console.log('1. aplicarea ca la livrare (peste 20261212a; L15 v2: manifest generat, apoi livrarea aprobată) + comportamentul')
{
  const db = await bazaNoua()
  let jg = []
  try { jg = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: '-', manifest: '-', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message) }
  const G0 = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const gener = listaObiecte(manifest).filter(faraPg18), revizuit = listaObiecte(OBIECTE)
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, F_OBIECTE),
    '# 20261227a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n' + gener.join('\n') + '\n')
  const lipsa = revizuit.filter(x => !gener.includes(x)), plus = gener.filter(x => !revizuit.includes(x))
  ok(G0 && gener.length >= 3 && !lipsa.length && !plus.length, `manifestul generat (${gener.length} obiecte) = lista revizuită; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  console.log('     obiecte: ' + gener.map(x => x.split('\t').slice(1).join(' ')).join(' | '))
  const fManifest = join(TMP, '20261227a_redari_fan_opod.l15.tsv')
  writeFileSync(fManifest, manifest)
  const j = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: G0, manifest: fManifest, final: garda('20261227a_redari_fan_opod', PLAFON_LIVRARE, 'COMMIT') })
  ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)) && j.some(m => /sfarsit la \d+ ms de la BEGIN; lock-uri puternice tinute de \d+ ms/.test(m)),
    'livrarea aprobată: diferența = manifestul; ' + j.filter(m => /ms de la BEGIN/.test(m)).map(m => m.slice(0, 90)).join(' | '))
  ok(j.some(m => /^PLAFON_TIMP 20261227a_redari_fan_opod: garda trecuta la \d+ ms de la BEGIN \(plafon 5000 ms\)/.test(m)) && j.some(m => /^LOCK_TINUT 20261227a_redari_fan_opod: /.test(m))
    && j.some(m => /lock la \d+ ms de la BEGIN \(1 incercari, \d+ ms de la prima incercare\)/.test(m)), 'garda finală a runnerului: PLAFON_TIMP (5000) + LOCK_TINUT')
  ok(j.some(m => /^20261227a: istoric: 1 din 3 loturi marcate aveau o aprobare inainte \(opod = true, dedus: codul trimitea mereu B\); marcaj opod_instalat #\d+$/.test(m)),
    'NOTICE-ul deducerii istorice: 1 din 3 loturi, marcajul: ' + (j.find(m => /istoric:/.test(m)) || 'LIPSĂ'))
  esec += (await verificari(db, true)).length
  let m = await eroare(aplicaMig(db))
  ok(/reaplicare/.test(m || ''), 'reaplicarea refuzată: ' + m)
  m = await eroare(revino(db))
  ok(/istoric opod_schimbat/.test(m || ''), 'revenirea refuză pe baza folosită (owner-ul a ales oPOD: istoric în jurnal): ' + m)
  ok((await val(db, `SELECT to_regprocedure('public.fn_red_fan_lot_opod(uuid, boolean)') IS NOT NULL AS e`)).e === true, 'după refuz, funcția există încă (tranzacția s-a anulat)')
  ok((await marcaje(db)).length === 1, 'refuzul revenirii nu lasă marcaj opod_dezinstalat (tranzacția s-a anulat)')
  // revenirea lui 20261212a e blocată cât 20261227a e aplicată (21 de funcții, nu 19)
  const REV12 = citeste('supabase/revenire/20261212a_redari_fan_awb_ROLLBACK.sql')
  m = await eroare(caRunner(db, '20261212a_redari_fan_awb_ROLLBACK', REV12, { l15: 'nimic', plafon: 2000 }))
  ok(/functii: .*fn_red_fan_lot_opod/.test(m || ''), 'revenirea lui 20261212a refuză cât 20261227a e aplicată (funcția în plus): ' + (m || '').slice(0, 120))
  await db.close()
}

console.log('2. refuzurile migrării (nimic schimbat)')
const LOCK_EXIT = '      LOCK TABLE public.red_fan_loturi IN ACCESS EXCLUSIVE MODE NOWAIT;\n      LOCK TABLE public.red_fan_awb IN SHARE ROW EXCLUSIVE MODE NOWAIT;\n      EXIT;\n'
for (const [nume, fn, re, baza] of [
  ['fără marcajul runnerului', db => aplicaMig(db, MIG, { marcaj: false }), /garda start invalida/],
  ['fără plafon', db => aplicaMig(db, MIG, { plafon: 0, marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['plafonul vechi (2000)', db => aplicaMig(db, MIG, { plafon: 2000 }), /PLAFON_TRANZACTIE lipsa: 2000\/session marcaj 2000:\d+ \(cerut 5000\/session/],
  ['fără amprenta globală L15 v2', db => aplicaMig(db, MIG, { l15: 'nimic' }), /AMPRENTA_GLOBALA_LIPSA/],
  ['baza fără 20261212a', db => aplicaMig(db), /tabelele din 20261212a/, { cu12: false }],
  ['garda schimbată înainte (alt corp)', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_fan_loturi_garda() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$ BEGIN RETURN NEW; END $f$;`)
    return aplicaMig(db)
  }, /difera de amprentele revizuite: public\.fn_red_fan_loturi_garda\(\)/],
  ['aprobarea schimbată înainte (dependență)', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_fan_aproba(p_lot_id uuid, p_ids uuid[], p_hashuri text[]) RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN 0; END $f$;`)
    return aplicaMig(db)
  }, /difera de amprentele revizuite: public\.fn_red_fan_aproba/],
  ['poarta de drept schimbată (fn_red_nivel)', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_nivel() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT 'admin'::text $f$;`)
    return aplicaMig(db)
  }, /difera de amprentele revizuite: public\.fn_red_nivel\(\)/],
  ['o funcție fn_red_fan_* în plus (baza nu e 20261212a)', async db => { await db.exec(`CREATE FUNCTION public.fn_red_fan_alta() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;`); return aplicaMig(db) }, /difera de 19/],
  ['istoric opod_schimbat deja în jurnal', async db => {
    await db.exec(`INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi) VALUES ('red_fan_loturi', '${ID.lot2}', 'update', '{"eveniment":"opod_schimbat","opod":true}');`)
    return aplicaMig(db)
  }, /are deja evenimente opod_schimbat/],
  ['marcaj opod_instalat fără dezinstalare (aplicată altundeva / coloana scoasă pe altă cale)', async db => {
    await db.exec(`INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi) VALUES ('red_fan_loturi', NULL, 'insert', '{"eveniment":"opod_instalat","la":"2026-11-18T10:00:00+00:00","loturi_opod":[]}');`)
    return aplicaMig(db)
  }, /marcajele de instalare .* nu sunt echilibrate/],
  // runda 3: evenimentele de aprobare le scrie doar trigger-ul migrării, iar revenirea nu trece cu ele → la aplicare nu pot exista
  ['istoric opod_aprobare deja în jurnal (aplicare fără revenire)', async db => {
    await db.exec(`INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi) VALUES ('red_fan_awb', '${plicId(5)}', 'update', '{"eveniment":"opod_aprobare","lot_id":"${ID.lot4}","opod":true}');`)
    return aplicaMig(db)
  }, /are deja evenimente opod_aprobare/],
  ['un trigger străin pe red_fan_awb (baza nu e 20261212a)', async db => {
    await db.exec(`CREATE FUNCTION public.fn_alt_trigger() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$; CREATE TRIGGER trg_alt AFTER UPDATE ON public.red_fan_awb FOR EACH ROW EXECUTE FUNCTION public.fn_alt_trigger();`)
    return aplicaMig(db)
  }, /red_fan_awb are deja un trigger al aplicatiei/],
  ['coloana red_fan_awb.updated_at lipsă (citită de revenire)', async db => { await db.exec('ALTER TABLE public.red_fan_awb DROP COLUMN updated_at'); return aplicaMig(db) }, /red_fan_awb\.updated_at lipseste/],
  ['coloana prima_aprobare_la lipsă', async db => { await db.exec('ALTER TABLE public.red_fan_loturi DROP COLUMN prima_aprobare_la'); return aplicaMig(db) }, /red_fan_loturi\.prima_aprobare_la lipseste/],
  ['lock ocupat permanent', db => aplicaMig(db, aplica(MIG, [[LOCK_EXIT, "      RAISE EXCEPTION 'coliziune simulata' USING ERRCODE = '55P03';\n" + LOCK_EXIT]])), /BUGET_LOCK: \d+ incercari, \d+ ms de la prima incercare/],
  ['lock obținut după termen, fără coliziune', db => aplicaMig(db, aplica(MIG, [[LOCK_EXIT, '      LOCK TABLE public.red_fan_loturi IN ACCESS EXCLUSIVE MODE NOWAIT;\n      LOCK TABLE public.red_fan_awb IN SHARE MODE NOWAIT;\n      PERFORM pg_sleep(1.05);\n      EXIT;\n']])),
    /BUGET_LOCK: lock-ul obtinut abia la \d+ ms de la prima incercare \(1 incercari/],
  // al doilea lock (red_fan_awb, SHARE) ocupat: primul se eliberează cu sub-tranzacția blocului și se reîncearcă amândouă până la buget
  ['lock-ul pe red_fan_awb ocupat permanent (scriitor FAN în zbor)', db => aplicaMig(db, aplica(MIG, [[LOCK_EXIT, "      LOCK TABLE public.red_fan_loturi IN ACCESS EXCLUSIVE MODE NOWAIT;\n      RAISE EXCEPTION 'coliziune simulata pe red_fan_awb' USING ERRCODE = '55P03';\n      LOCK TABLE public.red_fan_awb IN SHARE MODE NOWAIT;\n      EXIT;\n"]])),
    /BUGET_LOCK: \d+ incercari, \d+ ms de la prima incercare/],
]) {
  const db = await bazaNoua(baza || {})
  // (fn poate arunca sincron — ex. un mutant care nu găsește textul pe fișierele altui commit, OPOD_SQL_DIN — tot ca „picat”, nu ca oprire a probei)
  const m = await eroare((async () => fn(db))())
  const gol = (await val(db, `SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'red_fan_loturi' AND column_name = 'opod')
    AND to_regprocedure('public.fn_red_fan_lot_opod(uuid, boolean)') IS NULL AS g`)).g
  ok(m && re.test(m) && gol, `${nume}: ${m ? m.slice(0, 150) : 'A TRECUT'}`)
  await db.close()
}

console.log('1b. CURSA din verdictul r1: schimbarea alegerii înaintea unei aprobări întârziate cu hash-ul vechi → blocaj recuperabil prin re-propunere')
{
  // H('a') = hash-ul corpului FĂRĂ B (propus cât lotul era pe implicit), H('b') = hash-ul corpului CU B (recalculat după alegerea lotului)
  const db = await bazaNoua()
  await aplicaMig(db)
  const propune = (uid, n, h) => ca(db, uid, 'SELECT public.fn_red_fan_propune($1, $2, NULL) AS id', [plicId(n), h])
  const aproba = (ids, hs) => ca(db, ID.owner, 'SELECT public.fn_red_fan_aproba($1, $2, $3) AS n', [ID.lot2, ids, hs])
  const r4 = (await propune(ID.editor, 4, H('a'))).rows[0].id
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_lot_opod($1, true)', [ID.lot2])) === 'OK', '1. editorul a propus plicul 4 cu hash-ul „fără B”; owner-ul cere apoi oPOD pe lot (înainte de orice aprobare: permis, jurnal)')
  ok(await cod(aproba([r4], [H('a')])) === 'OK', '2. aprobarea ÎNTÂRZIATĂ cu hash-ul vechi („fără B”) e acceptată de BD (rândul are încă acel hash): BD-ul nu cunoaște conținutul hash-ului')
  const dupa = await val(db, 'SELECT l.opod, l.prima_aprobare_la IS NOT NULL AS aprobat, a.stare, a.hash_date FROM public.red_fan_loturi l JOIN public.red_fan_awb a ON a.lot_id = l.lot_id WHERE l.lot_id = $1', [ID.lot2])
  ok(dupa.opod === true && dupa.aprobat && dupa.stare === 'aprobat' && dupa.hash_date === H('a'), '3. starea BD după cursă: lotul cu oPOD = true ÎNGHEȚAT de prima aprobare, rândul aprobat cu hash-ul „fără B” (nepotrivire = BLOCAJ, nu expediere)')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_lot_opod($1, false)', [ID.lot2])) === 'P0001', '4. alegerea nu mai poate fi întoarsă pe „fără B” (P0001): nicio cale de a potrivi lotul cu hash-ul vechi')
  //    excluderea rândului de la generare (hash-ul recalculat cu alegerea lotului ≠ hash-ul aprobat → niciun claim, niciun POST) e probată în
  //    fanCourier.test.js („CURSA …”); claim-ul primește doar hash-urile recalculate de funcția edge, deci hash-ul vechi nu ajunge la el
  ok(await cod(propune(ID.editor, 4, H('b'))) === 'OK' && (await val(db, 'SELECT stare, hash_date, aprobat_la FROM public.red_fan_awb WHERE id = $1', [r4])).hash_date === H('b'),
    '5. recuperarea: re-propunerea cu corpul recalculat (cu B) readuce rândul la „propus” cu hash-ul nou (aprobarea veche anulată pe rând)')
  ok(await cod(aproba([r4], [H('a')])) === 'P0001', '6. o aprobare cu hash-ul vechi nu mai trece (P0001: rândul s-a schimbat de la previzualizare)')
  ok(await cod(aproba([r4], [H('b')])) === 'OK', '7. aprobarea cu hash-ul nou (cu B, = alegerea lotului) trece')
  const surse = (await val(db, 'SELECT public.fn_red_fan_surse($1) AS s', [plicId(4)])).s
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_claim_lot($1, $2, $3, $4)', [ID.lot2, [r4], [H('a')], [surse]])) === 'P0001', '8. claim-ul cu hash-ul vechi e refuzat (P0001), nimic rezervat')
  const c = await ca(db, ID.owner, 'SELECT public.fn_red_fan_claim_lot($1, $2, $3, $4) AS c', [ID.lot2, [r4], [H('b')], [surse]])
  ok(/^[0-9a-f-]{36}$/.test(c.rows[0].c) && (await val(db, 'SELECT stare FROM public.red_fan_awb WHERE id = $1', [r4])).stare === 'in_curs', '9. claim-ul cu hash-ul nou (= alegerea înghețată a lotului) rezervă rândul: expedierea pleacă DOAR cu opțiunea aprobată')
  await db.close()
}

console.log('3. revenirea (prin runner, plafonul 2000, fără amprentă globală)')
const aplicatCurat = async (o = {}) => { const db = await bazaNoua(o); await aplicaMig(db); return db }
const cere = (db, lot, v) => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${ID.owner}', false); SELECT public.fn_red_fan_lot_opod('${lot}', ${v});`)
const caSql = (uid, sql) => `RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', false); ${sql}`
// folosirea de DUPĂ aplicare: lotul 2 (implicit false) propus + aprobat; plicul 6 propus + aprobat pe lotul 4 (dedus true)
const aprobaLot2 = db => db.exec(caSql(ID.editor, `SELECT public.fn_red_fan_propune('${plicId(4)}', '${H('a')}', NULL);`)
  + caSql(ID.owner, `SELECT public.fn_red_fan_aproba('${ID.lot2}', ARRAY[(SELECT id FROM public.red_fan_awb WHERE plic_id = '${plicId(4)}')], ARRAY['${H('a')}']);`))
const aprobaPlic6 = db => db.exec(caSql(ID.editor, `SELECT public.fn_red_fan_propune('${plicId(6)}', '${H('b')}', NULL);`)
  + caSql(ID.owner, `SELECT public.fn_red_fan_aproba('${ID.lot4}', ARRAY[(SELECT id FROM public.red_fan_awb WHERE plic_id = '${plicId(6)}')], ARRAY['${H('b')}']);`))
// SCENARIUL RECENZENTULUI (Jakarinos #1135 r2 P2): lotul 4 (dedus true, în lista marcajului) → aprobare NOUĂ pe plicul 6 → RE-PROPUNERE (fn_red_fan_propune
// șterge aprobat_la, rândul redevine „propus”) → revenire. Nici (3) (lotul e în listă), nici (4) (aprobat_la = NULL, stare „propus”) nu văd nimic;
// DOAR evenimentul 'opod_aprobare' scris de trigger la aprobare (durabil) o oprește. Pe f4d1fd46 revenirea trecea.
const repropunePlic6 = async db => { await aprobaPlic6(db); await db.exec(caSql(ID.editor, `SELECT public.fn_red_fan_propune('${plicId(6)}', '${H('c')}', NULL);`)) }
// același tipar pe calea directă: rând INSERAT ca aprobat (mentenanță, postgres), apoi re-propus prin RPC — tot doar jurnalul îl vede
const insereazaAprobatRepropus = async db => {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);
    INSERT INTO public.red_fan_awb (proiect_id, lot_id, plic_id, nr_plic, hash_date, stare, propus_de, aprobat_de, aprobat_la)
      VALUES ('${ID.proiect}', '${ID.lot4}', '${plicId(6)}', 'PL-TST-0006', '${H('b')}', 'aprobat', '${ID.owner}', '${ID.owner}', now() - interval '1 hour');`)
  await db.exec(caSql(ID.editor, `SELECT public.fn_red_fan_propune('${plicId(6)}', '${H('c')}', NULL);`))
}
// fereastra reziduală din antetul migrării: un RPC de aprobare pornit ÎNAINTE de BEGIN-ul migrării și comis DUPĂ (now() mai vechi decât marcajul) —
// simulat prin retrodatarea aprobării (trigger-ul gărzii dezactivat doar pentru fixture; în producție prima_aprobare_la e imuabilă); evenimentul de
// jurnal rămâne (în producție trigger-ul există când UPDATE-ul lui rulează) → revenirea o prinde pe conținut (3) ȘI prin jurnal (6)
const retrodateaza = db => db.exec(`RESET ROLE; ALTER TABLE public.red_fan_loturi DISABLE TRIGGER trg_red_fan_loturi_garda;
    UPDATE public.red_fan_loturi SET prima_aprobare_la = now() - interval '1 hour' WHERE lot_id = '${ID.lot2}';
    UPDATE public.red_fan_awb SET aprobat_la = now() - interval '1 hour', updated_at = now() - interval '1 hour' WHERE lot_id = '${ID.lot2}';
    ALTER TABLE public.red_fan_loturi ENABLE TRIGGER trg_red_fan_loturi_garda;`)
const aprobaLot2Retro = async db => { await aprobaLot2(db); await retrodateaza(db) }
// apărarea în adâncime a lui (3): aceeași aprobare retrodatată, dar cu trigger-ul de jurnal DEZACTIVAT (mentenanță) → fără eveniment; DOAR (3) o vede
const aprobaLot2RetroFaraJurnal = async db => {
  await db.exec('RESET ROLE; ALTER TABLE public.red_fan_awb DISABLE TRIGGER trg_red_fan_awb_opod_jurnal;')
  await aprobaLot2(db)
  await db.exec('RESET ROLE; ALTER TABLE public.red_fan_awb ENABLE TRIGGER trg_red_fan_awb_opod_jurnal;')
  await retrodateaza(db)
}
// apărarea în adâncime a lui (4): rândul plicului 6 APROBAT ÎNAINTE de aplicare (baza cu plic6Aprobat) e GENERAT după aplicare (claim + rezultat
// simulate pe calea proprietarului): nicio trecere nouă în 'aprobat' → fără eveniment; lotul 4 e în listă → DOAR (4) (generat_la ≥ marcaj) o vede
const genereazaPlic6 = db => db.exec(`RESET ROLE; UPDATE public.red_fan_awb SET stare = 'generat', awb = '2000000006', cerere_id = gen_random_uuid(), generat_la = now(), updated_at = now()
   WHERE plic_id = '${plicId(6)}';`)
const trueFaraJurnal = db => db.exec(`RESET ROLE; UPDATE public.red_fan_loturi SET opod = true WHERE lot_id = '${ID.lot2}';`)
const faraMarcaj = db => db.exec(`RESET ROLE; ALTER TABLE public.red_jurnal DISABLE TRIGGER trg_red_jurnal_imuabil; DELETE FROM public.red_jurnal WHERE date_noi ->> 'eveniment' = 'opod_instalat'; ALTER TABLE public.red_jurnal ENABLE TRIGGER trg_red_jurnal_imuabil;`)
const RE_JURNAL = /\d+ aprobare\(i\) FAN dupa aplicarea migrarii \(jurnal opod_aprobare/
const SCENARII_REFUZ = [
  ['migrarea neaplicată', async () => {}, /starea nu e cea din 20261227a \(pasul 1, coloana opod\)/, { marcaj: true, fara27: true }],
  ['oPOD ales de owner pe un lot (jurnal opod_schimbat)', db => cere(db, ID.lot2, true), /istoric opod_schimbat/],
  ['istoric în jurnal (cerut, apoi renunțat: lotul e iar false)', async db => { await cere(db, ID.lot2, true); await cere(db, ID.lot2, false) }, /istoric opod_schimbat/],
  // L14 (Jakarinos #1135 r1 P2): lot NOU, cu implicitul false, aprobat după aplicare — nicio activare, niciun opod_schimbat, dar o decizie luată cu coloana
  ['lot nou cu implicitul false, propus + APROBAT după aplicare (fără opod_schimbat)', aprobaLot2, /1 lot\(uri\) aprobat\(e\) dupa aplicarea migrarii \(cu alegerea oPOD din coloana, implicit false\)/],
  ['aprobare „în zbor” comisă după aplicare cu now() dinaintea ei (fereastra reziduală): prinsă pe CONȚINUT, nu pe timp', aprobaLot2Retro, /1 lot\(uri\) aprobat\(e\) dupa aplicarea migrarii/],
  ['aprobare retrodatată cu trigger-ul de jurnal dezactivat (mentenanță): tot prinsă, pe conținut', aprobaLot2RetroFaraJurnal, /1 lot\(uri\) aprobat\(e\) dupa aplicarea migrarii/],
  ['rând nou aprobat după aplicare pe lotul dedus true (lotul vechi folosit din nou)', aprobaPlic6, /1 rand\(uri\) FAN aprobat\(e\) \/ rezervat\(e\) \/ generat\(e\) dupa aplicarea migrarii/],
  ['rând aprobat ÎNAINTE de aplicare pe lotul dedus true, GENERAT după (fără aprobare nouă)', genereazaPlic6, /1 rand\(uri\) FAN aprobat\(e\) \/ rezervat\(e\) \/ generat\(e\) dupa aplicarea migrarii/, { plic6Aprobat: true }],
  // runda 3 — scenariul recenzentului: lotul vechi → aprobare nouă → re-propunere (aprobat_la șters) → DOAR jurnalul o vede (pe f4d1fd46 TRECEA)
  ['RECENZENT r2: lot dedus true → aprobare nouă pe alt plic → RE-PROPUNERE → revenire = refuz (jurnal opod_aprobare)', repropunePlic6, RE_JURNAL],
  ['rând inserat direct ca aprobat (mentenanță), apoi re-propus: tot jurnalul îl vede', insereazaAprobatRepropus, RE_JURNAL],
  ['opod = true fără jurnal (calea directă a proprietarului tabelului, lot neaprobat)', trueFaraJurnal, /loturile cu opod = true difera de lista dedusa la aplicare/],
  ['marcajul de instalare lipsă (jurnalul golit cu trigger-ul dezactivat)', faraMarcaj, /marcajul de instalare \(opod_instalat\) lipseste sau e dezechilibrat/],
  ['o funcție fn_red_fan_* în plus', db => db.exec(`CREATE FUNCTION public.fn_red_fan_alta() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;`), /numarul functiilor fn_red_fan_\* difera de 21/],
  ['garda schimbată după aplicare', db => db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_fan_loturi_garda() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$ BEGIN RETURN NEW; END $f$;`),
    /starea nu e cea din 20261227a \(pasul 1, functii: public\.fn_red_fan_loturi_garda\(\)\)/],
  ['trigger-ul de jurnal dezactivat / scos (starea nu e cea livrată)', db => db.exec('ALTER TABLE public.red_fan_awb DISABLE TRIGGER trg_red_fan_awb_opod_jurnal;'), /trigger-ul de jurnal pe red_fan_awb/],
  ['încă un trigger pe red_fan_awb (altă stare decât cea livrată)', db => db.exec(`CREATE TRIGGER trg_alt AFTER UPDATE ON public.red_fan_awb FOR EACH ROW EXECUTE FUNCTION public.fn_red_fan_awb_opod_jurnal();`), /trigger-ul de jurnal pe red_fan_awb/],
  ['o vedere peste coloana opod', db => db.exec(`CREATE VIEW public.v_fan_opod AS SELECT lot_id, opod FROM public.red_fan_loturi;`), /alte obiecte depind/],
]
for (const [nume, pregateste, re, baza] of SCENARII_REFUZ) {
  const db = baza?.fara27 ? await bazaNoua() : await aplicatCurat(baza || {})
  const ef = await eroare((async () => pregateste(db))())   // fixture-ul picat (ex. trigger inexistent pe fișierele altui commit) = verificare picată, nu oprire
  if (ef !== null) { ok(false, `revenirea refuză: ${nume}: fixture-ul scenariului a picat: ${ef.slice(0, 120)}`); await db.close(); continue }
  const inainte = (await marcaje(db)).length
  const m = await eroare(revino(db))
  const neschimbat = baza?.fara27 ? (await val(db, `SELECT to_regprocedure('public.fn_red_fan_lot_opod(uuid, boolean)') IS NULL AS e`)).e
    : (await val(db, `SELECT to_regprocedure('public.fn_red_fan_lot_opod(uuid, boolean)') IS NOT NULL AS e`)).e
  ok(m && re.test(m) && neschimbat && (await marcaje(db)).length === inainte, `revenirea refuză: ${nume}: ${m ? m.slice(0, 150) : 'A TRECUT'}`)
  await db.close()
}
// MUTANȚI ai revenirii: cu verificarea scoasă, scenariul ei TRECE (= scenariul testează exact acea verificare, nu alta); pe revenirea reală refuză (mai sus)
for (const [nume, din, scenariu, baza] of [
  // (aprobarea obișnuită după aplicare e prinsă ȘI de verificarea pe timp ȘI de jurnal; cea retrodatată fără eveniment DOAR de cea pe conținut)
  ['fără verificarea „lot aprobat după aplicare” (conținut)', "RAISE EXCEPTION '20261227a revenire: % lot(uri) aprobat(e) dupa aplicarea migrarii (cu alegerea oPOD din coloana, implicit false) - refuz', v_n;", aprobaLot2RetroFaraJurnal],
  // (generarea unui rând aprobat înainte de aplicare: fără eveniment, lotul în listă → DOAR verificarea pe timp)
  ['fără verificarea „rânduri FAN după aplicare”', "RAISE EXCEPTION '20261227a revenire: % rand(uri) FAN aprobat(e) / rezervat(e) / generat(e) dupa aplicarea migrarii (%) - refuz', v_n, v_la;", genereazaPlic6, { plic6Aprobat: true }],
  ['fără verificarea „lista dedusă”', "RAISE EXCEPTION '20261227a revenire: loturile cu opod = true difera de lista dedusa la aplicare (marcaj #%) - refuz', v_marcaj.id;", trueFaraJurnal],
  ['fără verificarea „opod_schimbat”', "RAISE EXCEPTION '20261227a revenire: red_jurnal are istoric opod_schimbat (alegeri ale owner-ului dupa aplicare) - refuz (jurnalul nu se sterge)';", async db => { await cere(db, ID.lot2, true); await cere(db, ID.lot2, false) }],
  // runda 3: scenariul recenzentului e prins DOAR de jurnal
  ['fără verificarea „jurnal opod_aprobare”', "RAISE EXCEPTION '20261227a revenire: % aprobare(i) FAN dupa aplicarea migrarii (jurnal opod_aprobare: randuri aprobate cu alegerea oPOD din coloana, chiar daca re-propuse / anulate intre timp) - refuz (jurnalul nu se sterge)', v_n;", repropunePlic6],
]) {
  const db = await aplicatCurat(baza || {})
  const m = await eroare((async () => { await scenariu(db); return revino(db, aplica(REV, [[din, 'NULL;']])) })())
  ok(m === null, `mutantul revenirii „${nume}” lasă scenariul lui să treacă (deci scenariul testează exact verificarea)${m ? ': ' + m.slice(0, 120) : ''}`)
  await db.close()
}
for (const [nume, o, re] of [['fără marcajul runnerului', { marcaj: false }, /garda invalida/], ['plafonul livrărilor (5000)', { plafon: 5000 }, /PLAFON_TRANZACTIE lipsa: 5000/]]) {
  const db = await aplicatCurat()
  const m = await eroare(revino(db, REV, o))
  ok(m && re.test(m) && (await val(db, `SELECT to_regprocedure('public.fn_red_fan_lot_opod(uuid, boolean)') IS NOT NULL AS e`)).e, `revenirea refuză (runner): ${nume}: ${m}`)
  await db.close()
}
{
  const db = await aplicatCurat()
  // datele PREEXISTENTE nu opresc revenirea: lotul 4 e dedus true (aprobat + generat ÎNAINTE); un lot marcat după aplicare, dar neaprobat, e doar numărat
  await db.exec(caSql(ID.owner, `SELECT public.fn_red_fan_lot_marcheaza('${ID.lot5}', true);`) + 'RESET ROLE;')
  ok((await val(db, 'SELECT opod FROM public.red_fan_loturi WHERE lot_id = $1', [ID.lot4])).opod === true, 'înainte de revenire: lotul dedus din istoric are opod = true (dată preexistentă, nu folosire nouă)')
  const j = await revino(db)
  ok(j.some(m => /revenire: sfarsit la \d+ ms de la BEGIN \(marcaj #\d+, 1 loturi deduse la aplicare, 1 loturi marcate dupa, neaprobate\)/.test(m)),
    'revenirea pe aplicarea NEFOLOSITĂ trece, chiar cu lotul dedus true și cu un lot marcat (neaprobat) după: ' + (j.find(m => /revenire: sfarsit/.test(m)) || 'LIPSĂ'))
  const dupa = await val(db, `SELECT (SELECT count(*)::int FROM pg_proc WHERE proname LIKE 'fn_red_fan_%') AS n,
    (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.fn_red_fan_loturi_garda()')) AS g,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'red_fan_loturi' AND column_name = 'opod') AS col,
    (SELECT count(*)::int FROM pg_trigger WHERE tgrelid = 'public.red_fan_awb'::regclass AND NOT tgisinternal) AS trg`)
  ok(dupa.n === 19 && dupa.g === GARDA_VECHE && dupa.col === false && dupa.trg === 0, 'după revenire: 19 funcții, garda cu corpul 20261212a, coloana scoasă, niciun trigger pe red_fan_awb')
  // runda 3: după revenire o aprobare nu mai scrie eveniment (trigger-ul e scos), iar re-aplicarea nu găsește evenimente
  await db.exec(caSql(ID.editor, `SELECT public.fn_red_fan_propune('${plicId(6)}', '${H('b')}', NULL);`)
    + caSql(ID.owner, `SELECT public.fn_red_fan_aproba('${ID.lot4}', ARRAY[(SELECT id FROM public.red_fan_awb WHERE plic_id = '${plicId(6)}')], ARRAY['${H('b')}']);`) + 'RESET ROLE;')
  ok((await jurnalAprobari(db)).length === 0, 'după revenire, o aprobare (codul 20261212a) nu scrie opod_aprobare: trigger-ul nu mai există')
  const mk = await marcaje(db)
  ok(mk.length === 2 && mk[1].date_noi.eveniment === 'opod_dezinstalat' && mk[1].actiune === 'delete' && JSON.stringify(mk[1].date_vechi) === JSON.stringify(mk[0].date_noi)
    && mk[1].date_noi.marcaj_instalat === Number(mk[0].id) && mk[1].date_noi.loturi_marcate_dupa === 1,
    'jurnalul (append-only) are marcajul de dezinstalare cu marcajul de instalare în date_vechi; nimic șters: ' + JSON.stringify(mk[1]?.date_noi))
  ok((await val(db, `SELECT stare, awb FROM public.red_fan_awb WHERE plic_id = $1`, [plicId(5)])).awb === '2000000005', 'AWB-ul generat înainte rămâne neatins de revenire')
  ok(await cod(db.query(`UPDATE public.red_fan_loturi SET test = false WHERE lot_id = $1`, [ID.lot2])) === 'OK' && await cod(db.query(`UPDATE public.red_fan_loturi SET test = true WHERE lot_id = $1`, [ID.lot2])) === 'OK',
    'după revenire, lotul neaprobat se poate marca din nou pe calea directă a proprietarului (garda veche; readus la TEST)')
  const m = await eroare(aplicaMig(db))
  ok(m === null, 're-aplicarea după revenire trece (marcajele echilibrate)' + (m ? ': ' + m : ''))
  const mk2 = await marcaje(db)
  ok(mk2.length === 3 && mk2[2].date_noi.eveniment === 'opod_instalat' && JSON.stringify(mk2[2].date_noi.loturi_opod) === JSON.stringify([ID.lot4]) && mk2[2].date_noi.n_loturi === 4,
    'după re-aplicare: al treilea marcaj (instalat), aceeași deducere (lot4), 4 loturi marcate acum (lotul 5 marcat între cicluri)')
  // (rândul plicului 6, aprobat între cicluri sub codul 20261212a, e dată PREEXISTENTĂ pentru noua aplicare: lotul 4 rămâne dedus true, fără eveniment)
  const f = await verificari(db, false, [], { nLoturi: 4 })
  ok(f.length === 0, `comportamentul identic după re-aplicare (${f.length} abateri${f[0] ? ': ' + f[0] : ''})`)
  await db.close()
}

console.log('4. mutanți (amprentele proprii recalculate; fiecare trebuie să pice cel puțin o verificare)')
const MUTANTI = [
  ['garda nu păzește oPOD după aprobare', 'OR (OLD.prima_aprobare_la IS NOT NULL AND (NEW.test IS DISTINCT FROM OLD.test OR NEW.opod IS DISTINCT FROM OLD.opod\n', 'OR (OLD.prima_aprobare_la IS NOT NULL AND (NEW.test IS DISTINCT FROM OLD.test\n'],
  ['RPC-ul nu verifică prima aprobare', "  IF v_fl.prima_aprobare_la IS NOT NULL OR EXISTS (SELECT 1 FROM public.red_fan_awb WHERE lot_id = p_lot_id AND stare NOT IN ('propus', 'eroare', 'anulat')) THEN\n    RAISE EXCEPTION 'redari fan: lotul a fost aprobat o data; alegerea oPOD", "  IF false THEN\n    RAISE EXCEPTION 'redari fan: lotul a fost aprobat o data; alegerea oPOD"],
  ['RPC-ul verifică doar stările curente (nu istoricul)', '  IF v_fl.prima_aprobare_la IS NOT NULL OR EXISTS (SELECT 1 FROM public.red_fan_awb WHERE lot_id = p_lot_id', '  IF EXISTS (SELECT 1 FROM public.red_fan_awb WHERE lot_id = p_lot_id'],
  ['RPC-ul deschis oricui autentificat', "IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul alege oPOD'", "IF auth.uid() IS NULL THEN RAISE EXCEPTION 'redari fan: doar owner-ul alege oPOD'"],
  ['RPC-ul fără jurnal', "  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)\n  VALUES ('red_fan_loturi', p_lot_id, 'update', jsonb_build_object('opod', v_fl.opod),", "  PERFORM * FROM (\n  VALUES ('red_fan_loturi', p_lot_id, 'update', jsonb_build_object('opod', v_fl.opod),",
    "jsonb_build_object('eveniment', 'opod_schimbat', 'opod', p_opod, 'la', v_la), auth.uid());", "jsonb_build_object('eveniment', 'opod_schimbat', 'opod', p_opod, 'la', v_la), auth.uid())) x;"],
  ['jurnalul fără autor', "jsonb_build_object('eveniment', 'opod_schimbat', 'opod', p_opod, 'la', v_la), auth.uid());", "jsonb_build_object('eveniment', 'opod_schimbat', 'opod', p_opod, 'la', v_la), NULL);"],
  ['repetarea scrie în jurnal (fără no-op)', '  IF v_fl.opod = p_opod THEN RETURN p_opod; END IF;', '  IF false THEN RETURN p_opod; END IF;'],
  ['RPC-ul nu cere lotul marcat', "  IF v_fl.lot_id IS NULL THEN RAISE EXCEPTION 'redari fan: alege intai daca lotul e de TEST sau real (lot FAN nemarcat)' USING ERRCODE = 'P0001'; END IF;", '  IF v_fl.lot_id IS NULL THEN RETURN p_opod; END IF;'],
  ['EXECUTE și pentru anon', 'GRANT EXECUTE ON FUNCTION public.fn_red_fan_lot_opod(uuid, boolean) TO authenticated;', 'GRANT EXECUTE ON FUNCTION public.fn_red_fan_lot_opod(uuid, boolean) TO authenticated, anon;'],
  ['UPDATE direct permis', 'COMMENT ON COLUMN public.red_fan_loturi.opod IS', 'GRANT UPDATE (opod) ON public.red_fan_loturi TO authenticated;\nCOMMENT ON COLUMN public.red_fan_loturi.opod IS'],
  ['implicit PORNIT (oPOD pe toate loturile)', 'ALTER TABLE public.red_fan_loturi ADD COLUMN opod boolean NOT NULL DEFAULT false;', 'ALTER TABLE public.red_fan_loturi ADD COLUMN opod boolean NOT NULL DEFAULT true;'],
  // istoricul (Jakarinos #1135 r1 P2): fără deducere, lotul aprobat înainte ar apărea „fără oPOD” (fals); deducerea pe stările curente ar rata lotul aprobat cu rândurile re-propuse
  ['fără deducerea istorică (toate loturile vechi = false)', '   WHERE l.prima_aprobare_la IS NOT NULL\n      OR EXISTS (SELECT 1 FROM public.red_fan_awb a WHERE a.lot_id = l.lot_id AND a.stare <> \'propus\');\n  GET DIAGNOSTICS', '   WHERE false;\n  GET DIAGNOSTICS'],
  ['deducerea inversată (loturile fără aprobare = true)', '   WHERE l.prima_aprobare_la IS NOT NULL\n      OR EXISTS', '   WHERE l.prima_aprobare_la IS NULL\n      AND NOT EXISTS'],
  ['marcajul de instalare fără lista loturilor deduse', "'loturi_opod', (SELECT coalesce(jsonb_agg(lot_id ORDER BY lot_id), '[]'::jsonb) FROM public.red_fan_loturi WHERE opod),", "'loturi_opod', '[]'::jsonb,"],
  ['marcajul de instalare scris sub alt nume (revenirea nu l-ar găsi)', "jsonb_build_object('eveniment', 'opod_instalat', 'migrare'", "jsonb_build_object('eveniment', 'opod_pus', 'migrare'"],
  // runda 3: jurnalul aprobărilor (dovada durabilă citită de revenire) — fiecare slăbire e prinsă de verificările pe eveniment
  ['fără trigger-ul de jurnal al aprobărilor (forma f4d1fd46: aprobarea nu lasă urmă durabilă)', 'CREATE TRIGGER trg_red_fan_awb_opod_jurnal AFTER INSERT OR UPDATE OF stare ON public.red_fan_awb FOR EACH ROW EXECUTE FUNCTION public.fn_red_fan_awb_opod_jurnal();', ''],
  ['trigger-ul doar la UPDATE (rândul inserat direct ca aprobat scapă)', 'CREATE TRIGGER trg_red_fan_awb_opod_jurnal AFTER INSERT OR UPDATE OF stare ON public.red_fan_awb', 'CREATE TRIGGER trg_red_fan_awb_opod_jurnal AFTER UPDATE OF stare ON public.red_fan_awb'],
  ['evenimentul de aprobare sub alt nume (revenirea nu l-ar găsi)', "jsonb_build_object('eveniment', 'opod_aprobare', 'lot_id'", "jsonb_build_object('eveniment', 'aprobare_fan', 'lot_id'"],
  ['evenimentul de aprobare fără autor', "'hash_date', NEW.hash_date, 'la', now()), auth.uid());", "'hash_date', NEW.hash_date, 'la', now()), NULL);"],
  ['evenimentul de aprobare fără alegerea oPOD a lotului', "'opod', v_opod, 'hash_date'", "'opod', NULL, 'hash_date'"],
  ['evenimentul scris la orice schimbare de stare (și la re-propunere / claim)', "  IF NEW.stare = 'aprobat' AND (TG_OP = 'INSERT' OR OLD.stare IS DISTINCT FROM 'aprobat') THEN", '  IF true THEN'],
]
// mutanții trebuie prinși de VERIFICĂRI (comportament), nu doar de postcondițiile proprii ale migrării: postcondițiile se scot din textul mutat
const faraPost = t => { const a = t.indexOf('-- ── postcondiții ──'), b = t.indexOf('END $post$;') + 'END $post$;'.length; if (a < 0 || b < a) throw new Error('postcondițiile lipsesc'); return t.slice(0, a) + t.slice(b) }
for (const [nume, ...perechi] of MUTANTI) {
  const lista = []
  for (let i = 0; i < perechi.length; i += 2) lista.push([perechi[i], perechi[i + 1]])
  let m
  try { m = faraPost(recalculeaza(aplica(MIG, lista))) } catch (e) { ok(false, `mutantul „${nume}” nu se aplică exact o dată: ${e.message}`); continue }
  const f = []
  let db = null, laAplicare = null
  try { db = await bazaNoua(); await aplicaMig(db, m); await verificari(db, false, f) } catch (e) { laAplicare = e.code || e.message }
  finally { if (db) await db.close() }
  ok(f.length > 0, `mutant „${nume}” prins de verificări (${f.length} picate${f[0] ? ': ' + f[0] : ''})${laAplicare ? '; excepție: ' + String(laAplicare).slice(0, 90) : ''}`)
}

console.log(esec ? `\nREZULTAT: ${esec} verificări picate` : '\nREZULTAT: toate verificările au trecut')
process.exit(esec ? 1 : 0)
