// redariFanUrmarireAuto.mjs — rularea AUTOMATĂ a urmăririi AWB-urilor FAN (Redări), pornită de cron (x-intern-secret) sau de owner.
// Decizia owner-ului (21.11.2026): urmărirea se actualizează singură, nu doar la butonul „Urmărire”. Migrarea: 20270102a (NEAPLICATĂ).
// Ce face o rulare: (1) revendică rularea în BD (fn_red_fan_srv_rulare_incepe: una singură odată, o dată pe slot de cron); (2) citește din BD
// lista AWB-urilor de urmărit (fn_red_fan_srv_de_urmarit: generat / ridicat, cu AWB, nelivrate, fără retur, mai noi de 60 de zile, pe loturile
// permise de garda „doar TEST”, cele mai vechi urmărite primele); (3) pe fiecare lot, EXACT logica butonului (urmaresteLot din
// redariFanTransport.mjs, L19): GET /reports/awb/tracking în bucăți de ≤ 100, pauză 2 s, interpretarea comună (rezumatUrmarireFan), scrierea
// prin fn_red_fan_srv_urmarire cu p_rulare (CAS pe versiune); (4) închide rularea cu numerele (fn_red_fan_srv_rulare_incheie, jurnal în red_jurnal).
// Runda 2 #1155 (decizia owner-ului 21.11.2026, „la 2000 de oameni mergem pe ce livrează API-ul”): faptele raportate de curier (ridicarea C0,
// livrarea S2, returul) se înregistrează AUTOMAT ca fapte în evidența FAN, după regula deterministă din rezumatUrmarireFan + corpul din BD;
// pe loturile de TEST ridicarea trece rândul în „ridicat” (fără confirmarea omului), pe plic nu se scrie nimic. Contradicțiile nu mai blochează:
// se rezolvă după regulă și rămân DURABIL în red_fan_contradictii (valorile, regula, rularea), ca listă de audit.
// Fișa a–e (CLAUDE.md pct. 7): (a) citește DOAR răspunsul FAN la urmărire (date: coduri pe listă albă, AWB numeric, date de formă fixă);
// (b) scrie DOAR câmpurile de urmărire + starea „ridicat” (lot de TEST) din red_fan_awb, semnalele din red_fan_contradictii, rularea în
// red_fan_rulari și jurnalul; NU generează, NU trimite, NU anulează, NU șterge, NU tipărește, NU scrie pe plic, NU trimite mail / SMS;
// (c) service_role, DOAR pentru RPC-urile clasei B din lista închisă RPC_RULARE (EXECUTE exclusiv service_role în BD); (d) cronul cu
// x-intern-secret sau owner-ul logat (cronSauOwner, în funcția edge); (e) rămân la om: AR-ul, returul pe plic, expedierea pe plicul unui lot
// real (D4 / F4), codurile nelimpezi („de verificat”), corectarea manuală a unui plic anume.
// Apărare în adâncime: (1) clientul FAN al rulării primește un fetch care lasă să treacă DOAR POST /login și GET /reports/awb/tracking — orice
// altă cale (POST /intern-awb, DELETE /awb, etichete, confirmări, borderou) e refuzată local, nimic trimis, rularea se oprește „apel_interzis”;
// (2) RPC-urile sunt pe listă albă (altul = refuz local, nimic chemat); (3) plafonul de apeluri e impus în BD ÎNAINTEA fiecărui GET
// (fn_red_fan_srv_rulare_apel, contor CAS) și local, de clientul FAN însuși, deci și pe reluarea de după 401; (4) bugetul de timp al rulării;
// (5) oprire la prima eroare a curierului (429 / 5xx / timeout / forma necunoscută a întregului răspuns, L05: fără reîncercare în aceeași
// rulare; rularea următoare reia).
import { TRANSPORT_REAL_ACTIV, transportPermis } from './redariFanHandler.mjs'
import { clientFan, urmaresteLot, PAUZA_INTRE_CERERI_MS } from './redariFanTransport.mjs'
import { URL_FAN } from './redariFan.mjs'

