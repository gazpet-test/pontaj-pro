// Extractorul A (planul aprobat de Răzvan 17.10.2026, PR A1): Claude Haiku 5.5 cu structured outputs, în modul `structurat`.
// A1 = doar apelul + schema + tariful; poarta de completitudine (inventarul B1) și escaladarea la Sonnet 5.5 vin în PR-urile A2 / A3.
// Corecturi față de specificația Gemini (verificate pe documentația API, 19.10.2026):
//   - structured outputs = `output_config.format` {type:'json_schema', schema} (nu `response_format`); răspunsul e garantat JSON valid;
//   - Haiku 5.5 are gândirea pornită implicit, iar tokenii de gândire se taxează ca IEȘIRE → `thinking: {type:'disabled'}` (acceptat la
//     effort ≤ high; implicit medium): extragerea copiază cifre, nu raționează;
//   - fără `temperature` (parametrii de sampling ne-impliciți dau 400 pe Haiku 5.5) și fără prefill;
//   - tokenizatorul nou numără ~30% mai mulți tokeni decât Haiku 4.5 — rezervarea rămâne pe octeți (tokeni ≤ octeți UTF-8), deci sigură;
//   - tariful are două trepte: ≤ 100k tokeni de intrare $0,10 / $0,50 per MTok, peste $0,50 / $2,50.
// Schema = exact câmpurile CAMPURI_RAND (randDinTablou acceptă obiectul doar cu cheile astea), fără enum pe câmpurile de domeniu.
import { CAMPURI_RAND } from '../_shared/cantNormalizare.ts'

export const MODEL_A = 'claude-haiku-5-5'
// escaladarea (PR A3): Claude Sonnet 5.5, $2 / $10 per MTok (fără treaptă). Gândirea NU se oprește cu {type:'disabled'} (400 pe Sonnet 5.5)
// ci cu {type:'between_tools'}, acceptat la effort ≤ high → effort 'medium' explicit
export const MODEL_S = 'claude-sonnet-5-5'
export const TARIF_S = { in: 2 / 1e6, out: 10 / 1e6 }
export const tarifS = (_tokeniIntrare: number) => TARIF_S
export const PRAG_TREAPTA = 100_000
export const TARIF_A = { mic: { in: 0.10 / 1e6, out: 0.50 / 1e6 }, mare: { in: 0.50 / 1e6, out: 2.50 / 1e6 } }
// treapta după numărul de tokeni de intrare (la rezervare: octeții, care sunt ≥ tokenii — deci treapta nu poate fi subestimată)
export const tarifA = (tokeniIntrare: number) => tokeniIntrare > PRAG_TREAPTA ? TARIF_A.mare : TARIF_A.mic

const sirSauNull = { anyOf: [{ type: 'string' }, { type: 'null' }] }
const intSauNull = { anyOf: [{ type: 'integer' }, { type: 'null' }] }
const TIP_CAMP: Record<(typeof CAMPURI_RAND)[number], unknown> = {
  pagina: intSauNull, tabel: sirSauNull, rand: sirSauNull, cod_articol: sirSauNull, denumire: { type: 'string' }, obiect: sirSauNull,
  material: sirSauNull, dn_text: sirSauNull, sdr: sirSauNull, um: sirSauNull, cantitate: sirSauNull,
  e_total: { type: 'integer', enum: [0, 1] }, e_subtotal: { type: 'integer', enum: [0, 1] },
  tip_lucrare: { type: 'string', enum: ['conducta', 'bransament', 'protectie', 'alt'] },
  masura: { type: 'string', enum: ['lungime', 'montaj', 'proba', 'material', 'alt'] },
  citat: { type: 'string' },
}
export const SCHEMA_A = {
  type: 'object',
  properties: {
    r: {
      type: 'array',
      items: {
        type: 'object',
        properties: Object.fromEntries(CAMPURI_RAND.map((c) => [c, TIP_CAMP[c]])),
        required: [...CAMPURI_RAND],
        additionalProperties: false,
      },
    },
  },
  required: ['r'],
  additionalProperties: false,
}

