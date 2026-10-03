// PR1: sumele circulă ca text zecimal. BigInt păstrează banul inclusiv la numeric(16,2).
export const ROLURI_OFERTA = { ofertant_unic:'Ofertant unic', lider_asociere:'Lider asociere', asociat:'Asociat', subcontractant:'Subcontractant', tert_sustinator:'Terț susținător' }
export const INSTRUMENTE = { doclib:'DocLib', isdp:'ISDP', edevize:'eDevize', excel:'Excel', boq:'BOQ', forfetar:'Forfetar', altul:'Altul', necunoscut:'Necunoscut' }
export const ROLURI = { total_oferta:'Total ofertă', platibil:'Plătibil', materiale_beneficiar:'Materiale beneficiar', contract_initial:'Contract inițial', act_aditional:'Act adițional', ajustari:'Ajustări', grafic_valoric:'Grafic valoric', cota:'Cotă' }
export const DOMENII = { asociere_total:'Asociere total', gazpet:'Gazpet', subcontract:'Subcontract', beneficiar:'Beneficiar', lider:'Lider', asociat:'Asociat' }

export function zecimalScalat(v, scala = 2, precizie = 16) {
  if (typeof v !== 'string' && typeof v !== 'bigint') throw new Error('Valoarea trebuie transmisă ca text zecimal')
  const m = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(String(v).trim())
  if (!m || (m[3] || '').length > scala) throw new Error(`Valoare invalidă: maximum ${scala} zecimale`)
  const n = BigInt(m[2] + (m[3] || '').padEnd(scala, '0')) * (m[1] ? -1n : 1n)
  if (n <= -(10n ** BigInt(precizie)) || n >= 10n ** BigInt(precizie)) throw new Error('Valoare în afara preciziei admise')
  return n
}
export function dinBani(n) {
  if (n == null) return null
  const a = n < 0n ? -n : n
  return `${n < 0n ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`
}
export const bani = v => zecimalScalat(v)
export function valideazaValoare(v) {
  const erori = []
  if (!Object.hasOwn(ROLURI, v.rol_valoare)) erori.push('Rol valoare invalid')
  if (!Object.hasOwn(DOMENII, v.domeniu_valoric)) erori.push('Domeniu valoric invalid')
  try { bani(v.valoare) } catch (e) { erori.push(e.message) }
  if (v.rol_valoare === 'cota' || (v.cota_pct != null && v.cota_pct !== '')) {
    try { zecimalScalat(v.cota_pct, 4, 7) } catch { erori.push('Cota cere un procent numeric cu maximum 4 zecimale') }
  }
  if (!v.localizare?.trim()) erori.push('Localizarea este obligatorie')
  if (v.sursa_registru_id != null && v.sursa_externa_cheie != null) erori.push('Alege o singură sursă')
  if ((v.confirmat_de == null) !== (v.confirmat_la == null)) erori.push('Confirmare incompletă')
  return erori
}
const sursa = v => v?.sursa_registru_id != null ? `r:${v.sursa_registru_id}` : v?.sursa_externa_cheie != null ? `e:${v.sursa_externa_cheie}` : null
export function comparaValori(a, b) {
  const nu = { diferenta:null, verdict:'neverificat' }
  if (!a || !b || String(a.pachet_id) !== String(b.pachet_id) || a.rol_valoare !== b.rol_valoare || a.domeniu_valoric !== b.domeniu_valoric
      || (a.participant ?? null) !== (b.participant ?? null) || a.tva_inclus !== b.tva_inclus
      || !sursa(a) || !sursa(b) || sursa(a) === sursa(b) || !a.confirmat_de || !b.confirmat_de
      || ['cota', 'grafic_valoric'].includes(a.rol_valoare) || a.valoare == null || b.valoare == null) return nu
  const diferenta = bani(a.valoare) - bani(b.valoare)
  return { diferenta:dinBani(diferenta), verdict:diferenta === 0n ? 'egal' : 'diferenta' }
}
// Aceeași orientare și aceleași LEFT JOIN-uri ca în v_ofertare_pf_control.
export function calculeazaControl(valori) {
  const rows = [...valori].sort((a,b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0)
  if (!rows.length) return [{ valoare_a_id:null, valoare_b_id:null, diferenta:null, verdict:'neverificat' }]
  return rows.flatMap(a => {
    const comparabile = rows.filter(b => String(b.pachet_id) === String(a.pachet_id) && String(b.id) !== String(a.id) && b.rol_valoare === a.rol_valoare && b.domeniu_valoric === a.domeniu_valoric
      && (b.participant ?? null) === (a.participant ?? null) && b.tva_inclus === a.tva_inclus && sursa(a) && sursa(b) && sursa(a) !== sursa(b))
    const perechi = comparabile.filter(b => BigInt(b.id) > BigInt(a.id))
    if (comparabile.length && !perechi.length) return []
    return (perechi.length ? perechi : [null]).map(b => ({ valoare_a_id:a.id, valoare_b_id:b?.id ?? null,
      rol_valoare:a.rol_valoare, domeniu_valoric:a.domeniu_valoric, ...comparaValori(a,b) }))
  })
}
export async function hashFisierClient(file) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 necesită un context securizat al browserului')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return { hash_algoritm:'sha256', hash_valoare:Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join(''),
    hash_sursa:'client', hash_confirmat_de:null, hash_confirmat_la:null, marime:file.size }
}

