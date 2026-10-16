// Recitirea valului 1: conexiunea postgres (RV1_PG_URL), comună pentru fereastra.ts (deno-postgres) și psql.ts (psql).
// Regula (16.10): DOAR criptat ȘI verificat cu CA-ul Supabase (verify-full: lanț + nume de gazdă). Fără fallback, fără excepții.
// - URL-ul: postgres:// sau postgresql://, parametrii DECODAȚI; singurul permis e sslmode=verify-full (o dată) — orice altceva → refuz;
// - erorile: mesaje FIXE pe categorii, niciodată eroarea brută (ar putea conține URL-ul cu parola).
export type Conexiune = { hostname: string; port: number; user: string; password: string; database: string }
export class EroareConexiune extends Error {}

export async function caSupabase(): Promise<{ pem: string; cale: string }> {
  const cale = Deno.env.get('RV1_PG_CA') ?? decodeURIComponent(new URL('./supabase-prod-ca-2021.crt', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
  let pem: string
  try { pem = await Deno.readTextFile(cale) } catch { throw new EroareConexiune('CA-ul Supabase nu se poate citi (RV1_PG_CA / supabase-prod-ca-2021.crt)') }
  if (!pem.includes('-----BEGIN CERTIFICATE-----')) throw new EroareConexiune('CA-ul nu e un certificat PEM')
  return { pem, cale }
}

export function parseazaUrl(url: string): Conexiune {
  let u: URL
  try { u = new URL(url) } catch { throw new EroareConexiune('RV1_PG_URL invalid (nu se poate interpreta ca URL)') }
  if (!['postgres:', 'postgresql:'].includes(u.protocol)) throw new EroareConexiune('RV1_PG_URL nu e un URL postgres')
  const chei = [...u.searchParams.keys()]                     // decodate (%73slmode → sslmode)
  if (chei.some((k) => k !== 'sslmode')) throw new EroareConexiune('RV1_PG_URL are parametri nepermiși (doar sslmode=verify-full)')
  const ssl = u.searchParams.getAll('sslmode')               // decodate (%64isable → disable)
  if (ssl.length > 1 || (ssl.length === 1 && ssl[0] !== 'verify-full')) throw new EroareConexiune('RV1_PG_URL cere un sslmode diferit de verify-full')
  let user: string, password: string, database: string
  try { user = decodeURIComponent(u.username); password = decodeURIComponent(u.password); database = decodeURIComponent(u.pathname.slice(1)) || 'postgres' }
  catch { throw new EroareConexiune('RV1_PG_URL are o codificare procentuală invalidă') }
  const port = Number(u.port || 5432)
  if (!u.hostname || !user || !password || !Number.isInteger(port)) throw new EroareConexiune('RV1_PG_URL incomplet (gazdă / utilizator / parolă / port)')
  return { hostname: u.hostname, port, user, password, database }
}

// opțiunile deno-postgres: TLS activ și OBLIGATORIU, verificat cu CA-ul (numele de gazdă e verificat de Deno.startTls)
export const optiuniDeno = (c: Conexiune, caPem: string) => ({ ...c, tls: { enabled: true, enforce: true, caCertificates: [caPem] } })

// argumentele psql: șirul de conexiune cu cuvinte-cheie (au prioritate față de PGSSLMODE / PGSSLROOTCERT din mediu și nu se pot
// suprascrie din URL), fără parolă — parola merge DOAR în mediul procesului copil (PGPASSWORD), nu în linia de comandă
const citat = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
export function conninfoPsql(c: Conexiune, caleCa: string): string {
  return [`host=${citat(c.hostname)}`, `port=${c.port}`, `user=${citat(c.user)}`, `dbname=${citat(c.database)}`, `sslmode=verify-full`,
    `sslrootcert=${citat(caleCa)}`].join(' ')
}

// categoria unei erori de conectare — mesaj FIX, fără textul erorii originale
export function categorieEroare(e: unknown): string {
  if (e instanceof EroareConexiune) return e.message
  const n = e instanceof Error ? `${e.name} ${e.message}` : ''
  if (/certificate|tls|ssl|handshake|UnknownIssuer/i.test(n)) return 'TLS: certificatul serverului nu se verifică cu CA-ul Supabase'
  if (/password|authentication|tenant|user .* not found|28P01|28000/i.test(n)) return 'autentificare eșuată'
  if (/ENOTFOUND|ECONNREFUSED|timed out|network|dns/i.test(n)) return 'rețea: serverul nu răspunde'
  return 'eroare de conectare (detaliile nu se afișează: pot conține date de autentificare)'
}
