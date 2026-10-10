// parse-certificat-plata v8 (edge v14) — 04.08.2026
// v7: max_tokens 3072 -> 8192 (documente mari epuizau bugetul in thinking).
// v8: separa AJUSTAREA ICC (col b, clz.48 — necesita Act Aditional) de ALTE SUME
//     (col c-g: retineri restituite, penalizari, avans — NU necesita AA; se inchid
//     singure la intrarea in grafic). Inainte totul era amestecat in "ajustare" si
//     alerta de AA se declansa si pe retineri.
// ADUSĂ ÎN REPO la 10.10.2026 din producție (v24), cu o singură schimbare: poarta de modul.
// Înainte orice cont logat (getUser fără rol) putea porni citiri Sonnet plătite. Acum: owner sau
// intrare explicită 'executie' în user_module_access (butonul e în Execuție → Situații de plată).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { poartaModul } from '../_shared/poartaModul.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_PROMPT = `Ești expert în citirea Certificatelor de Plată emise de SNTGN Transgaz SA către SC Gazpet Instal SRL.

STRUCTURA TABELULUI (Certificat de Plată TGZ) — coloane per rând de obiect:
  • col \"a\" = Val. estimată pt. lucrări executate (BAZĂ, fără TVA, FĂRĂ ajustare)
  • col \"b\" = Sume pt. ajustarea prețurilor conf. clz.48 (AJUSTARE ICC; goală = 0)
  • col \"c\" = Sume aferente Sumelor Reținute conf. clz.47 (rețineri/restituiri)
  • col \"d\" = Sume aferente plății în avans conf. clz.46
  • col \"e\" = Echipamente și materiale conf. subclz.50.2
  • col \"f\" = Sume pt. neexecutarea obligațiilor conf. subclz.36.3 (penalizări, negative)
  • col \"g\" = Orice alte adaugiri sau deduceri (aici apar și RESTITUIRILE de sume reținute)
  • col \"h\" = TOTAL PLATĂ CURENTĂ (= a+b+c+d+e+f+g) — ULTIMA coloană din dreapta
- Rândul TOTAL de jos totalizează fiecare coloană.
- Nu toate certificatele au valori în c..g — adesea sunt goale (= 0).

Returnează DOAR un obiect JSON valid, fără text/markdown în jur:
{
  \"nr_certificat\": \"ex: 11/24.06.2026\",
  \"data_certificat\": \"YYYY-MM-DD sau null (ATENȚIE la AN, ex 2026)\",
  \"valoare_totala_fara_tva\": număr,
  \"nr_situatie\": \"ex: 11\",
  \"luna_an\": \"ex: MAI 2026\",
  \"contract_nr\": \"ex: 30/22.01.2025\",
  \"linii\": [ { \"denumire\": \"...\", \"valoare_baza\": număr (col a), \"ajustare\": număr (DOAR col b, 0 dacă gol), \"alte_sume\": număr (suma col c+d+e+f+g, 0 dacă goale; poate fi negativă) } ],
  \"confidence\": 0.0-1.0
}

