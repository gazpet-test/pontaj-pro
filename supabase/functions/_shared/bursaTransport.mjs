// bursaTransport.mjs — clientul API BursaTransport (123cargo TMS API, specificația v0.82 din 17.12.2024), FAZA 1: modul izolat, nefolosit încă
// de nicio funcție edge și de niciun ecran. Proiectare: docs/logistica/BURSATRANSPORT_INTEGRARE.md (maparea, fluxul, erorile, fișa a–e).
// Ce face: construiește o „marfă” (load) din datele unei comenzi de transport și o publică / actualizează / retrage / caută prin REST/JSON cu
// HTTP Basic. Toate dependențele (fetch, secretele) sunt injectate: testele rulează pe un server simulat local, fără rețea reală.
// Reguli: L05 — timeout / rețea / 5xx / răspuns de formă necunoscută după o scriere = „necunoscut” (fără retry automat; se reconciliază cu
// cautaMarfaDupaReferinta); L18 — eroare ≠ listă goală; L12 — forma nerecunoscută nu dispare tacit; L13 — id-urile și cookie-ul validate ancorat;
// L10 — secret propriu (BURSATRANSPORT_*), fără fallback. Parola, antetul Authorization și cookie-ul 2-step NU se loghează și nu ajung în rezultate
// (modulul nu scrie nimic în consolă). Răspunsurile bursei sunt DATE (conținut extern): nu declanșează nicio acțiune, doar se raportează.

// URL-urile de bază din specificație (§ „123cargo API specifications”, clienți români). Doar acestea două sunt permise din secrete.
export const URL_TEST = 'https://test.bursatransport.com/api'
export const URL_LIVE = 'https://www.bursatransport.com/api'
export const SECRETE_BURSA = Object.freeze({ user: 'BURSATRANSPORT_USER', parola: 'BURSATRANSPORT_PASSWORD', url: 'BURSATRANSPORT_BASE_URL' })
export const COOKIE_2PASI = 'Bursa-2step-authentication'
export const TIMEOUT_BURSA_MS = 30000
export const LIMITA_PAGINA = 50          // spec: limit maxim 50, implicit 50
export const MAX_PAGINI_CAUTARE = 40     // 40 × 50 = 2000 de mărfuri proprii; peste = căutare incompletă (L12), nu „negăsit”
export const MAX_DESCRIERE = 500         // limita bursei nu e documentată: plafonul nostru, de verificat pe mediul de test
export const MAX_INTERVAL_ZILE = 30      // idem (loadingInterval = zile de disponibilitate de la loadingDate)

// truckType din spec (§ truckType): codul → { denumire, grup }. În requiredTruck[] se combină DOAR tipuri din același grup.
export const TIPURI_CAMION = Object.freeze({
  1: { denumire: 'Box (furgon)', grup: 'A' }, 2: { denumire: 'Tilt (prelată)', grup: 'A' }, 3: { denumire: 'Flat (platformă)', grup: 'A' },
  9: { denumire: 'Oversized (agabaritic)', grup: 'A' }, 10: { denumire: 'Car transporter (auto-transportor)', grup: 'A' }, 5: { denumire: 'Tipper (basculantă)', grup: 'A' },
  6: { denumire: 'Tank (cisternă)', grup: 'B' }, 8: { denumire: 'Liquid food container', grup: 'B' },
  7: { denumire: 'Container', grup: 'C' }, 11: { denumire: 'Tractor Unit (cap tractor)', grup: 'D' },
})
const TIP_AGABARITIC = 9
const TIP_CONTAINER = 7

