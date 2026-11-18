// redariFanTransport.mjs — calea REALĂ a funcției edge redari-fan-awb (FAN Courier). Se cheamă DOAR din raspundeFan
// (redariFanHandler.mjs), după poarta de rol (operator numit / owner, sau owner pe calea detaliată), DOAR dacă TRANSPORT_REAL_ACTIV = true în cod
// și DOAR pe un lot care trece garda „doar TEST” (DOAR_PROIECTE_TEST; pe `trimite` doar proiectul aici, marcajul după RPC — spec §8.1).
// Proiectare: docs/redari/FANCOURIER_INTEGRARE.md §3–§5, §9 + docs/redari/FAN_FLUX_OPERATOR_SPEC.md §7.3, §8 (F1). Toate dependențele (BD, rețea,
// secrete, pauză) sunt injectate: testele rulează cu răspunsuri FAN simulate după documentație, fără rețea.
// Reguli: L04/L22 — înainte de orice POST /intern-awb plătit, claim atomic în BD (o cheie per solicitare, hash-urile aprobate recitite); L05 —
// timeout / 5xx / răspuns ambiguu = „necunoscut”, fără retry automat, rularea se oprește; L18 — eroare ≠ gol; L12 — formă necunoscută = „de
// verificat de om”. Răspunsurile FAN sunt DATE: nu declanșează nimic ireversibil (ridicarea, AR-ul, returul le confirmă omul în ecran).
// F1 (spec §7.3): DOUĂ clase de RPC-uri. COMENZILE omului (fn_red_fan_comanda, fn_red_fan_tiraj, fn_red_fan_anulare_cere) merg cu JWT-ul lui
// (deps.rpc). ÎNSCRIEREA rezultatelor externe (fn_red_fan_srv_claim / _srv_rezultate / _srv_intentie_incheie / _srv_reconciliaza / _srv_anuleaza)
// merge DOAR cu clientul service_role (deps.rpcServer), DOAR după poarta omului, cu p_actor = id-ul lui din JWT-ul verificat; niciun om nu le
// poate apela direct (EXECUTE exclusiv service_role în BD). Calea detaliată `genereaza` (owner) rămâne pe RPC-urile vechi, cu JWT-ul owner-ului.
// Parola / tokenul / URL-ul de login nu se loghează și nu ajung în răspuns.
import { MAX_PE_CERERE, URL_FAN, pregatestePlicuriFan, comparaPlic, imparteInBucati, interpreteazaRaspunsLot, interpreteazaUrmarire,
  interpreteazaConfirmari, comparaEvenimente, cautaInBorderou, caleEticheta, caleListaAwb, estePdf, inBase64, amprenteSurse, manifestTiparire,
  partiManifest, interpreteazaStergere, cheieTiraj, tirajDin, tirajNeschimbat, refuzTiraj, MESAJ_TIRAJ_SCHIMBAT, MESAJ_TIRAJ_OPRIT, hashCerereFan,
  COD_PAUZA_FAN, OBSERVATIE_NEINCERCAT, MOTIVE_ANULARE, CODURI_FAN } from './redariFan.mjs'

// Câte solicitări de creare la un apăsat de buton (5 × 100 = 500 de plicuri), cu pauză între ele: limita pe minut a FAN nu e documentată
// (doc §8, deschisă 2) → solicitările merg una după alta, niciodată în paralel. Restul lotului = încă un apăsat (decizie umană).
export const MAX_BUCATI_PE_APEL = 5
export const PAUZA_INTRE_CERERI_MS = 2000
export const TIMEOUT_FAN_MS = 30000
export const MAX_PAGINI_BORDEROU = 30
export const MAX_PLICURI_TRIMITE = 2000
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

/** Refuzul unui RPC al BD → răspunsul funcției edge: RD032 = 423 (același cod ca garda din handler); 42501 = 403; RD03x / 22023 / P0001 / P0002 =
 *  409 „comanda_refuzata” cu codul BD (mesajul §8.5 îl alege ecranul după cod); orice altceva (5xx, rețea) = 503 neconfirmat (L05: nimic dovedit). */
export function refuzBd(error, codNeconfirmat = 'scriere_neconfirmata') {
  const c = error?.code
  if (c === 'RD032') return { status: 423, body: { cod: 'transport_real_doar_test', cod_bd: c } }
  if (c === '42501') return { status: 403, body: { cod: 'non_operator', cod_bd: c } }
  if (c && (CODURI_FAN[c] || ['22023', 'P0001', 'P0002', '23505'].includes(c))) return { status: 409, body: { cod: 'comanda_refuzata', cod_bd: c, motiv: CODURI_FAN[c] || null, mesaj: String(error?.message || '').slice(0, 300) } }
  return { status: 503, body: { cod: codNeconfirmat, cod_bd: c || null } }
}

/**
 * Execută o acțiune pe un lot. ctx = { corp, lot: { id, proiect_id, nr_lot }, uid (id-ul omului din JWT-ul verificat), proiectCod } (lotul a fost deja citit
 * cu JWT-ul omului — RLS, L09). deps: { rpc(nume, args) → {data,error} (JWT-ul omului), rpcServer(nume, args) → {data,error} (service_role, DOAR clasa B),
 * randuriLot(lotId), datePlicuri(plicIds) → {data:{plicuri,convocari,contacte},error}, plicuriLot(lotId), proiect(proiectId) → {data:{cod},error},
 * fanLot(lotId) → {data:{test,…},error}, transportPermisDupaRpc({ proiectCod, fanLot }) → { ok, cod, motiv } (garda completă, cereMarcaj: true),
 * fetch, secrete() → {username,password,clientId}|null, pauza(ms), subtle }. Întoarce { status, body }.
 */
