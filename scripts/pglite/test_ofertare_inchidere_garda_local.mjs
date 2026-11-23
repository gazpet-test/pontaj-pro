// Proba LOCALĂ a migrării 20261132a (garda închiderii în Ofertare, PR #1029 r2) pe PGlite (Postgres în WASM, în memorie) — NU atinge
// nicio bază reală. Pași, pe schema falsă supabase/tests/20261132a_ofertare_inchidere_garda_schelet.sql (funcțiile lanțului copiate EXACT
// din migrările lor):
//   1. scriptul REAL de amprente (scripts/ofertare_inchidere_garda_amprente.sql, READ ONLY) → blocul de lipit;
//   2. migrarea completată cu blocul (în memorie; fișierul din repo rămâne cu __DE_COMPLETAT__);
//   3. dry-run-ul REAL (supabase/tests/20261132a_ofertare_inchidere_garda_dryrun.sql) printr-un mini-psql (\set, \encoding, \pset, \copy);
//   4. mutanți (migrare / revenire / interogare stricate intenționat): fiecare TREBUIE să pice exact la cazul așteptat.
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_ofertare_inchidere_garda_local.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const P = {
  mig: 'supabase/migrations/20261132a_ofertare_inchidere_garda.sql',
  rb: 'supabase/revenire/20261132a_ofertare_inchidere_garda_ROLLBACK.sql',
  amp: 'scripts/ofertare_inchidere_garda_amprente.sql',
  dry: 'supabase/tests/20261132a_ofertare_inchidere_garda_dryrun.sql',
  schelet: 'supabase/tests/20261132a_ofertare_inchidere_garda_schelet.sql',
}
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

// o funcție EXACT ca în migrarea ei (de la CREATE … la sfârșitul corpului) + REVOKE / GRANT-urile ei
function extrageFunctie(fisier, cap, nume) {
  const t = citeste('supabase/migrations/' + fisier)
  const i = t.indexOf(cap)
  if (i < 0) throw new Error('nu găsesc ' + cap + ' în ' + fisier)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(t.slice(i))
  const startCorp = i + a.index + a[0].length
  const sfarsit = t.indexOf(';', t.indexOf(a[1], startCorp) + a[1].length) + 1
  const acl = t.split('\n').filter(l => /^(REVOKE|GRANT) /.test(l) && l.includes('ON FUNCTION public.' + nume + '(')).join('\n')
  return t.slice(i, sfarsit) + '\n' + acl + '\n'
}
const FUNCTII = [
  extrageFunctie('20260912_ofertare_acces_fara_parametru.sql', 'CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare()', 'fn_are_acces_ofertare'),
  extrageFunctie('20260928p_ofertare_rls_scriere_r_v2_07.sql', 'CREATE OR REPLACE FUNCTION public.fn_ofertare_licitatii_scriere()', 'fn_ofertare_licitatii_scriere'),
  extrageFunctie('20261124a_ofertare_poarta_cheltuiala.sql', 'CREATE OR REPLACE FUNCTION public.fn_ofertare_responsabil_setat_de()', 'fn_ofertare_responsabil_setat_de'),
  extrageFunctie('20261124a_ofertare_poarta_cheltuiala.sql', 'CREATE FUNCTION public.fn_ofertare_poate_cheltui(', 'fn_ofertare_poate_cheltui'),
].join('\n')

