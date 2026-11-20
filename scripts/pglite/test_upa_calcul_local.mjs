// Proba LOCALĂ a migrării 20270101a (Administrativ → UPA: contribuția pentru fondul de handicap calculată după răspunsul expertului contabil)
// pe PGlite — NU atinge nicio bază reală. Baza: scheletul 20261229a + supabase/tests/20270101a_administrativ_upa_calcul_schelet.sql
// (employees, pontaj_records, hr_decizii_semnatari, calendar_days), apoi 20261229a / b / c ca pe producție, apoi 20270101a ca la livrare (L15 v2).
// Valorile așteptate sunt calculate DE MÂNĂ în comentarii (L25: nu din codul testat), inclusiv exemplele din review-ul PR #1154 (NMA 75 și 64).
// Runda 2: baza integrală + posturi cu 2 zecimale; zilele nelucrătoare (efectivul zilei lucrătoare precedente) și suspendările de drept
// (CM / BO / M) ; pontajul complet + confirmarea owner-ului pe amprentă; intențiile de dinainte de migrare; alerta exactă după închiderea din
// ecran și cu jurnal legacy; factura neplătită; termenul din decembrie; MUTANȚI.
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_upa_calcul_local.mjs
//   (--scrie-obiecte rescrie lista revizuită L15 din manifestul generat; --fara-mutanti sare secțiunea 7)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'upacalcul_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const NUME = '20270101a_administrativ_upa_calcul'
const F_MIG = `supabase/migrations/${NUME}.sql`, F_REV = `supabase/revenire/${NUME}_ROLLBACK.sql`, F_OBIECTE = `supabase/tests/${NUME}.l15.obiecte.tsv`
const MIG = citeste(F_MIG), REV = citeste(F_REV)
const NA = '20261229a_administrativ_upa_alerta', NB = '20261229b_administrativ_upa_numar_factura', NC = '20261229c_administrativ_upa_bucket'
const MIG_A = citeste(`supabase/migrations/${NA}.sql`), MIG_B = citeste(`supabase/migrations/${NB}.sql`), MIG_C = citeste(`supabase/migrations/${NC}.sql`)
const REV_A = citeste(`supabase/revenire/${NA}_ROLLBACK.sql`), REV_B = citeste(`supabase/revenire/${NB}_ROLLBACK.sql`), REV_C = citeste(`supabase/revenire/${NC}_ROLLBACK.sql`)
const SCHELET = citeste(`supabase/tests/${NA}_schelet.sql`) + '\n' + citeste(`supabase/tests/${NUME}_schelet.sql`)
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const MOD_EDGE = await import(pathToFileURL(join(ROOT, 'supabase/functions/_shared/upaAlerta.mjs')).href)

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }
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

console.log('0. validatorul runnerului')
{
  const vm = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(vm.ok && /^OK \d+ /.test(vm.out), 'migrarea trece validatorul cu 5000: ' + vm.out.slice(0, 200))
  const vm2 = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', '2000')
  ok(!vm2.ok && /PLAFON_DIFERIT/.test(vm2.out), 'migrarea cu runnerul la 2000 = refuz')
  const vr = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_REVENIRE))
  ok(vr.ok && /^OK \d+ /.test(vr.out), 'revenirea trece validatorul cu 2000: ' + vr.out.slice(0, 200))
  const vr2 = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(!vr2.ok && /PLAFON_DIFERIT/.test(vr2.out), 'revenirea cu runnerul la 5000 = refuz')
}

