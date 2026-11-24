// Aplicarea prin FIȘIERELE REALE ale runnerului (scripts/livrare_migrare.sh --genereaza-in, cod 40, nicio conexiune), pe PGlite, în ordinea
// tranzacției reale: 00_sesiune (SET transaction_timeout) -> BEGIN -> 0_prolog -> 1_pre (lock-ul consultativ + citirea istoricului) ->
// 2_ag_inainte (livrare_amprenta_gen.sh inainte <T> -) -> COPIA migrării -> 3_inreg (INSERT în istoric) -> COMMIT. 1a_fereastra (ora) și garda
// finală țin de ceas / sesiune și au testele lor în scripts/test_livrare_*. Substituțiile PGlite, singurele, raportate: predicatul pid-ului
// (pentruPglite) și, DOAR dacă PGlite n-are pg_control_system(), linia system_identifier din 1_pre.sql (text exact, o apariție).
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { ROOT, gen, pentruPglite } from './baza.mjs'

const LUCRU = join(ROOT, '.tmp', 'dcc_runner')
export function genereaza(caleMig, versiune, sistem, { plafon = 15000, extins = true, tintaDb = 'postgres' } = {}) {
  mkdirSync(LUCRU, { recursive: true })
  const dir = join(LUCRU, 'g_' + randomBytes(6).toString('hex'))
  const sha = createHash('sha256').update(readFileSync(join(ROOT, caleMig))).digest('hex')
  const args = [join(ROOT, 'scripts/livrare_migrare.sh'), '--migrare', caleMig, '--sha256', sha, '--versiune', versiune, '--tinta-db', tintaDb,
    '--tinta-sistem', sistem, '--tinta-host', 'localhost', '--tinta-port', '5432', '--user', 'postgres', '--plafon-tranzactie-ms', String(plafon),
    ...(extins ? ['--plafon-extins'] : []), '--genereaza-in', dir]
  const r = spawnSync('bash', args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PSQL_BIN: '/nu/se/foloseste' } })
  if (r.status !== 40) throw new Error(`runnerul --genereaza-in: cod ${r.status} ${(r.stdout + r.stderr).slice(-600)}`)
  const nume = caleMig.split('/').pop().replace(/\.sql$/, '')
  const f = n => readFileSync(join(dir, n), 'utf8').replace(/\r/g, '')
  const fis = { dir, prolog: f('0_prolog.sql'), pre: f('1_pre.sql'), inreg: f('3_inreg.sql'), copie: f(nume + '.sql') }
  return fis
}
export const curata = () => { if (existsSync(LUCRU)) rmSync(LUCRU, { recursive: true, force: true }) }

export async function areControlSystem(db) {
  try { await db.query('SELECT system_identifier FROM pg_control_system()'); return true } catch { return false }
}
export async function sistemPglite(db) {
  try { return String((await db.query('SELECT system_identifier::text AS s FROM pg_control_system()')).rows[0].s) } catch { return null }
}
// ținta bazei PGlite (numele bazei conectate + system_identifier), ca parametrii --tinta-db / --tinta-sistem ai runnerului
export async function tintaPglite(db) {
  return { tintaDb: (await db.query('SELECT current_database() AS d')).rows[0].d, sistem: (await sistemPglite(db)) || '7000000000000000001' }
}

// rulează fișierele generate; l15 = true adaugă pasul „înainte”; copie = textul migrării (implicit copia runnerului); întoarce notițele
export async function prinRunner(db, fis, { l15 = true, copie = null, faraPost = false, dupaInainte = '', final = 'COMMIT', plafon = null } = {}) {
  const pl = plafon ?? Number(/'([0-9]+)\/session'/.exec(fis.prolog)[1])
  let pre = fis.pre
  const subst = []
  if (!(await areControlSystem(db))) {
    const linie = pre.split('\n').find(l => l.includes('FROM pg_control_system()'))
    if (!linie || pre.split(linie).length !== 2) throw new Error('PGLITE_FARA_CONTROL_SYSTEM: linia system_identifier nu apare exact o dată')
    pre = pre.replace(linie, linie.replace('(SELECT system_identifier::text FROM pg_control_system())', "'" + /'([0-9]+)'/.exec(linie)[1] + "'"))
    subst.push('system_identifier')
  }
  let text = copie ?? fis.copie
  if (faraPost) {
    const m = '\n-- ─── 7. '
    if (text.split(m).length !== 2) throw new Error('marcajul secțiunii 7 nu apare exact o dată')
    text = text.slice(0, text.indexOf(m)) + '\nDROP FUNCTION pg_temp.lant_20270108a(text);\n'
  }
  const P = pentruPglite(text)
  const jurnal = []
  const T = randomBytes(8).toString('hex')
  try {
    await db.exec(`SET transaction_timeout = ${pl};`)
    await db.exec('BEGIN')
    await db.exec(fis.prolog + '\n' + pre + '\n' + (l15 ? gen('inainte', T, '-') : '') + '\n' + dupaInainte + '\n' + P.text + '\n;\n' + fis.inreg, { onNotice: n => jurnal.push(n.message) })
    await db.exec(final)
  } catch (e) {
    try { await db.exec('ROLLBACK') } catch { /* deja anulată */ }
    e.jurnal = jurnal; e.subst = subst; throw e
  } finally { await db.exec('SET transaction_timeout = 0;') }
  return { jurnal, subst, pid: P.aparitii }
}
