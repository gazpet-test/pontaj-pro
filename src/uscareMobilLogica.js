// ═══════════════════════════════════════════════════════════════════════════
// uscareMobilLogica.js —„Uscare conductă” în lansatorul de telefon (/m): logica pură.
// Ce proiecte se verifică, ordinea listei și drumul (direct pe un proiect / listă de ales).
// Dreptul NU se decide aici: îl dă serverul, prin ACEEAȘI funcție pe care o cere ecranul de uscare pentru scriere
// (fn_executie_nod_drept(proiect, true): owner sau modulul 'executie' editor/admin, plus accesul pe proiect). L19: o singură definiție.
// L18: o verificare eșuată (sau un răspuns care nu e boolean) NU înseamnă „fără drept”: se ține separat și se arată.
// ═══════════════════════════════════════════════════════════════════════════

import { paginareKeyset } from './hrDeciziiUtil.js'

export const RPC_DREPT_USCARE = 'fn_executie_nod_drept'
export const PARALEL_DREPT = 6   // câte verificări de drept pleacă deodată (telefon pe semnal slab)

// Butonul din lansator (runda 2): la deschiderea lui /m NU se enumeră proiecte. Butonul apare după ce lansatorul știe deja / află dintr-O
// citire ușoară: owner (profilul încărcat oricum) sau rândul propriu 'executie' din user_module_access cu nivel editor / admin — partea de
// MODUL din fn_executie_nod_drept(proiect, true). E doar o condiție NECESARĂ pentru afișare; dreptul real (și pe proiect) îl dă serverul la
// apăsare, pe fiecare proiect activ. Citirea eșuată = „necunoscut” (L18): butonul se arată, iar verificarea de la apăsare decide și spune.
// randuri = rezultatul citirii { data, error } (data = rândurile 'executie' ale contului) sau null când profilul e owner
export function arataButonUscare(profil, randuri) {
  if (profil?.is_owner === true) return true
  if (!randuri || randuri.error || !Array.isArray(randuri.data)) return true      // necunoscut: decide verificarea de la apăsare
  return randuri.data.some(r => r?.access_level === 'editor' || r?.access_level === 'admin')
}

// Paginare keyset (L23, până la pagina goală) care se OPREȘTE (L24) când viu() devine fals: viu() se verifică înaintea FIECĂREI pagini,
// deci după demontare / o reîncărcare nouă nu mai pleacă nicio cerere. Un răspuns fără eroare dar fără listă = eroare, nu „gol” (L18).
export class Oprit extends Error { constructor() { super('oprit: rezultatul nu mai e cerut'); this.name = 'Oprit' } }
export function paginiCatTimpViu(cerePagina, viu = () => true, pas = 1000) {
  return paginareKeyset(async (ultim, p) => {
    if (!viu()) throw new Oprit()
    const r = await cerePagina(ultim, p)
    if (!r?.error && !Array.isArray(r?.data)) throw new Error('răspuns neașteptat la citirea paginii')
    return r
  }, pas)
}

const idValid = v => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null }

// candidații = proiectele ACTIVE (runda 2: arhiva nu se mai verifică de pe telefon); uscariDeschise dă doar numărul de rapoarte deschise
export function candidatiUscare(proiecte, uscariDeschise) {
  const nr = new Map()
  for (const u of Array.isArray(uscariDeschise) ? uscariDeschise : []) {
    const id = idValid(u?.proiect_id)
    if (id != null) nr.set(id, (nr.get(id) || 0) + 1)
  }
  const vazute = new Set()
  const out = []
  for (const p of Array.isArray(proiecte) ? proiecte : []) {
    const id = idValid(p?.id)
    if (id == null || vazute.has(id)) continue
    vazute.add(id)
    const c = { id, nume: String(p.nume || '').trim(), cod: String(p.cod_intern || '').trim(), activ: p.activ !== false, deschise: nr.get(id) || 0 }
    if (c.activ) out.push(c)
  }
  return out
}

export const etichetaProiect = p => [p?.cod, p?.nume].filter(Boolean).join(' — ') || `Proiectul ${p?.id}`

// ordinea listei: întâi cele cu rapoarte de uscare deschise, apoi restul; în fiecare grup după nume (activ rămâne criteriu, pentru siguranță)
export function ordoneazaProiecte(lista) {
  return [...(Array.isArray(lista) ? lista : [])].sort((a, b) =>
    (b.deschise > 0) - (a.deschise > 0) || (b.activ === true) - (a.activ === true)
    || etichetaProiect(a).localeCompare(etichetaProiect(b), 'ro') || a.id - b.id)
}

// rezultate = [{ id, data, error }] (câte unul pe candidat, în orice ordine)
// -> { stare: 'gata', proiecte, incomplet, erori } | { stare: 'eroare', eroare, erori }
export function stareDinDrepturi(candidati, rezultate) {
  const cuDrept = new Set(), erori = []
  let primaEroare = null
  for (const r of Array.isArray(rezultate) ? rezultate : []) {
    if (r?.error || typeof r?.data !== 'boolean') { erori.push(r?.id); primaEroare = primaEroare || r?.error?.message || 'răspuns neașteptat'; continue }
    if (r.data === true) cuDrept.add(r.id)
  }
  // un candidat fără niciun rezultat (nu ar trebui să se întâmple) = necunoscut, nu „fără drept”
  for (const c of candidati) if (!(rezultate || []).some(r => r?.id === c.id)) { erori.push(c.id); primaEroare = primaEroare || 'verificare lipsă' }
  const proiecte = ordoneazaProiecte(candidati.filter(c => cuDrept.has(c.id)))
  if (!proiecte.length && erori.length) return { stare: 'eroare', eroare: primaEroare, erori }
  return { stare: 'gata', proiecte, incomplet: erori.length > 0, erori }
}

// drumul de la buton: un singur proiect ACTIV (și lista completă) = direct pe el; altfel lista de ales
export function drumUscare(st) {
  const p = st?.stare === 'gata' && Array.isArray(st.proiecte) ? st.proiecte : []
  if (!p.length) return { tip: 'niciunul' }
  if (p.length === 1 && p[0].activ && !st.incomplet) return { tip: 'direct', proiectId: p[0].id }
  return { tip: 'lista' }
}

// rulează fn pe fiecare element, câte `n` deodată; viu() = false oprește pornirea altora (rezultatul nu se mai aplică oricum)
export async function inParalel(elemente, n, fn, viu = () => true) {
  const out = new Array(elemente.length)
  let urm = 0
  const lucrator = async () => {
    while (urm < elemente.length && viu()) {
      const i = urm++
      out[i] = await fn(elemente[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, elemente.length) }, lucrator))
  return out
}
