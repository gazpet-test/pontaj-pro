// TKT-2026-0388 — Izometrie: „mută la început” (și, în general, la poziția N) o piesă din pachet, dintr-o dată.
// Serverul (fn_executie_tevi_muta_pozitie, migrarea 20261215c) face mutarea ATOMIC: blochează toate rândurile pachetului, apoi cheamă
// schimbul existent (fn_executie_swap_tevi_pozitie — gărzile, dreptul pe proiect și recalcularea POZ KM rămân ale lui) între piesă și
// vecinul ei, pas cu pas, în aceeași tranzacție. Planul de mai jos e ACELAȘI algoritm (aceleași cazuri ca în
// supabase/tests/20261215c_izometrie_muta_pozitie.sql, L19); în ecran îl folosim pentru textul de confirmare.

// ids = id-urile pachetului în ordinea curentă (poz_in_pachet, apoi id); pozNoua = 1..n.
// → { ok:true, pozVeche, pozNoua, schimburi:[[id, idVecin], …], ordine:[…] } | { ok:false, motiv }
export function planMutare(ids, id, pozNoua) {
  const lista = Array.isArray(ids) ? ids.slice() : []
  const n = lista.length
  if (new Set(lista).size !== n) return { ok: false, motiv: 'pachetul are rânduri duplicate în listă' }
  const i = lista.indexOf(id)
  if (i < 0) return { ok: false, motiv: 'rândul nu e în pachet' }
  if (!Number.isInteger(pozNoua) || pozNoua < 1 || pozNoua > n) return { ok: false, motiv: `poziția trebuie să fie între 1 și ${n}` }
  const j = pozNoua - 1
  const schimburi = []
  if (j < i) for (let k = i - 1; k >= j; k--) schimburi.push([id, lista[k]])
  else for (let k = i + 1; k <= j; k++) schimburi.push([id, lista[k]])
  const ordine = lista.filter(x => x !== id)
  ordine.splice(j, 0, id)
  return { ok: true, pozVeche: i + 1, pozNoua, schimburi, ordine }
}

// aplică schimburile (fiecare = schimbul pozițiilor a două rânduri) pe o listă — dovada că planul dă ordinea promisă
export function aplicaSchimburi(ids, schimburi) {
  const l = ids.slice()
  for (const [a, b] of schimburi) {
    const ia = l.indexOf(a), ib = l.indexOf(b)
    if (ia < 0 || ib < 0) throw new Error('schimb cu un rând inexistent')
    l[ia] = b; l[ib] = a
  }
  return l
}

// ordinea din ecran: aceeași ca pe server (poz_in_pachet, apoi id)
export const ordineDinRanduri = randuri => (randuri || []).slice()
  .sort((a, b) => (Number(a.poz_in_pachet) - Number(b.poz_in_pachet)) || (Number(a.id) - Number(b.id))).map(r => r.id)

const NUME_RPC = 'fn_executie_tevi_muta_pozitie'
// funcția lipsește (migrarea neaplicată): PostgREST PGRST202 (nu e în cache) / Postgres 42883 — doar dacă numește funcția noastră
export function lipsaRpcMutare(error) {
  if (!error) return false
  const cod = String(error.code || '')
  const text = [error.message, error.details, error.hint].filter(Boolean).join(' ')
  return (cod === 'PGRST202' || cod === '42883') && text.includes(NUME_RPC)
}

// sonda: rpc(NUME_RPC, { p_id: null, p_poz_noua: null }) → { disponibil: true } fără nicio citire sau scriere
export function stareMutareDinSonda(res) {
  if (!res) return 'eroare'
  if (res.error) return lipsaRpcMutare(res.error) ? 'nu' : 'eroare'
  return res.data && res.data.disponibil === true ? 'da' : 'eroare'
}

// mesajul pentru om, după codul erorii (fără id-uri)
export function mesajEroareMutare(error) {
  const cod = String(error?.code || '')
  if (lipsaRpcMutare(error)) return 'Mutarea la început va fi disponibilă după actualizarea bazei de date.'
  if (cod === '42501') return String(error.message || '').startsWith('E4a flux') ? 'Pachetul e în fluxul de montaj: ordinea nu se mai schimbă din editor.' : 'Nu ai drept de scriere pe acest proiect.'
  if (cod === '40001' || cod === '40P01') return 'Pachetul a fost modificat în același timp de altcineva. Nu s-a schimbat nimic: reîncearcă.'
  if (cod === '57014') return 'Mutarea a durat prea mult și a fost oprită. Nu s-a schimbat nimic.'
  return 'Eroare la mutare: ' + (error?.message || error)
}
