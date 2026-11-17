// Proba LOCALĂ a migrării 20261212a (Redări → FAN Courier) pe PGlite (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261212a_redari_fan_awb_schelet.sql + fn_red_nivel() extrasă EXACT din 20261126a.
// 1. Comportamentul, ca rolul authenticated cu JWT-ul fiecărui cont (owner, editor, viewer, cont fără drept, anonim); valorile așteptate
//    sunt scrise de mână (L25): poarta de rol, marcajul de TEST, plafonul lotului pilot, limita de 100 la claim, idempotența (al doilea
//    claim / al doilea AWB refuzat), rezultatul parțial / vechi / străin (CAS), reconcilierea, ridicarea (lot real vs lot de test),
//    urmărirea (ora României → UTC), confirmările, anularea, drepturile directe pe tabele.
// 2. Revenirea: refuz cu date / lot marcat / setări schimbate; aplicare → revenire → re-aplicare.
// 3. MUTANȚI ai migrării: fiecare TREBUIE să pice cel puțin o verificare.
// Ce NU probează PGlite (o singură conexiune): concurența reală (două sesiuni) — pe clonă, de chat.
// Rulare (din rădăcina repo-ului): npm install --prefix .tmp/pglite @electric-sql/pglite && node scripts/pglite/test_redari_fan_awb_local.mjs
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
// PGlite: din PGLITE_DIR, din .tmp/pglite (ignorat de git) sau instalat normal
const LOCAL_PGLITE = join(ROOT, '.tmp', 'pglite', 'node_modules', '@electric-sql', 'pglite')
const { PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(join(resolve(process.env.PGLITE_DIR), 'dist', 'index.js')).href
  : existsSync(LOCAL_PGLITE) ? pathToFileURL(join(LOCAL_PGLITE, 'dist', 'index.js')).href : '@electric-sql/pglite')
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const SCHELET = citeste('supabase/tests/20261212a_redari_fan_awb_schelet.sql')
const MIG = citeste('supabase/migrations/20261212a_redari_fan_awb.sql')
const REV = citeste('supabase/revenire/20261212a_redari_fan_awb_ROLLBACK.sql')
const M26 = citeste('supabase/migrations/20261126a_redari_teren.sql')
const NIVEL = (() => {
  const i = M26.indexOf('CREATE FUNCTION public.fn_red_nivel() RETURNS text')
  const j = M26.indexOf('$fn$;', M26.indexOf('$fn$', i) + 4) + 5
  if (i < 0 || j < 5) throw new Error('nu găsesc fn_red_nivel în 20261126a')
  return M26.slice(i, j) + '\nGRANT EXECUTE ON FUNCTION public.fn_red_nivel() TO authenticated;\n'
})()

const ID = {
  owner: '00000000-0000-4000-8000-000000000001', editor: '00000000-0000-4000-8000-000000000002',
  viewer: '00000000-0000-4000-8000-000000000003', strain: '00000000-0000-4000-8000-000000000004',
  proiect: '10000000-0000-4000-8000-000000000001', lot1: '20000000-0000-4000-8000-000000000001', lot2: '20000000-0000-4000-8000-000000000002',
  lot3: '20000000-0000-4000-8000-000000000003',
}
const plicId = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const H = c => c.repeat(64)

