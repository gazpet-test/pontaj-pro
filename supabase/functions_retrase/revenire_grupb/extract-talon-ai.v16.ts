// extract-talon-ai v1 — 20.07.2026
// Citește scanurile de talon/carte auto (documente-flota, tip_id=10) cu Claude vision
// și scrie datele extrase în talon_extract_staging (preview → confirm → apply, NU scrie direct în logistica_active).
// action: extract {active_id?} — proceseză un vehicul (sau următorul neprocesat)
// Auth: x-internal-secret sau JWT valid.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const INTERNAL_SECRET = crypto.randomUUID() // <REDACTAT len 24> la copiere (14.10.2026): literalul din v16 nu intră în repo; valoarea aleatoare nu se potrivește niciodată
const MAX_DOCS = 4        // max scanuri trimise per vehicul
const MAX_BYTES = 4_500_000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
const errMsg = (e: unknown) => e instanceof Error ? e.message : (typeof e === 'object' && e ? JSON.stringify(e) : String(e))
function b64(u8: Uint8Array): string {
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH) as unknown as number[])
  return btoa(s)
}

const PROMPT = `Ești expert în documente auto românești (Certificat de Înmatriculare / Carte de Identitate a Vehiculului).
Extrage TOATE datele tehnice pe care le vezi în imaginile/PDF-urile atаșate. Atenție la codurile standard:
(A) număr înmatriculare, (B) data primei înmatriculări, (D.1) marca, (D.2) tip/model, (D.3) denumire comercială,
(E) serie șasiu/VIN, (F.1) masa maximă autorizată kg, (G) masa proprie kg, (J) categoria vehiculului (M1/N1/N3/O4...),
(K) număr omologare, (P.1) cilindree cm3, (P.2) putere kW, (P.3) tip carburant, (R) culoare, (S.1) nr locuri,
serie motor, serie CIV, an fabricație.
Răspunde DOAR cu JSON valid, fără alt text, cu EXACT aceste chei (pune null unde nu vezi clar — NU ghici):
{"nr_inmatriculare":null,"serie_sasiu":null,"serie_motor":null,"serie_civ":null,"marca":null,"model":null,
"an_fabricatie":null,"data_prima_inmatriculare":null,"categorie_vehicul":null,"nr_omologare":null,
"capacitate_motor":null,"putere_kw":null,"tip_carburant":null,"culoare":null,"masa_maxima_kg":null,
"greutate_kg":null,"nr_locuri":null}
Numerele fără unități (ex: 1461 nu "1461 cm3"), datele ca YYYY-MM-DD, an_fabricatie ca număr.`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
    const body = await req.json().catch(() => ({}))

    const isInternal = req.headers.get('x-internal-secret') === INTERNAL_SECRET
    if (!isInternal) {
      const auth = req.headers.get('Authorization')
      if (!auth) return json(401, { error: 'Neautorizat' })
      const { data: { user } } = await supabase.auth.getUser(auth.replace('Bearer ', ''))
      if (!user) return json(401, { error: 'Token invalid' })
    }

    // vehiculul țintă
    let activeId: number | null = body.active_id ?? null
    if (!activeId) {
      const { data } = await supabase.from('logistica_documente')
        .select('active_id').eq('tip_id', 10).like('observatii', '%(NAS)%')
        .not('active_id', 'is', null).limit(500)
      const cand = [...new Set((data || []).map((d: { active_id: number }) => d.active_id))]
      const { data: done } = await supabase.from('talon_extract_staging').select('active_id')
      const doneSet = new Set((done || []).map((d: { active_id: number }) => d.active_id))
      activeId = cand.find((id) => !doneSet.has(id)) ?? null
      if (!activeId) return json(200, { success: true, idle: true })
    }

    const { data: docs, error: dErr } = await supabase.from('logistica_documente')
      .select('id, pdf_url, observatii').eq('tip_id', 10).eq('active_id', activeId)
      .not('pdf_url', 'is', null).limit(MAX_DOCS)
    if (dErr) throw dErr
    if (!docs || docs.length === 0) return json(200, { success: false, active_id: activeId, error: 'fara documente' })

    // construiește conținutul multimodal
    const content: Array<Record<string, unknown>> = []
    let bytes = 0
    const used: number[] = []
    for (const d of docs) {
      const { data: blob, error: sErr } = await supabase.storage.from('documente-flota').download(d.pdf_url)
      if (sErr || !blob) continue
      const buf = new Uint8Array(await blob.arrayBuffer())
      if (bytes + buf.length > MAX_BYTES) continue
      bytes += buf.length
      const ext = (d.pdf_url.split('.').pop() || '').toLowerCase()
      const media = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg'
      content.push(ext === 'pdf'
        ? { type: 'document', source: { type: 'base64', media_type: media, data: b64(buf) } }
        : { type: 'image', source: { type: 'base64', media_type: media, data: b64(buf) } })
      used.push(d.id)
    }
    if (content.length === 0) return json(200, { success: false, active_id: activeId, error: 'documente prea mari / nedescarcabile' })
    content.push({ type: 'text', text: PROMPT })

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, temperature: 0, messages: [{ role: 'user', content }] }),
    })
    if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
    const data = await resp.json()
    let raw = (data.content?.find((b: { type: string }) => b.type === 'text')?.text || '').trim()
    raw = raw.replace(/^```(json)?\s*/i, '').replace(/\s*```$/, '')
    let extras: Record<string, unknown>
    try { extras = JSON.parse(raw) } catch { throw new Error('JSON invalid de la AI: ' + raw.slice(0, 150)) }

    // compară cu ce e în BD → conflicte
    const { data: activ } = await supabase.from('logistica_active')
      .select('nr_inmatriculare, serie_sasiu, serie_motor, an_fabricatie, capacitate_motor, putere_kw, tip_carburant, greutate_kg')
      .eq('id', activeId).single()
    const conflicte: Record<string, unknown> = {}
    if (activ) {
      for (const [k, v] of Object.entries(activ)) {
        const nou = (extras as Record<string, unknown>)[k]
        if (v != null && nou != null && String(v).replace(/\s/g, '').toUpperCase() !== String(nou).replace(/\s/g, '').toUpperCase()) {
          conflicte[k] = { in_bd: v, in_talon: nou }
        }
      }
    }

    const { error: insErr } = await supabase.from('talon_extract_staging').insert({
      active_id: activeId, document_id: used[0] ?? null, pdf_url: docs[0].pdf_url,
      extras, conflicte: Object.keys(conflicte).length ? conflicte : null,
    })
    if (insErr) throw insErr

    return json(200, { success: true, active_id: activeId, documente_citite: used.length, extras, conflicte })
  } catch (e) {
    const msg = errMsg(e)
    console.error('extract-talon-ai:', msg)
    return json(500, { error: msg })
  }
})
