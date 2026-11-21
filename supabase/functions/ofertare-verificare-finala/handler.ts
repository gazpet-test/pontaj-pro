// ofertare-verificare-finala - Poarta 4 anti-descalificare (03.09.2026, aprobat Razvan):
// 3 treceri pe o licitatie inainte de depunere:
//   A. constructor (determinist, din registru): cerinte neconfirmate/neacoperite, dovezi rosii, formalitati
//   B. adversarial (claude-sonnet-5-5; Sonnet 5 până la 17.10.2026): citeste independent registrul si cauta ce lipseste/descalifica
//   C. ARBITRU (claude-fable-5-1, cerut explicit de Razvan): primeste A+B si da verdictul final verde/galben/rosu
// Rezultatul se scrie in ofertare_verificari.
//
// TKT-2026-0390 (decizia Răzvan 21.11.2026): verificarea pe ROL, pe server. Înainte, singura oprire era o parolă fixă scrisă în
// codul din browser (oricine o putea citi), iar funcția (verify_jwt=false) accepta orice cont logat. Acum, ca la generarea de
// capitole și extragerea F3 („poarta pe cheltuială”, 20261124a): doar ownerul sau un responsabil 1 / 2 al licitației numit de owner /
// un admin Ofertare (fn_ofertare_poate_cheltui, prin _shared/poartaCheltuiala.ts — aceeași funcție ca restul Ofertării, nimic nou).
// Ordinea: identitate (Auth, din JWT-ul utilizatorului) → licitatie_id → poarta → abia apoi orice citire în BD sau apel AI.
// Cheia anon și cheia de serviciu NU sunt persoane: refuzate (lecția PR #318: verify_jwt nu ajunge, cheia anon e un JWT valid).
// Calea x-radar-secret (cron/Claude) e SCOASĂ, ca în #908 r4: niciun apelant în repo, iar un secret tehnic nu ține loc de
// dreptul de cheltuială al unei persoane. rulat_de = utilizatorul verificat de Auth (nu un parametru din cerere).
//
// ADUSA IN REPO la 11.09.2026. Rula in productie NEVERSIONATA; secretul vechi e verificat de atunci prin Vault (task #51).
//
// LIMITA CUNOSCUTA (semnalata de ChatGPT la 11.09.2026, confirmata): trecerea B primeste
// DOAR registrul de cerinte deja extras, cu textul taiat la 220 de caractere — nu si
// documentatia originala. Poate gasi incoerente in registru, dar NU poate demonstra ca o
// obligatie omisa la extragere nu exista in documente. Verdictul "verde" inseamna deci
// "nimic in neregula in CE AM EXTRAS", nu "depunere sigura". De corectat separat.
import { termenRO } from '../_shared/oraRO.ts'
import { eligibilitateLicitatie, esteEligibil, filtreazaDerivate, mesajLot } from '../_shared/eligibilLot.ts'   // loturi (20261024b)
import { poateCheltui } from '../_shared/poartaCheltuiala.ts'   // poarta unică pe cheltuială (20261124a)

export const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

export const MESAJ_VERIFICARE_ROL = 'Verificarea finală costă (mai multe modele AI, câteva minute) — o pornește doar ownerul sau un responsabil al licitației numit de owner / un admin Ofertare.'

export type Deps = {
  db: any                                              // client service_role (citiri + scrierea verdictului), DUPĂ poartă
  getUser: (jwt: string) => Promise<string | null>     // Auth: uid-ul din JWT-ul utilizatorului, null = token invalid
  fetch: typeof fetch                                  // apelurile Anthropic (simulate în teste)
  chei: { anthropic: string; anon: string; service: string }
}

export function depsReale(createClient: (url: string, key: string, o?: any) => any): Deps {
  const URL_SUPA = Deno.env.get('SUPABASE_URL')!
  const ANON = Deno.env.get('SUPABASE_ANON_KEY') || ''
  return {
    db: createClient(URL_SUPA, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
    getUser: async (jwt) => {
      const uc = createClient(URL_SUPA, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } })
      const { data: u, error } = await uc.auth.getUser(jwt)
      return error ? null : (u?.user?.id || null)
    },
    fetch,
    chei: { anthropic: Deno.env.get('ANTHROPIC_API_KEY') || '', anon: ANON, service: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '' },
  }
}