// Codurile rezultatului (aceleași în client, în viitoarea funcție edge și în ecran — L19). „necunoscut” = nu știm dacă scrierea a avut loc.
export const COD = Object.freeze({
  OK: 'ok', VALIDARE: 'validare', NEAUTORIZAT: 'autentificare_refuzata', API_NEACTIVAT: 'api_neactivat', INTERZIS: 'operatie_interzisa',
  INEXISTENT: 'inexistent', DOI_PASI: 'doi_pasi_necesar', NECUNOSCUT: 'necunoscut', FORMA: 'forma_necunoscuta', CERERE: 'cerere_invalida',
  NECONFIGURAT: 'neconfigurat', URL_NEPERMIS: 'url_nepermis', LIVE_OPRIT: 'live_neactivat',
})
export const MESAJE = Object.freeze({
  [COD.VALIDARE]: 'Bursa a respins marfa: date invalide sau lipsă (vezi lista).',
  [COD.NEAUTORIZAT]: 'Bursa a refuzat contul API (utilizator / parolă). Se verifică secretele, nu se reîncearcă automat.',
  [COD.API_NEACTIVAT]: 'Accesul API nu e activat pe contul firmei la BursaTransport (402).',
  [COD.INTERZIS]: 'Contul nu are voie la această operație pe bursă (403).',
  [COD.INEXISTENT]: 'Marfa nu există (sau nu mai există) pe bursă (404).',
  [COD.DOI_PASI]: 'Bursa cere autentificarea în doi pași (codul primit prin SMS de titularul contului).',
  [COD.NECUNOSCUT]: 'Rezultat necunoscut (timeout / eroare a bursei): nu se reîncearcă; se verifică lista mărfurilor publicate.',
  [COD.FORMA]: 'Răspuns al bursei de formă necunoscută: de verificat de om.',
})

const ID_MARFA = /^BM-[A-Za-z0-9]{1,20}$/               // spec: „BM-xxxxxx”
const ZI_ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const TARA = /^[A-Z]{2}$/
const MONEDE = ['RON', 'EUR', 'USD']
// caractere permise într-o valoare de cookie (RFC 6265 cookie-octet): fără spațiu, ghilimele, virgulă, punct și virgulă, backslash, control
const VALOARE_COOKIE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]{1,4096}$/
const CLASA_CONTROL = '[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']'
const CONTROL_TOATE = new RegExp(CLASA_CONTROL, 'g')   // pentru replace
const ARE_CONTROL = new RegExp(CLASA_CONTROL)          // pentru test (fără 'g': fără lastIndex purtat între apeluri)

const curata = (s, max) => String(s ?? '').replace(CONTROL_TOATE, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max)
const finitPozitiv = x => typeof x === 'number' && Number.isFinite(x) && x > 0

/** Basic auth: base64 pe UTF-8 (btoa singur pică pe diacritice). */
function antetBasic(user, parola) {
  const octeti = new TextEncoder().encode(`${user}:${parola}`)
  let bin = ''
  for (const b of octeti) bin += String.fromCharCode(b)
  return 'Basic ' + btoa(bin)
}

/**
 * Configurația din Edge Secrets. citeste(nume) → valoarea (ex. n => Deno.env.get(n)). URL-ul lipsă = mediul de TEST; altul decât cele două din
 * spec = refuz (secretele nu pleacă spre o adresă oarecare). Mediul LIVE cere permiteLive === true, decis în cod de apelant (în faza 1: nimeni).
 * Rezultatul de refuz nu conține valorile citite. Întoarce { ok: true, config } | { ok: false, cod }.
 */
export function configDinSecrete(citeste, { permiteLive = false } = {}) {
  let user, parola, url
  try { user = citeste(SECRETE_BURSA.user); parola = citeste(SECRETE_BURSA.parola); url = citeste(SECRETE_BURSA.url) } catch { return { ok: false, cod: COD.NECONFIGURAT } }
  if (typeof user !== 'string' || typeof parola !== 'string' || !user.trim() || !parola) return { ok: false, cod: COD.NECONFIGURAT }
  // RFC 7617: user-ul nu poate conține „:”; caracterele de control ar strica antetul
  if (user.includes(':') || ARE_CONTROL.test(user) || ARE_CONTROL.test(parola)) return { ok: false, cod: COD.NECONFIGURAT }
  const baza = (typeof url === 'string' && url.trim() ? url.trim() : URL_TEST).replace(/\/+$/, '')
  if (baza !== URL_TEST && baza !== URL_LIVE) return { ok: false, cod: COD.URL_NEPERMIS }
  if (baza === URL_LIVE && permiteLive !== true) return { ok: false, cod: COD.LIVE_OPRIT }
  return { ok: true, config: { baseUrl: baza, user: user.trim(), parola, mediu: baza === URL_LIVE ? 'live' : 'test' } }
}

