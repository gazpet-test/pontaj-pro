// Proba LOCALĂ a migrării 20261215a (rezumatul raportului zilnic) pe PGlite (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Rulează harness-ul REAL scripts/test_executie_raport_rezumat.sql (cel pe care chat-ul îl rulează pe clonă) printr-un mini-psql
// (\ir, \set, :ERROR / :SQLSTATE / :'LAST_ERROR_MESSAGE', ON_ERROR_STOP), peste schema falsă supabase/tests/20261208a_executie_devize_tinte_schelet.sql
// + 20261027a, 20261201a, 20261208a întregi (cu marcajul de livrare, ca runner-ul).
// Apoi MUTANȚI (migrare / revenire stricate intenționat): fiecare TREBUIE să pice la testul lui, altfel harness-ul nu dovedește nimic (L25).
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_raport_rezumat_local.mjs
// Limită: PGlite nu are timere (lock_timeout nu se declanșează) și nu are concurență reală — acelea rămân pentru clonă.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const citeste = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const SCHELET = 'supabase/tests/20261208a_executie_devize_tinte_schelet.sql'
const DEP = ['20261027a_raport_distributie_gaze', '20261201a_executie_noduri_suduri', '20261208a_executie_devize_tinte']
const MIG = 'supabase/migrations/20261215a_executie_raport_rezumat.sql'
const REV = 'supabase/revenire/20261215a_executie_raport_rezumat_ROLLBACK.sql'
const HARNESS = 'scripts/test_executie_raport_rezumat.sql'

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
  for (const linie of text.replace(/\r/g, '').split('\n')) {
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
      await exec(aplica(readFileSync(cale, 'utf8'), inlocuiri[rel]))
    } else throw new Error('meta-comandă necunoscută: \\' + cmd)
  }
  await exec(buf)
}
function aplica(text, lista) {
  let t = text.replace(/\r/g, '')
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

async function ruleaza(inlocuiri = {}) {
  const db = await bazaNoua()
  const jurnal = []
  try {
    await ruleazaPsql(db, aplica(citeste(HARNESS), inlocuiri[HARNESS]), HARNESS, inlocuiri, jurnal)
    return { ok: true, jurnal }
  } catch (e) {
    return { ok: false, eroare: e.message, jurnal }
  } finally { await db.close() }
}

// ── 1. harness-ul pe migrarea reală: toate testele trebuie să treacă ──
const real = await ruleaza()
const oke = real.jurnal.filter((m) => / OK|refuz confirmat/.test(m))
console.log(oke.map((m) => '  ' + m).join('\n'))
if (!real.ok) { console.error('HARNESS PICAT: ' + real.eroare); process.exit(1) }
for (const t of ['TB', 'T0', 'T1', 'T2', 'T3', 'T4a', 'T4', 'T5', 'T6a', 'T6', 'T7', 'T8', 'T9']) {
  if (!oke.some((m) => m.startsWith(t + ' OK'))) { console.error('lipsește ' + t + ' OK'); process.exit(1) }
}
console.log('harness: OK pe migrarea reală')

// ── 1b. cap-coadă: scriptul de probă (DOAR citire) scoate intrarea, regula JS scrie textul = textul salvat de server pe raport ──
{
  const { rezumatRaport } = await import('../../src/raportRezumat.js')
  const db = await bazaNoua()
  await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261215a_executie_raport_rezumat:' || txid_current(), true);\n${citeste(MIG)}\nCOMMIT;`)
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
  await db.close()
  console.log('proba cap-coadă: OK (scriptul de probă + JS = textul salvat de server, 2 rapoarte)')
}

// ── 2. mutanții: fiecare trebuie să pice exact la testul lui ──
const M = MIG, R = REV
const mutanti = [
  ['M1 fără refacerea după jurnal (liniile finale)', 'T2', { [M]: [["  UPDATE public.rapoarte_zilnice SET rezumat_sursa = 'automat' WHERE id = NEW.raport_id AND rezumat_sursa IS DISTINCT FROM 'editat';\n", '']] }],
  ['M2 versiunea crește la rezumatul automat', 'T2', { [M]: [['    NEW.versiune_salvare := OLD.versiune_salvare;\n', '']] }],
  ['M3 textul corectat suprascris la salvare', 'T5', { [M]: [["    IF OLD.rezumat_sursa = 'editat' THEN RETURN NEW; END IF;\n", '']] }],
  ['M4 corectura fără dreptul pe șantier', 'T4a', { [M]: [["    IF v_uid IS NOT NULL AND public.fn_raport_santier_drept(NEW.site_id::bigint) IS NOT TRUE THEN\n      RAISE EXCEPTION 'rezumat: nu ai drept de scriere pe raportul acestui șantier' USING ERRCODE = '42501';\n    END IF;\n    IF NEW.rezumat_text IS NULL", '    IF NEW.rezumat_text IS NULL']] }],
  ['M5 autorul corecturii luat de la client', 'T4', { [M]: [['    NEW.rezumat_de := v_uid;\n', '']] }],
  ['M6 eticheta „șoferi” diferită de JS', 'T1', { [M]: [["(4, 'soferi', 'șoferi')", "(4, 'soferi', 'soferi')"]] }],
  // aceeași etichetă din amprenta de la finalul migrării: o prinde chiar postcondiția (migrarea nu se aplică)
  ['M6b eticheta „lăcătuși” diferită de JS', 'post', { [M]: [["(2, 'lacatusi', 'lăcătuși')", "(2, 'lacatusi', 'lacatusi')"]] }],
  ['M7 tăierea pe cuvinte decalată cu unu', 'T1', { [M]: [['  c := left(t, n + 1);', '  c := left(t, n);']] }],
  ['M8 cifrele rotunjite', 'post', { [M]: [["replace(trim_scale((j #>> '{}')::numeric)::text, '.', ',')", "replace(round((j #>> '{}')::numeric, 1)::text, '.', ',')"]] }],
  ['M8b zerourile de la final păstrate (1.50 ≠ 1,5)', 'T1', { [M]: [["replace(trim_scale((j #>> '{}')::numeric)::text, '.', ',')", "replace((j #>> '{}')::numeric::text, '.', ',')"]] }],
  ['M9 la inserare, sursa clientului păstrată', 'T7', { [M]: [["    NEW.rezumat_sursa := 'automat';\n  ELSIF (NEW.rezumat_text", "    NULL;\n  ELSIF (NEW.rezumat_text"]] }],
  ['M10 „revino la automat” fără drept', 'T6a', { [M]: [["    IF OLD.rezumat_sursa = 'editat' AND v_uid IS NOT NULL AND public.fn_raport_santier_drept(NEW.site_id::bigint) IS NOT TRUE THEN", '    IF false THEN']] }],
  ['M11 textul „automat” trimis de client păstrat', 'T2', { [M]: [['  NEW.rezumat_text := v_text;\n', "  NEW.rezumat_text := coalesce(NEW.rezumat_text, v_text);\n"]] }],
  ['M12 revenirea nu refuză corecturile', 'T9b', { [R]: [["  IF EXISTS (SELECT 1 FROM public.rapoarte_zilnice WHERE rezumat_sursa = 'editat') THEN", '  IF false THEN']] }],
  ['M13 EXECUTE lăsat clienților', 'post', { [M]: [['REVOKE ALL ON FUNCTION public.fn_raport_rezumat_text(jsonb) FROM PUBLIC, anon, authenticated, service_role;', 'REVOKE ALL ON FUNCTION public.fn_raport_rezumat_text(jsonb) FROM anon, service_role;']] }],
  // T8 singur (fără postcondiție): EXECUTE dat după migrare, ca o greșeală ulterioară
  ['M13b EXECUTE dat clienților după migrare', 'T8', { [HARNESS]: [["-- ── T8: funcțiile nu sunt apelabile din API", "GRANT EXECUTE ON FUNCTION public.fn_raport_rezumat_intrare(public.rapoarte_zilnice) TO authenticated;\n-- ── T8: funcțiile nu sunt apelabile din API"]] }],
  ['M14 versiunea nu crește la corectura omului', 'T4', { [M]: [["    NEW.rezumat_de := v_uid;\n    RETURN NEW;", "    NEW.rezumat_de := v_uid;\n    NEW.versiune_salvare := OLD.versiune_salvare;\n    RETURN NEW;"]] }],
  ['M15 scrierea fără rezumat nu reface rezumatul automat', 'T2', { [M]: [["    IF OLD.rezumat_sursa = 'editat' THEN RETURN NEW; END IF;\n    NEW.rezumat_sursa := 'automat';", "    RETURN NEW;"]] }],
]
let rau = 0
for (const [nume, test, inl] of mutanti) {
  const r = await ruleaza(inl)
  // „post” = o postcondiție a migrării (migrarea nu se aplică deloc); altfel testul din mesajul „Tn FAIL”
  const picatLa = r.ok ? null : /20261215a post/.test(r.eroare) ? 'post' : (/(T[0-9]+[a-z]?|TB) FAIL/.exec(r.eroare) || [])[1] || 'altundeva'
  const bine = !r.ok && picatLa === test
  if (!bine) rau++
  console.log(`${bine ? 'prins ' : 'SCĂPAT'} ${nume}: ${r.ok ? 'harness-ul a trecut' : 'pică la ' + picatLa}${bine ? '' : ' (așteptat ' + test + ')' + (r.ok ? '' : ' — ' + r.eroare.slice(0, 220))}`)
}
if (rau) { console.error(`${rau} mutanți neprinși corect`); process.exit(1) }
console.log('mutanți: toți prinși la testul lor')
