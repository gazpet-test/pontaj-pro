import { assert, assertEquals } from 'jsr:@std/assert@1'
import { caSupabase, categorieEroare, conninfoPsql, EroareConexiune, optiuniDeno, parseazaUrl } from './conexiune.ts'
import { argumenteSigure } from './psql.ts'

const PAROLA = 'S3cr:et/@x'
const URL_BUN = `postgresql://postgres.abc:${encodeURIComponent(PAROLA)}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
const refuz = (url: string) => { try { parseazaUrl(url); return '' } catch (e) { return categorieEroare(e) } }

Deno.test('conexiune: URL bun → gazdă / utilizator / parolă decodată o singură dată; TLS obligatoriu cu CA', async () => {
  const c = parseazaUrl(URL_BUN)
  assertEquals([c.hostname, c.port, c.user, c.password, c.database], ['aws-0-eu-central-1.pooler.supabase.com', 5432, 'postgres.abc', PAROLA, 'postgres'])
  assertEquals(parseazaUrl(URL_BUN + '?sslmode=verify-full').password, PAROLA)
  const { pem, cale } = await caSupabase()
  assert(pem.includes('BEGIN CERTIFICATE') && cale.endsWith('supabase-prod-ca-2021.crt'))
  const o = optiuniDeno(c, pem)
  assertEquals([o.tls.enabled, o.tls.enforce, o.tls.caCertificates.length], [true, true, 1])
})

Deno.test('conexiune: orice sslmode ≠ verify-full (și encodat / dublat) sau alt parametru → refuz', () => {
  for (const q of ['?sslmode=disable', '?sslmode=require', '?sslmode=verify-ca', '?sslmode=%64isable', '?%73slmode=disable',
    '?sslmode=verify-full&sslmode=disable', '?sslrootcert=/x', '?options=-c', '?SSLMODE=disable']) {
    assert(refuz(URL_BUN + q) !== '', q)
  }
  assert(refuz(URL_BUN.replace('postgresql:', 'mysql:')) !== '')
})

Deno.test('conexiune: mesajele de eroare nu conțin NICIODATĂ parola (URL invalid, parolă cu : / @)', () => {
  for (const url of [`postgresql://u:${PAROLA}:tail@h:bad/db`, `postgresql://u:secret/parola@h/db`, `postgresql://u:secret%zz@h/db`,
    `postgresql://u:secret@h:99999/db`, `postgresql://u:secret@/db`, 'nu-e-url secret']) {
    const m = refuz(url)
    assert(m !== '' && !m.includes('secret') && !m.includes('S3cr') && !m.includes('tail'), `${url} → ${m}`)
  }
  // erorile driverului: doar categoria, nu textul brut
  for (const e of [new Error('invalid peer certificate: UnknownIssuer at postgresql://u:secret@h'), new Error('password authentication failed for secret'),
    new Error('connect ECONNREFUSED secret'), new Error('ceva secret')]) {
    assert(!categorieEroare(e).includes('secret'), e.message)
  }
  assert(categorieEroare(new EroareConexiune('x')) === 'x')
})

Deno.test('psql: conninfo cu verify-full + sslrootcert ca cuvinte-cheie, FĂRĂ parolă; argumentele nu pot schimba conexiunea', () => {
  const ci = conninfoPsql(parseazaUrl(URL_BUN), "C:/a b/o'k.crt")
  assert(ci.includes('sslmode=verify-full') && ci.includes(String.raw`sslrootcert='C:/a b/o\'k.crt'`) && !ci.includes('S3cr'))
  assert(argumenteSigure(['-X', '-1', '-v', 'ON_ERROR_STOP=1', '-v', 'manifest=C:/x.csv', '-f', 'aplica.sql']))
  for (const a of [['-h', 'x'], ['-hx'], ['--host=x'], ['-d', 'x'], ['-U', 'x'], ['-p', '1'], ['postgresql://u:p@h/db'], ['host=x sslmode=disable'], ['-v', 'x=1 sslmode=disable']]) {
    assertEquals(argumenteSigure(a), false, JSON.stringify(a))
  }
})
