// ofertare-acoperire v7 (12.09.2026) — E3: confruntarea cerințe ↔ capabilități.
// v7: scriere atomica prin fn_ofertare_acoperire_rescrie + index unic partial.
// v6: R-ACOP-1 + 12 constatari de revizuire + 3 runde de a doua parere (Codex).
// v5: catalogul include și DOCUMENTELE FIRMEI (documente_firma — ANRE EDSB/EDIB,
// ISO, certificate) cu id-uri prefixate F → acoperit cu mod='firma' + doc_firma_id.
// v4: partenerii cu observatii („acopera”). v3: ids[] felii. v2: CORS x-client-info.
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

IMPORTANT: raportezi FIECARE cerinta primita, inclusiv cele cu "nu_se_aplica". Daca nu incapi, e mai bine sa scurtezi motivele decat sa omiti cerinte — o cerinta lipsa din raspuns nu poate fi deosebita de una pe care n-ai apucat s-o citesti.

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

    const { data: auth, error: eAuth } = await supabase.from('hr_autorizatii')
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
    const { data: docsF, error: eDocF } = await supabase.from('documente_firma')
      .select('id, tip, denumire, categorie, numar_document, autoritate_emitenta, data_valabilitate, fara_expirare, pdf_path')
      .eq('activ', true).order('id')
    const catalogFirma = (docsF || []).map((d: any) => ({
      id: 'F' + d.id, tip: d.tip, denumire: d.denumire, categorie: d.categorie || undefined,
      numar: d.numar_document || undefined, emitent: d.autoritate_emitenta || undefined,
      expira: d.fara_expirare ? 'niciodata' : (d.data_valabilitate || 'necunoscut'),
      are_scan: !!d.pdf_path,
    }))
    const { data: partAll, error: ePart } = await supabase.from('ofertare_parteneri')
      .select('id, nume, tip_relatie, observatii').eq('activ', true).eq('abandonat', false).order('id')

    // BLOCANT reparat 12.09: interogarile de mai sus citeau doar `data`, niciodata `error`.
    // supabase-js NU arunca la esec — intoarce { data: null, error }. Cu `(auth || [])`,
    // un timeout devenea tacut CATALOG GOL, iar modelul aplica atunci corect regula R1
    // („potrivesti DOAR cu ce exista in catalog") si raspundea 'gol' pe TOATE cerintele.
    // Alea erau randuri valide, deci stergerea pleca si o licitatie cu acoperirile puse
    // devenea integral „fara dovada" — fara nicio eroare nicaieri.
    if (eAuth || eDocF || ePart) {
      return fail('catalog indisponibil: ' + (eAuth?.message || eDocF?.message || ePart?.message))
    }
    // A doua plasa: un catalog gol nu e o stare normala pentru firma asta. Daca ambele
    // surse sunt goale, ceva e rupt in amonte — nu propunem nimic si nu stergem nimic.
    if (!(auth || []).length && !(docsF || []).length) {
      return fail('catalog gol (0 autorizatii, 0 documente de firma) — refuz sa propun acoperiri')
    }

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
        // Pe claude-opus-5 gandirea e PORNITA implicit cand `thinking` lipseste (spre deosebire
        // de Opus 4.8/4.7), iar tokenii de gandire se scad din max_tokens. La 9000 se intampla
        // ca taietura sa cada in blocul de gandire: nu ramane niciun bloc `text`, raspunsul pare
        // gol si rularea se oprea. O declaram explicit si ii dam loc. `budget_tokens` ar da 400.
        model: MODEL, max_tokens: 16000,
        thinking: { type: 'adaptive' },
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

    // R-ACOP-1 (reparat 12.09.2026). Inainte, stergerea rula AICI — inaintea insertului si
    // pe TOATE cerintele feliei, nu doar pe cele la care AI-ul chiar raspunsese. Daca
    // raspunsul se taia (`trunchiat`) sau insertul pica, acoperirile vechi erau deja duse,
    // iar cerintele ramaneau fara niciun rand. Acum se construiesc intai randurile, apoi se
    // scriu printr-o singura tranzactie in BD (vezi fn_ofertare_acoperire_rescrie mai jos).
    const rows: any[] = []
    for (const p of lista) {
      if (!idsCerinte.has(p.cerinta_id)) continue
      if (p.status === 'nu_se_aplica') {
        // R-ACOP-1 partea 2: se scrie, nu se tace. „AI-ul a zis ca nu se aplica" si „AI-ul
        // n-a raspuns" insemnau amandoua lipsa randului, deci o pierdere de date arata
        // exact ca o clasare corecta. Decizia OMULUI ramane separata, in
        // ofertare_cerinte.stare — asta e doar propunerea AI-ului.
        rows.push({
          cerinta_id: p.cerinta_id, mod: 'nu_se_aplica',
          autorizatie_id: null, doc_firma_id: null, partener_id: null,
          referinta_text: (typeof p.motiv === 'string' ? p.motiv.slice(0, 300) : null),
          status: 'nu_se_aplica', valabil_la_depunere: null, verificat_pe_scan: false,
        })
        continue
      }
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
    // Nimic de scris = nimic de sters. Altfel un raspuns gol ar goli tabelul.
    // Felie fara niciun rand valid: NU e o eroare a rularii. Raspunsul purta cheia `error`,
    // iar frontendul face `return` din tot ciclul cand o vede — asa ca o singura felie
    // nefericita oprea si restul eliminatoriilor, si intreg batch-ul 'propunere'. Acum
    // raportam felia ca goala si lasam ciclul sa continue; felia intra la reluare.
    if (!rows.length) {
      return new Response(JSON.stringify({
        ok: true, batch, propuneri: 0, felie_goala: true, trunchiat,
        motiv_felie_goala: 'AI-ul n-a intors nicio acoperire valida — nu s-a sters si nu s-a scris nimic',
        stop_reason: data.stop_reason || null,
        fara_raspuns: idsCerinte.size, cerinte_fara_raspuns: Array.from(idsCerinte),
        tokens_in: data.usage?.input_tokens, tokens_out: data.usage?.output_tokens,
      }), { headers: CORS })
    }
    const PLAFON_RAPORT = 500
    // AI-ul poate repeta acelasi cerinta_id. Dedup aici doar ca sa raportam corect ce s-a
    // cerut si ce n-a raspuns; functia din BD dedupica si ea, e ultima plasa.
    const vazute = new Set()
    const randuriUnice = rows.filter(r => { if (vazute.has(r.cerinta_id)) return false; vazute.add(r.cerinta_id); return true })

    // 12.09.2026 — SCRIEREA E ACUM ATOMICA, intr-o singura tranzactie in BD.
    // Inainte erau patru cereri separate prin PostgREST: citeste randurile vechi, insereaza
    // cele noi, reciteste ce urmeaza sa stergi, sterge. Netranzactional, deci fiecare pauza
    // dintre ele era o fereastra in care un coleg putea apasa „verificat" sau scrie un raspuns
    // pe randul pe care tocmai il stergeam. Plus: doua rulari simultane lasau duplicate.
    //
    // `fn_ofertare_acoperire_rescrie` face altceva, nu doar acelasi lucru mai repede:
    // ACTUALIZEAZA coloanele AI ale randului existent in loc sa-l stearga si sa-l re-creeze.
    // Campurile omului (raspuns_coleg / raspuns_de / raspuns_la / tichet_id) nu mai sunt nici
    // macar citite de aici — raman pur si simplu pe rand, deci nu mai pot fi pierdute. Le
    // trimitem doar coloanele AI; functia ignora orice altceva ar veni in payload.
    // Impreuna cu indexul unic partial pe (cerinta_id) WHERE verificat_pe_scan = false,
    // duplicatele nu mai sunt posibile nici macar cand doi colegi apasa butonul deodata.
    const { data: rez, error: eRpc } = await supabase.rpc('fn_ofertare_acoperire_rescrie', {
      p_randuri: randuriUnice.map(r => ({
        cerinta_id: r.cerinta_id, mod: r.mod,
        autorizatie_id: r.autorizatie_id, doc_firma_id: r.doc_firma_id, partener_id: r.partener_id,
        referinta_text: r.referinta_text, status: r.status, valabil_la_depunere: r.valabil_la_depunere,
      })),
    })
    if (eRpc) return fail('rescriere acoperiri (tranzactie anulata, nu s-a schimbat nimic): ' + eRpc.message)

    const scrise: number[] = rez?.scrise || []
    const idsConflicte: number[] = rez?.conflicte || []
    const scriseSet = new Set(scrise)
    const conflicteVerificate = randuriUnice
      .filter(r => idsConflicte.includes(r.cerinta_id))
      .map(r => ({ cerinta_id: r.cerinta_id, propus: r.status, motiv: r.referinta_text }))
    const deScris = randuriUnice.filter(r => scriseSet.has(r.cerinta_id))

    // Cerintele la care AI-ul n-a raspuns si cele blocate de o dovada verificata: nu le-am
    // atins, deci acoperirea veche le ramane. Plafonul de raportare era 50, iar felia trimisa
    // de frontend are 55 — cerintele peste plafon nu mai erau reluate NICIODATA. Ridicat, plus
    // un steag explicit cand lista tot e taiata, ca frontendul sa reia atunci toata felia.
    const fararaspuns = Array.from(idsCerinte).filter((id: any) => !vazute.has(id))
    const goluri = deScris.filter(r => r.status === 'gol').length
    return new Response(JSON.stringify({ ok: true, batch, felie: idsFelie ? idsFelie.length : null,
      propuneri: deScris.length, goluri, firma: deScris.filter(r => r.mod === 'firma').length,
      nu_se_aplica: deScris.filter(r => r.status === 'nu_se_aplica').length,
      conflicte_verificate: conflicteVerificate,
      fara_raspuns: fararaspuns.length,
      cerinte_fara_raspuns: fararaspuns.slice(0, PLAFON_RAPORT),
      lista_fara_raspuns_taiata: fararaspuns.length > PLAFON_RAPORT,
      trunchiat, stop_reason: data.stop_reason || null,
      tokens_in: data.usage?.input_tokens, tokens_out: data.usage?.output_tokens,
      cache_scris: data.usage?.cache_creation_input_tokens || 0, cache_citit: data.usage?.cache_read_input_tokens || 0 }), { headers: CORS })
  } catch (e: any) {
    return fail('Eroare neasteptata: ' + String(e?.message || e))
  }
})