/** Erorile de validare ale bursei → [{ camp, mesaj }] (forma nu e documentată în spec: obiect câmp → mesaj/listă, listă sau text).
 *  Textele sunt conținut extern: curățate și tăiate, afișate omului, niciodată interpretate. formaCunoscuta = false → „de verificat de om”. */
export function eroriValidare(r) {
  const out = []
  if (typeof r === 'string' && r.trim()) return { erori: [{ camp: null, mesaj: curata(r, 300) }], formaCunoscuta: true }
  if (Array.isArray(r)) {
    for (const e of r.slice(0, 50)) {
      if (typeof e === 'string') out.push({ camp: null, mesaj: curata(e, 300) })
      else if (e && typeof e === 'object') out.push({ camp: e.field != null ? curata(e.field, 80) : null, mesaj: curata(e.message ?? e.error ?? JSON.stringify(e), 300) })
    }
    return { erori: out, formaCunoscuta: out.length > 0 }
  }
  if (r && typeof r === 'object') {
    for (const [k, v] of Object.entries(r).slice(0, 50)) {
      const lista = Array.isArray(v) ? v : [v]
      for (const m of lista) out.push({ camp: curata(k, 80), mesaj: curata(typeof m === 'string' ? m : JSON.stringify(m), 300) })
    }
    return { erori: out, formaCunoscuta: out.length > 0 }
  }
  return { erori: [], formaCunoscuta: false }
}

/**
 * Status HTTP + corpul JSON → rezultatul clasificat (spec § Responses: { resultCode 0/1, response, availableResults } + codurile HTTP).
 * scriere = true (POST / PUT / DELETE): orice nu e un refuz determinist (4xx) e NECUNOSCUT (L05). Citire: 5xx / rețea = necunoscut, tot fără „gol”.
 */
export function interpreteazaRaspuns(status, corp, { scriere = false } = {}) {
  const necunoscut = motiv => ({ ok: false, cod: COD.NECUNOSCUT, http: status, motiv })
  if (!Number.isInteger(status) || status === 0) return necunoscut('fără răspuns (rețea / timeout)')
  if (status === 401) return { ok: false, cod: COD.NEAUTORIZAT, http: 401 }
  if (status === 402) return { ok: false, cod: COD.API_NEACTIVAT, http: 402 }
  if (status === 403) return { ok: false, cod: COD.INTERZIS, http: 403 }
  if (status === 404) return { ok: false, cod: COD.INEXISTENT, http: 404 }
  if (status === 409) return { ok: false, cod: COD.DOI_PASI, http: 409 }
  const plic = corp && typeof corp === 'object' && !Array.isArray(corp) && (corp.resultCode === 0 || corp.resultCode === 1) ? corp : null
  if (status === 400) {
    const v = eroriValidare(plic ? plic.response : corp)
    return { ok: false, cod: COD.VALIDARE, http: 400, erori: v.erori, forma_cunoscuta: v.formaCunoscuta }
  }
  if (status >= 500) return necunoscut('eroare a bursei (5xx)')
  if (status !== 200 || !plic) return scriere ? necunoscut('formă necunoscută') : { ok: false, cod: COD.FORMA, http: status }
  if (plic.resultCode === 1) {
    // 200 cu resultCode = 1: spec spune „validation errors in case of error” fără să fixeze statusul → refuz cu motive DOAR dacă le recunoaștem
    const v = eroriValidare(plic.response)
    if (!v.formaCunoscuta) return scriere ? necunoscut('eroare fără motive recunoscute') : { ok: false, cod: COD.FORMA, http: status }
    return { ok: false, cod: COD.VALIDARE, http: status, erori: v.erori, forma_cunoscuta: true }
  }
  return { ok: true, cod: COD.OK, http: 200, date: plic.response, disponibile: Number.isInteger(plic.availableResults) ? plic.availableResults : null }
}

