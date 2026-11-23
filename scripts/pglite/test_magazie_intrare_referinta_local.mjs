// Proba LOCALĂ a migrării 20261231a (Magazie → Echipamente: aceeași intrare nu se salvează de două ori) pe PGlite — NU atinge nicio bază
// reală. Baza: schema falsă supabase/tests/20261231a_magazie_intrare_referinta_schelet.sql (roluri Supabase, privilegii implicite, auth.uid(),
// magazie_echipamente cu politicile „moștenite”). Aplicarea: ca runnerul (marcaj + plafon 5000 + pașii L15 v2 generați: manifestul cu ROLLBACK,
// apoi livrarea aprobată + garda finală reală).
// 0. Validatorul runnerului (plafonul migrării 5000 / al revenirii 2000).
// 1. Refuzurile migrării (fără marcaj, fără pasul L15 „înainte”, reaplicare, coloana cu alt tip); nimic schimbat după refuz.
// 2. Livrarea: manifestul generat = lista revizuită a obiectelor; rândurile existente neatinse (NULL, conținut identic); blocul AMPRENTA identic
//    în migrare și revenire, aceeași constantă.
// 3. Comportamentul (ca authenticated, L25): rândurile fără referință nu se compară (NULL-uri multiple); ON CONFLICT (referinta_intentie) DO
//    NOTHING = un rând la orice ordine a celor două cereri (cea întârziată înainte / după retrimitere, ambele în aceeași instrucțiune);
//    INSERT simplu cu aceeași cheie = 23505; referința nu se poate schimba / șterge (23514), restul rândului da; anon fără drept.
//    Concurența reală (două sesiuni + barieră) nu se poate în PGlite (o singură conexiune): o rulează coordonatorul pe clonă
//    (supabase/tests/20261231a_magazie_intrare_referinta_concurenta.sh).
// 4. Logica ecranului (src/magazieIntrareStoc.js, salveazaFactura) pe BD-ul real, printr-un client care traduce apelurile ca PostgREST:
//    scenariul din verdictul r4 (retrimiterea confirmată + cererea inițială întârziată) în ambele ordini → un rând; alt conținut → refuz.
// 5. MUTANȚI ai migrării (fiecare TREBUIE prins): fără UNIQUE (index simplu) → dublura trece; index unic PARȚIAL → salvarea ecranului refuzată
//    (42P10); NULLS NOT DISTINCT → rândurile vechi fără referință se ciocnesc; fără trigger → referința se poate șterge. Cu postcondițiile
//    întregi, fiecare mutant e refuzat la aplicare (nimic schimbat).
// 6. Revenirea: refuzuri (fără marcaj, rânduri cu referință, amprentă schimbată), aplicare → revenire → reaplicare, starea de dinainte.
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_magazie_intrare_referinta_local.mjs
//   (--scrie-obiecte rescrie lista revizuită L15 din manifestul generat)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'magref_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const NUME = '20261231a_magazie_intrare_referinta'
const F_MIG = `supabase/migrations/${NUME}.sql`
const F_REV = `supabase/revenire/${NUME}_ROLLBACK.sql`
const F_OBIECTE = `supabase/tests/${NUME}.l15.obiecte.tsv`
const SCHELET = citeste(`supabase/tests/${NUME}_schelet.sql`)
const MIG = citeste(F_MIG)
const REV = citeste(F_REV)
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const L = await import(pathToFileURL(join(ROOT, 'src/magazieIntrareStoc.js')).href)

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
  ok(vm.ok && /^OK \d+ /.test(vm.out), 'migrarea trece validatorul cu 5000: ' + vm.out)
  const vm2 = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', '2000')
  ok(!vm2.ok && /PLAFON_DIFERIT/.test(vm2.out), 'migrarea cu runnerul la 2000 = refuz')
  const vmf = validator(join(ROOT, F_MIG), '--fara-plafon')
  ok(!vmf.ok && /PLAFON_LIPSA/.test(vmf.out), 'migrarea fără plafon = refuz local')
  const vr = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_REVENIRE))
  ok(vr.ok && /^OK \d+ /.test(vr.out), 'revenirea trece validatorul cu 2000: ' + vr.out)
  const vr2 = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(!vr2.ok && /PLAFON_DIFERIT/.test(vr2.out), 'revenirea cu runnerul la 5000 = refuz')
}

