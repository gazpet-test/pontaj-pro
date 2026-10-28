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