export async function executaActiuneFan({ corp, lot, uid = null, proiectCod = null }, deps) {
  const out = (status, cod, extra = {}) => ({ status, body: { cod, ...extra } })
  try {
    // F1: butonul unic — secretele se citesc ABIA după RPC-ul comenzii și recitirea marcajului (spec §8.1 pașii 3–5)
    if (corp.actiune === 'trimite') return await trimite({ corp, lot, uid, proiectCod, deps, out })
    const s = deps.secrete()
    if (!s?.username || !s?.password || !s?.clientId) return out(503, 'transport_neconfigurat')   // L10: fără fallback pe alt secret
    const fan = clientFan({ fetch: deps.fetch, secrete: s })
    const r = await deps.randuriLot(lot.id)
    if (r?.error || !Array.isArray(r?.data)) return out(503, 'citire_neconfirmata')   // L18
    const randuri = [...r.data].sort(comparaPlic)
    switch (corp.actiune) {
      case 'genereaza': return await genereaza({ lot, randuri, s, fan, deps, out })
      case 'urmarire': return await urmarire({ lot, randuri, s, fan, deps, uid, out })
      case 'confirmari': return await confirmari({ lot, randuri, s, fan, deps, uid, out })
      case 'evenimente': { const x = await fan.cerere('GET', '/reports/awb-events'); const c = comparaEvenimente(x.status, x.corp); return c.ok ? out(200, 'ok', c) : out(502, 'evenimente_de_verificat', { motiv: c.motiv }) }
      case 'eticheta': return await eticheta({ corp, lot, randuri, s, fan, deps, out })
      case 'reconciliaza': return await reconciliaza({ corp, randuri, s, fan, deps, uid, out })
      case 'sterge_awb': return await stergeAwb({ corp, randuri, s, fan, deps, uid, out })
      default: return out(400, 'cerere_invalida')
    }
  } catch (e) {
    if (e?.codFan === 'autentificare_fan_neconfirmata') return out(503, 'autentificare_fan_neconfirmata')
    throw e
  }
}