REGULI:
- valoare_totala_fara_tva = TOTALUL col \"h\" (TOTAL PLATĂ CURENTĂ), rândul TOTAL. NU col \"a\".
- \"ajustare\" = STRICT col \"b\" (ajustare ICC clz.48). NU pune în ea rețineri, restituiri, penalizări sau alte sume — alea merg în \"alte_sume\".
- \"linii\" = câte un element per RÂND DE OBIECT (nu TOTAL, nu antetul cu conducta, nu rândul AVANS gol). Include și rândurile de tip RESTITUIRE/penalizare (baza 0, alte_sume completat). Copiază denumirea exact.
- VERIFICĂ: suma pe linii (valoare_baza + ajustare + alte_sume) TREBUIE să dea valoare_totala_fara_tva. Dacă nu dă, recitește și corectează înainte să răspunzi.
- Returnează DOAR JSON.`;

async function callAI(pdfBase64: string, mediaType: string) {
  const isImage = mediaType.startsWith('image/');
  const contentBlock = isImage
    ? { type: 'image', source: { type: 'base64', media_type: mediaType, data: pdfBase64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [ contentBlock, { type: 'text', text: 'Citește tabelul. Extrage TOTAL PLATĂ CURENTĂ (col h) + defalcarea pe obiecte: col a = bază, col b = ajustare ICC, col c..g însumate = alte_sume (rețineri/restituiri/penalizări). Suma liniilor = totalul. Returnează DOAR JSON.' } ]
      }]
    })
  });
  if (!response.ok) {
    const err = await response.text();
    console.error('[parse-cp] Anthropic API error', response.status, err.slice(0, 500));
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }
  return response.json();
}

// Sonnet poate returna blocuri non-text (ex. thinking) înaintea textului — luăm TOATE blocurile text.
function extractText(aiResponse: any): string {
  const blocks = Array.isArray(aiResponse?.content) ? aiResponse.content : [];
  return blocks.filter((b: any) => b?.type === 'text' && typeof b?.text === 'string').map((b: any) => b.text).join('\n');
}

function parseJSON(text: string): any {
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Nu am găsit JSON în răspunsul AI');
  return JSON.parse(match[0]);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const poarta = await poartaModul(req, supabase, ['executie']);
    if (!poarta.ok) return new Response(JSON.stringify({ error: poarta.error }), { status: poarta.status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const { pdf_base64, media_type = 'application/pdf' } = body;
    if (!pdf_base64) return new Response(JSON.stringify({ error: 'pdf_base64 lipsește' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });

    const aiResponse = await callAI(pdf_base64, media_type);
    console.log('[parse-cp] stop_reason:', aiResponse?.stop_reason, '| blocks:', JSON.stringify((aiResponse?.content || []).map((b: any) => b?.type)));
    const rawText = extractText(aiResponse);
    console.log('[parse-cp] rawText (900):', rawText.slice(0, 900));

    if (!rawText && aiResponse?.stop_reason === 'max_tokens') {
      console.error('[parse-cp] max_tokens atins fara text — document prea complex pt buget curent');
      return new Response(JSON.stringify({ error: 'Documentul are prea multe rânduri pentru citire într-un singur pas — încearcă din nou sau contactează suportul' }), { status: 422, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    let parsed: any;
    try { parsed = parseJSON(rawText); }
    catch (e) {
      console.error('[parse-cp] JSON parse fail:', String(e), '| rawText:', rawText.slice(0, 900));
      return new Response(JSON.stringify({ error: 'Nu am putut parsa răspunsul AI', raw_text: rawText.slice(0, 1200) }), { status: 422, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    if (!parsed.valoare_totala_fara_tva || isNaN(Number(parsed.valoare_totala_fara_tva))) {
      console.error('[parse-cp] total lipsă. parsed:', JSON.stringify(parsed).slice(0, 700));
      return new Response(JSON.stringify({ error: 'Nu am găsit valoarea totală în document', parsed, raw_text: rawText.slice(0, 1200) }), { status: 422, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const total = Number(parsed.valoare_totala_fara_tva);
    const linii = Array.isArray(parsed.linii)
      ? parsed.linii.map((l: any) => ({ denumire: String(l.denumire || '').slice(0, 200).trim(), valoare_baza: Number(l.valoare_baza) || 0, ajustare: Number(l.ajustare) || 0, alte_sume: Number(l.alte_sume) || 0 }))
          .filter((l: any) => l.denumire && (l.valoare_baza !== 0 || l.ajustare !== 0 || l.alte_sume !== 0))
      : [];
    const linii_total = Math.round(linii.reduce((s: number, l: any) => s + l.valoare_baza + l.ajustare + l.alte_sume, 0) * 100) / 100;
    const linii_ok = linii.length > 0 && Math.abs(linii_total - total) < 1;
    const total_ajustare_icc = Math.round(linii.reduce((s: number, l: any) => s + l.ajustare, 0) * 100) / 100;
    const total_alte_sume = Math.round(linii.reduce((s: number, l: any) => s + l.alte_sume, 0) * 100) / 100;
    console.log('[parse-cp] total:', total, '| linii:', linii.length, '| linii_total:', linii_total, '| linii_ok:', linii_ok, '| icc:', total_ajustare_icc, '| alte:', total_alte_sume);

    return new Response(JSON.stringify({
      success: true,
      nr_certificat: parsed.nr_certificat || null,
      data_certificat: parsed.data_certificat || null,
      valoare_totala_fara_tva: total,
      nr_situatie: parsed.nr_situatie || null,
      luna_an: parsed.luna_an || null,
      contract_nr: parsed.contract_nr || null,
      linii, linii_total, linii_ok,
      total_ajustare_icc, total_alte_sume,
      confidence: Number(parsed.confidence || 0.8),
    }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[parse-cp] fatal:', e?.message || String(e));
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
