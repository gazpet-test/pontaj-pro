// deno test -A --node-modules-dir=none supabase/functions/ofertare-verificare-finala/poarta_test.ts
// TKT-2026-0390: verificarea finală (Sonnet + Fable, plătită) pornește doar pentru owner / responsabil 1-2 numit de owner sau admin
// Ofertare, verificat PE SERVER pe utilizatorul din JWT (nu pe o parolă din browser). Handler-ul REAL, cu client Supabase și
// Anthropic simulate (fără rețea, fără secrete). Scenariile sunt o listă de verificări care întoarce abaterile, ca aceeași listă
// să ruleze și pe MUTANȚI ai sursei (poarta scoasă, identitatea din cerere, cheia anon acceptată…): fiecare mutant trebuie prins.
// Valorile așteptate vin din regula 20261124a (owner; responsabil cu dovada de numire; autoatribuit = nu), nu din handler.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { cerereH, fakeSupa, JWT_FALS_SERVICE, OWNER, RESP, RESP_ALTA, STRAIN } from '../_test/fake_supa.ts'
import { cuPoartaLot } from '../_test/poarta_lot.ts'
import { handler } from './handler.ts'

const RESP2 = 'u-resp2-95', AUTO = 'u-autonumit'
const PROFILE = [OWNER, RESP, RESP2, STRAIN, RESP_ALTA, AUTO].map((id) => ({ id, is_owner: id === OWNER }))
const LICITATII = [
  // 95: responsabil 1 = numire veche (fără „numit de”, regula A), responsabil 2 numit de owner (dovada true)
  { id: 95, nr_anunt: 'CN-TEST', obiect: 'test', stare_loturi: 'fara_loturi', responsabil_id: RESP,
    responsabil2_id: RESP2, responsabil2_setat_de: OWNER, responsabil2_numitor_autorizat: true },
  { id: 96, stare_loturi: 'fara_loturi', responsabil_id: RESP_ALTA },
  // 98: s-a numit singur (dovada false) — nu trece
  { id: 98, stare_loturi: 'fara_loturi', responsabil_id: AUTO, responsabil_setat_de: AUTO, responsabil_numitor_autorizat: false },
]
const CERINTE = [{ id: 1, licitatie_id: 95, tip: 'tehnic', text_cerinta: 'cerința 1', confirmata_de: OWNER, inlocuita_de: null, ofertare_acoperire: [] }]
const CHEI = { anthropic: 'k-anthropic', anon: 'cheie-anon-fara-puncte', service: 'cheie-service-fara-puncte' }
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const JWT_ANON = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'anon', iss: 'supabase' })}.semnatura`

type Rez = { status: number; corp: any; n: any; getUser: number; ai: string[] }
type Hnd = (req: Request, deps: any) => Promise<Response>

async function ruleaza(h: Hnd, headers: Record<string, string>, body: unknown, opt: { eroareCheltuiala?: boolean } = {}): Promise<Rez> {
  const { supa: s0, n } = fakeSupa({ profiles: PROFILE, ofertare_licitatii: LICITATII, ofertare_cerinte: CERINTE,
    ofertare_formulare_registru: [], ofertare_licitatie_loturi: [], ofertare_verificari: [{ id: 501 }] },
    { radarSecret: 'rs-ok', eroareCheltuiala: opt.eroareCheltuiala })
  const { supa } = cuPoartaLot(s0, [])
  let getUser = 0
  const ai: string[] = []
  const deps = {
    db: supa, chei: CHEI,
    // Auth simulat: token = uid; 'invalid' / orice token cu puncte (JWT nesemnat de noi) = respins, ca în producție
    getUser: (jwt: string) => { getUser++; return Promise.resolve(jwt === 'invalid' || jwt.includes('.') ? null : jwt) },
    fetch: ((_u: unknown, i?: RequestInit) => {
      n.ai++
      const model = JSON.parse(String(i?.body || '{}')).model
      ai.push(model)
      const text = model === 'claude-fable-5-1'
        ? '{"verdict":"verde","motivare":"ok","probleme_critice":[],"puncte_de_verificat_de_om":[]}'
        : '{"probleme":[],"categorii_lipsa":[],"observatie_generala":"ok"}'
      return Promise.resolve(new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }), { status: 200 }))
    }) as typeof fetch,
  }
  const r = await h(cerereH(headers, body), deps)
  const t = await r.text()
  let corp: any = t
  try { corp = JSON.parse(t) } catch (_) { /* text */ }
  return { status: r.status, corp, n, getUser, ai }
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })

// lista de verificări: [nume, verificare] — verificarea întoarce null (ok) sau textul abaterii
type Scenariu = [string, (h: Hnd) => Promise<string | null>]
const zeroCost = (r: Rez) => r.n.ai === 0 && r.n.scrieri === 0 && r.n.citiri.length === 0 && r.n.inserate.length === 0
const refuzat = (r: Rez, status: number) => r.status === status && r.corp?.ok === false && zeroCost(r)
const descrie = (r: Rez) => `status ${r.status}, ai ${r.n.ai}, scrieri ${r.n.scrieri}, citiri [${r.n.citiri}], corp ${JSON.stringify(r.corp).slice(0, 160)}`
const rulatDe = (r: Rez) => r.n.inserate.filter((x: any) => x.tabel === 'ofertare_verificari').flatMap((x: any) => x.rows).map((x: any) => x.rulat_de)
const trecut = (r: Rez, uid: string) => r.status === 200 && r.corp?.ok === true && r.corp?.verificare_id === 501 && r.n.ai === 2 &&
  r.ai.join(',') === 'claude-sonnet-5-5,claude-fable-5-1' && JSON.stringify(rulatDe(r)) === JSON.stringify([uid])

export const SCENARII: Scenariu[] = [
  ['fără rol (cont oarecare) -> 403, zero citiri / AI / scrieri', async (h) => {
    const r = await ruleaza(h, bearer(STRAIN), { licitatie_id: 95 }); return refuzat(r, 403) ? null : descrie(r)
  }],
  ['responsabil pe ALTĂ licitație -> 403, zero cost', async (h) => {
    const r = await ruleaza(h, bearer(RESP_ALTA), { licitatie_id: 95 }); return refuzat(r, 403) ? null : descrie(r)
  }],
  ['responsabil autonumit (dovada false) -> 403, zero cost', async (h) => {
    const r = await ruleaza(h, bearer(AUTO), { licitatie_id: 98 }); return refuzat(r, 403) ? null : descrie(r)
  }],
  ['licitație inexistentă vs inaccesibilă -> răspuns identic (nu dezvăluie existența)', async (h) => {
    const a = await ruleaza(h, bearer(STRAIN), { licitatie_id: 95 }), b = await ruleaza(h, bearer(STRAIN), { licitatie_id: 999999 })
    return a.status === b.status && JSON.stringify(a.corp) === JSON.stringify(b.corp) && zeroCost(a) && zeroCost(b) ? null : descrie(a) + ' | ' + descrie(b)
  }],
  ['poarta căzută (RPC eroare) -> 403 chiar și pentru owner (fail-closed)', async (h) => {
    const r = await ruleaza(h, bearer(OWNER), { licitatie_id: 95 }, { eroareCheltuiala: true }); return refuzat(r, 403) ? null : descrie(r)
  }],
  ['identitatea vine din token, nu din cerere: cont fără rol care trimite uid-ul ownerului -> 403', async (h) => {
    const r = await ruleaza(h, bearer(STRAIN), { licitatie_id: 95, p_uid: OWNER, user_id: OWNER, rulat_de: OWNER })
    return refuzat(r, 403) ? null : descrie(r)
  }],
  ['fără Authorization / „Bearer ” gol -> 401, zero cost, Auth nici nu e întrebat', async (h) => {
    for (const hd of [{}, { Authorization: '' }, { Authorization: 'Bearer ' }] as Record<string, string>[]) {
      const r = await ruleaza(h, hd, { licitatie_id: 95 }); if (!refuzat(r, 401) || r.getUser !== 0) return JSON.stringify(hd) + ': ' + descrie(r)
    }
    return null
  }],
  ['cheia anon (exact valoarea din env) -> 401 înaintea Auth, zero cost', async (h) => {
    const r = await ruleaza(h, bearer(CHEI.anon), { licitatie_id: 95 }); return refuzat(r, 401) && r.getUser === 0 ? null : descrie(r) + `, getUser ${r.getUser}`
  }],
  ['JWT cu rol anon -> 401, zero cost', async (h) => {
    const r = await ruleaza(h, bearer(JWT_ANON), { licitatie_id: 95 }); return refuzat(r, 401) ? null : descrie(r)
  }],
  ['cheia de serviciu / JWT fals service_role -> 401, zero cost (serviciul nu e persoană)', async (h) => {
    for (const t of [CHEI.service, JWT_FALS_SERVICE]) {
      const r = await ruleaza(h, bearer(t), { licitatie_id: 95 }); if (!refuzat(r, 401)) return t.slice(0, 12) + ': ' + descrie(r)
    }
    return null
  }],
  ['token invalid (respins de Auth) -> 401, zero cost', async (h) => {
    const r = await ruleaza(h, bearer('invalid'), { licitatie_id: 95 }); return refuzat(r, 401) ? null : descrie(r)
  }],
  ['x-radar-secret VALID fără JWT -> 401; secretul nici nu se verifică (cale scoasă)', async (h) => {
    const r = await ruleaza(h, { 'x-radar-secret': 'rs-ok' }, { licitatie_id: 95 })
    return refuzat(r, 401) && r.n.rpcSecret === 0 ? null : descrie(r) + `, rpcSecret ${r.n.rpcSecret}`
  }],
  ['x-radar-secret VALID + cont fără rol -> 403 (secretul nu ține loc de poartă)', async (h) => {
    const r = await ruleaza(h, { 'x-radar-secret': 'rs-ok', ...bearer(STRAIN) }, { licitatie_id: 95 }); return refuzat(r, 403) ? null : descrie(r)
  }],
  ['licitatie_id lipsă / invalid -> 400 chiar pentru owner, zero AI', async (h) => {
    for (const b of [{}, { licitatie_id: 'abc' }, { licitatie_id: 0 }, { licitatie_id: -5 }, { licitatie_id: 1.5 }]) {
      const r = await ruleaza(h, bearer(OWNER), b); if (r.status !== 400 || r.n.ai !== 0 || r.n.scrieri !== 0) return JSON.stringify(b) + ': ' + descrie(r)
    }
    return null
  }],
  ['owner -> trece: B (Sonnet) + C (Fable), verdict scris cu rulat_de = owner', async (h) => {
    const r = await ruleaza(h, bearer(OWNER), { licitatie_id: 95 }); return trecut(r, OWNER) ? null : descrie(r) + ` rulat_de ${rulatDe(r)}`
  }],
  ['responsabil 1 (numire veche, regula A) -> trece, rulat_de = el', async (h) => {
    const r = await ruleaza(h, bearer(RESP), { licitatie_id: 95 }); return trecut(r, RESP) ? null : descrie(r) + ` rulat_de ${rulatDe(r)}`
  }],
  ['responsabil 2 numit de owner -> trece, rulat_de = el', async (h) => {
    const r = await ruleaza(h, bearer(RESP2), { licitatie_id: 95 }); return trecut(r, RESP2) ? null : descrie(r) + ` rulat_de ${rulatDe(r)}`
  }],
  ['rulat_de nu se ia din cerere: responsabilul trimite rulat_de = owner -> se scrie tot el', async (h) => {
    const r = await ruleaza(h, bearer(RESP), { licitatie_id: 95, rulat_de: OWNER, user_id: OWNER, p_uid: OWNER })
    return trecut(r, RESP) ? null : descrie(r) + ` rulat_de ${rulatDe(r)}`
  }],
  ['OPTIONS (CORS) -> 200 fără nimic altceva', async (h) => {
    const { supa, n } = fakeSupa({})
    const r = await h(new Request('http://x/', { method: 'OPTIONS' }), { db: supa, chei: CHEI, getUser: () => Promise.resolve(null), fetch: (() => { n.ai++ }) as any })
    return r.status === 200 && n.ai === 0 && n.citiri.length === 0 ? null : `status ${r.status}`
  }],
]

for (const [nume, f] of SCENARII) {
  Deno.test('verificare-finala: ' + nume, async () => { const ab = await f(handler); assertEquals(ab, null) })
}

// --- MUTANȚI: fiecare modificare a sursei care slăbește poarta trebuie să fie prinsă de cel puțin un scenariu ---
// Mutantul se scrie lângă handler.ts (importurile relative rămân valabile) și se șterge imediat după rulare.
const SURSA = new URL('./handler.ts', import.meta.url)
const MUTANTI: [string, string, string][] = [
  ['fără verificare de rol în edge (poarta scoasă)',
    "  if (!await poateCheltui(sb, licId, userId)) return json({ ok: false, error: MESAJ_VERIFICARE_ROL }, 403)\n", '\n'],
  ['poarta mutată DUPĂ citirea licitației',
    "  if (!await poateCheltui(sb, licId, userId)) return json({ ok: false, error: MESAJ_VERIFICARE_ROL }, 403)\n\n  const { data: lic } = await sb.from('ofertare_licitatii').select('*').eq('id', licId).maybeSingle()\n",
    "  const { data: lic } = await sb.from('ofertare_licitatii').select('*').eq('id', licId).maybeSingle()\n  if (!await poateCheltui(sb, licId, userId)) return json({ ok: false, error: MESAJ_VERIFICARE_ROL }, 403)\n"],
  ['identitatea din parametrul cererii (p_uid)', 'poateCheltui(sb, licId, userId)', 'poateCheltui(sb, licId, (body as any)?.p_uid || userId)'],
  ['rulat_de din cerere', 'rulat_de: userId,', 'rulat_de: (body as any)?.rulat_de || userId,'],
  ['fără Auth (orice token = utilizator)', 'try { userId = await deps.getUser(jwt) } catch (_) { userId = null }', 'userId = jwt'],
  ['cheia anon acceptată (fără refuzul explicit)', "if (jwt === deps.chei.anon || rol === 'anon') return", "if (false) return"],
  ['cheia de serviciu acceptată ca persoană', "if (jwt === deps.chei.service || rol === 'service_role') return json({ ok: false, error: 'apel neautorizat (cheie de serviciu)' }, 401)",
    "if (jwt === deps.chei.service || rol === 'service_role') userId = 'u-owner'"],
  ['poarta fail-open la licitatie_id invalid', '!Number.isSafeInteger(licId) || licId <= 0', '!licId'],
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

Deno.test('verificare-finala MUTANȚI: fiecare mutant e prins de cel puțin un scenariu', async () => {
  for (const [i, [nume, din, in_]] of MUTANTI.entries()) {
    const prinse = await prinsDe(i, din, in_)
    assert(prinse.length > 0, `mutantul „${nume}” NU e prins de niciun scenariu`)
  }
})
// martor: o modificare FĂRĂ efect (doar un comentariu) nu trebuie să pice nimic — altfel detecția de mai sus n-ar dovedi nimic
Deno.test('verificare-finala MUTANȚI: martorul neutru (comentariu schimbat) trece toate scenariile', async () => {
  assertEquals(await prinsDe('martor', '// --- Trecerea A: constructor (determinist) ---', '// --- Trecerea A (martor) ---'), [])
})

// paritate cu regula din BD: lista de mai sus acoperă toate cele 4 categorii (refuz rol, refuz identitate, trece owner, trece responsabil)
Deno.test('verificare-finala: scenariile acoperă refuz pe rol, anon, serviciu, owner și ambii responsabili', () => {
  const t = SCENARII.map(([n]) => n).join('\n')
  for (const k of ['fără rol', 'cheia anon', 'cheia de serviciu', 'owner -> trece', 'responsabil 1', 'responsabil 2']) assert(t.includes(k), k)
})
