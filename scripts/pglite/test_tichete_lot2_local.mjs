// Proba LOCALĂ (PGlite, Postgres în WASM, în memorie — NU atinge nicio bază reală) pentru migrările lotului 2 de tichete, r2:
//   20261215a (notițe interne Achiziții), 20261215b (contact la beneficiar, Probe), 20261215c (izometrie: mută o piesă la poziția N).
// Peste schema falsă supabase/tests/20261215_tichete_lot2_schelet.sql (+ poarta schimbului EXTRASĂ EXACT din 20261209a):
//   1. rulează scriptul coordonatorului scripts/tichete_lot2_amprente.sql (tot fișierul, prin mini-psql; apoi fiecare secțiune într-o
//      tranzacție READ ONLY) și ia coloana linie_baseline;
//   2. pune baseline-ul în blocul marcat al fiecărei migrări (ca după review), aplică migrarea ca runner-ul (marcajul legat de txid),
//      apoi revenirea armată, apoi din nou migrarea (aplicare → revenire → reaplicare);
//   3. mutanți: fiecare TREBUIE să pice exact unde trebuie (fragmentul erorii), altfel testul nu dovedește nimic — baseline necompletat,
//      drept în plus (PUBLIC / anon pe coloană), politică USING true în plus, callee tranzitiv schimbat, trigger oprit, FORCE RLS, funcție
//      DEFINER fără search_path, schimbare strecurată după ALTER (amprenta „după”), revenire pe obiecte cu altă amprentă;
//   4. 20261215c: scenariul REAL supabase/tests/20261215c_izometrie_muta_pozitie.sql în modul sintetic (își creează datele în tranzacție
//      anulată), ca editor NON-owner. Concurența (două sesiuni) NU se poate proba aici (PGlite = o singură conexiune): o face
//      scripts/izometrie_muta_pozitie_concurenta.sh pe clonă.
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_tichete_lot2_local.mjs ['<regex scenariu>']
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const citeste = p => readFileSync(p, 'utf8').replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const SCHELET = join(ROOT, 'supabase/tests/20261215_tichete_lot2_schelet.sql')
const SCRIPT = join(ROOT, 'scripts/tichete_lot2_amprente.sql')
const PROBA_C = join(ROOT, 'supabase/tests/20261215c_izometrie_muta_pozitie.sql')
const M = {
  a: { nume: '20261215a_achizitii_note_interne', armare: ['gazpet.revenire_20261215a', 'SCOATE_NOTE_INTERNE'] },
  b: { nume: '20261215b_probe_oferte_contact', armare: ['gazpet.revenire_20261215b', 'SCOATE_CONTACT_PROBE'] },
  c: { nume: '20261215c_izometrie_muta_pozitie', armare: ['gazpet.revenire_20261215c', 'SCOATE_MUTA_POZITIE'] },
}
for (const m of Object.values(M)) {
  m.mig = join(ROOT, 'supabase/migrations', m.nume + '.sql')
  m.rev = join(ROOT, 'supabase/revenire', m.nume + '_ROLLBACK.sql')
  m.x = m.nume.slice(0, 9)
}

// corpul (între delimitatorii $…$) al primei funcții care începe cu `cap`, fără CR — ca md5(replace(prosrc, chr(13), '')) din BD
function corp(text, cap) {
  const i = text.indexOf(cap)
  if (i < 0) throw new Error('nu găsesc ' + cap)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(text.slice(i))
  const st = i + a.index + a[0].length
  return text.slice(st, text.indexOf(a[1], st))
}
// poarta schimbului EXACT din 20261209a (CREATE FUNCTION … END $f$; + drepturile ei)
const MIG09 = citeste(join(ROOT, 'supabase/migrations/20261209a_executie_acces_proiect.sql'))
const POARTA_CAP = 'CREATE FUNCTION public.fn_executie_swap_tevi_pozitie('
const POARTA = (() => {
  const i = MIG09.indexOf(POARTA_CAP); const st = MIG09.indexOf('AS $f$', i) + 6; const sf = MIG09.indexOf('END $f$;', st) + 'END $f$;'.length
  const acl = MIG09.split('\n').filter(l => /^(REVOKE|GRANT) /.test(l) && l.includes('ON FUNCTION public.fn_executie_swap_tevi_pozitie(')).join('\n')
  return MIG09.slice(i, sf) + '\n' + acl + '\n'
})()
if (md5(corp(POARTA, POARTA_CAP)) !== 'ab1f7875a2784791f9584580b71be38f') throw new Error('poarta extrasă din 20261209a nu are amprenta din 20261215c')
const SWAP_REAL = '551affa41371b0ff3367b0ddebe9b603'
const SWAP_INLOCUITOR = md5(corp(citeste(SCHELET), 'CREATE FUNCTION executie_acces_intern.fn_executie_swap_tevi_pozitie('))
const cuInlocuitor = t => {
  if (!t.includes(SWAP_REAL)) throw new Error('20261215c nu mai are amprenta reală a originalului schimbului')
  return t.split(SWAP_REAL).join(SWAP_INLOCUITOR)
}

