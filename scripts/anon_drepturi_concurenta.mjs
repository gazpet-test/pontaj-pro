// Proba de CONCURENȚĂ pentru 20261218a / b / c (drepturile rolului anon) — DOAR pe CLONĂ PostgreSQL 17, cu DOUĂ sesiuni psql reale (L25).
// Nu atinge producția: garda țintei = system_identifier (pg_control_system()) EXACT --sistem, altfel refuz (cod 22) înainte de orice scriere.
// Rulare (din rădăcina repo-ului, Git Bash / PowerShell; parola din pgpass, niciodată pe linia de comandă):
//   PSQL=<calea psql> node scripts/anon_drepturi_concurenta.mjs --sistem <system_identifier al clonei>
//        [--mutant fara_recitire|fara_coloane|blocare_public|fara_lock] -- -h <host clonă> -p <port> -U postgres -d postgres
// Ce face: citește clona cu scripts/anon_drepturi_citire.sql, pune rândurile BASELINE ale CLONEI în copii temporare ale migrărilor (oid-urile
//   diferă între baze), apoi rulează scenariile. Sesiunea A = migrarea, încadrată ca runnerul cu plafon (SET transaction_timeout = 2000 înainte
//   de BEGIN, READ COMMITTED, marcajele de livrare + plafon în tranzacție). În copia lui A se adaugă DOAR un pg_sleep(1.2) în punctul de
//   fereastră (instrumentare de probă; fișierul din repo nu se schimbă). Sesiunea B = „cealaltă sesiune”, în paralel. Sincronizare pe stări
//   OBSERVATE (pg_stat_activity: A în PgSleep; B blocată de pid-ul lui A în pg_blocking_pids), nu pe timp.
// Scenarii (fiecare: OK / CONTRAR / PROBA_NEFUNCTIONALA = fereastra n-a fost prinsă sau starea așteptată e goală, rezultatul nu se judecă):
//   R1 a, B COMITE un drept nou (opțiune de acordare) pe o secvență din T1 ÎNTRE calculul listei și blocare -> A refuză „schimbare concurenta”,
//      dreptul lui B rămâne (apoi e scos de probă);
//   R7a a, B COMITE un drept nou pentru PUBLIC pe aceeași secvență, între calcul și blocare (review r3 P1) -> A refuză, iar dreptul PUBLIC al
//      lui B EXISTĂ după (blocarea cu santinela nu-l consumă);
//   R2 a, B încearcă același GRANT DUPĂ blocare -> B stă blocată de A; A comite; B pică („tuple concurrently updated”) SAU (dacă PG17 ar
//      reaplica peste rândul nou) dreptul lui B există după COMMIT-ul lui A. În ambele cazuri: jurnalul = EXACT drepturile lui anon de dinainte;
//   R3 a, B ține deja rândul (GRANT necomis) când pornește A -> A refuză prin lock_timeout (100 ms), nimic schimbat;
//   R4 b, B dă un drept pe o COLOANĂ fără drepturi (rând neblocat) între recitire și REVOKE -> A refuză „drepturi pe coloane schimbate
//      concurent” (sau, dacă B a fost blocată, B pică după COMMIT-ul lui A);
//   R7b b, ca R7a, pe un tabel din T2 -> A refuză, dreptul PUBLIC al lui B există după;
//   R6 b, B încearcă CREATE POLICY … TO anon USING (true) pe un tabel din T2 când A a trecut DE POSTCONDIȚII (fereastra cea mai largă, review
//      r3 P1) -> B stă blocată de A (ACCESS SHARE contra ACCESS EXCLUSIVE); A comite; politica lui B apare abia DUPĂ COMMIT-ul lui A;
//   R5 b fără concurență -> comite; revenirea b -> drepturile exact ca după a. Durate;
//   R7c c, ca R7a, pe dreptul implicit al lui postgres pentru tabele (ALTER DEFAULT PRIVILEGES … TO PUBLIC) -> A refuză, dreptul PUBLIC există;
//   R8 c, B încearcă ALTER DEFAULT PRIVILEGES DUPĂ blocare -> B stă blocată de A; A comite cu jurnalul EXACT; B pică sau trece după COMMIT;
//      apoi revenirea c -> drepturile exact ca după a;
//   R9 duratele fără instrumentare: c + revenirea c, revenirea a (= exact începutul) + a din nou. Durate (NOTICE „sfarsit la … ms”, de la
//      BEGIN) pentru a, b, c și reveniri: peste 1500 ms = ABANDON (nu se aplică pe producție, se împarte).
// Mutanți (--mutant), fiecare cu protecția lui DEZACTIVATĂ în copia lui A; ieșire 0 = DEFECTUL reprodus (mutant PRINS):
//   fara_recitire  = ambele recitiri din a (regula + ACL complet) dezactivate -> R1: A comite, jurnalul nu are dreptul lui B;
//   fara_coloane   = verificarea coloanelor din b dezactivată -> R4: A comite, dreptul de coloană al lui B dispare fără jurnal;
//   blocare_public = blocarea din r3 (retragere fără efect FROM PUBLIC în loc de santinelă) în a, b, c -> R7a / R7b / R7c: A comite și dreptul
//                    PUBLIC al lui B DISPARE (defectul review-ului r3 P1);
//   fara_lock      = LOCK … IN ACCESS SHARE MODE din b dezactivat -> R6: B NU e blocată, comite în fereastră; A comite; politica pentru anon
//                    există, tabelul e în jurnal și SELECT ca anon dă 42501 (defectul review-ului r3 P1, T2).
// Ieșire: 0 = toate OK (cu --mutant: prins); 1 = CONTRAR; 26 = PROBA NEFUNCȚIONALĂ (prioritar); 22 = altă țintă / altă versiune;
//   23 = jurnalul există deja (starea de plecare nu e „neaplicat”); 2 = argumente; 25 = starea finală diferă de cea de la început (vezi ieșirea).
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const citeste = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const PSQL = process.env.PSQL || 'psql'
const argv = process.argv.slice(2), sep = argv.indexOf('--')
if (sep < 0) { console.error('lipsește „--” urmat de conexiune'); process.exit(2) }
const opt = argv.slice(0, sep), CONN = argv.slice(sep + 1)
const val = (n) => { const i = opt.indexOf(n); return i >= 0 ? opt[i + 1] : null }
const SISTEM = val('--sistem'), MUTANT = val('--mutant')
const MUTANTI = ['fara_recitire', 'fara_coloane', 'blocare_public', 'fara_lock']
if (!/^\d+$/.test(SISTEM || '') || (MUTANT && !MUTANTI.includes(MUTANT))) { console.error(`argumente: --sistem <număr> [--mutant ${MUTANTI.join('|')}]`); process.exit(2) }

