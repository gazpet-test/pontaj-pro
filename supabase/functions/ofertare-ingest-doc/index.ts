// ofertare-ingest-doc v8 (09.09.2026) — CITIRE COMPLETĂ, DOVEDIBILĂ.
// v8 (Faza 1 corectitudine): (1) fiecare pagină e marcată în text cu ⟦PAGINA N⟧, ca
// extragerea cerințelor să poată spune pagina-sursă; (2) o felie prea mare se
// înjumătățește până la o pagină înainte să renunțăm; (3) paginile pe care chiar nu
// le putem citi intră în `pagini_necitite`, iar documentul primește status 'partial',
// nu 'procesat' — până acum o pagină sărită era numărată ca procesată (planșele
// 130–132 la Mânăstirea aveau 39 de caractere și status verde).
// v7: CORS complet cu x-client-info. v6: felia persistată. v5: 2 apeluri/invocare.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1'

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const BUCKET = 'ofertare'
const MODEL = 'claude-haiku-4-5-20251001'
const PRICE_IN = 1 / 1e6, PRICE_OUT = 5 / 1e6
const PAGINI_PER_FELIE = 8
const APELURI_PER_INVOCARE = 2
const MAX_CHUNK_BYTES = 24_000_000
const MAX_TEXT = 900_000
const MAX_OUT = 8000

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

// Marcajul de pagină: caractere pe care nu le produce niciun document real, ca să
// nu se confunde cu textul. Extragerea cerințelor îl caută cu același regex.
const marcaj = (n: number) => `⟦PAGINA ${n}⟧`
const REGULA_PAGINI = (prima: number, nr: number) =>
  `Fragmentul are ${nr} pagin${nr === 1 ? 'ă' : 'i'}; prima este pagina ${prima} a documentului. OBLIGATORIU: începe transcrierea FIECĂREI pagini cu o linie separată exact de forma ⟦PAGINA N⟧ (N = numărul paginii în document, deci ${prima}${nr > 1 ? `, ${prima + 1}, … ${prima + nr - 1}` : ''}). Nu sări niciun marcaj, chiar dacă pagina e goală sau e o planșă.`

const PROMPT_TEXT = (prima: number, nr: number) => `Extrage TOT textul lizibil din acest fragment de document (licitație publică românească — caiet de sarcini / fișă de date / liste cantități / clarificări). Transcrie fidel, în ordinea de pe pagină, inclusiv tabele (rânduri separate prin linii noi, celule prin " | "). NU rezuma, NU comenta, NU adăuga nimic de la tine. Dacă o pagină e desen/planșă fără text, scrie doar [PLANȘĂ: <titlul din indicator, dacă se vede>].
${REGULA_PAGINI(prima, nr)}
Răspunde DOAR cu textul extras.`

const PROMPT_ANTET = (prima: number, nr: number) => `Ești la PRIMA felie a unui document dintr-o documentație de atribuire românească. Pe lângă text, citește ANTETUL/pagina de gardă (R3): obiectiv, beneficiar, proiectant, număr proiect, REVIZIA, data. Revizia poate fi în antet ("Rev. 02"), pe pagina de gardă, sau în cartușul planșei.
Răspunde în DOUĂ părți separate de linia ===TEXT===:
Partea 1 — EXCLUSIV JSON: {"obiectiv": "...", "beneficiar": "...", "proiectant": "...", "proiect_nr": "...", "revizie": "...", "data": "...", "pare_scanat": true|false} (null unde nu apare).
===TEXT===
Partea 2 — tot textul extras, cu aceleași reguli: transcriere fidelă, tabele cu " | ", [PLANȘĂ: ...] pentru desene, fără rezumat.
${REGULA_PAGINI(prima, nr)}`

function b64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

async function feliePdf(src: PDFDocument, start: number, end: number): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  const idx = Array.from({ length: end - start }, (_, i) => start + i)
  const pages = await out.copyPages(src, idx)
  pages.forEach(p => out.addPage(p))
  return await out.save()
}

