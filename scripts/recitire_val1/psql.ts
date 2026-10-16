// Recitirea valului 1: psql DOAR prin acest wrapper (README). Construiește conexiunea din RV1_PG_URL cu sslmode=verify-full +
// sslrootcert=CA-ul Supabase ca CUVINTE-CHEIE ale conexiunii (prioritate față de mediu; URL-ul nu ajunge niciodată la psql); parola
// merge doar în mediul procesului psql (PGPASSWORD).
//   deno run -A scripts/recitire_val1/psql.ts -X -1 -v ON_ERROR_STOP=1 -f scripts/recitire_val1/pas0.sql
// Argumentele permise (listă ALBĂ, structurală — orice altceva, inclusiv forme grupate ca „-Xd…”, -c, -h, -d, -U, -p, URL-uri → refuz):
//   -X · -1 · -q · -v NUME=VALOARE · -f <unul din cele 6 scripturi, cale exactă> (OBLIGATORIU, o singură dată)
// Wrapper-ul pune singur -X (fără ~/.psqlrc) și închide stdin (fără comenzi interactive, deci fără \connect).
// Ieșire: codul lui psql; 2 = refuzat înainte de psql SAU conexiune eșuată (mesaj fix pe categorie, fără textul libpq).
import { caSupabase, categorieEroare, conninfoPsql, parseazaUrl } from './conexiune.ts'

const DIR_SCRIPTURI = decodeURIComponent(new URL('.', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const normal = (p: string) => p.replace(/\\/g, '/').toLowerCase()
const SCRIPTURI = ['pas0.sql', 'aplica.sql', 'aplica_rezultat.sql', 'verifica.sql', 'revino.sql', 'revino_rezultat.sql']

// validarea STRUCTURALĂ a argumentelor: fiecare element e o opțiune permisă sau valoarea opțiunii dinainte
export function argumenteSigure(args: string[], dirScripturi = DIR_SCRIPTURI): boolean {
  // un script al procedurii e OBLIGATORIU (fără -f, psql ar citi comenzi — inclusiv \connect — din stdin)
  if (args.filter((a) => a === '-f').length !== 1) return false
  const aprobate = new Set(SCRIPTURI.map((n) => normal(`${dirScripturi.replace(/[\\/]+$/, '')}/${n}`)))
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-X' || a === '-1' || a === '-q') continue
    if (a === '-v') {
      const v = args[++i]
      if (v === undefined || !/^[A-Za-z_][A-Za-z0-9_]*=/.test(v)) return false
      continue
    }
    if (a === '-f') {
      const f = args[++i]
      if (f === undefined || f.startsWith('-') || !/\.sql$/i.test(f)) return false
      // fișierul: DOAR un script al procedurii (nu se poate da un fișier cu \connect)
      const abs = normal(f.match(/^([A-Za-z]:|\/)/) ? f : `${Deno.cwd()}/${f}`)
      if (/(^|\/)\.\.(\/|$)/.test(abs)) return false                  // fără „..” (ieșirea din director)
      // cale EXACTĂ: unul din cele șase scripturi, chiar în directorul procedurii (nu un subdirector cu același nume de fișier)
      if (!aprobate.has(abs.replace(/\/\.\//g, '/').replace(/\/{2,}/g, '/'))) return false
      continue
    }
    return false
  }
  return true
}

// erorile psql: o eroare de CONECTARE (libpq) → doar categoria; restul (SQL, RAISE din scripturi) se arată neschimbat
export function stderrSigur(stderr: string): { conexiune: boolean; text: string } {
  if (/^psql: error: (connection to server|could not|.*SSL|.*certificate)/m.test(stderr)) {
    const t = /SSL|certificate/i.test(stderr) ? 'TLS: certificatul serverului nu se verifică cu CA-ul Supabase'
      : /password|authentication|tenant|role .* does not exist/i.test(stderr) ? 'autentificare eșuată'
      : 'rețea / server: conexiunea a eșuat'
    return { conexiune: true, text: `ATENȚIE [2] psql: ${t}` }
  }
  return { conexiune: false, text: stderr }
}

if (import.meta.main) {
  try {
    const url = Deno.env.get('RV1_PG_URL'); if (!url) throw new Error('lipsește RV1_PG_URL')
    const c = parseazaUrl(url)
    const { cale } = await caSupabase()
    if (!argumenteSigure(Deno.args)) throw new Error('argumente nepermise pentru psql (doar -X -1 -q -v NUME=… -f <script al procedurii>)')
    const env: Record<string, string> = { PGPASSWORD: c.password, PGSSLMODE: 'verify-full', PGSSLROOTCERT: cale }
    // executabilul: RV1_PSQL (pe serverul AI: C:/Users/Public/pgsql/bin/psql.exe), altfel „psql” din PATH
    const bin = Deno.env.get('RV1_PSQL') || 'psql'
    let rez: Deno.CommandOutput
    try {
      // -X impus de wrapper (fără ~/.psqlrc), stdin ÎNCHIS (nicio comandă — \connect — nu poate veni pe stdin)
      rez = await new Deno.Command(bin, { args: ['-X', '-d', conninfoPsql(c, cale), ...Deno.args], env, stdin: 'null', stdout: 'inherit', stderr: 'piped' }).output()
    } catch (e) {
      throw new Error(e instanceof Deno.errors.NotFound ? `psql nu se găsește (${bin}); setează RV1_PSQL` : 'psql nu se poate porni')
    }
    const s = stderrSigur(new TextDecoder().decode(rez.stderr))
    if (s.text) console.error(s.text.trimEnd())
    Deno.exit(s.conexiune ? 2 : rez.code)
  } catch (e) {
    const sigur = e instanceof Error && /^(argumente nepermise|lipsește RV1_PG_URL|psql nu se)/.test(e.message)   // mesaje proprii, fără date de autentificare
    console.error(`ATENȚIE [2] psql nepornit: ${sigur ? (e as Error).message : categorieEroare(e)}`)
    Deno.exit(2)
  }
}
