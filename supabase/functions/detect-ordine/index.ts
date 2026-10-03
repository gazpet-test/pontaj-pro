// detect-ordine v1 (09.08.2026) — Detector ordine de incepere/reincepere/sistare
// Moduri:
//  { doc_id: N }      -> proceseaza un document din documente_proiect (chemat de trigger la ingestie)
//  { backfill: true } -> scaneaza istoric: documente_proiect + nas_documente care seamana a ordin
// Rezultatul = INSERT in executie_ordine_detectate cu status 'propus' (ZERO auto-write pe proiecte;
// confirmarea se face din UI Executie). Erori business -> scrise in raspuns, fara throw.
// Poarta (03.10.2026, task #17, migrarea 20261011a): pornita DOAR de trigger-ul trg_detect_ordine cu antetul
// x-intern-secret, verificat contra Vault INTERN_EDGE_SECRET prin fn_verifica_secret. Inainte (verify_jwt=false,
// fara verificare) oricine avea URL-ul putea porni apeluri AI platite si inserari in executie_ordine_detectate.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { esteApelIntern } from '../_shared/poartaIntern.ts'

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const MODEL = 'claude-sonnet-5'
const PRICE_IN = 3 / 1e6, PRICE_OUT = 15 / 1e6
const BUCKET_EMAIL = 'documente-proiect'
const RX_ORDIN = /ordin[^a-z]*(de)?[^a-z]*(incep|re[- ]?incep|sistar|reluar)/i
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey', 'Content-Type': 'application/json' }

const PROMPT = `Esti un asistent pentru o firma romaneasca de constructii conducte de gaze. Documentul atasat ar trebui sa fie un ORDIN legat de lucrari pe un santier. Stabileste:
- tip: "incepere" (ordin de incepere a lucrarilor), "reincepere" (ordin de reincepere/reluare a lucrarilor dupa sistare) sau "sistare" (ordin de sistare/oprire a lucrarilor). Daca documentul NU e un astfel de ordin, pune tip null.
- numar_ordin: numarul ordinului (ex "123" sau "45/2025"), sau null.
- data_ordin: data DE LA CARE se aplica ordinul (data inceperii/sistarii/reluarii lucrarilor — NU data emiterii, daca difera si ambele apar), format YYYY-MM-DD, sau null.
- titlu: descriere scurta 3-8 cuvinte.
- confidence: 0-100.
Raspunde EXCLUSIV JSON: {"tip":"incepere"|"reincepere"|"sistare"|null,"numar_ordin":"...","data_ordin":"YYYY-MM-DD","titlu":"...","confidence":N}`

function b64(bytes: Uint8Array): string {
  let s = ''; const C = 8192
  for (let i = 0; i < bytes.length; i += C) s += String.fromCharCode(...bytes.subarray(i, i + C))
  return btoa(s)
}
const isoOk = (s: any) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

// data din numele fisierului: "din 14.07.2025", "14.07.2025", "14-07-2025"
function dataDinNume(nume: string): string | null {
  const m = (nume || '').match(/(\d{1,2})[.\-_ ](\d{1,2})[.\-_ ](\d{4})/)
  if (!m) return null
  const [_, d, mo, y] = m
  const dt = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  return isoOk(dt) ? dt : null
}
function tipDinNume(nume: string): string | null {
  const n = (nume || '').toLowerCase()
  if (/re[- ]?incep|reluar/.test(n)) return 'reincepere'
  if (/sistar/.test(n)) return 'sistare'
  if (/incep/.test(n)) return 'incepere'
  return null
}

async function aiExtract(pdfB64: string, fisierNume: string, supabase: any): Promise<any | null> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 512, messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } },
      { type: 'text', text: PROMPT + `\n\nNumele fisierului: "${fisierNume}"` },
    ] }] }),
  })
  const data = await resp.json()
  if (!resp.ok) return null
  try {
    const u = data.usage || {}
    await supabase.from('ai_usage_log').insert({ function_name: 'detect-ordine', model: MODEL, tokens_in: u.input_tokens || 0, tokens_out: u.output_tokens || 0, cost_usd: (u.input_tokens || 0) * PRICE_IN + (u.output_tokens || 0) * PRICE_OUT, ref_table: 'documente_proiect', ref_id: null })
  } catch (_) {}
  try {
    const txt = data.content?.find((c: any) => c.type === 'text')?.text || '{}'
    return JSON.parse(txt.replace(/```json?|```/g, '').trim())
  } catch (_) { return null }
}

