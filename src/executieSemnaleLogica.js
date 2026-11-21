// Logica pură a ecranului „🔔 Semnale” (Execuție, agentul verificator — faza 1, 20270106a): etichete, filtre, sortare, tranzițiile de stare.
// Tranzițiile = ACEEAȘI listă ca blocul TRANZITII-START/END din fn_executie_semnal_tranzitie (migrarea 20270106a); testul de paritate
// (scripts/pglite/test_executie_semnale_local.mjs, secțiunea 5) citește blocul din migrare și îl compară cu TRANZITII de aici (L19).

export const STARI = ['nou', 'in_lucru', 'asteapta_informatii', 'rezolvat', 'respins']
export const STARE_INFO = {
  nou: { label: 'nou', ton: 'albastru' },
  in_lucru: { label: 'în lucru', ton: 'galben' },
  asteapta_informatii: { label: 'așteaptă informații', ton: 'portocaliu' },
  rezolvat: { label: 'rezolvat', ton: 'verde' },
  respins: { label: 'respins', ton: 'gri' },
}
export const GRAVITATI = ['critic', 'atentie', 'info']
export const GRAVITATE_INFO = { critic: { label: 'critic', ton: 'rosu', ordine: 0 }, atentie: { label: 'atenție', ton: 'galben', ordine: 1 }, info: { label: 'info', ton: 'albastru', ordine: 2 } }
export const FLUXURI = ['lipsuri', 'tichete', 'corespondenta']
export const FLUX_INFO = { lipsuri: 'lipsuri', tichete: 'tichete', corespondenta: 'corespondență' }
export const CONSTATARE_INFO = {
  constatat: 'constatat (cu dovadă)',
  negasit_in_surse: 'NEGĂSIT în sursele consultate (nu înseamnă că lipsește)',
  camp_lipsa: 'câmp gol în ERP',
}
export const SURSA_INFO = { document: 'document', mail: 'mail', camp_erp: 'câmp ERP' }
export const STARI_DESCHISE = ['nou', 'in_lucru', 'asteapta_informatii']

/** [actor, stare veche, stare nouă] — identic cu blocul TRANZITII din migrare (același text, aceeași ordine). */
export const TRANZITII = [
  ['om', 'nou', 'in_lucru'], ['om', 'nou', 'asteapta_informatii'], ['om', 'nou', 'rezolvat'], ['om', 'nou', 'respins'],
  ['om', 'in_lucru', 'asteapta_informatii'], ['om', 'in_lucru', 'rezolvat'], ['om', 'in_lucru', 'respins'],
  ['om', 'asteapta_informatii', 'in_lucru'], ['om', 'asteapta_informatii', 'rezolvat'], ['om', 'asteapta_informatii', 'respins'],
  ['om', 'rezolvat', 'in_lucru'], ['om', 'respins', 'in_lucru'],
  ['agent', 'rezolvat', 'nou'], ['agent', 'respins', 'nou'],
]
export const tranzitiePermisa = (veche, noua, actor = 'om') => TRANZITII.some(t => t[0] === actor && t[1] === veche && t[2] === noua)
/** stările în care omul poate duce un semnal din starea curentă (ordinea din STARI) */
export const stariUrmatoare = veche => STARI.filter(s => tranzitiePermisa(veche, s, 'om'))
/** motivul e obligatoriu la TRECEREA în rezolvat / respins și la redeschiderea unui semnal închis (aceeași regulă ca fn_executie_semnal_stare;
 *  starea neschimbată păstrează motivul existent pe server) */
export const motivObligatoriu = (veche, noua) => noua !== veche && (['rezolvat', 'respins'].includes(noua) || ['rezolvat', 'respins'].includes(veche))