/** Marfa din răspunsul unui POST / PUT: obiectul load cu id valid „BM-…”; altfel null (rezultat necunoscut pentru apelant). */
export function marfaDinRaspuns(date) {
  const m = Array.isArray(date) && date.length === 1 ? date[0] : date
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null
  const id = typeof m.id === 'string' ? m.id.trim() : ''
  return ID_MARFA.test(id) ? { ...m, id } : null
}
/** Lista din GET /loads: spec — „array with load type elements indexed by the load.id property” (deci obiect id → load SAU listă). null = formă necunoscută. */
export function listaMarfuri(date) {
  if (Array.isArray(date)) return date.filter(x => x && typeof x === 'object')
  if (date && typeof date === 'object') return Object.values(date).filter(x => x && typeof x === 'object')
  if (date === null || date === '') return []   // „response” gol pe o pagină fără rezultate
  return null
}

/**
 * Clientul HTTP. config = { baseUrl, user, parola } (din configDinSecrete sau, în teste, adresa serverului simulat); cookie2Pasi = valoarea
 * cookie-ului de autentificare în doi pași, dacă există. Fără redirect-uri urmate (antetul Authorization nu pleacă spre altă adresă: 3xx =
 * formă necunoscută). Fără retry. Obiectul întors NU expune parola / cookie-ul.
 */