// ── datele (fictive): rânduri VECHI, fără referință (scrise înaintea migrării), inclusiv un articol EIP din catalog ──
const U = { ED: '00000000-0000-0000-0000-0000000b0001', AL: '00000000-0000-0000-0000-0000000b0002' }
const DATE = `
INSERT INTO public.magazie_echipamente (denumire, categorie, este_eip, um, serie, cantitate_total, stare, observatii, activ, articol_id, marime) VALUES
  ('Bormasina', 'scule', false, 'buc', NULL, 3, 'functional', 'Factura 1', true, NULL, NULL),
  ('Casca protectie', 'eip', true, 'buc', NULL, 40, 'functional', NULL, true, 7, NULL),
  ('Flex', 'scule', false, 'buc', 'S-12', 1, 'defect', 'Intrare initiala 1 buc · ref 0a0a0a0a', true, NULL, NULL),
  ('Vechi', 'scule', false, 'buc', NULL, 0, 'casat', NULL, false, NULL, NULL);`
async function bazaNoua() {
  const db = new PGlite()
  await db.exec(SCHELET)
  await db.exec(DATE)
  return db
}
const blocAmprenta = t => { const i = t.indexOf('AMPRENTA_20261231a_INCEPUT'), j = t.indexOf('-- AMPRENTA_20261231a_SFARSIT'); return i < 0 || j < 0 ? null : t.slice(t.indexOf('\n', i) + 1, j) }
const constanteAmprenta = t => [...t.matchAll(/'([0-9a-f]{32})' THEN\n    RAISE NOTICE 'AMPRENTA_20261231a_TEXT/g)].map(x => x[1])
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
const aplicaMig = (db, text = MIG, o) => caRunner(db, NUME, text, o)
const revino = (db, text = REV, o) => caRunner(db, NUME + '_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
// aplicarea ca la livrare (L15 v2): întâi generatorul de manifest (ROLLBACK), comparat cu lista revizuită a obiectelor, apoi livrarea aprobată
async function aplicaLivrare(db, text = MIG) {
  let jg = []
  try { jg = await caRunner(db, NUME, text, { l15: 'livrare', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message) }
  const G = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const fara18 = listaObiecte(manifest).filter(x => !/_not_null\t/.test(x))
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, F_OBIECTE),
    `# 20261231a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n`
    + fara18.join('\n') + '\n')
  const revizuit = existsSync(join(ROOT, F_OBIECTE)) ? listaObiecte(citeste(F_OBIECTE)) : []
  const lipsa = revizuit.filter(x => !fara18.includes(x)), plus = fara18.filter(x => !revizuit.includes(x))
  ok(G && fara18.length > 0 && !lipsa.length && !plus.length, `manifestul generat (${fara18.length} obiecte, fără NOT NULL PG18) = lista revizuită; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  const fManifest = join(TMP, `${NUME}.l15.tsv`)
  writeFileSync(fManifest, manifest)
  const j = await caRunner(db, NUME, text, { l15: 'livrare', aprobat: G, manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)) && j.some(m => new RegExp(`^PLAFON_TIMP ${NUME}: garda trecuta la \\d+ ms de la BEGIN \\(plafon 5000 ms\\)`).test(m))
    && j.some(m => new RegExp(`^LOCK_TINUT ${NUME}: `).test(m) && !/nedeclarat/.test(m)), 'livrarea aprobată: diferența = manifestul; PLAFON_TIMP (5000); LOCK_TINUT declarat')
  return j
}
function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 90))
    if (t.split(din).length !== 2) throw new Error('mutantul găsește textul de mai multe ori: ' + din.slice(0, 90))
    t = t.split(din).join(in_)
  }
  return t
}
const eroare = async p => { try { await p; return null } catch (e) { return e.message } }
const q1 = async (db, sql, p) => (await db.query(sql, p)).rows[0]
// o instrucțiune ca un rol al aplicației (L25: SET LOCAL ROLE + claim-ul sub, ca PostgREST); întoarce rândurile sau codul erorii
async function caRol(db, rol, uid, sql, params) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; SELECT set_config('request.jwt.claim.sub', '${uid || ''}', true);`)
  try { const r = await db.query(sql, params); await db.exec('COMMIT'); return { rows: r.rows, n: r.affectedRows ?? r.rows.length } }
  catch (e) { await db.exec('ROLLBACK'); return { err: e.code || 'X', msg: e.message } }
}
// starea tabelului (catalog) — comparată înainte de migrare și după revenire
const stareTabel = async db => (await q1(db, `SELECT jsonb_build_object(
    'col', (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' ORDER BY a.attnum) FROM pg_attribute a
            WHERE a.attrelid = 'public.magazie_echipamente'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
    'con', (SELECT string_agg(k.conname || ' ' || pg_get_constraintdef(k.oid), ',' ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = 'public.magazie_echipamente'::regclass AND k.contype <> 'n'),
    'idx', (SELECT string_agg(pg_get_indexdef(i.indexrelid), ',' ORDER BY pg_get_indexdef(i.indexrelid)) FROM pg_index i WHERE i.indrelid = 'public.magazie_echipamente'::regclass),
    'trg', (SELECT string_agg(t.tgname, ',' ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid = 'public.magazie_echipamente'::regclass AND NOT t.tgisinternal),
    'pol', (SELECT string_agg(p.polname || ' ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'), ',' ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid = 'public.magazie_echipamente'::regclass),
    'acl', (SELECT c.relacl::text FROM pg_class c WHERE c.oid = 'public.magazie_echipamente'::regclass),
    'fn', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn_magazie_referinta%')) AS s`)).s
// conținutul rândurilor vechi (fără coloana nouă)
const randuriVechi = async db => (await q1(db, `SELECT md5(string_agg(concat_ws('|', id, denumire, categorie, este_eip, um, serie, cantitate_total, stare, observatii, activ, articol_id, marime), chr(10) ORDER BY id)) AS h,
  count(*)::int AS n FROM public.magazie_echipamente WHERE id <= 4`))

// ── un client ca PostgREST peste PGlite (doar apelurile ecranului): rolul authenticated + claim-ul, răspunsuri JSON ca la PostgREST ──
const statusPostgrest = cod => cod === '42501' ? 403 : cod === '23505' || cod === '23503' ? 409 : ['40001', '40P01', '55P03'].includes(cod) ? 409 : 400
function clientPg(db, uid, { laUpsert } = {}) {
  const jurnal = { upsert: [], recitiri: 0, liste: 0 }
  const ruleaza = async (sql, params) => {
    const r = await caRol(db, 'authenticated', uid, sql, params)
    if (r.err) return { data: null, error: { message: r.msg, code: r.err }, status: statusPostgrest(r.err) }
    return { data: r.rows[0]?.j ?? null, error: null, status: 200 }
  }
  return {
    jurnal,
    from(t) {
      if (t !== 'magazie_echipamente' && t !== 'v_magazie_echipamente') throw new Error('tabel neașteptat: ' + t)
      const q = { op: 'select', cols: '*', filtre: [], ordine: null, limita: null }
      const exec = async () => {
        if (q.op === 'upsert') {
          if (t !== 'magazie_echipamente' || q.opt?.onConflict !== 'referinta_intentie' || q.opt?.ignoreDuplicates !== true) throw new Error('upsert neașteptat')
          const coloane = [...new Set(q.valori.flatMap(Object.keys))].map(c => `"${c}"`).join(', ')
          // ca PostgREST: INSERT … SELECT … FROM json_populate_recordset … ON CONFLICT (coloana) DO NOTHING (Prefer: resolution=ignore-duplicates)
          const sql = `INSERT INTO public.magazie_echipamente (${coloane}) SELECT ${coloane} FROM json_populate_recordset(NULL::public.magazie_echipamente, $1::json)
            ON CONFLICT ("referinta_intentie") DO NOTHING`
          const trimite = async () => { const r = await caRol(db, 'authenticated', uid, sql, [JSON.stringify(q.valori)]); return r.err ? { data: null, error: { message: r.msg, code: r.err }, status: statusPostgrest(r.err) } : { data: null, error: null, status: 201 } }
          jurnal.upsert.push(q.valori)
          if (laUpsert) { const r = await laUpsert(jurnal.upsert.length, trimite); if (r) return r }
          return trimite()
        }
        const coloane = q.cols === '*' ? '*' : q.cols.split(',').map(c => `"${c.trim()}"`).join(', ')
        const where = [], params = []
        for (const [op, c, v] of q.filtre) {
          params.push(op === 'in' ? v : v)
          where.push(op === 'in' ? `"${c}" = ANY ($${params.length}::uuid[])` : op === 'gt' ? `"${c}" > $${params.length}` : `"${c}" = $${params.length}`)
        }
        if (q.filtre.some(([op]) => op === 'in')) jurnal.recitiri++; else jurnal.liste++
        const sql = `SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS j FROM (SELECT ${coloane} FROM public.${t}${where.length ? ' WHERE ' + where.join(' AND ') : ''}`
          + `${q.ordine ? ` ORDER BY "${q.ordine}"` : ''}${q.limita != null ? ` LIMIT ${Number(q.limita)}` : ''}) x`
        return ruleaza(sql, params)
      }
      const b = {
        select(c) { if (q.op === 'select') q.cols = c || '*'; return b },
        upsert(v, o) { q.op = 'upsert'; q.valori = [].concat(v); q.opt = o; return b },
        in(c, v) { q.filtre.push(['in', c, v]); return b },
        gt(c, v) { q.filtre.push(['gt', c, v]); return b },
        eq(c, v) { q.filtre.push(['eq', c, v]); return b },
        order(c) { q.ordine = c; return b },
        limit(n) { q.limita = n; return b },
        then(okf, errf) { return exec().then(okf, errf) },
      }
      return b
    },
  }
}
const RETEA = { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }, status: 0, statusText: '' }
const AZI = '2026-11-20'
const FACT = { nr: 'F-77', data: AZI, furnizor: 'Furnizor Test SRL', categorie: 'scule' }
const RAND = (v = {}) => { const cheie = v.cheie || L.cheieIntentie(randomBytes(16)); return { k: 1, denumire: 'Cheie dinamometrica', cantitate: '5', um: 'buc', pret: '', serie: '', ...v, cheie, ref: cheie.slice(0, 8), tinta: 'nou', vazute: [] } }
const salv = (c, rows) => L.salveazaFactura(c, { rows, fact: FACT, uid: U.ED, azi: AZI, echipamente: [], catalogIds: new Set() })
const ecran = (rows, res) => L.randuriDupaSalvare(rows, res, () => ({ k: 'gol', denumire: '' }))
const nrCheie = async (db, k) => Number((await q1(db, 'SELECT count(*)::int AS n FROM public.magazie_echipamente WHERE referinta_intentie = $1::uuid', [k])).n)

// ── verificările de comportament după migrare (aceleași pentru aplicarea corectă și pentru mutanți); întoarce abaterile ──
async function verifica(db) {
  const ab = []
  const tine = (cond, msg) => { if (!cond) ab.push(msg) }
  const ins = (cheie, extra = '') => caRol(db, 'authenticated', U.ED, `INSERT INTO public.magazie_echipamente (denumire, categorie, um, cantitate_total, stare, observatii, referinta_intentie, created_by)
    VALUES ('Proba', 'scule', 'buc', 5, 'functional', 'Intrare initiala 5 buc · ref ${cheie ? cheie.slice(0, 8) : '00000000'}', ${cheie ? `'${cheie}'` : 'NULL'}, auth.uid()) ${extra}`)
  const K1 = '11111111-1111-4111-8111-111111111111', K2 = '22222222-2222-4222-8222-222222222222', K3 = '33333333-3333-4333-8333-333333333333'
  // a) rândurile fără referință nu se compară între ele (vechi + noi)
  const n0 = await ins(null), n1 = await ins(null)
  tine(!n0.err && !n1.err, `rândurile fără referință: două inserări NULL trec (${n0.err || ''} ${n1.err || ''})`)
  // b) cererea întârziată ajunge după retrimitere / înaintea ei: ON CONFLICT DO NOTHING → un rând
  const a1 = await ins(K1, 'ON CONFLICT (referinta_intentie) DO NOTHING'), a2 = await ins(K1, 'ON CONFLICT (referinta_intentie) DO NOTHING')
  tine(!a1.err && !a2.err && a1.n === 1 && a2.n === 0 && await nrCheie(db, K1) === 1,
    `aceeași cheie, două cereri cu ON CONFLICT (referinta_intentie) DO NOTHING → un rând (${a1.err || a1.n} / ${a2.err || a2.n} / ${await nrCheie(db, K1)})`)
  // c) clientul care nu numește ținta (ON CONFLICT DO NOTHING) și cel cu INSERT simplu: tot un rând
  const c1 = await ins(K2, 'ON CONFLICT DO NOTHING'), c2 = await ins(K2, 'ON CONFLICT DO NOTHING'), c3 = await ins(K2)
  tine(!c1.err && !c2.err && c3.err === '23505' && await nrCheie(db, K2) === 1, `fără țintă / INSERT simplu cu aceeași cheie: un rând, 23505 (${c1.err || c1.n} / ${c2.err || c2.n} / ${c3.err || c3.n} / ${await nrCheie(db, K2)})`)
  // d) aceeași cheie de două ori în ACEEAȘI instrucțiune (cele două cereri într-un lot): un rând
  const d1 = await caRol(db, 'authenticated', U.ED, `INSERT INTO public.magazie_echipamente (denumire, categorie, um, cantitate_total, stare, referinta_intentie)
    VALUES ('Lot', 'scule', 'buc', 1, 'functional', '${K3}'), ('Lot', 'scule', 'buc', 1, 'functional', '${K3}') ON CONFLICT (referinta_intentie) DO NOTHING`)
  tine(!d1.err && d1.n === 1 && await nrCheie(db, K3) === 1, `aceeași cheie de două ori în aceeași instrucțiune: un rând (${d1.err || d1.n})`)
  // e) referința nu se schimbă / nu se șterge; restul rândului da; același text = trece
  const id1 = (await q1(db, 'SELECT id FROM public.magazie_echipamente WHERE referinta_intentie = $1::uuid', [K1]))?.id
  const e1 = await caRol(db, 'authenticated', U.ED, 'UPDATE public.magazie_echipamente SET referinta_intentie = NULL WHERE id = $1', [id1])
  const e2 = await caRol(db, 'authenticated', U.ED, `UPDATE public.magazie_echipamente SET referinta_intentie = '${K3}'::uuid WHERE id = $1`, [id1])
  const e3 = await caRol(db, 'authenticated', U.ED, `UPDATE public.magazie_echipamente SET referinta_intentie = '${K1}'::uuid, cantitate_total = 8, observatii = observatii || chr(10) || 'Intrare +3 buc' WHERE id = $1`, [id1])
  const idVechi = (await q1(db, `SELECT id FROM public.magazie_echipamente WHERE denumire = 'Bormasina'`)).id
  const e4 = await caRol(db, 'authenticated', U.ED, `UPDATE public.magazie_echipamente SET referinta_intentie = '${'44444444-4444-4444-8444-444444444444'}'::uuid WHERE id = $1`, [idVechi])
  const e5 = await caRol(db, 'service_role', null, 'UPDATE public.magazie_echipamente SET referinta_intentie = NULL WHERE id = $1', [id1])
  tine(e1.err === '23514' && e2.err === '23514' && e4.err === '23514' && e5.err === '23514' && !e3.err && e3.n === 1,
    `referința nemodificabilă (NULL / altă cheie / pe rând vechi / și ca service_role = 23514; aceeași cheie + alt câmp = trece): ${[e1, e2, e3, e4, e5].map(x => x.err || x.n).join(' / ')}`)
  // f) recitirea pe referință ca authenticated; anon nu citește și nu scrie
  const f1 = await caRol(db, 'authenticated', U.AL, 'SELECT id, referinta_intentie::text AS r FROM public.magazie_echipamente WHERE referinta_intentie = ANY ($1::uuid[])', [[K1, K2]])
  const f2 = await caRol(db, 'anon', null, 'SELECT referinta_intentie FROM public.magazie_echipamente LIMIT 1')
  const f3 = await caRol(db, 'anon', null, `INSERT INTO public.magazie_echipamente (denumire, categorie, um, stare, referinta_intentie) VALUES ('x', 'scule', 'buc', 'functional', gen_random_uuid())`)
  tine(!f1.err && f1.rows.length === 2 && f2.err === '42501' && f3.err === '42501', `recitirea ca alt cont logat (2 rânduri); anon = 42501 (${f1.err || f1.rows.length} / ${f2.err} / ${f3.err})`)
  // g) logica ecranului pe BD-ul real: verdictul r4 — retrimiterea CONFIRMATĂ, apoi cererea inițială întârziată ajunge → un rând
  {
    let inZbor = null
    const c = clientPg(db, U.ED, { laUpsert: (n, trimite) => { if (n === 1) { inZbor = trimite; return RETEA } } })
    const r0 = RAND()
    const r1 = await salv(c, [r0])
    const rows = ecran([r0], r1).map(r => ({ ...r, retrimitereConfirmata: true }))
    const r2 = await salv(c, rows)
    const tarziu = inZbor ? await inZbor() : { error: { message: 'fără cerere în zbor' } }
    tine(r1.necunoscute.length === 1 && !r2.eroare && r2.aplicate[0] === 1 && !tarziu.error && await nrCheie(db, r0.cheie) === 1,
      `ecranul: retrimiterea confirmată + cererea întârziată sosită după → un rând (${r2.eroare || r2.aplicate} / ${tarziu.error?.message || 'ok'} / ${await nrCheie(db, r0.cheie)})`)
  }
  {
    // ordinea inversă: cererea inițială ajunge între recitirea listei și retrimitere → retrimiterea sărită, rândul recunoscut
    let inZbor = null
    const c = clientPg(db, U.ED, { laUpsert: async (n, trimite) => { if (n === 1) { inZbor = trimite; return RETEA } if (n === 2) await inZbor() } })
    const r0 = RAND({ denumire: 'Clește sertizare' })
    const rows = ecran([r0], await salv(c, [r0])).map(r => ({ ...r, retrimitereConfirmata: true }))
    const r2 = await salv(c, rows)
    tine(!r2.eroare && r2.aplicate[0] === 1 && await nrCheie(db, r0.cheie) === 1, `ecranul: cererea inițială sosită înaintea retrimiterii → un rând, recunoscut (${r2.eroare || r2.aplicate} / ${await nrCheie(db, r0.cheie)})`)
  }
  {
    // aceeași cheie, alt conținut în BD (rând scris pe altă cale) → refuz, rândul existent neatins
    const K = L.cheieIntentie(randomBytes(16))
    await caRol(db, 'authenticated', U.AL, `INSERT INTO public.magazie_echipamente (denumire, categorie, um, cantitate_total, stare, observatii, referinta_intentie) VALUES ('Altceva', 'scule', 'buc', 9, 'functional', 'altceva', $1::uuid)`, [K])
    const c = clientPg(db, U.ED)
    const r = await salv(c, [RAND({ cheie: K, denumire: 'Surubelnita' })])
    const ex = await q1(db, 'SELECT denumire, cantitate_total::text AS q FROM public.magazie_echipamente WHERE referinta_intentie = $1::uuid', [K])
    tine(r.eroare === `„Surubelnita”: ${L.MESAJ_REF_ALT}` && !r.aplicate.length && await nrCheie(db, K) === 1 && ex.denumire === 'Altceva' && ex.q === '9',
      `ecranul: aceeași cheie cu alt conținut → refuz „alt conținut”, rândul existent neatins (${r.eroare} / ${JSON.stringify(ex)})`)
  }
  {
    // calea normală: două rânduri noi într-o salvare → două rânduri, cu cheile și autorul lor
    const c = clientPg(db, U.ED)
    const a = RAND({ k: 1, denumire: 'Nivela laser' }), b = RAND({ k: 2, denumire: 'Ruleta 5m', cantitate: '2' })
    const r = await salv(c, [a, b])
    const scrise = (await db.query(`SELECT denumire, cantitate_total::text AS q, created_by::text AS cb FROM public.magazie_echipamente WHERE referinta_intentie = ANY ($1::uuid[]) ORDER BY denumire`, [[a.cheie, b.cheie]])).rows
    tine(!r.eroare && r.aplicate.sort().join() === '1,2' && JSON.stringify(scrise) === JSON.stringify([{ denumire: 'Nivela laser', q: '5', cb: U.ED }, { denumire: 'Ruleta 5m', q: '2', cb: U.ED }]),
      `ecranul: calea normală, două rânduri noi (${r.eroare || r.aplicate} / ${JSON.stringify(scrise)})`)
  }
  return ab
}

console.log('1. refuzurile migrării (nimic schimbat)')
{
  const db = await bazaNoua()
  const s0 = await stareTabel(db), v0 = await randuriVechi(db)
  ok(/garda start invalida/.test(await eroare(aplicaMig(db, MIG, { marcaj: false }))), 'fără marcajul runnerului = refuz')
  ok(/AMPRENTA_GLOBALA_LIPSA/.test(await eroare(aplicaMig(db, MIG, { l15: 'nimic' }))), 'fără pasul L15 „înainte” al runnerului = refuz')
  ok(/PLAFON_TRANZACTIE lipsa/.test(await eroare(aplicaMig(db, MIG, { plafon: 2000 }))), 'plafonul 2000 în loc de 5000 = refuz')
  await db.exec('ALTER TABLE public.magazie_echipamente ADD COLUMN referinta_intentie text')
  ok(/obiectele exista deja/.test(await eroare(aplicaMig(db))), 'coloana există deja (reaplicare / altă formă) = refuz')
  await db.exec('ALTER TABLE public.magazie_echipamente DROP COLUMN referinta_intentie')
  await db.exec('REVOKE INSERT ON public.magazie_echipamente FROM authenticated')
  ok(/authenticated nu are INSERT/.test(await eroare(aplicaMig(db))), 'authenticated fără INSERT pe tabel = refuz')
  await db.exec('GRANT INSERT ON public.magazie_echipamente TO authenticated')
  ok(JSON.stringify(await stareTabel(db)) === JSON.stringify(s0) && JSON.stringify(await randuriVechi(db)) === JSON.stringify(v0), 'după refuzuri: tabelul și rândurile identice cu starea inițială')
  // o coloană scrisă de ecran cu alt tip (bază separată: vederea se scoate ca tipul să se poată schimba)
  const dbt = await bazaNoua()
  await dbt.exec('DROP VIEW public.v_magazie_echipamente; ALTER TABLE public.magazie_echipamente ALTER COLUMN created_by TYPE text')
  ok(/coloana magazie_echipamente.created_by lipseste sau are alt tip/.test(await eroare(aplicaMig(dbt))), 'o coloană scrisă de ecran cu alt tip = refuz')
}

console.log('2. livrarea (L15 v2) și starea după')
const DB = await bazaNoua()
const S_INAINTE = await stareTabel(DB), V_INAINTE = await randuriVechi(DB)
{
  const t1 = blocAmprenta(MIG), t2 = blocAmprenta(REV)
  ok(t1 && t1 === t2, `blocul AMPRENTA identic în migrare și revenire (${t1?.length} / ${t2?.length} caractere)`)
  const k1 = constanteAmprenta(MIG), k2 = constanteAmprenta(REV)
  ok(k1.length === 1 && k2.length === 1 && k1[0] === k2[0], `aceeași constantă în ambele fișiere (${k1} / ${k2})`)
  let j = []
  try { j = await aplicaLivrare(DB) } catch (e) { console.log('     ' + e.message); (e.jurnal || []).filter(m => /AMPRENTA_20261231a_TEXT/.test(m)).forEach(m => console.log('     ' + m)) }
  ok(j.some(m => /randuri existente \(raman fara referinta\) = 4/.test(m)), 'NOTICE: 4 rânduri existente, rămân fără referință')
  const v = await randuriVechi(DB)
  ok(JSON.stringify(v) === JSON.stringify(V_INAINTE), `rândurile vechi identice după migrare (${v.n} rânduri, md5 ${v.h})`)
  ok(Number((await q1(DB, 'SELECT count(*)::int AS n FROM public.magazie_echipamente WHERE referinta_intentie IS NOT NULL')).n) === 0, 'niciun rând nu are referință după migrare')
  ok(/obiectele exista deja/.test(await eroare(aplicaMig(DB))), 'a doua aplicare = refuz')
  // vederea listei: coloanele fixate la creare, deci fără coloana nouă (ecranul citește cheia doar din tabel, la recitire)
  const cv = (await DB.query(`SELECT attname FROM pg_attribute WHERE attrelid = 'public.v_magazie_echipamente'::regclass AND attname = 'referinta_intentie'`)).rows
  ok(cv.length === 0, 'vederea v_magazie_echipamente nu primește coloana (lista ecranului neschimbată)')
}

console.log('3-4. comportamentul după migrare (ca authenticated) + logica ecranului pe BD-ul real')
{
  const ab = await verifica(DB)
  ok(ab.length === 0, 'toate verificările de comportament' + (ab.length ? ':\n       - ' + ab.join('\n       - ') : ''))
}

console.log('5. MUTANȚI ai migrării (comportament: postcondițiile scoase, ca mutantul să ajungă la verificări; apoi refuzul postcondițiilor)')
const POST = MIG.slice(MIG.indexOf('-- ─── 3. Postcondiții'))
const MUTANTI = [
  ['fără UNIQUE (index simplu)', [['ALTER TABLE public.magazie_echipamente ADD CONSTRAINT magazie_echipamente_referinta_intentie_key UNIQUE (referinta_intentie);',
    'CREATE INDEX magazie_echipamente_referinta_intentie_key ON public.magazie_echipamente (referinta_intentie);']]],
  ['index unic PARȚIAL (WHERE referinta_intentie IS NOT NULL)', [['ALTER TABLE public.magazie_echipamente ADD CONSTRAINT magazie_echipamente_referinta_intentie_key UNIQUE (referinta_intentie);',
    'CREATE UNIQUE INDEX magazie_echipamente_referinta_intentie_key ON public.magazie_echipamente (referinta_intentie) WHERE referinta_intentie IS NOT NULL;']]],
  ['NULLS NOT DISTINCT (rândurile fără referință se ciocnesc)', [['ADD CONSTRAINT magazie_echipamente_referinta_intentie_key UNIQUE (referinta_intentie);',
    'ADD CONSTRAINT magazie_echipamente_referinta_intentie_key UNIQUE NULLS NOT DISTINCT (referinta_intentie);']]],
  ['fără triggerul de nemodificare', [['CREATE TRIGGER trg_magazie_referinta_intentie BEFORE UPDATE OF referinta_intentie ON public.magazie_echipamente\n  FOR EACH ROW EXECUTE FUNCTION public.fn_magazie_referinta_intentie_imuabila();', '']]],
  ['triggerul compară doar NULL → valoare', [['IF NEW.referinta_intentie IS DISTINCT FROM OLD.referinta_intentie THEN', 'IF OLD.referinta_intentie IS NULL AND NEW.referinta_intentie IS NOT NULL THEN']]],
]
for (const [nume, lista] of MUTANTI) {
  const text = aplica(MIG, lista)
  // (a) comportamentul: mutantul fără postcondiții, aplicat ca runnerul → verificările TREBUIE să găsească o abatere
  const db = await bazaNoua()
  let ab
  try {
    await aplicaMig(db, text.slice(0, text.indexOf('-- ─── 3. Postcondiții')))
    ab = await verifica(db)
  } catch (e) { ab = ['aplicarea a picat: ' + e.message] }
  ok(ab.length > 0, `mutantul „${nume}” e prins de comportament (${ab.length}): ${ab.join(' | ') || 'NIMIC'}`)
  // (b) cu postcondițiile întregi: refuz la aplicare, nimic schimbat (NULLS NOT DISTINCT pică deja la crearea indexului: rândurile vechi NULL)
  const db2 = await bazaNoua()
  const s0 = await stareTabel(db2)
  const err = await eroare(aplicaMig(db2, text))
  ok(/20261231a post:|could not create unique index/.test(err || '') && JSON.stringify(await stareTabel(db2)) === JSON.stringify(s0), `mutantul „${nume}” e refuzat la aplicare, nimic schimbat (${(err || 'TRECE').slice(0, 110)})`)
}
ok(POST.includes('AMPRENTA_20261231a_INCEPUT'), 'postcondițiile conțin amprenta (mutanții de mai sus o ating)')

console.log('6. revenirea')
{
  ok(/garda invalida/.test(await eroare(revino(DB, REV, { marcaj: false }))), 'revenirea fără marcaj = refuz')
  const nCheie = Number((await q1(DB, 'SELECT count(*)::int AS n FROM public.magazie_echipamente WHERE referinta_intentie IS NOT NULL')).n)
  const e = await eroare(revino(DB))
  ok(new RegExp(`${nCheie} randuri au referinta_intentie`).test(e || '') && nCheie > 0, `rânduri cu referință (${nCheie}) = refuz, nimic schimbat: ${(e || 'TRECE').slice(0, 100)}`)
  ok(Number((await q1(DB, 'SELECT count(*)::int AS n FROM public.magazie_echipamente WHERE referinta_intentie IS NOT NULL')).n) === nCheie, 'după refuz: cheile au rămas')
  // bază curată: aplicare → revenire → reaplicare
  const db = await bazaNoua()
  await aplicaLivrare(db)
  ok(/starea nu e cea din 20261231a \(obiectele migrarii lipsesc\)/.test(await eroare(revino(await bazaNoua()))), 'revenirea pe o bază fără migrare = refuz al gărzii (nu eroare de cast)')
  // amprenta schimbată: un index în plus pe coloană / corpul funcției schimbat → refuz
  await db.exec('CREATE INDEX x_ref ON public.magazie_echipamente (referinta_intentie)')
  ok(/AMPRENTA obiectelor migrarii/.test(await eroare(revino(db)) || ''), 'un index în plus pe coloana nouă = refuz al revenirii')
  await db.exec('DROP INDEX public.x_ref')
  await db.exec(`CREATE OR REPLACE FUNCTION public.fn_magazie_referinta_intentie_imuabila() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$ BEGIN RETURN NEW; END $f$`)
  ok(/AMPRENTA obiectelor migrarii/.test(await eroare(revino(db)) || ''), 'corpul funcției schimbat = refuz al revenirii')
  const fnText = MIG.slice(MIG.indexOf('CREATE FUNCTION public.fn_magazie_referinta_intentie_imuabila()'), MIG.indexOf('REVOKE ALL ON FUNCTION public.fn_magazie_referinta_intentie_imuabila()'))
  await db.exec(fnText.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'))
  await db.exec('GRANT EXECUTE ON FUNCTION public.fn_magazie_referinta_intentie_imuabila() TO anon')
  ok(/AMPRENTA obiectelor migrarii/.test(await eroare(revino(db)) || ''), 'drepturile funcției schimbate = refuz al revenirii')
  await db.exec('REVOKE EXECUTE ON FUNCTION public.fn_magazie_referinta_intentie_imuabila() FROM anon')
  const v = await randuriVechi(db)
  const jr = await revino(db)
  ok(jr !== null && JSON.stringify(await stareTabel(db)) === JSON.stringify(S_INAINTE), 'revenirea: tabelul identic cu starea de dinainte de migrare (coloane, constrângeri, indexuri, triggere, politici, drepturi, funcții)')
  ok(JSON.stringify(await randuriVechi(db)) === JSON.stringify(v), 'revenirea: rândurile neatinse')
  await aplicaLivrare(db)
  const ab = await verifica(db)
  ok(ab.length === 0, 'reaplicarea după revenire: comportamentul complet' + (ab.length ? ': ' + ab.join(' | ') : ''))
}

console.log(esec ? `\nESEC: ${esec} verificari picate` : '\nTOTUL OK')
process.exit(esec ? 1 : 0)
