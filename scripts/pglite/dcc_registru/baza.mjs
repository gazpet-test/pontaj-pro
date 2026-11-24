// Proba PGlite a migrării 20270108a (registrul DCC) — nucleul comun: baza falsă (schelet + lanțul de drept extras EXACT din 20261209a +
// identitățile sintetice), aplicarea ca runnerul (marcaj + plafonul EXTINS + pasul „înainte” L15 v2 generat de scripts/livrare_amprenta_gen.sh),
// instantaneele bazei (dumpDataDir: fiecare bloc pornește de pe o copie curată), apelurile ca rol / cont și sondele în sub-blocuri anulate.
// NU atinge nicio bază reală.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
export const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
export const exista = rel => existsSync(join(ROOT, rel))
export const NUME = '20270108a_executie_dcc_registru'
export const CALE_MIG = `supabase/migrations/${NUME}.sql`
export const CALE_REV = `supabase/revenire/${NUME}_ROLLBACK.sql`
export const SCHELET = citeste(`supabase/tests/${NUME}_schelet.sql`)
export const M09 = citeste('supabase/migrations/20261209a_executie_acces_proiect.sql')
export const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
export const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex')
export const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
export const lit = s => (s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`)
export const jlit = o => `${lit(JSON.stringify(o))}::jsonb`

// ── lanțul de drept, EXACT ca în 20261209a (corpul + ACL-urile); amprentele = constantele din migrare ──
function functie(text, cap) {
  const i = text.indexOf(cap)
  if (i < 0) throw new Error('nu găsesc ' + cap)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(text.slice(i))
  const startCorp = i + a.index + a[0].length
  const sfarsit = text.indexOf(';', text.indexOf(a[1], startCorp) + a[1].length) + 1
  return text.slice(i, sfarsit).replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION')
}
const acl = (text, nume) => text.split('\n').filter(l => /^(REVOKE|GRANT) /.test(l) && l.includes('ON FUNCTION public.' + nume + '(')).join('\n')
export const LANT = [
  ['fn_executie_acces_nerestrans_cont', 'CREATE FUNCTION public.fn_executie_acces_nerestrans_cont(', '9a07e0089139e54ba5c6a0cfaaf093cc'],
  ['fn_executie_acces_lista_cont', 'CREATE FUNCTION public.fn_executie_acces_lista_cont(', 'e7cf9b852002a1c1cbe781772c33bf0c'],
  ['fn_executie_acces_nerestrans', 'CREATE FUNCTION public.fn_executie_acces_nerestrans()', 'b863c5324684dbf4eb9af81474fbc4e1'],
  ['fn_executie_acces_lista', 'CREATE FUNCTION public.fn_executie_acces_lista(', 'd9e123a46b83530a7203d4a24da5cf9b'],
  ['fn_executie_proiect_permis', 'CREATE FUNCTION public.fn_executie_proiect_permis(', 'bd4320f76e9f36f492c7186c0a982155'],
]
export function sqlLant() {
  let s = ''
  const amprente = []
  for (const [nume, cap, amp] of LANT) {
    const f = functie(M09, cap)
    const corp = f.slice(f.indexOf('$f$') + 3, f.lastIndexOf('$f$'))
    amprente.push([nume, md5(corp), amp])
    s += f + '\n' + acl(M09, nume) + '\n'
  }
  s += `CREATE POLICY executie_acces_proiect_citire ON public.executie_proiecte AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT public.fn_executie_acces_nerestrans()) OR public.fn_executie_proiect_permis(id::bigint, false));\n`
  return { sql: s, amprente }
}

// ── plafonul: aceeași valoare ca runnerul (AG_PLAFON_EXTINS_MS) ──
export const PLAFON_LIVRARE = Number(execFileSync('bash', ['-c', '. "$1"; printf %s "$AG_PLAFON_EXTINS_MS"', '_', join(ROOT, 'scripts/livrare_amprenta.sh')], { encoding: 'utf8' }))
export const PLAFON_REVENIRE = 2000

// ── conturile (uuid-uri sintetice) și proiectele Execuție ──
export const U = {
  OWNER: '00000000-0000-4000-8000-000000000001',
  L1: '00000000-0000-4000-8000-000000000002',      // executie_dcc editor, restrâns prin executie_acces_proiect la proiectul Execuție 1 (P1)
  ED: '00000000-0000-4000-8000-000000000003',      // executie_dcc editor, nerestrâns
  ED2: '00000000-0000-4000-8000-000000000004',     // al doilea editor (alt utilizator, aceeași cheie)
  VIEW: '00000000-0000-4000-8000-000000000005',    // executie_dcc viewer
  ADM: '00000000-0000-4000-8000-000000000006',     // executie_dcc admin
  EXEC: '00000000-0000-4000-8000-000000000007',    // doar executie admin (fără executie_dcc)
  FARA: '00000000-0000-4000-8000-000000000008',    // niciun drept
  L1V: '00000000-0000-4000-8000-000000000009',     // executie_dcc editor, restrâns la P1 DOAR viewer (nivelul pe proiect)
}
export const IDENTITATI = `
INSERT INTO public.profiles (id, name, is_owner) VALUES
  ('${U.OWNER}', 'OWNER', true), ('${U.L1}', 'L1', false), ('${U.ED}', 'ED', false), ('${U.ED2}', 'ED2', false), ('${U.VIEW}', 'VIEW', false),
  ('${U.ADM}', 'ADM', false), ('${U.EXEC}', 'EXEC', false), ('${U.FARA}', 'FARA', false), ('${U.L1V}', 'L1V', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  ('${U.L1}', 'executie_dcc', 'editor'), ('${U.L1}', 'executie', 'editor'), ('${U.ED}', 'executie_dcc', 'editor'), ('${U.ED2}', 'executie_dcc', 'editor'),
  ('${U.VIEW}', 'executie_dcc', 'viewer'), ('${U.ADM}', 'executie_dcc', 'admin'), ('${U.EXEC}', 'executie', 'admin'), ('${U.FARA}', 'hr', 'admin'),
  ('${U.L1V}', 'executie_dcc', 'editor');
INSERT INTO public.executie_proiecte (id, cod_intern, nume) VALUES (1, 'E1', 'Proiect unu'), (2, 'E2', 'Proiect doi'), (3, 'E3', 'Proiect trei'),
  (4, 'E4', 'Proiect patru'), (5, 'E5', 'Proiect cinci'), (6, 'E6', 'Proiect sase'), (9, 'E9', 'Proiect noua');
SELECT setval(pg_get_serial_sequence('public.executie_proiecte', 'id'), 100);
INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES ('${U.L1}', 1, 'editor'), ('${U.L1V}', 1, 'viewer');`

export async function bazaGoala() {
  const db = new PGlite()
  await db.exec(SCHELET)
  await db.exec(sqlLant().sql)
  await db.exec(IDENTITATI)
  return db
}
export async function dinInstantaneu(blob) {
  const db = new PGlite({ loadDataDir: blob })
  await db.waitReady
  return db
}

// PGlite rulează într-un singur proces: pg_backend_pid() = 0, iar pg_locks.pid = NULL (pg_lock_status pune NULL când pid-ul e 0). Predicatul
// „lock-ul MEU” al migrării (l.pid = pg_backend_pid()) devine, DOAR în copia aplicată pe PGlite, forma echivalentă care vede și pid-ul nul.
// Singura substituție permisă; numărul aparițiilor e raportat de probă (pe PG real textul migrării rulează neschimbat).
export const PID_REAL = 'l.pid = pg_backend_pid()'
export const PID_PGLITE = 'l.pid IS NOT DISTINCT FROM nullif(pg_backend_pid(), 0)'
export const pentruPglite = text => ({ text: text.split(PID_REAL).join(PID_PGLITE), aparitii: text.split(PID_REAL).length - 1 })

// ca runnerul: plafon + marcaje + pasul „înainte” L15 v2 (l15: 'inainte' | 'nimic'); final = COMMIT / ROLLBACK
export async function caRunner(db, nume, text, { plafon = PLAFON_LIVRARE, marcajPlafon = true, marcaj = true, l15 = 'inainte', final = 'COMMIT' } = {}) {
  const pre = plafon ? `SET transaction_timeout = ${plafon};` : 'SET transaction_timeout = 0;'
  const mp = marcajPlafon ? `SELECT set_config('gazpet.plafon_tranzactie', '${plafon}:' || txid_current(), true);` : ''
  const mk = marcaj ? `SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);` : ''
  const T = randomBytes(8).toString('hex')
  const ina = l15 === 'nimic' ? '' : gen('inainte', T, '-')
  const jurnal = []
  try {
    await db.exec(pre)
    await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED; ${mk} ${mp}`)
    await db.exec(ina + '\n' + text + '\n;\n', { onNotice: n => jurnal.push(n.message) })
    await db.exec(final, { onNotice: n => jurnal.push(n.message) })
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } e.jurnal = jurnal; throw e } finally { await db.exec('SET transaction_timeout = 0;') }
  return jurnal
}

