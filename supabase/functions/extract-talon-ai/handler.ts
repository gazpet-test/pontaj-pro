// extract-talon-ai v17 — 14.10.2026 (securitate etapa 2 grup B) — logica funcției (index.ts doar pornește serverul).
// v17: scos complet antetul intern cu secret (v16 îl compara cu un literal scris în cod; cu el nu mai trebuia nici măcar
//      un cont) și din CORS. Numele antetului nu se mai scrie în codul funcției: garda din CI îl interzice. Poarta e în acces.ts: JWT-ul sesiunii + owner SAU (rol admin_logistica ȘI modulul 'logistica'),
//      înaintea oricărei lucrări (corpul cererii nu se citește înainte de poartă). Restul fluxului e identic cu v16, cu
//      excepții mici: dependențele injectate (Deps: client, cheia Anthropic, fetch), ca handler_test.ts să verifice
//      fără rețea că nimic nu se citește / nu se cheltuie / nu se scrie înaintea porții; cheia Anthropic lipsă → 500 clar
//      (după poartă); corp JSON `null` tratat ca {}; un rând de jurnal START cu utilizatorul; un tip explicit pentru
//      `deno check` (vezi mai jos).
//      Revenire: supabase/functions_retrase/revenire_grupb/extract-talon-ai.v16.ts
// v18 — 18.10.2026: Haiku 4.5 → Haiku 5.5 (_shared/haiku55.ts). Scos temperature: 0 (pe 5.5 orice valoare ≠ 1 dă 400; formatul
//      rămâne ținut de prompt + parsarea JSON), gândire oprită explicit, max_tokens 1500 → 2000 (tokenizer ~30% mai mare), textul
//      citit doar din blocurile `text`; refuzul filtrului de siguranță → 200 { success:false, error } (ca „fara documente”), nu throw.
// Citește scanurile de talon/carte auto (documente-flota, tip_id=10) cu Claude vision
// și scrie datele extrase în talon_extract_staging (preview → confirm → apply, NU scrie direct în logistica_active).
// body: {active_id?} — procesează un vehicul (sau următorul neprocesat)

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { poartaTalon } from './acces.ts'
import { talonUtil } from '../_shared/structuraExtrageri.ts'
import { faraGandire } from '../_shared/gandire.ts'
import { costApel, HAIKU_55, jsonDinText, mesajRefuz, textRaspuns } from '../_shared/haiku55.ts'

const MAX_DOCS = 4        // max scanuri trimise per vehicul
const MAX_BYTES = 4_500_000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

// Dependențele injectate: în producție clientul service + cheia din env + fetch; în teste, simulări care numără.
// deno-lint-ignore no-explicit-any
export type Deps = { supa: any; API_KEY: string | undefined; fetch: typeof fetch }

export function depsReale(): Deps {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return { supa: createClient(supabaseUrl, serviceKey), API_KEY: Deno.env.get('ANTHROPIC_API_KEY'), fetch }
}

// faDeps = fabrica de dependențe, chemată LENEȘ: după OPTIONS și în interiorul try. Dacă inițializarea aruncă
// (env lipsă, client), OPTIONS rămâne 200, iar POST primește 500 JSON cu CORS (ca la detect_plate_orphan_msgs, PR #707).
export async function handler(req: Request, faDeps: () => Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const deps = faDeps()
    const supabase = deps.supa

    // Poarta înaintea oricărei alte lucrări (și înaintea citirii corpului și a mesajelor despre configurare).
    const acces = await poartaTalon(req, supabase)
    if (!acces.ok) return json(acces.status, { error: acces.error })

    const anthropicKey = deps.API_KEY
    if (!anthropicKey) return json(500, { error: 'ANTHROPIC_API_KEY missing' })

    const body = (await req.json().catch(() => ({}))) || {}

    // vehiculul țintă
    let activeId: number | null = body.active_id ?? null
    if (!activeId) {
      const { data } = await supabase.from('logistica_documente')
        .select('active_id').eq('tip_id', 10).like('observatii', '%(NAS)%')
        .not('active_id', 'is', null).limit(500)
      // v17: tip explicit <number> — fără el `deno check` pică (TS2322, Set<{}>); fără efect la rulare
      const cand = [...new Set<number>((data || []).map((d: { active_id: number }) => d.active_id))]
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

    console.log(`[talon-ai] START user=${acces.userId} | active_id=${activeId} | documente=${docs.length}`)

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

    const resp = await deps.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: HAIKU_55, max_tokens: 2000, thinking: faraGandire(HAIKU_55), messages: [{ role: 'user', content }] }),
    })
    // Jurnal înaintea oricărei ieșiri; clona păstrează răspunsul original pentru fluxul existent.
    try {
      const d = await resp.clone().json()
      if (resp.ok || d?.usage) {
        const u = d?.usage || {}
        await supabase.from('ai_usage_log').insert({
          function_name: 'extract-talon-ai', model: HAIKU_55,
          tokens_in: u.input_tokens || 0, tokens_out: u.output_tokens || 0,
          cost_usd: costApel(HAIKU_55, u), ref_table: 'logistica_active', ref_id: activeId,
        })
      }
    } catch (_) { /* nu blocheaza */ }
    if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
    const data = await resp.json()
    if (data.stop_reason === 'max_tokens') return json(200, { success: false, active_id: activeId, error: 'Raspuns AI incomplet (max_tokens); reincearca' })
    const refuz = mesajRefuz(data)
    if (refuz) return json(200, { success: false, active_id: activeId, error: refuz })
    const raw = textRaspuns(data).trim()
    if (!raw) return json(200, { success: false, active_id: activeId, error: 'Raspuns AI fara text' })
    const extras: Record<string, unknown> | null = jsonDinText(raw)
    if (!talonUtil(extras)) return json(200, { success: false, active_id: activeId, error: 'AI nu a extras date utile din talon' })

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
}