console.log('0b. blocul AMPRENTA identic migrare / revenire; funcțiile refăcute = sursa din 20261229a; constantele md5 din preflight')
const blocAmprenta = t => { const i = t.indexOf('AMPRENTA_20270101a_INCEPUT'), j = t.indexOf('-- AMPRENTA_20270101a_SFARSIT'); return i < 0 || j < 0 ? null : t.slice(t.indexOf('\n', i) + 1, j) }
const constante = t => [...t.matchAll(/'([0-9a-f]{32})' THEN\n    RAISE NOTICE 'AMPRENTA_20270101a_TEXT/g)].map(x => x[1])
const sursaFn = (t, sig) => { const i = t.indexOf(sig); if (i < 0) return null; const a0 = t.indexOf('$f$', i) + 3; return t.slice(a0, t.indexOf('$f$;', a0)) }
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
{
  const bm = blocAmprenta(MIG), br = blocAmprenta(REV)
  ok(bm && bm.length > 3000 && bm === br, `blocul de calcul e identic (${bm?.length} / ${br?.length} caractere)`)
  const cm = constante(MIG), cr = constante(REV)
  ok(cm.length === 1 && cr.length === 1 && cm[0] === cr[0] && cm[0] !== '0'.repeat(32), `aceeași constantă în ambele fișiere (${cm} / ${cr})`)
  for (const [sig, fn] of [['CREATE FUNCTION public.fn_upa_campuri_intentie()', 'fn_upa_campuri_intentie()'], ['CREATE FUNCTION public.fn_upa_achizitii_intentie()', 'fn_upa_achizitii_intentie()'],
    ['CREATE FUNCTION public.fn_upa_achizitie_adauga(', 'fn_upa_achizitie_adauga(uuid,jsonb)'],
    ['CREATE FUNCTION public.fn_upa_alerta_inscrie(', 'fn_upa_alerta_inscrie('], ['CREATE FUNCTION public.fn_upa_alerta_rezerva_la(', 'fn_upa_alerta_rezerva_la(date)'],
    ['CREATE FUNCTION public.fn_upa_alerta_proba()', 'fn_upa_alerta_proba()'], ['CREATE FUNCTION public.fn_upa_luna_inchisa_nemodificabil()', 'fn_upa_luna_inchisa_nemodificabil()'],
    ['CREATE FUNCTION public.fn_upa_poate_scrie()', 'fn_upa_poate_scrie()'], ['CREATE FUNCTION public.fn_upa_hash_intentie(', 'fn_upa_hash_intentie(jsonb)'],
    ['CREATE FUNCTION public.fn_upa_destinatari(', 'fn_upa_destinatari(text)'], ['CREATE FUNCTION public.fn_upa_lei(', 'fn_upa_lei(numeric)'],
    ['CREATE FUNCTION public.fn_upa_luna_text(', 'fn_upa_luna_text(date)'], ['CREATE FUNCTION public.fn_upa_zile_text(', 'fn_upa_zile_text(integer)']]) {
    const h = md5(sursaFn(MIG_A, sig))
    ok(MIG.includes(`('public.${fn}`) && new RegExp(`\\('public\\.${fn.replace(/[()]/g, '\\$&')}[^']*', '${h}'`).test(MIG), `preflight: ${fn} = md5 sursei din 20261229a (${h})`)
    if (/achizitii_intentie|adauga|inscrie|rezerva_la|proba/.test(fn)) {
      const s = sursaFn(REV, sig.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'))
      ok(s !== null && md5(s) === h && new RegExp(`'${h}'`).test(REV), `revenirea reface ${fn} cu sursa EXACTĂ din 20261229a`)
    }
  }
  ok(!/CREATE OR REPLACE FUNCTION public\.fn_upa_campuri_intentie\(\)/.test(MIG) && !/CREATE OR REPLACE FUNCTION public\.fn_upa_hash_intentie\(/.test(MIG),
    'fn_upa_campuri_intentie / fn_upa_hash_intentie NU sunt înlocuite (amprenta veche rămâne aceeași)')
  // CHECK-urile jurnalului: textul refăcut de revenire = textul din 20261229a
  const chk = t => { const i = t.indexOf('ADD CONSTRAINT upa_alerta_jurnal_fel CHECK'), j = t.indexOf("':[a-z_]{1,40}$')))", i); return i < 0 || j < 0 ? null : t.slice(i, j) }
  const vechi = MIG_A.slice(MIG_A.indexOf('CONSTRAINT upa_alerta_jurnal_fel CHECK'), MIG_A.indexOf("':[a-z_]{1,40}$'))),", MIG_A.indexOf('CONSTRAINT upa_alerta_jurnal_fel CHECK')))
  const norm = s => (s || '').replace(/ADD CONSTRAINT|CONSTRAINT/g, '').replace(/;\nALTER TABLE public\.upa_alerta_jurnal\s*/g, ',\n  ').replace(/\s+/g, ' ').trim()
  ok(chk(REV) && norm(chk(REV)) === norm(vechi), 'revenirea reface CHECK-urile jurnalului cu textul din 20261229a')
}

// ── datele (fictive) ──
const U = { OWNER: '00000000-0000-0000-0000-0000000a0001', ED: '00000000-0000-0000-0000-0000000a0002', VW: '00000000-0000-0000-0000-0000000a0003',
  AD: '00000000-0000-0000-0000-0000000a0004', NO: '00000000-0000-0000-0000-0000000a0005' }
const BAZA = `
INSERT INTO public.profiles (id, email, name, is_owner) VALUES ('${U.OWNER}', 'owner@gazpet.ro', 'OWNER TEST', true), ('${U.ED}', 'ed@gazpet.ro', 'EDITOR UPA', false),
  ('${U.VW}', 'vw@gazpet.ro', 'VIEWER UPA', false), ('${U.AD}', 'ad@gazpet.ro', 'ADMIN ADMINISTRATIV', false), ('${U.NO}', 'no@gazpet.ro', 'FARA DREPT', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.ED}', 'administrativ.upa', 'editor'), ('${U.VW}', 'administrativ.upa', 'viewer'),
  ('${U.AD}', 'administrativ', 'admin'), ('${U.NO}', 'logistica', 'admin');
INSERT INTO public.logistica_setari (key, value) VALUES ('upa_plafon_lunar', '7000'), ('upa_alerta_activa', 'true'),
  ('upa_alerta_emails', ' Ana@gazpet.ro, ion@gazpet.ro, x@altundeva.ro '), ('upa_alerta_zi', '25');
INSERT INTO public.logistica_furnizori (id, nume, este_upa, activ, upa_valabil_pana) VALUES (1, 'UPA Unu SRL', true, true, '2040-01-01');`
// n angajați întregi toată luna (ids 1..n). Octombrie 2026: 31 de zile, joi 1.10, 22 de zile lucrătoare, fără sărbători.
// Noiembrie 2026: 30 de zile, duminică 1.11 (ziua de referință = vineri 30.10), luni 30.11 = Sf. Andrei (ref. vineri 27.11), 20 de zile lucrătoare.
const angajati = (n = 60) => `INSERT INTO public.employees (id, name, active, hire_date, procent_ocupare) SELECT g, 'ANGAJAT ' || g, true, DATE '2020-01-01', 100 FROM generate_series(1, ${n}) g;`
// pontajul (rând pe fiecare zi lucrătoare a contractului, oct + nov), DUPĂ codurile speciale; fără administratorul 66 și suspendatul 74
const pontajPlin = (fara = '0') => `
INSERT INTO public.pontaj_records (employee_id, date, norma)
SELECT e.id, d::date, NULL FROM public.employees e, generate_series(TIMESTAMP '2026-10-01', TIMESTAMP '2026-11-30', interval '1 day') d
 WHERE extract(isodow FROM d) < 6 AND NOT EXISTS (SELECT 1 FROM public.calendar_days c WHERE c.date = d::date AND c.type = 'legal')
   AND (e.active OR e.termination_date IS NOT NULL) AND d::date >= e.hire_date AND (e.termination_date IS NULL OR d::date <= e.termination_date)
   AND e.id NOT IN (${fara})
ON CONFLICT (employee_id, date) DO NOTHING;`
const PONTAJ_PLIN = pontajPlin()
const SPECIALI = `
INSERT INTO public.employees (id, name, active, hire_date, termination_date, procent_ocupare) VALUES
  (61, 'INTRAT LA MIJLOC', true, '2026-10-16', NULL, 100),      -- oct: 16 zile (16..31); nov: 30
  (62, 'NORMA PARTIALA', true, '2020-01-01', NULL, 50),         -- oct: 31 x 0,5 = 15,5; nov: 15
  (63, 'INCETAT', false, '2020-01-01', '2026-10-10', 100),      -- oct: 1..10 (sâmbăta 10 = efectivul de vineri 9): 10; nov: nu intră
  (64, 'CU CFS', true, '2020-01-01', NULL, 100),                -- CFS L 5 – V 9.10: + weekendul 10–11 (ref. vineri 9) = 7 zile scoase: 24
  (65, 'CU CM', true, '2020-01-01', NULL, 100),                 -- CM Ma 20 – J 22.10: 3 zile scoase: 28; nov: 30
  (66, 'ADMINISTRATOR', true, '2020-01-01', NULL, 100),         -- administrator (hr_decizii_semnatari): 0
  (67, 'INACTIV FARA DATA', false, '2020-01-01', NULL, 100),    -- blocaj (are pontaj în oct) până primește data încetării (30.09)
  (68, 'IMPUTERNICIT', true, '2020-01-01', NULL, 100),          -- intră (semnatar, dar nu administrator): 31 / 30
  (69, 'ANGAJAT IN DECEMBRIE', true, '2026-12-01', NULL, 100),  -- nu intră în oct / nov
  (70, 'MATERNITATE', true, '2020-01-01', NULL, 100),           -- M pe toate zilele lucrătoare din oct: 0; nov: 1.11 (ref. 30.10 = M) scos: 29
  (71, 'BO VINERI', true, '2020-01-01', NULL, 100),             -- BO vineri 30.10: 30 + 31 scoase: 29; nov: 1.11 (ref. 30.10) scos: 29
  (72, 'NORMA SCHIMBATA', true, '2020-01-01', NULL, 50),        -- corecție: normă 1 pe 1–15.10, apoi 0,5: 15 + 16 x 0,5 = 23; nov: 15
  (73, 'ADMINISTRATOR DIN 16', true, '2020-01-01', NULL, 100),  -- corecție: administrator 16–31.10: 15; nov: 1.11 (ref. 30.10) scos: 29
  (74, 'SUSPENDAT FARA COD', true, '2020-01-01', NULL, 100);    -- corecție: suspendat 1.10 – 30.11, fără pontaj: 0 / 0
INSERT INTO public.hr_decizii_semnatari (employee_id, calitate, este_reprezentant_legal) VALUES (66, 'Administrator', true), (68, 'Imputernicit', false);
INSERT INTO public.pontaj_records (employee_id, date, norma) SELECT 64, d::date, 'CFP' FROM generate_series(TIMESTAMP '2026-10-05', TIMESTAMP '2026-10-09', interval '1 day') d;
INSERT INTO public.pontaj_records (employee_id, date, norma) SELECT 65, d::date, 'CM' FROM generate_series(TIMESTAMP '2026-10-20', TIMESTAMP '2026-10-22', interval '1 day') d;
INSERT INTO public.pontaj_records (employee_id, date, norma) SELECT 70, d::date, 'M' FROM generate_series(TIMESTAMP '2026-10-01', TIMESTAMP '2026-10-31', interval '1 day') d
  WHERE extract(isodow FROM d) < 6;
INSERT INTO public.pontaj_records (employee_id, date, norma) VALUES (71, '2026-10-30', 'BO'),
  (1, '2026-10-02', 'CO'), (2, '2026-10-02', 'CM'), (3, '2026-10-02', 'N'), (67, '2026-10-01', NULL);
` + pontajPlin('66, 74')
// NMA octombrie (de mână): 1..60 = 60 x 31 − 3 (angajatul 2: CM vineri 2.10 + weekendul 3–4) = 1.857; 61: 16; 62: 15,5; 63: 10; 64: 24; 65: 28;
//   66: 0; 68: 31; 70: 0; 71: 29; 72: 23; 73: 15; 74: 0 -> 2.048,5 / 31 = 66,0806 -> 66,08 (CO / N nu scad).
//   posturi = 4% x 66,08 = 2,6432 -> 2,64 (2 zecimale); locuri = 2,64 (0 angajați cu handicap); contribuția integrală = 2,64 x 4.325 = 11.418,00;
//   deducerea maximă = 5.709,00. Rânduri: 1..60 + 61, 62, 63, 64, 65, 66, 68, 70, 71, 72, 73, 74 = 72.
// NMA noiembrie: 1..60 = 1.800; 61: 30; 62: 15; 64: 30; 65: 30; 68: 30; 70: 29; 71: 29; 72: 15; 73: 29 -> 2.037 / 30 = 67,90;
//   posturi 2,716 -> 2,72; contribuția 2,72 x 4.325 = 11.764,00; deducerea maximă 5.882,00. Rânduri: 60 + 11 = 71.
const NMA_OCT = 66.08, NMA_NOV = 67.9, NR_OCT = 72, NR_NOV = 71

const q1 = async (db, sql, p) => (await db.query(sql, p)).rows[0]
const eroare = async p => { try { await p; return null } catch (e) { return e.message } }
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
const aplica = (db, text = MIG, o) => caRunner(db, NUME, text, o)
const revino = (db, text = REV, o) => caRunner(db, NUME + '_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
async function aplicaLivrare(db) {
  let jg = []
  try { jg = await caRunner(db, NUME, MIG, { l15: 'livrare', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message.slice(0, 300)) }
  const G = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const fara18 = listaObiecte(manifest).filter(x => !/_not_null\t/.test(x))
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, F_OBIECTE),
    `# 20270101a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n` + fara18.join('\n') + '\n')
  const revizuit = existsSync(join(ROOT, F_OBIECTE)) ? listaObiecte(citeste(F_OBIECTE)) : []
  const lipsa = revizuit.filter(x => !fara18.includes(x)), plus = fara18.filter(x => !revizuit.includes(x))
  ok(G && fara18.length > 0 && !lipsa.length && !plus.length, `manifestul generat (${fara18.length} obiecte, fără NOT NULL PG18) = lista revizuită; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  const fManifest = join(TMP, `${NUME}.l15.tsv`)
  writeFileSync(fManifest, manifest)
  const j = await caRunner(db, NUME, MIG, { l15: 'livrare', aprobat: G, manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)) && j.some(m => new RegExp(`^PLAFON_TIMP ${NUME}: garda trecuta la \\d+ ms de la BEGIN \\(plafon 5000 ms\\)`).test(m))
    && j.some(m => new RegExp(`^LOCK_TINUT ${NUME}: `).test(m) && !/nedeclarat/.test(m)), `livrarea aprobată: diferența = manifestul; PLAFON_TIMP (5000); LOCK_TINUT declarat`)
  return j
}
// baza ca pe producție: scheletul, datele, 20261229a / b / c aplicate; `inainte` = pași pe baza VECHE (înaintea migrării)
async function bazaProd({ date = BAZA + angajati() + SPECIALI, inainte = null } = {}) {
  const db = new PGlite()
  await db.exec(SCHELET)
  await db.exec(date)
  await caRunner(db, NA, MIG_A)
  await caRunner(db, NB, MIG_B)
  await caRunner(db, NC, MIG_C)
  if (inainte) await inainte(db)
  return db
}
async function caRol(db, rol, uid, sql, params) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; SELECT set_config('request.jwt.claim.sub', '${uid || ''}', true);`)
  try { const r = await db.query(sql, params); await db.exec('COMMIT'); return { rows: r.rows, n: r.affectedRows ?? r.rows.length } }
  catch (e) { await db.exec('ROLLBACK'); return { err: e.code || 'X', msg: e.message } }
}
const calcul = async (db, luna, azi) => (await q1(db, 'SELECT public.fn_upa_calcul_la($1::date, $2::date) AS c', [luna, azi])).c
const rezerva = async (db, azi) => (await q1(db, 'SELECT public.fn_upa_alerta_rezerva_la($1::date) AS r', [azi])).r
const seteaza = (db, uid, cheie, deLa, val, vechi) => caRol(db, 'authenticated', uid, 'SELECT public.fn_upa_parametru_seteaza($1, $2::date, $3::numeric, $4::numeric) AS r', [cheie, deLa, val, vechi])
const perioada = (db, uid, emp, deLa, panaLa, norma, admin, susp, nota = 'act aditional / decizie (proba)') => caRol(db, 'authenticated', uid,
  'SELECT public.fn_upa_perioada_adauga($1::int, $2::date, $3::date, $4::numeric, $5::boolean, $6::boolean, $7) AS r', [emp, deLa, panaLa, norma, admin, susp, nota])
// închiderea internă (ziua dată; pentru lunile la care data reală nu a ajuns) și cea din ecran (ziua reală, ca owner-ul / alt cont)
const inchide = async (db, luna, azi, amp, uid = U.OWNER) => (await q1(db, 'SELECT public.fn_upa_calcul_inchide_la($1::date, $2::date, $3, $4::uuid) AS r', [luna, azi, amp, uid])).r
const inchideEcran = (db, uid, luna, amp) => caRol(db, 'authenticated', uid, 'SELECT public.fn_upa_calcul_inchide($1::date, $2) AS r', [luna, amp])
// achiziție scrisă direct (ca un rând completat din ecran): stare_plata din data plății ('platita') sau dată explicit
const achizitie = (db, nr, luna, valoare, faraTva, plata, stare = plata ? 'platita' : null) => db.query(`INSERT INTO public.upa_achizitii (furnizor_id, numar_factura, data_factura, luna, valoare, valoare_fara_tva, data_plata, stare_plata)
  VALUES (1, $1, $2::date, $2::date, $3, $4, $5::date, $6)`, [nr, luna, valoare, faraTva, plata, stare])
const n = v => v === null || v === undefined ? null : Number(v)
const lista = v => Array.isArray(v) ? v : []

// ── scenariul A: octombrie (peste jumătate, report 391), noiembrie (report consumat, termenul 21.12); toate blocajele; închiderea pe amprentă ──
async function scenariuA(db) {
  const ab = []
  const tine = (c, m) => { if (!c) ab.push(m) }
  // corecțiile HR (owner): normă 1 pe 1–15.10 pentru 72, administrator 16–31.10 pentru 73, suspendat 1.10–30.11 pentru 74
  for (const [emp, a, b, nr, adm, s] of [[72, '2026-10-01', '2026-10-15', 1, null, false], [73, '2026-10-16', '2026-10-31', null, true, false], [74, '2026-10-01', '2026-11-30', null, null, true]]) {
    const p = await perioada(db, U.OWNER, emp, a, b, nr, adm, s)
    tine(!p.err, `corecția HR ${emp} (${p.err || 'ok'} ${p.msg || ''})`)
  }
  // octombrie: 6.000 fără TVA plătită la timp (peste jumătate) + 500 plătită după termen + F-A3 fără nimic completat
  await achizitie(db, 'F-A1', '2026-10-01', 7140, 6000, '2026-10-28')
  await achizitie(db, 'F-A2', '2026-10-01', 595, 500, '2026-11-03')
  await db.query(`INSERT INTO public.upa_achizitii (furnizor_id, numar_factura, luna, valoare) VALUES (1, 'F-A3', '2026-10-01', 119)`)
  // fără numărul angajaților cu handicap: blocat (nu se inventează 0)
  let c = await calcul(db, '2026-10-01', '2026-11-13')
  tine(c.stare === 'previziune' && lista(c.blocaje).includes('fara_nr_handicap') && c.poate_inchide === false && c.suma_datorata === null,
    `fără nr. handicap: blocat, suma necunoscută (${JSON.stringify(c.blocaje)} ${c.suma_datorata})`)
  const s0 = await seteaza(db, U.OWNER, 'angajati_handicap', '2026-10-01', 0, null)
  tine(!s0.err, `owner-ul pune nr. handicap 0 de la 01.10.2026 (${s0.err || 'ok'} ${s0.msg || ''})`)
  // ziua 12: previziune (data de 13 neatinsă); valorile se calculează deja
  c = await calcul(db, '2026-10-01', '2026-11-12')
  tine(c.stare === 'previziune' && c.pontaj_inchis === false && c.poate_inchide === false && lista(c.avertismente).includes('pontaj_neinchis'),
    `12.11: previziune, pontajul deschis (${c.stare} ${c.pontaj_inchis} ${c.poate_inchide})`)
  tine(n(c.nma) === NMA_OCT && c.nr_angajati === NR_OCT, `NMA octombrie = ${NMA_OCT}, ${NR_OCT} rânduri (primit ${c.nma}, ${c.nr_angajati})`)
  tine(n(c.posturi) === 2.64 && n(c.locuri) === 2.64 && n(c.suma_datorata) === 11418 && n(c.jumatate) === 5709,
    `posturi 2,64 (2 zecimale), contribuția integrală 11.418,00, deducerea maximă 5.709,00 (${c.posturi} ${c.locuri} ${c.suma_datorata} ${c.jumatate})`)
  tine(c.termen_stat === '2026-11-25' && c.termen_upa === '2026-10-31', `termenele: stat 25.11 (miercuri), UPA 31.10 (${c.termen_stat} ${c.termen_upa})`)
  // 13.11: blocajele, pe rând
  c = await calcul(db, '2026-10-01', '2026-11-13')
  tine(c.pontaj_inchis === true && c.poate_inchide === false && lista(c.blocaje).includes('inactivi_fara_data_incetarii_cu_pontaj:1')
    && lista(c.blocaje).includes('achizitii_fara_stare_plata:1') && !lista(c.blocaje).some(b => /^achizitii_fara_tva/.test(b)),
    `13.11: blocat de inactivul fără dată și de factura cu plata necunoscută (${JSON.stringify(c.blocaje)})`)
  tine(lista(c.avertismente).includes('achizitii_platite_dupa_termen:1') && lista(c.avertismente).includes('angajati_cu_corectii:3'),
    `avertismente: plătită după termen, 3 angajați cu corecții (${JSON.stringify(c.avertismente)})`)
  // rezervarea pe 14.11: luna blocată -> calcul_neinchis (owner + 3 Administrativ/UPA); cronul NU închide
  const notifInainte = Number((await q1(db, `SELECT count(*)::int AS n FROM public.notifications`)).n)
  let r = await rezerva(db, '2026-11-14')
  const nNeinchis = Number((await q1(db, `SELECT count(*)::int AS n FROM public.notifications`)).n) - notifInainte
  tine(r.luna_de_inchis?.luna === '2026-10-01' && r.luna_de_inchis?.gata === false && lista(r.erori_config).includes('calcul_neinchis') && nNeinchis === 4,
    `14.11: oct de închis, blocat; calcul_neinchis notificat owner + 3 (${JSON.stringify(r.luna_de_inchis)} +${nNeinchis})`)
  // HR: data încetării pentru inactiv (30.09 = înainte de lună); editorul: F-A3 plătită (fără valoarea fără TVA -> alt blocaj), apoi valoarea
  await db.query(`UPDATE public.employees SET termination_date = '2026-09-30' WHERE id = 67`)
  const u1 = await caRol(db, 'authenticated', U.ED, `UPDATE public.upa_achizitii SET stare_plata = 'platita', data_plata = DATE '2026-10-30' WHERE numar_factura = 'F-A3' AND stare_plata IS NULL RETURNING id`)
  tine(u1.rows && u1.rows.length === 1, `editorul marchează F-A3 plătită (${u1.err || u1.rows.length})`)
  c = await calcul(db, '2026-10-01', '2026-11-13')
  tine(JSON.stringify(c.blocaje) === '["achizitii_fara_tva:1"]', `plătită la termen fără valoarea fără TVA: blocaj (${JSON.stringify(c.blocaje)})`)
  await caRol(db, 'authenticated', U.ED, `UPDATE public.upa_achizitii SET valoare_fara_tva = 100 WHERE numar_factura = 'F-A3' AND valoare_fara_tva IS NULL`)
  // pontajul: o zi lucrătoare fără rând = blocaj (nu „exact”)
  await db.query(`DELETE FROM public.pontaj_records WHERE employee_id = 5 AND date = '2026-10-14'`)
  c = await calcul(db, '2026-10-01', '2026-11-13')
  tine(JSON.stringify(c.blocaje) === '["pontaj_lipsa:1"]' && c.poate_inchide === false, `o zi de pontaj lipsă: blocat (${JSON.stringify(c.blocaje)})`)
  await db.query(`INSERT INTO public.pontaj_records (employee_id, date) VALUES (5, '2026-10-14')`)
  // contractul: fără data angajării / fără normă = blocaj
  await db.exec(`UPDATE public.employees SET hire_date = NULL WHERE id = 60; UPDATE public.employees SET procent_ocupare = NULL WHERE id = 59`)
  c = await calcul(db, '2026-10-01', '2026-11-13')
  tine(lista(c.blocaje).includes('angajati_fara_data_angajarii:1') && lista(c.blocaje).includes('angajati_fara_norma:1'), `fără data angajării / normă: blocat (${JSON.stringify(c.blocaje)})`)
  await db.exec(`UPDATE public.employees SET hire_date = '2020-01-01' WHERE id = 60; UPDATE public.employees SET procent_ocupare = 100 WHERE id = 59`)
  // calendarul anului incomplet = blocaj
  await db.query(`UPDATE public.calendar_days SET type = 'holiday' WHERE date = '2026-12-25'`)
  c = await calcul(db, '2026-10-01', '2026-11-13')
  tine(lista(c.blocaje).includes('calendar_incomplet:2026'), `calendarul 2026 fără 25.12: blocat (${JSON.stringify(c.blocaje)})`)
  await db.query(`UPDATE public.calendar_days SET type = 'legal' WHERE date = '2026-12-25'`)
  // gata: A = 6.000 + 100 = 6.100 > 5.709 -> deducere 5.709, de plată 5.709,00, report 391,00
  c = await calcul(db, '2026-10-01', '2026-11-13')
  tine(c.poate_inchide === true && !lista(c.blocaje).length && n(c.achizitii_fara_tva) === 6100 && n(c.deducere) === 5709 && n(c.de_plata) === 5709 && n(c.report_iesit) === 391,
    `13.11 complet: A 6.100, deducere 5.709, de plată 5.709,00, report 391,00 (${[c.poate_inchide, c.achizitii_fara_tva, c.deducere, c.de_plata, c.report_iesit].join(' ')} ${JSON.stringify(c.blocaje)})`)
  // cronul pe 14.11: gata, dar NU închide; calcul_de_confirmat doar owner-ului
  const ni = Number((await q1(db, `SELECT count(*)::int AS n FROM public.notifications`)).n)
  r = await rezerva(db, '2026-11-15')
  const nConf = Number((await q1(db, `SELECT count(*)::int AS n FROM public.notifications`)).n) - ni
  tine(r.luna_de_inchis?.gata === true && !lista(r.erori_config).includes('calcul_neinchis') && nConf === 1
    && Number((await q1(db, `SELECT count(*)::int AS n FROM public.upa_calcul_lunar`)).n) === 0,
    `15.11: gata de închis, owner-ul anunțat (calcul_de_confirmat), cronul nu închide (${JSON.stringify(r.luna_de_inchis)} +${nConf})`)
  // închiderea: amprenta greșită -> 40001; amprenta veche (o factură nouă după afișare) -> 40001; nimic scris
  tine(/s-au schimbat/.test(await eroare(inchide(db, '2026-10-01', '2026-11-15', 'x'.repeat(32))) || ''), 'amprenta greșită: 40001, nimic închis')
  const ampVazuta = c.amprenta
  await achizitie(db, 'F-A4', '2026-10-01', 119, 100, '2026-10-29')
  tine(/s-au schimbat/.test(await eroare(inchide(db, '2026-10-01', '2026-11-15', ampVazuta)) || ''), 'o factură adăugată după afișare: 40001 (amprenta veche)')
  await db.query(`DELETE FROM public.upa_achizitii WHERE numar_factura = 'F-A4'`)
  await db.query(`UPDATE public.pontaj_records SET norma = 'CFP' WHERE employee_id = 7 AND date = '2026-10-20'`)
  tine(/s-au schimbat/.test(await eroare(inchide(db, '2026-10-01', '2026-11-15', ampVazuta)) || ''), 'pontajul schimbat după afișare: 40001')
  await db.query(`UPDATE public.pontaj_records SET norma = NULL WHERE employee_id = 7 AND date = '2026-10-20'`)
  // editorul nu închide (confirmarea datelor HR e a owner-ului); owner-ul, din ecran, cu amprenta văzută
  const ie = await inchideEcran(db, U.ED, '2026-10-01', ampVazuta)
  tine(ie.err === '42501', `editorul: închiderea refuzată 42501 (${ie.err || 'trecut'})`)
  const io = await inchideEcran(db, U.OWNER, '2026-10-01', ampVazuta)
  tine(io.rows && io.rows[0].r.inchis === true && io.rows[0].r.deja === false, `owner-ul închide octombrie din ecran (${io.err || JSON.stringify(io.rows[0].r).slice(0, 80)} ${io.msg || ''})`)
  const inc = await q1(db, `SELECT * FROM public.upa_calcul_lunar WHERE luna = '2026-10-01'`)
  tine(inc && Number(inc.nma) === NMA_OCT && inc.nr_angajati === NR_OCT && Number(inc.posturi) === 2.64 && Number(inc.suma_datorata) === 11418 && Number(inc.jumatate) === 5709
    && Number(inc.achizitii_fara_tva) === 6100 && Number(inc.deducere) === 5709 && Number(inc.de_plata) === 5709 && Number(inc.report_iesit) === 391
    && inc.confirmat_de === U.OWNER && inc.amprenta === ampVazuta,
    `octombrie închis (${inc ? [inc.nma, inc.nr_angajati, inc.posturi, inc.suma_datorata, inc.deducere, inc.de_plata, inc.report_iesit, inc.confirmat_de === U.OWNER].join(' ') : 'lipsă'})`)
  const det = (await db.query(`SELECT employee_id, zile_calcul, zile_cfs, zile_suspendare, zile_administrator, zile_fara_efectiv, zile_numarate, contributie::text AS c FROM public.upa_calcul_angajat WHERE luna = '2026-10-01' ORDER BY employee_id`)).rows
  const d = id => det.find(x => x.employee_id === id) || {}
  tine(det.length === NR_OCT && d(61).zile_calcul === 16 && d(62).c === '15.5000' && d(63).zile_calcul === 10 && d(64).zile_cfs === 7 && d(64).c === '24.0000'
    && d(65).zile_suspendare === 3 && d(2).zile_suspendare === 3 && d(66).zile_administrator === 31 && d(70).zile_suspendare === 31 && d(71).zile_suspendare === 2
    && d(72).c === '23.0000' && d(73).zile_administrator === 16 && d(73).c === '15.0000' && d(74).zile_suspendare === 31 && d(74).c === '0.0000'
    && d(1).c === '31.0000' && d(3).c === '31.0000' && !det.some(x => x.employee_id === 67 || x.employee_id === 69),
    `detaliul pe angajat (${det.length} rânduri; 64 cfs ${d(64).zile_cfs}/${d(64).c}, 70 susp ${d(70).zile_suspendare}, 71 ${d(71).zile_suspendare}, 72 ${d(72).c}, 73 adm ${d(73).zile_administrator}/${d(73).c}, 74 ${d(74).c})`)
  const deja = await inchideEcran(db, U.OWNER, '2026-10-01', ampVazuta)
  tine(deja.rows && deja.rows[0].r.deja === true, 'a doua închidere: „deja”')
  // nemodificabil pe orice cale; corecțiile HR și parametrii lunii închise refuzate
  tine(/nu se modifica/.test(await eroare(db.query(`UPDATE public.upa_calcul_lunar SET de_plata = 0 WHERE luna = '2026-10-01'`)) || ''), 'luna închisă nu se modifică (UPDATE)')
  tine(/nu se modifica/.test(await eroare(db.query(`DELETE FROM public.upa_calcul_angajat WHERE luna = '2026-10-01'`)) || ''), 'detaliul nu se șterge')
  let p = await perioada(db, U.OWNER, 5, '2026-10-20', '2026-10-21', 0.5, null, false)
  tine(p.err === 'UPA03', `corecție HR pe o lună închisă: UPA03 (${p.err || 'trecut'})`)
  p = await perioada(db, U.OWNER, 74, '2026-11-15', '2026-11-20', null, null, true)
  tine(p.err === 'UPA05', `corecție suprapusă: UPA05 (${p.err || 'trecut'})`)
  const idSusp = (await q1(db, `SELECT id FROM public.upa_angajat_perioade WHERE employee_id = 74`)).id
  const st = await caRol(db, 'authenticated', U.OWNER, 'SELECT public.fn_upa_perioada_sterge($1::bigint) AS r', [idSusp])
  tine(st.err === 'UPA03', `ștergerea unei corecții folosite de o lună închisă: UPA03 (${st.err || 'trecut'})`)
  let s = await seteaza(db, U.OWNER, 'salariu_minim', '2026-10-01', 5000, null)
  tine(s.err === 'UPA03', `salariul minim pe o lună închisă: UPA03 (${s.err || 'trecut'})`)
  s = await seteaza(db, U.ED, 'salariu_minim', '2027-01-01', 4600, null)
  tine(!s.err, `editorul pune salariul minim din 2027 (${s.err || 'ok'} ${s.msg || ''})`)
  s = await seteaza(db, U.ED, 'salariu_minim', '2027-01-01', 4700, null)
  tine(s.err === '40001', `CAS: valoarea văzută veche -> 40001 (${s.err || 'trecut'})`)
  s = await seteaza(db, U.OWNER, 'report_initial', '2026-10-01', 100, 0)
  tine(s.err === 'UPA03', `reportul inițial după prima lună închisă: UPA03 (${s.err || 'trecut'})`)
  // după închidere: sursele schimbate se văd (instantaneul rămâne)
  await achizitie(db, 'F-A5', '2026-10-01', 119, 100, '2026-10-30')
  c = await calcul(db, '2026-10-01', '2026-11-16')
  // acum: F-A1 6.000 + F-A2 500 (plătită târziu) + F-A3 100 + F-A5 100 = 6.700 (F-A4 a fost ștearsă)
  tine(c.stare === 'definitiv' && n(c.achizitii_fara_tva) === 6100 && n(c.achizitii_acum) === 6700 && c.surse_schimbate?.achizitii === true && c.surse_schimbate?.angajati === false,
    `după închidere: instantaneul 6.100, acum 6.700, sursele schimbate semnalate (${c.achizitii_fara_tva} / ${c.achizitii_acum} ${JSON.stringify(c.surse_schimbate)})`)
  // noiembrie: report 391 + 500 (plata necunoscută: intră în previziune, cu avertisment) -> deducere 891, de plată 10.873,00
  await achizitie(db, 'F-N1', '2026-11-01', 595, 500, null)
  c = await calcul(db, '2026-11-01', '2026-11-24')
  tine(n(c.nma) === NMA_NOV && c.nr_angajati === NR_NOV && n(c.posturi) === 2.72 && n(c.suma_datorata) === 11764 && n(c.jumatate) === 5882,
    `NMA noiembrie ${NMA_NOV} (zilele 1.11 și 30.11 cu efectivul zilelor lucrătoare precedente): posturi 2,72, contribuția 11.764,00 (${[c.nma, c.nr_angajati, c.posturi, c.suma_datorata].join(' ')})`)
  tine(n(c.report_intrat) === 391 && n(c.achizitii_fara_tva) === 500 && n(c.deducere) === 891 && n(c.de_plata) === 10873 && n(c.report_iesit) === 0
    && n(c.ramas_de_cumparat) === 4991 && lista(c.avertismente).includes('achizitii_neplatite:1'),
    `nov: report 391 + 500 -> deducere 891, de plată 10.873,00, mai sunt 4.991 de cumpărat (${[c.report_intrat, c.deducere, c.de_plata, c.ramas_de_cumparat].join(' ')} ${JSON.stringify(c.avertismente)})`)
  tine(c.termen_stat === '2026-12-21', `termenul pentru noiembrie: 21.12.2026, nu 25.12 (${c.termen_stat})`)
  await db.query(`UPDATE public.upa_achizitii SET stare_plata = 'platita', data_plata = '2026-11-20' WHERE numar_factura = 'F-N1'`)
  // alerta zilei: înainte de prag (24) nimic nou; din 25: previziunea
  r = await rezerva(db, '2026-11-24')
  tine(!lista(r.randuri).some(x => x.fel === 'zilnic'), '24.11 (înainte de prag): nicio alertă a zilei')
  r = await rezerva(db, '2026-11-25')
  const z = lista(r.randuri).find(x => x.fel === 'zilnic')
  tine(z && n(z.ramas) === 4991 && n(z.plafon) === 5491 && n(z.consumat) === 500 && z.zile_ramase === 6 && z.calcul?.stare === 'previziune',
    `25.11: alerta previziunii (rămas 4.991, deducerea rămasă 5.491, cumpărat 500, 6 zile) (${z ? [z.ramas, z.plafon, z.consumat, z.zile_ramase].join(' ') : 'lipsă'})`)
  r = await rezerva(db, '2026-11-25')
  tine(lista(r.randuri).length === 0, 'a doua rulare din 25.11: nicio alertă nouă')
  await achizitie(db, 'F-N2', '2026-11-01', 5940, 4991, '2026-11-26')
  const sit = (await q1(db, `SELECT public.fn_upa_situatie_la('2026-11-26'::date, 3) AS s`)).s
  tine(sit.in_alerta === false && n(sit.luni[0].ramas_de_cumparat) === 0, `după 4.991 în plus: in_alerta false (${sit.in_alerta} ${sit.luni[0].ramas_de_cumparat})`)
  // noiembrie pe 13.12: A = 5.491 + report 391 = 5.882 = deducerea maximă -> de plată 5.882,00, report 0; termenul 21.12.2026
  c = await calcul(db, '2026-11-01', '2026-12-12')
  tine(c.poate_inchide === false, '12.12: noiembrie încă previziune')
  c = await calcul(db, '2026-11-01', '2026-12-13')
  const rn = await inchide(db, '2026-11-01', '2026-12-13', c.amprenta)
  const nov = await q1(db, `SELECT deducere::text AS ded, de_plata::text AS p, report_iesit::text AS ri, report_intrat::text AS rin, termen_stat::text AS t FROM public.upa_calcul_lunar WHERE luna = '2026-11-01'`)
  tine(rn?.inchis === true && nov && nov.ded === '5882.00' && nov.p === '5882.00' && nov.ri === '0.00' && nov.rin === '391.00' && nov.t === '2026-12-21',
    `13.12: noiembrie închis, termenul 21.12.2026 (${nov ? [nov.rin, nov.ded, nov.p, nov.ri, nov.t].join(' ') : 'lipsă ' + JSON.stringify(rn).slice(0, 200)})`)
  const d70 = await q1(db, `SELECT zile_suspendare, zile_administrator FROM public.upa_calcul_angajat WHERE luna = '2026-11-01' AND employee_id = 73`)
  tine(d70 && d70.zile_administrator === 1, `nov: 73 are 1.11 ca administrator (efectivul din 30.10) (${JSON.stringify(d70)})`)
  return ab
}

// ── tranziția: alerta exactă după închiderea din ecran, cu jurnal legacy pentru aceeași lună (P1-6) ──
async function tranzitieAlerta(db) {
  const ab = []
  const tine = (c, m) => { if (!c) ab.push(m) }
  // rândul v10 al lunii (închiderea veche din 1.11, trimis) — înainte, aceeași cheie suprima mesajul nou
  const leg = await q1(db, `SELECT count(*)::int AS n FROM public.upa_alerta_jurnal WHERE cheie = 'inchidere:2026-10' AND fel = 'inchidere'`)
  tine(leg.n === 1, `jurnalul legacy are inchidere:2026-10 (${leg.n})`)
  await seteaza(db, U.OWNER, 'angajati_handicap', '2026-10-01', 0, null)
  await db.query(`UPDATE public.employees SET termination_date = '2026-09-30' WHERE id = 67`)
  for (const [emp, a, b, nr, adm, s] of [[72, '2026-10-01', '2026-10-15', 1, null, false], [73, '2026-10-16', '2026-10-31', null, true, false], [74, '2026-10-01', '2026-11-30', null, null, true]])
    await perioada(db, U.OWNER, emp, a, b, nr, adm, s)
  await achizitie(db, 'F-T1', '2026-10-01', 3570, 3000, '2026-10-28')
  // owner-ul închide din ecran ÎNAINTEA cronului
  const c = await calcul(db, '2026-10-01', '2026-11-14')
  const io = await inchideEcran(db, U.OWNER, '2026-10-01', c.amprenta)
  tine(io.rows && io.rows[0].r.inchis === true, `închis din ecran (${io.err || ''} ${io.msg || ''} ${JSON.stringify(c.blocaje)})`)
  // cronul de a doua zi: luna era deja închisă, dar alerta exactă se trimite (cheia calcul:2026-10, nesuprimată de rândul legacy)
  let r = await rezerva(db, '2026-11-15')
  const rr = lista(r.randuri).find(x => x.fel === 'calcul')
  const jr = await q1(db, `SELECT * FROM public.upa_alerta_jurnal WHERE cheie = 'calcul:2026-10'`)
  // A 3.000 < 5.709 -> de plată 11.418 − 3.000 = 8.418,00
  tine(rr && jr && jr.stare === 'rezervat' && Number(jr.plafon) === 11418 && Number(jr.consumat) === 3000 && Number(jr.ramas) === 8418 && rr.calcul?.stare === 'definitiv'
    && jr.nr_destinatari === 2 && jr.nr_dest_ignorati === 1,
    `alerta exactă recuperată după închiderea din ecran (${jr ? [jr.stare, jr.plafon, jr.consumat, jr.ramas].join(' ') : 'lipsă'})`)
  const nt = await q1(db, `SELECT title FROM public.notifications WHERE title LIKE 'Fond handicap octombrie 2026: de plată%' LIMIT 1`)
  tine(nt && /8\.418,00 lei până pe 25\.11\.2026/.test(nt.title), `notificarea exactă: ${nt?.title}`)
  r = await rezerva(db, '2026-11-15')
  tine(!lista(r.randuri).some(x => x.fel === 'calcul'), 'a doua rulare: alerta exactă nu se dublează')
  return ab
}
const LEGACY = async db => { await db.query(`INSERT INTO public.upa_alerta_jurnal (cheie, fel, zi, luna, plafon, consumat, ramas, zile_ramase, nr_destinatari, nr_dest_ignorati, stare, eroare)
  VALUES ('inchidere:2026-10', 'inchidere', '2026-11-01', '2026-10-01', 7000, 0, 7000, NULL, 2, 0, 'trimis', NULL)`) }

// ── intențiile de dinainte de migrare și ale clientului vechi (P1-5) ──
const K0 = '22222222-2222-4333-8444-000000000000', K1 = '22222222-2222-4333-8444-000000000001'
const RAND_VECHI = { furnizor_id: 1, numar_factura: 'V-0', data_factura: '2026-11-03', luna: '2026-11-01', valoare: 119 }
const rpcAch = (db, uid, cheie, r) => caRol(db, 'authenticated', uid, 'SELECT public.fn_upa_achizitie_adauga($1::uuid, $2::jsonb) AS r', [cheie, JSON.stringify(r)])
const INTENTIE_VECHE = async db => { const x = await rpcAch(db, U.ED, K0, RAND_VECHI); if (!x.rows || x.rows[0].r.stare !== 'nou') throw new Error('intenția veche: ' + (x.err || JSON.stringify(x.rows))) }
async function intentii(db) {
  const ab = []
  const tine = (c, m) => { if (!c) ab.push(m) }
  // salvarea veche a intrat, răspunsul s-a pierdut, s-a aplicat migrarea: reîncercarea identică = existent (nu UPA02)
  let x = await rpcAch(db, U.ED, K0, RAND_VECHI)
  tine(x.rows && x.rows[0].r.stare === 'existent', `reîncercarea intenției de dinainte de migrare: existent (${x.err || x.rows[0].r.stare} ${x.msg || ''})`)
  x = await rpcAch(db, U.ED, K0, { ...RAND_VECHI, valoare_fara_tva: 100 })
  tine(x.err === 'UPA02', `aceeași cheie + valoarea fără TVA în plus: UPA02 (${x.err || 'trecut'})`)
  // clientul nou: valorile noi intră în amprentă (v2)
  const K = '11111111-2222-4333-8444-555555555555'
  const rand = { furnizor_id: 1, numar_factura: 'R-1', data_factura: '2026-11-03', luna: '2026-11-01', valoare: 119, valoare_fara_tva: 100, data_plata: '2026-11-04', stare_plata: 'platita' }
  x = await rpcAch(db, U.ED, K, rand)
  tine(x.rows && x.rows[0].r.stare === 'nou', `RPC: nou (${x.err || x.rows[0].r.stare} ${x.msg || ''})`)
  x = await rpcAch(db, U.ED, K, rand)
  tine(x.rows && x.rows[0].r.stare === 'existent', `RPC: reluarea = existent (${x.err || x.rows[0].r.stare})`)
  for (const [ce, alt] of [['altă dată a plății', { data_plata: '2026-11-05' }], ['altă valoare fără TVA', { valoare_fara_tva: 101 }], ['altă stare a plății', { stare_plata: 'neplatita', data_plata: null }]]) {
    x = await rpcAch(db, U.ED, K, { ...rand, ...alt })
    tine(x.err === 'UPA02', `RPC: aceeași cheie + ${ce} = UPA02 (${x.err || 'trecut'})`)
  }
  const v = await q1(db, `SELECT valoare_fara_tva::text AS f, data_plata::text AS p, stare_plata AS s, hash_intentie AS h FROM public.upa_achizitii WHERE numar_factura = 'R-1'`)
  tine(v && v.f === '100.00' && v.p === '2026-11-04' && v.s === 'platita' && /^v2:[0-9a-f]{32}$/.test(v.h), `rândul are valorile noi și amprenta v2 (${JSON.stringify(v)})`)
  x = await rpcAch(db, U.ED, '11111111-2222-4333-8444-555555555556', { ...rand, numar_factura: 'R-2', valoare_fara_tva: 120 })
  tine(x.err === '23514', `valoarea fără TVA > valoarea cu TVA: refuz 23514 (${x.err || 'trecut'})`)
  x = await rpcAch(db, U.ED, '11111111-2222-4333-8444-555555555557', { ...rand, numar_factura: 'R-3', stare_plata: 'platita', data_plata: null })
  tine(x.err === '23514', `plătită fără dată: refuz 23514 (${x.err || 'trecut'})`)
  // clientul vechi (8 câmpuri) după migrare: amprenta = cea din 20261229a (calculată de funcția veche, neatinsă)
  x = await rpcAch(db, U.ED, K1, { ...RAND_VECHI, numar_factura: 'V-1' })
  const h1 = await q1(db, `SELECT a.hash_intentie = public.fn_upa_hash_intentie(to_jsonb(a)) AS eq FROM public.upa_achizitii a WHERE a.cheie_intentie = $1::uuid`, [K1])
  tine(x.rows && x.rows[0].r.stare === 'nou' && h1?.eq === true, `clientul vechi după migrare: amprenta din 20261229a (${x.err || x.rows[0].r.stare} ${h1?.eq})`)
  return ab
}

// ── drepturile ca non-owner (L25) ──
async function drepturi(db) {
  const ab = []
  const tine = (c, m) => { if (!c) ab.push(m) }
  const sit = await caRol(db, 'authenticated', U.VW, `SELECT public.fn_upa_situatie('2026-11-20'::date, 2) AS s`)
  tine(sit.rows && sit.rows[0].s.luni.length === 2, `viewer: situația (agregate) se citește (${sit.err || 'ok'})`)
  const an = await caRol(db, 'anon', null, `SELECT public.fn_upa_situatie('2026-11-20'::date, 2) AS s`)
  tine(an.err === '42501', `anon: situația refuzată (${an.err || 'trecut'})`)
  const nul = await caRol(db, 'authenticated', null, `SELECT public.fn_upa_situatie('2026-11-20'::date, 2) AS s`)
  tine(nul.err === '42501', `authenticated fără identitate (auth.uid() NULL): refuz 42501 (${nul.err || 'trecut'})`)
  const intern = await caRol(db, 'authenticated', U.OWNER, `SELECT public.fn_upa_situatie_la('2026-11-20'::date, 2) AS s`)
  tine(intern.err === '42501', `funcția internă fn_upa_situatie_la nu e chemabilă (${intern.err || 'trecut'})`)
  const emp = await caRol(db, 'authenticated', U.ED, `SELECT count(*) FROM public.employees`)
  tine(emp.err === '42501', `editorul nu citește employees direct (calculul trece prin DEFINER) (${emp.err || 'trecut'})`)
  const dto = await caRol(db, 'authenticated', U.OWNER, `SELECT public.fn_upa_calcul_detaliu('2026-10-01'::date) AS d`)
  tine(dto.rows && dto.rows[0].d.angajati.length > 0 && Array.isArray(dto.rows[0].d.perioade), `owner: detaliul pe angajat + corecțiile (${dto.err || dto.rows[0].d.angajati.length})`)
  for (const [cine, uid] of [['editor', U.ED], ['admin administrativ', U.AD], ['viewer', U.VW]]) {
    const de = await caRol(db, 'authenticated', uid, `SELECT public.fn_upa_calcul_detaliu('2026-10-01'::date) AS d`)
    tine(de.err === '42501', `${cine}: detaliul pe angajat refuzat (${de.err || 'trecut'})`)
    const pe = await perioada(db, uid, 5, '2027-03-01', '2027-03-05', 0.5, null, false)
    tine(pe.err === '42501', `${cine}: corecția HR refuzată (${pe.err || 'trecut'})`)
    const vp = await caRol(db, 'authenticated', uid, `SELECT count(*)::int AS n FROM public.upa_angajat_perioade`)
    tine(vp.rows && vp.rows[0].n === 0, `${cine}: corecțiile HR nu se văd direct (RLS owner) (${vp.err || vp.rows[0].n})`)
  }
  const pi = await perioada(db, U.OWNER, 5, '2027-03-01', '2027-03-05', 0.5, null, false, '   ')
  tine(pi.err === '22023', `corecție fără motiv: 22023 (${pi.err || 'trecut'})`)
  const ins = await caRol(db, 'authenticated', U.OWNER, `INSERT INTO public.upa_parametri (cheie, de_la, valoare, sursa) VALUES ('salariu_minim', '2030-01-01', 1, 'migrare')`)
  tine(ins.err === '42501', `nimeni nu scrie direct în upa_parametri (${ins.err || 'trecut'})`)
  const insp = await caRol(db, 'authenticated', U.OWNER, `INSERT INTO public.upa_angajat_perioade (employee_id, de_la, pana_la, norma, nota, setat_de) VALUES (5, '2030-01-01', '2030-01-02', 1, 'x', '${U.OWNER}')`)
  tine(insp.err === '42501', `nimeni nu scrie direct în upa_angajat_perioade (${insp.err || 'trecut'})`)
  const inv = await inchideEcran(db, U.VW, '2026-10-01', 'x')
  tine(inv.err === '42501', `viewer: închiderea refuzată (${inv.err || 'trecut'})`)
  const iint = await caRol(db, 'authenticated', U.OWNER, `SELECT public.fn_upa_calcul_inchide_la('2026-10-01'::date, '2026-11-20'::date, 'x', '${U.OWNER}'::uuid) AS r`)
  tine(iint.err === '42501', `închiderea internă (fără verificarea owner-ului) nu e chemabilă (${iint.err || 'trecut'})`)
  return ab
}

// ── exemplele din review (Legea 448/2006 art. 78; oracol independent, de mână) + factura neplătită (P1-7) ──
// n angajați întregi în octombrie, 0 cu handicap; fiecare caz pe o bază nouă
async function exemplu(nAng, achizitii, text = MIG, handicap = 0) {
  const db = await bazaProd({ date: BAZA + angajati(nAng) + PONTAJ_PLIN })
  try {
    await aplica(db, text)
    await seteaza(db, U.OWNER, 'angajati_handicap', '2026-10-01', handicap, null)
    for (const [nr, v, f, p, s] of achizitii) await achizitie(db, nr, '2026-10-01', v, f, p, s)
    const c = await calcul(db, '2026-10-01', '2026-11-20')
    let inchis = null
    if (c.poate_inchide) inchis = await inchide(db, '2026-10-01', '2026-11-20', c.amprenta)
    return { c, inchis }
  } finally { await db.close() }
}
async function exemple(text = MIG) {
  const ab = []
  const tine = (c, m) => { if (!c) ab.push(m) }
  try {
    // NMA 75: posturi 4% x 75 = 3,00; contribuția integrală 3 x 4.325 = 12.975,00; fără achiziții: de plată 12.975,00
    let { c } = await exemplu(75, [], text)
    tine(n(c.nma) === 75 && n(c.posturi) === 3 && n(c.suma_datorata) === 12975 && n(c.jumatate) === 6487.5 && n(c.de_plata) === 12975 && n(c.report_iesit) === 0,
      `NMA 75, 0 achiziții: de plată 12.975,00 (${[c.nma, c.posturi, c.suma_datorata, c.de_plata].join(' ')})`)
    // 8.000 lei achiziții: deducere 6.487,50 (jumătate), de plată 6.487,50, report 1.512,50
    ;({ c } = await exemplu(75, [['E-1', 9520, 8000, '2026-10-20']], text))
    tine(n(c.deducere) === 6487.5 && n(c.de_plata) === 6487.5 && n(c.report_iesit) === 1512.5,
      `NMA 75, 8.000 achiziții: de plată 6.487,50, report 1.512,50 (${[c.deducere, c.de_plata, c.report_iesit].join(' ')})`)
    // NMA 75 cu 1 angajat cu handicap: locuri 3 − 1 = 2; contribuția 2 x 4.325 = 8.650,00
    ;({ c } = await exemplu(75, [], text, 1))
    tine(n(c.locuri) === 2 && n(c.suma_datorata) === 8650 && n(c.de_plata) === 8650, `NMA 75, 1 angajat cu handicap: 2 locuri, 8.650,00 (${[c.locuri, c.suma_datorata].join(' ')})`)
    // NMA 64: posturi 2,56 (nu 2); contribuția 2,56 x 4.325 = 11.072,00; deducerea maximă 5.536,00
    ;({ c } = await exemplu(64, [], text))
    tine(n(c.posturi) === 2.56 && n(c.suma_datorata) === 11072 && n(c.jumatate) === 5536 && n(c.de_plata) === 11072,
      `NMA 64: posturi 2,56, contribuția 11.072,00, deducerea maximă 5.536,00 (${[c.posturi, c.suma_datorata, c.jumatate, c.de_plata].join(' ')})`)
    // factura neplătită (1.000 fără TVA): nu blochează, iese din deducere -> de plată 12.975,00, luna se închide
    let r = await exemplu(75, [['E-2', 1190, 1000, null, 'neplatita']], text)
    tine(r.c.poate_inchide === true && n(r.c.deducere) === 0 && n(r.c.de_plata) === 12975 && lista(r.c.avertismente).includes('achizitii_neplatite_excluse:1')
      && r.inchis?.inchis === true && n(r.inchis?.calcul?.de_plata) === 12975,
      `factura neplătită: nu blochează, deducere 0, de plată 12.975,00, închis (${[r.c.poate_inchide, r.c.deducere, r.c.de_plata].join(' ')} ${JSON.stringify(r.c.blocaje)})`)
    // plata necunoscută după sfârșitul lunii: blochează (necunoscut ≠ neplătit)
    r = await exemplu(75, [['E-3', 1190, 1000, null, null]], text)
    tine(r.c.poate_inchide === false && lista(r.c.blocaje).includes('achizitii_fara_stare_plata:1'), `plata necunoscută: blocaj (${JSON.stringify(r.c.blocaje)})`)
    // sub 50 de angajați: nicio obligație, achiziția se reportează
    ;({ c } = await exemplu(40, [['E-4', 119, 100, '2026-10-15']], text))
    tine(n(c.nma) === 40 && n(c.posturi) === 0 && n(c.suma_datorata) === 0 && n(c.de_plata) === 0 && n(c.report_iesit) === 100 && lista(c.avertismente).includes('sub_50_angajati'),
      `sub 50 de angajați: nicio obligație, achiziția se reportează (${[c.nma, c.posturi, c.suma_datorata, c.report_iesit].join(' ')})`)
  } catch (e) { ab.push('excepție la exemple: ' + e.message) }
  return ab
}

console.log('1. aplicarea ca la livrare (L15 v2) după 20261229a / b / c; reaplicarea refuzată')
{
  const db = await bazaProd()
  const j = await aplicaLivrare(db)
  ok(j.some(m => /^20270101a: lock la \d+ ms de la BEGIN \(1 incercari/.test(m)), 'blocul de lock: o încercare')
  ok(/reaplicare/.test(await eroare(aplica(db)) || ''), 'reaplicarea refuzată')
  const p = (await db.query(`SELECT cheie, de_la::text AS d, valoare::text AS v, sursa FROM public.upa_parametri ORDER BY cheie`)).rows
  ok(p.length === 2 && p[0].cheie === 'report_initial' && p[0].d === '2026-10-01' && p[0].v === '0.00' && p[1].cheie === 'salariu_minim' && p[1].d === '2026-07-01' && p[1].v === '4325.00',
    `parametrii de start: ${JSON.stringify(p)}`)
  await db.close()
}

console.log('2. scenariul A (oct: peste jumătate, report; nov: report consumat, termenul 21.12), blocajele, închiderea pe amprentă, drepturile')
{
  const db = await bazaProd()
  await aplica(db)
  const ab = await scenariuA(db)
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `scenariul A (${ab.length} abateri)`)
  const ad = await drepturi(db)
  ad.forEach(a => console.log('     ' + a))
  ok(ad.length === 0, `drepturile (${ad.length} abateri)`)
  await db.close()
}

console.log('3. exemplele din review (NMA 75 / 64), factura neplătită, plata necunoscută, sub 50')
{
  const ab = await exemple()
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `exemplele (${ab.length} abateri)`)
}

console.log('3b. tranzițiile: intenția de dinainte de migrare; jurnal legacy + închiderea din ecran înaintea cronului')
{
  const db = await bazaProd({ inainte: async d => { await INTENTIE_VECHE(d); await LEGACY(d) } })
  await aplica(db)
  const ai = await intentii(db)
  ai.forEach(a => console.log('     ' + a))
  ok(ai.length === 0, `intențiile (${ai.length} abateri)`)
  const at = await tranzitieAlerta(db)
  at.forEach(a => console.log('     ' + a))
  ok(at.length === 0, `alerta exactă (${at.length} abateri)`)
  await db.close()
}

console.log('4. edge-ul (ruleazaAlertaUpa) pe BD-ul migrării, cu Resend simulat: alerta exactă după închidere și alerta zilei')
{
  const db = await bazaProd()
  await aplica(db)
  await seteaza(db, U.OWNER, 'angajati_handicap', '2026-10-01', 0, null)
  await db.query(`UPDATE public.employees SET termination_date = '2026-09-30' WHERE id = 67`)
  for (const [emp, a, b, nr, adm, s] of [[72, '2026-10-01', '2026-10-15', 1, null, false], [73, '2026-10-16', '2026-10-31', null, true, false], [74, '2026-10-01', '2026-11-30', null, null, true]])
    await perioada(db, U.OWNER, emp, a, b, nr, adm, s)
  await achizitie(db, 'F-E1', '2026-10-01', 7140, 6000, '2026-10-28')
  let azi = '2026-11-14'
  const sb = { rpc: async (nume, a) => {
    try {
      if (nume === 'fn_upa_alerta_rezerva') return { data: await rezerva(db, azi), error: null }
      if (nume === 'fn_upa_alerta_marcheaza') return { data: (await q1(db, 'SELECT public.fn_upa_alerta_marcheaza($1, $2, $3, $4) AS n', [a.p_id, a.p_stare, a.p_resend_id, a.p_eroare])).n, error: null }
      return { data: null, error: { code: 'PGRST202' } }
    } catch (e) { return { data: null, error: { code: e.code, message: e.message } } }
  } }
  const trimise = []
  const fetchFn = async (url, o) => { trimise.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ id: 're_' + trimise.length }) } }
  let x = await MOD_EDGE.ruleazaAlertaUpa({ sb, fetchFn, resendKey: 'k' })
  ok(x.status === 200 && x.body.trimis === 0 && trimise.length === 0, `14.11 (neînchis): niciun mail (${JSON.stringify(x.body).slice(0, 160)})`)
  const c = await calcul(db, '2026-10-01', '2026-11-14')
  await inchide(db, '2026-10-01', '2026-11-14', c.amprenta)
  azi = '2026-11-15'
  x = await MOD_EDGE.ruleazaAlertaUpa({ sb, fetchFn, resendKey: 'k' })
  ok(x.status === 200 && x.body.ok === true && x.body.trimis === 1 && trimise.length === 1, `15.11 (după închidere): un mail (${JSON.stringify(x.body).slice(0, 160)})`)
  ok(/^Fond handicap octombrie 2026: de plată la bugetul de stat 5\.709,00 lei până pe 25\.11\.2026$/.test(trimise[0]?.subject || ''), `subiectul exact: ${trimise[0]?.subject}`)
  // aici A = 6.000 (fără F-A3): deducere 5.709, report 6.000 − 5.709 = 291,00
  ok(/Număr mediu de angajați/.test(trimise[0]?.html) && /66,08/.test(trimise[0]?.html) && /2,64/.test(trimise[0]?.html) && /291,00/.test(trimise[0]?.html)
    && JSON.stringify(trimise[0]?.to) === '["ana@gazpet.ro","ion@gazpet.ro"]', 'corpul: NMA 66,08, locurile 2,64, reportul 291,00, doar destinatarii interni')
  ok((await q1(db, `SELECT stare FROM public.upa_alerta_jurnal WHERE cheie = 'calcul:2026-10'`)).stare === 'trimis', 'jurnalul: trimis')
  azi = '2026-11-25'
  x = await MOD_EDGE.ruleazaAlertaUpa({ sb, fetchFn, resendKey: 'k' })
  // nov: deducerea maximă 5.882 − report 291 − 0 cumpărat = 5.591 de cumpărat
  ok(x.body.trimis === 1 && /^Fond handicap noiembrie 2026 \(previziune\): mai sunt 5\.591,00 lei de cumpărat de la unități protejate, mai sunt 6 zile$/.test(trimise[1]?.subject || ''),
    `25.11: alerta previziunii: ${trimise[1]?.subject}`)
  ok(/30\.11\.2026/.test(trimise[1]?.html) && /21\.12\.2026/.test(trimise[1]?.html) && !/25\.12\.2026/.test(trimise[1]?.html), 'corpul previziunii: termenul UPA (30.11) și termenul la stat 21.12.2026')
  await db.close()
}

