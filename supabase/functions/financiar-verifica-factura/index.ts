// financiar-verifica-factura v1 (27.08.2026) — verificarea facturii cu borderoul, cu Opus.
// Primește {sl_id, articole} (liniile propuse de generator), citește borderoul XLS
// (executie-borderouri) + certificatul PDF dacă există, și întoarce liniile CORECTE
// + diferențele explicate. Adevărul = borderoul. Validat pe cazul Tigveni SL3:
// ajustările provizoriu+recalculat NU se adună (se facturează diferența), iar
// „Total general fără TVA” din borderou e baza facturii.
//
// ADUSĂ ÎN REPO la 10.10.2026 din producție (v10), cu o singură schimbare: poarta de modul.
// Înainte se baza doar pe verify_jwt, iar cheia anon e un JWT valid (PR #318) — oricine avea cheia
// publică pornea verificări Opus pe orice sl_id (cost API) și primea înapoi liniile facturii.
// Acum: owner sau intrare explicită 'financiar' în user_module_access (butonul e în Financiar.jsx).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'
import { poartaModul } from '../_shared/poartaModul.ts'

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const MODEL = 'claude-opus-5'
const PRICE_IN = 5 / 1e6, PRICE_OUT = 25 / 1e6

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

const PROMPT = `Ești verificatorul de facturi al Gazpet Instal (construcții conducte gaz). Primești: (1) BORDEROUL real al unei situații de lucrări (extras din XLS, poate conține mai multe foi — contează foaia borderoului situației curente, identificată după numărul situației și luna), eventual certificatul de plată, și (2) LINIILE DE FACTURĂ propuse de generatorul automat.
Sarcina: spune liniile CORECTE de factură, strict după borderou.

REGULI NENEGOCIABILE:
- BORDEROUL E ADEVĂRUL. Nu inventa valori; fiecare linie propusă de tine trebuie să corespundă unei poziții din borderou.
- „Total general lei fără TVA” din borderou = baza facturii. Suma liniilor tale fără TVA TREBUIE să dea exact acest total.
- AJUSTĂRI RETROACTIVE (capcana clasică): când borderoul arată „Ajustare provizorie X” și „Recalculare cu coeficient final Y” pentru aceeași situație anterioară, se facturează DOAR diferența („Total valoare după ajustare” = Y − X), NU ambele, NU totalul recalculat. Provizoriul a fost deja facturat la situația lui.
- REȚINERI (garanție de bună execuție, CAR etc.): linii NEGATIVE conform borderoului/certificatului; conform practicii Gazpet, TVA se calculează pe valoarea brută a lucrărilor (reținerile au tva_pct 0 dacă nu reduc baza de TVA în borderou — urmează exact borderoul).
- TVA: cota din borderou (ex. 21%). Dacă borderoul dă „Total cu TVA”, verifică-ți aritmetica până se închide la ±0,05 lei.
- Denumirile liniilor: scurte, în română, cu referința situației/contractului (așa cum apar în borderou).
- Compară cu liniile generatorului și explică FIECARE diferență găsită, pe scurt.

Răspunde EXCLUSIV JSON compact:
{"linii":[{"denumire":"...","valoare":123.45,"tva_pct":21}],"total_fara_tva":0,"tva":0,"total_cu_tva":0,"diferente":["..."],"incredere":"mare|medie|mica","observatii":"..."}`

function xlsToText(bytes: Uint8Array): string {
  const wb = XLSX.read(bytes, { type: 'array' })
  let out = ''
  for (const name of wb.SheetNames) {
    const sh = wb.Sheets[name]
    const rows: any[][] = XLSX.utils.sheet_to_json(sh, { header: 1, raw: true, defval: '' })
    if (!rows.length) continue
    out += `\n=== FOAIA "${name}" ===\n`
    for (const r of rows.slice(0, 120)) {
      const line = r.map((c: any) => String(c ?? '').trim()).join(' | ').replace(/(\s\|\s)+$/, '')
      if (line.trim()) out += line + '\n'
    }
  }
  return out.slice(0, 60_000)
}