// ── F1: „Trimite la curier” — propunere + aprobare + plafoane într-UN RPC (comanda), apoi rezervare → POST → rezultate (clasa B), încheierea
// intenției ÎNAINTEA etichetelor, tirajul doar pe lotul încheiat (BD decide: RD031 = fără etichete). Ordinea exactă: spec §8.1 pașii 1–8. ──
async function trimite({ corp, lot, uid, proiectCod, deps, out }) {
  const ids = Array.isArray(corp.plic_ids) ? corp.plic_ids : null
  if (!ids || !ids.length || ids.length > MAX_PLICURI_TRIMITE || ids.some(x => typeof x !== 'string' || !UUID.test(x)) || new Set(ids).size !== ids.length
      || typeof corp.intentie !== 'string' || !UUID.test(corp.intentie) || !uid) return out(400, 'cerere_invalida')
  // citirile cu JWT-ul omului (aceleași ca ecranul): plicurile, convocările, contactele → corpul + hash-ul fiecărui plic (L19)
  const d = await deps.datePlicuri(ids)
  if (d?.error || !d?.data) return out(503, 'citire_neconfirmata')
  const pregatite = await pregatestePlicuriFan({ ...d.data, proiectCod, subtle: deps.subtle })
  const pePlic = new Map(pregatite.map(p => [p.plic.id, p]))
  const excluseLocal = [], pentruRpc = []
  for (const id of ids) {
    const p = pePlic.get(id)
    if (!p) excluseLocal.push({ plic_id: id, motiv_cod: 'plic_necitibil' })
    else if (!p.ok) excluseLocal.push({ nr_plic: p.plic.nr_plic, motiv_cod: 'date_incomplete', detalii: p.probleme })
    else pentruRpc.push({ plic_id: id, hash: p.hash })
  }
  const hashCerere = await hashCerereFan(ids, deps.subtle)
  if (!pentruRpc.length) return out(200, 'ok', { incheiata: true, replay: false, mod: 'nimic', generate: 0, nimic_de_trimis: true, excluse: excluseLocal, retrase: [], respinse: [], intentie: corp.intentie, hash_cerere: hashCerere })
  // 3. COMANDA (JWT-ul omului): fazele L → V → M în BD; garda completă pe valori (RD032 → 423), marcajul automat în M
  const c = await deps.rpc('fn_red_fan_comanda', { p_lot_id: lot.id, p_intentie: corp.intentie, p_plicuri: pentruRpc, p_hash_cerere: hashCerere })
  if (c?.error) return refuzBd(c.error, 'comanda_neconfirmata')
  const cmd = c?.data
  if (!cmd || typeof cmd !== 'object' || typeof cmd.replay !== 'boolean') return out(503, 'comanda_neconfirmata')
  const baza = { intentie: corp.intentie, hash_cerere: hashCerere, mod: cmd.mod, replay: cmd.replay, excluse: [...excluseLocal, ...(cmd.excluse || [])], retrase: cmd.retrase || [],
    aprobate: Array.isArray(cmd.aprobate) ? cmd.aprobate.length : 0, numarate: cmd.numarate ?? 0, de_aprobat: cmd.de_aprobat ?? 0, cerere_id: cmd.cerere_id ?? null, azi: cmd.azi ?? null, marcaj_automat: cmd.marcaj_automat === true }
  let rezultat = null, incheiata = false, oprit = null, respinse = [], necunoscute = 0, tarifTotal = null, ramase = 0
  const sumarDin = rz => { rezultat = rz || null; incheiata = true; respinse = Array.isArray(rz?.respinse_lista) ? rz.respinse_lista : respinse; tarifTotal = rz?.tarif_total ?? null; ramase = rz?.ramase ?? 0 }
  if (cmd.replay) {
    sumarDin(cmd.rezultat)   // intenția e deja încheiată: nimic de trimis; numerele vin din rândurile recitite mai jos
  } else if (cmd.incheiata) {
    sumarDin(cmd.rezultat)   // încheiată de RPC: toate de_aprobat / excluse / lot complet → nimic de chemat la curier
  } else {
    const deTrimis = Array.isArray(cmd.de_trimis) ? cmd.de_trimis : []
    if (!deTrimis.length) return out(503, 'comanda_neconfirmata', { ...baza })
    // 4. recitirea marcajului (JWT, RLS) → garda COMPLETĂ (cereMarcaj: true) înaintea secretelor; nu poate pica după pasul 3 (altfel e un defect: oprire, nimic plătit)
    const fl = await deps.fanLot(lot.id)
    if (fl?.error) return out(503, 'citire_neconfirmata', { ...baza })
    const g = deps.transportPermisDupaRpc({ proiectCod, fanLot: fl?.data })
    if (!g?.ok) return out(423, g?.cod || 'transport_real_doar_test', { motiv: g?.motiv, ...baza })
    // 5. abia acum secretele curierului → bucla claim → POST → rezultate, cu clientul service_role (clasa B)
    const s = deps.secrete()
    if (!s?.username || !s?.password || !s?.clientId) return out(503, 'transport_neconfigurat', { ...baza })
    const fan = clientFan({ fetch: deps.fetch, secrete: s })
    const r = await deps.randuriLot(lot.id)
    if (r?.error || !Array.isArray(r?.data)) return out(503, 'citire_neconfirmata', { ...baza })
    const surse = await amprenteSurse({ ...d.data, proiectCod, subtle: deps.subtle })
    const randuri = r.data.filter(x => deTrimis.includes(x.id) && x.stare === 'aprobat').sort(comparaPlic)
    const lista = []
    for (const x of randuri) {
      const p = pePlic.get(x.plic_id)
      if (!p || !p.ok || p.hash !== x.hash_date) baza.excluse.push({ nr_plic: x.nr_plic, motiv_cod: 'date_schimbate' })
      else lista.push({ rand: x, shipment: p.shipment, hash: p.hash, surse: surse.get(x.plic_id) })
    }
    const bucati = imparteInBucati(lista, MAX_PE_CERERE)
    let generate = 0, trimise = 0
    for (const [i, b] of bucati.entries()) {
      if (i >= MAX_BUCATI_PE_APEL) { oprit = 'limita_solicitari'; break }
      if (i > 0) await deps.pauza(PAUZA_INTRE_CERERI_MS)
      // L04/L22: pasul durabil ÎNAINTE de bani (clasa B, p_actor = omul verificat din JWT, legat de intenție); refuz = nimic trimis
      const cl = await deps.rpcServer('fn_red_fan_srv_claim', { p_actor: uid, p_intentie: corp.intentie, p_lot_id: lot.id, p_ids: b.map(y => y.rand.id), p_hashuri: b.map(y => y.hash), p_surse: b.map(y => y.surse) })
      if (cl?.error || !cl?.data || typeof cl.data !== 'object') { oprit = 'rezervare_refuzata'; break }
      if (Array.isArray(cl.data.retrase)) baza.retrase.push(...cl.data.retrase)
      const cerere = cl.data.cerere_id
      if (!cerere || !UUID.test(String(cerere))) continue   // toate rândurile bucății au fost retrase (plic anulat / mutat): nimic de trimis
      const retrase = new Set((cl.data.retrase || []).map(x => x.nr_plic))
      const trimisi = b.filter(x => !retrase.has(x.rand.nr_plic))
      const raspuns = await fan.cerere('POST', '/intern-awb', { clientId: s.clientId, shipments: trimisi.map(x => x.shipment) })
      trimise++
      let rez = interpreteazaRaspunsLot(raspuns.status, raspuns.corp, trimisi.length, { referinte: trimisi.map(x => x.rand.nr_plic) })
      // 429 FĂRĂ niciun AWB în răspuns = observația `neincercat` (spec §8.8); BD-ul decide starea după presupunerea P429 (aprobat sau necunoscut)
      const faraAwb = !(Array.isArray(raspuns.corp?.response) && raspuns.corp.response.some(e => e && String(e.awbNumber ?? '').trim()))
      if (raspuns.status === COD_PAUZA_FAN && faraAwb) rez = rez.map(x => ({ stare: OBSERVATIE_NEINCERCAT, motiv: 'HTTP 429: curierul a cerut o pauza' }))
      const w = await deps.rpcServer('fn_red_fan_srv_rezultate', { p_actor: uid, p_intentie: corp.intentie, p_cerere: cerere, p_http: raspuns.status,
        p_rezultate: trimisi.map((x, k) => ({ id: x.rand.id, stare: rez[k].stare, awb: rez[k].awb ?? null, tarif: rez[k].tarif ?? null, tva: rez[k].tva ?? null, motiv: rez[k].motiv ?? null })) })
      if (w?.error) { oprit = 'scriere_neconfirmata'; necunoscute += trimisi.length; break }
      rez.forEach((x, k) => { if (x.stare === 'generat') generate++; else if (x.stare === 'eroare') respinse.push({ nr_plic: trimisi[k].rand.nr_plic, motiv_cod: motivCod(x.motiv) }); else if (x.stare === 'necunoscut') necunoscute++ })
      if (rez.some(y => y.stare === 'necunoscut')) { oprit = 'necunoscut'; break }
      if (raspuns.status === COD_PAUZA_FAN) { oprit = '429'; break }
    }
    ramase = lista.length - bucati.slice(0, trimise).reduce((n, b) => n + b.length, 0)
    // 6. ÎNCHEIEREA intenției, imediat după buclă, oricum s-ar fi oprit ea, ÎNAINTEA etichetelor (clasa B); refuzată cât un rând e in_curs / necunoscut
    const pRez = { oprit: oprit !== null, excluse: baza.excluse.map(x => ({ nr_plic: x.nr_plic ?? null, motiv_cod: x.motiv_cod })), retrase: baza.retrase }
    if (['429', 'limita_solicitari', 'scriere_neconfirmata', 'rezervare_refuzata'].includes(oprit)) pRez.motiv_oprire = oprit
    const inch = await deps.rpcServer('fn_red_fan_srv_intentie_incheie', { p_actor: uid, p_cheie: corp.intentie, p_rezultat: pRez })
    if (inch?.error || !inch?.data || typeof inch.data !== 'object') {
      return out(200, 'ok', { ...baza, incheiata: false, incheiere_neconfirmata: true, generate, respinse, necunoscute, ramase, oprit, tiraj: null, pdf_parti: [] })
    }
    if (inch.data.incheiata === true) sumarDin(inch.data.rezultat)
    else { incheiata = false; necunoscute = Math.max(necunoscute, Number(inch.data.necunoscute) || 0) }
  }
  // 7. etichetele și tirajul, DOAR dacă intenția e încheiată și a generat cel puțin un AWB; BD-ul decide tirajul (RD031 = lot neîncheiat, fără etichete)
  const r2 = await deps.randuriLot(lot.id)
  if (r2?.error || !Array.isArray(r2?.data)) return out(503, 'citire_neconfirmata', { ...baza, incheiata })
  const aleIntentiei = r2.data.filter(x => x.intentie_cheie === corp.intentie)
  const generate = aleIntentiei.filter(x => ['generat', 'ridicat'].includes(x.stare)).length
  if (incheiata && !respinse.length) respinse = aleIntentiei.filter(x => x.stare === 'eroare').map(x => ({ nr_plic: x.nr_plic, motiv_cod: motivCod(x.motiv) }))
  const necun = aleIntentiei.filter(x => ['in_curs', 'necunoscut'].includes(x.stare)).length
  const raspuns = { ...baza, incheiata, generate, respinse, necunoscute: incheiata ? 0 : Math.max(necunoscute, necun), ramase: incheiata ? (rezultat?.ramase ?? aleIntentiei.filter(x => x.stare === 'aprobat').length) : aleIntentiei.filter(x => x.stare === 'aprobat').length,
    oprit, tarif_total: incheiata ? (rezultat?.tarif_total ?? null) : null, nimic_de_trimis: incheiata && generate === 0 && !(rezultat?.de_aprobat > 0), tiraj: null, manifest_cheie: null, pdf_parti: [], etichete_eroare: null }
  if (!incheiata || generate < 1) return out(200, 'ok', raspuns)
  const et = await etichetePentruLot({ lot, randuri: [...r2.data].sort(comparaPlic), deps, out })
  return out(200, 'ok', { ...raspuns, ...et })
}
/** Motivul unui refuz al curierului → codul pentru ecran (spec §8.5): câmpul semnalat (phone / adresa / name) sau necunoscut; fără texte FAN. */
export function motivCod(motiv) {
  const m = String(motiv || '')
  if (/\bphone\b/.test(m)) return 'phone'
  if (/\b(county|locality|street|zipCode)\b/.test(m)) return 'adresa'
  if (/\bname\b/.test(m)) return 'name'
  return 'necunoscut'
}
/** Etichetele TUTUROR părților manifestului pentru răspunsul lui `trimite` (același drum ca acțiunea `eticheta`): tirajul din BD (RD031 = fără etichete),
 *  PDF pe parte, reverificarea tirajului după PDF. Un eșec al etichetelor nu schimbă nimic: AWB-urile există, se recuperează cu `eticheta` / replay. */
