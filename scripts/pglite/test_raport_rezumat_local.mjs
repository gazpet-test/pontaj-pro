// Proba LOCALĂ a migrării 20261216a (rezumatul raportului zilnic) pe PGlite (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Rulează harness-ul REAL scripts/test_executie_raport_rezumat.sql (cel pe care chat-ul îl rulează pe clonă) printr-un mini-psql
// (\ir, \set, :ERROR / :SQLSTATE / :'LAST_ERROR_MESSAGE', ON_ERROR_STOP), peste schema falsă supabase/tests/20261208a_executie_devize_tinte_schelet.sql
// + 20261027a, 20261201a, 20261208a întregi (cu marcajul de livrare, ca runner-ul).
// r3: BASELINE-ul L15 se calculează pe schema falsă cu scriptul coordonatorului (scripts/raport_rezumat_amprente.sql, secțiunea lui, într-o
//   tranzacție READ ONLY) și se pune în blocul marcat al migrării (ca după review); harness-ul pune el plafonul de livrare în jurul lui \ir.
// Apoi MUTANȚI (migrare / revenire stricate intenționat): fiecare TREBUIE să pice la testul lui, altfel harness-ul nu dovedește nimic (L25).
// Apoi SCENARII de refuz (r3): baseline necompletat / dublat, fără plafon / alt plafon, stare de acces schimbată înainte (politică, corpul
//   dreptului pe șantier, configurația lui, trigger oprit) sau strecurată după schimbare; revenirea pe o stare diferită (configurația unei
//   funcții, drept EXECUTE dat, trigger oprit, alt CHECK) — fiecare și cu verificarea scoasă din revenire, ca dovadă că ea refuză.
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_raport_rezumat_local.mjs
// Limită: PGlite nu are timere (lock_timeout / plafonul nu se declanșează) și nu are concurență reală — acelea rămân pentru clonă
//   (scripts/raport_rezumat_concurenta.sh, măsurarea cu runnerul).
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const citeste = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const SCHELET = 'supabase/tests/20261208a_executie_devize_tinte_schelet.sql'
const DEP = ['20261027a_raport_distributie_gaze', '20261201a_executie_noduri_suduri', '20261208a_executie_devize_tinte']
const MIG = 'supabase/migrations/20261216a_executie_raport_rezumat.sql'
const REV = 'supabase/revenire/20261216a_executie_raport_rezumat_ROLLBACK.sql'
const HARNESS = 'scripts/test_executie_raport_rezumat.sql'
const AMPRENTE = 'scripts/raport_rezumat_amprente.sql'
// r4: blocul BASELINE are valorile de PRODUCȚIE (lipite de coordonator) + etichetele noi DE_COMPLETAT; aici se înlocuiește TOT conținutul
// listei VALUES cu baseline-ul calculat pe schema falsă (aceeași secțiune a scriptului coordonatorului)
const BL_A = '  SELECT v.eticheta, v.amprenta FROM (VALUES\n', BL_B = '\n  ) v(eticheta, amprenta)'
const PLACEHOLDER = (() => {
  const t = citeste(MIG), i0 = t.indexOf('-- >>> BASELINE 20261216a'), i = t.indexOf(BL_A, i0) + BL_A.length
  return t.slice(i, t.indexOf(BL_B, i))
})()

// mini-psql: blocurile SQL dintre meta-comenzi merg întregi la server (db.exec); \ir citește fișierul (cu înlocuirile mutantului)
async function ruleazaPsql(db, text, fisier, inlocuiri, jurnal) {
  const v = { ON_ERROR_STOP: '1', ERROR: 'false', SQLSTATE: '00000', LAST_ERROR_MESSAGE: '' }
  const subst = (sql) => sql.replace(/:'([A-Za-z_][A-Za-z0-9_]*)'/g, (m, n) => (n in v ? `'${String(v[n]).replace(/'/g, "''")}'` : m))
  const exec = async (sql) => {
    if (!sql.trim()) return
    try {
      await db.exec(subst(sql), { onNotice: (n) => jurnal.push(n.message) })
      v.ERROR = 'false'; v.SQLSTATE = '00000'
    } catch (e) {
      v.ERROR = 'true'; v.SQLSTATE = e.code || 'XX000'; v.LAST_ERROR_MESSAGE = e.message
      if (v.ON_ERROR_STOP === '1') { const er = new Error(`${fisier}: ${e.message}`); er.code = e.code; throw er }
    }
  }
  let buf = ''
  for (const linie of text.split('\n')) {
    const m = /^\\(\S+)\s*(.*)$/.exec(linie)
    if (!m) { buf += linie + '\n'; continue }
    await exec(buf); buf = ''
    const [, cmd, rest] = m
    if (cmd === 'set') {
      const [nume, val] = rest.split(/\s+/, 2)
      v[nume] = val === ':ERROR' ? v.ERROR : val === ':SQLSTATE' ? v.SQLSTATE : val
    } else if (cmd === 'ir') {
      const cale = join(dirname(join(ROOT, fisier)), rest.trim())
      const rel = cale.slice(ROOT.length + 1).replace(/\\/g, '/')
      await exec(aplica(readFileSync(cale, 'utf8').replace(/\r/g, ''), inlocuiri[rel]))
    } else throw new Error('meta-comandă necunoscută: \\' + cmd)
  }
  await exec(buf)
}
function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 80))
    t = t.split(din).join(in_)
  }
  return t
}

