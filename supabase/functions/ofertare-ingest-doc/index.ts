// v13 (30.09.2026, DRAFT, nedeployat): GARDA — fără cale anonimă (secret de serviciu sau utilizator cu acces Ofertare),
// contor persistent de încercări/descărcări cu blocare, scurtcircuit pe mărime+etag/sha256. Vezi docs/INGEST_GARDA.md.
// v13 runda 2 (NO-GO Copilot r1): lease + token de încercare (o singură încercare pe document; „in_curs” = fără descărcare);
// după „continua”, ORICE drum (succes, eroare, excepție, skip pe sha256) se închide cu EXACT un _rezultat (cuIncercare);
// EGRESS MĂRGINIT, nu „fără re-download”: fiecare invocare descarcă obiectul întreg (≤ 60 MiB — acum și după mărimea din
// Storage, nu doar size_bytes din BD), de cel mult 80 de ori pe document între două reactivări ⇒ ≤ 4 800 MiB/document.
// v12 (14.09.2026): thinking disabled pe Sonnet 5 (gândea implicit în bugetul de output).
// #51 14.09.2026: autorizat() — owner/responsabil, service_role, sau anon doar cu ofertare_ingest_coada activă.
// ofertare-ingest-doc v11 (10.09.2026) — marcajele pornesc de la pagina_offset+1.
// v10 (10.09.2026) — Sonnet pe documente critice + renumerotare marcaje.
// v9 (09.09.2026) — {apeluri:N} din body (workerul server cere 1).
// v8 (09.09.2026) — CITIRE COMPLETĂ, DOVEDIBILĂ.
// v11: marcajele pornesc de la pagina_offset+1, nu de la 1. Documentele prea mari sunt
// tăiate de /api/pdf-sparge în bucăți separate („… — p02_pag49-72.pdf"); înainte, fiecare bucată se
// numerota de la 1, deci o cerință din bucata a doua ieșea cu „pagina 3" când în documentul real era
// pagina 51. Numele fișierului știa adevărul; acum îl știe și coloana pagina_offset.
// v8 (Faza 1 corectitudine): (1) fiecare pagină e marcată în text cu ⟦PAGINA N⟧, ca
// extragerea cerințelor să poată spune pagina-sursă; (2) o felie prea mare se
// înjumătățește până la o pagină înainte să renunțăm; (3) paginile pe care chiar nu
// le putem citi intră în `pagini_necitite`, iar documentul primește status 'partial',
// nu 'procesat' — până acum o pagină sărită era numărată ca procesată (planșele
// 130–132 la Mânăstirea aveau 39 de caractere și status verde).
// v7: CORS complet cu x-client-info. v6: felia persistată. v5: 2 apeluri/invocare.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1'
import { GARDA, identificaApelant, dejaIngeratLaHash, sha256Hex, plasaExactOnce, type Incercare } from '../_shared/gardaIngestLogica.ts'
import { metaObiect, gardaIncearca, incercareGarda } from '../_shared/gardaIngest.ts'
import { descarcaCuJurnal } from '../_shared/egress.ts'   // monitor egress (docs/MONITOR_EGRESS.md), fail-open — garda de mai sus rămâne fail-closed