// Proceseaza un document email (documente_proiect) -> propunere
async function procDocEmail(supabase: any, doc: any): Promise<string> {
  if (!doc.proiect_id) return 'skip: fara proiect'
  if (!RX_ORDIN.test((doc.nume_fisier || '') + ' ' + (doc.subiect || ''))) return 'skip: nu seamana a ordin'
  const { data: exista } = await supabase.from('executie_ordine_detectate').select('id').eq('documente_proiect_id', doc.id).maybeSingle()
  if (exista) return 'skip: deja detectat'

  let parsed: any = null
  if ((doc.mime_type || '').includes('pdf') && doc.storage_path) {
    const { data: blob } = await supabase.storage.from(BUCKET_EMAIL).download(doc.storage_path)
    if (blob) parsed = await aiExtract(b64(new Uint8Array(await blob.arrayBuffer())), doc.nume_fisier || '', supabase)
  }
  // fallback: doar pe nume fisier
  const tip = (parsed && ['incepere', 'reincepere', 'sistare'].includes(parsed.tip)) ? parsed.tip : tipDinNume(doc.nume_fisier || doc.subiect || '')
  if (!tip) return 'skip: tip nedeterminat'
  const dataOrdin = (parsed && isoOk(parsed.data_ordin)) ? parsed.data_ordin : dataDinNume(doc.nume_fisier || '')
  const { error } = await supabase.from('executie_ordine_detectate').insert({
    sursa: 'email', documente_proiect_id: doc.id, proiect_id: doc.proiect_id, tip,
    numar_ordin: parsed?.numar_ordin || null, data_ordin: dataOrdin,
    ai_titlu: parsed?.titlu || null, ai_confidence: parsed?.confidence ?? (parsed ? 50 : 30),
    fisier_nume: doc.nume_fisier,
  })
  return error ? ('eroare insert: ' + error.message) : ('propus: ' + tip + ' ' + (dataOrdin || 'fara data'))
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  if (!(await esteApelIntern(req, supabase))) return new Response(JSON.stringify({ error: 'neautorizat' }), { status: 401, headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))

    if (body.doc_id) {
      const { data: doc } = await supabase.from('documente_proiect').select('*').eq('id', body.doc_id).single()
      if (!doc) return new Response(JSON.stringify({ error: 'doc negasit' }), { status: 404, headers: CORS })
      const rez = await procDocEmail(supabase, doc)
      return new Response(JSON.stringify({ ok: true, doc_id: body.doc_id, rezultat: rez }), { headers: CORS })
    }

    if (body.backfill) {
      const rezultate: any[] = []
      // 1) email: documente_proiect care seamana a ordin, fara propunere existenta
      const { data: docs } = await supabase.from('documente_proiect').select('*').not('proiect_id', 'is', null).limit(2000)
      for (const d of (docs || [])) {
        if (!RX_ORDIN.test((d.nume_fisier || '') + ' ' + (d.subiect || ''))) continue
        rezultate.push({ sursa: 'email', id: d.id, nume: d.nume_fisier, rez: await procDocEmail(supabase, d) })
      }
      // 2) NAS: nas_documente pe foldere legate de proiecte — doar nume fisier (fara acces la continut)
      const { data: nasProj } = await supabase.from('nas_proiecte').select('id_hash,executie_proiect_id').not('executie_proiect_id', 'is', null)
      const mapProj: Record<string, number> = {}
      for (const np of (nasProj || [])) mapProj[np.id_hash] = np.executie_proiect_id
      const hashes = Object.keys(mapProj)
      for (let i = 0; i < hashes.length; i += 50) {
        const lot = hashes.slice(i, i + 50)
        const { data: nasDocs } = await supabase.from('nas_documente').select('id,denumire,proiect_id_hash,extensie').in('proiect_id_hash', lot).ilike('denumire', '%ordin%')
        for (const nd of (nasDocs || [])) {
          if (!RX_ORDIN.test(nd.denumire || '')) continue
          const proiectId = mapProj[nd.proiect_id_hash]
          if (!proiectId) continue
          const { data: exista } = await supabase.from('executie_ordine_detectate').select('id').eq('nas_documente_id', nd.id).maybeSingle()
          if (exista) continue
          const tip = tipDinNume(nd.denumire || '')
          if (!tip) continue
          const dataOrdin = dataDinNume(nd.denumire || '')
          const { error } = await supabase.from('executie_ordine_detectate').insert({
            sursa: 'nas', nas_documente_id: nd.id, proiect_id: proiectId, tip,
            numar_ordin: null, data_ordin: dataOrdin, ai_titlu: null, ai_confidence: dataOrdin ? 60 : 30,
            fisier_nume: nd.denumire,
          })
          rezultate.push({ sursa: 'nas', id: nd.id, nume: nd.denumire, rez: error ? error.message : ('propus: ' + tip + ' ' + (dataOrdin || 'fara data')) })
        }
      }
      return new Response(JSON.stringify({ ok: true, procesate: rezultate.length, rezultate }), { headers: CORS })
    }

    return new Response(JSON.stringify({ error: 'doc_id sau backfill required' }), { status: 400, headers: CORS })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 200, headers: CORS })
  }
})