async function etichetePentruLot({ lot, randuri, deps, out }) {
  const pl = await deps.plicuriLot(lot.id)
  if (pl?.error || !Array.isArray(pl?.data)) return { etichete_eroare: 'citire_neconfirmata' }
  const m = manifestTiparire({ randuri, plicuri: pl.data })
  if (!m.tiparite.length) return { etichete_eroare: 'nimic_de_tiparit', manifest_cheie: m.cheie }
  const ct = await cheieTiraj(m, deps.subtle)
  const t = await deps.rpc('fn_red_fan_tiraj', { p_inlocuieste: null, p_lot_id: lot.id, p_cheie: ct })
  if (t?.error?.code === 'RD031') return { etichete_eroare: 'lot_neincheiat', manifest_cheie: m.cheie }
  if (refuzTiraj(t?.error)) return { etichete_eroare: refuzTiraj(t.error), manifest_cheie: m.cheie }
  const tiraj = t?.error ? null : tirajDin(t?.data, ct)
  if (!tiraj) return { etichete_eroare: 'tiraj_neconfirmat', manifest_cheie: m.cheie }
  const s = deps.secrete()
  if (!s?.username || !s?.password || !s?.clientId) return { etichete_eroare: 'transport_neconfigurat', manifest_cheie: m.cheie, tiraj }
  const fan = clientFan({ fetch: deps.fetch, secrete: s })
  const parti = partiManifest(m.tiparite), pdf = []
  for (const b of parti) {
    const x = await fan.cerere('GET', caleEticheta({ clientId: s.clientId, awbs: b.map(r => r.awb) }), undefined, { binar: true })
    if (x.status !== 200 || !estePdf(x.bytes)) return { etichete_eroare: 'eticheta_neconfirmata', http: x.status, manifest_cheie: m.cheie, tiraj, pdf_parti: pdf }
    pdf.push(inBase64(x.bytes))
  }
  // reverificarea FINALĂ după PDF-uri (tirajul poate fi fost oprit / înlocuit cât am așteptat curierul): nimic livrat altfel
  const t2 = await deps.rpc('fn_red_fan_tiraj', { p_inlocuieste: null, p_lot_id: lot.id, p_cheie: ct })
  if (refuzTiraj(t2?.error) || t2?.error || !tirajNeschimbat(t2?.data, tiraj)) return { etichete_eroare: refuzTiraj(t2?.error) || 'tiraj_neconfirmat', manifest_cheie: m.cheie, tiraj }
  return { tiraj: { id: tiraj.id, cheie: tiraj.cheie, nr: tiraj.nr, inceput_la: tiraj.inceput_la }, manifest_cheie: m.cheie, pdf_parti: pdf, parti: parti.length,
    pozitii: m.tiparite.map(x => ({ pozitie: x.pozitie, nr_plic: x.nr_plic, awb: x.awb })), ramase_netiparite: m.ramase.map(r => r.nr_plic) }
}

