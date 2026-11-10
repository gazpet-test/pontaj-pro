// Execuție — acces pe PROIECT (20261209a, decizia lui Răzvan 10.11.2026): logica pură din UI.
// Regula (aceeași ca fn_executie_proiect_permis din BD, L19): owner = tot; cont FĂRĂ rânduri în executie_acces_proiect = ca azi (tot ce dă
// modulul); cont CU rânduri = doar proiectele listate ('viewer' = citire, 'editor' = citire + scriere, în limita modulului).
// Poarta adevărată e în BD (RLS + trigger-e + funcțiile de drept); aici doar arătăm lista corectă și un mesaj clar pe un link nepermis.
// Eroare la citirea rândurilor != „fără rânduri” (L18): starea 'eroare' NU înseamnă „vede tot”.

export const NIVELURI = ['viewer', 'editor']

// stările accesului: 'incarcare' | 'eroare' | 'nerestrans' | 'restrans'
export function stareAcces({ gata, eroare, eOwner, randuri }) {
  if (!gata) return { stare: 'incarcare', permise: new Set(), scriere: new Set() }
  if (eroare) return { stare: 'eroare', eroare: String(eroare), permise: new Set(), scriere: new Set() }
  if (eOwner === true) return { stare: 'nerestrans', permise: new Set(), scriere: new Set() }
  if (!Array.isArray(randuri)) return { stare: 'eroare', eroare: 'răspuns invalid la citirea accesului', permise: new Set(), scriere: new Set() }
  if (randuri.length === 0) return { stare: 'nerestrans', permise: new Set(), scriere: new Set() }
  const permise = new Set(); const scriere = new Set()
  for (const r of randuri) {
    const id = Number(r?.proiect_id)
    if (!Number.isSafeInteger(id) || id <= 0 || !NIVELURI.includes(r?.nivel)) {
      return { stare: 'eroare', eroare: 'rând de acces invalid', permise: new Set(), scriere: new Set() }
    }
    permise.add(id)
    if (r.nivel === 'editor') scriere.add(id)
  }
  return { stare: 'restrans', permise, scriere }
}

// lista de proiecte din UI: restrâns = doar cele permise (BD-ul le filtrează deja; aici e a doua plasă). În 'eroare' / 'incarcare' lista
// rămâne cea primită de la server (care e filtrat de RLS) — UI-ul afișează separat eroarea.
export function filtreazaProiecte(proiecte, acces) {
  const lista = Array.isArray(proiecte) ? proiecte : []
  if (acces?.stare !== 'restrans') return lista
  return lista.filter(p => acces.permise.has(Number(p?.id)))
}

// verdictul unui link direct ?proiect=<id> (ordinea contează: eroarea cererii, apoi restricția știută, apoi răspunsul serverului):
//   'incarcare' — încă nu știm; 'eroare' — o citire a eșuat (se arată eroarea, nu „nu ai acces”);
//   'interzis' — contul e restrâns și proiectul nu e în listă; 'lipsa' — serverul nu a dat proiectul (nu există sau nu e permis);
//   'invalid' — id-ul din link nu e un număr; 'ok'.
// proiect: undefined = încă se încarcă; null = serverul n-a întors niciun rând; obiect = găsit. eroareProiect = eroarea cererii.
export function verdictLinkProiect(idText, acces, proiect, eroareProiect) {
  const id = Number(idText)
  if (!/^[1-9][0-9]{0,17}$/.test(String(idText ?? '')) || !Number.isSafeInteger(id)) return 'invalid'
  if (eroareProiect) return 'eroare'
  if (acces?.stare === 'restrans' && !acces.permise.has(id)) return 'interzis'
  if (proiect === undefined) return 'incarcare'
  // serverul (RLS) e poarta: un proiect întors de el e permis; unul neîntors e „lipsă”, iar dacă nici accesul nu s-a putut citi, e eroare
  if (proiect === null) return acces?.stare === 'eroare' ? 'eroare' : acces?.stare === 'incarcare' ? 'incarcare' : 'lipsa'
  return 'ok'
}

export const MESAJ_LINK = {
  interzis: 'Nu ai acces la acest proiect în Execuție. Dacă ai nevoie de el, cere-i lui Răzvan să ți-l adauge.',
  lipsa: 'Proiectul nu există sau nu ai acces la el în Execuție.',
  invalid: 'Linkul nu conține un proiect valid.',
}

// ── ecranul owner-ului ──
// bife: Map<proiect_id, nivel> -> lista canonică pentru RPC (sortată după proiect_id, exact forma din BD)
export function listaPentruRpc(bife) {
  const out = []
  for (const [id, nivel] of (bife instanceof Map ? bife : new Map()).entries()) {
    const n = Number(id)
    if (!Number.isSafeInteger(n) || n <= 0) throw new Error('proiect invalid: ' + id)
    if (!NIVELURI.includes(nivel)) throw new Error('nivel invalid: ' + nivel)
    out.push({ proiect_id: n, nivel })
  }
  return out.sort((a, b) => a.proiect_id - b.proiect_id)
}

// rândurile unui cont, din tabel, în aceeași formă canonică (lista „văzută”, trimisă pentru CAS)
export function listaDinRanduri(randuri, profileId) {
  const m = new Map()
  for (const r of Array.isArray(randuri) ? randuri : []) {
    if (r?.profile_id === profileId) m.set(Number(r.proiect_id), r.nivel)
  }
  return listaPentruRpc(m)
}

// ce se schimbă (pentru confirmarea dinaintea salvării)
export function diferenteAcces(veche, noua) {
  const v = new Map((veche || []).map(x => [x.proiect_id, x.nivel]))
  const n = new Map((noua || []).map(x => [x.proiect_id, x.nivel]))
  const adaugate = [...n.keys()].filter(k => !v.has(k)).sort((a, b) => a - b)
  const scoase = [...v.keys()].filter(k => !n.has(k)).sort((a, b) => a - b)
  const schimbate = [...n.keys()].filter(k => v.has(k) && v.get(k) !== n.get(k)).sort((a, b) => a - b)
  return { adaugate, scoase, schimbate, nimic: !adaugate.length && !scoase.length && !schimbate.length }
}

// interpretarea răspunsului RPC-ului de setare (L18: eroare != conflict != succes)
export function rezultatSetare(data, error) {
  if (error) return { tip: 'eroare', mesaj: error.message || String(error) }
  if (data && data.ok === true) return { tip: 'ok', duplicat: data.duplicat === true, lista: Array.isArray(data.lista) ? data.lista : [] }
  if (data && data.ok === false && data.motiv === 'conflict') return { tip: 'conflict', lista: Array.isArray(data.lista) ? data.lista : [] }
  return { tip: 'eroare', mesaj: 'răspuns necunoscut de la server' }
}
