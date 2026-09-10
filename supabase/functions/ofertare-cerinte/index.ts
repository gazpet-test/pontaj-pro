// ofertare-cerinte v9 (10.09.2026) — model din body (Opus implicit, Sonnet pentru test/economie).
// v8 (10.09.2026) — bucata_max minim 6k (felii de ~2 pagini).
// v7 (10.09.2026) — bucata_max din body + max_tokens 16000.
// v6 (09.09.2026) — Faza 1/2: FĂRĂ TĂIERE, CU PAGINĂ ȘI PASAJ.
// v6: (1) textul nu se mai taie la 180k (doc 98 la Mânăstirea avea 290k → 38%
// nu ajungea la AI, fără niciun marcaj); se împarte în bucăți la ⟦PAGINA N⟧ și se
// procesează O bucată per apel — UI-ul continuă cât timp răspunsul are continua=true.
// (2) fiecare cerință primește sursa_pagina + sursa_pasaj; pasajul e VERIFICAT de
// cod în textul bucății (pasaj_verificat), iar pagina se deduce din marcajul
// dinaintea pasajului găsit — nu pe cuvântul modelului. (3) formularele intră la
// extragere (tip 'formular', prompt propriu). (4) documentele 'partial' se acceptă.
// v5: mod {doc_id} pe caiete/clarificări. v4: CORS. v3: ancore regex. Model: OPUS.
// Insert cu confirmata_de NULL — poarta E2 = Razvan în UI.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
// v9: modelul se poate cere din body. Implicit Opus (cum a fost dintotdeauna); Sonnet costa
// ~40% mai putin si la citire s-a dovedit la egalitate — de comparat pe extragere inainte de comutare.
const MODELE: Record<string, { in: number; out: number }> = {
  'claude-opus-5': { in: 5 / 1e6, out: 25 / 1e6 },
  'claude-sonnet-5': { in: 3 / 1e6, out: 15 / 1e6 },
}
const MODEL_IMPLICIT = 'claude-opus-5'
const BUCATA_MAX_DEFAULT = 150_000          // caractere per apel; sub limita de context, cu loc pentru răspuns
const MARCAJ = /⟦PAGINA (\d+)(?:-(\d+))?⟧/g

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

const CAMPURI_SURSA = `- pagina: numărul paginii din care ai luat cerința, citit din marcajele ⟦PAGINA N⟧ din text (cel mai apropiat marcaj DE DINAINTEA pasajului). Dacă textul nu are marcaje, null.
- pasaj: CITAT EXACT, copiat literal din text, din care reiese cerința — 60–300 de caractere, fără să schimbi nicio literă (se verifică automat prin căutare în text; un citat parafrazat pică verificarea).`

const PROMPT = (sect: string, fewshot: string) => `Ești motorul de extragere a cerințelor pentru modulul de ofertare Gazpet Instal (construcții conducte gaze, România). Primești un FRAGMENT din fișa de date a unei achiziții publice (secțiunea ${sect}) și extragi TOATE cerințele către ofertant.

REGULI NENEGOCIABILE:
- R1: extragi DOAR ce scrie în text. Nu inventa, nu deduce. Număr/valoare care nu apare = nu există.
- R9: cerințele ELIMINATORII (neîndeplinire = exclus/respins) se marchează distinct.
- Fiecare cerință = un rând SEPARAT („RTE MECMA și topograf autorizat” = 2 rânduri).
- sursa_sectiune = identificatorul EXACT („III.1.3.a”, „IV.4.1”). Nu-l aproxima.
- text_cerinta = O SINGURĂ FRAZĂ COMPACTĂ, max ~200 caractere, cu pragurile/valorile EXACTE (ani, lei, nr. contracte, diametre). Fără parafrazări lungi, fără citate întregi.
- tip: „eliminatorie” = calificare/excludere (III.1.*, DUAE, praguri experiență, garanție participare); „propunere” = de demonstrat în propunerea tehnică/financiară (IV.4.1/IV.4.2); „forma” = semnătură electronică, limbă, formulare, valabilitate ofertă, mod încărcare SEAP; „contractuala” = clauze din model contract.
- lot: numărul lotului dacă e specifică, altfel „toate”.
- document_probant: documentul care o probează (scurt), null dacă nu reiese.
- cand_se_prezinta: „duae” | „depunere” | „primul_loc” | null.
${CAMPURI_SURSA}
${fewshot}
Răspunde EXCLUSIV JSON compact, fără markdown, fără spații inutile:
{"cerinte":[{"sursa_sectiune":"...","text_cerinta":"...","tip":"...","lot":"...","document_probant":"...","cand_se_prezinta":"...","pagina":12,"pasaj":"..."}]}`

