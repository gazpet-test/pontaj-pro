// ofertare-verificare-finala - Poarta 4 anti-descalificare (03.09.2026, aprobat Razvan):
// 3 treceri pe o licitatie inainte de depunere:
//   A. constructor (determinist, din registru): cerinte neconfirmate/neacoperite, dovezi rosii, formalitati
//   B. adversarial (claude-sonnet-5): citeste independent registrul si cauta ce lipseste/descalifica
//   C. ARBITRU (claude-fable-5-1, cerut explicit de Razvan): primeste A+B si da verdictul final verde/galben/rosu
// Auth: JWT user SAU x-radar-secret (cron/Claude). Rezultatul se scrie in ofertare_verificari.
//
// ADUSA IN REPO la 11.09.2026. Rula in productie NEVERSIONATA, iar in sursa avea secretul
// x-radar-secret scris LITERAL — exact valoarea care a stat luni de zile in repo-ul public —
// cu verify_jwt=false. Adica oricine citise repo-ul putea chema functia: citea registrul
// licitatiei si cheltuia bani pe doua modele la fiecare apel. Acum se verifica prin Vault,
// ca toate celelalte. Secretul ramane de ROTIT (vezi task #51).
//
// LIMITA CUNOSCUTA (semnalata de ChatGPT la 11.09.2026, confirmata): trecerea B primeste
// DOAR registrul de cerinte deja extras, cu textul taiat la 220 de caractere — nu si
// documentatia originala. Poate gasi incoerente in registru, dar NU poate demonstra ca o
// obligatie omisa la extragere nu exista in documente. Verdictul "verde" inseamna deci
// "nimic in neregula in CE AM EXTRAS", nu "depunere sigura". De corectat separat.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-radar-secret' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

async function claude(model: string, system: string, user: string, maxTok: number, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ model, max_tokens: maxTok, system, messages: [{ role: 'user', content: user }], ...extra }),
  })
  const j = await resp.json()
  if (!resp.ok) return { eroare: `${model}: ${j?.error?.message || resp.status}` }
  if (j.stop_reason === 'max_tokens') return { eroare: `${model}: taiat de max_tokens` }
  if (j.stop_reason === 'refusal') return { eroare: `${model}: refuz (${j.stop_details?.category || '?'})` }
  const text = (j.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('')
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return { eroare: model + ': fara JSON', brut: text.slice(0, 400) }
  try { return { date: JSON.parse(m[0]) } } catch { return { eroare: model + ': JSON invalid', brut: text.slice(0, 400) } }
}

