// api-consum-extern — Răzvan 05.10.2026 (temă „consum Firecrawl”, varianta B, claude_docs tema_firecrawl_consum):
// citește consumul abonamentelor externe cu API și scrie un rând pe (furnizor, zi) în public.api_consum_extern.
// Body / query: { furnizor: 'toate' | 'firecrawl' }. Răspuns: 200 { ok, rezultate: [{ furnizor, ok, eroare? }] }.
//
// FIȘA DE SECURITATE (CLAUDE.md pct. 7):
// (a) Conținut EXTERN citit: JSON-ul de uzaj al furnizorului (api.firecrawl.dev) — numere, păstrate în raspuns_brut
//     ca DATE; nimic din el nu se execută și nu pornește acțiuni.
// (b) Ce scrie: DOAR public.api_consum_extern (upsert pe furnizor + zi, parțial: citirea bună SAU eroarea — vezi
//     payloadUpsert). Fără mail, bani, drepturi sau alte tabele.
// (c) Identitate: service_role, pentru că tabelul nu are INSERT/UPDATE pentru authenticated (doar SELECT owner) —
//     suprafața = un singur tabel propriu. Cheile furnizorilor (FIRECRAWL_API_KEY) stau în Edge Secrets, nu în BD.
// (d) Cine pornește: pg_cron (api_consum_extern_zilnic) cu x-intern-secret din Vault (_shared/poartaIntern.ts) SAU
//     owner-ul din UI (Administrativ › Costuri AI › „Citește acum”), rol verificat în cod (verify_jwt nu ajunge).
// (e) Nimic nu cere confirmare umană: read-only față de furnizori, write doar pe tabelul propriu.
// Erori de business → eroare + eroare_la pe rândul zilei (citirea bună rămâne) + 200 { ok:false }, nu throw.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { esteApelIntern } from '../_shared/poartaIntern.ts'
import { FURNIZORI, alegeFurnizori, payloadUpsert } from './furnizori.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS })
const ziRo = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Bucharest' })   // „AAAA-LL-ZZ”

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const SUPA_URL = Deno.env.get('SUPABASE_URL')!
  const db = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Poarta: cronul (secret intern din Vault) SAU owner-ul autentificat
  let pornitDe = 'cron'
  if (!(await esteApelIntern(req, db))) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'neautorizat' }, 401)
    const uc = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: u } = await uc.auth.getUser()
    if (!u?.user) return json({ error: 'neautorizat' }, 401)
    const { data: prof } = await db.from('profiles').select('is_owner').eq('id', u.user.id).maybeSingle()
    if (prof?.is_owner !== true) return json({ error: 'doar owner-ul poate citi consumul' }, 403)
    pornitDe = u.user.id
  }

  let body: any = {}
  try { body = await req.json() } catch { /* fără corp = toate */ }
  const cerut = body?.furnizor ?? new URL(req.url).searchParams.get('furnizor') ?? 'toate'
  const lista = alegeFurnizori(cerut)
  if (!lista.length) return json({ error: `furnizor necunoscut: ${String(cerut).slice(0, 40)}` }, 400)

  const zi = ziRo()
  const rezultate: { furnizor: string; ok: boolean; eroare?: string }[] = []
  for (const f of lista) {
    const rand = await FURNIZORI[f]({ env: k => Deno.env.get(k), fetch })
    // un singur obiect: la conflict PostgREST actualizează doar coloanele lui (citirea bună SAU eroarea zilei)
    const { error } = await db.from('api_consum_extern')
      .upsert(payloadUpsert(rand, zi, new Date().toISOString()), { onConflict: 'furnizor,zi' })
    if (error) rezultate.push({ furnizor: f, ok: false, eroare: `scriere BD: ${error.message}` })
    else rezultate.push({ furnizor: f, ok: !rand.eroare, ...(rand.eroare ? { eroare: rand.eroare } : {}) })
  }
  console.log(`api-consum-extern: ${pornitDe === 'cron' ? 'cron' : 'owner'} · ${rezultate.map(r => `${r.furnizor}=${r.ok ? 'ok' : 'eroare'}`).join(', ')}`)
  return json({ ok: rezultate.every(r => r.ok), zi, rezultate })
})
