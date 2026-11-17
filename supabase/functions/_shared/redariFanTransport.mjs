// redariFanTransport.mjs — calea REALĂ a funcției edge redari-fan-awb (FAN Courier). INERTĂ: se cheamă DOAR din raspundeFan
// (redariFanHandler.mjs), după poarta owner și DOAR dacă TRANSPORT_REAL_ACTIV = true în cod (azi false → 423, fără niciun apel).
// Proiectare: docs/redari/FANCOURIER_INTEGRARE.md §3–§5, §9. Fișa a–e: §4. Toate dependențele (BD, rețea, secrete, pauză) sunt injectate:
// testele rulează cu răspunsuri FAN simulate după documentație, fără rețea.
// Reguli: L04/L22 — înainte de orice POST /intern-awb plătit, claim atomic în BD (fn_red_fan_claim_lot: aprobat → in_curs, o cheie per
// solicitare, hash-urile aprobate recitite); L05 — timeout / 5xx / răspuns ambiguu = „necunoscut”, fără retry automat, rularea se oprește;
// L18 — eroare ≠ gol; L12 — formă necunoscută = „de verificat de om”. Răspunsurile FAN sunt DATE: nu declanșează nimic ireversibil
// (ridicarea, AR-ul, returul le confirmă omul în ecran). Parola / tokenul / URL-ul de login nu se loghează și nu ajung în răspuns.
import { MAX_PE_CERERE, URL_FAN, pregatestePlicuriFan, comparaPlic, imparteInBucati, interpreteazaRaspunsLot, interpreteazaUrmarire,
  interpreteazaConfirmari, comparaEvenimente, cautaInBorderou, caleEticheta, caleListaAwb, estePdf, inBase64 } from './redariFan.mjs'

// Câte solicitări de creare la un apăsat de buton (5 × 100 = 500 de plicuri), cu pauză între ele: limita pe minut a FAN nu e documentată
// (doc §8, deschisă 2) → solicitările merg una după alta, niciodată în paralel. Restul lotului = încă un apăsat (decizie umană).
export const MAX_BUCATI_PE_APEL = 5
export const PAUZA_INTRE_CERERI_MS = 2000
export const TIMEOUT_FAN_MS = 30000
export const MAX_PAGINI_BORDEROU = 30
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ZI = /^\d{4}-\d{2}-\d{2}$/

/** Clientul FAN: login la nevoie (token 24 h, doc §1), un singur login nou la 401 (doc §5), timeout = status 0 („necunoscut”). */
export function clientFan({ fetch, secrete, timeoutMs = TIMEOUT_FAN_MS }) {
  let token = null
  async function apel(method, cale, corp, { binar = false, cuToken = true } = {}) {
    try {
      const headers = { Accept: binar ? 'application/pdf' : 'application/json' }
      if (cuToken) headers.Authorization = 'Bearer ' + token
      if (corp !== undefined) headers['Content-Type'] = 'application/json'
      const res = await fetch(URL_FAN + cale, { method, headers, body: corp === undefined ? undefined : JSON.stringify(corp), signal: AbortSignal.timeout(timeoutMs) })
      if (binar) return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) }
      let c = null
      try { c = await res.json() } catch { c = null }
      return { status: res.status, corp: c }
    } catch { return { status: 0, corp: null } }   // rețea / timeout: rezultatul e NECUNOSCUT, nu eroare deterministă
  }
  async function login() {
    // parametrii de login sunt în query string (doc §1) → URL-ul nu se loghează și nu se întoarce nicăieri
    const q = new URLSearchParams({ username: secrete.username, password: secrete.password })
    const r = await apel('POST', '/login?' + q.toString(), undefined, { cuToken: false })
    const t = r.status === 200 ? (r.corp?.data?.token ?? r.corp?.token) : null
    token = typeof t === 'string' && t.trim() ? t.trim() : null
    if (!token) throw Object.assign(new Error('autentificare FAN neconfirmată'), { codFan: 'autentificare_fan_neconfirmata', status: r.status })
  }
  return {
    async cerere(method, cale, corp, opt) {
      if (!token) await login()
      let r = await apel(method, cale, corp, opt)
      if (r.status === 401) { await login(); r = await apel(method, cale, corp, opt) }   // 401 = refuz înainte de prelucrare, determinist
      return r
    },
  }
}

/** Citire completă cu keyset pe `cheie` (L23: plafonul de 1000 de rânduri al serverului nu taie tacit); id-urile în bucăți de 100 în `.in()`.
 *  fabrica(idsBucata) → interogare PostgREST fără ordine / limită. Întoarce { data } sau { error } (L18: eroare ≠ gol). */
