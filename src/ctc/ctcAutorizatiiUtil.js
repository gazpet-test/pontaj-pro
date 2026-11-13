// Autorizațiile sudorilor pentru cartea tehnică (TKT-2026-0389, 20261222b) — logica din client, testată în src/ctcAutorizatiiUtil.test.js.
// Datele vin DOAR din RPC-ul fn_ctc_autorizatii_sudori (dreptul CTC verificat în BD); scanul DOAR prin edge fn ctc-autorizatie-fisier.
import { paginareKeyset } from '../hrDeciziiUtil.js'

export const STARI = {
  valabila:  { label: 'Valabilă',  culoare: 'green' },
  expirata:  { label: 'Expirată',  culoare: 'red' },
  fara_data: { label: 'Fără dată', culoare: 'yellow' },
}

// 'AAAA-LL-ZZ' → 'ZZ.LL.AAAA' fără new Date() (fără decalaj de fus orar, L17)
export const fmtZi = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('.') : '—')

const fara = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

// filtrele din ecran: text (titular / număr / tip / procedeu / firmă), stare, înlocuite
export function filtreaza(rows, { text = '', stare = 'toate', inlocuite = true } = {}) {
  const q = fara(text).trim()
  return (rows || []).filter(r => {
    if (stare !== 'toate' && r.stare !== stare) return false
    if (!inlocuite && r.inlocuita) return false
    if (!q) return true
    return [r.titular, r.numar_autorizatie, r.tip, r.procedeu_sudura, r.firma, r.calitate_material].some(v => fara(v).includes(q))
  })
}

// ordinea afișării: titular, apoi cele valabile întâi, apoi expirarea cea mai recentă, apoi id
export function ordoneaza(rows) {
  const rang = { valabila: 0, fara_data: 1, expirata: 2 }
  return [...(rows || [])].sort((a, b) =>
    String(a.titular || '').localeCompare(String(b.titular || ''), 'ro')
    || (rang[a.stare] ?? 3) - (rang[b.stare] ?? 3)
    || String(b.data_expirare || '').localeCompare(String(a.data_expirare || ''))
    || Number(a.id) - Number(b.id))
}

// eroarea RPC → mesaj + tip (L18: fără drept ≠ eroare ≠ neactivat ≠ listă goală)
export function clasificaEroare(error) {
  const cod = error?.code || ''
  if (cod === '42501') return { tip: 'fara_drept', mesaj: 'Contul nu are acces la modulul CTC.' }
  if (cod === 'PGRST202' || cod === '42883') return { tip: 'neactivat', mesaj: 'Secțiunea nu e încă activă (se activează odată cu actualizarea bazei de date).' }
  return { tip: 'eroare', mesaj: 'Autorizațiile nu au putut fi încărcate: ' + (error?.message || 'eroare necunoscută') }
}

// TOATE autorizațiile (keyset pe id până la pagina goală, L23: plafonul de 1000 al serverului nu trunchiază tăcut)
export function incarcaAutorizatii(sb, pas = 1000) {
  return paginareKeyset((ultim, n) => {
    const q = sb.rpc('fn_ctc_autorizatii_sudori').order('id', { ascending: true }).limit(n)
    return ultim == null ? q : q.gt('id', ultim)
  }, pas)
}

// scanul: edge fn (dreptul + tipul verificate în BD, semnare doar pe calea aprobată) → { url } sau { eroare }
export async function cereScan(sb, id) {
  const { data, error } = await sb.functions.invoke('ctc-autorizatie-fisier', { body: { autorizatie_id: Number(id) } })
  if (!error && data?.url) return { url: data.url }
  let mesaj = data?.error || error?.message || 'Scanul nu poate fi deschis.'
  try { const corp = await error?.context?.json?.(); if (corp?.error) mesaj = corp.error } catch (_) { /* corpul nu e JSON */ }
  return { eroare: mesaj }
}
