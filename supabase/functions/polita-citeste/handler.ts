// polita-citeste — logica (Polite 20261205a, etapa 1). Citirea PLATITA a primelor 2 pagini dintr-o polita / un act aditional,
// la incarcare, ca PROPUNERE de confirmat de om (nimic nu devine polita fara fn_polita_salveaza).
// Poarta (nu verify_jwt): JWT -> getUser; clientul UTILIZATORULUI cheama fn_poate_scrie_polite() (owner / gestioneaza contracte /
// scrie garantii). Poarta pe cheltuiala (L22): o singura citire pe document (polite_propuneri UNIQUE sha256 + cititor, rezervata
// INAINTE de apel), apoi plafonul lunar fn_ai_plafon_rezerva('polita_citire', 5 USD) -> count_tokens (gratuit) -> apel -> decontare.
// Continut EXTERN (PDF de la asigurator): trimis ca bloc document, promptul il declara DATE; raspunsul trece prin schema stricta
// (normalizeazaPropunere, L21). Erorile de business se intorc (JSON), nu se arunca. Timeout / 5xx dupa pornirea apelului = cost
// necunoscut: rezerva ramane consumata, propunerea „eroare”, fara reluare automata (L05).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { PDFDocument } from 'npm:pdf-lib@1.17.1'
import { costApel, jsonDinText, mesajRefuz, textRaspuns } from '../_shared/haiku55.ts'
import { faraGandire, SONNET_55 } from '../_shared/gandire.ts'
import { EroarePolita, MAX_PDF_BYTES, PAGINI_CITITE, normalizeazaPropunere, promptPolita } from '../_shared/polite.mjs'

export const MODEL_POLITA = SONNET_55
export const MAX_TOKENS_POLITA = 2500
export const LIMITA_INPUT_POLITA = 40000
// rezerva = limita de intrare + iesirea maxima la pretul Sonnet 5.5 (2 / 10 USD pe 1M), rotunjita in sus
export const REZERVA_POLITA = 0.11
export const CHEIE_PLAFON = 'polita_citire'
export const PLAFON_LUNAR = 5
const BUCKET = 'contracte-terti'

export type DepsPolita = { transport?: typeof fetch; acum?: () => number }

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }
const dinB64 = (s: string) => { const t = atob(s); const u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u }

