// ofertare-citire-test v1 (10.09.2026) — TEST DE CITIRE: același document, mai multe modele.
// Body: { doc_id, model: 'haiku'|'haiku55'|'sonnet'|'opus', felie?: 4, de_la?: 0, apeluri?: 2 }
// Scrie în ofertare_citire_test (NU atinge text_extras din producție). Același prompt ca
// ingest-ul de producție (transcriere fidelă + marcaje ⟦PAGINA N⟧), ca să comparăm doar modelul.
// Apelat de worker-ul SQL prin pg_net cu JWT service role; răspunde { continua, urmatoarea }.
import { poartaOfertare } from '../_shared/poartaOfertare.ts'
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1'
import { documentEligibil, mesajLot } from '../_shared/eligibilLot.ts'   // poarta pe loturi (20261024b), fail-closed
import { REGULA_TABEL, maxOut } from '../_shared/transcriereTabel.ts'   // v3: aceeași regulă + plafon ca ingest-ul de producție

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const BUCKET = 'ofertare'
// v3 (15.10.2026): regula de tabel fermă + max_tokens 12000 pe Haiku 5.5, IDENTIC cu ofertare-ingest-doc (_shared/transcriereTabel.ts).
// v2 (15.10.2026, PR #724): haiku55 = proba de calitate Haiku 5.5 față de Haiku 4.5, înainte de schimbarea ingest-ului.
// Prețuri din _shared/ocrLocal.ts PRETURI: Haiku 5.5 0,10 / 0,50 $ pe 1M până la 100K tokeni de intrare PE CERERE, 0,50 / 2,50
// peste; Sonnet 5 2 / 10 (înainte 3 / 15). faraGandire: Haiku 5.5 gândește implicit și gândirea intră în max_tokens — ca în
// ofertare-ingest-doc, se trimite thinking disabled (valid la effort-ul implicit medium); fără temperature/top_p/top_k (400 pe 5.x).
type Model = { id: string; in: number; out: number; prag?: number; peste?: { in: number; out: number }; faraGandire?: boolean }
const MODELE: Record<string, Model> = {
  haiku: { id: 'claude-haiku-4-5-20251001', in: 1 / 1e6, out: 5 / 1e6 },
  haiku55: { id: 'claude-haiku-5-5', in: 0.10 / 1e6, out: 0.50 / 1e6, prag: 100_000, peste: { in: 0.50 / 1e6, out: 2.50 / 1e6 }, faraGandire: true },
  sonnet: { id: 'claude-sonnet-5', in: 2 / 1e6, out: 10 / 1e6 },
  opus: { id: 'claude-opus-5', in: 5 / 1e6, out: 25 / 1e6 },
}
const costApel = (M: Model, tin: number, tout: number) => {
  const r = M.prag !== undefined && M.peste && tin > M.prag ? M.peste : M
  return tin * r.in + tout * r.out
}
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

const REGULA_PAGINI = (prima: number, nr: number) =>
  `Fragmentul are ${nr} pagin${nr === 1 ? 'ă' : 'i'}; prima este pagina ${prima} a documentului. OBLIGATORIU: începe transcrierea FIECĂREI pagini cu o linie separată exact de forma ⟦PAGINA N⟧ (N = numărul paginii în document, deci ${prima}${nr > 1 ? `, ${prima + 1}, … ${prima + nr - 1}` : ''}). Nu sări niciun marcaj, chiar dacă pagina e goală sau e o planșă.`