console.log('5. refuzurile migrării (nimic schimbat)')
for (const [nume, pregatire, o, re] of [
  ['fără marcajul runnerului', null, { marcaj: false }, /garda start invalida/],
  ['fără plafon', null, { plafon: 0, marcajPlafon: false }, /PLAFON_TRANZACTIE lipsa/],
  ['fără amprenta globală L15 v2', null, { l15: 'nimic' }, /AMPRENTA_GLOBALA_LIPSA/],
  ['fn_upa_alerta_proba schimbată față de 20261229a', `CREATE OR REPLACE FUNCTION public.fn_upa_alerta_proba() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT '{}'::jsonb $f$;`, {}, /fn_upa_alerta_proba\(\) nu e exact cea din 20261229a/],
  ['triggerul intenției schimbat', `CREATE OR REPLACE FUNCTION public.fn_upa_achizitii_intentie() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$ BEGIN RETURN NEW; END $f$;`, {}, /fn_upa_achizitii_intentie\(\) nu e exact/],
  ['drept în plus pe fn_upa_alerta_rezerva_la', `GRANT EXECUTE ON FUNCTION public.fn_upa_alerta_rezerva_la(date) TO authenticated;`, {}, /fn_upa_alerta_rezerva_la\(date\) nu e exact/],
  ['CHECK-ul jurnalului schimbat', `ALTER TABLE public.upa_alerta_jurnal DROP CONSTRAINT upa_alerta_jurnal_fel; ALTER TABLE public.upa_alerta_jurnal ADD CONSTRAINT upa_alerta_jurnal_fel CHECK (fel IS NOT NULL);`, {}, /CHECK-urile upa_alerta_jurnal/],
  ['employees.procent_ocupare lipsă', `ALTER TABLE public.employees DROP COLUMN procent_ocupare;`, {}, /coloana employees\.procent_ocupare lipseste/],
  ['pontaj_records.norma cu alt tip', `ALTER TABLE public.pontaj_records ALTER COLUMN norma TYPE integer USING NULL;`, {}, /coloana pontaj_records\.norma lipseste sau are alt tip/],
  ['pontajul fără unicitate pe (angajat, zi)', `ALTER TABLE public.pontaj_records DROP CONSTRAINT pontaj_records_employee_id_date_key;`, {}, /lipseste unicitatea pontaj_records/],
  ['calendar_days lipsă', `DROP TABLE public.calendar_days;`, {}, /coloana calendar_days\.date lipseste/],
  ['hr_decizii_semnatari lipsă', `DROP TABLE public.hr_decizii_semnatari;`, {}, /coloana hr_decizii_semnatari\.employee_id lipseste/],
  ['coloana valoare_fara_tva există deja', `ALTER TABLE public.upa_achizitii ADD COLUMN valoare_fara_tva numeric;`, {}, /reaplicare/],
  ['upa_achizitii ocupat (lock)', 'LOCK', {}, /BUGET_LOCK: upa_achizitii \/ upa_alerta_jurnal ocupat/],
]) {
  const db = await bazaProd()
  if (pregatire && pregatire !== 'LOCK') await db.exec(pregatire)
  const text = pregatire === 'LOCK' ? MIG.replace('      LOCK TABLE public.upa_achizitii IN ACCESS EXCLUSIVE MODE NOWAIT;\n', "      RAISE EXCEPTION 'ocupat' USING ERRCODE = '55P03';\n") : MIG
  const m = await eroare(aplica(db, text, o))
  const neschimbat = (await q1(db, `SELECT to_regclass('public.upa_parametri') IS NULL AS a`)).a
  ok(m && re.test(m) && neschimbat, `${nume}: ${m ? m.slice(0, 150) : 'A TRECUT'}`)
  await db.close()
}