// a doua gardă, înainte de orice conexiune: o gazdă Supabase (producția) = refuz, oricare ar fi --sistem
if (CONN.some(x => /supabase\.(co|com)\b/i.test(x)) || /supabase\.(co|com)\b/i.test(process.env.PGHOST || '')) { console.error('refuz: gazda e Supabase (producția); proba rulează doar pe clonă'); process.exit(22) }
const delay = (ms) => new Promise(r => setTimeout(r, ms))
function psql(args, input, app) {
  return new Promise((res) => {
    const p = spawn(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off', ...CONN, ...args],
      { env: { ...process.env, PGCLIENTENCODING: 'UTF8', PGAPPNAME: app }, windowsHide: true })
    let out = '', err = ''
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8')
    p.stdout.on('data', d => { out += d }); p.stderr.on('data', d => { err += d })
    p.on('error', e => res({ code: -1, out, err: err + String(e) }))
    p.on('close', code => res({ code, out, err }))
    p.stdin.end(input ?? '')
  })
}
const q = async (sql, app = 'anon_conc_obs') => {
  const r = await psql(['-t', '-A', '-F', '\t', '-f', '-'], sql, app)
  if (r.code !== 0) throw new Error('interogare picată: ' + r.err.trim())
  return r.out.replace(/\r/g, '').split('\n').filter(Boolean)
}
const caRunner = (nume, text, app) => psql(['-f', '-'], `SET transaction_timeout = 2000;\nBEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);
SELECT set_config('gazpet.plafon_tranzactie', '2000:' || txid_current(), true);
${text}
COMMIT;\n`, app)
async function asteapta(cond, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await delay(40) } return false }
const inSomn = (app) => async () => (await q(`SELECT count(*) FROM pg_stat_activity WHERE application_name = '${app}' AND wait_event = 'PgSleep'`))[0] === '1'
const blocataDe = (b, a) => async () => (await q(`SELECT count(*) FROM pg_stat_activity x, pg_stat_activity y
  WHERE x.application_name = '${b}' AND y.application_name = '${a}' AND y.pid = ANY (pg_blocking_pids(x.pid))`))[0] === '1'
const aplica = (t, lista) => { for (const [din, in_] of lista) { if (!t.includes(din)) throw new Error('textul lipsește: ' + din.slice(0, 80)); t = t.split(din).join(in_) } return t }
const eroare = (r) => (r.err.trim().split('\n').find(l => /ERROR/.test(l)) || r.err.trim()).slice(0, 220)
// numele = schema.nume citate EXPLICIT (ca eticheta din citire / jurnal): c.oid::regclass::text depinde de search_path (pe clonă, cu
// psql, ieșea „x_seq” fără „public.”) și comparația cu SEQ găsea șirul gol (r3)
const INSTANTANEU = `SELECT 'rel ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) || ' ' || x::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, unnest(c.relacl) x WHERE n.nspname = 'public'
  UNION ALL SELECT 'col ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) || '.' || quote_ident(a.attname) || ' ' || x::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid, unnest(a.attacl) x WHERE n.nspname = 'public'
  UNION ALL SELECT 'def ' || d.defaclrole::regrole::text || ' ' || coalesce(d.defaclnamespace::regnamespace::text, '-') || ' ' || d.defaclobjtype::text || ' ' || x::text
    FROM pg_default_acl d, unnest(d.defaclacl) x ORDER BY 1;`
// ordinea liniilor e cea din ORDER BY (ALTER DEFAULT PRIVILEGES rescrie ACL-ul sortat: conținutul contează, nu ordinea din catalog)
const instantaneu = async () => (await q(INSTANTANEU)).join('\n')
// o intrare pentru PUBLIC (aclitem „=…/…”) pe linia cu prefixul dat
const arePublic = (S, prefix) => S.split('\n').some(l => l.startsWith(prefix + ' ='))
const rolSantinela = async () => (await q(`SELECT count(*) FROM pg_roles WHERE rolname LIKE 'gazpet\\_santinela\\_%'`))[0]