export async function citesteToate(fabrica, ids, cheie = 'id') {
  const tot = []
  try {
    for (let i = 0; i < ids.length; i += 100) {
      let ultim
      for (;;) {
        let q = fabrica(ids.slice(i, i + 100)).order(cheie).limit(1000)
        if (ultim !== undefined) q = q.gt(cheie, ultim)
        const { data, error } = await q
        if (error || !Array.isArray(data)) return { error: error || new Error('răspuns fără listă') }
        if (!data.length) break
        const urm = data.at(-1)[cheie]
        if (urm == null || urm === ultim) return { error: new Error('paginarea nu a avansat') }
        tot.push(...data)
        ultim = urm
      }
    }
  } catch (e) { return { error: e } }
  return { data: tot }
}

/**
 * Execută o acțiune pe un lot. ctx = { corp, lot: { id, proiect_id, nr_lot } } (lotul a fost deja citit cu JWT-ul omului — RLS, L09).
 * deps: { rpc(nume, args) → {data,error}, randuriLot(lotId) → {data,error}, datePlicuri(plicIds) → {data:{plicuri,convocari,contacte},error},
 *         proiect(proiectId) → {data:{cod},error}, fetch, secrete() → {username,password,clientId}|null, pauza(ms), subtle }
 * Întoarce { status, body }.
 */
export async function executaActiuneFan({ corp, lot }, deps) {
  const out = (status, cod, extra = {}) => ({ status, body: { cod, ...extra } })
  const s = deps.secrete()
  if (!s?.username || !s?.password || !s?.clientId) return out(503, 'transport_neconfigurat')   // L10: fără fallback pe alt secret
  const fan = clientFan({ fetch: deps.fetch, secrete: s })
  const r = await deps.randuriLot(lot.id)
  if (r?.error || !Array.isArray(r?.data)) return out(503, 'citire_neconfirmata')   // L18
  const randuri = [...r.data].sort(comparaPlic)
  try {
    switch (corp.actiune) {
      case 'genereaza': return await genereaza({ lot, randuri, s, fan, deps, out })
      case 'urmarire': return await urmarire({ lot, randuri, s, fan, deps, out })
      case 'confirmari': return await confirmari({ lot, randuri, s, fan, deps, out })
      case 'evenimente': { const x = await fan.cerere('GET', '/reports/awb-events'); const c = comparaEvenimente(x.status, x.corp); return c.ok ? out(200, 'ok', c) : out(502, 'evenimente_de_verificat', { motiv: c.motiv }) }
      case 'eticheta': return await eticheta({ corp, randuri, s, fan, out })
      case 'reconciliaza': return await reconciliaza({ corp, randuri, s, fan, out })
      case 'sterge_awb': return await stergeAwb({ corp, randuri, s, fan, deps, out })
      default: return out(400, 'cerere_invalida')
    }
  } catch (e) {
    if (e?.codFan === 'autentificare_fan_neconfirmata') return out(503, 'autentificare_fan_neconfirmata')
    throw e
  }
}