console.log('6. revenirea: aplicare -> revenire -> reaplicare; intențiile peste revenire; apoi revenirile c -> b -> a; refuzuri')
{
  const db = await bazaProd({ inainte: INTENTIE_VECHE })
  await aplica(db)
  // clientul vechi creează o intenție DUPĂ migrare (câmpurile noi lipsă): revenirea o permite și amprenta rămâne valabilă
  await rpcAch(db, U.ED, K1, { ...RAND_VECHI, numar_factura: 'V-1' })
  let m = await eroare(revino(db))
  ok(m === null, 'revenirea pe o bază fără date noi: ' + (m || 'ok'))
  const st = await q1(db, `SELECT to_regclass('public.upa_parametri') IS NULL AS a, (SELECT count(*)::int FROM pg_attribute WHERE attrelid = 'public.upa_achizitii'::regclass AND attname IN ('valoare_fara_tva', 'data_plata', 'stare_plata') AND NOT attisdropped) AS c,
    md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_upa_alerta_rezerva_la(date)'::regprocedure), chr(13), '')) AS h`)
  ok(st.a && st.c === 0 && st.h === md5(sursaFn(MIG_A, 'CREATE FUNCTION public.fn_upa_alerta_rezerva_la(')), `obiectele scoase, rezervarea veche refăcută (${JSON.stringify(st)})`)
  for (const [k, nr] of [[K0, 'V-0'], [K1, 'V-1']]) {
    const x = await rpcAch(db, U.ED, k, { ...RAND_VECHI, numar_factura: nr })
    ok(x.rows && x.rows[0].r.stare === 'existent', `după revenire, reîncercarea intenției ${nr} (RPC-ul din 20261229a): existent (${x.err || x.rows[0].r.stare} ${x.msg || ''})`)
  }
  m = await eroare(aplica(db))
  ok(m === null, 'reaplicarea după revenire: ' + (m || 'ok'))
  const x2 = await rpcAch(db, U.ED, K0, RAND_VECHI)
  ok(x2.rows && x2.rows[0].r.stare === 'existent', `după reaplicare, intenția veche: existent (${x2.err || x2.rows[0].r.stare})`)
  m = await eroare(revino(db))
  ok(m === null, 'a doua revenire: ' + (m || 'ok'))
  await db.close()
  // revenirile c -> b -> a pe o bază fără intenții (20261229a refuză rândurile cu cheie, ca înainte)
  const db3 = await bazaProd()
  await aplica(db3)
  await revino(db3)
  m = (await eroare(caRunner(db3, NC + '_ROLLBACK', REV_C, { l15: 'nimic', plafon: PLAFON_REVENIRE }))) || (await eroare(caRunner(db3, NB + '_ROLLBACK', REV_B, { l15: 'nimic', plafon: PLAFON_REVENIRE })))
    || (await eroare(caRunner(db3, NA + '_ROLLBACK', REV_A, { l15: 'nimic', plafon: PLAFON_REVENIRE })))
  ok(m === null, 'după revenirea 20270101a, revenirile 20261229c -> b -> a trec (amprentele lor sunt neatinse): ' + (m || 'ok'))
  await db3.close()
  const db2 = await bazaProd()
  await aplica(db2)
  await revino(db2)
  const rv = (await q1(db2, `SELECT public.fn_upa_alerta_rezerva_la('2031-01-26'::date) AS r`)).r
  const ck = await eroare(db2.query(`INSERT INTO public.upa_alerta_jurnal (cheie, fel, zi, luna, stare, nr_destinatari, nr_dest_ignorati) VALUES ('calcul:2030-12', 'calcul', '2031-01-26', '2030-12-01', 'fara_mail', 0, 0)`))
  ok(rv && rv.activ === true && Array.isArray(rv.randuri) && !('luna_de_inchis' in rv) && ck && /upa_alerta_jurnal_fel|check/i.test(ck),
    'după revenire: rezervarea din 20261229a rulează (forma veche) și jurnalul nu mai acceptă felul calcul')
  await db2.close()
}
for (const [nume, pregatire, re] of [
  ['un parametru din ecran', async db => { await seteaza(db, U.OWNER, 'angajati_handicap', '2026-10-01', 0, null) }, /parametrii au fost schimbati/],
  ['o corecție HR', async db => { await perioada(db, U.OWNER, 5, '2026-10-01', '2026-10-02', 0.5, null, false) }, /corectii HR/],
  ['calculul închis', async db => {
    await seteaza(db, U.OWNER, 'angajati_handicap', '2026-10-01', 0, null); await db.query(`UPDATE public.employees SET termination_date = '2026-09-30' WHERE id = 67`)
    await db.query(`UPDATE public.employees SET active = false, termination_date = '2026-09-30' WHERE id IN (72, 73, 74)`)
    const c = await calcul(db, '2026-10-01', '2026-11-20'); const r = await inchide(db, '2026-10-01', '2026-11-20', c.amprenta)
    if (!r?.inchis) throw new Error('pregătirea: luna nu s-a închis ' + JSON.stringify(c.blocaje))
    await db.query(`DELETE FROM public.upa_parametri WHERE cheie = 'angajati_handicap'`) }, /exista luni cu calculul inchis/],
  ['o achiziție cu valoarea fără TVA', async db => { await achizitie(db, 'X-1', '2026-10-01', 119, 100, null) }, /valoarea fara TVA sau plata/],
  ['o achiziție neplătită (doar starea)', async db => { await achizitie(db, 'X-2', '2026-10-01', 119, null, null, 'neplatita') }, /valoarea fara TVA sau plata/],
  ['un index nou pe upa_parametri (amprenta)', async db => { await db.exec(`CREATE INDEX upa_parametri_x ON public.upa_parametri (valoare)`) }, /AMPRENTA obiectelor/],
  ['un drept în plus pe fn_upa_situatie (amprenta)', async db => { await db.exec(`GRANT EXECUTE ON FUNCTION public.fn_upa_situatie(date, integer) TO anon`) }, /AMPRENTA obiectelor/],
  ['un index pe coloana nouă (dependența)', async db => { await db.exec(`CREATE INDEX upa_ach_x ON public.upa_achizitii (data_plata)`) }, /AMPRENTA obiectelor/],
  ['fără marcajul runnerului', null, /garda invalida/],
]) {
  const db = await bazaProd()
  await aplica(db)
  let m
  try { if (pregatire) await pregatire(db); m = await eroare(revino(db, REV, nume === 'fără marcajul runnerului' ? { marcaj: false } : {})) } catch (e) { m = 'pregătire: ' + e.message }
  const ramas = (await q1(db, `SELECT to_regclass('public.upa_parametri') IS NOT NULL AS a`)).a
  ok(m && re.test(m) && ramas, `revenirea refuzată: ${nume}: ${m ? m.slice(0, 140) : 'A TRECUT'}`)
  await db.close()
}