export function clientBursa({ config, fetch, cookie2Pasi = null, timeoutMs = TIMEOUT_BURSA_MS }) {
  if (!config || typeof config.baseUrl !== 'string' || typeof config.user !== 'string' || typeof config.parola !== 'string' || typeof fetch !== 'function') {
    throw new Error('clientBursa: configurație incompletă')
  }
  const baza = config.baseUrl.replace(/\/+$/, '')
  const autorizare = antetBasic(config.user, config.parola)
  let cookie = typeof cookie2Pasi === 'string' && VALOARE_COOKIE.test(cookie2Pasi) ? cookie2Pasi : null

  async function apel(method, cale, corp) {
    const headers = { Accept: 'application/json', Authorization: autorizare }
    if (corp !== undefined) headers['Content-Type'] = 'application/json'
    if (cookie) headers.Cookie = `${COOKIE_2PASI}=${cookie}`
    try {
      const res = await fetch(baza + cale, { method, headers, body: corp === undefined ? undefined : JSON.stringify(corp), redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
      let c = null
      try { c = await res.json() } catch { c = null }
      return { status: res.status, corp: c, antete: res.headers }
    } catch { return { status: 0, corp: null, antete: null } }   // rețea / timeout / abort: NECUNOSCUT, nu eroare deterministă
  }
  const scrie = async (method, cale, corp) => { const r = await apel(method, cale, corp); return interpreteazaRaspuns(r.status, r.corp, { scriere: true }) }
  const idValid = id => typeof id === 'string' && ID_MARFA.test(id)
  async function paginaMarfuri({ limit = LIMITA_PAGINA, offset = 0 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > LIMITA_PAGINA || !Number.isInteger(offset) || offset < 0) return { ok: false, cod: COD.CERERE }
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    const x = await apel('GET', '/loads?' + q.toString())
    const r = interpreteazaRaspuns(x.status, x.corp)
    if (!r.ok) return r
    const lista = listaMarfuri(r.date)
    return lista ? { ok: true, cod: COD.OK, marfuri: lista, disponibile: r.disponibile } : { ok: false, cod: COD.FORMA, http: r.http }
  }

  return {
    mediu: baza === URL_LIVE ? 'live' : baza === URL_TEST ? 'test' : 'simulat',
    are2Pasi: () => cookie !== null,

    /** POST /loads. Succes DOAR cu marfa întoarsă și id „BM-…”; 200 fără id = necunoscut (marfa poate exista: se caută după referință). */
    async publicaMarfa(load) {
      if (!load || typeof load !== 'object') return { ok: false, cod: COD.CERERE }
      const r = await scrie('POST', '/loads', load)
      if (!r.ok) return r
      const m = marfaDinRaspuns(r.date)
      return m ? { ok: true, cod: COD.OK, id: m.id, marfa: m } : { ok: false, cod: COD.NECUNOSCUT, http: r.http, motiv: 'răspuns fără id de marfă' }
    },
    /** PUT /loads/<ID>: corpul = marfa completă (spec). */
    async actualizeazaMarfa(id, load) {
      if (!idValid(id) || !load || typeof load !== 'object') return { ok: false, cod: COD.CERERE }
      const r = await scrie('PUT', '/loads/' + id, load)
      if (!r.ok) return r
      const m = marfaDinRaspuns(r.date)
      return m && m.id === id ? { ok: true, cod: COD.OK, id, marfa: m } : { ok: false, cod: COD.NECUNOSCUT, http: r.http, motiv: 'răspuns fără marfa actualizată' }
    },
    /** DELETE /loads/<ID>. 404 rămâne „inexistent” (apelantul verifică lista înainte să declare marfa retrasă). */
    async retrageMarfa(id) {
      if (!idValid(id)) return { ok: false, cod: COD.CERERE }
      const r = await scrie('DELETE', '/loads/' + id)
      return r.ok ? { ok: true, cod: COD.OK, id } : r
    },
    /** GET /loads?limit&offset — o pagină din mărfurile proprii. */
    paginaMarfuri,
    /**
     * Reconcilierea după un rezultat necunoscut (L05): caută printre mărfurile proprii pe externalReference (= id-ul comenzii) SAU pe marcajul din
     * privateNotice (egalitate exactă după trim, nu subșir: „ERP CT-1” nu găsește „ERP CT-12”, L11). Pagini până la pagina goală (nu „mai puțin
     * de 50”, L23); peste MAX_PAGINI_CAUTARE = complet: false (nu „negăsit”, L12). Întoarce { ok, gasite, complet } | eroarea paginii (L18).
     */
    async cautaMarfaDupaReferinta({ referinta = null, marcaj = null } = {}) {
      const ref = Number.isSafeInteger(referinta) && referinta > 0 ? referinta : null
      const mrc = typeof marcaj === 'string' && marcaj.trim() ? marcaj.trim() : null
      if (ref === null && mrc === null) return { ok: false, cod: COD.CERERE }
      const gasite = []
      for (let p = 0; p < MAX_PAGINI_CAUTARE; p++) {
        const r = await paginaMarfuri({ limit: LIMITA_PAGINA, offset: p * LIMITA_PAGINA })
        if (!r.ok) return r
        if (!r.marfuri.length) return { ok: true, cod: COD.OK, gasite, complet: true }
        for (const m of r.marfuri) {
          const peRef = ref !== null && m.externalReference != null && String(m.externalReference).trim() === String(ref)
          const peMarcaj = mrc !== null && typeof m.privateNotice === 'string' && m.privateNotice.trim() === mrc
          if ((peRef || peMarcaj) && typeof m.id === 'string' && ID_MARFA.test(m.id)) gasite.push(m)
        }
      }
      return { ok: true, cod: COD.OK, gasite, complet: false }
    },
    /** POST /places: localitatea pe care o va alege bursa pentru un loc (arătată omului ÎNAINTE de publicare). */
    async cautaLocalitate(loc) {
      if (!loc || typeof loc !== 'object') return { ok: false, cod: COD.CERERE }
      const x = await apel('POST', '/places', loc)
      const r = interpreteazaRaspuns(x.status, x.corp)
      if (!r.ok) return r
      const d = Array.isArray(r.date) ? r.date[0] : r.date
      if (!d || typeof d !== 'object' || typeof d.name !== 'string' || !d.name.trim() || typeof d.country !== 'string') return { ok: false, cod: COD.FORMA, http: r.http }
      return { ok: true, cod: COD.OK, loc: { id: Number.isInteger(d.id) ? d.id : null, name: curata(d.name, 120), country: curata(d.country, 2), lat: d.lat ?? null, lng: d.lng ?? null, postalCode: d.postalCode ?? null } }
    },
    /**
     * Autentificarea în doi pași (spec § 2step): codul primit prin SMS de TITULARUL contului, trimis ca parametrul `code` la login/login.
     * Cookie-ul vine din Set-Cookie (numele exact) sau din corp (forma nu e documentată: string sau { Bursa-2step-authentication }).
     * Întoarce { ok, cookie } — valoarea o păstrează apelantul (faza 2: unde, vezi documentul); clientul o folosește de acum în cereri.
     */
    async confirma2Pasi(cod) {
      if (typeof cod !== 'string' || !/^[0-9A-Za-z]{4,12}$/.test(cod)) return { ok: false, cod: COD.CERERE }
      const x = await apel('POST', '/login/login', { code: cod })
      if (x.status !== 200) return interpreteazaRaspuns(x.status, x.corp)
      if (x.corp && x.corp.resultCode === 1) return { ok: false, cod: COD.VALIDARE, http: 200, erori: eroriValidare(x.corp.response).erori }   // cod greșit / expirat
      let v = null
      const sc = typeof x.antete?.getSetCookie === 'function' ? x.antete.getSetCookie() : [x.antete?.get?.('set-cookie')].filter(Boolean)
      for (const linie of sc) {
        const m = new RegExp('^' + COOKIE_2PASI + '=([^;]*)').exec(String(linie).trim())
        if (m) v = m[1]
      }
      if (v == null && x.corp && x.corp.resultCode === 0) {
        const rsp = x.corp.response
        v = typeof rsp === 'string' ? rsp : rsp && typeof rsp === 'object' ? rsp[COOKIE_2PASI] ?? null : null
      }
      if (typeof v !== 'string' || !VALOARE_COOKIE.test(v)) return { ok: false, cod: COD.FORMA, http: 200 }
      cookie = v
      return { ok: true, cod: COD.OK, cookie: v }
    },
    toJSON: () => ({ client: 'bursaTransport', mediu: baza === URL_LIVE ? 'live' : baza === URL_TEST ? 'test' : 'simulat' }),
  }
}

/** 'YYYY-MM-DD' (zi reală) → 'DD-MM-YYYY' (formatul datelor din spec); altfel null. Fără new Date('YYYY-MM-DD') (L17). */
export function dataBursa(zi) {
  const m = typeof zi === 'string' ? ZI_ISO.exec(zi) : null
  if (!m) return null
  const [a, l, z] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(a, l - 1, z))
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== l - 1 || d.getUTCDate() !== z) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

/** Un loc de încărcare / descărcare → obiectul place (spec § place): coordonate (lat/lng) SAU localitate + țară; țara obligatorie. */
export function locBursa(loc) {
  if (!loc || typeof loc !== 'object') return null
  const tara = typeof loc.tara === 'string' ? loc.tara.trim().toUpperCase() : 'RO'
  if (!TARA.test(tara)) return null
  if (Number.isInteger(loc.id_bursa) && loc.id_bursa > 0) return { id: loc.id_bursa, country: tara }
  const lat = loc.lat, lng = loc.lng
  if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
    return { lat, lng, country: tara }
  }
  const nume = curata(loc.localitate, 120)
  return nume ? { name: nume, country: tara } : null
}