async function bazaNoua(mig = MIG) {
  const db = new PGlite()
  await db.exec(SCHELET)
  await db.exec(NIVEL)
  await db.exec(`
    INSERT INTO public.profiles (id, name, is_owner) VALUES ('${ID.owner}', 'O', true), ('${ID.editor}', 'E', false), ('${ID.viewer}', 'V', false), ('${ID.strain}', 'X', false);
    INSERT INTO public.user_module_access VALUES ('${ID.editor}', 'redari', 'editor'), ('${ID.viewer}', 'redari', 'viewer');
    INSERT INTO public.red_proiecte (id, cod) VALUES ('${ID.proiect}', 'TEST-PROIECT');
    INSERT INTO public.red_loturi_plicuire (id, proiect_id, nr_lot) VALUES ('${ID.lot1}', '${ID.proiect}', 'PP-0001'), ('${ID.lot2}', '${ID.proiect}', 'PP-0002'), ('${ID.lot3}', '${ID.proiect}', 'PP-0003');
    INSERT INTO public.red_plicuri (id, proiect_id, lot_id, nr_plic, stare) VALUES
      ('${plicId(1)}', '${ID.proiect}', '${ID.lot1}', 'PL-TST-0001', 'activ'), ('${plicId(2)}', '${ID.proiect}', '${ID.lot1}', 'PL-TST-0002', 'activ'),
      ('${plicId(3)}', '${ID.proiect}', '${ID.lot1}', 'PL-TST-0003', 'activ'), ('${plicId(4)}', '${ID.proiect}', '${ID.lot2}', 'PL-TST-0004', 'activ'),
      ('${plicId(5)}', '${ID.proiect}', '${ID.lot1}', 'PL-TST-0005', 'anulat'), ('${plicId(6)}', '${ID.proiect}', NULL, 'PL-TST-0006', 'activ');
  `)
  await db.exec(mig)
  return db
}

