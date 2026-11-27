// deno test -A --node-modules-dir=none supabase/functions/ofertare-clarificare-citeste/poarta_test.ts
// Decizia Răzvan 27.11.2026 (după review-ul PR #1204): citirea AI a PDF-ului unei clarificări (plătită, scrie clarificarea) pornește doar
// pentru owner / responsabil 1-2 numit de owner sau admin Ofertare, verificat PE SERVER pe utilizatorul din JWT, ÎNAINTEA oricărei citiri cu
// service_role și a oricărui apel AI. Handler-ul REAL, cu clienții Supabase (service_role + al utilizatorului), Storage și Anthropic simulate
// (fără rețea, fără secrete). Scenariile sunt o listă de verificări care întoarce abaterile, ca aceeași listă să ruleze și pe MUTANȚI ai sursei
// (poarta scoasă, poarta după citirea service_role, identitatea din cerere, licitația citită cu service_role…): fiecare mutant trebuie prins
// de un scenariu PRIN RĂSPUNS (un mutant care aruncă excepție nu e dovadă — review Jakarinos r1 P2 #1).
// Valorile așteptate (mesaje, model, răspunsuri) sunt scrise AICI, din regula 20261124a (owner; responsabil cu dovada de numire; autoatribuit = nu)
// și din decizia de mai sus, nu importate din handler (r1 P2 #3). Cronologia operațiilor se înregistrează într-o listă comună (r1 P2 #2).
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { cerereH, fakeSupa, JWT_FALS_SERVICE, OWNER, RESP, RESP_ALTA, STRAIN } from '../_test/fake_supa.ts'
import { handler } from './handler.ts'

// contractul așteptat de UI (OfertareClarificari.jsx) și de operator — scris independent de handler
const MODEL_ASTEPTAT = 'claude-haiku-4-5-20251001'
const MSG_ROL = 'Citirea PDF-ului cu AI costă — o pornește doar ownerul sau un responsabil al licitației numit de owner / un admin Ofertare.'
const MSG_INACCESIBILA = 'Clarificarea nu există sau nu ai acces la ea.'
const MSG_ESUATA = 'Verificarea clarificării a eșuat; reîncearcă.'

