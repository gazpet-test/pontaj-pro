// redariFanHandler.mjs — handler testabil pentru funcția edge redari-fan-awb (FAN Courier), fără rețea implicită.
// Proiectare: docs/redari/FANCOURIER_INTEGRARE.md §3–§5 + docs/redari/FAN_FLUX_OPERATOR_SPEC.md §7, §8 (F1). Fișa a–e: INTEGRARE §4. NU acceptă
// identitate sau rol din corp (L08).
// ACTIVARE pentru Testul 1 (docs/redari/FAN_TEST1_PASI.md): TRANSPORT_REAL_ACTIV = true, DAR cu garda DOAR_PROIECTE_TEST = true: calea reală
// (redariFanTransport.mjs) se atinge DOAR pe un lot al unui proiect de TEST (red_proiecte.cod începe cu „TEST-”) ȘI marcat TEST (red_fan_loturi.test).
// Orice alt lot primește 423 „transport_real_doar_test” ÎNAINTE de secretele FAN și de orice apel către api.fancourier.ro.
// F1 (spec §7.3, §8.1): POARTA DE ROL pe acțiune — `genereaza` (calea detaliată, owner) rămâne owner; restul (trimite, eticheta, urmarire,
// confirmari, evenimente, reconciliaza, sterge_awb) = operator numit SAU owner (fn_red_fan_e_operator, o singură definiție, prin deps.operator);
// codul nou 403 „non_operator”. Pe `trimite` garda „doar TEST” se face aici DOAR pe proiect (cereMarcaj: false — lotul poate fi încă nemarcat:
// marcajul automat îl pune RPC-ul comenzii), apoi RPC-ul (RD032 pe marcaj REAL → 423 aici), apoi recitirea marcajului (cereMarcaj: true) înaintea
// secretelor — în redariFanTransport.mjs::trimite. Garda din BD (red_fan_setari.doar_proiecte_test, fn_red_fan_lot_permis) e a doua, pe orice cale.
// Cu TRANSPORT_REAL_ACTIV = false comportamentul e cel de dinainte (423 „transport_real_oprit”, fără nicio citire în plus).
import { executaActiuneFan } from './redariFanTransport.mjs'