export async function citestePolita(req: Request, body: unknown, caller: SupabaseClient, ledger: SupabaseClient, apiKey: string | undefined,
                                    cors: Record<string, string>, deps: DepsPolita = {}) {
  const transport = deps.transport ?? fetch
  const raspuns = (status: number, data: Record<string, unknown>) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  let propunereId: number | null = null, rezervare: number | null = null
  let cost: number | null = 0          // 0 pana la pornirea apelului platit; null = necunoscut dupa
  let decontat = false
  const deconteaza = async () => {
    if (rezervare === null || decontat) return
    decontat = true
    const { error } = await ledger.rpc('fn_ai_plafon_deconteaza', { p_id: rezervare, p_cost_real: cost })
    if (error) throw new EroarePolita('decontare_indisponibila', 503)
  }
  const esec = async (cod: string) => {
    if (propunereId === null) return
    const { error } = await ledger.rpc('fn_polite_propunere_esec', { p_id: propunereId, p_cod: cod, p_cost: cost })
    if (error) console.error('esec', error.code)
  }
  const dinTabel = async (id: number) => {
    const { data, error } = await ledger.rpc('fn_polite_propunere_json', { p_id: id })
    if (error || !data) throw new EroarePolita('propunere_indisponibila', 503)
    return data as Record<string, unknown>
  }
  try {
    if (req.method !== 'POST') return raspuns(405, { success: false, eroare: 'metoda_invalida' })
    // 1. cine cheama + dreptul, prin clientul utilizatorului (fail closed)
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return raspuns(401, { success: false, eroare: 'neautentificat' })
    const { data: u } = await caller.auth.getUser(jwt)
    if (!u?.user?.id) return raspuns(401, { success: false, eroare: 'neautentificat' })
    const { data: poate, error: ep } = await caller.rpc('fn_poate_scrie_polite')
    if (ep || poate !== true) return raspuns(403, { success: false, eroare: 'fara_drept' })
    // 2. intrarea: exact {pdf_base64}
    const b = body as Record<string, unknown>
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length !== 1 || typeof b.pdf_base64 !== 'string') {
      return raspuns(400, { success: false, eroare: 'cerere_invalida' })
    }
    if (b.pdf_base64.length > Math.ceil(MAX_PDF_BYTES / 3) * 4 + 4) return raspuns(413, { success: false, eroare: 'pdf_prea_mare' })
    let pdf: Uint8Array
    try { pdf = dinB64(b.pdf_base64) } catch (_) { return raspuns(400, { success: false, eroare: 'cerere_invalida' }) }
    if (pdf.length > MAX_PDF_BYTES) return raspuns(413, { success: false, eroare: 'pdf_prea_mare' })
    if (new TextDecoder('latin1').decode(pdf.subarray(0, 5)) !== '%PDF-') return raspuns(422, { success: false, eroare: 'pdf_invalid' })
    const sha = hex(await crypto.subtle.digest('SHA-256', pdf))
    const cale = `polite/propuneri/${sha}.pdf`
    // 3. PDF-ul in spatiul propunerilor (cale = sha256), INAINTEA oricarui raspuns din cache (r3, Jakarinos r2 P2-2): obiectul existent se
    //    verifica dupa continut (poate fi fost inlocuit printr-o cale de scriere pe bucket); diferit = se reface din documentul primit acum.
    const { error: eu } = await ledger.storage.from(BUCKET).upload(cale, pdf, { contentType: 'application/pdf', upsert: false })
    if (eu) {
      if (!/exist|duplicate/i.test(eu.message || '')) return raspuns(503, { success: false, eroare: 'stocare_indisponibila' })
      const { data: blob, error: ed } = await ledger.storage.from(BUCKET).download(cale)
      if (ed || !blob) return raspuns(503, { success: false, eroare: 'stocare_indisponibila' })
      if (hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())) !== sha) {
        console.error('obiect propunere diferit de sha, refacut')
        const { error: er2 } = await ledger.storage.from(BUCKET).upload(cale, pdf, { contentType: 'application/pdf', upsert: true })
        if (er2) return raspuns(503, { success: false, eroare: 'stocare_indisponibila' })
      }
    }
    // 4. documentul deja citit (de oricare cititor: la incarcare sau local, noaptea): aceeasi propunere, fara cost.
    //    Preferinta: confirmat > propus > respins; o citire platita in curs / esuata blocheaza o noua citire platita (L05).
    const { data: vechi, error: ev } = await ledger.from('polite_propuneri').select('id, stare, cititor').eq('pdf_sha256', sha)
    if (ev || !Array.isArray(vechi)) return raspuns(503, { success: false, eroare: 'propunere_indisponibila' })
    const dinCache = async (p: { id: number; stare: string }) => {
      if (p.stare === 'in_citire') return raspuns(409, { success: false, eroare: 'citire_in_curs' })
      if (p.stare === 'eroare') return raspuns(409, { success: false, eroare: 'citire_esuata' })
      return raspuns(200, { success: true, din_cache: true, propunere: await dinTabel(p.id) })
    }
    const utilizabila = ['confirmat', 'propus', 'respins'].map(s => vechi.find(p => p.stare === s)).find(Boolean)
    if (utilizabila) return await dinCache(utilizabila)
    const platita = vechi.find(p => p.cititor === 'platit')
    if (platita) return await dinCache(platita)
    // 5. rezervarea citirii (o singura citire pe document, si intre ferestre / utilizatori)
    const { data: rz, error: er } = await ledger.rpc('fn_polite_propunere_rezerva', { p_sha: sha, p_user: u.user.id })
    if (er || !rz) return raspuns(503, { success: false, eroare: 'propunere_indisponibila' })
    if ((rz as { rezervat: boolean }).rezervat !== true) return await dinCache(rz as { id: number; stare: string })
    propunereId = Number((rz as { id: number }).id)
    // 6. primele pagini (pdf-lib, in proces); protejat / deteriorat = esec fara cost
    let bucata: string
    try {
      const src = await PDFDocument.load(pdf, { ignoreEncryption: false, updateMetadata: false })
      if (src.isEncrypted) throw new Error('criptat')
      const dst = await PDFDocument.create()
      const idx = [...Array(Math.min(PAGINI_CITITE, src.getPageCount())).keys()]
      if (!idx.length) throw new Error('gol')
      for (const p of await dst.copyPages(src, idx)) dst.addPage(p)
      bucata = b64(await dst.save())
    } catch (_) { throw new EroarePolita('pdf_invalid') }
    if (!apiKey) throw new EroarePolita('serviciu_neconfigurat', 503)
    // 7. plafonul lunar (rezervare inaintea apelului)
    const { data: idRez, error: ez } = await ledger.rpc('fn_ai_plafon_rezerva', { p_cheie: CHEIE_PLAFON, p_suma: REZERVA_POLITA, p_plafon_implicit: PLAFON_LUNAR, p_user: u.user.id })
    if (ez) throw new EroarePolita(ez.code === 'P0001' && /plafon_depasit/.test(ez.message || '') ? 'plafon_depasit' : 'rezervare_indisponibila', ez.code === 'P0001' ? 429 : 503)
    if (!Number.isSafeInteger(Number(idRez)) || Number(idRez) <= 0) throw new EroarePolita('rezervare_indisponibila', 503)
    rezervare = Number(idRez)
    const payload = {
      model: MODEL_POLITA, system: promptPolita(),
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bucata } },
        { type: 'text', text: 'Transcrie câmpurile documentului în formatul JSON cerut.' },
      ] }],
    }
    const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
    // 8. numararea (gratuita): pica / prea mult = esec fara cost
    const cnt = await transport('https://api.anthropic.com/v1/messages/count_tokens', { method: 'POST', headers, body: JSON.stringify({ ...payload, thinking: faraGandire(MODEL_POLITA) }), signal: AbortSignal.timeout(20000) })
      .catch(() => null)
    const tokeni = cnt?.ok ? await cnt.json().then(j => j.input_tokens).catch(() => null) : null
    if (!Number.isSafeInteger(tokeni) || tokeni <= 0) throw new EroarePolita('numarare_indisponibila', 502)
    if (tokeni > LIMITA_INPUT_POLITA) throw new EroarePolita('pdf_prea_mare')
    // 9. apelul platit: de aici costul e necunoscut pana la usage
    cost = null
    let rezultat
    try {
      const r = await transport('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({ ...payload, max_tokens: MAX_TOKENS_POLITA, thinking: faraGandire(MODEL_POLITA) }), signal: AbortSignal.timeout(90000) })
      if (!r.ok) throw new EroarePolita('apel_esuat', 502)
      rezultat = await r.json()
    } catch (e) { throw e instanceof EroarePolita ? e : new EroarePolita('termen_depasit', 504) }
    const us = rezultat?.usage
    if (Number.isSafeInteger(us?.input_tokens) && us.input_tokens >= 0 && Number.isSafeInteger(us?.output_tokens) && us.output_tokens >= 0) cost = costApel(MODEL_POLITA, us)
    await deconteaza()
    if (rezultat?.stop_reason === 'max_tokens') throw new EroarePolita('raspuns_incomplet')
    if (mesajRefuz(rezultat)) throw new EroarePolita('citire_refuzata')
    const obj = jsonDinText(textRaspuns(rezultat))
    const { campuri, dezacorduri } = normalizeazaPropunere(obj)
    // 10. propunerea completata (contractul / polita de baza le cauta BD-ul, pe numar normalizat)
    const { data: prop, error: ec } = await ledger.rpc('fn_polite_propunere_completeaza', { p_id: propunereId, p_campuri: campuri, p_dezacorduri: dezacorduri, p_model: MODEL_POLITA, p_cost: cost })
    if (ec || !prop) throw new EroarePolita('propunere_indisponibila', 503)
    propunereId = null
    return raspuns(200, { success: true, din_cache: false, propunere: prop, cost_usd: cost })
  } catch (e) {
    const cod = e instanceof EroarePolita ? e.cod : 'serviciu_indisponibil'
    try { await deconteaza() } catch (_) { /* decontarea nereusita: rezerva ramane, se vede in Cost AI */ }
    await esec(cod)
    return raspuns(e instanceof EroarePolita ? e.status : 502, { success: false, eroare: cod })
  }
}