// ── calea detaliată a owner-ului (neschimbată): claim → POST /intern-awb → rezultate, pe RPC-urile vechi cu JWT-ul lui ──
async function genereaza({ lot, randuri, s, fan, deps, out }) {
  const aprobate = randuri.filter(x => x.stare === 'aprobat')
  if (!aprobate.length) return out(409, 'nimic_de_generat')
  const pr = await deps.proiect(lot.proiect_id)
  if (pr?.error || !pr?.data?.cod) return out(503, 'citire_neconfirmata')
  const d = await deps.datePlicuri(aprobate.map(x => x.plic_id))
  if (d?.error || !d?.data) return out(503, 'citire_neconfirmata')
  const pregatite = await pregatestePlicuriFan({ ...d.data, proiectCod: pr.data.cod, subtle: deps.subtle })
  // amprenta SURSELOR din aceleași citiri (Jakarinos #1118 r1): claim-ul o recalculează în BD, în tranzacția rezervării; o schimbare a
  // contactelor între citirea de aici și claim = refuz, nimic plătit
  const surse = await amprenteSurse({ ...d.data, proiectCod: pr.data.cod, subtle: deps.subtle })
  const pePlic = new Map(pregatite.map(p => [p.plic.id, p]))
  const excluse = [], deTrimis = []
  for (const x of aprobate) {
    const p = pePlic.get(x.plic_id)
    if (!p) excluse.push({ nr_plic: x.nr_plic, motiv: 'plicul nu mai e citibil sau activ' })
    else if (!p.ok) excluse.push({ nr_plic: x.nr_plic, motiv: p.probleme.join('; ') })
    else if (p.hash !== x.hash_date) excluse.push({ nr_plic: x.nr_plic, motiv: 'datele s-au schimbat după aprobare (re-propunere + aprobare nouă)' })
    else deTrimis.push({ rand: x, shipment: p.shipment, hash: p.hash, surse: surse.get(x.plic_id) })
  }
  const bucati = imparteInBucati(deTrimis, MAX_PE_CERERE)
  const raport = { generat: 0, eroare: 0, necunoscut: 0, asociere_pe_pozitie: 0 }
  let oprit = null, trimise = 0
  for (const [i, b] of bucati.entries()) {
    if (i >= MAX_BUCATI_PE_APEL) { oprit = 'limita de solicitări pe apăsare; restul se trimite la următorul apăsat'; break }
    if (i > 0) await deps.pauza(PAUZA_INTRE_CERERI_MS)
    // L04/L22: pasul durabil ÎNAINTE de bani. Refuz = nimic trimis; rândurile rămân „aprobat”.
    const c = await deps.rpc('fn_red_fan_claim_lot', { p_lot_id: lot.id, p_ids: b.map(x => x.rand.id), p_hashuri: b.map(x => x.hash), p_surse: b.map(x => x.surse) })
    if (c?.error || typeof c?.data !== 'string' || !UUID.test(c.data)) { oprit = 'rezervarea în BD a fost refuzată sau neconfirmată (date schimbate între timp?); nimic trimis la FAN pentru această bucată'; break }
    const raspuns = await fan.cerere('POST', '/intern-awb', { clientId: s.clientId, shipments: b.map(x => x.shipment) })
    trimise++
    const rez = interpreteazaRaspunsLot(raspuns.status, raspuns.corp, b.length, { referinte: b.map(x => x.rand.nr_plic) })
    const w = await deps.rpc('fn_red_fan_rezultate', { p_cerere: c.data, p_rezultate: b.map((x, k) => ({ id: x.rand.id, stare: rez[k].stare, awb: rez[k].awb ?? null,
      tarif: rez[k].tarif ?? null, tva: rez[k].tva ?? null, motiv: rez[k].motiv ?? null })) })
    if (w?.error) { raport.necunoscut += b.length; oprit = 'rezultatul nu s-a putut scrie: rândurile rămân „în curs”; reconciliază după 10 minute (borderoul zilei)'; break }
    for (const x of rez) { raport[x.stare]++; if (x.stare === 'generat' && x.asociere === 'pozitie') raport.asociere_pe_pozitie++ }
    if (rez.some(x => x.stare === 'necunoscut')) { oprit = 'răspuns FAN neconfirmat: rularea s-a oprit (fără retry automat); reconciliază'; break }
    if (raspuns.status === COD_PAUZA_FAN) { oprit = 'FAN: prea multe solicitări; rularea s-a oprit, se reia de om'; break }
  }
  const ramase = deTrimis.length - bucati.slice(0, trimise).reduce((n, b) => n + b.length, 0)
  return out(200, 'ok', { ...raport, solicitari: trimise, excluse, ramase, oprit })
}
// rezultatul fn_red_fan_urmarire / fn_red_fan_confirmari: { scrise, depasite } cu suma = rândurile trimise (altfel scriere neconfirmată)
const rezScriere = (w, n) => !w?.error && w?.data && typeof w.data === 'object' && Number.isInteger(w.data.scrise) && Number.isInteger(w.data.depasite)
  && w.data.scrise >= 0 && w.data.depasite >= 0 && w.data.scrise + w.data.depasite === n ? w.data : null