const RESP2 = 'u-resp2-95', AUTO = 'u-autonumit', FARA_MODUL = 'u-resp97-fara-modul'
const PROFILE = [OWNER, RESP, RESP2, STRAIN, RESP_ALTA, AUTO, FARA_MODUL].map((id) => ({ id, is_owner: id === OWNER }))
const LICITATII = [
  // 95: responsabil 1 = numire veche (fără „numit de”, regula A), responsabil 2 numit de owner (dovada true)
  { id: 95, nr_anunt: 'CN-TEST', obiect: 'test', stare_loturi: 'fara_loturi', responsabil_id: RESP,
    responsabil2_id: RESP2, responsabil2_setat_de: OWNER, responsabil2_numitor_autorizat: true },
  { id: 96, stare_loturi: 'fara_loturi', responsabil_id: RESP_ALTA },
  // 97: responsabil (regula A) care NU are acces la modulul Ofertare → RLS nu-i arată clarificarea
  { id: 97, stare_loturi: 'fara_loturi', responsabil_id: FARA_MODUL },
  // 98: s-a numit singur (dovada false) — nu trece
  { id: 98, stare_loturi: 'fara_loturi', responsabil_id: AUTO, responsabil_setat_de: AUTO, responsabil_numitor_autorizat: false },
]
const PLACEHOLDER = '(clarificare depusă extern — a.pdf; completează aici pe scurt ce s-a întrebat)'
const CLARIFICARI = [
  { id: 1, licitatie_id: 95, nr: 1, fisier_path: '95/clarificari/a.pdf', intrebare: PLACEHOLDER, origine: 'manual', sursa: 'extern', citita_la: null },
  { id: 2, licitatie_id: 95, nr: 2, fisier_path: null, intrebare: 'scrisă de mână', origine: 'manual', sursa: null },
  { id: 3, licitatie_id: 98, nr: 1, fisier_path: '98/clarificari/c.pdf', intrebare: PLACEHOLDER, origine: 'manual', sursa: 'extern' },
  { id: 4, licitatie_id: 97, nr: 1, fisier_path: '97/clarificari/d.pdf', intrebare: PLACEHOLDER, origine: 'manual', sursa: 'extern' },
]
// JWT-uri care NU coincid cu uid-ul (Auth le traduce): RPC-ul trebuie să primească UID-ul, clientul RLS exact JWT-ul (r1 P2 #3)
const TOKENI: Record<string, string> = { 'tok-owner-7f3a': OWNER, 'tok-resp-9c1d': RESP, 'tok-strain-2b4e': STRAIN }
const uidDin = (jwt: string) => TOKENI[jwt] ?? jwt
// cine vede clarificările prin RLS (20270113a: owner sau modulul 'ofertare'); simulat în clientul utilizatorului, nu în handler
const CU_MODUL = new Set([RESP, RESP2, STRAIN, RESP_ALTA, AUTO])
const vede = (uid: string) => uid === OWNER || CU_MODUL.has(uid)
const PDF = new TextEncoder().encode('%PDF-1.4 proba')
const CHEI = { anthropic: 'k-anthropic', anon: 'cheie-anon-fara-puncte', service: 'cheie-service-fara-puncte' }
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const JWT_ANON = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'anon', iss: 'supabase' })}.semnatura`
const RASPUNS_AI = { intrebare: 'Solicităm clarificarea cantității de la poziția 12 din F3.', rezumat: 'Se cere clarificarea cantității.', nr_intrebari: 2, referinte: ['F3', 'Anexa 1'], data_document: '2026-11-20' }
const corpAi = (j: unknown, stop = 'end_turn') => ({ stop_reason: stop, usage: { input_tokens: 1000, output_tokens: 100 }, content: [{ type: 'text', text: JSON.stringify(j) }] })
const MARKER_INTERN = 'INTERN-7f3a-connection string'

type Rez = { status: number; corp: any; n: any; nu: any; getUser: number; ai: string[]; ev: string[] }
type Hnd = (req: Request, deps: any) => Promise<Response>
type Opt = {
  eroareCheltuiala?: boolean; rpcRaspuns?: unknown           // poarta: RPC-ul cade / întoarce altceva decât true
  ai?: { corp?: unknown; status?: number }; pdfLipsa?: boolean
  eroareUtilizator?: boolean; exceptieUtilizator?: boolean   // clientul utilizatorului: eroare PostgREST / excepție
  eroareService?: boolean                                    // recitirea cu service_role cade
  serviceMutat?: boolean                                     // service_role vede clarificarea 1 pe ALTĂ licitație (96) decât utilizatorul (95)
}

async function ruleaza(h: Hnd, headers: Record<string, string>, body: unknown, opt: Opt = {}): Promise<Rez> {
  const ev: string[] = []   // cronologia comună: utilizator:<tabel> | rpc:<fn>:<p_uid> | service:<tabel> | storage | ai
  // clientul service_role: toate rândurile; Storage întoarce PDF-ul pentru căile cunoscute
  const clarService = opt.serviceMutat ? CLARIFICARI.map((c) => c.id === 1 ? { ...c, licitatie_id: 96 } : c) : CLARIFICARI
  const { supa, n } = fakeSupa({ profiles: PROFILE, ofertare_licitatii: LICITATII, ofertare_clarificari: clarService, ofertare_documente_atribuire: [], ai_usage_log: [] },
    { radarSecret: 'rs-ok', eroareCheltuiala: opt.eroareCheltuiala })
  const cai = new Set(CLARIFICARI.map((c) => c.fisier_path).filter(Boolean))
  const fromService = supa.from, rpcService = supa.rpc
  ;(supa as any).from = (t: string) => {
    ev.push('service:' + t)
    if (opt.eroareService && t === 'ofertare_clarificari') return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: MARKER_INTERN } }) }) }) }
    return fromService(t)
  }
  ;(supa as any).rpc = (nume: string, args?: any) => {
    if (nume === 'fn_ofertare_poate_cheltui') { ev.push(`rpc:${nume}:${args?.p_uid}`); if ('rpcRaspuns' in opt) { n.rpcCheltuiala++; return Promise.resolve({ data: opt.rpcRaspuns, error: null }) } }
    return rpcService(nume, args)
  }
  ;(supa as any).storage = { from: () => ({ download: (p: string) => { n.storage++; ev.push('storage'); return Promise.resolve(!opt.pdfLipsa && cai.has(p) ? { data: new Blob([PDF]), error: null } : { data: null, error: { message: 'Object not found' } }) } }) }
  // clientul utilizatorului: RLS simulată (vede tot sau nimic), cu propriul contor de citiri; primește JWT-ul brut
  const nu = { citiri: 0, jwt: [] as string[] }
  const caUtilizator = (jwt: string) => {
    nu.jwt.push(jwt)
    const { supa: s } = fakeSupa({ ofertare_clarificari: vede(uidDin(jwt)) ? CLARIFICARI : [] })
    return { from: (t: string) => {
      nu.citiri++; ev.push('utilizator:' + t)
      if (opt.exceptieUtilizator) throw new Error(MARKER_INTERN)
      if (opt.eroareUtilizator) return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: MARKER_INTERN } }) }) }) }
      return s.from(t)
    } }
  }
  let getUser = 0
  const ai: string[] = []
  const deps = {
    db: supa, chei: CHEI, caUtilizator,
    // Auth simulat: tokenii cunoscuți → uid-ul lor; altfel token = uid; 'invalid' / orice token cu puncte (JWT nesemnat de noi) = respins
    getUser: (jwt: string) => { getUser++; return Promise.resolve(jwt === 'invalid' || jwt.includes('.') ? null : uidDin(jwt)) },
    fetch: ((_u: unknown, i?: RequestInit) => {
      n.ai++; ev.push('ai')
      ai.push(JSON.parse(String(i?.body || '{}')).model)
      return Promise.resolve(new Response(JSON.stringify(opt.ai?.corp ?? corpAi(RASPUNS_AI)), { status: opt.ai?.status ?? 200 }))
    }) as typeof fetch,
  }
  const r = await h(cerereH(headers, body), deps)
  const t = await r.text()
  let corp: any = t
  try { corp = JSON.parse(t) } catch (_) { /* text */ }
  return { status: r.status, corp, n, nu, getUser, ai, ev }
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })

// lista de verificări: [nume, verificare] — verificarea întoarce null (ok) sau textul abaterii
type Scenariu = [string, (h: Hnd) => Promise<string | null>]
// zero cost = niciun apel AI, nicio scriere, nicio citire / descărcare cu service_role (clientul utilizatorului poate citi licitația)
const zeroCost = (r: Rez) => r.n.ai === 0 && r.n.scrieri === 0 && !r.ev.some((e) => e.startsWith('service:')) && r.n.storage === 0 && r.n.inserate.length === 0 && r.n.actualizate.length === 0
// refuz „după poartă”: fără Storage / AI / scrieri (citirea service_role a rândului e permisă)
const faraCost = (r: Rez) => r.n.ai === 0 && r.n.scrieri === 0 && r.n.storage === 0 && r.n.inserate.length === 0 && r.n.actualizate.length === 0
const refuzat = (r: Rez, status: number, mesaj?: string) => r.status === status && typeof r.corp?.error === 'string' && (mesaj === undefined || r.corp.error === mesaj) && zeroCost(r)
const descrie = (r: Rez) => `status ${r.status}, ai ${r.n.ai}, scrieri ${r.n.scrieri}, storage ${r.n.storage}, citiri utilizator ${r.nu.citiri}, ev [${r.ev}], corp ${JSON.stringify(r.corp).slice(0, 160)}`
const updateClar = (r: Rez) => r.n.actualizate.filter((x: any) => x.tabel === 'ofertare_clarificari').map((x: any) => x.patch)
const REZUMAT_ASTEPTAT = 'Se cere clarificarea cantității. Conține 2 întrebări. Referințe: F3, Anexa 1.'
const CRONOLOGIE_TRECERE = ['utilizator:ofertare_clarificari', 'rpc:fn_ofertare_poate_cheltui:%UID%', 'service:ofertare_clarificari', 'service:ofertare_documente_atribuire', 'storage', 'ai', 'service:ai_usage_log', 'service:ofertare_clarificari']
// trecut = cronologia exactă (licitația ca utilizator → poarta cu UID-ul → service_role → PDF → AI → jurnal → update), un apel Haiku, update-ul
// cu rezumatul compus și întrebarea (placeholder înlocuit), sursa; origine neatinsă (era deja 'manual')
const trecut = (r: Rez, id: number, uid: string) => {
  const u = updateClar(r)
  const jurnal = r.n.inserate.filter((x: any) => x.tabel === 'ai_usage_log').flatMap((x: any) => x.rows)
  return r.status === 200 && r.corp?.ok === true && r.corp?.id === id && r.n.ai === 1 && r.ai.join(',') === MODEL_ASTEPTAT && r.n.storage === 1
    && JSON.stringify(r.ev) === JSON.stringify(CRONOLOGIE_TRECERE.map((e) => e.replace('%UID%', uid)))
    && u.length === 1 && u[0].citita_rezumat === REZUMAT_ASTEPTAT && typeof u[0].citita_la === 'string' && u[0].intrebare === RASPUNS_AI.intrebare
    && u[0].sursa === 'extern — PDF depus în SEAP (2026-11-20)' && !('origine' in u[0])
    && jurnal.length === 1 && jurnal[0].ref_id === id && jurnal[0].model === MODEL_ASTEPTAT && r.corp?.rezumat === REZUMAT_ASTEPTAT
}

export const SCENARII: Scenariu[] = [
  ['cont cu acces Ofertare dar fără rol pe licitație -> 403 (mesajul porții), zero service_role / AI / scrieri; cronologia = utilizator → RPC', async (h) => {
    const r = await ruleaza(h, bearer(STRAIN), { clarificare_id: 1 })
    return refuzat(r, 403, MSG_ROL) && JSON.stringify(r.ev) === JSON.stringify(['utilizator:ofertare_clarificari', `rpc:fn_ofertare_poate_cheltui:${STRAIN}`]) ? null : descrie(r)
  }],
  ['responsabil pe ALTĂ licitație -> 403, zero cost', async (h) => {
    const r = await ruleaza(h, bearer(RESP_ALTA), { clarificare_id: 1 }); return refuzat(r, 403, MSG_ROL) ? null : descrie(r)
  }],
  ['responsabil autonumit (dovada false) -> 403, zero cost', async (h) => {
    const r = await ruleaza(h, bearer(AUTO), { clarificare_id: 3 }); return refuzat(r, 403, MSG_ROL) ? null : descrie(r)
  }],
  ['licitația clarificării se citește CA UTILIZATORUL: responsabil fără acces la clarificare (RLS) -> 403 „inaccesibilă”, poarta nici nu e întrebată', async (h) => {
    const r = await ruleaza(h, bearer(FARA_MODUL), { clarificare_id: 4 })
    return refuzat(r, 403, MSG_INACCESIBILA) && JSON.stringify(r.ev) === JSON.stringify(['utilizator:ofertare_clarificari']) && r.nu.jwt[0] === FARA_MODUL ? null : descrie(r)
  }],
  ['clarificare inexistentă vs invizibilă -> răspuns identic (nu dezvăluie existența)', async (h) => {
    const a = await ruleaza(h, bearer(FARA_MODUL), { clarificare_id: 4 }), b = await ruleaza(h, bearer(FARA_MODUL), { clarificare_id: 999999 })
    return a.status === b.status && JSON.stringify(a.corp) === JSON.stringify(b.corp) && zeroCost(a) && zeroCost(b) ? null : descrie(a) + ' | ' + descrie(b)
  }],
  ['clarificare inexistentă pentru owner -> 403 „inaccesibilă”, zero cost', async (h) => {
    const r = await ruleaza(h, bearer(OWNER), { clarificare_id: 999999 }); return refuzat(r, 403, MSG_INACCESIBILA) ? null : descrie(r)
  }],
  ['citirea ca utilizator CADE (eroare PostgREST sau excepție) -> 500 cu mesaj public stabil, fără markerul intern, zero cost', async (h) => {
    for (const opt of [{ eroareUtilizator: true }, { exceptieUtilizator: true }] as Opt[]) {
      const r = await ruleaza(h, bearer(OWNER), { clarificare_id: 1 }, opt)
      if (!(refuzat(r, 500, MSG_ESUATA) && !JSON.stringify(r.corp).includes('INTERN'))) return JSON.stringify(opt) + ': ' + descrie(r)
    }
    return null
  }],
  ['recitirea cu service_role CADE -> 500 cu mesaj public stabil (nu 404), fără Storage / AI / scrieri', async (h) => {
    const r = await ruleaza(h, bearer(OWNER), { clarificare_id: 1 }, { eroareService: true })
    return r.status === 500 && r.corp?.error === MSG_ESUATA && faraCost(r) && !JSON.stringify(r.corp).includes('INTERN') ? null : descrie(r)
  }],
  ['service_role vede clarificarea pe ALTĂ licitație decât cea pe care s-a dat poarta -> 403, fără Storage / AI / scrieri', async (h) => {
    const r = await ruleaza(h, bearer(RESP), { clarificare_id: 1 }, { serviceMutat: true })
    return r.status === 403 && r.corp?.error === MSG_INACCESIBILA && faraCost(r) && r.ev.filter((e) => e.startsWith('service:')).length === 1 ? null : descrie(r)
  }],
  ['poarta căzută (RPC eroare) -> 403 chiar și pentru owner (fail-closed)', async (h) => {
    const r = await ruleaza(h, bearer(OWNER), { clarificare_id: 1 }, { eroareCheltuiala: true }); return refuzat(r, 403, MSG_ROL) ? null : descrie(r)
  }],
  ['poarta întoarce altceva decât true ("true", null, 1) -> 403, zero cost', async (h) => {
    for (const v of ['true', null, 1]) {
      const r = await ruleaza(h, bearer(OWNER), { clarificare_id: 1 }, { rpcRaspuns: v }); if (!refuzat(r, 403, MSG_ROL)) return JSON.stringify(v) + ': ' + descrie(r)
    }
    return null
  }],
  ['identitatea vine din token, nu din cerere: cont fără rol care trimite uid-ul ownerului -> 403', async (h) => {
    const r = await ruleaza(h, bearer(STRAIN), { clarificare_id: 1, p_uid: OWNER, user_id: OWNER, uid: OWNER })
    return refuzat(r, 403, MSG_ROL) ? null : descrie(r)
  }],
  ['JWT diferit de uid: RPC-ul primește UID-ul din Auth, clientul RLS primește exact JWT-ul (responsabil trece; cont fără rol 403)', async (h) => {
    const a = await ruleaza(h, bearer('tok-resp-9c1d'), { clarificare_id: 1 })
    if (!(trecut(a, 1, RESP) && JSON.stringify(a.nu.jwt) === JSON.stringify(['tok-resp-9c1d']))) return 'resp: ' + descrie(a)
    const b = await ruleaza(h, bearer('tok-strain-2b4e'), { clarificare_id: 1 })
    return refuzat(b, 403, MSG_ROL) && b.ev[1] === `rpc:fn_ofertare_poate_cheltui:${STRAIN}` && b.nu.jwt[0] === 'tok-strain-2b4e' ? null : 'strain: ' + descrie(b)
  }],
  ['fără Authorization / „Bearer ” gol -> 401, zero cost, Auth nici nu e întrebat', async (h) => {
    for (const hd of [{}, { Authorization: '' }, { Authorization: 'Bearer ' }] as Record<string, string>[]) {
      const r = await ruleaza(h, hd, { clarificare_id: 1 }); if (!refuzat(r, 401) || r.getUser !== 0 || r.nu.citiri !== 0) return JSON.stringify(hd) + ': ' + descrie(r)
    }
    return null
  }],
  ['cheia anon (exact valoarea din env) -> 401 înaintea Auth, zero cost', async (h) => {
    const r = await ruleaza(h, bearer(CHEI.anon), { clarificare_id: 1 }); return refuzat(r, 401) && r.getUser === 0 && r.nu.citiri === 0 ? null : descrie(r) + `, getUser ${r.getUser}`
  }],
  ['JWT cu rol anon -> 401, zero cost', async (h) => {
    const r = await ruleaza(h, bearer(JWT_ANON), { clarificare_id: 1 }); return refuzat(r, 401) ? null : descrie(r)
  }],
  ['cheia de serviciu / JWT fals service_role -> 401 înaintea Auth, zero cost (serviciul nu e persoană)', async (h) => {
    for (const t of [CHEI.service, JWT_FALS_SERVICE]) {
      const r = await ruleaza(h, bearer(t), { clarificare_id: 1 }); if (!refuzat(r, 401) || r.getUser !== 0 || r.nu.citiri !== 0) return t.slice(0, 12) + ': ' + descrie(r)
    }
    return null
  }],
  ['token invalid (respins de Auth) -> 401, zero cost', async (h) => {
    const r = await ruleaza(h, bearer('invalid'), { clarificare_id: 1 }); return refuzat(r, 401) ? null : descrie(r)
  }],
  ['x-radar-secret VALID fără JWT -> 401; secretul nici nu se verifică (cale scoasă)', async (h) => {
    const r = await ruleaza(h, { 'x-radar-secret': 'rs-ok' }, { clarificare_id: 1 })
    return refuzat(r, 401) && r.n.rpcSecret === 0 ? null : descrie(r) + `, rpcSecret ${r.n.rpcSecret}`
  }],
  ['x-radar-secret VALID + cont fără rol -> 403 (secretul nu ține loc de poartă)', async (h) => {
    const r = await ruleaza(h, { 'x-radar-secret': 'rs-ok', ...bearer(STRAIN) }, { clarificare_id: 1 }); return refuzat(r, 403, MSG_ROL) ? null : descrie(r)
  }],
  ['clarificare_id lipsă / invalid -> 400 chiar pentru owner, zero citiri (utilizator și service), zero AI', async (h) => {
    for (const b of [{}, { clarificare_id: 'abc' }, { clarificare_id: 0 }, { clarificare_id: -5 }, { clarificare_id: 1.5 }]) {
      const r = await ruleaza(h, bearer(OWNER), b); if (!refuzat(r, 400) || r.nu.citiri !== 0) return JSON.stringify(b) + ': ' + descrie(r)
    }
    return null
  }],
  ['owner, clarificare fără PDF -> 400 după poartă, zero AI, zero scrieri', async (h) => {
    const r = await ruleaza(h, bearer(OWNER), { clarificare_id: 2 })
    return r.status === 400 && /nu are PDF/.test(r.corp?.error || '') && faraCost(r) ? null : descrie(r)
  }],
  ['owner, PDF-ul nu se descarcă -> {error}, zero AI, zero scrieri', async (h) => {
    const r = await ruleaza(h, bearer(OWNER), { clarificare_id: 1 }, { pdfLipsa: true })
    return r.status === 200 && /^download PDF: /.test(r.corp?.error || '') && r.n.ai === 0 && r.n.scrieri === 0 ? null : descrie(r)
  }],
  ['owner, răspuns AI nevalid (HTTP eșuat / max_tokens / refuz / fără text / rezumat gol) -> {error}, zero scrieri', async (h) => {
    for (const [caz, ai] of [
      ['HTTP 429', { corp: corpAi(RASPUNS_AI), status: 429 }], ['max_tokens', { corp: corpAi(RASPUNS_AI, 'max_tokens') }], ['refuz', { corp: corpAi(RASPUNS_AI, 'refusal') }],
      ['fără text', { corp: { content: [{ type: 'thinking', thinking: '…' }] } }], ['JSON invalid', { corp: { content: [{ type: 'text', text: '{' }] } }],
      ['rezumat gol', { corp: corpAi({ ...RASPUNS_AI, rezumat: '  ' }) }], ['rezumat obiect', { corp: corpAi({ ...RASPUNS_AI, rezumat: { x: 1 } }) }],
    ] as [string, Opt['ai']][]) {
      const r = await ruleaza(h, bearer(OWNER), { clarificare_id: 1 }, { ai })
      if (!(r.status === 200 && typeof r.corp?.error === 'string' && r.n.ai === 1 && r.n.scrieri === 0 && r.n.inserate.length === 0)) return caz + ': ' + descrie(r)
    }
    return null
  }],
  ['owner -> trece: cronologia exactă (utilizator → poarta → service_role → PDF → Haiku → jurnal → update), update-ul și jurnalul', async (h) => {
    const r = await ruleaza(h, bearer(OWNER), { clarificare_id: 1 }); return trecut(r, 1, OWNER) && JSON.stringify(r.nu.jwt) === JSON.stringify([OWNER]) ? null : descrie(r) + ` update ${JSON.stringify(updateClar(r))}`
  }],
  ['responsabil 1 (numire veche, regula A) -> trece', async (h) => {
    const r = await ruleaza(h, bearer(RESP), { clarificare_id: 1 }); return trecut(r, 1, RESP) ? null : descrie(r) + ` update ${JSON.stringify(updateClar(r))}`
  }],
  ['responsabil 2 numit de owner -> trece', async (h) => {
    const r = await ruleaza(h, bearer(RESP2), { clarificare_id: 1 }); return trecut(r, 1, RESP2) ? null : descrie(r) + ` update ${JSON.stringify(updateClar(r))}`
  }],
  ['OPTIONS (CORS) -> 200 fără nimic altceva', async (h) => {
    const { supa, n } = fakeSupa({})
    const r = await h(new Request('http://x/', { method: 'OPTIONS' }), { db: supa, chei: CHEI, caUtilizator: () => supa, getUser: () => Promise.resolve(null), fetch: (() => { n.ai++ }) as any })
    return r.status === 200 && n.ai === 0 && n.citiri.length === 0 ? null : `status ${r.status}`
  }],
]

for (const [nume, f] of SCENARII) {
  Deno.test('clarificare-citeste: ' + nume, async () => { const ab = await f(handler); assertEquals(ab, null) })
}

// --- MUTANȚI: fiecare modificare a sursei care slăbește poarta trebuie să fie prinsă de cel puțin un scenariu PRIN RĂSPUNS (nu prin excepție) ---
// Mutantul se scrie lângă handler.ts (importurile relative rămân valabile) și se șterge imediat după rulare. Toți mutanții sunt executabili.
const SURSA = new URL('./handler.ts', import.meta.url)
const POARTA = "  if (!await poateCheltui(deps.db, licId, uid)) return json({ error: MESAJ_CITIRE_ROL }, 403)\n"
const RAND = "  const { data: row, error: eRow } = await db.from('ofertare_clarificari').select('*').eq('id', id).maybeSingle()\n"
const MUTANTI: [string, string, string][] = [
  ['fără verificare de rol în edge (poarta scoasă)', POARTA, '\n'],
  ['poarta mutată DUPĂ citirea rândului cu service_role',
    POARTA + "  const KEY = deps.chei.anthropic\n  if (!KEY) return json({ error: 'ANTHROPIC_API_KEY lipsă' }, 500)\n\n  // 4. de aici încolo ca înainte, cu service_role: rândul întreg, PDF-ul, AI-ul, jurnalul, update-ul\n  const db = deps.db\n" + RAND,
    "  const KEY = deps.chei.anthropic\n  if (!KEY) return json({ error: 'ANTHROPIC_API_KEY lipsă' }, 500)\n  const db = deps.db\n" + RAND + POARTA],
  ['licitația clarificării citită cu service_role în loc de clientul utilizatorului', "await deps.caUtilizator(jwt).from('ofertare_clarificari')", "await deps.db.from('ofertare_clarificari')"],
  ['identitatea din parametrul cererii (p_uid)', 'poateCheltui(deps.db, licId, uid)', 'poateCheltui(deps.db, licId, (body as any)?.p_uid || uid)'],
  ['poarta pe uid-ul din Auth, dar clientul RLS cu uid-ul în loc de JWT (contract greșit cu PostgREST)', 'deps.caUtilizator(jwt)', 'deps.caUtilizator(uid)'],
  ['fără Auth (orice token = utilizator)', 'try { uid = await deps.getUser(jwt) } catch (_) { uid = null }', 'uid = jwt'],
  ['cheia anon acceptată (refuzul explicit scos)', "  if (jwt === deps.chei.anon || rol === 'anon') return json({ error: 'apel neautorizat (cheie anon)' }, 401)\n", '\n'],
  ['cheia de serviciu acceptată (refuzul explicit scos)', "  if (jwt === deps.chei.service || rol === 'service_role') return json({ error: 'apel neautorizat (cheie de serviciu)' }, 401)\n", '\n'],
  ['poarta fail-open la clarificare_id invalid', '!Number.isSafeInteger(id) || id <= 0', '!id'],
  ['eroarea la citirea ca utilizator tratată ca „nu există”', '    if (error) return json({ error: MESAJ_VERIFICARE_ESUATA }, 500)\n', '\n'],
  ['eroarea la recitirea cu service_role ignorată (devine 404)', "  if (eRow) return json({ error: MESAJ_VERIFICARE_ESUATA }, 500)   // recitirea cade = necunoscut, nu „nu există” (review r1 b)\n", '\n'],
  ['garda „aceeași licitație” la recitire scoasă', '  if (Number(row.licitatie_id) !== licId) return json({ error: MESAJ_CLARIFICARE_INACCESIBILA }, 403)\n', '\n'],
  ['mesajul brut al dependenței în 500', 'if (error) return json({ error: MESAJ_VERIFICARE_ESUATA }, 500)', 'if (error) return json({ error: MESAJ_VERIFICARE_ESUATA + \' \' + String(error.message) }, 500)'],
  ['scrierea fără validarea rezumatului AI', "if (typeof j.rezumat !== 'string' || !j.rezumat.trim()) return json({ error: 'Rezumat AI gol sau invalid; clarificarea rămâne neschimbată.' })\n", '\n'],
]

// rulează toate scenariile pe o copie modificată a sursei; întoarce scenariile care au găsit abateri PRIN RĂSPUNS și, separat, excepțiile
async function prinsDe(i: number | string, din: string, in_: string): Promise<{ prinse: string[]; exceptii: string[] }> {
  const sursa = Deno.readTextFileSync(SURSA).replace(/\r\n/g, '\n')   // checkout-ul de pe Windows poate fi CRLF
  assertEquals(sursa.split(din).length, 2, `mutantul ${i}: textul de înlocuit trebuie să apară EXACT o dată în handler.ts`)
  const fis = new URL(`./.tmp_mutant_${i}_${crypto.randomUUID().slice(0, 8)}.ts`, import.meta.url)
  Deno.writeTextFileSync(fis, sursa.replace(din, in_))
  try {
    const m = await import(fis.href)
    const prinse: string[] = [], exceptii: string[] = []
    for (const [sc, f] of SCENARII) { try { const ab = await f(m.handler); if (ab) prinse.push(sc) } catch (e) { exceptii.push(sc + ': ' + e) } }
    return { prinse, exceptii }
  } finally { Deno.removeSync(fis) }
}

Deno.test('clarificare-citeste MUTANȚI: fiecare mutant e prins de cel puțin un scenariu prin răspuns, niciunul prin excepție', async () => {
  for (const [i, [nume, din, in_]] of MUTANTI.entries()) {
    const { prinse, exceptii } = await prinsDe(i, din, in_)
    assertEquals(exceptii, [], `mutantul „${nume}” a aruncat excepție (nu e dovadă)`)
    assert(prinse.length > 0, `mutantul „${nume}” NU e prins de niciun scenariu`)
  }
})
// martor: o modificare FĂRĂ efect (doar un comentariu) nu trebuie să pice nimic — altfel detecția de mai sus n-ar dovedi nimic
Deno.test('clarificare-citeste MUTANȚI: martorul neutru (comentariu schimbat) trece toate scenariile', async () => {
  assertEquals(await prinsDe('martor', '// 4. de aici încolo ca înainte, cu service_role: rândul întreg, PDF-ul, AI-ul, jurnalul, update-ul', '// 4. (martor)'), { prinse: [], exceptii: [] })
})