// plafonul de solicitări FAN pe rulare (= 2.000 de AWB-uri); ACEEAȘI valoare e în BD (red_fan_rulari.plafon_apeluri, pusă de
// fn_red_fan_srv_rulare_incepe) — paritatea o verifică testul. Bugetul de timp: sub limita de execuție a funcțiilor edge (150 s).
export const PLAFON_APELURI_RULARE = 20
export const BUGET_RULARE_MS = 100000
export const RPC_RULARE = Object.freeze(['fn_red_fan_srv_rulare_incepe', 'fn_red_fan_srv_de_urmarit', 'fn_red_fan_srv_rulare_apel', 'fn_red_fan_srv_urmarire', 'fn_red_fan_srv_rulare_incheie'])
// singurele apeluri către curier permise unei rulări automate (metoda + calea exactă)
export const APELURI_FAN_RULARE = Object.freeze([['POST', '/login'], ['GET', '/reports/awb/tracking']])
// refuzuri DETERMINISTE ale scrierii pe un lot (rând schimbat între selecție și scriere, lot ieșit din gardă, payload refuzat): lotul se sare,
// rularea continuă; orice altă eroare (rețea, 5xx, necunoscut) oprește rularea (L05 / L18)
const REFUZ_LOT = ['P0001', 'RD032', '22023']
const PLAFON_ATINS = ['RD040', 'plafon_local', 'buget_timp']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Calea unui apel către curier, dacă e permisă unei rulări automate; altfel null. Compară origin + pathname exact (fără prefixe / sufixe). */
export function apelFanPermis(url, method) {
  let u
  try { u = new URL(String(url)) } catch { return null }
  const baza = new URL(URL_FAN)
  if (u.origin !== baza.origin) return null
  const cale = u.pathname.slice(baza.pathname.replace(/\/$/, '').length) || '/'
  const m = String(method || 'GET').toUpperCase()
  return APELURI_FAN_RULARE.some(([mm, cc]) => mm === m && cc === cale) ? cale : null
}

/**
 * O rulare automată. apelant = { sursa: 'cron' | 'owner', actor: uuid | null } (din poarta funcției edge: cronSauOwner + JWT-ul verificat);
 * orice altceva = 401, nimic chemat. deps: { rpcServer(nume, args) → {data,error} (service_role), secrete() → {username,password,clientId},
 * fetch(url, init), pauza(ms), acum() → ms }. Întoarce { status, body } — corpul are DOAR numere și coduri (îl păstrează pg_net).
 */
