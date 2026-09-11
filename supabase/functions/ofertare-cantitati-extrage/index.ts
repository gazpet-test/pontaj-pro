// ofertare-cantitati-extrage — scoate pozițiile cantitative din documentația deja citită
// și le pune în `ofertare_cantitati`, ca pasul determinist să aibă pe ce lucra (11.09.2026).
//
// De ce: `v_ofertare_contradictii` calculează în COD diferențele (sumă vs total declarat,
// planșă vs document, poziții fără cantitate) — fiindcă modelele halucinează la reconcilieri
// numerice. Dar codul n-are ce compara dacă nimeni n-a structurat cifrele. Pe Mostiștea
// existau 9 rânduri puse cu mâna și verificarea a găsit imediat cei 7.340 m lipsă; pe Domnești
// erau ZERO rânduri, deci zero contradicții găsite — nu pentru că n-ar fi, ci fiindcă nu e ce compara.
//
// Împărțirea muncii, exact cum trebuie: AI-ul EXTRAGE (valoare, unitate, obiect, sursă),
// codul CALCULEAZĂ. Modelul nu face nicio adunare aici și nu i se cere să tragă concluzii.
//
// Un document pe apel, nu tot corpusul într-unul singur: la ~140k tokeni modelul pierde
// mijlocul contextului, iar o reluare costă tot. Documentele mari se taie în felii cu
// suprapunere, ca un tabel rupt între felii să nu se piardă.
//
// BUGET DE TIMP, nu buclă lungă: gateway-ul taie la ~150s, iar corpusul Domnești are 18 felii
// a câte ~40s de Opus — o singură invocare ar fi murit la jumătate, cu banii cheltuiți și nimic
// scris. Fiecare rulare lucrează cât îi permite bugetul, SCRIE ce a găsit, și întoarce
// `continua: true` + indexul următor. Același tipar ca ofertare-seap-import.
//
// Auth: JWT de utilizator SAU x-radar-secret. Body: {licitatie_id, dry_run?, de_la?}.
// Erorile de business se întorc în răspuns, nu se aruncă.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-radar-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}
// Haiku, nu Opus. Asta e muncă mecanică: copiază cifra din tabel, nu judecă nimic — adunările
// le face codul în v_ofertare_contradictii. Opus costă $25/milion la IEȘIRE, iar ieșirea e
// partea grea aici (o listă de cantități are sute de rânduri): o singură felie de probă a
// costat $0,23 și s-a tăiat la jumătate. Haiku e 5x mai ieftin exact pe partea care doare.
//
// `furnizor: "gemini"` rulează aceleași felii prin Gemini, ca să comparăm pe date reale în loc
// să presupunem. Prețuri verificate pe ai.google.dev/gemini-api/docs/pricing la 11.09.2026.
// ⚠️ Tariful Gemini se DUBLEAZĂ la 1 ianuarie 2027 ($1,50 / $7,50) — atunci devine mai scump
// decât Haiku, deci alegerea de azi trebuie recântărită înainte de anul nou.
const MODELE = {
  anthropic: { nume: 'claude-haiku-4-5-20251001', in: 1 / 1e6,    out: 5 / 1e6 },
  gemini:    { nume: 'gemini-3.8-flash',          in: 0.75 / 1e6, out: 3.75 / 1e6 },
} as const