async function bazaNoua() {
  const db = new PGlite()
  await db.exec(citeste(SCHELET))
  for (const n of DEP) {
    await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '${n}:' || txid_current(), true);\n${citeste('supabase/migrations/' + n + '.sql')}\nCOMMIT;`)
  }
  return db
}
// secțiunea scriptului coordonatorului (de la WITH RECURSIVE la ORDER BY), într-o tranzacție READ ONLY, ca pe producție
const SECTIUNE = (() => {
  const t = citeste(AMPRENTE)
  const i = t.indexOf('WITH RECURSIVE')
  return t.slice(i, t.indexOf('ORDER BY c.eticheta COLLATE "C";', i) + 'ORDER BY c.eticheta COLLATE "C"'.length)
})()
async function baseline(db) {
  await db.exec('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path = public, pg_temp;')
  try { return (await db.query(SECTIUNE)).rows } finally { await db.exec('ROLLBACK') }
}
const cuBaseline = (randuri) => [PLACEHOLDER, randuri.map(r => r.linie_baseline).join('\n')]
// aplicarea ca runnerul cu --plafon-tranzactie-ms 2000: SET de sesiune înainte de BEGIN, marcajele (livrare + plafon) în tranzacție
async function aplicaMig(db, text, { plafon = 2000, marcajPlafon = true } = {}) {
  const pre = plafon ? `SET transaction_timeout = ${plafon};` : 'SET transaction_timeout = 0;'
  const mp = marcajPlafon ? `SELECT set_config('gazpet.plafon_tranzactie', '${plafon}:' || txid_current(), true);` : ''
  const jurnal = []
  try {
    await db.exec(`${pre} BEGIN ISOLATION LEVEL READ COMMITTED; SELECT set_config('gazpet.livrare_migrare', '20261216a_executie_raport_rezumat:' || txid_current(), true); ${mp}\n${text}\nCOMMIT;`,
      { onNotice: (n) => jurnal.push(n.message) })
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } throw e } finally { await db.exec('SET transaction_timeout = 0;') }
  return jurnal
}
// r4: revenirea tot ca runnerul, cu --plafon-tranzactie-ms 2000 (marcajul de livrare poartă numele fișierului de revenire)
async function revino(db, text, { plafon = 2000, marcajPlafon = true } = {}) {
  const pre = plafon ? `SET transaction_timeout = ${plafon};` : 'SET transaction_timeout = 0;'
  const mp = marcajPlafon ? `SELECT set_config('gazpet.plafon_tranzactie', '${plafon}:' || txid_current(), true);` : ''
  const jurnal = []
  try {
    await db.exec(`${pre} BEGIN ISOLATION LEVEL READ COMMITTED; SELECT set_config('gazpet.livrare_migrare', '20261216a_executie_raport_rezumat_ROLLBACK:' || txid_current(), true); ${mp}\n${text}\nCOMMIT;`,
      { onNotice: (n) => jurnal.push(n.message) })
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } throw e } finally { await db.exec('SET transaction_timeout = 0;') }
  return jurnal
}

// baseline-ul calculat o dată (schema falsă e aceeași în fiecare bază nouă)
const BAZA0 = await bazaNoua()
const B0 = await baseline(BAZA0)
await BAZA0.close()
if (B0.length < 8 || !B0.some(r => r.eticheta === 'functie fn_raport_santier_drept(bigint)') || !B0.some(r => r.eticheta === 'tabel rapoarte_zilnice | triggere')) {
  console.error('baseline: lipsesc etichete așteptate: ' + B0.map(r => r.eticheta).join(', ')); process.exit(1)
}
console.log(`baseline L15 (schema falsă): ${B0.length} etichete — ${B0.map(r => r.eticheta + (r.atentie ? ' [' + r.atentie + ']' : '')).join('; ')}`)
const MIG_B = aplica(citeste(MIG), [cuBaseline(B0)])

async function ruleaza(inlocuiri = {}) {
  const db = await bazaNoua()
  const jurnal = []
  const inl = { ...inlocuiri, [MIG]: [cuBaseline(B0), ...(inlocuiri[MIG] || [])] }
  try {
    await ruleazaPsql(db, aplica(citeste(HARNESS), inl[HARNESS]), HARNESS, inl, jurnal)
    return { ok: true, jurnal }
  } catch (e) {
    return { ok: false, eroare: e.message, jurnal }
  } finally { await db.close() }
}

// ── 1. harness-ul pe migrarea reală: toate testele trebuie să treacă ──
const real = await ruleaza()
const oke = real.jurnal.filter((m) => / OK|refuz confirmat|20261216a: (lock-uri|sfarsit)/.test(m))
console.log(oke.map((m) => '  ' + m).join('\n'))
if (!real.ok) { console.error('HARNESS PICAT: ' + real.eroare); process.exit(1) }
for (const t of ['TB', 'T0', 'T1', 'T2', 'T3', 'T4a', 'T4', 'T4b', 'T5', 'T6a', 'T6', 'T6b', 'T7', 'T8', 'T10', 'T11', 'T12', 'T9']) {
  if (!oke.some((m) => m.startsWith(t + ' OK'))) { console.error('lipsește ' + t + ' OK'); process.exit(1) }
}
console.log('harness: OK pe migrarea reală')

// ── 1b. cap-coadă: scriptul de probă (DOAR citire) scoate intrarea, regula JS scrie textul = textul salvat de server pe raport ──
{
  const { rezumatRaport } = await import('../../src/raportRezumat.js')
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  await db.exec(`
    INSERT INTO public.proiect_activitati (proiect_id, nume, um, tip_raportare, ordine) VALUES (1, 'Săpătură', 'mc', 'cantitate', 1), (1, 'Probă', NULL, 'bifa', 2);
    INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine) VALUES (1, 'tronson', 'T1', 'Tronson unu', 1);
    INSERT INTO public.rapoarte_zilnice (site_id, data, personal_snapshot, utilaje_snapshot, meteo, probleme, lucrari_efectuate, poze)
    VALUES (1, DATE '2026-11-10', '{"sudori": 3, "total": 5}', '[{"nume": "Excavator", "stare": "nefunctional", "motiv": "furtun"}]',
            '{"temp": 7.25, "precip_mm": 1.5, "alerte": ["Ceață"]}', 'Noroi', 'Am lucrat pe T1.', ARRAY['a.jpg', 'b.jpg']),
           (2, DATE '2026-11-09', NULL, NULL, NULL, NULL, NULL, '{}');
    INSERT INTO public.raport_lucrari (raport_id, proiect_id, activitate_id, unitate_id, cantitate)
    SELECT z.id, 1, a.id, CASE WHEN a.nume = 'Săpătură' THEN u.id END, CASE WHEN a.nume = 'Săpătură' THEN 12.500 ELSE 1 END
      FROM public.rapoarte_zilnice z, public.proiect_activitati a, public.proiect_unitati u WHERE z.site_id = 1 AND a.proiect_id = 1;
    UPDATE public.rapoarte_zilnice SET rezumat_sursa = 'automat';`)
  const rez = await db.exec(citeste('scripts/raport_rezumat_proba.sql').split('\n').filter((l) => !l.startsWith('\\')).join('\n'))
  const rand = rez.find((r) => r.rows && r.rows.length === 1 && r.fields.length === 1)
  const lista = JSON.parse(Object.values(rand.rows[0])[0])
  const salvate = (await db.query('SELECT id, rezumat_text FROM public.rapoarte_zilnice')).rows
  if (lista.length !== 2) { console.error('proba: aștept 2 rapoarte, am ' + lista.length); process.exit(1) }
  for (const r of lista) {
    const js = rezumatRaport(r.intrare), bd = salvate.find((s) => s.id === r.id)?.rezumat_text
    if (js !== bd) { console.error(`proba: raportul ${r.id} — JS ${JSON.stringify(js)} ≠ BD ${JSON.stringify(bd)}`); process.exit(1) }
  }
  if (!lista[0].intrare.linii.length || !/Lucrări T1 · Tronson unu: Săpătură 12,5 mc/.test(rezumatRaport(lista[0].intrare))) {
    console.error('proba: liniile lipsesc din intrare'); process.exit(1)
  }
  // r3: proba de VIZIBILITATE (doar citire) pe aceeași bază: un cont ne-owner (RLS-ul schemei false = orice cont logat vede tot) => OK
  const st = []
  await db.exec(citeste('scripts/raport_rezumat_vizibilitate.sql').split('\n').filter((l) => !l.startsWith('\\')).join('\n')
    .replace(":'zile'", "'3660'"), { onNotice: (n) => st.push(n.message) })
  if (!st.some((m) => /^VIZIBILITATE OK: \d+ conturi ne-owner \(\d+ cu rapoarte vizibile\), [1-9]\d* perechi/.test(m))) {
    console.error('vizibilitate (schema falsă): ' + st.join(' | ')); process.exit(1)
  }
  console.log('  ' + st.find((m) => m.startsWith('VIZIBILITATE OK')))
  // … și cu o politică RESTRICTIVĂ care ascunde liniile raportului de conturile ne-owner: proba trebuie să găsească diferența (L25)
  await db.exec(`CREATE POLICY zz_ascunde_linii ON public.raport_lucrari AS RESTRICTIVE FOR SELECT TO authenticated
                   USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner));`)
  let prins = null
  try {
    await db.exec(citeste('scripts/raport_rezumat_vizibilitate.sql').split('\n').filter((l) => !l.startsWith('\\')).join('\n').replace(":'zile'", "'3660'"))
  } catch (e) { prins = e.message; try { await db.exec('ROLLBACK') } catch { /* anulată */ } }
  if (!prins || !/VIZIBILITATE DIFERENTE: .*"linii": [1-9]/.test(prins)) { console.error('vizibilitate: diferența NU a fost găsită: ' + prins); process.exit(1) }
  console.log('  vizibilitate cu liniile ascunse: ' + prins.slice(0, 160))
  await db.close()
  console.log('proba cap-coadă: OK (scriptul de probă + JS = textul salvat de server, 2 rapoarte; proba de vizibilitate OK și prinde liniile ascunse)')
}

// ── 2. mutanții: fiecare trebuie să pice exact la testul lui ──
const M = MIG, R = REV
const DREPT4 = '    IF v_uid IS NULL OR public.fn_raport_santier_drept(NEW.site_id::bigint) IS NOT TRUE THEN'
const DREPT6 = '      IF v_uid IS NULL OR public.fn_raport_santier_drept(NEW.site_id::bigint) IS NOT TRUE THEN'
const mutanti = [
  ['M1 fără refacerea după jurnal (liniile finale)', 'T2', { [M]: [["  UPDATE public.rapoarte_zilnice SET rezumat_sursa = rezumat_sursa WHERE id = NEW.raport_id AND rezumat_sursa IS DISTINCT FROM 'editat';\n", '']] }],
  ['M2 versiunea crește la rezumatul automat', 'T2', { [M]: [['    NEW.versiune_salvare := OLD.versiune_salvare;\n', '']] }],
  ['M3 textul corectat suprascris la salvare', 'T5', { [M]: [["    IF OLD.rezumat_sursa = 'editat' THEN RETURN NEW; END IF;\n", '']] }],
  ['M4 corectura fără dreptul pe șantier', 'T4a', { [M]: [[DREPT4, '    IF v_uid IS NULL THEN']] }],
  ['M5 autorul corecturii luat de la client', 'T4', { [M]: [['    NEW.rezumat_de := v_uid;\n', '']] }],
  ['M6 eticheta „șoferi” diferită de JS', 'T1', { [M]: [["(4, 'soferi', 'șoferi')", "(4, 'soferi', 'soferi')"]] }],
  // aceeași etichetă din amprenta de la finalul migrării: o prinde chiar postcondiția (migrarea nu se aplică)
  ['M6b eticheta „lăcătuși” diferită de JS', 'post', { [M]: [["(2, 'lacatusi', 'lăcătuși')", "(2, 'lacatusi', 'lacatusi')"]] }],
  ['M7 tăierea pe cuvinte decalată cu unu', 'T1', { [M]: [['  c := left(t, n + 1);', '  c := left(t, n);']] }],
  ['M8 cifrele rotunjite', 'post', { [M]: [["replace(trim_scale((j #>> '{}')::numeric)::text, '.', ',')", "replace(round((j #>> '{}')::numeric, 1)::text, '.', ',')"]] }],
  ['M8b zerourile de la final păstrate (1.50 ≠ 1,5)', 'T1', { [M]: [["replace(trim_scale((j #>> '{}')::numeric)::text, '.', ',')", "replace((j #>> '{}')::numeric::text, '.', ',')"]] }],
  ['M10 „revino la automat” fără drept', 'T6a', { [M]: [[DREPT6, '      IF v_uid IS NULL THEN']] }],
  ['M11 textul „automat” trimis de client păstrat', 'T2', { [M]: [['    NEW.rezumat_text := v_text;\n', "    NEW.rezumat_text := coalesce(NEW.rezumat_text, v_text);\n"]] }],
  ['M12 revenirea nu refuză corecturile', 'T9b', { [R]: [["  IF EXISTS (SELECT 1 FROM public.rapoarte_zilnice WHERE rezumat_sursa = 'editat') THEN", '  IF false THEN']] }],
  ['M13 EXECUTE lăsat clienților', 'post', { [M]: [['REVOKE ALL ON FUNCTION public.fn_raport_rezumat_text(jsonb) FROM PUBLIC, anon, authenticated, service_role;', 'REVOKE ALL ON FUNCTION public.fn_raport_rezumat_text(jsonb) FROM anon, service_role;']] }],
  // T8 singur (fără postcondiție): EXECUTE dat după migrare, ca o greșeală ulterioară
  ['M13b EXECUTE dat clienților după migrare', 'T8', { [HARNESS]: [["-- ── T8: funcțiile nu sunt apelabile din API", "GRANT EXECUTE ON FUNCTION public.fn_raport_rezumat_intrare(public.rapoarte_zilnice) TO authenticated;\n-- ── T8: funcțiile nu sunt apelabile din API"]] }],
  ['M14 versiunea nu crește la corectura omului', 'T4', { [M]: [["    NEW.rezumat_de := v_uid;\n    NEW.rezumat_eroare := NULL;\n", "    NEW.rezumat_de := v_uid;\n    NEW.rezumat_eroare := NULL;\n    NEW.versiune_salvare := OLD.versiune_salvare;\n"]] }],
  ['M15 scrierea fără rezumat nu reface rezumatul automat', 'T2', { [M]: [["    IF OLD.rezumat_sursa = 'editat' THEN RETURN NEW; END IF;\n    NEW.rezumat_sursa := 'automat';", "    RETURN NEW;"]] }],
  // r2: rubricile noi citite din raport; lista nefuncționalelor scurtată la 3
  ['M16 planul pentru mâine lipsă din intrare', 'T2', { [M]: [["      'plan_maine', z.plan_maine,\n      'poze', cardinality(z.poze))\n    -- INTRARE-END\n$f$;", "      'poze', cardinality(z.poze))\n    -- INTRARE-END\n$f$;"]] }],
  ['M17 toate utilajele nefuncționale listate', 'T1', { [M]: [["array_to_string(nef[1:3], '; ')", "array_to_string(nef, '; ')"]] }],
  // r3
  ['M18 eroarea derivatului anulează salvarea raportului (fără sub-tranzacție)', 'T10', { [M]: [[
    "  EXCEPTION WHEN OTHERS THEN\n    IF v_cerere THEN RAISE; END IF;   -- cererea explicită de rezumat: omul vede eroarea (nu are altceva de salvat)\n    GET STACKED DIAGNOSTICS v_stare = RETURNED_SQLSTATE;\n    v_text := NULL;\n", '']] }],
  ['M19 cererea explicită de rezumat cu compunerea stricată înghițită', 'T10', { [M]: [["    IF v_cerere THEN RAISE; END IF;   -- cererea explicită de rezumat: omul vede eroarea (nu are altceva de salvat)\n", '']] }],
  ['M20 „Revino la automat” nu mărește versiunea', 'T6', { [M]: [["  IF TG_OP = 'UPDATE' AND NOT v_om AND", "  IF TG_OP = 'UPDATE' AND"]] }],
  ['M21 corectura fără identitate acceptată (r2: doar „dacă există UID”)', 'T4b', { [M]: [[DREPT4, '    IF v_uid IS NOT NULL AND public.fn_raport_santier_drept(NEW.site_id::bigint) IS NOT TRUE THEN']] }],
  ['M22 „Revino la automat” fără identitate acceptat', 'T4b', { [M]: [[DREPT6, '      IF v_uid IS NOT NULL AND public.fn_raport_santier_drept(NEW.site_id::bigint) IS NOT TRUE THEN']] }],
  ['M23 corectura fără curățarea caracterelor de control', 'T4', { [M]: [['    NEW.rezumat_text := public.fn_raport_rezumat_curata_editat(NEW.rezumat_text);\n', '']] }],
  ['M24 codul erorii lăsat clientului', 'T5', { [M]: [["  NEW.rezumat_eroare := CASE WHEN TG_OP = 'UPDATE' THEN OLD.rezumat_eroare END;\n", '']] }],
  ['M25 activitatea altui proiect în rezumat', 'T11', { [M]: [['                   AND (pa.id IS NULL OR pa.proiect_id = sp.proiect_id)\n', '']] }],
  ['M26 obiectul altui proiect în rezumat', 'T11', { [M]: [['                   AND (pu.id IS NULL OR pu.proiect_id = sp.proiect_id)),\n', '),\n']] }],
  ['M27 linia altui proiect în rezumat', 'T11', { [M]: [['                   AND (rl.proiect_id IS NULL OR rl.proiect_id = sp.proiect_id)\n', '']] }],
  ['M28 fără plafonul total al textului automat', 'T1', { [M]: [['  IF length(t) > c_max THEN', '  IF false THEN']] }],
  // orice cerere „automat” tratată ca decizie a omului: o prinde întâi T7 (textul „automat” trimis de client nu mărește versiunea)
  ['M29 orice cerere „automat” mărește versiunea', 'T7', { [M]: [["    v_cerere := true;\n    IF OLD.rezumat_sursa = 'editat' THEN", "    v_cerere := true;\n    v_om := true;\n    IF OLD.rezumat_sursa = 'editat' THEN"]] }],
  // r4: mutarea șantierului în alt proiect
  ['M30 mutarea nu scoate rezumatele automate ale proiectului vechi', 'T12', { [M]: [[
    "  UPDATE public.rapoarte_zilnice r SET rezumat_sursa = r.rezumat_sursa\n   WHERE r.site_id = NEW.id AND r.rezumat_sursa = 'automat' AND r.rezumat_proiect_id IS DISTINCT FROM NEW.proiect_id;\n", '']] }],
  ['M31 mutarea nu refuză corecturile pentru proiectul vechi', 'T12', { [M]: [[
    "              WHERE r.site_id = NEW.id AND r.rezumat_sursa = 'editat' AND r.rezumat_proiect_id IS DISTINCT FROM NEW.proiect_id) THEN",
    "              WHERE false) THEN"]] }],
  ['M32 garda nu deosebește rezumatul pentru alt proiect (îl recompune)', 'T12', { [M]: [[
    "    IF OLD.rezumat_sursa IN ('automat', 'editat') AND OLD.rezumat_proiect_id IS DISTINCT FROM v_proiect THEN", '    IF false THEN']] }],
  ['M33 proiectul rezumatului nepus la compunere', 'T2', { [M]: [['    NEW.rezumat_proiect_id := v_proiect;   -- r4: proiectul pentru care s-a compus textul\n', '']] }],
  ['M34 corectura fără proiectul ei (rămâne cel vechi)', 'T12', { [M]: [['    NEW.rezumat_proiect_id := v_proiect;   -- r4: corectura e scrisă pentru proiectul de acum al șantierului\n', '']] }],
  ['M35 raportul mutat cu corectura pentru alt proiect acceptat', 'T12', { [M]: [[
    "      IF OLD.rezumat_sursa = 'editat' THEN\n        RAISE EXCEPTION 'rezumat: raportul are rezumatul corectat de om pentru alt proiect",
    "      IF false THEN\n        RAISE EXCEPTION 'rezumat: raportul are rezumatul corectat de om pentru alt proiect"]] }],
  ['M36 mutarea mărește versiunile rapoartelor', 'T12', { [M]: [[
    '      IF (to_jsonb(NEW) - v_cols) = (to_jsonb(OLD) - v_cols) THEN NEW.versiune_salvare := OLD.versiune_salvare; END IF;\n', '']] }],
  ['M37 clientul poate cere de_recompus', 'T12', { [M]: [[
    "  ELSIF NEW.rezumat_sursa = 'automat' THEN\n    -- cerere de (re)generare;",
    "  ELSIF NEW.rezumat_sursa = 'de_recompus' THEN\n    NEW.rezumat_text := NULL; NEW.rezumat_la := now(); NEW.rezumat_de := NULL; NEW.rezumat_proiect_id := NULL; RETURN NEW;\n  ELSIF NEW.rezumat_sursa = 'automat' THEN\n    -- cerere de (re)generare;"]] }],
]
let rau = 0
for (const [nume, test, inl] of mutanti) {
  const r = await ruleaza(inl)
  // „post” = o postcondiție a migrării (migrarea nu se aplică deloc); altfel testul din mesajul „Tn FAIL”
  const picatLa = r.ok ? null : /20261216a post/.test(r.eroare) ? 'post' : (/(T[0-9]+[a-z]?|TB) FAIL/.exec(r.eroare) || [])[1] || 'altundeva'
  const bine = !r.ok && picatLa === test
  if (!bine) rau++
  console.log(`${bine ? 'prins ' : 'SCĂPAT'} ${nume}: ${r.ok ? 'harness-ul a trecut' : 'pică la ' + picatLa}${bine ? '' : ' (așteptat ' + test + ')' + (r.ok ? '' : ' — ' + r.eroare.slice(0, 260))}`)
}

// ── 3. scenarii de refuz (r3): fiecare pe o bază nouă; refuzul TREBUIE să vină cu motivul lui ──
async function scenariu(nume, motiv, fn) {
  const db = await bazaNoua()
  let eroare = null
  try { await fn(db) } catch (e) { eroare = e.message }
  finally { await db.close() }
  const bine = motiv === null ? eroare === null : (eroare !== null && motiv.test(eroare))
  if (!bine) rau++
  console.log(`${bine ? 'OK    ' : 'GREȘIT'} ${nume}: ${eroare === null ? 'trecut' : 'refuz: ' + eroare.slice(0, 200)}`)
}
const migCu = (lista) => aplica(MIG_B, lista)
await scenariu('S1 baseline necompletat = refuz', /20261216a: baseline L15 necompletat/, async (db) => { await aplicaMig(db, citeste(MIG)) })
await scenariu('S2 baseline cu o etichetă dublă = refuz', /20261216a: baseline L15 cu etichete duble/, async (db) => {
  await aplicaMig(db, aplica(citeste(MIG), [[PLACEHOLDER, B0.map(r => r.linie_baseline).join('\n') + '\n  , ' + B0[0].linie_baseline.trim()]]))
})
await scenariu('S3 fără plafon (fără marcajul runnerului) = refuz', /PLAFON_TRANZACTIE lipsa/, async (db) => { await aplicaMig(db, MIG_B, { marcajPlafon: false }) })
await scenariu('S4 alt plafon (3000) = refuz', /PLAFON_TRANZACTIE lipsa: 3000\/session/, async (db) => { await aplicaMig(db, MIG_B, { plafon: 3000 }) })
await scenariu('S5 aplicare corectă (baseline + plafon), NOTICE-urile de timp', null, async (db) => {
  const j = await aplicaMig(db, MIG_B)
  if (!j.some(m => /^20261216a: lock-uri la \d+ ms/.test(m)) || !j.some(m => /^20261216a: sfarsit la \d+ ms/.test(m))) throw new Error('lipsesc NOTICE-urile de timp: ' + j.join(' | '))
  const tmp = (await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'amp\\_%'`)).rows[0].n
  if (tmp !== 0) throw new Error('funcțiile pg_temp ale amprentei au rămas: ' + tmp)
})
for (const [nume, strica, motiv] of [
  ['S6 o politică în plus pe rapoarte_zilnice', `CREATE POLICY zz_toti ON public.rapoarte_zilnice FOR SELECT TO anon USING (true);`, /\(inainte\) difera.*tabel rapoarte_zilnice \| politici/],
  ['S7 corpul dreptului pe șantier schimbat', `CREATE OR REPLACE FUNCTION public.fn_raport_santier_drept(p_site bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$;`, /\(inainte\) difera.*functie fn_raport_santier_drept\(bigint\)/],
  ['S8 configurația dreptului pe șantier schimbată', `ALTER FUNCTION public.fn_raport_santier_drept(bigint) SET search_path = public;`, /\(inainte\) difera.*functie fn_raport_santier_drept\(bigint\)/],
  ['S9 triggerul de versiune oprit', `ALTER TABLE public.rapoarte_zilnice DISABLE TRIGGER trg_raport_zilnic_versiune;`, /20261208a nu e aplicata|tabel rapoarte_zilnice \| triggere/],
  ['S10 un trigger în plus pe jurnal', `CREATE FUNCTION public.zz_t() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$;
     CREATE TRIGGER zz_t AFTER INSERT ON public.raport_zilnic_salvari FOR EACH ROW EXECUTE FUNCTION public.zz_t();`, /\(inainte\) difera.*tabel raport_zilnic_salvari \| triggere/],
  ['S11 drept pe o coloană pentru anon', `REVOKE ALL ON public.rapoarte_zilnice FROM anon; GRANT SELECT (probleme) ON public.rapoarte_zilnice TO anon;`, /\(inainte\) difera.*tabel rapoarte_zilnice \| acl/],
]) await scenariu(`${nume} = refuz înainte`, motiv, async (db) => { await db.exec(strica); await aplicaMig(db, MIG_B) })
await scenariu('S12 o politică strecurată DUPĂ schimbare = refuz la „după”', /\(dupa\) difera.*tabel rapoarte_zilnice \| politici/, async (db) => {
  await aplicaMig(db, migCu([['-- L15 (r3): aceeași amprentă DUPĂ', 'CREATE POLICY zz_toti ON public.rapoarte_zilnice FOR SELECT TO anon USING (true);\n-- L15 (r3): aceeași amprentă DUPĂ']]))
})
await scenariu('S13 un al doilea trigger nou pe rapoarte_zilnice = refuz la „după”', /\(dupa\) difera.*tabel rapoarte_zilnice \| triggere/, async (db) => {
  await aplicaMig(db, migCu([['-- ── postcondiții ──', 'CREATE TRIGGER trg_raport_zilnic_zz_rezumat_2 AFTER UPDATE ON public.rapoarte_zilnice FOR EACH ROW EXECUTE FUNCTION public.fn_raport_rezumat_dupa_salvare();\n-- ── postcondiții ──']]))
})
await scenariu('S14 aplicare → revenire → reaplicare (același baseline)', null, async (db) => {
  await aplicaMig(db, MIG_B); await revino(db, citeste(REV)); await aplicaMig(db, MIG_B)
})
// revenirea: stare diferită = refuz; cu verificarea respectivă scoasă din revenire, aceeași stare trece (dovada că ea refuză)
for (const [nume, strica, scoate] of [
  ['configurația unei funcții (proconfig)', 'ALTER FUNCTION public.fn_raport_rezumat_text(jsonb) SET search_path = public;',
    ["           AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']\n", '']],
  ['EXECUTE dat clienților (ACL)', 'GRANT EXECUTE ON FUNCTION public.fn_raport_rezumat_taie(text, integer) TO authenticated;',
    ["           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')\n", '']],
  ['trigger oprit (tgenabled)', 'ALTER TABLE public.rapoarte_zilnice DISABLE TRIGGER trg_raport_zilnic_zz_rezumat;',
    ["                     AND tg.tgenabled = 'O')\n     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.raport_zilnic_salvari'::regclass",
     ")\n     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.raport_zilnic_salvari'::regclass"]],
  // r4: trigger-ul de mutare refăcut fără condiția pe proiect_id
  ['trigger-ul de pe sites fără condiție (WHEN)', `DROP TRIGGER trg_raport_rezumat_santier_mutat ON public.sites;
     CREATE TRIGGER trg_raport_rezumat_santier_mutat AFTER UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.fn_raport_rezumat_santier_mutat();`,
    ["                     AND pg_get_triggerdef(tg.oid) = 'CREATE TRIGGER trg_raport_rezumat_santier_mutat AFTER UPDATE ON public.sites FOR EACH ROW '\n                         || 'WHEN ((old.proiect_id IS DISTINCT FROM new.proiect_id)) EXECUTE FUNCTION fn_raport_rezumat_santier_mutat()')", ')']],
  ['alt CHECK (definiția)', `ALTER TABLE public.rapoarte_zilnice DROP CONSTRAINT rapoarte_zilnice_rezumat_ck,
     ADD CONSTRAINT rapoarte_zilnice_rezumat_ck CHECK (rezumat_sursa IS NULL OR rezumat_sursa IN ('automat', 'editat')) NOT VALID;`,
    ["     OR (SELECT regexp_replace(pg_get_constraintdef(c.oid), ' NOT VALID$', '') FROM pg_constraint c",
     "     OR false AND (SELECT regexp_replace(pg_get_constraintdef(c.oid), ' NOT VALID$', '') FROM pg_constraint c"]],
]) {
  await scenariu(`S15 revenire refuză: ${nume}`, /20261216a revenire: starea nu e cea din 20261216a/, async (db) => {
    await aplicaMig(db, MIG_B); await db.exec(strica); await revino(db, citeste(REV))
  })
  await scenariu(`S16 … cu verificarea scoasă din revenire, aceeași stare trece (${nume})`, null, async (db) => {
    await aplicaMig(db, MIG_B); await db.exec(strica)
    await revino(db, aplica(citeste(REV), [scoate]))
  })
}
// ── r4 ──
await scenariu('S1b doar etichetele noi (sites) necompletate = refuz', /20261216a: baseline L15 necompletat/, async (db) => {
  await aplicaMig(db, aplica(citeste(MIG), [[PLACEHOLDER, B0.map(r => r.eticheta.startsWith('tabel sites')
    ? r.linie_baseline.replace(/'[0-9a-f]{32}'\)$/, "'DE_COMPLETAT')") : r.linie_baseline).join('\n')]]))
})
await scenariu('S6b un trigger în plus pe sites = refuz înainte', /\(inainte\) difera.*tabel sites \| triggere/, async (db) => {
  await db.exec(`CREATE FUNCTION public.zz_s() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$;
                 CREATE TRIGGER zz_s AFTER UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.zz_s();`)
  await aplicaMig(db, MIG_B)
})
// (un al doilea trigger cu funcția NOASTRĂ îl prinde deja postcondiția; aici unul cu altă funcție, pe care doar amprenta „după” îl vede)
await scenariu('S13b un trigger străin strecurat pe sites = refuz la „după”', /\(dupa\) difera.*tabel sites \| triggere/, async (db) => {
  await aplicaMig(db, migCu([['-- ── postcondiții ──', 'CREATE FUNCTION public.zz_s2() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $z$ BEGIN RETURN NULL; END $z$;\n' +
    'CREATE TRIGGER zz_s2 AFTER UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.zz_s2();\n-- ── postcondiții ──']]))
})
await scenariu('S13c un al doilea trigger cu funcția de mutare = refuz (postcondiția)', /20261216a post: trigger-ele/, async (db) => {
  await aplicaMig(db, migCu([['-- ── postcondiții ──', 'CREATE TRIGGER trg_raport_rezumat_santier_mutat_2 AFTER UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.fn_raport_rezumat_santier_mutat();\n-- ── postcondiții ──']]))
})
// mutarea șantierului în REPEATABLE READ = refuz 0A000 (invalidarea n-ar vedea rândurile comise după începutul tranzacției); cu verificarea
// scoasă, aceeași mutare trece (dovada că ea refuză); lock_timeout-ul apelantului (100 ms) e păstrat după mutare
const RAPORT_SITE1 = `INSERT INTO public.rapoarte_zilnice (site_id, data, probleme) VALUES (1, DATE '2026-11-10', 'Proba mutare');`
await scenariu('S17 mutarea șantierului în REPEATABLE READ = refuz', /cere READ COMMITTED/, async (db) => {
  await aplicaMig(db, MIG_B); await db.exec(RAPORT_SITE1)
  try { await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ; UPDATE public.sites SET proiect_id = 2 WHERE id = 1; COMMIT;') }
  catch (e) { await db.exec('ROLLBACK'); throw e }
})
await scenariu('S17b … cu verificarea scoasă, mutarea în REPEATABLE READ trece', null, async (db) => {
  await aplicaMig(db, migCu([["  IF current_setting('transaction_isolation') <> 'read committed' THEN\n    RAISE EXCEPTION 'rezumat: mutarea",
                              "  IF false THEN\n    RAISE EXCEPTION 'rezumat: mutarea"]]))
  await db.exec(RAPORT_SITE1)
  await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ; UPDATE public.sites SET proiect_id = 2 WHERE id = 1; COMMIT;')
})
await scenariu('S20 mutarea păstrează lock_timeout-ul apelantului; rezumatul trece în de_recompus', null, async (db) => {
  await aplicaMig(db, MIG_B); await db.exec(RAPORT_SITE1)
  let rand
  try {
    await db.exec(`BEGIN; SET LOCAL lock_timeout = '100ms'; UPDATE public.sites SET proiect_id = 2 WHERE id = 1;`)
    rand = (await db.query(`SELECT current_setting('lock_timeout') AS lt,
      (SELECT string_agg(DISTINCT coalesce(rezumat_sursa, '-'), ',') FROM public.rapoarte_zilnice WHERE site_id = 1) AS s`)).rows[0]
    await db.exec('COMMIT')
  } catch (e) { await db.exec('ROLLBACK'); throw e }
  if (rand.lt !== '100ms' || rand.s !== 'de_recompus') throw new Error(`lock_timeout ${rand.lt} / surse ${rand.s}`)
})
await scenariu('S18 revenirea fără plafon (fără marcajul runnerului) = refuz', /revenire: PLAFON_TRANZACTIE lipsa/, async (db) => {
  await aplicaMig(db, MIG_B); await revino(db, citeste(REV), { marcajPlafon: false })
})
await scenariu('S18b revenirea armată ca înainte de r4 (fără marcajul de livrare) = refuz', /revenire: garda invalida/, async (db) => {
  await aplicaMig(db, MIG_B)
  try {
    await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED; SELECT set_config('gazpet.revenire_20261216a', 'SCOATE_REZUMAT_RAPORT:' || txid_current(), true);\n${citeste(REV)}\nCOMMIT;`)
  } catch (e) { await db.exec('ROLLBACK'); throw e }
})
await scenariu('S18c revenirea corectă: NOTICE-urile de timp (SHARE, corecturi, exclusiv, sfârșit)', null, async (db) => {
  await aplicaMig(db, MIG_B)
  const j = await revino(db, citeste(REV))
  for (const re of [/^20261216a revenire: SHARE la \d+ ms/, /^20261216a revenire: corecturi cautate la \d+ ms/, /^20261216a revenire: exclusiv la \d+ ms/, /^20261216a revenire: sfarsit la \d+ ms/]) {
    if (!j.some(m => re.test(m))) throw new Error('lipsește NOTICE-ul ' + re + ': ' + j.join(' | '))
  }
  console.log('       ' + j.filter(m => /revenire: (SHARE|corecturi|exclusiv|sfarsit)/.test(m)).join(' · '))
})
// costul mutării (PGlite = WASM, mai lent decât PostgreSQL real): N rapoarte cu rezumat automat pe șantier, apoi mutarea
await scenariu('S19 costul mutării: 2000 de rapoarte cu rezumat automat', null, async (db) => {
  await aplicaMig(db, MIG_B)
  const t0 = Date.now()
  await db.exec(`INSERT INTO public.rapoarte_zilnice (site_id, data, probleme, personal_snapshot)
                 SELECT 1, DATE '1990-01-01' + g, 'Raport ' || g, '{"total": 5, "sudori": 2}'::jsonb FROM generate_series(1, 2000) g;`)
  const t1 = Date.now()
  await db.exec('UPDATE public.sites SET proiect_id = 2 WHERE id = 1;')
  const t2 = Date.now()
  const r = (await db.query(`SELECT count(*) FILTER (WHERE rezumat_sursa = 'de_recompus')::int AS d, count(*)::int AS n FROM public.rapoarte_zilnice WHERE site_id = 1`)).rows[0]
  if (r.d !== 2000 || r.n !== 2000) throw new Error(`după mutare: ${r.d} / ${r.n} de_recompus`)
  console.log(`       2000 de rapoarte: inserate (cu rezumat) în ${t1 - t0} ms; mutarea șantierului (invalidare) în ${t2 - t1} ms`)
})
if (rau) { console.error(`${rau} mutanți / scenarii greșite`); process.exit(1) }
console.log('mutanți: toți prinși la testul lor; scenariile de refuz: toate cu motivul lor')