// urmărirea (runda 3): { scrise, pastrate, depasite }, suma = rândurile trimise; „păstrate” = răspuns fără cronologie pe un rând cu eveniment cunoscut
const rezUrmarire = (w, n) => !w?.error && w?.data && typeof w.data === 'object' && ['scrise', 'pastrate', 'depasite'].every(k => Number.isInteger(w.data[k]) && w.data[k] >= 0)
  && w.data.scrise + w.data.pastrate + w.data.depasite === n ? w.data : null

// ── urmărire: ≤ 100 AWB-uri pe solicitare; scrie DOAR starea de urmărire (propuneri), nu expedierea. Scrierea = clasa B dacă există rpcServer
// (operator / owner prin funcția edge nouă, p_actor = omul), altfel RPC-ul vechi al owner-ului (același corp în BD, L19). ──
const cuAwb = randuri => randuri.filter(x => ['generat', 'ridicat'].includes(x.stare) && x.awb)
async function urmarire({ lot, randuri, s, fan, deps, uid, out }) {
  const lista = cuAwb(randuri)
  if (!lista.length) return out(409, 'nimic_de_urmarit')
  const stari = {}
  let scrise = 0, pastrate = 0, depasite = 0, necerute = 0
  for (const [i, b] of imparteInBucati(lista).entries()) {
    if (i > 0) await deps.pauza(PAUZA_INTRE_CERERI_MS)
    const awbs = b.map(x => x.awb)
    const x = await fan.cerere('GET', caleListaAwb('/reports/awb/tracking', { clientId: s.clientId, awbs }))
    const u = interpreteazaUrmarire(x.status, x.corp, awbs)
    if (!u.ok) return out(502, 'urmarire_neconfirmata', { motiv: u.motiv, scrise, pastrate, depasite, stari })
    necerute += u.necerute
    // Jakarinos #1118 r1 (L03): fiecare rând poartă versiunea de urmărire CITITĂ la începutul rulării; BD-ul scrie doar dacă e încă aceeași
    // și dacă evenimentul nu e mai vechi decât cel deja scris (altfel „depășit”: o rulare mai nouă a câștigat)
    const p = b.map(r => { const z = u.pe_awb.get(r.awb); stari[z.urmarire_stare] = (stari[z.urmarire_stare] || 0) + 1
      return { id: r.id, awb: r.awb, versiune: r.versiune_urmarire, urmarire_stare: z.urmarire_stare, ultim_eveniment: z.ultim_eveniment, ultim_eveniment_la: z.ultim_eveniment_la,
        ridicat_propus: z.ridicat_propus, livrat_la: z.livrat_la, retur_propus: z.retur_propus } })
    const w = rezUrmarire(await scriereUrmarire(deps, uid, 'urmarire', lot.id, p), p.length)
    if (!w) return out(503, 'scriere_neconfirmata', { scrise, pastrate, depasite, stari })
    scrise += w.scrise; pastrate += w.pastrate; depasite += w.depasite
  }
  return out(200, 'ok', { scrise, pastrate, depasite, stari, necerute })
}
// clasa B (fn_red_fan_srv_urmarire / _confirmari, service_role, p_actor = omul, p_rulare NULL în F1) când funcția edge are clientul server; altfel RPC-ul vechi (owner)
const scriereUrmarire = (deps, uid, ce, lotId, p) => (typeof deps.rpcServer === 'function' && uid
  ? deps.rpcServer(ce === 'urmarire' ? 'fn_red_fan_srv_urmarire' : 'fn_red_fan_srv_confirmari', { p_actor: uid, p_rulare: null, p_lot_id: lotId, p_randuri: p })
  : deps.rpc(ce === 'urmarire' ? 'fn_red_fan_urmarire' : 'fn_red_fan_confirmari', { p_lot_id: lotId, p_randuri: p }))