// Punctul de injecție pentru testul handler-ului (garda_test.ts): producția folosește createClient-ul real.
export const _deps = { createClient: createClient as (url: string, key: string, opt?: any) => any }

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const BUCKET = 'ofertare'
// v10: cititorul depinde de tipul documentului. Testul din 10.09 (fișa Mănăstirea, 23 pag):
// Haiku nu pierde conținut, dar mută text între pagini (4 din 23 greșite); Sonnet ≈ Opus.
// Documentele critice (fișa de date, clarificări, formulare) → Sonnet 5, felii de 2 pagini;
// volumele (caiete, planșe, alta) → Haiku, felii de 8.
const MODELE: Record<string, { id: string; in: number; out: number; felie: number }> = {
  haiku: { id: 'claude-haiku-4-5-20251001', in: 1 / 1e6, out: 5 / 1e6, felie: 8 },
  sonnet: { id: 'claude-sonnet-5', in: 3 / 1e6, out: 15 / 1e6, felie: 2 },
}
const TIPURI_CRITICE = ['fisa_date', 'clarificare', 'raspuns_clarificare', 'formular']
const APELURI_PER_INVOCARE = 2
const MAX_CHUNK_BYTES = 24_000_000
const MAX_TEXT = 900_000
const MAX_OUT = 8000

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ingest-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

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
  const gasite = [...txt.matchAll(/⟦PAGINA (\d+)⟧/g)]
  if (!gasite.length) return `⟦PAGINA ${s + 1}${e - s > 1 ? `-${e}` : ''}⟧\n` + txt
  // v10: RENUMEROTARE. Știm exact ce pagini conține felia (s+1..e). Dacă modelul a pus
  // exact atâtea marcaje câte pagini, le rescriem secvențial (modelul repetă uneori numărul
  // tipărit pe foaie, nu pe cel fizic). Dacă numărul diferă, păstrăm doar marcajele din
  // intervalul feliei și le lăsăm cum sunt — mai bine o pagină ±1 decât o etichetă inventată.
  const nr = e - s
  if (gasite.length === nr) {
    let i = 0
    return txt.replace(/⟦PAGINA \d+⟧/g, () => `⟦PAGINA ${s + 1 + (i++)}⟧`)
  }
  return txt.replace(/⟦PAGINA (\d+)⟧/g, (m, p) => { const n = Number(p); return (n >= s + 1 && n <= e) ? m : `⟦PAGINA ${Math.min(Math.max(n, s + 1), e)}⟧` })
}

// v13 GARDA (înlocuiește autorizat() din #51): cheia anon NU mai trece niciodată (era calea „coada activă" a tick-ului
// pg_cron — cheia anon e publică, deci oricine putea porni citiri plătite cât o coadă era activă). Rolul NU se mai
// citește din payload-ul JWT decodat local. Căi permise:
//  - workerul NAS: header x-ingest-secret = OFERTARE_INGEST_SECRET (comparat în timp constant); uid = coada.cerut_de;
//  - utilizator: JWT verificat de Auth + fn_are_acces_ofertare() (owner sau user_module_access 'ofertare')
//    ȘI, fiind o acțiune care costă, owner sau responsabilul licitației (poarta pe cheltuială #51 rămâne).
async function autorizat(req: Request, supabase: any, licId: number): Promise<{ eroare: string | null; status: number; uid: string | null }> {
  const url = Deno.env.get('SUPABASE_URL')!, anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const clientUser = (jwt: string) => _deps.createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } })
  const id = await identificaApelant(req.headers, {
    secretAsteptat: Deno.env.get('OFERTARE_INGEST_SECRET'),
    getUser: async (jwt) => { const { data } = await clientUser(jwt).auth.getUser(); return data?.user?.id ?? null },
    areAcces: async (jwt) => { const { data, error } = await clientUser(jwt).rpc('fn_are_acces_ofertare'); return !error && data === true },
  })
  if (id.tip === 'refuz') return { eroare: id.motiv, status: id.status, uid: null }
  if (id.tip === 'serviciu') {
    const { data } = await supabase.from('ofertare_ingest_coada').select('cerut_de').eq('licitatie_id', licId).maybeSingle()
    return { eroare: null, status: 200, uid: data?.cerut_de || null }
  }
  const [{ data: prof }, { data: lic }] = await Promise.all([
    supabase.from('profiles').select('is_owner').eq('id', id.uid).maybeSingle(),
    supabase.from('ofertare_licitatii').select('responsabil_id').eq('id', licId).maybeSingle(),
  ])
  if (prof?.is_owner || (lic?.responsabil_id && lic.responsabil_id === id.uid)) return { eroare: null, status: 200, uid: id.uid }
  return { eroare: 'Citirea integrală o pornește doar ownerul sau responsabilul licitației (costă).', status: 403, uid: null }
}

