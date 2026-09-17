// ofertare-clarificare-aplica — generator de PROPUNERI pe raspunsul autoritatii la o clarificare.
// Istoric: pana pe 12.09.2026 aplica direct in registru (de-aici numele „-aplica"). Nu mai face asta.
// ── 17.09.2026 — DOAR PROPUNERE. Functia nu mai scrie NIMIC in registru. ──────────────────────
// Auditul independent din 17.09 (R01): fluxul asta a fost inlocuit pe 12.09 de `ofertare-raspuns-set`
// + `fn_ofertare_raspuns_set_aplica`, unde omul bifeaza fiecare operatie si scrierea e tranzactionala,
// cu lock-uri si amprente. UI-ul nu-l mai cheama de atunci — dar functia a ramas publicata si ACTIVA,
// cu o poarta care cere doar un JWT de utilizator valid, fara nicio verificare de modul sau rol.
// Adica: orice cont logat putea rescrie registrul de cerinte al unei licitatii, ocolind complet
// selectia umana. Doua mecanisme cu garantii diferite produceau acelasi „adevar oficial".
// S-a scos partea de APLICARE, nu doar s-a pus un steag: un steag se poate uita nesetat, codul sters
// nu se mai poate apela. Ce ramane e un generator de propuneri, inofensiv.
// Auth: JWT user SAU x-radar-secret. Body {clarificare_id} → intoarce planul. Nu exista cale de scriere.
import { createClient } from 'npm:@supabase/supabase-js@2'

// Secretul NU mai sta in sursa: repo-ul e public. Verificare prin RPC contra Vault; functia
// accepta si valoarea precedenta cat tine fereastra de rotire, ca sa nu pice cron-urile deodata.
async function secretOk(req: Request): Promise<boolean> {
  const s = req.headers.get('x-radar-secret')
  if (!s) return false
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await db.rpc('fn_verifica_radar_secret', { p_secret: s })
  return !error && data === true
}


const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-radar-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }
const MODEL = 'claude-sonnet-5'
const PRICE_IN = 3 / 1e6, PRICE_OUT = 15 / 1e6
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const SUPA_URL = Deno.env.get('SUPABASE_URL')!
  const db = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let userId: string | null = null
  if (!(await secretOk(req))) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'fără autentificare' }, 401)
    const uc = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: u } = await uc.auth.getUser()
    if (!u?.user) return json({ error: 'token invalid' }, 401)
    userId = u.user.id
  }
  const KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
  if (!KEY) return json({ error: 'ANTHROPIC_API_KEY lipsă' }, 500)

  let body: any = {}; try { body = await req.json() } catch { /* gol */ }
  const id = Number(body.clarificare_id)
  if (!id) return json({ error: 'clarificare_id lipsă' }, 400)
  const { data: cl } = await db.from('ofertare_clarificari').select('*').eq('id', id).maybeSingle()
  if (!cl) return json({ error: 'clarificarea nu există' }, 404)
  if (!(cl.raspuns || '').trim()) return json({ error: 'clarificarea nu are răspunsul autorității — completează-l întâi' }, 400)

  const { data: cer } = await db.from('ofertare_cerinte').select('id, tip, sursa_sectiune, text_cerinta, document_probant, cand_se_prezinta, lot, versiune, sursa_document_id, stare, stare_motiv, stare_de, stare_la')
    .eq('licitatie_id', cl.licitatie_id).is('inlocuita_de', null).order('id')
  if (!cer?.length) return json({ error: 'licitația nu are registru de cerințe' }, 400)

  const lista = cer.map(c => `#${c.id} [${c.tip}${c.sursa_sectiune ? ' · ' + c.sursa_sectiune : ''}] ${c.text_cerinta}`).join('\n')
  const prompt = `Ești consultant de achiziții publice (România, L98/2016, L99/2016, HG 395/2016). O clarificare depusă de ofertantul GAZPET INSTAL a primit răspuns de la autoritatea contractantă. Trebuie să stabilești CE SE SCHIMBĂ în registrul de cerințe al licitației.

ÎNTREBAREA (clarificarea nr. ${cl.nr}):
${cl.intrebare}
${cl.citita_rezumat ? `\nREZUMAT PLATFORMĂ: ${cl.citita_rezumat}` : ''}

RĂSPUNSUL AUTORITĂȚII:
${cl.raspuns}

REGISTRUL DE CERINȚE ACTIV (id, tip, secțiune, text):
${lista}

Răspunde EXCLUSIV cu JSON, fără comentarii:
{"modificari":[{"cerinta_id":<id>,"actiune":"modifica"|"anuleaza","text_nou":"<textul complet al cerinței după răspuns (doar la modifica)>","motiv":"<1 propoziție>"}],
 "noi":[{"tip":"eliminatorie"|"propunere"|"forma"|"contractuala","sursa_sectiune":"<ex: Răspuns clarificare nr. ${cl.nr}>","text_cerinta":"<cerința nouă, completă>","document_probant":"<ce dovadă se cere sau null>","cand_se_prezinta":"duae"|"depunere"|"primul_loc"|null,"motiv":"<1 propoziție>"}],
 "fara_efect":<true dacă răspunsul nu schimbă nicio cerință>,
 "rezumat":"<2-3 propoziții: ce a răspuns autoritatea și ce efect are asupra ofertei>"}
Reguli: modifică DOAR cerințele pe care răspunsul le schimbă efectiv (relaxare, înăsprire, precizare de conținut, termen, format); nu reformula cerințe neatinse; dacă răspunsul e „se menține documentația”, întoarce fara_efect=true și liste goale. Maxim 15 modificări.`

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 6000, messages: [{ role: 'user', content: prompt }] }),
  })
  const data = await resp.json()
  if (!resp.ok) return json({ error: 'AI: ' + (data.error?.message || resp.status) })
  const txt = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
  let j: any = null
  try { const m = txt.replace(/```json?|```/g, '').match(/\{[\s\S]*\}/); j = m ? JSON.parse(m[0]) : null } catch { /* mai jos */ }
  if (!j) return json({ error: 'răspuns AI neinterpretabil', brut: txt.slice(0, 300) })
  try { await db.from('ai_usage_log').insert({ function_name: 'ofertare-clarificare-aplica', model: MODEL, tokens_in: data.usage?.input_tokens || 0, tokens_out: data.usage?.output_tokens || 0, cost_usd: (data.usage?.input_tokens || 0) * PRICE_IN + (data.usage?.output_tokens || 0) * PRICE_OUT, ref_table: 'ofertare_clarificari', ref_id: id }) } catch { /* ignorăm */ }

  const modificari = (Array.isArray(j.modificari) ? j.modificari : []).filter((m: any) => cer.some(c => c.id === Number(m.cerinta_id))).slice(0, 15)
  const noi = (Array.isArray(j.noi) ? j.noi : []).filter((n: any) => n?.text_cerinta).slice(0, 15)
  // Singura iesire: propunerea. Statusul clarificarii NU se mai schimba de aici — trecerea pe
  // „raspunsa" o face omul din ecranul de clarificari, unde vede si documentul.
  return json({
    ok: true, doar_propunere: true,
    propunere: { modificari, noi, fara_efect: !!j.fara_efect, rezumat: j.rezumat },
    nota: 'Functia propune, nu aplica. Aplicarea in registru se face din ecranul Licitatii, prin setul de raspuns (selectie umana pe fiecare operatie).',
  })
})
