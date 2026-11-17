// Proba LOCALĂ a migrării 20261212a (Redări → FAN Courier) pe PGlite (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261212a_redari_fan_awb_schelet.sql + fn_red_nivel() extrasă EXACT din 20261126a (corp + drepturi;
//   amprenta corpului = constanta din migrare, verificat).
// Aplicarea (runda 2 a PR #1118, forma livrării L15 v2, tiparul test_executie_uscare_local.mjs): ca runnerul — marcaj + plafon 5000
//   (AG_PLAFON_MS) + PAȘII L15 v2 GENERAȚI de scripts/livrare_amprenta_gen.sh: întâi generarea manifestului (GLOBAL „-”, ROLLBACK), apoi
//   livrarea cu GLOBAL-ul citit + manifestul generat și garda finală REALĂ a runnerului (lm_fin … lock). Lista obiectelor din manifest =
//   supabase/tests/20261212a_redari_fan_awb.l15.obiecte.tsv (revizuită; PG18 adaugă constrângerile NOT NULL, ignorate: producția e PG17;
//   `--scrie-obiecte` o regenerează). Revenirea: prin runner, plafonul ei (2000), fără amprenta globală.
// 0. Validatorul REAL al runnerului pe fișierele exacte (cu 5000 = acceptat, cu 2000 / fără plafon = refuz; revenirea cu 2000).
// 1. Comportamentul, ca rolul authenticated cu JWT-ul fiecărui cont (owner, editor, viewer, cont fără drept, anonim); valorile așteptate
//    sunt scrise de mână (L25): poarta de rol, marcajul de TEST imuabil după PRIMA aprobare (și după re-propunere), plafonul pilot, limita
//    de 100 la claim, amprenta surselor recalculată la claim (contact schimbat după citire = refuz), idempotența, CAS-ul rezultatelor,
//    reconcilierea, ridicarea (lot real vs test), urmărirea / confirmările cu versiune (rezultat vechi = depășit, nescris), anularea.
// 2. Refuzurile migrării (marcaj, plafon, amprenta globală lipsă, poarta de drept schimbată, coloană lipsă, bugetul lock-ului).
// 3. Revenirea: refuz cu date / lot marcat / setări schimbate / funcție în plus; aplicare → revenire → re-aplicare.
// 4. MUTANȚI ai migrării: fiecare TREBUIE să pice cel puțin o verificare.
// 5. Paritatea amprentei surselor JS (redariFan.mjs::textSursePlic / amprenteSurse) = SQL (fn_red_fan_surse), pe aceleași rânduri (L19).
// Ce NU probează PGlite (o singură conexiune): concurența reală (două sesiuni) — supabase/tests/20261212a_redari_fan_doua_sesiuni.sh, pe clonă.
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --prefix .tmp/pglite @electric-sql/pglite && node scripts/pglite/test_redari_fan_awb_local.mjs
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes, createHash, webcrypto } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
// PGlite: din PGLITE_DIR, din .tmp/pglite (ignorat de git) sau instalat normal
const LOCAL_PGLITE = join(ROOT, '.tmp', 'pglite', 'node_modules', '@electric-sql', 'pglite')
const { PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(join(resolve(process.env.PGLITE_DIR), 'dist', 'index.js')).href
  : existsSync(LOCAL_PGLITE) ? pathToFileURL(join(LOCAL_PGLITE, 'dist', 'index.js')).href : '@electric-sql/pglite')
