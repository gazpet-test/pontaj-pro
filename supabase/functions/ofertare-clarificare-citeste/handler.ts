// ofertare-clarificare-citeste — Răzvan 07.09.2026: clarificările încărcate MANUAL (PDF depus de un coleg direct în SEAP) sunt citite de
// platformă cu AI: extrage întrebarea pe scurt + rezumat, marchează citita_la / citita_rezumat pe ofertare_clarificari, ca să se vadă că
// platforma „a luat cunoștință”.
//
// Poarta pe ROL (decizia Răzvan 27.11.2026, după review-ul PR #1204): citirea costă (apel AI plătit) și scrie clarificarea, deci o pornește
// doar ownerul sau un responsabil 1 / 2 al licitației numit de owner / un admin Ofertare — fn_ofertare_poate_cheltui (20261124a), prin
// _shared/poartaCheltuiala.ts, aceeași poartă ca la orice procesare plătită din Ofertare (nimic nou în BD).
// Ordinea: identitate (Auth, din JWT-ul utilizatorului) → clarificare_id → licitația clarificării, citită CU CLIENTUL UTILIZATORULUI
// (RLS: o vede doar cine are voie să vadă clarificarea) → poarta → abia apoi orice citire cu service_role, descărcarea PDF-ului sau apelul AI.
// Înainte: orice cont logat (sau x-radar-secret) pornea citirea, cu service_role de la primul pas. Calea cu secret e SCOASĂ (ca în #908 r4 și
// TKT-0390): niciun apelant în repo și un secret tehnic nu ține loc de dreptul de cheltuială al unei persoane. Cheia anon și cheia de
// serviciu nu sunt persoane: refuzate (lecția PR #318: verify_jwt nu ajunge).
// Auth: JWT de utilizator (functions.invoke). Erori de business → return {error}, nu throw. index.ts e doar entrypoint-ul.
import { mesajRefuz, textRaspuns } from '../_shared/haiku55.ts'
import { caleBlocata, mesajLot } from '../_shared/eligibilLot.ts'   // loturi (20261024b)
import { poateCheltui } from '../_shared/poartaCheltuiala.ts'       // poarta unică pe cheltuială (20261124a)

export const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-radar-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }
export const MODEL = 'claude-haiku-4-5-20251001'
const PRICE_IN = 1 / 1e6, PRICE_OUT = 5 / 1e6
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS })
const b64 = (bytes: Uint8Array) => { let bin = ''; for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(bin) }

export const MESAJ_CITIRE_ROL = 'Citirea PDF-ului cu AI costă — o pornește doar ownerul sau un responsabil al licitației numit de owner / un admin Ofertare.'
// același răspuns pentru o clarificare inexistentă și pentru una pe care contul nu o vede (RLS): nu dezvăluie existența
export const MESAJ_CLARIFICARE_INACCESIBILA = 'Clarificarea nu există sau nu ai acces la ea.'
// citirea clarificării (ca utilizator sau recitirea cu service_role) a căzut: necunoscut → refuz, fără mesajul brut al dependenței
export const MESAJ_VERIFICARE_ESUATA = 'Verificarea clarificării a eșuat; reîncearcă.'

const PROMPT = `Acesta este un document de clarificare depus de ofertantul GAZPET INSTAL SRL către o autoritate contractantă, într-o licitație publică românească (SEAP). Citește-l integral și răspunde EXCLUSIV cu JSON:
{"intrebare": "<textul întrebării/solicitării, formulat scurt (1-3 propoziții), la persoana întâi plural, ca în adresă>",
 "rezumat": "<2-4 propoziții: ce se cere, pe ce bază din documentație, ce impact are asupra ofertei>",
 "nr_intrebari": <câte întrebări distincte conține>,
 "referinte": ["<documente/articole/formulare invocate, ex. F3, HG 907/2016, Anexa 1>"],
 "data_document": "<AAAA-LL-ZZ sau null>"}`