const NUME = { a: '20261218a_securitate_anon_drepturi', b: '20261218b_securitate_anon_drepturi_tabele', c: '20261218c_securitate_anon_drepturi_implicite' }
const MIG = { a: citeste('supabase/migrations/20261218a_securitate_anon_drepturi.sql'), b: citeste('supabase/migrations/20261218b_securitate_anon_drepturi_tabele.sql'),
  c: citeste('supabase/migrations/20261218c_securitate_anon_drepturi_implicite.sql') }
const REV = { a: citeste('supabase/revenire/20261218a_securitate_anon_drepturi_ROLLBACK.sql'), b: citeste('supabase/revenire/20261218b_securitate_anon_drepturi_tabele_ROLLBACK.sql'),
  c: citeste('supabase/revenire/20261218c_securitate_anon_drepturi_implicite_ROLLBACK.sql') }
const SOMN_SQL = 'SELECT pg_sleep(1.2);'
// ferestrele: între calcul și blocare (a / b / c), înainte de REVOKE (a / b / c), după postcondiții, înaintea COMMIT-ului (b)
const INJ = { a: '-- ── jurnalul comun al treptelor (neexpus în API, doar postgres) ──',
  b: '-- ── jurnal, blocarea rândurilor + recitirea, apoi UN SINGUR REVOKE pe lista din jurnal + verificarea coloanelor ──',
  c: 'CREATE ROLE gazpet_santinela_20261218c NOLOGIN NOINHERIT;' }
const REV_A_IN = "  EXECUTE 'REVOKE ALL ON SEQUENCE ' || v_lista || ' FROM anon';"
const REV_B_IN = "  EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM anon';"
const REV_C_IN = 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;'
const DUPA_POST_B = 'DROP FUNCTION pg_temp.anon_agregat_20261218b(), pg_temp.anon_regula_20261218b()'
const M_RECITIRE = [["  IF v_dif IS NOT NULL THEN\n    RAISE EXCEPTION '20261218a: schimbare concurenta", "  IF false THEN\n    RAISE EXCEPTION '20261218a: schimbare concurenta"],
  ["  IF v_dif IS NOT NULL THEN\n    RAISE EXCEPTION '20261218a: ACL complet schimbat concurent", "  IF false THEN\n    RAISE EXCEPTION '20261218a: ACL complet schimbat concurent"]]
const M_COLOANE = [['  IF v_col_dupa IS DISTINCT FROM v_col THEN', '  IF false THEN']]
const M_PUBLIC = {
  a: [["  EXECUTE 'REVOKE ALL ON SEQUENCE ' || v_lista || ' FROM gazpet_santinela_20261218a';", "  EXECUTE 'REVOKE ALL ON SEQUENCE ' || v_lista || ' FROM PUBLIC';"]],
  b: [["  EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM gazpet_santinela_20261218b';", "  EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM PUBLIC';"]],
  c: [['ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM gazpet_santinela_20261218c;',
       'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;']],
}
const M_LOCK = [["    EXECUTE 'LOCK TABLE ' || v_lock || ' IN ACCESS SHARE MODE';", '    NULL;']]

const stari = []
const nota = (sc, stare, text) => { stari.push(stare); console.log(`${sc}: ${stare} — ${text}`) }
let curatenie = []   // instrucțiuni de scos drepturile / politicile date de B (rulate și la eroare)
let S0G = null       // drepturile de la început (anon + toate celelalte roluri), comparate la final
let M = null
const scoateCuratenie = async (s) => { await q(s); curatenie = curatenie.filter(x => x !== s) }
const revino = async (k, unde) => { const r = await caRunner(NUME[k] + '_ROLLBACK', REV[k], 'anon_conc_rev'); if (r.code !== 0) throw new Error(`revenirea ${k} ${unde}: ` + r.err.trim()); return r }
const aplicaNormal = async (k) => { const r = await caRunner(NUME[k], M[k], 'anon_conc_A'); if (r.code !== 0) throw new Error(`${k} normal: ` + r.err.trim()); return r }

// R7 (a / b / c): B comite un drept pentru PUBLIC pe o țintă între calcul și blocare. Normal: A refuză și dreptul lui B rămâne.
// Mutant blocare_public: A comite și dreptul lui B dispare (defectul r3)
async function cursaPublic(sc, k, grant, scoate, prefix, Sinainte) {
  if (arePublic(Sinainte, prefix)) { nota(sc, 'PROBA_NEFUNCTIONALA', 'ținta are deja un drept PUBLIC (nu poate fi în treaptă)'); return }
  const A = caRunner(NUME[k], aplica(M[k], [[INJ[k], SOMN_SQL + '\n' + INJ[k]]]), 'anon_conc_A')
  if (!await asteapta(inSomn('anon_conc_A'))) { nota(sc, 'PROBA_NEFUNCTIONALA', 'A nu a ajuns în fereastră'); const a = await A; if (a.code === 0) await revino(k, `după ${sc}`); return }
  curatenie.push(scoate)
  const b = await psql(['-c', grant], null, 'anon_conc_B')
  const inca = await inSomn('anon_conc_A')()
  const a = await A
  const pubDupa = arePublic(await instantaneu(), prefix)
  if (b.code !== 0 || !inca) nota(sc, 'PROBA_NEFUNCTIONALA', `B ${b.code === 0 ? 'a terminat după fereastră' : 'a picat: ' + eroare(b)}`)
  else if (MUTANT === 'blocare_public') nota(sc, a.code === 0 && !pubDupa ? 'OK' : 'CONTRAR', a.code === 0
    ? `mutant: A a comis, dreptul PUBLIC dat de B ${pubDupa ? 'EXISTĂ (defectul nu se vede)' : 'a DISPĂRUT, fără jurnal — DEFECT reprodus, mutant prins'}` : 'mutant: A a refuzat (' + eroare(a) + ')')
  else nota(sc, a.code !== 0 && /schimbare concurenta|ACL complet schimbat concurent/.test(a.err) && pubDupa ? 'OK' : 'CONTRAR',
    a.code !== 0 ? `A refuză: ${eroare(a)}; dreptul PUBLIC al lui B ${pubDupa ? 'rămâne' : 'A DISPĂRUT'}` : 'A A COMIS peste un drept PUBLIC nou')
  if (a.code === 0) await revino(k, `după ${sc}`)
  await scoateCuratenie(scoate)
}

