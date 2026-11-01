// 20261121a: licitația are un responsabil și, opțional, un al doilea. Afișare „Mirela R. + Ion P.” (primul cuvânt + inițiala celui de-al doilea).
export const scurtNume = (n) => {
  const t = String(n || '').trim().split(/\s+/).filter(Boolean)
  return t.length > 1 ? `${t[0]} ${t[1][0]}.` : (t[0] || '')
}
// un singur responsabil → numele întreg (ca până acum); doi → ambii scurtați; niciunul → ''
export const numeResponsabili = (l) => {
  const n = [l?.responsabil_nume, l?.responsabil2_nume].filter((x) => String(x || '').trim())
  return n.length > 1 ? `${scurtNume(n[0])} + ${scurtNume(n[1])}` : (n[0] || '')
}
// licitația e „a mea” dacă sunt oricare dintre cei doi responsabili
export const esteResponsabil = (l, uid) => !!uid && (l?.responsabil_id === uid || l?.responsabil2_id === uid)
// Poarta pe cheltuială AI, afișarea în UI (20261124a, decizia Răzvan 1 + A). Serverul decide (fn_ofertare_poate_cheltui: și cine l-a numit
// trebuie să fie owner / admin Ofertare); UI-ul doar ascunde butonul celui care evident nu trece: nu e owner, nu e responsabil 1 / 2
// sau s-a numit singur. Câmpurile *_setat_de lipsă din select = nu se poate exclude (serverul refuză oricum).
export const poateCheltuiUI = (l, profile) => !!profile?.id && (profile.is_owner === true ||
  (l?.responsabil_id === profile.id && l?.responsabil_setat_de !== profile.id) ||
  (l?.responsabil2_id === profile.id && l?.responsabil2_setat_de !== profile.id))