// rolul pretins în payload-ul JWT (fără verificarea semnăturii — doar ca să refuzăm devreme cheile anon / de serviciu; persoana o
// confirmă Auth prin getUser)
const rolJwt = (jwt: string) => {
  try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch (_) { return null }
}

async function claude(deps: Deps, model: string, system: string, user: string, maxTok: number, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const resp = await deps.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': deps.chei.anthropic, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', ...headers },
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

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const sb = deps.db

  // 1. identitate: doar un utilizator verificat de Auth (TKT-0390). Fără token / cheia anon / cheia de serviciu / token invalid = 401.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer(\s+|$)/i, '').trim()
  if (!jwt) return json({ ok: false, error: 'neautentificat' }, 401)
  const rol = rolJwt(jwt)
  if (jwt === deps.chei.anon || rol === 'anon') return json({ ok: false, error: 'apel neautorizat (cheie anon)' }, 401)
  if (jwt === deps.chei.service || rol === 'service_role') return json({ ok: false, error: 'apel neautorizat (cheie de serviciu)' }, 401)
  let userId: string | null = null
  try { userId = await deps.getUser(jwt) } catch (_) { userId = null }
  if (!userId) return json({ ok: false, error: 'sesiune invalidă' }, 401)

  let body: { licitatie_id?: number } = {}
  try { body = await req.json() } catch { /* gol */ }
  const licId = Number(body?.licitatie_id)
  if (!Number.isSafeInteger(licId) || licId <= 0) return json({ ok: false, error: 'licitatie_id lipsa' }, 400)

  // 2. poarta pe ROL (owner / responsabil 1-2 cu dovada de numire), ÎNAINTEA oricărei citiri și a oricărui apel plătit.
  // Fail-closed: eroare / răspuns ne-boolean = refuz. Același răspuns pentru licitație inexistentă și inaccesibilă.
  if (!await poateCheltui(sb, licId, userId)) return json({ ok: false, error: MESAJ_VERIFICARE_ROL }, 403)

  const { data: lic } = await sb.from('ofertare_licitatii').select('*').eq('id', licId).maybeSingle()
  if (!lic) return json({ ok: false, error: 'licitatie inexistenta' }, 404)

  // --- Trecerea A: constructor (determinist) ---
  const { data: cerinte } = await sb.from('ofertare_cerinte')
    .select('id, tip, lot, text_cerinta, document_probant, cand_se_prezinta, confirmata_de, sursa_document_id, surse_document_ids, lot_domeniu, lot_nr, ofertare_acoperire(id, mod, status, doc_firma_id)')
    .eq('licitatie_id', licId).is('inlocuita_de', null)
  // Poarta pe loturi (20261024b, review Jakarinos P1 #6) — ÎNAINTE de trecerile B și C (plătite): doar cerințele din
  // documente eligibile ACUM și de pe loturi la care participăm intră în verificare. Fără participare / poarta picată = stop.
  // Excluderile NU dispar: intră în raportul A (număr + motive), iar cele NECLARE (lot necunoscut, document netriat /
  // neverificabil — nu „în afara loturilor") nu lasă verdictul verde (retrogradat la galben, determinist, ca la formulare).
  const fl = await filtreazaDerivate(sb, licId, cerinte || [])
  if (!fl.ok) return json({ ok: false, error: mesajLot(fl.motiv), motiv_lot: fl.motiv })
  const motiveExcluse = fl.excluse.reduce((a: Record<string, number>, e: any) => { a[e.motiv] = (a[e.motiv] || 0) + 1; return a }, {})
  if ((cerinte || []).length && !fl.pastrate.length)
    return json({ ok: false, error: `nicio cerință eligibilă pe loturi (${fl.excluse.length} excluse) — nu s-a chemat AI-ul`, excluse_lot: fl.excluse.length, excluse_motive: motiveExcluse })
  const neclare = fl.excluse.filter((e: any) => e.motiv !== 'lot_in_afara' && e.motiv !== 'document_in_afara_loturilor')
  const toate: any[] = fl.pastrate
  const neconfirmate = toate.filter((c: any) => !c.confirmata_de)
  const neacoperite = toate.filter((c: any) => !(c.ofertare_acoperire || []).some((a: { status: string }) => a.status === 'acoperit' || a.status === 'acoperit_partener'))
  const docIds = [...new Set(toate.flatMap((c: any) => (c.ofertare_acoperire || []).map((a: { doc_firma_id: number | null }) => a.doc_firma_id)).filter(Boolean))]
  let doveziRosii: { denumire: string; stare: string; observatii: string | null }[] = []
  if (docIds.length) {
    const { data: dv } = await sb.from('v_dovezi_stare').select('id, denumire, stare, observatii').in('id', docIds).eq('stare', 'rosie')
    doveziRosii = dv || []
  }
  // E3 (25.09.2026): formularele aplicabile din registru care NU sunt semnate SAU nu sunt în pachet = BLOCANTE.
  const { data: formulareBD } = await sb.from('ofertare_formulare_registru')
    .select('cod, denumire, stare_pregatire, stare_depunere, document_sursa_id').eq('licitatie_id', licId).eq('aplicabil', true)
  // loturi (review Jakarinos r2 P1 #5): formularul extras dintr-un document blocat acum nu intră în A/C și nu retrogradează
  // verdictul; „în afara loturilor” = exclus cert, orice alt motiv = neclar (ține verdele la galben, ca la cerințe)
  const fF = await eligibilitateLicitatie(sb, licId)
  if (!fF.ok) return json({ ok: false, error: mesajLot('eroare_poarta'), motiv_lot: 'eroare_poarta' })
  const motivForm = (f: any) => f.document_sursa_id == null || esteEligibil(fF.harta, f.document_sursa_id) ? null : (fF.harta.get(Number(f.document_sursa_id))?.motiv || 'neeligibil')
  const formulare = (formulareBD || []).filter((f: any) => !motivForm(f))
  const formulareExcluse = (formulareBD || []).filter((f: any) => motivForm(f))
  const formulareNeclare = formulareExcluse.filter((f: any) => motivForm(f) !== 'in_afara_loturilor')
  const formulareBlocante = formulare.filter((f: any) => f.stare_pregatire !== 'semnat' || f.stare_depunere === 'nu')
  const termen = lic.termen_depunere ? new Date(lic.termen_depunere) : null
  const zileRamase = termen ? Math.floor((termen.getTime() - Date.now()) / 86400000) : null
  const trecereaA = {
    cerinte_total: toate.length, neconfirmate: neconfirmate.length, neacoperite: neacoperite.length,
    dovezi_rosii: doveziRosii, zile_pana_la_termen: zileRamase,
    garantie_participare: lic.garantie_participare || null, decizie_go: lic.decizie_go ?? null,
    formulare_registru: (formulare || []).length,
    formulare_blocante: formulareBlocante.map((f: any) => `${f.cod ? f.cod + ' — ' : ''}${f.denumire} (${f.stare_pregatire} / ${f.stare_depunere})`),
    exemple_neacoperite: neacoperite.slice(0, 10).map((c: any) => String(c.text_cerinta || '').slice(0, 160)),
    // fără textul lor (nu pleacă la AI), doar câte și de ce: „în afara loturilor” e normal, restul e de triat de om
    cerinte_excluse_pe_loturi: fl.excluse.length, motive_excludere: motiveExcluse, excluse_neclare_de_triat: neclare.length,
    formulare_excluse_pe_loturi: formulareExcluse.length, formulare_excluse_neclare: formulareNeclare.length,
  }

  const compact = toate.map((c: any) => ({
    id: c.id, tip: c.tip, lot: c.lot,
    text: String(c.text_cerinta || '').slice(0, 220),
    probant: c.document_probant, cand: c.cand_se_prezinta,
    confirmata: !!c.confirmata_de,
    acoperita: (c.ofertare_acoperire || []).some((a: { status: string }) => a.status === 'acoperit' || a.status === 'acoperit_partener'),
  }))
  const meta = `LICITATIE: ${lic.nr_anunt || licId} - ${lic.obiect || ''}\nAutoritate: ${lic.autoritate || '?'} | Valoare estimata: ${lic.valoare_estimata || '?'} ${lic.moneda || 'RON'} | Termen depunere: ${termenRO(lic.termen_depunere) || '?'} (${zileRamase ?? '?'} zile) | Criteriu: ${lic.criteriu || '?'} | Garantie participare: ${lic.garantie_participare || 'NEDEFINITA'} | Loturi: ${lic.loturi || '?'} | Rol Gazpet: ${lic.rol_gazpet || '?'}`

  // --- Trecerea B: adversarial (sonnet-5-5) ---
  const b1 = await claude(deps, 'claude-sonnet-5-5',
    'Esti un evaluator ADVERSARIAL de oferte la licitatii publice romanesti (Legea 98/99/2016). Primesti registrul de cerinte al unei licitatii asa cum l-a construit echipa de ofertare. Misiunea ta: gaseste TOT ce poate duce la DESCALIFICARE - cerinte probabil ratate sau interpretate gresit, categorii de cerinte care lipsesc cu totul din registru (garantie de participare, DUAE, formulare semnate, valabilitate oferta, vizita amplasament, clarificari obligatorii, subcontractanti/terti declarati, cerinte pe loturi), dovezi improbabile, termene nerealiste. Fii dur, concret si CONCIS (detaliu de max 2 fraze). Raspunzi STRICT JSON: {"probleme":[{"gravitate":"descalificare"|"risc"|"minor","titlu":string,"detaliu":string,"cerinta_id":number|null}],"categorii_lipsa":[string],"observatie_generala":string}. Maxim 15 probleme, cele mai grave primele.',
    meta + '\n\nREGISTRUL DE CERINTE (confirmata = validata de om; acoperita = are dovada legata):\n' + JSON.stringify(compact),
    12000)

  // --- Trecerea C: ARBITRUL (fable-5-1) ---
  const c1 = await claude(deps, 'claude-fable-5-1',
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
  let verdict = (c1.date as { verdict?: string } | undefined)?.verdict
  // E3: formularele aplicabile nesemnate / în afara pachetului BLOCHEAZĂ verdele, determinist (nu depinde de arbitru)
  if (verdict === 'verde' && formulareBlocante.length) {
    verdict = 'galben'
    ;(raport as any).blocaj_formulare = `Verde retrogradat la galben: ${formulareBlocante.length} formulare aplicabile nesemnate sau nepuse în pachet.`
  }
  // loturi: cerințele excluse pe motiv NECLAR n-au fost verificate deloc — verdele nu le poate acoperi
  if (verdict === 'verde' && (neclare.length || formulareNeclare.length)) {
    verdict = 'galben'
    ;(raport as any).blocaj_loturi = `Verde retrogradat la galben: ${neclare.length} cerințe și ${formulareNeclare.length} formulare excluse din verificare pe loturi cu motiv neclar (${JSON.stringify(motiveExcluse)}) — triază documentele / lotul cerințelor și reia verificarea.`
  }
  const { data: rand, error: eIns } = await sb.from('ofertare_verificari').insert({
    licitatie_id: licId, verdict: ['verde','galben','rosu'].includes(verdict || '') ? verdict : null,
    raport, modele: 'A:determinist B:claude-sonnet-5-5 C:claude-fable-5-1', rulat_de: userId,
  }).select('id').single()
  if (eIns) return json({ ok: false, error: eIns.message, raport })
  return json({ ok: true, verificare_id: rand.id, verdict: verdict || null, raport })
}