const PROMPT_CS = (numeDoc: string, fewshot: string) => `Ești motorul de extragere a cerințelor pentru modulul de ofertare Gazpet Instal (construcții conducte gaze, România). Primești un FRAGMENT dintr-un CAIET DE SARCINI sau RĂSPUNS LA CLARIFICĂRI („${numeDoc}”). Extragi DOAR cerințele către OFERTANT/EXECUTANT — ce trebuie firma să DEȚINĂ, să PREZINTE sau să ASIGURE ca să poată oferta și executa.

CE EXTRAGI (exemple de familii):
- autorizări/atestate legale ale firmei sau personalului: ANRE (cu tipul exact), ISC, ISCIR, INSEMEX, MECMA, grupe/categorii de lucrări, autorizații de mediu
- personal obligatoriu: RTE, CQ/CTC, sudori autorizați (cu procedeele/domeniile exacte), operatori PE, topograf, SSM, laborator
- laborator de încercări: cine face probele/testele, gradul laboratorului, autorizări (ex. laborator gradul II, examinări nedistructive/RT/UT), dacă trebuie autorizat/independent
- dotări/utilaje/echipamente cerute explicit ofertantului
- probe/încercări/recepții pe care EXECUTANTUL trebuie să le asigure, cu condițiile lor
- condiții eliminatorii sau obligații din clarificări care schimbă/adaugă cerințe

CE NU EXTRAGI: specificații pure de material sau de execuție (grosimi, adâncimi de pozare, tipuri de țeavă, tehnologie de montaj) care NU cer nimic de deținut/prezentat de ofertant; cerințe administrative de depunere (formulare, SEAP, semnătură) — alea vin din fișa de date.

REGULI:
- R1: extragi DOAR ce scrie în text. Nu inventa, nu deduce. Număr/valoare care nu apare = nu există.
- Fiecare cerință = un rând SEPARAT. text_cerinta = O FRAZĂ COMPACTĂ, max ~200 caractere, cu valorile EXACTE (grupe, grade, diametre, procedee).
- sursa_sectiune = identificatorul din document dacă există (capitol/punct/articol, ex. „cap. 5.2”), altfel „CS”.
- tip: „eliminatorie” DOAR dacă textul o cere la CALIFICARE/depunere sau lipsa ei duce la respingerea ofertei; o obligație din TIMPUL EXECUȚIEI (notificări, predări, PV-uri, avize de obținut după semnare) NU e eliminatorie — e „propunere” (de asumat în propunerea tehnică).
- lot: numărul lotului dacă reiese, altfel „toate”.
- document_probant: documentul care o probează (scurt), null dacă nu reiese.
- cand_se_prezinta: null (de regulă) sau „depunere” dacă textul cere explicit la ofertă.
${CAMPURI_SURSA}
- Dacă fragmentul nu conține NICIO cerință către ofertant: {"cerinte":[]}.
${fewshot}
Răspunde EXCLUSIV JSON compact, fără markdown:
{"cerinte":[{"sursa_sectiune":"...","text_cerinta":"...","tip":"...","lot":"...","document_probant":"...","cand_se_prezinta":"...","pagina":12,"pasaj":"..."}]}`