// apel ca rolul authenticated cu JWT-ul contului (uid null = anonim → rolul anon)
async function ca(db, uid, sql, params = []) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid || ''}', false);`)
  await db.exec(uid ? 'SET ROLE authenticated' : 'SET ROLE anon')
  try { return await db.query(sql, params) } finally { await db.exec('RESET ROLE') }
}
const cod = async p => { try { await p; return 'OK' } catch (e) { return e.code || String(e.message).slice(0, 60) } }
const val = async (db, sql, params = []) => (await db.query(sql, params)).rows[0]

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
  ok(r1.stare === 'propus' && r1.propus_de === ID.editor && r1.urmarire_stare === 'neurmarit' && r1.confirmare_stare === 'nesolicitata', 'rândul nou: propus, autor = auth.uid(), urmărire/confirmare implicite')

  // ── marcaj + aprobare (owner) ──
  const aproba = (uid, lot, ids, hs) => ca(db, uid, 'SELECT public.fn_red_fan_aproba($1, $2, $3) AS n', [lot, ids, hs])
  ok(await cod(aproba(ID.editor, ID.lot1, [r1.id], [H('a')])) === '42501', 'editor: aprobarea refuzată (doar owner)')
  ok(await cod(aproba(ID.owner, ID.lot1, [r1.id], [H('a')])) === 'P0001', 'owner: aprobare pe lot nemarcat (test/real) refuzată')
  ok(await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_lot_marcheaza($1, false)', [ID.lot1])) === '42501', 'editor: marcajul lotului refuzat')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_lot_marcheaza($1, false)', [ID.lot1])) === 'OK', 'owner: lotul 1 marcat REAL')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_lot_marcheaza($1, true)', [ID.lot2])) === 'OK', 'owner: lotul 2 marcat TEST')
  ok(await cod(aproba(ID.owner, ID.lot1, [r1.id], [H('c')])) === 'P0001', 'owner: hash diferit de previzualizare → refuz')
  ok(await cod(aproba(ID.owner, ID.lot1, [r1.id, r1.id], [H('a'), H('a')])) === '22023', 'listă cu duplicate → 22023')
  ok(await cod(aproba(ID.owner, ID.lot2, [r1.id], [H('a')])) === 'P0001', 'rândul altui lot → refuz')
  // lotul pilot: plafon 2 → 3 plicuri refuzate, 2 trec, al 3-lea refuzat, plafon 3 → trece
  ok(await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_setari_seteaza(2)')) === '42501', 'editor: plafonul pilot refuzat')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_setari_seteaza(0)')) === '22023', 'plafon 0 → 22023')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_setari_seteaza(2)')) === 'OK', 'owner: plafon pilot = 2')
  ok(await cod(aproba(ID.owner, ID.lot1, [r1.id, r2.id, r3.id], [H('a'), H('a'), H('a')])) === 'P0001', 'pilot: 3 plicuri peste plafonul 2 → refuz, nimic aprobat')
  ok((await rand(1)).stare === 'propus', 'după refuzul pilot rândul a rămas propus (atomic)')
  ok(await cod(aproba(ID.owner, ID.lot1, [r1.id, r2.id], [H('a'), H('a')])) === 'OK', 'pilot: 2 plicuri aprobate')
  ok(await cod(aproba(ID.owner, ID.lot1, [r3.id], [H('a')])) === 'P0001', 'pilot: al 3-lea plic în același lot → refuz (2 + 1 > 2)')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_setari_seteaza(20)')) === 'OK', 'owner: plafon înapoi la 20')
  ok(await cod(aproba(ID.owner, ID.lot1, [r3.id], [H('a')])) === 'OK', 'al 3-lea plic aprobat după ridicarea plafonului')
  ok(await cod(aproba(ID.owner, ID.lot2, [r4.id], [H('b')])) === 'OK', 'lotul de test: aprobat')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_lot_marcheaza($1, true)', [ID.lot1])) === 'P0001', 'marcajul nu se mai schimbă după aprobare')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_lot_marcheaza($1, false)', [ID.lot1])) === 'OK', 'marcajul identic repetat = no-op')
  ok((await rand(1)).aprobat_de === ID.owner, 'aprobat_de = owner-ul (auth.uid())')

  // ── claim: limita de 100, hash, idempotență ──
  const claim = (uid, lot, ids, hs) => ca(db, uid, 'SELECT public.fn_red_fan_claim_lot($1, $2, $3) AS c', [lot, ids, hs])
  const o101 = Array.from({ length: 101 }, (_, i) => `40000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
  ok(await cod(claim(ID.owner, ID.lot1, o101, o101.map(() => H('a')))) === '22023', 'claim cu 101 rânduri → 22023 (limita FAN de 100 pe solicitare)')
  ok(await cod(claim(ID.editor, ID.lot1, [r1.id], [H('a')])) === '42501', 'editor: claim refuzat')
  ok(await cod(claim(ID.owner, ID.lot1, [r1.id, r2.id], [H('a'), H('d')])) === 'P0001', 'claim: un hash recalculat diferit → refuz total')
  ok((await rand(1)).stare === 'aprobat', 'după refuz, rândurile au rămas aprobate')
  const c1 = (await claim(ID.owner, ID.lot1, [r1.id, r2.id], [H('a'), H('a')])).rows[0].c
  ok(/^[0-9a-f-]{36}$/.test(c1), 'claim OK: o cheie de solicitare')
  ok((await rand(1)).stare === 'in_curs' && (await rand(2)).cerere_id === c1, 'ambele rânduri în curs, aceeași cheie')
  ok(await cod(claim(ID.owner, ID.lot1, [r1.id], [H('a')])) === 'P0001', 'IDEMPOTENȚĂ: al doilea claim pe același plic refuzat (nu mai e aprobat)')
  ok(await cod(propune(ID.editor, 1, H('a'))) === 'P0001', 'plic în curs → nu se re-propune')

  // ── rezultate: CAS pe cheie, parțial, străin ──
  const rez = (uid, c, arr) => ca(db, uid, 'SELECT public.fn_red_fan_rezultate($1, $2::jsonb) AS n', [c, JSON.stringify(arr)])
  ok(await cod(rez(ID.owner, c1, [{ id: r1.id, stare: 'generat', awb: '1000000001' }])) === 'P0001', 'rezultat PARȚIAL (1 din 2) → refuz, nimic scris')
  ok(await cod(rez(ID.owner, '50000000-0000-4000-8000-000000000001', [{ id: r1.id, stare: 'generat', awb: '1000000001' }, { id: r2.id, stare: 'eroare', awb: null }])) === 'P0001', 'cheie străină → refuz')
  ok(await cod(rez(ID.owner, c1, [{ id: r1.id, stare: 'generat', awb: null }, { id: r2.id, stare: 'eroare', awb: null }])) === '22023', 'generat fără AWB → 22023')
  ok(await cod(rez(ID.owner, c1, [{ id: r1.id, stare: 'eroare', awb: '1000000001' }, { id: r2.id, stare: 'eroare', awb: null }])) === '22023', 'eroare cu AWB → 22023')
  ok(await cod(rez(ID.editor, c1, [{ id: r1.id, stare: 'generat', awb: '1000000001' }, { id: r2.id, stare: 'eroare', awb: null }])) === '42501', 'editor: rezultatul refuzat')
  ok(await cod(rez(ID.owner, c1, [{ id: r1.id, stare: 'generat', awb: '1000000001', tarif: 29.7, tva: 5.643 }, { id: r2.id, stare: 'eroare', awb: null, motiv: 'FAN: telefon' }])) === 'OK', 'rezultat MIXT (generat + eroare) scris odată')
  const g1 = await rand(1)
  ok(g1.stare === 'generat' && g1.awb === '1000000001' && Number(g1.tarif) === 29.7 && Number(g1.tva) === 5.643 && g1.generat_la, 'generat: AWB + tarif + TVA exacte')
  ok((await val(db, 'SELECT stare, motiv FROM public.red_fan_awb WHERE id = $1', [r2.id])).stare === 'eroare', 'elementul respins: eroare + motiv')
  ok(await cod(rez(ID.owner, c1, [{ id: r1.id, stare: 'generat', awb: '1000000001' }, { id: r2.id, stare: 'eroare', awb: null }])) === 'P0001', 'rezultat repetat (vechi) → refuz')
  ok(await cod(propune(ID.editor, 1, H('a'))) === 'P0001', 'IDEMPOTENȚĂ: plicul cu AWB generat nu primește o a doua propunere')
  ok(await cod(propune(ID.editor, 2, H('e'))) === 'OK', 'plicul respins (eroare) se re-propune: rând nou')
  const c3 = (await claim(ID.owner, ID.lot1, [r3.id], [H('a')])).rows[0].c
  ok(await cod(rez(ID.owner, c3, [{ id: r3.id, stare: 'necunoscut', awb: null, motiv: 'HTTP 0' }])) === 'OK', 'timeout → necunoscut')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_reconciliaza($1, NULL, NULL, NULL, $2)', [r3.id, ' '])) === '22023', 'reconciliere fără AWB și fără motiv → 22023')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_reconciliaza($1, $2, NULL, NULL, $3)', [r3.id, '1000000003', 'găsit în borderou'])) === 'OK', 'reconciliere: necunoscut → generat')
  ok(await cod(rez(ID.owner, c3, [{ id: r3.id, stare: 'eroare', awb: null }])) === 'P0001', 'rezultatul târziu după reconciliere → refuz (CAS)')
  const cT = (await claim(ID.owner, ID.lot2, [r4.id], [H('b')])).rows[0].c
  ok(await cod(rez(ID.owner, cT, [{ id: r4.id, stare: 'generat', awb: '1000000004', tarif: 1e9 }])) === 'OK', 'lotul de test: generat (tarif absurd → necunoscut, nu rotunjit)')
  ok((await rand(4)).tarif === null, 'tarif în afara plajei → NULL (necunoscut)')

  // ── urmărire + confirmări ──
  const urm = (uid, lot, arr) => ca(db, uid, 'SELECT public.fn_red_fan_urmarire($1, $2::jsonb) AS n', [lot, JSON.stringify(arr)])
  const u1 = { id: r1.id, awb: '1000000001', urmarire_stare: 'retur', ultim_eveniment: 'S6', ultim_eveniment_la: '2026-11-10 15:00:00', ridicat_propus: '2026-11-09', livrat_la: null, retur_propus: 'refuz' }
  ok(await cod(urm(ID.owner, ID.lot1, [{ ...u1, awb: '1000000009' }])) === 'P0001', 'urmărire cu AWB diferit → refuz')
  ok(await cod(urm(ID.owner, ID.lot2, [u1])) === 'P0001', 'urmărire pe rândul altui lot → refuz')
  ok(await cod(urm(ID.owner, ID.lot1, [{ ...u1, retur_propus: 'decedat' }])) === '22023', 'retur propus „decedat” (judecată umană) → 22023')
  ok(await cod(urm(ID.owner, ID.lot1, [{ ...u1, ultim_eveniment_la: '10.11.2026 15:00' }])) === '22023', 'dată de formă necunoscută → 22023')
  ok(await cod(urm(ID.editor, ID.lot1, [u1])) === '42501', 'editor: urmărirea refuzată')
  ok(await cod(urm(ID.owner, ID.lot1, [u1])) === 'OK', 'urmărire scrisă')
  const uu = await val(db, `SELECT urmarire_stare, retur_propus, ridicat_propus::text AS rp, to_char(ultim_eveniment_la AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS utc FROM public.red_fan_awb WHERE id = $1`, [r1.id])
  ok(uu.urmarire_stare === 'retur' && uu.retur_propus === 'refuz' && uu.rp === '2026-11-09', 'retur propus: refuz; ridicarea propusă 09.11')
  ok(uu.utc === '2026-11-10 13:00', 'ora României 15:00 (noiembrie, UTC+2) → 13:00 UTC (L17): ' + uu.utc)
  ok((await val(db, 'SELECT stare FROM public.red_plicuri WHERE id = $1', [plicId(1)])).stare === 'activ' && (await val(db, 'SELECT awb FROM public.red_plicuri WHERE id = $1', [plicId(1)])).awb === null, 'urmărirea NU atinge plicul (propunere)')
  const conf = (uid, lot, arr) => ca(db, uid, 'SELECT public.fn_red_fan_confirmari($1, $2::jsonb) AS n', [lot, JSON.stringify(arr)])
  ok(await cod(conf(ID.owner, ID.lot1, [{ id: r1.id, awb: '1000000001', confirmare_stare: 'confirmat' }])) === '22023', 'confirmare „confirmat” (succes automat) → 22023')
  ok(await cod(conf(ID.owner, ID.lot1, [{ id: r1.id, awb: '1000000001', confirmare_stare: 'forma_necunoscuta' }])) === 'OK', 'confirmare de formă necunoscută: scrisă ca atare')

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

let esec = 0
const ok = (c, m) => { if (c) console.log('  OK  ' + m); else { esec++; console.log('  NU  ' + m) } }

console.log('1. comportamentul migrării (valori scrise de mână)')
{
  const db = await bazaNoua()
  const f = await verificari(db, true)
  esec += f.length
  console.log('2. revenirea')
  ok(await cod(db.exec(REV)) !== 'OK', 'revenirea REFUZĂ cu rânduri FAN')
  await db.exec('ROLLBACK').catch(() => {})
  ok((await val(db, `SELECT to_regclass('public.red_fan_awb') IS NOT NULL AS e`)).e === true, 'după refuz tabelul există încă (tranzacția s-a anulat)')
}
{
  const db = await bazaNoua()
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${ID.owner}', false); SELECT public.fn_red_fan_setari_seteaza(30);`)
  ok(await cod(db.exec(REV)) !== 'OK', 'revenirea refuză cu setări schimbate')
  await db.exec('ROLLBACK').catch(() => {})
  const db2 = await bazaNoua()
  await db2.exec(`SELECT set_config('request.jwt.claim.sub', '${ID.owner}', false); SELECT public.fn_red_fan_lot_marcheaza('${ID.lot3}', true);`)
  ok(await cod(db2.exec(REV)) !== 'OK', 'revenirea refuză cu un lot marcat')
  await db2.exec('ROLLBACK').catch(() => {})
  const db3 = await bazaNoua()
  ok(await cod(db3.exec(REV)) === 'OK', 'revenirea pe aplicarea curată trece')
  ok((await val(db3, `SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'fn_red_fan_%'`)).n === 0 && (await val(db3, `SELECT to_regclass('public.red_fan_setari') IS NULL AS e`)).e, 'nimic rămas după revenire')
  ok(await cod(db3.exec(MIG)) === 'OK', 're-aplicarea după revenire trece')
  ok((await verificari(db3, false)).length === 0, 'comportamentul identic după re-aplicare')
}

