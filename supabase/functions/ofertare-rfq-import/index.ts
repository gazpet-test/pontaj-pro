// ofertare-rfq-import v1 — citește PDF-ul unei oferte de furnizor și extrage
// prețurile pe materialele cererii de ofertă (RFQ). AI propune, omul verifică
// în comparativ. Pattern: ofertare-e0-autofill (document base64 → Claude → JSON).
//
// ADUSĂ ÎN REPO la 12.09.2026, VERBATIM. Nota de atunci („e curată: verify_jwt: true") era
// GREȘITĂ și s-a corectat la 18.09.2026: `verify_jwt` nu e o poartă — cheia anon e un JWT
// valid, publicată în frontend. Funcția rulează pe service_role (sare peste RLS), citește un
// PDF cu Claude (costă) și rescrie prețurile unei oferte. Fără verificare de ROL, oricine avea
// cheia publică putea porni citiri plătite și strica prețurile. Aceeași gaură ca în PR #318.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const BUCKET = 'ofertare'
const MODEL = 'claude-sonnet-5'
const PRICE_IN = 3 / 1e6, PRICE_OUT = 15 / 1e6
const MAX_BYTES = 28_000_000
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

function fileToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

// Poarta de rol. Rolul se ia din payload-ul JWT, nu prin comparație de string: env-ul funcției
// poate avea alt format de cheie decât JWT-ul legacy trimis de workeri (lecția din 14.09).
// service_role trece liber — așa o apelează ofertare-rfq-inbox. Omul: doar ownerul sau
// responsabilul licitației de care ține cererea de ofertă (poarta pe cheltuială).
async function autorizat(req: Request, supabase: any, rfqId: number | null): Promise<string | null> {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return 'lipsește Authorization'
  const rol = (() => { try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role } catch (_) { return null } })()
  if (jwt === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || rol === 'service_role') return null
  if (jwt === Deno.env.get('SUPABASE_ANON_KEY') || rol === 'anon') return 'apel neautorizat (cheie anon)'
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
  const { data: u } = await anon.auth.getUser()
  const uid = u?.user?.id
  if (!uid) return 'sesiune invalidă'
  const { data: prof } = await supabase.from('profiles').select('is_owner').eq('id', uid).maybeSingle()
  if (prof?.is_owner) return null
  if (rfqId) {
    const { data: rfq } = await supabase.from('ofertare_rfq').select('licitatie_id').eq('id', rfqId).maybeSingle()
    if (rfq?.licitatie_id) {
      const { data: lic } = await supabase.from('ofertare_licitatii').select('responsabil_id').eq('id', rfq.licitatie_id).maybeSingle()
      if (lic?.responsabil_id && lic.responsabil_id === uid) return null
    }
  }
  return 'Citirea ofertelor o pornește doar ownerul sau responsabilul licitației (costă).'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const fail = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 200, headers: CORS })

  try {
    const { oferta_id } = await req.json()
    if (!oferta_id) return fail('oferta_id lipsă')

    const { data: of } = await supabase.from('ofertare_rfq_oferte').select('id, rfq_id, furnizor, fisier_path').eq('id', oferta_id).single()
    if (!of) return fail('Oferta nu există.')
    // INTERDICȚIA 0: înaintea oricărui apel plătit și a oricărei scrieri.
    { const na = await autorizat(req, supabase, of.rfq_id); if (na) return fail(na) }
    if (!of.fisier_path) return fail('Oferta nu are PDF atașat.')

    const { data: mats } = await supabase.from('ofertare_rfq_materiale').select('id, denumire, um, cantitate, specificatii').eq('rfq_id', of.rfq_id).order('ordine')
    if (!mats?.length) return fail('Cererea de ofertă nu are materiale definite.')

    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(of.fisier_path)
    if (dlErr || !blob) return fail('Nu am găsit PDF-ul: ' + (dlErr?.message || of.fisier_path))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.length > MAX_BYTES) return fail('PDF prea mare pentru citire directă.')
    const b64 = fileToBase64(bytes)

    const listaMat = mats.map((m: any) => `${m.id} | ${m.denumire}${m.um ? ' [' + m.um + ']' : ''}${m.specificatii ? ' — ' + m.specificatii : ''}`).join('\n')
    const prompt = `Ești asistentul de achiziții al unei firme românești de construcții conducte gaze (Gazpet Instal). Primești OFERTA DE PREȚ a unui furnizor (PDF) și o compari cu LISTA DE MATERIALE cerute.\n\nLISTA MATERIALELOR CERUTE (id | denumire [UM] — specificații):\n${listaMat}\n\nREGULI:\n- Pentru FIECARE material din listă caută poziția corespondentă în ofertă (denumirile pot diferi — potrivește după sens: diametru, SDR, material, tip).\n- pret = prețul UNITAR FĂRĂ TVA, număr simplu. Dacă oferta dă prețul în altă UM decât cea cerută, spune în note și dă prețul în UM-ul ofertei cu um-ul respectiv.\n- Dacă un material NU apare în ofertă: pret null, note \"neofertat\".\n- NU inventa prețuri. Ce nu se vede = null.\n- Extrage și: furnizorul (numele firmei din antet), data ofertei (ISO YYYY-MM-DD), valabilitatea ofertei, condițiile de livrare/plată (scurt).\n\nRăspunde EXCLUSIV JSON, fără markdown:\n{\n  \"furnizor\": \"<nume sau null>\",\n  \"data_oferta\": \"<YYYY-MM-DD sau null>\",\n  \"valabilitate\": \"<text scurt sau null>\",\n  \"conditii\": \"<livrare/plată, scurt, sau null>\",\n  \"preturi\": [{\"material_id\": <id din listă>, \"denumire_furnizor\": \"<cum apare în ofertă sau null>\", \"pret\": <număr sau null>, \"um\": \"<UM sau null>\", \"note\": \"<sau null>\"}]\n}`

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 4000,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
          { type: 'text', text: prompt },
        ] }],
      }),
    })
    const data = await resp.json()
    if (!resp.ok) return fail('Claude: ' + (data.error?.message || resp.status))

    try {
      const u = data.usage || {}
      await supabase.from('ai_usage_log').insert({ function_name: 'ofertare-rfq-import', model: MODEL, tokens_in: u.input_tokens || 0, tokens_out: u.output_tokens || 0, cost_usd: (u.input_tokens || 0) * PRICE_IN + (u.output_tokens || 0) * PRICE_OUT, ref_table: 'ofertare_rfq_oferte', ref_id: of.id })
    } catch (_) {}

    let parsed: any
    try {
      const txt = data.content?.find((c: any) => c.type === 'text')?.text || '{}'
      parsed = JSON.parse(txt.replace(/```json?|```/g, '').trim())
    } catch (_) { return fail('AI a răspuns într-un format neașteptat.') }

    const idsValide = new Set(mats.map((m: any) => m.id))
    const preturi = (Array.isArray(parsed.preturi) ? parsed.preturi : [])
      .filter((p: any) => idsValide.has(p.material_id))
      .map((p: any) => ({
        oferta_id: of.id,
        material_id: p.material_id,
        denumire_furnizor: typeof p.denumire_furnizor === 'string' ? p.denumire_furnizor.slice(0, 300) : null,
        pret: Number.isFinite(p.pret) && p.pret >= 0 ? p.pret : null,
        um: typeof p.um === 'string' ? p.um.slice(0, 30) : null,
        note: typeof p.note === 'string' ? p.note.slice(0, 300) : null,
      }))

    // Ștergerea și inserarea nu sunt o tranzacție: dacă inserarea pică după ștergere, prețurile
    // vechi sunt pierdute și nu le mai aduce nimeni înapoi. Le ținem deoparte și le punem la loc.
    const { data: vechi } = await supabase.from('ofertare_rfq_preturi').select('*').eq('oferta_id', of.id)
    await supabase.from('ofertare_rfq_preturi').delete().eq('oferta_id', of.id)
    if (preturi.length) {
      const { error: insErr } = await supabase.from('ofertare_rfq_preturi').insert(preturi)
      if (insErr) {
        if (vechi?.length) await supabase.from('ofertare_rfq_preturi').insert(vechi)
        return fail('Eroare la salvarea prețurilor (cele vechi au rămas neatinse): ' + insErr.message)
      }
    }
    await supabase.from('ofertare_rfq_oferte').update({
      furnizor: typeof parsed.furnizor === 'string' && parsed.furnizor.trim() ? parsed.furnizor.trim().slice(0, 200) : of.furnizor,
      data_oferta: /^\d{4}-\d{2}-\d{2}$/.test(parsed.data_oferta || '') ? parsed.data_oferta : null,
      valabilitate: typeof parsed.valabilitate === 'string' ? parsed.valabilitate.slice(0, 200) : null,
      conditii: typeof parsed.conditii === 'string' ? parsed.conditii.slice(0, 500) : null,
      importat_ai: true,
    }).eq('id', of.id)

    const gasite = preturi.filter((p: any) => p.pret != null).length
    return new Response(JSON.stringify({ ok: true, materiale: mats.length, preturi_gasite: gasite }), { headers: CORS })
  } catch (e: any) {
    return fail('Eroare neașteptată: ' + String(e?.message || e))
  }
})
