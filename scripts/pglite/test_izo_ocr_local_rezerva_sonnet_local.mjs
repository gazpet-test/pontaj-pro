// Proba LOCALĂ a migrării 20270109a (Izometrie E3 / OCR local: rezerva apelului plătit 0,05 → 0,20 USD, fallback + arbitraj pe Sonnet 5.5)
// pe PGlite — NU atinge nicio bază reală.
// Baza: roluri tip Supabase + public.profiles minimal + migrările REALE 20261105a (plafonul AI), 20261108a + 20261108b (coada OCR local),
//   aplicate cu marcajul runnerului (gazpet.livrare_migrare). Migrarea și revenirea rulează ca runnerul: plafonul tranzacției (5000 / 2000,
//   sesiune) + marcajul prologului; pentru migrare, PAȘII REALI L15 v2 ai runnerului (scripts/livrare_amprenta_gen.sh: „înainte” cu tabela
//   ag_ina_<T> calculată din blocul AG_CATALOG v2, „după” = diferența globală), plus garda finală reală (lm_fin din scripts/livrare_mesaj.sh).
//   Runda 2 (Jakarinos #1183): tabela „înainte” nu mai e simulată.
// 0. Validatorul runnerului (scripts/livrare_validator.py): migrarea cu 5000 (2000 / fără plafon = refuz), revenirea cu 2000 (5000 = refuz).
// 1. Amprentele din migrare / revenire = calculate aici: corpul fn_ocr_local_rezerva_apel (din textul 20261108a ȘI din baza aplicată), ACL-ul,
//    lista CHECK-urilor (deparsate de server) = blocurile „CHECK-URI”; lock-ul (blocul $lock$, NOWAIT) înaintea verificărilor.
// 2. Semantica: înainte, fn_ocr_local_rezerva_apel rezervă 0,05; după migrare 0,20 (= costul maxim Sonnet 0,196 rotunjit); după revenire 0,05;
//    reaplicarea după revenire merge.
// 3. Livrarea L15 v2 completă: manifestul generat (ROLLBACK, nimic comis) = lista revizuită supabase/tests/<NUME>.l15.obiecte.tsv; livrarea
//    aprobată (GLOBAL + manifest) trece cu garda finală (PLAFON_TIMP, LOCK_TINUT declarat); GLOBAL greșit / manifest incomplet = refuz al
//    RUNNERULUI, nimic schimbat; dry-run-ul de pe clonă (supabase/tests/<NUME>_dryrun.sql) rulează aici, pe RPC-urile reale, și nu lasă nimic.
// 4. Refuzurile migrării (nimic schimbat): fără marcaj, fără plafon / alt plafon, fără pasul L15 v2, CHECK schimbat, RPC schimbat.
// 5. MUTANȚI pe textul migrării / revenirii.
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_izo_ocr_local_rezerva_sonnet_local.mjs
//   (--scrie-obiecte rescrie lista revizuită L15 din manifestul generat)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'rezsonnet_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const NUME = '20270109a_izo_ocr_local_rezerva_sonnet', NUME_REV = NUME + '_ROLLBACK'
const F_MIG = `supabase/migrations/${NUME}.sql`
const F_REV = `supabase/revenire/${NUME_REV}.sql`
const F_OBIECTE = `supabase/tests/${NUME}.l15.obiecte.tsv`
const F_DRY = `supabase/tests/${NUME}_dryrun.sql`
const MIG = citeste(F_MIG), REV = citeste(F_REV), DRY = citeste(F_DRY)
const M05A = citeste('supabase/migrations/20261105a_ai_plafon_lunar.sql')
const M08A = citeste('supabase/migrations/20261108a_ocr_local_cereri.sql')
const M08B = citeste('supabase/migrations/20261108b_ocr_local_admite_fix.sql')

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }
function corp(text, cap) {
  const i = text.indexOf(cap)
  if (i < 0) throw new Error('nu găsesc ' + cap)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(text.slice(i))
  const start = i + a.index + a[0].length
  return text.slice(start, text.indexOf(a[1], start))
}
// uneltele runnerului (aceleași funcții ca livrare_migrare.sh): pașii L15 v2, validatorul, plafonul, garda finală
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const validator = (fisier, ...opt) => {
  try {
    const o = execFileSync('bash', ['-c', 'exec python3 "$@"', '_', join(ROOT, 'scripts/livrare_validator.py'), fisier, 'reg_0123456789abcdef', ...opt],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, out: o.trim() }
  } catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() } }
}
const PLAFON_LIVRARE = Number(execFileSync('bash', ['-c', '. "$1"; printf %s "$AG_PLAFON_MS"', '_', join(ROOT, 'scripts/livrare_amprenta.sh')], { encoding: 'utf8' }))
const PLAFON_REVENIRE = 2000
const garda = (nume, plafon, final) => execFileSync('bash', ['-c', '. "$1"; lm_fin "$2" "$3" "$4" lock', '_', join(ROOT, 'scripts/livrare_mesaj.sh'), nume, String(plafon), final], { encoding: 'utf8' })