const PROMPT_FORM = (numeDoc: string) => `Ești motorul de extragere a cerințelor pentru modulul de ofertare Gazpet Instal. Primești un FORMULAR din documentația de atribuire („${numeDoc}”) — declarație, angajament, model de scrisoare, formular de ofertă. Extragi ce OBLIGĂ formularul ofertantul: ce trebuie declarat/asumat, ce anexe cere, cine îl semnează, în ce condiții se prezintă.

REGULI:
- R1: extragi DOAR ce scrie în text. Nu inventa.
- Fiecare obligație distinctă = un rând. text_cerinta = O FRAZĂ COMPACTĂ, max ~200 caractere, care începe cu numele formularului (ex. „Formularul 8: …”).
- sursa_sectiune = numărul/numele formularului (ex. „Formular 8”), altfel „FORM”.
- tip: „forma” pentru semnătură/mod de prezentare; „eliminatorie” dacă formularul e cerut obligatoriu la calificare (DUAE, declarații art. 164/165/167, garanție); altfel „propunere”.
- lot: „toate” dacă nu reiese. document_probant: formularul însuși sau anexa cerută. cand_se_prezinta: „duae” | „depunere” | „primul_loc” | null.
${CAMPURI_SURSA}
- Dacă formularul nu conține nicio obligație pentru ofertant: {"cerinte":[]}.
Răspunde EXCLUSIV JSON compact, fără markdown:
{"cerinte":[{"sursa_sectiune":"...","text_cerinta":"...","tip":"...","lot":"...","document_probant":"...","cand_se_prezinta":"...","pagina":12,"pasaj":"..."}]}`

// ── împărțirea textului în bucăți, la marcajele de pagină ────────────────────
function bucati(text: string, BUCATA_MAX = BUCATA_MAX_DEFAULT): string[] {
  if (text.length <= BUCATA_MAX) return [text]
  const out: string[] = []
  const idx: number[] = [0]
  for (const m of text.matchAll(MARCAJ)) if (m.index && m.index > 0) idx.push(m.index)
  if (idx.length < 2) {
    // fără marcaje (text vechi): tăiem la paragrafe, ca să nu rupem o frază
    let p = 0
    while (p < text.length) {
      let e = Math.min(p + BUCATA_MAX, text.length)
      if (e < text.length) { const nl = text.lastIndexOf('\n\n', e); if (nl > p + BUCATA_MAX / 2) e = nl }
      out.push(text.slice(p, e)); p = e
    }
    return out
  }
  let start = 0
  for (let i = 1; i < idx.length; i++) {
    if (idx[i] - start > BUCATA_MAX) { out.push(text.slice(start, idx[i - 1] > start ? idx[i - 1] : idx[i])); start = idx[i - 1] > start ? idx[i - 1] : idx[i] }
  }
  out.push(text.slice(start))
  // o singură pagină uriașă (peste plafon) se taie brut, dar rar
  return out.flatMap(b => b.length <= BUCATA_MAX * 1.5 ? [b] : Array.from({ length: Math.ceil(b.length / BUCATA_MAX) }, (_, i) => b.slice(i * BUCATA_MAX, (i + 1) * BUCATA_MAX)))
}

function intervalPagini(b: string): { de_la: number | null; pana_la: number | null } {
  const nr: number[] = []
  for (const m of b.matchAll(MARCAJ)) { nr.push(Number(m[1])); if (m[2]) nr.push(Number(m[2])) }
  if (!nr.length) return { de_la: null, pana_la: null }
  return { de_la: Math.min(...nr), pana_la: Math.max(...nr) }
}

