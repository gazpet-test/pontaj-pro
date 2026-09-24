// worker/ofertare/ingest.ts — citirea documentelor pe NAS (22.09.2026, decizie Răzvan: „1 și 2").
// Consumă ofertare_ingest_coada (aceeași coadă ca butonul „☁ Pe server"). Pentru PDF-urile cu strat de text,
// textul se scoate GRATUIT cu pdftotext (poppler) și se scrie cu marcajele ⟦PAGINA n⟧ exact ca edge function-ul
// ofertare-ingest-doc; doar antetul (obiectiv/beneficiar/proiectant/revizie) se citește cu Haiku din primele pagini
// (~0,001 USD). Scanurile (fără strat de text) merg pe drumul vechi: edge function-ul ofertare-ingest-doc, cu AI.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import JSZip from 'https://esm.sh/jszip@3.10.1'

const env = (k: string, d = '') => Deno.env.get(k) ?? d
const SUPABASE_URL = env('SUPABASE_URL'), SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY'), ANTHROPIC_KEY = env('ANTHROPIC_API_KEY')
const BUCKET = 'ofertare'
const MAX_TEXT = 900_000
const PRAG_TEXT_PAGINA = 120         // caractere non-spațiu ca o pagină să conteze „cu text"
const PRAG_DOC_TEXT = 0.85           // proporția de pagini cu text ca documentul să fie citit local
const HAIKU = { id: 'claude-haiku-4-5-20251001', in: 1 / 1e6, out: 5 / 1e6 }
const marcaj = (n: number) => `⟦PAGINA ${n}⟧`
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), '[ingest]', ...a)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export type Supa = ReturnType<typeof createClient>

async function ruleaza(cmd: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  const p = await new Deno.Command(cmd, { args, stdout: 'piped', stderr: 'piped' }).output()
  const dec = new TextDecoder()
  return { code: p.code, out: dec.decode(p.stdout), err: dec.decode(p.stderr) }
}

// textul pe pagini, din stratul de text al PDF-ului (pdftotext separă paginile cu \f)
async function textLocal(caleaPdf: string): Promise<{ pagini: string[]; nPag: number } | null> {
  const info = await ruleaza('pdfinfo', [caleaPdf])
  const mPag = info.out.match(/^Pages:\s+(\d+)/m)
  const nPag = mPag ? Number(mPag[1]) : 0
  if (!nPag) return null
  const r = await ruleaza('pdftotext', ['-layout', '-enc', 'UTF-8', caleaPdf, '-'])
  if (r.code !== 0) { log('pdftotext:', r.err.slice(0, 200)); return null }
  const parti = r.out.split('\f')
  if (parti.length && parti[parti.length - 1].trim() === '') parti.pop()
  while (parti.length < nPag) parti.push('')
  // -layout păstrează coloanele tabelelor, dar umflă textul cu spații (fișa SEAP: ~4,6k car./pagină); rulăm 2+ spații într-unul dublu
  const pagini = parti.slice(0, nPag).map(t => t.split('\n').map(l => l.replace(/\s+$/, '').replace(/[ \t]{2,}/g, '  ')).join('\n').replace(/\n{3,}/g, '\n\n').trim())
  return { pagini, nPag }
}