// Secretul NU sta in sursa. Verificare prin RPC contra Vault, care accepta si valoarea
// precedenta cat tine fereastra de rotire, ca sa nu pice cron-urile toate deodata.
async function secretOk(req: Request, sb: any): Promise<boolean> {
  const s = req.headers.get('x-radar-secret')
  if (!s) return false
  const { data, error } = await sb.rpc('fn_verifica_radar_secret', { p_secret: s })
  return !error && data === true
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // auth: secret intern (cron/Claude) SAU JWT valid de utilizator
  let userId: string | null = null
  if (!(await secretOk(req, sb))) {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
    const { data: u } = await anon.auth.getUser(jwt)
    if (!u?.user) return json({ error: 'unauthorized' }, 401)
    userId = u.user.id
  }

  let body: { licitatie_id?: number } = {}
  try { body = await req.json() } catch { /* gol */ }
  const licId = Number(body?.licitatie_id)
  if (!licId) return json({ ok: false, error: 'licitatie_id lipsa' }, 400)

  const { data: lic } = await sb.from('ofertare_licitatii').select('*').eq('id', licId).maybeSingle()
  if (!lic) return json({ ok: false, error: 'licitatie inexistenta' }, 404)

  // --- Trecerea A: constructor (determinist) ---
  const { data: cerinte } = await sb.from('ofertare_cerinte')
    .select('id, tip, lot, text_cerinta, document_probant, cand_se_prezinta, confirmata_de, ofertare_acoperire(id, mod, status, doc_firma_id)')
    .eq('licitatie_id', licId).is('inlocuita_de', null)
  const toate = cerinte || []
  const neconfirmate = toate.filter((c: any) => !c.confirmata_de)
  const neacoperite = toate.filter((c: any) => !(c.ofertare_acoperire || []).some((a: { status: string }) => a.status === 'acoperit' || a.status === 'acoperit_partener'))
  const docIds = [...new Set(toate.flatMap((c: any) => (c.ofertare_acoperire || []).map((a: { doc_firma_id: number | null }) => a.doc_firma_id)).filter(Boolean))]
  let doveziRosii: { denumire: string; stare: string; observatii: string | null }[] = []
  if (docIds.length) {
    const { data: dv } = await sb.from('v_dovezi_stare').select('id, denumire, stare, observatii').in('id', docIds).eq('stare', 'rosie')
    doveziRosii = dv || []
  }
  const termen = lic.termen_depunere ? new Date(lic.termen_depunere) : null
  const zileRamase = termen ? Math.floor((termen.getTime() - Date.now()) / 86400000) : null
  const trecereaA = {
    cerinte_total: toate.length, neconfirmate: neconfirmate.length, neacoperite: neacoperite.length,
    dovezi_rosii: doveziRosii, zile_pana_la_termen: zileRamase,
    garantie_participare: lic.garantie_participare || null, decizie_go: lic.decizie_go ?? null,
    exemple_neacoperite: neacoperite.slice(0, 10).map((c: any) => String(c.text_cerinta || '').slice(0, 160)),
  }

  const compact = toate.map((c: any) => ({
    id: c.id, tip: c.tip, lot: c.lot,
    text: String(c.text_cerinta || '').slice(0, 220),
    probant: c.document_probant, cand: c.cand_se_prezinta,
    confirmata: !!c.confirmata_de,
    acoperita: (c.ofertare_acoperire || []).some((a: { status: string }) => a.status === 'acoperit' || a.status === 'acoperit_partener'),
  }))
  const meta = `LICITATIE: ${lic.nr_anunt || licId} - ${lic.obiect || ''}\nAutoritate: ${lic.autoritate || '?'} | Valoare estimata: ${lic.valoare_estimata || '?'} ${lic.moneda || 'RON'} | Termen depunere: ${lic.termen_depunere || '?'} (${zileRamase ?? '?'} zile) | Criteriu: ${lic.criteriu || '?'} | Garantie participare: ${lic.garantie_participare || 'NEDEFINITA'} | Loturi: ${lic.loturi || '?'} | Rol Gazpet: ${lic.rol_gazpet || '?'}`

  // --- Trecerea B: adversarial (sonnet-5) ---
  const b1 = await claude('claude-sonnet-5',
    'Esti un evaluator ADVERSARIAL de oferte la licitatii publice romanesti (Legea 98/99/2016). Primesti registrul de cerinte al unei licitatii asa cum l-a construit echipa de ofertare. Misiunea ta: gaseste TOT ce poate duce la DESCALIFICARE - cerinte probabil ratate sau interpretate gresit, categorii de cerinte care lipsesc cu totul din registru (garantie de participare, DUAE, formulare semnate, valabilitate oferta, vizita amplasament, clarificari obligatorii, subcontractanti/terti declarati, cerinte pe loturi), dovezi improbabile, termene nerealiste. Fii dur, concret si CONCIS (detaliu de max 2 fraze). Raspunzi STRICT JSON: {"probleme":[{"gravitate":"descalificare"|"risc"|"minor","titlu":string,"detaliu":string,"cerinta_id":number|null}],"categorii_lipsa":[string],"observatie_generala":string}. Maxim 15 probleme, cele mai grave primele.',
    meta + '\n\nREGISTRUL DE CERINTE (confirmata = validata de om; acoperita = are dovada legata):\n' + JSON.stringify(compact),
    12000)

  // --- Trecerea C: ARBITRUL (fable-5-1) ---
  const c1 = await claude('claude-fable-5-1',
    'Esti ARBITRUL FINAL al unei oferte la o licitatie publica romaneasca, ultimul filtru inainte de depunere; orice greseala scapata costa descalificarea. Primesti: (A) raportul determinist al platformei si (B) raportul evaluatorului adversarial. Cantareste-le critic - B poate exagera, A poate fi incomplet. ATENTIE: ambele rapoarte se uita DOAR la registrul de cerinte deja extras, NU la documentatia originala; nu poti deci exclude ca o obligatie sa fi fost omisa la extragere, iar verdictul tau trebuie sa spuna asta cand conteaza. Verdictul tau: "rosu" = NU se depune (exista cel putin o problema care descalifica sau un risc major neacoperit), "galben" = se poate depune DOAR dupa rezolvarea punctelor enumerate, "verde" = nimic in neregula in ce s-a extras. Fii concret, asumat si CONCIS. Raspunzi STRICT JSON, fara alt text: {"verdict":"verde"|"galben"|"rosu","motivare":string,"probleme_critice":[{"titlu":string,"actiune":string}],"puncte_de_verificat_de_om":[string]}. Maxim 8 probleme critice, maxim 5 puncte de om.',
    meta + '\n\n(A) RAPORT PLATFORMA:\n' + JSON.stringify(trecereaA) + '\n\n(B) RAPORT ADVERSARIAL' + (b1.eroare ? ' (EROARE: ' + b1.eroare + ' - judeca doar pe A)' : '') + ':\n' + JSON.stringify(b1.date || {}),
    8000,
    { output_config: { effort: 'medium' }, fallbacks: 'default' },
    { 'anthropic-beta': 'server-side-fallback-2026-07-01' })

  const raport = {
    trecerea_a: trecereaA,
    trecerea_b: b1.date || { eroare: b1.eroare, brut: (b1 as { brut?: string }).brut },
    arbitru: c1.date || { eroare: c1.eroare, brut: (c1 as { brut?: string }).brut },
    // scris in raport, ca sa nu se citeasca "verde" ca "am verificat documentatia"
    acoperire_verificare: 'Trecerile B si C s-au uitat DOAR la registrul de cerinte extras, nu la documentatia originala.',
  }
  const verdict = (c1.date as { verdict?: string } | undefined)?.verdict
  const { data: rand, error: eIns } = await sb.from('ofertare_verificari').insert({
    licitatie_id: licId, verdict: ['verde','galben','rosu'].includes(verdict || '') ? verdict : null,
    raport, modele: 'A:determinist B:claude-sonnet-5 C:claude-fable-5-1', rulat_de: userId,
  }).select('id').single()
  if (eIns) return json({ ok: false, error: eIns.message, raport })
  return json({ ok: true, verificare_id: rand.id, verdict: verdict || null, raport })
})