// o instrucțiune ca rolul dat, cu JWT-ul contului (COMMIT la succes, ca un apel PostgREST). sesiune = 'authenticator' simulează calea API.
// sesiune = 'authenticator' simulează calea API (session_user = authenticator). PGlite NU revine singur din SET [LOCAL] SESSION AUTHORIZATION
// (nici la COMMIT, nici la RESET): după apel sesiunea se readuce EXPLICIT la postgres (verificat de p_d5_identitati la fiecare pas).
export async function ca(db, rol, uid, sql, { sesiune = null, params = [] } = {}) {
  await db.exec('BEGIN')
  try {
    if (sesiune) await db.exec(`SET LOCAL SESSION AUTHORIZATION ${sesiune}`)
    if (rol) await db.exec(`SET LOCAL ROLE ${rol}`)
    if (uid) await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid}', true)`)
    const r = await db.query(sql, params)
    await db.exec('COMMIT')
    return { rows: r.rows }
  } catch (e) {
    await db.exec('ROLLBACK')
    return { code: e.code, message: e.message, constraint: e.constraint }
  } finally {
    if (sesiune) await db.exec('SET SESSION AUTHORIZATION postgres')
  }
}

// sondă într-un sub-bloc ANULAT, ca postgres; replica = triggerele USER (și cele RI) oprite, CHECK / UNIQUE / NOT NULL lovesc la fel
export async function sonda(db, sqls, { replica = false } = {}) {
  await db.exec('BEGIN')
  try {
    if (replica) await db.exec('SET LOCAL session_replication_role = replica')
    let r
    for (const s of [].concat(sqls)) r = await db.query(s)
    return { rows: r.rows }
  } catch (e) {
    return { code: e.code, message: e.message, constraint: e.constraint }
  } finally {
    await db.exec('ROLLBACK')
  }
}
export const n = async (db, sql) => Number((await db.query(sql)).rows[0].n)

// ── colectorul de abateri al unui bloc ──
export function abateri() {
  const ab = []
  const f = {
    ab,
    ok: (cond, ce) => { if (!cond) ab.push(ce) },
    cod: (r, cod, ce, { re = null, constrangere = null } = {}) => {
      if (!r.code) ab.push(`${ce}: a trecut (aștepta ${cod}${constrangere ? ' ' + constrangere : ''}${re ? ' ' + re : ''})`)
      else if (r.code !== cod || (re && !re.test(r.message)) || (constrangere && r.constraint !== constrangere)) {
        ab.push(`${ce}: ${r.code} ${r.constraint || ''} ${r.message} (aștepta ${cod} ${constrangere || ''} ${re || ''})`)
      }
    },
    trece: (r, ce) => { if (r.code) { ab.push(`${ce}: ${r.code} ${r.constraint || ''} ${r.message}`); return null } return r.rows },
  }
  return f
}