// Schema falsă minimă tip Supabase: rolurile (service_role cu BYPASSRLS), profiles (FK-ul cozii), auth.uid() din claim.
const SCHELET = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_owner boolean NOT NULL DEFAULT false);
INSERT INTO public.profiles(id) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc');`

async function bazaNoua() {
  const db = await PGlite.create()
  await db.exec(SCHELET)
  for (const [nume, text] of [['20261105a_ai_plafon_lunar', M05A], ['20261108a_ocr_local_cereri', M08A], ['20261108b_ocr_local_admite_fix', M08B]]) {
    await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);\n${text}\nCOMMIT;`)
  }
  return db
}
// Livrarea ca runnerul: plafonul de sesiune ÎNAINTE de BEGIN, marcajele prologului; pentru migrare pasul „înainte” REAL (aprobat sau „-”),
// opțional pasul „după” (manifest „-” = generatorul de manifest, altfel diferența comparată EXACT cu manifestul) și instrucțiunea finală.
async function livreaza(db, text, { nume = NUME, plafon = PLAFON_LIVRARE, marcajPlafon = plafon, ag = true, marcaj = true, aprobat = '-', manifest = null, final = 'COMMIT' } = {}) {
  await db.exec(plafon === null ? 'RESET transaction_timeout' : `SET transaction_timeout = ${plafon}`)
  const T = randomBytes(8).toString('hex')
  const prolog = [
    marcaj ? `SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);` : '',
    marcajPlafon === null ? '' : `SELECT set_config('gazpet.plafon_tranzactie', '${marcajPlafon}:' || txid_current(), true);`,
  ].join('\n')
  const ina = ag ? gen('inainte', T, aprobat) : ''
  const dupa = ag && manifest !== null ? gen('dupa', T, aprobat, manifest) : ''
  const note = []
  try {
    await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED;\n${prolog}`)
    await db.exec(`${ina}\n${text}\n;\n${dupa}`, { onNotice: n => note.push(n.message) })
    await db.exec(final, { onNotice: n => note.push(n.message) })
    return { ok: true, note }
  } catch (e) {
    try { await db.exec('ROLLBACK') } catch { /* deja închisă */ }
    return { ok: false, eroare: String(e.message), note }
  } finally {
    await db.exec('RESET transaction_timeout')
  }
}
const stare = async db => {
  const r = await db.query(`SELECT c.rezerva_usd::text AS rezerva, (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute t
      ON t.attrelid = d.adrelid AND t.attnum = d.adnum WHERE d.adrelid = 'public.ocr_local_config'::regclass AND t.attname = 'rezerva_usd') AS implicit,
    (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ocr_local_config_rezerva_usd_check') AS check_def
    FROM public.ocr_local_config c`)
  return r.rows[0]
}
// O cerere în fallback cu dreptul acordat (ca după fn_ocr_local_drept_platit) → fn_ocr_local_rezerva_apel → suma rezervată.
let nrCerere = 0
async function rezerva(db) {
  const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(++nrCerere).padStart(12, '0')}`
  await db.exec(`INSERT INTO public.ocr_local_cereri (id, proiect_id, depozit_id, sablon, creat_de, pdf_bytes, stare, ramura, termen_upload, termen_preluare,
      termen_local, termen_fallback, drept_platit_de, drept_platit_la, apel_faza, sterge_dupa)
    VALUES ('${id}', 1, 2, 'aviz_teava', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 1000, 'fallback', 'haiku', now(), now(), now() + interval '1 hour',
      now() + interval '1 hour', 'fallback', now(), 'acordat', now() + interval '7 days')`)
  const r = await db.query(`SELECT * FROM public.fn_ocr_local_rezerva_apel('${id}')`)
  const s = await db.query(`SELECT suma_rezervata::text AS suma FROM public.ai_plafon_rezervari WHERE id = $1`, [r.rows[0].rezervare_id])
  return { acordat: r.rows[0].acordat, suma: s.rows[0]?.suma }
}
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
const numarari = async db => (await db.query(`SELECT (SELECT count(*) FROM public.ocr_local_cereri)::int AS cereri, (SELECT count(*) FROM public.ai_plafon_rezervari)::int AS rezervari,
  (SELECT count(*) FROM public.ai_plafon_lunar)::int AS plafoane, (SELECT count(*) FROM public.profiles)::int AS profile`)).rows[0]

console.log('0. validatorul runnerului')
{
  const vm = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(PLAFON_LIVRARE === 5000 && vm.ok && /^OK \d+ /.test(vm.out), `migrarea trece validatorul cu ${PLAFON_LIVRARE}: ${vm.out}`)
  const vm2 = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', '2000')
  ok(!vm2.ok && /PLAFON_DIFERIT/.test(vm2.out), 'migrarea cu runnerul la 2000 = refuz: ' + vm2.out.split('\n')[0].slice(0, 120))
  const vmf = validator(join(ROOT, F_MIG), '--fara-plafon')
  ok(!vmf.ok && /PLAFON_LIPSA/.test(vmf.out), 'migrarea fără plafon = refuz local: ' + vmf.out.split('\n')[0].slice(0, 120))
  const vr = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_REVENIRE))
  ok(vr.ok && /^OK \d+ /.test(vr.out), 'revenirea trece validatorul cu 2000: ' + vr.out)
  const vr2 = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(!vr2.ok && /PLAFON_DIFERIT/.test(vr2.out), 'revenirea cu runnerul la 5000 = refuz: ' + vr2.out.split('\n')[0].slice(0, 120))
}

console.log('1. amprentele din migrare / revenire = calculate (din textul 20261108a și din baza aplicată)')
const db = await bazaNoua()
{
  const amp = md5(corp(M08A, 'CREATE FUNCTION public.fn_ocr_local_rezerva_apel('))
  const dinBaza = (await db.query(`SELECT md5(replace(prosrc, chr(13), '')) AS m, coalesce(proacl, acldefault('f', proowner))::text AS acl,
      prosecdef, proconfig, pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid = to_regprocedure('public.fn_ocr_local_rezerva_apel(uuid)')`)).rows[0]
  ok(dinBaza.m === amp, `corpul fn_ocr_local_rezerva_apel: text 20261108a = baza (${amp})`)
  const aparitii = s => (s.match(new RegExp(`'${amp}'`, 'g')) || []).length
  ok(aparitii(MIG) === 2 && aparitii(REV) === 1, 'amprenta RPC-ului: în migrare (înainte + după) și în revenire')
  ok(dinBaza.acl === '{postgres=X/postgres,service_role=X/postgres}' && dinBaza.prosecdef && dinBaza.owner === 'postgres'
    && JSON.stringify(dinBaza.proconfig) === '["search_path=public, pg_temp"]', 'ACL / DEFINER / search_path / proprietar = cele verificate: ' + dinBaza.acl)
  ok(!/fn_ocr_local_rezerva_apel/.test(M08B), '20261108b nu înlocuiește fn_ocr_local_rezerva_apel')
  const checkuri = (await db.query(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'public.ocr_local_config'::regclass AND contype = 'c' ORDER BY conname`)).rows
  const bloc = (t, et) => [...t.slice(t.indexOf(`-- >>> CHECK-URI ${et}`), t.indexOf(`-- <<< CHECK-URI ${et}`)).matchAll(/\('([a-z_]+)', '((?:[^']|'')*)'\)/g)]
    .map(m => [m[1], m[2].replace(/''/g, "'")])
  const asteptat08 = checkuri.map(c => [c.conname, c.def])
  const asteptat09 = asteptat08.map(([n, d]) => [n, n === 'ocr_local_config_rezerva_usd_check' ? 'CHECK ((rezerva_usd = 0.20))' : d])
  ok(asteptat08.length === 10 && JSON.stringify(bloc(MIG, '20261108a')) === JSON.stringify(asteptat08), 'migrarea, starea de dinainte = CHECK-urile deparsate după 20261108a')
  ok(JSON.stringify(bloc(REV, '20261108a')) === JSON.stringify(asteptat08), 'revenirea, postcondiția = aceleași CHECK-uri')
  ok(JSON.stringify(bloc(MIG, '20270109a')) === JSON.stringify(asteptat09) && JSON.stringify(bloc(REV, '20270109a')) === JSON.stringify(asteptat09),
    'migrarea (postcondiția) + revenirea (starea de dinainte) = aceleași CHECK-uri, doar rezerva 0.20')
  const L = 'LOCK TABLE public.ocr_local_config IN ACCESS EXCLUSIVE MODE NOWAIT;'
  ok(MIG.split(L).length === 2 && MIG.indexOf('DO $lock$') > MIG.indexOf('END $pre$;') && MIG.indexOf(L) > MIG.indexOf('DO $lock$')
    && MIG.indexOf('END $lock$;') < MIG.indexOf('DO $stare$') && /PERFORM set_config\('gazpet\.lock_puternic_la'/.test(MIG)
    && REV.split(L).length === 2 && REV.indexOf(L) < REV.indexOf('DO $stare$'),
  'lock-ul (blocul $lock$ NOWAIT cu buget, lock_puternic_la; revenirea NOWAIT) vine ÎNAINTEA verificărilor de stare (L14)')
  // comentariile se scot ÎNTÂI (un `$lock$` citat în antet ar decala perechile de delimitatori), apoi corpurile $tag$…$tag$
  const faraCorpuri = t => t.replace(/--[^\n]*/g, '').replace(/\$[a-z]*\$[\s\S]*?\$[a-z]*\$/g, '')
  ok(!/\bBEGIN\s*;|\bCOMMIT\s*;|\bROLLBACK\s*;/i.test(faraCorpuri(MIG)) && !/\bBEGIN\s*;|\bCOMMIT\s*;|\bROLLBACK\s*;/i.test(faraCorpuri(REV))
    && /DO \$lock\$/.test(faraCorpuri(MIG) + MIG) && faraCorpuri(MIG).includes('ALTER TABLE public.ocr_local_config DROP CONSTRAINT'),
  'fără control de tranzacție în fișiere (runnerul o deschide); decuparea lasă instrucțiunile de nivel superior')
}