async function main() {
  const [sis, ver] = (await q(`SELECT (SELECT system_identifier::text FROM pg_control_system()), current_setting('server_version_num')`))[0].split('\t')
  if (sis !== SISTEM) { console.error(`ȚINTĂ GREȘITĂ: system_identifier ${sis} ≠ --sistem`); process.exit(22) }
  if (Number(ver) < 170000 || Number(ver) >= 180000) { console.error(`cere PostgreSQL 17 (clona are ${ver})`); process.exit(22) }
  if ((await q(`SELECT to_regnamespace('securitate_intern') IS NOT NULL`))[0] === 't') { console.error('jurnalul există deja: starea de plecare nu e „neaplicat”'); process.exit(23) }
  if (await rolSantinela() !== '0') { console.error('un rol gazpet_santinela_* există deja: starea de plecare nu e curată'); process.exit(23) }
  // citirea clonei -> BASELINE-ul CLONEI în copii
  const cit = await psql(['-t', '-A', '-F', '\t', '-f', '-'], citeste('scripts/anon_drepturi_citire.sql'), 'anon_conc_citire')
  if (cit.code !== 0) throw new Error('citirea a picat: ' + cit.err.trim())
  const linii = cit.out.replace(/\r/g, '').split('\n').map(l => l.split('\t'))
  const bl = (t) => linii.find(f => f[0] === 'BASELINE' && f[1] === t)?.[4]
  M = {
    a: aplica(MIG.a, [["    ('T1', NULL::integer, 'DE_COMPLETAT')", bl('T1')]]),
    b: aplica(MIG.b, [["    ('T2', NULL::integer, 'DE_COMPLETAT')", bl('T2')]]),
    c: aplica(MIG.c, [["    ('T3', NULL::integer, 'DE_COMPLETAT')", bl('T3')]]),
  }
  if (MUTANT === 'fara_recitire') M.a = aplica(M.a, M_RECITIRE)
  if (MUTANT === 'fara_coloane') M.b = aplica(M.b, M_COLOANE)
  if (MUTANT === 'blocare_public') for (const k of 'abc') M[k] = aplica(M[k], M_PUBLIC[k])
  if (MUTANT === 'fara_lock') M.b = aplica(M.b, M_LOCK)
  const t1 = linii.filter(f => f[0] === 'OBIECT' && f[1] === 'T1' && !/anon=[^;]*\*/.test(f[4]))
  const t2 = linii.filter(f => f[0] === 'OBIECT' && f[1] === 'T2' && f[2].startsWith('tabel '))
  const t3 = linii.filter(f => f[0] === 'OBIECT' && f[1] === 'T3' && f[2] === 'implicit postgres public r')
  if (!t1.length || !t2.length || !t3.length) { console.error('PROBA_NEFUNCTIONALA: clona n-are secvențe T1 fără opțiune de acordare, tabele T2 sau implicitul T3 pe tabele'); process.exit(26) }
  const SEQ = t1[0][2].slice('secventa '.length)
  const oids = t2.map(f => /; oid=(\d+);/.exec(f[4])[1]).join(',')
  const [TAB, COL] = ((await q(`SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname), quote_ident(a.attname) FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NULL
   WHERE c.oid IN (${oids}) AND c.relkind = 'r' ORDER BY c.oid, a.attnum LIMIT 1`))[0] || '').split('\t')
  if (!TAB || !COL) { console.error('PROBA_NEFUNCTIONALA: niciun tabel T2 (relkind r) cu o coloană fără drepturi'); process.exit(26) }
  const GRANT_SEQ = `GRANT SELECT ON SEQUENCE ${SEQ} TO anon WITH GRANT OPTION;`
  const SCOATE_SEQ = `REVOKE GRANT OPTION FOR SELECT ON SEQUENCE ${SEQ} FROM anon;`
  const PUB = {
    a: [`GRANT SELECT ON SEQUENCE ${SEQ} TO PUBLIC;`, `REVOKE SELECT ON SEQUENCE ${SEQ} FROM PUBLIC;`, `rel ${SEQ}`],
    b: [`GRANT SELECT ON ${TAB} TO PUBLIC;`, `REVOKE SELECT ON ${TAB} FROM PUBLIC;`, `rel ${TAB}`],
    c: ['ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC;',
        'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT ON TABLES FROM PUBLIC;', 'def postgres public r'],
  }
  console.log(`clona PG ${ver}; ținte: secvența T1 #1, tabelul T2 cu o coloană fără drepturi, implicitul lui postgres pe tabele (numele rămân în ieșirea de pe server)${MUTANT ? '; MUTANT ' + MUTANT : ''}`)
  const S0 = await instantaneu(); S0G = S0
  const jurnalSeq = async () => (await q(`SELECT array_to_string(drepturi, ',') FROM securitate_intern.anon_revocari WHERE migrare = '20261218a' AND eticheta = 'secventa ${SEQ}'`))[0]
  const anonInainte = (S, obj) => S.split('\n').filter(l => l.startsWith(`rel ${obj} anon=`)).map(l => l.slice(`rel ${obj} `.length)).sort().join(',')
  // „așteptat” gol pentru o secvență din T1 e imposibil (T1 = secvențe pe care anon ARE drepturi): sondă greșită, nu verdict (r3)
  const ASTEPTAT_SEQ = anonInainte(S0, SEQ)
  if (!ASTEPTAT_SEQ || !/^anon=[a-zA-Z*]+\/\S+$/.test(ASTEPTAT_SEQ.split(',')[0])) { console.error('PROBA_NEFUNCTIONALA: instantaneul nu are drepturile lui anon pe secvența țintă (format nume / rând)'); process.exit(26) }
  // la fel pentru implicitul T3 (r4): drepturile lui anon din instantaneu = ce trebuie să ajungă în jurnal
  const ASTEPTAT_DEF = S0.split('\n').filter(l => l.startsWith('def postgres public r anon=')).map(l => l.slice('def postgres public r '.length)).sort().join(',')
  if (!ASTEPTAT_DEF) { console.error('PROBA_NEFUNCTIONALA: instantaneul nu are drepturile implicite ale lui anon pe tabele (format rând)'); process.exit(26) }

  // ── R1: B comite între calcul și blocare ──
  if (!MUTANT || MUTANT === 'fara_recitire') {
    const A = caRunner(NUME.a, aplica(M.a, [[INJ.a, SOMN_SQL + '\n' + INJ.a]]), 'anon_conc_A')
    if (!await asteapta(inSomn('anon_conc_A'))) { nota('R1', 'PROBA_NEFUNCTIONALA', 'A nu a ajuns în fereastră'); const a = await A; if (a.code === 0) await revino('a', 'după R1') }
    else {
      curatenie.push(SCOATE_SEQ)
      const b = await psql(['-c', GRANT_SEQ], null, 'anon_conc_B')
      const inca = await inSomn('anon_conc_A')()
      const a = await A
      if (b.code !== 0 || !inca) nota('R1', 'PROBA_NEFUNCTIONALA', `B ${b.code === 0 ? 'a terminat după fereastră' : 'a picat: ' + eroare(b)}`)
      else if (MUTANT === 'fara_recitire') {
        const j = a.code === 0 ? await jurnalSeq() : null
        nota('R1', a.code === 0 && j === ASTEPTAT_SEQ ? 'OK' : 'CONTRAR', a.code === 0 ? `mutant: A a comis, jurnalul secvenței = ${j} (fără dreptul lui B) — DEFECT reprodus, mutant prins` : 'mutant: A a refuzat (' + eroare(a) + ')')
      } else nota('R1', a.code !== 0 && /schimbare concurenta|ACL complet schimbat concurent/.test(a.err) ? 'OK' : 'CONTRAR', a.code !== 0 ? 'A refuză: ' + eroare(a) : 'A A COMIS (fereastra deschisă)')
      if (a.code === 0) await revino('a', 'după R1')
      await scoateCuratenie(SCOATE_SEQ)
    }
    if (await instantaneu() !== S0) throw new Error('după R1 drepturile nu sunt cele de la început')
  }
  if (MUTANT === 'fara_recitire') return
  // ── R7a: B dă un drept lui PUBLIC între calcul și blocare (a) ──
  if (!MUTANT || MUTANT === 'blocare_public') {
    await cursaPublic('R7a', 'a', PUB.a[0], PUB.a[1], PUB.a[2], S0)
    if (await instantaneu() !== S0) throw new Error('după R7a drepturile nu sunt cele de la început')
  }
  // ── R3: B ține deja rândul (necomis) ──
  if (!MUTANT) {
    const B = psql(['-f', '-'], `BEGIN; ${GRANT_SEQ} SELECT pg_sleep(4); ROLLBACK;`, 'anon_conc_B')
    if (!await asteapta(inSomn('anon_conc_B'))) nota('R3', 'PROBA_NEFUNCTIONALA', 'B nu ține rândul')
    else {
      const t0 = Date.now(); const a = await caRunner(NUME.a, M.a, 'anon_conc_A'); const dt = Date.now() - t0
      nota('R3', a.code !== 0 && /lock timeout|lock_timeout|concurrently/i.test(a.err) ? 'OK' : 'CONTRAR', a.code !== 0 ? `A refuză în ${dt} ms: ${eroare(a)}` : 'A A COMIS peste un GRANT în zbor')
      if (a.code === 0) await revino('a', 'după R3')
    }
    await B
    if (await instantaneu() !== S0) throw new Error('după R3 drepturile nu sunt cele de la început')
  }
  // ── R2: B încearcă după blocare (doar fără mutant) / altfel a normal ──
  if (!MUTANT) {
    const A = caRunner(NUME.a, aplica(M.a, [[REV_A_IN, '  PERFORM pg_sleep(1.2);\n' + REV_A_IN]]), 'anon_conc_A')
    if (!await asteapta(inSomn('anon_conc_A'))) { nota('R2', 'PROBA_NEFUNCTIONALA', 'A nu a ajuns în fereastră'); const a = await A; if (a.code !== 0) await aplicaNormal('a') }
    else {
      curatenie.push(SCOATE_SEQ)
      const B = psql(['-c', `SET lock_timeout = '10s'; ${GRANT_SEQ}`], null, 'anon_conc_B')
      const blocata = await asteapta(blocataDe('anon_conc_B', 'anon_conc_A'), 1000)
      const inca = await inSomn('anon_conc_A')()
      const a = await A, b = await B
      const j = a.code === 0 ? await jurnalSeq() : null
      const corect = j === ASTEPTAT_SEQ
      const dupa = (await q(`SELECT has_sequence_privilege('anon', '${SEQ}', 'SELECT WITH GRANT OPTION')`))[0] === 't'
      if (!blocata || !inca) nota('R2', 'PROBA_NEFUNCTIONALA', `B ${blocata ? '' : 'NU '}a fost văzută blocată de A cât A era în fereastră`)
      else if (a.code === 0 && corect && ((b.code !== 0 && /concurrently/.test(b.err)) || (b.code === 0 && dupa)))
        nota('R2', 'OK', `B blocată de A; A comite cu jurnalul exact; B ${b.code !== 0 ? 'pică: ' + eroare(b) : 'trece DUPĂ COMMIT, peste starea nouă (nimic pierdut)'}`)
      else nota('R2', 'CONTRAR', `A cod ${a.code}, jurnal exact ${corect}, B cod ${b.code} (${eroare(b)}), drept B după ${dupa}`)
      if (dupa) await q(SCOATE_SEQ)
      curatenie = curatenie.filter(x => x !== SCOATE_SEQ)
      if (a.code !== 0) await aplicaNormal('a')
    }
  } else await aplicaNormal('a')
  const Sa = await instantaneu()
  if (await rolSantinela() !== '0') throw new Error('după a a rămas un rol-santinelă')
  // ── R4: coloana neblocată ──
  if (!MUTANT || MUTANT === 'fara_coloane') {
    const A = caRunner(NUME.b, aplica(M.b, [[REV_B_IN, '  PERFORM pg_sleep(1.2);\n' + REV_B_IN]]), 'anon_conc_A')
    if (!await asteapta(inSomn('anon_conc_A'))) { nota('R4', 'PROBA_NEFUNCTIONALA', 'A nu a ajuns în fereastră'); const a = await A; if (a.code === 0) await revino('b', 'după R4') }
    else {
      const SCOATE_COL = `REVOKE SELECT (${COL}) ON ${TAB} FROM anon;`
      curatenie.push(SCOATE_COL)
      const B = psql(['-c', `SET lock_timeout = '10s'; GRANT SELECT (${COL}) ON ${TAB} TO anon;`], null, 'anon_conc_B')
      const blocata = await asteapta(blocataDe('anon_conc_B', 'anon_conc_A'), 600)
      const a = await A, b = await B
      const jc = a.code === 0 ? (await q(`SELECT count(*) FROM securitate_intern.anon_revocari j, unnest(j.coloane) c WHERE j.migrare = '20261218b' AND c LIKE '% ${COL.replace(/'/g, "''")} anon=%' AND j.obiect_oid = '${TAB}'::regclass`))[0] : null
      // r3: „0 rânduri în jurnal” singur trece și cu un tipar greșit -> defectul se dovedește și pe instantaneu: dreptul comis de B a dispărut
      const colDupa = a.code === 0 ? (await instantaneu()).split('\n').some(l => l.startsWith(`col ${TAB}.${COL} anon=`)) : null
      if (MUTANT === 'fara_coloane') {
        nota('R4', a.code === 0 && b.code === 0 && jc === '0' && colDupa === false ? 'OK' : 'CONTRAR', a.code === 0 ? `mutant: A a comis, dreptul lui B pe coloană ${colDupa === false ? 'e retras' : 'NU e retras (?)'} fără jurnal (${jc} rânduri) — ${colDupa === false ? 'DEFECT reprodus, mutant prins' : 'defectul nu se vede'}` : 'mutant: A a refuzat (' + eroare(a) + ')')
      } else if (b.code === 0 && !blocata) nota('R4', a.code !== 0 && /coloane schimbate concurent/.test(a.err) ? 'OK' : 'CONTRAR', a.code !== 0 ? 'B neblocată (rând de coloană neblocat, ca în PGlite); A refuză: ' + eroare(a) : 'A A COMIS cu dreptul lui B scos fără jurnal')
      else if (blocata) nota('R4', a.code === 0 && b.code !== 0 ? 'OK' : 'CONTRAR', `B a fost BLOCATĂ (pe PG17 rândul era blocat); A cod ${a.code}, B cod ${b.code}: ${eroare(b)}`)
      else nota('R4', 'PROBA_NEFUNCTIONALA', 'B a picat: ' + eroare(b))
      if (a.code === 0) await revino('b', 'după R4')
      await scoateCuratenie(SCOATE_COL)
    }
    if (await instantaneu() !== Sa) throw new Error('după R4 drepturile nu sunt cele de după a')
  }
  if (MUTANT === 'fara_coloane') return
  // ── R7b: B dă un drept lui PUBLIC între calcul și blocare (b) ──
  if (!MUTANT || MUTANT === 'blocare_public') {
    await cursaPublic('R7b', 'b', PUB.b[0], PUB.b[1], PUB.b[2], Sa)
    if (await instantaneu() !== Sa) throw new Error('după R7b drepturile nu sunt cele de după a')
  }
  // ── R6: B creează o politică pentru anon pe un tabel din T2, după postcondițiile lui A, înaintea COMMIT-ului lui A ──
  if (!MUTANT || MUTANT === 'fara_lock') {
    const A = caRunner(NUME.b, aplica(M.b, [[DUPA_POST_B, SOMN_SQL + '\n' + DUPA_POST_B]]), 'anon_conc_A')
    if (!await asteapta(inSomn('anon_conc_A'))) { nota('R6', 'PROBA_NEFUNCTIONALA', 'A nu a ajuns în fereastră'); const a = await A; if (a.code === 0) await revino('b', 'după R6') }
    else {
      const SCOATE_POL = `DROP POLICY IF EXISTS anon_conc_r6 ON ${TAB};`
      curatenie.push(SCOATE_POL)
      let bGata = false
      const B = psql(['-c', `SET lock_timeout = '10s'; CREATE POLICY anon_conc_r6 ON ${TAB} FOR SELECT TO anon USING (true);`], null, 'anon_conc_B')
      B.then(() => { bGata = true })
      await asteapta(async () => bGata || await blocataDe('anon_conc_B', 'anon_conc_A')(), 1000)
      const blocata = !bGata && await blocataDe('anon_conc_B', 'anon_conc_A')()
      const inca = await inSomn('anon_conc_A')()
      const a = await A, b = await B
      const pol = (await q(`SELECT count(*) FROM pg_policy WHERE polname = 'anon_conc_r6' AND polrelid = '${TAB}'::regclass`))[0]
      const jur = a.code === 0 ? (await q(`SELECT count(*) FROM securitate_intern.anon_revocari WHERE migrare = '20261218b' AND obiect_oid = '${TAB}'::regclass`))[0] : null
      const sel = await psql(['-f', '-'], `BEGIN; SET LOCAL ROLE anon; SELECT 1 FROM ${TAB} LIMIT 0; ROLLBACK;`, 'anon_conc_obs')
      const refuzAnon = sel.code !== 0 && /permission denied/i.test(sel.err)
      if (!inca) nota('R6', 'PROBA_NEFUNCTIONALA', `A nu mai era în fereastră când B ${bGata ? 'a terminat' : 'a fost văzută'}`)
      else if (MUTANT === 'fara_lock') nota('R6', !blocata && b.code === 0 && a.code === 0 && pol === '1' && jur === '1' && refuzAnon ? 'OK' : 'CONTRAR',
        `mutant: B ${blocata ? 'BLOCATĂ (?)' : 'neblocată'} cod ${b.code}, A cod ${a.code}, politica ${pol}, în jurnal ${jur}, SELECT ca anon ${refuzAnon ? '42501' : 'NU e refuzat'}${!blocata && b.code === 0 && a.code === 0 && pol === '1' && jur === '1' && refuzAnon ? ' — DEFECT reprodus, mutant prins' : ''}`)
      else nota('R6', blocata && a.code === 0 && jur === '1' ? 'OK' : 'CONTRAR',
        `B ${blocata ? 'blocată de A (ACCESS SHARE contra ACCESS EXCLUSIVE)' : 'NEBLOCATĂ'}; A cod ${a.code}${a.code !== 0 ? ' (' + eroare(a) + ')' : ''}; B ${b.code === 0 ? 'a creat politica DUPĂ COMMIT-ul lui A' : 'a picat: ' + eroare(b)}`)
      await scoateCuratenie(SCOATE_POL)
      if (a.code === 0) await revino('b', 'după R6')
    }
    if (await instantaneu() !== Sa) throw new Error('după R6 drepturile nu sunt cele de după a')
  }
  if (MUTANT === 'fara_lock') return
  const ms = (r) => (/sfarsit la (\d+) ms/.exec(r?.err || '') || [])[1]
  const durate = {}
  // ── R5: b fără concurență, apoi revenirea, cu duratele ──
  if (!MUTANT) {
    const b5 = await caRunner(NUME.b, M.b, 'anon_conc_A')
    const rb = b5.code === 0 ? await caRunner(NUME.b + '_ROLLBACK', REV.b, 'anon_conc_rev') : null
    const okRev = rb?.code === 0 && await instantaneu() === Sa
    durate.b = ms(b5); durate.rev_b = ms(rb)
    nota('R5', b5.code === 0 && okRev ? 'OK' : 'CONTRAR', `b ${b5.code === 0 ? 'comis' : 'PICAT: ' + eroare(b5)}, revenirea b ${okRev ? 'exactă' : 'NU e exactă'}`)
  }
  // ── R7c: B dă un drept implicit lui PUBLIC între calcul și blocare (c) ──
  await cursaPublic('R7c', 'c', PUB.c[0], PUB.c[1], PUB.c[2], Sa)
  if (await instantaneu() !== Sa) throw new Error('după R7c drepturile nu sunt cele de după a')
  if (MUTANT) return
  // ── R8: c, B încearcă ALTER DEFAULT PRIVILEGES după blocare; apoi revenirea c, cu duratele ──
  {
    const A = caRunner(NUME.c, aplica(M.c, [[REV_C_IN, SOMN_SQL + '\n' + REV_C_IN]]), 'anon_conc_A')
    if (!await asteapta(inSomn('anon_conc_A'))) { nota('R8', 'PROBA_NEFUNCTIONALA', 'A nu a ajuns în fereastră'); const a = await A; if (a.code === 0) await revino('c', 'după R8') }
    else {
      curatenie.push(PUB.c[1])
      const B = psql(['-c', `SET lock_timeout = '10s'; ${PUB.c[0]}`], null, 'anon_conc_B')
      const blocata = await asteapta(blocataDe('anon_conc_B', 'anon_conc_A'), 1000)
      const inca = await inSomn('anon_conc_A')()
      const a = await A, b = await B
      const j = a.code === 0 ? (await q(`SELECT array_to_string(ARRAY(SELECT x FROM unnest(drepturi) x ORDER BY x COLLATE "C"), ',') FROM securitate_intern.anon_revocari WHERE migrare = '20261218c' AND eticheta = 'implicit postgres public r'`))[0] : null
      const asteptat = ASTEPTAT_DEF.split(',').sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)).join(',')
      const pubDupa = arePublic(await instantaneu(), PUB.c[2])
      if (!blocata || !inca) nota('R8', 'PROBA_NEFUNCTIONALA', `B ${blocata ? '' : 'NU '}a fost văzută blocată de A cât A era în fereastră`)
      else if (a.code === 0 && j === asteptat && ((b.code !== 0 && /concurrently/.test(b.err)) || (b.code === 0 && pubDupa)))
        nota('R8', 'OK', `B blocată de A; A comite cu jurnalul exact; B ${b.code !== 0 ? 'pică: ' + eroare(b) : 'trece DUPĂ COMMIT, peste starea nouă (nimic pierdut)'}`)
      else nota('R8', 'CONTRAR', `A cod ${a.code}${a.code !== 0 ? ' (' + eroare(a) + ')' : ''}, jurnal ${j === asteptat ? 'exact' : 'DIFERIT (' + j + ' / ' + asteptat + ')'}, B cod ${b.code} (${eroare(b)}), PUBLIC după ${pubDupa}`)
      if (pubDupa) await q(PUB.c[1])
      curatenie = curatenie.filter(x => x !== PUB.c[1])
      if (a.code === 0) {
        await revino('c', 'după R8')
        const okRev = await instantaneu() === Sa
        nota('R8', okRev ? 'OK' : 'CONTRAR', `revenirea c ${okRev ? 'exactă (drepturile = cele de după a)' : 'NU e exactă'}`)
      }
    }
  }
  if (await rolSantinela() !== '0') nota('R8', 'CONTRAR', 'a rămas un rol-santinelă')
  // ── R9: duratele fără instrumentare (fără pg_sleep): c + revenirea c, revenirea a + a din nou ──
  {
    const c9 = await caRunner(NUME.c, M.c, 'anon_conc_A')
    const rc = c9.code === 0 ? await caRunner(NUME.c + '_ROLLBACK', REV.c, 'anon_conc_rev') : null
    const ra = rc?.code === 0 ? await caRunner(NUME.a + '_ROLLBACK', REV.a, 'anon_conc_rev') : null
    const okA = ra?.code === 0 && await instantaneu() === S0
    const a9 = okA ? await caRunner(NUME.a, M.a, 'anon_conc_A') : null
    Object.assign(durate, { c: ms(c9), rev_c: ms(rc), rev_a: ms(ra), a: ms(a9) })
    const ok = c9.code === 0 && rc?.code === 0 && okA && a9?.code === 0 && await instantaneu() === Sa
    nota('R9', ok ? 'OK' : 'CONTRAR', `c ${c9.code === 0 ? 'comis' : 'PICAT: ' + eroare(c9)}, revenirea c ${rc?.code === 0 ? 'ok' : 'PICATĂ'}, revenirea a ${okA ? 'exactă (= începutul)' : 'NU e exactă / picată'}, a din nou ${a9?.code === 0 ? 'comis' : 'NU'}`)
  }
  console.log(`durate (ms de la BEGIN): ${JSON.stringify(durate)}`)
  for (const [k, v] of Object.entries(durate)) if (Number(v) >= 1500) nota('DURATE', 'CONTRAR', `ABANDON: ${k} a durat ${v} ms (≥ 1500): nu se aplică, se împarte`)
}