console.log('3. mutanți (fiecare trebuie să pice cel puțin o verificare)')
const MUTANTI = [
  ['claim fără limita de 100', "cardinality(p_ids) > 100 OR cardinality(p_ids) <> cardinality(p_hashuri)", "cardinality(p_ids) > 1000 OR cardinality(p_ids) <> cardinality(p_hashuri)"],
  ['claim acceptă și rânduri ne-aprobate (idempotență)', "WHERE a.lot_id = p_lot_id AND a.stare = 'aprobat' AND a.hash_date = t.h", "WHERE a.lot_id = p_lot_id AND a.stare IN ('aprobat', 'in_curs', 'generat') AND a.hash_date = t.h"],
  ['aprobare fără plafonul pilot', 'IF v_deja + v_n > v_limita THEN', 'IF false THEN'],
  ['rezultate acceptă parțial (ambele gărzi)', 'IF v_asteptate = 0 OR v_n <> v_asteptate OR EXISTS', 'IF v_asteptate = 0 OR EXISTS',
    "IF v_n <> v_asteptate THEN RAISE EXCEPTION 'redari fan: rezultat partial (CAS)'", "IF false THEN RAISE EXCEPTION 'redari fan: rezultat partial (CAS)'"],
  ['lotul de test scrie pe plic', '  IF NOT v_test THEN\n    IF v_pl.stare', '  IF true THEN\n    IF v_pl.stare'],
  ['aprobare fără marcaj', "IF NOT EXISTS (SELECT 1 FROM public.red_fan_loturi WHERE lot_id = p_lot_id) THEN\n    RAISE EXCEPTION 'redari fan: alege intai", "IF false THEN\n    RAISE EXCEPTION 'redari fan: alege intai"],
  ['aprobarea deschisă editorului', "IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul aproba'", "IF auth.uid() IS NULL THEN RAISE EXCEPTION 'redari fan: doar owner-ul aproba'"],
  ['urmărire fără verificarea AWB-ului', 'a.lot_id = p_lot_id AND a.awb = u.awb AND', 'a.lot_id = p_lot_id AND'],
  ['propunerea re-propune și un AWB generat', "IF v_rand.stare NOT IN ('propus', 'aprobat') THEN", "IF v_rand.stare NOT IN ('propus', 'aprobat', 'generat', 'in_curs') THEN"],
  ['scriere directă permisă', 'REVOKE ALL ON public.red_fan_setari, public.red_fan_loturi, public.red_fan_awb FROM PUBLIC, anon, authenticated;', ''],
]
for (const [nume, ...perechi] of MUTANTI) {
  let m = MIG, bun = true
  for (let i = 0; i < perechi.length; i += 2) { if (m.split(perechi[i]).length !== 2) bun = false; else m = m.replace(perechi[i], perechi[i + 1]) }
  if (!bun) { ok(false, `mutantul „${nume}” nu se aplică exact o dată`); continue }
  let f
  try { f = await verificari(await bazaNoua(m), false) } catch (e) { f = ['excepție la aplicare / verificare: ' + (e.code || e.message)] }
  ok(f.length > 0, `mutant „${nume}” prins (${f.length} verificări picate${f[0] ? ': ' + f[0] : ''})`)
}

console.log(esec ? `\nREZULTAT: ${esec} verificări picate` : '\nREZULTAT: toate verificările au trecut')
process.exit(esec ? 1 : 0)