console.log('2. semantica: 0,05 înainte → 0,20 după migrare → 0,05 după revenire → 0,20 după reaplicare')
{
  let s = await stare(db), r = await rezerva(db)
  ok(s.rezerva === '0.05' && s.implicit === '0.05' && s.check_def === 'CHECK ((rezerva_usd = 0.05))' && r.acordat && r.suma === '0.050000', 'înainte: config 0.05, rezervarea = 0.050000')
  const a = await livreaza(db, MIG)
  s = await stare(db); r = await rezerva(db)
  ok(a.ok, 'migrarea se aplică (pasul „înainte” REAL al runnerului)' + (a.ok ? '' : ': ' + a.eroare))
  ok(a.note.some(n => /^AMPRENTA_GLOBALA_CITITA inainte: [0-9a-f]{32}/.test(n)) && a.note.some(n => /^20270109a: lock la \d+ ms de la BEGIN \(1 incercari/.test(n)),
    'NOTICE: amprenta globală citită de pasul „înainte”; lock-ul obținut din prima încercare')
  ok(s.rezerva === '0.20' && s.implicit === '0.20' && s.check_def === 'CHECK ((rezerva_usd = 0.20))', `după: config ${s.rezerva}, implicit ${s.implicit}, ${s.check_def}`)
  ok(r.acordat && r.suma === '0.200000', 'după: fn_ocr_local_rezerva_apel rezervă 0.200000 = ' + r.suma)
  const costMaximSonnet = 46000 * 2 / 1e6 + 10400 * 10 / 1e6
  ok(Number(r.suma) >= costMaximSonnet && Number(r.suma) - costMaximSonnet < 0.01, `rezerva acoperă costul maxim Sonnet ${costMaximSonnet.toFixed(3)} (minimul justificat, rotunjit la 0,20)`)
  ok(a.note.some(n => /apeluri platite E3 in curs .*: 1$/.test(n)), 'NOTICE: apelurile plătite în curs numărate (1 rezervare deschisă la aplicare)')
  const re = await livreaza(db, MIG)
  ok(!re.ok && /deja 0\.20 \(reaplicare\)/.test(re.eroare), 'reaplicarea = refuz: ' + (re.eroare || ''))
  // revenirea: refuzată fără marcaj / cu plafonul migrării; apoi aplicată
  ok(!(await livreaza(db, REV, { nume: NUME_REV, plafon: 5000, ag: false })).ok, 'revenirea cu plafonul 5000 = refuz (cere 2000)')
  ok(!(await livreaza(db, REV, { nume: NUME, plafon: 2000, ag: false })).ok, 'revenirea cu marcajul migrării = refuz')
  const v = await livreaza(db, REV, { nume: NUME_REV, plafon: 2000, ag: false })
  s = await stare(db); r = await rezerva(db)
  ok(v.ok && s.rezerva === '0.05' && s.implicit === '0.05' && s.check_def === 'CHECK ((rezerva_usd = 0.05))' && r.suma === '0.050000',
    'revenirea: config / implicit / CHECK / rezervarea înapoi la 0.05' + (v.ok ? '' : ': ' + v.eroare))
  const v2 = await livreaza(db, REV, { nume: NUME_REV, plafon: 2000, ag: false })
  ok(!v2.ok && /nu e in starea din 20270109a/.test(v2.eroare), 'revenirea pe starea veche = refuz: ' + (v2.eroare || ''))
  const a2 = await livreaza(db, MIG)
  s = await stare(db); r = await rezerva(db)
  ok(a2.ok && s.rezerva === '0.20' && r.suma === '0.200000', 'reaplicarea după revenire: 0.20' + (a2.ok ? '' : ': ' + a2.eroare))
  // rezervările vechi își păstrează suma
  const vechi = (await db.query(`SELECT array_agg(suma_rezervata::text ORDER BY id) AS s FROM public.ai_plafon_rezervari`)).rows[0].s
  ok(JSON.stringify(vechi) === JSON.stringify(['0.050000', '0.200000', '0.050000', '0.200000']), 'rezervările deschise înainte își păstrează suma: ' + vechi.join(', '))
}
await db.close()

console.log('3. livrarea L15 v2 completă: manifestul (ROLLBACK) = lista revizuită; livrarea aprobată + garda finală; refuzurile runnerului; dry-run')
{
  const b = await bazaNoua()
  const s0 = await stare(b)
  // (a) generatorul de manifest: pașii „înainte” + „după” în modul tipărire, apoi ROLLBACK (nimic comis)
  const g = await livreaza(b, MIG, { manifest: '-', final: 'ROLLBACK' })
  const G = (g.note.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = g.note.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const total = Number((g.note.map(m => m.match(/^L15_DIF_TOTAL (\d+) /)).find(Boolean) || [])[1])
  const fara18 = listaObiecte(manifest).filter(x => !/_not_null\t/.test(x))
  ok(g.ok && G && total === listaObiecte(manifest).length && JSON.stringify(await stare(b)) === JSON.stringify(s0),
    `generatorul de manifest: GLOBAL ${G}, ${total} diferențe anunțate = rândurile tipărite; ROLLBACK, starea neschimbată` + (g.ok ? '' : ': ' + g.eroare))
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, F_OBIECTE),
    `# 20270109a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n`
    + fara18.join('\n') + '\n')
  const revizuit = existsSync(join(ROOT, F_OBIECTE)) ? listaObiecte(citeste(F_OBIECTE)) : []
  const lipsa = revizuit.filter(x => !fara18.includes(x)), plus = fara18.filter(x => !revizuit.includes(x))
  ok(fara18.length === 2 && !lipsa.length && !plus.length, `manifestul generat (${fara18.length} obiecte) = lista revizuită ${F_OBIECTE}; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  // L25: lista așteptată e scrisă aici, independent de fișier și de generator
  ok(JSON.stringify(revizuit) === JSON.stringify([
    'coloana\tcoloana public.ocr_local_config.rezerva_usd\tschimbat',
    'constrangere\tconstrangere tabel public.ocr_local_config.ocr_local_config_rezerva_usd_check\tschimbat',
  ]), 'lista revizuită = exact CHECK-ul rezerva_usd + coloana rezerva_usd (valoarea implicită), ambele „schimbat”: ' + revizuit.join(' | '))
  const fManifest = join(TMP, `${NUME}.l15.tsv`)
  writeFileSync(fManifest, manifest)
  // (b) refuzurile RUNNERULUI (verificarea globală reală), nimic schimbat
  const gr = await livreaza(b, MIG, { aprobat: 'f'.repeat(32), manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(!gr.ok && /AMPRENTA_GLOBALA_INAINTE/.test(gr.eroare) && JSON.stringify(await stare(b)) === JSON.stringify(s0), 'GLOBAL aprobat greșit = refuz AMPRENTA_GLOBALA_INAINTE, nimic schimbat: ' + (gr.eroare || 'APLICAT').slice(0, 100))
  const fIncomplet = join(TMP, 'incomplet', `${NUME}.l15.tsv`)
  execFileSync('bash', ['-c', 'mkdir -p "$(dirname "$1")"', '_', fIncomplet])
  writeFileSync(fIncomplet, manifest.split('\n').filter(l => !l.startsWith('coloana\t')).join('\n'))
  const gi = await livreaza(b, MIG, { aprobat: G, manifest: fIncomplet, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(!gi.ok && /AMPRENTA_GLOBALA_DUPA/.test(gi.eroare) && /NEDECLARAT/.test(gi.eroare + gi.note.join('\n')) && JSON.stringify(await stare(b)) === JSON.stringify(s0),
    'manifest fără rândul coloanei = refuz AMPRENTA_GLOBALA_DUPA (NEDECLARAT), nimic schimbat: ' + (gi.eroare || 'APLICAT').slice(0, 100))
  // (c) livrarea aprobată: GLOBAL + manifestul exact + garda finală reală
  const j = await livreaza(b, MIG, { aprobat: G, manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(j.ok && j.note.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m))
    && j.note.some(m => new RegExp(`^PLAFON_TIMP ${NUME}: garda trecuta la \\d+ ms de la BEGIN \\(plafon 5000 ms\\)`).test(m))
    && j.note.some(m => new RegExp(`^LOCK_TINUT ${NUME}: `).test(m) && !/nedeclarat/.test(m)),
  'livrarea aprobată: diferența = manifestul; PLAFON_TIMP (5000); LOCK_TINUT declarat' + (j.ok ? '' : ': ' + j.eroare))
  const s1 = await stare(b)
  ok(s1.rezerva === '0.20' && s1.implicit === '0.20', 'după livrarea aprobată: rezerva 0.20, implicit 0.20')
  // (d) dry-run-ul de pe clonă, aici: totul trece, nimic nu rămâne
  const n0 = await numarari(b), note = []
  let eroareDry = null
  try { await b.exec(DRY, { onNotice: n => note.push(n.message) }) } catch (e) { eroareDry = e.message; try { await b.exec('ROLLBACK') } catch { /* închisă */ } }
  const asteptate = ['t_config OK', 't_rezerva OK', 't_netrimis OK', 't_inainte OK', 't_dupa OK', 'TOTUL OK']
  ok(!eroareDry && asteptate.every(t => note.some(n => n.startsWith('DRY 20270109a ' + t))), `dry-run: ${asteptate.length} blocuri OK` + (eroareDry ? ': ' + eroareDry : ' — ' + note.filter(n => n.startsWith('DRY')).join(' | ')))
  ok(JSON.stringify(await numarari(b)) === JSON.stringify(n0) && JSON.stringify(await stare(b)) === JSON.stringify(s1), 'dry-run: ROLLBACK, nimic rămas (cereri, rezervări, plafoane, profile, config)')
  // (e) dry-run-ul pe baza FĂRĂ migrare pică (nu e verde din construcție)
  const fara = await bazaNoua()
  let ef = null
  try { await fara.exec(DRY) } catch (e) { ef = e.message; try { await fara.exec('ROLLBACK') } catch { /* închisă */ } }
  ok(/t_config FAIL/.test(ef || ''), 'dry-run pe baza fără 20270109a = eșec (t_config): ' + (ef || 'TRECE').slice(0, 90))
  await fara.close(); await b.close()
}

console.log('4. refuzurile migrării (pe bază nouă, nimic schimbat)')
for (const [eticheta, opt, motiv, pregatire] of [
  ['fără marcajul runnerului', { marcaj: false }, /garda start invalida/],
  ['fără plafonul tranzacției', { plafon: null, marcajPlafon: null }, /PLAFON_TRANZACTIE lipsa/],
  ['cu plafonul 2000', { plafon: 2000, marcajPlafon: 2000 }, /PLAFON_TRANZACTIE lipsa/],
  ['plafon fără marcajul prologului', { marcajPlafon: null }, /PLAFON_TRANZACTIE lipsa/],
  ['fără pasul „înainte” L15 v2', { ag: false }, /AMPRENTA_GLOBALA_LIPSA/],
  ['CHECK-ul plafonului schimbat', {}, /CHECK-urile ocr_local_config difera de 20261108a: ocr_local_config_plafon_usd_check/,
    'ALTER TABLE public.ocr_local_config DROP CONSTRAINT ocr_local_config_plafon_usd_check, ADD CONSTRAINT ocr_local_config_plafon_usd_check CHECK (plafon_usd >= 10)'],
  ['un CHECK în plus', {}, /\+ocr_local_config_alt/, 'ALTER TABLE public.ocr_local_config ADD CONSTRAINT ocr_local_config_alt CHECK (rezerva_usd > 0)'],
  ['valoarea implicită schimbată', {}, /valoarea implicita a rezerva_usd nu e 0.05/, 'ALTER TABLE public.ocr_local_config ALTER COLUMN rezerva_usd SET DEFAULT 0.050'],
  ['RPC-ul schimbat (corp)', {}, /fn_ocr_local_rezerva_apel nu e cea din 20261108a/,
    `DO $x$ BEGIN EXECUTE replace(pg_get_functiondef('public.fn_ocr_local_rezerva_apel(uuid)'::regprocedure), 'c.rezerva_usd', 'c.rezerva_usd * 2'); END $x$`],
  ['RPC-ul cu drept în plus', {}, /fn_ocr_local_rezerva_apel nu e cea din 20261108a/, 'GRANT EXECUTE ON FUNCTION public.fn_ocr_local_rezerva_apel(uuid) TO authenticated'],
]) {
  const b = await bazaNoua()
  if (pregatire) await b.exec(pregatire)
  const inainte = await stare(b)
  const r = await livreaza(b, MIG, opt)
  const dupa = await stare(b)
  ok(!r.ok && motiv.test(r.eroare) && JSON.stringify(inainte) === JSON.stringify(dupa), `${eticheta}: refuz, nimic schimbat (${(r.eroare || 'APLICAT').slice(0, 110)})`)
  await b.close()
}

console.log('5. mutanți pe textul migrării / revenirii (fiecare trebuie prins)')
const mutanti = [
  ['migrare: fără garda AMPRENTA_GLOBALA', F_MIG, /  IF NOT EXISTS \(SELECT 1 FROM pg_class c WHERE c\.relnamespace = pg_my_temp_schema\(\)[\s\S]*?nimic schimbat';\n  END IF;\n/, ''],
  ['migrare: fără refuzul reaplicării', F_MIG, /  IF EXISTS \(SELECT 1 FROM public\.ocr_local_config WHERE id AND rezerva_usd = 0\.20\) THEN\n    RAISE EXCEPTION '20270109a: rezerva e deja 0\.20 \(reaplicare\)';\n  END IF;\n/, ''],
  ['migrare: fără verificarea CHECK-urilor de dinainte', F_MIG, /  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270109a: CHECK-urile ocr_local_config difera de 20261108a: %', v_rau; END IF;\n/, ''],
  ['migrare: fără verificarea RPC-ului', F_MIG, /md5\(replace\(p\.prosrc, chr\(13\), ''\)\) = 'e24930150252c190a33a9c0b58665525'\n                   AND p\.prosecdef AND p\.proconfig = ARRAY\['search_path=public, pg_temp'\] AND pg_get_userbyid\(p\.proowner\) = 'postgres'\n                   AND coalesce\(p\.proacl, acldefault\('f', p\.proowner\)\)::text = '\{postgres=X\/postgres,service_role=X\/postgres\}'\) THEN\n    RAISE EXCEPTION '20270109a: fn_ocr_local_rezerva_apel nu e cea din 20261108a/, "true) THEN\n    RAISE EXCEPTION '20270109a: fn_ocr_local_rezerva_apel nu e cea din 20261108a"],
  ['migrare: rezerva 0,10 (sub costul maxim Sonnet)', F_MIG, /rezerva_usd = 0\.20 WHERE id AND rezerva_usd = 0\.05;\nALTER TABLE public\.ocr_local_config\n  ADD CONSTRAINT ocr_local_config_rezerva_usd_check CHECK \(rezerva_usd = 0\.20\),\n  ALTER COLUMN rezerva_usd SET DEFAULT 0\.20;/,
    'rezerva_usd = 0.10 WHERE id AND rezerva_usd = 0.05;\nALTER TABLE public.ocr_local_config\n  ADD CONSTRAINT ocr_local_config_rezerva_usd_check CHECK (rezerva_usd = 0.10),\n  ALTER COLUMN rezerva_usd SET DEFAULT 0.10;'],
  ['migrare: fără valoarea implicită nouă', F_MIG, /,\n  ALTER COLUMN rezerva_usd SET DEFAULT 0\.20;/, ';'],
  ['revenire: rezerva rămâne 0,20 în rând', F_REV, /UPDATE public\.ocr_local_config SET rezerva_usd = 0\.05 WHERE id AND rezerva_usd = 0\.20;\n/, ''],
  ['revenire: fără verificarea stării de dinainte', F_REV, /  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270109a revenire: CHECK-urile ocr_local_config difera de 20270109a: %', v_rau; END IF;\n/, ''],
]
// Scenariul fiecărui mutant = cel din secțiunile 2–4 care îl vizează; rezultatul (aplicat / mesajul refuzului + starea finală) pe textul
// ORIGINAL e cel verificat mai sus. Mutantul e PRINS dacă același scenariu dă alt rezultat (o verificare de mai sus ar pica).
const CHECK_STRAIN = 'ALTER TABLE public.ocr_local_config ADD CONSTRAINT ocr_local_config_alt CHECK (rezerva_usd > 0)'
const scenarii = {
  faraL15: async (b, m) => livreaza(b, m, { ag: false }),
  reaplicare: async (b, m) => { await livreaza(b, m); return livreaza(b, m) },
  checkStrain: async (b, m) => { await b.exec(CHECK_STRAIN); return livreaza(b, m) },
  rpcSchimbat: async (b, m) => { await b.exec('GRANT EXECUTE ON FUNCTION public.fn_ocr_local_rezerva_apel(uuid) TO authenticated'); return livreaza(b, m) },
  aplicare: async (b, m) => livreaza(b, m),
  revenire: async (b, m) => { await livreaza(b, MIG); return livreaza(b, m, { nume: NUME_REV, plafon: 2000, ag: false }) },
  revenireStrain: async (b, m) => { await livreaza(b, MIG); await b.exec(CHECK_STRAIN); return livreaza(b, m, { nume: NUME_REV, plafon: 2000, ag: false }) },
}
const rezultat = async (scenariu, text) => {
  const b = await bazaNoua()
  const r = await scenarii[scenariu](b, text)
  const s = await stare(b); await b.close()
  return `${r.ok ? 'APLICAT' : 'REFUZ ' + r.eroare} | ${JSON.stringify(s)}`
}
for (const [eticheta, fisier, din, in_, scenariu] of mutanti.map((m, i) => [...m, ['faraL15', 'reaplicare', 'checkStrain', 'rpcSchimbat', 'aplicare', 'aplicare', 'revenire', 'revenireStrain'][i]])) {
  const original = fisier === F_MIG ? MIG : REV
  ok(din.test(original), `${eticheta}: textul mutat există`)
  const mutat = original.replace(din, in_)
  const [ro, rm] = [await rezultat(scenariu, fisier === F_MIG ? MIG : REV), await rezultat(scenariu, mutat)]
  ok(ro !== rm, `mutant prins — ${eticheta}: original «${ro.slice(0, 90)}» ≠ mutant «${rm.slice(0, 90)}»`)
}

console.log(esec ? `\nESEC: ${esec} verificări picate` : '\nTOATE VERIFICĂRILE AU TRECUT')
process.exit(esec ? 1 : 0)