// ── creare: loturi de ≤ 100, claim → POST /intern-awb → rezultate atomice ──
async function genereaza({ lot, randuri, s, fan, deps, out }) {
  const aprobate = randuri.filter(x => x.stare === 'aprobat')
  if (!aprobate.length) return out(409, 'nimic_de_generat')
  const pr = await deps.proiect(lot.proiect_id)
  if (pr?.error || !pr?.data?.cod) return out(503, 'citire_neconfirmata')
  const d = await deps.datePlicuri(aprobate.map(x => x.plic_id))
  if (d?.error || !d?.data) return out(503, 'citire_neconfirmata')
  const pregatite = await pregatestePlicuriFan({ ...d.data, proiectCod: pr.data.cod, subtle: deps.subtle })
  const pePlic = new Map(pregatite.map(p => [p.plic.id, p]))
  const excluse = [], deTrimis = []
  for (const x of aprobate) {
    const p = pePlic.get(x.plic_id)
    if (!p) excluse.push({ nr_plic: x.nr_plic, motiv: 'plicul nu mai e citibil sau activ' })
    else if (!p.ok) excluse.push({ nr_plic: x.nr_plic, motiv: p.probleme.join('; ') })
    else if (p.hash !== x.hash_date) excluse.push({ nr_plic: x.nr_plic, motiv: 'datele s-au schimbat după aprobare (re-propunere + aprobare nouă)' })
    else deTrimis.push({ rand: x, shipment: p.shipment, hash: p.hash })
  }
  const bucati = imparteInBucati(deTrimis, MAX_PE_CERERE)
  const raport = { generat: 0, eroare: 0, necunoscut: 0 }
  let oprit = null, trimise = 0
  for (const [i, b] of bucati.entries()) {
    if (i >= MAX_BUCATI_PE_APEL) { oprit = 'limita de solicitări pe apăsare; restul se trimite la următorul apăsat'; break }
    if (i > 0) await deps.pauza(PAUZA_INTRE_CERERI_MS)
    // L04/L22: pasul durabil ÎNAINTE de bani. Refuz = nimic trimis; rândurile rămân „aprobat”.
    const c = await deps.rpc('fn_red_fan_claim_lot', { p_lot_id: lot.id, p_ids: b.map(x => x.rand.id), p_hashuri: b.map(x => x.hash) })
    if (c?.error || typeof c?.data !== 'string' || !UUID.test(c.data)) { oprit = 'rezervarea în BD a fost refuzată sau neconfirmată; nimic trimis la FAN pentru această bucată'; break }
    const raspuns = await fan.cerere('POST', '/intern-awb', { clientId: s.clientId, shipments: b.map(x => x.shipment) })
    trimise++
    const rez = interpreteazaRaspunsLot(raspuns.status, raspuns.corp, b.length)
    const w = await deps.rpc('fn_red_fan_rezultate', { p_cerere: c.data, p_rezultate: b.map((x, k) => ({ id: x.rand.id, stare: rez[k].stare, awb: rez[k].awb ?? null,
      tarif: rez[k].tarif ?? null, tva: rez[k].tva ?? null, motiv: rez[k].motiv ?? null })) })
    if (w?.error) { raport.necunoscut += b.length; oprit = 'rezultatul nu s-a putut scrie: rândurile rămân „în curs”; reconciliază după 10 minute (borderoul zilei)'; break }
    for (const x of rez) raport[x.stare]++
    if (rez.some(x => x.stare === 'necunoscut')) { oprit = 'răspuns FAN neconfirmat: rularea s-a oprit (fără retry automat); reconciliază'; break }
    if (raspuns.status === 429) { oprit = 'FAN: prea multe solicitări; rularea s-a oprit, se reia de om'; break }
  }
  const ramase = deTrimis.length - bucati.slice(0, trimise).reduce((n, b) => n + b.length, 0)
  return out(200, 'ok', { ...raport, solicitari: trimise, excluse, ramase, oprit })
}

// ── urmărire: ≤ 100 AWB-uri pe solicitare; scrie DOAR starea de urmărire (propuneri), nu expedierea ──
const cuAwb = randuri => randuri.filter(x => ['generat', 'ridicat'].includes(x.stare) && x.awb)
async function urmarire({ lot, randuri, s, fan, deps, out }) {
  const lista = cuAwb(randuri)
  if (!lista.length) return out(409, 'nimic_de_urmarit')
  const stari = {}
  let scrise = 0, necerute = 0
  for (const [i, b] of imparteInBucati(lista).entries()) {
    if (i > 0) await deps.pauza(PAUZA_INTRE_CERERI_MS)
    const awbs = b.map(x => x.awb)
    const x = await fan.cerere('GET', caleListaAwb('/reports/awb/tracking', { clientId: s.clientId, awbs }))
    const u = interpreteazaUrmarire(x.status, x.corp, awbs)
    if (!u.ok) return out(502, 'urmarire_neconfirmata', { motiv: u.motiv, scrise, stari })
    necerute += u.necerute
    const p = b.map(r => { const z = u.pe_awb.get(r.awb); stari[z.urmarire_stare] = (stari[z.urmarire_stare] || 0) + 1
      return { id: r.id, awb: r.awb, urmarire_stare: z.urmarire_stare, ultim_eveniment: z.ultim_eveniment, ultim_eveniment_la: z.ultim_eveniment_la,
        ridicat_propus: z.ridicat_propus, livrat_la: z.livrat_la, retur_propus: z.retur_propus } })
    const w = await deps.rpc('fn_red_fan_urmarire', { p_lot_id: lot.id, p_randuri: p })
    if (w?.error || w?.data !== p.length) return out(503, 'scriere_neconfirmata', { scrise, stari })
    scrise += p.length
  }
  return out(200, 'ok', { scrise, stari, necerute })
}

async function confirmari({ lot, randuri, s, fan, deps, out }) {
  const lista = cuAwb(randuri)
  if (!lista.length) return out(409, 'nimic_de_urmarit')
  const stari = {}
  let scrise = 0
  for (const [i, b] of imparteInBucati(lista).entries()) {
    if (i > 0) await deps.pauza(PAUZA_INTRE_CERERI_MS)
    const awbs = b.map(x => x.awb)
    const x = await fan.cerere('GET', caleListaAwb('/reports/awb/confirmations', { clientId: s.clientId, awbs, extra: { language: 'ro' } }))
    const c = interpreteazaConfirmari(x.status, x.corp, awbs)
    if (!c.ok) return out(502, 'confirmari_neconfirmate', { motiv: c.motiv, scrise, stari })
    const p = b.map(r => { const z = c.pe_awb.get(r.awb); stari[z] = (stari[z] || 0) + 1; return { id: r.id, awb: r.awb, confirmare_stare: z } })
    const w = await deps.rpc('fn_red_fan_confirmari', { p_lot_id: lot.id, p_randuri: p })
    if (w?.error || w?.data !== p.length) return out(503, 'scriere_neconfirmata', { scrise, stari })
    scrise += p.length
  }
  return out(200, 'ok', { scrise, stari })
}