function inlocuieste(text, vechi, nou) {
  if (!text.includes(vechi)) throw new Error('mutant fără efect: nu găsesc «' + vechi.slice(0, 90) + '»')
  return text.split(vechi).join(nou)
}

// mini-psql: \set, \echo, \ir, \i, \if / \else / \endif cu :{?nume}, :'var' (ce folosesc scriptul și proba)
function boolPsql(expr, st) {
  const v = expr.trim().replace(/:\{\?([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, n) => (n in st.vars ? 'TRUE' : 'FALSE')).toLowerCase()
  if (['true', 'on', '1', 'yes'].includes(v)) return true
  if (['false', 'off', '0', 'no'].includes(v)) return false
  throw new Error('\\if: valoare nebooleană «' + expr + '»')
}
async function ruleazaText(db, text, dir, st) {
  const stiva = []
  const activ = () => stiva.every(s => s.activ)
  let buf = []
  const executa = async () => {
    const sql = buf.join('\n'); buf = []
    if (!sql.trim()) return
    const r = await db.exec(sql, { onNotice: n => st.notite.push(n.message) })
    st.rezultate.push(...r)
  }
  for (const l of text.split('\n')) {
    if (l.startsWith('\\')) {
      const [cmd, ...rest] = l.slice(1).trim().split(/\s+/)
      if (cmd === 'if') { if (activ()) await executa(); const p = activ(); const v = p ? boolPsql(rest.join(' '), st) : false; stiva.push({ p, activ: p && v, luat: v }); continue }
      if (cmd === 'else') { const s = stiva.at(-1); if (s.activ) await executa(); s.activ = s.p && !s.luat; s.luat = true; continue }
      if (cmd === 'endif') { const s = stiva.pop(); if (s.activ) await executa(); continue }
      if (!activ()) continue
      await executa()
      if (cmd === 'set') st.vars[rest[0]] = rest[1] ?? ''
      else if (cmd === 'echo') st.notite.push('echo ' + rest.join(' '))
      else if (cmd === 'ir' || cmd === 'i') { const f = resolve(cmd === 'ir' ? dir : ROOT, rest.join(' ')); await ruleazaText(db, citeste(f), dirname(f), st) }
      else throw new Error('meta-comandă necunoscută: ' + l)
    } else if (activ()) {
      buf.push(l.replace(/:'([A-Za-z_][A-Za-z0-9_]*)'/g, (m, v) => (v in st.vars ? "'" + String(st.vars[v]).replace(/'/g, "''") + "'" : m)))
    }
  }
  if (stiva.length) throw new Error('\\if neînchis')
  await executa()
}
const stareNoua = () => ({ vars: {}, notite: [], rezultate: [] })

// secțiunile scriptului coordonatorului: interogarea de după „WITH RECURSIVE” a fiecărei migrări
function sectiuni() {
  const t = citeste(SCRIPT)
  const out = {}
  for (const m of Object.values(M)) {
    const i = t.indexOf(`-- >>> INTRARE ${m.x}`)
    const st = t.lastIndexOf('WITH RECURSIVE', i)
    out[m.x] = t.slice(st, t.indexOf('ORDER BY c.eticheta COLLATE "C";', i) + 'ORDER BY c.eticheta COLLATE "C"'.length)
  }
  return out
}
const SECTIUNI = sectiuni()
async function baseline(db, x) {
  await db.exec('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path = public, pg_temp;')
  try {
    const r = await db.query(SECTIUNI[x])
    return r.rows
  } finally { await db.exec('ROLLBACK') }
}
const PLACEHOLDER = x => `    ('DE_COMPLETAT: scripts/tichete_lot2_amprente.sql, sectiunea ${x}', '-')`
const cuBaseline = (text, x, randuri) => inlocuieste(text, PLACEHOLDER(x), randuri.map(r => r.linie_baseline).join('\n'))

async function aplica(db, m, text) {
  await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '${m.nume}:' || txid_current(), true);\n${text}\nCOMMIT;`)
}
async function revino(db, m, text) {
  await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED; SELECT set_config('${m.armare[0]}', '${m.armare[1]}:' || txid_current(), true);\n${text}\nCOMMIT;`)
}
const textMig = m => (m.x === '20261215c' ? cuInlocuitor(citeste(m.mig)) : citeste(m.mig))

// un scenariu: PGlite proaspăt, schema falsă, `inainte` (SQL care strică starea înainte de baseline / migrare), apoi pașii
const DOAR = process.argv[2] ? new RegExp(process.argv[2]) : null
async function scenariu(nume, fn) {
  if (DOAR && !DOAR.test(nume)) return { sarit: true }
  const db = new PGlite()
  try {
    await db.exec(citeste(SCHELET))
    await db.exec(POARTA)
    const r = await fn(db)
    return { ok: true, ...(r || {}) }
  } catch (e) {
    try { await db.exec('ROLLBACK') } catch {}
    return { ok: false, eroare: (e.code ? e.code + ' ' : '') + e.message }
  } finally { await db.close() }
}
let esecuri = 0
const raport = (eticheta, r, asteptat, motiv) => {
  if (r.sarit) return
  const bine = r.ok === asteptat && (!motiv || motiv.test(r.eroare || ''))
  if (!bine) esecuri++
  console.log(`${bine ? 'OK  ' : 'FAIL'} ${eticheta}: ${r.ok ? 'trecut' + (r.info ? ' — ' + r.info : '') : 'oprit: ' + (r.eroare || '').slice(0, 400)}`)
}
// baseline luat pe starea curată, apoi starea stricată (`strica`), apoi migrarea → trebuie să refuze
const mutantInainte = (m, strica) => async db => {
  const b = await baseline(db, m.x)
  await db.exec(strica)
  await aplica(db, m, cuBaseline(textMig(m), m.x, b))
}
// aplicare → revenire → reaplicare (cu același baseline: starea de acces trebuie să fie aceeași după revenire)
const ciclu = m => async db => {
  const b = await baseline(db, m.x)
  const t = cuBaseline(textMig(m), m.x, b)
  await aplica(db, m, t)
  const tmp = (await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'amp\\_%'`)).rows[0].n
  if (tmp !== 0) throw new Error('funcțiile pg_temp ale amprentei au rămas după migrare: ' + tmp)
  await revino(db, m, citeste(m.rev))
  await aplica(db, m, t)
  return { info: `${b.length} etichete în baseline; ` + b.filter(r => r.atentie).map(r => r.eticheta + ' [' + r.atentie + ']').join('; ') }
}

// 0) scriptul coordonatorului, tot fișierul (meta-comenzi psql + BEGIN READ ONLY … ROLLBACK), pe starea curată
raport('script: tot fișierul rulează READ ONLY și dă baseline pe toate trei', await scenariu('script', async db => {
  const st = stareNoua()
  await ruleazaText(db, citeste(SCRIPT), dirname(SCRIPT), st)
  const sect = st.rezultate.filter(r => r.fields.some(f => f.name === 'linie_baseline'))
  if (sect.length !== 3 || sect.some(r => r.rows.length < 6)) throw new Error('secțiuni: ' + sect.map(r => r.rows.length).join(','))
  const fn = sect[2].rows.filter(r => r.eticheta.startsWith('functie ')).map(r => r.eticheta + ' (' + r.sursa + ')')
  // callee-ul tranzitiv (pe care pg_depend nu-l vede) e propus de script, iar originalul din schema internă e în listă
  for (const s of sect.slice(0, 2)) if (!s.rows.some(r => r.eticheta === 'functie fn_lot2_nivel_modul(text)' && r.sursa === 'indiciu')) throw new Error('callee-ul tranzitiv lipsește')
  if (!fn.some(f => f.startsWith('functie executie_acces_intern.fn_executie_swap_tevi_pozitie(bigint,bigint)'))) throw new Error('originalul schimbului lipsește: ' + fn)
  if (!fn.some(f => f.startsWith('functie fn_executie_proiect_permis(bigint,boolean) (indiciu)'))) throw new Error('callee-ul dreptului lipsește: ' + fn)
  return { info: '20261215c: ' + fn.join(', ') }
}), true)

for (const k of ['a', 'b', 'c']) {
  const m = M[k]
  raport(`${m.x} baseline necompletat = refuz`, await scenariu(`${k}-necompletat`, async db => { await aplica(db, m, textMig(m)) }), false,
    new RegExp(`${m.x}: baseline L15 necompletat`))
  raport(`${m.x} aplicare → revenire → reaplicare`, await scenariu(`${k}-ciclu`, ciclu(m)), true)
  raport(`${m.x} baseline cu o etichetă dublă = refuz`, await scenariu(`${k}-dublura`, async db => {
    const b = await baseline(db, m.x)
    await aplica(db, m, cuBaseline(textMig(m), m.x, [...b, { linie_baseline: '  , ' + b[0].linie_baseline.trim() }]))
  }), false, new RegExp(`${m.x}: baseline L15 cu etichete duble`))
  raport(`${m.x} un callee tranzitiv schimbat = refuz`, await scenariu(`${k}-callee`, mutantInainte(m, k === 'c'
    ? `CREATE OR REPLACE FUNCTION public.fn_executie_proiect_permis(p_proiect bigint, p_scriere boolean) RETURNS boolean
       LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$;`
    : `CREATE OR REPLACE FUNCTION public.fn_lot2_nivel_modul(p_modul text) RETURNS text
       LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT 'admin'::text $f$;`)), false,
    new RegExp(`${m.x}: starea de acces \\(inainte\\) difera.*functie fn_(lot2_nivel_modul|executie_proiect_permis)`))
}

// 20261215a: mutanți pe comenzi_furnizor
const A = M.a
raport('20261215a drept în plus pentru PUBLIC = refuz', await scenariu('a-public', mutantInainte(A, 'GRANT SELECT ON public.comenzi_furnizor TO PUBLIC;')), false,
  /20261215a: starea de acces \(inainte\) difera.*tabel comenzi_furnizor \| acl /)
raport('20261215a politică USING true în plus = refuz', await scenariu('a-politica', mutantInainte(A,
  'CREATE POLICY cf_toti ON public.comenzi_furnizor FOR SELECT TO authenticated USING (true);')), false, /tabel comenzi_furnizor \| politici/)
raport('20261215a trigger oprit = refuz', await scenariu('a-trigger', mutantInainte(A, 'ALTER TABLE public.comenzi_furnizor DISABLE TRIGGER trg_cf_updated;')), false,
  /tabel comenzi_furnizor \| triggere/)
raport('20261215a FORCE RLS = refuz', await scenariu('a-force', mutantInainte(A, 'ALTER TABLE public.comenzi_furnizor FORCE ROW LEVEL SECURITY;')), false,
  /tabel comenzi_furnizor \| rls/)
raport('20261215a funcția politicii fără search_path = refuz', await scenariu('a-searchpath', mutantInainte(A,
  'ALTER FUNCTION public.fn_lot2_poate_achizitii() RESET search_path;')), false, /functie fn_lot2_poate_achizitii\(\)/)
raport('20261215a o funcție nouă în politică = refuz (eticheta nu e în baseline)', await scenariu('a-functie-noua', mutantInainte(A,
  `CREATE FUNCTION public.fn_lot2_alt() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;
   CREATE POLICY cf_alt ON public.comenzi_furnizor AS RESTRICTIVE FOR SELECT TO authenticated USING (public.fn_lot2_alt());`)), false,
  /functie fn_lot2_alt\(\) = [0-9a-f]{32} \(baseline NU ARE\)/)
raport('20261215a schimbare strecurată după ALTER = refuz la amprenta „după”', await scenariu('a-dupa', async db => {
  const b = await baseline(db, A.x)
  await aplica(db, A, inlocuieste(cuBaseline(textMig(A), A.x, b), '-- L15 (r2): aceeași amprentă DUPĂ', 'GRANT SELECT ON public.comenzi_furnizor TO PUBLIC;\n-- L15 (r2): aceeași amprentă DUPĂ'))
}), false, /20261215a: starea de acces \(dupa\) difera/)
raport('20261215a drept pe coloana nouă = refuz în postcondiție', await scenariu('a-coloana', async db => {
  const b = await baseline(db, A.x)
  await aplica(db, A, inlocuieste(cuBaseline(textMig(A), A.x, b), '\nDO $post$', '\nGRANT SELECT (note_interne) ON public.comenzi_furnizor TO anon;\nDO $post$'))
}), false, /20261215a: note_interne are drepturi proprii/)
for (const [et, strica, motiv] of [
  ['drept propriu pe coloană', 'GRANT SELECT (note_interne) ON public.comenzi_furnizor TO anon;', /note_interne \/ CHECK-ul ei difera/],
  ['index pe coloană', 'CREATE INDEX cf_note_ix ON public.comenzi_furnizor (note_interne);', /note_interne \/ CHECK-ul ei difera/],
  ['CHECK cu altă limită', `ALTER TABLE public.comenzi_furnizor DROP CONSTRAINT comenzi_furnizor_note_interne_lung_ck,
     ADD CONSTRAINT comenzi_furnizor_note_interne_lung_ck CHECK (note_interne IS NULL OR length(note_interne) <= 9000);`, /note_interne \/ CHECK-ul ei difera/],
  ['notiță scrisă', `UPDATE public.comenzi_furnizor SET note_interne = 'sunat furnizorul' WHERE numar = 'CF-1';`, /exista comenzi cu notite interne/],
]) raport(`20261215a revenire refuză: ${et}`, await scenariu('a-rev-' + et, async db => {
  await aplica(db, A, cuBaseline(textMig(A), A.x, await baseline(db, A.x)))
  await db.exec(strica)
  await revino(db, A, citeste(A.rev))
}), false, motiv)

// 20261215b: mutanți pe probe_oferte (date personale ale unui terț)
const B = M.b
raport('20261215b politică USING (true) în plus = refuz', await scenariu('b-politica', mutantInainte(B,
  'CREATE POLICY probe_oferte_toti ON public.probe_oferte FOR SELECT TO authenticated USING (true);')), false, /tabel probe_oferte \| politici/)
raport('20261215b anon cu SELECT pe o coloană (garda veche nu-l vedea) = refuz', await scenariu('b-anon-coloana', mutantInainte(B,
  'GRANT SELECT (client) ON public.probe_oferte TO anon;')), false, /tabel probe_oferte \| acl coloane/)
raport('20261215b corpul funcției de acces schimbat = refuz', await scenariu('b-functie', mutantInainte(B,
  `CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT auth.uid() IS NOT NULL $f$;`)),
  false, /functie fn_are_acces_ofertare\(\)/)
for (const [et, strica, motiv] of [
  ['drept propriu pe o coloană de contact', 'GRANT SELECT (client_contact_email) ON public.probe_oferte TO anon;', /coloanele de contact \/ CHECK-urile lor difera/],
  ['un CHECK lipsă', 'ALTER TABLE public.probe_oferte DROP CONSTRAINT probe_oferte_contact_email_ck;', /starea nu e cea din 20261215b|coloanele de contact \/ CHECK-urile lor difera/],
  ['contact completat', `UPDATE public.probe_oferte SET client_contact_nume = 'Ion Popescu';`, /exista oferte cu date de contact/],
]) raport(`20261215b revenire refuză: ${et}`, await scenariu('b-rev-' + et, async db => {
  await aplica(db, B, cuBaseline(textMig(B), B.x, await baseline(db, B.x)))
  await db.exec(strica)
  await revino(db, B, citeste(B.rev))
}), false, motiv)

// 20261215c: mutanți pe lanțul schimbului + proba reală în modul sintetic
const C = M.c
raport('20261215c originalul schimbului cu alt drept (anon) = refuz', await scenariu('c-original-acl', mutantInainte(C,
  'GRANT USAGE ON SCHEMA executie_acces_intern TO anon; GRANT EXECUTE ON FUNCTION executie_acces_intern.fn_executie_swap_tevi_pozitie(bigint, bigint) TO anon;')),
  false, /functie executie_acces_intern\.fn_executie_swap_tevi_pozitie\(bigint,bigint\)/)
raport('20261215c corpul funcției de drept schimbat = refuz', await scenariu('c-drept', mutantInainte(C,
  `CREATE OR REPLACE FUNCTION public.fn_executie_nod_drept(p_proiect bigint, p_scriere boolean) RETURNS boolean
   LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT auth.uid() IS NOT NULL $f$;`)), false, /functie fn_executie_nod_drept\(bigint,boolean\)/)
raport('20261215c trigger POZ KM oprit = refuz', await scenariu('c-trigger', mutantInainte(C, 'ALTER TABLE public.executie_tevi DISABLE TRIGGER trg_lot2_poz_km;')), false,
  /tabel executie_tevi \| triggere/)
raport('20261215c politică USING true pe pachete = refuz', await scenariu('c-politica', mutantInainte(C,
  'CREATE POLICY pachete_toti ON public.executie_pachete_lansare FOR SELECT TO authenticated USING (true);')), false, /tabel executie_pachete_lansare \| politici/)
raport('20261215c proba reală (mod sintetic, editor NON-owner): T0–T6', await scenariu('c-proba', async db => {
  await aplica(db, C, cuBaseline(textMig(C), C.x, await baseline(db, C.x)))
  const st = stareNoua()
  await ruleazaText(db, citeste(PROBA_C), dirname(PROBA_C), st)
  if (!st.notite.some(n => n === 'OK - toate testele 20261215c au trecut')) throw new Error('proba nu a ajuns la final: ' + st.notite.slice(-3).join(' | '))
  if (st.notite.some(n => /^ATENTIE T1/.test(n))) throw new Error('POZ KM nu s-a calculat pe datele sintetice')
  const n = (await db.query(`SELECT (SELECT count(*) FROM public.executie_tevi)::int AS t, (SELECT count(*) FROM public.user_module_access)::int AS u`)).rows[0]
  if (n.t !== 0 || n.u !== 0) throw new Error('proba a lăsat rânduri: ' + JSON.stringify(n))
  return { info: st.notite.filter(x => /^OK T/.test(x)).length + ' verificări OK, nimic rămas după ROLLBACK' }
}), true)
raport('20261215c proba: un străin cu drept = proba refuză (nu dovedește nimic)', await scenariu('c-proba-strain', async db => {
  await aplica(db, C, cuBaseline(textMig(C), C.x, await baseline(db, C.x)))
  await db.exec(`INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('00000000-0000-4000-8000-000000000003', 'executie', 'admin')`)
  const st = stareNoua()
  await ruleazaText(db, citeste(PROBA_C), dirname(PROBA_C), st)
}), false, /FAIL T0: strainul are drept/)
raport('20261215c proba: editorul owner = refuz (cere NON-owner)', await scenariu('c-proba-owner', async db => {
  await aplica(db, C, cuBaseline(textMig(C), C.x, await baseline(db, C.x)))
  const st = stareNoua(); st.vars.editor = '00000000-0000-4000-8000-000000000001'
  await ruleazaText(db, citeste(PROBA_C), dirname(PROBA_C), st)
}), false, /editorul .* e owner/)
for (const [et, strica] of [
  ['EXECUTE pentru anon', 'GRANT EXECUTE ON FUNCTION public.fn_executie_tevi_muta_pozitie(bigint, integer) TO anon;'],
  ['alt corp', `CREATE OR REPLACE FUNCTION public.fn_executie_tevi_muta_pozitie(p_id bigint, p_poz_noua integer) RETURNS jsonb
     LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$ BEGIN RETURN '{}'::jsonb; END $f$;`],
  ['DEFINER', 'ALTER FUNCTION public.fn_executie_tevi_muta_pozitie(bigint, integer) SECURITY DEFINER;'],
]) raport(`20261215c revenire refuză: ${et}`, await scenariu('c-rev-' + et, async db => {
  await aplica(db, C, cuBaseline(textMig(C), C.x, await baseline(db, C.x)))
  await db.exec(strica)
  await revino(db, C, citeste(C.rev))
}), false, /20261215c revenire: starea nu e cea din 20261215c/)

console.log(esecuri ? `\n${esecuri} scenarii NU s-au comportat cum trebuie` : '\nToate scenariile s-au comportat cum trebuie')
process.exit(esecuri ? 1 : 0)
