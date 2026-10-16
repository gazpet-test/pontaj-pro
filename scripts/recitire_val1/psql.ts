// Recitirea valului 1: psql DOAR prin acest wrapper (README). Construiește conexiunea din RV1_PG_URL cu sslmode=verify-full +
// sslrootcert=CA-ul Supabase ca CUVINTE-CHEIE ale conexiunii (prioritate față de mediu, nesuprascriibile din URL); parola merge doar
// în mediul procesului psql (PGPASSWORD). Toate celelalte argumente trec neschimbate la psql.
//   deno run -A scripts/recitire_val1/psql.ts -X -1 -v ON_ERROR_STOP=1 -f scripts/recitire_val1/pas0.sql
// Ieșire: codul lui psql; 2 = conexiune refuzată înainte de psql (mesaj fix, fără date de autentificare).
import { caSupabase, categorieEroare, conninfoPsql, parseazaUrl } from './conexiune.ts'

// argumentele date de apelant nu pot schimba conexiunea (altă gazdă, bază, utilizator, port, URL sau șir de conexiune)
export const argumenteSigure = (args: string[]) => !args.some((a) =>
  /^(-d|--dbname|-h|--host|-U|--username|-p|--port)(=.*)?$/.test(a) || /^-[dhUp]./.test(a) || /^postgres(ql)?:\/\//i.test(a) || /(^|\s)(host|hostaddr|sslmode|sslrootcert|dbname|user|port|service)=/.test(a))

if (import.meta.main) {
  try {
    const url = Deno.env.get('RV1_PG_URL'); if (!url) throw new Error('lipsește RV1_PG_URL')
    const c = parseazaUrl(url)
    const { cale } = await caSupabase()
    if (!argumenteSigure(Deno.args)) throw new Error('argumentele psql nu pot schimba conexiunea (gazdă / bază / utilizator / port / URL)')
    const env: Record<string, string> = { PGPASSWORD: c.password, PGSSLMODE: 'verify-full', PGSSLROOTCERT: cale }
    // executabilul: RV1_PSQL (pe serverul AI: C:/Users/Public/pgsql/bin/psql.exe), altfel „psql” din PATH
    const bin = Deno.env.get('RV1_PSQL') || 'psql'
    let cod: number
    try {
      cod = (await new Deno.Command(bin, { args: ['-d', conninfoPsql(c, cale), ...Deno.args], env, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' }).output()).code
    } catch (e) {
      throw new Error(e instanceof Deno.errors.NotFound ? `psql nu se găsește (${bin}); setează RV1_PSQL` : 'psql nu se poate porni')
    }
    Deno.exit(cod)
  } catch (e) {
    const sigur = e instanceof Error && /^(argumentele|lipsește RV1_PG_URL|psql nu se)/.test(e.message)   // mesaje proprii, fără date de autentificare
    console.error(`ATENȚIE [2] psql nepornit: ${sigur ? (e as Error).message : categorieEroare(e)}`)
    Deno.exit(2)
  }
}