const PROMPT_TEXT = (prima: number, nr: number) => `Extrage TOT textul lizibil din acest fragment de document (licitație publică românească — caiet de sarcini / fișă de date / liste cantități / clarificări). Transcrie fidel, în ordinea de pe pagină, inclusiv tabele (după regula TABELE de mai jos). NU rezuma, NU comenta, NU adăuga nimic de la tine. Dacă o pagină e desen/planșă fără text, scrie doar [PLANȘĂ: <titlul din indicator, dacă se vede>].
${REGULA_TABEL}
${REGULA_PAGINI(prima, nr)}
Răspunde DOAR cu textul extras.`

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
  const refuzAcces = await poartaOfertare(req)
  if (refuzAcces) return refuzAcces
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const fail = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 200, headers: CORS })
  try {
    const { doc_id, model, felie, de_la, apeluri } = await req.json()
    const m = MODELE[String(model)]
    if (!doc_id || !m) return fail('doc_id + model (haiku|haiku55|sonnet|opus) obligatorii')
    const felieN = Math.max(1, Math.min(Number(felie) || 4, 8))
    const apeluriN = Math.max(1, Math.min(Number(apeluri) || 2, 3))
    const { data: row } = await supabase.from('ofertare_documente_atribuire').select('id, fisier_path, nume_original').eq('id', Number(doc_id)).single()
    if (!row) return fail('document negasit')
    // LOTURI: înaintea descărcării și a AI; continua:false ca bucla apelantului să se oprească
    const el = await documentEligibil(supabase, row.id)
    if (!el.eligibil) return new Response(JSON.stringify({ ok: false, blocat_lot: true, motiv: el.motiv, error: mesajLot(el.motiv), continua: false }), { status: 200, headers: CORS })
    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(row.fisier_path)
    if (dlErr || !blob) return fail('download: ' + (dlErr?.message || 'lipsa'))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const nPag = pdf.getPageCount()
    let poz = Math.max(0, Math.min(Number(de_la) || 0, nPag))
    const rezultate: any[] = []
    for (let apel = 0; apel < apeluriN && poz < nPag; apel++) {
      const s = poz, e = Math.min(poz + felieN, nPag)
      const pdfFelie = (s === 0 && e === nPag) ? bytes : await feliePdf(pdf, s, e)
      const t0 = Date.now()
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: m.id, max_tokens: maxOut(m.id), ...(m.faraGandire ? { thinking: { type: 'disabled' } } : {}), messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64(pdfFelie) } },
          { type: 'text', text: PROMPT_TEXT(s + 1, e - s) },
        ] }] }),
      })
      const data = await resp.json()
      const durata = Date.now() - t0
      if (!resp.ok) {
        await supabase.from('ofertare_citire_test').insert({ doc_id: row.id, model: m.id, pagina_de_la: s + 1, pagina_pana_la: e, eroare: (data.error?.message || String(resp.status)).slice(0, 300), durata_ms: durata })
        return fail(`${m.id} paginile ${s + 1}-${e}: ` + (data.error?.message || resp.status))
      }
      const txt = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
      const u = data.usage || {}
      // refuzul (clasificatorii Haiku 5.5, fără fallback pe server) se notează ca eroare a feliei, ca proba să-l numere
      const eroareFelie = data.stop_reason === 'max_tokens' ? 'trunchiat la max_tokens'
        : data.stop_reason === 'refusal' ? `refuzat (${data.stop_details?.category ?? 'fără categorie'})` : null
      const ins = { doc_id: row.id, model: m.id, pagina_de_la: s + 1, pagina_pana_la: e, text: txt, tokens_in: u.input_tokens || 0, tokens_out: u.output_tokens || 0, cost_usd: costApel(m, u.input_tokens || 0, u.output_tokens || 0), durata_ms: durata, eroare: eroareFelie }
      await supabase.from('ofertare_citire_test').insert(ins)
      try { await supabase.from('ai_usage_log').insert({ function_name: 'ofertare-citire-test', model: m.id, tokens_in: ins.tokens_in, tokens_out: ins.tokens_out, cost_usd: ins.cost_usd, ref_table: 'ofertare_documente_atribuire', ref_id: row.id }) } catch (_) {}
      rezultate.push({ pagini: `${s + 1}-${e}`, caractere: txt.length, durata_ms: durata, trunchiat: data.stop_reason === 'max_tokens', refuzat: data.stop_reason === 'refusal' })
      poz = e
    }
    return new Response(JSON.stringify({ ok: true, doc_id: row.id, model: m.id, pagini: nPag, rezultate, continua: poz < nPag, urmatoarea: poz < nPag ? poz : null }), { headers: CORS })
  } catch (e: any) {
    return fail('Eroare neasteptata: ' + String(e?.message || e))
  }
})
