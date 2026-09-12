// ofertare-acoperire v5 (27.08.2026) — E3: confruntarea cerințe ↔ capabilități.
// v5: catalogul include și DOCUMENTELE FIRMEI (documente_firma — ANRE EDSB/EDIB,
// ISO, certificate) cu id-uri prefixate F → acoperit cu mod='firma' + doc_firma_id.
// Până acum se citeau doar autorizațiile de persoane → fals-goluri (DF1278266).
// v4: partenerii cu observatii („acopera”). v3: ids[] felii. v2: CORS x-client-info.
//
// ADUSĂ ÎN REPO la 12.09.2026, VERBATIM — nicio modificare de cod.
// E curată din punct de vedere al secretelor: `verify_jwt: true`, fără secret în sursă.
// ⚠️ Are însă un defect de robustețe — caută „R-ACOP-1” mai jos.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const MODEL = 'claude-opus-5'
const PRICE_IN = 5 / 1e6, PRICE_OUT = 25 / 1e6

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

const PROMPT = `Ești motorul de confruntare cerințe↔capabilități al modulului de ofertare Gazpet Instal (construcții conducte gaze). Primești: (1) cerințele unei licitații, (2) CATALOGUL REAL: autorizațiile personalului (propriu și extern), DOCUMENTELE FIRMEI (autorizații/certificate ale Gazpet Instal ca societate — id-uri cu prefix F) și partenerii, (3) termenul de depunere.
Pentru FIECARE cerință decizi cine o acoperă.

REGULI NENEGOCIABILE:
- R1: potrivești DOAR cu ce există în catalog. Nu inventa autorizații. Dacă nimic nu se potrivește → status "gol".
- R6: valabilitatea se judecă pe TERMENUL DE DEPUNERE, nu pe azi. Autorizație/document expirat înainte de depunere = NU acoperă (gol, cu motivul "expiră la <data>"). fara_expirare=true = valabil.
- R7 (reguli de domeniu): RTE 8.4(T)=transport ≠ 8.4(D)=distribuție; "atestat ANRE tip B" = INSTALAȚII ELECTRICE (Ord.134/2021); INSEMEX pe ACTIVITĂȚI; sudori SR EN ISO 9606-1: diametrul D acoperă ≥ 0,5·D; RTE MECMA (Ordin 364/2010) ≠ RTE ISC.
- DOCUMENTELE FIRMEI (id F...): cerințele despre autorizații/certificate ALE SOCIETĂȚII — ANRE tip EDSB/EDIB/EPI/ET (Ord. ANRE 132/2021 pt execuție sisteme distribuție/instalații gaze), certificări ISO 9001/14001/45001, certificat constatator, atestări firmă — se acoperă cu ele: status "acoperit", autorizatie_id: "F<id>". Tipul trebuie să corespundă cerinței (EDSB=execuție sisteme distribuție; EDIB=execuție instalații; EPI=proiectare instalații; ET=execuție transport; nu le încurca).
- PARTENERI: câmpul "acopera" descrie ce aduce CONCRET fiecare → "acoperit_partener" cu partener_id. Un partener fără specialitatea cerută NU acoperă.
- O cerință care NU e de capabilitate (garanție de participare, formulare, semnătură, mod de prezentare, preț, termene de plată, vizită amplasament, valabilitatea ofertei) → status "nu_se_aplica".
- motiv: scurt (≤120 caractere), în română, spune DE CE (cine/ce acoperă sau ce lipsește exact).

Răspunde EXCLUSIV JSON compact:
{"acoperiri":[{"cerinta_id":123,"status":"acoperit"|"acoperit_partener"|"gol"|"nu_se_aplica","autorizatie_id":<id numeric din catalog personal, "F<id>" pentru document de firmă, sau null>,"partener_id":<id sau null>,"motiv":"..."}]}`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const fail = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 200, headers: CORS })

  try {
    const { licitatie_id, batch, ids } = await req.json()
    const licId = Number(licitatie_id)
    if (!licId || !['eliminatorie', 'propunere'].includes(batch)) return fail('licitatie_id + batch (eliminatorie/propunere) obligatorii')
    const idsFelie: number[] | null = Array.isArray(ids) && ids.length ? ids.map(Number).filter(Boolean) : null

    const { data: lic } = await supabase.from('ofertare_licitatii').select('id, nr_anunt, autoritate, termen_depunere').eq('id', licId).single()
    if (!lic) return fail('licitatie negasita')

    let q = supabase.from('ofertare_cerinte')
      .select('id, sursa_sectiune, text_cerinta, lot, document_probant')
      .eq('licitatie_id', licId).eq('tip', batch).is('inlocuita_de', null).order('id')
    if (idsFelie) q = q.in('id', idsFelie)
    const { data: cerinte } = await q
    if (!cerinte?.length) return new Response(JSON.stringify({ ok: true, batch, propuneri: 0, skip: 'nicio cerinta de tipul asta' }), { headers: CORS })

    const { data: auth } = await supabase.from('hr_autorizatii')
      .select('id, numar_autorizatie, data_expirare, fara_expirare, domenii, procedeu_sudura, diametru_teava_mm, emitent, fisier_path, tip:hr_autorizatii_tipuri(denumire, cod), emp:employees(name), ext:hr_personal_extern(nume)')
      .is('deleted_at', null).order('id')   // ordine STABILA: fara ea, prefixul difera intre apeluri si cache-ul nu se potriveste
    const catalog = (auth || []).map((a: any) => ({
      id: a.id, tip: a.tip?.denumire, cod: a.tip?.cod || undefined,
      titular: a.emp?.name || a.ext?.nume || '?', extern: !!a.ext,
      numar: a.numar_autorizatie || undefined, emitent: a.emitent || undefined,
      expira: a.fara_expirare ? 'niciodata' : (a.data_expirare || 'necunoscut'),
      domenii: (a.domenii && a.domenii.length) ? a.domenii : undefined,
      sudura: a.procedeu_sudura || undefined, diam_mm: a.diametru_teava_mm || undefined,
      are_scan: !!a.fisier_path,
    }))
    const { data: docsF } = await supabase.from('documente_firma')
      .select('id, tip, denumire, categorie, numar_document, autoritate_emitenta, data_valabilitate, fara_expirare, pdf_path')
      .eq('activ', true).order('id')
    const catalogFirma = (docsF || []).map((d: any) => ({
      id: 'F' + d.id, tip: d.tip, denumire: d.denumire, categorie: d.categorie || undefined,
      numar: d.numar_document || undefined, emitent: d.autoritate_emitenta || undefined,
      expira: d.fara_expirare ? 'niciodata' : (d.data_valabilitate || 'necunoscut'),
      are_scan: !!d.pdf_path,
    }))
    const { data: partAll } = await supabase.from('ofertare_parteneri')
      .select('id, nume, tip_relatie, observatii').eq('activ', true).eq('abandonat', false).order('id')
    const parteneri = (partAll || []).map((p: any) => ({ id: p.id, nume: p.nume, tip_relatie: p.tip_relatie, acopera: (p.observatii || '').slice(0, 400) || undefined }))

    // CACHE (12.09.2026): catalogul — autorizatii, documente de firma, parteneri — e IDENTIC
    // la fiecare apel: nu depinde nici de licitatie, nici de felie. Erau ~35 de mii de tokeni
    // retrimisi si platiti integral de 158 de ori. Anthropic poate tine prefixul in cache, dar
    // DOAR ca prefix: mai intai partea stabila, pe urma cea variabila. Inainte era exact invers
    // (licitatia si cerintele primele), deci un `cache_control` pus fara reordonare n-ar fi
    // prins nimic. De-asta si `.order('id')` de mai sus: o singura linie mutata in catalog
    // schimba prefixul si rateaza cache-ul.
    const stabil = `CATALOG AUTORIZAȚII PERSONAL (${catalog.length}):\n${JSON.stringify(catalog)}\n\nDOCUMENTE FIRMĂ — Gazpet Instal SRL (${catalogFirma.length}, id-uri cu prefix F):\n${JSON.stringify(catalogFirma)}\n\nPARTENERI ACTIVI (${parteneri.length}):\n${JSON.stringify(parteneri)}`
    const variabil = `LICITAȚIA: ${lic.nr_anunt} · ${lic.autoritate} · TERMEN DE DEPUNERE: ${lic.termen_depunere || 'necunoscut'}\n\nCERINȚE (tip ${batch}):\n${JSON.stringify(cerinte)}`

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 9000,
        system: [{ type: 'text', text: PROMPT }],
        messages: [{ role: 'user', content: [
          { type: 'text', text: stabil, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: variabil },
        ] }],
      }),
    })
    const data = await resp.json()
    if (!resp.ok) return fail('Claude: ' + (data.error?.message || resp.status))

    try {
      const u = data.usage || {}
      // Tokenii de cache se factureaza separat: scrierea 1.25x pretul de intrare, citirea 0.1x.
      // Fara ei in formula, cost_usd ar arata artificial mic si n-am mai sti cat costa de fapt.
      const cacheW = u.cache_creation_input_tokens || 0
      const cacheR = u.cache_read_input_tokens || 0
      await supabase.from('ai_usage_log').insert({
        function_name: 'ofertare-acoperire', model: MODEL,
        tokens_in: (u.input_tokens || 0) + cacheW + cacheR,
        tokens_out: u.output_tokens || 0,
        cost_usd: (u.input_tokens || 0) * PRICE_IN + cacheW * PRICE_IN * 1.25 + cacheR * PRICE_IN * 0.1 + (u.output_tokens || 0) * PRICE_OUT,
        ref_table: 'ofertare_licitatii', ref_id: licId,
      })
    } catch (_) {}

    const txt = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
    const clean = txt.replace(/```json?|```/g, '')
    let lista: any[] = []
    let trunchiat = data.stop_reason === 'max_tokens'
    try {
      const m = clean.match(/\{[\s\S]*\}/)
      lista = JSON.parse(m ? m[0] : '{}').acoperiri || []
    } catch (_) {
      const dupa = clean.slice(clean.indexOf('"acoperiri"'))
      for (const o of (dupa.match(/\{[^{}]*\}/g) || [])) { try { lista.push(JSON.parse(o)) } catch (_) {} }
      trunchiat = true
      if (!lista.length) return fail('AI a răspuns într-un format neașteptat.')
    }

    const idsCerinte = new Set((cerinte || []).map((c: any) => c.id))
    const idsAuth = new Map(catalog.map((a: any) => [a.id, a]))
    const idsDocF = new Map((docsF || []).map((d: any) => [d.id, d]))
    const idsPart = new Set(parteneri.map((p: any) => p.id))
    const azi = lic.termen_depunere ? new Date(lic.termen_depunere) : new Date()

    // R-ACOP-1 (constatat 12.09.2026, NEREPARAT în acest commit — fixul vine separat):
    // ștergerea se face ÎNAINTE de insert și pe TOATE cerințele feliei, nu doar pe cele
    // pentru care AI-ul chiar a răspuns. Dacă răspunsul e trunchiat (vezi `trunchiat`) sau
    // insertul pică, acoperirile vechi sunt deja pierdute, iar cerințele rămân fără nimic —
    // adică arată ca „neanalizate", nu ca „goluri". Același tipar ca la radar: un pas
    // distructiv necondiționat, pus înaintea unuia care poate să nu reușească.
    const cerinteIds = Array.from(idsCerinte)
    await supabase.from('ofertare_acoperire').delete().in('cerinta_id', cerinteIds).eq('verificat_pe_scan', false)

    const rows: any[] = []
    for (const p of lista) {
      if (!idsCerinte.has(p.cerinta_id)) continue
      if (p.status === 'nu_se_aplica') continue
      let docF: any = null
      let aut: any = null
      if (typeof p.autorizatie_id === 'string' && /^F\d+$/.test(p.autorizatie_id)) {
        const fid = Number(p.autorizatie_id.slice(1))
        if (idsDocF.has(fid)) docF = idsDocF.get(fid)
      } else if (p.autorizatie_id && idsAuth.has(Number(p.autorizatie_id))) {
        aut = idsAuth.get(Number(p.autorizatie_id))
      }
      const part = p.partener_id && idsPart.has(p.partener_id) ? p.partener_id : null
      let status = ['acoperit', 'acoperit_partener', 'gol'].includes(p.status) ? p.status : 'gol'
      if (status === 'acoperit' && !aut && !docF) status = 'gol'
      if (status === 'acoperit_partener' && !part && !aut && !docF) status = 'gol'
      let valabil: boolean | null = null
      if (aut) valabil = aut.expira === 'niciodata' ? true : (aut.expira !== 'necunoscut' && new Date(aut.expira) >= azi)
      if (docF) valabil = docF.fara_expirare ? true : (docF.data_valabilitate ? new Date(docF.data_valabilitate) >= azi : null)
      rows.push({
        cerinta_id: p.cerinta_id,
        mod: status === 'gol' ? 'gol' : (docF ? 'firma' : (aut ? (aut.extern ? 'partener' : 'personal') : 'partener')),
        autorizatie_id: aut ? aut.id : null,
        doc_firma_id: docF ? docF.id : null,
        partener_id: part,
        referinta_text: (typeof p.motiv === 'string' ? p.motiv.slice(0, 300) : null),
        status,
        valabil_la_depunere: valabil,
        verificat_pe_scan: false,
      })
    }
    if (rows.length) {
      const { error: eIns } = await supabase.from('ofertare_acoperire').insert(rows)
      if (eIns) return fail('insert acoperire: ' + eIns.message)
    }

    const goluri = rows.filter(r => r.status === 'gol').length
    return new Response(JSON.stringify({ ok: true, batch, felie: idsFelie ? idsFelie.length : null, propuneri: rows.length, goluri, firma: rows.filter(r => r.mod === 'firma').length, trunchiat, tokens_in: data.usage?.input_tokens, tokens_out: data.usage?.output_tokens, cache_scris: data.usage?.cache_creation_input_tokens || 0, cache_citit: data.usage?.cache_read_input_tokens || 0 }), { headers: CORS })
  } catch (e: any) {
    return fail('Eroare neasteptata: ' + String(e?.message || e))
  }
})