// mini-psql: doar ce folosesc cele trei fișiere. Întoarce { iesire: [rânduri], notite: [mesaje] }; la eroare aruncă (ON_ERROR_STOP).
async function ruleaza(db, text, fisiere) {
  const iesire = [], notite = []
  let buf = []
  const executa = async () => {
    const sql = buf.join('\n'); buf = []
    if (!sql.trim()) return
    let rez
    try { rez = await db.exec(sql, { onNotice: n => notite.push(n.message) }) } catch (e) {
      // ca psql: mesajul + contextul (CONTEXT), ca să se vadă cazul / blocul care a picat
      throw new Error(e.message + (e.where ? ' | CONTEXT: ' + e.where.split('\n').slice(0, 3).join(' / ') : ''))
    }
    for (const r of rez) for (const rand of r.rows || []) iesire.push(Object.values(rand).map(v => (v === null ? '' : String(v))).join('|'))
  }
  for (const linie of text.split('\n')) {
    const t = linie.trim()
    if (!t.startsWith('\\')) { buf.push(linie); continue }
    await executa()
    let m
    if (/^\\(set|encoding|pset) /.test(t)) continue
    if ((m = /^\\copy (\w+) \((\w+)\) FROM '([^']+)' WITH \(FORMAT csv, DELIMITER E'\\x01', QUOTE E'\\x02'\)$/.exec(t))) {
      if (!(m[3] in fisiere)) throw new Error('\\copy: fișier necunoscut ' + m[3])
      const linii = fisiere[m[3]].replace(/\r\n/g, '\n').split('\n')
      if (linii[linii.length - 1] === '') linii.pop()
      // ca psql: CSV, câmp necitat gol = NULL
      await db.query(`INSERT INTO ${m[1]} (${m[2]}) SELECT x FROM unnest($1::text[]) WITH ORDINALITY AS u(x, o) ORDER BY o`,
        [linii.map(l => (l === '' ? null : l))])
      continue
    }
    throw new Error('mini-psql: meta-comandă nesuportată: ' + t)
  }
  await executa()
  return { iesire, notite }
}

async function bazaNoua() {
  const db = new PGlite()
  await db.exec(citeste(P.schelet).replace('-- @FUNCTII_DIN_MIGRARI', FUNCTII))
  return db
}

const inlocuieste = (text, vechi, nou) => {
  if (!text.includes(vechi)) throw new Error('mutant fără efect: nu găsesc «' + vechi.slice(0, 90) + '»')
  return text.split(vechi).join(nou)
}

// blocul dintre marcajele AMPRENTE BASELINE (inclusiv marcajele) — înlocuit cu cel tipărit de script
function completeaza(mig, iesireScript) {
  const tot = iesireScript.join('\n')
  const a = tot.indexOf('  -- >>> AMPRENTE BASELINE'), b = tot.indexOf('  -- <<< AMPRENTE BASELINE')
  if (a < 0 || b < 0) throw new Error('scriptul de amprente nu a tipărit blocul')
  const bloc = tot.slice(a, tot.indexOf('\n', b))
  const i = mig.indexOf('  -- >>> AMPRENTE BASELINE'), j = mig.indexOf('  -- <<< AMPRENTE BASELINE')
  return mig.slice(0, i) + bloc + mig.slice(mig.indexOf('\n', j))
}

// un ciclu complet: amprente (cu textul scriptului dat) → migrarea completată → dry-run; întoarce { ok, rez, eroare, notite }
async function ciclu({ mig = citeste(P.mig), rb = citeste(P.rb), amp = citeste(P.amp), completare = true } = {}) {
  const db = await bazaNoua()
  try {
    const sc = await ruleaza(db, amp, {})
    const migFinal = completare ? completeaza(mig, sc.iesire) : mig
    const fisiere = { [P.mig]: migFinal, [P.rb]: rb }
    let eroare = null, d = { iesire: [], notite: [] }
    try { d = await ruleaza(db, citeste(P.dry), fisiere) } catch (e) { eroare = e.message }
    const rez = d.iesire.filter(l => l.startsWith('REZ|'))
    return { ok: !eroare && d.notite.some(n => n.includes('TOATE OK')), rez, eroare, notite: d.notite, script: sc.iesire, migFinal }
  } finally { await db.close() }
}

let esecuri = 0
const verifica = (cond, mesaj) => { console.log((cond ? 'OK   ' : 'FAIL ') + mesaj); if (!cond) esecuri++ }