async function antetDinText(text: string): Promise<{ antet: any; tokIn: number; tokOut: number }> {
  const prompt = `Primești începutul unui document dintr-o documentație de atribuire românească (licitație publică). Citește ANTETUL / pagina de gardă și răspunde EXCLUSIV cu JSON, fără altceva:
{"obiectiv": "...", "beneficiar": "...", "proiectant": "...", "proiect_nr": "...", "revizie": "...", "data": "..."}
Pune null unde nu apare. "revizie" = revizia/ediția documentului (ex. "Rev. 2", "R01"), nu data.

TEXT:
${text.slice(0, 6000)}`
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...(env('ANTHROPIC_WORKSPACE_ID') ? { 'anthropic-workspace-id': env('ANTHROPIC_WORKSPACE_ID') } : {}) },
    body: JSON.stringify({ model: HAIKU.id, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(60_000),
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error('antet Haiku: ' + (data.error?.message || resp.status))
  const txt = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
  const m = txt.replace(/```json?|```/g, '').match(/\{[\s\S]*\}/)
  let antet: any = null
  try { antet = m ? JSON.parse(m[0]) : null } catch (_) { antet = null }
  return { antet, tokIn: data.usage?.input_tokens || 0, tokOut: data.usage?.output_tokens || 0 }
}

// drumul vechi, cu AI (scanuri): edge function-ul ofertare-ingest-doc, apel după apel cât timp continua=true
async function citesteCuAI(docId: number): Promise<string> {
  let incercari = 0
  for (let runda = 0; runda < 120; runda++) {
    let data: any
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/ofertare-ingest-doc`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ doc_id: docId, apeluri: 2 }),
        signal: AbortSignal.timeout(170_000),
      })
      data = await resp.json()
    } catch (e) { data = { error: 'apel edge: ' + String((e as Error)?.message ?? e) } }
    if (!data || data.error) {
      incercari++
      if (incercari >= 3) return 'eroare: ' + String(data?.error ?? 'răspuns gol')
      await sleep(15_000 * incercari); continue
    }
    incercari = 0
    if (data.skip) return 'sărit: ' + data.skip
    if (!data.continua) return `${data.status ?? 'gata'} (${data.pagini_procesate ?? '?'}/${data.pagini ?? '?'} pagini, AI)`
  }
  return 'eroare: prea multe runde'
}

async function citesteDocument(supabase: Supa, doc: any, cerutDe: string | null): Promise<string> {
  const off = Math.max(0, Number(doc.pagina_offset) || 0)
  const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(doc.fisier_path)
  if (dlErr || !blob) {
    await supabase.from('ofertare_documente_atribuire').update({ status_procesare: 'eroare', eroare: ('download: ' + (dlErr?.message || 'lipsă')).slice(0, 500) }).eq('id', doc.id)
    return 'eroare: download'
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const cale = `/tmp/ingest_${doc.id}.pdf`
  await Deno.writeFile(cale, bytes)
  try {
    const local = await textLocal(cale)
    if (!local) return await citesteCuAI(doc.id)                       // pdfinfo/pdftotext n-au putut → AI (și decide el dacă e corupt)
    const cuText = local.pagini.filter(p => p.replace(/\s/g, '').length >= PRAG_TEXT_PAGINA).length
    if (cuText / local.nPag < PRAG_DOC_TEXT) return await citesteCuAI(doc.id)   // scan sau majoritar imagini → AI
    await supabase.from('ofertare_documente_atribuire').update({ status_procesare: 'in_lucru', eroare: null, procesat_de: cerutDe, procesat_la: new Date().toISOString() }).eq('id', doc.id)
    const necitite: number[] = []
    let text = ''
    local.pagini.forEach((p, i) => {
      const nr = off + i + 1
      if (p.replace(/\s/g, '').length < 20) { necitite.push(nr); text += `${marcaj(nr)}\n[PAGINA ${nr}: fără text în stratul PDF — probabil imagine/planșă]\n\n` }
      else text += `${marcaj(nr)}\n${p}\n\n`
    })
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + `\n[TRUNCHIAT la ${MAX_TEXT} caractere]`
    let antet: any = null, tokIn = 0, tokOut = 0
    try { const a = await antetDinText(local.pagini.slice(0, 2).join('\n\n')); antet = a.antet; tokIn = a.tokIn; tokOut = a.tokOut } catch (e) { log(`#${doc.id} antet:`, (e as Error).message) }
    try { await supabase.from('ai_usage_log').insert({ function_name: 'ofertare-ingest-doc', model: HAIKU.id, tokens_in: tokIn, tokens_out: tokOut, cost_usd: tokIn * HAIKU.in + tokOut * HAIKU.out, ref_table: 'ofertare_documente_atribuire', ref_id: doc.id }) } catch (_) {}
    const upd: Record<string, unknown> = {
      text_extras: text.trim() || null, pagini: local.nPag, size_bytes: bytes.length, pagini_procesate: local.nPag, pagini_necitite: necitite,
      status_procesare: necitite.length ? 'partial' : 'procesat',
      eroare: necitite.length ? `${necitite.length} pagin${necitite.length === 1 ? 'ă' : 'i'} fără text (imagini): ${necitite.slice(0, 20).join(', ')}${necitite.length > 20 ? '…' : ''}` : null,
      ocr: false, procesat_la: new Date().toISOString(), procesat_de: cerutDe,
    }
    if (antet) { upd.antet = antet; upd.revizie = antet?.revizie || doc.revizie || null }
    const { error: upErr } = await supabase.from('ofertare_documente_atribuire').update(upd).eq('id', doc.id)
    if (upErr) return 'eroare: update ' + upErr.message
    return `${upd.status_procesare} (${local.nPag} pagini, text local${necitite.length ? `, ${necitite.length} fără text` : ''})`
  } finally { try { await Deno.remove(cale) } catch (_) {} }
}

async function candidati(supabase: Supa, licId: number): Promise<any[]> {
  const { data: docs } = await supabase.from('ofertare_documente_atribuire')
    .select('id, licitatie_id, nume_original, tip, fisier_path, pagina_offset, revizie, status_procesare, pagini_procesate')
    .eq('licitatie_id', licId).in('status_procesare', ['neprocesat', 'in_lucru', 'eroare']).not('fisier_path', 'like', '%/neincarcat/%').order('id')
  const out: any[] = []
  for (const d of docs ?? []) {
    const { data: ok } = await supabase.rpc('ofertare_doc_de_citit', { p_licitatie_id: d.licitatie_id, p_doc_id: d.id, p_nume: d.nume_original, p_tip: d.tip })
    if (ok !== true) continue
    // un apel lansat de tick-ul din Supabase și încă în zbor (lease 3 min) — îl lăsăm în pace
    const { data: l } = await supabase.from('ofertare_ingest_lansari').select('lansat_la').eq('doc_id', d.id).maybeSingle()
    if (l?.lansat_la && Date.now() - new Date(l.lansat_la).getTime() < 3 * 60_000) continue
    out.push(d)
  }
  return out
}

// 24.09: .docx-urile (formularul de propunere tehnică, acordul contractual…) rămâneau „ignorat" — edge-ul
// ofertare-word-text există, dar nu-l apela nimeni. Aceeași logică, aici: docx = zip cu word/document.xml.
// .doc binar vechi rămâne pe edge (word-extractor); fișierele-lacăt Office (~$…) nu sunt documente.
const ENTITATI: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function xmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\b[^>]*\/?>/g, '\t').replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, ' | ').replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (_m, e) => ENTITATI[e])
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/ \| (?=\n)/g, '').trim()
}
async function citesteWordLicitatie(supabase: Supa, licId: number): Promise<number> {
  const { data: docs } = await supabase.from('ofertare_documente_atribuire')
    .select('id, nume_original, fisier_path').eq('licitatie_id', licId).eq('status_procesare', 'ignorat').is('text_extras', null)
    .ilike('nume_original', '%.docx')
  let n = 0
  for (const d of docs ?? []) {
    if (!d.fisier_path || /(^|\/)~\$/.test(d.nume_original || '')) continue
    try {
      const { data: blob, error } = await supabase.storage.from(BUCKET).download(d.fisier_path)
      if (error || !blob) { log(`#${licId} word ${d.id}: download ${error?.message ?? 'lipsă'}`); continue }
      const zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()))
      const nume = Object.keys(zip.files).filter(x => x === 'word/document.xml' || /^word\/(header|footer)\d*\.xml$/.test(x))
      nume.sort((a, b) => (a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b)))
      const bucati: string[] = []
      for (const x of nume) { const t = xmlToText(await zip.file(x)!.async('string')); if (t) bucati.push(t) }
      const text = bucati.join('\n\n')
      if (text.length < 50) { log(`#${licId} word ${d.id}: doar ${text.length} caractere — probabil scan în Word`); continue }
      const { error: upErr } = await supabase.from('ofertare_documente_atribuire').update({
        text_extras: text.slice(0, MAX_TEXT), status_procesare: 'procesat', pagini_procesate: 0, procesat_la: new Date().toISOString(),
        eroare: `text extras din .docx pe worker (${bucati.length} părți, ${text.length} caractere) — fără paginație fixă`,
      }).eq('id', d.id).eq('status_procesare', 'ignorat')
      if (upErr) log(`#${licId} word ${d.id}: update ${upErr.message}`); else n++
    } catch (e) { log(`#${licId} word ${d.id}:`, (e as Error)?.message ?? e) }
  }
  if (n) log(`#${licId}: ${n} fișiere Word citite`)
  return n
}

