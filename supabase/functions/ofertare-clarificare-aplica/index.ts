// ofertare-clarificare-aplica — „Aplică în registru” (Răzvan 07.09.2026): răspunsul autorității la o clarificare
// modifică registrul de cerințe fără să se reia „Propune acoperire” pe tot: AI-ul (Sonnet 5) compară întrebarea + răspunsul
// cu cerințele active ale licitației și propune: modifica (text nou), anuleaza, noua. Aplicare: cerința veche primește
// inlocuita_de → rând nou (versiune+1, raspuns_clarificare_id), acoperirea existentă se copiază pe rândul nou (nu se pierde
// munca de acoperire). Cerințele noi intră neevaluate. Clarificarea trece pe status 'raspunsa'.
// Auth: JWT user SAU x-radar-secret. Body {clarificare_id, doar_propunere?: true} → cu doar_propunere întoarce planul fără să aplice.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-radar-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }
const MODEL = 'claude-sonnet-5'
const PRICE_IN = 3 / 1e6, PRICE_OUT = 15 / 1e6
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const SUPA_URL = Deno.env.get('SUPABASE_URL')!
  const db = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let userId: string | null = null
  if (req.headers.get('x-radar-secret') !== 'gazpet-radar-x7Q2mK-2026') {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'fără autentificare' }, 401)
    const uc = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: u } = await uc.auth.getUser()
    if (!u?.user) return json({ error: 'token invalid' }, 401)
    userId = u.user.id
  }
  const KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
  if (!KEY) return json({ error: 'ANTHROPIC_API_KEY lipsă' }, 500)

  let body: any = {}; try { body = await req.json() } catch { /* gol */ }
  const id = Number(body.clarificare_id)
  if (!id) return json({ error: 'clarificare_id lipsă' }, 400)
  const { data: cl } = await db.from('ofertare_clarificari').select('*').eq('id', id).maybeSingle()
  if (!cl) return json({ error: 'clarificarea nu există' }, 404)
  if (!(cl.raspuns || '').trim()) return json({ error: 'clarificarea nu are răspunsul autorității — completează-l întâi' }, 400)

  const { data: cer } = await db.from('ofertare_cerinte').select('id, tip, sursa_sectiune, text_cerinta, document_probant, cand_se_prezinta, lot, versiune, sursa_document_id, stare, stare_motiv, stare_de, stare_la')
    .eq('licitatie_id', cl.licitatie_id).is('inlocuita_de', null).order('id')
  if (!cer?.length) return json({ error: 'licitația nu are registru de cerințe' }, 400)

  const lista = cer.map(c => `#${c.id} [${c.tip}${c.sursa_sectiune ? ' · ' + c.sursa_sectiune : ''}] ${c.text_cerinta}`).join('\n')
  const prompt = `Ești consultant de achiziții publice (România, L98/2016, L99/2016, HG 395/2016). O clarificare depusă de ofertantul GAZPET INSTAL a primit răspuns de la autoritatea contractantă. Trebuie să stabilești CE SE SCHIMBĂ în registrul de cerințe al licitației.

ÎNTREBAREA (clarificarea nr. ${cl.nr}):
${cl.intrebare}
${cl.citita_rezumat ? `\nREZUMAT PLATFORMĂ: ${cl.citita_rezumat}` : ''}

RĂSPUNSUL AUTORITĂȚII:
${cl.raspuns}

REGISTRUL DE CERINȚE ACTIV (id, tip, secțiune, text):
${lista}

Răspunde EXCLUSIV cu JSON, fără comentarii:
{"modificari":[{"cerinta_id":<id>,"actiune":"modifica"|"anuleaza","text_nou":"<textul complet al cerinței după răspuns (doar la modifica)>","motiv":"<1 propoziție>"}],
 "noi":[{"tip":"eliminatorie"|"propunere"|"forma"|"contractuala","sursa_sectiune":"<ex: Răspuns clarificare nr. ${cl.nr}>","text_cerinta":"<cerința nouă, completă>","document_probant":"<ce dovadă se cere sau null>","cand_se_prezinta":"duae"|"depunere"|"primul_loc"|null,"motiv":"<1 propoziție>"}],
 "fara_efect":<true dacă răspunsul nu schimbă nicio cerință>,
 "rezumat":"<2-3 propoziții: ce a răspuns autoritatea și ce efect are asupra ofertei>"}
Reguli: modifică DOAR cerințele pe care răspunsul le schimbă efectiv (relaxare, înăsprire, precizare de conținut, termen, format); nu reformula cerințe neatinse; dacă răspunsul e „se menține documentația”, întoarce fara_efect=true și liste goale. Maxim 15 modificări.`

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 6000, messages: [{ role: 'user', content: prompt }] }),
  })
  const data = await resp.json()
  if (!resp.ok) return json({ error: 'AI: ' + (data.error?.message || resp.status) })
  const txt = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
  let j: any = null
  try { const m = txt.replace(/```json?|```/g, '').match(/\{[\s\S]*\}/); j = m ? JSON.parse(m[0]) : null } catch { /* mai jos */ }
  if (!j) return json({ error: 'răspuns AI neinterpretabil', brut: txt.slice(0, 300) })
  try { await db.from('ai_usage_log').insert({ function_name: 'ofertare-clarificare-aplica', model: MODEL, tokens_in: data.usage?.input_tokens || 0, tokens_out: data.usage?.output_tokens || 0, cost_usd: (data.usage?.input_tokens || 0) * PRICE_IN + (data.usage?.output_tokens || 0) * PRICE_OUT, ref_table: 'ofertare_clarificari', ref_id: id }) } catch { /* ignorăm */ }

  const modificari = (Array.isArray(j.modificari) ? j.modificari : []).filter((m: any) => cer.some(c => c.id === Number(m.cerinta_id))).slice(0, 15)
  const noi = (Array.isArray(j.noi) ? j.noi : []).filter((n: any) => n?.text_cerinta).slice(0, 15)
  if (body.doar_propunere) return json({ ok: true, propunere: { modificari, noi, fara_efect: !!j.fara_efect, rezumat: j.rezumat } })

  // aplicare
  const now = new Date().toISOString()
  const rezultat = { modificate: 0, anulate: 0, noi: 0, acoperiri_copiate: 0 }
  for (const m of modificari) {
    const c = cer.find(x => x.id === Number(m.cerinta_id))!
    const anul = m.actiune === 'anuleaza'
    const textNou = anul ? `[ANULATĂ prin răspunsul la clarificarea nr. ${cl.nr}] ${c.text_cerinta}` : String(m.text_nou || '').trim()
    if (!textNou) continue
    const { data: ins, error: eI } = await db.from('ofertare_cerinte').insert({
      licitatie_id: cl.licitatie_id, sursa_document_id: c.sursa_document_id, sursa_sectiune: c.sursa_sectiune, text_cerinta: textNou, tip: c.tip, lot: c.lot,
      document_probant: anul ? null : c.document_probant, cand_se_prezinta: c.cand_se_prezinta, versiune: (c.versiune || 1) + 1,
      raspuns_clarificare_id: id, extras_de_ai: true, confirmata_de: null,
      // starea de lucru pusa de om (inclusiv „nu se aplica" cu motivul ei) se muta pe versiunea noua —
      // altfel un raspuns al autoritatii resetase tacit decizia si cerinta reaparea ca eliminatorie fara dovada
      stare: c.stare || 'de_analizat', stare_motiv: c.stare_motiv, stare_de: c.stare_de, stare_la: c.stare_la,
    }).select('id').single()
    if (eI || !ins) continue
    await db.from('ofertare_cerinte').update({ inlocuita_de: ins.id, updated_at: now }).eq('id', c.id)
    if (anul) rezultat.anulate++; else {
      rezultat.modificate++
      // acoperirea de pe cerința veche se mută pe cea nouă (rămâne de reverificat de om, dar nu se pierde)
      // .maybeSingle() da eroare (si data null) cand o cerinta are mai multe randuri de acoperire —
      // exista astfel de cazuri in BD, iar efectul era ca acoperirea NU se copia, tacut. Se copiaza toate.
      const { data: acs } = await db.from('ofertare_acoperire').select('*').eq('cerinta_id', c.id).order('id')
      for (const ac of (acs || [])) {
        const { id: _i, created_at: _c, updated_at: _u, ...rest } = ac
        // Cerința s-a schimbat, deci verificarea pe scan NU mai e valabilă: se resetează
        // explicit, nu doar cu o notă în observații (auditul 09.09: marcajul supraviețuia
        // prin ...rest și cerința nouă părea verificată fără să fi văzut-o nimeni).
        const { error: eA } = await db.from('ofertare_acoperire').insert({
          ...rest, cerinta_id: ins.id,
          verificat_pe_scan: false, verificat_de: null, verificat_la: null,
          observatii: [ac.observatii, `copiată de la cerința #${c.id} după clarificarea nr. ${cl.nr} — de reverificat`].filter(Boolean).join(' · '),
        })
        if (!eA) rezultat.acoperiri_copiate++
      }
    }
  }
  for (const n of noi) {
    const tip = ['eliminatorie', 'propunere', 'forma', 'contractuala'].includes(n.tip) ? n.tip : 'propunere'
    const csp = ['duae', 'depunere', 'primul_loc'].includes(n.cand_se_prezinta) ? n.cand_se_prezinta : null
    const { error } = await db.from('ofertare_cerinte').insert({ licitatie_id: cl.licitatie_id, sursa_sectiune: n.sursa_sectiune || `Răspuns clarificare nr. ${cl.nr}`, text_cerinta: String(n.text_cerinta).trim(), tip,
      document_probant: n.document_probant || null, cand_se_prezinta: csp, versiune: 1, raspuns_clarificare_id: id, extras_de_ai: true })
    if (!error) rezultat.noi++
  }
  await db.from('ofertare_clarificari').update({ status: 'raspunsa', raspuns_la: cl.raspuns_la || now, updated_at: now }).eq('id', id)
  return json({ ok: true, ...rezultat, fara_efect: !!j.fara_efect, rezumat: j.rezumat, aplicat_de: userId })
})