const FAN = await import(pathToFileURL(join(ROOT, 'supabase/functions/_shared/redariFan.mjs')).href)
const TMP = mkdtempSync(join(tmpdir(), 'fan_awb_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const SCHELET = citeste('supabase/tests/20261212a_redari_fan_awb_schelet.sql')
const MIG = citeste('supabase/migrations/20261212a_redari_fan_awb.sql')
const REV = citeste('supabase/revenire/20261212a_redari_fan_awb_ROLLBACK.sql')
const OBIECTE = citeste('supabase/tests/20261212a_redari_fan_awb.l15.obiecte.tsv')
const M26 = citeste('supabase/migrations/20261126a_redari_teren.sql')
const md5 = s => createHash('md5').update(s).digest('hex')
const NIVEL = (() => {
  const i = M26.indexOf('CREATE FUNCTION public.fn_red_nivel() RETURNS text')
  const j = M26.indexOf('$fn$;', M26.indexOf('$fn$', i) + 4) + 5
  if (i < 0 || j < 5) throw new Error('nu găsesc fn_red_nivel în 20261126a')
  // drepturile ca în 20261126a §7: totul retras, EXECUTE pentru authenticated și service_role
  return M26.slice(i, j) + '\nREVOKE EXECUTE ON FUNCTION public.fn_red_nivel() FROM PUBLIC, anon, authenticated, service_role;\n'
    + 'GRANT EXECUTE ON FUNCTION public.fn_red_nivel() TO authenticated, service_role;\n'
})()
const CORP_NIVEL = NIVEL.slice(NIVEL.indexOf('$fn$') + 4, NIVEL.indexOf('$fn$', NIVEL.indexOf('$fn$') + 4))
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const PLAFON_LIVRARE = Number(execFileSync('bash', ['-c', '. "$1"; printf %s "$AG_PLAFON_MS"', '_', join(ROOT, 'scripts/livrare_amprenta.sh')], { encoding: 'utf8' }))
const PLAFON_REVENIRE = 2000
const garda = (nume, plafon, final) => execFileSync('bash', ['-c', '. "$1"; lm_fin "$2" "$3" "$4" lock', '_', join(ROOT, 'scripts/livrare_mesaj.sh'), nume, String(plafon), final], { encoding: 'utf8' })
const validator = (fisier, ...opt) => {
  try {
    // prin bash (ca runnerul): pe Windows „python3” din node ajunge la aliasul Magazinului, nu la interpretor
    return { ok: true, out: execFileSync('bash', ['-c', 'exec python3 "$@"', '_', join(ROOT, 'scripts/livrare_validator.py'), fisier, 'reg_0123456789abcdef', ...opt],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  } catch (e) { return { ok: false, out: String(e.stdout || '') + String(e.stderr || e.message) } }
}

let esec = 0
const ok = (c, m) => { if (c) console.log('  OK  ' + m); else { esec++; console.log('  NU  ' + m) } }

console.log('0. amprenta poartei de drept + validatorul runnerului pe fișierele exacte')
ok(md5(CORP_NIVEL) === '21db8e5d4b69b7f19e571a7087c361ae' && MIG.includes("'21db8e5d4b69b7f19e571a7087c361ae'"), 'fn_red_nivel: amprenta corpului din 20261126a = constanta din migrare: ' + md5(CORP_NIVEL))
{
  const fm = join(ROOT, 'supabase/migrations/20261212a_redari_fan_awb.sql'), fr = join(ROOT, 'supabase/revenire/20261212a_redari_fan_awb_ROLLBACK.sql')
  ok(PLAFON_LIVRARE === 5000 && MIG.includes(`IS DISTINCT FROM '${PLAFON_LIVRARE}/session'`) && MIG.includes(`IS DISTINCT FROM '${PLAFON_LIVRARE}:' || txid_current()`), `migrarea cere exact plafonul runnerului L15 v2 (${PLAFON_LIVRARE})`)
  const a = validator(fm, '--plafon-tranzactie-ms', '5000'), b = validator(fm, '--plafon-tranzactie-ms', '2000'), c = validator(fm, '--fara-plafon')
  ok(a.ok && /^OK \d+ /.test(a.out), 'migrarea trece validatorul cu 5000: ' + a.out)
  ok(!b.ok && /PLAFON_DIFERIT: fișierul cere 5000 ms/.test(b.out), 'migrarea cu runnerul la 2000 = refuz: ' + b.out.slice(0, 110))
  ok(!c.ok && /PLAFON_LIPSA/.test(c.out), 'migrarea fără plafon = refuz local: ' + c.out.slice(0, 110))
  const d = validator(fr, '--plafon-tranzactie-ms', '2000'), e = validator(fr, '--plafon-tranzactie-ms', '5000')
  ok(d.ok && /^OK \d+ /.test(d.out), 'revenirea trece validatorul cu plafonul ei (2000): ' + d.out)
  ok(!e.ok && /PLAFON_DIFERIT: fișierul cere 2000 ms/.test(e.out), 'revenirea cu 5000 = refuz: ' + e.out.slice(0, 110))
  // scriptul cu două sesiuni (rulat DOAR pe clonă, de coordonator): sintaxa întreagă (bash -n) + semnătura claim-ului din migrare
  const S2 = join(ROOT, 'supabase/tests/20261212a_redari_fan_doua_sesiuni.sh')
  let sn = null; try { execFileSync('bash', ['-n', S2], { stdio: ['ignore', 'pipe', 'pipe'] }) } catch (x) { sn = String(x.stderr || x.message) }
  const s2 = citeste('supabase/tests/20261212a_redari_fan_doua_sesiuni.sh')
  ok(sn === null && s2.includes("fn_red_fan_claim_lot(uuid, uuid[], text[], text[])") && MIG.includes('CREATE FUNCTION public.fn_red_fan_claim_lot(p_lot_id uuid, p_ids uuid[], p_hashuri text[], p_surse text[])')
    && ['K1', 'K2', 'S1', 'S2', 'U1', 'M1', 'R1'].every(k => s2.includes(`rez ok "${k} `)), 'scriptul cu două sesiuni: bash -n ' + (sn || 'OK') + '; scenariile K1 K2 S1 S2 U1 M1 R1 prezente')
}

const ID = {
  owner: '00000000-0000-4000-8000-000000000001', editor: '00000000-0000-4000-8000-000000000002',
  viewer: '00000000-0000-4000-8000-000000000003', strain: '00000000-0000-4000-8000-000000000004',
  proiect: '10000000-0000-4000-8000-000000000001', lot1: '20000000-0000-4000-8000-000000000001', lot2: '20000000-0000-4000-8000-000000000002',
  lot3: '20000000-0000-4000-8000-000000000003',
}
const plicId = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const detId = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const H = c => c.repeat(64)
const DATE = `
  INSERT INTO public.profiles (id, name, is_owner) VALUES ('${ID.owner}', 'O', true), ('${ID.editor}', 'E', false), ('${ID.viewer}', 'V', false), ('${ID.strain}', 'X', false);
  INSERT INTO public.user_module_access VALUES ('${ID.editor}', 'redari', 'editor'), ('${ID.viewer}', 'redari', 'viewer');
  INSERT INTO public.red_proiecte (id, cod) VALUES ('${ID.proiect}', 'TEST-PROIECT');
  INSERT INTO public.red_loturi_plicuire (id, proiect_id, nr_lot) VALUES ('${ID.lot1}', '${ID.proiect}', 'PP-0001'), ('${ID.lot2}', '${ID.proiect}', 'PP-0002'), ('${ID.lot3}', '${ID.proiect}', 'PP-0003');
  INSERT INTO public.red_plicuri (id, proiect_id, lot_id, nr_plic, destinatar_nume, stare) VALUES
    ('${plicId(1)}', '${ID.proiect}', '${ID.lot1}', 'PL-TST-0001', 'PERSOANA ȘTEFĂNESCU', 'activ'), ('${plicId(2)}', '${ID.proiect}', '${ID.lot1}', 'PL-TST-0002', 'PERSOANA DOI', 'activ'),
    ('${plicId(3)}', '${ID.proiect}', '${ID.lot1}', 'PL-TST-0003', 'PERSOANA TREI', 'activ'), ('${plicId(4)}', '${ID.proiect}', '${ID.lot2}', 'PL-TST-0004', 'PERSOANA PATRU', 'activ'),
    ('${plicId(5)}', '${ID.proiect}', '${ID.lot1}', 'PL-TST-0005', 'PERSOANA CINCI', 'anulat'), ('${plicId(6)}', '${ID.proiect}', NULL, 'PL-TST-0006', 'PERSOANA SASE', 'activ');
  INSERT INTO public.red_detinatori (id, nume) VALUES ('${detId(1)}', 'D1'), ('${detId(2)}', 'D2'), ('${detId(3)}', 'D3'), ('${detId(4)}', 'D4'), ('${detId(5)}', 'D5'), ('${detId(6)}', 'D6');
  INSERT INTO public.red_detinatori_contact (detinator_id, telefon, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal) VALUES
    ('${detId(1)}', '0700 000 001', 'Str. Fictivă nr. 1', 'Sat Ţâţa', 'Comuna Fictivă', 'Prahova', '100000'),
    ('${detId(2)}', '0700000002', 'Str. Doi', NULL, 'Comuna Doi', 'Prahova', NULL),
    ('${detId(3)}', NULL, 'Str. Trei', 'Sat Trei', NULL, 'Dâmbovița', '130000'),
    ('${detId(4)}', '0700000004', 'Str. Patru', 'Sat Patru', NULL, 'Dâmbovița', ''),
    ('${detId(6)}', '0700000006', 'Str. Șase', 'Sat', 'Com', 'Prahova', '100001');
  INSERT INTO public.red_convocari (detinator_id, plic_id, stare, sters_la) VALUES
    ('${detId(1)}', '${plicId(1)}', 'activ', NULL), ('${detId(1)}', '${plicId(1)}', 'activ', NULL),
    ('${detId(2)}', '${plicId(2)}', 'activ', NULL),
    ('${detId(4)}', '${plicId(3)}', 'activ', NULL), ('${detId(3)}', '${plicId(3)}', 'activ', NULL),
    ('${detId(5)}', '${plicId(4)}', 'activ', NULL),
    ('${detId(6)}', '${plicId(3)}', 'anulat', NULL), ('${detId(6)}', '${plicId(2)}', 'activ', now());`

async function bazaNoua() {
  const db = new PGlite()
  await db.exec(SCHELET)
  await db.exec(NIVEL)
  await db.exec(DATE)
  return db
}
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
const aplicaMig = (db, text = MIG, o) => caRunner(db, '20261212a_redari_fan_awb', text, o)
const revino = (db, text = REV, o) => caRunner(db, '20261212a_redari_fan_awb_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (t.split(din).length !== 2) throw new Error('mutantul nu se aplică exact o dată: ' + din.slice(0, 90))
    t = t.replace(din, in_)
  }
  return t
}

// apel ca rolul authenticated cu JWT-ul contului (uid null = anonim → rolul anon)
async function ca(db, uid, sql, params = []) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid || ''}', false);`)
  await db.exec(uid ? 'SET ROLE authenticated' : 'SET ROLE anon')
  try { return await db.query(sql, params) } finally { await db.exec('RESET ROLE') }
}
const cod = async p => { try { await p; return 'OK' } catch (e) { return e.code || String(e.message).slice(0, 60) } }
const val = async (db, sql, params = []) => (await db.query(sql, params)).rows[0]
const surse = async (db, n) => (await val(db, 'SELECT public.fn_red_fan_surse($1) AS s', [plicId(n)])).s

async function verificari(db, log) {
  const fail = []
  const ok = (c, m) => { if (!c) fail.push(m); if (log) console.log((c ? '  OK  ' : '  NU  ') + m) }
  const propune = (uid, n, h) => ca(db, uid, 'SELECT public.fn_red_fan_propune($1, $2, NULL) AS id', [plicId(n), h])
  const rand = async n => val(db, 'SELECT * FROM public.red_fan_awb WHERE plic_id = $1 AND stare NOT IN (\'eroare\', \'anulat\')', [plicId(n)])

  // ── drepturi directe și citire ──
  ok(await cod(ca(db, ID.editor, `INSERT INTO public.red_fan_awb (proiect_id, lot_id, plic_id, nr_plic, hash_date) VALUES ('${ID.proiect}', '${ID.lot1}', '${plicId(1)}', 'PL-TST-0001', '${H('a')}')`)) === '42501', 'editor: INSERT direct refuzat (42501)')
  ok(await cod(ca(db, ID.owner, 'UPDATE public.red_fan_setari SET limita_lot = 2000')) === '42501', 'owner: UPDATE direct pe setări refuzat (doar prin RPC)')
  ok(await cod(ca(db, null, 'SELECT * FROM public.red_fan_awb')) === '42501', 'anonim: citirea evidenței refuzată')
  ok(await cod(ca(db, null, 'SELECT public.fn_red_fan_aproba($1, $2, $3)', [ID.lot1, [plicId(1)], [H('a')]])) === '42501', 'anonim: aprobarea refuzată (fără EXECUTE)')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_e_owner()')) === '42501', 'fn_red_fan_e_owner nu e apelabilă din API')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_surse($1)', [plicId(1)])) === '42501', 'fn_red_fan_surse (internă) nu e apelabilă din API')

  // ── propunere (admin/editor) ──
  ok(await cod(propune(ID.viewer, 1, H('a'))) === '42501', 'viewer: propunerea refuzată')
  ok(await cod(propune(ID.strain, 1, H('a'))) === '42501', 'cont fără drept pe Redări: propunerea refuzată')
  ok(await cod(propune(ID.editor, 1, 'x')) === '22023', 'hash invalid → 22023')
  ok(await cod(propune(ID.editor, 5, H('a'))) === 'P0001', 'plic anulat → nu se propune')
  ok(await cod(propune(ID.editor, 6, H('a'))) === 'P0001', 'plic fără lot → nu se propune')
  for (const n of [1, 2, 3]) ok(await cod(propune(ID.editor, n, H('a'))) === 'OK', `editor: propune PL-TST-000${n}`)
  ok(await cod(propune(ID.editor, 4, H('b'))) === 'OK', 'editor: propune PL-TST-0004 (lotul 2)')
  ok((await ca(db, ID.viewer, 'SELECT count(*)::int AS n FROM public.red_fan_awb')).rows[0].n === 0, 'viewer: RLS ascunde evidența (0 rânduri)')
  ok((await ca(db, ID.editor, 'SELECT count(*)::int AS n FROM public.red_fan_awb')).rows[0].n === 4, 'editor: vede cele 4 rânduri')
  const r1 = await rand(1), r2 = await rand(2), r3 = await rand(3), r4 = await rand(4)
  ok(r1.stare === 'propus' && r1.propus_de === ID.editor && r1.urmarire_stare === 'neurmarit' && r1.confirmare_stare === 'nesolicitata' && r1.versiune_urmarire === 0, 'rândul nou: propus, autor = auth.uid(), urmărire implicită, versiunea 0')

  // ── marcaj + aprobare (owner); marcajul imuabil după PRIMA aprobare, chiar după re-propunere (runda 2 P2) ──
  const aproba = (uid, lot, ids, hs) => ca(db, uid, 'SELECT public.fn_red_fan_aproba($1, $2, $3) AS n', [lot, ids, hs])
  const marcheaza = (uid, lot, t) => ca(db, uid, 'SELECT public.fn_red_fan_lot_marcheaza($1, $2)', [lot, t])
  ok(await cod(aproba(ID.editor, ID.lot1, [r1.id], [H('a')])) === '42501', 'editor: aprobarea refuzată (doar owner)')
  ok(await cod(aproba(ID.owner, ID.lot1, [r1.id], [H('a')])) === 'P0001', 'owner: aprobare pe lot nemarcat (test/real) refuzată')
  ok(await cod(marcheaza(ID.editor, ID.lot1, false)) === '42501', 'editor: marcajul lotului refuzat')
  ok(await cod(marcheaza(ID.owner, ID.lot1, false)) === 'OK', 'owner: lotul 1 marcat REAL')
  ok(await cod(marcheaza(ID.owner, ID.lot1, true)) === 'OK' && await cod(marcheaza(ID.owner, ID.lot1, false)) === 'OK', 'înainte de aprobare marcajul se poate schimba (REAL → TEST → REAL)')
  ok(await cod(marcheaza(ID.owner, ID.lot2, true)) === 'OK', 'owner: lotul 2 marcat TEST')
  ok(await cod(aproba(ID.owner, ID.lot1, [r1.id], [H('c')])) === 'P0001', 'owner: hash diferit de previzualizare → refuz')
  ok(await cod(aproba(ID.owner, ID.lot1, [r1.id, r1.id], [H('a'), H('a')])) === '22023', 'listă cu duplicate → 22023')
  ok(await cod(aproba(ID.owner, ID.lot2, [r1.id], [H('a')])) === 'P0001', 'rândul altui lot → refuz')
  ok(await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_setari_seteaza(2)')) === '42501', 'editor: plafonul pilot refuzat')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_setari_seteaza(0)')) === '22023', 'plafon 0 → 22023')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_setari_seteaza(2)')) === 'OK', 'owner: plafon pilot = 2')
  ok(await cod(aproba(ID.owner, ID.lot1, [r1.id, r2.id, r3.id], [H('a'), H('a'), H('a')])) === 'P0001', 'pilot: 3 plicuri peste plafonul 2 → refuz, nimic aprobat')
  ok((await rand(1)).stare === 'propus' && (await val(db, 'SELECT prima_aprobare_la FROM public.red_fan_loturi WHERE lot_id = $1', [ID.lot1])).prima_aprobare_la === null, 'după refuzul pilot: rândul propus, lotul fără prima aprobare (atomic)')
  ok(await cod(aproba(ID.owner, ID.lot1, [r1.id, r2.id], [H('a'), H('a')])) === 'OK', 'pilot: 2 plicuri aprobate')
  const fl = await val(db, 'SELECT prima_aprobare_la, prima_aprobare_de FROM public.red_fan_loturi WHERE lot_id = $1', [ID.lot1])
  ok(fl.prima_aprobare_la && fl.prima_aprobare_de === ID.owner, 'prima aprobare a lotului consemnată (moment + owner)')
  ok(await cod(aproba(ID.owner, ID.lot1, [r3.id], [H('a')])) === 'P0001', 'pilot: al 3-lea plic în același lot → refuz (2 + 1 > 2)')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_setari_seteaza(20)')) === 'OK', 'owner: plafon înapoi la 20')
  // re-propunerea celor două aprobate (aprobat → propus): stările curente nu mai au nimic aprobat, dar ISTORICUL are → marcajul rămâne blocat
  ok(await cod(propune(ID.editor, 1, H('a'))) === 'OK' && await cod(propune(ID.editor, 2, H('a'))) === 'OK', 're-propunere: rândurile aprobate redevin propuse')
  ok((await rand(1)).stare === 'propus' && (await rand(2)).stare === 'propus', 'niciun rând aprobat în stările curente ale lotului 1')
  ok(await cod(marcheaza(ID.owner, ID.lot1, true)) === 'P0001', 'REAL → TEST după re-propunere = refuz (prima aprobare e istorică)')
  ok(await cod(db.query(`UPDATE public.red_fan_loturi SET test = true WHERE lot_id = $1`, [ID.lot1])) === '42501', 'și pe calea directă (proprietarul tabelului): trigger-ul refuză schimbarea marcajului')
  ok(await cod(db.query(`DELETE FROM public.red_fan_loturi WHERE lot_id = $1`, [ID.lot2])) === '42501', 'marcajul unui lot nu se șterge (trigger)')
  ok(await cod(aproba(ID.owner, ID.lot1, [r1.id, r2.id, r3.id], [H('a'), H('a'), H('a')])) === 'OK', 'cele 3 plicuri aprobate (plafon 20)')
  ok(await cod(aproba(ID.owner, ID.lot2, [r4.id], [H('b')])) === 'OK', 'lotul de test: aprobat')
  ok(await cod(marcheaza(ID.owner, ID.lot1, true)) === 'P0001', 'marcajul nu se mai schimbă după aprobare')
  ok(await cod(marcheaza(ID.owner, ID.lot1, false)) === 'OK', 'marcajul identic repetat = no-op')
  ok((await rand(1)).aprobat_de === ID.owner, 'aprobat_de = owner-ul (auth.uid())')

  // ── claim: limita de 100, hash, amprenta surselor (runda 2), idempotență ──
  const claim = (uid, lot, ids, hs, ss) => ca(db, uid, 'SELECT public.fn_red_fan_claim_lot($1, $2, $3, $4) AS c', [lot, ids, hs, ss])
  const s1 = await surse(db, 1), s2 = await surse(db, 2), s3 = await surse(db, 3), s4 = await surse(db, 4)
  const o101 = Array.from({ length: 101 }, (_, i) => `40000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
  ok(await cod(claim(ID.owner, ID.lot1, o101, o101.map(() => H('a')), o101.map(() => H('e')))) === '22023', 'claim cu 101 rânduri → 22023 (limita FAN de 100 pe solicitare)')
  ok(await cod(claim(ID.owner, ID.lot1, [r1.id], [H('a')], ['x'])) === '22023', 'claim cu amprenta surselor invalidă → 22023')
  ok(await cod(claim(ID.editor, ID.lot1, [r1.id], [H('a')], [s1])) === '42501', 'editor: claim refuzat')
  ok(await cod(claim(ID.owner, ID.lot1, [r1.id, r2.id], [H('a'), H('d')], [s1, s2])) === 'P0001', 'claim: un hash recalculat diferit → refuz total')
  // contactul plicului 2 se schimbă DUPĂ citirea funcției edge (amprenta s2 veche) → claim refuzat, nimic rezervat
  await db.query(`UPDATE public.red_detinatori_contact SET telefon = '0700000099' WHERE detinator_id = $1`, [detId(2)])
  ok(await cod(claim(ID.owner, ID.lot1, [r1.id, r2.id], [H('a'), H('a')], [s1, s2])) === 'P0001', 'CONTACT SCHIMBAT după citire: claim refuzat (amprenta surselor recalculată în tranzacția rezervării)')
  ok((await rand(1)).stare === 'aprobat' && (await rand(2)).stare === 'aprobat', 'după refuz, rândurile au rămas aprobate (nimic rezervat)')
  await db.query(`UPDATE public.red_detinatori_contact SET telefon = '0700000002' WHERE detinator_id = $1`, [detId(2)])
  // o convocare nouă (alt deținător) pusă în plicul 1 după citire → altă amprentă
  await db.query(`INSERT INTO public.red_convocari (detinator_id, plic_id) VALUES ($1, $2)`, [detId(6), plicId(1)])
  ok(await cod(claim(ID.owner, ID.lot1, [r1.id], [H('a')], [s1])) === 'P0001', 'deținător nou în plic după citire: claim refuzat')
  await db.query(`DELETE FROM public.red_convocari WHERE detinator_id = $1 AND plic_id = $2`, [detId(6), plicId(1)])
  const c1 = (await claim(ID.owner, ID.lot1, [r1.id, r2.id], [H('a'), H('a')], [s1, s2])).rows[0].c
  ok(/^[0-9a-f-]{36}$/.test(c1), 'claim OK (surse neschimbate): o cheie de solicitare')
  ok((await rand(1)).stare === 'in_curs' && (await rand(2)).cerere_id === c1, 'ambele rânduri în curs, aceeași cheie')
  ok(await cod(claim(ID.owner, ID.lot1, [r1.id], [H('a')], [s1])) === 'P0001', 'IDEMPOTENȚĂ: al doilea claim pe același plic refuzat (nu mai e aprobat)')
  ok(await cod(propune(ID.editor, 1, H('a'))) === 'P0001', 'plic în curs → nu se re-propune')

  // ── rezultate: CAS pe cheie, parțial, străin ──
  const rez = (uid, c, arr) => ca(db, uid, 'SELECT public.fn_red_fan_rezultate($1, $2::jsonb) AS n', [c, JSON.stringify(arr)])
  ok(await cod(rez(ID.owner, c1, [{ id: r1.id, stare: 'generat', awb: '1000000001' }])) === 'P0001', 'rezultat PARȚIAL (1 din 2) → refuz, nimic scris')
  ok(await cod(rez(ID.owner, '50000000-0000-4000-8000-000000000001', [{ id: r1.id, stare: 'generat', awb: '1000000001' }, { id: r2.id, stare: 'eroare', awb: null }])) === 'P0001', 'cheie străină → refuz')
  ok(await cod(rez(ID.owner, c1, [{ id: r1.id, stare: 'generat', awb: null }, { id: r2.id, stare: 'eroare', awb: null }])) === '22023', 'generat fără AWB → 22023')
  ok(await cod(rez(ID.owner, c1, [{ id: r1.id, stare: 'eroare', awb: '1000000001' }, { id: r2.id, stare: 'eroare', awb: null }])) === '22023', 'eroare cu AWB → 22023')
  ok(await cod(rez(ID.editor, c1, [{ id: r1.id, stare: 'generat', awb: '1000000001' }, { id: r2.id, stare: 'eroare', awb: null }])) === '42501', 'editor: rezultatul refuzat')
  ok(await cod(rez(ID.owner, c1, [{ id: r1.id, stare: 'generat', awb: '1000000001', tarif: 29.7, tva: 5.643 }, { id: r2.id, stare: 'eroare', awb: null, motiv: 'FAN a respins expedierea; câmpuri semnalate: phone' }])) === 'OK', 'rezultat MIXT (generat + eroare) scris odată')
  const g1 = await rand(1)
  ok(g1.stare === 'generat' && g1.awb === '1000000001' && Number(g1.tarif) === 29.7 && Number(g1.tva) === 5.643 && g1.generat_la, 'generat: AWB + tarif + TVA exacte')
  ok((await val(db, 'SELECT stare FROM public.red_fan_awb WHERE id = $1', [r2.id])).stare === 'eroare', 'elementul respins: eroare + motiv')
  ok(await cod(rez(ID.owner, c1, [{ id: r1.id, stare: 'generat', awb: '1000000001' }, { id: r2.id, stare: 'eroare', awb: null }])) === 'P0001', 'rezultat repetat (vechi) → refuz')
  ok(await cod(propune(ID.editor, 1, H('a'))) === 'P0001', 'IDEMPOTENȚĂ: plicul cu AWB generat nu primește o a doua propunere')
  ok(await cod(propune(ID.editor, 2, H('e'))) === 'OK', 'plicul respins (eroare) se re-propune: rând nou')
  const c3 = (await claim(ID.owner, ID.lot1, [r3.id], [H('a')], [s3])).rows[0].c
  ok(await cod(rez(ID.owner, c3, [{ id: r3.id, stare: 'necunoscut', awb: null, motiv: 'HTTP 0' }])) === 'OK', 'timeout → necunoscut')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_reconciliaza($1, NULL, NULL, NULL, $2)', [r3.id, ' '])) === '22023', 'reconciliere fără AWB și fără motiv → 22023')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_reconciliaza($1, $2, NULL, NULL, $3)', [r3.id, '1000000003', 'găsit în borderou'])) === 'OK', 'reconciliere: necunoscut → generat')
  ok(await cod(rez(ID.owner, c3, [{ id: r3.id, stare: 'eroare', awb: null }])) === 'P0001', 'rezultatul târziu după reconciliere → refuz (CAS)')
  const cT = (await claim(ID.owner, ID.lot2, [r4.id], [H('b')], [s4])).rows[0].c
  ok(await cod(rez(ID.owner, cT, [{ id: r4.id, stare: 'generat', awb: '1000000004', tarif: 1e9 }])) === 'OK', 'lotul de test: generat (tarif absurd → necunoscut, nu rotunjit)')
  ok((await rand(4)).tarif === null, 'tarif în afara plajei → NULL (necunoscut)')

  // ── urmărire + confirmări, cu versiunea citită (CAS) și fără întoarcere în timp (runda 2) ──
  const urm = (uid, lot, arr) => ca(db, uid, 'SELECT public.fn_red_fan_urmarire($1, $2::jsonb) AS r', [lot, JSON.stringify(arr)])
  const u1 = { id: r1.id, awb: '1000000001', versiune: 0, urmarire_stare: 'retur', ultim_eveniment: 'S6', ultim_eveniment_la: '2026-11-10 15:00:00', ridicat_propus: '2026-11-09', livrat_la: null, retur_propus: 'refuz' }
  ok(await cod(urm(ID.owner, ID.lot1, [{ ...u1, awb: '1000000009' }])) === 'P0001', 'urmărire cu AWB diferit → refuz')
  ok(await cod(urm(ID.owner, ID.lot2, [u1])) === 'P0001', 'urmărire pe rândul altui lot → refuz')
  ok(await cod(urm(ID.owner, ID.lot1, [{ ...u1, retur_propus: 'decedat' }])) === '22023', 'retur propus „decedat” (judecată umană) → 22023')
  ok(await cod(urm(ID.owner, ID.lot1, [{ ...u1, ultim_eveniment_la: '10.11.2026 15:00' }])) === '22023', 'dată de formă necunoscută → 22023')
  ok(await cod(urm(ID.owner, ID.lot1, [{ ...u1, versiune: null }])) === '22023', 'fără versiunea citită → 22023')
  ok(await cod(urm(ID.editor, ID.lot1, [u1])) === '42501', 'editor: urmărirea refuzată')
  const w1 = (await urm(ID.owner, ID.lot1, [u1])).rows[0].r
  ok(w1.scrise === 1 && w1.depasite === 0, 'urmărire scrisă (versiunea 0 → 1): ' + JSON.stringify(w1))
  const uu = await val(db, `SELECT urmarire_stare, retur_propus, ridicat_propus::text AS rp, versiune_urmarire AS v, to_char(ultim_eveniment_la AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS utc FROM public.red_fan_awb WHERE id = $1`, [r1.id])
  ok(uu.urmarire_stare === 'retur' && uu.retur_propus === 'refuz' && uu.rp === '2026-11-09' && uu.v === 1, 'retur propus: refuz; ridicarea propusă 09.11; versiunea 1')
  ok(uu.utc === '2026-11-10 13:00', 'ora României 15:00 (noiembrie, UTC+2) → 13:00 UTC (L17): ' + uu.utc)
  // o rulare care a citit versiunea 0 (veche) și scrie DUPĂ cea nouă: depășită, nescrisă — chiar cu un eveniment mai nou (doar CAS-ul o oprește)
  const w2 = (await urm(ID.owner, ID.lot1, [{ ...u1, urmarire_stare: 'livrat', ultim_eveniment: 'S2', ultim_eveniment_la: '2026-11-11 09:00:00', livrat_la: '2026-11-11 09:00:00', retur_propus: null }])).rows[0].r
  ok(w2.scrise === 0 && w2.depasite === 1 && (await rand(1)).urmarire_stare === 'retur', 'REZULTAT VECHI (versiunea citită 0, acum 1): depășit, nescris: ' + JSON.stringify(w2))
  // versiunea curentă, dar un eveniment MAI VECHI decât cel scris: tot depășit
  const w3 = (await urm(ID.owner, ID.lot1, [{ ...u1, versiune: 1, urmarire_stare: 'in_tranzit', ultim_eveniment: 'C0', ultim_eveniment_la: '2026-11-09 10:00:00', retur_propus: null }])).rows[0].r
  ok(w3.scrise === 0 && w3.depasite === 1, 'eveniment mai vechi decât cel scris (aceeași versiune): depășit, nescris')
  ok((await val(db, 'SELECT stare FROM public.red_plicuri WHERE id = $1', [plicId(1)])).stare === 'activ' && (await val(db, 'SELECT awb FROM public.red_plicuri WHERE id = $1', [plicId(1)])).awb === null, 'urmărirea NU atinge plicul (propunere)')
  const conf = (uid, lot, arr) => ca(db, uid, 'SELECT public.fn_red_fan_confirmari($1, $2::jsonb) AS r', [lot, JSON.stringify(arr)])
  ok(await cod(conf(ID.owner, ID.lot1, [{ id: r1.id, awb: '1000000001', versiune: 1, confirmare_stare: 'confirmat' }])) === '22023', 'confirmare „confirmat” (succes automat) → 22023')
  const w4 = (await conf(ID.owner, ID.lot1, [{ id: r1.id, awb: '1000000001', versiune: 0, confirmare_stare: 'lipsa' }])).rows[0].r
  ok(w4.scrise === 0 && w4.depasite === 1, 'confirmare cu versiunea veche: depășită')
  const w5 = (await conf(ID.owner, ID.lot1, [{ id: r1.id, awb: '1000000001', versiune: 1, confirmare_stare: 'forma_necunoscuta' }])).rows[0].r
  ok(w5.scrise === 1 && (await rand(1)).confirmare_stare === 'forma_necunoscuta', 'confirmare de formă necunoscută: scrisă ca atare (versiunea curentă)')

  // ── ridicare: lot real → plicul expediat; lot de test → plicul neatins ──
  const azi = (await val(db, `SELECT (now() AT TIME ZONE 'Europe/Bucharest')::date::text AS d`)).d
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_ridicat($1, $2)', [r1.id, '2026-01-01'])) === '22023', 'ridicare înainte de generare → 22023')
  ok(await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_ridicat($1, $2)', [r1.id, azi])) === '42501', 'editor: confirmarea ridicării refuzată')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_ridicat($1, $2)', [r1.id, azi])) === 'OK', 'lot real: ridicare confirmată')
  const p1 = await val(db, 'SELECT awb, data_expediere::text AS d FROM public.red_plicuri WHERE id = $1', [plicId(1)])
  ok(p1.awb === '1000000001' && p1.d === azi, 'lot real: plicul are AWB + data expedierii')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_ridicat($1, $2)', [r1.id, azi])) === 'OK', 'C0 repetat = no-op')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_ridicat($1, $2)', [r4.id, azi])) === 'OK', 'lot de TEST: ridicare confirmată în evidență')
  const p4 = await val(db, 'SELECT awb, data_expediere FROM public.red_plicuri WHERE id = $1', [plicId(4)])
  ok(p4.awb === null && p4.data_expediere === null, 'lot de TEST: plicul NU e marcat expediat (fără efect în registru / PV / export)')
  ok((await rand(4)).stare === 'ridicat', 'lot de TEST: rândul FAN = ridicat')

  // ── anulare ──
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_anulat($1, $2, $3)', [r1.id, '1000000001', 'test'])) === 'P0001', 'AWB ridicat nu se anulează (CAS)')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_anulat($1, $2, $3)', [r3.id, '1000000099', 'test'])) === 'P0001', 'anulare cu alt AWB → refuz')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_anulat($1, $2, $3)', [r3.id, '1000000003', 'șters în selfAWB'])) === 'OK', 'AWB generat neridicat → anulat')
  ok(await cod(propune(ID.editor, 3, H('f'))) === 'OK', 'după anulare plicul se poate re-propune')
  return fail
}

// ── manifestul L15: lista obiectelor (familie, etichetă, operație) din fișierul revizuit = diferența generată de pașii runnerului ──
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
const faraPg18 = l => !/^constrangere\tconstrangere tabel [^\t]*_not_null\tcreat$/.test(l)

console.log('1. aplicarea ca la livrare (L15 v2: manifest generat, apoi livrarea aprobată) + comportamentul')
let G0 = null, FMANIFEST = null
{
  const db = await bazaNoua()
  let jg = []
  try { jg = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: '-', manifest: '-', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message) }
  G0 = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const gener = listaObiecte(manifest).filter(faraPg18), revizuit = listaObiecte(OBIECTE)
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, 'supabase/tests/20261212a_redari_fan_awb.l15.obiecte.tsv'),
    '# 20261212a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n' + gener.join('\n') + '\n')
  const lipsa = revizuit.filter(x => !gener.includes(x)), plus = gener.filter(x => !revizuit.includes(x))
  ok(G0 && gener.length > 40 && !lipsa.length && !plus.length, `manifestul generat (${gener.length} obiecte) = lista revizuită; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  FMANIFEST = join(TMP, '20261212a_redari_fan_awb.l15.tsv')
  writeFileSync(FMANIFEST, manifest)
  const j = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: G0, manifest: FMANIFEST, final: garda('20261212a_redari_fan_awb', PLAFON_LIVRARE, 'COMMIT') })
  ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)) && j.some(m => /sfarsit la \d+ ms de la BEGIN; lock-uri puternice tinute de \d+ ms/.test(m)),
    'livrarea aprobată: diferența = manifestul; ' + j.filter(m => /ms de la BEGIN/.test(m)).map(m => m.slice(0, 90)).join(' | '))
  const lt = j.find(m => /^LOCK_TINUT /.test(m)) || ''
  ok(j.some(m => /^PLAFON_TIMP 20261212a_redari_fan_awb: garda trecuta la \d+ ms de la BEGIN \(plafon 5000 ms\)/.test(m)) && /^LOCK_TINUT 20261212a_redari_fan_awb: /.test(lt)
    && j.some(m => /lock la \d+ ms de la BEGIN \(1 incercari, \d+ ms de la prima incercare\)/.test(m)), 'garda finală a runnerului: PLAFON_TIMP (5000) + LOCK_TINUT: ' + lt.slice(0, 120))
  const f = await verificari(db, true)
  esec += f.length
  let m = null; try { await aplicaMig(db) } catch (e) { m = e.message }
  ok(/reaplicare/.test(m || ''), 'reaplicarea refuzată: ' + m)
  m = null; try { await revino(db) } catch (e) { m = e.message }
  ok(/red_fan_awb are randuri/.test(m || ''), 'revenirea refuză cu AWB-uri (le păstrează): ' + m)
  ok((await val(db, `SELECT to_regclass('public.red_fan_awb') IS NOT NULL AS e`)).e === true, 'după refuz tabelul există încă (tranzacția s-a anulat)')
  await db.close()
}