// ── 1. ciclul de bază ──
const baza = await ciclu()
for (const l of baza.rez) console.log('  ' + l)
if (baza.eroare) console.log('  eroare: ' + baza.eroare)
verifica(baza.ok, 'dry-run-ul real trece pe schema falsă, cu amprentele tipărite de script (' + baza.rez.length + ' cazuri)')
verifica(baza.rez.length >= 30 && !baza.rez.some(l => l.includes('|FAIL|') || l.includes('|SARIT|')), 'niciun caz FAIL / SARIT')
const etichete = baza.script.filter(l => l.startsWith('\n==================== ') || l.includes('==================== ')).length
verifica(etichete >= 15, 'scriptul tipărește amprenta + materialul pentru fiecare etichetă (' + etichete + ' secțiuni)')
verifica(baza.script.some(l => l.includes('tranzactie READ ONLY: da')), 'scriptul rulează în tranzacție READ ONLY')

// ── 2. migrarea necompletată / fără runner ──
{
  const r = await ciclu({ completare: false })
  verifica(!r.ok && /A0|nu sunt completate/.test(r.eroare || ''), 'migrarea necompletată (__DE_COMPLETAT__) refuză: ' + (r.eroare || '').slice(0, 140))
}
{
  const db = await bazaNoua()
  let e = null
  try { await db.exec(citeste(P.mig)) } catch (x) { e = x.message }
  await db.close()
  verifica(/garda start invalida/.test(e || ''), 'migrarea rulată fără marcajul runnerului refuză (garda start)')
}