/**
 * Marfa (load) dintr-o comandă de transport NORMALIZATĂ (adaptorul din coloanele ERP se scrie în faza 2, după verificarea coloanelor reale).
 * m = { id_comanda (int, → externalReference), numar_comanda (text, → marcajul din privateNotice), plecare, destinatie (vezi locBursa),
 *       data_incarcare 'YYYY-MM-DD', interval_zile (int), tipuri_camion [cod truckType], linii: [{ denumire, cantitate, greutate_kg (TOTAL pe linie),
 *       lungime_m, latime_m, inaltime_m, adr, agabaritic }], descriere (publică, scrisă / aprobată de om), pret { valoare, moneda, tva }, grupaj }
 * azi = ziua curentă la București 'YYYY-MM-DD' (apelantul o calculează; data încărcării nu poate fi în trecut).
 * Întoarce { ok, load, probleme: [cod…], avertismente: [cod…], marcaj }. Probleme = marfa NU se publică; avertismente = se arată omului.
 */
export function construiesteMarfa(m, { azi } = {}) {
  const probleme = [], avertismente = []
  const load = {}
  if (!m || typeof m !== 'object') return { ok: false, load: null, probleme: ['comanda_lipsa'], avertismente, marcaj: null }
  const numar = curata(m.numar_comanda, 40)
  const marcaj = numar ? `ERP ${numar}` : null
  if (Number.isSafeInteger(m.id_comanda) && m.id_comanda > 0) load.externalReference = m.id_comanda
  else avertismente.push('fara_referinta_externa')
  if (!marcaj) probleme.push('numar_comanda')

  const src = locBursa(m.plecare), dst = locBursa(m.destinatie)
  if (!src) probleme.push('loc_plecare'); else load.source = src
  if (!dst) probleme.push('loc_destinatie'); else load.destination = dst

  const zi = dataBursa(m.data_incarcare)
  if (!zi) probleme.push('data_incarcare')
  else if (typeof azi !== 'string' || !dataBursa(azi)) probleme.push('azi_lipsa')
  else if (m.data_incarcare < azi) probleme.push('data_in_trecut')
  else load.loadingDate = zi
  if (!Number.isInteger(m.interval_zile) || m.interval_zile < 0 || m.interval_zile > MAX_INTERVAL_ZILE) probleme.push('interval_zile')
  else load.loadingInterval = m.interval_zile

  const tipuri = Array.isArray(m.tipuri_camion) ? [...new Set(m.tipuri_camion)] : []
  if (!tipuri.length || tipuri.some(t => !TIPURI_CAMION[t])) probleme.push('tip_camion')
  else if (new Set(tipuri.map(t => TIPURI_CAMION[t].grup)).size !== 1) probleme.push('tipuri_camion_grupuri_diferite')
  else load.requiredTruck = tipuri

  const linii = Array.isArray(m.linii) ? m.linii : []
  if (!linii.length) probleme.push('linii_lipsa')
  let greutate = 0, volum = 0, volumComplet = linii.length > 0, lungime = 0
  for (const l of linii) {
    if (!l || !finitPozitiv(l.greutate_kg)) { probleme.push('greutate_linie'); greutate = NaN; continue }
    greutate += l.greutate_kg
    const cant = l.cantitate == null ? 1 : l.cantitate
    if (finitPozitiv(l.lungime_m) && finitPozitiv(l.latime_m) && finitPozitiv(l.inaltime_m) && finitPozitiv(cant)) volum += l.lungime_m * l.latime_m * l.inaltime_m * cant
    else volumComplet = false
    if (finitPozitiv(l.lungime_m)) lungime = Math.max(lungime, l.lungime_m)
  }
  if (Number.isFinite(greutate) && greutate > 0) load.weight = Math.round(greutate * 100) / 100
  else if (!probleme.includes('greutate_linie') && linii.length) probleme.push('greutate')
  // volumul și lungimea sunt opționale (N): se trimit doar calculate din TOATE liniile (volum) / din dimensiunile cunoscute (lungime)
  if (volumComplet && volum > 0) load.volume = Math.round(volum * 1000) / 1000
  else if (linii.length) avertismente.push('volum_necalculat')
  if (lungime > 0) load.length = Math.round(lungime * 100) / 100

  load.hazardous = linii.some(l => l?.adr === true)
  load.temperatureControlled = false
  if (linii.some(l => l?.agabaritic === true) && load.requiredTruck && !load.requiredTruck.includes(TIP_AGABARITIC)) avertismente.push('agabaritic_fara_tip_oversized')
  if (load.requiredTruck?.includes(TIP_CONTAINER)) avertismente.push('container_fara_marime')
  if (m.grupaj === true) load.groupage = true

  const descriere = curata(m.descriere, MAX_DESCRIERE + 1)
  if (!descriere) probleme.push('descriere')
  else if (descriere.length > MAX_DESCRIERE) probleme.push('descriere_prea_lunga')
  else load.description = descriere
  if (marcaj) load.privateNotice = marcaj

  if (m.pret != null) {
    const p = m.pret
    if (!p || !finitPozitiv(p.valoare) || !MONEDE.includes(p.moneda) || typeof p.tva !== 'boolean') probleme.push('pret')
    else load.offeredPrice = { price: p.valoare, currency: p.moneda, vat: p.tva }
  }
  const ok = probleme.length === 0
  return { ok, load: ok ? load : null, probleme: [...new Set(probleme)], avertismente: [...new Set(avertismente)], marcaj }
}
