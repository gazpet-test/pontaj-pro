// ofertare-genereaza-capitol v1 (13.09.2026) — scrie UN capitol din propunerea tehnică.
//
// De ce e ultimul lucru construit din modul, nu primul: un generator fără poartă e o mașină de
// produs text plauzibil pentru un document depus la SEAP. Poarta există acum (rândul
// `capitole_nescrise_de_om` din v_ofertare_pt_stare BLOCHEAZĂ depunerea până când un om
// deschide capitolul, îl citește și îl salvează), deci generatorul poate exista.
//
// TREI INTERDICȚII ÎN COD, nu doar în prompt. Regulile din prompt sunt rugăminți către model;
// astea sunt bariere:
//   1. Capitol BLOCAT → refuz. Lacătul înseamnă lacăt.
//   2. Capitol cu sursa='om' și text scris → refuz, dacă nu vine explicit `peste_om: true`
//      din UI (unde omul confirmă). Altfel un click greșit șterge munca cuiva; textul vechi
//      ajunge în istoric, dar tot e o zi pierdută.
//   3. Scrie ÎNTOTDEAUNA sursa='ai'. Generatorul nu poate să-și dea singur aviz de om.
//      Versiunea o incrementează triggerul trg_pt_capitol_versioneaza, nu functia asta.
//
// Regula de fond a promptului: NU inventează fapte despre firmă. Unde lipsește un fapt (cifre,
// nume, utilaje, termene), scrie [DE COMPLETAT: ce anume] — un gol vizibil, nu o propoziție
// plauzibilă. Diferența asta e tot ce separă un ajutor de o declarație falsă către autoritate.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const MODEL = 'claude-opus-5'
const PRICE_IN = 5 / 1e6, PRICE_OUT = 25 / 1e6

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

