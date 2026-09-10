// ofertare-inventar-ai v2 (10.09.2026) — INVENTAR INDEPENDENT pe PDF-ul ORIGINAL.
// Al doilea/al treilea ochi peste extragerea noastră: modelul primește PDF-ul brut din
// bucket (NU textul citit de noi) și întoarce obligațiile atomice, cu pagina fizică și
// pasajul copiat — aceleași coloane ca tabelul uman (protocol agreat cu GPT, runda 3-4).
// Body: { doc_id, furnizor: 'gemini'|'openai', model?, pagini?: [de_la, pana_la], versiune? }
// Scrie în ofertare_inventar_ai. NU atinge ofertare_cerinte (registrul de producție).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1'

const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') || ''
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') || ''
const BUCKET = 'ofertare'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

// Prețuri per 1M tokeni (sept. 2026) — pentru ai_usage_log.
const PRETURI: Record<string, { in: number; out: number }> = {
  'gemini-3.1-pro-preview': { in: 2 / 1e6, out: 12 / 1e6 },
  'gemini-3.8-flash': { in: 0.75 / 1e6, out: 3.75 / 1e6 },
  'gpt-6-astra': { in: 5 / 1e6, out: 20 / 1e6 },
}

const INSTRUCTIUNI = `Ești inventarul independent al unei documentații de achiziție publică românească (Gazpet Instal, construcții conducte gaze). Primești PDF-ul ORIGINAL. Nu ai voie să te bazezi pe nicio transcriere anterioară.

Sarcina: listează TOATE obligațiile pe care documentul le impune OFERTANTULUI. O obligație ATOMICĂ per rând: dacă un paragraf cere trei lucruri (ex. „prezintă X, în termen de Y, semnat de Z"), sunt trei rânduri, cu același pasaj.

Pentru fiecare obligație:
- pagina: numărul FIZIC al paginii din PDF (prima pagină = 1), nu numărul tipărit pe foaie. Dacă pasajul traversează două pagini, scrie prima.
- pagina_pana_la: a doua pagină dacă pasajul traversează, altfel null.
- sectiune: identificatorul exact din document (ex. „III.1.3.a", „IV.4.1", „cap. 5.2"), altfel null.
- pasaj: CITAT EXACT din PDF, copiat literal, 60–300 caractere, fără nicio modificare.
- obligatie: o frază scurtă, cu cuvintele tale: CINE trebuie să facă CE, CÂND, în ce condiții. Max 200 caractere, cu valorile exacte (ani, lei, praguri, diametre, grupe).
- tip_principal: „eliminatorie" (lipsa duce la respingere/excludere la calificare) | „propunere" (de demonstrat în propunerea tehnică/financiară) | „forma" (semnătură, formulare, mod de prezentare, valabilitate ofertă) | „contractuala" (clauze din contract).
- etichete: alte tipuri care se aplică, ca listă (poate fi goală).
- etapa: „depunere" | „executie" | „ambele".
- trimitere: dacă textul trimite la altă secțiune/anexă/formular, scrie referința; altfel null.

REGULI: extragi DOAR ce scrie în document. Nu deduce, nu completa, nu inventa valori. Dacă o pagină e desen sau e goală, nu produce rânduri pentru ea. Nu sări pagini.

Răspunde EXCLUSIV cu JSON: {"obligatii":[{...}]}`