const JUNK_RE = /(^|\/)__MACOSX(\/|$)|(^|\/)\.DS_Store$|(^|\/)\._[^/]*$|(^|\/)Thumbs\.db$|(^|\/)desktop\.ini$/i

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const supabase = _deps.createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let docId: number | null = null
  let pornitDe: string | null = null   // cine a pornit citirea (procesat_de)
  // încercarea acordată de gardă (token + lease); null până la „continua”. inchide() trimite _rezultat O SINGURĂ dată.
  let inc: Incercare | null = null

  const fail = async (msg: string) => {
    // runda 3 (J2): cu token, starea 'eroare' se scrie de server ATOMIC cu eșecul (o încercare preluată nu mai atinge documentul);
    // fără token (erori înainte de gardă, fără descărcare), ca înainte
    if (inc) await inc.inchide({ rezultat: 'esec', eroare: msg, doc: { status_procesare: 'eroare', eroare: msg.slice(0, 500) } })
    else if (docId) { try { await supabase.from('ofertare_documente_atribuire').update({ status_procesare: 'eroare', eroare: msg.slice(0, 500) }).eq('id', docId) } catch (_) {} }
    return new Response(JSON.stringify({ error: msg }), { status: 200, headers: CORS })
  }

  try {
    const { doc_id, reia, apeluri, model } = await req.json()
    // Workerul de pe server (cron + pg_net) cere {apeluri:1}: gateway-ul taie la 150s (IDLE_TIMEOUT),
    // iar două felii de scan cu Haiku pot depăși; din browser rămân 2 apeluri.
    const apeluriMax = Math.max(1, Math.min(Number(apeluri) || APELURI_PER_INVOCARE, APELURI_PER_INVOCARE))
    docId = Number(doc_id)
    if (!docId) return new Response(JSON.stringify({ error: 'doc_id required' }), { status: 400, headers: CORS })
    { const { data: dl } = await supabase.from('ofertare_documente_atribuire').select('licitatie_id').eq('id', docId).maybeSingle()
      const na = await autorizat(req, supabase, Number(dl?.licitatie_id))
      if (na.eroare) { const id = docId; docId = null; return new Response(JSON.stringify({ error: na.eroare, doc_id: id }), { status: na.status, headers: CORS }) }   // fără marcarea documentului ca eroare
      pornitDe = na.uid }

    let { data: row, error: rErr } = await supabase.from('ofertare_documente_atribuire').select('*').eq('id', docId).single()
    if (rErr || !row) return new Response(JSON.stringify({ error: 'document negasit' }), { status: 404, headers: CORS })
    // 22.09.2026 (Jilava): resturile de arhiva macOS (__MACOSX/._X.pdf = resource fork AppleDouble, .DS_Store)
    // nu sunt documente — 212-268 bytes fara antet PDF. Cazute pe 'eroare', se reluau la fiecare Procesare.
    // Se marcheaza 'ignorat' inainte de orice download/parsare, ca sa iasa din coada (UI + ofertare_ingest_tick).
    if (JUNK_RE.test(row.nume_original || '') || JUNK_RE.test(row.fisier_path || '')) {
      await supabase.from('ofertare_documente_atribuire').update({ status_procesare: 'ignorat', eroare: 'fisier de sistem (macOS __MACOSX/._* sau .DS_Store) — nu e document, nu se citeste' }).eq('id', docId)
      return new Response(JSON.stringify({ ok: true, skip: 'fisier de sistem', continua: false }), { headers: CORS })
    }
    // 'partial' se poate relua de la zero cu {reia:true} (ex. după ce s-a mărit plafonul);
    // 'procesat' nu se reia — ar dubla costul fără motiv.
    let reiaDeLaZero = reia === true && row.status_procesare === 'partial'
    if (row.status_procesare === 'procesat' || (row.status_procesare === 'partial' && !reiaDeLaZero)) {
      return new Response(JSON.stringify({ ok: true, skip: 'deja ' + row.status_procesare, continua: false, pagini_necitite: row.pagini_necitite || [] }), { headers: CORS })
    }
    // ANTI-BUG 15.09.2026: testul era `\.pdf$`, deci sarea tacut fisierele pe care SEAP le
    // normalizeaza cu sufix numeric ("Caiet de sarcini-LA PT(2).pdf" -> "Caiet de sarcini-LA PT.pdf 2").
    // Alea erau marcate 'ignorat' ca non-PDF si nu se citeau NICIODATA, fara ca cineva sa afle.
    if (!/\.pdf\s*\d*$/i.test(row.nume_original || row.fisier_path)) {
      await supabase.from('ofertare_documente_atribuire').update({ status_procesare: 'ignorat', eroare: 'doar PDF se proceseaza in M1 (docx/xls/dwg raman ca fisiere)' }).eq('id', docId)
      return new Response(JSON.stringify({ ok: true, skip: 'non-pdf', continua: false }), { headers: CORS })
    }
    // Plansele au calea lor (ofertare-plansa-citeste): citite ca PDF obisnuit, o scanare A0 nu da
    // text util si ramane agatata pe 'in_lucru'. Fisierele deja sparte se citesc prin bucatile lor.
    // Poarta principala e la selectie (UI + ofertare_ingest_tick); asta e plasa de siguranta, ca un
    // apel direct cu doc_id sa nu ocoleasca regula. NU se marcheaza 'ignorat' — starea lor e corecta.
    if (row.tip === 'plansa') {
      return new Response(JSON.stringify({ ok: true, skip: 'plansa - se citeste cu ofertare-plansa-citeste', continua: false }), { headers: CORS })
    }
    {
      const { data: spart } = await supabase.rpc('ofertare_doc_are_bucati', {
        p_licitatie_id: row.licitatie_id, p_doc_id: row.id, p_nume: row.nume_original,
      })
      if (spart === true) {
        return new Response(JSON.stringify({ ok: true, skip: 'spart in bucati - se citesc bucatile', continua: false }), { headers: CORS })
      }
    }
    // 25.09.2026 (Huedin 770, 99,9 MB): PDF-ul ucidea worker-ul (Memory limit exceeded) după ce doc-ul era pus
    // 'in_lucru', iar coada îl relua la ~6 s la nesfârșit. 'ignorat' nu se mai reia; peste prag → 'ignorat' explicit.
    if (row.status_procesare === 'ignorat') {
      return new Response(JSON.stringify({ ok: true, skip: 'ignorat', continua: false }), { headers: CORS })
    }
    if (Number(row.size_bytes) > 60 * 1024 * 1024) {
      await supabase.from('ofertare_documente_atribuire').update({ status_procesare: 'ignorat',
        eroare: `prea mare pentru citirea automată (${Math.round(Number(row.size_bytes) / 1048576)} MB > 60 MB) — de spart pe bucăți / procesat pe NAS` }).eq('id', docId)
      return new Response(JSON.stringify({ ok: true, skip: 'prea mare', continua: false }), { headers: CORS })
    }
    // Runda 2 (egress mărginit): mărimea REALĂ din Storage (metadata, fără octeți) peste prag → același refuz, fără descărcare.
    // size_bytes din BD poate lipsi/fi greșit; plafonul „≤ 60 MiB pe descărcare” nu mai depinde doar de el.
    const meta = await metaObiect(supabase, BUCKET, row.fisier_path)
    if (Number(meta?.size) > GARDA.pragEdgeBytes) {
      await supabase.from('ofertare_documente_atribuire').update({ status_procesare: 'ignorat', size_bytes: Number(meta!.size),
        eroare: `prea mare pentru citirea automată (${Math.round(Number(meta!.size) / 1048576)} MB > 60 MB, mărimea din Storage) — de spart pe bucăți / procesat pe NAS` }).eq('id', docId)
      return new Response(JSON.stringify({ ok: true, skip: 'prea mare', continua: false }), { headers: CORS })
    }
    // GARDA (2)+(3): înainte de orice descărcare — blocat / backoff / altă încercare în curs / același fișier deja citit →
    // fără descărcare. „continua” vine cu un token + lease (10 min); de aici ÎNCOLO orice ieșire închide încercarea exact o dată.
    // reia (partial → de la zero) e o cerere explicită a omului: fără scurtcircuitul mărime+etag (altfel „deja_ingerat” o bloca).
    const garda = await gardaIncearca(supabase, docId, reiaDeLaZero ? null : meta, 'edge:ofertare-ingest-doc')
    if (garda.actiune !== 'continua') {
      const id = docId; docId = null   // NU trece prin fail(): documentul nu se marchează 'eroare' (nu reintră în coadă)
      return new Response(JSON.stringify({ ok: false, garda: garda.actiune, error: 'garda: ' + garda.motiv, pana_la: (garda as any).pana_la, doc_id: id, continua: false }), { headers: CORS })
    }
    inc = incercareGarda(supabase, docId, garda.token!)
    // Runda 3 (J1): `row` a fost citit ÎNAINTE de token — între timp altă încercare poate fi avansat/încheiat documentul.
    // Acum lease-ul e al nostru (nimeni altcineva nu mai scrie): recitim și recalculăm TOT ce depinde de stare (reia, start,
    // pagini_procesate, text_extras, pagini_necitite). Încheiat/ignorat între timp → închidem 'predat' (contoare neatinse), fără descărcare.
    {
      const { data: acum, error: eAcum } = await supabase.from('ofertare_documente_atribuire').select('*').eq('id', docId).single()
      if (eAcum || !acum) return await fail('recitire după token: ' + (eAcum?.message || 'lipsă'))
      row = acum
      reiaDeLaZero = reia === true && row.status_procesare === 'partial'
      if (row.status_procesare === 'procesat' || (row.status_procesare === 'partial' && !reiaDeLaZero) || row.status_procesare === 'ignorat') {
        await inc.inchide({ rezultat: 'predat', eroare: 'documentul s-a încheiat între timp: ' + row.status_procesare })
        return new Response(JSON.stringify({ ok: true, skip: 'deja ' + row.status_procesare + ' (recitit sub lease)', continua: false }), { headers: CORS })
      }
    }
    const M = MODELE[(typeof model === 'string' && MODELE[model]) ? model : (TIPURI_CRITICE.includes(row.tip) ? 'sonnet' : 'haiku')]
    const MODEL = M.id, PRICE_IN = M.in, PRICE_OUT = M.out, PAGINI_PER_FELIE = M.felie

    const { data: blob, error: dlErr } = await descarcaCuJurnal(supabase, BUCKET, row.fisier_path, 'edge:ofertare-ingest-doc', row.id ?? docId)
    if (dlErr || !blob) return await fail('download: ' + (dlErr?.message || 'lipsa'))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const hash = await sha256Hex(bytes)
    // Plasă: statusurile încheiate ies deja mai sus (fără gardă, fără descărcare), deci ramura e azi inaccesibilă; dacă se
    // atinge vreodată, încercarea se închide ca 'succes' (amprenta e aceeași), iar statusul documentului NU se atinge
    // (in_lucru se scrie abia după ea).
    if (dejaIngeratLaHash({ ingerat_hash: garda.ingerat_hash ?? null } as any, hash, ['procesat', 'partial'].includes(row.status_procesare) && !reiaDeLaZero)) {
      await inc.inchide({ rezultat: 'succes', hash, size: bytes.length, etag: meta?.etag ?? null })
      return new Response(JSON.stringify({ ok: true, skip: 'același sha256 deja citit', continua: false }), { headers: CORS })
    }
    // runda 3 (J2): marcajul in_lucru trece tot prin gardă (scris doar cu tokenul activ; prelungește lease-ul)
    const mk = await inc.marcheaza({ status_procesare: 'in_lucru', eroare: null, procesat_de: pornitDe, procesat_la: new Date().toISOString() })
    if (mk?.acceptat !== true) {
      const id = docId; docId = null
      return new Response(JSON.stringify({ ok: false, garda: 'token_pierdut', error: 'garda: lease-ul nu mai e al nostru — nu citesc', doc_id: id, continua: false }), { headers: CORS })
    }

    let pdf: PDFDocument
    try { pdf = await PDFDocument.load(bytes, { ignoreEncryption: true }) }
    catch (e: any) { return await fail('PDF corupt/necititbil: ' + (e?.message || e)) }
    const nPag = pdf.getPageCount()

    const bytesPerPage = bytes.length / Math.max(nPag, 1)
    const feliaMax = Math.max(1, Math.min(PAGINI_PER_FELIE, Math.floor(MAX_CHUNK_BYTES / Math.max(bytesPerPage * 1.4, 1))))
    const off = Math.max(0, Number(row.pagina_offset) || 0)   // câte pagini are originalul înaintea acestei bucăți
    const start = reiaDeLaZero ? 0 : Math.min(Math.max(row.pagini_procesate || 0, 0), nPag)
    let poz = start
    let felie = Math.max(1, Math.min(row.pagini_felie || feliaMax, feliaMax))
    let textNou = ''
    let antet: any = null
    let pareScanat: boolean | null = null
    let tokIn = 0, tokOut = 0
    // paginile necitite se acumulează peste invocări (documentul mare se citește în mai multe runde)
    const necitite = new Set<number>(reiaDeLaZero ? [] : ((row.pagini_necitite as number[] | null) || []))

    for (let apel = 0; apel < apeluriMax && poz < nPag; apel++) {
      const s = poz, e = Math.min(poz + felie, nPag)
      // numerotarea pe care o vede omul: pagina din documentul ORIGINAL, nu din bucată
      const sAbs = s + off, eAbs = e + off
      let pdfFelie: Uint8Array
      try { pdfFelie = (s === 0 && e === nPag) ? bytes : await feliePdf(pdf, s, e) }
      catch (er: any) { return await fail(`split pagini ${sAbs + 1}-${eAbs}: ` + (er?.message || er)) }

      if (pdfFelie.length > MAX_CHUNK_BYTES + 4_000_000) {
        // Prea mare: înjumătățim felia și încercăm din nou, până la o singură pagină.
        if (e - s > 1) { felie = Math.max(1, Math.ceil((e - s) / 2)); apel--; continue }
        // O singură pagină și tot prea mare: se notează cinstit ca necitită, nu ca procesată.
        necitite.add(sAbs + 1)
        textNou += `\n${marcaj(sAbs + 1)}\n[PAGINA ${sAbs + 1}: NECITITĂ — fișier prea mare pentru citire (${(pdfFelie.length / 1e6).toFixed(0)} MB)]\n`
        poz = e
        continue
      }

      const primaFelie = s === 0
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL, max_tokens: MAX_OUT,
          // Sonnet 5 gândește implicit (adaptive) și gândirea intră în max_tokens — la transcriere e inutilă și scumpă.
          ...(MODEL === MODELE.sonnet.id ? { thinking: { type: 'disabled' } } : {}),
          messages: [{ role: 'user', content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64(pdfFelie) } },
            { type: 'text', text: primaFelie ? PROMPT_ANTET(sAbs + 1, e - s) : PROMPT_TEXT(sAbs + 1, e - s) },
          ] }],
        }),
      })
      const data = await resp.json()
      if (!resp.ok) return await fail(`Claude paginile ${sAbs + 1}-${eAbs}: ` + (data.error?.message || resp.status))
      tokIn += data.usage?.input_tokens || 0; tokOut += data.usage?.output_tokens || 0

      if (data.stop_reason === 'max_tokens' && (e - s) > 1) {
        felie = Math.max(1, Math.ceil((e - s) / 2))
        continue
      }

      let txt = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
      if (data.stop_reason === 'max_tokens') {
        // O singură pagină care nu încape în plafon: parțial citită = necitită, ca să nu
        // pretindem ce n-avem. Textul rămâne, e util, dar pagina e marcată.
        txt += `\n[PAGINA ${sAbs + 1}: transcriere trunchiată la plafon — pagină extrem de densă]\n`
        necitite.add(sAbs + 1)
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
      textNou += asiguraMarcaje(txt, sAbs, eAbs) + '\n'
      poz = e
      if (((start === 0 ? '' : (row.text_extras || '')).length + textNou.length) > MAX_TEXT) {
        // Plafonul de text atins: restul paginilor NU sunt citite — se spune explicit.
        for (let p = poz + 1; p <= nPag; p++) necitite.add(p + off)
        textNou += `\n[TRUNCHIAT la 900k caractere — paginile ${poz + 1 + off}-${nPag + off} necitite]`
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
    // încheiat → 'succes' (memorează amprenta: nu se mai descarcă); felie citită, documentul continuă → 'progres'.
    // Runda 3 (J2): documentul se scrie de SERVER, în aceeași tranzacție cu verificarea tokenului — o încercare veche nu mai
    // poate suprascrie progresul uneia noi. Respins → nimic scris; RPC pierdut → rezultat NECONFIRMAT (stare necunoscută).
    await inc.inchide({ rezultat: gata ? 'succes' : 'progres', hash, size: bytes.length, etag: meta?.etag ?? null, doc: upd })
    if (inc.raspuns?.acceptat !== true) {
      const id = docId; docId = null
      return new Response(JSON.stringify({ ok: false, garda: 'rezultat_respins', error: 'garda: rezultat NECONFIRMAT — respins (token vechi/străin) sau fără răspuns (stare necunoscută): ' + (inc.raspuns?.motiv ?? 'fără răspuns'), doc_id: id, continua: false }), { headers: CORS })
    }

    return new Response(JSON.stringify({ ok: true, doc_id: docId, pagini: nPag, pagini_procesate: poz, pagini_necitite: listaNecitite, status: upd.status_procesare, continua: !gata, caractere: textAcum.length, felie, antet: start === 0 ? antet : undefined, tokens_in: tokIn, tokens_out: tokOut }), { headers: CORS })
  } catch (e: any) {
    // excepție după „continua” → fail() închide încercarea ca 'esec' cu mesajul ei (o singură dată)
    return await fail('Eroare neasteptata: ' + String(e?.message || e))
  } finally {
    // plasa exact-once: un drum care s-a întors fără să închidă încercarea o închide aici ca 'esec'
    await plasaExactOnce(inc)
  }
})