// Un singur loc unde se vorbește cu modelele, ca schimbarea furnizorului să nu însemne
// rescrierea buclei. Erorile se ÎNTORC, nu se aruncă.
async function cheama(furnizor: 'anthropic' | 'gemini', intrebare: string, keyA: string, keyG: string):
  Promise<{ txt: string; inF: number; outF: number; stop?: string; eroare?: string }> {
  if (furnizor === 'gemini') {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELE.gemini.nume}:generateContent?key=${keyG}`,
      { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: intrebare }] }],
          // responseMimeType json: Gemini scoate JSON curat, fără gard de ```
          generationConfig: { maxOutputTokens: 16000, temperature: 0, responseMimeType: 'application/json' },
        }) })
    const d = await r.json()
    if (!r.ok) return { txt: '', inF: 0, outF: 0, eroare: 'Gemini: ' + (d?.error?.message || r.status) }
    const c = d.candidates?.[0]
    return {
      txt: (c?.content?.parts || []).map((p: any) => p.text || '').join(''),
      inF: d.usageMetadata?.promptTokenCount || 0,
      outF: d.usageMetadata?.candidatesTokenCount || 0,
      stop: c?.finishReason,
    }
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': keyA, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    // 8000 taia raspunsul la jumatate pe o lista de cantitati si il facea necitibil
    body: JSON.stringify({ model: MODELE.anthropic.nume, max_tokens: 16000, messages: [{ role: 'user', content: intrebare }] }),
  })
  const d = await r.json()
  if (!r.ok) return { txt: '', inF: 0, outF: 0, eroare: 'Claude: ' + (d?.error?.message || r.status) }
  return {
    txt: (d.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n'),
    inF: d.usage?.input_tokens || 0, outF: d.usage?.output_tokens || 0, stop: d.stop_reason,
  }
}
const FELIE = 55000        // caractere per apel — sub pragul unde se pierde mijlocul
const SUPRAPUNERE = 2000   // ca un tabel rupt între felii să nu dispară
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS })

async function secretOk(req: Request, db: any): Promise<boolean> {
  const s = req.headers.get('x-radar-secret')
  if (!s) return false
  const { data, error } = await db.rpc('fn_verifica_radar_secret', { p_secret: s })
  return !error && data === true
}

function felii(t: string): string[] {
  if (t.length <= FELIE) return [t]
  const out: string[] = []
  for (let i = 0; i < t.length; i += FELIE - SUPRAPUNERE) out.push(t.slice(i, i + FELIE))
  return out
}