export type Deps = {
  db: any                                              // client service_role — folosit DOAR după poartă (rândul întreg, Storage, jurnal AI, update)
  caUtilizator: (jwt: string) => any                   // client cu JWT-ul utilizatorului (RLS): licitația clarificării, ÎNAINTEA porții
  getUser: (jwt: string) => Promise<string | null>     // Auth: uid-ul din JWT-ul utilizatorului, null = token invalid
  fetch: typeof fetch                                  // apelul Anthropic (simulat în teste)
  chei: { anthropic: string; anon: string; service: string }
}

export function depsReale(createClient: (url: string, key: string, o?: any) => any): Deps {
  const URL_SUPA = Deno.env.get('SUPABASE_URL')!
  const ANON = Deno.env.get('SUPABASE_ANON_KEY') || ''
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const caUtilizator = (jwt: string) => createClient(URL_SUPA, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } })
  return {
    db: createClient(URL_SUPA, SERVICE),
    caUtilizator,
    getUser: async (jwt) => {
      const { data: u, error } = await caUtilizator(jwt).auth.getUser(jwt)
      return error ? null : (u?.user?.id || null)
    },
    fetch,
    chei: { anthropic: Deno.env.get('ANTHROPIC_API_KEY') || '', anon: ANON, service: SERVICE },
  }
}