function b64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(bin)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const fail = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 200, headers: CORS })

  // Poarta: înainte de orice citire din BD/storage și înainte de apelul plătit.
  const poarta = await poartaModul(req, supabase, ['financiar'])
  if (!poarta.ok) return new Response(JSON.stringify({ error: poarta.error }), { status: poarta.status, headers: CORS })

  try {
    const { sl_id, articole } = await req.json()
    const slId = Number(sl_id)
    if (!slId) return fail('sl_id obligatoriu')

    const { data: sl } = await supabase.from('executie_situatii_plata')
      .select('id, nr_situatie, luna, an, valoare_baza_lei, valoare_ajustare_lei, valoare_ajustata_lei, centralizator_xls_path, certificat_pdf_path, proiect_id')
      .eq('id', slId).single()
    if (!sl) return fail('SL negasita')
    if (!sl.centralizator_xls_path && !sl.certificat_pdf_path) return fail('SL nu are borderou (XLS) sau certificat atasat — nu am cu ce verifica.')

    let borderouText = ''
    if (sl.centralizator_xls_path) {
      const { data: xls, error: eX } = await supabase.storage.from('executie-borderouri').download(sl.centralizator_xls_path)
      if (eX || !xls) return fail('Nu pot descarca borderoul: ' + (eX?.message || 'lipsa'))
      try { borderouText = xlsToText(new Uint8Array(await xls.arrayBuffer())) }
      catch (e: any) { return fail('XLS necititbil: ' + (e?.message || e)) }
    }
    let certB64: string | null = null
    if (sl.certificat_pdf_path) {
      try {
        const { data: pdf } = await supabase.storage.from('executie-borderouri').download(sl.certificat_pdf_path)
        if (pdf) { const by = new Uint8Array(await pdf.arrayBuffer()); if (by.length < 8_000_000) certB64 = b64(by) }
      } catch (_) {}
    }

    const content: any[] = []
    if (certB64) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: certB64 } })
    content.push({ type: 'text', text: `SITUAȚIA: nr. ${sl.nr_situatie} · luna ${sl.luna}/${sl.an} · valori în ERP: baza=${sl.valoare_baza_lei} ajustare=${sl.valoare_ajustare_lei} ajustata=${sl.valoare_ajustata_lei}\n\nBORDEROUL (text extras din XLS):\n${borderouText || '(fără XLS — doar certificatul PDF atașat)'}\n\nLINIILE PROPUSE DE GENERATOR:\n${JSON.stringify(articole || [])}` })

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, system: PROMPT, messages: [{ role: 'user', content }] }),
    })
    const data = await resp.json()
    if (!resp.ok) return fail('Claude: ' + (data.error?.message || resp.status))

    try {
      const u = data.usage || {}
      await supabase.from('ai_usage_log').insert({ function_name: 'financiar-verifica-factura', model: MODEL, tokens_in: u.input_tokens || 0, tokens_out: u.output_tokens || 0, cost_usd: (u.input_tokens || 0) * PRICE_IN + (u.output_tokens || 0) * PRICE_OUT, ref_table: 'executie_situatii_plata', ref_id: slId })
    } catch (_) {}

    const txt = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
    const m = txt.replace(/```json?|```/g, '').match(/\{[\s\S]*\}/)
    if (!m) return fail('AI a răspuns într-un format neașteptat.')
    let verdict: any
    try { verdict = JSON.parse(m[0]) } catch (_) { return fail('JSON invalid de la AI.') }

    return new Response(JSON.stringify({ ok: true, sl_id: slId, ...verdict, tokens_in: data.usage?.input_tokens, tokens_out: data.usage?.output_tokens }), { headers: CORS })
  } catch (e: any) {
    return fail('Eroare neasteptata: ' + String(e?.message || e))
  }
})
