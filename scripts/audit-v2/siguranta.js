export function verificaSandbox(licitatie, fixture) {
  if (fixture.licitatie_id !== 103
    || !licitatie || String(licitatie.id) !== String(fixture.licitatie_id)
    || !/^SANDBOX-V2-.+/.test(licitatie.nr_anunt || '')) throw new Error('REFUZ: licitația nu este clona SANDBOX-V2 verificată în BD')
  return true
}
export function verificaIds(fixture, cerinte) {
  const ids = ['D1', 'D6', 'D8'].map(k => fixture.cerinte?.[k])
  if (ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('Completează ID-urile D1/D6/D8 ale clonei')
  if (ids.some(id => !cerinte.some(c => c.id === id && c.licitatie_id === fixture.licitatie_id))) throw new Error('Cerința nu aparține clonei')
  return ids
}
export function caleSandbox(path, fixture = { licitatie_id: 103 }) {
  const id = fixture?.licitatie_id
  if (id !== 103) throw new Error('REFUZ: destinație fără clona autorizată')
  const prefix = `${id}/`
  if (typeof path !== 'string' || !path.startsWith(prefix) || !path.slice(prefix.length) || path.split('/').some(p => !p)
    || /\\|%|[?#\x00-\x1f]|(^|\/)\.\.?($|\/)/.test(path)) throw new Error('Destinație Storage în afara clonei 103/')
  return path
}
