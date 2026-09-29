import { caleSandbox } from './siguranta.js'
import { incident } from './politica-p2.js'

// Allowlist minimă pentru lotul J06: o singură tentativă de scriere demonstrată.
// Alte RPC/Edge/uploaduri rămân blocate până la contracte de endpoint verificate.
export function verificaCerere(request, { apiUrl, accessToken, phase }) {
  const u = new URL(request.url)
  if (u.origin !== new URL(apiUrl).origin) throw incident('BYPASS', 'endpoint: cerere externă neautorizată')
  const bearer = Object.entries(request.headers || {}).find(([k]) => k.toLowerCase() === 'authorization')?.[1]
  if (bearer !== `Bearer ${accessToken}`) throw incident('BYPASS', 'permisiune: identitatea cererii diferă de JWT-ul fix')
  if (/^\/rest\/v1\/[a-z_]+$/.test(u.pathname) && request.method === 'GET') return true
  if (u.pathname.startsWith('/storage/v1/object/')) {
    // Decodarea URL nu poate ascunde traversări ori prefixul pt/103.
    const match = u.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/)
    try { if (!match) throw Error(); caleSandbox(match[2]) } catch { throw incident('OUT_OF_SCOPE', 'Storage: cale în afara 103/') }
    if (request.method === 'GET') return true
    throw incident('BYPASS', 'endpoint: scriere Storage fără contract activ implementat')
  }
  if (request.method === 'PATCH' && u.pathname === '/rest/v1/ofertare_licitatii') {
    if (u.searchParams.getAll('id').length !== 1 || u.searchParams.get('id') !== 'eq.103'
      || [...u.searchParams.keys()].some(k => !['id', 'select'].includes(k))) throw incident('OUT_OF_SCOPE', 'DB: PATCH nu este strict id=103')
    let body
    try { body = JSON.parse(request.postData) } catch { throw incident('BYPASS', 'endpoint: corp PATCH absent/invalid') }
    if (phase.external_effect !== 'db' || !phase.refuz_server || JSON.stringify(body) !== '{"status":"depusa"}')
      throw incident('BYPASS', 'DB: scriere în afara tentativei autorizate')
    return true
  }
  throw incident('BYPASS', 'endpoint: RPC/Edge/SEAP/email/webhook/cron sau metodă fără contract de izolare')
}
