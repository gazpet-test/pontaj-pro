// Unealtă de lucru (nu test): aplică 20261212a pe PGlite ca runnerul și tipărește amprentele md5 (replace(prosrc, chr(13), '')) ale celor 19
// funcții fn_red_fan_*, cu proprietățile lor — constantele pe care 20261228a le verifică ÎNAINTE de CREATE OR REPLACE și revenirea DUPĂ.
// Rulare: node scripts/pglite/_fan_amprente_20261212a.mjs
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LOCAL_PGLITE = join(ROOT, '.tmp', 'pglite', 'node_modules', '@electric-sql', 'pglite')
const { PGlite } = await import(existsSync(LOCAL_PGLITE) ? pathToFileURL(join(LOCAL_PGLITE, 'dist', 'index.js')).href : '@electric-sql/pglite')
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const SCHELET = citeste('supabase/tests/20261212a_redari_fan_awb_schelet.sql')
const MIG = citeste('supabase/migrations/20261212a_redari_fan_awb.sql')
const M26 = citeste('supabase/migrations/20261126a_redari_teren.sql')
const NIVEL = (() => {
  const i = M26.indexOf('CREATE FUNCTION public.fn_red_nivel() RETURNS text')
  const j = M26.indexOf('$fn$;', M26.indexOf('$fn$', i) + 4) + 5
  return M26.slice(i, j) + '\nREVOKE EXECUTE ON FUNCTION public.fn_red_nivel() FROM PUBLIC, anon, authenticated, service_role;\n'
    + 'GRANT EXECUTE ON FUNCTION public.fn_red_nivel() TO authenticated, service_role;\n'
})()
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const db = new PGlite()
await db.exec(SCHELET)
await db.exec(NIVEL)
const T = randomBytes(8).toString('hex')
await db.exec('SET transaction_timeout = 5000;')
await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED; SELECT set_config('gazpet.livrare_migrare', '20261212a_redari_fan_awb:' || txid_current(), true); SELECT set_config('gazpet.plafon_tranzactie', '5000:' || txid_current(), true);`)
await db.exec(gen('inainte', T, '-') + '\n' + MIG + '\n;')
await db.exec('COMMIT')
await db.exec('SET transaction_timeout = 0;')
const r = await db.query(`SELECT p.oid::regprocedure::text AS sig, md5(replace(p.prosrc, chr(13), '')) AS amprenta, l.lanname AS limbaj, p.prosecdef AS definer, p.provolatile AS vol,
    p.prorettype::regtype::text AS intoarce, coalesce(p.proacl, acldefault('f', p.proowner))::text AS acl
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\\_red\\_fan\\_%' ORDER BY 1`)
for (const x of r.rows) console.log(`('${x.sig}', '${x.amprenta}', '${x.limbaj}', ${x.definer}, '${x.vol}', '${x.intoarce}', '${x.acl}'),`)
await db.close()
