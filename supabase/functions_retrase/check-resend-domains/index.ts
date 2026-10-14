import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!

const SYSTEM_PROMPT = `Ești expert în citirea Certificatelor de Plată emise de SNTGN Transgaz SA către SC Gazpet Instal SRL.

STRUCTURA TABELULUI (Certificat de Plată TGZ) — coloane per rând de obiect:
  • col "a" = Val. estimată pt. lucrări executate (BAZĂ, fără TVA, FĂRĂ ajustare)
  • col "b" = Sume pt. ajustarea prețurilor conf. clz.48 (AJUSTARE ICC; goală = 0)
  • col "c" = Sume aferente Sumelor Reținute conf. clz.47 (rețineri/restituiri)
  • col "d" = Sume aferente plății în avans conf. clz.46
  • col "e" = Echipamente și materiale conf. subclz.50.2
  • col "f" = Sume pt. neexecutarea obligațiilor conf. subclz.36.3 (penalizări, negative)
  • col "g" = Orice alte adaugiri sau deduceri (aici apar și RESTITUIRILE de sume reținute)
  • col "h" = TOTAL PLATĂ CURENTĂ (= a+b+c+d+e+f+g) — ULTIMA coloană din dreapta
- Rândul TOTAL de jos totalizează fiecare coloană.
- Nu toate certificatele au valori în c..g — adesea sunt goale (= 0).

Returnează DOAR un obiect JSON valid, fără text/markdown în jur:
{
  "nr_certificat": "ex: 11/24.06.2026",
  "data_certificat": "YYYY-MM-DD sau null (ATENȚIE la AN, ex 2026)",
  "valoare_totala_fara_tva": număr,
  "nr_situatie": "ex: 11",
  "luna_an": "ex: MAI 2026",
  "contract_nr": "ex: 30/22.01.2025",
  "linii": [ { "denumire": "...", "valoare_baza": număr (col a), "ajustare": număr (DOAR col b, 0 dacă gol), "alte_sume": număr (suma col c+d+e+f+g, 0 dacă goale; poate fi negativă) } ],
  "confidence": 0.0-1.0
}

REGULI:
- valoare_totala_fara_tva = TOTALUL col "h" (TOTAL PLATĂ CURENTĂ), rândul TOTAL. NU col "a".
- "ajustare" = STRICT col "b" (ajustare ICC clz.48). NU pune în ea rețineri, restituiri, penalizări sau alte sume — alea merg în "alte_sume".
- "linii" = câte un element per RÂND DE OBIECT (nu TOTAL, nu antetul cu conducta, nu rândul AVANS gol). Include și rândurile de tip RESTITUIRE/penalizare (baza 0, alte_sume completat). Copiază denumirea exact.
- VERIFICĂ: suma pe linii (valoare_baza + ajustare + alte_sume) TREBUIE să dea valoare_totala_fara_tva. Dacă nu dă, recitește și corectează înainte să răspunzi.
- Returnează DOAR JSON.`

Deno.serve(async (req: Request) => {
  try {
    const { pdf_base64 } = await req.json()
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [ { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf_base64 } }, { type: 'text', text: 'Citește tabelul. Extrage TOTAL PLATĂ CURENTĂ (col h) + defalcarea pe obiecte: col a = bază, col b = ajustare ICC, col c..g însumate = alte_sume (rețineri/restituiri/penalizări). Suma liniilor = totalul. Returnează DOAR JSON.' } ] }]
      }),
    })
    const data = await resp.json()
    const txt = (data.content||[]).filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n')
    return new Response(JSON.stringify({ status: resp.status, stop_reason: data.stop_reason, text: txt }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 200 })
  }
})