async function confirmari({ lot, randuri, s, fan, deps, uid, out }) {
  const lista = cuAwb(randuri)
  if (!lista.length) return out(409, 'nimic_de_urmarit')
  const stari = {}
  let scrise = 0, depasite = 0
  for (const [i, b] of imparteInBucati(lista).entries()) {
    if (i > 0) await deps.pauza(PAUZA_INTRE_CERERI_MS)
    const awbs = b.map(x => x.awb)
    const x = await fan.cerere('GET', caleListaAwb('/reports/awb/confirmations', { clientId: s.clientId, awbs, extra: { language: 'ro' } }))
    const c = interpreteazaConfirmari(x.status, x.corp, awbs)
    if (!c.ok) return out(502, 'confirmari_neconfirmate', { motiv: c.motiv, scrise, depasite, stari })
    const p = b.map(r => { const z = c.pe_awb.get(r.awb); stari[z] = (stari[z] || 0) + 1; return { id: r.id, awb: r.awb, versiune: r.versiune_urmarire, confirmare_stare: z } })
    const w = rezScriere(await scriereUrmarire(deps, uid, 'confirmari', lot.id, p), p.length)
    if (!w) return out(503, 'scriere_neconfirmata', { scrise, depasite, stari })
    scrise += w.scrise; depasite += w.depasite
  }
  return out(200, 'ok', { scrise, depasite, stari })
}

// ── etichete: MANIFESTUL COMUN (manifestTiparire, aceeași funcție ca arhiva documentelor din ecran), în părți de ≤ 100, format A6 ──
// Jakarinos #1118 r1 P1: mulțimea și ordinea etichetelor = cele ale documentelor. Ecranul trimite cheia manifestului pe care l-a arătat omului
// (pagina de control); dacă evidența s-a schimbat între timp, cheia diferă → 409, nimic tipărit (L03).
async function eticheta({ corp, lot, randuri, s, fan, deps, out }) {
  if (typeof corp.manifest_cheie !== 'string') return out(400, 'cerere_invalida')
  const pl = await deps.plicuriLot(lot.id)
  if (pl?.error || !Array.isArray(pl?.data)) return out(503, 'citire_neconfirmata')
  const m = manifestTiparire({ randuri, plicuri: pl.data })
  if (!m.tiparite.length) return out(409, 'nimic_de_tiparit', { ramase: m.ramase.map(r => r.nr_plic) })
  if (m.cheie !== corp.manifest_cheie) return out(409, 'manifest_schimbat', { motiv: 'evidența s-a schimbat de la afișare: reîncarcă și verifică din nou pagina de control' })
  const parti = partiManifest(m.tiparite)
  const parte = corp.parte == null ? 1 : corp.parte
  if (!Number.isInteger(parte) || parte < 1 || parte > parti.length) return out(400, 'cerere_invalida')
  // runda 3 (Jakarinos #1118 r2 P1): FIECARE parte cere tirajul lotului cu cheia manifestului din care se construiește (aceeași funcție ca
  // arhiva documentelor din ecran). Primul apel îl începe; altă cheie decât a tirajului început = refuz, nimic cerut de la FAN.
  // F1: începerea cere lotul ÎNCHEIAT (BD: RD031 = „se tipăresc după ce se termină trimiterea”).
  const ct = await cheieTiraj(m, deps.subtle)
  const refuz = r => (refuzTiraj(r?.error) === 'tiraj_oprit' ? out(409, 'tiraj_oprit', { motiv: MESAJ_TIRAJ_OPRIT })
    : refuzTiraj(r?.error) === 'tiraj_schimbat' ? out(409, 'tiraj_schimbat', { motiv: MESAJ_TIRAJ_SCHIMBAT })
    : r?.error?.code === 'RD031' ? out(409, 'lot_neincheiat', { motiv: 'AWB-urile se tipăresc după ce se termină trimiterea lotului' })
    : r?.error?.code === 'RD032' ? out(423, 'transport_real_doar_test') : null)
  const t = await deps.rpc('fn_red_fan_tiraj', { p_lot_id: lot.id, p_cheie: ct, p_inlocuieste: null })
  if (refuz(t)) return refuz(t)
  const tiraj = t?.error ? null : tirajDin(t?.data, ct)
  if (!tiraj) return out(503, 'tiraj_neconfirmat')   // L18: eroare / formă necunoscută ≠ tiraj verificat
  const b = parti[parte - 1]
  const x = await fan.cerere('GET', caleEticheta({ clientId: s.clientId, awbs: b.map(r => r.awb) }), undefined, { binar: true })
  if (x.status !== 200 || !estePdf(x.bytes)) return out(502, 'eticheta_neconfirmata', { http: x.status })
  // runda 4 (Jakarinos #1118 r3 P1): REVERIFICAREA FINALĂ după PDF, înainte de a-l livra — tirajul poate fi fost oprit / înlocuit cât am
  // așteptat FAN-ul. Aceeași cheie ȘI același nr., altfel nimic livrat (PDF-ul aruncat).
  const t2 = await deps.rpc('fn_red_fan_tiraj', { p_lot_id: lot.id, p_cheie: ct, p_inlocuieste: null })
  if (refuz(t2)) return refuz(t2)
  if (t2?.error || !tirajNeschimbat(t2?.data, tiraj)) return out(503, 'tiraj_neconfirmat')
  return out(200, 'ok', { parte, parti: parti.length, nr_plicuri: b.map(r => r.nr_plic), pozitii: b.map(r => r.pozitie), ramase: m.ramase.map(r => r.nr_plic),
    manifest_cheie: m.cheie, tiraj: { id: tiraj.id, cheie: tiraj.cheie, nr: tiraj.nr, inceput_la: tiraj.inceput_la }, pdf_base64: inBase64(x.bytes) })
}

