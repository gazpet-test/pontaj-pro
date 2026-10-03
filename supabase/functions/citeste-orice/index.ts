// citeste-orice v18 (20.08.2026) — AI Document Router
// v17: campuri structurate HR (CNP, IBAN...) pentru wizard „Angajat nou".
// v18: destinația UPA (unități protejate, plafonul lunar deductibil):
//   - respectă modul_tinta PRE-SETAT la upload (panoul UPA / context execuție)
//   - facturile clasificate financiar se re-rutează DETERMINIST spre 'upa' dacă
//     furnizorul (CUI sau nume) e marcat este_upa în logistica_furnizori
//   - extrage valoare_totala (total cu TVA) + campuri.cui pentru facturi
// UI converteste imaginile in PDF inainte de upload -> functia primeste mereu PDF.
// Erorile de business scriu DIRECT in DB cu return (fara throw — lectie 01.07).
// Poarta (03.10.2026, task #17, migrarea 20261011a): verify_jwt ramane true, dar cheia anon e un JWT valid
// pentru oricine (vezi PR #318). Singurul apelant legitim e trigger-ul trg_ai_inbox_clasificare (pg_net), care
// trimite acum x-intern-secret = Vault INTERN_EDGE_SECRET, verificat prin fn_verifica_secret. Fara antet: 401,
// fara sa atinga randul din inbox (inainte, oricine cu cheia anon putea reclasifica/cheltui AI pe orice inbox_id).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { esteApelIntern } from '../_shared/poartaIntern.ts'

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const BUCKET = 'ai-documente-inbox'
const MODEL = 'claude-sonnet-5'
const PRICE_IN = 3 / 1e6, PRICE_OUT = 15 / 1e6
const MAX_IMG_BYTES = 4_500_000

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey', 'Content-Type': 'application/json' }

const DEST_TABEL: Record<string, string> = {
  executie: 'executie_documente_contract',
  hr: 'hr_documente_personale',
  logistica: 'logistica_documente',
  financiar: 'contracte_subcontract_facturi',
  upa: 'upa_achizitii',
}

const STOP = new Set(['punere','siguranta','conducte','conducta','transport','gaze','naturale','natural','zona','judetul','jud','judet','subtraversare','subtrav','traversare','aeriana','raul','rau','cuplare','distributie','transgaz','lucrari','lucrare','santier','din','sau','catre','godevilabila','transformare','localitatii','localitate','racord','srm','cfi','pis','parau','paru'])

