// deno test -A --node-modules-dir=none supabase/functions/ofertare-clarificare-citeste/poarta_test.ts
// Decizia Răzvan 27.11.2026 (după review-ul PR #1204): citirea AI a PDF-ului unei clarificări (plătită, scrie clarificarea) pornește doar
// pentru owner / responsabil 1-2 numit de owner sau admin Ofertare, verificat PE SERVER pe utilizatorul din JWT, ÎNAINTEA oricărei citiri cu
// service_role și a oricărui apel AI. Handler-ul REAL, cu clienții Supabase (service_role + al utilizatorului), Storage și Anthropic simulate
// (fără rețea, fără secrete). Scenariile sunt o listă de verificări care întoarce abaterile, ca aceeași listă să ruleze și pe MUTANȚI ai sursei
// (poarta scoasă, poarta după citirea service_role, identitatea din cerere, licitația citită cu service_role…): fiecare mutant trebuie prins.
// Valorile așteptate vin din regula 20261124a (owner; responsabil cu dovada de numire; autoatribuit = nu) și din decizia de mai sus, nu din handler.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { cerereH, fakeSupa, JWT_FALS_SERVICE, OWNER, RESP, RESP_ALTA, STRAIN } from '../_test/fake_supa.ts'
import { handler, MESAJ_CITIRE_ROL, MESAJ_CLARIFICARE_INACCESIBILA, MODEL } from './handler.ts'

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
// cine vede clarificările prin RLS (20270113a: owner sau modulul 'ofertare'); simulat în clientul utilizatorului, nu în handler
const CU_MODUL = new Set([RESP, RESP2, STRAIN, RESP_ALTA, AUTO])
const vede = (uid: string) => uid === OWNER || CU_MODUL.has(uid)
const PDF = new TextEncoder().encode('%PDF-1.4 proba')
const CHEI = { anthropic: 'k-anthropic', anon: 'cheie-anon-fara-puncte', service: 'cheie-service-fara-puncte' }
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const JWT_ANON = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'anon', iss: 'supabase' })}.semnatura`
const RASPUNS_AI = { intrebare: 'Solicităm clarificarea cantității de la poziția 12 din F3.', rezumat: 'Se cere clarificarea cantității.', nr_intrebari: 2, referinte: ['F3', 'Anexa 1'], data_document: '2026-11-20' }
const corpAi = (j: unknown, stop = 'end_turn') => ({ stop_reason: stop, usage: { input_tokens: 1000, output_tokens: 100 }, content: [{ type: 'text', text: JSON.stringify(j) }] })

type Rez = { status: number; corp: any; n: any; nu: any; getUser: number; ai: string[] }
type Hnd = (req: Request, deps: any) => Promise<Response>
type Opt = { eroareCheltuiala?: boolean; ai?: { corp?: unknown; status?: number }; pdfLipsa?: boolean; eroareUtilizator?: boolean }

async function ruleaza(h: Hnd, headers: Record<string, string>, body: unknown, opt: Opt = {}): Promise<Rez> {
  // clientul service_role: toate rândurile; Storage întoarce PDF-ul pentru căile cunoscute
  const { supa, n } = fakeSupa({ profiles: PROFILE, ofertare_licitatii: LICITATII, ofertare_clarificari: CLARIFICARI, ofertare_documente_atribuire: [], ai_usage_log: [] },
    { radarSecret: 'rs-ok', eroareCheltuiala: opt.eroareCheltuiala })
  const cai = new Set(CLARIFICARI.map((c) => c.fisier_path).filter(Boolean))
  ;(supa as any).storage = { from: () => ({ download: (p: string) => { n.storage++; return Promise.resolve(!opt.pdfLipsa && cai.has(p) ? { data: new Blob([PDF]), error: null } : { data: null, error: { message: 'Object not found' } }) } }) }
  // clientul utilizatorului: RLS simulată (vede tot sau nimic), cu propriul contor de citiri
  const nu = { citiri: 0, jwt: [] as string[] }
  const caUtilizator = (jwt: string) => {
    nu.jwt.push(jwt)
    const { supa: s } = fakeSupa({ ofertare_clarificari: vede(jwt) ? CLARIFICARI : [] })
    return { from: (t: string) => { nu.citiri++; if (opt.eroareUtilizator) return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: 'conexiune picată' } }) }) }) }; return s.from(t) } }
  }
  let getUser = 0
  const ai: string[] = []
  const deps = {
    db: supa, chei: CHEI, caUtilizator,
    // Auth simulat: token = uid; 'invalid' / orice token cu puncte (JWT nesemnat de noi) = respins, ca în producție
    getUser: (jwt: string) => { getUser++; return Promise.resolve(jwt === 'invalid' || jwt.includes('.') ? null : jwt) },
    fetch: ((_u: unknown, i?: RequestInit) => {
      n.ai++
      ai.push(JSON.parse(String(i?.body || '{}')).model)
      return Promise.resolve(new Response(JSON.stringify(opt.ai?.corp ?? corpAi(RASPUNS_AI)), { status: opt.ai?.status ?? 200 }))
    }) as typeof fetch,
  }
  const r = await h(cerereH(headers, body), deps)
  const t = await r.text()
  let corp: any = t
  try { corp = JSON.parse(t) } catch (_) { /* text */ }
  return { status: r.status, corp, n, nu, getUser, ai }
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })

// lista de verificări: [nume, verificare] — verificarea întoarce null (ok) sau textul abaterii
type Scenariu = [string, (h: Hnd) => Promise<string | null>]
// zero cost = niciun apel AI, nicio scriere, nicio citire / descărcare cu service_role (clientul utilizatorului poate citi licitația)
const zeroCost = (r: Rez) => r.n.ai === 0 && r.n.scrieri === 0 && r.n.citiri.length === 0 && r.n.storage === 0 && r.n.inserate.length === 0 && r.n.actualizate.length === 0
const refuzat = (r: Rez, status: number, mesaj?: string) => r.status === status && typeof r.corp?.error === 'string' && (mesaj === undefined || r.corp.error === mesaj) && zeroCost(r)
const descrie = (r: Rez) => `status ${r.status}, ai ${r.n.ai}, scrieri ${r.n.scrieri}, citiri service [${r.n.citiri}], storage ${r.n.storage}, citiri utilizator ${r.nu.citiri}, corp ${JSON.stringify(r.corp).slice(0, 160)}`
const updateClar = (r: Rez) => r.n.actualizate.filter((x: any) => x.tabel === 'ofertare_clarificari').map((x: any) => x.patch)
const REZUMAT_ASTEPTAT = 'Se cere clarificarea cantității. Conține 2 întrebări. Referințe: F3, Anexa 1.'
// trecut = AI chemat o dată (Haiku), PDF descărcat, jurnalul AI scris, clarificarea actualizată cu rezumatul și întrebarea (placeholder înlocuit)
const trecut = (r: Rez, id: number) => {
  const u = updateClar(r)
  const jurnal = r.n.inserate.filter((x: any) => x.tabel === 'ai_usage_log').flatMap((x: any) => x.rows)
  return r.status === 200 && r.corp?.ok === true && r.corp?.id === id && r.n.ai === 1 && r.ai.join(',') === MODEL && r.n.storage === 1
    && u.length === 1 && u[0].citita_rezumat === REZUMAT_ASTEPTAT && typeof u[0].citita_la === 'string' && u[0].intrebare === RASPUNS_AI.intrebare
    && u[0].sursa === 'extern — PDF depus în SEAP (2026-11-20)' && !('origine' in u[0])
    && jurnal.length === 1 && jurnal[0].ref_id === id && jurnal[0].model === MODEL && r.corp?.rezumat === REZUMAT_ASTEPTAT
}

export const SCENARII: Scenariu[] = [
  ['cont cu acces Ofertare dar fără rol pe licitație -> 403 (mesajul porții), zero service_role / AI / scrieri', async (h) => {
    const r = await ruleaza(h, bearer(STRAIN), { clarificare_id: 1 }); return refuzat(r, 403, MESAJ_CITIRE_ROL) && r.nu.citiri === 1 ? null : descrie(r)
  }],
  ['responsabil pe ALTĂ licitație -> 403, zero cost', async (h) => {
    const r = await ruleaza(h, bearer(RESP_ALTA), { clarificare_id: 1 }); return refuzat(r, 403, MESAJ_CITIRE_ROL) ? null : descrie(r)
  }],
  ['responsabil autonumit (dovada false) -> 403, zero cost', async (h) => {
    const r = await ruleaza(h, bearer(AUTO), { clarificare_id: 3 }); return refuzat(r, 403, MESAJ_CITIRE_ROL) ? null : descrie(r)
  }],
  ['licitația clarificării se citește CA UTILIZATORUL: responsabil fără acces la clarificare (RLS) -> 403 „inaccesibilă”, poarta nici nu e întrebată', async (h) => {
    const r = await ruleaza(h, bearer(FARA_MODUL), { clarificare_id: 4 })
    return refuzat(r, 403, MESAJ_CLARIFICARE_INACCESIBILA) && r.n.rpcCheltuiala === 0 && r.nu.citiri === 1 && r.nu.jwt[0] === FARA_MODUL ? null : descrie(r) + `, rpcCheltuiala ${r.n.rpcCheltuiala}`
  }],
  ['clarificare inexistentă vs invizibilă -> răspuns identic (nu dezvăluie existența)', async (h) => {
    const a = await ruleaza(h, bearer(FARA_MODUL), { clarificare_id: 4 }), b = await ruleaza(h, bearer(FARA_MODUL), { clarificare_id: 999999 })
    return a.status === b.status && JSON.stringify(a.corp) === JSON.stringify(b.corp) && zeroCost(a) && zeroCost(b) ? null : descrie(a) + ' | ' + descrie(b)
  }],
  ['clarificare inexistentă pentru owner -> 403 „inaccesibilă”, zero cost', async (h) => {
    const r = await ruleaza(h, bearer(OWNER), { clarificare_id: 999999 }); return refuzat(r, 403, MESAJ_CLARIFICARE_INACCESIBILA) ? null : descrie(r)
  }],
  ['citirea clarificării ca utilizator CADE -> 500 explicit (nu „inaccesibilă”), zero cost', async (h) => {
    const r = await ruleaza(h, bearer(OWNER), { clarificare_id: 1 }, { eroareUtilizator: true })
    return refuzat(r, 500) && /verificarea clarificării a eșuat/.test(r.corp.error) ? null : descrie(r)
  }],
  ['poarta căzută (RPC eroare) -> 403 chiar și pentru owner (fail-closed)', async (h) => {
    const r = await ruleaza(h, bearer(OWNER), { clarificare_id: 1 }, { eroareCheltuiala: true }); return refuzat(r, 403, MESAJ_CITIRE_ROL) ? null : descrie(r)
  }],
  ['identitatea vine din token, nu din cerere: cont fără rol care trimite uid-ul ownerului -> 403', async (h) => {
    const r = await ruleaza(h, bearer(STRAIN), { clarificare_id: 1, p_uid: OWNER, user_id: OWNER, uid: OWNER })
    return refuzat(r, 403, MESAJ_CITIRE_ROL) ? null : descrie(r)
  }],
  ['fără Authorization / „Bearer ” gol -> 401, zero cost, Auth nici nu e întrebat', async (h) => {
    for (const hd of [{}, { Authorization: '' }, { Authorization: 'Bearer ' }] as Record<string, string>[]) {
      const r = await ruleaza(h, hd, { clarificare_id: 1 }); if (!refuzat(r, 401) || r.getUser !== 0 || r.nu.citiri !== 0) return JSON.stringify(hd) + ': ' + descrie(r)
    }
    return null
  }],
  ['cheia anon (exact valoarea din env) -> 401 înaintea Auth, zero cost', async (h) => {
    const r = await ruleaza(h, bearer(CHEI.anon), { clarificare_id: 1 }); return refuzat(r, 401) && r.getUser === 0 ? null : descrie(r) + `, getUser ${r.getUser}`
  }],
  ['JWT cu rol anon -> 401, zero cost', async (h) => {
    const r = await ruleaza(h, bearer(JWT_ANON), { clarificare_id: 1 }); return refuzat(r, 401) ? null : descrie(r)
  }],
  ['cheia de serviciu / JWT fals service_role -> 401, zero cost (serviciul nu e persoană)', async (h) => {
    for (const t of [CHEI.service, JWT_FALS_SERVICE]) {
      const r = await ruleaza(h, bearer(t), { clarificare_id: 1 }); if (!refuzat(r, 401)) return t.slice(0, 12) + ': ' + descrie(r)
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
    const r = await ruleaza(h, { 'x-radar-secret': 'rs-ok', ...bearer(STRAIN) }, { clarificare_id: 1 }); return refuzat(r, 403, MESAJ_CITIRE_ROL) ? null : descrie(r)
  }],
  ['clarificare_id lipsă / invalid -> 400 chiar pentru owner, zero citiri (utilizator și service), zero AI', async (h) => {
    for (const b of [{}, { clarificare_id: 'abc' }, { clarificare_id: 0 }, { clarificare_id: -5 }, { clarificare_id: 1.5 }]) {
      const r = await ruleaza(h, bearer(OWNER), b); if (!refuzat(r, 400) || r.nu.citiri !== 0) return JSON.stringify(b) + ': ' + descrie(r)
    }
    return null
  }],
  ['owner, clarificare fără PDF -> 400 după poartă, zero AI, zero scrieri', async (h) => {
    const r = await ruleaza(h, bearer(OWNER), { clarificare_id: 2 })
    return r.status === 400 && /nu are PDF/.test(r.corp?.error || '') && r.n.ai === 0 && r.n.scrieri === 0 && r.n.storage === 0 ? null : descrie(r)
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
  ['owner -> trece: licitația citită ca utilizator, poarta, PDF, un apel Haiku, jurnal AI, clarificarea actualizată', async (h) => {
    const r = await ruleaza(h, bearer(OWNER), { clarificare_id: 1 }); return trecut(r, 1) && r.nu.citiri === 1 && r.nu.jwt[0] === OWNER ? null : descrie(r) + ` update ${JSON.stringify(updateClar(r))}`
  }],
  ['responsabil 1 (numire veche, regula A) -> trece', async (h) => {
    const r = await ruleaza(h, bearer(RESP), { clarificare_id: 1 }); return trecut(r, 1) ? null : descrie(r) + ` update ${JSON.stringify(updateClar(r))}`
  }],
  ['responsabil 2 numit de owner -> trece', async (h) => {
    const r = await ruleaza(h, bearer(RESP2), { clarificare_id: 1 }); return trecut(r, 1) ? null : descrie(r) + ` update ${JSON.stringify(updateClar(r))}`
  }],
  ['ordinea: poarta ÎNAINTEA oricărei citiri service_role (la refuz, clientul service nu e atins; la trecere, prima citire service e după RPC)', async (h) => {
    const r = await ruleaza(h, bearer(STRAIN), { clarificare_id: 1 })
    if (!(r.n.citiri.length === 0 && r.n.rpcCheltuiala === 1)) return 'refuz: ' + descrie(r)
    const o = await ruleaza(h, bearer(OWNER), { clarificare_id: 1 })
    return o.n.rpcCheltuiala === 1 && o.n.citiri[0] === 'ofertare_clarificari' ? null : 'trecere: ' + descrie(o)
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

// --- MUTANȚI: fiecare modificare a sursei care slăbește poarta trebuie să fie prinsă de cel puțin un scenariu ---
// Mutantul se scrie lângă handler.ts (importurile relative rămân valabile) și se șterge imediat după rulare.
const SURSA = new URL('./handler.ts', import.meta.url)
const POARTA = "  if (!await poateCheltui(deps.db, licId, uid)) return json({ error: MESAJ_CITIRE_ROL }, 403)\n"
const RAND = "  const { data: row } = await db.from('ofertare_clarificari').select('*').eq('id', id).maybeSingle()\n"
const MUTANTI: [string, string, string][] = [
  ['fără verificare de rol în edge (poarta scoasă)', POARTA, '\n'],
  ['poarta mutată DUPĂ citirea rândului cu service_role',
    POARTA + "  const KEY = deps.chei.anthropic\n  if (!KEY) return json({ error: 'ANTHROPIC_API_KEY lipsă' }, 500)\n\n  // 4. de aici încolo ca înainte, cu service_role: rândul întreg, PDF-ul, AI-ul, jurnalul, update-ul\n  const db = deps.db\n" + RAND,
    "  const KEY = deps.chei.anthropic\n  if (!KEY) return json({ error: 'ANTHROPIC_API_KEY lipsă' }, 500)\n  const db = deps.db\n" + RAND + POARTA],
  ['licitația clarificării citită cu service_role în loc de clientul utilizatorului', "await deps.caUtilizator(jwt).from('ofertare_clarificari')", "await deps.db.from('ofertare_clarificari')"],
  ['identitatea din parametrul cererii (p_uid)', 'poateCheltui(deps.db, licId, uid)', 'poateCheltui(deps.db, licId, (body as any)?.p_uid || uid)'],
  ['fără Auth (orice token = utilizator)', 'try { uid = await deps.getUser(jwt) } catch (_) { uid = null }', 'uid = jwt'],
  ['cheia anon acceptată (fără refuzul explicit)', "if (jwt === deps.chei.anon || rol === 'anon') return", 'if (false) return'],
  ['cheia de serviciu acceptată ca persoană', "if (jwt === deps.chei.service || rol === 'service_role') return json({ error: 'apel neautorizat (cheie de serviciu)' }, 401)",
    "if (jwt === deps.chei.service || rol === 'service_role') uid = 'u-owner'"],
  ['poarta fail-open la clarificare_id invalid', '!Number.isSafeInteger(id) || id <= 0', '!id'],
  ['eroarea la citirea ca utilizator tratată ca „nu există”', "if (error) return json({ error: 'verificarea clarificării a eșuat: ' + String(error.message || 'eroare').slice(0, 200) }, 500)\n", '\n'],
  ['scrierea fără validarea rezumatului AI', "if (typeof j.rezumat !== 'string' || !j.rezumat.trim()) return json({ error: 'Rezumat AI gol sau invalid; clarificarea rămâne neschimbată.' })\n", '\n'],
]

// rulează toate scenariile pe o copie modificată a sursei; întoarce scenariile care au găsit abateri
async function prinsDe(i: number | string, din: string, in_: string): Promise<string[]> {
  const sursa = Deno.readTextFileSync(SURSA).replace(/\r\n/g, '\n')   // checkout-ul de pe Windows poate fi CRLF
  assertEquals(sursa.split(din).length, 2, `mutantul ${i}: textul de înlocuit trebuie să apară EXACT o dată în handler.ts`)
  const fis = new URL(`./.tmp_mutant_${i}_${crypto.randomUUID().slice(0, 8)}.ts`, import.meta.url)
  Deno.writeTextFileSync(fis, sursa.replace(din, in_))
  try {
    const m = await import(fis.href)
    const prinse: string[] = []
    for (const [sc, f] of SCENARII) { let ab: string | null; try { ab = await f(m.handler) } catch (e) { ab = 'excepție: ' + e } if (ab) prinse.push(sc) }
    return prinse
  } finally { Deno.removeSync(fis) }
}

Deno.test('clarificare-citeste MUTANȚI: fiecare mutant e prins de cel puțin un scenariu', async () => {
  for (const [i, [nume, din, in_]] of MUTANTI.entries()) {
    const prinse = await prinsDe(i, din, in_)
    assert(prinse.length > 0, `mutantul „${nume}” NU e prins de niciun scenariu`)
  }
})
// martor: o modificare FĂRĂ efect (doar un comentariu) nu trebuie să pice nimic — altfel detecția de mai sus n-ar dovedi nimic
Deno.test('clarificare-citeste MUTANȚI: martorul neutru (comentariu schimbat) trece toate scenariile', async () => {
  assertEquals(await prinsDe('martor', '// 4. de aici încolo ca înainte, cu service_role: rândul întreg, PDF-ul, AI-ul, jurnalul, update-ul', '// 4. (martor)'), [])
})

// paritate cu regula din BD: lista de mai sus acoperă refuz pe rol, anon, serviciu, owner și ambii responsabili + citirea ca utilizator
Deno.test('clarificare-citeste: scenariile acoperă refuz pe rol, anon, serviciu, owner, ambii responsabili și citirea ca utilizator', () => {
  const t = SCENARII.map(([n]) => n).join('\n')
  for (const k of ['fără rol', 'cheia anon', 'cheia de serviciu', 'owner -> trece', 'responsabil 1', 'responsabil 2', 'CA UTILIZATORUL', 'ÎNAINTEA oricărei citiri service_role']) assert(t.includes(k), k)
})