// ── etichete: UN PDF pentru tot lotul (≤ 100 AWB-uri), în ordinea numărului de plic, format A6; peste 100 = părți numerotate ──
async function eticheta({ corp, randuri, s, fan, out }) {
  const lista = cuAwb(randuri)
  if (!lista.length) return out(409, 'nimic_de_tiparit')
  const parti = imparteInBucati(lista)
  const parte = corp.parte == null ? 1 : corp.parte
  if (!Number.isInteger(parte) || parte < 1 || parte > parti.length) return out(400, 'cerere_invalida')
  const b = parti[parte - 1]
  const x = await fan.cerere('GET', caleEticheta({ clientId: s.clientId, awbs: b.map(r => r.awb) }), undefined, { binar: true })
  if (x.status !== 200 || !estePdf(x.bytes)) return out(502, 'eticheta_neconfirmata', { http: x.status })
  return out(200, 'ok', { parte, parti: parti.length, nr_plicuri: b.map(r => r.nr_plic), pdf_base64: inBase64(x.bytes) })
}

// ── reconciliere: citește borderoul zilei și PROPUNE; scrierea o face omul (fn_red_fan_reconciliaza) ──
async function reconciliaza({ corp, randuri, s, fan, out }) {
  if (typeof corp.data !== 'string' || !ZI.test(corp.data)) return out(400, 'cerere_invalida')
  const lista = randuri.filter(x => ['necunoscut', 'in_curs'].includes(x.stare))
  if (!lista.length) return out(409, 'nimic_de_reconciliat')
  const pagini = []
  let complet = false
  for (let p = 1; p <= MAX_PAGINI_BORDEROU; p++) {
    const q = new URLSearchParams({ clientId: s.clientId, date: corp.data, perPage: String(MAX_PE_CERERE), page: String(p) })
    const x = await fan.cerere('GET', '/reports/awb?' + q.toString())
    if (!Number.isInteger(x.status) || x.status <= 0 || x.status >= 400) return out(502, 'borderou_neconfirmat', { http: x.status })
    pagini.push(x.corp)
    const l = Array.isArray(x.corp) ? x.corp : Array.isArray(x.corp?.data) ? x.corp.data : null
    if (!l) break   // formă necunoscută: cautaInBorderou marchează tot „de verificat”
    if (!l.length) { complet = true; break }
  }
  const g = cautaInBorderou(pagini, lista.map(x => x.nr_plic), { complet })
  return out(200, 'ok', { complet, propuneri: lista.map(x => ({ id: x.id, nr_plic: x.nr_plic, stare_rand: x.stare, ...g.get(x.nr_plic) })) })
}

// ── ștergerea unui AWB neridicat (doc §5: doar de pe borderoul zilei, înainte de C0) ──
async function stergeAwb({ corp, randuri, s, fan, deps, out }) {
  if (typeof corp.rand_id !== 'string' || !UUID.test(corp.rand_id)) return out(400, 'cerere_invalida')
  const x = randuri.find(r => r.id === corp.rand_id)
  if (!x) return out(404, 'tinta_inexistenta')
  if (x.stare !== 'generat' || !x.awb) return out(409, 'doar_awb_generat_neridicat')
  const q = new URLSearchParams({ clientId: s.clientId, awb: x.awb })
  const d = await fan.cerere('DELETE', '/awb?' + q.toString())
  if (!Number.isInteger(d.status) || d.status <= 0 || d.status >= 500) return out(503, 'stergere_neconfirmata', { motiv: 'verifică în selfAWB; AWB-ul rămâne „generat” până la confirmare' })
  if (d.status >= 400) return out(409, 'stergere_refuzata', { http: d.status })
  const w = await deps.rpc('fn_red_fan_anulat', { p_id: x.id, p_awb: x.awb, p_motiv: 'AWB șters prin API (DELETE /awb confirmat)' })
  if (w?.error) return out(503, 'scriere_neconfirmata', { motiv: 'AWB șters la FAN, dar evidența nu s-a actualizat: verifică în selfAWB, apoi „Marchează anulat” din ecran' })
  return out(200, 'ok', { anulat: x.nr_plic })
}