// Dacă modelul n-a pus marcajele cerute, punem noi unul pe tot fragmentul (interval),
// ca să nu rămână niciodată text fără pagină. Mai bine „pag. 9–16" decât nimic.
function asiguraMarcaje(txt: string, s: number, e: number): string {
  const are = /⟦PAGINA \d+⟧/.test(txt)
  if (are) return txt
  return `⟦PAGINA ${s + 1}${e - s > 1 ? `-${e}` : ''}⟧\n` + txt
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let docId: number | null = null

  const fail = async (msg: string) => {
    if (docId) { try { await supabase.from('ofertare_documente_atribuire').update({ status_procesare: 'eroare', eroare: msg.slice(0, 500) }).eq('id', docId) } catch (_) {} }
    return new Response(JSON.stringify({ error: msg }), { status: 200, headers: CORS })
  }

  try {
    const { doc_id, reia } = await req.json()
    docId = Number(doc_id)
    if (!docId) return new Response(JSON.stringify({ error: 'doc_id required' }), { status: 400, headers: CORS })

    const { data: row, error: rErr } = await supabase.from('ofertare_documente_atribuire').select('*').eq('id', docId).single()
    if (rErr || !row) return new Response(JSON.stringify({ error: 'document negasit' }), { status: 404, headers: CORS })
    // 'partial' se poate relua de la zero cu {reia:true} (ex. după ce s-a mărit plafonul);
    // 'procesat' nu se reia — ar dubla costul fără motiv.
    const reiaDeLaZero = reia === true && row.status_procesare === 'partial'
    if (row.status_procesare === 'procesat' || (row.status_procesare === 'partial' && !reiaDeLaZero)) {
      return new Response(JSON.stringify({ ok: true, skip: 'deja ' + row.status_procesare, continua: false, pagini_necitite: row.pagini_necitite || [] }), { headers: CORS })
    }
    if (!/\.pdf$/i.test(row.nume_original || row.fisier_path)) {
      await supabase.from('ofertare_documente_atribuire').update({ status_procesare: 'ignorat', eroare: 'doar PDF se proceseaza in M1 (docx/xls/dwg raman ca fisiere)' }).eq('id', docId)
      return new Response(JSON.stringify({ ok: true, skip: 'non-pdf', continua: false }), { headers: CORS })
    }
    await supabase.from('ofertare_documente_atribuire').update({ status_procesare: 'in_lucru', eroare: null }).eq('id', docId)

    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(row.fisier_path)
    if (dlErr || !blob) return await fail('download: ' + (dlErr?.message || 'lipsa'))
    const bytes = new Uint8Array(await blob.arrayBuffer())

    let pdf: PDFDocument
    try { pdf = await PDFDocument.load(bytes, { ignoreEncryption: true }) }
    catch (e: any) { return await fail('PDF corupt/necititbil: ' + (e?.message || e)) }
    const nPag = pdf.getPageCount()

    const bytesPerPage = bytes.length / Math.max(nPag, 1)
    const feliaMax = Math.max(1, Math.min(PAGINI_PER_FELIE, Math.floor(MAX_CHUNK_BYTES / Math.max(bytesPerPage * 1.4, 1))))
    const start = reiaDeLaZero ? 0 : Math.min(Math.max(row.pagini_procesate || 0, 0), nPag)
    let poz = start
    let felie = Math.max(1, Math.min(row.pagini_felie || feliaMax, feliaMax))
    let textNou = ''
    let antet: any = null
    let pareScanat: boolean | null = null
    let tokIn = 0, tokOut = 0
    // paginile necitite se acumulează peste invocări (documentul mare se citește în mai multe runde)
    const necitite = new Set<number>(reiaDeLaZero ? [] : ((row.pagini_necitite as number[] | null) || []))

    for (let apel = 0; apel < APELURI_PER_INVOCARE && poz < nPag; apel++) {
      const s = poz, e = Math.min(poz + felie, nPag)
      let pdfFelie: Uint8Array
      try { pdfFelie = (s === 0 && e === nPag) ? bytes : await feliePdf(pdf, s, e) }
      catch (er: any) { return await fail(`split pagini ${s + 1}-${e}: ` + (er?.message || er)) }

      if (pdfFelie.length > MAX_CHUNK_BYTES + 4_000_000) {
        // Prea mare: înjumătățim felia și încercăm din nou, până la o singură pagină.
        if (e - s > 1) { felie = Math.max(1, Math.ceil((e - s) / 2)); apel--; continue }
        // O singură pagină și tot prea mare: se notează cinstit ca necitită, nu ca procesată.
        necitite.add(s + 1)
        textNou += `\n${marcaj(s + 1)}\n[PAGINA ${s + 1}: NECITITĂ — fișier prea mare pentru citire (${(pdfFelie.length / 1e6).toFixed(0)} MB)]\n`
        poz = e
        continue
      }

      const primaFelie = s === 0
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL, max_tokens: MAX_OUT,
          messages: [{ role: 'user', content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64(pdfFelie) } },
            { type: 'text', text: primaFelie ? PROMPT_ANTET(s + 1, e - s) : PROMPT_TEXT(s + 1, e - s) },
          ] }],
        }),
      })
      const data = await resp.json()
      if (!resp.ok) return await fail(`Claude paginile ${s + 1}-${e}: ` + (data.error?.message || resp.status))
      tokIn += data.usage?.input_tokens || 0; tokOut += data.usage?.output_tokens || 0

      if (data.stop_reason === 'max_tokens' && (e - s) > 1) {
        felie = Math.max(1, Math.ceil((e - s) / 2))
        continue
      }

      let txt = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
      if (data.stop_reason === 'max_tokens') {
        // O singură pagină care nu încape în plafon: parțial citită = necitită, ca să nu
        // pretindem ce n-avem. Textul rămâne, e util, dar pagina e marcată.
        txt += `\n[PAGINA ${s + 1}: transcriere trunchiată la plafon — pagină extrem de densă]\n`
        necitite.add(s + 1)
      }
      if (primaFelie) {
        const sep = txt.indexOf('===TEXT===')
        if (sep >= 0) {
          try {
            const j = txt.slice(0, sep).replace(/```json?|```/g, '').trim()
            const m = j.match(/\{[\s\S]*\}/)
            if (m) { const p = JSON.parse(m[0]); pareScanat = p.pare_scanat === true; delete p.pare_scanat; antet = p }
          } catch (_) {}
          txt = txt.slice(sep + 10)
        }
      }
      textNou += asiguraMarcaje(txt, s, e) + '\n'
      poz = e
      if (((start === 0 ? '' : (row.text_extras || '')).length + textNou.length) > MAX_TEXT) {
        // Plafonul de text atins: restul paginilor NU sunt citite — se spune explicit.
        for (let p = poz + 1; p <= nPag; p++) necitite.add(p)
        textNou += `\n[TRUNCHIAT la 900k caractere — paginile ${poz + 1}-${nPag} necitite]`
        poz = nPag
        break
      }
    }

    try {
      await supabase.from('ai_usage_log').insert({ function_name: 'ofertare-ingest-doc', model: MODEL, tokens_in: tokIn, tokens_out: tokOut, cost_usd: tokIn * PRICE_IN + tokOut * PRICE_OUT, ref_table: 'ofertare_documente_atribuire', ref_id: docId })
    } catch (_) {}

    const gata = poz >= nPag
    const listaNecitite = [...necitite].sort((a, b) => a - b)
    const textAcum = ((start === 0 ? '' : (row.text_extras || '')) + '\n' + textNou).trim().slice(0, MAX_TEXT)
    const upd: any = {
      text_extras: textAcum || null,
      pagini: nPag, size_bytes: bytes.length, pagini_procesate: poz,
      pagini_felie: felie,
      pagini_necitite: listaNecitite,
      status_procesare: gata ? (listaNecitite.length ? 'partial' : 'procesat') : 'in_lucru',
      eroare: gata && listaNecitite.length ? `${listaNecitite.length} pagin${listaNecitite.length === 1 ? 'ă' : 'i'} necitit${listaNecitite.length === 1 ? 'ă' : 'e'}: ${listaNecitite.slice(0, 20).join(', ')}${listaNecitite.length > 20 ? '…' : ''}` : null,
    }
    if (start === 0 && antet) { upd.antet = antet; upd.revizie = antet?.revizie || row.revizie || null; upd.ocr = pareScanat === true }
    if (gata) upd.procesat_la = new Date().toISOString()
    const { error: upErr } = await supabase.from('ofertare_documente_atribuire').update(upd).eq('id', docId)
    if (upErr) return await fail('update: ' + upErr.message)

    return new Response(JSON.stringify({ ok: true, doc_id: docId, pagini: nPag, pagini_procesate: poz, pagini_necitite: listaNecitite, status: upd.status_procesare, continua: !gata, caractere: textAcum.length, felie, antet: start === 0 ? antet : undefined, tokens_in: tokIn, tokens_out: tokOut }), { headers: CORS })
  } catch (e: any) {
    return await fail('Eroare neasteptata: ' + String(e?.message || e))
  }
})