export async function proceseazaIngest(supabase: Supa, licId: number, esteOprire: () => boolean, stare: (s: string) => void) {
  const { data: c } = await supabase.from('ofertare_ingest_coada').select('*').eq('licitatie_id', licId).maybeSingle()
  if (!c?.activ) return
  try { await citesteWordLicitatie(supabase, licId) } catch (e) { log('word:', (e as Error)?.message ?? e) }
  const esuate = new Set<number>()
  let citite = 0
  const t0Tura = Date.now()
  while (!esteOprire()) {
    // 24.09: rând între licitații — după o tură (15 documente sau 15 min) cedăm locul, dacă mai e cineva la coadă;
    // main alege următoarea după ultimul_tick (cea mai veche), deci nicio licitație nu mai stă ore după alta
    if (citite + esuate.size >= 15 || Date.now() - t0Tura > 15 * 60_000) {
      const { data: altele } = await supabase.from('ofertare_ingest_coada').select('licitatie_id').eq('activ', true).neq('licitatie_id', licId).limit(1)
      if (altele?.length) { log(`#${licId} citire: cedez rândul (${citite} citite în tura asta)`); return }
    }
    const lista = (await candidati(supabase, licId)).filter(d => !esuate.has(d.id))
    if (!lista.length) break
    const d = lista[0]
    stare(`citesc ${String(d.nume_original || d.id).split('/').pop()} (${citite + 1}; ${lista.length} rămase)`)
    const t0 = Date.now()
    let rez = ''
    try { rez = await citesteDocument(supabase, d, c.cerut_de ?? null) } catch (e) { rez = 'eroare: ' + String((e as Error)?.message ?? e) }
    log(`#${licId} doc ${d.id} „${String(d.nume_original).slice(-50)}" → ${rez} · ${Math.round((Date.now() - t0) / 1000)} s`)
    if (rez.startsWith('eroare')) {
      esuate.add(d.id)
      await supabase.from('ofertare_documente_atribuire').update({ status_procesare: 'eroare', eroare: rez.slice(0, 500) }).eq('id', d.id).in('status_procesare', ['neprocesat', 'in_lucru'])
    } else citite++
    await supabase.from('ofertare_ingest_coada').update({ ultimul_tick: new Date().toISOString(), lansari: (c.lansari ?? 0) + citite + esuate.size }).eq('licitatie_id', licId)
  }
  if (esteOprire()) return
  const { data: toate } = await supabase.from('ofertare_documente_atribuire').select('status_procesare').eq('licitatie_id', licId).not('fisier_path', 'like', '%/neincarcat/%')
  const n = (s: string[]) => (toate ?? []).filter(d => s.includes(d.status_procesare)).length
  const nota = `${n(['procesat'])} procesate, ${n(['partial'])} parțiale, ${n(['eroare', 'neprocesat', 'in_lucru'])} cu eroare/epuizate (worker NAS: ${citite} citite acum, ${esuate.size} eșuate)`
  await supabase.from('ofertare_ingest_coada').update({ activ: false, terminat_la: new Date().toISOString(), nota, ultimul_tick: new Date().toISOString() }).eq('licitatie_id', licId)
  if (c.cerut_de) {
    const { data: li } = await supabase.from('ofertare_licitatii').select('nr_anunt').eq('id', licId).maybeSingle()
    await supabase.from('notifications').insert({ profile_id: c.cerut_de, type: 'info', modul: 'Ofertare', title: `Ofertare: citirea documentelor s-a terminat la ${li?.nr_anunt ?? '#' + licId}`, message: `${nota}. Poți extrage cerințele.`, link_to: '/ofertare' })
  }
  log(`#${licId}: GATA — ${nota}`)
}