export const PROMPT_A = (nume: string, rol: string) => `Ești inginer de devize. Din bucata de mai jos a documentului "${nume}" (secțiune cu rolul: ${rol}), extrage FIECARE RÂND cantitativ (lungimi de conductă, branșamente, tuburi de protecție, lucrări cu cantitate).

Răspunsul are forma {"r":[...]} cu câte un obiect pe rând (schema e impusă):
- pagina: numărul din cel mai apropiat marcaj ⟦PAGINA n⟧ de dinaintea rândului, sau null;
- tabel / rand: identificatorul tabelului și al rândului (nr. crt.), cum apar, sau null;
- cod_articol: caracter cu caracter, sau null; denumire: textul poziției, exact (cu material / diametru / SDR dacă apar și pe liniile imediat de sub cantitate);
- obiect: obiectul / strada / tronsonul căruia îi aparține rândul (din titlul tabelului sau al listei), sau null;
- material, dn_text, sdr: cum apar în document (ex. "PE100", "Dn 90", "SDR11"), sau null;
- um: unitatea exactă din document; cantitate: cifra EXACT cum e scrisă, ca TEXT (ex. "570.000", "3.995,00"), null dacă lipsește;
- e_total / e_subtotal: 1 dacă rândul e un total / subtotal declarat, altfel 0;
- tip_lucrare: conducta | bransament | protectie | alt; masura: lungime | montaj | proba | material | alt;
- citat: copiat VERBATIM, continuu, din document (max. 300 de caractere), fără „...”, fără prescurtări, fără reordonări: într-o listă / un tabel = linia rândului de la ÎNCEPUTUL ei (nr. crt. și cod) până după cantitate și unitate, exact cum apare (ex. "003 SA11G1 [ 2] M 1160.000"); într-un text (caiet de sarcini, memoriu) = propoziția care conține cantitatea, cu denumirea / Dn-ul ei. Dacă porțiunea depășește 300 de caractere: ultimele caractere CONTINUE care se termină imediat după cantitate și unitate.
REGULI: nu calcula, nu aduna, nu converti; nu inventa rânduri; null ≠ 0; un rând per poziție din document; NU sări niciun rând de tabel care are cantitate scrisă, chiar dacă nu e țeavă. Include DOAR rândurile care au o cantitate scrisă. NU include totalurile valorice (RON / lei / valoare), liniile „0.000 0 Total=” și nici antetele de tabel. În listele de resurse / consumuri (C6) extrage DOAR rândurile cu unitate de lungime (m, ml, km). Într-un text (caiet de sarcini, memoriu) NU extrage adâncimi de pozare, distanțe de gardă, presiuni, temperaturi, durate sau grosimi — doar cantitățile de lucrări / conducte.`

export type RezultatA = { txt: string; inF: number; outF: number; eroare?: string; necunoscut?: boolean }

// Un apel; erorile se ÎNTORC. `necunoscut` = rezultat incert (tăiat la max_tokens, refuz, alt stop) — nu se scrie ca extragere completă.
export async function cheamaA(fetchFn: typeof fetch, cheie: string, prompt: string, maxIesire: number, model: string = MODEL_A): Promise<RezultatA> {
  const r = await fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': cheie, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: maxIesire,
      ...(model === MODEL_S ? { thinking: { type: 'between_tools' } } : { thinking: { type: 'disabled' } }),
      output_config: { format: { type: 'json_schema', schema: SCHEMA_A }, ...(model === MODEL_S ? { effort: 'medium' } : {}) },
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  let d: any = null
  try { d = await r.json() } catch { /* corp ne-JSON */ }
  if (!r.ok) return { txt: '', inF: 0, outF: 0, eroare: 'Claude: ' + (d?.error?.message || r.status) }
  const u = d?.usage || {}
  const inF = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
  const txt = (d?.content || []).filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('')
  return { txt, inF, outF: u.output_tokens || 0, necunoscut: d?.stop_reason !== 'end_turn' }
}