const PROMPT = `Esti un asistent care sorteaza documente pentru o firma romaneasca de constructii conducte de gaze (Gazpet Instal).
Analizeaza documentul si stabileste UNDE trebuie sa mearga in sistemul intern.

REGULA DE AUR: daca documentul este DESPRE O PERSOANA (act de identitate, stare civila, studii, calificare, angajare, incetare, aviz de munca, examinare medicala/psihologica, CV) -> modulul e "hr", CHIAR DACA in text apar cuvinte despre santier, lucrari sau conducte de gaze. Numele fisierului contine adesea numele persoanei — semnal puternic pentru hr.
NU inventa continut: daca scanul e ilizibil sau nu esti sigur ce e, pune modul null si confidence mic. E MULT mai bine null decat o clasificare gresita.

Module posibile (alege UNUL):
- "executie": documente despre un PROIECT/SANTIER/contract de LUCRARI — ordin de incepere/reincepere lucrari, ordin de sistare, act aditional la contractul de lucrari, aviz de constructie/traversare (emis de o autoritate PENTRU o lucrare), autorizatie de construire, contract sectorial de lucrari, grafic de executie, garantie de buna executie (scrisoare bancara/polita pentru un CONTRACT de lucrari), dispozitie de santier. ATENTIE: "garantie de buna executie" e un document BANCAR/contractual — o diploma sau un certificat de calificare NU e garantie.
- "hr": documente PERSONALE despre un ANGAJAT sau candidat. Coduri tip_document (foloseste-le exact):
  buletin (CI), pasaport, permis_conducere, permis_sedere (permis de sedere strain), aviz_de_munca (aviz de munca lucrator strain, emis de IGI/Inspectoratul pentru Imigrari),
  cert_nastere_angajat, cert_casatorie, cert_nastere_copil, adeverinta_scoala_copil,
  diploma_liceu, diploma_studii_sup, diploma_scoala_prof, cert_calificare, supliment_calificare,
  cazier_judiciar, contract_munca (CIM), dec_incetare_anterior (decizie incetare CIM / loc de munca anterior), adev_incetare_anterior (adeverinta vechime/incetare, extras REVISAL sau REGES),
  anexa7_cotizare, extras_cont_bancar, cerere_concediu, decizie_handicap, decl_persoane_intretinere, adeverinta_medic_familie,
  autorizatie_hr (autorizatii profesionale ISCIR/sudura/macaragiu/transport ale unei persoane),
  altul (CV, fisa de aptitudini/aviz psihologic, fisa post, GDPR, orice alt document personal).
- "logistica": documente despre un VEHICUL/UTILAJ — ITP, RCA, CASCO, tahograf vehicul, copie conforma.
- "financiar": factura, IPC, certificat de plata, situatie de plata (documente cu VALORI DE BANI pentru lucrari/furnizori).
- null: daca nu esti sigur.

entitate_hint: pentru executie=toponimele cheie; pentru hr=numele complet al persoanei (ia-l si din numele fisierului daca in scan nu se vede); pentru logistica=nr inmatriculare (ex PH22TNP) sau denumire utilaj; pentru financiar=FURNIZORUL (emitentul facturii, cel care VINDE). null daca nu apare.

tip_document — alege codul potrivit:
- executie: ordin_incepere|ordin_reincepere|act_aditional|aviz|autorizatie|contract|garantie_exec|grafic
- hr: codurile din lista de la modulul hr de mai sus
- logistica: itp|rca|casco|tahograf|copie_conforma
- financiar: factura|ipc|certificat_plata
- altul daca nu se incadreaza

campuri — extrage ce se VEDE clar in document (null pentru ce nu apare, NU inventa):
- buletin/pasaport/permis_sedere: {"cnp": "13 cifre", "nume_complet": "NUME PRENUME", "adresa": "domiciliul complet", "data_nasterii": "YYYY-MM-DD", "serie_numar": "seria+numarul actului"}
- extras_cont_bancar: {"iban": "RO...", "banca": "numele bancii", "nume_complet": "titularul"}
- cert_nastere_angajat: {"cnp": "...", "nume_complet": "...", "data_nasterii": "YYYY-MM-DD"}
- aviz_de_munca/permis_sedere au si date_document (numar, data_expirare) — completeaza-le acolo.
- factura: {"cui": "CUI/CIF-ul FURNIZORULUI (emitentului), ex RO12345678"}
Pentru orice alt tip: campuri = {}.

Raspunde EXCLUSIV JSON, fara text in plus, fara markdown:
{
  "modul": "executie"|"hr"|"logistica"|"financiar"|null,
  "tip_document": "<cod din lista de mai sus>",
  "titlu_scurt": "<descriere 3-8 cuvinte>",
  "entitate_hint": "<vezi mai sus, sau null>",
  "date_proiect": { "data_start": "<YYYY-MM-DD sau null>", "data_termen": "<YYYY-MM-DD sau null>", "durata_luni": <numar sau null>, "nr_ordin": "<text sau null>" },
  "date_document": { "numar": "<text sau null>", "data_emitere": "<YYYY-MM-DD sau null>", "data_expirare": "<YYYY-MM-DD sau null>", "emitent": "<text sau null>", "valoare_totala": <numar sau null> },
  "campuri": { "cnp": null, "nume_complet": null, "adresa": null, "data_nasterii": null, "serie_numar": null, "iban": null, "banca": null, "cui": null },
  "confidence": <0-100>
}
NOTA: date_proiect DOAR pentru executie. date_document pentru hr/logistica/financiar. valoare_totala = TOTALUL DE PLATA al facturii, cu TVA, ca numar simplu (ex 1234.56) — DOAR pentru facturi. Converteste datele romanesti in ISO YYYY-MM-DD.`

function fileToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}
function guessMime(nume: string, mime: string | null): string {
  if (mime && mime !== 'application/octet-stream') return mime
  const n = (nume || '').toLowerCase()
  if (n.endsWith('.pdf')) return 'application/pdf'
  if (n.endsWith('.png')) return 'image/png'
  if (n.endsWith('.webp')) return 'image/webp'
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg'
  return 'application/pdf'
}

function norm(s: string): string { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
function words(s: string, useStop = true): string[] { return norm(s).split(' ').filter(w => w.length >= 3 && (!useStop || !STOP.has(w))) }
function scorMatch(hint: string, target: string, useStop = true): { score: number, hits: number, maxLen: number } {
  const hw = new Set(words(hint, useStop)); const tw = words(target, useStop)
  if (!hw.size || !tw.length) return { score: 0, hits: 0, maxLen: 0 }
  let hit = 0, maxLen = 0
  for (const w of tw) if (hw.has(w)) { hit++; if (w.length > maxLen) maxLen = w.length }
  const denom = Math.min(tw.length, Math.max(hw.size, 1))
  return { score: hit / Math.max(denom, 1), hits: hit, maxLen }
}
function bestMatch(hint: string, lista: any[], campuri: string[], useStop = true): { id: any, conf: number } | null {
  let best: any = null, bestScore = 0, bestHits = 0, bestMaxLen = 0
  for (const item of (lista || [])) {
    let s = 0, h = 0, ml = 0
    for (const c of campuri) { const r = scorMatch(hint, item[c] || '', useStop); if (r.score > s) { s = r.score; h = r.hits; ml = r.maxLen } }
    if (s > bestScore) { bestScore = s; bestHits = h; bestMaxLen = ml; best = item }
  }
  if (best && bestScore >= 0.5 && (bestHits >= 2 || bestMaxLen >= 6)) return { id: best.id, conf: Math.round(bestScore * 100) }
  return null
}
function plateNorm(s: string): string { return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '') }