const PROMPT = (nume: string, tip: string) => `Ești inginer de devize într-o firmă de construcții de conducte. Citește bucata de mai jos din documentația unei licitații publice și extrage POZIȚIILE CANTITATIVE — materiale, lucrări, echipamente — cu cantitatea și unitatea lor.

Document: "${nume}" (tip: ${tip})

Răspunde EXCLUSIV cu JSON COMPACT, fiecare poziție ca TABLOU de 6 elemente, în ordinea:
[categorie, denumire, um, cantitate, sursa, e_total]

{"p":[
 ["<grupa mare: Rețea distribuție / Branșamente / Stație / Tuburi protecție / Terasamente / Armături / ... sau null>",
  "<denumirea poziției, ca în document, cu diametru/material/tip dacă sunt date>",
  "<unitatea EXACTĂ din document: m, ml, mp, mc, buc, kg, to, ore>",
  <număr sau null dacă poziția e cerută dar cantitatea NU e dată>,
  "<unde anume: F3 poz.12 / memoriu cap.3 / C6 art.4>",
  <1 doar dacă rândul e un total sau subtotal declarat, altfel 0>]
]}

REGULI, în ordinea importanței:
1. NU calcula nimic. Nu aduna, nu înmulți, nu converti unități. Copiază cifra așa cum e scrisă. Dacă un total e scris în document, îl dai cu ultimul element 1; dacă nu e scris, NU îl inventezi.
2. Cantitatea se scrie ca număr simplu, cu punct zecimal (1234.56), fără separatori de mii.
3. O poziție cerută explicit dar fără cantitate în document → cantitate=null. Astea contează cel mai mult: sunt exact golurile pentru care se cere clarificare.
4. Păstrează unitatea din document. Dacă scrie "ml" pui "m" doar dacă e clar aceeași; altfel lași "ml".
5. Nu inventa poziții care nu apar. Mai bine 10 poziții corecte decât 40 din care 15 ghicite.
6. Sari peste prețuri, valori în lei și coloane de manoperă/utilaj/transport — ne interesează cantitățile fizice.

Dacă bucata nu conține poziții cantitative, întoarce {"p":[]}.
Nu scrie NIMIC în afara JSON-ului — nici explicații, nici comentarii.`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const SUPA_URL = Deno.env.get('SUPABASE_URL')!
  const db = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  if (!(await secretOk(req, db))) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'fără autentificare' }, 401)
    const uc = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: u } = await uc.auth.getUser()
    if (!u?.user) return json({ error: 'token invalid' }, 401)
  }
  const KEY_A = Deno.env.get('ANTHROPIC_API_KEY') || ''
  const KEY_G = Deno.env.get('GEMINI_API_KEY') || ''

  let body: any = {}; try { body = await req.json() } catch { /* gol */ }
  const licId = Number(body.licitatie_id)
  const dryRun = body.dry_run === true
  const deLa = Number(body.de_la) || 0
  const maxFelii = Number(body.max_felii) || 0   // pentru probe ieftine de calitate
  const furnizor: 'anthropic' | 'gemini' = body.furnizor === 'gemini' ? 'gemini' : 'anthropic'
  const M = MODELE[furnizor]
  if (!licId) return json({ error: 'licitatie_id lipsă' }, 400)
  if (furnizor === 'gemini' && !KEY_G) return json({ error: 'GEMINI_API_KEY lipsă din secretele funcției' }, 500)
  if (furnizor === 'anthropic' && !KEY_A) return json({ error: 'ANTHROPIC_API_KEY lipsă' }, 500)
  const t0 = Date.now()
  // 110s păreau o marjă bună față de pragul de 150s, dar bugetul se verifică ÎNAINTE de o felie,
  // iar o felie durează până la 40s: prima rulare a ajuns la ~155s, a fost tăiată, și a pierdut
  // TOT ce plătise. 60s lasă loc feliei celei mai lente plus scrierii.
  const BUGET_MS = 60000

  // Doar documentele din care ies cifre. Fișa de date e despre calificare, nu despre cantități;
  // planșele merg pe alt flux (ofertare-plansa-citeste), care scrie în cantitate_plansa.
  const { data: docs, error: dErr } = await db.from('ofertare_documente_atribuire')
    .select('id, nume_original, tip, text_extras')
    .eq('licitatie_id', licId)
    .in('tip', ['lista_cantitati', 'cs_volum', 'alta'])
    .order('id')
  if (dErr) return json({ error: 'citire documente: ' + dErr.message })

  const deLucru = (docs || []).filter(d => (d.text_extras || '').length > 500)
  if (!deLucru.length) return json({ error: 'niciun document cu text din care să ies cifre' }, 404)

  // munca, aplatizată în felii, ca reluarea să fie un simplu index
  const munca: { doc: any; bucata: string; nr: number; din: number }[] = []
  for (const d of deLucru) {
    const b = felii(d.text_extras as string)
    b.forEach((bu, i) => munca.push({ doc: d, bucata: bu, nr: i + 1, din: b.length }))
  }

  let tokIn = 0, tokOut = 0, poz = deLa, continua = false, scriseTotal = 0
  const raport: any[] = []
  const toate: any[] = []

  while (poz < munca.length) {
    if (Date.now() - t0 > BUGET_MS) { continua = true; break }
    if (maxFelii && poz - deLa >= maxFelii) { continua = true; break }
    const { doc: d, bucata, nr, din } = munca[poz]
    const intrebare = `${PROMPT(d.nume_original, d.tip)}\n\n--- BUCATA ${nr}/${din} ---\n${bucata}`
    const r = await cheama(furnizor, intrebare, KEY_A, KEY_G)
    if (r.eroare) { raport.push({ doc: d.nume_original, bucata: `${nr}/${din}`, eroare: r.eroare }); poz++; continue }
    const inF = r.inF, outF = r.outF
    tokIn += inF; tokOut += outF
    // jurnalul se scrie PE FELIE: rularea pierduta la timeout a cheltuit bani pe care
    // nu i-am mai putut masura, fiindca logul se scria abia la final
    try {
      await db.from('ai_usage_log').insert({
        function_name: 'ofertare-cantitati-extrage', model: M.nume,
        tokens_in: inF, tokens_out: outF, cost_usd: inF * M.in + outF * M.out,
        ref_table: 'ofertare_licitatii', ref_id: licId,
      })
    } catch { /* jurnalul nu blocheaza munca */ }
    const txt = r.txt
    let j: any = null
    try { const m = txt.replace(/```json?|```/g, '').match(/\{[\s\S]*\}/); j = m ? JSON.parse(m[0]) : null } catch { /* mai jos */ }
    const lista = Array.isArray(j?.p) ? j.p : null
    // stop_reason si numarul de tokeni de iesire spun DE CE n-a mers: raspuns taiat la plafon
    // arata altfel decat model care a raspuns aiurea. Prima proba a esuat tacut fara ele.
    if (!lista) {
      raport.push({ doc: d.nume_original, bucata: `${nr}/${din}`, eroare: 'raspuns neinterpretabil',
        out: outF, stop: r.stop })
      poz++; continue
    }
    let alePastrate = 0
    const feliaAsta: any[] = []
    for (const p of lista) {
      // [categorie, denumire, um, cantitate, sursa, e_total]
      if (!Array.isArray(p) || !p[1]) continue
      const eTotal = p[5] === 1 || p[5] === true
      const den = String(p[1]).slice(0, 480)
      feliaAsta.push({
        licitatie_id: licId,
        categorie: p[0] ? String(p[0]).slice(0, 120) : null,
        denumire: eTotal && !/^\s*total\b/i.test(den) ? `TOTAL ${den}` : den,
        um: p[2] ? String(p[2]).slice(0, 20) : null,
        // un model poate intoarce "1.234,56" sau text; NaN nu are ce cauta in coloana
        cantitate: Number.isFinite(Number(p[3])) ? Number(p[3]) : null,
        sursa: `${d.nume_original}${p[4] ? ' \u2014 ' + p[4] : ''}`.slice(0, 300),
        status: 'extras',
        extras_de_ai: true,
      })
      alePastrate++
    }
    toate.push(...feliaAsta)
    // Scriem DUPĂ FIECARE FELIE, nu la final. Prima rulare a strâns tot în memorie și a fost
    // tăiată de gateway înainte să scrie: munca plătită s-a pierdut integral. Acum o tăiere
    // costă cel mult ultima felie.
    if (!dryRun && feliaAsta.length) {
      const { data: ins, error: eIns } = await db.from('ofertare_cantitati').insert(feliaAsta).select('id')
      if (eIns) raport.push({ doc: d.nume_original, bucata: `${nr}/${din}`, eroare: 'scriere: ' + eIns.message })
      else scriseTotal += ins?.length || 0
    }
    raport.push({ doc: d.nume_original, bucata: `${nr}/${din}`, pozitii: alePastrate })
    poz++
  }

  const cost = tokIn * M.in + tokOut * M.out

  const comun = {
    ok: true, furnizor, model: M.nume, felii_total: munca.length, de_la: deLa, pana_la: poz, continua,
    urmatorul: continua ? poz : null,
    pozitii: toate.length,
    cu_cantitate: toate.filter(x => x.cantitate !== null).length,
    fara_cantitate: toate.filter(x => x.cantitate === null).length,
    totaluri: toate.filter(x => /^TOTAL\b/i.test(x.denumire)).length,
    tokens_in: tokIn, tokens_out: tokOut, cost_usd: Number(cost.toFixed(4)), raport,
  }
  if (dryRun) return json({ ...comun, dry_run: true, esantion: toate.slice(0, 25) })
  // NU se mai scrie nimic aici. Scrierea se face pe felie, mai sus. O a doua inserare la final
  // ar re-scrie tot ce s-a scris deja — exact asa au aparut cele 77 de duplicate pe Domnesti.
  return json({ ...comun, scrise: scriseTotal })
})
