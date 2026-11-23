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
// 1b (runda 5). Ceasul opririi tirajului: reproducerea recenzentului (30,2 s ÎNAINTEA opririi) pe migrarea de acum și pe forma 58abaa54.
//    În 1: oprirea după o pauză în tranzacția ei, comparația celor 30 s pe ceasul efectiv, rezervarea + cele 10 minute ale reconcilierii,
//    soluționarea contradicțiilor (rol, CAS, motiv, alegeri, jurnal, redeschiderea, CHECK-ul red_fan_awb_contradictii).
// Ce NU probează PGlite (o singură conexiune): concurența reală (două sesiuni) — supabase/tests/20261212a_redari_fan_doua_sesiuni.sh, pe clonă
//   (acolo și așteptarea pe LOCK înaintea opririi, T3a, și durata celor 30 s pe ceasul serverului, T3b).
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
  const SCEN = ['K1', 'K2', 'S1', 'S2a', 'S2b', 'S2c', 'U1', 'U2', 'M1', 'T1', 'T2', 'T2b', 'T3a', 'T3b', 'C1', 'C2', 'R1']
  ok(sn === null && s2.includes("fn_red_fan_claim_lot(uuid, uuid[], text[], text[])") && s2.includes("fn_red_fan_tiraj(uuid, text, text)")
    && s2.includes("fn_red_fan_tiraj_opreste(uuid, text, boolean)") && s2.includes("fn_red_fan_urmarire_solutioneaza(uuid, integer, jsonb, text)")
    && MIG.includes('CREATE FUNCTION public.fn_red_fan_urmarire_solutioneaza(p_id uuid, p_versiune integer, p_alegeri jsonb, p_motiv text)')
    && MIG.includes('CREATE FUNCTION public.fn_red_fan_claim_lot(p_lot_id uuid, p_ids uuid[], p_hashuri text[], p_surse text[])')
    && MIG.includes('CREATE FUNCTION public.fn_red_fan_tiraj(p_lot_id uuid, p_cheie text, p_inlocuieste text)')
    && MIG.includes('CREATE FUNCTION public.fn_red_fan_tiraj_opreste(p_lot_id uuid, p_cheie text, p_opreste boolean)')
    && SCEN.every(k => s2.includes(`rez ok "${k} `)), `scriptul cu două sesiuni: bash -n ${sn || 'OK'}; scenariile ${SCEN.join(' ')} prezente`)
  // runda 4 (r3 P5): proba de concurență la APLICARE (supabase/tests/l15_aplicare_concurenta.sh, pe clonă) are profilul ADITIV „fan”:
  // bash -n, versiunea și setul migrării, mesajele BUGET_LOCK exact o dată în migrare, scenariile L1b / F1; profilurile uscare / meteo neschimbate
  const L15C = join(ROOT, 'supabase/tests/l15_aplicare_concurenta.sh')
  let ln = null; try { execFileSync('bash', ['-n', L15C], { stdio: ['ignore', 'pipe', 'pipe'] }) } catch (x) { ln = String(x.stderr || x.message) }
  const l15c = citeste('supabase/tests/l15_aplicare_concurenta.sh')
  let l15main = null; try { l15main = execFileSync('git', ['show', 'origin/main:supabase/tests/l15_aplicare_concurenta.sh'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r/g, '') } catch { l15main = null }
  const ramuri = t => (t.match(/^ {2}(uscare|meteo)\) [\s\S]*?;;$/gm) || []).join('\n')
  const fmtA = "'20261212a: BUGET_LOCK: % incercari, % ms de la prima incercare", fmtB = "'20261212a: BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare (% incercari;"
  ok(ln === null && /\bfan\)\s+NUME=20261212a_redari_fan_awb; VERS=20261212120000; REL=public\.red_plicuri; HMOD='ROW EXCLUSIVE'; HLOCK=RowExclusiveLock/.test(l15c)
    && MIG.startsWith('-- Version 20261212120000.') && MIG.split(fmtA).length === 2 && MIG.split(fmtB).length === 2
    && ['L1b (fan)', 'F1 (fan)', 'public.red_proiecte public.red_loturi_plicuire public.red_plicuri'].every(s => l15c.includes(s))
    && (l15main === null || (ramuri(l15main).length > 100 && ramuri(l15main) === ramuri(l15c))),
    `concurența la aplicare: bash -n ${ln || 'OK'}; profilul fan (setul, mesajele BUGET_LOCK o dată, L1b, F1); ramurile uscare / meteo identice cu origin/main${l15main === null ? ' (origin/main indisponibil: nesărit, dar necomparat)' : ''}`)
  // runda 4 (r3 P4): precondițiile fixture-ului cu coduri distincte, verificate ÎNAINTEA inserărilor; fără plasa „INSERT în profiles”; codurile
  // de ieșire 26 / 27 / 28 în script
  const FXr = citeste('supabase/tests/20261212a_redari_fan_fixture.sql')
  const iPre = FXr.indexOf("SELECT pg_temp.fx_drepturi();   -- FX001"), iUsers = FXr.indexOf('INSERT INTO auth.users'), iSare = FXr.indexOf('INSERT INTO public.red_plic_sare')
  ok(['FX001', 'FX002', 'FX003'].every(c => FXr.includes(`'FIXTURE_PRECONDITIE ${c}:`) && FXr.includes(`ERRCODE = '${c}'`)) && iPre > 0 && iPre < iSare && iSare < iUsers
    && FXr.indexOf("t.tgname = 'on_auth_user_created'") < iUsers && !/INSERT INTO public\.profiles/.test(FXr) && !/\bGRANT\b/.test(FXr.replace(/^--.*$/gm, ''))
    && /DELETE FROM public\.red_plic_sare WHERE sare LIKE 'FIXTURE-FAN-SARE-SINTETICA-%'/.test(FXr)
    && /FX001\) exit 26 ;; FX002\) exit 27 ;; FX003\) exit 28/.test(s2),
    'fixture-ul (runda 4): precondițiile FX001 / FX002 / FX003 înaintea inserărilor, trigger-ul real verificat, fără plasa de profil, fără GRANT, sarea sintetică ștearsă; scriptul: 26 / 27 / 28')
  // fixture-ul sintetic (runda 3): aceeași gardă a țintei, identificatorii comuni cu scriptul, nicio coloană a contoarelor globale
  const FX = citeste('supabase/tests/20261212a_redari_fan_fixture.sql')
  const idsScript = ['0000000000f1', '0000000000a1', '0000000000a2', '0000000000a3'].every(s => s2.includes('f12a0000-0000-4000-8000-' + s) && FX.includes('f12a0000-0000-4000-8000-' + s))
  ok(idsScript && /system_identifier::text FROM pg_control_system\(\)\) IS DISTINCT FROM current_setting\('fixture\.sistem'/.test(FX) && !/fn_red_numar_document|fn_red_plic_creeaza|fn_red_lot_plicuire_creeaza/.test(FX)
    && s2.includes('--cu-fixture'), 'fixture-ul: garda system_identifier, identificatorii comuni cu scriptul, fără contoarele globale de numerotare')
}