export async function ruleazaUrmarireAuto(apelant, deps) {
  const out = (status, cod, extra = {}) => ({ status, body: { cod, ...extra } })
  const sursa = apelant?.sursa
  if (!['cron', 'owner'].includes(sursa)) return out(401, 'neautorizat')
  if (sursa === 'owner' && !(typeof apelant.actor === 'string' && UUID.test(apelant.actor))) return out(401, 'neautorizat')
  if (!TRANSPORT_REAL_ACTIV) return out(423, 'transport_real_oprit')
  const rpc = (nume, args) => (RPC_RULARE.includes(nume) ? deps.rpcServer(nume, args) : Promise.resolve({ error: { code: 'rpc_interzis' } }))

  // 1. revendicarea rulării (BD: lock + o singură rulare în curs + slotul zilei; rularea expirată se închide „expirata”)
  const st = await rpc('fn_red_fan_srv_rulare_incepe', { p_sursa: sursa, p_actor: sursa === 'owner' ? apelant.actor : null })
  if (st?.error) return out(503, 'rulare_neconfirmata', { cod_bd: st.error.code ?? null })
  const d0 = st?.data
  if (d0 && typeof d0 === 'object' && d0.ocupat === true) return out(200, 'rulare_ocupata', { motiv: typeof d0.motiv === 'string' ? d0.motiv : null })
  const rulare = d0?.rulare_id
  const plafon = d0?.plafon_apeluri
  if (typeof rulare !== 'string' || !UUID.test(rulare) || !Number.isInteger(plafon) || plafon < 1 || plafon > PLAFON_APELURI_RULARE) {
    return out(503, 'rulare_neconfirmata', { cod_bd: null })
  }
  const t0 = deps.acum()
  let loturi = 0, sarite = 0, apeluri = 0, interzis = false
  const stari = {}
  const incheie = async (stare, cod) => {
    // codul de eroare are forma fixă din BD (^[a-z0-9_]{1,60}$): fără texte ale curierului, fără date personale
    const eroareCod = cod == null ? null : String(cod).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 60) || 'necunoscut'
    const r = await rpc('fn_red_fan_srv_rulare_incheie', { p_rulare: rulare, p_stare: stare, p_eroare_cod: eroareCod, p_loturi: loturi, p_loturi_sarite: sarite })
    const z = r?.data
    if (r?.error || !z || typeof z !== 'object') return out(503, 'incheiere_neconfirmata', { rulare, stare_ceruta: stare, eroare_cod: eroareCod, cod_bd: r?.error?.code ?? null })
    return out(200, stare === 'incheiata' ? 'ok' : 'oprita', { rulare, stare: z.stare ?? stare, eroare_cod: z.eroare_cod ?? eroareCod, apeluri: z.apeluri ?? apeluri,
      randuri: z.randuri ?? null, scrise: z.scrise ?? null, pastrate: z.pastrate ?? null, depasite: z.depasite ?? null,
      contradictii: z.contradictii ?? null, ridicari: z.ridicari ?? null, loturi, loturi_sarite: sarite, stari })
  }

  // 2. ce e de urmărit: o singură definiție, în BD (L19); forma necunoscută = oprire, nimic cerut curierului (L18)
  const sel = await rpc('fn_red_fan_srv_de_urmarit', { p_rulare: rulare })
  const lista = sel?.data?.loturi
  if (sel?.error || !Array.isArray(lista)) return incheie('oprita_eroare', 'selectie_neconfirmata')
  const deUrmarit = []
  for (const l of lista) {
    const ok = l && typeof l === 'object' && typeof l.lot_id === 'string' && UUID.test(l.lot_id) && Array.isArray(l.randuri) && l.randuri.length > 0
    // garda „doar TEST” și în cod (aceeași funcție ca butonul, L19): BD-ul filtrează deja cu fn_red_fan_lot_permis; o nepotrivire = lot sărit
    if (ok && transportPermis({ proiectCod: l.proiect_cod ?? null, fanLot: { test: l.test === true }, cereMarcaj: true }).ok) deUrmarit.push(l)
    else sarite++
  }
  if (!deUrmarit.length) return incheie('incheiata', null)

  // 3. secretele curierului: abia acum (după poartă, revendicare și selecție)
  const s = deps.secrete()
  if (!s?.username || !s?.password || !s?.clientId) return incheie('oprita_eroare', 'transport_neconfigurat')
  const fetchRulare = (url, init = {}) => {
    if (!apelFanPermis(url, init.method)) { interzis = true; return Promise.reject(new Error('apel interzis rularii automate')) }
    return deps.fetch(url, init)
  }
  // pasul plafonului înaintea FIECĂRUI GET efectiv, inclusiv reluarea clientului după 401 (runda 2 #1155, Jakarinos P2): bugetul de timp, plafonul
  // local, apoi pasul durabil din BD (contor CAS). Clientul îl cheamă el însuși, deci o reluare nu-l poate ocoli.
  const inainteDeApel = async () => {
    if (deps.acum() - t0 > BUGET_RULARE_MS) return { ok: false, cod: 'buget_timp' }
    if (apeluri >= plafon) return { ok: false, cod: 'plafon_local' }
    const r = await rpc('fn_red_fan_srv_rulare_apel', { p_rulare: rulare })
    if (r?.error) return { ok: false, cod: r.error.code || 'apel_neconfirmat' }
    if (!Number.isInteger(r?.data) || r.data !== apeluri + 1) return { ok: false, cod: 'apel_neconfirmat' }
    apeluri++
    return { ok: true }
  }
  const fan = clientFan({ fetch: fetchRulare, secrete: s, inainteDeApel, pauza: deps.pauza })
  const depsLot = { rpcServer: rpc, pauza: deps.pauza }
  try {
    for (const [i, l] of deUrmarit.entries()) {
      if (i > 0) await deps.pauza(PAUZA_INTRE_CERERI_MS)
      const r = await urmaresteLot({ lot: { id: l.lot_id }, randuri: l.randuri, s, fan, deps: depsLot, rulare, out })
      const b = r.body || {}
      for (const [k, v] of Object.entries(b.stari || {})) stari[k] = (stari[k] || 0) + v
      if (r.status === 200) { loturi++; continue }
      if (r.status === 409 && b.cod === 'nimic_de_urmarit') { sarite++; continue }
      if (r.status === 423 && b.cod === 'apel_refuzat') return incheie(PLAFON_ATINS.includes(b.cod_bd) ? 'oprita_plafon' : 'oprita_eroare', String(b.cod_bd || 'apel_neconfirmat'))
      // eroarea curierului / forma necunoscută a ÎNTREGULUI răspuns (runda 2, P2): oprire, nimic scris din bucata respectivă (L05 / L13)
      if (r.status === 502) return incheie('oprita_eroare', interzis ? 'apel_interzis' : b.cod === 'urmarire_forma_necunoscuta' ? 'fan_forma_necunoscuta'
        : Number.isInteger(b.http) && b.http > 0 ? `fan_http_${b.http}` : 'fan_neconfirmat')
      if (r.status === 503 && REFUZ_LOT.includes(b.cod_bd)) { sarite++; continue }
      return incheie('oprita_eroare', 'scriere_neconfirmata')
    }
  } catch (e) {
    return incheie('oprita_eroare', e?.codFan === 'autentificare_fan_neconfirmata' ? (interzis ? 'apel_interzis' : 'autentificare_fan') : 'eroare_neasteptata')
  }
  return incheie('incheiata', null)
}