async function callClaude(base64: string, mime: string, fisierNume: string): Promise<{ ok: boolean, data?: any, err?: string }> {
  const isImg = mime.startsWith('image/')
  const block = isImg ? { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } } : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
  const text = PROMPT + (fisierNume ? `\n\nNumele fisierului incarcat (semnal important pentru clasificare): "${fisierNume}"` : '')
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, messages: [{ role: 'user', content: [block, { type: 'text', text }] }] }),
  })
  const data = await resp.json()
  if (!resp.ok) return { ok: false, err: `Claude: ${data.error?.message || resp.status}` }
  return { ok: true, data }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  if (!(await esteApelIntern(req, supabase))) return new Response(JSON.stringify({ error: 'neautorizat' }), { status: 401, headers: CORS })
  let inboxId: number | null = null

  const eroare = async (msg: string) => {
    if (inboxId) { try { await supabase.from('ai_documente_inbox').update({ status: 'eroare', ai_eroare: msg }).eq('id', inboxId) } catch (_) {} }
    return new Response(JSON.stringify({ error: msg }), { status: 200, headers: CORS })
  }

  try {
    const body = await req.json()
    inboxId = body.inbox_id
    if (!inboxId) return new Response(JSON.stringify({ error: 'inbox_id required' }), { status: 400, headers: CORS })

    const { data: row, error: rErr } = await supabase.from('ai_documente_inbox').select('*').eq('id', inboxId).single()
    if (rErr || !row) return new Response(JSON.stringify({ error: 'Rand inbox negasit' }), { status: 404, headers: CORS })
    if (row.status === 'confirmat' || row.status === 'respins') return new Response(JSON.stringify({ ok: true, skip: 'deja ' + row.status }), { headers: CORS })

    const mime = guessMime(row.fisier_nume, row.fisier_mime)
    const esteImagine = mime.startsWith('image/')
    if (esteImagine && row.fisier_size_bytes && row.fisier_size_bytes > MAX_IMG_BYTES)
      return await eroare('Poza e prea mare pentru citire automata (' + (row.fisier_size_bytes / 1e6).toFixed(1) + ' MB). Reincarc-o — se converteste automat in PDF.')

    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(row.fisier_path)
    if (dlErr || !blob) return await eroare('Fisierul nu mai exista in coada (posibil deja confirmat si mutat).')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const b64 = fileToBase64(bytes)

    const cl = await callClaude(b64, mime, row.fisier_nume || '')
    if (!cl.ok) return await eroare(cl.err || 'AI nu a putut citi documentul.')
    const resp = cl.data

    try {
      const u = resp.usage || {}
      await supabase.from('ai_usage_log').insert({ function_name: 'citeste-orice', model: MODEL, tokens_in: u.input_tokens || 0, tokens_out: u.output_tokens || 0, cost_usd: (u.input_tokens || 0) * PRICE_IN + (u.output_tokens || 0) * PRICE_OUT, ref_table: 'ai_documente_inbox', ref_id: inboxId })
    } catch (_) {}

    let parsed: any
    try {
      const txt = resp.content?.find((c: any) => c.type === 'text')?.text || '{}'
      parsed = JSON.parse(txt.replace(/```json?|```/g, '').trim())
    } catch (_) { return await eroare('AI a raspuns intr-un format neasteptat.') }

    const modulParsed: string | null = ['executie', 'hr', 'logistica', 'financiar'].includes(parsed.modul) ? parsed.modul : null
    // v18: modulul pre-setat la upload (panoul UPA, contextul de proiect din executie)
    // are prioritate — documentul rămâne în coada din care a fost urcat.
    let modulFinal: string | null = row.modul_tinta || modulParsed
    const tipDoc: string = parsed.tip_document || 'altul'

    let entitateTip = row.entitate_tip, entitateId = row.entitate_id, matchConf = row.entitate_match_confidence
    if (!entitateId && parsed.entitate_hint) {
      if (modulFinal === 'executie') {
        const { data: proiecte } = await supabase.from('executie_proiecte').select('id,nume,cod_intern').eq('activ', true)
        const m = bestMatch(parsed.entitate_hint, proiecte || [], ['nume', 'cod_intern'], true)
        if (m) { entitateTip = 'proiect'; entitateId = m.id; matchConf = m.conf }
      } else if (modulFinal === 'hr') {
        const { data: angajati } = await supabase.from('employees').select('id,name').or('termination_date.is.null,termination_date.gt.' + new Date().toISOString().split('T')[0])
        const m = bestMatch(parsed.entitate_hint, angajati || [], ['name'], false)
        if (m) { entitateTip = 'angajat'; entitateId = m.id; matchConf = m.conf }
      } else if (modulFinal === 'logistica') {
        const { data: active } = await supabase.from('logistica_active').select('id,nr_inmatriculare,cod_intern,marca')
        const hintPlate = plateNorm(parsed.entitate_hint)
        let found: any = null
        if (hintPlate.length >= 4) { found = (active || []).find((a: any) => a.nr_inmatriculare && plateNorm(a.nr_inmatriculare) === hintPlate); if (!found) found = (active || []).find((a: any) => a.cod_intern && plateNorm(a.cod_intern) === hintPlate) }
        if (found) { entitateTip = 'activ'; entitateId = found.id; matchConf = 100 }
        else { const m = bestMatch(parsed.entitate_hint, active || [], ['nr_inmatriculare', 'cod_intern', 'marca'], false); if (m) { entitateTip = 'activ'; entitateId = m.id; matchConf = m.conf } }
      }
    }

    // v18: rutare deterministă spre UPA — factura al cărei furnizor (CUI sau nume)
    // e marcat este_upa în nomenclator intră în coada UPA, nu în financiar.
    // Pentru documentele urcate din panoul UPA (modulFinal deja 'upa'), același
    // matching completează furnizorul.
    if ((modulFinal === 'financiar' && tipDoc === 'factura') || modulFinal === 'upa') {
      const { data: upaFz } = await supabase.from('logistica_furnizori').select('id,nume,cui').eq('este_upa', true).eq('activ', true)
      const cuiHint = String(parsed.campuri?.cui || '').replace(/\D/g, '')
      let fzId: any = null, fzConf = 0
      if (cuiHint.length >= 5) { const f = (upaFz || []).find((x: any) => String(x.cui || '').replace(/\D/g, '') === cuiHint); if (f) { fzId = f.id; fzConf = 100 } }
      if (!fzId && parsed.entitate_hint) { const m = bestMatch(parsed.entitate_hint, upaFz || [], ['nume'], false); if (m) { fzId = m.id; fzConf = m.conf } }
      if (fzId) { modulFinal = 'upa'; entitateTip = 'furnizor'; entitateId = fzId; matchConf = fzConf }
    }

    const isoOk = (s: any) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
    let dateProiect: any = null
    if (modulFinal === 'executie' && parsed.date_proiect && typeof parsed.date_proiect === 'object') {
      const dp = parsed.date_proiect
      dateProiect = { data_start: isoOk(dp.data_start) ? dp.data_start : null, data_termen: isoOk(dp.data_termen) ? dp.data_termen : null, durata_luni: Number.isInteger(dp.durata_luni) ? dp.durata_luni : (parseInt(dp.durata_luni) || null), nr_ordin: dp.nr_ordin && typeof dp.nr_ordin === 'string' ? dp.nr_ordin : null }
      if (!dateProiect.data_start && !dateProiect.data_termen && !dateProiect.durata_luni && !dateProiect.nr_ordin) dateProiect = null
    }
    let dateDoc: any = null
    if (parsed.date_document && typeof parsed.date_document === 'object') {
      const dd = parsed.date_document
      const vtRaw = dd.valoare_totala
      const vtNum = typeof vtRaw === 'number' ? vtRaw : parseFloat(String(vtRaw || '').replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.')) || parseFloat(String(vtRaw || '').replace(/[^\d.,-]/g, '').replace(',', '.'))
      dateDoc = {
        numar: dd.numar && typeof dd.numar === 'string' ? dd.numar : null,
        data_emitere: isoOk(dd.data_emitere) ? dd.data_emitere : null,
        data_expirare: isoOk(dd.data_expirare) ? dd.data_expirare : null,
        emitent: dd.emitent && typeof dd.emitent === 'string' ? dd.emitent : null,
        valoare_totala: Number.isFinite(vtNum) && vtNum > 0 ? Math.round(vtNum * 100) / 100 : (typeof vtRaw === 'number' && vtRaw > 0 ? vtRaw : null),
      }
      if (!dateDoc.numar && !dateDoc.data_emitere && !dateDoc.data_expirare && !dateDoc.emitent && !dateDoc.valoare_totala) dateDoc = null
    }
    let campuri: Record<string, string> = {}
    if (parsed.campuri && typeof parsed.campuri === 'object') {
      for (const [k, v] of Object.entries(parsed.campuri)) {
        if (v && typeof v === 'string' && v.trim() && v !== 'null') campuri[k] = v.trim()
      }
    }

    const payload = { titlu_scurt: parsed.titlu_scurt || null, entitate_hint: parsed.entitate_hint || null, date_proiect: dateProiect, date_document: dateDoc, campuri }

    const { error: upErr } = await supabase.from('ai_documente_inbox').update({
      status: 'clasificat', modul_tinta: modulFinal, tip_document: tipDoc, payload_ai: payload,
      entitate_tip: entitateTip, entitate_id: entitateId, entitate_match_confidence: matchConf,
      clasificare_confidence: Math.max(0, Math.min(100, parsed.confidence || 0)),
      destinatie_tabel: modulFinal ? DEST_TABEL[modulFinal] : null, ai_eroare: null,
    }).eq('id', inboxId)
    if (upErr) return await eroare('Update inbox: ' + upErr.message)

    return new Response(JSON.stringify({ ok: true, inbox_id: inboxId, modul: modulFinal, tip_document: tipDoc, entitate_tip: entitateTip, entitate_id: entitateId, match_confidence: matchConf, confidence: parsed.confidence, titlu: parsed.titlu_scurt }), { headers: CORS })
  } catch (e: any) {
    return await eroare('Eroare neasteptata: ' + String(e?.message || e))
  }
})