console.log('2. refuzurile migrării (nimic schimbat)')
const LOCK_EXIT = '      LOCK TABLE public.red_plicuri IN SHARE ROW EXCLUSIVE MODE NOWAIT;\n      EXIT;\n'
for (const [nume, fn, re] of [
  ['fără marcajul runnerului', db => aplicaMig(db, MIG, { marcaj: false }), /garda start invalida/],
  ['fără plafon', db => aplicaMig(db, MIG, { plafon: 0, marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['plafonul vechi (2000) pus de runner', db => aplicaMig(db, MIG, { plafon: 2000 }), /PLAFON_TRANZACTIE lipsa: 2000\/session marcaj 2000:\d+ \(cerut 5000\/session/],
  ['fără amprenta globală L15 v2 (pasul „înainte” lipsă)', db => aplicaMig(db, MIG, { l15: 'nimic' }), /AMPRENTA_GLOBALA_LIPSA/],
  ['pasul „înainte” dintr-o tranzacție anterioară, citit acum', async db => {
    await db.exec(`BEGIN; CREATE TEMP TABLE ag_ina_0123456789abcdef (x int); COMMIT;`)
    return aplicaMig(db, 'SELECT count(*) FROM pg_temp.ag_ina_0123456789abcdef;\n' + MIG, { l15: 'nimic' })
  }, /AMPRENTA_GLOBALA_LIPSA/],
  ['poarta de drept schimbată (fn_red_nivel)', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_nivel() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT 'admin'::text $f$;`)
    return aplicaMig(db)
  }, /poarta de drept \(inainte\) difera de amprenta revizuita: public\.fn_red_nivel\(\)/],
  ['coloana contactului lipsă', async db => { await db.exec('ALTER TABLE public.red_detinatori_contact DROP COLUMN cod_postal'); return aplicaMig(db) }, /red_detinatori_contact\.cod_postal lipseste/],
  ['setul de lock-uri obținut după termen, fără coliziune', db => aplicaMig(db, aplica(MIG, [[LOCK_EXIT, '      LOCK TABLE public.red_plicuri IN SHARE ROW EXCLUSIVE MODE NOWAIT;\n      PERFORM pg_sleep(1.05);\n      EXIT;\n']])),
    /BUGET_LOCK: lock-urile obtinute abia la \d+ ms de la prima incercare \(1 incercari/],
  ['ocupat permanent (coliziune la fiecare încercare)', db => aplicaMig(db, aplica(MIG, [[LOCK_EXIT, "      RAISE EXCEPTION 'coliziune simulata' USING ERRCODE = '55P03';\n" + LOCK_EXIT]])), /BUGET_LOCK: \d+ incercari, \d+ ms de la prima incercare/],
]) {
  const db = await bazaNoua()
  let m = null
  try { await fn(db) } catch (e) { m = e.message }
  const gol = (await val(db, `SELECT to_regclass('public.red_fan_awb') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'fn_red_fan_%') AS g`)).g
  ok(re.test(m || '') && gol, `${nume}: ${m}`)
  await db.close()
}
// bugetul pornește la PRIMA încercare: un pas „înainte” lung (1,05 s) nu-l consumă
{
  const db = await bazaNoua()
  const j = await aplicaMig(db, 'SELECT pg_sleep(1.05);\n' + MIG)
  const m = (j.find(x => /lock la \d+ ms de la BEGIN/.test(x)) || '').match(/lock la (\d+) ms de la BEGIN \((\d+) incercari, (\d+) ms de la prima incercare\)/)
  ok(m && Number(m[1]) >= 1050 && Number(m[3]) < 1000, `un pas „înainte” de 1,05 s nu consumă bugetul lock-ului: ${m ? m[0] : 'fără mesaj'}`)
  await db.close()
}

console.log('3. revenirea (prin runner, plafonul 2000, fără amprentă globală)')
const aplicatCurat = async () => { const db = await bazaNoua(); await aplicaMig(db); return db }
for (const [nume, pregateste, re] of [
  ['setări schimbate', db => db.exec(`SELECT set_config('request.jwt.claim.sub', '${ID.owner}', false); SELECT public.fn_red_fan_setari_seteaza(30);`), /setarile FAN au fost schimbate/],
  ['un lot marcat (fără AWB)', db => db.exec(`SELECT set_config('request.jwt.claim.sub', '${ID.owner}', false); SELECT public.fn_red_fan_lot_marcheaza('${ID.lot3}', true);`), /loturi marcate/],
  ['o funcție fn_red_fan_* în plus', db => db.exec(`CREATE FUNCTION public.fn_red_fan_alta() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;`), /functii: (public\.)?fn_red_fan_alta\(\)/],
  ['o vedere a altei migrări peste red_fan_awb', db => db.exec(`CREATE VIEW public.v_fan_alta AS SELECT id FROM public.red_fan_awb;`), /alte obiecte depind/],
]) {
  const db = await aplicatCurat()
  await pregateste(db)
  let m = null
  try { await revino(db) } catch (e) { m = e.message }
  ok(re.test(m || '') && (await val(db, `SELECT to_regclass('public.red_fan_awb') IS NOT NULL AS e`)).e, `revenirea refuză: ${nume}: ${m}`)
  await db.close()
}
for (const [nume, o, re] of [['fără marcajul runnerului', { marcaj: false }, /garda invalida/], ['plafonul livrărilor (5000)', { plafon: 5000 }, /PLAFON_TRANZACTIE lipsa: 5000/]]) {
  const db = await aplicatCurat()
  let m = null
  try { await revino(db, REV, o) } catch (e) { m = e.message }
  ok(re.test(m || '') && (await val(db, `SELECT to_regclass('public.red_fan_awb') IS NOT NULL AS e`)).e, `revenirea refuză (runner): ${nume}: ${m}`)
  await db.close()
}
{
  const db = await aplicatCurat()
  const j = await revino(db)
  ok(j.some(m => /revenire: sfarsit la \d+ ms/.test(m)), 'revenirea pe aplicarea curată trece')
  ok((await val(db, `SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'fn_red_fan_%'`)).n === 0 && (await val(db, `SELECT to_regclass('public.red_fan_setari') IS NULL AS e`)).e, 'nimic rămas după revenire')
  let m = null; try { await aplicaMig(db) } catch (e) { m = e.message }
  ok(m === null, 're-aplicarea după revenire trece' + (m ? ': ' + m : ''))
  ok((await verificari(db, false)).length === 0, 'comportamentul identic după re-aplicare')
  await db.close()
}

console.log('4. mutanți (fiecare trebuie să pice cel puțin o verificare)')
const MUTANTI = [
  ['claim fără limita de 100', "cardinality(p_ids) = 0 OR cardinality(p_ids) > 100", "cardinality(p_ids) = 0 OR cardinality(p_ids) > 1000"],
  ['claim acceptă și rânduri ne-aprobate (idempotență)', "WHERE a.lot_id = p_lot_id AND a.stare = 'aprobat' AND a.hash_date = t.h", "WHERE a.lot_id = p_lot_id AND a.stare IN ('aprobat', 'in_curs', 'generat') AND a.hash_date = t.h"],
  ['claim fără amprenta surselor (runda 2)', 'WHERE public.fn_red_fan_surse(a.plic_id) IS NOT DISTINCT FROM t.s;', 'WHERE true;'],
  ['amprenta surselor fără contacte', "|| public.fn_red_fan_camp(ct.telefon) || public.fn_red_fan_camp(ct.adresa_strada)", "|| public.fn_red_fan_camp(ct.adresa_strada)"],
  ['aprobare fără plafonul pilot', 'IF v_deja + v_n > v_limita THEN', 'IF false THEN'],
  ['rezultate acceptă parțial (ambele gărzi)', 'IF v_asteptate = 0 OR v_n <> v_asteptate OR EXISTS', 'IF v_asteptate = 0 OR EXISTS',
    "IF v_n <> v_asteptate THEN RAISE EXCEPTION 'redari fan: rezultat partial (CAS)'", "IF false THEN RAISE EXCEPTION 'redari fan: rezultat partial (CAS)'"],
  ['lotul de test scrie pe plic', '  IF NOT v_test THEN\n    IF v_pl.stare', '  IF true THEN\n    IF v_pl.stare'],
  ['aprobare fără marcaj', "IF NOT EXISTS (SELECT 1 FROM public.red_fan_loturi WHERE lot_id = p_lot_id) THEN\n    RAISE EXCEPTION 'redari fan: alege intai", "IF false THEN\n    RAISE EXCEPTION 'redari fan: alege intai"],
  ['aprobarea deschisă editorului', "IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul aproba'", "IF auth.uid() IS NULL THEN RAISE EXCEPTION 'redari fan: doar owner-ul aproba'"],
  ['marcajul blocat doar după stările curente (versiunea 31f0473d)', 'IF v_vechi.prima_aprobare_la IS NOT NULL OR EXISTS', 'IF EXISTS'],
  ['aprobarea nu consemnează prima aprobare', "  UPDATE public.red_fan_loturi SET prima_aprobare_la = now(), prima_aprobare_de = auth.uid() WHERE lot_id = p_lot_id AND prima_aprobare_la IS NULL;\n", ''],
  ['fără trigger-ul gărzii marcajului', 'CREATE TRIGGER trg_red_fan_loturi_garda BEFORE UPDATE OR DELETE ON public.red_fan_loturi FOR EACH ROW EXECUTE FUNCTION public.fn_red_fan_loturi_garda();',
    "-- fara trigger\nCREATE TRIGGER trg_red_fan_loturi_garda BEFORE TRUNCATE ON public.red_fan_loturi FOR EACH STATEMENT EXECUTE FUNCTION public.fn_red_fan_loturi_garda();"],
  ['urmărire fără verificarea AWB-ului', 'a.lot_id = p_lot_id AND a.awb = u.awb AND', 'a.lot_id = p_lot_id AND'],
  ['urmărire fără CAS pe versiune (runda 2)', '   WHERE a.id = u.id AND a.versiune_urmarire = u.versiune\n', '   WHERE a.id = u.id\n'],
  ['urmărire fără garda timpului evenimentului', "     AND (a.ultim_eveniment_la IS NULL OR u.ultim_eveniment_la IS NULL OR (u.ultim_eveniment_la::timestamp AT TIME ZONE 'Europe/Bucharest') >= a.ultim_eveniment_la);", ';'],
  ['confirmări fără CAS pe versiune', 'WHERE a.id = c.id AND a.versiune_urmarire = c.versiune;', 'WHERE a.id = c.id;'],
  ['propunerea re-propune și un AWB generat', "IF v_rand.stare NOT IN ('propus', 'aprobat') THEN", "IF v_rand.stare NOT IN ('propus', 'aprobat', 'generat', 'in_curs') THEN"],
  ['scriere directă permisă', 'REVOKE ALL ON public.red_fan_setari, public.red_fan_loturi, public.red_fan_awb FROM PUBLIC, anon, authenticated, service_role;', ''],
]
for (const [nume, ...perechi] of MUTANTI) {
  const lista = []
  for (let i = 0; i < perechi.length; i += 2) lista.push([perechi[i], perechi[i + 1]])
  let m
  try { m = aplica(MIG, lista) } catch (e) { ok(false, `mutantul „${nume}” nu se aplică exact o dată`); continue }
  let f
  try { const db = await bazaNoua(); await aplicaMig(db, m); f = await verificari(db, false); await db.close() } catch (e) { f = ['excepție la aplicare / verificare: ' + (e.code || e.message)] }
  ok(f.length > 0, `mutant „${nume}” prins (${f.length} verificări picate${f[0] ? ': ' + f[0] : ''})`)
}

console.log('5. paritatea amprentei surselor: JS (redariFan.mjs) = SQL (fn_red_fan_surse), pe aceleași rânduri (L19)')
{
  const db = await aplicatCurat()
  const pl = (await db.query(`SELECT id, nr_plic, destinatar_nume, stare, lot_id FROM public.red_plicuri ORDER BY nr_plic`)).rows
  const cv = (await db.query(`SELECT id, plic_id, detinator_id FROM public.red_convocari WHERE stare = 'activ' AND sters_la IS NULL`)).rows
  const ct = (await db.query(`SELECT detinator_id, telefon, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal FROM public.red_detinatori_contact`)).rows
  const js = await FAN.amprenteSurse({ plicuri: pl, convocari: cv, contacte: ct, proiectCod: 'TEST-PROIECT', subtle: webcrypto.subtle })
  let egale = 0
  for (const p of pl) {
    const sql = (await val(db, 'SELECT public.fn_red_fan_surse($1) AS s', [p.id])).s
    if (sql === js.get(p.id)) egale++; else console.log(`     ${p.nr_plic}: SQL ${sql} ≠ JS ${js.get(p.id)}`)
  }
  ok(egale === pl.length && pl.length === 6, `amprentele identice pe ${egale} din ${pl.length} plicuri (diacritice, câmpuri NULL / goale, contact lipsă, 2 deținători, convocare anulată / ștearsă, plic fără lot)`)
  // sensibilitatea: fiecare câmp schimbat → altă amprentă în ambele implementări (aceeași decizie)
  const inainte = (await val(db, 'SELECT public.fn_red_fan_surse($1) AS s', [plicId(3)])).s
  await db.query(`UPDATE public.red_detinatori_contact SET cod_postal = NULL WHERE detinator_id = $1`, [detId(4)])
  const dupa = (await val(db, 'SELECT public.fn_red_fan_surse($1) AS s', [plicId(3)])).s
  const ct2 = (await db.query(`SELECT detinator_id, telefon, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal FROM public.red_detinatori_contact`)).rows
  const js2 = await FAN.amprenteSurse({ plicuri: pl, convocari: cv, contacte: ct2, proiectCod: 'TEST-PROIECT', subtle: webcrypto.subtle })
  ok(inainte !== dupa && dupa === js2.get(plicId(3)), 'cod poștal „” → NULL: altă amprentă, aceeași în JS și SQL (gol ≠ lipsă)')
  await db.close()
}

console.log(esec ? `\nREZULTAT: ${esec} verificări picate` : '\nREZULTAT: toate verificările au trecut')
process.exit(esec ? 1 : 0)