if (!process.argv.includes('--fara-mutanti')) {
console.log('7. MUTANȚI (amprenta oprită, ca să se vadă că probele de comportament îi prind; fiecare TREBUIE să pice)')
const FARA_AMPRENTA = t => t.replace(/IF md5\(coalesce\(v_amp, ''\)\) IS DISTINCT FROM '[0-9a-f]{32}' THEN\n    RAISE NOTICE 'AMPRENTA_20270101a_TEXT/, "IF false THEN\n    RAISE NOTICE 'AMPRENTA_20270101a_TEXT")
const unic = (t, din, in_) => { if (t.split(din).length !== 2) throw new Error('textul mutantului nu e unic: ' + din.slice(0, 80)); return t.split(din).join(in_) }
// toate probele de comportament pe textul dat (scenariul A + drepturile; exemplele; tranzițiile)
async function toate(t) {
  let ab = []
  const db = await bazaProd()
  try { await aplica(db, t); ab = [...await scenariuA(db), ...await drepturi(db)] } catch (e) { ab = ['excepție: ' + e.message] } finally { await db.close() }
  if (!ab.length) ab = await exemple(t)
  if (!ab.length) {
    const d2 = await bazaProd({ inainte: async d => { await INTENTIE_VECHE(d); await LEGACY(d) } })
    try { await aplica(d2, t); ab = [...await intentii(d2), ...await tranzitieAlerta(d2)] } catch (e) { ab = ['excepție: ' + e.message] } finally { await d2.close() }
  }
  return ab
}
{
  // martorul: amprenta oprită trebuie să treacă toate probele (altfel mutanții nu dovedesc nimic)
  const ab = await toate(FARA_AMPRENTA(MIG))
  ok(ab.length === 0, `martorul (doar amprenta oprită): ${ab.length} abateri ${ab[0] || ''}`)
}
for (const [nume, din, in_] of [
  // formula (P1-1, P1-2)
  ['contribuția înjumătățită de două ori', 'v_d := round(v_loc * v_sal, 2);', 'v_d := round(v_loc * v_sal / 2, 2);'],
  ['posturile rotunjite în jos la întreg', 'v_post := CASE WHEN v_nma < 50 THEN 0 ELSE round(v_nma * 0.04, 2) END;', 'v_post := CASE WHEN v_nma < 50 THEN 0 ELSE floor(v_nma * 0.04) END;'],
  ['deducerea fără plafonul de jumătate', 'v_ded := least(v_a + v_rin, v_jum);', 'v_ded := least(v_a + v_rin, v_d);'],
  ['pragul de 50 scos', 'v_post := CASE WHEN v_nma < 50 THEN 0 ELSE', 'v_post := CASE WHEN false THEN 0 ELSE'],
  ['angajații cu handicap ignorați', 'v_loc := greatest(v_post - v_hand, 0);', 'v_loc := greatest(v_post, 0);'],
  // NMA (P1-3)
  ['administratorul nu se scoate', "AND lower(btrim(s.calitate)) = 'administrator') AS admin", 'AND false) AS admin'],
  ['CFS citit pe alt cod', "WHEN upper(btrim(p)) = 'CFP' THEN 'cfs'", "WHEN upper(btrim(p)) = 'CFS' THEN 'cfs'"],
  ['CM / BO / M numărate ca lucrate', "IN ('CM', 'BO', 'BP', 'AM', 'M') THEN 'suspendare'", "IN ('SUSP') THEN 'suspendare'"],
  ['fără regula zilei lucrătoare precedente', '(SELECT max(w.d) FROM c w WHERE w.lucr AND w.d <= c.d) AS r', 'c.d AS r'],
  ['sărbătorile legale ignorate', "  SELECT extract(isodow FROM p) < 6 AND NOT EXISTS (SELECT 1 FROM public.calendar_days c WHERE c.date = p AND c.type = 'legal')\n", '  SELECT extract(isodow FROM p) < 6\n'],
  ['ziua încetării exclusă', 'AND zi.d <= coalesce(e.termination_date, z.l1))', 'AND zi.d < coalesce(e.termination_date, z.l1 + 1))'],
  ['data angajării ignorată', 'WHERE zi.d >= coalesce(e.hire_date, z.l0) AND', 'WHERE zi.d >= z.l0 AND'],
  ['corecția de normă ignorată', 'coalesce(o.norma, e.procent_ocupare / 100.0) AS norma', '(e.procent_ocupare / 100.0) AS norma'],
  ['corecția de administrator ignorată', 'WHEN coalesce(o.administrator, e.admin) THEN', 'WHEN e.admin THEN'],
  ['suspendarea fără cod ignorată', "WHEN o.suspendat IS TRUE THEN 'suspendare'", "WHEN false THEN 'suspendare'"],
  // completitudinea (P1-4)
  ['pontajul lipsă nu blochează', "IF v_fp > 0 THEN v_bl := v_bl || ('pontaj_lipsa:'", "IF false THEN v_bl := v_bl || ('pontaj_lipsa:'"],
  ['data angajării lipsă nu blochează', "IF v_fa > 0 THEN v_bl := v_bl || ('angajati_fara_data_angajarii:'", "IF false THEN v_bl := v_bl || ('angajati_fara_data_angajarii:'"],
  ['norma lipsă nu blochează', "IF v_fn > 0 THEN v_bl := v_bl || ('angajati_fara_norma:'", "IF false THEN v_bl := v_bl || ('angajati_fara_norma:'"],
  ['inactivul fără dată nu blochează', "IF v_inact > 0 THEN v_bl := v_bl || ('inactivi_fara_data_incetarii_cu_pontaj:'", "IF false THEN v_bl := v_bl || ('inactivi_fara_data_incetarii_cu_pontaj:'"],
  ['calendarul incomplet nu blochează', "IF v_cal > 0 THEN v_bl := v_bl || ('calendar_incomplet:'", "IF false THEN v_bl := v_bl || ('calendar_incomplet:'"],
  ['pontajul închis o zi mai devreme', "interval '1 month' + interval '11 days')::date", "interval '1 month' + interval '10 days')::date"],
  ['închiderea fără amprenta văzută', "IF p_amprenta IS NULL OR p_amprenta IS DISTINCT FROM v_c ->> 'amprenta' THEN", 'IF false THEN'],
  ['amprenta fără achiziții', "'amprenta', md5(concat_ws('|', v_amp_ang, v_amp_ach,", "'amprenta', md5(concat_ws('|', v_amp_ang,"],
  ['închiderea de editor', "IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE) THEN\n    RAISE EXCEPTION 'upa: inchiderea", "IF NOT public.fn_upa_poate_scrie() THEN\n    RAISE EXCEPTION 'upa: inchiderea"],
  // achizițiile (P1-7)
  ['plata după termen numărată', "coalesce(sum(a.valoare_fara_tva) FILTER (WHERE a.stare_plata = 'platita' AND a.data_plata <= v_l1), 0),", "coalesce(sum(a.valoare_fara_tva) FILTER (WHERE a.stare_plata = 'platita'), 0),"],
  ['neplătita blochează (ca înainte)', "IF v_nepl > 0 THEN v_av := v_av || ('achizitii_neplatite_excluse:'", "IF v_nepl > 0 THEN v_bl := v_bl || ('achizitii_neplatite_excluse:'"],
  ['neplătita dedusă după lună', '    IF v_nepl > 0 THEN v_av := v_av', '    v_a := v_a + v_astept;\n    IF v_nepl > 0 THEN v_av := v_av'],
  ['plata necunoscută nu blochează', "IF v_fstare > 0 THEN v_bl := v_bl || ('achizitii_fara_stare_plata:'", "IF false THEN v_bl := v_bl || ('achizitii_fara_stare_plata:'"],
  ['fără TVA lipsă nu blochează', "IF v_ftva > 0 THEN v_bl := v_bl || ('achizitii_fara_tva:'", "IF false THEN v_bl := v_bl || ('achizitii_fara_tva:'"],
  ['reportul definitiv ignorat', 'SELECT c.report_iesit INTO v_rin FROM public.upa_calcul_lunar c', 'SELECT 0 INTO v_rin FROM public.upa_calcul_lunar c'],
  ['prima lună fără reportul inițial', "v_rin := public.fn_upa_parametru_la('report_initial', v_l);", 'v_rin := 100;'],
  // termenul (P1-8)
  ['termenul din decembrie pe 25', "  IF extract(month FROM v_t) = 12 THEN\n    v_t := make_date", "  IF false THEN\n    v_t := make_date"],
  ['termenul nelucrător nemutat', '    WHILE NOT public.fn_upa_zi_lucratoare(v_t) LOOP\n      v_t := v_t + 1;', '    WHILE false LOOP\n      v_t := v_t + 1;'],
  // alerta (P1-6)
  ['alerta exactă doar la închiderea cronului', "  IF v_activ THEN\n    FOR r IN SELECT c.luna", "  IF false THEN\n    FOR r IN SELECT c.luna"],
  ['alerta exactă pe cheia veche', "WHEN 'calcul' THEN 'calcul:' || to_char(p_luna, 'YYYY-MM')", "WHEN 'calcul' THEN 'inchidere:' || to_char(p_luna, 'YYYY-MM')"],
  ['pragul zilei ignorat', 'extract(day FROM p_azi)::integer >= v_prag AND', 'true AND'],
  ['calcul_neinchis doar owner-ului', "WHERE (p_fel <> 'eroare' OR p_cod = 'calcul_neinchis')", "WHERE (p_fel <> 'eroare')"],
  // intențiile (P1-5)
  ['amprenta v2 și fără valorile noi', '              THEN public.fn_upa_hash_intentie(p)\n', "              THEN 'v2:' || public.fn_upa_hash_intentie(p)\n"],
  ['intenția fără starea plății', "ARRAY['valoare_fara_tva', 'data_plata', 'stare_plata']::text[]", "ARRAY['valoare_fara_tva', 'data_plata']::text[]"],
  // drepturi / CAS
  ['luna închisă recalculabilă', 'IF EXISTS (SELECT 1 FROM public.upa_calcul_lunar c WHERE c.luna >= p_de_la', 'IF false AND EXISTS (SELECT 1 FROM public.upa_calcul_lunar c WHERE c.luna >= p_de_la'],
  ['CAS-ul parametrilor scos', "  IF v_acum IS DISTINCT FROM p_vechi THEN\n    RAISE EXCEPTION 'upa: parametrul s-a schimbat", "  IF false THEN\n    RAISE EXCEPTION 'upa: parametrul s-a schimbat"],
  ['detaliul pe angajat pentru oricine', "IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE) THEN\n    RAISE EXCEPTION 'upa: detaliul", "IF auth.uid() IS NULL THEN\n    RAISE EXCEPTION 'upa: detaliul"],
  ['corecțiile HR fără owner', "IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE) THEN\n    RAISE EXCEPTION 'upa: corectiile HR sunt doar pentru owner' USING ERRCODE = '42501';\n  END IF;\n  IF p_employee_id", "IF auth.uid() IS NULL THEN\n    RAISE EXCEPTION 'upa: corectiile HR sunt doar pentru owner' USING ERRCODE = '42501';\n  END IF;\n  IF p_employee_id"],
  ['corecțiile HR suprapuse', 'o.employee_id = p_employee_id AND o.de_la <= p_pana_la AND o.pana_la >= p_de_la) THEN', 'false) THEN'],
  ['corecțiile HR pe o lună închisă', "    RAISE EXCEPTION 'upa: o luna inchisa foloseste deja intervalul'", "    NULL; -- RAISE EXCEPTION 'upa: o luna inchisa foloseste deja intervalul'"],
  ['situația fără identitate', "  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'upa: cont neautentificat' USING ERRCODE = '42501'; END IF;\n  RETURN public.fn_upa_situatie_la", '  RETURN public.fn_upa_situatie_la'],
]) {
  let t
  try { t = unic(FARA_AMPRENTA(MIG), din, in_) } catch (e) { ok(false, `MUTANT ${nume}: nu se aplică (${e.message})`); continue }
  let prins = false, cum = ''
  const db = await bazaProd()
  const m = await eroare(aplica(db, t))
  await db.close()
  if (m) { prins = true; cum = 'la aplicare: ' + m.slice(0, 90) }
  else {
    const ab = await toate(t)
    prins = ab.length > 0; cum = `${ab.length} abateri (${(ab[0] || '').slice(0, 100)})`
  }
  ok(prins, `MUTANT ${nume} — prins ${cum}`)
}
}

console.log(esec ? `\nPICAT: ${esec} verificări` : '\nTOATE VERIFICĂRILE AU TRECUT')
process.exit(esec ? 1 : 0)