// ── reconciliere: citește borderoul zilei și PROPUNE; „Confirmă: găsit” (F1, spec §8.2) = funcția edge RECITEȘTE borderoul și, doar dacă AWB-ul e acolo
// pentru plicul rândului, îl înscrie prin clasa B (fn_red_fan_srv_reconciliaza) — operatorul nu alege el AWB-ul; absența rămâne a owner-ului. ──
async function reconciliaza({ corp, randuri, s, fan, deps, uid, out }) {
  if (typeof corp.data !== 'string' || !ZI.test(corp.data)) return out(400, 'cerere_invalida')
  const confirma = corp.confirma && typeof corp.confirma === 'object' ? corp.confirma : null
  if (confirma && (typeof confirma.id !== 'string' || !UUID.test(confirma.id))) return out(400, 'cerere_invalida')
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
  const propuneri = lista.map(x => ({ id: x.id, nr_plic: x.nr_plic, stare_rand: x.stare, ...g.get(x.nr_plic) }))
  if (!confirma) return out(200, 'ok', { complet, neinterpretabile: g.neinterpretabile, propuneri })
  const p = propuneri.find(x => x.id === confirma.id)
  if (!p) return out(404, 'tinta_inexistenta')
  if (p.stare !== 'gasit' || !p.awb) return out(409, 'nu_e_gasit_in_borderou', { propunere: p })
  if (!uid || typeof deps.rpcServer !== 'function') return out(503, 'scriere_neconfirmata')
  const w = await deps.rpcServer('fn_red_fan_srv_reconciliaza', { p_actor: uid, p_id: p.id, p_awb: p.awb, p_tarif: null, p_tva: null })
  if (w?.error) return refuzBd(w.error)
  return out(200, 'ok', { confirmat: { id: p.id, nr_plic: p.nr_plic, awb: p.awb, stare: w.data } })
}

// ── anularea unui AWB neridicat, în DOI pași (F1, spec §8.4.1): (1) COMANDA (JWT-ul omului) fn_red_fan_anulare_cere scrie cererea (stare rămâne
// generat); (2) DELETE /awb cu forma de succes strictă; (3) ÎNSCRIEREA (clasa B) fn_red_fan_srv_anuleaza: sters / refuzat_ridicat / ambiguu. ──
async function stergeAwb({ corp, randuri, s, fan, deps, uid, out }) {
  if (typeof corp.rand_id !== 'string' || !UUID.test(corp.rand_id)) return out(400, 'cerere_invalida')
  if (typeof corp.motiv_cod !== 'string' || !MOTIVE_ANULARE.includes(corp.motiv_cod) || (corp.nota != null && typeof corp.nota !== 'string')) return out(400, 'cerere_invalida')
  const x = randuri.find(r => r.id === corp.rand_id)
  if (!x) return out(404, 'tinta_inexistenta')
  if (x.stare !== 'generat' || !x.awb) return out(409, 'doar_awb_generat_neridicat')
  if (!uid || typeof deps.rpcServer !== 'function') return out(503, 'scriere_neconfirmata')
  const cer = await deps.rpc('fn_red_fan_anulare_cere', { p_id: x.id, p_awb: x.awb, p_motiv_cod: corp.motiv_cod, p_nota: corp.nota ?? null })
  if (cer?.error) return cer.error.code === 'RD035' ? out(409, 'anulare_in_curs', { motiv: 'anularea AWB-ului e deja în curs; așteaptă răspunsul curierului' }) : refuzBd(cer.error)
  const q = new URLSearchParams({ clientId: s.clientId, awb: x.awb })
  const d = await fan.cerere('DELETE', '/awb?' + q.toString())
  // Jakarinos #1118 r1 P2: succes DOAR la forma de succes recunoscută; 200 cu eroare / formă necunoscută = AWB păstrat, cererea rămâne deschisă (L05)
  const st = interpreteazaStergere(d.status, d.corp)
  const rezultat = st.rezultat === 'sters' ? 'sters' : st.rezultat === 'refuzat' ? 'refuzat_ridicat' : 'ambiguu'
  const w = await deps.rpcServer('fn_red_fan_srv_anuleaza', { p_actor: uid, p_id: x.id, p_awb: x.awb, p_rezultat: rezultat })
  if (w?.error) return out(503, 'scriere_neconfirmata', { motiv: `răspunsul curierului (${rezultat}) nu s-a putut înscrie; cererea de anulare rămâne deschisă: „Verifică la curier”` })
  if (rezultat === 'ambiguu') return out(503, 'stergere_neconfirmata', { motiv: `${st.motiv}: AWB-ul rămâne „generat”, cererea de anulare rămâne deschisă; „Verifică la curier” o lămurește` })
  if (rezultat === 'refuzat_ridicat') return out(409, 'stergere_refuzata', { http: d.status, motiv: 'curierul a refuzat ștergerea (AWB-ul e deja preluat?); cererea a fost închisă, ridicarea vine la urmărire' })
  return out(200, 'ok', { anulat: x.nr_plic, motiv_cod: corp.motiv_cod })
}