export const TRANSPORT_REAL_ACTIV = true
export const DOAR_PROIECTE_TEST = true
export const PREFIX_PROIECT_TEST = 'TEST-'
// comanda curierului NU e aici: câmpurile POST /order nu sunt în documentul de proiectare → se face manual în selfAWB (doc §3 pasul 5, §8)
export const ACTIUNI_FAN = Object.freeze(['trimite', 'genereaza', 'eticheta', 'urmarire', 'confirmari', 'evenimente', 'reconciliaza', 'sterge_awb'])
// calea detaliată a owner-ului (pașii vechi): rămâne owner; restul acțiunilor = operator numit sau owner (spec §13 F1 (2))
export const ACTIUNI_DOAR_OWNER = Object.freeze(['genereaza'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const MESAJ_TRANSPORT_OPRIT = 'transport oprit'
export const MESAJ_DOAR_PROIECT_TEST = `transport doar pe proiecte de TEST (codul proiectului începe cu „${PREFIX_PROIECT_TEST}”)`
export const MESAJ_DOAR_LOT_TEST = 'transport doar pe loturi marcate TEST (owner-ul marchează lotul TEST înainte)'

/** Proiect de TEST = codul începe cu „TEST-” (exact, fără spații). Orice altceva (lipsă, null, „test-”) = proiect real. */
export const esteProiectTest = cod => typeof cod === 'string' && cod.startsWith(PREFIX_PROIECT_TEST)

/**
 * O SINGURĂ definiție (L19) a gărzii de activare, folosită identic de funcția edge (înaintea căii reale) și de ecran (pașii / operațiile):
 * { ok, cod, motiv }. cereMarcaj = false DOAR pentru butonul de marcaj din ecran și pentru pasul 2 al acțiunii `trimite` (lotul nu e încă marcat;
 * proiectul tot trebuie să fie de TEST). transportActiv / doarTest sunt parametri doar pentru teste; funcția edge le lasă pe cele din cod.
 */
export function transportPermis({ proiectCod = null, fanLot = null, cereMarcaj = true, transportActiv = TRANSPORT_REAL_ACTIV, doarTest = DOAR_PROIECTE_TEST } = {}) {
  if (!transportActiv) return { ok: false, cod: 'transport_real_oprit', motiv: MESAJ_TRANSPORT_OPRIT }
  if (doarTest) {
    if (!esteProiectTest(proiectCod)) return { ok: false, cod: 'transport_real_doar_test', motiv: MESAJ_DOAR_PROIECT_TEST }
    if (cereMarcaj && fanLot?.test !== true) return { ok: false, cod: 'transport_real_doar_test', motiv: MESAJ_DOAR_LOT_TEST }
  }
  return { ok: true, cod: null, motiv: '' }
}

export async function raspundeFan({ jwt, corp }, deps) {
  const out = (status, cod, extra = {}) => ({ status, body: { cod, ...extra } })
  if (!jwt) return out(401, 'neautentificat')
  const user = await deps.getUser()
  // Jakarinos r1 P2 (L18): autentificarea indisponibilă (5xx / rețea / fără status) ≠ token invalid
  if (user?.error) return Number.isInteger(user.error.status) && user.error.status >= 400 && user.error.status < 500 ? out(401, 'neautentificat') : out(503, 'autentificare_neconfirmata')
  const uid = user?.data?.user?.id
  if (!uid) return out(401, 'neautentificat')
  // acțiunea decide POARTA (forma corpului se verifică înaintea ei doar cât să alegem poarta: niciun detaliu nu scapă unui non-operator)
  const actiune = corp && typeof corp === 'object' && ACTIUNI_FAN.includes(corp.actiune) ? corp.actiune : null
  if (ACTIUNI_DOAR_OWNER.includes(actiune) || actiune === null) {
    // (d) calea detaliată cheltuie bani / atinge date FAN → doar owner-ul (fn_sms_e_owner pe auth.uid()), verificat AICI, nu din corp
    const owner = await deps.owner()
    if (owner?.error) return out(503, 'autorizare_neconfirmata')   // L18: eroare ≠ „nu e owner”
    if (owner?.data !== true) return out(403, 'non_owner')
  } else {
    // F1: operator numit sau owner (fn_red_fan_e_operator, în BD, pe auth.uid()); eroarea de citire ≠ „nu e operator”
    const op = await deps.operator()
    if (op?.error) return out(503, 'autorizare_neconfirmata')
    if (op?.data !== true) return out(403, 'non_operator')
  }
  if (actiune === null) return out(400, 'cerere_invalida')
  if (typeof corp.lot_id !== 'string' || !UUID.test(corp.lot_id)) return out(400, 'cerere_invalida')
  const lot = await deps.lot(corp.lot_id)   // RLS cu JWT-ul omului: lotul trebuie să fie vizibil (L09)
  if (lot?.error) return out(503, 'citire_neconfirmata')
  if (!lot?.data) return out(404, 'tinta_inexistenta')
  if (!TRANSPORT_REAL_ACTIV) return out(423, 'transport_real_oprit')
  let proiectCod = null
  if (DOAR_PROIECTE_TEST) {
    // garda „doar TEST”: proiectul lotului (cod) și marcajul lotului, citite cu JWT-ul omului (RLS); eroare de citire ≠ „nu e de test” (L18)
    const pr = await deps.proiect(lot.data.proiect_id)
    if (pr?.error) return out(503, 'citire_neconfirmata')
    proiectCod = pr?.data?.cod ?? null
    const fl = await deps.fanLot(corp.lot_id)
    if (fl?.error) return out(503, 'citire_neconfirmata')
    // `trimite`: DOAR prefixul proiectului aici (marcajul poate lipsi: îl pune RPC-ul comenzii; un marcaj REAL al owner-ului e refuzat de BD, RD032 → 423)
    const p = transportPermis({ proiectCod, fanLot: fl?.data, cereMarcaj: actiune !== 'trimite' })
    if (!p.ok) return out(423, p.cod, { motiv: p.motiv })
  }
  return executaActiuneFan({ corp, lot: lot.data, uid, proiectCod }, deps)
}
