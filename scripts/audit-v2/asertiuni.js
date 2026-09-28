const path = (o, p) => p.split('.').reduce((v, k) => v?.[k], o)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
export function asertiune(a, before, after) {
  if (!a || !['exists', 'all', 'count', 'changed', 'unchanged', 'chain'].includes(a.tip)) throw new Error('Tip de aserțiune invalid')
  if (a.tip === 'chain') {
    const r = after.lant.rezultate.find(r => r.cerinta_id === a.cerinta_id)?.verigi[a.veriga]
    return { trece: !!r && r.stare === a.stare, observat: r || null }
  }
  const rows = snap => {
    const collection = snap.tabele[a.tabela]
    if (!Array.isArray(collection)) throw new Error(`Tabel necitit: ${a.tabela}`)
    return collection.filter(r => Object.entries(a.where || {}).every(([key, val]) => same(path(r, key), val)))
  }
  const actual = rows(after)
  if (a.tip === 'count') return { trece: actual.length === a.valoare, observat: actual.length }
  if (['changed', 'unchanged'].includes(a.tip)) {
    const old = rows(before)
    if (!actual.length || !old.length) return { trece: false, observat: 'Fără rânduri pe ambele părți' }
    const projection = rs => rs.map(r => a.camp ? path(r, a.camp) : r)
    return { trece: same(projection(old), projection(actual)) === (a.tip === 'unchanged'), observat: projection(actual) }
  }
  if (!a.asteptat || !Object.keys(a.asteptat).length) throw new Error('Aserțiune fără câmpuri așteptate')
  const matches = r => Object.entries(a.asteptat).every(([k, v]) => same(path(r, k), v))
  return { trece: actual.length > 0 && (a.tip === 'all' ? actual.every(matches) : actual.some(matches)), observat: actual }
}
export const VERDICTE = ['MATCH', 'PARTIAL', 'MISSING_LINK', 'WRONG_SEMANTICS', 'BYPASS', 'FALSE_GREEN', 'UNDETERMINED']
export function verdictAsertiuni(assertions, before, after) {
  if (!assertions?.length) return { verdict: 'UNDETERMINED', rezultate: [], motiv: 'Nicio postcondiție configurată' }
  const rezultate = assertions.map(a => ({ asertiune: a, ...asertiune(a, before, after) }))
  const fail = rezultate.find(r => !r.trece)
  const verdict = fail ? fail.asertiune.la_esec || 'PARTIAL' : 'MATCH'
  if (!VERDICTE.includes(verdict) || fail && verdict === 'MATCH') throw new Error('Clasificare la eșec invalidă')
  return { verdict, rezultate }
}