// rolul pretins în payload-ul JWT (fără verificarea semnăturii — doar ca să refuzăm devreme cheile anon / de serviciu; persoana o
// confirmă Auth prin getUser)
const rolJwt = (jwt: string) => {
  try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch (_) { return null }
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // 1. identitate: doar un utilizator verificat de Auth. Fără token / cheia anon / cheia de serviciu / token invalid = 401.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer(\s+|$)/i, '').trim()
  if (!jwt) return json({ error: 'fără autentificare' }, 401)
  const rol = rolJwt(jwt)
  if (jwt === deps.chei.anon || rol === 'anon') return json({ error: 'apel neautorizat (cheie anon)' }, 401)
  if (jwt === deps.chei.service || rol === 'service_role') return json({ error: 'apel neautorizat (cheie de serviciu)' }, 401)
  let uid: string | null = null
  try { uid = await deps.getUser(jwt) } catch (_) { uid = null }
  if (!uid) return json({ error: 'token invalid' }, 401)

  let body: any = {}; try { body = await req.json() } catch { /* gol */ }
  const id = Number(body?.clarificare_id)
  if (!Number.isSafeInteger(id) || id <= 0) return json({ error: 'clarificare_id lipsă' }, 400)

  // 2. licitația clarificării, citită CA UTILIZATORUL (RLS), nu cu service_role: cine nu vede clarificarea nu poate nici porni citirea ei.
  //    Eroare la citire = necunoscut → refuz explicit (L18), nu „nu există”; mesaj public stabil, fără textul brut al dependenței (L10).
  let licId: number | null = null
  try {
    const { data: ref, error } = await deps.caUtilizator(jwt).from('ofertare_clarificari').select('id, licitatie_id').eq('id', id).maybeSingle()
    if (error) return json({ error: MESAJ_VERIFICARE_ESUATA }, 500)
    const l = Number(ref?.licitatie_id)
    licId = ref && Number.isSafeInteger(l) && l > 0 ? l : null
  } catch (_) {
    return json({ error: MESAJ_VERIFICARE_ESUATA }, 500)
  }
  if (licId === null) return json({ error: MESAJ_CLARIFICARE_INACCESIBILA }, 403)

  // 3. poarta pe ROL (owner / responsabil 1-2 cu dovada de numire), ÎNAINTEA oricărei citiri cu service_role și a oricărui apel plătit.
  //    Fail-closed: eroare / răspuns ne-boolean = refuz, fără cost.
  if (!await poateCheltui(deps.db, licId, uid)) return json({ error: MESAJ_CITIRE_ROL }, 403)
  const KEY = deps.chei.anthropic
  if (!KEY) return json({ error: 'ANTHROPIC_API_KEY lipsă' }, 500)

  // 4. de aici încolo ca înainte, cu service_role: rândul întreg, PDF-ul, AI-ul, jurnalul, update-ul
  const db = deps.db
  const { data: row, error: eRow } = await db.from('ofertare_clarificari').select('*').eq('id', id).maybeSingle()
  if (eRow) return json({ error: MESAJ_VERIFICARE_ESUATA }, 500)   // recitirea cade = necunoscut, nu „nu există” (review r1 b)
  if (!row) return json({ error: 'clarificarea nu există' }, 404)
  // poarta s-a dat pe licitația citită la pasul 2: un rând mutat între timp pe altă licitație nu se citește pe dreptul vechi
  if (Number(row.licitatie_id) !== licId) return json({ error: MESAJ_CLARIFICARE_INACCESIBILA }, 403)
  if (!row.fisier_path) return json({ error: 'clarificarea nu are PDF atașat' }, 400)
  // loturi (review Jakarinos r2 P1 #1): calea poate fi și a unui document de atribuire — dacă vreunul e blocat, nu se citește
  { const m = await caleBlocata(db, String(row.fisier_path)); if (m) return json({ error: mesajLot(m), motiv_lot: m }) }

  const { data: blob, error: dlErr } = await db.storage.from('ofertare').download(row.fisier_path)
  if (dlErr || !blob) return json({ error: 'download PDF: ' + (dlErr?.message || 'lipsă') })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.length > 25_000_000) return json({ error: 'PDF prea mare (>25 MB)' })

  const resp = await deps.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64(bytes) } },
      { type: 'text', text: PROMPT } ] }] }),
  })
  const data = await resp.json()
  if (!resp.ok) return json({ error: 'Claude: ' + (data.error?.message || resp.status) })
  if (data.stop_reason === 'max_tokens') return json({ error: 'Răspuns AI incomplet (max_tokens); clarificarea rămâne neschimbată.' })
  const refuz = mesajRefuz(data)
  if (refuz) return json({ error: refuz })
  const txt = textRaspuns(data)
  if (!txt.trim()) return json({ error: 'Răspuns AI fără text; clarificarea rămâne neschimbată.' })
  let j: any = null
  try { const m = txt.replace(/```json?|```/g, '').match(/\{[\s\S]*\}/); j = m ? JSON.parse(m[0]) : null } catch { /* mai jos */ }
  if (!j) return json({ error: 'răspuns AI neinterpretabil', brut: txt.slice(0, 300) })
  if (typeof j.rezumat !== 'string' || !j.rezumat.trim()) return json({ error: 'Rezumat AI gol sau invalid; clarificarea rămâne neschimbată.' })

  try { await db.from('ai_usage_log').insert({ function_name: 'ofertare-clarificare-citeste', model: MODEL, tokens_in: data.usage?.input_tokens || 0, tokens_out: data.usage?.output_tokens || 0, cost_usd: (data.usage?.input_tokens || 0) * PRICE_IN + (data.usage?.output_tokens || 0) * PRICE_OUT, ref_table: 'ofertare_clarificari', ref_id: id }) } catch { /* ignorăm */ }

  const placeholder = /^\(clarificare depusă extern/i.test(row.intrebare || '') || !(row.intrebare || '').trim()
  const rezumat = [j.rezumat, j.nr_intrebari > 1 ? `Conține ${j.nr_intrebari} întrebări.` : null, Array.isArray(j.referinte) && j.referinte.length ? 'Referințe: ' + j.referinte.join(', ') + '.' : null].filter(Boolean).join(' ')
  // originea e atribut de proveniență (20261025a, review Copilot r3 P1): PDF-ul depus de om face rândul „manual” doar dacă
  // nu avea deja o origine — o clarificare generată de server (platforma / automat / tipar) nu devine „manual” prin citire
  const upd: any = { citita_la: new Date().toISOString(), citita_rezumat: rezumat.slice(0, 2000), ...(row.origine == null ? { origine: 'manual' } : {}) }
  if (placeholder && j.intrebare) upd.intrebare = String(j.intrebare).slice(0, 4000)
  if (!row.sursa || row.sursa === 'extern') upd.sursa = 'extern — PDF depus în SEAP' + (j.data_document ? ` (${j.data_document})` : '')
  const { error: upErr } = await db.from('ofertare_clarificari').update(upd).eq('id', id)
  if (upErr) return json({ error: 'update: ' + upErr.message })
  return json({ ok: true, id, intrebare: upd.intrebare || row.intrebare, rezumat: upd.citita_rezumat })
}