// ── 3. mutanți: fiecare trebuie să pice la cazul lui ──
const picaLa = (r, caz) => r.rez.some(l => l.startsWith('REZ|' + caz + '|FAIL|')) || (r.eroare || '').includes(caz)
const MUTANTI = [
  { nume: 'garda lasă pe oricine (RAISE final → RETURN NEW)', caz: 'P3',
    mig: m => inlocuieste(m, "  RAISE EXCEPTION 'Închiderea licitației o face ownerul;", "  RETURN NEW; RAISE EXCEPTION 'Închiderea licitației o face ownerul;") },
  { nume: 'garda citește NEW.termen_depunere în loc de OLD', caz: 'P1c',
    mig: m => inlocuieste(m, 'AND OLD.termen_depunere IS NOT NULL AND OLD.termen_depunere <= now()', 'AND NEW.termen_depunere IS NOT NULL AND NEW.termen_depunere <= now()') },
  { nume: 'garda: termenul cu < în loc de <= (limita exactă)', caz: 'R1c',
    mig: m => inlocuieste(m, 'OLD.termen_depunere <= now()', 'OLD.termen_depunere < now()') },
  { nume: 'garda: excepția UID NULL pentru orice sesiune', caz: 'P8',
    mig: m => inlocuieste(m, "IF session_user = 'postgres' THEN RETURN NEW; END IF;", 'RETURN NEW;') },
  { nume: 'garda: starea verificată pe NEW, nu pe OLD', caz: 'P2',
    mig: m => inlocuieste(m, "IF OLD.status IN ('go', 'in_lucru')", "IF NEW.status IN ('go', 'in_lucru', 'abandonata')") },
  { nume: 'amprenta fără materialul funcției trigger-ului (r1)', caz: 'N1', ambele: true,
    q: m => inlocuieste(m, "      || E'\\n--- functia triggerului ---\\n' || coalesce(m.material, '<LIPSA>')\n", '\n') },
  { nume: 'amprenta fără ACL-ul funcțiilor', caz: 'N2', ambele: true,
    q: m => inlocuieste(m, "      || E'\\nacl: ' || coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text COLLATE \"C\") FROM unnest(p.proacl) AS a),\n                               '<NULL = drepturile implicite, inclusiv EXECUTE pentru PUBLIC>')\n", '') },
  { nume: 'amprenta tabelului ca în r1 (relacl NULL pierde RLS / FORCE)', caz: 'N4', ambele: true,
    q: m => inlocuieste(m, "         coalesce((SELECT 'proprietar: ' || pg_get_userbyid(tb.relowner)\n                       || E'\\nrls: ' || tb.relrowsecurity::text\n                       || E'\\nforce_rls: ' || tb.relforcerowsecurity::text\n                       || E'\\nacl: ' || coalesce(",
                                    "         coalesce((SELECT 'proprietar: ' || pg_get_userbyid(tb.relowner)\n                       || E'\\nrls+acl: ' || (tb.relacl::text || tb.relrowsecurity::text || tb.relforcerowsecurity::text)\n                       || E'\\nacl: ' || coalesce(") },
  { nume: 'amprenta fără politici', caz: 'N5', ambele: true,
    q: m => inlocuieste(m, '    FROM pg_catalog.pg_policy pol JOIN tabel ON pol.polrelid = tabel.oid\n', '    FROM pg_catalog.pg_policy pol JOIN tabel ON pol.polrelid = tabel.oid WHERE false\n') },
  { nume: 'revenirea fără verificarea corpului', caz: 'RB1',
    rb: m => inlocuieste(m, 'IF f.corp IS DISTINCT FROM c_corp_md5 THEN', 'IF false THEN') },
  { nume: 'revenirea fără verificarea momentului trigger-ului (tgtype)', caz: 'RB2b',
    rb: m => inlocuieste(m, "OR t.tgtype IS DISTINCT FROM 19::int2 OR NOT t.fara_when", 'OR NOT t.fara_when') },
  { nume: 'revenirea fără verificarea coloanelor trigger-ului (UPDATE OF)', caz: 'RB2',
    rb: m => inlocuieste(m, " OR t.coloane IS DISTINCT FROM ARRAY['status'] THEN\n    RAISE EXCEPTION '20261132a ROLLBACK: trigger-ul", " THEN\n    RAISE EXCEPTION '20261132a ROLLBACK: trigger-ul") },
  { nume: 'revenirea fără SECURITY DEFINER verificat', caz: 'RB3',
    rb: m => inlocuieste(m, '  IF NOT f.prosecdef OR f.proconfig', '  IF f.proconfig') },
  { nume: 'revenirea acceptă trigger-ul dezactivat', caz: 'RB4',
    rb: m => inlocuieste(m, "IF t.tgenabled IS DISTINCT FROM 'O' OR t.tgfoid", 'IF t.tgfoid') },
]
// md5 pe corpul gărzii ($fn$ … $fn$, fără CR), ca prosrc în BD — un mutant al gărzii își pune amprenta proprie în migrare ȘI în revenire,
// altfel ar pica la postcondiția de corp, nu la cazul lui (iar mutantul n-ar dovedi nimic despre caz)
const corpMd5 = mig => {
  const a = mig.indexOf('AS $fn$') + 'AS $fn$'.length
  return createHash('md5').update(mig.slice(a, mig.indexOf('$fn$;', a)).replace(/\r/g, ''), 'utf8').digest('hex')
}
verifica(citeste(P.mig).includes(`c_corp_md5 CONSTANT text := '${corpMd5(citeste(P.mig))}'`) &&
         citeste(P.rb).includes(`c_corp_md5 CONSTANT text := '${corpMd5(citeste(P.mig))}'`),
         'amprenta corpului gărzii (c_corp_md5) e cea calculată din migrare, în migrare și în revenire')
for (const mt of MUTANTI) {
  const opt = {}
  if (mt.mig) {
    const m0 = citeste(P.mig), m1 = mt.mig(m0), vechi = corpMd5(m0), nou = corpMd5(m1)
    opt.mig = inlocuieste(m1, `'${vechi}'`, `'${nou}'`)
    opt.rb = inlocuieste(citeste(P.rb), `'${vechi}'`, `'${nou}'`)
  }
  if (mt.rb) opt.rb = mt.rb(citeste(P.rb))
  if (mt.q) { opt.mig = mt.q(citeste(P.mig)); opt.amp = mt.q(citeste(P.amp)) }
  const r = await ciclu(opt)
  const pica = !r.ok && picaLa(r, mt.caz)
  verifica(pica, `mutant „${mt.nume}” pică la ${mt.caz}` + (pica ? '' : ' — rezultat: ' + (r.eroare || r.rez.filter(l => l.includes('|FAIL|')).join(' ; ') || 'trece')))
}

console.log(esecuri ? `\n${esecuri} verificări picate` : '\nTOATE verificările locale OK')
process.exit(esecuri ? 1 : 0)