// ── verificarea pasajului: în textul bucății, nu pe cuvântul modelului ───────
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[„”"«»']/g, '').replace(/\s+/g, ' ').trim()
function verificaPasaj(bucata: string, bucataNorm: string, mapaPoz: number[], pasaj: string | null | undefined): { verificat: boolean; pagina: number | null; pasaj: string | null } {
  const p = typeof pasaj === 'string' ? pasaj.trim().slice(0, 300) : ''
  if (p.length < 20) return { verificat: false, pagina: null, pasaj: p || null }
  const pn = norm(p)
  let poz = bucataNorm.indexOf(pn)
  if (poz < 0 && pn.length > 80) poz = bucataNorm.indexOf(pn.slice(0, 80))   // începutul citatului ajunge
  if (poz < 0) return { verificat: false, pagina: null, pasaj: p }
  // pagina = ultimul marcaj DE DINAINTEA poziției găsite (în textul original)
  const pozOrig = mapaPoz[Math.min(poz, mapaPoz.length - 1)] ?? 0
  let pagina: number | null = null
  for (const m of bucata.matchAll(MARCAJ)) { if ((m.index ?? 0) <= pozOrig) pagina = Number(m[1]); else break }
  return { verificat: true, pagina, pasaj: p }
}
// mapa poziție-normalizat → poziție-original (aproximativă, dar suficientă pentru marcaje)
function mapaPozitii(s: string): { n: string; mapa: number[] } {
  const mapa: number[] = []
  let n = ''
  let ultimSpatiu = true
  for (let i = 0; i < s.length; i++) {
    const ch = s[i].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[„”"«»']/g, '')
    if (!ch) continue
    if (/\s/.test(ch)) { if (ultimSpatiu) continue; n += ' '; mapa.push(i); ultimSpatiu = true; continue }
    n += ch; for (let k = 0; k < ch.length; k++) mapa.push(i); ultimSpatiu = false
  }
  return { n: n.trim(), mapa }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const fail = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 200, headers: CORS })

  try {
    const { licitatie_id, sectiune, reset, doc_id, bucata, bucata_max, model } = await req.json()
    const MODEL = (typeof model === 'string' && MODELE[model]) ? model : MODEL_IMPLICIT
    const PRICE_IN = MODELE[MODEL].in, PRICE_OUT = MODELE[MODEL].out
    // v7: mărimea bucății se poate cere din body (workerul server trimite 40k): bucăți mai mici =
    // răspuns mai scurt și apel sub 150s (gateway IDLE_TIMEOUT / pg_net timeout); același număr
    // trebuie trimis la toate apelurile unui pas, altfel indexul bucății nu mai corespunde.
    // v8: minimul coboară la 6k (~2 pagini). La 20k, secțiunea IV a fișei Mănăstirea intra
    // într-o singură bucată care depășea 150s, pasul era sărit și paginile 19-21 nu ajungeau
    // niciodată la model — registrul rămânea gol acolo, deși documentul era citit complet.
    const bucataMax = Math.max(6_000, Math.min(Number(bucata_max) || BUCATA_MAX_DEFAULT, BUCATA_MAX_DEFAULT))
    const licId = Number(licitatie_id)
    const modCorpus = !!doc_id
    const nrBucata = Math.max(0, Number(bucata) || 0)
    if (!licId || (!modCorpus && !['II', 'III', 'IV', 'rest'].includes(sectiune))) return fail('licitatie_id + sectiune (II/III/IV/rest) sau doc_id obligatorii')

    const { data: lic } = await supabase.from('ofertare_licitatii').select('id, autoritate, nr_anunt').eq('id', licId).single()
    if (!lic) return fail('licitatie negasita')

    let text = ''
    let srcDocId: number
    let numeDoc = ''
    let lotDoc = ''
    let tipDoc = ''

    if (modCorpus) {
      const { data: doc } = await supabase.from('ofertare_documente_atribuire')
        .select('id, nume_original, tip, text_extras, status_procesare, pagini_necitite').eq('id', Number(doc_id)).eq('licitatie_id', licId).single()
      if (!doc) return fail('document negasit')
      if (!['cs_volum', 'raspuns_clarificare', 'clarificare', 'alta', 'formular'].includes(doc.tip)) return fail('doc_id acceptă caiete de sarcini / clarificări / alta / formulare')
      const t = (doc.text_extras || '')
      if (t.length < 300) return new Response(JSON.stringify({ ok: true, doc_id: doc.id, cerinte: 0, skip: 'text prea scurt', continua: false }), { headers: CORS })
      text = t
      srcDocId = doc.id
      numeDoc = doc.nume_original || `doc ${doc.id}`
      tipDoc = doc.tip
      const mLot = numeDoc.match(/LOT\s*(\d)/i)
      lotDoc = mLot ? mLot[1] : ''
    } else {
      const { data: fise } = await supabase.from('ofertare_documente_atribuire')
        .select('id, nume_original, text_extras').eq('licitatie_id', licId).eq('tip', 'fisa_date').in('status_procesare', ['procesat', 'partial'])
      const fisa = (fise || []).find(f => (f.text_extras || '').length > 500)
      if (!fisa) return fail('Nicio fișă de date procesată — rulează întâi ingestia (🤖 Procesează) pe documentul tip „fișa de date”.')
      const tot = fisa.text_extras as string
      srcDocId = fisa.id

      const pos = (re: RegExp, from = 0) => { const m = tot.slice(from).search(re); return m < 0 ? -1 : m + from }
      const iII = pos(/Sec.iunea II\b/)
      const iIII = pos(/Sec.iunea III\b/)
      const iIV = iIII >= 0 ? pos(/\n\s*IV[\.\s]?\d/, iIII) : pos(/\n\s*IV[\.\s]?\d/)
      const iVfin = pos(/Sec.iunea V\b|Sec.iunea VI\b/, Math.max(iIV, iIII, 0))
      if (sectiune === 'II') {
        if (iII < 0) return new Response(JSON.stringify({ ok: true, sectiune, cerinte: 0, skip: 'ancora II lipsa', continua: false }), { headers: CORS })
        text = tot.slice(iII, iIII > iII ? iIII : undefined)
      } else if (sectiune === 'III') {
        if (iIII < 0) return new Response(JSON.stringify({ ok: true, sectiune, cerinte: 0, skip: 'ancora III lipsa', continua: false }), { headers: CORS })
        text = tot.slice(iIII, iIV > iIII ? iIV : (iVfin > iIII ? iVfin : undefined))
      } else if (sectiune === 'IV') {
        if (iIV < 0) return new Response(JSON.stringify({ ok: true, sectiune, cerinte: 0, skip: 'ancora IV lipsa', continua: false }), { headers: CORS })
        text = tot.slice(iIV, iVfin > iIV ? iVfin : undefined)
      } else {
        text = (iII > 0 ? tot.slice(0, iII) : '') + '\n[...]\n' + (iVfin >= 0 ? tot.slice(iVfin) : '')
        if (text.trim().length < 100) text = tot.slice(0, 8000)
      }
    }

    // Bucățile: nimic nu se mai pierde. O bucată per apel; UI-ul continuă cu bucata următoare.
    const toate = bucati(text, bucataMax)
    if (nrBucata >= toate.length) return new Response(JSON.stringify({ ok: true, cerinte: 0, skip: 'nu mai sunt bucati', continua: false }), { headers: CORS })
    const slice = toate[nrBucata]
    const pagini = intervalPagini(slice)
    const { n: sliceNorm, mapa } = mapaPozitii(slice)

    const autorSlug = /romgaz/i.test(lic.autoritate) ? 'romgaz' : /transgaz/i.test(lic.autoritate) ? 'transgaz' : /conpet/i.test(lic.autoritate) ? 'conpet' : 'alta'
    const ck = modCorpus ? `ofertare-cerinte|cs|${autorSlug}` : `ofertare-cerinte|fisa_date|${autorSlug}`
    const { data: fb } = await supabase.from('ai_feedback').select('output_ai, output_corectat')
      .eq('context_cheie', ck).eq('verdict', 'corectat').order('corectat_la', { ascending: false }).limit(3)
    const fewshot = (fb && fb.length)
      ? `\nEXEMPLE DE CORECȚII UMANE anterioare pe aceeași autoritate (învață forma din diferențe, NU copia conținutul):\n` +
        fb.map((x, i) => `Exemplul ${i + 1}: AI: ${JSON.stringify(x.output_ai)} → corectat: ${JSON.stringify(x.output_corectat)}`).join('\n') + '\n'
      : ''

    if (reset && nrBucata === 0) {
      await supabase.from('ofertare_cerinte').delete().eq('licitatie_id', licId).eq('extras_de_ai', true).is('confirmata_de', null)
    }

    const sys = modCorpus ? (tipDoc === 'formular' ? PROMPT_FORM(numeDoc) : PROMPT_CS(numeDoc, fewshot)) : PROMPT(sectiune, fewshot)
    const etichetaPag = pagini.de_la ? ` — paginile ${pagini.de_la}${pagini.pana_la && pagini.pana_la !== pagini.de_la ? `–${pagini.pana_la}` : ''} din document` : ''
    const etichetaBucata = toate.length > 1 ? ` [bucata ${nrBucata + 1}/${toate.length}]` : ''
    const userMsg = modCorpus
      ? `FRAGMENT DIN „${numeDoc}”${etichetaBucata}${etichetaPag} (${lic.nr_anunt}, ${lic.autoritate}):\n\n${slice}`
      : `FRAGMENTUL DIN FIȘA DE DATE${etichetaBucata}${etichetaPag} (${lic.nr_anunt}, ${lic.autoritate}):\n\n${slice}`
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 16000, system: sys, messages: [{ role: 'user', content: userMsg }] }),
    })
    const data = await resp.json()
    if (!resp.ok) return fail('Claude: ' + (data.error?.message || resp.status))

    try {
      const u = data.usage || {}
      await supabase.from('ai_usage_log').insert({ function_name: 'ofertare-cerinte', model: MODEL, tokens_in: u.input_tokens || 0, tokens_out: u.output_tokens || 0, cost_usd: (u.input_tokens || 0) * PRICE_IN + (u.output_tokens || 0) * PRICE_OUT, ref_table: 'ofertare_licitatii', ref_id: licId })
    } catch (_) {}

    const txt = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
    const clean = txt.replace(/```json?|```/g, '')
    let lista: any[] = []
    let trunchiat = data.stop_reason === 'max_tokens'
    try {
      const m = clean.match(/\{[\s\S]*\}/)
      const parsed = JSON.parse(m ? m[0] : '{}')
      lista = Array.isArray(parsed.cerinte) ? parsed.cerinte : []
    } catch (_) {
      const dupaCerinte = clean.slice(clean.indexOf('"cerinte"'))
      const objs = dupaCerinte.match(/\{[^{}]*\}/g) || []
      for (const o of objs) { try { lista.push(JSON.parse(o)) } catch (_) {} }
      trunchiat = true
      if (!lista.length && !modCorpus) return fail('AI a răspuns într-un format neașteptat (nici recuperarea nu a găsit cerințe).')
    }

    const TIPURI = ['eliminatorie', 'propunere', 'forma', 'contractuala']
    const CAND = ['duae', 'depunere', 'primul_loc']
    let verificate = 0
    const rows = lista
      .filter((c: any) => c && typeof c.text_cerinta === 'string' && c.text_cerinta.trim())
      .slice(0, 150)
      .map((c: any) => {
        const v = verificaPasaj(slice, sliceNorm, mapa, c.pasaj)
        if (v.verificat) verificate++
        // pagina: din pasajul găsit (sigur); altfel a modelului, doar dacă e în intervalul bucății
        const pagModel = Number.isInteger(c.pagina) ? Number(c.pagina) : null
        const pagOk = pagModel !== null && pagini.de_la !== null && pagini.pana_la !== null && pagModel >= pagini.de_la && pagModel <= pagini.pana_la
        return {
          licitatie_id: licId,
          sursa_document_id: srcDocId,
          sursa_sectiune: (typeof c.sursa_sectiune === 'string' && c.sursa_sectiune.trim()) ? c.sursa_sectiune.trim().slice(0, 40) : (modCorpus ? (tipDoc === 'formular' ? 'FORM' : 'CS') : sectiune),
          sursa_pagina: v.pagina ?? (pagOk ? pagModel : null),
          sursa_pasaj: v.pasaj,
          pasaj_verificat: v.verificat,
          text_cerinta: c.text_cerinta.trim().slice(0, 2000),
          tip: TIPURI.includes(c.tip) ? c.tip : 'propunere',
          lot: (typeof c.lot === 'string' && c.lot.trim()) ? c.lot.trim().slice(0, 30) : (lotDoc || 'toate'),
          document_probant: (typeof c.document_probant === 'string' && c.document_probant.trim() && c.document_probant !== 'null') ? c.document_probant.trim().slice(0, 300) : null,
          cand_se_prezinta: CAND.includes(c.cand_se_prezinta) ? c.cand_se_prezinta : null,
          extras_de_ai: true,
        }
      })
    if (rows.length) {
      const { error: eIns } = await supabase.from('ofertare_cerinte').insert(rows)
      if (eIns) return fail('insert cerinte: ' + eIns.message)
    }

    const continua = nrBucata + 1 < toate.length
    return new Response(JSON.stringify({
      ok: true, sectiune: modCorpus ? undefined : sectiune, doc_id: modCorpus ? srcDocId : undefined,
      cerinte: rows.length, pasaje_verificate: verificate, bucata: nrBucata + 1, bucati: toate.length, pagini,
      continua, bucata_urmatoare: continua ? nrBucata + 1 : null,
      trunchiat, model: MODEL, tokens_in: data.usage?.input_tokens, tokens_out: data.usage?.output_tokens,
      cost_usd: Number(((data.usage?.input_tokens || 0) * PRICE_IN + (data.usage?.output_tokens || 0) * PRICE_OUT).toFixed(4)),
    }), { headers: CORS })
  } catch (e: any) {
    return fail('Eroare neasteptata: ' + String(e?.message || e))
  }
})