let iesire = 0
try { await main() } catch (e) { console.error('EROARE: ' + e.message); iesire = 26 }
finally {
  for (const s of curatenie) { try { await q(s) } catch { /* deja scos */ } }
  try {   // la final: nimic aplicat (reveniri c -> b -> a dacă au rămas rânduri în jurnal), niciun rol-santinelă
    if ((await q(`SELECT to_regnamespace('securitate_intern') IS NOT NULL`))[0] === 't') {
      const m = await q(`SELECT DISTINCT migrare FROM securitate_intern.anon_revocari ORDER BY 1 DESC`)
      for (const x of m) { const k = x.slice(-1); const r = await caRunner(NUME[k] + '_ROLLBACK', REV[k], 'anon_conc_rev'); if (r.code !== 0) { console.error(`revenirea ${k} la final a picat: ${r.err.trim()}`); iesire = 25 } }
    }
    if (S0G !== null && await instantaneu() !== S0G) { console.error('STAREA FINALĂ diferă de cea de la început (drepturi rămase de la probă)'); iesire = 25 }
    if (await rolSantinela() !== '0') { console.error('STAREA FINALĂ: a rămas un rol gazpet_santinela_*'); iesire = 25 }
  } catch (e) { console.error('curățenia finală: ' + e.message); iesire = 25 }
}
if (!iesire) iesire = stari.includes('PROBA_NEFUNCTIONALA') ? 26 : stari.includes('CONTRAR') ? 1 : 0
if (!iesire && !stari.length) iesire = 26   // niciun scenariu judecat = probă nefuncțională, nu „toate OK”
console.log(`rezultat: ${iesire === 0 ? (MUTANT ? 'mutant PRINS' : 'toate OK') : 'cod ' + iesire} (${stari.join(', ')})`)
process.exit(iesire)