function b64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}
async function feliePdf(src: PDFDocument, start: number, end: number): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, Array.from({ length: end - start }, (_, i) => start + i))
  pages.forEach(p => out.addPage(p))
  return await out.save()
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const fail = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 200, headers: CORS })

  try {
    const { doc_id, furnizor, model, pagini, versiune: versCeruta } = await req.json()
    const f = String(furnizor || 'gemini')
    if (!doc_id || !['gemini', 'openai'].includes(f)) return fail('doc_id + furnizor (gemini|openai) obligatorii')
    if (f === 'gemini' && !GEMINI_KEY) return fail('GEMINI_API_KEY lipsește din Edge Secrets')
    if (f === 'openai' && !OPENAI_KEY) return fail('OPENAI_API_KEY lipsește din Edge Secrets')
    const MODEL = String(model || (f === 'gemini' ? 'gemini-3.1-pro-preview' : 'gpt-6-astra'))

    const { data: row } = await supabase.from('ofertare_documente_atribuire')
      .select('id, licitatie_id, fisier_path, nume_original, pagini').eq('id', Number(doc_id)).single()
    if (!row) return fail('document negasit')
    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(row.fisier_path)
    if (dlErr || !blob) return fail('download: ' + (dlErr?.message || 'lipsa'))
    let bytes = new Uint8Array(await blob.arrayBuffer())

    // Interval de pagini opțional (pentru documente uriașe); implicit tot documentul.
    let deLa = 1, panaLa = row.pagini || 0
    if (Array.isArray(pagini) && pagini.length === 2) {
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
      const n = pdf.getPageCount()
      deLa = Math.max(1, Math.min(Number(pagini[0]) || 1, n))
      panaLa = Math.max(deLa, Math.min(Number(pagini[1]) || n, n))
      bytes = await feliePdf(pdf, deLa - 1, panaLa)
    }

    const cerinta = `${INSTRUCTIUNI}\n\nDOCUMENT: „${row.nume_original}". Paginile din acest fișier sunt paginile ${deLa}–${panaLa} ale documentului original; numerotează-le ca atare (prima pagină primită = pagina ${deLa}).`
    const t0 = Date.now()
    let raw = '', tokIn = 0, tokOut = 0

    if (f === 'gemini') {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': GEMINI_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: 'application/pdf', data: b64(bytes) } },
            { text: cerinta },
          ] }],
          generationConfig: { response_mime_type: 'application/json', temperature: 0, maxOutputTokens: 32000 },
        }),
      })
      const data = await resp.json()
      if (!resp.ok) return fail(`Gemini: ${data?.error?.message || resp.status}`)
      raw = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('')
      tokIn = data?.usageMetadata?.promptTokenCount || 0
      tokOut = data?.usageMetadata?.candidatesTokenCount || 0
    } else {
      const resp = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { authorization: `Bearer ${OPENAI_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          input: [{ role: 'user', content: [
            { type: 'input_file', filename: row.nume_original || 'document.pdf', file_data: `data:application/pdf;base64,${b64(bytes)}` },
            { type: 'input_text', text: cerinta },
          ] }],
          text: { format: { type: 'json_object' } },
        }),
      })
      const data = await resp.json()
      if (!resp.ok) return fail(`OpenAI: ${data?.error?.message || resp.status}`)
      raw = data?.output_text || (data?.output || []).flatMap((o: any) => (o?.content || []).map((c: any) => c?.text || '')).join('')
      tokIn = data?.usage?.input_tokens || 0
      tokOut = data?.usage?.output_tokens || 0
    }
    const durata = Date.now() - t0

    let lista: any[] = []
    try {
      const m = raw.replace(/```json?|```/g, '').match(/\{[\s\S]*\}/)
      lista = JSON.parse(m ? m[0] : '{}').obligatii || []
    } catch (_) {
      return fail('Răspuns care nu e JSON valid: ' + raw.slice(0, 200))
    }

    const p = PRETURI[MODEL] || { in: 0, out: 0 }
    try {
      await supabase.from('ai_usage_log').insert({ function_name: 'ofertare-inventar-ai', model: MODEL, tokens_in: tokIn, tokens_out: tokOut, cost_usd: tokIn * p.in + tokOut * p.out, ref_table: 'ofertare_documente_atribuire', ref_id: row.id })
    } catch (_) {}

    // Rulare nouă = versiune nouă; nu ștergem nimic (inventarele se îngheață, regula GPT).
    // Feliile aceluiasi inventar se leaga cu o versiune data explicit in body.
    let versiune = Number(versCeruta)
    if (!Number.isInteger(versiune) || versiune < 1) {
      const { data: ult } = await supabase.from('ofertare_inventar_ai')
        .select('versiune').eq('doc_id', row.id).eq('model', MODEL).order('versiune', { ascending: false }).limit(1)
      versiune = ((ult?.[0]?.versiune as number) || 0) + 1
    }

    const TIPURI = ['eliminatorie', 'propunere', 'forma', 'contractuala']
    const ETAPE = ['depunere', 'executie', 'ambele']
    const rows = lista
      .filter((o: any) => o && typeof o.obligatie === 'string' && o.obligatie.trim())
      .slice(0, 500)
      .map((o: any, i: number) => ({
        doc_id: row.id, licitatie_id: row.licitatie_id, furnizor: f, model: MODEL, versiune,
        nr: deLa * 1000 + i + 1,
        pagina: Number.isInteger(o.pagina) ? Number(o.pagina) : null,
        pagina_pana_la: Number.isInteger(o.pagina_pana_la) ? Number(o.pagina_pana_la) : null,
        sectiune: typeof o.sectiune === 'string' ? o.sectiune.trim().slice(0, 60) || null : null,
        pasaj: typeof o.pasaj === 'string' ? o.pasaj.trim().slice(0, 600) : null,
        obligatie: o.obligatie.trim().slice(0, 600),
        tip_principal: TIPURI.includes(o.tip_principal) ? o.tip_principal : 'propunere',
        etichete: Array.isArray(o.etichete) ? o.etichete.filter((x: any) => TIPURI.includes(x)) : [],
        etapa: ETAPE.includes(o.etapa) ? o.etapa : null,
        trimitere: typeof o.trimitere === 'string' ? o.trimitere.trim().slice(0, 300) || null : null,
      }))
    if (rows.length) {
      const { error: eIns } = await supabase.from('ofertare_inventar_ai').insert(rows)
      if (eIns) return fail('insert inventar: ' + eIns.message)
    }

    const peTip = rows.reduce((a: any, r: any) => { a[r.tip_principal] = (a[r.tip_principal] || 0) + 1; return a }, {})
    return new Response(JSON.stringify({
      ok: true, doc_id: row.id, furnizor: f, model: MODEL, versiune,
      obligatii: rows.length, pe_tip: peTip, pagini: `${deLa}-${panaLa}`,
      fara_pagina: rows.filter((r: any) => r.pagina === null).length,
      durata_ms: durata, tokens_in: tokIn, tokens_out: tokOut, cost_usd: Number((tokIn * p.in + tokOut * p.out).toFixed(4)),
    }), { headers: CORS })
  } catch (e: any) {
    return fail('Eroare neasteptata: ' + String(e?.message || e))
  }
})