const ID = {
  owner: '00000000-0000-4000-8000-000000000001', editor: '00000000-0000-4000-8000-000000000002',
  viewer: '00000000-0000-4000-8000-000000000003', strain: '00000000-0000-4000-8000-000000000004', admin: '00000000-0000-4000-8000-000000000005',
  proiect: '10000000-0000-4000-8000-000000000001', lot1: '20000000-0000-4000-8000-000000000001', lot2: '20000000-0000-4000-8000-000000000002',
  lot3: '20000000-0000-4000-8000-000000000003',
}
const plicId = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const detId = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const H = c => c.repeat(64)
const DATE = `
  INSERT INTO public.profiles (id, name, is_owner) VALUES ('${ID.owner}', 'O', true), ('${ID.editor}', 'E', false), ('${ID.viewer}', 'V', false), ('${ID.strain}', 'X', false),
    ('${ID.admin}', 'A', false);
  INSERT INTO public.user_module_access VALUES ('${ID.editor}', 'redari', 'editor'), ('${ID.viewer}', 'redari', 'viewer'), ('${ID.admin}', 'redari', 'admin');
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

// fail: lista în care se adună verificările picate (runda 5: dată din afară, ca un mutant oprit de o excepție mai târziu să-și păstreze
// verificările picate dinaintea ei — se vede CE l-a prins, nu doar excepția)
async function verificari(db, log, fail = []) {
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
  // ACTIVARE, Testul 1 (docs/redari/FAN_TEST1_PASI.md): plafonul 1 = UN plic pe lot până la confirmarea asocierii (pasul 4a), apoi 3 (pasul 4b).
  // Plafonul e setarea din BD (fn_red_fan_setari_seteaza, owner), nu cod nou: aici se probează că valorile cerute de procedură fac exact ce trebuie.
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_setari_seteaza(1)')) === 'OK', 'Testul 1 (4a): plafonul lotului pilot = 1')
  ok(await cod(aproba(ID.owner, ID.lot1, [r1.id, r2.id, r3.id], [H('a'), H('a'), H('a')])) === 'P0001' && (await rand(1)).stare === 'propus', 'plafon 1: lotul cu 3 plicuri e refuzat, nimic aprobat')
  ok(await cod(aproba(ID.owner, ID.lot1, [r1.id, r2.id], [H('a'), H('a')])) === 'P0001', 'plafon 1: nici 2 plicuri')
  ok(await cod(aproba(ID.owner, ID.lot2, [r4.id], [H('b')])) === 'OK', 'plafon 1: lotul de TEST cu UN plic trece (pasul 4a)')
  ok(await cod(aproba(ID.owner, ID.lot1, [r1.id], [H('a')])) === 'OK', 'plafon 1: un plic pe lotul 1 trece')
  ok(await cod(aproba(ID.owner, ID.lot1, [r2.id], [H('a')])) === 'P0001' && (await rand(2)).stare === 'propus', 'plafon 1: al doilea plic pe același lot e refuzat (1 + 1 > 1), chiar aprobat separat')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_setari_seteaza(3)')) === 'OK', 'Testul 1 (4b): plafonul = 3')
  ok(await cod(aproba(ID.owner, ID.lot1, [r2.id, r3.id], [H('a'), H('a')])) === 'OK', 'plafon 3: lotul de 3 plicuri (1 deja + 2) trece (pasul 4b)')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_setari_seteaza(20)')) === 'OK', 'plafonul înapoi la 20 (după Testul 2, din ecran)')
  ok((await rand(1)).stare === 'aprobat' && (await rand(2)).stare === 'aprobat' && (await rand(3)).stare === 'aprobat', 'cele 3 plicuri ale lotului 1 aprobate')
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
  // runda 3 (r2 P2): un răspuns FĂRĂ cronologie („fără evenimente”) nu șterge evenimentul cunoscut: doar „verificat la”, versiunea + 1
  const inainteGol = await val(db, `SELECT urmarire_stare, ultim_eveniment, ultim_eveniment_la, ridicat_propus::text AS rp, retur_propus, versiune_urmarire AS v, urmarit_la FROM public.red_fan_awb WHERE id = $1`, [r1.id])
  const gol = { ...u1, versiune: 1, urmarire_stare: 'fara_evenimente', ultim_eveniment: null, ultim_eveniment_la: null, ridicat_propus: null, livrat_la: null, retur_propus: null }
  const w3b = (await urm(ID.owner, ID.lot1, [gol])).rows[0].r
  const dupaGol = await val(db, `SELECT urmarire_stare, ultim_eveniment, ultim_eveniment_la, ridicat_propus::text AS rp, retur_propus, versiune_urmarire AS v, urmarit_la FROM public.red_fan_awb WHERE id = $1`, [r1.id])
  ok(w3b.scrise === 0 && w3b.pastrate === 1 && w3b.depasite === 0, 'RĂSPUNS FĂRĂ EVENIMENTE pe un rând cu eveniment cunoscut: „păstrat”, nu scris: ' + JSON.stringify(w3b))
  ok(dupaGol.urmarire_stare === 'retur' && dupaGol.ultim_eveniment === 'S6' && +dupaGol.ultim_eveniment_la === +inainteGol.ultim_eveniment_la && dupaGol.rp === '2026-11-09'
    && dupaGol.retur_propus === 'refuz' && dupaGol.v === 2 && dupaGol.urmarit_la >= inainteGol.urmarit_la, 'evenimentul, ridicarea și returul propus rămân; doar „verificat la” + versiunea (2)')
  const w3c = (await urm(ID.owner, ID.lot1, [{ ...gol, versiune: 1 }])).rows[0].r
  ok(w3c.depasite === 1 && w3c.pastrate === 0, 'și „păstrat” trece prin CAS: versiunea veche (1, acum 2) = depășit')
  // un eveniment MAI NOU fără ridicarea în răspuns (listă trunchiată) nu șterge ridicarea cunoscută (coalesce)
  const w3d = (await urm(ID.owner, ID.lot1, [{ ...u1, versiune: 2, urmarire_stare: 'retur', ultim_eveniment: 'S6', ultim_eveniment_la: '2026-11-10 16:00:00', ridicat_propus: null }])).rows[0].r
  ok(w3d.scrise === 1 && (await val(db, 'SELECT ridicat_propus::text AS rp FROM public.red_fan_awb WHERE id = $1', [r1.id])).rp === '2026-11-09', 'eveniment nou fără ridicare în răspuns: ridicarea cunoscută (09.11) rămâne')
  // un rând FĂRĂ eveniment cunoscut primește „fără evenimente” normal (nimic de păstrat)
  const w3e = (await urm(ID.owner, ID.lot2, [{ id: r4.id, awb: '1000000004', versiune: 0, urmarire_stare: 'fara_evenimente', ultim_eveniment: null, ultim_eveniment_la: null, ridicat_propus: null, livrat_la: null, retur_propus: null }])).rows[0].r
  ok(w3e.scrise === 1 && w3e.pastrate === 0 && (await rand(4)).urmarire_stare === 'fara_evenimente', 'rând fără eveniment cunoscut: „fără evenimente” scris (nimic pierdut)')
  // ── runda 4 (Jakarinos #1118 r3 P2): FAPTELE cunoscute (ridicat, livrat, retur + motivul) nu se șterg de un răspuns mai sărac; o valoare nouă care
  // le CONTRAZICE nu se aplică în tăcere („de verificat”, ambele valori). Răspunsurile vin din PARSERUL REAL (interpreteazaUrmarire), ca în edge.
  const dinFan = (awb, ev) => FAN.interpreteazaUrmarire(200, { data: [{ awbNumber: awb, events: ev.map(([id, date]) => ({ id, date })) }] }, [awb]).pe_awb.get(awb)
  const urmFan = async (r, lot, awb, v, ev) => (await urm(ID.owner, lot, [{ id: r.id, awb, versiune: v, ...dinFan(awb, ev) }])).rows[0].r
  const fapte = async id => val(db, `SELECT urmarire_stare AS s, ultim_eveniment AS ev, ridicat_propus::text AS rid, to_char(livrat_la AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI') AS liv,
    retur_propus AS mot, retur_cunoscut AS ret, ridicat_contrazis::text AS c_rid, to_char(livrat_contrazis AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI') AS c_liv,
    retur_contrazis AS c_ret, versiune_urmarire AS v FROM public.red_fan_awb WHERE id = $1`, [id])
  const F = (s, ev, rid, liv, mot, ret, c_rid, c_liv, c_ret, v) => JSON.stringify({ s, ev, rid, liv, mot, ret, c_rid, c_liv, c_ret, v })
  const eF = async (id, asteptat, m) => { const x = await fapte(id); ok(JSON.stringify(x) === asteptat, `${m}: ${JSON.stringify(x)}`) }
  const A4 = '1000000004'
  ok(dinFan(A4, [['S43', '2026-11-11 09:00:00']]).retur_propus === null, 'parserul real: răspunsul DOAR cu S43 nu are motivul (intrarea reproducerii recenzentului)')
  ok((await urmFan(r4, ID.lot2, A4, 1, [['S6', '2026-11-10 15:00:00'], ['S43', '2026-11-11 09:00:00']])).scrise === 1, 'urmărire S6 → S43 scrisă')
  await eF(r4.id, F('retur', 'S43', null, null, 'refuz', true, null, null, null, 2), 'S6 → S43: retur, motiv „refuz”, retur cunoscut')
  ok((await urmFan(r4, ID.lot2, A4, 2, [['S43', '2026-11-11 09:00:00']])).scrise === 1, 'REPRODUCEREA 1: răspunsul ulterior doar cu S43, la aceeași dată, se scrie (>=)')
  await eF(r4.id, F('retur', 'S43', null, null, 'refuz', true, null, null, null, 3), 'REPRODUCEREA 1: motivul „refuz” NU se șterge (fdaa0496: null)')
  await urmFan(r4, ID.lot2, A4, 3, [['C0', '2026-11-09 10:00:00'], ['S43', '2026-11-11 09:00:00']])
  await eF(r4.id, F('retur', 'S43', '2026-11-09', null, 'refuz', true, null, null, null, 4), 'ridicarea completată (fapt nou, nimic contrazis)')
  await urmFan(r4, ID.lot2, A4, 4, [['S30', '2026-11-12 08:00:00']])
  await eF(r4.id, F('retur', 'S30', '2026-11-09', null, 'refuz', true, null, null, null, 5), 'REPRODUCEREA 2: răspuns PARȚIAL cu ultim eveniment mai nou („în tranzit”): starea rămâne „retur”, faptele rămân')
  await urmFan(r4, ID.lot2, A4, 5, [['S99', '2026-11-12 09:00:00']])
  await eF(r4.id, F('de_verificat', 'S99', '2026-11-09', null, 'refuz', true, null, null, null, 6), 'răspuns NECLAR (cod necunoscut, mai nou): „de verificat”, dar ridicarea și returul cu motivul rămân')
  await urmFan(r4, ID.lot2, A4, 6, [['C0', '2026-11-10 10:00:00'], ['S43', '2026-11-12 10:00:00']])
  await eF(r4.id, F('de_verificat', 'S43', '2026-11-09', null, 'refuz', true, '2026-11-10', null, null, 7), 'CONTRADICȚIE pe ridicare (09.11 cunoscut, 10.11 nou): faptul rămâne, valoarea nouă vizibilă, „de verificat”')
  await urmFan(r4, ID.lot2, A4, 7, [['S5', '2026-11-12 11:00:00'], ['S43', '2026-11-12 12:00:00']])
  await eF(r4.id, F('de_verificat', 'S43', '2026-11-09', null, 'refuz', true, '2026-11-10', null, 'mutat', 8), 'CONTRADICȚIE pe motiv (refuz cunoscut, mutat nou): ambele vizibile; contradicția anterioară rămâne')
  await urmFan(r4, ID.lot2, A4, 8, [['S2', '2026-11-12 13:00:00']])
  await eF(r4.id, F('de_verificat', 'S2', '2026-11-09', '2026-11-12 13:00', 'refuz', true, '2026-11-10', null, 'mutat', 9), 'livrare după retur: LIVRAT ȘI RETUR = contradicție, ambele fapte vizibile')
  await urmFan(r4, ID.lot2, A4, 9, [['S2', '2026-11-12 14:00:00']])
  await eF(r4.id, F('de_verificat', 'S2', '2026-11-09', '2026-11-12 13:00', 'refuz', true, '2026-11-10', '2026-11-12 14:00', 'mutat', 10), 'CONTRADICȚIE pe livrare (13:00 cunoscut, 14:00 nou): ambele vizibile')
  // livrarea cunoscută nu coboară la „în tranzit” la un răspuns parțial; un eveniment mai vechi tot „depășit”
  const A3 = '1000000003'
  await urmFan(r3, ID.lot1, A3, 0, [['C0', '2026-11-09 10:00:00'], ['S2', '2026-11-11 09:00:00']])
  await eF(r3.id, F('livrat', 'S2', '2026-11-09', '2026-11-11 09:00', null, false, null, null, null, 1), 'C0 → S2: livrat, ridicat')
  await urmFan(r3, ID.lot1, A3, 1, [['S30', '2026-11-12 08:00:00']])
  await eF(r3.id, F('livrat', 'S30', '2026-11-09', '2026-11-11 09:00', null, false, null, null, null, 2), 'răspuns parțial mai nou („în tranzit”): rămâne „livrat” cu ora livrării (fdaa0496: „în tranzit”)')
  await urmFan(r3, ID.lot1, A3, 2, [['S43', '2026-11-12 09:00:00']])
  await eF(r3.id, F('de_verificat', 'S43', '2026-11-09', '2026-11-11 09:00', null, true, null, null, null, 3), 'retur după o livrare cunoscută: LIVRAT ȘI RETUR = contradicție (singura), „de verificat”, ambele fapte')
  ok((await urmFan(r3, ID.lot1, A3, 3, [['C0', '2026-11-09 10:00:00']])).depasite === 1, 'eveniment mai vechi decât cel scris: depășit, nescris')
  // r1 = „retur” cu motivul „refuz”, fără contradicții (scrisă mai sus)
  ok(await cod(db.query(`UPDATE public.red_fan_awb SET ridicat_contrazis = '2026-11-10' WHERE id = $1`, [r1.id])) === '23514', 'CHECK red_fan_awb_fapte: o contradicție fără „de verificat” e refuzată pe orice cale')
  ok(await cod(db.query(`UPDATE public.red_fan_awb SET retur_cunoscut = false WHERE id = $1`, [r1.id])) === '23514', 'CHECK red_fan_awb_fapte: un motiv / o stare de retur fără „retur cunoscut” e refuzată')
  ok((await val(db, 'SELECT stare FROM public.red_plicuri WHERE id = $1', [plicId(1)])).stare === 'activ' && (await val(db, 'SELECT awb FROM public.red_plicuri WHERE id = $1', [plicId(1)])).awb === null, 'urmărirea NU atinge plicul (propunere)')
  const conf = (uid, lot, arr) => ca(db, uid, 'SELECT public.fn_red_fan_confirmari($1, $2::jsonb) AS r', [lot, JSON.stringify(arr)])
  ok(await cod(conf(ID.owner, ID.lot1, [{ id: r1.id, awb: '1000000001', versiune: 1, confirmare_stare: 'confirmat' }])) === '22023', 'confirmare „confirmat” (succes automat) → 22023')
  const w4 = (await conf(ID.owner, ID.lot1, [{ id: r1.id, awb: '1000000001', versiune: 0, confirmare_stare: 'lipsa' }])).rows[0].r
  ok(w4.scrise === 0 && w4.depasite === 1, 'confirmare cu versiunea veche: depășită')
  const w5 = (await conf(ID.owner, ID.lot1, [{ id: r1.id, awb: '1000000001', versiune: 3, confirmare_stare: 'forma_necunoscuta' }])).rows[0].r
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

  // ── tirajul (runda 3, r2 P1): o cheie de manifest pentru TOATE descărcările lotului (etichete, fiecare parte, arhiva documentelor) ──
  const tiraj = (uid, lot, k, inl = null) => ca(db, uid, 'SELECT public.fn_red_fan_tiraj($1, $2, $3) AS t', [lot, k, inl])
  ok(await cod(tiraj(ID.viewer, ID.lot1, H('1'))) === '42501', 'tiraj: viewer refuzat')
  ok(await cod(tiraj(ID.strain, ID.lot1, H('1'))) === '42501', 'tiraj: cont fără drept pe Redări refuzat')
  ok(await cod(tiraj(null, ID.lot1, H('1'))) === '42501', 'tiraj: anonim refuzat (fără EXECUTE)')
  ok(await cod(tiraj(ID.editor, ID.lot1, 'x')) === '22023' && await cod(tiraj(ID.owner, ID.lot1, H('1'), 'y')) === '22023', 'tiraj: cheie invalidă → 22023')
  ok(await cod(tiraj(ID.editor, ID.lot3, H('1'))) === 'P0001', 'tiraj: lot FAN nemarcat → P0001')
  const t1 = (await tiraj(ID.editor, ID.lot1, H('1'))).rows[0].t
  const ft1 = await val(db, 'SELECT tiraj_de, tiraj_nr, tiraj_cheie, prima_aprobare_la, test FROM public.red_fan_loturi WHERE lot_id = $1', [ID.lot1])
  ok(t1.stare === 'inceput' && t1.nr === 1 && t1.cheie === H('1') && typeof t1.inceput_la === 'string' && ft1.tiraj_de === ID.editor && ft1.prima_aprobare_la && ft1.test === false,
    'tiraj: prima descărcare (editor) îl începe — nr. 1, autorul = auth.uid(), după prima aprobare (marcajul neatins)')
  const t2 = (await tiraj(ID.owner, ID.lot1, H('1'))).rows[0].t
  ok(t2.stare === 'acelasi' && t2.nr === 1 && t2.inceput_la === t1.inceput_la, 'tiraj: aceeași cheie (altă parte / arhiva) → același tiraj, nimic schimbat')
  ok(await cod(tiraj(ID.editor, ID.lot1, H('2'))) === 'RD020' && await cod(tiraj(ID.owner, ID.lot1, H('2'))) === 'RD020', 'tiraj: ALTĂ CHEIE (manifest schimbat) → RD020, și pentru owner fără înlocuire explicită')
  ok(await cod(tiraj(ID.editor, ID.lot1, H('2'), H('1'))) === '42501', 'tiraj: înlocuirea refuzată editorului (doar owner)')
  ok(await cod(tiraj(ID.owner, ID.lot1, H('2'), H('3'))) === 'RD020', 'tiraj: înlocuirea cu altă cheie veche decât cea curentă (CAS) → RD020')
  ok((await val(db, 'SELECT tiraj_cheie FROM public.red_fan_loturi WHERE lot_id = $1', [ID.lot1])).tiraj_cheie === H('1'), 'tiraj: după refuzuri, cheia rămâne cea începută')
  // runda 4 (Jakarinos #1118 r3 P1): înlocuirea cere OPRIREA descărcărilor de cel puțin 30 s; cât e oprit, ORICE descărcare (și reverificarea
  // finală a celor începute) = RD021; fiecare început / oprire / reluare / înlocuire = un rând în red_jurnal (cine, când, cheia veche → nouă, nr.)
  const opreste = (uid, lot, k, o = true) => ca(db, uid, 'SELECT public.fn_red_fan_tiraj_opreste($1, $2, $3) AS t', [lot, k, o])
  const oprit = async lot => (await val(db, 'SELECT tiraj_oprit_la, tiraj_oprit_de FROM public.red_fan_loturi WHERE lot_id = $1', [lot]))
  ok(await cod(tiraj(ID.owner, ID.lot1, H('2'), H('1'))) === 'RD022', 'tiraj: înlocuirea FĂRĂ oprirea descărcărilor → RD022 (nimic schimbat)')
  ok(await cod(opreste(ID.editor, ID.lot1, H('1'))) === '42501' && await cod(opreste(ID.viewer, ID.lot1, H('1'))) === '42501' && await cod(opreste(null, ID.lot1, H('1'))) === '42501',
    'oprirea: editor / viewer / anonim refuzați (doar owner)')
  ok(await cod(opreste(ID.owner, ID.lot1, H('3'))) === 'RD020' && await cod(opreste(ID.owner, ID.lot2, H('1'))) === 'RD020' && await cod(opreste(ID.owner, ID.lot1, 'x')) === '22023',
    'oprirea: CAS pe cheia tirajului afișat (altă cheie / lot fără tiraj → RD020), cheie invalidă → 22023')
  const o1 = (await opreste(ID.owner, ID.lot1, H('1'))).rows[0].t, o2 = (await opreste(ID.owner, ID.lot1, H('1'))).rows[0].t
  ok(o1.stare === 'oprit' && o1.nr === 1 && o1.oprit_la && o2.stare === 'oprit' && o2.oprit_la === o1.oprit_la && (await oprit(ID.lot1)).tiraj_oprit_de === ID.owner,
    'oprirea (owner): „oprit”, autorul = auth.uid(); repetată = no-op (momentul rămâne cel dintâi)')
  ok(await cod(tiraj(ID.editor, ID.lot1, H('1'))) === 'RD021' && await cod(tiraj(ID.owner, ID.lot1, H('1'))) === 'RD021' && await cod(tiraj(ID.editor, ID.lot1, H('2'))) === 'RD021',
    'OPRIT: orice descărcare — aceeași cheie (inclusiv reverificarea FINALĂ a unei descărcări începute) sau alta — → RD021, nimic descărcat')
  ok(await cod(tiraj(ID.owner, ID.lot1, H('2'), H('1'))) === 'RD022', 'înlocuirea imediat după oprire (sub 30 s) → RD022')
  const ac = (await tiraj(ID.owner, ID.lot1, H('1'), H('1'))).rows[0].t
  ok(ac.stare === 'acelasi' && ac.nr === 1 && ac.oprit_la === o1.oprit_la, 'înlocuirea cu aceeași cheie = nimic de înlocuit (oprirea rămâne)')
  // ceasul: PGlite nu așteaptă 30 s reali — oprirea se mută 31 s în urmă direct (proprietarul tabelului; garda marcajului nu acoperă tirajul)
  await db.query(`UPDATE public.red_fan_loturi SET tiraj_oprit_la = tiraj_oprit_la - interval '31 seconds' WHERE lot_id = $1`, [ID.lot1])
  ok(await cod(tiraj(ID.editor, ID.lot1, H('2'), H('1'))) === '42501', 'tiraj: înlocuirea refuzată editorului și după oprire (doar owner)')
  const t3 = (await tiraj(ID.owner, ID.lot1, H('2'), H('1'))).rows[0].t
  ok(t3.stare === 'inlocuit' && t3.nr === 2 && t3.cheie === H('2') && t3.oprit_la === null && (await oprit(ID.lot1)).tiraj_oprit_de === null,
    'tiraj: owner, după oprire + 30 s, „Tiraj nou” cu CAS pe cheia veche → nr. 2, oprirea ștearsă')
  ok(await cod(tiraj(ID.editor, ID.lot1, H('1'))) === 'RD020' && (await tiraj(ID.editor, ID.lot1, H('2'))).rows[0].t.stare === 'acelasi', 'tiraj: după înlocuire cheia veche e refuzată, cea nouă acceptată')
  await opreste(ID.owner, ID.lot1, H('2'))
  const rl = (await opreste(ID.owner, ID.lot1, H('2'), false)).rows[0].t
  ok(rl.stare === 'reluat' && rl.oprit_la === null && (await tiraj(ID.editor, ID.lot1, H('2'))).rows[0].t.stare === 'acelasi' && (await opreste(ID.owner, ID.lot1, H('2'), false)).rows[0].t.stare === 'reluat',
    'reluarea (owner, fără tiraj nou): descărcările trec din nou; repetată = no-op')
  const jt = (await db.query(`SELECT actiune, inregistrare_id, date_vechi, date_noi, user_id FROM public.red_jurnal WHERE tabela = 'red_fan_loturi' ORDER BY id`)).rows
  const jtt = jt.map(j => [j.inregistrare_id, j.date_noi.eveniment, j.date_vechi.tiraj_cheie, j.date_noi.tiraj_cheie, j.date_noi.tiraj_nr, j.user_id, j.actiune])
  ok(JSON.stringify(jtt) === JSON.stringify([[ID.lot1, 'tiraj_inceput', null, H('1'), 1, ID.editor, 'update'], [ID.lot1, 'tiraj_oprit', H('1'), H('1'), 1, ID.owner, 'update'],
    [ID.lot1, 'tiraj_inlocuit', H('1'), H('2'), 2, ID.owner, 'update'], [ID.lot1, 'tiraj_oprit', H('2'), H('2'), 2, ID.owner, 'update'], [ID.lot1, 'tiraj_reluat', H('2'), H('2'), 2, ID.owner, 'update']]),
    'red_jurnal: începutul, oprirea, înlocuirea (cheia veche → nouă, nr. 2), oprirea, reluarea — cu lotul, autorul = auth.uid(); refuzurile și no-op-urile fără rânduri: ' + JSON.stringify(jtt.map(x => x[1])))
  ok(jt[2].date_vechi.tiraj_oprit_la !== null && Object.keys(jt[2].date_noi).sort().join() === 'eveniment,la,tiraj_cheie,tiraj_nr'
    && jt.every(j => typeof j.date_noi.la === 'string') && jt[1].date_noi.la === o1.oprit_la,
    'înlocuirea consemnează și momentul opririi; fiecare eveniment are momentul EFECTIV („la” = cel scris pe rând, runda 5); jurnalul fără date personale (doar cheia-hash, nr., evenimentul)')
  ok(await cod(ca(db, ID.owner, `INSERT INTO public.red_jurnal (tabela, actiune) VALUES ('red_fan_loturi', 'update')`)) === '42501', 'red_jurnal: nimeni nu scrie direct din API (doar funcțiile tirajului)')
  ok(await cod(ca(db, ID.owner, `UPDATE public.red_fan_loturi SET tiraj_cheie = '${H('9')}' WHERE lot_id = '${ID.lot1}'`)) === '42501', 'tiraj: UPDATE direct ca owner (authenticated) refuzat')
  ok(await cod(db.query(`UPDATE public.red_fan_loturi SET tiraj_cheie = NULL WHERE lot_id = $1`, [ID.lot1])) === '23514', 'tiraj: CHECK-ul coerenței (cheie / nr / moment / autor) refuză o stare parțială')
  ok(await cod(db.query(`UPDATE public.red_fan_loturi SET tiraj_oprit_la = now(), tiraj_oprit_de = $2 WHERE lot_id = $1`, [ID.lot2, ID.owner])) === '23514', 'tiraj: CHECK — oprire fără tiraj început refuzată')

  // ── runda 5 (Jakarinos #1118 r4 P1): CEASUL opririi = momentul EFECTIV (clock_timestamp() după lock-uri), nu începutul tranzacției ──
  // O tranzacție ca rolul authenticated (JWT-ul contului), cu pași în interior: PGlite are o singură conexiune, deci „așteptarea” e o pauză
  // în ACEEAȘI tranzacție înaintea apelului (forma reproducerii recenzentului; așteptarea pe lock = scriptul cu două sesiuni, T3).
  const inTx = async (uid, pas) => {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', false);`)
    await db.exec('BEGIN; SET LOCAL ROLE authenticated;')
    try { const r = await pas(); await db.exec('COMMIT'); return r } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } throw e } finally { await db.exec('RESET ROLE') }
  }
  const ceas = async () => (await db.query('SELECT clock_timestamp()::text AS t')).rows[0].t
  const dupa = async (a, b) => (await val(db, 'SELECT $1::timestamptz >= $2::timestamptz AS d', [a, b])).d
  // tirajul H('2') (nr. 2), reluat mai sus: o oprire după o pauză de 0,2 s în tranzacția ei → momentul opririi ≥ ceasul de dinaintea apelului
  const op = await inTx(ID.owner, async () => {
    const t0 = (await db.query('SELECT now()::text AS t')).rows[0].t
    await db.query('SELECT pg_sleep(0.2)')
    const t1 = await ceas()
    const r = (await db.query('SELECT public.fn_red_fan_tiraj_opreste($1, $2, true) AS t', [ID.lot1, H('2')])).rows[0].t
    return { t0, t1, r }
  })
  const opDb = (await val(db, 'SELECT tiraj_oprit_la::text AS t FROM public.red_fan_loturi WHERE lot_id = $1', [ID.lot1])).t
  ok(op.r.stare === 'oprit' && await dupa(opDb, op.t1) && !(await dupa(op.t0, opDb)),
    `CEASUL opririi: tranzacția a așteptat 0,2 s ÎNAINTEA apelului → momentul opririi (${opDb}) ≥ ceasul de dinaintea apelului (${op.t1}), > începutul tranzacției (${op.t0}); 58abaa54: = începutul`)
  const jo = (await db.query(`SELECT date_noi FROM public.red_jurnal WHERE tabela = 'red_fan_loturi' ORDER BY id DESC LIMIT 1`)).rows[0].date_noi
  ok(jo.eveniment === 'tiraj_oprit' && await dupa(jo.la, opDb) && await dupa(opDb, jo.la), 'jurnalul opririi poartă ACELAȘI moment efectiv („la”)')
  ok(await cod(tiraj(ID.owner, ID.lot1, H('4'), H('2'))) === 'RD022', 'imediat după oprire (oprirea nu e retrodatată de pauza ei): înlocuirea → RD022')
  // comparația tot pe ceasul efectiv, sub lock: oprirea la −29,9 s; tranzacția înlocuirii ÎNCEPE sub 30 s, apelul vine după 0,2 s (30,1 s)
  await db.query(`UPDATE public.red_fan_loturi SET tiraj_oprit_la = clock_timestamp() - interval '29.9 seconds' WHERE lot_id = $1`, [ID.lot1])
  const inl = await cod(inTx(ID.owner, async () => { await db.query('SELECT pg_sleep(0.2)'); return db.query('SELECT public.fn_red_fan_tiraj($1, $2, $3) AS t', [ID.lot1, H('4'), H('2')]) }))
  const fl4 = await val(db, 'SELECT tiraj_cheie, tiraj_nr, tiraj_oprit_la FROM public.red_fan_loturi WHERE lot_id = $1', [ID.lot1])
  ok(inl === 'OK' && fl4.tiraj_cheie === H('4') && fl4.tiraj_nr === 3 && fl4.tiraj_oprit_la === null,
    `comparația celor 30 s pe ceasul efectiv: tranzacția începută la 29,9 s, apelul la 30,1 s → înlocuit (nr. 3) (${inl}; cu now() ar fi RD022)`)

  // ── runda 5: ceasul REZERVĂRII (claim) și al celor 10 minute ale reconcilierii; apoi SOLUȚIONAREA contradicțiilor (Jakarinos #1118 r4 P2) ──
  // un rând nou cu AWB în lotul 1: plicul 2 (re-propus mai sus cu hash-ul „e”) → aprobat → rezervat (după o pauză în tranzacția claim-ului)
  const r2b = await rand(2)
  ok(r2b?.stare === 'propus' && await cod(aproba(ID.owner, ID.lot1, [r2b.id], [H('e')])) === 'OK', 'plicul 2: rândul nou aprobat')
  const s2b = await surse(db, 2)
  const cl = await inTx(ID.owner, async () => {
    await db.query('SELECT pg_sleep(0.2)'); const t1 = await ceas()
    const c = (await db.query('SELECT public.fn_red_fan_claim_lot($1, $2, $3, $4) AS c', [ID.lot1, [r2b.id], [H('e')], [s2b]])).rows[0].c
    return { t1, c }
  })
  const upd = (await val(db, 'SELECT updated_at::text AS t, stare FROM public.red_fan_awb WHERE id = $1', [r2b.id]))
  ok(upd.stare === 'in_curs' && await dupa(upd.t, cl.t1), `CEASUL rezervării: updated_at (${upd.t}) ≥ ceasul de dinaintea claim-ului (${cl.t1}), nu începutul tranzacției`)
  const rec = (uid, p) => ca(db, uid, 'SELECT public.fn_red_fan_reconciliaza($1, $2, NULL, NULL, $3) AS s', [r2b.id, p, 'găsit în borderou'])
  await db.query(`UPDATE public.red_fan_awb SET updated_at = clock_timestamp() - interval '9 minutes 59.9 seconds' WHERE id = $1`, [r2b.id])
  ok(await cod(rec(ID.owner, '1000000002')) === 'P0001', 'în curs de 9 min 59,9 s: reconcilierea refuzată (generarea poate fi în desfășurare)')
  await db.query(`UPDATE public.red_fan_awb SET updated_at = clock_timestamp() - interval '9 minutes 59.9 seconds' WHERE id = $1`, [r2b.id])
  const rc = await cod(inTx(ID.owner, async () => { await db.query('SELECT pg_sleep(0.2)'); return db.query('SELECT public.fn_red_fan_reconciliaza($1, $2, NULL, NULL, $3)', [r2b.id, '1000000002', 'găsit în borderou']) }))
  ok(rc === 'OK' && (await rand(2)).stare === 'generat', `cele 10 minute pe ceasul efectiv: tranzacția începută la 9:59,9, apelul la 10:00,1 → generat (${rc}; cu now() ar fi P0001)`)

  // SOLUȚIONAREA: reproducerea recenzentului cu PARSERUL REAL — C0 10.11 → C0 11.11 → C0 10.11 (corect) + S30 mai nou
  const A2 = '1000000002'
  const sol = (uid, id, v, alegeri, motiv) => ca(db, uid, 'SELECT public.fn_red_fan_urmarire_solutioneaza($1, $2, $3::jsonb, $4) AS r', [id, v, alegeri === undefined ? null : JSON.stringify(alegeri), motiv])
  const jSol = async id => (await db.query(`SELECT date_vechi, date_noi, user_id, actiune FROM public.red_jurnal WHERE tabela = 'red_fan_awb' AND inregistrare_id = $1 ORDER BY id`, [id])).rows
  await urmFan(r2b, ID.lot1, A2, 0, [['C0', '2026-11-10 10:00:00']])
  await eF(r2b.id, F('ridicat', 'C0', '2026-11-10', null, null, false, null, null, null, 1), 'r2b: C0 pe 10.11 → ridicat')
  await urmFan(r2b, ID.lot1, A2, 1, [['C0', '2026-11-11 10:00:00']])
  await eF(r2b.id, F('de_verificat', 'C0', '2026-11-10', null, null, false, '2026-11-11', null, null, 2), 'r2b: C0 pe 11.11 → contradicție, de verificat')
  await urmFan(r2b, ID.lot1, A2, 2, [['C0', '2026-11-10 10:00:00'], ['S30', '2026-11-12 08:00:00']])
  await eF(r2b.id, F('de_verificat', 'S30', '2026-11-10', null, null, false, '2026-11-11', null, null, 3),
    'REPRODUCEREA RECENZENTULUI: răspunsul ulterior „bun” (C0 10.11 + S30) NU șterge contradicția automat — rămâne de verificat de om')
  const ALEG = { ridicat: 'cunoscut' }, MOT = 'verificat în selfAWB: C0 pe 10.11'
  ok(await cod(sol(ID.editor, r2b.id, 3, ALEG, MOT)) === '42501' && await cod(sol(ID.viewer, r2b.id, 3, ALEG, MOT)) === '42501'
    && await cod(sol(ID.strain, r2b.id, 3, ALEG, MOT)) === '42501' && await cod(sol(null, r2b.id, 3, ALEG, MOT)) === '42501',
    'soluționarea: editor / viewer / cont fără drept / anonim refuzați (poarta în corp: owner sau admin Redări)')
  ok(await cod(sol(ID.admin, r2b.id, 2, ALEG, MOT)) === 'RD023', 'soluționarea cu versiunea VECHE (2, acum 3: un răspuns FAN a sosit între timp) → RD023, nimic scris (CAS)')
  ok(await cod(sol(ID.admin, r2b.id, 3, ALEG, '   ')) === '22023' && await cod(sol(ID.admin, r2b.id, 3, ALEG, null)) === '22023'
    && await cod(sol(ID.admin, r2b.id, 3, ALEG, 'x'.repeat(501))) === '22023', 'soluționarea fără motiv / cu motiv gol / peste 500 de caractere → 22023 (fără tăiere)')
  ok(await cod(sol(ID.admin, r2b.id, 3, {}, MOT)) === '22023' && await cod(sol(ID.admin, r2b.id, 3, { ridicat: 'altceva' }, MOT)) === '22023'
    && await cod(sol(ID.admin, r2b.id, 3, { ridicat: 'cunoscut', livrat: 'nou' }, MOT)) === '22023' && await cod(sol(ID.admin, r2b.id, 3, { ridicat: true }, MOT)) === '22023'
    && await cod(sol(ID.admin, r2b.id, 3, undefined, MOT)) === '22023', 'alegerile: goale / valoare nepermisă / fapt în plus / tip greșit / lipsă → 22023')
  ok((await jSol(r2b.id)).length === 0 && (await fapte(r2b.id)).v === 3, 'după refuzuri: nimic în jurnal, versiunea neschimbată (3)')
  const v1 = await val(db, 'SELECT versiune_urmarire AS v FROM public.red_fan_awb WHERE id = $1', [r1.id])
  ok(await cod(sol(ID.owner, r1.id, v1.v, ALEG, MOT)) === 'P0001', 'rând fără contradicție → P0001 (nimic de soluționat)')
  const v3 = await val(db, 'SELECT versiune_urmarire AS v, stare FROM public.red_fan_awb WHERE id = $1', [r3.id])
  ok(v3.stare === 'anulat' && await cod(sol(ID.owner, r3.id, v3.v, { livrat_retur: 'livrat' }, MOT)) === 'P0001', 'rând anulat (cu contradicție) → P0001 (doar generat / ridicat)')
  // calea legitimă: un admin Redări (ne-owner) alege valoarea CUNOSCUTĂ
  const rs = (await sol(ID.admin, r2b.id, 3, ALEG, '  ' + MOT + ' ')).rows[0].r
  ok(rs.stare === 'ridicat' && rs.versiune === 4 && JSON.stringify(rs.solutionate) === '["ridicat"]', 'admin Redări: soluționat → ' + JSON.stringify(rs))
  await eF(r2b.id, F('ridicat', 'S30', '2026-11-10', null, null, false, null, null, null, 4), 'după soluționare: faptul ales (10.11), contradicția golită, starea RECALCULATĂ din fapte (ridicat), versiunea 4')
  const js1 = await jSol(r2b.id)
  ok(js1.length === 1 && js1[0].actiune === 'update' && js1[0].user_id === ID.admin && js1[0].date_noi.eveniment === 'urmarire_solutionata'
    && js1[0].date_vechi.ridicat_contrazis === '2026-11-11' && js1[0].date_vechi.ridicat_propus === '2026-11-10' && js1[0].date_vechi.versiune_urmarire === 3
    && js1[0].date_vechi.urmarire_stare === 'de_verificat' && JSON.stringify(js1[0].date_noi.alegeri) === JSON.stringify(ALEG) && js1[0].date_noi.motiv === MOT
    && JSON.stringify(js1[0].date_noi.contrazise) === '["ridicat"]' && typeof js1[0].date_noi.la === 'string' && js1[0].date_noi.versiune_urmarire === 4,
    'jurnalul: ce era contrazis (11.11 vs 10.11, versiunea 3), ce s-a ales, motivul (fără spații la capete), cine = auth.uid() (admin), când („la”): ' + JSON.stringify(js1.map(j => j.date_noi.eveniment)))
  ok(await cod(sol(ID.admin, r2b.id, 4, ALEG, MOT)) === 'P0001' && (await jSol(r2b.id)).length === 1, 'repetată după soluționare → P0001, niciun rând nou în jurnal')
  ok((await urmFan(r2b, ID.lot1, A2, 3, [['C0', '2026-11-10 10:00:00'], ['S30', '2026-11-12 08:30:00']])).depasite === 1, 'un răspuns citit ÎNAINTEA soluționării (versiunea 3) → depășit, nescris')
  ok(await cod(db.query(`UPDATE public.red_fan_awb SET ridicat_contrazis = ridicat_propus, urmarire_stare = 'de_verificat' WHERE id = $1`, [r2b.id])) === '23514',
    'CHECK red_fan_awb_contradictii: o „contradicție” egală cu faptul e refuzată pe orice cale')
  // un răspuns ulterior care contrazice din nou REDESCHIDE verificarea; un răspuns „bun” după el NU o închide
  await urmFan(r2b, ID.lot1, A2, 4, [['C0', '2026-11-11 10:00:00'], ['S30', '2026-11-12 09:00:00']])
  await eF(r2b.id, F('de_verificat', 'S30', '2026-11-10', null, null, false, '2026-11-11', null, null, 5), 'C0 pe 11.11 din nou, după soluționare → verificarea REDESCHISĂ')
  ok(await cod(db.query(`UPDATE public.red_fan_awb SET ridicat_propus = NULL WHERE id = $1`, [r2b.id])) === '23514', 'CHECK red_fan_awb_contradictii: o contradicție fără faptul ei e refuzată')
  await urmFan(r2b, ID.lot1, A2, 5, [['C0', '2026-11-10 10:00:00'], ['S30', '2026-11-12 10:00:00']])
  await eF(r2b.id, F('de_verificat', 'S30', '2026-11-10', null, null, false, '2026-11-11', null, null, 6), 'apoi un răspuns „bun” → tot de verificat (nimic nu se șterge automat)')
  const rs2 = (await sol(ID.owner, r2b.id, 6, { ridicat: 'nou' }, 'FAN a confirmat ridicarea pe 11.11')).rows[0].r
  await eF(r2b.id, F('ridicat', 'S30', '2026-11-11', null, null, false, null, null, null, 7), 'owner: valoarea NOUĂ (11.11) aleasă → faptul = 11.11: ' + JSON.stringify(rs2))
  ok((await jSol(r2b.id)).length === 2 && (await jSol(r2b.id))[1].user_id === ID.owner, 'a doua soluționare: al doilea rând în jurnal (owner)')
  // r4 (lotul de TEST): PATRU fapte contrazise (ridicare, livrare, motiv, livrat ȘI retur); alegerile construite cu helper-ul JS (paritate L19)
  const r4f = await val(db, `SELECT id, versiune_urmarire, ridicat_propus::text AS ridicat_propus, ridicat_contrazis::text AS ridicat_contrazis, livrat_la::text AS livrat_la,
    livrat_contrazis::text AS livrat_contrazis, retur_propus, retur_contrazis, retur_cunoscut FROM public.red_fan_awb WHERE id = $1`, [r4.id])
  const cer4 = FAN.fapteContrazise(r4f).map(f => f.cheie)
  ok(JSON.stringify(cer4) === '["ridicat","livrat","retur","livrat_retur"]', 'paritate JS ↔ SQL: fapteContrazise = ridicat, livrat, retur, livrat_retur: ' + JSON.stringify(cer4))
  ok(await cod(sol(ID.owner, r4.id, r4f.versiune_urmarire, { ridicat: 'nou', livrat: 'cunoscut', retur: 'nou' }, MOT)) === '22023', 'r4: fără alegerea „livrat ȘI retur” → 22023')
  const ALEG4 = Object.fromEntries(cer4.map(k => [k, { ridicat: 'nou', livrat: 'cunoscut', retur: 'nou', livrat_retur: 'retur' }[k]]))
  const rs4 = (await sol(ID.owner, r4.id, r4f.versiune_urmarire, ALEG4, 'verificat în selfAWB: retur, motiv mutat')).rows[0].r
  await eF(r4.id, F('retur', 'S2', '2026-11-10', null, 'mutat', true, null, null, null, r4f.versiune_urmarire + 1),
    'r4: ridicarea nouă (10.11), returul ales (livrarea scoasă), motivul nou (mutat) → „retur”, contradicțiile golite: ' + JSON.stringify(rs4))
  const r4d = await val(db, 'SELECT ridicat_contrazis, livrat_contrazis, retur_contrazis, livrat_la, retur_cunoscut FROM public.red_fan_awb WHERE id = $1', [r4.id])
  ok(FAN.fapteContrazise(r4d).length === 0 && (await val(db, 'SELECT awb, data_expediere FROM public.red_plicuri WHERE id = $1', [plicId(4)])).awb === null,
    'după soluționare: nicio contradicție (și în JS); plicul NU e atins (soluționarea scrie doar evidența FAN)')
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