export const fmtZi = z => (z ? String(z).slice(0, 10).split('-').reverse().join('.') : '—')
export const fmtMoment = m => {
  if (!m) return '—'
  const d = new Date(m)
  if (Number.isNaN(d.getTime())) return String(m)
  return new Intl.DateTimeFormat('ro-RO', { timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
}

/** zile până la termen față de ziua dată (AAAA-LL-ZZ); null fără termen; negativ = depășit */
export function zilePanaLa(termen, azi) {
  if (!termen || !azi) return null
  const a = Date.UTC(+azi.slice(0, 4), +azi.slice(5, 7) - 1, +azi.slice(8, 10))
  const t = Date.UTC(+termen.slice(0, 4), +termen.slice(5, 7) - 1, +termen.slice(8, 10))
  if (!Number.isFinite(a) || !Number.isFinite(t)) return null
  return Math.round((t - a) / 864e5)
}

/**
 * Filtrele ecranului: gravitate / stare / flux (liste; goale = toate), text (în titlu / obiect / detalii / propunere, fără diacritice),
 * doarDeschise (implicit true în ecran: ascunde rezolvat / respins).
 */
export function filtreaza(randuri, { gravitati = [], stari = [], fluxuri = [], text = '', doarDeschise = false } = {}) {
  const t = norm(text)
  return (randuri || []).filter(r =>
    (!gravitati.length || gravitati.includes(r.gravitate))
    && (!stari.length || stari.includes(r.stare))
    && (!fluxuri.length || fluxuri.includes(r.flux))
    && (!doarDeschise || STARI_DESCHISE.includes(r.stare))
    && (!t || norm([r.titlu, r.obiect, r.detalii, r.propunere, r.proiect_cod, r.proiect_nume].filter(Boolean).join(' ')).includes(t)))
}
// diacriticele ies ca semne combinante (NFD) și se scot cu clasa Unicode a semnelor (fără secvențe de scăpare în sursă)
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

/**
 * Sortarea: după termen (cele cu termen întâi, cel mai apropiat primul), apoi gravitate (critic > atenție > info), apoi detectat_la desc, apoi id.
 * mod = 'termen' (implicit) | 'gravitate' (gravitate întâi, apoi termen).
 */
export function sorteaza(randuri, mod = 'termen') {
  const grav = r => GRAVITATE_INFO[r.gravitate]?.ordine ?? 9
  const termen = r => (r.termen ? String(r.termen) : '9999-99-99')
  const cmpT = (a, b) => (termen(a) < termen(b) ? -1 : termen(a) > termen(b) ? 1 : 0)
  const cmpG = (a, b) => grav(a) - grav(b)
  const cmpD = (a, b) => (String(b.detectat_la || '') > String(a.detectat_la || '') ? 1 : String(b.detectat_la || '') < String(a.detectat_la || '') ? -1 : 0)
  const cmpId = (a, b) => Number(a.id) - Number(b.id)
  const ord = mod === 'gravitate' ? [cmpG, cmpT, cmpD, cmpId] : [cmpT, cmpG, cmpD, cmpId]
  return [...(randuri || [])].sort((a, b) => { for (const c of ord) { const v = c(a, b); if (v) return v } return 0 })
}

/** numărătoarea pe stări și gravități (antetul ecranului) */
export function rezumat(randuri) {
  const r = { total: 0, deschise: 0, critic: 0, atentie: 0, info: 0, stari: {} }
  for (const x of randuri || []) {
    r.total++
    if (STARI_DESCHISE.includes(x.stare)) { r.deschise++; if (x.gravitate in r) r[x.gravitate]++ }
    r.stari[x.stare] = (r.stari[x.stare] || 0) + 1
  }
  return r
}

/** textul dovezii, pentru afișare: sursa · data · fragment; referința se arată separat (link doar dacă e http(s)) */
export function dovadaText(r) {
  if (!r) return ''
  if (r.constatare === 'negasit_in_surse') return `Negăsit în sursele consultate: ${(r.surse_consultate || []).join(', ') || '—'}`
  if (r.constatare === 'camp_lipsa') return `Câmp gol în ERP: ${r.dovada_ref || '—'}`
  const p = [SURSA_INFO[r.dovada_sursa] || r.dovada_sursa, r.dovada_data ? fmtZi(r.dovada_data) : null, r.dovada_fragment].filter(Boolean)
  return p.join(' · ')
}
export const eLink = ref => /^https?:\/\/[^\s]+$/i.test(String(ref || ''))

/** parametrii RPC-ului fn_executie_semnal_stare din formularul de schimbare a stării */
export function parametriStare(semnal, { stare, motiv, dovada, actiuneRef, responsabil, schimbaResponsabil }) {
  return {
    p_id: semnal.id, p_versiune: semnal.versiune,
    p_stare: stare && stare !== semnal.stare ? stare : null,          // neschimbată = NULL (serverul păstrează starea și textele ei)
    p_motiv: (motiv || '').trim() || null, p_dovada: (dovada || '').trim() || null, p_actiune_ref: (actiuneRef || '').trim() || null,
    p_responsabil: schimbaResponsabil ? (responsabil == null || responsabil === '' ? null : Number(responsabil)) : null,
    p_schimba_responsabil: schimbaResponsabil === true,
  }
}
/** validarea formularului înaintea apelului: mesaj sau null */
export function validareStare(semnal, { stare, motiv, schimbaResponsabil, responsabil }) {
  const noua = stare || semnal.stare
  if (noua !== semnal.stare && !tranzitiePermisa(semnal.stare, noua, 'om')) return `Din „${STARE_INFO[semnal.stare]?.label}” nu se poate trece la „${STARE_INFO[noua]?.label}”.`
  if (motivObligatoriu(semnal.stare, noua) && !(motiv || '').trim()) return 'Motivul e obligatoriu la rezolvare, respingere și redeschidere.'
  if (schimbaResponsabil && responsabil != null && responsabil !== '' && !/^[1-9][0-9]{0,8}$/.test(String(responsabil))) return 'Responsabilul trebuie să fie un angajat din listă.'
  return null
}