const PROMPT = `Ești redactorul propunerilor tehnice al Gazpet Instal SRL (Ploiești, execuție conducte și rețele de distribuție gaze naturale). Scrii UN SINGUR CAPITOL din propunerea tehnică depusă la o licitație publică din România (SEAP).

CE E DOCUMENTUL ĂSTA: o piesă dintr-o ofertă depusă la o autoritate contractantă. Se citește de o comisie de evaluare care caută motive de descalificare. Nu e un eseu, nu e marketing.

REGULA CARE BATE TOATE CELELALTE — NU INVENTEZI FAPTE DESPRE FIRMĂ.
Nu ai voie să scrii nicio cifră, niciun nume de persoană, niciun utilaj, nicio durată, niciun număr de certificat, nicio experiență anterioară care nu ți-a fost dată explicit în datele de mai jos.
Unde textul CERE un fapt pe care nu-l ai, scrii exact: [DE COMPLETAT: <ce anume lipsește>]
Exemple corecte: "Lucrările se execută cu [DE COMPLETAT: nr. echipe și componența lor]." · "Durata de execuție propusă este de [DE COMPLETAT: durata în luni, din graficul de execuție]."
Un gol marcat se vede și se completează. O propoziție plauzibilă dar inventată trece nevăzută până la evaluare, și atunci e declarație falsă. Mai bine zece marcaje decât o cifră inventată.

CUM SCRII:
- Română corectă, la persoana I plural ("vom executa", "asigurăm"), ton tehnic-administrativ, fără superlative comerciale.
- Răspunzi PUNCT CU PUNCT la cerințele atribuite capitolului. Comisia bifează cerințe, nu apreciază stilul. Dacă o cerință cere "se va prezenta X", capitolul trebuie să conțină X sau trimiterea explicită la anexa unde e.
- Structurezi pe subpuncte numerotate când capitolul acoperă mai multe cerințe.
- Fără introduceri de genul "În cele ce urmează vom prezenta". Intri direct în subiect.
- Lungime pe măsura cerințelor: un capitol cu două cerințe nu are nevoie de opt pagini.
- Text simplu, paragrafe separate prin linie goală. Fără markdown, fără ##, fără **bold**.

CE NU FACI:
- Nu scrii "nu este cazul" decât dacă ești sigur din cerințe — unele autorități îl interzic explicit și descalifică pentru el.
- Nu promiți nimic peste ce cer cerințele (fiecare promisiune în plus devine obligație contractuală).
- Nu copiezi cerința ca răspuns la ea însăși.

Răspunzi EXCLUSIV cu textul capitolului. Fără preambul, fără explicații despre ce ai făcut, fără ghilimele în jur.`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  // Erorile de BUSINESS se intorc, nu se arunca: `throw` in try + update in catch a omorat
  // intermitent workerul in alte functii ale casei.
  const fail = (msg: string, extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ error: msg, ...extra }), { status: 200, headers: CORS })

  try {
    const { capitol_id, instructiune, peste_om } = await req.json()
    const capId = Number(capitol_id)
    if (!capId) return fail('capitol_id obligatoriu')

    const { data: cap, error: eCap } = await supabase.from('ofertare_pt_capitole')
      .select('id, licitatie_id, nr, sectiune, eticheta, titlu, obligatoriu, continut, sursa, blocat, versiune')
      .eq('id', capId).single()
    if (eCap || !cap) return fail('capitolul nu a fost gasit: ' + (eCap?.message || capId))

    // INTERDICȚIA 1 — lacătul
    if (cap.blocat) return fail('Capitolul e blocat. Deblochează-l întâi, dacă chiar vrei să-l rescrii.')
    // INTERDICȚIA 2 — munca unui om nu se rescrie din greșeală
    const areTextDeOm = String(cap.sursa || 'om') === 'om' && String(cap.continut || '').trim() !== ''
    if (areTextDeOm && !peste_om) {
      return fail('Capitolul are text scris de om. Confirmă explicit rescrierea (textul vechi rămâne în istoric).',
        { cere_confirmare: true, versiune: cap.versiune })
    }

    const { data: lic } = await supabase.from('ofertare_licitatii')
      .select('id, nr_anunt, autoritate, obiect, termen_depunere').eq('id', cap.licitatie_id).single()

    // Cerintele ATRIBUITE capitolului. Daca n-are niciuna, nu generam: ar iesi text generic,
    // adica exact ce nu-i trebuie nimanui intr-o propunere tehnica.
    const { data: leg, error: eLeg } = await supabase.from('ofertare_pt_legaturi')
      .select('cerinta_id').eq('capitol_id', capId).eq('fel', 'capitol')
    if (eLeg) return fail('legaturile nu s-au putut citi: ' + eLeg.message)
    const ids = (leg || []).map((l: any) => l.cerinta_id)
    if (!ids.length) return fail('Capitolul n-are nicio cerință atribuită. Atribuie-i cerințele întâi — altfel iese text generic.')

    const { data: cerinte, error: eCer } = await supabase.from('ofertare_cerinte')
      .select('id, text_cerinta, tip, sursa_sectiune, document_probant')
      .in('id', ids).is('inlocuita_de', null).order('id')
    if (eCer) return fail('cerintele nu s-au putut citi: ' + eCer.message)
    if (!cerinte?.length) return fail('Cerintele atribuite nu mai exista (inlocuite?). Reatribuie capitolul.')

    // Observatiile deschise pe capitol: daca un om a cerut deja o modificare, generatorul
    // trebuie s-o stie, altfel prima lui iesire o ignora si omul o cere a doua oara.
    const { data: obs } = await supabase.from('ofertare_pt_observatii')
      .select('text').eq('capitol_id', capId).eq('stare', 'deschisa').limit(20)

    const context = [
      `LICITAȚIA: ${lic?.obiect || '(fără obiect)'}`,
      lic?.autoritate ? `AUTORITATEA CONTRACTANTĂ: ${lic.autoritate}` : '',
      lic?.nr_anunt ? `ANUNȚ: ${lic.nr_anunt}` : '',
      '',
      `CAPITOLUL DE SCRIS: ${[cap.sectiune, cap.eticheta].filter(Boolean).join(' · ')} ${cap.titlu}`,
      cap.obligatoriu ? '(capitol OBLIGATORIU)' : '(capitol opțional)',
      '',
      `CERINȚELE ATRIBUITE CAPITOLULUI (${cerinte.length}) — la fiecare trebuie să se poată bifa un răspuns în text:`,
      ...cerinte.map((c: any, i: number) =>
        `${i + 1}. [${c.tip}${c.sursa_sectiune ? ' · ' + c.sursa_sectiune : ''}] ${c.text_cerinta}` +
        (c.document_probant ? `\n   (document probant cerut: ${c.document_probant})` : '')),
      (obs || []).length ? `\nMODIFICĂRI CERUTE DE COLEGI, de respectat:\n${(obs || []).map((o: any, i: number) => `- ${o.text}`).join('\n')}` : '',
      instructiune ? `\nINSTRUCȚIUNE SUPLIMENTARĂ DE LA REDACTOR:\n${String(instructiune).slice(0, 2000)}` : '',
    ].filter(Boolean).join('\n')

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        // Pe claude-opus-5 gandirea e pornita implicit si tokenii ei se scad din max_tokens;
        // o declaram explicit si ii dam loc, ca taietura sa nu cada in blocul de gandire.
        model: MODEL, max_tokens: 16000,
        thinking: { type: 'adaptive' },
        // Promptul e partea stabila (identica la fiecare capitol) -> intra in cache.
        system: [{ type: 'text', text: PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: [{ type: 'text', text: context }] }],
      }),
    })
    const data = await resp.json()
    if (!resp.ok) return fail('Claude: ' + (data.error?.message || resp.status))

    try {
      const u = data.usage || {}
      const cacheW = u.cache_creation_input_tokens || 0
      const cacheR = u.cache_read_input_tokens || 0
      await supabase.from('ai_usage_log').insert({
        function_name: 'ofertare-genereaza-capitol', model: MODEL,
        tokens_in: (u.input_tokens || 0) + cacheW + cacheR,
        tokens_out: u.output_tokens || 0,
        cost_usd: (u.input_tokens || 0) * PRICE_IN + cacheW * PRICE_IN * 1.25 + cacheR * PRICE_IN * 0.1 + (u.output_tokens || 0) * PRICE_OUT,
        ref_table: 'ofertare_pt_capitole', ref_id: capId,
      })
    } catch (_) {}

    const text = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('').trim()
    if (!text) return fail('Modelul n-a intors text.', { stop_reason: data.stop_reason || null })
    // Text taiat la jumatate nu se scrie: ar naste o versiune si ar arata ca un capitol scris.
    if (data.stop_reason === 'max_tokens') {
      return fail('Raspunsul s-a taiat la limita de tokeni — nu s-a scris nimic. Imparte capitolul sau redu cerintele atribuite.',
        { trunchiat: true })
    }

    // INTERDICȚIA 3 — sursa='ai' mereu. De aici incolo poarta tine capitolul blocat pana cand
    // un om il deschide, il citeste si il salveaza (UI-ul pune atunci sursa='om').
    const { error: eUpd } = await supabase.from('ofertare_pt_capitole')
      .update({ continut: text, sursa: 'ai' }).eq('id', capId)
    if (eUpd) return fail('textul nu s-a salvat: ' + eUpd.message)

    const goluri = (text.match(/\[DE COMPLETAT:/g) || []).length
    return new Response(JSON.stringify({
      ok: true, capitol_id: capId, caractere: text.length, cerinte: cerinte.length,
      goluri_de_completat: goluri,
      versiune_noua: (cap.versiune || 1) + 1,
      tokens_in: data.usage?.input_tokens, tokens_out: data.usage?.output_tokens,
      cache_citit: data.usage?.cache_read_input_tokens || 0,
    }), { headers: CORS })
  } catch (e: any) {
    return fail('Eroare neasteptata: ' + String(e?.message || e))
  }
})