// ── 1b. runda 5 (Jakarinos #1118 r4 P1): REPRODUCEREA RECENZENTULUI pe ceasul real — tranzacția opririi așteaptă 30,2 s ÎNAINTEA apelului,
// oprește, comite; înlocuirea din tranzacția următoare. Pe migrarea de acum: RD022 (oprirea are momentul efectiv). Pe forma 58abaa54
// (now() la oprire și la comparație, ca mutant): înlocuită la câteva ms de la oprire — dovada că proba prinde defectul. ~61 s.
console.log('1b. ceasul opririi: reproducerea recenzentului (30,2 s înaintea opririi), pe migrarea de acum și pe forma 58abaa54')
const FORMA_58ABAA54 = [['UPDATE public.red_fan_loturi SET tiraj_oprit_la = v_la, tiraj_oprit_de = auth.uid()', 'UPDATE public.red_fan_loturi SET tiraj_oprit_la = now(), tiraj_oprit_de = auth.uid()'],
  [" OR v_fl.tiraj_oprit_la > clock_timestamp() - interval '30 seconds' THEN", " OR v_fl.tiraj_oprit_la > now() - interval '30 seconds' THEN"]]
for (const [eticheta, text, asteptat] of [['migrarea de acum', MIG, 'RD022'], ['forma 58abaa54 (now())', aplica(MIG, FORMA_58ABAA54), 'OK']]) {
  const db = await bazaNoua()
  await aplicaMig(db, text)
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${ID.owner}', false); SELECT public.fn_red_fan_lot_marcheaza('${ID.lot3}', true);
    SELECT public.fn_red_fan_tiraj('${ID.lot3}', '${H('1')}', NULL);`)
  await db.exec(`SET ROLE authenticated; BEGIN; SELECT pg_sleep(30.2); SELECT public.fn_red_fan_tiraj_opreste('${ID.lot3}', '${H('1')}', true); COMMIT; RESET ROLE;`)
  const t0 = Date.now()
  let r = 'OK'
  try { await db.exec(`SET ROLE authenticated; SELECT public.fn_red_fan_tiraj('${ID.lot3}', '${H('2')}', '${H('1')}');`) } catch (e) { r = e.code || e.message } finally { await db.exec('RESET ROLE') }
  const ms = Date.now() - t0
  ok(r === asteptat, `${eticheta}: 30,2 s de așteptare ÎNAINTEA opririi, apoi înlocuirea la ${ms} ms de la oprire → ${r} (așteptat ${asteptat})`)
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
  // runda 4: istoric FAN în jurnalul append-only (aici scris direct de proprietar, fără rândul lotului) = refuz, jurnalul nu se șterge
  ['istoric FAN în red_jurnal', db => db.exec(`INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi) VALUES ('red_fan_loturi', '${ID.lot3}', 'update', '{"eveniment":"tiraj_inceput"}');`),
    /red_jurnal are istoric FAN/],
  // runda 5: o soluționare a urmăririi în jurnal (tabela red_fan_awb; rândul FAN însuși ar fi refuzat oricum) = refuz, jurnalul nu se șterge
  ['istoric de soluționare în red_jurnal', db => db.exec(`INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi) VALUES ('red_fan_awb', '${plicId(1)}', 'update', '{"eveniment":"urmarire_solutionata"}');`),
    /red_jurnal are istoric FAN \(tiraje \/ solutionari\)/],
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
  ['urmărire fără CAS pe versiune (runda 2)', '   WHERE a.id = m.id AND a.versiune_urmarire = m.versiune\n', '   WHERE a.id = m.id\n'],
  ['urmărire fără garda timpului evenimentului', '     AND (a.ultim_eveniment_la IS NULL OR (m.n_la IS NOT NULL AND m.n_la >= a.ultim_eveniment_la));', ';'],
  // runda 3
  ['urmărire: răspunsul fără cronologie suprascrie evenimentul cunoscut (forma 0716f5b3)',
    'WHERE a.id = u.id AND a.versiune_urmarire = u.versiune AND a.ultim_eveniment_la IS NOT NULL AND u.ultim_eveniment_la IS NULL;', 'WHERE false;',
    '     AND (a.ultim_eveniment_la IS NULL OR (m.n_la IS NOT NULL AND m.n_la >= a.ultim_eveniment_la));',
    '     AND (a.ultim_eveniment_la IS NULL OR m.n_la IS NULL OR m.n_la >= a.ultim_eveniment_la);'],
  ['urmărire: ridicarea cunoscută ștearsă de un răspuns fără ea', 'coalesce(b.ridicat_propus, n.rid) AS ridicat', 'n.rid AS ridicat'],
  // runda 4 (r3 P2: faptele urmăririi; r3 P1: oprirea tirajului + jurnalul)
  ['urmărire: motivul de retur scris direct din răspuns (forma fdaa0496)', 'coalesce(b.retur_propus, u.retur_propus) AS motiv', 'u.retur_propus AS motiv'],
  ['urmărire: livrarea cunoscută ștearsă de un răspuns fără ea', 'coalesce(b.livrat_la, n.liv) AS livrat', 'n.liv AS livrat'],
  ['urmărire: valoarea nouă înlocuiește faptul cunoscut', 'coalesce(b.ridicat_propus, n.rid) AS ridicat', 'coalesce(n.rid, b.ridicat_propus) AS ridicat'],
  ['urmărire: contradicția pe ridicare nedetectată', 'coalesce(b.ridicat_contrazis, CASE WHEN n.rid <> b.ridicat_propus THEN n.rid END) AS c_rid', 'b.ridicat_contrazis AS c_rid'],
  ['urmărire: contradicția pe motiv nedetectată', 'coalesce(b.retur_contrazis, CASE WHEN u.retur_propus <> b.retur_propus THEN u.retur_propus END) AS c_ret', 'b.retur_contrazis AS c_ret'],
  ['urmărire: livrat ȘI retur nu e contradicție', ' OR (f.livrat IS NOT NULL AND f.retur)) AS contradictie', ') AS contradictie',
    "         OR (livrat_la IS NOT NULL AND retur_cunoscut))))", '         )))'],
  ['urmărire: starea nu ține cont de fapte (un parțial coboară „retur” / „livrat”)', "WHEN m.retur THEN 'retur'", "WHEN false THEN 'retur'",
    "WHEN m.livrat IS NOT NULL THEN 'livrat'", "WHEN false THEN 'livrat'"],
  ['urmărire: returul cunoscut uitat', '(b.retur_cunoscut OR u.urmarire_stare = ', '(u.urmarire_stare = '],
  ['tiraj: descărcarea trece cu tirajul oprit (și reverificarea finală)', "    IF v_fl.tiraj_oprit_la IS NOT NULL THEN\n      RAISE EXCEPTION 'redari fan: descarcarile", "    IF false THEN\n      RAISE EXCEPTION 'redari fan: descarcarile"],
  ['tiraj: înlocuirea fără oprire', "ELSIF v_fl.tiraj_oprit_la IS NULL OR v_fl.tiraj_oprit_la > clock_timestamp() - interval '30 seconds' THEN", 'ELSIF false THEN'],
  ['tiraj: înlocuirea fără cele 30 s', " OR v_fl.tiraj_oprit_la > clock_timestamp() - interval '30 seconds' THEN", ' THEN'],
  // runda 5 (r4 P1): ceasul
  ['tiraj: oprirea cu now() (forma 58abaa54: retrodatată cu așteptarea dinaintea apelului)', 'UPDATE public.red_fan_loturi SET tiraj_oprit_la = v_la, tiraj_oprit_de = auth.uid()',
    'UPDATE public.red_fan_loturi SET tiraj_oprit_la = now(), tiraj_oprit_de = auth.uid()'],
  ['tiraj: cele 30 s comparate cu now() (forma 58abaa54)', " OR v_fl.tiraj_oprit_la > clock_timestamp() - interval '30 seconds' THEN", " OR v_fl.tiraj_oprit_la > now() - interval '30 seconds' THEN"],
  ['claim: rezervarea cu now()', "updated_at = clock_timestamp() WHERE id = ANY(p_ids);", "updated_at = now() WHERE id = ANY(p_ids);"],
  ['reconciliere: cele 10 minute comparate cu now()', "v_rand.updated_at < clock_timestamp() - interval '10 minutes'", "v_rand.updated_at < now() - interval '10 minutes'"],
  ['tiraj: înlocuirea nu șterge oprirea', '           tiraj_oprit_la = NULL, tiraj_oprit_de = NULL WHERE lot_id = p_lot_id;\n    INSERT', '           tiraj_oprit_la = tiraj_oprit_la WHERE lot_id = p_lot_id;\n    INSERT'],
  ['tiraj: fără evidența în jurnal (forma fdaa0496)', "    INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)\n    VALUES ('red_fan_loturi', p_lot_id, 'update',\n",
    "    PERFORM * FROM (\n    VALUES ('red_fan_loturi', p_lot_id, 'update',\n",
    "jsonb_build_object('eveniment', 'tiraj_' || v_stare, 'tiraj_cheie', p_cheie, 'tiraj_nr', v_fl.tiraj_nr + 1, 'la', v_la), auth.uid());",
    "jsonb_build_object('eveniment', 'tiraj_' || v_stare, 'tiraj_cheie', p_cheie, 'tiraj_nr', v_fl.tiraj_nr + 1, 'la', v_la), auth.uid())) x;"],
  ['tiraj: jurnalul fără autor', "jsonb_build_object('eveniment', 'tiraj_' || v_stare, 'tiraj_cheie', p_cheie, 'tiraj_nr', v_fl.tiraj_nr + 1, 'la', v_la), auth.uid());",
    "jsonb_build_object('eveniment', 'tiraj_' || v_stare, 'tiraj_cheie', p_cheie, 'tiraj_nr', v_fl.tiraj_nr + 1, 'la', v_la), NULL);"],
  ['tiraj: oprirea fără jurnal', '  IF v_schimbat THEN', '  IF false THEN'],
  ['tiraj: oprirea deschisă editorului', "IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul opreste", "IF auth.uid() IS NULL THEN RAISE EXCEPTION 'redari fan: doar owner-ul opreste"],
  ['tiraj: oprirea fără CAS pe cheie', "  IF v_fl.tiraj_cheie IS DISTINCT FROM p_cheie THEN\n    RAISE EXCEPTION 'redari fan: tirajul s-a schimbat (tirajul curent", "  IF false THEN\n    RAISE EXCEPTION 'redari fan: tirajul s-a schimbat (tirajul curent"],
  ['tiraj: o cheie nouă suprascrie tirajul început', "ELSIF v_fl.tiraj_cheie IS NULL THEN v_stare := 'inceput';", "ELSIF true THEN v_stare := 'inceput';"],
  ['tiraj: înlocuirea fără CAS pe cheia veche', 'IF v_fl.tiraj_cheie IS DISTINCT FROM p_inlocuieste THEN', 'IF false THEN'],
  ['tiraj: înlocuirea deschisă editorului', 'OR (p_inlocuieste IS NOT NULL AND NOT public.fn_red_fan_e_owner()) THEN', 'THEN'],
  ['tiraj: deschis viewer-ului', "IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor')\n     OR (p_inlocuieste", "IF auth.uid() IS NULL\n     OR (p_inlocuieste"],
  ['confirmări fără CAS pe versiune', 'WHERE a.id = c.id AND a.versiune_urmarire = c.versiune;', 'WHERE a.id = c.id;'],
  ['propunerea re-propune și un AWB generat', "IF v_rand.stare NOT IN ('propus', 'aprobat') THEN", "IF v_rand.stare NOT IN ('propus', 'aprobat', 'generat', 'in_curs') THEN"],
  ['scriere directă permisă', 'REVOKE ALL ON public.red_fan_setari, public.red_fan_loturi, public.red_fan_awb FROM PUBLIC, anon, authenticated, service_role;', ''],
  // runda 5 (r4 P2): soluționarea contradicțiilor
  ['soluționarea fără poarta de rol (doar EXECUTE)', "IF auth.uid() IS NULL OR NOT (public.fn_red_fan_e_owner() OR coalesce(public.fn_red_nivel(), '') = 'admin') THEN", 'IF auth.uid() IS NULL THEN'],
  ['soluționarea doar pentru owner (admin-ul Redări refuzat)', "IF auth.uid() IS NULL OR NOT (public.fn_red_fan_e_owner() OR coalesce(public.fn_red_nivel(), '') = 'admin') THEN", 'IF NOT public.fn_red_fan_e_owner() THEN'],
  ['soluționarea fără CAS pe versiune', '  IF v_r.versiune_urmarire IS DISTINCT FROM p_versiune THEN', '  IF false THEN', '   WHERE id = p_id AND versiune_urmarire = p_versiune;', '   WHERE id = p_id;'],
  ['soluționarea fără motiv obligatoriu', " OR v_motiv IS NULL OR v_motiv !~ '[^[:space:]]' OR length(v_motiv) > 500 THEN", ' THEN'],
  ['soluționarea fără jurnal', "  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)\n  VALUES ('red_fan_awb', p_id, 'update',",
    "  PERFORM * FROM (\n  VALUES ('red_fan_awb', p_id, 'update',", "'retur_cunoscut', v_ret, 'retur_propus', v_mot), auth.uid());", "'retur_cunoscut', v_ret, 'retur_propus', v_mot), auth.uid())) x;"],
  ['soluționarea: jurnalul fără ce era contrazis', "'ridicat_propus', v_r.ridicat_propus, 'ridicat_contrazis', v_r.ridicat_contrazis,", "'ridicat_propus', v_r.ridicat_propus,"],
  ['soluționarea acceptă alegeri incomplete', '  IF v_chei IS DISTINCT FROM (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(v_cer) x)\n     OR EXISTS', '  IF false\n     OR EXISTS'],
  ['soluționarea nu recalculează starea din fapte', '         ridicat_contrazis = NULL, livrat_contrazis = NULL, retur_contrazis = NULL, urmarire_stare = v_stare,',
    "         ridicat_contrazis = NULL, livrat_contrazis = NULL, retur_contrazis = NULL, urmarire_stare = 'de_verificat',"],
  ['soluționarea ignoră „livrat ȘI retur”', "  ELSIF p_alegeri ->> 'livrat_retur' = 'retur' THEN v_liv := NULL;", '  ELSIF false THEN v_liv := NULL;'],
  ['urmărire: contradicția ștearsă automat la un răspuns ulterior „bun”', 'coalesce(b.ridicat_contrazis, CASE WHEN n.rid <> b.ridicat_propus THEN n.rid END) AS c_rid',
    'CASE WHEN n.rid <> b.ridicat_propus THEN n.rid END AS c_rid'],
]
for (const [nume, ...perechi] of MUTANTI) {
  const lista = []
  for (let i = 0; i < perechi.length; i += 2) lista.push([perechi[i], perechi[i + 1]])
  let m
  try { m = aplica(MIG, lista) } catch (e) { ok(false, `mutantul „${nume}” nu se aplică exact o dată`); continue }
  const f = []
  let db = null
  try { db = await bazaNoua(); await aplicaMig(db, m); await verificari(db, false, f) } catch (e) { f.push('excepție la aplicare / verificare: ' + (e.code || e.message)) }
  finally { if (db) await db.close() }
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