// Poarta UI a PF (decizie 03.10): re-verificare DOAR când se schimbă utilizatorul. Evenimentele de sesiune pentru
// același utilizator (SIGNED_IN la revenirea în tab, TOKEN_REFRESHED, USER_UPDATED) întorc ACEEAȘI stare ⇒ React nu
// re-randează și DosarPF nu se demontează. La o schimbare REALĂ de utilizator accesul se închide imediat
// (poateCiti/poateScrie = false, „Se verifică…”) până vine răspunsul pentru noul uid (Copilot P1.1, 03.10); dosarul e
// oricum cheiat pe uid. Deconectarea închide imediat (fără RPC).
// PGRST202 (funcția lipsește: migrarea încă neaplicată) ascunde PF fără banner. RLS/RPC rămân autoritatea de acces.
export const ACCES_PF_INITIAL = Object.freeze({ uid:undefined, deVerificat:null, poateCiti:false, poateScrie:false, incarcare:true, verificare:false, eroareAcces:null })
export function reduceAccesPF(stare, ev) {
  if (ev?.tip === 'auth') {
    const uid = ev.uid ?? null
    if (uid === stare.uid) return stare
    if (uid === null) return { uid:null, deVerificat:null, poateCiti:false, poateScrie:false, incarcare:false, verificare:false, eroareAcces:null }
    return { ...stare, uid, deVerificat:uid, poateCiti:false, poateScrie:false, incarcare:true, verificare:true, eroareAcces:null }
  }
  if (!ev || ev.uid == null || ev.uid !== stare.uid || ev.uid !== stare.deVerificat) return stare
  if (ev.tip === 'rezultat') {
    const citire = ev.citire === true
    return { ...stare, deVerificat:null, poateCiti:citire, poateScrie:citire && ev.scriere === true, incarcare:false, verificare:false, eroareAcces:null }
  }
  if (ev.tip === 'eroare') {
    const migrareLipsa = ev.cod === 'PGRST202'
    return { ...stare, deVerificat:null, poateCiti:false, poateScrie:false, incarcare:false, verificare:false,
      eroareAcces:migrareLipsa ? null : (ev.mesaj || 'Eroare la verificarea accesului PF') }
  }
  return stare
}
// Abonarea la sesiune: transmite reducerului doar uid-ul. Nu apelează Supabase din callback (evită blocajul auth-js).
export function abonareAccesPF(auth, dispatch) {
  let activ = true
  const { data } = auth.onAuthStateChange((_eveniment, sesiune) => { if (activ) dispatch({ tip:'auth', uid:sesiune?.user?.id ?? null }) })
  Promise.resolve(auth.getSession?.()).then(r => { if (activ && r) dispatch({ tip:'auth', uid:r.data?.session?.user?.id ?? null }) }).catch(() => {})
  return () => { activ = false; data?.subscription?.unsubscribe() }
}
// Cheia dosarului: se schimbă doar cu utilizatorul sau părintele, nu cu evenimentele de sesiune.
export const cheieDosarPF = (acces, licitatieId, proiectId) => `${acces?.uid ?? ''}:${licitatieId ?? ''}:${proiectId ?? ''}`
